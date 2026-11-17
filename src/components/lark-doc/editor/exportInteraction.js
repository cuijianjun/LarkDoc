/** Private export actions invoked by the mounted export UI. Original helpers and import thunks stay host-owned. */
export function createExportInteraction(dependencies) {
  const { EXPORT_FORMATS, EXPORT_TOAST_TEXT, isExportEnabled, createOutputAuditEvent, evaluateOutputPolicy, loadExportModule, loadRemoteConversionModule } = dependencies
  const methods = {

    // —— 提交 ——
    /**
     * 点「导出」：关弹窗 → 出 toast → 派发 → 产物落盘后 toast 自行消失（§4.6.7④）。
     *
     * 顺序刻意是「先关再派发」：实测里弹窗在 toast 出现之前就消失了，反过来做会让
     * 用户看到弹窗卡在屏幕上直到文件生成完。
     */
    submitExport() {
      return (this.exportRoute || (this.remoteExportProvider() ? 'remote' : 'local')) === 'remote' ? this.submitRemoteExport() : this.submitLocalExport()
    },
    async submitLocalExport() {
      if (!this.exportCanExport || this.exportBusy) return
      const def = this.exportFormatDef
      if (!def) return
      const format = def.id
      const scope = this.exportScopeValue
      const fileName = this.exportFileBaseName
      const context = this.createExportContext(format, scope)
      if (!context || !context.current()) return
      this.closeExportDialog()
      this.exportBusy = true
      this.exportToast = EXPORT_TOAST_TEXT
      try {
        await this.dispatchExport(format, scope, fileName, context)
      } catch (error) {
        if (context && this._exportContext === context && context.current()) this.error = `导出失败：${error.message}`
      } finally {
        if (context && this._exportContext === context) {
          this.exportBusy = false
          if (format !== 'pdf' || !context.cleanup) {
            context.stop()
            this._exportContext = null
            this.exportToast = ''
          }
        }
      }
    },
    selectExportRoute(route) {
      if (this.exportBusy || !['local', 'remote'].includes(route)) return
      this.exportRoute = route
      if (this.exportFormatDef) this.exportScope = route === 'remote' && this.exportFormat === 'markdown' ? 'all' : this.exportFormatDef.defaultScope
    },
    queryRemoteExport() { return this.submitRemoteExport(true) },
    async submitRemoteExport(queryOnly = false) {
      if (this.exportBusy || !this.exportCanExport) return null
      this.bindRemoteExportSession()
      if (this._pendingExportOwner && !this._pendingExportOwner()) { this.clearRemoteExport(); return null }
      const pending = this.exportPendingOperationId
      if (queryOnly && !pending) return null
      const def = pending ? EXPORT_FORMATS.find(value => value.extension === this.exportPendingFormat) : this.exportFormatDef
      if (!def) return null
      if (!pending && this.exportScopeValue !== (def.id === 'markdown' ? 'all' : 'contentOnly')) {
        this.error = '受控服务仅支持不可变版本正文；此内容范围请显式选择本地导出。'; return null
      }
      if (!this.exportRemoteAvailable) { this.error = '受控导出服务尚未接入；可显式选择本地导出。'; return null }
      const session = this.session, provider = this.remoteExportProvider(), editor = this.editor
      const generation = this.exportGeneration, viewGeneration = this._remoteExportViewGeneration
      const privateGeneration = session?._privateIdentityGeneration, identityGeneration = session?._identityGeneration
      const authorizationGeneration = session?._authorizationGeneration, conversionGeneration = session?._conversionGeneration
      const providerGeneration = session?._versioningProviderGeneration, actor = session?.user?.id, documentId = session?.documentId, hostDocumentId = this.documentId
      const config = () => this.larkDocConfig || this.editorConfig
      const formatId = def.id === 'pdf' ? 'print' : def.extension
      const owner = () => !this._exportDisposed && !session?._destroyed && generation === this.exportGeneration && session === this.session && provider === this.remoteExportProvider() &&
        actor === session?.user?.id && privateGeneration === session?._privateIdentityGeneration && documentId === session?.documentId && hostDocumentId === this.documentId && providerGeneration === session?._versioningProviderGeneration
      const scope = { session, provider, owner, format: def.extension, operationId: pending,
        fileName: pending ? this.exportPendingFileName : this.exportFileBaseName,
        current: () => owner() && editor === this.editor && !editor?.isDestroyed && viewGeneration === this._remoteExportViewGeneration &&
          identityGeneration === session?._identityGeneration && authorizationGeneration === session?._authorizationGeneration && conversionGeneration === session?._conversionGeneration &&
          providerGeneration === session?._versioningProviderGeneration && this.exportCanExport && (typeof session?._identityCurrent !== 'function' || session._identityCurrent()) &&
          evaluateOutputPolicy(session?.getProvider?.('security')?.policy, 'download').allowed && (!config() || isExportEnabled(config())) &&
          (!Array.isArray(config()?.importExport?.exportFormats) || config().importExport.exportFormats.includes(formatId)) }
      if (!scope.current()) return null
      this.invalidateExportContext(false)
      this.closeExportDialog(); this.exportBusy = true; this.exportToast = EXPORT_TOAST_TEXT; this._activeExport = scope
      try {
        const { remoteConversionMethods } = await loadRemoteConversionModule()
        if (!scope.current()) return null
        return await remoteConversionMethods.submitRemoteExport.call(this, scope)
      } catch {
        if (scope.current()) this.error = '受控导出未能完成；未生成文件。'
        return null
      } finally { if (this._activeExport === scope) { if (!scope.current()) this.exportToast = ''; this._activeExport = null; this.exportBusy = false } }
    },
    /** 按档派发。返回 Promise（PDF 同步返回，await 一下统一形态）。 */
    dispatchExport(format, scope, fileName, context) {
      if (format === 'markdown') return this.dispatchMarkdown(scope, fileName, context)
      if (format === 'word') return this.dispatchDocx(scope, fileName, context)
      if (format === 'pdf') return this.dispatchPdf(scope, fileName, context)
      return Promise.resolve(null)
    },
    /**
     * Markdown 档：`textOnly` = 不含图片和附件。
     *
     * **范围语义不在这一层解释**：本 mixin 只把 UI 选中的 `scope` 原样传给出口层，
     * 「textOnly 要丢图片」「附件本来就不落盘」这些规则归 utils/export/index.js，
     * 否则同一个档位会在两处各判一次，改一处漏一处。
     */
    async dispatchMarkdown(scope, fileName, context = this.createExportContext('markdown', scope)) {
      if (!context || !context.current()) return Promise.resolve(null)
      try {
        const { exportMarkdown } = await loadExportModule()
        if (!context.current()) throw new Error('导出加载期间文档或权限已改变，请重新导出')
        return await exportMarkdown(context.doc, { fileName, scope, shouldDownload: context.current })
      } finally { context.stop() }
    },
    /** Capture a read-only export snapshot and invalidate it when its host context changes. */
    createExportContext(format, scope) {
      const action = format === 'pdf' ? 'print' : 'download'
      const decision = evaluateOutputPolicy(this.session?.getProvider?.('security')?.policy, action)
      if (!decision.allowed) {
        this.error = decision.reason
        this.outputAuditEvents = [...(this.outputAuditEvents || []), createOutputAuditEvent({ action, result: 'denied', reason: decision.reason,
          docId: this.session?.documentId || this.documentId, actorId: this.session?.user?.id })].slice(-100)
        return null
      }
      const doc = this.currentDoc()
      if (!doc) return null
      this.invalidateExportContext(false)
      const editor = this.editor, session = this.session
      const actorId = session?.user?.id, identityGeneration = session?._privateIdentityGeneration
      const providerIdentityGeneration = session?._identityGeneration, commentGeneration = session?._commentGeneration
      const authorizationGeneration = session?._authorizationGeneration
      const identity = session?.getProvider?.('identity'), authorization = session?.getProvider?.('authorization'), security = session?.getProvider?.('security')
      const documentId = this.documentId, sessionDocumentId = session?.documentId
      const sourceDoc = editor?.state?.doc
      const snapshot = sourceDoc ? null : JSON.stringify(doc)
      const generation = this._exportGeneration
      const getConfig = () => this.larkDocConfig || this.editorConfig
      const network = getConfig()?.network, networkKey = JSON.stringify(network)
      const formatId = format === 'word' ? 'docx' : format === 'markdown' ? 'md' : 'print'
      const provider = scope === 'withComments' ? session?.getProvider?.('comments') : null
      const context = { doc, scope, network, provider, documentId: sessionDocumentId || documentId || '' }
      const matches = () => !this._exportDisposed && generation === this._exportGeneration && !editor?.isDestroyed && !session?._destroyed
        && this.editor === editor && this.session === session
        && session?.user?.id === actorId && session?._privateIdentityGeneration === identityGeneration && session?._authorizationGeneration === authorizationGeneration
        && session?._identityGeneration === providerIdentityGeneration && session?._commentGeneration === commentGeneration
        && session?.getProvider?.('identity') === identity && session?.getProvider?.('authorization') === authorization && session?.getProvider?.('security') === security
        && (typeof session?._identityCurrent !== 'function' || session._identityCurrent())
        && this.documentId === documentId && session?.documentId === sessionDocumentId
        && (sourceDoc ? editor?.state?.doc === sourceDoc : JSON.stringify(this.currentDoc()) === snapshot)
        && (typeof session?.can !== 'function' || (session.can('canView') && session.can('canExport')))
        && evaluateOutputPolicy(session?.getProvider?.('security')?.policy, action).allowed
        && (!getConfig() || isExportEnabled(getConfig()))
        && (!Array.isArray(getConfig()?.importExport?.exportFormats) || getConfig().importExport.exportFormats.includes(formatId))
        && JSON.stringify(getConfig()?.network) === networkKey
        && (scope !== 'withComments' || session?.getProvider?.('comments') === provider)
      const check = () => this.checkExportContext()
      const offs = []
      context.current = () => this._exportContext === context && matches()
      context.matches = matches
      context.stop = () => { offs.splice(0).forEach(off => off()) }
      this._exportContext = context
      if (!context.current()) { this.invalidateExportContext(false); return null }
      if (typeof editor?.on === 'function') {
        editor.on('transaction', check); editor.on('destroy', check)
        offs.push(() => { editor.off('transaction', check); editor.off('destroy', check) })
      }
      for (const event of ['capabilities', 'provider-changed', 'identity', 'comments-reset']) {
        const off = session?.on?.(event, event === 'identity' || event === 'comments-reset' ? () => this.invalidateExportContext() : check)
        if (typeof off === 'function') offs.push(off)
      }
      return context
    },
    async readExportComments(context) {
      if (context.scope !== 'withComments') return []
      if (typeof context.provider?.list !== 'function') throw new Error('尚未配置评论服务，无法导出正文及评论')
      const comments = await context.provider.list({ documentId: context.documentId })
      if (!context.current()) throw new Error('评论读取期间文档、权限或服务已改变，请重新导出')
      if (!Array.isArray(comments)) throw new Error('评论服务未返回有效评论列表')
      const { normalizeExportComments } = await loadExportModule()
      if (!context.current()) throw new Error('导出加载期间文档或权限已改变，请重新导出')
      return normalizeExportComments(comments.filter(thread => !thread?.documentId || thread.documentId === context.documentId))
    },
    async dispatchDocx(scope, fileName, context = this.createExportContext('word', scope)) {
      if (!context || !context.current()) return null
      try {
        const comments = await this.readExportComments(context)
        if (!context.current()) throw new Error('导出条件已改变，请重新导出')
        const { exportDocx } = await loadExportModule()
        if (!context.current()) throw new Error('导出加载期间文档或权限已改变，请重新导出')
        return await exportDocx(context.doc, { fileName, title: fileName, scope, comments, network: context.network, shouldDownload: context.current })
      } finally { context.stop() }
    },
    /**
     * PDF 档走浏览器打印，文件名由用户在系统打印框里定。
     * `onPrinted` 在打印框关闭（afterprint）时触发，用来收掉 toast。
     */
    async dispatchPdf(scope, fileName, context = this.createExportContext('pdf', scope)) {
      if (!context || !context.current()) return null
      try {
        const comments = await this.readExportComments(context)
        if (!context.current()) throw new Error('导出条件已改变，请重新导出')
        const { exportPdf } = await loadExportModule()
        if (!context.current()) throw new Error('导出加载期间文档或权限已改变，请重新导出')
        let result, cleaned = false
        const cleanup = () => {
          if (cleaned) return
          cleaned = true
          context.stop()
          result?.cleanup?.()
          if (this._exportContext === context) { this._exportContext = null; this.exportBusy = false; this.exportToast = '' }
        }
        context.cleanup = cleanup
        result = exportPdf(this.$refs ? this.$refs.root : null, { title: fileName, scope, comments, shouldPrint: context.current, onPrinted: cleanup })
        if (!result?.ok) { cleanup(); if (context.matches() && result?.reason) this.error = `导出失败：${result.reason}` }
        return result
      } catch (error) { context.stop(); throw error }
    },

    // —— 取数 ——
    /**
     * 当前文档 JSON。拿 editor 的 `getJSON()` 而不是 `state.doc`：
     * 序列化层要的是普通对象（单测里也是 JSON），传节点实例会让 Node 侧单测必须伪造实例。
     */
    currentDoc() {
      if (!this.editor || typeof this.editor.getJSON !== 'function') return null
      return this.editor.getJSON()
    },
  }
  return { methods }
}
