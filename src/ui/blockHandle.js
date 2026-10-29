/**
 * 区块句柄 + 块菜单 —— 原生 DOM 版（`src/ui/` 积木 · 阶段 5 批次 3）。
 *
 * 与 `editor/BlockHandleMenu.vue` 是同一个 UI 的两套渲染（并存期结束后 SFC 删除）。
 * **结构即契约**：`scripts/verify-browser-block-menu.js` 37 条断言在逐字段量这里
 * 产出的 DOM —— 句柄盒模型与垂直对齐、遮罩（不在本模块）、块菜单段序、
 * 子菜单几何、表格分支、空段落分支，全都不能凭手感改。
 *
 * 三条规矩（与 `toolbar.js` / `bubbleBar.js` 一致）：
 * 1. **结构即契约**：类名 / `role` / `aria-*` / 段序逐字段复刻 SFC；
 *    `v-if` → 真的 insert/remove，`v-show` → `style.display`。
 * 2. **一次建节点、之后只改属性**：只有类型网格、操作列表、颜色三处是动态列表，
 *    按签名重建。
 * 3. **同步定位**：节点同步插入 DOM，`getBoundingClientRect()` 立刻可量 ——
 *    SFC 里 `openBlockMenu` → `$nextTick(positionBlockMenu)` 的时序点就此消灭。
 *
 * ⚠️ 两段式更新（性能很硬）：`updateChrome()` 只写句柄本体，`positionBlockHandle`
 * 在 `pointermove` 上每秒要跑几十次，绝不能顺带重算类型网格（9 次 `blockTypeActive`
 * 各要一次 `doc.resolve`）；`updateMenu()` 才重算菜单内容。
 * 但**两者都要重排根节点的子节点** —— 菜单节点的挂/摘由同一份 state 决定，
 * 各自维护一份会互相摘掉对方的节点。
 */

import { iconNode } from './icon'
import { applyStyle, setAttr, syncChildren } from './dom'

const ALIGN_ORDER = ['left', 'center', 'right', 'justify']

/**
 * @param {object} options
 * @param {object} [options.handlers] 全部交互回调（键名与 SFC 里的 `ed.xxx` 一一对应）
 * @param {HTMLElement|null} [options.host] 挂载宿主（`.lark-doc-paper`）
 * @param {HTMLElement|null} [options.anchor] 插入位置锚点（句柄插在它**前面**）
 * @returns {object} `el` / `updateChrome` / `updateMenu` / 若干元素引用 / `destroy`
 */
export function createBlockHandle(options = {}) {
  const handlers = options.handlers || {}
  const host = options.host || null
  const anchor = options.anchor || null

  const call = (name, ...args) => {
    const fn = handlers[name]
    return typeof fn === 'function' ? fn(...args) : undefined
  }

  // ————————————————— 状态（唯一真相） —————————————————
  // 由于 DOM 不再由 Vue 驱动，state 必须留在本模块里：`updateChrome` 只知道
  // 「菜单开着吗」，`updateMenu` 只知道「句柄是哪种按钮」，而两者都要重排根节点
  // 子节点。合并到一份 state 上才不会互相踩。
  const state = {
    visible: false,
    style: null,
    menuOpen: false,
    alignOpen: false,
    colorOpen: false,
    blockStyle: true,
    buttonKind: 'none',
    glyph: 'T',
    isCallout: false,
    draggable: true,
    features: {},
    typeActions: [],
    listActions: [],
    table: false,
    tableHeader: { row: false, column: false },
    canDuplicate: false,
    canAddBelow: false,
    colors: [],
    align: { value: 'left', indent: 0, canIncrease: false },
    alignGlyphs: {},
    alignNames: {},
  }

  // ————————————————— 基础工厂 —————————————————

  /** `@mousedown.prevent` —— 菜单里每个按钮都要，否则按下会抢焦点、菜单当场关掉。 */
  function preventMouseDown(node) {
    node.addEventListener('mousedown', (event) => event.preventDefault())
    return node
  }

  function makeDivider(className) {
    const node = document.createElement('div')
    node.className = className
    node.setAttribute('role', 'separator')
    return node
  }

  /** 菜单里「图标 + 文案」的普通行（模板里 `<lark-doc-icon/><span>` 这个固定搭配）。 */
  function makeIconLabel(icon, size, text, className) {
    const node = document.createElement('span')
    if (className) node.className = className
    node.textContent = text
    return [iconNode(icon, size, 'lark-doc-block-menu-icon'), node]
  }

  // ————————————————— ① 句柄本体 —————————————————

  const el = document.createElement('div')
  el.className = 'lark-doc-block-handle'
  el.addEventListener('mouseenter', (event) => call('onHandleEnter', event))
  el.addEventListener('mouseleave', (event) => call('onHandleLeave', event))

  // 空段落：句柄换成「＋」，点开的是插入内容命令菜单（不是块菜单）。
  const emptyButton = preventMouseDown(document.createElement('button'))
  emptyButton.type = 'button'
  emptyButton.className = 'lark-doc-empty-block-insert'
  emptyButton.setAttribute('aria-label', '插入内容')
  emptyButton.setAttribute('title', '插入内容')
  emptyButton.textContent = '＋'
  emptyButton.addEventListener('mouseenter', (event) => call('openEmptyBlockInsertMenu', event))
  emptyButton.addEventListener('click', (event) => call('openEmptyBlockInsertMenu', event))

  const mainButton = document.createElement('button')
  mainButton.type = 'button'
  mainButton.className = 'lark-doc-block-handle-main'
  mainButton.setAttribute('aria-label', '块操作')
  mainButton.setAttribute('title', '块操作与拖动')
  mainButton.setAttribute('draggable', 'true')
  mainButton.addEventListener('mouseenter', (event) => call('openBlockMenuOnHover', event))
  mainButton.addEventListener('focus', (event) => call('openBlockMenuOnHover', event))
  mainButton.addEventListener('click', (event) => call('openBlockMenu', event))
  mainButton.addEventListener('pointerdown', (event) => call('pressHandle', event))
  mainButton.addEventListener('dragstart', (event) => call('startBlockDrag', event))
  mainButton.addEventListener('dragend', (event) => call('endBlockDrag', event))

  const glyphNode = document.createElement('span')
  glyphNode.className = 'lark-doc-block-handle-type'
  glyphNode.textContent = 'T'
  const dotsNode = document.createElement('span')
  dotsNode.className = 'lark-doc-block-handle-dots'
  dotsNode.setAttribute('aria-hidden', 'true')
  dotsNode.textContent = '⠿'
  mainButton.appendChild(glyphNode)
  mainButton.appendChild(dotsNode)

  // ————————————————— ② 块菜单外壳 —————————————————

  const menuEl = document.createElement('div')
  menuEl.className = 'lark-doc-block-menu'
  menuEl.setAttribute('role', 'menu')
  menuEl.setAttribute('aria-label', '块操作')
  menuEl.addEventListener('mouseenter', () => call('onBlockMenuEnter'))
  menuEl.addEventListener('mouseleave', (event) => call('onBlockMenuLeave', event))
  menuEl.addEventListener('focusin', () => call('onBlockMenuFocusIn'))
  menuEl.addEventListener('focusout', (event) => call('onBlockMenuFocusOut', event))

  const aiButton = preventMouseDown(document.createElement('button'))
  aiButton.type = 'button'
  aiButton.setAttribute('role', 'menuitem')
  aiButton.className = 'lark-doc-block-menu-ai'
  aiButton.setAttribute('title', '问问 AI')
  aiButton.addEventListener('click', () => call('emitAiRequest', 'rewrite'))
  aiButton.appendChild(iconNode('sparkle', 16, 'lark-doc-block-menu-icon'))
  const aiText = document.createElement('span')
  aiText.textContent = '问问 AI'
  aiButton.appendChild(aiText)

  const menuDividerAi = makeDivider('lark-doc-block-menu-divider')

  // 类型网格：6 列 9 项，项序即 `blockTypeActions` 顺序（断言逐项比对）。
  const typeSection = document.createElement('div')
  typeSection.className = 'lark-doc-block-menu-section lark-doc-block-type-actions'
  typeSection.setAttribute('role', 'group')
  typeSection.setAttribute('aria-label', '类型转换')
  let typeButtons = []
  let typeSignature = ''

  function syncTypeActions(items) {
    const signature = items.map((item) => [item.id, item.label, item.icon, item.active ? 1 : 0].join('\u0002')).join('\u0001')
    if (signature === typeSignature) return
    typeSignature = signature
    typeButtons.forEach((button) => { if (button.parentNode) button.parentNode.removeChild(button) })
    typeButtons = items.map((item) => {
      const button = preventMouseDown(document.createElement('button'))
      button.type = 'button'
      button.setAttribute('role', 'menuitem')
      button.setAttribute('aria-label', item.label)
      button.setAttribute('title', item.label)
      if (item.active) button.classList.add('active')
      button.addEventListener('click', () => call('blockTypeAction', item.id))
      button.appendChild(iconNode(item.icon, 18, 'lark-doc-block-type-icon'))
      const hidden = document.createElement('span')
      hidden.className = 'sr-only'
      hidden.textContent = item.label
      button.appendChild(hidden)
      typeSection.appendChild(button)
      return button
    })
  }

  const duplicateButton = preventMouseDown(document.createElement('button'))
  duplicateButton.type = 'button'
  duplicateButton.setAttribute('role', 'menuitem')
  duplicateButton.className = 'lark-doc-block-menu-duplicate'
  duplicateButton.setAttribute('title', '创建副本')
  duplicateButton.setAttribute('aria-label', '创建副本')
  duplicateButton.addEventListener('click', () => call('blockAction', 'duplicate'))
  duplicateButton.appendChild(iconNode('copy', 16))

  const menuDividerStyle = makeDivider('lark-doc-block-menu-divider')

  /** 子菜单触发项：「图标 + 文案 + ›」，悬停/聚焦/点击三入口展开（飞书口径）。 */
  function makeSubmenuTrigger(icon, label, onOpen) {
    const button = preventMouseDown(document.createElement('button'))
    button.type = 'button'
    button.setAttribute('role', 'menuitem')
    button.className = 'lark-doc-block-submenu-trigger'
    button.setAttribute('aria-haspopup', 'menu')
    button.setAttribute('aria-expanded', 'false')
    button.setAttribute('title', label)
    button.addEventListener('mouseenter', (event) => onOpen(event))
    button.addEventListener('focus', (event) => onOpen(event))
    button.addEventListener('click', (event) => { event.stopPropagation(); onOpen(event) })
    const [iconEl, textEl] = makeIconLabel(icon, 16, label)
    const arrow = document.createElement('span')
    arrow.className = 'lark-doc-block-menu-arrow'
    arrow.setAttribute('aria-hidden', 'true')
    arrow.textContent = '›'
    button.appendChild(iconEl)
    button.appendChild(textEl)
    button.appendChild(arrow)
    return button
  }

  const alignTrigger = makeSubmenuTrigger('align-left', '缩进和对齐', (event) => call('openBlockAlignMenuOnHover', event))
  const colorTrigger = makeSubmenuTrigger('palette', '颜色', (event) => call('openBlockColorMenuOnHover', event))

  // ————————————————— ③ 颜色子菜单 —————————————————
  // ⚠️ 与 SFC 一致：它是 `.lark-doc-block-menu` 的**子节点**（夹在两个触发项与
  // 表格组之间），不要「顺手」挪到根上 —— 段序断言按模板顺序量。

  const colorMenu = document.createElement('div')
  colorMenu.className = 'lark-doc-block-submenu lark-doc-block-color-submenu'
  colorMenu.setAttribute('role', 'menu')
  colorMenu.setAttribute('aria-label', '颜色')

  const colorResetButton = preventMouseDown(document.createElement('button'))
  colorResetButton.type = 'button'
  colorResetButton.setAttribute('role', 'menuitem')
  colorResetButton.setAttribute('aria-label', '恢复默认颜色')
  colorResetButton.addEventListener('click', () => call('blockColorAction', ''))
  const resetSwatch = document.createElement('span')
  resetSwatch.className = 'lark-doc-block-color-swatch is-transparent'
  resetSwatch.setAttribute('aria-hidden', 'true')
  const resetText = document.createElement('span')
  resetText.textContent = '恢复默认'
  colorResetButton.appendChild(resetSwatch)
  colorResetButton.appendChild(resetText)

  let colorButtons = []
  // 初值是哨兵而非 `''`：`syncColors([])` 的签名也算出 `''`，用 `''` 当初始值会让
  // 首次调用直接命中「没变」分支 → 常驻的「恢复默认」按钮永远进不了 DOM。
  let colorSignature = '\u0000'

  function syncColors(colors) {
    const signature = colors.map((color) => `${color.value}\u0002${color.label}`).join('\u0001')
    if (signature === colorSignature) return
    colorSignature = signature
    colorButtons.forEach((button) => { if (button.parentNode) button.parentNode.removeChild(button) })
    colorButtons = colors.map((color) => {
      const button = preventMouseDown(document.createElement('button'))
      button.type = 'button'
      button.setAttribute('role', 'menuitem')
      button.setAttribute('aria-label', color.label)
      button.addEventListener('click', () => call('blockColorAction', color.value))
      const swatch = document.createElement('span')
      swatch.className = 'lark-doc-block-color-swatch'
      swatch.setAttribute('aria-hidden', 'true')
      if (color.value) swatch.style.backgroundColor = color.value
      const text = document.createElement('span')
      text.textContent = color.label
      button.appendChild(swatch)
      button.appendChild(text)
      return button
    })
    // 首项固定是「恢复默认」，其余按签名追加
    colorMenu.textContent = ''
    colorMenu.appendChild(colorResetButton)
    colorButtons.forEach((button) => colorMenu.appendChild(button))
  }

  // ————————————————— ④ 表格组 —————————————————

  const tableGroup = document.createElement('div')
  tableGroup.className = 'lark-doc-block-menu-table'
  tableGroup.setAttribute('role', 'group')
  tableGroup.setAttribute('aria-label', '表格设置')

  /** 表格行的两种形态：开关行（menuitemcheckbox + `.lark-doc-menu-switch`）与普通行。 */
  function makeTableRow(spec) {
    const button = preventMouseDown(document.createElement('button'))
    button.type = 'button'
    button.className = 'lark-doc-block-menu-row'
    button.setAttribute('role', spec.role)
    button.setAttribute('title', spec.title)
    button.addEventListener('click', () => call('tableHandleAction', spec.action))
    const [iconEl, textEl] = makeIconLabel(spec.icon, 16, spec.label)
    button.appendChild(iconEl)
    button.appendChild(textEl)
    if (spec.role !== 'menuitemcheckbox') return { button, switchEl: null, switchDot: null }
    button.setAttribute('aria-checked', 'false')
    const switchEl = document.createElement('span')
    switchEl.className = 'lark-doc-menu-switch'
    switchEl.setAttribute('aria-hidden', 'true')
    const switchDot = document.createElement('span')
    switchDot.className = 'lark-doc-menu-switch-dot'
    switchEl.appendChild(switchDot)
    button.appendChild(switchEl)
    return { button, switchEl, switchDot }
  }

  const tableRow = makeTableRow({ role: 'menuitemcheckbox', title: '标题行', label: '标题行', icon: 'table-header-row', action: 'toggleHeaderRow' })
  const tableColumn = makeTableRow({ role: 'menuitemcheckbox', title: '标题列', label: '标题列', icon: 'table-header-col', action: 'toggleHeaderColumn' })
  const tableDistribute = makeTableRow({ role: 'menuitem', title: '均分列宽', label: '均分列宽', icon: 'distribute-cols', action: 'distributeColumns' })
  tableGroup.appendChild(tableRow.button)
  tableGroup.appendChild(tableColumn.button)
  tableGroup.appendChild(tableDistribute.button)

  // ————————————————— ⑤ 操作列表 + 分隔线 + 加正文 —————————————————

  const menuDividerActions = makeDivider('lark-doc-block-menu-divider')
  let listActionButtons = []
  let listActionSignature = ''

  function syncListActions(items) {
    const signature = items.map((item) => `${item.id}\u0002${item.label}\u0002${item.icon}`).join('\u0001')
    if (signature === listActionSignature) return
    listActionSignature = signature
    listActionButtons.forEach((button) => { if (button.parentNode) button.parentNode.removeChild(button) })
    listActionButtons = items.map((item) => {
      const button = preventMouseDown(document.createElement('button'))
      button.type = 'button'
      button.setAttribute('role', 'menuitem')
      button.className = 'lark-doc-block-menu-row'
      button.setAttribute('title', item.label)
      button.addEventListener('click', () => call('blockAction', item.id))
      const [iconEl, textEl] = makeIconLabel(item.icon, 16, item.label)
      button.appendChild(iconEl)
      button.appendChild(textEl)
      return button
    })
  }

  const menuDividerFooter = makeDivider('lark-doc-block-menu-divider')

  const addBelowButton = preventMouseDown(document.createElement('button'))
  addBelowButton.type = 'button'
  addBelowButton.setAttribute('role', 'menuitem')
  addBelowButton.className = 'lark-doc-block-menu-row'
  addBelowButton.setAttribute('title', '在下方添加正文')
  addBelowButton.addEventListener('click', () => call('blockAction', 'addBelow'))
  {
    const [iconEl, textEl] = makeIconLabel('plus', 16, '在下方添加正文')
    addBelowButton.appendChild(iconEl)
    addBelowButton.appendChild(textEl)
  }

  // ————————————————— ⑥ 缩进和对齐子菜单（根的直接子节点） —————————————————

  const alignMenu = document.createElement('div')
  alignMenu.className = 'lark-doc-block-submenu'
  alignMenu.setAttribute('role', 'menu')
  alignMenu.setAttribute('aria-label', '缩进和对齐')

  const alignButtons = ALIGN_ORDER.map((align) => {
    const button = preventMouseDown(document.createElement('button'))
    button.type = 'button'
    button.setAttribute('role', 'menuitem')
    button.setAttribute('aria-pressed', 'false')
    button.addEventListener('click', () => call('blockAlignAction', align))
    const glyph = document.createElement('span')
    glyph.className = 'lark-doc-block-align-glyph'
    glyph.setAttribute('aria-hidden', 'true')
    const text = document.createElement('span')
    const check = document.createElement('span')
    check.className = 'lark-doc-block-align-check'
    check.setAttribute('aria-hidden', 'true')
    check.textContent = '✓'
    button.appendChild(glyph)
    button.appendChild(text)
    button.appendChild(check)
    return { align, button, glyph, text, check }
  })

  const alignDivider = makeDivider('lark-doc-block-submenu-divider')

  const indentMoreButton = preventMouseDown(document.createElement('button'))
  indentMoreButton.type = 'button'
  indentMoreButton.setAttribute('role', 'menuitem')
  indentMoreButton.addEventListener('click', () => call('blockAlignAction', 'increaseIndent'))
  const indentMoreGlyph = document.createElement('span')
  indentMoreGlyph.className = 'lark-doc-block-align-glyph'
  indentMoreGlyph.setAttribute('aria-hidden', 'true')
  indentMoreGlyph.textContent = '⇥'
  const indentMoreText = document.createElement('span')
  indentMoreText.textContent = '增加缩进'
  const indentMoreHelp = document.createElement('span')
  indentMoreHelp.className = 'lark-doc-block-align-help'
  indentMoreHelp.setAttribute('aria-label', '已达到最大缩进')
  indentMoreHelp.textContent = '?'
  indentMoreButton.appendChild(indentMoreGlyph)
  indentMoreButton.appendChild(indentMoreText)
  indentMoreButton.appendChild(indentMoreHelp)

  const indentLessButton = preventMouseDown(document.createElement('button'))
  indentLessButton.type = 'button'
  indentLessButton.setAttribute('role', 'menuitem')
  indentLessButton.addEventListener('click', () => call('blockAlignAction', 'decreaseIndent'))
  const indentLessGlyph = document.createElement('span')
  indentLessGlyph.className = 'lark-doc-block-align-glyph'
  indentLessGlyph.setAttribute('aria-hidden', 'true')
  indentLessGlyph.textContent = '⇤'
  const indentLessText = document.createElement('span')
  indentLessText.textContent = '减少缩进'
  indentLessButton.appendChild(indentLessGlyph)
  indentLessButton.appendChild(indentLessText)

  // 对齐子菜单内部结构（**全静态**，建一次即可）：4 项对齐 → 分隔线 → 增加/减少缩进。
  // 顺序与 SFC 模板逐段一致；`alignDivider` 无条件存在（模板里没有 `v-if`）。
  syncChildren(alignMenu, [
    ...alignButtons.map((entry) => ({ node: entry.button, on: true })),
    { node: alignDivider, on: true },
    { node: indentMoreButton, on: true },
    { node: indentLessButton, on: true },
  ])

  // ————————————————— 渲染 —————————————————

  /** 根节点子节点序：空段按钮 → 主句柄 → 块菜单 → 对齐子菜单（模板顺序）。 */
  function renderRoot() {
    if (!el.parentNode && state.visible && host) host.insertBefore(el, anchor || null)
    if (el.parentNode && !state.visible) el.parentNode.removeChild(el)
    if (!state.visible) return
    el.classList.toggle('is-menu-open', !!state.menuOpen)
    applyStyle(el, state.style)
    syncChildren(el, [
      { node: emptyButton, on: state.buttonKind === 'empty' },
      { node: mainButton, on: state.buttonKind === 'main' },
      { node: menuEl, on: !!state.menuOpen },
      // `v-if="blockAlignMenuOpen && featureEnabled('blockStyle')"` —— 门控在 state 里折好
      { node: alignMenu, on: !!state.alignOpen },
    ])
  }

  function renderMenu() {
    const features = state.features || {}
    const blockStyle = features.blockStyle !== false
    setAttr(alignTrigger, 'aria-expanded', state.alignOpen ? 'true' : 'false')
    setAttr(colorTrigger, 'aria-expanded', state.colorOpen ? 'true' : 'false')

    syncTypeActions(state.typeActions)
    syncColors(state.colors)
    syncListActions(state.listActions)

    syncChildren(menuEl, [
      { node: aiButton, on: features.ai !== false },
      { node: menuDividerAi, on: features.ai !== false },
      { node: typeSection, on: state.typeActions.length > 0 && !state.table },
      { node: duplicateButton, on: !!state.canDuplicate && !state.table },
      { node: menuDividerStyle, on: !state.table },
      { node: alignTrigger, on: blockStyle && !state.table },
      { node: colorTrigger, on: blockStyle && !state.table },
      { node: colorMenu, on: !!state.colorOpen && blockStyle },
      { node: tableGroup, on: !!state.table && features.tables !== false },
      { node: menuDividerActions, on: state.listActions.length > 0 },
      ...listActionButtons.map((node) => ({ node, on: true })),
      { node: menuDividerFooter, on: blockStyle },
      { node: addBelowButton, on: !!state.canAddBelow },
    ])

    // 表格开关：`aria-checked` 与 `.lark-doc-menu-switch.on` 同步（点完立刻能看到翻转）
    setAttr(tableRow.button, 'aria-checked', String(!!(state.tableHeader || {}).row))
    setAttr(tableColumn.button, 'aria-checked', String(!!(state.tableHeader || {}).column))
    tableRow.switchEl.classList.toggle('on', !!(state.tableHeader || {}).row)
    tableColumn.switchEl.classList.toggle('on', !!(state.tableHeader || {}).column)

    // 对齐子菜单
    const alignName = state.alignNames || {}
    const alignGlyph = state.alignGlyphs || {}
    const align = state.align || { value: 'left', indent: 0, canIncrease: false }
    alignButtons.forEach((entry) => {
      const active = align.value === entry.align
      entry.glyph.textContent = alignGlyph[entry.align] || ''
      entry.text.textContent = `${alignName[entry.align] || entry.align}对齐`
      entry.button.classList.toggle('active', active)
      setAttr(entry.button, 'aria-pressed', String(active))
      syncChildren(entry.button, [
        { node: entry.glyph, on: true },
        { node: entry.text, on: true },
        { node: entry.check, on: active },
      ])
    })
    indentMoreButton.disabled = !align.canIncrease
    indentLessButton.disabled = !(align.indent > 0)
    syncChildren(indentMoreButton, [
      { node: indentMoreGlyph, on: true },
      { node: indentMoreText, on: true },
      { node: indentMoreHelp, on: !align.canIncrease },
    ])
  }

  // ————————————————— 对外 —————————————————

  /**
   * 句柄本体（`pointermove` 热路径）。**不碰菜单内容** —— 见文件头。
   * @param {object} patch
   */
  function updateChrome(patch) {
    Object.assign(state, patch || {})
    if (patch && patch.glyph !== undefined && glyphNode.textContent !== String(state.glyph)) {
      glyphNode.textContent = String(state.glyph)
    }
    if (patch && patch.isCallout !== undefined) mainButton.classList.toggle('is-callout', !!state.isCallout)
    if (patch && patch.draggable !== undefined) setAttr(mainButton, 'draggable', String(!!state.draggable))
    renderRoot()
  }

  /**
   * 菜单内容（开合、类型网格、颜色、表格开关、对齐）。所有字段一次推平。
   * @param {object} patch
   */
  function updateMenu(patch) {
    Object.assign(state, patch || {})
    renderRoot()
    renderMenu()
  }

  return {
    el,
    updateChrome,
    updateMenu,
    // 定位要用的节点引用：调用方以前靠 `querySelector` 反查，原生层直接给。
    get mainEl() { return mainButton },
    get menuEl() { return menuEl },
    get alignMenuEl() { return alignMenu },
    get colorMenuEl() { return colorMenu },
    get alignTrigger() { return alignTrigger },
    get colorTrigger() { return colorTrigger },
    destroy() {
      if (el.parentNode) el.parentNode.removeChild(el)
    },
  }
}
