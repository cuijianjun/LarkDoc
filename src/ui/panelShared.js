/**
 * 面板积木的共用小工具（handler 取值、受控输入回写、按钮抢焦点）。
 *
 * 原本和三个面板挤在 `ui/panels.js` 里；拆开后两组面板都要用这几颗，单独成文件，
 * 免得拆出来的两份各存一份实现。
 */

/** 统一取 handler：缺项静默（与 `dialogs.js` 同口径，漏接线不该炸在渲染里）。 */
function handlerCaller(handlers) {
  return (name, ...args) => {
    const fn = handlers[name]
    return typeof fn === 'function' ? fn(...args) : undefined
  }
}

/** `:value` —— 走 DOM property，且只在真的变了才写（否则光标被踢到末尾）。 */
function setInputValue(input, value) {
  if (!input) return
  const text = value === null || value === undefined ? '' : String(value)
  if (input.value !== text) input.value = text
}

/** `@mousedown.prevent` —— 点面板内的控件不许把焦点让给 body。 */
function onMouseDownPrevent(node, run) {
  node.addEventListener('mousedown', (event) => {
    event.preventDefault()
    run(event)
  })
}

/**
 * 评论表情图标 —— 目录里那张离线雪碧图的一格。
 *
 * 目录还没加载到（或 id 不在目录里）就退化成文字：chip 仍要读得出来，不能因为
 * 一张按需加载的图没到就炸掉整张卡。
 */
function reactionIcon(catalog, key, size, spriteImage) {
  const item = catalog?.items?.find(entry => entry.id === key)
  const icon = document.createElement('span')
  icon.className = 'lark-doc-comment-reaction-icon'
  icon.setAttribute('role', 'img')
  icon.setAttribute('aria-label', item?.name || key)
  icon.style.height = `${size}px`
  if (!item) { icon.textContent = key; return icon }
  const scale = size / item.height
  icon.style.width = `${item.width * scale}px`
  icon.style.backgroundImage = !item.image && spriteImage ? spriteImage : `url("${item.image || catalog.sprite}")`
  if (item.image) icon.style.backgroundSize = 'contain'
  else {
    icon.style.backgroundSize = item.size.split(' ').map(value => `${parseFloat(value) * scale}px`).join(' ')
    icon.style.backgroundPosition = item.pos.split(' ').map(value => `${parseFloat(value) * scale}px`).join(' ')
  }
  return icon
}

export { handlerCaller, setInputValue, onMouseDownPrevent, reactionIcon }
