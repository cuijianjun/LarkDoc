/**
 * blockMenuMixin — 区块菜单（类型/对齐/颜色子菜单）的开合、定位、悬停/焦点关闭调度与菜单动作。
 * 通过 this.editor、this.writable()、this.featureEnabled()、this.savedSelection 与主组件协作；
 * 依赖 blockHandleMixin 的 handleActionRange/setHandleHighlight/refreshHandleHighlight（this 上合并可见）。
 * 采用 mixin 而非子组件：菜单 DOM 挂在主模板的句柄内，依赖 Vue 2 选项合并语义，拆子组件会破坏定位逻辑。
 */
import { closeHistory } from '@tiptap/pm/history'
import { clampBlockIndent, maxIndentAt, moveBlockRange, nodeAtSafe, stepBlockIndent } from '../documentOperations'
import { isBlockActionEnabled } from '../larkDocConfig'
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
    blockAlignAction(id) {
      if (!this.writable() || !this.featureEnabled('blockStyle')) return
      const range = this.handleActionRange()
      if (!range) return
      this.closeBlockMenu()
      if (id === 'increaseIndent' || id === 'decreaseIndent') {
        const target = this.blockIndentTarget(range)
        if (!target) return
        const current = Number(target.node.attrs.indent) || 0
        // 增加受前一个块限制；减少只受 0 下限（可以一路减回文档开头）。
        const indent = stepBlockIndent(this.editor.state.doc, target.pos, current, id === 'increaseIndent' ? 1 : -1, this.maxBlockIndent)
        this.applyBlockAttribute(target, 'indent', indent)
        return
      }
      const target = this.blockTextblockTarget(range)
      if (!target) return
      this.applyBlockAttribute(target, 'textAlign', id)
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
      if (!this.writable() || !isBlockActionEnabled(this.larkDocConfig, id)) return
      const range = this.handleActionRange()
      const node = nodeAtSafe(this.editor?.state?.doc, range?.from)
      if (!range || !node || !['paragraph', 'heading'].includes(node.type.name)) return
      this.closeBlockMenu()
      this.savedSelection = null
      this.editor.commands.setTextSelection({ from: range.from + 1, to: Math.max(range.from + 1, range.to - 1) })
      if (id === 'paragraph') this.run('setParagraph')
      else if (/^heading[1-9]$/.test(id)) this.run('setHeading', { level: Number(id.slice(-1)) })
      else if (id === 'bulletList') this.run('toggleBulletList')
      // 飞书的「给标题加编号」就是「把标题设为有序列表」，所以作用在标题上时走标题编号，
      // 作用在正文上时才是真的转有序列表。
      else if (id === 'orderedList') {
        if (node.type.name === 'heading') this.editor.commands.toggleLarkDocHeadingNumber(range.from)
        else this.run('toggleOrderedList')
      }
      else if (id === 'taskList') this.run('toggleTaskList')
      else if (id === 'blockquote') this.run('toggleBlockquote')
      else if (id === 'codeBlock') this.run('setCodeBlock')
    },
    blockTypeActive(id) {
      if (!this.editor || !this.handleRange) return false
      const node = nodeAtSafe(this.editor?.state?.doc, this.handleRange?.from)
      if (!node) return false
      if (id === 'paragraph') return node.type.name === 'paragraph'
      if (/^heading[1-9]$/.test(id)) return node.type.name === 'heading' && Number(node.attrs?.level) === Number(id.slice(-1))
      // heading 上的「有序列表」代表标题编号是否开启
      if (id === 'orderedList') return node.type.name === 'orderedList' || (node.type.name === 'heading' && node.attrs?.numbering === true)
      return node.type.name === id
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
    tableHandleAction(id) {
      if (!this.writable() || !this.featureEnabled('tables')) return
      const range = this.handleRange
      if (!range) return
      // 表格命令都按当前选区定位：先把光标落进表格（isActive('table') 才成立）。
      const doc = this.editor.state.doc
      const firstTextPos = () => {
        let found = null
        doc.nodesBetween(range.from, Math.min(range.to, doc.content.size), (child, pos) => {
          if (found === null && child.isTextblock) { found = pos + 1; return false }
          return true
        })
        return found
      }
      if (id === 'distributeColumns') {
        // 整表均分：选区要罩住全表（首格到末格），selectedRect 才覆盖所有列。
        this.closeBlockMenu()
        const first = firstTextPos()
        let last = null
        doc.nodesBetween(range.from, Math.min(range.to, doc.content.size), (child, pos) => {
          if (child.isTextblock) last = pos + 1
          return true
        })
        if (first !== null && last !== null) this.editor.commands.setTextSelection({ from: first, to: Math.max(first, last) })
        this.tableAction('distributeColumns')
        return
      }
      const first = firstTextPos()
      if (first !== null) this.editor.commands.setTextSelection(Math.min(first, doc.content.size))
      if (id === 'toggleHeaderRow' || id === 'toggleHeaderColumn') {
        // 开关保持菜单展开（飞书同款：点了能直接看到开关翻转）。
        this.tableAction(id)
        // 表格重渲染会派生一次假的 handle mouseleave：短窗口内忽略它。
        this._keepMenuThroughRender = true
        clearTimeout(this._keepMenuTimer)
        this._keepMenuTimer = setTimeout(() => { this._keepMenuThroughRender = false }, 350)
        return
      }
      this.closeBlockMenu()
      this.tableAction(id)
    },
    blockAction(id) {
      if (!this.writable() || !isBlockActionEnabled(this.larkDocConfig, id)) return
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
      const structured = JSON.stringify({ schemaVersion: 1, type: 'lark-doc-block', content })
      let copied = false
      try {
        if (navigator.clipboard?.write && window.ClipboardItem) {
          const item = new window.ClipboardItem({
            'text/plain': new Blob([text], { type: 'text/plain' }),
            'application/x-lark-doc-block+json': new Blob([structured], { type: 'application/json' }),
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
