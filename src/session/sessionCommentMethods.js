/**
 * 文档会话 —— 评论域。
 *
 * 一个统一的 `_commentAction` 承载线程、回复、表情、已解决状态、参与者与可见性、
 * 关注偏好、链接与翻译，每个入口只声明「方法名 + 输入 + 需要的能力」。
 */


export const commentMethods = {
  async _commentAction(method, input, capability = 'canComment') {
    if (this._destroyed) throw new Error('DocumentSession 已销毁')
    if (!this.can(capability)) throw new Error('当前用户没有评论操作权限')
    const provider = this.providers.comments
    if (!provider || typeof provider[method] !== 'function') throw new Error(`comments Provider 不支持 ${method}`)
    const translation = ['requestTranslation', 'queryTranslation'].includes(method), scoped = translation || this._identityRequired
    const identityGeneration = this._identityGeneration
    const generation = this._commentGeneration, authorization = this._authorizationGeneration, identity = this.user && this.user.id
    const operationId = typeof input === 'string' ? input : input && input.operationId
    const current = () => !this._destroyed && provider === this.providers.comments && this._identityCurrent(identityGeneration) && (!scoped ||
      generation === this._commentGeneration && authorization === this._authorizationGeneration && identity === (this.user && this.user.id) && this.can(capability))
    const invalidated = value => Object.assign(this._identityRequired && !this._identityCurrent(identityGeneration) ? this._identityError() : new Error('COMMENT_TRANSLATION_INVALIDATED'), { code: this._identityRequired && !this._identityCurrent(identityGeneration) ? 'IDENTITY_CONTEXT_CHANGED' : 'COMMENT_TRANSLATION_INVALIDATED', status: value && value.submitted === false ? 'rejected' : 'unknown', ...(value && typeof value.submitted === 'boolean' ? { submitted: value.submitted } : {}),
      operationId: value && value.operationId || operationId })
    const publish = (event, value) => {
      if (!scoped) { this.emit(event, value); return }
      const listeners = this._listeners.get(event)
      if (listeners) Array.from(listeners).forEach(listener => { if (listeners.has(listener) && current()) listener(value) })
    }
    let providerError
    try {
      // The identity guard can replace a rejection; retain only its recovery metadata below.
      const result = await this._identityAction(async () => {
        try { return await provider[method](input) }
        catch (error) { providerError = error; throw error }
      }, identityGeneration)
      if (scoped && !current()) throw invalidated(result)
      if (current()) publish('comments', result)
      if (scoped && !current()) throw invalidated(result)
      return result
    } catch (error) {
      if (scoped && !current()) throw invalidated(providerError || error)
      if (current()) publish('error', error)
      if (scoped && !current()) throw invalidated(providerError || error)
      throw error
    }
  },

  listComments() { return this._commentAction('list', { documentId: this.documentId }, 'canView') },

  getCommentThread(threadId) { return this._commentAction('getThread', threadId, 'canView') },

  createCommentThread(input) { return this._commentAction('createThread', input) },

  replyToComment(input) { return this._commentAction('reply', input) },

  editCommentReply(input) { return this._commentAction('editReply', input) },

  reactToComment(input) { return this._commentAction('react', input) },

  deleteCommentReply(input) { return this._commentAction('deleteReply', input) },

  resolveComment(threadId) { return this._commentAction('resolve', threadId, 'canResolveComment') },

  reopenComment(threadId) { return this._commentAction('reopen', threadId, 'canResolveComment') },

  setCommentParticipants(input) { return this._commentAction('setParticipants', input) },

  setCommentVisibility(input) { return this._commentAction('setVisibility', input) },

  queryCommentOperation(operationId) { return this._commentAction('queryOperation', operationId, 'canView') },

  getCommentOperation(operationId) {
    const provider = this.providers.comments
    return !this._destroyed && (!this._identityRequired || this.can('canView')) && provider && typeof provider.getOperation === 'function' ? provider.getOperation(operationId) : null
  },

  getCommentFollowPreference(threadId) { return this._commentAction('getFollowPreference', threadId, 'canView') },

  followComment(input) { return this._commentAction('follow', input, 'canView') },

  unfollowComment(input) { return this._commentAction('unfollow', input, 'canView') },

  muteComment(input) { return this._commentAction('setMuted', input, 'canView') },

  queryCommentFollowOperation(id) { return this._commentAction('queryFollowOperation', id, 'canView') },

  getCommentFollowOperation(id) {
    const provider = this.providers.comments
    return !this._destroyed && (!this._identityRequired || this.can('canView')) && provider && typeof provider.getFollowOperation === 'function' ? provider.getFollowOperation(id) : null
  },

  getCommentLinkTarget(threadId) { return this._commentAction('getLinkTarget', threadId, 'canView') },

  getCommentLink(threadId) { return this._commentAction('getLink', threadId, 'canView') },

  openCommentLink(value) { return this._commentAction('openLink', value, 'canView') },

  requestCommentTranslation(input) { return this._commentAction('requestTranslation', input, 'canView') },

  queryCommentTranslation(input) { return this._commentAction('queryTranslation', input, 'canView') },

  getCommentTranslationOperation(id) {
    const provider = this.providers.comments
    return !this._destroyed && (!this._identityRequired || this.can('canView')) && provider && typeof provider.getTranslationOperation === 'function' ? provider.getTranslationOperation(id) : null
  }
}
