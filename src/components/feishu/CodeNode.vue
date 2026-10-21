<template>
  <node-view-wrapper
    class="feishu-code"
    :class="{ 'feishu-code-diagram': isDiagram }"
  >
    <!-- 图表块使用独立外观（白底卡片，无代码框 chrome），语言下拉仅在代码块显示。 -->
    <div
      class="feishu-code-toolbar"
      contenteditable="false"
      @mousedown.stop
    >
      <template v-if="isDiagram">
        <label>图表</label>
        <button
          type="button"
          @click="togglePreview"
        >
          {{ showPreview ? '编辑源码' : '预览图表' }}
        </button>
        <button
          type="button"
          @click="copyCode"
        >
          复制源码
        </button>
        <span role="status">{{ message }}</span>
      </template>
      <template v-else>
        <label>代码语言 <feishu-select
          aria-label="代码语言"
          :options="languageOptions"
          :value="node.attrs.language || 'plaintext'"
          :placeholder="node.attrs.language || '纯文本'"
          :disabled="!editable"
          @change="setLanguage"
        /></label>
        <button
          type="button"
          @click="copyCode"
        >
          复制代码
        </button>
        <span role="status">{{ message }}</span>
      </template>
    </div>
    <div
      v-show="!showPreview || diagramState === 'error'"
      class="feishu-code-body"
    >
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
    <!-- 图表预览层：schema 契约不变，源码仍是节点正文；渲染失败保留源码。 -->
    <div
      v-if="showPreview"
      class="feishu-diagram"
      contenteditable="false"
    >
      <div
        v-if="diagramState === 'loading'"
        class="feishu-diagram-status"
      >
        图表渲染中…
      </div>
      <div
        v-else-if="diagramState === 'error'"
        class="feishu-diagram-status feishu-diagram-error"
      >
        {{ diagramError || '图表渲染失败，请检查语法' }}
      </div>
      <!-- eslint-disable vue/no-v-html -->
      <div
        v-else
        class="feishu-diagram-svg"
        data-diagram-engine="mermaid-svg-text"
        v-html="diagramSvg"
      />
      <!-- eslint-enable vue/no-v-html -->
    </div>
  </node-view-wrapper>
</template>

<script>
import { NodeViewWrapper, NodeViewContent, nodeViewProps } from '@tiptap/vue-2'
import { isDiagramLanguage, renderDiagram } from './diagram'
import FeishuSelect from './FeishuSelect.vue'

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
  components: { NodeViewWrapper, NodeViewContent, FeishuSelect },
  props: nodeViewProps,
  data() {
    return {
      languages,
      message: '',
      editable: this.editor.isEditable,
      highlightedCode: '',
      diagramState: 'idle', // idle | loading | ok | error
      diagramSvg: '',
      diagramError: '',
      // 图表块（mermaid）直接渲染预览，与 Vditor 行为一致；「编辑源码」可切回编辑。
      previewShown: isDiagramLanguage(this.node?.attrs?.language) && this.extension?.options?.diagram !== false,
    }
  },
  computed: {
    highlighted() {
      if (this.highlightedCode) return this.highlightedCode
      return renderHighlighted(this.node?.textContent || '', this.node?.attrs?.language, this.extension?.options?.syntaxHighlight !== false)
    },
    diagramEnabled() {
      return this.extension?.options?.diagram !== false
    },
    isDiagram() {
      return this.diagramEnabled && isDiagramLanguage(this.node?.attrs?.language)
    },
    showPreview() {
      return this.isDiagram && this.previewShown
    },
    languageOptions() {
      // 图表功能开启时才把 mermaid 放进语言下拉，关闭后保持原有清单。
      if (!this.diagramEnabled) return this.languages
      return this.languages.concat([{ value: 'mermaid', label: 'Mermaid 图表' }])
    },
  },
  watch: {
    node: {
      deep: true,
      handler() { this.refreshHighlighted(); this.scheduleDiagramRender() },
    },
  },
  created() {
    this.editor.on('update', this.syncEditable)
    this.editor.on('transaction', this.syncEditable)
    this.refreshHighlighted()
    if (this.showPreview) this.scheduleDiagramRender()
  },
  beforeDestroy() {
    this.editor.off('update', this.syncEditable)
    this.editor.off('transaction', this.syncEditable)
    if (this.diagramTimer) clearTimeout(this.diagramTimer)
    this.diagramVersion = -1
  },
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
    syncEditable() {
      const next = this.editor.isEditable
      if (next === this.editable) return
      this.editable = next
      // 进入只读态时若无预览则渲染一份，回到编辑态时保留用户当前的切换选择。
      if (this.isDiagram && !this.previewShown && !next) this.previewShown = true
    },
    togglePreview() {
      this.previewShown = !this.previewShown
      if (this.previewShown) this.renderDiagramNow()
    },
    scheduleDiagramRender() {
      if (!this.showPreview) return
      if (this.diagramTimer) clearTimeout(this.diagramTimer)
      this.diagramTimer = setTimeout(() => { this.diagramTimer = null; this.renderDiagramNow() }, 300)
    },
    renderDiagramNow() {
      if (!this.isDiagram) return
      const version = (this.diagramVersion = (this.diagramVersion || 0) + 1)
      const source = this.node.textContent
      if (!source.trim()) {
        this.diagramState = 'error'
        this.diagramError = '暂无图表内容'
        return
      }
      this.diagramState = 'loading'
      renderDiagram(source, { scriptUrl: this.extension?.options?.diagramScriptUrl || undefined }).then((svg) => {
        if (version !== this.diagramVersion || this._isBeingDestroyed || this._isDestroyed) return
        this.diagramSvg = svg
        this.diagramState = 'ok'
        this.diagramError = ''
      }).catch((error) => {
        if (version !== this.diagramVersion || this._isBeingDestroyed || this._isDestroyed) return
        this.diagramState = 'error'
        this.diagramError = ''
        if (this.extension?.options?.onDiagramError) this.extension.options.onDiagramError(error)
      })
    },
    setLanguage(language) {
      // check 脚本会在脱离 Vue 上下文时调用这里，computed 可能不可用，回退到模块常量。
      const options = this.languageOptions || this.languages || languages
      if (!this.editor.isEditable || !options.some((item) => item.value === language)) return
      this.updateAttributes({ language })
      this.message = ''
      // 切成图表语言时立即给出预览；切走则丢弃渲染结果。
      if (isDiagramLanguage(language)) { this.previewShown = true; this.renderDiagramNow() }
      else { this.diagramState = 'idle'; this.diagramSvg = '' }
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
.feishu-document .feishu-diagram { border-top: 1px solid #dce5e1; background: #ffffff; padding: 16px; display: flex; justify-content: center; overflow: auto; }
.feishu-document .feishu-diagram-status { color: #66756e; font-size: 13px; padding: 8px; }
.feishu-document .feishu-diagram-error { color: #c0392b; }
.feishu-document .feishu-diagram-svg { max-width: 100%; }
.feishu-document .feishu-diagram-svg svg { max-width: 100%; height: auto; user-select: none; }
/* 图表标签为 SVG 原生 <text>（diagram.js 关闭 htmlLabels），不经过 foreignObject，
   天然不受宿主 CSS 继承影响；overflow 放开只为边标签的测量误差兜底。 */
.feishu-document .feishu-diagram-svg svg { overflow: visible; }
/* 图表块独立外观：白底卡片，去掉代码框的深色 chrome 与高亮配色。 */
.feishu-document .feishu-code-diagram { background: #ffffff; border-color: #e3ebe6; }
.feishu-document .feishu-code-diagram .feishu-code-toolbar { background: #f6faf7; color: #3f5149; }
.feishu-document .feishu-code-diagram .feishu-code-body { background: #fbfdfc; }
.feishu-document .feishu-code-diagram .feishu-code-body pre { color: #24352d; caret-color: #1f2d26; }
.feishu-document .feishu-code-diagram .feishu-code-highlight { color: #24352d; }
.feishu-document .feishu-code-diagram .feishu-code-highlight .hljs-keyword, .feishu-document .feishu-code-diagram .feishu-code-highlight .hljs-string, .feishu-document .feishu-code-diagram .feishu-code-highlight .hljs-attr, .feishu-document .feishu-code-diagram .feishu-code-highlight .hljs-number, .feishu-document .feishu-code-diagram .feishu-code-highlight .hljs-comment, .feishu-document .feishu-code-diagram .feishu-code-highlight .hljs-title, .feishu-document .feishu-code-diagram .feishu-code-highlight .hljs-built_in { color: inherit; }
.feishu-document .feishu-code-diagram .feishu-diagram { border-top: 1px solid #eef3f0; }
</style>
