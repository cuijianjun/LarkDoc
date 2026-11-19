/**
 * 区块句柄 + 块菜单 —— 原生 DOM 版（`src/ui/` 积木 · 阶段 5 批次 3）。
 *
 * 原 SFC `editor/BlockHandleMenu.vue` 已在阶段 5 批次 3 删除，这里是唯一实现。
 * **结构即契约**：`scripts/verify-browser-block-menu.js` 37 条断言在逐字段量这里
 * 产出的 DOM —— 句柄盒模型与垂直对齐、遮罩（不在本模块）、块菜单段序、
 * 子菜单几何、表格分支、空段落分支，全都不能凭手感改。
 *
 * 三条规矩（与 `toolbar.js` / `bubbleBar.js` 一致）：
 * 1. **结构即契约**：类名 / `role` / `aria-*` / 段序逐字段复刻 SFC；
 *    `v-if` → 真的 insert/remove，`v-show` → `style.display`。
 * 2. **一次建节点、之后只改属性**：只有类型网格、操作列表、颜色三处是动态列表，
 *    按签名重建。
 * 3. **同步定位**：节点同步插入 DOM，`getBoundingClientRect()` 立刻可量 ——
 *    SFC 里 `openBlockMenu` → `$nextTick(positionBlockMenu)` 的时序点就此消灭。
 *
 * ⚠️ 两段式更新（性能很硬）：`updateChrome()` 只写句柄本体，`positionBlockHandle`
 * 在 `pointermove` 上每秒要跑几十次，绝不能顺带重算类型网格（9 次 `blockTypeActive`
 * 各要一次 `doc.resolve`）；`updateMenu()` 才重算菜单内容。
 * 但**两者都要重排根节点的子节点** —— 菜单节点的挂/摘由同一份 state 决定，
 * 各自维护一份会互相摘掉对方的节点。
 */

import { iconNode } from './icon'
import { createBlockHandleMenus } from './blockHandleMenus'
import { bindHoverTips } from './hoverTips'
import { applyStyle, setAttr, syncChildren } from './dom'

/**
 * @param {object} options
 * @param {object} [options.handlers] 全部交互回调（键名与 SFC 里的 `ed.xxx` 一一对应）
 * @param {HTMLElement|null} [options.host] 挂载宿主（`.lark-doc-paper`）
 * @param {HTMLElement|null} [options.anchor] 插入位置锚点（句柄插在它**前面**）
 * @returns {object} `el` / `updateChrome` / `updateMenu` / 若干元素引用 / `destroy`
 */
export function createBlockHandle(options = {}) {
  const handlers = options.handlers || {}
  const host = options.host || null
  const anchor = options.anchor || null
  let destroyed = false

  const call = (name, ...args) => {
    if (destroyed || !state.visible || !el.isConnected || state.actionDisabled) return
    const fn = handlers[name]
    return typeof fn === 'function' ? fn(...args) : undefined
  }

  // ————————————————— 状态（唯一真相） —————————————————
  // 由于 DOM 不再由 Vue 驱动，state 必须留在本模块里：`updateChrome` 只知道
  // 「菜单开着吗」，`updateMenu` 只知道「句柄是哪种按钮」，而两者都要重排根节点
  // 子节点。合并到一份 state 上才不会互相踩。
  const state = {
    visible: false,
    style: null,
    menuOpen: false,
    alignOpen: false,
    colorOpen: false,
    blockStyle: true,
    buttonKind: 'none',
    glyph: 'T',
    icon: 'block-text',
    isCallout: false,
    draggable: true,
    features: {},
    typeActions: [],
    listActions: [],
    table: false,
    tableHeader: { row: false, column: false },
    canDuplicate: false,
    canAddBelow: false,
    colors: [],
    // 三个菜单容器的定位 style（`position: absolute` 的块菜单 + 两个 `fixed` 子菜单）。
    // 不进 state 就会永远停在 (0,0)：它们是 data 赋值，原生层不感知。
    menuStyle: {},
    alignMenuStyle: {},
    colorMenuStyle: {},
    align: { value: 'left', indent: 0, canIncrease: false },
    alignGlyphs: {},
    alignNames: {},
  }

  // ————————————————— 基础工厂 —————————————————

  /** `@mousedown.prevent` —— 菜单里每个按钮都要，否则按下会抢焦点、菜单当场关掉。 */
  function preventMouseDown(node) {
    node.addEventListener('mousedown', (event) => event.preventDefault())
    return node
  }

  /** 菜单里「图标 + 文案」的普通行（模板里 `<lark-doc-icon/><span>` 这个固定搭配）。 */
  function makeIconLabel(icon, size, text, className) {
    const node = document.createElement('span')
    if (className) node.className = className
    node.textContent = text
    return [iconNode(icon, size, 'lark-doc-block-menu-icon'), node]
  }

  // ————————————————— ① 句柄本体 —————————————————

  const el = document.createElement('div')
  el.className = 'lark-doc-block-handle'
  el.addEventListener('mouseenter', (event) => call('onHandleEnter', event))
  el.addEventListener('mouseleave', (event) => call('onHandleLeave', event))

  // 空段落：句柄换成「＋」，点开的是插入内容命令菜单（不是块菜单）。
  const emptyButton = preventMouseDown(document.createElement('button'))
  emptyButton.type = 'button'
  emptyButton.className = 'lark-doc-empty-block-insert'
  emptyButton.setAttribute('aria-label', '插入内容')
  emptyButton.setAttribute('aria-haspopup', 'menu')
  emptyButton.appendChild(iconNode('plus', 18, 'lark-doc-empty-block-icon'))
  const emptyText = document.createElement('span')
  emptyText.className = 'sr-only'
  emptyText.textContent = '＋'
  emptyButton.appendChild(emptyText)
  emptyButton.addEventListener('mouseenter', (event) => {
    if (event.sourceCapabilities?.firesTouchEvents || emptyButton.ownerDocument.defaultView?.matchMedia?.('(hover: none)')?.matches) return
    call('openEmptyBlockInsertMenu', event)
  })
  emptyButton.addEventListener('mouseleave', () => call('scheduleCommandMenuClose'))
  emptyButton.addEventListener('click', (event) => call('openEmptyBlockInsertMenu', event))

  const mainButton = document.createElement('button')
  mainButton.type = 'button'
  mainButton.className = 'lark-doc-block-handle-main'
  mainButton.setAttribute('aria-label', '块操作')
  mainButton.setAttribute('data-tooltip-none', '')
  mainButton.setAttribute('aria-haspopup', 'menu')
  mainButton.setAttribute('draggable', 'true')
  mainButton.addEventListener('mouseenter', (event) => { if (!state.mobile) call('openBlockMenuOnHover', event) })
  mainButton.addEventListener('focus', (event) => { if (!state.mobile) call('openBlockMenuOnHover', event) })
  mainButton.addEventListener('click', (event) => call('openBlockMenu', event))
  mainButton.addEventListener('pointerdown', (event) => call('pressHandle', event))
  mainButton.addEventListener('dragstart', (event) => call('startBlockDrag', event))
  mainButton.addEventListener('dragend', (event) => call('endBlockDrag', event))

  const glyphNode = document.createElement('span')
  glyphNode.className = 'lark-doc-block-handle-type'
  let glyphIcon = iconNode('block-text', 18, 'lark-doc-block-handle-icon')
  glyphIcon.dataset.icon = 'block-text'
  const glyphText = document.createElement('span')
  glyphText.className = 'sr-only'
  glyphText.textContent = 'T'
  glyphNode.appendChild(glyphIcon)
  glyphNode.appendChild(glyphText)
  const dotsNode = document.createElement('span')
  dotsNode.className = 'lark-doc-block-handle-dots'
  dotsNode.setAttribute('aria-hidden', 'true')
  const dots = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  dots.setAttribute('viewBox', '0 0 12 18'); dots.setAttribute('width', '12'); dots.setAttribute('height', '18'); dots.setAttribute('fill', 'currentColor')
  for (const cy of [4, 9, 14]) for (const cx of [4, 8]) {
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
    dot.setAttribute('cx', String(cx)); dot.setAttribute('cy', String(cy)); dot.setAttribute('r', '1'); dots.appendChild(dot)
  }
  dotsNode.appendChild(dots)
  mainButton.appendChild(glyphNode)
  mainButton.appendChild(dotsNode)

  // One menu owner, two explicit targets: the table and its current cell block.
  const secondary = document.createElement('div')
  secondary.className = 'lark-doc-block-handle lark-doc-block-handle-secondary'
  secondary.addEventListener('mouseenter', event => call('onHandleEnter', event))
  secondary.addEventListener('mouseleave', event => call('onHandleLeave', event))
  const secondaryButton = mainButton.cloneNode(true)
  secondaryButton.classList.add('lark-doc-block-handle-extra')
  secondary.appendChild(secondaryButton)
  let secondaryPressed = null
  const activate = event => call('activateSecondary', state.secondary, event)
  secondaryButton.addEventListener('mouseenter', event => {
    if (document.activeElement !== mainButton) activate(event)
  })
  secondaryButton.addEventListener('mousemove', event => {
    if (document.activeElement === mainButton && !event.buttons && (event.movementX || event.movementY)) activate(event)
  })
  secondaryButton.addEventListener('focus', event => {
    if (activate(event)) mainButton.focus({ preventScroll: true })
  })
  secondaryButton.addEventListener('click', activate)
  secondaryButton.addEventListener('pointerdown', event => {
    event.preventDefault(); secondaryPressed = state.secondary
    if (activate(event)) call('pressHandle')
  })
  secondaryButton.addEventListener('dragstart', event => {
    if (call('activateSecondary', secondaryPressed || state.secondary, event)) call('startBlockDrag', event)
    else event.preventDefault()
  })
  secondaryButton.addEventListener('pointerup', () => { secondaryPressed = null })
  secondaryButton.addEventListener('dragend', event => { secondaryPressed = null; call('endBlockDrag', event) })

  // ————————————————— ② 块菜单外壳 —————————————————

  const menuEl = document.createElement('div')

  menuEl.className = 'lark-doc-block-menu'

  menuEl.setAttribute('role', 'menu')

  menuEl.setAttribute('aria-label', '块操作')

  menuEl.addEventListener('mouseenter', () => call('onBlockMenuEnter'))

  menuEl.addEventListener('mouseleave', (event) => call('onBlockMenuLeave', event))

  menuEl.addEventListener('focusin', () => call('onBlockMenuFocusIn'))

  menuEl.addEventListener('focusout', (event) => call('onBlockMenuFocusOut', event))

  function makeSubmenuTrigger(icon, label, onOpen) {
    const button = preventMouseDown(document.createElement('button'))
    button.type = 'button'
    button.setAttribute('role', 'menuitem')
    button.className = 'lark-doc-block-submenu-trigger'
    button.setAttribute('aria-haspopup', 'menu')
    button.setAttribute('aria-expanded', 'false')
    button.setAttribute('title', label)
    button.addEventListener('mouseenter', (event) => {
      if (event.sourceCapabilities?.firesTouchEvents || button.ownerDocument.defaultView?.matchMedia?.('(hover: none)')?.matches) return
      onOpen(event)
    })
    button.addEventListener('focus', (event) => onOpen(event))
    button.addEventListener('click', (event) => { event.stopPropagation(); onOpen(event) })
    const [iconEl, textEl] = makeIconLabel(icon, 18, label)
    const arrow = iconNode('link-view-caret', 14, 'lark-doc-block-menu-arrow')
    arrow.setAttribute('aria-hidden', 'true')
    button.appendChild(iconEl)
    button.appendChild(textEl)
    button.appendChild(arrow)
    return button
  }

  const alignTrigger = makeSubmenuTrigger('align-left', '缩进和对齐', (event) => call('openBlockAlignMenuOnHover', event))

  const colorTrigger = makeSubmenuTrigger('palette', '颜色', (event) => call('openBlockColorMenuOnHover', event))

  const colorMenu = document.createElement('div')

  colorMenu.className = 'lark-doc-block-submenu lark-doc-block-color-submenu'

  colorMenu.setAttribute('role', 'menu')

  colorMenu.setAttribute('aria-label', '颜色')

  const alignMenu = document.createElement('div')

  alignMenu.className = 'lark-doc-block-submenu'

  alignMenu.setAttribute('role', 'menu')

  alignMenu.setAttribute('aria-label', '缩进和对齐')

  const tips = bindHoverTips(menuEl)
  const menusVisible = () => !!(state.visible && (state.menuOpen || state.alignOpen || state.colorOpen))
  let menuReadyNotified = false
  const menus = createBlockHandleMenus({
    host: menuEl, state, call, menuEl, alignMenu, colorMenu, alignTrigger, colorTrigger, preventMouseDown, makeIconLabel,
    onReady: () => {
      if (destroyed || menuReadyNotified) return
      menuReadyNotified = true
      if (!menusVisible()) return
      renderRoot()
      options.onMenuReady?.()
    },
  })

  function renderRoot() {
    if (!state.menuOpen || !state.visible) tips.hide()
    if (!el.parentNode && state.visible && host) host.insertBefore(el, anchor || null)
    if (el.parentNode && !state.visible) el.parentNode.removeChild(el)
    if (secondary.parentNode && (!state.visible || !state.secondary)) secondary.remove()
    if (!state.visible) return
    setAttr(mainButton, 'data-block-scope', state.scope)
    if (state.secondary) {
      const target = state.secondary
      applyStyle(secondary, target.style)
      setAttr(secondaryButton, 'data-block-scope', target.scope)
      setAttr(secondaryButton, 'aria-label', target.scope === 'table' ? '整表块操作' : '单元格块操作')
      setAttr(secondaryButton, 'draggable', String(!!state.draggable))
      const glyph = secondaryButton.querySelector('.lark-doc-block-handle-type')
      if (glyph.dataset.icon !== target.icon) { glyph.textContent = ''; glyph.appendChild(iconNode(target.icon, 18)); glyph.dataset.icon = target.icon }
      if (!secondary.parentNode && host) host.insertBefore(secondary, anchor || null)
    }
    el.classList.toggle('is-menu-open', !!state.menuOpen)
    el.classList.toggle('is-mobile-handle', !!state.mobile)
    applyStyle(el, state.style)
    syncChildren(el, [
      { node: emptyButton, on: state.buttonKind === 'empty' },
      { node: mainButton, on: state.buttonKind === 'main' },
      { node: menuEl, on: !!state.menuOpen },
      // `v-if="blockAlignMenuOpen && featureEnabled('blockStyle')"` —— 门控在 state 里折好
      { node: alignMenu, on: !!state.alignOpen },
    ])
  }

  function renderMenu() { menus.update({ open: menusVisible() }) }

  // ————————————————— 对外 —————————————————

  /**
   * 句柄本体（`pointermove` 热路径）。**不碰菜单内容** —— 见文件头。
   * @param {object} patch
   */
  function updateChrome(patch) {
    if (destroyed) return
    const wasMenuVisible = menusVisible()
    Object.assign(state, patch || {})
    if (patch && patch.glyph !== undefined && glyphNode.textContent !== String(state.glyph)) {
      glyphText.textContent = String(state.glyph)
    }
    if (patch && patch.icon !== undefined && glyphIcon.dataset.icon !== state.icon) {
      const svg = iconNode(state.icon || 'block-text', 18, 'lark-doc-block-handle-icon')
      svg.dataset.icon = state.icon || 'block-text'
      glyphNode.replaceChild(svg, glyphIcon)
      glyphIcon = svg
    }
    if (patch && patch.isCallout !== undefined) mainButton.classList.toggle('is-callout', !!state.isCallout)
    if (patch && patch.draggable !== undefined) setAttr(mainButton, 'draggable', String(!!state.draggable))
    setAttr(mainButton, 'aria-disabled', String(!!state.actionDisabled))
    renderRoot()
    if (wasMenuVisible && !menusVisible()) menus.update({ open: false })
  }

  /**
   * 菜单内容（开合、类型网格、颜色、表格开关、对齐）。所有字段一次推平。
   * @param {object} patch
   */
  function updateMenu(patch) {
    if (destroyed) return
    Object.assign(state, patch || {})
    setAttr(mainButton, 'aria-disabled', String(!!state.actionDisabled))
    renderRoot()
    renderMenu()
  }

  let lastMenu = null

  return {
    el,
    updateChrome,
    updateMenu,
    update(patch) {
      if (patch.chrome) updateChrome(patch.chrome)
      if (patch.menu && patch.menu !== lastMenu) { lastMenu = patch.menu; updateMenu(patch.menu) }
    },
    // 定位要用的节点引用：调用方以前靠 `querySelector` 反查，原生层直接给。
    get mainEl() { return mainButton },
    get menuEl() { return menuEl },
    get alignMenuEl() { return alignMenu },
    get colorMenuEl() { return colorMenu },
    get alignTrigger() { return alignTrigger },
    get colorTrigger() { return colorTrigger },
    destroy() {
      destroyed = true; state.visible = false
      tips.destroy()
      menus.destroy()
      secondary.remove()
      if (el.parentNode) el.parentNode.removeChild(el)
    },
  }
}
