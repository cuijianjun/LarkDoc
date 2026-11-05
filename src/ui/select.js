/**
 * 共享下拉原语 —— 原生 DOM 版（`src/ui/` 积木 · 阶段 5 批次 2）。
 *
 * 这是原 `LarkDocSelect.vue` 的原生实现；工具栏、表格工具条和工作台统一走这里。
 * 旧 SFC 已移除，避免同一交互维护两套渲染路径。
 *
 * ⚠️ 结构即契约（`scripts/verify-browser-toolbar.js` 与
 * `scripts/verify-browser-element.js` 都在量这些字段）：
 *
 *   span.lark-doc-select[.lark-doc-select-open][.自定义 className]
 *     button.lark-doc-select-trigger[type=button][role=combobox]
 *            [aria-label][title][aria-expanded][aria-haspopup=listbox][disabled]
 *       span.lark-doc-select-icon       ← **可选**前导图标（只有传了 icon 才有这个节点）
 *       span.lark-doc-select-label      ← 当前项文案（纯文本，无 icon 包裹）
 *       span.lark-doc-select-caret.lark-doc-icon  ← chevronDown 12px
 *     div.lark-doc-select-menu[role=listbox][aria-label][style left/top/minWidth]
 *       button[type=button][role=option][aria-selected][.lark-doc-select-active][.is-highlight]
 *            [.has-hint]
 *         span.lark-doc-select-check[aria-hidden]  ← '✓' 或 ''
 *         span.lark-doc-select-text
 *           span.lark-doc-select-item-label         ← 项文案（**包在 span 里**）
 *           span.lark-doc-select-item-hint          ← 可选副标题（只有传了 hint 才有）
 *
 * 行为契约（与 SFC 逐条对齐，改之前先看 SFC 注释）：
 * - `mousedown.preventDefault()` 保选区不丢，所以键盘导航要手动 `focus()`；
 * - hover 即打开（不聚焦、`_hoverOpened` 守卫让「点一下」不误关），离开 150ms 后关；
 * - 键盘 ↑↓ / Enter / Esc；
 * - 打开期间 Esc 在**任何**焦点下都能收起（监听挂在 document 上，不 preventDefault）；
 * - 外部 `pointerdown`（捕获阶段）/ 滚动 / 尺寸变化 时重定位或关闭；
 * - 下方放不下翻到触发按钮上方（变高后量，故 SFC 用 `$nextTick`；原生节点同步插入，
 *   直接量 `offsetHeight` 即可，不必等一帧）；
 * - 右侧越界时整块左移（`minWidth` 先算，再夹到视口内）——顶栏模式切换按钮贴着右边界，
 *   只按 `left = rect.left` 摆会把菜单推出视口。
 */

import { iconNode, setIcon } from './icon'

const HOVER_CLOSE_MS = 150

/**
 * @param {object} options
 * @param {string} options.ariaLabel `role=combobox` / `role=listbox` 的 aria-label，同时兜底 title
 * @param {Array<{value: any, label: string, hint?: string}>} [options.options]
 * @param {any} [options.value] 当前值；未命中 options 时显示 placeholder
 * @param {boolean} [options.disabled]
 * @param {string} [options.title] 覆盖 title（默认等于 ariaLabel）
 * @param {string} [options.placeholder] value 未命中时的兜底文案
 * @param {string} [options.buttonId] 触发按钮 id（少数宿主需要 label for）
 * @param {string} [options.className] 额外根类名（宿主换皮用，如 `lark-doc-mode-select`）
 * @param {number} [options.menuMinWidth] 菜单最小宽度，默认 132
 * @param {string} [options.icon] 触发按钮前导图标（`icons.js` 的键）；不传则没有图标节点
 * @param {(value: any) => void} [options.onChange] 选中新值时回调（同值不触发，与 SFC 一致）
 * @returns {{ el: HTMLSpanElement, update(state: object): void, close(): void, destroy(): void }}
 */
export function createSelect(options = {}) {
  const {
    ariaLabel,
    title = '',
    placeholder = '',
    buttonId = '',
    onChange,
    className = '',
    menuMinWidth = 132,
    icon = '',
  } = options

  let config = {
    options: options.options || [],
    value: options.value,
    disabled: !!options.disabled,
  }
  let iconName = icon || ''
  let open = false
  let menuStyle = null
  let highlightIndex = 0
  let hoverTimer = null
  let hoverOpened = false

  const el = document.createElement('span')
  el.className = className ? `lark-doc-select ${className}` : 'lark-doc-select'

  const trigger = document.createElement('button')
  trigger.type = 'button'
  trigger.className = 'lark-doc-select-trigger'
  trigger.setAttribute('role', 'combobox')
  trigger.setAttribute('aria-label', ariaLabel)
  trigger.setAttribute('title', title || ariaLabel)
  trigger.setAttribute('aria-expanded', 'false')
  trigger.setAttribute('aria-haspopup', 'listbox')
  if (buttonId) trigger.id = buttonId

  const labelNode = document.createElement('span')
  labelNode.className = 'lark-doc-select-label'
  trigger.appendChild(labelNode)
  trigger.appendChild(iconNode('chevronDown', 12, 'lark-doc-select-caret'))

  el.appendChild(trigger)

  /**
   * 前导图标是**按需存在**的：字号/字体/行高这些纯文字下拉不该多一个空 span
   * （空 span 也占 `gap`，会让按钮凭空宽 4px）。所以有图标才插，图标变了原地换
   * （`setIcon`），图标没了就摘掉。
   */
  let iconEl = null
  function paintIcon(name) {
    if (!name) {
      if (iconEl && iconEl.parentNode) iconEl.parentNode.removeChild(iconEl)
      iconEl = null
      return
    }
    if (!iconEl) {
      iconEl = iconNode(name, 16, 'lark-doc-select-icon')
      trigger.insertBefore(iconEl, labelNode)
      return
    }
    setIcon(iconEl, name, 16)
  }

  // 弹层常驻创建、按需挂载：v-if 等价语义 = 「不在 DOM 里」，不是 display:none。
  const menu = document.createElement('div')
  menu.className = 'lark-doc-select-menu'
  menu.setAttribute('role', 'listbox')
  menu.setAttribute('aria-label', ariaLabel)

  /** 选项行：只在 options 变化时重建（同一份常量数组反复 update 时零开销）。 */
  let rows = []
  let rowsSignature = ''

  function signatureOf(list) {
    return list.map((item) => String(item.value)).join('\u0001')
  }

  function rebuildRows(list) {
    rows = []
    menu.textContent = ''
    list.forEach((item, index) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.setAttribute('role', 'option')
      button.setAttribute('aria-selected', 'false')
      button.addEventListener('mousedown', (event) => event.preventDefault())
      button.addEventListener('click', () => choose(item.value))
      button.addEventListener('mouseenter', () => {
        highlightIndex = index
        paintRows()
      })

      const check = document.createElement('span')
      check.className = 'lark-doc-select-check'
      check.setAttribute('aria-hidden', 'true')

      const text = document.createElement('span')
      text.className = 'lark-doc-select-text'
      const labelEl = document.createElement('span')
      labelEl.className = 'lark-doc-select-item-label'
      labelEl.textContent = item.label
      text.appendChild(labelEl)

      let hintEl = null
      if (item.hint) {
        hintEl = document.createElement('span')
        hintEl.className = 'lark-doc-select-item-hint'
        hintEl.textContent = item.hint
        text.appendChild(hintEl)
        button.classList.add('has-hint')
      }

      button.appendChild(check)
      button.appendChild(text)
      menu.appendChild(button)
      rows.push({ button, check, value: item.value, labelEl, hintEl })
    })
    rowsSignature = signatureOf(list)
    paintRows()
  }

  /** 只改属性/类名，不重建节点（重建会把 hover 高亮与焦点一起打乱）。 */
  function paintRows() {
    rows.forEach((row, index) => {
      const active = row.value === config.value
      row.button.classList.toggle('lark-doc-select-active', active)
      row.button.classList.toggle('is-highlight', index === highlightIndex)
      row.button.setAttribute('aria-selected', active ? 'true' : 'false')
      row.check.textContent = active ? '✓' : ''
    })
  }

  function currentLabel() {
    const hit = config.options.find((item) => item.value === config.value)
    if (hit) return hit.label
    return placeholder || (config.options[0] && config.options[0].label) || ''
  }

  function paintTrigger() {
    labelNode.textContent = currentLabel()
    paintIcon(iconName)
    trigger.disabled = config.disabled
    trigger.setAttribute('aria-expanded', open ? 'true' : 'false')
    el.classList.toggle('lark-doc-select-open', open)
  }

  function position() {
    if (!open) return
    const rect = trigger.getBoundingClientRect()
    const minWidth = Math.max(rect.width, menuMinWidth)
    // 先钉宽、再量高：宽度决定文案折不折行，顺序倒过来会拿到偏高的 offsetHeight，
    // 于是「下方放不放得下」判错，菜单该翻上去的时候不翻。
    menu.style.minWidth = `${minWidth}px`
    let left = Math.max(8, rect.left)
    // 右缘越界时整块左移：顶栏「文档模式」按钮贴右边，left = rect.left 会把菜单推出视口。
    if (left + minWidth > window.innerWidth - 8) left = Math.max(8, window.innerWidth - minWidth - 8)
    let top = rect.bottom + 4
    // 下方放不下时翻转到触发按钮上方。节点同步在 DOM 里，可直接量。
    const height = menu.offsetHeight
    if (top + height + 8 > window.innerHeight && rect.top - height - 4 >= 0) top = rect.top - height - 4
    menuStyle = { left: `${left}px`, top: `${top}px`, minWidth: `${minWidth}px` }
    menu.style.left = menuStyle.left
    menu.style.top = menuStyle.top
  }

  function onOutside(event) {
    if (!el.contains(event.target)) close()
  }

  // Esc 不依赖焦点：菜单是 fixed 浮层，挂着它的时候焦点常常已经不在触发按钮上。
  // 只关自己的菜单，不 preventDefault / 不 stopPropagation（Esc 还要关别的浮层）。
  function onEscape(event) {
    if (event.key === 'Escape') close()
  }

  function bindGlobal() {
    document.addEventListener('pointerdown', onOutside, true)
    document.addEventListener('keydown', onEscape)
    window.addEventListener('scroll', position, true)
    window.addEventListener('resize', position)
  }

  function unbindGlobal() {
    document.removeEventListener('pointerdown', onOutside, true)
    document.removeEventListener('keydown', onEscape)
    window.removeEventListener('scroll', position, true)
    window.removeEventListener('resize', position)
  }

  function openMenu() {
    if (open) return
    open = true
    const current = config.options.findIndex((item) => item.value === config.value)
    highlightIndex = current === -1 ? 0 : current
    paintTrigger()
    paintRows()
    el.appendChild(menu)
    position()
    bindGlobal()
  }

  function close() {
    if (!open) return
    open = false
    menuStyle = null
    menu.style.left = ''
    menu.style.top = ''
    menu.style.minWidth = ''
    paintTrigger()
    if (menu.parentNode) menu.parentNode.removeChild(menu)
    unbindGlobal()
  }

  function choose(value) {
    if (value !== config.value && onChange) onChange(value)
    close()
  }

  function scheduleHoverClose() {
    clearTimeout(hoverTimer)
    hoverTimer = setTimeout(() => {
      hoverTimer = null
      hoverOpened = false
      if (open) close()
    }, HOVER_CLOSE_MS)
  }

  trigger.addEventListener('mousedown', (event) => event.preventDefault())
  trigger.addEventListener('mouseenter', () => {
    if (config.disabled) return
    clearTimeout(hoverTimer)
    if (!open) {
      hoverOpened = true
      openMenu()
    }
  })
  trigger.addEventListener('mouseleave', scheduleHoverClose)
  trigger.addEventListener('click', () => {
    if (config.disabled) return
    // hover 已打开时点击不关闭（飞书行为：hover 弹窗靠移开鼠标关闭）。
    if (open && hoverOpened) return
    if (open) {
      close()
      return
    }
    openMenu()
    // mousedown.prevent 拦掉了原生聚焦，键盘导航需要焦点在触发按钮上；hover 打开不聚焦。
    trigger.focus()
  })
  trigger.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (!open) {
        openMenu()
        return
      }
      const total = config.options.length
      if (total) highlightIndex = (highlightIndex + 1 + total) % total
      paintRows()
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) {
        openMenu()
        return
      }
      const total = config.options.length
      if (total) highlightIndex = (highlightIndex - 1 + total) % total
      paintRows()
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (!open) {
        openMenu()
        return
      }
      const item = config.options[highlightIndex]
      if (item) choose(item.value)
    } else if (event.key === 'Escape') {
      // SFC 是 `@keydown.esc.stop`：只停冒泡、不 preventDefault（Esc 仍要关别的浮层）。
      event.stopPropagation()
      close()
    }
  })

  menu.addEventListener('mouseenter', () => {
    clearTimeout(hoverTimer)
    hoverTimer = null
  })
  menu.addEventListener('mouseleave', scheduleHoverClose)

  rebuildRows(config.options)
  paintTrigger()

  /** 「副标题出现/消失」或行数变了，只能重建（行内布局不同，原地改属性补不出来）。 */
  function hintLayoutChanged(list) {
    if (list.length !== rows.length) return true
    return list.some((item, index) => Boolean(item.hint) !== Boolean(rows[index] && rows[index].hintEl))
  }

  /**
   * @param {object} next
   * @param {Array<{value:any,label:string,hint?:string}>} [next.options]
   * @param {any} [next.value]
   * @param {boolean} [next.disabled]
   * @param {string} [next.icon] 触发按钮前导图标（传空串 = 摘掉图标）
   * @param {string} [next.ariaLabel] 覆盖 aria-label（顶栏要拼「当前 X」）
   */
  function update(next = {}) {
    if (next.options && signatureOf(next.options) !== rowsSignature) {
      config.options = next.options
      rebuildRows(next.options)
    } else if (next.options) {
      config.options = next.options
      if (hintLayoutChanged(next.options)) {
        rebuildRows(next.options)
      } else {
        // 标签/副标题文案可能变（如字号 '16px' → '16 号'），但 value 序列没变：原地刷文案。
        next.options.forEach((item, index) => {
          const row = rows[index]
          if (!row) return
          if (row.labelEl.textContent !== item.label) row.labelEl.textContent = item.label
          if (row.hintEl && row.hintEl.textContent !== item.hint) row.hintEl.textContent = item.hint
        })
      }
    }
    if ('value' in next) config.value = next.value
    if ('disabled' in next) config.disabled = next.disabled
    if ('icon' in next) iconName = next.icon || ''
    if (next.ariaLabel) trigger.setAttribute('aria-label', next.ariaLabel)
    // 只读态下弹层若开着，必须收掉 —— 否则禁用按钮上还挂着一个可点的列表。
    if (config.disabled && open) close()
    paintTrigger()
    paintRows()
    if (open) position()
  }

  return {
    el,
    update,
    close,
    /** 当前是否展开（宿主做「只能开一个浮层」的排斥时用得上）。 */
    isOpen() { return open },
    destroy() {
      clearTimeout(hoverTimer)
      hoverTimer = null
      unbindGlobal()
      if (el.parentNode) el.parentNode.removeChild(el)
    },
  }
}
