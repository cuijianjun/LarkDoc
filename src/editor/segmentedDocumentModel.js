/**
 * Large-document layout hints.
 *
 * Feishu-like editors keep a block index separate from the rich-text tree so
 * viewport work can use compact records instead of walking every node. The
 * ProseMirror DOM remains complete here; the model only supplies intrinsic
 * sizes and stable segment boundaries, which keeps selection and mapping
 * semantics unchanged.
 */

export const LARGE_DOCUMENT_SEGMENT_BLOCKS = 128

const MIN_HEIGHT = 40
const MAX_HEIGHT = 4096

function clamp(value, min = MIN_HEIGHT, max = MAX_HEIGHT) {
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

function createDescriptors(doc) {
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
      intrinsicSize: estimateBlockHeight({ type, textLength, ...shape }),
      segment: -1,
    })
    from += nodeSize
  }
  return { nodeSizes, textLengths, headings, flags, blockTypes, blocks }
}

function computeSegmentMetadata({ nodeSizes, textLengths, headings, flags, blockTypes, segmentBlocks = LARGE_DOCUMENT_SEGMENT_BLOCKS }) {
  const count = nodeSizes.length
  const heights = new Uint16Array(count)
  const positions = new Uint32Array(count + 1)
  const segments = []
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
  }
  return { heights, segments }
}

function workerSource() {
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
  }
  self.postMessage({type:'segments',heights,segments},[heights.buffer]);
};`
}

function defaultWorkerFactory() {
  if (typeof Worker === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function' || typeof Blob === 'undefined') return null
  const url = URL.createObjectURL(new Blob([workerSource()], { type: 'text/javascript' }))
  try { return new Worker(url) } finally { URL.revokeObjectURL(url) }
}

export function createSegmentedDocumentModel(doc, { segmentBlocks = LARGE_DOCUMENT_SEGMENT_BLOCKS } = {}) {
  const descriptors = createDescriptors(doc)
  const computed = computeSegmentMetadata({ ...descriptors, segmentBlocks })
  for (let index = 0; index < descriptors.blocks.length; index += 1) descriptors.blocks[index].intrinsicSize = computed.heights[index]
  computed.segments.forEach(segment => {
    for (let index = segment.blockStart; index < segment.blockEnd; index += 1) descriptors.blocks[index].segment = segment.index
  })
  const model = {
    doc,
    segmentBlocks,
    blocks: descriptors.blocks,
    segments: computed.segments,
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

export function createSegmentedDocumentReader({ workerFactory = defaultWorkerFactory } = {}) {
  return {
    async read(model, { signal } = {}) {
      if (!model || signal?.aborted) return null
      let worker = null
      try { worker = workerFactory() } catch (_) { worker = null }
      const descriptors = model.descriptors()
      if (!worker) return computeSegmentMetadata(descriptors)
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
      return result || (signal?.aborted ? null : computeSegmentMetadata(descriptors))
    },
  }
}

/** Keep segment metadata on the ProseMirror root; never mutate child nodes. */
export function createLargeDocumentViewportController({ editorDom, model } = {}) {
  let destroyed = false
  let generation = 0
  let currentModel = model
  const apply = () => {
    if (destroyed || !currentModel || !editorDom) return
    const run = ++generation
    editorDom.setAttribute('data-ld-segment-count', String(currentModel.segmentCount))
    editorDom.setAttribute('data-ld-segment-blocks', String(currentModel.segmentBlocks))
    if (destroyed || run !== generation) return
  }
  return {
    refresh(nextModel = currentModel) {
      currentModel = nextModel || currentModel
      apply()
    },
    destroy() {
      destroyed = true
      generation += 1
    },
  }
}
