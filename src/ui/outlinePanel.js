/** 首屏目录；低频版本和评论面板单独按需加载。 */
import { applyStyle, mountNode, setAttr, setText, syncChildren } from './dom'
import { iconNode } from './icon'

/** 统一取 handler：缺项静默（与 `dialogs.js` 同口径，漏接线不该炸在渲染里）。 */
function handlerCaller(handlers) {
  return (name, ...args) => {
    const fn = handlers[name]
    return typeof fn === 'function' ? fn(...args) : undefined
  }
}

// 面板开合走 `mountNode(host, el, on)`（只增删自己这一棵，`dom.js`），**不是
// `syncChildren`** —— 历史层 / 另存为 / 评论层共用同一个 `panelHost`，用后者会互相摘除。

/* ═══════════════════════════ ① 目录侧栏 ═══════════════════════════ */

/**
 * 目录侧栏（`OutlinePanel.vue`）。
 *
 * 宿主必须是 `.lark-doc-body` 里的 `ref="outlineHost"`（带 `display: contents`）：
 * `aside` 的 `flex: 0 0 210px` / `position: sticky` 都要求它是那层 flex 的直接子项。
 *
 * 条目按 `pos` 缓存：折叠 / 展开只改类名与条目集合，节点本身复用。
 * `hasChildren` 决定首格是折叠钮还是占位 span —— 两个节点都建好，用
 * `syncChildren` 二选一，等价于模板里的 `v-if` / `v-else`。
 *
 * state: `{ open, empty, pending, active, items: [{ pos, text, level, hasChildren, collapsed }] }`
 */
export function createOutlinePanel(options = {}) {
  const host = options.host || null
  const call = handlerCaller(options.handlers || {})

  const state = { open: false, empty: true, pending: false, active: -1, items: [] }

  const el = document.createElement('aside')
  el.className = 'lark-doc-outline'
  el.setAttribute('aria-label', '文档目录')

  const heading = document.createElement('div')
  heading.className = 'lark-doc-outline-heading'
  const headingTitle = document.createElement('strong')
  headingTitle.textContent = '目录'
  const closeButton = document.createElement('button')
  closeButton.type = 'button'
  closeButton.setAttribute('aria-label', '收起目录')
  closeButton.setAttribute('data-tooltip', '收起目录')
  closeButton.appendChild(iconNode('outline-collapse', 14))
  closeButton.addEventListener('click', () => call('onToggleOpen'))
  heading.appendChild(headingTitle)
  heading.appendChild(closeButton)

  // 空态：必须是 `aside` 的**直系** `<p>`（断言读 `:scope > p`）。
  const emptyNode = document.createElement('p')
  emptyNode.textContent = '添加标题后自动生成目录'

  /** @type {Map<number, ReturnType<typeof createItemNode>>} */
  const itemNodes = new Map()

  function createItemNode(pos) {
    const root = document.createElement('div')
    root.className = 'lark-doc-outline-item'

    const toggle = document.createElement('button')
    toggle.type = 'button'
    // 箭头是 8×12 的 CSS 三角（`border-left` 撑出来的），**不是** SVG。
    const arrow = document.createElement('span')
    arrow.className = 'lark-doc-outline-arrow'
    arrow.setAttribute('aria-hidden', 'true')
    toggle.appendChild(arrow)
    toggle.addEventListener('click', () => call('onToggle', pos))

    const placeholder = document.createElement('span')
    placeholder.className = 'lark-doc-outline-toggle-placeholder'
    placeholder.setAttribute('aria-hidden', 'true')

    const jump = document.createElement('button')
    jump.type = 'button'
    jump.addEventListener('click', () => call('onJump', pos))

    return { root, toggle, arrow, placeholder, jump }
  }

  function render() {
    const slots = [
      { node: heading, on: true },
      { node: emptyNode, on: !!state.empty },
    ]
    const alive = new Set()
    state.items.forEach((item) => {
      alive.add(item.pos)
      let entry = itemNodes.get(item.pos)
      if (!entry) {
        entry = createItemNode(item.pos)
        itemNodes.set(item.pos, entry)
      }
      const { root, toggle, arrow, placeholder, jump } = entry
      // `:style="{ paddingLeft: min(level-1,5)*10 }"` —— 替换语义，整体覆盖。
      applyStyle(root, { paddingLeft: `${Math.min(item.level - 1, 5) * 10}px` })
      const active = item.pos === state.active
      if (item.hasChildren) {
        toggle.classList.toggle('active', active)
        setAttr(toggle, 'aria-label', `${item.collapsed ? '展开' : '收起'}目录：${item.text || '标题'}`)
        setAttr(toggle, 'aria-expanded', String(!item.collapsed))
        setAttr(toggle, 'title', item.collapsed ? '展开目录' : '收起目录')
        arrow.classList.toggle('is-collapsed', !!item.collapsed)
      }
      jump.classList.toggle('active', active)
      jump.disabled = !!state.pending
      // 未 pending 时**不输出** title（模板里是 `undefined`），断言会量 null。
      setAttr(jump, 'title', state.pending ? '正文还在载入，稍后可跳转' : null)
      setText(jump, item.text || '无标题')
      syncChildren(root, [
        { node: toggle, on: !!item.hasChildren },
        { node: placeholder, on: !item.hasChildren },
        { node: jump, on: true },
      ])
      slots.push({ node: root, on: true })
    })
    // 折叠掉的 pos 从缓存里删掉，别让它跟着文档一直长。
    Array.from(itemNodes.keys()).forEach((pos) => {
      if (!alive.has(pos)) itemNodes.delete(pos)
    })
    syncChildren(el, slots)
  }

  function update(patch) {
    Object.assign(state, patch || {})
    mountNode(host, el, !!state.open)
    if (!state.open) return
    render()
  }

  return {
    el,
    update,
    destroy() { if (el.parentNode) el.parentNode.removeChild(el) },
  }
}

