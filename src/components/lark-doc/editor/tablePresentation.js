/** Private table toolbar presentation. PM identities and command gates are injected by the native host. */
export function createTablePresentation(dependencies) {
  const { CellSelection, closeHistory, isCommandEnabled } = dependencies
  const methods = {
    tableSelectionAlignment(selection) {
      const horizontal = new Set()
      const vertical = new Set()
      const collect = node => {
        if (node.isTextblock) horizontal.add(node.attrs.textAlign || 'left')
        if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') vertical.add(node.attrs.verticalAlign || 'top')
      }
      if (selection instanceof CellSelection) {
        selection.forEachCell(node => { collect(node); node.descendants(collect) })
      } else {
        this.editor.state.doc.nodesBetween(selection.from, selection.to, collect)
      }
      const common = values => values.size === 1 ? values.values().next().value : null
      return { textAlign: common(horizontal), verticalAlign: common(vertical) }
    },
    buildTableToolsPresentation({ selection, cellKind, anchor }) {
      // 飞书 `menu-item-actived`：按钮按下沉态 = 该格式在当前选区已生效。
      const active = {}
      for (const mark of ['bold', 'strike', 'italic', 'underline', 'code']) {
        try { active[mark] = !!this.editor.isActive(mark) } catch { active[mark] = false }
      }
      // 依赖上下文的命令（合并/拆分需 CellSelection、缩进受前块上限、转换为需非空块）：
      // 把适用性算进 state，菜单里不适用项置灰 + 当前块类型回填 pressed，
      // 而不是让用户点一颗「看起来能点、点了没反应」的按钮。
      const parent = selection.$from?.parent
      const parentName = parent?.type?.name
      // 「拆分单元格」只对已合并的单元格有意义；没有 colspan/rowspan>1 时置灰，
      // 避免用户点到一颗命令合法、但当前文档里什么都拆不了的按钮（v11 全量审计发现）。
      const canSplitCell = isCommandEnabled(this.larkDocConfig, 'splitCell') && !!this.editor.can().splitCell()
      const line = selection instanceof CellSelection && cellKind === 'line' ? this.tableCellLineFromRect(selection) : null
      let hasTextColor = false
      let hasCellBg = false
      try {
        const textStyle = this.editor?.getAttributes?.('textStyle') || {}
        hasTextColor = !!(textStyle.color || textStyle.backgroundColor) || !!this.editor?.isActive?.('highlight')
        const cell = this.editor?.getAttributes?.('tableCell') || {}
        const head = this.editor?.getAttributes?.('tableHeader') || {}
        hasCellBg = !!(cell.backgroundColor || head.backgroundColor)
      } catch { /* 扩展未注册 / 非表格态：按「无可清除内容」处理 */ }
      return {
        open: true,
        anchor,
        active,
        tableContext: true,
        aiVisible: this.featureEnabled('ai'),
        commentVisible: !!this.commentEntryVisible,
        shareVisible: !!this.selectionShareEntryAvailable,
        canComment: !!this.commentEntryAvailable,
        header: this.tableHeaderState,
        ...this.tableSelectionAlignment(selection),
        cellTextAlignOptions: this.cellTextAlignOptions,
        cellVerticalAlignOptions: this.cellVerticalAlignOptions,
        cellSelection: selection instanceof CellSelection,
        // 飞书 App 移动端整列选中浮层：锚定列头 + 插入列/删除列/剪切/复制四按钮。
        // 只在移动端(CSS media matches) + 选中恰好一整列(line/column)时为真，桌面恒 false。
        mobileColumnMenu: !!(this._mobileEditorMedia?.matches) && cellKind === 'line' && line?.axis === 'column',
        cellKind,
        canSplitCell,
        canMergeCell: isCommandEnabled(this.larkDocConfig, 'mergeCells') && !!this.editor.can().mergeCells(),
        headerAxis: line?.index === 0 ? line.axis : null,
        headerEnabled: !!line && isCommandEnabled(this.larkDocConfig, line.axis === 'column' ? 'toggleHeaderColumn' : 'toggleHeaderRow'),
        hasTextColor,
        hasCellBg,
        blockType: parentName === 'heading' ? `heading${parent.attrs?.level || 1}` : parentName,
      }

    },
    /**
     * v11 统一工具条命令分发。菜单里只留项目真能承接的能力：编辑器命令直接执行，
     * AI / 搜索走项目已有的面板与事件；v10 那些靠 localStorage / window.open
     * 伪造的「模板 / 词典 / 子文档 / 网页搜索」已按用户口径从 UI 移除，这里也不再留分支。
     * 评论走 commentsMixin 的真实 composer/Provider，缺服务不产生本地假评论。
     * 分享未接通前保持隐藏，不复活旧 #pos 假链接。
     * 飞书功能栏没有「表格操作」按钮，结构命令由边界 ＋、块句柄菜单与各表格下拉承接。
     */
    tableToolbarCommand(id, value) {
      if (!this.writable() || !this.featureEnabled('tables')) return false
      const state = this.editor?.state
      const selection = state?.selection
      const text = selection && !selection.empty
        ? state.doc.textBetween(selection.from, selection.to, ' ') : ''
      const emit = (action, extra = {}) => {
        const detail = {
          action, text, from: selection?.from, to: selection?.to, value, ...extra,
        }
        // `$emit` 在 native host 只转给构造时传入的 on{} 回调；未接线的宿主**收不到**，
        // 等于点了没反应。同步再抛一份 bubbling+composed 的 DOM 事件，宿主在任意祖先
        // 节点都能委托监听（Web Component / Shadow DOM 同样可达）。
        this.$emit?.('lark-doc-toolbar-action', detail)
        this.dispatchToolbarAction?.('lark-doc-toolbar-action', detail)
      }
      const setCellBg = (color) => {
        if (!color) this.run('setCellAttribute', 'backgroundColor', null)
        else this.cellAttribute?.('backgroundColor', color)
      }

      switch (id) {
        // 飞书 App 移动端整列浮层四按钮。全部复用既有能力，不做「点了没反应」的假入口。
        // 插入列固定走 addColumnAfter（与边界 ＋ 同一口径）；删除列读真实选区删整列；
        // 剪切/复制走 contentClipboard 的选区级复制（cut=true 再删内容），沿用权限闸门。
        case 'mobile-insert-col': {
          if (!isCommandEnabled(this.larkDocConfig, 'addColumnAfter')) return false
          this.editor.view.dispatch(closeHistory(this.editor.state.tr))
          return this.tableAction?.('addColumnAfter') !== false
        }
        case 'mobile-delete-col': return !!this.deleteSelectedTableLine?.()
        case 'mobile-cut-col': return !!this.bubbleCopy?.(true)
        case 'mobile-copy-col': return !!this.bubbleCopy?.(false)
        case 'ask-ai':
          if (!this.featureEnabled('ai') || !this.buildTableToolsState().open) return false
          this.$emit?.('ai-request', { action: 'chat', source: 'table' })
          return true
        case 'share-link': return this.openSelectionShareDialog()
        case 'comment':
          if (!this.commentEntryAvailable || !this.buildTableToolsState().open) return false
          return this.beginCommentComposer()
        case 'bold': case 'strike': case 'italic': case 'underline': case 'code':
          this.toggleMark?.(id); return true
        case 'link': this.openLinkDialog?.(true); return true
        case 'table-header': {
          const line = this.tableCellLineFromRect(selection)
          if (!line || line.index !== 0) return false
          const command = line.axis === 'column' ? 'toggleHeaderColumn' : 'toggleHeaderRow'
          if (!isCommandEnabled(this.larkDocConfig, command)) return false
          this.editor.view.dispatch(closeHistory(this.editor.state.tr))
          return this.editor.commands[command]()
        }
        case 'merge-cell': {
          const action = this.editor.can().splitCell() ? 'splitCell' : 'mergeCells'
          if (!isCommandEnabled(this.larkDocConfig, action)) return false
          this.editor.view.dispatch(closeHistory(this.editor.state.tr))
          return this.editor.commands[action]()
        }
        case 'cell-bg':
          setCellBg(String(value || '').startsWith('cellbg:') ? String(value).slice(7) : value)
          return true
        case 'turninto': {
          const id = String(value || '')
          // ⚠️ 不能复用 `blockTypeAction(id)`：那条链路读「块拖拽句柄」的 handleRange，
          // 浮窗点击时句柄未激活 → range 为空 → 函数提前 return，命令根本没执行
          // （v10 独立自测 S12f 实测：heading1 点了但块还是 P）。这里与命令菜单
          // `executeCommand` 同口径，直接以**当前选区**走 `this.run()`。
          // Cell conversion excludes container/synced blocks in the source UI.
          const commands = {
            paragraph: ['setParagraph'],
            ...Object.fromEntries(Array.from({ length: 9 }, (_, index) => [`heading${index + 1}`, ['setHeading', { level: index + 1 }]])),
            orderedList: ['toggleOrderedList'],
            bulletList: ['toggleBulletList'],
            taskList: ['toggleTaskList'],
            codeBlock: ['setCodeBlock'],
          }
          const cmd = commands[id]
          if (!cmd) return false
          let applied = false
          try { applied = !!this.run(cmd[0], ...cmd.slice(1)) } catch { applied = false }
          emit(`turninto:${id}`, { applied })
          return applied
        }
        case 'align': {
          const [kind, val] = String(value || '').split(':')
          if (kind === 'align') this.setAlign?.(val)
          else if (kind === 'valign') this.applyCellAlign?.('verticalAlign', val)
          else if (kind === 'indent') this.changeIndent?.(Number(val))
          return true
        }
        case 'highlight': {
          const [kind, ...rest] = String(value || '').split(':')
          const color = rest.join(':')
          if (value === 'highlight:clear') { this.run('unsetColor'); this.run('unsetHighlight') }
          else if (kind === 'color') this.applyTextColor?.(color)
          else if (kind === 'bg') this.applyTextBackground?.(color)
          return true
        }
        case 'more': {
          if (value === 'translate') { emit('translate'); this.$emit?.('ai-request', 'translate') }
          else if (value === 'larkSearch') {
            emit('larkSearch')
            // 走包内真实搜索面板（与 ⌘F / 顶部「查找」同一个入口），不再用 window.find 造效果。
            this.openSearch?.('find')
            if (text) { this.setSearchQuery?.(text); this.scheduleSearchUpdate?.() }
          }
          return true
        }
        case 'remove': {
          // v12：整行 / 整列选区统一走 tableInteractionMixin.deleteSelectedTableLine()，
          // 只读真实 selectedRect 直接 dispatch，不经过 `this.run()` 的 focus 链，
          // 也不再靠 `tableSelectedLine.axis` 猜删行还是删列（用户实测会删掉相邻列）。
          // 局部框选（非完整行列）退回 deleteSelection：CellSelection 会清空单元格内容。
          if (selection instanceof CellSelection && this.deleteSelectedTableLine?.()) return true
          this.run('deleteSelection')
          return true
        }
        case 'distributeColumns': return this.distributeColumns()
        default: emit(`unknown:${id}`); return false
      }
    },
    /**
     * 抛一份宿主可委托监听的 DOM 事件。native host 的 `$emit` 只认识构造时传入的
     * `on{}` 白名单，v10 新增的 `lark-doc-toolbar-action` 不在其中 —— 只 $emit
     * 会让宿主完全收不到，按钮看起来就是死的。
     */
    dispatchToolbarAction(name, detail) {
      try {
        const root = this.$refs?.root
        const target = root || (typeof document !== 'undefined' ? document : null)
        const Ctor = target?.ownerDocument?.defaultView?.CustomEvent
          || (typeof CustomEvent !== 'undefined' ? CustomEvent : null)
        if (!target?.dispatchEvent || !Ctor) return
        target.dispatchEvent(new Ctor(name, { bubbles: true, composed: true, detail }))
      } catch { /* 非 DOM 环境（单测 / SSR）保持静默 */ }
    },
  }
  return { methods }
}
