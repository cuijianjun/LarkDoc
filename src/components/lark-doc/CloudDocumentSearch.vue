<template>
  <div v-if="visible" class="lark-doc-cloud-search-mask">
    <section ref="surface" class="lark-doc-cloud-search" :style="nativeSurfaceStyle" role="dialog" aria-modal="true" aria-label="搜索云文档" tabindex="-1" @keydown.stop="nativeSurfaceKeydown">
      <div class="lark-doc-cloud-search-input">
        <lark-doc-icon name="search" :size="18" />
        <input ref="searchInput" v-model="query" type="search" maxlength="128" placeholder="搜索" aria-label="搜索云文档" role="combobox" aria-autocomplete="list" :aria-controls="resultListId" :aria-expanded="String(searchStatus === 'ready' && results.length > 0)" :aria-activedescendant="activeResult < 0 ? null : `${resultListId}-${activeResult}`" @keydown="searchKeydown" @compositionstart="searchCompositionStart" @compositionend="searchCompositionEnd">
        <button type="button" class="lark-doc-cloud-search-close" aria-label="关闭云文档搜索" @click="$emit('close', true)">×</button>
      </div>
      <div class="lark-doc-cloud-search-body" :aria-busy="String(searchStatus === 'loading')">
        <p v-if="searchStatus === 'loading'" class="lark-doc-cloud-search-message" role="status">正在搜索…</p>
        <p v-if="searchMessage" class="lark-doc-cloud-search-message" role="status">{{ searchMessage }} <button v-if="searchStatus === 'error'" type="button" @click="searchDocumentsNow">重试</button></p>
        <p v-if="searchStatus === 'ready' && !results.length" class="lark-doc-cloud-search-message" role="status">未找到可访问的云文档</p>
        <ul :id="resultListId" role="listbox" aria-label="云文档搜索结果" class="lark-doc-cloud-search-results">
          <li v-for="(item, index) in results" :id="`${resultListId}-${index}`" :key="item.docId" role="option" :aria-selected="String(index === activeResult)">
            <button type="button" class="lark-doc-cloud-search-result" @focus="activeResult = index" @mouseenter="activeResult = index" @click="openDocumentResult(item)">
              <svg width="24" height="28" viewBox="0 0 24 28" fill="none" aria-hidden="true"><path d="M4 1h10l6 6v19H4V1Z" stroke="currentColor" stroke-width="1.5" /><path d="M14 1v7h6M8 13h8M8 17h8M8 21h5" stroke="currentColor" stroke-width="1.5" /></svg>
              <span>{{ item.displayName }}</span>
            </button>
          </li>
        </ul>
      </div>
    </section>
  </div>
</template>

<script>
import LarkDocIcon from './LarkDocIcon.vue'
import documentSearchMixin, { nativePanelSurface } from './editor/documentSearchMixin'
export default {
  name: 'LarkDocCloudDocumentSearch',
  components: { LarkDocIcon },
  mixins: [nativePanelSurface, documentSearchMixin],
  props: { ed: { type: Object, required: true } },
  data: () => ({ nativePanelWidth: 540, nativePanelHeight: 630 }),
  computed: { resultListId() { return `lark-doc-cloud-search-${this._uid}` } },
  methods: {
    // 搜索是居中模态框；通知仍沿共用 surface 的锚点定位。
    positionNativeSurface() {
      const anchor = this.anchor(), surface = this.$refs.surface
      if (!this.visible || !surface || !anchor || !anchor.isConnected) { if (this.visible) this.$emit('close', false); return }
      const rect = anchor.getBoundingClientRect(), viewport = window.visualViewport,
        left = viewport ? viewport.offsetLeft : 0, top = viewport ? viewport.offsetTop : 0,
        width = viewport ? viewport.width : document.documentElement.clientWidth,
        height = viewport ? viewport.height : document.documentElement.clientHeight
      if (rect.bottom < top || rect.top > top + height || rect.right < left || rect.left > left + width) { this.$emit('close', false); return }
      const panelWidth = Math.min(this.nativePanelWidth, Math.max(0, width - 16)),
        panelHeight = Math.min(this.nativePanelHeight, Math.max(0, height - (height >= 166 ? 120 : 16)))
      this.nativeSurfaceStyle = { position: 'fixed', left: `${left + (width - panelWidth) / 2}px`, top: `${top + (height - panelHeight) / 2}px`,
        width: `${panelWidth}px`, height: `${panelHeight}px`, maxHeight: `${panelHeight}px` }
    },
    nativeSurfaceKeydown(event) {
      nativePanelSurface.methods.nativeSurfaceKeydown.call(this, event)
      if (event.key !== 'Tab' || event.isComposing || event.keyCode === 229) return
      const surface = this.$refs.surface
      if (!surface) return
      const controls = Array.from(surface.querySelectorAll('input:not(:disabled), button:not(:disabled), [tabindex]:not([tabindex="-1"])'))
        .filter(node => node.getClientRects().length)
      const first = controls[0], last = controls[controls.length - 1], active = document.activeElement
      if (!first || !controls.includes(active) || (event.shiftKey ? active === first : active === last)) {
        event.preventDefault(); (event.shiftKey ? last : first)?.focus({ preventScroll: true })
        if (!first) surface.focus({ preventScroll: true })
      }
    },
  },
}
</script>

<style scoped>
.lark-doc .lark-doc-cloud-search-mask { position: fixed; z-index: 999; inset: 0; background: var(--ld-mask); }
.lark-doc .lark-doc-cloud-search { position: fixed; box-sizing: border-box; display: flex; flex-direction: column; max-width: calc(100vw - 16px); padding: 0; overflow: hidden; border: 0; border-radius: 8px; background: var(--ld-bg-surface); color: var(--ld-text); box-shadow: 0 6px 24px rgba(31, 35, 41, .1); }
.lark-doc .lark-doc-cloud-search-input { display: flex; align-items: center; gap: 10px; flex: 0 0 46px; box-sizing: border-box; padding: 0 12px; }
.lark-doc .lark-doc-cloud-search-input input { min-width: 0; width: 100%; height: 26px; min-height: 26px; padding: 1px 2px; border: 0; border-radius: 0; outline: 0; background: transparent; color: var(--ld-text); font-family: inherit; font-size: 14px; line-height: 22px; }
.lark-doc .lark-doc-cloud-search-input input::placeholder { color: var(--ld-text-tertiary); }
.lark-doc .lark-doc-cloud-search-close { flex: 0 0 28px; width: 28px; min-width: 28px; height: 28px; min-height: 28px; padding: 0; border: 0; background: transparent; font-size: 22px; color: var(--ld-text-secondary); }
.lark-doc .lark-doc-cloud-search-body { flex: 1; min-height: 0; max-height: 584px; overflow: auto; border-radius: 0 0 8px 8px; }
.lark-doc .lark-doc-cloud-search-results { margin: 0; padding: 4px; list-style: none; }
.lark-doc .lark-doc-cloud-search-result { display: flex; align-items: center; gap: 12px; width: 100%; height: 60px; min-height: 60px; padding: 8px 8px 8px 12px; border: 0; border-radius: 8px; background: transparent; color: var(--ld-text); text-align: left; }
.lark-doc .lark-doc-cloud-search-result span { overflow: hidden; font-size: 14px; font-weight: 700; line-height: 22px; white-space: nowrap; text-overflow: ellipsis; }
.lark-doc .lark-doc-cloud-search-result svg { flex: 0 0 auto; color: var(--ld-text-accent); }
.lark-doc .lark-doc-cloud-search-results [aria-selected="true"] button, .lark-doc .lark-doc-cloud-search-result:focus-visible { background: var(--ld-bg-hover); }
.lark-doc .lark-doc-cloud-search-message { margin: 0; padding: 24px 16px; color: var(--ld-text-secondary); font-size: 14px; line-height: 22px; }
@media print { .lark-doc .lark-doc-cloud-search-mask { display: none !important; } }
</style>
