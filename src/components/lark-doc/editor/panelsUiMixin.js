/**
 * panelsUiMixin — 面板 / 宿主弹窗原生化接线层（阶段 5 批次 4b）。
 *
 * 与 `dialogsUiMixin` 同一套范式：DOM 由 `src/ui/panels.js`（纯 DOM、零框架）创建，
 * 本 mixin 只做「把状态算成一份 state → 推给 UI」。四个面板的开合/翻页/还原/落库逻辑
 * 一行没动，全留在 `viewModesMixin` / `versioningMixin` / `commentsMixin` 里。
 *
 * 四条必须守住的线：
 *
 * 1. **`open` 就是原 `v-if` 的那个条件**。目录是 `outlineOpen && featureEnabled('outline')`、
 *    历史面板是 `versionPanelOpen`、评论层是 `commentPanels.length`。原模板里条件为假时
 *    组件整棵不在 DOM 里，断言用 `querySelector` 找不到才是对的。
 * 2. **三个宿主分工不同**：
 *    - `outlineHost` 必须在 `.lark-doc-body` 里（`main.lark-doc-main` 之前、☰ 钮之后）。
 *      `aside` 是 `flex: 0 0 210px` + `position: sticky`，必须是那层 flex 的直接子项，
 *      所以这个宿主带 `display: contents`，自身不占一格。
 *    - `panelHost` 与编辑器根同层（`<LarkDocOverlays>` 的兄弟）：评论卡 / 历史层都是
 *      `position: fixed`，祖先不许有 transform / filter / 非 static 定位。
 * 3. **评论卡的 `:style` 在 SFC 里是数组**（`[commentPanelStyle(item), { height }]`，
 *    合并语义）。`src/ui/panels.js` 的 `applyStyle` 是替换语义，所以这里先合成一份对象
 *    再传，不能分两次 `applyStyle`。
 */
import {
  createCommentPanel,
  createOutlinePanel,
  createVersionPanel,
  createVersionToast,
} from '../../../ui/panels'
import { applyStyle, mountNode, syncChildren } from '../../../ui/dom'
import { COVER_PANEL_ITEMS, coverImageStyle } from './coverMixin'
import { iconNode } from '../../../ui/icon'
import { panelPresentation } from './commentPanelView'
import { createCommentComposer } from '../../../ui/commentComposer'


export default {
  watch: {
    // —— 目录：开合 / 条目 / 折叠集 / 水合闸门 / 当前高亮 ——
    outlineOpen() { this.refreshPanels() },
    outline() { this.refreshPanels() },
    outlineCollapsed() { this.refreshPanels() },
    outlinePending() { this.refreshPanels() },
    activeHeading() { this.refreshPanels() },
    session() { this.refreshPanels() },
    effectiveReadonly() { this.refreshPanels() },
    versionRestoreDisabled() { this.refreshPanels() },
    versionCanManageTrash() { this.refreshPanels() },
    canCommentNow() { this.refreshPanels() },
    coverValue() { this.refreshCover() },
    coverPanelOpen() { this.refreshCover() },
    coverStage() { this.refreshCover() },
    coverTab() { this.refreshCover() },
    coverRepositioning() { this.refreshCover() },
    coverDraftOffset() { this.refreshCover() },
    coverPanelStyleValue: { deep: true, handler() { this.refreshCover() } },

    // —— 历史记录：列表 / 游标 / 选中 / 预览 / 三种降级态 ——
    versionPanelOpen() { this.refreshPanels() },
    versionList: { deep: true, handler() { this.refreshPanels() } },
    versionIndex() { this.refreshPanels() },
    versionSelectedId() { this.refreshPanels() },
    versionPreview: { deep: true, handler() { this.refreshPanels() } },
    versionChanges: { deep: true, handler() { this.refreshPanels() } },
    versionChangeIndex() { this.refreshPanels() },
    versionChangesLoading() { this.refreshPanels() },
    versionChangesError() { this.refreshPanels() },
    versionPreviewError() { this.refreshPanels() },
    versionRestoreConfirmOpen() { this.refreshPanels() },
    versionRestoreTargetId() { this.refreshPanels() },
    larkDocConfig() { this.refreshPanels() },
    versionError() { this.refreshPanels() },
    versionLoading() { this.refreshPanels() },
    versionRestoreBusy() { this.refreshPanels() },
    versionTrashOpen() { this.refreshPanels() },
    versionTrashBusy() { this.refreshPanels() },
    versionDeletedList: { deep: true, handler() { this.refreshPanels() } },

    // —— 版本成功提示 toast ——
    versionNotice() { this.refreshPanels() },

    // —— 评论：面板几何 / 草稿 / 私有开关 / 两套菜单 ——
    commentPanels: { deep: true, handler() { this.refreshPanels() } },
    commentDrafts: { deep: true, handler() { this.refreshPanels() } },
    commentSidebarOpen() { this.refreshPanels() },
    commentMobileScope() { this.refreshPanels() },
    commentMobileOpen() { this.refreshPanels() },
    commentActiveThreadId() { this.refreshPanels() },
    commentIdentityGeneration() { this.refreshPanels() },
    commentDocumentLike: { deep: true, handler() { this.refreshPanels() } },
    commentComposerOpen() { this.refreshPanels() },
    commentComposerContext: { deep: true, handler() { this.refreshPanels() } },
    commentCreateDraft() { this.refreshPanels() },
    commentCreatePrivate() { this.refreshPanels() },
    commentHistory() { this.refreshPanels() },
    commentHistorical() { this.refreshPanels() },
    commentMessage() { this.refreshPanels() },
    commentImageDrafts: { deep: true, handler() { this.refreshPanels() } },
    commentImageUrls: { deep: true, handler() { this.refreshPanels() } },
    commentImageErrors: { deep: true, handler() { this.refreshPanels() } },
    commentImageViewer() { this.refreshPanels() },
    commentImageBusy() { this.refreshPanels() },
    commentPendingImage() { this.refreshPanels() },
    commentPrivateIds() { this.refreshPanels() },
    commentMoreThreadId() { this.refreshPanels() },
    commentMenuThreadId() { this.refreshPanels() },
    commentMenuCommentId() { this.refreshPanels() },
    commentReactionContext: { deep: true, handler() { this.refreshPanels() } },
    commentReactionQuery() { this.refreshPanels() },
    commentReactionCategory() { this.refreshPanels() },
    commentReactionLimit() { this.refreshPanels() },
    commentEditingReply: { deep: true, handler() { this.refreshPanels() } },
    commentEditContent() { this.refreshPanels() },
    commentEditMentions: { deep: true, handler() { this.refreshPanels() } },
    commentEditReferences: { deep: true, handler() { this.refreshPanels() } },
    commentMentionPicker: { deep: true, handler() { this.refreshPanels() } },
    commentTranslationContext: { deep: true, handler() { this.refreshPanels() } },
    commentTranslationLanguage() { this.refreshPanels() },
    commentTranslationState: { deep: true, handler() { this.refreshPanels() } },
    commentTranslationBusy() { this.refreshPanels() },
    commentPendingTranslationOperation() { this.refreshPanels() },
    commentDocumentDraft() { this.refreshPanels() },
    commentDocumentMentions: { deep: true, handler() { this.refreshPanels() } },
    commentDocumentReferences: { deep: true, handler() { this.refreshPanels() } },
    commentDocumentReplyTarget: { deep: true, handler() { this.refreshPanels() } },
  },
  methods: {
    ...panelPresentation.methods,

    /** 挂载四个面板（由主组件 `mounted` 调用，不依赖编辑器实例）。 */
    mountPanels() {
      if (this._panelsUi) return
      const outlineHost = this.$refs.outlineHost
      const panelHost = this.$refs.panelHost
      if (!outlineHost || !panelHost) return
      const owner = this
      let panels
      const onReady = () => {
        if (!panels || this._panelsUi !== panels || this._isDestroyed || this._isBeingDestroyed) return
        this.panelPresentationRevision = (this.panelPresentationRevision || 0) + 1
        this.refreshPanels()
        this.focusImageComment?.()
      }
      panels = this._panelsUi = {
        outline: createOutlinePanel({ host: outlineHost, handlers: {
          onToggleOpen: () => this.toggleOutlineOpen(), onToggle: pos => this.toggleOutline(pos), onJump: pos => this.jumpHeading(pos),
        } }),
        version: createVersionPanel({ host: panelHost, get handlers() { return owner.panelsHandlers().version }, onReady,
          renderDocument: (element, record) => this.mountVersionDocumentPreview(element, record) }),
        versionToast: createVersionToast({ host: panelHost, get handlers() { return owner.panelsHandlers().versionToast }, onReady }),
        comment: createCommentPanel({ host: panelHost, inlineHost: this.$refs.paper, get handlers() { return owner.panelsHandlers().comment }, composerFactory: createCommentComposer, onReady }),

      }
      this.mountCover()
      this.refreshPanels()
    },
    mountCover() {
      const paper = this.$refs.paper
      if (!paper || this._coverUi) return
      const document = paper.ownerDocument
      const element = (className, tag = 'div') => {
        const node = document.createElement(tag)
        node.className = className
        return node
      }
      const button = (label, className, action) => {
        const node = element(className, 'button')
        node.type = 'button'
        node.textContent = label
        node.setAttribute('aria-label', label)
        node.addEventListener('click', event => { if (!this.effectiveReadonly) action(event) })
        return node
      }
      const slot = element('lark-doc-cover-slot')
      const wrapper = element('lark-doc-cover-wrapper')
      const image = element('lark-doc-cover-image-wrapper')
      let drag = null
      image.addEventListener('pointerdown', event => {
        if (!this.coverRepositioning || this.effectiveReadonly) return
        drag = { y: event.clientY, offset: this.coverDraftOffset }
        image.setPointerCapture?.(event.pointerId)
      })
      image.addEventListener('pointermove', event => {
        if (drag && this.coverRepositioning && !this.effectiveReadonly) this.setCoverDraftOffset(drag.offset + (event.clientY - drag.y) * -0.2)
      })
      image.addEventListener('pointerup', () => { drag = null })
      image.addEventListener('pointercancel', () => { drag = null })
      const toolbar = element('lark-doc-cover-toolbar')
      const add = button('添加封面', 'lark-doc-cover-entry', () => this.addCover())
      const edit = button('编辑封面', 'lark-doc-cover-btn', event => this.openCoverPanel(event))
      edit.setAttribute('aria-haspopup', 'menu')
      const cancel = button('取消调整封面位置', 'lark-doc-cover-btn is-plain', () => this.cancelCoverReposition())
      const confirm = button('确认封面位置', 'lark-doc-cover-btn', () => this.confirmCoverReposition())
      cancel.textContent = '取消'
      confirm.textContent = '确认'
      wrapper.append(image, toolbar)
      paper.prepend(slot)
      const layer = element('lark-doc-cover-layer')
      const mask = element('lark-doc-cover-mask')
      mask.setAttribute('aria-hidden', 'true')
      mask.addEventListener('pointerdown', () => this.closeCoverPanel())
      const panel = element('lark-doc-cover-panel')
      panel.setAttribute('role', 'dialog')
      panel.setAttribute('aria-label', '封面')
      const menu = element('lark-doc-cover-options', 'ul')
      menu.setAttribute('role', 'menu')
      menu.setAttribute('aria-label', '封面操作')
      COVER_PANEL_ITEMS.forEach(item => {
        const entry = element('', 'li')
        entry.setAttribute('role', 'none')
        const node = button(item.label, 'lark-doc-cover-option', () => this.onCoverPanelItem(item.id))
        node.prepend(iconNode(item.icon, 20))
        node.setAttribute('role', 'menuitem')
        node.dataset.coverItem = item.id
        entry.appendChild(node)
        menu.appendChild(entry)
      })
      const gallery = element('lark-doc-cover-gallery')
      const head = element('lark-doc-cover-gallery-head')
      const store = button('官方图库', 'lark-doc-cover-tab', () => this.setCoverTab('storehouse'))
      const uploadTab = button('本地上传', 'lark-doc-cover-tab', () => this.setCoverTab('upload'))
      const tabs = element('lark-doc-cover-gallery-tabs')
      tabs.append(store, uploadTab)
      const actions = element('lark-doc-cover-gallery-head-right')
      const random = button('随机封面', 'lark-doc-cover-head-btn is-random', () => this.pickRandomCover())
      const remove = button('移除封面', 'lark-doc-cover-head-btn', () => this.removeCover())
      random.textContent = '随机'
      remove.textContent = '移除'
      actions.append(random, remove)
      head.append(tabs, actions)
      const storehouse = element('lark-doc-cover-storehouse')
      const presets = []
      this.coverThumbGroups.forEach(group => {
        const section = element('lark-doc-cover-group')
        const title = element('lark-doc-cover-group-title', 'h6')
        title.textContent = group.title
        const thumbs = element('lark-doc-cover-thumbs', 'ul')
        group.items.forEach(preset => {
          const item = element('lark-doc-cover-thumb', 'li')
          const node = button(preset.name, 'lark-doc-cover-thumb-btn', () => this.pickCover(preset.id))
          node.textContent = ''
          applyStyle(node, coverImageStyle({ preset: preset.id, offset: 50 }))
          item.appendChild(node)
          thumbs.appendChild(item)
          presets.push({ node, id: preset.id })
        })
        section.append(title, thumbs)
        storehouse.appendChild(section)
      })
      const upload = element('lark-doc-cover-upload', 'label')
      const file = element('lark-doc-cover-file', 'input')
      file.type = 'file'
      file.accept = 'image/*'
      file.setAttribute('aria-label', '上传封面图片')
      file.addEventListener('change', event => { if (!this.effectiveReadonly) this.uploadCover(event) })
      upload.append(file, document.createTextNode('点击上传本地图片'))
      const scroll = element('lark-doc-cover-gallery-scroll')
      gallery.append(head, scroll)
      layer.append(mask, panel)
      this.$refs.coverPanel = panel
      this._coverUi = { slot, wrapper, image, toolbar, add, edit, cancel, confirm, layer, panel, menu, gallery, scroll, storehouse, upload, store, uploadTab, presets }
      this.refreshCover()
    },
    refreshCover() {
      const ui = this._coverUi
      if (!ui) return
      ui.slot.classList.toggle('is-empty', !this.coverExists)
      applyStyle(ui.wrapper, this.coverSlotStyle)
      ui.image.classList.toggle('is-dragging', !!this.coverRepositioning)
      ui.edit.setAttribute('aria-expanded', String(!!this.coverPanelOpen))
      syncChildren(ui.slot, [{ node: ui.wrapper, on: !!this.coverExists }, { node: ui.add, on: !this.coverExists && !this.effectiveReadonly }])
      syncChildren(ui.toolbar, [
        { node: ui.edit, on: !this.coverRepositioning && !this.effectiveReadonly },
        { node: ui.cancel, on: !!this.coverRepositioning && !this.effectiveReadonly },
        { node: ui.confirm, on: !!this.coverRepositioning && !this.effectiveReadonly },
      ])
      const gallery = this.coverStage === 'gallery'
      ui.panel.classList.toggle('is-gallery', gallery)
      applyStyle(ui.panel, Object.fromEntries(Object.entries(this.coverPanelStyleValue || {}).map(([key, value]) => [key, typeof value === 'number' ? `${value}px` : value])))
      syncChildren(ui.panel, [{ node: ui.menu, on: !gallery }, { node: ui.gallery, on: gallery }])
      syncChildren(ui.scroll, [{ node: ui.storehouse, on: this.coverTab !== 'upload' }, { node: ui.upload, on: this.coverTab === 'upload' }])
      ui.store.classList.toggle('is-active', this.coverTab !== 'upload')
      ui.uploadTab.classList.toggle('is-active', this.coverTab === 'upload')
      ui.presets.forEach(({ node, id }) => {
        const selected = this.coverValue?.preset === id
        node.classList.toggle('is-active', selected)
        node.setAttribute('aria-pressed', String(selected))
      })
      mountNode(this.$refs.panelHost, ui.layer, !!this.coverPanelOpen && !this.effectiveReadonly)
    },
    destroyPanels() {
      const ui = this._panelsUi
      if (!ui) return
      Object.keys(ui).forEach((key) => ui[key].destroy())
      this._panelsUi = null
      if (this._coverUi) {
        this._coverUi.slot.remove()
        this._coverUi.layer.remove()
        if (this.$refs.coverPanel === this._coverUi.panel) delete this.$refs.coverPanel
        this._coverUi = null

      }
    },


    /** 一份 state 推平（原 `<OutlinePanel :ed>` + `<VersionPanel :ed>` + … 四份绑定）。 */
    buildPanelsState() {
      return {
        outline: this.buildOutlineState(),
        version: this.buildVersionState(),
        versionToast: { notice: this.versionNotice || '' },
        comment: this.buildCommentState(),
      }
    },

    buildOutlineState() {
      const items = this.outlineItems || []
      return {
        open: !!(this.outlineOpen && this.featureEnabled('outline')),
        // 空态取 `outline.length`（未折叠的原表），不是 `outlineItems` —— 两者在
        // 「全折叠」时不一致，而模板里写的是前者。
        empty: !(this.outline || []).length,
        pending: !!this.outlinePending,
        active: this.activeHeading,
        items: items.map((item) => ({
          pos: item.pos,
          text: item.text,
          level: item.level,
          hasChildren: !!item.hasChildren,
          collapsed: !!item.collapsed,
        })),
      }
    },

    // These gates run before the optional presentation is available. They retain
    // live authority, initial inline content, counters and drafts, without reads
    // or writes to a provider. The complete projection is refreshed onReady.
    buildCommentVisibility() {
      const imageScope = this.imageCommentCurrent?.() ? this._imageCommentScope : null
      const readable = this.commentCan?.('canView') === true && this.featureEnabled?.('comments') !== false
      const provider = this.commentProvider?.(), remote = this.commentRemote === true
      const panels = readable ? this.commentPanels || [] : []
      const documentThreads = readable ? this.commentDocumentThreads || [] : []
      const historical = !imageScope && this.commentHistorical === true
      const sidebarOpen = readable && (!!imageScope || (remote || this._mobileEditorMedia?.matches
        ? this.commentSidebarOpen === true : panels.length > 0 || this.commentComposerOpen === true))
      const documentInline = !imageScope && readable && !historical && (remote || !!provider)
      const canSubmit = readable && this.commentDocumentCanSubmit?.() !== false && this.commentAllowed?.('create') !== false
      const root = this.$refs?.root, bounds = root?.getBoundingClientRect(), win = root?.ownerDocument.defaultView
      const header = root?.querySelector('.lark-doc-topbar'), rect = header?.getBoundingClientRect(), style = header && win?.getComputedStyle?.(header)
      const visibleHeader = header && !header.hidden && rect?.height > 0 && style?.display !== 'none' && style?.visibility !== 'hidden'
      return {
        open: sidebarOpen, remote, historical, sidebarOpen, documentInline,
        viewerHost: imageScope?.viewer || null, viewerCurrent: imageScope ? () => this.imageCommentCurrent(imageScope) : null,
        identityGeneration: this.commentIdentityGeneration || 0,
        mobileScope: historical || this.commentComposerOpen ? 'selection' : this.commentMobileScope || 'document',
        mobileOpen: readable && (remote ? sidebarOpen : !!(this.commentMobileOpen || this.commentComposerOpen)),
        documentCount: documentThreads.length,
        selectionCount: readable ? (Number.isFinite(Number(this.commentSelectionCount)) ? Number(this.commentSelectionCount) : panels.length) : 0,
        unread: readable ? Number(this.commentUnread) || 0 : 0,
        launcher: { visible: !imageScope && readable && !!this._mobileEditorMedia?.matches && !!provider,
          top: Math.max(0, visibleHeader ? rect.bottom : bounds?.top || 0),
          right: Math.max(0, (win?.innerWidth || 0) - (bounds?.right || win?.innerWidth || 0)) },
        like: readable ? { ...this.commentDocumentLike, available: !!provider && this.session?.getProvider?.('authorization')?.isRemote === true
          && typeof this.session?.getProvider?.('authorization')?.documentInformation === 'function' } : { available: false, snapshot: null, pending: '' },
        documentComposer: { open: readable && !historical && (sidebarOpen || documentInline) && !this.commentComposerOpen,
          value: readable ? this.commentDocumentDraft || '' : '',
          mentions: readable ? this.commentDocumentMentions || [] : [], references: readable ? this.commentDocumentReferences || [] : [],
          replyTarget: readable ? this.commentDocumentReplyTarget || null : null, readonly: !canSubmit, canSubmit,
          privateOn: this.commentCreatePrivate === true },
        composer: { open: readable && this.commentComposerOpen === true,
          value: readable ? this.commentCreateDraft || '' : '', quote: readable ? this.commentComposerContext?.text || '' : '' },
        items: [],
      }
    },
    buildVersionVisibility() {
      const contextKey = JSON.stringify([this.session?.documentId, this.session?._versioningProviderGeneration, this.session?._authorizationGeneration, this.session?._privateIdentityGeneration])
      const readable = !this.session?.can || this.session.can('canView')
      const current = !this.versionPreview?.readScope || this.versionPreview.readScope === contextKey
      return { open: !!this.versionPanelOpen && readable && current, kind: this.versionPanelKind,
        contextKey, previewPolicyKey: JSON.stringify(this.larkDocConfig?.network || {}),
        restoreConfirm: { open: false }, trash: { open: false }, days: [], preview: null }
    },

    refreshPanels() {
      if (this._imageCommentScope && !this.imageCommentCurrent()) { this.closeImageComments(null, false); return }
      this.refreshCover()
      const ui = this._panelsUi
      if (!ui) return
      const state = this.buildPanelsState()
      ui.outline.update(state.outline)
      ui.version.update(state.version)
      ui.versionToast.update(state.versionToast)
      const scope = this._imageCommentScope
      if (scope) {
        ui.comment.update({ open: false, documentInline: false, launcher: { visible: false }, composer: { open: false }, documentComposer: { open: false } })
        if (!scope.ui) {
          const owner = this
          scope.ui = createCommentPanel({ host: scope.viewer || this.$refs.panelHost,
            get handlers() { return owner.panelsHandlers().comment }, composerFactory: createCommentComposer,
            onReady: () => {
              if (this._imageCommentScope !== scope || !this.imageCommentCurrent(scope)) return
              this.panelPresentationRevision = (this.panelPresentationRevision || 0) + 1
              this.refreshPanels(); this.focusImageComment()
            },
          })
        }
        scope.ui.update(state.comment)
      } else ui.comment.update(state.comment)
    },
  },
}
