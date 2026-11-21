/**
 * blockMenuMixin — 区块菜单（类型/对齐/颜色子菜单）的开合、定位、悬停/焦点关闭调度与菜单动作。
 * 通过 this.editor、this.writable()、this.featureEnabled()、this.savedSelection 与主组件协作；
 * 依赖 blockHandleMixin 的 handleActionRange/setHandleHighlight/refreshHandleHighlight（this 上合并可见）。
 * 采用 mixin 而非子组件：菜单 DOM 挂在主模板的句柄内，依赖 Vue 2 选项合并语义，拆子组件会破坏定位逻辑。
 */
import { closeHistory } from '@tiptap/pm/history'
import { TextSelection } from '@tiptap/pm/state'
import { BLOCK_ID_PATTERN, clampBlockIndent, maxIndentAt, moveBlockRange, nodeAtSafe, safeUrl, stepBlockIndent } from '../documentOperations'
import { isBlockActionEnabled } from '../larkDocConfig'
import { normalizeAIProvider } from '../ai'
import { aiNetworkAllows, createNetworkPolicy } from '../../../core/policy/network'
import { wrapContainerAllowed } from '../../../core/blocks/container-depth'
import { loadFeature, readFeature } from '../../../core/features/registry'

import { blockActions, blockTypeActions } from './constants'
import { createBlockInteraction } from './blockInteraction'
import { copyBlock as copyBlockContent } from '../../../utils/contentClipboard'

export function blockAiAllowed(ed) {
  if (!ed.editor || ed.editor.isDestroyed || ed._isBeingDestroyed || ed._isDestroyed || !ed.writable() ||
    !ed.featureEnabled('ai') || ed.featureEnabled('blockHandle') === false) return false
  const adapter = normalizeAIProvider(ed.aiProvider)
  const root = ed.$refs?.root || ed.$el
  return !!(adapter && (adapter.kind !== 'endpoint' || aiNetworkAllows(adapter.endpoint || adapter.baseURL,
    createNetworkPolicy(ed.larkDocConfig?.network), root?.ownerDocument?.defaultView?.location?.href)))
}

const blockInteraction = createBlockInteraction({ closeHistory, isBlockActionEnabled, nodeAtSafe, wrapContainerAllowed, TextSelection, blockAiAllowed, moveBlockRange, BLOCK_ID_PATTERN, safeUrl, stepBlockIndent })

export default {
  data() { return {
    blockMenuOpen: false, blockTypeMenuOpen: false, blockAlignMenuOpen: false, blockColorMenuOpen: false,
    blockMenuStyle: {}, blockAlignMenuStyle: {}, blockColorMenuStyle: {}, blockMenuCloseTimer: null, blockMenuHovering: false,
    blockActions, blockTypeActions,
  } },
  watch: {
    onSaveTemplate(value) { if (this._templateSaveRequest?.callback !== value) this.closeBlockTemplateSave(); this.refreshBlockMenu() },
    effectiveReadonly() { if (!this.templateSaveAllowed()) this.closeBlockTemplateSave() },
    larkDocConfig: { deep: true, handler() { if (!this.templateSaveAllowed()) this.closeBlockTemplateSave() } },
    session(value) { if (this._templateSaveRequest?.session !== value) this.closeBlockTemplateSave() },
    documentId(value) { if (this._templateSaveRequest?.documentId !== value) this.closeBlockTemplateSave() },
  },
  beforeDestroy() { this.closeBlockTemplateSave() },
  methods: {
    ...blockInteraction.methods,
    templateSaveAllowed() {
      return this.writable() && this.featureEnabled('templates') && isBlockActionEnabled(this.larkDocConfig, 'saveTemplate')
        && this.shareCan('canView') && this.shareCan('canExport') && typeof this.onSaveTemplate === 'function'
    },
    closeBlockTemplateSave() {
      const request = this._templateSaveRequest, dialog = this._templateSaveDialog
      this._templateSaveRequest = null
      this._templateSaveDialog = null
      request?.stopPending?.()
      dialog?.destroy()
    },
    openBlockTemplateSave(range) {
      if (!this.templateSaveAllowed() || !range) return false
      this.closeBlockTemplateSave()
      const editor = this.editor, doc = editor.state.doc, session = this.session, documentId = session?.documentId, callback = this.onSaveTemplate
      const request = { callback, session, documentId: this.documentId }
      const actorId = session?.user?.id, identityGeneration = session?._identityGeneration
      const privateIdentityGeneration = session?._privateIdentityGeneration, authorizationGeneration = session?._authorizationGeneration
      this._templateSaveRequest = request
      const current = () => this._templateSaveRequest === request && this.templateSaveAllowed()
        && this.editor === editor && !editor.isDestroyed && editor.state.doc === doc && this.session === session && session?.documentId === documentId
        && this.documentId === request.documentId && this.onSaveTemplate === callback && session?.user?.id === actorId
        && session?._identityGeneration === identityGeneration && session?._privateIdentityGeneration === privateIdentityGeneration
        && session?._authorizationGeneration === authorizationGeneration
      const root = this.$refs?.root || this.$el || editor.view.dom
      const cancelPending = event => {
        if (this._templateSaveRequest !== request || !['Escape', 'Esc'].includes(event.key)) return
        if (editor.isDestroyed) { this.closeBlockTemplateSave(); return }
        if (event.isComposing || event.keyCode === 229 || editor.composing || editor.view.composing) return
        const owner = root.closest?.('.lark-doc'), targetOwner = event.target?.closest?.('.lark-doc')
        if (targetOwner && targetOwner !== owner) return
        this.closeBlockTemplateSave()
      }
      const retirePending = () => {
        if (this._templateSaveRequest === request && !current()) this.closeBlockTemplateSave()
      }
      request.stopPending = () => {
        root.removeEventListener('keydown', cancelPending, true)
        editor.off?.('transaction', retirePending)
      }
      root.addEventListener('keydown', cancelPending, true)
      editor.on?.('transaction', retirePending)
      const ready = readFeature('ui.ready')
      const loadUi = ready?.createBlockHandleMenus ? Promise.resolve(ready) : loadFeature('ui', () => import('../../../features/ui').then(module => module.uiApi))
      loadUi.then(api => {
        if (!current()) return
        // 面板包已拆成两支，这里只校验随 A 包必然下发的工厂——拿 B 包的工厂
        // 当版本探针会把「对方包还没加载」误报成「特性包版本不匹配」。
        if (!api?.createBlockHandleMenus) throw new Error('UI特性版本不匹配，请先加载同目录ui特性包')
        return import('../../../editor/templateSave').then(({ openTemplateSave }) => {
          if (!current()) return
          request.stopPending()
          const dialog = openTemplateSave({ host: this, range, isCurrent: current })
          if (current()) this._templateSaveDialog = dialog
          else dialog?.destroy()
        })
      }).catch(error => { if (current()) { this.error = error?.message || '模板保存界面无法打开，请重试'; this.closeBlockTemplateSave() } })
        .finally(() => { request.stopPending(); if (this._templateSaveRequest === request && !current()) this.closeBlockTemplateSave() })
      return true
    },
    blockTextblockTarget(range) {
      if (!range || !this.editor) return null
      const doc = this.editor.state.doc
      const probe = Math.min(doc.content.size, Math.max(0, range.from + 1))
      const $pos = doc.resolve(probe)
      for (let depth = $pos.depth; depth > 0; depth -= 1) {
        const node = $pos.node(depth)
        if (node.type.name === 'paragraph' || node.type.name === 'heading') return { node, pos: $pos.before(depth) }
      }
      const node = nodeAtSafe(this.editor?.state?.doc, range?.from)
      return node && (node.type.name === 'paragraph' || node.type.name === 'heading') ? { node, pos: range.from } : null
    },
    /**
     * 缩进目标：只要节点带 indent 属性就能整块缩进——文本块在前，
     * 代码块（飞书可整体缩进的盒子）在后。文本对齐仍只作用于文本块。
     */
    blockIndentTarget(range) {
      const text = this.blockTextblockTarget(range)
      if (text) return text
      if (!range || !this.editor) return null
      const doc = this.editor.state.doc
      const node = nodeAtSafe(doc, range.from)
      if (node && Number.isInteger(node.attrs?.indent)) return { node, pos: range.from }
      // 容器（列表项等）自己没有 indent：优先用光标所在的那个块；
      // 光标不在范围内时取范围内最后一个带 indent 的块（例如 item 里的代码块）。
      // 这样「列表项里放一个代码块」也能单独缩它，而不是整个菜单都灰掉。
      const { selection } = this.editor.state
      if (selection.from >= range.from && selection.to <= range.to) {
        const $from = selection.$from
        for (let depth = $from.depth; depth > 0; depth -= 1) {
          if (Number.isInteger($from.node(depth).attrs?.indent)) return { node: $from.node(depth), pos: $from.before(depth) }
        }
      }
      let found = null
      doc.nodesBetween(range.from, Math.min(range.to, doc.content.size), (child, pos) => {
        if (!Number.isInteger(child.attrs?.indent)) return true
        found = { node: child, pos }
        return false
      })
      return found
    },
    applyBlockAttribute(target, name, value) {
      if (!this.writable() || !target?.node || value === null || value === undefined) return false
      const attrs = { ...target.node.attrs, [name]: name === 'indent' ? clampBlockIndent(value, this.maxBlockIndent) : value }
      const tr = this.editor.state.tr.setNodeMarkup(target.pos, target.node.type, attrs)
      if (!tr.docChanged) return false
      this.editor.view.dispatch(tr)
      this.editor.view.focus()
      this.$nextTick(() => this.positionBlockHandle(this.handleRange || this.currentBlockRange()))
      return true
    },
    blockAlignNode() {
      const range = this.handleActionRange()
      return this.blockTextblockTarget(range)?.node || null
    },
    blockAlignValue() { return this.blockAlignNode()?.attrs?.textAlign || 'left' },
    blockAlignIndent() { return Number(this.blockIndentTarget(this.handleActionRange())?.node?.attrs?.indent) || 0 },
    // 增加缩进的上限由「前一个块」决定：缩进 = 成为上一个块的子块，
    // 所以父容器里第一个块一级都缩不了（真飞书菜单项同样置灰）。
    blockAlignIndentLimit() {
      const target = this.blockIndentTarget(this.handleActionRange())
      if (!target || !this.editor) return 0
      return maxIndentAt(this.editor.state.doc, target.pos, this.maxBlockIndent)
    },
    blockAlignCanIncrease() { return this.blockAlignIndent() < this.blockAlignIndentLimit() },
    clearBlockMenuCloseTimer() {
      clearTimeout(this.blockMenuCloseTimer)
      this.blockMenuCloseTimer = null
    },
    blockMenuHasFocus() {
      const active = typeof document !== 'undefined' ? document.activeElement : null
      const handle = this.$refs.root?.querySelector('.lark-doc-block-handle')
      return Boolean(active && handle?.contains(active))
    },
    closeBlockMenu() {
      this.clearBlockMenuCloseTimer()
      this.blockMenuHovering = false
      this.blockMenuOpen = false
      this.blockTypeMenuOpen = false
      this.blockAlignMenuOpen = false
      this.blockColorMenuOpen = false
      this.blockAlignMenuStyle = {}
      this.blockColorMenuStyle = {}
      this.refreshHandleHighlight()
    },
    scheduleBlockMenuClose() {
      this.clearBlockMenuCloseTimer()
      this.blockMenuCloseTimer = setTimeout(() => {
        this.blockMenuCloseTimer = null
        if (this.handleHovering || this.blockMenuHovering || this.handlePressed || this.dragging || this.blockMenuHasFocus()) return
        this.closeBlockMenu()
      }, 180)
    },
    onBlockHandleEnter() {
      this.clearBlockMenuCloseTimer()
      this.handleHovering = true
      this.refreshHandleHighlight()
    },
    onBlockHandleLeave(event) {
      if (event?.relatedTarget?.closest?.('.lark-doc-block-menu')) return
      // 表格开关会让表格重渲染，浏览器对着句柄派生一次假 mouseleave（鼠标其实没动）：
      // 短窗口内忽略，等真离开时再正常调度关闭。
      if (this._keepMenuThroughRender) { this.handleHovering = true; return }
      this.handleHovering = false
      if (this.blockMenuOpen && !this.handlePressed) this.scheduleBlockMenuClose()
      this.refreshHandleHighlight()
    },
    onBlockMenuEnter() {
      this.clearBlockMenuCloseTimer()
      this.blockMenuHovering = true
      this.refreshHandleHighlight()
    },
    onBlockMenuLeave(event) {
      if (event?.relatedTarget?.closest?.('.lark-doc-block-handle')) return
      this.blockMenuHovering = false
      if (this.blockMenuOpen && !this.handlePressed) this.scheduleBlockMenuClose()
      this.refreshHandleHighlight()
    },
    onBlockMenuFocusIn() {
      this.clearBlockMenuCloseTimer()
      this.refreshHandleHighlight()
    },
    onBlockMenuFocusOut(event) {
      if (event.relatedTarget && this.$refs.root?.querySelector('.lark-doc-block-handle')?.contains(event.relatedTarget)) return
      if (this.blockMenuOpen && !this.handlePressed) this.scheduleBlockMenuClose()
    },
    positionBlockMenu(selector) {
      this.$nextTick(() => {
        const handle = this.$refs.root?.querySelector('.lark-doc-block-handle')
        const menu = handle?.querySelector(selector)
        if (!handle || !menu) return
        const handleRect = handle.getBoundingClientRect()
        const menuRect = menu.getBoundingClientRect()
        const content = this.$refs.root?.querySelector('.lark-doc-editor-content, .ProseMirror')
        const contentRect = content?.getBoundingClientRect?.() || handleRect
        const otherRect = this.$refs.root?.querySelector('.lark-doc-block-handle-secondary')?.getBoundingClientRect()
        const viewportGap = 8
        const headerRect = this.$refs.root?.querySelector('.lark-doc-topbar')?.getBoundingClientRect()
        const viewportTop = Math.max(viewportGap, headerRect?.height > 0 ? headerRect.bottom + viewportGap : viewportGap)
        const menuWidth = menuRect.width || 230
        const maxViewportLeft = Math.max(viewportGap, window.innerWidth - menuWidth - viewportGap)
        const preferredViewportLeft = (otherRect ? Math.min(contentRect.left, handleRect.left, otherRect.left) : contentRect.left) - menuWidth - viewportGap
        const menuViewportLeft = preferredViewportLeft >= viewportGap && preferredViewportLeft <= maxViewportLeft
          ? preferredViewportLeft
          : Math.min(Math.max(viewportGap, Math.max(handleRect.right, otherRect?.right || handleRect.right) + viewportGap), maxViewportLeft)
        const top = handleRect.top
        const below = Math.max(0, window.innerHeight - top - 40)
        const above = Math.max(0, top - viewportGap - viewportTop)
        const useAbove = below < menu.scrollHeight && above > below
        const available = Math.max(32, useAbove ? above : below)
        this.blockMenuStyle = {
          left: `${Math.round(menuViewportLeft - handleRect.left)}px`,
          top: useAbove ? `${-Math.min(menu.scrollHeight, available) - 8}px` : '32px',
          maxHeight: `${available}px`,
        }
      })
    },
    openBlockMenuOnHover() {
      if (!this.writable() || this.handleIsEmptyParagraph) return
      this.handleHovering = true
      this.openBlockMenu()
    },
    toggleBlockTypeMenu() { this.openBlockMenu() },
    openBlockMenu() {
      if (!this.writable() || this.featureEnabled?.('blockHandle') === false || !this.handleRange) return
      const mobile = typeof window !== 'undefined' && window.innerWidth <= 760
      if (!mobile && this.handleIsEmptyParagraph) return

      this.clearBlockMenuCloseTimer()
      this.blockMenuOpen = true
      this.setHandleHighlight(true)
      this.blockTypeMenuOpen = false
      this.blockAlignMenuOpen = false
      this.blockColorMenuOpen = false
      this.blockAlignMenuStyle = {}
      this.blockColorMenuStyle = {}
      this.blockMenuStyle = {}
      this.positionBlockMenu('.lark-doc-block-menu')
    },
    toggleBlockMenu() { this.openBlockMenu() },
    openBlockAlignMenuOnHover() {
      if (!this.blockMenuOpen || !this.writable() || this.blockAlignMenuOpen) return
      this.blockAlignMenuOpen = true
      this.blockColorMenuOpen = false
      this.blockAlignMenuStyle = {}
      this.blockColorMenuStyle = {}
      this.$nextTick(() => this.positionBlockAlignMenu())
    },
    openBlockColorMenuOnHover() {
      if (!this.blockMenuOpen || !this.writable() || this.blockColorMenuOpen) return
      this.blockAlignMenuOpen = false
      this.blockColorMenuOpen = true
      this.blockAlignMenuStyle = {}
      this.blockColorMenuStyle = {}
      this.$nextTick(() => this.positionBlockColorMenu())
    },
    positionBlockAlignMenu() {
      if (!this.blockAlignMenuOpen) return
      const root = this.$refs.root
      const trigger = root?.querySelector('.lark-doc-block-submenu-trigger')
      const submenu = root?.querySelector('.lark-doc-block-submenu')
      if (!trigger || !submenu) return
      const margin = 8
      const gap = 5
      const triggerRect = trigger.getBoundingClientRect()
      const submenuRect = submenu.getBoundingClientRect()
      const right = triggerRect.right + gap
      const left = right + submenuRect.width + margin <= window.innerWidth
        ? right
        : Math.max(margin, triggerRect.left - submenuRect.width - gap)
      const top = Math.max(margin, Math.min(window.innerHeight - submenuRect.height - margin, triggerRect.top))
      this.blockAlignMenuStyle = { left: `${Math.round(left)}px`, top: `${Math.round(top)}px` }
    },
    positionBlockColorMenu() {
      if (!this.blockColorMenuOpen) return
      const root = this.$refs.root
      const trigger = [...(root?.querySelectorAll('.lark-doc-block-submenu-trigger') || [])].find((element) => element.getAttribute('title') === '颜色')
      const submenu = root?.querySelector('.lark-doc-block-color-submenu')
      if (!trigger || !submenu) return
      const margin = 8
      const gap = 5
      const triggerRect = trigger.getBoundingClientRect()
      const submenuRect = submenu.getBoundingClientRect()
      const right = triggerRect.right + gap
      const left = right + submenuRect.width + margin <= window.innerWidth ? right : Math.max(margin, triggerRect.left - submenuRect.width - gap)
      const top = Math.max(margin, Math.min(window.innerHeight - submenuRect.height - margin, triggerRect.top))
      this.blockColorMenuStyle = { left: `${Math.round(left)}px`, top: `${Math.round(top)}px` }
    },
    blockTypeTextRange(range) {
      const doc = this.editor?.state.doc, node = nodeAtSafe(doc, range?.from)
      if (!node || !['paragraph', 'heading', 'listItem', 'taskItem', 'bulletList', 'orderedList', 'taskList', 'blockquote', 'codeBlock', 'callout'].includes(node.type.name)) return null
      if (!Number.isInteger(range.to) || range.to > doc.content.size) return null
      // Seek the two text edges instead of scanning a potentially large container.
      const selection = TextSelection.between(doc.resolve(range.from), doc.resolve(range.to))
      return selection.from >= range.from && selection.to <= range.to ? { from: selection.from, to: selection.to } : null
    },
    blockTypeActive(id) {
      if (!this.editor || !this.handleRange) return false
      const node = nodeAtSafe(this.editor?.state?.doc, this.handleRange?.from)
      if (!node) return false
      const type = ['taskItem', 'listItem'].includes(node.type.name) ? this.editor.state.doc.resolve(this.handleRange.from).parent.type.name : node.type.name
      if (id === 'paragraph') return node.type.name === 'paragraph'
      if (/^heading[1-9]$/.test(id)) return node.type.name === 'heading' && Number(node.attrs?.level) === Number(id.slice(-1))
      // heading 上的「有序列表」代表标题编号是否开启
      if (id === 'orderedList') return type === 'orderedList' || (node.type.name === 'heading' && node.attrs?.numbering === true)
      return type === id
    },
    // —— 表格句柄菜单（对齐飞书：标题行/标题列开关 + 均分列宽）——
    handleTableNode() {
      if (!this.editor || !this.handleRange) return null
      const node = nodeAtSafe(this.editor.state.doc, this.handleRange.from)
      return node?.type.name === 'table' ? node : null
    },
    // 与 tableToolsMixin.tableHeaderState 同一套判定，但按句柄目标节点算（不依赖当前选区）。
    handleTableHeaderState() {
      const table = this.handleTableNode()
      if (!table || !table.childCount) return { row: false, column: false }
      const row = table.child(0)
      const rowHeader = row.childCount > 0 && Array.from({ length: row.childCount }, (_, index) => row.child(index).type.name === 'tableHeader').every(Boolean)
      const columnHeader = Array.from({ length: table.childCount }, (_, index) => {
        const current = table.child(index)
        return current.childCount > 0 && current.child(0).type.name === 'tableHeader'
      }).every(Boolean)
      return { row: rowHeader, column: columnHeader }
    },
    requestBlockAI(kind, range = this.handleActionRange()) {
      if (!blockAiAllowed(this) || !range) return false
      this.closeBlockMenu()
      this.savedSelection = null
      const text = this.blockTypeTextRange(range)
      if (text) this.editor.commands.setTextSelection(text)
      else this.editor.commands.setNodeSelection(range.from)
      if (kind === 'translate') this.editor.view.focus()
      this.$emit('ai-request', kind)
      return true
    },
    async copyBlock(range, cut = false) {
      if (!range || !this.contentCopyAllowed() || !isBlockActionEnabled(this.larkDocConfig, cut ? 'cut' : 'copy')
        || (cut && !this.writable())) return false
      const context = this.contentCopyContext()
      return copyBlockContent(context, { ...range }, cut)
    },
  },
}
