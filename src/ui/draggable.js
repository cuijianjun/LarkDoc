/**
 * 浮层拖动 —— 按住标题栏即可移动面板（AI 助手这类常驻面板用）。
 *
 * 面板原本躺在 `position: fixed` 的槽位容器（`.lark-doc-external-panel`）里靠右贴边，
 * 所以**首次拖动要把当前视觉位置固化成 inline `left/top`**：直接改成 fixed 而不写坐标，
 * 面板会先跳到左上角再跟手，观感像坏掉了。
 *
 * 位置只留在 DOM 上 —— 面板关掉再打开还在原处（节点复用），刷新页面回默认槽位。
 * 手柄内的按钮（关闭等）不吞事件，`pointerdown` 直接放过。
 */
const EDGE = 8 // 距视口边缘的最小留白
const MIN_HEIGHT = 160 // 视口再矮也给面板留一截可读高度

const clamp = (value, min, max) => (max < min ? min : Math.min(Math.max(value, min), max))

export function makeDraggable(panel, handle) {
  if (!panel || !handle) return () => {}
  const win = panel.ownerDocument.defaultView || window
  let origin = null

  // 面板固定后自己接管滚动：父容器（槽位）的 max-height / overflow 管不到 fixed 子元素，
  // 不在这里补 overflow-y，超出 maxHeight 的内容会直接溢出到面板框外。
  function pin(left, top) {
    panel.style.maxHeight = `${Math.max(MIN_HEIGHT, win.innerHeight - top - EDGE)}px`
    panel.style.overflowY = 'auto'
    panel.style.left = `${left}px`
    panel.style.top = `${top}px`
  }

  function onMove(event) {
    if (!origin) return
    const width = panel.offsetWidth
    const height = panel.offsetHeight
    pin(
      clamp(origin.left + event.clientX - origin.x, EDGE, win.innerWidth - width - EDGE),
      clamp(origin.top + event.clientY - origin.y, EDGE, win.innerHeight - Math.min(height, win.innerHeight - EDGE * 2) - EDGE),
    )
  }

  function stop() {
    if (!origin) return
    origin = null
    handle.classList.remove('is-dragging')
    win.removeEventListener('pointermove', onMove)
    win.removeEventListener('pointerup', stop)
    win.removeEventListener('pointercancel', stop)
  }

  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0 || origin) return
    // 标题栏上的按钮（关闭 / 动作）照常点，不当拖动起点。
    if (event.target.closest?.('button, a, input, textarea, select')) return
    const rect = panel.getBoundingClientRect()
    panel.style.position = 'fixed'
    panel.style.right = 'auto'
    panel.style.bottom = 'auto'
    panel.style.margin = '0'
    panel.style.width = `${rect.width}px`
    origin = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top }
    pin(rect.left, rect.top)
    handle.classList.add('is-dragging')
    try { handle.setPointerCapture(event.pointerId) } catch { /* 指针已释放：不拖也罢 */ }
    win.addEventListener('pointermove', onMove)
    win.addEventListener('pointerup', stop)
    win.addEventListener('pointercancel', stop)
    event.preventDefault()
  })

  // 拖过的面板要在窗口变小时收回视口，否则缩小窗口后面板整块留在屏幕外。
  function onResize() {
    if (!panel.style.position || panel.style.position !== 'fixed') return
    const rect = panel.getBoundingClientRect()
    pin(
      clamp(rect.left, EDGE, Math.max(EDGE, win.innerWidth - rect.width - EDGE)),
      clamp(rect.top, EDGE, Math.max(EDGE, win.innerHeight - MIN_HEIGHT - EDGE)),
    )
  }
  win.addEventListener('resize', onResize)

  return () => {
    stop()
    win.removeEventListener('resize', onResize)
  }
}
