/**
 * 协同 Provider 的最小边界。核心包不绑定 Yjs、Hocuspocus 或具体 WebSocket
 * 地址；宿主显式传入 Provider 后，Session 才会连接。
 */
export const COLLABORATION_METHODS = ['connect', 'disconnect']

/** 校验协同边界；连接细节由宿主决定，核心包不绑定传输协议。 */
export function createCollaborationProvider(provider) {
  if (provider == null) return null
  const missing = COLLABORATION_METHODS.filter(method => typeof provider[method] !== 'function')
  if (missing.length) throw new Error(`collaboration Provider 缺少方法：${missing.join(', ')}`)
  return provider
}
