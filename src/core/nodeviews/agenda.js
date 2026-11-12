/** Agenda text stays in ProseMirror; only duration and removal are NodeView controls. */
export const validAgendaDuration = value => Number.isSafeInteger(value) && value >= 1
export function agendaWritable(editor) {
  const extension = editor.extensionManager.extensions.find(item => item.name === 'agenda')
  return !editor.isDestroyed && editor.isEditable && extension?.options?.isEnabled?.() !== false
}

export function createAgendaItemNodeView({ node, editor, getPos }) {
  const dom = document.createElement('div')
  dom.dataset.type = 'agenda-item'
  const tools = document.createElement('div')
  tools.className = 'lark-doc-agenda-tools'
  tools.contentEditable = 'false'
  const label = document.createElement('span')
  label.className = 'lark-doc-agenda-duration-label'
  const duration = document.createElement('input')
  duration.type = 'number'
  duration.min = '1'
  duration.step = '1'
  duration.setAttribute('aria-label', '议程时长（分钟）')
  const unit = document.createElement('span')
  unit.textContent = '分钟'
  const remove = document.createElement('button')
  remove.type = 'button'
  remove.className = 'lark-doc-agenda-remove'
  remove.setAttribute('aria-label', '删除议程项')
  remove.textContent = '×'
  const contentDOM = document.createElement('div')
  contentDOM.className = 'lark-doc-agenda-fields'
  contentDOM.dataset.type = 'agenda-fields'
  tools.append(label, duration, unit, remove)
  dom.append(tools, contentDOM)
  let destroyed = false
  function position() {
    if (destroyed || !agendaWritable(editor)) return null
    try {
      const pos = getPos(), current = Number.isInteger(pos) && editor.state.doc.nodeAt(pos)
      return current?.type === node.type && current.eq(node) ? pos : null
    } catch (_) { return null }
  }
  function paint() {
    const writable = agendaWritable(editor)
    dom.dataset.itemId = node.attrs.itemId || ''
    dom.dataset.durationMinutes = String(node.attrs.durationMinutes)
    dom.dataset.agendaEditable = String(writable)
    label.textContent = `${node.attrs.durationMinutes} 分钟`
    duration.disabled = remove.disabled = !writable
    if (document.activeElement !== duration || !writable) duration.value = String(node.attrs.durationMinutes)
  }
  function commit() {
    const pos = position(), value = Number(duration.value)
    if (pos !== null && validAgendaDuration(value)) editor.commands.setAgendaDuration(pos, value)
    duration.value = String(node.attrs.durationMinutes)
  }
  duration.addEventListener('change', commit)
  duration.addEventListener('blur', commit)
  duration.addEventListener('keydown', event => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault(); event.stopPropagation()
      if (agendaWritable(editor)) editor.commands[event.shiftKey ? 'redo' : 'undo']?.()
      duration.value = String(node.attrs.durationMinutes)
      return
    }
    if (event.key !== 'Escape' && event.key !== 'Enter') return
    event.preventDefault()
    event.stopPropagation()
    if (event.key === 'Enter') commit()
    else duration.value = String(node.attrs.durationMinutes)
    editor.view.focus()
  })
  remove.addEventListener('mousedown', event => event.preventDefault())
  remove.addEventListener('click', () => {
    const pos = position()
    if (pos !== null && editor.commands.removeAgendaItem(pos)) editor.view.focus()
  })
  editor.storage.agenda.refreshers.add(paint)
  editor.on('transaction', paint)
  editor.on('update', paint)
  paint()
  return {
    dom, contentDOM,
    update(next) { if (next.type !== node.type) return false; if (next.attrs.durationMinutes !== node.attrs.durationMinutes) duration.value = String(next.attrs.durationMinutes); node = next; paint(); return true },
    stopEvent(event) { return tools.contains(event.target) },
    ignoreMutation(mutation) { return mutation.type !== 'selection' && !contentDOM.contains(mutation.target) },
    destroy() { destroyed = true; editor.storage.agenda.refreshers.delete(paint); editor.off('transaction', paint); editor.off('update', paint) },
  }
}
