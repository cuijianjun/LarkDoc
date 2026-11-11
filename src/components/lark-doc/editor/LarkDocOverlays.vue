<template>
  <!-- P6b 浮层组（评论 / 历史版本 / 分享 / 导出）。
       为什么要有这一层：五条线各自的_panel 全是 `position: fixed`，它们必须是**兄弟**
       —— 祖先一旦有 transform / filter / 非 static 定位，就会改写 fixed 的包含块而漂走
       （`SharePopover.vue` 头部同一条纪律）。而 `LarkDocEditor.vue` 有 <700 行门禁
       （P0-03 门面只做装配），五条线各占一个模板位会把门面撑过线，所以收成一个根节点。

       ⚠️ 包裹层自身**不许**加 transform / filter / overflow / 非 static 定位。
       它也不带任何类名以外的样式：闭合态下五个子节点都不渲染或高度为 0，此处只是一个空 div。

       五个子节点**全部自管理显隐**（各自根节点或首个子节点带 v-if），所以这里**不写 v-if**
       —— 尤其 `ExportDialog`：04 §4.6.7③ 的顺序是「弹窗关闭 → toast」，父级 v-if 会把
       还没消失的 toast 一起摘掉。 -->
  <div class="lark-doc-p6b-layer">
    <!-- P6b-01 评论：正文锚点高亮 + 右侧线程面板（04 §3.1 / 05 §5.5）。 -->
    <CommentPanel :ed="ed" />
    <!-- P6b-02 历史记录：全屏面板 + 另存为版本 Dialog（04 §3.4）。 -->
    <VersionPanel :ed="ed" />
    <SaveVersionDialog :ed="ed" />
    <!-- P6b-03 分享浮层；入口在 TopBar / ToolbarBar，不参与页面底部普通流布局。
         （00-README 行 ~119：一级分享是 popover 不是 Dialog）。 -->
    <SharePopover :ed="ed" />
    <ShareLinkAccessGate :ed="ed" />
    <DocumentAccessDialog v-if="ed.documentAccessOpen" :ed="ed" :scope="ed.documentAccessScope" @close="closeDocumentAccess" @change-scope="changeDocumentAccessScope" @read-available="refreshAccessCapabilities" />
    <!-- P6b-04 导出：设置弹窗 + 导出 toast（04 §4.6.7）。 -->
    <ExportDialog :ed="ed" />
    <div v-if="!ed.larkDocConfig.layout.headerVisible && (ed.nativeSearchAvailable || ed.nativeNotificationsAvailable)" class="lark-doc-native-fallback" aria-label="云文档操作">
      <button v-if="ed.nativeSearchAvailable" type="button" aria-label="搜索云文档" aria-haspopup="dialog" :aria-expanded="String(ed.nativePanel === 'search')" @click="ed.toggleNativePanel('search', $event)"><lark-doc-icon name="search" :size="18" /><span>搜索</span></button>
      <button v-if="ed.nativeNotificationsAvailable" type="button" :aria-label="`当前文档通知${ed.nativeUnreadCount == null ? '' : `，${ed.nativeUnreadCount}条未读`}`" aria-haspopup="dialog" :aria-expanded="String(ed.nativePanel === 'notifications')" @click="ed.toggleNativePanel('notifications', $event)"><svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 14h12l-1.5-2V8a4.5 4.5 0 0 0-9 0v4L4 14ZM8 17h4" /></svg><span>通知{{ ed.nativeUnreadCount > 0 ? ` ${ed.nativeUnreadCount > 99 ? '99+' : ed.nativeUnreadCount}` : '' }}</span></button>
    </div>
    <CloudDocumentSearch :ed="ed" :visible="ed.nativePanel === 'search'" :anchor="nativeAnchor" @close="closeNativePanel" />
    <NotificationPanel :session="ed.nativeScopeValid ? ed.session : null" :context-current="nativeScopeCurrent" :visible="ed.nativePanel === 'notifications'" :anchor="nativeAnchor" @status="notificationStatus" @close="closeNotifications" @open-thread="openNotificationThread" @open-access="openAccessFromNotification" />
  </div>
</template>

<script>
/* eslint-disable vue/no-mutating-props -- ed is the documented shared editor controller, not local display data. */
// 文档级延迟层。原业务面板保留各自状态机；原生搜索/通知共享入口状态及当前会话清理。
// 通知面板关闭时仍保留唯一受权 transport，顶栏和隐藏标题栏入口读取同一计数。
//
// `ed` 是 **LarkDocEditor 实例本身**（不是本组件）：父级传的是 `:ed="self"`，
// 这里再原样往下传，面板因此能直接读到 `ed.editor` / `ed.session` / 各 mixin 的 data。
import CommentPanel from '../CommentPanel.vue'
import VersionPanel from '../VersionPanel.vue'
import SaveVersionDialog from '../SaveVersionDialog.vue'
import SharePopover from '../SharePopover.vue'
import ExportDialog from '../ExportDialog.vue'
import LarkDocIcon from '../LarkDocIcon.vue'
import CloudDocumentSearch from '../CloudDocumentSearch.vue'
import NotificationPanel from '../NotificationPanel.vue'

const ShareLinkAccessGate = () => import(/* webpackChunkName: "share-links" */ '../ShareLinkAccessGate.vue')
const DocumentAccessDialog = () => import(/* webpackChunkName: "document-access" */ '../DocumentAccessDialog.vue')

export default {
  name: 'LarkDocP6bOverlays',
  components: { CommentPanel, VersionPanel, SaveVersionDialog, SharePopover, ExportDialog, LarkDocIcon, CloudDocumentSearch, NotificationPanel, DocumentAccessDialog, ShareLinkAccessGate },
  props: {
    ed: { type: Object, required: true },
  },
  watch: { 'ed.session': { immediate: true, handler() { this.bindNativeSession() } }, 'ed.nativeScopeValid'() { this.bindNativeSession() } },
  beforeDestroy() {
    this._nativeDisposed = true; this.ed.documentAccessOpen = false; this.closeNativePanel(false)
    if (this._nativeSessionStops) this._nativeSessionStops.forEach(stop => stop())
    this.ed.nativeSearchAvailable = false; this.ed.nativeNotificationsAvailable = false; this.ed.nativeUnreadCount = null
  },
  methods: {
    closeDocumentAccess() { this.ed.documentAccessOpen = false },
    changeDocumentAccessScope(value) { this.ed.documentAccessScope = value },
    openAccessFromNotification(scope, current) {
      if (this._nativeDisposed || current && !current()) return
      this.ed.openDocumentAccessRequests(scope)
    },
    async refreshAccessCapabilities(role) {
      const session = this.ed.session, provider = session?.getProvider('authorization'), principal = session?.user?.id, identity = session?._privateIdentityGeneration
      if (!session || !provider) return
      try { await session.refreshCapabilities() } catch { return }
      if (this._nativeDisposed || session !== this.ed.session || provider !== session.getProvider('authorization') || principal !== session.user?.id || identity !== session._privateIdentityGeneration) return
      if (session.can(role === 'editor' ? 'canEdit' : 'canView')) this.ed.documentAccessOpen = false
    },
    nativeAnchor() { return this.ed._nativePanelAnchor || null },
    nativeScopeCurrent() { return !this._nativeDisposed && this.ed.nativeScopeValid },
    closeNativePanel(restore) {
      const anchor = this.nativeAnchor()
      this.ed.nativePanel = ''; this.ed._nativePanelAnchor = null
      if (restore && anchor && anchor.isConnected) anchor.focus({ preventScroll: true })
    },
    closeNotifications(restore) { if (this.ed.nativePanel === 'notifications') this.closeNativePanel(restore) },
    notificationStatus(value) { this.ed.nativeNotificationsAvailable = value.available; this.ed.nativeUnreadCount = value.unreadCount },
    bindNativeSession() {
      this.ed.documentAccessOpen = false; this.closeNativePanel(false)
      if (this._nativeSessionStops) this._nativeSessionStops.forEach(stop => stop())
      this._nativeSessionStops = []
      const session = this.ed.nativeScopeValid ? this.ed.session : null
      const update = () => {
        const provider = session?.getProvider('authorization')
        this.ed.nativeSearchAvailable = Boolean(session?.can('canView') && typeof provider?.searchDocuments === 'function')
      }
      update()
      if (!session || typeof session.on !== 'function') return
      const owns = () => !this._nativeDisposed && this.ed.nativeScopeValid && this.ed.session === session
      this._nativeSessionStops.push(session.on('identity', () => { if (owns()) this.ed.documentAccessOpen = false }))
      this._nativeSessionStops.push(session.on('comments-reset', () => { if (owns()) { this.closeNativePanel(false); update() } }))
      this._nativeSessionStops.push(session.on('capabilities', () => { if (owns()) { this.closeNativePanel(false); update() } }))
      this._nativeSessionStops.push(session.on('provider-changed', event => {
        if (owns() && ['authorization', 'documentBusiness'].includes(event.name)) { this.closeNativePanel(false); update() }
      }))
      this._nativeSessionStops.push(session.on('notifications-identity', () => { if (owns()) { this.closeNativePanel(false); update() } }))
      this._nativeSessionStops.push(session.on('notifications-reset', () => {
        if (owns() && typeof this.ed.clearUnavailableCommentView === 'function') void this.ed.clearUnavailableCommentView({ code: 'COMMENT_NOT_VISIBLE' })
      }))
    },
    async openNotificationThread(result, current) {
      const ed = this.ed, session = ed.session, provider = session?.getProvider('comments'), auth = session?._authorizationGeneration,
        identity = session?._privateIdentityGeneration, principal = session?.user?.id, documentId = session?.documentId
      const owns = () => !this._nativeDisposed && ed.nativeScopeValid && (!current || current()) && ed.session === session && session?.can('canView') &&
        provider === session.getProvider('comments') && auth === session._authorizationGeneration && identity === session._privateIdentityGeneration &&
        principal === session.user?.id && documentId === session.documentId
      if (!result?.target || !owns() || typeof ed.loadComments !== 'function') return
      await ed.loadComments().catch(() => {})
      if (!owns()) return
      const thread = ed.commentThreads.find(item => item.id === result.target.threadId && !item.tombstone)
      if (!thread) { ed.commentMessage = '评论当前不可访问。'; return }
      this.closeNativePanel(false); ed.activateComment(thread.id)
      if (result.target.anchorStatus === 'orphaned' || thread.anchorStatus === 'orphaned') ed.commentMessage = '原引用无法定位，仍可查看评论。'
      else if (thread.bound) ed.scrollCommentIntoView(thread.blockId)
    },
  },
}
</script>

<style scoped>
.lark-doc .lark-doc-native-fallback { position: fixed; z-index: 18; right: 16px; bottom: 16px; display: flex; gap: 4px; padding: 4px; border: 1px solid var(--ld-border); border-radius: 8px; background: var(--ld-bg-surface); box-shadow: 0 2px 8px rgba(31, 35, 41, .1); }
.lark-doc .lark-doc-native-fallback button { display: flex; align-items: center; gap: 4px; min-height: 32px; padding: 0 8px; border: 0; border-radius: 6px; background: transparent; color: var(--ld-text); font-size: 14px; }
.lark-doc .lark-doc-native-fallback button:hover, .lark-doc .lark-doc-native-fallback button[aria-expanded="true"] { background: var(--ld-bg-hover); }
@media print { .lark-doc .lark-doc-native-fallback { display: none !important; } }
</style>
