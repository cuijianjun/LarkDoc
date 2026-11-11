import { readMention } from '../../../core/blocks/mention'
// Shared presentation of the observed document menu. Business-owned actions are UI intents,
// never local substitutes for a Java grant, move, deletion or persisted preference.
const definitions = [
  ['width', '页宽设置', 'fullscreen', 'submenu'], ['presentation', '演示模式', 'slides', 'submenu'],
  ['follow', '关注文档更新', 'outline', 'host'], ['search', '查找和替换', 'search'],
  ['shortcut', '添加快捷方式到', 'link', 'host'], ['move', '移动到', 'move-down', 'host'],
  ['pin', '添加到“置顶”', 'outline', 'host'], ['favorite', '添加到收藏', 'sparkle', 'host'],
  ['template', '转换为模板', 'copy', 'host'], ['duplicate', '创建副本', 'copy', 'host'],
  ['download', '下载为', 'rev-next', 'submenu'], ['translate', '翻译为英语', 'translate', 'host'],
  ['print', '打印', 'block-text'], ['save-version', '另存为版本', 'copy'],
  ['saved-versions', '查看已存版本', 'undo', 'submenu'], ['permissions', '文档权限', 'outline', 'submenu'],
  ['widgets', '文档小组件', 'plus', 'host'], ['information', '文档信息', 'help-center'],
  ['mentions', '提及的人', 'mode-comment'], ['history', '历史记录', 'undo'],
  ['history-comments', '历史评论', 'mode-comment'], ['more', '更多', 'plus', 'submenu'],
  ['theme', '主题', 'sparkle', 'submenu'], ['delete', '删除', 'trash', 'host'],
]
const separators = new Set(['follow', 'shortcut', 'template', 'print', 'save-version', 'permissions', 'widgets', 'information', 'delete'])
const can = (ed, capability) => !ed.session || typeof ed.session.can !== 'function' || ed.session.can(capability)
const host = ed => typeof ed.onDocumentAction === 'function'

export function documentMenuItems(ed, business = ed.session?.getProvider?.('documentBusiness')?.getState()) {
  const port = ed.session?.getProvider?.('documentBusiness')
  return definitions.map(([id, label, icon, kind = 'item']) => {
    let allowed = can(ed, 'canView')
    if (kind === 'host') allowed = allowed && host(ed)
    if (['download', 'print'].includes(id)) allowed = allowed && ed.exportCanExport === true
    if (id === 'save-version') allowed = allowed && ed.versionCanCreate === true
    if (['history', 'saved-versions'].includes(id)) allowed = allowed && Boolean(ed.versionProvider)
    if (id === 'search') allowed = allowed && ed.featureEnabled('search')
    if (id === 'history-comments') allowed = allowed && ed.commentRemote === true
    if (['width', 'presentation'].includes(id)) allowed = allowed && ed.toolbarEnabled('viewModes')
    let checked
    if (port && ['follow', 'favorite', 'pin', 'shortcut', 'move', 'duplicate', 'delete'].includes(id)) {
      kind = 'business'; const restore = id === 'delete' && business?.status === 'deleted'
      const flag = restore ? 'canRestore' : `can${id[0].toUpperCase()}${id.slice(1)}`
      allowed = !!business?.capabilities?.[flag] && (restore || can(ed, 'canView'))
      if (restore) label = '恢复文档'
      if (id === 'follow') checked = business?.followed === true
      if (id === 'favorite') { checked = business?.favorite === true; if (checked) label = '取消收藏' }
      if (id === 'pin') { checked = business?.pinned === true; if (checked) label = '取消置顶' }
    }
    return { id, label, icon, kind, checked, separator: separators.has(id), disabled: !allowed }
  })
}

export function documentThemeChoice(root) {
  return root?.getAttribute('data-theme-preset') === 'feishu' ? (root.getAttribute('data-theme') === 'dark' ? 'feishu-dark' : 'feishu-light') : 'default'
}

export function documentMenuChildren(ed, id, appearance, business = ed.session?.getProvider?.('documentBusiness')?.getState()) {
  if (id === 'theme') return [['default', '经典绿色'], ['feishu-light', '飞书浅色'], ['feishu-dark', '飞书暗色']].map(([value, label]) => ({ id: 'theme', value, label, checked: value === (appearance || documentThemeChoice(ed.$el)) }))
  if (id === 'width') return [['standard', '默认'], ['wide', '较宽'], ['full', '全宽']].map(([value, label]) => ({ id: 'width', value, label, checked: ed.widthMode === value }))
  if (id === 'download') return [['word', 'Word'], ['pdf', 'PDF'], ['markdown', 'Markdown']].map(([value, label]) => ({ id: 'download', value, label }))
  if (id === 'presentation') return [{ id: 'presentation', value: 'document', label: '文档模式' }, { id: 'presentation', value: 'slides', label: '幻灯片模式' }, ...(ed.lastSlideIndex > 0 ? [{ id: 'presentation', value: 'resume', label: '回到上次演示位置' }] : [])]
  if (id === 'saved-versions') return (ed.versionList || []).filter(version => version.purpose === 'manual' || version.kind === 'manual').map(version => ({ id: 'saved-versions', value: version.id, label: version.label }))
  if (id === 'permissions') {
    const port = ed.session?.getProvider?.('documentBusiness'), available = port ? business?.capabilities.canTransferOwnership === true && typeof port.ownershipCandidates === 'function' : host(ed) && ed.shareCan('canManagePermission')
    return [{ id: 'manage-members', label: '管理协作者', disabled: !ed.shareCan('canManagePermission') }, { id: 'permission-settings', label: '权限设置', disabled: !ed.shareCan('canManagePermission') }, { id: 'transfer-ownership', label: '转移所有权', kind: port ? 'business' : 'host', disabled: !available }]
  }
  if (id === 'more') return [['applications', '添加文档应用'], ['references', '显示引用列表'], ['authors', '在段落前显示作者'], ['offline', '设为离线可使用'], ['report', '举报']].map(([id, label]) => ({ id, label, disabled: !host(ed) }))
  return []
}

export async function runDocumentMenuAction(ed, id, value, event, current = () => true) {
  const item = documentMenuItems(ed).find(item => item.id === id) || documentMenuChildren(ed, 'permissions').concat(documentMenuChildren(ed, 'more')).find(item => item.id === id) || (id === 'information-host' && host(ed) && ['访问记录', '操作记录', '隐私设置'].includes(value) ? { id } : null)
  if (!item || item.disabled || (!can(ed, 'canView') && !(id === 'delete' && item.kind === 'business'))) return false
  if (item.kind === 'submenu' && value === undefined) return false
  ed.closeHeaderMenu()
  if (item.kind === 'business') return 'business:' + (id === 'delete' && ed.session.getProvider('documentBusiness').getState()?.status === 'deleted' ? 'restore' : id)
  if (id === 'theme') {
    if (!['default', 'feishu-light', 'feishu-dark'].includes(value)) return false
    const controller = ed.$el?._larkDocTheme
    if (!controller) return false
    controller.setTheme(value === 'feishu-dark' ? 'dark' : 'light', 'auto', value === 'default' ? 'default' : 'feishu')
  }
  else if (id === 'width') { if (!['standard', 'wide', 'full'].includes(value)) return false; ed.setWidthMode(value) }
  else if (id === 'presentation') { if (!['document', 'slides', 'resume'].includes(value)) return false; ed.startPresentation(value) }
  else if (id === 'search') ed.openSearch('replace')
  else if (id === 'download') { if (!['word', 'pdf', 'markdown'].includes(value)) return false; ed.openExportDialog(value) }
  else if (id === 'print') return printEditorDocument(ed)
  else if (id === 'save-version') ed.openSaveVersionDialog()
  else if (id === 'history') await ed.openVersionPanel()
  else if (id === 'saved-versions') { await ed.openVersionPanel(); if (!current() || !ed.versionPanelOpen || !ed.versionList.some(version => version.id === value)) return false; await ed.selectVersion(value) }
  else if (id === 'manage-members') ed.openShareFromToolbar(event)
  else if (id === 'permission-settings') ed.openPermissionDialog()
  else if (id === 'history-comments') ed.openHistoricalComments()
  else if (id === 'information' || id === 'mentions') return id
  else if (host(ed)) await ed.onDocumentAction(Object.freeze({ action: id, ...(id === 'information-host' ? { tab: value } : {}), documentId: ed.session?.documentId ?? null, actorId: ed.session?.user?.id ?? null }))
  else return false
  return true
}

export function documentStatistics(ed) {
  if (!can(ed, 'canView') || !ed.editor || ed.editor.isDestroyed) return null
  const text = ed.editor.getText(), json = ed.editor.getJSON()
  return { words: ed.wordCount, characters: Array.from(text.replace(/\n/g, '')).length, bytes: new TextEncoder().encode(JSON.stringify(json)).length, headings: ed.outline?.length || 0 }
}

export function printEditorDocument(ed) {
  const editor = ed.editor, session = ed.session, principal = session?.user?.id, generation = session?._privateIdentityGeneration
  if (!ed.featureEnabled('importExport') || !ed.exportCanExport || !can(ed, 'canView') || !editor || editor.isDestroyed) return false
  const current = () => !ed._isDestroyed && editor === ed.editor && !editor.isDestroyed && session === ed.session && principal === session?.user?.id && generation === session?._privateIdentityGeneration
  const folded = Array.from(editor.storage.larkDoc?.folded || [])
  folded.forEach(id => editor.commands.toggleLarkDocFoldById(id))
  ed.$nextTick(() => {
    try { if (current() && can(ed, 'canView') && can(ed, 'canExport')) window.print() }
    finally { if (current()) folded.forEach(id => editor.commands.toggleLarkDocFoldById(id)) }
  })
  return true
}

export const documentMenuRequestMethods = {
    invalidateRequest() { this._requestToken = null; this.busy = false; this.information = false; this.error = ''; this.submenu = '' },
    async run(item, event) {
      const session = this.ed.session, documentId = session?.documentId, identity = session?.user?.id, generation = session?._privateIdentityGeneration, auth = session?._authorizationGeneration, handler = this.ed.onDocumentAction
      const token = {}; this._requestToken = token
      const current = () => !this._isDestroyed && this._requestToken === token && session === this.ed.session && documentId === session?.documentId && handler === this.ed.onDocumentAction && identity === session?.user?.id && generation === session?._privateIdentityGeneration && auth === session?._authorizationGeneration && (this.canView || (item.id === 'delete' && this.businessState?.capabilities.canRestore))
      this.busy = true; this.error = ''
      try {
        const result = await runDocumentMenuAction(this.ed, item.id, item.value, event, current)
        if (current() && typeof result === 'string' && result.startsWith('business:')) this.businessAction = result.slice(9)
        if (current() && ['information', 'mentions'].includes(result)) { this.information = result; this.$nextTick(() => this.$refs.information?.focus()) }
      } catch { if (current()) this.error = '操作暂未完成，请在文档业务系统中核对。' }
      finally { if (!this._isDestroyed && this._requestToken === token) this.busy = false }
    },
}

// The lazy stage owns its local bookmark/scroll lifecycle; it never writes shared content.
export function restorePresentationView(ed, bookmark) {
  const previous = ed._presentationPrevious, session = ed.session, editor = ed.editor, generation = session?._privateIdentityGeneration
  ed._presentationPrevious = null
  const current = () => !ed._isDestroyed && !ed._isBeingDestroyed && session === ed.session && session === previous?.session && editor === ed.editor && generation === previous?.generation && generation === session?._privateIdentityGeneration && previous?.principal === session?.user?.id && can(ed, 'canView')
  if (!previous || ed.slides || !current()) return
  ed.commentSidebarOpen = previous.sidebar
  if (bookmark && editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr.setSelection(bookmark.resolve(editor.state.doc)).setMeta('addToHistory', false))
  ed.$nextTick(() => { if (current() && !ed.slides) { const main = ed.$refs?.mainScroll; if (main) { main.scrollTop = previous.mainTop || 0; main.scrollLeft = previous.mainLeft || 0 } window.scrollTo(previous.x, previous.y) } })
}

export function setPresentationMode(ed, mode) {
  if (['document', 'slides'].includes(mode)) { ed.presentationMode = mode; if (mode === 'slides') ed.commentSidebarOpen = false }
}

export function documentMentions(ed) {
  if (!can(ed, 'canView') || !ed.editor || ed.editor.isDestroyed) return []
  const people = new Map()
  ed.editor.state.doc.descendants(node => {
    const mention = readMention(node)
    if (!mention || mention.kind !== 'user' || !mention.id || people.has(mention.id)) return
    people.set(mention.id, { id: mention.id, name: mention.name || '未知', department: mention.department })
  })
  return [...people.values()]
}
