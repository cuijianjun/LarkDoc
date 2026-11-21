/** Demo-only host for the existing documentBusiness port; dialogs never write by themselves. */
import { openHostFormDialog } from './host-dialog.js'

export function createDemoDocumentBusinessHost({ provider, getContext, isCurrent, getState, onChange, onStatus, onCommitted, ownerDocument = document }) {
  const actions = ['follow', 'favorite', 'pin', 'shortcut', 'move', 'duplicate', 'template', 'delete', 'transfer-ownership']
  const personal = ['follow', 'favorite', 'pin', 'shortcut']
  const labels = { follow: '关注', favorite: '收藏', pin: '置顶', shortcut: '添加快捷方式', move: '移动文档', duplicate: '创建副本', template: '转换为模板', delete: '删除文档', restore: '恢复文档', 'transfer-ownership': '转移所有权' }
  let scope = null, key = null, unsubscribe = null, cancelChooser = null, busy = false, ready = false, disposed = false
  const contextKey = value => value && JSON.stringify([value.principalId, value.generation, value.identity, value.authorization])
  const current = value => !disposed && value === scope && isCurrent(value)
  const pending = () => current(scope) ? provider.getPending() : []
  const snapshot = () => ready && current(scope) ? provider.getState() : null
  const changed = () => onChange?.()
  const notify = (value, message) => { if (current(value)) onStatus?.(message) }
  const closeChooser = () => { cancelChooser?.(); cancelChooser = null }
  const kindFor = action => action === 'delete' && snapshot()?.status === 'deleted' ? 'restore' : action
  function allowed(action) {
    const state = snapshot(), kind = kindFor(action)
    const capability = kind === 'transfer-ownership' ? 'canTransferOwnership' : kind === 'template' ? 'canConvertTemplate' : `can${kind[0]?.toUpperCase()}${kind.slice(1)}`
    return actions.includes(action) && state?.capabilities?.[capability] === true &&
      (kind === 'restore' ? state.status === 'deleted' : state.status === 'active')
  }
  function sameSource(value, state) {
    const next = snapshot()
    return current(value) && next && ['principalId', 'revision', 'preferenceRevision', 'epoch', 'contentRevision', 'authzVersion'].every(field => next[field] === state[field])
  }
  const operationId = () => 'business-' + [...crypto.getRandomValues(new Uint8Array(16))].map(v => v.toString(16).padStart(2, '0')).join('')
  async function choose(kind, state, value) {
    let folders, candidates
    if (['shortcut', 'move', 'duplicate'].includes(kind)) {
      folders = (await provider.folders()).filter(item => item.canWrite === true)
      if (!folders.length) { notify(value, '没有当前可写的目标目录；未执行操作。'); return null }
    }
    if (kind === 'transfer-ownership') {
      candidates = await provider.ownershipCandidates()
      if (candidates.revision !== state.revision || candidates.authzVersion !== state.authzVersion || candidates.eligibilityRevision !== state.ownershipEligibilityRevision || !candidates.items.length) {
        notify(value, '所有权候选或资格已变化；未执行操作。'); return null
      }
    }
    if (!sameSource(value, state)) return null
    // 弹窗按飞书 UD Modal 版式：标题 16/24、说明行、字段纵向、底部右对齐「取消 / 确认」。
    // 控件全部走 `host-dialog.js`（原生 `<select>` 保留为真身，视觉是自绘层）。
    const previous = ownerDocument.activeElement
    const confirmation = ['delete', 'transfer-ownership'].includes(kind) ? (kind === 'delete' ? '删除' : '转移') : null
    const dialogFields = []
    if (folders) dialogFields.push({ type: 'select', name: 'folderId', label: '目标目录', required: true,
      options: [{ value: '', label: '请选择' }, ...folders.map(item => ({ value: item.id, label: item.name }))] })
    if (kind === 'duplicate') dialogFields.push({ type: 'input', name: 'name', label: '副本名称', required: true, maxLength: 100,
      value: `${state.title || '文档'} 副本`.slice(0, 100) })
    if (candidates) {
      dialogFields.push({ type: 'select', name: 'targetPrincipalId', label: '新所有者', required: true,
        options: [{ value: '', label: '请选择' }, ...candidates.items.map(item => ({ value: item.principalId, label: item.displayName }))] })
      dialogFields.push({ type: 'checkbox', name: 'removeOldOwner', label: '移除原所有者权限', value: false })
      dialogFields.push({ type: 'select', name: 'oldOwnerPerm', label: '保留原所有者权限', value: 'full_access',
        options: [{ value: 'full_access', label: '完整管理' }, { value: 'edit', label: '编辑' }, { value: 'view', label: '查看' }] })
    }
    if (confirmation) dialogFields.push({ type: 'input', name: 'confirmation', label: `输入“${confirmation}”确认`, required: true, autocomplete: 'off' })

    const chooser = openHostFormDialog({
      doc: ownerDocument,
      title: labels[kind],
      description: state.title || value.documentId,
      fields: dialogFields,
      confirmText: '确定',
      cancelText: '取消',
      danger: kind === 'delete' || kind === 'transfer-ownership',
      // 焦点恢复放在下面：只有身份/上下文仍然有效时才还给触发者。
      returnFocus: false,
      validate: (input) => {
        if (confirmation && input.confirmation !== confirmation) return { field: 'confirmation', message: `请输入“${confirmation}”以确认` }
        if (folders && !folders.some(item => item.id === input.folderId)) return { field: 'folderId', message: '请选择可写的目标目录' }
        if (candidates && !candidates.items.some(item => item.principalId === input.targetPrincipalId)) return { field: 'targetPrincipalId', message: '请选择新所有者' }
        return null
      },
    })
    cancelChooser = () => chooser.close(null)
    const input = await chooser.result
    cancelChooser = null
    if (input && current(value) && previous?.isConnected) previous.focus?.()
    if (!input || !sameSource(value, state)) return null
    return {
      ...(folders ? { folderId: input.folderId } : {}),
      ...(kind === 'duplicate' ? { name: input.name.trim() } : {}),
      ...(candidates ? { targetPrincipalId: input.targetPrincipalId, expectedAuthzVersion: candidates.authzVersion,
        expectedEligibilityRevision: candidates.eligibilityRevision, removeOldOwner: input.removeOldOwner,
        oldOwnerPerm: input.oldOwnerPerm, stayPut: true } : {}),
    }
  }
  async function publishOutcome(value, result) {
    if (!current(value)) return false
    if (result.status !== 'committed') { notify(value, '业务结果待确认；请查询原操作，不能重新提交。'); changed(); return false }
    notify(value, `${labels[result.kind] || '业务操作'}已提交。`)
    try { await provider.load() } catch { notify(value, '业务操作已提交，但当前读回尚未完成；请核对原操作。') }
    if (!current(value)) return false
    onCommitted?.(result)
    changed(); return true
  }
  return {
    get supportedActions() { return busy || pending().length ? [] : actions.filter(allowed) },
    get pending() { return pending() },
    get canRestore() { return allowed('delete') && kindFor('delete') === 'restore' && !busy && !pending().length },
    sync() {
      const next = getContext(), nextKey = contextKey(next)
      if (disposed || nextKey === key && (!next || current(scope))) return
      unsubscribe?.(); unsubscribe = null; closeChooser(); scope = next; key = nextKey; ready = false
      changed()
      if (!next) { provider.reset('authorization-required'); changed(); return }
      unsubscribe = provider.subscribe(() => { if (current(next)) { closeChooser(); changed() } })
      void provider.load().then(() => { if (current(next)) { ready = true; changed() } }).catch(() => { notify(next, '文档业务信息未接通或当前无权读取。'); changed() })
    },
    async run(event) {
      const value = scope, action = event.action
      let state = snapshot()
      if (!current(value) || busy || pending().length || !allowed(action) || event.actorId != null && event.actorId !== value.principalId || event.documentId != null && event.documentId !== value.documentId) return false
      const kind = kindFor(action)
      busy = true; changed()
      try {
        let source
        if (kind === 'duplicate') {
          await provider.load()
          state = snapshot(); source = getState()
          if (!current(value) || !allowed(action) || !source || source.status !== 'ready' || source.pending?.length || source.epoch !== state.epoch || source.revision !== state.contentRevision) {
            notify(value, '正文水位未确认，不能创建副本。'); return false
          }
        }
        const input = kind === 'template' ? { value: !state.isTemplate } : personal.includes(kind) && kind !== 'shortcut'
          ? { value: !state[kind === 'follow' ? 'followed' : kind === 'favorite' ? 'favorite' : 'pinned'] } : await choose(kind, state, value)
        if (input === null || !sameSource(value, state) || !allowed(action)) return false
        const submitted = provider.execute({ kind, operationId: operationId(), expectedRevision: personal.includes(kind) ? state.preferenceRevision : state.revision, ...input,
          ...(kind === 'duplicate' ? { sourceEpoch: source.epoch, sourceRevision: source.revision } : {}) })
        changed()
        return await publishOutcome(value, await submitted)
      } catch { notify(value, '业务操作未确认完成；请核对权限或查询保留的原操作。'); return false }
      finally { busy = false; changed() }
    },
    async query() {
      const value = scope, original = pending()[0]
      if (!current(value) || busy || !original) return false
      busy = true; changed()
      try { return await publishOutcome(value, await provider.query(original.operationId)) }
      catch { notify(value, '原业务操作仍未确认或当前无权查询；原键保留。'); return false }
      finally { busy = false; changed() }
    },
    destroy() { if (disposed) return; disposed = true; unsubscribe?.(); closeChooser(); scope = null; key = null; provider.reset('disposed'); changed() },
  }
}
