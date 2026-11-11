import { downloadBlob, safeFileName } from './importExport'


// 懒加载前的转换代际覆盖所有身份/Provider变化；发送前再捕获当前精确边界。
export async function sessionConversion(method, input, capability, provider, generation) {
  if (!this.can(capability) || this._destroyed || provider !== this.providers.versioning || generation !== this._conversionGeneration) throw Object.assign(new Error('CONVERSION_CONTEXT_CHANGED'), { code: 'CONVERSION_CONTEXT_CHANGED', status: 'unknown' })
  if (typeof provider[method] !== 'function') throw new Error(`versioning Provider 不支持 ${method}`)
  const identityGeneration = this._identityGeneration, privateGeneration = this._privateIdentityGeneration, providerGeneration = this._versioningProviderGeneration, principal = this.user?.id
  let operationId = typeof input === 'string' ? input : input?.operationId
  const sameIdentity = () => !this._destroyed && provider === this.providers.versioning && providerGeneration === this._versioningProviderGeneration && privateGeneration === this._privateIdentityGeneration && principal === this.user?.id
  const current = () => this.can(capability) && this._identityCurrent(identityGeneration) && sameIdentity() && generation === this._conversionGeneration
  const changed = () => {
    this._identityCurrent()
    if (this._identityRequired && !sameIdentity()) return this._identityError()
    // 同身份复权只保留原键，绝不把旧结果、错误内容或字节交给新视图。
    return Object.assign(new Error('CONVERSION_CONTEXT_CHANGED'), { code: 'CONVERSION_CONTEXT_CHANGED', status: 'unknown',
        ...(sameIdentity() && typeof operationId === 'string' && operationId ? { operationId } : {}) })
  }
  if (!current()) throw changed()
  try {
    const result = await provider[method](input)
    operationId = operationId || result?.operationId
    if (!current()) throw changed()
    return result
  } catch (error) {
    if (!current()) { operationId = operationId || error?.operationId; throw changed() }
    throw error
  }
}

// Loaded only for an explicit remote conversion action. Session owns byte/permission verification.
export const remoteConversionMethods = {
    async applyRemoteConversion(result, scope, kind) {
      if (!scope.current()) return null
      if (['pending', 'unknown'].includes(result.status)) {
        this.conversionResult = result
        this.conversionPendingId = result.operationId; this._pendingConversionScope = scope
        this.notice = result.status === 'pending' ? '转换任务处理中；请查询原请求。' : '转换结果尚未确认；仅可查询原请求。'
      } else if (result.status === 'ready' && (result.operation || kind) === 'export') {
        this.conversionPendingId = result.operationId; this._pendingConversionScope = scope
        const output = await scope.session.downloadConversion(result.operationId)
        if (!scope.current('canExport')) return null
        downloadBlob(new Blob([output.bytes], { type: output.mimeType }), `${safeFileName(this.title)}.${result.requestedFormat}`)
        this.conversionResult = result
        this.conversionPendingId = ''; this._pendingConversionScope = null
        this.notice = '导出文件已校验，已发起下载。'
      } else {
        this.conversionResult = result
        this.conversionPendingId = ''; this._pendingConversionScope = null
        if (result.status === 'ready' && (result.operation || kind) === 'import') {
          const receipt = result.receipt
          this.notice = `导入已提交（epoch ${receipt.epoch} / seq ${receipt.seq}）；${result.reloadRequired ? '请重新打开文档后继续编辑。' : '当前文档已重新加载。'}`
        } else this.notice = result.status === 'failed' ? '转换任务失败；可显式发起新请求。'
          : '转换依赖未接通；未创建任务，未下载文件或替换正文。'
      }
      return result
    },
    async runRemoteConversion(kind, input) {
      if ([this._conversionActiveScope, this._pendingConversionScope].some(scope => scope && !scope.owner() && !(scope.identityOwner?.()))) this.clearRemoteConversion()
      if (this.conversionBusy) return null
      if (this.importUploadPending) { this.notice = '原上传请求尚未确认，请先查询原请求。'; return null }
      if (this.conversionPendingId) { this.notice = '原转换请求尚未确认，请先查询原请求。'; return null }
      const scope = this.remoteConversionScope()
      if (!scope.provider || !scope.current(kind === 'import' ? 'canEdit' : 'canExport')) return null
      this.conversionBusy = true; this._conversionActiveScope = scope; this.conversionResult = null
      try {
        const result = await scope.session[kind === 'import' ? 'requestImport' : 'requestExport'](input)
        if (!scope.current()) return null
        return await remoteConversionMethods.applyRemoteConversion.call(this, result, scope, kind)
      } catch (error) {
        if ((scope.identityOwner || scope.owner)()) {
          if (error.status === 'unknown' && error.operationId) { this.conversionPendingId = error.operationId; this._pendingConversionScope = this.remoteConversionScope() }
          if (scope.current() || (!scope.owner() && error.status === 'unknown' && error.operationId)) this.notice = error.status === 'unknown' ? '转换请求尚未确认；仅可查询原请求，未生成文件或替换正文。'
            : '转换请求或文件校验未完成；请核对来源、权限或查询保留的原请求。'
        }
        return null
      } finally { if (this._conversionActiveScope === scope) { this.conversionBusy = false; this._conversionActiveScope = null } }
    },
    async queryRemoteConversion() {
      if (this.importUploadPending) return remoteConversionMethods.queryRemoteImportUpload.call(this)
      if (!this.conversionPendingId || this.conversionBusy) return null
      let scope = this._pendingConversionScope || this.remoteConversionScope()
      const operationId = this.conversionPendingId
      if (!scope.owner() && scope.identityOwner?.()) { scope = this.remoteConversionScope(); this._pendingConversionScope = scope }
      if (!scope.owner()) { this.clearRemoteConversion(); return null }
      if (!scope.current()) return null
      this.conversionBusy = true; this._conversionActiveScope = scope
      try {
        const result = await scope.session.queryConversion(operationId)
        if (!scope.current() || this.conversionPendingId !== operationId) return null
        return await remoteConversionMethods.applyRemoteConversion.call(this, result, scope, result.operation)
      } catch (error) {
        if (scope.current() && this.conversionPendingId === operationId) {
          if (error.httpStatus === 409) { this.conversionPendingId = ''; this._pendingConversionScope = null }
          this.notice = '原请求仍未确认、来源已变化或当前无权查询；原请求记录保留。'
        }
        return null
      } finally { if (this._conversionActiveScope === scope) { this.conversionBusy = false; this._conversionActiveScope = null } }
    },
    rememberRemoteImportUpload(intent, error) {
      const meta = error.metadata
      if (!['unknown', 'pending'].includes(error.status) || !error.uploadOperationId || !error.beginOperationId || error.uploadOperationId === error.beginOperationId ||
        ![error.uploadOperationId, error.beginOperationId].includes(error.operationId) || !meta ||
        ['fileName', 'mimeType', 'sizeBytes'].some(key => meta[key] !== intent.metadata[key]) || !/^sha256:[0-9a-f]{64}$/.test(meta.checksum)) return false
      if (intent.uploadOperationId && (intent.uploadOperationId !== error.uploadOperationId || intent.beginOperationId !== error.beginOperationId || intent.metadata.checksum !== meta.checksum)) return false
      Object.assign(intent, { uploadOperationId: error.uploadOperationId, beginOperationId: error.beginOperationId, operationId: error.operationId,
        metadata: { ...intent.metadata, checksum: meta.checksum }, requestHash: error.requestHash, assetId: error.result?.assetId || intent.assetId })
      intent.phase = error.operationId === error.beginOperationId ? 'begin' : 'complete'
      if (intent.phase === 'complete') intent.file = null
      this.importUploadPending = true
      this.notice = '附件上传尚未确认；请查询原上传请求。'
      return true
    },
    async finishRemoteFileImport(intent, result) {
      const asset = result.asset, meta = intent.metadata, scope = intent.scope
      if (result.status !== 'committed' || result.operation !== 'complete' || result.persisted !== true || result.ready !== true || result.objectVerified !== true ||
        !result.assetId || result.assetId !== asset?.assetId || (intent.assetId && result.assetId !== intent.assetId) ||
        (intent.uploadOperationId && result.operationId !== intent.uploadOperationId) || asset.ready !== true || asset.objectVerified !== true ||
        ['fileName', 'mimeType', 'sizeBytes'].some(key => asset[key] !== meta[key]) || !/^sha256:[0-9a-f]{64}$/.test(asset.checksum) ||
        (meta.checksum && asset.checksum !== meta.checksum)) throw new Error('ASSET_RESULT_UNKNOWN')
      if (!this.remoteImportSourceMatches(intent)) throw new Error('CONVERSION_SOURCE_CONFLICT')
      this.releaseRemoteImportUpload(intent)
      try {
        const result = await scope.session.requestImport({ assetId: asset.assetId, format: intent.format,
          expectedEpoch: intent.source.expectedEpoch, expectedRevision: intent.source.expectedRevision })
        if (!scope.current()) return null
        return await remoteConversionMethods.applyRemoteConversion.call(this, result, scope, 'import')
      } catch (error) {
        if ((scope.identityOwner || scope.owner)()) {
          if (error.status === 'unknown' && error.operationId) { this.conversionPendingId = error.operationId; this._pendingConversionScope = this.remoteConversionScope() }
          if (scope.current() || (!scope.owner() && error.status === 'unknown' && error.operationId)) this.notice = error.status === 'unknown' ? '导入结果尚未确认；仅可查询原转换请求。' : '导入未完成，请核对来源或权限。'
        }
        return null
      }
    },
    async runRemoteFileImport(intent, ownsBusy = true) {
      const scope = intent.scope
      try {
        if (!this.remoteImportSourceMatches(intent)) throw new Error('CONVERSION_SOURCE_CONFLICT')
        const result = await scope.session.uploadAssetFile({ file: intent.file, signal: intent.controller.signal,
          ...(intent.uploadOperationId ? { operationId: intent.uploadOperationId, beginOperationId: intent.beginOperationId } : {}) })
        if (!scope.current('canEdit')) return null
        return await remoteConversionMethods.finishRemoteFileImport.call(this, intent, result)
      } catch (error) {
        if (scope.current('canEdit') && this._pendingImportUpload === intent) {
          if (this.remoteImportSourceMatches(intent) && remoteConversionMethods.rememberRemoteImportUpload.call(this, intent, error)) return null
          this.notice = '附件或导入来源未确认、正文已变化；未发起后续导入。'
        }
        this.releaseRemoteImportUpload(intent)
        return null
      } finally {
        if (!scope.owner()) this.releaseRemoteImportUpload(intent)
        if (ownsBusy && this._conversionActiveScope === scope) { this.conversionBusy = false; this._conversionActiveScope = null }
      }
    },
    async queryRemoteImportUpload() {
      const intent = this._pendingImportUpload
      if (!intent || this.conversionBusy) return null
      const scope = intent.scope
      if (!scope.current('canEdit')) { this.clearRemoteConversion(); return null }
      this.conversionBusy = true; this._conversionActiveScope = scope
      try {
        if (!this.remoteImportSourceMatches(intent)) throw new Error('CONVERSION_SOURCE_CONFLICT')
        const result = await scope.session.queryAssetOperation({ operationId: intent.operationId, kind: intent.phase,
          ...(intent.requestHash ? { requestHash: intent.requestHash } : {}), signal: intent.controller.signal })
        if (!scope.current('canEdit')) return null
        if (!this.remoteImportSourceMatches(intent)) throw new Error('CONVERSION_SOURCE_CONFLICT')
        if (intent.phase === 'begin' && result.status === 'committed' && result.persisted === true) {
          if (result.operation !== 'begin' || result.operationId !== intent.beginOperationId || !result.assetId ||
            (intent.assetId && result.assetId !== intent.assetId) || !result.asset ||
            ['fileName', 'mimeType', 'sizeBytes'].some(key => result.asset[key] !== intent.metadata[key])) throw new Error('ASSET_RESULT_UNKNOWN')
          intent.assetId = result.assetId
          return await remoteConversionMethods.runRemoteFileImport.call(this, intent, false)
        }
        if (intent.phase === 'complete' && result.status === 'committed' && result.ready === true) return await remoteConversionMethods.finishRemoteFileImport.call(this, intent, result)
        throw Object.assign(new Error('ASSET_UPLOAD_NOT_READY'), { status: ['unknown', 'pending'].includes(result.status) ? result.status : 'rejected',
          operationId: intent.operationId, result, metadata: intent.metadata, requestHash: result.requestHash || intent.requestHash,
          uploadOperationId: intent.uploadOperationId, beginOperationId: intent.beginOperationId })
      } catch (error) {
        if (scope.current('canEdit') && this._pendingImportUpload === intent) {
          if (this.remoteImportSourceMatches(intent)) {
            if (remoteConversionMethods.rememberRemoteImportUpload.call(this, intent, error)) return null
            const status = error.httpStatus || (typeof error.status === 'number' ? error.status : null)
            if (!(status >= 400 && status < 500) && !['blocked', 'rejected'].includes(error.status)) {
              this.importUploadPending = true; this.notice = '原上传仍未确认；仅可查询原上传请求。'; return null
            }
          }
          this.notice = '原上传或导入来源未确认、正文已变化；未发起后续导入。'
        }
        this.releaseRemoteImportUpload(intent)
        return null
      } finally {
        if (!scope.owner()) this.releaseRemoteImportUpload(intent)
        if (this._conversionActiveScope === scope) { this.conversionBusy = false; this._conversionActiveScope = null }
      }
    },
    async submitRemoteExport(format) {
      if (this.exportBusy || !this.exportCanExport) return null
      const session = this.session
      // 首次导出才绑定同步失效监听；同tick ABA不依赖Vue合并后的user.id watcher。
      if (this._exportBoundSession !== session) {
        this._exportSessionStops?.forEach(stop => stop()); this._exportBoundSession = session
        this._exportSessionStops = typeof session?.on === 'function' ? [
          session.on('comments-reset', reason => { if (session === this.session && reason !== 'authorization-required') this.clearRemoteExport() }),
          session.on('provider-changed', event => { if (session === this.session && event.name === 'versioning') this.clearRemoteExport() }),
        ] : []
      }
      const provider = this.remoteExportProvider(), generation = this.exportGeneration, sessionGeneration = session && session._conversionGeneration, identity = session && session.user && session.user.id
      const identityGeneration = session && session._privateIdentityGeneration
      const identityOwner = () => !this._exportDisposed && generation === this.exportGeneration && session === this.session && provider === this.remoteExportProvider() &&
        identityGeneration === (session && session._privateIdentityGeneration) && identity === (session && session.user && session.user.id)
      const current = () => !this._exportDisposed && generation === this.exportGeneration && sessionGeneration === (session && session._conversionGeneration) && session === this.session && provider === this.remoteExportProvider() &&
        identity === (session && session.user && session.user.id)
      this.exportBusy = true; this._activeExport = current
      try {
        if (this._pendingExportProvider && this._pendingExportProvider !== provider) { this.exportPendingOperationId = ''; this._pendingExportProvider = null }
        const result = this.exportPendingOperationId ? await this.session.queryConversion(this.exportPendingOperationId)
          : await this.session.requestExport({ format })
        if (!current()) return null
        if (result.status === 'ready') {
          this.exportPendingOperationId = result.operationId; this._pendingExportProvider = provider
          const output = await this.session.downloadConversion(result.operationId)
          if (!current() || !this.exportCanExport) return null
          downloadBlob(new Blob([output.bytes], { type: output.mimeType }), `${this.exportFileBaseName}.${result.requestedFormat}`)
          this.exportPendingOperationId = ''; this._pendingExportProvider = null; this.exportToast = ''
        } else if (['pending', 'unknown'].includes(result.status)) {
          this.exportPendingOperationId = result.operationId; this._pendingExportProvider = provider
          this.exportToast = result.status === 'pending' ? '导出任务处理中；再次点击查询原任务。' : '导出结果尚未确认；再次点击只查询原任务。'
        } else {
          this.exportPendingOperationId = ''; this._pendingExportProvider = null
          this.exportToast = result.status === 'failed' ? '导出任务失败，未生成文件；可重新选择格式发起新请求。' : '导出依赖未接通：批准格式、内部转换与对象存储尚未供给；未创建任务，未生成文件。'
        }
        return result
      } catch (error) {
        if (identityOwner()) {
          if (error.status === 'unknown' && error.operationId) { this.exportPendingOperationId = error.operationId; this._pendingExportProvider = provider }
          this.exportToast = error.status === 'unknown' ? '导出结果尚未确认；再次点击只查询原请求，未生成文件。'
            : '导出未接通或缺少匹配当前正文的不可变版本/权限；未生成文件。'
        }
        return null
      } finally { if (this._activeExport === current) { this.exportBusy = false; this._activeExport = null } }
    },
}
