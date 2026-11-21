/**
 * 宿主侧「飞书风格表单弹窗」——演示宿主（`element-demo.html`）与 Vue 3 预览共用。
 *
 * 为什么单独一份而不是复用 `src/ui/dialogs.js`：库内弹窗的样式全部挂在 `.lark-doc`
 * 作用域下（`.lark-doc .lark-doc-dialog`），宿主页面没有这个祖先，且宿主弹窗要在
 * `ownerDocument` 可注入的前提下工作。所以这里只做「宿主自己的 UI」，不进库产物、
 * 不占任何体积预算。
 *
 * 结构与飞书 UD Modal 对齐（源码取值见 `larkdoc-official-reference/web-scripts`
 * 的 `.ud__modal__*` 注入样式）：
 *   header  padding 24        title 16/24 500
 *   body    padding 0 24，margin-bottom 24
 *   footer  padding 0 24 24，按钮间距 12
 *   close   top 24 / right 24，20px 热区，色 --text-icon-n2(#646A73)
 *
 * ⚠️ 表单控件全部保留原生真身：`<select name=…>` 与 `<input name=…>` 留在 DOM 里
 * （视觉上用自绘层盖住），因为演示宿主与单测都直接读写 `select.value` / `input.value`，
 * 换掉真身会让「授权校验」和既有 20 个断言一起失准。
 */

const CLOSE_SVG = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4.6 4.6 6.8 6.8M11.4 4.6l-6.8 6.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>'
const CHEVRON_SVG = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4.2 6.2 3.8 3.8 3.8-3.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
const CHECK_SVG = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m3.5 8.4 3 3 6-6.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'

/** 飞书色板：写死在这里而不是引用 `--ld-*`，因为宿主页面不在 `.lark-doc` 作用域内。 */
const HOST_DIALOG_CSS = `
.larkdoc-host-dialog { box-sizing: border-box; width: min(480px, calc(100vw - 32px)); max-height: calc(100dvh - 64px); margin: auto; padding: 0; overflow: auto; border: 0; border-radius: 8px; background: #fff; color: #1F2329; box-shadow: 0 8px 32px rgba(31,35,41,.16), 0 2px 8px rgba(31,35,41,.08); font: 14px/22px -apple-system, BlinkMacSystemFont, "PingFang SC", "Segoe UI", sans-serif; }
.larkdoc-host-dialog::backdrop { background: rgba(31,35,41,.5); }
.larkdoc-host-dialog * { box-sizing: border-box; }
.larkdoc-host-dialog form { margin: 0; }
.larkdoc-host-dialog .larkdoc-host-head { display: flex; align-items: flex-start; gap: 12px; padding: 24px 24px 0; }
.larkdoc-host-dialog .larkdoc-host-title { flex: 1; min-width: 0; margin: 0; font-size: 16px; line-height: 24px; font-weight: 500; overflow-wrap: break-word; }
.larkdoc-host-dialog .larkdoc-host-close { display: inline-flex; flex: 0 0 24px; align-items: center; justify-content: center; width: 24px; height: 24px; margin: -2px -4px 0 0; padding: 0; border: 0; border-radius: 6px; background: transparent; color: #646A73; cursor: pointer; }
.larkdoc-host-dialog .larkdoc-host-close:hover { background: #EFF0F1; }
.larkdoc-host-dialog .larkdoc-host-close:focus-visible { outline: 2px solid #3370FF; outline-offset: 1px; }
.larkdoc-host-dialog .larkdoc-host-body { padding: 0 24px; }
.larkdoc-host-dialog .larkdoc-host-desc { margin: 8px 0 20px; color: #646A73; font-size: 14px; line-height: 22px; overflow-wrap: anywhere; }
.larkdoc-host-dialog .larkdoc-host-field { display: block; margin-bottom: 16px; }
.larkdoc-host-dialog .larkdoc-host-field-label { display: block; margin-bottom: 8px; color: #1F2329; font-size: 14px; line-height: 22px; }
.larkdoc-host-dialog .larkdoc-host-error { margin: 6px 0 0; color: #F54A45; font-size: 12px; line-height: 18px; }
.larkdoc-host-dialog .larkdoc-host-input { display: block; width: 100%; height: 32px; padding: 0 11px; border: 1px solid #DEE0E3; border-radius: 6px; background: #fff; color: #1F2329; font: inherit; }
.larkdoc-host-dialog .larkdoc-host-input::placeholder { color: #8F959E; }
.larkdoc-host-dialog .larkdoc-host-input:focus { border-color: #3370FF; outline: 0; box-shadow: inset 0 0 0 1px #fff, inset 0 0 0 3px #3370FF; }
.larkdoc-host-dialog .larkdoc-host-field.is-invalid .larkdoc-host-input { border-color: #F54A45; }
.larkdoc-host-dialog .larkdoc-host-select { position: relative; display: block; }
/* 真身：透明铺满触发器，只提供取值与无障碍语义，点击一律交给自绘层。 */
.larkdoc-host-dialog .larkdoc-host-select > select { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; padding: 0; border: 0; opacity: 0; pointer-events: none; }
.larkdoc-host-dialog .larkdoc-host-select-trigger { display: flex; align-items: center; gap: 8px; width: 100%; height: 32px; padding: 0 30px 0 11px; border: 1px solid #DEE0E3; border-radius: 6px; background: #fff; color: #1F2329; font: inherit; text-align: left; cursor: pointer; }
.larkdoc-host-dialog .larkdoc-host-select-value { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.larkdoc-host-dialog .larkdoc-host-select.is-placeholder .larkdoc-host-select-value { color: #8F959E; }
.larkdoc-host-dialog .larkdoc-host-select-trigger:focus-visible,
.larkdoc-host-dialog .larkdoc-host-select.is-open .larkdoc-host-select-trigger { border-color: #3370FF; outline: 0; box-shadow: inset 0 0 0 1px #fff, inset 0 0 0 3px #3370FF; }
.larkdoc-host-dialog .larkdoc-host-field.is-invalid .larkdoc-host-select-trigger { border-color: #F54A45; }
.larkdoc-host-dialog .larkdoc-host-caret { position: absolute; top: 50%; right: 11px; display: inline-flex; color: #646A73; transform: translateY(-50%); pointer-events: none; }
.larkdoc-host-dialog .larkdoc-host-select.is-open .larkdoc-host-caret { transform: translateY(-50%) rotate(180deg); }
/* fixed 定位：dialog 元素在 top layer 且自身 overflow:auto，绝对定位的菜单会被卡片下沿裁掉。 */
.larkdoc-host-dialog .larkdoc-host-menu { position: fixed; z-index: 2; top: 0; left: 0; max-height: 240px; margin: 0; padding: 4px; overflow: auto; border: 1px solid #EFF0F1; border-radius: 8px; background: #fff; box-shadow: 0 4px 16px rgba(31,35,41,.16); }
.larkdoc-host-dialog .larkdoc-host-menu[hidden] { display: none; }
.larkdoc-host-dialog .larkdoc-host-option { display: flex; align-items: center; gap: 8px; width: 100%; height: 32px; padding: 0 8px; border: 0; border-radius: 6px; background: transparent; color: #1F2329; font: inherit; text-align: left; cursor: pointer; }
.larkdoc-host-dialog .larkdoc-host-option.is-active { background: #EFF0F1; }
.larkdoc-host-dialog .larkdoc-host-option-check { flex: 0 0 16px; display: inline-flex; color: #3370FF; visibility: hidden; }
.larkdoc-host-dialog .larkdoc-host-option.is-selected .larkdoc-host-option-check { visibility: visible; }
.larkdoc-host-dialog .larkdoc-host-option.is-selected { color: #3370FF; }
.larkdoc-host-dialog .larkdoc-host-check { display: flex; align-items: center; gap: 8px; color: #1F2329; font-size: 14px; line-height: 22px; cursor: pointer; }
.larkdoc-host-dialog .larkdoc-host-check input { flex: 0 0 16px; width: 16px; height: 16px; margin: 0; appearance: none; -webkit-appearance: none; border: 1px solid #DEE0E3; border-radius: 4px; background: #fff; cursor: pointer; }
.larkdoc-host-dialog .larkdoc-host-check input:hover { border-color: #3370FF; }
.larkdoc-host-dialog .larkdoc-host-check input:focus-visible { outline: 2px solid #3370FF; outline-offset: 1px; }
.larkdoc-host-dialog .larkdoc-host-check input:checked { border-color: #3370FF; background: #3370FF; }
.larkdoc-host-dialog .larkdoc-host-check input:checked::after { content: ''; display: block; width: 8px; height: 4px; margin: 3px 0 0 3px; border: 1.6px solid #fff; border-top: 0; border-right: 0; transform: rotate(-45deg); }
.larkdoc-host-dialog .larkdoc-host-foot { display: flex; justify-content: flex-end; gap: 12px; padding: 0 24px 24px; }
.larkdoc-host-dialog .larkdoc-host-btn { height: 32px; padding: 0 16px; border: 1px solid #DEE0E3; border-radius: 6px; background: #fff; color: #1F2329; font: inherit; cursor: pointer; }
.larkdoc-host-dialog .larkdoc-host-btn:hover { background: #F5F6F7; }
.larkdoc-host-dialog .larkdoc-host-btn:focus-visible { outline: 2px solid #3370FF; outline-offset: 1px; }
.larkdoc-host-dialog .larkdoc-host-btn.is-primary { border-color: transparent; background: #3370FF; color: #fff; }
.larkdoc-host-dialog .larkdoc-host-btn.is-primary:hover { background: #2E63E6; }
.larkdoc-host-dialog .larkdoc-host-btn.is-danger { border-color: transparent; background: #F54A45; color: #fff; }
.larkdoc-host-dialog .larkdoc-host-btn.is-danger:hover { background: #DE3A35; }
.larkdoc-host-dialog .larkdoc-host-btn:disabled { cursor: not-allowed; opacity: .5; }
`

/** 幂等注入：同一个 document 只插一次。 */
export function installHostDialogStyles(doc) {
  if (!doc || doc.querySelector('style[data-larkdoc-host-dialog]')) return
  const style = doc.createElement('style')
  style.setAttribute('data-larkdoc-host-dialog', '')
  style.textContent = HOST_DIALOG_CSS
  ;(doc.head || doc.documentElement).appendChild(style)
}

function element(doc, tag, className, text) {
  const node = doc.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}

/** 飞书式下拉：真身 `<select>` 只存值，自绘层负责外观与键盘。 */
function selectField(doc, field, onInvalid) {
  const wrap = element(doc, 'span', 'larkdoc-host-select')
  const select = doc.createElement('select')
  select.name = field.name
  select.setAttribute('aria-label', field.label)
  field.options.forEach((option) => {
    const node = doc.createElement('option')
    node.value = option.value
    node.textContent = option.label
    select.appendChild(node)
  })
  if (field.value != null) select.value = String(field.value)
  const trigger = element(doc, 'button', 'larkdoc-host-select-trigger')
  trigger.type = 'button'
  trigger.setAttribute('role', 'combobox')
  trigger.setAttribute('aria-expanded', 'false')
  trigger.setAttribute('aria-haspopup', 'listbox')
  const value = element(doc, 'span', 'larkdoc-host-select-value')
  const caret = element(doc, 'span', 'larkdoc-host-caret')
  caret.innerHTML = CHEVRON_SVG
  trigger.append(value, caret)
  const menu = element(doc, 'div', 'larkdoc-host-menu')
  menu.setAttribute('role', 'listbox')
  menu.setAttribute('aria-label', field.label)
  menu.hidden = true
  wrap.append(select, trigger, menu)

  // 「请选择」这类空值项只留在真身 `<select>` 里（表单校验与既有断言依赖它），
  // 菜单里不渲染——飞书的下拉列表从来不展示占位项本身。
  const items = field.options.map((option, index) => ({ option, index })).filter(item => item.option.value !== '')
  let open = false, active = 0
  const nodes = () => [...menu.querySelectorAll('.larkdoc-host-option')]
  const sync = () => {
    const chosen = items.find(item => String(item.option.value) === select.value)
    value.textContent = chosen ? chosen.option.label : (field.placeholder || '请选择')
    wrap.classList.toggle('is-placeholder', !chosen)
    nodes().forEach((node) => {
      const selected = !!chosen && Number(node.dataset.index) === chosen.index
      node.classList.toggle('is-selected', selected)
      node.setAttribute('aria-selected', String(selected))
    })
    active = Math.max(0, items.findIndex(item => item === chosen))
  }
  const close = (focusTrigger = false) => {
    if (!open) return
    open = false; menu.hidden = true
    wrap.classList.remove('is-open')
    trigger.setAttribute('aria-expanded', 'false')
    if (focusTrigger) trigger.focus()
  }
  const commit = (index) => {
    const item = items[index]
    if (!item) return
    select.value = String(item.option.value)
    select.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }))
    sync(); close(true); onInvalid?.(false)
  }
  const highlight = (index) => {
    const list = nodes()
    if (!list.length) return
    active = (index + list.length) % list.length
    list.forEach((node, i) => node.classList.toggle('is-active', i === active))
    trigger.setAttribute('aria-activedescendant', list[active].id)
  }
  const place = () => {
    const box = trigger.getBoundingClientRect()
    menu.style.left = `${box.left}px`
    menu.style.width = `${box.width}px`
    // 下方放不下就翻到触发器上方（菜单最高 240，与触发器留 4 的间距）。
    const below = box.bottom + 4, height = menu.offsetHeight
    menu.style.top = `${below + height > window.innerHeight - 8 && box.top - height - 4 > 8 ? box.top - height - 4 : below}px`
  }
  const openMenu = () => {
    if (open || !items.length) return
    open = true; menu.hidden = false
    place()
    wrap.classList.add('is-open')
    trigger.setAttribute('aria-expanded', 'true')
    sync(); highlight(active)
  }
  items.forEach(({ option, index }, position) => {
    const node = element(doc, 'button', 'larkdoc-host-option')
    node.type = 'button'; node.id = `${field.domId}-option-${index}`; node.dataset.index = String(index)
    node.setAttribute('role', 'option')
    const check = element(doc, 'span', 'larkdoc-host-option-check')
    check.innerHTML = CHECK_SVG
    node.append(check, element(doc, 'span', '', option.label))
    node.addEventListener('click', () => commit(position))
    node.addEventListener('mousemove', () => { if (open) highlight(position) })
    menu.appendChild(node)
  })
  trigger.addEventListener('click', () => (open ? close() : openMenu()))
  trigger.addEventListener('keydown', (event) => {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
      event.preventDefault()
      if (!open) openMenu()
      else if (event.key === 'Enter' || event.key === ' ') commit(active)
      else highlight(active + (event.key === 'ArrowDown' ? 1 : -1))
      return
    }
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(true) }
  })
  select.addEventListener('change', sync)
  // 收起时机都挂在 document 上，弹窗关掉时必须一起撤，否则多次开弹窗会累积监听。
  const abort = new doc.defaultView.AbortController()
  // 点外部收起：捕获阶段判一次，避免和同一帧内的触发器点击互相抵消。
  doc.addEventListener('pointerdown', (event) => { if (open && !wrap.contains(event.target)) close() }, { capture: true, signal: abort.signal })
  // 滚动时不跟随重算，直接收起——菜单是 fixed 层，留在原地会脱离触发器。
  doc.addEventListener('scroll', () => close(), { capture: true, signal: abort.signal })
  sync()
  return { wrap, select, trigger, close: () => close(), destroy: () => abort.abort() }
}

function inputField(doc, field) {
  const input = doc.createElement('input')
  input.className = 'larkdoc-host-input'
  input.name = field.name
  input.setAttribute('aria-label', field.label)
  if (field.maxLength) input.maxLength = field.maxLength
  if (field.placeholder) input.placeholder = field.placeholder
  if (field.autocomplete) input.autocomplete = field.autocomplete
  input.value = field.value ?? ''
  return input
}

function checkField(doc, field) {
  const label = element(doc, 'label', 'larkdoc-host-check')
  const input = doc.createElement('input')
  input.type = 'checkbox'; input.name = field.name
  input.checked = field.value === true
  label.append(input, element(doc, 'span', '', field.label))
  return { node: label, input }
}

/**
 * 打开一个飞书风格表单弹窗。
 *
 * @returns {{ result: Promise<object|null>, close: (value?: object|null) => void }}
 *   `result` 在确认时给出 `{ [name]: value }`，取消/关闭/Esc 给 `null`。
 */
export function openHostFormDialog(options) {
  const doc = options.doc || document
  installHostDialogStyles(doc)
  const dialog = doc.createElement('dialog')
  dialog.className = 'larkdoc-host-dialog'
  if (options.className) dialog.className += ' ' + options.className
  dialog.setAttribute('aria-label', options.title)
  const form = doc.createElement('form')
  form.method = 'dialog'
  // 原生必填气泡会把飞书弹窗顶出一个系统提示，校验一律自己做。
  form.noValidate = true
  const head = element(doc, 'header', 'larkdoc-host-head')
  head.append(element(doc, 'h3', 'larkdoc-host-title', options.title))
  const closeButton = element(doc, 'button', 'larkdoc-host-close')
  closeButton.type = 'button'
  closeButton.setAttribute('aria-label', '关闭')
  closeButton.innerHTML = CLOSE_SVG
  head.append(closeButton)
  const body = element(doc, 'div', 'larkdoc-host-body')
  if (options.description) body.append(element(doc, 'p', 'larkdoc-host-desc', options.description))
  const foot = element(doc, 'footer', 'larkdoc-host-foot')
  const cancel = element(doc, 'button', 'larkdoc-host-btn', options.cancelText || '取消')
  cancel.type = 'button'
  const submit = element(doc, 'button', 'larkdoc-host-btn is-primary', options.confirmText || '确定')
  submit.type = 'submit'
  if (options.danger) submit.className = 'larkdoc-host-btn is-danger'
  foot.append(cancel, submit)
  form.append(head, body, foot)
  dialog.append(form)

  const controls = new Map()
  const rows = new Map()
  const errors = new Map()
  for (const field of options.fields || []) {
    const row = element(doc, 'div', 'larkdoc-host-field')
    if (field.type === 'checkbox') {
      const { node } = checkField(doc, field)
      row.append(node)
      controls.set(field.name, node.querySelector('input'))
    } else {
      row.append(element(doc, 'span', 'larkdoc-host-field-label', field.label))
      const domId = `larkdoc-host-${field.name}`
      if (field.type === 'select') {
        const control = selectField(doc, { ...field, domId }, invalid => { if (!invalid) clearError(field.name) })
        row.append(control.wrap)
        controls.set(field.name, control)
      } else {
        row.append(inputField(doc, field))
        controls.set(field.name, row.querySelector('input'))
      }
    }
    rows.set(field.name, row)
    body.append(row)
  }

  function clearError(name) {
    const row = rows.get(name)
    if (!row) return
    row.classList.remove('is-invalid')
    errors.get(name)?.remove()
    errors.delete(name)
  }
  function showError(field, custom) {
    const row = rows.get(field.name)
    if (!row || errors.has(field.name)) return
    row.classList.add('is-invalid')
    const fallback = field.type === 'select' || field.type === 'checkbox' ? `请选择${field.label}` : `请输入${field.label}`
    const message = element(doc, 'p', 'larkdoc-host-error', custom || field.error || fallback)
    message.setAttribute('role', 'alert')
    row.append(message)
    errors.set(field.name, message)
  }
  const valueOf = (field) => {
    const control = controls.get(field.name)
    if (!control) return undefined
    if (field.type === 'select') return control.select.value
    if (field.type === 'checkbox') return control.checked
    return control.value
  }
  const values = () => Object.fromEntries((options.fields || []).map(field => [field.name, valueOf(field)]))

  let closed = false
  const previous = doc.activeElement
  const finish = (result) => {
    if (closed) return
    closed = true
    ;(options.fields || []).forEach(field => { controls.get(field.name)?.close?.(); controls.get(field.name)?.destroy?.() })
    dialog.remove()
    if (options.returnFocus !== false && previous?.isConnected) previous.focus?.({ preventScroll: true })
    resolve(result)
  }
  let resolve
  const result = new Promise((done) => { resolve = done })

  closeButton.addEventListener('click', () => finish(null))
  cancel.addEventListener('click', () => finish(null))
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); finish(null) })
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    let firstInvalid = null
    for (const field of options.fields || []) {
      if (!field.required) continue
      const current = valueOf(field)
      const empty = field.type === 'checkbox' ? current !== true : !String(current ?? '').trim()
      if (!empty) continue
      showError(field)
      firstInvalid = firstInvalid || field
    }
    if (firstInvalid) {
      rows.get(firstInvalid.name)?.querySelector('input, .larkdoc-host-select-trigger')?.focus?.()
      return
    }
    const failure = options.validate?.(values())
    if (failure) {
      const field = options.fields?.find(item => item.name === failure.field)
      if (field) { showError(field, failure.message); rows.get(field.name)?.querySelector('input, .larkdoc-host-select-trigger')?.focus?.() }
      return
    }
    finish(values())
  })
  for (const field of options.fields || []) {
    if (field.type === 'checkbox') continue
    controls.get(field.name)?.addEventListener?.('input', () => clearError(field.name))
    const node = controls.get(field.name)
    if (node && field.type === 'select') node.trigger.addEventListener('click', () => clearError(field.name))
    else node?.addEventListener?.('input', () => clearError(field.name))
  }

  doc.body.appendChild(dialog)
  if (typeof dialog.showModal === 'function') dialog.showModal()
  else dialog.setAttribute('open', '')
  const firstField = (options.fields || []).find(field => field.type !== 'checkbox')
  if (firstField) {
    const control = controls.get(firstField.name)
    ;(control?.trigger || control)?.focus?.({ preventScroll: true })
  } else {
    submit.focus({ preventScroll: true })
  }
  return { result, close: value => finish(value ?? null) }
}
