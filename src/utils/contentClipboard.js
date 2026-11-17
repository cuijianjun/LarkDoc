import { closeHistory } from '@tiptap/pm/history'
import { BLOCK_CLIPBOARD_MIME, serializeBlockClipboard } from '../core/blocks/block-clipboard'
import { isBlockActionEnabled } from '../components/lark-doc/larkDocConfig'

/* 低频剪贴板执行；快照由点击入口同步捕获，不能在首次import后重新取身份或正文。 */
export function copyContextCurrent(context, checkDoc = true) {
  if (!context) return false
  const { owner, editor, doc, kind, parent, session } = context
  if (!owner || owner._isDestroyed || owner._isBeingDestroyed || !editor || editor.isDestroyed ||
    (kind === 'preview' ? owner.previewEditor : owner.editor) !== editor || (checkDoc && doc !== editor.state?.doc)) return false
  if (kind === 'preview') return Boolean(parent && parent.owner === owner.ed && copyContextCurrent(parent, checkDoc))
  if (kind === 'code') return (!parent || parent.editor === editor && copyContextCurrent(parent, checkDoc)) && editor.options?.editorProps?.larkDocCanCopy?.() !== false
  return !session?._destroyed && session === owner.session && context.provider === session?.getProvider?.('authorization') &&
    (!Object.prototype.hasOwnProperty.call(context, 'security') || context.security === session?.getProvider?.('security')) &&
    context.principal === session?.user?.id && context.identity === session?._privateIdentityGeneration &&
    context.auth === session?._authorizationGeneration && context.documentId === session?.documentId && owner.contentCopyAllowed()
}

function fallback(text, current, restoreFocus = false) {
  if (!current()) return false
  const input = document.createElement('textarea'), previous = restoreFocus ? document.activeElement : null
  input.value = text; input.setAttribute('readonly', 'true')
  input.style.position = 'fixed'; input.style.opacity = '0'
  document.body.appendChild(input)
  try { input.select(); return current() && document.execCommand('copy') }
  finally { input.remove(); if (current()) previous?.focus() }
}

async function plainText(text, current, fallbackAfterFailure = false, restoreFocus = false) {
  if (!current()) return false
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); return current() }
    catch (error) { if (!fallbackAfterFailure) throw error }
  }
  return fallback(text, current, restoreFocus)
}

function richFallback(html, text, current, blockPayload) {
  if (!current()) return false
  let wrote = false
  const onCopy = event => {
    if (!current() || !event.clipboardData) return
    event.preventDefault()
    try {
      const values = { 'text/html': html, 'text/plain': text,
        ...(blockPayload ? { [BLOCK_CLIPBOARD_MIME]: blockPayload } : {}) }
      for (const [type, value] of Object.entries(values)) {
        if (!current()) return
        event.clipboardData.setData(type, value)
      }
      wrote = !blockPayload || Object.entries(values).every(([type, value]) => event.clipboardData.getData(type) === value)
    } catch { wrote = false }
  }
  document.addEventListener('copy', onCopy)
  try { return !!document.execCommand?.('copy') && wrote && current() }
  finally { document.removeEventListener('copy', onCopy) }
}

export async function copySelection(context, range, cut = false) {
  const selection = context?.editor?.state.selection
  const current = () => copyContextCurrent(context) && context.editor.state.selection.from === range.from
    && context.editor.state.selection.to === range.to && context.editor.state.selection.eq(selection) && (!cut || context.owner.writable())
  if (!current()) return false
  if (range.from >= range.to) return false
  try {
    const { dom, text } = context.editor.view.serializeForClipboard(context.editor.state.selection.content())
    const html = dom.innerHTML
    let copied = false
    if (navigator.clipboard?.write && window.ClipboardItem) {
      try {
        await navigator.clipboard.write([new window.ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' }),
        })])
        copied = true
      } catch { /* 不支持富剪贴板时使用浏览器的真实 copy 事件。 */ }
    }
    if (!copied && current()) copied = richFallback(html, text, current)
    if (!copied && current()) copied = await plainText(text, current, true)
    if (!copied || !current()) return false
    if (cut) context.editor.view.dispatch(closeHistory(context.editor.state.tr.deleteRange(range.from, range.to).setMeta('uiEvent', 'cut')))
    return true
  }
  catch { return false }
}

/** 翻译结果只写剪贴板，不修改文档。 */
export async function copySelectionTranslation(context, text, valid) {
  const current = () => copyContextCurrent(context) && valid()
  try { return !!text && await plainText(text, current, true, true) } catch { return false }
}

export async function copyCode(context, node) {
  const current = () => copyContextCurrent(context)
  if (!current()) return false
  try {
    if (!(await plainText(node.textContent, current, false, true))) return false
    context.owner.message = '已复制'
    return true
  } catch {
    if (current()) context.owner.message = '无法访问剪贴板，请选择代码后手动复制'
    return false
  }
}

export async function copyBlock(context, range, cut = false) {
  const owner = context?.owner
  const current = () => copyContextCurrent(context) && isBlockActionEnabled(owner.larkDocConfig, cut ? 'cut' : 'copy')
    && (!cut || owner.writable() && context.session?.can?.('canEdit') !== false)
  if (!current() || !Number.isInteger(range?.from) || !Number.isInteger(range?.to)
    || range.from < 0 || range.to > context.doc.content.size || range.from >= range.to) return false
  const target = { ...range }
  let values
  try {
    const slice = context.doc.slice(target.from, target.to)
    const content = (context.editor.storage.larkDoc?.pagedView?.copySlice(slice) || slice).content
    if (!context.editor.schema.topNodeType.validContent(content)) return false
    values = serializeBlockClipboard(context.editor.view, content)
  } catch {
    if (current()) owner.error = '无法完整复制区块，原区块未被修改'
    return false
  }
  const html = values['text/html'], text = values['text/plain']
  // Only the real copy event proves that native paste can see the block MIME.
  // Async custom-format success and plain text remain copy-only outcomes.
  let nativeCopied = false, copied = false
  try {
    if (cut) nativeCopied = copied = richFallback(html, text, current, values[BLOCK_CLIPBOARD_MIME])
    if (!copied && current() && navigator.clipboard?.write && window.ClipboardItem) {
      const types = {
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' }),
      }
      const customType = `web ${BLOCK_CLIPBOARD_MIME}`
      if (window.ClipboardItem.supports?.(customType)) types[customType] = new Blob([values[BLOCK_CLIPBOARD_MIME]], { type: BLOCK_CLIPBOARD_MIME })
      const item = new window.ClipboardItem(types)
      if (!current()) return false
      await navigator.clipboard.write([item])
      copied = true
    }
  } catch { /* 富文本不受支持时尝试纯文本；每次写入前仍核原作用域。 */ }
  if (!copied && !cut && current()) {
    try { copied = richFallback(html, text, current, values[BLOCK_CLIPBOARD_MIME]) } catch { /* 保留纯文本回退。 */ }
  }
  if (!copied && current()) {
    try { copied = await plainText(text, current) } catch { /* 保留原失败反馈。 */ }
  }
  if (!current()) return false
  if (!copied) { owner.error = '无法访问剪贴板，区块未被修改；可手动选择后复制'; return false }
  if (cut && !nativeCopied) { owner.error = '已复制区块，但未确认完整粘贴能力；原区块未被剪切'; return false }
  if (cut) owner.deleteBlockRange(target)
  owner.error = cut ? '已剪切区块' : '已复制区块'
  owner.$nextTick(() => { if (copyContextCurrent(context, false)) context.editor.view.focus() })
  return true
}
