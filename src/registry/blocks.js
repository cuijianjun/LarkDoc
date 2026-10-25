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
// P4-02a：行内日期提醒。它是 **mark**（挂在文本上），文案由 `remindAt` 派生 ——
// 契约层（重复枚举 / ISO 形状 / 文案派生 / 规范化）同源再导出，宿主造 chip 只从这里取
// `normalizeReminder`，不自己算「明天几点」。
export {
  LarkDocReminder, REMINDER_REPEATS, REMINDER_REPEAT_LABELS, REMINDER_AT_PATTERN,
  createDefaultRemindAt, normalizeReminder, readReminder, reminderLabel, reminderText,
} from '../core/blocks/reminder'
// P4-02b：日程卡片块。本质是**引用**一条已有日程（不是自建表单），块里存 `eventId` +
// 一份允许过期的展示快照。契约层（尺寸 / id 与时间闸门 / 日期行与提醒行派生 / 只匹配
// 标题的搜索匹配 / 规范化 / markup）同源再导出，宿主与搜索面板都只从这里取。
export {
  CalendarEvent, CALENDAR_EVENT_ID_PATTERN, CALENDAR_EVENT_JOIN_LABEL,
  CALENDAR_EVENT_LIMITS, CALENDAR_EVENT_ORGANIZER_LABEL, CALENDAR_EVENT_RSVP,
  CALENDAR_EVENT_RSVP_LABELS, CALENDAR_EVENT_SIZES, CALENDAR_EVENT_VERSION,
  calendarEventDateLine, calendarEventFromSearch, calendarEventReminderLine,
  calendarEventSearchMatch, calendarTimezoneLabel, normalizeCalendarEvent,
  readCalendarEvent, readCalendarTime, renderCalendarEventCard,
} from '../core/blocks/calendar-event'
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
