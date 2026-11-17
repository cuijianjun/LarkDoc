import { openCommentDocumentTarget } from './commentPanelView'

// Capture primitives and provider identity outside Vue data; body edits do not invalidate search.
export function captureDocumentSearchScope(ed) {
  const session = ed && ed.session, provider = session && session.getProvider('authorization')
  if (!ed || ed.nativeScopeValid === false || !session || !provider || typeof provider.searchDocuments !== 'function' || !session.can('canView')) return null
  const documentId = session.documentId, principalId = session.user && session.user.id,
    identity = session._identityGeneration, privateIdentity = session._privateIdentityGeneration, authorization = session._authorizationGeneration
  return { session, provider, current: () => ed.nativeScopeValid !== false && !ed._isDestroyed && !ed._isBeingDestroyed && !session._destroyed && ed.session === session &&
    session.documentId === documentId && (session.user && session.user.id) === principalId && identity === session._identityGeneration &&
    privateIdentity === session._privateIdentityGeneration && authorization === session._authorizationGeneration &&
    session.getProvider('authorization') === provider && session.can('canView') }
}

export default {
  data: () => ({ query: '', results: [], searchStatus: 'idle', searchMessage: '', activeResult: -1, composingSearch: false }),
  watch: {
    visible(value) { if (value) this.searchDocumentsNow(); else this.clearDocumentSearch() },
    query() {
      this.invalidateDocumentSearch()
      if (this._documentSearchDisposed || !this.visible || this.composingSearch) return
      this._documentSearchTimer = setTimeout(() => { this._documentSearchTimer = null; this.searchDocumentsNow() }, 180)
    },
  },
  mounted() { if (this.visible) this.searchDocumentsNow() },
  beforeDestroy() { this._documentSearchDisposed = true; this.clearDocumentSearch() },
  methods: {
    invalidateDocumentSearch() {
      this._documentSearchGeneration = (this._documentSearchGeneration || 0) + 1
      clearTimeout(this._documentSearchTimer); this._documentSearchTimer = null
      this.results = []; this.activeResult = -1; this.searchMessage = ''; this.searchStatus = 'idle'
    },
    clearDocumentSearch() { this.invalidateDocumentSearch(); this.query = ''; this.composingSearch = false; this._documentSearchComposition = null },
    async searchDocumentsNow() {
      this.invalidateDocumentSearch()
      if (!this.visible || this._documentSearchDisposed || this.composingSearch) return
      const scope = captureDocumentSearchScope(this.ed), generation = this._documentSearchGeneration, query = this.query
      if (!scope) { this.searchStatus = 'denied'; this.searchMessage = '当前无法搜索云文档。'; return }
      const current = () => !this._documentSearchDisposed && this.visible && generation === this._documentSearchGeneration && query === this.query && scope.current()
      this.searchStatus = 'loading'
      try {
        const value = await scope.provider.searchDocuments({ query })
        if (!current()) return
        this.results = value.items.map(item => ({ ...item })); this.activeResult = -1; this.searchStatus = 'ready'
      } catch {
        if (!current()) return
        this.searchStatus = 'error'; this.searchMessage = '搜索暂时不可用，请重试。'
      }
    },
    searchCompositionStart(event) {
      this.composingSearch = true; this.invalidateDocumentSearch()
      this._documentSearchComposition = { scope: captureDocumentSearchScope(this.ed), input: event.target }
    },
    searchCompositionEnd(event) {
      const owner = this._documentSearchComposition; this._documentSearchComposition = null; this.composingSearch = false
      if (!owner || !owner.scope?.current() || !this.visible || owner.input !== event.target || owner.input !== this.$refs.searchInput) { this.query = ''; return }
      this.$nextTick(() => { if (owner.scope.current() && this.visible && owner.input === this.$refs.searchInput) this.searchDocumentsNow() })
    },
    searchKeydown(event) {
      if (this.composingSearch || event.isComposing || event.keyCode === 229) return
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        if (!this.results.length) return
        this.activeResult = this.activeResult < 0 ? (event.key === 'ArrowDown' ? 0 : this.results.length - 1) :
          (this.activeResult + (event.key === 'ArrowDown' ? 1 : -1) + this.results.length) % this.results.length
        this.$nextTick(() => this.$refs.surface && this.$refs.surface.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }))
      } else if (event.key === 'Enter') {
        event.preventDefault()
        if (this.activeResult >= 0) this.openDocumentResult(this.results[this.activeResult])
        else if (this.searchStatus !== 'loading') this.searchDocumentsNow()
      }
    },
    async openDocumentResult(item) {
      const scope = captureDocumentSearchScope(this.ed), generation = this._documentSearchGeneration
      if (!scope || !item || this.searchStatus !== 'ready' || !this.results.includes(item)) return false
      const opened = await openCommentDocumentTarget(this.ed, item.docId)
      if (this._documentSearchDisposed || !this.visible || generation !== this._documentSearchGeneration || !scope.current()) return false
      if (opened) this.$emit('close', true)
      else this.searchMessage = '暂时无法打开该文档。'
      return opened
    },
  },
}
