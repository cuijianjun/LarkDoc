/**
 * toolbarMenusMixin — 顶部工具栏下拉：标题级别菜单、链接对话框、公式对话框。
 * 通过 this.editor、this.writable()、this.rememberSelection()/this.restoreSelection()/this.run()
 * （主组件方法）协作；commandMenuMixin 的 executeCommand 会打开这里的 mathDialog/linkDialog。
 * 采用 mixin 而非子组件：工具栏与对话框模板留在主 SFC，依赖 Vue 2 选项合并语义。
 */
import { safeUrl } from '../documentOperations'
import { loadKatex } from '../../../core/blocks/math'
import { EMBED_MENU_ITEMS, EMBED_HELP_URL } from '../../../core/embed/presets'
import { readHost, resolveEmbed } from '../../../core/embed/resolve'
import {
  marks, fontFamilyOptions, fontSizeOptions, lineHeightOptions,
  widthModeOptions, cellTextAlignOptions, cellVerticalAlignOptions,
} from './constants'
import { DEFAULT_TEXT_COLOR, DEFAULT_TEXT_BACKGROUND } from './palette'

export default {
  data() { return {
    headingOpen: false, headingStyle: {},
    // 顶栏隐藏时（layout.headerVisible=false），工具栏「⋯」下拉承接 header-actions 插槽。
    headerMenuOpen: false, headerMenuStyle: {},
    linkDialog: false, linkValue: '', linkText: '', linkInsertMode: false,
    // P3-07：内嵌网页「粘贴链接」浮层。embedDialog 存的是**菜单项 id**（null = 关闭），
    // 文案与 placeholder 由 EMBED_MENU_ITEMS 现查，不另存一份字符串（否则 15 份文案会漂移）。
    embedDialog: null, embedValue: '', embedDialogRejected: false, embedDialogPos: { left: '0px', top: '0px' },
    mathDialog: '', mathValue: '', mathError: '', marks,
    // 自绘下拉（LarkDocSelect）选项清单与最近一次应用的值（替代原生 select 的非受控展示）。
    fontFamilyOptions, fontSizeOptions, lineHeightOptions, widthModeOptions,
    cellTextAlignOptions, cellVerticalAlignOptions,
    appliedTextStyle: { fontFamily: '', fontSize: '', lineHeight: '', textColor: DEFAULT_TEXT_COLOR, backgroundColor: DEFAULT_TEXT_BACKGROUND },
    cellAlignState: { textAlign: '', verticalAlign: '' },
    // 飞书式 hover 弹窗：鼠标离开触发器/弹层后延迟关闭（跨过 6px 间隙时不误关）。
    hoverCloseTimer: null,
  } },
  computed: {
    visibleMarks() {
      if (!this.larkDocConfig.features.marks) return []
      const allow = this.larkDocConfig.toolbar.marksAllow
      return Array.isArray(allow) ? this.marks.filter((item) => allow.includes(item.id)) : this.marks
    },
    currentBlockLabel() { if (!this.editor) return '正文'; const level = this.editor.getAttributes('heading').level; return this.editor.isActive('heading') ? `H${level}` : '正文' },
    // 标题级别下拉的选中项：null = 正文，1~9 = H1~H9（与气泡条共用 LarkDocHeadingMenu）。
    headingActiveLevel() {
      if (!this.editor || !this.editor.isActive('heading')) return null
      const level = Number(this.editor.getAttributes('heading').level)
      return Number.isInteger(level) ? level : null
    },
    // 内嵌网页浮层当前项：15 条里按 id 现查（未命中给 null，模板里 v-if 已先拦一层）。
    embedDialogItem() {
      if (!this.embedDialog) return null
      return EMBED_MENU_ITEMS.find((item) => item.id === this.embedDialog) || null
    },
    embedDialogTitle() { return this.embedDialogItem ? this.embedDialogItem.dialogTitle : '' },
    embedDialogPlaceholder() { return this.embedDialogItem ? this.embedDialogItem.placeholder : '' },
  },
  methods: {
    /** hover 弹窗公共：取消延迟关闭 / 离开后延迟关闭（进入弹层会取消）。 */
    cancelPopupHoverClose() { if (this.hoverCloseTimer) { clearTimeout(this.hoverCloseTimer); this.hoverCloseTimer = null } },
    schedulePopupHoverClose(close) {
      this.cancelPopupHoverClose()
      this.hoverCloseTimer = setTimeout(() => { this.hoverCloseTimer = null; close() }, 150)
    },
    openHeadingMenuOnHover() {
      if (!this.writable()) return
      this.cancelPopupHoverClose()
      if (this.headingOpen) return
      // 直接置态而非复用 toggleHeadingMenu：避免其把 hover 标志清掉，导致紧随的 click 又关闭弹窗。
      this._headingHoverOpened = true
      this.headingOpen = true
      this.headingStyle = {}
      this.menuOpen = false
      this.$nextTick(() => this.positionHeadingMenu())
    },
    scheduleHeadingMenuClose() { this.schedulePopupHoverClose(() => { this._headingHoverOpened = false; if (this.headingOpen) this.toggleHeadingMenu() }) },
    openColorPaletteOnHover(event) {
      this.cancelPopupHoverClose()
      if (this.colorPaletteOpen !== 'textColor') { this._paletteHoverOpened = true; this.toggleColorPalette('textColor', event) }
    },
    scheduleColorPaletteClose() { this.schedulePopupHoverClose(() => { this._paletteHoverOpened = false; if (this.colorPaletteOpen) this.colorPaletteOpen = '' }) },
    setHeading(level) { if (!this.featureEnabled('headings')) return; this.headingOpen = false; this.headingStyle = {}; if (level) this.run('setHeading', { level }); else this.run('setParagraph') },
    toggleHeadingMenu() {
      if (!this.writable()) return
      // hover 已打开时点击不关闭（飞书行为：hover 弹窗靠移开鼠标关闭），避免 hover+click 冲突。
      if (this._headingHoverOpened && this.headingOpen) return
      this._headingHoverOpened = false
      this.headingOpen = !this.headingOpen
      this.headingStyle = {}
      this.menuOpen = false
      if (this.headingOpen) this.$nextTick(() => this.positionHeadingMenu())
    },
    positionHeadingMenu() {
      if (!this.headingOpen) return
      const root = this.$refs.root
      const trigger = root?.querySelector('.lark-doc-heading-tool > button')
      const menu = root?.querySelector('.lark-doc-dropdown')
      if (!trigger || !menu) return
      const margin = 8
      const triggerRect = trigger.getBoundingClientRect()
      const menuRect = menu.getBoundingClientRect()
      const viewportSpace = Math.max(40, window.innerHeight - margin * 2)
      const naturalHeight = Math.max(menu.scrollHeight, menuRect.height)
      const desiredHeight = Math.min(naturalHeight, viewportSpace)
      const below = Math.max(0, window.innerHeight - triggerRect.bottom - margin)
      const above = Math.max(0, triggerRect.top - margin)
      const useAbove = below < desiredHeight && above > below
      const available = useAbove ? above : below
      const maxHeight = Math.max(40, Math.min(desiredHeight, available || viewportSpace))
      const top = useAbove ? triggerRect.top - maxHeight - 6 : triggerRect.bottom + 6
      const width = Math.min(menuRect.width || 155, window.innerWidth - margin * 2)
      const left = Math.max(margin, Math.min(window.innerWidth - width - margin, triggerRect.left))
      this.headingStyle = { top: `${Math.max(margin, Math.min(window.innerHeight - maxHeight - margin, top))}px`, left: `${left}px`, maxHeight: `${maxHeight}px`, marginTop: '0px' }
    },
    /** 打开/关闭工具栏右侧「⋯」文档操作下拉（fixed 定位，贴按钮右下）。 */
    toggleHeaderMenu() {
      this.headerMenuOpen = !this.headerMenuOpen
      this.headerMenuStyle = {}
      if (this.headerMenuOpen) this.$nextTick(() => this.positionHeaderMenu())
    },
    closeHeaderMenu() { this.headerMenuOpen = false; this.headerMenuStyle = {} },
    /** 「更多」弹层中的文档操作入口：内联「⋯」按钮被收纳隐藏时，以点击位置为锚点打开。 */
    openHeaderMenuFrom(event) {
      this.headerMenuOpen = true
      this.headerMenuStyle = {}
      const anchor = event?.currentTarget?.getBoundingClientRect?.()
      this.$nextTick(() => {
        if (!this.headerMenuOpen || !this.$refs.root?.querySelector('.lark-doc-header-menu')) return
        if (!anchor || !anchor.width) { this.positionHeaderMenu(); return }
        const margin = 8
        const maxHeight = Math.max(120, window.innerHeight - anchor.bottom - margin * 2)
        this.headerMenuStyle = { top: `${anchor.bottom + 6}px`, right: `${Math.max(margin, window.innerWidth - anchor.right)}px`, left: 'auto', maxWidth: `${Math.min(280, window.innerWidth - margin * 2)}px`, maxHeight: `${maxHeight}px`, marginTop: '0px' }
      })
    },
    positionHeaderMenu() {
      if (!this.headerMenuOpen) return
      const root = this.$refs.root
      // 触发按钮可能在 .lark-doc-tools-end-inner（折叠改造后的内层容器）或 .lark-doc-tools-end 直接子级。
      const trigger = root?.querySelector('button[aria-label="文档操作"]')
      const menu = root?.querySelector('.lark-doc-header-menu')
      if (!trigger || !menu) return
      const margin = 8
      const triggerRect = trigger.getBoundingClientRect()
      const maxHeight = Math.max(120, window.innerHeight - triggerRect.bottom - margin * 2)
      const right = Math.max(margin, window.innerWidth - triggerRect.right)
      this.headerMenuStyle = { top: `${triggerRect.bottom + 6}px`, right: `${right}px`, left: 'auto', maxWidth: `${Math.min(280, window.innerWidth - margin * 2)}px`, maxHeight: `${maxHeight}px`, marginTop: '0px' }
    },
    openLinkDialog(allowEmpty = false) {
      if (!this.writable() || (!allowEmpty && this.editor.state.selection.empty)) return
      this.rememberSelection(allowEmpty)
      this.linkInsertMode = this.editor.state.selection.empty
      this.linkText = ''
      this.linkValue = this.editor.getAttributes('link').href || ''
      this.linkDialog = true
    },
    applyLink() {
      if (!this.writable() || !this.linkValue || !safeUrl(this.linkValue)) { this.error = '链接地址无效，仅支持 http、https、mailto、tel 或 # 锚点'; return }
      const attrs = { href: this.linkValue, target: '_blank', rel: 'noopener noreferrer' }
      if (this.linkInsertMode) {
        if (!this.linkText.trim()) { this.error = '请输入链接显示文字'; return }
        this.restoreSelection(true)
        this.editor.chain().focus().insertContent({ type: 'text', text: this.linkText.trim(), marks: [{ type: 'link', attrs }] }).run()
      } else this.run('setLink', attrs)
      this.linkDialog = false
      this.linkInsertMode = false
      this.linkText = ''
    },
    removeLink() { if (this.writable() && !this.linkInsertMode) { this.run('unsetLink'); this.linkDialog = false } },
    async insertMath() {
      if (!this.writable() || !this.featureEnabled('math')) return
      try {
        // 阶段 4：复用 core/blocks/math.js 的 loadKatex（含特性注册通道），不再
        // 自开一条 import('katex') 接缝 —— 两处各写一条会让 lite 的 stub / 特性包
        // 注册只覆盖其一。
        const katex = await loadKatex()
        if (!this.writable() || !this.mathDialog) return
        katex.renderToString(this.mathValue, { throwOnError: true, trust: false })
        this.mathError = ''
        this.run('insertContent', { type: this.mathDialog, attrs: { latex: this.mathValue } })
        this.mathDialog = ''
      } catch (_) { this.mathError = '公式无法解析，请检查 LaTeX 语法' }
    },
    // P0-03：弹窗输入框的模板级赋值收敛为方法——子组件模板经 ed. 调用，避免 vue/no-mutating-props。
    setMathValue(value) { this.mathValue = value },
    setLinkText(value) { this.linkText = value },
    setLinkValue(value) { this.linkValue = value },

    /* ---------- P3-07：内嵌网页「粘贴链接」浮层（requirements/04 §4.3） ---------- */

    /**
     * 打开浮层。落点跟着插入位置走 —— 04 §4.3 ④ 实测「跟随插入块位置」，
     * 所以取光标当前**视口**坐标换算（浮层是 position: fixed），算不出就退回视口居中。
     */
    openEmbedDialog(embedId) {
      if (!this.writable()) return
      this.embedDialog = embedId
      this.embedValue = ''
      this.embedDialogRejected = false
      this.embedDialogPos = this.computeEmbedDialogPos()
    },
    computeEmbedDialogPos() {
      const width = 540 // 04 §4.3 ④ 实测浮层宽
      const height = 164 // 同上，实测浮层高
      const margin = 9
      const viewportW = typeof window === 'undefined' ? width : window.innerWidth
      const viewportH = typeof window === 'undefined' ? height : window.innerHeight
      let left = Math.round((viewportW - width) / 2)
      let top = Math.round((viewportH - height) / 2)
      const view = this.editor && this.editor.view
      if (view && view.state) {
        try {
          const coords = view.coordsAtPos(view.state.selection.from)
          if (coords && Number.isFinite(coords.left) && Number.isFinite(coords.bottom)) {
            left = Math.round(coords.left)
            top = Math.round(coords.bottom + 8)
          }
        } catch (_) { /* 选区失效（极少数边界态）：退回居中，不抛错打断命令链 */ }
      }
      // 🔴 先夹上界再夹下界：窄屏（viewportW < 540 + 18）时上界本身可能小于 margin，
      // 反过来夹会把 left 顶成负数、浮层左边出屏。
      left = Math.max(margin, Math.min(left, viewportW - width - margin))
      top = Math.max(margin, Math.min(top, viewportH - height - margin))
      return { left: `${left}px`, top: `${top}px` }
    },
    // 模板经 ed. 调用（同 setLinkValue），避免 vue/no-mutating-props；重输即复位拒绝态。
    setEmbedValue(value) { this.embedValue = value; this.embedDialogRejected = false },
    closeEmbedDialog() { this.embedDialog = null; this.embedValue = ''; this.embedDialogRejected = false },
    /**
     * 「确认」。04 §4.3 ⑤ 三条实测行为：
     * - 合法链接 → 浮层消失 + 落块；
     * - 填**空** / 填**非法**（如 `abc`）→ **静默无效**：不报错、不 toast、不落块、浮层保持打开，
     *   唯一反馈是「确认」按钮底色变浅（.is-rejected → --ld-bg-brand-pressed），
     *   §2558 明确「错误态没有文案提示，别优化成红字报错」；
     * - 落**什么块**由链接的 host 决定，不由菜单项决定（§4.3 ⑤.1 推翻了「菜单项决定落块类型」）：
     *   命中 srcRule → iframe 网页块；未命中 → 书签卡（`https://example.com/foo/bar` 走这条）。
     */
    applyEmbedDialog() {
      if (!this.writable()) return
      const url = String(this.embedValue || '').trim()
      // 与 resolve.js 共用同一个 host 口径：readHost 为 null 就是「这压根不是一个链接」。
      if (!url || !readHost(url)) { this.embedDialogRejected = true; return }
      const { kind, attrs } = resolveEmbed(url)
      this.run('insertContent', { type: kind === 'iframe' ? 'webEmbed' : 'bookmark', attrs })
      this.closeEmbedDialog()
    },
    /**
     * 「如何获取链接」/「查看示例」。两个按钮打开**同一篇**帮助文档，差别只在关不关浮层：
     * 「查看示例」= 关浮层 + 新开标签；「如何获取链接」= 浮层不变 + 新开标签（04 §4.3 ⑤）。
     * `Esc` 两个按钮都不管 —— 原文实测「Esc ×1、×2 都关不掉」，浮层只认「点外部」和「点 ×」。
     */
    openEmbedHelp(viewer) {
      if (viewer === 'example') this.closeEmbedDialog()
      // 与 core/nodeviews/bookmark.js 同一套写法：window.open 可能被拦截，拦了就静默当无事发生。
      if (typeof window !== 'undefined' && typeof window.open === 'function') {
        try { window.open(EMBED_HELP_URL, '_blank', 'noopener') } catch (_) { /* 被拦截就忽略 */ }
      }
    },
  },
  beforeDestroy() { if (this.hoverCloseTimer) clearTimeout(this.hoverCloseTimer) },
}
