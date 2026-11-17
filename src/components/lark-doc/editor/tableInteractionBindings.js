/**
 * 表格交互 —— 事件接线层：把 mounted / beforeDestroy 里那一大段 window + editorEl
 * 监听搬成两个 `vm` 入参的函数，mixin 本体的生命周期钩子只剩两行调用。
 *
 * 为什么所有监听都挂 window capture：浮层挂在 editorEl 之外的独立宿主上，
 * pointermove 不冒泡，只在 editorEl 上监听会漏掉「从表格移进浮窗再移出去」这条路径。
 */

const TOUCH_RESIZE_TOLERANCE = 12

export function bindTableInteraction(vm) {
  const editorEl = vm.$refs.editorEl
  if (!editorEl) return
  vm._tableOverlayHover = null
  vm._tableOverlayScrollTarget = editorEl
  // md 浮层的「活跃」闸门：鼠标在表格邻域 / 焦点在浮层内 / 正在键盘编辑表格。
  // 旧实现只看 activeTableElement()（光标在表格内），于是「点过一次表格后鼠标移开、
  // 甚至点了页面别处让编辑器失焦」，胶囊、选择条、滚动条仍永久挂着 —— 与 WorkBuddy
  // 「hover 表格块才浮出胶囊」的 1:1 语义不符。这里统一收口，Escape 可主动收起。
  vm._tableUiPointerInside = false
  // undefined = 还没收到过任何指针事件；收到后才知道指针是否移出了整个组件。
  vm._tableUiPointerInRoot = undefined
  vm._tableUiKeyboardMode = false
  vm._tableUiEscape = false
  // v5：唯一浮窗的离散点击 dismiss 闸门。点表格外 / Escape 置 true，下一次**
  // 点进表格**（或点选择条）才解除。只用 `tableUiActive()` 不够：hover 回表格会把
  // 闸门重新打开，旧选区还在，浮窗会在没有任何新点击的情况下自己浮出来。
  vm._tableUiToolbarDismissed = false
  // v6：选择条（行列高亮块）的**点击**闸门。用户口径：高亮块只在点击表格后才出现，
  // 纯 hover 不出（旧实现 hover 即画，与 WorkBuddy 不符）。点进表格 / 点选择条置
  // true，点其它地方 / Escape 置 false；键盘模式与已有整行整列选区例外放行。
  vm._tableUiClicked = false
  vm._tableUiHideTimer = null
  vm._tableUiFocusTimer = null
  vm._tableUiOnPointerMove = (event) => {
    vm._tableUiKeyboardMode = false
    const target = event.target
    const near = vm.tableUiPointInRegion(event.clientX, event.clientY)
    const inside = vm.tableUiContainsPointer(target) || near
    const root = vm.$refs.root
    const isNode = !!(target && typeof target.nodeType === 'number')
    const inRoot = (isNode && !!root && (target === root || root.contains(target))) || near
    vm._tableUiPointerInRoot = inRoot
    // Escape 只收起「这一次」：指针先离开表格邻域再回来即视为新的一次交互。
    if (!inside && vm._tableUiPointerInside) vm._tableUiEscape = false
    if (inside === vm._tableUiPointerInside) return
    vm._tableUiPointerInside = inside
    vm.scheduleTableUiRefresh(inside)
  }
  vm._tableUiOnFocus = (event) => {
    clearTimeout(vm._tableUiHideTimer)
    const doc = editorEl.ownerDocument
    const active = doc?.activeElement
    if (event?.type === 'focusin') {
      if (active && editorEl.contains(active)) {
        vm._tableUiEscape = false
        vm._tableUiKeyboardMode = true
      }
      vm.refreshTableUiVisibility()
      return
    }
    // focusout / window blur 的这一刻 activeElement 可能仍是旧节点，下一个宏任务再判，
    // 否则「点页面标题让编辑器失焦」会被误判成焦点还在组件里。
    clearTimeout(vm._tableUiFocusTimer)
    vm._tableUiFocusTimer = setTimeout(() => {
      vm._tableUiFocusTimer = null
      if (vm._tableUiWindow) vm.refreshTableUiVisibility()
    }, 0)
  }
  // 浮窗显隐只看**离散点击**：window capture 才能接住挂在独立宿主上的 overlay /
  // ＋ 按钮 / 唯一浮窗，也能在点回正文时第一时间收起。
  vm._tableUiOnPointerDown = (event) => {
    const target = event.target
    const inTable = !!(target && typeof target.closest === 'function'
      && target.closest('.tableWrapper, .lark-doc-table-overlay, .lark-doc-table-boundary-tools, .lark-doc-table-tools'))
    if (inTable) {
      // 点进表格块 / 选择条 / 浮窗按钮 = 新的一次交互：清 dismiss、清 Escape。
      // 合成点击 / 触屏没有前置 pointermove，这里同步把活跃闸门抬起来。
      vm._tableUiToolbarDismissed = false
      vm._tableUiPointerInside = true
      vm._tableUiEscape = false
      vm._tableUiClicked = true
      clearTimeout(vm._tableUiHideTimer)
    } else {
      // 点其它地方：立刻失活 + 锁住浮窗，直到下一次真正点回表格。
      vm._tableUiToolbarDismissed = true
      vm._tableUiPointerInside = false
      vm._tableUiClicked = false
    }
    // 即便选区还没变也要重画：pointerdown 发生在浏览器改选区之前，
    // 此时先按新闸门收 / 放，随后 selection 钩子会再按新选区刷新一次。
    vm.refreshTableUiVisibility()
  }
  vm._tableUiOnKeydown = (event) => {
    if (event.key === 'Escape') {
      vm._tableUiEscape = true
      vm._tableUiToolbarDismissed = true
      vm._tableUiClicked = false
      vm._tableUiKeyboardMode = false
      vm.refreshTableUiVisibility()
      return
    }
    // 后续任何键盘操作都算新交互：解除 Escape，并回到键盘模式以保留浮层的键盘可达性。
    // ⚠️ 不解除 dismiss：Escape / 点外部后必须重新**点击**表格，浮窗才回来。
    vm._tableUiEscape = false
    vm._tableUiKeyboardMode = true
  }
  const win = editorEl.ownerDocument.defaultView
  if (win) {
    vm._tableUiWindow = win
    // capture 阶段挂 window：pointermove 不冒泡，且浮层挂在 editorEl 之外的独立宿主上，
    // 只在 editorEl 上监听会漏掉「从表格移进浮窗再移出去」这条路径。
    win.addEventListener('pointermove', vm._tableUiOnPointerMove, true)
    win.addEventListener('pointerdown', vm._tableUiOnPointerDown, true)
    win.addEventListener('focusin', vm._tableUiOnFocus, true)
    win.addEventListener('focusout', vm._tableUiOnFocus, true)
    win.addEventListener('keydown', vm._tableUiOnKeydown, true)
    win.addEventListener('blur', vm._tableUiOnFocus, true)
  }
  vm._tableOverlayOnPointerOver = (event) => {
    const wrapper = event.target?.closest?.('.tableWrapper')
    if (wrapper === vm._tableOverlayHover) return
    vm._tableOverlayHover = wrapper || null
    vm.refreshTableOverlays()
  }
  vm._tableOverlayOnPointerOut = (event) => {
    if (!vm._tableOverlayHover) return
    const next = event.relatedTarget?.closest?.('.tableWrapper')
    if (next === vm._tableOverlayHover) return
    // overlay 挂在独立的 tableOverlayHost，不在 .tableWrapper 内。鼠标从表格移向
    // 浮窗按钮 / 选择条 / 自绘滚动条时，若在这里清掉 hover，「只 hover、还没点进
    // 表格」的场景下浮窗会在鼠标靠近的瞬间自己消失，按钮根本点不到（与既有
    // keepTableBoundaryHover 同一类问题）。保留 hover，真正移出后再由 pointerover 复位。
    const overlay = vm._tableOverlaysUi?.el
    const related = event.relatedTarget
    // 指针移出浏览器窗口等场景下 relatedTarget 可能是 Window / null，不是 Node；
    // 直接丢给 contains() 会抛 TypeError，先做 Node 判定。
    if (overlay && related && typeof related.nodeType === 'number' && overlay.contains(related)) return
    vm._tableOverlayHover = null
    vm.refreshTableOverlays()
  }
  vm._tableOverlayOnScroll = () => vm.refreshTableOverlays()
  editorEl.addEventListener('pointerover', vm._tableOverlayOnPointerOver)
  editorEl.addEventListener('pointerout', vm._tableOverlayOnPointerOut)
  // scroll 不冒泡，必须 capture 才能接到 .tableWrapper 自己的横滚。
  editorEl.addEventListener('scroll', vm._tableOverlayOnScroll, true)
  // v12：拖列宽期间 prosemirror-tables 的 mousemove 只走 `displayColumnWidth()`
  // **直改 DOM colgroup 宽度、不派发 transaction**（transaction 只在 mouseup 发一次），
  // 挂在 transaction hook 上的 refreshTableOverlays 全程不跑 —— 顶部列选择条会停在
  // 旧几何（实测「拖拽列宽时顶部的条没有跟着一起变」）。信号：activeHandle > -1
  // （hover 到边缘热区或拖拽中）时 prosemirror 给根节点挂 `resize-cursor` 类，
  // 用它做开关，rAF 节流持续同步 overlay 几何。
  vm._tableResizeSyncRaf = null
  vm._tableResizeSyncTick = () => {
    if (vm._tableResizeSyncRaf != null) return
    vm._tableResizeSyncRaf = requestAnimationFrame(() => {
      vm._tableResizeSyncRaf = null
      vm.refreshTableOverlays()
      vm.updateTableBoundary()
      vm.syncTableResizeGuide()
    })
  }
  vm._tableResizeSyncOnMove = () => {
    const viewDom = vm.editor?.view?.dom
    if (!viewDom || !viewDom.classList.contains('resize-cursor')) return
    vm._tableResizeSyncTick()
  }
  win.addEventListener('pointermove', vm._tableResizeSyncOnMove, true)
  // P1-④：落位线只在 dragging 期间存在；结束态的 class 移除发生在 mouseup 的
  // transaction 里、晚于 pointerup，故同样走一次 rAF 节流的 tick 收线。
  vm._tableResizeSyncOnEnd = () => vm._tableResizeSyncTick()
  win.addEventListener('pointerup', vm._tableResizeSyncOnEnd, true)
  win.addEventListener('pointercancel', vm._tableResizeSyncOnEnd, true)
  // T048 触控列宽：prosemirror-tables 的 columnResizing 只绑 mousemove / mouseleave /
  // mousedown（node_modules/prosemirror-tables/dist/index.js 的 handleDOMEvents），
  // `handleMouseMove` 是唯一 arm `activeHandle` 的路径，`handleMouseDown` 在
  // activeHandle == -1 时直接 return false。触摸只产生 touch* / pointer*，于是手指拖
  // 列边界**恒无效**（实测 mousedown / mousemove 计数为 0）。飞书参考实现（
  // web-scripts/067-page_editable_delay_resource…chunk.js 的 `.resizer-line-hotzone`）
  // 走 onPointerDown→handleResizeStart / onPointerMove→handleResize，并用
  // onTouchStart→preventDefault 抢掉这次触摸的滚动。
  // 这里不动插件、不动 schema：把一次触摸手势翻成插件认的鼠标序列
  // （mousemove 定位 arm → mousedown 定 startX → mousemove 拖 → mouseup 提交），
  // 列宽数学 / 最小宽度钳制 / undo 全部沿用插件自身。只接管非鼠标指针。
  vm._tableTouchResize = null
  vm._tableTouchResizeOnStart = (event) => {
    if (vm._tableTouchResize) return
    if (!event.touches || event.touches.length !== 1) return
    const view = vm.editor?.view
    const viewDom = view?.dom
    if (!viewDom || !view.editable) return
    const target = event.target
    const cell = target && target.nodeType === 1 && typeof target.closest === 'function'
      ? target.closest('td, th') : null
    if (!cell || !viewDom.contains(cell)) return
    const rect = cell.getBoundingClientRect()
    const touch = event.touches[0]
    if (!(touch.clientY >= rect.top - TOUCH_RESIZE_TOLERANCE
      && touch.clientY <= rect.bottom + TOUCH_RESIZE_TOLERANCE)) return
    // 手指比鼠标粗：12px 热区。**不改**插件全局 handleWidth（那会同时改动鼠标路径），
    // 桥接层自己放宽，鼠标行为因此零变化。
    const fromRight = rect.right - touch.clientX
    const fromLeft = touch.clientX - rect.left
    const side = fromRight <= TOUCH_RESIZE_TOLERANCE ? 'right'
      : (fromLeft <= TOUCH_RESIZE_TOLERANCE ? 'left' : null)
    if (!side) return
    // 与飞书 onTouchStart→preventDefault 同位：不抢掉默认行为，这次触摸就是在滚表格。
    event.preventDefault()
    vm._tableTouchResize = {
      cell, side, x0: touch.clientX, y0: touch.clientY, x: touch.clientX, y: touch.clientY, dragging: false,
    }
    win.addEventListener('pointermove', vm._tableTouchResizeOnMove, true)
    win.addEventListener('pointerup', vm._tableTouchResizeOnEnd, true)
    win.addEventListener('pointercancel', vm._tableTouchResizeOnEnd, true)
  }
  vm._tableTouchResizeOnMove = (event) => {
    const state = vm._tableTouchResize
    if (!state) return
    state.x = event.clientX
    state.y = event.clientY
    if (!state.dragging) {
      // 3px 死区：轻点边缘选字不该被当成 resize（插件的 mousedown 会派一次 transaction）。
      if (Math.abs(event.clientX - state.x0) < 3) return
      state.dragging = true
      const rect = state.cell.getBoundingClientRect()
      const edgeX = state.side === 'right' ? rect.right : rect.left
      // arm：插件只认「target 是单元格 + 坐标落在单元格边缘 5px 内」的 mousemove，
      // 取边界内侧 2px 发一次，与手指实际位置无关。
      vm.fireTableResizeMouse(
        'mousemove', state.side === 'right' ? edgeX - 2 : edgeX + 2, state.y0, state.cell,
      )
      // startX 用**手指起始点**而非边界点：宽度增量 = 手指位移，起手不会先跳一下。
      vm.fireTableResizeMouse('mousedown', state.x0, state.y0, state.cell)
    }
    vm.fireTableResizeMouse('mousemove', state.x, state.y, state.cell)
  }
  vm._tableTouchResizeOnEnd = (event) => {
    const state = vm._tableTouchResize
    if (!state) return
    vm._tableTouchResize = null
    win.removeEventListener('pointermove', vm._tableTouchResizeOnMove, true)
    win.removeEventListener('pointerup', vm._tableTouchResizeOnEnd, true)
    win.removeEventListener('pointercancel', vm._tableTouchResizeOnEnd, true)
    if (!state.dragging) return
    const x = Number.isFinite(event.clientX) ? event.clientX : state.x
    const y = Number.isFinite(event.clientY) ? event.clientY : state.y
    vm.fireTableResizeMouse('mouseup', x, y, win)
  }
  editorEl.addEventListener('touchstart', vm._tableTouchResizeOnStart, { passive: false })
}

export function releaseTableInteraction(vm) {
  const editorEl = vm._tableOverlayScrollTarget
  if (!editorEl) return
  editorEl.removeEventListener('pointerover', vm._tableOverlayOnPointerOver)
  editorEl.removeEventListener('pointerout', vm._tableOverlayOnPointerOut)
  editorEl.removeEventListener('scroll', vm._tableOverlayOnScroll, true)
  editorEl.removeEventListener('touchstart', vm._tableTouchResizeOnStart, { passive: false })
  vm._tableTouchResize = null
  const win = vm._tableUiWindow
  if (win) {
    win.removeEventListener('pointermove', vm._tableUiOnPointerMove, true)
    win.removeEventListener('pointerdown', vm._tableUiOnPointerDown, true)
    win.removeEventListener('focusin', vm._tableUiOnFocus, true)
    win.removeEventListener('focusout', vm._tableUiOnFocus, true)
    win.removeEventListener('keydown', vm._tableUiOnKeydown, true)
    win.removeEventListener('blur', vm._tableUiOnFocus, true)
  }
  clearTimeout(vm._tableUiHideTimer)
  clearTimeout(vm._tableUiFocusTimer)
  vm._tableUiHideTimer = null
  vm._tableUiFocusTimer = null
  if (vm._tableResizeSyncRaf != null) {
    cancelAnimationFrame(vm._tableResizeSyncRaf)
    vm._tableResizeSyncRaf = null
  }
  if (win && vm._tableResizeSyncOnMove) {
    win.removeEventListener('pointermove', vm._tableResizeSyncOnMove, true)
    vm._tableResizeSyncOnMove = null
  }
  if (win && vm._tableResizeSyncOnEnd) {
    win.removeEventListener('pointerup', vm._tableResizeSyncOnEnd, true)
    win.removeEventListener('pointercancel', vm._tableResizeSyncOnEnd, true)
    vm._tableResizeSyncOnEnd = null
  }
  if (vm._tableResizeGuideEl) {
    vm._tableResizeGuideEl.remove()
    vm._tableResizeGuideEl = null
  }
  vm._tableUiWindow = null
  vm._tableOverlayScrollTarget = null
  vm._tableOverlayHover = null
}
