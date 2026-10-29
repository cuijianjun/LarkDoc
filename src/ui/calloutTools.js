/**
 * CalloutTools 原生 DOM 积木（阶段 5-G）。
 *
 * 结构契约复刻 editor/CalloutTools.vue：工具条与 emoji picker 共用一个根节点，
 * visible / emojiOpen 都是真挂载语义；业务状态与 ProseMirror 操作由 mixin 负责。
 */
import { applyStyle, mountNode, setAttr, syncChildren } from './dom'

const SEP = '\u0001'

function button(label, title, onClick) {
  const node = document.createElement('button')
  node.type = 'button'
  node.setAttribute('aria-label', label)
  if (title) node.title = title
  node.textContent = title === label ? '↻' : label
  node.addEventListener('mousedown', (event) => event.preventDefault())
  node.addEventListener('click', onClick)
  return node
}

function colorLabel(title, glyph, target, onOpen, onInput) {
  const label = document.createElement('label')
  label.title = title
  label.setAttribute('aria-haspopup', 'menu')
  label.addEventListener('mousedown', (event) => event.preventDefault())
  label.addEventListener('click', (event) => {
    event.preventDefault()
    onOpen(target, event)
  })
  const span = document.createElement('span')
  span.setAttribute('aria-hidden', 'true')
  span.textContent = glyph
  const input = document.createElement('input')
  input.type = 'color'
  input.setAttribute('aria-label', title)
  input.addEventListener('input', () => onInput(input.value))
  label.append(span, input)
  label.__ldInput = input
  return label
}

function createPicker(handlers) {
  const picker = document.createElement('div')
  picker.className = 'lark-doc-callout-emoji-picker'
  picker.setAttribute('role', 'menu')
  picker.setAttribute('aria-label', '高亮块图标')
  picker.addEventListener('mousedown', (event) => event.preventDefault())

  const head = document.createElement('div')
  head.className = 'lark-doc-callout-emoji-head'
  const searchLabel = document.createElement('label')
  searchLabel.className = 'lark-doc-callout-emoji-search'
  const sr = document.createElement('span')
  sr.className = 'sr-only'
  sr.textContent = '搜索表情'
  const search = document.createElement('input')
  search.type = 'search'
  search.setAttribute('aria-label', '搜索高亮块图标')
  search.placeholder = '搜索表情名称'
  search.addEventListener('input', () => handlers.onQuery(search.value))
  searchLabel.append(sr, search)
  const random = button('随机高亮块图标', '随机高亮块图标', () => handlers.onRandom())
  random.className = 'lark-doc-callout-emoji-random'
  head.append(searchLabel, random)

  const tabs = document.createElement('div')
  tabs.className = 'lark-doc-callout-emoji-tabs'
  tabs.setAttribute('role', 'tablist')
  tabs.setAttribute('aria-label', '高亮块图标分类')
  const grid = document.createElement('div')
  grid.className = 'lark-doc-callout-emoji-grid'
  grid.setAttribute('role', 'group')
  grid.setAttribute('aria-label', '表情列表')
  picker.append(head, tabs, grid)
  picker.__ld = { search, tabs, grid, tabNodes: [], itemNodes: [], tabSig: '', itemSig: '' }
  return picker
}

export function createCalloutTools({ host, handlers = {} } = {}) {
  const root = document.createElement('div')
  root.className = 'lark-doc-callout-tools'
  root.setAttribute('role', 'toolbar')
  root.setAttribute('aria-label', '高亮块工具')
  root.addEventListener('mousedown', (event) => event.preventDefault())

  const labels = [
    colorLabel('高亮块文字颜色', 'A', 'calloutColor', handlers.onPalette, (value) => handlers.onColor && handlers.onColor('color', value)),
    colorLabel('高亮块背景颜色', '◉', 'calloutBackground', handlers.onPalette, (value) => handlers.onColor && handlers.onColor('backgroundColor', value)),
    colorLabel('高亮块边框颜色', '▔', 'calloutBorder', handlers.onPalette, (value) => handlers.onColor && handlers.onColor('borderColor', value)),
  ]
  const emojiButton = button('更换高亮块图标', '', () => handlers.onToggleEmoji && handlers.onToggleEmoji())
  emojiButton.textContent = '☺'
  const reset = button('恢复高亮块默认样式', '', () => handlers.onReset && handlers.onReset())
  reset.textContent = '↺'
  const remove = button('删除高亮块', '', () => handlers.onDelete && handlers.onDelete())
  remove.textContent = '⌫'
  root.append(...labels, emojiButton, reset, remove)

  const picker = createPicker(handlers)
  const state = { visible: false, emojiOpen: false, placement: 'below', query: '', category: 'all', categories: [], items: [] }

  function updateTabs(next) {
    const categories = ['recent', 'all', ...(next.categories || [])]
    const signature = categories.join(SEP)
    const data = picker.__ld
    if (signature !== data.tabSig) {
      data.tabSig = signature
      data.tabNodes = categories.map((category) => {
        const tab = document.createElement('button')
        tab.type = 'button'
        tab.role = 'tab'
        tab.setAttribute('aria-label', category === 'recent' ? '最近使用' : category === 'all' ? '全部' : category)
        tab.textContent = category === 'recent' ? '最近' : category === 'all' ? '全部' : category
        tab.addEventListener('mousedown', (event) => event.preventDefault())
        tab.addEventListener('click', () => handlers.onCategory && handlers.onCategory(category))
        return tab
      })
    }
    data.tabNodes.forEach((tab, index) => setAttr(tab, 'aria-selected', categories[index] === next.category ? 'true' : 'false'))
    syncChildren(data.tabs, data.tabNodes.map((node) => ({ node, on: true })))
  }

  function updateItems(next) {
    const items = next.items || []
    const signature = items.map((item) => `${item.value}:${item.glyph}:${item.label}`).join(SEP)
    const data = picker.__ld
    if (signature !== data.itemSig) {
      data.itemSig = signature
      data.itemNodes = items.map((item) => {
        const node = document.createElement('button')
        node.type = 'button'
        node.setAttribute('role', 'menuitem')
        node.addEventListener('mousedown', (event) => event.preventDefault())
        node.addEventListener('click', () => handlers.onEmoji && handlers.onEmoji(item.glyph))
        const span = document.createElement('span')
        span.className = 'lark-doc-callout-emoji-item'
        span.setAttribute('aria-hidden', 'true')
        span.textContent = item.glyph
        node.appendChild(span)
        node.__ldItem = item
        return node
      })
    }
    data.itemNodes.forEach((node) => {
      const item = node.__ldItem
      setAttr(node, 'aria-label', item.label)
      setAttr(node, 'title', item.label)
    })
    if (!items.length) {
      const empty = document.createElement('p')
      empty.className = 'lark-doc-callout-emoji-empty'
      empty.textContent = next.query ? '没有匹配的表情' : '暂无最近使用'
      data.grid.replaceChildren(empty)
    } else {
      syncChildren(data.grid, data.itemNodes.map((node) => ({ node, on: true })))
    }
  }

  function paint(next) {
    applyStyle(root, next.style)
    labels[0].__ldInput.value = next.color || '#000000'
    labels[1].__ldInput.value = next.backgroundColor || '#ffffff'
    labels[2].__ldInput.value = next.borderColor || '#000000'
    setAttr(picker, 'class', `lark-doc-callout-emoji-picker${next.placement === 'above' ? ' is-above' : ''}`)
    if (picker.__ld.search.value !== (next.query || '')) picker.__ld.search.value = next.query || ''
    updateTabs(next)
    updateItems(next)
  }

  return {
    el: root,
    update(next = {}) {
      Object.assign(state, next)
      paint(state)
      mountNode(host, root, !!state.visible)
      mountNode(root, picker, !!state.emojiOpen)
    },
    destroy() {
      if (root.parentNode) root.parentNode.removeChild(root)
    },
  }
}
