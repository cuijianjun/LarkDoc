/**
 * 顶部标题栏 —— 原生 DOM 版（`src/ui/` 积木 · 阶段 5 批次 2）。
 *
 * 与 `editor/TopBar.vue` 是同一个界面的两套渲染（并存期结束后 SFC 删除）。
 * 逐字段复刻三段结构：
 *
 *   ① `div.lark-doc-brand[aria-label="文档"]` —— 文本 `'✦ '` + `<span>文档</span>`
 *   ② `div.lark-doc-title-wrap` —— `input[aria-label="文档标题"]` + `span.lark-doc-title-sub`
 *   ③ `div.lark-doc-header-actions` —— `div.lark-doc-mode-switch`（按钮 + 下拉）+ 插槽宿主
 *
 * 三条规矩同 `toolbar.js`。这里额外两条：
 *
 * - **整行是 `v-if`**：`layout.headerVisible === false` 时 `<header>` 必须真的不在
 *   DOM 里（断言量顶栏隐藏时的安全线是 51 而非 64，多留一个空 header 就会改变
 *   `bubbleSafeTop()` 之外的每一处布局）。
 * - **模式菜单必须 `position: fixed`**：`.lark-doc-header-actions` 带
 *   `overflow-x: auto`，absolute 会被裁掉。坐标由 `toggleModeMenu(anchor)` 算，
 *   所以按钮 click **必须把 `event.currentTarget` 原样透传上去**。
 *
 * `header-actions` 是 Vue 插槽，原生层接不住：调用方把 Vue 持有的宿主节点
 * （`actionsHost`）传进来，本模块把它 append 在 mode-switch **之后**（两者并存，
 * 历史上有一次「用 slot 替换掉 mode-switch」的改法让宿主控件全消失）。
 */

import { iconNode, setIcon } from './icon'
import { setAttr } from './dom'

/** 缺省副标题（`effectiveReadonly` 为假时的文案）。 */
const SUB_EDITABLE = '单人编辑'
const SUB_READONLY = '阅读中'

const DEFAULT_TITLE_PLACEHOLDER = '未命名文档'

/**
 * @param {object} options
 * @param {HTMLElement} options.host 插入到哪个元素里（`.lark-doc` 的 `<section>`）
 * @param {HTMLElement} [options.anchor] 插在它前面；不给则 append 到末尾
 * @param {object} [options.handlers] 回调表
 * @param {(() => void)|null} [options.handlers.updateTitle] 入参是输入框的 `value`
 * @param {((anchor: HTMLElement) => void)|null} [options.handlers.toggleModeMenu] 入参必须是按钮元素
 * @param {((id: string) => void)|null} [options.handlers.setMode]
 * @param {HTMLElement|null} [options.actionsHost] Vue 持有的 `header-actions` 宿主节点
 * @returns {{ el: HTMLElement, update(state: object): void, destroy(): void }}
 */
export function createTopBar(options = {}) {
  const handlers = options.handlers || {}
  const host = options.host || null
  // 插入位置：`anchor` 为真时插在它**前面**（模板里的空 div 只是挂载点），
  // 不套一层包裹 div —— 包裹会把 sticky 的包含块压成顶栏自身高度，滚动时就不再吸附。
  const anchor = options.anchor || null
  const actionsHost = options.actionsHost || null
  const call = (name, ...args) => {
    const fn = handlers[name]
    return typeof fn === 'function' ? fn(...args) : undefined
  }

  // ——————————————————— 根节点（v-if） ———————————————————
  const el = document.createElement('header')
  el.className = 'lark-doc-topbar'

  // ——————————————————— ① 品牌 ———————————————————
  const brand = document.createElement('div')
  brand.className = 'lark-doc-brand'
  brand.setAttribute('aria-label', '文档')
  // 模板里是 `✦ <span>文档</span>`：星号是裸文本节点，不能塞进 span。
  brand.appendChild(document.createTextNode('✦ '))
  const brandText = document.createElement('span')
  brandText.textContent = '文档'
  brand.appendChild(brandText)

  // ——————————————————— ② 标题 ———————————————————
  const titleWrap = document.createElement('div')
  titleWrap.className = 'lark-doc-title-wrap'
  const titleInput = document.createElement('input')
  titleInput.setAttribute('aria-label', '文档标题')
  titleInput.setAttribute('placeholder', DEFAULT_TITLE_PLACEHOLDER)
  // 模板里 input 与 span 之间**没有空白**（`></span` 紧贴），这里同样不留。
  titleInput.addEventListener('input', (event) => call('updateTitle', event.target.value))
  const titleSub = document.createElement('span')
  titleSub.className = 'lark-doc-title-sub'
  titleSub.textContent = SUB_EDITABLE
  titleWrap.appendChild(titleInput)
  titleWrap.appendChild(titleSub)

  // ——————————————————— ③ 右侧动作区 ———————————————————
  const headerActions = document.createElement('div')
  headerActions.className = 'lark-doc-header-actions'

  const modeSwitch = document.createElement('div')
  modeSwitch.className = 'lark-doc-mode-switch'
  const modeButton = document.createElement('button')
  modeButton.type = 'button'
  modeButton.className = 'lark-doc-mode-btn'
  setAttr(modeButton, 'aria-haspopup', 'listbox')
  // 三子节点顺序即契约：icon → label → caret。
  const modeIcon = iconNode('mode-edit', 16, 'lark-doc-mode-btn-icon')
  const modeLabel = document.createElement('span')
  modeLabel.className = 'lark-doc-mode-btn-label'
  const modeCaret = iconNode('caretSolid', 12, 'lark-doc-mode-btn-caret')
  modeButton.appendChild(modeIcon)
  modeButton.appendChild(modeLabel)
  modeButton.appendChild(modeCaret)
  // 透传 currentTarget：`toggleModeMenu(anchor)` 靠它 getBoundingClientRect() 算 fixed 坐标。
  modeButton.addEventListener('click', (event) => call('toggleModeMenu', event.currentTarget))

  const modeMenu = document.createElement('div')
  modeMenu.className = 'lark-doc-mode-menu'
  setAttr(modeMenu, 'role', 'listbox')
  setAttr(modeMenu, 'aria-label', '文档模式')

  modeSwitch.appendChild(modeButton)
  headerActions.appendChild(modeSwitch)

  el.appendChild(brand)
  el.appendChild(titleWrap)
  el.appendChild(headerActions)

  // ——————————————————— 状态推入 ———————————————————
  let menuMounted = false
  let optionsSignature = ''

  /** `v-for` 的等价物：按 `id` 序列的签名增量重建（选项表是静态的，通常只建一次）。 */
  function syncModeItems(list) {
    const items = Array.isArray(list) ? list : []
    const signature = items.map((item) => item.id).join('|')
    if (signature !== optionsSignature) {
      optionsSignature = signature
      while (modeMenu.firstChild) modeMenu.removeChild(modeMenu.firstChild)
      items.forEach((item) => {
        const row = document.createElement('button')
        row.type = 'button'
        row.className = 'lark-doc-mode-item'
        setAttr(row, 'role', 'option')
        row.dataset.modeId = item.id
        const label = document.createElement('span')
        label.className = 'lark-doc-mode-item-label'
        label.textContent = item.label
        const hint = document.createElement('span')
        hint.className = 'lark-doc-mode-item-hint'
        hint.textContent = item.hint
        row.appendChild(label)
        row.appendChild(hint)
        row.addEventListener('click', () => call('setMode', item.id))
        modeMenu.appendChild(row)
      })
    }
  }

  function paintModeItems(list, current) {
    const items = Array.isArray(list) ? list : []
    const rows = modeMenu.children
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i]
      const isActive = row.dataset.modeId === current
      if (row.classList.contains('is-active') !== isActive) row.classList.toggle('is-active', isActive)
      setAttr(row, 'aria-selected', isActive ? 'true' : 'false')
      // 文案随快照走（DOC_MODES 目前是常量，但口径上不假设它不变）。
      const item = items[i]
      if (!item) continue
      const label = row.firstChild
      const hint = row.lastChild
      if (label && label.textContent !== item.label) label.textContent = item.label
      if (hint && hint.textContent !== item.hint) hint.textContent = item.hint
    }
  }

  /**
   * 唯一写入口。`state` 由 `toolbarUiMixin` 算好，字段与 `TopBar.vue` 里读的
   * `ed.xxx` 一一对应：`headerVisible` / `title` / `titleLength` / `readonly` /
   * `mode` / `modeLabel` / `modeIcon` / `modeMenuOpen` / `modeMenuStyle` / `modeOptions`。
   */
  function update(state = {}) {
    // ① 整行 v-if：挂/摘都按锚点定位，插在锚点之前（锚点始终留在原地）
    const visible = state.headerVisible !== false
    if (host) {
      if (visible && el.parentNode !== host) host.insertBefore(el, anchor || null)
      else if (!visible && el.parentNode) el.parentNode.removeChild(el)
    }
    // 插槽宿主固定排在模式切换**之后**。每次 update 都对齐一次而不是只在构造时搬：
    // 顶栏隐藏期间调用方会把宿主搬回停泊位（否则 DOM 更新会落进游离子树），
    // 重新显示时必须搬回来，否则宿主控件整块消失。
    if (visible && actionsHost && actionsHost.parentNode !== headerActions) headerActions.appendChild(actionsHost)

    // ② 标题：只在真变了才写 value，否则用户输入时光标会被重置到末尾
    const title = state.title == null ? '' : String(state.title)
    if (titleInput.value !== title) titleInput.value = title
    setAttr(titleInput, 'maxlength', state.titleLength == null ? null : state.titleLength)
    const readonly = Boolean(state.readonly)
    setAttr(titleInput, 'readonly', readonly ? '' : null)
    const sub = readonly ? SUB_READONLY : SUB_EDITABLE
    if (titleSub.textContent !== sub) titleSub.textContent = sub

    // ③ 模式按钮
    const label = state.modeLabel == null ? '' : String(state.modeLabel)
    if (modeLabel.textContent !== label) modeLabel.textContent = label
    setAttr(modeButton, 'aria-label', `切换文档模式，当前${label}`)
    setAttr(modeButton, 'aria-expanded', state.modeMenuOpen ? 'true' : 'false')
    if (state.modeIcon) setIcon(modeIcon, state.modeIcon, 16)

    // ④ 模式菜单
    syncModeItems(state.modeOptions)
    paintModeItems(state.modeOptions, state.mode)
    const menuOpen = Boolean(state.modeMenuOpen)
    if (menuOpen !== menuMounted) {
      menuMounted = menuOpen
      if (menuOpen) modeSwitch.appendChild(modeMenu)
      else if (modeMenu.parentNode) modeMenu.parentNode.removeChild(modeMenu)
    }
    if (menuOpen && state.modeMenuStyle) {
      // `:style` 是替换语义：只给 left/top 时不残留上一次的键。
      const style = state.modeMenuStyle
      if (modeMenu.__ldLeft !== style.left) { modeMenu.style.left = style.left; modeMenu.__ldLeft = style.left }
      if (modeMenu.__ldTop !== style.top) { modeMenu.style.top = style.top; modeMenu.__ldTop = style.top }
    }
  }

  function destroy() {
    // 插槽宿主是调用方的财产：先交还，再摘自己（否则 Vue 更新时会找不到节点）。
    if (actionsHost && actionsHost.parentNode === headerActions) headerActions.removeChild(actionsHost)
    if (el.parentNode) el.parentNode.removeChild(el)
  }

  return { el, update, destroy }
}
