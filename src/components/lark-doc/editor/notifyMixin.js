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
      notifyHasMore: false,
      notifyHistoryLoading: false,
      notifyHistoryError: '',
      notifyOpeningId: '',
      notifyActionError: '',
      notifyPendingId: '',
    }
  },
  computed: {
    notifyContext() { return this.notificationContext() },
    notifyUnreadCount() {
      const list = this.notifyItems || []
      let count = 0
      for (let i = 0; i < list.length; i += 1) {
        const item = list[i]
        if (Object.prototype.hasOwnProperty.call(item, 'read')) {
          if (!item.read) count += 1
        } else if (!item.readAt) count += 1
      }
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
    notifyContext(next, previous) {
      if (previous && Object.keys(next).every(key => Object.is(previous[key], next[key]))) return
      return this.bindNotifications()
    },
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
        identityGeneration: session?._privateIdentityGeneration,
        authorizationGeneration: session?._authorizationGeneration,
      }
    },
    notifyCurrent(context) {
      // 直接读 Session，不依赖 Vue computed 缓存；原地换账号也隔离迟到响应。
      const current = this.notificationContext()
      return !this._notifyDisposed && !this._isBeingDestroyed && !this._isDestroyed
        && !(context.session && context.session._destroyed)
        && current.session === context.session && current.documentId === context.documentId
        && current.user === context.user && current.userId === context.userId
        && current.identityGeneration === context.identityGeneration && current.authorizationGeneration === context.authorizationGeneration
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
      this._notifyMoreToken = null
      this._notifyOpenToken = null
      this.notifyLoading = false
      this.notifyWriting = false
      this.notifyHistoryLoading = false
      this.notifyOpeningId = ''
      const off = this._notifyOff
      this._notifyOff = null
      return this.releaseNotifySubscription(off, context)
    },
    async bindNotifications() {
      if (this._notifyDisposed || this._isBeingDestroyed || this._isDestroyed) return null
      const previous = this._notifyBinding
      const context = this.notificationContext()
      this.clearNotifyError()
      this.releaseNotifications()
      // 首次无 Provider 挂载保留宿主注入；切换上下文后不展示上一文档或账号的通知。
      if (previous || context.provider || !context.canView || context.destroyed) {
        this.notifyItems = []
        this.notifyLoadError = ''
        this.notifyMuted = false
        this.notifyHasMore = false
        this.notifyHistoryError = ''; this.notifyActionError = ''; this.notifyPendingId = ''
        this.closeNotify()
      }
      this._notifyBinding = context
      if (!context.provider || !this.notifyCurrent(context)) return null
      if (typeof context.provider.subscribe === 'function') {
        let off
        try {
          off = context.provider.subscribe((value) => {
            if (this._notifyBinding !== context || !this.notifyCurrent(context)) return null
            // HTTP notifications providers push their complete state. Project it
            // directly instead of reading the provider again: subscribe() emits
            // while snapshot() is in flight, so a read-back here recurses into
            // snapshot -> emit -> listener indefinitely.
            if (value && typeof value === 'object' && Array.isArray(value.items)) {
              this.projectNotifySnapshot(value)
              this.notifyLoading = value.status === 'loading'
              this.notifyLoadError = value.status === 'error' ? '通知读取失败，请重新打开通知或刷新重试' : ''
              if (value.status !== 'error') this.clearNotifyError('load')
              return this.notifyItems
            }
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
      if (context.provider.isRemote && typeof context.provider.subscribe === 'function') return this.notifyItems
      return this.loadNotifications()
    },
    projectNotifySnapshot(result) {
      const items = Array.isArray(result) ? result : result && result.items
      if (!Array.isArray(items) || items.some(item => !item || typeof item !== 'object' || Array.isArray(item))) throw new Error('通知列表格式无效')
      this.notifyItems = items.map(item => ({ ...item, id: item.id || item.notificationId }))
      this.notifyHasMore = result?.hasMore === true && typeof this.notificationContext().provider?.loadMore === 'function'
      this.notifyPendingId = this.notificationContext().provider?.getPendingOperation?.()?.operationId || ''
      if (typeof result?.preference?.muted === 'boolean') this.notifyMuted = result.preference.muted
      else if (typeof result?.muted === 'boolean') this.notifyMuted = result.muted
      return this.notifyItems
    },
    async loadNotifications(options = {}) {
      const context = this.notificationContext()
      if (!context.provider || !this.notifyCurrent(context)) return null
      this._notifyMoreToken = null; this.notifyHistoryLoading = false
      const token = {}
      this._notifyLoadToken = token
      this.notifyLoading = true
      const current = () => this._notifyLoadToken === token && this.notifyCurrent(context)
      try {
        const result = await context.provider.list({ documentId: context.documentId, user: context.user })
        if (!current()) return null
        this.projectNotifySnapshot(result)
        this.clearNotifyError('load')
        this.notifyLoadError = ''
        if (typeof result?.muted !== 'boolean' && typeof result?.preference?.muted !== 'boolean' && typeof options.muted === 'boolean') this.notifyMuted = options.muted
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
    async writeNotifications(method, value) {
      const context = this.notificationContext()
      if (!context.provider || !this.notifyCurrent(context) || this.notifyWriting || this.notifyLoading) return null
      if (context.provider.getPendingOperation?.()) {
        this.notifyActionError = '通知操作结果尚未确认，请先核对原请求。'
        return null
      }
      const token = {}
      this._notifyWriteToken = token
      this.notifyWriting = true
      const current = () => this._notifyWriteToken === token && this.notifyCurrent(context)
      const input = { documentId: context.documentId, user: context.user }
      this.notifyTaskId = `notifications_write_${++notifyWriteId}`
      try {
        const result = await runProviderTask({ taskId: this.notifyTaskId, kind: `notifications.${method}` }, async () => {
          const structured = typeof context.provider.snapshot === 'function' && typeof context.provider.markRead === 'function'
          const result = method === 'markRead' ? await context.provider.markRead({ notificationId: value, value: true })
            : method === 'setMuted' ? await context.provider.setMuted(...(structured ? [{ value }] : [value, input]))
              : await context.provider.markAllRead(structured ? {} : input)
          const receipt = result && typeof result === 'object' ? result : {}
          const code = receipt.code
          if (result === false || receipt.ok === false || receipt.allowed === false
            || (receipt.status && !['queued', 'running', 'partial', 'succeeded', 'committed'].includes(receipt.status))
            || (typeof code === 'number' && code !== 0)
            || (typeof code === 'string' && code !== '' && !['0', 'OK', 'SUCCESS'].includes(code.toUpperCase()))) {
            throw new Error('通知写入未获成功确认')
          }
          return result
        })
        if (!current()) return null
        if (result && result.status && !['succeeded', 'committed'].includes(result.status)) {
          this.setNotifyError('通知设置未完成，请稍后重新打开通知回读', 'write')
          this.loadNotifications()
          return null
        }
        // The remote receipt already updates its authoritative read model. Keep
        // loaded history so opening an older notification does not lose its target.
        const snapshot = typeof context.provider.getState === 'function' ? context.provider.getState() : null
        const remoteReadback = result?.status === 'committed' && !result.viewRefreshRequired && snapshot?.status === 'ready'
        const loading = remoteReadback ? Promise.resolve(this.projectNotifySnapshot(snapshot)) : this.loadNotifications(method === 'setMuted' ? { muted: value } : {})
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
        this.$emit(method === 'setMuted' ? 'notify-mute' : 'notify-read', method === 'setMuted' ? { muted: this.notifyMuted } : method === 'markRead' ? { all: false, id: value } : { all: true })
        return true
      } catch (error) {
        if (!current()) return null
        this.notifyPendingId = context.provider.getPendingOperation?.()?.operationId || ''
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
    async queryPendingNotification() {
      const context = this.notificationContext(), id = this.notifyPendingId
      if (!id || !this.notifyCurrent(context) || this.notifyWriting || this.notifyLoading || typeof context.provider?.queryOperation !== 'function' || context.provider.getPendingOperation?.()?.operationId !== id) return null
      const token = {}; this._notifyWriteToken = token; this.notifyWriting = true
      const current = () => this._notifyWriteToken === token && this.notifyCurrent(context)
      try {
        const result = await context.provider.queryOperation(id)
        if (!current()) return null
        if (!['committed', 'succeeded'].includes(result?.status)) throw new Error('NOTIFICATION_RESULT_UNCONFIRMED')
        const snapshot = context.provider.getState?.()
        const items = snapshot?.status === 'ready' && !result.viewRefreshRequired ? this.projectNotifySnapshot(snapshot) : await this.loadNotifications()
        if (!current() || items === null) return null
        this.notifyPendingId = context.provider.getPendingOperation?.()?.operationId || ''
        this.notifyActionError = ''; this.clearNotifyError('write')
        return true
      } catch (_) { if (current()) this.notifyActionError = '原通知操作尚未确认，请稍后再次查询。'; return null }
      finally { if (this._notifyWriteToken === token) { this._notifyWriteToken = null; this.notifyWriting = false } }
    },
    notifyItemAvailable(item) {
      const context = this.notificationContext(), provider = context.provider
      const unread = typeof item.read === 'boolean' ? !item.read : !item.readAt
      return this.notifyCurrent(context) && ((!provider && unread) || (unread && typeof provider?.markRead === 'function') || (!!item.threadId && typeof provider?.openThread === 'function'))
    },
    async openNotification(id) {
      const context = this.notificationContext(), item = this.notifyItems.find(item => item.id === id)
      if (!item || !this.notifyItemAvailable(item) || this.notifyWriting || this.notifyLoading || this.notifyHistoryLoading || this.notifyOpeningId) return null
      const token = {}; this._notifyOpenToken = token; this.notifyOpeningId = id; this.notifyActionError = ''
      const current = () => this._notifyOpenToken === token && this.notifyCurrent(context)
      try {
        const unread = typeof item.read === 'boolean' ? !item.read : !item.readAt
        if (unread) {
          if (context.provider) {
            if (typeof context.provider.markRead !== 'function' || await this.writeNotifications('markRead', id) !== true) {
              if (current() && !this.notifyActionError) this.notifyActionError = '通知已读操作尚未确认，请核对原请求后重试。'
              return null
            }
          }
          else { this.notifyItems = this.notifyItems.map(value => value.id === id ? { ...value, read: true, readAt: Date.now() } : value); this.$emit('notify-read', { all: false, id }) }
        }
        if (!current()) return null
        // 飞书 `messageClick` 的三条短路分支（307-19777）：评论已删 / 无权限 / 已解决时**不定位**，
        // 只弹提示。已读回执照旧先发出去 —— 用户确实看过这条通知了。
        const blocked = item.type === 'deleted' || item.status === 'deleted' ? '该条评论已被删除'
          : item.type === 'no-permission' || item.status === 'no-permission' ? '你没有查看这条评论的权限'
          : item.resolved === true || item.status === 'resolved' ? '该条评论已被解决' : ''
        if (blocked) {
          this.notifyActionError = blocked
          return null
        }
        if (item.threadId && typeof context.provider?.openThread === 'function') {
          const comments = this.commentProvider?.()
          const result = await context.provider.openThread(id)
          if (!current()) return null
          if (result === false || result === null) throw new Error('NOTIFICATION_TARGET_UNAVAILABLE')
          if (result?.target) {
            if (result.target.threadId !== item.threadId || typeof this.loadComments !== 'function' || typeof this.activateComment !== 'function') throw new Error('NOTIFICATION_TARGET_UNAVAILABLE')
            await this.loadComments()
            if (!current() || comments !== this.commentProvider?.()) return null
            const thread = this.commentThreads?.find(value => value.id === item.threadId && !value.tombstone)
            if (!thread) throw new Error('NOTIFICATION_TARGET_UNAVAILABLE')
            this.activateComment(thread.id)
            if (thread.bound) this.scrollCommentIntoView?.(thread.blockId)
            await this.$nextTick()
            if (!current() || comments !== this.commentProvider?.()) return null
            if (thread.scope === 'document') [...(this.$refs.root?.querySelectorAll('[data-comment-thread]') || [])].find(node => node.dataset.commentThread === thread.id)?.scrollIntoView?.({ block: 'nearest' })
          }
          this.closeNotify()
        }
        return true
      } catch (_) {
        if (current()) this.notifyActionError = '无法打开此通知，请重新读取后重试。'
        return null
      } finally { if (this._notifyOpenToken === token) { this._notifyOpenToken = null; this.notifyOpeningId = '' } }
    },
    async loadMoreNotifications() {
      const context = this.notificationContext()
      if (!this.notifyCurrent(context) || typeof context.provider?.loadMore !== 'function' || this.notifyHistoryLoading || this.notifyLoading || this.notifyWriting || this.notifyOpeningId) return null
      if (!this.notifyHasMore) {
        if (!this.notifyHistoryError) return null
        const items = await this.loadNotifications()
        if (items !== null && this.notifyCurrent(context)) this.notifyHistoryError = ''
        return items
      }
      const token = {}; this._notifyMoreToken = token; this.notifyHistoryLoading = true; this.notifyHistoryError = ''
      const current = () => this._notifyMoreToken === token && this.notifyCurrent(context)
      try {
        const result = await context.provider.loadMore()
        if (!current()) return null
        return this.projectNotifySnapshot(result)
      } catch (_) {
        if (current()) this.notifyHistoryError = '历史通知读取失败，请重试。'
        return null
      } finally { if (this._notifyMoreToken === token) { this._notifyMoreToken = null; this.notifyHistoryLoading = false } }
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
      this._notifyTrigger = el
      this._notifyOpenContext = this.notificationContext()
      this.notifyOpen = true
      this.notifyStyle = anchorPopoverStyle(rect, NOTIFY_SIZE, {
        width: window.innerWidth,
        height: window.innerHeight,
      }, { align: 'right' })
      this.$emit('notify-open')
      if (this.notifyContext.provider) this.loadNotifications()
      this.$nextTick(this.measureNotify)
    },
    closeNotify(restoreFocus = false) {
      const context = this._notifyOpenContext
      const root = this.$refs?.root
      const trigger = typeof window !== 'undefined' && window.innerWidth <= 760 ? root?.querySelector('.lark-doc-mobile-actions-toggle') : this._notifyTrigger
      this.notifyOpen = false
      this.notifyAnchor = null
      this._notifyTrigger = null; this._notifyOpenContext = null
      if (restoreFocus && context && this.notifyCurrent(context) && trigger?.isConnected) trigger.focus({ preventScroll: true })
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
      this.notifyItems = this.notifyItems.map(item => ({ ...item, ...(typeof item.read === 'boolean' ? { read: true } : {}), readAt: item.readAt || now }))
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
