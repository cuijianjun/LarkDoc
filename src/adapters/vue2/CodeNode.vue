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
        <label>代码语言 <button
          type="button"
          class="lark-doc-code-lang-trigger"
          aria-label="代码语言"
          aria-haspopup="listbox"
          :disabled="!editable"
          @click="openLanguagePicker"
        >{{ languageLabel }}</button></label>
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
import { CODE_LANGUAGES, codeLanguageLabel } from '../../components/lark-doc/editor/codeLanguages'
import { requestCodeLangPicker } from '../../components/lark-doc/editor/codeLangSignal'

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

/**
 * 语言可选项（04 §2.2 ⑤ 的 71 项，**严格原序**）。
 *
 * ⚠️ `value` 是**内部 id**（`javascript`）不是显示名（`JavaScript`）：`renderHTML` 只放行
 * `/^[\w+-]{0,32}$/`，`C#` / `Plain Text` 这类会被兜成 `plaintext`，导出 Markdown 时也会
 * 写成非法 fence。显示名只在 UI 层出现 —— 详见 `editor/codeLanguages.js` 头部口径 ②。
 */
const languageOptions = CODE_LANGUAGES.map((item) => ({ value: item.id, label: item.label }))
/** 图表语言是**本库扩展**，不在飞书 71 项里，只在图表功能开启时追加到末尾。 */
const mermaidOption = { value: 'mermaid', label: 'Mermaid 图表' }

export default {
  name: 'LarkDocCodeNode',
  components: { NodeViewWrapper, NodeViewContent },
  props: nodeViewProps,
  data() {
    return {
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
      // 上一次见到的语言（`syncDiagramAfterLanguageChange` 靠它判断「是不是刚切成图表」）。
      // ⚠️ 别用 `_` 前缀：Vue 2 不代理 `_` / `$` 开头的 data key，`this._x` 恒为 undefined。
      lastLanguageSeen: this.node?.attrs?.language || '',
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
      // 图表功能开启时才把 mermaid 放进语言下拉，关闭后保持 71 项。
      if (!this.diagramEnabled) return languageOptions
      return languageOptions.concat([mermaidOption])
    },
    /** 头部按钮的文案：显示名（飞书口径），不是 id。 */
    languageLabel() {
      return codeLanguageLabel(this.node?.attrs?.language || 'plaintext')
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
      handler() { this.syncDiagramAfterLanguageChange(); this.refreshHighlighted(); this.scheduleDiagramRender() },
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

    /**
     * 语言被改成 mermaid（语言浮层里选「Mermaid 图表」）时**立刻给预览**。
     *
     * 为什么只看语言变化、不看 `isDiagram`：代码块是**已存在**的节点，`previewShown`
     * 只在 `data()` 里按初始语言算过一次；而「编辑源码」是用户主动切的状态，
     * 任何一次无关 transaction 都把它翻回预览会让人切不回源码。
     * 反面也一样：从 mermaid 切回普通语言要丢掉已渲染的图，否则旧 SVG 会赖在 DOM 里。
     */
    syncDiagramAfterLanguageChange() {
      const language = this.node?.attrs?.language || ''
      if (language === this.lastLanguageSeen) return
      const wasDiagram = isDiagramLanguage(this.lastLanguageSeen)
      const nextIsDiagram = isDiagramLanguage(language)
      this.lastLanguageSeen = language
      if (nextIsDiagram && !wasDiagram) this.previewShown = true
      if (!nextIsDiagram && wasDiagram) { this.diagramState = 'idle'; this.diagramSvg = ''; this.diagramError = '' }
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
        const onDiagramError = this.extension?.options?.onDiagramError
        if (onDiagramError) { onDiagramError(error); return }
        // 静默失败最难查：宿主没注册 onDiagramError 时至少留一条控制台线索
        // （用 warn 不用 error —— 这是内容渲染失败，不是宿主脚本异常）。
        if (typeof console !== 'undefined' && console.warn) console.warn('[lark-doc] 图表渲染失败：', error)
      })
    },
    setLanguage(language) {
      // check 脚本会在脱离 Vue 上下文时调用这里，computed 可能不可用，回退到模块常量。
      const options = this.languageOptions || languageOptions
      if (!this.editor.isEditable || !options.some((item) => item.value === language)) return
      this.updateAttributes({ language })
      this.message = ''
      // 切成图表语言时立即给出预览；切走则丢弃渲染结果。
      if (isDiagramLanguage(language)) { this.previewShown = true; this.renderDiagramNow() }
      else { this.diagramState = 'idle'; this.diagramSvg = '' }
    },
    /**
     * 打开语言选择器。
     *
     * 走模块信号而不是 props：NodeView 拿不到 LarkDocEditor 实例，而浮层要挂在
     * `LarkDocOverlays.vue`（`editor/codeLangSignal.js` 头部写了这条连线的取舍）。
     * 载荷带 `editor` + `pos` + 锚点 rect —— 宿主持 `pos` 直接改 attrs，
     * 避免 NodeView 与浮层之间再传一份节点引用（期间节点可能已被替换）。
     */
    openLanguagePicker(event) {
      const el = event && event.currentTarget
      if (!el || !el.getBoundingClientRect || !this.editor.isEditable) return
      requestCodeLangPicker({
        editor: this.editor,
        pos: typeof this.getPos === 'function' ? this.getPos() : null,
        language: this.node?.attrs?.language || 'plaintext',
        // 图表关掉时下拉不该出现「Mermaid 图表」（`docs/blocks/code-block.md`）。
        diagramEnabled: this.diagramEnabled,
        rect: el.getBoundingClientRect(),
      })
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
/* 代码块 / 图表块的颜色全部走 --ld-code-* / --ld-diagram-* token（T3-02）：
   - 代码块是「常暗卡片」：语法配色按 M6（06 §6.5.2 实测 token 色两档不变）写死，
     换主题只动卡片 chrome 与卡底；
   - 图表块是「纸张上的白卡」：跟着正文纸张走；
   - 深色值统一写在 theme-dark.css 的 content 轨，本文件不再出现 [data-content-theme]。 */
.lark-doc .lark-doc-code { border: 1px solid var(--ld-code-border); border-radius: 8px; overflow: hidden; margin: 16px 0; max-width: 100%; background: var(--ld-code-bg); }
.lark-doc .lark-doc-code-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 8px 12px; font-size: 12px; color: var(--ld-code-toolbar-text); background: var(--ld-code-toolbar-bg); }
.lark-doc .lark-doc-code-toolbar select { max-width: 140px; }
.lark-doc .lark-doc-code-body { position: relative; overflow-x: auto; }
.lark-doc .lark-doc-code-body pre { margin: 0; padding: 16px; border: 0; border-radius: 0; background: transparent; font: 13px/1.6 ui-monospace, SFMono-Regular, Consolas, monospace; white-space: pre-wrap; overflow-wrap: anywhere; tab-size: 2; min-height: 52px; box-sizing: border-box; }
.lark-doc .lark-doc-code-body code { font: inherit; padding: 0; background: transparent; border: 0; border-radius: 0; }
.lark-doc .lark-doc-code-highlight { position: absolute; inset: 0; color: var(--ld-code-text); pointer-events: none; }
.lark-doc .lark-doc-code-input { position: relative; color: transparent; caret-color: var(--ld-code-caret); }
.lark-doc .lark-doc-code-input code { color: transparent; }
.lark-doc .lark-doc-code-input ::selection { background: var(--ld-code-selection); }
/* 语法配色：06 §6.5.2 实测「token 色不随主题变」，刻意写死，不落 token。 */
.lark-doc .lark-doc-code .hljs-keyword, .lark-doc .lark-doc-code .hljs-selector-tag { color: #c9a2ee; }
.lark-doc .lark-doc-code .hljs-string, .lark-doc .lark-doc-code .hljs-attr { color: #b5da91; }
.lark-doc .lark-doc-code .hljs-number, .lark-doc .lark-doc-code .hljs-literal { color: #ecb783; }
.lark-doc .lark-doc-code .hljs-comment { color: #8caa97; font-style: italic; }
.lark-doc .lark-doc-code .hljs-title, .lark-doc .lark-doc-code .hljs-built_in { color: #7ccce5; }
.lark-doc .lark-doc-diagram { border-top: 1px solid var(--ld-diagram-preview-border); background: var(--ld-diagram-preview-bg); padding: 16px; display: flex; justify-content: center; overflow: auto; }
.lark-doc .lark-doc-diagram-status { color: var(--ld-diagram-status-text); font-size: 13px; padding: 8px; }
.lark-doc .lark-doc-diagram-error { color: var(--ld-diagram-error); }
.lark-doc .lark-doc-diagram-svg { max-width: 100%; }
.lark-doc .lark-doc-diagram-svg svg { max-width: 100%; height: auto; user-select: none; }
/* 图表标签为 SVG 原生 <text>（diagram.js 关闭 htmlLabels），不经过 foreignObject，
   天然不受宿主 CSS 继承影响；overflow 放开只为边标签的测量误差兜底。 */
.lark-doc .lark-doc-diagram-svg svg { overflow: visible; }
/* 图表块独立外观：白底卡片，去掉代码框的深色 chrome 与高亮配色。 */
.lark-doc .lark-doc-code-diagram { background: var(--ld-diagram-card-bg); border-color: var(--ld-diagram-border); }
.lark-doc .lark-doc-code-diagram .lark-doc-code-toolbar { background: var(--ld-diagram-toolbar-bg); color: var(--ld-diagram-toolbar-text); }
.lark-doc .lark-doc-code-diagram .lark-doc-code-body { background: var(--ld-diagram-source-bg); }
.lark-doc .lark-doc-code-diagram .lark-doc-code-body pre { color: var(--ld-diagram-source-text); caret-color: var(--ld-diagram-source-caret); }
.lark-doc .lark-doc-code-diagram .lark-doc-code-highlight { color: var(--ld-diagram-source-text); }
.lark-doc .lark-doc-code-diagram .lark-doc-code-highlight .hljs-keyword, .lark-doc .lark-doc-code-diagram .lark-doc-code-highlight .hljs-string, .lark-doc .lark-doc-code-diagram .lark-doc-code-highlight .hljs-attr, .lark-doc .lark-doc-code-diagram .lark-doc-code-highlight .hljs-number, .lark-doc .lark-doc-code-diagram .lark-doc-code-highlight .hljs-comment, .lark-doc .lark-doc-code-diagram .lark-doc-code-highlight .hljs-title, .lark-doc .lark-doc-code-diagram .lark-doc-code-highlight .hljs-built_in { color: inherit; }
</style>
