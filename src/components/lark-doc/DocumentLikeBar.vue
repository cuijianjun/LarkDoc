<template>
  <section v-if="available" class="lark-doc-document-likes" aria-label="文档点赞" @keydown.stop>
    <button
      type="button"
      class="lark-doc-document-like-button"
      :class="{ 'is-liked': snapshot && snapshot.liked }"
      :aria-label="snapshot && snapshot.liked ? '取消点赞' : '点赞文档'"
      :aria-pressed="String(Boolean(snapshot && snapshot.liked))"
      :disabled="!snapshot || busy || Boolean(pending)"
      @click="toggle"
    >
      <svg width="60" height="60" viewBox="0 0 60 60" aria-hidden="true">
        <circle cx="30" cy="30" r="29.5" fill="none" stroke="currentColor" />
        <path class="lark-doc-document-like-hand" stroke="currentColor" stroke-width="2" stroke-linejoin="round" d="M24.315 38.004H35.63c.438 0 .831-.272.982-.684l3.142-8.487a2.137 2.137 0 00-2.005-2.88h-6.064a.094.094 0 01-.083-.14c.282-.508 1.277-2.263 1.537-3.105.422-1.366-.04-2.951-2.341-3.754a.094.094 0 00-.064 0 .068.068 0 00-.031.025l-2.093 2.97-2.738 3.886a.28.28 0 01-.231.118h-1.327a.082.082 0 00-.082.082v11.886c0 .046.037.083.083.083z" />
        <path fill="currentColor" d="M21.071 39.051h-1.004a.502.502 0 01-.502-.502v-13.05c0-.277.225-.502.502-.502h1.004c.277 0 .502.225.502.502v13.05a.502.502 0 01-.502.502z" />
      </svg>
    </button>
    <div class="lark-doc-document-like-caption" aria-live="polite">
      <span />{{ snapshot && snapshot.total !== '0' ? snapshot.total + ' 人点赞' : '真诚点赞，手留余香' }}<span />
    </div>
    <p v-if="message" class="lark-doc-document-like-message" role="status">
      {{ message }}
      <button v-if="pending" type="button" :disabled="busy" @click="confirm">核对结果</button>
      <button v-else type="button" :disabled="busy" @click="refresh">重试</button>
    </p>
  </section>
</template>

<script>
const compare = (a, b) => a.length === b.length ? (a < b ? -1 : a === b ? 0 : 1) : a.length < b.length ? -1 : 1
export default {
  name: 'LarkDocDocumentLikeBar',
  props: { ed: { type: Object, required: true } },
  data: () => ({ available: false, snapshot: null, busy: false, pending: '', message: '' }),
  watch: { 'ed.session'() { this.bind() }, 'ed.commentIdentityGeneration'() { this.bind() } },
  mounted() { this.bind() },
  beforeDestroy() { this.unbind() },
  methods: {
    unbind() {
      this._binding = null; this._read = null
      this._stops?.forEach(stop => stop()); this._stops = []
      this._awareness?.off('information-revision', this._changed); this._awareness = null
    },
    bind() {
      this.unbind(); this.snapshot = null; this.busy = false; this.pending = ''; this.message = ''
      const session = this.ed.session, provider = session?.getProvider?.('authorization'), principal = session?.user?.id, identity = session?._privateIdentityGeneration
      const binding = { session, provider, principal, identity, identityGeneration: session?._identityGeneration, documentId: session?.documentId }; this._binding = binding
      this.available = Boolean(provider?.isRemote && typeof provider.documentInformation === 'function' && session.can('canView'))
      if (!session) return
      this._stops = [session.on('identity', () => this.bind()), session.on('provider-changed', () => this.bind()), session.on('capabilities', () => {
        if (!session.can('canView') || !this.available || provider !== session.getProvider('authorization') || principal !== session.user?.id || identity !== session._privateIdentityGeneration) this.bind()
        else if (this._read || this.busy) { this._read = null; void this.refresh() }
      })]
      this._awareness = this.ed.editor?.extensionManager.extensions.find(extension => extension.name === 'collaborationCaret')?.options.provider?.awareness
      this._changed = () => { if (this.current(binding)) void this.refresh() }
      this._awareness?.on('information-revision', this._changed)
      if (this.available) void this.refresh()
    },
    current(binding) {
      const session = binding?.session
      return Boolean(binding && binding === this._binding && !this._isDestroyed && !this._isBeingDestroyed && !this.ed._isDestroyed && !this.ed._isBeingDestroyed && !session?._destroyed && session === this.ed.session &&
        binding.documentId === session.documentId && binding.identityGeneration === session._identityGeneration &&
        binding.provider === session.getProvider('authorization') && binding.principal === session.user?.id && binding.identity === session._privateIdentityGeneration && session.can('canView'))
    },
    accept(value) {
      if (!this.snapshot || compare(value.revision, this.snapshot.revision) >= 0) this.snapshot = value
    },
    async refresh() {
      const binding = this._binding, token = {}, authorization = binding?.session?._authorizationGeneration
      if (!this.available || !this.current(binding)) return
      this._read = token
      try {
        const unresolved = await binding.provider.documentInformation('operation', 'like')
        if (!this.current(binding) || this._read !== token || authorization !== binding.session._authorizationGeneration) return
        this.pending = unresolved?.operationId || ''; if (this.pending) this.message = '点赞结果待确认。'
        const value = await binding.provider.documentInformation('read', 'likes')
        if (this.current(binding) && this._read === token && authorization === binding.session._authorizationGeneration) { this.accept(value); if (!this.pending) this.message = '' }
      } catch { if (this.current(binding) && this._read === token) this.message = '暂时无法加载点赞，请重试。' }
      finally { if (this._read === token) this._read = null }
    },
    async toggle() {
      if (!this.snapshot || this.busy || this.pending) return
      const binding = this._binding
      if (!this.current(binding)) return
      this.busy = true; this.message = ''; this._read = null
      try {
        const result = await binding.provider.documentInformation('request', { kind: 'like', expectedRevision: this.snapshot.revision, liked: !this.snapshot.liked })
        if (this.current(binding)) { this.accept(result.like); await this.refresh() }
      } catch (cause) {
        if (!this.current(binding)) return
        if (cause.status === 'unknown' && cause.operationId) { this.pending = cause.operationId; this.message = '点赞结果待确认。' }
        else if (cause.httpStatus === 409) { await this.refresh(); if (this.current(binding)) this.message = '点赞状态已变化，请重新选择。' }
        else this.message = '暂时无法更改点赞，请重试。'
      } finally { if (this.current(binding)) this.busy = false }
    },
    async confirm() {
      const binding = this._binding, id = this.pending
      if (!id || this.busy || !this.current(binding)) return
      this.busy = true
      try {
        const value = await binding.provider.documentInformation('query', id)
        if (this.current(binding)) { this.accept(value.like); this.pending = ''; this.message = ''; await this.refresh() }
      } catch { if (this.current(binding)) this.message = '结果仍待确认，请稍后核对。' }
      finally { if (this.current(binding)) this.busy = false }
    },
  },
}
</script>

<style>
.lark-doc .lark-doc-document-likes { box-sizing: border-box; display: flex; flex-direction: column; align-items: center; width: min(100%, 870px); margin: 0 auto; min-height: 136px; border-left: 1px solid var(--ld-border-paper); border-right: 1px solid var(--ld-border-paper); padding: 0 24px 24px; background: var(--ld-bg-content); color: var(--ld-text-secondary); }
.lark-doc.lark-doc-width-wide .lark-doc-document-likes { width: min(100%, 1140px); }
.lark-doc.lark-doc-width-full .lark-doc-document-likes { width: 100%; }
.lark-doc .lark-doc-document-like-button { display: block; flex: none; width: 60px; height: 60px; padding: 0; border: 0; border-radius: 50%; background: transparent; color: var(--ld-brand-chrome); cursor: pointer; }
.lark-doc .lark-doc-document-like-button svg { display: block; width: 100%; height: 100%; }
.lark-doc .lark-doc-document-like-hand { fill: none; }
.lark-doc .lark-doc-document-like-button.is-liked .lark-doc-document-like-hand { fill: currentColor; }
.lark-doc .lark-doc-document-like-button:hover:not(:disabled) { background: var(--ld-bg-hover-chrome); }
.lark-doc .lark-doc-document-like-button:focus-visible { outline: 2px solid var(--ld-brand-chrome); outline-offset: 3px; }
.lark-doc .lark-doc-document-like-button:disabled { cursor: default; opacity: .6; }
.lark-doc .lark-doc-document-like-caption { display: flex; align-items: center; gap: 7px; min-height: 20px; margin: 24px 0 8px; font-size: 14px; line-height: 20px; }
.lark-doc .lark-doc-document-like-caption > span { width: 35px; border-top: 1px solid var(--ld-border-chrome); }
.lark-doc .lark-doc-document-like-message { margin: 0; font-size: 12px; line-height: 20px; }
.lark-doc .lark-doc-document-like-message button { margin-left: 8px; padding: 0; border: 0; background: transparent; color: var(--ld-brand-chrome); font: inherit; cursor: pointer; }
</style>
