/** Inline / legacy block math share an anchored editor. Escape finishes the current edit. */
import { TextSelection } from '@tiptap/pm/state'
import { closeHistory } from '@tiptap/pm/history'

export const MATH_HELP_URL = 'https://www.feishu.cn/hc/zh-CN/articles/894598450617-在文档中使用公式'

export function openMathAt(editor, pos) {
  for (const name of ['inlineMath', 'blockMath']) {
    for (const view of editor.storage[name]?.views || []) if (view.position() === pos) return view.open()
  }
  return false
}

export function createMathNodeView({ node, editor, getPos, extension }, { loadKatex, onError } = {}) {
  const block = node.type.name === 'blockMath'
  const storage = editor.storage[node.type.name]
  const dom = document.createElement(block ? 'div' : 'span')
  dom.className = 'tiptap-mathematics-render'
  dom.setAttribute('data-type', block ? 'block-math' : 'inline-math')
  dom.contentEditable = 'false'
  let destroyed = false, version = 0, panel = null, input = null, composing = false, scope = null
  const runtime = () => extension.options.getRuntimeOptions?.() || {}
  const enabled = () => !destroyed && !editor.isDestroyed && editor.isEditable && runtime().enabled !== false
  function position() {
    if (destroyed) return null
    try {
      const pos = getPos(), live = Number.isInteger(pos) && editor.state.doc.nodeAt(pos)
      return live?.type === node.type && live.eq(node) ? pos : null
    } catch (_) { return null }
  }
  function render(current) {
    const generation = ++version, value = String(current.attrs.latex || '')
    dom.dataset.latex = value
    dom.dataset.mathEditable = String(enabled())
    dom.classList.remove('lark-doc-math-invalid', 'lark-doc-math-empty', 'lark-doc-math-load-error')
    if (!value) {
      dom.textContent = '添加 LaTeX 公式'
      dom.classList.add('lark-doc-math-empty')
      return
    }
    loadKatex().then(katex => {
      if (destroyed || generation !== version) return
      try { katex.render(value, dom, { throwOnError: true, displayMode: block, trust: false, strict: 'error', maxExpand: 1000 }) }
      catch (_) {
        const warning = document.createElement('span')
        warning.className = 'lark-doc-math-warning'
        warning.setAttribute('aria-hidden', 'true')
        warning.textContent = '!'
        dom.replaceChildren(warning, document.createTextNode('无效公式'))
        dom.classList.add('lark-doc-math-invalid')
      }
      if (panel) place()
    }).catch(() => {
      if (destroyed || generation !== version) return
      dom.textContent = '公式渲染器加载失败，点击重试'
      dom.classList.add('lark-doc-math-load-error')
      onError?.('公式渲染器加载失败')
    })
  }
  function sizeInput() {
    if (!input) return
    input.style.height = 'auto'
    input.style.height = `${Math.min(500, Math.max(40, input.scrollHeight + 2))}px`
  }
  function place() {
    if (!panel) return
    const rect = dom.getBoundingClientRect(), height = panel.getBoundingClientRect().height || 98
    const viewportWidth = window.innerWidth, viewportHeight = window.innerHeight
    if (rect.bottom < 0 || rect.top > viewportHeight) { close(false, true, true); return }
    const width = Math.min(400, Math.max(0, viewportWidth - 16))
    const left = Math.max(8, Math.min(rect.left, viewportWidth - width - 8))
    const top = rect.bottom + height + 8 <= viewportHeight ? rect.bottom + 8 : Math.max(8, rect.top - height - 8)
    Object.assign(panel.style, { left: `${left}px`, top: `${top}px`, width: `${width}px` })
  }
  function seal() {
    if (!editor.isDestroyed) editor.view.dispatch(closeHistory(editor.state.tr).setMeta('addToHistory', false))
  }
  function close(focus = false, history = true, flush = false) {
    if (!panel) return
    if (flush && enabled() && runtime().scope === scope) {
      composing = false
      commit({ target: input }, false)
      if (!panel) return
    }
    const pos = position()
    panel.remove()
    panel = null
    input = null
    composing = false
    window.removeEventListener('resize', place)
    window.removeEventListener('scroll', place, true)
    document.removeEventListener('pointerdown', outside, true)
    if (history && !destroyed) seal()
    if (focus && enabled() && pos !== null) {
      const after = Math.min(editor.state.doc.content.size, pos + node.nodeSize)
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(after))))
      editor.view.focus()
    }
  }
  function outside(event) {
    if (!event.target?.nodeType || !panel?.contains(event.target) && !dom.contains(event.target)) close(false, true, true)
  }
  function sync() {
    dom.dataset.mathEditable = String(enabled())
    if (panel && (!enabled() || position() === null || runtime().scope !== scope)) close(false)
  }
  function commit(event, reposition = true) {
    if (!panel || event.target !== input || composing) return
    if (!enabled() || runtime().scope !== scope) { close(false); return }
    const pos = position(), value = input.value.slice(0, 100000).split('\u0000').join('')
    if (pos === null) { close(false); return }
    if (input.value !== value) input.value = value
    const current = editor.state.doc.nodeAt(pos)
    if (current.attrs.latex !== value) editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, latex: value }))
    if (reposition) { sizeInput(); place() }
  }
  function open() {
    if (!enabled() || position() === null) return false
    if (panel) { input.focus(); return true }
    for (const name of ['inlineMath', 'blockMath']) for (const view of editor.storage[name]?.views || []) if (view !== controller) view.close(false, true, true)
    seal()
    scope = runtime().scope
    panel = document.createElement('div')
    panel.className = 'lark-doc-math-editor'
    panel.setAttribute('role', 'dialog')
    panel.setAttribute('aria-label', '编辑公式')
    input = document.createElement('textarea')
    input.setAttribute('aria-label', 'LaTeX 公式')
    input.placeholder = '请输入公式'
    input.rows = 1
    input.maxLength = 100000
    input.spellcheck = false
    input.value = node.attrs.latex
    input.addEventListener('input', commit)
    input.addEventListener('compositionstart', () => { composing = true })
    input.addEventListener('compositionend', event => { composing = false; commit(event) })
    panel.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || event.isComposing || composing) return
      event.preventDefault()
      event.stopPropagation()
      if (event.target === input) close(true)
    })
    const footer = document.createElement('div')
    footer.className = 'lark-doc-math-editor-footer'
    const tip = document.createElement('span')
    tip.textContent = '按 ESC 完成输入'
    const help = document.createElement('a')
    help.href = MATH_HELP_URL
    help.target = '_blank'
    help.rel = 'noopener noreferrer'
    help.textContent = 'ⓘ 查看帮助文档'
    footer.append(tip, help)
    panel.append(input, footer)
    ;(editor.view.dom.closest('.lark-doc') || editor.view.dom.parentElement || document.body).appendChild(panel)
    sizeInput()
    place()
    if (!panel) return false
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    document.addEventListener('pointerdown', outside, true)
    input?.focus()
    if (dom.classList.contains('lark-doc-math-load-error')) render(node)
    return true
  }
  const controller = { position, open, close, sync }
  storage.views.add(controller)
  editor.on('transaction', sync)
  editor.on('update', sync)
  dom.addEventListener('mousedown', event => { if (enabled()) event.preventDefault() })
  dom.addEventListener('click', event => { if (open()) { event.preventDefault(); event.stopPropagation() } })
  render(node)
  return {
    dom,
    update(next) {
      if (next.type !== node.type) return false
      node = next
      render(node)
      if (input && input.value !== node.attrs.latex) { input.value = node.attrs.latex; sizeInput() }
      return true
    },
    stopEvent(event) { return enabled() && (event.type === 'mousedown' || event.type === 'click') },
    ignoreMutation() { return true },
    destroy() {
      destroyed = true
      version += 1
      close(false, false)
      storage.views.delete(controller)
      editor.off('transaction', sync)
      editor.off('update', sync)
    },
  }
}
