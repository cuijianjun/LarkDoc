/**
 * 工具栏 —— 原生 DOM 版（`src/ui/` 积木 · 阶段 5 批次 2）。
 *
 * 与 `editor/ToolbarBar.vue` 是同一个 UI 的两套渲染（并存期结束后 SFC 删除）。
 * **结构即契约**：`scripts/verify-browser-toolbar.js` 51 条断言在逐字段量这里产出的
 * DOM —— 七个分组顺序、每个按钮的 `aria-label`/`title`、30px 盒模型、
 * 条件段的「真不在 DOM 里」、折叠段的 `display:none`，全都不能凭手感改。
 *
 * 三条规矩（与 `bubbleBar.js` 一致）：
 * 1. **结构即契约**：类名 / `role` / `aria-*` / 段序逐字段复刻 SFC；
 *    `v-if` → 真的 insert/remove（不是 `display:none`），
 *    `v-show` → `style.display`（保留节点与状态）。
 * 2. **一次建节点、之后只改属性**：`update(state)` 只写属性 / 类名 / style。
 *    只有「更多」弹层内容、marks 按钮表、图表类型表三处是动态列表，按签名重建。
 * 3. **同步定位**：节点同步插入 DOM，`getBoundingClientRect()` 立刻可量，
 *    不需要等一帧再定位（Vue 模板里那串 `$nextTick` 时序点就此消灭）。
 *
 * 与 SFC 的一处**刻意不同**：`header-actions` 是 Vue 插槽，原生层无法承接，
 * 所以调用方把一个 Vue 持有的宿主节点（`actionsHost`）传进来，本模块负责把它
 * 搬进 `.lark-doc-header-menu`；关菜单后由调用方挪回隐藏停泊位。
 * 这只是节点搬运，插槽内容始终由 Vue 渲染与更新。
 */

import { iconNode } from './icon'
import { createHeadingMenu } from './headingMenu'
import { createSelect } from './select'
import { applyStyle, setAttr, setVisible, syncChildren } from './dom'

/** 分组定义：id / 类名 / 是否受 `toolbarEnabled()` 管。顺序即 DOM 顺序。 */
const GROUPS = [
  { id: 'history', cls: 'lark-doc-tools', gated: true },
  { id: 'headings', cls: 'lark-doc-tools lark-doc-heading-tool', gated: true },
  { id: 'marks', cls: 'lark-doc-tools', gated: true },
  { id: 'textStyle', cls: 'lark-doc-tools', gated: true },
  { id: 'blockStyle', cls: 'lark-doc-tools', gated: true },
  { id: 'insert', cls: 'lark-doc-tools', gated: true },
  { id: 'toolsEnd', cls: 'lark-doc-tools lark-doc-tools-end', gated: false },
]

const ALIGN_ORDER = ['left', 'center', 'right', 'justify']

/**
 * @param {object} options
 * @param {object} [options.handlers] 全部交互回调（键名与 SFC 里的 `ed.xxx` 一一对应）
 * @param {HTMLElement|null} [options.actionsHost] Vue 持有的 `header-actions` 宿主节点
 * @param {object} [options.alignNames] `{ left: '左', … }`
 * @returns {{ el: HTMLDivElement, update(state: object): void, destroy(): void }}
 */
export function createToolbar(options = {}) {
  const handlers = options.handlers || {}
  const actionsHost = options.actionsHost || null
  let alignNames = options.alignNames || {}

  const call = (name, ...args) => {
    const fn = handlers[name]
    return typeof fn === 'function' ? fn(...args) : undefined
  }

  // ————————————————— 基础工厂 —————————————————

  /**
   * 工具按钮。`type` 必须是 button —— 否则在 `<form>` 里会被当提交按钮。
   * `preventDefault` 只在 SFC 里确实写了 `@mousedown.prevent` 的按钮上打开：
   * 撤销/重做/插入/图表这些在飞书里是会抢焦点的普通按钮，拦掉 mousedown 默认行为
   * 会让「点完按钮继续输入」的手感变样。
   */
  function makeButton(spec) {
    const button = document.createElement('button')
    button.type = 'button'
    if (spec.cls) button.className = spec.cls
    if (spec.label !== undefined) {
      button.setAttribute('aria-label', spec.label)
      button.setAttribute('title', spec.title === undefined ? spec.label : spec.title)
    } else if (spec.title !== undefined) {
      button.setAttribute('title', spec.title)
    }
    if (spec.icon) button.appendChild(iconNode(spec.icon, spec.iconSize || 16, spec.caret ? 'lark-doc-caret' : ''))
    if (spec.text) button.appendChild(document.createTextNode(spec.text))
    if (spec.preventDefault) button.addEventListener('mousedown', (event) => event.preventDefault())
    if (spec.onClick) button.addEventListener('click', (event) => spec.onClick(event))
    if (spec.onMouseEnter) button.addEventListener('mouseenter', () => spec.onMouseEnter())
    if (spec.onMouseLeave) button.addEventListener('mouseleave', () => spec.onMouseLeave())
    return button
  }

  // ————————————————— 外壳 —————————————————

  const el = document.createElement('div')
  el.className = 'lark-doc-toolbar'
  el.setAttribute('role', 'toolbar')
  el.setAttribute('aria-label', '文档工具栏')
  // `@mousedown="ed.rememberSelection"`：工具栏任何按下都要记住选区，
  // 后面的 `openLinkDialog` / `applyTextStyle` 才有选区可用。
  el.addEventListener('mousedown', () => call('rememberSelection'))

  const groupEls = {}
  GROUPS.forEach((group) => {
    const node = document.createElement('div')
    node.className = group.cls
    groupEls[group.id] = node
  })

  // ————————————————— ① 历史 —————————————————

  const undoButton = makeButton({ label: '撤销', icon: 'undo', onClick: () => call('run', 'undo') })
  const redoButton = makeButton({ label: '重做', icon: 'redo', onClick: () => call('run', 'redo') })
  groupEls.history.appendChild(undoButton)
  groupEls.history.appendChild(redoButton)

  // ————————————————— ② 标题级别 —————————————————

  /** 触发器内容是「当前块标签 + caret」，标签必须是文本节点（断言量 `textContent`）。 */
  const headingLabelNode = document.createTextNode('正文')
  const headingButton = document.createElement('button')
  headingButton.type = 'button'
  headingButton.setAttribute('aria-label', '标题级别')
  headingButton.setAttribute('title', '标题级别')
  headingButton.setAttribute('aria-expanded', 'false')
  headingButton.appendChild(headingLabelNode)
  headingButton.appendChild(iconNode('chevronDown', 12, 'lark-doc-caret'))
  headingButton.addEventListener('mouseenter', () => call('openHeadingMenuOnHover'))
  headingButton.addEventListener('mouseleave', () => call('scheduleHeadingMenuClose'))
  headingButton.addEventListener('click', () => call('toggleHeadingMenu'))
  groupEls.headings.appendChild(headingButton)

  const headingMenu = createHeadingMenu({
    ariaLabel: '标题级别',
    onChoose: (level) => call('setHeading', level),
    onKeepOpen: () => call('cancelPopupHoverClose'),
    onScheduleClose: () => call('scheduleHeadingMenuClose'),
  })

  // ————————————————— ③ 行内格式（marks） —————————————————

  // 列表本身是动态的（`visibleMarks` 随配置变），按签名增量对齐：
  // 只有 id 序列变了才重建，重复 `update()` 零开销。
  let markButtons = []
  let markSignature = ''

  function syncMarks(list) {
    const signature = list.map((item) => item.id).join('|')
    if (signature === markSignature) return
    markSignature = signature
    markButtons.forEach((button) => { if (button.parentNode) button.parentNode.removeChild(button) })
    markButtons = list.map((item) => makeButton({
      cls: `lark-doc-mark-${item.id}`,
      label: item.label,
      text: item.glyph,
      preventDefault: true,
      onClick: () => call('toggleMark', item.id),
    }))
    markButtons.forEach((button) => groupEls.marks.appendChild(button))
  }

  // ————————————————— ④ 文字样式 —————————————————

  const linkButton = makeButton({
    label: '设置链接',
    icon: 'link',
    preventDefault: true,
    onClick: () => call('openLinkDialog'),
  })
  const fontSelect = createSelect({ ariaLabel: '字体', onChange: (value) => call('applyTextStyle', 'fontFamily', value) })
  const sizeSelect = createSelect({ ariaLabel: '字号', onChange: (value) => call('applyTextStyle', 'fontSize', value) })

  const colorLabel = document.createElement('label')
  colorLabel.className = 'lark-doc-color'
  colorLabel.setAttribute('title', '颜色')
  colorLabel.setAttribute('aria-haspopup', 'menu')
  colorLabel.setAttribute('aria-expanded', 'false')
  // `@mouseenter="ed.openColorPaletteOnHover"`：Vue 的方法引用写法会把原生事件当第一参传进去，
  // 而 `toggleColorPalette` 要靠 `event.currentTarget` 定位取色面板 —— 这里必须照样传。
  colorLabel.addEventListener('mouseenter', (event) => call('openColorPaletteOnHover', event))
  colorLabel.addEventListener('mouseleave', () => call('scheduleColorPaletteClose'))
  colorLabel.addEventListener('click', (event) => { event.preventDefault(); call('toggleColorPalette', 'textColor', event) })

  const colorLetter = document.createElement('span')
  colorLetter.className = 'lark-doc-color-letter lark-doc-color-letter-hl'
  colorLetter.setAttribute('aria-hidden', 'true')
  colorLetter.textContent = 'A'

  const textColorInput = document.createElement('input')
  textColorInput.type = 'color'
  textColorInput.setAttribute('aria-label', '文字颜色')
  textColorInput.addEventListener('focus', () => call('rememberSelection'))
  textColorInput.addEventListener('input', () => call('applyTextColor', textColorInput.value))

  const backgroundInput = document.createElement('input')
  backgroundInput.type = 'color'
  backgroundInput.setAttribute('aria-label', '背景颜色')
  backgroundInput.addEventListener('focus', () => call('rememberSelection'))
  backgroundInput.addEventListener('input', () => call('applyTextBackground', backgroundInput.value))

  colorLabel.appendChild(colorLetter)
  colorLabel.appendChild(iconNode('chevronDown', 12, 'lark-doc-caret lark-doc-color-arrow'))
  colorLabel.appendChild(textColorInput)
  colorLabel.appendChild(backgroundInput)

  groupEls.textStyle.appendChild(linkButton)
  groupEls.textStyle.appendChild(fontSelect.el)
  groupEls.textStyle.appendChild(sizeSelect.el)
  groupEls.textStyle.appendChild(colorLabel)

  // ————————————————— ⑤ 段落样式 —————————————————

  const lineHeightSelect = createSelect({ ariaLabel: '行高', onChange: (value) => call('applyLineHeight', value) })
  const alignButtons = ALIGN_ORDER.map((align) => makeButton({
    label: `对齐${alignNames[align] || align}`,
    icon: `align-${align}`,
    preventDefault: true,
    onClick: () => call('setAlign', align),
  }))
  const indentDecButton = makeButton({ label: '减少缩进', icon: 'indent-dec', preventDefault: true, onClick: () => call('changeIndent', -1) })
  const indentIncButton = makeButton({ label: '增加缩进', icon: 'indent-inc', preventDefault: true, onClick: () => call('changeIndent', 1) })
  const clearButton = makeButton({ label: '清除格式', icon: 'clear', preventDefault: true, onClick: () => call('clearFormatting') })

  groupEls.blockStyle.appendChild(lineHeightSelect.el)
  alignButtons.forEach((button) => groupEls.blockStyle.appendChild(button))
  groupEls.blockStyle.appendChild(indentDecButton)
  groupEls.blockStyle.appendChild(indentIncButton)
  groupEls.blockStyle.appendChild(clearButton)

  // ————————————————— ⑥ 插入 / 表格 / AI —————————————————

  const insertButton = makeButton({
    label: '插入',
    title: '插入内容',
    icon: 'plus',
    text: '插入',
    onClick: (event) => call('openCommandMenu', 'plus', event),
  })
  const tableButton = makeButton({ label: '插入表格', icon: 'table', preventDefault: true, onClick: () => call('onTableToolbarClick') })
  const diagramButton = makeButton({ label: '图表', title: '插入图表', icon: 'chart', onClick: () => call('toggleDiagramMenu') })
  const aiButton = makeButton({ label: 'AI 助手', icon: 'sparkle', text: 'AI', onClick: () => call('emitAiRequest', 'rewrite') })

  const diagramMenu = document.createElement('div')
  diagramMenu.className = 'lark-doc-dropdown lark-doc-diagram-menu'
  diagramMenu.setAttribute('role', 'menu')
  diagramMenu.setAttribute('aria-label', '图表类型')
  let diagramButtons = []
  let diagramSignature = ''

  function syncDiagramItems(types) {
    const signature = types.map((item) => item.id).join('|')
    if (signature === diagramSignature) return
    diagramSignature = signature
    diagramButtons.forEach((button) => { if (button.parentNode) button.parentNode.removeChild(button) })
    diagramButtons = types.map((item) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.setAttribute('role', 'menuitem')
      button.addEventListener('mousedown', (event) => event.preventDefault())
      button.addEventListener('click', () => call('insertDiagramType', item.id))
      button.textContent = item.label
      diagramMenu.appendChild(button)
      return button
    })
  }

  groupEls.insert.appendChild(insertButton)
  groupEls.insert.appendChild(tableButton)
  groupEls.insert.appendChild(diagramButton)
  groupEls.insert.appendChild(aiButton)

  // ————————————————— ⑦ 收尾 —————————————————

  const toolsEndInner = document.createElement('span')
  toolsEndInner.className = 'lark-doc-tools-end-inner'

  const searchButton = makeButton({ label: '查找', icon: 'search', onClick: () => call('openSearchPanel') })
  const outlineButton = makeButton({ label: '目录', icon: 'outline', onClick: () => call('toggleOutlineOpen') })
  const widthSelect = createSelect({ ariaLabel: '页面宽度', onChange: (value) => call('setWidthMode', value) })

  // 阅读 / 全屏 / 演示 三个是「切换类」按钮：标签随状态变，故在 update 里重写。
  const readingButton = makeButton({ label: '阅读模式', icon: 'reading', onClick: () => call('toggleReading') })
  const fullscreenButton = makeButton({ label: '全屏', icon: 'fullscreen', onClick: () => call('toggleFullscreen') })
  const slidesButton = makeButton({ label: '演示模式', icon: 'slides', onClick: () => call('toggleSlides') })
  const shortcutsButton = makeButton({ label: '快捷键帮助', text: '?', onClick: () => call('toggleHelpOpen') })
  const docOpsButton = makeButton({ label: '文档操作', text: '⋯', onClick: () => call('toggleHeaderMenu') })

  toolsEndInner.appendChild(searchButton)
  toolsEndInner.appendChild(outlineButton)
  toolsEndInner.appendChild(widthSelect.el)
  toolsEndInner.appendChild(readingButton)
  toolsEndInner.appendChild(fullscreenButton)
  toolsEndInner.appendChild(slidesButton)
  toolsEndInner.appendChild(shortcutsButton)
  toolsEndInner.appendChild(docOpsButton)

  const headerMenu = document.createElement('div')
  headerMenu.className = 'lark-doc-dropdown lark-doc-header-menu'
  headerMenu.setAttribute('role', 'menu')
  headerMenu.setAttribute('aria-label', '文档操作')

  const moreButton = document.createElement('button')
  moreButton.type = 'button'
  moreButton.setAttribute('aria-label', '更多')
  moreButton.setAttribute('title', '更多工具')
  moreButton.setAttribute('aria-expanded', 'false')
  moreButton.appendChild(document.createTextNode('更多'))
  moreButton.appendChild(iconNode('chevronDown', 12, 'lark-doc-caret'))
  moreButton.addEventListener('mouseenter', () => call('openMoreMenuOnHover'))
  moreButton.addEventListener('mouseleave', () => call('scheduleMoreMenuClose'))
  moreButton.addEventListener('click', () => call('toggleMoreMenuGuarded'))

  const moreMenu = document.createElement('div')
  moreMenu.className = 'lark-doc-dropdown lark-doc-more-menu'
  moreMenu.setAttribute('role', 'menu')
  moreMenu.setAttribute('aria-label', '更多工具')
  moreMenu.addEventListener('mouseenter', () => call('cancelPopupHoverClose'))
  moreMenu.addEventListener('mouseleave', () => call('scheduleMoreMenuClose'))

  groupEls.toolsEnd.appendChild(toolsEndInner)

  // ————————————————— 组装 —————————————————

  // 子节点的「有序增删」语义（`v-if`）由 `dom.js` 的 `syncChildren` 统一提供：
  // 已在正确位置的节点一律不动 —— 重新 `appendChild` 会在鼠标下补发 `mouseenter`，
  // 把刚被 Esc 关掉的「更多」弹层又打开（批次 2 踩过）。

  // 「更多」弹层内容：完全动态，按签名重建（它整段本来就在 `v-if` 里）。
  let moreSignature = ''

  function syncMoreSections(sections) {
    const signature = sections.map((section) => [
      section.id,
      section.items.map((item) => `${item.label}\u0002${item.disabled ? 1 : 0}\u0002${item.checked ? 1 : 0}`).join('\u0001'),
    ].join('\u0003')).join('\u0004')
    if (signature === moreSignature) return
    moreSignature = signature
    moreMenu.textContent = ''
    sections.forEach((section) => {
      const title = document.createElement('div')
      title.className = 'lark-doc-more-title'
      title.textContent = section.title
      moreMenu.appendChild(title)
      section.items.forEach((item) => {
        const button = document.createElement('button')
        button.type = 'button'
        button.setAttribute('role', 'menuitem')
        if (item.disabled) button.disabled = true
        if (item.checked) button.classList.add('lark-doc-more-active')
        button.addEventListener('mousedown', (event) => event.preventDefault())
        button.addEventListener('click', (event) => call('runMoreItem', item, event))
        const check = document.createElement('span')
        check.className = 'lark-doc-select-check'
        check.setAttribute('aria-hidden', 'true')
        check.textContent = item.checked ? '✓' : ''
        button.appendChild(check)
        button.appendChild(document.createTextNode(item.label))
        moreMenu.appendChild(button)
      })
    })
  }

  /**
   * @param {object} state 见调用方 `toolbarUiMixin.buildToolbarState()`
   */
  function update(state) {
    const next = state || {}
    const enabled = next.groups || {}
    const disabled = !!next.readonly
    const collapsed = next.collapsed || []
    const textStyle = next.textStyle || {}
    const options = next.options || {}
    const features = next.features || {}
    const view = next.view || {}
    const active = next.active || {}
    const indent = next.indent || { level: 0, canIncrease: false }

    if (next.alignNames) alignNames = next.alignNames
    // 对齐按钮的文案由 alignNames 决定，换语言/换配置时要跟着变
    alignButtons.forEach((button, index) => {
      const label = `对齐${alignNames[ALIGN_ORDER[index]] || ALIGN_ORDER[index]}`
      setAttr(button, 'aria-label', label)
      setAttr(button, 'title', label)
    })

    syncChildren(el, GROUPS.map((group) => ({
      node: groupEls[group.id],
      on: !group.gated || enabled[group.id] !== false,
    })))
    // `v-show="!isGroupCollapsed(id)"` —— 折叠是「不占布局」而非「移出 DOM」。
    // ⚠️ `toolsEnd` 例外：模板里 v-show 挂在**内层 span** 上（见 ⑦），外层 div 不能隐藏，
    // 否则「更多」按钮跟着消失，被收纳的分组就再也打不开了。
    GROUPS.forEach((group) => {
      if (group.id === 'toolsEnd') return
      setVisible(groupEls[group.id], !collapsed.includes(group.id))
    })

    // ① 历史
    undoButton.disabled = disabled
    redoButton.disabled = disabled

    // ② 标题级别
    headingButton.disabled = disabled
    setAttr(headingButton, 'aria-expanded', next.heading && next.heading.open ? 'true' : 'false')
    const headingText = (next.heading && next.heading.label) || '正文'
    if (headingLabelNode.nodeValue !== headingText) headingLabelNode.nodeValue = headingText
    headingMenu.update(next.heading ? next.heading.level : null)
    if (next.heading && next.heading.open) applyStyle(headingMenu.el, next.heading.style)
    syncChildren(groupEls.headings, [
      { node: headingButton, on: true },
      { node: headingMenu.el, on: !!(next.heading && next.heading.open) },
    ])

    // ③ 行内格式
    const marks = next.marks || []
    syncMarks(marks)
    markButtons.forEach((button, index) => {
      const item = marks[index]
      if (!item) return
      button.disabled = disabled
      setAttr(button, 'aria-pressed', active[item.id] ? 'true' : 'false')
    })

    // ④ 文字样式
    linkButton.disabled = disabled || !next.hasSelection
    setAttr(linkButton, 'aria-pressed', active.link ? 'true' : 'false')
    fontSelect.update({ options: options.fontFamily, value: textStyle.fontFamily, disabled })
    sizeSelect.update({ options: options.fontSize, value: textStyle.fontSize, disabled })
    setAttr(colorLabel, 'aria-expanded', next.colorOpenFor === 'textColor' ? 'true' : 'false')
    if (colorLetter.style.color !== String(textStyle.textColor || '')) colorLetter.style.color = textStyle.textColor || ''
    const letterBackground = `linear-gradient(transparent 52%, ${textStyle.backgroundColor} 52%)`
    if (colorLetter.style.background !== letterBackground) colorLetter.style.background = letterBackground
    textColorInput.disabled = disabled
    backgroundInput.disabled = disabled
    // 原生 input 的 `value` 是**属性**语义：只在值真的变了才写，否则会把用户正在拖的
    // 系统取色器打断（每次 update 都写一遍 = 取色器抖动）。
    if (textStyle.textColor) {
      const textColor = String(textStyle.textColor).toLowerCase()
      if (textColorInput.value.toLowerCase() !== textColor) textColorInput.value = textStyle.textColor
    }
    if (textStyle.backgroundColor) {
      const backgroundColor = String(textStyle.backgroundColor).toLowerCase()
      if (backgroundInput.value.toLowerCase() !== backgroundColor) backgroundInput.value = textStyle.backgroundColor
    }

    // ⑤ 段落样式
    lineHeightSelect.update({ options: options.lineHeight, value: textStyle.lineHeight, disabled })
    alignButtons.forEach((button) => { button.disabled = disabled })
    indentDecButton.disabled = disabled || indent.level <= 0
    setAttr(indentDecButton, 'title', indent.level <= 0 ? '已在最外层' : '减少缩进')
    indentIncButton.disabled = disabled || !indent.canIncrease
    setAttr(indentIncButton, 'title', indent.canIncrease ? '增加缩进' : '当前内容块已达最大缩进层级')
    clearButton.disabled = disabled

    // ⑥ 插入 / 表格 / AI
    syncChildren(groupEls.insert, [
      { node: insertButton, on: features.insert !== false },
      { node: tableButton, on: features.tables !== false },
      { node: diagramButton, on: features.diagram === true },
      { node: aiButton, on: features.ai !== false },
      { node: diagramMenu, on: !!(next.diagram && next.diagram.open) },
    ])
    const tableLabel = active.table ? '表格工具' : '插入表格'
    setAttr(tableButton, 'aria-label', tableLabel)
    setAttr(tableButton, 'title', tableLabel)
    insertButton.disabled = disabled
    tableButton.disabled = disabled
    diagramButton.disabled = disabled
    aiButton.disabled = disabled
    setAttr(diagramButton, 'aria-expanded', next.diagram && next.diagram.open ? 'true' : 'false')
    syncDiagramItems((next.diagram && next.diagram.types) || [])
    if (next.diagram && next.diagram.open) applyStyle(diagramMenu, next.diagram.style)

    // ⑦ 收尾
    setVisible(toolsEndInner, !collapsed.includes('toolsEnd'))
    syncChildren(toolsEndInner, [
      { node: searchButton, on: features.search !== false },
      { node: outlineButton, on: features.outline !== false },
      { node: widthSelect.el, on: features.viewModes !== false },
      // 「阅读模式」还要 `modes.allow` 含 read —— 配置摘掉这一项后按钮点了也不会切。
      { node: readingButton, on: features.viewModes !== false && features.read !== false },
      { node: fullscreenButton, on: features.viewModes !== false },
      { node: slidesButton, on: features.viewModes !== false },
      { node: shortcutsButton, on: features.shortcuts !== false },
      // `v-if="!headerVisible && $slots['header-actions']"` —— 有没有插槽由调用方算好传进来
      { node: docOpsButton, on: features.docOps === true },
    ])

    setAttr(outlineButton, 'aria-expanded', view.outlineOpen ? 'true' : 'false')
    widthSelect.update({ options: options.widthMode, value: next.widthMode })

    const readingLabel = view.reading ? '退出阅读' : '阅读模式'
    setAttr(readingButton, 'aria-label', readingLabel)
    setAttr(readingButton, 'title', readingLabel)
    setAttr(readingButton, 'aria-pressed', view.reading ? 'true' : 'false')

    const fullscreenLabel = view.fullscreen ? '退出全屏' : '全屏'
    setAttr(fullscreenButton, 'aria-label', fullscreenLabel)
    setAttr(fullscreenButton, 'title', fullscreenLabel)
    setAttr(fullscreenButton, 'aria-pressed', view.fullscreen ? 'true' : 'false')

    const slidesLabel = view.slides ? '退出演示' : '演示模式'
    setAttr(slidesButton, 'aria-label', slidesLabel)
    setAttr(slidesButton, 'title', slidesLabel)
    setAttr(slidesButton, 'aria-pressed', view.slides ? 'true' : 'false')

    // 「文档操作」弹层：只读态下它仍要能开（保存/导出/快照都在里面）
    const headerState = next.headerMenu || {}
    setAttr(docOpsButton, 'aria-expanded', headerState.open ? 'true' : 'false')
    if (headerState.open) applyStyle(headerMenu, headerState.style)
    // 承接插槽：宿主节点由调用方持有，这里只保证它在菜单里（`appendChild` 就是搬运）
    if (headerState.open && actionsHost && actionsHost.parentNode !== headerMenu) headerMenu.appendChild(actionsHost)

    // 「更多」：只有真的收纳过某些组才出现，否则连节点都不要留
    const more = next.more || {}
    setAttr(moreButton, 'aria-expanded', more.open ? 'true' : 'false')
    if (more.open) {
      syncMoreSections(more.sections || [])
      applyStyle(moreMenu, more.style)
    }
    // 顺序即模板顺序：span → header-menu → 更多 → 更多弹层
    syncChildren(groupEls.toolsEnd, [
      { node: toolsEndInner, on: true },
      { node: headerMenu, on: !!headerState.open },
      { node: moreButton, on: !!more.visible },
      { node: moreMenu, on: !!more.open },
    ])
  }

  GROUPS.forEach((group) => el.appendChild(groupEls[group.id]))

  return {
    el,
    update,
    destroy() {
      // 插槽宿主是 Vue 的资产：交还调用方，不能跟着工具栏一起被丢掉
      if (actionsHost && actionsHost.parentNode === headerMenu) headerMenu.removeChild(actionsHost)
      if (el.parentNode) el.parentNode.removeChild(el)
    },
  }
}
