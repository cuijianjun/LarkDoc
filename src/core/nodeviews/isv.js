/**
 * 文档小组件块 NodeView —— 纯 DOM，core 零 UI 框架依赖（P4-04）。
 *
 * 规格来源 requirements/02 §22 ④-1（13 层壳链）④-5（目录导航内层）⑤-3（按钮落地形态）。
 *
 * 两处「与真机不同」的取巧，都在代码里标了原因，不是随手写的：
 *
 *  1. **目录导航不进 iframe**。真机跑在 `lf-fb.feishupkg.com` 的 `web_offline` 里，
 *     V1 无外网、CDN 不可达，所以按 ④-5 的实测几何在宿主 DOM 复刻（`ul>li>ul>li`
 *     真嵌套 —— 因为「父 item 高度 = 32 + 后代之和」，扁平画不出来这个高度关系）。
 *     ② 的 CRUD 与 ④-5 的空态（容器 + 工具条全在，不加提示文案）都按实测原样。
 *  2. **工具条图标是通用 SVG，不是飞书字形**。真飞书是 `FilterOutlined` /
 *     `ContentOutlined` / `DownBoldOutlined` / `ResetOutlined`，path 未取到实测值，
 *     这里先给同义的通用形状（尺寸 / 颜色 / 禁用态按实测），见交接清单待替换。
 *
 * 壳链**按 ④-1 原样建齐 13 层**（含 `.isv-block-layout.isv-block-layout` 这类类名重复
 * 两遍的原样照抄）—— 空壳 div 看着多余，但将来接真实 iframe 时每一层都有宿主在挂东西。
 */
import { collectOutline } from '../documentOperations'
import {
  ISV_KINDS, ISV_DEFAULT_HEIGHT, ISV_BUTTON_HEIGHT, BUTTON_TEXT_DEFAULT,
  CATALOG_PADDING_RIGHT, catalogIndent, catalogFontWeight,
  readIsv, buildCatalogTree,
} from '../embed/isv'

/** 标记「属于 NodeView 自己的交互元素」：事件停在这里，不进 ProseMirror。 */
const UI_ATTR = 'data-lark-doc-isv-ui'

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

/**
 * 工具条四个图标（24×24，stroke 用 `currentColor` —— 颜色交给 CSS，
 * core 里不落任何字面色值，06 §「UI 皮肤色收进 CSS 变量」）。
 */
const ICONS = {
  filter: '<path d="M4 5h16l-6.2 7.4V19l-3.6-2v-4.6z" />',
  content: '<path d="M4 6h16M4 12h16M4 18h10" />',
  down: '<path d="M5 8l7 7 7-7" />',
  reset: '<path d="M20 12a8 8 0 11-3.2-6.4M20 4v5h-5" />',
}

function icon(name, size) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('width', String(size))
  svg.setAttribute('height', String(size))
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '2')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', ICONS[name] || '')
  svg.appendChild(path)
  return svg
}

/** 目录层级的扁平 → 真嵌套 `ul>li>ul>li`（④-5：父 item 高度 = 32 + 后代之和）。 */
function buildCatalogNodes(nodes, host) {
  const list = el('ul', 'catalog-list')
  ;(nodes || []).forEach((entry) => {
    const item = el('li', `catalog-item catalog_level_${entry.level}`)
    const text = markUi(el('div', 'catalog-text'))
    text.style.paddingLeft = `${catalogIndent(entry.level)}px`
    text.style.paddingRight = `${CATALOG_PADDING_RIGHT}px`
    text.style.fontWeight = String(catalogFontWeight(entry.level))
    text.textContent = entry.text
    if (typeof entry.pos === 'number') text.setAttribute('data-catalog-pos', String(entry.pos))
    // 20×18 删除钮：默认 `display:none`，hover 才显形（④-5）。图标不绑行为 —— 真机
    // 采到的也是「未采」，V1 就让它只出现、点了没反应，别自己发明删除语义。
    const remove = el('span', 'delete-icon-container', { 'aria-hidden': 'true' })
    item.appendChild(text)
    item.appendChild(remove)
    if (entry.children && entry.children.length) buildCatalogNodes(entry.children, item)
    list.appendChild(item)
  })
  host.appendChild(list)
  return host
}

export function createIsvNodeView(props) {
  const { node, editor, extension } = props
  const options = (extension && extension.options) || {}

  let currentNode = node
  let lastDoc = (editor && editor.state && editor.state.doc) || null
  const attrs = () => currentNode.attrs || {}

  /* ---------- 13 层壳（④-1） ---------- */
  const dom = el('div', 'block docx-isv-block', {
    'data-type': 'isv', 'data-block-type': 'isv', contenteditable: 'false',
  })
  // ③ 常驻包裹层：不是「加载中才有的临时节点」，加载完也不撤。
  const loading = markUi(el('div', 'docx-block-loading-container'))
  const shellA = el('div')
  const comment = el('div', 'block-comment isv-block-comment local-comment-all-third-party')
  // 宿主侧不可编辑：小组件内部由第三方接管，宿主光标不许进去。
  const contentBox = markUi(el('div', 'block-content-container', { contenteditable: 'false' }))
  const alignable = el('div', 'isv-alignable-container left')
  const container = el('div', 'isv-container')
  const resizable = el('div', 'resizable-wrapper')
  const shellB = el('div')
  const layout = el('div', 'isv-block-layout isv-block-layout')
  const blockContainer = el('div', 'isv-block-container')
  const body = el('div', 'isv-block-body')
  blockContainer.appendChild(body)
  layout.appendChild(blockContainer)
  shellB.appendChild(layout)
  resizable.appendChild(shellB)
  container.appendChild(resizable)
  alignable.appendChild(container)
  contentBox.appendChild(alignable)
  comment.appendChild(contentBox)
  shellA.appendChild(comment)
  loading.appendChild(shellA)
  dom.appendChild(loading)
  // 0×29 的空占位（④-1 第 2 层）：飞书用它撑出块后的换行选区，删了会点不到块尾。
  dom.appendChild(el('div', 'docx-block-zero-space'))

  /* ---------- 内层：按 kind 分叉 ---------- */

  function clearChildren(element) {
    while (element.firstChild) element.removeChild(element.firstChild)
  }

  /** 按钮（⑤-3 实测 2026-10-25 人工 E2 复核：真机是宿主 span，不是 iframe）。 */
  function buildButton(view) {
    const span = markUi(el('span', 'docx-button-component light-blue embed-text-container hoverable'))
    span.textContent = view.buttonText || BUTTON_TEXT_DEFAULT
    /* 底色空 = 走 CSS 的浅蓝默认（`--ld-bg-selected` #E0E9FF，⑤-3 真机实测值）；
       有值才写 inline（用户内容色）。空值别补成色板默认格 #E1EAFF，见 isvMixin 的说明。 */
    if (view.buttonColor) span.style.backgroundColor = view.buttonColor
    span.addEventListener('click', () => {
      if (view.action !== 'open_link') {
        // 另两个动作（创建副本 / 关注文档更新）需要宿主能力，core 不自己发明 ——
        // 有回调就交给宿主，没有就静默（真机采到的是「点了没反应」，⑤-2 未采行为）。
        if (typeof options.onButtonAction === 'function') options.onButtonAction(view.action, view)
        return
      }
      if (!view.linkUrl) return
      if (typeof window !== 'undefined' && typeof window.open === 'function') {
        window.open(view.linkUrl, '_blank', 'noopener,noreferrer')
      }
    })
    return span
  }

  /** 目录导航（④-5）：灰底容器 + 工具条 + 真嵌套树；空态只留容器与工具条。 */
  function buildCatalog() {
    const wrap = el('div', 'wrap-catalog-container light-catalog-container')
    const box = el('div', 'catalog-container')
    const tools = markUi(el('div', 'top-tool-container'))
    const filter = markUi(el('span', 'catalog-tool-icon', { role: 'button', 'aria-label': '筛选' }))
    filter.appendChild(icon('filter', 24))
    const switchView = markUi(el('span', 'switch-view', { role: 'button', 'aria-label': '切换视图' }))
    switchView.appendChild(icon('content', 16))
    switchView.appendChild(icon('down', 9))
    // 「重置」在空态/初始态就是禁用灰（`rgb(187,191,196)` = `--ld-text-disabled`），
    // 实测不是 hover 才变 —— 别做成交互态。
    const reset = markUi(el('span', 'catalog-tool-icon is-disabled', { role: 'button', 'aria-label': '重置', 'aria-disabled': 'true' }))
    reset.appendChild(icon('reset', 24))
    tools.appendChild(filter)
    tools.appendChild(switchView)
    tools.appendChild(reset)
    box.appendChild(tools)

    const items = outlineItems()
    if (items.length) buildCatalogNodes(buildCatalogTree(items), box)
    wrap.appendChild(box)
    return wrap
  }

  /** 大纲条目。目录块自己不是标题，不会被算进去（`collectOutline` 只收 heading）。 */
  function outlineItems() {
    if (!editor || !editor.state || !editor.state.doc) return []
    try { return collectOutline(editor.state.doc) || [] } catch (_) { return [] }
  }

  function jumpTo(raw) {
    const pos = Number(raw)
    if (!Number.isFinite(pos) || !editor || !editor.view) return
    if (typeof options.onCatalogJump === 'function') { options.onCatalogJump(pos); return }
    try {
      const found = editor.view.domAtPos(Math.min(Math.max(pos, 0), editor.state.doc.content.size))
      let target = found && found.node
      if (target && target.nodeType === 3) target = target.parentNode
      if (target && typeof target.scrollIntoView === 'function') {
        target.scrollIntoView({ block: 'start', behavior: 'smooth' })
      }
    } catch (_) { /* 位置在协同下可能被别人删了，跳不动就保持原样 */ }
  }

  /** 点击 .catalog-text 真跳转（④-5 实测 scrollTop 2000→5696）；不高亮当前标题。 */
  dom.addEventListener('click', (event) => {
    const target = event && event.target
    if (!target || typeof target.closest !== 'function') return
    const text = target.closest('.catalog-text')
    if (text) jumpTo(text.getAttribute('data-catalog-pos'))
  })

  const RENDER_KEYS = ['kind', 'instanceId', 'appId', 'align', 'height', 'buttonText', 'buttonColor', 'action', 'linkUrl']

  function syncAll() {
    const view = readIsv(attrs())
    dom.setAttribute('data-isv-state', view ? view.kind : 'missing')
    if (!view) {
      // 没有实例键（② 接口的必填项缺失）：画「数据缺失」而不是一个假组件 ——
      // 同 calendar_event 的口径，别让用户以为小组件加载失败了。
      clearChildren(body)
      const empty = el('div', 'isv-missing')
      empty.textContent = '小组件数据缺失'
      body.appendChild(empty)
      return
    }
    dom.setAttribute('data-isv-kind', view.kind)
    alignable.className = `isv-alignable-container ${view.align}`
    const height = view.kind === ISV_KINDS.button
      ? (Number(view.height) || ISV_BUTTON_HEIGHT)
      : (Number(view.height) || ISV_DEFAULT_HEIGHT)
    dom.style.setProperty('--lark-doc-isv-height', `${height}px`)

    clearChildren(body)
    if (view.kind === ISV_KINDS.button) body.appendChild(buildButton(view))
    else body.appendChild(buildCatalog())
  }

  syncAll()

  return {
    dom,
    update(nextNode) {
      if (!nextNode || !nextNode.type || nextNode.type.name !== currentNode.type.name) return false
      let changed = false
      for (const key of RENDER_KEYS) {
        if (attrs()[key] !== (nextNode.attrs || {})[key]) { changed = true; break }
      }
      currentNode = nextNode
      const doc = (editor && editor.state && editor.state.doc) || null
      // 目录树是「文档的派生视图」：正文标题改了块要跟着重画，光比 attrs 不够。
      const docChanged = doc !== lastDoc
      lastDoc = doc
      if (changed || docChanged || readIsv(attrs()) === null) syncAll()
      return true
    },
    selectNode() { dom.classList.add('is-selected') },
    deselectNode() { dom.classList.remove('is-selected') },
    /** 按钮点击、工具条、目录项跳转都停在这里，不进 ProseMirror。 */
    stopEvent(event) {
      const target = event && event.target
      return Boolean(target && typeof target.closest === 'function' && target.closest(`[${UI_ATTR}]`))
    },
    ignoreMutation() { return true },
    destroy() {},
    // 测试与宿主联调通道。
    kind() { return readIsv(attrs()) ? readIsv(attrs()).kind : null },
    height() { return dom.style.getPropertyValue('--lark-doc-isv-height') },
  }
}

export default createIsvNodeView
