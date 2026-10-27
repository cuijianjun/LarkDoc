/**
 * 文档级 decorations：搜索高亮、块把手悬停、折叠箭头、标题编号、列表序号/圆点、折叠隐藏。
 *
 * 从 documentExtension 的 decorations props 抽出的纯函数：输入当前 state 与
 * 插件 storage / 编辑器实例 / 功能开关 / 宿主回调，输出 DecorationSet。
 *
 * P7-01 起有两条路径：
 * - `createDocumentDecorations`：全文收集（冷路径 —— 换文档、折叠集合/搜索词变化、
 *   invalidate 兜底）。全文收集仍是 2,000 块约 165 ms 的规模，所以热路径不能走它。
 * - `updateDocumentDecorations`：旧集合已由 DerivedIndex `map` 到新坐标，这里只把
 *   脏区里的装饰摘掉重算（热路径 —— 每次击键）。单次约 2~8 ms，且不重建脏区外的 widget DOM。
 *
 * 两条路径共用 `collectDocumentDecorations` 的同一段收集逻辑（`ranges` 为 null 即全文），
 * 避免「局部重扫」和「全文扫描」各写一份规则后各自漂移。
 *
 * 每条装饰都在 spec 上带 `category`：脏区摘除按类别过滤（悬停不属于文档内容，
 * 编辑后由 plugin 清空，见下面 updateDocumentDecorations 的说明）。
 */
import { Decoration, DecorationSet } from '@tiptap/pm/view'
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
export function collectDocumentDecorations({ state, storage, editor, enabled, options, ranges = null, includeHover = true }) {
  const doc = state.doc
  const windows = Array.isArray(ranges) && ranges.length ? ranges : null
  const wholeDoc = windows === null
  const inWindow = (pos) => wholeDoc || windows.some((window) => pos >= window.from && pos < window.to)
  const overlaps = (from, to) => wholeDoc || windows.some((window) => from < window.to && to > window.from)
  const decorations = []
  const hits = findTextMatches(doc, storage.query, windows).map(({ from, to }, index) => Decoration.inline(from, to, {
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
  const foldRanges = collectFoldRanges(doc)
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
    decorations.push(Decoration.widget(widgetPos, () => {
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
        const wasFolded = typeof foldId === 'string' && editor.storage.larkDoc.folded.has(foldId)
        const foldRange = foldedRange(editor.state.doc, pos)
        // 光标落在即将隐藏的章节正文里：折叠后把焦点移回调用的标题，
        // 避免选区留在 display:none 的后代中（13.6.1 焦点迁移规则）。
        const caretInBody = !wasFolded && foldRange && editor.state.selection.from >= foldRange.from && editor.state.selection.from <= foldRange.to
        if (enabled('folding')) editor.commands.toggleLarkDocFold(pos)
        if (caretInBody) editor.commands.setTextSelection(pos + 1)
        editor.view.focus()
        // 视口锚定：当前滚动位置落入被折叠内容时，把标题带回可视区。
        if (!wasFolded) {
          const dom = editor.view.nodeDOM(pos)
          if (dom instanceof Element) dom.scrollIntoView({ block: 'nearest' })
        }
      })
      return button
    }, { key: `lark-doc-heading-fold-${pos}-${collapsed ? 'closed' : 'open'}`, side: -1, ignoreSelection: true, category: DECORATION_CATEGORY.FOLD_TOGGLE }))
  })
  // 标题编号：和折叠箭头落在同一个行内位置（pos+1）。push 顺序决定 DOM 顺序，
  // 箭头先 push、编号后 push，渲染出来才是飞书的「▾ 2. 标题」。
  // 编号是块级 UI，contenteditable=false，不进正文文本。
  computeHeadingNumbers(doc).forEach((info, pos) => {
    // 位置来自 descendants 遍历，必然是一个块起点；这里只做 O(1) 的越界兜底，
    // 不要再 doc.nodeAt(pos) —— 那是 O(子节点数) 的随机访问。
    if (!Number.isInteger(pos) || pos < 0 || pos >= doc.content.size) return
    if (!inWindow(pos)) return
    decorations.push(Decoration.widget(pos + 1, () => {
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
        const rect = button.getBoundingClientRect()
        if (options.onHeadingNumberMenu) {
          options.onHeadingNumberMenu({
            pos,
            label: info.label,
            level: info.level,
            // 「继续」在已经处于继续态时禁用 —— 与飞书菜单一致。
            // 必须读**当前**编辑器状态：同标签的编号会复用同一个 widget DOM，
            // 闭包里捕获的 state 是建 DOM 那一帧的旧状态（设过起点后仍判成连续态，
            // 于是「继续编号」被误禁用、点了没反应）。
            canContinue: Number.isInteger(nodeAtSafe(editor.state.doc, pos)?.attrs?.numberingStart),
            rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
          })
        }
      })
      return button
    }, { key: `lark-doc-heading-number-${pos}-${info.label}`, side: -1, ignoreSelection: true, category: DECORATION_CATEGORY.HEADING_NUMBER }))
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
    decorations.push(Decoration.widget(pos + 2, () => {
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
        const current = nodeAtSafe(editor.state.doc, pos)
        if (!current || current.type.name !== 'listItem') return
        options.onListNumberMenu({
          pos,
          label,
          depth,
          // 编号实际值（a./i. 这类格式拿不回数字，菜单预填要用它）。
          value,
          // 「继续编号」只在这个 item 有显式起点时可点，与标题编号同款判断。
          canContinue: canContinueListNumber(editor.state.doc, pos),
          rect: markerRect(marker),
        })
      })
      return marker
    }, { key: `${className}-${pos}-${label}`, side: -1, ignoreSelection: true, category: DECORATION_CATEGORY.LIST_MARKER }))
  }
  computeOrderedListNumbers(doc).forEach((info, pos) => pushListMarker(pos, info.label, info.depth, 'lark-doc-list-number', info.index, info.firstChildIsParagraph))
  computeBulletItems(doc).forEach((info, pos) => pushListMarker(pos, '•', info.depth, 'lark-doc-list-bullet', undefined, info.firstChildIsParagraph))
  // 折叠集合为空是常态（默认不折叠）：foldableIdPositions 是一次全树扫描，
  // 没有折叠项时直接跳过 —— 热路径上这笔省下来是纯赚。
  if (storage.folded.size) {
    // 折叠集合存 blockId，装饰需要位置：一次扫描建索引。
    const foldIndex = foldableIdPositions(doc)
    storage.folded.forEach((foldId) => {
      const pos = foldIndex.get(foldId)
      if (pos === undefined) return
      const folded = foldRanges.get(pos)
      if (!folded) return
      const { from, to, node: heading } = folded
      // 脏区模式：整段折叠区都不在脏区里就一条都不给（脏区外的旧装饰原地不动）。
      // 判据用整段 from..to：窗口已被 updateDocumentDecorations 扩到「包含整段折叠区」，
      // 所以这里的 from/to 要么全在窗口内、要么完全不相交，不会出现半段重复。
      if (!overlaps(from, to)) return
      decorations.push(Decoration.node(pos, pos + heading.nodeSize, { class: 'lark-doc-heading-folded' }, { category: DECORATION_CATEGORY.FOLD_HIDDEN }))
      doc.nodesBetween(from, to, (node, at) => {
        // display:none 已退出布局与 Tab 顺序；aria-hidden 让屏幕阅读器
        // 同样认为被折叠的后代不可读（需求 13.6.1）。
        if (node.isBlock && at >= from && at + node.nodeSize <= to) {
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
export function createDocumentDecorations({ state, storage, editor, enabled, options }) {
  return DecorationSet.create(state.doc, collectDocumentDecorations({ state, storage, editor, enabled, options }))
}

/**
 * 把脏区窗口扩到「整段折叠区」。
 *
 * 折叠隐藏的装饰是**一段**（标题 + 全部后代块），一条 node decoration 就跨过整段。
 * 如果只按原始脏区摘除，会把一段折叠区摘掉半截、其余仍留在旧集合里；因此摘除窗口
 * 与新建窗口必须同为「含整段」。折叠区通常就是一两屏，代价可以忽略。
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
    const touched = windows.some((window) => window.from < range.to && window.to > range.from)
    if (!touched) return
    windows.push({ from: range.from, to: range.to })
  })
  return windows
}

/**
 * 脏区增量更新（热路径）。
 *
 * 1. 旧集合已经由 DerivedIndex 用 `set.map(tr.mapping, tr.doc)` 带到新位置（结构共享，
 *    2,000 块约 1 ms）——这里拿到的 `previous` 已经是新坐标，不再自己 map；
 * 2. 只把窗口内、非悬停的旧装饰摘掉；
 * 3. 用同一段收集逻辑只算窗口内的新装饰，再用 `add` 并回树里。
 *
 * 脏区外的装饰**没被摘过**：`WidgetType` 实例与 `spec.key` 原样带过来 → ProseMirror
 * 的 widget 管理按 key 复用 DOM，脏区外的 2,500 个 widget 一个都不重建。
 * 这正是击键延迟的大头。
 *
 * 一个必然的副作用：widget key 里嵌了绝对位置（`...-${pos}-${label}`），而
 * `DecorationSet.map` 只搬 `from/to`、不重写 key，所以脏区外的 key 会保留编辑前的
 * 位置。key 在视图里只当**身份令牌**（同位置新旧 widget 比 key 决定是否复用 DOM），
 * 没人解析里面的数字，唯一真值是 `from/to`。别为了「key 干净」去全量重建。
 *
 * @returns {import('@tiptap/pm/view').DecorationSet|null} 返回 null = 「这帧不适合增量」，
 *   调用方退回全量重建。
 */
export function updateDocumentDecorations({ state, storage, editor, enabled, options, previous, ranges }) {
  // 搜索高亮的 active 项按「全文里的第几个命中」判断，脏区里重扫拿到的是窗口内序号，
  // 编辑期间会把 active 打到错的那条上（错的是**语义**，不是性能）。搜索是临时态、
  // 不在击键路径上，直接退回全量最省心。
  if (storage.query) return null
  const doc = state.doc
  // 新文档上再做一遍标题传播：新插入/新转成的**编号**标题会让它后面所有同类标题改号，
  // 而旧文档上那一遍（DerivedIndex.update 里）只看得到「原来这里是段落」。
  // 未编号标题不传播 —— 理由见 derive/index.js 的 extendHeadingRange。
  const expanded = mergeRanges(ranges.map((range) => extendHeadingRange(doc, range)))
  const windows = expandFoldWindows(doc, storage, expanded)
  const stale = []
  windows.forEach((window) => {
    previous.find(window.from, window.to, (spec) => spec && spec.category !== DECORATION_CATEGORY.HOVER).forEach((decoration) => stale.push(decoration))
  })
  // 悬停不属于文档内容：docChanged 时 plugin 已把 handleHover 清成 null，
  // 旧悬停装饰必须摘掉（编辑后鼠标早已不在原块上）。平时没有悬停装饰，
  // find 的谓词过滤让这笔开销只是一次空走。
  if (!storage.handleHover) {
    previous.find(0, doc.content.size, (spec) => spec && spec.category === DECORATION_CATEGORY.HOVER).forEach((decoration) => stale.push(decoration))
  }
  const stripped = stale.length ? previous.remove(stale) : previous
  const fresh = collectDocumentDecorations({ state, storage, editor, enabled, options, ranges: windows, includeHover: !!storage.handleHover })
  return fresh.length ? stripped.add(doc, fresh) : stripped
}
