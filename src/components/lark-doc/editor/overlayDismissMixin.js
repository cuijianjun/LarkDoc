/**
 * 全局浮层消解（P0-03 持续瘦身：从 LarkDocEditor.vue 原样下沉，逻辑零改动）。
 *
 * 一个界面上同时可能有 17 个浮层（命令菜单 / 块菜单 / 颜色面板 / 表格选择器 /
 * 帮助 / 标题下拉 / 文档操作 / 图表 / 气泡对齐 / 气泡标题 / callout 表情 /
 * 表格工具 / 搜索 / 编号菜单 / 链接·公式·表情弹窗 / 日期提醒日历 / 日程搜索面板），它们的关闭入口只有三个：
 *   1. 点外部（`onDocumentPointerDown`，capture 阶段绑在 document 上）；
 *   2. `Esc`（`onWindowKeydown`）；
 *   3. 显式调 `closeOverlay()`（弹窗背板点击、Esc 键、宿主主动收起都走它）。
 *
 * 三个入口必须放在一处：历史上它们散在组件里时出现过「新增浮层只加了两处、
 * Esc 关不掉」的问题（P3-07 的内嵌网页浮层正好是 Esc 故意不关的例外）。
 *
 * 🔴 `closeOverlay` 的 `else if` 链是**互斥**的：一次只收一层，末尾才 `focus()`。
 * 改成并列 `if` 会让「关菜单」顺手把别的浮层也清掉，并且 focus 抢在弹窗之前。
 */
export default {
  methods: {
    /**
     * 点外部关闭。用 `closest?.()` 而不是 `contains()`：浮层多挂在 body 上的
     * teleport 容器里（不在 `$refs.root` 里），`contains` 判断会反过来把
     * 点击浮层自身当成「点外部」。`?.` 是因为合成事件（测试里的 dispatchEvent）
     * 可能没有 closest 方法。
     */
    onDocumentPointerDown(event) {
      const target = event.target
      if (this.menuOpen && !target.closest?.('.lark-doc-command-menu') && target !== this.menuTrigger && !this.menuTrigger?.contains(target)) this.closeCommandMenu()
      // P4-01：`@` 面板的常规关闭由选区变化驱动（document.js 回调 onMention(null)），
      // 这里只补那种「不换选区」的点击：工具栏 / 页眉 / 页边空白。点回正文不拦，
      // 否则「点正文某处落光标」会先被收掉面板、再靠重算开回来，闪一下。
      if (this.mentionOpen && !target.closest?.('.lark-doc-mention-panel') && !target.closest?.('.ProseMirror')) this.closeMentionPanel()
      // P4-02a：日期提醒浮层的常规关闭由「Esc / 打字 / 选日选时」驱动，这里只补「点外部」。
      // 点浮层自身、时间下拉、chip 都不拦 —— 点 chip 要留给 `onReminderChipClick` 重开/切换。
      if (this.reminderOpen && !target.closest?.('.lark-doc-reminder-popover') && !target.closest?.('.lark-doc-reminder-times') && !target.closest?.('.lark-doc-reminder-chip')) this.closeReminderPopover()
      // P4-02b 日程搜索面板：02 §26 ⑦ 实测 `Esc` ×1、×2 全无效 ⇒ **不绑 Esc**，
      // 所以下面 `onWindowKeydown` 和 `closeOverlay` 里都刻意没有它的分支
      // （根元素那句 `@keydown.esc="closeOverlay"` 会冒泡上来，链里一加就等于给了 Esc 入口）。
      // 点外部是它唯一的全局关闭点；另一半由输入框 `@blur` 兜（`calendarMixin.onCalendarBlur`）。
      if (this.calendarOpen && !target.closest?.('.lark-doc-calendar-search')) this.closeCalendarSearch()
      // P4-04 按钮配置面板：与日历面板**相反**——02 §22 ⑤-1 实测「取消 / Esc 都关」，
      // 所以它在下面的 `onWindowKeydown` 与 `closeOverlay` 里都有分支（日历两者都没有）。
      // 点外部同样生效，且只有这三个入口：面板自身、它的下拉、色板都在 `.lark-doc-isv-overlay` 内。
      if (this.isvPanelOpen && !target.closest?.('.lark-doc-isv-overlay')) this.closeIsvPanel()
      if (this.blockMenuOpen && !target.closest?.('.lark-doc-block-menu') && !target.closest?.('.lark-doc-block-handle')) this.closeBlockMenu()
      if (this.blockTypeMenuOpen && !target.closest?.('.lark-doc-block-type-menu') && !target.closest?.('.lark-doc-block-handle')) this.blockTypeMenuOpen = false
      if (this.blockAlignMenuOpen && !target.closest?.('.lark-doc-block-menu') && !target.closest?.('.lark-doc-block-handle')) this.closeBlockMenu()
      if (this.blockColorMenuOpen && !target.closest?.('.lark-doc-block-menu') && !target.closest?.('.lark-doc-block-handle')) this.closeBlockMenu()
      if (this.bubbleAlignOpen && !target.closest?.('.lark-doc-bubble-align') && !target.closest?.('.lark-doc-bubble-align-menu')) this.closeBubbleAlignMenu()
      if (this.bubbleHeadingOpen && !target.closest?.('.lark-doc-bubble-heading')) this.closeBubbleHeadingMenu()
      if (this.calloutEmojiOpen && !target.closest?.('.lark-doc-callout-tools')) this.closeCalloutEmoji()
      if (this.colorPaletteOpen && !target.closest?.('.lark-doc-color-palette') && !target.closest?.('.lark-doc-color')) this.colorPaletteOpen = ''
      if (this.headerMenuOpen && !target.closest?.('.lark-doc-header-menu') && !target.closest?.('button[aria-label="文档操作"]')) this.closeHeaderMenu()
      if (this.diagramMenuOpen && !target.closest?.('.lark-doc-diagram-menu') && !target.closest?.('button[aria-label="图表"]')) this.closeDiagramMenu()
      // 编号菜单点外部关闭；但点在编号按钮自己身上要留给它的 click 处理（重新定位/切换）。
      // 标题编号和列表序号共用这套菜单，两个锚点都要排除。
      // 正在输入编号值时，点外部按「提交」算（飞书同款），否则用户输完点开别处会丢值。
      if (this.headingNumberMenu.open && !target.closest?.('.lark-doc-heading-number-menu') && !target.closest?.('.lark-doc-heading-number') && !target.closest?.('.lark-doc-list-number')) {
        if (this.headingNumberEditing) this.applyHeadingNumberValue()
        else this.closeHeadingNumberMenu()
      }
      // P3-07 内嵌网页浮层：只认「点外部」和「点 ×」两个关闭入口 ——
      // Esc 故意不管它（04 §4.3 ⑤ 实测 Esc ×1、×2 都关不掉），所以下面 onWindowKeydown
      // 和 closeOverlay 里都没有它的分支，这里就是它唯一的全局关闭点。
      if (this.embedDialog && !target.closest?.('.lark-doc-embed-dialog')) this.closeEmbedDialog()
      // P4-06 模式下拉不在这里：它是共享下拉原语（`ui/select.js`）的实例，
      // 「外部 pointerdown 关」由原语自己挂在 document 上，别再判一遍（两处会抢着关）。
      if (!this.$refs.root?.contains(target)) {
        this.headingOpen = false
        this.headingStyle = {}
        this.tableToolsOpen = false
      }
    },
    /** 全局 Esc。演示模式（`slides`）下额外接管左右方向键翻页；另外接管 ⌘+F / ⌘+Shift+H / ⌘+/ 与模式键位。 */
    onWindowKeydown(event) {
      // P4-06：模式键位（⌘/Ctrl+⌥+E·X·V 与裸 E，07 §12.1）先过一遍。放在最前面是因为
      // 它们**带 alt**，下面的 ⌘+F 分支明确排斥 alt，两组不会互相抢键；
      // 裸 E 的「焦点不在输入区」闸门由 applyModeShortcut 内部判（否则正文打 e 会切模式）。
      if (this.applyModeShortcut(event)) return
      // P4-05：⌘+F 开「查找」、⌘+Shift+H 开「替换」（04 §3.2 实测键位）。必须 preventDefault，
      // 否则浏览器原生查找条会压在浮层上。Ctrl 一并认（Windows/Linux 同键位）。
      if ((event.metaKey || event.ctrlKey) && !event.altKey) {
        const key = (event.key || '').toLowerCase()
        if (key === 'f' && !event.shiftKey) { event.preventDefault(); this.openSearch('find'); return }
        if (key === 'h' && event.shiftKey) { event.preventDefault(); this.openSearch('replace'); return }
        // P4-06：⌘+/ 开快捷键抽屉（04 §3.5 入口 2、07 §7 键位表）。同样要 preventDefault，
        // 否则 Firefox 会弹「快速查找」、部分输入法会把 / 打进正文。
        if (key === '/') { event.preventDefault(); this.toggleHelpOpen(); return }
      }
      if (event.key === 'Escape' && this.headingNumberMenu.open) this.closeHeadingNumberMenu({ restoreFocus: true })
      // P4-04：按钮配置面板 Esc 可关（02 §22 ⑤-1），关了就不建块 —— 与「日程面板 Esc 无效」相反。
      else if (event.key === 'Escape' && this.isvPanelOpen) this.closeIsvPanel()
      else if (event.key === 'Escape' && this.slides) this.toggleSlides()
      else if (event.key === 'Escape' && (this.blockMenuOpen || this.blockTypeMenuOpen || this.blockAlignMenuOpen || this.blockColorMenuOpen)) this.closeBlockMenu()
      else if (this.slides && event.key === 'ArrowRight') this.slideIndex = Math.min(this.slideChapters.length - 1, this.slideIndex + 1)
      else if (this.slides && event.key === 'ArrowLeft') this.slideIndex = Math.max(0, this.slideIndex - 1)
    },
    /**
     * 逐层收浮层（互斥链，一次只收一层），最后一律把焦点还给编辑器。
     *
     * 🔴 新增浮层时在这里**插一个 `else if`**，位置决定优先级：越靠前越先收。
     * 内嵌网页浮层（P3-07）故意不进这条链——04 §4.3 ⑤ 实测「Esc ×1/×2 都关不掉」，
     * 它只认「点外部」和「点 ×」，所以由 `onDocumentPointerDown` 单独管。
     */
    closeOverlay() { if (this.menuOpen) this.closeCommandMenu(); else if (this.isvPanelOpen) this.closeIsvPanel(); else if (this.mentionOpen) this.closeMentionPanel(); else if (this.reminderOpen) this.closeReminderPopover(); else if (this.colorPaletteOpen) this.colorPaletteOpen = ''; else if (this.mathDialog) this.mathDialog = ''; else if (this.linkDialog) this.linkDialog = false; else if (this.tablePicker) { this.tablePicker = false; this.tablePickerHover = { rows: 3, cols: 3 } } else if (this.helpOpen) this.helpOpen = false; else if (this.headingOpen) { this.headingOpen = false; this.headingStyle = {} } else if (this.headerMenuOpen) this.closeHeaderMenu(); else if (this.diagramMenuOpen) this.closeDiagramMenu(); else if (this.bubbleAlignOpen) this.closeBubbleAlignMenu(); else if (this.blockAlignMenuOpen || this.blockColorMenuOpen || this.blockTypeMenuOpen || this.blockMenuOpen) this.closeBlockMenu(); else if (this.calloutEmojiOpen) this.closeCalloutEmoji(); else if (this.tableToolsOpen) this.tableToolsOpen = false; else if (this.searchOpen) this.closeSearch(); this.focus() },
  },
}
