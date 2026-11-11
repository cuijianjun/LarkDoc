/** Loaded with the comment panel; invoked synchronously against the current editor owner. */
export const commentTranslationActions = {
    commentTranslationMessage(value, querying = false) {
      if (value.status === 'blocked') return querying ? '当前内部翻译服务未接通；此查询未创建或确认任何持久任务，整批验收仍受阻。' : '内部翻译服务未接通；未创建任务，当前整批验收仍受阻。'
      if (value.status === 'pending') return '翻译任务处理中；请查询原请求。'
      if (value.status === 'ready') return '译文已返回；原文未被改写。'
      if (value.status === 'failed') return '翻译任务失败；可重新选择语言并发起新请求，原文未被改写。'
      return '翻译请求尚未确认，未取得译文；请查询原请求。'
    },
    applyCommentTranslationResult(result, provider, querying = false) {
      this._commentTranslationOwner = { session: this.session, provider, generation: this.session && this.session._commentGeneration, componentGeneration: this.commentIdentityGeneration, identity: this.session && this.session.user && this.session.user.id }
      this.commentTranslationState = result
      this.commentPendingTranslationOperation = ['pending', 'unknown'].includes(result.status) ? result.operationId : ''
      this._commentPendingTranslationProvider = this.commentPendingTranslationOperation ? provider : null
      this.commentMessage = commentTranslationActions.commentTranslationMessage.call(this, result, querying)
    },
    async submitCommentTranslation() {
      const context = this.commentTranslationContext
      if (!context || this.commentTranslationBusy || this.commentPendingTranslationOperation || !this.commentTranslationIsCurrent(context)) return null
      const provider = this.commentProvider(), session = this.session, identity = session && session.user && session.user.id
      const ownerGeneration = session && session._commentGeneration, componentGeneration = this.commentIdentityGeneration
      const language = this.commentTranslationLanguage
      let generation = this.commentLoadGeneration, viewContext = context
      const current = () => !this.commentDisposed && session === this.session && identity === (this.session && this.session.user && this.session.user.id) &&
        provider === this.commentProvider() && ownerGeneration === (session && session._commentGeneration) && componentGeneration === this.commentIdentityGeneration && generation === this.commentLoadGeneration && this.commentTranslationContext === viewContext &&
        this.commentTranslationLanguage === language && this.commentCan('canView') && (!viewContext || this.commentTranslationIsCurrent(viewContext))
      const rememberPending = value => {
        if (['unknown', 'pending'].includes(value.status) && value.operationId && !this.commentDisposed && session === this.session &&
          identity === (this.session && this.session.user && this.session.user.id) && provider === this.commentProvider() &&
          ownerGeneration === (session && session._commentGeneration) && componentGeneration === this.commentIdentityGeneration &&
          (!this.commentPendingTranslationOperation || this.commentPendingTranslationOperation === value.operationId)) {
          this.commentPendingTranslationOperation = value.operationId; this._commentPendingTranslationProvider = provider
        }
      }
      this.commentTranslationBusy = true; this.commentTranslationState = null
      try {
        const input = { ...context, targetLanguage: language }
        const result = this.session && typeof this.session.requestCommentTranslation === 'function'
          ? await this.session.requestCommentTranslation(input) : await provider.requestTranslation(input)
        if (!current()) { rememberPending(result); return null }
        const loading = this.loadComments()
        generation = this.commentLoadGeneration
        await loading
        if (!current() || !this.commentTranslationIsCurrent(result)) { rememberPending(result); return null }
        commentTranslationActions.applyCommentTranslationResult.call(this, result, provider)
        return result
      } catch (error) {
        if (!current()) { rememberPending(error); return null }
        const clearing = this.clearUnavailableCommentView(error)
        generation = this.commentLoadGeneration; viewContext = this.commentTranslationContext
        await clearing
        rememberPending(error)
        if (!current()) return null
        if (error.status === 'unknown' && error.operationId && this.commentTranslationIsCurrent(context)) {
          this.commentTranslationState = { ...context, operationId: error.operationId, targetLanguage: language, status: 'unknown' }
        }
        this.commentMessage = error.status === 'unknown' ? '翻译请求尚未确认，未取得译文；请查询原请求。'
          : error.code === 'TRANSLATION_SOURCE_STALE' ? '源回复已修订，请重新选择；原文未被改写。' : '评论不可见、来源失效或语言代码不合法。'
        return null
      } finally { if (!this.commentDisposed && session === this.session && provider === this.commentProvider() && ownerGeneration === (session && session._commentGeneration) && componentGeneration === this.commentIdentityGeneration) this.commentTranslationBusy = false }
    },
    async queryPendingCommentTranslation() {
      if (!this.commentPendingTranslationOperation || this.commentTranslationBusy || !this.commentCan('canView')) return null
      const operationId = this.commentPendingTranslationOperation
      const provider = this._commentPendingTranslationProvider || this.commentProvider(), session = this.session, identity = session && session.user && session.user.id
      const ownerGeneration = session && session._commentGeneration, componentGeneration = this.commentIdentityGeneration
      const language = this.commentTranslationLanguage
      let generation = this.commentLoadGeneration, viewContext = this.commentTranslationContext
      const current = (checkSource = true) => !this.commentDisposed && session === this.session && identity === (this.session && this.session.user && this.session.user.id) &&
        provider === this.commentProvider() && ownerGeneration === (session && session._commentGeneration) && componentGeneration === this.commentIdentityGeneration && generation === this.commentLoadGeneration && this.commentTranslationContext === viewContext &&
        this.commentTranslationLanguage === language && this.commentPendingTranslationOperation === operationId &&
        this.commentCan('canView') && (!checkSource || !viewContext || this.commentTranslationIsCurrent(viewContext))
      this.commentTranslationBusy = true; this.commentTranslationState = null
      try {
        const result = this.session && typeof this.session.queryCommentTranslation === 'function'
          ? await this.session.queryCommentTranslation(operationId) : await provider.queryTranslation(operationId)
        if (!current()) return null
        const loading = this.loadComments()
        generation = this.commentLoadGeneration
        await loading
        if (!current() || !this.commentTranslationIsCurrent(result)) return null
        this.commentTranslationContext = { threadId: result.threadId, replyId: result.replyId, sourceRevision: result.sourceRevision }
        this.commentTranslationLanguage = result.targetLanguage
        commentTranslationActions.applyCommentTranslationResult.call(this, result, provider, true)
        return result
      } catch (error) {
        if (!current(error.code !== 'TRANSLATION_SOURCE_STALE')) return null
        const clearing = this.clearUnavailableCommentView(error)
        generation = this.commentLoadGeneration; viewContext = this.commentTranslationContext
        await clearing
        if (!current()) return null
        if (error.code === 'TRANSLATION_SOURCE_STALE') { this.commentPendingTranslationOperation = ''; this._commentPendingTranslationProvider = null }
        this.commentMessage = error.code === 'TRANSLATION_SOURCE_STALE' ? '原来源已失效；原请求记录保留，请重新选择回复修订。' : '原请求仍无法确认，或当前无权查看源回复。'
        return null
      } finally { if (!this.commentDisposed && session === this.session && provider === this.commentProvider() && ownerGeneration === (session && session._commentGeneration) && componentGeneration === this.commentIdentityGeneration) this.commentTranslationBusy = false }
    }
}
