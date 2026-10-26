/**
 * 修订建议面板（P4-06 ③）—— 面板状态机、定位、六按钮派发。
 *
 * 规格：requirements/07 §12.3（几何）/ §12.4（六按钮）/ §12.5（CRUD 闭环）。
 *
 * 三条负结论（别「补全」）：
 *   1. **接受 / 拒绝都没有二次确认，也没有 toast**（§12.5 原文）。点了就落事务，靠
 *      undo 栈兜。给这两颗加「确定吗」是凭空造流程。
 *   2. **拒绝不恢复被删原文**（§12.5 两处原文）。所以删除态的两颗按钮结果同为「文字
 *      消失」，差异只在语义 —— 别为了「有区别」去实现片段级还原。
 *   3. **面板没有 more-btn、没有「已解决」**（§12.6）。修订建议不是评论，不建私有 /
 *      解决态。
 *
 * 定位为什么是 `position: fixed` 而不是挂在标记旁边：
 *   飞书的面板壳挂在页面右侧固定列（实测 x 恒 1214 = 正文右缘 + 12），**不随段落
 *   换行左右漂**，多实例只做纵向堆叠、间距 6。故本 mixin 只算 left / top 两个数，
 *   横向恒定贴正文右缘、纵向按文档序从各自锚点往下排，排到视口底部就开始往上收。
 *
 * 几何算在 `$nextTick` 后才跑：`onTransaction` 触发时 DOM 还是上一帧的，
 * 当场量 `coordsAtPos` 会拿到旧行高，面板会在「敲字 → 重排」时跳一下。
 *
 * P6b-05：read 态（阅读模式 / 演示态 / 协同只读）下面板**只读展示** —— 面板不隐藏
 * （要能读建议），但接受 / 拒绝置灰（色 `#BBBFC4` = `--ld-text-disabled`，见
 * `styles/reading.css`），且不展开输入区。口径统一走 `interactionMode`
 * （`editor/readingModeMixin.js` 提供），本 mixin 只读它、不自己拼 `||`。
 * readingModeMixin 未挂载时 `interactionMode` 是 undefined，`revisionReadonly`
 * 自然为 false —— 旧口径照旧生效，不会把编辑态的按钮误置灰。
 */
import {
  REVISION_AUTHOR_FALLBACK,
  REVISION_AUTHOR_NAME_FALLBACK,
  REVISION_BUTTONS,
  REVISION_PANEL,
  REVISION_PANEL_TITLE,
  collectRevisions,
  revisionPanelHeight,
  revisionSummary,
} from '../../../core/blocks/revision'
import { adjacentRevision, buildRevisionDecisionTr, revisionAnchor } from '../../../core/revision/commands'
import { buildRevisionActiveTr } from '../../../core/revision/decorations'

/** 面板与正文右缘的间距（实测 1214 - 1202）。 */
const REVISION_ANCHOR_GUTTER = 12
/** 贴视口边的最小留白，和 isv 面板同口径。 */
const REVISION_VIEWPORT_MARGIN = 8
/** 按钮 id → 图标键（叉复用 close、链条复用 link，见 editor/icons.js 注释）。 */
const REVISION_ICONS = Object.freeze({
  'go-next': 'rev-next',
  'go-previous': 'rev-prev',
  copyAnchor: 'link',
  reject: 'close',
  accept: 'rev-accept',
})

export default {
  data() {
    return {
      /** 当前文档里的全部建议，文档序；每条已带上算好的 `left` / `top`。 */
      revisionPanels: [],
      /** 被点亮的建议 id（输入区展开、标记高亮都看它）。 */
      revisionActiveId: '',
      /** hover 高亮：飞书「hover 面板也展开输入区」，与点亮是两个独立来源。 */
      revisionHoverId: '',
    }
  },
  computed: {
    /**
     * 是否处于 read 态（P6b-05）。`interactionMode` 由 readingModeMixin 提供；
     * 那个 mixin 没挂载时它是 undefined，这里恒 false —— 保持旧行为，不误伤编辑态。
     */
    revisionReadonly() {
      return this.interactionMode === 'read'
    },
    revisionPanelTitle() {
      return REVISION_PANEL_TITLE
    },
    /** 头部控件组：六项顺序来自 core 常量，`split` 单独走分割条分支。 */
    revisionButtons() {
      return REVISION_BUTTONS.map((btn) => ({
        id: btn.id,
        split: btn.tone === 'split',
        icon: REVISION_ICONS[btn.id] || '',
        iconSize: btn.iconSize,
        tone: btn.tone,
        tooltip: btn.tooltip,
      }))
    },
  },
  mounted() {
    window.addEventListener('scroll', this.onRevisionViewportChange, true)
    window.addEventListener('resize', this.onRevisionViewportChange)
    // 宿主的 `mounted` 在本钩子之后才建编辑器 —— 延一帧再挂 DOM 监听、补写模式。
    this.$nextTick(() => {
      if (!this.editor) return
      this.editor.view.dom.addEventListener('pointerdown', this.onRevisionPointerDown)
      this.syncRevisionTracking()
      this.updateRevisionPanels()
    })
  },
  beforeDestroy() {
    window.removeEventListener('scroll', this.onRevisionViewportChange, true)
    window.removeEventListener('resize', this.onRevisionViewportChange)
    if (this.editor && this.editor.view && this.editor.view.dom) this.editor.view.dom.removeEventListener('pointerdown', this.onRevisionPointerDown)
  },
  methods: {
    // —— 存储面 ——
    /** tracker 的开关只在「修订」模式打开；宿主切模式后调这里同步（不重建编辑器）。 */
    syncRevisionTracking() {
      const storage = this.editor && this.editor.storage ? this.editor.storage.larkDocRevisionTracker : null
      if (!storage) return
      // P6b-05：开关跟着**派生结果**走，不再只看 `mode`。协同只读（canEdit 为 false）时
      // 即使 mode 还停在 suggest 也不能再产出建议 —— 那是「能产出建议但正文不可写」
      // 的怪态（§12.1：有编辑权限的用户才可进入 / 处理修订）。
      // `interactionMode` 缺席（readingModeMixin 未挂载）时退回旧口径。
      const suggest = this.interactionMode ? this.interactionMode === 'suggest' : this.mode === 'suggest'
      storage.active = suggest
      if (!storage.active) {
        this.revisionActiveId = ''
        this.revisionHoverId = ''
      }
      this.updateRevisionPanels()
    },
    revisionTrackingOn() {
      const storage = this.editor && this.editor.storage ? this.editor.storage.larkDocRevisionTracker : null
      return !!(storage && storage.active)
    },

    // —— 收集与定位 ——
    /** 由宿主的 `onTransaction` 调；只做「收建议 + 清理失效 id」，几何交给下一帧。 */
    updateRevisionPanels() {
      if (!this.editor) {
        this.revisionPanels = []
        this.revisionActiveId = ''
        return
      }
      const items = collectRevisions(this.editor.state.doc)
      if (!items.length) {
        this.revisionPanels = []
        this.revisionActiveId = ''
        this.revisionHoverId = ''
        return
      }
      // 建议被接受 / 拒绝后它的 id 就没了 —— 不清会让输入区挂在一个不存在的标记上。
      if (this.revisionActiveId && !items.some((item) => item.revisionId === this.revisionActiveId)) this.revisionActiveId = ''
      if (this.revisionHoverId && !items.some((item) => item.revisionId === this.revisionHoverId)) this.revisionHoverId = ''
      this.revisionPanels = items.map((item) => ({
        revisionId: item.revisionId,
        kind: item.kind,
        author: item.author,
        from: item.from,
        to: item.to,
        text: item.text,
        left: 0,
        top: 0,
      }))
      this.$nextTick(() => this.placeRevisionPanels())
    },
    placeRevisionPanels() {
      const view = this.editor && this.editor.view
      if (!view || !this.revisionPanels.length) return
      const bound = view.dom.getBoundingClientRect()
      const maxLeft = window.innerWidth - REVISION_PANEL.width - REVISION_VIEWPORT_MARGIN
      const left = Math.max(REVISION_VIEWPORT_MARGIN, Math.min(maxLeft, bound.right + REVISION_ANCHOR_GUTTER))
      const bottomLimit = window.innerHeight - REVISION_VIEWPORT_MARGIN
      let floor = REVISION_VIEWPORT_MARGIN
      this.revisionPanels = this.revisionPanels.map((item) => {
        let anchorTop = bound.top
        try {
          // 取标记起点那一行盒的顶边；`from` 是合法文档位（0..docSize）。
          anchorTop = view.coordsAtPos(item.from).top
        } catch (error) {
          anchorTop = bound.top
        }
        const height = revisionPanelHeight(item.kind, this.revisionPanelActive(item))
        let top = Math.max(floor, anchorTop)
        // 放不下就上收，但**不收过前一块**，否则两个面板会叠在一起。
        if (top + height > bottomLimit) top = Math.max(floor, bottomLimit - height)
        floor = top + height + REVISION_PANEL.gap
        return { ...item, left, top }
      })
    },
    onRevisionViewportChange() {
      if (this.revisionPanels.length) this.placeRevisionPanels()
    },

    // —— 渲染给面板的取值 ——
    revisionPanelActive(item) {
      if (!item) return false
      return item.revisionId === this.revisionActiveId || item.revisionId === this.revisionHoverId
    },
    revisionPanelBoxHeight(item) {
      return revisionPanelHeight(item.kind, this.revisionPanelActive(item))
    },
    revisionPanelStyle(item) {
      return { left: `${item.left}px`, top: `${item.top}px` }
    },
    revisionSummaryOf(item) {
      return revisionSummary(item)
    },
    revisionAuthorName(author) {
      const value = author === null || author === undefined ? '' : String(author)
      if (!value || value === REVISION_AUTHOR_FALLBACK) return REVISION_AUTHOR_NAME_FALLBACK
      return value
    },
    /**
     * 上一条 / 下一条只在「首尾」置灰（07 §12.4 #2）；read 态额外把**接受 / 拒绝**
     * 置灰 —— §12.1「有编辑权限的用户可接受/拒绝建议」，只读生态下这两颗要看得见
     * 但点不动（面板是只读展示，不是隐藏，见 `styles/reading.css`）。
     * 跳转与复制链接是只读操作，不受影响。
     */
    revisionButtonDisabled(id, revisionId) {
      if (this.revisionReadonly && (id === 'accept' || id === 'reject')) return true
      if (id !== 'go-next' && id !== 'go-previous') return false
      if (!this.editor) return true
      const direction = id === 'go-next' ? 1 : -1
      return !adjacentRevision(this.editor.state.doc, revisionId, direction)
    },
    enterRevisionPanel(revisionId) {
      // read 态不展开输入区：面板只读展示，给一个不能提交的输入框是误导。
      if (this.revisionReadonly) return
      this.revisionHoverId = revisionId
    },
    leaveRevisionPanel() {
      this.revisionHoverId = ''
    },

    // —— 六按钮派发 ——
    runRevisionButton(id, revisionId) {
      if (id === 'go-next') return this.goRevision(revisionId, 1)
      if (id === 'go-previous') return this.goRevision(revisionId, -1)
      if (id === 'copyAnchor') return this.copyRevisionAnchor(revisionId)
      if (id === 'accept') return this.decideRevision(revisionId, 'accept')
      if (id === 'reject') return this.decideRevision(revisionId, 'reject')
      return undefined
    },
    goRevision(revisionId, direction) {
      if (!this.editor) return
      const target = adjacentRevision(this.editor.state.doc, revisionId, direction)
      if (!target) return
      this.activateRevision(target)
      const item = this.revisionPanels.filter((panel) => panel.revisionId === target)[0]
      if (!item) return
      // 跳到别的建议后要把它滚进视野，否则点「下一个」看起来什么都没发生。
      try {
        const at = this.editor.view.domAtPos(item.from)
        const node = at.node && at.node.nodeType === 3 ? at.node.parentNode : at.node
        if (node && typeof node.scrollIntoView === 'function') node.scrollIntoView({ block: 'center' })
      } catch (error) {
        // 滚不动不影响点亮结果，静默。
      }
    },
    activateRevision(revisionId) {
      const nextId = revisionId || ''
      if (nextId === this.revisionActiveId) return
      this.revisionActiveId = nextId
      if (!this.editor) return
      // 高亮走装饰、不进文档 —— 只 `setMeta`，`addToHistory: false` 在 core 里设好了。
      this.editor.view.dispatch(buildRevisionActiveTr(this.editor.state, nextId))
      this.$nextTick(() => this.placeRevisionPanels())
    },
    /** 接受 / 拒绝：**无二次确认、无 toast**（07 §12.5），进 undo 栈可撤。 */
    decideRevision(revisionId, action) {
      // `writable()` 是宿主既有的口径（含销毁态判定），保留；再加一道 read 态闸门 ——
      // 协同只读时宿主可能还没把 `effectiveReadonly` 接过来，这里先自己守住。
      if (!this.editor || !this.writable() || this.revisionReadonly) return
      const tr = buildRevisionDecisionTr(this.editor.state, revisionId, action)
      if (!tr) return
      this.editor.view.dispatch(tr)
      this.revisionActiveId = ''
      this.revisionHoverId = ''
    },
    copyRevisionAnchor(revisionId) {
      const anchor = revisionAnchor(revisionId)
      if (!anchor) return
      const hash = window.location.href.split('#')[0]
      const text = `${hash}${anchor}`
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(text).catch(() => this.copyRevisionAnchorFallback(text))
        return
      }
      this.copyRevisionAnchorFallback(text)
    },
    /** http 页面没有 clipboard API（非安全上下文），退回 textarea + execCommand。 */
    copyRevisionAnchorFallback(text) {
      try {
        const area = document.createElement('textarea')
        area.value = text
        area.setAttribute('readonly', 'readonly')
        area.style.position = 'fixed'
        area.style.top = '-1000px'
        document.body.appendChild(area)
        area.select()
        document.execCommand('copy')
        document.body.removeChild(area)
      } catch (error) {
        // 复制失败不改文档状态，静默即可（没有 toast 位，别抢模式提示条）。
      }
    },

    // —— 点标记点亮 ——
    onRevisionPointerDown(event) {
      if (!this.revisionTrackingOn()) return
      const target = event.target
      const container = target && typeof target.closest === 'function' ? target.closest('.revision-container') : null
      const revisionId = container ? container.getAttribute('data-revision-id') || '' : ''
      this.activateRevision(revisionId)
    },
  },
}
