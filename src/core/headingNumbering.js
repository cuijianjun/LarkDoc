/**
 * 标题编号（对齐飞书）：复合章节号 `1.` / `1.1` / `1.1.1`，由装饰层现算，不写进正文。
 *
 * 从 `core/documentOperations.js` 原样搬出（函数体一行未改）。
 */


export const isolatedHeadingContainers = new Set(['callout', 'blockquote', 'detailsContent', 'column', 'tableCell', 'tableHeader'])

/*
 * —— 标题编号（对齐飞书）——
 *
 * 飞书的「标题编号」不是一个独立的编号系统，而是「把标题块设为有序列表」：
 * 开放平台模型里就是 ParagraphStyle{ headingLevel: 1..9, list: { type: 'number', number } }
 * ——标题和有序列表共用同一套 list 字段。所以这里也只加两个属性：
 *
 *   numbering: false | true        // 是否显示编号（飞书新建标题默认无编号）
 *   numberingStart: null | number  // 「重新开始编号 / 设置编号的值」的起点，null = 继续
 *
 * 「继续标题编号」= numberingStart 清成 null（所以它在已经是继续态时是禁用的）。
 * 编号值本身不落库：由前序同级标题算出来，删除/移动/插入会自动更新（飞书同款行为）。
 */
export const HEADING_NUMBER_MAX = 999
export const HEADING_VALUE_MAX = 999999999
export const HEADING_NUMBER_CONTAINERS = new Set(['callout', 'table', 'tableCell', 'tableHeader'])

/**
 * 把一串层级计数拼成飞书样式的编号。
 *
 * H1 → `1.`（带尾点）；H2 → `1.1`；H3 → `1.1.1`（多级不带尾点）。
 * 前导 0 会被丢掉：文档直接从 H2 开始时显示 `1.` 而不是 `0.1`。
 */
export function formatHeadingNumber(numbers) {
  if (!Array.isArray(numbers) || !numbers.length) return ''
  let first = 0
  while (first < numbers.length - 1 && !numbers[first]) first += 1
  const parts = numbers.slice(first)
  return `${parts.join('.')}${parts.length === 1 ? '.' : ''}`
}

export function collectHeadingEntries(doc) {
  const result = []
  const walk = (parent, start, scope, hidden) => parent.forEach((node, offset) => {
    const pos = start + offset
    if (node.type.name === 'heading') result.push({ pos, level: node.attrs.level, attrs: node.attrs, node, scope, hidden })
    if (!node.isTextblock && !node.isLeaf) walk(node, pos + 1, HEADING_NUMBER_CONTAINERS.has(node.type.name) ? node : scope, hidden || isolatedHeadingContainers.has(node.type.name))
  })
  if (doc) walk(doc, 0, null, false)
  return result
}

/**
 * REA v52：字号 level 与编号层级 numberingLevel 分离。按隔离容器分队列，
 * 队列内实际出现的标题级别密集映射；独立重启队列不消费外层续号。
 * 只存原始元信息；同步调用排空，异步目录通过 yield 保持可取消与分片。
 */
export function* iterateHeadingNumbers(headings) {
  const scopes = new Map(), numbers = new Map(), items = []
  for (let index = 0; index < headings.length; index++) {
    const entry = headings[index], attrs = entry.attrs
    if (attrs.numbering) {
      let context = scopes.get(entry.scope)
      if (!context) { context = { queues: [], active: 0 }; scopes.set(entry.scope, context) }
      const { queues } = context
      const item = { entry }
      items.push(item)
      if (attrs.numberingLevel || !queues.length) {
        queues.push({ items: [item], levels: 1 << entry.level }); context.active = queues.length - 1
      } else {
        for (let at = context.active; at >= 0; at--) {
          const first = queues[at].items[0].entry
          const accepts = entry.level >= first.level || !first.attrs.numberingLevel
          const independent = entry.level === first.level && first.attrs.numberingLevel && attrs.numberingStart
          if (accepts && !independent) { queues[at].items.push(item); queues[at].levels |= 1 << entry.level; context.active = at; break }
          if (!at) { queues.push({ items: [item], levels: 1 << entry.level }); context.active = queues.length - 1 }
        }
      }
    }
    if (index % 128 === 127) yield
  }
  for (const { queues } of scopes.values()) {
    let regular = [], independent = []
    for (const queue of queues) {
      // 收集时记录九级位图；预处理最多九步，避免巨型队列一次map/sort。
      const depths = new Map()
      let base = queue.items[0].entry.attrs.numberingLevel || 1
      for (let level = 1; level <= 9; level++) if (queue.levels & (1 << level)) depths.set(level, base++)
      let custom = false
      for (const item of queue.items) {
        const { entry } = item, { attrs } = entry
        if (attrs.numberingLevel) custom = true
        const next = [...(custom ? independent : regular)], depth = depths.get(entry.level)
        if (next.length < depth) while (next.length < depth) next.push(1)
        else { next.length = depth; next[depth - 1]++ }
        if (attrs.numberingStart) next[depth - 1] = Math.min(HEADING_VALUE_MAX, attrs.numberingStart)
        numbers.set(item, next)
        if (custom) independent = next
        else regular = next
        yield
      }
    }
  }
  // 队列处理顺序不同于正文顺序，落定后再按正文顺序产出。
  for (const item of items) {
    const next = numbers.get(item), { entry } = item
    // 「继续编号」只在块自己带起点/层级时可点：不带就是天然连续，点了也没有可清的东西。
    // 不能拿「前一个同级是否连续」判——首块没有前项，设过起点后会被误禁用。
    const canContinue = !!(entry.attrs.numberingLevel || entry.attrs.numberingStart)
    yield { pos: entry.pos, info: { label: formatHeadingNumber(next), level: entry.level, counters: next, canContinue } }
  }
}

export function computeHeadingNumbers(doc, headings = collectHeadingEntries(doc)) {
  const result = new Map()
  for (const item of iterateHeadingNumbers(headings)) if (item) result.set(item.pos, item.info)
  return result
}

/** 取某个位置标题的编号（非编号标题返回 null）。 */
export function headingNumberAt(doc, pos) {
  if (!doc || !Number.isInteger(pos)) return null
  const node = doc.nodeAt(pos)
  if (!node || node.type.name !== 'heading' || !node.attrs?.numbering) return null
  return computeHeadingNumbers(doc).get(pos) || null
}

/** 把越界的编号起点压回合法区间（1..999），null/空串表示「继续」（返回 null）。 */
export function clampHeadingNumberStart(value, maximum = HEADING_NUMBER_MAX) {
  // 必须先挡 null：Number(null) === 0 会被误判成合法数字并夹成 1。
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  if (!Number.isFinite(number)) return null
  return Math.max(1, Math.min(maximum, Math.round(number)))
}
