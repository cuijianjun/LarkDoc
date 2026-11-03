/**
 * commandMenuMixin — 命令菜单（/ 斜杠触发 + plus 插入菜单）的打开、定位、键盘导航与命令执行。
 * 通过 this.editor、this.writable()、this.featureEnabled()、this.savedSelection 等与主组件协作；
 * 会调用 blockHandleMixin 的 closeBlockMenu、tableToolsMixin 的 insertTable、toolbarMenusMixin 的 openLinkDialog。
 * 采用 mixin 而非子组件：菜单模板留在主 SFC，命令执行复用主组件的 run/featureEnabled 管线。
 */
import { TextSelection } from '@tiptap/pm/state'
import { wrapContainerAllowed } from '../../../core/blocks/container-depth'
import { filterCommands, commandFeatureOf } from '../commands'
import { boardProviderOf } from '../../../core/embed/board-diagram'
import { ENTERPRISE_TOOLTIP } from '../../../core/embed/enterprise'
import { isCommandEnabled } from '../larkDocConfig'
import { diagramTypes } from './constants'

export default {
  data() { return {
    menuOpen: false, menuKind: '', menuQuery: '', menuPosition: { left: 20, top: 120 }, menuMaxHeight: '', menuAnchor: null, activeCommandIndex: 0, slashMatch: null, menuTrigger: null,
    // 工具栏「图表」下拉：按类型插入 mermaid 图表块，承接图表的全部插入入口。
    diagramMenuOpen: false, diagramMenuStyle: {}, diagramTypes,
  } },
  computed: {
    filteredCommands() { return filterCommands(this.menuQuery, this.menuKind || 'slash', this.larkDocConfig) },
    activeCommandId() { return this.filteredCommands[this.activeCommandIndex]?.id || '' },
    menuStyle() { return { left: `${this.menuPosition.left}px`, top: `${this.menuPosition.top}px`, ...(this.menuMaxHeight ? { maxHeight: `${this.menuMaxHeight}px` } : {}) } },
  },
  methods: {
    openCommandMenu(kind, event) {
      if (!this.writable() || !this.featureEnabled('insert')) return
      if (this.menuOpen && this.menuKind === kind) { this.closeCommandMenu(true); return }
      this.rememberSelection(kind === 'plus')
      this.menuKind = kind
      this.menuTrigger = event?.currentTarget || null
      this.menuQuery = kind === 'slash' ? this.slashMatch?.query || '' : ''
      this.activeCommandIndex = 0
      const rect = event?.currentTarget?.getBoundingClientRect()
      this.menuAnchor = { left: rect?.left ?? 30, top: rect?.top ?? 90, bottom: rect?.bottom ?? 120 }
      this.menuPosition = { left: Math.max(8, this.menuAnchor.left), top: Math.max(8, this.menuAnchor.bottom + 6) }
      this.menuMaxHeight = ''
      this.menuOpen = true
      this.headingOpen = false
      this.headingStyle = {}
      this.closeBlockMenu()
      this.$nextTick(() => {
        this.positionCommandMenu()
        // plus 菜单打开即可打字：焦点交给搜索框。
        // 阶段 5 批次 3：菜单 DOM 已由 `src/ui/commandMenu.js` 建（不再有子组件实例），
        // 原来靠 `$children.find(name === 'LarkDocCommandMenu')` 摸子组件，现在直接问原生层。
        if (kind === 'plus') this._commandMenuUi?.focusSearch()
      })
    },
    openEmptyBlockInsertMenu(event) {
      if (!this.writable() || !this.handleIsEmptyParagraph) return
      this.closeBlockMenu()
      const cursor = this.handleRange.from + 1
      // Hover opens this menu before the pointer click event; keep the same
      // insertion menu instead of treating that click as a second toggle.
      if (this.menuOpen && this.menuKind === 'plus') {
        this.savedSelection = { from: cursor, to: cursor }
        this.menuTrigger = event?.currentTarget || this.menuTrigger
        const rect = event?.currentTarget?.getBoundingClientRect?.()
        if (rect) this.menuAnchor = { left: rect.left, top: rect.top, bottom: rect.bottom }
        this.$nextTick(() => this.positionCommandMenu())
        return
      }
      this.openCommandMenu('plus', event)
      this.savedSelection = { from: cursor, to: cursor }
    },
    onSlash(match) {
      if (this._isDestroyed) return
      if (!this.featureEnabled('insert')) { this.closeCommandMenu(); return }
      this.slashMatch = match
      if (!match || !this.writable()) { if (this.menuKind === 'slash') this.closeCommandMenu(); return }
      const coords = this.editor.view.coordsAtPos(match.from)
      this.menuKind = 'slash'
      this.menuQuery = match.query
      this.activeCommandIndex = 0
      this.menuAnchor = { left: coords.left, top: coords.top, bottom: coords.bottom }
      this.menuPosition = { left: Math.max(8, coords.left), top: Math.max(8, coords.bottom + 6) }
      this.menuMaxHeight = ''
      this.menuOpen = true
      this.$nextTick(() => this.positionCommandMenu())
    },
    positionCommandMenu() {
      if (!this.menuOpen || !this.menuAnchor) return
      if (this.menuTrigger?.getBoundingClientRect) {
        const triggerRect = this.menuTrigger.getBoundingClientRect()
        this.menuAnchor = { left: triggerRect.left, top: triggerRect.top, bottom: triggerRect.bottom }
      } else if (this.menuKind === 'slash' && this.slashMatch && this.editor) {
        const coords = this.editor.view.coordsAtPos(this.slashMatch.from)
        this.menuAnchor = { left: coords.left, top: coords.top, bottom: coords.bottom }
      }
      // 阶段 5 批次 3：菜单 DOM 由 `src/ui/commandMenu.js` 建、挂在 `commandMenuHost` 里，
      // 仍是 `.lark-doc` 的后代 ⇒ 从根节点查得到（定位只看真实尺寸，不认谁建的节点）。
      const menu = this.$refs.root?.querySelector('.lark-doc-command-menu')
      if (!menu) return
      const margin = 8
      const rect = menu.getBoundingClientRect()
      const viewportSpace = Math.max(40, window.innerHeight - margin * 2)
      const naturalHeight = Math.max(menu.scrollHeight, rect.height)
      const desiredHeight = Math.min(naturalHeight, viewportSpace)
      const below = Math.max(0, window.innerHeight - this.menuAnchor.bottom - margin)
      const above = Math.max(0, this.menuAnchor.top - margin)
      const useAbove = below < desiredHeight && above > below
      const available = useAbove ? above : below
      const maxHeight = Math.max(40, Math.min(desiredHeight, available || viewportSpace))
      const rawTop = useAbove ? this.menuAnchor.top - maxHeight - 6 : this.menuAnchor.bottom + 6
      const top = Math.max(margin, Math.min(window.innerHeight - maxHeight - margin, rawTop))
      const width = Math.min(rect.width || (this.menuKind === 'plus' ? 470 : 280), window.innerWidth - margin * 2)
      const left = Math.max(margin, Math.min(window.innerWidth - width - margin, this.menuAnchor.left))
      this.menuPosition = { left, top }
      this.menuMaxHeight = Math.round(maxHeight)
    },
    closeCommandMenu(restoreFocus = false) {
      this.menuOpen = false
      this.menuKind = ''
      this.menuTrigger = null
      this.menuAnchor = null
      this.menuMaxHeight = ''
      this.slashMatch = null
      if (restoreFocus) {
        // 菜单按钮点击会先夺走焦点；结构命令提交前同步回到编辑器，避免紧接着输入落到 body。
        this.focus()
        this.$nextTick(() => this.focus())
      }
    },
    /**
     * 上下键移动。
     *
     * P5-06：`tier: 'skip'` 的 8 项在菜单里可见（09 §245「没做是可见的取舍」），
     * 但它们不可执行 ⇒ 高亮必须**跳过**它们，否则 Enter 会落在一条永远不动手的项上。
     * 全表都是 skip 时（例如搜「jira」只命中一条）停在原地，交给 `chooseCommand` 出提示。
     */
    moveCommand(step) {
      const items = this.filteredCommands
      const length = items.length
      if (!length) return
      let index = this.activeCommandIndex
      for (let hop = 0; hop < length; hop += 1) {
        index = (index + step + length) % length
        if (items[index].tier !== 'skip') break
      }
      this.activeCommandIndex = index
    },
    onEditorKeydown(event) {
      // P4-01：`@` 面板先接管。两者互斥（onMention 打开时会关掉斜杠菜单），
      // 所以顺序只影响「同一帧谁先看到 ↑↓/Enter」，交给面板就够了。
      if (typeof this.onMentionKeydown === 'function' && this.onMentionKeydown(event)) return
      // P4-02a：日历浮层同样要接管 Esc / Enter（浮层会吃掉这两个键，别让它们穿透到正文）。
      if (typeof this.onReminderKeydown === 'function' && this.onReminderKeydown(event)) return
      if (event.isComposing || this.editor?.view.composing || !this.menuOpen) return
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); this.moveCommand(event.key === 'ArrowDown' ? 1 : -1) } else if (event.key === 'Enter') { event.preventDefault(); this.chooseCommand(this.filteredCommands[this.activeCommandIndex]) } else if (event.key === 'Escape') { event.preventDefault(); this.closeCommandMenu() }
    },
    chooseCommand(item) {
      if (!item || !this.writable()) return
      /**
       * P5-06：skip 项不可执行。菜单里它们本来就 `disabled`（鼠标点不动），
       * 这条拦的是**键盘 Enter**（`CommandMenu` 自己也会挡住，但两条路径都走
       * `chooseCommand`，所以拦在这里才是唯一的关卡）。
       * 出提示而不是静默返回：09 §245 要的是「可见的取舍」，静默等于「点了没反应」。
       */
      if (item.tier === 'skip') {
        this.closeCommandMenu(false)
        this.error = ENTERPRISE_TOOLTIP
        return
      }
      const isSlashTable = this.menuKind === 'slash' && item.id === 'table'
      const isTableSize = item.id === 'table' && item.tableSize
      const isTemplateSelection = item.id === 'template' && !!item.templateId
      // 开浮层 / 开选择器型命令不抢焦点（浮层自己要聚焦输入框）。
      // 🔴 内嵌网页 15 条走 commandFeatureOf 派生，**别**把 15 个 id 手抄进数组：
      // 那会和 EMBED_MENU_ITEMS 形成第二份清单，改一条就漂。
      // 🔴 P4-01 的 mentionUser/mentionChat/mentionPage **故意不**进排除名单：`@` 面板
      // 没有输入框（查询串就是正文里 `@` 后面那截），焦点必须留在正文，用户接着敲字
      // 才能筛候选。放进名单反而会把焦点丢给 body，面板开着却打不进字。
      // 🔴 P4-02a 的 reminder **要**进排除名单：插完 chip 立刻弹日历浮层（02 §19.4 ⑤），
      // 这里若 focus() 一次，浮层会被顶掉。与上面三条 mention 恰好相反 —— 差别在
      // 「mention 的面板要正文焦点才能筛候选，reminder 的浮层自己就是交互面」。
      // 🔴 P4-02b 的 calendar_event 同 reminder：点了要开「插入日程」搜索面板（540×360），
      // 面板里的输入框要自己拿焦点，这里 focus() 一次会把它顶掉。
      // 🔴 P4-04 的 3 个按钮同 calendar_event：点了要开 270×386 的按钮配置面板，
      // 里面「按钮文字」输入框要自己拿焦点。目录导航（`catalogue`）**故意不**进名单 ——
      // 它不弹面板，选完就地插块，焦点该还给编辑器。
      // 🔴 P5-03 的 poll 进名单：它也不弹面板，但焦点要落在**块内**标题 textarea
      // （02 §23 ⑤），交给 `focusPollTitle()` 自己处理；这里若 focus() 一次就前功尽弃。
      const focusAfter = isTemplateSelection || (commandFeatureOf(item.id) !== 'embed' && !['table', 'image', 'file', 'inlineMath', 'blockMath', 'link', 'template', 'ai', 'reminder', 'calendar_event', 'open_link', 'duplicate_page', 'follow_page', 'poll'].includes(item.id))
      if (this.menuKind === 'plus') this.restoreSelection(true)
      if (this.menuKind === 'slash' && this.slashMatch) { const { from, to } = this.slashMatch; const tr = this.editor.state.tr.delete(from, to); tr.setSelection(TextSelection.create(tr.doc, from)); this.editor.view.dispatch(tr); this.savedSelection = null }
      this.closeCommandMenu(focusAfter)
      if (isSlashTable) this.insertTable(3, 3)
      else if (isTableSize) this.insertTable(item.tableSize.rows, item.tableSize.cols)
      else this.executeCommand(item.id, item.templateId)
      if (focusAfter) {
        this.focus()
        this.$nextTick(() => this.focus())
      }
    },
    /** 工具栏「图表」按钮：打开类型下拉（fixed 定位贴按钮下方）。 */
    toggleDiagramMenu() {
      if (!this.writable() || !this.featureEnabled('diagram')) return
      this.diagramMenuOpen = !this.diagramMenuOpen
      this.diagramMenuStyle = {}
      if (this.diagramMenuOpen) this.$nextTick(() => this.positionDiagramMenu())
    },
    closeDiagramMenu() { this.diagramMenuOpen = false; this.diagramMenuStyle = {} },
    positionDiagramMenu() {
      if (!this.diagramMenuOpen) return
      const root = this.$refs.root
      const trigger = root?.querySelector('button[aria-label="图表"]')
      const menu = root?.querySelector('.lark-doc-diagram-menu')
      if (!trigger || !menu) return
      const margin = 8
      const triggerRect = trigger.getBoundingClientRect()
      const menuRect = menu.getBoundingClientRect()
      const maxHeight = Math.max(120, window.innerHeight - triggerRect.bottom - margin * 2)
      const left = Math.max(margin, Math.min(window.innerWidth - menuRect.width - margin, triggerRect.left))
      this.diagramMenuStyle = { top: `${triggerRect.bottom + 6}px`, left: `${left}px`, maxHeight: `${maxHeight}px`, marginTop: '0px' }
    },
    /** 按类型插入 mermaid 图表块；插入菜单「图表」命令也走这里（默认流程图）。 */
    insertDiagramType(typeId) {
      const item = (this.diagramTypes || diagramTypes).find((entry) => entry.id === typeId)
      if (!item || !this.writable() || !this.featureEnabled('diagram')) return
      this.closeDiagramMenu()
      this.run('insertContent', { type: 'codeBlock', attrs: { language: 'mermaid' }, content: [{ type: 'text', text: item.source }] })
    },
    /**
     * 执行一条菜单命令。
     *
     * 注意：`file / sheet / poll / bitable*` 这 11 条已从命令表摘掉（master 上只有块定义、
     * 没有可用的插入链路），所以下面这几个分支从菜单已经走不到 —— 保留是因为块类型本身
     * 还在（老文档正文照旧渲染），走 `doc.commands.setSheet/setPoll/setBitable` 的程序化
     * 调用依然要落块。别再往菜单里加回来，除非把插入链路补完。
     */
    executeCommand(id, templateId = '') {
      if (!this.writable()) return
      const feature = commandFeatureOf(id)
      if (!isCommandEnabled(this.larkDocConfig, id, feature)) return
      if (id === 'paragraph') this.run('setParagraph')
      else if (/^heading[1-9]$/.test(id)) this.run('setHeading', { level: Number(id.slice(-1)) })
      else if (id === 'bulletList') this.run('toggleBulletList')
      else if (id === 'orderedList') this.run('toggleOrderedList')
      else if (id === 'taskList') this.run('toggleTaskList')
      else if (id === 'blockquote') this.run('toggleBlockquote')
      else if (id === 'divider') this.run('setHorizontalRule')
      else if (id === 'details') this.run('setDetails')
      else if (id === 'code') this.run('setCodeBlock')
      else if (id === 'diagram') this.insertDiagramType('flowchart')
      else if (id === 'callout') {
        // P1-05：容器嵌套上限守卫（命令层守卫覆盖不到 insertContent 型入口）。
        const { from, to } = this.editor.state.selection
        if (!wrapContainerAllowed(this.editor.state, from, to, 1)) { this.error = '容器嵌套最多 5 层'; return }
        this.run('insertContent', { type: 'callout', content: [{ type: 'paragraph' }] })
      }
      else if (id === 'columns') this.executeCommand('columns2')
      else if (/^columns[2-5]$/.test(id)) {
        const count = Number(id.slice(-1))
        const { from, to } = this.editor.state.selection
        if (!wrapContainerAllowed(this.editor.state, from, to, 1)) { this.error = '容器嵌套最多 5 层'; return }
        this.run('insertContent', { type: 'columns', content: Array.from({ length: count }, () => ({ type: 'column', attrs: { width: Math.round(100 / count) }, content: [{ type: 'paragraph' }] })) })
      }
      else if (id === 'table') this.tablePicker = true
      else if (id === 'image') this.$refs.imageInput.click()
      // P2-04：视频与文件同一个入口，accept 不限类型（02 L4168：斜杠 file 的 accept 为 null）。
      else if (id === 'file') this.$refs.fileInput.click()
      // P5-02：电子表格**无对话框**（02 §25 ①），直接落默认空表（20 × 8）。
      // 没有 `sheetDialog` / 行列数选择 —— 真飞书也是插完再在块内改，V1 更是只读。
      else if (id === 'sheet') this.run('setSheet')
      // P5-03：投票块同样**无对话框**（02 §23 ⑤「插入 → 不再弹配置面板」），落一张空投票卡，
      // 然后把焦点交给标题 textarea —— 真飞书插完就能直接打字，不用再点一次标题。
      // 它必须同时在 `focusAfter` 排除名单里，否则上面那句 `this.focus()` 会把焦点抢回正文。
      else if (id === 'poll') { this.run('setPoll'); this.focusPollTitle() }
      // P5-04：多维表格 5 项**共用一个块类型**，只有默认视图不同（03 §3.4 ⑤：表格 / 看板 /
      // 甘特图 / 画册 / 关联各插一块，块内能自由切）。命令 id 自己就是视图线索，交给
      // `setBitable` 内部的 `viewOfCommand` 映射，这里不另抄一张表。
      // 无对话框、无块内输入框 ⇒ 不进 `focusAfter` 排除名单，焦点照常回正文（同 sheet）。
      else if (id === 'bitable' || id === 'bitableKanban' || id === 'bitableGantt' || id === 'bitableGallery' || id === 'bitableRefer') this.run('setBitable', id)
      // P5-05：绘图 3 项共用 `cardEmbed` 的**空态引用卡**（V1 没有绘图引擎，见
      // `core/embed/board-diagram.js` 文件头）。只给 `kind` ⇒ 状态自动落 `unbound`，
      // 卡面只剩「绑定」一个动作 —— 这就是验收项「可插入、可绑定 resourceId」。
      // providerId 由 `board-diagram.js` 唯一给出，这里不抄第二张 id 表。
      // 无对话框、无块内输入框 ⇒ 不进 `focusAfter` 排除名单（同 sheet / bitable）。
      else if (boardProviderOf(id)) this.run('setReferenceCard', { kind: boardProviderOf(id) })
      // 阶段 5 批次 4：弹窗已原生化，「打开即聚焦」由 `dialogsUiMixin` 的 `mathDialog`
      // watcher 同步完成 —— 这里不再 `$nextTick` + `querySelector` 找一次输入框。
      else if (id === 'inlineMath' || id === 'blockMath') { this.mathDialog = id; this.mathValue = ''; this.mathError = '' }
      else if (id === 'link') this.openLinkDialog(true)
      // P3-07：15 条内嵌网页命令共用这一个分支（03 §⑫：它们不是二级面板，点了就开 540×164 浮层）。
      // 菜单项只决定浮层里的**文案**；落 iframe 块还是书签卡由粘贴链接的 host 决定（04 §4.3 ⑤.1）。
      else if (commandFeatureOf(id) === 'embed') this.openEmbedDialog(id)
      else if (id === 'template') {
        const template = this.templates.find(item => item.id === templateId)
        if (template) this.run('insertContent', template.html)
        else this.error = '模板不可用，请重新打开模板列表'
      }
      else if (id === 'ai') this.$emit('ai-request', 'rewrite')
      // P4-01：三条 mention 只决定面板默认 tab，正文里补 `@` 之后由插件回调接上
      // （与手敲 `@` 走同一条路，不另造开面板逻辑）。
      else if (id === 'mentionUser' || id === 'mentionChat' || id === 'mentionPage') this.startMention(id)
      // P4-02a：插默认 chip（当前时刻 +24h、分钟归零 → 文案「明天 HH:00」）并立刻弹浮层。
      else if (id === 'reminder') this.startReminder()
      // P4-02b：日程**先开「插入日程」搜索面板**（540×360），选一条才落卡片。
      // 「插入 ≠ 新建」—— 面板里刻意没有「新建日程」入口（02 §26 ⑨），这里也就不能
      // 像 reminder 那样直接往正文塞一个默认块：没有 eventId 的日程卡片是空壳。
      else if (id === 'calendar_event') this.startCalendarEvent()
      // P4-04：3 个按钮共用同一个 `isv` 节点（`kind: 'button'`），命令 id 直接就是 action ——
      // 差异只在面板里「执行操作」那一项的初值，落块后由 NodeView 按 `action` 决定点击行为。
      // 「先弹窗后落块」（02 §22 ⑤-1）：这里只开面板，取消 / Esc 连块都不建。
      else if (id === 'open_link' || id === 'duplicate_page' || id === 'follow_page') this.startIsvButton(id)
      // P4-04：目录导航**不弹面板**，选完就地插目录块（标题树由 NodeView 现算）。
      else if (id === 'catalogue') this.startCatalogue()
      if (id === 'details') {
        let detailsPos = null
        this.editor.state.doc.descendants((node, pos) => { if (detailsPos === null && node.type.name === 'details') detailsPos = pos })
        if (detailsPos !== null) {
          this.editor.commands.setTextSelection(Math.min(this.editor.state.doc.content.size, detailsPos + 2))
          this.editor.commands.focus()
        }
      }
    },
    /**
     * P5-03：把焦点交给刚插入的投票块标题输入框（02 §23 ⑤「插入 → 光标落在标题」）。
     *
     * 不走 `focusAfter` 的原因：那条路只会 `editor.commands.focus()` 把焦点还给**正文**，
     * 而这里要落在一个 NodeView 内部的原生 textarea 上。优先挑 `is-selected` 的那张卡
     * （`selectNode` 会打这个类，插入后正好是选中态），退化取第一张；都没有就静默跳过 ——
     * 焦点抢不到不值得报错。
     */
    focusPollTitle() {
      this.$nextTick(() => {
        const root = this.$refs.root
        if (!root || typeof root.querySelector !== 'function') return
        const box = root.querySelector('.lark-doc-poll.is-selected') || root.querySelector('.lark-doc-poll')
        const input = box && box.querySelector('.lark-doc-poll-title-input')
        if (input && typeof input.focus === 'function') input.focus()
      })
    },
  },
}
