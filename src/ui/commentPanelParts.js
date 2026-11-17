/**
 * 评论面板里的两段纯函数 —— 无闭包依赖，面板与线程卡片共用。
 *
 * 从 `ui/commentPanel.js` 原样搬出，函数体一行未改。
 */

import { setInputValue } from './panelShared'

// Standalone UI keeps its dependency-free textarea contract. The native editor
// injects the rich factory from its existing PM runtime instead of bundling PM
// again into the independently loaded UI feature.
export function createPlainCommentInput({ label, placeholder, onChange }) {
  const el = document.createElement('textarea')
  el.setAttribute('aria-label', label); el.placeholder = placeholder
  el.addEventListener('input', () => onChange({ content: el.value, mentions: [], references: [], caret: el.selectionStart }))
  el.addEventListener('keydown', event => el.dispatchEvent(new CustomEvent('comment-keydown', { detail: event })))
  return {
    el, focus: () => el.focus(),
    update(next) { setInputValue(el, next.value); el.readOnly = !!next.readonly },
    destroy: () => el.remove(),
  }
}

export function renderCommentSegments(node, segments, onReference) {
  node.textContent = ''
  const list = Array.isArray(segments) && segments.length ? segments : [{ text: '' }]
  list.forEach((segment) => {
    const value = segment && typeof segment === 'object' ? segment : { text: segment }
    const text = value.text == null ? '' : String(value.text)
    const linkMark = Array.isArray(value.marks) && value.marks.find(mark => mark?.type === 'link' && typeof mark.attrs?.href === 'string' && /^https?:\/\//.test(mark.attrs.href))
    const part = document.createElement(linkMark ? 'a' : 'span')
    if (linkMark) { part.href = linkMark.attrs.href; part.target = '_blank'; part.rel = 'noopener noreferrer'; part.className = 'lark-doc-comment-rich-link' }
    if (Array.isArray(value.marks)) {
      value.marks.forEach(mark => {
        if (mark?.type === 'bold') part.classList.add('is-bold')
        if (mark?.type === 'italic') part.classList.add('is-italic')
        if (mark?.type === 'strike') part.classList.add('is-strike')
        if (mark?.type === 'code') part.classList.add('is-code')
      })
    }
    if (value.docId) {
      part.className = 'lark-doc-comment-document-reference' + (value.readable === false ? ' is-disabled' : '')
      part.dataset.commentReference = value.docId
      part.setAttribute('role', 'link')
      part.tabIndex = value.readable === false ? -1 : 0
      part.setAttribute('aria-disabled', String(value.readable === false))
      part.appendChild(document.createTextNode(text))
      if (value.readable !== false && typeof onReference === 'function') {
        const activate = (event) => {
          event.preventDefault(); event.stopPropagation(); onReference(value, event)
        }
        part.addEventListener('click', activate)
        part.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') activate(event) })
      }
    } else if (value.principalId) {
      part.className = 'lark-doc-comment-mention-chip'
      part.dataset.commentMention = value.principalId
      if (value.isSelf) part.classList.add('is-self')
      part.appendChild(document.createTextNode(text))
    } else {
      part.appendChild(document.createTextNode(text))
    }
    node.appendChild(part)
  })
}
