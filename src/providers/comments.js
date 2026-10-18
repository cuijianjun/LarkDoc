/**
 * 评论数据独立于正文保存。anchor 由 blockId 和 Provider 位置抽象组成，
 * 不把瞬时的 ProseMirror from/to 坐标作为长期评论身份。
 */
export const COMMENT_METHODS = ['list', 'createThread', 'reply', 'resolve', 'reopen']

/** 校验评论边界；线程与锚点的持久化由宿主服务负责。 */
export function createCommentsProvider(provider) {
  if (provider == null) return null
  const missing = COMMENT_METHODS.filter(method => typeof provider[method] !== 'function')
  if (missing.length) throw new Error(`comments Provider 缺少方法：${missing.join(', ')}`)
  return provider
}
