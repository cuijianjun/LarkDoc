/**
 * 标题 / 列表编号菜单 —— `editor/dialogs/HeadingNumberMenu.vue` 的原生等价物（阶段 5）。
 *
 * 结构与 SFC 逐字段一致：菜单根、三颗带图标的 menuitem，或就地数字输入与上下
 * spinner。`open` / `editing` 都是 v-if 语义，节点不显示时真的摘掉；业务状态与写入
 * 文档的动作仍由 headingNumberMixin 持有，本模块只负责 DOM 和事件转发。
 */
import { applyStyle, mountNode, setAttr, syncChildren } from './dom'
import { iconNode } from './icon'

function handlerCaller(handlers) {
  return (name, ...args) => {
    const fn = handlers[name]
    return typeof fn === 'function' ? fn(...args) : undefined
  }
}

function actionsSignature(actions) {
  return (actions || []).map((action) => `${action.id}:${action.icon}:${action.label}`).join('|')
}

function setClass(node, name, on) {
  if (node.classList.contains(name) !== !!on) node.classList.toggle(name, !!on)
}

/**
 * @param {{host: HTMLElement|null, handlers?: Record<string, Function>}} options
 * @returns {{el: HTMLElement, update: (patch?: object) => void, destroy: () => void}}
 */
export function createHeadingNumberMenu({ host, handlers } = {}) {
  const call = handlerCaller(handlers || {})
  const state = {
    open: false,
    editing: false,
    style: {},
    draft: '',
    actions: [],
    disabled: {},
  }

  const el = document.createElement('div')
  el.className = 'lark-doc-heading-number-menu'
  el.setAttribute('role', 'menu')
  el.setAttribute('aria-label', '编号设置')
  el.addEventListener('mousedown', (event) => event.preventDefault())

  const editor = document.createElement('label')
  editor.className = 'lark-doc-heading-number-editor'

  const input = document.createElement('input')
  input.className = 'lark-doc-heading-number-input'
  input.type = 'text'
  input.setAttribute('inputmode', 'numeric')
  input.setAttribute('aria-label', '编号值')
  input.addEventListener('input', () => call('onDraft', input.value))
  input.addEventListener('keydown', (event) => call('onKeydown', event))
  input.addEventListener('blur', () => call('onApply'))

  const spinner = document.createElement('span')
  spinner.className = 'lark-doc-heading-number-spinner'
  spinner.setAttribute('aria-hidden', 'true')

  const increase = document.createElement('button')
  increase.type = 'button'
  increase.tabIndex = -1
  increase.setAttribute('aria-label', '增加编号')
  increase.addEventListener('click', () => call('onStep', 1))
  increase.appendChild(iconNode('chevronUp', 10))

  const decrease = document.createElement('button')
  decrease.type = 'button'
  decrease.tabIndex = -1
  decrease.setAttribute('aria-label', '减少编号')
  decrease.addEventListener('click', () => call('onStep', -1))
  decrease.appendChild(iconNode('chevronDown', 10))

  spinner.appendChild(increase)
  spinner.appendChild(decrease)
  editor.appendChild(input)
  editor.appendChild(spinner)

  let actionNodes = []
  let actionSignature = ''

  function buildActions() {
    const nextSignature = actionsSignature(state.actions)
    if (nextSignature === actionSignature) return
    actionSignature = nextSignature
    actionNodes = (state.actions || []).map((action) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'lark-doc-heading-number-item'
      button.setAttribute('role', 'menuitem')
      button.setAttribute('data-menu-id', action.id)
      button.appendChild((() => {
        const icon = document.createElement('span')
        icon.className = 'lark-doc-heading-number-icon'
        icon.setAttribute('aria-hidden', 'true')
        icon.appendChild(iconNode(action.icon, 18))
        return icon
      })())
      const text = document.createElement('span')
      text.className = 'lark-doc-heading-number-text'
      text.textContent = action.label
      button.appendChild(text)
      button.addEventListener('click', () => call('onAction', action.id))
      return { node: button, action }
    })
  }

  function paintActions() {
    actionNodes.forEach(({ node, action }) => {
      const disabled = !!state.disabled[action.id]
      setClass(node, 'is-disabled', disabled)
      node.disabled = disabled
      setAttr(node, 'aria-disabled', disabled ? 'true' : 'false')
    })
  }

  function render() {
    buildActions()
    paintActions()
    setClass(el, 'is-editing', state.editing)
    applyStyle(el, state.style)
    if (input.value !== String(state.draft === null || state.draft === undefined ? '' : state.draft)) input.value = state.draft
    syncChildren(el, state.editing
      ? [{ node: editor, on: true }]
      : actionNodes.map(({ node }) => ({ node, on: true })))
    mountNode(host, el, state.open)
  }

  render()

  return {
    el,
    update(patch) {
      if (!patch) return
      Object.keys(patch).forEach((key) => {
        if (key in state) state[key] = patch[key]
      })
      render()
    },
    destroy() {
      if (el.parentNode) el.parentNode.removeChild(el)
    },
  }
}
