/**
 * 分享链接与选区 / 图片分享 —— 链接自动加载、read 订阅、选区目标校验、图片接收人搜索。
 *
 * 从 `shareMixin.js` 原样搬出，方法体一行未改；以对象展开并入 `methods`。
 */

import { searchMentionDirectory } from '../../../core/mention/directory'
import { NodeSelection } from '@tiptap/pm/state'
import { BLOCK_ID_PATTERN } from '../../../core/documentOperations'
import { createNetworkPolicy } from '../../../core/policy/network'
import { cloneShareExcerpt } from './shareContent'
import { shareExcerpt, selectionShareKind, selectionShareBlock, shareNetworkKey, emptyInvitation } from './shareModel'

export const shareLinkMethods = {
    remoteShareScope() {
      const session = this.session, provider = session?.getProvider?.('authorization'), user = session?.user
      const actor = user?.id, documentId = session?.documentId, identity = session?._privateIdentityGeneration
      const identityGeneration = session?._identityGeneration, authorization = session?._authorizationGeneration
      const generation = this._shareLinkGeneration
      const owner = () => !this._shareReadsDisposed && !this._isDestroyed && !this._isBeingDestroyed && !session?._destroyed &&
        session === this.session && provider === session?.getProvider?.('authorization') && user === session?.user && actor === session?.user?.id &&
        documentId === session?.documentId && identity === session?._privateIdentityGeneration && identityGeneration === session?._identityGeneration &&
        authorization === session?._authorizationGeneration && generation === this._shareLinkGeneration
      return { provider, session, owner, current: () => owner() && provider?.isRemote === true && typeof provider.shareLink === 'function' &&
        (this.sharePopoverOpen || this.permissionDialogOpen) && this.shareCan('canView') && this.shareCan('canManagePermission') }
    },
    resetShareLink() {
      this._shareLinkGeneration = (this._shareLinkGeneration || 0) + 1
      this._shareLinkToken = null
      this._shareLinkSnapshotOwner = null
      this.shareLinkState = null; this.shareLinkBusy = false; this.shareLinkPending = ''; this.shareLinkError = ''
      this.secureLinkEnabled = false; this.secureLinkPassword = ''; this.passwordDraft = ''
      this.secureLinkConfirmOpen = false; this.passwordDialogOpen = false
    },
    async shareLinkAction(action, input) {
      const scope = this.remoteShareScope()
      if (!scope.current()) {
        if (scope.owner() && (this.sharePopoverOpen || this.permissionDialogOpen)) {
          this.shareLinkError = '链接权限服务尚未接入，当前不可用。'
          this.showShareToast('warning', this.shareLinkError)
        }
        return null
      }
      try {
        const module = await import(/* webpackChunkName: "share-links" */ '../../../providers/share-links')
        if (!scope.current()) return null
        return await module.remoteShareLinkAction(this, action, input)
      } catch {
        if (scope.current()) { this.shareLinkError = '链接设置未能完成，请重试。'; this.showShareToast('warning', this.shareLinkError) }
        return null
      }
    },
    loadShareLink() { return this.shareLinkAction('load') },
    queryShareLink() { return this.shareLinkAction('load') },
    setShareLinkAudience(value) {
      if (!['collaborators', 'public'].includes(value) || !this.shareLinkWritable) return null
      return this.shareLinkAction('audience', value)
    },
    clearShareReads({ keepInvitation = false } = {}) {
      clearTimeout(this._shareDirectoryTimer)
      this._shareReadTokens = keepInvitation ? { invitation: this._shareReadTokens?.invitation } : {}
      this.shareMembers = { status: 'idle', items: [], authzVersion: '' }
      this.shareDirectory = { status: 'idle', items: [], error: '' }
      this.shareInviteQuery = ''
      if (!keepInvitation) { this.shareInvitation = emptyInvitation(); this._shareInviteCurrent = null }
    },
    bindShareReads() {
      this._shareReadsOff?.()
      this.clearShareReads()
      const session = this.session
      let context = [session?.documentId, session?.user?.id, session?._privateIdentityGeneration, session?.getProvider?.('authorization')]
      const invalidate = () => {
        const next = [session?.documentId, session?.user?.id, session?._privateIdentityGeneration, session?.getProvider?.('authorization')]
        if (this.session === session && next.every((value, index) => value === context[index])) return
        context = next
        this.closeImageShareDialog()
        this.resetShareLink()
        this.closePermissionDialog()
        this.clearShareReads()
        this.closeSharePopover()
      }
      // `comments-reset` 是 Session 私有身份视图清理的唯一广播通道（换人、凭据轮换、
      // provider 替换）；上面的 context 比较保证同身份授权复核不会误清在读的接收人。
      const stops = ['identity', 'provider-changed', 'comments-reset'].map(name => session?.on?.(name, invalidate)).filter(Boolean)
      const capabilityStop = session?.on?.('capabilities', () => {
        this.resetShareLink()
        if (!this.shareCan('canView') || !this.shareCan('canManagePermission')) { this.closeSharePopover(); this.closePermissionDialog() }
        else if (this.sharePopoverOpen || this.permissionDialogOpen) void this.loadShareLink()
      })
      if (typeof capabilityStop === 'function') stops.push(capabilityStop)
      this._shareReadsOff = () => stops.forEach(stop => stop())
    },
    shareReadCurrent(kind, requirePermission = true) {
      const session = this.session, provider = session?.getProvider?.('authorization'), actor = session?.user?.id, documentId = session?.documentId, generation = session?._privateIdentityGeneration
      const token = {}; this._shareReadTokens ||= {}; this._shareReadTokens[kind] = token
      return () => !this._shareReadsDisposed && this._shareReadTokens[kind] === token && session === this.session && !session?._destroyed && documentId === session?.documentId && actor === session?.user?.id && generation === session?._privateIdentityGeneration && provider === session?.getProvider?.('authorization') && (!requirePermission || this.shareCan('canView') && this.shareCan('canManagePermission'))
    },
    async loadShareMembers() {
      if (!this.shareCan('canView') || !this.shareCan('canManagePermission')) return
      const current = this.shareReadCurrent('members')
      this.shareMembers = { status: 'loading', items: [], authzVersion: '' }
      try {
        if (typeof this.session?.getProvider?.('authorization')?.listMembers !== 'function') throw new Error('协作者服务尚未接入')
        const result = await this.session.listMembers()
        if (current()) this.shareMembers = { status: 'ready', items: result.members, authzVersion: result.authzVersion }
      } catch (error) { if (current()) this.shareMembers = { status: 'failed', items: [], authzVersion: '', error: error.message === '协作者服务尚未接入' ? error.message : '无法加载协作者，请重试。' } }
    },
    async searchShareDirectory() {
      const query = this.shareInviteQuery.trim()
      if (!query || !this.shareCan('canView') || !this.shareCan('canManagePermission')) return
      const current = this.shareReadCurrent('directory')
      this.shareDirectory = { status: 'loading', items: [], error: '' }
      try {
        if (typeof this.session?.getProvider?.('authorization')?.resolveMentions !== 'function') throw new Error('协作者搜索服务尚未接入')
        const result = await this.session.resolveMentions({ query, kinds: ['user'] })
        if (current() && query === this.shareInviteQuery.trim()) this.shareDirectory = { status: result.status === 'resolved' ? 'ready' : 'blocked', items: result.status === 'resolved' ? result.candidates : [], error: result.status === 'resolved' ? '' : '协作者目录暂不可用。' }
      } catch (error) { if (current()) this.shareDirectory = { status: 'failed', items: [], error: error.message === '协作者搜索服务尚未接入' ? error.message : '搜索失败，请重试。' } }
    },
    selectionShareAllowed() { return !this._selectionShareDisposed && this.shareCan('canView') && this.shareCan('canExport') },
    selectionShareTargetValid(target = this._selectionShareTarget, doc = this.editor?.state.doc) {
      if (!target || !doc || this.editor !== target.editor || target.editor.isDestroyed || this.session !== target.session || this.session?._destroyed || this.session?.documentId !== target.documentId || this.onSelectionShare !== target.callback || this._mentionProvider !== target.directory || !this.selectionShareAllowed() || shareNetworkKey(this) !== target.network || this.shareDocumentLink() !== target.documentLink) return false
      const session = this.session
      if (target.actor !== session?.user?.id || target.identity !== session?._privateIdentityGeneration || target.identityGeneration !== session?._identityGeneration ||
        target.authorizationGeneration !== session?._authorizationGeneration || target.authorizationProvider !== session?.getProvider?.('authorization')) return false
      try {
        const selection = target.bookmark.resolve(doc)
        const block = selectionShareBlock(selection)
        // Node/Slice equality also binds the captured descendant blockIds.
        return selectionShareKind(selection) === target.kind && block?.node.attrs.blockId === target.blockId && block.node.eq(target.node) && selection.content().eq(target.slice)
      } catch (_) { return false }
    },
    openSelectionShareDialog(pos) {
      const editor = this.editor
      if (!editor || editor.isDestroyed || !this.selectionShareAllowed()) return false
      try {
        if (pos !== undefined) {
          const node = Number.isInteger(pos) && editor.state.doc.nodeAt(pos)
          if (!node?.isBlock || !NodeSelection.isSelectable(node)) return false
          editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)).setMeta('addToHistory', false))
        }
        const selection = editor.state.selection
        const kind = selectionShareKind(selection), block = selectionShareBlock(selection)
        if (!kind || selection.empty || !block || !BLOCK_ID_PATTERN.test(block.node.attrs.blockId || '')) return false
        const slice = selection.content()
        const policy = createNetworkPolicy(this.larkDocConfig?.network)
        const source = editor.view.nodeDOM(block.pos)
        const table = block.node.type.name === 'table' ? (source?.matches?.('table') ? source : source?.querySelector?.('table')) : null
        const previewSource = table || source
        const unsupported = block.node.type.name === 'webEmbed' || (block.node.type.name === 'linkEmbed' && block.node.attrs.view === 'preview')
        const bounds = previewSource?.getBoundingClientRect?.()
        let dom = !unsupported && previewSource?.nodeType === 1 ? cloneShareExcerpt(previewSource, policy) : null
        if (kind === 'text') {
          const range = source?.ownerDocument.createRange(), start = editor.view.domAtPos(selection.from), end = editor.view.domAtPos(selection.to)
          if (!range) return false
          range.setStart(start.node, start.offset); range.setEnd(end.node, end.offset)
          const holder = source.ownerDocument.implementation.createHTMLDocument('').createElement('div')
          holder.appendChild(range.cloneContents())
          dom = cloneShareExcerpt(holder, policy)
        }
        const $block = editor.state.doc.resolve(block.pos), index = $block.index(), parent = $block.parent
        const beforeNode = index > 0 ? parent.child(index - 1) : null
        const afterNode = index + 1 < parent.childCount ? parent.child(index + 1) : null
        const context = (node, at) => node?.type.name === 'image' ? { type: 'image', text: '[图片]' } : shareExcerpt(editor, node, at, policy)
        const excerpt = { before: context(beforeNode, block.pos - (beforeNode?.nodeSize || 0)), after: context(afterNode, block.pos + block.node.nodeSize) }
        const session = this.session
        const target = { editor, session, documentId: session?.documentId, actor: session?.user?.id, identity: session?._privateIdentityGeneration,
          identityGeneration: session?._identityGeneration, authorizationGeneration: session?._authorizationGeneration, authorizationProvider: session?.getProvider?.('authorization'),
          callback: this.onSelectionShare, directory: this._mentionProvider, documentLink: this.shareDocumentLink(), network: shareNetworkKey(this), bookmark: selection.getBookmark(), kind, blockId: block.node.attrs.blockId, node: block.node, slice }
        this.closeImageShareDialog()
        this._selectionShareTarget = target
        const cancel = () => { if (this._selectionShareTarget === target) this.closeImageShareDialog() }
        const check = () => { if (!this.selectionShareTargetValid(target)) cancel() }
        const map = event => { if (this._selectionShareTarget === target) this.mapSelectionShare(event) }
        editor.on('transaction', map); editor.on('destroy', cancel)
        this._selectionShareOffs = [() => editor.off('transaction', map), () => editor.off('destroy', cancel)]
        for (const event of ['provider', 'editor', 'connection', 'capabilities', 'identity', 'provider-changed', 'comments-reset']) {
          const off = session?.on?.(event, ['provider', 'editor', 'connection'].includes(event) ? cancel : check)
          if (typeof off === 'function') this._selectionShareOffs.push(off)
        }
        const text = slice.content.textBetween(0, slice.content.size, '\n', node => node.type.name === 'image' ? '[图片]' : String(node.attrs.title || node.attrs.url || node.attrs.href || ''))
        this.imageShare = { target: 'selection', selection: { type: kind, blockId: target.blockId, text, content: slice.toJSON() }, preview: { dom, unsupported, width: bounds?.width || 340, height: bounds?.height || 44 }, excerpt, query: '', recipients: [], results: [], message: '', error: '', loading: false, sending: false }
        this.searchImageShareRecipients('')
        return true
      } catch (_) { return false }
    },
    mapSelectionShare({ transaction }) {
      const target = this._selectionShareTarget
      if (!target || !transaction.docChanged) return
      try {
        const previous = target.bookmark.resolve(transaction.before)
        if (previous.ranges.some(range => transaction.mapping.mapResult(range.$from.pos, 1).deleted || transaction.mapping.mapResult(range.$to.pos, -1).deleted)) { this.closeImageShareDialog(); return }
        target.bookmark = target.bookmark.map(transaction.mapping)
        if (!this.selectionShareTargetValid(target, transaction.doc)) this.closeImageShareDialog()
      } catch (_) { this.closeImageShareDialog() }
    },
    openImageShareDialog(image) {
      this.closeImageShareDialog()
      const doc = this.editor?.state.doc
      const resolved = doc && Number.isInteger(image.pos) ? doc.resolve(image.pos) : null
      const index = resolved?.index()
      const parent = resolved?.parent
      const context = (node, pos) => shareExcerpt(this.editor, node, pos)
      const previous = index > 0 ? parent?.child(index - 1) : null
      const excerpt = parent ? { before: context(previous, image.pos - (previous?.nodeSize || 0)), after: context(index + 1 < parent.childCount ? parent.child(index + 1) : null, image.pos + parent.child(index).nodeSize) } : null
      this.imageShare = { image, excerpt, query: '', recipients: [], results: [], message: '', error: '', loading: false, sending: false }
      this.searchImageShareRecipients('')
      return true
    },
    closeImageShareDialog() {
      this._imageShareSearchToken = (this._imageShareSearchToken || 0) + 1
      this._selectionShareOffs?.forEach(off => off())
      this._selectionShareOffs = null
      this._selectionShareTarget = null
      const controller = this._imageShareAbort
      this._imageShareAbort = null
      this.imageShare = null
      controller?.abort()
    },
    async searchImageShareRecipients(query) {
      if (!this.imageShare || this.imageShare.sending) return
      if (this.imageShare.target === 'selection' && !this.selectionShareTargetValid()) { this.closeImageShareDialog(); return }
      const token = this._imageShareSearchToken = (this._imageShareSearchToken || 0) + 1
      this.imageShare = { ...this.imageShare, query, loading: true }
      try {
        const items = this._mentionProvider ? await this._mentionProvider.search(query, { kind: 'all' }) : searchMentionDirectory(this.mentionDirectory, query, 'all')
        if (!this.imageShare || this.imageShare.sending || token !== this._imageShareSearchToken) return
        if (this.imageShare.target === 'selection' && !this.selectionShareTargetValid()) { this.closeImageShareDialog(); return }
        this.imageShare = { ...this.imageShare, loading: false, results: items.filter(item => item?.id && ['user', 'chat'].includes(item.kind)) }
      } catch (error) {
        if (this.imageShare && token === this._imageShareSearchToken) {
          if (this.imageShare.target === 'selection' && !this.selectionShareTargetValid()) this.closeImageShareDialog()
          else this.imageShare = { ...this.imageShare, loading: false, error: error?.message || '接收人搜索失败，请重试' }
        }
      }
    },
}
