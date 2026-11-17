import { applyStyle, mountNode, setAttr, setText, syncChildren } from './dom'

const makeButton = (className) => { const node = document.createElement('button'); node.type = 'button'; node.className = className; return node }

/**
 * 指针与键盘共用一条激活通路：`mousedown` 先执行并吞掉随后的合成 `click`，
 * 键盘 Enter/Space 只产生 `click`（无 `mousedown`）也能执行且只执行一次。
 */
const activate = (node, run) => {
  let pointer = false
  node.addEventListener('mousedown', (event) => { event.preventDefault(); pointer = true; run() })
  node.addEventListener('click', (event) => { event.preventDefault(); if (pointer) { pointer = false; return } run() })
}

export function createIsvPanel({ host, onReady, handlers = {} } = {}) {
  let root = null
  let state = {}
  let refs = {}
  let contentSignature = null
  let wasOpen = false
  let readyNotified = false
  const syncInputsAndStyle = () => {
    [['按钮文字', 'buttonText', state.text], ['超链接地址', 'linkUrl', state.link]].forEach(([label, field, value]) => {
      const input = root.querySelector(`[aria-label="${label}"]`)
      if (!input) return
      if (input.value !== (value || '')) input.value = value || ''
      input.classList.toggle('is-error', state.errorField === field)
    })
    // 校验失败只改红框与说明行，不重建内容区（否则正在输入的焦点和光标会丢）。
    const control = root.querySelector('[aria-label="超链接地址"]')?.parentNode
    let explain = control?.querySelector('.lark-doc-isv-field-explain') || null
    if (control && state.errorField === 'linkUrl') {
      if (!explain) { explain = document.createElement('p'); explain.className = 'lark-doc-isv-field-explain'; control.appendChild(explain) }
      setText(explain, state.validationMessage || '')
    } else if (explain) explain.remove()
    applyStyle(root, { ...(state.style || {}), height: `${state.height}px` })
  }
  /**
   * 下拉菜单原地增删 —— 不能进内容区 signature。
   *
   * 开合只是「多一层浮层」，一旦跟着 signature 走就会重建整块内容区，`select` 按钮
   * 换成新节点：收起后回焦到的是另一个元素，`document.activeElement` 与调用方持有的
   * 引用对不上（真机上表现为收起后按键无响应）。
   */
  const focusOption = (delta) => {
    const items = refs.menu ? [].slice.call(refs.menu.querySelectorAll('[role="option"]')) : []
    const at = items.indexOf(document.activeElement)
    items[Math.max(0, Math.min(items.length - 1, at + delta))]?.focus()
  }
  const syncSelectMenu = () => {
    const { actionControl, select } = refs
    if (!actionControl || !select) return
    select.classList.toggle('is-open', !!state.selectOpen)
    if (!state.selectOpen) {
      if (refs.menu) { refs.menu.remove(); refs.menu = null }
      return
    }
    if (refs.menu) return
    const menu = document.createElement('div'); menu.className = 'lark-doc-isv-select-menu'; setAttr(menu, 'role', 'listbox'); setAttr(menu, 'aria-label', '执行操作')
    ;(state.actions || []).forEach((action) => {
      const option = makeButton('lark-doc-isv-select-option')
      setAttr(option, 'role', 'option')
      setAttr(option, 'aria-selected', action.id === state.action ? 'true' : 'false')
      setText(option, action.label)
      activate(option, () => handlers.onAction?.(action.id))
      option.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); handlers.onToggleAction?.(); select.focus() } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); focusOption(e.key === 'ArrowDown' ? 1 : -1) }
      })
      menu.appendChild(option)
    })
    actionControl.appendChild(menu)
    refs.menu = menu
  }
  const build = () => {
    root = document.createElement('div'); root.className = 'lark-doc-isv-overlay'; setAttr(root, 'role', 'dialog'); setAttr(root, 'aria-label', '按钮配置')
    const panel = document.createElement('div'); panel.className = 'lark-doc-isv-button-panel'; const content = document.createElement('div'); content.className = 'lark-doc-isv-panel-content'; panel.appendChild(content)
    const footer = document.createElement('div'); footer.className = 'lark-doc-isv-panel-footer'; const cancel = makeButton('lark-doc-isv-button'); const ok = makeButton('lark-doc-isv-button is-primary'); setText(cancel, '取消'); setText(ok, '确定'); activate(cancel, () => handlers.onClose?.()); activate(ok, () => handlers.onConfirm?.()); footer.append(cancel, ok); panel.appendChild(footer); root.appendChild(panel); return { content }
  }
  const field = (labelText, body, extra = '') => { const wrap = document.createElement('div'); wrap.className = `lark-doc-isv-field${extra ? ` ${extra}` : ''}`; const label = document.createElement('label'); label.className = 'lark-doc-isv-field-label'; setText(label, labelText); wrap.append(label, body); return wrap }
  const render = () => {
    if (!root) refs = build()
    const signature = JSON.stringify([state.color, state.colors, state.action, state.actionLabel, state.actions, state.needsLink])
    if (signature === contentSignature) { syncSelectMenu(); syncInputsAndStyle(); return }
    contentSignature = signature
    const content = refs.content; const slots = []
    const text = document.createElement('div'); text.className = 'lark-doc-isv-field-control'; const input = document.createElement('input'); input.className = 'lark-doc-isv-input'; input.type = 'text'; input.maxLength = 20; setAttr(input, 'aria-label', '按钮文字'); setAttr(input, 'placeholder', '请输入按钮'); input.value = state.text || ''; input.classList.toggle('is-error', state.errorField === 'buttonText'); input.addEventListener('input', handlers.onText); input.addEventListener('keydown', (e) => { if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return; e.preventDefault(); handlers.onConfirm?.() }); text.appendChild(input); slots.push({ node: field('按钮文字', text), on: true })
    const colorControl = document.createElement('div'); colorControl.className = 'lark-doc-isv-field-control'; const picker = document.createElement('div'); picker.className = 'lark-doc-isv-color-picker'; (state.colors || []).forEach((row) => { const rowNode = document.createElement('div'); rowNode.className = 'lark-doc-isv-color-row'; (row || []).forEach((color) => { const swatch = makeButton('lark-doc-isv-color-item'); swatch.style.backgroundColor = color.value; setAttr(swatch, 'aria-label', color.label); setAttr(swatch, 'title', color.label); swatch.classList.toggle('is-active', state.color === color.value); activate(swatch, () => handlers.onColor?.(color.value)); rowNode.appendChild(swatch) }); picker.appendChild(rowNode) }); colorControl.appendChild(picker); slots.push({ node: field('按钮颜色', colorControl, 'is-color'), on: true })
    const actionControl = document.createElement('div'); actionControl.className = 'lark-doc-isv-field-control'; const select = makeButton('lark-doc-isv-select'); setAttr(select, 'aria-label', '执行操作'); const value = document.createElement('span'); value.className = 'lark-doc-isv-select-value'; setText(value, state.actionLabel); const arrow = document.createElement('span'); arrow.className = 'lark-doc-isv-select-arrow'; setAttr(arrow, 'aria-hidden', 'true'); select.append(value, arrow); activate(select, () => handlers.onToggleAction?.()); actionControl.appendChild(select)
    // 内容区重建会换掉 `select`，下拉浮层必须跟着重新挂到新节点上。
    refs.select = select; refs.actionControl = actionControl; refs.menu = null
    slots.push({ node: field('执行操作', actionControl), on: true })
    if (state.needsLink) { const linkControl = document.createElement('div'); linkControl.className = 'lark-doc-isv-field-control'; const link = document.createElement('input'); link.className = 'lark-doc-isv-input'; link.type = 'text'; setAttr(link, 'aria-label', '超链接地址'); setAttr(link, 'placeholder', '请输入链接地址'); link.value = state.link || ''; link.classList.toggle('is-error', state.errorField === 'linkUrl'); link.addEventListener('input', handlers.onLink); link.addEventListener('keydown', (e) => { if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return; e.preventDefault(); handlers.onConfirm?.() }); linkControl.appendChild(link); if (state.errorField === 'linkUrl') { const explain = document.createElement('p'); explain.className = 'lark-doc-isv-field-explain'; setText(explain, state.validationMessage); linkControl.appendChild(explain) } slots.push({ node: field('超链接地址', linkControl), on: true }) }
    syncChildren(content, slots); syncSelectMenu(); syncInputsAndStyle()
  }
  const focusText = () => root?.querySelector('[aria-label="按钮文字"]')?.focus()
  return {
    get el() { return root },
    update(patch = {}) {
      state = { ...state, ...patch }
      if (!state.open) { if (root) mountNode(host, root, false); wasOpen = false; return }
      if (!root) refs = build()
      render(); mountNode(host, root, true)
      // 首次可见：把焦点交给「按钮文字」，并只通知一次 ready（宿主据此定位面板）。
      if (!wasOpen) {
        wasOpen = true
        focusText()
        if (!readyNotified) { readyNotified = true; onReady?.() }
      }
    },
    focusText,
    destroy() { if (root) mountNode(host, root, false); root = null; wasOpen = false },
  }
}
