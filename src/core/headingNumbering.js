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

/**
 * 推进一个编号标题对计数器的影响，返回该标题的编号信息。
 *
 * 这是「编号怎么长」的**唯一**实现：全文扫描（computeHeadingNumbers）与
 * P7-01 的局部重扫（按脏区续算）都调它，避免两套规则各自漂移。
 * `counters[0]` 不使用（层级从 1 起），长度固定 10。
 */
export function advanceHeadingCounters(counters, node) {
  const level = Math.max(1, Math.min(9, Number(node.attrs?.level) || 1))
  // 更深层的计数归零：出现 H2 之后，之前的 H3 序列不再影响新的 H3。
  for (let deeper = level + 1; deeper <= 9; deeper += 1) counters[deeper] = 0
  const start = node.attrs?.numberingStart
  if (Number.isInteger(start) && start > 0) counters[level] = Math.min(HEADING_NUMBER_MAX, start) - 1
  counters[level] += 1
  const numbers = counters.slice(1, level + 1)
  return { label: formatHeadingNumber(numbers), level, counters: numbers.slice() }
}

/**
 * 扫描整篇文档，返回 `Map<pos, { label, level, counters }>`。
 *
 * 只统计「带编号的标题」：正文有序列表由浏览器 list-style 自己排，两者互不干扰。
 * `numberingStart` 生效时把该层计数器压回起点，后续同级兄弟从它继续（飞书语义）。
 */
export function computeHeadingNumbers(doc) {
  const result = new Map()
  if (!doc) return result
  const counters = new Array(10).fill(0)
  doc.descendants((node, pos) => {
    if (node.type.name === 'heading' && node.attrs?.numbering) result.set(pos, advanceHeadingCounters(counters, node))
    return !node.isTextblock
  })
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
export function clampHeadingNumberStart(value) {
  // 必须先挡 null：Number(null) === 0 会被误判成合法数字并夹成 1。
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  if (!Number.isFinite(number)) return null
  return Math.max(1, Math.min(HEADING_NUMBER_MAX, Math.round(number)))
}
