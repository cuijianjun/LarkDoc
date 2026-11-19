/**
 * 文档 JSON 校验与 HTML 清洗 —— schema 白名单、未知块占位、外链与属性兜底。
 *
 * 从 `core/documentOperations.js` 原样搬出（函数体一行未改）。所有 JSON 在写入编辑器
 * 之前都要走 `validateDocument`，导入适配器另走 `sanitizeHTML`。
 */
import { safeUrl } from './policy/url'
import { MENTION_KINDS } from './blocks/mention'
import { REMINDER_REPEATS, REMINDER_AT_PATTERN, REMINDER_OFFSETS } from './blocks/reminder'
import { isEmojiGlyph } from './emoji/lookup'
import { isImageCrop, isImageDimension, parseImageCrop } from './media/image-crop'
import { FILE_VIEW_TYPES, safeFileUrl } from './media/file-block'
import { safeLinkCardMeta, readBookmarkUrl, BOOKMARK_LIMITS, RECORD_ID_PATTERN } from './embed/bookmark'
// 外部服务块目录（17 §17.5 tier C / P3 批次）：载入降级要靠它认「这是哪一类外部块」。
// 判定层不 import 本文件（无环），与 mention / reminder 的常量引入同口径。
import {
  EXTERNAL_BLOCK_KINDS, EXTERNAL_PAYLOAD_MAX, EXTERNAL_STATUS,
  externalBlockPreview, isExternalBlockType, safeExternalTitle,
} from './embed/external-block'
import { HEADING_NUMBER_MAX, HEADING_VALUE_MAX } from './headingNumbering'
import { BLOCK_ID_PATTERN } from './documentSections'

// 未知块占位卡 payload 上限（P1-03）：payload 可能承载替代整个子树的原始块 JSON。
export const UNKNOWN_PAYLOAD_MAX = 1000000

// HTML 是导入适配器；所有 JSON 在写入编辑器前必须通过完整 schema 校验。
/** 校验 URL 是否可安全写入 schema：http(s)/mailto/tel/锚点，图片额外放行 data:image 与本地相对路径。返回 boolean。 */

/** Normalize link input without weakening the safeUrl gate used by schema writes. */
export function normalizeLinkUrl(value) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (safeUrl(text)) return text
  if (!/^[^\s/:?#]+\.[^\s/:?#]+(?::\d+)?(?:[/?#].*)?$/.test(text)) return null
  return safeUrl(`http://${text}`) ? `http://${text}` : null
}

/** 校验颜色值（hex / rgb(a) / hsl(a) / CSS 关键字），防止 style 注入。 */
export function safeColor(value) {
  return typeof value === 'string' && (/^#[\da-f]{3,8}$/i.test(value) || /^(rgb|hsl)a?\([\d.,%\s+-]+\)$/i.test(value) || /^[a-z]+$/i.test(value))
}

/** 校验附件 id：非空、长度 ≤1000、不含控制字符。 */
export function safeAttachmentId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 1000 && !Array.from(value).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
}

function validateAttrs(type, attrs, definition) {
  if (attrs === undefined) return
  if (!attrs || typeof attrs !== 'object' || Array.isArray(attrs)) throw new Error(`无效属性：${type}`)
  Object.keys(attrs).forEach((key) => {
    const value = attrs[key]
    if (!definition.attrs || !Object.prototype.hasOwnProperty.call(definition.attrs, key)) throw new Error(`不支持的属性：${type}.${key}`)
    // 公开 TextStyle HTML parser 用空字符串表示未设置的样式，这是合法的原生 JSON。
    if (type === 'textStyle' && value === '' && definition.attrs[key].default === null && ['color', 'backgroundColor', 'fontFamily', 'fontSize', 'lineHeight'].includes(key)) return
    if (value === null) {
      if (definition.attrs[key].default !== null) throw new Error(`必填属性不能为 null：${type}.${key}`)
      return
    }
    let valid = true
    if (key === 'src' || key === 'originalSrc') valid = value === '' || (type === 'fileBlock' ? safeFileUrl(value) : safeUrl(value, true))
    else if (type === 'fileBlock' && key === 'size') valid = Number.isFinite(value) && value >= 0
    else if (key === 'attchId' || key === 'originalAttchId') valid = safeAttachmentId(value)
    else if (type === 'image' && (key === 'naturalWidth' || key === 'naturalHeight')) valid = isImageDimension(value)
    else if (type === 'image' && key === 'crop') valid = isImageCrop(value)
    else if (key === 'href') valid = safeUrl(value)
    else if (key === 'level') valid = Number.isInteger(value) && value >= 1 && value <= 9
    else if (key === 'indent') valid = Number.isInteger(value) && value >= 0 && value <= 8
    else if (type === 'linkEmbed' && (key === 'width' || key === 'height')) valid = Number.isFinite(value) && value >= 88 && value <= (key === 'width' ? 1060 : 4000)
    else if (type === 'column' && key === 'width') valid = Number.isFinite(value) && value > 0 && value <= 100
    else if (type === 'agendaItem' && key === 'durationMinutes') valid = Number.isSafeInteger(value) && value >= 1
    else if (key === 'width' || key === 'height') valid = Number.isFinite(value) && value >= 40 && value <= 2400
    // 内嵌网页（P3-07）的 `aspect` / `bridgeVersion` 都是**数字**，而本白名单的兜底分支
    // 只收字符串 —— 落进来必被判非法，症状是带这两个字段的 webEmbed 一进 setContent
    // 就整块抛错；`bridgeVersion` 有默认值 1，等于「存一次盘再打开就炸」。
    // 这里的区间必须与 blocks/web-embed.js 各自的 validate 逐字一致。
    else if (key === 'aspect') valid = Number.isFinite(value) && value > 0 && value <= 20
    else if (key === 'bridgeVersion') valid = Number.isInteger(value) && value >= 1 && value <= 99
    else if (key === 'lineHeight') valid = /^(normal|[1-4](\.\d{1,2})?)$/.test(String(value))
    else if (key === 'backgroundColor' || key === 'borderColor' || key === 'color') valid = safeColor(value)
    // 高亮块图标：P4-03 起是全量表情，与 blocks/callout.js 的 validate 共用同一次查表。
    else if (key === 'emoji') valid = isEmojiGlyph(value)
    else if (key === 'align') valid = ['left', 'center', 'right'].includes(value)
    else if (key === 'textAlign') valid = ['left', 'center', 'right', 'justify'].includes(value)
    else if (key === 'verticalAlign') valid = ['top', 'middle', 'bottom'].includes(value)
    else if (key === 'language') valid = typeof value === 'string' && /^[\w+-]{0,32}$/.test(value)
    else if (key === 'fontSize') valid = typeof value === 'string' && /^(?:[8-9]|[1-9]\d|1[0-9]\d|200)(px|pt)$/.test(value)
    else if (key === 'fontFamily') valid = typeof value === 'string' && value.length <= 100 && !/[;{}<>\\]/.test(value)
    else if (key === 'colwidth') valid = Array.isArray(value) && value.every((width) => Number.isInteger(width) && width > 0 && width <= 2400)
    else if (key === 'colspan' || key === 'rowspan' || key === 'start') valid = Number.isInteger(value) && value > 0 && value <= 10000
    else if (type === 'codeBlock' && key === 'wrap') valid = typeof value === 'boolean'
    else if (key === 'open' || key === 'checked') valid = typeof value === 'boolean'
    // 「继续编号」标记（ordered-list.js 的布尔属性，默认 false）：`toJSON` 会把默认值
    // 一并写出，落进兜底分支（只收字符串）→ 任何带有序列表的文档存一次盘再打开就整篇
    // 抛错。只对 orderedList 放行，避免别的块借同名 key 钻空子。
    else if (type === 'orderedList' && key === 'continueFrom') valid = typeof value === 'boolean'
    // 提及（P4-01）：`notify` 是**布尔**且默认 true，`kind` 是枚举 —— 兜底分支只收字符串，
    // 落进来必被判非法，症状与 P3-07 的 `aspect` 完全同型：「存一次盘再打开就炸」。
    // 只对 mention 生效，不用 `key === 'notify'` 全局放行，避免别的块借同名 key 钻空子。
    else if (type === 'mention' && key === 'notify') valid = typeof value === 'boolean'
    else if (type === 'mention' && key === 'kind') valid = MENTION_KINDS.indexOf(value) !== -1
    // mentionId 是文档内实例 UUID；`id` 是实体 id（open_id / chat_id / doc token）。
    else if (type === 'mention' && key === 'mentionId') valid = typeof value === 'string' && /^[\w-]{1,64}$/.test(value)
    else if (type === 'mention' && key === 'id') valid = typeof value === 'string' && value.length <= 256 && !value.includes('\u0000')
    // 日期提醒（P4-02a）：`notify` 是布尔、`repeat` 是枚举、`remindAt` 是带时区的 ISO 串。
    // 前两个落进兜底分支必被判非法（兜底只收字符串），`remindAt` 则相反 —— 兜底会
    // 放行任意 10 万字串，这里收紧到 ISO 形状。空串放行：那是 mark 的 schema 默认值。
    else if (type === 'reminder' && key === 'notify') valid = typeof value === 'boolean'
    else if (type === 'reminder' && key === 'hasTime') valid = typeof value === 'boolean'
    else if (type === 'reminder' && key === 'notifyOffset') valid = REMINDER_OFFSETS.includes(value)
    else if (type === 'reminder' && key === 'repeat') valid = REMINDER_REPEATS.indexOf(value) !== -1
    else if (type === 'reminder' && key === 'remindAt') valid = value === '' || (typeof value === 'string' && REMINDER_AT_PATTERN.test(value))
    else if (key === 'blockId') valid = BLOCK_ID_PATTERN.test(String(value))
    // 标题编号：开关是布尔，起点是 1..999 的整数或不设（null = 继续）。
    else if (key === 'numbering') valid = typeof value === 'boolean'
    else if (key === 'numberingStart') valid = Number.isInteger(value) && value >= 1 && value <= HEADING_VALUE_MAX
    else if (type === 'heading' && key === 'numberingLevel') valid = Number.isInteger(value) && value >= 1 && value <= 9
    // 列表项起点（等价 <li value>）：null = 继续前序，数字 = 从该值起算。
    else if (key === 'numberStart') valid = value === null || (Number.isInteger(value) && value >= 1 && value <= HEADING_NUMBER_MAX)
    else if (key === 'target') valid = ['_blank', '_self'].includes(value)
    else if (key === 'rel') valid = typeof value === 'string' && /^[a-z\s-]*$/i.test(value)
    // 未知块占位卡（P1-03）：payload 承载原始块 JSON，可能替代整个子树，上限放宽到 1M 字符。
    else if (type === 'unknownBlock' && key === 'payload') valid = typeof value === 'string' && value.length <= UNKNOWN_PAYLOAD_MAX && !value.includes('\u0000')
    else if (type === 'unknownBlock' && key === 'unknownType') valid = typeof value === 'string' && value.length >= 1 && value.length <= 100 && !value.includes('\u0000')
    // 外部服务块（17 §17.5）：与 unknownBlock 同款保真卡，多出来的五个字段是「可解释的
    // disabled 状态」所需。`status` 是枚举（落兜底分支会被当普通字符串放过任意值），
    // `sourceUrl` 走 `safeUrl`（与 href / src 同闸门），`kind` 只认目录内登记的。
    else if (type === 'externalBlock' && key === 'payload') valid = typeof value === 'string' && value.length <= EXTERNAL_PAYLOAD_MAX && !value.includes('\u0000')
    else if (type === 'externalBlock' && key === 'kind') valid = typeof value === 'string' && value.length <= 64 && !value.includes('\u0000') && (value === '' || isExternalBlockType(value))
    else if (type === 'externalBlock' && key === 'title') valid = safeExternalTitle(value)
    else if (type === 'externalBlock' && key === 'reason') valid = safeExternalTitle(value)
    else if (type === 'externalBlock' && key === 'sourceUrl') valid = value === '' || safeUrl(value)
    else if (type === 'externalBlock' && key === 'provider') valid = typeof value === 'string' && value.length <= 64 && /^[a-z][a-z0-9_.-]*$/.test(value)
    else if (type === 'externalBlock' && key === 'status') valid = [EXTERNAL_STATUS.UNAVAILABLE, EXTERNAL_STATUS.READONLY, EXTERNAL_STATUS.READY].indexOf(value) !== -1
    else valid = typeof value === 'string' && value.length <= 100000 && !value.includes('\u0000')
    if (!valid) throw new Error(`不安全或无效的属性：${type}.${key}`)
  })
}

/**
 * 标题容器读取兼容（P1-02 第一步「先读兼容」）。
 *
 * 飞书标题块是容器：`heading-children` 把「直到下一同级标题之间的内容」收进
 * 标题内部（02 §2）。容器形态的 JSON 允许 heading 节点携带 `children` 数组；
 * 本包写入侧目前仍是 v1 扁平模型，因此读入口在这里把容器展平为等价扁平
 * JSON：子块按原顺序拼接到标题之后，嵌套标题递归展开。
 *
 * - 纯函数：不修改入参；结果继续过 validateDocument 常规全量校验，安全性不放宽。
 * - 非 heading 节点上的 `children` 原样保留，仍由 validateDocument 拒绝（不放宽白名单）。
 * - heading 的 `children` 非数组视为容器语义不成立，丢弃该字段按普通标题处理。
 */
export function flattenHeadingContainers(json) {
  if (!json || typeof json !== 'object') return json
  const walk = (node) => {
    if (Array.isArray(node)) return node.flatMap(walk)
    if (!node || typeof node !== 'object') return node
    const next = { ...node }
    if (Array.isArray(next.content)) next.content = next.content.flatMap(walk)
    if (next.type !== 'heading') return next
    delete next.children
    if (!Array.isArray(node.children)) return next
    const flat = node.children.flatMap(walk).filter((child) => child && typeof child === 'object')
    return flat.length ? [next, ...flat] : [next]
  }
  const result = walk(json)
  return Array.isArray(result) ? result[0] : result
}

/**
 * 扁平 → 容器聚合（flattenHeadingContainers 的逆；P1-02 第二步切写入 + P1-04 迁移 v1→v2）。
 *
 * 02 §2 口径：标题分节 =「直到下一同级（或更浅）标题之间的内容」收进该标题的
 * children；分节内更深的标题递归聚合自己的分节（嵌套分节永远不会越过父分节
 * 边界——父边界标题层级更浅，必然同时终结子分节）；缩进块保留 attrs.indent
 * 原样作为子块，不额外嵌套。
 *
 * - 纯函数：不修改入参；对已是容器形态的输入幂等（既有 children 原样保留）。
 * - 非 doc 顶层 JSON 直通返回；聚合结果继续由 validateDocument 全量校验。
 */
export { aggregateHeadingContainers } from './documentJSON'

/**
 * 占位块还原（P1-03 / 17 §17.5）：`unknownBlock` / `externalBlock` → payload 内原始 JSON，
 * 导出侧保真出口。
 *
 * 两类占位卡共用一条通道：两者的 `payload` 都是原始块 JSON 的逐字节副本，区别只在
 * 显示层（认不出 vs 认得出没接服务），还原时对导出侧没有差别 —— 且 §17.5 明确要求
 * `unsupported` / `provider` 块「不能在导入/保存时丢字段」。
 *
 * - 编辑器 getJSON 里未知块只以占位卡存在；导出 / 落库前经本函数还原为原始块
 *   JSON（key 顺序逐字节保真，stringify/parse 幂等），再次载入时 validateDocument
 *   会重新降级为占位卡——一来一回不丢字节。
 * - payload 损坏（非字符串 / 空 / parse 失败 / 还原结果缺 type）时保留占位卡原样。
 * - 还原结果可能仍含未知 type（正是原始形态），消费方不得再过 validateDocument。
 * - 纯函数：不修改入参；heading.children 容器形态同步递归。
 */
export { restoreUnknownBlocks } from './documentJSON'

/** 未知块占位卡：原始 JSON 逐字节进 payload（`JSON.stringify` 保 key 顺序，stringify/parse 幂等）。 */
function unknownBlockCard(item) {
  const payload = JSON.stringify(item)
  return {
    type: 'unknownBlock',
    attrs: {
      payload: payload.length <= UNKNOWN_PAYLOAD_MAX ? payload : '',
      unknownType: String(item.type).split('\u0000').join('').slice(0, 100) || 'unknown',
    },
  }
}

/**
 * 官方块 payload 用的是本地 schema 不认识的**属性名**（agenda 的 `agendaId` + `items` 之类）。
 *
 * 这是一种「形状不同」而不是「取值不合法」：本地同名节点只认自己那套属性，硬校验必拒
 * （`不支持的属性：agenda.agendaId`），但 §17.5 要求这类 payload 不能丢字段。判定只看
 * 属性名 —— 已知属性上的非法取值（时长 0、枚举越界）照旧抛错，取值校验一点没放宽。
 */
function hasForeignAttrs(item, type) {
  if (!item.attrs || typeof item.attrs !== 'object') return false
  return Object.keys(item.attrs).some((key) => !type.attrs || !Object.prototype.hasOwnProperty.call(type.attrs, key))
}

/** 全量校验 Tiptap JSON（节点/属性/深度/规模白名单）并返回规范化 JSON，导入与快照恢复的必经入口。 */
export function validateDocument(json, schema) {
  // 标题容器形态（heading.children）先展平成扁平模型再校验（P1-02 读取兼容）。
  json = flattenHeadingContainers(json)
  if (!json || json.type !== 'doc') throw new Error('请输入有效的 Tiptap 文档 JSON')
  let count = 0
  let textCount = 0
  function visit(item, depth) {
    if (!item || typeof item !== 'object' || depth > 100) throw new Error('文档结构过深或过大')
    if (item.type === 'documentSegment') throw new Error('内部文档分段不能作为公开正文导入')
    // A text paragraph has two nodes. Sharing the structural budget with its
    // text leaf rejected the supported 52k-block import before rendering began.
    // Keep both bounded, without increasing the existing structural/depth caps.
    if (item.type === 'text' ? ++textCount > 100000 : ++count > 100000) throw new Error('文档结构过深或过大')
    const type = schema.nodes[item.type]
    if (!type) {
      // 17 §17.5：登记过但本地没实现的官方块（chat_card / jira_issue / okr* …）降级为
      // `externalBlock` —— 认得出是哪一类，卡片就能给出「未接入 Jira」这种可解释的
      // disabled 文案，而不是一句「暂不支持」。保真口径与下面的 unknownBlock 完全一致。
      if (isExternalBlockType(item.type)) {
        const meta = EXTERNAL_BLOCK_KINDS[item.type]
        const preview = externalBlockPreview(item)
        const payload = JSON.stringify(item)
        return {
          type: 'externalBlock',
          attrs: {
            kind: item.type,
            payload: payload.length <= EXTERNAL_PAYLOAD_MAX ? payload : '',
            title: preview.title,
            sourceUrl: safeUrl(preview.sourceUrl) ? preview.sourceUrl : '',
            provider: meta.provider || '',
            status: EXTERNAL_STATUS.UNAVAILABLE,
            reason: '',
          },
        }
      }
      // P1-03：未知块就地降级为占位卡，原始 JSON 逐字节存进 payload
      // （JSON.stringify 保 key 顺序，stringify/parse 幂等）。payload 超 1M 时
      // 放弃保真只存占位（载入优先于还原）；unknownType 供副文案展示。
      return unknownBlockCard(item)
    }
    // 登记过的官方块用了官方那套属性名（agenda 的 agendaId + items）：本地同名节点只认
    // 自己那套属性，硬校验必拒。字段不能丢（17 §17.5），走与未知块同一条保真出口。
    if (isExternalBlockType(item.type) && hasForeignAttrs(item, type)) return unknownBlockCard(item)
    const unknown = Object.keys(item).find((key) => !['type', 'attrs', 'content', 'marks', 'text'].includes(key))
    if (unknown) throw new Error(`不支持的节点字段：${unknown}`)
    validateAttrs(item.type, item.attrs, type)
    if (item.type === 'text' && (typeof item.text !== 'string' || !item.text)) throw new Error('文本节点不能为空')
    if (item.type !== 'text' && item.text !== undefined) throw new Error('非文本节点包含 text')
    if (item.content !== undefined && !Array.isArray(item.content)) throw new Error('content 必须为数组')
    if (item.marks !== undefined && !Array.isArray(item.marks)) throw new Error('marks 必须为数组')
    ;(item.marks || []).forEach((mark) => {
      const markType = mark && schema.marks[mark.type]
      if (!markType) throw new Error(`不支持的格式：${mark && mark.type}`)
      if (Object.keys(mark).some((key) => !['type', 'attrs'].includes(key))) throw new Error('不支持的格式字段')
      validateAttrs(mark.type, mark.attrs, markType)
    })
    // content 逐个递归：子级若是未知块会被替换为占位卡，需用替换结果重组数组。
    let next = item
    if (Array.isArray(item.content)) {
      const content = item.content.map((child) => visit(child, depth + 1))
      if (content.some((child, index) => child !== item.content[index])) next = { ...item, content }
    }
    return next
  }
  json = visit(json, 0)
  const node = schema.nodeFromJSON(json)
  node.check()
  node.descendants((child) => {
    if (child.type.name === 'image' && !safeUrl(child.attrs.src, true)) throw new Error('图片地址无效')
  })
  return node.toJSON()
}

/** 清洗粘贴/导入的 HTML：标签、属性、style 全走白名单，返回安全的 HTML 字符串。 */
export function sanitizeHTML(html) {
  if (typeof html !== 'string') throw new Error('HTML 必须为字符串')
  const container = document.createElement('div')
  container.innerHTML = html
  const tags = new Set(['P', 'DIV', 'SPAN', 'MARK', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'DEL', 'CODE', 'PRE', 'SUB', 'SUP', 'BLOCKQUOTE', 'HR', 'UL', 'OL', 'LI', 'A', 'IMG', 'FIGURE', 'FIGCAPTION', 'TABLE', 'TBODY', 'THEAD', 'TR', 'TH', 'TD', 'COLGROUP', 'COL', 'DETAILS', 'SUMMARY', 'LABEL', 'INPUT'])
  const dangerous = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH', 'TEMPLATE', 'NOSCRIPT', 'LINK', 'META', 'BASE', 'FRAME', 'FRAMESET'])
  const linkAttributes = new Set(['data-href', 'data-view', 'data-height', 'data-title', 'data-card-meta', 'data-link-view', 'data-link-title', 'data-link-card-meta', 'data-url', 'data-desc', 'data-favicon', 'data-cover', 'data-record-id'])
  const fileAttributes = {
    'data-src': safeFileUrl,
    'data-original-src': safeFileUrl,
    'data-token': safeAttachmentId,
    'data-cover-url': value => safeUrl(value, true),
    'data-mime-type': value => /^[\w+.-]+\/[\w+.-]+$/.test(value),
    'data-size': value => value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0,
    'data-view-type': value => FILE_VIEW_TYPES.includes(value),
  }
  const revisionAttributes = new Set(['data-revision-id', 'data-revision-author', 'data-revision-kind', 'data-deletion-revision-id', 'data-deletion-author'])
  const attributes = new Set(['href', 'src', 'alt', 'title', 'width', 'colspan', 'rowspan', 'colwidth', 'start', 'value', 'open', 'type', 'checked', 'disabled', 'data-type', 'data-level', 'data-width', 'data-align', 'data-original-src', 'data-attch-id', 'data-original-attch-id', 'data-crop', 'data-natural-width', 'data-natural-height', 'data-caption', 'data-code-wrap', 'data-latex', 'data-name', 'data-emoji', 'data-checked', 'data-colwidth', 'data-color', 'data-language', 'data-indent', 'data-block-id', 'data-numbering', 'data-numbering-start', 'data-numbering-level', 'data-continue-from', 'data-token', 'data-mention-kind', 'data-mention-id', 'data-department', 'data-notify', 'data-remind-at', 'data-repeat', 'data-has-time', 'data-notify-offset', 'data-item-id', 'data-duration-minutes', 'class'])
  Array.from(container.querySelectorAll('*')).forEach((element) => {
    if (!container.contains(element)) return
    const tag = element.tagName.toUpperCase()
    if (dangerous.has(tag)) { element.remove(); return }
    if (!tags.has(tag)) {
      // 普通布局容器只拆外壳；原快照中的后代仍逐个清理，危险子树整段删除。
      while (element.firstChild) element.parentNode.insertBefore(element.firstChild, element)
      element.remove()
      return
    }
    Array.from(element.attributes).forEach((attribute) => {
      const name = attribute.name.toLowerCase()
      if (name === 'style') {
        const style = element.style
        const allowed = {}
        ;['color', 'background-color', 'text-align', 'vertical-align', 'font-family', 'font-size', 'line-height', 'width', 'padding-left'].forEach((property) => {
          const value = style.getPropertyValue(property)
          if (value && !/[<>;{}\\]|url\s*\(|expression|var\s*\(/i.test(value)) allowed[property] = value
        })
        element.removeAttribute('style')
        Object.keys(allowed).forEach((property) => { element.style.setProperty(property, allowed[property]) })
      } else if (linkAttributes.has(name) || (name === 'data-width' && element.getAttribute('data-type') === 'link-embed')) {
        const linkBlock = tag === 'DIV' && element.getAttribute('data-type') === 'link-embed'
        const bookmark = tag === 'DIV' && element.getAttribute('data-type') === 'bookmark'
        const text = (limit, codepoints = false) => (codepoints ? Array.from(attribute.value).length : attribute.value.length) <= limit && !attribute.value.includes('\u0000')
        let valid = false
        if (name === 'data-href') valid = linkBlock && attribute.value.length <= 100000 && safeUrl(attribute.value)
        else if (name === 'data-view') valid = linkBlock && ['link', 'title', 'card', 'preview'].includes(attribute.value)
        else if (name === 'data-width' || name === 'data-height') valid = linkBlock && Number.isFinite(Number(attribute.value)) && Number(attribute.value) >= 88 && Number(attribute.value) <= (name === 'data-width' ? 1060 : 4000)
        else if (name === 'data-title') valid = (linkBlock || bookmark) && text(bookmark ? BOOKMARK_LIMITS.title : 100000, bookmark)
        else if (name === 'data-card-meta') valid = linkBlock && safeLinkCardMeta(attribute.value)
        else if (name === 'data-link-view') valid = tag === 'A' && ['link', 'title'].includes(attribute.value)
        else if (name === 'data-link-title') valid = (tag === 'A' || bookmark) && text(100000)
        else if (name === 'data-link-card-meta') valid = tag === 'A' && safeLinkCardMeta(attribute.value)
        else if (name === 'data-url' || name === 'data-favicon' || name === 'data-cover') valid = bookmark && readBookmarkUrl(attribute.value) !== null
        else if (name === 'data-desc') valid = bookmark && text(BOOKMARK_LIMITS.desc, true)
        else if (name === 'data-record-id') valid = bookmark && RECORD_ID_PATTERN.test(attribute.value)
        if (!valid) element.removeAttribute(name)
      } else if (revisionAttributes.has(name)) {
        const validTag = name.startsWith('data-deletion-') ? tag === 'PRE' : tag === 'SPAN'
        if (!validTag || attribute.value.length > 100000 || attribute.value.includes('\u0000') || name === 'data-revision-kind' && !['insert', 'delete'].includes(attribute.value)) element.removeAttribute(name)
      } else if (tag === 'FIGURE' && element.getAttribute('data-type') === 'file' && Object.prototype.hasOwnProperty.call(fileAttributes, name)) {
        if (!fileAttributes[name](attribute.value)) element.removeAttribute(name)
      } else if (!attributes.has(name)) element.removeAttribute(name)
      else if (name === 'data-color' && (tag !== 'MARK' || !safeColor(attribute.value))) element.removeAttribute(name)
      else if (name === 'colwidth') {
        // Tiptap 输出 colwidth；每个跨列格保留对应的正整数列宽，沿用 JSON 的 2400 上限。
        const widths = attribute.value.split(',').map(Number)
        if (!['TH', 'TD'].includes(tag) || !/^\d+(,\d+)*$/.test(attribute.value) || widths.length !== Number(element.getAttribute('colspan') || 1) || !widths.every(width => Number.isInteger(width) && width > 0 && width <= 2400)) element.removeAttribute(name)
      } else if (name === 'href' && !safeUrl(attribute.value)) element.removeAttribute(name)
      // 列表项起点（等价 <li value>）：只认 li 上的 1..10000 正整数。
      else if (name === 'value' && (tag !== 'LI' || !/^[1-9]\d{0,3}$/.test(attribute.value))) element.removeAttribute(name)
      else if (name === 'data-crop' && (!['IMG', 'FIGURE'].includes(tag) || !parseImageCrop(attribute.value))) element.removeAttribute(name)
      else if (['data-natural-width', 'data-natural-height'].includes(name) && (!['IMG', 'FIGURE'].includes(tag) || !isImageDimension(Number(attribute.value)))) element.removeAttribute(name)
      else if ((name === 'src' || name === 'data-original-src') && !safeUrl(attribute.value, true)) element.removeAttribute(name)
      else if ((name === 'data-attch-id' || name === 'data-original-attch-id') && (!['IMG', 'FIGURE'].includes(tag) || !safeAttachmentId(attribute.value))) element.removeAttribute(name)
      else if (name === 'class' && !/^(language-[\w+-]+|tiptap-mathematics-render)$/.test(attribute.value)) element.removeAttribute(name)
      else if (name === 'data-numbering-level' && !/^[1-9]$/.test(attribute.value)) element.removeAttribute(name)
      else if (name === 'data-align' && !['left', 'center', 'right'].includes(attribute.value)) element.removeAttribute(name)
      // 提及（P4-01）：身份属性必须落进 schema 认识的形态 —— 放行一个畸形值，
      // 结果是「粘贴一段带 @ 的富文本 → 整篇 setContent 抛错」，比丢掉 attr 严重得多。
      else if (name === 'data-notify' && !['true', 'false'].includes(attribute.value)) element.removeAttribute(name)
      else if (name === 'data-has-time' && !['true', 'false'].includes(attribute.value)) element.removeAttribute(name)
      else if (name === 'data-notify-offset' && (!/^\d+$/.test(attribute.value) || !REMINDER_OFFSETS.includes(Number(attribute.value)))) element.removeAttribute(name)
      else if (name === 'data-remind-at' && !REMINDER_AT_PATTERN.test(attribute.value)) element.removeAttribute(name)
      else if (name === 'data-repeat' && REMINDER_REPEATS.indexOf(attribute.value) === -1) element.removeAttribute(name)
      else if (name === 'data-mention-kind' && MENTION_KINDS.indexOf(attribute.value) === -1) element.removeAttribute(name)
      else if (name === 'data-mention-id' && !/^[\w-]{1,64}$/.test(attribute.value)) element.removeAttribute(name)
      else if (name === 'data-token' && (attribute.value.length > 256 || attribute.value.includes('\u0000'))) element.removeAttribute(name)
    })
    if (element.tagName === 'INPUT') {
      if (element.getAttribute('type') !== 'checkbox') element.remove()
      else element.setAttribute('disabled', '')
    }
    if (element.tagName === 'A') element.setAttribute('rel', 'noopener noreferrer')
  })
  return container.innerHTML
}
