import { getMarkRange } from '@tiptap/core'
import { closeHistory } from '@tiptap/pm/history'
import { BLOCK_ID_PATTERN, safeUrl, normalizeLinkUrl } from '../../../core/documentOperations'
import { createLinkTools } from '../../../ui/linkTools'
import { isCommandEnabled } from '../larkDocConfig'
import { readBookmarkHost, readBookmarkMeta } from '../../../core/embed/bookmark'

export default {
  watch: {
    effectiveReadonly() { this._linkTitleRequest = null; this.closeLinkTools() },
    larkDocConfig() { this._linkTitleRequest = null; this.closeLinkTools() },
    commentEntryVisible() { this.refreshLinkTools() },
    commentEntryAvailable() { this.refreshLinkTools() },
    selectionShareEntryAvailable() { this.refreshLinkTools() },
    commentContextEpoch() { this.refreshLinkTools() },
    linkDialog(value) { if (!value) { this._linkDialogTarget = null; this._linkInsertDoc = null; this.linkEditing = false } },
  },
  methods: {
    mountLinkTools() {
      this._linkToolsUi = createLinkTools({
        host: this.$refs.panelHost,
        handlers: {
          onEdit: () => this.editHoveredLink(), onRemove: () => this.removeHoveredLink(),
          onView: view => this.setLinkEmbedView(view),
          onCopy: kind => this.copyHoveredLink(kind),
          onRefresh: () => this.refreshHoveredPreview(),
          onOpen: () => this.openHoveredLink(),
          onComment: () => this.commentHoveredLink(),
          onShare: () => this.shareHoveredLink(),
          onKeep: () => clearTimeout(this._linkHideTimer),
          onLeave: () => this.scheduleLinkHide(),
        },
      })
    },
    linkTargetAt(element) {
      const view = this.editor?.view
      if (!view || !element || !view.dom.contains(element)) return null
      const block = element.closest('[data-type="link-embed"], [data-type="bookmark"]')
      if (block) {
        const pos = view.posAtDOM(block, 0)
        const node = view.state.doc.nodeAt(pos)
        if (!['linkEmbed', 'bookmark'].includes(node?.type.name)) return null
        const href = node.attrs.href || node.attrs.url
        if (!safeUrl(href)) return null
        const cardMeta = node.type.name === 'bookmark' ? JSON.stringify({ title: node.attrs.title, desc: node.attrs.desc, favicon: node.attrs.favicon, cover: node.attrs.cover, recordId: node.attrs.recordId }) : node.attrs.cardMeta
        return { from: pos, to: pos + node.nodeSize, href, title: node.attrs.title || readBookmarkHost(href) || node.attrs.linkTitle || href, cardMeta, view: node.type.name === 'bookmark' ? 'card' : node.attrs.view, node, element: block, doc: view.state.doc }
      }
      const anchor = element.closest('a[href]')
      if (!anchor) return null
      const pos = view.posAtDOM(anchor, 0)
      const range = getMarkRange(view.state.doc.resolve(pos), view.state.schema.marks.link)
      const mark = range && view.state.doc.resolve(range.from).nodeAfter?.marks.find(mark => mark.type.name === 'link')
      if (!mark || !safeUrl(mark.attrs.href)) return null
      const title = view.state.doc.textBetween(range.from, range.to)
      return { ...range, href: mark.attrs.href, title, cardMeta: mark.attrs.linkCardMeta, view: title === mark.attrs.href ? 'link' : 'title', element: anchor, doc: view.state.doc }
    },
    onLinkMouseOver(event) {
      const target = this.linkTargetAt(event.target)
      if (!target || this.linkDialog) return
      clearTimeout(this._linkHideTimer)
      this._linkTarget = target
      this.refreshLinkTools()
      this.loadLinkMetadata(target.href)
    },
    onLinkMouseOut(event) {
      if (this._linkTarget?.element.contains(event.relatedTarget) || this._linkToolsUi?.el.contains(event.relatedTarget)) return
      this.scheduleLinkHide()
    },
    scheduleLinkHide() {
      clearTimeout(this._linkHideTimer)
      this._linkHideTimer = setTimeout(() => this.closeLinkTools(), 180)
    },
    refreshLinkTools() {
      const target = this._linkTarget
      if (!target || target.doc !== this.editor?.state.doc || !target.element.isConnected) { this.closeLinkTools(); return }
      const rect = target.element.getBoundingClientRect()
      const meta = this._linkMetadata?.get(target.href)
      const extension = this.editor.extensionManager.extensions.find(item => item.name === 'linkEmbed')
      const http = /^https?:\/\//i.test(target.href)
      let preview = http && (target.view === 'preview' || meta?.preview === true)
      try {
        if (http && new URL(target.href).origin === target.element.ownerDocument.location.origin) preview = true
        if (extension?.options.canEmbed && extension.options.canEmbed(target.href) === false) preview = false
      } catch (_) { preview = false }
      const views = ['link', 'title', ...(http ? ['card'] : []), ...(preview ? ['preview'] : [])]
      this._linkToolsUi?.update({ open: true, ...target, views, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, readonly: !this.linkCommandEnabled(),
        commentVisible: !!this.commentEntryVisible, canComment: !!this.commentEntryAvailable, shareVisible: !!this.selectionShareEntryAvailable })
    },
    shareHoveredLink() {
      const target = this._linkTarget
      if (!this.selectionShareEntryAvailable || !target?.node || !['card', 'preview'].includes(target.view)
        || target.doc !== this.editor?.state.doc || !target.element.isConnected || this.editor.state.doc.nodeAt(target.from) !== target.node) return false
      const opened = this.openSelectionShareDialog(target.from)
      if (opened) this.closeLinkTools()
      return opened
    },
    commentHoveredLink() {
      const target = this._linkTarget
      if (!this.commentEntryAvailable || !target?.node || !['card', 'preview'].includes(target.view)
        || target.doc !== this.editor?.state.doc || !target.element.isConnected || this.editor.state.doc.nodeAt(target.from) !== target.node) return false
      const opened = this.beginCommentComposer(target.from)
      if (opened) this.closeLinkTools()
      return opened
    },
    loadLinkMetadata(href) {
      const provider = this.editor.extensionManager.extensions.find(item => item.name === 'bookmark')?.options.unfurl
      if (!provider || !/^https?:\/\//i.test(href)) return
      if (!this._linkMetadata) this._linkMetadata = new Map()
      if (this._linkMetadata.has(href)) return
      const cache = this._linkMetadata
      const pending = { pending: true }
      cache.set(href, pending)
      if (cache.size > 100) cache.delete(cache.keys().next().value)
      Promise.resolve().then(() => provider.unfurl(href)).then(result => {
        if (this.editor.isDestroyed || this._linkMetadata !== cache || cache.get(href) !== pending) return
        const meta = readBookmarkMeta(result)
        if (result?.ok === false) cache.delete(href)
        else cache.set(href, meta || {})
        const request = this._linkTitleRequest
        if (meta.title && request?.href === href && request.doc === this.editor.state.doc && this.editor.isEditable !== false && this.linkCommandEnabled()) {
          const { state, view } = this.editor
          const marks = state.doc.resolve(request.from).nodeAfter?.marks || []
          view.dispatch(state.tr.replaceWith(request.from, request.to, state.schema.text(meta.title, marks)).setMeta('addToHistory', false))
          this._linkTitleRequest = null
        }
        if (this._linkTarget?.href === href) this.refreshLinkTools()
      }, () => { if (this._linkMetadata === cache && cache.get(href) === pending) cache.delete(href) })
    },
    openHoveredLink() {
      const target = this._linkTarget
      if (!target || !safeUrl(target.href)) return false
      target.element.ownerDocument.defaultView.open(target.href, '_blank', 'noopener,noreferrer')
      return true
    },
    refreshHoveredPreview() {
      const target = this._linkTarget
      const frame = target?.view === 'preview' && target.element.querySelector('iframe')
      if (!frame || target.doc !== this.editor.state.doc) return false
      frame.src = target.href
      return true
    },
    closeLinkTools() {
      clearTimeout(this._linkHideTimer)
      this._linkTarget = null
      this._linkToolsUi?.update({ open: false })
    },
    onEditorLinkClick(event) {
      const anchor = event.target.closest?.('a[href]')
      if (!anchor || anchor.hasAttribute('download') || !this.editor.view.dom.contains(anchor) || !safeUrl(anchor.getAttribute('href')) || event.button > 0) return
      event.preventDefault()
      anchor.ownerDocument.defaultView.open(anchor.href, '_blank', 'noopener,noreferrer')
    },
    linkCommandEnabled(command = 'setLink') {
      return this.writable() && this.featureEnabled('marks') && this.featureEnabled('textStyle') && isCommandEnabled(this.larkDocConfig, 'link') && !this.larkDocConfig?.commands?.disabled?.includes(command)
    },
    editableLinkTarget(target = this._linkTarget, command = 'setLink') {
      return !!(target && this.linkCommandEnabled(command) && target.doc === this.editor.state.doc)
    },
    async copyHoveredLink(kind) {
      const target = this._linkTarget
      if (!target || target.doc !== this.editor.state.doc || !safeUrl(target.href)) return false
      const win = target.element.ownerDocument.defaultView
      try {
        let text = target.href
        if (kind === 'rich') {
          let blockId = target.node?.attrs.blockId
          if (!blockId) {
            const $pos = this.editor.state.doc.resolve(target.from)
            for (let depth = $pos.depth; depth > 0 && !blockId; depth -= 1) blockId = $pos.node(depth).attrs.blockId
          }
          if (!BLOCK_ID_PATTERN.test(blockId || '')) return false
          const url = new URL(this.shareDocumentLink(), win.location.href)
          if (!/^https?:$/.test(url.protocol)) return false
          url.hash = `share-${blockId}`
          text = url.href
        }
        if (!await this.copyShareText(text)) throw new Error('clipboard unavailable')
      } catch (_) {
        if (this._linkTarget === target && target.doc === this.editor.state.doc) this.error = '复制失败，请检查剪贴板权限'
        return false
      }
      if (this._linkTarget === target && target.doc === this.editor.state.doc) {
        this.closeLinkTools()
        this.showShareToast?.('success', '复制成功')
      }
      return true
    },
    editHoveredLink() {
      const target = this._linkTarget
      if (!this.editableLinkTarget(target)) return false
      this._linkDialogTarget = target
      this.linkEditing = true
      this.linkInsertMode = false
      this.linkValue = target.href
      this.linkText = target.title
      const { left, right, top, bottom } = target.element.getBoundingClientRect()
      this.linkDialogAnchor = { left, right, top, bottom }
      this.closeLinkTools()
      this.linkDialog = true
      return true
    },
    updateHoveredLink() {
      const target = this._linkDialogTarget
      const href = normalizeLinkUrl(this.linkValue)
      if (!this.editableLinkTarget(target) || !href) { this.error = '链接已变化或地址无效，请重新编辑'; return false }
      const text = this.linkText.trim() ? this.linkText : href
      if (text.length > 100000 || text.includes('\u0000')) { this.error = '链接标题或地址无效'; return false }
      const { state, view } = this.editor
      const tr = state.tr
      const cardMeta = href === target.href ? target.cardMeta : null
      const attrs = { href, target: '_blank', rel: 'noopener noreferrer', linkView: text === href ? 'link' : 'title', linkTitle: null, linkCardMeta: cardMeta }
      const display = text
      let link
      try { link = state.schema.marks.link.create(attrs) } catch (_) { this.error = '链接标题或地址无效'; return false }
      if (target.node) {
        const attrs = { ...target.node.attrs, [target.node.type.name === 'bookmark' ? 'url' : 'href']: href, title: text }
        if (target.node.type.name === 'linkEmbed') attrs.cardMeta = cardMeta
        else {
          attrs.linkTitle = text
          if (href !== target.href) { attrs.desc = null; attrs.favicon = null; attrs.cover = null; attrs.recordId = null }
        }
        try { target.node.type.create(attrs).check() } catch (_) { this.error = '链接标题或地址无效'; return false }
        tr.setNodeMarkup(target.from, null, attrs)
      } else if (display === state.doc.textBetween(target.from, target.to)) {
        tr.removeMark(target.from, target.to, state.schema.marks.link)
        tr.addMark(target.from, target.to, link)
      } else {
        const marks = state.doc.resolve(target.from).nodeAfter.marks.filter(mark => mark.type.name !== 'link')
        tr.replaceWith(target.from, target.to, state.schema.text(display, [...marks, link]))
      }
      view.dispatch(closeHistory(tr))
      this.linkDialog = false
      this.editor.commands.focus()
      return true
    },
    removeHoveredLink(target = this._linkTarget) {
      if (!this.editableLinkTarget(target, 'unsetLink')) return false
      const { state, view } = this.editor
      const tr = state.tr
      if (target.node) tr.replaceWith(target.from, target.to, state.schema.nodes.paragraph.create({ blockId: target.node.attrs.blockId }, state.schema.text(target.title)))
      else tr.removeMark(target.from, target.to, state.schema.marks.link)
      view.dispatch(closeHistory(tr))
      this.closeLinkTools()
      this.linkDialog = false
      return true
    },
    setLinkEmbedView(kind) {
      const target = this._linkTarget
      if (!this.editableLinkTarget(target) || !['title', 'link', 'card', 'preview'].includes(kind)) return false
      if (kind === target.view) return true
      const { state, view } = this.editor
      const tr = state.tr
      if (['title', 'link'].includes(kind)) {
        const meta = this._linkMetadata?.get(target.href)
        const snapshot = target.cardMeta ? JSON.parse(target.cardMeta) : {}
        const display = kind === 'link' ? target.href : meta?.title || snapshot.title || readBookmarkHost(target.href) || target.title
        let link
        try { link = state.schema.marks.link.create({ href: target.href, target: '_blank', rel: 'noopener noreferrer', linkView: kind, linkTitle: null, linkCardMeta: target.cardMeta || null }) } catch (_) { this.error = '链接标题或地址无效'; return false }
        const marks = target.node ? [] : state.doc.resolve(target.from).nodeAfter.marks.filter(mark => mark.type.name !== 'link')
        const text = state.schema.text(display, [...marks, link])
        tr.replaceWith(target.from, target.to, target.node ? state.schema.nodes.paragraph.create({ blockId: target.node.attrs.blockId }, text) : text)
      } else {
        let block
        try {
          const fetched = this._linkMetadata?.get(target.href)
          const meta = target.cardMeta ? JSON.parse(target.cardMeta) : fetched?.ok !== false ? fetched || {} : {}
          const snapshot = JSON.stringify({ title: meta.title || null, desc: meta.desc || null, favicon: meta.favicon || null, cover: meta.cover || null })
          block = kind === 'card'
            ? state.schema.nodes.bookmark.create({ ...meta, url: target.href, title: meta.title || null, linkTitle: target.title, blockId: target.node?.attrs.blockId || null })
            : state.schema.nodes.linkEmbed.create({ href: target.href, title: meta.title || readBookmarkHost(target.href) || target.title, view: kind, cardMeta: target.cardMeta || snapshot, blockId: target.node?.attrs.blockId || null })
          block.check()
        } catch (_) { this.error = '链接标题或地址不支持此视图'; return false }
        if (target.node) tr.replaceWith(target.from, target.to, block)
        else tr.replaceRangeWith(target.from, target.to, block)
      }
      view.dispatch(closeHistory(tr))
      if (kind === 'title') {
        this.loadLinkMetadata(target.href)
        const range = getMarkRange(view.state.doc.resolve(target.node ? target.from + 1 : target.from), state.schema.marks.link)
        if (range && this._linkMetadata?.get(target.href)?.pending) this._linkTitleRequest = { ...range, href: target.href, doc: view.state.doc }
      }
      this.closeLinkTools()
      return true
    },
    destroyLinkTools() {
      this.closeLinkTools()
      this._linkDialogTarget = null
      this._linkMetadata = null
      this._linkTitleRequest = null
      this._linkToolsUi?.destroy()
      this._linkToolsUi = null
    },
  },
}
