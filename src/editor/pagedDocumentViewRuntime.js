/** Private paged view implementation. The original runtime supplies every PM/core reference.
 * The factory captures no editor or session; per-editor state starts in preparePagedDocumentView.
 */
export function createPagedDocumentViewRuntime(dependencies) {
  const { Fragment, DOMSerializer, NodeRange, Slice,
  EditorState, Selection, TextSelection,
  Decoration, joinBackward, joinForward,
  getTextBetween, getTextSerializersFromSchema,
  createBlockId, collectFoldRanges, computeHeadingNumbers, computeOrderedListNumbers, computeBulletItems, findTextMatches,
  isTextOnlyChange, PAGED_IMPORT_META, createLogicalScrollCoordinates } = dependencies

  const PAGE = 'documentSegment'
  const NORMALIZE = 'lark-doc-page-shape'
  const isPage = node => node?.type.name === PAGE

  // Recognize formatting steps by their actual envelope. Unknown/custom steps
  // retain full validation; a same-size replacement alone is never trusted.
  function localMarkupRanges(tr) {
    if (!tr.steps?.length) return null
    const ranges = []
    for (let index = 0; index < tr.steps.length; index++) {
      const step = tr.steps[index], doc = tr.docs[index]
      if (step.jsonID === 'addMark' || step.jsonID === 'removeMark') {
        ranges.push({ from: step.from, to: step.to }); continue
      }
      const pos = step.jsonID === 'attr' ? step.pos : step.from
      const node = Number.isInteger(pos) ? doc.nodeAt(pos) : null
      if (!node?.isTextblock) return null
      if (step.jsonID === 'attr' && step.attr !== 'blockId') {
        ranges.push({ from: pos + 1, to: pos + node.nodeSize - 1 }); continue
      }
      const shell = step.slice?.content?.firstChild
      if (step.jsonID !== 'replaceAround' || !step.structure || step.gapFrom !== pos + 1 ||
        step.gapTo !== pos + node.nodeSize - 1 || step.to !== pos + node.nodeSize ||
        step.slice.content.childCount !== 1 || !shell?.isTextblock || shell.content.size || shell.attrs.blockId !== node.attrs.blockId) return null
      ranges.push({ from: pos + 1, to: pos + node.nodeSize - 1 })
    }
    return ranges
  }


  /** Scroll the actual selected line without moving focus out of a search field. */
  function scrollDocumentSelection(editor, match = null) {
    const root = editor.view.dom, owner = root.ownerDocument, win = owner.defaultView
    const shell = match?.attribute ? editor.view.nodeDOM(match.from) : null
    const caption = shell?.querySelector?.('.lark-doc-code-caption, .lark-doc-image-caption-text')
    const captionRect = caption?.getBoundingClientRect()
    const rect = captionRect?.height ? captionRect : editor.view.coordsAtPos(editor.state.selection.head)
    if (rect.bottom <= rect.top) return
    let scrollOwner = root.parentElement
    while (scrollOwner && scrollOwner !== owner.body && !(scrollOwner.scrollHeight > scrollOwner.clientHeight + 1 && /(auto|scroll|overlay)/.test(win.getComputedStyle(scrollOwner).overflowY))) scrollOwner = scrollOwner.parentElement
    if (scrollOwner === owner.body) scrollOwner = null
    const bounds = scrollOwner?.getBoundingClientRect(), toolbar = root.closest('.lark-doc')?.querySelector('.lark-doc-toolbar')
    const top = Math.max(0, bounds?.top || 0, toolbar?.getBoundingClientRect().bottom || 0) + 5
    const bottom = Math.min(win.innerHeight, bounds?.bottom || win.innerHeight)
    const delta = (rect.top + rect.bottom - top - bottom) / 2
    if (Math.abs(delta) > 1) (scrollOwner || win).scrollBy({ top: delta, behavior: 'instant' })
  }

  /** Full immutable state, bounded editable DOM. Inactive node views have no contentDOM. */
  function preparePagedDocumentView(editor) {
    if (editor.storage.larkDoc.pagedView) return editor.storage.larkDoc.pagedView
    const root = editor.view.dom, owner = root.ownerDocument, win = owner.defaultView
    const pages = new Map(), heights = new Map(), heightFolds = new Map(), logicalCache = new WeakMap()
    let estimates = new WeakMap(), width = root.clientWidth || 800, printing = false, printAnchor, printOwner
    let foldKey = '', foldBase, foldRatios = new Map()
    const original = { getJSON: editor.getJSON, getHTML: editor.getHTML, getText: editor.getText }
    const paper = root.closest('.lark-doc-paper')
    const paintSurfaces = [...new Set([root, paper].filter(Boolean))].map(dom => ({ dom, original: dom.style.clipPath || '', clip: null, from: null, to: null }))
    let paintEnabled = true
    let slotProjection = null
    const siblingCache = new WeakMap()
    const pageOffsets = new WeakMap()
    const siblings = (doc, resolved) => {
      if (resolved && !isPage(resolved.parent) || doc.type.name !== 'doc' || !isDocument(doc)) return null
      if (!siblingCache.has(doc)) {
        const groups = []
        let count = 0, recent
        doc.forEach((page, pos) => {
          const size = isPage(page) ? page.childCount : 1
          groups.push({ node: page, pos, index: count, end: count + size })
          count += size
        })
        const groupAt = index => {
          if (recent && index >= recent.index && index < recent.end) return recent
          let low = 0, high = groups.length - 1
          while (low < high) {
            const middle = (low + high) >>> 1
            if (groups[middle].end <= index) low = middle + 1
            else high = middle
          }
          return recent = groups[low]
        }
        const offsets = page => {
          if (!pageOffsets.has(page)) {
            const values = []; page.forEach((_node, pos) => values.push(pos))
            pageOffsets.set(page, values)
          }
          return pageOffsets.get(page)
        }
        siblingCache.set(doc, { type: doc.type, content: doc.content, childCount: count,
          child(index) { const group = groupAt(index); return isPage(group.node) ? group.node.child(index - group.index) : group.node },
          positionAt(index) { const group = groupAt(index); return isPage(group.node) ? group.pos + 1 + offsets(group.node)[index - group.index] : group.pos },
          indexAt(position) {
            let low = 0, high = groups.length - 1
            while (low < high) {
              const middle = (low + high + 1) >>> 1
              if (groups[middle].pos > position) high = middle - 1
              else low = middle
            }
            const group = groups[low]
            if (!group) return undefined
            if (!isPage(group.node)) return position === group.pos ? group.index : undefined
            const relative = position - group.pos - 1
            if (relative < 0 || relative >= group.node.content.size) return undefined
            const found = group.node.content.findIndex(relative)
            return found.offset === relative ? group.index + found.index : undefined
          },
        })
      }
      return siblingCache.get(doc)
    }
    editor.schema.cached.segmentSiblings = siblings
    let docCache, entries = [], indices = new Map(), map = null, mapEntries = [], mapDirty = true, mappedVisible = new Set()
    let active = new Set(), revealed = new Set(), ownerScroll = null, anchor = null
    let spacerHeights = new Map()
    let refreshing = false, frame = null, destroyed = false, callback, version = 0, notified = -1
    let navigationFrame = null
    let observationPaused = false, observerResumeFrame = null
    let paintedDoc = null, paintedFold = ''
    let decoratedDoc, decoratedBase, decoratedVisible = new Set(), decorated
    const isDocument = doc => doc.content.content.some(isPage)
    let documentAnalysis = null, searchDoc, searchQuery, searchResult, searchVersion = 0
    const analysisSteps = [['foldRanges', collectFoldRanges], ['headingNumbers', computeHeadingNumbers],
      ['orderedListNumbers', computeOrderedListNumbers], ['bulletItems', computeBulletItems]]
    const resolver = doc => doc.type?.schema?.cached?.segmentSiblings
    const readAnalysis = doc => {
      if (!isDocument(doc)) { documentAnalysis = null; return null }
      if (!documentAnalysis || documentAnalysis.doc !== doc || documentAnalysis.resolver !== resolver(doc)) documentAnalysis = { doc, resolver: resolver(doc) }
      for (const [name, compute] of analysisSteps) if (!documentAnalysis[name]) documentAnalysis[name] = name === 'foldRanges' ? compute(doc, documentAnalysis.foldIndex = new Map()) : compute(doc)
      return documentAnalysis
    }
    const mapAnalysis = (tr, markupRanges) => {
      if (markupRanges && documentAnalysis?.doc === tr.before && documentAnalysis.resolver === resolver(tr.doc)) {
        if (tr.steps.every(step => step.jsonID === 'addMark' || step.jsonID === 'removeMark')) {
          documentAnalysis = { ...documentAnalysis, doc: tr.doc, precise: true }
          return []
        }
        const previous = documentAnalysis, next = { doc: tr.doc, resolver: resolver(tr.doc), precise: true }
        const changed = []
        const listChange = markupRanges.some(range => {
          const at = tr.before.resolve(range.from)
          for (let depth = at.depth - 1; depth > 0; depth--) if (['listItem', 'taskItem'].includes(at.node(depth).type.name)) return true
          return false
        })
        const stableStructure = !listChange && markupRanges.every(range => {
          const before = tr.before.nodeAt(range.from - 1), after = tr.doc.nodeAt(range.from - 1)
          return before && after && ['paragraph', 'heading'].includes(before.type.name) && ['paragraph', 'heading'].includes(after.type.name)
            && before.attrs.indent === after.attrs.indent && before.attrs.blockId === after.attrs.blockId
            && !before.attrs.numbering && !after.attrs.numbering
        })
        if (stableStructure) {
          const folds = new Map(previous.foldRanges)
          for (const range of markupRanges) {
            const pos = range.from - 1, fold = folds.get(pos)
            if (fold) folds.set(pos, { ...fold, node: tr.doc.nodeAt(pos) })
          }
          documentAnalysis = { ...previous, doc: tr.doc, precise: true, foldRanges: folds }
          return []
        }
        for (const [name, compute] of analysisSteps) {
          if (!listChange && (name === 'orderedListNumbers' || name === 'bulletItems')) { next[name] = previous[name]; continue }
          next[name] = name === 'foldRanges' ? compute(tr.doc, next.foldIndex = new Map()) : compute(tr.doc)
          const old = previous[name]
          if (!old) continue
          const different = (left, right) => !left || !right || (name === 'foldRanges' ? left.from !== right.from || left.to !== right.to || left.node.type !== right.node.type || left.node.attrs !== right.node.attrs : JSON.stringify(left) !== JSON.stringify(right))
          for (const pos of new Set([...old.keys(), ...next[name].keys()])) {
            if (!different(old.get(pos), next[name].get(pos))) continue
            const node = tr.doc.nodeAt(pos)
            if (node) changed.push({ from: pos, to: pos + node.nodeSize })
          }
        }
        documentAnalysis = next
        return changed
      }
      // Single-step text edits keep the block hierarchy/numbering unchanged.
      // Other steps conservatively rebuild; their coordinates may differ.
      if (!documentAnalysis || documentAnalysis.doc !== tr.before || documentAnalysis.resolver !== resolver(tr.doc) ||
        tr.steps.length !== 1 || !isTextOnlyChange(tr.before, tr.steps)) { documentAnalysis = null; return }
      const next = { doc: tr.doc, resolver: resolver(tr.doc) }, step = tr.steps[0]
      for (const [name] of analysisSteps) {
        if (!documentAnalysis[name]) continue
        const entries = new Map()
        for (const [pos, value] of documentAnalysis[name]) {
          const at = tr.mapping.mapResult(pos, 1)
          if (at.deleted) { documentAnalysis = null; return }
          let item = value
          if (name === 'foldRanges') {
            const touched = step.from <= pos + value.node.nodeSize && step.to >= pos
            const node = touched ? tr.doc.nodeAt(at.pos) : value.node
            if (!node) { documentAnalysis = null; return }
            item = { ...value, node, from: tr.mapping.map(value.from, 1), to: tr.mapping.map(value.to, -1) }
          }
          entries.set(at.pos, item)
        }
        next[name] = entries
      }
      if (documentAnalysis.foldIndex) {
        next.foldIndex = new Map()
        for (const [id, pos] of documentAnalysis.foldIndex) {
          const at = tr.mapping.mapResult(pos, 1)
          if (at.deleted) { documentAnalysis = null; return }
          next.foldIndex.set(id, at.pos)
        }
      }
      documentAnalysis = next
      return []
    }
    const prepareAnalysis = async (yieldToMain, check) => {
      check()
      const memo = { doc: editor.state.doc, resolver: resolver(editor.state.doc) }
      documentAnalysis = memo
      try {
        for (const [name, compute] of analysisSteps) {
          check(); memo[name] = name === 'foldRanges' ? compute(memo.doc, memo.foldIndex = new Map()) : compute(memo.doc)
          await yieldToMain(); check()
          if (editor.state.doc !== memo.doc) throw new Error('正文已发生变化，已取消本次导入')
        }
      } finally { if (documentAnalysis === memo && editor.state.doc !== memo.doc) documentAnalysis = null }
    }
    const logicalDocument = doc => {
      if (!isDocument(doc)) return doc
      if (!logicalCache.has(doc)) logicalCache.set(doc, doc.copy(Fragment.fromArray(doc.content.content.flatMap(node => isPage(node) ? node.content.content : [node]))))
      return logicalCache.get(doc)
    }
    const estimate = node => {
      if (!estimates.has(node)) {
        let value = 0
        node.forEach(child => { value += child.type.name === 'paragraph' ? 56 + Math.ceil(Math.max(0, child.nodeSize - 2) / Math.max(10, width / 16)) * 26 : child.type.name === 'heading' ? 100 : child.type.name === 'image' ? 212 : child.type.name === 'table' ? 160 : 240 })
        estimates.set(node, Math.max(24, value))
      }
      return estimates.get(node)
    }
    const readEntries = doc => {
      if (doc === docCache) return entries
      const previous = new Map(entries.map(entry => [entry.id, entry.node]))
      entries = []; indices = new Map(); docCache = doc
      doc.forEach((node, pos, index) => {
        const id = isPage(node) ? node.attrs.pageId : `flat-${index}`
        if (previous.has(id) && previous.get(id) !== node) { heights.delete(id); heightFolds.delete(id) }
        indices.set(id, entries.length)
        entries.push({ node, pos, id, height: estimate(node) })
      })
      for (const id of heights.keys()) if (!indices.has(id)) { heights.delete(id); heightFolds.delete(id) }
      mapDirty = true
      return entries
    }
    const pageHeight = entry => heights.has(entry.id) && heightFolds.get(entry.id) === foldKey
      ? heights.get(entry.id) : entry.height * (foldRatios.get(entry.id) ?? 1)
    const selected = state => {
      if (printing) return new Set(entries.map(entry => entry.id))
      const result = new Set(active)
      for (const position of [state.selection.from, state.selection.to]) {
        const index = Math.min(state.doc.resolve(position).index(0), entries.length - 1)
        for (let at = Math.max(0, index - 1); at <= Math.min(entries.length - 1, index + 1); at++) result.add(entries[at].id)
      }
      revealed.forEach(id => result.add(id))
      return result
    }
    const consumeRevealed = () => { for (const id of revealed) if (active.has(id)) revealed.delete(id) }
    const updateSpacers = () => {
      // Keep the immutable PM pages, but give each contiguous inactive run one
      // layout box. Thousands of empty page boxes otherwise participate in every
      // cold-page measurement even though their text is already unmounted.
      spacerHeights = new Map()
      let start = -1
      entries.forEach((entry, index) => {
        if (!mappedVisible.has(entry.id)) { if (start < 0) start = index; return }
        if (start >= 0) { spacerHeights.set(entries[start].id, map.top(index) - map.top(start)); start = -1 }
      })
      if (start >= 0) spacerHeights.set(entries[start].id, map.physicalHeight - map.top(start))
      for (const page of pages.values()) {
        const index = indices.get(page.id)
        if (page.active || index === undefined) continue
        const height = spacerHeights.get(page.id) || 0
        // CSS serializes fractional pixels with rounding; compare owned values.
        if (page.spacerHeight !== height) { page.spacerHeight = height; page.dom.style.height = `${height}px` }
        const display = height ? 'block' : 'none'
        if (page.dom.style.display !== display) page.dom.style.display = display
      }
    }
    const coordinates = state => {
      readEntries(state.doc)
      const visible = selected(state)
      if (mapDirty || visible.size !== mappedVisible.size || [...visible].some(id => !mappedVisible.has(id))) {
        map = createLogicalScrollCoordinates(entries.map(pageHeight), entries.flatMap((entry, index) => visible.has(entry.id) ? [index] : []))
        mapEntries = entries.slice(); mappedVisible = visible; mapDirty = false
        updateSpacers()
      }
      return visible
    }
    const findOwner = () => {
      for (let node = root.parentElement; node && node !== owner.body && node !== owner.documentElement; node = node.parentElement) {
        if (/(auto|scroll|overlay)/.test(win.getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight + 1) return node
      }
      return null
    }
    const clearPaintWindow = () => {
      for (const surface of paintSurfaces) {
        if (surface.clip !== null && surface.dom.style.clipPath === surface.clip) surface.dom.style.clipPath = surface.original
        surface.clip = null; surface.from = null; surface.to = null
      }
    }
    const updatePaintWindow = (geometry = null) => {
      if (!paintEnabled || printing || !root.classList.contains('lark-doc-paged-layout')) { clearPaintWindow(); return }
      const ownerTop = ownerScroll ? ownerScroll.getBoundingClientRect().top + ownerScroll.clientTop : 0
      const top = Math.max(0, ownerTop), bottom = Math.min(win.innerHeight, ownerScroll ? ownerTop + ownerScroll.clientHeight : win.innerHeight)
      // Include the paper background/border, which would otherwise rasterize a
      // much larger scroll-interest area even when foreground text is clipped.
      const updates = paintSurfaces.filter(surface => (!surface.original || surface.original === 'none') && surface.dom.style.clipPath === (surface.clip ?? surface.original))
        .map(surface => ({ surface, rect: geometry?.get(surface.dom) || surface.dom.getBoundingClientRect() }))
      for (const { surface, rect } of updates) {
        const from = Math.floor(top - rect.top - 256), to = Math.max(from, Math.ceil(bottom - rect.top + 256))
        // CSSOM shortens inset sides. Compare owned geometry instead of strings.
        if (surface.from !== from || surface.to !== to) surface.dom.style.clipPath = `inset(${from}px -100vw calc(100% - ${to}px) -100vw)`
        surface.from = from; surface.to = to; surface.clip = surface.dom.style.clipPath
      }
    }
    const capture = () => {
      if (!map || !isDocument(editor.state.doc)) return null
      ownerScroll = findOwner()
      const rect = root.getBoundingClientRect(), top = ownerScroll ? ownerScroll.getBoundingClientRect().top + ownerScroll.clientTop : 0
      const offset = Math.max(0, top - rect.top), at = map.anchorAtPhysical(offset)
      return { id: mapEntries[at.index]?.id, offset: at.offset, physical: map.toPhysical(map.logicalTop(at.index) + at.offset),
        owner: ownerScroll, native: ownerScroll ? ownerScroll.scrollTop : win.scrollY, scrolled: rect.top < top }
    }
    const renderedBlocks = () => [...pages.values()].filter(page => page.active).flatMap(page => [...page.dom.children])
    const schedule = () => {
      if (destroyed || refreshing || frame !== null || editor.storage.larkDoc.pagedImport) return
      frame = win.requestAnimationFrame(() => { frame = null; refresh() })
    }
    const onScroll = event => {
      if (destroyed || refreshing || printing || editor.storage.larkDoc.pagedImport || !isDocument(editor.state.doc)) return
      // Scroll events are already frame-aligned. Waiting for another animation
      // frame leaves the old mount/paint window on screen during a fast scroll.
      if (event.target !== win && event.target !== owner && !event.target?.contains?.(root)) return
      if (frame !== null) { win.cancelAnimationFrame(frame); frame = null }
      refresh()
      // RAF clients can scroll again after this event, before painting. Keep one
      // coalesced reconciliation so the clip and mount window use that position.
      schedule()
    }
    const observer = typeof win.ResizeObserver === 'function' ? new win.ResizeObserver(records => {
      if (printing) return
      let changed = false
      for (const record of records) {
        if (record.target === root) {
          const nextWidth = record.contentRect.width
          if (nextWidth > 0 && Math.abs(nextWidth - width) > 1) {
            anchor ||= capture(); width = nextWidth; estimates = new WeakMap(); heights.clear(); heightFolds.clear()
            entries.forEach(entry => { entry.height = estimate(entry.node) }); mapDirty = true; changed = true
          }
          continue
        }
        const page = pages.get(record.target.dataset.ldPageId)
        const height = record.borderBoxSize?.[0]?.blockSize || record.contentRect.height
        if (!page?.active || !height || heights.get(page.id) === height && heightFolds.get(page.id) === foldKey) continue
        anchor ||= capture()
        heights.set(page.id, height); heightFolds.set(page.id, foldKey); changed = true; mapDirty = true
      }
      if (changed) {
        if (!destroyed && !refreshing && !editor.storage.larkDoc.pagedImport) {
          // RO has delivered the measured cache. Suspend its own targets while
          // applying the mount/anchor writes, then observe current targets in the
          // next frame. Writes in this delivery cannot create an RO feedback loop.
          observationPaused = true
          observer.disconnect()
          try { refresh(false) } finally {
            if (observerResumeFrame === null) observerResumeFrame = win.requestAnimationFrame(() => {
              observerResumeFrame = null
              if (destroyed) return
              observationPaused = false
              observer.observe(root, { box: 'border-box' })
              for (const page of pages.values()) if (page.active) observer.observe(page.dom, { box: 'border-box' })
              schedule()
            })
          }
        }
        schedule()
      }
    }) : null
    function refresh(measure = true) {
      if (destroyed || refreshing) return
      if (!isDocument(editor.state.doc)) { clearPaintWindow(); return }
      // A native caret/drag can move before selectionchange reaches PM. A window
      // update would write the old state selection back into the DOM. The normal
      // selection transaction schedules this refresh once it owns the new range.
      if (!printing && editor.state.selection instanceof TextSelection && editor.view.hasFocus()) {
        const native = owner.getSelection()
        if (root.contains(native?.anchorNode) && root.contains(native?.focusNode)) {
          try {
            const doc = editor.state.doc
            const from = doc.resolve(editor.view.posAtDOM(native.anchorNode, native.anchorOffset))
            const to = doc.resolve(editor.view.posAtDOM(native.focusNode, native.focusOffset))
            // Element-boundary ranges can normalize to the current caret. Both
            // affinities are valid there and PM need not emit a transaction.
            if (!TextSelection.between(from, to).eq(editor.state.selection) &&
              !TextSelection.between(from, to, -1).eq(editor.state.selection)) return
          } catch (_) { /* An unresolvable native range must not stall rendering. */ }
        }
      }
      refreshing = true
      try {
        const doc = editor.state.doc, currentOwner = findOwner(), pending = anchor
        const invalidated = !!pending || ownerScroll !== currentOwner || paintedDoc !== doc || paintedFold !== foldKey
        ownerScroll = currentOwner; anchor = null
        // Read origins before mounting writes. The paint clip depends on origins,
        // not on newly measured page heights, so it must not force layout again.
        const paintGeometry = new Map(paintSurfaces.map(surface => [surface.dom, surface.dom.getBoundingClientRect()]))
        const native = currentOwner ? currentOwner.scrollTop : win.scrollY
        // A newer scroll owns the viewport; a queued resize anchor must not pull
        // it back or choose the window from an earlier native position.
        const saved = pending?.owner === currentOwner && Math.abs(pending.native - native) <= 1 ? pending : capture()
        readEntries(editor.state.doc)
        const top = ownerScroll ? ownerScroll.getBoundingClientRect().top + ownerScroll.clientTop : 0
        const height = ownerScroll ? ownerScroll.clientHeight : win.innerHeight
        const updateWindow = () => {
          let logical = 0
          const savedIndex = saved && indices.get(saved.id)
          if (savedIndex !== undefined && savedIndex !== null) {
            for (let index = 0; index < savedIndex; index++) logical += pageHeight(entries[index])
            logical += Math.min(saved.offset, pageHeight(entries[savedIndex]))
          }
          else if (map) logical = map.toLogical(Math.max(0, top - root.getBoundingClientRect().top))
          let before = 0, first = -1, last = -1
          entries.forEach((entry, index) => {
            const size = pageHeight(entry)
            if (size > 0 && before + size > logical - height && before < logical + height * 2) { if (first < 0) first = index; last = index }
            before += size
          })
          const next = new Set()
          if (first >= 0) for (let index = first; index <= last; index++) if (pageHeight(entries[index]) > 0) next.add(entries[index].id)
          if (savedIndex !== undefined && savedIndex !== null && pageHeight(entries[savedIndex]) > 0) next.add(saved.id)
          active = next
        }
        updateWindow()
        const prior = map
        coordinates(editor.state)
        // ResizeObserver owns height invalidation. A stable window needs no PM
        // reconciliation or forced geometry reads on every native scroll frame.
        if (!invalidated && observer && prior === map && notified === version && root.classList.contains('lark-doc-paged-layout')) { consumeRevealed(); updatePaintWindow(paintGeometry); return }
        // This updates node decorations, never document state or undo history.
        editor.view.updateState(editor.state)
        let measured = false
        for (const page of printing ? [] : pages.values()) {
          if (!page.active) continue
          if (observer && !measure) continue
          if (observer && heights.has(page.id) && heightFolds.get(page.id) === foldKey) continue
          const size = page.dom.getBoundingClientRect().height
          if (size && (heights.get(page.id) !== size || heightFolds.get(page.id) !== foldKey)) { heights.set(page.id, size); heightFolds.set(page.id, foldKey); measured = true; mapDirty = true }
        }
        // A cold page can shrink past the reading anchor. Its following page is
        // now visible, so include it before the existing second PM reconciliation.
        if (measured) { updateWindow(); coordinates(editor.state); editor.view.updateState(editor.state) }
        consumeRevealed()
        if (!printing && saved?.scrolled && indices.has(saved.id)) {
          const index = indices.get(saved.id)
          const position = map.logicalTop(index) + Math.min(pageHeight(entries[index]), saved.offset)
          const correction = map.toPhysical(position) - saved.physical
          if (Math.abs(correction) > 0.5) (ownerScroll || win).scrollTo({ top: saved.native + correction, behavior: 'instant' })
        }
        // A clamped anchor correction moves only surfaces inside that scroll
        // owner. Translate the pre-write origins by the actual native delta.
        const scrollDelta = (ownerScroll ? ownerScroll.scrollTop : win.scrollY) - native
        if (scrollDelta) for (const [dom, rect] of paintGeometry) {
          if (!ownerScroll || dom !== ownerScroll && ownerScroll.contains(dom)) paintGeometry.set(dom, { top: rect.top - scrollDelta })
        }
        root.classList.add('lark-doc-paged-layout')
        updatePaintWindow(paintGeometry)
        root.style.overflowAnchor = map.scale < 1 ? 'none' : ''
        for (const [name, value] of [['logical-height', map.logicalHeight], ['physical-height', map.physicalHeight], ['scroll-scale', map.scale], ['rendered-blocks', renderedBlocks().length]]) root.setAttribute(`data-ld-${name}`, String(value))
        if (version !== notified || prior !== map) { notified = version; callback?.(renderedBlocks()) }
        paintedDoc = doc; paintedFold = foldKey
      } finally { refreshing = false }
    }
    const beforePrint = () => {
      if (printing || !isDocument(editor.state.doc)) return
      printAnchor = capture(); printOwner = ownerScroll; printing = true; clearPaintWindow(); refresh()
    }
    const afterPrint = () => {
      if (!printing) return
      printing = false; anchor = printAnchor; refresh()
      if (printAnchor && printOwner === findOwner()) (printOwner || win).scrollTo({ top: printAnchor.native, behavior: 'instant' })
      updatePaintWindow()
      printAnchor = null; printOwner = null
    }
    const locate = position => {
      const state = editor.state
      readEntries(state.doc)
      const index = Math.min(state.doc.resolve(position).index(0), entries.length - 1)
      for (let at = Math.max(0, index - 1); at <= Math.min(entries.length - 1, index + 1); at++) revealed.add(entries[at].id)
      refresh()
      return editor.view.nodeDOM(position)
    }
    const copySlice = slice => new Slice(Fragment.fromArray(slice.content.content.flatMap(node => isPage(node) ? node.content.content : [node])),
      Math.max(0, slice.openStart - Number(isPage(slice.content.firstChild))), Math.max(0, slice.openEnd - Number(isPage(slice.content.lastChild))))
    const unwrapPages = (tr, indexes) => {
      const roots = []
      tr.doc.forEach((node, pos, index) => { if (isPage(node) && indexes.has(index)) roots.push({ node, pos }) })
      roots.reverse().forEach(({ node, pos }) => tr.lift(new NodeRange(tr.doc.resolve(pos + 1), tr.doc.resolve(pos + node.nodeSize - 1), 1), 0))
    }
    const normalize = (transactions, oldState, state) => {
      if ((!isDocument(state.doc) && !isDocument(oldState.doc)) || !transactions.some(tr => tr.docChanged) || transactions.some(tr => tr.getMeta(PAGED_IMPORT_META) || tr.getMeta(NORMALIZE))) return null
      if (!isDocument(state.doc) && state.doc.childCount === 1 && state.doc.firstChild.type.name === 'paragraph') return null
      const type = state.schema.nodes[PAGE], operations = []
      let normalFrom = null, normalTo = null, normalCount = 0
      const flush = () => { if (normalFrom !== null) operations.push({ from: normalFrom, to: normalTo }); normalFrom = null; normalCount = 0 }
      state.doc.forEach((node, pos) => {
        if (!isPage(node)) { if (normalFrom === null) normalFrom = pos; normalTo = pos + node.nodeSize; if (++normalCount === 32) flush(); return }
        flush()
        if (node.childCount <= 64) return
        let offset = pos + 1
        node.forEach((child, childOffset, index) => { if (index && index % 32 === 0) operations.push({ split: offset + childOffset }) })
      })
      flush()
      const tr = state.tr
      operations.sort((a, b) => (b.split ?? b.from) - (a.split ?? a.from)).forEach(operation => {
        if (operation.split !== undefined) tr.split(operation.split, 1, [{ type, attrs: { pageId: createBlockId() } }])
        else tr.wrap(new NodeRange(tr.doc.resolve(operation.from), tr.doc.resolve(operation.to), 0), [{ type, attrs: { pageId: createBlockId() } }])
      })
      const last = tr.doc.lastChild
      if (isPage(last) && last.lastChild.type.name !== 'paragraph') tr.insert(tr.doc.content.size - 1, state.schema.nodes.paragraph.create())
      return tr.steps.length ? tr.setMeta(NORMALIZE, true) : null
    }
    const visibleTextBoundary = (node, pos, start, hidden) => {
      if (hidden.has(pos)) return null
      if (node.isTextblock) return pos + 1 + (start ? 0 : node.content.size)
      if (node.isAtom) return null
      let offset = start ? 0 : node.content.size
      for (let index = start ? 0 : node.childCount - 1; index >= 0 && index < node.childCount; index += start ? 1 : -1) {
        const child = node.child(index)
        if (!start) offset -= child.nodeSize
        const found = visibleTextBoundary(child, pos + 1 + offset, start, hidden)
        if (found !== null) return found
        if (start) offset += child.nodeSize
      }
      return null
    }
    const boundaryKey = (view, event) => {
      if (!isDocument(view.state.doc)) return false
      if (event.altKey || event.isComposing || view.composing) return false
      if (event.ctrlKey && (event.key === 'Home' || event.key === 'End') || event.metaKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        readEntries(view.state.doc)
        const start = event.key === 'Home' || event.key === 'ArrowUp'
        const ordered = start ? entries : entries.slice().reverse()
        for (const entry of ordered) {
          if (pageHeight(entry) <= 0) continue
          const hidden = new Set((foldBase?.find(entry.pos, entry.pos + entry.node.nodeSize) || [])
            .filter(item => item.spec.category === 'fold-hidden' && item.type.attrs?.style?.includes('display')).map(item => item.from))
          const head = visibleTextBoundary(entry.node, entry.pos, start, hidden)
          if (head === null) continue
          const selection = event.shiftKey ? TextSelection.between(view.state.doc.resolve(view.state.selection.anchor), view.state.doc.resolve(head), start ? -1 : 1)
            : TextSelection.create(view.state.doc, head)
          view.dispatch(view.state.tr.setSelection(selection).scrollIntoView())
          return true
        }
        return false
      }
      if (event.altKey || event.metaKey || event.ctrlKey || event.isComposing || !view.state.selection.empty) return false
      const backward = event.key === 'Backspace', forward = event.key === 'Delete'
      if (!backward && !forward) return false
      const { $from } = view.state.selection
      if ($from.depth !== 2 || !isPage($from.node(1)) || !$from.parent.isTextblock) return false
      if (backward ? $from.parentOffset !== 0 || $from.index(1) !== 0 : $from.parentOffset !== $from.parent.content.size || $from.index(1) !== $from.node(1).childCount - 1) return false
      const cut = backward ? $from.before(1) : $from.after(1)
      if (!cut || cut >= view.state.doc.content.size) return false
      const before = view.state.doc.resolve(cut).nodeBefore, after = view.state.doc.resolve(cut).nodeAfter
      if (!isPage(before) || !isPage(after)) return false
      const tr = view.state.tr.join(cut)
      const intermediate = EditorState.create({ schema: view.state.schema, doc: tr.doc, selection: tr.selection })
      ;(backward ? joinBackward : joinForward)(intermediate, joined => { joined.steps.forEach(step => tr.step(step)); tr.setSelection(Selection.fromJSON(tr.doc, joined.selection.toJSON())) })
      view.dispatch(tr.scrollIntoView()); return true
    }
    const runtime = {
      readAnalysis, mapAnalysis, prepareAnalysis, localMarkupRanges,
      find(query) {
        const doc = editor.state.doc
        if (searchDoc === doc && searchQuery === query) return searchResult
        searchDoc = doc; searchQuery = query
        const version = ++searchVersion
        const result = runtime.findTextMatches(doc, query, () => !destroyed && editor.state.doc === doc && searchVersion === version)
        searchResult = result
        if (result && typeof result.then === 'function') result.then(matches => {
          if (destroyed || searchDoc !== doc || searchQuery !== query || searchResult !== result || editor.state.doc !== doc) return
          searchResult = matches || []
          if (!matches) return
          editor.storage.larkDoc.derivedIndex.invalidateSearch()
          if (editor.storage.larkDoc.query === query && !editor.storage.larkDoc.pagedImport) editor.commands.setLarkDocSearch(query, editor.storage.larkDoc.activeIndex)
        })
        return result
      },
      collectSearchDecorations(storage, indices = null) {
        const result = runtime.find(storage.query), matches = Array.isArray(result) ? result : []
        storage.decoratedQuery = storage.query; storage.decoratedIndex = storage.activeIndex; storage.decoratedMatches = matches
        return (indices || matches.map((_, index) => index)).map(index => {
          const { from, to, attribute } = matches[index]
          return Decoration[attribute ? 'node' : 'inline'](from, to, { class: index === storage.activeIndex ? 'lark-doc-search-hit lark-doc-search-active' : 'lark-doc-search-hit' }, { category: 'search', index })
        })
      },
      updateSearchDecorations(state, storage, previous) {
        const result = runtime.find(storage.query), matches = Array.isArray(result) ? result : []
        const same = storage.decoratedQuery === storage.query && storage.decoratedMatches === matches
        const indices = same ? [...new Set([storage.decoratedIndex, storage.activeIndex])].filter(index => matches[index]).sort((a, b) => a - b) : null
        const stale = previous.find(0, state.doc.content.size, spec => spec.category === 'search' && (!same || spec.index === storage.decoratedIndex || spec.index === storage.activeIndex))
        const fresh = runtime.collectSearchDecorations(storage, indices)
        return previous.remove(stale).add(state.doc, fresh)
      },
      updateSearch(host) {
        const doc = host.editor.state.doc
        const signature = `${host.searchQuery}\u0000${host.searchIndex}`
        if (host._searchDoc === doc && host._searchSignature === signature) return host._searchPending
        const query = host.searchQuery, editor = host.editor
        const generation = host._searchGeneration = (host._searchGeneration || 0) + 1
        host._searchDoc = doc; host._searchSignature = signature
        const finish = matches => {
          if (!matches || host._searchGeneration !== generation || host.editor !== editor || editor.isDestroyed || editor.state.doc !== doc || host.searchQuery !== query) return
          host.searchMatches = matches
          // clamp 之后再落签名：否则签名记的是 clamp 前的 index，下一次同样输入的
          // updateSearch 会被判成「变了」而白跑一轮全量扫描。
          host.searchIndex = Math.min(host.searchIndex, Math.max(0, host.searchMatches.length - 1))
          host._searchDoc = doc
          host._searchSignature = `${host.searchQuery}\u0000${host.searchIndex}`
          if (host.searchMatches.length) {
            const match = host.searchMatches[host.searchIndex]
            host.editor.commands.revealLarkDocMatch(match.from, match.to)
          }
          host.editor.commands.setLarkDocSearch(host.searchQuery, host.searchIndex)
        }
        const result = runtime.find(query)
        if (result && typeof result.then === 'function') {
          host.searchMatches = []
          editor.commands.setLarkDocSearch(query, host.searchIndex)
          const pending = result.then(matches => {
            if (host._searchPending === pending) host._searchPending = null
            finish(matches)
          })
          host._searchPending = pending
          return pending
        }
        host._searchPending = null
        finish(result)
      },
      findTextMatches(doc, query, current) {
        if (!isDocument(doc) || !query) return findTextMatches(doc, query)
        return (async () => {
        const matches = []
        let offset = 0, started = Date.now()
        for (const node of doc.content.content) {
          if (destroyed || editor.state.doc !== doc || !current()) return null
          const hits = isPage(node) ? findTextMatches(node, query) : findTextMatches(doc, query, [{ from: offset, to: offset + node.nodeSize }])
          for (const hit of hits) matches.push(isPage(node) ? { ...hit, from: hit.from + offset + 1, to: hit.to + offset + 1 } : hit)
          offset += node.nodeSize
          if (Date.now() - started >= 4) { await new Promise(resolve => win.setTimeout(resolve, 0)); started = Date.now() }
        }
        return destroyed || editor.state.doc !== doc || !current() ? null : matches
        })()
      },
      navigate(scroll, match) {
        if (navigationFrame !== null) win.cancelAnimationFrame(navigationFrame)
        const doc = editor.state.doc
        let remaining = 2, expected, scrollOwner
        const position = () => scrollOwner ? scrollOwner.scrollTop : win.scrollY
        const run = () => {
          navigationFrame = null
          if (destroyed || editor.state.doc !== doc || expected !== undefined && Math.abs(position() - expected) > 1) return
          // Mount and measure first, then keep the requested text block as the
          // anchor. A queued reading anchor must not undo explicit navigation.
          anchor = null; refresh(); scroll(); scrollDocumentSelection(editor, match); refresh(); scroll(); scrollDocumentSelection(editor, match)
          scrollOwner = findOwner(); expected = position()
          if (remaining-- > 0) navigationFrame = win.requestAnimationFrame(run)
        }
        run()
      },
      isDocument, logicalDocument, refresh, schedule, normalize, handleKeyDown: boundaryKey, getScrollCoordinates: () => map,
      syncProjection(view, previousState) {
        if (!isDocument(view.state.doc)) return
        const candidate = editor.storage.larkDoc.projection
        if (candidate?.flushProjection) slotProjection = candidate
        if (!slotProjection) return
        // A prior flat view still owns its manual ShadowRoot slots. Flush before
        // PM scrolls, then repair only an already-focused, non-composing caret.
        // Viewport-only refreshes leave pending native drag selections alone.
        const moved = !previousState || previousState.doc !== view.state.doc || !previousState.selection.eq(view.state.selection)
        const restore = moved && view.hasFocus() && !view.composing
        if (slotProjection.flushProjection() && restore) view.focus()
      },
      decorations(state, base) {
        if (!isDocument(state.doc)) { clearPaintWindow(); return null }
        readEntries(state.doc)
        const nextFold = [...editor.storage.larkDoc.folded].join('\0')
        if (foldBase !== base || foldKey !== nextFold) {
          foldBase = base; foldKey = nextFold; foldRatios = new Map(); mapDirty = true
          if (foldKey) {
            const hidden = new Set(base.find().filter(item => item.spec.category === 'fold-hidden' && item.type.attrs?.style?.includes('display')).map(item => item.from))
            entries.forEach(entry => {
              if (!isPage(entry.node)) return
              let count = 0, visible = 0
              entry.node.forEach((node, offset) => { count++; if (!hidden.has(entry.pos + 1 + offset)) visible++ })
              if (visible < count) foldRatios.set(entry.id, visible / count)
            })
          }
        }
        const visible = coordinates(state)
        if (decoratedDoc === state.doc && decoratedBase === base && visible.size === decoratedVisible.size && [...visible].every(id => decoratedVisible.has(id))) return decorated
        // Page-boundary decorations stay root-local in PM. Only activation needs
        // a decoration; NodeViews own spacer geometry without a quadratic scan.
        const activation = []
        for (const id of visible) {
          const entry = entries[indices.get(id)]
          if (isPage(entry?.node)) activation.push(Decoration.node(entry.pos, entry.pos + entry.node.nodeSize, {}, { ldPagedActive: true }))
        }
        // Nonempty DecorationSet.add validates with a forward-only cursor before
        // sorting. Selection-pinned pages can precede the viewport in this Set.
        activation.sort((a, b) => a.from - b.from)
        decoratedDoc = state.doc; decoratedBase = base; decoratedVisible = visible
        return (decorated = base.add(state.doc, activation))
      },
      getRenderedBlocks: renderedBlocks,
      setWindowCallback(value) { callback = value; notified = -1; schedule() },
      copySlice,
      prepareBlockRange(tr, positions) {
        if (!isDocument(tr.doc)) return positions
        const indexes = new Set(positions.map(pos => tr.doc.resolve(pos).index(0)))
        for (let index = tr.doc.resolve(positions[0]).index(0); index <= tr.doc.resolve(positions[1]).index(0); index++) indexes.add(index)
        const step = tr.steps.length
        unwrapPages(tr, indexes)
        return positions.map(pos => tr.mapping.slice(step).map(pos))
      },
      moveTarget(from, to, direction) {
        const doc = editor.state.doc, parent = siblings(doc)
        if (!parent) return null
        for (let index = 0; index < parent.childCount; index++) {
          const pos = parent.positionAt(index)
          if (direction === 'moveUp' && pos === from) return index ? parent.positionAt(index - 1) : null
          if (direction === 'moveDown' && pos >= to) return pos + parent.child(index).nodeSize
        }
        return null
      },
      prepareSelection() { anchor ||= capture() }, completeSelection: schedule,
      setActive(value) {
        paintEnabled = !!value
        if (value) schedule()
        else {
          clearPaintWindow()
          root.classList.remove('lark-doc-paged-layout'); root.style.overflowAnchor = ''
          for (const name of ['logical-height', 'physical-height', 'scroll-scale', 'rendered-blocks']) root.removeAttribute(`data-ld-${name}`)
        }
      },
      revealPosition: locate,
      revealBlockId(id) {
        let position = null
        editor.state.doc.descendants((node, pos) => { if (position !== null) return false; if (node.attrs.blockId === id) { position = pos; return false } })
        return position === null ? null : locate(position)
      },
      revealNode(node) { const page = node?.closest?.('[data-ld-page-id]'); if (page) { revealed.add(page.dataset.ldPageId); refresh() } },
      blockAtPoint(x, y) {
        let node = owner.elementFromPoint(x, y)
        const page = node?.closest?.('[data-ld-page-id]')
        if (!page || !root.contains(page)) return null
        if (node === page) {
          let last = null
          for (const child of page.children) {
            if (child.hidden || child.style.display === 'none') continue
            last = child
            if (child.getBoundingClientRect().bottom > y) break
          }
          return last
        }
        while (node?.parentElement && node.parentElement !== page) node = node.parentElement
        return node === page ? null : node
      },
      nodeView({ node, decorations, getPos }) {
        const dom = owner.createElement('div'), id = node.attrs.pageId
        const visible = decorations.some(item => item.spec.ldPagedActive)
        const spacerHeight = visible ? null : spacerHeights.get(id) || 0
        dom.className = 'ld-document-page'; dom.dataset.ldPageId = id
        dom.style.cssText = 'content-visibility:visible;contain-intrinsic-size:none;margin:0;' + (visible
          ? 'display:flow-root;contain:layout style'
          : `display:${spacerHeight ? 'block' : 'none'};height:${spacerHeight}px;contain:strict;overflow:hidden`)
        const page = { id, dom, active: visible, node, getPos, spacerHeight }
        pages.set(id, page); version++
        if (visible && !observationPaused) observer?.observe(dom, { box: 'border-box' })
        return { dom, contentDOM: visible ? dom : null,
          update(next, outer) {
            if (!isPage(next) || next.attrs.pageId !== id || outer.some(item => item.spec.ldPagedActive) !== visible) return false
            page.node = next; return true
          },
          ignoreMutation(record) { return !visible || record.type === 'attributes' && record.target === dom },
          destroy() { observer?.unobserve(dom); if (pages.get(id) === page) pages.delete(id); version++ },
        }
      },
      destroy() {
        if (navigationFrame !== null) win.cancelAnimationFrame(navigationFrame)
        if (observerResumeFrame !== null) win.cancelAnimationFrame(observerResumeFrame)
        if (destroyed) return
        destroyed = true; documentAnalysis = null; observer?.disconnect(); if (frame !== null) win.cancelAnimationFrame(frame)
        clearPaintWindow()
        win.removeEventListener('scroll', onScroll, true); win.removeEventListener('resize', schedule)
        win.removeEventListener('beforeprint', beforePrint); win.removeEventListener('afterprint', afterPrint)
        if (editor.schema.cached.segmentSiblings === siblings) delete editor.schema.cached.segmentSiblings
        Object.assign(editor, original)
      },
    }
    editor.storage.larkDoc.pagedView = runtime
    const commands = editor.commandManager.rawCommands, commandOriginals = {}
    for (const name of ['toggleList', 'wrapInList', 'toggleBulletList', 'toggleOrderedList', 'toggleTaskList', 'toggleWrap', 'wrapIn', 'toggleBlockquote']) {
      if (!commands[name]) continue
      const originalCommand = commands[name]; commandOriginals[name] = originalCommand
      commands[name] = (...args) => props => {
        const { tr } = props
        if (isDocument(tr.doc) && tr.selection.$from.index(0) !== tr.selection.$to.index(0)) {
          const from = tr.selection.$from.index(0), to = tr.selection.$to.index(0)
          unwrapPages(tr, new Set(Array.from({ length: to - from + 1 }, (_, index) => from + index)))
          void props.state.tr
        }
        return originalCommand(...args)(props)
      }
    }
    editor.on('destroy', () => Object.assign(commands, commandOriginals))
    editor.getJSON = () => logicalDocument(editor.state.doc).toJSON()
    editor.getHTML = () => { const dom = owner.createElement('div'); dom.appendChild(DOMSerializer.fromSchema(editor.schema).serializeFragment(logicalDocument(editor.state.doc).content)); return dom.innerHTML }
    editor.getText = (options = {}) => { const doc = logicalDocument(editor.state.doc); return getTextBetween(doc, { from: 0, to: doc.content.size }, { ...options, blockSeparator: options.blockSeparator ?? '\n\n', textSerializers: { ...getTextSerializersFromSchema(editor.schema), ...options.textSerializers } }) }
    const transformCopied = editor.view.props.transformCopied
    editor.view.setProps({ nodeViews: { ...editor.view.props.nodeViews, [PAGE]: (node, view, getPos, decorations) => runtime.nodeView({ node, decorations, getPos }) },
      transformCopied(slice, view) {
        if (transformCopied) slice = transformCopied(slice, view)
        return copySlice(slice)
      },
    })
    editor.on('destroy', runtime.destroy)
    win.addEventListener('scroll', onScroll, { capture: true, passive: true }); win.addEventListener('resize', schedule)
    win.addEventListener('beforeprint', beforePrint); win.addEventListener('afterprint', afterPrint)
    observer?.observe(root, { box: 'border-box' })
    return runtime
  }

  return { scrollDocumentSelection, preparePagedDocumentView }
}
