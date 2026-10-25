/**
 * 卡片契约（cardEmbed，飞书卡片形态）—— requirements/09 §3.5。
 *
 * 卡片渲染在 DOM（不走 iframe）：可被搜索、可导出 PDF/DOCX、可被评论锚定、
 * 可参与协同。与 webEmbed 的分界线：内容小、需要被搜索/导出/协同 → 卡片；
 * 内容是独立运行时 → iframe；不确定时选 iframe。
 *
 * 契约规则（写死）：
 * - 体积上限 8 KB：超出只存 resourceId + 摘要，正文不回写文档；
 * - 动作冒泡：按钮点击 → onAction({ providerId, resourceId, actionId, payload, action })，
 *   跳转/提交由宿主决定，编辑器不持 token；
 * - 未知 providerId：渲染「未知卡片」占位并原样保留 payload，不做 schema 迁移、不丢数据；
 * - cardVersion 不匹配：按「只读 + 原样保留」处理，等宿主升级。
 *
 * P3-04 补的两层（本文件是它们唯一的出处）：
 *
 *   1. **写路径 `normalizeCard` / `encodeCard`** —— 严格：卡片身份（providerId + 标题）
 *      不合格就抛错，由 `setCardEmbed` 转成「命令返回 false」；内容字段（desc / fields /
 *      actions / cover）按上限裁齐而不是整张拒收 —— 一个超长 desc 不该让用户点了确定
 *      什么也没发生。
 *   2. **读路径 `readCard`** —— 宽容：解析失败、结构不是对象、超过 8 KB 都只返回 null，
 *      绝不抛错。渲染层的每一次 `readCard` 都可能是「别人写的、比我们新的」数据，
 *      这里抛错等于打开文档就白屏。读路径**不做 normalize**，未知字段原样留着 ——
 *      这就是「不做 schema 迁移、不丢数据」的落点：我们只读自己认识的键。
 *
 * 为什么存成「一个 JSON 字符串」而不是拆成多个 attrs：§3.5 那张表就是 card 的形状，
 * 拆成 attrs 会造出两个真相（`attrs.providerId` 与 `card.providerId` 谁对？）。
 * 整串进 `attrs.card`，8 KB 判定、序列化、DOM 往返都比对整串，简单且不会漂移。
 *
 * @typedef {Object} CardAction
 * @property {string} id
 * @property {string} label
 * @property {'open'|'command'} kind
 * @property {string} [href]      kind === 'open' 时的跳转地址
 * @property {string} [commandId] kind === 'command' 时冒泡给宿主的命令
 *
 * @typedef {Object} CardSchema
 * @property {number} cardVersion
 * @property {string} providerId 谁的卡片
 * @property {string|null} resourceId 服务端对象 id（可空）
 * @property {{title: string, desc: string, fields: Array<{label: string, value: string}>, cover: string|null}} payload
 * @property {CardAction[]} actions
 * @property {boolean} [truncated] 本仓库附加：true = 只存了摘要（§3.5 体积上限的产物），
 *   不是飞书契约字段。没有它，渲染层无法区分「这张卡本来就没有正文」和「正文被裁了」。
 */
import { safeUrl } from '../documentOperations'

/** 当前实现的卡片版本；读到的 cardVersion 比它大 = 只读（等宿主升级）。 */
export const CARD_VERSION = 1

/** 卡片体积上限（§3.5：8 KB）。按 UTF-8 字节算，不是字符数 —— 中文一字 3 字节。 */
export const CARD_MAX_BYTES = 8 * 1024

/**
 * 各字段上限。数值不是产品定的，是「一张卡不该大过一屏」的工程上限：
 * 12 条字段 + 4 个动作已经排到卡片下半屏，再多就该换成 iframe。
 */
const LIMITS = Object.freeze({
  providerId: 64,
  resourceId: 128,
  title: 300,
  desc: 2000,
  fields: 12,
  fieldLabel: 40,
  fieldValue: 200,
  actions: 4,
  actionId: 64,
  actionLabel: 40,
  commandId: 128,
  href: 2048,
})

/** 摘要标题上限：裁到 120 字后连同一圈元数据约 1 KB，离 8 KB 上限很远。 */
const SUMMARY_TITLE = 120

/**
 * 控制字符（`\t` `\n` `\r` 除外）：这些字符进 DOM 只会变成不可见垃圾，
 * 进 JSON 又会让「同一个字符串两份字节」比较失真。
 */
// eslint-disable-next-line no-control-regex -- 这里的控制字符区间就是规则要拦的那批字符
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/

/** UTF-8 字节数。不用 TextEncoder：Node 14 与老浏览器上它不总是全局可用。 */
export function utf8Bytes(text) {
  if (typeof text !== 'string' || !text) return 0
  let bytes = 0
  for (const char of text) {
    const code = char.codePointAt(0)
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4
  }
  return bytes
}

/** 按字符（不是码元）截断，避免把 emoji 的代理对劈成半个。 */
function clip(text, limit) {
  return Array.from(text).slice(0, limit).join('')
}

/** 文本字段：去首尾空白、拒绝控制字符、超长截断。非字符串返回 null。 */
function cleanText(value, limit) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text || CONTROL_RE.test(text)) return null
  return text.length > limit ? clip(text, limit) : text
}

/** id 类字段：要求非空、超长即无效（不截断 —— 截断的 id 指向另一个对象，比丢字段更糟）。 */
function readId(value, limit) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text || text.length > limit || CONTROL_RE.test(text)) return null
  return text
}

function normalizeFields(fields) {
  if (!Array.isArray(fields)) return []
  return fields.slice(0, LIMITS.fields).reduce((acc, field) => {
    if (!field || typeof field !== 'object' || Array.isArray(field)) return acc
    const label = cleanText(field.label, LIMITS.fieldLabel)
    const value = cleanText(field.value, LIMITS.fieldValue)
    if (label && value) acc.push({ label, value })
    return acc
  }, [])
}

/** 封面只收 http(s)：data URL 会直接顶爆 8 KB 上限，8 KB 里放不下一张能看的图。 */
function readCover(cover) {
  return typeof cover === 'string' && cover.length <= LIMITS.href && safeUrl(cover) ? cover : null
}

function normalizeActions(actions) {
  if (!Array.isArray(actions)) return []
  const seen = new Set()
  const kept = []
  // 口径：**先过滤、再截断**。「最多 4 个动作」指的是卡片上真有 4 个按钮，
  // 不是「只看前 4 条输入」—— 否则前面几条非法项会把后面的合法动作全挤掉，
  // 用户看到一张一个按钮都没有的卡片。
  for (const action of actions) {
    if (kept.length >= LIMITS.actions) break
    if (!action || typeof action !== 'object' || Array.isArray(action)) continue
    const id = readId(action.id, LIMITS.actionId)
    const label = cleanText(action.label, LIMITS.actionLabel)
    if (!id || !label || seen.has(id)) continue
    if (action.kind === 'open') {
      const href = readId(action.href, LIMITS.href)
      // 只认 http(s)/mailto/tel（safeUrl 的口径）；`javascript:` 这类直接丢动作，
      // 而不是留一个点了会执行脚本的按钮。
      if (!href || !safeUrl(href)) continue
      seen.add(id)
      kept.push({ id, label, kind: 'open', href })
    } else if (action.kind === 'command') {
      const commandId = readId(action.commandId, LIMITS.commandId)
      if (!commandId) continue
      seen.add(id)
      kept.push({ id, label, kind: 'command', commandId })
    }
  }
  return kept
}

/**
 * 写路径：把外部塞进来的卡片整理成契约形状。**非法即抛错**（由命令转成 false）。
 *
 * 只有三处「拒收」：不是对象、providerId 不合格、payload.title 不合格。
 * 其余一律裁齐 —— 理由见文件头第 1 条。
 */
export function normalizeCard(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('无效卡片：不是对象')
  const version = input.cardVersion === undefined ? CARD_VERSION : Number(input.cardVersion)
  // 比当前版本大的卡片**允许写入**（别的宿主写进来的），只读由渲染层判 ——
  // 在这里拒收等于「打开一份新文档就不能保存」。
  if (!Number.isInteger(version) || version < 1 || version > 99) throw new Error('无效卡片：cardVersion')
  const providerId = readId(input.providerId, LIMITS.providerId)
  if (!providerId) throw new Error('无效卡片：providerId')
  const payload = input.payload
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('无效卡片：payload')
  const title = cleanText(payload.title, LIMITS.title)
  if (!title) throw new Error('无效卡片：payload.title')
  return {
    cardVersion: version,
    providerId,
    resourceId: readId(input.resourceId, LIMITS.resourceId),
    payload: {
      title,
      desc: cleanText(payload.desc, LIMITS.desc) || '',
      fields: normalizeFields(payload.fields),
      cover: readCover(payload.cover),
    },
    actions: normalizeActions(input.actions),
    ...(input.truncated === true ? { truncated: true } : {}),
  }
}

/** 超限降级形态：只留 identity + 标题摘要（§3.5 字面要求）。 */
function shrinkCard(card) {
  return {
    cardVersion: card.cardVersion,
    providerId: card.providerId,
    resourceId: card.resourceId,
    payload: {
      title: clip(card.payload.title, SUMMARY_TITLE),
      desc: '',
      fields: [],
      cover: null,
    },
    actions: [],
    truncated: true,
  }
}

/**
 * 写路径的终点：规范化 → 序列化 → 超 8 KB 就换成摘要形态再序列化。
 *
 * 摘要形态放不下时抛错而不是继续截：那意味着常量被改坏了，静默丢成空串会让
 * 「为什么我的卡片只剩标题」永远查不出来。
 */
export function encodeCard(input) {
  const card = normalizeCard(input)
  const text = JSON.stringify(card)
  if (utf8Bytes(text) <= CARD_MAX_BYTES) return text
  const summary = JSON.stringify(shrinkCard(card))
  if (utf8Bytes(summary) > CARD_MAX_BYTES) throw new Error('卡片摘要超出体积上限')
  return summary
}

/**
 * 读路径：**永不抛错**。解析失败 / 不是对象 / 超 8 KB 一律 null。
 *
 * 不做 normalize（未知字段原样留着），不做版本判断（那是渲染层的 `isFutureCard`）。
 * 超过 8 KB 直接判 null 而不是照读：写入侧已保证落库数据不会超限，出现超限只可能是
 * 手工改过的 JSON —— 与其渲染一张 50 KB 的卡，不如落到「数据缺失」占位。
 */
export function readCard(raw) {
  if (typeof raw !== 'string' || !raw || utf8Bytes(raw) > CARD_MAX_BYTES) return null
  let parsed
  try { parsed = JSON.parse(raw) } catch (_) { return null }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  return parsed
}

/** cardVersion 比我们新 → 只读（§3.5「只读 + 原样保留」）。 */
export function isFutureCard(card) {
  const version = Number(card && card.cardVersion)
  return Number.isFinite(version) && version > CARD_VERSION
}

/**
 * providerId 是否是我们认识的那几家。
 *
 * 默认（`providers` 为空）= **全认**：通用卡片布局能画任何 payload，把所有卡片都盖成
 * 「未知卡片」等于 P3-04 白做。宿主一旦声明了 `providers`，没声明的才走占位卡 ——
 * 那是「某家的卡片必须专属 UI」时才需要收紧的闸门（P3-08 引用卡）。
 */
export function isKnownProvider(providerId, providers) {
  if (!Array.isArray(providers) || providers.length === 0) return true
  return providers.indexOf(providerId) !== -1
}

/** 卡片 schema 基准形状（示例值 = requirements/09 §3.5，实现侧据此校验与降级）。 */
export const cardSchema = {
  cardVersion: 1,
  providerId: 'task_research',
  resourceId: 'tr_123',
  payload: {
    title: '2026 Q4 用户调研',
    desc: '12 题，约 3 分钟',
    fields: [{ label: '截止', value: '11-15' }],
    cover: null,
  },
  actions: [
    { id: 'open', label: '去填写', kind: 'open', href: 'https://example.com/survey/tr_123' },
    { id: 'submit', label: '提交', kind: 'command', commandId: 'card.submit' },
  ],
}
