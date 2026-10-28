/**
 * 差异摘要（09 §5.7.2-9：「JSON 只是某一时刻的投影，用于导出与 diff」）。
 *
 * 只算**便宜且稳定**的三样：块数、字数、标题增删。刻意不做字符级 diff：
 *   · 字符级 diff 要 Myer/patience 一类算法，长文档上是 O(ND)，成本远超声称的收益；
 *   · 面板左栏的逐字高亮（04 §3.4-D 的三色）是编辑器渲染层的事，不是数据层的事。
 * 这里给的是「一眼看出这次恢复动了多少」，够时间线做摘要就够了。
 *
 * 输入是**投影**：ProseMirror/Tiptap 的 doc JSON，或已经是三项指标的对象
 * （`{ blockCount, charCount, headings }`，用于拿不到正文时）。快照的元信息
 * 只有 `blockCount`，不足以算字数和标题 —— 要摘要就先 `get()` 再解码。
 *
 * 口径（写成字面量，避免两处实现漂移）：
 *   · `blockCount` = doc 的**直接子节点**数（段落/标题/列表各算一块，嵌套子块不重复计）；
 *   · `charCount`   = 所有 `text` 节点的 `text.length` 之和，按 UTF-16 码元计
 *                     （与 `String.prototype.length` 同口径；emoji 记 2）。
 *                     不按字形簇、不剔空白 —— 换个算法就会让"字数"在两端对不上。
 *   · `headings`    = 顶层 `heading` 节点，`{ level, text }`（`text` 含 mark 内文字）。
 *
 * 待定：`heading-0`（文档标题）不在正文里（04 §3.3 大纲口径），因此不计入 `headings`。
 */
const EMPTY_METRICS = Object.freeze({ blockCount: 0, charCount: 0, headings: [] })

/** 用 Projection 算三项指标；输入不认识就当空文档（读路径宽容，不抛）。 */
export function projectionMetrics(input) {
  const doc = parseProjection(input)
  if (!doc || typeof doc !== 'object') return { blockCount: 0, charCount: 0, headings: [] }
  const blocks = Array.isArray(doc.content) ? doc.content : []
  const headings = []
  let charCount = 0
  blocks.forEach((block) => {
    if (block && block.type === 'heading') {
      headings.push({ level: headingLevel(block), text: textOf(block) })
    }
    charCount += textLength(block)
  })
  return { blockCount: blocks.length, charCount, headings }
}

/**
 * 差异摘要。
 *
 * @param {object|string} prev 旧侧投影（doc JSON / JSON 字符串 / 指标对象）
 * @param {object|string} next 新侧投影
 * @returns {{ blockCount: object, charCount: object, headings: { added: Array, removed: Array } }}
 *          每个数值项都是 `{ prev, next, delta }`，`delta = next - prev`。
 */
export function diffSummary(prev, next) {
  const before = metricsOf(prev)
  const after = metricsOf(next)
  return {
    blockCount: change(before.blockCount, after.blockCount),
    charCount: change(before.charCount, after.charCount),
    headings: diffHeadings(before.headings, after.headings),
  }
}

function change(prevValue, nextValue) {
  return { prev: prevValue, next: nextValue, delta: nextValue - prevValue }
}

/** 指标对象（已经算好）与 doc JSON（现算）都要能进 —— 判别靠 `content` 数组。 */
function metricsOf(input) {
  const value = parseProjection(input)
  if (!value || typeof value !== 'object') return { ...EMPTY_METRICS }
  if (!Array.isArray(value.content) && Number.isFinite(value.blockCount)) {
    return {
      blockCount: value.blockCount,
      charCount: Number.isFinite(value.charCount) ? value.charCount : 0,
      headings: Array.isArray(value.headings) ? value.headings.map(headingOf) : [],
    }
  }
  return projectionMetrics(value)
}

function parseProjection(input) {
  if (typeof input === 'string') {
    try {
      return JSON.parse(input)
    } catch (error) {
      return null
    }
  }
  return input && typeof input === 'object' ? input : null
}

function headingLevel(block) {
  const level = block && block.attrs ? Number(block.attrs.level) : NaN
  return Number.isInteger(level) && level >= 1 && level <= 6 ? level : 0
}

function textOf(node) {
  if (!node || typeof node !== 'object') return ''
  if (node.type === 'text' && typeof node.text === 'string') return node.text
  if (!Array.isArray(node.content)) return ''
  return node.content.map(textOf).join('')
}

function textLength(node) {
  if (!node || typeof node !== 'object') return 0
  if (node.type === 'text' && typeof node.text === 'string') return node.text.length
  if (!Array.isArray(node.content)) return 0
  let total = 0
  node.content.forEach((child) => { total += textLength(child) })
  return total
}

function headingOf(item) {
  if (!item || typeof item !== 'object') return { level: 0, text: '' }
  return {
    level: Number.isInteger(item.level) ? item.level : 0,
    text: typeof item.text === 'string' ? item.text : '',
  }
}

function headingKey(heading) {
  return `${heading.level}:${heading.text}`
}

function countBy(list) {
  const counts = new Map()
  list.forEach((heading) => {
    const key = headingKey(heading)
    counts.set(key, (counts.get(key) || 0) + 1)
  })
  return counts
}

/**
 * 标题增删按**多重集**算：同名标题出现两次、删掉一次时算「删了一条」，而不是整条消失。
 * 输出保持各自文档里的先后顺序（面板按顺序列出来才像时间线）。
 */
function diffHeadings(prevList, nextList) {
  const nextBudget = countBy(nextList)
  const removed = []
  prevList.forEach((heading) => {
    const key = headingKey(heading)
    const left = nextBudget.get(key) || 0
    if (left > 0) nextBudget.set(key, left - 1)
    else removed.push(headingOf(heading))
  })
  const prevBudget = countBy(prevList)
  const added = []
  nextList.forEach((heading) => {
    const key = headingKey(heading)
    const left = prevBudget.get(key) || 0
    if (left > 0) prevBudget.set(key, left - 1)
    else added.push(headingOf(heading))
  })
  return { added, removed }
}
