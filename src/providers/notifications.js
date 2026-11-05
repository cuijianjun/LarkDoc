/**
 * 可选的宿主通知边界（specs/002 quickstart）：未配置时返回 null，
 * 不改变现有 UI 的宿主注入和 notify-* 事件路径。
 *
 * 配置后必需方法：list(context)、markAllRead(context)、setMuted(muted, context)。
 * list 返回通知数组，或 `{ items, muted }` 快照（需要重开后恢复静音时使用）；
 * 写操作支持 void 成功或成功回执，非终态 ProviderTask 不代表完成。
 * context 由调用方传入，可携带 documentId、user；通知读取、持久化与最终授权
 * 由宿主负责，注册 Provider 不代表通知已经送达。
 *
 * 可选 subscribe(listener, context) 返回取消订阅函数；事件可为 snapshot、
 * upsert、remove、read、mute。本层不订阅、不投影事件，也不包裹 ProviderTask；
 * 返回值和异常原样交给调用方。与 comments/versioning 一致保留原对象与方法 this，
 * Session 替换或销毁不自动调用通知方法或 dispose；订阅发起方负责取消订阅。
 */
export const NOTIFICATION_METHODS = ['list', 'markAllRead', 'setMuted']

/** 只校验宿主方法，不创建通知服务或发起读写。 */
export function createNotificationsProvider(provider) {
  if (provider == null) return null
  const missing = NOTIFICATION_METHODS.filter(method => typeof provider[method] !== 'function')
  if (missing.length) throw new Error(`notifications Provider 缺少方法：${missing.join(', ')}`)
  return provider
}
