/**
 * 文档会话 —— 权限与分享域。
 *
 * 提及解析、成员列表、分享请求、分享操作与只读分享链接。
 */


export const permissionMethods = {
  async _authorizationAction(method, input, capability) {
    if (this._destroyed || !this.can(capability)) throw new Error('当前用户没有提及或分享操作权限')
    const provider = this.providers.authorization, generation = this._authorizationGeneration, identityGeneration = this._identityGeneration
    if (!provider || typeof provider[method] !== 'function') throw new Error(`authorization Provider 不支持 ${method}`)
    const current = () => !this._destroyed && generation === this._authorizationGeneration && provider === this.providers.authorization && (!this._identityRequired || this._identityCurrent(identityGeneration) && this.can(capability))
    try {
      const result = await this._identityAction(() => provider[method](input), identityGeneration)
      if (this._identityRequired && !current()) throw this._identityError()
      if (current()) this._emitIdentityBound('authorization-operation', { method, result }, identityGeneration)
      this._assertIdentity(identityGeneration); return result
    } catch (error) {
      this._assertIdentity(identityGeneration)
      if (current()) this._emitIdentityBound('error', error, identityGeneration)
      this._assertIdentity(identityGeneration); throw error
    }
  },

  resolveMentions(input) { return this._authorizationAction('resolveMentions', input, 'canView') },

  queryMentionResolution(input) { return this._authorizationAction('queryMentionResolution', input, 'canView') },

  getMentionOperation(id) { return (!this._identityRequired || this.can('canView')) ? this.providers.authorization?.getMentionOperation?.(id) || null : null },

  requestShare(input) { return this._authorizationAction('requestShare', input, 'canManagePermission') },

  listMembers() { return this._authorizationAction('listMembers', undefined, 'canManagePermission') },

  queryShareOperation(id) { return this._authorizationAction('queryShareOperation', id, 'canManagePermission') },

  getShareOperation(id) { return (!this._identityRequired || this.can('canView')) ? this.providers.authorization?.getShareOperation?.(id) || null : null },

  getShareLink() { return this._authorizationAction('getShareLink', undefined, 'canView') }
}
