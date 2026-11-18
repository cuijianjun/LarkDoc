/**
 * Large-document layout hints.
 *
 * Feishu-like editors keep a block index separate from the rich-text tree so
 * viewport work can use compact records instead of walking every node. The
 * ProseMirror DOM remains complete here; the model only supplies intrinsic
 * sizes and stable segment boundaries, which keeps selection and mapping
 * semantics unchanged.
 */

/** 模型索引的段大小。注意与 createLargeDocumentProjection 的 DOM 分组大小（默认 16）不是同一个量。 */
export const LARGE_DOCUMENT_SEGMENT_BLOCKS = 128

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Math.round(value)))
}

function blockFlags(node) {
  const type = node?.type?.name || ''
  return {
    heading: type === 'heading' ? Number(node.attrs?.level) || 1 : 0,
    image: type === 'image' || type === 'figure' ? 1 : 0,
    table: type === 'table' ? 1 : 0,
    container: ['bulletList', 'orderedList', 'taskList', 'blockquote', 'codeBlock', 'columns', 'callout'].includes(type) ? 1 : 0,
  }
}

/**
 * 模型侧高度标尺（结构估算）：只按节点类型与文本长度推，用于建索引、算段偏移。
 * 与 DOM 侧 `estimate`（createLargeDocumentProjection 内部）是两套独立标尺，
 * 一处调大不会带动另一处 —— 那边量的是渲染后的实际盒高。
 */
export function estimateBlockHeight({ type = '', textLength = 0, heading = 0, image = 0, table = 0, container = 0 } = {}) {
  if (image) return 192
  if (table) return 112
  if (heading) return heading === 1 ? 76 : 64
  if (container) return 180
  if (type === 'horizontalRule') return 40
  // A paragraph's layout cost is dominated by wrapped lines. This estimate is
  // deliberately conservative so entering the viewport does not keep growing
  // the scroll range as each long block becomes visible.
  return clamp(56 + Math.ceil(Math.max(0, textLength) / 92) * 29, 56, 1200)
}

function* descriptorIterator(doc) {
  const count = Number(doc?.childCount) || 0
  const nodeSizes = new Uint32Array(count)
  const textLengths = new Uint32Array(count)
  const headings = new Uint8Array(count)
  const flags = new Uint8Array(count)
  const blockTypes = []
  const blocks = []
  let from = 0
  for (let index = 0; index < count; index += 1) {
    const node = doc.child(index)
    const type = node?.type?.name || ''
    const shape = blockFlags(node)
    const nodeSize = Math.max(0, Number(node?.nodeSize) || 0)
    // nodeSize already tracks the block's serialized content without walking
    // every nested text node. This keeps model creation cheap for 30M input;
    // the Worker only needs a compact proxy for the intrinsic-height estimate.
    const textLength = Math.max(0, nodeSize - 2)
    nodeSizes[index] = nodeSize
    textLengths[index] = textLength
    headings[index] = shape.heading
    flags[index] = (shape.image ? 1 : 0) | (shape.table ? 2 : 0) | (shape.container ? 4 : 0)
    blockTypes.push(type)
    blocks.push({
      index,
      from,
      to: from + nodeSize,
      nodeSize,
      intrinsicSize: 0,
      segment: -1,
    })
    from += nodeSize
    yield
  }
  return { nodeSizes, textLengths, headings, flags, blockTypes, blocks }
}

function consume(iterator) {
  let step = iterator.next()
  while (!step.done) step = iterator.next()
  return step.value
}

async function consumeInSlices(iterator, { signal, waitForBackground } = {}) {
  while (!signal?.aborted) {
    if (waitForBackground && !await waitForBackground()) return null
    if (signal?.aborted) return null
    for (let count = 0; count < 512; count += 1) {
      const step = iterator.next()
      if (step.done) return step.value
    }
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  return null
}

function* metadataIterator({ nodeSizes, textLengths, headings, flags, blockTypes, segmentBlocks = LARGE_DOCUMENT_SEGMENT_BLOCKS }) {
  const count = nodeSizes.length
  const heights = new Uint16Array(count)
  const positions = new Uint32Array(count + 1)
  const segments = []
  const segmentTops = []
  let from = 0
  for (let index = 0; index < count; index += 1) {
    const heading = headings[index]
    const image = flags[index] & 1 ? 1 : 0
    const table = flags[index] & 2 ? 1 : 0
    const container = flags[index] & 4 ? 1 : 0
    const nodeSize = nodeSizes[index]
    const textLength = textLengths[index]
    heights[index] = estimateBlockHeight({ type: blockTypes[index], textLength, heading, image, table, container })
    positions[index] = from
    from += nodeSize
    yield
  }
  positions[count] = from
  for (let blockStart = 0, segmentIndex = 0; blockStart < count; blockStart += segmentBlocks, segmentIndex += 1) {
    const blockEnd = Math.min(count, blockStart + segmentBlocks)
    let estimatedHeight = 0
    let textLength = 0
    let headingCount = 0
    for (let index = blockStart; index < blockEnd; index += 1) {
      estimatedHeight += heights[index]
      textLength += textLengths[index]
      if (headings[index]) headingCount += 1
      yield
    }
    segments.push({
      index: segmentIndex,
      blockStart,
      blockEnd,
      from: positions[blockStart],
      to: positions[blockEnd],
      blockCount: blockEnd - blockStart,
      estimatedHeight,
      textLength,
      headingCount,
    })
    segmentTops.push(segmentTops.length ? segmentTops[segmentTops.length - 1] + segments[segmentIndex - 1].estimatedHeight : 0)
  }
  segmentTops.push(segments.length ? segmentTops[segmentTops.length - 1] + segments[segments.length - 1].estimatedHeight : 0)
  return { heights, segments, segmentTops }
}

const computeSegmentMetadata = descriptors => consume(metadataIterator(descriptors))

export function segmentedDocumentWorkerSource() {
  return `
const clamp=(value,min=40,max=4096)=>Math.max(min,Math.min(max,Math.round(value)));
const estimate=(type,textLength,heading,image,table,container)=>{
  if(image)return 192;
  if(table)return 112;
  if(heading)return heading===1?76:64;
  if(container)return 180;
  if(type==='horizontalRule')return 40;
  return clamp(56+Math.ceil(Math.max(0,textLength)/92)*29,56,1200);
};
self.onmessage=({data})=>{
  if(!data||data.type!=='compute')return;
  const sizes=new Uint32Array(data.nodeSizes);
  const lengths=new Uint32Array(data.textLengths);
  const headings=new Uint8Array(data.headings);
  const flags=new Uint8Array(data.flags);
  const types=data.blockTypes||[];
  const blockCount=sizes.length;
  const segmentBlocks=data.segmentBlocks||128;
  const heights=new Uint16Array(blockCount);
  const segments=[];
  const segmentTops=[];
  const positions=new Uint32Array(blockCount+1);
  let from=0;
  for(let index=0;index<blockCount;index+=1){
    const image=flags[index]&1?1:0;
    const table=flags[index]&2?1:0;
    const container=flags[index]&4?1:0;
    heights[index]=estimate(types[index],lengths[index],headings[index],image,table,container);
    positions[index]=from;
    from+=sizes[index];
  }
  positions[blockCount]=from;
  for(let start=0,segmentIndex=0;start<blockCount;start+=segmentBlocks,segmentIndex+=1){
    const end=Math.min(blockCount,start+segmentBlocks);
    let height=0,textLength=0,headingCount=0;
    for(let index=start;index<end;index+=1){
      height+=heights[index];
      textLength+=lengths[index];
      if(headings[index])headingCount+=1;
    }
    segments.push({index:segmentIndex,blockStart:start,blockEnd:end,from:positions[start],to:positions[end],blockCount:end-start,estimatedHeight:height,textLength,headingCount});
    segmentTops.push(segmentTops.length ? segmentTops[segmentTops.length - 1] + segments[segmentIndex - 1].estimatedHeight : 0);
  }
  segmentTops.push(segments.length ? segmentTops[segmentTops.length - 1] + segments[segments.length - 1].estimatedHeight : 0);
  self.postMessage({type:'segments',heights,segments,segmentTops},[heights.buffer]);
};`
}

function defaultWorkerFactory() {
  if (typeof Worker === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function' || typeof Blob === 'undefined') return null
  const url = URL.createObjectURL(new Blob([segmentedDocumentWorkerSource()], { type: 'text/javascript' }))
  try { return new Worker(url) } finally { URL.revokeObjectURL(url) }
}

function* modelIterator(doc, descriptors, computed, segmentBlocks) {
  for (let index = 0; index < descriptors.blocks.length; index += 1) {
    descriptors.blocks[index].intrinsicSize = computed.heights[index]
    descriptors.blocks[index].segment = Math.floor(index / segmentBlocks)
    yield
  }
  const model = {
    doc,
    segmentBlocks,
    blocks: descriptors.blocks,
    segments: computed.segments,
    segmentTops: computed.segmentTops,
    get segmentCount() { return model.segments.length },
    segmentAt(index) { return model.segments[Math.max(0, Math.min(model.segments.length - 1, Number(index) || 0))] || null },
    segmentForBlock(index) { return model.segments.find(segment => index >= segment.blockStart && index < segment.blockEnd) || null },
    segmentForPos(pos) {
      const value = Number(pos) || 0
      return model.segments.find(segment => value >= segment.from && value < segment.to) || model.segments[model.segments.length - 1] || null
    },
    applyWorkerResult(result) {
      if (!result || !result.heights) return false
      const heights = result.heights instanceof Uint16Array ? result.heights : new Uint16Array(result.heights)
      for (let index = 0; index < model.blocks.length && index < heights.length; index += 1) model.blocks[index].intrinsicSize = heights[index]
      if (Array.isArray(result.segments) && result.segments.length) model.segments = result.segments
      if (Array.isArray(result.segmentTops) && result.segmentTops.length) model.segmentTops = result.segmentTops
      return true
    },
    descriptors: () => ({
      nodeSizes: descriptors.nodeSizes,
      textLengths: descriptors.textLengths,
      headings: descriptors.headings,
      flags: descriptors.flags,
      blockTypes: descriptors.blockTypes,
      segmentBlocks,
    }),
  }
  return model
}

export function createSegmentedDocumentModel(doc, { segmentBlocks = LARGE_DOCUMENT_SEGMENT_BLOCKS } = {}) {
  const descriptors = consume(descriptorIterator(doc))
  return consume(modelIterator(doc, descriptors, computeSegmentMetadata({ ...descriptors, segmentBlocks }), segmentBlocks))
}

export function createSegmentedDocumentReader({ workerFactory = defaultWorkerFactory } = {}) {
  const reader = {
    async create(doc, { segmentBlocks = LARGE_DOCUMENT_SEGMENT_BLOCKS, ...options } = {}) {
      const descriptors = await consumeInSlices(descriptorIterator(doc), options)
      if (!descriptors) return null
      const result = await reader.read({ descriptors: () => ({ ...descriptors, segmentBlocks }) }, options)
      return result ? consumeInSlices(modelIterator(doc, descriptors, result, segmentBlocks), options) : null
    },
    async read(model, { signal, waitForBackground } = {}) {
      if (!model || signal?.aborted) return null
      if (waitForBackground && !await waitForBackground()) return null
      if (signal?.aborted) return null
      let worker = null
      try { worker = workerFactory() } catch (_) { worker = null }
      const descriptors = model.descriptors()
      if (!worker) return consumeInSlices(metadataIterator(descriptors), { signal, waitForBackground })
      const result = await new Promise(resolve => {
        let settled = false
        const finish = value => {
          if (settled) return
          settled = true
          signal?.removeEventListener('abort', abort)
          worker?.terminate()
          resolve(value)
        }
        const abort = () => finish(null)
        worker.onmessage = event => finish(event.data?.type === 'segments' ? event.data : null)
        worker.onerror = event => { event.preventDefault?.(); finish(null) }
        signal?.addEventListener('abort', abort, { once: true })
        try {
          // Keep the model reusable after a Worker read. Transferring the
          // model-owned buffers would detach them and make a later refresh
          // impossible after a content replacement.
          const nodeSizes = descriptors.nodeSizes.slice()
          const textLengths = descriptors.textLengths.slice()
          const headings = descriptors.headings.slice()
          const flags = descriptors.flags.slice()
          worker.postMessage({
            type: 'compute',
            nodeSizes: nodeSizes.buffer,
            textLengths: textLengths.buffer,
            headings: headings.buffer,
            flags: flags.buffer,
            blockTypes: descriptors.blockTypes,
            segmentBlocks: descriptors.segmentBlocks,
          }, [nodeSizes.buffer, textLengths.buffer, headings.buffer, flags.buffer])
        } catch (_) { finish(null) }
      })
      return result || (signal?.aborted ? null : consumeInSlices(metadataIterator(descriptors), { signal, waitForBackground }))
    },
  }
  return reader
}

/** Piecewise coordinates: visible windows keep native 1:1 pixels, spacers shrink. */
export function createLogicalScrollCoordinates(heights, visible = [], limit = 1000000) {
  const logical = [0], physical = [0]
  heights.forEach(height => logical.push(logical[logical.length - 1] + Math.max(0, height)))
  const total = logical[logical.length - 1]
  // A power-of-two bucket avoids rewriting every spacer after a tiny size change.
  const scale = total > limit ? 2 ** -Math.ceil(Math.log2(total / limit)) : 1
  const locate = (tops, value) => {
    let low = 0, high = heights.length - 1
    while (low < high) { const middle = (low + high) >>> 1; if (tops[middle + 1] <= value) low = middle + 1; else high = middle }
    return low
  }
  const convert = (value, from, to) => {
    if (!heights.length || !total) return 0
    value = Math.max(0, Math.min(from[from.length - 1], Number(value) || 0))
    const index = locate(from, value), size = from[index + 1] - from[index]
    return to[index] + (size ? (value - from[index]) / size * (to[index + 1] - to[index]) : 0)
  }
  const map = {
    logicalHeight: total, scale,
    get physicalHeight() { return physical[physical.length - 1] },
    height(index) { return physical[index + 1] - physical[index] || 0 },
    top(index) { return physical[index] || 0 },
    logicalTop(index) { return logical[index] || 0 },
    anchorAtPhysical(value) {
      const offset = map.toLogical(value), index = heights.length ? locate(logical, offset) : 0
      return { index, offset: offset - (logical[index] || 0) }
    },
    toLogical: value => convert(value, physical, logical),
    toPhysical: value => convert(value, logical, physical),
    setVisible(indices) {
      const active = new Set(indices)
      physical.length = 1
      heights.forEach((height, index) => physical.push(physical[physical.length - 1] + Math.max(0, height) * (active.has(index) ? 1 : scale)))
    },
  }
  map.setVisible(visible)
  return map
}

/** Selection mapping and its DOM cache are needed only by the lazy projection. */
export function createProjectionSelectionReader(view) {
  let doc = null, selected = null, nodes = []
  return (selection, transaction) => {
    // A combined navigate/edit transaction uses the previous DOM until updateState.
    const mapping = transaction?.docChanged ? transaction.mapping.invert() : null
    if (mapping) selection = transaction.selection
    if (!mapping && doc === view.state.doc && selected === selection && nodes.every(node => node && view.dom.contains(node))) return nodes
    const result = [selection.from, selection.to].map((pos, index) => {
      if (mapping) pos = Math.min(view.state.doc.content.size, Math.max(0, mapping.map(pos, index ? 1 : -1)))
      const point = view.domAtPos(pos)
      let node = point.node === view.dom ? point.node.childNodes[point.offset] || point.node.lastChild : point.node
      while (node?.parentNode && node.parentNode !== view.dom) node = node.parentNode
      return node
    })
    if (!mapping) { doc = view.state.doc; selected = selection; nodes = result }
    return result
  }
}
/**
 * Group the browser's flat rendering tree without reparenting PM's light DOM.
 * Manual slots leave NodeViewDesc ownership, DOMObserver and document positions
 * intact. Two levels let the browser skip an offscreen page before visiting
 * its small render windows, instead of checking thousands of flat windows.
 *
 * segmentBlocks 是 DOM 分组大小（每组一段占位盒），与模型索引的
 * LARGE_DOCUMENT_SEGMENT_BLOCKS（128）不是同一个量。
 */
export function createLargeDocumentProjection({ editorDom, segmentBlocks = 16, getSelectionNodes, onRenderWindowChange, initialActive = false, logicalHeightLimit = 1000000 } = {}) {
  const document = editorDom?.ownerDocument
  const viewWindow = document?.defaultView
  if (!editorDom?.attachShadow || editorDom.shadowRoot || typeof document?.createElement('slot').assign !== 'function'
    || !viewWindow?.CSS?.supports?.('content-visibility', 'auto')) return null
  const selectionSnapshot = () => {
    const selection = viewWindow.getSelection()
    return selection && editorDom.contains(selection.anchorNode) && editorDom.contains(selection.focusNode)
      ? { anchorNode: selection.anchorNode, anchorOffset: selection.anchorOffset, focusNode: selection.focusNode, focusOffset: selection.focusOffset } : null
  }
  let preparingSelection = false
  const restoreSelection = (saved, force = false) => {
    if (preparingSelection || !saved || !editorDom.contains(saved.anchorNode) || !editorDom.contains(saved.focusNode)) return
    const selection = viewWindow.getSelection()
    if (force || selection.anchorNode !== saved.anchorNode || selection.anchorOffset !== saved.anchorOffset
      || selection.focusNode !== saved.focusNode || selection.focusOffset !== saved.focusOffset) {
      selection.setBaseAndExtent(saved.anchorNode, saved.anchorOffset, saved.focusNode, saved.focusOffset)
    }
  }
  const initialSelection = selectionSnapshot()
  const shadow = editorDom.attachShadow({ mode: 'open', slotAssignment: 'manual' })
  if (shadow.slotAssignment !== 'manual') { shadow.appendChild(document.createElement('slot')); restoreSelection(initialSelection); return null }
  const style = document.createElement('style')
  style.textContent = '.render-page,.segment{display:contents}:host(.lark-doc-segment-layout) .render-page{display:block;content-visibility:auto;contain-intrinsic-size:auto var(--page-height)}:host(.lark-doc-segment-layout) .segment{display:block;content-visibility:auto;contain-intrinsic-size:auto var(--segment-height)}@media print{.render-page,.segment{display:contents!important;content-visibility:visible!important;contain:none!important}}'
  const windowed = typeof viewWindow.ResizeObserver === 'function'
  const findScrollOwner = () => {
    for (let parent = editorDom.parentElement; parent && parent !== document.body && parent !== document.documentElement; parent = parent.parentElement) {
      if (/(auto|scroll|overlay)/.test(viewWindow.getComputedStyle(parent).overflowY) && parent.scrollHeight > parent.clientHeight + 1) return parent
    }
    return null
  }
  let scrollOwner = null, scrollOwnerChecked = false, ownerGeometryChecked = false
  // Visible blocks may paint image toolbars and resize circles beyond their window.
  if (windowed) style.textContent += ':host(.lark-doc-segment-layout) .render-page,:host(.lark-doc-segment-layout) .segment{contain:layout style paint;content-visibility:hidden}:host(.lark-doc-segment-layout) .render-page{contain-intrinsic-size:var(--page-height)}:host(.lark-doc-segment-layout) .segment{contain-intrinsic-size:var(--segment-height)}:host(.lark-doc-segment-layout) .is-visible{content-visibility:visible;contain:layout style}'
  shadow.appendChild(style)
  const groups = []
  const pages = []
  const renderOwners = new WeakMap()
  const pageOwners = new WeakMap()
  let owner = new WeakMap()
  let hidden = new WeakMap()
  const currentGroup = group => group && (group.element.parentNode === shadow
    || pageOwners.has(group.element.parentNode) && group.element.parentNode?.parentNode === shadow) ? group : null
  const currentOwner = node => currentGroup(node && owner.get(node))
  let destroyed = false
  let active = !!initialActive
  editorDom.classList.toggle('lark-doc-segment-layout', active)
  let printing = false
  let preparedSelection = []
  let handlingMutations = false
  let viewportFrame = null
  let layoutWidth = null
  let logicalCoordinates = null
  let coordinateGroups = [], coordinatesDirty = true
  let refreshingViewport = false
  const originalOverflowAnchor = editorDom.style.overflowAnchor || ''
  let revealedNode = null
  const visiblePages = new Set()
  const visibleGroups = new Set()
  let renderVersion = 0, notifiedVersion = -1
  const renderedBlocks = () => windowed && active && !printing && !destroyed
    ? [...visibleGroups].flatMap(group => group.nodes) : null
  const notifyRenderWindow = () => {
    if (renderVersion === notifiedVersion) return
    notifiedVersion = renderVersion
    onRenderWindowChange?.(renderedBlocks())
  }
  const groupHeight = group => group.height ? group.measuredHeight ?? group.height : 0
  const layoutHeight = group => groupHeight(group) * (active && windowed && !printing && !group.rendered ? logicalCoordinates?.scale ?? 1 : 1)
  const updatePageSize = page => {
    const height = page.groups.reduce((sum, group) => sum + layoutHeight(group), 0)
    page.measuredHeight = height
    page.element.style.setProperty('--page-height', `${Math.max(1, height)}px`)
  }
  const resizeObserver = windowed ? new viewWindow.ResizeObserver(entries => {
    if (destroyed || !active || printing) return
    const changed = new Set()
    entries.forEach(entry => {
      const group = renderOwners.get(entry.target)
      const height = entry.borderBoxSize?.[0]?.blockSize || entry.contentRect.height
      if (!currentGroup(group) || !visibleGroups.has(group) || !height) return
      group.measureDirty = false
      if (height === group.measuredHeight) return
      group.measuredHeight = height
      coordinatesDirty = true
      group.element.style.setProperty('--segment-height', `${height}px`)
      changed.add(group.page)
    })
    changed.forEach(updatePageSize)
    if (changed.size && viewportFrame === null && !destroyed) viewportFrame = viewWindow.requestAnimationFrame(() => { viewportFrame = null; refreshViewport() })
  }) : null
  function refreshViewport(pass = 0) {
    if (!windowed || !active || destroyed || printing || refreshingViewport) return
    const target = typeof pass === 'object' && pass?.target
    if (!scrollOwner && target?.nodeType === 1 && target !== document.body && target !== document.documentElement
      && target.contains(editorDom) && target.scrollHeight > target.clientHeight + 1) {
      scrollOwner = target; scrollOwnerChecked = true
    }
    pass = typeof pass === 'number' ? pass : 0
    let measuredNewWindow = false, ownerChanged = false
    refreshingViewport = true
    try {
    // PM reads the new caret's geometry before the MutationObserver microtask.
    // Assign new light-DOM blocks to slots before that read can force layout.
    flushProjection()
    if (!scrollOwnerChecked) { scrollOwner = findScrollOwner(); scrollOwnerChecked = true }
    const rect = editorDom.getBoundingClientRect()
    const viewportTopEdge = scrollOwner ? scrollOwner.getBoundingClientRect().top + scrollOwner.clientTop : 0
    const height = scrollOwner ? scrollOwner.clientHeight : viewWindow.innerHeight || 900
    const nativeTop = scrollOwner ? scrollOwner.scrollTop : viewWindow.scrollY || viewWindow.pageYOffset || 0
    const physicalOffset = Math.max(0, viewportTopEdge - rect.top)
    const previousCoordinates = logicalCoordinates, previousGroups = coordinateGroups
    const savedAnchor = previousCoordinates?.anchorAtPhysical(physicalOffset)
    const previousPhysicalAnchor = savedAnchor ? previousCoordinates.toPhysical(previousCoordinates.logicalTop(savedAnchor.index) + savedAnchor.offset) : physicalOffset
    visibleGroups.forEach(measureGroup)
    const coordinatesChanged = !logicalCoordinates || coordinatesDirty
    if (coordinatesChanged) {
      logicalCoordinates = createLogicalScrollCoordinates(groups.map(groupHeight), groups.filter(group => group.rendered).map(group => group.index), logicalHeightLimit)
      coordinateGroups = groups.slice()
      coordinatesDirty = false
    }
    const oldCoordinates = previousCoordinates || logicalCoordinates
    const anchorGroup = savedAnchor && previousGroups[savedAnchor.index]
    const anchorIndex = anchorGroup && groups[anchorGroup.index] === anchorGroup ? anchorGroup.index : -1
    let anchor = logicalCoordinates.scale === 1 && oldCoordinates.scale === 1 ? physicalOffset
      : anchorIndex >= 0 ? logicalCoordinates.logicalTop(anchorIndex) + Math.min(groupHeight(anchorGroup), savedAnchor.offset)
        : oldCoordinates.toLogical(physicalOffset)
    const tops = pages.map(page => logicalCoordinates.logicalTop(page.groups[0]?.index || 0))
    tops.push(logicalCoordinates.logicalHeight)
    const at = offset => {
      let low = 0, high = pages.length - 1
      while (low < high) { const mid = (low + high) >>> 1; if (tops[mid + 1] <= offset) low = mid + 1; else high = mid }
      return low
    }
    if (layoutWidth === null) layoutWidth = rect.width
    const viewportTop = Math.max(0, anchor - height), viewportBottom = anchor + height * 2
    const next = new Set()
    const addWindow = (from, to) => {
      let firstGroup = -1, lastGroup = -1
      for (let index = at(from); index <= at(to); index += 1) {
        let top = tops[index]
        for (const group of pages[index]?.groups || []) {
          const bottom = top + groupHeight(group)
          if (group.height && bottom > from && top < to) {
            if (firstGroup < 0) firstGroup = group.index
            lastGroup = group.index
          }
          top = bottom
        }
      }
      if (firstGroup >= 0) for (let index = Math.max(0, firstGroup - 1); index <= Math.min(groups.length - 1, lastGroup + 1); index += 1) {
        if (groups[index].height) next.add(groups[index])
      }
    }
    addWindow(viewportTop, viewportBottom)
    const viewportGroups = new Set(next)
    let pins = null
    if (getSelectionNodes) { try { pins = getSelectionNodes() } catch (_) { /* A replaced view may not have its new DOM mapping yet. */ } }
    if (!pins) { const selection = selectionSnapshot(); pins = [selection?.anchorNode, selection?.focusNode] }
    pins = pins.concat(preparedSelection)
    if (revealedNode && !editorDom.contains(revealedNode)) revealedNode = null
    if (revealedNode) pins = pins.concat(revealedNode)
    pins.forEach(node => {
      if (!node || node === editorDom || !editorDom.contains(node)) return
      while (node.parentNode && node.parentNode !== editorDom) node = node.parentNode
      const group = currentOwner(node) || currentOwner(node.previousSibling) || currentOwner(node.nextSibling)
      if (group?.height) {
        if (node === revealedNode && viewportGroups.has(group)) revealedNode = null
        // Mount the destination's reading window before callers read target
        // geometry. A lone pinned group would shift when its neighbors enter.
        let top = tops[group.page.index]
        for (const previous of group.page.groups) { if (previous === group) break; top += groupHeight(previous) }
        let before = 0
        for (const previous of group.nodes) { if (previous === node) break; if (!isHidden(previous)) before += estimate(previous) }
        const target = top + groupHeight(group) * Math.min(1, before / group.height)
        addWindow(Math.max(0, target - height * 2), target + height * 2)
        next.add(group)
      }
    })
    const nextPages = new Set([...next].map(group => group.page))
    const windowChanged = next.size !== visibleGroups.size || [...next].some(group => !visibleGroups.has(group))
    if (coordinatesChanged || windowChanged) logicalCoordinates.setVisible([...next].map(group => group.index))
    if (logicalCoordinates.scale < 1 || oldCoordinates.scale < 1) editorDom.style.overflowAnchor = 'none'
    // Save the actual size while the old page is still rendered. RO may not
    // have delivered a recent edit before this group leaves the viewport.
    visibleGroups.forEach(group => {
      if (next.has(group)) return
      renderGroup(group, false)
      resizeObserver.unobserve(group.element)
    })
    visiblePages.forEach(page => {
      if (nextPages.has(page)) return
      page.element.classList.remove('is-visible')
    })
    nextPages.forEach(page => { if (!visiblePages.has(page)) page.element.classList.add('is-visible') })
    next.forEach(group => {
      if (visibleGroups.has(group)) return
      renderGroup(group, true)
      resizeObserver.observe(group.element, { box: 'border-box' })
    })
    // Read the new window in one layout batch before navigation reads a target.
    // Otherwise native scrolling uses real heights while the coordinate map
    // still uses estimates until RO, shifting the destination on the next frame.
    const measurements = []
    next.forEach(group => {
      if (!group.measureDirty || !group.height) return
      measurements.push([group, group.element.getBoundingClientRect().height])
    })
    const windowAnchor = logicalCoordinates.anchorAtPhysical(logicalCoordinates.toPhysical(anchor))
    measurements.forEach(([group, size]) => {
      group.measureDirty = false
      if (!size || size === group.measuredHeight) return
      group.measuredHeight = size
      measuredNewWindow = true
    })
    if (measuredNewWindow) {
      logicalCoordinates = createLogicalScrollCoordinates(groups.map(groupHeight), [...next].map(group => group.index), logicalHeightLimit)
      coordinateGroups = groups.slice()
      coordinatesDirty = false
      anchor = logicalCoordinates.logicalTop(windowAnchor.index) + Math.min(groupHeight(groups[windowAnchor.index]), windowAnchor.offset)
    }
    // Only changed spacer heights cause DOM writes. Bucketed scaling avoids
    // a full spacer rewrite for each appended import page or ordinary edit.
    const resizedPages = new Set()
    if (coordinatesChanged || windowChanged || measuredNewWindow) groups.forEach(group => {
      const size = layoutHeight(group)
      if (group.layoutHeight === size) return
      group.layoutHeight = size
      group.element.style.setProperty('--segment-height', `${Math.max(1, size)}px`)
      resizedPages.add(group.page)
    })
    resizedPages.forEach(updatePageSize)
    if (!ownerGeometryChecked && measuredNewWindow) {
      ownerGeometryChecked = true
      if (!scrollOwner) { const owner = findScrollOwner(); if (owner) { scrollOwner = owner; ownerChanged = true } }
    }
    if (!ownerChanged && (logicalCoordinates.scale < 1 || oldCoordinates.scale < 1)) {
      const correction = logicalCoordinates.toPhysical(anchor) - previousPhysicalAnchor
      if (rect.top < viewportTopEdge && Math.abs(correction) > 0.5) {
        // Spacer retirement may already clamp native scrollTop at the bottom.
        // Rebase to an absolute destination, never add the same delta twice.
        const options = { top: nativeTop + correction, behavior: 'instant' }
        if (scrollOwner) scrollOwner.scrollTo(options)
        else viewWindow.scrollTo(options)
      }
    }
    if (logicalCoordinates.scale === 1) editorDom.style.overflowAnchor = originalOverflowAnchor
    for (const [name, value] of [['logical-height', logicalCoordinates.logicalHeight], ['physical-height', logicalCoordinates.physicalHeight], ['scroll-scale', logicalCoordinates.scale]]) {
      if (editorDom.getAttribute(`data-ld-${name}`) !== String(value)) editorDom.setAttribute(`data-ld-${name}`, String(value))
    }
    visiblePages.clear()
    nextPages.forEach(page => visiblePages.add(page))
    visibleGroups.clear()
    next.forEach(group => visibleGroups.add(group))
    const count = String(nextPages.size)
    if (editorDom.getAttribute('data-ld-active-pages') !== count) editorDom.setAttribute('data-ld-active-pages', count)
    const rendered = String([...next].reduce((sum, group) => sum + group.nodes.length, 0))
    if (editorDom.getAttribute('data-ld-rendered-blocks') !== rendered) editorDom.setAttribute('data-ld-rendered-blocks', rendered)
    notifyRenderWindow()
    } finally { refreshingViewport = false }
    if ((measuredNewWindow || ownerChanged) && pass < 2) refreshViewport(pass + 1)
  }
  const onResize = () => {
    if (destroyed || !active || printing) return
    scrollOwner = findScrollOwner()
    scrollOwnerChecked = true
    ownerGeometryChecked = false
    const width = editorDom.getBoundingClientRect().width
    if (width === layoutWidth) { refreshViewport(); return }
    layoutWidth = width
    coordinatesDirty = true
    groups.forEach(group => {
      if (visibleGroups.has(group)) { group.measureDirty = true; return }
      group.measuredHeight = undefined
      group.layoutHeight = undefined
      group.element.style.setProperty('--segment-height', `${Math.max(1, group.height)}px`)
    })
    pages.forEach(updatePageSize)
    refreshViewport()
  }
  // DOM 侧高度标尺：虚拟滚动时给未渲染的段落垫高度，数值比模型侧估算大，
  // 因为这里对的是真实盒高而不是结构推断。两套标尺互不引用。
  const estimate = node => {
    const tag = node.nodeName
    return tag === 'P' ? 360 : tag === 'H1' ? 102 : /^H[2-6]$/.test(tag) ? 90 : tag === 'IMG' || tag === 'FIGURE' ? 212 : tag === 'TABLE' ? 132 : 200
  }
  function renderGroup(group, value) {
    if (group.rendered === value && !group.slotDirty) return
    if (!value && visibleGroups.has(group)) measureGroup(group)
    if (value && !group.rendered) group.measureDirty = true
    group.slot.assign(...(value ? group.nodes : []))
    renderVersion += 1
    group.element.classList.toggle('is-visible', value)
    group.rendered = value
    group.slotDirty = false
  }
  function measureGroup(group) {
    if (!group.rendered || !group.measureDirty) return
    const height = group.element.getBoundingClientRect().height
    group.measureDirty = false
    if (!height || !group.height) return
    if (height === group.measuredHeight) return
    group.measuredHeight = height
    coordinatesDirty = true
    group.element.style.setProperty('--segment-height', `${height}px`)
    if (group.page) updatePageSize(group.page)
  }
  const createGroup = (nodes, before = null) => {
    const element = document.createElement('div')
    element.className = 'segment'
    const slot = document.createElement('slot')
    element.appendChild(slot)
    ;(before?.parentNode || shadow).insertBefore(element, before)
    const group = { element, slot, nodes }
    renderOwners.set(element, group)
    return group
  }
  const isHidden = node => node.nodeType === 1 && (node.hidden || node.style.display === 'none')
  const syncVisibility = (group, resetSize = false) => {
    const height = group.nodes.reduce((sum, node) => sum + (isHidden(node) ? 0 : estimate(node)), 0)
    if ((resetSize || height !== group.height) && !visibleGroups.has(group)) group.measuredHeight = undefined
    group.height = height
    coordinatesDirty = true
    group.layoutHeight = undefined
    if (resetSize) group.resetSize = true
    group.element.style.display = height ? '' : 'none'
    group.element.style.setProperty('--segment-height', `${Math.max(1, groupHeight(group))}px`)
    // A remembered auto size must not leave a spacer after folding children.
    if (resetSize && !windowed) group.element.style.containIntrinsicSize = `${Math.max(1, height)}px`
  }
  const assign = group => {
    group.nodes.forEach(node => { owner.set(node, group); hidden.set(node, isHidden(node)) })
    group.slotDirty = true
    group.measureDirty = true
    renderGroup(group, !windowed || !active || printing || visibleGroups.has(group))
    syncVisibility(group)
  }
  const syncPages = () => {
    const selection = selectionSnapshot()
    visibleGroups.forEach(measureGroup)
    const next = []
    groups.forEach((group, index) => { group.index = index })
    coordinatesDirty = true
    for (let index = 0; index < groups.length; index += 32) {
      const members = groups.slice(index, index + 32), previous = pages[next.length]
      const height = members.reduce((sum, group) => sum + group.height, 0)
      const changed = !previous || previous.height !== height || members.length !== previous.groups.length
        || members.some((group, at) => group !== previous.groups[at] || group.resetSize)
      let page = previous
      if (!page) {
        const element = document.createElement('div')
        element.className = 'render-page'
        page = { element, groups: [], skipped: false }
        pageOwners.set(element, page)
        element.addEventListener('contentvisibilityautostatechange', event => {
          if (destroyed || windowed || event.target !== element) return
          page.skipped = event.skipped
          if (!event.skipped) element.style.containIntrinsicSize = ''
        })
        shadow.appendChild(element)
      }
      if (changed) {
        // Keep the editing container and unaffected slots in place. Replacing
        // a wrapper that contains the native caret can drop the next input.
        let cursor = page.element.firstChild
        members.forEach(group => {
          if (group.element !== cursor) page.element.insertBefore(group.element, cursor)
          cursor = group.element.nextSibling
        })
        while (cursor) { const next = cursor.nextSibling; cursor.remove(); cursor = next }
        page.groups = members
        page.height = height
        page.measuredHeight = undefined
        page.element.style.setProperty('--page-height', `${Math.max(1, height)}px`)
        page.element.style.display = height ? '' : 'none'
        // Hidden pages need an updated fallback after folding. When they
        // become visible, native auto sizing resumes and remembers real size.
        page.element.style.containIntrinsicSize = !windowed && page.skipped ? `${Math.max(1, height)}px` : ''
      }
      members.forEach(group => {
        group.resetSize = false
        group.page = page
        renderGroup(group, !windowed || !active || printing || visibleGroups.has(group))
      })
      page.index = next.length
      if (windowed) updatePageSize(page)
      next.push(page)
    }
    pages.slice(next.length).forEach(page => { visiblePages.delete(page); page.element.remove() })
    pages.splice(0, pages.length, ...next)
    const count = String(pages.length)
    if (editorDom.getAttribute('data-ld-render-pages') !== count) editorDom.setAttribute('data-ld-render-pages', count)
    refreshViewport()
    restoreSelection(selection, true)
  }
  const countGroups = () => editorDom.setAttribute('data-ld-render-segments', String(groups.length))
  const rebuild = () => {
    const selection = selectionSnapshot()
    owner = new WeakMap()
    hidden = new WeakMap()
    groups.splice(0).forEach(group => group.element.remove())
    resizeObserver?.disconnect()
    visiblePages.clear()
    visibleGroups.clear()
    pages.splice(0).forEach(page => page.element.remove())
    const nodes = Array.from(editorDom.childNodes).filter(node => node.nodeType === 1 || node.nodeType === 3)
    for (let index = 0; index < nodes.length; index += segmentBlocks) {
      const group = createGroup(nodes.slice(index, index + segmentBlocks))
      groups.push(group)
      assign(group)
    }
    syncPages()
    countGroups()
    restoreSelection(selection, true)
  }
  const applyMutations = records => {
    if (destroyed) return
    const visibility = new Set()
    const resized = new Set()
    records.forEach(record => {
      let node = record.target
      while (node?.parentNode && node.parentNode !== editorDom) node = node.parentNode
      const group = currentOwner(node)
      if (group && visibleGroups.has(group)) group.measureDirty = true
      if (group && !visibleGroups.has(group) && group.measuredHeight !== undefined) {
        group.measuredHeight = undefined
        group.layoutHeight = undefined
        coordinatesDirty = true
        group.element.style.setProperty('--segment-height', `${Math.max(1, group.height)}px`)
        resized.add(group.page)
      }
      if (record.type !== 'attributes' || record.target.parentNode !== editorDom) return
      const target = record.target, next = isHidden(target)
      if (group && next !== hidden.get(target)) { hidden.set(target, next); visibility.add(group) }
    })
    visibility.forEach(group => syncVisibility(group, true))
    if (visibility.size) syncPages()
    else if (resized.size) { resized.forEach(updatePageSize); refreshViewport() }
    records = records.filter(record => record.type === 'childList' && record.target === editorDom)
    if (!records.length) return
    const addedCount = records.reduce((count, record) => count + record.addedNodes.length, 0)
    const removedCount = records.reduce((count, record) => count + record.removedNodes.length, 0)
    // Import pages append a bounded suffix. Keep its existing slots instead of
    // rebuilding all preceding windows for every 128-block page.
    if (addedCount + removedCount > segmentBlocks * 4 && (removedCount || addedCount > 512)) { rebuild(); return }
    const selection = selectionSnapshot()
    const dirty = new Set()
    records.forEach(record => record.removedNodes.forEach(node => {
      const group = currentGroup(owner.get(node))
      if (!group) return
      group.nodes = group.nodes.filter(item => item !== node)
      owner.delete(node)
      dirty.add(group)
    }))
    const added = new Set()
    records.forEach(record => record.addedNodes.forEach(node => added.add(node)))
    added.forEach(node => {
      if (node.parentNode !== editorDom || (node.nodeType !== 1 && node.nodeType !== 3)) return
      let previousNode = node.previousSibling
      let nextNode = node.nextSibling
      while (previousNode && !currentOwner(previousNode)) previousNode = previousNode.previousSibling
      while (nextNode && !currentOwner(nextNode)) nextNode = nextNode.nextSibling
      let group = currentOwner(previousNode) || currentOwner(nextNode) || groups[0]
      if (!group) { group = createGroup([]); groups.push(group) }
      const previous = group.nodes.indexOf(previousNode)
      const next = group.nodes.indexOf(nextNode)
      group.nodes.splice(previous >= 0 ? previous + 1 : next >= 0 ? next : node.previousSibling ? group.nodes.length : 0, 0, node)
      owner.set(node, group)
      dirty.add(group)
    })
    dirty.forEach(group => {
      if (!group.nodes.length) {
        group.element.remove()
        groups.splice(groups.indexOf(group), 1)
        return
      }
      while (group.nodes.length > segmentBlocks * 2) {
        const split = createGroup(group.nodes.splice(segmentBlocks), group.element.nextSibling)
        groups.splice(groups.indexOf(group) + 1, 0, split)
        assign(split)
        if (split.nodes.length > segmentBlocks * 2) dirty.add(split)
      }
      assign(group)
    })
    syncPages()
    countGroups()
    restoreSelection(selection, true)
  }
  function syncMutations(records) {
    if (destroyed) return
    handlingMutations = true
    try { applyMutations(records) } finally { handlingMutations = false }
  }
  function flushProjection() {
    if (destroyed || handlingMutations) return false
    const pending = observer.takeRecords()
    if (!pending.length) return false
    const changed = pending.some(record => record.type === 'childList' && record.target === editorDom && (record.addedNodes.length || record.removedNodes.length))
    syncMutations(pending)
    return changed
  }
  const observer = new viewWindow.MutationObserver(syncMutations)
  const revealNode = node => {
    if (destroyed || !node || !editorDom.contains(node)) return
    while (node.parentNode && node.parentNode !== editorDom) node = node.parentNode
    if (windowed && !scrollOwner) scrollOwner = findScrollOwner()
    revealedNode = node
    refreshViewport()
  }
  const onKeyDown = event => {
    if (!active || destroyed || printing || event.defaultPrevented || event.isComposing || event.altKey) return
    const end = event.ctrlKey && event.key === 'End' || event.metaKey && event.key === 'ArrowDown'
    const start = event.ctrlKey && event.key === 'Home' || event.metaKey && event.key === 'ArrowUp'
    if (!end && !start) return
    const control = event.target?.closest?.('input,textarea,select,button,[contenteditable="false"]')
    if (control && editorDom.contains(control)) return
    // Keep native caret/Shift selection semantics; supply its destination first.
    refreshViewport()
    for (let index = end ? groups.length - 1 : 0; index >= 0 && index < groups.length; index += end ? -1 : 1) {
      const group = groups[index]
      if (!group.height) continue
      const nodes = end ? group.nodes.slice().reverse() : group.nodes
      const node = nodes.find(node => node.parentNode === editorDom && !isHidden(node))
      if (node) { revealNode(node); return }
    }
  }
  const beforePrint = () => {
    if (destroyed) return
    printing = true
    groups.forEach(group => renderGroup(group, true))
    notifyRenderWindow()
  }
  const afterPrint = () => {
    if (destroyed) return
    printing = false
    groups.forEach(group => renderGroup(group, !active || visibleGroups.has(group)))
    refreshViewport()
  }
  rebuild()
  restoreSelection(initialSelection)
  observer.observe(editorDom, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['style', 'hidden'] })
  if (windowed) {
    editorDom.addEventListener('keydown', onKeyDown, true)
    viewWindow.addEventListener('scroll', refreshViewport, { capture: true, passive: true })
    viewWindow.addEventListener('resize', onResize)
    viewWindow.addEventListener('beforeprint', beforePrint)
    viewWindow.addEventListener('afterprint', afterPrint)
  }
  return {
    flushProjection,
    refresh: refreshViewport,
    getScrollCoordinates: () => logicalCoordinates,
    getRenderedBlocks: renderedBlocks,
    prepareSelection(nodes) {
      if (destroyed || !active || !windowed) return
      if (!scrollOwner) scrollOwner = findScrollOwner()
      preparedSelection = nodes.filter(node => node && editorDom.contains(node))
      preparingSelection = true
      try { refreshViewport() } finally { preparingSelection = false }
    },
    completeSelection() {
      if (!preparedSelection.length) return
      preparedSelection = []
      refreshViewport()
    },
    revealNode,
    setActive(value) {
      if (destroyed) return
      const selection = selectionSnapshot(), changed = active !== !!value
      active = !!value
      editorDom.classList.toggle('lark-doc-segment-layout', active)
      if (active) {
        if (changed && windowed && !printing) groups.forEach(group => renderGroup(group, false))
        refreshViewport()
        if (changed) restoreSelection(selection, true)
      }
      else {
        logicalCoordinates = null
        coordinateGroups = []
        coordinatesDirty = true
        scrollOwnerChecked = false
        ownerGeometryChecked = false
        editorDom.style.overflowAnchor = originalOverflowAnchor
        for (const name of ['logical-height', 'physical-height', 'scroll-scale']) editorDom.removeAttribute(`data-ld-${name}`)
        revealedNode = null
        preparedSelection = []
        groups.forEach(group => renderGroup(group, true))
        resizeObserver?.disconnect()
        visiblePages.forEach(page => page.element.classList.remove('is-visible'))
        visiblePages.clear()
        visibleGroups.clear()
        editorDom.removeAttribute('data-ld-active-pages')
        editorDom.removeAttribute('data-ld-rendered-blocks')
        notifyRenderWindow()
        try { getSelectionNodes?.() } catch (_) { /* Clear a replaced view's cached selection when its DOM is ready. */ }
      }
    },
    blockAtPoint(left, top) {
      if (destroyed) return null
      const hit = shadow.elementFromPoint?.(left, top)
      if (hit && hit !== editorDom && editorDom.contains(hit)) return hit
      let group = renderOwners.get(hit?.closest?.('.segment'))
      if (!group) {
        const page = pageOwners.get(hit?.closest?.('.render-page'))
        for (const candidate of page?.groups || []) {
          if (candidate.element.style.display === 'none') continue
          group = candidate
          if (candidate.element.getBoundingClientRect().bottom > top) break
        }
      }
      if (!group) return null
      let last = null
      for (const node of group.nodes) {
        if (node.nodeType !== 1 || isHidden(node)) continue
        last = node
        if (node.getBoundingClientRect().bottom > top) return node
      }
      return last
    },
    destroy() {
      destroyed = true
      logicalCoordinates = null
      coordinateGroups = []
      editorDom.style.overflowAnchor = originalOverflowAnchor
      for (const name of ['logical-height', 'physical-height', 'scroll-scale']) editorDom.removeAttribute(`data-ld-${name}`)
      revealedNode = null
      preparedSelection = []
      groups.forEach(group => renderGroup(group, true))
      observer.disconnect()
      resizeObserver?.disconnect()
      if (viewportFrame !== null) viewWindow.cancelAnimationFrame(viewportFrame)
      viewWindow.removeEventListener('scroll', refreshViewport, true)
      editorDom.removeEventListener('keydown', onKeyDown, true)
      viewWindow.removeEventListener('resize', onResize)
      viewWindow.removeEventListener('beforeprint', beforePrint)
      viewWindow.removeEventListener('afterprint', afterPrint)
      editorDom.classList.remove('lark-doc-segment-layout')
      editorDom.removeAttribute('data-ld-render-segments')
      editorDom.removeAttribute('data-ld-render-pages')
      editorDom.removeAttribute('data-ld-active-pages')
      editorDom.removeAttribute('data-ld-rendered-blocks')
    },
  }
}

/** Keep segment metadata on the ProseMirror root; never mutate child nodes. */
export function createLargeDocumentViewportController({ editorDom, model, viewWindow: providedViewWindow } = {}) {
  let destroyed = false
  let currentModel = model
  const viewWindow = providedViewWindow || editorDom?.ownerDocument?.defaultView || (typeof window !== 'undefined' ? window : null)
  const overscanSegments = 2
  let frame = null
  let activeStart = -1
  let activeEnd = -1

  const scrollTop = () => Number(viewWindow?.scrollY || viewWindow?.pageYOffset || viewWindow?.document?.documentElement?.scrollTop || 0)
  let cachedRootTop = 0
  const updateRootTop = () => {
    const rect = editorDom?.getBoundingClientRect?.()
    cachedRootTop = rect ? rect.top + scrollTop() : 0
    return cachedRootTop
  }
  const segmentAtOffset = (offset) => {
    const tops = currentModel?.segmentTops || []
    if (tops.length < 2) return 0
    let low = 0
    let high = tops.length - 2
    while (low <= high) {
      const middle = (low + high) >> 1
      if (tops[middle + 1] <= offset) low = middle + 1
      else if (tops[middle] > offset) high = middle - 1
      else return middle
    }
    return Math.max(0, Math.min(tops.length - 2, low))
  }
  const setActiveRange = (start, end) => {
    if (destroyed || !editorDom || !currentModel) return
    const max = Math.max(0, currentModel.segmentCount - 1)
    const nextStart = Math.max(0, Math.min(max, Number(start) || 0))
    const nextEnd = Math.max(nextStart, Math.min(max, Number(end) || 0))
    if (nextStart === activeStart && nextEnd === activeEnd) return
    activeStart = nextStart
    activeEnd = nextEnd
    editorDom.setAttribute('data-ld-viewport-start', String(nextStart))
    editorDom.setAttribute('data-ld-viewport-end', String(nextEnd))
  }
  const apply = () => {
    frame = null
    if (destroyed || !currentModel || !editorDom) return
    const segmentCount = String(currentModel.segmentCount)
    const segmentBlocks = String(currentModel.segmentBlocks)
    if (editorDom.getAttribute('data-ld-segment-count') !== segmentCount) editorDom.setAttribute('data-ld-segment-count', segmentCount)
    if (editorDom.getAttribute('data-ld-segment-blocks') !== segmentBlocks) editorDom.setAttribute('data-ld-segment-blocks', segmentBlocks)
    const viewportTop = Math.max(0, scrollTop() - cachedRootTop - (viewWindow?.innerHeight || 900))
    const viewportBottom = Math.max(viewportTop, scrollTop() - cachedRootTop + (viewWindow?.innerHeight || 900) * 2)
    const first = segmentAtOffset(viewportTop)
    const last = segmentAtOffset(viewportBottom)
    setActiveRange(first - overscanSegments, last + overscanSegments)
    if (!editorDom.classList.contains('lark-doc-viewport-managed')) editorDom.classList.add('lark-doc-viewport-managed')
  }
  const schedule = () => {
    if (destroyed || frame != null) return
    frame = viewWindow?.requestAnimationFrame ? viewWindow.requestAnimationFrame(apply) : setTimeout(apply, 16)
  }
  const onScroll = () => schedule()
  const onResize = () => { updateRootTop(); schedule() }
  viewWindow?.addEventListener?.('scroll', onScroll, { capture: true, passive: true })
  viewWindow?.addEventListener?.('resize', onResize, { passive: true })
  if (editorDom && currentModel) {
    updateRootTop()
    setActiveRange(0, Math.min(currentModel.segmentCount - 1, overscanSegments * 2))
    apply()
  }
  return {
    refresh(nextModel = currentModel) {
      if (nextModel !== currentModel) {
        activeStart = -1
        activeEnd = -1
      }
      currentModel = nextModel || currentModel
      updateRootTop()
      apply()
    },
    ensureForPos(pos) {
      if (destroyed || !currentModel) return
      const segment = currentModel.segmentForPos(pos)
      if (!segment) return
      setActiveRange(segment.index - overscanSegments, segment.index + overscanSegments)
    },
    destroy() {
      destroyed = true
      if (frame != null) {
        if (viewWindow?.cancelAnimationFrame && typeof frame === 'number') viewWindow.cancelAnimationFrame(frame)
        else clearTimeout(frame)
      }
      viewWindow?.removeEventListener?.('scroll', onScroll, true)
      viewWindow?.removeEventListener?.('resize', onResize)
      editorDom?.classList.remove('lark-doc-viewport-managed')
      editorDom?.removeAttribute('data-ld-segment-count')
      editorDom?.removeAttribute('data-ld-segment-blocks')
      editorDom?.removeAttribute('data-ld-viewport-start')
      editorDom?.removeAttribute('data-ld-viewport-end')
    },
  }
}
