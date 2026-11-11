<template>
  <section
    class="lark-doc-comment-composer lark-doc-document-composer"
    aria-label="发表全文评论"
    @keydown.stop
    @mousedown.stop
  >
    <div
      class="lark-doc-document-comment-input"
      :class="{ 'is-multiline': multiline }"
    >
      <CommentTextInput
        ref="input"
        class="lark-doc-comment-input-zone"
        :ed="ed"
        :value="ed.commentDocumentDraft"
        :mentions="ed.commentDocumentMentions"
        :references="ed.commentDocumentReferences"
        :readonly="!ed.commentDocumentCanSubmit()"
        @input="ed.setCommentDocumentDraft($event.content, $event.mentions, $event.references)"
        @resize="resizeInput"
        @keydown="onInputKeydown"
      />
      <div class="lark-doc-document-comment-tools">
        <button
          type="button"
          class="lark-doc-comment-operation"
          aria-label="全文评论插入图片"
          :disabled="!ed.commentCanUploadImage('document')"
          @mousedown.prevent
          @click="chooseImage"
        >
          <LarkDocIcon
            name="rev-image"
            :size="20"
          />
        </button>
        <button
          ref="more"
          type="button"
          class="lark-doc-document-comment-more"
          aria-label="全文评论更多"
          aria-haspopup="dialog"
          :aria-expanded="String(optionsOpen)"
          :disabled="!ed.commentAllowed('create')"
          @mousedown.prevent
          @mouseenter="openOptions()"
          @mouseleave="scheduleOptionsClose"
          @click="openOptions(true)"
        >
          ⋯
        </button>
      </div>
      <input
        ref="file"
        type="file"
        hidden
        multiple
        accept="image/png,image/jpeg,image/gif,image/webp"
        data-comment-image-scope="document"
        @change="uploadCommentImageFiles('document', $event)"
      >
    </div>
    <div
      v-if="images.length"
      class="lark-doc-comment-image-drafts"
    >
      <div
        v-for="image in images"
        :key="image.assetId"
      >
        <img
          v-if="image.previewUrl"
          :src="image.previewUrl"
          :alt="image.fileName"
        >
        <span v-else>{{ image.fileName }}</span>
        <button
          type="button"
          :aria-label="'移除图片：' + image.fileName"
          @click="ed.removeCommentDraftImage('document', image.assetId)"
        >
          ×
        </button>
      </div>
    </div>
    <div
      v-if="hasContent"
      class="lark-doc-comment-compose-actions"
    >
      <button
        type="button"
        class="lark-doc-comment-action is-outlined"
        @mousedown.prevent
        @click="cancel"
      >
        取消
      </button>
      <button
        type="button"
        class="lark-doc-comment-action is-filled"
        :disabled="!hasContent || !ed.commentDocumentCanSubmit()"
        @mousedown.prevent
        @click="submit"
      >
        发送
      </button>
    </div>
    <div
      v-if="optionsOpen"
      ref="options"
      class="lark-doc-comment-more-menu lark-doc-document-comment-options"
      :style="optionsStyle"
      role="dialog"
      aria-label="全文评论设置"
      tabindex="-1"
      @focusout="onOptionsFocusout"
      @mouseenter="cancelOptionsClose"
      @mouseleave="scheduleOptionsClose"
    >
      <div class="lark-doc-comment-more-row">
        <span
          class="lark-doc-comment-more-icon"
          aria-hidden="true"
        >
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            aria-hidden="true"
          ><path
            d="M15 15a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm-2 0a1 1 0 1 0-2 0 1 1 0 0 0 2 0Z"
            fill="currentColor"
          /><path
            d="M6.5 7.5V8H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2h-2.5v-.5a5.5 5.5 0 1 0-11 0Zm9 .5h-7v-.5a3.5 3.5 0 1 1 7 0V8ZM4 10h16v10H4V10Z"
            fill="currentColor"
          /></svg>
        </span>
        <span class="lark-doc-comment-more-title">私有评论</span>
        <button
          type="button"
          class="lark-doc-comment-switch"
          :class="{ 'is-on': privateDraft }"
          role="switch"
          aria-label="私有评论"
          :aria-checked="String(privateDraft)"
          :disabled="!ed.commentAllowed('create')"
          @mousedown.prevent
          @click="privateDraft = !privateDraft"
        >
          <span
            class="lark-doc-comment-switch-handler"
            aria-hidden="true"
          />
        </button>
      </div>
      <p class="lark-doc-comment-more-hint">
        开启后，仅提及的协作者、文档所有者、有文档管理权限的用户可见。
      </p>
    </div>
  </section>
</template>

<script>
import LarkDocIcon from './LarkDocIcon.vue'
import CommentTextInput from './CommentTextInput.vue'
import { commentPanelMethods } from './editor/commentPanelView'

export default {
  name: 'LarkDocDocumentCommentComposer',
  components: { LarkDocIcon, CommentTextInput },
  props: { ed: { type: Object, required: true } },
  data() { return { privateDraft: false, optionsOpen: false, optionsStyle: {}, multiline: false } },
  computed: {
    images() { return this.ed.commentDraftImages('document') },
    hasContent() { return Boolean(this.ed.commentDocumentDraft.trim() || this.images.length) },
  },
  watch: {
    'ed.commentDocumentDraft'() { this.resizeInput() },
    'ed.commentDocumentReplyTarget'() { this.applyReplyTarget() },
    'ed.commentIdentityGeneration': { sync: true, handler() { this.privateDraft = false; this.closeOptions(); this.resizeInput() } },
  },
  mounted() {
    this.resizeInput()
    this.applyReplyTarget()
    document.addEventListener('pointerdown', this.onOutside, true)
    document.addEventListener('scroll', this.onScroll, true)
    window.addEventListener('keydown', this.onOptionsKeydown, true)
    window.addEventListener('resize', this.resizeInput)
    if (typeof ResizeObserver !== 'undefined') {
      this._resizeObserver = new ResizeObserver(([entry]) => {
        if (this._inputWidth === entry.contentRect.width) return
        this._inputWidth = entry.contentRect.width; this.resizeInput()
      })
      this._resizeObserver.observe(this.$el)
    }
  },
  beforeDestroy() {
    this._resizeKey = (this._resizeKey || 0) + 1
    this.cancelOptionsClose()
    this._resizeObserver?.disconnect()
    document.removeEventListener('pointerdown', this.onOutside, true)
    document.removeEventListener('scroll', this.onScroll, true)
    window.removeEventListener('keydown', this.onOptionsKeydown, true)
    window.removeEventListener('resize', this.resizeInput)
  },
  methods: {
    focus() { this.$refs.input?.focus() },
    insertMention(target) { return this.$refs.input?.insertMention(target) || false },
    applyReplyTarget() {
      const target = this.ed.commentDocumentReplyTarget
      if (!target) return
      if (target.visibility === 'private') this.privateDraft = true
      this.$nextTick(() => {
        if (target === this.ed.commentDocumentReplyTarget && this.$refs.input?.insertMention(target)) this.ed.consumeDocumentCommentReplyTarget(target)
      })
    },
    uploadCommentImageFiles: commentPanelMethods.uploadCommentImageFiles,
    chooseImage() { if (this.ed.commentCanUploadImage('document')) this.$refs.file.click() },
    resizeInput() {
      const key = this._resizeKey = (this._resizeKey || 0) + 1
      this.multiline = false
      this.$nextTick(() => {
        const input = this.$refs.input?.getInputElement()
        if (key !== this._resizeKey || !input?.isConnected) return
        input.style.height = '22px'
        this.multiline = input.scrollHeight > 22
        this.$nextTick(() => {
          if (key !== this._resizeKey || !input.isConnected) return
          input.style.height = '22px'
          const max = Math.max(22, window.innerHeight * .4 - (this.multiline ? 48 : 18))
          input.style.height = `${Math.min(max, Math.max(22, input.scrollHeight))}px`
          if (this.optionsOpen) this.positionOptions()
        })
      })
    },
    onInputKeydown(event) {
      if (event.key !== 'Enter' || event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.shiftKey || event.ctrlKey || event.metaKey) return
      event.preventDefault()
      if (this.hasContent && this.ed.commentDocumentCanSubmit()) void this.submit()
    },
    cancel() {
      this.ed.cancelDocumentCommentDraft(); this.$refs.input?.clearQueryState(); this.privateDraft = false; this.closeOptions()
      this.$nextTick(() => this.$refs.input?.focus())
    },
    async submit() {
      const ed = this.ed, generation = ed.commentIdentityGeneration
      const result = await ed.submitDocumentComment(this.privateDraft ? 'private' : 'document')
      if (result && !this._isBeingDestroyed && ed === this.ed && generation === ed.commentIdentityGeneration) {
        this.privateDraft = false; this.closeOptions(); this.$nextTick(() => this.$refs.input?.focus())
      }
    },
    openOptions(focus = false) {
      this.cancelOptionsClose()
      if (!this.ed.commentAllowed('create')) return
      if (this.optionsOpen) { if (focus) this.$nextTick(() => this.$refs.options?.focus()); return }
      this.ed.closeCommentMenus()
      if (!this.positionOptions()) return
      this.optionsOpen = true; if (focus) this.$nextTick(() => this.$refs.options?.focus())
    },
    positionOptions() {
      const rect = this.$refs.more.getBoundingClientRect(), width = Math.min(278, window.innerWidth - 16), height = 92
      if (rect.bottom < 0 || rect.top > window.innerHeight) { this.closeOptions(); return false }
      const top = rect.bottom + 4 + height <= window.innerHeight - 8 ? rect.bottom + 4 : Math.max(8, rect.top - height - 4)
      this.optionsStyle = { position: 'fixed', left: `${Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))}px`, top: `${top}px`, width: `${width}px`, maxHeight: `${window.innerHeight - top - 8}px`, right: 'auto' }
      return true
    },
    cancelOptionsClose() { clearTimeout(this._optionsCloseTimer) },
    scheduleOptionsClose() { this.cancelOptionsClose(); this._optionsCloseTimer = setTimeout(() => this.closeOptions(), 500) },
    closeOptions(focus = false) { this.cancelOptionsClose(); this.optionsOpen = false; if (focus) this.$refs.more?.focus() },
    onOptionsKeydown(event) {
      if (!event.defaultPrevented && event.key === 'Escape' && this.optionsOpen) {
        event.preventDefault(); event.stopPropagation(); this.closeOptions(true)
      }
    },
    onOptionsFocusout(event) { if (!event.currentTarget.contains(event.relatedTarget) && event.relatedTarget !== this.$refs.more) this.closeOptions() },
    onOutside(event) { if (this.optionsOpen && !this.$refs.options?.contains(event.target) && !this.$refs.more?.contains(event.target)) this.closeOptions() },
    onScroll(event) { if (this.optionsOpen && !this.$refs.options?.contains(event.target)) this.positionOptions() },
  },
}
</script>

<style>
/* 全文评论的独立懒区块：40px空态，单行有字80px，换行后工具另起一行。 */
.lark-doc .lark-doc-comment-composer.lark-doc-document-composer { padding: 0; border: 0; border-radius: 0; background: transparent; z-index: auto; margin-top: 12px; }
.lark-doc .lark-doc-document-comment-input { box-sizing: border-box; display: grid; grid-template-columns: minmax(0, 1fr) 44px; column-gap: 11px; align-items: start; min-height: 40px; max-height: 40vh; padding: 8px 11px; overflow-y: auto; overscroll-behavior: contain; border: 1px solid var(--ld-comment-switch-off); border-radius: 6px; background: var(--ld-comment-surface); }
.lark-doc .lark-doc-document-comment-input:focus-within { border-color: var(--ld-brand-chrome); }
.lark-doc .lark-doc-comment-composer.lark-doc-document-composer .lark-doc-comment-input-zone { display: block; box-sizing: border-box; width: 100%; height: 22px; min-height: 22px; margin: 0; padding: 0; border: 0; border-radius: 0; background: transparent; font-size: 14px; line-height: 22px; outline: 0; }
.lark-doc .lark-doc-document-comment-tools { display: flex; align-items: center; justify-content: flex-end; gap: 6px; width: 44px; height: 20px; margin-top: 1px; }
.lark-doc .lark-doc-document-comment-tools .lark-doc-comment-operation { width: 20px; min-width: 20px; height: 20px; min-height: 20px; }
.lark-doc .lark-doc-document-comment-more { display: grid; place-items: center; width: 18px; height: 18px; min-height: 18px; padding: 0; border: 0; border-radius: 4px; background: transparent; color: var(--ld-comment-time); font-size: 14px; cursor: pointer; }
.lark-doc .lark-doc-document-comment-more:hover:not(:disabled) { background: var(--ld-bg-hover-menu); }
.lark-doc .lark-doc-document-comment-input.is-multiline { grid-template-columns: minmax(0, 1fr); row-gap: 9px; padding-bottom: 9px; }
.lark-doc .lark-doc-document-comment-input.is-multiline .lark-doc-document-comment-tools { justify-self: end; margin-top: 0; }
.lark-doc .lark-doc-comment-composer.lark-doc-document-composer .lark-doc-comment-compose-actions { margin-top: 12px; gap: 8px; }
.lark-doc .lark-doc-comment-composer.lark-doc-document-composer .lark-doc-comment-action { min-height: 28px; padding: 3px 7px; border-radius: 6px; font-size: 12px; line-height: 20px; }
.lark-doc .lark-doc-comment-composer.lark-doc-document-composer .lark-doc-comment-action.is-outlined { border-color: var(--ld-comment-switch-off); }
.lark-doc .lark-doc-comment-more-menu.lark-doc-document-comment-options { height: 92px; overflow-y: auto; }
.lark-doc .lark-doc-document-comment-options .lark-doc-comment-switch { min-height: 22px; }
.lark-doc .lark-doc-document-composer .lark-doc-comment-image-drafts button { min-height: 19px; }
.lark-doc .lark-doc-document-comment-options .lark-doc-comment-more-row { width: 100%; }
.lark-doc .lark-doc-document-comment-options .lark-doc-comment-more-title { flex: 1; }
.lark-doc .lark-doc-document-comment-options .lark-doc-comment-more-hint { width: 100%; height: 54px; line-height: 18px; }
</style>
