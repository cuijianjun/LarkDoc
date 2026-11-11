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

// Both native surfaces remain siblings of other fixed overlays. No global portal or document listener survives close.
export const nativePanelSurface = {
  props: { visible: { type: Boolean, default: false }, anchor: { type: Function, default: () => null } },
  data: () => ({ nativeSurfaceStyle: {} }),
  watch: { visible(value) { if (value) this.$nextTick(() => this.startNativeSurface()); else this.stopNativeSurface() } },
  mounted() { if (this.visible) this.$nextTick(() => this.startNativeSurface()) },
  beforeDestroy() { this._nativeSurfaceDisposed = true; this.stopNativeSurface() },
  methods: {
    startNativeSurface() {
      this.stopNativeSurface()
      if (this._nativeSurfaceDisposed || !this.visible || typeof window === 'undefined') return
      const outside = event => {
        const node = this.$refs.surface, anchor = this.anchor()
        const path = typeof event.composedPath === 'function' ? event.composedPath() : []
        if (node && !node.contains(event.target) && !path.includes(node) && !(anchor && (anchor.contains(event.target) || path.includes(anchor)))) this.$emit('close', false)
      }
      const position = () => this.positionNativeSurface()
      const keydown = event => { if (event.key === 'Escape' && this.visible && this.$refs.surface) this.nativeSurfaceKeydown(event) }
      document.addEventListener('pointerdown', outside, true)
      document.addEventListener('focusin', outside, true)
      document.addEventListener('keydown', keydown, true)
      window.addEventListener('resize', position)
      window.addEventListener('scroll', position, true)
      const viewport = window.visualViewport
      if (viewport) { viewport.addEventListener('resize', position); viewport.addEventListener('scroll', position) }
      const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(position) : null
      if (observer && this.$refs.surface) observer.observe(this.$refs.surface)
      if (observer && this.anchor()) observer.observe(this.anchor())
      this._nativeSurfaceStop = () => {
        document.removeEventListener('pointerdown', outside, true); document.removeEventListener('focusin', outside, true)
        document.removeEventListener('keydown', keydown, true)
        window.removeEventListener('resize', position); window.removeEventListener('scroll', position, true)
        if (viewport) { viewport.removeEventListener('resize', position); viewport.removeEventListener('scroll', position) }
        if (observer) observer.disconnect()
      }
      this.positionNativeSurface()
      const focus = this.$refs.searchInput || this.$refs.surface
      if (focus && this.visible) focus.focus({ preventScroll: true })
    },
    stopNativeSurface() { if (this._nativeSurfaceStop) this._nativeSurfaceStop(); this._nativeSurfaceStop = null },
    positionNativeSurface() {
      const anchor = this.anchor(), surface = this.$refs.surface
      if (!this.visible || !surface || !anchor || !anchor.isConnected) { if (this.visible) this.$emit('close', false); return }
      const rect = anchor.getBoundingClientRect(), viewport = window.visualViewport,
        left = viewport ? viewport.offsetLeft : 0, top = viewport ? viewport.offsetTop : 0,
        width = viewport ? viewport.width : document.documentElement.clientWidth,
        height = viewport ? viewport.height : document.documentElement.clientHeight
      if (rect.bottom < top || rect.top > top + height || rect.right < left || rect.left > left + width) { this.$emit('close', false); return }
      const panelWidth = Math.min(this.nativePanelWidth || 402, Math.max(0, width - 16))
      const x = this.nativePanelWidth === 540 ? left + (width - panelWidth) / 2 : rect.right - panelWidth
      const y = Math.min(Math.max(top + 8, rect.bottom + 3), Math.max(top + 8, top + height - Math.min(surface.scrollHeight, this.nativePanelHeight || 555) - 8))
      this.nativeSurfaceStyle = { position: 'fixed', left: `${Math.max(left + 8, Math.min(x, left + width - panelWidth - 8))}px`, top: `${y}px`,
        width: `${panelWidth}px`, maxHeight: `${Math.max(0, top + height - y - 8)}px` }
    },
    nativeSurfaceKeydown(event) {
      if (event.key === 'Escape' && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); event.stopPropagation(); this.$emit('close', true) }
    },
  },
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
