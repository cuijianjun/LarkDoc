/** 宿主保存模板的懒加载桥：只导出句柄目标，取消/换文档后不再提交旧结果。 */
import { DOMSerializer, Fragment } from '@tiptap/pm/model'
import { createTemplateSaveDialog } from '../ui/dialogs'

export function openTemplateSave({ host, range, isCurrent }) {
  if (!isCurrent()) return null
  const editor = host.editor, session = host.session, callback = host.onSaveTemplate
  const slice = editor.state.doc.slice(range.from, range.to)
  let fragment = (editor.storage.larkDoc?.pagedView?.copySlice(slice) || slice).content
  if (['taskItem', 'listItem'].includes(fragment.firstChild?.type.name)) {
    const parent = editor.state.doc.resolve(range.from).parent
    fragment = Fragment.from(parent.type.create(parent.attrs, fragment))
  }
  if (!editor.schema.topNodeType.validContent(fragment)) throw new Error('请选择完整区块后保存模板')
  const owner = editor.view.dom.ownerDocument, holder = owner.createElement('div')
  holder.appendChild(DOMSerializer.fromSchema(editor.schema).serializeFragment(fragment, { document: owner }))
  holder.querySelectorAll('[data-block-id]').forEach(element => element.removeAttribute('data-block-id'))
  // PM's toJSON may retain the immutable node's attrs object. Copy rather
  // than deleting IDs on that shared object and corrupting the source block.
  const content = JSON.parse(JSON.stringify(fragment.toJSON(), (key, value) => key === 'blockId' ? undefined : value))
  const payload = {
    documentId: session?.documentId ?? host.documentId,
    blockId: editor.state.doc.nodeAt(range.from)?.attrs.blockId || null,
    content: { type: 'doc', content }, html: holder.innerHTML,
  }
  const controller = new AbortController(), offs = []
  let destroyed = false
  const current = () => !destroyed && !controller.signal.aborted && isCurrent()
  const close = () => { const restore = current(); host.closeBlockTemplateSave(); if (restore) editor.view.focus() }
  const check = () => { if (!current()) close() }
  const view = createTemplateSaveDialog({ host: host.$refs.dialogHost,
    name: fragment.textBetween(0, fragment.size, ' ').trim().slice(0, 48) || '未命名模板',
    handlers: {
      isCurrent: current, onClose: close,
      async onSave(name) {
        if (!current()) throw new Error('文档已变化，请重新选择区块')
        const result = await callback({ ...payload, name, signal: controller.signal })
        if (!current()) return false
        if (!result || typeof result.id !== 'string' || !result.id.trim()) throw new Error('模板尚未保存，请重试')
        host.showShareToast('success', '模板已保存')
        return true
      },
    },
  })
  editor.on('transaction', check); editor.on('destroy', close)
  for (const event of ['provider', 'editor', 'connection', 'capabilities']) {
    const off = session?.on?.(event, check)
    if (typeof off === 'function') offs.push(off)
  }
  return { destroy() {
    if (destroyed) return
    destroyed = true; controller.abort()
    editor.off('transaction', check); editor.off('destroy', close)
    offs.forEach(off => off()); view.destroy()
  } }
}
