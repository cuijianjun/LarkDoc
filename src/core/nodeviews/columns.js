/** Column controls are DOM projections; only completed gestures dispatch document changes. */
import { closeHistory } from '@tiptap/pm/history'
export const validColumnWidth = width => Number.isFinite(width) && width > 0 && width <= 100
export function columnLayoutWritable(editor) {
  const extension = editor.extensionManager.extensions.find(item => item.name === 'columns')
  return !editor.isDestroyed && editor.isEditable && extension?.options?.isEnabled?.() !== false
}

export function createColumnsNodeView({ node, editor }) {
  const dom = document.createElement('div')
  dom.setAttribute('data-type', 'columns')
  const paint = current => {
    dom.dataset.columnsEditable = String(columnLayoutWritable(editor))
    if (current.attrs.blockId) dom.setAttribute('data-block-id', current.attrs.blockId)
    else dom.removeAttribute('data-block-id')
  }
  const refresh = () => paint(node)
  editor.storage.columns.refreshers.add(refresh)
  editor.on('transaction', refresh)
  editor.on('update', refresh)
  paint(node)
  return {
    dom, contentDOM: dom,
    update(next) { if (next.type !== node.type) return false; node = next; paint(node); return true },
    ignoreMutation(mutation) { return mutation.type === 'attributes' && mutation.target === dom },
    destroy() { editor.storage.columns.refreshers.delete(refresh); editor.off('transaction', refresh); editor.off('update', refresh) },
  }
}

export function createColumnNodeView({ node, editor, getPos }) {
  const dom = document.createElement('div')
  dom.setAttribute('data-type', 'column')
  const contentDOM = document.createElement('div')
  contentDOM.className = 'lark-doc-column-content'
  const tools = document.createElement('div')
  tools.className = 'lark-doc-column-tools'
  tools.contentEditable = 'false'
  const add = document.createElement('button')
  add.type = 'button'
  add.className = 'lark-doc-column-add'
  add.setAttribute('aria-label', '添加一栏')
  add.setAttribute('data-tooltip', '添加一栏')
  add.textContent = '+'
  const divider = document.createElement('div')
  divider.className = 'lark-doc-column-divider'
  divider.setAttribute('role', 'separator')
  divider.setAttribute('aria-label', '调整分栏宽度')
  divider.setAttribute('aria-orientation', 'vertical')
  const percentage = document.createElement('span')
  percentage.className = 'lark-doc-column-percentage'
  percentage.contentEditable = 'false'
  tools.append(add, divider)
  dom.append(contentDOM, tools, percentage)
  let resize = null, destroyed = false
  function paint() {
    dom.style.flexGrow = String(node.attrs.width)
    dom.dataset.width = String(node.attrs.width)
    percentage.textContent = `${Math.round(node.attrs.width)}%`
  }
  function position() {
    if (destroyed) return null
    try {
      const pos = getPos()
      const live = Number.isInteger(pos) && editor.state.doc.nodeAt(pos)
      return live?.type === node.type && live.eq(node) ? pos : null
    } catch (_) { return null }
  }
  function cancelResize() {
    if (!resize) return
    const previous = resize
    resize = null
    dom.classList.remove('is-resizing')
    dom.parentElement?.classList.remove('is-resizing')
    paint()
    previous.columns.forEach(column => {
      column.element.style.flexGrow = column.style
      column.element.querySelector('.lark-doc-column-percentage').textContent = `${Math.round(column.width)}%`
    })
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', finish)
    window.removeEventListener('pointercancel', cancelResize)
    window.removeEventListener('keydown', escape, true)
  }
  function contextChanged({ transaction } = {}) {
    if (resize && (!columnLayoutWritable(editor) || transaction?.docChanged)) cancelResize()
  }
  function escape(event) { if (event.key === 'Escape' && resize) { event.preventDefault(); event.stopPropagation(); cancelResize() } }
  function move(event) {
    if (!resize) return
    if (!columnLayoutWritable(editor) || editor.state.doc !== resize.doc) { cancelResize(); return }
    const total = resize.firstWidth + resize.secondWidth
    // Source clamps both two- and five-column layouts to one of 24 width units.
    const min = Math.min(100 / 24, total / 2)
    const width = Math.max(min, Math.min(total - min, resize.firstWidth + (event.clientX - resize.startX) / resize.pixels * 100))
    resize.value = Math.abs(width - resize.firstWidth) < 1e-7 ? null : width
    dom.style.flexGrow = String(width)
    resize.next.style.flexGrow = String(total - width)
    percentage.textContent = `${Math.round(width)}%`
    resize.next.querySelector('.lark-doc-column-percentage').textContent = `${Math.round(total - width)}%`
  }
  function finish() {
    const previous = resize
    if (!previous) return
    const live = position(), nextNode = editor.state.doc.nodeAt(previous.nextPos)
    const commit = !destroyed && columnLayoutWritable(editor) && editor.state.doc === previous.doc && live === previous.pos && nextNode === previous.second && previous.value !== null
    cancelResize()
    if (!commit) return
    const tr = closeHistory(editor.state.tr)
    previous.columns.forEach(column => {
      const width = column.pos === live ? previous.value : column.pos === previous.nextPos ? previous.firstWidth + previous.secondWidth - previous.value : column.width
      if (Math.abs(width - column.node.attrs.width) > 1e-9) tr.setNodeMarkup(column.pos, undefined, { ...column.node.attrs, width })
    })
    editor.view.dispatch(tr)
  }
  divider.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !columnLayoutWritable(editor)) return
    const pos = position(), next = dom.nextElementSibling
    if (pos === null || !next?.matches('[data-type="column"]')) return
    const nextPos = pos + node.nodeSize, second = editor.state.doc.nodeAt(nextPos)
    const pixels = dom.parentElement.getBoundingClientRect().width
    if (!second || second.type.name !== 'column' || pixels <= 0) return
    event.preventDefault()
    cancelResize()
    editor.view.focus()
    const $pos = editor.state.doc.resolve(pos), parent = $pos.parent, columns = []
    let total = 0
    parent.forEach(column => { total += column.attrs.width })
    parent.forEach((column, offset, index) => {
      const element = dom.parentElement.children[index]
      const width = Math.abs(total - 100) < 1e-7 ? column.attrs.width : column.attrs.width / total * 100
      columns.push({ node: column, pos: $pos.start() + offset, element, style: element.style.flexGrow, width })
      element.style.flexGrow = String(width)
    })
    resize = { pos, nextPos, second, columns, firstWidth: columns[$pos.index()].width, secondWidth: columns[$pos.index() + 1].width, startX: event.clientX, pixels, next, value: null, doc: editor.state.doc }
    dom.classList.add('is-resizing')
    dom.parentElement.classList.add('is-resizing')
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', cancelResize)
    window.addEventListener('keydown', escape, true)
  })
  add.addEventListener('pointerdown', event => event.preventDefault())
  add.addEventListener('click', () => {
    const pos = position()
    if (pos !== null && columnLayoutWritable(editor) && editor.commands.addLayoutColumn(pos)) editor.view.focus()
  })
  editor.storage.columns.refreshers.add(contextChanged)
  editor.on('transaction', contextChanged)
  editor.on('update', contextChanged)
  paint()
  return {
    dom, contentDOM,
    update(next) { if (next.type !== node.type) return false; if (resize) cancelResize(); node = next; paint(); return true },
    stopEvent(event) { return tools.contains(event.target) },
    ignoreMutation(mutation) { return mutation.type !== 'selection' && !contentDOM.contains(mutation.target) },
    destroy() { destroyed = true; cancelResize(); editor.storage.columns.refreshers.delete(contextChanged); editor.off('transaction', contextChanged); editor.off('update', contextChanged) },
  }
}
