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
export { CALLOUT_EMOJI_DEFAULT, safeCalloutEmoji, Callout } from '../core/blocks/callout'
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
// P4-03：行内 emoji 的形状从 11 条硬编码换成 emojibase 全量表（1898 条 / 9 组）。
// 同源再导出查表与全量表元信息，宿主与面板都不许自己维护字形字典。
export {
  EMOJI_DEFAULT_NAME, emojiGlyph, LarkDocEmoji,
} from '../core/blocks/emoji'
export {
  EMOJI_GROUP_META, EMOJI_NAME_MAX, emojiItems, emojiCategories, emojiGroupOf,
  normalizeEmojiName, normalizeEmojiGlyph, findEmojiByName, findEmojiByGlyph,
  isEmojiGlyph, searchEmoji,
} from '../core/emoji/catalog'
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
// P4-04：第三方文档小组件块（目录导航 / 按钮）。一个节点类型、两种形态 —— 判定层
// （实例键 / 高度 / 面板几何 / 目录树 / 按钮校验）同源再导出，宿主、NodeView、按钮
// 配置面板三点共用一份，谁都不许自己维护常量副本。
export {
  Isv, ISV_APP_ID, ISV_BUILD_TS, ISV_BUILD_HASH, ISV_CDN_ORIGIN, ISV_KINDS, ISV_ALIGNS,
  ISV_DEFAULT_HEIGHT, ISV_BUTTON_HEIGHT, ISV_MIN_HEIGHT, ISV_MAX_HEIGHT,
  ISV_INSTANCE_PATTERN, ISV_BUTTON_ACTIONS, BUTTON_ACTION_DEFAULT, BUTTON_TEXT_DEFAULT,
  BUTTON_TEXT_MAX, ISV_VALIDATION_MESSAGE, ISV_REQUIRED_FIELDS, ISV_PANEL,
  isvInstanceId, isvEmbedUrl, isvPanelHeight, catalogIndent, catalogFontWeight,
  readIsv, resolveIsvHeight, readIsvAlign, normalizeIsv, validateIsvButton,
  isButtonLinkValid, normalizeButtonLink, safeIsvLink,
  buildCatalogTree, flattenCatalogTree,
} from '../core/blocks/isv'
// P4-01：提及候选源（本地名单过滤 + 可选 provider）—— 纯逻辑，无 DOM。
export {
  MENTION_SEARCH_LIMIT, MENTION_RESOLVE_LIMIT, DEFAULT_MENTION_TIMEOUT,
  normalizeMentionEntry, normalizeMentionDirectory, searchMentionDirectory, createMentionProvider,
} from '../core/mention/directory'
// P4-06：修订建议。它是 **mark**（挂在文本上，容器套内层两层 span），契约层
// （kind 枚举 / 面板几何 / 三态高度 / 六按钮 / 建议收集与定位 / 决定语义）同源再导出，
// 面板与事务跟踪都只从这里取，谁都不许自己维护常量副本。
export {
  LarkDocRevision, REVISION_ACTIONS, REVISION_BUTTONS, REVISION_BUTTON_IDS, REVISION_HEIGHTS,
  REVISION_KINDS, REVISION_LABELS, REVISION_PANEL, REVISION_PANEL_TITLE,
  collectRevisions, createRevisionId, normalizeRevision, readRevision, revisionAt,
  revisionDecision, revisionMarkOf, revisionPanelHeight, revisionRanges, revisionSummary,
} from '../core/blocks/revision'
// P4-06：修订的运行时三层 —— 事务跟踪（键入即落标记）/ 装饰（激活高亮）/ 判定命令
// （接受、拒绝、前后跳、复制锚点）。同样只从这里出，装配层不直接摸 core/revision 内部。
export {
  LarkDocRevisionTracker, REVISION_SKIP_META, REVISION_TRACK_META,
  adjacentRevisionId, buildRevisionMarkTr, deleteDecision, deletionRange,
  insertedRanges, isBulkReplace, mergeRanges, revisionSpans,
} from '../core/revision/tracker'
export {
  LarkDocRevisionHighlight, buildRevisionActiveTr, buildRevisionDecorations,
  revisionActiveKey, revisionHighlightPlugin,
} from '../core/revision/decorations'
export {
  adjacentRevision, buildRevisionDecisionTr, revisionAnchor, revisionJumps, revisionTarget,
} from '../core/revision/commands'
export { UnknownBlock } from '../core/blocks/unknown-block'
export { loadKatex, mathExtension } from '../core/blocks/math'
export { documentKey } from '../core/blocks/document-key'
export { LINE_START_MARKER, applyLineStartMarker, verticalBoundarySelection } from '../core/blocks/document-helpers'
export { createDocumentCommands } from '../core/blocks/document-commands'
export { createDocumentDecorations } from '../core/blocks/document-decorations'
export { documentExtension } from '../core/blocks/document'
// P5-02：电子表格块。几何常量 / 归一化 / 编解码 / canvas 绘制全部同源再导出 ——
// NodeView 与单测只从这里取「105 / 27 / 344×83 / 324×9」这套数字，别处不许出现第二份。
export {
  Sheet, SHEET_DEFAULT, SHEET_GEOMETRY, SHEET_LIMITS, SHEET_SCROLLBAR, SHEET_VERSION, SHEET_VIEWPORT,
  cellKey, cellText, clampOffsetX, columnBoundaries, columnLabel, contentSize, encodeSheet,
  fitText, maxOffset, normalizeSheet, paintSheet, readSheet, rowBoundaries, scrollThumb,
  staticRows, visibleColumns, visibleRows,
} from '../core/blocks/sheet'
// P5-03：投票块。几何常量 / 归一化 / 编解码 / 本地状态机（`pollReducer`）全部同源再导出 ——
// NodeView 与单测只从这里取「534×480 / 78 / 44 步进 / 三态块高」这套数字与状态转移，
// 别处不许出现第二份。
export {
  Poll, POLL_GEOMETRY, POLL_HEIGHT, POLL_LIMITS, POLL_STATUS, POLL_VERSION,
  blockHeight, byteLength, canVote, cleanText, deadlineLabel, defaultPoll, encodePoll,
  formatPercent, headerLabels, normalizePoll, optionLabel, pollReducer, pollStatus,
  publishHint, publishReady, readPoll, tally, tomorrowDeadline,
} from '../core/blocks/poll'
