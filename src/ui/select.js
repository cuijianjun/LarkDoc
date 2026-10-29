/**
 * 共享下拉原语 —— 原生 DOM 版（`src/ui/` 积木 · 阶段 5 批次 2）。
 *
 * 与 `LarkDocSelect.vue` 是**同一份功能的两套渲染**（并存期）：
 * 工具栏、表格工具条这两支走这里；`LarkDocWorkspace.vue`（阶段 5 批次 5G 收尾时原生化）
 * 仍在用 SFC，所以 `LarkDocSelect.vue` 保留、暂不删。
 *
 * ⚠️ 结构即契约（`scripts/verify-browser-toolbar.js` 与
 * `verify-browser-element.js` 都在量这些字段）：
 *
 *   span.lark-doc-select[.lark-doc-select-open]
 *     button.lark-doc-select-trigger[type=button][role=combobox]
 *            [aria-label][title][aria-expanded][aria-haspopup=listbox][disabled]
 *       span.lark-doc-select-label    ← 当前项文案（纯文本，无 icon 包裹）
 *       span.lark-doc-select-caret.lark-doc-icon  ← chevronDown 12px
 *     div.lark-doc-select-menu[role=listbox][aria-label][style left/top/minWidth]
 *       button[type=button][role=option][aria-selected][.lark-doc-select-active][.is-highlight]
 *         span.lark-doc-select-check[aria-hidden]  ← '✓' 或 ''
 *         span                                     ← 项文案（**包在 span 里**，与标题菜单的裸文本节点不同）
 *
 * 行为契约（与 SFC 逐条对齐，改之前先看 SFC 注释）：
 * - `mousedown.preventDefault()` 保选区不丢，所以键盘导航要手动 `focus()`；
 * - hover 即打开（不聚焦、`_hoverOpened` 守卫让「点一下」不误关），离开 150ms 后关；
 * - 键盘 ↑↓ / Enter / Esc；
 * - 外部 `pointerdown`（捕获阶段）/ 滚动 / 尺寸变化 时重定位或关闭；
 * - 下方放不下翻到触发按钮上方（变高后量，故 SFC 用 `$nextTick`；原生节点同步插入，
 *   直接量 `offsetHeight` 即可，不必等一帧）。
 */

import { iconNode } from './icon'

const HOVER_CLOSE_MS = 150

/**
 * @param {object} options
 * @param {string} options.ariaLabel `role=combobox` / `role=listbox` 的 aria-label，同时兜底 title
 * @param {Array<{value: any, label: string}>} [options.options]
 * @param {any} [options.value] 当前值；未命中 options 时显示 placeholder
 * @param {boolean} [options.disabled]
 * @param {string} [options.title] 覆盖 title（默认等于 ariaLabel）
 * @param {string} [options.placeholder] value 未命中时的兜底文案
 * @param {string} [options.buttonId] 触发按钮 id（少数宿主需要 label for）
 * @param {(value: any) => void} [options.onChange] 选中新值时回调（同值不触发，与 SFC 一致）
 * @returns {{ el: HTMLSpanElement, update(state: object): void, close(): void, destroy(): void }}
 */
export function createSelect(options = {}) {
  const { ariaLabel, title = '', placeholder = '', buttonId = '', onChange } = options

  let config = {
    options: options.options || [],
    value: options.value,
    disabled: !!options.disabled,
  }
  let open = false
  let menuStyle = null
  let highlightIndex = 0
  let hoverTimer = null
  let hoverOpened = false

  const el = document.createElement('span')
  el.className = 'lark-doc-select'

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
      text.textContent = item.label

      button.appendChild(check)
      button.appendChild(text)
      menu.appendChild(button)
      rows.push({ button, check, value: item.value })
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
    trigger.disabled = config.disabled
    trigger.setAttribute('aria-expanded', open ? 'true' : 'false')
    el.classList.toggle('lark-doc-select-open', open)
  }

  function position() {
    if (!open) return
    const rect = trigger.getBoundingClientRect()
    menuStyle = {
      left: `${Math.max(8, rect.left)}px`,
      top: `${rect.bottom + 4}px`,
      minWidth: `${Math.max(rect.width, 132)}px`,
    }
    // 下方放不下时翻转到触发按钮上方。节点同步在 DOM 里，可直接量。
    const height = menu.offsetHeight
    if (rect.bottom + height + 8 > window.innerHeight && rect.top - height - 4 >= 0) {
      menuStyle = { ...menuStyle, top: `${rect.top - height - 4}px` }
    }
    menu.style.left = menuStyle.left
    menu.style.top = menuStyle.top
    menu.style.minWidth = menuStyle.minWidth
  }

  function onOutside(event) {
    if (!el.contains(event.target)) close()
  }

  function bindGlobal() {
    document.addEventListener('pointerdown', onOutside, true)
    window.addEventListener('scroll', position, true)
    window.addEventListener('resize', position)
  }

  function unbindGlobal() {
    document.removeEventListener('pointerdown', onOutside, true)
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

  /**
   * @param {object} next
   * @param {Array<{value:any,label:string}>} [next.options]
   * @param {any} [next.value]
   * @param {boolean} [next.disabled]
   */
  function update(next = {}) {
    if (next.options && signatureOf(next.options) !== rowsSignature) {
      config.options = next.options
      rebuildRows(next.options)
    } else if (next.options) {
      // 标签文案可能变（如字号 '16px' → '16 号'），但 value 序列没变：原地刷文案。
      config.options = next.options
      next.options.forEach((item, index) => {
        if (!rows[index]) return
        const text = rows[index].button.lastChild
        if (text && text.textContent !== item.label) text.textContent = item.label
      })
    }
    if ('value' in next) config.value = next.value
    if ('disabled' in next) config.disabled = next.disabled
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
    destroy() {
      clearTimeout(hoverTimer)
      hoverTimer = null
      unbindGlobal()
      if (el.parentNode) el.parentNode.removeChild(el)
    },
  }
}
