/**
 * mentionMixin — `@` 提及面板（P4-01）的开关、定位、候选刷新、键盘导航与落 chip。
 *
 * 与斜杠菜单的三处**有意差异**（口径见 02 §19.3）：
 *   1. 关键词不在面板输入框里，而是**正文里的 `@` 后面**那段文字 —— 所以本模块不持有
 *      输入组件，每次文档事务由 `document.js` 的插件回调 `onMention(match)` 推进状态。
 *   2. 面板不抢焦点：候选行 `@mousedown.prevent`，落 chip 后焦点仍在正文。
 *   3. `Esc` 只收面板、**保留已输入的 `@` 文字**（不删、不清空）。
 *
 * 远端HTTP授权使用受限resolver，不回落示例名单；独立本地模式保留
 * `mentionSource`（数组或 `{ search }`）及本地目录过滤。
 */
import { MENTION_SEARCH_LIMIT, createMentionProvider, searchMentionDirectory } from '../../../core/mention/directory'
import { projectCapabilityUi } from '../../../core/policy/capability'
// `MENTION_EMPTY_TEXT` 住在 block 侧（与 `MENTION_LIMITS` / `MENTION_UNKNOWN_NAME` 同一处文案表），
// `core/mention/directory` 不导出它。早前一行里连它一起从 directory 导入，打包器只报
// 「export 'MENTION_EMPTY_TEXT' was not found」，运行期拿到 `undefined` —— 面板空态于是
// 渲染成空白（`{{ mentionLoading ? '搜索中…' : mentionEmptyText }}`），且没有任何断言看得见。
import { MENTION_EMPTY_TEXT } from '../../../core/blocks/mention'
import { closeHistory } from '@tiptap/pm/history'

/** 面板 tab：飞书是「全部 / 人 / 云文档 / 群名片」四个（任务清单不单列 tab）。 */
export const MENTION_TABS = Object.freeze([
  { id: 'all', label: '全部' },
  { id: 'user', label: '人' },
  { id: 'page', label: '云文档' },
  { id: 'chat', label: '群名片' },
])

const PANEL_WIDTH = 362
const PANEL_MIN_HEIGHT = 168
const PANEL_GAP = 6
const VIEWPORT_MARGIN = 8
const REMOTE_ID = /^[A-Za-z0-9._-]{1,128}(?![\s\S])/
const REMOTE_DECIMAL = /^(0|[1-9][0-9]*)(?![\s\S])/

function remoteCandidate(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !['user', 'page'].includes(value.kind)) return null
  const id = value.kind === 'page' ? value.docId : value.principalId
  if (typeof id !== 'string' || !REMOTE_ID.test(id) || typeof value.displayName !== 'string' || !value.displayName.trim() ||
    value.displayName.length > (value.kind === 'page' ? 255 : 64) || /\p{Cc}/u.test(value.displayName)) return null
  return { kind: value.kind, id, name: value.displayName }
}

function remoteResolution(result, kinds, provider, session) {
  if (!result || typeof result !== 'object' || Array.isArray(result) || result.status !== 'resolved' ||
    ['operationId', 'tenantId', 'docId', 'sourceEpoch', 'sourceSeq', 'requestHash'].some(field => typeof result[field] !== 'string') || !REMOTE_ID.test(result.operationId) ||
    !/^sha256:[a-f0-9]{64}(?![\s\S])/.test(result.requestHash) || !REMOTE_ID.test(result.tenantId) || !REMOTE_ID.test(result.docId) ||
    !REMOTE_DECIMAL.test(result.sourceEpoch) || !REMOTE_DECIMAL.test(result.sourceSeq) || result.persisted !== true ||
    result.notified !== false || result.shared !== false || !Array.isArray(result.candidates) || result.candidates.length > MENTION_SEARCH_LIMIT) return null
  const scope = provider.getScope?.()
  if (scope && (scope.tenantId !== result.tenantId || scope.docId !== result.docId) || session.documentId && session.documentId !== result.docId) return null
  const seen = new Set()
  for (const value of result.candidates) {
    const item = remoteCandidate(value), key = item && `${item.kind}:${item.id}`
    if (!item || !kinds.includes(item.kind) || seen.has(key)) return null
    seen.add(key)
  }
  return Object.freeze({ ...result, candidates: Object.freeze(result.candidates.map(value => Object.freeze({ ...value }))) })
}

function insertMention(editor, range, attrs, focus = false) {
  const managers = editor.state.plugins.map(plugin => plugin.getState(editor.state)?.undoManager).filter(Boolean)
  managers.forEach(manager => manager.stopCapturing())
  try {
    let chain = editor.chain()
    if (focus) chain = chain.focus()
    return chain.command(({ tr }) => { closeHistory(tr); return true }).deleteRange(range).setMention(attrs).run()
  } finally {
    editor.view.dispatch(closeHistory(editor.state.tr))
    managers.forEach(manager => manager.stopCapturing())
  }
}

export default {
  data() {
    return {
      mentionOpen: false,
      mentionQuery: '',
      mentionKind: 'all',
      mentionRange: null,
      mentionItems: [],
      mentionActiveIndex: 0,
      mentionNotify: false,
      mentionLoading: false,
      mentionStyle: {},
      mentionTabs: MENTION_TABS,
      mentionEmptyText: MENTION_EMPTY_TEXT,
      mentionRequestState: null,
      mentionPendingOperation: '',
      mentionMessage: '',
    }
  },
  computed: {
    mentionDirectory() { return Array.isArray(this.mentionSource) ? this.mentionSource : [] },
    mentionRemote() {
      const provider = this.mentionAuthorization()
      return Boolean(provider && provider.isRemote && typeof provider.resolveMentions === 'function')
    },
  },
  created() {
    // provider 只建一次：宿主传函数时每次访问都会新包一层 timeout 计时器。
    this._mentionProvider = createMentionProvider(this.mentionSource)
    // 异步搜索的序号闸门：慢请求回来晚于新一次输入时直接丢弃（避免旧结果盖新结果）。
    this._mentionToken = 0
  },
  mounted() {
    this.bindMentionCapabilities()
  },
  watch: {
    mentionSource(value) {
      this._mentionToken += 1
      this._mentionProvider = createMentionProvider(value)
      if (this.mentionOpen) this.refreshMentionItems()
    },
    effectiveReadonly(value) { if (value) this.closeMentionPanel() },
    session(value, prior) {
      if (value === prior) return
      this.closeMentionPanel(); this.mentionPendingOperation = ''; this.mentionMessage = ''; this.bindMentionCapabilities()
    },
    'session.user.id'(value, prior) { if (value !== prior) { this.closeMentionPanel(); this.mentionPendingOperation = ''; this.mentionMessage = '' } },
  },
  beforeDestroy() {
    this._mentionDisposed = true; this._mentionToken++
    if (this._mentionStopCapabilities) this._mentionStopCapabilities()
  },
  methods: {
    mentionIsMobile() {
      return this._mobileEditorMedia?.matches ?? this._mentionMedia?.matches
        ?? (typeof window !== 'undefined' && window.matchMedia?.('(max-width: 760px) and (pointer: coarse)')?.matches === true)
    },
    mentionAuthorization() { return this.session && typeof this.session.getProvider === 'function' ? this.session.getProvider('authorization') : null },
    remoteMentionContext() {
      const session = this.session, provider = this.mentionAuthorization(), editor = this.editor, user = session?.user, actor = user?.id
      const doc = editor?.state?.doc
      const documentId = session?.documentId, identity = session?._privateIdentityGeneration, identityGeneration = session?._identityGeneration
      const authorization = session?._authorizationGeneration
      const owner = () => !this._mentionDisposed && !this._isDestroyed && !this._isBeingDestroyed && !session?._destroyed &&
        session === this.session && provider === this.mentionAuthorization() && editor === this.editor && !editor?.isDestroyed && user === session?.user &&
        actor === session?.user?.id && documentId === session?.documentId && identity === session?._privateIdentityGeneration && identityGeneration === session?._identityGeneration
      return { provider, session, owner, current: () => owner() && doc === editor?.state?.doc && authorization === session?._authorizationGeneration && session.can('canView') }
    },
    bindMentionCapabilities() {
      if (this._mentionStopCapabilities) this._mentionStopCapabilities()
      const session = this.session
      const stops = []
      const context = this.remoteMentionContext()
      const capabilityStop = session && typeof session.on === 'function' ? session.on('capabilities', () => {
        if (session === this.session && (this.mentionRemote || !session.can('canView'))) this.closeMentionPanel()
      }) : null
      if (typeof capabilityStop === 'function') stops.push(capabilityStop)
      for (const name of ['identity', 'provider-changed']) {
        const stop = session?.on?.(name, () => {
          if (!context.owner()) { this.closeMentionPanel(); this.mentionPendingOperation = ''; this._mentionPendingOwner = null }
        })
        if (typeof stop === 'function') stops.push(stop)
      }
      this._mentionStopCapabilities = () => stops.forEach(stop => stop())
    },
    /**
     * 文档插件每帧回调（同 `onSlash` 口径）。`match === null` = `@` 上下文已消失
     * （光标移开 / 删掉 @ / 组字开始 / Esc），此时只收面板、不动正文。
     */
    onMention(match) {
      if (this._isDestroyed) return
      if (!match || !this.writable() || this.effectiveReadonly || !projectCapabilityUi(this.session, 'canEdit').allowed) {
        if (this.mentionOpen) this.closeMentionPanel()
        return
      }
      const wasOpen = this.mentionOpen
      if (this.mentionIsMobile() && this.mentionKind === 'all') this.mentionKind = 'user'
      if (!wasOpen && this.mentionRemote) this.mentionNotify = false
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
        this.mentionItems = (Array.isArray(items) ? items : []).filter(item => kind === 'all' || item?.kind === kind).slice(0, MENTION_SEARCH_LIMIT)
        if (this.mentionActiveIndex >= this.mentionItems.length) this.mentionActiveIndex = 0
        this.mentionLoading = false
        this.$nextTick(() => this.positionMentionPanel())
      }
      if (this.mentionRemote) {
        const context = this.remoteMentionContext(), { session } = context
        const current = () => token === this._mentionToken && this.mentionOpen && context.current()
        this.mentionItems = []; this.mentionRequestState = null
        if (!['all', 'user', 'page'].includes(kind)) {
          this.mentionLoading = false
          this.mentionMessage = `${kind === 'page' ? '云文档' : '群名片'}候选服务尚未提供，当前不可用。`
          return
        }
        if (this._mentionPendingOwner && !this._mentionPendingOwner()) { this.mentionPendingOperation = ''; this._mentionPendingOwner = null }
        if (this.mentionPendingOperation) { this.mentionLoading = false; this.mentionMessage = '请查询原目录请求。'; return }
        const kinds = kind === 'all' ? ['user', 'page'] : [kind]
        this.mentionLoading = true; this.mentionMessage = kind === 'page' ? '查询云文档中。' : '查询候选中。'
        session.resolveMentions({ query, kinds }).then(result => {
          if (!current()) return
          this.applyRemoteMentionResult(result, kinds, context); this.mentionLoading = false
          this.$nextTick(() => this.positionMentionPanel())
        }).catch(error => {
          if (!current()) return
          this.mentionLoading = false
          if (error.status === 'unknown' && error.operationId) { this.mentionPendingOperation = error.operationId; this._mentionPendingOwner = context.owner; this._mentionPendingKinds = kinds }
          this.mentionMessage = error.status === 'unknown' ? '目录未确认，请查询原请求。' : '目录未接通或来源有变，请重查。'
        })
        return
      }
      this.mentionMessage = ''
      if (this._mentionProvider) {
        this.mentionLoading = true
        this._mentionProvider.search(query, { kind }).then(apply).catch(() => {
          if (token !== this._mentionToken || !this.mentionOpen) return
          this.mentionItems = []; this.mentionLoading = false
          this.mentionMessage = '候选加载失败，请重试。'
        })
        return
      }
      if (!Array.isArray(this.mentionSource)) this.mentionMessage = '尚未配置提及候选服务，当前不可用。'
      apply(searchMentionDirectory(this.mentionDirectory, query, kind, MENTION_SEARCH_LIMIT))
    },
    applyRemoteMentionResult(result, kinds, context = this.remoteMentionContext()) {
      kinds ||= this.mentionKind === 'all' ? ['user', 'page'] : [this.mentionKind]
      const confirmed = remoteResolution(result, kinds, context.provider, context.session)
      this.mentionRequestState = confirmed || (result?.status !== 'resolved' ? result : null)
      this._mentionResultCurrent = confirmed ? context.current : null
      this._mentionResultKinds = kinds
      this.mentionItems = confirmed ? confirmed.candidates.map(remoteCandidate).filter(item => this.mentionKind === 'all' || item.kind === this.mentionKind) : []
      this.mentionActiveIndex = 0
      this.mentionMessage = confirmed ? '候选已确认；未发送通知或分享。'
        : '目录未接通；未发送通知或分享。'
      return confirmed
    },
    setMentionKind(kind) {
      if (this.mentionKind === kind || !MENTION_TABS.some(tab => tab.id === kind)) return
      this.mentionItems = []
      this.mentionRequestState = null
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
    async queryPendingMention() {
      if (!this.mentionPendingOperation || this.mentionLoading) return null
      if (this._mentionPendingOwner && !this._mentionPendingOwner()) { this.mentionPendingOperation = ''; this._mentionPendingOwner = null; return null }
      const id = this.mentionPendingOperation, token = ++this._mentionToken, context = this.remoteMentionContext(), { session } = context
      const current = () => token === this._mentionToken && this.mentionOpen && context.current()
      this.mentionLoading = true; this.mentionRequestState = null; this.mentionItems = []
      try {
        const result = await session.queryMentionResolution(id)
        if (!current()) return null
        const kinds = this._mentionPendingKinds || (this.mentionKind === 'all' || this.mentionKind === 'chat' ? ['user', 'page'] : [this.mentionKind])
        if (result?.operationId !== id || !this.applyRemoteMentionResult(result, kinds, context)) {
          this.mentionMessage = '原请求尚未确认，请继续查询原请求。'; return null
        }
        this.mentionPendingOperation = ''; this._mentionPendingOwner = null; this._mentionPendingKinds = null
        if (this.mentionKind === 'chat') this.mentionMessage = '群名片候选服务尚未提供，当前不可用。'
        else if (!this.mentionItems.length && !kinds.includes(this.mentionKind)) this.mentionMessage = '原目录请求已确认，请重新查询当前分类。'
        return result
      } catch (error) {
        if (current()) {
          if (error.code === 'MENTION_SOURCE_CONFLICT' && (error.httpStatus === 409 || error.status === 409)) {
            this.mentionPendingOperation = ''; this._mentionPendingOwner = null; this._mentionPendingKinds = null
          }
          this.mentionMessage = '原请求不可用；未通知或分享。'
        }
        return null
      } finally { if (current()) this.mentionLoading = false }
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
      if (this.mentionRemote) return this.chooseRemoteMention(item)
      const entry = item || this.mentionItems[this.mentionActiveIndex]
      const range = this.mentionRange
      if (!entry || !range || !this.editor || !this.writable() || !projectCapabilityUi(this.session, 'canEdit').allowed) return
      const attrs = {
        kind: entry.kind,
        id: entry.id,
        name: entry.name,
        department: entry.department,
        notify: entry.kind === 'user' && !!this.mentionNotify,
      }
      this.closeMentionPanel()
      // 走 `setMention` 而不是裸 `insertContent`：`mentionId` 由 `normalizeMention`
      // 当场补齐（缺失时造一个 UUID），直接 insertContent 会漏掉这个文档内实例 id。
      return insertMention(this.editor, range, attrs, true)
    },
    async chooseRemoteMention(item) {
      const entry = item || this.mentionItems[this.mentionActiveIndex], resolution = this.mentionRequestState
      const editor = this.editor, session = this.session, authorization = this.mentionAuthorization(), range = this.mentionRange
      if (this.mentionLoading || !resolution || resolution.status !== 'resolved' || !entry || !range || !editor ||
        !this._mentionResultCurrent?.() || !this.mentionItems.some(value => value.id === entry.id && value.kind === entry.kind && value.name === entry.name) ||
        !resolution.candidates.some(value => { const candidate = remoteCandidate(value); return candidate?.id === entry.id && candidate.kind === entry.kind })) {
        this.mentionMessage = '尚未验证真实提及目标，请重查。'; return null
      }
      const selection = editor.state && editor.state.selection, doc = editor.state && editor.state.doc
      if (!selection || !Number.isSafeInteger(selection.from) || !Number.isSafeInteger(selection.to)) return null
      const token = ++this._mentionToken, position = { from: range.from, to: range.to }, cursor = { from: selection.from, to: selection.to }
      const context = this.remoteMentionContext(), kinds = this._mentionResultKinds, identity = session && session.user && session.user.id
      const notifyIntent = this.mentionNotify === true, notify = entry.kind === 'user' && notifyIntent, kind = this.mentionKind
      const current = () => !this._mentionDisposed && !this._isDestroyed && token === this._mentionToken && this.mentionOpen &&
        this.editor === editor && !editor.isDestroyed && session === this.session && authorization === this.mentionAuthorization() &&
        context.current() && identity === (this.session && this.session.user && this.session.user.id) && (this.mentionNotify === true) === notifyIntent && this.mentionKind === kind &&
        session.can('canView') && session.can('canEdit') && this.writable() && !this.effectiveReadonly && editor.isFocused === true &&
        editor.view && typeof editor.view.hasFocus === 'function' && editor.view.hasFocus() && editor.state.doc === doc &&
        editor.state.selection.from === cursor.from && editor.state.selection.to === cursor.to && this.mentionRange &&
        this.mentionRange.from === position.from && this.mentionRange.to === position.to
      if (!current()) { this.mentionItems = []; this.mentionRequestState = null; return null }
      this.mentionLoading = true; this.mentionItems = []; this.mentionRequestState = null
      try {
        const result = remoteResolution(await session.queryMentionResolution(resolution.operationId), kinds, authorization, session)
        if (!current()) return null
        const target = result && result.operationId === resolution.operationId && result.requestHash === resolution.requestHash &&
          result.tenantId === resolution.tenantId && result.docId === resolution.docId &&
          result.sourceEpoch === resolution.sourceEpoch && result.sourceSeq === resolution.sourceSeq && result.persisted === true &&
          result.notified === false && result.shared === false && result.candidates.map(remoteCandidate).find(value => value.id === entry.id && value.kind === entry.kind)
        if (!target) { this.mentionMessage = '候选已失效，请重查。'; return null }
        this.closeMentionPanel()
        const inserted = insertMention(editor, position, { id: target.id, name: target.name, kind: target.kind, notify })
        this.mentionMessage = inserted ? (notify ? '已插入；等待正文确认与通知处理，未分享。' : '已插入；未请求通知，未分享。') : '提及未插入，请重新查询。'
        return inserted
      } catch (error) {
        if (current()) {
          if (error.status === 'unknown') { this.mentionPendingOperation = resolution.operationId; this._mentionPendingOwner = context.owner; this._mentionPendingKinds = kinds }
          this.mentionMessage = '目标或来源未确认，请查原请求。'
        }
        return null
      } finally { if (!this._mentionDisposed && token === this._mentionToken) this.mentionLoading = false }
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
      this.mentionRequestState = null
      this._mentionResultCurrent = null
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
    /** 候选数变化会改面板高度（空态 168 / 每行 +48），落完 DOM 再校一次上下翻转。 */
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
