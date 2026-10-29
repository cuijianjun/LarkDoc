/**
 * 右下角 `?` 帮助圆钮 + hover 菜单 —— `editor/HelpFab.vue` 的原生等价物（阶段 5 批次 5G）。
 *
 * 这是阶段 5 里唯一一个**没有任何外部状态进来**的积木：开关全在组件自己身上
 * （`menuOpen` + 160ms 定时器），主壳不 watch 它、也不给它推 state。所以本模块
 * **自己持有开关与定时器**，`update()` 只负责「菜单项数据变了要重建」这一件事。
 * 别为了「统一范式」把 `open` 抬到编辑器的 data 里去 —— 那会让每次鼠标移入都走一遍
 * Vue 的响应式派发，还会把「指针是否还在上面」这种纯 UI 事实漏进业务状态。
 *
 * 四条必须守住的语义（`scripts/verify-browser-help-fab.js` 逐条锁）：
 *
 * 1. **菜单是 `v-if`**：关掉时整棵真不在 DOM 里（`syncChildren` 摘掉），不是
 *    `display:none`。`syncChildren` 在这里是安全的 —— `wrap` 是它独占的子树。
 * 2. **`aria-expanded` 永远存在**，取值 `'true'` / `'false'`。别改成
 *    「开着才输出属性」：读屏与断言都按 `'false'` 这个字符串判。
 * 3. **12px 缝隙不能闪**：菜单底边在圆钮顶边上方 12px（`bottom: calc(100% + 12px)`），
 *    指针从这里过会先触发 `wrap` 的 `mouseleave`。160ms 抖动窗口内不关，与二级子菜单
 *    同口径（07 §9）。这是本组件最容易被「顺手优化」掉的一行，改 0ms 就是回归。
 * 4. **落点策略不在本模块**：5 项里只有「快捷键」在项目内有对应界面，其余 4 项是
 *    飞书的外部服务入口。本模块只做「收起菜单 → 把 item 交给 `onRun`」，点哪个有
 *    落点由接线层（`helpFabUiMixin`）决定 —— 别在这里分流，否则 Element 产物会把
 *    业务判断一起打进 UI 层。
 *
 * 结构（与 SFC 逐字段一致，注释里的注释也照抄）：
 *   div.lark-doc-help-fab-wrap
 *     button.lark-doc-help-fab[type=button][aria-label=帮助][aria-haspopup=menu][aria-expanded]
 *       "?"（文本，不是图标）
 *     div.lark-doc-help-menu[role=menu][aria-label=帮助菜单]        ← v-if
 *       button.lark-doc-help-menu-item[type=button][role=menuitem]  ← ×5
 *         span.lark-doc-icon（16×16）+ span{label}
 */
import { mountNode, setAttr, syncChildren } from './dom'
import { iconNode } from './icon'
import { HELP_MENU_ITEMS } from './shortcutGroups'

/** 移开多久才真正收起（ms）。07 §9：与二级子菜单同口径的 160ms 抖动窗口。 */
const HIDE_DELAY = 160

/** 统一取 handler：缺项静默（与 `panels.js` / `stage.js` 同口径）。 */
function handlerCaller(handlers) {
  return (name, ...args) => {
    const fn = handlers[name]
    return typeof fn === 'function' ? fn(...args) : undefined
  }
}

/** 菜单项的「结构指纹」—— 变了才重建按钮，别每次 update 都重造五个节点。 */
function itemsSignature(items) {
  return items.map((item) => `${item.id}:${item.icon}:${item.label}`).join('|')
}

/**
 * @param {{host: HTMLElement|null, handlers?: Record<string, Function>, items?: Array}} options
 *   `handlers.onRun(item)` —— 点某一项（菜单已收起）。落点策略由接线层决定。
 * @returns {{el: HTMLElement, update: (patch?: object) => void, destroy: () => void}}
 */
export function createHelpFab({ host, handlers, items } = {}) {
  const call = handlerCaller(handlers || {})
  // 开关与定时器是本模块私有的（见文件头：不抬进 Vue 状态）
  let open = false
  let timer = null
  let menuItems = Array.isArray(items) && items.length ? items.slice() : HELP_MENU_ITEMS
  let signature = ''
  let itemNodes = []

  // —— 圆钮 ——
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'lark-doc-help-fab'
  button.setAttribute('aria-label', '帮助')
  button.setAttribute('aria-haspopup', 'menu')
  // 初值先写上：`render()` 每次都写，这里只是让「首帧前就被读到」时也有值
  button.setAttribute('aria-expanded', 'false')
  button.textContent = '?'

  // —— 菜单容器 ——
  const menu = document.createElement('div')
  menu.className = 'lark-doc-help-menu'
  menu.setAttribute('role', 'menu')
  menu.setAttribute('aria-label', '帮助菜单')

  const el = document.createElement('div')
  el.className = 'lark-doc-help-fab-wrap'
  el.appendChild(button)
  // menu 先不挂：`v-if` 初始为假，`render()` 会按开关把它 sync 进来

  /**
   * 按 `menuItems` 重建五个按钮 —— 只有指纹变了才动。
   *
   * 按钮内部顺序固定「图标 span → 文案 span」（SFC 的 `<lark-doc-icon /><span>`），
   * 中间没有空白文本节点：CSS 的 `gap: 8px` 负责间距。
   */
  function buildItems() {
    const next = itemsSignature(menuItems)
    if (next === signature) return
    signature = next
    itemNodes = menuItems.map((item) => {
      const node = document.createElement('button')
      node.type = 'button'
      node.className = 'lark-doc-help-menu-item'
      node.setAttribute('role', 'menuitem')
      node.appendChild(iconNode(item.icon, 16))
      const label = document.createElement('span')
      label.textContent = item.label
      node.appendChild(label)
      // 闭包抓 `item` 本身：`run` 只关心「哪一项」，不看 hover 状态
      node.addEventListener('click', () => run(item))
      return node
    })
    syncChildren(menu, itemNodes.map((node) => ({ node, on: true })))
  }

  function render() {
    setAttr(button, 'aria-expanded', open ? 'true' : 'false')
    // `v-if` 的两段：菜单在 DOM 里 ⇄ 不在。`el` 是独占宿主，顺序 = 圆钮在菜单之前。
    syncChildren(el, [{ node: button, on: true }, { node: menu, on: open }])
    mountNode(host, el, true)
  }

  function cancelHide() {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  function show() {
    cancelHide()
    if (open) return
    open = true
    render()
  }

  /** 移开 → 160ms 后再关；窗口内回来会 `cancelHide`（跨 12px 缝隙不闪）。 */
  function hideLater() {
    cancelHide()
    timer = setTimeout(() => {
      timer = null
      if (!open) return
      open = false
      render()
    }, HIDE_DELAY)
  }

  function toggle() {
    if (open) {
      cancelHide()
      open = false
      render()
    } else {
      show()
    }
  }

  /**
   * 点某一项：先收起菜单，再把 item 交给接线层。
   *
   * 顺序不能反 —— `onRun` 可能立刻打开快捷键抽屉（整屏遮罩），菜单若还挂着会被压在
   * 遮罩下面闪一帧。
   */
  function run(item) {
    cancelHide()
    open = false
    render()
    call('onRun', item)
  }

  // SFC 的六条事件：`wrap` 进出、圆钮 click / focus、菜单进出。
  // 菜单是 wrap 的子节点，几何上却在 wrap 盒子之外（绝对定位）—— 指针进菜单时
  // `mouseenter` 会按 DOM 层级重新冒到 wrap 上，所以两条都要留，别「去重」。
  el.addEventListener('mouseenter', show)
  el.addEventListener('mouseleave', hideLater)
  menu.addEventListener('mouseenter', cancelHide)
  menu.addEventListener('mouseleave', hideLater)
  button.addEventListener('click', toggle)
  button.addEventListener('focus', show)

  buildItems()
  render()

  return {
    el,
    /** 只覆盖传进来的字段；菜单项指纹变了才重建按钮。 */
    update(patch) {
      if (!patch) return
      if (Array.isArray(patch.items) && patch.items.length) {
        menuItems = patch.items.slice()
        buildItems()
      }
      render()
    },
    destroy() {
      cancelHide()
      if (el.parentNode) el.parentNode.removeChild(el)
    },
  }
}
