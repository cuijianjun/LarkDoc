/**
 * toolbarCollapseMixin — 工具栏自适应分组折叠。
 *
 * 策略：按「实际测量宽度」而非按钮个数决定形态——
 * 1. 全组平铺放得下时维持现状（依次排列）；
 * 2. 放不下时按 TOOLBAR_COLLAPSE_ORDER（低优先级先收）整组收进「更多 ▾」弹层，
 *    每收一组测一次，直到放下；「更多」弹层按组分节展示收纳组内的全部功能；
 * 3. 宽度恢复时逆序还原（每次试探一组，放不下即停）。
 * 「更多」弹层与内联按钮共用同一套 this.xxx 方法（见 toolbarSections computed），
 * 行为完全一致；该分组结构同时为移动端「底部栏 + 更多 sheet」提供数据基础。
 */
import { diagramTypes } from './constants'

/** 收纳优先序：靠前的组先收进「更多」（核心的文本格式/历史最后收）。 */
const TOOLBAR_COLLAPSE_ORDER = ['toolsEnd', 'insert', 'blockStyle', 'textStyle', 'marks', 'headings', 'history']

export default {
  data() {
    return {
      // 已收纳进「更多」的分组 id 列表（顺序 = 收纳顺序）。
      collapsedGroups: [],
      moreMenuOpen: false, moreMenuStyle: {},
    }
  },
  computed: {
    /** 「更多」弹层全部分节定义：id 对应内联分组，items 与内联按钮同一套方法。 */
    toolbarSections() {
      const ro = this.effectiveReadonly
      const sections = []
      if (this.toolbarEnabled('history')) {
        sections.push({ id: 'history', title: '历史', items: [
          { label: '撤销', disabled: ro, run: () => this.run('undo') },
          { label: '重做', disabled: ro, run: () => this.run('redo') },
        ] })
      }
      if (this.toolbarEnabled('headings')) {
        const names = '一二三四五六七八九'
        sections.push({ id: 'headings', title: '标题级别', items: [
          { label: '正文', disabled: ro, run: () => this.setHeading(0) },
        ].concat(Array.from({ length: 9 }, (_, index) => ({ label: `${names[index]}级标题`, disabled: ro, run: () => this.setHeading(index + 1) }))) })
      }
      if (this.toolbarEnabled('marks') && this.visibleMarks.length) {
        sections.push({ id: 'marks', title: '格式', items: this.visibleMarks.map((item) => ({
          label: item.label, disabled: ro, checked: this.isActive(item.id), run: () => this.toggleMark(item.id),
        })) })
      }
      if (this.toolbarEnabled('textStyle')) {
        const items = [{ label: '设置链接…', disabled: ro || !this.hasTextSelection, run: () => this.openLinkDialog() }]
        this.fontFamilyOptions.filter((option) => option.value).forEach((option) => items.push({
          label: option.label, disabled: ro, checked: this.appliedTextStyle.fontFamily === option.value,
          run: () => this.applyTextStyle('fontFamily', option.value),
        }))
        this.fontSizeOptions.filter((option) => option.value).forEach((option) => items.push({
          label: `字号 ${option.label}`, disabled: ro, checked: this.appliedTextStyle.fontSize === option.value,
          run: () => this.applyTextStyle('fontSize', option.value),
        }))
        items.push(
          { label: '字色…', disabled: ro, run: (event) => this.toggleColorPalette('textColor', event) },
          { label: '背景色…', disabled: ro, run: (event) => this.toggleColorPalette('textBackground', event) },
        )
        sections.push({ id: 'textStyle', title: '文本样式', items })
      }
      if (this.toolbarEnabled('blockStyle')) {
        sections.push({ id: 'blockStyle', title: '段落', items: this.lineHeightOptions.filter((option) => option.value).map((option) => ({
          label: `行高 ${option.label}`, disabled: ro, checked: this.appliedTextStyle.lineHeight === option.value,
          run: () => this.applyLineHeight(option.value),
        })).concat([
          { label: '减少缩进', disabled: ro, run: () => this.changeIndent(-1) },
          { label: '增加缩进', disabled: ro, run: () => this.changeIndent(1) },
          { label: '清除格式', disabled: ro, run: () => this.clearFormatting() },
        ]) })
      }
      const insertItems = []
      if (this.toolbarEnabled('insert')) insertItems.push({ label: '插入内容…', disabled: ro, run: (event) => this.openCommandMenu('plus', event) })
      if (this.toolbarEnabled('tables')) insertItems.push({
        label: this.isActive('table') ? '表格工具' : '插入表格', disabled: ro,
        run: () => { if (this.isActive('table')) this.tableToolsOpen = !this.tableToolsOpen; else this.tablePicker = true },
      })
      if (this.toolbarEnabled('insert') && this.larkDocConfig.features.diagram) {
        diagramTypes.forEach((type) => insertItems.push({ label: `图表 · ${type.label}`, disabled: ro, run: () => this.insertDiagramType(type.id) }))
      }
      if (this.toolbarEnabled('ai')) insertItems.push({ label: 'AI 助手', disabled: ro, run: () => this.$emit('ai-request', 'rewrite') })
      if (insertItems.length) sections.push({ id: 'insert', title: '插入', items: insertItems })
      const toolItems = []
      if (this.toolbarEnabled('search')) toolItems.push({ label: '查找', run: () => { this.searchOpen = !this.searchOpen; this.$nextTick(() => this.focusSearchPanel()) } })
      if (this.toolbarEnabled('outline')) toolItems.push({ label: '目录', checked: this.outlineOpen, run: () => { this.outlineOpen = !this.outlineOpen } })
      if (this.toolbarEnabled('viewModes')) {
        this.widthModeOptions.forEach((option) => toolItems.push({ label: option.label, checked: this.widthMode === option.value, run: () => { this.widthMode = option.value } }))
        toolItems.push(
          { label: this.reading ? '退出阅读' : '阅读模式', run: () => this.toggleReading() },
          { label: this.fullscreen ? '退出全屏' : '全屏', run: () => this.toggleFullscreen() },
          { label: this.slides ? '退出演示' : '演示模式', run: () => this.toggleSlides() },
        )
      }
      if (this.toolbarEnabled('shortcuts')) toolItems.push({ label: '快捷键帮助', run: () => { this.helpOpen = !this.helpOpen } })
      if (!this.larkDocConfig.layout.headerVisible && this.$slots['header-actions']) toolItems.push({ label: '文档操作…', run: (event) => this.openHeaderMenuFrom(event) })
      if (toolItems.length) sections.push({ id: 'toolsEnd', title: '视图与工具', items: toolItems })
      return sections
    },
    /** 当前被收纳组的分节（「更多」弹层渲染用）。 */
    visibleToolbarSections() {
      return this.toolbarSections.filter((section) => this.collapsedGroups.includes(section.id))
    },
  },
  mounted() {
    // 阶段 5 批次 2 起工具栏 DOM 由 `toolbarUiMixin.mountToolbarBar()` 在**组件自身的**
    // `mounted` 里创建，而 mixin 的 `mounted` 早于它 —— 这里直接查节点一定是 null。
    // 所以推一帧：那时工具栏已在 DOM 里（`mountToolbarBar` 也会再调一次本方法，幂等）。
    this.$nextTick(() => { this.attachToolbarResizeObserver(); this.evaluateToolbarFit() })
  },
  beforeDestroy() {
    if (this._toolbarRO) { this._toolbarRO.disconnect(); this._toolbarRO = null }
    if (this._fitRaf) cancelAnimationFrame(this._fitRaf)
    this.teardownMoreMenu()
  },
  methods: {
    isGroupCollapsed(id) { return this.collapsedGroups.includes(id) },
    /** 给工具栏节点挂 ResizeObserver（幂等：已挂过就直接返回）。 */
    attachToolbarResizeObserver() {
      if (this._toolbarRO) return
      const bar = this.$refs.root && this.$refs.root.querySelector('.lark-doc-toolbar')
      if (!bar || typeof ResizeObserver === 'undefined') return
      this._toolbarRO = new ResizeObserver(() => this.scheduleToolbarFit())
      this._toolbarRO.observe(bar)
    },
    scheduleToolbarFit() {
      if (this._fitRaf) cancelAnimationFrame(this._fitRaf)
      this._fitRaf = requestAnimationFrame(() => { this._fitRaf = null; this.evaluateToolbarFit() })
    },
    async evaluateToolbarFit() {
      if (this._fitRunning) { this._fitPending = true; return }
      this._fitRunning = true
      try {
        const bar = this.$refs.root && this.$refs.root.querySelector('.lark-doc-toolbar')
        if (!bar) return
        const overflow = () => bar.scrollWidth > bar.clientWidth + 1
        let guard = 0
        // 收纳：溢出时按优先序收组，直到放下或全收。
        while (overflow() && this.collapsedGroups.length < TOOLBAR_COLLAPSE_ORDER.length && guard++ < 12) {
          const next = TOOLBAR_COLLAPSE_ORDER.find((id) => !this.collapsedGroups.includes(id))
          if (!next) break
          this.collapsedGroups.push(next)
          await this.$nextTick()
        }
        // 展开：有余量时逆序还原一组试探，放不下即放回并停止。
        guard = 0
        while (this.collapsedGroups.length && !overflow() && guard++ < 12) {
          const last = this.collapsedGroups.pop()
          await this.$nextTick()
          if (overflow()) { this.collapsedGroups.push(last); await this.$nextTick(); break }
        }
      } finally {
        this._fitRunning = false
        if (this._fitPending) { this._fitPending = false; this.evaluateToolbarFit() }
      }
    },
    toggleMoreMenu() {
      this.moreMenuOpen = !this.moreMenuOpen
      if (this.moreMenuOpen) {
        this.$nextTick(() => this.positionMoreMenu())
        document.addEventListener('pointerdown', this.onMoreMenuOutside, true)
        document.addEventListener('keydown', this.onMoreMenuKeydown, true)
      } else this.teardownMoreMenu()
    },
    openMoreMenuOnHover() {
      this.cancelPopupHoverClose()
      if (!this.moreMenuOpen) { this._moreHoverOpened = true; this.toggleMoreMenu() }
    },
    scheduleMoreMenuClose() { this.schedulePopupHoverClose(() => { this._moreHoverOpened = false; this.closeMoreMenu() }) },
    // hover 已打开时点击不关闭（飞书行为：hover 弹窗靠移开鼠标关闭）。
    toggleMoreMenuGuarded() { if (this._moreHoverOpened && this.moreMenuOpen) return; this.toggleMoreMenu() },
    positionMoreMenu() {
      if (!this.moreMenuOpen) return
      const trigger = this.$refs.root && this.$refs.root.querySelector('button[aria-label="更多"]')
      if (!trigger) return
      const margin = 8
      const rect = trigger.getBoundingClientRect()
      const maxHeight = Math.max(120, window.innerHeight - rect.bottom - margin * 2)
      const right = Math.max(margin, window.innerWidth - rect.right)
      this.moreMenuStyle = { top: `${rect.bottom + 6}px`, right: `${right}px`, left: 'auto', width: '200px', maxHeight: `${maxHeight}px`, marginTop: '0px' }
    },
    closeMoreMenu() {
      if (!this.moreMenuOpen) return
      this.moreMenuOpen = false
      this.moreMenuStyle = {}
      this.teardownMoreMenu()
    },
    teardownMoreMenu() {
      document.removeEventListener('pointerdown', this.onMoreMenuOutside, true)
      document.removeEventListener('keydown', this.onMoreMenuKeydown, true)
    },
    onMoreMenuOutside(event) {
      const root = this.$refs.root
      if (root && root.contains(event.target)) {
        // 点击弹层内部或「更多」触发按钮本身不关闭（触发按钮的 click 负责切换）。
        if (event.target.closest?.('.lark-doc-more-menu')) return
        if (event.target.closest?.('button[aria-label="更多"]')) return
      }
      this.closeMoreMenu()
    },
    onMoreMenuKeydown(event) {
      if (event.key === 'Escape') { event.stopPropagation(); this.closeMoreMenu() }
    },
    /** 执行「更多」弹层菜单项：先缓存点击位置（供颜色盘/插入菜单定位），关弹层再执行。 */
    runMoreItem(item, event) {
      const rect = event && event.currentTarget ? event.currentTarget.getBoundingClientRect() : null
      const anchor = rect ? { currentTarget: { getBoundingClientRect: () => rect } } : null
      this.closeMoreMenu()
      item.run(anchor)
    },
  },
}
