/**
 * 链接悬浮卡（P6b 之后的 UI 补齐线）—— requirements/04 §1.6 A 态 + §1.6.1。
 *
 * 三条实测口径，改这个文件前先看懂：
 *
 *   1. **触发条件是 hover ≥ 2.7s，不是即展**（§1.6 A 态）。这里用 `mouseover` 代理 +
 *      2700ms 定时器实现；鼠标离开链接且未移入卡片就取消。**不是** `title` 属性那种
 *      浏览器原生悬浮。卡片已经展开后再移进卡内**不重置**计时（重计时会让卡一直闪）。
 *   2. **卡片宽 440 恒定，与 URL 长度无关**（batch116 用 44 字符、batch118 用 10 字符，
 *      两次都是 440×42，URL 文本项恒 184）。URL 过长在文本项内**单行省略**，卡片不撑宽。
 *      所以 `LINK_HOVER_CARD_SIZE` 是常量，不要改成自适应。
 *   3. **定位：水平严格以链接为中心，`top = 链接 top − 50`**。实测两次（链接中心 730 → 卡
 *      中心 730；734 → 734）。这是本文件的核心几何，`linkHoverCardStyle` 就是它。
 *
 * 为什么四种视图（`link-to-title` 二级菜单）只落"选择态 + 抛事件"：
 *   §1.6.1 的正文只描述了菜单 232×146、四项各 214×32、当前项右侧 16×16 勾（`#336DF4`）。
 *   视图真正改写的是**链接块如何渲染**（标题 vs URL vs 卡片 vs 预览），那是宿主渲染策略，
 *   不属于编辑器内核；硬要在内核里伪造，只能偷偷改 link mark 的 attrs，属于超出规格。
 *   所以这里把选择态持久化在本地、并 `link-view` 事件抛给宿主，由宿主决定怎么渲染
 *   —— 有闭环、不伪造。
 */
import { safeUrl } from '../documentOperations'

/**
 * §1.6 A 态实测触发延迟（ms）。
 *
 * 出处：`requirements/04-浮层与弹窗.md` §1.6.1 红字「鼠标在链接上停留 **≥2.7s** 才展开」。
 * 早先按 1.2s 实现（那个数是 §1.6 A 态第一版的粗测），收尾时按 §1.6.1 的复测值统一。
 * 单测 `test/unit/link-hover-ui.test.js` 直接断言这个常量，改值要同步改断言。
 */
export const LINK_HOVER_DELAY = 2700

/** §1.6 A 态卡片尺寸（440×42，与 URL 长度无关）。 */
export const LINK_HOVER_CARD_SIZE = Object.freeze({ width: 440, height: 42 })

/** §1.6.1 四种显示形态，顺序与实测一致。 */
export const LINK_VIEW_MODES = Object.freeze([
  { id: 'link', label: '链接视图' },
  { id: 'title', label: '标题视图' },
  { id: 'card', label: '卡片视图' },
  { id: 'preview', label: '预览视图' },
])

/** 卡片顶部相对链接顶部的偏移（§1.6：卡 top 467 vs 链接 top 517）。 */
export const LINK_HOVER_TOP_OFFSET = 50

/**
 * 定位纯函数：链接悬浮卡。
 *
 * 水平中心对齐链接中心，并向视口内夹 8px；垂直默认 `链接 top − 50`，
 * 上方放不下时翻到链接下方 `bottom + 8`（飞书没给这条，但伸长出视口是不可用的）。
 */
export function linkHoverCardStyle(linkRect, size = LINK_HOVER_CARD_SIZE, viewport = {}) {
  if (!linkRect) return { left: 0, top: 0 }
  const width = size.width || LINK_HOVER_CARD_SIZE.width
  const height = size.height || LINK_HOVER_CARD_SIZE.height
  const center = linkRect.left + (linkRect.width || 0) / 2
  const maxLeft = Math.max(8, (viewport.width || 0) - width - 8)
  const left = Math.min(Math.max(center - width / 2, 8), maxLeft)
  let top = linkRect.top - LINK_HOVER_TOP_OFFSET
  if (top < 8) top = (linkRect.bottom || 0) + 8
  const limit = (viewport.height || 0) - height - 8
  if (top > limit && limit > 8) top = limit
  return { left, top: Math.max(8, top) }
}

/** 从事件目标往上找链接元素；找不到返回 null。 */
export function linkHoverTargetOf(target) {
  if (!target || typeof target.closest !== 'function') return null
  const anchor = target.closest('a[href]')
  if (!anchor) return null
  // 编辑器内部的 chrome（气泡条里的 <a> 之类）不算正文链接。
  if (anchor.closest('.lark-doc-link-hover-card')) return null
  return anchor
}

/** URL 单行省略前的展示串：去掉协议头以外的东西一概不动（飞书显示的是完整 URL）。 */
export function linkHoverDisplayText(href, text) {
  if (text && String(text).trim()) return String(text).trim()
  return String(href || '')
}

export default {
  data() {
    return {
      linkHoverOpen: false,
      linkHoverHref: '',
      linkHoverText: '',
      linkHoverStyle: { left: 0, top: 0 },
      /** §1.6.1 四种视图的选择态；真实渲染由宿主从 `link-view` 事件接管。 */
      linkHoverView: 'link',
      /** 二级「四种视图」菜单 232×146 是否展开。 */
      linkHoverMenuOpen: false,
    }
  },
  computed: {
    /** 四项 + 当前勾的位置，模板唯一数据源。 */
    linkViewModes() {
      return LINK_VIEW_MODES.map((mode) => ({ ...mode, active: this.linkHoverView === mode.id }))
    },
    /** 卡片上展示的链接文案（优先取选区/链接的文本）。 */
    linkHoverLabel() {
      return linkHoverDisplayText(this.linkHoverHref, this.linkHoverText)
    },
    /** 是否是可用链接（非法协议回落到 about:blank 时卡片不提供打开动作）。 */
    linkHoverSafeHref() {
      return safeUrl(this.linkHoverHref)
    },
  },
  mounted() {
    const root = this.$refs && this.$refs.root
    if (!root || typeof root.addEventListener !== 'function') return
    root.addEventListener('mouseover', this.onPaperLinkMouseOver)
    root.addEventListener('mouseout', this.onPaperLinkMouseOut)
  },
  beforeDestroy() {
    const root = this.$refs && this.$refs.root
    if (root && typeof root.removeEventListener === 'function') {
      root.removeEventListener('mouseover', this.onPaperLinkMouseOver)
      root.removeEventListener('mouseout', this.onPaperLinkMouseOut)
    }
    this.cancelLinkHover()
  },
  methods: {
    onPaperLinkMouseOver(event) {
      const anchor = linkHoverTargetOf(event.target)
      if (!anchor) return
      if (this.linkHoverOpen && this.linkHoverHref === anchor.getAttribute('href')) return
      this.cancelLinkHover()
      this._linkHoverAnchor = anchor
      this._linkHoverTimer = setTimeout(() => {
        this._linkHoverTimer = null
        this.openLinkHover(anchor)
      }, LINK_HOVER_DELAY)
    },
    onPaperLinkMouseOut(event) {
      const anchor = linkHoverTargetOf(event.target)
      if (!anchor) return
      // 移向浮层自身时不关 —— 否则鼠标还没进卡片就先被这条业务吃掉。
      const next = event.relatedTarget
      if (next && next.closest && next.closest('.lark-doc-link-hover-card, .lark-doc-link-view-menu')) return
      this.cancelLinkHover()
    },
    cancelLinkHover() {
      if (this._linkHoverTimer) {
        clearTimeout(this._linkHoverTimer)
        this._linkHoverTimer = null
      }
      this._linkHoverAnchor = null
    },
    openLinkHover(anchor) {
      const target = anchor || this._linkHoverAnchor
      if (!target) return
      this.linkHoverHref = target.getAttribute('href') || ''
      this.linkHoverText = (target.textContent || '').trim()
      const rect = target.getBoundingClientRect()
      this.linkHoverStyle = linkHoverCardStyle(rect, LINK_HOVER_CARD_SIZE, {
        width: window.innerWidth,
        height: window.innerHeight,
      })
      this.linkHoverOpen = true
      this.linkHoverMenuOpen = false
    },
    closeLinkHover() {
      this.cancelLinkHover()
      this.linkHoverOpen = false
      this.linkHoverMenuOpen = false
    },
    /** 卡片本身 hover —— 保持打开（配合 mouseleave 关闭）。 */
    keepLinkHover() {
      this.cancelLinkHover()
    },
    toggleLinkHoverMenu() {
      this.linkHoverMenuOpen = !this.linkHoverMenuOpen
    },
    /**
     * 四种视图切换。
     * 内核不做渲染改写（那是宿主策略），只留选择态 + 抛事件。
     */
    setLinkHoverView(mode) {
      this.linkHoverView = mode
      this.linkHoverMenuOpen = false
      this.$emit('link-view', { href: this.linkHoverHref, view: mode })
    },
    /** 编辑：走既有 LinkDialog（toolbarMenusMixin）。 */
    editHoveredLink() {
      const href = this.linkHoverHref
      this.closeLinkHover()
      if (typeof this.openLinkDialog === 'function') this.openLinkDialog(true)
      if (typeof this.setLinkValue === 'function') this.setLinkValue(href)
    },
    /** 删除：走既有 unsetLink 命令；只读态下静默（§1.6：无权限不隐藏入口，只置灰）。 */
    removeHoveredLink() {
      if (typeof this.writable === 'function' && !this.writable()) return
      this.closeLinkHover()
      if (typeof this.run === 'function') this.run('unsetLink')
    },
    /** 更多：超出本轮范围，抛给宿主，不弹空菜单。 */
    onLinkHoverMore() {
      this.closeLinkHover()
      this.$emit('link-more', { href: this.linkHoverHref })
    },
    linkHoverContains(node) {
      return Boolean(node && node.closest && node.closest('.lark-doc-link-hover-card, .lark-doc-link-view-menu'))
    },
  },
}
