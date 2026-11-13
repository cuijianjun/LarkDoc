/** Native slash and plus menus. The plus layout and 9x9 picker follow the
 * observed Feishu UI; command buttons are retained across state updates so
 * pointer hover and focus survive transactions and filtering.
 */

import { applyStyle, setAttr, syncChildren } from './dom'
import { diagramIconNode, iconNode, setIcon } from './icon'

/** plus 菜单的前置分段；其余段按命令表里首次出现的顺序追加。 */
const PLUS_CATEGORIES = ['基础', '常用', '绘图']
const BASIC_ICONS = { heading1: 'block-h1', heading2: 'block-h2', heading3: 'block-h3', orderedList: 'block-ordered', bulletList: 'block-bullet', taskList: 'block-task', code: 'block-code', blockquote: 'block-quote', callout: 'block-callout', divider: 'horizontal-rule', link: 'link' }
const SEMANTIC_COMMAND_ICONS = { taskList: 'block-task', callout: 'block-callout', columns: 'block-columns', columns2: 'block-columns', columns3: 'block-columns', columns4: 'block-columns', columns5: 'block-columns', table: 'block-table', image: 'block-image', template: 'block-template', diagram: 'block-diagram' }
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

  const call = (name, ...args) => {
    const fn = handlers[name]
    return typeof fn === 'function' ? fn(...args) : undefined
  }

  // ————————————————— 状态（唯一真相） —————————————————
  const state = {
    open: false,
    kind: '',
    items: [],
    templates: [],
    diagramTypes: [],
    query: '',
    activeId: '',
    positionStyle: null,
    submenuOpen: '',
    submenuType: '',
    columnsHover: null,
    tableHover: null,
  }
  let composing = false
  /** 分段签名：段名 + 每段项 id 顺序。变了才重排段容器。 */
  let sectionSignature = ''
  /** 子菜单节点（开时才存在）；`submenuType` 决定内容分支。 */
  let submenuEl = null
  let submenuTrigger = null

  // ————————————————— 根节点 —————————————————

  const el = document.createElement('div')
  el.className = 'lark-doc-command-menu'
  el.setAttribute('role', 'menu')
  el.setAttribute('aria-label', '插入内容')
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

  function syncEntry(entry, item) {
    entry.item = item
    const { node, icon, label } = entry
    node.classList.toggle('is-skip', isSkip(item))
    node.classList.toggle('active', item.id === state.activeId && !isSkip(item))
    node.disabled = isSkip(item)
    // skip 项：`title` 换成统一说明，`aria-disabled` 才出现（SFC 里是三元表达式）。
    setAttr(node, 'title', isSkip(item) ? '需要企业版接入' : item.label)
    setAttr(node, 'aria-label', item.label)
    setAttr(node, 'aria-disabled', isSkip(item) ? 'true' : null)
    setAttr(node, 'data-tier', item.tier || null)
    setAttr(node, 'aria-haspopup', item.submenu ? 'menu' : null)
    setAttr(node, 'aria-expanded', item.submenu ? String(state.submenuOpen === item.submenu) : null)

    const glyph = item.glyph || '·'
    const iconName = ((state.kind === 'slash' || state.kind === 'plus' && item.category === '基础') && BASIC_ICONS[item.id]) || SEMANTIC_COMMAND_ICONS[item.id]
    if (iconName) setIcon(icon, iconName, state.kind === 'plus' && item.category === '基础' ? 20 : 18)
    else if (icon.textContent !== glyph || icon.querySelector('svg')) { icon.textContent = glyph; icon.removeAttribute('style') }
    const tone = `lark-doc-command-icon is-${item.tone || 'blue'}`
    if (icon.className !== tone) icon.className = tone
    if (label.textContent !== item.label) label.textContent = item.label
    // The omitted sync-block command has no implementation in master. Keep the
    // source divider/link slots without exposing an empty or fake command.
    node.style.gridColumn = state.kind === 'plus' && item.category === '基础' && item.id === 'divider' ? '5' : ''

    // `›` 箭头只在有子菜单的项上出现；命令表是静态的，这里只做「齐备性」保证。
    if (item.submenu) {
      if (!entry.arrow) {
        const arrow = document.createElement('span')
        arrow.className = 'lark-doc-command-submenu-arrow'
        arrow.setAttribute('role', 'button')
        arrow.setAttribute('tabindex', '0')
        arrow.setAttribute('aria-label', `打开${item.submenu}子菜单`)
        arrow.appendChild(iconNode('link-view-caret', 14, 'lark-doc-command-submenu-arrow-icon'))
        arrow.addEventListener('click', (event) => { event.stopPropagation(); event.preventDefault(); openSubmenu(entry.item, node) })
        arrow.addEventListener('keydown', (event) => {
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
    const key = `${item.category}:${item.id}`
    let entry = entries.get(key)
    if (!entry) {
      const node = document.createElement('button')
      node.type = 'button'
      node.setAttribute('role', 'menuitem')
      node.dataset.commandId = item.id
      node.dataset.entryKey = key
      // `@mousedown.prevent`：不挡的话按下会先抢焦点、菜单当场关掉。
      node.addEventListener('mousedown', (event) => event.preventDefault())
      node.addEventListener('mouseenter', () => { if (entry.item.submenu) openSubmenu(entry.item, node) })
      node.addEventListener('focus', () => { if (entry.item.submenu) openSubmenu(entry.item, node) })
      node.addEventListener('click', () => {
        const current = entry.item
        // plus 菜单里带子菜单的项一律先展子菜单；斜杠菜单对 分栏/模板/图表 展开，表格直接落 2×3。
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
    return PLUS_CATEGORIES.filter(category => seen.includes(category)).concat(seen.filter((category) => PLUS_CATEGORIES.indexOf(category) === -1))
  }

  /** 段容器按签名重建；按钮本体复用（见文件头第 2 条）。 */
  function sectionList() {
    const categories = categoriesOf(state.items)
    const signature = categories.map((category) => `${category}:${state.items.filter((item) => item.category === category).map((item) => item.id).join(',')}`).join('|')
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
      state.items.filter((item) => item.category === category).forEach((item) => section.appendChild(buttonFor(item)))
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
      button.addEventListener('click', () => call('onChoose', { id: `columns${count}` }))
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
        button.addEventListener('click', () => call('onChoose', { id: 'table', tableSize: { rows: row, cols: col } }))
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
    if (!state.templates.length) {
      const empty = document.createElement('div')
      empty.className = 'lark-doc-command-empty'
      empty.textContent = '暂无可用模板'
      submenuEl.appendChild(empty)
    }
    state.templates.forEach((template) => {
      const node = document.createElement('button')
      node.type = 'button'
      node.setAttribute('role', 'menuitem')
      node.setAttribute('aria-label', template.label || template.title || template.id)
      node.disabled = typeof template.html !== 'string'
      node.setAttribute('aria-disabled', String(node.disabled))
      if (template.unavailable) node.title = template.unavailable
      node.addEventListener('mousedown', (event) => event.preventDefault())
      node.addEventListener('click', () => call('onChoose', { id: 'template', templateId: template.id }))
      const label = document.createElement('span')
      label.className = 'lark-doc-command-label'
      const main = document.createElement('span')
      main.textContent = template.label || template.title || template.id
      label.appendChild(main)
      node.appendChild(label)
      submenuEl.appendChild(node)
    })
    const more = document.createElement('button')
    more.type = 'button'
    more.setAttribute('role', 'menuitem')
    more.textContent = '更多模板'
    more.addEventListener('mousedown', event => event.preventDefault())
    more.addEventListener('click', () => call('onChoose', { id: 'template', templateLibrary: true }))
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
      node.addEventListener('click', () => call('onChooseDiagram', item.id))
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
      node.addEventListener('click', () => call('onChoose', item))
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
   * 位置算式与 SFC 逐项对齐（`gap 5` / `margin 8` / 宽 358(模板) 或 190 / 估算高度
   * 决定上下翻转），断言在量 `left` 与 `width`，改了就会红。
   */
  function openSubmenu(item, triggerNode) {
    if (!item || !item.submenu) return
    if (state.submenuOpen === item.submenu && submenuTrigger === triggerNode) return
    state.submenuOpen = item.submenu
    state.submenuType = item.submenuType || 'commands'
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
    const width = state.submenuType === 'table' ? 314 : state.submenuType === 'templates' ? Math.min(358, window.innerWidth - 16) : state.submenuType === 'columns' ? 196 : 190
    const options = state.items.filter((item) => item.submenu === state.submenuOpen)
    const estimatedHeight = state.submenuType === 'templates'
      ? 5 + (Math.max(1, state.templates.length) + 1) * 32
      : state.submenuType === 'table' ? 348 : state.submenuType === 'columns'
        ? 166
        : state.submenuType === 'diagram'
            ? Math.min(420, 42 + Math.max(1, state.diagramTypes.length) * 40)
            : Math.min(420, 42 + options.length * 40)
    const right = triggerRect.right + SUBMENU_GAP
    const left = triggerRect.left - width - SUBMENU_GAP
    const leftPosition = right + width + SUBMENU_MARGIN <= window.innerWidth ? right : Math.max(SUBMENU_MARGIN, left)
    const top = Math.max(SUBMENU_MARGIN, Math.min(window.innerHeight - estimatedHeight - SUBMENU_MARGIN, triggerRect.top))
    applyStyle(submenuEl, {
      left: `${Math.round(leftPosition)}px`,
      top: `${Math.round(top)}px`,
      ...(state.submenuType === 'templates' ? { width: `${width}px`, height: `${estimatedHeight}px`, maxHeight: `${Math.max(40, window.innerHeight - 16)}px` } : {}),
    })
  }

  function closeSubmenu() {
    if (!state.submenuOpen) return
    state.submenuOpen = ''
    state.submenuType = ''
    submenuEl = null
    submenuTrigger = null
    submenuLive = {}
    renderRoot()
  }

  // ————————————————— 渲染 —————————————————

  function renderRoot() {
    const plus = state.kind === 'plus'
    const cls = `lark-doc-command-menu${plus ? ' is-plus' : ''}${state.kind === 'slash' ? ' is-slash' : ''}`
    if (el.className !== cls) el.className = cls
    applyStyle(el, state.positionStyle)

    const sections = state.items.length ? sectionList() : []
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
        if (entry) syncEntry(entry, entry.item)
      })
    })
  }

  // ————————————————— 键盘 —————————————————

  /**
   * 与 SFC 的 `onKeydown` 逐条对齐：只在 **搜索框内** 响应 ↑↓/Enter（Esc 在任何
   * 位置都收），组字期间一律让给输入法。
   */
  function onKeydown(event) {
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
    const item = state.items.find((entry) => entry.id === state.activeId) || state.items[0]
    if (!item) return
    if (item.submenu && (state.kind === 'plus' || ['columns', 'templates', 'diagram'].includes(item.submenuType))) {
      openSubmenu(item, entries.get(`${item.category}:${item.id}`)?.node || null)
      return
    }
    call('onChoose', item)
  }

  // ————————————————— 对外 —————————————————

  function mount() {
    if (!host) return
    if (el.parentNode !== host) host.insertBefore(el, anchor && anchor.parentNode === host ? anchor : null)
  }

  function unmount() {
    if (el.parentNode) el.parentNode.removeChild(el)
    closeSubmenu()
  }

  /**
   * 一次推平全部字段。
   *
   * `open` 由调用方算（`menuOpen && !effectiveReadonly`，就是原 `v-if` 的两个条件）。
   * 关闭时子树一并清掉，下次打开是干净的（与 `v-if` 的销毁语义一致）。
   */
  function update(patch) {
    const previous = { open: state.open, kind: state.kind }
    Object.assign(state, patch || {})
    if (!Array.isArray(state.diagramTypes)) state.diagramTypes = []
    if (!state.open) {
      if (el.parentNode) unmount()
      else closeSubmenu()
      return
    }
    if (previous.kind !== state.kind) {
      // 换入口（斜杠 ↔ plus）时分段表完全不同，缓冲的段节点与签名必须清掉。
      sectionSignature = ''
      sectionNodes.clear()
      closeSubmenu()
    }
    if (state.submenuOpen && !state.items.some(item => item.submenu === state.submenuOpen && item.submenuType === state.submenuType && !isSkip(item))) closeSubmenu()
    mount()
    renderRoot()
  }

  return {
    el,
    update,
    choose,
    focusSearch() { if (input && typeof input.focus === 'function') input.focus() },
    get submenuEl() { return submenuEl },
    destroy() {
      if (el.parentNode) el.parentNode.removeChild(el)
      entries.clear()
      sectionNodes.clear()
    },
  }
}
