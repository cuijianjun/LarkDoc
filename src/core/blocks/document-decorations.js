/**
 * 文档装饰：搜索、悬停、折叠、编号和提醒。
 * DerivedIndex负责事务分类、坐标映射与缓存；收集器复用同一份全量/窗口规则。
 * 搜索独立更新，不为activeIndex变化重算结构装饰。
 * widget行为必须通过getPos读取当前位置，不能捕获首次构造的旧坐标。
 */
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { TextSelection } from '@tiptap/pm/state'
import {
  canContinueListNumber,
  collectFoldRanges,
  computeBulletItems,
  computeHeadingNumbers,
  computeOrderedListNumbers,
  findTextMatches,
  foldableIdPositions,
  foldedRange,
  nodeAtSafe,
  resolveHeadingHighlightSection,
  TEXT_FOLD_TYPES,
} from '../documentOperations'
// 标题传播与区间合并只在 derive 里有一份实现：热路径要在**新文档**上再跑一遍，
// 重写一份必然与 update(tr) 那套漂移。
import { extendHeadingRange, mergeRanges } from '../derive/index'
/** 装饰分类：脏区摘除按它过滤，同时把「谁负责哪条装饰」写在数据里。 */
export const DECORATION_CATEGORY = {
  SEARCH: 'search',
  HOVER: 'hover',
  FOLD_TOGGLE: 'fold-toggle',
  HEADING_NUMBER: 'heading-number',
  LIST_MARKER: 'list-marker',
  FOLD_HIDDEN: 'fold-hidden',
  REMINDER: 'reminder',
}

/**
 * 把 widget 的**当前**挂载位置换算回所属块的起点。
 * toDOM 闭包里不能直接用外层捕获的块 `pos`：热路径靠 `DecorationSet.map` 把脏区外的装饰带到
 * 新坐标，而 `WidgetType.map`（prosemirror-view 1.42.7）只重算 `from/to`、**原样返回同一实例**，
 * 视图侧 `matchesWidget` 判的 `WidgetType.eq` 里 `this == other` 为真 → **DOM 直接复用、`toDOM`
 * 不重跑**，那个 `pos` 因此停在「建 DOM 那一帧」：在前面的块里打几个字之后，标题编号把命令发
 * 到错块、列表序号因 `nodeAt` 取不到 listItem 而静默不弹菜单、折叠箭头折叠错块。正解是视图传
 * 给 `toDOM` 的第二个参数 `getPos()` —— 每次调用实时算当前位置（`WidgetViewDesc` 里是
 * `self.parent.posBeforeChild(self)`），DOM 复用也照样准。
 * @param {() => number} getPos `toDOM(view, getPos)` 的第二个参数
 * @param {number} offset 挂载位置到块起点的距离（= 建装饰时的 widget 位置 − 块 pos）
 */
const resolveBlockPos = (getPos, offset) => getPos() - offset


/**
 * 收集装饰（不建 Set）。
 *
 * `ranges` 为 null → 全文；否则只产出与这些区间相交的装饰。区间由 DerivedIndex 按
 * `tr.mapping.maps` 扩张而来，边界已经对齐到整块，所以「整块算」不会漏半块。
 *
 * `includeHover` 只在热路径为 false：docChanged 时 plugin 已经把 handleHover 清成 null，
 * 悬停装饰由 updateDocumentDecorations 直接摘掉，不必再算。
 *
 * @returns {import('@tiptap/pm/view').Decoration[]}
 */
export function collectDocumentDecorations({ state, storage, editor, enabled, options, ranges = null, includeHover = true, foldRanges: preparedFoldRanges = null, analysis = null }) {
  const doc = state.doc
  const prepared = analysis?.doc === doc ? analysis : null
  const windows = Array.isArray(ranges) && ranges.length ? ranges : null
  const wholeDoc = windows === null
  const inWindow = (pos) => wholeDoc || windows.some((window) => pos >= window.from && pos < window.to)
  const overlaps = (from, to) => wholeDoc || windows.some((window) => from < window.to && to > window.from)
  const decorations = []
  const hits = storage.pagedView ? storage.pagedView.collectSearchDecorations(storage).filter(hit => overlaps(hit.from, hit.to))
    : findTextMatches(doc, storage.query, windows).map(({ from, to }, index) => Decoration.inline(from, to, {
      class: index === storage.activeIndex ? 'lark-doc-search-hit lark-doc-search-active' : 'lark-doc-search-hit',
    }, { category: DECORATION_CATEGORY.SEARCH }))
  decorations.push(...hits)
  const hover = includeHover ? storage.handleHover : null
  if (hover && hover.from >= 0 && hover.to > hover.from && hover.to <= doc.content.size) {
    const section = hover.section ? resolveHeadingHighlightSection(doc, hover.from) : null
    const blocks = section?.blocks || [{ from: hover.from, to: hover.to, node: doc.nodeAt(hover.from) }]
    blocks.forEach((block) => {
      if (!block.node?.isBlock || block.to <= block.from || block.to > doc.content.size) return
      decorations.push(Decoration.node(block.from, block.to, { class: `lark-doc-block-handle-hovered${hover.section ? ' lark-doc-heading-section-hovered' : ''}` }, { category: DECORATION_CATEGORY.HOVER }))
    })
  }
  // 折叠箭头挂在「有缩进子树的文本块」上：段落和标题都能折（飞书的
  // can-fold / fold-handler 也是按块给的，不限于标题）。
  //
  // 范围一次算全：逐块调 foldedRange 等于逐块 doc.resolve，扁平文档里就是 O(n²)
  // （2,000 块实测 275 ms）。collectFoldRanges 用一趟结构化遍历给同样的结果。
  // 结果留在 foldRanges 里给下面「折叠隐藏」的循环复用 —— 它需要同一份
  // {from,to,node}，再调一次 foldedRange / nodeAt 又是两次 O(n) 随机访问。
  let foldIndex = prepared?.foldIndex
  let foldRanges = preparedFoldRanges || prepared?.foldRanges
  if (!foldIndex || !foldRanges) {
    foldIndex = new Map()
    const collected = collectFoldRanges(doc, foldIndex)
    foldRanges ||= collected
  }
  // Stable identities share the paged analysis; ordinary documents collect both
  // ranges and ids once. Last duplicate wins; missing ids retain position fallback.
  const widgetIds = prepared?.widgetIds || {}
  if (!prepared?.widgetIds) {
    foldIndex.forEach((pos, id) => { widgetIds[pos] = `id:${id}` })
    if (prepared) prepared.widgetIds = widgetIds
  }
  foldRanges.forEach(({ node }, pos) => {
    if (!TEXT_FOLD_TYPES.has(node.type.name)) return
    if (!inWindow(pos)) return
    const foldId = node.attrs.blockId
    const collapsed = typeof foldId === 'string' && storage.folded.has(foldId)
    // 列表项的箭头要放进首个子段落里（item 内部第一个行内位置），
    // 文字块则在块内容起点 pos+1。
    const isItem = node.type.name === 'listItem' || node.type.name === 'taskItem'
    if (isItem && (!node.childCount || node.child(0).type.name !== 'paragraph')) return
    const widgetPos = isItem ? pos + 2 : pos + 1
    const blockOffset = widgetPos - pos
    decorations.push(Decoration.widget(widgetPos, (view, getPos) => {
      const button = document.createElement('button')
      const label = collapsed ? '展开' : '收起'
      button.type = 'button'
      button.className = 'lark-doc-heading-fold-toggle'
      button.setAttribute('aria-label', label)
      button.setAttribute('aria-expanded', String(!collapsed))
      button.setAttribute('data-tooltip', label)
      // 图标 = 02 §2 ③-1 实测的下三角 path（16×16 viewBox，绘制区 9×6），
      // fill 走 currentColor 让主题 token 继续控色。折叠态不换图标，
      // 由 CSS 对 [aria-expanded="false"] 里的 svg 做 rotate(-90deg)。
      button.innerHTML =
        '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">' +
        '<path d="M7.712 11.351L3.34 5.9a.45.45 0 010-.538.278.278 0 01.215-.112h8.89c.168 0 .305.17.305.381a.432.432 0 01-.09.269l-4.372 5.451c-.159.199-.417.199-.576 0z" fill="currentColor"/></svg>'
      // 不要再设 title：浏览器原生 tooltip 会和 data-tooltip 的黑色气泡
      // 同时出现，变成「收起」重影（截图里上下两个）。读屏靠 aria-label。
      button.contentEditable = 'false'
      button.addEventListener('mousedown', (event) => event.preventDefault())
      button.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') return
        event.preventDefault()
        event.stopPropagation()
        button.click()
      })
      button.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        // 块起点按点击那一刻算，不是建这个按钮那一帧（见 resolveBlockPos）。
        const at = resolveBlockPos(getPos, blockOffset)
        const wasFolded = typeof foldId === 'string' && editor.storage.larkDoc.folded.has(foldId)
        const foldRange = foldedRange(editor.state.doc, at)
        // 光标落在即将隐藏的章节正文里：折叠后把焦点移回调用的标题，
        // 避免选区留在 display:none 的后代中（13.6.1 焦点迁移规则）。
        const selection = editor.state.selection
        const caret = selection instanceof TextSelection ? selection.head : selection.from
        const caretInBody = !wasFolded && foldRange && caret >= foldRange.from && caret < foldRange.to
        if (enabled('folding')) editor.commands.toggleLarkDocFold(at)
        if (caretInBody) editor.commands.setTextSelection(at + 1)
        editor.view.focus()
        // 视口锚定：当前滚动位置落入被折叠内容时，把标题带回可视区。
        if (!wasFolded) {
          const dom = editor.view.nodeDOM(at)
          editor.storage?.larkDoc?.projection?.revealNode?.(dom)
          if (dom instanceof Element) dom.scrollIntoView({ block: 'nearest' })
        }
      })
      return button
    }, { key: `lark-doc-heading-fold-${widgetIds[pos] || pos}-${blockOffset}-${collapsed ? 'closed' : 'open'}`, side: -1, ignoreSelection: true, category: DECORATION_CATEGORY.FOLD_TOGGLE }))
  })
  // 标题编号：和折叠箭头落在同一个行内位置（pos+1）。push 顺序决定 DOM 顺序，
  // 箭头先 push、编号后 push，渲染出来才是飞书的「▾ 2. 标题」。
  // 编号是块级 UI，contenteditable=false，不进正文文本。
  ;(prepared?.headingNumbers || computeHeadingNumbers(doc)).forEach((info, pos) => {
    // 位置来自 descendants 遍历，必然是一个块起点；这里只做 O(1) 的越界兜底，
    // 不要再 doc.nodeAt(pos) —— 那是 O(子节点数) 的随机访问。
    if (!Number.isInteger(pos) || pos < 0 || pos >= doc.content.size) return
    if (!inWindow(pos)) return
    decorations.push(Decoration.widget(pos + 1, (view, getPos) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'lark-doc-heading-number'
      button.contentEditable = 'false'
      button.textContent = info.label
      button.setAttribute('data-number', info.label)
      button.setAttribute('data-level', String(info.level))
      button.setAttribute('aria-label', `标题编号 ${info.label}，点击设置编号`)
      button.setAttribute('data-tooltip', '设置编号')
      button.addEventListener('mousedown', (event) => event.preventDefault())
      button.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        if (!enabled('headings') || !editor.isEditable) return
        // 两处都必须读点击那一刻的值：① pos（见 resolveBlockPos）；
        // ② state —— 按建 DOM 那一帧的状态判，会把「继续编号」误判成已连续而禁用。
        const at = resolveBlockPos(getPos, 1)
        const rect = button.getBoundingClientRect()
        if (options.onHeadingNumberMenu) {
          options.onHeadingNumberMenu({
            pos: at,
            label: info.label,
            level: info.level,
            // 「继续」在已经处于继续态时禁用 —— 与飞书菜单一致。
            canContinue: Number.isInteger(nodeAtSafe(editor.state.doc, at)?.attrs?.numberingStart),
            rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
          })
        }
      })
      return button
    }, { key: `lark-doc-heading-number-${widgetIds[pos] || pos}-${info.level}-${info.label}`, side: -1, ignoreSelection: true, category: DECORATION_CATEGORY.HEADING_NUMBER }))
  })
  // 列表序号 / 圆点：飞书把标记画在正文流里（序号是蓝色、contentEditable=false），
  // 不是浏览器的 ::marker —— 所以这里也走装饰层：箭头 → 标记 → 正文。
  // 标记进流之后，句柄和折叠箭头都以它为锚点往左让位，三者不会再互相压住。
  //
  // 有序序号在飞书里是**可点**的块级 UI（点它弹出编号菜单，和标题编号共用一套），
  // 所以这里渲染成 button；无序圆点保持纯展示的 span。
  const markerRect = (el) => {
    const rect = el.getBoundingClientRect()
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height }
  }
  const pushListMarker = (pos, label, depth, className, value, firstChildIsParagraph) => {
    // 判定所需的 node 由编号计算顺带给出（见 computeOrderedListNumbers），
    // 不再 doc.nodeAt(pos) —— 946 个标记 × O(子节点数) 是最贵的一笔随机访问。
    if (!firstChildIsParagraph) return
    if (!inWindow(pos)) return
    const interactive = className === 'lark-doc-list-number'
    decorations.push(Decoration.widget(pos + 2, (view, getPos) => {
      const marker = document.createElement(interactive ? 'button' : 'span')
      marker.className = className
      marker.contentEditable = 'false'
      marker.textContent = label
      marker.setAttribute('data-number', label)
      marker.setAttribute('data-depth', String(depth))
      if (!interactive) {
        // 圆点是纯展示层：读屏按 <ul>/<li> 语义读，不重复念一遍。
        marker.setAttribute('aria-hidden', 'true')
        return marker
      }
      marker.type = 'button'
      marker.setAttribute('aria-label', `列表编号 ${label}，点击设置编号`)
      marker.addEventListener('mousedown', (event) => event.preventDefault())
      marker.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        if (!editor.isEditable || !options.onListNumberMenu) return
        // 同样不能读捕获的 pos：它停在编辑前，`nodeAt` 拿不回 listItem → 下面直接 return，点了没反应。
        const at = resolveBlockPos(getPos, 2)
        const current = nodeAtSafe(editor.state.doc, at)
        if (!current || current.type.name !== 'listItem') return
        options.onListNumberMenu({
          pos: at,
          label,
          depth,
          // 编号实际值（a./i. 这类格式拿不回数字，菜单预填要用它）。
          value,
          // 「继续编号」只在这个 item 有显式起点时可点，与标题编号同款判断。
          canContinue: canContinueListNumber(editor.state.doc, at),
          rect: markerRect(marker),
        })
      })
      return marker
    }, { key: `${className}-${widgetIds[pos] || pos}-${depth}-${value}-${label}`, side: -1, ignoreSelection: true, category: DECORATION_CATEGORY.LIST_MARKER }))
  }
  ;(prepared?.orderedListNumbers || computeOrderedListNumbers(doc)).forEach((info, pos) => pushListMarker(pos, info.label, info.depth, 'lark-doc-list-number', info.index, info.firstChildIsParagraph))
  ;(prepared?.bulletItems || computeBulletItems(doc)).forEach((info, pos) => pushListMarker(pos, info.depth === 2 ? '◦' : '•', info.depth, 'lark-doc-list-bullet', undefined, info.firstChildIsParagraph))
  // The same identity index also resolves stored fold preferences. An empty
  // preference set needs no hidden-range decorations.
  if (storage.folded.size) {
    // 折叠集合存 blockId，装饰需要位置：一次扫描建索引。
    storage.folded.forEach((foldId) => {
      const pos = foldIndex.get(foldId)
      if (pos === undefined) return
      const folded = foldRanges.get(pos)
      if (!folded) return
      const { from, to, node: heading } = folded
      // 脏区模式：整段折叠区都不在脏区里就一条都不给（脏区外的旧装饰原地不动）。
      // 判据用 `[pos, to)`（**含标题**）：折叠装饰本身覆盖标题，只用后代段 from..to
      // 判断时「脏区正好落在标题上」会判成不相交，于是摘掉又不补，折叠整体消失。
      // updateDocumentDecorations 的窗口也是同一个口径（起点取 pos），两边必须一致。
      if (!overlaps(pos, to)) return
      decorations.push(Decoration.node(pos, pos + heading.nodeSize, { class: 'lark-doc-heading-folded' }, { category: DECORATION_CATEGORY.FOLD_HIDDEN }))
      doc.nodesBetween(from, to, (node, at) => {
        // display:none 已退出布局与 Tab 顺序；aria-hidden 让屏幕阅读器
        // 同样认为被折叠的后代不可读（需求 13.6.1）。
        if (node.type.name !== 'documentSegment' && node.isBlock && at >= from && at + node.nodeSize <= to) {
          decorations.push(Decoration.node(at, at + node.nodeSize, { class: 'lark-doc-fold-hidden', style: 'display: none', 'aria-hidden': 'true' }, { category: DECORATION_CATEGORY.FOLD_HIDDEN }))
          return false
        }
      })
    })
  }
  // 日期提醒的**块级蒙层**（P4-02a，02 §19.4 ③④）：飞书在块上追加 `reminder-highlighted`
  // 类并挂一个 `.reminder-highlighted-mask` 兄弟节点；这里不造兄弟节点 —— mark 本身就是
  // 真相，给「含有 reminder mark 的文本块」打一个 node decoration 挂同一个类，CSS 出底色。
  //
  // 这样做了之后，「删 chip 蒙层还在」「撤销只回 chip 不回蒙层」这类飞书 bug 结构上不可能
  // 出现（02 §19.4 ②-bis 的两条结论已经在同一处收口）。
  const pushReminder = (node, pos) => {
    if (!node.isTextblock || !node.childCount) return
    let hasReminder = false
    node.forEach((child) => {
      if (!hasReminder && child.isText && child.marks.some((mark) => mark.type.name === 'reminder')) hasReminder = true
    })
    if (!hasReminder) return
    decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: 'lark-doc-reminder-highlighted' }, { category: DECORATION_CATEGORY.REMINDER }))
  }
  if (wholeDoc) {
    doc.descendants(pushReminder)
  } else {
    // 脏区模式只扫窗口内的文本块：reminder 蒙层挂在块上，块已经整块在窗口里。
    windows.forEach((window) => {
      doc.nodesBetween(window.from, window.to, (node, pos) => {
        if (node.isTextblock) { pushReminder(node, pos); return false }
        return true
      })
    })
  }
  return decorations
}

/** 全文构建（冷路径）：与 P7 之前的语义逐条一致，只是每条装饰多了 category。 */
export function createDocumentDecorations({ state, storage, editor, enabled, options, foldRanges, analysis }) {
  return DecorationSet.create(state.doc, collectDocumentDecorations({ state, storage, editor, enabled, options, foldRanges, analysis }))
}

/**
 * 把脏区窗口扩到「整段折叠区」。
 *
 * 折叠隐藏的装饰是**一段**（标题 + 全部后代块），一条 node decoration 就跨过整段。
 * 如果只按原始脏区摘除，会把一段折叠区摘掉半截、其余仍留在旧集合里；因此摘除窗口
 * 与新建窗口必须同为「含整段」。折叠区通常就是一两屏，代价可以忽略。
 *
 * 折叠集合非空时**无条件**把每一段都并入窗口，不做「与脏区相交才扩」的剪裁：
 * 折叠装饰的范围是 `[标题起点, 段末)`，而脏区右缘常常正好落在标题起点上
 * （编辑上一个块 → 窗口右端 = 本块起点 = 标题起点），相交判定在边界上会漏掉这一段：
 * `find` 的闭区间把装饰摘掉，收集侧却因为不相交一条都不补 —— 折叠整体消失。
 * 折叠集合是个位数，全量并入的代价可以忽略（这是「宁可多算几个块」的地方）。
 */
function expandFoldWindows(doc, storage, ranges) {
  const windows = ranges.map((range) => ({ from: range.from, to: range.to }))
  if (!storage.folded.size) return windows
  const foldIndex = foldableIdPositions(doc)
  storage.folded.forEach((foldId) => {
    const pos = foldIndex.get(foldId)
    if (pos === undefined) return
    const range = foldedRange(doc, pos)
    if (!range) return
    // 起点用标题自身的 pos，不是后代段起点 —— `lark-doc-heading-folded` 覆盖标题。
    windows.push({ from: pos, to: range.to })
  })
  return windows
}

/**
 * 脏区增量更新：previous已由DerivedIndex映射到新坐标，只重收集窗口内的装饰。
 * 窗口外保留原key与DOM；稳定blockId的key包含显示/行为参数，旧/缺ID使用位置fallback。
 * map只搬from/to，不重写fallback key；key是身份令牌，不能用来反推当前位置。
 * DOM复用时toDOM不会重跑，点击坐标必须通过resolveBlockPos/getPos读取。
 * 真实DOM/坐标回归见test/unit/document-decorations-widget-pos.test.js。
 * @returns {import('@tiptap/pm/view').DecorationSet|null} null表示需要全量重建。
 * previous已由DerivedIndex映射到新坐标。只摘除脏区装饰并重算，保留窗口外widget身份。
 * 搜索中的文本编辑暂走完整装饰重建；命中扫描仍按需分片，共享当前doc/query结果。
 * 格式路径的precise分析已含折叠/编号差异，其他路径继续保守扩张标题与折叠窗口。
 * 返回null要求调用方全量重建，避免局部搜索序号或未知结构造成错误。
 */
export function updateDocumentDecorations({ state, storage, editor, enabled, options, previous, ranges, analysis }) {
  if (storage.query) return null
  const doc = state.doc
  // 新文档上再做一遍标题传播：新插入/新转成的**编号**标题会让它后面所有同类标题改号，
  // 而旧文档上那一遍（DerivedIndex.update 里）只看得到「原来这里是段落」。
  // 未编号标题不传播 —— 理由见 derive/index.js 的 extendHeadingRange。
  const expanded = mergeRanges(analysis?.precise ? ranges : ranges.map((range) => extendHeadingRange(doc, range)))
  const windows = expandFoldWindows(doc, storage, expanded)
  // 口径差必须在这里抹平：窗口是半开 `[from, to)`（收集侧的 `inWindow`/`nodesBetween`
  // 都是这个口径），而 `DecorationSet.find(start, end)` 是**闭区间**。直接用 `to` 作上界
  // 会把「起点正好等于 to」的装饰摘掉 —— 脏区右缘落在下一个块起点上是常态
  // （拖整块 + 向右 map），于是下一个块的提醒蒙层 / 折叠装饰被摘掉却不会被重新收集。
  // 上界取 `to - 1` 才是 `[from, to)`；位置是整数，不会误伤 `to` 之前的装饰。
  const stale = []
  windows.forEach((window) => {
    const upper = Math.max(window.from, window.to - 1)
    previous.find(window.from, upper, (spec) => spec && spec.category !== DECORATION_CATEGORY.HOVER).forEach((decoration) => stale.push(decoration))
  })
  // 悬停不属于文档内容：docChanged 时 plugin 已把 handleHover 清成 null，
  // 旧悬停装饰必须摘掉（编辑后鼠标早已不在原块上）。平时没有悬停装饰，
  // find 的谓词过滤让这笔开销只是一次空走。
  if (!storage.handleHover) {
    previous.find(0, doc.content.size, (spec) => spec && spec.category === DECORATION_CATEGORY.HOVER).forEach((decoration) => stale.push(decoration))
  }
  // 窗口可能相邻/重叠（折叠窗口是无条件并入的），同一条装饰会被多次 push；
  // 按对象身份去重，`remove` 内部是线性查找，重复项会让它退化成平方级。
  const stripped = stale.length ? previous.remove([...new Set(stale)]) : previous
  const fresh = collectDocumentDecorations({ state, storage, editor, enabled, options, ranges: windows, includeHover: !!storage.handleHover, analysis })
  return fresh.length ? stripped.add(doc, fresh) : stripped
}
