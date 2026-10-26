/**
 * viewModesMixin — 阅读模式 / 演示模式 / 全屏 / 宽度模式 / 大纲 / 折叠 / 字数 / 查找替换等视图级状态。
 * 通过 this.editor、this.error、this.featureEnabled()、this.localTitle 等读写主组件共享状态；
 * 主组件的 watch、lifecycle（refreshDocumentState、onWindowKeydown、fullscreenchange 监听）会调用本组方法。
 * 采用 mixin 而非子组件：模板结构保持不变，依赖 Vue 2 的 data/computed/methods 合并语义。
 */
import { findTextMatches, foldedRange, isPageHeading, replaceText } from '../documentOperations'
import { DOC_MODES, MODE_ICONS, MODE_MENU_WIDTH, MODE_STORAGE_KEY, MODE_TOAST_MS, isDocMode, isEditableTarget, modeFromShortcut, modeMeta, modeToastText } from './docModes'

export default {
  data() { return {
    // P4-06：三态模式（07 §1）。`reading` 不再单独存一个布尔 —— 它由 mode 派生
    // （见 computed.reading），否则「顶栏切到阅读」和「工具栏点阅读模式」会有两个真相。
    mode: 'edit', modeMenuOpen: false, modeMenuPos: null, modeToast: '', modeToastTimer: null,
    slides: false, fullscreen: false, widthMode: 'standard',
    outlineOpen: window.innerWidth > 760, outline: [], outlineCollapsed: new Set(), activeHeading: -1, folded: new Set(), wordCount: 0,
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
    toggleOutline(pos) {
      if (!this.featureEnabled('outline')) return
      const next = new Set(this.outlineCollapsed)
      if (next.has(pos)) next.delete(pos)
      else next.add(pos)
      this.outlineCollapsed = next
    },
    jumpHeading(pos) {
      if (!this.editor) return
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
    updateSearch() { if (!this.editor || !this.featureEnabled('search')) return; this.searchMatches = findTextMatches(this.editor.state.doc, this.searchQuery); this.searchIndex = Math.min(this.searchIndex, Math.max(0, this.searchMatches.length - 1)); if (this.searchMatches.length) { const match = this.searchMatches[this.searchIndex]; this.editor.commands.revealLarkDocMatch(match.from, match.to) } this.editor.commands.setLarkDocSearch(this.searchQuery, this.searchIndex) },
    nextMatch(step) { if (!this.searchMatches.length) return; this.searchIndex = (this.searchIndex + step + this.searchMatches.length) % this.searchMatches.length; const match = this.searchMatches[this.searchIndex]; this.editor.commands.revealLarkDocMatch(match.from, match.to); this.editor.commands.setLarkDocSearch(this.searchQuery, this.searchIndex); this.editor.commands.setTextSelection(match); this.editor.view.domAtPos(match.from).node.parentElement?.scrollIntoView({ block: 'center' }) },
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
    closeSearch() { this.searchOpen = false; this.searchQuery = ''; this.searchMatches = []; this.searchTab = 'find'; this.editor?.commands.setLarkDocSearch(''); this.focus() },
    // P4-06 第 2 条：三态模式切换（07 §1 / §1.1 / §12.1）。入口只有两个 ——
    // 顶栏「编辑」下拉与下面的键位；「更多」菜单里**刻意没有**修订入口（07 §12.1 实测）。
    // 修订态的标记 DOM / 建议面板属于第 3 条，本节只负责把状态切对。
    setMode(id) {
      if (!isDocMode(id) || id === this.mode) { this.modeMenuOpen = false; return }
      this.mode = id
      this.modeMenuOpen = false
      this.persistMode(id)
      this.notifyMode(id)
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
  },
}
