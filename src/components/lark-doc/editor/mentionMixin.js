/**
 * mentionMixin — `@` 提及面板（P4-01）的开关、定位、候选刷新、键盘导航与落 chip。
 *
 * 与斜杠菜单的三处**有意差异**（口径见 02 §19.3）：
 *   1. 关键词不在面板输入框里，而是**正文里的 `@` 后面**那段文字 —— 所以本模块不持有
 *      输入组件，每次文档事务由 `document.js` 的插件回调 `onMention(match)` 推进状态。
 *   2. 面板不抢焦点：候选行 `@mousedown.prevent`，落 chip 后焦点仍在正文。
 *   3. `Esc` 只收面板、**保留已输入的 `@` 文字**（不删、不清空）。
 *
 * 候选源两条路：宿主给了 `mentionSource`（数组或 `{ search }`）就走 provider，
 * 没给就用本地名单纯函数过滤 —— 与 unfurl 的「可选 provider」口径一致。
 */
import { MENTION_SEARCH_LIMIT, createMentionProvider, searchMentionDirectory } from '../../../core/mention/directory'
// `MENTION_EMPTY_TEXT` 住在 block 侧（与 `MENTION_LIMITS` / `MENTION_UNKNOWN_NAME` 同一处文案表），
// `core/mention/directory` 不导出它。早前一行里连它一起从 directory 导入，打包器只报
// 「export 'MENTION_EMPTY_TEXT' was not found」，运行期拿到 `undefined` —— 面板空态于是
// 渲染成空白（`{{ mentionLoading ? '搜索中…' : mentionEmptyText }}`），且没有任何断言看得见。
import { MENTION_EMPTY_TEXT } from '../../../core/blocks/mention'

/** 面板 tab：飞书是「全部 / 人 / 云文档 / 群名片」四个（任务清单不单列 tab）。 */
export const MENTION_TABS = Object.freeze([
  { id: 'all', label: '全部' },
  { id: 'user', label: '人员' },
  { id: 'page', label: '云文档' },
  { id: 'chat', label: '群名片' },
])

const PANEL_WIDTH = 360
const PANEL_MIN_HEIGHT = 168
const PANEL_GAP = 6
const VIEWPORT_MARGIN = 8

export default {
  data() {
    return {
      mentionOpen: false,
      mentionQuery: '',
      mentionKind: 'all',
      mentionRange: null,
      mentionItems: [],
      mentionActiveIndex: 0,
      mentionNotify: true,
      mentionLoading: false,
      mentionStyle: {},
      mentionTabs: MENTION_TABS,
      mentionEmptyText: MENTION_EMPTY_TEXT,
    }
  },
  computed: {
    mentionDirectory() { return Array.isArray(this.mentionSource) ? this.mentionSource : [] },
  },
  created() {
    // provider 只建一次：宿主传函数时每次访问都会新包一层 timeout 计时器。
    this._mentionProvider = createMentionProvider(this.mentionSource)
    // 异步搜索的序号闸门：慢请求回来晚于新一次输入时直接丢弃（避免旧结果盖新结果）。
    this._mentionToken = 0
  },
  methods: {
    /**
     * 文档插件每帧回调（同 `onSlash` 口径）。`match === null` = `@` 上下文已消失
     * （光标移开 / 删掉 @ / 组字开始 / Esc），此时只收面板、不动正文。
     */
    onMention(match) {
      if (this._isDestroyed) return
      if (!match || !this.writable() || this.effectiveReadonly) {
        if (this.mentionOpen) this.closeMentionPanel()
        return
      }
      const wasOpen = this.mentionOpen
      // 面板与斜杠菜单互斥：`@` 是独立入口，两者同时开会抢同一组 ↑↓/Enter。
      if (!wasOpen && this.menuOpen) this.closeCommandMenu()
      this.mentionRange = { from: match.from, to: match.to }
      this.mentionOpen = true
      if (match.query !== this.mentionQuery) {
        this.mentionQuery = match.query
        this.mentionActiveIndex = 0
      } else if (!wasOpen) {
        this.mentionActiveIndex = 0
      }
      this.mentionStyle = this.mentionStyleAt(match.from)
      this.refreshMentionItems()
    },
    refreshMentionItems() {
      const token = (this._mentionToken += 1)
      const query = this.mentionQuery
      const kind = this.mentionKind
      const apply = (items) => {
        // 面板已关 / 已被更新的一次搜索顶掉 → 丢弃。
        if (token !== this._mentionToken || !this.mentionOpen) return
        this.mentionItems = (Array.isArray(items) ? items : []).slice(0, MENTION_SEARCH_LIMIT)
        if (this.mentionActiveIndex >= this.mentionItems.length) this.mentionActiveIndex = 0
        this.mentionLoading = false
        this.$nextTick(() => this.positionMentionPanel())
      }
      if (this._mentionProvider) {
        this.mentionLoading = true
        this._mentionProvider.search(query, { kind }).then(apply)
        return
      }
      apply(searchMentionDirectory(this.mentionDirectory, query, kind, MENTION_SEARCH_LIMIT))
    },
    setMentionKind(kind) {
      if (this.mentionKind === kind) return
      this.mentionKind = kind
      this.mentionActiveIndex = 0
      this.refreshMentionItems()
    },
    setMentionActive(index) {
      if (index < 0 || index >= this.mentionItems.length) return
      this.mentionActiveIndex = index
    },
    setMentionNotify(value) {
      this.mentionNotify = Boolean(value)
    },
    /**
     * 命令菜单（斜杠 `人员`）入口：正文里没有 `@`，所以**先补一个 `@`**，剩下的交给
     * 文档插件下一帧回调 `onMention()` —— 一条路径两处入口，不另造一套开面板逻辑。
     *
     * tab 要在插入之前定好：`reportMention` 是同步派发的，`refreshMentionItems()`
     * 读到的是此刻的 `mentionKind`。
     */
    startMention(id) {
      if (!this.editor || !this.writable()) return
      this.mentionKind = id === 'mentionChat' ? 'chat' : id === 'mentionPage' ? 'page' : 'user'
      this.editor.chain().focus().insertContent('@').run()
    },
    moveMention(step) {
      const total = this.mentionItems.length
      if (!total) return
      this.mentionActiveIndex = (this.mentionActiveIndex + step + total) % total
    },
    /** 落 chip：先删掉正文里的 `@关键词`，再在**同一位置**插入 atom（一次事务，可一次撤销）。 */
    chooseMention(item) {
      const entry = item || this.mentionItems[this.mentionActiveIndex]
      const range = this.mentionRange
      if (!entry || !range || !this.editor || !this.writable()) return
      const attrs = {
        kind: entry.kind,
        id: entry.id,
        name: entry.name,
        department: entry.department,
        notify: this.mentionNotify,
      }
      this.closeMentionPanel()
      // 走 `setMention` 而不是裸 `insertContent`：`mentionId` 由 `normalizeMention`
      // 当场补齐（缺失时造一个 UUID），直接 insertContent 会漏掉这个文档内实例 id。
      this.editor.chain().focus().deleteRange(range).setMention(attrs).run()
    },
    closeMentionPanel() {
      this._mentionToken += 1
      this.mentionOpen = false
      this.mentionQuery = ''
      // tab 回默认：命令菜单点「云文档」开的 panel 不该污染下一次手动敲 `@` 的默认页。
      this.mentionKind = 'all'
      this.mentionRange = null
      this.mentionItems = []
      this.mentionActiveIndex = 0
      this.mentionLoading = false
      this.mentionStyle = {}
    },
    /** 面板固定定位：默认贴 `@` 下方 6px，下方放不下且上方更宽裕时翻到上方。 */
    mentionStyleAt(pos) {
      const coords = this.editor.view.coordsAtPos(pos)
      return this.fitMentionStyle(coords, PANEL_MIN_HEIGHT)
    },
    fitMentionStyle(coords, height) {
      const spaceBelow = window.innerHeight - coords.bottom - VIEWPORT_MARGIN
      const spaceAbove = coords.top - VIEWPORT_MARGIN
      const placeAbove = spaceBelow < height && spaceAbove > spaceBelow
      const top = placeAbove ? coords.top - height - PANEL_GAP : coords.bottom + PANEL_GAP
      const widest = window.innerWidth - VIEWPORT_MARGIN * 2
      const width = Math.min(PANEL_WIDTH, widest)
      const left = Math.max(VIEWPORT_MARGIN, Math.min(window.innerWidth - width - VIEWPORT_MARGIN, coords.left))
      return { left: `${left}px`, top: `${Math.max(VIEWPORT_MARGIN, top)}px` }
    },
    /** 候选数变化会改面板高度（空态 168 / 每行 +50），落完 DOM 再校一次上下翻转。 */
    positionMentionPanel() {
      if (!this.mentionOpen || !this.mentionRange || !this.editor) return
      const panel = this.$refs.root ? this.$refs.root.querySelector('.lark-doc-mention-panel') : null
      const height = panel ? panel.offsetHeight : PANEL_MIN_HEIGHT
      this.mentionStyle = this.fitMentionStyle(this.editor.view.coordsAtPos(this.mentionRange.from), height)
    },
    /** 面板打开时接管 ↑↓ / Enter / Esc / Tab（在命令菜单之前判定，两者不会同时开）。 */
    onMentionKeydown(event) {
      if (!this.mentionOpen) return false
      if (event.isComposing || (this.editor && this.editor.view.composing)) return false
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        this.moveMention(event.key === 'ArrowDown' ? 1 : -1)
        return true
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        this.chooseMention()
        return true
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        this.closeMentionPanel()
        return true
      }
      return false
    },
  },
}
