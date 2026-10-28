/**
 * viewModesMixin — 阅读模式 / 演示模式 / 全屏 / 宽度模式 / 大纲 / 折叠 / 字数 / 查找替换等视图级状态。
 * 通过 this.editor、this.error、this.featureEnabled()、this.localTitle 等读写主组件共享状态；
 * 主组件的 watch、lifecycle（refreshDocumentState、onWindowKeydown、fullscreenchange 监听）会调用本组方法。
 * 采用 mixin 而非子组件：模板结构保持不变，依赖 Vue 2 的 data/computed/methods 合并语义。
 */
import { findTextMatches, foldedRange, isPageHeading, replaceText } from '../documentOperations'
import { createTrailingDebounce, SEARCH_DEBOUNCE_MS } from '../../../core/pacing'
import { DOC_MODES, MODE_ICONS, MODE_MENU_WIDTH, MODE_STORAGE_KEY, MODE_TOAST_MS, isDocMode, isEditableTarget, modeFromShortcut, modeMeta, modeToastText } from './docModes'

export default {
  data() { return {
    // P4-06：三态模式（07 §1）。`reading` 不再单独存一个布尔 —— 它由 mode 派生
    // （见 computed.reading），否则「顶栏切到阅读」和「工具栏点阅读模式」会有两个真相。
    mode: 'edit', modeMenuOpen: false, modeMenuPos: null, modeToast: '', modeToastTimer: null,
    slides: false, fullscreen: false, widthMode: 'standard',
    // `outlinePending`：目录是**水合的占位值**时的闸门（见 hydrateOutline）。为 true 时
    // 面板照常显示，但不允许按目录跳转 —— 正文还没灌进去，`pos` 指向的是空文档。
    outlineOpen: window.innerWidth > 760, outline: [], outlinePending: false, outlineCollapsed: new Set(), activeHeading: -1, folded: new Set(), wordCount: 0,
    searchOpen: false, searchQuery: '', replacement: '', searchMatches: [], searchIndex: 0, slideIndex: 0,
    // P4-05 查找替换浮层：tab 决定面板高度（find 186 / replace 286，04 §3.2）；
    // pos 是拖拽后的 fixed 坐标，null 表示用 CSS 默认位（右上角）。
    searchTab: 'find', searchPanelPos: null,
  } },
  computed: {
    // 阅读态的唯一来源。工具栏「阅读模式」按钮、顶栏副标题、effectiveReadonly 都读它，
    // 所以三态切换后这三处自动一致，不用各自同步。
    reading() { return this.mode === 'read' },
    // 顶栏按钮只读这三样：文案、图标、下拉选项。
    modeLabel() { return modeMeta(this.mode).label },
    modeIcon() { return MODE_ICONS[this.mode] || MODE_ICONS.edit },
    modeOptions() { return DOC_MODES },
    // 下拉必须 fixed：`.lark-doc-header-actions` 带 `overflow-x: auto`，
    // absolute 会被裁成不可见（而且会撑出横向滚动条）。坐标由 toggleModeMenu 算。
    modeMenuStyle() {
      const pos = this.modeMenuPos
      if (!pos) return null
      return { left: `${pos.left}px`, top: `${pos.top}px` }
    },
    outlineItems() {
      const hiddenLevels = []
      return this.outline.reduce((items, item, index) => {
        while (hiddenLevels.length && item.level <= hiddenLevels[hiddenLevels.length - 1]) hiddenLevels.pop()
        const next = this.outline[index + 1]
        const hasChildren = Boolean(next && next.level > item.level)
        if (hiddenLevels.length) return items
        const collapsed = this.outlineCollapsed.has(item.pos)
        items.push({ ...item, hasChildren, collapsed })
        if (collapsed && hasChildren) hiddenLevels.push(item.level)
        return items
      }, [])
    },
    slideChapters() {
      if (!this.editor) return [{ title: this.localTitle || '文档', text: '' }]
      const headings = this.outline.filter((item) => item.level === 1)
      if (!headings.length) return [{ title: this.localTitle || '文档', text: this.editor.getText() }]
      return headings.map((item, index) => ({ title: item.text || '章节', text: this.editor.state.doc.textBetween(item.pos, headings[index + 1]?.pos || this.editor.state.doc.content.size).replace(item.text, '').trim() }))
    },
  },
  methods: {
    syncFoldState() {
      if (!this.editor) return
      const current = this.editor.storage.larkDoc?.folded || new Set()
      const next = new Set(current)
      if (next.size === this.folded.size && [...next].every((pos) => this.folded.has(pos))) return
      this.folded = next
    },
    syncOutlineCollapseState() {
      const positions = new Set(this.outline.map((item) => item.pos))
      const next = new Set([...this.outlineCollapsed].filter((pos) => positions.has(pos)))
      if (next.size === this.outlineCollapsed.size && [...next].every((pos) => this.outlineCollapsed.has(pos))) return
      this.outlineCollapsed = next
    },
    /**
     * 早期水合（P7-03）：正文还没灌进编辑器的时候（2,000 块要几十秒），先用落库时算好的
     * 目录把目录面板填上，用户不必对着空面板等。
     *
     * 只有 `validateDerivedSnapshot` 判过「这份快照确实是这份正文的」才会走到这里，
     * 所以 `pos` 直接可用；正文一到位，`refreshDocumentState()` 立刻用实测值覆盖。
     * 这里**不做**「已经实测过就拒绝」的闸门 —— 恢复快照时正文本来就在，拒绝会让那条路
     * 永远享受不到。判伪的责任在校验器，不在这里。
     *
     * 水合期间 `outlinePending` 置 true：面板能看、不能跳（跳转会作用在还没有正文的编辑器上，
     * 轻则跳到文末、重则 `domAtPos` 越界抛错）。正文一到位 `refreshDocumentState()`
     * 用实测目录覆盖，闸门随之落下 —— 清除点就放在那里，不再需要调用方记得回调。
     */
    hydrateOutline(outline) {
      if (!Array.isArray(outline) || !outline.length) return false
      this.outline = outline.map((item) => ({ pos: item.pos, level: item.level, text: item.text }))
      this.outlinePending = true
      return true
    },
    toggleOutline(pos) {
      if (!this.featureEnabled('outline')) return
      const next = new Set(this.outlineCollapsed)
      if (next.has(pos)) next.delete(pos)
      else next.add(pos)
      this.outlineCollapsed = next
    },
    jumpHeading(pos) {
      // 占位目录（水合期）+ 越界 pos 都不跳：这两种情况下 doc 里根本没有那个标题，
      // 往下走会把选区丢到文末，还可能让 `domAtPos` 抛 RangeError。
      if (!this.editor || this.outlinePending) return
      if (!Number.isFinite(pos) || pos < 0 || pos >= this.editor.state.doc.content.size) return
      // 13.6.1：目标标题被祖先章节折叠时，先展开所有正文祖先再定位；
      // 目标自身的折叠位不动（不自动展开它的子章节）。
      const state = this.editor.state
      const folded = this.editor.storage.larkDoc?.folded
      if (folded && folded.size) {
        const ancestors = []
        state.doc.descendants((node, at) => {
          const foldId = node.attrs && node.attrs.blockId
          if (node.type.name !== 'heading' || !isPageHeading(state.doc, at) || !foldId || !folded.has(foldId) || at >= pos) return
          const range = foldedRange(state.doc, at)
          if (range && pos > at && pos < range.to) ancestors.push(at)
        })
        ancestors.forEach((at) => this.editor.commands.toggleLarkDocFold(at))
      }
      this.editor.commands.setTextSelection(Math.min(pos + 1, this.editor.state.doc.content.size))
      const node = this.editor.view.nodeDOM(pos)
      const target = node instanceof Element ? node : this.editor.view.domAtPos(pos + 1).node.parentElement
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      this.activeHeading = pos
    },
    /**
     * 重算命中并刷新高亮（P7-04）。
     *
     * 三个入口（输入框逐字符、编辑后重搜、替换后）都汇到这里，但**逐字符与编辑后
     * 重搜必须先走 `scheduleSearchUpdate()` 去抖** —— 一次 `updateSearch` 是
     * 「全量扫文档 + 两次 transaction」，2,000 块正文上单次就是几十毫秒，
     * 而每个字符、每次按键都会触发它。
     *
     * 幂等短路：文档对象与查询词都没变时直接返回。`setLarkDocSearch` /
     * `revealLarkDocMatch` 各发一个 transaction，而每个 transaction 都会连带
     * 折叠同步、句柄遮罩、表格裁剪整圈重测 —— 不值得为一个「什么都没变」重跑。
     */
    updateSearch() {
      if (!this.editor || !this.featureEnabled('search')) return
      const doc = this.editor.state.doc
      const signature = `${this.searchQuery}\u0000${this.searchIndex}`
      if (this._searchDoc === doc && this._searchSignature === signature) return
      this.searchMatches = findTextMatches(doc, this.searchQuery)
      // clamp 之后再落签名：否则签名记的是 clamp 前的 index，下一次同样输入的
      // updateSearch 会被判成「变了」而白跑一轮全量扫描。
      this.searchIndex = Math.min(this.searchIndex, Math.max(0, this.searchMatches.length - 1))
      this._searchDoc = doc
      this._searchSignature = `${this.searchQuery}\u0000${this.searchIndex}`
      if (this.searchMatches.length) {
        const match = this.searchMatches[this.searchIndex]
        this.editor.commands.revealLarkDocMatch(match.from, match.to)
      }
      this.editor.commands.setLarkDocSearch(this.searchQuery, this.searchIndex)
    },
    /** 去抖入口：连续输入 / 连续编辑只留最后一次。`$timers` 是单测注入的假时钟。 */
    scheduleSearchUpdate() {
      if (!this.editor || !this.featureEnabled('search')) return
      if (!this._searchDebounce) {
        this._searchDebounce = createTrailingDebounce({ delay: SEARCH_DEBOUNCE_MS, timers: this.$timers })
      }
      this._searchDebounce.schedule(() => this.updateSearch())
    },
    /** 需要「当前输入的命中」时先落地待办（输入后立刻按 Enter 就是这种场景）。 */
    flushSearchUpdate() { if (this._searchDebounce) this._searchDebounce.flush() },
    nextMatch(step) {
      // 输入框刚改完、去抖还没到点就按了 Enter：先把待办 flush 掉，
      // 否则跳的是上一轮命中的位置。
      this.flushSearchUpdate()
      if (!this.searchMatches.length) return
      this.searchIndex = (this.searchIndex + step + this.searchMatches.length) % this.searchMatches.length
      const match = this.searchMatches[this.searchIndex]
      this.editor.commands.revealLarkDocMatch(match.from, match.to)
      this.editor.commands.setLarkDocSearch(this.searchQuery, this.searchIndex)
      this.editor.commands.setTextSelection(match)
      this.editor.view.domAtPos(match.from).node.parentElement?.scrollIntoView({ block: 'center' })
    },
    replace(all) {
      if (!this.writable() || !this.searchQuery) return
      if (all) { replaceText(this.editor, this.searchQuery, this.replacement, true) } else {
        const match = this.searchMatches[this.searchIndex]
        if (!match) return
        const tr = this.editor.state.tr
        const marks = tr.doc.resolve(match.from).marks()
        if (this.replacement) tr.replaceWith(match.from, match.to, this.editor.schema.text(this.replacement, marks))
        else tr.delete(match.from, match.to)
        this.editor.view.dispatch(tr)
      }
      this.updateSearch()
    },
    // P4-05：关闭时把 tab 归位到「查找」（下次打开不带上次痕迹），拖拽位置刻意保留。
    closeSearch() {
      this.searchOpen = false; this.searchQuery = ''; this.searchMatches = []; this.searchTab = 'find'
      // 挂起的去抖必须取消：否则关面板 120ms 后还会拿空查询再全量扫一遍文档。
      if (this._searchDebounce) this._searchDebounce.cancel()
      this._searchDoc = null; this._searchSignature = ''
      this.editor?.commands.setLarkDocSearch('')
      this.focus()
    },
    // P4-06 第 2 条：三态模式切换（07 §1 / §1.1 / §12.1）。入口只有两个 ——
    // 顶栏「编辑」下拉与下面的键位；「更多」菜单里**刻意没有**修订入口（07 §12.1 实测）。
    // 修订态的标记 DOM / 建议面板属于第 3 条，本节只负责把状态切对。
    setMode(id) {
      if (!isDocMode(id) || id === this.mode) { this.modeMenuOpen = false; return }
      this.mode = id
      this.modeMenuOpen = false
      this.persistMode(id)
      this.notifyMode(id)
      // 修订态开关**不重建编辑器**：只翻 tracker 的 `storage.active`。重建会丢选区、
      // 折叠与 undo 栈；guard 一下是为了让单测能单独挂本 mixin（没有 revisionMixin 时跳过）。
      if (typeof this.syncRevisionTracking === 'function') this.syncRevisionTracking()
    },
    // 下拉开合 + 定位。按钮右缘对齐菜单右缘（菜单 180 宽），top = 按钮底边 + 2
    // （+2 沿用 headingNumberMixin 的菜单贴合口径），左右夹在视口内防溢出。
    toggleModeMenu(anchor) {
      if (this.modeMenuOpen) { this.modeMenuOpen = false; return }
      const rect = anchor && typeof anchor.getBoundingClientRect === 'function' ? anchor.getBoundingClientRect() : null
      if (rect) {
        const gap = 8
        const left = Math.min(Math.max(gap, rect.right - MODE_MENU_WIDTH), Math.max(gap, window.innerWidth - MODE_MENU_WIDTH - gap))
        this.modeMenuPos = { left: Math.round(left), top: Math.round(rect.bottom + 2) }
      }
      this.modeMenuOpen = true
    },
    closeModeMenu() { this.modeMenuOpen = false },
    // 刷新 / 重新打开后保持（07 §1.1）。三闸门写法同 foldPersistMixin：
    // 拿不到 window（Node 单测）、隐私模式禁写都静默降级成「本会话有效」，不打断初始化。
    persistMode(id) {
      try { window.localStorage.setItem(MODE_STORAGE_KEY, id) } catch (_) { /* 静默降级：模式仅本会话有效 */ }
    },
    restoreMode() {
      let saved = ''
      try { saved = window.localStorage.getItem(MODE_STORAGE_KEY) || '' } catch (_) { saved = '' }
      if (isDocMode(saved)) this.mode = saved
    },
    // 「已切换为 X 模式」走顶部中性提示条（07 §1.1 文案 + 06 §6.2 位置/层级），
    // 存活时长取 07 §10 ② 实测 toast 的 3302ms。
    notifyMode(id) {
      this.modeToast = modeToastText(id)
      if (this.modeToastTimer) clearTimeout(this.modeToastTimer)
      this.modeToastTimer = setTimeout(() => { this.modeToast = ''; this.modeToastTimer = null }, MODE_TOAST_MS)
    },
    // 键位入口：返回 true 表示已消费，调用方直接 return，不再进其它分支
    // （现有 ⌘+F / ⌘+Shift+H / ⌘+/ 那条分支排斥 alt，模式键带 alt，两者不交叉）。
    applyModeShortcut(event) {
      const id = modeFromShortcut(event, isEditableTarget(event && event.target))
      if (!id) return false
      event.preventDefault()
      this.setMode(id)
      return true
    },
    // 工具栏「阅读模式」按钮是二态入口：进阅读 / 退回编辑。三态靠顶栏下拉区分「修订」。
    toggleReading() { this.setMode(this.reading ? 'edit' : 'read') },
    // P0-03：模板级赋值收敛为方法——拆出的子组件模板经 ed. 调用，避免 vue/no-mutating-props。
    toggleSearchOpen() { this.searchOpen = !this.searchOpen },
    // P4-05：⌘+F / ⌘+Shift+H / 工具栏入口统一走这里。已开时只切 tab 并回焦输入框
    // （面板是常驻浮层，不销毁重建，所以 mounted 的聚焦不会再来一次）。
    openSearch(tab) {
      if (!this.featureEnabled('search')) return
      this.searchTab = tab === 'replace' ? 'replace' : 'find'
      if (!this.searchOpen) { this.searchOpen = true; return }
      this.$nextTick(() => { const panel = this.$refs.searchInput; if (panel && panel.focus) panel.focus() })
    },
    setSearchTab(tab) { this.searchTab = tab === 'replace' ? 'replace' : 'find' },
    setSearchPanelPos(pos) { this.searchPanelPos = pos },
    toggleOutlineOpen() { this.outlineOpen = !this.outlineOpen },
    toggleHelpOpen() { this.helpOpen = !this.helpOpen },
    setWidthMode(v) { this.widthMode = v },
    setSearchQuery(v) { this.searchQuery = v },
    setReplacement(v) { this.replacement = v },
    async toggleFullscreen() { if (!this.fullscreen) { try { await this.$refs.root.requestFullscreen() } catch (_) { this.fullscreen = true } } else if (document.fullscreenElement) await document.exitFullscreen(); else this.fullscreen = false },
    onFullscreenChange() { this.fullscreen = document.fullscreenElement === this.$refs.root },
    toggleSlides() { this.slides = !this.slides; this.slideIndex = 0 },
    prevSlide() { this.slideIndex -= 1 },
    nextSlide() { this.slideIndex += 1 },
  },
  // 提示条定时器必须在卸载前清掉：单页应用里反复挂载/卸载编辑器，
  // 残留的 setTimeout 会在实例销毁后写 `this.modeToast`。
  beforeDestroy() {
    if (this.modeToastTimer) { clearTimeout(this.modeToastTimer); this.modeToastTimer = null }
    // 查找去抖同理：卸载后不许再有回调去摸 editor。
    if (this._searchDebounce) { this._searchDebounce.dispose(); this._searchDebounce = null }
  },
}
