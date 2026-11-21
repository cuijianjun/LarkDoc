import { aiNetworkAllows, createNetworkPolicy } from '../../../core/policy/network'
import { normalizeAIProvider } from '../ai'
import { isExportEnabled, isImportEnabled, resolveExportOptions } from '../larkDocConfig'
// Shared presentation of the observed document menu. Business-owned actions are UI intents,
// never local substitutes for a Java grant, move, deletion or persisted preference.
const definitions = [
  ['width', '页宽设置', 'link-view-preview', 'submenu'], ['presentation', '演示模式', 'slides', 'submenu'],
  ['follow', '关注文档更新', 'subscribe', 'host'], ['search', '查找和替换', 'search'],
  ['shortcut', '添加快捷方式到', 'link', 'host'], ['move', '移动到', 'move-down', 'host'],
  ['pin', '添加到“置顶”', 'outline', 'host'], ['favorite', '添加到收藏', 'sparkle', 'host'],
  ['template', '转换为模板', 'copy', 'host'], ['duplicate', '创建副本', 'copy', 'host'],
  ['download', '下载为', 'rev-next', 'submenu'], ['translate', '翻译为英语', 'translate', 'host'],
  ['print', '打印', 'block-text'], ['save-version', '另存为版本', 'doc'],
  ['saved-versions', '查看已存版本', 'undo', 'submenu'], ['permissions', '文档权限', 'outline', 'submenu'],
  ['widgets', '文档小组件', 'plus', 'submenu'], ['information', '文档信息', 'info'],
  ['mentions', '提及的人', 'mode-comment'], ['history', '历史记录', 'undo'],
  ['history-comments', '历史评论', 'mode-comment'], ['more', '更多', 'more', 'submenu'],
  ['theme', '主题', 'sparkle', 'submenu'], ['delete', '删除', 'trash', 'host'],
]
const separators = new Set(['follow', 'shortcut', 'template', 'print', 'save-version', 'permissions', 'widgets', 'information', 'more'])
const can = (ed, capability) => !ed.session || typeof ed.session.can !== 'function' || ed.session.can(capability)
export const supportsDocumentAction = (ed, action) => typeof ed.onDocumentAction === 'function' &&
  (!Array.isArray(ed.onDocumentAction.supportedActions) || ed.onDocumentAction.supportedActions.includes(action))
const host = supportsDocumentAction
const compactDesktop = ed => ed.compactHeader && ed.$el?.ownerDocument.defaultView?.innerWidth > 760
const translationLanguages = [['en', '英语'], ['zh', '简体中文'], ['zh-Hant', '繁体中文'], ['ja', '日语'], ['ko', '韩语'], ['fr', '法语'], ['de', '德语'], ['es', '西班牙语']]

/** 浏览器窄屏文档菜单；首组来自同一顶栏能力，正文选区分享不在这里路由。 */
export function referenceDocumentMenuItems(ed) {
  const readable = can(ed, 'canView')
  const adapter = normalizeAIProvider(ed.aiProvider)
  const aiAllowed = adapter && (adapter.kind !== 'endpoint' || aiNetworkAllows(adapter.endpoint || adapter.baseURL,
    createNetworkPolicy(ed.larkDocConfig?.network), ed.$el?.ownerDocument.defaultView?.location?.href))
  const modeLabel = ['编辑', '修订', '阅读'].includes(ed.modeLabel) ? `${ed.modeLabel}模式` : ed.modeLabel || '编辑模式'
  const desktop = compactDesktop(ed)
  const writable = readable && ed.writable()
  const create = { id: 'create', label: '新建', icon: 'plus', kind: 'submenu', disabled: !writable || (!host(ed, 'create') && !ed.compactHeader) }
  const items = [
    ...(!desktop ? [
    { id: 'mode', label: modeLabel, icon: 'mode-edit', kind: 'submenu', disabled: !readable || !ed.modeOptions?.length },
    { id: 'ai', label: '问问AI', icon: 'block-quote', disabled: !readable || !ed.featureEnabled('ai') || !aiAllowed || !ed.writable() },
    { id: 'notifications', label: '通知', icon: 'bell', disabled: !readable || ed.notifyCurrent?.(ed.notificationContext?.()) !== true },
    { id: 'workspace-search', label: '搜索', icon: 'search', separator: true, kind: 'host', disabled: !readable || !host(ed, 'search') },
    create,
    ] : []),
    ...documentMenuItems(ed).flatMap(item => [
      ...(desktop && item.id === 'download' ? [
        ...(host(ed, 'create') ? [create] : []),
        ...(ed.isBlockActionEnabled?.('file') === true ? [{ id: 'upload-file', label: '上传文件', icon: 'upload', disabled: !writable }] : []),
        { id: 'import', label: ed.larkDocConfig.importExport.importLabel, icon: 'insert-file', disabled: !writable || ed.importing || !isImportEnabled(ed.larkDocConfig) },
      ] : []),
      { ...item, separator: item.id === 'width' || item.separator },
      ...(item.id === 'information' ? [{ id: 'page-settings', label: '页面设置', icon: 'block-text', disabled: !readable }] : []),
    ]),
    ...(ed.compactHeader ? [{ id: 'length-limit', label: '字数上限', icon: 'block-text', kind: 'submenu', disabled: !writable }] : []),
  ]
  return items.map(item => {
    if (item.id === 'presentation') item = { ...item, kind: 'item' }
    if (item.id === 'mentions') item = { ...item, kind: 'host', disabled: item.disabled || !host(ed, item.id) }
    if (['information', 'page-settings'].includes(item.id) && host(ed, item.id)) item = { ...item, kind: 'host' }
    // 业务 Provider 的 chooser/确认界面尚未挂载时，不把 business intent 当完成执行。
    if (item.kind === 'business') {
      if (host(ed, item.id)) item = { ...item, kind: 'host' }
      else item = { ...item, disabled: true }
    }
    return { ...item, kind: ['follow', 'template'].includes(item.id) ? 'switch' : item.id === 'translate' ? 'submenu' : item.kind || 'item',
      action: 'document:' + item.id, enabled: !item.disabled,
      affordance: item.kind === 'submenu' || item.id === 'translate' ? 'arrow' : 'none',
      title: item.disabled ? '当前文档未配置此功能或当前身份无权限。' : item.id === 'follow' ? '' : item.label }
  })
}

export function referenceDocumentMenuChildren(ed, id) {
  if (id === 'mode') return (ed.modeOptions || []).map(item => ({ id: item.id, value: item.id, label: item.label, action: 'document:mode', checked: ed.mode === item.id }))
  if (id === 'create') return (ed.createMenuRows || []).filter(item => item.kind === 'item' && (item.id !== 'import' || !compactDesktop(ed))).map(item => ({
    ...item, value: item.id, action: 'document:create',
    ...(ed.compactHeader && item.id === 'import' ? { children: undefined, arrow: false } : {}),
    enabled: ed.compactHeader && item.id === 'import' ? isImportEnabled(ed.larkDocConfig) && !ed.importing : !ed.compactHeader || host(ed, 'create'),
  }))
  if (id === 'length-limit' && ed.compactHeader) return (ed.maxLengthOptions || []).map(item => ({
    id, ...item, checked: item.value === ed.larkDocConfig.limits.maxLength, action: 'document:length-limit',
  }))
  return documentMenuChildren(ed, id).map(item => {
    if (item.kind === 'business') item = { ...item, kind: 'host', disabled: item.disabled || !host(ed, item.id) }
    return { ...item, action: 'document:' + item.id, enabled: item.disabled !== true, affordance: 'none' }
  })
}

export async function runReferenceDocumentMenuAction(ed, id, value, event, current = () => true) {
  const item = referenceDocumentMenuItems(ed).find(item => item.id === id)
    || referenceDocumentMenuChildren(ed, 'permissions').concat(referenceDocumentMenuChildren(ed, 'more')).find(item => item.id === id)
    || (id === 'version-trash' && ed.compactHeader && ed.versionCanManageTrash ? { id } : null)
  if (!item || item.disabled || item.enabled === false || !current()) return false
  if (id === 'mode') {
    if (!(ed.modeOptions || []).some(item => item.id === value)) return false
    ed.setMode(value)
  } else if (id === 'length-limit' && ed.compactHeader) {
    if (!referenceDocumentMenuChildren(ed, id).some(item => item.value === value)) return false
    ed.larkDocConfig.limits.maxLength = value
  } else if (id === 'import') {
    ed.closeTopbarMore()
    return ed.$emit('workspace-import', ed._topbarMoreTrigger)
  } else if (id === 'upload-file') {
    ed.closeHeaderMenu()
    const input = ed.$refs.fileInput
    if (!input) return false
    input.click()
  } else if (id === 'create' && ed.compactHeader && value === 'import') {
    if (!referenceDocumentMenuChildren(ed, id).some(item => item.value === value && item.enabled)) return false
    return ed.$emit('workspace-import')
  } else if (id === 'notifications') ed.toggleNotify(event)
  else if (id === 'presentation') { if (ed.toggleSlides() === false) return false }
  else if (id === 'ai') ed.$emit('ai-request', 'chat')
  else if (['information', 'page-settings'].includes(id) && item.kind !== 'host') return typeof ed.openDocumentInformation === 'function' && ed.openDocumentInformation(id, current)
  else if (id === 'workspace-search' || id === 'create' || id === 'translate' || item.kind === 'host' || (['follow', 'template'].includes(id) && host(ed, id))) {
    if (id === 'create' && !referenceDocumentMenuChildren(ed, 'create').some(item => item.value === value)) return false
    if (!host(ed, id === 'workspace-search' ? 'search' : id)) return false
    if (id === 'translate' && value !== undefined && !translationLanguages.some(([code]) => code === value)) return false
    const result = await ed.onDocumentAction(Object.freeze({ action: id === 'workspace-search' ? 'search' : id,
      ...(value === undefined ? {} : { type: value }), documentId: ed.session?.documentId ?? null, actorId: ed.session?.user?.id ?? null }))
    if (result === false || !current()) return false
  } else return runDocumentMenuAction(ed, id, value, event, current)
  return current()
}

export function documentMenuItems(ed, business = ed.session?.getProvider?.('documentBusiness')?.getState()) {
  const port = ed.session?.getProvider?.('documentBusiness')
  return definitions.filter(([id]) => (id !== 'history-comments' || !ed._mobileEditorMedia?.matches) && (id !== 'save-version' || ed.compactHeader)).map(([id, label, icon, kind = 'item']) => {
    let allowed = can(ed, 'canView')
    if (kind === 'host') allowed = allowed && host(ed, id)
    if (['download', 'print'].includes(id)) allowed = allowed && ed.exportCanExport === true
    if (ed.compactHeader && id === 'download') allowed = allowed && documentMenuChildren(ed, id).length > 0
    if (ed.compactHeader && id === 'print') allowed = allowed && isExportEnabled(ed.larkDocConfig) && ed.larkDocConfig.importExport.exportFormats.includes('print')
    if (['history', 'saved-versions'].includes(id)) allowed = allowed && Boolean(ed.versionProvider)
    if (id === 'save-version') allowed = allowed && ed.versionCanSave === true
    if (id === 'widgets') allowed = allowed && !!ed.documentWidgetItems?.length
    if (id === 'search') allowed = allowed && ed.featureEnabled('search')
    if (id === 'history-comments') allowed = allowed && ed.commentCanViewHistory?.() === true
    if (['width', 'presentation'].includes(id)) allowed = allowed && ed.toolbarEnabled('viewModes')
    let checked
    if (port && ['follow', 'favorite', 'pin', 'shortcut', 'move', 'duplicate', 'delete', 'template'].includes(id)) {
      kind = 'business'; const restore = id === 'delete' && business?.status === 'deleted'
      const flag = restore ? 'canRestore' : id === 'template' ? 'canConvertTemplate' : `can${id[0].toUpperCase()}${id.slice(1)}`
      allowed = !!business?.capabilities?.[flag] && (restore || can(ed, 'canView'))
      if (restore) label = '恢复文档'
      if (id === 'follow') checked = business?.followed === true
      if (id === 'template') checked = business?.isTemplate === true
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
  if (id === 'widgets') return ed.documentWidgetItems || []
  if (id === 'translate') return translationLanguages.map(([value, label]) => ({ id, value, label }))
  if (id === 'theme') return [['default', '经典绿色'], ['feishu-light', '飞书浅色'], ['feishu-dark', '飞书暗色']].map(([value, label]) => ({ id: 'theme', value, label, checked: value === (appearance || documentThemeChoice(ed.$el)) }))
  if (id === 'width') return [['standard', '默认'], ['wide', '较宽'], ['full', '全宽']].map(([value, label]) => ({ id: 'width', value, label, checked: ed.widthMode === value }))
  if (id === 'download') {
    const formats = [['word', 'Word', 'docx'], ['pdf', 'PDF', 'print'], ['markdown', 'Markdown', 'md']]
    if (!ed.compactHeader) return formats.map(([value, label]) => ({ id, value, label }))
    const config = ed.larkDocConfig
    if (!isExportEnabled(config)) return []
    const native = formats.filter(([, , key]) => config.importExport.exportFormats.includes(key)).map(([value, label]) => ({ id, value, label }))
    return native.concat(resolveExportOptions(config)
      .filter(item => ['html', 'json', 'txt'].includes(item.value)).map(item => ({ id, ...item, title: item.hint })))
  }
  if (id === 'presentation') return [{ id: 'presentation', value: 'document', label: '文档模式' }, { id: 'presentation', value: 'slides', label: '幻灯片模式' }, ...(ed.lastSlideIndex > 0 ? [{ id: 'presentation', value: 'resume', label: '回到上次演示位置' }] : [])]
  // 飞书那栏「已存版本」就是历史列表本身，不是「被手动命名过的版本」。手动另存为下线后
  // 这里再按 `manual` 过滤，自动历史（`auto`）和恢复点（`restore`）都会消失，子菜单永远是空的。
  if (id === 'saved-versions') {
    const versions = (ed.versionList || []).map(version => ({ id, value: version.id, label: version.label }))
    if (ed.compactHeader) versions.push({ id: 'version-trash', label: '版本回收站', disabled: !ed.versionCanManageTrash })
    return versions
  }
  if (id === 'permissions') {
    const port = ed.session?.getProvider?.('documentBusiness'), available = port ? business?.capabilities.canTransferOwnership === true && typeof port.ownershipCandidates === 'function' : host(ed, 'transfer-ownership') && ed.shareCan('canManagePermission')
    return [{ id: 'manage-members', label: '管理协作者', disabled: !ed.shareCan('canManagePermission') }, { id: 'permission-settings', label: '权限设置', disabled: !ed.shareCan('canManagePermission') }, { id: 'transfer-ownership', label: '转移所有权', kind: port ? 'business' : 'host', disabled: !available }]
  }
  if (id === 'more') return [['applications', '添加文档应用'], ['references', '显示引用列表'], ['authors', '在段落前显示作者'], ['offline', '设为离线可使用'], ['report', '举报']].map(([id, label]) => ({ id, label, disabled: !host(ed, id) }))
  return []
}

export async function runDocumentMenuAction(ed, id, value, event, current = () => true) {
  if (id === 'version-trash' && ed.compactHeader && can(ed, 'canView') && ed.versionCanManageTrash && current()) {
    ed.closeHeaderMenu()
    await ed.openVersionPanel({ kind: 'saved' })
    return current() && ed.versionPanelOpen && ed.openVersionTrash()
  }
  const item = documentMenuItems(ed).find(item => item.id === id) || documentMenuChildren(ed, 'permissions').concat(documentMenuChildren(ed, 'more')).find(item => item.id === id) || (id === 'information-host' && host(ed, id) && ['访问记录', '操作记录', '隐私设置'].includes(value) ? { id } : null)
  if (!item || item.disabled || (!can(ed, 'canView') && !(id === 'delete' && item.kind === 'business'))) return false
  if (item.kind === 'submenu' && value === undefined) return false
  if (id === 'save-version') return ed.openSaveVersion(ed._topbarMoreTrigger || event?.currentTarget, current)
  if (id === 'widgets') return ed.runDocumentWidget(value, event, current)
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
  else if (id === 'download') {
    if (!documentMenuChildren(ed, id).some(item => item.value === value)) return false
    if (['word', 'pdf', 'markdown'].includes(value)) ed.openExportDialog(value)
    else return (await ed.$emit('workspace-export', value)) === true
  }
  else if (id === 'print') return ed.compactHeader ? (await ed.$emit('workspace-export', 'print')) === true : printEditorDocument(ed)
  else if (id === 'history') await ed.openVersionPanel()
  else if (id === 'saved-versions') { await ed.openVersionPanel({ kind: 'saved' }); if (!current() || !ed.versionPanelOpen || !ed.versionList.some(version => version.id === value)) return false; await ed.selectVersion(value) }
  else if (id === 'manage-members') ed.toggleSharePopover(event)
  else if (id === 'permission-settings') ed.openPermissionDialog()
  else if (id === 'history-comments') { if (!ed.openCommentHistory(event)) return false }
  else if (id === 'information' || id === 'mentions') return id
  else if (host(ed, id)) { if (await ed.onDocumentAction(Object.freeze({ action: id, ...(id === 'information-host' ? { tab: value } : {}), documentId: ed.session?.documentId ?? null, actorId: ed.session?.user?.id ?? null })) === false) return false }
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
