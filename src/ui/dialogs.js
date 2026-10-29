/**
 * 弹窗 / 抽屉 / 内嵌浮层 —— 原生 DOM 版（`src/ui/` 积木 · 阶段 5 批次 4）。
 *
 * 原 SFC `components/lark-doc/editor/dialogs/` 下的 5 个文件在本批次删除，这里是唯一实现：
 * 表格选择器 / 公式 / 链接 / 快捷键抽屉 / 内嵌网页浮层。
 * `scripts/verify-browser-dialogs.js` 的 52 条断言在逐字段量这里产出的 DOM
 * （`.lark-doc-dialog` 的宽 `min(420px,100%)` + padding 19 + radius 10、header 三段序、
 * 81 格网格的 `aria-label` 口径「{列}行{行}列」、抽屉 314 宽右贴边 + 关闭钮 26×26、
 * 内嵌浮层 540×164 / radius 8 / z-index 99 + footer 三段序），改之前先跑一遍。
 *
 * 四条与其它积木一致的规矩：
 * 1. **结构即契约**：类名 / `role` / `aria-*` / 段序逐字段复刻 SFC。
 * 2. **`v-if` → 真 insert/remove**：条件段（公式错误行、链接的「链接文本」与首段提示）
 *    一律走 `syncChildren`，不能只 `display:none` —— 断言量的是
 *    `querySelectorAll('label').length` 与 `paragraphs.length`，节点还在就会多算一项。
 * 3. **一次建节点、之后只改属性**：81 格网格、抽屉分组都在工厂里建好，`update()` 只切
 *    `is-preview` 与文案；重建会把焦点、hover 态与鼠标下的节点一起丢掉。
 * 4. **关闭即摘节点**：五个弹层各自是 `v-if`，`open: false` 时 `el` 从宿主摘掉，
 *    下次打开是一棵干净的子树（与 Vue 的销毁语义一致）。
 *
 * ⚠️ 三处**故意不统一**，别顺手改成「看起来更合理」的样子：
 * - `HelpDrawer` 是抽屉外壳（`.lark-doc-drawer-mask` + `.lark-doc-drawer`，右贴边全高），
 *   不是居中弹窗；关闭钮实测 **26×26** —— `.lark-doc button[aria-label^="关闭"]` 的 26px
 *   特异性盖住了 `.lark-doc-drawer-close` 的 24，别按 CSS 里的 24 写断言。
 * - `EmbedDialog` 不套 backdrop、不绑 Esc、外壳没有 `aria-modal`：它是贴着插入位置的
 *   非模态浮层，唯一全局关闭点是 `overlayDismissMixin.onDocumentPointerDown`。
 * - 表格选择器**没有** Esc 处理（靠根元素 `@keydown.esc` 冒泡到 `closeOverlay`），
 *   公式与链接则各自 `stop + prevent` 一层，避免同一次 Esc 被根元素重复消费。
 */

import { applyStyle, setAttr, syncChildren } from './dom'
import { iconNode } from './icon'
import { DRAWER_GROUPS } from './shortcutGroups'

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
function createDialogShell(label, onClose, options = {}) {
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
  // `@keydown.esc.stop.prevent`：只有公式 / 链接两个 SFC 写了，表格选择器刻意没有。
  if (options.closeOnEsc) {
    section.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      event.preventDefault()
      onClose()
    })
  }
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

/**
 * 表格选择器（`TablePickerDialog.vue`）。
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

  const state = { open: false, rows: 3, cols: 3 }

  const onClose = () => call('onClose')
  const { backdrop: el, section } = createDialogShell('插入表格', onClose)

  const sizeLabel = document.createElement('span')
  sizeLabel.className = 'lark-doc-table-grid-size'

  const { header } = createDialogHeader({ title: '插入表格', closeLabel: '关闭表格选择', iconSize: 14, onClose, middle: [sizeLabel] })

  const hint = document.createElement('p')
  hint.textContent = '插入支持富文本的表格'

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

  section.appendChild(header)
  section.appendChild(hint)
  section.appendChild(grid)

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
 * 公式对话框（`MathDialog.vue`）。
 *
 * 错误行是 `v-if`：`role="alert"` 的 `p` 在无错时**真的不在 DOM 里**
 * （断言 `measureDialog().hasAlert === false`）。输入框 `@keydown.enter.prevent`
 * 直接提交，与「插入」按钮同一条路径。
 */
export function createMathDialog(options = {}) {
  const handlers = options.handlers || {}
  const host = options.host || null
  const call = (name, ...args) => {
    const fn = handlers[name]
    return typeof fn === 'function' ? fn(...args) : undefined
  }

  const state = { open: false, value: '', error: '' }

  const onClose = () => call('onClose')
  const { backdrop: el, section } = createDialogShell('插入公式', onClose, { closeOnEsc: true })
  const { header } = createDialogHeader({ title: '插入公式', closeLabel: '关闭对话框', iconSize: 14, onClose })

  const label = document.createElement('label')
  // `<label>LaTeX <input>`：文字在前，input 在后（同一行，CSS 不管，断言也不管，但结构得对）。
  label.appendChild(document.createTextNode('LaTeX '))
  const input = document.createElement('input')
  input.setAttribute('aria-label', 'LaTeX 公式')
  input.setAttribute('placeholder', '例如 x^2 + y^2')
  input.addEventListener('input', (event) => call('onInput', event.target.value))
  onEnter(input, () => call('onSubmit'))
  label.appendChild(input)

  const errorNode = document.createElement('p')
  errorNode.setAttribute('role', 'alert')
  errorNode.className = 'lark-doc-error'

  const submit = document.createElement('button')
  submit.type = 'button'
  submit.textContent = '插入'
  submit.addEventListener('click', () => call('onSubmit'))

  function render() {
    syncChildren(section, [
      { node: header, on: true },
      { node: label, on: true },
      { node: errorNode, on: !!state.error },
      { node: submit, on: true },
    ])
    setInputValue(input, state.value)
    if (state.error && errorNode.textContent !== state.error) errorNode.textContent = state.error
  }

  function update(patch) {
    Object.assign(state, patch || {})
    if (!state.open) {
      if (el.parentNode) el.parentNode.removeChild(el)
      return
    }
    if (host && el.parentNode !== host) host.appendChild(el)
    render()
  }

  return {
    el,
    update,
    focusInput() { if (el.parentNode) input.focus() },
    destroy() { if (el.parentNode) el.parentNode.removeChild(el) },
  }
}

/**
 * 链接对话框（`LinkDialog.vue`）—— 两形态共用一层外壳。
 *
 * 插入模式（空选区）比编辑模式多两段：「链接文本」label 与首段提示；两处都是 `v-if`，
 * 打开 / 关闭时必须真增删（断言 `linkInsert.labels.length === 2` 而
 * `linkEdit.labels.length === 1`）。
 *
 * 两个按钮的 `disabled` 是**算出来的**，不是点出来的：
 * 应用 = 地址非空 且（编辑模式 或 显示文字非空）；解除 = 非插入模式 且 当前在链接上。
 */
export function createLinkDialog(options = {}) {
  const handlers = options.handlers || {}
  const host = options.host || null
  const call = (name, ...args) => {
    const fn = handlers[name]
    return typeof fn === 'function' ? fn(...args) : undefined
  }

  const state = { open: false, insertMode: false, value: '', text: '', linkActive: false }

  const onClose = () => call('onClose')
  const { backdrop: el, section } = createDialogShell('设置链接', onClose, { closeOnEsc: true })
  const { header } = createDialogHeader({ title: '设置链接', closeLabel: '关闭链接设置', iconSize: 14, onClose })

  const textLabel = document.createElement('label')
  textLabel.appendChild(document.createTextNode('链接文本 '))
  const textInput = document.createElement('input')
  textInput.setAttribute('aria-label', '链接文本')
  textInput.setAttribute('placeholder', '输入链接显示文字')
  textInput.addEventListener('input', (event) => call('onTextInput', event.target.value))
  onEnter(textInput, () => call('onApply'))
  textLabel.appendChild(textInput)

  const valueLabel = document.createElement('label')
  valueLabel.appendChild(document.createTextNode('链接地址 '))
  const valueInput = document.createElement('input')
  valueInput.setAttribute('aria-label', '链接地址')
  valueInput.setAttribute('placeholder', 'https://example.com')
  valueInput.addEventListener('input', (event) => call('onValueInput', event.target.value))
  onEnter(valueInput, () => call('onApply'))
  valueLabel.appendChild(valueInput)

  const textHint = document.createElement('p')
  textHint.textContent = '输入显示文字和地址后插入本地链接；'

  const urlHint = document.createElement('p')
  urlHint.textContent = '仅允许 http、https、mailto、tel 或 # 锚点链接；取消不会改变选区。'

  const applyButton = document.createElement('button')
  applyButton.type = 'button'
  applyButton.textContent = '应用链接'
  applyButton.addEventListener('click', () => call('onApply'))

  const removeButton = document.createElement('button')
  removeButton.type = 'button'
  removeButton.textContent = '解除链接'
  removeButton.addEventListener('click', () => call('onRemove'))

  function render() {
    syncChildren(section, [
      { node: header, on: true },
      { node: textLabel, on: !!state.insertMode },
      { node: valueLabel, on: true },
      { node: textHint, on: !!state.insertMode },
      { node: urlHint, on: true },
      { node: applyButton, on: true },
      { node: removeButton, on: true },
    ])
    setInputValue(textInput, state.text)
    setInputValue(valueInput, state.value)
    const text = state.text === null || state.text === undefined ? '' : String(state.text)
    applyButton.disabled = !state.value || (!!state.insertMode && !text.trim())
    removeButton.disabled = !!state.insertMode || !state.linkActive
  }

  function update(patch) {
    Object.assign(state, patch || {})
    if (!state.open) {
      if (el.parentNode) el.parentNode.removeChild(el)
      return
    }
    if (host && el.parentNode !== host) host.appendChild(el)
    render()
  }

  return {
    el,
    update,
    /** 打开即聚焦：插入模式落「链接文本」，编辑模式落「链接地址」。 */
    focusFirstField() {
      if (!el.parentNode) return
      ;(state.insertMode ? textInput : valueInput).focus()
    },
    destroy() { if (el.parentNode) el.parentNode.removeChild(el) },
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

  const state = { open: false, title: '', placeholder: '', value: '', rejected: false, position: null }

  const el = document.createElement('div')
  el.className = 'lark-doc-embed-dialog'
  el.setAttribute('role', 'dialog')

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
  onEnter(input, () => call('onApply'))

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
  el.appendChild(footer)

  function render() {
    // `:aria-label="ed.embedDialogTitle"` + header 里的同一个标题（两处共用一份文案）。
    setAttr(el, 'aria-label', state.title)
    if (title.textContent !== state.title) title.textContent = state.title || ''
    setAttr(input, 'placeholder', state.placeholder)
    setInputValue(input, state.value)
    confirmButton.classList.toggle('is-rejected', !!state.rejected)
    // `:style="ed.embedDialogPos"` —— 替换语义，整体覆盖 left/top。
    applyStyle(el, state.position)
  }

  function update(patch) {
    Object.assign(state, patch || {})
    if (!state.open) {
      if (el.parentNode) el.parentNode.removeChild(el)
      return
    }
    if (host && el.parentNode !== host) host.appendChild(el)
    render()
  }

  return {
    el,
    update,
    focusInput() { if (el.parentNode) input.focus() },
    destroy() { if (el.parentNode) el.parentNode.removeChild(el) },
  }
}
