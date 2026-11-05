/**
 * 顶栏「通知」popover（requirements/04 §4.6.4，batch106 空态全采）。
 *
 * 尺寸：外壳 **402×555**、z **999**（比「更多/新建」的 1030 低一档，`04 §0.3`），
 * 外壳透明底 + padding `3px 0 0`，白底在内层 content。
 *
 * 头部四件套（都在一行，402 − 2×12 padding = 378 可用宽）：
 *   标题「当前文档通知」**14px/700 `#1F2329`**（84×17）+ 铃铛 **14×14** +
 *   「关闭通知」**56×22 14px/400** + 「全部已读」**56×17 14px/400 `#BBBFC4`**（禁用态）。
 *
 * 空态是三件套（`04 §4.6.4` 🔑）：
 *   插图 **120×120** + 主文案 64×24 **16px/500** + 副文案 **250×66 14px `#646A73`**。
 *
 * 🔴 DOM 链比别的浮层多包两层 loading 容器（`ud__loading-nested-loading` →
 * `ud__loading__container`），后者必须 `position: relative`。复刻保留这两层 ——
 * 宿主以后要塞骨架屏/加载指示器时，改 `notifyLoading` 即可，不用动结构。
 *
 * 数据来源：可选 session notifications Provider；未配置时保留 `setNotifications(list)`
 * 和 notify-* 宿主事件。Provider 列表支持数组或 `{ items, muted }` 快照；订阅只触发
 * 回读，不猜测事件载荷。写操作经 ProviderTask 记录，成功回执及回读后才发成功事件。
 */
import { anchorPopoverStyle } from './popoverPosition'
import { runProviderTask } from '../../../providers/provider-task'

let notifyWriteId = 0

/** 外壳尺寸（实测 402×555）。 */
export const NOTIFY_SIZE = Object.freeze({ width: 402, height: 555 })

export const NOTIFY_TITLE = '当前文档通知'

export default {
  data() {
    return {
      notifyOpen: false,
      notifyAnchor: null,
      notifyStyle: { left: 0, top: 0 },
      /** 宿主注入的通知列表（按 createdAt 倒序由宿主保证，这里不排序）。 */
      notifyItems: [],
      /** 是否处于「已关闭通知」态（文案随之变「开启通知」）。 */
      notifyMuted: false,
      /** 加载中：保留双层 loading 容器，骨架屏由宿主决定要不要用。 */
      notifyLoading: false,
      notifyLoadError: '',
      notifyWriting: false,
      notifyTaskId: '',
    }
  },
  computed: {
    notifyContext() { return this.notificationContext() },
    notifyUnreadCount() {
      const list = this.notifyItems || []
      let count = 0
      for (let i = 0; i < list.length; i += 1) if (!list[i].readAt) count += 1
      return count
    },
    /** 「全部已读」的禁用态：0 条未读即 `#BBBFC4`（`04 §4.6.4` 的 `disable-text`）。 */
    notifyAllReadDisabled() {
      return this.notifyUnreadCount === 0 || this.notifyWriting || this.notifyLoading
    },
    /** 头部右侧按钮文案（关闭 ⇄ 开启）。 */
    notifyMuteLabel() {
      return this.notifyMuted ? '开启通知' : '关闭通知'
    },
    notifyEmpty() {
      return !this.notifyLoading && !this.notifyLoadError && (!this.notifyItems || this.notifyItems.length === 0)
    },
  },
  watch: {
    notifyContext() { return this.bindNotifications() },
  },
  mounted() { return this.bindNotifications() },
  beforeDestroy() {
    this._notifyDisposed = true
    this.releaseNotifications()
  },
  methods: {
    notificationContext() {
      const session = this.session
      const user = session && session.user
      return {
        session,
        documentId: session && session.documentId,
        user,
        userId: user && user.id,
        provider: session && typeof session.getProvider === 'function' ? session.getProvider('notifications') : null,
        canView: !session || typeof session.can !== 'function' || session.can('canView'),
        destroyed: Boolean(session && session._destroyed),
      }
    },
    notifyCurrent(context) {
      // 直接读 Session，不依赖 Vue computed 缓存；原地换账号也隔离迟到响应。
      const current = this.notificationContext()
      return !this._notifyDisposed && !this._isBeingDestroyed && !this._isDestroyed
        && !(context.session && context.session._destroyed)
        && current.session === context.session && current.documentId === context.documentId
        && current.user === context.user && current.userId === context.userId
        && current.provider === context.provider && current.canView
    },
    setNotifyError(message, kind) {
      // 不同故障独立保留：读取恢复不代表订阅或写入故障已恢复。
      const errors = this._notifyErrors || (this._notifyErrors = {})
      delete errors[kind]
      errors[kind] = message
      this._notifyError = message
      this._notifyErrorKind = kind
      this.error = message
    },
    clearNotifyError(kind) {
      const errors = this._notifyErrors || {}
      if (kind) delete errors[kind]
      else this._notifyErrors = {}
      const remaining = kind ? Object.keys(errors) : []
      const nextKind = remaining[remaining.length - 1] || ''
      const nextError = nextKind ? errors[nextKind] : ''
      // 只更新仍归通知所有的错误槽，不能清除宿主后写入的无关错误。
      if (this._notifyError && this.error === this._notifyError) this.error = nextError
      this._notifyError = nextError
      this._notifyErrorKind = nextKind
    },
    async releaseNotifySubscription(off, context) {
      if (typeof off !== 'function') return
      try { await off() } catch (error) {
        if (context && this.notifyCurrent(context)) this.setNotifyError('通知订阅释放失败，请刷新后重试', 'subscription')
      }
    },
    releaseNotifications() {
      const context = this._notifyBinding
      this._notifyBinding = null
      this._notifyLoadToken = null
      this._notifyWriteToken = null
      this.notifyLoading = false
      this.notifyWriting = false
      const off = this._notifyOff
      this._notifyOff = null
      return this.releaseNotifySubscription(off, context)
    },
    async bindNotifications() {
      if (this._notifyDisposed || this._isBeingDestroyed || this._isDestroyed) return null
      const previous = this._notifyBinding
      this.clearNotifyError()
      this.releaseNotifications()
      const context = this.notificationContext()
      // 首次无 Provider 挂载保留宿主注入；切换上下文后不展示上一文档或账号的通知。
      if (previous || context.provider || !context.canView || context.destroyed) {
        this.notifyItems = []
        this.notifyLoadError = ''
        this.notifyMuted = false
        this.closeNotify()
      }
      this._notifyBinding = context
      if (!context.provider || !this.notifyCurrent(context)) return null
      if (typeof context.provider.subscribe === 'function') {
        let off
        try {
          off = context.provider.subscribe(() => {
            if (this._notifyBinding !== context || !this.notifyCurrent(context)) return null
            return this.loadNotifications()
          }, { documentId: context.documentId, user: context.user })
        } catch (error) {
          if (this.notifyCurrent(context)) this.setNotifyError('通知订阅失败，请刷新后重试', 'subscription')
        }
        if (typeof off === 'function') {
          if (this._notifyBinding === context && this.notifyCurrent(context)) this._notifyOff = off
          else this.releaseNotifySubscription(off, context)
        }
      }
      if (this._notifyBinding !== context || !this.notifyCurrent(context)) return null
      return this.loadNotifications()
    },
    async loadNotifications(options = {}) {
      const context = this.notificationContext()
      if (!context.provider || !this.notifyCurrent(context)) return null
      const token = {}
      this._notifyLoadToken = token
      this.notifyLoading = true
      const current = () => this._notifyLoadToken === token && this.notifyCurrent(context)
      try {
        const result = await context.provider.list({ documentId: context.documentId, user: context.user })
        if (!current()) return null
        const items = Array.isArray(result) ? result : result && result.items
        if (!Array.isArray(items) || items.some(item => !item || typeof item !== 'object' || Array.isArray(item))) {
          throw new Error('通知列表格式无效')
        }
        this.notifyItems = items.map(item => ({ ...item }))
        this.clearNotifyError('load')
        this.notifyLoadError = ''
        if (result && typeof result.muted === 'boolean') this.notifyMuted = result.muted
        else if (typeof options.muted === 'boolean') this.notifyMuted = options.muted
        return this.notifyItems
      } catch (error) {
        if (current()) {
          this.notifyLoadError = '通知读取失败，请重新打开通知或刷新重试'
          this.setNotifyError(this.notifyLoadError, 'load')
        }
        return null
      } finally {
        if (this._notifyLoadToken === token) {
          // 保留最近一次读取的标识，写后回读完成到 emit 之间仍需识别并发读取。
          this.notifyLoading = false
        }
      }
    },
    async writeNotifications(method, muted) {
      const context = this.notificationContext()
      if (!context.provider || !this.notifyCurrent(context) || this.notifyWriting || this.notifyLoading) return null
      const token = {}
      this._notifyWriteToken = token
      this.notifyWriting = true
      const current = () => this._notifyWriteToken === token && this.notifyCurrent(context)
      const input = { documentId: context.documentId, user: context.user }
      this.notifyTaskId = `notifications_write_${++notifyWriteId}`
      try {
        const result = await runProviderTask({ taskId: this.notifyTaskId, kind: `notifications.${method}` }, async () => {
          const result = method === 'setMuted'
            ? await context.provider.setMuted(muted, input)
            : await context.provider.markAllRead(input)
          const receipt = result && typeof result === 'object' ? result : {}
          const code = receipt.code
          if (result === false || receipt.ok === false || receipt.allowed === false
            || (receipt.status && !['queued', 'running', 'partial', 'succeeded'].includes(receipt.status))
            || (typeof code === 'number' && code !== 0)
            || (typeof code === 'string' && code !== '' && !['0', 'OK', 'SUCCESS'].includes(code.toUpperCase()))) {
            throw new Error('通知写入未获成功确认')
          }
          return result
        })
        if (!current()) return null
        if (result && result.status && result.status !== 'succeeded') {
          this.setNotifyError('通知设置未完成，请稍后重新打开通知回读', 'write')
          this.loadNotifications()
          return null
        }
        const loading = this.loadNotifications(method === 'setMuted' ? { muted } : {})
        const loadToken = this._notifyLoadToken
        const items = await loading
        if (!current()) return null
        if (this._notifyLoadToken !== loadToken) {
          this.setNotifyError('通知设置已确认，但回读已被新请求替代，请重新打开通知确认', 'load')
          return null
        }
        if (items === null) {
          this.setNotifyError('通知设置已确认，但回读失败，请重新打开通知或刷新重试', 'load')
          return null
        }
        this.clearNotifyError('write')
        this.$emit(method === 'setMuted' ? 'notify-mute' : 'notify-read', method === 'setMuted' ? { muted: this.notifyMuted } : { all: true })
        return true
      } catch (error) {
        if (!current()) return null
        this.setNotifyError('通知设置未完成，请重新打开通知或刷新后重试', 'write')
        this.loadNotifications()
        return null
      } finally {
        if (this._notifyWriteToken === token) {
          this._notifyWriteToken = null
          this.notifyWriting = false
        }
      }
    },
    toggleNotify(event) {
      if (this.notifyOpen) {
        this.closeNotify()
        return
      }
      if (!this.notifyCurrent(this.notificationContext())) return
      const el = event && event.currentTarget
      const rect = el && el.getBoundingClientRect ? el.getBoundingClientRect() : null
      if (!rect) return
      this.notifyAnchor = rect
      this.notifyOpen = true
      this.notifyStyle = anchorPopoverStyle(rect, NOTIFY_SIZE, {
        width: window.innerWidth,
        height: window.innerHeight,
      }, { align: 'right' })
      this.$emit('notify-open')
      if (this.notifyContext.provider) this.loadNotifications()
      this.$nextTick(this.measureNotify)
    },
    closeNotify() {
      this.notifyOpen = false
      this.notifyAnchor = null
    },
    measureNotify() {
      const el = this._notificationsUi && this._notificationsUi.el
      if (!el || !this.notifyAnchor) return
      this.notifyStyle = anchorPopoverStyle(this.notifyAnchor, el.getBoundingClientRect(), {
        width: window.innerWidth,
        height: window.innerHeight,
      }, { align: 'right' })
    },
    /** 宿主喂数据（不动开关，可在打开前后任意时刻调）。 */
    setNotifications(list) {
      this.notifyItems = Array.isArray(list) ? list : []
    },
    /** 有 Provider 时持久化并回读；无 Provider 时保留本地兼容行为，不关面板。 */
    markAllNotifyRead() {
      if (!this.notifyCurrent(this.notifyContext) || this.notifyAllReadDisabled) return null
      if (this.notifyContext.provider) return this.writeNotifications('markAllRead')
      const now = Date.now()
      this.notifyItems = this.notifyItems.map((item) => (item.readAt ? item : { ...item, readAt: now }))
      this.$emit('notify-read', { all: true })
    },
    toggleNotifyMute() {
      if (!this.notifyCurrent(this.notifyContext) || this.notifyWriting || this.notifyLoading) return null
      if (this.notifyContext.provider) return this.writeNotifications('setMuted', !this.notifyMuted)
      this.notifyMuted = !this.notifyMuted
      this.$emit('notify-mute', { muted: this.notifyMuted })
    },
    notifyContains(node) {
      if (!node || !node.closest) return false
      return Boolean(node.closest('.lark-doc-notify-popover, .lark-doc-notify-btn'))
    },
  },
}
