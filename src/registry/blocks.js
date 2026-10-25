/**
 * 块注册表：core/blocks 全部块定义与工厂的统一出口（P0-04 硬规则 1）。
 *
 * 依赖方向固定为 components/ ──→ registry/ ──→ core/：
 * 装配层与适配层只从这里拿块定义，不许绕过注册表直接深挖 core 内部路径。
 * core 不许反向 import 本目录或 components/。
 */
export { LarkDocBlockquote } from '../core/blocks/quote'
export { levels, validateAttribute } from '../core/blocks/shared'
export { LarkDocHeading } from '../core/blocks/heading'
export { calloutEmojis, safeCalloutEmoji, Callout } from '../core/blocks/callout'
export { Columns, Column } from '../core/blocks/columns'
export { LarkDocOrderedList } from '../core/blocks/ordered-list'
export { LarkDocListItemNumber } from '../core/blocks/list-item-number'
export { LarkDocBlockId } from '../core/blocks/block-id'
export { BLOCK_ID_META, INDENT_META, applyBlockIdFixes, applyIndentFixes } from '../core/blocks/block-fixes'
export { nextBlockIndent, Formatting } from '../core/blocks/formatting'
export { imageExtension } from '../core/blocks/image'
export { FileBlock, fileBlockKind, fileBlockNeedsPreview, canRenderFileBlock } from '../core/blocks/file-block'
// P3-01：内嵌网页块。判定层（高度 / src 合法性 / sandbox 默认值）一并从这里出，
// 上层装配与三端覆盖只用认识本注册表。
export {
  WebEmbed, canRenderWebEmbed, resolveEmbedHeight, safeEmbedSrc,
  WEB_EMBED_DEFAULT_HEIGHT, WEB_EMBED_MIN_HEIGHT, WEB_EMBED_MAX_HEIGHT,
} from '../core/blocks/web-embed'
// P3-04：卡片块。契约层（8 KB 上限 / 版本判定 / provider 闸门 / 编解码）同源再导出，
// 宿主只从这里取 `encodeCard` 造卡片，不自己拼 JSON。
export {
  CardEmbed, CARD_MAX_BYTES, CARD_VERSION, cardSchema, encodeCard,
  isFutureCard, isKnownProvider, normalizeCard, readCard, utf8Bytes,
} from '../core/blocks/card-embed'
// P3-05：网页卡片块。`bookmark` 的契约（两档高度 / URL 闸门 / 元数据解析）同源再导出，
// 宿主只从这里取 `readBookmark` / `normalizeBookmark`，不自己拼 attrs。
export {
  Bookmark, BOOKMARK_HEIGHTS, BOOKMARK_LIMITS, BOOKMARK_VARIANT, BOOKMARK_VERSION,
  normalizeBookmark, readBookmark, readBookmarkHost, readBookmarkMeta, readBookmarkUrl,
} from '../core/blocks/bookmark'
export { codeExtension } from '../core/blocks/code-block'
export { EMOJI_GLYPHS, LarkDocEmoji } from '../core/blocks/emoji'
// P4-01：行内提及（人员 / 群名片 / 云文档共用同一个 atom）。契约层（kind 枚举 /
// 字段上限 / 规范化 / 纯文本形态）同源再导出，宿主造 chip 只从这里取 `normalizeMention`。
export {
  LarkDocMention, MENTION_KINDS, MENTION_KIND_LABELS, MENTION_LIMITS,
  MENTION_UNKNOWN_NAME, MENTION_EMPTY_TEXT, createMentionId, normalizeMention,
  readMention, mentionPlainText,
} from '../core/blocks/mention'
// P4-01：提及候选源（本地名单过滤 + 可选 provider）—— 纯逻辑，无 DOM。
export {
  MENTION_SEARCH_LIMIT, MENTION_RESOLVE_LIMIT, DEFAULT_MENTION_TIMEOUT,
  normalizeMentionEntry, normalizeMentionDirectory, searchMentionDirectory, createMentionProvider,
} from '../core/mention/directory'
export { UnknownBlock } from '../core/blocks/unknown-block'
export { loadKatex, mathExtension } from '../core/blocks/math'
export { documentKey } from '../core/blocks/document-key'
export { LINE_START_MARKER, applyLineStartMarker, verticalBoundarySelection } from '../core/blocks/document-helpers'
export { createDocumentCommands } from '../core/blocks/document-commands'
export { createDocumentDecorations } from '../core/blocks/document-decorations'
export { documentExtension } from '../core/blocks/document'
