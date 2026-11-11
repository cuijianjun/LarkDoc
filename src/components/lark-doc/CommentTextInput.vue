<template>
  <div class="lark-doc-comment-rich-input">
    <div
      ref="host"
      class="lark-doc-comment-rich-host"
      :class="{ 'is-empty': empty }"
    />
    <div
      v-if="open"
      ref="menu"
      class="lark-doc-comment-mention-menu"
      :style="menuStyle"
      role="listbox"
      aria-label="提及用户或云文档"
      :aria-busy="String(loading)"
    >
      <p
        v-if="loading"
        role="status"
      >
        正在查询…
      </p>
      <button
        v-for="(person, index) in candidates"
        :key="person.kind + ':' + (person.principalId || person.docId)"
        type="button"
        role="option"
        :aria-selected="String(index === active)"
        :class="{ 'is-active': index === active }"
        @mousedown.prevent
        @mouseenter="active = index"
        @click="choose(index)"
      >
        <span
          class="lark-doc-comment-candidate-avatar"
          :class="{ 'is-document': person.kind === 'page' }"
          aria-hidden="true"
        ><svg
          v-if="person.kind === 'page'"
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
        ><path
          d="M3 1.5h5l3 3v8H3zM8 1.5v3h3M5 7h4M5 9h4"
          stroke="currentColor"
          stroke-linejoin="round"
        /></svg><template v-else>{{ person.displayName.slice(0, 1) }}</template></span>
        <span class="lark-doc-comment-candidate-name">{{ person.displayName }}</span>
      </button>
      <p
        v-if="!loading && !candidates.length"
        role="status"
      >
        {{ message || '未找到匹配结果' }}
      </p>
      <button
        v-if="directoryBlocked && !loading && !pendingOperation"
        type="button"
        @mousedown.prevent
        @click="searchDocumentsOnly"
      >
        仅搜索云文档
      </button>
      <button
        v-if="!loading && pendingOperation"
        type="button"
        @mousedown.prevent
        @click="lookup(true)"
      >
        核对原目录请求
      </button>
      <button
        v-else-if="!loading && message && !directoryBlocked"
        type="button"
        @mousedown.prevent
        @click="lookup(false)"
      >
        重新搜索
      </button>
    </div>
  </div>
</template>

<script>
import { Editor, Extension, Node, mergeAttributes } from '@tiptap/core'
import { history, undo, redo } from '@tiptap/pm/history'
import { EditorState } from '@tiptap/pm/state'
import { commentDraftDocument, serializeCommentDocument } from '../../core/comments/mentions'
import { openCommentDocumentTarget } from './editor/commentPanelView'

const Doc = Node.create({ name: 'doc', topNode: true, content: 'paragraph+' })
const Paragraph = Node.create({ name: 'paragraph', group: 'block', content: 'inline*', parseHTML: () => [{ tag: 'p' }], renderHTML: () => ['p', 0] })
const Text = Node.create({ name: 'text', group: 'inline' })
const HardBreak = Node.create({ name: 'hardBreak', inline: true, group: 'inline', selectable: false, parseHTML: () => [{ tag: 'br' }], renderHTML: () => ['br'] })
const History = Extension.create({ name: 'commentHistory', addProseMirrorPlugins: () => [history()], addKeyboardShortcuts() {
  return { 'Mod-z': () => undo(this.editor.state, this.editor.view.dispatch), 'Mod-Shift-z': () => redo(this.editor.state, this.editor.view.dispatch), 'Mod-y': () => redo(this.editor.state, this.editor.view.dispatch) }
} })
// Pasted HTML never creates mention identities. Only a revalidated directory candidate can insert this atom.
const Mention = Node.create({ name: 'commentMention', inline: true, group: 'inline', atom: true, selectable: false,
  addOptions: () => ({ getSelfPrincipal: () => '' }),
  addAttributes: () => ({ principalId: { default: '' }, text: { default: '' } }), parseHTML: () => [],
  renderHTML({ node }) { return ['span', mergeAttributes({ class: 'lark-doc-comment-mention-chip' + (node.attrs.principalId === this.options.getSelfPrincipal() ? ' is-self' : ''), 'data-comment-mention': node.attrs.principalId }), ['span', { class: 'lark-doc-comment-mention-label' }, node.attrs.text]] },
  renderText: ({ node }) => node.attrs.text })
const DocumentReference = Node.create({ name: 'commentDocumentReference', inline: true, group: 'inline', atom: true, selectable: false,
  addAttributes: () => ({ docId: { default: '' }, text: { default: '' }, readable: { default: true } }), parseHTML: () => [],
  renderHTML: ({ node }) => ['span', { class: 'lark-doc-comment-document-reference' + (node.attrs.readable === false ? ' is-disabled' : ''), 'data-comment-reference': node.attrs.docId },
    ['http://www.w3.org/2000/svg svg', { width: 14, height: 14, viewBox: '0 0 14 14', fill: 'none', 'aria-hidden': 'true' }, ['path', { d: 'M3 1.5h5l3 3v8H3zM8 1.5v3h3M5 7h4M5 9h4', stroke: 'currentColor', 'stroke-linejoin': 'round' }]],
    ['span', { class: 'lark-doc-comment-reference-label' }, node.attrs.text]], renderText: ({ node }) => node.attrs.text })

export default {
  name: 'LarkDocCommentTextInput',
  props: { ed: { type: Object, required: true }, value: { type: String, default: '' }, mentions: { type: Array, default: () => [] }, references: { type: Array, default: () => [] }, label: { type: String, default: '全文评论' }, readonly: Boolean, draftOwner: { type: Object, default: null } },
  data() { return { empty: true, open: false, candidates: [], active: 0, loading: false, message: '', pendingOperation: '', directoryBlocked: false, pageOnly: false, menuStyle: {} } },
  watch: {
    value() { this.syncDraft() }, mentions() { this.syncDraft() }, references() { this.syncDraft() },
    readonly(value) { this._inputEditor?.setEditable(!value); if (value) this.closeCandidates() },
    'ed.session': { sync: true, handler() { this.clearQueryState(); this.bindDirectorySession() } },
    'ed.commentIdentityGeneration': { sync: true, handler() { this.clearQueryState(); this.syncDraft() } },
  },
  mounted() {
    Object.defineProperty(this, '_draftOwner', { value: this.draftOwner, configurable: true })
    const editor = new Editor({ element: this.$refs.host, editable: !this.readonly, content: commentDraftDocument(this.value, this.mentions, this.references),
      extensions: [Doc, Paragraph, Text, HardBreak, Mention.configure({ getSelfPrincipal: () => this.ed.session?.user?.id || this.ed.commentAuthor?.id || '' }), DocumentReference, History],
      editorProps: { attributes: { role: 'textbox', 'aria-label': this.label, 'aria-multiline': 'true', 'data-comment-draft-editor': 'true' },
        handleKeyDown: (view, event) => this.onKeydown(event),
        handleClickOn: (view, pos, node) => { if (node.type.name !== 'commentDocumentReference') return false; if (this.scope().current()) void openCommentDocumentTarget(this.ed, node.attrs.docId); return true },
        handleDOMEvents: { compositionstart: () => { this._composing = true; this.closeCandidates(); return false }, compositionend: () => this.onCompositionEnd() } },
      onUpdate: () => this.publishDraft(), onSelectionUpdate: () => this.refreshQuery(), onFocus: () => { this._dismissedQuery = ''; this.refreshQuery() }, onBlur: () => { this.closeCandidates(); this.$emit('blur') } })
    // A standalone editor is private, nonreactive, and never attached to the body Session/Y.Doc.
    Object.defineProperty(this, '_inputEditor', { value: editor, writable: true, configurable: true })
    this.empty = editor.isEmpty
    this.bindDirectorySession()
    document.addEventListener('pointerdown', this.onOutside, true)
    window.addEventListener('resize', this.positionMenu); document.addEventListener('scroll', this.positionMenu, true)
  },
  beforeDestroy() {
    this._directoryStops?.forEach(stop => stop())
    this.clearQueryState(); this._inputEditor?.destroy(); this._inputEditor = null
    document.removeEventListener('pointerdown', this.onOutside, true)
    window.removeEventListener('resize', this.positionMenu); document.removeEventListener('scroll', this.positionMenu, true)
  },
  methods: {
    bindDirectorySession() {
      this._directoryStops?.forEach(stop => stop()); this._directoryStops = []
      const session = this.ed.session
      if (typeof session?.on !== 'function') return
      const invalidate = () => { if (session === this.ed.session) this.clearQueryState() }
      this._directoryStops = [session.on('capabilities', invalidate), session.on('comments-reset', invalidate),
        session.on('provider-changed', event => { if (event.name === 'authorization' || event.name === 'identity') invalidate() })].filter(stop => typeof stop === 'function')
    },
    getInputElement() { return this.$el },
    getText() { return this._inputEditor ? serializeCommentDocument(this._inputEditor.getJSON()).content : this.value },
    getCaret() { return this._inputEditor?.state.selection.from || 0 },
    focus() { this._inputEditor?.commands.focus() }, blur() { this._inputEditor?.view.dom.blur() },
    insertMention(target, range) {
      const editor = this._inputEditor, text = '@' + (target?.displayName || target?.principalId || '')
      if (!editor || editor.isDestroyed || this.readonly || !this.scope().current() || this.mentions.length + (this.references || []).length >= 100) return false
      // The caller supplies a current server reply author; final recipient/participant checks remain on BE.
      try { commentDraftDocument(text, [{ principalId: target.principalId, from: 0, to: text.length }]) } catch { return false }
      this.closeCandidates()
      const nodes = [{ type: 'commentMention', attrs: { principalId: target.principalId, text } }, { type: 'text', text: ' ' }]
      const chain = editor.chain().focus()
      return (range ? chain.insertContentAt(range, nodes) : chain.insertContent(nodes)).run()
    },
    insertDocumentReference(target, range) {
      const editor = this._inputEditor, text = target?.displayName
      if (!editor || editor.isDestroyed || this.readonly || !this.scope().current() || target?.kind !== 'page' || this.mentions.length + (this.references || []).length >= 100) return false
      try { commentDraftDocument(text, [], [{ docId: target.docId, from: 0, to: text.length }]) } catch { return false }
      this.closeCandidates()
      const nodes = [{ type: 'commentDocumentReference', attrs: { docId: target.docId, text, readable: true } }, { type: 'text', text: ' ' }], chain = editor.chain().focus()
      return (range ? chain.insertContentAt(range, nodes) : chain.insertContent(nodes)).run()
    },
    syncDraft() {
      this._publishGeneration = (this._publishGeneration || 0) + 1
      const editor = this._inputEditor
      if (!editor || editor.isDestroyed) return
      const current = serializeCommentDocument(editor.getJSON())
      if (current.content !== this.value || JSON.stringify(current.mentions) !== JSON.stringify(this.mentions) || JSON.stringify(current.references || []) !== JSON.stringify(this.references || [])) {
        editor.commands.setContent(commentDraftDocument(this.value, this.mentions, this.references), { emitUpdate: false }); this.resetInputHistory(); this.empty = editor.isEmpty; this.closeCandidates(); this.$emit('resize')
      }
    },
    resetInputHistory() {
      this._publishGeneration = (this._publishGeneration || 0) + 1
      const editor = this._inputEditor
      if (!editor || editor.isDestroyed || !editor.schema || !editor.view?.updateState) return
      // An external clear/identity reset must not make a cancelled private draft recoverable through Undo.
      editor.view.updateState(EditorState.create({ schema: editor.schema, doc: editor.state.doc, selection: editor.state.selection, plugins: editor.state.plugins }))
    },
    onCompositionEnd() {
      this._composing = false
      const editor = this._inputEditor, scope = this.scope(), generation = this._publishGeneration
      // 取消、换身份或外部同步后，旧 IME 微任务不能恢复上一份私密草稿。
      Promise.resolve().then(() => {
        if (editor === this._inputEditor && generation === this._publishGeneration && scope.current()) this.publishDraft()
      })
      return false
    },
    publishDraft() {
      const editor = this._inputEditor; if (!editor || editor.isDestroyed || this._composing || this.readonly || !this.scope().current()) return
      this.empty = editor.isEmpty
      const value = serializeCommentDocument(editor.getJSON())
      this.$emit('input', this._draftOwner ? { ...value, draftOwner: this._draftOwner } : value); this.$emit('resize'); this.refreshQuery()
    },
    scope() {
      const ed = this.ed, session = ed.session, provider = session?.getProvider?.('authorization'), identity = session?._privateIdentityGeneration,
        auth = session?._authorizationGeneration, principal = session?.user?.id, doc = session?.documentId, generation = ed.commentIdentityGeneration, draftOwner = this._draftOwner
      return { session, current: () => !this._isDestroyed && !this._isBeingDestroyed && ed === this.ed && session === ed.session &&
        provider === session?.getProvider?.('authorization') && principal === session?.user?.id && identity === session?._privateIdentityGeneration &&
        auth === session?._authorizationGeneration && doc === session?.documentId && generation === ed.commentIdentityGeneration && draftOwner === this.draftOwner && (!draftOwner || draftOwner === ed.commentEditingReply) && ed.commentCan('canView') && ed.commentCan('canComment') }
    },
    queryRange() {
      const editor = this._inputEditor, selection = editor?.state.selection
      if (!selection?.empty || !editor.isFocused || this.readonly || this._composing) return null
      const before = selection.$from.parent.textBetween(0, selection.$from.parentOffset, '', '\uFFFC'), match = /(?:^|[^A-Za-z0-9@])@([^\s@]{0,64})$/.exec(before)
      return match ? { from: selection.from - match[1].length - 1, to: selection.from, query: match[1] } : null
    },
    refreshQuery() {
      if (this._composing) return
      const range = this.queryRange(), signature = range && JSON.stringify([range, this.pageOnly])
      if (!range) { this.closeCandidates(); return }
      if (signature === this._dismissedQuery) return
      this._range = range; this.open = true; this.positionMenu()
      if (signature === this._querySignature) return
      this._querySignature = signature; this.candidates = []; this.message = ''; this.directoryBlocked = false; this.active = 0
      clearTimeout(this._searchTimer)
      if (!this.loading && !this.pendingOperation) this._searchTimer = setTimeout(() => this.lookup(false), 180)
      else if (this.pendingOperation) this.message = '目录结果尚未确认，请核对原请求。'
    },
    searchDocumentsOnly() {
      if (!this.directoryBlocked || this.loading || this.pendingOperation || !this.open || !this._range || !this.scope().current()) return false
      this.pageOnly = true; this.directoryBlocked = false; this.active = 0; this._querySignature = JSON.stringify([this._range, true]); this._resolution = null
      return this.lookup(false)
    },
    async lookup(querying) {
      if (this.loading || !this.open || !this._range) return
      const scope = this.scope(), signature = this._querySignature, pending = this.pendingOperation
      if (!scope.current() || !scope.session?.resolveMentions) { this.message = '当前服务未提供提及查询。'; return }
      if (pending && !querying) { this.message = '请先核对原目录请求。'; return }
      const request = {}; this._lookupRequest = request; this.loading = true; this.candidates = []; this.message = ''; this.directoryBlocked = false
      try {
        const result = querying ? await scope.session.queryMentionResolution(pending) : await scope.session.resolveMentions({ query: this._range.query, kinds: this.pageOnly ? ['page'] : ['user', 'page'] })
        if (!scope.current() || this._lookupRequest !== request) return
        const sameQuery = !querying || this._pendingSignature === signature
        this.pendingOperation = ''; this._pendingSignature = ''
        if (!this.open || signature !== this._querySignature) return
        if (!sameQuery) { this.message = '原请求已确认，请重新搜索当前内容。'; return }
        this._resolution = result
        this.candidates = result.status === 'resolved' ? result.candidates.filter(value => this.pageOnly ? value.kind === 'page' : ['user', 'page'].includes(value.kind)).slice(0, 20) : []
        this.directoryBlocked = result.status === 'blocked' && result.code === 'DEPENDENCY_BLOCKED' && result.dependency === 'internal-directory' && result.persisted === false && result.taskId === null && result.notified === false && result.shared === false
        this.message = this.directoryBlocked ? '人员目录未配置，仍可搜索云文档。' : result.status === 'resolved' ? (this.candidates.length ? '' : '未找到匹配结果') : '提及查询暂不可用。'
        this.positionMenu()
      } catch (error) {
        if (scope.current() && this._lookupRequest === request) {
          if (error.status === 'unknown' && error.operationId) { this.pendingOperation = error.operationId; this._pendingSignature = signature }
          else if (querying && error.status === 'rejected') { this.pendingOperation = ''; this._pendingSignature = '' }
          this.message = this.pendingOperation ? '目录结果尚未确认，请核对原请求。' : '查询失败，请重新搜索。'
        }
      } finally {
        if (this._lookupRequest === request) {
          this.loading = false
          if (scope.current() && this.open && signature !== this._querySignature && !this.pendingOperation) this._searchTimer = setTimeout(() => this.lookup(false), 180)
        }
      }
    },
    async choose(index) {
      const person = this.candidates[index], resolution = this._resolution, editor = this._inputEditor, range = this._range && { ...this._range }, scope = this.scope()
      if (!person || !resolution || resolution.status !== 'resolved' || !range || this.loading || !scope.current() || this.mentions.length + (this.references || []).length >= 100) return
      const doc = editor.state.doc, caret = editor.state.selection.from, signature = this._querySignature, menu = this._candidateGeneration, request = {}; this._lookupRequest = request; this.loading = true
      const current = () => scope.current() && this._lookupRequest === request && this.open && signature === this._querySignature && menu === this._candidateGeneration && editor === this._inputEditor &&
        !editor.isDestroyed && editor.state.doc === doc && editor.state.selection.from === caret && editor.isFocused
      try {
        const result = await scope.session.queryMentionResolution(resolution.operationId)
        if (!current()) return
        const target = result.status === 'resolved' && result.operationId === resolution.operationId && result.requestHash === resolution.requestHash &&
          result.docId === resolution.docId && result.tenantId === resolution.tenantId && result.sourceEpoch === resolution.sourceEpoch && result.sourceSeq === resolution.sourceSeq &&
          result.persisted === true && result.notified === false && result.shared === false && result.candidates.find(value => value.kind === person.kind && (value.kind === 'page' ? value.docId === person.docId : value.kind === 'user' && value.principalId === person.principalId))
        if (!target) { this.candidates = []; this.message = '候选已失效，请重新搜索。'; return }
        if (target.kind === 'page') this.insertDocumentReference(target, { from: range.from, to: range.to })
        else this.insertMention(target, { from: range.from, to: range.to })
      } catch (error) {
        if (scope.current() && this._lookupRequest === request) {
          if (error.status === 'unknown') { this.pendingOperation = resolution.operationId; this._pendingSignature = signature }
          this.message = this.pendingOperation ? '目标未确认，请核对原请求。' : '候选已失效，请重新搜索。'; this.candidates = []; this._resolution = null
        }
      } finally {
        if (this._lookupRequest === request) {
          this.loading = false
          if (scope.current() && this.open && signature !== this._querySignature && !this.pendingOperation) this._searchTimer = setTimeout(() => this.lookup(false), 180)
        }
      }
    },
    onKeydown(event) {
      if (this.readonly || !this.scope().current()) return false
      if (event.defaultPrevented) return true
      if (event.isComposing || event.keyCode === 229 || this._composing) return false
      if (event.key === 'Enter' && event.shiftKey) { this.closeCandidates(); event.preventDefault(); return this._inputEditor.commands.insertContent({ type: 'hardBreak' }) }
      if (this.open && ['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(event.key)) {
        event.preventDefault(); event.stopPropagation()
        if (event.key === 'Escape') { const range = this._range; this.closeCandidates(); this._dismissedQuery = JSON.stringify([range, false]) }
        else if (event.key === 'Enter') { if (!this.loading && this.candidates.length) void this.choose(this.active) }
        else if (this.candidates.length) { this.active = (this.active + (event.key === 'ArrowDown' ? 1 : -1) + this.candidates.length) % this.candidates.length; this.$nextTick(() => this.scrollActiveCandidate()) }
        return true
      }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.blur(); return true }
      if (event.key === 'Enter' && (event.shiftKey || event.ctrlKey || event.metaKey)) { event.preventDefault(); return this._inputEditor.commands.insertContent({ type: 'hardBreak' }) }
      this.$emit('keydown', event)
      return event.defaultPrevented
    },
    closeCandidates() { clearTimeout(this._searchTimer); this._candidateGeneration = (this._candidateGeneration || 0) + 1; this.open = false; this.candidates = []; this._range = null; this._querySignature = ''; this._resolution = null; this.directoryBlocked = false; this.pageOnly = false },
    clearQueryState() { this._lookupRequest = null; this.loading = false; this.pendingOperation = ''; this._pendingSignature = ''; this._dismissedQuery = ''; this.closeCandidates(); this.resetInputHistory() },
    onOutside(event) { if (this.open && !this.$el.contains(event.target)) this.closeCandidates() },
    scrollActiveCandidate() {
      const menu = this.$refs.menu, row = menu?.querySelector('[aria-selected="true"]')
      if (!row) return
      if (row.offsetTop < menu.scrollTop) menu.scrollTop = row.offsetTop
      else if (row.offsetTop + row.offsetHeight > menu.scrollTop + menu.clientHeight) menu.scrollTop = row.offsetTop + row.offsetHeight - menu.clientHeight
    },
    positionMenu() {
      if (!this.open || !this._inputEditor) return
      const rect = this._inputEditor.view.coordsAtPos(this._inputEditor.state.selection.from), width = Math.min(360, window.innerWidth - 16),
        generation = this._positionGeneration = (this._positionGeneration || 0) + 1,
        left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))
      if (rect.bottom < 0 || rect.top > window.innerHeight) { this.closeCandidates(); return }
      this.menuStyle = { left: `${left}px`, top: `${Math.min(rect.bottom + 4, window.innerHeight - 8)}px`, width: `${width}px`, maxHeight: `${Math.min(417, window.innerHeight - 16)}px` }
      this.$nextTick(() => {
        if (!this.open || generation !== this._positionGeneration || !this.$refs.menu) return
        const height = this.$refs.menu.getBoundingClientRect().height, below = window.innerHeight - rect.bottom - 12, above = rect.top - 12,
          flip = height > below && above > below, available = Math.max(0, flip ? above : below), maxHeight = Math.min(417, available),
          top = flip ? rect.top - Math.min(height, maxHeight) - 4 : rect.bottom + 4
        this.menuStyle = { ...this.menuStyle, top: `${Math.max(8, top)}px`, maxHeight: `${maxHeight}px` }
      })
    },
  },
}
</script>

<style>
.lark-doc .lark-doc-comment-rich-input { position: relative; height: auto; min-height: 22px; overflow-y: auto; overscroll-behavior: contain; }
.lark-doc .lark-doc-comment-rich-host { min-height: 22px; overflow: hidden; }
.lark-doc .lark-doc-comment-rich-host .ProseMirror { min-height: 22px; margin: 0; padding: 0; border: 0; outline: 0; font-size: 14px; line-height: 22px; white-space: pre-wrap; overflow-wrap: anywhere; }
.lark-doc .lark-doc-comment-rich-host .ProseMirror p { margin: 0; padding: 0; font-size: inherit; line-height: 22px; }
.lark-doc .lark-doc-comment-rich-host.is-empty .ProseMirror p:first-child::before { content: '输入评论'; position: absolute; color: var(--ld-comment-time); pointer-events: none; }
.lark-doc .lark-doc-comment-mention-chip { display: inline-block; max-width: 200px; padding: 0 2px; vertical-align: top; color: var(--ld-brand-chrome); }
.lark-doc .lark-doc-comment-rich-input .lark-doc-comment-mention-chip { max-width: 220px; }
.lark-doc .lark-doc-comment-mention-label { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; line-height: 20px; margin-top: 1px; }
.lark-doc .lark-doc-comment-mention-chip.is-self .lark-doc-comment-mention-label { padding: 0 4px; border-radius: 999px; background: var(--ld-brand-chrome); color: var(--ld-text-inverse); }
.lark-doc .lark-doc-comment-mention-menu { position: fixed; z-index: 1080; box-sizing: border-box; max-height: 417px; overflow-y: auto; padding: 8px 0; border: 1px solid var(--ld-comment-border); border-radius: 6px; background: var(--ld-comment-surface); color: var(--ld-comment-name); box-shadow: var(--ld-shadow-menu); font-size: 14px; }
.lark-doc .lark-doc-comment-mention-menu p { margin: 8px; }
.lark-doc .lark-doc-comment-mention-menu button { display: flex; align-items: center; gap: 8px; width: calc(100% - 16px); min-height: 48px; margin: 0 8px 2px; padding: 4px 8px; border: 0; border-radius: 4px; background: transparent; color: inherit; text-align: left; }
.lark-doc .lark-doc-comment-mention-menu button.is-active { background: var(--ld-bg-hover-menu); }
.lark-doc .lark-doc-comment-candidate-avatar { display: grid; flex: 0 0 32px; width: 32px; height: 32px; place-items: center; border-radius: 50%; background: var(--ld-brand-chrome); color: var(--ld-text-inverse); font-size: 14px; line-height: 14px; }
.lark-doc .lark-doc-comment-candidate-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; line-height: 22px; }
.lark-doc .lark-doc-comment-candidate-avatar.is-document { border-radius: 4px; background: var(--ld-bg-hover-menu); color: var(--ld-brand-chrome); }
.lark-doc .lark-doc-comment-document-reference { display: inline-flex; max-width: 100%; gap: 2px; vertical-align: top; color: var(--ld-brand-chrome); cursor: pointer; }
.lark-doc .lark-doc-comment-document-reference > svg { flex: 0 0 14px; margin-top: 4px; }
.lark-doc .lark-doc-comment-reference-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lark-doc .lark-doc-comment-document-reference.is-disabled { color: var(--ld-comment-time); }
</style>
