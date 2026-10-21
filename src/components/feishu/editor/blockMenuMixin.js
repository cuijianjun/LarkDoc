/**
 * blockMenuMixin — 区块菜单（类型/对齐/颜色子菜单）的开合、定位、悬停/焦点关闭调度与菜单动作。
 * 通过 this.editor、this.writable()、this.featureEnabled()、this.savedSelection 与主组件协作；
 * 依赖 blockHandleMixin 的 handleActionRange/setHandleHighlight/refreshHandleHighlight（this 上合并可见）。
 * 采用 mixin 而非子组件：菜单 DOM 挂在主模板的句柄内，依赖 Vue 2 选项合并语义，拆子组件会破坏定位逻辑。
 */
import { closeHistory } from '@tiptap/pm/history'
import { moveBlockRange } from '../documentOperations'
import { isBlockActionEnabled } from '../feishuConfig'
import { blockActions, blockTypeActions } from './constants'

export default {
  data() { return {
    blockMenuOpen: false, blockTypeMenuOpen: false, blockAlignMenuOpen: false, blockColorMenuOpen: false,
    blockMenuStyle: {}, blockAlignMenuStyle: {}, blockColorMenuStyle: {}, blockMenuCloseTimer: null, blockMenuHovering: false,
    blockActions, blockTypeActions,
  } },
  methods: {
    blockTextblockTarget(range) {
      if (!range || !this.editor) return null
      const doc = this.editor.state.doc
      const probe = Math.min(doc.content.size, Math.max(0, range.from + 1))
      const $pos = doc.resolve(probe)
      for (let depth = $pos.depth; depth > 0; depth -= 1) {
        const node = $pos.node(depth)
        if (node.type.name === 'paragraph' || node.type.name === 'heading') return { node, pos: $pos.before(depth) }
      }
      const node = doc.nodeAt(range.from)
      return node && (node.type.name === 'paragraph' || node.type.name === 'heading') ? { node, pos: range.from } : null
    },
    applyBlockAttribute(target, name, value) {
      if (!this.writable() || !target?.node || value === null || value === undefined) return false
      const attrs = { ...target.node.attrs, [name]: value }
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
    blockAlignIndent() { return Number(this.blockAlignNode()?.attrs?.indent) || 0 },
    clearBlockMenuCloseTimer() {
      clearTimeout(this.blockMenuCloseTimer)
      this.blockMenuCloseTimer = null
    },
    blockMenuHasFocus() {
      const active = typeof document !== 'undefined' ? document.activeElement : null
      const handle = this.$refs.root?.querySelector('.feishu-block-handle')
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
      if (event?.relatedTarget?.closest?.('.feishu-block-menu')) return
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
      if (event?.relatedTarget?.closest?.('.feishu-block-handle')) return
      this.blockMenuHovering = false
      if (this.blockMenuOpen && !this.handlePressed) this.scheduleBlockMenuClose()
      this.refreshHandleHighlight()
    },
    onBlockMenuFocusIn() {
      this.clearBlockMenuCloseTimer()
      this.refreshHandleHighlight()
    },
    onBlockMenuFocusOut(event) {
      if (event.relatedTarget && this.$refs.root?.querySelector('.feishu-block-handle')?.contains(event.relatedTarget)) return
      if (this.blockMenuOpen && !this.handlePressed) this.scheduleBlockMenuClose()
    },
    positionBlockMenu(selector) {
      this.$nextTick(() => {
        const handle = this.$refs.root?.querySelector('.feishu-block-handle')
        const menu = handle?.querySelector(selector)
        if (!handle || !menu) return
        const handleRect = handle.getBoundingClientRect()
        const menuRect = menu.getBoundingClientRect()
        const content = this.$refs.root?.querySelector('.feishu-editor-content, .ProseMirror')
        const contentRect = content?.getBoundingClientRect?.() || handleRect
        const viewportGap = 8
        const menuWidth = menuRect.width || 230
        const maxViewportLeft = Math.max(viewportGap, window.innerWidth - menuWidth - viewportGap)
        const preferredViewportLeft = contentRect.left - menuWidth - viewportGap
        const menuViewportLeft = preferredViewportLeft >= viewportGap && preferredViewportLeft <= maxViewportLeft
          ? preferredViewportLeft
          : Math.min(Math.max(handleRect.left, viewportGap), maxViewportLeft)
        const top = handleRect.top
        const below = Math.max(0, window.innerHeight - top - 40)
        const above = Math.max(0, top - 8)
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
      if (!this.writable() || this.handleIsEmptyParagraph || this.handleIsTaskList) return
      this.handleHovering = true
      this.openBlockMenu()
    },
    toggleBlockTypeMenu() { this.openBlockMenu() },
    openBlockMenu() {
      if (!this.writable() || this.handleIsEmptyParagraph || this.handleIsTaskList) return
      this.clearBlockMenuCloseTimer()
      this.blockMenuOpen = true
      this.setHandleHighlight(true)
      this.blockTypeMenuOpen = false
      this.blockAlignMenuOpen = false
      this.blockColorMenuOpen = false
      this.blockAlignMenuStyle = {}
      this.blockColorMenuStyle = {}
      this.blockMenuStyle = {}
      this.positionBlockMenu('.feishu-block-menu')
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
      const trigger = root?.querySelector('.feishu-block-submenu-trigger')
      const submenu = root?.querySelector('.feishu-block-submenu')
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
      const trigger = [...(root?.querySelectorAll('.feishu-block-submenu-trigger') || [])].find((element) => element.getAttribute('title') === '颜色')
      const submenu = root?.querySelector('.feishu-block-color-submenu')
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
    blockAlignAction(id) {
      if (!this.writable() || !this.featureEnabled('blockStyle')) return
      const range = this.handleActionRange()
      if (!range) return
      this.closeBlockMenu()
      const target = this.blockTextblockTarget(range)
      if (!target) return
      if (id === 'increaseIndent' || id === 'decreaseIndent') {
        const delta = id === 'increaseIndent' ? 1 : -1
        const indent = Math.max(0, Math.min(this.feishuConfig.limits.maxIndent, (Number(target.node.attrs.indent) || 0) + delta))
        this.applyBlockAttribute(target, 'indent', indent)
      } else this.applyBlockAttribute(target, 'textAlign', id)
    },
    blockColorAction(value) {
      if (!this.writable() || !this.featureEnabled('blockStyle')) return
      const range = this.handleActionRange()
      const target = this.blockTextblockTarget(range)
      if (!target) return
      const from = target.pos + 1
      const to = Math.max(from, target.pos + target.node.nodeSize - 1)
      this.closeBlockMenu()
      this.editor.commands.setTextSelection({ from, to })
      if (value) this.editor.chain().focus().setColor(value).run()
      else this.editor.chain().focus().unsetColor().run()
      this.editor.view.focus()
    },
    blockTypeAction(id) {
      if (!this.writable() || !isBlockActionEnabled(this.feishuConfig, id)) return
      const range = this.handleActionRange()
      const node = range && this.editor.state.doc.nodeAt(range.from)
      if (!range || !node || !['paragraph', 'heading'].includes(node.type.name)) return
      this.closeBlockMenu()
      this.savedSelection = null
      this.editor.commands.setTextSelection({ from: range.from + 1, to: Math.max(range.from + 1, range.to - 1) })
      if (id === 'paragraph') this.run('setParagraph')
      else if (/^heading[1-9]$/.test(id)) this.run('setHeading', { level: Number(id.slice(-1)) })
      else if (id === 'bulletList') this.run('toggleBulletList')
      else if (id === 'orderedList') this.run('toggleOrderedList')
      else if (id === 'taskList') this.run('toggleTaskList')
      else if (id === 'blockquote') this.run('toggleBlockquote')
      else if (id === 'codeBlock') this.run('setCodeBlock')
    },
    blockTypeActive(id) {
      if (!this.editor || !this.handleRange) return false
      const node = this.editor.state.doc.nodeAt(this.handleRange.from)
      if (!node) return false
      if (id === 'paragraph') return node.type.name === 'paragraph'
      if (/^heading[1-9]$/.test(id)) return node.type.name === 'heading' && Number(node.attrs?.level) === Number(id.slice(-1))
      return node.type.name === id
    },
    blockAction(id) {
      if (!this.writable() || !isBlockActionEnabled(this.feishuConfig, id)) return
      this.closeBlockMenu()
      const selectedRange = this.handleActionRange()
      const sectionRange = ['copy', 'cut', 'duplicate', 'moveUp', 'moveDown'].includes(id) ? this.headingActionRange(selectedRange) : null
      const range = id === 'delete'
        ? (this.columnsRangeFor(selectedRange) || this.detailsRangeFor(selectedRange) || selectedRange)
        : sectionRange || selectedRange
      if (!range) return
      if (id === 'copy' || id === 'cut') { this.copyBlock(range, id === 'cut'); return }
      if (id === 'translate') { this.$emit('ai-request', 'translate'); this.editor.view.focus(); return }
      if (id === 'delete') { this.deleteBlockRange(range); return }
      const { from, to } = range
      this.editor.view.dispatch(closeHistory(this.editor.state.tr))
      const tr = this.editor.state.tr
      if (id === 'duplicate') { tr.insert(to, this.editor.state.doc.slice(from, to).content); this.editor.view.dispatch(tr) }
      else if (id === 'addBelow') { const paragraph = this.editor.schema.nodes.paragraph?.createAndFill(); if (paragraph) { tr.insert(to, paragraph); this.editor.view.dispatch(tr); this.editor.commands.setTextSelection(Math.min(to + 1, this.editor.state.doc.content.size)) } }
      else if (id === 'moveUp' || id === 'moveDown') {
        const resolved = this.editor.state.doc.resolve(from)
        const index = resolved.index()
        const endIndex = this.editor.state.doc.resolve(to).index()
        const targetIndex = id === 'moveUp' ? index - 1 : endIndex + 1
        if (targetIndex >= 0 && targetIndex <= resolved.parent.childCount) moveBlockRange(this.editor, from, to, resolved.posAtIndex(targetIndex, resolved.depth))
      }
    },
    async copyBlock(range, cut = false) {
      if (!this.writable() || !range) return false
      const text = this.editor.state.doc.textBetween(range.from, range.to, '\n')
      const content = this.editor.state.doc.slice(range.from, range.to).content.toJSON()
      const structured = JSON.stringify({ schemaVersion: 1, type: 'feishu-block', content })
      let copied = false
      try {
        if (navigator.clipboard?.write && window.ClipboardItem) {
          const item = new window.ClipboardItem({
            'text/plain': new Blob([text], { type: 'text/plain' }),
            'application/x-feishu-block+json': new Blob([structured], { type: 'application/json' }),
          })
          await navigator.clipboard.write([item])
          copied = true
        }
      } catch (_) { copied = false }
      if (!copied) {
        try {
          if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text)
            copied = true
          } else {
            const textarea = document.createElement('textarea')
            textarea.value = text
            textarea.setAttribute('readonly', 'true')
            textarea.style.position = 'fixed'
            textarea.style.opacity = '0'
            document.body.appendChild(textarea)
            textarea.select()
            copied = document.execCommand('copy')
            textarea.remove()
          }
        } catch (_) { copied = false }
      }
      if (!copied) { this.error = '无法访问剪贴板，区块未被修改；可手动选择后复制'; return false }
      if (cut && this.writable()) this.deleteBlockRange(range)
      this.error = cut ? '已剪切区块' : '已复制区块'
      this.$nextTick(() => this.editor?.view.focus())
      return true
    },
  },
}
