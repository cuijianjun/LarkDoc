/**
 * 多维表格块的**形状 + 视图投影 + 几何**纯函数（P5-04）。
 *
 * 规格来源与「哪些是实测、哪些是设计值」的界线（🔴 读这段再改数字）：
 *   - 02 §17：块类名 `.docx-bitable-block`，几何只有一句 **「视视图而定」**，
 *     并注明 **5 种视图（表格/看板/甘特图/画册/关联）共用同一块壳**；
 *   - 16 §2.11：唯一实测外框 `bitableHost.r = [331, 1252, 820, 220]`，且块内
 *     `childTags` 含 `canvas` ⇒ 飞书的内容是 canvas 画的，**内部没有任何 DOM 可量**；
 *   - 09 §5.6 P5-04 定的口径：「多维表格 4 视图**骨架**（数据模型 + 视图切换 UI，无后端）」。
 *
 * ⇒ 所以本文件的纵向数字**不是实测值**，而是「按组件拼装显式给出」的设计值：
 * 每个数字都能在 `BITABLE_GEOMETRY` 里看到它属于哪个部件，块高由 `blockHeight()`
 * 按公式算出（不是写死一个总数）。真机复测后只改这一处 + CSS 的 `.lark-doc-bitable*`。
 * 唯一从实测锚点继承的两条：**内容宽 534**（与 sheet / table / poll 同一套正文宽度）
 * 和 **导出件必须是真表格**（同 sheet 的分工：导出走 `renderHTML`，编辑器走 NodeView）。
 *
 * 🔴 与飞书的一处**故意偏离**：飞书用 canvas 画，16 §2.11 判定「表块 a11y = 零」，
 * 并明文要求「复刻若也用 canvas 渲染，必须补 `sr-only` 语义镜像」。这里直接用
 * 语义化 DOM（`table/th/td` + `role`）渲染同一个骨架 —— 屏幕阅读器、全文检索、
 * 复制全都直接可用，不需要镜像层，也不必为了保真去接受零可访问性。
 */

import { utf8Bytes } from '../embed/card'

/** 数据版本。落库 `attrs.bitable` 的 `v` 字段，未来迁移按它分派。 */
export const BITABLE_VERSION = 1

/**
 * 5 种视图（02 §17 的清单顺序 + 03 §3.4 ⑤ 的斜杠项 data-name）。
 *
 * `slash` 是**斜杠菜单里的命令 id**（5 项各插同一个块、带不同默认 `view`），
 * 与 `id` 分开是因为真机 `data-name` 是 `bitable GridView` / `bitable Kanban` 这种
 * 带空格与大小写的写法，而命令 id 必须是 camelCase（P0-05 契约）。
 */
export const BITABLE_VIEWS = Object.freeze([
  { id: 'grid', label: '表格', slash: 'bitable', dataName: 'bitable GridView' },
  { id: 'kanban', label: '看板', slash: 'bitableKanban', dataName: 'bitable Kanban' },
  { id: 'gantt', label: '甘特图', slash: 'bitableGantt', dataName: 'bitable Gantt' },
  { id: 'gallery', label: '画册', slash: 'bitableGallery', dataName: 'bitable Gallery' },
  { id: 'relation', label: '关联', slash: 'bitableRefer', dataName: 'bitable refer' },
])

/** 视图 id 白名单；`relation` 是**关联已有多维表格**那一项落下来的视图（provider 置灰态）。 */
export const BITABLE_VIEW_IDS = BITABLE_VIEWS.map((view) => view.id)

/** 字段类型：只做「看起来像多维表格」所需的最少 4 种，不做公式/附件/关联列。 */
export const FIELD_KINDS = Object.freeze(['text', 'select', 'date', 'number'])

/** 数据上限：管住「一份 JSON 能撑多大」，不是产品规格（同 sheet / poll 口径）。 */
export const BITABLE_LIMITS = Object.freeze({
  fields: 20, records: 100, nameLength: 60, cellLength: 200, bytes: 32 * 1024,
})

/**
 * 几何：每个数字都标明所属部件，块高由 `blockHeight()` 求和。
 *
 * `width` 534 = 正文内容宽（与 sheet 的块宽、poll 的块宽同一套口径）。
 * 行高 34 / 表头 32 / 工具栏 40 / footer 36 是**拼装值**（见文件头说明），
 * 取值参考同一文档里 `table` 块与 `sheet` 块的既有节奏：可读、不与正文抢视觉。
 */
export const BITABLE_GEOMETRY = Object.freeze({
  width: 534,
  radius: 8,
  toolbarHeight: 40,
  fieldHeight: 32,
  recordHeight: 34,
  footerHeight: 36,
  cellPaddingX: 12,
  /** 看板：列宽 168 + 列间距 12 ⇒ 534 内刚好 3 列（168×3 + 12×2 = 528，留 6 收边）。 */
  kanbanColumnWidth: 168,
  kanbanGap: 12,
  kanbanHeadHeight: 34,
  kanbanCardHeight: 72,
  kanbanCardGap: 8,
  /** 甘特图：左侧字段列 132 + 右侧时间轴，剩余 402 画 14 天窗口。 */
  ganttLabelWidth: 132,
  ganttScaleHeight: 30,
  ganttDays: 14,
  ganttBarHeight: 18,
  /** 画册：卡片 160×132，534 内 3 列（与看板同列数，视觉上是一套网格）。 */
  galleryCardWidth: 160,
  galleryCoverHeight: 88,
  galleryGap: 12,
  /** 关联视图的置灰卡高度。 */
  relationHeight: 96,
})

/**
 * 各视图块高 = 工具栏 + 视图体 + footer。
 *
 * `grid` / `gantt` 随记录数增长，`kanban` 随最多卡片数增长，`gallery` / `relation` 定高。
 * 之所以给函数而不是常量表：块高必须与 `records` 数量一致，否则「加一条记录块不长大」
 * 会在导出 PDF 时把表格截断。
 */
export function blockHeight(view, bitable) {
  const geo = BITABLE_GEOMETRY
  const records = recordList(bitable).length
  const chrome = geo.toolbarHeight + geo.footerHeight
  if (view === 'kanban') {
    const columns = kanbanColumns(bitable)
    const most = columns.reduce((max, column) => Math.max(max, column.cards.length), 0)
    const cards = most * geo.kanbanCardHeight + Math.max(0, most - 1) * geo.kanbanCardGap
    return chrome + geo.kanbanHeadHeight + cards
  }
  if (view === 'gantt') return chrome + geo.ganttScaleHeight + records * geo.recordHeight
  if (view === 'gallery') return chrome + geo.galleryCoverHeight + 44
  if (view === 'relation') return chrome + geo.relationHeight
  return chrome + geo.fieldHeight + records * geo.recordHeight
}

/** 字节数：直接用卡片层的 `utf8Bytes`，别在这儿留第二份实现（sheet / poll 同源）。 */
// 🔴 必须 import + 本地绑定：`export ... from` 不会在本模块作用域绑名字，下面两处都裸用它。
export const byteLength = utf8Bytes

/**
 * 文本归一：去控制字符（`no-control-regex` 不许写正则，逐个码点判）、折叠换行、裁长。
 * 单元格里出现换行会把固定行高撑破，所以换行统一按空格处理。
 */
export function cleanText(value, limit = BITABLE_LIMITS.cellLength) {
  if (value === null || value === undefined) return ''
  const text = Array.from(String(value))
    .map((char) => {
      const code = char.codePointAt(0)
      return code < 0x20 || code === 0x7f ? ' ' : char
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
  return Array.from(text).slice(0, limit).join('')
}

/** 视图归一：非法值一律落 `grid`（表格视图是块的本体，别的视图都是它的投影）。 */
export function viewOf(value) {
  return BITABLE_VIEW_IDS.includes(value) ? value : 'grid'
}

/** 视图中文名；未知视图回 `表格`。 */
export function viewLabel(value) {
  const found = BITABLE_VIEWS.find((view) => view.id === viewOf(value))
  return found ? found.label : '表格'
}

/** 斜杠命令 id → 默认视图 id（`bitableKanban` → `kanban`）。未知回 `grid`。 */
export function viewOfCommand(commandId) {
  const found = BITABLE_VIEWS.find((view) => view.slash === commandId)
  return found ? found.id : 'grid'
}

/** 记录数文案。真机录音里出现过「2 条记录」，footer 就是照它做的。 */
export function recordCountText(count) {
  const total = Number.isInteger(count) && count > 0 ? count : 0
  return `${total} 条记录`
}

/**
 * 默认块：4 字段 × 2 记录。
 *
 * 为什么不是空表：02 §17 没给空态规格，而「空白多维表格」在骨架里读不出这是什么东西；
 * 2 条记录刚好对上真机录音里的「2 条记录」文案，也让看板/甘特/画册三个投影有内容可画。
 */
export function defaultBitable(view) {
  return normalizeBitable({
    view: viewOf(view),
    name: '未命名多维表格',
    fields: [
      { id: 'f_name', name: '名称', kind: 'text' },
      { id: 'f_status', name: '状态', kind: 'select' },
      { id: 'f_owner', name: '负责人', kind: 'text' },
      { id: 'f_due', name: '截止日期', kind: 'date' },
    ],
    records: [
      { id: 'r_1', cells: { f_name: '需求评审', f_status: '进行中', f_owner: '张明', f_due: '03-12' } },
      { id: 'r_2', cells: { f_name: '接口联调', f_status: '待开始', f_owner: '李然', f_due: '03-18' } },
    ],
  })
}

/** 字段类型归一：未知类型落 `text`（宁可当纯文本显示，也不要一个渲染不出来的列）。 */
export function fieldKind(value) {
  return FIELD_KINDS.includes(value) ? value : 'text'
}

/**
 * 归一化：把任意输入压成合法形状。
 *
 * 四条硬规则：①字段 / 记录都裁到上限；②字段 id 去重（撞 id 就地补序号，
 * 否则 `cells` 会串列）；③记录里指向不存在字段的键直接丢弃（避免存在渲染不出
 * 也删不掉的孤儿数据）；④`reference` 只认三个字符串字段。
 */
export function normalizeBitable(input) {
  const source = input && typeof input === 'object' ? input : {}
  const fields = []
  const seen = new Set()
  const rawFields = Array.isArray(source.fields) ? source.fields.slice(0, BITABLE_LIMITS.fields) : []
  rawFields.forEach((field, index) => {
    const raw = field && typeof field === 'object' ? field : {}
    let id = cleanText(raw.id, 32) || `f_${index + 1}`
    while (seen.has(id)) id = `${id}_${index + 1}`
    seen.add(id)
    fields.push({
      id,
      name: cleanText(raw.name, BITABLE_LIMITS.nameLength) || `字段 ${index + 1}`,
      kind: fieldKind(raw.kind),
    })
  })
  const records = []
  const rawRecords = Array.isArray(source.records) ? source.records.slice(0, BITABLE_LIMITS.records) : []
  rawRecords.forEach((record, index) => {
    const raw = record && typeof record === 'object' ? record : {}
    const cells = {}
    const source2 = raw.cells && typeof raw.cells === 'object' ? raw.cells : {}
    for (const field of fields) {
      const text = cleanText(source2[field.id], BITABLE_LIMITS.cellLength)
      if (text) cells[field.id] = text
    }
    records.push({ id: cleanText(raw.id, 32) || `r_${index + 1}`, cells })
  })
  const reference = source.reference && typeof source.reference === 'object'
    ? {
      appToken: cleanText(source.reference.appToken, 64),
      tableId: cleanText(source.reference.tableId, 64),
      viewId: cleanText(source.reference.viewId, 64),
    }
    : null
  return {
    v: BITABLE_VERSION,
    name: cleanText(source.name, BITABLE_LIMITS.nameLength) || '未命名多维表格',
    view: viewOf(source.view),
    fields,
    records,
    reference,
  }
}

/** 读 `attrs.bitable`（JSON 字符串）→ 对象；解析失败 / 超限 / 非字符串一律 `null`。 */
export function readBitable(raw) {
  if (typeof raw !== 'string' || !raw || byteLength(raw) > BITABLE_LIMITS.bytes) return null
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    return normalizeBitable(parsed)
  } catch (_) {
    return null
  }
}

/**
 * 写路径：任意输入 → JSON 字符串。**超 32 KB 直接抛**，由命令层捕获后返回 `false`，
 * 不产生「命令说成功、落库溢出」的半成功状态（同 `encodeSheet` / `encodePoll` 口径）。
 */
export function encodeBitable(input) {
  const text = JSON.stringify(normalizeBitable(input))
  if (byteLength(text) > BITABLE_LIMITS.bytes) throw new Error('bitable: 超过 32 KB 上限')
  return text
}

/** 首个 `select` 字段：看板按它分列。没有 `select` 字段时退回第 1 个字段的文本分组。 */
export function groupField(bitable) {
  const fields = bitable && Array.isArray(bitable.fields) ? bitable.fields : []
  return fields.find((field) => field.kind === 'select') || fields[0] || null
}

/** 表格视图：表头 = 字段名，行 = 记录；缺格补空串（导出件的表不能有 `undefined`）。 */
export function gridRows(bitable) {
  const fields = bitable && Array.isArray(bitable.fields) ? bitable.fields : []
  const rows = recordList(bitable).map((record) => fields.map((field) => record.cells[field.id] || ''))
  return { header: fields.map((field) => field.name), rows, kinds: fields.map((field) => field.kind) }
}

/** 记录列表（只做形状校验，不做拷贝 —— 调用方只读）。 */
export function recordList(bitable) {
  return bitable && Array.isArray(bitable.records) ? bitable.records : []
}

/** 字段列表。 */
export function fieldList(bitable) {
  return bitable && Array.isArray(bitable.fields) ? bitable.fields : []
}

/**
 * 列宽百分比：首列（名称）吃 2 份，其余均分剩余。
 *
 * 用百分比而不是 px，是为了让 `<table table-layout:fixed>` 在导出件里跟着容器走 ——
 * 固定 px 一旦宿主缩窄就会溢出，而多维表格的列宽在 V1 里不可拖。
 */
export function gridWidths(bitable) {
  const total = fieldList(bitable).length
  if (!total) return []
  if (total === 1) return [100]
  const first = Math.round((200 / (total + 1)) * 10) / 10
  const rest = Math.round(((100 - first) / (total - 1)) * 10) / 10
  return [first, ...Array.from({ length: total - 1 }, () => rest)]
}

/**
 * 看板视图：按 `groupField` 的值分列，列序 = 首次出现顺序（不排序 ——
 * 排序规则是多维表格的字段设置，V1 不做）。空格归入「未分组」列。
 */
export function kanbanColumns(bitable) {
  const field = groupField(bitable)
  const records = recordList(bitable)
  if (!field) return []
  const order = []
  const buckets = new Map()
  for (const record of records) {
    const key = record.cells[field.id] || '未分组'
    if (!buckets.has(key)) {
      buckets.set(key, [])
      order.push(key)
    }
    buckets.get(key).push(record)
  }
  const titleField = fieldList(bitable)[0] || field
  return order.map((key) => ({
    id: key,
    label: key,
    cards: buckets.get(key).map((record) => ({
      id: record.id,
      title: record.cells[titleField.id] || '未命名',
      meta: fieldList(bitable)
        .filter((item) => item.id !== titleField.id && item.id !== field.id && record.cells[item.id])
        .map((item) => record.cells[item.id])
        .join(' · '),
    })),
  }))
}

/**
 * 甘特视图：`left / width` 是**百分比**（相对 14 天窗口），由记录序推出排期。
 *
 * 🔴 这不是「按日期算工期」—— V1 没有日期解析（字段值是 `03-12` 这种展示串，
 * 02 §17 没给多维表格的日期格式规格）。排期取 `index * 3` 天起、`6 + index % 3` 天，
 * 只求「每条记录一根长度不一的条」，可断言、可复算，别当业务逻辑用。
 */
export function ganttBars(bitable) {
  const days = BITABLE_GEOMETRY.ganttDays
  const titleField = fieldList(bitable)[0] || null
  return recordList(bitable).map((record, index) => {
    const start = index * 3
    const span = 6 + (index % 3)
    return {
      id: record.id,
      label: titleField ? record.cells[titleField.id] || '未命名' : '未命名',
      left: Math.round((start / days) * 1000) / 10,
      width: Math.round((span / days) * 1000) / 10,
    }
  })
}

/** 甘特刻度：14 个等宽日期格（`1`…`14`），仅供骨架示意。 */
export function ganttScale() {
  return Array.from({ length: BITABLE_GEOMETRY.ganttDays }, (_, index) => String(index + 1))
}

/** 画册视图：标题 = 首字段，说明 = 第 2 个及以后有值的字段（`·` 连起来）。 */
export function galleryItems(bitable) {
  const fields = fieldList(bitable)
  const titleField = fields[0] || null
  return recordList(bitable).map((record) => ({
    id: record.id,
    title: titleField ? record.cells[titleField.id] || '未命名' : '未命名',
    meta: fields.slice(1).filter((field) => record.cells[field.id])
      .map((field) => record.cells[field.id]).join(' · '),
  }))
}

/** 关联视图是否已绑定（绑上 provider 才可能取到真数据；V1 一律未绑定）。 */
export function isRelationReady(bitable) {
  const reference = bitable && bitable.reference
  return Boolean(reference && reference.appToken && reference.tableId)
}

/**
 * 关联视图的置灰文案。照 17 §17.5 / §17.4 的降级口径：
 * capability 缺失时统一报 `providerUnavailable`，**不伪造本地成功**。
 */
export function relationHint(bitable) {
  return isRelationReady(bitable)
    ? '关联已生效，内容由多维表格服务提供'
    : '尚未关联多维表格。关联需要宿主提供 Bitable provider（V1 不发起请求）'
}

/** 视图下拉项（块内切换用；顺序 = `BITABLE_VIEWS`）。 */
export function viewMenu() {
  return BITABLE_VIEWS.map((view) => ({ id: view.id, label: view.label }))
}

/**
 * 切换视图：返回**新的** bitable 对象（不改入参，调用方拿它去 encode）。
 * 切到 `relation` 但没绑定时照切 —— 视图本身是可见的置灰态，不是错误。
 */
export function withView(bitable, view) {
  const base = normalizeBitable(bitable)
  return Object.assign({}, base, { view: viewOf(view) })
}
