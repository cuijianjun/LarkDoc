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
import { createLazyView } from './lazy'
import { createHeadingMenu, HEADING_MENU_OPTIONS } from './headingMenu'
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
const MARK_ICONS = {
  bold: 'mark-bold',
  italic: 'mark-italic',
  underline: 'mark-underline',
  strike: 'mark-strike',
  code: 'inlineCode',
  subscript: 'mark-subscript',
  superscript: 'mark-superscript',
  highlight: 'mark-highlight',
}

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

  let mobileState = {}, mobilePanel = '', mobileUi
  const mobileMarks = new Map()
  const mobileHeadingOptions = state => Array.isArray(state.heading?.options) ? state.heading.options : HEADING_MENU_OPTIONS
  const mobileAllowed = () => mobileState.mobileAccessory && !mobileState.readonly
  function mobileButton(spec) {
    const action = spec.onClick
    return makeButton({ iconSize: 24, ...spec, preventDefault: true, onClick: event => {
      if (mobileAllowed() && (!spec.enabled || spec.enabled(mobileState))) action?.(event)
    } })
  }
  function renderMobile(next) {
    if (!mobileUi) {
      const bar = document.createElement('div')
      bar.className = 'lark-doc-mobile-edit-bar'
      const panel = document.createElement('div')
      panel.className = 'lark-doc-mobile-format-panel'
      panel.setAttribute('role', 'toolbar')
      const toggle = id => { mobilePanel = mobilePanel === id ? '' : id; update(mobileState) }
      const ai = mobileButton({ enabled: s => s.features?.ai === true, label: 'AI 改写', icon: 'sparkle', text: 'AI 改写', onClick: () => call('emitAiRequest', 'rewrite') })
      const plus = mobileButton({ enabled: s => s.features?.insert !== false, label: '插入内容', icon: 'mobile-insert', onClick: event => { mobilePanel = ''; call('openCommandMenu', 'plus', event) } })
      const headings = mobileButton({ enabled: s => s.groups?.headings !== false || s.groups?.blockStyle !== false, label: '段落类型', text: 'T', onClick: () => toggle('headings') })
      const marks = mobileButton({ enabled: s => s.groups?.marks !== false || s.groups?.textStyle !== false, label: '行内格式', text: 'Aa', onClick: () => toggle('marks') })
      const paragraph = mobileButton({ enabled: s => s.groups?.blockStyle !== false, label: '段落格式', icon: 'align-left', onClick: () => toggle('paragraph') })
      const keyboard = mobileButton({ label: '收起键盘', icon: 'keyboard-hide', onClick: () => { mobilePanel = ''; call('hideMobileKeyboard') } })
      const headingRows = HEADING_MENU_OPTIONS.map(option => ({ ...option, button: mobileButton({
        enabled: s => s.groups?.headings !== false && mobileHeadingOptions(s).some(item => item?.level === option.level && !item.disabled),
        label: option.label, text: option.glyph, onClick: () => call('setHeading', option.level),
      }) }))
      const lists = [['任务列表', 'block-task', 'toggleTaskList'], ['有序列表', 'block-ordered', 'toggleOrderedList'], ['无序列表', 'block-bullet', 'toggleBulletList']].map(([label, icon, command]) => mobileButton({ enabled: s => s.groups?.blockStyle !== false, label, icon, onClick: () => call('run', command) }))
      const blocks = [['codeBlock', 'codeBlocks', '代码块', 'block-code', 'toggleCodeBlock'], ['blockquote', 'blockquote', '引用', 'block-quote', 'toggleBlockquote']].map(([id, feature, label, icon, command]) => ({
        id, feature, button: mobileButton({ enabled: s => s.groups?.blockStyle !== false && s.features?.[feature] !== false, label, icon, onClick: () => call('run', command) }),
      }))
      const color = mobileButton({ enabled: s => s.groups?.textStyle !== false, label: '文字颜色', text: 'A', onClick: event => call('toggleColorPalette', 'textColor', event) })
      color.appendChild(iconNode('chevronDown', 12, 'lark-doc-caret'))
      const decrease = mobileButton({ enabled: s => s.groups?.blockStyle !== false && s.indent?.level > 0, label: '减少缩进', icon: 'indent-dec', onClick: () => call('changeIndent', -1) })
      const increase = mobileButton({ enabled: s => s.groups?.blockStyle !== false && s.indent?.canIncrease, label: '增加缩进', icon: 'indent-inc', onClick: () => call('changeIndent', 1) })
      const align = ALIGN_ORDER.map(value => mobileButton({ enabled: s => s.groups?.blockStyle !== false, label: `${alignNames[value] || value}对齐`, icon: `align-${value}`, onClick: () => call('setAlign', value) }))
      mobileUi = { bar, panel, ai, plus, headings, marks, paragraph, keyboard, headingRows, lists, blocks, color, decrease, increase, align }
    }
    const m = mobileUi, disabled = !!next.readonly, groups = next.groups || {}, features = next.features || {}
    if (disabled) mobilePanel = ''
    el.setAttribute('aria-label', '手机正文编辑')
    for (const [key, value] of Object.entries(next.mobileStyle || {})) el.style.setProperty(`--ld-mobile-${key}`, `${value}px`)
    syncChildren(m.bar, [
      { node: m.ai, on: features.ai === true }, { node: m.plus, on: features.insert !== false },
      { node: m.headings, on: groups.headings !== false || groups.blockStyle !== false }, { node: m.marks, on: groups.marks !== false || groups.textStyle !== false },
      { node: m.paragraph, on: groups.blockStyle !== false }, { node: m.keyboard, on: true },
    ])
    ;[m.ai, m.plus, m.headings, m.marks, m.paragraph, m.keyboard].forEach(button => { button.disabled = disabled })
    ;['headings', 'marks', 'paragraph'].forEach(id => setAttr(m[id], 'aria-expanded', String(mobilePanel === id)))
    const nodes = []
    if (mobilePanel === 'headings') {
      const extendedHeadings = [], levels = new Set()
      if (groups.headings !== false) mobileHeadingOptions(next).forEach(option => {
        const row = m.headingRows.find(item => item.level === option?.level)
        if (!row || levels.has(row.level)) return
        levels.add(row.level)
        const button = row.button, glyph = typeof option.glyph === 'string' ? option.glyph : row.glyph
        button.disabled = disabled || !!option.disabled
        setAttr(button, 'aria-label', option.label || row.label); setAttr(button, 'title', option.label || row.label)
        if (button.textContent !== glyph) button.textContent = glyph
        setAttr(button, 'aria-pressed', String((next.heading?.level ?? null) === row.level))
        // Higher levels remain supported; only T/H1–H3 were observed in the native first segment.
        ;(!Array.isArray(next.heading?.options) && row.level > 3 ? extendedHeadings : nodes).push(button)
      })
      if (groups.blockStyle !== false) m.lists.forEach((button, index) => {
        button.disabled = disabled
        setAttr(button, 'aria-pressed', String(!!next.active?.[['taskList', 'orderedList', 'bulletList'][index]]))
        nodes.push(button)
      })
      if (groups.blockStyle !== false) m.blocks.forEach(({ id, feature, button }) => {
        if (features[feature] === false) return
        button.disabled = disabled
        setAttr(button, 'aria-pressed', String(!!next.active?.[id]))
        nodes.push(button)
      })
      nodes.push(...extendedHeadings)
    } else if (mobilePanel === 'marks') {
      const extended = []
      if (groups.marks !== false) (next.marks || []).forEach(item => {
        if (!mobileMarks.has(item.id)) mobileMarks.set(item.id, mobileButton({ enabled: s => s.groups?.marks !== false && (s.marks || []).some(mark => mark.id === item.id), cls: `lark-doc-mark-${item.id}`, label: item.label, text: item.glyph, onClick: () => call('toggleMark', item.id) }))
        const button = mobileMarks.get(item.id)
        button.disabled = disabled
        setAttr(button, 'aria-pressed', String(!!next.active?.[item.id]))
        ;(['bold', 'italic', 'underline', 'strike', 'code'].includes(item.id) ? nodes : extended).push(button)
      })
      if (groups.textStyle !== false) { m.color.disabled = disabled; setAttr(m.color, 'aria-expanded', String(next.colorOpenFor === 'textColor')); nodes.push(m.color) }
      nodes.push(...extended)
    } else if (mobilePanel === 'paragraph' && groups.blockStyle !== false) {
      m.decrease.disabled = disabled || !(next.indent?.level > 0)
      m.increase.disabled = disabled || !next.indent?.canIncrease
      nodes.push(m.decrease, m.increase)
      m.align.forEach((button, index) => {
        button.disabled = disabled
        setAttr(button, 'aria-pressed', String((next.activeAlign || 'left') === ALIGN_ORDER[index]))
        nodes.push(button)
      })
    }
    m.panel.dataset.panel = mobilePanel
    m.panel.setAttribute('aria-label', mobilePanel === 'headings' ? '段落类型' : mobilePanel === 'marks' ? '行内格式' : '段落格式')
    syncChildren(m.panel, nodes.map(node => ({ node, on: true })))
    syncChildren(el, [{ node: m.panel, on: nodes.length > 0 }, { node: m.bar, on: true }])
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
    if (spec.popup) button.setAttribute('aria-haspopup', spec.popup)
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
    onKeepOpen: () => call('cancelPopupHoverClose', 'heading'),
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
      icon: MARK_ICONS[item.id] || 'inlineCode',
      iconSize: 18,
      preventDefault: true,
      onClick: () => call('toggleMark', item.id),
    }))
    markButtons.forEach((button) => groupEls.marks.appendChild(button))
  }

  // ————————————————— ④ 文字样式 —————————————————

  const linkButton = makeButton({
    label: '设置链接',
    popup: 'dialog',
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
  colorLetter.appendChild(iconNode('text-color', 18, 'lark-doc-color-icon'))
  const colorLetterText = document.createElement('span')
  colorLetterText.className = 'sr-only'
  colorLetterText.textContent = 'A'
  colorLetter.appendChild(colorLetterText)

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
    popup: 'menu',
    title: '插入内容',
    icon: 'plus',
    text: '插入',
    onClick: (event) => call('openCommandMenu', 'plus', event),
    onMouseEnter: () => call('cancelPopupHoverClose', 'command'),
    onMouseLeave: () => call('scheduleCommandMenuClose'),
  })
  insertButton.setAttribute('aria-haspopup', 'menu')
  const tableButton = makeButton({ label: '插入表格', icon: 'table', preventDefault: true, onClick: () => call('onTableToolbarClick'), onMouseEnter: () => call('openTablePickerOnHover'), onMouseLeave: () => call('scheduleTablePickerClose') })
  tableButton.appendChild(iconNode('chevronDown', 12, 'lark-doc-caret'))
  tableButton.setAttribute('aria-haspopup', 'dialog')
  // 与「图表」同一口径：真下拉不叠原生 tips。`update()` 每帧都会重刷这条按钮的
  // `aria-label`（表内切成「表格工具」），若同时写 `title`，`tooltipTarget` 首次
  // 摘掉后会被重刷回来，悬停一秒又冒一个原生提示，和展开的面板打架。
  tableButton.removeAttribute('title')
  const diagramButton = makeButton({ label: '图表', title: '插入图表', icon: 'chart', text: '图表', onClick: () => call('toggleDiagramMenu'), onMouseEnter: () => call('openDiagramMenuOnHover'), onMouseLeave: () => call('scheduleDiagramMenuClose') })
  diagramButton.appendChild(iconNode('chevronDown', 12, 'lark-doc-caret'))
  diagramButton.setAttribute('aria-haspopup', 'menu')
  const aiButton = makeButton({ label: 'AI 助手', icon: 'sparkle', text: 'AI', popup: 'dialog', onClick: () => call('emitAiRequest', 'rewrite') })

  const diagramMenuHost = document.createElement('span')
  diagramMenuHost.style.display = 'contents'
  const diagramMenu = createLazyView(() => import('./diagramMenu'), 'createDiagramMenu', { host: diagramMenuHost, handlers }, {
    onReady: () => call('positionDiagramMenu'), onError: () => call('onDiagramError'),
  })

  groupEls.insert.appendChild(insertButton)
  groupEls.insert.appendChild(tableButton)
  groupEls.insert.appendChild(diagramButton)
  groupEls.insert.appendChild(aiButton)

  // ————————————————— ⑦ 收尾 —————————————————

  const toolsEndInner = document.createElement('span')
  toolsEndInner.className = 'lark-doc-tools-end-inner'

  const searchButton = makeButton({ label: '查找', icon: 'search', popup: 'dialog', onClick: () => call('openSearchPanel') })
  const outlineButton = makeButton({ label: '目录', icon: 'outline', onClick: () => call('toggleOutlineOpen') })
  const widthSelect = createSelect({ ariaLabel: '页面宽度', onChange: (value) => call('setWidthMode', value) })

  // 阅读 / 全屏 / 演示 三个是「切换类」按钮：标签随状态变，故在 update 里重写。
  const readingButton = makeButton({ label: '阅读模式', icon: 'reading', onClick: () => call('toggleReading') })
  const fullscreenButton = makeButton({ label: '全屏', icon: 'fullscreen', onClick: () => call('toggleFullscreen') })
  const slidesButton = makeButton({ label: '演示模式', icon: 'slides', onClick: () => call('toggleSlides') })
  const shortcutsButton = makeButton({ label: '快捷键帮助', icon: 'help-keyboard', popup: 'dialog', iconSize: 18, onClick: () => call('toggleHelpOpen') })
  // 图标键是 icons.js 里的 `more`（三点横排，飞书「⋯」）；写成 `more-horizontal` 会
  // 拿不到 SVG，只留一个空 span，按钮宽度归零、点不到。
  const docOpsButton = makeButton({ label: '文档操作', icon: 'more', iconSize: 18, onClick: () => call('toggleHeaderMenu') })

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
  let headerMenuWasOpen = false

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
  moreMenu.addEventListener('mouseenter', () => call('cancelPopupHoverClose', 'more'))
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
      section.items.map((item) => `${item.label}\u0002${item.icon || ''}\u0002${item.disabled ? 1 : 0}\u0002${item.checked}\u0002${item.radio}`).join('\u0001'),
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
        const role = item.radio ? 'menuitemradio' : typeof item.checked === 'boolean' ? 'menuitemcheckbox' : 'menuitem'
        button.setAttribute('role', role)
        if (role !== 'menuitem') button.setAttribute('aria-checked', String(!!item.checked))
        if (item.disabled) button.disabled = true
        if (item.checked) button.classList.add('lark-doc-more-active')
        button.addEventListener('mousedown', (event) => event.preventDefault())
        button.addEventListener('click', (event) => call('runMoreItem', item, event))
        const check = document.createElement('span')
        check.className = 'lark-doc-select-check'
        check.setAttribute('aria-hidden', 'true')
        if (item.checked) {
          check.classList.add('is-visible')
          check.appendChild(iconNode('check', 14, 'lark-doc-check-icon'))
          const checkText = document.createElement('span')
          checkText.className = 'sr-only'
          checkText.textContent = '✓'
          check.appendChild(checkText)
        }
        button.appendChild(check)
        if (item.icon) button.appendChild(iconNode(item.icon, 16, 'lark-doc-tool-icon'))
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
    mobileState = next
    el.classList.toggle('is-mobile-accessory', !!next.mobileAccessory)
    el.classList.toggle('is-keyboard-raised', !!next.mobileAccessory && next.mobileStyle?.bottom > 0)
    if (!next.mobileAccessory) { mobilePanel = ''; el.setAttribute('aria-label', '文档工具栏') }
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

    if (!next.mobileAccessory) syncChildren(el, GROUPS.map((group) => ({
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
    linkButton.disabled = disabled || next.linkAllowed === false
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
      { node: diagramMenuHost, on: true },
    ])
    const tableLabel = active.table ? '表格工具' : '插入表格'
    setAttr(tableButton, 'aria-label', tableLabel)
    setAttr(tableButton, 'title', null)
    setAttr(tableButton, 'aria-expanded', next.table?.open ? 'true' : 'false')
    insertButton.disabled = disabled
    tableButton.disabled = disabled
    diagramButton.disabled = disabled
    aiButton.disabled = disabled
    setAttr(diagramButton, 'aria-expanded', next.diagram && next.diagram.open ? 'true' : 'false')
    diagramMenu.update(next.diagram || { open: false })

    // ⑦ 收尾
    setVisible(toolsEndInner, !collapsed.includes('toolsEnd'))
    syncChildren(toolsEndInner, [
      { node: searchButton, on: !next.compactHeader && features.search !== false },
      { node: outlineButton, on: !next.compactHeader && features.outline !== false },
      { node: widthSelect.el, on: !next.compactHeader && features.viewModes !== false },
      // 「阅读模式」还要 `modes.allow` 含 read —— 配置摘掉这一项后按钮点了也不会切。
      { node: readingButton, on: features.viewModes !== false && features.read !== false },
      { node: fullscreenButton, on: features.viewModes !== false && !next.compactHeader },
      { node: slidesButton, on: !next.compactHeader && features.viewModes !== false },
      { node: shortcutsButton, on: !next.compactHeader && features.shortcuts !== false },
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
    if (headerMenuWasOpen && !headerState.open) headerMenu.dispatchEvent(new el.ownerDocument.defaultView.Event('close'))
    headerMenuWasOpen = !!headerState.open
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
    // 空壳不占位：toolsEnd 有 `margin-left:auto` + `padding:0 6px`，
    // 内层全隐藏时这 12px 加两侧 gap 会白吃 14px，正好把 1080 宽挤进「更多」。
    // 飞书此时右侧就是空白，所以整组一起收起。
    setVisible(groupEls.toolsEnd, toolsEndInner.childElementCount > 0 || !!more.visible || !!headerState.open)
    if (next.mobileAccessory) renderMobile(next)
    syncTooltip()
  }

  GROUPS.forEach((group) => el.appendChild(groupEls[group.id]))
  const tooltip = createLazyView(() => import('./tooltip'), 'createTooltipLayer', { host: el })
  let tooltipAnchor = null
  const syncTooltip = () => tooltip.update({ open: !!tooltipAnchor, anchor: tooltipAnchor })
  const tooltipTarget = event => {
    const node = event.target.closest?.('button, [role=combobox], input[type=color]')
    if (!node || !el.contains(node)) return null
    if (node.title) { node.dataset.tooltipTitle = node.title; node.removeAttribute('title') }
    if (node.matches('[role="combobox"]') || node.querySelector('[class*="caret"]') || node.closest('[role="menu"]')) return null
    return node
  }
  const enterTip = event => { const node = tooltipTarget(event); if (!node || !node.contains(event.relatedTarget)) { tooltipAnchor = node; syncTooltip() } }
  const leaveTip = event => { const node = tooltipTarget(event); if (node && node === tooltipAnchor && !node.contains(event.relatedTarget)) { tooltipAnchor = null; syncTooltip() } }
  const hideTip = () => { if (tooltipAnchor) { tooltipAnchor = null; syncTooltip() } }
  const tooltipEvents = [['mouseover', enterTip], ['focusin', enterTip], ['mouseout', leaveTip], ['focusout', leaveTip], ['mousedown', hideTip]]
  tooltipEvents.forEach(([name, handler]) => el.addEventListener(name, handler))
  const tooltipWindow = el.ownerDocument.defaultView
  tooltipWindow.addEventListener('scroll', hideTip, true)
  tooltipWindow.addEventListener('resize', hideTip)
  el.ownerDocument.addEventListener('keydown', hideTip, true)

  return {
    el,
    update,
    destroy() {
      headerMenu.dispatchEvent(new el.ownerDocument.defaultView.Event('close'))
      tooltipEvents.forEach(([name, handler]) => el.removeEventListener(name, handler))
      tooltipWindow.removeEventListener('scroll', hideTip, true)
      tooltipWindow.removeEventListener('resize', hideTip)
      el.ownerDocument.removeEventListener('keydown', hideTip, true)
      tooltipAnchor = null; tooltip.destroy(); diagramMenu.destroy()
      // 插槽宿主是 Vue 的资产：交还调用方，不能跟着工具栏一起被丢掉
      if (actionsHost && actionsHost.parentNode === headerMenu) headerMenu.removeChild(actionsHost)
      if (el.parentNode) el.parentNode.removeChild(el)
    },
  }
}
