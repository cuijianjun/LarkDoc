/**
 * 文档会话 —— 附件域。
 *
 * 上传开始 / 完成、状态与正文读取、操作轮询。全部先过能力闸门再落到 Provider。
 */


export const assetMethods = {
  _assetProvider(capability) {
    if (this._destroyed || !this.can(capability)) throw new Error('当前用户没有该附件操作权限')
    const provider = this.providers.assets
    if (!provider) throw new Error('内部对象存储尚未接通，未配置assets Provider')
    return provider
  },

  _resetAssets(reason) {
    this._assetGeneration++
    this._conversionGeneration++
    this.providers.assets?.reset?.(reason)
  },

  async _assetAction(method, input, capability) {
    const provider = this._assetProvider(capability), generation = this._assetGeneration, identityGeneration = this._identityGeneration
    if (this._identityRequired && typeof input?.onChunk === 'function') {
      const onChunk = input.onChunk
      input = { ...input, onChunk: (...args) => { this._assertIdentity(identityGeneration); if (generation !== this._assetGeneration || !this.can(capability)) throw this._identityError(); return onChunk(...args) } }
    }
    if (typeof provider[method] !== 'function') throw new Error(`assets Provider 不支持 ${method}`)
    const result = await this._identityAction(() => provider[method](input))
    if (this._destroyed || generation !== this._assetGeneration || provider !== this.providers.assets || !this.can(capability)) {
      throw Object.assign(new Error('ASSET_SESSION_CHANGED'), { code: 'ASSET_SESSION_CHANGED', status: 'unknown', retryable: false })
    }
    return result
  },

  uploadCommentImage(input) { return this._assetAction('uploadCommentImage', input, 'canComment') },

  uploadAssetFile(input) { return this._assetAction('upload', input, 'canEdit') },

  beginAssetUpload(input) { return this._assetAction('begin', input, 'canEdit') },

  completeAssetUpload(input) { return this._assetAction('complete', input, 'canEdit') },

  getAssetStatus(id) { return this._assetAction('getStatus', id, 'canView') },

  getAssetContent(input) { return this._assetAction('getContent', input, 'canView') },

  queryAssetOperation(input) { return this._assetAction('queryOperation', input, 'canView') },

  getAssetOperation(id) { return this.can('canView') ? this.providers.assets?.getOperation?.(id) || null : null }
}
