/**
 * 顶部标题栏 —— 原生 DOM 版（`src/ui/` 积木 · 阶段 5 批次 2）。
 *
 * 与 `editor/TopBar.vue` 是同一个界面的两套渲染（并存期结束后 SFC 删除）。
 * 逐字段复刻三段结构：
 *
 *   ① `div.lark-doc-brand[aria-label="文档"]` —— 文本 `'✦ '` + `<span>文档</span>`
 *   ② `div.lark-doc-title-wrap` —— `input[aria-label="文档标题"]` + `span.lark-doc-title-sub`
 *   ③ `div.lark-doc-header-actions` —— 共享下拉 `span.lark-doc-select.lark-doc-mode-select` + 插槽宿主
 *
 * 三条规矩同 `toolbar.js`。这里额外两条：
 *
 * - **整行是 `v-if`**：`layout.headerVisible === false` 时 `<header>` 必须真的不在
 *   DOM 里（断言量顶栏隐藏时的安全线是 51 而非 64，多留一个空 header 就会改变
 *   `bubbleSafeTop()` 之外的每一处布局）。
 * - **模式切换走共享下拉原语**（`ui/select.js`，与工具栏「字号」同一套交互与 UI）：
 *   hover 即开 / 移开 150ms 关 / 键盘 ↑↓ Enter Esc / 外部点击关 / 下方放不下翻转，
 *   弹层 `position: fixed`（`.lark-doc-header-actions` 是 `overflow-x: auto`，absolute
 *   会被裁掉）。所以本模块**不再自己管开合与坐标**，只把选项表推给 select；
 *   容器宽度靠 `menuMinWidth`（340）撑，贴右边界时由 select 自己夹取。
 *   旧的手搓按钮 / 菜单（`toggleModeMenu(anchor)` + `modeMenuPos`）已删除 ——
 *   别把「自己算 fixed 坐标」那套再加回来，那正是两套下拉观感不一致的根源。
 *
 * `header-actions` 是 Vue 插槽，原生层接不住：调用方把 Vue 持有的宿主节点
 * （`actionsHost`）传进来，本模块把它 append 在 mode-switch **之后**（两者并存，
 * 历史上有一次「用 slot 替换掉 mode-switch」的改法让宿主控件全消失）。
 */

import { createSelect } from './select'
import { setAttr } from './dom'
import { MODE_MENU_MIN_WIDTH } from '../components/lark-doc/editor/docModes'

/** 缺省副标题（`effectiveReadonly` 为假时的文案）。 */
const SUB_EDITABLE = '单人编辑'
const SUB_READONLY = '阅读中'

const DEFAULT_TITLE_PLACEHOLDER = '未命名文档'

/**
 * @param {object} options
 * @param {HTMLElement} options.host 插入到哪个元素里（`.lark-doc` 的 `<section>`）
 * @param {HTMLElement} [options.anchor] 插在它前面；不给则 append 到末尾
 * @param {object} [options.handlers] 回调表
 * @param {((id: string) => void)|null} [options.handlers.updateTitle] 入参是输入框的 `value`
 * @param {((id: string) => void)|null} [options.handlers.setMode] 下拉里选中某个模式
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

  // 模式切换 = 共享下拉原语（与工具栏「字号」同一套交互 / 同一套弹层 UI）。
  // 只传口径：`className` 给宿主换皮、`menuMinWidth` 让三项标题+副标题一行放得下、
  // `icon` 由 update 推（编辑/修订/阅读三枚图标不同）。开合 / 定位 / Esc 全在 select 里。
  const modeSelect = createSelect({
    ariaLabel: '文档模式',
    className: 'lark-doc-mode-select',
    menuMinWidth: MODE_MENU_MIN_WIDTH,
    onChange: (id) => call('setMode', id),
  })
  // 触发按钮本体：`update()` 只负责往里推选项，`aria-haspopup` 这类语义按「能否切换」摘挂，
  // 所以在这里留一个引用（select 的第一个子节点恒为 trigger）。
  const modeTrigger = modeSelect.el.firstElementChild

  headerActions.appendChild(modeSelect.el)

  el.appendChild(brand)
  el.appendChild(titleWrap)
  el.appendChild(headerActions)

  // ——————————————————— 状态推入 ———————————————————
  // `modes.allow` 是否给了不止一项。只有一项时：按钮退化成静态文字（禁用 + 藏 caret）。
  let switchable = true

  /**
   * 唯一写入口。`state` 由 `toolbarUiMixin` 算好，字段与 `TopBar.vue` 里读的
   * `ed.xxx` 一一对应：`headerVisible` / `title` / `titleLength` / `readonly` /
   * `mode` / `modeLabel` / `modeIcon` / `modeSwitchable` / `modeOptions`。
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

    // ③ 模式下拉：选项表 / 当前值 / 前导图标 / 禁用态一次推完，开合与坐标不归这里管。
    const label = state.modeLabel == null ? '' : String(state.modeLabel)
    const items = Array.isArray(state.modeOptions) ? state.modeOptions : []
    switchable = state.modeSwitchable !== false
    modeSelect.update({
      options: items.map((item) => ({ value: item.id, label: item.label, hint: item.hint })),
      value: state.mode,
      disabled: !switchable,
      icon: state.modeIcon || '',
      ariaLabel: `切换文档模式，当前${label}`,
    })
    // 只有一项可选：不给「可切换」的语义（aria-haspopup 摘掉 + 藏 caret），
    // 但**不加 disabled 的灰**（.is-static 在 CSS 里把 opacity 拉回 1）。
    setAttr(modeTrigger, 'aria-haspopup', switchable ? 'listbox' : null)
    if (modeSelect.el.classList.contains('is-static') !== !switchable) modeSelect.el.classList.toggle('is-static', !switchable)
  }

  function destroy() {
    // 插槽宿主是调用方的财产：先交还，再摘自己（否则 Vue 更新时会找不到节点）。
    if (actionsHost && actionsHost.parentNode === headerActions) headerActions.removeChild(actionsHost)
    modeSelect.destroy()
    if (el.parentNode) el.parentNode.removeChild(el)
  }

  return { el, update, destroy }
}
