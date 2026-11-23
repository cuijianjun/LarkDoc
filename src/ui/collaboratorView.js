/**
 * 协作者二级弹窗（飞书 04 §4.2.3）：管理协作者 → 添加协作者。
 *
 * 两个弹窗替换分享 popover 的位置而**不加暗遮罩**（真身截图背景文档清晰可见，
 * 顶部「分享 / 编辑」按钮仍可辨）——与权限设置 Dialog 的半透明遮罩不同。
 * 头是「返回箭头 + 标题」（无 ×），返回上一层；Esc/点遮罩都走返回。
 *
 * 业务全走既有 shareMembers / shareDirectory / shareInvitation 状态与 handler，
 * 这里只做渲染与显隐路由，不新增写入语义。
 */
import { setText, syncChildren } from './dom'
import { iconNode } from './icon'
import { attr, button, callHandler, setInputValue, text } from './overlayShared'

/** 返回箭头：飞书头部的细线左尖角，复用 chevron-right 旋转 180°。 */
function backHeader(title, className, onBack) {
  const header = text('div', className)
  const back = button('lark-doc-collab-back', '', onBack)
  attr(back, 'aria-label', '返回')
  back.appendChild(iconNode('chevron-right', 16))
  header.appendChild(back)
  header.appendChild(text('h3', 'lark-doc-collab-title', title))
  return header
}

function createManageView(options) {
  const handlers = options.handlers || {}
  const state = {}
  const root = text('div', 'lark-doc-collab-manage')
  attr(root, 'role', 'dialog'); attr(root, 'aria-label', '管理协作者')

  root.appendChild(backHeader('管理协作者', 'lark-doc-collab-header', () => callHandler(handlers, 'onCloseCollaboratorManage')))
  root.appendChild(text('p', 'lark-doc-collab-subtitle', '所有可访问此文档的用户'))

  const list = text('div', 'lark-doc-collab-list')
  root.appendChild(list)

  const footer = text('div', 'lark-doc-collab-footer')
  const add = button('lark-doc-collab-add-btn', '', () => callHandler(handlers, 'onOpenCollaboratorAdd'))
  attr(add, 'aria-label', '添加协作者')
  add.appendChild(iconNode('members', 18))
  add.appendChild(text('span', '', '添加协作者'))
  footer.appendChild(add)
  root.appendChild(footer)

  const rows = new Map()
  function render() {
    const members = state.shareMembers || {}
    const items = members.status === 'ready' ? members.items || [] : []
    setText(list, members.status === 'loading' ? '正在加载协作者…'
      : members.status === 'failed' ? members.error || '无法加载协作者，请重试。'
      : !items.length ? '暂无协作者' : '')
    if (members.status !== 'ready' || !items.length) {
      rows.forEach(node => node.remove()); rows.clear(); return
    }
    syncChildren(list, items.map(member => {
      let row = rows.get(member.principalId)
      if (!row) {
        row = text('div', 'lark-doc-collab-member')
        const avatar = text('span', 'lark-doc-collab-avatar')
        const nameWrap = text('div', 'lark-doc-collab-member-name')
        const name = text('span', 'lark-doc-collab-name')
        nameWrap.appendChild(name)
        const role = text('span', 'lark-doc-collab-role')
        row.append(avatar, nameWrap, role)
        row._parts = { avatar, name, role }
        rows.set(member.principalId, row)
      }
      const parts = row._parts
      // listMembers 真实字段只有 principalId/scopes/sources（providers/authorization.js:348），
      // 没有 displayName/组织/isOwner；不臆造这些值，头像取 principalId 首字、名称回退 principalId。
      const initial = (member.displayName || member.principalId).slice(0, 1)
      setText(parts.avatar, initial)
      setText(parts.name, member.displayName || member.principalId)
      // 角色口径（05 §5.5.1 + shareModel INVITE_SCOPES）：grant.manage=可管理，
      // document.write=可编辑，否则可阅读。
      setText(parts.role, member.scopes?.includes('grant.manage') ? '可管理'
        : member.scopes?.includes('document.write') ? '可编辑' : '可阅读')
      return { node: row, on: true }
    }))
  }

  return {
    el: root,
    update(next) { Object.assign(state, next); render() },
  }
}

function createAddView(options) {
  const handlers = options.handlers || {}
  const state = {}
  const root = text('div', 'lark-doc-collab-add')
  attr(root, 'role', 'dialog'); attr(root, 'aria-label', '添加协作者')

  root.appendChild(backHeader('添加协作者', 'lark-doc-collab-header', () => callHandler(handlers, 'onCloseCollaboratorAdd')))

  const search = text('div', 'lark-doc-collab-search')
  const input = document.createElement('input')
  attr(input, 'aria-label', '搜索用户、群组、部门、用户组或智能体')
  input.placeholder = '搜索用户、群组、部门、用户组或智能体'
  input.addEventListener('input', event => callHandler(handlers, 'onSetShareInviteQuery', event.target.value))
  search.appendChild(input)
  const addSign = button('lark-doc-collab-search-add', '', () => callHandler(handlers, 'onOpenCollaboratorAdd'))
  attr(addSign, 'aria-label', '添加选中的协作者')
  addSign.appendChild(iconNode('plus', 16))
  search.appendChild(addSign)
  root.appendChild(search)

  const results = text('div', 'lark-doc-collab-results')
  root.appendChild(results)
  const status = text('p', 'lark-doc-collab-status'); attr(status, 'role', 'status')
  root.appendChild(status)

  const subpage = makeCheckRow('允许协作者同时访问子页面', '已勾选，则添加的协作者可以访问当前页面及子页面', true, () => callHandler(handlers, 'onToggleCollaboratorSubpage'))
  root.appendChild(subpage.row)
  const notify = makeCheckRow('发送通知', '', true, () => callHandler(handlers, 'onToggleCollaboratorNotify'))
  root.appendChild(notify.row)

  const note = document.createElement('textarea')
  attr(note, 'aria-label', '添加备注（消息会发送到飞书会话）')
  note.placeholder = '添加备注（消息会发送到飞书会话）'
  note.addEventListener('input', event => callHandler(handlers, 'onSetCollaboratorNote', event.target.value))
  root.appendChild(note)

  const footer = text('div', 'lark-doc-collab-add-footer')
  const cancel = button('lark-doc-collab-btn-outlined', '取消', () => callHandler(handlers, 'onCloseCollaboratorAdd'))
  const send = button('lark-doc-collab-btn-filled', '发送', () => callHandler(handlers, 'onSubmitShareInvitation'))
  footer.append(cancel, send)
  root.appendChild(footer)

  const rows = new Map()
  function render() {
    const directory = state.shareDirectory || {}, invitation = state.shareInvitation || {}
    setInputValue(input, state.shareInviteQuery)
    // 真身两项默认都勾选（04 §4.2.3 + 真身截图）：字段未传/初始态时保持勾选。
    subpage.set(state.collaboratorSubpage !== false)
    notify.set(state.collaboratorNotify !== false)
    setInputValue(note, state.collaboratorNote)
    const items = directory.status === 'ready' ? directory.items || [] : []
    setText(status, directory.status === 'loading' ? '正在搜索…'
      : ['failed', 'blocked'].includes(directory.status) ? directory.error || '搜索失败，请重试。'
      : directory.status === 'ready' && !items.length && !invitation.candidate ? '未找到协作者' : '')
    rows.forEach(node => { if (!items.some(item => item.principalId === node.dataset.principal)) { node.remove(); rows.delete(node.dataset.principal) } })
    syncChildren(results, items.map(candidate => {
      let row = rows.get(candidate.principalId)
      if (!row) {
        row = button('lark-doc-collab-candidate', '', () => callHandler(handlers, 'onSelectShareInviteCandidate', candidate.principalId))
        row.dataset.principal = candidate.principalId
        rows.set(candidate.principalId, row)
      }
      setText(row, candidate.displayName || candidate.principalId)
      attr(row, 'aria-label', `选择协作者 ${candidate.displayName || candidate.principalId}`)
      return { node: row, on: true }
    }))
    // 未选收件人时「发送」disabled（04 §4.2.3）。
    send.disabled = !invitation.candidate || invitation.status === 'sending'
  }

  return {
    el: root,
    update(next) { Object.assign(state, next); render() },
  }
}

function makeCheckRow(label, desc, checked, onChange) {
  const row = text('label', 'lark-doc-collab-check-row')
  const box = document.createElement('input')
  box.type = 'checkbox'
  box.className = 'lark-doc-collab-checkbox'
  box.checked = checked
  box.onchange = onChange
  row.appendChild(box)
  row.appendChild(text('span', 'lark-doc-collab-check-label', label))
  if (desc) row.appendChild(text('span', 'lark-doc-collab-check-desc', desc))
  return {
    row,
    set(value) { if (box.checked !== value) box.checked = value; box.classList.toggle('is-on', !!value) },
  }
}

export { createManageView, createAddView }
