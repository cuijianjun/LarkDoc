/* 低频剪贴板执行；快照由点击入口同步捕获，不能在首次import后重新取身份或正文。 */
export function copyContextCurrent(context, checkDoc = true) {
  if (!context) return false
  const { owner, editor, doc, kind, parent, session } = context
  if (!owner || owner._isDestroyed || owner._isBeingDestroyed || !editor || editor.isDestroyed ||
    (kind === 'preview' ? owner.previewEditor : owner.editor) !== editor || (checkDoc && doc !== editor.state?.doc)) return false
  if (kind === 'preview') return Boolean(parent && parent.owner === owner.ed && copyContextCurrent(parent, checkDoc))
  if (kind === 'code') return (!parent || parent.editor === editor && copyContextCurrent(parent, checkDoc)) && editor.options?.editorProps?.larkDocCanCopy?.() !== false
  return session === owner.session && context.provider === session?.getProvider?.('authorization') &&
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

export async function copySelection(context, range) {
  const current = () => copyContextCurrent(context)
  if (!current()) return false
  const text = context.doc.textBetween(range.from, range.to, '\n')
  try { return await plainText(text, current, true) }
  catch { return false }
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
  const current = () => copyContextCurrent(context), owner = context.owner
  if (!current() || !owner.writable()) return false
  const text = context.doc.textBetween(range.from, range.to, '\n')
  const content = context.doc.slice(range.from, range.to).content.toJSON()
  const structured = JSON.stringify({ schemaVersion: 1, type: 'lark-doc-block', content })
  let copied = false
  try {
    if (navigator.clipboard?.write && window.ClipboardItem) {
      await navigator.clipboard.write([new window.ClipboardItem({
        'text/plain': new Blob([text], { type: 'text/plain' }),
        'application/x-lark-doc-block+json': new Blob([structured], { type: 'application/json' }),
      })])
      copied = true
    }
  } catch { /* 富文本不受支持时尝试纯文本；每次写入前仍核原作用域。 */ }
  if (!copied && current()) {
    try { copied = await plainText(text, current) } catch { /* 保留原失败反馈。 */ }
  }
  if (!current()) return false
  if (!copied) { owner.error = '无法访问剪贴板，区块未被修改；可手动选择后复制'; return false }
  if (cut && !owner.writable()) return false
  if (cut) owner.deleteBlockRange(range)
  owner.error = cut ? '已剪切区块' : '已复制区块'
  owner.$nextTick(() => { if (copyContextCurrent(context, false)) context.editor.view.focus() })
  return true
}
