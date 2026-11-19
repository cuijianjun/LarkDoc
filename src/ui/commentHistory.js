/**
 * 历史评论浮层 —— 从「文档更多操作 → 历史评论」打开的 fixed 360px 弹层。
 *
 * 与侧栏里的「已解决评论」列表是两套东西：这里是**已解决线程的只读归档**，
 * 条目复用线程卡的节点工厂（`createPanelNode` + `buildReplies`），只保留
 * 已解决说明、引用、回复流三段，其余（头像信息、输入区、更多菜单）由
 * `syncChildren` 淘汰掉。
 *
 * 弹层自己负责外点/`Escape` 关闭，判定口径与基线一致：点界面内任何
 * `[data-lark-doc-image-ui]`（图片预览之类）都不算外点，避免预览关闭时
 * 连弹层一起吃掉。
 */

import { applyStyle, syncChildren } from './dom'
import { iconNode } from './icon'
import { onMouseDownPrevent } from './panelShared'

/**
 * @param {object} options
 * @param {(value: string) => any} options.createPanelNode 线程卡节点工厂
 * @param {(item: object) => Node[]} options.buildReplies 回复流重建
 * @param {(...args: any[]) => any} options.call 面板 handler 调用器
 * @param {Document} options.ownerDocument 用于 capture 监听外点
 */
export function createCommentHistory(options) {
  const { createPanelNode, buildReplies, call, ownerDocument } = options

  const history = document.createElement('section')
  history.className = 'lark-doc-comment-history'
  history.setAttribute('role', 'dialog')
  history.setAttribute('aria-label', '历史评论')
  const head = document.createElement('header')
  head.className = 'lark-doc-comment-history-head'
  head.textContent = '历史评论'
  const info = document.createElement('button')
  info.type = 'button'
  info.className = 'lark-doc-comment-history-info'
  info.setAttribute('aria-label', '历史评论查看权限')
  info.appendChild(iconNode('comment-history-info', 16))
  const hint = document.createElement('span')
  hint.className = 'lark-doc-comment-history-hint'
  hint.textContent = '仅支持可编辑文档的用户查看'
  info.appendChild(hint)
  head.appendChild(info)
  const list = document.createElement('div')
  list.className = 'lark-doc-comment-history-list'
  const empty = document.createElement('div')
  empty.className = 'lark-doc-comment-history-empty'
  const illustration = document.createElement('div')
  illustration.className = 'lark-doc-comment-history-illustration'
  illustration.setAttribute('aria-hidden', 'true')
  illustration.appendChild(iconNode('comment-history-empty', 120))
  const emptyText = document.createElement('div')
  emptyText.className = 'lark-doc-comment-history-empty-text'
  emptyText.textContent = '在这可查看所有已解决的评论'
  empty.append(illustration, emptyText)
  history.append(head, list)

  /** @type {Map<string, ReturnType<typeof createPanelNode>>} */
  const nodes = new Map()
  let listening = false

  function dismiss(event) {
    if (event.target.closest?.('[data-lark-doc-image-ui]')) return
    if (event.type === 'keydown') {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        call('onCloseHistory')
      }
    } else if (!history.contains(event.target)) call('onCloseHistory')
  }
  function listen(on) {
    if (listening === on) return
    listening = on
    for (const type of ['pointerdown', 'keydown']) ownerDocument[on ? 'addEventListener' : 'removeEventListener'](type, dismiss, true)
  }

  function resolvedRow(entry, item) {
    if (entry.resolved) return
    entry.resolved = document.createElement('div')
    entry.resolved.className = 'lark-doc-comment-history-resolved'
    const label = document.createElement('span')
    label.textContent = '已解决此评论'
    entry.reopen = document.createElement('button')
    entry.reopen.type = 'button'
    entry.reopen.className = 'lark-doc-comment-history-reopen'
    entry.reopen.textContent = '重新打开'
    onMouseDownPrevent(entry.reopen, () => {
      if (entry.reopen.getAttribute('aria-disabled') !== 'true') call('onControl', 'reopen', item.id)
    })
    const actions = document.createElement('span')
    actions.className = 'lark-doc-comment-history-actions'
    const split = document.createElement('span')
    split.className = 'lark-doc-comment-history-split'
    entry.remove = document.createElement('button')
    entry.remove.type = 'button'
    entry.remove.className = 'lark-doc-comment-history-delete'
    entry.remove.setAttribute('aria-label', '删除评论线程')
    entry.remove.appendChild(iconNode('table-float-remove', 16))
    onMouseDownPrevent(entry.remove, () => {
      if (entry.remove.getAttribute('aria-disabled') !== 'true') call('onDeleteThread', item.id)
    })
    actions.append(entry.reopen, split, entry.remove)
    entry.resolved.append(label, actions)
  }

  /**
   * @param {{ historyOpen?: boolean, historyStyle?: object, historyItems?: object[] }} state
   */
  function render(state) {
    listen(!!state.historyOpen)
    if (!state.historyOpen) return
    applyStyle(history, state.historyStyle)
    const alive = new Set()
    const rendered = (state.historyItems || []).map((item) => {
      alive.add(item.id)
      let entry = nodes.get(item.id)
      if (!entry) {
        entry = createPanelNode(item.id)
        nodes.set(item.id, entry)
      }
      entry.root.classList.add('lark-doc-comment-history-item')
      entry.root.setAttribute('aria-label', '已解决的评论')
      entry.quote.textContent = item.quote || '原引用已删除'
      resolvedRow(entry, item)
      entry.reopen.setAttribute('aria-disabled', String(!item.canReopen))
      entry.remove.setAttribute('aria-disabled', String(!item.canDelete))
      entry.remove.setAttribute('aria-busy', String(!!item.deleteBusy))
      entry.remove.title = item.deleteBusy ? '删除中…' : item.canDelete ? '删除评论线程' : '当前评论服务不支持删除线程或没有删除权限'
      const signature = JSON.stringify(item.replies || [])
      if (entry.repliesSignature !== signature) {
        entry.repliesSignature = signature
        syncChildren(entry.replies, buildReplies(item).map((node) => ({ node, on: true })))
      }
      syncChildren(entry.root, [entry.resolved, entry.quote, entry.replies].map((node) => ({ node, on: true })))
      return entry.root
    })
    for (const [id, entry] of nodes) {
      if (alive.has(id)) continue
      entry.root.remove()
      nodes.delete(id)
    }
    syncChildren(list, (rendered.length ? rendered : [empty]).map((node) => ({ node, on: true })))
  }

  function destroy() {
    listen(false)
    nodes.clear()
    history.remove()
  }

  return { history, render, destroy }
}
