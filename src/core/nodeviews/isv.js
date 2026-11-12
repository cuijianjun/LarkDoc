/**
 * 文档小组件块 NodeView —— 纯 DOM，core 零 UI 框架依赖（P4-04）。
 *
 * 规格来源 requirements/02 §22 ④-1（13 层壳链）④-5（目录导航内层）⑤-3（按钮落地形态）。
 *
 * 目录导航使用本地 `srcdoc` iframe 承载，模拟飞书 `web_offline` ISV 的边界；正文只保留
 * 壳和消息桥，标题跳转通过 `postMessage` 回到宿主。这样宿主页面不会把目录树节点混进
 * 正文 DOM，滚动也只由宿主负责。
 *
 * 工具条图标仍是通用 SVG，不是飞书字形。真飞书是 `FilterOutlined` /
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

function isScrollable(element) {
  if (!element || typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') return false
  const style = window.getComputedStyle(element)
  return /(auto|scroll|overlay)/.test(`${style.overflowY}${style.overflow}`) && element.scrollHeight > element.clientHeight + 1
}

function findScrollContainer(target, boundary) {
  let current = target && target.parentElement
  while (current && current !== boundary && current !== document.body && current !== document.documentElement) {
    if (isScrollable(current)) return current
    current = current.parentElement
  }
  return null
}

function fixedChromeBottom(root) {
  if (!root || typeof window === 'undefined') return 0
  let bottom = 0
  root.querySelectorAll('.lark-doc-topbar, .lark-doc-toolbar, .lark-doc-actions-host').forEach(element => {
    const position = window.getComputedStyle(element).position
    if (position !== 'fixed' && position !== 'sticky') return
    const rect = element.getBoundingClientRect()
    if (rect.bottom > 0 && rect.top < window.innerHeight) bottom = Math.max(bottom, rect.bottom)
  })
  return bottom
}

/**
 * Scroll a catalogue target inside the editor's own scroll context.
 *
 * `Element.scrollIntoView({ block: 'start' })` walks all scrollable ancestors and,
 * when the host has no dedicated editor scroller, moves the document root so the
 * heading sits at the browser's very top. Feishu keeps the document chrome stable
 * and only applies the smallest delta needed to reveal the heading. We mirror that
 * behavior for both an embedded scroller and the normal page-scroll fallback.
 */
function scrollCatalogTarget(target, root) {
  if (!target || typeof window === 'undefined') return false
  const container = findScrollContainer(target, root)
  // 飞书目录点击完成后立即把目标放入可视区；保留页面滚动上下文的
  // nearest 计算，但不要让一个长距离 smooth 动画把整页留在中途状态。
  const behavior = 'auto'
  if (container) {
    const targetRect = target.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()
    const topInset = 8
    const bottomInset = 8
    let delta = 0
    if (targetRect.top < containerRect.top + topInset) delta = targetRect.top - (containerRect.top + topInset)
    else if (targetRect.bottom > containerRect.bottom - bottomInset) delta = targetRect.bottom - (containerRect.bottom - bottomInset)
    if (Math.abs(delta) < 1) return true
    const next = Math.max(0, Math.min(container.scrollHeight - container.clientHeight, container.scrollTop + delta))
    if (typeof container.scrollTo === 'function') container.scrollTo({ top: next, behavior })
    else container.scrollTop = next
    return true
  }
  const rect = target.getBoundingClientRect()
  const top = Math.max(8, fixedChromeBottom(root) + 8)
  const bottom = window.innerHeight - 8
  let delta = 0
  if (rect.top < top) delta = rect.top - top
  else if (rect.bottom > bottom) delta = rect.bottom - bottom
  if (Math.abs(delta) < 1) return true
  const scrolling = document.scrollingElement || document.documentElement
  const next = Math.max(0, Math.min(scrolling.scrollHeight - window.innerHeight, (window.scrollY || scrolling.scrollTop || 0) + delta))
  if (typeof window.scrollTo === 'function') window.scrollTo({ top: next, behavior })
  else scrolling.scrollTop = next
  return true
}

/** 目录层级的扁平 → 真嵌套 `ul>li>ul>li`（④-5：父 item 高度 = 32 + 后代之和）。 */
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function catalogTreeHtml(nodes) {
  const list = (nodes || []).map(entry => {
    const indent = catalogIndent(entry.level)
    const weight = catalogFontWeight(entry.level)
    const children = entry.children && entry.children.length ? catalogTreeHtml(entry.children) : ''
    return `<li class="catalog-item catalog_level_${Number(entry.level) || 1}">`
      + `<button class="catalog-text" type="button" data-catalog-pos="${Number(entry.pos)}" style="padding-left:${indent}px;padding-right:${CATALOG_PADDING_RIGHT}px;font-weight:${weight}">`
      + `<span>${escapeHtml(entry.text)}</span><span class="delete-icon-container" aria-hidden="true"></span></button>${children}</li>`
  }).join('')
  return `<ul class="catalog-list">${list}</ul>`
}

function catalogFrameHtml(nodes) {
  const tree = catalogTreeHtml(nodes)
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    :root{color-scheme:light}*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden}
    body{background:#f5f6f7;color:#1f2329;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;font-size:14px;line-height:22px}
    .catalog-container{position:relative;width:100%;height:100%;padding:25px 26px 20px;border-radius:8px;background:#f5f6f7;overflow:auto}
    .top-tool-container{position:absolute;top:8px;right:10px;display:flex;width:96px;height:24px;align-items:center;justify-content:space-between;color:#646a73}
    .catalog-tool-icon,.switch-view{display:inline-flex;align-items:center;justify-content:center;color:#646a73;cursor:pointer}
    .catalog-tool-icon{width:24px;height:24px}.switch-view{width:40px;height:24px;gap:2px}.catalog-tool-icon.is-disabled{color:#bbbfc4;cursor:default}
    .catalog-list{margin:0;padding:0;list-style:none}.catalog-item{width:100%;min-height:32px;border-radius:6px}
    .catalog-item>ul{margin:0;padding:0;list-style:none}.catalog-text{display:flex;width:100%;height:30px;align-items:center;justify-content:space-between;padding-top:4px;padding-bottom:4px;border:0;border-radius:6px;background:transparent;color:#1f2329;font:inherit;line-height:22px;text-align:left;cursor:pointer}
    .catalog-text:hover{background:rgba(31,35,41,.08)}.delete-icon-container{display:none;width:20px;height:18px}
    .catalog-text:hover .delete-icon-container{display:block}
    svg{display:block;flex:none}
  </style></head><body><div class="catalog-container">
    <div class="top-tool-container"><span class="catalog-tool-icon" role="button" aria-label="筛选"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16l-6.2 7.4V19l-3.6-2v-4.6z"/></svg></span>
      <span class="switch-view" role="button" aria-label="切换视图"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h10"/></svg><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 8 7 7 7-7"/></svg></span>
      <span class="catalog-tool-icon is-disabled" role="button" aria-label="重置" aria-disabled="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-3.2-6.4M20 4v5h-5"/></svg></span>
    </div>${tree}</div><script>
      document.addEventListener('click', function(event){var target=event.target.closest && event.target.closest('[data-catalog-pos]');if(!target)return;parent.postMessage({type:'lark-doc-catalog-jump',pos:Number(target.getAttribute('data-catalog-pos'))},'*')})
    </script></body></html>`
}

export function createIsvNodeView(props) {
  const { node, editor, extension } = props
  const options = (extension && extension.options) || {}
  const runtimeOptions = () => (typeof options.getRuntimeOptions === 'function' ? options.getRuntimeOptions() : options) || {}

  let currentNode = node
  let lastDoc = (editor && editor.state && editor.state.doc) || null
  let catalogFrame = null
  let catalogMessageHandler = null
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
    span.setAttribute('role', 'button')
    span.tabIndex = 0
    /* 底色空 = 走 CSS 的浅蓝默认（`--ld-bg-selected` #E0E9FF，⑤-3 真机实测值）；
       有值才写 inline（用户内容色）。空值别补成色板默认格 #E1EAFF，见 isvMixin 的说明。 */
    if (view.buttonColor) span.style.backgroundColor = view.buttonColor
    const activate = () => {
      if (view.action !== 'open_link') {
        // 另两个动作（创建副本 / 关注文档更新）需要宿主能力，core 不自己发明 ——
        // 有回调就交给宿主，没有就静默（真机采到的是「点了没反应」，⑤-2 未采行为）。
        const callbacks = runtimeOptions()
        if (typeof callbacks.onButtonAction === 'function') callbacks.onButtonAction(view.action, view)
        return
      }
      if (!view.linkUrl) return
      if (typeof window !== 'undefined' && typeof window.open === 'function') {
        window.open(view.linkUrl, '_blank', 'noopener,noreferrer')
      }
    }
    span.addEventListener('click', activate)
    span.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); activate() }
    })
    return span
  }

  /** 目录导航（④-5）：灰底容器 + 工具条 + 真嵌套树；空态只留容器与工具条。 */
  function buildCatalog() {
    if (catalogMessageHandler) window.removeEventListener('message', catalogMessageHandler)
    catalogMessageHandler = null
    catalogFrame = null
    const wrap = el('div', 'wrap-catalog-container light-catalog-container')
    const items = outlineItems()
    const frame = markUi(el('iframe', 'isv-catalog-iframe', {
      title: '目录导航',
      sandbox: 'allow-scripts',
      scrolling: 'no',
    }))
    frame.setAttribute('frameborder', '0')
    frame.setAttribute('aria-label', '目录导航')
    frame.style.display = 'block'
    frame.style.width = '100%'
    frame.style.height = '100%'
    frame.style.border = '0'
    frame.srcdoc = catalogFrameHtml(buildCatalogTree(items))
    catalogFrame = frame
    catalogMessageHandler = event => {
      if (!catalogFrame || event.source !== catalogFrame.contentWindow) return
      const data = event.data || {}
      if (data.type !== 'lark-doc-catalog-jump') return
      jumpTo(data.pos)
    }
    window.addEventListener('message', catalogMessageHandler)
    wrap.appendChild(frame)
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
    const callbacks = runtimeOptions()
    if (typeof callbacks.onCatalogJump === 'function') { callbacks.onCatalogJump(pos); return }
    try {
      const clamped = Math.min(Math.max(pos, 0), editor.state.doc.content.size)
      let target = typeof editor.view.nodeDOM === 'function' ? editor.view.nodeDOM(clamped) : null
      if (!target) {
        const found = editor.view.domAtPos(clamped)
        target = found && found.node
      }
      if (target && target.nodeType === 3) target = target.parentNode
      const heading = target && typeof target.closest === 'function'
        ? target.closest('[data-type="heading"], h1, h2, h3, h4, h5, h6')
        : null
      scrollCatalogTarget(heading || target, dom.closest('.lark-doc') || dom)
    } catch (_) { /* 位置在协同下可能被别人删了，跳不动就保持原样 */ }
  }

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
    destroy() {
      if (catalogMessageHandler) window.removeEventListener('message', catalogMessageHandler)
      catalogMessageHandler = null
      catalogFrame = null
    },
    // 测试与宿主联调通道。
    kind() { return readIsv(attrs()) ? readIsv(attrs()).kind : null },
    height() { return dom.style.getPropertyValue('--lark-doc-isv-height') },
  }
}

export default createIsvNodeView
