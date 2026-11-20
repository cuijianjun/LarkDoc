/**
 * 命令菜单（`/` 斜杠 + 空段落「＋」）—— 原生 DOM 版（`src/ui/` 积木 · 阶段 5 批次 3）。
 *
 * 原 SFC `components/lark-doc/CommandMenu.vue` 在阶段 5 批次 3 删除，这里是唯一实现。
 * **结构即契约**：`scripts/verify-browser-command-menu.js` 的 48 条断言在逐字段量
 * 这里产出的 DOM —— 段序（斜杠 15 段 / plus 3 段）、项属性（`role` / `aria-*` /
 * `data-tier` / `title`）、三分支子菜单（模板 / 分栏 / 表格 / 默认）的每一格，全都
 * 不能凭手感改。
 *
 * 三条规矩（与 `blockHandle.js` / `toolbar.js` 一致）：
 * 1. **结构即契约**：类名 / `role` / `aria-*` / 段序逐字段复刻 SFC；`v-if` → 真
 *    insert/remove，`v-show` → `style.display`（本模块没有 `v-show`）。
 * 2. **一次建节点、之后只改属性**：命令按钮按 `item.id` 缓存复用（换过滤词只换
 *    段容器里的按钮排列，**不重建按钮**）—— 重建会把鼠标下的按钮摘掉再插回，
 *    浏览器补发 `mouseenter`，刚关掉的子菜单又被自己的 hover 打开。
 * 3. **同步定位**：子菜单节点先入 DOM 再量 `getBoundingClientRect()`，
 *    SFC 里 `openSubmenu` → `$nextTick(positionSubmenu)` 的时序点就此消灭。
 *
 * ⚠️ 两个入口共用一份模板、靠 `kind` 分叉：斜杠是 15 段纵向列表（宽 280），plus 是
 * 3 段网格（宽 470，基础段 6 列），**分段顺序也各有一套**（plus 的
 * `基础/常用/其他标题` 是前置，不与斜杠共用）。宽度由 CSS 按 `is-plus` / `is-slash`
 * 决定，这里不写死。
 */

import { applyStyle, setAttr, syncChildren } from './dom'
import { iconNode, setIcon } from './icon'
import { diagramIconNode } from './diagramMenu'
import { createTooltip } from './tooltip'
import { diagramTypes } from '../components/lark-doc/editor/constants'
import { BASIC_ICONS, MENU_ICON_MARKUP, MOBILE_BASIC, MOBILE_COMMON, MOBILE_ICONS, PLUS_CATEGORIES, SEMANTIC_COMMAND_ICONS } from './commandMenuAssets'

/** 子菜单贴触发器的间距 / 视口留边（与 SFC 完全一致，断言在量）。 */
const SUBMENU_GAP = 5
const SUBMENU_MARGIN = 8

/**
 * @param {object} options
 * @param {object} [options.handlers] `onQuery` / `onMove` / `onChoose` / `onClose`
 * @param {HTMLElement|null} [options.host] 挂载宿主（`.lark-doc`）
 * @param {HTMLElement|null} [options.anchor] 插入位置锚点（菜单插在它**前面**）
 * @returns {object} `el` / `update` / `focusSearch` / `destroy`
 */
export function createCommandMenu(options = {}) {
  const handlers = options.handlers || {}
  const host = options.host || null
  const anchor = options.anchor || null
  const tooltip = createTooltip({ host: host || document.body })

  const call = (name, ...args) => {
    const fn = handlers[name]
    return typeof fn === 'function' ? fn(...args) : undefined
  }

  const commandTip = item => {
    const mac = /Mac|iPhone|iPad/.test(navigator.platform || '')
    const mod = mac ? '⌘' : 'Ctrl', alt = mac ? '⌥' : 'Alt'
    const metadata = {
      code: { shortcut: `${mod} + ${alt} + C`, markdown: '``` 空格 或 ``` 代码语言 空格' },
      divider: { shortcut: `${mod} + ${alt} + S`, markdown: '--- 或 ***' },
      heading1: { markdown: '# 空格' }, heading2: { markdown: '## 空格' }, heading3: { markdown: '### 空格' },
      orderedList: { markdown: '1. 空格' }, bulletList: { markdown: '- 空格 或 * 空格' },
      taskList: { markdown: '[] 空格' }, blockquote: { markdown: '> 空格' },
      inlineMath: { markdown: '$公式$' },
    }
    return { title: item.label, ...(isSkip(item) ? { description: '需要企业版接入' } : metadata[item.id] || {}) }
  }

  // ————————————————— 状态（唯一真相） —————————————————
  const state = {
    open: false,
    kind: '',
    items: [],
    templates: [],
    diagramTypes,
    query: '',
    activeId: '',
    activeIndex: null,
    positionStyle: null,
    submenuOpen: '',
    submenuType: '',
    columnsHover: null,
    tableHover: { rows: 3, cols: 3 },
  }
  let composing = false
  let listening = false
  const viewWindow = (host?.ownerDocument || document).defaultView
  let disposed = false
  let mobileSearchOpen = false
  /** 分段签名：段名 + 每段项 id 顺序。变了才重排段容器。 */
  let sectionSignature = ''
  /** 子菜单节点（开时才存在）；`submenuType` 决定内容分支。 */
  let submenuEl = null
  let submenuTrigger = null
  let submenuSignature = '', submenuSource = null
  const activeItem = () => Number.isInteger(state.activeIndex) ? state.items[state.activeIndex] : state.items.find(item => item.id === state.activeId)
  const submenuData = () => state.submenuType === 'templates' ? state.templates : state.submenuType === 'diagram' ? state.diagramTypes : null
  const submenuDataSignature = () => JSON.stringify((submenuData() || state.items.filter(item => item.submenu === state.submenuOpen)).map(item => [item.id, item.label, item.title, item.description, item.unavailable, item.tier]))

  // ————————————————— 根节点 —————————————————

  const el = document.createElement('div')
  el.className = 'lark-doc-command-menu'
  el.setAttribute('role', 'menu')
  el.setAttribute('aria-label', '插入内容')
  const activeTarget = target => !disposed && state.open && el.isConnected && target?.isConnected && el.contains(target)
  el.addEventListener('mouseenter', () => call('onMenuEnter'))
  el.addEventListener('mouseleave', () => call('onMenuLeave'))
  el.addEventListener('keydown', onKeydown)

  // ————————————————— 头部（`<strong>` + 搜索框） —————————————————

  const head = document.createElement('div')
  head.className = 'lark-doc-command-head'
  const headTitle = document.createElement('strong')
  headTitle.textContent = '插入内容'
  const input = document.createElement('input')
  input.setAttribute('aria-label', '搜索插入内容')
  input.setAttribute('placeholder', '搜索命令 / 拼音')
  input.addEventListener('input', (event) => call('onQuery', event.target.value))
  // IME 组字期间 ↑↓/Enter 是候选词操作，不能当成菜单导航（SFC 同款闸门）。
  input.addEventListener('compositionstart', () => { composing = true })
  input.addEventListener('compositionend', () => { composing = false })
  head.appendChild(headTitle)
  head.appendChild(input)
  const searchButton = document.createElement('button')
  searchButton.type = 'button'
  searchButton.className = 'lark-doc-command-search-toggle'
  searchButton.setAttribute('aria-label', '搜索命令')
  searchButton.appendChild(iconNode('search', 20))
  searchButton.addEventListener('click', () => {
    if (!state.open) return
    mobileSearchOpen = !mobileSearchOpen
    renderRoot()
    if (mobileSearchOpen) input.focus()
    else closeButton.focus({ preventScroll: true })
  })
  const closeButton = document.createElement('button')
  closeButton.type = 'button'
  closeButton.className = 'lark-doc-command-close'
  closeButton.setAttribute('aria-label', '关闭插入面板')
  closeButton.textContent = '×'
  closeButton.addEventListener('click', () => call('onClose'))
  const backdrop = document.createElement('div')
  backdrop.className = 'lark-doc-command-backdrop'
  backdrop.setAttribute('aria-hidden', 'true')
  backdrop.addEventListener('mousedown', event => event.preventDefault())
  backdrop.addEventListener('click', () => call('onClose'))

  // ————————————————— 空态 / 底部提示 —————————————————

  const emptyEl = document.createElement('div')
  emptyEl.className = 'lark-doc-command-empty'
  emptyEl.textContent = '没有匹配的命令'

  const hintEl = document.createElement('p')
  hintEl.className = 'lark-doc-command-hint'
  hintEl.textContent = '↑ ↓ 选择 · Enter 插入 · Esc 关闭'

  // ————————————————— 命令按钮（按 id 缓存复用） —————————————————

  /** id → { node, item, icon, label, arrow } */
  const entries = new Map()
  /** 段名 → 段节点（只有签名变化时才重建）。 */
  const sectionNodes = new Map()

  const isSkip = (item) => item.tier === 'skip'
  const entryKey = item => `${item.sourceCategory ?? item.category}:${item.id}`

  function syncEntry(entry, item) {
    entry.item = item
    const { node, icon, label } = entry
    node.classList.toggle('is-skip', isSkip(item))
    const active = activeItem()
    node.classList.toggle('active', active && entryKey(active) === entryKey(item) && !isSkip(item))
    node.disabled = isSkip(item)
    // 0facf05:107 口径——skip 项提示统一为「需要企业版接入」，不读 item.reason；
    // aria-label 仍是命令自己的名字（每个 skip 项都叫「需要企业版接入」的话，
    // 读屏器就分不出是哪一条了），原因只走浮层提示。
    const tip = isSkip(item) ? '需要企业版接入' : item.label
    setAttr(node, 'title', null)
    setAttr(node, 'data-tooltip-title', tip)
    setAttr(node, 'aria-label', item.label)
    setAttr(node, 'aria-disabled', isSkip(item) ? 'true' : null)
    setAttr(node, 'data-tier', item.tier || null)
    setAttr(node, 'aria-haspopup', item.submenu ? 'menu' : null)
    setAttr(node, 'aria-expanded', item.submenu ? String(state.submenuOpen === item.submenu) : null)

    const glyph = item.glyph || '·'
    const iconName = ((state.kind === 'slash' || state.kind === 'plus' && item.category === '基础') && BASIC_ICONS[item.id]) || SEMANTIC_COMMAND_ICONS[item.id]
    const sourceIcon = MENU_ICON_MARKUP[item.id]
    if (item.mobileIcon) setIcon(icon, item.mobileIcon, 48)
    else if (sourceIcon) {
      icon.style.width = icon.style.height = state.kind === 'plus' && item.category === '基础' ? '20px' : '18px'
      if (icon.innerHTML !== sourceIcon) icon.innerHTML = sourceIcon
    }
    else if (iconName) setIcon(icon, iconName, state.kind === 'plus' && item.category === '基础' ? 20 : 18)
    else if (icon.textContent !== glyph || icon.querySelector('svg')) { icon.textContent = glyph; icon.removeAttribute('style') }
    const tone = `lark-doc-command-icon is-${item.tone || 'blue'}`
    if (icon.className !== tone) icon.className = tone
    if (label.textContent !== item.label) label.textContent = item.label

    // `›` 箭头只在有子菜单的项上出现；命令表是静态的，这里只做「齐备性」保证。
    if (item.submenu) {
      if (!entry.arrow) {
        const arrow = document.createElement('span')
        arrow.className = 'lark-doc-command-submenu-arrow'
        arrow.setAttribute('role', 'button')
        arrow.setAttribute('tabindex', '0')
        arrow.setAttribute('aria-label', `打开${item.submenu}子菜单`)
        arrow.appendChild(iconNode('link-view-caret', 14, 'lark-doc-command-submenu-arrow-icon'))
        arrow.addEventListener('click', (event) => { if (!activeTarget(arrow)) return; event.stopPropagation(); event.preventDefault(); openSubmenu(entry.item, node) })
        arrow.addEventListener('keydown', (event) => {
          if (!activeTarget(arrow)) return
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.stopPropagation()
          event.preventDefault()
          openSubmenu(entry.item, node)
        })
        node.appendChild(arrow)
        entry.arrow = arrow
      }
      setAttr(entry.arrow, 'aria-label', `打开${item.submenu}子菜单`)
      entry.arrow.classList.toggle('is-open', state.submenuOpen === item.submenu)
    } else if (entry.arrow) {
      node.removeChild(entry.arrow)
      entry.arrow = null
    }
  }

  function buttonFor(item) {
    const key = entryKey(item)
    let entry = entries.get(key)
    if (!entry) {
      const node = document.createElement('button')
      node.type = 'button'
      node.setAttribute('role', 'menuitem')
      node.dataset.commandId = item.id
      node.dataset.entryKey = key
      // `@mousedown.prevent`：不挡的话按下会先抢焦点、菜单当场关掉。
      node.addEventListener('mousedown', (event) => event.preventDefault())
      const activate = () => {
        if (!activeTarget(node)) return
        if (activeItem() === entry.item && (!entry.item.submenu || submenuTrigger === node)) return
        const index = state.items.findIndex(item => entryKey(item) === node.dataset.entryKey)
        if (index >= 0 && index !== state.activeIndex) call('onActivate', index)
        if (entry.item.submenu) openSubmenu(entry.item, node)
        else closeSubmenu()
      }
      const activateFromPointer = event => {
        if (event.sourceCapabilities?.firesTouchEvents || node.ownerDocument.defaultView?.matchMedia?.('(hover: none)')?.matches) return
        activate()
      }
      node.addEventListener('mouseenter', event => { if (state.kind !== 'slash') activateFromPointer(event) })
      // 移动鼠标才改变斜杠菜单高亮，菜单重新定位时保留键盘选择。
      node.addEventListener('mousemove', event => { if (state.kind === 'slash') activateFromPointer(event) })
      node.addEventListener('focus', activate)
      node.addEventListener('click', () => {
        if (!activeTarget(node)) return
        const current = entry.item
        // plus 菜单里带子菜单的项一律先展子菜单；斜杠菜单对 分栏/模板/图表 展开，表格直接落 3×3。
        if (current.submenu && (state.kind === 'plus' || ['columns', 'templates', 'diagram'].includes(current.submenuType))) openSubmenu(current, node)
        else call('onChoose', current)
      })
      const icon = document.createElement('span')
      icon.className = 'lark-doc-command-icon'
      icon.setAttribute('aria-hidden', 'true')
      const label = document.createElement('span')
      label.className = 'lark-doc-command-label'
      node.appendChild(icon)
      node.appendChild(label)
      entry = { node, item, icon, label, arrow: null }
      tooltip.bind(node, () => state.kind === 'plus' && entry.item.category === '基础' ? commandTip(entry.item) : null)
      entries.set(key, entry)
    }
    syncEntry(entry, item)
    return entry.node
  }

  /** 分类顺序：plus 前置三段，其余按首次出现；斜杠完全按首次出现。 */
  function categoriesOf(items) {
    const seen = []
    items.forEach((item) => { if (seen.indexOf(item.category) === -1) seen.push(item.category) })
    if (state.kind !== 'plus') return seen
    const first = el.ownerDocument.defaultView?.matchMedia?.('(max-width: 760px) and (pointer: coarse)')?.matches ? ['基础', '常用', '其他标题'] : PLUS_CATEGORIES
    return first.filter(category => seen.includes(category)).concat(seen.filter(category => !first.includes(category)))
  }

  /** 段容器按签名重建；按钮本体复用（见文件头第 2 条）。 */
  function sectionList(items, touch) {
    const categories = categoriesOf(items)
    const signature = `${touch ? 'touch' : 'default'}|` + categories.map((category) => `${category}:${items.filter((item) => item.category === category).map((item) => item.id).join(',')}`).join('|')
    if (signature === sectionSignature) return categories.map((category) => sectionNodes.get(category))
    sectionSignature = signature
    sectionNodes.clear()
    return categories.map((category) => {
      const section = document.createElement('div')
      section.className = 'lark-doc-command-section'
      section.dataset.category = category
      const small = document.createElement('small')
      small.textContent = category
      section.appendChild(small)
      const categoryItems = items.filter((item) => item.category === category)
      if (touch && category === '基础') {
        for (const [label, isHeading] of [['标题快捷项', true], ['列表与块快捷项', false]]) {
          const row = document.createElement('div')
          row.className = 'lark-doc-command-basic-row'
          row.setAttribute('role', 'group')
          row.setAttribute('aria-label', label)
          categoryItems.filter((item) => /^heading[1-9]$/.test(item.id) === isHeading).forEach((item) => row.appendChild(buttonFor(item)))
          section.appendChild(row)
        }
      } else categoryItems.forEach((item) => section.appendChild(buttonFor(item)))
      sectionNodes.set(category, section)
      return section
    })
  }

  // ————————————————— 三分支子菜单 —————————————————

  function makePickerHead(text) {
    const node = document.createElement('div')
    node.className = 'lark-doc-submenu-picker-head'
    const label = document.createElement('span')
    label.textContent = text
    node.appendChild(label)
    return node
  }

  function buildColumnsSubmenu() {
    const headNode = makePickerHead('选择栏数')
    const picker = document.createElement('div')
    picker.className = 'lark-doc-columns-picker'
    picker.setAttribute('role', 'group')
    picker.setAttribute('aria-label', '选择栏数')
    picker.addEventListener('mouseleave', () => setColumnsHover(null))

    const preview = document.createElement('div')
    preview.className = 'lark-doc-columns-preview'
    preview.setAttribute('aria-hidden', 'true')
    const bars = []
    for (let index = 0; index < 5; index += 1) {
      const bar = document.createElement('span')
      preview.appendChild(bar)
      bars.push(bar)
    }
    picker.appendChild(preview)

    const choices = []
    ;[2, 3, 4, 5].forEach((count, index) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.setAttribute('role', 'menuitem')
      button.setAttribute('aria-label', `${count}栏`)
      button.className = 'lark-doc-columns-choice'
      // 与 SFC 的 `columnsChoiceStyle` 同一条算式：首项占 40%，其余各 20% 顺排。
      applyStyle(button, { left: `${index === 0 ? 0 : 40 + ((index - 1) * 20)}%`, width: `${index === 0 ? 40 : 20}%` })
      for (let cell = 0; cell < count; cell += 1) button.appendChild(document.createElement('span'))
      button.addEventListener('mouseenter', () => setColumnsHover(count))
      button.addEventListener('focus', () => setColumnsHover(count))
      button.addEventListener('mousedown', (event) => event.preventDefault())
      button.addEventListener('click', () => { if (activeTarget(button)) call('onChoose', { id: `columns${count}` }) })
      picker.appendChild(button)
      choices.push({ count, node: button })
    })

    submenuEl.appendChild(headNode)
    submenuEl.appendChild(picker)
    return { headNode, bars, choices }
  }

  function buildTableSubmenu() {
    const headNode = makePickerHead('插入支持富文本的表格')
    const output = document.createElement('output')
    output.setAttribute('aria-live', 'polite')
    headNode.appendChild(output)
    const grid = document.createElement('div')
    grid.className = 'lark-doc-table-submenu-grid'
    grid.setAttribute('role', 'group')
    grid.setAttribute('aria-label', '选择表格行列')
    const cells = []
    for (let row = 1; row <= 9; row += 1) {
      for (let col = 1; col <= 9; col += 1) {
        const button = document.createElement('button')
        button.type = 'button'
        button.setAttribute('role', 'menuitem')
        button.setAttribute('aria-label', `${row}行${col}列`)
        button.dataset.row = row
        button.dataset.col = col
        const preview = () => { state.tableHover = { rows: row, cols: col }; syncSubmenuLive() }
        button.addEventListener('mouseenter', preview)
        button.addEventListener('focus', preview)
        button.addEventListener('mousedown', event => event.preventDefault())
        button.addEventListener('click', () => { if (activeTarget(button)) call('onChoose', { id: 'table', tableSize: { rows: row, cols: col } }) })
        button.addEventListener('keydown', event => {
          const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -9, ArrowDown: 9 }[event.key]
          if (!delta) return
          event.preventDefault(); event.stopPropagation()
          cells[Math.max(0, Math.min(80, (row - 1) * 9 + col - 1 + delta))].node.focus()
        })
        cells.push({ row, col, node: button })
        grid.appendChild(button)
      }
    }
    grid.addEventListener('mouseleave', () => { state.tableHover = null; syncSubmenuLive() })
    submenuEl.appendChild(headNode)
    submenuEl.appendChild(grid)
    return { output, cells }
  }

  function buildTemplatesSubmenu() {
    // 0facf05 口径：无标题行、无装饰图标，条目只有纯文字 label。
    if (!state.templates.length) {
      const empty = document.createElement('div')
      empty.className = 'lark-doc-command-empty'
      empty.textContent = '暂无可用模板'
      submenuEl.appendChild(empty)
      return {}
    }
    state.templates.forEach((template) => {
      const node = document.createElement('button')
      node.type = 'button'
      node.setAttribute('role', 'menuitem')
      node.setAttribute('aria-label', template.label || template.title || template.id)
      node.addEventListener('mousedown', (event) => event.preventDefault())
      node.addEventListener('click', () => { if (activeTarget(node)) call('onChoose', { id: 'template', templateId: template.id }) })
      const label = document.createElement('span')
      label.className = 'lark-doc-command-label'
      const main = document.createElement('span')
      main.textContent = template.label || template.title || template.id
      label.appendChild(main)
      node.appendChild(label)
      submenuEl.appendChild(node)
    })
    const more = document.createElement('button'), owner = submenuEl
    more.type = 'button'; more.className = 'lark-doc-template-more'; more.setAttribute('role', 'menuitem'); more.textContent = '更多模板'
    more.addEventListener('mousedown', event => event.preventDefault())
    more.addEventListener('click', () => {
      if (activeTarget(more) && owner === submenuEl && owner.contains(more)) call('onChoose', { id: 'template', templateLibrary: true })
    })
    submenuEl.appendChild(more)
    return {}
  }

  function buildDiagramSubmenu() {
    const title = document.createElement('strong')
    title.textContent = '选择图表类型'
    submenuEl.appendChild(title)
    state.diagramTypes.forEach((item) => {
      const node = document.createElement('button')
      node.type = 'button'
      node.setAttribute('role', 'menuitem')
      node.setAttribute('aria-label', item.label)
      node.addEventListener('mousedown', (event) => event.preventDefault())
      node.addEventListener('click', () => {
        if (!activeTarget(node)) return
        if (typeof handlers.onChooseDiagram === 'function') call('onChooseDiagram', item.id)
        else call('onChoose', { id: 'diagram', diagramType: item.id })
      })
      const icon = diagramIconNode(item.id, 18, 'lark-doc-command-icon is-teal')
      icon.setAttribute('aria-hidden', 'true')
      const label = document.createElement('span')
      label.className = 'lark-doc-command-label'
      label.textContent = item.label
      node.appendChild(icon)
      node.appendChild(label)
      submenuEl.appendChild(node)
    })
    return {}
  }

  function buildCommandsSubmenu() {
    const title = document.createElement('strong')
    title.textContent = state.submenuOpen
    submenuEl.appendChild(title)
    state.items.filter((item) => item.submenu === state.submenuOpen).forEach((item) => {
      const node = document.createElement('button')
      node.type = 'button'
      node.setAttribute('role', 'menuitem')
      node.setAttribute('aria-label', item.label)
      node.addEventListener('mousedown', (event) => event.preventDefault())
      node.addEventListener('click', () => { if (activeTarget(node)) call('onChoose', item) })
      const icon = document.createElement('span')
      icon.className = 'lark-doc-command-icon'
      icon.setAttribute('aria-hidden', 'true')
      icon.textContent = item.glyph || '·'
      node.appendChild(icon)
      node.appendChild(document.createTextNode(item.label))
      submenuEl.appendChild(node)
    })
    return {}
  }

  /** 子菜单内部随 hover 变的部分（output 文案 + 高亮格）。 */
  let submenuLive = {}

  function syncSubmenuLive() {
    if (!submenuEl) return
    if (state.submenuType === 'table') {
      const hover = state.tableHover
      submenuLive.output.textContent = hover ? `${hover.cols} x ${hover.rows}` : ''
      submenuLive.cells.forEach(cell => cell.node.classList.toggle('is-preview', !!hover && cell.row <= hover.rows && cell.col <= hover.cols))
      return
    }
    if (state.submenuType === 'columns') {
      const { headNode, bars, choices } = submenuLive
      const hover = state.columnsHover
      // `v-if="columnsHover"`：没有悬停值时 `<output>` 根本不在 DOM 里。
      const existing = headNode.querySelector('output')
      if (hover) {
        const output = existing || document.createElement('output')
        if (String(output.textContent) !== String(hover)) output.textContent = String(hover)
        if (!existing) headNode.appendChild(output)
      } else if (existing) headNode.removeChild(existing)
      bars.forEach((bar, index) => bar.classList.toggle('is-primary', index + 1 <= (hover || 1)))
      choices.forEach((choice) => choice.node.classList.toggle('is-preview', choice.count === hover))
      return
    }

  }

  function setColumnsHover(value) {
    if (state.columnsHover === value) return
    state.columnsHover = value
    syncSubmenuLive()
  }

  /**
   * 展开子菜单：建内容 → 入 DOM → **同步**量位置。
   *
   * 位置算式与 SFC 逐项对齐（`gap 5` / `margin 8` / 宽 250(模板) 或 190 / 估算高度
   * 决定上下翻转），断言在量 `left` 与 `width`，改了就会红。
   */
  function openSubmenu(item, triggerNode) {
    if (!item || !item.submenu) return
    state.submenuOpen = item.submenu
    state.submenuType = item.submenuType || 'commands'
    submenuSource = submenuData()
    submenuSignature = submenuDataSignature()
    if (state.submenuType === 'columns') state.columnsHover = null
    if (state.submenuType === 'table') state.tableHover = null
    submenuTrigger = triggerNode || null

    submenuEl = document.createElement('div')
    submenuEl.className = `lark-doc-command-submenu is-${state.submenuType}`
    submenuEl.setAttribute('role', 'menu')
    submenuEl.setAttribute('aria-label', `${state.submenuOpen}子菜单`)
    submenuEl.addEventListener('mouseenter', () => call('onMenuEnter'))
    submenuEl.addEventListener('mouseleave', () => call('onMenuLeave'))

    if (state.submenuType === 'templates') submenuLive = buildTemplatesSubmenu()
    else if (state.submenuType === 'columns') submenuLive = buildColumnsSubmenu()
    else if (state.submenuType === 'table') submenuLive = buildTableSubmenu()
    else if (state.submenuType === 'diagram') submenuLive = buildDiagramSubmenu()
    else submenuLive = buildCommandsSubmenu()

    renderRoot()
    syncSubmenuLive()
    positionSubmenu()
  }

  function positionSubmenu() {
    if (!submenuEl || !submenuTrigger) return
    const triggerRect = submenuTrigger.getBoundingClientRect()
    if (!triggerRect || (!triggerRect.width && !triggerRect.height)) return
    const win = submenuEl.ownerDocument.defaultView
    const viewport = win.visualViewport
    const x = viewport?.offsetLeft || 0, y = viewport?.offsetTop || 0
    const viewportWidth = viewport?.width || win.innerWidth, viewportHeight = viewport?.height || win.innerHeight
    const maxWidth = Math.max(0, viewportWidth - SUBMENU_MARGIN * 2)
    const maxHeight = Math.max(0, viewportHeight - SUBMENU_MARGIN * 2)
    // 0facf05:457 口径——子菜单固有宽度按类型区分，templates 弹窗需内联宽高（位测量前写入）。
    const fallbackWidth = state.submenuType === 'table' ? 314
      : state.submenuType === 'templates' ? Math.min(250, win.innerWidth - 16)
        : state.submenuType === 'columns' ? 196 : 190
    const options = state.items.filter((item) => item.submenu === state.submenuOpen)
    const estimatedHeight = state.submenuType === 'templates'
      ? 12 + (Math.max(1, state.templates.length) + 1) * 30
      : state.submenuType === 'columns'
        ? 166
        : state.submenuType === 'table'
          ? 304
          : state.submenuType === 'diagram'
            ? Math.min(420, 42 + Math.max(1, state.diagramTypes.length) * 40)
            : Math.min(420, 42 + options.length * 40)
    // 0facf05:473 口径——仅 templates 写内联 width/height/maxHeight，其余类型交给 CSS。
    const size = { maxWidth: `${maxWidth}px`, maxHeight: `${maxHeight}px`, overflowY: 'auto', boxSizing: 'border-box',
      ...(state.submenuType === 'templates'
        ? { width: `${fallbackWidth}px`, height: `${estimatedHeight}px`, maxHeight: `${Math.max(40, viewportHeight - 16)}px` }
        : {}) }
    Object.assign(submenuEl.style, size)
    // Measure the attached, constrained surface, including variable template
    // titles and the More row. Estimates only serve non-layout environments.
    const box = submenuEl.getBoundingClientRect()
    const width = Math.min(box.width || fallbackWidth, maxWidth), height = Math.min(box.height || estimatedHeight, maxHeight)
    const right = triggerRect.right + SUBMENU_GAP
    const left = triggerRect.left - width - SUBMENU_GAP
    const rightEdge = x + viewportWidth - SUBMENU_MARGIN, bottomEdge = y + viewportHeight - SUBMENU_MARGIN
    const leftPosition = Math.max(x + SUBMENU_MARGIN, Math.min(rightEdge - width, right + width <= rightEdge ? right : left))
    const top = Math.max(y + SUBMENU_MARGIN, Math.min(bottomEdge - height, triggerRect.top))
    applyStyle(submenuEl, {
      ...size,
      left: `${leftPosition}px`,
      top: `${top}px`,
    })
  }

  function closeSubmenu() {
    if (!state.submenuOpen) return
    state.submenuOpen = ''
    state.submenuType = ''
    submenuEl = null
    submenuTrigger = null
    submenuSource = null; submenuSignature = ''
    submenuLive = {}
    renderRoot()
  }

  // ————————————————— 渲染 —————————————————

  function renderRoot() {
    const plus = state.kind === 'plus'
    const cls = `lark-doc-command-menu${plus ? ' is-plus' : ''}${state.kind === 'slash' ? ' is-slash' : ''}`
    if (el.className !== cls) el.className = cls
    if (plus && closeButton.parentNode !== head) head.prepend(closeButton)
    else if (!plus) closeButton.remove()
    const touch = el.ownerDocument.defaultView?.matchMedia?.('(max-width: 760px) and (pointer: coarse)')?.matches
    headTitle.textContent = plus && touch ? '添加' : '插入内容'
    const mobile = plus && touch
    input.hidden = !!mobile && !mobileSearchOpen
    if (mobile && searchButton.parentNode !== head) head.appendChild(searchButton)
    else if (!mobile) searchButton.remove()
    setAttr(searchButton, 'aria-expanded', String(mobileSearchOpen))
    applyStyle(el, state.positionStyle)

    // 桌面 plus 列表刻意给 任务/高亮块 两个视觉条目，手机重映射后它们会落进同一行撞成重复，
    // 而源「添加」面板每项只出现一次——按 id 保留首个。
    const items = mobile ? (() => {
      const seen = new Set()
      return state.items.map(item => {
        const basic = MOBILE_BASIC.indexOf(item.id), common = MOBILE_COMMON.indexOf(item.id)
        const category = basic >= 0 ? '基础' : common >= 0 ? '常用' : item.id === 'paragraph' ? '其他标题' : item.category
        return { ...item, sourceCategory: item.category, category, mobileIcon: MOBILE_ICONS[item.id] || (/^heading[1-9]$/.test(item.id) ? `mobile-heading${item.id.slice(-1)}` : null), label: item.id === 'image' ? '图片' : item.id === 'file' ? '文件' : item.label,
          mobileRank: basic >= 0 ? basic : common >= 0 ? common : 100 }
      }).sort((a, b) => a.mobileRank - b.mobileRank).filter((item) => {
        if (seen.has(item.id)) return false
        seen.add(item.id)
        return true
      })
    })() : state.items
    const currentItems = new Map(items.map(item => [entryKey(item), item]))
    const sections = items.length ? sectionList(items, mobile) : []
    const slots = [{ node: head, on: state.kind !== 'slash' }]
    slots.push({ node: emptyEl, on: !state.items.length })
    sections.forEach((node) => slots.push({ node, on: true }))
    if (submenuEl) slots.push({ node: submenuEl, on: true })
    slots.push({ node: hintEl, on: true })
    syncChildren(el, slots)

    // 输入框的值由 state 单向驱动（用户打字时 onQuery 会把它写回来，值是同一个）。
    if (input.value !== state.query) input.value = state.query
    sections.forEach((section) => {
      Array.prototype.forEach.call(section.querySelectorAll('button[data-command-id]'), (node) => {
        const entry = entries.get(node.dataset.entryKey)
        if (entry && currentItems.has(node.dataset.entryKey)) syncEntry(entry, currentItems.get(node.dataset.entryKey))
      })
    })
  }

  // ————————————————— 键盘 —————————————————

  /**
   * 与 SFC 的 `onKeydown` 逐条对齐：只在 **搜索框内** 响应 ↑↓/Enter（Esc 在任何
   * 位置都收），组字期间一律让给输入法。
   */
  function onKeydown(event) {
    if (!activeTarget(event.target)) return
    if (composing || event.isComposing || event.keyCode === 229) {
      event.stopPropagation()
      return
    }
    const key = event.key
    const fromSearch = event.target === input
    if (['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].indexOf(key) === -1) return
    if (!fromSearch && key !== 'Escape') return
    event.preventDefault()
    if (key === 'Escape') {
      event.stopPropagation()
      call('onClose')
      return
    }
    if (key === 'Enter') {
      choose()
      return
    }
    call('onMove', key === 'ArrowDown' ? 1 : -1)
  }

  /** Enter：有子菜单的项先展开（plus / 分栏 / 模板），其余交给 `onChoose`。 */
  function choose() {
    // T086 退役入口：`choose` 是 mixin 键盘路径直调的公开入口，调用方只看 `menuOpen`。
    // 菜单已关、已卸载或已销毁时 `state.items` 仍是上一份，兜底的 `items[0]` 会插错块，
    // 所以这里必须自己核 present 状态（与 click 路径的 `activeTarget` 同一套条件）。
    if (disposed || !state.open || !el.isConnected) return
    const item = activeItem() || state.items[0]
    if (!item) return
    if (item.submenu && (state.kind === 'plus' || ['columns', 'templates', 'diagram'].includes(item.submenuType))) {
      openSubmenu(item, entries.get(entryKey(item))?.node || null)
      return
    }
    call('onChoose', item)
  }

  // ————————————————— 对外 —————————————————

  function onViewportResize(event) {
    if (state.kind === 'plus') call('onViewportResize')
    positionSubmenu(event)
  }

  function mount() {
    if (!host) return
    if (state.kind === 'plus') host.insertBefore(backdrop, el.parentNode === host ? el : anchor && anchor.parentNode === host ? anchor : null)
    else backdrop.remove()
    if (el.parentNode !== host) host.insertBefore(el, anchor && anchor.parentNode === host ? anchor : null)
    if (!listening) {
      listening = true
      viewWindow.addEventListener('resize', onViewportResize)
      viewWindow.addEventListener('scroll', positionSubmenu, true)
      viewWindow.visualViewport?.addEventListener('resize', onViewportResize)
      viewWindow.visualViewport?.addEventListener('scroll', positionSubmenu)
    }
  }

  function unmount() {
    backdrop.remove()
    if (listening) {
      listening = false
      viewWindow.removeEventListener('resize', onViewportResize)
      viewWindow.removeEventListener('scroll', positionSubmenu, true)
      viewWindow.visualViewport?.removeEventListener('resize', onViewportResize)
      viewWindow.visualViewport?.removeEventListener('scroll', positionSubmenu)
    }
    if (el.parentNode) el.parentNode.removeChild(el)
    closeSubmenu()
    tooltip.hide()
  }

  /**
   * 一次推平全部字段。
   *
   * `open` 由调用方算（`menuOpen && !effectiveReadonly`，就是原 `v-if` 的两个条件）。
   * 关闭时子树一并清掉，下次打开是干净的（与 `v-if` 的销毁语义一致）。
   */
  function update(patch) {
    if (disposed) return
    const previous = { open: state.open, kind: state.kind, activeId: state.activeId, activeIndex: state.activeIndex }
    Object.assign(state, patch || {})
    if (!Array.isArray(state.diagramTypes)) state.diagramTypes = []
    if (!state.open) {
      mobileSearchOpen = false
      if (el.parentNode) unmount()
      else { closeSubmenu(); tooltip.hide() }
      return
    }
    if (state.submenuOpen && !state.items.some(item => item.submenu === state.submenuOpen && (item.submenuType || 'commands') === state.submenuType)) closeSubmenu()
    if (previous.kind !== state.kind) {
      mobileSearchOpen = false
      // 换入口（斜杠 ↔ plus）时分段表完全不同，缓冲的段节点与签名必须清掉。
      sectionSignature = ''
      sectionNodes.clear()
      closeSubmenu()
    }
    if (state.submenuOpen && !state.items.some(item => item.submenu === state.submenuOpen && (item.submenuType || 'commands') === state.submenuType && entryKey(item) === submenuTrigger?.dataset.entryKey && !isSkip(item))) closeSubmenu()
    if (state.submenuOpen && (submenuSource !== submenuData() || submenuSignature !== submenuDataSignature())) closeSubmenu()
    if (state.submenuOpen && (previous.activeId !== state.activeId || previous.activeIndex !== state.activeIndex)) {
      const active = activeItem()
      if (!active || entryKey(active) !== submenuTrigger?.dataset.entryKey) closeSubmenu()
    }
    mount()
    renderRoot()
  }

  return {
    el,
    update,
    choose,
    showSubmenu(id) {
      const item = activeItem()?.id === id ? activeItem() : null
      if (state.open && item?.submenu) openSubmenu(item, entries.get(entryKey(item))?.node || null)
    },
    focusClose() { closeButton.focus({ preventScroll: true }) },
    focusSearch() { mobileSearchOpen = true; renderRoot(); if (input && typeof input.focus === 'function') input.focus() },
    get submenuEl() { return submenuEl },
    destroy() {
      if (disposed) return
      disposed = true
      state.open = false
      backdrop.remove()
      tooltip.destroy()
      if (el.parentNode) el.parentNode.removeChild(el)
      entries.clear()
      sectionNodes.clear()
    },
  }
}
