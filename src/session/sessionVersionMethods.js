/**
 * 文档会话 —— 版本与转换域。
 *
 * 自动历史版本的节流与脏标记、手动建版本、恢复（含本地快照的「未知结果」收敛）、
 * 版本正文读取与 diff，以及远端转换（导入 / 导出）的四条命令入口。
 */
import { normalizeDocumentRecord } from '../core/documentSchema'
import { decodeVersionDocument } from '../core/versioning/document-codec'
import { snapshotKindFromPurpose } from '../core/versioning/types'
import { validateDocument } from '../core/documentOperations'
import { TRANSACTION_ORIGINS } from '../core/transactionMetadata'

export const AUTO_VERSION_INTERVAL_MS = 60000
export const AUTO_SNAPSHOT_DEBOUNCE_MS = 2500

export const versionMethods = {
  setAutoVersion(enabled) {
    this._autoVersionEnabled = enabled !== false
    if (!this._autoVersionEnabled) this._autoVersionDirty = false
    if (!this._autoVersionEnabled && this._autoVersionTimer) { clearTimeout(this._autoVersionTimer); this._autoVersionTimer = null }
    return this._autoVersionEnabled
  },

  setAutoSnapshot(patch) {
    if (patch && typeof patch === 'object') {
      if (Object.prototype.hasOwnProperty.call(patch, 'enabled')) this.setAutoVersion(patch.enabled)
      if (Object.prototype.hasOwnProperty.call(patch, 'debounce')) {
        this._autoVersionDebounce = Number.isFinite(patch.debounce) && patch.debounce >= 0 ? patch.debounce : AUTO_SNAPSHOT_DEBOUNCE_MS
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'minInterval')) {
        this._autoVersionMinInterval = Number.isFinite(patch.minInterval) && patch.minInterval >= 0 ? patch.minInterval : AUTO_VERSION_INTERVAL_MS
      }
      if (this._autoVersionDirty && this._autoVersionEnabled) {
        clearTimeout(this._autoVersionTimer)
        this._autoVersionTimer = null
        this._armAutoVersion(this._autoVersionDebounce)
      }
    }
    return { enabled: this._autoVersionEnabled, debounce: this._autoVersionDebounce, minInterval: this._autoVersionMinInterval }
  },

  /**
   * 编辑器每次 `update` 只做两件事：标记「正文脏了」，确保有一个尾部定时器在跑。
   *
   * **不在 `update` 里直接提交**是刻意的：飞书的历史记录是「一段编辑落定后的补记」，
   * 不是击键日志。同步提交还会把自动版本插进用户显式操作的中间（另存、恢复前后），
   * 让版本序号和并发校验对不上。
   */
  _bindAutoVersion(editor) {
    if (!editor || typeof editor.on !== 'function') return
    this._autoVersionListener = () => {
      if (!this._autoVersionEnabled) return
      this._autoVersionDirty = true
      clearTimeout(this._autoVersionTimer)
      this._autoVersionTimer = null
      const wait = this._autoVersionAt ? this._autoVersionAt + this._autoVersionMinInterval - Date.now() : 0
      this._armAutoVersion(Math.max(wait, this._autoVersionDebounce))
    }
    editor.on('update', this._autoVersionListener)
  },

  _unbindAutoVersion(editor) {
    if (this._autoVersionTimer) { clearTimeout(this._autoVersionTimer); this._autoVersionTimer = null }
    if (editor && this._autoVersionListener && typeof editor.off === 'function') editor.off('update', this._autoVersionListener)
    this._autoVersionListener = null
    this._autoVersionDirty = false
  },

  /**
   * 记一条自动历史版本。四条硬约束缺一条都会在生产里出事：
   *
   *   1. **节流**：`AUTO_VERSION_INTERVAL_MS` 内最多一条，否则历史面板变成击键日志；
   *   2. **内容去重**：正文与上一条自动版本相同就跳过 —— 光标移动、选区变化同样会触发
   *      `update`，那不是「新版本」；
   *   3. **失败静默**：自动保存不弹错、不打断输入，用户打开历史面板时 `list()` 照实反映
   *      后端状态，那才是唯一真相；
   *   4. **只在有权限且有 Provider 时**：只读预览、未接版本服务都直接空跑。
   *
   * @param {object} [meta] 透传给 `createVersion`（如 `label`）。
   * @returns {Promise<object|null>} 新版本元信息；被节流/去重/无权限/失败时为 null。
   */
  async requestAutoVersion(meta = {}) {
    if (this._destroyed || !this._autoVersionEnabled) return null
    if (!this.can('canCreateVersion') || !this.providers.versioning) return null
    // 已在提交中：保留「正文仍然是脏的」这个标记，等这次落地后再补一次，绝不并发发两条。
    if (this._autoVersionRunning) { this._autoVersionDirty = true; return null }
    const now = Date.now()
    const wait = this._autoVersionAt + this._autoVersionMinInterval - now
    if (this._autoVersionAt && wait > 0) { this._autoVersionDirty = true; this._armAutoVersion(wait); return null }
    // 先清脏标记再取正文：请求期间的新编辑会重新置脏，由 finally 决定是否补下一轮。
    this._autoVersionDirty = false
    this._autoVersionRunning = true
    try {
      const record = this.getDocumentRecord()
      const signature = JSON.stringify(record.content === undefined ? null : record.content)
      if (signature === this._autoVersionSignature) return null
      const created = await this.createVersion({
        ...meta,
        purpose: 'auto',
        ...(record.content === undefined ? {} : { content: record.content }),
      })
      this._autoVersionSignature = signature
      this._autoVersionAt = now
      return created
    } catch (_) {
      // 失败也推后节流窗口：否则每次按键都会重试同一次失败，把接口打成靶子。
      this._autoVersionAt = now
      return null
    } finally {
      this._autoVersionRunning = false
      if (this._autoVersionDirty) this._armAutoVersion(this._autoVersionDebounce)
    }
  },

  /** 尾部定时器到期时再次核对节流和权限。 */
  _armAutoVersion(delay) {
    if (this._autoVersionTimer || this._destroyed || !this._autoVersionEnabled) return
    this._autoVersionTimer = setTimeout(() => {
      this._autoVersionTimer = null
      void this.requestAutoVersion()
    }, Math.max(0, delay))
    // 浏览器里返回数字（没有 unref）；Node 里挂 unref，测试进程不被待执行定时器吊住。
    if (this._autoVersionTimer && typeof this._autoVersionTimer.unref === 'function') this._autoVersionTimer.unref()
  },

  /** 通过版本 Provider 创建不可变快照。 */
  async createVersion(meta = {}) {
    if (!this.can('canCreateVersion')) throw new Error('当前用户没有创建版本的权限')
    const provider = this.providers.versioning
    if (!provider) throw new Error('未配置 versioning Provider')
    if (provider.isRemote || typeof provider.documentCodec?.encode !== 'function') {
      return this._identityAction(() => provider.createSnapshot({ ...this.getDocumentRecord(), ...meta }))
    }
    const scope = this._localVersionScope('canCreateVersion')
    if (meta.documentId !== undefined && meta.documentId !== scope.documentId) throw new Error('版本不属于当前文档')
    const body = scope.editor?.state.doc
    const currentContent = !Object.prototype.hasOwnProperty.call(meta, 'payload') && !Object.prototype.hasOwnProperty.call(meta, 'content')
    const record = { ...this.getDocumentRecord(meta), ...meta }
    if (record.author === undefined) record.author = scope.actor
    // `kind` 必须跟着 `purpose` 走：这里以前硬编码 `'manual'`，于是 `purpose: 'auto'`
    // 的自动快照会被记成手动 —— 而手动是「永久保留」，结果是自动版本永远不被保留策略
    // 淘汰，保留策略形同虚设，历史记录只增不减。
    if (record.kind === undefined) record.kind = snapshotKindFromPurpose(record.purpose)
    if (record.payload === undefined) record.payload = await provider.documentCodec.encode(record)
    scope.check()
    const result = await this._identityAction(() => provider.createSnapshot(record))
    const created = await this._confirmLocalVersion(result, scope, record.kind)
    scope.check()
    if (currentContent && scope.editor?.state.doc === body) this._currentVersion = { id: created.id, body, scope }
    this.emit('version-created', created)
    return created
  },

  /** 请求恢复版本；Provider 应把恢复实现为新的 revision。 */
  async restoreVersion(versionId) {
    if (!this.can('canRestoreVersion')) throw new Error('当前用户没有恢复版本的权限')
    const provider = this.providers.versioning
    if (!provider) throw new Error('未配置 versioning Provider')
    if (provider.isRemote || typeof provider.documentCodec?.encode !== 'function') {
      return this._identityAction(() => provider.restore(versionId, { documentId: this.documentId }))
    }
    const scope = this._localVersionScope('canRestoreVersion')
    if (this.mode === 'collaborative') throw new Error('协作文档须通过持久版本服务还原')
    if (this._pendingLocalRestore) {
      try { this._pendingLocalRestore.scope.check() } catch (_) { this._pendingLocalRestore = null }
      if (this._pendingLocalRestore) throw this._localVersionUnknown(this._pendingLocalRestore.operationId)
    }
    const access = this._documentAccess, context = { scope, access, versionId, body: scope.editor?.state.doc, ownsReadonly: false }
    this._checkLocalRestore(context)
    if (scope.editor && (typeof access?.prepareContent !== 'function' || typeof access?.applyPreparedContent !== 'function')) throw new Error('本地版本还原缺少文档访问端口')
    context.document = await this.readVersionDocument(versionId)
    this._checkLocalRestore(context)
    if (access) access.prepareContent(context.document.content)
    this._checkLocalRestore(context)
    try {
      const result = await this._identityAction(() => provider.restore(versionId, { documentId: scope.documentId, author: scope.actor }))
      return await this._applyLocalRestore(context, result)
    } catch (error) {
      const operationId = this._localVersionUnknown(error.operationId).operationId
      if (error.status === 'unknown' && operationId) {
        try {
          this._checkLocalRestore(context)
          context.operationId = operationId
          this._pendingLocalRestore = context
          if (scope.editor?.isEditable) { context.ownsReadonly = true; scope.editor.setEditable(false) }
        } catch (_) { /* The original unknown fact survives a retired view. */ }
      }
      throw error
    }
  },

  _checkLocalRestore(context) {
    const { scope, access, body, ownsReadonly } = context, editor = scope.editor
    const readonly = access?.isReadonly?.()
    scope.check()
    if (editor && (editor.state.doc !== body || readonly === true || !this.can('canEdit')
      || (!editor.isEditable && !(ownsReadonly && readonly === false)))) throw new Error('正文已更改或当前为只读，版本还原已失效')
  },

  async _applyLocalRestore(context, result) {
    const { scope, access, versionId } = context
    const created = await this._confirmLocalVersion(result, scope, 'restore', versionId)
    this._checkLocalRestore(context)
    if (access) {
      const prepared = access.prepareContent(context.document.content)
      this._checkLocalRestore(context)
      access.applyPreparedContent(prepared, { origin: TRANSACTION_ORIGINS.RESTORE })
      scope.check()
      if (access.isReadonly?.() === true) throw new Error('版本还原视图已变为只读')
      if ((scope.editor.storage?.larkDoc?.pagedView?.logicalDocument(scope.editor.state.doc) || scope.editor.state.doc).eq(prepared.next)) this._currentVersion = { id: created.id, body: scope.editor.state.doc, scope }
    }
    if (this._pendingLocalRestore === context) this._pendingLocalRestore = null
    if (context.ownsReadonly && (!this.can('canEdit') || access?.isReadonly?.() !== false)) throw new Error('版本还原视图仍为只读')
    if (context.ownsReadonly && scope.editor && !scope.editor.isEditable) scope.editor.setEditable(true)
    scope.check()
    this.emit('version-restored', created)
    return created
  },

  async queryLocalVersionRestore(operationId) {
    const context = this._pendingLocalRestore
    if (!context || context.operationId !== operationId || typeof context.scope.provider.queryRestoreOperation !== 'function') throw this._localVersionUnknown(operationId)
    this._checkLocalRestore(context)
    context.document = await this.readVersionDocument(context.versionId)
    this._checkLocalRestore(context)
    const result = await context.scope.provider.queryRestoreOperation(operationId)
    this._checkLocalRestore(context)
    if (result?.operationId !== operationId) throw this._localVersionUnknown(operationId)
    return this._applyLocalRestore(context, result)
  },

  async queryLocalVersionCreation(operationId) {
    const scope = this._localVersionScope('canCreateVersion')
    if (!this._localVersionUnknown(operationId).operationId || scope.provider.isRemote || typeof scope.provider.documentCodec?.encode !== 'function'
      || typeof scope.provider.queryOperation !== 'function') throw this._localVersionUnknown(operationId)
    const result = await scope.provider.queryOperation(operationId)
    scope.check()
    if (result?.operationId !== operationId) throw this._localVersionUnknown(operationId)
    return this._confirmLocalVersion(result, scope, 'manual')
  },

  _localVersionScope(capability) {
    const provider = this.providers.versioning, editor = this._editor, access = this._documentAccess
    const documentId = this.documentId, actor = this.user?.id
    const authorization = this._authorizationGeneration, identity = this._privateIdentityGeneration, authentication = this._identityGeneration
    const versioning = this._versioningProviderGeneration, conversion = this._conversionGeneration
    const check = () => {
      if (!this.can(capability) || provider !== this.providers.versioning || editor !== this._editor || access !== this._documentAccess
        || documentId !== this.documentId || actor !== this.user?.id || authorization !== this._authorizationGeneration
        || identity !== this._privateIdentityGeneration || authentication !== this._identityGeneration || versioning !== this._versioningProviderGeneration || conversion !== this._conversionGeneration) {
        throw new Error('版本操作权限或文档上下文已失效')
      }
    }
    check()
    return { provider, editor, documentId, actor, check }
  },

  async _confirmLocalVersion(result, scope, kind, sourceId) {
    const unavailable = cause => this._localVersionUnknown(result?.operationId, cause)
    const { createSnapshot } = await import('../core/versioning/snapshot')
    scope.check()
    if (!result || (result.status !== undefined && result.status !== 'committed') || typeof result.id !== 'string'
      || !result.id.trim() || result.id.includes('\0') || result.id === sourceId || result.documentId !== scope.documentId || result.kind !== kind) throw unavailable()
    let confirmed
    try { confirmed = createSnapshot(result) } catch (error) { throw unavailable(error) }
    scope.check()
    return { ...result, ...confirmed }
  },

  _localVersionUnknown(operationId, cause) {
    return Object.assign(new Error('本地版本结果待确认，不会自动重试或替换正文'), { status: 'unknown', cause },
      typeof operationId === 'string' && operationId.length && !operationId.includes('\0') ? { operationId } : {})
  },

  getCurrentVersionId() {
    const current = this._currentVersion
    if (!current || current.body !== this._editor?.state.doc) return null
    try { current.scope.check(); return current.id || null } catch (_) { return null }
  },

  _conversionProvider(capability) {
    if (this._destroyed || !this.can(capability)) throw new Error('当前用户没有该版本或转换操作权限')
    const provider = this.providers.versioning
    if (!provider) throw new Error('未配置 versioning Provider')
    return provider
  },

  /** Decode only a fresh authorized provider result, never a caller-supplied projection. */
  async readVersionDocument(versionId) {
    if (typeof versionId !== 'string' || !versionId || versionId.includes('\0')) throw new Error('版本标识无效')
    const provider = this._conversionProvider('canView'), documentId = this.documentId
    const authorization = this._authorizationGeneration, identity = this._privateIdentityGeneration
    const providerGeneration = this._versioningProviderGeneration, conversion = this._conversionGeneration
    const current = () => !this._destroyed && this.can('canView') && this.providers.versioning === provider && this.documentId === documentId
      && this._authorizationGeneration === authorization && this._privateIdentityGeneration === identity
      && this._versioningProviderGeneration === providerGeneration && this._conversionGeneration === conversion
    const check = () => { if (!current()) throw new Error('版本读取权限或文档上下文已失效') }
    return this._identityAction(async () => {
      const record = await provider.get(versionId)
      check()
      if (!record || record.id !== versionId || record.documentId !== documentId) throw new Error('版本不属于当前文档')
      const decoded = record.contentJson
        ? normalizeDocumentRecord({ documentId, schemaVersion: record.schemaVersion, content: record.contentJson, title: record.title })
        : provider.documentCodec?.decode
          ? await provider.documentCodec.decode(record.payload)
          : decodeVersionDocument(record.payload)
      check()
      if (!decoded || decoded.documentId !== documentId) throw new Error('版本正文不属于当前文档')
      const document = normalizeDocumentRecord(decoded)
      if (this._editor?.schema) validateDocument(document.content, this._editor.schema)
      return document
    })
  },

  diffVersions(fromVersionId, toVersionId) { const provider = this._conversionProvider('canView'); return this._identityAction(() => provider.diff(fromVersionId, toVersionId)) },

  _resetVersions(reason) { this._conversionGeneration++; const port = this.providers.versioning; if (typeof port?.reset === 'function') port.reset(reason); else port?.resetConversions?.(reason) },

  async _conversionAction(method, input, capability) {
    const provider = this._conversionProvider(capability), generation = this._conversionGeneration
    const { sessionConversion } = await import('../utils/remoteConversion')
    return sessionConversion.call(this, method, input, capability, provider, generation)
  },

  requestImport(input) { return this._conversionAction('requestImport', input, 'canEdit') },

  requestExport(input) { return this._conversionAction('requestExport', input, 'canExport') },

  queryConversion(input) {
    return this._conversionAction('queryConversion', input, 'canView')
  },

  downloadConversion(input) { return this._conversionAction('downloadConversion', input, 'canExport') },

  getConversionOperation(id) { return this.can('canView') ? this.providers.versioning?.getConversionOperation?.(id) || null : null }
}
