/**
 * 文档级 decorations：搜索高亮、块把手悬停、折叠箭头、标题编号、列表序号/圆点、折叠隐藏。
 *
 * 从 documentExtension 的 decorations props 抽出的纯函数：输入当前 state 与
 * 插件 storage / 编辑器实例 / 功能开关 / 宿主回调，输出 DecorationSet。
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

export function createDocumentDecorations({ state, storage, editor, enabled, options }) {
  const decorations = []
  // 折叠集合存 blockId，装饰需要位置：一次扫描建索引，两处循环共用。
  const foldIndex = foldableIdPositions(state.doc)
  const hits = findTextMatches(state.doc, storage.query).map(({ from, to }, index) => Decoration.inline(from, to, { class: index === storage.activeIndex ? 'lark-doc-search-hit lark-doc-search-active' : 'lark-doc-search-hit' }))
  decorations.push(...hits)
  const hover = storage.handleHover
  if (hover && hover.from >= 0 && hover.to > hover.from && hover.to <= state.doc.content.size) {
    const section = hover.section ? resolveHeadingHighlightSection(state.doc, hover.from) : null
    const blocks = section?.blocks || [{ from: hover.from, to: hover.to, node: state.doc.nodeAt(hover.from) }]
    blocks.forEach((block) => {
      if (!block.node?.isBlock || block.to <= block.from || block.to > state.doc.content.size) return
      decorations.push(Decoration.node(block.from, block.to, { class: `lark-doc-block-handle-hovered${hover.section ? ' lark-doc-heading-section-hovered' : ''}` }))
    })
  }
  // 折叠箭头挂在「有缩进子树的文本块」上：段落和标题都能折（飞书的
  // can-fold / fold-handler 也是按块给的，不限于标题）。
  //
  // 范围一次算全：逐块调 foldedRange 等于逐块 doc.resolve，扁平文档里就是 O(n²)
  // （2,000 块实测 275 ms）。collectFoldRanges 用一趟结构化遍历给同样的结果。
  // 结果留在 foldRanges 里给下面「折叠隐藏」的循环复用 —— 它需要同一份
  // {from,to,node}，再调一次 foldedRange / nodeAt 又是两次 O(n) 随机访问。
  const foldRanges = collectFoldRanges(state.doc)
  foldRanges.forEach(({ node }, pos) => {
    if (!TEXT_FOLD_TYPES.has(node.type.name)) return
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
    }, { key: `lark-doc-heading-fold-${pos}-${collapsed ? 'closed' : 'open'}`, side: -1, ignoreSelection: true }))
  })
  // 标题编号：和折叠箭头落在同一个行内位置（pos+1）。push 顺序决定 DOM 顺序，
  // 箭头先 push、编号后 push，渲染出来才是飞书的「▾ 2. 标题」。
  // 编号是块级 UI，contenteditable=false，不进正文文本。
  computeHeadingNumbers(state.doc).forEach((info, pos) => {
    // 位置来自 descendants 遍历，必然是一个块起点；这里只做 O(1) 的越界兜底，
    // 不要再 doc.nodeAt(pos) —— 那是 O(子节点数) 的随机访问。
    if (!Number.isInteger(pos) || pos < 0 || pos >= state.doc.content.size) return
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
    }, { key: `lark-doc-heading-number-${pos}-${info.label}`, side: -1, ignoreSelection: true }))
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
    }, { key: `${className}-${pos}-${label}`, side: -1, ignoreSelection: true }))
  }
  computeOrderedListNumbers(state.doc).forEach((info, pos) => pushListMarker(pos, info.label, info.depth, 'lark-doc-list-number', info.index, info.firstChildIsParagraph))
  computeBulletItems(state.doc).forEach((info, pos) => pushListMarker(pos, '•', info.depth, 'lark-doc-list-bullet', undefined, info.firstChildIsParagraph))
  storage.folded.forEach((foldId) => {
    const pos = foldIndex.get(foldId)
    if (pos === undefined) return
    const folded = foldRanges.get(pos)
    if (!folded) return
    const { from, to, node: heading } = folded
    decorations.push(Decoration.node(pos, pos + heading.nodeSize, { class: 'lark-doc-heading-folded' }))
    state.doc.nodesBetween(from, to, (node, at) => {
      // display:none 已退出布局与 Tab 顺序；aria-hidden 让屏幕阅读器
      // 同样认为被折叠的后代不可读（需求 13.6.1）。
      if (node.isBlock && at >= from && at + node.nodeSize <= to) {
        decorations.push(Decoration.node(at, at + node.nodeSize, { class: 'lark-doc-fold-hidden', style: 'display: none', 'aria-hidden': 'true' }))
        return false
      }
    })
  })
  // 日期提醒的**块级蒙层**（P4-02a，02 §19.4 ③④）：飞书在块上追加 `reminder-highlighted`
  // 类并挂一个 `.reminder-highlighted-mask` 兄弟节点；这里不造兄弟节点 —— mark 本身就是
  // 真相，给「含有 reminder mark 的文本块」打一个 node decoration 挂同一个类，CSS 出底色。
  //
  // 这样做了之后，「删 chip 蒙层还在」「撤销只回 chip 不回蒙层」这类飞书 bug 结构上不可能
  // 出现（02 §19.4 ②-bis 的两条结论已经在同一处收口）。
  state.doc.descendants((node, pos) => {
    if (!node.isTextblock || !node.childCount) return
    let hasReminder = false
    node.forEach((child) => {
      if (!hasReminder && child.isText && child.marks.some((mark) => mark.type.name === 'reminder')) hasReminder = true
    })
    if (!hasReminder) return
    decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: 'lark-doc-reminder-highlighted' }))
  })
  return DecorationSet.create(state.doc, decorations)
}
