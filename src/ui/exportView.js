/**
 * 导出浮层（原 ExportDialog.vue 的渲染层）：格式、范围与页眉页脚选项。
 *
 * 从 `ui/overlays.js` 原样搬出，函数体一行未改。
 */
import { setAttr, setText, syncChildren } from './dom'
import { attr, button, callHandler, makeClose, text } from './overlayShared'

function createExportView(options) {
  const handlers = options.handlers || {}
  let current = {}
  const visible = () => panel.isConnected && current.exportOpen
  const layer = text('div', 'lark-doc-export-layer')
  const toast = text('div', 'lark-doc-export-toast'); attr(toast, 'role', 'status'); attr(toast, 'aria-live', 'polite')
  const toastInner = text('div', 'lark-doc-export-toast-inner'), toastMessage = text('span')
  const query = button('lark-doc-export-query', '查询原任务', () => {
    if (toast.isConnected && current.exportPendingOperationId && current.exportCanExport && !current.exportBusy) callHandler(handlers, 'onQueryRemoteExport')
  })
  toastInner.append(toastMessage, query); toast.appendChild(toastInner)
  const backdrop = text('div', 'lark-doc-export-backdrop')
  backdrop.addEventListener('click', (event) => { if (visible() && event.target === backdrop) callHandler(handlers, 'onCancelExport') })
  const panel = text('section', 'lark-doc-export-panel'); attr(panel, 'role', 'dialog'); attr(panel, 'aria-modal', 'true')
  const header = text('header', 'lark-doc-export-header')
  const title = text('strong', 'lark-doc-export-title')
  header.appendChild(title)
  header.appendChild(makeClose('lark-doc-export-close', '关闭导出设置', () => { if (visible()) callHandler(handlers, 'onCloseExportDialog') }))
  const routeBox = text('div', 'lark-doc-export-route')
  const routeLabel = text('label', '', '导出方式'), route = document.createElement('select')
  attr(route, 'aria-label', '导出方式')
  for (const [value, label] of [['remote', '文档服务'], ['local', '本地导出']]) { const option = text('option', '', label); option.value = value; route.appendChild(option) }
  route.addEventListener('change', () => { if (visible() && !route.disabled) callHandler(handlers, 'onSelectExportRoute', route.value) })
  routeLabel.appendChild(route)
  const description = text('p', 'lark-doc-export-route-description'); attr(description, 'role', 'status')
  routeBox.append(routeLabel, description)
  const body = text('div', 'lark-doc-export-body'); body.appendChild(text('span', 'lark-doc-export-range-label', '内容范围'))
  const radios = text('div', 'lark-doc-export-radio-group'); attr(radios, 'role', 'radiogroup'); attr(radios, 'aria-label', '内容范围')
  body.appendChild(radios)
  const footer = text('footer', 'lark-doc-export-footer'); const buttons = text('div', 'lark-doc-export-btns')
  buttons.appendChild(button('lark-doc-export-cancel', '取消', () => { if (visible()) callHandler(handlers, 'onCancelExport') }))
  const submit = button('lark-doc-export-submit', '导出', () => { if (visible() && !submit.disabled) callHandler(handlers, 'onSubmitExport') }); buttons.appendChild(submit); footer.appendChild(buttons)
  const formats = text('div', 'lark-doc-export-formats'); attr(formats, 'aria-label', '下载格式')
  for (const [id, label] of [['word', 'Word'], ['pdf', 'PDF'], ['image', '图片'], ['markdown', 'Markdown']]) {
    const choice = button('lark-doc-export-format', label, () => { if (visible() && !choice.disabled) callHandler(handlers, 'onChooseExportFormat', id) })
    choice.dataset.exportFormat = id
    if (id === 'image') { choice.disabled = true; choice.title = '未配置图片导出服务'; choice.setAttribute('aria-description', choice.title) }
    formats.appendChild(choice)
  }
  const unavailable = text('p', 'lark-doc-export-format-notice', '图片导出尚未配置，暂不可用。'); attr(unavailable, 'role', 'status'); formats.appendChild(unavailable)
  panel.appendChild(header); panel.appendChild(formats); panel.appendChild(routeBox); panel.appendChild(body); panel.appendChild(footer); backdrop.appendChild(panel)
  layer.appendChild(toast); layer.appendChild(backdrop)
  function update(state) {
    current = state
    setText(toastMessage, state.exportToast || (state.exportPendingOperationId ? state.exportCanExport ? '原导出请求待查询。' : '原导出请求已保留，当前无权查询。' : ''))
    query.hidden = !state.exportPendingOperationId
    query.disabled = !state.exportCanExport || !!state.exportBusy
    routeBox.hidden = !!state.exportFormatPicker || !state.exportRemoteAvailable && state.exportRoute !== 'remote'
    route.value = state.exportRoute === 'remote' ? 'remote' : 'local'
    route.disabled = !state.exportCanExport || !!state.exportBusy
    route.querySelector('[value=remote]').disabled = !state.exportRemoteAvailable
    setText(description, state.exportRouteDescription)
    setText(title, state.exportPanelTitle)
    attr(panel, 'aria-label', state.exportPanelTitle)
    panel.classList.toggle('is-format-picker', !!state.exportFormatPicker)
    formats.hidden = !state.exportFormatPicker
    body.hidden = footer.hidden = !!state.exportFormatPicker
    for (const choice of formats.querySelectorAll('[data-export-format]')) choice.disabled = !state.exportCanExport || choice.dataset.exportFormat === 'image'
    const watermark = state.outputWatermarkAttributes || {}
    setAttr(panel, 'data-watermark', watermark['data-watermark'])
    setAttr(panel, 'data-watermark-text', watermark['data-watermark-text'])
    attr(submit, 'data-capability', 'canExport')
    submit.disabled = !!state.exportSubmitDisabled
    attr(submit, 'aria-disabled', state.exportSubmitDisabled ? 'true' : 'false')
    submit.classList.toggle('is-disabled', !!state.exportSubmitDisabled)
    radios.textContent = ''
    ;(state.exportScopeOptions || []).forEach((option) => {
      const label = text('label', 'lark-doc-export-option'); label.classList.toggle('is-disabled', !state.exportCanExport)
      attr(label, 'data-capability', 'canExport')
      attr(label, 'aria-disabled', String(!state.exportCanExport))
      const radio = text('span', 'lark-doc-export-radio')
      const input = document.createElement('input'); input.className = 'lark-doc-export-radio-input'; input.type = 'radio'; input.name = 'lark-doc-export-scope'; input.value = option.value; input.checked = state.exportScopeValue === option.value; input.disabled = !state.exportCanExport
      input.addEventListener('change', () => { if (visible() && input.isConnected && !input.disabled) callHandler(handlers, 'onSelectExportScope', option.value) })
      const wallpaper = text('span', 'lark-doc-export-radio-wallpaper'); if (input.checked) wallpaper.appendChild(text('span', 'lark-doc-export-radio-ink'))
      radio.appendChild(input); radio.appendChild(wallpaper); label.appendChild(radio); label.appendChild(text('span', 'lark-doc-export-option-text', option.label)); radios.appendChild(label)
    })
    syncChildren(layer, [{ node: toast, on: !!state.exportToast || !!state.exportPendingOperationId }, { node: backdrop, on: !!state.exportOpen }])
  }
  return { el: layer, update, destroy() { if (layer.parentNode) layer.parentNode.removeChild(layer) } }
}

export { createExportView }
