/**
 * 评论图片附件 —— 与飞书基线同一套 DOM / 类名 / aria 口径。
 *
 * 两种用法由 `draft` 区分：
 * - `draft=true`：草稿态（上传中 / 失败 / 可移除），由 `onRetryAttachment`、`onRemoveAttachment` 驱动；
 * - `draft=false`：已保存附件，图外面包一层 `attachment-preview` 按钮，由 `onPreviewAttachment` 打开查看器。
 *
 * 上传进度、失败原因、重试入口都挂在同一个 `.lark-doc-comment-attachment` 上，宿主只换状态不改结构。
 */

import { onMouseDownPrevent } from './panelShared'

export function commentAttachmentNodes(items, draft, call) {
  return (items || []).map((item, index) => {
    const attachment = draft ? item.attachment || (item.previewUrl ? { url: item.previewUrl, name: item.name } : null) : item
    const root = document.createElement('div')
    root.className = 'lark-doc-comment-attachment'
    root.classList.toggle('is-draft', draft)
    if (attachment?.url) {
      const image = document.createElement('img')
      image.src = attachment.url
      image.alt = attachment.name || item.name || '评论图片'
      if (draft) root.appendChild(image)
      else {
        const preview = document.createElement('button')
        preview.type = 'button'
        preview.className = 'lark-doc-comment-attachment-preview'
        preview.setAttribute('aria-label', `预览评论图片${index + 1}`)
        preview.appendChild(image)
        onMouseDownPrevent(preview, () => call?.('onPreviewAttachment', index))
        root.appendChild(preview)
      }
    } else {
      const label = document.createElement('span')
      label.textContent = attachment?.blocked ? attachment.blockedReason || '图片被当前网络策略拦截' : item.error || `${item.name || '图片'}${item.status === 'uploading' ? ` ${item.progress || 0}%` : ''}`
      root.appendChild(label)
    }
    if (draft) {
      if (item.status === 'pending' || item.status === 'uploading') {
        const status = document.createElement('div')
        status.className = 'lark-doc-comment-attachment-status'
        status.setAttribute('role', 'status')
        status.textContent = `${item.progress || 0}%`
        const progress = document.createElement('progress')
        progress.max = 100
        progress.value = item.progress || 0
        progress.setAttribute('aria-label', '评论图片上传进度')
        status.appendChild(progress)
        root.appendChild(status)
      }
      if (item.status === 'error') {
        root.title = item.error || '图片上传失败，请重试'
        const retry = document.createElement('button')
        retry.type = 'button'
        retry.className = 'lark-doc-comment-attachment-retry'
        retry.textContent = '重试'
        onMouseDownPrevent(retry, () => call('onRetryAttachment', item.id))
        root.appendChild(retry)
      }
      const remove = document.createElement('button')
      remove.type = 'button'
      remove.className = 'lark-doc-comment-attachment-remove'
      remove.setAttribute('aria-label', '移除评论图片')
      remove.textContent = '×'
      onMouseDownPrevent(remove, () => call('onRemoveAttachment', item.id))
      root.appendChild(remove)
    }
    return root
  })
}
