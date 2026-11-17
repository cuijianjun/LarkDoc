/** Private actions reached only from the mounted sharing UI. */
/* global globalThis */
export function createShareInteraction(dependencies) {
  const { INVITE_SCOPES, emptyInvitation, unresolvedInvitation, safeUrl } = dependencies
  const methods = {
    async selectShareInviteCandidate(principalId) {
      if (unresolvedInvitation(this.shareInvitation) || this.shareInvitation.status === 'preparing' || !this.shareCan('canView') || !this.shareCan('canManagePermission')) return false
      const candidate = this.shareDirectory.status === 'ready' && this.shareDirectory.items.find(item => item.principalId === principalId && item.kind !== 'chat' && item.kind !== 'document')
      if (!candidate || !/^[A-Za-z0-9._-]{1,128}$/.test(candidate.principalId)) return false
      const current = this.shareReadCurrent('invitation', false)
      this._shareInviteCurrent = current
      this.shareInvitation = { ...emptyInvitation(), candidate: { principalId, displayName: candidate.displayName || principalId }, status: 'preparing' }
      await this.loadShareMembers()
      if (!current() || !this.shareCan('canView') || !this.shareCan('canManagePermission')) return false
      if (this.shareMembers.status !== 'ready' || !/^(0|[1-9][0-9]*)$/.test(this.shareMembers.authzVersion)) {
        this.shareInvitation = { ...this.shareInvitation, status: 'failed', error: '无法确认当前协作者版本，请重新选择。' }; return false
      }
      const existing = this.shareMembers.items.find(member => member.principalId === principalId)
      const fullyRevoked = existing && existing.scopes?.length === 0 && existing.sources?.length > 0 && existing.sources.every(source => source.revoked === true && source.sourceGap === false)
      if (existing && !fullyRevoked) {
        this.shareInvitation = { ...this.shareInvitation, status: 'failed', error: '该用户已是协作者，请在成员管理中核对现有权限。' }; return false
      }
      if (typeof globalThis.crypto?.randomUUID !== 'function') {
        this.shareInvitation = { ...this.shareInvitation, status: 'failed', error: '当前环境无法安全创建邀请。' }; return false
      }
      // Each invitation owns a new source. Never reuse or overwrite Java/direct grants.
      this.shareInvitation = { ...this.shareInvitation, status: 'confirm', expectedRevision: this.shareMembers.authzVersion, sourceGrantKey: `ui-share-${globalThis.crypto.randomUUID()}`, operationId: `share-${globalThis.crypto.randomUUID()}` }
      return true
    },
    setShareInviteRole(role) {
      if (this.shareInvitation.status === 'confirm' && Object.hasOwn(INVITE_SCOPES, role)) this.shareInvitation = { ...this.shareInvitation, role }
    },
    cancelShareInvitation() {
      if (!unresolvedInvitation(this.shareInvitation)) { delete this._shareReadTokens?.invitation; this._shareInviteCurrent = null; this.shareInvitation = emptyInvitation() }
    },
    async submitShareInvitation() {
      const invitation = this.shareInvitation, current = this._shareInviteCurrent
      if (invitation.status !== 'confirm' || !current?.() || !this.shareCan('canView') || !this.shareCan('canManagePermission') || !Object.hasOwn(INVITE_SCOPES, invitation.role)) return false
      this.shareInvitation = { ...invitation, status: 'sending', error: '' }
      try {
        const result = await this.session.requestShare({ operationId: invitation.operationId, subject: invitation.candidate.principalId, originType: 'share', sourceGrantKey: invitation.sourceGrantKey,
          expectedRevision: invitation.expectedRevision, sourceRevision: '1', scopes: INVITE_SCOPES[invitation.role].slice() })
        if (!current()) return false
        return this.finishShareInvitation(result)
      } catch (error) {
        if (!current()) return false
        this.shareInvitation = { ...invitation, status: error.status !== 'rejected' ? 'unknown' : 'failed', error: error.status !== 'rejected' ? '邀请结果尚未确认，请查询原操作。' : '邀请未提交成功，请刷新协作者后重新选择。' }
        return false
      }
    },
    async queryShareInvitation() {
      const invitation = this.shareInvitation, current = this._shareInviteCurrent
      if (!['unknown', 'blocked', 'committed'].includes(invitation.status) || !invitation.operationId || !current?.() || !this.shareCan('canView') || !this.shareCan('canManagePermission')) return false
      this.shareInvitation = { ...invitation, status: 'querying', error: '' }
      try {
        const result = await this.session.queryShareOperation(invitation.operationId)
        if (!current()) return false
        return this.finishShareInvitation(result)
      } catch (_) {
        if (current()) this.shareInvitation = { ...invitation, status: 'unknown', error: '原邀请操作尚未确认，请稍后再查询。' }
        return false
      }
    },
    async finishShareInvitation(result) {
      const invitation = this.shareInvitation
      this.shareInvitation = { ...invitation, status: result.status === 'committed' ? 'committed' : 'blocked', verified: false, error: result.status === 'committed' ? '' : '邀请来源尚未就绪，请查询原操作。' }
      if (result.status === 'committed') {
        await this.loadShareMembers()
        if (!this._shareInviteCurrent?.() || this.shareInvitation.operationId !== invitation.operationId) return false
        const member = this.shareMembers.items.find(item => item.principalId === invitation.candidate.principalId)
        const source = member?.sources?.find(item => item.originType === 'share' && item.sourceGrantKey === invitation.sourceGrantKey && !item.revoked && !item.sourceGap && item.sourceRevision === '1')
        const verified = !!source && INVITE_SCOPES[invitation.role].every(scope => source.scopes.includes(scope))
        this.shareInvitation = { ...this.shareInvitation, verified, error: verified ? '' : '邀请已提交，成员权限回读尚未确认，请查询原操作。' }
      }
      return result.status === 'committed'
    },
    toggleImageShareRecipient(id, kind) {
      const state = this.imageShare
      if (!state || state.sending) return
      const selected = state.recipients.some(item => item.id === id && item.kind === kind)
      const item = state.results.find(item => item.id === id && item.kind === kind)
      const recipients = selected ? state.recipients.filter(item => item.id !== id || item.kind !== kind) : item ? [...state.recipients, item] : state.recipients
      this.imageShare = { ...state, recipients }
    },
    setImageShareMessage(message) { if (this.imageShare && !this.imageShare.sending) this.imageShare = { ...this.imageShare, message } },
    async submitSelectionShare() {
      const state = this.imageShare, target = this._selectionShareTarget
      if (state?.target !== 'selection' || state.sending || !state.recipients.length) return false
      if (!this.selectionShareTargetValid(target)) { this.closeImageShareDialog(); return false }
      const callback = target.callback
      if (typeof callback !== 'function') { this.imageShare = { ...state, error: '当前宿主尚未配置选区分享服务' }; return false }
      const controller = this._imageShareAbort = new AbortController()
      this._imageShareSearchToken = (this._imageShareSearchToken || 0) + 1
      this.imageShare = { ...state, loading: false, sending: true, error: '' }
      const pending = this.imageShare
      try {
        const url = new URL(target.documentLink)
        if (!/^https?:$/.test(url.protocol) || !safeUrl(url.href)) throw new Error('文档分享地址无效')
        url.hash = `share-${target.blockId}`
        const result = await callback({ selection: JSON.parse(JSON.stringify(state.selection)), url: url.href, recipients: state.recipients.map(item => ({ ...item })), message: state.message, signal: controller.signal })
        if (controller.signal.aborted || this.imageShare !== pending || this._selectionShareTarget !== target) return false
        if (!this.selectionShareTargetValid(target)) { this.closeImageShareDialog(); return false }
        if (result === false) throw new Error('选区分享失败，请重试')
        this._imageShareAbort = null
        this.closeImageShareDialog()
        this.showShareToast('success', '发送成功')
        return true
      } catch (error) {
        if (this.imageShare === pending && !controller.signal.aborted && this._selectionShareTarget === target) {
          if (!this.selectionShareTargetValid(target)) this.closeImageShareDialog()
          else { this._imageShareAbort = null; this.imageShare = { ...state, loading: false, sending: false, error: error?.message || '选区分享失败，请重试' } }
        }
        return false
      }
    },
    async submitImageShare() {
      const state = this.imageShare, callback = this.onImageShare, editor = this.editor, session = this.session
      if (state?.target === 'selection') return this.submitSelectionShare()
      if (!state || state.sending || !state.recipients.length) return false
      if (typeof callback !== 'function') { this.imageShare = { ...state, error: '当前宿主尚未配置图片分享服务' }; return false }
      const node = editor?.state.doc.nodeAt(state.image.pos)
      if (node?.type.name !== 'image' || node.attrs.blockId !== state.image.blockId || node.attrs.src !== state.image.src) { this.imageShare = { ...state, error: '原图片已变化，请重新打开分享' }; return false }
      const controller = this._imageShareAbort = new AbortController()
      this._imageShareSearchToken = (this._imageShareSearchToken || 0) + 1
      this.imageShare = { ...state, loading: false, sending: true, error: '' }
      const pending = this.imageShare
      try {
        const url = new URL(this.shareDocumentLink())
        url.hash = `share-${state.image.blockId}`
        const result = await callback({ image: { ...node.attrs }, url: url.href, recipients: state.recipients.map(item => ({ ...item })), message: state.message, signal: controller.signal })
        if (controller.signal.aborted || this.imageShare !== pending || this.editor !== editor || editor?.isDestroyed || this.session !== session || this.onImageShare !== callback) {
          if (this.imageShare === pending) this.closeImageShareDialog()
          return false
        }
        if (result === false) throw new Error('图片分享失败，请重试')
        this._imageShareAbort = null
        this.closeImageShareDialog()
        this.showShareToast('success', '发送成功')
        return true
      } catch (error) {
        if (this.imageShare === pending && !controller.signal.aborted) {
          if (this.editor !== editor || editor?.isDestroyed || this.session !== session || this.onImageShare !== callback) this.closeImageShareDialog()
          else this.imageShare = { ...state, loading: false, sending: false, error: error?.message || '图片分享失败，请重试' }
        }
        return false
      }
    },
  }
  return { methods }
}
