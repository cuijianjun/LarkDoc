/**
 * Pure DOM table picker, link form, shortcut drawer and web embed popover.
 * Factories retain stable controls and attach/remove their surfaces on update().
 * Formula editing lives with its core NodeView and uses the source anchored editor.
 */

import { applyStyle, setAttr, syncChildren } from './dom'
import { iconNode } from './icon'
import { DRAWER_GROUPS } from './shortcutGroups'
import { normalizeLinkUrl } from '../core/documentOperations'
import { placeMenu } from './menuLayout'

/** 表格选择器网格：9 列 × 9 行（对应 SFC 的 `v-for="n in 81"`）。 */
const GRID_COLUMNS = 9
const GRID_ROWS = 9

/**
 * `:value` —— 与 Vue 一致走 DOM property，且**只在真的变了才写**。
 * 每次 `update()` 都无脑赋值会把光标踢到末尾（输入到一半的公式会跳到行尾）。
 */
function setInputValue(input, value) {
  if (!input) return
  const text = value === null || value === undefined ? '' : String(value)
  if (input.value !== text) input.value = text
}

/** `@keydown.enter.prevent` —— 只认 Enter，阻止默认（否则弹窗内会触发按钮的隐式提交）。 */
function onEnter(node, run) {
  node.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    run()
  })
}

/**
 * 关闭钮（header 里的那枚）：`type=button` + `aria-label` + 图标。
 * 一律显式 `type="button"`，与 SFC 逐字段一致（`button.type` 会反射成属性）。
 */
function closeButtonNode(label, iconSize) {
  const button = document.createElement('button')
  button.type = 'button'
  button.setAttribute('aria-label', label)
  button.appendChild(iconNode('close', iconSize))
  return button
}

/**
 * 居中弹窗外壳：`.lark-doc-dialog-backdrop` > `section.lark-doc-dialog`。
 *
 * `@click.self` → 原生没有修饰符，比 `event.target === backdrop`：点弹窗内部时
 * target 是子节点，不关。
 */
function createDialogShell(label, onClose) {
  const backdrop = document.createElement('div')
  backdrop.className = 'lark-doc-dialog-backdrop'
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) onClose()
  })

  const section = document.createElement('section')
  section.className = 'lark-doc-dialog'
  section.setAttribute('role', 'dialog')
  section.setAttribute('aria-modal', 'true')
  section.setAttribute('aria-label', label)
  backdrop.appendChild(section)
  return { backdrop, section }
}

/**
 * `<header><strong>{title}</strong>[middle…]<button aria-label=…>×</button></header>`
 *
 * 表格选择器要在 strong 与「×」之间插一个 `span.lark-doc-table-grid-size`
 * （CSS 用 `margin-left: auto` 把它推到中间，断言量的 `sizeRightGap === 12`
 * 来自 `header` 的 `gap`），其余三个只有 strong + 关闭钮。
 */
function createDialogHeader(options) {
  const header = document.createElement('header')
  const strong = document.createElement('strong')
  strong.textContent = options.title
  const button = closeButtonNode(options.closeLabel, options.iconSize || 14)
  button.addEventListener('click', options.onClose)
  header.appendChild(strong)
  ;(options.middle || []).forEach((node) => header.appendChild(node))
  header.appendChild(button)
  return { header, button }
}

/** Import confirmation never blocks the renderer's task queue. */
export function createImportConfirmation({ host, message, fileName }) {
  const owner = host.ownerDocument, previous = owner.activeElement
  let settle, settled = false
  const result = new Promise(resolve => { settle = resolve })
  const close = accepted => {
    if (settled) return
    settled = true
    el.remove()
    if (previous?.isConnected) previous.focus({ preventScroll: true })
    settle(accepted)
  }
  const { backdrop: el, section } = createDialogShell('导入并替换正文', () => close(false))
  section.classList.add('lark-doc-import-confirm')
  const { header, button: dismiss } = createDialogHeader({ title: '导入文档', closeLabel: '取消导入', onClose: () => close(false) })
  dismiss.classList.add('lark-doc-import-confirm-close')
  const text = owner.createElement('p')
  text.id = `lark-doc-import-description-${Math.random().toString(36).slice(2)}`
  text.textContent = message
  section.setAttribute('aria-describedby', text.id)
  const file = owner.createElement('div')
  file.className = 'lark-doc-import-confirm-file'
  if (fileName) file.textContent = fileName
  const footer = owner.createElement('footer')
  const cancel = owner.createElement('button'), accept = owner.createElement('button')
  cancel.type = accept.type = 'button'
  cancel.textContent = '取消'; accept.textContent = '导入并替换'
  accept.className = 'primary'
  cancel.addEventListener('click', () => close(false))
  accept.addEventListener('click', () => close(true))
  footer.append(cancel, accept); section.appendChild(header)
  if (fileName) section.appendChild(file)
  section.append(text, footer)
  const controls = [dismiss, cancel, accept]
  el.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(false) }
    if (event.key === 'Tab') {
      event.preventDefault()
      const index = controls.indexOf(owner.activeElement)
      controls[(index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length].focus()
    }
  })
  host.appendChild(el)
  cancel.focus({ preventScroll: true })
  return { result, destroy: () => close(false) }
}

/** 模板保存只在宿主确认落盘后关闭；取消会由桥接层中止未完成的请求。 */
export function createTemplateSaveDialog({ host, name = '', handlers = {} }) {
  const owner = host.ownerDocument
  let destroyed = false, busy = false
  const close = () => handlers.onClose?.()
  const { backdrop, section } = createDialogShell('保存为模板', close)
  section.classList.add('lark-doc-template-save-dialog')
  const { header } = createDialogHeader({ title: '保存为模板', closeLabel: '取消保存模板', onClose: close })
  const label = owner.createElement('label'), input = owner.createElement('input')
  label.textContent = '模板名称'
  input.setAttribute('aria-label', '模板名称'); input.maxLength = 100; input.value = name
  label.appendChild(input)
  const description = owner.createElement('p')
  description.textContent = '将当前区块保存为模板，正文保持不变。模板由当前应用保存和管理。'
  const error = owner.createElement('p'); error.setAttribute('role', 'alert')
  const footer = owner.createElement('footer'), cancel = owner.createElement('button'), save = owner.createElement('button')
  cancel.type = save.type = 'button'; cancel.textContent = '取消'; save.textContent = '保存'
  save.className = 'primary'
  cancel.addEventListener('click', close)
  const sync = () => {
    if (busy && owner.activeElement === save) cancel.focus({ preventScroll: true })
    input.readOnly = busy; save.disabled = busy || !input.value.trim(); save.textContent = busy ? '保存中…' : '保存'
  }
  const submit = async () => {
    if (destroyed || busy || !input.value.trim() || handlers.isCurrent?.() === false) return
    busy = true; error.textContent = ''; sync()
    try {
      const saved = await handlers.onSave?.(input.value.trim())
      if (!destroyed && handlers.isCurrent?.() !== false && saved) close()
    } catch (failure) {
      if (!destroyed && handlers.isCurrent?.() !== false) error.textContent = failure?.message || '模板保存失败，请重试'
    } finally { if (!destroyed) { busy = false; sync() } }
  }
  input.addEventListener('input', sync); save.addEventListener('click', submit)
  backdrop.addEventListener('keydown', event => {
    if (event.isComposing || event.keyCode === 229) {
      if (event.key === 'Enter' || event.key === 'Escape') event.stopPropagation()
      return
    }
    if (event.key === 'Enter' && event.target === input) { event.preventDefault(); event.stopPropagation(); submit() }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() }
    if (event.key === 'Tab') {
      const controls = [...section.querySelectorAll('input,button')].filter(control => !control.disabled)
      const first = controls[0], last = controls[controls.length - 1]
      if (event.shiftKey && owner.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && owner.activeElement === last) { event.preventDefault(); first?.focus() }
    }
  })
  footer.append(cancel, save); section.append(header, description, label, error, footer)
  host.appendChild(backdrop); sync(); input.focus(); input.select()
  return { destroy() { destroyed = true; backdrop.remove() } }
}

/**
 * 表格选择器（`TablePickerDialog.vue`）—— 工具栏「插入表格」的**下拉面板**。
 *
 * 形态是贴按钮的非模态浮层（`position: fixed`，落点由 `positionTablePicker()` 算好塞进
 * `style`），不是居中遮罩弹窗：工具栏按钮带 caret，点/悬停展开、点外部收起，与相邻的
 * 「图表」下拉同一套交互。`.lark-doc-table-picker` 因此**没有** backdrop，
 * `aria-modal` 也不加 —— 它是浮层，不该锁住整页。
 *
 * 🔴 稳态是 **1 × 1**，不是 3 × 3：打开时先把 hover 复位成 3×3，紧跟着聚焦网格首格，
 * 首格的 `focus` 又调一次 `preview(1, 1)`。原生化照抄这条链路 —— `focusTableGrid()`
 * 必须由外层的 `tablePicker` watcher 在 `update()` 之后同步调用，别改成「直接推 1×1」，
 * 那样首格就没有焦点，`measureTablePicker()` 的 `firstFocused` 会红。
 */
export function createTablePickerDialog(options = {}) {
  const handlers = options.handlers || {}
  const host = options.host || null
  const call = (name, ...args) => {
    const fn = handlers[name]
    return typeof fn === 'function' ? fn(...args) : undefined
  }

  const state = { open: false, rows: 3, cols: 3, style: null }

  const onClose = () => call('onClose')

  const el = document.createElement('div')
  el.className = 'lark-doc-table-picker'
  el.setAttribute('role', 'dialog')
  el.setAttribute('aria-label', '插入表格')
  // 从按钮移进面板不该判成「离开」—— 与「图表」下拉同一条 hover 接力。
  el.addEventListener('mouseenter', () => call('onHoverIn'))
  el.addEventListener('mouseleave', () => call('onHoverOut'))
  // Esc 只在焦点落在网格里时才会到这儿（焦点在正文时由全局 `onWindowKeydown` 收）。
  el.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return
    event.stopPropagation()
    onClose()
  })

  const title = document.createElement('p')
  title.className = 'lark-doc-table-picker-title'
  title.textContent = '插入支持富文本的表格'

  const sizeLabel = document.createElement('span')
  sizeLabel.className = 'lark-doc-table-grid-size'

  const footer = document.createElement('div')
  footer.className = 'lark-doc-table-picker-footer'
  footer.appendChild(sizeLabel)

  const grid = document.createElement('div')
  grid.className = 'lark-doc-table-grid'
  const cells = []
  for (let index = 0; index < GRID_COLUMNS * GRID_ROWS; index += 1) {
    const row = Math.floor(index / GRID_COLUMNS) + 1
    const col = (index % GRID_COLUMNS) + 1
    const cell = document.createElement('button')
    cell.type = 'button'
    // 口径照抄 SFC：先列后行，且都是「数字 + 行/列」的中文单位。
    cell.setAttribute('aria-label', `${col}行${row}列`)
    cell.appendChild(document.createTextNode('▦'))
    // mouseenter 与 focus 走同一个入口：键盘 Tab 与鼠标划过都要预览。
    cell.addEventListener('mouseenter', () => call('onPreview', row, col))
    cell.addEventListener('focus', () => call('onPreview', row, col))
    cell.addEventListener('click', () => call('onInsert', row, col))
    cells.push(cell)
    grid.appendChild(cell)
  }

  el.appendChild(title)
  el.appendChild(grid)
  el.appendChild(footer)

  function render() {
    const text = `${state.cols} × ${state.rows}`
    if (sizeLabel.textContent !== text) sizeLabel.textContent = text
    cells.forEach((cell, index) => {
      const row = Math.floor(index / GRID_COLUMNS) + 1
      const col = (index % GRID_COLUMNS) + 1
      cell.classList.toggle('is-preview', row <= state.rows && col <= state.cols)
    })
  }

  function update(patch) {
    Object.assign(state, patch || {})
    if (!state.open) {
      if (el.parentNode) el.parentNode.removeChild(el)
      return
    }
    if (host && el.parentNode !== host) host.appendChild(el)
    // 落点由外层 `positionTablePicker()` 算好推进来；没有就不写，交给 CSS 的兜底位置。
    applyStyle(el, state.style)
    render()
  }

  return {
    el,
    update,
    /** 打开即聚焦首格 —— 稳态 1×1 就靠这条 `focus` 链。 */
    focusTableGrid() { if (cells[0] && el.parentNode) cells[0].focus() },
    destroy() { if (el.parentNode) el.parentNode.removeChild(el) },
  }
}

/**
 * 选中文字时只编辑地址；空光标插入和已有链接编辑保留文本字段。
 * 切换时增删字段行，保留输入节点与草稿；确认始终使用同一 URL 校验。
 */
export function createLinkDialog({ host, handlers = {} } = {}) {
  const el = document.createElement('div')
  el.className = 'lark-doc-link-dialog'
  el.setAttribute('role', 'dialog')
  el.setAttribute('aria-label', '设置链接')
  const state = {}
  const win = el.ownerDocument.defaultView
  function position() {
    if (!state.open || !el.isConnected) return
    let anchor = state.anchor
    if (!anchor) {
      el.style.maxWidth = el.style.maxHeight = ''
      const rect = el.getBoundingClientRect()
      anchor = { left: (win.innerWidth - rect.width) / 2, top: win.innerHeight / 2, bottom: win.innerHeight / 2 }
    }
    placeMenu(el, anchor, 8, { gap: 4 })
  }
  function input(label, name, placeholder, onInput) {
    const row = document.createElement('label')
    const caption = document.createElement('span')
    caption.textContent = label
    row.appendChild(caption)
    const field = document.createElement('input')
    field.setAttribute('aria-label', name)
    field.placeholder = placeholder
    field.spellcheck = false
    field.addEventListener('input', event => onInput?.(event.target.value))
    onEnter(field, () => handlers.onApply?.())
    row.appendChild(field)
    el.appendChild(row)
    return field
  }
  const textInput = input('文本', '链接文本', '输入文本', handlers.onTextInput)
  const valueInput = input('链接', '链接地址', '粘贴或输入链接', handlers.onValueInput)
  const textRow = textInput.parentElement, valueRow = valueInput.parentElement
  const apply = document.createElement('button')
  apply.type = 'button'
  apply.textContent = '确认'
  apply.addEventListener('click', () => handlers.onApply?.())
  el.appendChild(apply)
  el.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    handlers.onClose?.()
  })
  return {
    el,
    update(patch) {
      Object.assign(state, patch)
      if (!state.open) { win.removeEventListener('resize', position); el.remove(); return }
      state.onlyLink = !!state.insertMode && state.selection?.from !== state.selection?.to && !!state.text?.trim()
      el.classList.toggle('is-only-link', !!state.onlyLink)
      valueRow.firstChild.hidden = !!state.onlyLink
      syncChildren(el, [{ node: textRow, on: !state.onlyLink }, { node: valueRow, on: true }, { node: apply, on: true }])
      if (host && el.parentNode !== host) host.appendChild(el)
      win.addEventListener('resize', position)
      setInputValue(textInput, state.text)
      setInputValue(valueInput, state.value)
      apply.disabled = !normalizeLinkUrl(state.value)
      position()
    },
    focusFirstField() { if (el.parentNode) (state.insertMode && !state.onlyLink ? textInput : valueInput).focus() },
    destroy() { win.removeEventListener('resize', position); el.remove() },
  }
}

/**
 * 快捷键帮助抽屉（`HelpDialog.vue`）。
 *
 * 数据源是 `./shortcutGroups` 的 `DRAWER_GROUPS`（= `SHORTCUT_GROUPS` + `MARKDOWN_GROUPS`），
 * 全程静态 —— 所以分组在工厂里一次建好，`update()` 只管开合，连 `syncChildren` 都不用。
 * 结构是 `.lark-doc-drawer-mask` > `aside.lark-doc-drawer.lark-doc-help-drawer`
 * > `header.lark-doc-drawer-head` + `div.lark-doc-drawer-body` > N × `section.lark-doc-kbd-group`。
 */
export function createHelpDrawer(options = {}) {
  const handlers = options.handlers || {}
  const host = options.host || null
  const call = (name, ...args) => {
    const fn = handlers[name]
    return typeof fn === 'function' ? fn(...args) : undefined
  }

  const state = { open: false }

  const onClose = () => call('onClose')
  const el = document.createElement('div')
  el.className = 'lark-doc-drawer-mask'
  el.addEventListener('click', (event) => {
    if (event.target === el) onClose()
  })

  const drawer = document.createElement('aside')
  drawer.className = 'lark-doc-drawer lark-doc-help-drawer'
  drawer.setAttribute('role', 'dialog')
  drawer.setAttribute('aria-modal', 'true')
  drawer.setAttribute('aria-label', '快捷键帮助')
  el.appendChild(drawer)

  const head = document.createElement('header')
  head.className = 'lark-doc-drawer-head'
  const title = document.createElement('strong')
  title.textContent = '快捷键'
  // 关闭钮尺寸照 SFC 传 16（16 图标 + 24 框，但实测落地 26×26，见文件头）。
  const closeBtn = closeButtonNode('关闭快捷键帮助', 16)
  closeBtn.className = 'lark-doc-drawer-close'
  closeBtn.addEventListener('click', onClose)
  head.appendChild(title)
  head.appendChild(closeBtn)

  const body = document.createElement('div')
  body.className = 'lark-doc-drawer-body'
  DRAWER_GROUPS.forEach((group) => {
    const section = document.createElement('section')
    section.className = 'lark-doc-kbd-group'
    const groupTitle = document.createElement('h4')
    groupTitle.className = 'lark-doc-kbd-title'
    groupTitle.textContent = group.title
    section.appendChild(groupTitle)
    group.items.forEach((row) => {
      const rowEl = document.createElement('div')
      rowEl.className = 'lark-doc-kbd-row'
      const name = document.createElement('span')
      name.className = 'lark-doc-kbd-name'
      name.textContent = row[0]
      const key = document.createElement('kbd')
      key.className = 'lark-doc-kbd-key'
      key.textContent = row[1]
      rowEl.appendChild(name)
      rowEl.appendChild(key)
      section.appendChild(rowEl)
    })
    body.appendChild(section)
  })

  drawer.appendChild(head)
  drawer.appendChild(body)

  function update(patch) {
    Object.assign(state, patch || {})
    if (!state.open) {
      if (el.parentNode) el.parentNode.removeChild(el)
      return
    }
    if (host && el.parentNode !== host) host.appendChild(el)
  }

  return {
    el,
    update,
    focusClose() { if (el.parentNode) closeBtn.focus() },
    destroy() { if (el.parentNode) el.parentNode.removeChild(el) },
  }
}

/**
 * 内嵌网页「粘贴链接」浮层（`EmbedLinkDialog.vue` / P3-07）。
 *
 * 🔴 与上面三个弹窗的四处**故意不同**（原 SFC 文件头已写成红线，这里照抄）：
 * 1. 不套 `.lark-doc-dialog-backdrop`，落点由外部算好的 `position` 给（贴插入位置浮出）。
 * 2. **不绑 Esc**：实测 Esc ×1 / ×2 都关不掉，只认「点外部」与「点 ×」。
 * 3. 确认时**静默拒绝**：填空 / 填非法只是不落块、浮层留着，唯一反馈是「确认」按钮
 *    底色变浅（`.is-rejected`）。别优化成红字报错。
 * 4. 外壳是普通 div：只有 `role="dialog"`，**没有** `aria-modal` —— 非模态，读屏不该当弹窗。
 */
export function createEmbedDialog(options = {}) {
  const handlers = options.handlers || {}
  const host = options.host || null
  const call = (name, ...args) => {
    const fn = handlers[name]
    return typeof fn === 'function' ? fn(...args) : undefined
  }

  const state = { open: false, title: '', placeholder: '', value: '', rejected: false, position: null, application: false }
  let trackingViewport = false

  const el = document.createElement('div')
  el.className = 'lark-doc-embed-dialog'
  el.setAttribute('role', 'dialog')
  const win = el.ownerDocument.defaultView
  function position() {
    if (!state.open || !el.isConnected || !win) return
    const left = parseFloat(state.position?.left) || 9
    const top = parseFloat(state.position?.top) || 9
    placeMenu(el, { getBoundingClientRect: () => ({ left, right: left, top, bottom: top }) }, 9, { gap: 0 })
  }
  function stopViewportTracking() {
    if (!trackingViewport) return
    win.removeEventListener('resize', position)
    win.visualViewport?.removeEventListener('resize', position)
    win.visualViewport?.removeEventListener('scroll', position)
    trackingViewport = false
  }

  // 关闭钮是**首个子节点**（不是 header 里的第三段），顺序照 SFC。
  const closeBtn = document.createElement('button')
  closeBtn.type = 'button'
  closeBtn.className = 'lark-doc-embed-dialog-close'
  closeBtn.setAttribute('aria-label', '关闭内嵌网页链接')
  closeBtn.appendChild(iconNode('close', 14))
  closeBtn.addEventListener('click', () => call('onClose'))

  // `<header><strong>{{ ed.embedDialogTitle }}</strong></header>` —— strong 必须真挂进
  // header，否则 `<header>` 是空壳、`aria-label` 用的同一份文案在 DOM 里读不到。
  const header = document.createElement('header')
  const title = document.createElement('strong')
  header.appendChild(title)

  const input = document.createElement('input')
  input.className = 'lark-doc-embed-dialog-input'
  input.type = 'text'
  input.setAttribute('aria-label', '内嵌网页链接')
  input.addEventListener('input', (event) => call('onInput', event.target.value))
  input.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229) return
    event.preventDefault()
    call('onApply')
  })

  const footer = document.createElement('footer')
  const helpButton = document.createElement('button')
  helpButton.type = 'button'
  helpButton.className = 'lark-doc-embed-dialog-help'
  helpButton.textContent = '如何获取链接'
  helpButton.addEventListener('click', () => call('onHelp', 'howto'))

  const actions = document.createElement('div')
  actions.className = 'lark-doc-embed-dialog-actions'
  const sampleButton = document.createElement('button')
  sampleButton.type = 'button'
  sampleButton.className = 'lark-doc-embed-dialog-sample'
  sampleButton.textContent = '查看示例'
  sampleButton.addEventListener('click', () => call('onHelp', 'example'))
  const confirmButton = document.createElement('button')
  confirmButton.type = 'button'
  confirmButton.className = 'lark-doc-embed-dialog-confirm'
  confirmButton.textContent = '确认'
  confirmButton.addEventListener('click', () => call('onApply'))
  actions.appendChild(sampleButton)
  actions.appendChild(confirmButton)

  footer.appendChild(helpButton)
  footer.appendChild(actions)

  el.appendChild(closeBtn)
  el.appendChild(header)
  el.appendChild(input)
  const error = document.createElement('div')
  error.className = 'lark-doc-embed-dialog-error'
  error.setAttribute('role', 'alert')
  el.appendChild(error)
  el.appendChild(footer)

  function render() {
    // `:aria-label="ed.embedDialogTitle"` + header 里的同一个标题（两处共用一份文案）。
    setAttr(el, 'aria-label', state.title)
    el.classList.toggle('is-application', !!state.application)
    input.setAttribute('aria-label', state.application ? '应用链接' : '内嵌网页链接')
    input.setAttribute('aria-invalid', state.application && state.rejected ? 'true' : 'false')
    closeBtn.setAttribute('aria-label', state.application ? '关闭应用预览链接' : '关闭内嵌网页链接')
    error.textContent = state.application && state.rejected ? '请输入有效的 http(s) 应用链接' : ''
    error.hidden = !error.textContent
    helpButton.hidden = sampleButton.hidden = !!state.application
    if (title.textContent !== state.title) title.textContent = state.title || ''
    setAttr(input, 'placeholder', state.placeholder)
    setInputValue(input, state.value)
    confirmButton.classList.toggle('is-rejected', !!state.rejected)
    // `:style="ed.embedDialogPos"` —— 替换语义，整体覆盖 left/top。
    applyStyle(el, state.position)
    position()
  }

  function update(patch) {
    Object.assign(state, patch || {})
    if (!state.open) {
      stopViewportTracking()
      if (el.parentNode) el.parentNode.removeChild(el)
      return
    }
    if (host && el.parentNode !== host) host.appendChild(el)
    render()
    if (!trackingViewport && win) {
      win.addEventListener('resize', position)
      win.visualViewport?.addEventListener('resize', position)
      win.visualViewport?.addEventListener('scroll', position)
      trackingViewport = true
    }
  }

  return {
    el,
    update,
    focusInput() { if (el.parentNode) input.focus() },
    destroy() { stopViewportTracking(); if (el.parentNode) el.parentNode.removeChild(el) },
  }
}
