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
 *    历史面板是 `versionPanelOpen`、评论层是 `commentPanels.length`、另存为是
 *    `saveVersionOpen || versionNotice`（两者共用一个包裹层，关掉 Dialog 后 toast 还在，
 *    所以那一条不能跟着 `open` 一起摘）。原模板里条件为假时组件整棵不在 DOM 里，
 *    断言用 `querySelector` 找不到才是对的。
 * 2. **三个宿主分工不同**：
 *    - `outlineHost` 必须在 `.lark-doc-body` 里（`main.lark-doc-main` 之前、☰ 钮之后）。
 *      `aside` 是 `flex: 0 0 210px` + `position: sticky`，必须是那层 flex 的直接子项，
 *      所以这个宿主带 `display: contents`，自身不占一格。
 *    - `panelHost` 与编辑器根同层（`<LarkDocOverlays>` 的兄弟）：评论卡 / 历史层 /
 *      另存为都是 `position: fixed`，祖先不许有 transform / filter / 非 static 定位。
 * 3. **评论卡的 `:style` 在 SFC 里是数组**（`[commentPanelStyle(item), { height }]`，
 *    合并语义）。`src/ui/panels.js` 的 `applyStyle` 是替换语义，所以这里先合成一份对象
 *    再传，不能分两次 `applyStyle`。
 * 4. **`saveVersionDialogTitle` 只在弹窗打开时求值**。那个 computed 没有响应式依赖
 *    （时间取自 `Date.now()`），Vue 2 会把它缓存成常量。挂载时顺手读一次就会把标题
 *    冻在「页面刚打开那一刻」，第二次打开也是同一个时间点 —— 所以这里用条件求值，
 *    保持与 SFC「首次渲染才求值」一致的行为。
 */
import {
  createCommentPanel,
  createOutlinePanel,
  createSaveVersionDialog,
  createVersionPanel,
} from '../../../ui/panels'
import { applyStyle, mountNode, syncChildren } from '../../../ui/dom'
import { COVER_PANEL_ITEMS, coverImageStyle } from './coverMixin'
import { iconNode } from '../../../ui/icon'

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
    versionCanCreate() { this.refreshPanels() },
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
    versionPreviewError() { this.refreshPanels() },
    versionError() { this.refreshPanels() },
    versionLoading() { this.refreshPanels() },
    versionRestoreBusy() { this.refreshPanels() },
    versionTrashOpen() { this.refreshPanels() },
    versionTrashBusy() { this.refreshPanels() },
    versionDeletedList: { deep: true, handler() { this.refreshPanels() } },

    // —— 另存为 Dialog + toast ——
    // 打开即聚焦输入框（与原 `@focus` 的 `$nextTick` 口径一致，原生渲染是同步的）。
    saveVersionOpen(value) { this.refreshPanels(); if (value) this._panelsUi?.saveVersion.focusInput() },
    saveVersionName() { this.refreshPanels() },
    saveVersionBusy() { this.refreshPanels() },
    saveVersionError() { this.refreshPanels() },
    versionNotice() { this.refreshPanels() },

    // —— 评论：面板几何 / 草稿 / 私有开关 / 两套菜单 ——
    commentPanels: { deep: true, handler() { this.refreshPanels() } },
    commentDrafts: { deep: true, handler() { this.refreshPanels() } },
    commentPrivateIds() { this.refreshPanels() },
    commentMoreThreadId() { this.refreshPanels() },
    commentMenuThreadId() { this.refreshPanels() },
    commentMenuCommentId() { this.refreshPanels() },
  },
  methods: {
    /** 挂载四个面板（由主组件 `mounted` 调用，不依赖编辑器实例）。 */
    mountPanels() {
      if (this._panelsUi) return
      const outlineHost = this.$refs.outlineHost
      const panelHost = this.$refs.panelHost
      if (!outlineHost || !panelHost) return
      const handlers = this.panelsHandlers()
      this._panelsUi = {
        outline: createOutlinePanel({ host: outlineHost, handlers: handlers.outline }),
        version: createVersionPanel({ host: panelHost, handlers: handlers.version }),
        saveVersion: createSaveVersionDialog({ host: panelHost, handlers: handlers.saveVersion }),
        comment: createCommentPanel({ host: panelHost, handlers: handlers.comment }),
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

    /** handler 全表（键名与 `src/ui/panels.js` 里的 `call('onXxx')` 一一对应）。 */
    panelsHandlers() {
      return {
        outline: {
          onToggleOpen: () => this.toggleOutlineOpen(),
          onToggle: (pos) => this.toggleOutline(pos),
          onJump: (pos) => this.jumpHeading(pos),
        },
        version: {
          // 唯一关闭出口：`Esc` 在这条线上是「拦冒泡」而不是关闭（SFC 头负结论 1）。
          onClose: () => this.closeVersionPanel(),
          onRestore: () => this.restoreSelectedVersion(),
          onPrev: () => this.versionPrev(),
          onNext: () => this.versionNext(),
          onSelect: (id) => this.selectVersion(id),
          onOpenTrash: () => this.openVersionTrash(),
          onCloseTrash: () => this.closeVersionTrash(),
          onRestoreDeleted: (id) => this.restoreDeletedVersion(id),
          onPurgeDeleted: (id) => this.purgeDeletedVersion(id),
        },
        saveVersion: {
          onClose: () => this.closeSaveVersionDialog(),
          onInput: (value) => this.setSaveVersionName(value),
          onConfirm: () => this.confirmSaveVersion(),
          // toast 的「立即查看」：先开面板再收 toast（顺序与模板里的内联两调用一致）。
          onNoticeLink: () => { this.openVersionPanel(); this.dismissVersionNotice() },
        },
        comment: {
          onActivate: (id) => this.activateComment(id),
          onControl: (controlId, threadId) => this.runCommentControl(controlId, threadId),
          onReplyControl: (ctlId, threadId, replyId) => this.runCommentReplyControl(ctlId, threadId, replyId),
          onMenuItem: (menuId, threadId, replyId) => this.runCommentMenuItem(menuId, threadId, replyId),
          onDraft: (threadId, value) => this.setCommentDraft(threadId, value),
          onClearDraft: (threadId) => this.clearCommentDraft(threadId),
          onSubmit: (threadId) => this.submitCommentDraft(threadId),
          onTogglePrivate: (threadId) => this.toggleCommentPrivate(threadId),
        },
      }
    },

    /** 一份 state 推平（原 `<OutlinePanel :ed>` + `<VersionPanel :ed>` + … 四份绑定）。 */
    buildPanelsState() {
      return {
        outline: this.buildOutlineState(),
        version: this.buildVersionState(),
        saveVersion: this.buildSaveVersionState(),
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

    buildVersionState() {
      const error = this.versionError || ''
      const total = this.versionTotal
      const loading = !!this.versionLoading
      const selected = this.versionSelected
      const preview = this.versionPreview
      const diff = this.versionSelectedDiff
      const restoreDisabled = !!this.versionRestoreDisabled
      const prevDisabled = !!this.versionPrevDisabled
      const nextDisabled = !!this.versionNextDisabled
      return {
        open: !!this.versionPanelOpen,
        trash: {
          open: !!this.versionTrashOpen,
          busy: !!this.versionTrashBusy,
          canManage: !!this.versionCanManageTrash,
          reason: this.versionTrashReason,
          items: (this.versionDeletedList || []).map(item => ({
            id: item.id,
            name: this.versionItemName(item),
            label: item.label,
          })),
        },
        restore: {
          disabled: restoreDisabled,
          // `:title="ed.versionCanRestoreReason"` —— 允许时是空串（属性在、值为空）。
          title: this.versionCanRestoreReason,
          style: this.versionDisabledStyle(restoreDisabled),
        },
        pager: {
          cursor: this.versionCursorLabel,
          prev: { disabled: prevDisabled, style: this.versionDisabledStyle(prevDisabled) },
          next: { disabled: nextDisabled, style: this.versionDisabledStyle(nextDisabled) },
        },
        // 左栏三选一：错误 > 空态 > 预览（`v-if` / `v-else-if` / `v-else` 的顺序）。
        view: error ? 'error' : (total ? 'preview' : 'empty'),
        errorText: error,
        emptyText: loading ? '正在载入历史记录…' : '暂无历史版本',
        preview: total ? this.buildVersionPreviewState(selected, preview, diff) : null,
        // 右栏时间线：错误时只留一条降级文案（`v-else` 挂在 for 上）。
        timelineError: error,
        days: error ? [] : (this.versionDayGroups || []).map((group) => ({
          key: group.key,
          label: group.label,
          items: (group.items || []).map((item) => ({
            id: item.id,
            cls: this.versionTimelineClass(item).selected ? 'selected' : '',
            name: this.versionItemName(item),
            desc: this.versionItemDesc(item),
            user: this.versionActorLabel(item),
          })),
        })),
      }
    },

    /** 左栏预览：meta 是「前两项恒在 + 后两项随载荷」的前缀序列，这里直接拼成一个数组。 */
    buildVersionPreviewState(selected, preview, diff) {
      const meta = [this.versionItemName(selected), this.versionActorLabel(selected)]
      if (preview) meta.push(`二进制快照 ${preview.byteLength} 字节`)
      if (preview && Number.isInteger(preview.blockCount)) meta.push(`${preview.blockCount} 个块`)
      let row = ''
      if (diff && diff.blockCount) {
        const { prev, next, delta } = diff.blockCount
        row = `块数 ${prev} → ${next} （${delta >= 0 ? '+' : ''}${delta}）`
      }
      return {
        title: (preview && preview.label) || '未命名版本',
        kind: this.versionKindLabel(selected && selected.kind),
        meta,
        degraded: this.versionPreviewError || '',
        diff: diff ? { row } : null,
        // 有载荷才给文案；空串 = 走「该版本没有可取回的正文」那条兜底。
        payload: preview && preview.hasPayload
          ? `该版本正文为二进制快照（${preview.byteLength} 字节），需由协同运行时解码后才能渲染。`
          : '',
      }
    },

    buildSaveVersionState() {
      // `:disabled="!versionCanCreate || saveVersionBusy"` —— 两处都要用这一份布尔。
      const disabled = !this.versionCanCreate || !!this.saveVersionBusy
      return {
        open: !!this.saveVersionOpen,
        notice: this.versionNotice || '',
        // 标题带时间戳且 computed 无响应式依赖：只在打开时求值，别在挂载时就冻住。
        title: this.saveVersionOpen ? this.saveVersionDialogTitle : '',
        value: this.saveVersionName || '',
        maxLength: this.versionNameMax,
        counter: this.versionNameCounter,
        confirm: {
          disabled,
          title: this.versionCanCreateReason,
          style: this.versionDisabledStyle(disabled),
        },
        error: this.saveVersionError || '',
      }
    },

    buildCommentState() {
      const panels = this.commentPanels || []
      const controls = this.commentControls || []
      const menus = this.commentMenuItems || []
      const allowedReply = this.commentAllowed('reply')
      return {
        open: panels.length > 0,
        title: this.commentPanelTitle,
        controls,
        replyControls: this.commentReplyControls || [],
        moreTitle: this.commentPrivateTitle,
        moreHint: this.commentPrivateHint,
        items: panels.map((item) => ({
          id: item.id,
          // 一次合成（SFC 是数组合并语义，`applyStyle` 是替换语义）。
          style: {
            ...this.commentPanelStyle(item),
            height: `${this.commentPanelHeightOf(item)}px`,
          },
          quote: this.commentQuoteOf(item),
          // 置灰而不是隐藏：无权限的按钮照挂，加 `is-disabled`。
          disabled: controls
            .filter((control) => !control.split && this.commentControlDisabled(control.id, item.id))
            .map((control) => control.id),
          replies: (item.replies || []).map((reply) => ({
            id: reply.id,
            name: this.commentAuthorName(reply.author),
            time: this.commentTimeAt(reply.createdAt),
            body: reply.content,
            menuOpen: this.commentMenuThreadId === item.id && this.commentMenuCommentId === reply.id,
            menus: menus.map((menu) => ({
              id: menu.id,
              label: menu.label,
              submenu: !!menu.submenu,
              visible: this.commentMenuVisible(menu, reply),
            })),
          })),
          textarea: {
            value: this.commentDraftOf(item.id),
            readonly: !allowedReply,
            height: this.commentTextareaHeight(item),
          },
          hasDraft: this.commentHasDraft(item.id),
          allowedReply,
          moreOpen: this.commentMoreThreadId === item.id,
          privateOn: this.commentPrivate(item.id),
        })),
      }
    },

    refreshPanels() {
      this.refreshCover()
      const ui = this._panelsUi
      if (!ui) return
      const state = this.buildPanelsState()
      ui.outline.update(state.outline)
      ui.version.update(state.version)
      ui.saveVersion.update(state.saveVersion)
      ui.comment.update(state.comment)
    },
  },
}
