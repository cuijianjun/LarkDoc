<template>
  <div
    v-if="ed.slides"
    class="lark-doc-presentation-controls"
    role="toolbar"
    aria-label="演示控制"
  >
    <button
      type="button"
      @click="ed.toggleSlides()"
    >
      返回
    </button>
    <button
      type="button"
      :aria-pressed="String(ed.presentationMode === 'document')"
      @click="setMode('document')"
    >
      文档模式
    </button>
    <button
      type="button"
      :aria-pressed="String(ed.presentationMode === 'slides')"
      @click="setMode('slides')"
    >
      幻灯片模式
    </button>
    <template v-if="ed.presentationMode === 'slides'">
      <span class="lark-doc-slide-counter">{{ ed.slideIndex + 1 }} / {{ ed.slideChapters.length }}</span>
      <button
        type="button"
        :disabled="ed.slideIndex === 0"
        @click="ed.prevSlide"
      >
        上一页
      </button><button
        type="button"
        :disabled="ed.slideIndex === ed.slideChapters.length - 1"
        @click="ed.nextSlide"
      >
        下一页
      </button><button
        type="button"
        @click="ed.toggleSlides"
      >
        退出演示
      </button>
    </template>
    <button
      v-else-if="ed.commentRemote && ed.commentCan('canView')"
      type="button"
      :aria-expanded="String(ed.commentSidebarOpen)"
      @click="ed.toggleCommentSidebar()"
    >
      评论
    </button>
  </div>
</template>

<script>
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { presentationSections } from './viewModesMixin'
import { restorePresentationView, setPresentationMode } from './documentMenuView'
// PaperStage —— 从 LarkDocEditor.vue 拆出的幻灯片演示舞台（P0-03 段 4/8）。
// 演示模式激活时替换正文纸张视图；纸张容器（.lark-doc-paper）及其子元素留父模板。
export default {
  name: 'LarkDocPaperStage',
  props: {
    ed: { type: Object, required: true },
  },
  watch: {
    'ed.slideIndex'() { this.refresh() },
    'ed.presentationMode'() { this.refresh() },
    'ed.slideChapters.length'(length) { if (this.ed.slideIndex >= length) this.ed.setSlideIndex(Math.max(0, length - 1)) },
  },
  mounted() {
    const stage = this, ed = this.ed, key = new PluginKey('lark-doc-presentation')
    this._key = key; this._editor = ed.editor
    ed.editor.registerPlugin(new Plugin({ key,
      state: {
        init: (_, state) => { const bookmark = state.selection.getBookmark(); stage._bookmark = bookmark; return bookmark },
        apply: (transaction, bookmark) => { const next = bookmark.map(transaction.mapping); stage._bookmark = next; return next },
      },
      props: { decorations(state) {
        if (!ed.slides || ed.presentationMode !== 'slides') return DecorationSet.empty
        const sections = presentationSections(state.doc), section = sections[Math.min(ed.slideIndex, sections.length - 1)], hidden = []
        state.doc.forEach((node, offset) => { if (offset < section.from || offset >= section.to) hidden.push(Decoration.node(offset, offset + node.nodeSize, { class: 'lark-doc-slide-hidden' })) })
        return DecorationSet.create(state.doc, hidden)
      } },
    }))
    this.$nextTick(() => { this.measureControls(); this.$el.querySelector('button')?.focus() })
    if (typeof ResizeObserver === 'function') { this._sizeObserver = new ResizeObserver(this.measureControls); this._sizeObserver.observe(this.$el) }
  },
  beforeDestroy() { this._sizeObserver?.disconnect(); this.ed.$refs.root?.style.removeProperty('--ld-presentation-controls-height'); restorePresentationView(this.ed, this._bookmark); if (this._editor && !this._editor.isDestroyed) this._editor.unregisterPlugin(this._key); this._bookmark = null },
  methods: {
    measureControls() { if (!this._isDestroyed) this.ed.$refs.root?.style.setProperty('--ld-presentation-controls-height', `${this.$el.offsetHeight}px`) },
    refresh() { if (this._key && this._editor && !this._editor.isDestroyed) this._editor.view.dispatch(this._editor.state.tr.setMeta(this._key, true).setMeta('addToHistory', false)) },
    setMode(mode) { setPresentationMode(this.ed, mode) },
  },
}
</script>

<style>
.lark-doc.lark-doc-slides { position: fixed; inset: 0; z-index: 150; height: 100dvh; max-height: 100dvh; overflow: hidden; background: var(--ld-bg-surface-content); }
.lark-doc.lark-doc-slides .lark-doc-topbar, .lark-doc.lark-doc-slides .lark-doc-toolbar, .lark-doc.lark-doc-slides .lark-doc-outline, .lark-doc.lark-doc-slides .lark-doc-outline-reopen, .lark-doc.lark-doc-slides .lark-doc-status, .lark-doc.lark-doc-slides .lark-doc-external-panel { display: none; }
.lark-doc.lark-doc-slides .lark-doc-body { display: flex; padding-top: var(--ld-presentation-controls-height,58px); }
.lark-doc.lark-doc-slides .lark-doc-main { padding: 16px; }
.lark-doc.lark-doc-slides .lark-doc-paper { width: min(1100px, 100%); margin: auto; min-height: calc(100vh - 90px); }
.lark-doc .lark-doc-presentation-controls { position: fixed; inset: 0 0 auto; z-index: 40; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; min-height: 48px; padding: 5px 16px; background: var(--ld-bg-surface-chrome); border-bottom: 1px solid var(--ld-border-chrome); }
.lark-doc .lark-doc-presentation-controls [aria-pressed="true"] { color: var(--lark-doc-green); background: var(--ld-bg-accent); }
.lark-doc .lark-doc-slide-hidden { display: none !important; }
.lark-doc.lark-doc-slide-pages .lark-doc-comment-layer, .lark-doc.lark-doc-slide-pages .lark-doc-comment-composer { display: none !important; }
.lark-doc .lark-doc-slide-counter { color: var(--lark-doc-green); }
</style>
