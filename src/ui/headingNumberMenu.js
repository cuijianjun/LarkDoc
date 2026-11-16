import { HEADING_VALUE_MAX, HEADING_NUMBER_MAX } from '../core/documentOperations'
/**
 * 标题 / 列表编号菜单 —— `editor/dialogs/HeadingNumberMenu.vue` 的原生等价物（阶段 5）。
 *
 * 结构与 SFC 逐字段一致：菜单根、三颗带图标的 menuitem，或就地数字输入与上下
 * spinner。`open` / `editing` 都是 v-if 语义，节点不显示时真的摘掉；业务状态与写入
 * 文档的动作仍由 headingNumberMixin 持有，本模块只负责 DOM 和事件转发。
 */
import { applyStyle, mountNode, setAttr, syncChildren } from './dom'
import { iconNode } from './icon'
import { placeMenu } from './menuLayout'

function handlerCaller(handlers) {
  return (name, ...args) => {
    const fn = handlers[name]
    return typeof fn === 'function' ? fn(...args) : undefined
  }
}

function actionsSignature(actions) {
  return JSON.stringify(actions || [])
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
    prefix: '',
    target: null,
    actions: [],
    disabled: {},
  }

  const el = document.createElement('div')
  el.className = 'lark-doc-heading-number-menu'
  el.setAttribute('role', 'menu')
  el.setAttribute('aria-label', '编号设置')
  el.addEventListener('mousedown', (event) => event.preventDefault())
  const isComposing = event => event.isComposing || event.keyCode === 229
  el.addEventListener('keydown', event => { if (isComposing(event)) event.stopPropagation() })

  const editor = document.createElement('label')
  editor.className = 'lark-doc-heading-number-editor'
  const caption = document.createElement('span')
  caption.className = 'lark-doc-heading-number-caption'
  caption.textContent = '当前编号'
  const prefix = document.createElement('span')
  prefix.className = 'lark-doc-heading-number-prefix'

  const input = document.createElement('input')
  input.className = 'lark-doc-heading-number-input'
  input.type = 'text'
  input.setAttribute('inputmode', 'numeric')
  input.setAttribute('aria-label', '编号值')
  input.addEventListener('input', () => call('onDraft', input.value))
  input.addEventListener('keydown', (event) => call('onKeydown', event))
  // 与飞书一致：仅 Enter / 确定写入；失焦不能把旧草稿提交到新打开的编号目标。

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
  editor.prepend(caption, prefix)
  const confirm = document.createElement('button')
  confirm.type = 'button'
  confirm.textContent = '确定'
  confirm.setAttribute('aria-label', '确定编号')
  confirm.addEventListener('mousedown', event => event.preventDefault())
  confirm.addEventListener('click', () => call('onApply'))
  editor.appendChild(confirm)

  let restartMenu = null, restartTrigger = null, leaveTimer = null
  const cancelLeave = () => { clearTimeout(leaveTimer); leaveTimer = null }
  function closeRestart() {
    cancelLeave()
    restartTrigger?.setAttribute('aria-expanded', 'false')
    restartMenu?.remove()
    restartMenu = null; restartTrigger = null
  }
  const scheduleLeave = () => { cancelLeave(); leaveTimer = setTimeout(closeRestart, 120) }
  el.addEventListener('mouseenter', cancelLeave)
  el.addEventListener('mouseleave', scheduleLeave)
  function openRestart(action, trigger) {
    if (!host || state.disabled[action.id]) return
    closeRestart()
    restartTrigger = trigger
    const target = state.target
    restartMenu = document.createElement('div')
    restartMenu.className = 'lark-doc-heading-number-menu'
    restartMenu.style.width = 'max-content'
    restartMenu.setAttribute('role', 'menu')
    restartMenu.setAttribute('aria-label', '重新开始编号')
    restartMenu.addEventListener('mousedown', event => event.preventDefault())
    restartMenu.addEventListener('mouseenter', cancelLeave)
    restartMenu.addEventListener('mouseleave', scheduleLeave)
    action.children.forEach(child => {
      const button = document.createElement('button')
      button.type = 'button'; button.className = 'lark-doc-heading-number-item'
      button.setAttribute('role', 'menuitem'); button.textContent = child.label
      button.disabled = !!state.disabled[child.id]
      button.addEventListener('click', () => { closeRestart(); if (state.target === target && !state.disabled[child.id]) call('onAction', child.id) })
      restartMenu.appendChild(button)
    })
    restartMenu.addEventListener('keydown', event => {
      if (isComposing(event)) { event.stopPropagation(); return }
      if (event.key === 'Escape' || event.key === 'ArrowLeft') {
        event.preventDefault(); event.stopPropagation(); closeRestart(); trigger.focus()
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const choices = [...restartMenu.querySelectorAll('button:not(:disabled)')]
        const index = choices.indexOf(restartMenu.ownerDocument.activeElement)
        choices[(index + (event.key === 'ArrowDown' ? 1 : choices.length - 1)) % choices.length]?.focus()
      }
    })
    host.appendChild(restartMenu)
    trigger.setAttribute('aria-expanded', 'true')
    const rect = trigger.getBoundingClientRect(), win = trigger.ownerDocument.defaultView
    const width = restartMenu.getBoundingClientRect().width || 192
    const right = (win.visualViewport?.offsetLeft || 0) + (win.visualViewport?.width || win.innerWidth)
    const left = rect.right + width + 12 <= right ? rect.right + 4 : rect.left - width - 4
    placeMenu(restartMenu, { left, right: left + width, top: rect.top, bottom: rect.top }, 8, { gap: 0 })
  }

  let actionNodes = []
  let actionSignature = ''

  function buildActions() {
    const nextSignature = actionsSignature(state.actions)
    if (nextSignature === actionSignature) return
    closeRestart()
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
      if (action.children) {
        button.setAttribute('aria-haspopup', 'menu')
        button.setAttribute('aria-expanded', 'false')
        button.appendChild(iconNode('chevronRight', 14))
      }
      button.addEventListener('mouseenter', () => action.children ? openRestart(action, button) : closeRestart())
      button.addEventListener('click', () => action.children ? openRestart(action, button) : call('onAction', action.id))
      button.addEventListener('keydown', event => {
        if (event.key === 'ArrowRight' && action.children && !isComposing(event)) {
          event.preventDefault(); openRestart(action, button); restartMenu?.querySelector('button:not(:disabled)')?.focus()
        }
      })
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
    prefix.textContent = state.prefix
    prefix.hidden = !state.prefix
    if (!state.open || state.editing) closeRestart()
    if (input.value !== String(state.draft === null || state.draft === undefined ? '' : state.draft)) input.value = state.draft
    syncChildren(el, state.editing
      ? [{ node: editor, on: true }]
      : actionNodes.map(({ node }) => ({ node, on: true })))
    mountNode(host, el, state.open)
  }

  const win = el.ownerDocument.defaultView
  const reposition = () => { closeRestart(); if (state.open) call('onReposition') }
  const onScroll = event => {
    if (!state.open || (event.target?.nodeType && (el.contains(event.target) || restartMenu?.contains(event.target)))) return
    call('onClose')
  }
  win.addEventListener('resize', reposition)
  win.visualViewport?.addEventListener('resize', reposition)
  win.visualViewport?.addEventListener('scroll', reposition)
  win.addEventListener('scroll', onScroll, true)

  render()

  return {
    el,
    update(patch) {
      if (!patch) return
      if (('target' in patch && patch.target !== state.target) || ('disabled' in patch && JSON.stringify(patch.disabled) !== JSON.stringify(state.disabled))) closeRestart()
      Object.keys(patch).forEach((key) => {
        if (key in state) state[key] = patch[key]
      })
      render()
    },
    destroy() {
      closeRestart()
      win.removeEventListener('resize', reposition)
      win.visualViewport?.removeEventListener('resize', reposition)
      win.visualViewport?.removeEventListener('scroll', reposition)
      win.removeEventListener('scroll', onScroll, true)
      if (el.parentNode) el.parentNode.removeChild(el)
    },
  }
}

/** 菜单加载后才创建控制器；不排队执行业务动作，销毁后不再操作文档。 */
export function createHeadingNumberRuntime(host) {
  const methods = {
    viewState() {
      const menu = this.headingNumberMenu || {}, actions = this._headingNumberRuntime.actions(), disabled = {}
      actions.forEach(action => { disabled[action.id] = this._headingNumberRuntime.headingNumberMenuDisabled(action.id) })
      disabled['restart-prefix'] = this._headingNumberRuntime.headingNumberMenuDisabled('restart-prefix')
      return {
        open: !!menu.open && !this.effectiveReadonly, target: menu,
        editing: !!this.headingNumberEditing, style: this.headingNumberMenuStyle,
        draft: this.headingNumberDraft, actions, disabled,
        prefix: menu.kind === 'heading' ? menu.label.replace(/\d+\.?$/, '') : '',
      }
    },
    headingNumberMenuDisabled(id) {
      const menu = this.headingNumberMenu
      if (id === 'continue') return !menu.canContinue
      if (menu.kind !== 'heading') return false
      return id === 'restart' ? menu.label === '1.' : id === 'restart-prefix' && this.trailingNumber(menu.label) === 1
    },
    actions() {
      const heading = this.headingNumberMenu.kind === 'heading'
      const prefix = heading ? this.headingNumberMenu.label.replace(/\d+\.?$/, '') : ''
      return [
        { id: 'continue', label: heading ? '继续标题编号' : '继续编号', icon: 'numbered-continue' },
        { id: 'restart', label: '重新开始编号', icon: 'numbered-restart', children: prefix ? [
          { id: 'restart', label: '从 1. 开始' }, { id: 'restart-prefix', label: `从 ${prefix}1 开始` },
        ] : null },
        { id: 'renumber', label: '设置编号的值', icon: 'numbered-value' },
      ]
    },
    /** 菜单贴着编号左侧弹出（飞书实测：left 与编号左对齐，top = 编号底边 + 2）。 */
    positionHeadingNumberMenu() {
      const target = this.headingNumberMenu
      if (target.open && this._headingNumberFocusedTarget !== target) {
        this._headingNumberFocusedTarget = target
        const pos = this.headingNumberTargetPos(), editor = this.editor
        const node = pos >= 0 ? editor?.state.doc.nodeAt(pos) : null
        if (node && this.writable()) {
          const { from, to } = editor.state.selection
          if (from <= pos || to >= pos + node.nodeSize) editor.commands.setTextSelection(pos + (target.kind === 'list' ? 2 : 1))
          editor.view.focus()
        }
      }
      const rect = this.headingNumberMenu.rect
      const menu = this.$refs.root?.querySelector('.lark-doc-heading-number-menu')
      if (rect && menu) this.headingNumberMenuStyle = placeMenu(menu, rect, 8, { gap: 2 })
    },
    /**
     * 编号起点的唯一写入口：标题写 attrs.numberingStart，列表项写 attrs.numberStart。
     * `null` = 继续前序；数字 = 从该值起算。
     */
    applyBlockNumberStart(pos, value, numberingLevel) {
      if (!this.editor || !Number.isInteger(pos)) return false
      if (this.headingNumberMenu.kind === 'list') return this.editor.commands.setLarkDocListItemNumber(pos, value)
      return this.editor.commands.setLarkDocHeadingNumber(pos, { numbering: true, numberingStart: value, ...(numberingLevel === undefined ? {} : { numberingLevel }) })
    },
    headingNumberAction(id) {
      const pos = this.headingNumberTargetPos()
      if (!this.writable() || pos < 0 || !this.editor) { this.closeHeadingNumberMenu({ restoreFocus: true }); return }
      if (this._headingNumberRuntime.headingNumberMenuDisabled(id)) return
      if (id === 'continue') {
        // 列表的「继续编号」多一种语义：首项可以接上**前面紧邻**的另一个列表的序号
        //（两个相邻列表都从 1. 开始时，只清起点等于什么都没做）。
        if (this.headingNumberMenu.kind === 'list') this.editor.commands.continueLarkDocListNumber(pos)
        else this.applyBlockNumberStart(pos, null, null)
        this.closeHeadingNumberMenu({ restoreFocus: true })
        return
      }
      if (id === 'restart' || id === 'restart-prefix') {
        // 「重新开始编号」= 从该层初始编号（1）重开，飞书菜单项点击后即关闭。
        this.applyBlockNumberStart(pos, 1, this.headingNumberMenu.kind === 'heading' && id === 'restart' ? 1 : undefined)
        this.closeHeadingNumberMenu({ restoreFocus: true })
        return
      }
      if (id === 'renumber') {
        // 就地变成输入框，值预填当前编号：标题取「2.」的末位数字，列表直接用真实序号
        //（列表是 a./i. 这类格式时 label 里没有数字，只能靠 value）。
        this.headingNumberEditing = true
        this.headingNumberApplying = false
        this.headingNumberDraft = String(this.headingNumberMenu.kind === 'list'
          ? (this.headingNumberMenu.value || 1)
          : this.trailingNumber(this.headingNumberMenu.label))
        this.$nextTick(() => {
          this.positionHeadingNumberMenu()
          const input = this.$refs.root?.querySelector('.lark-doc-heading-number-input')
          if (input) { input.focus(); input.select?.() }
        })
      }
    },
    trailingNumber(label) {
      const parts = String(label || '').replace(/\.$/, '').split('.')
      const last = Number(parts[parts.length - 1])
      return Number.isFinite(last) && last > 0 ? last : 1
    },
    applyHeadingNumberValue() {
      // 同一次确认只写一次；关闭后的迟到事件不能再改文档。
      if (this.headingNumberApplying) return
      const pos = this.headingNumberTargetPos()
      if (!this.writable() || pos < 0 || !this.editor) { this.closeHeadingNumberMenu(); return }
      const raw = Number(this.headingNumberDraft)
      // 空值 / 非数字 / 0 一律视为放弃修改，不要把编号悄悄改成 1。
      if (!/^\d+$/.test(this.headingNumberDraft) || !Number.isFinite(raw) || raw <= 0) { this.closeHeadingNumberMenu({ restoreFocus: true }); return }
      this.headingNumberApplying = true
      const value = Math.max(1, Math.min(this.headingNumberMenu.kind === 'heading' ? HEADING_VALUE_MAX : HEADING_NUMBER_MAX, Math.round(raw)))
      this.applyBlockNumberStart(pos, value)
      this.closeHeadingNumberMenu({ restoreFocus: true })
      this.$nextTick(() => { this.headingNumberApplying = false })
    },
    onHeadingNumberInputKeydown(event) {
      if (event.isComposing || event.keyCode === 229) { event.stopPropagation(); return }
      if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); this.applyHeadingNumberValue() }
      else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.closeHeadingNumberMenu({ restoreFocus: true }) }
      else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault()
        const step = event.key === 'ArrowUp' ? 1 : -1
        this.headingNumberDraft = String(Math.max(1, Math.min(this.headingNumberMenu.kind === 'heading' ? HEADING_VALUE_MAX : HEADING_NUMBER_MAX, (Number(this.headingNumberDraft) || 1) + step)))
      }
    },
    // P0-03：编号草稿的模板级赋值收敛为方法——子组件模板经 ed. 调用，避免 vue/no-mutating-props。
    stepHeadingNumberDraft(step) { this.headingNumberDraft = String(Math.max(1, Math.min(this.headingNumberMenu.kind === 'heading' ? HEADING_VALUE_MAX : HEADING_NUMBER_MAX, (Number(this.headingNumberDraft) || 1) + step))) },
  }
  return Object.fromEntries(Object.entries(methods).map(([name, method]) => [name, (...args) => host._isBeingDestroyed || host._isDestroyed ? undefined : method.apply(host, args)]))
}
