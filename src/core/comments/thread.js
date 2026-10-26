/**
 * 评论线程与回复 —— requirements/05 §5.5、04 §3.1、09 §5.8（P6b-01）。
 *
 * 读 / 写两条路径刻意不对称：
 *   - 读（`normalizeThread` / `normalizeReply`）宽容。评论来自服务端、旧快照、富文本，
 *     任何一个字段脏了都不该让右侧面板整块白掉；脏条目归一化成 null 由调用方过滤。
 *   - 写（`buildThread` / `buildReply` / `validate*`）严格。空内容、缺作者、非法 blockId
 *     直接抛：04 §3.1 只定义了「未输入时无取消/发送按钮」，没有错误提示位，静默吞掉
 *     只会留下一条谁也改不了的匿名空评论。
 *
 * 05 §5.5 是接口层命名（`status` / `comments` / `anchor.from,to` / `body`），P6b-01
 * 任务单是数据层命名（`resolved` / `replies` / `anchor.offset,length` / `content`）。
 * 本层**输出任务单模型**，读路径同时认 05 的别名，避免宿主适配器各写一份映射。
 *
 * 05 §5.5 要求线程至少 1 条评论（首条即发起评论），所以 `buildThread` 一次产出线程
 * 与首条回复；回复内容是必填，不是空壳线程。
 *
 * 待定：以任务单的 `resolved` / `replies` / `content` 为准（05 的 `status` / `comments`
 * 视为接口别名）；两项都存在且冲突时取任务单字段。
 */

import { isValidBlockId, normalizeAnchor, validateAnchor } from './anchor'

/** 05 §5.5「Actor」的零值：字段齐、值为空，面板不必再判 undefined。 */
export const ANONYMOUS_AUTHOR = Object.freeze({ id: '', name: '', avatarUrl: '', color: '' })

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function toTimestamp(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** 05 §5.5：`author` 是 `{ id, name, avatarUrl?, color? }`；也容忍直接给名字字符串。 */
export function normalizeAuthor(raw) {
  if (typeof raw === 'string') {
    return { id: '', name: raw.trim(), avatarUrl: '', color: '' }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...ANONYMOUS_AUTHOR }
  }
  return {
    id: text(raw.id),
    name: text(raw.name),
    avatarUrl: text(raw.avatarUrl),
    color: text(raw.color),
  }
}

/**
 * 05 §5.5 的正文是 `RichText`，而任务单要 `content: string`。
 * 这里只做「把可读文本抽出来」：字符串 / 带 text 的节点 / 带 content 的文档或数组。
 * 解析富文本是 UI 的事，本层只保证不把对象当字符串塞进面板。
 */
function bodyText(body) {
  if (typeof body === 'string') return body
  if (Array.isArray(body)) return body.map(bodyText).join('')
  if (body && typeof body === 'object') {
    if (typeof body.text === 'string') return body.text
    if (Array.isArray(body.content)) return body.content.map(bodyText).join('')
  }
  return ''
}

/** 05 §5.5：`modify === 1` 表示正文被编辑过，编辑时间取 `updatedAt`。 */
function readEditedAt(raw) {
  if (raw.editedAt != null) return toTimestamp(raw.editedAt)
  if (raw.modify === 1 && raw.updatedAt != null) return toTimestamp(raw.updatedAt)
  return null
}

/** 读路径：null / 非对象 / 数组都是「没有这条回复」，返回 null 让调用方过滤。 */
export function normalizeReply(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const content = typeof raw.content === 'string' ? raw.content : bodyText(raw.content != null ? raw.content : raw.body)
  return {
    id: text(raw.id),
    author: normalizeAuthor(raw.author),
    content,
    createdAt: toTimestamp(raw.createdAt),
    editedAt: readEditedAt(raw),
  }
}

/** 05 §5.5 的 `status` 与任务单的 `resolved` 都认；两者冲突时以 `resolved` 为准。 */
function readResolved(raw) {
  if (typeof raw.resolved === 'boolean') return raw.resolved
  if (raw.status === 'resolved') return true
  if (raw.status === 'open') return false
  return Boolean(raw.resolved)
}

/**
 * 读路径：缺字段给安全默认，绝不抛。
 * blockId 冲突时以顶层为准——05 §5.5 把顶层 blockId 列为身份主键，anchor.blockId 只是
 * 冗余副本；否则一条线程会同时挂在两个块上。
 */
export function normalizeThread(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const rawAnchor = raw.anchor && typeof raw.anchor === 'object' && !Array.isArray(raw.anchor) ? raw.anchor : null
  const anchor = normalizeAnchor(rawAnchor)
  const blockId = text(raw.blockId) || anchor.blockId
  const source = Array.isArray(raw.replies) ? raw.replies : (Array.isArray(raw.comments) ? raw.comments : [])
  const replies = source.map(normalizeReply).filter(Boolean)
  const anchorText = rawAnchor && typeof rawAnchor.text === 'string' ? rawAnchor.text : ''
  return {
    id: text(raw.id),
    blockId,
    anchor: { blockId, offset: anchor.offset, length: anchor.length },
    quote: typeof raw.quote === 'string' ? raw.quote : anchorText,
    resolved: readResolved(raw),
    createdAt: toTimestamp(raw.createdAt),
    author: normalizeAuthor(raw.author),
    replies,
  }
}

/** 写路径的公共校验：内容不能是空白（`'   '` 与 `''` 等价）。 */
function requiredContent(value, label) {
  const content = typeof value === 'string' ? value : bodyText(value)
  if (!content.trim()) throw new Error(`${label}内容不能为空`)
  return content
}

/**
 * 04 §3.1④-3 / ④-2：编辑、删除都限定「自己的」评论，没有作者 id 就没法判定归属，
 * 这类回复一旦落库就永远不可编辑，所以在写入前拦掉。
 */
function requiredAuthor(raw) {
  const author = normalizeAuthor(raw)
  if (!author.id) throw new Error('评论缺少作者 id')
  return author
}

/** 回复写路径：空内容 / 缺作者抛错，其余字段由上下文补（id、时间）。 */
export function buildReply(input, context) {
  const source = input || {}
  const options = context || {}
  const author = requiredAuthor(source.author)
  const content = requiredContent(source.content != null ? source.content : source.body, '回复')
  return {
    id: text(options.id),
    author,
    content,
    createdAt: toTimestamp(options.now),
    editedAt: null,
  }
}

/**
 * 线程写路径。`context` 里的 id 由 Provider 生成（本层不造 id，便于注入确定性序列）。
 * 首条回复与线程共用同一个 now：面板的「刚刚」不该因为两次 Date.now 出现毫秒差。
 */
export function buildThread(input, context) {
  const source = input || {}
  const options = context || {}
  const blockId = text(source.blockId)
  if (!isValidBlockId(blockId)) {
    throw new Error(`评论线程 blockId 不合法：${blockId || '(空)'}`)
  }
  const author = requiredAuthor(source.author)
  const content = requiredContent(source.content != null ? source.content : source.body, '首条评论')
  const anchor = source.anchor == null
    ? { blockId, offset: 0, length: 0 }
    : { ...validateAnchor(source.anchor), blockId }
  const reply = buildReply({ author: source.author, content }, { id: options.replyId, now: options.now })
  return {
    id: text(options.id),
    blockId,
    anchor,
    quote: typeof source.quote === 'string' ? source.quote : '',
    resolved: false,
    createdAt: toTimestamp(options.now),
    author,
    replies: [reply],
  }
}
