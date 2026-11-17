/** Private actions reached from mounted block-menu rows. Original references stay host-owned. */
export function createBlockInteraction(dependencies) {
  const { closeHistory, isBlockActionEnabled, nodeAtSafe, wrapContainerAllowed, TextSelection, blockAiAllowed, moveBlockRange, BLOCK_ID_PATTERN, safeUrl, stepBlockIndent } = dependencies
  const methods = {
    blockTypeAction(id) {
      const feature = id === 'codeBlock' ? 'codeBlocks' : id === 'callout' ? 'callouts' : /^heading/.test(id) ? 'headings' : 'blockStyle'
      if (!this.writable() || !this.featureEnabled('blockStyle') || !this.featureEnabled(feature) || !isBlockActionEnabled(this.larkDocConfig, id)) return false
      if (!this.blockTypeActions.some(item => item.id === id) && !/^heading[1-9]$/.test(id)) return false
      const range = this.handleActionRange()
      const node = nodeAtSafe(this.editor?.state?.doc, range?.from)
      const text = this.blockTypeTextRange(range)
      if (!text) return false
      this.closeBlockMenu()
      this.savedSelection = null
      if (id === 'orderedList' && node.type.name === 'heading') return this.editor.commands.toggleLarkDocHeadingNumber(range.from)
      if (this.blockTypeActive(id)) return true
      // Each chain step gets the updated selection/doc. Keep lifting and type
      // conversion in one transaction, and abort it entirely if either fails.
      const chain = this.editor.chain().command(({ tr }) => { closeHistory(tr); return true }).setTextSelection(text)
      const item = ['taskItem', 'taskList'].includes(node.type.name) ? 'taskItem' : ['listItem', 'bulletList', 'orderedList'].includes(node.type.name) ? 'listItem' : null
      if (item || ['blockquote', 'callout'].includes(node.type.name)) chain.command(({ commands, tr }) => {
        const lifted = item ? commands.liftListItem(item) : commands.lift(node.type.name)
        if (!lifted) tr.setMeta('preventDispatch', true)
        return lifted
      })
      if (node.type.name === 'codeBlock' && ['bulletList', 'orderedList', 'taskList'].includes(id)) chain.command(({ commands, tr }) => {
        const ok = commands.setParagraph()
        if (!ok) tr.setMeta('preventDispatch', true)
        return ok
      })
      chain.command(({ commands, tr }) => {
        if (tr.getMeta('preventDispatch')) return false
        let ok
        if (id === 'paragraph') ok = commands.setParagraph()
        else if (/^heading/.test(id)) ok = commands.setHeading({ level: Number(id.slice(-1)) })
        else if (id === 'bulletList') ok = commands.toggleBulletList()
        else if (id === 'orderedList') ok = commands.toggleOrderedList()
        else if (id === 'taskList') ok = commands.toggleTaskList()
        else if (id === 'codeBlock') ok = commands.setCodeBlock()
        else if (!wrapContainerAllowed({ doc: tr.doc }, tr.selection.from, tr.selection.to, 1)) { this.error = '容器嵌套最多 5 层'; ok = false }
        else ok = commands.wrapIn(id)
        if (!ok) { tr.setMeta('preventDispatch', true); return false }
        return true
      })
      // Keep the original text block identity through lifting and conversion;
      // replacing it with a removed wrapper's ID would orphan its comments.
      const changed = chain.run()
      if (!changed) return false
      this.editor.view.dispatch(closeHistory(this.editor.state.tr))
      this.handleRange = this.rangeAt(this.editor.state.selection.from)
      this.editor.view.focus()
      return changed
    },
    blockAction(id) {
      if (!this.writable() || !isBlockActionEnabled(this.larkDocConfig, id)) return
      if (id === 'translate' && !blockAiAllowed(this)) return
      this.closeBlockMenu()
      const selectedRange = this.handleActionRange()
      const sectionRange = ['copy', 'cut', 'duplicate', 'moveUp', 'moveDown', 'saveTemplate'].includes(id) ? this.headingActionRange(selectedRange) : null
      const range = id === 'delete'
        ? (this.columnsRangeFor(selectedRange) || this.detailsRangeFor(selectedRange) || selectedRange)
        : sectionRange || selectedRange
      if (!range) return
      if (id === 'comment') {
        if (!this.commentAllowed?.('create')) return false
        const text = this.blockTypeTextRange(range)
        if (!text || text.from >= text.to) return false
        this.savedSelection = null
        this.editor.commands.setTextSelection(text)
        return this.openSelectionComment()
      }
      if (id === 'share') return this.openSelectionShareDialog(range.from)
      if (id === 'saveTemplate') return this.openBlockTemplateSave(range)
      if (id === 'copyLink') return this.copyBlockLink(range)
      if (id === 'copy' || id === 'cut') { this.copyBlock(range, id === 'cut'); return }
      if (id === 'translate') return this.requestBlockAI('translate', range)
      if (id === 'delete') { this.deleteBlockRange(range); return }
      const { from, to } = range
      const editor = this.editor, before = editor.state.doc, ownerDocument = editor.view.dom.ownerDocument
      const focused = ownerDocument.activeElement, root = this.$refs?.root || editor.view.dom
      const focusOwned = focused === ownerDocument.body || root.contains(focused)
      this.editor.view.dispatch(closeHistory(this.editor.state.tr))
      const tr = this.editor.state.tr
      if (id === 'duplicate') { const slice = this.editor.state.doc.slice(from, to); tr.insert(to, (this.editor.storage.larkDoc?.pagedView?.copySlice(slice) || slice).content); this.editor.view.dispatch(tr) }
      else if (id === 'addBelow') {
        const paragraph = this.editor.schema.nodes.paragraph?.createAndFill()
        if (paragraph) {
          tr.insert(to, paragraph)
          // Fitting a paragraph between list items can split the list. Resolve
          // the inserted text position in the new document, not the old range.
          tr.setSelection(TextSelection.near(tr.doc.resolve(tr.mapping.map(to, -1)), 1))
          this.editor.view.dispatch(tr)
        }
      }

      else if (id === 'moveUp' || id === 'moveDown') {
        const paged = this.editor.storage.larkDoc?.pagedView
        const resolved = this.editor.state.doc.resolve(from)
        if (paged?.isDocument(this.editor.state.doc) && ['doc', 'documentSegment'].includes(resolved.parent.type.name)) {
          const target = paged.moveTarget(from, to, id)
          if (target !== null && moveBlockRange(this.editor, from, to, target)) this.editor.view.focus()
          return
        }
        const index = resolved.index()
        const endIndex = this.editor.state.doc.resolve(to).index()
        const targetIndex = id === 'moveUp' ? index - 1 : endIndex + 1
        if (targetIndex >= 0 && targetIndex <= resolved.parent.childCount) moveBlockRange(this.editor, from, to, resolved.posAtIndex(targetIndex, resolved.depth))
      }
      const active = ownerDocument.activeElement
      if (focusOwned && this.editor === editor && !editor.isDestroyed && this.writable() && editor.view.dom.isConnected &&
        editor.state.doc !== before && (active === focused || active === ownerDocument.body || editor.view.dom.contains(active))) editor.view.focus()
    },
    tableHandleAction(id) {
      if (!this.writable() || !this.featureEnabled('tables')) return
      const range = this.handleRange
      if (!range) return
      // 表格命令都按当前选区定位：先把光标落进表格（isActive('table') 才成立）。
      const doc = this.editor.state.doc
      const table = nodeAtSafe(doc, range.from)
      if (table?.type.name !== 'table') return
      const firstTextPos = () => {
        let found = null
        doc.nodesBetween(range.from, Math.min(range.to, doc.content.size), (child, pos) => {
          if (found === null && child.isTextblock) { found = pos + 1; return false }
          return true
        })
        return found
      }
      if (id === 'distributeColumns') {
        // selectedRect 对跨格 TextSelection 仍只取首格，须选择全部行。
        this.closeBlockMenu()
        if (this.selectTableLine('row', 0, table.childCount - 1, { pos: range.from, node: table })) this.tableAction('distributeColumns')
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
    async copyBlockLink(range) {
      if (!this.shareCan('canView')) return false
      const editor = this.editor, session = this.session, doc = editor?.state.doc
      const node = nodeAtSafe(doc, range?.from), documentLink = this.shareDocumentLink()
      if (!node?.isBlock || !BLOCK_ID_PATTERN.test(node.attrs.blockId || '')) return false
      const current = () => this.editor === editor && !editor.isDestroyed && this.session === session
        && editor.state.doc === doc && this.shareCan('canView') && this.shareDocumentLink() === documentLink
      try {
        const url = new URL(documentLink, window.location.href)
        if (!/^https?:$/.test(url.protocol) || !safeUrl(url.href)) return false
        url.hash = `share-${node.attrs.blockId}`
        if (!await this.copyShareText(url.href)) throw new Error('复制失败，请检查剪贴板权限')
        if (!current()) return false
        this.showShareToast('success', '复制成功')
        return true
      } catch (error) { if (current()) this.error = error?.message || '复制失败，请检查剪贴板权限'; return false }
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
    openBlockInsertMenu(event) {
      if (!this.writable() || !this.featureEnabled('insert') || !isBlockActionEnabled(this.larkDocConfig, 'addBelow')) return false
      const rect = event?.currentTarget?.getBoundingClientRect?.(), before = this.editor.state.doc
      this.blockAction('addBelow')
      if (this.editor.state.doc === before) return false
      this.openCommandMenu('plus')
      // The footer trigger is removed with the block menu. Retain its rect,
      // rather than letting a detached button anchor the picker at (0, 0).
      this.menuTrigger = null
      if (rect) this.menuAnchor = { left: rect.left, top: rect.top, bottom: rect.bottom }
      this.$nextTick(() => this.positionCommandMenu())
      return true

    },
  }
  return { methods }
}
