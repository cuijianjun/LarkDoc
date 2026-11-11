<template>
  <form class="lark-doc-share-access-form" aria-label="访问分享文档" @submit.prevent="submit">
    <div class="lark-doc-share-password-header"><h3 class="lark-doc-share-password-title">访问分享文档</h3></div>
    <div class="lark-doc-share-password-body">
      <div class="lark-doc-share-password-content">
        <label>请输入密码（普通链接无需密码）
          <input :value="password" type="password" autocomplete="current-password" aria-label="分享链接密码" :disabled="busy || !!pending" @input="password = $event.target.value">
        </label>
        <p v-if="message" role="status">{{ message }}</p>
      </div>
    </div>
    <div class="lark-doc-share-password-footer">
      <button v-if="pending" type="button" class="lark-doc-share-btn-filled" :disabled="busy" @click="query">核对原操作</button>
      <button v-else type="submit" class="lark-doc-share-btn-filled" :disabled="busy">{{ busy ? '正在验证…' : '访问文档' }}</button>
    </div>
  </form>
</template>
<script>
export default {
  name: 'ShareLinkAccess',
  props: { port: { type: Object, required: true }, linkId: { type: String, required: true } },
  data: () => ({ password: '', busy: false, pending: '', message: '' }),
  watch: { port(next, prior) { prior.reset(); this.clear() }, linkId() { this.port.reset(); this.clear() } },
  beforeDestroy() { this._accessDisposed = true; this.port.reset(); this.clear() },
  methods: {
    clear() { this._accessToken = null; this.password = ''; this.pending = ''; this.busy = false; this.message = '' },
    submit() { return this.run(false) },
    query() { return this.run(true) },
    async run(querying) {
      if (this.busy || !querying && this.pending) return
      const token = {}, port = this.port, linkId = this.linkId, password = this.password
      this._accessToken = token; this.busy = true; this.message = ''
      const current = () => !this._accessDisposed && !this._isDestroyed && this._accessToken === token && this.port === port && this.linkId === linkId
      try {
        const result = await (querying ? port.query() : port.request({ linkId, ...(password ? { password } : {}) }))
        if (!current()) return
        this.password = ''; this.pending = ''; this.$emit('authenticated', result)
      } catch (cause) {
        if (!current()) return
        const original = port.operation()
        this.pending = original && ['pending', 'unknown'].includes(original.status) ? original.operationId : ''
        this.password = ''
        this.message = this.pending ? '访问结果待确认，请核对原操作。' : cause.code === 'SHARE_LINK_CRYPTO_UNAVAILABLE' ? '链接验证服务尚未配置，请联系文档管理者。' : '链接或密码不可用，请向文档管理者确认。'
      } finally { if (current()) this.busy = false }
    },
  },
}
</script>
<style scoped>
.lark-doc .lark-doc-share-access-form { width: 100%; margin: 0; color: var(--ld-text); }
.lark-doc .lark-doc-share-access-form .lark-doc-share-password-header { width: 100%; height: auto; min-height: 64px; }
.lark-doc .lark-doc-share-access-form .lark-doc-share-password-title,
.lark-doc .lark-doc-share-access-form .lark-doc-share-password-content { width: auto; }
.lark-doc .lark-doc-share-access-form .lark-doc-share-password-body { width: 100%; height: auto; }
.lark-doc .lark-doc-share-access-form input { display: block; box-sizing: border-box; width: 100%; margin-top: 8px; padding: 8px; border: 1px solid var(--ld-border); border-radius: 4px; background: var(--ld-bg-surface); color: inherit; font: inherit; }
.lark-doc .lark-doc-share-access-form .lark-doc-share-password-footer { width: auto; height: auto; min-height: 32px; margin: 24px; }
</style>
