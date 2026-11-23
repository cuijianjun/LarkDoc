/**
 * 协作者二级弹窗（飞书 04 §4.2.3）：管理协作者 → 添加协作者。
 *
 * 两个弹窗替换分享 popover 的位置而**不加暗遮罩**（真身截图背景文档清晰可见，
 * 顶部「分享 / 编辑」按钮仍可辨）——与权限设置 Dialog 的半透明遮罩不同。
 * 头是「返回箭头 + 标题」（无 ×），返回上一层；Esc/点遮罩都走返回。
 *
 * 几何全部照真身 2× 截图量取（CSS = device/2）：
 * - 头 56 高、左内边距 16、箭头 20（chevron 旋转 180°）、标题 14/600、箭头到标题 6；
 * - 成员行头像 32（蓝渐变 #3F7AFF→#2663F1，字取名字后两字）、姓名 14、
 *   「所有者 / 外部」标签 12/高 16/圆角 4/底 #D2DEFD/字 #1556F0、部门 13 灰；
 *   右侧角色是**纯文字**（真身实测「可管理」后面没有三角，不是下拉）；
 * - 底部「添加协作者」行 60 高、上边框、图标 18 + 文字 14。
 *
 * 业务全走既有 shareMembers / shareDirectory / shareInvitation 状态与 handler，
 * 这里只做渲染与显隐路由，不新增写入语义。
 */
import { setText, syncChildren } from './dom'
import { iconNode } from './icon'
import { attr, button, callHandler, setInputValue, text } from './overlayShared'

/** 返回箭头：飞书头部是 20 的细线左尖角，复用 chevron-right 旋转 180°（见 CSS）。 */
function backHeader(title, className, onBack) {
  const header = text('div', className)
  const back = button('lark-doc-collab-back', '', onBack)
  attr(back, 'aria-label', '返回')
  back.appendChild(iconNode('chevron-right', 20))
  header.appendChild(back)
  header.appendChild(text('h3', 'lark-doc-collab-title', title))
  return header
}

/**
 * 头像字：真身账号「崔健军」在 32 头像里显示「健军」——取名字后两字；
 * 拉丁名（bob）取首字母大写。
 */
function avatarLabel(name) {
  const value = String(name || '')
  if (!value) return ''
  if (/[\u4e00-\u9fa5]/.test(value)) return value.slice(-2)
  return value.slice(0, 1).toUpperCase()
}

/** 角色口径（05 §5.5.1 + shareModel INVITE_SCOPES）。 */
function roleLabel(member) {
  const scopes = member.scopes || []
  if (scopes.includes('grant.manage')) return '可管理'
  if (scopes.includes('document.write')) return '可编辑'
  return '可阅读'
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
        const main = text('div', 'lark-doc-collab-member-main')
        const title = text('div', 'lark-doc-collab-member-title')
        const name = text('span', 'lark-doc-collab-name')
        const tag = text('span', 'lark-doc-collab-tag')
        const dept = text('span', 'lark-doc-collab-dept')
        title.append(name, tag)
        main.append(title, dept)
        const role = text('span', 'lark-doc-collab-role')
        row.append(avatar, main, role)
        row._parts = { avatar, name, tag, dept, role }
        rows.set(member.principalId, row)
      }
      const parts = row._parts
      // listMembers 只回 principalId/scopes/sources（providers/authorization.js:348）。
      // displayName / department / isOwner / isExternal 缺哪个就隐藏哪个，不臆造。
      const label = member.displayName || member.principalId || ''
      setText(parts.avatar, avatarLabel(label))
      setText(parts.name, label)
      const tagText = member.isOwner ? '所有者' : member.isExternal ? '外部' : ''
      setText(parts.tag, tagText)
      parts.tag.hidden = !tagText
      setText(parts.dept, member.department || '')
      parts.dept.hidden = !member.department
      setText(parts.role, roleLabel(member))
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
        // 真身候选行是「头像 + 主名（+ 外部标签）/ 部门」两行结构；群组行尾是
        // 全角括号人数「（20）」。resolveMentions 只回 displayName/kind，缺的字段
        // （部门 / 外部 / 人数）就不画，等协议补齐再显示。
        const avatar = text('span', 'lark-doc-collab-avatar')
        const main = text('div', 'lark-doc-collab-member-main')
        const title = text('div', 'lark-doc-collab-member-title')
        const name = text('span', 'lark-doc-collab-name')
        const tag = text('span', 'lark-doc-collab-tag')
        const count = text('span', 'lark-doc-collab-count')
        const dept = text('span', 'lark-doc-collab-dept')
        title.append(name, tag, count)
        main.append(title, dept)
        row.append(avatar, main)
        row._parts = { avatar, name, tag, count, dept }
        rows.set(candidate.principalId, row)
      }
      const parts = row._parts
      const label = candidate.displayName || candidate.principalId || ''
      setText(parts.avatar, avatarLabel(label))
      setText(parts.name, label)
      setText(parts.tag, candidate.isExternal ? '外部' : '')
      parts.tag.hidden = !candidate.isExternal
      setText(parts.count, candidate.memberCount ? `（${candidate.memberCount}）` : '')
      parts.count.hidden = !candidate.memberCount
      setText(parts.dept, candidate.department || '')
      parts.dept.hidden = !candidate.department
      attr(row, 'aria-label', `选择协作者 ${label}`)
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
