/**
 * calendarMixin — 日程块「插入日程」搜索面板（P4-02b）的开关、定位、搜索与落块。
 *
 * 与 `reminderMixin.js` 的**结构差异**（口径见 02 §26，不是随手改的）：
 *   1. 日程是**引用已有日程**，不是自建。「插入 ≠ 新建」—— 面板里刻意没有「新建日程」
 *      入口（02 §26 ⑨），所以本模块只会把**搜索结果**落成块，任何字段都不在这里编辑。
 *   2. 面板**带真输入框**（540×360，搜索框 506×32），所以它要抢焦点 —— 与 mention 面板
 *      「全程不抢焦点」正好相反。为了让「点结果行」不因 blur 先关面板，行一律
 *      `@mousedown.prevent`（见 `CalendarSearchPanel.vue`）。
 *   3. 🔴 **不绑 `Esc`**：02 §26 ⑦ 实测「Esc ×1、×2 都关不掉」，只有「点面板外部」一条路。
 *      所以 `overlayDismissMixin.onWindowKeydown` 里**没有**本面板的分支，这里也不要
 *      对外暴露 `onCalendarKeydown` 去拦 Escape —— 那会造出飞书没有的动线。
 *
 * 搜索只匹配**标题**（02 §26 ⑥）：年份 / 月日 / 参与人 / 组织者 / 标题前 2 字全部 0 命中，
 * 所以过滤逻辑压在契约层 `calendarEventSearchMatch()` 里，本模块不另写一套。
 */
import {
  CALENDAR_EVENT_SIZES,
  calendarEventFromSearch,
  calendarEventSearchMatch,
  normalizeCalendarEvent,
} from '../../../core/embed/calendar-event'

const PANEL_WIDTH = CALENDAR_EVENT_SIZES.panelW
const PANEL_HEIGHT = CALENDAR_EVENT_SIZES.panelH
const PANEL_GAP = 6
const VIEWPORT_MARGIN = 8

/** 结果区固定槽 538×250、行 42 ⇒ 最多 5 行完全可见，多出的滚动看。 */
const SEARCH_LIMIT = 50

/**
 * 候选源三态（与 `mentionSource` 同口径，只是调用形状不同）：
 *   - 数组：宿主直接把「我参与的未来日程」塞进来（demo / 单测用）；
 *   - 函数：`(options) => Promise<item[]>`；
 *   - 对象：`{ search(options) }` —— 对应 04 §4.7 ⑥ 的 `calendar.search({ query, range })`。
 * 没给就返回 `null`，面板显示空态（没有数据源时「插入日程」本来就该是空的）。
 */
function createCalendarProvider(source) {
  if (!source) return null
  if (Array.isArray(source)) return { search: () => Promise.resolve(source) }
  if (typeof source === 'function') return { search: options => Promise.resolve(source(options)) }
  if (typeof source.search === 'function') return { search: options => Promise.resolve(source.search(options)) }
  return null
}

/** 宽容取列表：provider 可能回 `item[]`，也可能回 `{ events: item[] }` / `{ items: item[] }`。 */
function readCalendarItems(result) {
  if (Array.isArray(result)) return result
  if (result && Array.isArray(result.events)) return result.events
  if (result && Array.isArray(result.items)) return result.items
  return []
}

/**
 * 搜索结果 → 块 attrs。两种上游形状都吃：
 *   - 04 §4.7 ⑥ 的 `{ id, summary, startTime, endTime }`（`calendarEventFromSearch`）；
 *   - 已经是块形状的 `{ eventId, title, start }`（宿主直接复用导出数据时）。
 * 两条都不合格就是 `null`，调用方 filter 掉 —— 不猜、不补默认值。
 */
function readCalendarCandidate(item) {
  return calendarEventFromSearch(item) || normalizeCalendarEvent(item)
}

export default {
  data() {
    return {
      calendarOpen: false,
      calendarQuery: '',
      /** 已归一的候选（`normalizeCalendarEvent` 的产物），`calendarResults` 只做过滤不改它。 */
      calendarEvents: [],
      calendarActiveIndex: 0,
      calendarLoading: false,
      calendarStyle: {},
    }
  },
  computed: {
    /** 面板实际渲染的列表：空输入 = 列全部（02 §26 ⑥ 实测「空输入直接列全部」）。 */
    calendarResults() {
      const query = this.calendarQuery
      return this.calendarEvents
        .filter(event => calendarEventSearchMatch(event, query))
        .slice(0, SEARCH_LIMIT)
    },
  },
  created() {
    // provider 只建一次：宿主传函数时每次访问都会重新包一层 Promise。
    this._calendarProvider = createCalendarProvider(this.calendarSource)
    // 异步搜索的序号闸门：慢请求回来晚于新一次打开时直接丢弃。
    this._calendarToken = 0
  },
  methods: {
    /**
     * 命令菜单「日程」入口（`commandMenuMixin.executeCommand`）。
     * 🔴 这里**不往正文写任何东西** —— 没有 eventId 的日程卡片是空壳，飞书也不会在
     * 插入时就替你选一条（02 §26 ⑨：面板里连「新建」都没有）。
     */
    startCalendarEvent() {
      if (!this.editor || !this.writable() || this.effectiveReadonly) return
      // 面板与斜杠菜单互斥：两者都吃键盘，同开必定抢同一组键。
      if (this.menuOpen) this.closeCommandMenu()
      this.calendarQuery = ''
      this.calendarEvents = []
      this.calendarActiveIndex = 0
      this.calendarOpen = true
      this.calendarStyle = this.calendarStyleAt(this.editor.state.selection.from)
      this.loadCalendarEvents()
    },
    /**
     * 拉一次「我参与的未来日程」。`range: 'future'` 是 04 §4.7 ⑥ 的接口约定；
     * 关键词不往 provider 传 —— 只匹配标题是**本地过滤**（契约层统一口径，
     * 否则宿主换一套模糊搜索，同一个文档在两台机器上结果就不同）。
     */
    loadCalendarEvents() {
      const token = (this._calendarToken += 1)
      const apply = (items) => {
        if (token !== this._calendarToken || !this.calendarOpen) return
        this.calendarEvents = readCalendarItems(items).map(readCalendarCandidate).filter(Boolean)
        this.calendarActiveIndex = 0
        this.calendarLoading = false
        this.$nextTick(() => this.positionCalendarSearch())
      }
      if (!this._calendarProvider) {
        apply([])
        return
      }
      this.calendarLoading = true
      this._calendarProvider
        .search({ query: '', range: 'future' })
        .then(apply)
        // 接口失败按「没有可选日程」处理：面板空态文案本来就是「没有匹配的搜索结果」，
        // 再叠一层错误态是飞书没有的东西（02 §26 面板里只有 header + 搜索框 + 结果区）。
        .catch(() => apply([]))
    },
    onCalendarQueryInput(event) {
      this.calendarQuery = event && event.target ? event.target.value : ''
      this.calendarActiveIndex = 0
    },
    setCalendarActive(index) {
      if (index < 0 || index >= this.calendarResults.length) return
      this.calendarActiveIndex = index
    },
    moveCalendarActive(step) {
      const total = this.calendarResults.length
      if (!total) return
      this.calendarActiveIndex = (this.calendarActiveIndex + step + total) % total
    },
    /**
     * 点结果行 / 输入框里按 Enter —— **点行即插，无二次确认**（02 §26 ⑤）。
     * 落块后光标移到卡片之后（04 §4.7 ⑤）由 `insertContent` 的默认行为给出：
     * atom 块插完选区落在其后，`focus()` 再把它交给编辑器。
     */
    chooseCalendarEvent(item) {
      const entry = item || this.calendarResults[this.calendarActiveIndex]
      if (!entry || !this.editor || !this.writable()) return
      const attrs = normalizeCalendarEvent(entry)
      if (!attrs) return
      this.closeCalendarSearch()
      // 走 `setCalendarEvent` 而不是裸 insertContent：命令里带 schema 探路与 attrs 校验，
      // 直接 insertContent 会把非法 attrs 塞进文档（渲染期才炸）。
      this.editor.chain().focus().setCalendarEvent(attrs).run()
    },
    closeCalendarSearch() {
      this._calendarToken += 1
      this.calendarOpen = false
      this.calendarQuery = ''
      this.calendarEvents = []
      this.calendarActiveIndex = 0
      this.calendarLoading = false
      this.calendarStyle = {}
    },
    /** 面板固定定位：默认贴选区下方 6px，下方放不下且上方更宽裕时翻到上方。 */
    calendarStyleAt(pos) {
      const coords = this.editor.view.coordsAtPos(pos)
      return this.fitCalendarStyle(coords, PANEL_HEIGHT)
    },
    fitCalendarStyle(coords, height) {
      const spaceBelow = window.innerHeight - coords.bottom - VIEWPORT_MARGIN
      const spaceAbove = coords.top - VIEWPORT_MARGIN
      const placeAbove = spaceBelow < height && spaceAbove > spaceBelow
      const top = placeAbove ? coords.top - height - PANEL_GAP : coords.bottom + PANEL_GAP
      const widest = window.innerWidth - VIEWPORT_MARGIN * 2
      const width = Math.min(PANEL_WIDTH, widest)
      const left = Math.max(VIEWPORT_MARGIN, Math.min(window.innerWidth - width - VIEWPORT_MARGIN, coords.left))
      return { left: `${left}px`, top: `${Math.max(VIEWPORT_MARGIN, top)}px` }
    },
    /**
     * 面板高度恒 360（结果区是**固定槽**，空态不收缩 —— 02 §26 ⑧），所以这里读
     * `offsetHeight` 只为窄屏 `max-height` 兜底，不是每次输入都要重算。
     */
    positionCalendarSearch() {
      if (!this.calendarOpen || !this.editor) return
      const panel = this.$refs.root ? this.$refs.root.querySelector('.lark-doc-calendar-search') : null
      const height = panel ? panel.offsetHeight : PANEL_HEIGHT
      this.calendarStyle = this.fitCalendarStyle(this.editor.view.coordsAtPos(this.editor.state.selection.from), height)
    },
    /**
     * 输入框失焦。结果行都是 `@mousedown.prevent`，所以「点结果行」不会走到这里；
     * 真走到这里说明用户去点正文 / 工具栏 / 别的浮层了，与「点外部」等价。
     */
    onCalendarBlur() {
      if (!this.calendarOpen) return
      this.closeCalendarSearch()
    },
  },
}
