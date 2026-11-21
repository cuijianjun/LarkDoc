/**
 * Pure DOM table picker, link form, shortcut drawer and web embed popover.
 * Factories retain stable controls and attach/remove their surfaces on update().
 * Formula editing lives with its core NodeView and uses the source anchored editor.
 */

import { applyStyle, setAttr, syncChildren } from './dom'
import { iconNode } from './icon'
import { DRAWER_GROUPS } from './shortcutGroups'
import { normalizeLinkUrl } from '../core/documentOperations'

/** 表格选择器网格：9 列 × 9 行（对应 SFC 的 `v-for="n in 81"`）。 */
const GRID_COLUMNS = 9
const GRID_ROWS = 9

// 真机翻译语种页顺序；展示名称与 Provider 的目标语言 code 分开。
const TRANSLATION_LANGUAGES = [
  ['zh-CN', '简体中文'], ['en', '英语'], ['ja', '日语'], ['th', '泰语'], ['hi', '印地语'], ['id', '印度尼西亚语'],
  ['zh-TW', '繁体中文'], ['fr', '法语'], ['es', '西班牙语'], ['pt', '葡萄牙语'], ['ko', '韩语'], ['vi', '越南语'],
  ['ru', '俄语'], ['de', '德语'], ['it', '意大利语'], ['ar', '阿拉伯语'], ['pl', '波兰语'], ['fil', '菲律宾语'],
  ['ms', '马来语'], ['tr', '土耳其语'], ['hu', '匈牙利语'], ['my', '缅甸语'], ['bn', '孟加拉语'], ['km', '高棉文'],
]

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

/** 手机划词翻译：只呈现 Provider 返回值，不向正文回写。 */
export function createSelectionTranslationDialog({ host, handlers = {} } = {}) {
  let destroyed = false, state = {}, choosingLanguage = false
  const call = (name, ...args) => { if (!destroyed && el.isConnected) return handlers[name]?.(...args) }
  const { backdrop: el, section } = createDialogShell('翻译', () => { if (choosingLanguage) closeLanguages(); else call('onClose') })
  el.classList.add('lark-doc-selection-translation-backdrop')
  section.classList.add('lark-doc-selection-translation')
  const { header } = createDialogHeader({ title: '翻译', closeLabel: '关闭翻译', iconSize: 20, onClose: () => call('onClose') })
  section.appendChild(header)
  const card = document.createElement('div'); card.className = 'lark-doc-selection-translation-card'
  const sourceLabel = document.createElement('span'); sourceLabel.textContent = '原文'
  const source = document.createElement('div')
  const resultLabel = document.createElement('span'); resultLabel.textContent = '译文'
  const result = document.createElement('div'); result.setAttribute('aria-live', 'polite')
  card.append(sourceLabel, source, resultLabel, result); section.appendChild(card)
  const message = document.createElement('p'); message.setAttribute('role', 'status'); section.appendChild(message)
  const action = (label, icon, run) => {
    const button = document.createElement('button'); button.type = 'button'
    button.className = 'lark-doc-selection-translation-action'
    const text = document.createElement('span'); text.textContent = label
    button.append(text, iconNode(icon, 22)); button.addEventListener('click', () => { if (!destroyed && el.isConnected && !button.disabled) run() })
    section.appendChild(button); return button
  }
  const copy = action('复制译文', 'copy', () => call('onCopy'))
  const languageButton = action('切换语种', 'translate', () => {
    choosingLanguage = true; section.hidden = true; el.appendChild(languagePage)
    languageButton.setAttribute('aria-expanded', 'true')
    languageList.scrollTop = 0
    languageClose.focus({ preventScroll: true })
  })
  languageButton.setAttribute('aria-expanded', 'false')
  const languagePage = document.createElement('section'); languagePage.className = 'lark-doc-selection-translation-languages'
  languagePage.setAttribute('role', 'dialog'); languagePage.setAttribute('aria-modal', 'true'); languagePage.setAttribute('aria-label', '将内容翻译为')
  const { header: languageHeader, button: languageClose } = createDialogHeader({ title: '将内容翻译为', closeLabel: '关闭语种选择', iconSize: 20, onClose: () => {
    if (!destroyed && choosingLanguage && languagePage.isConnected) closeLanguages()
  } })
  const languageList = document.createElement('div'); languageList.className = 'lark-doc-selection-translation-language-list'
  for (const [value, label] of TRANSLATION_LANGUAGES) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.dataset.language = value
    button.addEventListener('click', () => {
      if (destroyed || !choosingLanguage || !languagePage.isConnected) return
      closeLanguages(); call('onLanguage', value)
    })
    languageList.appendChild(button)
  }
  languagePage.append(languageHeader, languageList)
  function closeLanguages() {
    choosingLanguage = false; languagePage.remove(); section.hidden = false; languageButton.setAttribute('aria-expanded', 'false')
    if (!destroyed && el.isConnected) languageButton.focus({ preventScroll: true })
  }
  action('翻译反馈', 'edit', () => { message.textContent = '当前文档未配置翻译反馈服务。'; message.hidden = false })
  const onKey = event => {
    if (event.key !== 'Escape' || !el.isConnected) return
    event.preventDefault()
    if (choosingLanguage) closeLanguages()
    else call('onClose')
  }
  el.ownerDocument.addEventListener('keydown', onKey)
  return {
    el,
    update(next) {
      if (destroyed) return
      state = next || {}
      source.textContent = state.source || ''; result.textContent = state.result || ''
      message.textContent = state.message || ''; message.hidden = !state.message
      result.setAttribute('aria-busy', String(!!state.busy))
      copy.disabled = !!state.busy || !state.result
      languageList.querySelectorAll('button').forEach(button => setAttr(button, 'aria-current', button.dataset.language === (state.language || 'en') ? 'true' : null))
      if (!el.parentNode) host?.appendChild(el)
    },
    destroy() { if (destroyed) return; destroyed = true; el.ownerDocument.removeEventListener('keydown', onKey); el.remove() },
  }
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

function bindNameDialogKeys(backdrop, section, input, submit, close) {
  const owner = backdrop.ownerDocument
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
  bindNameDialogKeys(backdrop, section, input, submit, close)
  footer.append(cancel, save); section.append(header, description, label, error, footer)
  host.appendChild(backdrop); sync(); input.focus(); input.select()
  return { destroy() { destroyed = true; backdrop.remove() } }
}

export function createSaveVersionDialog({ host, name, title, maxLength, handlers }) {
  const owner = host.ownerDocument
  let destroyed = false, busy = false
  const close = () => { if (!busy) handlers.onClose?.() }
  const { backdrop, section } = createDialogShell(title, close)
  section.classList.add('lark-doc-template-save-dialog', 'lark-doc-save-version-dialog')
  const { header, button: dismiss } = createDialogHeader({ title, closeLabel: '关闭另存为版本', onClose: close })
  const label = owner.createElement('label'), input = owner.createElement('input')
  label.textContent = '版本名称'
  input.setAttribute('aria-label', '版本名称'); input.maxLength = maxLength; input.value = name
  input.placeholder = '请输入名称'
  const counter = owner.createElement('small')
  counter.className = 'lark-doc-version-name-count'
  label.append(input, counter)
  const error = owner.createElement('p'); error.setAttribute('role', 'alert')
  const footer = owner.createElement('footer'), cancel = owner.createElement('button'), save = owner.createElement('button')
  cancel.type = save.type = 'button'; cancel.textContent = '取消'
  save.className = 'primary'
  cancel.addEventListener('click', close)
  const sync = () => {
    const pending = handlers.isPending?.()
    counter.textContent = `${input.value.length}/${input.maxLength}`
    if (busy && owner.activeElement === save) input.focus({ preventScroll: true })
    cancel.disabled = dismiss.disabled = busy
    input.readOnly = Boolean(busy || pending)
    save.disabled = busy || !input.value.trim() || Boolean(pending && handlers.canQuery?.() !== true)
    save.textContent = busy ? (pending ? '查询中…' : '保存中…') : pending ? '查询原操作' : '确定'
  }
  const submit = async () => {
    if (destroyed || save.disabled || handlers.isCurrent?.() === false) return
    busy = true; error.textContent = ''; sync()
    try {
      const saved = await handlers.onSave?.(input.value.trim())
      if (!destroyed && handlers.isCurrent?.() !== false && saved) handlers.onClose?.()
    } catch (failure) {
      if (!destroyed && handlers.isCurrent?.() !== false) error.textContent = failure?.message || '版本保存失败，请重试'
    } finally { if (!destroyed) { busy = false; sync() } }
  }
  input.addEventListener('input', sync); save.addEventListener('click', submit)
  bindNameDialogKeys(backdrop, section, input, submit, close)
  footer.append(cancel, save); section.append(header, label, error, footer)
  host.appendChild(backdrop); sync(); input.focus()
  input.setSelectionRange(input.value.length, input.value.length)
  return { destroy() { destroyed = true; backdrop.remove() } }
}

export function openDocumentWidgetsDialog(editorHost, value, opener, context, actionCurrent) {
  const { editor, session, key, identity, authorization } = context
  const current = () => !editorHost._isBeingDestroyed && !editorHost._isDestroyed && editorHost.editor === editor && !editor.isDestroyed &&
    editorHost.session === session && editorHost.documentWidgetStorageKey() === key && session?._privateIdentityGeneration === identity &&
    session?._authorizationGeneration === authorization && session?.can?.('canView') !== false
  if (!current() || !actionCurrent()) return false
  editorHost.closeDocumentWidgets()
  const listeners = []
  const close = () => {
    editorHost.closeDocumentWidgets()
    if (current() && opener?.isConnected) opener.focus({ preventScroll: true })
  }
  const view = createDocumentWidgetsDialog({
    host: editorHost.$refs?.dialogHost || editorHost.$el,
    widgets: editorHost.availableDocumentWidgets(),
    initialView: value,
    installed: () => editorHost.installedDocumentWidgets(),
    onClose: close,
    setInstalled: (id, enabled) => {
      if (!current() || !editorHost.availableDocumentWidgets().some(widget => widget.id === id)) return false
      const all = new Set(editorHost.installedDocumentWidgets())
      if (enabled) all.add(id)
      else all.delete(id)
      const installed = Array.from(all)
      editorHost.$el.ownerDocument.defaultView.localStorage.setItem(key, JSON.stringify(installed))
      editorHost.documentWidgetPreferences = { key, installed }
      return true
    },
  })
  for (const event of ['identity', 'capabilities', 'editor']) {
    const off = session?.on?.(event, () => { if (!current()) editorHost.closeDocumentWidgets() })
    if (typeof off === 'function') listeners.push(off)
  }
  editorHost._documentWidgetsDialog = { destroy() { listeners.forEach(off => off()); view.destroy() } }
  return true
}

function createDocumentWidgetsDialog({ host, widgets, initialView, installed, setInstalled, onClose }) {
  const owner = host.ownerDocument
  const { backdrop, section } = createDialogShell('管理小组件', onClose)
  section.classList.add('lark-doc-widget-dialog', 'lark-doc-template-save-dialog')
  const { header, button: dismiss } = createDialogHeader({ title: '管理小组件', closeLabel: '关闭小组件管理', onClose })
  const navigation = owner.createElement('div'), list = owner.createElement('div'), status = owner.createElement('p')
  status.setAttribute('role', 'status')
  let view = initialView
  const views = [['discover', '更多小组件'], ['manage', '已添加']]
  const buttons = views.map(([id, label]) => {
    const button = owner.createElement('button')
    button.type = 'button'; button.textContent = label
    button.addEventListener('click', () => { view = id; render() })
    return button
  })
  function render() {
    const active = new Set(installed())
    buttons.forEach((button, index) => button.setAttribute('aria-pressed', String(views[index][0] === view)))
    const rows = widgets.filter(widget => view === 'discover' || active.has(widget.id))
    list.replaceChildren(...rows.map(widget => {
      const row = owner.createElement('div'), text = owner.createElement('div'), label = owner.createElement('strong')
      const description = owner.createElement('p'), button = owner.createElement('button')
      const enabled = active.has(widget.id)
      label.textContent = widget.label; description.textContent = widget.description
      button.type = 'button'; button.textContent = enabled ? '移除' : '添加'; button.setAttribute('aria-label', button.textContent + widget.label)
      button.addEventListener('click', () => {
        try {
          if (!setInstalled(widget.id, !enabled)) return
          status.textContent = enabled ? `已移除${widget.label}` : `已添加${widget.label}`
          render()
          const nextLabel = (enabled ? '添加' : '移除') + widget.label
          const next = Array.from(list.querySelectorAll('button')).find(item => item.getAttribute('aria-label') === nextLabel)
          ;(next || buttons[view === 'discover' ? 0 : 1]).focus({ preventScroll: true })
        } catch (_) { status.textContent = '当前浏览器无法保存小组件设置' }
      })
      text.append(label, description); row.append(text, button)
      return row
    }))
    if (!rows.length) list.textContent = '暂无已添加的小组件'
  }
  backdrop.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() }
    if (event.key === 'Tab') {
      const controls = section.querySelectorAll('button')
      if (event.shiftKey && owner.activeElement === controls[0]) { event.preventDefault(); controls[controls.length - 1].focus() }
      else if (!event.shiftKey && owner.activeElement === controls[controls.length - 1]) { event.preventDefault(); controls[0].focus() }
    }
  })
  navigation.append(...buttons); section.append(header, navigation, list, status)
  navigation.className = 'lark-doc-widget-navigation'; list.className = 'lark-doc-widget-list'
  host.appendChild(backdrop); render(); dismiss.focus({ preventScroll: true })
  return { destroy() { backdrop.remove() } }
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

  const state = { open: false, rows: 3, cols: 3, style: null }

  const el = document.createElement('div')
  el.className = 'lark-doc-table-picker'
  el.setAttribute('role', 'dialog')
  el.setAttribute('aria-label', '插入表格')
  // 从按钮移进面板不该判成「离开」—— 与「图表」下拉同一条 hover 接力。
  el.addEventListener('mouseenter', () => call('onHoverIn'))
  el.addEventListener('mouseleave', () => call('onHoverOut'))
  // Esc 只在焦点落在网格里时才会到这儿（焦点在正文时由全局 `onWindowKeydown` 收）。
  el.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || event.isComposing || event.keyCode === 229) return
    event.stopPropagation()
    call('onClose', true)
  })

  // 三段竖排照飞书原版：标题独占一行、网格、尺寸贴右下。
  const title = document.createElement('p')
  title.className = 'lark-doc-table-picker-title'
  title.textContent = '插入支持富文本的表格'

  const sizeLabel = document.createElement('span')
  sizeLabel.className = 'lark-doc-table-grid-size'

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
    // mouseenter 与 focus 走同一个入口：键盘 Tab 与鼠标划过都要预览。
    cell.addEventListener('mouseenter', () => call('onPreview', row, col))
    cell.addEventListener('focus', () => call('onPreview', row, col))
    cell.addEventListener('click', () => call('onInsert', row, col))
    cells.push(cell)
    grid.appendChild(cell)
  }

  el.appendChild(title)
  el.appendChild(grid)
  el.appendChild(sizeLabel)

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

/** 原生公式插入对话框；保留条件错误行的真实插入/移除语义。 */
export function createMathDialog(options = {}) {
  const handlers = options.handlers || {}
  const host = options.host || null
  const call = (name, ...args) => typeof handlers[name] === 'function' ? handlers[name](...args) : undefined
  const state = { open: false, value: '', error: '' }
  const onClose = () => call('onClose')
  const { backdrop: el, section } = createDialogShell('插入公式', onClose, { closeOnEsc: true })
  const { header } = createDialogHeader({ title: '插入公式', closeLabel: '关闭对话框', iconSize: 14, onClose })
  const label = document.createElement('label'); label.appendChild(document.createTextNode('LaTeX '))
  const input = document.createElement('input'); input.setAttribute('aria-label', 'LaTeX 公式'); input.setAttribute('placeholder', '例如 x^2 + y^2')
  input.addEventListener('input', event => call('onInput', event.target.value)); onEnter(input, () => call('onSubmit')); label.appendChild(input)
  const errorNode = document.createElement('p'); errorNode.setAttribute('role', 'alert'); errorNode.className = 'lark-doc-error'
  const submit = document.createElement('button'); submit.type = 'button'; submit.textContent = '插入'; submit.addEventListener('click', () => call('onSubmit'))
  function render() {
    syncChildren(section, [{ node: header, on: true }, { node: label, on: true }, { node: errorNode, on: !!state.error }, { node: submit, on: true }])
    setInputValue(input, state.value); if (state.error && errorNode.textContent !== state.error) errorNode.textContent = state.error
  }
  function update(patch) {
    Object.assign(state, patch || {})
    if (!state.open) { if (el.parentNode) el.parentNode.removeChild(el); return }
    if (host && el.parentNode !== host) host.appendChild(el); render()
  }
  return { el, update, focusInput() { if (el.parentNode) input.focus() }, destroy() { if (el.parentNode) el.parentNode.removeChild(el) } }
}

/**
 * 链接对话框（`LinkDialog.vue`）—— 两形态共用一层外壳。
 *
 * 插入/编辑沿用同一份文本和地址；只对现有链接提供移除，触屏可直接取消。
 */
export function createLinkDialog({ host, handlers = {} } = {}) {
  const el = document.createElement('div')
  el.className = 'lark-doc-link-dialog'
  el.setAttribute('role', 'dialog')
  el.setAttribute('aria-label', '设置链接')
  const state = {}
  const submit = () => { if (state.open && normalizeLinkUrl(valueInput.value)) handlers.onApply?.() }
  const close = () => { if (state.open) handlers.onClose?.() }
  function input(label, name, placeholder, onInput) {
    const row = document.createElement('label')
    row.textContent = label
    const field = document.createElement('input')
    field.setAttribute('aria-label', name)
    field.placeholder = placeholder
    field.spellcheck = false
    field.addEventListener('input', event => { if (state.open) onInput?.(event.target.value) })
    field.addEventListener('keydown', event => {
      if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229) return
      event.preventDefault(); submit()
    })
    row.appendChild(field)
    el.appendChild(row)
    return field
  }
  const textInput = input('文本', '链接文本', '输入文本', handlers.onTextInput)
  const valueInput = input('链接', '链接地址', '粘贴或输入链接', handlers.onValueInput)
  const apply = document.createElement('button')
  apply.type = 'button'
  apply.textContent = '确认'
  apply.className = 'lark-doc-link-dialog-apply'
  apply.addEventListener('click', submit)
  const actions = document.createElement('footer'), cancel = document.createElement('button'), remove = document.createElement('button')
  actions.className = 'lark-doc-link-dialog-actions'
  cancel.type = remove.type = 'button'; cancel.textContent = '取消'; remove.textContent = '移除链接'
  cancel.addEventListener('click', close)
  remove.addEventListener('click', () => { if (state.open && !remove.disabled && !remove.hidden) handlers.onRemove?.() })
  actions.append(remove, cancel, apply); el.appendChild(actions)
  el.addEventListener('keydown', event => {
    if (!state.open || event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    close()
  })
  return {
    el,
    update(patch) {
      Object.assign(state, patch)
      if (!state.open) { el.remove(); return }
      if (host && el.parentNode !== host) host.appendChild(el)
      setInputValue(textInput, state.text)
      setInputValue(valueInput, state.value)
      apply.disabled = !normalizeLinkUrl(state.value)
      valueInput.setAttribute('aria-invalid', String(apply.disabled && Boolean(state.value?.trim())))
      remove.disabled = !state.linkActive || !!state.insertMode; remove.hidden = remove.disabled
      const win = el.ownerDocument.defaultView
      const rect = el.getBoundingClientRect()
      const anchor = state.anchor || { left: (win.innerWidth - rect.width) / 2, top: win.innerHeight / 2, bottom: win.innerHeight / 2 }
      el.style.left = `${Math.max(8, Math.min(anchor.left, win.innerWidth - rect.width - 8))}px`
      el.style.top = `${Math.max(8, anchor.bottom + rect.height + 4 <= win.innerHeight ? anchor.bottom + 4 : anchor.top - rect.height - 4)}px`
    },
    focusFirstField() { if (el.parentNode) (state.insertMode ? textInput : valueInput).focus() },
    destroy() { state.open = false; el.remove() },
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
    input.setAttribute('aria-invalid', String(!!state.rejected))
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
