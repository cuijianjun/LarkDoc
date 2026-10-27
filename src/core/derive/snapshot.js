/**
 * 派生元信息快照（P7-03）—— 落库时顺手记下「目录长什么样」，载入时先挂目录再灌正文。
 *
 * 为什么需要它：`setContent` 一份 2,000 块文档要几十秒（ProseMirror 要逐块建 DOM），
 * 期间目录面板是空的、状态栏写着 0 个标题。而目录的输入只有**文档结构**，跟装饰、
 * 布局、视口都无关 —— 于是可以在正文还没灌进编辑器之前，先用落库时算好的结果把
 * 面板填上，等正文到位后再由 `refreshDocumentState()` 用实测值覆盖。
 *
 * 三条纪律：
 *   1. **纯函数**。不碰 editor state、不碰 DOM、不碰装饰集，入参只有文档节点或它的
 *      JSON。因此可以在任何阶段调用，也因此在 node 环境里可测。
 *   2. **必须能判伪**。`blockCount` / `fingerprint` 与当前正文对不上就整份作废 ——
 *      错的大纲比空的大纲更糟（用户会照着错目录跳转）。
 *   3. **绝不抛错**。持久化层读回来的任何垃圾只让它返回 `null`，调用方退回实测。
 *      记录里多一个坏字段不该让整篇文档打不开。
 *
 * 为什么不用 `doc.toJSON()` 再走 JSON 一遍：2,000 块的 `toJSON()` 本身就是 20ms 级
 * 的操作（`saveProxyMs` 基线 25ms）。这里的遍历器对「ProseMirror 节点」与「JSON 节点」
 * 是同一份实现（两者都有 `type` / `attrs` / `content` / `text` / `nodeSize`），所以
 * 保存侧直接喂 PM 节点、校验侧喂 JSON，**两边算出的指纹必须逐位相同**（有单测钉住）。
 */
import { collectOutline } from '../documentOperations'

export const DERIVED_SNAPSHOT_VERSION = 1

/**
 * 大纲条数上限。超过就不落快照：截断会给出半份目录（比没有更糟），
 * 而 2,000 个标题的文档已经远超「目录」这个交互形态的容量。
 */
export const DERIVED_SNAPSHOT_MAX_OUTLINE = 2000

/** 参与指纹的 attrs 白名单：只有它们会改变大纲位置/折叠边界，其余（对齐、颜色、
 *  行距…）改了也不该让快照作废。 */
const FINGERPRINT_ATTRS = ['blockId', 'indent', 'level']

/** 大纲条目与顶层字段都按「精确键集」校验：格式受版本号管辖，不做宽容匹配。 */
const OUTLINE_KEYS = ['blockId', 'level', 'pos', 'text']
const SNAPSHOT_KEYS = ['blockCount', 'fingerprint', 'outline', 'v']

const FNV_OFFSET = 0x811c9dc5
const FNV_PRIME = 0x01000193

const typeNameOf = (node) => (typeof node.type === 'string' ? node.type : node && node.type && node.type.name)

/** 同时吃 JSON 节点（content 是数组）与 ProseMirror 节点（content 是 Fragment）。 */
function childrenOf(node) {
  const content = node && node.content
  if (Array.isArray(content)) return content
  if (content && Array.isArray(content.content)) return content.content
  return null
}

/**
 * 一次遍历同时算出块数、文档尺寸与指纹。
 *
 * `size` 是 ProseMirror `doc.content.size` 的**上界**（元素 2 + 子内容，文本取长度；
 * 原子叶子同样按 2 计，比实际多 1），所以可以用它给大纲 `pos` 兜上界，不必先把正文
 * 解析成节点。多算 1 只会让上界更松，不会漏判。
 *
 * @returns {{ blockCount: number, size: number, fingerprint: number } | null}
 */
export function documentMetrics(node) {
  if (!node) return null
  // 入参必须是**文档**：没有 content 字段的 `{type:'doc'}` 是坏 JSON，不是空文档。
  // 空文档长这样：`{type:'doc', content: []}` —— children 是 `[]` 而不是 `null`。
  // PM 节点永远带 Fragment（空 Fragment 的 `.content` 也是 `[]`），所以两条腿一致。
  const rootChildren = childrenOf(node)
  if (!rootChildren) return null
  let hash = FNV_OFFSET
  let broken = false
  const mix = (text) => {
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index)
      hash = Math.imul(hash, FNV_PRIME)
    }
  }
  // 深度 = 树的层数（个位数），不是节点数：递归安全，而且省掉显式栈的进出配对。
  const walk = (current) => {
    if (!current) { broken = true; return 0 }
    const type = typeNameOf(current)
    if (typeof type !== 'string' || !type) { broken = true; return 0 }
    // 分隔符：不 mix 分隔符会让 ['ab','c'] 与 ['a','bc'] 撞指纹。
    mix(type)
    const text = typeof current.text === 'string' ? current.text : null
    if (text !== null) { mix('\u0000'); mix(text) }
    if (current.attrs) {
      for (const key of FINGERPRINT_ATTRS) {
        const value = current.attrs[key]
        if (value === undefined || value === null) continue
        mix(key)
        mix('\u0000')
        mix(String(value))
      }
    }
    // 文本节点到此为止：PM 的文本节点 `content` 是空 Fragment（`.content` 是 `[]`），
    // 若继续往下走会当成「有子节点」而返回 2；JSON 那边没有 content 字段、会返回
    // `text.length` —— 同一份正文两条腿就撞不上。所以文本必须先按长度返回。
    if (text !== null) return text.length
    const children = childrenOf(current)
    // 非文本节点「没有 content」与「content 是空容器」是同一件事，两条腿必须同判：
    // PM 的空 Fragment（`.content` 是 `[]`）与 JSON 省略 `content`（`Node.toJSON()`
    // 在 `content.size === 0` 时直接不写这个字段）都表示空容器。
    // 只按「有没有 content」区分叶子会让**含空段落的文档永远判伪** —— 空段落
    // PM 记 2、JSON 记 1，指纹必然不等，P7-03 的早期水合于是静默失效。
    // 代价：原子叶子（image / hardBreak）也按 2 计，`size` 因此是上界而非等值；
    // 这里只用它给 outline `pos` 兜上界，上界更安全。
    mix('\u0001')
    let inner = 0
    if (children) for (const child of children) inner += walk(child)
    return 2 + inner
  }
  // `doc.content.size` 不含 doc 自身的 2，所以尺寸按子节点求和算，别用 walk 的返回值。
  let size = 0
  for (const child of rootChildren) size += walk(child)
  if (broken) return null
  return { blockCount: rootChildren.length, size, fingerprint: hash >>> 0 }
}

/** 顶层块数；结构不合法返回 -1（调用方据此判伪，不要当成 0）。 */
export function documentBlockCount(json) {
  const metrics = documentMetrics(json)
  return metrics ? metrics.blockCount : -1
}

/** 文档指纹；结构不合法返回 null。 */
export function documentFingerprint(json) {
  const metrics = documentMetrics(json)
  return metrics ? metrics.fingerprint : null
}

function hasExactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const actual = Object.keys(value).sort()
  return actual.length === keys.length && actual.every((key, index) => key === keys[index])
}

function isValidOutlineEntry(entry, limit) {
  if (!hasExactKeys(entry, OUTLINE_KEYS)) return false
  if (!Number.isInteger(entry.pos) || entry.pos < 0) return false
  if (limit !== undefined && entry.pos >= limit) return false
  if (!Number.isInteger(entry.level) || entry.level < 1 || entry.level > 9) return false
  if (typeof entry.text !== 'string') return false
  return entry.blockId === null || typeof entry.blockId === 'string'
}

/**
 * 只验形状、不看文档 —— 持久化层写入前的闸门（两条腿共用这套判定）。
 * `outline` 的 `pos` 上界需要文档尺寸，只在 `validateDerivedSnapshot` 里校。
 */
export function isValidDerivedSnapshot(value) {
  if (!hasExactKeys(value, SNAPSHOT_KEYS)) return false
  if (value.v !== DERIVED_SNAPSHOT_VERSION) return false
  if (!Number.isInteger(value.blockCount) || value.blockCount < 0) return false
  if (!Number.isInteger(value.fingerprint) || value.fingerprint < 0 || value.fingerprint > 0xffffffff) return false
  if (!Array.isArray(value.outline) || value.outline.length > DERIVED_SNAPSHOT_MAX_OUTLINE) return false
  return value.outline.every((entry) => isValidOutlineEntry(entry))
}

/**
 * 从文档节点（PM 节点，或 `doc.toJSON()` 的结果）生成快照。
 * @returns {{ v: number, blockCount: number, fingerprint: number, outline: Array } | null}
 */
export function createDerivedSnapshot(doc) {
  if (!doc || typeof doc.descendants !== 'function') return null
  const metrics = documentMetrics(doc)
  if (!metrics) return null
  const outline = collectOutline(doc).map((item) => {
    const node = doc.nodeAt(item.pos)
    // 节点可能还没补 blockId（老草稿走 ensureLarkDocBlockIds 之前）。
    const blockId = node && node.attrs && node.attrs.blockId
    return {
      pos: item.pos,
      level: Number(item.level) || 1,
      text: typeof item.text === 'string' ? item.text : '',
      blockId: typeof blockId === 'string' && blockId ? blockId : null,
    }
  })
  if (outline.length > DERIVED_SNAPSHOT_MAX_OUTLINE) return null
  // 自证一遍：形状闸门（持久化层用它）不接受的快照不写盘，免得两条腿判定不一致。
  const snapshot = { v: DERIVED_SNAPSHOT_VERSION, blockCount: metrics.blockCount, fingerprint: metrics.fingerprint, outline }
  return isValidDerivedSnapshot(snapshot) ? snapshot : null
}

/**
 * 校验「这份快照仍然是这份正文的」。
 *
 * @param {unknown} value 落库记录里的 `derived` 字段
 * @param {object} json 当前正文的 JSON（`doc.toJSON()` 或落库记录里的 `json`）
 * @returns {{ outline: Array } | null} 可用时返回（已冻结的）大纲，否则 null
 */
export function validateDerivedSnapshot(value, json) {
  // 形状闸门先过：这一步绝不抛（hasExactKeys 对 null/原始值直接 false）。
  if (!isValidDerivedSnapshot(value)) return null
  const metrics = documentMetrics(json)
  if (!metrics) return null
  // 判伪：块数或指纹对不上，说明这份目录不是当前正文的。
  if (metrics.blockCount !== value.blockCount) return null
  if (metrics.fingerprint !== value.fingerprint) return null
  for (const entry of value.outline) {
    if (!isValidOutlineEntry(entry, metrics.size)) return null
  }
  return { outline: value.outline.map((entry) => ({ ...entry })) }
}
