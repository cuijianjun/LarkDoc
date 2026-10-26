/**
 * PDF 导出（P6b-04 导出线）。
 *
 * 规格出处：requirements/04 §4.6.7②「导出 PDF 设置」。飞书的 PDF 导出走的是**浏览器打印
 * 到 PDF**，不是自己排版生成 PDF —— 这条路能白拿浏览器的字体渲染、分页与矢量输出，
 * 且不需要在包里塞进一套排版引擎。本文件因此不做任何「生成 PDF」的事。
 *
 * 四类负结论（别实现）：
 *   1. **不引入 PDF 生成库**（jsPDF / pdf-lib 之类）：引入意味着要把富文本的排版在 canvas
 *      里重算一遍，字号、行高、CJK 换行、表格跨页全都要自己兜，和「1:1 复刻飞书」的排版
 *      目标正面冲突。打印方案里这些全部由浏览器负责。
 *   2. **不克隆 DOM 到隐藏 iframe**：打印时最省事的写法是整页塞进 iframe 再 print，但
 *      编辑器里有大量靠 JS 维持的状态（选区、虚拟滚动、节点视图），克隆出来的副本是
 *      「长得像但内容可能不完整」的另一份。就地在真实节点上加打印类，所见即所得。
 *   3. **不自己写样式**：所有 `@media print` 规则都在 src/styles/print.css 里，本文件只
 *      负责**打标记**（加/摘类名）——样式与逻辑分开，改排版不用动 JS。类名常量在本文件
 *      里集中定义，改名前先看 print.css 里的同名规则。
 *   4. **不做文件名 / 落盘**：打印是浏览器行为，文件名由用户在系统打印框里定；这里只
 *      临时改 `document.title`（部分浏览器的默认页眉取自它），走完立刻改回去。
 */

/**
 * 打印态类名。**改这里必须同步改 print.css**，两边是一对一的。
 * 用 `lark-doc-print-` 前缀避免与现有 `lark-doc-` 组件类打架。
 */
export const PRINT_CLASS = Object.freeze({
  /** 打印根：放宽编辑区的滚动约束，让内容自然铺开。 */
  root: 'lark-doc-print-root',
  /** body 上的全局打印态。 */
  body: 'lark-doc-printing',
  /** 不在打印内容链上的节点（侧边栏、工具栏等）。 */
  hidden: 'lark-doc-print-hidden',
  /** 表格 / 代码块 / 图片：别被拦腰截断。 */
  avoidBreak: 'lark-doc-print-avoid-break',
  /** 标题：别孤零零落在页尾。 */
  keepWithNext: 'lark-doc-print-keep-with-next',
})

/** 兜底清理时限：某些实现在用户点「取消」时根本不发 afterprint。 */
export const PRINT_CLEANUP_FALLBACK_MS = 60000

/** 打印根：优先用传入的元素，其次按 PRint 类找，最后退回编辑器根。 */
function resolveRoot(rootEl) {
  if (rootEl && typeof rootEl.querySelector === 'function') return rootEl
  if (typeof document === 'undefined') return null
  return document.querySelector(`.${PRINT_CLASS.root}`) || document.querySelector('.lark-doc-editor')
}

/** root 到 body 的祖先链。 */
function ancestorsOf(root) {
  const chain = []
  let node = root
  while (node && node.parentElement) {
    node = node.parentElement
    chain.push(node)
  }
  return chain
}

/**
 * 把「不在打印内容链上」的 body 直接子节点藏起来。
 *
 * 为什么必须运行时标记：CSS 写不出「body 下所有元素，除了 root 的祖先链」这种选择器，
 * 而 root 在 DOM 里的深度不固定。这里只打标记，真正的隐藏交给 print.css。
 */
function markOutsideNodes(root) {
  if (typeof document === 'undefined' || !document.body) return []
  const chain = ancestorsOf(root)
  const marked = []
  const kids = document.body.children
  for (let i = 0; i < kids.length; i += 1) {
    const kid = kids[i]
    if (kid === root || chain.indexOf(kid) !== -1) continue
    kid.classList.add(PRINT_CLASS.hidden)
    marked.push(kid)
  }
  return marked
}

/**
 * 打分页断点标记。
 *
 * `break-inside: avoid` 与 `break-after: avoid` 必须打在**具体的块**上：写在父容器上会让
 * 浏览器把整个文档当成一个不可分割的块，一页塞不下时直接溢出裁掉，比不写更糟。所以
 * 这里逐个挑出表格 / 代码块 / 图片 / 标题来打。
 */
function markBreakPoints(root) {
  const blocked = root.querySelectorAll('table, pre, img, figure, .lark-doc-code-block, .lark-doc-image-block')
  const keepInside = []
  for (let i = 0; i < blocked.length; i += 1) {
    blocked[i].classList.add(PRINT_CLASS.avoidBreak)
    keepInside.push(blocked[i])
  }
  const headings = root.querySelectorAll('h1, h2, h3, h4, h5, h6, .lark-doc-heading')
  const keepNext = []
  for (let i = 0; i < headings.length; i += 1) {
    headings[i].classList.add(PRINT_CLASS.keepWithNext)
    keepNext.push(headings[i])
  }
  return { keepInside, keepNext }
}

function removeClasses(nodes, className) {
  for (let i = 0; i < nodes.length; i += 1) nodes[i].classList.remove(className)
}

/**
 * 打印文档。
 *
 * 清理挂在 `afterprint` 上（Chrome / Firefox / Safari 都发），并用 `setTimeout` 兜底 ——
 * 用户在打印框里点「取消」时，个别实现连一次都不发，兜底保证打印类不会永久留在 DOM
 * 上、污染后续渲染。
 *
 * @param {HTMLElement} [rootEl] 打印根元素；不传时自动找 `.lark-doc-print-root`
 * @param {object} [opts]
 * @param {string} [opts.title] 临时页眉标题（流程结束后还原）
 * @param {Function} [opts.onPrinted] 流程结束后的回调（无论用户有没有真的打印）
 * @returns {{ ok: boolean, reason?: string, cleanup?: Function }} ok 表示**启动了**打印流程
 */
export function printDocument(rootEl, opts) {
  const options = opts || {}
  const root = resolveRoot(rootEl)
  if (!root) return { ok: false, reason: 'no-root' }
  if (typeof window === 'undefined' || typeof window.print !== 'function') {
    return { ok: false, reason: 'no-window' }
  }

  const hidden = markOutsideNodes(root)
  const breaks = markBreakPoints(root)
  const hasBody = typeof document !== 'undefined' && Boolean(document.body)
  root.classList.add(PRINT_CLASS.root)
  if (hasBody) document.body.classList.add(PRINT_CLASS.body)

  const previousTitle = hasBody ? document.title : ''
  if (options.title && hasBody) document.title = String(options.title)

  let cleaned = false
  let timer = null
  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    root.classList.remove(PRINT_CLASS.root)
    if (hasBody) document.body.classList.remove(PRINT_CLASS.body)
    removeClasses(hidden, PRINT_CLASS.hidden)
    removeClasses(breaks.keepInside, PRINT_CLASS.avoidBreak)
    removeClasses(breaks.keepNext, PRINT_CLASS.keepWithNext)
    if (options.title && hasBody) document.title = previousTitle
    window.removeEventListener('afterprint', cleanup)
    if (typeof options.onPrinted === 'function') options.onPrinted()
  }

  window.addEventListener('afterprint', cleanup)
  timer = setTimeout(cleanup, PRINT_CLEANUP_FALLBACK_MS)
  window.print()
  return { ok: true, cleanup }
}
