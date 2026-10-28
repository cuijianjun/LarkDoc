/**
 * 多维表格块 NodeView（P5-04）—— 纯 DOM，core 零 UI 框架依赖。
 * 规格：requirements/02 §17（块壳 + 5 视图）/ 09 §5.6（骨架口径）/ 16 §2.11（a11y 判定）。
 *
 * 五条设计要点：
 *
 *   1. **根节点来自 `renderHTML`**（`DOMSerializer.fromSchema().serializeNode`），拿到的是
 *      那张**静态表格** —— 也就是导出产物本身。然后**整棵子树清空重建**成 5 视图骨架。
 *      与 sheet 不同（sheet 保留静态表靠 CSS 隐藏）：bitable 的编辑器态结构与导出表格
 *      完全不是一回事（卡片 / 条形 / 缩略图），留着那张表只会让屏幕阅读器把同一批数据
 *      读两遍 —— 而这正是 16 §2.11 抱怨飞书「a11y = 零」的反面。
 *   2. **视图是数据的投影，不是块的类型**：切 tab = 改 `attrs.bitable.view`（走
 *      `setBitableView`），不换节点。所以块 id、评论锚点、协同光标在切视图时全部不变。
 *   3. **零写数据 UI**（09 §5.6 的「骨架」口径）：这块里没有新增记录 / 改单元格 /
 *      拖列宽的入口。数据只经 `updateBitable` 写入，见 `../blocks/bitable.js`。
 *   4. **颜色全部走 token**：`--ld-bitable-*` 由 `lark-doc.css` 定义，这里只写类名。
 *      `check-theme-tokens.js` 会拦 JS 里的字面量色值。
 *   5. **Tab 序是真的**：`role=tablist` + 5 个 `role=tab`，左右方向键 / Home / End 移动
 *      `tabindex` 并即时切视图。飞书那边整块是 canvas（16 §2.11），键盘进不去 ——
 *      这里是「不复刻飞书反而能白赚」的第二处（第一处是纯 DOM 的语义镜像不需要补）。
 */

import { DOMSerializer } from '@tiptap/pm/model'
import {
  galleryItems, ganttBars, ganttScale, gridRows, gridWidths, isRelationReady,
  kanbanColumns, readBitable, recordCountText, relationHint, viewLabel, viewMenu,
} from '../blocks/bitable-render'

function createElement(tag, className) {
  const element = document.createElement(tag)
  if (className) element.className = className
  return element
}

/** 只在值真的变了才写（同 poll）。 */
function setText(element, text) {
  const next = String(text === undefined || text === null ? '' : text)
  if (element.textContent !== next) element.textContent = next
}

function setToggle(element, className, on) {
  if (element.classList.contains(className) !== Boolean(on)) element.classList.toggle(className, Boolean(on))
}

/** 空态提示：5 个视图共用一句话的位置，别每处各写一份。 */
function emptyNote(text) {
  const note = createElement('p', 'lark-doc-bitable-empty')
  note.textContent = text
  return note
}

function cardTitle(text) {
  const title = createElement('div', 'lark-doc-bitable-card-title')
  title.textContent = text
  return title
}

function cardMeta(text) {
  const meta = createElement('div', 'lark-doc-bitable-card-meta')
  meta.textContent = text
  return meta
}

/* ---------- 5 个视图体（都是纯函数：数据 → DOM，不碰外部状态） ---------- */

/** 表格视图：真 `<table>` + `<colgroup>` 百分比列宽。 */
function gridBody(bitable) {
  const box = createElement('div', 'lark-doc-bitable-grid')
  const { header, rows } = gridRows(bitable)
  if (!header.length) {
    box.appendChild(emptyNote('暂无字段'))
    return box
  }
  const table = createElement('table', 'lark-doc-bitable-grid-table')
  const colgroup = createElement('colgroup')
  gridWidths(bitable).forEach((width) => {
    const col = createElement('col')
    col.style.width = `${width.toFixed(4)}%`
    colgroup.appendChild(col)
  })
  table.appendChild(colgroup)

  const thead = createElement('thead')
  const headRow = createElement('tr')
  header.forEach((text) => {
    const th = createElement('th')
    th.setAttribute('scope', 'col')
    th.textContent = text
    headRow.appendChild(th)
  })
  thead.appendChild(headRow)
  table.appendChild(thead)

  const tbody = createElement('tbody')
  rows.forEach((line) => {
    const row = createElement('tr')
    line.forEach((text) => {
      const cell = createElement('td')
      cell.textContent = text || ''
      row.appendChild(cell)
    })
    tbody.appendChild(row)
  })
  table.appendChild(tbody)
  box.appendChild(table)
  if (!rows.length) box.appendChild(emptyNote('暂无记录'))
  return box
}

/** 看板视图：按 `select` 字段分列，列序 = 首次出现顺序（`kanbanColumns` 已定）。 */
function kanbanBody(bitable) {
  const box = createElement('div', 'lark-doc-bitable-kanban')
  const columns = kanbanColumns(bitable)
  if (!columns.length) {
    box.appendChild(emptyNote('暂无记录'))
    return box
  }
  columns.forEach((column) => {
    const col = createElement('div', 'lark-doc-bitable-kanban-column')
    const head = createElement('div', 'lark-doc-bitable-kanban-head')
    const label = createElement('span', 'lark-doc-bitable-kanban-label')
    label.textContent = column.label
    const count = createElement('span', 'lark-doc-bitable-kanban-count')
    count.textContent = String(column.cards.length)
    head.appendChild(label)
    head.appendChild(count)
    const list = createElement('div', 'lark-doc-bitable-kanban-list')
    column.cards.forEach((card) => {
      const item = createElement('div', 'lark-doc-bitable-kanban-card')
      item.setAttribute('data-record', card.id)
      item.appendChild(cardTitle(card.title))
      if (card.meta) item.appendChild(cardMeta(card.meta))
      list.appendChild(item)
    })
    col.appendChild(head)
    col.appendChild(list)
    box.appendChild(col)
  })
  return box
}

/** 甘特视图：左字段列 + 右侧 14 天时间轴。条长只是骨架示意（见 `ganttBars` 注释）。 */
function ganttBody(bitable) {
  const box = createElement('div', 'lark-doc-bitable-gantt')
  const bars = ganttBars(bitable)
  if (!bars.length) {
    box.appendChild(emptyNote('暂无记录'))
    return box
  }
  const head = createElement('div', 'lark-doc-bitable-gantt-head')
  const headLabel = createElement('div', 'lark-doc-bitable-gantt-label')
  headLabel.textContent = '任务'
  const ticks = createElement('div', 'lark-doc-bitable-gantt-ticks')
  ganttScale().forEach((day) => {
    const tick = createElement('span', 'lark-doc-bitable-gantt-tick')
    tick.textContent = day
    ticks.appendChild(tick)
  })
  head.appendChild(headLabel)
  head.appendChild(ticks)
  box.appendChild(head)

  bars.forEach((bar) => {
    const row = createElement('div', 'lark-doc-bitable-gantt-row')
    row.setAttribute('data-record', bar.id)
    const label = createElement('div', 'lark-doc-bitable-gantt-label')
    label.textContent = bar.label
    const track = createElement('div', 'lark-doc-bitable-gantt-track')
    const block = createElement('div', 'lark-doc-bitable-gantt-bar')
    block.style.left = `${bar.left}%`
    block.style.width = `${bar.width}%`
    track.appendChild(block)
    row.appendChild(label)
    row.appendChild(track)
    box.appendChild(row)
  })
  return box
}

/** 画册视图：160×132 卡片；封面用标题首字符当字母块（V1 没有附件字段）。 */
function galleryBody(bitable) {
  const box = createElement('div', 'lark-doc-bitable-gallery')
  const items = galleryItems(bitable)
  if (!items.length) {
    box.appendChild(emptyNote('暂无记录'))
    return box
  }
  items.forEach((item) => {
    const card = createElement('div', 'lark-doc-bitable-gallery-card')
    card.setAttribute('data-record', item.id)
    const cover = createElement('div', 'lark-doc-bitable-gallery-cover')
    // 装饰性文字不进可访问性树：标题本身就在下面一行。
    cover.setAttribute('aria-hidden', 'true')
    cover.textContent = Array.from(item.title)[0] || ''
    card.appendChild(cover)
    card.appendChild(cardTitle(item.title))
    if (item.meta) card.appendChild(cardMeta(item.meta))
    box.appendChild(card)
  })
  return box
}

/** 关联视图：V1 一律未绑定（`reference` 为空），画置灰卡 + 降级文案。 */
function relationBody(bitable) {
  const box = createElement('div', 'lark-doc-bitable-relation')
  box.setAttribute('data-ready', isRelationReady(bitable) ? 'true' : 'false')
  const icon = createElement('span', 'lark-doc-bitable-relation-icon')
  icon.setAttribute('aria-hidden', 'true')
  icon.textContent = '⇄'
  const hint = createElement('p', 'lark-doc-bitable-relation-hint')
  hint.textContent = relationHint(bitable)
  box.appendChild(icon)
  box.appendChild(hint)
  return box
}

const BODY_BUILDERS = {
  grid: gridBody, kanban: kanbanBody, gantt: ganttBody, gallery: galleryBody, relation: relationBody,
}

/** 方向键 / Home / End 在 tab 之间移动（WAI-ARIA tablist 的键盘惯例）。 */
const NAV_KEYS = ['ArrowLeft', 'ArrowRight', 'Home', 'End']

export function createBitableNodeView(props) {
  const { node, extension, getPos } = props
  const options = (extension && extension.options) || {}
  const editor = props.editor || null

  let currentNode = node
  let serializer = null
  let destroyed = false

  /* ---------- 数据通道 ---------- */

  const current = () => readBitable((currentNode.attrs || {}).bitable) || readBitable('{}')
  const blockId = () => (currentNode.attrs || {}).blockId || null

  function currentPos() {
    if (typeof getPos !== 'function') return null
    try {
      const pos = getPos()
      return Number.isInteger(pos) ? pos : null
    } catch (_) {
      // 节点已被删掉时 getPos 会抛 —— 吞掉，调用方按失败处理。
      return null
    }
  }

  /** 切视图：只改文档数据，视图体由 PM 回调 `update()` 后重画（单一数据源）。 */
  function commitView(view) {
    const commands = editor && editor.commands ? editor.commands : null
    if (!commands || typeof commands.setBitableView !== 'function') return false
    const pos = currentPos()
    if (pos === null) return false
    let ok = false
    try { ok = commands.setBitableView({ pos, view }) === true } catch (_) { return false }
    if (ok && typeof options.onChange === 'function') {
      try { options.onChange({ blockId: blockId(), view }) } catch (_) {
        // 宿主回调抛错不该把编辑器带崩：切视图是纯展示行为。
      }
    }
    return ok
  }

  /* ---------- 序列化底子 ---------- */

  const dom = (() => {
    if (!serializer) serializer = DOMSerializer.fromSchema(currentNode.type.schema)
    const rendered = serializer.serializeNode(currentNode)
    return rendered && rendered.nodeType === 1 ? rendered : createElement('div', 'lark-doc-bitable')
  })()

  /* ---------- DOM 骨架：工具栏 / 视图体 / footer ---------- */

  const toolbar = createElement('div', 'lark-doc-bitable-toolbar')
  const tabs = createElement('div', 'lark-doc-bitable-tabs')
  tabs.setAttribute('role', 'tablist')
  tabs.setAttribute('aria-label', '多维表格视图')
  const tabMap = new Map()
  viewMenu().forEach((item) => {
    const tab = createElement('button', 'lark-doc-bitable-tab')
    tab.type = 'button'
    tab.setAttribute('role', 'tab')
    tab.setAttribute('data-view', item.id)
    tab.textContent = item.label
    tabMap.set(item.id, tab)
    tabs.appendChild(tab)
  })
  toolbar.appendChild(tabs)

  // 「更多」只转交宿主（V1 没有块内菜单面板，同 sheet 的悬停手柄口径）。
  const more = createElement('button', 'lark-doc-bitable-more')
  more.type = 'button'
  more.setAttribute('aria-label', '多维表格菜单')
  more.textContent = '⋯'
  toolbar.appendChild(more)

  const body = createElement('div', 'lark-doc-bitable-view')
  const footer = createElement('div', 'lark-doc-bitable-footer')
  const count = createElement('span', 'lark-doc-bitable-count')
  const viewName = createElement('span', 'lark-doc-bitable-view-name')
  footer.appendChild(count)
  footer.appendChild(viewName)

  // 静态表整棵清掉：编辑器态的结构与导出件不同（见文件头第 1 条）。
  dom.textContent = ''
  dom.appendChild(toolbar)
  dom.appendChild(body)
  dom.appendChild(footer)
  dom.setAttribute('data-bitable-mode', 'editor')

  /* ---------- 绘制 ---------- */

  /** 视图体的重建键：视图 id + 整份数据。数据没动就不重建 DOM。 */
  let bodyKey = ''

  function paint() {
    if (destroyed) return
    const data = current()
    const active = data.view
    dom.setAttribute('data-view', active)

    for (const [id, tab] of tabMap.entries()) {
      const on = id === active
      setToggle(tab, 'is-active', on)
      tab.setAttribute('aria-selected', on ? 'true' : 'false')
      // 只有当前 tab 可 Tab 到（ARIA tablist 惯例），其余靠方向键。
      tab.tabIndex = on ? 0 : -1
    }

    const nextKey = `${active}|${JSON.stringify(data)}`
    if (nextKey !== bodyKey) {
      bodyKey = nextKey
      body.textContent = ''
      body.setAttribute('data-view', active)
      const build = BODY_BUILDERS[active] || gridBody
      body.appendChild(build(data))
    }

    setText(count, recordCountText(data.records.length))
    setText(viewName, viewLabel(active))
  }

  /* ---------- 交互 ---------- */

  function tabOf(target) {
    return target && typeof target.closest === 'function' ? target.closest('.lark-doc-bitable-tab') : null
  }

  function onTabsClick(event) {
    const tab = tabOf(event && event.target)
    if (!tab) return
    const view = tab.getAttribute('data-view')
    if (view) commitView(view)
  }

  function onTabsKeyDown(event) {
    if (!event || NAV_KEYS.indexOf(event.key) === -1) return
    if (!tabOf(event.target)) return
    const ids = viewMenu().map((item) => item.id)
    const index = ids.indexOf(current().view)
    const from = index < 0 ? 0 : index
    let next = from
    if (event.key === 'ArrowLeft') next = (from + ids.length - 1) % ids.length
    else if (event.key === 'ArrowRight') next = (from + 1) % ids.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = ids.length - 1
    if (typeof event.preventDefault === 'function') event.preventDefault()
    // 别让方向键冒到 PM 的 keymap 上（那会把光标移出块）。
    if (typeof event.stopPropagation === 'function') event.stopPropagation()
    const target = ids[next]
    if (commitView(target)) {
      const tab = tabMap.get(target)
      if (tab && typeof tab.focus === 'function') tab.focus()
    }
  }

  function onMoreClick() {
    if (destroyed || typeof options.onMenu !== 'function') return
    try { options.onMenu({ blockId: blockId(), pos: currentPos(), view: current().view }) } catch (_) {
      // 宿主是唯一执行方。
    }
  }

  tabs.addEventListener('click', onTabsClick)
  tabs.addEventListener('keydown', onTabsKeyDown)
  more.addEventListener('click', onMoreClick)

  paint()

  return {
    dom,

    update(nextNode) {
      if (destroyed) return false
      if (!nextNode || !nextNode.type || nextNode.type.name !== 'bitable') return false
      const previous = currentNode.attrs || {}
      const next = nextNode.attrs || {}
      // 只有 bitable 与 blockId 参与渲染；两者都没动就不必碰 DOM（属性对象可能是新的）。
      const unchanged = (previous.bitable || null) === (next.bitable || null)
        && (previous.blockId || null) === (next.blockId || null)
      currentNode = nextNode
      if (unchanged) return true
      paint()
      return true
    },

    /**
     * 只拦工具栏（tab 与「更多」），不拦整块。
     *
     * 拦整块会让 `mousedown` 被吃掉，块就选不中了；视图体是纯展示，点击必须留给 PM
     * （用户要能选中块、用方向键跳走）。`contenteditable="false"` 的阻断由 `dom` 自负。
     */
    stopEvent(event) {
      const target = event && event.target
      if (!target || typeof target.closest !== 'function') return false
      return Boolean(target.closest('.lark-doc-bitable-tab') || target.closest('.lark-doc-bitable-more'))
    },

    /** 整棵子树都是自绘的，PM 看到的 DOM 变化全是噪音。 */
    ignoreMutation() { return true },

    // 选中态走 `is-selected`（file-block / web-embed / sheet / poll 同款）。
    selectNode() { if (!destroyed) dom.classList.add('is-selected') },
    deselectNode() { if (!destroyed) dom.classList.remove('is-selected') },

    destroy() {
      destroyed = true
      serializer = null
    },

    /* ---------- 测试与宿主联调通道 ---------- */

    /** 当前数据（归一化后的对象，不是字符串）。 */
    bitable: current,
    /** 当前视图 id。 */
    view: () => current().view,
    /** 视图体容器（`data-view` 上是当前视图）。 */
    body: () => body,
    /** tab 元素表（顺序 = `viewMenu()`）。 */
    tabs: () => Array.from(tabMap.values()),
    /** 当前可见的视图体子节点（一般只有一个）。 */
    viewDom: () => body.firstChild,
    /** 直接切视图（测试用，绕过 DOM 事件）。 */
    commitView,
  }
}

export default createBitableNodeView
