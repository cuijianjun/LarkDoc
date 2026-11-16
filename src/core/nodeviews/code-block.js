/**
 * 代码块 NodeView —— 纯 DOM 实现，core 零 UI 框架依赖（阶段 2 去框架化）。
 *
 * 由 Vue2 端 `adapters/vue2/CodeNode.vue` 全量平移，行为逐条对齐：
 *   - 结构：`.lark-doc-code > .lark-doc-code-toolbar + .lark-doc-code-body`
 *     （+ 预览态才挂载的 `.lark-doc-diagram`）；正文始终由 ProseMirror 管在
 *     `pre.lark-doc-code-input`（contentDOM）里，`.lark-doc-code-highlight`
 *     只是只读的高亮镜像，两者叠在一起做「透明输入 + 彩色显示」；
 *   - 语言使用可搜索的纯 DOM 菜单；标题、换行偏好随节点属性保存。
 *     图表分支保留独立源码 / 预览工具条；
 *   - 高亮器与语法包保持懒加载（chunk `highlight`），代码块不进首屏主包；
 *   - 图表渲染沿用 core/diagram.js 的 mermaid 渲染器：仅「逐字编辑」走 300ms
 *     防抖 + 版本号丢弃过期结果；首次挂载、整篇替换（setContent / 粘贴 / 切换
 *     笔记）与换档这类离散动作立即渲染，避免打开文档先空等 300ms；
 *     正文轨换档只对图表块重画（代码块颜色全在 CSS 里）。
 */
import { INDENT_STEP_PX, clampBlockIndent } from '../documentOperations'
import { isDiagramLanguage, renderDiagram } from '../diagram'
import { readContentTheme, subscribeContentTheme } from '../themeSignal'
import { loadFeature } from '../features/registry'
import { CODE_BLOCK_LANGUAGES, normalizeCodeLanguage } from './code-languages'

export { CODE_BLOCK_LANGUAGES, codeBlockLanguageOptions, filterCodeBlockLanguages, normalizeCodeLanguage } from './code-languages'

/** 标记「属于 NodeView 自己的交互元素」：事件停在这里，不进 ProseMirror。 */
const UI_ATTR = 'data-lark-doc-code-ui'
/** 图表渲染防抖：源码连打时只渲染最后一帧。 */
const DIAGRAM_DEBOUNCE = 300

/* ---------- highlight.js 懒加载：代码块不在首屏，语法包不进主包 ---------- */
/* 阶段 4：接入特性注册表 —— 宿主加载 lark-doc/features/highlight.js（注册好
   全部语言的 hljs 实例）时优先用注册实例；否则走内置通道（core + javascript，
   其余语言再按需补）。 */
let hljs = null
let highlighterPromise
function loadHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = loadFeature('highlight', () =>
      Promise.all([
        import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/core.js'),
        import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/javascript.js'),
      ]).then(([coreModule, javascriptModule]) => {
        const core = coreModule.default || coreModule
        core.registerLanguage('javascript', javascriptModule.default || javascriptModule)
        return core
      }),
    ).then((highlighter) => {
      hljs = highlighter
      return highlighter
    }).catch(() => {
      // 分块没取到（离线包漏拷 chunk、CDN 404）时**不要把失败结果缓存一辈子**：
      // 下次渲染重新试一次，宿主补上文件后无需刷新页面就能恢复高亮。
      highlighterPromise = null
      return null
    })
  }
  return highlighterPromise
}

const languagePromises = Object.create(null)
function ensureLanguage(name) {
  const language = normalizeCodeLanguage(name)
  if (hljs && hljs.getLanguage(language)) return Promise.resolve(true)
  if (!CODE_BLOCK_LANGUAGES.some(item => normalizeCodeLanguage(item.value) === language)) return Promise.resolve(false)
  if (!languagePromises[language]) {
    languagePromises[language] = loadHighlighter().then((highlighter) => {
      if (!highlighter) return false
      if (highlighter.getLanguage(language)) return true
      return import('./code-language-loaders').then(({ languageLoaders }) => {
        if (!languageLoaders[language]) return false
        return languageLoaders[language]().then((module) => {
          highlighter.registerLanguage(language, module.default || module)
          return true
        })
      })
    }).catch(() => false).then((loaded) => {
      // 失败只降级本次渲染；下次正文更新仍可加载同一语言。
      if (!loaded) delete languagePromises[language]
      return loaded
    })
  }
  return languagePromises[language]
}

function escapeHTML(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
// hljs 10.7.3 把 const / var / function / let / return 全标成 .hljs-keyword，
// 纯 CSS 无法区分。这里给飞书视觉口径里颜色不同的三个关键字补细分 class，
// 只在 keyword 的 span 内改写，不动其它 token、不动源码文本。
const KEYWORD_CLASS = [
  ['const', 'hljs-kw-const'],
  ['var', 'hljs-kw-var'],
  ['function', 'hljs-kw-function'],
]
function subdivideKeywords(html) {
  return html.replace(/<span class="hljs-keyword">([a-zA-Z]+)<\/span>/g, (match, word) => {
    const hit = KEYWORD_CLASS.find(([name]) => name === word)
    return hit ? `<span class="hljs-keyword ${hit[1]}">${word}</span>` : match
  })
}

function renderHighlighted(text, language, syntaxHighlight = true) {
  const normalized = normalizeCodeLanguage(language)
  if (!syntaxHighlight || normalized === 'plaintext' || !hljs || !hljs.getLanguage(normalized)) return escapeHTML(text)
  return subdivideKeywords(hljs.highlight(text, { language: normalized, ignoreIllegals: true }).value)
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

const CODE_ICONS = {
  caret: [14, 'M7 9.204l4.744-4.744a.292.292 0 01.412 0l.413.413a.292.292 0 010 .412l-5.156 5.156a.583.583 0 01-.825 0L1.432 5.285a.292.292 0 010-.412l.412-.413a.292.292 0 01.413 0L7 9.204z'],
  wrap: [22, 'M4.583 4.95c0-.202.165-.367.367-.367h.642c.202 0 .367.165.367.367v12.1a.367.367 0 01-.367.367H4.95a.367.367 0 01-.367-.367V4.95zM16.409 4.583a.367.367 0 00-.367.367v12.1c0 .203.164.367.366.367h.642a.367.367 0 00.367-.367V4.95a.367.367 0 00-.367-.367h-.642zM7.61 11.516c.902 0 1.856-.001 3.197-.007v1.444c0 .427.492.667.829.405l2.775-2.159a.513.513 0 000-.81l-2.775-2.16a.513.513 0 00-.829.406v1.497H7.61a.412.412 0 00-.412.412v.56c0 .227.184.412.412.412z'],
  copy: [22, 'M6.188 8.25v8.25h6.875V8.25H6.186zm8.25-.688v9.702c0 .337-.288.611-.642.611H5.454c-.354 0-.641-.274-.641-.611V7.486c0-.337.287-.611.641-.611h8.296c.38 0 .688.308.688.688zm2.548-3.236a.685.685 0 01.201.487v8.593c0 .19-.153.344-.343.344h-.688a.344.344 0 01-.343-.344V5.5H9.28a.344.344 0 01-.344-.344V4.47c0-.19.154-.344.344-.344H16.5c.19 0 .362.077.486.201z'],
  fold: [12, 'M1.5 3.5h9L6 8.5z'],
}

function codeIcon(name) {
  const [size, data] = CODE_ICONS[name]
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`)
  svg.setAttribute('width', String(size))
  svg.setAttribute('height', String(size))
  svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', data)
  path.setAttribute('fill', 'currentColor')
  svg.appendChild(path)
  return svg
}

export function createCodeBlockNodeView(props) {
  const { editor, node, view, getPos, extension } = props
  const options = (extension && extension.options) || {}
  let currentNode = node
  let editable = Boolean(editor && !editor.isDestroyed && editor.isEditable)
  let captionEditable = editable && !editor.storage?.larkDocRevisionTracker?.active
  let destroyed = false
  let highlightedCode = ''
  let diagramState = 'idle' // idle | loading | ok | error
  let diagramSvg = ''
  let diagramError = ''
  let diagramVersion = 0
  let diagramTimer = null
  // 上一次「发起渲染」的源码：内容未变时不再重复渲染（无关事务/重复 update）。
  let lastRenderedSource = null
  // 上一次进入调度时的源码：用来区分逐字输入与整篇替换。
  let lastScheduledSource = null
  let unsubscribeTheme = null
  // 渲染用的正文轨主题：mermaid 的 SVG 是固化色，换档必须重渲染（12 T3-01）。
  let contentTheme = readContentTheme()
  // 图表块（mermaid）直接渲染预览，与 Vditor 行为一致；「编辑源码」可切回编辑。
  let previewShown = isDiagramLanguage(currentNode.attrs.language) && options.diagram !== false
  let toolbarMode = null // 'diagram' | 'code' —— 只有形态变了才重建工具条
  let previewMounted = false
  let collapsed = false
  let lineFrame = null

  /* ---------- DOM 骨架 ---------- */
  const dom = el('div', 'lark-doc-code')
  const ownerWindow = dom.ownerDocument.defaultView
  const requestFrame = ownerWindow.requestAnimationFrame
    ? callback => ownerWindow.requestAnimationFrame(callback)
    : callback => ownerWindow.setTimeout(callback, 16)
  const cancelFrame = ownerWindow.cancelAnimationFrame
    ? id => ownerWindow.cancelAnimationFrame(id)
    : id => ownerWindow.clearTimeout(id)
  const toolbar = markUi(el('div', 'lark-doc-code-toolbar', { contenteditable: 'false' }))
  // 工具条上的按下不冒泡给 ProseMirror（原 Vue 版 `@mousedown.stop` 的同义实现）。
  toolbar.addEventListener('mousedown', (event) => event.stopPropagation())

  const diagramLabel = el('label')
  diagramLabel.textContent = '图表'
  const caption = el('input', 'lark-doc-code-caption', { type: 'text', 'aria-label': '代码块标题', placeholder: '代码块' })
  const foldButton = el('button', 'lark-doc-code-fold', { type: 'button', 'aria-label': '折叠代码块', 'aria-expanded': 'true' })
  foldButton.appendChild(codeIcon('fold'))
  const foldWrapper = el('span', 'lark-doc-code-fold-wrap')
  foldWrapper.appendChild(foldButton)
  const actions = el('div', 'lark-doc-code-actions')
  const languageButton = el('button', 'lark-doc-code-language', { type: 'button', 'aria-label': '代码语言', 'aria-haspopup': 'listbox', 'aria-expanded': 'false' })
  const languageLabel = el('span')
  languageButton.appendChild(languageLabel)
  languageButton.appendChild(codeIcon('caret'))
  const wrapButton = el('button', 'lark-doc-code-wrap', { type: 'button', 'aria-label': '自动换行' })
  const wrapLabel = el('span')
  wrapButton.appendChild(codeIcon('wrap'))
  wrapButton.appendChild(wrapLabel)
  const toggleButton = el('button', null, { type: 'button' })
  const copyButton = el('button', 'lark-doc-code-copy', { type: 'button' })
  const statusNode = el('span', 'lark-doc-code-copy-toast', { role: 'status', 'aria-live': 'polite' })


  const body = el('div', 'lark-doc-code-body')
  // 高亮层只接收 highlight.js 已转义的输出；正文始终由 Tiptap 的 contentDOM 管理。
  const highlightPre = el('pre', 'lark-doc-code-highlight', { 'aria-hidden': 'true', contenteditable: 'false' })
  const highlightCode = el('code')
  highlightPre.appendChild(highlightCode)
  const contentDOM = el('pre', 'lark-doc-code-input', { spellcheck: 'false' })
  const lineNumbers = markUi(el('div', 'lark-doc-code-line-numbers', { 'aria-hidden': 'true', contenteditable: 'false' }))
  body.appendChild(lineNumbers)
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
  function currentLanguageChoice() {
    return CODE_BLOCK_LANGUAGES.find(item => item.value === currentNode.attrs.language)
      || CODE_BLOCK_LANGUAGES.find(item => item.value === normalizeCodeLanguage(currentNode.attrs.language))
      || CODE_BLOCK_LANGUAGES[0]
  }

  /* ---------- 工具条 ---------- */
  function buildToolbar() {
    toolbar.textContent = ''
    if (toolbarMode === 'diagram') {
      closeLanguageMenu()
      toolbar.appendChild(diagramLabel)
      toolbar.appendChild(toggleButton)
      copyButton.textContent = '复制源码'
    } else {
      toolbar.appendChild(foldWrapper)
      toolbar.appendChild(caption)
      actions.replaceChildren(languageButton, wrapButton, copyButton)
      toolbar.appendChild(actions)
      copyButton.replaceChildren(codeIcon('copy'), document.createTextNode('复制'))
    }
    if (toolbarMode === 'diagram') toolbar.appendChild(copyButton)
    toolbar.appendChild(statusNode)
  }

  let languageUi = null, languageLoading = null, languageRequest = 0, languageCleanup = null
  function closeLanguageMenu(focus = false) {
    languageRequest += 1
    languageCleanup?.(); languageCleanup = null
    languageUi?.close(focus)
  }
  async function openLanguageMenu() {
    if (!editable) return
    if (languageLoading) { closeLanguageMenu(); return }
    if (!languageUi) {
      const request = ++languageRequest, openingDoc = editor.state?.doc
      const current = () => !destroyed && editable && request === languageRequest && editor.state?.doc === openingDoc
      const cancel = event => {
        if (event.type === 'keydown' && (event.key !== 'Escape' || event.isComposing || event.keyCode === 229)) return
        if (!languageButton.contains(event.target)) closeLanguageMenu()
      }
      const doc = dom.ownerDocument
      doc.addEventListener('pointerdown', cancel, true)
      doc.addEventListener('keydown', cancel, true)
      const cleanup = () => { doc.removeEventListener('pointerdown', cancel, true); doc.removeEventListener('keydown', cancel, true) }
      languageCleanup = cleanup
      try {
        languageLoading = import('./code-language-menu')
        const { createCodeLanguageMenu } = await languageLoading
        if (!current()) return
        languageUi = createCodeLanguageMenu({ dom, languageButton, currentLanguageChoice, setLanguage, canEdit: () => !destroyed && editable, focus: () => editor.view?.focus() })
      } catch (_) { if (current()) { statusNode.textContent = '语言菜单加载失败，请重试' } return }
      finally { languageLoading = null; cleanup(); if (languageCleanup === cleanup) languageCleanup = null }
    }
    languageUi.toggle()
  }

  function syncLineNumbers() {
    lineFrame = null
    if (destroyed || isDiagram()) return
    lineNumbers.textContent = ''
    const doc = dom.ownerDocument
    const textNodes = []
    const walker = doc.createTreeWalker(contentDOM, 4)
    let cursor = 0
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      textNodes.push({ node, from: cursor, to: cursor + node.textContent.length })
      cursor += node.textContent.length
    }
    const point = offset => {
      const entry = textNodes.find(item => offset >= item.from && offset <= item.to)
      return entry ? { node: entry.node, offset: offset - entry.from } : null
    }
    let offset = 0
    ;(currentNode.textContent || '').split('\n').forEach((line, index) => {
      let height = 22
      const start = point(offset)
      const end = point(offset + line.length)
      if (start && end && currentNode.attrs.wrap) {
        const range = doc.createRange()
        range.setStart(start.node, start.offset)
        range.setEnd(end.node, end.offset)
        const rects = Array.from(range.getClientRects?.() || []).filter(rect => rect.height > 0)
        if (rects.length) height = Math.max(22, Math.ceil((Math.max(...rects.map(rect => rect.bottom)) - Math.min(...rects.map(rect => rect.top))) / 22) * 22)
      }
      const number = el('span')
      number.textContent = String(index + 1)
      number.style.height = `${height}px`
      lineNumbers.appendChild(number)
      offset += line.length + 1
    })
  }

  function scheduleLineNumbers() {
    if (lineFrame != null) cancelFrame(lineFrame)
    lineFrame = requestFrame(syncLineNumbers)
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
    const diagram = isDiagram()
    dom.classList.add('lark-doc-code')
    dom.classList.toggle('lark-doc-code-diagram', diagram)
    dom.classList.toggle('is-wrapped', currentNode.attrs.wrap === true)
    dom.classList.toggle('is-collapsed', collapsed && !diagram)
    dom.classList.toggle('is-revision-delete', Boolean(currentNode.attrs.deletionRevisionId))
    if (currentNode.attrs.deletionRevisionId) dom.setAttribute('data-revision-id', currentNode.attrs.deletionRevisionId)
    else dom.removeAttribute('data-revision-id')

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
    } else {
      const displayed = currentLanguageChoice()
      languageLabel.textContent = displayed.label
      languageButton.disabled = !editable
      caption.disabled = !captionEditable
      if (dom.ownerDocument.activeElement !== caption) caption.value = currentNode.attrs.caption || ''
      wrapButton.disabled = !editable
      const label = currentNode.attrs.wrap ? '取消自动换行' : '自动换行'
      wrapLabel.textContent = label
      wrapButton.setAttribute('aria-label', label)
      wrapButton.setAttribute('aria-pressed', String(currentNode.attrs.wrap === true))
      foldButton.setAttribute('aria-label', collapsed ? '展开代码块' : '折叠代码块')
      foldButton.setAttribute('aria-expanded', String(!collapsed))
      copyButton.setAttribute('aria-label', '复制代码')
      languageUi?.refresh()
      if (!editable) closeLanguageMenu()
    }


    highlightCode.innerHTML = highlightedCode || renderHighlighted(
      currentNode.textContent || '', currentNode.attrs.language, syntaxHighlight()
    )
    // 源码区：图表预览成功时隐藏（原 Vue 版 `v-show="!showPreview || diagramState === 'error'"`）。
    body.style.display = (collapsed && !diagram) || (showPreview() && diagramState !== 'error') ? 'none' : ''
    scheduleLineNumbers()
    syncPreview()
  }

  /* ---------- 高亮 ---------- */
  function refreshHighlighted() {
    const text = currentNode.textContent
    // 统一走别名归一化：`js` 这类简写既不能让 `hljs.getLanguage` 判成功，
    // 也不该因为查不到就放弃 —— 否则每次渲染都停在「转义纯文本」上，
    // 连 highlight 分块都不会被请求。
    const language = normalizeCodeLanguage(currentNode.attrs.language)
    if (!syntaxHighlight()) { highlightedCode = escapeHTML(text); return }
    if (language !== 'plaintext' && !(hljs && hljs.getLanguage(language))) {
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
  /**
   * 是否属于「整篇替换」而非逐字编辑：剥掉公共前缀与公共后缀，只比较真正改动
   * 的区间。用户输入一次只增删少量字符（<= 8）；setContent / 粘贴 / 切换笔记
   * 换的是一整段不同源码，差异远大于此。必须同时看后缀，否则在图源码「中间」
   * 插一个字符也会因剩余后缀过长被误判为整篇替换，逐字编辑就变成每键立即重渲染。
   * 只用来决定「立即渲染 or 防抖」，不参与渲染结果。
   */
  function isAbruptChange(previous, next) {
    if (previous == null) return true
    if (previous === next) return false
    const previousLength = previous.length
    const nextLength = next.length
    const limit = Math.min(previousLength, nextLength)
    let start = 0
    while (start < limit && previous[start] === next[start]) start += 1
    let end = 0
    while (end < limit - start && previous[previousLength - 1 - end] === next[nextLength - 1 - end]) end += 1
    return previousLength - start - end > 8 || nextLength - start - end > 8
  }

  function scheduleDiagramRender() {
    if (!showPreview()) return
    const source = currentNode.textContent || ''
    if (diagramTimer) { clearTimeout(diagramTimer); diagramTimer = null }
    // 同一份源码已经渲染过（或正在渲染）：无关事务不必重画。错误态例外，
    // 允许后续 update 重试，渲染器补回 chunk 后无需改动内容即可恢复。
    if (source === lastRenderedSource && diagramState !== 'error') return
    const abrupt = isAbruptChange(lastScheduledSource, source)
    lastScheduledSource = source
    if (abrupt) { renderDiagramNow(); return }
    diagramTimer = setTimeout(() => { diagramTimer = null; renderDiagramNow() }, DIAGRAM_DEBOUNCE)
  }
  function renderDiagramNow() {
    if (!isDiagram()) return
    const version = (diagramVersion += 1)
    const source = currentNode.textContent
    lastRenderedSource = source
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
      diagramError = error && error.message ? String(error.message) : String(error || '图表渲染失败')
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
    // 换档是离散动作，源码没变也要用新配色重画；不走输入防抖。
    renderDiagramNow()
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
    if (!CODE_BLOCK_LANGUAGES.some(item => item.value === language)) return false
    if (!updateAttributes({ language })) return false
    if (editor.storage?.codeBlock) editor.storage.codeBlock.lastLanguage = language
    statusNode.replaceChildren()
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
  let clipboardUi = null
  async function copyCode() {
    const text = currentNode.textContent
    try {
      const { createCodeClipboard } = await import('./code-language-menu')
      if (destroyed) return
      if (!clipboardUi) clipboardUi = createCodeClipboard({ document: dom.ownerDocument, statusNode })
      return clipboardUi.copy(text)
    } catch (_) { if (!destroyed) { statusNode.textContent = '复制功能加载失败，请重试' } }
  }

  caption.addEventListener('input', () => {
    if (!captionEditable) { caption.value = currentNode.attrs.caption || ''; return }
    caption.value = caption.value.split('\u0000').join('').slice(0, 100000)
    if (caption.value !== (currentNode.attrs.caption || '')) updateAttributes({ caption: caption.value })
  })
  caption.addEventListener('blur', () => { caption.value = currentNode.attrs.caption || '' })
  caption.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === 'Escape') {
      event.stopPropagation()
      if (event.isComposing || event.keyCode === 229) return
      event.preventDefault()
      caption.blur()
      editor.commands?.focus()
    }
  })
  wrapButton.addEventListener('mousedown', event => event.preventDefault())
  wrapButton.addEventListener('click', () => {
    if (!editable) return
    const wrap = !currentNode.attrs.wrap
    if (updateAttributes({ wrap }) && editor.storage?.codeBlock) editor.storage.codeBlock.lastWrap = wrap
  })
  foldButton.addEventListener('mousedown', event => event.preventDefault())
  foldButton.addEventListener('click', () => { collapsed = !collapsed; syncDom() })
  languageButton.addEventListener('mousedown', event => event.preventDefault())
  languageButton.addEventListener('click', openLanguageMenu)
  toggleButton.addEventListener('click', togglePreview)
  copyButton.addEventListener('click', () => copyCode())
  body.addEventListener('scroll', () => { lineNumbers.style.transform = `translateX(${body.scrollLeft}px)` })

  /* ---------- 生命周期 ---------- */
  function syncEditable() {
    const next = Boolean(editor && !editor.isDestroyed && editor.isEditable)
    const nextCaption = next && !editor.storage?.larkDocRevisionTracker?.active
    if (next === editable && nextCaption === captionEditable) return
    editable = next
    captionEditable = nextCaption
    // 进入只读态时若无预览则渲染一份；回到编辑态保留用户当前的切换选择。
    if (isDiagram() && !previewShown && !next) previewShown = true
    syncDom()
  }
  if (editor && typeof editor.on === 'function') {
    editor.on('update', syncEditable)
    editor.on('transaction', syncEditable)
  }
  const lineObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(scheduleLineNumbers) : null
  lineObserver?.observe(body)

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
      clipboardUi?.destroy()
      closeLanguageMenu()
      languageUi?.destroy()
      lineObserver?.disconnect()
      if (lineFrame != null) { cancelFrame(lineFrame); lineFrame = null }
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
        editable, message: statusNode.textContent, diagramState, diagramError, contentTheme, previewShown,
        isDiagram: isDiagram(), showPreview: showPreview(), indent: blockIndent(),
      }
    },
  }
}

export default createCodeBlockNodeView
