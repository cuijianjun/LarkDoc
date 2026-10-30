// @vitest-environment jsdom
/**
 * P5-02 电子表格块 `sheet` —— requirements/02 §25。
 *
 * 三层用例对应三份实现，任一层失守都会让「同一份 JSON 渲染不一致」或
 * 「编辑器是白板、导出一片空白」漏到宿主侧：
 *   1. `core/blocks/sheet-render.js` —— 几何常量 / 归一化 / 滚动数学 / 绘制指令（纯函数，
 *      几何取 **105 / 27 / 344×83 / 324×9** 这一套唯一真值，见该文件头「1px 刻意不凑」）；
 *   2. `core/blocks/sheet.js` —— `renderHTML` **就是导出产物**，必须画成真表格；
 *   3. `core/nodeviews/sheet.js` —— 编辑器态往同一份 DOM 上叠 canvas，拿不到 2D 上下文时
 *      整套壳都不挂（降级回静态表），滚动只改本地 `offsetX` 不产生 transaction。
 *
 * jsdom 的 `canvas.getContext('2d')` 在未装 `canvas` 包时返回 null，且会往虚拟控制台打一条
 * 「Not implemented」。这里按度量：默认桩成 null（既静音又确定），要测「有上下文」的分支时
 * 换成一个**录音桩**，断言「画了什么、按什么顺序画」——`paintSheet` 的 `palette` 参数化就是
 * 为这条路铺的（它只认颜色值，不认 token 名）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { createLarkDocExtensions } from '../../src/components/lark-doc/extensions'
import {
  SHEET_DEFAULT, SHEET_GEOMETRY, SHEET_LIMITS, SHEET_SCROLLBAR, SHEET_VERSION, SHEET_VIEWPORT,
  cellKey, cellText, clampOffsetX, columnBoundaries, columnLabel, contentSize, encodeSheet,
  fitText, maxOffset, normalizeSheet, paintSheet, readSheet, rowBoundaries, scrollThumb,
  staticRows, visibleColumns, visibleRows,
} from '../../src/registry/blocks'
import { createSheetNodeView } from '../../src/core/nodeviews/sheet'

/* ------------------------------------------------------------------ *
 * 测试脚手架
 * ------------------------------------------------------------------ */

const mounted = []
const proto = window.HTMLCanvasElement.prototype
let restoreGetContext = null

beforeEach(() => {
  // jsdom 无 canvas 包：显式给 null，避免 jsdom 往虚拟控制台打 not-implemented。
  const saved = proto.getContext
  proto.getContext = () => null
  restoreGetContext = () => { proto.getContext = saved }
})

afterEach(() => {
  while (mounted.length) mounted.pop().cleanup()
  if (restoreGetContext) restoreGetContext()
  restoreGetContext = null
})

/**
 * 录音桩 2D 上下文：只记「谁被按顺序调用、当时的填充色是什么」。
 *
 * `fillStyle` 这类状态用 getter / setter 截住，于是断言能回答「这块 fillRect 是用哪个颜色
 * 填的」——`paintSheet` 的绘制顺序回归（表头底必须晚于网格线）全靠它。
 */
function createRecorder() {
  const calls = []
  const state = { fill: '', stroke: '', font: '' }
  const push = (op, args) => calls.push({ op, args, fill: state.fill, stroke: state.stroke })
  const ctx = {
    calls,
    clearRect: (...args) => push('clearRect', args),
    fillRect: (...args) => push('fillRect', args),
    beginPath: () => push('beginPath', []),
    moveTo: (...args) => push('moveTo', args),
    lineTo: (...args) => push('lineTo', args),
    stroke: () => push('stroke', []),
    fillText: (...args) => push('fillText', args),
    measureText: (text) => ({ width: Array.from(String(text)).length * 10 }),
    scale: (...args) => push('scale', args),
  }
  Object.defineProperty(ctx, 'fillStyle', { get: () => state.fill, set: (value) => { state.fill = value } })
  Object.defineProperty(ctx, 'strokeStyle', { get: () => state.stroke, set: (value) => { state.stroke = value } })
  Object.defineProperty(ctx, 'font', { get: () => state.font, set: (value) => { state.font = value } })
  ctx.lineWidth = 1
  ctx.textBaseline = ''
  ctx.textAlign = ''
  return ctx
}

/** 把录音桩装到 `HTMLCanvasElement.prototype.getContext` 上（本轮文件内生效，afterEach 还原）。 */
function useRecorder() {
  const ctx = createRecorder()
  proto.getContext = () => ctx
  return ctx
}

/** 已解析的调色板（Node 侧不跑 getComputedStyle，直接喂假色值）。 */
const palette = () => ({
  cell: '#ffffff', head: '#e8e9e9', grid: '#dedfdf', text: '#1f2329', headText: '#646a73', fontSize: 12,
})

function mountSheet(attrs, options = {}) {
  const editor = new Editor({
    extensions: createLarkDocExtensions(options),
    content: { type: 'doc', content: [{ type: 'sheet', attrs }] },
  })
  mounted.push({ cleanup: () => editor.destroy() })
  const extension = editor.extensionManager.extensions.filter((item) => item.name === 'sheet')[0]
  const nodeView = createSheetNodeView({
    editor, node: editor.state.doc.firstChild, getPos: () => 0, extension,
  })
  document.body.appendChild(nodeView.dom)
  mounted.push({
    cleanup: () => {
      nodeView.destroy()
      if (nodeView.dom.parentNode) nodeView.dom.parentNode.removeChild(nodeView.dom)
    },
  })
  return { editor, nodeView, dom: nodeView.dom }
}

function freshEditor(content) {
  const editor = new Editor({ extensions: createLarkDocExtensions({}), content })
  mounted.push({ cleanup: () => editor.destroy() })
  return editor
}

const sheetsIn = (editor) => {
  const found = []
  editor.state.doc.descendants((node) => { if (node.type.name === 'sheet') found.push(node) })
  return found
}

/* ------------------------------------------------------------------ *
 * ① 几何常量：§25 ② / ④ 的实测数字唯一落点
 * ------------------------------------------------------------------ */

describe('几何常量（§25 ② / ④）', () => {
  it('栅格 = 行号列 24 / 数据列 105 / 列标行 24 / 数据行 27', () => {
    expect(SHEET_GEOMETRY).toEqual({ rowHeaderWidth: 24, columnWidth: 105, headerHeight: 24, rowHeight: 27 })
  })

  it('画布 344 × 83，滚动条 324 × 9 / r4.5（85 = 83 + 2、344 = 346 − 2）', () => {
    expect(SHEET_VIEWPORT).toEqual({ width: 344, height: 83 })
    expect(SHEET_SCROLLBAR).toEqual({ width: 324, height: 9, radius: 4.5, minThumb: 24 })
    expect(85).toBe(SHEET_VIEWPORT.height + 2)
    expect(SHEET_SCROLLBAR.width).toBe(SHEET_VIEWPORT.width - 20)
  })

  it('列边界按 24 + 105n，不凑实测的 128 / 233 / 338', () => {
    expect(columnBoundaries({ cols: 3 })).toEqual([129, 234, 339])
    expect(columnBoundaries({ cols: 3 }, 105)).toEqual([24, 129, 234])
  })

  it('行边界按 24 + 27n，不凑实测的 50 / 77', () => {
    expect(rowBoundaries({ rows: 2 })).toEqual([51, 78])
    expect(rowBoundaries({ rows: 2 }, 27)).toEqual([24, 51])
  })

  it('整表内容尺寸含行号列与列标行', () => {
    expect(contentSize({ rows: 20, cols: 8 })).toEqual({ width: 864, height: 564 })
  })
})

/* ------------------------------------------------------------------ *
 * ② 列标 / 单元格键
 * ------------------------------------------------------------------ */

describe('columnLabel / cellKey', () => {
  it('A → Z → AA 进位', () => {
    expect(columnLabel(0)).toBe('A')
    expect(columnLabel(25)).toBe('Z')
    expect(columnLabel(26)).toBe('AA')
    expect(columnLabel(51)).toBe('AZ')
    expect(columnLabel(52)).toBe('BA')
  })

  it('负数 / 小数 / 非数字返回空串（渲染路径不抛）', () => {
    expect(columnLabel(-1)).toBe('')
    expect(columnLabel(1.5)).toBe('')
    expect(columnLabel('x')).toBe('')
    expect(columnLabel(undefined)).toBe('')
  })

  it('cellKey 是「行:列」，行 0 指第一条数据行', () => {
    expect(cellKey(0, 0)).toBe('0:0')
    expect(cellKey(3, 7)).toBe('3:7')
  })
})

/* ------------------------------------------------------------------ *
 * ③ 数据归一与编解码
 * ------------------------------------------------------------------ */

describe('normalizeSheet', () => {
  it('空输入落默认 20 × 8', () => {
    const sheet = normalizeSheet()
    expect(sheet).toEqual({ version: SHEET_VERSION, rows: 20, cols: 8, cells: {} })
    expect(normalizeSheet(SHEET_DEFAULT).rows).toBe(SHEET_DEFAULT.rows)
  })

  it('两种 cells 写法都收（对象键与二维数组）', () => {
    expect(normalizeSheet({ cells: { '0:1': 'x' } }).cells).toEqual({ '0:1': 'x' })
    expect(normalizeSheet({ cells: [['x']] }).cells).toEqual({ '0:0': 'x' })
  })

  it('尺寸取「显式声明」与「内容推出」的较大值', () => {
    // 显式写小、内容在第 5 行：不能把第 5 行截掉（曾经的实现只认 source.rows，这里就是回归点）
    const grown = normalizeSheet({ rows: 2, cols: 2, cells: { '4:0': 'deep' } })
    expect(grown.rows).toBe(5)
    expect(grown.cols).toBe(2)
    expect(grown.cells['4:0']).toBe('deep')
    // 显示写大、内容很少：保留声明尺寸（空表也要有 20 行的可滚范围）
    expect(normalizeSheet({ rows: 30, cells: { '0:0': 'x' } }).rows).toBe(30)
  })

  it('超出 SHEET_LIMITS 的单元格直接丢弃，不把表撑到上限', () => {
    const sheet = normalizeSheet({ cells: { [`${SHEET_LIMITS.rows}:0`]: 'x' } })
    expect(sheet.rows).toBe(20)
    expect(sheet.cols).toBe(8)
    expect(sheet.cells).toEqual({})
  })

  it('单元格文本去控制字符、裁到 200 字、空串不占位', () => {
    const long = '甲'.repeat(SHEET_LIMITS.cellLength + 50)
    const sheet = normalizeSheet({ cells: { '0:0': long, '0:1': '   ', '0:2': 'a\nb' } })
    expect(Array.from(sheet.cells['0:0'])).toHaveLength(SHEET_LIMITS.cellLength)
    expect(sheet.cells['0:1']).toBeUndefined()
    expect(sheet.cells['0:2']).toBe('a b')
  })

  it('name 去空白、裁到 80 字；非字符串不落库', () => {
    expect(normalizeSheet({ name: '  预算表  ' }).name).toBe('预算表')
    expect(normalizeSheet({ name: 'x'.repeat(120) }).name).toHaveLength(80)
    expect(normalizeSheet({ name: 42 }).name).toBeUndefined()
    expect(normalizeSheet({ name: '   ' }).name).toBeUndefined()
  })
})

describe('readSheet / encodeSheet', () => {
  it('encode → read 往返一致', () => {
    const source = { rows: 3, cols: 2, cells: { '0:1': '甲' }, name: '预算' }
    expect(readSheet(encodeSheet(source))).toEqual(normalizeSheet(source))
  })

  it('坏数据返回 null（调用方画占位，不抛）', () => {
    expect(readSheet('')).toBe(null)
    expect(readSheet(null)).toBe(null)
    expect(readSheet('{oops')).toBe(null)
    expect(readSheet('[]')).toBe(null)
    expect(readSheet('"text"')).toBe(null)
    expect(readSheet('123')).toBe(null)
  })

  it('超过 32 KB 抛错（命令层据此转成「插入失败」）', () => {
    const cells = {}
    for (let row = 0; row < 40; row += 1) {
      for (let col = 0; col < 20; col += 1) cells[`${row}:${col}`] = 'x'.repeat(SHEET_LIMITS.cellLength)
    }
    expect(() => encodeSheet({ rows: 40, cols: 20, cells })).toThrow(/32 KB/)
  })
})

/* ------------------------------------------------------------------ *
 * ④ 滚动数学
 * ------------------------------------------------------------------ */

describe('滚动数学', () => {
  const wide = { rows: 20, cols: 8 }

  it('最大横向偏移 = 内容宽 − 画布宽', () => {
    expect(maxOffset(wide)).toEqual({ x: 520, y: 481 })
    // 2 列不超宽：双向都 0，调用方据此藏掉滚动条
    expect(maxOffset({ rows: 2, cols: 2 })).toEqual({ x: 0, y: 0 })
    expect(maxOffset(null)).toEqual({ x: 0, y: 0 })
  })

  it('clampOffsetX 夹在 [0, max]，非数字落 0', () => {
    expect(clampOffsetX(wide, -30)).toBe(0)
    expect(clampOffsetX(wide, 9999)).toBe(520)
    expect(clampOffsetX(wide, 120)).toBe(120)
    expect(clampOffsetX(wide, 'x')).toBe(0)
    expect(clampOffsetX({ rows: 2, cols: 2 }, 100)).toBe(0)
  })

  it('滑块：超宽时按比例缩，不超宽时整条藏掉', () => {
    expect(scrollThumb(wide, 0)).toEqual({ left: 0, width: 129, visible: true })
    // 滚到底 → left = 轨道长 − 滑块长
    expect(scrollThumb(wide, 520)).toEqual({ left: 195, width: 129, visible: true })
    expect(scrollThumb(wide, 260).left).toBe(98)
    expect(scrollThumb({ rows: 2, cols: 2 }, 0)).toEqual({ left: 0, width: 324, visible: false })
  })

  it('极端宽表滑块不小于 minThumb 24', () => {
    const huge = scrollThumb({ rows: 20, cols: 100 }, 0)
    expect(huge.width).toBe(SHEET_SCROLLBAR.minThumb)
    expect(huge.visible).toBe(true)
  })

  it('可见区间：末端露出 1px 也要算进去', () => {
    expect(visibleColumns(wide, 0)).toEqual([0, 4])
    expect(visibleRows(wide, 0)).toEqual([0, 3])
    // 滚到最右：区间跟着走，且不超过总列数
    const [from, to] = visibleColumns(wide, 520)
    expect(to).toBe(8)
    expect(from).toBeGreaterThan(0)
  })
})

/* ------------------------------------------------------------------ *
 * ⑤ 导出 / 静态行
 * ------------------------------------------------------------------ */

describe('staticRows / cellText', () => {
  it('首项是列标行（首格空白角），其后每条数据行以行号开头', () => {
    const rows = staticRows({ rows: 2, cols: 2, cells: { '0:1': 'B' } })
    expect(rows).toEqual([['', 'A', 'B'], ['1', '', 'B'], ['2', '', '']])
  })

  it('最多导出 previewRows 行（200 行空表在 PDF 里既没用也压垮排版）', () => {
    expect(staticRows({ rows: 40, cols: 2 })).toHaveLength(SHEET_LIMITS.previewRows + 1)
    expect(staticRows(null)).toEqual([])
  })

  it('cellText 越界 / 空 / 脏数据都返回空串', () => {
    const sheet = normalizeSheet({ cells: { '0:0': 'x' } })
    expect(cellText(sheet, 0, 0)).toBe('x')
    expect(cellText(sheet, 9, 9)).toBe('')
    expect(cellText(null, 0, 0)).toBe('')
    expect(cellText({ cells: { '0:0': 42 } }, 0, 0)).toBe('')
  })
})

describe('fitText', () => {
  const measure = (text) => Array.from(String(text)).length * 10

  it('放得下就原样返回', () => {
    expect(fitText('abc', 40, measure)).toBe('abc')
  })

  it('放不下二分截断并以省略号收尾', () => {
    expect(fitText('abcdefgh', 40, measure)).toBe('abc…')
    expect(fitText('abcdefghij', 50, measure)).toBe('abcd…')
  })

  it('宽度不够一个字时返回空串，而不是只剩省略号', () => {
    expect(fitText('abcdefgh', 5, measure)).toBe('')
    expect(fitText('abc', 0, measure)).toBe('')
  })

  it('无文本 / 无测量函数时返回空串', () => {
    expect(fitText('', 100, measure)).toBe('')
    expect(fitText('abc', 100)).toBe('')
  })
})

/* ------------------------------------------------------------------ *
 * ⑥ 绘制：顺序与坐标
 * ------------------------------------------------------------------ */

describe('paintSheet', () => {
  const small = () => normalizeSheet({ rows: 2, cols: 2, cells: { '0:0': '甲' } })

  it('先 clearRect，再填底色，再画线', () => {
    const ctx = createRecorder()
    paintSheet(ctx, small(), palette())
    expect(ctx.calls[0].op).toBe('clearRect')
    expect(ctx.calls[0].args).toEqual([0, 0, 344, 83])
    const ops = ctx.calls.map((call) => call.op)
    const firstFill = ops.indexOf('fillRect')
    const firstStroke = ops.indexOf('stroke')
    expect(firstFill).toBeGreaterThan(0)
    expect(firstStroke).toBeGreaterThan(firstFill)
  })

  it('单元格底色只铺到内容边界，右侧 / 底部留白保持透明', () => {
    const ctx = createRecorder()
    paintSheet(ctx, small(), palette())
    const cellFill = ctx.calls.filter((call) => call.op === 'fillRect')[0]
    expect(cellFill.args).toEqual([24, 24, 210, 54])
    expect(cellFill.fill).toBe('#ffffff')
  })

  it('竖线落在半像素上（129.5 / 234.5），1px 才不糊', () => {
    const ctx = createRecorder()
    paintSheet(ctx, small(), palette())
    const verticals = ctx.calls.filter((call) => call.op === 'moveTo' && call.args[1] === 0)
    // 末位 23.5 是表头底铺完后补回来的「行号列右边界」：它贴表头内侧画（headWidth−0.5），
    // 与网格线的 +0.5 不是同一套 —— 两条都只是 1px 落点，§25 未逐像素实测，不妨碍几何。
    expect(verticals.map((call) => call.args[0])).toEqual([129.5, 234.5, 23.5])
  })

  it('表头底在网格线之后画 = 天然冻结（首版画在前面，竖线会穿过列标行）', () => {
    const ctx = createRecorder()
    paintSheet(ctx, small(), palette())
    const ops = ctx.calls.map((call) => call.op)
    const firstStroke = ops.indexOf('stroke')
    const headFillAt = ctx.calls.findIndex((call) => call.op === 'fillRect' && call.args[2] === 344 && call.args[3] === 24)
    expect(headFillAt).toBeGreaterThan(firstStroke)
    expect(ctx.calls[headFillAt].fill).toBe('#e8e9e9')
    // 行号列同样铺满整幅高（24 宽 × 83 高）
    const headColumn = ctx.calls.find((call) => call.op === 'fillRect' && call.args[2] === 24 && call.args[3] === 83)
    expect(headColumn.fill).toBe('#e8e9e9')
  })

  it('列标居中、行号居中、单元格文字左对齐且距左缘 8', () => {
    const ctx = createRecorder()
    paintSheet(ctx, small(), palette())
    const texts = ctx.calls.filter((call) => call.op === 'fillText')
    expect(texts.map((call) => call.args[0])).toEqual(['A', 'B', '1', '2', '甲'])
    expect(texts[0].args).toEqual(['A', 76.5, 12])
    // 单元格文字：x = 24 + 8
    expect(texts[4].args).toEqual(['甲', 32, 37.5])
  })

  it('调色板缺某个键就跳过对应图层，不画黑块', () => {
    const ctx = createRecorder()
    paintSheet(ctx, small(), { cell: '#ffffff' })
    const ops = ctx.calls.map((call) => call.op)
    expect(ops).not.toContain('stroke')
    expect(ops).not.toContain('fillText')
    expect(ops.filter((op) => op === 'fillRect')).toHaveLength(1)
  })

  it('无 sheet / 无上下文时静默返回', () => {
    const ctx = createRecorder()
    paintSheet(ctx, null, palette())
    expect(ctx.calls).toEqual([])
    expect(() => paintSheet(null, small(), palette())).not.toThrow()
  })
})

/* ------------------------------------------------------------------ *
 * ⑦ 块定义：renderHTML 就是导出产物
 * ------------------------------------------------------------------ */

describe('块定义 renderHTML', () => {
  it('外壳属性齐全：data-type / data-block-type / contenteditable=false', () => {
    const { dom } = mountSheet({ sheet: encodeSheet(SHEET_DEFAULT) })
    expect(dom.getAttribute('data-type')).toBe('sheet')
    expect(dom.getAttribute('data-block-type')).toBe('sheet')
    expect(dom.getAttribute('contenteditable')).toBe('false')
  })

  it('静态表结构：1 行列标（首格空白角）+ N 条数据行，行号列是 th', () => {
    const { dom } = mountSheet({ sheet: encodeSheet({ rows: 3, cols: 2, cells: { '0:1': '甲' } }) })
    const table = dom.querySelector('.lark-doc-sheet-table')
    expect(table.querySelectorAll('thead tr')).toHaveLength(1)
    expect(table.querySelectorAll('thead th')).toHaveLength(3)
    expect(table.querySelectorAll('tbody tr')).toHaveLength(3)
    const firstRow = table.querySelectorAll('tbody tr')[0]
    expect(firstRow.children).toHaveLength(3)
    expect(firstRow.children[0].tagName).toBe('TH')
    expect(firstRow.children[0].textContent).toBe('1')
    expect(firstRow.children[2].textContent).toBe('甲')
    expect(dom.querySelector('.lark-doc-sheet-static').getAttribute('data-sheet-rows')).toBe('3')
  })

  it('导出件最多 previewRows 条数据行，但 data-sheet-rows 记真实行数', () => {
    const { dom } = mountSheet({ sheet: encodeSheet({ rows: 40, cols: 2 }) })
    expect(dom.querySelectorAll('tbody tr')).toHaveLength(SHEET_LIMITS.previewRows)
    expect(dom.querySelector('.lark-doc-sheet-static').getAttribute('data-sheet-rows')).toBe('40')
  })

  it('数据缺失画占位而不是空白', () => {
    const { dom } = mountSheet({})
    expect(dom.querySelector('.lark-doc-sheet-empty').textContent).toBe('电子表格数据缺失')
    expect(dom.querySelector('.lark-doc-sheet-table')).toBe(null)
  })

  it('parseHTML 只认自带 data-sheet 的标记，裸 div 不当成表格', () => {
    const editor = freshEditor('<div data-type="sheet"></div>')
    expect(editor.state.doc.firstChild.type.name).not.toBe('sheet')
  })

  it('合法 data-sheet 能反解回块（HTML 往返）', () => {
    const json = encodeSheet({ rows: 2, cols: 2, cells: { '0:0': '甲' } })
    const editor = freshEditor(`<div data-type="sheet" data-sheet='${json}'></div>`)
    expect(editor.state.doc.firstChild.type.name).toBe('sheet')
    expect(readSheet(editor.state.doc.firstChild.attrs.sheet).cells['0:0']).toBe('甲')
  })
})

/* ------------------------------------------------------------------ *
 * ⑧ 命令层
 * ------------------------------------------------------------------ */

describe('命令 setSheet / updateSheet', () => {
  it('无参 = 默认 20 × 8 空表（插入无对话框）', () => {
    const editor = freshEditor('<p>正文</p>')
    expect(editor.commands.setSheet()).toBe(true)
    const found = sheetsIn(editor)
    expect(found).toHaveLength(1)
    const sheet = readSheet(found[0].attrs.sheet)
    expect(sheet.rows).toBe(SHEET_DEFAULT.rows)
    expect(sheet.cols).toBe(SHEET_DEFAULT.cols)
  })

  it('超 32 KB 拒插，正文里不留空块', () => {
    const editor = freshEditor('<p>正文</p>')
    const cells = {}
    for (let row = 0; row < 40; row += 1) {
      for (let col = 0; col < 20; col += 1) cells[`${row}:${col}`] = 'x'.repeat(SHEET_LIMITS.cellLength)
    }
    expect(editor.commands.setSheet({ rows: 40, cols: 20, cells })).toBe(false)
    expect(sheetsIn(editor)).toHaveLength(0)
  })

  it('updateSheet 改写数据；pos 不合法返 false', () => {
    const editor = freshEditor({ type: 'doc', content: [{ type: 'sheet', attrs: { sheet: encodeSheet(SHEET_DEFAULT) } }] })
    expect(editor.commands.updateSheet({ pos: 0, sheet: { rows: 2, cols: 2, cells: { '0:0': '甲' } } })).toBe(true)
    expect(readSheet(editor.state.doc.firstChild.attrs.sheet).cells['0:0']).toBe('甲')
    expect(editor.commands.updateSheet({ pos: 99, sheet: {} })).toBe(false)
    expect(editor.commands.updateSheet({ sheet: {} })).toBe(false)
    expect(editor.commands.updateSheet()).toBe(false)
  })
})

/* ------------------------------------------------------------------ *
 * ⑨ NodeView：两种降级与三条禁令
 * ------------------------------------------------------------------ */

describe('NodeView', () => {
  it('拿不到 2D 上下文时整套自绘壳都不挂，静态表原样可见', () => {
    const { dom, nodeView } = mountSheet({ sheet: encodeSheet(SHEET_DEFAULT) })
    expect(nodeView.context()).toBe(null)
    expect(dom.getAttribute('data-sheet-view')).toBe(null)
    expect(dom.querySelector('.lark-doc-sheet-view')).toBe(null)
    expect(dom.querySelector('.lark-doc-sheet-canvas')).toBe(null)
    // 关键：静态表不能被 CSS 藏掉（它是唯一的可见内容）
    expect(dom.querySelector('.lark-doc-sheet-static')).not.toBe(null)
    expect(dom.querySelector('.lark-doc-sheet-table')).not.toBe(null)
  })

  it('有 2D 上下文时挂 canvas 并打 data-sheet-view，静态表留在 DOM 只由 CSS 隐藏', () => {
    const ctx = useRecorder()
    const { dom, nodeView } = mountSheet({ sheet: encodeSheet(SHEET_DEFAULT) })
    expect(nodeView.context()).toBe(ctx)
    expect(dom.getAttribute('data-sheet-view')).toBe('canvas')
    expect(dom.querySelector('.lark-doc-sheet-canvas')).not.toBe(null)
    expect(dom.querySelector('.lark-doc-sheet-static')).not.toBe(null)
    // 挂载即画一帧：第一条指令是 devicePixelRatio 缩放（jsdom 下 dpr=1 → scale(1,1)），
    // 紧接着才是绘制序列。
    expect(ctx.calls[0].op).toBe('scale')
    expect(ctx.calls[0].args).toEqual([1, 1])
    expect(ctx.calls[1].op).toBe('clearRect')
    expect(ctx.calls.some((call) => call.op === 'fillRect')).toBe(true)
  })

  it('canvas 是块内唯一的 canvas（§25 ④ 警告飞书那边有两个）', () => {
    useRecorder()
    const { dom } = mountSheet({ sheet: encodeSheet(SHEET_DEFAULT) })
    expect(dom.querySelectorAll('canvas')).toHaveLength(1)
  })

  it('滚动条与手柄的可达性属性', () => {
    const { dom } = mountSheet({ sheet: encodeSheet(SHEET_DEFAULT) })
    const scroll = dom.querySelector('.lark-doc-sheet-scroll')
    const handle = dom.querySelector('.lark-doc-sheet-handle')
    expect(scroll.getAttribute('aria-hidden')).toBe('true')
    expect(handle.getAttribute('role')).toBe('button')
    expect(handle.getAttribute('tabindex')).toBe('-1')
    expect(handle.getAttribute('aria-label')).toBe('电子表格菜单')
  })

  it('默认表超宽 → 滚动条可见，滑块宽 129', () => {
    const { dom, nodeView } = mountSheet({ sheet: encodeSheet(SHEET_DEFAULT) })
    expect(nodeView.thumbBox()).toEqual({ left: 0, width: 129, visible: true })
    expect(dom.querySelector('.lark-doc-sheet-scroll').getAttribute('data-visible')).toBe('true')
  })

  it('内容不超宽 → 整条藏掉', () => {
    const { dom } = mountSheet({ sheet: encodeSheet({ rows: 2, cols: 2 }) })
    expect(dom.querySelector('.lark-doc-sheet-scroll').getAttribute('data-visible')).toBe('false')
  })

  it('滚动只改本地 offsetX，不产生 transaction（§25 ⑤ 第 3 条）', () => {
    const { editor, nodeView } = mountSheet({ sheet: encodeSheet(SHEET_DEFAULT) })
    const doc = editor.state.doc
    nodeView.scrollTo(120)
    expect(nodeView.offsetX()).toBe(120)
    expect(editor.state.doc).toBe(doc)
  })

  it('offsetX 按内容宽度 clamp', () => {
    const { nodeView } = mountSheet({ sheet: encodeSheet(SHEET_DEFAULT) })
    nodeView.scrollTo(9999)
    expect(nodeView.offsetX()).toBe(maxOffset(SHEET_DEFAULT).x)
    nodeView.scrollTo(-10)
    expect(nodeView.offsetX()).toBe(0)
  })

  it('update：数据没变返 true 且保留滚动位置', () => {
    const { editor, nodeView } = mountSheet({ sheet: encodeSheet(SHEET_DEFAULT) })
    nodeView.scrollTo(200)
    expect(nodeView.update(editor.state.doc.firstChild)).toBe(true)
    expect(nodeView.offsetX()).toBe(200)
  })

  it('update：数据变了原地重画，并把 offsetX 收到新范围里', () => {
    const { editor, nodeView } = mountSheet({ sheet: encodeSheet(SHEET_DEFAULT) })
    nodeView.scrollTo(200)
    const next = editor.schema.nodes.sheet.create({ sheet: encodeSheet({ rows: 2, cols: 2 }) })
    expect(nodeView.update(next)).toBe(true)
    expect(nodeView.sheet().rows).toBe(2)
    expect(nodeView.offsetX()).toBe(0)
  })

  it('update 收到别的节点类型返 false（PM 会重建 NodeView）', () => {
    const { editor, nodeView } = mountSheet({ sheet: encodeSheet(SHEET_DEFAULT) })
    const paragraph = editor.schema.nodes.paragraph.create()
    expect(nodeView.update(paragraph)).toBe(false)
    expect(nodeView.update(null)).toBe(false)
  })

  it('destroy 之后 update 返 false，拖动监听一并清掉', () => {
    const { editor, nodeView } = mountSheet({ sheet: encodeSheet(SHEET_DEFAULT) })
    nodeView.destroy()
    expect(nodeView.update(editor.state.doc.firstChild)).toBe(false)
  })

  it('stopEvent 只拦滚动条与手柄，canvas 上的点击留给 PM 选中块', () => {
    useRecorder()
    const { dom, nodeView } = mountSheet({ sheet: encodeSheet(SHEET_DEFAULT) })
    expect(nodeView.stopEvent({ target: dom.querySelector('.lark-doc-sheet-scroll') })).toBe(true)
    expect(nodeView.stopEvent({ target: dom.querySelector('.lark-doc-sheet-handle') })).toBe(true)
    expect(nodeView.stopEvent({ target: dom.querySelector('.lark-doc-sheet-canvas') })).toBe(false)
    expect(nodeView.stopEvent({ target: dom })).toBe(false)
    expect(nodeView.stopEvent(null)).toBe(false)
  })

  it('选中态走 is-selected（与 file-block / web-embed 同款）', () => {
    const { dom, nodeView } = mountSheet({ sheet: encodeSheet(SHEET_DEFAULT) })
    nodeView.selectNode()
    expect(dom.classList.contains('is-selected')).toBe(true)
    nodeView.deselectNode()
    expect(dom.classList.contains('is-selected')).toBe(false)
  })

  it('ignoreMutation 恒 true（自绘 DOM 的变化全是噪音）', () => {
    const { nodeView } = mountSheet({ sheet: encodeSheet(SHEET_DEFAULT) })
    expect(nodeView.ignoreMutation()).toBe(true)
  })

  it('手柄点击只转交宿主，不自作主张开菜单', () => {
    const calls = []
    const { dom } = mountSheet(
      { sheet: encodeSheet(SHEET_DEFAULT), blockId: 'blk_sheet_1' },
      { onSheetMenu: (payload) => calls.push(payload) },
    )
    dom.querySelector('.lark-doc-sheet-handle').click()
    expect(calls).toEqual([{ blockId: 'blk_sheet_1', pos: 0 }])
  })

  it('宿主不接 onMenu 时点击是空操作（同飞书留白口径）', () => {
    const { dom } = mountSheet({ sheet: encodeSheet(SHEET_DEFAULT) })
    expect(() => dom.querySelector('.lark-doc-sheet-handle').click()).not.toThrow()
  })

  it('滚动通知宿主，回调抛错不带崩编辑器', () => {
    const events = []
    const { nodeView } = mountSheet(
      { sheet: encodeSheet(SHEET_DEFAULT) },
      { onSheetScroll: (payload) => { events.push(payload); throw new Error('宿主炸了') } },
    )
    expect(() => nodeView.scrollTo(100)).not.toThrow()
    expect(events).toEqual([{ blockId: null, offsetX: 100 }])
  })
})
