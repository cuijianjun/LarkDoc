/**
 * 版本 Provider 保存不可变快照和恢复操作。恢复应由服务端创建新版本，
 * 不覆盖原版本；本阶段只定义接口，不启用远端实现。
 *
 * 必需方法：list、createSnapshot、get、restore。
 * DocumentSession 的 createVersion/restoreVersion 只消费 createSnapshot
 * 与 restore，并先经 canCreateVersion/canRestoreVersion 能力把关。
 */
export const VERSIONING_METHODS = ['list', 'createSnapshot', 'get', 'restore']

/** 校验不可变版本边界；真正的版本权限和并发检查由服务端完成。 */
export function createVersioningProvider(provider) {
  if (provider == null) return null
  const missing = VERSIONING_METHODS.filter(method => typeof provider[method] !== 'function')
  if (missing.length) throw new Error(`versioning Provider 缺少方法：${missing.join(', ')}`)
  return provider
}
