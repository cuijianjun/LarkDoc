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
import { lockPageScroll } from '../../ui/dom'
import { el, codeIcon, markUi, UI_ATTR } from './codeBlockDom'
import { ensureLanguage, escapeHTML, hasLanguage, renderHighlighted } from './codeHighlight'
import { CODE_BLOCK_LANGUAGES, codeBlockLanguageOptions, filterCodeBlockLanguages, normalizeCodeLanguage } from './code-languages'

export { CODE_BLOCK_LANGUAGES, codeBlockLanguageOptions, filterCodeBlockLanguages, normalizeCodeLanguage }

/** 图表渲染防抖：源码连打时只渲染最后一帧。 */
const DIAGRAM_DEBOUNCE = 300

export function createCodeBlockNodeView(props) {
  const { editor, node, view, getPos, extension } = props
  const options = (extension && extension.options) || {}
  let currentNode = node
  let editable = Boolean(editor && !editor.isDestroyed && editor.isEditable)
  let captionEditable = editable && !editor.storage?.larkDocRevisionTracker?.active
  let destroyed = false
  let message = ''
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
  let languageMenuOpen = false
  let moreMenuOpen = false
  let popupDocument = null
  let releaseLanguageScroll = null
  let languageEscapeTarget = null
  let languageActive = 0
  let messageTimer = null

  /* ---------- DOM 骨架 ---------- */
  const dom = el('div', 'lark-doc-code')
  const ownerWindow = dom.ownerDocument.defaultView
  const phoneMedia = ownerWindow.matchMedia?.('(max-width: 760px) and (pointer: coarse)')
  const isPhone = () => Boolean(phoneMedia?.matches && ownerWindow.innerWidth <= 760)
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
  const moreButton = el('button', 'lark-doc-code-more', { type: 'button', 'aria-label': '代码块更多', 'aria-haspopup': 'menu', 'aria-expanded': 'false' })
  moreButton.textContent = '···'
  const moreMenu = markUi(el('div', 'lark-doc-code-more-menu', { role: 'menu', 'aria-label': '代码块操作' }))
  const statusNode = el('span', 'lark-doc-code-copy-toast', { role: 'status', 'aria-live': 'polite' })
  const languageMenu = markUi(el('div', 'lark-doc-code-language-menu', { role: 'listbox', 'aria-label': '代码语言' }))
  const languageHeader = el('header', 'lark-doc-code-language-header')
  languageHeader.hidden = true
  const languageClose = el('button', null, { type: 'button', 'aria-label': '关闭代码语言' })
  languageClose.textContent = '×'
  const languageTitle = el('h2')
  languageTitle.textContent = '切换代码语言'
  languageHeader.append(languageClose, languageTitle, el('span'))
  const languageSearch = el('input', 'lark-doc-code-language-search', { type: 'text', placeholder: '搜索', 'aria-label': '搜索代码语言' })
  const languageSearchRow = el('div', 'lark-doc-code-language-search-row')
  languageSearchRow.append(codeIcon('search'), languageSearch)
  const languageList = el('div', 'lark-doc-code-language-list')
  languageMenu.appendChild(languageHeader)
  languageMenu.appendChild(languageSearchRow)
  languageMenu.appendChild(languageList)

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
    closeMoreMenu()
    toolbar.textContent = ''
    if (toolbarMode === 'diagram') {
      closeLanguageMenu()
      toolbar.appendChild(diagramLabel)
      toolbar.appendChild(toggleButton)
      copyButton.textContent = '复制源码'
    } else {
      toolbar.appendChild(foldWrapper)
      toolbar.appendChild(caption)
      actions.replaceChildren(...(isPhone() ? [languageButton, moreButton] : [languageButton, wrapButton, copyButton]))
      toolbar.appendChild(actions)
      copyButton.replaceChildren(codeIcon('copy'), document.createTextNode('复制'))
    }
    if (toolbarMode === 'diagram') toolbar.appendChild(copyButton)
    toolbar.appendChild(statusNode)
  }

  function positionLanguageMenu() {
    if (!languageMenuOpen) return
    const win = dom.ownerDocument.defaultView
    if (isPhone()) {
      const viewport = win.visualViewport
      const height = Math.max(0, Math.min(win.innerHeight, viewport?.height || win.innerHeight))
      languageMenu.style.left = `${viewport?.offsetLeft || 0}px`
      languageMenu.style.top = `${viewport?.offsetTop || 0}px`
      languageMenu.style.width = `${Math.min(win.innerWidth, viewport?.width || win.innerWidth)}px`
      languageMenu.style.height = `${height}px`
      languageMenu.style.maxHeight = `${height}px`
      languageList.style.maxHeight = ''
      return
    }
    languageMenu.style.width = ''
    languageMenu.style.height = ''
    const rect = languageButton.getBoundingClientRect()
    const below = win.innerHeight - rect.bottom - 12
    const above = rect.top - 12
    const down = below >= Math.min(300, above)
    const height = Math.max(100, Math.min(720, down ? below : above))
    languageMenu.style.maxHeight = `${height}px`
    languageList.style.maxHeight = `${height - 58}px`
    languageMenu.style.left = `${Math.max(8, Math.min(rect.left, win.innerWidth - 227))}px`
    languageMenu.style.top = `${down ? rect.bottom + 4 : Math.max(8, rect.top - languageMenu.getBoundingClientRect().height - 4)}px`
  }

  function closeLanguageMenu(focus = false) {
    const wasOpen = languageMenuOpen
    languageMenuOpen = false
    if (!moreMenuOpen) popupDocument = null
    languageButton.setAttribute('aria-expanded', 'false')
    languageMenu.remove()
    const doc = dom.ownerDocument
    doc.removeEventListener('pointerdown', outsideLanguageMenu, true)
    languageEscapeTarget?.removeEventListener('keydown', onLanguageMenuKeydown, true)
    languageEscapeTarget = null
    doc.defaultView.removeEventListener('resize', positionLanguageMenu)
    doc.defaultView.removeEventListener('scroll', positionLanguageMenu, true)
    doc.defaultView.visualViewport?.removeEventListener('resize', positionLanguageMenu)
    doc.defaultView.visualViewport?.removeEventListener('scroll', positionLanguageMenu)
    releaseLanguageScroll?.()
    releaseLanguageScroll = null
    if (focus && wasOpen) focusAfterLanguageMenu()
  }

  function focusAfterLanguageMenu() {
    if (destroyed || !editable || editor?.isDestroyed) return
    if (isPhone()) languageButton.focus({ preventScroll: true })
    else editor.view?.focus()
  }

  function popupIsCurrent() {
    return !destroyed && !editor?.isDestroyed && popupDocument === editor?.state?.doc
  }

  function positionMoreMenu() {
    if (!moreMenuOpen) return
    const rect = moreButton.getBoundingClientRect()
    const height = moreMenu.getBoundingClientRect().height
    moreMenu.style.left = `${Math.max(8, Math.min(rect.right - 180, ownerWindow.innerWidth - 188))}px`
    moreMenu.style.top = `${Math.max(8, Math.min(rect.bottom + 4, ownerWindow.innerHeight - height - 8))}px`
  }

  function outsideMoreMenu(event) {
    if (!moreMenu.contains(event.target) && !moreButton.contains(event.target)) closeMoreMenu()
  }

  function onMoreMenuKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); closeMoreMenu(true)
    }
  }

  function closeMoreMenu(focus = false) {
    const wasOpen = moreMenuOpen
    moreMenuOpen = false
    if (!languageMenuOpen) popupDocument = null
    moreButton.setAttribute('aria-expanded', 'false')
    moreMenu.remove()
    const doc = dom.ownerDocument
    doc.removeEventListener('pointerdown', outsideMoreMenu, true)
    doc.removeEventListener('keydown', onMoreMenuKeydown)
    ownerWindow.removeEventListener('resize', positionMoreMenu)
    ownerWindow.removeEventListener('scroll', positionMoreMenu, true)
    if (focus && wasOpen && !destroyed && !editor?.isDestroyed) moreButton.focus({ preventScroll: true })
  }

  function openMoreMenu() {
    if (destroyed || editor?.isDestroyed || !isPhone()) return
    if (moreMenuOpen) { closeMoreMenu(); return }
    closeLanguageMenu()
    moreMenuOpen = true
    popupDocument = editor?.state?.doc
    moreMenu.replaceChildren(...(editable ? [wrapButton, copyButton] : [copyButton]))
    ;(dom.closest('.lark-doc') || dom.ownerDocument.body).appendChild(moreMenu)
    moreButton.setAttribute('aria-expanded', 'true')
    positionMoreMenu()
    const doc = dom.ownerDocument
    doc.addEventListener('pointerdown', outsideMoreMenu, true)
    doc.addEventListener('keydown', onMoreMenuKeydown)
    ownerWindow.addEventListener('resize', positionMoreMenu)
    ownerWindow.addEventListener('scroll', positionMoreMenu, true)
  }

  function renderLanguageChoices() {
    const choices = filterCodeBlockLanguages(languageSearch.value)
    languageList.textContent = ''
    if (!choices.length) {
      const empty = el('div', 'lark-doc-code-language-empty', { 'aria-disabled': 'true' })
      empty.textContent = '无匹配结果'
      languageList.appendChild(empty)
    }
    choices.forEach((choice, index) => {
      const selected = choice.value === currentLanguageChoice().value
      const item = el('button', 'lark-doc-code-language-option', { type: 'button', role: 'option', 'aria-selected': String(selected) })
      item.classList.toggle('is-highlight', index === languageActive)
      item.appendChild(document.createTextNode(choice.label))
      if (selected) item.appendChild(codeIcon('check'))
      item.addEventListener('mousedown', event => event.preventDefault())
      item.addEventListener('mouseenter', () => {
        languageActive = index
        Array.from(languageList.children).forEach((node, position) => node.classList.toggle('is-highlight', position === index))
      })
      item.addEventListener('click', () => {
        if (!languageMenuOpen || !item.isConnected || !languageMenu.contains(item) || !popupIsCurrent()) return
        if (setLanguage(choice.value)) {
          closeLanguageMenu()
          focusAfterLanguageMenu()
        }
      })
      languageList.appendChild(item)
    })
    positionLanguageMenu()
  }

  function outsideLanguageMenu(event) {
    if (!languageMenu.contains(event.target) && !languageButton.contains(event.target)) closeLanguageMenu()
  }

  function onLanguageMenuKeydown(event) {
    if (event.key === 'Escape') { if (event.isComposing || event.keyCode === 229) return; event.preventDefault(); event.stopPropagation(); closeLanguageMenu(true) }
    else if (isPhone() && event.key === 'Tab') {
      const controls = [languageClose, languageSearch, ...languageList.querySelectorAll('button')]
      const active = dom.ownerDocument.activeElement
      if (event.shiftKey && active === controls[0]) { event.preventDefault(); controls.at(-1)?.focus() }
      else if (!event.shiftKey && active === controls.at(-1)) { event.preventDefault(); controls[0].focus() }
    }
  }

  function openLanguageMenu() {
    if (destroyed || !editable || editor?.isDestroyed) return
    if (languageMenuOpen) { closeLanguageMenu(); return }
    closeMoreMenu()
    languageMenuOpen = true
    popupDocument = editor?.state?.doc
    const phone = isPhone()
    languageHeader.hidden = !phone
    languageMenu.classList.toggle('is-phone-sheet', phone)
    languageMenu.setAttribute('role', phone ? 'dialog' : 'listbox')
    languageMenu.setAttribute('aria-label', phone ? '切换代码语言' : '代码语言')
    if (phone) languageMenu.setAttribute('aria-modal', 'true')
    else languageMenu.removeAttribute('aria-modal')
    if (phone) languageList.setAttribute('role', 'listbox')
    else languageList.removeAttribute('role')
    languageSearch.value = ''
    languageActive = CODE_BLOCK_LANGUAGES.indexOf(currentLanguageChoice())
    ;(dom.closest('.lark-doc') || dom.ownerDocument.body).appendChild(languageMenu)
    languageButton.setAttribute('aria-expanded', 'true')
    if (phone) {
      const releases = [lockPageScroll(dom.ownerDocument.body)]
      const main = dom.closest('.lark-doc-main')
      if (main) releases.push(lockPageScroll(main))
      releaseLanguageScroll = () => releases.forEach(release => release())
    }
    renderLanguageChoices()
    languageList.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' })
    languageSearch.focus()
    const doc = dom.ownerDocument
    doc.addEventListener('pointerdown', outsideLanguageMenu, true)
    languageEscapeTarget = dom.closest('.lark-doc') || doc
    languageEscapeTarget.addEventListener('keydown', onLanguageMenuKeydown, true)
    doc.defaultView.addEventListener('resize', positionLanguageMenu)
    doc.defaultView.addEventListener('scroll', positionLanguageMenu, true)
    doc.defaultView.visualViewport?.addEventListener('resize', positionLanguageMenu)
    doc.defaultView.visualViewport?.addEventListener('scroll', positionLanguageMenu)
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
    dom.className = diagram ? 'lark-doc-code lark-doc-code-diagram' : 'lark-doc-code'
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

    const nextMode = diagram ? 'diagram' : (isPhone() ? 'code-phone' : 'code')
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
      if (languageMenuOpen) renderLanguageChoices()
      if (!editable) closeLanguageMenu()
    }
    statusNode.textContent = ''
    if (message) {
      if (message === '复制成功') statusNode.appendChild(codeIcon('check'))
      statusNode.appendChild(document.createTextNode(message))
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
    if (language !== 'plaintext' && !(hasLanguage(language))) {
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
    if (destroyed || !editor || editor.isDestroyed || !editor.isEditable || !view) return false
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
    if (editor.storage?.codeBlock) editor.storage.codeBlock.lastLanguage = language
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
    if (destroyed || editor?.isDestroyed) return Promise.resolve()
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
    const showMessage = text => {
      if (destroyed) return
      message = text
      if (messageTimer) clearTimeout(messageTimer)
      messageTimer = setTimeout(() => { messageTimer = null; message = ''; syncDom() }, 3000)
      syncDom()
    }
    return done.then(() => showMessage('复制成功'))
      .catch(() => showMessage('无法访问剪贴板，请选择代码后手动复制'))
  }

  caption.addEventListener('input', () => {
    if (!captionEditable) { caption.value = currentNode.attrs.caption || ''; return }
    caption.value = caption.value.split('\u0000').join('').slice(0, 100000)
    if (caption.value !== (currentNode.attrs.caption || '')) updateAttributes({ caption: caption.value })
  })
  caption.addEventListener('blur', () => { caption.value = currentNode.attrs.caption || '' })
  caption.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      caption.blur()
      editor.commands?.focus()
    }
  })
  wrapButton.addEventListener('mousedown', event => event.preventDefault())
  wrapButton.addEventListener('click', () => {
    if (!editable) return
    if (isPhone() && (!moreMenuOpen || !wrapButton.isConnected || !popupIsCurrent())) return
    closeMoreMenu()
    const wrap = !currentNode.attrs.wrap
    if (updateAttributes({ wrap }) && editor.storage?.codeBlock) editor.storage.codeBlock.lastWrap = wrap
  })
  foldButton.addEventListener('mousedown', event => event.preventDefault())
  foldButton.addEventListener('click', () => { collapsed = !collapsed; syncDom() })
  languageButton.addEventListener('mousedown', event => event.preventDefault())
  languageButton.addEventListener('click', openLanguageMenu)
  moreButton.addEventListener('mousedown', event => event.preventDefault())
  moreButton.addEventListener('click', openMoreMenu)
  languageClose.addEventListener('click', () => closeLanguageMenu(true))
  languageSearch.addEventListener('input', () => { languageActive = 0; renderLanguageChoices() })
  languageSearch.addEventListener('keydown', event => {
    const items = Array.from(languageList.querySelectorAll('[role="option"]'))
    if (!['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return
    event.preventDefault()
    event.stopPropagation()
    if (event.key === 'Enter') { items[languageActive]?.click(); return }
    if (!items.length) return
    languageActive = (languageActive + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    items.forEach((item, index) => item.classList.toggle('is-highlight', index === languageActive))
    items[languageActive].scrollIntoView?.({ block: 'nearest' })
  })
  toggleButton.addEventListener('click', togglePreview)
  copyButton.addEventListener('click', () => {
    if (isPhone() && !isDiagram() && (!moreMenuOpen || !copyButton.isConnected || !popupIsCurrent())) return
    closeMoreMenu()
    copyCode()
  })
  body.addEventListener('scroll', () => { lineNumbers.style.transform = `translateX(${body.scrollLeft}px)` })

  /* ---------- 生命周期 ---------- */
  function syncEditable() {
    if ((languageMenuOpen || moreMenuOpen) && !popupIsCurrent()) {
      closeLanguageMenu()
      closeMoreMenu()
    }
    const next = Boolean(editor && !editor.isDestroyed && editor.isEditable)
    const nextCaption = next && !editor.storage?.larkDocRevisionTracker?.active
    if (next === editable && nextCaption === captionEditable) return
    closeMoreMenu()
    editable = next
    captionEditable = nextCaption
    // 进入只读态时若无预览则渲染一份；回到编辑态保留用户当前的切换选择。
    if (isDiagram() && !previewShown && !next) previewShown = true
    syncDom()
  }
  function onPhoneMediaChange() {
    closeLanguageMenu()
    closeMoreMenu()
    syncDom()
  }
  phoneMedia?.addEventListener?.('change', onPhoneMediaChange)
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
      if (messageTimer) { clearTimeout(messageTimer); messageTimer = null }
      closeLanguageMenu()
      closeMoreMenu()
      phoneMedia?.removeEventListener?.('change', onPhoneMediaChange)
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
        editable, message, diagramState, diagramError, contentTheme, previewShown,
        isDiagram: isDiagram(), showPreview: showPreview(), indent: blockIndent(),
      }
    },
  }
}

export default createCodeBlockNodeView
