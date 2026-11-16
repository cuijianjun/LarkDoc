// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { createLarkDocExtensions } from '../../src/components/lark-doc/extensions'
import { collectOutline, computeHeadingNumbers, aggregateHeadingContainers, restoreUnknownBlocks, moveBlockRange } from '../../src/core/documentOperations'
import { createDocumentSnapshotReader, createDocumentStatsReader, documentSnapshotWorkerSource } from '../../src/editor/documentSnapshot'
import { runInNewContext } from 'node:vm'
import { createSegmentedDocumentModel, createSegmentedDocumentReader, createLargeDocumentViewportController, createLargeDocumentProjection, createLogicalScrollCoordinates, segmentedDocumentWorkerSource } from '../../src/editor/segmentedDocumentModel'
import { createEditorController } from '../../src/editor/EditorController'
import { LarkDoc } from '../../src/LarkDoc'
import { EditorState } from '@tiptap/pm/state'
import { PAGED_IMPORT_META } from '../../src/core/transactionMetadata'
import { DEFER_BLOCK_ID_META } from '../../src/core/blocks/block-fixes'

const editors = []
describe('logical scroll coordinates', () => {
  it('bounds physical height beyond browser limits and preserves round trips across visible windows', () => {
    const heights = Array.from({ length: 10000 }, (_, i) => i % 100 === 0 ? 0 : 5000)
    const map = createLogicalScrollCoordinates(heights, [4999, 5000, 5001])
    expect(map.logicalHeight).toBeGreaterThan(33000000)
    expect(map.physicalHeight).toBeLessThan(1050000)
    for (const value of [0, 1, 100000, 24990000, map.logicalHeight - 1, map.logicalHeight]) {
      expect(map.toLogical(map.toPhysical(value))).toBeCloseTo(value, 5)
    }
    const anchor = heights.slice(0, 4999).reduce((sum, value) => sum + value, 0) + 100
    expect(map.toPhysical(anchor + 1) - map.toPhysical(anchor)).toBeCloseTo(1, 5)
    const before = map.toPhysical(anchor)
    map.setVisible([6000, 6001])
    const correction = map.toPhysical(anchor) - before
    expect(map.toLogical(before + correction)).toBeCloseTo(anchor, 5)
  })

  it('does not compress normal documents and handles empty or folded intervals', () => {
    const map = createLogicalScrollCoordinates([100, 0, 200])
    expect(map.scale).toBe(1)
    expect(map.toPhysical(150)).toBe(150)
    expect(map.toLogical(300)).toBe(300)
    expect(createLogicalScrollCoordinates([]).toLogical(100)).toBe(0)
    expect(createLogicalScrollCoordinates([0, 0]).toPhysical(100)).toBe(0)
  })

  it('preserves group identity and local offset when an earlier group changes height', () => {
    const old = createLogicalScrollCoordinates([2000000, 2000000, 2000000], [1])
    const reading = old.toPhysical(2000123), anchor = old.anchorAtPhysical(reading)
    const next = createLogicalScrollCoordinates([3000000, 2000000, 2000000], [1])
    expect(anchor).toEqual({ index: 1, offset: 123 })
    const corrected = next.toPhysical(next.logicalTop(anchor.index) + anchor.offset)
    expect(next.toLogical(corrected)).toBe(3000123)
    expect(next.toLogical(reading)).not.toBe(3000123)
  })
})
function makeEditor(content = '<p></p>', options = {}) {
  const editor = new Editor({ extensions: createLarkDocExtensions({ config: { performance: { syntaxHighlight: false } }, ...options }), content })
  editors.push(editor)
  return editor
}
afterEach(() => { editors.splice(0).forEach(editor => editor.destroy()); vi.restoreAllMocks() })

describe('paged imports with real extensions', () => {
  it.each(['remote', 'appended-remote'])('远端完成标记不授信未知块ID：%s', mode => {
    const editor = makeEditor('<p>before</p>', { collab: { extensions: [], isRemoteTransaction: tr => !!tr.getMeta('test-remote') } })
    const invalid = editor.schema.node('doc', null, editor.schema.node('paragraph', { blockId: null }, editor.schema.text('legacy')))
    editor.view.updateState(EditorState.create({ schema: editor.schema, doc: invalid, plugins: editor.state.plugins }))
    editor.storage.larkDoc.validatedPagedImport = { id: 999, doc: invalid }
    try {
      let tr = editor.state.tr.setMeta(PAGED_IMPORT_META, { id: 999, phase: 'complete' }).setMeta(DEFER_BLOCK_ID_META, true)
      tr = mode === 'remote' ? tr.setMeta('test-remote', true) : tr.setMeta('appendedTransaction', editor.state.tr.setMeta('test-remote', true))
      editor.view.dispatch(tr)
      expect(editor.state.doc.firstChild.attrs.blockId).toBeNull()
      editor.view.dispatch(editor.state.tr.insertText('X', 2))
      expect(editor.state.doc.firstChild.attrs.blockId).toMatch(/^[A-Za-z0-9_-]{1,64}$/)
      expect(editor.state.doc.textContent).toBe('lXegacy')
    } finally { delete editor.storage.larkDoc.validatedPagedImport }
  })
  it('keeps intermediate heading/table tails out of the document and imports as one undo group', async () => {
    const editor = makeEditor('<p data-block-id="old_import">old</p>'), before = editor.state.doc
    const createRange = document.createRange.bind(document)
    vi.spyOn(document, 'createRange').mockImplementation(() => Object.assign(createRange(), {
      getClientRects: () => [], getBoundingClientRect: () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 }),
    }))
    const controller = createEditorController({ editor })
    const content = '<h1>first</h1><table><tr><td><p>cell</p></td></tr></table><h2>last</h2>'
    await controller.setContentAsync(content, { pageBlocks: 1, yieldToMain: async () => {} })
    expect(editor.state.doc.content.content.map(node => node.type.name)).toEqual(['heading', 'table', 'heading', 'paragraph'])
    expect(editor.state.doc.textContent).toBe('firstcelllast')
    editor.commands.undo()
    expect(editor.state.doc.eq(before)).toBe(true)
    editor.commands.redo()
    expect(editor.state.doc.textContent).toBe('firstcelllast')
  })

  it('beforeTransaction取消不会留下随后才写入的页，且只读切换不会被解锁覆盖', async () => {
    const editor = makeEditor('<p data-block-id="cancel_original">old</p>'), original = editor.state
    const controller = createEditorController({ editor }), abort = new AbortController()
    const onBefore = ({ transaction }) => {
      if (!transaction.getMeta('larkDocPagedImport')) return
      abort.abort()
      controller.setReadonly(true)
    }
    editor.on('beforeTransaction', onBefore)
    await expect(controller.setContentAsync('<p>one</p><p>two</p>', { pageBlocks: 1, signal: abort.signal, yieldToMain: async () => {} })).rejects.toMatchObject({ name: 'AbortError' })
    editor.off('beforeTransaction', onBefore)
    expect(editor.state).toBe(original)
    expect(editor.isEditable).toBe(false)
  })

  it('重入异步B等待时，更新的同步C不会被B覆盖', async () => {
    const editor = makeEditor('<p data-block-id="race_original">old</p>')
    const controller = createEditorController({ editor })
    let pending, triggered = false
    const onBefore = ({ transaction }) => {
      if (triggered || !transaction.getMeta('larkDocPagedImport')) return
      triggered = true
      pending = controller.setContentAsync('<p>B older async</p>', { yieldToMain: async () => {} }).then(() => 'committed', error => error.name)
      queueMicrotask(() => controller.setContent('<p>C newer sync</p>'))
    }
    editor.on('beforeTransaction', onBefore)
    await expect(controller.setContentAsync('<p>A first</p><p>A second</p>', { pageBlocks: 1, yieldToMain: async () => {} })).rejects.toMatchObject({ name: 'AbortError' })
    expect(await pending).toBe('AbortError')
    editor.off('beforeTransaction', onBefore)
    expect(editor.state.doc.textContent).toBe('C newer sync')
  })
})

describe('segment projection keeps the ProseMirror light DOM intact', () => {
  it('falls back without attaching a shadow root when manual slots are unavailable', () => {
    const host = document.createElement('div')
    expect(createLargeDocumentProjection({ editorDom: host })).toBeNull()
    expect(host.shadowRoot).toBeNull()
  })

  it('冷态估高尚未溢出时，实测后仍在内嵌pane保持阅读位置', () => {
    vi.stubGlobal('CSS', { supports: () => true })
    let resized
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback) { resized = callback }
      observe() {} unobserve() {} disconnect() {}
    })
    const pane = document.createElement('div'), host = document.createElement('div')
    pane.style.overflowY = 'auto'
    pane.appendChild(host); document.body.appendChild(pane)
    host.innerHTML = '<p data-index="0">大段</p><p data-index="1">阅读段</p><p data-index="2">尾段</p>'
    const heights = [2000000, 1500, 1500]
    let measured = false
    Object.defineProperties(pane, { clientHeight: { value: 1200 }, clientTop: { value: 0 },
      scrollHeight: { get: () => measured ? heights.reduce((sum, value) => sum + value, 0) : 1080 } })
    vi.spyOn(pane, 'getBoundingClientRect').mockReturnValue({ top: 300, bottom: 1500, height: 1200 })
    pane.scrollTo = vi.fn(options => { pane.scrollTop = options.top })
    const windowScroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    vi.spyOn(host, 'getBoundingClientRect').mockImplementation(() => ({ top: 300 - pane.scrollTop, width: 800 }))
    vi.spyOn(host, 'attachShadow').mockImplementation(() => {
      const shadow = document.createDocumentFragment()
      Object.defineProperty(shadow, 'slotAssignment', { value: 'manual' })
      Object.defineProperty(host, 'shadowRoot', { configurable: true, value: shadow })
      return shadow
    })
    const createElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag, ...args) => {
      const node = createElement(tag, ...args)
      if (tag === 'slot') node.assign = (...nodes) => { node.assigned = nodes }
      if (tag === 'div') node.getBoundingClientRect = () => {
        const children = node.querySelector('slot')?.assigned || []
        if (children.length) measured = true
        return { height: children.reduce((sum, child) => sum + heights[Number(child.dataset.index)], 0) }
      }
      return node
    })
    const projection = createLargeDocumentProjection({ editorDom: host, segmentBlocks: 1, initialActive: true, getSelectionNodes: () => [] })
    try {
      pane.scrollTop = 2000100
      projection.refresh()
      const before = heights[0] - pane.scrollTop
      heights[0] += 180
      const group = host.shadowRoot.querySelector('.segment')
      resized([{ target: group, borderBoxSize: [{ blockSize: heights[0] }], contentRect: { height: heights[0] } }])
      projection.refresh()
      expect(heights[0] - pane.scrollTop).toBe(before)
      expect(pane.scrollTo).toHaveBeenLastCalledWith({ top: 2000280, behavior: 'instant' })
      expect(windowScroll).not.toHaveBeenCalled()
    } finally { projection.destroy(); pane.remove(); vi.unstubAllGlobals() }
  })

  it.each([false, true, 'cold'])('preserves identity, order and bounded windows (manual viewport=%s)', async windowed => {
    // This test drives refresh() explicitly. A real RAF can otherwise consume
    // a dirty measurement between the mutation microtask and the next spy.
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1)
    vi.stubGlobal('CSS', { supports: () => true })
    const observed = new Set()
    let notifyResize
    let initialMax = 0
    if (windowed) vi.stubGlobal('ResizeObserver', class {
      constructor(notify) { notifyResize = notify }
      observe(node) { observed.add(node) }
      unobserve(node) { observed.delete(node) }
      disconnect() { observed.clear() }
    })
    const createElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag, ...args) => {
      const node = createElement(tag, ...args)
      if (tag === 'slot') node.assign = (...nodes) => {
        node.assigned = nodes
        initialMax = Math.max(initialMax, Array.from(host.shadowRoot.querySelectorAll('slot')).reduce((sum, slot) => sum + (slot.assigned?.length || 0), 0))
      }
      return node
    })
    const host = document.createElement('div')
    host.innerHTML = '<p>原始正文</p>'.repeat(windowed ? 1100 : 300)
    document.body.appendChild(host)
    const original = Array.from(host.childNodes)
    let pin = windowed ? original[1099] : null, viewportTop = 0, viewportWidth = 800
    if (windowed) vi.spyOn(host, 'getBoundingClientRect').mockImplementation(() => ({ top: viewportTop, width: viewportWidth }))
    vi.spyOn(host, 'attachShadow').mockImplementation(() => {
      // jsdom has automatic slot assignment only. Model the manual shadow
      // container with a fragment; the real browser test covers native slots.
      const shadow = document.createDocumentFragment()
      Object.defineProperty(shadow, 'slotAssignment', { value: 'manual' })
      Object.defineProperty(host, 'shadowRoot', { configurable: true, value: shadow })
      return shadow
    })
    const renderedChanged = vi.fn()
    const projection = createLargeDocumentProjection({ editorDom: host, segmentBlocks: 8, initialActive: windowed === 'cold', getSelectionNodes: () => [pin], onRenderWindowChange: renderedChanged })
    try {
      expect(projection).not.toBeNull()
      const assigned = () => Array.from(host.shadowRoot.querySelectorAll('slot')).flatMap(slot => slot.assigned)
      const expectProjectionOrder = () => {
        const nodes = assigned(), rendered = new Set(nodes)
        expect(nodes).toEqual(Array.from(host.childNodes).filter(node => rendered.has(node)))
        if (!windowed || !host.classList.contains('lark-doc-segment-layout')) expect(nodes).toEqual(Array.from(host.childNodes))
        host.shadowRoot.querySelectorAll('.render-page').forEach(page => {
          if (windowed && host.classList.contains('lark-doc-segment-layout') && !page.classList.contains('is-visible')) {
            expect(Array.from(page.querySelectorAll('slot')).flatMap(slot => slot.assigned)).toHaveLength(0)
          }
        })
      }
      expect(host.shadowRoot.querySelectorAll('.render-page')).toHaveLength(windowed ? 5 : 2)
      expect(host.shadowRoot.children.length).toBeLessThanOrEqual(windowed ? 6 : 3)
      const editingPage = host.shadowRoot.querySelector('.render-page')
      expect(Array.from(host.childNodes)).toEqual(original)
      if (windowed === 'cold') expect(initialMax).toBeLessThanOrEqual(8 * 6)
      else expect(assigned()).toEqual(original)
      projection.setActive(true)
      if (windowed) {
        const first = host.shadowRoot.querySelector('.render-page'), last = host.shadowRoot.querySelector('.render-page:last-child')
        expect(observed.size).toBeLessThanOrEqual(6)
        expect(last.classList.contains('is-visible')).toBe(true)
        expect(assigned().length).toBeLessThanOrEqual(8 * 6)
        expect(assigned()).toContain(original[1083])
        expectProjectionOrder()
        expect(new Set(projection.getRenderedBlocks())).toEqual(new Set(assigned()))
        expect(new Set(renderedChanged.mock.calls.at(-1)[0])).toEqual(new Set(assigned()))
        renderedChanged.mockClear()
        const readSelection = vi.spyOn(window, 'getSelection')
        for (let index = 0; index < 50; index += 1) projection.refresh()
        expect(readSelection).not.toHaveBeenCalled()
        expect(renderedChanged).not.toHaveBeenCalled()
        readSelection.mockRestore()
        viewportTop = -32 * 8 * 360 * 2.5
        projection.refresh()
        expect([...observed].every(element => element.classList.contains('segment'))).toBe(true)
        expect(assigned().length).toBeLessThanOrEqual(8 * 8)
        expect(first.classList.contains('is-visible')).toBe(false)
        pin = original[0]
        projection.refresh()
        expect(first.classList.contains('is-visible')).toBe(true)
        expect(last.classList.contains('is-visible')).toBe(false)
        viewportTop = 0; pin = null; projection.refresh()
        expect(assigned()).not.toContain(original[1099])
        const endKey = new KeyboardEvent('keydown', { key: 'End', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true })
        host.dispatchEvent(endKey)
        expect(assigned()).toContain(original[1099])
        expect(endKey.defaultPrevented).toBe(false)
        const totalHeight = () => [...host.shadowRoot.querySelectorAll('.render-page')].reduce((sum, page) => sum + parseFloat(page.style.getPropertyValue('--page-height')), 0)
        viewportTop = -totalHeight() + 500; projection.refresh()
        expect(assigned()).not.toContain(original[0])
        host.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', metaKey: true, bubbles: true }))
        expect(assigned()).toContain(original[0])
        viewportTop = 0; projection.refresh()
        const field = document.createElement('input')
        original[0].appendChild(field)
        field.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', ctrlKey: true, bubbles: true }))
        expect(assigned()).not.toContain(original[1099])
        field.remove()
        original.slice(1).forEach(node => { node.style.display = 'none' })
        viewportTop = -10000; projection.refresh()
        expect(assigned()).not.toContain(original[0])
        host.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', ctrlKey: true, shiftKey: true, bubbles: true }))
        expect(assigned()).toContain(original[0])
        expect(assigned()).not.toContain(original[1099])
        original.forEach(node => { node.style.display = '' })
        viewportTop = 0; projection.refresh()
        const nativeSelection = vi.spyOn(window.getSelection(), 'setBaseAndExtent')
        projection.prepareSelection([original[600]])
        expect(assigned()).toContain(original[600])
        expect(nativeSelection).not.toHaveBeenCalled()
        projection.completeSelection()
        expect(assigned()).not.toContain(original[600])
        window.dispatchEvent(new Event('beforeprint'))
        expect(assigned()).toEqual(original)
        expect(projection.getRenderedBlocks()).toBeNull()
        expect(renderedChanged.mock.calls.at(-1)[0]).toBeNull()
        window.dispatchEvent(new Event('afterprint'))
        expect(assigned().length).toBeLessThan(original.length)
        expectProjectionOrder()
        expect(new Set(projection.getRenderedBlocks())).toEqual(new Set(assigned()))
        const firstGroup = first.querySelector('.segment.is-visible')
        const estimated = firstGroup.style.getPropertyValue('--segment-height')
        notifyResize([{ target: firstGroup, borderBoxSize: [{ blockSize: 2000 }], contentRect: { height: 2000 } }])
        expect(firstGroup.style.getPropertyValue('--segment-height')).toBe('2000px')
        const stableRect = vi.spyOn(firstGroup, 'getBoundingClientRect').mockReturnValue({ height: 2000 })
        for (let index = 0; index < 50; index += 1) projection.refresh()
        expect(stableRect).not.toHaveBeenCalled()
        window.dispatchEvent(new Event('resize'))
        expect(stableRect).not.toHaveBeenCalled()
        viewportWidth = 400
        stableRect.mockReturnValue({ height: 3000 })
        window.dispatchEvent(new Event('resize'))
        expect(firstGroup.style.getPropertyValue('--segment-height')).toBe('3000px')
        viewportWidth = 800
        stableRect.mockReturnValue({ height: 2000 })
        window.dispatchEvent(new Event('resize'))
        expect(firstGroup.style.getPropertyValue('--segment-height')).toBe('2000px')
        stableRect.mockRestore()
        original[0].firstChild.data = '更新正文'
        await new Promise(resolve => setTimeout(resolve, 0))
        expect(firstGroup.style.getPropertyValue('--segment-height')).toBe('2000px')
        window.dispatchEvent(new Event('resize'))
        expect(firstGroup.style.getPropertyValue('--segment-height')).toBe('2000px')
        original[7].style.display = 'none'
        await new Promise(resolve => setTimeout(resolve, 0))
        expect(firstGroup.style.getPropertyValue('--segment-height')).toBe('2000px')
        notifyResize([{ target: firstGroup, borderBoxSize: [{ blockSize: 1800 }], contentRect: { height: 1800 } }])
        expect(firstGroup.style.getPropertyValue('--segment-height')).toBe('1800px')
        original[7].style.display = ''
        await new Promise(resolve => setTimeout(resolve, 0))
        notifyResize([{ target: firstGroup, borderBoxSize: [{ blockSize: 2000 }], contentRect: { height: 2000 } }])
        original[0].firstChild.data = '尚未收到RO的改动'
        await new Promise(resolve => setTimeout(resolve, 0))
        const retiring = vi.spyOn(firstGroup, 'getBoundingClientRect').mockReturnValue({ height: 20000 })
        viewportTop = -10000
        projection.refresh()
        expect(assigned()).toContain(original[0])
        expect(retiring).toHaveBeenCalledTimes(1)
        retiring.mockClear().mockReturnValue({ height: 1800 })
        original[0].firstChild.data = '缩短但尚未收到RO的改动'
        await new Promise(resolve => setTimeout(resolve, 0))
        viewportTop = -32 * 8 * 360 * 2.5
        projection.refresh()
        expect(firstGroup.style.getPropertyValue('--segment-height')).toBe('1800px')
        expect(retiring).toHaveBeenCalledTimes(1)
        original[0].firstChild.data = '离屏更新正文'
        await new Promise(resolve => setTimeout(resolve, 0))
        expect(firstGroup.style.getPropertyValue('--segment-height')).toBe(estimated)
        expect(projection.getScrollCoordinates().logicalTop(1)).toBe(Number.parseFloat(estimated))
        const scrollBy = vi.spyOn(window, 'scrollTo').mockImplementation(options => { viewportTop -= options.top })
        const growing = [...observed][0]
        notifyResize([{ target: growing, borderBoxSize: [{ blockSize: 2500000 }], contentRect: { height: 2500000 } }])
        projection.refresh()
        expect(projection.getScrollCoordinates().scale).toBeLessThan(1)
        original[0].firstChild.data = '压缩坐标中的离屏更新'
        await new Promise(resolve => setTimeout(resolve, 0))
        const compressed = projection.getScrollCoordinates()
        expect(compressed.logicalTop(1)).toBe(Number.parseFloat(estimated))
        expect(Number.parseFloat(firstGroup.style.getPropertyValue('--segment-height'))).toBe(Number.parseFloat(estimated) * compressed.scale)
        notifyResize([{ target: growing, borderBoxSize: [{ blockSize: 2880 }], contentRect: { height: 2880 } }])
        projection.refresh()
        scrollBy.mockRestore()
        viewportTop = 0
        projection.refresh()
      }
      host.shadowRoot.elementFromPoint = () => host.shadowRoot.querySelector('.segment')
      let rectReads = 0
      original.forEach((node, index) => vi.spyOn(node, 'getBoundingClientRect').mockImplementation(() => {
        if (index >= 8) throw new Error('offscreen render window measured')
        rectReads += 1
        return { bottom: index }
      }))
      expect(projection.blockAtPoint(0, 1000)).toBe(original[7])
      expect(rectReads).toBe(8)
      let windowReads = 0
      host.shadowRoot.querySelectorAll('.segment').forEach((group, index) => {
        vi.spyOn(group, 'getBoundingClientRect').mockImplementation(() => {
          if (index >= 32) throw new Error('offscreen render page measured')
          windowReads += 1
          return { bottom: 10000 + index }
        })
      })
      host.shadowRoot.elementFromPoint = () => host.shadowRoot.querySelector('.render-page')
      rectReads = 0
      expect(projection.blockAtPoint(0, 1000)).toBe(original[7])
      expect(windowReads).toBe(1)
      expect(rectReads).toBe(8)
      original[7].style.display = 'none'
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(host.shadowRoot.querySelector('.render-page')).toBe(editingPage)
      rectReads = 0
      expect(projection.blockAtPoint(0, 1000)).toBe(original[6])
      expect(rectReads).toBe(7)
      original.forEach(node => { node.style.display = 'none' })
      await new Promise(resolve => setTimeout(resolve, 0))
      expect([...host.shadowRoot.querySelectorAll('.segment')].every(group => group.style.display === 'none')).toBe(true)
      expect([...host.shadowRoot.querySelectorAll('.render-page')].every(page => page.style.display === 'none')).toBe(true)
      original.forEach(node => { node.style.display = '' })
      await new Promise(resolve => setTimeout(resolve, 0))
      expect([...host.shadowRoot.querySelectorAll('.segment')].every(group => group.style.display !== 'none')).toBe(true)
      const x = document.createElement('p'), y = document.createElement('p'), z = document.createElement('p')
      if (windowed) { pin = original[129]; projection.refresh() }
      host.insertBefore(x, original[129])
      if (windowed) {
        projection.refresh()
        expect(assigned().includes(x)).toBe(true)
      }
      host.insertBefore(y, x)
      host.insertBefore(z, original[129])
      host.insertBefore(x, z)
      await new Promise(resolve => setTimeout(resolve, 0))
      expectProjectionOrder()
      const fragment = document.createDocumentFragment()
      for (let index = 0; index < 20; index += 1) { const p = document.createElement('p'); p.textContent = `新增${index}`; fragment.appendChild(p) }
      host.insertBefore(fragment, host.children[5])
      await new Promise(resolve => setTimeout(resolve, 0))
      expectProjectionOrder()
      host.insertBefore(original[290], original[1])
      original[129].remove()
      await new Promise(resolve => setTimeout(resolve, 0))
      expectProjectionOrder()
      const preservedWindow = host.shadowRoot.querySelector('.segment')
      const importPage = document.createDocumentFragment()
      for (let index = 0; index < 128; index++) { const p = document.createElement('p'); p.textContent = `分页追加${index}`; importPage.appendChild(p) }
      host.appendChild(importPage)
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(host.shadowRoot.querySelector('.segment')).toBe(preservedWindow)
      expectProjectionOrder()
      host.innerHTML = '<p>批量替换</p>'.repeat(1100)
      await new Promise(resolve => setTimeout(resolve, 0))
      expectProjectionOrder()
      host.insertBefore(original[10], host.firstChild)
      host.insertBefore(original[11], host.firstChild)
      await new Promise(resolve => setTimeout(resolve, 0))
      expectProjectionOrder()
      projection.setActive(false)
      expect(assigned()).toEqual(Array.from(host.childNodes))
      expect(projection.getRenderedBlocks()).toBeNull()
      expect(host.classList.contains('lark-doc-segment-layout')).toBe(false)
      expect(host.children).toHaveLength(1102)
      const replacement = document.createElement('p')
      replacement.textContent = '同步替换停用投影的尾节点'
      host.lastChild.replaceWith(replacement)
      expect(assigned()).not.toContain(replacement)
      expect(projection.flushProjection()).toBe(true)
      expect(assigned()).toEqual(Array.from(host.childNodes))
      expect(projection.flushProjection()).toBe(false)
      if (windowed) {
        projection.setActive(true)
        const page = host.shadowRoot.querySelector('.render-page')
        const group = page.querySelector('.segment.is-visible')
        const before = page.style.getPropertyValue('--page-height')
        const beforeGroup = group.style.getPropertyValue('--segment-height')
        projection.destroy()
        expect(assigned()).toEqual(Array.from(host.childNodes))
        notifyResize([{ target: group, borderBoxSize: [{ blockSize: 12345 }], contentRect: { height: 12345 } }])
        expect(page.style.getPropertyValue('--page-height')).toBe(before)
        expect(group.style.getPropertyValue('--segment-height')).toBe(beforeGroup)
      }
    } finally { projection?.destroy(); expect(observed.size).toBe(0); host.remove(); vi.unstubAllGlobals() }
  })
})

describe('large document snapshots preserve the public codecs', () => {
  const mixed = '<h1>章节😀</h1><p><strong>粗体</strong><br>正文</p><ul><li><p>列表</p><h2>列表标题</h2></li></ul>'
    + '<blockquote><h2>隔离标题</h2><p>引用</p></blockquote><table><tbody><tr><td><p>单元格</p></td></tr></tbody></table>'
    + '<h2>后文</h2><p><img src="data:image/png;base64,AAAA" alt="图片"></p><p></p>'

  it('大文档滚动不重测闲置句柄，悬浮和resize仍定位', async () => {
    vi.useFakeTimers()
    const element = document.createElement('div')
    document.body.appendChild(element)
    const doc = new LarkDoc({ element, storage: 'none', content: '<p>初始</p>' })
    try {
      const editor = doc.getEditor(), host = doc._handle.nativeHost.host
      host.selectionBatcher().dispose()
      editor.commands.setContent(`<p>${'x'.repeat(500001)}</p>`)
      await vi.dynamicImportSettled()
      // 等待正文派生刷新结束，避免把其落地后的句柄定位误算成滚动重测。
      await vi.waitFor(() => expect(host.outlinePending).toBe(false))
      await vi.advanceTimersByTimeAsync(20)
      host.scheduleActiveHeading = vi.fn()
      host.handleRange = { from: 0, to: editor.state.doc.firstChild.nodeSize }
      await vi.dynamicImportSettled()
      await vi.advanceTimersByTimeAsync(20)
      const position = vi.spyOn(host, 'positionBlockHandle').mockImplementation(() => {})
      host.onDocumentScroll(new Event('scroll'))
      await vi.advanceTimersByTimeAsync(20)
      expect(position).not.toHaveBeenCalled()
      host.handleHovering = true
      host.onDocumentScroll(new Event('scroll'))
      await vi.advanceTimersByTimeAsync(20)
      expect(position).toHaveBeenCalledTimes(1)
      host.handleHovering = false
      host.onDocumentScroll(new Event('resize'))
      await vi.advanceTimersByTimeAsync(20)
      expect(position).toHaveBeenCalledTimes(2)
      position.mockClear()
      const bubble = vi.spyOn(host, 'bubbleBarPosition').mockReturnValue({ top: '0px', left: '0px' })
      host.bubbleVisible = true
      host.onDocumentScroll(new Event('scroll'))
      host.onDocumentScroll(new Event('resize'))
      await vi.advanceTimersByTimeAsync(20)
      expect(position).toHaveBeenCalledTimes(1)
      expect(bubble).toHaveBeenCalledTimes(1)
    } finally { doc.destroy(); element.remove(); vi.useRealTimers() }
  })

  it('resolves large-document reading headings without PM whole-document coordinate scanning', async () => {
    vi.useFakeTimers()
    const element = document.createElement('div')
    document.body.appendChild(element)
    const doc = new LarkDoc({ element, storage: 'none', content: '<p>初始</p>' })
    try {
      const editor = doc.getEditor(), host = doc._handle.nativeHost.host
      host.updateHandleAndTable = () => {}
      host.selectionBatcher().dispose()
      editor.commands.setContent(`<h1 data-block-id="read_a">A</h1><h2 data-block-id="read_b">B</h2><p data-block-id="read_body">${'x'.repeat(500001)}</p>`)
      await vi.dynamicImportSettled()
      await vi.advanceTimersByTimeAsync(50)
      const second = editor.state.doc.firstChild.nodeSize
      host.outline = [{ pos: 0 }, { pos: second }]
      host.outlinePending = false
      editor.storage.larkDoc.projection = { blockAtPoint: vi.fn(() => editor.view.dom.children[1]) }
      const scan = vi.spyOn(editor.view, 'posAtCoords').mockImplementation(() => { throw new Error('unbounded coordinate scan') })
      host.scheduleActiveHeading()
      await vi.advanceTimersByTimeAsync(200)
      expect(host.activeHeading).toBe(second)
      expect(scan).not.toHaveBeenCalled()
    } finally { doc.destroy(); element.remove(); vi.useRealTimers() }
  })

  it('preserves own __proto__ JSON fields without changing object prototypes', () => {
    const input = JSON.parse('{"type":"doc","__proto__":{"polluted":true},"content":[{"type":"heading","attrs":{"level":1},"__proto__":{"polluted":true}},{"type":"paragraph"}]}')
    const restored = restoreUnknownBlocks(input)
    const result = aggregateHeadingContainers(restored)
    for (const value of [restored, restored.content[0], result, result.content[0]]) {
      expect(Object.prototype.hasOwnProperty.call(value, '__proto__')).toBe(true)
      expect(value.polluted).toBeUndefined()
      expect(Object.getPrototypeOf(value)).toBe(Object.prototype)
    }
  })

  it('keeps the first edit after a large import in a separate undo group', () => {
    const editor = makeEditor('<p>原文</p>')
    const controller = createEditorController({ editor })
    const content = 'x'.repeat(500001)
    controller.setContent({ type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: 'large_undo' }, content: [{ type: 'text', text: content }] }] })
    editor.commands.insertContentAt(3, '新')
    expect(editor.commands.undo()).toBe(true)
    expect(editor.getText()).toBe(content)
    expect(editor.commands.undo()).toBe(true)
    expect(editor.getText()).toBe('原文')
    controller.destroy()
  })

  it('keeps collaborative bulk IDs synchronous and never normalizes a later remote replacement', async () => {
    vi.useFakeTimers()
    try {
      const editor = makeEditor('<p>原文</p>', { collab: { extensions: [], isRemoteTransaction: tr => !!tr.getMeta('remote') } })
      const wait = vi.fn(() => Promise.resolve(true))
      editor.storage.larkDoc.backgroundGate = { wait }
      const content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x'.repeat(500001) }] }] }
      const controller = createEditorController({ editor })
      controller.setContent(content)
      expect(editor.state.doc.firstChild.attrs.blockId).toBeTruthy()
      const remote = editor.schema.nodeFromJSON(content)
      editor.view.dispatch(editor.state.tr.replaceWith(0, editor.state.doc.content.size, remote.content).setMeta('remote', true))
      await vi.advanceTimersByTimeAsync(600)
      expect(editor.state.doc.firstChild.attrs.blockId).toBeFalsy()
      expect(wait).not.toHaveBeenCalled()
      controller.destroy()
    } finally { vi.useRealTimers() }
  })

  it('cooperative fallback equals HTML, JSON, text and media-link output from the real schema', async () => {
    const editor = makeEditor(mixed)
    const reader = createDocumentSnapshotReader({ workerFactory: () => null })
    const controller = createEditorController({ editor })
    const snapshot = await reader.read(editor)
    expect(snapshot.html).toBe(editor.getHTML())
    expect(snapshot.text).toBe(editor.getText())
    expect(snapshot.json).toEqual(controller.getJSON())
    const link = await reader.read(editor, { media: { mode: 'link' } })
    expect(link.html).toBe(controller.getHTML({ media: { mode: 'link' } }))
  })

  it('streams JSON blocks to a worker and terminates it after delivery', async () => {
    const editor = makeEditor(mixed)
    const terminate = vi.fn()
    const scope = { postMessage(data) { queueMicrotask(() => worker.onmessage({ data })) } }
    const postMessage = vi.fn(data => scope.onmessage({ data }))
    const worker = { postMessage, terminate }
    runInNewContext(documentSnapshotWorkerSource(), { self: scope })
    const result = await createDocumentSnapshotReader({ workerFactory: () => worker }).read(editor)
    expect(result.json).toEqual(createEditorController({ editor }).getJSON())
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'finish' })
    expect(terminate).toHaveBeenCalledTimes(1)
  })

  it('executes the real worker codec and returns bounded chunks instead of a whole-document reply', async () => {
    const editor = makeEditor('<h1>父</h1>' + '<p>正文</p>'.repeat(260) + '<h2>子</h2><p>后文</p>')
    editor.commands.insertContentAt(editor.state.doc.firstChild.nodeSize, { type: 'unknownBlock', attrs: { payload: JSON.stringify({ type: 'futureCard', attrs: { exact: '未知块原始内容' } }) } })
    const packets = []
    const scope = { postMessage(data) { packets.push(data); queueMicrotask(() => worker.onmessage({ data })) } }
    const worker = { postMessage(data) { scope.onmessage({ data }) }, terminate: vi.fn() }
    runInNewContext(documentSnapshotWorkerSource(), { self: scope })
    const result = await createDocumentSnapshotReader({ workerFactory: () => worker }).read(editor)
    expect(result.json).toEqual(createEditorController({ editor }).getJSON())
    const chunks = packets.filter(packet => packet.type === 'chunk')
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every(packet => packet.content.length <= 128)).toBe(true)
    expect(chunks.flatMap(packet => packet.content).find(node => node.type === 'futureCard')).toEqual({ type: 'futureCard', attrs: { exact: '未知块原始内容' } })
    expect(packets.at(-1)).toEqual({ type: 'done' })
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it('cancels a waiting worker and never publishes a stale document', async () => {
    const editor = makeEditor(mixed)
    const worker = { postMessage: vi.fn(), terminate: vi.fn() }
    const abort = new AbortController()
    const pending = createDocumentSnapshotReader({ workerFactory: () => worker }).read(editor, { signal: abort.signal })
    abort.abort()
    expect(await pending).toBeNull()
    expect(worker.terminate).toHaveBeenCalled()
    expect(await createDocumentSnapshotReader().read(editor, { signal: abort.signal })).toBeNull()
  })

  it('recovers from worker-src failure with identical output', async () => {
    const editor = makeEditor(mixed)
    const worker = { terminate: vi.fn(), postMessage(message) {
      if (message.type === 'finish') queueMicrotask(() => worker.onerror({ preventDefault() {} }))
    } }
    const result = await createDocumentSnapshotReader({ workerFactory: () => worker }).read(editor)
    expect(result.html).toBe(editor.getHTML())
    expect(result.json).toEqual(createEditorController({ editor }).getJSON())
  })

  it('waits before serializing while foreground scrolling is active', async () => {
    const editor = makeEditor(mixed)
    let release
    let allowed = false
    const pending = new Promise(resolve => { release = resolve })
    editor.storage.larkDoc.backgroundGate = { wait: () => allowed ? Promise.resolve(true) : pending }
    const serialize = vi.spyOn(editor.state.doc.firstChild, 'toJSON')
    const reading = createDocumentSnapshotReader({ workerFactory: () => null }).read(editor)
    await Promise.resolve()
    expect(serialize).not.toHaveBeenCalled()
    allowed = true
    release(true)
    expect((await reading).json).toEqual(createEditorController({ editor }).getJSON())
  })

  it('falls back without serializing unchanged blocks twice after a malformed worker reply', async () => {
    const editor = makeEditor(mixed)
    const serialize = vi.spyOn(editor.state.doc.firstChild, 'toJSON')
    const worker = { terminate: vi.fn(), postMessage(message) {
      if (message.type === 'finish') queueMicrotask(() => worker.onmessage({ data: { type: 'done' } }))
    } }
    const result = await createDocumentSnapshotReader({ workerFactory: () => worker }).read(editor)
    expect(serialize).toHaveBeenCalledOnce()
    expect(result.json).toEqual(createEditorController({ editor }).getJSON())
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it('publishes an owed content change after normalization cancels its in-flight snapshot', async () => {
    vi.useFakeTimers()
    const createRange = document.createRange.bind(document)
    vi.spyOn(document, 'createRange').mockImplementation(() => Object.assign(createRange(), {
      getClientRects: () => [],
      getBoundingClientRect: () => ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }),
    }))
    const element = document.createElement('div')
    document.body.appendChild(element)
    const doc = new LarkDoc({ element, storage: 'none', content: '<p>原文</p>' })
    try {
      const updates = []
      doc.on('update', payload => updates.push(payload))
      const controller = doc._handle.editorController
      let reads = 0
      controller._snapshotReader = { read(editor, { signal }) {
        reads += 1
        if (reads === 1) return new Promise(resolve => signal.addEventListener('abort', () => resolve(null), { once: true }))
        return Promise.resolve({ html: editor.getHTML(), text: editor.getText(), json: controller.getJSON() })
      } }
      doc.setContent({ type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: 'before_normalize' }, content: [{ type: 'text', text: 'x'.repeat(500001) }] }] })
      await vi.advanceTimersByTimeAsync(2100)
      expect(reads).toBe(1)
      const editor = doc.getEditor()
      const normalize = id => editor.view.dispatch(editor.state.tr.setNodeMarkup(0, undefined, { ...editor.state.doc.firstChild.attrs, blockId: id }).setMeta('larkDocBlockIds', true).setMeta('addToHistory', false))
      normalize('after_normalize')
      await vi.advanceTimersByTimeAsync(2100)
      expect(updates).toHaveLength(1)
      expect(updates[0].json.content[0].attrs.blockId).toBe('after_normalize')
      normalize('metadata_only')
      await vi.advanceTimersByTimeAsync(2100)
      expect(updates).toHaveLength(1)
    } finally { doc.destroy(); element.remove(); vi.useRealTimers() }
  })

  it('does not serialize unchanged immutable blocks again after an edit', async () => {
    const editor = makeEditor('<p>保留</p><p>修改</p>')
    const reader = createDocumentSnapshotReader({ workerFactory: () => null })
    const unchanged = editor.state.doc.firstChild
    const serialize = vi.spyOn(unchanged, 'toJSON')
    await reader.read(editor)
    editor.commands.insertContentAt(unchanged.nodeSize + 1, '新')
    const result = await reader.read(editor)
    expect(serialize).toHaveBeenCalledTimes(1)
    expect(result.text).toBe(editor.getText())
  })

  it('matches Unicode, leaf-space and nested-heading statistics across edits', async () => {
    const editor = makeEditor(mixed)
    const reader = createDocumentStatsReader()
    for (const html of [mixed, '<p>😀𠮷</p><p>é<br>text</p><hr><p></p>', '<ul><li><p>父</p><h2>子标题</h2></li></ul>']) {
      editor.commands.setContent(html)
      const result = await reader.read(editor.state.doc)
      expect(result.characters).toBe(editor.storage.characterCount.characters())
      expect(result.outline).toEqual(collectOutline(editor.state.doc))
    }
    expect(await reader.read(editor.state.doc, () => false)).toBeNull()
  })

  it('v54 keeps maximum heading level from hidden containers through cached edits', async () => {
    const editor = makeEditor('<h4>four</h4><div data-type="callout"><h6>six</h6></div><p>body</p>')
    const reader = createDocumentStatsReader()
    const first = await reader.read(editor.state.doc)
    expect(first.maxHeadingLevel).toBe(6)
    expect(first.outline.map(item => item.text)).toEqual(['four'])
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, 'x')
    expect((await reader.read(editor.state.doc)).maxHeadingLevel).toBe(6)
    editor.commands.setContent('<p>body only</p>')
    expect((await reader.read(editor.state.doc)).maxHeadingLevel).toBe(0)
    expect(await reader.read(editor.state.doc, () => false)).toBeNull()
  })

  it('keeps outline labels aligned with body numbering across cached edits, restart and levels', async () => {
    const editor = makeEditor('<h1 data-numbering="true">你好</h1><h2 data-numbering="true"><strong>子标题😀</strong></h2><blockquote><h1 data-numbering="true">容器标题</h1></blockquote><h1 data-numbering="true" data-numbering-start="7">我也好</h1><h1>3. 原文编号</h1><h1 data-numbering="true">她也好</h1>')
    const reader = createDocumentStatsReader()
    const check = async expected => {
      const doc = editor.state.doc, numbers = computeHeadingNumbers(doc)
      const outline = collectOutline(doc)
      expect(outline.map(item => item.text)).toEqual(expected)
      expect(outline.map(item => item.text)).toEqual(outline.map(item => {
        const text = doc.nodeAt(item.pos).textContent
        return numbers.has(item.pos) ? `${numbers.get(item.pos).label} ${text || '无标题'}` : text
      }))
      const result = await reader.read(doc)
      expect(result.outline).toEqual(outline)
      expect(result.characters).toBe(editor.storage.characterCount.characters())
    }
    await check(['1. 你好', '1.1 子标题😀', '7. 我也好', '3. 原文编号', '8. 她也好'])
    editor.view.dispatch(editor.state.tr.insertText('新版', 1, 3))
    await check(['1. 新版', '1.1 子标题😀', '7. 我也好', '3. 原文编号', '8. 她也好'])
    const immutableLast = editor.state.doc.nodeAt(collectOutline(editor.state.doc).at(-1).pos)
    editor.view.dispatch(editor.state.tr.delete(0, editor.state.doc.firstChild.nodeSize))
    expect(editor.state.doc.nodeAt(collectOutline(editor.state.doc).at(-1).pos)).toBe(immutableLast)
    await check(['1.1 子标题😀', '7. 我也好', '3. 原文编号', '8. 她也好'])
    const second = collectOutline(editor.state.doc)[1].pos
    editor.view.dispatch(editor.state.tr.setNodeMarkup(second, undefined, { ...editor.state.doc.nodeAt(second).attrs, level: 2, numberingStart: null }))
    await check(['1.1 子标题😀', '2.1 我也好', '3. 原文编号', '3. 她也好'])
    editor.view.dispatch(editor.state.tr.setNodeMarkup(second, undefined, { ...editor.state.doc.nodeAt(second).attrs, numbering: false }))
    await check(['1.1 子标题😀', '我也好', '3. 原文编号', '3. 她也好'])
    expect(await reader.read(editor.state.doc, () => false)).toBeNull()
  })

  it('does not drop inline heading text or merge words across soft breaks', async () => {
    const editor = makeEditor('<h1 data-numbering="true">前文<br>后文 <span data-type="mention" data-name="小明" data-token="person"></span> <span data-type="emoji" data-name="check"></span> <span data-type="inline-math" data-latex="x^2"></span></h1>')
    const reader = createDocumentStatsReader()
    expect(collectOutline(editor.state.doc)[0].text).toBe('1. 前文 后文 小明 ✅\uFE0F x^2')
    expect((await reader.read(editor.state.doc)).outline).toEqual(collectOutline(editor.state.doc))
  })
  it('async statistics renumber independent queues from raw cached metadata', async () => {
    const editor = makeEditor('<h1 data-numbering="true">甲</h1><h1 data-numbering="true">乙</h1><h3 data-numbering="true" data-numbering-level="1" data-numbering-start="2">丙</h3><h3 data-numbering="true">丁</h3><div data-type="callout"><h1 data-numbering="true">高亮块</h1></div><h1 data-numbering="true">戊</h1>')
    const reader = createDocumentStatsReader()
    expect((await reader.read(editor.state.doc)).outline.map(item => item.text)).toEqual(['1. 甲', '2. 乙', '2. 丙', '3. 丁', '3. 戊'])
    const target = collectOutline(editor.state.doc)[2].pos
    editor.commands.setLarkDocHeadingNumber(target, { numberingLevel: null, numberingStart: null })
    expect((await reader.read(editor.state.doc)).outline.map(item => item.text)).toEqual(['1. 甲', '2. 乙', '2.1 丙', '2.2 丁', '3. 戊'])
    expect((await reader.read(editor.state.doc)).outline).toEqual(collectOutline(editor.state.doc))
  })

  it('keeps paged outline positions and numbering aligned after a cross-page move', async () => {
    const editor = makeEditor(), controller = createEditorController({ editor }), reader = createDocumentStatsReader()
    await controller.setContentAsync('<h1 data-numbering="true">首节</h1>' + '<p>正文</p>'.repeat(65) + '<h1 data-numbering="true">末节</h1>', { pagedView: true, yieldToMain: async () => {} })
    const before = collectOutline(editor.state.doc)
    expect(before.map(item => item.text)).toEqual(['1. 首节', '2. 末节'])
    expect((await reader.read(editor.state.doc)).outline).toEqual(before)
    expect(editor.storage.larkDoc.pagedView.isDocument(editor.state.doc)).toBe(true)
    const last = before[1], node = editor.state.doc.nodeAt(last.pos)
    expect(moveBlockRange(editor, last.pos, last.pos + node.nodeSize, before[0].pos)).toBe(true)
    expect(collectOutline(editor.state.doc).map(item => item.text)).toEqual(['1. 末节', '2. 首节'])
    expect((await reader.read(editor.state.doc)).outline).toEqual(collectOutline(editor.state.doc))
  })

  it('indexes top-level blocks into stable segments and maps document positions', () => {
    const editor = makeEditor('<h1>章节</h1><p>第一段正文</p><p>第二段正文</p><p>第三段正文</p><p>第四段正文</p>')
    const model = createSegmentedDocumentModel(editor.state.doc, { segmentBlocks: 2 })
    expect(model.segmentCount).toBe(3)
    expect(model.segments.map(segment => [segment.blockStart, segment.blockEnd])).toEqual([[0, 2], [2, 4], [4, 5]])
    expect(model.segmentForBlock(2).index).toBe(1)
    expect(model.segmentForPos(model.blocks[2].from + 1).index).toBe(1)
    expect(model.blocks[0].intrinsicSize).toBe(76)
    expect(model.blocks[1].segment).toBe(0)
  })

  it('computes compact segment metadata in a worker and falls back when it fails', async () => {
    const editor = makeEditor('<p>一</p><p>二</p><h2>三</h2>')
    const model = createSegmentedDocumentModel(editor.state.doc, { segmentBlocks: 2 })
    const terminate = vi.fn()
    const worker = {
      postMessage: vi.fn(message => {
        expect(message.type).toBe('compute')
        queueMicrotask(() => worker.onmessage({ data: {
          type: 'segments',
          heights: new Uint16Array([90, 91, 64]),
          segments: [{ index: 0, blockStart: 0, blockEnd: 2, from: 0, to: 8, blockCount: 2, estimatedHeight: 181, textLength: 2, headingCount: 0 }, { index: 1, blockStart: 2, blockEnd: 3, from: 8, to: 13, blockCount: 1, estimatedHeight: 64, textLength: 1, headingCount: 1 }],
        } }))
      }),
      terminate,
    }
    const result = await createSegmentedDocumentReader({ workerFactory: () => worker }).read(model)
    expect(result.segments).toHaveLength(2)
    expect(result.heights[1]).toBe(91)
    expect(terminate).toHaveBeenCalledTimes(1)
    model.applyWorkerResult(result)
    expect(model.blocks[1].intrinsicSize).toBe(91)

    const failedWorker = {
      postMessage() { queueMicrotask(() => failedWorker.onerror({ preventDefault() {} })) },
      terminate: vi.fn(),
    }
    const failed = await createSegmentedDocumentReader({ workerFactory: () => failedWorker }).read(model)
    expect(failed.segments).toHaveLength(2)
  })

  it('builds a model through the actual worker without first computing metadata on the main thread', async () => {
    const editor = makeEditor('<h1>首</h1>' + '<p>正文内容</p>'.repeat(1300) + '<table><tbody><tr><td><p>尾</p></td></tr></tbody></table>')
    const scope = { postMessage(data) { queueMicrotask(() => worker.onmessage({ data })) } }
    const worker = { postMessage: vi.fn(data => scope.onmessage({ data })), terminate: vi.fn() }
    runInNewContext(segmentedDocumentWorkerSource(), { self: scope })
    const read = vi.spyOn(editor.state.doc, 'child')
    const reader = createSegmentedDocumentReader({ workerFactory: () => worker })
    const model = await reader.create(editor.state.doc)
    expect(read).toHaveBeenCalledTimes(editor.state.doc.childCount)
    expect(worker.postMessage).toHaveBeenCalledOnce()
    expect(worker.terminate).toHaveBeenCalledOnce()
    const reference = createSegmentedDocumentModel(editor.state.doc)
    expect(model.blocks).toEqual(reference.blocks)
    expect(model.segments).toEqual(reference.segments)
    expect(model.segmentTops).toEqual(reference.segmentTops)
  })

  it('yields during descriptor collection and cancels before allocating a worker', async () => {
    const node = { type: { name: 'paragraph' }, nodeSize: 4 }
    const child = vi.fn(() => node)
    const workerFactory = vi.fn(() => null)
    const abort = new AbortController()
    const pending = createSegmentedDocumentReader({ workerFactory }).create({ childCount: 4096, child }, { signal: abort.signal })
    expect(child.mock.calls.length).toBeGreaterThan(0)
    expect(child.mock.calls.length).toBeLessThan(4096)
    abort.abort()
    expect(await pending).toBeNull()
    expect(workerFactory).not.toHaveBeenCalled()
  })

  it('waits for foreground work before descriptor collection and supports a stale release', async () => {
    const child = vi.fn(() => ({ type: { name: 'paragraph' }, nodeSize: 4 }))
    let release
    const paused = new Promise(resolve => { release = resolve })
    const workerFactory = vi.fn(() => null)
    const task = createSegmentedDocumentReader({ workerFactory }).create({ childCount: 8, child }, { waitForBackground: () => paused })
    expect(child).not.toHaveBeenCalled()
    release(false)
    expect(await task).toBeNull()
    expect(workerFactory).not.toHaveBeenCalled()
  })

  it('uses the same sliced builder when Worker is unavailable', async () => {
    const editor = makeEditor('<p>正文</p>'.repeat(1100))
    const asyncModel = await createSegmentedDocumentReader({ workerFactory: () => null }).create(editor.state.doc)
    const reference = createSegmentedDocumentModel(editor.state.doc)
    expect(asyncModel.blocks).toEqual(reference.blocks)
    expect(asyncModel.segments).toEqual(reference.segments)
  })

  it('applies segment and intrinsic-size hints without removing editor DOM nodes', () => {
    const editor = makeEditor('<p>一</p><p>二</p><p>三</p>')
    const host = document.createElement('div')
    host.innerHTML = '<p>一</p><p>二</p><p>三</p>'
    document.body.appendChild(host)
    const model = createSegmentedDocumentModel(editor.state.doc, { segmentBlocks: 2 })
    const controller = createLargeDocumentViewportController({ editorDom: host, model, viewWindow: window })
    controller.refresh()
    expect(host.children).toHaveLength(3)
    expect(host.getAttribute('data-ld-segment-count')).toBe('2')
    expect(host.querySelector('[data-ld-segment-start]')).toBeNull()
    controller.destroy()
    host.remove()
  })

  it('activates only the viewport segments and can reveal a far selection without removing DOM nodes', () => {
    const html = Array.from({ length: 20 }, (_, index) => `<p>${index} 段内容</p>`).join('')
    const editor = makeEditor(html)
    const host = document.createElement('div')
    host.innerHTML = html
    document.body.appendChild(host)
    const model = createSegmentedDocumentModel(editor.state.doc, { segmentBlocks: 2 })
    const listeners = {}
    const viewWindow = {
      innerHeight: 100,
      scrollY: 0,
      addEventListener(type, listener) { listeners[type] = listener },
      removeEventListener() {},
      requestAnimationFrame(callback) { callback(0); return 1 },
      cancelAnimationFrame() {},
    }
    const controller = createLargeDocumentViewportController({ editorDom: host, model, viewWindow })
    expect(host.classList.contains('lark-doc-viewport-managed')).toBe(true)
    expect(host.children).toHaveLength(20)
    controller.ensureForPos(model.blocks[19].from + 1)
    const farSegment = model.segmentForPos(model.blocks[19].from + 1)
    expect(host.getAttribute('data-ld-viewport-end')).toBe(String(farSegment.index))
    expect(typeof listeners.scroll).toBe('function')
    controller.destroy()
    expect(host.classList.contains('lark-doc-viewport-managed')).toBe(false)
    expect(host.children).toHaveLength(20)
    host.remove()
  })

  it('UI updates never toggle editability on the ProseMirror ancestor', async () => {
    const element = document.createElement('div')
    document.body.appendChild(element)
    const doc = new LarkDoc({ element, storage: 'none', content: '<p>正文</p>' })
    const mutations = []
    const container = doc.getEditor().view.dom.parentElement
    const observer = new MutationObserver(records => mutations.push(...records))
    observer.observe(container, { attributes: true, attributeFilter: ['contenteditable'] })
    try {
      doc._handle.nativeHost.host.helpOpen = true
      doc.setReadonly(true)
      await new Promise(resolve => setTimeout(resolve, 30))
      expect(container.hasAttribute('contenteditable')).toBe(false)
      expect(mutations).toHaveLength(0)
      expect(doc.getEditor().isEditable).toBe(false)
    } finally { observer.disconnect(); doc.destroy(); element.remove() }
  })
})
