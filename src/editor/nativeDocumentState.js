/** Native document-derived state and scroll geometry; commands remain on the host. */
import { collectOutlineState } from '../components/lark-doc/documentOperations'

export const nativeDocumentStateMethods = {
    refreshDocumentState(transaction = null, allowBackground = true) {
      if (!this.editor || this.editor.isDestroyed || this._isBeingDestroyed || this._isDestroyed) return
      const doc = this.editor.state.doc
      // Selection/meta transactions do not change outline, character count or
      // folded ranges. Skipping those full walks removes a large source of
      // jank while typing, selecting and opening menus in large documents.
      if (transaction && transaction.docChanged === false && this._derivedDoc === doc) {
        this.syncFoldState()
        return
      }
      if (allowBackground && doc.content.size > 500000) {
        this.startLargeDerivedRefresh(doc)
        return
      }
      this.outlinePending = false
      const { outline, maxHeadingLevel } = collectOutlineState(doc)
      this.outline = Object.freeze(outline)
      this.maxHeadingLevel = maxHeadingLevel
      this.syncOutlineCollapseState()
      this.syncFoldState()
      this.wordCount = this.editor.storage.characterCount.characters()
      if (this.effectiveMaxLength > 0 && this.wordCount > this.effectiveMaxLength) this.error = `正文不能超过 ${this.effectiveMaxLength} 字，请缩短正文`
      else if (this.error.startsWith('正文不能超过 ')) this.error = ''
      if (this.searchQuery) this.scheduleSearchUpdate()
    },
    startLargeDerivedRefresh(doc) {
      if (this._derivedDoc === doc && this.outlinePending) return
      const version = ++this.pendingDerivedVersion
      this.outlinePending = true
      this._derivedDoc = doc
      const current = () => !!this.editor && !this._isBeingDestroyed && !this._isDestroyed
        && version === this.pendingDerivedVersion && this.editor.state.doc === doc
      import('./documentSnapshot').then(module => {
        if (!current()) return null
        this._derivedStatsReader ||= module.createDocumentStatsReader()
        return this._derivedStatsReader.read(doc, current, active => this._backgroundGate?.wait(active) ?? Promise.resolve(active()))
      }).then(result => {
        if (!result || !current()) return
        this.outline = result.outline
        this.maxHeadingLevel = result.maxHeadingLevel
        this.wordCount = result.characters
        this.outlinePending = false
        this.syncOutlineCollapseState()
        this.syncFoldState()
        if (this.effectiveMaxLength > 0 && this.wordCount > this.effectiveMaxLength) this.error = `正文不能超过 ${this.effectiveMaxLength} 字，请缩短正文`
        else if (this.error.startsWith('正文不能超过 ')) this.error = ''
        if (this.searchQuery) this.scheduleSearchUpdate()
        this.$nextTick(() => this.updateHandleAndTable())
      }).catch(error => {
        if (current()) {
          this.refreshDocumentState(null, false)
          this.error = error.message
        }
      })
    },
    scheduleDocumentState(transaction = null) {
      if (!this.editor) return
      if (this.editor.state.doc.content.size > 500000 && transaction?.docChanged) {
        this.startLargeDerivedRefresh(this.editor.state.doc)
        return
      }
      if (!this.larkDocConfig.performance.stateUpdateFrame) {
        this.refreshDocumentState()
        this.$nextTick(() => this.updateHandleAndTable())
      } else if (!this.pendingStateFrame) {
        this.pendingStateFrame = requestAnimationFrame(() => {
          this.pendingStateFrame = null
          if (!this.editor || this.editor.isDestroyed || this._isBeingDestroyed || this._isDestroyed) return
          this.refreshDocumentState()
          this.$nextTick(() => this.updateHandleAndTable())
        })
      }
    },
    updateHandleAndTable() {
      if (!this.editor || this.editor.isDestroyed || this._isBeingDestroyed || this._isDestroyed) return
      this.updateTableBoundary()
      if (!this.handleRange) return
      const { from, to } = this.handleRange
      const doc = this.editor.state.doc
      if (from < 0 || from >= to || to > doc.content.size) { this.closeBlockMenu(); this.handleRange = null; return }
      const start = doc.resolve(from)
      const end = doc.resolve(to)
      if (!start.sameParent(end) || start.textOffset || end.textOffset || from !== start.posAtIndex(start.index(), start.depth) || to !== end.posAtIndex(end.index(), end.depth)) {
        this.closeBlockMenu(); this.handleRange = null
      } else this.positionBlockHandle(this.handleRange)
    },
    onDocumentScroll(event) {
      if (!this.editor || this.editor.isDestroyed || this._isBeingDestroyed || this._isDestroyed) return
      const largeDocument = this.editor.state.doc.content.size > 500000
      if (largeDocument) this._backgroundGate?.touch()
      if (event?.type === 'resize') this._handleResizePending = true
      if (this._outlineFrame) return
      const handleEngaged = this.handlePressed || this.handleHovering || this.dragging
        || this.blockMenuOpen || this.blockTypeMenuOpen || this.blockAlignMenuOpen || this.blockColorMenuOpen
      // The idle handle is absolutely positioned in paper coordinates. Scroll
      // moves both together; remeasuring it forces an offscreen render window
      // to lay out every frame. Pointer movement and transactions already
      // refresh its anchor, while engaged controls and resize still need it.
      const handleGeometry = !largeDocument || this._handleResizePending || handleEngaged
      const needsGeometry = (handleGeometry && this.handleRange) || handleEngaged
        || this.bubbleVisible || this.bubbleAlignOpen || this.linkDialog || this.tableToolsOpen || this.tablePicker
        || this.tableBoundary?.visible || this._tableOverlayHover || this.headingOpen || this.menuOpen
        || this.calloutEmojiOpen || this.headerMenuOpen || this.moreMenuOpen
      this.scheduleActiveHeading()
      if (largeDocument && !needsGeometry) { this._handleResizePending = false; return }
      this._outlineFrame = requestAnimationFrame(() => {
        this._outlineFrame = null
        // 帧排队后 editor 可能已被销毁（或宿主把它摘成 null）。下面无条件走
        // `updateTableBoundary()`，它的默认参会摸 `editor.isActive` —— 必须在这里
        // 早退，口径与 updateHandleAndTable/onDocumentScroll 入口一致。
        if (!this.editor || this.editor.isDestroyed || this._isBeingDestroyed || this._isDestroyed) return
        const measureHandle = handleGeometry || this._handleResizePending
        this._handleResizePending = false
        const hasHandle = !!this.handleRange || !!this.handlePressed || !!this.handleHovering || !!this.dragging
        if (hasHandle && measureHandle && !this.blockMenuOpen && !this.blockTypeMenuOpen && !this.handlePressed) this.positionBlockHandle(this.handleRange)
        if (hasHandle && measureHandle) this.syncHandleHighlightBackdrop()
        if (this.blockAlignMenuOpen) this.positionBlockAlignMenu()
        if (this.blockColorMenuOpen) this.positionBlockColorMenu()
        if (this.bubbleAlignOpen) this.positionBubbleAlignMenu()
        if (this.bubbleVisible) this.bubblePosition = this.bubbleBarPosition(this.editor.state.selection)
        this.updateTableBoundary()
        this.refreshTableOverlays?.()
        if (this.tablePicker) this.positionTablePicker()
        if (this.headingOpen) this.positionHeadingMenu()
        if (this.headerMenuOpen) this.positionHeaderMenu()
        if (this.moreMenuOpen) this.positionMoreMenu()
        if (this.menuOpen) this.positionCommandMenu()
        if (this.calloutEmojiOpen || this._calloutToolsUi?.el?.isConnected) this.updateCalloutTools()
      })
    },
    scheduleActiveHeading() {
      if (!this.outline.length) return
      const largeDocument = this.editor?.state?.doc?.content?.size > 500000
      // `posAtCoords()` has to walk the ProseMirror DOM. On a 30M document it
      // is useful after scrolling settles, but doing it every 80ms while the
      // viewport is moving competes directly with the browser's layout work.
      // Keep the existing leading cadence for normal documents and use a
      // trailing timer for the large-document path.
      if (largeDocument) clearTimeout(this._activeHeadingTimer)
      else if (this._activeHeadingTimer) return
      this._activeHeadingTimer = setTimeout(() => {
        this._activeHeadingTimer = null
        if (!this.editor || this.outlinePending || this._isBeingDestroyed || this._isDestroyed) return
        if (this.editor.state.doc.content.size > 500000) {
          // PM's posAtCoords can fall back to reading every child's rect when
          // the point hits whitespace. Bound this lookup to the render window.
          const root = this.editor.view.dom
          const rect = root.getBoundingClientRect()
          const left = rect.left + Math.min(40, rect.width / 2), top = Math.max(170, rect.top + 1)
          const target = this.editor.storage.larkDoc.projection?.blockAtPoint(left, top)
            || root.ownerDocument.elementFromPoint?.(left, top)
          if (!target || target === root || !root.contains(target)) return
          let position
          try { position = this.editor.view.posAtDOM(target, 0) } catch (_) { return }
          let low = 0
          let high = this.outline.length - 1
          let visible = -1
          while (low <= high) {
            const middle = (low + high) >> 1
            if (this.outline[middle].pos <= position) { visible = this.outline[middle].pos; low = middle + 1 }
            else high = middle - 1
          }
          if (visible !== -1) this.activeHeading = visible
          return
        }
        let visible = -1
        for (const item of this.outline) {
          const dom = this.editor.view.nodeDOM(item.pos)
          if (dom instanceof Element && dom.getBoundingClientRect().top <= 170) visible = item.pos
          else if (visible !== -1) break
        }
        if (visible !== -1) this.activeHeading = visible
      }, largeDocument ? 150 : 80)
    },
    onDocumentPointerMove(event) {
      if (this.$refs.root.contains(event.target)) return
      if (!event.target.closest?.('.lark-doc-block-handle, .lark-doc-callout-tools')) this.scheduleHandleHide()
    },
}
