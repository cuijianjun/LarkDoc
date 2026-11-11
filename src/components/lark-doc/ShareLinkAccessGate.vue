<template>
  <div v-if="visible" class="lark-doc-share-access-mask">
    <section ref="dialog" class="lark-doc-share-access-dialog" role="dialog" aria-modal="true" aria-label="访问分享文档" tabindex="-1" @keydown.tab="trap">
      <p v-if="loading || resuming" role="status">{{ resuming ? '正在确认访问权限…' : '正在准备访问…' }}</p>
      <p v-if="message" role="status">{{ message }}</p>
      <ShareLinkAccess v-if="accessPort && !resuming" :port="accessPort" :link-id="linkId" @authenticated="authenticated" />
    </section>
  </div>
</template>

<script>
import ShareLinkAccess from './ShareLinkAccess.vue'
const id = value => typeof value === 'string' && /^[A-Za-z0-9._-]{1,128}(?![\s\S])/.test(value)
const same = (a, b) => a && b && ['status', 'principalId', 'generation', 'identity', 'privateIdentity'].every(key => a[key] === b[key])
export default {
  name: 'LarkDocShareLinkAccessGate',
  components: { ShareLinkAccess },
  props: { ed: { type: Object, required: true } },
  data: () => ({ visible: false, loading: false, resuming: false, accessPort: null, linkId: '', message: '' }),
  watch: { 'ed.session'() { this.bind() }, 'ed.session.documentId'() { this.bind() } },
  mounted() {
    this._locationChanged = () => this.bind()
    window.addEventListener('hashchange', this._locationChanged); window.addEventListener('popstate', this._locationChanged)
    this.bind()
  },
  beforeDestroy() {
    this._disposed = true; this.retire(); this._stops?.forEach(stop => stop())
    window.removeEventListener('hashchange', this._locationChanged); window.removeEventListener('popstate', this._locationChanged)
  },
  methods: {
    stamp(session, identity) {
      try {
        const value = identity?.getState?.()
        return value && { status: value.status, principalId: value.principalId, generation: value.generation, identity: session?._identityGeneration, privateIdentity: session?._privateIdentityGeneration }
      } catch { return null }
    },
    normal(session, identity) {
      try { return identity?.getState?.().status === 'authenticated' && session?.can('canView') === true } catch { return false }
    },
    baseCurrent(binding) {
      try {
        const session = binding?.session, scope = binding?.authorization.getScope()
        return Boolean(binding && this._binding === binding && !this._disposed && !this._isDestroyed && !this._isBeingDestroyed && !this.ed._isDestroyed && !this.ed._isBeingDestroyed &&
          session === this.ed.session && !session?._destroyed && binding.docId === session.documentId && binding.authorization === session.getProvider('authorization') &&
          binding.identity === session.getProvider('identity') && scope?.tenantId === binding.tenantId && scope?.docId === binding.docId)
      } catch { return false }
    },
    waitingCurrent(binding) { return this.baseCurrent(binding) && !this._resume && same(binding.stamp, this.stamp(binding.session, binding.identity)) },
    fragment(scope, documentId) {
      if (!id(scope?.tenantId) || !id(scope?.docId) || scope.docId !== documentId) return null
      const url = new URL(window.location.href), params = new URLSearchParams(url.hash.slice(1)), keys = ['larkDocument', 'tenantId', 'docId', 'shareLink']
      if ([...params.keys()].length !== 4 || keys.some(key => params.getAll(key).length !== 1) || [...params.keys()].some(key => !keys.includes(key)) ||
        params.get('larkDocument') !== '1' || params.get('tenantId') !== scope.tenantId || params.get('docId') !== scope.docId ||
        !/^sl_[A-Za-z0-9_-]{43}(?![\s\S])/.test(params.get('shareLink') || '')) return null
      const linkId = params.get('shareLink')
      url.hash = new URLSearchParams({ larkDocument: '1', tenantId: scope.tenantId, docId: scope.docId }).toString()
      window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash)
      return linkId
    },
    retire(message = '') {
      this._preparation?.cancel(); this._preparation = null
      this._binding = null; this._factoryToken = null; this._resume = null
      const port = this._port; this._port = null; port?.dispose?.(); if (port && typeof port.dispose !== 'function') port.reset()
      this.accessPort = null; this.linkId = ''; this.loading = false; this.resuming = false; this.message = message; this.visible = Boolean(message)
    },
    bind() {
      this.retire(); this._stops?.forEach(stop => stop()); this._stops = []
      const session = this.ed.session, authorization = session?.getProvider?.('authorization'), identity = session?.getProvider?.('identity')
      if (session?.on) this._stops = ['identity', 'capabilities', 'provider-changed'].map(name => session.on(name, () => this.changed()))
      if (this._disposed || !session || typeof authorization?.getScope !== 'function') return
      let scope, linkId
      try { scope = authorization.getScope(); linkId = this.fragment(scope, session.documentId) } catch { return }
      if (!linkId || this.normal(session, identity)) return
      this.visible = true; this.linkId = linkId
      this.$nextTick(() => { if (this.visible) this.$refs.dialog?.focus?.({ preventScroll: true }) })
      if (typeof identity?.prepareShareLinkAccess !== 'function' || typeof identity.getState !== 'function' || typeof authorization.createShareLinkAccess !== 'function') {
        this.message = '当前暂时无法验证分享链接，请联系文档管理者。'; return
      }
      const stamp = this.stamp(session, identity)
      if (!stamp) { this.message = '暂时无法确认身份，请重新打开分享链接。'; return }
      const binding = { session, authorization, identity, tenantId: scope.tenantId, docId: scope.docId, stamp }
      this._binding = binding; void this.prepare(binding)
    },
    changed() {
      const binding = this._binding
      if (!binding) {
        const session = this.ed.session
        if (this.normal(session, session?.getProvider?.('identity'))) this.retire()
        else if (new URLSearchParams(new URL(window.location.href).hash.slice(1)).has('shareLink')) this.bind()
        return
      }
      if (!this.baseCurrent(binding)) { this.retire(); return }
      if (this._resume) {
        if (!this.resumeCurrent(this._resume)) this.retire('身份确认未完成，请重新打开分享链接。')
      } else if (!this.waitingCurrent(binding) || this.normal(binding.session, binding.identity)) this.retire()
    },
    switchProblem(binding) {
      const ed = this.ed
      if (['commentCreateDraft', 'commentDocumentDraft', 'commentEditContent'].some(key => typeof ed[key] === 'string' && ed[key].length) ||
        Object.values(ed.commentDrafts || {}).some(value => typeof value === 'string' && value.length) ||
        Object.values(ed.commentImageDrafts || {}).some(value => Array.isArray(value) && value.length) ||
        ['commentDocumentMentions', 'commentDocumentReferences', 'commentEditMentions', 'commentEditReferences'].some(key => ed[key]?.length) ||
        ed.commentEditingReply || ed.pendingHTML != null || ed.commentBusy || ed.commentImageBusy || ed.commentPendingImage || ed._commentImageInFlight ||
        ['commentPendingOperation', 'commentPendingFollowOperation', 'commentPendingTranslationOperation', 'sharePendingOperation', 'shareLinkPending'].some(key => ed[key])) return '当前仍有未提交的草稿或待确认操作，请先保存、取消或核对后再访问。'
      let state
      try { state = binding.authorization.getShareLinkAccessState?.() } catch { /* An unavailable body projection cannot prove a clean authenticated editor. */ }
      if (state?.known === true && state.pending !== 0) return '当前文档有尚未确认的修改，请先处理后再访问分享链接。'
      if (binding.identity.getState().status === 'authenticated' && (state?.known !== true || state.pending !== 0)) return '暂时无法确认当前文档的修改状态，请稍后重试。'
      return ''
    },
    prepareSwitch(binding) {
      if (!this.waitingCurrent(binding)) throw Error('SHARE_LINK_CONTEXT_CHANGED')
      if (this.normal(binding.session, binding.identity)) { this.retire(); throw Error('SHARE_LINK_CONTEXT_CHANGED') }
      const problem = this.switchProblem(binding)
      if (problem) { this.message = problem; throw Error('SHARE_LINK_SWITCH_BLOCKED') }
      if (this._preparation) {
        if (!this._preparation.current()) { this.retire(); throw Error('SHARE_LINK_CONTEXT_CHANGED') }
        return this._preparation
      }
      try { this._preparation = binding.identity.prepareShareLinkAccess(); this.message = ''; return this._preparation }
      catch { this.message = '请先核对未完成的登录，再访问分享链接。'; throw Error('SHARE_LINK_SWITCH_BLOCKED') }
    },
    async prepare(binding) {
      const token = {}; this._factoryToken = token; this.loading = true
      try {
        const port = await binding.authorization.createShareLinkAccess(() => this.prepareSwitch(binding))
        if (!this.waitingCurrent(binding) || this._factoryToken !== token) { port?.dispose?.(); if (port && typeof port.dispose !== 'function') port.reset(); if (this._binding === binding) this.retire(); return }
        if (!port || ['request', 'query', 'operation', 'reset'].some(name => typeof port[name] !== 'function')) { port?.dispose?.(); throw Error('UNAVAILABLE') }
        this._port = port
        const invoke = async (method, input) => {
          if (!this.waitingCurrent(binding)) { this.retire(); throw Error('SHARE_LINK_CONTEXT_CHANGED') }
          this.prepareSwitch(binding)
          try {
            const result = await port[method](input)
            if (!this.waitingCurrent(binding)) throw Error('SHARE_LINK_CONTEXT_CHANGED')
            return result
          } catch (cause) {
            if (!this.waitingCurrent(binding)) { if (this._binding === binding) this.retire(); throw Error('SHARE_LINK_CONTEXT_CHANGED') }
            if (port.operation()?.status === 'rejected') { this._preparation?.cancel(true); this._preparation = null }
            throw cause
          }
        }
        this.accessPort = { request: input => invoke('request', input), query: () => invoke('query'), operation: () => port.operation(), reset: () => port.reset() }
        this.$nextTick(() => { if (this.waitingCurrent(binding)) this.$refs.dialog?.querySelector('input')?.focus() })
      } catch {
        if (this.waitingCurrent(binding) && this._factoryToken === token) this.message = '暂时无法打开分享链接，请重新打开后重试。'
        else if (this._binding === binding) this.retire()
      }
      finally { if (this._factoryToken === token) this.loading = false }
    },
    resumeCurrent(resume) {
      if (this._resume !== resume || !this.baseCurrent(resume.binding)) return false
      const stamp = this.stamp(resume.binding.session, resume.binding.identity)
      if (same(stamp, resume.last)) return true
      if (stamp.status === 'authenticating' && stamp.principalId == null && resume.phase === 'starting') resume.phase = 'authenticating'
      else if (stamp.status === 'authenticated' && stamp.principalId === resume.principal && ['starting', 'authenticating'].includes(resume.phase)) resume.phase = 'authenticated'
      else return false
      resume.last = stamp; return true
    },
    async authenticated(value) {
      const binding = this._binding
      if (!this.waitingCurrent(binding) || !value || value.status !== 'committed' || !/^guest-link-[a-f0-9]{40}(?![\s\S])/.test(value.principalId || '') || !/^[A-Za-z0-9_-]{43}(?![\s\S])/.test(value.csrfToken || '')) return
      const preparation = this._preparation
      if (!preparation?.current() || this.switchProblem(binding)) { this.retire('身份确认未完成，请先处理当前草稿后重新打开分享链接。'); return }
      const resume = { binding, principal: value.principalId, phase: 'starting', last: this.stamp(binding.session, binding.identity) }
      this._resume = resume; this.resuming = true; this.message = ''
      try {
        const result = await preparation.resumeCurrentSession({ csrfToken: value.csrfToken })
        if (!this.resumeCurrent(resume)) { if (this._resume === resume) this.retire(); return }
        const actual = binding.identity.getState()
        if (result?.status !== 'authenticated' || result.principalId !== resume.principal || actual?.status !== 'authenticated' || actual.principalId !== resume.principal ||
          binding.session.user?.id !== resume.principal || binding.session._identityCurrent?.() !== true) throw Error('UNCONFIRMED')
        this.retire()
      } catch { if (this._resume === resume) this.retire('身份确认未完成，请重新打开分享链接。') }
    },
    trap(event) {
      const nodes = [...this.$refs.dialog.querySelectorAll('button:not(:disabled),input:not(:disabled)')], first = nodes[0], last = nodes[nodes.length - 1]
      if (!nodes.length) { event.preventDefault(); return }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === this.$refs.dialog)) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    },
  },
}
</script>

<style>
.lark-doc .lark-doc-share-access-mask { position: fixed; z-index: 1200; inset: 0; display: grid; place-items: center; padding: 16px; background: var(--ld-mask); }
.lark-doc .lark-doc-share-access-dialog { box-sizing: border-box; width: min(440px,100%); max-height: calc(100dvh - 32px); overflow: auto; border-radius: 8px; background: var(--ld-bg-surface); color: var(--ld-text); box-shadow: var(--ld-shadow-dialog); }
.lark-doc .lark-doc-share-access-dialog > p { margin: 16px 24px; font-size: 14px; line-height: 22px; }
</style>
