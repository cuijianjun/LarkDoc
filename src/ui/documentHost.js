import { DOCUMENT_REPORT_REASONS } from '../providers/document-host-http'

/** 独立举报页；只有当前身份的持久回执才显示已接收，不冒充飞书或宿主审核完成。 */
export function createDocumentReport(options) {
  const container = options.container || document.body, doc = container.ownerDocument, provider = options.provider
  const root = doc.createElement('main'), style = doc.createElement('style')
  root.className = 'ld-document-report'; root.setAttribute('aria-label', '举报文档')
  style.textContent = `.ld-document-report{--ld-report-bg:#fff;--ld-report-text:#1f2329;--ld-report-border:#eff0f1;--ld-report-muted:#8f959e;--ld-report-input-border:#dee0e3;--ld-report-subtle:#f5f6f7;--ld-report-accent:#3370ff;--ld-report-secondary:#646a73;--ld-report-inverse:#fff;box-sizing:border-box;min-height:100dvh;position:relative;display:flex;flex-direction:column;background:var(--ld-report-bg);color:var(--ld-report-text);font:16px/22px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.ld-document-report *{box-sizing:border-box}.ld-document-report h1{font-size:16px;line-height:22px;margin:0 0 14px;font-weight:500}.ld-document-report .report-content{padding:16px 16px 128px;flex:1}.ld-document-report .report-reason{display:flex;align-items:center;justify-content:space-between;width:100%;height:46px;padding:0 16px;border:0;border-bottom:1px solid var(--ld-report-border);background:var(--ld-report-bg);color:inherit;font:inherit;text-align:left;cursor:pointer}.ld-document-report .report-reason::after{content:'';width:8px;height:8px;border-top:1.5px solid var(--ld-report-muted);border-right:1.5px solid var(--ld-report-muted);transform:rotate(45deg)}.ld-document-report .report-label{display:flex;justify-content:space-between;margin:0;font-size:14px;line-height:20px}.ld-document-report .report-selected-label{height:20.5px;margin-bottom:8px}.ld-document-report .report-evidence{margin-top:24px}.ld-document-report .report-image-placeholder{width:100.5234375px;height:100.5234375px;margin-top:14px;position:relative;border:1px dashed var(--ld-report-input-border);background:var(--ld-report-subtle);border-radius:4px;color:var(--ld-report-muted);font-size:32px}.ld-document-report .report-description{margin-top:30px}.ld-document-report textarea{display:block;width:100%;height:94px;margin:0;padding:4px 11px 22px;border:1px solid var(--ld-report-input-border);border-radius:4px;resize:none;background:var(--ld-report-bg);color:inherit;font:inherit}.ld-document-report .report-note{color:var(--ld-report-muted);font-size:12px;line-height:18px;margin:16px 0 0}.ld-document-report .report-footer{position:fixed;left:0;right:0;bottom:0;padding:8px 16px calc(8px + env(safe-area-inset-bottom,0px));background:var(--ld-report-bg)}.ld-document-report .report-form-note{position:absolute;left:16px;right:16px;bottom:calc(88px + env(safe-area-inset-bottom,0px));margin:0;text-align:center;font-size:14px;line-height:20px}.ld-document-report .report-input-wrap{position:relative;margin-top:8px}.ld-document-report .report-count{position:absolute;right:9px;bottom:9px;padding:0 4px;height:15px;display:inline-flex;align-items:center;color:var(--ld-report-muted);border-radius:2px}.ld-document-report .report-count-text{font-size:12px;line-height:15.6px;font-weight:500;zoom:.833333}.ld-document-report .report-primary{width:100%;min-height:48px;border:0;border-radius:4px;background:var(--ld-report-accent);color:var(--ld-report-inverse);font:inherit;font-size:17px;line-height:26px;cursor:pointer}.ld-document-report button:disabled{opacity:.45;cursor:default}.ld-document-report .report-status{white-space:pre-wrap;overflow-wrap:anywhere;color:var(--ld-report-secondary)}.ld-document-report .report-receipt{display:block;margin:16px 0;word-break:break-all;color:var(--ld-report-secondary)}.ld-document-report button:focus-visible,.ld-document-report textarea:focus-visible{outline:2px solid var(--ld-report-accent);outline-offset:2px}`
  doc.head.append(style); container.append(root)
  let reason = options.initialReason || '', description = '', busy = false, receipt = null, message = '', available = true, destroyed = false
  let pending = provider.getPending()[0]?.operationId || ''
  const element = (tag, text, className) => { const node = doc.createElement(tag); if (text) node.textContent = text; if (className) node.className = className; return node }
  const note = () => element('p', '系统将收集被举报文档的信息，举报将提交至文档管理服务。', 'report-note')
  const button = (text, run, className) => { const node = element('button', text, className); node.type = 'button'; node.addEventListener('click', run); return node }
  const status = () => { const node = element('p', message, 'report-status'); node.setAttribute('role', 'status'); node.tabIndex = -1; return node }
  async function send(query = false) {
    if (busy || !available || destroyed) return
    busy = true; message = query ? '正在查询原举报…' : '正在提交…'; render()
    try {
      const result = query ? await provider.queryReport(pending) : await provider.submitReport({ reason, description })
      if (destroyed || !available) return
      receipt = result; pending = ''; options.onReceipt?.(result); message = ''
    } catch (error) {
      if (destroyed || !available) return
      pending = provider.getPending()[0]?.operationId || (query ? pending : '')
      message = pending ? '提交结果尚未确定，请查询原举报。' : '举报未提交，请重试。'
      if (!pending) options.onRejected?.()
    } finally { if (!destroyed) { busy = false; render(); root.querySelector('[role="status"]')?.focus?.({ preventScroll: true }) } }
  }
  function render() {
    if (destroyed) return
    root.replaceChildren()
    const content = element('section', '', 'report-content'); root.append(content)
    if (!available) { content.append(element('h1', '当前无法举报'), status()); return }
    if (receipt) {
      content.append(element('h1', '举报已接收'), element('p', '已保存至文档管理服务，等待处理。'))
      const code = element('code', receipt.reportId, 'report-receipt'); code.setAttribute('aria-label', '举报编号'); content.append(code)
      content.append(element('p', '接收时间：' + receipt.receivedAt))
      const done = button('完成', () => options.onDone?.(), 'report-primary'); content.append(done); return
    }
    if (pending) {
      content.append(element('h1', '查询原举报'), status())
      const query = button('查询原举报', () => { void send(true) }, 'report-primary'); query.disabled = busy; content.append(query)
      return
    }
    const selected = DOCUMENT_REPORT_REASONS.find(item => item.value === reason)
    if (!selected) {
      content.append(element('h1', '请选择举报该文档的理由'))
      for (const item of DOCUMENT_REPORT_REASONS) content.append(button(item.label, () => { reason = item.value; options.onReason?.(reason); render() }, 'report-reason'))
      content.append(note()); return
    }
    content.append(element('p', '举报理由', 'report-label report-selected-label'))
    content.append(button(selected.label, () => { if (busy) return; reason = ''; options.onReason?.(''); render() }, 'report-reason'))
    const evidence = element('section', '', 'report-evidence'), evidenceLabel = element('p', '', 'report-label')
    evidenceLabel.append(element('span', '补充图片证据（选填）')); evidence.append(evidenceLabel)
    const image = button('+', () => {}, 'report-image-placeholder'); image.disabled = true; image.setAttribute('aria-label', '图片证据上传暂未接入'); const imageCount = element('span', '0/9'); imageCount.style.cssText = 'position:absolute;left:40px;bottom:25px;font-size:12px;line-height:18px'; image.append(imageCount); image.title = '图片证据接口暂未接入'; evidence.append(image); content.append(evidence)
    const field = element('section', '', 'report-description'), label = element('label', '', 'report-label'), count = element('span'), countText = element('span', `${description.length}/200`, 'report-count-text')
    label.htmlFor = 'document-report-description'; label.append(element('span', '举报描述（选填）')); count.className = 'report-count'; count.id = 'document-report-count'; count.append(countText)
    const input = element('textarea'); input.id = label.htmlFor; input.placeholder = '请详细描述举报理由'; input.maxLength = 200; input.value = description; input.disabled = busy
    input.setAttribute('aria-describedby', count.id)
    const wrap = element('div', '', 'report-input-wrap'); wrap.append(input, count); field.append(label, wrap, status()); content.append(field)
    const footer = element('footer', '', 'report-footer'), submit = button('提交举报', () => { void send() }, 'report-primary')
    submit.disabled = busy || description.length > 200
    input.addEventListener('input', () => { description = input.value; countText.textContent = `${description.length}/200`; submit.disabled = busy || description.length > 200 })
    content.append(element('p', '举报将收集文档信息，提交至文档管理服务。', 'report-note report-form-note')); footer.append(submit); root.append(footer)
  }
  const beforeUnload = event => { if (busy || pending) { event.preventDefault(); event.returnValue = '' } }
  doc.defaultView.addEventListener('beforeunload', beforeUnload)
  render()
  return {
    el: root,
    setReason(value) { if (!busy && !pending && !receipt) { reason = value; render() } },
    setUnavailable(text = '登录状态已失效，请返回文档重新登录。') { available = false; reason = ''; description = ''; receipt = null; pending = ''; message = text; render() },
    destroy() { destroyed = true; doc.defaultView.removeEventListener('beforeunload', beforeUnload); root.remove(); style.remove() },
  }
}
