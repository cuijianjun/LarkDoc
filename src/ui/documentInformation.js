/** Read-only phone information views. All account and persistence writes remain with the host. */
import { lockPageScroll } from './dom'
const TITLES = { information: '文档信息', visits: '访问记录', operations: '操作记录', privacy: '隐私设置', 'page-settings': '页面设置' }
const CATEGORIES = [['all', '全部'], ['share', '分享授权'], ['duplicate', '创建副本'], ['download', '下载'], ['settings', '权限设置变更']]
const ACTIONS = { permissions: '分享授权', duplicate: '创建副本', download: '下载', 'sharing-settings': '权限设置变更' }
const unknown = value => value === null || value === undefined || value === '' ? '未知' : String(value)
const date = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('zh-CN') : '未知'

export function createDocumentInformationPanel({ host, read, statistics, current = () => true, onClose, initialView = 'information', returnFocus } = {}) {
  if (!host || !current()) return null
  const owner = host.ownerDocument, previousFocus = returnFocus || owner.activeElement
  let destroyed = false, request = 0, view = initialView, category = 'all', information = null
  function node(tag, className, text) {
    const result = owner.createElement(tag)
    if (className) result.className = className
    if (text !== undefined) result.textContent = text
    return result
  }
  function button(label, action, className) {
    const result = node('button', className, label)
    result.type = 'button'
    result.addEventListener('click', () => { if (guard()) action() })
    return result
  }
  const root = node('section', 'lark-doc-document-information')
  root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.tabIndex = -1
  const mask = button('', destroy, 'lark-doc-document-information-mask')
  mask.setAttribute('aria-label', '关闭文档信息')
  const sheet = node('div', 'lark-doc-document-information-sheet')
  const head = node('header', 'lark-doc-document-information-head')
  const back = button('返回', () => show('information'))
  const title = node('strong')
  const close = button('×', destroy); close.setAttribute('aria-label', '关闭')
  head.append(back, title, close)
  const tabs = node('div', 'lark-doc-document-information-tabs'); tabs.setAttribute('role', 'tablist')
  const body = node('div', 'lark-doc-document-information-body'); body.tabIndex = 0
  const categoryButtons = CATEGORIES.map(([id, label]) => {
    const item = button(label, () => show('operations', id))
    item.setAttribute('role', 'tab'); item.dataset.informationCategory = id
    tabs.appendChild(item)
    return item
  })
  sheet.append(head, tabs, body); root.append(mask, sheet); host.appendChild(root)
  const scrollLocks = [...new Set([owner.body, host.closest('.lark-doc')?.querySelector('.lark-doc-main')].filter(Boolean))].map(lockPageScroll)
  mask.style.touchAction = 'none'
  mask.addEventListener('touchmove', event => event.preventDefault(), { passive: false })
  root.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); destroy(); return }
    if (['PageDown', 'PageUp', 'ArrowDown', 'ArrowUp', ' '].includes(event.key) && (event.target === root || event.target === mask)) { event.preventDefault(); return }
    if (event.key !== 'Tab') return
    const choices = [...root.querySelectorAll('button:not(:disabled),[tabindex="0"]')].filter(item => !item.closest('[hidden]'))
    const index = choices.indexOf(owner.activeElement)
    if (choices.length && (event.shiftKey ? index <= 0 : index === choices.length - 1)) {
      event.preventDefault(); choices[event.shiftKey ? choices.length - 1 : 0].focus()
    }
  })
  function guard() { if (destroyed) return false; if (!current()) { destroy(); return false } return true }
  function notice(text, error = false) {
    const result = node('p', 'lark-doc-document-information-notice', text)
    result.setAttribute('role', error ? 'alert' : 'status'); body.appendChild(result)
  }
  function section(label) { body.appendChild(node('h3', '', label)) }
  function row(label, value) {
    const result = node('div', 'lark-doc-document-information-row')
    result.append(node('span', '', label), node('span', '', unknown(value))); body.appendChild(result)
  }
  function nav(label, next) {
    const result = button(`${label} ›`, () => show(next), 'lark-doc-document-information-row')
    result.dataset.informationView = next; body.appendChild(result)
  }
  function renderInformation(value) {
    section('概览')
    row('所有者', value?.ownerName || value?.ownerId); row('创建者', value?.creatorName || value?.creatorId)
    row('创建时间', date(value?.createdAt)); row('最近修改', date(value?.updatedAt))
    section('文档统计')
    row('总字数', statistics?.words); row('总字符数', statistics?.characters)
    row('正文 JSON 大小', Number.isFinite(statistics?.bytes) ? `${(statistics.bytes / 1024).toFixed(2)} KB` : null)
    section('互动数据')
    const interaction = value?.interaction
    for (const [key, label] of [['visitors', '访问人数'], ['visits', '访问次数'], ['comments', '评论总数'], ['likes', '点赞总数']]) row(label, interaction?.[key])
    nav('访问记录', 'visits'); nav('操作记录', 'operations'); nav('隐私设置', 'privacy')
  }
  function readOnlySwitch(label, value, description) {
    const result = node('label', 'lark-doc-document-information-row'), text = node('span')
    text.append(node('span', '', label), node('small', '', description))
    const input = node('input'); input.type = 'checkbox'; input.disabled = true
    input.checked = value === true; input.indeterminate = typeof value !== 'boolean'
    input.setAttribute('aria-label', `${label}${typeof value === 'boolean' ? '' : '，状态未知'}`)
    input.title = '此面板仅展示状态，修改需要宿主提供设置功能。'
    result.append(text, input); body.appendChild(result)
  }
  function renderPrivacy(value) {
    readOnlySwitch('展示访问记录', value?.showVisitRecords, '关闭后，你访问他人文档以及他人访问你的文档时不记录访问记录。')
    readOnlySwitch('展示访问头像', value?.showVisitAvatars, '关闭后，访问他人文档时不在协作者栏展示你的头像。')
    notice('此处仅展示隐私状态，修改设置需要宿主提供相应功能。')
    const help = node('button', '', '了解更多'); help.type = 'button'; help.disabled = true; help.title = '尚未配置帮助服务'; body.appendChild(help)
  }
  function renderSettings() {
    notice('当前文档尚未配置页面显示设置服务，无法读取或保存显示偏好。')
    for (const label of ['展示文档信息', '作者', '最近修改时间', '创建时间', '访问人数', '访问次数', '点赞总数', '评论总数']) readOnlySwitch(label, null, '状态未提供')
  }
  function renderRecords(value) {
    if (!Array.isArray(value?.items)) { notice('记录数据暂时不可用，请重试。', true); return }
    if (view === 'operations' && category !== 'all' && (value.category !== category || !value.supportedCategories?.includes(category))) {
      notice('当前服务未提供此类别的操作记录。'); return
    }
    if (!value.items.length) notice(view === 'operations' ? '暂无操作记录' : '暂无访问记录')
    const list = node('div', 'lark-doc-document-information-records'); list.setAttribute('role', 'list')
    for (const item of value.items) {
      const record = node('div', 'lark-doc-document-information-row'); record.setAttribute('role', 'listitem')
      const person = view === 'visits' ? item.principalName || item.principalId : item.actorName || item.actorId
      const details = node('div')
      details.append(node('strong', '', unknown(person)))
      if (view === 'operations') details.appendChild(node('span', '', ACTIONS[item.kind] || unknown(item.kind)))
      else if (item.department) details.appendChild(node('span', '', String(item.department)))
      details.appendChild(node('small', '', date(view === 'visits' ? item.lastVisitedAt : item.occurredAt)))
      record.appendChild(details); list.appendChild(record)
    }
    body.appendChild(list)
    notice(value.coverageSince ? `记录范围：${date(value.coverageSince)}起${value.truncated ? '；当前列表已截断' : ''}` : `记录覆盖范围未提供${value.truncated ? '；当前列表已截断' : ''}`)
    if (view === 'visits') {
      row('文档访问人数', information?.interaction?.visitors)
      notice('关闭访问记录的人数未提供。')
    }
  }
  async function show(next, nextCategory = 'all') {
    if (!TITLES[next] || !CATEGORIES.some(([id]) => id === nextCategory) || !guard()) return
    view = next; category = nextCategory
    const ticket = ++request
    root.setAttribute('aria-label', TITLES[view]); title.textContent = TITLES[view]
    root.dataset.informationView = view; back.hidden = view === 'information' || view === 'page-settings'
    tabs.hidden = view !== 'operations'
    categoryButtons.forEach(item => item.setAttribute('aria-selected', String(item.dataset.informationCategory === category)))
    body.replaceChildren(); body.scrollTop = 0; body.removeAttribute('aria-busy')
    if (view === 'page-settings') { renderSettings(); return }
    if (view === 'information') renderInformation(null)
    if (typeof read !== 'function') {
      if (view === 'privacy') renderPrivacy(null)
      notice('当前文档尚未配置文档信息服务。'); return
    }
    body.setAttribute('aria-busy', 'true')
    notice('正在加载…')
    try {
      const result = await read(view === 'operations' ? { kind: 'operations', category } : view)
      if (!guard() || request !== ticket) return
      body.replaceChildren(); body.scrollTop = 0
      if (view === 'information') { information = result; renderInformation(result) }
      else if (view === 'privacy') renderPrivacy(result)
      else renderRecords(result)
    } catch (cause) {
      if (!guard() || request !== ticket) return
      body.replaceChildren()
      const denied = [401, 403, 404].includes(cause?.status) || /AUTHORIZATION|FORBIDDEN/.test(cause?.code || '')
      if (view === 'information' && !denied) renderInformation(null)
      notice(denied ? '当前权限无法读取此信息。' : '信息加载失败，请重试。', true)
      body.appendChild(button('重试', () => show(view, category)))
    } finally { if (!destroyed && request === ticket) body.removeAttribute('aria-busy') }
  }
  function destroy() {
    if (destroyed) return
    destroyed = true; request++
    root.remove(); body.replaceChildren(); information = null
    scrollLocks.reverse().forEach(unlock => unlock())
    if (current() && previousFocus?.isConnected) previousFocus.focus?.({ preventScroll: true })
    onClose?.()
  }
  void show(TITLES[initialView] ? initialView : 'information')
  root.focus({ preventScroll: true })
  return { el: root, destroy }
}
