/**
 * 表格选区浮窗与边界工具（纯DOM）。
 * 文字、单整行列、多整行列与局部多格共用一颗浮窗，按真实选区提供操作。
 * 首行/首列标题与合并/拆分为直接按钮；多列独有均分，完整行列提供结构删除。
 * 参考已核对的飞书实页；问问AI打开待输入聊天，分享与评论走各自真实服务。
 * 颜色复用项目token；鼠标不抢编辑器焦点，菜单支持hover/键盘与点击外部关闭。
 */
import { applyStyle, mountNode, syncChildren } from './dom'
import { iconNode, setIcon } from './icon'
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
  // 左侧空间不足时放到表格上方，不能钳回去盖住行选择条并误触颜色菜单。
  if (anchor.placement === 'left' && left < pad) {
    left = anchor.fallbackX ?? anchor.x
    top = (anchor.fallbackY ?? anchor.y) - rect.height
  }
  if (vw) left = Math.max(pad, Math.min(vw - rect.width - pad, left))
  if (vh) top = Math.max(pad, Math.min(vh - rect.height - pad, top))
  el.style.left = `${Math.round(left)}px`
  el.style.top = `${Math.round(top)}px`
}

const DIV = { divider: true }
const FULL_DIV = { divider: true, full: true }

/** Source cell conversion menu, including the nested H4–H9 choices. */
const TURN_INTO = [
  { id: 'paragraph', label: '正文', icon: 'table-float-text' },
  { id: 'heading1', label: '一级标题', icon: 'block-h1' },
  { id: 'heading2', label: '二级标题', icon: 'block-h2' },
  { id: 'heading3', label: '三级标题', icon: 'block-h3' },
  { id: 'other-headings', label: '其他标题', icon: 'block-h4', children: Array.from({ length: 6 }, (_, index) => ({ id: `heading${index + 4}`, label: `${['四', '五', '六', '七', '八', '九'][index]}级标题`, icon: `block-h${index + 4}` })) },
  { id: 'orderedList', label: '有序列表', icon: 'block-ordered' },
  { id: 'bulletList', label: '无序列表', icon: 'block-bullet' },
  { id: 'taskList', label: '任务', icon: 'block-task' },
  { id: 'codeBlock', label: '代码块', icon: 'block-code' },
]

/** Source table alignment menu: three horizontal and three vertical choices. */
const ALIGN_ITEMS = [
  { id: 'align:left', label: '左对齐', icon: 'table-float-align' },
  { id: 'align:center', label: '居中对齐', icon: 'align-center' },
  { id: 'align:right', label: '右对齐', icon: 'align-right' },
  DIV,
  { id: 'valign:top', label: '顶部对齐', icon: 'valign-top' },
  { id: 'valign:middle', label: '垂直居中', icon: 'valign-middle' },
  { id: 'valign:bottom', label: '底部对齐', icon: 'valign-bottom' },
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

const TURN = { id: 'turninto', label: '转换为', icon: 'table-float-text', caret: true, menu: true }
const ALIGN = { id: 'align', label: '对齐与缩进', icon: 'table-float-align', caret: true, menu: true }
const MARKS = [
  { id: 'bold', label: '加粗', icon: 'table-float-bold', mark: 'bold' },
  { id: 'strike', label: '删除线', icon: 'table-float-strike', mark: 'strike' },
  { id: 'italic', label: '斜体', icon: 'table-float-italic', mark: 'italic' },
  { id: 'underline', label: '下划线', icon: 'table-float-underline', mark: 'underline' },
  { id: 'link', label: '插入链接', icon: 'link' },
  { id: 'code', label: '行内代码', icon: 'table-float-code', mark: 'code' },
  { id: 'highlight', label: '字体色 / 背景色', icon: 'table-float-highlight', caret: true, menu: true },
]
/** 飞书「标题行列」按钮：只对**整行 / 整列**选区（形态 D/H）出现 —— 多格拖选（形态 E）没有它。 */
const CELL_LINE = [
  { id: 'table-header', label: '标题行', icon: 'table-float-header-row' },
]
/** 飞书表格态共享两颗：合并 / 拆分、单元格背景 —— 整行列与多格拖选都有（形态 C/E/F/G）。 */
const CELL_SHARED = [
  { id: 'merge-cell', label: '合并单元格', icon: 'table-float-merge' },
  { id: 'cell-bg', label: '单元格背景', icon: 'table-float-background', menu: true },
]
/** Comments follow their provider capability; selection sharing has its own transport. */
const TAIL = [
  { id: 'more', label: '更多', icon: 'table-float-more', menu: true },
  { id: 'share-link', label: '分享', icon: 'share-link' },
  { id: 'comment', label: '添加评论', icon: 'mode-comment' },
]
const REMOVE = { id: 'remove', label: '删除', icon: 'table-float-remove' }
const DISTRIBUTE = { id: 'distributeColumns', label: '均分所选列宽', icon: 'table-float-distribute' }
const AI = { id: 'ask-ai', label: '问问AI', icon: 'sparkle', text: true }

/** Build once; the comment node is mounted only when a readable provider is configured. */
const ALL_ITEMS = [AI, ...CELL_LINE, DISTRIBUTE, ...CELL_SHARED, TURN, ALIGN, ...MARKS, ...TAIL, REMOVE]

/**
 * 同一条浮窗的三种上下文（v12 按飞书真源形态拆分，见 requirements/02 §⑦-3 ★四套形态；
 * 以下为基础按钮结构；已配置评论服务时各态在「更多」后追加评论，分享仍不展示）：
 *  - `text`  单元格内选文字（形态 B，**10 项**）：转换为 对齐 | B S I U 链接 </> 高亮 | 更多。
 *  - `line`  **整行 / 整列**选区（点选择条，形态 D/H，**13 项**）：标题行列 合并 背景 | 转换为 对齐 |
 *            B S I U </> 高亮 | 更多 删除（末尾 remove）。
 *  - `multi` **拖选两个及以上单元格**（形态 E/G，**11 项**）：合并 背景 | 转换为 对齐 |
 *            B S I U </> 高亮 | 更多（🔴 无标题行列、🔴 末尾既不是评论也不是删除，
 *            原「末尾评论」的识别信号改为「无 table-header 且无 remove」）。
 */
function toolbarItems(kind, headerAxis) {
  if (kind === 'columns' || kind === 'rows') {
    return [...(kind === 'columns' ? [DISTRIBUTE] : []), ...CELL_SHARED, DIV, TURN, ALIGN, DIV,
      ...MARKS.filter((item) => item.id !== 'link'), FULL_DIV, ...TAIL, REMOVE]
  }
  if (kind === 'line') {
    return [...(headerAxis === null ? [] : CELL_LINE), ...CELL_SHARED, DIV, TURN, ALIGN, DIV,
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
  if (entry.children) {
    const wrapper = document.createElement('div')
    wrapper.className = 'lark-doc-table-tools-submenu'
    b.setAttribute('aria-haspopup', 'menu')
    b.setAttribute('aria-expanded', 'false')
    b.appendChild(iconNode('link-view-caret', 12, 'lark-doc-table-tools-submenu-caret'))
    const submenu = document.createElement('div')
    submenu.className = 'lark-doc-table-tools-menu is-heading-submenu'
    submenu.setAttribute('role', 'menu')
    submenu.setAttribute('aria-label', entry.label)
    submenu.hidden = true
    entry.children.forEach(item => submenu.appendChild(makeMenuItem(item, onPick)))
    const open = () => {
      submenu.hidden = false
      b.setAttribute('aria-expanded', 'true')
      const rect = b.getBoundingClientRect()
      const size = submenu.getBoundingClientRect()
      submenu.style.left = `${Math.max(8, rect.right + size.width <= window.innerWidth - 8 ? rect.right : rect.left - size.width)}px`
      submenu.style.top = `${Math.max(8, Math.min(rect.top, window.innerHeight - size.height - 8))}px`
    }
    const close = () => { submenu.hidden = true; b.setAttribute('aria-expanded', 'false') }
    wrapper.addEventListener('mouseenter', open)
    wrapper.addEventListener('mouseleave', close)
    b.addEventListener('focus', open)
    b.addEventListener('click', open)
    wrapper.addEventListener('focusout', event => { if (!wrapper.contains(event.relatedTarget)) close() })
    b.addEventListener('mousedown', event => event.preventDefault())
    wrapper.append(b, submenu)
    return wrapper
  }
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

function alignmentPressed(id, state) {
  const [kind, value] = id.split(':')
  const alignment = kind === 'align' ? state.textAlign : state.verticalAlign
  return value === (alignment === null ? null : alignment || (kind === 'align' ? 'left' : 'top'))
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

  if (name === 'turninto') {
    // 飞书「转换为」会把当前块类型打勾；同时它也是「点了 paragraph 没变化」的正确解释。
    add(TURN_INTO.map((item) => (item.divider ? item : { ...item, pressed: item.id === state.blockType, children: item.children?.map(child => ({ ...child, pressed: child.id === state.blockType })) })))
  } else if (name === 'align') {
    add(ALIGN_ITEMS.map((item) => {
      if (item.divider) return item
      return { ...item, pressed: alignmentPressed(item.id, state) }
    }))
  } else if (name === 'more') {
    add(MORE_ITEMS)
  } else if (name === 'highlight') {
    makeColorRow(menu, '字体颜色', TEXT_COLOR_OPTIONS, 'color', onPick)
    makeColorRow(menu, '文字背景', TEXT_BACKGROUND_ROWS.flat(), 'bg', onPick)
    add([DIV, { id: 'highlight:clear', label: '清除颜色与高亮', icon: 'clear', disabled: !state.hasTextColor }])
  } else if (name === 'cell-bg') {
    makeColorRow(menu, '单元格背景颜色', CALLOUT_COLOR_OPTIONS, 'cellbg', onPick)
    add([DIV, { id: 'cellbg:', label: '恢复默认', icon: 'clear', disabled: !state.hasCellBg }])
  }
  return menu
}

/**
 * 工具按钮：图标 = `iconNode()` 的 SVG，箭头 = `iconNode('link-view-caret', 12, 'lark-doc-caret')`。
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
  b.appendChild(iconNode(item.icon, 24, 'lark-doc-table-tools-icon'))
  if (item.text) {
    const text = document.createElement('span')
    text.className = 'lark-doc-table-tools-text'
    text.textContent = item.label
    b.appendChild(text)
  }
  if (item.caret) b.appendChild(iconNode('link-view-caret', 12, 'lark-doc-caret'))
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
  function syncBar(kind, headerAxis, commentVisible, shareVisible, aiVisible) {
    const signature = `${kind}:${headerAxis}:${commentVisible}:${shareVisible}:${aiVisible}`
    if (lastCellSelection === signature) return
    lastCellSelection = signature
    let normal = 0
    let full = 0
    const items = [...(aiVisible ? [AI, DIV] : []), ...toolbarItems(kind, headerAxis)]
    const spec = items.filter(item => (item.id !== 'comment' || commentVisible) && (item.id !== 'share-link' || shareVisible)).map((item) => {
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
    // Transactions can change the selection while a menu stays open (keyboard
    // undo, collaboration). Update checkmarks without replacing focused nodes.
    if (openMenuName === 'align' || openMenuName === 'turninto') {
      openMenuNode?.querySelectorAll('button[data-value]').forEach(button => {
        const pressed = openMenuName === 'align'
          ? alignmentPressed(button.dataset.value, state) : button.dataset.value === state.blockType
        button.setAttribute('aria-pressed', String(pressed))
      })
    }
    // v12：三种上下文（'text' | 'line' | 'multi'）；旧字段 cellSelection 布尔值兜底为 line。
    syncBar(state.cellKind || (state.cellSelection ? 'line' : 'text'), state.headerAxis, !!state.commentVisible, !!state.shareVisible, !!state.aiVisible)
    const comment = buttons.get('comment')
    comment.disabled = !state.canComment
    comment.title = state.canComment ? '添加评论' : '当前没有评论权限'
    const header = buttons.get('table-header')
    const axis = state.headerAxis === 'column' ? 'column' : 'row'
    const headerOn = !!state.header?.[axis]
    header.title = `${headerOn ? '取消' : ''}标题${axis === 'column' ? '列' : '行'}`
    header.setAttribute('aria-label', header.title)
    header.setAttribute('aria-pressed', String(headerOn))
    header.classList.toggle('is-active', headerOn)
    header.disabled = state.headerEnabled === false
    setIcon(header.firstElementChild, axis === 'column' ? 'table-float-header-column' : 'table-float-header-row', 24)
    const merge = buttons.get('merge-cell')
    merge.title = state.canSplitCell ? '拆分单元格' : '合并单元格'
    merge.setAttribute('aria-label', merge.title)
    merge.disabled = !(state.canSplitCell || (state.canMergeCell ?? state.cellSelection))
    merge.setAttribute('aria-pressed', String(!!state.canSplitCell))
    merge.classList.toggle('is-active', !!state.canSplitCell)
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
  const glyph = iconNode('table-insert-boundary', 24, 'lark-doc-table-insert-glyph')
  glyph.style.width = '22px'
  plus.appendChild(glyph)
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
    const rowLineLeft = Number.isFinite(state.rowLineLeft) ? state.rowLineLeft : 0
    setVar(el, '--lark-doc-row-line-left', `${rowLineLeft}px`)
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
      applyStyle(line, { top: `${state.rowLineTop}px`, left: `${rowLineLeft}px`, width: `${length}px`, height: '' })
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
