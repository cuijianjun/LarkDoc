/**
 * 多维表格块 `bitable`（P5-04）—— requirements/02 §17 / 09 §5.6 / 16 §2.11。
 *
 *   - **原子块**，只存一个 `bitable` 属性（JSON 字符串，形状见 `./bitable-render.js`）。
 *     5 种视图（表格 / 看板 / 甘特图 / 画册 / 关联）是**同一份数据的投影**，所以
 *     `view` 存在数据里而不是拆成块类型 —— 拆成 5 种节点会让「切视图」变成换节点，
 *     正文里所有引用（评论锚点、块 id、协同光标）都会跟着断。
 *   - `renderHTML` **同时是导出产物**（`getHTML()` / PDF / DOCX 都走它），所以这里
 *     必须画出**真表格**（`table/th/td`）。编辑器态由 NodeView 换成 5 视图骨架
 *     （见 `../nodeviews/bitable.js`）。
 *   - 🔴 导出件一律用**表格视图**，哪怕块当前停在看板 / 甘特：投影（卡片、条形、缩略图）
 *     在分页打印里既不可读也不可检索，而 5 视图共享同一份数据，表格是它唯一的无损形态。
 *     这是与「编辑器所见 = 导出所得」的一处**有意取舍**，写在测试里避免被当成 bug 改掉。
 *
 * 🔴 与飞书的偏离（16 §2.11 已判定飞书那边 a11y = 零）：飞书的内容是 canvas 画的，
 * DOM 里连单元格文字都没有，规格因此要求「复刻若也用 canvas，必须补 `sr-only` 语义镜像」。
 * 这里直接渲染语义化 DOM，`table/th/td` 与 `role=tablist` 都是真的，不需要镜像层。
 *
 * 🔴 V1 范围（09 §5.6 定的「骨架」）：视图切换可用，**没有任何写数据的 UI**。
 * 记录 / 字段 / 视图的修改只经 `updateBitable` / `setBitableView` 两个命令，
 * 由宿主或协同写入。别在这块里「顺手补」新增记录、拖列宽、字段设置。
 */
import { Node, mergeAttributes } from '@tiptap/core'
import { BLOCK_ID_PATTERN } from '../documentOperations'
import { validateAttribute } from './shared'
import { getNodeView } from '../nodeviews/registry'
import { createBitableNodeView } from '../nodeviews/bitable'
import {
  BITABLE_LIMITS, BITABLE_VIEW_IDS, byteLength, defaultBitable, encodeBitable,
  gridRows, gridWidths, readBitable, recordCountText, viewOfCommand, withView,
} from './bitable-render'

/**
 * 判定层与块定义同源：几何常量与纯函数都在 `./bitable-render.js`，这里原样再导一次，
 * 上层只认 `registry/blocks.js` 一个入口（P0-04 硬规则 1）—— 与 sheet / poll 同款。
 */
export {
  BITABLE_GEOMETRY, BITABLE_LIMITS, BITABLE_VERSION, BITABLE_VIEWS, BITABLE_VIEW_IDS, FIELD_KINDS,
  blockHeight, byteLength, cleanText, defaultBitable, encodeBitable, fieldKind, fieldList,
  galleryItems, ganttBars, ganttScale, gridRows, gridWidths, groupField, isRelationReady,
  kanbanColumns, normalizeBitable, readBitable, recordCountText, recordList, relationHint,
  viewLabel, viewMenu, viewOf, viewOfCommand, withView,
} from './bitable-render'

/**
 * `attrs.bitable` 的合法性 = 「能解析成 bitable 对象」且「不超过 32 KB」。
 *
 * 允许 `null`（`default`）：atom 在 `create()` 时可能还没拿到数据，渲染层把 null
 * 画成占位块而不是在这里拒收（同 `safeSheet`）。
 */
const safeBitable = (value) => value === null || value === undefined
  || (typeof value === 'string' && byteLength(value) <= BITABLE_LIMITS.bytes && readBitable(value) !== null)

/**
 * 命令入参 → 视图 id。三种写法都收：
 *   - 视图 id（`kanban`）：宿主 / 块内切换用；
 *   - 斜杠命令 id（`bitableKanban`）：命令层直接把自己的 id 传进来，省一张映射表；
 *   - 其它 → `grid`。
 */
function inputView(input) {
  if (typeof input === 'string') {
    return BITABLE_VIEW_IDS.includes(input) ? input : viewOfCommand(input)
  }
  if (input && typeof input === 'object' && typeof input.view === 'string') {
    return BITABLE_VIEW_IDS.includes(input.view) ? input.view : viewOfCommand(input.view)
  }
  return 'grid'
}

/**
 * 一张能在 PDF / DOCX 里看懂的静态表：字段名为表头，每条记录一行。
 *
 * 列宽用百分比（`gridWidths`），`table-layout:fixed` 下才能跟着容器缩；
 * 固定 px 一旦宿主缩窄就溢出，而 V1 的列宽不可拖。
 */
function renderStaticTable(bitable) {
  const { header, rows } = gridRows(bitable)
  if (!header.length) return ['p', { class: 'lark-doc-bitable-empty' }, '多维表格暂无字段']
  const widths = gridWidths(bitable)
  const style = (index) => `width:${(widths[index] || 0).toFixed(4)}%`
  const thead = ['thead', {}, ['tr', {},
    ...header.map((text, index) => ['th', { style: style(index) }, text])]]
  const tbody = ['tbody', {}, ...rows.map((line) => ['tr', {},
    ...line.map((text, index) => ['td', { style: style(index) }, text || ''])])]
  return ['div', { class: 'lark-doc-bitable-static' },
    ['div', { class: 'lark-doc-bitable-name' }, bitable.name],
    ['table', { class: 'lark-doc-bitable-table' }, thead, tbody],
    ['p', { class: 'lark-doc-bitable-count' }, recordCountText(rows.length)]]
}

/** 写回：encode → `create()` 探路 → `setNodeMarkup`。`next` 是完整数据对象。 */
function writeBitable(tr, node, pos, next) {
  let bitable
  try { bitable = encodeBitable(next) } catch (_) { return false }
  const attrs = Object.assign({}, node.attrs, { bitable })
  // `setNodeMarkup` 对非法属性不报错，只让 PM 后续渲染时静默降级 —— 先 create 一遍探路。
  try { node.type.create(attrs) } catch (_) { return false }
  tr.setNodeMarkup(pos, null, attrs)
  return true
}

/** 取块：越界 pos 会让 `nodeAt` 抛 RangeError（不是返回 null），先自己挡一道。 */
function nodeAtSafe(state) {
  return (pos) => {
    if (!Number.isInteger(pos) || pos < 0 || pos > state.doc.content.size) return null
    const node = state.doc.nodeAt(pos)
    return node && node.type.name === 'bitable' ? node : null
  }
}

const Bitable = Node.create({
  name: 'bitable',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addOptions() {
    return {
      /**
       * 悬停手柄 / footer 的菜单通道：`onMenu({ blockId, pos, view })`。
       * V1 只转交、不自己开菜单 —— 编辑器不认识宿主的块菜单面板（同 sheet / poll）。
       */
      onMenu: null,
      /** 视图切换后的通知：`onChange({ blockId, view })`。宿主不接也能用。 */
      onChange: null,
    }
  },

  addAttributes() {
    return {
      bitable: {
        default: null,
        validate: validateAttribute('bitable.bitable', safeBitable),
        parseHTML: (el) => {
          const raw = el.getAttribute('data-bitable')
          return safeBitable(raw) && raw ? raw : null
        },
        rendered: false,
      },
    }
  },

  // 只认自带标记；没有 `bitable` 数据的 DOM 一律拒收，让文档层退化成 unknown-block
  // 保留原文 —— 比渲染一片空网格诚实（同 cardEmbed / webEmbed / sheet 口径）。
  parseHTML() {
    return [{
      tag: 'div[data-type="bitable"]',
      getAttrs: (el) => (safeBitable(el.getAttribute('data-bitable')) && el.getAttribute('data-bitable') ? null : false),
    }]
  },

  addCommands() {
    return {
      /**
       * 插入一块多维表格。三种入参（见 `inputView`）：
       *   - 无参 / `null` → 表格视图的默认块（4 字段 × 2 记录）；
       *   - 字符串（视图 id 或斜杠命令 id）→ 该视图的默认块；
       *   - 对象 → 原样归一（宿主导入 / 协同补丁）。
       *
       * 斜杠菜单 5 项都走这一个入口（03 §3.4 ⑤：5 项各插同一个块、带不同默认视图）。
       */
      setBitable: (input) => ({ state, commands }) => {
        // 先过写路径：超 32 KB 在这里被拒（返回 false），不会「命令说成功、正文没块」。
        let bitable
        try {
          if (input === undefined || input === null) bitable = encodeBitable(defaultBitable('grid'))
          else if (typeof input === 'string') bitable = encodeBitable(defaultBitable(inputView(input)))
          else bitable = encodeBitable(input)
        } catch (_) { return false }
        try { state.schema.nodes[this.name].create({ bitable }) } catch (_) { return false }
        return commands.insertContent({ type: this.name, attrs: { bitable } })
      },

      /**
       * 整体改写数据（宿主同步 / 协同对账 / 导入）。`pos` 是块位置。
       * 视图不会被 `patch.bitable.view` 之外的途径改动 —— 切视图走 `setBitableView`。
       */
      updateBitable: (input) => ({ state, tr }) => {
        const patch = input && typeof input === 'object' ? input : {}
        const node = nodeAtSafe(state)(patch.pos)
        if (!node) return false
        return writeBitable(tr, node, patch.pos, patch.bitable)
      },

      /**
       * 切视图 —— 块内 tab 与宿主 API 的唯一入口。
       *
       * 视图没变就返回 `false`（不产生空事务）：tab 上的重复点击不该进 undo 栈。
       */
      setBitableView: (input) => ({ state, tr }) => {
        const patch = input && typeof input === 'object' ? input : {}
        const node = nodeAtSafe(state)(patch.pos)
        if (!node) return false
        const data = readBitable((node.attrs || {}).bitable)
        if (!data) return false
        const next = inputView(patch.view)
        if (data.view === next) return false
        return writeBitable(tr, node, patch.pos, withView(data, next))
      },
    }
  },

  renderHTML({ node }) {
    const attrs = node.attrs || {}
    const bitable = readBitable(attrs.bitable)
    const wrapper = {
      class: 'lark-doc-bitable',
      'data-type': 'bitable',
      'data-block-type': 'bitable',
      contenteditable: 'false',
    }
    // 自绘 renderHTML 不会自动合入全局属性，稳定块 id 要显式带上（同 sheet / image）。
    if (typeof attrs.blockId === 'string' && BLOCK_ID_PATTERN.test(attrs.blockId)) wrapper['data-block-id'] = attrs.blockId
    if (typeof attrs.bitable === 'string' && attrs.bitable) wrapper['data-bitable'] = attrs.bitable
    // 导出侧核对用：当前停在哪一视图（导出件本身恒为表格视图，见文件头）。
    if (bitable) wrapper['data-bitable-source-view'] = bitable.view

    // 数据缺失：画占位而不是空白 —— 导出件里一块白比一句说明更难定位问题。
    if (!bitable) {
      return ['div', mergeAttributes(wrapper),
        ['p', { class: 'lark-doc-bitable-empty' }, '多维表格数据缺失']]
    }
    return ['div', mergeAttributes(wrapper), renderStaticTable(bitable)]
  },

  // NodeView 先查注册表（三端可覆盖），没有再落 core 的纯 DOM 实现。
  addNodeView() { return getNodeView('bitable') || createBitableNodeView },
})

export { Bitable }
