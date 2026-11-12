/**
 * 宿主侧模板库原生 DOM renderer。
 *
 * 本文件提供模板库的无框架宿主入口：`open/close`、关键词搜索、分类切换，以及
 * `preview/use/close` 回调；宿主不需要 Vue。
 * 默认「使用」通知云盘宿主复制文档；编辑器 insert mode 使用独立的 onInsert 合同。
 */
import { mountNode, setAttr, setText, syncChildren } from './dom'
import {
  TEMPLATE_GRID, TEMPLATE_HEADER, TEMPLATE_MODAL, TEMPLATE_SIDEBAR, TEMPLATE_TEXT,
  TEMPLATE_EDITOR_MODAL,
  buildCategoryList, searchTemplates, templatesOf,
} from '../core/templates/library'

const px = (value) => `${value}px`

/** Vue SFC 与原生 renderer 共用的根节点 CSS 自定义属性。 */
export function templateLibraryRootStyle(mode = 'copy') {
  return {
    '--tpl-width-inset': px(mode === 'insert' ? TEMPLATE_EDITOR_MODAL.widthInset : TEMPLATE_MODAL.widthInset),
    '--tpl-max-width': mode === 'insert' ? px(TEMPLATE_EDITOR_MODAL.maxWidth) : 'none',
    '--tpl-height-inset': px(TEMPLATE_MODAL.heightInset),
    '--tpl-modal-radius': px(TEMPLATE_MODAL.radius),
    '--tpl-body-bg': TEMPLATE_MODAL.bodyBg,
    '--tpl-mask': TEMPLATE_MODAL.mask,
    '--tpl-header-height': px(TEMPLATE_HEADER.height),
    '--tpl-search-width': px(TEMPLATE_HEADER.searchWidth),
    '--tpl-search-height': px(TEMPLATE_HEADER.searchHeight),
    '--tpl-search-radius': px(TEMPLATE_HEADER.searchRadius),
    '--tpl-search-border': TEMPLATE_HEADER.searchBorder,
    '--tpl-search-bg': TEMPLATE_HEADER.searchBg,
    '--tpl-close-size': px(TEMPLATE_HEADER.closeSize),
    '--tpl-sidebar-width': px(TEMPLATE_SIDEBAR.width),
    '--tpl-sidebar-pad-top': px(TEMPLATE_SIDEBAR.paddingTop),
    '--tpl-sidebar-pad-bottom': px(TEMPLATE_SIDEBAR.paddingBottom),
    '--tpl-item-height': px(TEMPLATE_SIDEBAR.itemHeight),
    '--tpl-item-radius': px(TEMPLATE_SIDEBAR.itemRadius),
    '--tpl-item-margin': TEMPLATE_SIDEBAR.itemMargin,
    '--tpl-item-active-bg': TEMPLATE_SIDEBAR.activeBg,
    '--tpl-item-active-color': TEMPLATE_SIDEBAR.activeColor,
    '--tpl-columns': String(TEMPLATE_GRID.columns),
    '--tpl-card-width': px(TEMPLATE_GRID.cardWidth),
    '--tpl-card-height': px(TEMPLATE_GRID.cardHeight),
    '--tpl-gap': px(TEMPLATE_GRID.gap),
    '--tpl-row-gap': px(TEMPLATE_GRID.rowGap),
    '--tpl-grid-pad': px(TEMPLATE_GRID.padding),
    '--tpl-head-height': px(TEMPLATE_GRID.titleHeight),
    '--tpl-thumb-height': px(TEMPLATE_GRID.thumbHeight),
    '--tpl-foot-height': px(TEMPLATE_GRID.bottomHeight),
    '--tpl-card-radius': px(TEMPLATE_GRID.radius),
    '--tpl-thumb-radius': px(TEMPLATE_GRID.thumbRadius),
    '--tpl-shadow': TEMPLATE_GRID.shadow,
    '--tpl-shadow-hover': TEMPLATE_GRID.shadowHover,
    '--tpl-transition': TEMPLATE_GRID.transition,
    '--tpl-hover-lift': px(TEMPLATE_GRID.hoverLift),
    '--tpl-action-slide': px(TEMPLATE_GRID.actionSlide),
    '--tpl-action-btn-width': px(TEMPLATE_GRID.actionButtonWidth),
    '--tpl-action-btn-height': px(TEMPLATE_GRID.actionButtonHeight),
    '--tpl-action-btn-gap': px(TEMPLATE_GRID.actionButtonGap),
    '--tpl-name-size': px(TEMPLATE_TEXT.name.size),
    '--tpl-name-weight': String(TEMPLATE_TEXT.name.weight),
    '--tpl-name-color': TEMPLATE_TEXT.name.color,
    '--tpl-meta-size': px(TEMPLATE_TEXT.meta.size),
    '--tpl-meta-color': TEMPLATE_TEXT.meta.color,
  }
}

function setInputValue(input, value) {
  const text = value === null || value === undefined ? '' : String(value)
  if (input.value !== text) input.value = text
}

function callHandler(handlers, name, ...args) {
  const fn = handlers[name]
  return typeof fn === 'function' ? fn(...args) : undefined
}

export function createTemplateLibrary(options = {}) {
  const host = options.host || null
  const handlers = options.handlers || {}
  const insertMode = options.mode === 'insert'
  let state = {
    open: false,
    target: '我的文档库',
    templates: [],
    promoCategories: null,
    activeCategory: 'recommend',
    keyword: '',
  }
  let root = null
  let refs = null
  let destroyed = false
  let categorySignature = null
  const categories = new Map()
  const cards = new Map()
  let previewTemplate = null
  const current = () => !destroyed && !!state.open && !!root && (!insertMode || root.isConnected && callHandler(handlers, 'isCurrent') !== false)
  const requestClose = () => { if (!destroyed && state.open) callHandler(handlers, 'onClose') }

  function showPreview(template) {
    if (!current()) return
    if (!insertMode) { callHandler(handlers, 'onPreview', template); return }
    refs.previewBody.replaceChildren()
    try {
      options.renderDocument(refs.previewBody, template)
      previewTemplate = template
      setText(refs.previewTitle, template.name)
      render()
      refs.previewClose.focus()
    } catch (error) {
      refs.previewBody.textContent = error?.message || '模板预览失败，请重试'
      previewTemplate = template
      setText(refs.previewTitle, template.name)
      render()
    }
  }

  function useTemplate(template) {
    if (!current()) return
    callHandler(handlers, insertMode ? 'onInsert' : 'onUse', template)
  }

  function adjacentPreview(step) {
    const available = searchTemplates(templatesOf(state.templates, state.activeCategory), state.keyword)
      .filter(item => typeof state.templates.find(source => source.id === item.id)?.html === 'string')
    return available[available.findIndex(item => item.id === previewTemplate?.id) + step] || null
  }

  function build() {
    root = document.createElement('div')
    root.className = `lark-doc-template-library${insertMode ? ' is-editor-insert' : ''}`
    root.setAttribute('role', 'dialog')
    root.setAttribute('aria-modal', 'true')
    root.setAttribute('aria-label', '模板库')
    root.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      event.preventDefault()
      requestClose()
    })

    const mask = document.createElement('div')
    mask.className = 'lark-doc-template-library-mask'
    mask.addEventListener('click', requestClose)

    const modal = document.createElement('div')
    modal.className = 'lark-doc-template-library-modal'

    const header = document.createElement('header')
    header.className = 'lark-doc-template-library-header'
    const target = document.createElement('p')
    target.className = 'lark-doc-template-target'
    const targetStrong = document.createElement('strong')
    if (insertMode) target.textContent = '模板库'
    else target.append('新建到 ', targetStrong)
    const searchWrap = document.createElement('div')
    searchWrap.className = 'lark-doc-template-search'
    const search = document.createElement('input')
    search.type = 'search'
    search.placeholder = '搜索模板'
    search.setAttribute('aria-label', '搜索模板')
    search.addEventListener('input', (event) => {
      if (destroyed || !state.open) return
      state = { ...state, keyword: event.target.value }
      render()
      callHandler(handlers, 'onSearch', state.keyword)
    })
    searchWrap.appendChild(search)

    const headerRight = document.createElement('div')
    headerRight.className = 'lark-doc-template-header-right'
    const type = document.createElement('span')
    type.className = 'lark-doc-template-type'
    type.textContent = '所有类型'
    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'lark-doc-template-close'
    close.setAttribute('aria-label', '关闭模板库')
    close.textContent = '×'
    close.addEventListener('click', requestClose)
    headerRight.append(type, close)
    header.append(target, searchWrap, headerRight)

    const body = document.createElement('div')
    body.className = 'lark-doc-template-library-body'
    const nav = document.createElement('nav')
    nav.className = 'lark-doc-template-categories'
    nav.setAttribute('role', 'tablist')
    nav.setAttribute('aria-label', '模板分类')
    const scroll = document.createElement('div')
    scroll.className = 'lark-doc-template-scroll'
    const grid = document.createElement('div')
    grid.className = 'lark-doc-template-grid'
    const empty = document.createElement('p')
    empty.className = 'lark-doc-template-empty'
    empty.textContent = '没有匹配的模板'
    body.append(nav, scroll)
    modal.append(header, body)
    root.append(mask, modal)
    const previewPanel = document.createElement('section')
    previewPanel.className = 'lark-doc-template-document-preview'
    previewPanel.setAttribute('aria-label', '模板正文预览')
    const previewHead = document.createElement('header')
    const previewTitle = document.createElement('strong')
    const previewClose = document.createElement('button')
    previewClose.type = 'button'
    previewClose.className = 'lark-doc-template-close'
    previewClose.setAttribute('aria-label', '关闭模板预览')
    previewClose.textContent = '×'
    previewClose.addEventListener('click', requestClose)
    previewHead.append(previewTitle, previewClose)
    const previewFoot = document.createElement('footer')
    const previewPrevious = document.createElement('button')
    previewPrevious.type = 'button'
    previewPrevious.textContent = '上一个'
    previewPrevious.addEventListener('click', () => { const next = adjacentPreview(-1); if (next) showPreview(next) })
    const previewNext = document.createElement('button')
    previewNext.type = 'button'
    previewNext.textContent = '下一个'
    previewNext.addEventListener('click', () => { const next = adjacentPreview(1); if (next) showPreview(next) })
    const previewInsert = document.createElement('button')
    previewInsert.type = 'button'
    previewInsert.className = 'lark-doc-template-use'
    previewInsert.textContent = '插入'
    previewInsert.addEventListener('click', () => { if (previewTemplate) useTemplate(previewTemplate) })
    previewFoot.append(previewPrevious, previewNext, previewInsert)
    const previewBody = document.createElement('div')
    previewBody.className = 'lark-doc-template-preview-body'
    previewPanel.append(previewHead, previewBody, previewFoot)
    refs = { targetStrong, search, nav, scroll, grid, empty, modal, header, body, previewPanel, previewTitle, previewClose, previewBody, previewPrevious, previewNext }
  }

  function createCategoryNode(category) {
    const node = document.createElement('button')
    node.type = 'button'
    node.setAttribute('role', 'tab')
    node.setAttribute('data-category-id', category.id)
    node.addEventListener('click', () => {
      if (destroyed || !state.open) return
      state = { ...state, activeCategory: category.id }
      render()
      callHandler(handlers, 'onCategory', category.id)
    })
    return node
  }

  function renderCategories() {
    const list = buildCategoryList(state.promoCategories || undefined)
    const signature = JSON.stringify(list)
    if (signature !== categorySignature) {
      categorySignature = signature
      list.forEach((category) => {
        if (!categories.has(category.id)) categories.set(category.id, createCategoryNode(category))
      })
      Array.from(categories.keys()).forEach((id) => {
        if (!list.some((category) => category.id === id)) categories.delete(id)
      })
    }
    list.forEach((category) => {
      const node = categories.get(category.id)
      setAttr(node, 'aria-selected', String(category.id === state.activeCategory))
      node.classList.toggle('is-active', category.id === state.activeCategory)
      setText(node, category.label)
    })
    syncChildren(refs.nav, list.map((category) => ({ node: categories.get(category.id), on: true })))
  }

  function createCardNode() {
    const card = document.createElement('article')
    card.className = 'lark-doc-template-card'
    card.tabIndex = 0
    const head = document.createElement('div')
    head.className = 'lark-doc-template-card-head'
    const icon = document.createElement('span')
    icon.className = 'lark-doc-template-card-icon'
    icon.setAttribute('aria-hidden', 'true')
    icon.textContent = '▤'
    const name = document.createElement('span')
    name.className = 'lark-doc-template-card-name'
    head.append(icon, name)
    const thumb = document.createElement('div')
    thumb.className = 'lark-doc-template-card-thumb'
    const image = document.createElement('img')
    image.alt = ''
    image.loading = 'lazy'
    thumb.appendChild(image)
    const foot = document.createElement('div')
    foot.className = 'lark-doc-template-card-foot'
    const meta = document.createElement('span')
    meta.className = 'lark-doc-template-card-meta'
    const actions = document.createElement('div')
    actions.className = 'lark-doc-template-card-actions'
    const preview = document.createElement('button')
    preview.type = 'button'
    preview.className = 'lark-doc-template-preview'
    preview.textContent = '预览'
    const use = document.createElement('button')
    use.type = 'button'
    use.className = 'lark-doc-template-use'
    use.textContent = insertMode ? '插入' : '使用'
    actions.append(preview, use)
    foot.append(meta, actions)
    card.append(head, thumb, foot)
    const entry = { card, name, image, thumb, meta, preview, use, template: null, html: undefined }
    preview.addEventListener('click', (event) => {
      event.stopPropagation()
      showPreview(entry.template)
    })
    use.addEventListener('click', (event) => {
      event.stopPropagation()
      useTemplate(entry.template)
    })
    card.addEventListener('keydown', event => {
      if (event.target !== card || event.key !== 'Enter' || event.isComposing) return
      event.preventDefault()
      if (!preview.disabled) showPreview(entry.template)
    })
    return entry
  }

  function renderCards() {
    const visible = searchTemplates(templatesOf(state.templates, state.activeCategory), state.keyword)
    visible.forEach((template) => {
      let entry = cards.get(template.id)
      if (!entry) {
        entry = createCardNode()
        cards.set(template.id, entry)
      }
      entry.template = template
      setAttr(entry.card, 'data-template-id', template.id)
      setText(entry.name, template.name)
      setText(entry.meta, template.meta)
      if (insertMode) {
        const source = state.templates.find(item => item.id === template.id)
        const available = typeof source?.html === 'string'
        entry.preview.disabled = !available
        entry.use.disabled = !available
        entry.preview.title = entry.use.title = source?.unavailable || ''
        if (entry.html !== source?.html) {
          entry.html = source?.html
          entry.thumb.replaceChildren()
          if (available) {
            try { options.renderDocument(entry.thumb, template) }
            catch (_) { /* An unavailable thumbnail must not invent a document preview. */ }
          } else if (source?.unavailable) entry.thumb.textContent = source.unavailable
        }
      } else {
        setAttr(entry.image, 'src', template.thumb || null)
        syncChildren(entry.thumb, [{ node: entry.image, on: !!template.thumb }])
      }
    })
    const alive = new Set(visible.map((template) => template.id))
    Array.from(cards.keys()).forEach((id) => {
      if (!alive.has(id)) cards.delete(id)
    })
    syncChildren(refs.grid, visible.map((template) => ({ node: cards.get(template.id).card, on: true })))
    syncChildren(refs.scroll, [
      { node: refs.grid, on: visible.length > 0 },
      { node: refs.empty, on: visible.length === 0 },
    ])
  }

  function render() {
    if (destroyed) return
    if (!root) build()
    setText(refs.targetStrong, state.target)
    setInputValue(refs.search, state.keyword)
    const style = templateLibraryRootStyle(insertMode ? 'insert' : 'copy')
    Object.keys(style).forEach((key) => root.style.setProperty(key, style[key]))
    renderCategories()
    renderCards()
    if (insertMode && previewTemplate) {
      refs.previewPrevious.disabled = !adjacentPreview(-1)
      refs.previewNext.disabled = !adjacentPreview(1)
    }
    if (insertMode) syncChildren(refs.modal, [
      { node: refs.header, on: !previewTemplate }, { node: refs.body, on: !previewTemplate },
      { node: refs.previewPanel, on: !!previewTemplate },
    ])
    mountNode(host, root, !!state.open)
  }

  return {
    get el() { return root },
    update(patch = {}) {
      if (destroyed) return
      state = { ...state, ...patch }
      render()
    },
    open() { this.update({ open: true }) },
    close() { this.update({ open: false }) },
    focusSearch() { refs?.search.focus() },
    setKeyword(keyword) { this.update({ keyword }) },
    setCategory(categoryId) { this.update({ activeCategory: categoryId }) },
    destroy() {
      destroyed = true
      state.open = false
      if (root) mountNode(host, root, false)
      root = null
      refs = null
      categories.clear()
      cards.clear()
      previewTemplate = null
    },
  }
}
