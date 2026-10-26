/**
 * 评论数据层的唯一入口 —— 09 §5.8（P6b-01）。
 *
 * UI / 宿主只从这里 import：内部按「线程模型 / 锚点 / 状态 / 内存实现」拆了四个文件，
 * 拆分方式随时会动，公开面只认这一层。`providers/comments` 的两个契约符号也在这里
 * 转出，免得使用者在 core 与 providers 之间来回找。
 */

export { COMMENT_METHODS, createCommentsProvider } from '../../providers/comments'

export {
  ANONYMOUS_AUTHOR,
  normalizeAuthor,
  normalizeReply,
  normalizeThread,
  buildReply,
  buildThread,
} from './thread'

export {
  isValidBlockId,
  normalizeAnchor,
  validateAnchor,
  createAnchorCodec,
  plainAnchorCodec,
  encodeAnchor,
  decodeAnchor,
  blockIdLookup,
  anchorBinding,
  withAnchorBinding,
  partitionThreads,
} from './anchor'

export { sortThreads, resolveThread, reopenThread, unreadCount } from './state'

export { createMemoryCommentsProvider } from './memory-provider'
