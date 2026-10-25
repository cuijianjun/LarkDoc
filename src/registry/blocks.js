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
export { codeExtension } from '../core/blocks/code-block'
export { EMOJI_GLYPHS, LarkDocEmoji } from '../core/blocks/emoji'
export { UnknownBlock } from '../core/blocks/unknown-block'
export { loadKatex, mathExtension } from '../core/blocks/math'
export { documentKey } from '../core/blocks/document-key'
export { LINE_START_MARKER, applyLineStartMarker, verticalBoundarySelection } from '../core/blocks/document-helpers'
export { createDocumentCommands } from '../core/blocks/document-commands'
export { createDocumentDecorations } from '../core/blocks/document-decorations'
export { documentExtension } from '../core/blocks/document'
