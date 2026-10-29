/**
 * 划词浮动工具条 —— 原生 DOM 版（阶段 5 批次 1 的落地件）。
 *
 * 与已删除的 `editor/BubbleBar.vue` 是同一份界面的两套渲染。这里逐段复刻它的
 * DOM、类名、属性与事件顺序，因为下面这些都被断言锁住了
 * （`scripts/verify-browser-bubble.js`，44 条）：
 *
 *   AI | divider | 标题级别(+下拉) | 缩进对齐(+下拉) | divider |
 *   加粗 删除线 斜体 下划线 行内代码 高亮 取色caret | divider | 复制
 *
 * 三条必须守住的规矩：
 * 1. **结构即契约**。`bubbleSegments()` 直接读 `.lark-doc-bubble` 的 `children`，
 *    条件段（AI / 标题 / 高亮）在关闭特性时必须**真的不在 DOM 里**（等价 `v-if`），
 *    不能只 `hidden` 或 `display:none` —— 否则段序断言会多出几项。
 * 2. **一次建好，之后只改属性**。菜单开合只做 insert/remove，不重建节点：
 *    重建会丢焦点、让 160ms 悬停延时链断开、并让 caret 的 `flex: 0 0 12px` 抖动。
 * 3. **同步定位**。原生 DOM 插进去就能量，`placeMenu()` 立刻拿到真实宽高，
 *    所以旧版那三处「先开菜单、`$nextTick` 再定位」的时序点在这里消失。
 *
 * 纯视图层：不含任何编辑器状态。`update(state)` 的 state 由 `bubbleMenuMixin`
 * 算好（当前块的对齐/缩进/标题级别、各项 disabled 与 tooltip）。
 */

import { iconNode, setIcon } from './icon'
import { createHeadingMenu } from './headingMenu'
import { placeMenu } from './menuLayout'

/** 对齐四项的顺序（与飞书一致：左 → 居中 → 右 → 两端）。 */
const ALIGN_ORDER = ['left', 'center', 'right', 'justify']

/** 「正文」缺省文案：与旧模板 `{{ ed.bubbleHeadingValue() }}` 的输出一致。 */
const HEADING_FALLBACK = '正文'

/** `bubbleSafeTop()` 没给值时退回视口边距（与该方法的缺省返回一致）。 */
const DEFAULT_SAFE_TOP = 8

/**
 * @param {HTMLElement} host 挂载点（`.lark-doc` 里的空 div；气泡条自身 `position: fixed`）
 * @param {object} options
 * @param {{ai:boolean, blockStyle:boolean, marks:Array, highlightAllowed:boolean}} options.config 特性快照
 * @param {object} options.handlers 全部回调，由 mixin 提供
 */
export function createBubbleBar(host, options = {}) {
  const { handlers = {} } = options
  const call = (name, ...args) => { const fn = handlers[name]; if (fn) fn(...args) }
  const safeTop = () => {
    const value = call('safeTop')
    return typeof value === 'number' && isFinite(value) ? value : DEFAULT_SAFE_TOP
  }

  // ——————————————————— 根节点 ———————————————————
  const el = document.createElement('div')
  el.className = 'lark-doc-bubble'
  el.setAttribute('role', 'toolbar')
  el.setAttribute('aria-label', '划词工具栏')
  // 等价旧模板根节点的 `@mousedown.prevent`：点气泡条（含内边距）不许把选区点塌。
  el.addEventListener('mousedown', (event) => event.preventDefault())

  // ——————————————————— ① AI ———————————————————
  const aiButton = document.createElement('button')
  aiButton.type = 'button'
  aiButton.className = 'lark-doc-bubble-ai'
  aiButton.title = '问问 AI'
  aiButton.setAttribute('aria-label', '问问 AI')
  aiButton.appendChild(iconNode('block-quote', 16))
  const aiLabel = document.createElement('span')
  aiLabel.textContent = '问问 AI'
  aiButton.appendChild(aiLabel)
  aiButton.addEventListener('click', () => call('onAi'))

  const aiDivider = createDivider()

  // ——————————————————— ② 标题级别 ———————————————————
  const headingWrap = document.createElement('div')
  headingWrap.className = 'lark-doc-bubble-heading'
  headingWrap.addEventListener('mouseleave', () => call('onHeadingLeave'))

  const headingTrigger = document.createElement('button')
  headingTrigger.type = 'button'
  headingTrigger.className = 'lark-doc-bubble-heading-trigger'
  headingTrigger.title = '标题级别'
  headingTrigger.setAttribute('aria-label', '标题级别')
  headingTrigger.setAttribute('aria-haspopup', 'menu')
  headingTrigger.setAttribute('aria-expanded', 'false')
  // 飞书口径：悬停 / 聚焦 / 点击三个入口都展开，无需二次点击。
  headingTrigger.addEventListener('mouseenter', () => call('onHeadingOpen'))
  headingTrigger.addEventListener('focus', () => call('onHeadingOpen'))
  headingTrigger.addEventListener('click', (event) => { event.preventDefault(); call('onHeadingOpen') })

  const headingValue = document.createElement('span')
  headingValue.setAttribute('aria-hidden', 'true')
  headingValue.textContent = HEADING_FALLBACK
  headingTrigger.appendChild(headingValue)
  headingTrigger.appendChild(iconNode('chevronDown', 12, 'lark-doc-bubble-caret lark-doc-caret'))
  headingWrap.appendChild(headingTrigger)

  // 与顶部工具栏**共用同一份菜单实现**（`createHeadingMenu`），观感不会再分叉。
  const headingMenu = createHeadingMenu({
    ariaLabel: '划词标题级别',
    onChoose: (level) => call('onHeadingChoose', level),
    onKeepOpen: () => call('onCancelHoverClose'),
    onScheduleClose: () => call('onHeadingLeave'),
  })

  // ——————————————————— ③ 缩进和对齐 ———————————————————
  const alignWrap = document.createElement('div')
  alignWrap.className = 'lark-doc-bubble-align'
  alignWrap.addEventListener('mouseenter', () => call('onAlignOpen'))
  alignWrap.addEventListener('mouseleave', () => call('onAlignLeave'))

  const alignTrigger = document.createElement('button')
  alignTrigger.type = 'button'
  alignTrigger.className = 'lark-doc-bubble-align-trigger'
  alignTrigger.setAttribute('aria-label', '缩进和对齐')
  alignTrigger.title = '缩进和对齐'
  alignTrigger.setAttribute('aria-haspopup', 'menu')
  alignTrigger.setAttribute('aria-expanded', 'false')
  alignTrigger.addEventListener('focus', () => call('onAlignOpen'))
  alignTrigger.addEventListener('click', (event) => { event.preventDefault(); call('onAlignOpen') })

  // 图标随当前块的 textAlign 变（原地换 innerHTML，不重建节点）。
  const alignIcon = iconNode('align-left', 16)
  alignTrigger.appendChild(alignIcon)
  alignTrigger.appendChild(iconNode('chevronDown', 12, 'lark-doc-bubble-caret lark-doc-caret'))
  alignWrap.appendChild(alignTrigger)

  const alignMenu = document.createElement('div')
  alignMenu.className = 'lark-doc-bubble-align-menu'
  alignMenu.setAttribute('role', 'menu')
  alignMenu.setAttribute('aria-label', '划词缩进和对齐')
  alignMenu.addEventListener('mouseenter', () => call('onCancelHoverClose'))
  alignMenu.addEventListener('mouseleave', () => call('onAlignLeave'))

  // 四个对齐项：结构一次建好，文案与选中态每次 update 填。
  const alignRows = ALIGN_ORDER.map((id) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.setAttribute('role', 'menuitem')
    button.setAttribute('aria-pressed', 'false')
    button.addEventListener('mousedown', (event) => event.preventDefault())
    button.addEventListener('click', () => call('onAlignAction', id))

    const glyph = document.createElement('span')
    glyph.className = 'lark-doc-block-align-glyph'
    glyph.setAttribute('aria-hidden', 'true')
    const label = document.createElement('span')
    const check = document.createElement('span')
    check.className = 'lark-doc-block-align-check'
    check.setAttribute('aria-hidden', 'true')
    check.textContent = '✓'
    button.appendChild(glyph)
    button.appendChild(label)
    alignMenu.appendChild(button)
    return { id, button, glyph, label, check }
  })

  const separator = document.createElement('div')
  separator.className = 'lark-doc-block-submenu-divider'
  separator.setAttribute('role', 'separator')
  alignMenu.appendChild(separator)

  /** 缩进两行：结构同对齐行，但没有 `aria-pressed`（是动作不是状态）。 */
  const createIndentRow = (glyphText, labelText, action) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.setAttribute('role', 'menuitem')
    button.addEventListener('mousedown', (event) => event.preventDefault())
    button.addEventListener('click', () => call('onAlignAction', action))

    const glyph = document.createElement('span')
    glyph.className = 'lark-doc-block-align-glyph'
    glyph.setAttribute('aria-hidden', 'true')
    glyph.textContent = glyphText
    const label = document.createElement('span')
    label.textContent = labelText
    button.appendChild(glyph)
    button.appendChild(label)

    // 顶到上限时挂的问号说明（`aria-label="已达到最大缩进"`，断言会查）。
    const help = document.createElement('span')
    help.className = 'lark-doc-block-align-help'
    help.setAttribute('aria-label', '已达到最大缩进')
    help.textContent = '?'
    alignMenu.appendChild(button)
    return { button, help }
  }

  const increaseRow = createIndentRow('⇥', '增加缩进', 'increaseIndent')
  const decreaseRow = createIndentRow('⇤', '减少缩进', 'decreaseIndent')

  const midDivider = createDivider()

  // ——————————————————— ④ 行内格式 ———————————————————
  // 只在特性 / `marksAllow` 变化时才重建（签名比对），日常 update 只改 aria-pressed。
  let markSignature = ''
  let markRows = []

  // ——————————————————— ⑤ 高亮 + 取色 ———————————————————
  const highlightButton = document.createElement('button')
  highlightButton.type = 'button'
  highlightButton.className = 'lark-doc-bubble-mark-highlight'
  highlightButton.setAttribute('aria-label', '高亮')
  highlightButton.title = '高亮'
  highlightButton.setAttribute('aria-pressed', 'false')
  highlightButton.addEventListener('click', () => call('onToggleMark', 'highlight'))
  highlightButton.appendChild(iconNode('mark-highlight', 16))

  const paletteButton = document.createElement('button')
  paletteButton.type = 'button'
  paletteButton.className = 'lark-doc-bubble-caret-button'
  paletteButton.setAttribute('aria-label', '选择高亮颜色')
  paletteButton.title = '选择高亮颜色'
  // 🔴 必须把**原事件**转出去：`toggleColorPalette` 用 `event.currentTarget.getBoundingClientRect()`
  // 算取色面板位置，自己造事件对象会让面板退回默认的 80/16。
  paletteButton.addEventListener('click', (event) => { event.preventDefault(); call('onPalette', event) })
  paletteButton.appendChild(iconNode('chevronDown', 12, 'lark-doc-bubble-caret lark-doc-caret'))

  const tailDivider = createDivider()

  // ——————————————————— ⑥ 复制 ———————————————————
  const copyButton = document.createElement('button')
  copyButton.type = 'button'
  copyButton.setAttribute('aria-label', '复制选中文字')
  copyButton.title = '复制选中文字'
  copyButton.addEventListener('click', () => call('onCopy'))
  copyButton.appendChild(iconNode('copy', 16))

  function createDivider() {
    const span = document.createElement('span')
    span.className = 'lark-doc-bubble-divider'
    span.setAttribute('aria-hidden', 'true')
    return span
  }

  /**
   * 按特性快照拼装整条气泡条。
   * 只在创建时与**签名变化时**调用：拼出来的 `children` 就是断言里那 14 项。
   */
  function build(config) {
    const { ai, blockStyle, marks = [], highlightAllowed } = config || {}
    el.textContent = ''
    if (ai) {
      el.appendChild(aiButton)
      el.appendChild(aiDivider)
    }
    if (blockStyle) el.appendChild(headingWrap)
    el.appendChild(alignWrap)
    el.appendChild(midDivider)

    markRows = marks.map((item) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.setAttribute('aria-label', item.label)
      button.title = item.label
      button.setAttribute('aria-pressed', 'false')
      button.addEventListener('click', () => call('onToggleMark', item.id))
      button.appendChild(iconNode(item.icon, 16))
      el.appendChild(button)
      return { id: item.id, button }
    })

    if (highlightAllowed) {
      el.appendChild(highlightButton)
      el.appendChild(paletteButton)
    }
    el.appendChild(tailDivider)
    el.appendChild(copyButton)
  }

  const configSignature = (config) => {
    const { ai, blockStyle, marks = [], highlightAllowed } = config || {}
    return `${ai ? 1 : 0}|${blockStyle ? 1 : 0}|${highlightAllowed ? 1 : 0}|${marks.map((item) => item.id).join(',')}`
  }

  // ——————————————————— 菜单开合 ———————————————————
  let headingOpen = false
  let alignOpen = false

  /** 无条件对账（不靠布尔短路）：`build()` 清过 children，重建后必须能重新挂回来。 */
  function reconcileHeading(open, level) {
    headingOpen = !!open
    if (headingOpen) {
      if (headingMenu.el.parentNode !== headingWrap) headingWrap.appendChild(headingMenu.el)
      headingMenu.update(level)
      placeMenu(headingMenu.el, headingTrigger, safeTop())
    } else if (headingMenu.el.parentNode) {
      headingMenu.el.parentNode.removeChild(headingMenu.el)
    }
  }

  function reconcileAlign(open) {
    alignOpen = !!open
    if (alignOpen) {
      if (alignMenu.parentNode !== alignWrap) alignWrap.appendChild(alignMenu)
      placeMenu(alignMenu, alignTrigger, safeTop())
    } else if (alignMenu.parentNode) {
      alignMenu.parentNode.removeChild(alignMenu)
    }
  }

  /**
   * 唯一的写入口。
   *
   * @param {object} state
   * @param {number} state.left 气泡条 left（视口坐标，`position: fixed`）
   * @param {number} state.top 气泡条 top
   * @param {string} state.headingValue 「正文」/「H2」
   * @param {boolean} state.headingOpen
   * @param {number|null} state.headingLevel
   * @param {boolean} state.alignOpen
   * @param {string} state.alignValue left|center|right|justify
   * @param {Array<{id:string,glyph:string,name:string,tooltip:string,active:boolean}>} state.alignItems
   * @param {boolean} state.canIncrease
   * @param {string} state.increaseTooltip
   * @param {boolean} state.canDecrease
   * @param {string} state.decreaseTooltip
   * @param {Array<{id:string,active:boolean}>} state.marks
   * @param {boolean} state.highlightActive
   */
  function update(state) {
    // 位置：先落位再量菜单，量到的触发点才是这一帧的真实值。
    el.style.left = `${state.left}px`
    el.style.top = `${state.top}px`
    if (!el.parentNode) host.appendChild(el)

    // ② 标题级别
    const headingText = state.headingValue || HEADING_FALLBACK
    if (headingValue.textContent !== headingText) headingValue.textContent = headingText
    headingTrigger.setAttribute('aria-expanded', state.headingOpen ? 'true' : 'false')
    if (headingWrap.parentNode) reconcileHeading(state.headingOpen, state.headingLevel)

    // ③ 缩进和对齐
    setIcon(alignIcon, `align-${state.alignValue || 'left'}`)
    alignTrigger.setAttribute('aria-expanded', state.alignOpen ? 'true' : 'false')
    const items = state.alignItems || []
    alignRows.forEach((row, index) => {
      const item = items[index]
      if (!item) return
      row.glyph.textContent = item.glyph
      row.label.textContent = `${item.name}对齐`
      row.button.classList.toggle('active', !!item.active)
      row.button.setAttribute('aria-pressed', item.active ? 'true' : 'false')
      row.button.setAttribute('data-tooltip', item.tooltip)
      row.button.title = item.tooltip
      // 选中项的 ✓ 只插一次（等价 `v-if`），不重建按钮。
      if (item.active && !row.check.parentNode) row.button.appendChild(row.check)
      else if (!item.active && row.check.parentNode) row.check.remove()
    })

    applyIndentRow(increaseRow, !state.canIncrease, state.increaseTooltip)
    applyIndentRow(decreaseRow, !state.canDecrease, state.decreaseTooltip)
    reconcileAlign(state.alignOpen)

    // ④ 行内格式
    const markStates = state.marks || []
    markRows.forEach((row) => {
      const item = markStates.find((entry) => entry.id === row.id)
      row.button.setAttribute('aria-pressed', item && item.active ? 'true' : 'false')
    })

    // ⑤ 高亮
    if (highlightButton.parentNode) highlightButton.setAttribute('aria-pressed', state.highlightActive ? 'true' : 'false')
  }

  function applyIndentRow(row, disabled, tooltip) {
    row.button.disabled = disabled
    row.button.setAttribute('data-tooltip', tooltip)
    row.button.title = tooltip
    if (disabled && !row.help.parentNode) row.button.appendChild(row.help)
    else if (!disabled && row.help.parentNode) row.help.remove()
  }

  /** 便宜的隐藏路径：不在文档里就等于 `v-if=false`（断言靠「查不到节点」判显隐）。 */
  function hide() {
    reconcileHeading(false, null)
    reconcileAlign(false)
    if (el.parentNode) el.parentNode.removeChild(el)
  }

  build(options.config)
  markSignature = configSignature(options.config)

  return {
    el,
    update,
    hide,
    /** @returns {boolean} 是否真的重建了（调用方据此决定要不要重排菜单） */
    setConfig(config) {
      const signature = configSignature(config)
      if (signature === markSignature) return false
      markSignature = signature
      build(config)
      return true
    },
    /** 供 `LarkDocEditor.onDocumentScroll` 的滚动重排复用。 */
    positionAlignMenu() { if (alignOpen) placeMenu(alignMenu, alignTrigger, safeTop()) },
    positionHeadingMenu() { if (headingOpen) placeMenu(headingMenu.el, headingTrigger, safeTop()) },
    destroy() {
      reconcileHeading(false, null)
      reconcileAlign(false)
      headingMenu.destroy()
      if (el.parentNode) el.parentNode.removeChild(el)
    },
  }
}
