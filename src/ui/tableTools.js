/**
 * 飞书式统一浮动工具条（v11）+ 表格边界操作条 —— 原生 DOM 版（`src/ui/` 积木）。
 *
 * ⚠️ v11（用户实测口径，2026-11-09）：**全页面唯一浮窗节点** `.lark-doc-table-tools`，
 *    以飞书浮窗 1:1 为准，不再自己创造功能。四条硬口径：
 *      1. 图标 / 下拉箭头与顶部功能栏**同一套**：`icons.js` + `iconNode()` 渲染 16×16
 *         currentColor SVG，箭头是 `iconNode('chevronDown', 12, 'lark-doc-caret')`；
 *         下拉交互同 `toolbarMenusMixin`：hover/focus 打开、离开 150ms 延迟关、
 *         进入弹层取消关、click 切换、Escape / 点外部关闭。
 *      2. 暂不具备的能力（转换为子文档 / 收录到词典 / 保存为模板 / 网页搜索）直接从
 *         「更多」里去掉，不再用 localStorage / window.open 造假效果。
 *      3. 飞书功能栏**没有「表格操作」按钮** —— 删除 v10 自造的 `table-ops`。
 *         表格结构能力本来就有各自的真源入口：边界 ＋ 增删行列、块句柄菜单标题行 /
 *         标题列 / 均分列宽、`table-header` / `merge-cell` / `cell-bg` / `align` 下拉、
 *         末尾「删除」与 Delete 键。
 *      4. 项数按真源实测：表格内选中文字 **13 项**，点整行/整列选择条 **15 项**（同一条
 *         浮窗节点，按上下文用 `syncChildren` 真摘除/插入，不是两套 mode、不是两个 DOM）。
 *         v12 用户口径再裁两处：最左侧「问问豆包」暂不提供 → **12 / 14 项**；
 *         「复制选区链接」只保留尾部 `share-link` 一颗按钮，删掉「更多」里重复的
 *         `copyAnchorLink` 菜单项（飞书真源尾部是 more▾ / shareTextLink，不是两个入口）。
 *         ⚠️ v12c 用户实测口径：「复制选区链接」与「评论」两颗按钮在当前实现里**没有
 *         真实功能**（前者只把 `#pos=` 假链接写进剪贴板且无 hash 解析/选区还原、
 *         无宿主接线；后者在无评论 Provider 时只落一个本地 comment mark，没有评论面板
 *         /输入框/线程 UI），按「如果没有实现，可以先取消显示」从三态清单里全部摘除 →
 *         **文字态 10 项 / 整行整列 13 项 / 拖选多格 11 项**，尾部统一收在 `more▾`。
 *         文字态：转换为▾ 对齐▾ | B S I U 链接 </> 高亮▾ | 更多▾。
 *         选择条态：标题行列 合并 背景 | 转换为▾ 对齐▾ | B S I U </> 高亮▾ | 更多▾ 删除。
 *         多格拖选态：合并 背景 | 转换为▾ 对齐▾ | B S I U </> 高亮▾ | 更多▾。
 *         两颗按钮的命令分发分支一并删除（v11 口径：不展示的能力不留假分支），
 *         `commentsMixin` 的评论 Provider 链路保留给真正接了后端的宿主，不受影响。
 *
 * 结构即契约（`scripts/verify-browser-table-tools.js` / `selftest-table-interaction.cjs` 逐字段量）：
 *
 *   div.lark-doc-table-tools[role=toolbar][aria-label=表格工具]   ← fixed 浮窗，**唯一**
 *     div.lark-doc-table-tools-bar
 *       button.lark-doc-table-tools-btn[data-cmd=...][title=...]  ← 单行，mark 按钮带 aria-pressed
 *       span.lark-doc-table-tools-sep[.is-full]                   ← 分隔线
 *     div.lark-doc-table-tools-menu[data-menu=...][role=menu]     ← 同一时刻最多挂 1 个
 *       button.lark-doc-table-tools-menu-item[data-value=...]
 *       div.lark-doc-table-tools-colors > button[data-value=...]
 *
 *   div.lark-doc-table-boundary-tools[.is-column|.is-row] ...    ← 边界 ＋；v12d 起 ＋ hover
 *      出飞书同款深色 tip（「插入列」/「插入行」，深底 + 朝下箭头），原生 title 同步移除
 *
 * 显隐 / 锚点由 `tableToolsUiMixin.buildTableToolsState()` 算好塞进 `state`；根节点
 * `onMouseDown preventDefault()` 与真源同义：按下不转移焦点，选区不会被浏览器清掉。
 */
import { applyStyle, mountNode, syncChildren } from './dom'
import { iconNode } from './icon'
import { TEXT_COLOR_OPTIONS, TEXT_BACKGROUND_ROWS, CALLOUT_COLOR_OPTIONS } from './palette'

function setVar(node, name, value) {
  if (value === null) {
    if (node.style.getPropertyValue(name)) node.style.removeProperty(name)
    return
  }
  if (node.style.getPropertyValue(name) !== value) node.style.setProperty(name, value)
}

/** 唯一浮窗定位：挂载后量尺寸，再按 anchor 与视口裁剪（真源 anchorRect + viewport clamp）。 */
function placeFloatingToolbar(el, anchor) {
  if (!anchor || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) return
  const win = el.ownerDocument.defaultView
  if (!win) return
  const rect = el.getBoundingClientRect()
  const vw = win.innerWidth || el.ownerDocument.documentElement.clientWidth || 0
  const vh = win.innerHeight || el.ownerDocument.documentElement.clientHeight || 0
  const gap = 12
  const pad = 8
  let left = anchor.placement === 'left' ? anchor.x - gap - rect.width : anchor.x - rect.width / 2
  let top = anchor.placement === 'left' ? anchor.y - rect.height / 2 : anchor.y - gap - rect.height
  if (vw) left = Math.max(pad, Math.min(vw - rect.width - pad, left))
  if (vh) top = Math.max(pad, Math.min(vh - rect.height - pad, top))
  el.style.left = `${Math.round(left)}px`
  el.style.top = `${Math.round(top)}px`
}

const DIV = { divider: true }
const FULL_DIV = { divider: true, full: true }

/** 飞书「转换为」下拉（真源 12 项）；图标与顶部功能栏共用 `icons.js`。 */
const TURN_INTO = [
  { id: 'paragraph', label: '正文', icon: 'block-text' },
  { id: 'heading1', label: '一级标题', icon: 'block-h1' },
  { id: 'heading2', label: '二级标题', icon: 'block-h2' },
  { id: 'heading3', label: '三级标题', icon: 'block-h3' },
  DIV,
  { id: 'orderedList', label: '有序列表', icon: 'block-ordered' },
  { id: 'bulletList', label: '无序列表', icon: 'block-bullet' },
  { id: 'taskList', label: '任务', icon: 'block-task' },
  { id: 'codeBlock', label: '代码块', icon: 'block-code' },
  { id: 'blockquote', label: '引用', icon: 'block-quote' },
  { id: 'callout', label: '高亮块', icon: 'block-callout' },
  { id: 'synced', label: '同步块', icon: 'block-sync' },
]

/** 飞书「对齐与缩进」下拉（真源 8 项）。 */
const ALIGN_ITEMS = [
  { id: 'align:left', label: '左对齐', icon: 'align-left' },
  { id: 'align:center', label: '居中对齐', icon: 'align-center' },
  { id: 'align:right', label: '右对齐', icon: 'align-right' },
  DIV,
  { id: 'valign:top', label: '顶部对齐', icon: 'valign-top' },
  { id: 'valign:middle', label: '垂直居中', icon: 'valign-middle' },
  { id: 'valign:bottom', label: '底部对齐', icon: 'valign-bottom' },
  DIV,
  { id: 'indent:1', label: '增加缩进', icon: 'indent-inc' },
  { id: 'indent:-1', label: '减少缩进', icon: 'indent-dec' },
]

/**
 * 飞书「更多」下拉。⚠️ v11 用户口径：「像转换为子文档、收录到词典等暂时不具备的
 * 功能可以去掉」—— 只留项目里真有承接能力的项，不用 localStorage / window.open
 * 伪造「保存为模板 / 网页搜索 / 子文档 / 词典」的效果（1:1，不自己创造）。
 * ⚠️ v12：「复制选区链接」已由尾部 `share-link` 按钮独占（真源 shareTextLink），
 *    「更多」里不再重复放 `copyAnchorLink` —— 用户实测「弄了两个功能按钮出来」。
 * ⚠️ v12c：连 `share-link` 本身也一起下线（无 #pos 解析 / 无宿主接线），
 *    「更多」里同样不补回 `copyAnchorLink` —— 不把没实现的能力做成可点入口。
 */
const MORE_ITEMS = [
  { id: 'translate', label: '翻译', icon: 'translate' },
  { id: 'larkSearch', label: '文档内搜索', icon: 'search' },
]

const TURN = { id: 'turninto', label: '转换为', icon: 'block-text', caret: true, menu: true }
const ALIGN = { id: 'align', label: '对齐与缩进', icon: 'align-left', caret: true, menu: true }
const MARKS = [
  { id: 'bold', label: '加粗', icon: 'mark-bold', mark: 'bold' },
  { id: 'strike', label: '删除线', icon: 'mark-strike', mark: 'strike' },
  { id: 'italic', label: '斜体', icon: 'mark-italic', mark: 'italic' },
  { id: 'underline', label: '下划线', icon: 'mark-underline', mark: 'underline' },
  { id: 'link', label: '插入链接', icon: 'link' },
  { id: 'code', label: '行内代码', icon: 'inlineCode', mark: 'code' },
  { id: 'highlight', label: '字体色 / 背景色', icon: 'mark-highlight', caret: true, menu: true },
]
/** 飞书「标题行列」按钮：只对**整行 / 整列**选区（形态 D/H）出现 —— 多格拖选（形态 E）没有它。 */
const CELL_LINE = [
  { id: 'table-header', label: '标题行 / 标题列', icon: 'table-header-row', menu: true },
]
/** 飞书表格态共享两颗：合并 / 拆分、单元格背景 —— 整行列与多格拖选都有（形态 C/E/F/G）。 */
const CELL_SHARED = [
  { id: 'merge-cell', label: '合并 / 拆分单元格', icon: 'table-merge', menu: true },
  { id: 'cell-bg', label: '单元格背景', icon: 'palette', menu: true },
]
/** v12c：尾部只剩「更多」——`share-link` / `comment` 两颗无实现按钮已下线。 */
const TAIL = [
  { id: 'more', label: '更多', icon: 'more-horizontal', caret: true, menu: true },
]
const REMOVE = { id: 'remove', label: '删除', icon: 'trash' }

/** 全部按钮（用于一次建好节点，之后只按上下文挂/摘）。v12：不再有「问问豆包」；v12c：不再有复制选区链接 / 评论。 */
const ALL_ITEMS = [...CELL_LINE, ...CELL_SHARED, TURN, ALIGN, ...MARKS, ...TAIL, REMOVE]

/**
 * 同一条浮窗的三种上下文（v12 按飞书真源形态拆分，见 requirements/02 §⑦-3 ★四套形态；
 * v12c 三态各自再去掉 `share-link` + `comment`）：
 *  - `text`  单元格内选文字（形态 B，**10 项**）：转换为 对齐 | B S I U 链接 </> 高亮 | 更多。
 *  - `line`  **整行 / 整列**选区（点选择条，形态 D/H，**13 项**）：标题行列 合并 背景 | 转换为 对齐 |
 *            B S I U </> 高亮 | 更多 删除（末尾 remove）。
 *  - `multi` **拖选两个及以上单元格**（形态 E/G，**11 项**）：合并 背景 | 转换为 对齐 |
 *            B S I U </> 高亮 | 更多（🔴 无标题行列、🔴 末尾既不是评论也不是删除，
 *            原「末尾评论」的识别信号改为「无 table-header 且无 remove」）。
 */
function toolbarItems(kind) {
  if (kind === 'line') {
    return [...CELL_LINE, ...CELL_SHARED, DIV, TURN, ALIGN, DIV,
      ...MARKS.filter((item) => item.id !== 'link'), FULL_DIV, ...TAIL, REMOVE]
  }
  if (kind === 'multi') {
    return [...CELL_SHARED, DIV, TURN, ALIGN, DIV,
      ...MARKS.filter((item) => item.id !== 'link'), FULL_DIV, ...TAIL]
  }
  return [TURN, ALIGN, DIV, ...MARKS, FULL_DIV, ...TAIL]
}

const itemById = (id) => ALL_ITEMS.find((item) => item.id === id)

function makeMenuItem(entry, onPick) {
  if (entry.divider) {
    const d = document.createElement('span')
    d.className = 'lark-doc-table-tools-menu-divider'
    d.setAttribute('aria-hidden', 'true')
    return d
  }
  const b = document.createElement('button')
  b.type = 'button'
  b.className = 'lark-doc-table-tools-menu-item'
  b.dataset.value = entry.id
  b.setAttribute('role', 'menuitem')
  if (entry.icon) b.appendChild(iconNode(entry.icon, 16, 'lark-doc-table-tools-menu-icon'))
  const label = document.createElement('span')
  label.textContent = entry.label
  b.appendChild(label)
  if (entry.pressed !== undefined) b.setAttribute('aria-pressed', String(!!entry.pressed))
  // 上下文不适用（无 CellSelection 时的合并/拆分、到顶的缩进）直接置灰：
  // native disabled 按钮不派发 click，用户不会遇到「点了没反应」。
  if (entry.disabled) {
    b.disabled = true
    b.classList.add('is-disabled')
    b.setAttribute('aria-disabled', 'true')
  }
  b.addEventListener('mousedown', (event) => event.preventDefault())
  b.addEventListener('click', () => onPick(entry.id))
  return b
}

function makeColorRow(menu, title, colors, prefix, onPick) {
  const box = document.createElement('div')
  box.className = 'lark-doc-table-tools-colors'
  box.dataset.group = prefix
  const cap = document.createElement('div')
  cap.className = 'lark-doc-table-tools-colors-title'
  cap.textContent = title
  box.appendChild(cap)
  const grid = document.createElement('div')
  grid.className = 'lark-doc-table-tools-colors-grid'
  for (const color of colors) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'lark-doc-table-tools-color'
    b.dataset.value = `${prefix}:${color.value}`
    b.title = color.label
    b.setAttribute('aria-label', `${title} ${color.label}`)
    if (color.value) b.style.background = color.value
    else b.classList.add('is-none')
    b.addEventListener('mousedown', (event) => event.preventDefault())
    b.addEventListener('click', () => onPick(`${prefix}:${color.value}`))
    grid.appendChild(b)
  }
  box.appendChild(grid)
  menu.appendChild(box)
}

/** 按菜单名生成一份菜单 DOM；菜单项图标同样来自 `icons.js`。 */
function buildMenu(name, state, onPick) {
  const menu = document.createElement('div')
  menu.className = 'lark-doc-table-tools-menu'
  menu.dataset.menu = name
  menu.setAttribute('role', 'menu')
  menu.setAttribute('aria-label', itemById(name)?.label || name)
  menu.addEventListener('mousedown', (event) => event.preventDefault())
  const add = (entries) => entries.forEach((entry) => menu.appendChild(makeMenuItem(entry, onPick)))

  if (name === 'table-header') {
    add([
      { id: 'toggleHeaderRow', label: '标题行', icon: 'table-header-row', pressed: state.header?.row },
      { id: 'toggleHeaderColumn', label: '标题列', icon: 'table-header-col', pressed: state.header?.column },
    ])
  } else if (name === 'merge-cell') {
    add([
      { id: 'mergeCells', label: '合并单元格', icon: 'table-merge', disabled: !state.cellSelection },
      { id: 'splitCell', label: '拆分单元格', icon: 'table-split', disabled: !state.cellSelection || !state.canSplitCell },
    ])
  } else if (name === 'turninto') {
    // 飞书「转换为」会把当前块类型打勾；同时它也是「点了 paragraph 没变化」的正确解释。
    add(TURN_INTO.map((item) => (item.divider ? item : { ...item, pressed: item.id === state.blockType })))
  } else if (name === 'align') {
    add(ALIGN_ITEMS.map((item) => {
      if (item.divider) return item
      if (item.id === 'indent:1') return { ...item, disabled: !state.canIndentIn }
      if (item.id === 'indent:-1') return { ...item, disabled: !state.canIndentOut }
      return item
    }))
  } else if (name === 'more') {
    add(MORE_ITEMS)
  } else if (name === 'highlight') {
    makeColorRow(menu, '字体颜色', TEXT_COLOR_OPTIONS, 'color', onPick)
    makeColorRow(menu, '文字背景', TEXT_BACKGROUND_ROWS.flat(), 'bg', onPick)
    add([DIV, { id: 'highlight:clear', label: '清除颜色与高亮', icon: 'clear', disabled: !state.hasTextColor }])
  } else if (name === 'cell-bg') {
    makeColorRow(menu, '单元格背景', CALLOUT_COLOR_OPTIONS, 'cellbg', onPick)
    add([DIV, { id: 'cellbg:', label: '清除单元格背景', icon: 'clear', disabled: !state.hasCellBg }])
  }
  return menu
}

/**
 * 工具按钮：图标 = `iconNode()` 的 SVG，箭头 = `iconNode('chevronDown', 12, 'lark-doc-caret')`。
 * 与 `src/ui/toolbar.js` / `bubbleBar.js` 完全同源；`aria-expanded=true` 时箭头由全局
 * `.lark-doc-caret` 规则自动翻 180°，不在这里另写一套字符箭头。
 */
function makeTool(item, onCommand, ui) {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = 'lark-doc-table-tools-btn'
  b.dataset.cmd = item.id
  b.title = item.label
  b.setAttribute('aria-label', item.label)
  if (item.mark) b.dataset.mark = item.mark
  if (item.text) b.classList.add('is-text')
  if (item.caret) b.classList.add('has-caret')
  if (item.menu) {
    b.setAttribute('aria-haspopup', 'menu')
    b.setAttribute('aria-expanded', 'false')
  }
  b.appendChild(iconNode(item.icon, 16, 'lark-doc-table-tools-icon'))
  if (item.text) {
    const text = document.createElement('span')
    text.className = 'lark-doc-table-tools-text'
    text.textContent = item.label
    b.appendChild(text)
  }
  if (item.caret) b.appendChild(iconNode('chevronDown', 12, 'lark-doc-caret'))
  b.addEventListener('mousedown', (event) => event.preventDefault())
  if (item.menu) {
    // 顶部功能栏同一套交互：hover / focus 即展开，离开延迟收（跨过按钮与弹层间隙不误关）。
    b.addEventListener('mouseenter', () => ui.onHover(item.id, b))
    b.addEventListener('focus', () => ui.onHover(item.id, b))
    b.addEventListener('mouseleave', () => ui.onLeave())
    b.addEventListener('click', () => { if (!b.disabled) ui.onToggle(item.id, b) })
  } else {
    b.addEventListener('click', () => { if (!b.disabled) onCommand(item.id, null) })
  }
  return b
}

/**
 * @param {object} options
 * @param {HTMLElement} options.host 挂载点（`display: contents` 宿主，不占盒）
 * @param {{onCommand?: (id: string, value: string|null) => void}} [options.handlers]
 * @returns {{ el: HTMLElement, update(state: object): void, destroy(): void }}
 */
export function createTableTools({ host, handlers = {} }) {
  const el = document.createElement('div')
  el.className = 'lark-doc-table-tools'
  el.setAttribute('role', 'toolbar')
  el.setAttribute('aria-label', '表格工具')
  // 真源 `onMouseDown:H=>H.preventDefault()`：按下不转移焦点，选区才不会被浏览器清掉。
  el.addEventListener('mousedown', (event) => event.preventDefault())

  const bar = document.createElement('div')
  bar.className = 'lark-doc-table-tools-bar'
  const buttons = new Map()
  const sepPool = { normal: [], full: [] }
  let openMenuName = null
  let openMenuNode = null
  let hoverOpened = false
  let closeTimer = null
  let lastState = {}
  let lastCellSelection = null
  const command = (id, value) => { if (handlers.onCommand) handlers.onCommand(id, value) }

  /** 顶部功能栏 `cancelPopupHoverClose` / `schedulePopupHoverClose` 的同一套 150ms 语义。 */
  function cancelClose() {
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = null }
  }
  function scheduleClose() {
    cancelClose()
    closeTimer = setTimeout(() => { closeTimer = null; closeMenus() }, 150)
  }
  function closeMenus() {
    cancelClose()
    hoverOpened = false
    openMenuName = null
    if (openMenuNode && openMenuNode.parentNode) openMenuNode.parentNode.removeChild(openMenuNode)
    openMenuNode = null
    buttons.forEach((b) => { b.classList.remove('is-menu-open'); b.setAttribute('aria-expanded', 'false') })
    syncChildren(el, [{ node: bar, on: true }])
  }

  function openMenu(name, btn, viaHover) {
    // 指针从弹层回到触发按钮时，必须先把 mouseleave 排下的关闭取消掉。
    cancelClose()
    if (openMenuName === name) return
    closeMenus()
    openMenuName = name
    hoverOpened = !!viaHover
    btn.classList.add('is-menu-open')
    btn.setAttribute('aria-expanded', 'true')
    openMenuNode = buildMenu(name, lastState, (value) => {
      const menu = name
      closeMenus()
      command(menu, value)
    })
    // 指针从按钮移到弹层会经过 4px 间隙：进入弹层取消延迟，离开弹层再排延迟。
    openMenuNode.addEventListener('mouseenter', cancelClose)
    openMenuNode.addEventListener('mouseleave', scheduleClose)
    syncChildren(el, [{ node: bar, on: true }, { node: openMenuNode, on: true }])
    // 菜单贴触发按钮左沿，右侧不越出浮窗；宽度量完再钳一次。
    const er = el.getBoundingClientRect()
    const br = btn.getBoundingClientRect()
    const mw = openMenuNode.getBoundingClientRect().width || 220
    openMenuNode.style.left = `${Math.max(0, Math.min(er.width - mw, br.left - er.left))}px`
  }

  /** hover / focus 已展开时再点不收起（`toolbarMenusMixin.toggleHeadingMenu` 同款）。 */
  function toggleMenu(name, btn) {
    if (openMenuName === name) {
      if (!hoverOpened) closeMenus()
      return
    }
    openMenu(name, btn, false)
  }

  const ui = {
    onHover: (name, btn) => openMenu(name, btn, true),
    onLeave: scheduleClose,
    onToggle: toggleMenu,
  }

  const onDocPointerDown = (event) => {
    if (openMenuNode && !el.contains(event.target)) closeMenus()
  }
  const onKeyDown = (event) => { if (event.key === 'Escape' && openMenuNode) closeMenus() }
  const doc = host?.ownerDocument || document
  doc.addEventListener('pointerdown', onDocPointerDown, true)
  doc.addEventListener('keydown', onKeyDown, true)

  ALL_ITEMS.forEach((item) => buttons.set(item.id, makeTool(item, command, ui)))

  /** 同一条 bar 按上下文真摘除/插入按钮（`toolbar.js` 的 `syncChildren` 语义）。 */
  function syncBar(kind) {
    if (lastCellSelection === kind) return
    lastCellSelection = kind
    let normal = 0
    let full = 0
    const spec = toolbarItems(kind).map((item) => {
      if (!item.divider) return { node: buttons.get(item.id), on: true }
      const pool = item.full ? sepPool.full : sepPool.normal
      const index = item.full ? full++ : normal++
      if (!pool[index]) {
        const s = document.createElement('span')
        s.className = `lark-doc-table-tools-sep${item.full ? ' is-full' : ''}`
        s.setAttribute('aria-hidden', 'true')
        pool[index] = s
      }
      return { node: pool[index], on: true }
    })
    syncChildren(bar, spec)
  }

  syncChildren(el, [{ node: bar, on: true }])

  function update(state = {}) {
    if (!state.open) {
      closeMenus()
      mountNode(host, el, false)
      return
    }
    lastState = state
    // v12：三种上下文（'text' | 'line' | 'multi'）；旧字段 cellSelection 布尔值兜底为 line。
    syncBar(state.cellKind || (state.cellSelection ? 'line' : 'text'))
    const active = state.active || {}
    buttons.forEach((b, id) => {
      const item = itemById(id)
      if (item?.mark) {
        const on = !!active[item.mark]
        b.classList.toggle('is-active', on)
        b.setAttribute('aria-pressed', String(on))
      }
    })
    mountNode(host, el, true)
    placeFloatingToolbar(el, state.anchor)
  }

  return {
    el,
    update,
    destroy() {
      doc.removeEventListener('pointerdown', onDocPointerDown, true)
      doc.removeEventListener('keydown', onKeyDown, true)
      closeMenus()
      if (el.parentNode) el.parentNode.removeChild(el)
    },
  }
}

/**
 * @param {object} options
 * @param {HTMLElement} options.host 挂载点（在 `.lark-doc-paper` 里，`display: contents`）
 * @param {{onAction?: (id: string) => void, onPlusHover?: (on: boolean) => void,
 *          onKeep?: () => void, onClear?: () => void}} [options.handlers]
 * @returns {{ el: HTMLElement, update(state: object): void, destroy(): void }}
 */
export function createTableBoundaryTools({ host, handlers = {} }) {
  const el = document.createElement('div')
  el.className = 'lark-doc-table-boundary-tools'
  el.setAttribute('role', 'toolbar')
  el.setAttribute('aria-label', '表格边界操作')

  // hover line：v6 起跟随边界 hover 常亮（用户「交界处需要高亮」），由 state.lineVisible 控制。
  const line = document.createElement('span')
  line.className = 'lark-doc-table-boundary-line'
  line.setAttribute('aria-hidden', 'true')

  // v12d：飞书真源 ＋ 悬浮提示 —— 深色气泡 + 朝下箭头（用户反馈⑧，两张真源截图：
  // 列 ＋ →「插入列」、行 ＋ →「插入行」）。hover ＋ 150ms 后出现，离开即收；
  // 原生 `title` 属性同时移除，避免浏览器原生 tooltip 与自绘气泡双重弹出。
  const tip = document.createElement('div')
  tip.className = 'lark-doc-table-boundary-tip'
  tip.setAttribute('role', 'tooltip')

  // 整条边线只有这一颗 ＋。轴由 class 切换，插入命令由 `state.actionId` 驱动。
  const plus = document.createElement('button')
  plus.type = 'button'
  plus.className = 'lark-doc-table-col-plus-btn'
  plus.textContent = '＋'
  let actionId = 'addColumnAfter'
  plus.addEventListener('mousedown', (event) => event.preventDefault())
  plus.addEventListener('click', () => { if (handlers.onAction) handlers.onAction(actionId) })
  const setPlusActive = (on) => { if (handlers.onPlusHover) handlers.onPlusHover(on) }
  let tipTimer = null
  let plusHovered = false
  const showTip = () => { clearTimeout(tipTimer); tip.classList.add('is-visible') }
  const scheduleTip = () => { clearTimeout(tipTimer); tipTimer = setTimeout(showTip, 150) }
  const hideTip = () => { clearTimeout(tipTimer); tip.classList.remove('is-visible') }
  plus.addEventListener('pointerenter', () => { plus.classList.add('is-hover'); plusHovered = true; setPlusActive(true); scheduleTip() })
  plus.addEventListener('pointerleave', () => { plus.classList.remove('is-hover'); plusHovered = false; setPlusActive(false); hideTip() })
  plus.addEventListener('focus', () => { plus.classList.add('is-hover'); plusHovered = true; setPlusActive(true); scheduleTip() })
  plus.addEventListener('blur', () => { plus.classList.remove('is-hover'); plusHovered = false; setPlusActive(false); hideTip() })

  // 指针进到条上不能把 hover 清掉（否则鼠标一移向按钮，条就先消失了）。
  el.addEventListener('pointerenter', () => { if (handlers.onKeep) handlers.onKeep() })
  el.addEventListener('pointerleave', () => {
    plus.classList.remove('is-hover')
    plusHovered = false
    setPlusActive(false)
    hideTip()
    if (handlers.onClear) handlers.onClear()
  })

  function update(state = {}) {
    if (!state.open) {
      // tip 元素是持久复用的：边界条卸载时指针不会补发 pointerleave，必须在这里
      // 显式收起并清定时器，否则残留的 is-visible 会在下次打开时提前弹出（v12d 实测）。
      hideTip()
      plusHovered = false
      mountNode(host, el, false)
      return
    }
    // 边界条重渲染时以真实 hover 状态收敛 tip（自愈陈旧定时器 / 残留 class）。
    if (!plusHovered) hideTip()
    const kind = state.kind === 'row' ? 'row' : 'column'
    el.classList.toggle('is-column', kind === 'column')
    el.classList.toggle('is-row', kind === 'row')
    applyStyle(el, state.style)
    const plusUp = Number.isFinite(state.plusUp) ? state.plusUp : 28
    const plusDown = Number.isFinite(state.plusDown) ? state.plusDown : 20
    setVar(el, '--lark-doc-boundary-plus-top', `${-plusUp}px`)
    setVar(el, '--lark-doc-boundary-plus-bottom', `${-plusDown}px`)
    const length = Math.max(0, Number.isFinite(state.lineLength) ? state.lineLength : 0)
    if (kind === 'column') {
      setVar(el, '--lark-doc-column-line-left', `${state.columnLineLeft}px`)
      setVar(el, '--lark-doc-row-line-top', null)
      applyStyle(line, { left: `${state.columnLineLeft}px`, top: '', height: `${length}px`, width: '' })
      plus.setAttribute('aria-label', '在此处插入列')
      tip.textContent = '插入列'
    } else {
      setVar(el, '--lark-doc-row-line-top', `${state.rowLineTop}px`)
      setVar(el, '--lark-doc-column-line-left', null)
      applyStyle(line, { top: `${state.rowLineTop}px`, left: '', width: `${length}px`, height: '' })
      plus.setAttribute('aria-label', '在此处插入行')
      tip.textContent = '插入行'
    }
    tip.classList.toggle('is-row', kind === 'row')
    plus.classList.toggle('lark-doc-table-col-plus-btn', kind === 'column')
    plus.classList.toggle('lark-doc-table-row-plus-btn', kind === 'row')
    line.className = kind === 'column'
      ? 'lark-doc-table-boundary-line is-column-line'
      : 'lark-doc-table-boundary-line is-row-line'
    actionId = state.actionId || (kind === 'column' ? 'addColumnAfter' : 'addRowAfter')
    syncChildren(el, [
      { node: line, on: !!state.lineVisible },
      { node: plus, on: true },
      { node: tip, on: true },
    ])
    mountNode(host, el, true)
  }

  return {
    el,
    update,
    destroy() {
      clearTimeout(tipTimer)
      tip.classList.remove('is-visible')
      if (el.parentNode) el.parentNode.removeChild(el)
    },
  }
}
