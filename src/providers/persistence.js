import { createWorkspace } from '../components/feishu/workspace'

/**
 * 持久化 Provider 保持现有 Demo 的 load/save/snapshots/snapshot/restore 契约。
 * 它只保存草稿和本地快照，不承担协同状态或权限判断。
 *
 * 必需方法：load（读草稿）、save（写草稿）、snapshots（列快照）、
 * snapshot（建快照）、restore（恢复快照）。工作台组件经 callWorkspace
 * 调用它们实现防抖保存与快照面板；宿主传 localStorage 以外的适配器即可
 * 把草稿落到任意后端。
 */
export const PERSISTENCE_METHODS = ['load', 'save', 'snapshots', 'snapshot', 'restore']

/** 校验草稿/快照适配器，同时保留旧工作区的同步和异步兼容性。 */
export function createPersistenceProvider(provider) {
  if (provider == null) return null
  const missing = PERSISTENCE_METHODS.filter(method => typeof provider[method] !== 'function')
  if (missing.length) throw new Error(`persistence Provider 缺少方法：${missing.join(', ')}`)
  return provider
}

export function createLocalPersistence(storage, options = {}) {
  return createWorkspace(storage, options)
}
