/**
 * 面板布局与正文装饰 —— 面板拓扑、锚点定位、装饰重建、事务与视口投影、指针高亮跳转。
 *
 * 从 `commentsMixin.js` 原样搬出，方法体一行未改；以对象展开并入 `methods`。
 * `Plugin` / `Decoration` 只在这里出现，所以这两条 import 也跟着搬过来。
 */

import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { COMMENT_HEIGHTS, COMMENT_PANEL, COMMENT_MORE_MENU, COMMENT_REPLY_MENU, commentPanelHeight, setCommentMarkStates } from '../../../core/blocks/comment'
import { bindThreads } from '../../../core/comments/binding'
import { decodeAnchor } from '../../../core/comments/anchor'
import { getTransactionMetadata, PAGED_IMPORT_META, TRANSACTION_ORIGINS } from '../../../core/transactionMetadata'
import { COMMENT_ANCHOR_GUTTER, COMMENT_VIEWPORT_MARGIN, COMMENT_PANEL_GAP, commentDraftText, commentRelativeTime, commentSidebarThreads } from './commentMixinShared'

export const commentsLayoutMethods = {
  commentFollowPreference(threadId) { return this.commentFollowPreferences[threadId] || null },



  async openCommentLink(value) {
    const provider = this.commentProvider()
    if (!provider || !provider.isRemote || !this.commentCan('canView')) return null
    const link = value || (typeof window !== 'undefined' && window.location.hash.startsWith('#larkComment=') ? window.location.href : '')
    if (!link) return null
    try {
      const result = this.session && typeof this.session.openCommentLink === 'function'
        ? await this.session.openCommentLink(link) : await provider.openLink(link)
      if (this.commentDisposed || provider !== this.commentProvider() || !this.commentCan('canView')) return null
      await this.loadComments()
      const item = this.commentThreads.find(thread => thread.id === result.target.threadId)
      if (!item) throw new Error('COMMENT_NOT_VISIBLE')
      this.activateComment(item.id)
      if (result.target.anchorStatus === 'orphaned' || item.anchorStatus === 'orphaned') this.commentMessage = '原引用已删除或无法定位；仍可查看获准的评论。'
      else if (item.bound) this.scrollCommentIntoView(item.blockId)
      return result
    } catch (error) {
      await this.clearUnavailableCommentView(error)
      if (!this.commentDisposed) this.commentMessage = '评论不可见或当前无权访问。'
      return null
    }
  },
  commentTranslationIsCurrent(value) {
    if (this.commentDisposed || !value || !this.commentCan('canView')) return false
    const owner = value === this.commentTranslationState && this._commentTranslationOwner
    if (owner && (owner.session !== this.session || owner.generation !== (this.session && this.session._commentGeneration) || owner.componentGeneration !== this.commentIdentityGeneration ||
      owner.identity !== (this.session && this.session.user && this.session.user.id) || owner.provider !== this.commentProvider())) return false
    const thread = this.commentThreads.find(item => item.id === value.threadId && !item.tombstone)
    return Boolean(thread && thread.replies.some(reply => reply.id === value.replyId && !reply.tombstone && reply.replyRevision === value.sourceRevision))
  },
  async clearUnavailableCommentView(error) {
    if (this.commentDisposed || !error || !(error.code === 'COMMENT_NOT_VISIBLE' || error.code === 'TRANSLATION_SOURCE_STALE' || [401, 403, 404].includes(error.httpStatus || error.status))) return
    this.commentLoadGeneration++
    this.commentSourceThreads = []; this.commentThreads = []; this.commentPanels = []; this.commentFollowPreferences = {}
    this.commentTranslationState = null; this.commentTranslationContext = null
    this.commentEditingReply = null; this.commentEditContent = ''; this.commentEditMentions = []; this.commentEditReferences = []
    this.refreshCommentDecorations()
    await this.loadComments().catch(() => {})
  },



  // —— 几何 ——
  /** 由宿主的 `onTransaction` 调；只做「过滤 + 清理失效 id」，几何交给下一帧。 */
  updateCommentPanels() {
    if (!this.editor) {
      this.commentPanels = []
      this.commentActiveThreadId = ''
      return
    }
    const provider = this.commentProvider()
    if (provider && Array.isArray(this.commentSourceThreads)) {
      this.commentThreads = bindThreads(this.editor.state.doc, this.commentSourceThreads, this.commentAnchorCodec)
    }
    const remote = provider && provider.isRemote
    const items = commentSidebarThreads(this.commentThreads, remote, this.commentHistorical, this.commentHistory)
    if (this.commentActiveThreadId && !(remote ? this.commentThreads.filter(thread => !thread.tombstone) : items).some((thread) => thread.id === this.commentActiveThreadId)) {
      this.commentActiveThreadId = ''
    }
    this.commentPanels = items.map((thread) => ({ ...thread, left: 0, top: 0 }))
    this.syncCommentMarkState()
    this.$nextTick(() => this.placeCommentPanels())
  },
  /**
   * 已解决/失联状态直接落在正文标记上（与基线一致）：CSS 与验收都读这两个属性。
   *
   * 独立成方法是因为它不能只挂在 `updateCommentPanels()` 上：`loadComments()` 里那条
   * 刷新链会因为身份/文档代次判定而提前返回，解决评论后正文标记就停在 `data-resolved`
   * 缺失的状态 —— 高亮既不会转灰，`pointer-events: none` 也不会生效。
   *
   * 先把状态写进 mark 的状态表（`renderHTML` 据此产出属性，重排不丢），再对现存的
   * 标记补写一次让状态变更当场生效。补写只写有变化的属性：属性一变就稳定，不会反复。
   */
  syncCommentMarkState() {
    const marks = this.editor?.view?.dom?.querySelectorAll?.('.lark-doc-comment[data-thread-id]')
    if (!marks?.length) { setCommentMarkStates(new Map()); return }
    const states = new Map(this.commentThreads.map(thread => [thread.id, { resolved: !!thread.resolved, missing: false }]))
    marks.forEach(mark => {
      const threadId = mark.getAttribute('data-thread-id')
      if (!states.has(threadId)) states.set(threadId, { resolved: false, missing: true })
    })
    setCommentMarkStates(states)
    marks.forEach(mark => {
      const expected = states.get(mark.getAttribute('data-thread-id'))
      const resolved = String(expected.resolved), missing = String(expected.missing)
      if (mark.getAttribute('data-resolved') !== resolved) mark.setAttribute('data-resolved', resolved)
      if (mark.getAttribute('data-comment-missing') !== missing) mark.setAttribute('data-comment-missing', missing)
    })
  },
  placeCommentPanels() {
    if (this._isBeingDestroyed || this._isDestroyed || this.editor?.isDestroyed) return
    this.updateCommentLayerBounds?.()
    const view = this.editor?.view
    if (!view) return
    if (this._mobileEditorMedia?.matches && this.commentSidebarOpen && !this.commentComposerOpen && !this.commentHistorical) {
      const main = this.$refs.root?.querySelector('.lark-doc-main'), bounds = main?.getBoundingClientRect()
      const cards = [...(this.$el.querySelector('.is-reference-drawer')?.querySelectorAll('[data-comment-thread]') || [])]
      const at = item => {
        const pos = this.commentBlockPos(item.blockId), node = pos >= 0 ? view.nodeDOM(pos) : null
        const top = node?.getBoundingClientRect?.().top
        return Number.isFinite(top) ? top - (bounds?.top || 0) + (main?.scrollTop || 0) : 65
      }
      let floor = 65
      this.commitCommentPanels([...this.commentPanels].sort((a, b) => at(a) - at(b)).map(item => {
        const top = Math.max(floor, at(item)), gap = top - floor
        const height = cards.find(node => node.dataset.commentThread === item.id)?.getBoundingClientRect().height || this.commentPanelHeightOf(item)
        floor = top + height + 36
        return { ...item, top, gap }
      }))
      return
    }
    if (this.commentRemote) {
      const layer = this.$el.querySelector('.lark-doc-comment-layer.is-remote')
      let floor = this.commentLayerTop + 52
      const at = anchor => {
        const pos = anchor && this.commentBlockPos(anchor.blockId)
        if (pos == null || pos < 0) return floor
        try { return view.coordsAtPos(pos + 1 + (anchor.offset || 0)).top } catch (error) { return floor }
      }
      if (this.commentComposerOpen && this.commentComposerContext) {
        const anchor = decodeAnchor(this.commentComposerContext.anchor, this.commentAnchorCodec)
        this.commentComposerGap = Math.max(0, at(anchor) - floor)
        floor += this.commentComposerGap + (layer?.querySelector('.lark-doc-comment-composer')?.getBoundingClientRect().height || COMMENT_HEIGHTS.empty) + COMMENT_PANEL_GAP
      }
      const nodes = layer ? [...layer.querySelectorAll('[data-comment-thread]')] : []
      this.commitCommentPanels([...this.commentPanels].sort((a, b) => at(a.anchor) - at(b.anchor)).map(item => {
        const top = Math.max(floor, item.bound ? at(item.anchor) : floor)
        const gap = Math.max(0, top - floor)
        const height = nodes.find(node => node.dataset.commentThread === item.id)?.getBoundingClientRect().height || this.commentPanelHeightOf(item)
        floor = top + height + COMMENT_PANEL_GAP
        return { ...item, top, gap }
      }))
      return
    }
    if (!this.commentPanels.length) return
    const bound = view.dom.getBoundingClientRect()
    const viewport = this.commentViewport()
    const maxLeft = viewport.width - COMMENT_PANEL.width - COMMENT_VIEWPORT_MARGIN
    const left = Math.max(COMMENT_VIEWPORT_MARGIN, Math.min(maxLeft, bound.right + COMMENT_ANCHOR_GUTTER))
    const bottomLimit = viewport.height - COMMENT_VIEWPORT_MARGIN
    const cards = [...this.$el.querySelectorAll('[data-comment-thread]')]
    let floor = COMMENT_VIEWPORT_MARGIN
    this.commitCommentPanels(this.commentPanels.map((item) => {
      const pos = item.bound ? this.commentBlockPos(item.blockId) : -1
      let anchorTop = bound.top
      if (pos >= 0) {
        try {
          anchorTop = view.coordsAtPos(pos + 1).top
        } catch (error) {
          anchorTop = bound.top
        }
      }
      // 优先用实测高度：编辑态/带表情时内容比公式高，否则上收量算小了会溢出视口。
      const height = cards.find(node => node.dataset.commentThread === item.id)?.getBoundingClientRect().height
        || this.commentPanelHeightOf(item)
      let top = Math.max(floor, anchorTop)
      // 放不下就上收，但**不收过前一块**，否则两个面板会叠在一起。
      if (top + height > bottomLimit) top = Math.max(floor, bottomLimit - height)
      floor = top + height + COMMENT_PANEL_GAP
      return { ...item, left, top }
    }))
  },
  /**
   * 写回面板位置；位置没变就不写。
   *
   * `commentPanels` 上有 deep watch 会触发 `refreshPanels()`，而重排又是从 `refreshPanels()`
   * 排的 —— 无条件写回会变成「重排 → 刷新 → 重排」的死循环。
   */
  commitCommentPanels(next) {
    const prev = this.commentPanels || []
    const same = prev.length === next.length && next.every((item, index) => item.top === prev[index].top
      && item.left === prev[index].left && (item.gap || 0) === (prev[index].gap || 0))
    if (!same) this.commentPanels = next
  },
  refreshImportedComments(payload) {
    if (payload.transaction.getMeta(PAGED_IMPORT_META)) this.onCommentTransaction({ ...payload, imported: true })
    // `data-resolved` / `data-comment-missing` 挂在标记外层 span 上，是纯运行时属性：
    // 文档或装饰重算后 ProseMirror 会重建这些 span，属性随之丢失（解决评论过程中就是
    // 这样丢的）。这里挂在 view 更新之后补一次（幂等、无差异不写），否则高亮既不变灰，
    // 也拿不到 `pointer-events: none`，表格里跨高亮的矩形拖选会退化成单格文本选区。
    this.$nextTick(() => this.syncCommentMarkState())
  },
  onCommentTransaction({ transaction, imported = false } = {}) {
    const imageScope = this._imageCommentScope
    const replaced = transaction?.docChanged && ([TRANSACTION_ORIGINS.HOST, TRANSACTION_ORIGINS.RESTORE].includes(getTransactionMetadata(transaction)?.origin)
      || transaction.steps.some(step => step.from === 0 && step.to >= transaction.before.content.size))
    if (replaced) { this._imageCommentDrafts = null; this._imageCommentDraftOwner = null }
    if (imageScope && transaction?.docChanged && (replaced || !this.imageCommentCurrent(imageScope))) this.closeImageComments(null, false)
    if (transaction?.docChanged) for (const range of new Set([this.commentComposerContext, this._commentSubmittingRange, this._imageCommentScope?.previous.commentComposerContext])) {
      if (!range || range.invalid) continue
      const selected = range.ranges || [range]
      range.ranges = selected.map(item => {
        const from = transaction.mapping.mapResult(item.from, 1), to = transaction.mapping.mapResult(item.to, -1)
        if (from.deletedAcross || to.deletedAcross || from.pos >= to.pos) range.invalid = true
        return { from: from.pos, to: to.pos }
      })
      range.from = range.ranges[0].from; range.to = range.ranges[range.ranges.length - 1].to
      range.bookmark = range.bookmark?.map(transaction.mapping)
    }
    if (!imported && transaction?.getMeta(PAGED_IMPORT_META)) return
    const provider = this.commentProvider()
    if (this.commentDisposed) return
    if (provider && (provider.isRemote || imported)) {
      this.updateCommentPanels()
      return
    }
    // 只在文档变更后补一次（幂等）：行内标记只在重建 DOM 时丢属性。
    // 纯选区事务不能写 —— 表格矩形拖选中途改正文属性会触发 ProseMirror 的 DOM observer，
    // 它随即把浏览器原生 Range 读回 state，CellSelection 被 TextSelection 覆盖，拖选当场消失。
    if (transaction?.docChanged) this.$nextTick(() => this.syncCommentMarkState())
  },
  installCommentDecorations() {
    const provider = this.commentProvider()
    if (!provider || !provider.isRemote || !this.editor || this._commentDecorationKey) return
    const vm = this
    const key = new PluginKey('lark-doc-private-comment-view')
    this._commentDecorationKey = key
    this.editor.registerPlugin(new Plugin({ key, props: { decorations(state) {
      if (vm.commentDisposed || !vm.commentCan('canView') || vm.featureEnabled?.('comments') === false || !vm.commentProvider()?.isRemote) return DecorationSet.empty
      const decorations = []
      const badges = vm.compactHeader ? new Map() : null
      const highlight = (anchor, attributes) => state.doc.descendants((node, pos) => {
        if (!node.attrs || node.attrs.blockId !== anchor.blockId) return
        const from = pos + 1 + anchor.offset, to = from + anchor.length
        // 相对端点解码后的length可能跨段；由DecorationSet拆到各文本块，不截断在首块。
        if (anchor.offset <= node.content.size && to <= state.doc.content.size && to > from) decorations.push(Decoration.inline(from, to, attributes))
        return false
      })
      const context = vm.commentComposerOpen && vm.commentComposerContext
      const draft = context && decodeAnchor(context.anchor, vm.commentAnchorCodec)
      if (draft && draft.length) highlight(draft, { class: 'lark-doc-comment is-active is-draft' })
      bindThreads(state.doc, vm.commentSourceThreads, vm.commentAnchorCodec).forEach(thread => {
        if (!thread.bound || thread.tombstone || thread.resolved || !thread.anchor.length) return
        highlight(thread.anchor, { class: `lark-doc-comment${thread.id === vm.commentActiveThreadId ? ' is-active' : ''}`, 'data-thread-id': thread.id })
        if (!badges || thread.anchorStatus === 'orphaned' || thread.scope === 'document') return
        const badge = badges.get(thread.blockId)
        if (badge) badge.count++
        else badges.set(thread.blockId, { thread, count: 1 })
      })
      if (badges?.size) state.doc.descendants((node, pos) => {
        const badge = badges.get(node.attrs.blockId)
        if (!badge) return
        const { thread, count } = badge
        decorations.push(Decoration.widget(pos + 1, view => {
          const button = view.dom.ownerDocument.createElement('button')
          button.type = 'button'
          button.className = 'lark-doc-comment-count'
          button.textContent = String(count)
          button.setAttribute('aria-label', `查看此处的 ${count} 条评论`)
          button.addEventListener('mousedown', event => event.preventDefault())
          button.addEventListener('click', event => {
            event.stopPropagation()
            if (button.isConnected && vm.compactHeader && vm.commentCan('canView')
              && vm.featureEnabled?.('comments') !== false && vm.commentProvider()?.isRemote && vm.commentThreads.some(item =>
              item.id === thread.id && item.bound && !item.resolved && !item.tombstone)) vm.activateComment(thread.id)
          })
          return button
        }, { key: `comment-count:${thread.id}:${count}`, side: -1, stopEvent: () => true }))
      })
      return DecorationSet.create(state.doc, decorations)
    } } }))
  },
  refreshCommentDecorations() {
    if (this.editor && this._commentDecorationKey && !this.commentDisposed) this.editor.view.dispatch(this.editor.state.tr.setMeta(this._commentDecorationKey, true).setMeta('addToHistory', false))
  },
  updateCommentLayerBounds() {
    const dom = this.editor && this.editor.view && this.editor.view.dom
    if (!this.commentRemote || !dom || typeof dom.closest !== 'function') return
    const root = dom.closest('.lark-doc')
    if (!root) return
    const bars = Array.from(root.querySelectorAll('.lark-doc-topbar, .lark-doc-toolbar')).filter(node => node.getClientRects().length)
    this.commentLayerTop = Math.max(COMMENT_VIEWPORT_MARGIN, ...bars.map(node => node.getBoundingClientRect().bottom + COMMENT_PANEL_GAP))
    const viewport = this.commentViewport()
    const win = typeof window !== 'undefined' ? window : null
    const layoutWidth = Number(win?.innerWidth) || viewport.width
    const layoutHeight = Number(win?.innerHeight) || viewport.height
    const layer = root.querySelector('.lark-doc-comment-layer.is-remote')
    if (layer) {
      layer.style.right = `${layoutWidth <= 760 ? 0 : Math.max(COMMENT_VIEWPORT_MARGIN * 2, layoutWidth - viewport.width + COMMENT_VIEWPORT_MARGIN * 2)}px`
      layer.style.bottom = `${layoutWidth <= 760 ? 0 : Math.max(COMMENT_VIEWPORT_MARGIN * 2, layoutHeight - viewport.height + COMMENT_VIEWPORT_MARGIN * 2)}px`
    }
    this.commentLayerHeight = Math.max(0, Math.min(viewport.height, root.getBoundingClientRect().bottom) - this.commentLayerTop - 16)
  },
  // 视口尺寸变化（软键盘弹出、工具栏折叠）不是内容滚动：选择器是 fixed 定位、
  // 没有可跟随的滚动容器，刚打开就被抖动关掉等于该入口在移动端不可用。
  // 这里只把选择器收敛回可视区域，真正的滚动仍按原语义关闭。
  refitCommentReaction() {
    const context = this.commentReactionContext
    const root = this.$el
    const picker = root?.querySelector?.('.lark-doc-comment-reaction-picker')
      || root?.ownerDocument?.querySelector?.('.lark-doc-comment-reaction-picker')
    const rect = picker?.getBoundingClientRect?.()
    if (!context?.position || !rect || !rect.width || !rect.height) return
    const viewport = this.commentViewport()
    const left = Math.max(COMMENT_VIEWPORT_MARGIN, Math.min(context.position.left, viewport.width - rect.width - COMMENT_VIEWPORT_MARGIN))
    const top = Math.max(COMMENT_VIEWPORT_MARGIN, Math.min(context.position.top, viewport.height - rect.height - COMMENT_VIEWPORT_MARGIN))
    if (left === context.position.left && top === context.position.top) return
    context.position = { left, top }
    this.refreshPanels?.()
  },
  onCommentViewportChange(event) {
    const target = event && event.target
    const menuScroll = target && typeof target.closest === 'function' && target.closest('.lark-doc-comment-more-menu, .lark-doc-comment-reply-menu, .lark-doc-comment-reaction-picker')
    const resized = !!event && event.type === 'resize'
    this.updateCommentLayerBounds?.()
    if (resized) this.refitCommentReaction()
    else if (event && !menuScroll && this.commentReactionContext) this.closeCommentReaction()
    if (event && !menuScroll && this.commentRemote) {
      for (const [id, anchorKey, position, geometry] of [
        ['commentMoreThreadId', '_commentMoreMenuAnchor', 'commentMoreMenuPosition', COMMENT_MORE_MENU],
        ['commentMenuThreadId', '_commentReplyMenuAnchor', 'commentReplyMenuPosition', COMMENT_REPLY_MENU],
      ]) {
        if (!this[id]) continue
        const anchor = this[anchorKey], rect = anchor && anchor.isConnected && anchor.getBoundingClientRect()
        const viewport = this.commentViewport()
        if (!rect || rect.bottom < this.commentLayerTop || rect.top > viewport.height) {
          this[id] = ''; this[position] = null; this[anchorKey] = null
          if (id === 'commentMenuThreadId') this.commentMenuCommentId = ''
        } else this[position] = this.commentMenuPosition({ currentTarget: anchor }, geometry.width, geometry.height)
      }
    }
    if (this.commentPanels.length) this.placeCommentPanels()
  },

  // —— 渲染给面板的取值 ——
  commentPanelHeightOf(item) {
    // 表情回复每条多占 26px（0facf05 口径）。
    return commentPanelHeight(item.replies.length, this.commentHasDraft(item.id))
      + item.replies.filter(reply => reply.reactions?.length).length * 26
  },
  commentPanelStyle(item) {
    return { left: `${item.left}px`, top: `${item.top}px` }
  },
  commentDraftOf(threadId) {
    return commentDraftText(this.commentDrafts, threadId)
  },
  commentTimeAt(at) {
    if (this._mobileEditorMedia?.matches && at) {
      const date = new Date(at)
      if (Number.isFinite(date.getTime())) return `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
    }
    return commentRelativeTime(Date.now(), at)
  },
  commentAuthorName(author) {
    const name = author && typeof author.name === 'string' ? author.name.trim() : ''
    return name || '我'
  },

  /** 引用头：优先用落库时的快照文本，没有就退回锚点块的第一段（飞书同样是快照）。 */
  commentQuoteOf(item) {
    if (typeof item.quote === 'string' && item.quote) return item.quote
    const pos = this.commentBlockPos?.(item.blockId) ?? -1
    return pos >= 0 && this.editor?.state.doc.nodeAt(pos)?.type.name === 'image' ? '[图片]' : ''
  },

  /** 点正文高亮点亮对应线程（与 04 §3.1② 的双向跳转一致）。 */
  onCommentPointerDown(event) {
    const target = event.target
    const container = target && typeof target.closest === 'function' ? target.closest('.lark-doc-comment') : null
    if (!container) return
    this.activateComment(container.getAttribute('data-thread-id') || '')
    this.$nextTick(() => {
      const panels = this.$el.querySelectorAll('[data-comment-thread]')
      for (const panel of panels) if (panel.dataset.commentThread === this.commentActiveThreadId) panel.scrollIntoView({ block: 'nearest' })
    })
  },
}
