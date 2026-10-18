<template>
  <node-view-wrapper class="feishu-code">
    <div
      class="feishu-code-toolbar"
      contenteditable="false"
      @mousedown.stop
    >
      <label>代码语言 <select
        aria-label="代码语言"
        :value="node.attrs.language || 'plaintext'"
        :disabled="!editable"
        @change="setLanguage($event.target.value)"
      >
        <option
          v-for="item in languages"
          :key="item.value"
          :value="item.value"
        >{{ item.label }}</option>
        <option
          v-if="!languages.some(item => item.value === node.attrs.language)"
          :value="node.attrs.language"
        >{{ node.attrs.language || '纯文本' }}</option>
      </select></label>
      <button
        type="button"
        @click="copyCode"
      >
        复制代码
      </button>
      <span role="status">{{ message }}</span>
    </div>
    <div class="feishu-code-body">
      <!-- 高亮层只接收 highlight.js 已转义的输出；正文始终由 Tiptap contentDOM 管理。 -->
      <!-- eslint-disable vue/no-v-html -->
      <pre
        class="feishu-code-highlight"
        aria-hidden="true"
        contenteditable="false"
      ><code v-html="highlighted" /></pre>
      <!-- eslint-enable vue/no-v-html -->
      <node-view-content
        as="pre"
        class="feishu-code-input"
        spellcheck="false"
      />
    </div>
  </node-view-wrapper>
</template>

<script>
import { NodeViewWrapper, NodeViewContent, nodeViewProps } from '@tiptap/vue-2'

// Code blocks are uncommon on the document's first paint. Keep both the
// highlighter core and grammars out of the route chunk until one is rendered.
let hljs = null
let highlighterPromise
function loadHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = Promise.all([
      import('highlight.js/lib/core.js'),
      import('highlight.js/lib/languages/javascript.js'),
    ]).then(([coreModule, javascriptModule]) => {
      hljs = coreModule.default || coreModule
      hljs.registerLanguage('javascript', javascriptModule.default || javascriptModule)
      return hljs
    }).catch(() => null)
  }
  return highlighterPromise
}

const languageLoaders = {
  typescript: () => import('highlight.js/lib/languages/typescript.js'),
  json: () => import('highlight.js/lib/languages/json.js'),
  css: () => import('highlight.js/lib/languages/css.js'),
  xml: () => import('highlight.js/lib/languages/xml.js'),
  python: () => import('highlight.js/lib/languages/python.js'),
  bash: () => import('highlight.js/lib/languages/bash.js'),
  sql: () => import('highlight.js/lib/languages/sql.js'),
}
const languagePromises = Object.create(null)
function ensureLanguage(name) {
  if (hljs?.getLanguage(name)) return Promise.resolve(true)
  if (!languageLoaders[name] && name !== 'javascript') return Promise.resolve(false)
  if (!languagePromises[name]) {
    languagePromises[name] = loadHighlighter().then((highlighter) => {
      if (!highlighter) return false
      if (highlighter.getLanguage(name)) return true
      return languageLoaders[name]().then((module) => {
        highlighter.registerLanguage(name, module.default || module)
        return true
      })
    }).catch(() => false)
  }
  return languagePromises[name]
}

const escapeHTML = (value) => String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
function renderHighlighted(text, language, syntaxHighlight = true) {
  if (!syntaxHighlight || !language || !hljs?.getLanguage(language)) return escapeHTML(text)
  return hljs.highlight(text, { language, ignoreIllegals: true }).value
}

const languages = [
  { value: 'plaintext', label: '纯文本' }, { value: 'javascript', label: 'JavaScript' },
  { value: 'typescript', label: 'TypeScript' }, { value: 'json', label: 'JSON' },
  { value: 'css', label: 'CSS' }, { value: 'xml', label: 'HTML/XML' },
  { value: 'python', label: 'Python' }, { value: 'bash', label: 'Shell' }, { value: 'sql', label: 'SQL' },
]

export default {
  name: 'FeishuCodeNode',
  components: { NodeViewWrapper, NodeViewContent },
  props: nodeViewProps,
  data() { return { languages, message: '', editable: this.editor.isEditable, highlightedCode: '' } },
  computed: {
    highlighted() {
      if (this.highlightedCode) return this.highlightedCode
      return renderHighlighted(this.node?.textContent || '', this.node?.attrs?.language, this.extension?.options?.syntaxHighlight !== false)
    },
  },
  watch: {
    node: {
      deep: true,
      handler() { this.refreshHighlighted() },
    },
  },
  created() { this.editor.on('update', this.syncEditable); this.editor.on('transaction', this.syncEditable); this.refreshHighlighted() },
  beforeDestroy() { this.editor.off('update', this.syncEditable); this.editor.off('transaction', this.syncEditable) },
  methods: {
    refreshHighlighted() {
      const text = this.node.textContent
      const language = this.node.attrs.language
      if (this.extension?.options?.syntaxHighlight === false) { this.highlightedCode = escapeHTML(text); return }
      if (language && !hljs?.getLanguage(language)) {
        this.highlightedCode = escapeHTML(text)
        ensureLanguage(language).then((loaded) => { if (loaded && !this._isBeingDestroyed && !this._isDestroyed) this.refreshHighlighted() })
        return
      }
      this.highlightedCode = renderHighlighted(text, language, true)
    },
    syncEditable() { this.editable = this.editor.isEditable },
    setLanguage(language) {
      if (!this.editor.isEditable || !languages.some((item) => item.value === language)) return
      this.updateAttributes({ language })
      this.message = ''
    },
    async copyCode() {
      try {
        if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(this.node.textContent)
        else {
          const input = document.createElement('textarea')
          const previous = document.activeElement
          input.value = this.node.textContent
          input.style.position = 'fixed'
          input.style.opacity = '0'
          document.body.appendChild(input)
          input.select()
          try { if (!document.execCommand('copy')) throw new Error('复制失败') }
          finally { input.remove(); previous?.focus() }
        }
        this.message = '已复制'
      } catch (_) { this.message = '无法访问剪贴板，请选择代码后手动复制' }
    },
  },
}
</script>

<style>
.feishu-document .feishu-code { border: 1px solid #dce5e1; border-radius: 8px; overflow: hidden; margin: 16px 0; max-width: 100%; background: #17251f; }
.feishu-document .feishu-code-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 8px 12px; font-size: 12px; color: #3f5149; background: #edf3ef; }
.feishu-document .feishu-code-toolbar select { max-width: 140px; }
.feishu-document .feishu-code-body { position: relative; overflow-x: auto; }
.feishu-document .feishu-code-body pre { margin: 0; padding: 16px; border: 0; border-radius: 0; background: transparent; font: 13px/1.6 ui-monospace, SFMono-Regular, Consolas, monospace; white-space: pre-wrap; overflow-wrap: anywhere; tab-size: 2; min-height: 52px; box-sizing: border-box; }
.feishu-document .feishu-code-body code { font: inherit; padding: 0; background: transparent; border: 0; border-radius: 0; }
.feishu-document .feishu-code-highlight { position: absolute; inset: 0; color: #e3eee7; pointer-events: none; }
.feishu-document .feishu-code-input { position: relative; color: transparent; caret-color: #ffffff; }
.feishu-document .feishu-code-input code { color: transparent; }
.feishu-document .feishu-code-input ::selection { background: #62897688; }
.feishu-document .feishu-code .hljs-keyword, .feishu-document .feishu-code .hljs-selector-tag { color: #c9a2ee; }
.feishu-document .feishu-code .hljs-string, .feishu-document .feishu-code .hljs-attr { color: #b5da91; }
.feishu-document .feishu-code .hljs-number, .feishu-document .feishu-code .hljs-literal { color: #ecb783; }
.feishu-document .feishu-code .hljs-comment { color: #8caa97; font-style: italic; }
.feishu-document .feishu-code .hljs-title, .feishu-document .feishu-code .hljs-built_in { color: #7ccce5; }
</style>
