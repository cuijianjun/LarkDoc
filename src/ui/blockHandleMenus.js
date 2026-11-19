/** Private block-menu rows. The hot handle owns these containers and the live state. */
import { iconNode } from './icon'
import { applyStyle, setAttr, syncChildren } from './dom'

const ALIGN_ORDER = ['left', 'center', 'right', 'justify']

export function createBlockHandleMenus(options) {
  const { state, call, menuEl, alignMenu, colorMenu, alignTrigger, colorTrigger, preventMouseDown, makeIconLabel } = options
  let destroyed = false

  function makeDivider(className) {
    const node = document.createElement('div')
    node.className = className
    node.setAttribute('role', 'separator')
    return node
  }

  const aiButton = preventMouseDown(document.createElement('button'))
  aiButton.type = 'button'
  aiButton.setAttribute('role', 'menuitem')
  aiButton.className = 'lark-doc-block-menu-ai'
  aiButton.setAttribute('aria-label', '问问AI')
  aiButton.addEventListener('click', () => { if (state.aiAllowed !== false) call('emitAiRequest', 'rewrite') })
  aiButton.appendChild(iconNode('sparkle', 16, 'lark-doc-block-menu-icon'))
  const aiText = document.createElement('span')
  aiText.textContent = '问问AI'
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
    const signature = items.map((item) => [item.id, item.label, item.icon, item.active ? 1 : 0, item.disabled ? 1 : 0].join('\u0002')).join('\u0001')
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
      button.disabled = !!item.disabled
      button.classList.toggle('is-disabled', !!item.disabled)
      setAttr(button, 'aria-disabled', String(!!item.disabled))
      button.addEventListener('click', () => call('blockTypeAction', item.id))
      button.appendChild(iconNode(item.icon, 20, 'lark-doc-block-type-icon'))
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
  duplicateButton.classList.add('lark-doc-block-menu-row')
  duplicateButton.setAttribute('aria-label', '创建副本')
  duplicateButton.addEventListener('click', () => call('blockAction', 'duplicate'))
  duplicateButton.append(...makeIconLabel('copy', 18, '创建副本'))

  const menuDividerStyle = makeDivider('lark-doc-block-menu-divider')

  /** 子菜单触发项：「图标 + 文案 + ›」，悬停/聚焦/点击三入口展开（飞书口径）。 */

  // ————————————————— ③ 颜色子菜单 —————————————————
  // ⚠️ 与 SFC 一致：它是 `.lark-doc-block-menu` 的**子节点**（夹在两个触发项与
  // 表格组之间），不要「顺手」挪到根上 —— 段序断言按模板顺序量。

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
    const [iconEl, textEl] = makeIconLabel(spec.icon, 18, spec.label)
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
    const signature = items.map((item) => `${item.id}\u0002${item.label}\u0002${item.icon}\u0002${!!item.disabled}\u0002${item.title || ''}\u0002${item.hint || ''}`).join('\u0001')
    if (signature === listActionSignature) return
    listActionSignature = signature
    listActionButtons.forEach((button) => { if (button.parentNode) button.parentNode.removeChild(button) })
    listActionButtons = items.map((item) => {
      const button = preventMouseDown(document.createElement('button'))
      button.type = 'button'
      button.setAttribute('role', 'menuitem')
      button.className = 'lark-doc-block-menu-row'
      button.setAttribute('title', item.title || item.hint || item.label)
      button.disabled = !!item.disabled
      button.classList.toggle('is-disabled', !!item.disabled)
      setAttr(button, 'aria-disabled', String(!!item.disabled))
      button.addEventListener('click', () => { if (!button.disabled) call('blockAction', item.id) })
      const [iconEl, textEl] = makeIconLabel(item.icon, 18, item.label)
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
  addBelowButton.setAttribute('title', '在下方添加')
  addBelowButton.setAttribute('aria-haspopup', 'menu')
  addBelowButton.setAttribute('aria-expanded', 'false')
  addBelowButton.addEventListener('click', (event) => call('openBlockInsertMenu', event))
  {
    const [iconEl, textEl] = makeIconLabel('plus', 18, '在下方添加')
    addBelowButton.appendChild(iconEl)
    addBelowButton.appendChild(textEl)
    addBelowButton.appendChild(iconNode('link-view-caret', 14, 'lark-doc-block-menu-arrow'))
  }

  // ————————————————— ⑥ 缩进和对齐子菜单（根的直接子节点） —————————————————

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
    check.appendChild(iconNode('check', 16, 'lark-doc-align-check-icon'))
    const checkText = document.createElement('span')
    checkText.className = 'sr-only'
    checkText.textContent = '✓'
    check.appendChild(checkText)
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
  indentMoreGlyph.appendChild(iconNode('indent-inc', 18, 'lark-doc-block-align-icon'))
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
  indentLessGlyph.appendChild(iconNode('indent-dec', 18, 'lark-doc-block-align-icon'))
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

  function renderMenu() {
    const features = state.features || {}
    const blockStyle = features.blockStyle !== false
    aiButton.disabled = state.aiAllowed === false
    aiButton.classList.toggle('is-disabled', aiButton.disabled)
    setAttr(aiButton, 'aria-disabled', String(aiButton.disabled))
    setAttr(aiButton, 'aria-description', state.aiTitle || null)
    applyStyle(menuEl, state.menuStyle)
    applyStyle(alignMenu, state.alignMenuStyle)
    applyStyle(colorMenu, state.colorMenuStyle)
    setAttr(alignTrigger, 'aria-expanded', state.alignOpen ? 'true' : 'false')
    setAttr(colorTrigger, 'aria-expanded', state.colorOpen ? 'true' : 'false')
    ;[alignTrigger, colorTrigger].forEach((button) => {
      button.classList.toggle('is-disabled', state.editAllowed === false)
      setAttr(button, 'aria-disabled', String(state.editAllowed === false))
    })
    duplicateButton.disabled = state.duplicateAllowed === false
    duplicateButton.classList.toggle('is-disabled', duplicateButton.disabled)
    setAttr(duplicateButton, 'aria-disabled', String(duplicateButton.disabled))

    syncTypeActions(state.typeActions)
    syncColors(state.colors)
    syncListActions(state.listActions)

    syncChildren(menuEl, [
      { node: aiButton, on: features.ai !== false },
      { node: menuDividerAi, on: features.ai !== false },
      { node: typeSection, on: state.typeActions.length > 0 && !state.table },
      { node: menuDividerStyle, on: !state.table },
      { node: alignTrigger, on: blockStyle && !state.table },
      { node: colorTrigger, on: blockStyle && !state.table },
      { node: colorMenu, on: !!state.colorOpen && blockStyle },
      { node: tableGroup, on: !!state.table && features.tables !== false },
      { node: menuDividerActions, on: state.listActions.length > 0 },
      ...listActionButtons.map((node) => ({ node, on: true })),
      { node: duplicateButton, on: !!state.canDuplicate && !state.table },
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
    const align = state.align || { value: 'left', indent: 0, canIncrease: false }
    alignButtons.forEach((entry) => {
      const active = align.value === entry.align
      const alignIcon = `align-${entry.align}`
      const nextIcon = entry.glyph.dataset.icon
      if (nextIcon !== alignIcon) {
        const svg = iconNode(alignIcon, 18, 'lark-doc-block-align-icon')
        svg.dataset.icon = alignIcon
        entry.glyph.textContent = ''
        entry.glyph.appendChild(svg)
        entry.glyph.dataset.icon = alignIcon
      }
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

  return {
    el: menuEl,
    update() { if (!destroyed) renderMenu() },
    // The original handle owns removal and preserves getter/node identities.
    destroy() { destroyed = true },
  }
}
