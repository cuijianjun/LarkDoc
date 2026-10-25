import { createDocumentRecord } from '../core/documentSchema'
import { aggregateHeadingContainers, restoreUnknownBlocks } from '../core/documentOperations'
import { setTransactionMetadata, TRANSACTION_ORIGINS } from '../core/transactionMetadata'
import { createAuthorizationProvider, normalizeCapabilities } from '../providers/authorization'
import { createCollaborationProvider } from '../providers/collaboration'
import { createCommentsProvider } from '../providers/comments'
import { createPersistenceProvider } from '../providers/persistence'
import { createVersioningProvider } from '../providers/versioning'

const PROVIDER_FACTORIES = {
  persistence: createPersistenceProvider,
  collaboration: createCollaborationProvider,
  versioning: createVersioningProvider,
  comments: createCommentsProvider,
  authorization: createAuthorizationProvider,
}

/**
 * 单文档会话。编辑器和工作台只依赖这层，Provider 可以在本地模式或未来的
 * 协同、版本、评论和权限服务之间替换，而不改变 Vue 组件 API。
 */
export class DocumentSession {
  constructor(options = {}) {
    this.documentId = options.documentId == null ? null : String(options.documentId)
    this.mode = options.mode || 'local'
    this.user = options.user || null
    this._editor = null
    this._listeners = new Map()
    this._destroyed = false
    this._capabilities = normalizeCapabilities(options.capabilities)
    this.providers = {}
    const input = options.providers || {}
    Object.keys(PROVIDER_FACTORIES).forEach((name) => {
      const value = input[name] || options[name]
      this.providers[name] = PROVIDER_FACTORIES[name](value)
    })
    if (this.mode === 'collaborative' && !this.providers.collaboration) {
      throw new Error('collaborative 模式必须提供 collaboration Provider')
    }
    if (this.providers.authorization) {
      // Capability loading is asynchronous, so construction must not create an
      // unhandled rejection when a host authorization service is temporarily
      // unavailable. The last known capabilities remain usable for the UI.
      this._capabilitiesPromise = this.refreshCapabilities().catch(error => {
        this.emit('error', error)
        return this.getCapabilities()
      })
    }
  }

  /** 读取一个已验证的 Provider，未配置时返回 null。 */
  getProvider(name) { return this.providers[name] || null }

  /** 在运行时替换 Provider；授权 Provider 替换后立即刷新能力。 */
  setProvider(name, provider) {
    const factory = PROVIDER_FACTORIES[name]
    if (!factory) throw new Error(`未知 Provider：${name}`)
    this.providers[name] = factory(provider)
    if (name === 'authorization' && this.providers.authorization) {
      this._capabilitiesPromise = this.refreshCapabilities().catch(error => {
        this.emit('error', error)
        return this.getCapabilities()
      })
    }
    return this.providers[name]
  }

  /** 返回副本，避免宿主直接修改 Session 内部权限状态。 */
  getCapabilities() { return { ...this._capabilities } }

  /** UI 只用能力控制交互，服务端仍是最终授权方。 */
  can(capability) { return this._capabilities[capability] !== false }

  async refreshCapabilities() {
    const value = await this.providers.authorization.getCapabilities({ documentId: this.documentId, user: this.user })
    this._capabilities = normalizeCapabilities(value)
    this.emit('capabilities', this.getCapabilities())
    return this.getCapabilities()
  }

  /** 绑定 Tiptap 实例，使记录、事务和版本操作共享同一正文。 */
  attachEditor(editor) {
    if (this._destroyed) throw new Error('DocumentSession 已销毁')
    this._editor = editor || null
    this.emit('editor', this._editor)
    return this._editor
  }

  /** 在 Vue 子组件销毁前解除绑定，防止旧编辑器继续接收事件。 */
  detachEditor(editor) {
    if (!editor || this._editor === editor) this._editor = null
    this.emit('editor', null)
  }

  /** 返回当前编辑器实例；宿主不应跨 Session 缓存该引用。 */
  getEditor() { return this._editor }

  /** 给一次 ProseMirror dispatch 写入来源、请求和基线修订信息。 */
  dispatch(transaction, metadata = {}) {
    if (!this._editor || !this._editor.view) throw new Error('DocumentSession 尚未绑定编辑器')
    const next = setTransactionMetadata(transaction, metadata)
    this._editor.view.dispatch(next)
    return next
  }

  /** 以当前编辑器正文生成可保存的版本化记录。 */
  getDocumentRecord(extra = {}) {
    const editor = this._editor
    return createDocumentRecord({
      documentId: this.documentId,
      // 内部 ProseMirror 文档恒为扁平模型；记录出口统一聚合为 v2 容器形态
      // （与组件 getJSON 同口径，避免「标 v2 写 v1」）。
      content: extra.content || (editor && editor.getJSON ? aggregateHeadingContainers(restoreUnknownBlocks(editor.getJSON())) : undefined),
      title: extra.title,
      revisionId: extra.revisionId,
      schemaVersion: extra.schemaVersion,
      updatedAt: extra.updatedAt,
    })
  }

  /** 仅 collaborative 模式连接宿主提供的协同适配器。 */
  async connect() {
    if (this._destroyed) throw new Error('DocumentSession 已销毁')
    const provider = this.providers.collaboration
    if (this.mode !== 'collaborative' || !provider) return { status: 'local' }
    const result = await provider.connect({ documentId: this.documentId, user: this.user, session: this })
    this.emit('connection', result || { status: 'connected' })
    return result
  }

  /** 断开协同连接；本地模式安全地执行空操作。 */
  async disconnect() {
    const provider = this.providers.collaboration
    if (!provider || typeof provider.disconnect !== 'function') return
    await provider.disconnect({ documentId: this.documentId, session: this })
    this.emit('connection', { status: 'disconnected' })
  }

  /** 订阅会话事件并返回可重复调用的取消订阅函数。 */
  on(event, listener) {
    if (typeof listener !== 'function') return () => {}
    const listeners = this._listeners.get(event) || new Set()
    listeners.add(listener)
    this._listeners.set(event, listeners)
    return () => listeners.delete(listener)
  }

  /** 向宿主广播编辑器、能力和连接状态变化。 */
  emit(event, value) {
    const listeners = this._listeners.get(event)
    if (listeners) listeners.forEach(listener => listener(value))
  }

  /** 通过版本 Provider 创建不可变快照。 */
  async createVersion(meta = {}) {
    if (!this.can('canCreateVersion')) throw new Error('当前用户没有创建版本的权限')
    const provider = this.providers.versioning
    if (!provider) throw new Error('未配置 versioning Provider')
    return provider.createSnapshot({ ...this.getDocumentRecord(), ...meta })
  }

  /** 请求恢复版本；Provider 应把恢复实现为新的 revision。 */
  async restoreVersion(versionId) {
    if (!this.can('canRestoreVersion')) throw new Error('当前用户没有恢复版本的权限')
    const provider = this.providers.versioning
    if (!provider) throw new Error('未配置 versioning Provider')
    return provider.restore(versionId, { documentId: this.documentId })
  }

  /** 按连接、编辑器、监听器顺序释放会话资源。 */
  async dispose() {
    if (this._destroyed) return
    this._destroyed = true
    await this.disconnect()
    this._editor = null
    this._listeners.clear()
  }

  get transactionOrigins() { return TRANSACTION_ORIGINS }
}

export function createDocumentSession(options) {
  return new DocumentSession(options)
}
