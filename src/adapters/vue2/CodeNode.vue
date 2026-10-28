<template>
  <node-view-wrapper
    class="lark-doc-code"
    :class="{ 'lark-doc-code-diagram': isDiagram }"
    :data-block-id="node.attrs.blockId || null"
    :data-indent="blockIndent || null"
    :style="indentStyle"
  >
    <!-- 图表块使用独立外观（白底卡片，无代码框 chrome），语言下拉仅在代码块显示。 -->
    <div
      class="lark-doc-code-toolbar"
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
        <label>代码语言 <lark-doc-select
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
      class="lark-doc-code-body"
    >
      <!-- 高亮层只接收 highlight.js 已转义的输出；正文始终由 Tiptap contentDOM 管理。 -->
      <!-- eslint-disable vue/no-v-html -->
      <pre
        class="lark-doc-code-highlight"
        aria-hidden="true"
        contenteditable="false"
      ><code v-html="highlighted" /></pre>
      <!-- eslint-enable vue/no-v-html -->
      <node-view-content
        as="pre"
        class="lark-doc-code-input"
        spellcheck="false"
      />
    </div>
    <!-- 图表预览层：schema 契约不变，源码仍是节点正文；渲染失败保留源码。 -->
    <div
      v-if="showPreview"
      class="lark-doc-diagram"
      contenteditable="false"
    >
      <div
        v-if="diagramState === 'loading'"
        class="lark-doc-diagram-status"
      >
        图表渲染中…
      </div>
      <div
        v-else-if="diagramState === 'error'"
        class="lark-doc-diagram-status lark-doc-diagram-error"
      >
        {{ diagramError || '图表渲染失败，请检查语法' }}
      </div>
      <!-- eslint-disable vue/no-v-html -->
      <div
        v-else
        class="lark-doc-diagram-svg"
        data-diagram-engine="mermaid-svg-text"
        v-html="diagramSvg"
      />
      <!-- eslint-enable vue/no-v-html -->
    </div>
  </node-view-wrapper>
</template>

<script>
import { NodeViewWrapper, NodeViewContent, nodeViewProps } from '@tiptap/vue-2'
import { isDiagramLanguage, renderDiagram } from '../../components/lark-doc/diagram'
import { readContentTheme, subscribeContentTheme } from '../../components/lark-doc/themeSignal'
import { INDENT_STEP_PX, clampBlockIndent } from '../../components/lark-doc/documentOperations'
import LarkDocSelect from '../../components/lark-doc/LarkDocSelect.vue'

// Code blocks are uncommon on the document's first paint. Keep both the
// highlighter core and grammars out of the route chunk until one is rendered.
let hljs = null
let highlighterPromise
function loadHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = Promise.all([
      import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/core.js'),
      import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/javascript.js'),
    ]).then(([coreModule, javascriptModule]) => {
      hljs = coreModule.default || coreModule
      hljs.registerLanguage('javascript', javascriptModule.default || javascriptModule)
      return hljs
    }).catch(() => null)
  }
  return highlighterPromise
}

const languageLoaders = {
  typescript: () => import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/typescript.js'),
  json: () => import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/json.js'),
  css: () => import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/css.js'),
  xml: () => import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/xml.js'),
  python: () => import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/python.js'),
  bash: () => import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/bash.js'),
  sql: () => import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/sql.js'),
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
  name: 'LarkDocCodeNode',
  components: { NodeViewWrapper, NodeViewContent, LarkDocSelect },
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
      // 渲染用的正文轨主题：mermaid 的 SVG 是固化色，换档必须重渲染（12 T3-01）。
      contentTheme: readContentTheme(),
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
    // 块级缩进缩的是整个代码框（飞书行为），所以用 margin 而不是内边距。
    blockIndent() {
      // 代码块的缩进上限与文本块共用同一个钳制入口，超出上限的历史数据也不会溢出内容列。
      return clampBlockIndent(this.node?.attrs?.indent)
    },
    indentStyle() {
      return this.blockIndent ? { marginLeft: `${this.blockIndent * INDENT_STEP_PX}px` } : null
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
    // 主题广播全库只挂一个观察器（themeSignal），这里只订阅「本块要不要重画」。
    this.unsubscribeTheme = subscribeContentTheme(this.handleContentTheme)
    if (this.showPreview) this.scheduleDiagramRender()
  },
  beforeDestroy() {
    this.editor.off('update', this.syncEditable)
    this.editor.off('transaction', this.syncEditable)
    if (this.unsubscribeTheme) { this.unsubscribeTheme(); this.unsubscribeTheme = null }
    if (this.diagramTimer) clearTimeout(this.diagramTimer)
    this.diagramVersion = -1
  },
  methods: {
    /**
     * 正文轨换档：只有图表块需要重画（代码块的颜色全在 CSS 里）。
     * 降级（图数 > 20，themeSignal 判定）：只让**新渲染**用新配色，
     * 已渲染的图不再重排 —— 一次切换几十个 mermaid 会明显卡顿。
     */
    handleContentTheme({ theme, degraded }) {
      if (theme === this.contentTheme) return
      this.contentTheme = theme
      if (degraded || !this.showPreview) return
      this.scheduleDiagramRender()
    },

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
      renderDiagram(source, {
        scriptUrl: this.extension?.options?.diagramScriptUrl || undefined,
        theme: this.contentTheme,
      }).then((svg) => {
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
