/**
 * 电子表格块 `sheet`（P5-02）—— requirements/02 §25。
 *
 *   - **原子块**，但内容画在 DOM 的 `<canvas>` 里（不是 iframe）：可被评论锚定、
 *     可参与协同、可随文档存 JSON。规格来自 §25 ②的 19 层 DOM 链与 §25 ④的像素直方图。
 *   - 只存**一个** `sheet` 属性（JSON 字符串，形状见 `./sheet-render.js`）。不拆
 *     `rows` / `cols` / `cells` 多个 attrs：拆开后 `rows` 与实际单元格会互相漂移，
 *     而 §25 只要求「同一份 JSON 渲染一致」。
 *   - `renderHTML` **同时是导出产物**（`getHTML()` / PDF / DOCX 都走它）。canvas 导不出
 *     任何文字，所以这里必须画出一张**真表格**；NodeView 在编辑器态把它换成 canvas
 *     （见 `../nodeviews/sheet.js`）。「编辑器所见 = 导出所得」靠这条分工保证：
 *     导出走 `renderHTML`，编辑器走 NodeView，两边同源于同一份 `staticRows()`。
 *
 * 🔴 **V1 范围不含真编辑**（§25 ⑤ 第 3 条明文）。以下一律不做，别在后续把它「顺手补上」：
 *   - 不做隐藏 input 键盘代理（§25 ⑦ 的 `#sheet_dropdown_list`）；
 *   - 不做「单击 A1 键入落 R1C0」的模糊定位（§25 ⑤ 第 2 条：飞书此处是缺陷）；
 *   - 不做 `Cmd+Z` 撤销输入（§25 ⑤ 第 1 条：飞书此处也是缺陷）。
 * 单元格只经 `updateSheet` 由宿主 / 协同写入 —— 没有「用户敲键盘」这条路径。
 */
import { Node, mergeAttributes } from '@tiptap/core'
import { BLOCK_ID_PATTERN } from '../documentOperations'
import { validateAttribute } from './shared'
import { getNodeView } from '../nodeviews/registry'
import { createSheetNodeView } from '../nodeviews/sheet'
import { utf8Bytes } from '../embed/card'
import {
  SHEET_DEFAULT, SHEET_LIMITS, encodeSheet, readSheet, staticRows,
} from './sheet-render'

/**
 * 判定层与块定义同源：几何常量与纯函数都在 `./sheet-render.js`，这里原样再导一次，
 * 上层只认 `registry/blocks.js` 一个入口（P0-04 硬规则 1）。
 */
export {
  SHEET_DEFAULT, SHEET_GEOMETRY, SHEET_LIMITS, SHEET_SCROLLBAR, SHEET_VERSION, SHEET_VIEWPORT,
  cellKey, cellText, clampOffsetX, columnBoundaries, columnLabel, contentSize, encodeSheet,
  fitText, maxOffset, normalizeSheet, paintSheet, readSheet, rowBoundaries, scrollThumb,
  staticRows, visibleColumns, visibleRows,
} from './sheet-render'

/**
 * `attrs.sheet` 的合法性 = 「能解析成 sheet 对象」且「不超过 32 KB」。
 *
 * 允许 `null`（`default`）：atom 节点在 `create()` 时可能还没拿到数据，渲染层把 null
 * 画成占位块而不是在这里拒收 —— 否则「节点建不出来」比「渲染一块占位」更难排查。
 */
const safeSheet = (value) => value === null || value === undefined
  || (typeof value === 'string' && utf8Bytes(value) <= SHEET_LIMITS.bytes && readSheet(value) !== null)

/** 静态表的单元格：`th` 用于行号列与列标行，`td` 用于数据格。 */
function staticCell(tag, text, extra) {
  return [tag, mergeAttributes(extra || {}), text || '']
}

/**
 * 一张能在 PDF / DOCX 里看懂的静态表。
 *
 * 只画 `SHEET_LIMITS.previewRows` 行 —— 200 行的空表在导出件里既没用也压垮排版；
 * 30 行足够看清「这是一张电子表格」并保留首屏数据。截断行数写进 `data-sheet-rows`
 * 供导出侧核对，不写进正文（正文里塞一句「已截断」比少几行更干扰阅读）。
 */
function renderStaticTable(sheet) {
  const rows = staticRows(sheet)
  if (!rows.length) return ['div', { class: 'lark-doc-sheet-static' }]
  const [head, ...body] = rows
  const width = 100 / Math.max(1, head.length)
  const cellStyle = `width:${width.toFixed(4)}%`
  const thead = ['thead', {}, ['tr', {},
    ...head.map((text, index) => staticCell('th', index === 0 ? '' : text, { style: cellStyle }))]]
  const tbody = ['tbody', {}, ...body.map((line) => ['tr', {},
    ...line.map((text, index) => staticCell(index === 0 ? 'th' : 'td', text, { style: cellStyle }))])]
  return ['div', { class: 'lark-doc-sheet-static', 'data-sheet-rows': String(sheet.rows) },
    ['table', { class: 'lark-doc-sheet-table' }, thead, tbody]]
}

const Sheet = Node.create({
  name: 'sheet',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addOptions() {
    return {
      /**
       * 悬停手柄（§25 ⑤）的点击通道：`onMenu({ blockId, pos })`。
       * V1 只转交、不自己开菜单 —— 编辑器不认识宿主的块菜单面板。
       * 宿主不接这个回调时，手柄仍是视觉元素（有 hover 态），点击是空操作。
       */
      onMenu: null,
      /**
       * 滚动 / 重绘后的通知：`onScroll({ blockId, offsetX })`。
       * 给宿主做「记住滚动位置」这类增强；V1 宿主不接也能用。
       */
      onScroll: null,
    }
  },

  addAttributes() {
    return {
      sheet: {
        default: null,
        validate: validateAttribute('sheet.sheet', safeSheet),
        parseHTML: (el) => {
          const raw = el.getAttribute('data-sheet')
          return safeSheet(raw) && raw ? raw : null
        },
        rendered: false,
      },
    }
  },

  // 只认自带标记；没有 `sheet` 数据的 DOM 一律拒收，让文档层退化成 unknown-block
  // 保留原文 —— 比渲染一片空网格诚实（同 cardEmbed / webEmbed 口径）。
  parseHTML() {
    return [{
      tag: 'div[data-type="sheet"]',
      getAttrs: (el) => (safeSheet(el.getAttribute('data-sheet')) && el.getAttribute('data-sheet') ? null : false),
    }]
  },

  addCommands() {
    return {
      /**
       * 插入一张电子表格。无参 = 默认空表（20 × 8，`SHEET_DEFAULT`）。
       *
       * 斜杠菜单「电子表格」与宿主 API 都走这一个入口（§25 ①：插入**无对话框**）。
       */
      setSheet: (input) => ({ state, commands }) => {
        // 先过写路径：超 32 KB / 尺寸越界在这里被拒（返回 false），
        // 不会走到「命令说成功、正文没块」。
        let sheet
        try { sheet = encodeSheet(input === undefined || input === null ? SHEET_DEFAULT : input) } catch (_) { return false }
        // `insertContent` 遇到非法属性只打 warning 然后照常返回 true，
        // 所以先 create 一遍探路（cardEmbed / webEmbed / fileBlock 同口径）。
        try { state.schema.nodes[this.name].create({ sheet }) } catch (_) { return false }
        return commands.insertContent({ type: this.name, attrs: { sheet } })
      },

      /**
       * 改写已有表格的数据（宿主同步 / 协同对账 / 粘贴导入）。
       *
       * `pos` 是块位置。校验顺序照 `setSheet`：先 encode、再 find 节点、最后 setNodeMarkup。
       * V1 没有「用户编辑单元格」路径，所以这是写入数据的**唯一**入口。
       */
      updateSheet: (input) => ({ state, tr }) => {
        const patch = input && typeof input === 'object' ? input : {}
        if (!Number.isInteger(patch.pos)) return false
        // 越界 pos 会让 `nodeAt` 抛 RangeError（不是返回 null）—— 先自己挡一道，
        // 否则宿主导入一份对不上位置的协同补丁时整个编辑器会崩。
        if (patch.pos < 0 || patch.pos > state.doc.content.size) return false
        const current = state.doc.nodeAt(patch.pos)
        if (!current || current.type.name !== this.name) return false
        let sheet
        try { sheet = encodeSheet(patch.sheet) } catch (_) { return false }
        try { state.schema.nodes[this.name].create(Object.assign({}, current.attrs, { sheet })) } catch (_) { return false }
        tr.setNodeMarkup(patch.pos, null, Object.assign({}, current.attrs, { sheet }))
        return true
      },
    }
  },

  renderHTML({ node }) {
    const attrs = node.attrs || {}
    const sheet = readSheet(attrs.sheet)
    const wrapper = {
      class: 'lark-doc-sheet',
      'data-type': 'sheet',
      'data-block-type': 'sheet',
      contenteditable: 'false',
    }
    // 自绘 renderHTML 不会自动合入全局属性，稳定块 id 要显式带上（同 image / cardEmbed）。
    if (typeof attrs.blockId === 'string' && BLOCK_ID_PATTERN.test(attrs.blockId)) wrapper['data-block-id'] = attrs.blockId
    if (typeof attrs.sheet === 'string' && attrs.sheet) wrapper['data-sheet'] = attrs.sheet

    // 数据缺失：画占位而不是空白 —— 导出件里一块白比一句说明更难定位问题。
    if (!sheet) {
      return ['div', mergeAttributes(wrapper),
        ['p', { class: 'lark-doc-sheet-empty' }, '电子表格数据缺失']]
    }
    return ['div', mergeAttributes(wrapper), renderStaticTable(sheet)]
  },

  // NodeView 先查注册表（三端可覆盖），没有再落 core 的纯 DOM 实现。
  addNodeView() { return getNodeView('sheet') || createSheetNodeView },
})

export { Sheet }
