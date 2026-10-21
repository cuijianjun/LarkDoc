/**
 * 权限是能力集合。服务端返回的能力是最终判断，编辑器只用它控制按钮和
 * 交互；这样即使 UI 被绕过，后端仍可拒绝写入、评论或恢复版本。
 *
 * 必需方法：getCapabilities() —— 返回能力对象（Promise 或同步均可）。
 * 宿主实现自定义 Provider 时只需提供该方法；DocumentSession 在构造和
 * setProvider('authorization') 时调用它刷新能力，供 can()/UI 消费。
 */
export const DEFAULT_CAPABILITIES = Object.freeze({
  canView: true,
  canEdit: true,
  canComment: true,
  canResolveComment: true,
  canCreateVersion: true,
  canRestoreVersion: true,
  canExport: true,
  canManagePermission: false,
})

export function normalizeCapabilities(value = {}) {
  return { ...DEFAULT_CAPABILITIES, ...(value && typeof value === 'object' ? value : {}) }
}

/** 校验宿主授权适配器，避免 Session 运行到保存动作才发现接口错误。 */
export function createAuthorizationProvider(provider) {
  if (provider == null) return null
  if (typeof provider.getCapabilities !== 'function') throw new Error('authorization Provider 必须实现 getCapabilities')
  return provider
}
