/**
 * 电子表格块的**栅格几何 + 数据形状 + canvas 绘制**纯函数（P5-02）。
 * 规格来源：requirements/02 §25（batch320 C / batch390–395 实测）。
 *
 * 为什么单开一个文件：块定义 `sheet.js` 要守住 < 400 行，而这里才是唯一需要
 * 「数字写对」的部分 —— 几何常量、坐标换算、滚动数学、绘制指令，全是纯函数，
 * 不依赖 Tiptap、不依赖真实 DOM（绘制只要求一个 `CanvasRenderingContext2D` 形状的
 * 对象，单测塞录音桩即可断言「画了什么」）。`02 §25 ④` 的实测值锁在本文件常量里，
 * 日后真机复测只改这一处 + `lark-doc.css` 的 `--ld-sheet-*`。
 *
 * 🔴 **实测与口径的 1px 差（刻意不凑）**：
 *   - 列边界实测 `24 / 128 / 233 / 338`，按 `24 + 105n` 得 `24 / 129 / 234 / 339`；
 *   - 行边界实测 `24 / 50 / 77`，按 `24 + 27n` 得 `24 / 51 / 78`。
 * 真机是亚像素渲染（列宽实际 ≈ 104.5、行高 ≈ 26.5），取整后才落在实测数列上。
 * 代码与断言一律以 **105 / 27** 为准 —— §25 ④ 末尾的明文口径就是「按 24/105/27 三个数画」。
 * 把 105 改成 104.5 去凑实测算术，只会让一个可读的规格数字变得没法维护。
 *
 * ⚠️ 未实测、按需兜底的三处（都在本文件标了 `⚠️`，真机补测后只改这里）：
 *   1. 单元格/列标字号 12px —— §25 ④ 的直方图只证明「有抗锯齿文字像素」，没量字号；
 *   2. 滚动条滑块最小宽度 24px —— 可拖拽下限，不是实测值；
 *   3. 悬停手柄坐标 —— §25 ⑤ 只给了尺寸 42×26 与「块左上外侧」，没给精确 x。
 */
import { utf8Bytes } from '../embed/card'

/**
 * 栅格几何（§25 ④「网格几何」表）：行号列 0→24、数据列 24→128、列标行 0→24、数据行 24→50→77。
 */
export const SHEET_GEOMETRY = Object.freeze({
  rowHeaderWidth: 24,
  columnWidth: 105,
  headerHeight: 24,
  rowHeight: 27,
})

/** 绘制层尺寸（§25 ②：`CANVAS.spreadsheet-canvas` `[579,891,344,83]`）。 */
export const SHEET_VIEWPORT = Object.freeze({ width: 344, height: 83 })

/**
 * 横向滚动条（§25 ②：`slider [603,940,324,9]`，bg `rgba(31,35,41,0.3)`，r `4.5px`）。
 *
 * `width: 324` 而不是 344：实测滚动条与块左缘齐、比画布窄 20（`603 + 324 = 927`）。
 */
export const SHEET_SCROLLBAR = Object.freeze({ width: 324, height: 9, radius: 4.5, minThumb: 24 })

/** 数据上限：管住「一份 JSON 能撑多大」，不是产品规格。 */
export const SHEET_LIMITS = Object.freeze({
  rows: 200, cols: 100, cellLength: 200, bytes: 32 * 1024, previewRows: 30,
})

export const SHEET_VERSION = 1

/** 斜杠菜单插入的默认空表：20 行 × 8 列（首屏只露出左上角，与飞书一致）。 */
export const SHEET_DEFAULT = Object.freeze({ rows: 20, cols: 8 })

/** 列标：0 → `A`、25 → `Z`、26 → `AA`（不封顶，`SHEET_LIMITS.cols` 才是闸门）。 */
export function columnLabel(index) {
  let n = Number(index)
  if (!Number.isInteger(n) || n < 0) return ''
  let label = ''
  n += 1
  while (n > 0) {
    const remainder = (n - 1) % 26
    label = String.fromCharCode(65 + remainder) + label
    n = Math.floor((n - 1) / 26)
  }
  return label
}

/** 单元格坐标键：`"<row>:<col>"`（行 0 = 第一条**数据**行，不含列标行）。 */
export function cellKey(row, col) {
  return `${row}:${col}`
}

/** 单元格文本归一：去控制字符（`no-control-regex` 不许写正则，逐个码点判）、裁到 `cellLength`、空串不占位。 */
function cellValue(value) {
  if (value === null || value === undefined) return ''
  const text = Array.from(String(value))
    .map((char) => {
      const code = char.codePointAt(0)
      return code < 0x20 || code === 0x7f ? ' ' : char
    })
    .join('')
    .trim()
  return text ? Array.from(text).slice(0, SHEET_LIMITS.cellLength).join('') : ''
}

/**
 * `cells` 两种写法都收：`{ "0:1": "x" }` 与 `[["x"]]`。
 *
 * 返回 `{ cells, rows, cols }` —— `rows` / `cols` 是**由内容推出来的最小尺寸**，
 * 最终尺寸还要与显式声明的 `rows` / `cols` 取大（见 `normalizeSheet`）。
 */
function normalizeCells(raw) {
  const cells = {}
  let rows = 0
  let cols = 0
  const put = (row, col, value) => {
    if (row >= SHEET_LIMITS.rows || col >= SHEET_LIMITS.cols) return
    rows = Math.max(rows, row + 1)
    cols = Math.max(cols, col + 1)
    const text = cellValue(value)
    if (text) cells[cellKey(row, col)] = text
  }

  if (Array.isArray(raw)) {
    raw.forEach((line, row) => {
      if (!Array.isArray(line)) return
      line.forEach((value, col) => put(row, col, value))
    })
    return { cells, rows, cols }
  }

  if (raw && typeof raw === 'object') {
    Object.keys(raw).forEach((key) => {
      const match = /^(\d+):(\d+)$/.exec(key)
      if (!match) return
      put(Number(match[1]), Number(match[2]), raw[key])
    })
  }
  return { cells, rows, cols }
}

/** 整数夹取；`fallback` 只在输入不是有限数字时生效。 */
function clampInt(value, fallback, min, max) {
  const n = Number(value)
  if (!Number.isFinite(n)) return Math.min(max, Math.max(min, fallback))
  return Math.min(max, Math.max(min, Math.round(n)))
}

/**
 * 把任意输入归一成落库形状 `{ version, rows, cols, cells }`。
 *
 * 尺寸取「显式声明」与「内容推出的最小尺寸」的**较大值**：少写一个 `rows` 不该把第 5 行
 * 的内容截掉；两者都空才落默认 20 × 8。越界（超 `SHEET_LIMITS`）的单元格直接丢弃 ——
 * 一份被裁剪的数据比一份 200 行的空表诚实。
 */
export function normalizeSheet(input) {
  const source = input && typeof input === 'object' ? input : {}
  const grid = normalizeCells(source.cells)
  const declaredRows = clampInt(source.rows, 0, 0, SHEET_LIMITS.rows)
  const declaredCols = clampInt(source.cols, 0, 0, SHEET_LIMITS.cols)
  const rows = Math.max(declaredRows, grid.rows) || SHEET_DEFAULT.rows
  const cols = Math.max(declaredCols, grid.cols) || SHEET_DEFAULT.cols
  const cells = {}
  Object.keys(grid.cells).forEach((key) => {
    const [row, col] = key.split(':').map(Number)
    if (row < rows && col < cols) cells[key] = grid.cells[key]
  })
  const sheet = { version: SHEET_VERSION, rows, cols, cells }
  if (typeof source.name === 'string') {
    const name = source.name.trim()
    if (name) sheet.name = Array.from(name).slice(0, 80).join('')
  }
  return sheet
}

/** JSON 字符串 → sheet；坏数据返回 null（调用方画占位，而不是抛错）。 */
export function readSheet(raw) {
  if (typeof raw !== 'string' || !raw) return null
  let parsed
  try { parsed = JSON.parse(raw) } catch (_) { return null }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  try { return normalizeSheet(parsed) } catch (_) { return null }
}

/** sheet → 落库 JSON 字符串；超 32 KB 抛错（由命令层转成「插入失败」）。 */
export function encodeSheet(input) {
  const json = JSON.stringify(normalizeSheet(input))
  if (utf8Bytes(json) > SHEET_LIMITS.bytes) throw new Error('电子表格数据超过 32 KB 上限')
  return json
}

/** 整表内容尺寸（含行号列与列标行）—— 滚动范围的唯一依据。 */
export function contentSize(sheet) {
  const rows = sheet ? sheet.rows : 0
  const cols = sheet ? sheet.cols : 0
  return {
    width: SHEET_GEOMETRY.rowHeaderWidth + cols * SHEET_GEOMETRY.columnWidth,
    height: SHEET_GEOMETRY.headerHeight + rows * SHEET_GEOMETRY.rowHeight,
  }
}

/** 竖线 x 坐标（含行号列右缘 24，不含画布左缘 0 —— 飞书不画笔布边框）。 */
export function columnBoundaries(sheet, offsetX = 0) {
  const list = []
  for (let i = 1; i <= (sheet ? sheet.cols : 0); i += 1) {
    list.push(SHEET_GEOMETRY.rowHeaderWidth + i * SHEET_GEOMETRY.columnWidth - offsetX)
  }
  return list
}

/** 横线 y 坐标（含列标行下缘 24）。 */
export function rowBoundaries(sheet, offsetY = 0) {
  const list = []
  for (let i = 1; i <= (sheet ? sheet.rows : 0); i += 1) {
    list.push(SHEET_GEOMETRY.headerHeight + i * SHEET_GEOMETRY.rowHeight - offsetY)
  }
  return list
}

/**
 * 与视口相交的行/列区间 `[from, to)`。
 *
 * 边界那一列只要露出 1px 就要画（飞书也是这么裁的），所以末端用 `ceil` 而不是 `floor`。
 */
export function visibleRange(sheet, offset, size, header, unit, total) {
  const from = Math.max(0, Math.floor((offset - header) / unit))
  const to = Math.min(total, Math.ceil((offset + size - header) / unit))
  return [Math.min(from, to), Math.max(from, to)]
}

export const visibleColumns = (sheet, offsetX = 0, width = SHEET_VIEWPORT.width) => visibleRange(
  sheet, offsetX, width, SHEET_GEOMETRY.rowHeaderWidth, SHEET_GEOMETRY.columnWidth, sheet ? sheet.cols : 0,
)

export const visibleRows = (sheet, offsetY = 0, height = SHEET_VIEWPORT.height) => visibleRange(
  sheet, offsetY, height, SHEET_GEOMETRY.headerHeight, SHEET_GEOMETRY.rowHeight, sheet ? sheet.rows : 0,
)

/** 单向最大滚动量（内容不够长时为 0，调用方据此决定要不要画滚动条）。 */
export function maxOffset(sheet) {
  const size = contentSize(sheet)
  return {
    x: Math.max(0, size.width - SHEET_VIEWPORT.width),
    y: Math.max(0, size.height - SHEET_VIEWPORT.height),
  }
}

export function clampOffsetX(sheet, offsetX) {
  const max = maxOffset(sheet).x
  const n = Number(offsetX)
  if (!Number.isFinite(n)) return 0
  return Math.min(max, Math.max(0, n))
}

/** 滚动条滑块 `{ left, width, visible }`：轨道 324，按「视口/内容」比例缩。 */
export function scrollThumb(sheet, offsetX = 0) {
  const max = maxOffset(sheet)
  const total = Math.max(contentSize(sheet).width, SHEET_VIEWPORT.width)
  const width = Math.max(
    SHEET_SCROLLBAR.minThumb,
    Math.round(SHEET_SCROLLBAR.width * (SHEET_VIEWPORT.width / total)),
  )
  if (!max.x) return { left: 0, width: SHEET_SCROLLBAR.width, visible: false }
  const ratio = clampOffsetX(sheet, offsetX) / max.x
  return { left: Math.round((SHEET_SCROLLBAR.width - width) * ratio), width, visible: true }
}

/** 单元格显示文本；越界或空返回 `''`（不抛错 —— 渲染路径不该被脏数据打断）。 */
export function cellText(sheet, row, col) {
  if (!sheet || !sheet.cells) return ''
  const text = sheet.cells[cellKey(row, col)]
  return typeof text === 'string' ? text : ''
}

/**
 * `renderHTML` / 导出用的静态行快照。
 *
 * 第 0 项是列标行（`['', 'A', 'B', …]`，首格为行号列的空白角），其后的每一项是
 * 一条数据行（`['1', '项目', '预算', …]`）。静态产物必须带文字 —— canvas 导不出东西，
 * 只写 `data-sheet` 的话 PDF / DOCX 里就是一块白。
 */
export function staticRows(sheet) {
  if (!sheet) return []
  const rows = Math.min(sheet.rows, SHEET_LIMITS.previewRows)
  const header = ['']
  for (let col = 0; col < sheet.cols; col += 1) header.push(columnLabel(col))
  const list = [header]
  for (let row = 0; row < rows; row += 1) {
    const line = [String(row + 1)]
    for (let col = 0; col < sheet.cols; col += 1) line.push(cellText(sheet, row, col))
    list.push(line)
  }
  return list
}

/** 单元格内文裁剪：`measure` 是注入的宽度测量函数（单测传桩，浏览器传 `ctx.measureText`）。 */
export function fitText(text, maxWidth, measure) {
  const source = typeof text === 'string' ? text : ''
  if (!source || maxWidth <= 0 || typeof measure !== 'function') return ''
  if (measure(source) <= maxWidth) return source
  const chars = Array.from(source)
  let low = 0
  let high = chars.length
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (measure(`${chars.slice(0, mid).join('')}…`) <= maxWidth) low = mid
    else high = mid - 1
  }
  return low > 0 ? `${chars.slice(0, low).join('')}…` : ''
}

/**
 * 把整块栅格画到 2D 上下文里。
 *
 * `palette` 是**已解析**的颜色表（由 NodeView 从 CSS 变量读出后传进来）：
 * `{ cell, head, grid, text, headText }`。绘制层不认识 token 名，只认识颜色 ——
 * 这样纯 Node 单测可以传假色值断言「先填底色再画线」，不必跑 getComputedStyle。
 *
 * 画布外的区域**不填**（保持透明）：§25 ④ 直方图里 37.1% 的 `alpha 0` 就是这块留白。
 */
export function paintSheet(ctx, sheet, palette, offset = {}) {
  if (!ctx || !sheet) return
  const colors = palette || {}
  const geometry = SHEET_GEOMETRY
  const offsetX = clampOffsetX(sheet, offset.x || 0)
  const offsetY = Math.max(0, Number(offset.y) || 0)
  const [firstCol, lastCol] = visibleColumns(sheet, offsetX, SHEET_VIEWPORT.width)
  const [firstRow, lastRow] = visibleRows(sheet, offsetY, SHEET_VIEWPORT.height)

  const left = geometry.rowHeaderWidth - offsetX
  const top = geometry.headerHeight - offsetY
  const gridLeft = left + firstCol * geometry.columnWidth
  const gridTop = top + firstRow * geometry.rowHeight
  const gridRight = Math.min(SHEET_VIEWPORT.width, left + lastCol * geometry.columnWidth)
  const gridBottom = Math.min(SHEET_VIEWPORT.height, top + lastRow * geometry.rowHeight)

  // ⚠️ 绘制顺序是「底 → 内容 → 表头」，表头最后画 = 天然冻结在顶上（列标行不跟着竖滚）。
  ctx.clearRect(0, 0, SHEET_VIEWPORT.width, SHEET_VIEWPORT.height)
  // 1. 单元格底色（只铺到内容边界，右侧/底部留白由 clearRect 保住）
  ctx.fillStyle = colors.cell
  ctx.fillRect(gridLeft, gridTop, Math.max(0, gridRight - gridLeft), Math.max(0, gridBottom - gridTop))
  // 2. 网格线（1px，落半像素上才不糊）
  if (colors.grid) {
    ctx.strokeStyle = colors.grid
    ctx.lineWidth = 1
    ctx.beginPath()
    columnBoundaries(sheet, offsetX).forEach((x) => {
      if (x < 0 || x > SHEET_VIEWPORT.width) return
      ctx.moveTo(Math.round(x) + 0.5, 0)
      ctx.lineTo(Math.round(x) + 0.5, SHEET_VIEWPORT.height)
    })
    rowBoundaries(sheet, offsetY).forEach((y) => {
      if (y < 0 || y > SHEET_VIEWPORT.height) return
      ctx.moveTo(0, Math.round(y) + 0.5)
      ctx.lineTo(SHEET_VIEWPORT.width, Math.round(y) + 0.5)
    })
    ctx.stroke()
  }
  // 3. 表头底（实测表头灰，§25 ④ 直方图 1.5%）：列标行贯通整幅宽、行号列贯通整幅高。
  //    放在网格线**之后**画 = 天然冻结，表头不跟着竖滚/横滚。颜色必须最后铺，
  //    否则竖线会穿过列标行（首版踩过）。
  if (colors.head) {
    ctx.fillStyle = colors.head
    const headHeight = Math.max(0, Math.min(SHEET_VIEWPORT.height, top))
    if (headHeight > 0) ctx.fillRect(0, 0, SHEET_VIEWPORT.width, headHeight)
    const headWidth = Math.max(0, Math.min(SHEET_VIEWPORT.width, left))
    if (headWidth > 0) ctx.fillRect(0, 0, headWidth, SHEET_VIEWPORT.height)
    // 表头底铺完会盖掉自己那两条边界，用网格色补回来（未逐像素实测，取「网格完整」口径）。
    if (colors.grid) {
      ctx.strokeStyle = colors.grid
      ctx.beginPath()
      if (headHeight > 0) {
        ctx.moveTo(0, Math.round(headHeight) - 0.5)
        ctx.lineTo(SHEET_VIEWPORT.width, Math.round(headHeight) - 0.5)
      }
      if (headWidth > 0) {
        ctx.moveTo(Math.round(headWidth) - 0.5, 0)
        ctx.lineTo(Math.round(headWidth) - 0.5, SHEET_VIEWPORT.height)
      }
      ctx.stroke()
    }
  }
  // 4. 文字：列标居中、行号居中、单元格文字左对齐裁剪
  if (typeof ctx.fillText !== 'function' || typeof ctx.measureText !== 'function') return
  // ⚠️ 12px 未实测（§25 ④ 只证明有文字像素，没量字号），真机补测后只改这一处。
  ctx.font = `${colors.fontSize || 12}px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif`
  ctx.textBaseline = 'middle'
  if (colors.headText) {
    ctx.fillStyle = colors.headText
    ctx.textAlign = 'center'
    for (let col = firstCol; col < lastCol; col += 1) {
      const x = left + col * geometry.columnWidth + geometry.columnWidth / 2
      if (x < 0 || x > SHEET_VIEWPORT.width) continue
      ctx.fillText(columnLabel(col), x, Math.max(0, top) / 2)
    }
    for (let row = firstRow; row < lastRow; row += 1) {
      const y = top + row * geometry.rowHeight + geometry.rowHeight / 2
      if (y < 0 || y > SHEET_VIEWPORT.height) continue
      ctx.fillText(String(row + 1), Math.max(0, left) / 2, y)
    }
  }
  if (!colors.text) return
  ctx.fillStyle = colors.text
  ctx.textAlign = 'left'
  for (let row = firstRow; row < lastRow; row += 1) {
    const y = top + row * geometry.rowHeight + geometry.rowHeight / 2
    if (y < 0 || y > SHEET_VIEWPORT.height) continue
    for (let col = firstCol; col < lastCol; col += 1) {
      const text = cellText(sheet, row, col)
      if (!text) continue
      const x = left + col * geometry.columnWidth
      const room = geometry.columnWidth - 16
      const shown = fitText(text, room, (value) => ctx.measureText(value).width)
      if (shown) ctx.fillText(shown, x + 8, y)
    }
  }
}
