import { applyStyle, mountNode, setAttr, setText, syncChildren } from './dom'

const makeButton = className => { const node = document.createElement('button'); node.type = 'button'; node.className = className; return node }

export function createIsvPanel({ host, handlers = {} } = {}) {
  let root = null, refs = null
  let state = {}
  const composing = new Set(), colors = new Map(), actions = new Map()
  const activate = (button, handler) => {
    button.addEventListener('mousedown', event => event.preventDefault())
    button.addEventListener('click', handler)
  }
  const field = (labelText, body, extra = '') => {
    const wrap = document.createElement('div')
    wrap.className = `lark-doc-isv-field${extra ? ` ${extra}` : ''}`
    const label = document.createElement('label')
    label.className = 'lark-doc-isv-field-label'
    setText(label, labelText)
    wrap.append(label, body)
    return wrap
  }
  const control = () => { const node = document.createElement('div'); node.className = 'lark-doc-isv-field-control'; return node }
  const input = (label, placeholder, handler) => {
    const node = document.createElement('input')
    node.className = 'lark-doc-isv-input'
    node.type = 'text'
    setAttr(node, 'aria-label', label)
    setAttr(node, 'placeholder', placeholder)
    node.addEventListener('compositionstart', () => composing.add(node))
    node.addEventListener('compositionend', event => { composing.delete(node); handler?.(event) })
    node.addEventListener('input', event => { if (!composing.has(node) && !event.isComposing) handler?.(event) })
    node.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.isComposing && event.keyCode !== 229 && !composing.has(node)) {
        event.preventDefault(); event.stopPropagation(); handlers.onConfirm?.()
      }
    })
    return node
  }
  const build = () => {
    root = document.createElement('div')
    root.className = 'lark-doc-isv-overlay'
    setAttr(root, 'role', 'dialog'); setAttr(root, 'aria-label', '按钮配置')
    const panel = document.createElement('div')
    panel.className = 'lark-doc-isv-button-panel'
    const content = document.createElement('div')
    content.className = 'lark-doc-isv-panel-content'
    const text = input('按钮文字', '请输入按钮', handlers.onText)
    text.maxLength = 20
    const textControl = control()
    textControl.append(text)
    const colorControl = control(), picker = document.createElement('div')
    picker.className = 'lark-doc-isv-color-picker'
    colorControl.append(picker)
    const actionControl = control(), select = makeButton('lark-doc-isv-select')
    setAttr(select, 'aria-label', '执行操作'); setAttr(select, 'aria-haspopup', 'listbox')
    const value = document.createElement('span'), arrow = document.createElement('span')
    value.className = 'lark-doc-isv-select-value'; arrow.className = 'lark-doc-isv-select-arrow'
    setAttr(arrow, 'aria-hidden', 'true')
    select.append(value, arrow)
    activate(select, () => handlers.onToggleAction?.())
    const menu = document.createElement('div')
    menu.className = 'lark-doc-isv-select-menu'
    setAttr(menu, 'role', 'listbox'); setAttr(menu, 'aria-label', '执行操作')
    select.addEventListener('keydown', event => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
      event.preventDefault()
      if (!state.selectOpen) handlers.onToggleAction?.()
      // The host batches state updates; focus only after its render has mounted the menu.
      queueMicrotask(() => { if (state.selectOpen && root?.isConnected) (event.key === 'ArrowUp' ? menu.lastElementChild : menu.firstElementChild)?.focus() })
    })
    menu.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); handlers.onToggleAction?.(); select.focus(); return }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
      event.preventDefault(); event.stopPropagation()
      const options = Array.from(menu.children), index = options.indexOf(document.activeElement)
      options[(index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length]?.focus()
    })
    actionControl.append(select)
    const link = input('超链接地址', '请输入链接地址', handlers.onLink), linkControl = control()
    const explain = document.createElement('p')
    explain.className = 'lark-doc-isv-field-explain'
    linkControl.append(link)
    const linkField = field('超链接地址', linkControl)
    content.append(field('按钮文字', textControl), field('按钮颜色', colorControl, 'is-color'), field('执行操作', actionControl))
    const footer = document.createElement('div')
    footer.className = 'lark-doc-isv-panel-footer'
    const cancel = makeButton('lark-doc-isv-button'), ok = makeButton('lark-doc-isv-button is-primary')
    setText(cancel, '取消'); setText(ok, '确定')
    activate(cancel, () => handlers.onClose?.()); activate(ok, () => handlers.onConfirm?.())
    footer.append(cancel, ok); panel.append(content, footer); root.append(panel)
    refs = { content, text, picker, select, value, actionControl, menu, link, linkControl, linkField, explain }
  }
  const render = () => {
    for (const [node, value] of [[refs.text, state.text], [refs.link, state.link]]) {
      const next = value || ''
      if (!composing.has(node) && node.value !== next) node.value = next
    }
    refs.text.classList.toggle('is-error', state.errorField === 'buttonText')
    refs.link.classList.toggle('is-error', state.errorField === 'linkUrl')
    const rows = (state.colors || []).map((row, index) => {
      let rowNode = refs.picker.children[index]
      if (!rowNode) { rowNode = document.createElement('div'); rowNode.className = 'lark-doc-isv-color-row' }
      syncChildren(rowNode, (row || []).map(color => {
        let swatch = colors.get(color.value)
        if (!swatch) { swatch = makeButton('lark-doc-isv-color-item'); activate(swatch, () => handlers.onColor?.(color.value)); colors.set(color.value, swatch) }
        swatch.style.backgroundColor = color.value
        setAttr(swatch, 'aria-label', color.label); setAttr(swatch, 'title', color.label)
        setAttr(swatch, 'aria-pressed', state.color === color.value ? 'true' : 'false')
        swatch.classList.toggle('is-active', state.color === color.value)
        return { node: swatch, on: true }
      }))
      return { node: rowNode, on: true }
    })
    syncChildren(refs.picker, rows)
    setText(refs.value, state.actionLabel)
    refs.select.classList.toggle('is-open', !!state.selectOpen)
    setAttr(refs.select, 'aria-expanded', state.selectOpen ? 'true' : 'false')
    syncChildren(refs.menu, (state.actions || []).map(action => {
      let option = actions.get(action.id)
      if (!option) { option = makeButton('lark-doc-isv-select-option'); setAttr(option, 'role', 'option'); activate(option, () => { handlers.onAction?.(action.id); refs.select.focus() }); actions.set(action.id, option) }
      setAttr(option, 'aria-selected', action.id === state.action ? 'true' : 'false'); setText(option, action.label)
      return { node: option, on: true }
    }))
    mountNode(refs.actionControl, refs.menu, !!state.selectOpen)
    setText(refs.explain, state.validationMessage)
    mountNode(refs.linkControl, refs.explain, state.errorField === 'linkUrl')
    mountNode(refs.content, refs.linkField, !!state.needsLink)
    applyStyle(root, { ...(state.style || {}), height: `${state.height}px` })
  }
  return {
    update(patch = {}) {
      const opening = !state.open && patch.open
      state = { ...state, ...patch }
      if (!state.open) { if (root) mountNode(host, root, false); composing.clear(); return }
      if (!root) build()
      render(); mountNode(host, root, true)
      if (opening) refs.text.focus({ preventScroll: true })
    },
    destroy() { if (root) mountNode(host, root, false); root = refs = null; composing.clear(); colors.clear(); actions.clear() },
  }
}
