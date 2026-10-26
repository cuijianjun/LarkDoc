// @vitest-environment jsdom
/**
 * P5-04 多维表格块 `bitable` —— requirements/02 §17（块壳 + 5 视图）、09 §5.6（骨架口径）、
 * 16 §2.11（飞书侧 a11y = 零，本实现用语义化 DOM 偏离）、03 §3.4 ⑤（斜杠 5 项）。
 *
 * 四层用例对应四份实现：
 *   1. `core/blocks/bitable-render.js` —— 几何 / 归一化 / 编解码 / 5 视图投影（纯函数）。
 *      这一层是 `BITABLE_GEOMETRY` 与 `blockHeight()` 的唯一落点，CSS 与 NodeView 都只是照它画。
 *   2. `core/blocks/bitable.js` —— `renderHTML` **就是导出产物**：任何视图状态下导出的都必须是
 *      真 `table/th/td`（视图是投影，表格是唯一无损形态；见该文件头的有意取舍）。
 *   3. `core/commands/bitable.js` + `core/commands/index.js` —— 5 条命令、只有「表格」进 `+` 菜单。
 *   4. `core/nodeviews/bitable.js` —— 5 个 `role=tab` + 方向键导航 + 视图体按「视图|数据」重建。
 *
 * 与飞书的偏离是**有意的**（16 §2.11：飞书用 canvas ⇒ 表块 a11y 为零）：这里的表格、tab 都是
 * 真语义 DOM，所以断言直接查 `th/td` 与 `aria-selected`，不查 sr-only 镜像层（不存在）。
 *
 * ⚠️ `blockHeight` / `byteLength` / `cleanText` 与 poll 同名，`registry/blocks.js` 只导了 poll 那份
 * （ESM 不允许重名再导出）。要测 bitable 的几何与块高，必须直接从 `core/blocks/bitable` 取名。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { createLarkDocExtensions } from '../../src/components/lark-doc/extensions'
import { COMMANDS, commandFeatureOf, filterCommands } from '../../src/core/commands/index'
import {
  BITABLE_GEOMETRY, BITABLE_LIMITS, BITABLE_VERSION, BITABLE_VIEWS, BITABLE_VIEW_IDS, FIELD_KINDS,
  defaultBitable, encodeBitable, fieldKind, fieldList, galleryItems, ganttBars, ganttScale, gridRows,
  gridWidths, groupField, isRelationReady, kanbanColumns, normalizeBitable, readBitable,
  recordCountText, recordList, relationHint, viewLabel, viewMenu, viewOf, viewOfCommand, withView,
} from '../../src/core/blocks/bitable'
// 同名符号只能从实现文件直接取（见文件头 ⚠️）。
import { blockHeight, byteLength, cleanText } from '../../src/core/blocks/bitable'
// 注册表同源：上层唯一入口，必须与实现层是同一批引用（不是拷贝）。
import * as registry from '../../src/registry/blocks'

/* ------------------------------------------------------------------ *
 * 测试脚手架
 * ------------------------------------------------------------------ */

const mounted = []

afterEach(() => {
  while (mounted.length) mounted.pop().cleanup()
})

/**
 * 挂一块多维表格，并取回**ProseMirror 亲建的那个** NodeView 实例。
 *
 * 为什么不能旁路 `createBitableNodeView(...)` 造一份：切视图走的是「`commitView` 发事务 →
 * PM 回调 `update()` → `paint()`」，旁路实例没注册进 PM，事务照发、回调不来，
 * `view()` 就永远停在初始值 —— 那是脚手架的问题，不是实现的问题（同 poll）。
 *
 * 取实例的路径：`view.docView.descAt(0)` 拿到 `CustomNodeViewDesc`，`.spec` 就是 NodeView 对象
 * （prosemirror-view 1.42 `NodeViewDesc.create`）。
 *
 * `blockId` 真机由 `larkDocBlockId` 插件在文档变更后下发（`appendTransaction`）；这里用 `content`
 * 直接造文档不产生变更事务，所以显式给一个 —— 否则断言的是一个真机里不存在的中途状态。
 */
function mountBitable(data = null, options = {}) {
  const editor = new Editor({
    extensions: createLarkDocExtensions(options),
    content: {
      type: 'doc',
      content: [{
        type: 'bitable',
        attrs: {
          bitable: encodeBitable(data || defaultBitable()),
          blockId: 'blk_bitable_test',
        },
      }],
    },
  })
  mounted.push({ cleanup: () => editor.destroy() })
  document.body.appendChild(editor.view.dom)
  const desc = editor.view.docView.descAt(0)
  const nodeView = desc && desc.spec
  if (!nodeView || !nodeView.dom) throw new Error('bitable 块没有挂上 NodeView')
  return { editor, view: editor.view, nodeView, dom: nodeView.dom }
}

function freshEditor(content) {
  const editor = new Editor({ extensions: createLarkDocExtensions({}), content })
  mounted.push({ cleanup: () => editor.destroy() })
  return editor
}

const bitablesIn = (editor) => {
  const found = []
  editor.state.doc.descendants((node) => { if (node.type.name === 'bitable') found.push(node) })
  return found
}

const dataOf = (editor) => readBitable(bitablesIn(editor)[0].attrs.bitable)

const click = (element) => element.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))

const keyOn = (element, key) => {
  const event = new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  element.dispatchEvent(event)
  return event
}

/** 在默认块上追加记录（不改入参），用于块高 / 投影的增长断言。 */
const withRecords = (data, extra) => ({
  ...data,
  records: [...data.records, ...extra],
})

/* ------------------------------------------------------------------ *
 * ① 几何：块高的唯一落点
 * ------------------------------------------------------------------ */

describe('BITABLE_GEOMETRY（02 §17 只给「视视图而定」，这里是拼装值）', () => {
  it('外框 534 / 圆角 8 / 单元格左右内距 12', () => {
    expect(BITABLE_GEOMETRY.width).toBe(534)
    expect(BITABLE_GEOMETRY.radius).toBe(8)
    expect(BITABLE_GEOMETRY.cellPaddingX).toBe(12)
  })

  it('三件套：工具栏 40 + 字段行 32 + 记录行 34 + footer 36', () => {
    expect(BITABLE_GEOMETRY.toolbarHeight).toBe(40)
    expect(BITABLE_GEOMETRY.fieldHeight).toBe(32)
    expect(BITABLE_GEOMETRY.recordHeight).toBe(34)
    expect(BITABLE_GEOMETRY.footerHeight).toBe(36)
  })

  it('看板 168 列宽 + 12 间距 ⇒ 534 内 3 列（168×3 + 12×2 = 528）', () => {
    const geo = BITABLE_GEOMETRY
    expect(geo.kanbanColumnWidth * 3 + geo.kanbanGap * 2).toBe(528)
    expect(geo.kanbanColumnWidth * 3 + geo.kanbanGap * 2).toBeLessThan(geo.width)
  })

  it('甘特 132 左列 + 30 刻度 + 14 天窗口 / 条高 18', () => {
    expect(BITABLE_GEOMETRY.ganttLabelWidth).toBe(132)
    expect(BITABLE_GEOMETRY.ganttScaleHeight).toBe(30)
    expect(BITABLE_GEOMETRY.ganttDays).toBe(14)
    expect(BITABLE_GEOMETRY.ganttBarHeight).toBe(18)
  })

  it('画册卡 160 宽 / 封面 88 高 / 间距 12；关联置灰卡 96', () => {
    expect(BITABLE_GEOMETRY.galleryCardWidth).toBe(160)
    expect(BITABLE_GEOMETRY.galleryCoverHeight).toBe(88)
    expect(BITABLE_GEOMETRY.galleryGap).toBe(12)
    expect(BITABLE_GEOMETRY.relationHeight).toBe(96)
  })
})

describe('blockHeight = 工具栏 + 视图体 + footer（不是写死总数）', () => {
  const chrome = BITABLE_GEOMETRY.toolbarHeight + BITABLE_GEOMETRY.footerHeight

  it('chrome = 76（40 + 36）', () => {
    expect(chrome).toBe(76)
  })

  it('表格视图：76 + 32 + 记录数 × 34', () => {
    const data = defaultBitable('grid')
    expect(blockHeight('grid', data)).toBe(chrome + 32 + 2 * 34)
    const five = withRecords(data, [
      { id: 'r_3', cells: { f_name: 'a' } },
      { id: 'r_4', cells: { f_name: 'b' } },
      { id: 'r_5', cells: { f_name: 'c' } },
    ])
    expect(blockHeight('grid', five)).toBe(chrome + 32 + 5 * 34)
  })

  it('看板视图：76 + 列头 34 + 最长列卡片总高', () => {
    const data = defaultBitable('kanban')
    // 默认两条记录分属两列，各 1 张卡
    expect(blockHeight('kanban', data)).toBe(chrome + 34 + 72)
    // 同一列两张卡 ⇒ 72×2 + 8
    const stacked = withRecords(data, [{ id: 'r_3', cells: { f_name: 'c', f_status: '进行中' } }])
    expect(blockHeight('kanban', stacked)).toBe(chrome + 34 + 72 * 2 + 8)
  })

  it('甘特视图：76 + 刻度 30 + 记录数 × 34', () => {
    expect(blockHeight('gantt', defaultBitable('gantt'))).toBe(chrome + 30 + 2 * 34)
  })

  it('画册 / 关联：定高，与记录数无关', () => {
    const data = defaultBitable('gallery')
    expect(blockHeight('gallery', data)).toBe(chrome + 88 + 44)
    const many = withRecords(data, Array.from({ length: 10 }, (_, index) => ({
      id: `r_${index + 10}`, cells: { f_name: `x${index}` },
    })))
    expect(blockHeight('gallery', many)).toBe(blockHeight('gallery', data))
    expect(blockHeight('relation', data)).toBe(chrome + 96)
  })

  it('未知视图落表格（视图归一化的下游保障）', () => {
    const data = defaultBitable()
    expect(blockHeight('ghost', data)).toBe(blockHeight('grid', data))
  })
})

/* ------------------------------------------------------------------ *
 * ② 数据模型 / 归一化
 * ------------------------------------------------------------------ */

describe('defaultBitable：4 字段 × 2 记录（不是空表）', () => {
  it('字段：名称(text) / 状态(select) / 负责人(text) / 截止日期(date)', () => {
    const data = defaultBitable()
    expect(data.v).toBe(BITABLE_VERSION)
    expect(data.name).toBe('未命名多维表格')
    expect(data.view).toBe('grid')
    expect(data.fields.map((field) => [field.id, field.name, field.kind])).toEqual([
      ['f_name', '名称', 'text'],
      ['f_status', '状态', 'select'],
      ['f_owner', '负责人', 'text'],
      ['f_due', '截止日期', 'date'],
    ])
    expect(data.reference).toBeNull()
  })

  it('记录：2 条，cells 只含有值字段', () => {
    const data = defaultBitable()
    expect(data.records).toHaveLength(2)
    expect(data.records[0]).toEqual({
      id: 'r_1',
      cells: { f_name: '需求评审', f_status: '进行中', f_owner: '张明', f_due: '03-12' },
    })
    expect(data.records[1].cells.f_name).toBe('接口联调')
  })

  it('只接受视图 id：斜杠命令 id 落 grid（映射在命令层做）', () => {
    expect(defaultBitable('kanban').view).toBe('kanban')
    expect(defaultBitable('gallery').view).toBe('gallery')
    expect(defaultBitable('bitableKanban').view).toBe('grid')
    expect(defaultBitable('ghost').view).toBe('grid')
  })
})

describe('normalizeBitable 四条硬规则', () => {
  it('空入参 → 结构完整（无字段 / 无记录 / 默认名）', () => {
    const data = normalizeBitable(null)
    expect(data).toEqual({
      v: BITABLE_VERSION,
      name: '未命名多维表格',
      view: 'grid',
      fields: [],
      records: [],
      reference: null,
    })
  })

  it('①字段 / 记录都裁到上限', () => {
    const fields = Array.from({ length: BITABLE_LIMITS.fields + 5 }, (_, index) => ({
      id: `f_${index + 1}`, name: `列${index + 1}`, kind: 'text',
    }))
    const records = Array.from({ length: BITABLE_LIMITS.records + 5 }, (_, index) => ({
      id: `r_${index + 1}`, cells: {},
    }))
    const data = normalizeBitable({ fields, records })
    expect(data.fields).toHaveLength(BITABLE_LIMITS.fields)
    expect(data.records).toHaveLength(BITABLE_LIMITS.records)
    expect(BITABLE_LIMITS.fields).toBe(20)
    expect(BITABLE_LIMITS.records).toBe(100)
  })

  it('②字段 id 撞车就地补序号，否则 cells 会串列', () => {
    const data = normalizeBitable({
      fields: [
        { id: 'f_1', name: 'a' },
        { id: 'f_1', name: 'b' },
        { id: 'f_1', name: 'c' },
      ],
    })
    expect(data.fields.map((field) => field.id)).toEqual(['f_1', 'f_1_2', 'f_1_3'])
    expect(new Set(data.fields.map((field) => field.id)).size).toBe(3)
  })

  it('②缺 id 用序号兜底；空名用「字段 N」兜底', () => {
    const data = normalizeBitable({ fields: [{}, { id: '  ', name: '  ' }] })
    expect(data.fields.map((field) => field.id)).toEqual(['f_1', 'f_2'])
    expect(data.fields.map((field) => field.name)).toEqual(['字段 1', '字段 2'])
  })

  it('③记录里指向不存在字段的键直接丢弃（不留渲染不出也删不掉的孤儿）', () => {
    const data = normalizeBitable({
      fields: [{ id: 'f_name', name: '名称', kind: 'text' }],
      records: [{ id: 'r_1', cells: { f_name: '有值', f_ghost: '孤儿' } }],
    })
    expect(data.records[0].cells).toEqual({ f_name: '有值' })
    expect('f_ghost' in data.records[0].cells).toBe(false)
  })

  it('③空单元格不落库（cells 只存有值的键）', () => {
    const data = normalizeBitable({
      fields: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
      records: [{ cells: { a: 'x', b: '   ' } }],
    })
    expect(data.records[0].cells).toEqual({ a: 'x' })
  })

  it('④reference 只认 appToken / tableId / viewId 三个字符串', () => {
    const data = normalizeBitable({ reference: { appToken: 'app', tableId: 'tbl', extra: 1 } })
    expect(data.reference).toEqual({ appToken: 'app', tableId: 'tbl', viewId: '' })
    expect('extra' in data.reference).toBe(false)
    expect(normalizeBitable({ reference: '不是对象' }).reference).toBeNull()
  })

  it('名称裁到 60、视图非法落 grid、非对象入参不抛', () => {
    expect(normalizeBitable({ name: '标'.repeat(80) }).name).toHaveLength(BITABLE_LIMITS.nameLength)
    expect(normalizeBitable({ view: 'ghost' }).view).toBe('grid')
    expect(() => normalizeBitable('x')).not.toThrow()
    expect(normalizeBitable('x').fields).toEqual([])
  })
})

describe('readBitable / encodeBitable', () => {
  it('encode → read 往返等价', () => {
    const data = withRecords(defaultBitable('gantt'), [{ id: 'r_3', cells: { f_name: 'c', f_owner: '王' } }])
    expect(readBitable(encodeBitable(data))).toEqual(normalizeBitable(data))
  })

  it('读路径：空串 / null / 非 JSON / 非对象串 / 超 32 KB 一律 null', () => {
    expect(readBitable('')).toBeNull()
    expect(readBitable(null)).toBeNull()
    expect(readBitable('不是 JSON')).toBeNull()
    expect(readBitable('"字符串"')).toBeNull()
    expect(readBitable(`{"name":"${'x'.repeat(BITABLE_LIMITS.bytes)}"}`)).toBeNull()
  })

  it('没有版本号的旧数据允许，按当前版本归一化', () => {
    expect(readBitable('{}')).toEqual(normalizeBitable({}))
    expect(readBitable('{}').v).toBe(BITABLE_VERSION)
  })

  it('写路径：超过 32 KB 直接抛（命令层捕获后返回 false）', () => {
    // 20 字段 × 100 记录 × 200 字符 ≈ 400 KB，远超上限
    const fields = Array.from({ length: BITABLE_LIMITS.fields }, (_, index) => ({
      id: `f_${index + 1}`, name: `列${index + 1}`, kind: 'text',
    }))
    const records = Array.from({ length: BITABLE_LIMITS.records }, (_, index) => ({
      id: `r_${index + 1}`,
      cells: Object.fromEntries(fields.map((field) => [field.id, 'x'.repeat(BITABLE_LIMITS.cellLength)])),
    }))
    expect(() => encodeBitable({ fields, records })).toThrow(/32 KB/)
  })

  it('正常尺寸不触上限', () => {
    expect(byteLength(encodeBitable(defaultBitable()))).toBeLessThan(BITABLE_LIMITS.bytes)
  })
})

/* ------------------------------------------------------------------ *
 * ③ 视图小工具
 * ------------------------------------------------------------------ */

describe('viewOf / viewLabel / viewOfCommand / viewMenu', () => {
  it('5 个视图 id 与中文名（顺序 = 02 §17 清单）', () => {
    expect(BITABLE_VIEW_IDS).toEqual(['grid', 'kanban', 'gantt', 'gallery', 'relation'])
    expect(BITABLE_VIEWS.map((view) => view.label)).toEqual(['表格', '看板', '甘特图', '画册', '关联'])
    expect(viewMenu()).toEqual([
      { id: 'grid', label: '表格' },
      { id: 'kanban', label: '看板' },
      { id: 'gantt', label: '甘特图' },
      { id: 'gallery', label: '画册' },
      { id: 'relation', label: '关联' },
    ])
  })

  it('非法视图一律落 grid；label 也跟着回「表格」', () => {
    expect(viewOf('kanban')).toBe('kanban')
    expect(viewOf('ghost')).toBe('grid')
    expect(viewOf(undefined)).toBe('grid')
    expect(viewLabel('gantt')).toBe('甘特图')
    expect(viewLabel('ghost')).toBe('表格')
  })

  it('斜杠命令 id → 默认视图（bitableKanban → kanban）', () => {
    expect(BITABLE_VIEWS.map((view) => viewOfCommand(view.slash))).toEqual(BITABLE_VIEW_IDS)
    expect(viewOfCommand('bitable')).toBe('grid')
    expect(viewOfCommand('ghost')).toBe('grid')
  })

  it('viewOfCommand 与命令定义表的 slash 一一对上（漂移即红）', () => {
    const ids = COMMANDS.filter((item) => item.group === 'bitable').map((item) => item.id)
    expect(ids).toEqual(BITABLE_VIEWS.map((view) => view.slash))
  })

  it('withView 返回新对象、不改入参', () => {
    const source = defaultBitable()
    const snapshot = JSON.stringify(source)
    const next = withView(source, 'gallery')
    expect(next.view).toBe('gallery')
    expect(next.fields).toEqual(source.fields)
    expect(JSON.stringify(source)).toBe(snapshot)
    expect(withView(source, 'ghost').view).toBe('grid')
  })

  it('recordCountText：正数照写，其余一律 0', () => {
    expect(recordCountText(2)).toBe('2 条记录')
    expect(recordCountText(0)).toBe('0 条记录')
    expect(recordCountText(-3)).toBe('0 条记录')
    expect(recordCountText(2.5)).toBe('0 条记录')
    expect(recordCountText('x')).toBe('0 条记录')
  })

  it('fieldKind：只认四种，其余落 text', () => {
    expect(FIELD_KINDS).toEqual(['text', 'select', 'date', 'number'])
    expect(fieldKind('select')).toBe('select')
    expect(fieldKind('number')).toBe('number')
    expect(fieldKind('attachment')).toBe('text')
    expect(fieldKind(undefined)).toBe('text')
  })
})

describe('cleanText / byteLength（同源 card 的 utf8Bytes）', () => {
  it('控制字符折成空格、连续空白折叠、按码点截断', () => {
    expect(cleanText('a\u0000b')).toBe('a b')
    expect(cleanText('  多  行\n文本\t尾  ')).toBe('多 行 文本 尾')
    expect(cleanText('😀😀😀', 2)).toBe('😀😀')
    expect(cleanText(null)).toBe('')
    expect(cleanText('x'.repeat(300))).toHaveLength(BITABLE_LIMITS.cellLength)
  })

  it('字节数：ASCII 1 / 两字节 2 / 汉字 3 / emoji 4', () => {
    expect(byteLength('abc')).toBe(3)
    expect(byteLength('中')).toBe(3)
    expect(byteLength('😀')).toBe(4)
    expect(byteLength(null)).toBe(0)
  })
})

/* ------------------------------------------------------------------ *
 * ④ 5 视图投影
 * ------------------------------------------------------------------ */

describe('gridRows / gridWidths（表格视图）', () => {
  it('表头 = 字段名、行 = 记录、缺格补空串', () => {
    const data = defaultBitable()
    const { header, rows, kinds } = gridRows(data)
    expect(header).toEqual(['名称', '状态', '负责人', '截止日期'])
    expect(kinds).toEqual(['text', 'select', 'text', 'date'])
    expect(rows).toEqual([
      ['需求评审', '进行中', '张明', '03-12'],
      ['接口联调', '待开始', '李然', '03-18'],
    ])
    // 导出件的表不能有 undefined
    const sparse = normalizeBitable({
      fields: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
      records: [{ id: 'r_1', cells: { a: '只有 A' } }],
    })
    expect(gridRows(sparse).rows).toEqual([['只有 A', '']])
  })

  it('列宽百分比：首列吃 2 份，其余均分，合计 100', () => {
    expect(gridWidths(defaultBitable())).toEqual([40, 20, 20, 20])
    const two = normalizeBitable({ fields: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] })
    expect(gridWidths(two)).toEqual([66.7, 33.3])
    const one = normalizeBitable({ fields: [{ id: 'a', name: 'A' }] })
    expect(gridWidths(one)).toEqual([100])
    expect(gridWidths(normalizeBitable({}))).toEqual([])
  })

  it('🔴 列宽合计不得越 100（旧式少除一次 100 会得到 6040%）', () => {
    const sum = (data) => gridWidths(data).reduce((total, width) => total + width, 0)
    expect(sum(defaultBitable())).toBe(100)
    const two = normalizeBitable({ fields: [{ id: 'a' }, { id: 'b' }] })
    expect(sum(two)).toBe(100)
    // 20 列时四舍五入允许溢出 1% 以内，但绝不允许量级错
    const many = normalizeBitable({
      fields: Array.from({ length: BITABLE_LIMITS.fields }, (_, index) => ({ id: `f_${index}` })),
    })
    expect(sum(many)).toBeGreaterThan(99)
    expect(sum(many)).toBeLessThan(101)
  })
})

describe('groupField / kanbanColumns（看板视图）', () => {
  it('首个 select 字段优先；没有 select 才退回首字段', () => {
    expect(groupField(defaultBitable()).id).toBe('f_status')
    const noSelect = normalizeBitable({ fields: [{ id: 'a', name: 'A', kind: 'text' }] })
    expect(groupField(noSelect).id).toBe('a')
    expect(groupField(normalizeBitable({}))).toBeNull()
  })

  it('列序 = 首次出现顺序，卡片 = 标题 + 其余字段用 · 连起来', () => {
    const columns = kanbanColumns(defaultBitable())
    expect(columns.map((column) => column.id)).toEqual(['进行中', '待开始'])
    expect(columns[0].cards).toEqual([{ id: 'r_1', title: '需求评审', meta: '张明 · 03-12' }])
    expect(columns[1].cards).toEqual([{ id: 'r_2', title: '接口联调', meta: '李然 · 03-18' }])
  })

  it('空分组归入「未分组」列；同组多条进同一列', () => {
    const data = normalizeBitable({
      fields: [
        { id: 'f_name', name: '名称', kind: 'text' },
        { id: 'f_status', name: '状态', kind: 'select' },
      ],
      records: [
        { id: 'r_1', cells: { f_name: 'a', f_status: '做' } },
        { id: 'r_2', cells: { f_name: 'b', f_status: '做' } },
        { id: 'r_3', cells: { f_name: 'c' } },
      ],
    })
    const columns = kanbanColumns(data)
    expect(columns.map((column) => column.label)).toEqual(['做', '未分组'])
    expect(columns[0].cards.map((card) => card.title)).toEqual(['a', 'b'])
    // 只剩标题一个字段时 meta 是空串（不是 undefined）
    expect(columns[1].cards[0].meta).toBe('')
  })

  it('没有字段 → 空数组（不画列）', () => {
    expect(kanbanColumns(normalizeBitable({}))).toEqual([])
  })
})

describe('ganttBars / ganttScale（甘特视图）', () => {
  it('🔴 排期取 index×3 起、6 + index%3 天 —— 不是按日期算工期', () => {
    const bars = ganttBars(defaultBitable())
    expect(bars).toHaveLength(2)
    expect(bars[0]).toEqual({ id: 'r_1', label: '需求评审', left: 0, width: 42.9 })
    expect(bars[1]).toEqual({ id: 'r_2', label: '接口联调', left: 21.4, width: 50 })
    // 42.9 = 6 / 14；50 = 7 / 14
    expect(bars[0].width).toBe(Math.round((6 / 14) * 1000) / 10)
    expect(bars[1].width).toBe(Math.round((7 / 14) * 1000) / 10)
  })

  it('第 3 条起左移继续 3 天步进，条长回到 6 天', () => {
    const data = withRecords(normalizeBitable({
      fields: [{ id: 'f_name', name: '名称', kind: 'text' }],
      records: [],
    }), [
      { id: 'r_1', cells: { f_name: 'a' } },
      { id: 'r_2', cells: { f_name: 'b' } },
      { id: 'r_3', cells: { f_name: 'c' } },
    ])
    const bars = ganttBars(data)
    expect(bars.map((bar) => bar.left)).toEqual([0, 21.4, 42.9])
    expect(bars.map((bar) => bar.width)).toEqual([42.9, 50, 57.1])
  })

  it('刻度 14 格 1…14', () => {
    expect(ganttScale()).toEqual(Array.from({ length: 14 }, (_, index) => String(index + 1)))
  })

  it('无记录 → 空数组；无字段时标题兜底「未命名」', () => {
    expect(ganttBars(normalizeBitable({}))).toEqual([])
    const bare = normalizeBitable({ records: [{ id: 'r_1', cells: {} }] })
    expect(ganttBars(bare)[0].label).toBe('未命名')
  })
})

describe('galleryItems / relationHint（画册 / 关联视图）', () => {
  it('标题 = 首字段，说明 = 其余有值字段', () => {
    expect(galleryItems(defaultBitable())).toEqual([
      { id: 'r_1', title: '需求评审', meta: '进行中 · 张明 · 03-12' },
      { id: 'r_2', title: '接口联调', meta: '待开始 · 李然 · 03-18' },
    ])
  })

  it('关联视图 V1 一律未绑定：ready=false，文案说明需要 provider', () => {
    const data = defaultBitable('relation')
    expect(isRelationReady(data)).toBe(false)
    expect(relationHint(data)).toContain('尚未关联')
    // 只给 viewId 不算绑定（三个字段缺一不可）
    expect(isRelationReady({ reference: { appToken: '', tableId: 't', viewId: 'v' } })).toBe(false)
    const ready = { reference: { appToken: 'app', tableId: 'tbl', viewId: '' } }
    expect(isRelationReady(ready)).toBe(true)
    expect(relationHint(ready)).toContain('关联已生效')
  })

  it('recordList / fieldList 对畸形入参返回空数组（不抛）', () => {
    expect(recordList(null)).toEqual([])
    expect(fieldList({ fields: '不是数组' })).toEqual([])
    expect(recordList(defaultBitable())).toHaveLength(2)
  })
})

/* ------------------------------------------------------------------ *
 * ⑤ 命令层
 * ------------------------------------------------------------------ */

describe('命令表：5 条同型，只有「表格」进 + 菜单', () => {
  it('id / 顺序 / 分组 / 层级', () => {
    const defs = COMMANDS.filter((item) => item.group === 'bitable')
    expect(defs.map((item) => item.id)).toEqual([
      'bitable', 'bitableKanban', 'bitableGantt', 'bitableGallery', 'bitableRefer',
    ])
    defs.forEach((def) => {
      expect(def.category).toBe('多维表格')
      expect(def.tone).toBe('indigo')
      expect(def.tier).toBe('required')
      expect(commandFeatureOf(def.id)).toBe('insert')
    })
  })

  it('只有「表格」在 + 菜单里（其余 4 项 plus:false）', () => {
    const plus = filterCommands('', 'plus').filter((item) => item.group === 'bitable')
    expect(plus.map((item) => item.id)).toEqual(['bitable'])
    const grid = COMMANDS.find((item) => item.id === 'bitable')
    expect(grid.plusCategory).toBe('常用')
    COMMANDS.filter((item) => item.group === 'bitable' && item.id !== 'bitable')
      .forEach((def) => expect(def.plus).toBe(false))
  })

  it('斜杠可搜：中文名 / 拼音 / 组关键字', () => {
    expect(filterCommands('看板').some((item) => item.id === 'bitableKanban')).toBe(true)
    expect(filterCommands('gantetu').some((item) => item.id === 'bitableGantt')).toBe(true)
    expect(filterCommands('duoweibiaoge').filter((item) => item.group === 'bitable')).toHaveLength(5)
    expect(filterCommands('画册', 'plus').some((item) => item.id === 'bitableGallery')).toBe(false)
  })
})

describe('setBitable（三种入参）', () => {
  it('无参 → 表格视图默认块，带上 blockId', () => {
    const editor = freshEditor('')
    expect(editor.commands.setBitable()).toBe(true)
    const data = dataOf(editor)
    expect(data.view).toBe('grid')
    expect(data.fields).toHaveLength(4)
    expect(data.records).toHaveLength(2)
    expect(typeof bitablesIn(editor)[0].attrs.blockId).toBe('string')
  })

  it('字符串：斜杠命令 id 映射到对应视图', () => {
    const cases = [
      ['bitable', 'grid'],
      ['bitableKanban', 'kanban'],
      ['bitableGantt', 'gantt'],
      ['bitableGallery', 'gallery'],
      ['bitableRefer', 'relation'],
    ]
    cases.forEach(([input, view]) => {
      const editor = freshEditor('')
      expect(editor.commands.setBitable(input)).toBe(true)
      expect(dataOf(editor).view).toBe(view)
    })
  })

  it('字符串：直接给视图 id 也收；未知 id 落 grid', () => {
    const editor = freshEditor('')
    editor.commands.setBitable('gallery')
    expect(dataOf(editor).view).toBe('gallery')
    const other = freshEditor('')
    other.commands.setBitable('ghost')
    expect(dataOf(other).view).toBe('grid')
  })

  it('对象：原样归一（宿主 / 协同补丁入口）', () => {
    const editor = freshEditor('')
    expect(editor.commands.setBitable({
      view: 'kanban',
      name: '我自己的表',
      fields: [{ id: 'a', name: 'A', kind: 'number' }],
      records: [{ id: 'r_1', cells: { a: '1' } }],
    })).toBe(true)
    const data = dataOf(editor)
    expect(data.view).toBe('kanban')
    expect(data.name).toBe('我自己的表')
    expect(data.fields[0].kind).toBe('number')
  })
})

describe('updateBitable / setBitableView', () => {
  it('updateBitable 改写数据（含视图）', () => {
    const editor = freshEditor('')
    editor.commands.setBitable()
    const next = { ...dataOf(editor), name: '改过', view: 'gallery' }
    expect(editor.commands.updateBitable({ pos: 0, bitable: next })).toBe(true)
    expect(dataOf(editor).name).toBe('改过')
    expect(dataOf(editor).view).toBe('gallery')
  })

  it('updateBitable 越界 / pos 非法 / 位置不是多维表格 → false（不抛）', () => {
    const editor = freshEditor('')
    editor.commands.setBitable()
    expect(editor.commands.updateBitable({ pos: 99, bitable: defaultBitable() })).toBe(false)
    expect(editor.commands.updateBitable({ pos: -1, bitable: defaultBitable() })).toBe(false)
    expect(editor.commands.updateBitable({ pos: '0', bitable: defaultBitable() })).toBe(false)
    expect(editor.commands.updateBitable({ bitable: defaultBitable() })).toBe(false)
    expect(editor.commands.updateBitable(null)).toBe(false)
    // 指向文档末尾（不是块起点）也要拒
    expect(editor.commands.updateBitable({
      pos: editor.state.doc.content.size, bitable: defaultBitable(),
    })).toBe(false)
  })

  it('数据超 32 KB → false，且文档没被改（不留半成功状态）', () => {
    const editor = freshEditor('')
    editor.commands.setBitable()
    const before = dataOf(editor).name
    const huge = {
      name: before,
      fields: Array.from({ length: BITABLE_LIMITS.fields }, (_, index) => ({ id: `f_${index}`, name: 'x' })),
      records: Array.from({ length: BITABLE_LIMITS.records }, (_, index) => ({
        id: `r_${index}`,
        cells: Object.fromEntries(Array.from({ length: BITABLE_LIMITS.fields }, (_, cell) => [
          `f_${cell}`, 'x'.repeat(BITABLE_LIMITS.cellLength),
        ])),
      })),
    }
    expect(editor.commands.updateBitable({ pos: 0, bitable: huge })).toBe(false)
    expect(dataOf(editor).records).toHaveLength(2)
  })

  it('setBitableView 切视图并落库', () => {
    const editor = freshEditor('')
    editor.commands.setBitable()
    expect(editor.commands.setBitableView({ pos: 0, view: 'gantt' })).toBe(true)
    expect(dataOf(editor).view).toBe('gantt')
  })

  it('🔴 同视图返回 false（重复点 tab 不进 undo 栈）', () => {
    const editor = freshEditor('')
    editor.commands.setBitable()
    expect(editor.commands.setBitableView({ pos: 0, view: 'grid' })).toBe(false)
    editor.commands.setBitableView({ pos: 0, view: 'kanban' })
    expect(editor.commands.setBitableView({ pos: 0, view: 'kanban' })).toBe(false)
  })

  it('setBitableView 收斜杠命令 id；位置非法直接 false', () => {
    const editor = freshEditor('')
    editor.commands.setBitable()
    expect(editor.commands.setBitableView({ pos: 0, view: 'bitableGallery' })).toBe(true)
    expect(dataOf(editor).view).toBe('gallery')
    expect(editor.commands.setBitableView({ pos: 99, view: 'grid' })).toBe(false)
  })
})

/* ------------------------------------------------------------------ *
 * ⑥ 块定义：renderHTML 就是导出产物
 * ------------------------------------------------------------------ */

describe('renderHTML（导出恒为真表格）', () => {
  const exportOf = (data, attrs = {}) => freshEditor({
    type: 'doc',
    content: [{ type: 'bitable', attrs: { bitable: encodeBitable(data), ...attrs } }],
  }).getHTML()

  it('出真 table / th / td，字段名与记录值都在文本里', () => {
    const html = exportOf(defaultBitable())
    expect(html).toContain('data-type="bitable"')
    expect(html).toContain('data-block-type="bitable"')
    expect(html).toContain('lark-doc-bitable-static')
    expect(html).toContain('lark-doc-bitable-table')
    expect(html).toContain('<table')
    expect(html).toContain('<th')
    expect(html).toContain('<td')
    expect(html).toContain('名称')
    expect(html).toContain('需求评审')
    expect(html).toContain('接口联调')
    expect(html).toContain('未命名多维表格')
    expect(html).toContain('2 条记录')
  })

  it('🔴 停在看板 / 甘特时导出仍是表格（投影不可检索，表格是唯一无损形态）', () => {
    BITABLE_VIEW_IDS.filter((view) => view !== 'grid').forEach((view) => {
      const html = exportOf(defaultBitable(view))
      expect(html).toContain(`data-bitable-source-view="${view}"`)
      expect(html).toContain('<table')
      expect(html).toContain('<td')
      // 导出件里没有编辑器态的视图骨架
      // 🔴 别用 `lark-doc-bitable-tab` 做子串断言：`lark-doc-bitable-table` 也以它开头，
      // 会永远为真。这里断言语义化的 `role=tablist`（只有编辑器态才有）。
      expect(html).not.toContain('role="tablist"')
      expect(html).not.toContain('lark-doc-bitable-toolbar')
      expect(html).not.toContain('lark-doc-bitable-kanban')
      expect(html).not.toContain('lark-doc-bitable-gantt-bar')
    })
  })

  it('列宽用行内百分比（table-layout:fixed 下才会跟着容器缩）', () => {
    const html = exportOf(defaultBitable())
    expect(html).toContain('width: 40.0000%')
    expect(html).toContain('width: 20.0000%')
  })

  it('parseHTML 只认带合法 data-bitable 的 div，其余退化成 unknown-block', () => {
    const editor = freshEditor('')
    const payload = encodeBitable(defaultBitable('kanban')).replace(/"/g, '&quot;')
    editor.commands.setContent(`<div data-type="bitable" data-bitable="${payload}"></div>`)
    expect(bitablesIn(editor)).toHaveLength(1)
    expect(dataOf(editor).view).toBe('kanban')

    const bad = freshEditor('')
    bad.commands.setContent('<div data-type="bitable" data-bitable="不是 JSON"></div>')
    expect(bitablesIn(bad)).toHaveLength(0)

    const empty = freshEditor('')
    empty.commands.setContent('<div data-type="bitable"></div>')
    expect(bitablesIn(empty)).toHaveLength(0)
  })

  it('数据缺失时画占位而不是空白（导出一块白比一句说明更难定位）', () => {
    const editor = freshEditor({ type: 'doc', content: [{ type: 'bitable', attrs: {} }] })
    expect(editor.getHTML()).toContain('多维表格数据缺失')
  })

  it('没有字段时画一句说明（不是一张空表）', () => {
    const html = exportOf(normalizeBitable({}))
    expect(html).toContain('多维表格暂无字段')
    expect(html).not.toContain('<table')
  })
})

/* ------------------------------------------------------------------ *
 * ⑦ NodeView：5 tab / 键盘 / 视图体重建
 * ------------------------------------------------------------------ */

describe('NodeView 骨架', () => {
  it('根节点标 data-view 与编辑态；工具栏 / 视图体 / footer 三段', () => {
    const { nodeView, dom } = mountBitable()
    expect(dom.getAttribute('data-view')).toBe('grid')
    expect(dom.getAttribute('data-bitable-mode')).toBe('editor')
    expect(dom.querySelector('.lark-doc-bitable-toolbar')).toBeTruthy()
    expect(dom.querySelector('.lark-doc-bitable-view')).toBeTruthy()
    expect(dom.querySelector('.lark-doc-bitable-footer')).toBeTruthy()
    // 编辑器态不留静态表（留着 AT 会把同一批数据读两遍）
    expect(dom.querySelector('.lark-doc-bitable-table')).toBeNull()
    expect(nodeView.body()).toBe(dom.querySelector('.lark-doc-bitable-view'))
  })

  it('tablist 5 个 role=tab，只有当前项 aria-selected=true 且可 Tab 到', () => {
    const { nodeView, dom } = mountBitable()
    const list = dom.querySelector('.lark-doc-bitable-tabs')
    expect(list.getAttribute('role')).toBe('tablist')
    const tabs = nodeView.tabs()
    expect(tabs).toHaveLength(5)
    expect(tabs.map((tab) => tab.getAttribute('data-view'))).toEqual(BITABLE_VIEW_IDS)
    expect(tabs.map((tab) => tab.textContent)).toEqual(['表格', '看板', '甘特图', '画册', '关联'])
    tabs.forEach((tab) => expect(tab.getAttribute('role')).toBe('tab'))
    expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false', 'false', 'false'])
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1, -1, -1, -1])
  })

  it('footer：左记录数、右当前视图名', () => {
    const { nodeView, dom } = mountBitable()
    expect(dom.querySelector('.lark-doc-bitable-count').textContent).toBe('2 条记录')
    expect(dom.querySelector('.lark-doc-bitable-view-name').textContent).toBe('表格')
    nodeView.commitView('gantt')
    expect(dom.querySelector('.lark-doc-bitable-view-name').textContent).toBe('甘特图')
  })

  it('5 视图体各画各的（视图体首节点类名）', () => {
    // 初始落在 relation：`commitView` 与 `setBitableView` 同口径，**切到当前视图返回 false**，
    // 从 grid 起跑会让第一轮就假红。
    const { nodeView } = mountBitable(withView(defaultBitable(), 'relation'))
    const expected = {
      grid: 'lark-doc-bitable-grid',
      kanban: 'lark-doc-bitable-kanban',
      gantt: 'lark-doc-bitable-gantt',
      gallery: 'lark-doc-bitable-gallery',
      relation: 'lark-doc-bitable-relation',
    }
    BITABLE_VIEW_IDS.forEach((view) => {
      expect(nodeView.commitView(view)).toBe(true)
      expect(nodeView.viewDom().classList.contains(expected[view])).toBe(true)
      expect(nodeView.body().getAttribute('data-view')).toBe(view)
    })
  })

  it('表格体是真 table + colgroup；看板按状态分列；甘特 14 格刻度', () => {
    const { nodeView } = mountBitable()

    nodeView.commitView('grid')
    const grid = nodeView.viewDom()
    expect(grid.querySelectorAll('.lark-doc-bitable-grid-table thead th')).toHaveLength(4)
    expect(grid.querySelectorAll('.lark-doc-bitable-grid-table tbody tr')).toHaveLength(2)
    expect(grid.querySelectorAll('colgroup col')).toHaveLength(4)
    expect(grid.querySelector('col').style.width).toBe('40.0000%')

    nodeView.commitView('kanban')
    const kanban = nodeView.viewDom()
    expect(kanban.querySelectorAll('.lark-doc-bitable-kanban-column')).toHaveLength(2)
    expect(kanban.querySelector('.lark-doc-bitable-kanban-label').textContent).toBe('进行中')
    expect(kanban.querySelector('.lark-doc-bitable-kanban-card .lark-doc-bitable-card-title').textContent)
      .toBe('需求评审')

    nodeView.commitView('gantt')
    expect(nodeView.viewDom().querySelectorAll('.lark-doc-bitable-gantt-tick')).toHaveLength(14)
    expect(nodeView.viewDom().querySelectorAll('.lark-doc-bitable-gantt-row')).toHaveLength(2)

    nodeView.commitView('gallery')
    const covers = nodeView.viewDom().querySelectorAll('.lark-doc-bitable-gallery-cover')
    expect(covers).toHaveLength(2)
    expect(covers[0].textContent).toBe('需')
    // 装饰性首字母不进可访问性树
    expect(covers[0].getAttribute('aria-hidden')).toBe('true')

    nodeView.commitView('relation')
    expect(nodeView.viewDom().getAttribute('data-ready')).toBe('false')
    expect(nodeView.viewDom().querySelector('.lark-doc-bitable-relation-hint').textContent)
      .toContain('尚未关联')
  })
})

describe('NodeView 切视图：点击 / 键盘', () => {
  it('点 tab 切视图并落回文档（唯一数据源是 attrs.bitable）', () => {
    const { editor, nodeView } = mountBitable()
    click(nodeView.tabs()[1])
    expect(nodeView.view()).toBe('kanban')
    expect(dataOf(editor).view).toBe('kanban')
    expect(nodeView.dom.getAttribute('data-view')).toBe('kanban')
    expect(nodeView.tabs()[1].getAttribute('aria-selected')).toBe('true')
    expect(nodeView.tabs()[0].getAttribute('aria-selected')).toBe('false')
  })

  it('点当前 tab 不产生事务（commitView 返回 false）', () => {
    const { nodeView } = mountBitable()
    expect(nodeView.commitView('grid')).toBe(false)
    click(nodeView.tabs()[0])
    expect(nodeView.view()).toBe('grid')
  })

  it('方向键左右循环，Home / End 到两端，并 preventDefault 不让 PM 吃掉', () => {
    const { nodeView } = mountBitable()
    const tabs = nodeView.tabs()

    const right = keyOn(tabs[0], 'ArrowRight')
    expect(nodeView.view()).toBe('kanban')
    expect(right.defaultPrevented).toBe(true)

    keyOn(nodeView.dom.querySelector('.lark-doc-bitable-tab'), 'End')
    expect(nodeView.view()).toBe('relation')

    keyOn(nodeView.dom.querySelector('.lark-doc-bitable-tab'), 'ArrowRight')
    expect(nodeView.view()).toBe('grid')

    keyOn(nodeView.dom.querySelector('.lark-doc-bitable-tab'), 'ArrowLeft')
    expect(nodeView.view()).toBe('relation')

    keyOn(nodeView.dom.querySelector('.lark-doc-bitable-tab'), 'Home')
    expect(nodeView.view()).toBe('grid')
  })

  it('非导航键不拦（空格 / 回车仍是按钮原生行为）', () => {
    const { nodeView } = mountBitable()
    const event = keyOn(nodeView.tabs()[0], 'Enter')
    expect(event.defaultPrevented).toBe(false)
    expect(nodeView.view()).toBe('grid')
  })

  it('切换后新 tab 拿到焦点，tabIndex 只有一个 0', () => {
    const { nodeView } = mountBitable()
    keyOn(nodeView.tabs()[0], 'ArrowRight')
    expect(nodeView.tabs().filter((tab) => tab.tabIndex === 0)).toHaveLength(1)
    expect(nodeView.tabs()[1].tabIndex).toBe(0)
    expect(nodeView.tabs()[0].tabIndex).toBe(-1)
  })
})

describe('NodeView 视图体重建键（视图 | 数据）', () => {
  it('视图没变不重建；视图变了重建', () => {
    const { nodeView } = mountBitable()
    const first = nodeView.viewDom()
    expect(nodeView.commitView('grid')).toBe(false)
    expect(nodeView.viewDom()).toBe(first)
    nodeView.commitView('gallery')
    expect(nodeView.viewDom()).not.toBe(first)
  })

  it('同视图但数据变了也要重建（宿主外部写入）', () => {
    const { editor, nodeView } = mountBitable()
    const before = nodeView.viewDom()
    const next = withRecords(nodeView.bitable(), [{ id: 'r_3', cells: { f_name: '新记录' } }])
    editor.commands.updateBitable({ pos: 0, bitable: next })
    expect(nodeView.viewDom()).not.toBe(before)
    expect(nodeView.viewDom().querySelectorAll('.lark-doc-bitable-grid-table tbody tr')).toHaveLength(3)
    expect(nodeView.dom.querySelector('.lark-doc-bitable-count').textContent).toBe('3 条记录')
  })

  it('数据归一化后才参与渲染：外部塞进非法字段不会画出空列', () => {
    const { editor, nodeView } = mountBitable()
    editor.commands.updateBitable({
      pos: 0,
      bitable: { fields: [{ id: 'a', name: 'A' }], records: [{ id: 'r_1', cells: { a: 'x', ghost: 'y' } }] },
    })
    expect(nodeView.bitable().fields).toHaveLength(1)
    expect(nodeView.viewDom().querySelectorAll('tbody td')).toHaveLength(1)
  })
})

describe('NodeView 宿主通道与事件边界', () => {
  it('切视图后回调 onChange（带 blockId 与视图）', () => {
    const calls = []
    const { nodeView } = mountBitable(null, { onBitableChange: (payload) => calls.push(payload) })
    nodeView.commitView('kanban')
    expect(calls).toHaveLength(1)
    expect(calls[0].blockId).toBe('blk_bitable_test')
    expect(calls[0].view).toBe('kanban')
    // 没变化不回调
    nodeView.commitView('kanban')
    expect(calls).toHaveLength(1)
  })

  it('「⋯」只转交宿主；宿主没接也不抛', () => {
    const calls = []
    const withMenu = mountBitable(null, { onBitableMenu: (payload) => calls.push(payload) })
    click(withMenu.dom.querySelector('.lark-doc-bitable-more'))
    expect(calls).toHaveLength(1)
    expect(calls[0].blockId).toBe('blk_bitable_test')
    expect(calls[0].view).toBe('grid')

    const without = mountBitable()
    expect(() => click(without.dom.querySelector('.lark-doc-bitable-more'))).not.toThrow()
  })

  it('stopEvent 只拦 tab 与「⋯」，块与视图体留给 PM 选块', () => {
    const { nodeView, dom } = mountBitable()
    expect(nodeView.stopEvent({ target: nodeView.tabs()[0] })).toBe(true)
    expect(nodeView.stopEvent({ target: dom.querySelector('.lark-doc-bitable-more') })).toBe(true)
    expect(nodeView.stopEvent({ target: dom })).toBe(false)
    expect(nodeView.stopEvent({ target: nodeView.viewDom() })).toBe(false)
    expect(nodeView.stopEvent({ target: null })).toBe(false)
    expect(nodeView.ignoreMutation()).toBe(true)
  })

  it('selectNode / deselectNode 切 is-selected', () => {
    const { nodeView, dom } = mountBitable()
    nodeView.selectNode()
    expect(dom.classList.contains('is-selected')).toBe(true)
    nodeView.deselectNode()
    expect(dom.classList.contains('is-selected')).toBe(false)
  })

  it('update() 只认 bitable 节点；非本块节点返回 false', () => {
    const { editor, nodeView } = mountBitable()
    expect(nodeView.update(editor.state.doc.firstChild)).toBe(true)
    expect(nodeView.update({ type: { name: 'paragraph' }, attrs: {} })).toBe(false)
    expect(nodeView.update(null)).toBe(false)
  })

  it('destroy 之后不再更新 DOM', () => {
    const { nodeView } = mountBitable()
    nodeView.destroy()
    expect(nodeView.update({ type: { name: 'bitable' }, attrs: {} })).toBe(false)
  })
})

describe('注册表同源（上层只认 registry/blocks.js 一个入口）', () => {
  it('5 视图常量与投影函数是同一批引用，不是拷贝', () => {
    expect(registry.BITABLE_VIEWS).toBe(BITABLE_VIEWS)
    expect(registry.BITABLE_GEOMETRY).toBe(BITABLE_GEOMETRY)
    expect(registry.defaultBitable).toBe(defaultBitable)
    expect(registry.normalizeBitable).toBe(normalizeBitable)
    expect(registry.encodeBitable).toBe(encodeBitable)
    expect(registry.gridWidths).toBe(gridWidths)
    // poll 与 bitable 同名的 `blockHeight` 由 registry 只导 poll 那份 —— bitable 的块高
    // 必须从 core/blocks/bitable 取（文件头 ⚠️ 说的就是这件事）。
    expect(registry.blockHeight).not.toBe(blockHeight)
  })
})
