<template>
  <div class="lark-doc-access-mask" @pointerdown.self="$emit('close')">
    <section ref="dialog" class="lark-doc-access-dialog" role="dialog" aria-modal="true" :aria-label="scope === 'pending' ? '处理权限申请' : '申请文档权限'" tabindex="-1" @keydown.stop="keydown">
      <header><h2>{{ scope === 'pending' ? '处理权限申请' : '申请文档权限' }}</h2><button type="button" aria-label="关闭权限申请" @click="$emit('close')">×</button></header>
      <p v-if="!authenticated" role="status">请先登录后申请权限。</p>
      <template v-else>
        <p v-if="errorMessage" role="status">{{ errorMessage }}</p>
        <p v-if="loginRequired" role="status">请使用正常账号登录后申请权限。</p>
        <p v-if="pending" role="status">结果待确认，可重试查询 <button type="button" :disabled="busy || loading" @click="confirm">查询结果</button></p>
        <div class="lark-doc-access-actions"><button type="button" :disabled="busy || loading" @click="load(true)">{{ loading ? '正在刷新…' : '刷新状态' }}</button><button v-if="snapshot && snapshot.canReview" type="button" :disabled="busy || loading" @click="$emit('change-scope', scope === 'pending' ? 'self' : 'pending')">{{ scope === 'pending' ? '我的申请' : '处理申请' }}</button></div>
        <form v-if="scope === 'self' && snapshot && !ownPending && !loginRequired" @submit.prevent="submitRequest">
          <label>申请权限 <select v-model="role" aria-label="申请权限" :disabled="busy || loading || Boolean(pending)"><option value="reader">可阅读</option><option value="editor">可编辑</option></select></label>
          <label>申请说明（选填）<textarea v-model="message" maxlength="500" rows="3" aria-label="申请说明" :disabled="busy || Boolean(pending)" placeholder="说明你需要访问此文档的原因" /></label>
          <button type="submit" class="lark-doc-access-primary" :disabled="busy || loading || Boolean(pending)">发送申请</button>
        </form>
        <p v-if="scope === 'self' && snapshot && !snapshot.canRead" class="lark-doc-access-hint">申请不会立即授予访问权限。可在这里刷新查看处理结果。</p>
        <p v-if="snapshot && !snapshot.items.length" role="status">{{ scope === 'pending' ? '暂无待处理的申请' : '暂无申请记录' }}</p>
        <ul class="lark-doc-access-list">
          <li v-for="item in items" :key="item.requestId">
            <div><strong>{{ item.requesterId }}</strong><span>{{ item.role === 'editor' ? '申请可编辑权限' : '申请可阅读权限' }}</span><span>{{ statusLabel(item.status) }}</span></div>
            <p v-if="item.message">{{ item.message }}</p><p v-if="item.reason">处理说明：{{ item.reason }}</p>
            <div v-if="item.status === 'pending'" class="lark-doc-access-row-actions">
              <template v-if="scope === 'pending' && snapshot && snapshot.canReview"><label>处理说明（选填）<input :value="decisionReasons[item.requestId] || ''" maxlength="500" :aria-label="`处理${item.requesterId}申请的说明`" :disabled="busy || Boolean(pending)" @input="$set(decisionReasons, item.requestId, $event.target.value)"></label><button type="button" :disabled="busy || loading || Boolean(pending)" @click="decide('reject', item)">拒绝</button><button type="button" class="lark-doc-access-primary" :disabled="busy || loading || Boolean(pending)" @click="decide('approve', item)">同意</button></template>
              <button v-else-if="snapshot && item.requesterId === snapshot.principalId" type="button" :disabled="busy || loading || Boolean(pending)" @click="decide('cancel', item)">取消申请</button>
            </div>
          </li>
        </ul>
      </template>
    </section>
  </div>
</template>

<script>
const compare = (a, b) => a.length === b.length ? (a < b ? -1 : a === b ? 0 : 1) : a.length < b.length ? -1 : 1
const denied = cause => [401, 403, 404].includes(cause?.httpStatus || cause?.status)
export default {
  name: 'LarkDocDocumentAccessDialog',
  props: { ed: { type: Object, required: true }, scope: { type: String, default: 'self' } },
  data: () => ({ snapshot: null, authenticated: false, loginRequired: false, loading: false, busy: false, pending: '', role: 'reader', message: '', decisionReasons: {}, errorMessage: '' }),
  computed: {
    items() { return this.snapshot?.items || [] },
    ownPending() { return this.items.find(item => item.requesterId === this.snapshot?.principalId && item.status === 'pending') },
  },
  watch: { scope() { this.snapshot = null; void this.load() }, 'ed.session'() { this.bind() } },
  mounted() { this._returnFocus = document.activeElement; this.bind(); this.$nextTick(() => this.$refs.dialog?.focus({ preventScroll: true })) },
  beforeDestroy() { this._disposed = true; this._binding = null; this._read = null; this._stops?.forEach(stop => stop()); if (this._returnFocus?.isConnected) this._returnFocus.focus({ preventScroll: true }) },
  methods: {
    bind() {
      this._capabilityRefreshes = new Set()
      this._stops?.forEach(stop => stop()); this._stops = []; this._read = null; this.busy = false; this.loading = false; this.snapshot = null; this.pending = ''; this.errorMessage = ''; this.message = ''; this.decisionReasons = {}; this.loginRequired = false
      const session = this.ed.session, provider = session?.getProvider?.('authorization'), principal = session?.user?.id,
        identity = session?._identityGeneration, privateIdentity = session?._privateIdentityGeneration, docId = session?.documentId
      const binding = { session, provider, principal, identity, privateIdentity, docId }; this._binding = binding
      this.authenticated = Boolean(principal && session?._identityCurrent?.() && typeof provider?.documentAccess === 'function')
      if (session?.on) {
        this._stops.push(session.on('identity', () => this.bind()), session.on('provider-changed', event => { if (event.name === 'authorization') this.bind() }), session.on('comments-reset', reason => {
          if (reason !== 'authorization-required') this.bind(); else { this._read = null; this.snapshot = null }
        }), session.on('capabilities', () => { if (this.current(binding) && !this.busy) void this.load() }))
      }
      if (this.authenticated) return this.load()
    },
    current(binding) {
      const session = binding?.session
      return Boolean(binding && this._binding === binding && !this._disposed && !this._isDestroyed && !this._isBeingDestroyed && session === this.ed.session && !session?._destroyed &&
        session._identityCurrent?.() && binding.provider === session.getProvider('authorization') && binding.principal === session.user?.id && binding.identity === session._identityGeneration && binding.privateIdentity === session._privateIdentityGeneration && binding.docId === session.documentId)
    },
    accept(value) {
      if (value.principalId !== this._binding.principal) throw Error('CONTEXT_CHANGED')
      const old = new Map(this.items.map(item => [item.requestId, item]))
      this.snapshot = { ...value, items: value.items.map(item => old.has(item.requestId) && compare(old.get(item.requestId).revision, item.revision) > 0 ? old.get(item.requestId) : { ...item }) }
    },
    async load(manual) {
      if (manual === true) this._capabilityRefreshes = new Set()
      const binding = this._binding, token = {}; if (!this.current(binding)) return
      this._read = token; this.loading = true; this.errorMessage = ''
      try {
        const operation = await binding.provider.documentAccess('operation')
        if (!this.current(binding) || this._read !== token) return
        this.pending = operation?.operationId || ''
        const value = await binding.provider.documentAccess('list', this.scope)
        if (!this.current(binding) || this._read !== token) return
        this.accept(value)
        if (value.canRead && !binding.session.can('canEdit') && !this.ownPending) this.role = 'editor'
        const approval = value.items.find(item => item.requesterId === value.principalId && item.status === 'approved' && item.role === 'editor')
        const role = value.canRead && !binding.session.can('canView') ? 'reader' : value.canRead && !binding.session.can('canEdit') && approval ? 'editor' : null
        const key = role === 'editor' ? approval.requestId + ':' + approval.revision : 'read'
        if (role && !this._capabilityRefreshes.has(key)) { this._capabilityRefreshes.add(key); this.$emit('read-available', role) }
      } catch (cause) {
        if (this.current(binding) && this._read === token) { this.snapshot = null; if (denied(cause)) this.decisionReasons = {}; this.errorMessage = '暂时无法读取申请状态，请重试。' }
      }
      finally { if (this._read === token) { this._read = null; this.loading = false } }
    },
    submitRequest() { if (this.ownPending) return; return this.mutate({ kind: 'request', expectedRevision: '0', role: this.role, message: this.message }) },
    decide(kind, item) {
      if (!this.items.includes(item) || item.status !== 'pending' || !['approve', 'reject', 'cancel'].includes(kind)) return
      if (kind === 'cancel' ? item.requesterId !== this.snapshot?.principalId : !this.snapshot?.canReview || this.scope !== 'pending') return
      return this.mutate({ kind, requestId: item.requestId, expectedRevision: item.revision, reason: this.decisionReasons[item.requestId] || '' })
    },
    async mutate(input) {
      const binding = this._binding
      if (this.loginRequired || this.busy || this.loading || this.pending || !this.current(binding)) return
      const token = {}; this._write = token; this._read = null; this.busy = true; this.errorMessage = ''
      try {
        await binding.provider.documentAccess('request', input)
        if (!this.current(binding) || this._write !== token) return
        if (input.kind === 'request') this.message = ''
        await this.load()
      } catch (cause) {
        if (!this.current(binding) || this._write !== token) return
        if (denied(cause)) { this.snapshot = null; this.decisionReasons = {} }
        if (cause.code === 'PG_ACCESS_LOGIN_REQUIRED') { this.loginRequired = true; this.errorMessage = ''; return }
        const unresolved = await Promise.resolve(binding.provider.documentAccess('operation')).catch(() => null)
        if (!this.current(binding) || this._write !== token) return
        if (unresolved?.operationId || cause.status === 'unknown' && cause.operationId) { this.pending = unresolved?.operationId || cause.operationId; this.errorMessage = '结果待确认，可重试查询' }
        else {
          const message = cause.httpStatus === 409 ? '申请状态已变化，请刷新后重新选择。' : '申请操作未完成，请重试。'
          if (cause.httpStatus === 409) await this.load()
          if (this.current(binding) && this._write === token) this.errorMessage = message
        }
      } finally { if (this.current(binding) && this._write === token) this.busy = false }
    },
    async confirm() {
      const binding = this._binding, key = this.pending
      if (!key || this.busy || this.loading || !this.current(binding)) return
      const token = {}; this._write = token; this.busy = true
      try { await binding.provider.documentAccess('query', key); if (this.current(binding) && this._write === token) { this.pending = ''; await this.load() } }
      catch (cause) { if (this.current(binding) && this._write === token) { if (denied(cause)) { this.snapshot = null; this.decisionReasons = {} } this.errorMessage = '结果待确认，可重试查询' } }
      finally { if (this.current(binding) && this._write === token) this.busy = false }
    },
    statusLabel(status) { return { pending: '待处理', approved: '已同意', rejected: '已拒绝', cancelled: '已取消' }[status] || '' },
    keydown(event) {
      if (event.key === 'Escape' && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); this.$emit('close'); return }
      if (event.key !== 'Tab') return
      const nodes = [...this.$refs.dialog.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled)')], first = nodes[0], last = nodes[nodes.length - 1]
      if (event.shiftKey && (document.activeElement === first || document.activeElement === this.$refs.dialog)) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    },
  },
}
</script>

<style>
.lark-doc .lark-doc-access-mask { position: fixed; z-index: 1100; inset: 0; display: flex; align-items: center; justify-content: center; padding: 16px; box-sizing: border-box; background: rgba(0,0,0,.35); }
.lark-doc .lark-doc-access-dialog { width: 520px; max-width: 100%; max-height: calc(100dvh - 32px); overflow: auto; padding: 24px; box-sizing: border-box; border-radius: 8px; background: var(--ld-bg-surface); color: var(--ld-text); box-shadow: 0 8px 32px rgba(0,0,0,.2); }
.lark-doc .lark-doc-access-dialog header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
.lark-doc .lark-doc-access-dialog h2 { margin: 0; font-size: 18px; line-height: 26px; }
.lark-doc .lark-doc-access-dialog label { display: flex; flex-direction: column; gap: 6px; margin: 12px 0; font-size: 14px; }
.lark-doc .lark-doc-access-dialog textarea, .lark-doc .lark-doc-access-dialog input, .lark-doc .lark-doc-access-dialog select { box-sizing: border-box; width: 100%; padding: 6px 10px; border: 1px solid var(--ld-border-control); border-radius: 6px; background: var(--ld-bg-surface); color: var(--ld-text); font: inherit; }
.lark-doc .lark-doc-access-actions, .lark-doc .lark-doc-access-row-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.lark-doc .lark-doc-access-row-actions label { flex-basis: 100%; }
.lark-doc .lark-doc-access-hint { color: var(--ld-text-secondary); font-size: 13px; line-height: 20px; }
.lark-doc .lark-doc-access-list { padding: 0; margin: 16px 0 0; list-style: none; }
.lark-doc .lark-doc-access-list li { padding: 12px 0; border-top: 1px solid var(--ld-border); }
.lark-doc .lark-doc-access-list li > div:first-child { display: flex; flex-wrap: wrap; gap: 8px; font-size: 14px; }
.lark-doc .lark-doc-access-list p { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 14px; line-height: 22px; }
.lark-doc .lark-doc-access-dialog .lark-doc-access-primary { padding: 4px 12px; background: var(--ld-brand-chrome); color: var(--ld-text-on-brand); border-color: transparent; }
@media print { .lark-doc .lark-doc-access-mask { display: none !important; } }
</style>
