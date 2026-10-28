/**
 * 电子表格块 NodeView（P5-02）—— 纯 DOM，core 零 UI 框架依赖。
 * 规格：requirements/02 §25 ②（19 层 DOM 链）/ ④（像素直方图）/ ⑤（V1 三条指令）。
 *
 * 四条设计要点：
 *
 *   1. **DOM 先来自 `renderHTML`**（`DOMSerializer.fromSchema().serializeNode`），拿到的是
 *      那张**静态表** —— 也就是导出产物本身。然后往同一个根节点里追加 canvas / 滚动条 /
 *      手柄，并给根打上 `data-sheet-view="canvas"`。CSS 只在带这个属性时隐藏静态表，
 *      于是：编辑器里看 canvas，导出（走 `renderHTML`，不带该属性）看静态表。
 *      两边同源于 `staticRows()`，不会出现「编辑器有数、导出一片白」。
 *   2. **canvas 是唯一绘制层**（§25 ④）。块内**只有这一个** canvas —— 静态表里没有任何
 *      canvas，所以 `querySelector('canvas')` 不会取错（§25 ④ 特意警告过飞书那边有两个）。
 *   3. **颜色全部走 token**：`--ld-sheet-*` 由 `lark-doc.css` 定义（真机实测值的唯一落点），
 *      这里用 `getComputedStyle` 读出来再交给 `paintSheet`。绘制层不认识 token 名，
 *      所以纯 Node 单测可以绕开这一步直接喂假色值（见 `test/unit/sheet.test.js`）。
 *   4. **不改数据**（§25 ⑤ 第 3 条）：滚轮 / 拖滑块只改本地 `offsetX`，不产生 transaction；
 *      没有隐藏 input、没有 IME、没有单元格选中态。写入数据的唯一入口是 `updateSheet` 命令。
 *
 * @typedef {{ cell: string, head: string, grid: string, text: string, headText: string, fontSize?: number }} SheetPalette
 */

import { DOMSerializer } from '@tiptap/pm/model'
import {
  SHEET_SCROLLBAR, SHEET_VIEWPORT, clampOffsetX, maxOffset, paintSheet, readSheet, scrollThumb,
} from '../blocks/sheet-render'

/**
 * token 名表：`paintSheet` 的 `palette` 键 → CSS 自定义属性。
 * 改这里的键等于改绘制契约，`sheet-render.js` 的 `paintSheet` 会一起失效，别各改各的。
 */
const THEME_VARIABLES = {
  cell: '--ld-sheet-cell',
  head: '--ld-sheet-head',
  grid: '--ld-sheet-grid',
  text: '--ld-sheet-text',
  headText: '--ld-sheet-head-text',
}

/** 字号单独走：token 里是 `12px`，`paintSheet` 要的是数字（它自己拼 `${n}px`）。 */
const FONT_SIZE_VARIABLE = '--ld-sheet-font-size'

/** 读一个 token 的已解析值；非浏览器环境或未定义时返回空串（同 `diagram.js` 的 `readThemeVariable`）。 */
function readThemeVariable(name, host) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return ''
  const scope = host || document.querySelector('.lark-doc') || document.documentElement
  if (!scope || typeof window.getComputedStyle !== 'function') return ''
  const value = window.getComputedStyle(scope).getPropertyValue(name)
  return value ? value.trim() : ''
}

/** 组装 palette：读不到的键留空，`paintSheet` 会跳过对应图层（不会画出黑块）。 */
function resolvePalette(host) {
  const palette = {}
  Object.keys(THEME_VARIABLES).forEach((key) => {
    const value = readThemeVariable(THEME_VARIABLES[key], host)
    if (value) palette[key] = value
  })
  const fontSize = Number.parseInt(readThemeVariable(FONT_SIZE_VARIABLE, host), 10)
  if (Number.isFinite(fontSize) && fontSize > 0) palette.fontSize = fontSize
  return palette
}

/** 元素创建的小帮手：NodeView 里到处是 `document.createElement` + 类名。 */
function createElement(tag, className) {
  const element = document.createElement(tag)
  if (className) element.className = className
  return element
}

export function createSheetNodeView(props) {
  const { node, extension, getPos } = props
  const options = (extension && extension.options) || {}

  let currentNode = node
  let serializer = null
  let destroyed = false
  /** 横向滚动偏移（本地状态，不进文档）。 */
  let offsetX = 0
  /** destroy 时要清掉的 document 级监听（拖拽期间才会挂）。 */
  let cleanups = []

  /** 序列化器只建一次：schema 在同一个 editor 生命周期里不变。 */
  function getSerializer() {
    if (!serializer) serializer = DOMSerializer.fromSchema(currentNode.type.schema)
    return serializer
  }

  /** 用节点自己的 `toDOM`（即 `renderHTML`）造元素 —— 与导出走的是同一条路。 */
  function renderElement() {
    const rendered = getSerializer().serializeNode(currentNode)
    return rendered && rendered.nodeType === 1 ? rendered : null
  }

  const currentSheet = () => readSheet((currentNode.attrs || {}).sheet)
  const blockId = () => (currentNode.attrs || {}).blockId || null

  const dom = renderElement() || createElement('div', 'lark-doc-sheet')

  /* ---------- canvas ---------- */

  const view = createElement('div', 'lark-doc-sheet-view')
  const canvas = createElement('canvas', 'lark-doc-sheet-canvas')
  const context = (() => {
    // devicePixelRatio 兜底 1：Node / jsdom 里没有这个属性，真机 2x 屏才有。
    const ratio = typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1
    canvas.width = Math.round(SHEET_VIEWPORT.width * ratio)
    canvas.height = Math.round(SHEET_VIEWPORT.height * ratio)
    canvas.style.width = `${SHEET_VIEWPORT.width}px`
    canvas.style.height = `${SHEET_VIEWPORT.height}px`
    if (typeof canvas.getContext !== 'function') return null
    const ctx = canvas.getContext('2d')
    // jsdom 的 `getContext` 直接返回 null（未装 canvas 包），绘制层靠判空跳过。
    if (ctx && typeof ctx.scale === 'function') ctx.scale(ratio, ratio)
    return ctx || null
  })()

  /* ---------- 横向滚动条（§25 ②：324 × 9，r 4.5） ---------- */

  const scroll = createElement('div', 'lark-doc-sheet-scroll')
  scroll.setAttribute('aria-hidden', 'true')
  const thumb = createElement('div', 'lark-doc-sheet-thumb')
  scroll.appendChild(thumb)

  /* ---------- 悬停手柄（§25 ⑤：42 × 26，块左上外侧） ---------- */

  const handle = createElement('div', 'lark-doc-sheet-handle')
  handle.setAttribute('role', 'button')
  handle.setAttribute('tabindex', '-1')
  handle.setAttribute('aria-label', '电子表格菜单')

  // CSS 只在带这个属性时隐藏静态表 —— 导出产物不带它，所以 PDF / DOCX 仍是表格。
  // 拿不到 2D 上下文（jsdom / 无 canvas 实现的环境）时**整套自绘壳都不挂**，连那个空的
  // `.lark-doc-sheet-view` 也不留：把静态表藏掉再画一块空白是最差的降级，宁可原样退回
  // `renderHTML` 那张真表格 —— 单测据此断言「无 ctx 时静态表可见」（见 sheet.test.js）。
  if (context) {
    view.appendChild(canvas)
    dom.appendChild(view)
    dom.setAttribute('data-sheet-view', 'canvas')
  }
  dom.appendChild(scroll)
  dom.appendChild(handle)

  /* ---------- 绘制 ---------- */

  function layoutScroll(sheet) {
    const box = sheet ? scrollThumb(sheet, offsetX) : { left: 0, width: SHEET_SCROLLBAR.width, visible: false }
    thumb.style.left = `${box.left}px`
    thumb.style.width = `${box.width}px`
    // 内容不超宽时整条藏掉（§25 ④ 直方图里没有滚动条像素，正说明首屏那份表是超宽的，
    // 3 列 × 105 + 24 = 339 < 344，但 8 列 = 864 —— 默认表一定超宽）。
    scroll.setAttribute('data-visible', box.visible ? 'true' : 'false')
  }

  function paint() {
    const sheet = currentSheet()
    if (context) {
      if (!sheet) {
        context.clearRect(0, 0, SHEET_VIEWPORT.width, SHEET_VIEWPORT.height)
      } else {
        // token 从自身所在的 `.lark-doc` 作用域读：Web Component 里 document 查不到它。
        const host = typeof dom.closest === 'function' ? dom.closest('.lark-doc') : null
        paintSheet(context, sheet, resolvePalette(host), { x: offsetX, y: 0 })
      }
    }
    layoutScroll(sheet)
  }

  /* ---------- 滚动（只改本地状态，不产生 transaction） ---------- */

  function applyOffset(value) {
    const sheet = currentSheet()
    if (!sheet) return
    const next = clampOffsetX(sheet, value)
    if (Math.abs(next - offsetX) < 0.5) return
    offsetX = next
    paint()
    if (typeof options.onScroll === 'function') {
      try { options.onScroll({ blockId: blockId(), offsetX }) } catch (_) {
        // 宿主回调抛错不该把编辑器带崩：滚动是纯展示增强。
      }
    }
  }

  function onScrollPointerDown(event) {
    if (destroyed || !event || event.button !== 0) return
    const sheet = currentSheet()
    if (!sheet) return
    const limit = maxOffset(sheet).x
    if (limit <= 0) return
    const thumbWidth = scrollThumb(sheet, offsetX).width
    const span = Math.max(1, SHEET_SCROLLBAR.width - thumbWidth)
    const box = typeof scroll.getBoundingClientRect === 'function' ? scroll.getBoundingClientRect() : null
    if (!box) return

    let base = offsetX
    // 点轨道（不是点滑块）= 把滑块中心挪到指针处，等价于飞书的「点一下跳一段」。
    if (event.target !== thumb) {
      const ratio = Math.min(1, Math.max(0, (event.clientX - box.left - thumbWidth / 2) / span))
      base = ratio * limit
      applyOffset(base)
    }
    const startX = event.clientX

    function onMove(moveEvent) {
      applyOffset(base + ((moveEvent.clientX - startX) / span) * limit)
    }
    function onUp() {
      if (typeof document.removeEventListener === 'function') {
        document.removeEventListener('pointermove', onMove)
        document.removeEventListener('pointerup', onUp)
      }
      cleanups = cleanups.filter((fn) => fn !== onUp)
    }
    if (typeof document.addEventListener === 'function') {
      document.addEventListener('pointermove', onMove)
      document.addEventListener('pointerup', onUp)
      cleanups.push(onUp)
    }
  }
  scroll.addEventListener('pointerdown', onScrollPointerDown)

  /* ---------- 悬停手柄：只转交，不自己开菜单 ---------- */

  function onHandleClick() {
    if (destroyed) return
    if (typeof options.onMenu !== 'function') return
    let pos = null
    if (typeof getPos === 'function') {
      try { pos = getPos() } catch (_) { pos = null }
    }
    try { options.onMenu({ blockId: blockId(), pos }) } catch (_) {
      // 同 onScroll：宿主是唯一执行方。
    }
  }
  handle.addEventListener('click', onHandleClick)

  paint()

  return {
    dom,

    update(nextNode) {
      if (destroyed) return false
      if (!nextNode || !nextNode.type || nextNode.type.name !== 'sheet') return false
      const previous = currentNode.attrs || {}
      const next = nextNode.attrs || {}
      // 只有 sheet 与 blockId 参与渲染；两者都没动就不必碰 DOM（属性对象可能是新的）。
      const unchanged = (previous.sheet || null) === (next.sheet || null)
        && (previous.blockId || null) === (next.blockId || null)
      currentNode = nextNode
      if (unchanged) return true
      // 数据变了直接重画 canvas，不必让 PM 重造整个 NodeView（canvas 的尺寸/上下文没变）。
      offsetX = clampOffsetX(readSheet(next.sheet) || { rows: 0, cols: 0 }, offsetX)
      paint()
      return true
    },

    /**
     * 只拦滚动条与手柄上的事件，不拦整块。
     *
     * 拦整块会让 `mousedown` 被吃掉，块就选不中了；而 canvas 上的点击必须留给 PM
     * （用户要能选中块、用方向键跳走）。标 `contenteditable="false"` 的阻断由
     * `dom` 自身负责，与这里无关。
     */
    stopEvent(event) {
      const target = event && event.target
      if (!target || typeof target.closest !== 'function') return false
      return Boolean(target.closest('.lark-doc-sheet-scroll') || target.closest('.lark-doc-sheet-handle'))
    },

    /** canvas 与滚动条都是自绘的，PM 看到的 DOM 变化全是噪音。 */
    ignoreMutation() { return true },

    // 选中态走 `is-selected`（file-block / web-embed / isv 同款），不用 PM 的
    // `ProseMirror-selectednode` —— 本仓库 CSS 只认前者。
    selectNode() { if (!destroyed) dom.classList.add('is-selected') },
    deselectNode() { if (!destroyed) dom.classList.remove('is-selected') },

    destroy() {
      destroyed = true
      cleanups.slice().forEach((fn) => fn())
      cleanups = []
      serializer = null
    },

    /* ---------- 测试与宿主联调通道 ---------- */

    sheet: currentSheet,
    /** 当前绘制上下文（jsdom 下为 null —— 测试据此判「没真 canvas」而不是断言画了什么）。 */
    context: () => context,
    canvas: () => canvas,
    offsetX: () => offsetX,
    /** 滑块几何 + 可见性；`visible: false` 表示内容不超宽、整条已藏。 */
    thumbBox() {
      const sheet = currentSheet()
      return sheet ? scrollThumb(sheet, offsetX) : null
    },
    /** 供测试直接驱动滚动（不依赖 pointer 事件在 jsdom 里的实现完整度）。 */
    scrollTo(value) { applyOffset(value) },
  }
}

export default createSheetNodeView
