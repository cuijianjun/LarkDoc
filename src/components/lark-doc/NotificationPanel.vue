<template>
  <section v-if="visible && canView" ref="surface" class="lark-doc-notification-panel" :style="nativeSurfaceStyle" role="dialog" aria-label="当前文档通知" tabindex="-1" @keydown.stop="nativeSurfaceKeydown">
    <div class="lark-doc-notification-heading">
      <h2>当前文档通知</h2>
      <button type="button" class="lark-doc-notification-mute" :disabled="busy || Boolean(pendingOperation) || !projection.preference" :aria-pressed="String(Boolean(projection.preference && projection.preference.muted))" @click="mute"><svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 14h12l-1.5-2V8a4.5 4.5 0 0 0-9 0v4L4 14ZM8 17h4" /><path v-if="!projection.preference || !projection.preference.muted" d="m3 3 14 14" /></svg>{{ projection.preference && projection.preference.muted ? '开启通知' : '关闭通知' }}</button>
      <button type="button" :disabled="busy || Boolean(pendingOperation) || projection.status !== 'ready' || !projection.unreadCount || !supportsMarkAll" @click="markAllRead">全部已读</button>
    </div>
    <div class="ud__loading-nested-loading"><div class="ud__loading__container" :aria-busy="String(projection.status === 'loading')">
      <p v-if="connectionLabel" class="lark-doc-notification-status" role="status">{{ connectionLabel }} <button v-if="projection.status === 'error' || projection.resetRequired || projection.connection === 'stopped'" type="button" :disabled="busy" @click="refresh">重试</button></p>
      <p v-if="message" class="lark-doc-notification-status" role="status">{{ message }}</p>
      <button v-if="pendingOperation" type="button" class="lark-doc-notification-query" :disabled="busy" @click="queryOriginal">确认操作结果</button>
      <div v-if="projection.status === 'ready' && !projection.items.length" class="lark-doc-notification-empty">
        <svg aria-hidden="true" width="120" height="120" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M103.587 73.962V64c5.142 1.573 10.804 3.656 12.077 6.592.176.4.262.796.262 1.184h.002v5.856c0-.388-.088-.785-.262-1.185-.108-.246-.249.29-.423.949-.241.912-.544 2.062-.908 1.707-.618-.606-1.43-1.23-2.408-1.857-1.983-1.27-5.114-2.34-8.34-3.284ZM22.423 35.486v8.518c-8.445-2.616-17.634-6.317-17.634-10.67V22.628c0 7.267 9.214 10.845 17.634 12.86Z" fill="var(--ld-text-outline-heading)"/>
          <path d="M4.788 33.63c0-.075.001-.15.005-.226.288-6.747 14.759-13.693 19.854-14.66V9.836c-4.376.83-19.86 7.503-19.86 13.906v9.889Z" fill="var(--ld-brand-chrome)"/>
          <path d="M103.587 26.174a4 4 0 0 0-4-4H26.423a4 4 0 0 0-4 4V72.48a4 4 0 0 0 4 4h66.261l10.903 10.507V26.174Z" fill="var(--ld-text-disabled)" fill-opacity=".45"/>
          <path d="M33.508 37.654a.5.5 0 0 1 .5-.5h46.814a.5.5 0 0 1 0 1H34.008a.5.5 0 0 1-.5-.5Zm0 10.52a.5.5 0 0 0 .5.5h27.1a.5.5 0 1 0 0-1h-27.1a.5.5 0 0 0-.5.5Z" fill="var(--ld-text-tertiary)"/>
          <path d="M100.759 35.023c6.373 0 11.54-5.167 11.54-11.541 0-6.374-5.167-11.54-11.54-11.54-6.374 0-11.541 5.166-11.541 11.54 0 6.374 5.167 11.54 11.541 11.54Z" fill="var(--ld-brand-content)"/>
          <path d="M11.45 67.418v28.593a.5.5 0 0 0 .845.361l5.043-4.82h31.231a2.5 2.5 0 0 0 2.5-2.5V67.418a2.5 2.5 0 0 0-2.5-2.5H13.95a2.5 2.5 0 0 0-2.5 2.5Zm2.5-1.5h34.62a1.5 1.5 0 0 1 1.5 1.5v21.633a1.5 1.5 0 0 1-1.5 1.5H17.136a.5.5 0 0 0-.345.139l-4.342 4.151V67.418a1.5 1.5 0 0 0-1.5-1.5Z" fill="var(--ld-text-outline-heading)"/>
          <path d="M115.928 71.686c-.061 8.424-34.561 13.433-54.424 14.171v9.09c20.95-.576 54.424-5.725 54.424-13.466v-9.795Z" fill="var(--ld-brand-chrome)"/>
          <path d="M57.415 111.165v-9.088c14.542-.532 36.808-3.283 48.133-7.933v9.453c-11.09 4.389-32.867 7.156-48.133 7.568Z" fill="var(--ld-brand-content)"/>
          <path d="M52.122 12.786V3.938C41.949 4.545 38.111 5.96 32.247 7.8v9.092c5.823-1.572 10.217-2.94 19.875-4.106Z" fill="var(--ld-brand-chrome)"/>
        </svg>
        <strong>暂无通知</strong><p>当有人在当前文档提及你，评论你编辑的内容，或回复了你的评论，你将在这里收到通知</p>
      </div>
      <ul class="lark-doc-notification-list">
        <li v-for="item in projection.items" :key="item.notificationId" :class="{ 'is-unread': !item.read }">
          <span class="lark-doc-notification-dot" aria-hidden="true" />
          <div class="lark-doc-notification-item-content"><span>{{ typeLabel(item.type) }}</span><span class="lark-doc-notification-read-state">{{ item.read ? '已读' : '未读' }}</span>
            <div class="lark-doc-notification-item-actions">
              <button v-if="item.threadId || ['access-request', 'access-result'].includes(item.type)" type="button" :disabled="busy" @click="openTarget(item)">{{ item.threadId ? '查看评论' : '查看申请' }}</button>
              <button type="button" :disabled="busy || Boolean(pendingOperation) || projection.status !== 'ready'" @click="read(item)">{{ item.read ? '标为未读' : '标为已读' }}</button>
            </div>
          </div>
        </li>
      </ul>
      <button v-if="projection.hasMore" type="button" class="lark-doc-notification-history" :disabled="busy || projection.historyBusy" @click="loadMore">{{ projection.historyBusy ? '正在加载…' : '加载历史通知' }}</button>
    </div></div>
  </section>
</template>

<script>
import { nativePanelSurface } from './editor/documentSearchMixin'
const empty = () => ({ status: 'idle', connection: 'idle', items: [], preference: null, unreadCount: null, hasMore: false, historyBusy: false })
export default {
  name: 'LarkDocNotificationPanel',
  mixins: [nativePanelSurface],
  props: { session: { type: Object, default: null }, contextCurrent: { type: Function, default: () => true } },
  data() { return { available: false, canView: false, projection: empty(), message: '', busy: false,
    pendingOperation: '', panelGeneration: 0, identityGeneration: 0, supportsMarkAll: false, nativePanelWidth: 402, nativePanelHeight: 552 } },
  computed: {
    connectionLabel() {
      if (this.projection.status === 'denied') return '当前无权查看通知'
      if (this.projection.resetRequired || this.projection.status === 'error') return '通知暂时不可用'
      if (this.projection.status === 'loading') return '正在加载…'
      return { reconnecting: '连接中断，正在重新连接…', stopped: '通知暂未更新' }[this.projection.connection] || ''
    },
  },
  watch: {
    session: { immediate: true, handler() { this.bindSession() } },
    projection() { this.publishStatus() },
    available() { this.publishStatus() },
    canView() { this.publishStatus() },
  },
  beforeDestroy() {
    this._notificationDisposed = true; this.panelGeneration++; this._notificationBusy = null
    this.stopTransport(); this.clearSessionListeners()
  },
  methods: {
    publishStatus() { this.$emit('status', { available: this.available && this.canView, unreadCount: this.canView ? this.projection.unreadCount : null }) },
    clearSessionListeners() { if (this._notificationSessionStops) this._notificationSessionStops.forEach(stop => stop()); this._notificationSessionStops = [] },
    stopTransport() { if (this._notificationStop) this._notificationStop(); this._notificationStop = null },
    retireIdentity() {
      this.stopTransport(); this.identityGeneration++; this.panelGeneration++
      this.canView = false; this.projection = empty(); this.pendingOperation = ''; this._pendingNotificationProvider = null
      this.message = ''; this.busy = false; this._notificationBusy = null; this.$emit('close', false)
    },
    bindSession() {
      this.retireIdentity(); this.clearSessionListeners()
      const session = this.session
      this.canView = Boolean(session && session.can('canView'))
      if (session && typeof session.on === 'function') {
        const owns = () => !this._notificationDisposed && this.session === session
        this._notificationSessionStops.push(session.on('notifications-provider', () => { if (owns()) this.bindTransport() }))
        this._notificationSessionStops.push(session.on('capabilities', () => {
          if (!owns()) return
          this.canView = session.can('canView')
          if (!this.canView) { this.panelGeneration++; this.stopTransport(); this.projection = empty(); this.$emit('close', false) }
          else if (!this._notificationStop) this.bindTransport()
        }))
        this._notificationSessionStops.push(session.on('notifications-identity', () => { if (owns()) this.retireIdentity() }))
      }
      this.bindTransport()
    },
    bindTransport() {
      this.stopTransport(); const generation = ++this.panelGeneration
      this.projection = empty(); this.$emit('close', false)
      const session = this.session, provider = session && session.getProvider('notifications')
      this.supportsMarkAll = typeof provider?.markAllRead === 'function'
      this.available = Boolean(provider); this.canView = Boolean(session && session.can('canView'))
      if (!provider || !this.canView) return
      this._notificationStop = session.subscribeNotifications(value => {
        if (this._notificationDisposed || generation !== this.panelGeneration || session !== this.session || provider !== session.getProvider('notifications')) return
        this.canView = session.can('canView'); this.projection = this.canView ? value : empty()
        const pending = value.status === 'ready' ? provider.getPendingOperation?.() : null
        if (!this.pendingOperation && pending?.operationId) { this.pendingOperation = pending.operationId; this._pendingNotificationProvider = provider; this.message = '结果待确认，可重试查询' }
        if (!this.canView || value.status === 'denied') this.$emit('close', false)
      })
    },
    notificationScope() {
      const session = this.session, provider = session?.getProvider('notifications'), identity = this.identityGeneration,
        privateIdentity = session?._privateIdentityGeneration, principal = session?.user?.id, documentId = session?.documentId,
        auth = session?._authorizationGeneration, generation = this.panelGeneration
      const identityCurrent = () => !this._notificationDisposed && this.contextCurrent() && session === this.session && identity === this.identityGeneration &&
        privateIdentity === session?._privateIdentityGeneration && principal === session?.user?.id && documentId === session?.documentId && !session?._destroyed
      return { session, provider, identityCurrent, current: () => identityCurrent() && session?.can('canView') &&
        auth === session._authorizationGeneration && generation === this.panelGeneration && provider === session.getProvider('notifications') }
    },
    typeLabel(type) {
      return { 'access-request': '有人申请文档权限', 'access-result': '文档权限申请已处理', 'comment-created': '新评论', 'comment-replied': '评论回复', 'comment-resolved': '评论已解决', mention: '有人提及了你',
        'comment.create': '新评论', 'comment.reply': '评论回复', 'comment.resolve': '评论已解决' }[type] || '文档更新'
    },
    async refresh() {
      const scope = this.notificationScope(); if (!scope.current()) return
      this.message = ''
      if (!this._notificationStop) { this.bindTransport(); return }
      try { await scope.session.refreshNotifications() } catch { if (scope.current()) this.message = '通知加载失败，请重试。' }
    },
    async loadMore() {
      const scope = this.notificationScope(); if (!scope.current()) return
      try { await scope.session.loadMoreNotifications() } catch { if (scope.current()) this.message = '历史通知加载失败，请重试。' }
    },
    async mutate(method, input, direct = false) {
      if (this.busy || this.pendingOperation) return
      const scope = this.notificationScope(); if (!scope.current()) return
      const token = {}; this._notificationBusy = token; this.busy = true; this.message = ''
      try {
        const result = await (direct ? scope.provider[method](input) : scope.session[method](input))
        if (scope.current()) this.message = result.viewRefreshRequired ? '操作已保存，请刷新通知。' : ''
      } catch (error) {
        if (scope.identityCurrent() && error.status === 'unknown' && error.operationId) {
          this.pendingOperation = error.operationId; this._pendingNotificationProvider = scope.provider
        }
        if (scope.current()) this.message = error.status === 'unknown' ? '结果待确认，可重试查询' : '操作未完成，请刷新后重试。'
      } finally { if (this._notificationBusy === token) { this._notificationBusy = null; this.busy = false } }
    },
    read(item) { if (this.projection.items.includes(item)) return this.mutate('markNotificationRead', { notificationId: item.notificationId, value: !item.read, expectedRevision: item.readRevision }) },
    markAllRead() { if (this.supportsMarkAll && this.projection.status === 'ready' && this.projection.unreadCount > 0) return this.mutate('markAllRead', {}, true) },
    mute() {
      const pref = this.projection.preference
      if (pref) return this.mutate('setNotificationsMuted', { value: !pref.muted, expectedRevision: pref.preferenceRevision })
    },
    async queryOriginal() {
      if (!this.pendingOperation || this.busy) return
      const scope = this.notificationScope(); if (!scope.current()) return
      const provider = this._pendingNotificationProvider, id = this.pendingOperation, token = {}
      if (!provider || typeof provider.queryOperation !== 'function') return
      this._notificationBusy = token; this.busy = true
      try {
        const result = await provider.queryOperation(id)
        if (!scope.current() || this.pendingOperation !== id || this._pendingNotificationProvider !== provider) return
        this.pendingOperation = ''; this._pendingNotificationProvider = null
        let refresh = result.viewRefreshRequired
        if (provider !== scope.provider || refresh) {
          try { await scope.session.refreshNotifications(); refresh = false } catch { refresh = true }
        }
        if (scope.current()) this.message = refresh ? '操作已确认，请刷新通知。' : ''
      } catch { if (scope.current()) this.message = '结果待确认，可重试查询' }
      finally { if (this._notificationBusy === token) { this._notificationBusy = null; this.busy = false } }
    },
    openTarget(item) {
      const scope = this.notificationScope()
      if (!scope.current() || !this.projection.items.includes(item)) return
      if (['access-request', 'access-result'].includes(item.type)) this.$emit('open-access', item.type === 'access-request' ? 'pending' : 'self', scope.current)
      else return this.openThread(item)
    },
    async openThread(item) {
      const scope = this.notificationScope()
      if (!scope.current() || !this.projection.items.includes(item)) return
      try {
        const result = await scope.session.openNotificationThread(item.notificationId)
        if (scope.current()) this.$emit('open-thread', result, scope.current)
      } catch { if (scope.current()) this.message = '评论当前不可访问。' }
    },
  },
}
</script>

<style scoped>
.lark-doc .lark-doc-notification-panel { position: fixed; z-index: 999; display: flex; flex-direction: column; box-sizing: border-box; width: 402px; height: 552px; max-width: calc(100vw - 16px); padding: 0; overflow: hidden; border: 1px solid var(--ld-border); border-radius: 8px; background: var(--ld-bg-surface); color: var(--ld-text); text-align: left; box-shadow: 0 6px 24px rgba(31, 35, 41, .12); }
.lark-doc .lark-doc-notification-heading { display: flex; align-items: center; gap: 18px; flex: 0 0 40px; box-sizing: border-box; min-height: 40px; padding: 0 12px; border-bottom: 1px solid var(--ld-border); }
.lark-doc .lark-doc-notification-heading h2 { min-width: 0; margin: 0 auto 0 0; overflow: hidden; font-size: 14px; font-weight: 700; line-height: 22px; white-space: nowrap; text-overflow: ellipsis; }
.lark-doc .lark-doc-notification-panel button { min-height: 22px; padding: 0; border: 0; background: transparent; color: var(--ld-text); font-family: inherit; font-size: 14px; line-height: 22px; cursor: pointer; }
.lark-doc .lark-doc-notification-heading > button { flex-shrink: 0; white-space: nowrap; }
.lark-doc .lark-doc-notification-panel button:disabled { color: var(--ld-text-disabled); opacity: 1; cursor: default; }
.lark-doc .lark-doc-notification-panel button:not(:disabled):hover { color: var(--ld-text-accent); }
.lark-doc .lark-doc-notification-panel .lark-doc-notification-mute { display: inline-flex; align-items: center; gap: 4px; flex: 0 0 auto; min-height: 26px; padding: 2px 4px; border-radius: 6px; white-space: nowrap; }
.lark-doc .ud__loading-nested-loading { flex: 1; min-height: 0; overflow: auto; }
.lark-doc .ud__loading__container { position: relative; display: flex; flex-direction: column; min-height: 100%; }
.lark-doc .lark-doc-notification-status { margin: 0; padding: 10px 12px; color: var(--ld-text-secondary); font-size: 14px; line-height: 22px; }
.lark-doc .lark-doc-notification-query { margin: 0 12px 10px; }
.lark-doc .lark-doc-notification-empty { display: flex; flex: 1; align-items: center; flex-direction: column; box-sizing: border-box; margin: 115px 0 0; padding: 4px; color: var(--ld-text-secondary); }
.lark-doc .lark-doc-notification-empty svg { display: block; flex: 0 0 auto; }
.lark-doc .lark-doc-notification-empty strong { margin-top: 16px; color: var(--ld-text); font-size: 16px; font-weight: 500; line-height: 24px; }
.lark-doc .lark-doc-notification-empty p { width: 250px; max-width: 100%; margin: 4px 0 0; color: var(--ld-text-secondary); font-size: 14px; line-height: 22px; text-align: center; }
.lark-doc .lark-doc-notification-list { margin: 0; padding: 0; list-style: none; }
.lark-doc .lark-doc-notification-list li { display: flex; align-items: flex-start; gap: 10px; padding: 16px 18px; border-bottom: 1px solid var(--ld-border); }
.lark-doc .lark-doc-notification-dot { flex: 0 0 6px; width: 6px; height: 6px; margin-top: 7px; border-radius: 50%; background: transparent; }
.lark-doc .is-unread .lark-doc-notification-dot { background: var(--ld-text-accent); }
.lark-doc .lark-doc-notification-item-content { flex: 1; min-width: 0; font-size: 14px; line-height: 22px; }
.lark-doc .lark-doc-notification-read-state { margin-left: 8px; color: var(--ld-text-secondary); font-size: 12px; }
.lark-doc .lark-doc-notification-item-actions { display: flex; gap: 16px; margin-top: 6px; }
.lark-doc .lark-doc-notification-panel .lark-doc-notification-item-actions button { color: var(--ld-text-accent); }
.lark-doc .lark-doc-notification-history { display: block; margin: 12px auto; }
@media (max-width: 430px) { .lark-doc .lark-doc-notification-heading { gap: 8px; padding: 0 8px; } }
@media print { .lark-doc .lark-doc-notification-panel { display: none !important; } }
</style>
