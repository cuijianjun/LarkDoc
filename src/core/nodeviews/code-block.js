/**
 * 代码块 NodeView —— 纯 DOM 实现，core 零 UI 框架依赖（阶段 2 去框架化）。
 *
 * 由 Vue2 端 `adapters/vue2/CodeNode.vue` 全量平移，行为逐条对齐：
 *   - 结构：`.lark-doc-code > .lark-doc-code-toolbar + .lark-doc-code-body`
 *     （+ 预览态才挂载的 `.lark-doc-diagram`）；正文始终由 ProseMirror 管在
 *     `pre.lark-doc-code-input`（contentDOM）里，`.lark-doc-code-highlight`
 *     只是只读的高亮镜像，两者叠在一起做「透明输入 + 彩色显示」；
 *   - 语言下拉换成原生 `<select>`：core 不许引 `.vue`（闸门 R1），而
 *     `code-block.css` 早就有 `.lark-doc-code-toolbar select` 这条规则；
 *     图表分支**不渲染下拉**（verify-browser-mermaid 断言图表块 select 数为 0）；
 *   - 高亮器与语法包保持懒加载（chunk `highlight`），代码块不进首屏主包；
 *   - 图表渲染沿用 core/diagram.js 的 mermaid 渲染器：300ms 防抖 + 版本号
 *     丢弃过期结果；正文轨换档只对图表块重画（代码块颜色全在 CSS 里）。
 */
import { INDENT_STEP_PX, clampBlockIndent } from '../documentOperations'
import { isDiagramLanguage, renderDiagram } from '../diagram'
import { readContentTheme, subscribeContentTheme } from '../themeSignal'

/** 标记「属于 NodeView 自己的交互元素」：事件停在这里，不进 ProseMirror。 */
const UI_ATTR = 'data-lark-doc-code-ui'
/** 图表渲染防抖：源码连打时只渲染最后一帧。 */
const DIAGRAM_DEBOUNCE = 300

/* ---------- highlight.js 懒加载：代码块不在首屏，语法包不进主包 ---------- */
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
  if (hljs && hljs.getLanguage(name)) return Promise.resolve(true)
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

function escapeHTML(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
function renderHighlighted(text, language, syntaxHighlight = true) {
  if (!syntaxHighlight || !language || !hljs || !hljs.getLanguage(language)) return escapeHTML(text)
  return hljs.highlight(text, { language, ignoreIllegals: true }).value
}

/** 语言下拉清单；图表功能关闭时不给 mermaid 这一项。 */
export const CODE_BLOCK_LANGUAGES = Object.freeze([
  { value: 'plaintext', label: '纯文本' }, { value: 'javascript', label: 'JavaScript' },
  { value: 'typescript', label: 'TypeScript' }, { value: 'json', label: 'JSON' },
  { value: 'css', label: 'CSS' }, { value: 'xml', label: 'HTML/XML' },
  { value: 'python', label: 'Python' }, { value: 'bash', label: 'Shell' }, { value: 'sql', label: 'SQL' },
])
export function codeBlockLanguageOptions(diagramEnabled) {
  if (!diagramEnabled) return CODE_BLOCK_LANGUAGES.slice()
  return CODE_BLOCK_LANGUAGES.concat([{ value: 'mermaid', label: 'Mermaid 图表' }])
}

function el(tag, className, attrs = {}) {
  const element = document.createElement(tag)
  if (className) element.className = className
  Object.keys(attrs).forEach((key) => element.setAttribute(key, attrs[key]))
  return element
}

function markUi(element) {
  element.setAttribute(UI_ATTR, '')
  return element
}

export function createCodeBlockNodeView(props) {
  const { editor, node, view, getPos, extension } = props
  const options = (extension && extension.options) || {}
  let currentNode = node
  let editable = Boolean(editor && !editor.isDestroyed && editor.isEditable)
  let destroyed = false
  let message = ''
  let highlightedCode = ''
  let diagramState = 'idle' // idle | loading | ok | error
  let diagramSvg = ''
  let diagramError = ''
  let diagramVersion = 0
  let diagramTimer = null
  let unsubscribeTheme = null
  // 渲染用的正文轨主题：mermaid 的 SVG 是固化色，换档必须重渲染（12 T3-01）。
  let contentTheme = readContentTheme()
  // 图表块（mermaid）直接渲染预览，与 Vditor 行为一致；「编辑源码」可切回编辑。
  let previewShown = isDiagramLanguage(currentNode.attrs.language) && options.diagram !== false
  let toolbarMode = null // 'diagram' | 'code' —— 只有形态变了才重建工具条
  let previewMounted = false

  /* ---------- DOM 骨架 ---------- */
  const dom = el('div', 'lark-doc-code')
  const toolbar = markUi(el('div', 'lark-doc-code-toolbar', { contenteditable: 'false' }))
  // 工具条上的按下不冒泡给 ProseMirror（原 Vue 版 `@mousedown.stop` 的同义实现）。
  toolbar.addEventListener('mousedown', (event) => event.stopPropagation())

  const diagramLabel = el('label')
  diagramLabel.textContent = '图表'
  const languageLabel = el('label')
  languageLabel.appendChild(document.createTextNode('代码语言 '))
  const select = el('select', null, { 'aria-label': '代码语言' })
  codeBlockLanguageOptions(options.diagram !== false).forEach((item) => {
    const option = el('option', null, { value: item.value })
    option.textContent = item.label
    select.appendChild(option)
  })
  languageLabel.appendChild(select)
  const toggleButton = el('button', null, { type: 'button' })
  const copyButton = el('button', null, { type: 'button' })
  const statusNode = el('span', null, { role: 'status' })

  const body = el('div', 'lark-doc-code-body')
  // 高亮层只接收 highlight.js 已转义的输出；正文始终由 Tiptap 的 contentDOM 管理。
  const highlightPre = el('pre', 'lark-doc-code-highlight', { 'aria-hidden': 'true', contenteditable: 'false' })
  const highlightCode = el('code')
  highlightPre.appendChild(highlightCode)
  const contentDOM = el('pre', 'lark-doc-code-input', { spellcheck: 'false' })
  body.appendChild(highlightPre)
  body.appendChild(contentDOM)
  dom.appendChild(toolbar)
  dom.appendChild(body)

  const preview = el('div', 'lark-doc-diagram', { contenteditable: 'false' })

  /* ---------- 派生状态 ---------- */
  function diagramEnabled() { return options.diagram !== false }
  function syntaxHighlight() { return options.syntaxHighlight !== false }
  function isDiagram() { return diagramEnabled() && isDiagramLanguage(currentNode.attrs.language) }
  function showPreview() { return isDiagram() && previewShown }
  function blockIndent() { return clampBlockIndent(currentNode.attrs.indent) }

  /* ---------- 工具条 ---------- */
  function buildToolbar() {
    toolbar.textContent = ''
    if (toolbarMode === 'diagram') {
      toolbar.appendChild(diagramLabel)
      toolbar.appendChild(toggleButton)
    } else {
      toolbar.appendChild(languageLabel)
    }
    toolbar.appendChild(copyButton)
    toolbar.appendChild(statusNode)
  }

  /* ---------- 图表预览层 ---------- */
  function syncPreview() {
    const visible = showPreview()
    if (visible && !previewMounted) { dom.appendChild(preview); previewMounted = true }
    else if (!visible && previewMounted) { preview.remove(); previewMounted = false }
    if (!visible) return
    preview.textContent = ''
    if (diagramState === 'loading') {
      const status = el('div', 'lark-doc-diagram-status')
      status.textContent = '图表渲染中…'
      preview.appendChild(status)
      return
    }
    if (diagramState === 'error') {
      const status = el('div', 'lark-doc-diagram-status lark-doc-diagram-error')
      status.textContent = diagramError || '图表渲染失败，请检查语法'
      preview.appendChild(status)
      return
    }
    const holder = el('div', 'lark-doc-diagram-svg', { 'data-diagram-engine': 'mermaid-svg-text' })
    holder.innerHTML = diagramSvg
    preview.appendChild(holder)
  }

  /* ---------- 全量同步：把内部状态一次性刷到 DOM ---------- */
  function syncDom() {
    const language = currentNode.attrs.language || 'plaintext'
    const diagram = isDiagram()
    dom.className = diagram ? 'lark-doc-code lark-doc-code-diagram' : 'lark-doc-code'

    const blockId = currentNode.attrs.blockId
    if (blockId) dom.setAttribute('data-block-id', blockId)
    else dom.removeAttribute('data-block-id')
    const indent = blockIndent()
    if (indent) {
      dom.setAttribute('data-indent', String(indent))
      dom.style.marginLeft = `${indent * INDENT_STEP_PX}px`
    } else {
      dom.removeAttribute('data-indent')
      dom.style.marginLeft = ''
    }

    const nextMode = diagram ? 'diagram' : 'code'
    if (nextMode !== toolbarMode) { toolbarMode = nextMode; buildToolbar() }
    if (diagram) {
      toggleButton.textContent = showPreview() ? '编辑源码' : '预览图表'
      copyButton.textContent = '复制源码'
    } else {
      copyButton.textContent = '复制代码'
      // 语言不在清单里（历史数据）时回落到第一项，别让原生 select 变成空选。
      const hasOption = Array.prototype.some.call(select.options, (item) => item.value === language)
      select.value = hasOption ? language : select.options[0].value
      select.disabled = !editable
    }
    statusNode.textContent = message

    highlightCode.innerHTML = highlightedCode || renderHighlighted(
      currentNode.textContent || '', currentNode.attrs.language, syntaxHighlight()
    )
    // 源码区：图表预览成功时隐藏（原 Vue 版 `v-show="!showPreview || diagramState === 'error'"`）。
    body.style.display = showPreview() && diagramState !== 'error' ? 'none' : ''
    syncPreview()
  }

  /* ---------- 高亮 ---------- */
  function refreshHighlighted() {
    const text = currentNode.textContent
    const language = currentNode.attrs.language
    if (!syntaxHighlight()) { highlightedCode = escapeHTML(text); return }
    if (language && !(hljs && hljs.getLanguage(language))) {
      highlightedCode = escapeHTML(text)
      ensureLanguage(language).then((loaded) => {
        if (!loaded || destroyed) return
        refreshHighlighted()
        syncDom()
      })
      return
    }
    highlightedCode = renderHighlighted(text, language, true)
  }

  /* ---------- 图表 ---------- */
  function scheduleDiagramRender() {
    if (!showPreview()) return
    if (diagramTimer) clearTimeout(diagramTimer)
    diagramTimer = setTimeout(() => { diagramTimer = null; renderDiagramNow() }, DIAGRAM_DEBOUNCE)
  }
  function renderDiagramNow() {
    if (!isDiagram()) return
    const version = (diagramVersion += 1)
    const source = currentNode.textContent
    if (!source.trim()) {
      diagramState = 'error'
      diagramError = '暂无图表内容'
      syncDom()
      return
    }
    diagramState = 'loading'
    syncDom()
    renderDiagram(source, {
      scriptUrl: options.diagramScriptUrl || undefined,
      theme: contentTheme,
    }).then((svg) => {
      if (version !== diagramVersion || destroyed) return
      diagramSvg = svg
      diagramState = 'ok'
      diagramError = ''
      syncDom()
    }).catch((error) => {
      if (version !== diagramVersion || destroyed) return
      diagramState = 'error'
      diagramError = ''
      if (typeof options.onDiagramError === 'function') options.onDiagramError(error)
      syncDom()
    })
  }

  /**
   * 正文轨换档：只有图表块需要重画（代码块的颜色全在 CSS 里）。
   * 降级（图数 > 20，themeSignal 判定）时只让**新渲染**用新配色，已渲染的图不再重排。
   */
  function handleContentTheme({ theme, degraded }) {
    if (theme === contentTheme) return
    contentTheme = theme
    if (degraded || !showPreview()) return
    scheduleDiagramRender()
  }

  /* ---------- 写入文档（NodeView 没有 updateAttributes，自行 setNodeMarkup） ---------- */
  function updateAttributes(patch) {
    if (!editor || editor.isDestroyed || !editor.isEditable || !view) return false
    let pos
    try {
      pos = typeof getPos === 'function' ? getPos() : (getPos && typeof getPos.pos === 'number' ? getPos.pos : null)
    } catch (_) { return false }
    if (typeof pos !== 'number' || pos < 0) return false
    const { state } = view
    if (pos > state.doc.content.size) return false
    view.dispatch(state.tr.setNodeMarkup(pos, null, { ...currentNode.attrs, ...patch }))
    return true
  }

  /* ---------- 交互 ---------- */
  function setLanguage(language) {
    if (!editable) return false
    const allowed = codeBlockLanguageOptions(diagramEnabled())
    if (!allowed.some((item) => item.value === language)) return false
    if (!updateAttributes({ language })) return false
    message = ''
    // 切成图表语言立即给预览；切走则丢弃渲染结果。
    if (isDiagramLanguage(language)) { previewShown = true; renderDiagramNow() }
    else { diagramState = 'idle'; diagramSvg = ''; diagramError = '' }
    syncDom()
    return true
  }
  function togglePreview() {
    previewShown = !previewShown
    if (previewShown) renderDiagramNow()
    syncDom()
  }
  function copyCode() {
    const text = currentNode.textContent
    const fallback = () => {
      const input = document.createElement('textarea')
      const previous = document.activeElement
      input.value = text
      input.style.position = 'fixed'
      input.style.opacity = '0'
      document.body.appendChild(input)
      input.select()
      try { if (!document.execCommand('copy')) throw new Error('复制失败') }
      finally { input.remove(); if (previous && previous.focus) previous.focus() }
    }
    const done = navigator.clipboard && navigator.clipboard.writeText
      ? navigator.clipboard.writeText(text)
      : Promise.resolve().then(fallback)
    return done.then(() => { message = '已复制'; syncDom() })
      .catch(() => { message = '无法访问剪贴板，请选择代码后手动复制'; syncDom() })
  }

  select.addEventListener('change', () => setLanguage(select.value))
  toggleButton.addEventListener('click', togglePreview)
  copyButton.addEventListener('click', () => copyCode())

  /* ---------- 生命周期 ---------- */
  function syncEditable() {
    const next = Boolean(editor && !editor.isDestroyed && editor.isEditable)
    if (next === editable) return
    editable = next
    // 进入只读态时若无预览则渲染一份；回到编辑态保留用户当前的切换选择。
    if (isDiagram() && !previewShown && !next) previewShown = true
    syncDom()
  }
  if (editor && typeof editor.on === 'function') {
    editor.on('update', syncEditable)
    editor.on('transaction', syncEditable)
  }

  refreshHighlighted()
  syncDom()
  if (typeof subscribeContentTheme === 'function') unsubscribeTheme = subscribeContentTheme(handleContentTheme)
  if (showPreview()) scheduleDiagramRender()

  return {
    dom,
    contentDOM,
    update(newNode) {
      if (!newNode || !newNode.type || newNode.type.name !== currentNode.type.name) return false
      currentNode = newNode
      refreshHighlighted()
      scheduleDiagramRender()
      syncDom()
      return true
    },
    /** 工具条里的事件停在这里，不进 ProseMirror 的 keymap。 */
    stopEvent(event) {
      const target = event && event.target
      return Boolean(target && typeof target.closest === 'function' && target.closest(`[${UI_ATTR}]`))
    },
    /**
     * contentDOM 里的变化交给 ProseMirror；其余（工具条 / 高亮层 / 预览层）
     * 都是 NodeView 自绘，PM 一律不该管。
     */
    ignoreMutation(mutation) {
      if (!contentDOM) return true
      if (mutation.type === 'selection') return false
      if (contentDOM === mutation.target || contentDOM.contains(mutation.target)) {
        return mutation.type === 'attributes'
      }
      return true
    },
    destroy() {
      destroyed = true
      diagramVersion += 1
      if (diagramTimer) { clearTimeout(diagramTimer); diagramTimer = null }
      if (unsubscribeTheme) { unsubscribeTheme(); unsubscribeTheme = null }
      if (editor && typeof editor.off === 'function') {
        editor.off('update', syncEditable)
        editor.off('transaction', syncEditable)
      }
    },
    // 测试与宿主联调通道：等价于工具条各控件。
    setLanguage,
    togglePreview,
    copyCode,
    renderDiagramNow,
    /** 联调/测试通道：内部状态快照。 */
    getState() {
      return {
        editable, message, diagramState, diagramError, contentTheme, previewShown,
        isDiagram: isDiagram(), showPreview: showPreview(), indent: blockIndent(),
      }
    },
  }
}

export default createCodeBlockNodeView
