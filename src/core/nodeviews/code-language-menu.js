/** Cold code language popup; source editing remains synchronous in the extension. */
import { CODE_BLOCK_LANGUAGES, filterCodeBlockLanguages } from './code-languages'

const MENU_ICONS = {
  check: [24, 'M4 11.293a1 1 0 011.414 0l4.072 4.07 9.07-9.07a1 1 0 011.415 0l.706.707a1 1 0 010 1.414L10.193 18.9a1 1 0 01-1.415 0l-5.485-5.485a1 1 0 010-1.414L4 11.293z'],
  search: [24, 'M16.473 17.887A9.46 9.46 0 0110.5 20a9.5 9.5 0 119.5-9.5 9.46 9.46 0 01-2.113 5.973l3.773 3.773a.996.996 0 01-.007 1.407.996.996 0 01-1.407.007l-3.773-3.773zM18 10.5a7.5 7.5 0 10-15 0 7.5 7.5 0 0015 0z'],
}

function menuIcon(name) {
  const [size, data] = MENU_ICONS[name]
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

export function createCodeLanguageMenu({ dom, languageButton, currentLanguageChoice, setLanguage, canEdit, focus }) {
  const document = dom.ownerDocument
  const el = (tag, className, attrs = {}) => { const e = document.createElement(tag); if (className) e.className = className; Object.entries(attrs).forEach(([k,v]) => e.setAttribute(k,v)); return e }
  const markUi = e => { e.setAttribute('data-lark-doc-code-ui',''); return e }
  let languageMenuOpen = false, languageEscapeTarget = null, languageActive = 0
  const languageMenu = markUi(el('div', 'lark-doc-code-language-menu', { role: 'listbox', 'aria-label': '代码语言' }))
  const languageSearch = el('input', 'lark-doc-code-language-search', { type: 'text', placeholder: '搜索', 'aria-label': '搜索代码语言' })
  const languageSearchRow = el('div', 'lark-doc-code-language-search-row')
  languageSearchRow.append(menuIcon('search'), languageSearch)
  const languageList = el('div', 'lark-doc-code-language-list')
  languageMenu.appendChild(languageSearchRow)
  languageMenu.appendChild(languageList)
  function positionLanguageMenu() {
    if (!languageMenuOpen) return
    const win = dom.ownerDocument.defaultView
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

  function closeLanguageMenu(restoreFocus = false) {
    languageMenuOpen = false
    languageButton.setAttribute('aria-expanded', 'false')
    languageMenu.remove()
    const doc = dom.ownerDocument
    doc.removeEventListener('pointerdown', outsideLanguageMenu, true)
    languageEscapeTarget?.removeEventListener('keydown', onLanguageMenuKeydown, true)
    languageEscapeTarget = null
    doc.defaultView.removeEventListener('resize', positionLanguageMenu)
    doc.defaultView.removeEventListener('scroll', positionLanguageMenu, true)
    if (restoreFocus && canEdit()) focus()
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
      if (selected) item.appendChild(menuIcon('check'))
      item.addEventListener('mousedown', event => event.preventDefault())
      item.addEventListener('mouseenter', () => {
        languageActive = index
        Array.from(languageList.children).forEach((node, position) => node.classList.toggle('is-highlight', position === index))
      })
      item.addEventListener('click', () => { if (setLanguage(choice.value)) closeLanguageMenu(true) })
      languageList.appendChild(item)
    })
    positionLanguageMenu()
  }

  function outsideLanguageMenu(event) {
    if (!languageMenu.contains(event.target) && !languageButton.contains(event.target)) closeLanguageMenu()
  }

  function onLanguageMenuKeydown(event) {
    if (event.key !== 'Escape') return
    event.stopPropagation()
    if (event.isComposing || event.keyCode === 229) return
    event.preventDefault()
    closeLanguageMenu(true)
  }

  function openLanguageMenu() {
    if (!canEdit()) return
    if (languageMenuOpen) { closeLanguageMenu(); return }
    languageMenuOpen = true
    languageSearch.value = ''
    languageActive = CODE_BLOCK_LANGUAGES.findIndex(item => item.value === currentLanguageChoice().value)
    ;(dom.closest('.lark-doc') || dom.ownerDocument.body).appendChild(languageMenu)
    languageButton.setAttribute('aria-expanded', 'true')
    renderLanguageChoices()
    languageList.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' })
    languageSearch.focus()
    const doc = dom.ownerDocument
    doc.addEventListener('pointerdown', outsideLanguageMenu, true)
    languageEscapeTarget = dom.closest('.lark-doc') || doc
    languageEscapeTarget.addEventListener('keydown', onLanguageMenuKeydown, true)
    doc.defaultView.addEventListener('resize', positionLanguageMenu)
    doc.defaultView.addEventListener('scroll', positionLanguageMenu, true)
  }


  languageSearch.addEventListener('input', () => { languageActive = 0; renderLanguageChoices() })
  languageSearch.addEventListener('keydown', event => {
    const items = Array.from(languageList.querySelectorAll('[role="option"]'))
    if (!['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return
    event.stopPropagation()
    if (event.isComposing || event.keyCode === 229) return
    event.preventDefault()
    if (event.key === 'Enter') { items[languageActive]?.click(); return }
    if (!items.length) return
    languageActive = (languageActive + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    items.forEach((item, index) => item.classList.toggle('is-highlight', index === languageActive))
    items[languageActive].scrollIntoView?.({ block: 'nearest' })
  })

  return { toggle: openLanguageMenu, close: closeLanguageMenu, destroy: closeLanguageMenu, refresh: () => { if (languageMenuOpen) renderLanguageChoices() } }
}

export function copyCodeText(text, document) {
  const navigator = document.defaultView.navigator
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

  return done
}

export function createCodeClipboard({ document, statusNode }) {
  let destroyed = false, timer = null
  const clear = () => { if (!destroyed) statusNode.replaceChildren() }
  const message = text => {
    if (destroyed) return
    statusNode.replaceChildren()
    if (text === '复制成功') statusNode.appendChild(menuIcon('check'))
    statusNode.appendChild(document.createTextNode(text))
    clearTimeout(timer)
    timer = setTimeout(clear, 3000)
  }
  return {
    copy: text => copyCodeText(text, document).then(() => message('复制成功')).catch(() => message('无法访问剪贴板，请选择代码后手动复制')),
    destroy() { destroyed = true; clearTimeout(timer) },
  }
}
