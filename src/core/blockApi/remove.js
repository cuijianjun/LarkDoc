/** Shared synchronous mutation context and the one block-removal implementation.
 * The complete BlockAPI reuses this context, including its pending batch transaction.
 */
import { closeHistory } from '@tiptap/pm/history'
import { TRANSACTION_ORIGINS } from '../transactionMetadata'
import { BLOCK_API_ERRORS, blockApiError } from './errors'
import { BLOCK_LIST_TYPES, blockEntry } from './tree'
import { expandDeletion, inTableContext } from './nodes'

export function createBlockMutationContext(options = {}) {
  const editor = options.editor || null
  const session = options.session || null
  const origin = options.origin || TRANSACTION_ORIGINS.HOST
  /** `batch` 期间共享的事务；非 null 时所有写操作都落在它上面、且不 dispatch。 */
  let pending = null

  const baseState = () => {
    const target = editor || (session && session.getEditor())
    const state = target && target.state
    if (!state) throw new Error('createBlockApi：需要 editor，或已 attachEditor 的 session')
    return state
  }
  const currentDoc = () => (pending ? pending.tr.doc : baseState().doc)
  const newTr = () => (pending ? pending.tr : baseState().tr)

  const capabilityFor = (action) => ({
    insert: 'canEdit', update: 'canEdit', remove: 'canEdit', move: 'canEdit',
    duplicate: 'canEdit', transform: 'canEdit', batch: 'canEdit',
  }[action] || 'canEdit')
  const assertCapability = (action) => {
    if (!session || typeof session.can !== 'function') return
    const capability = capabilityFor(action)
    if (session.can(capability)) return
    throw blockApiError(BLOCK_API_ERRORS.PERMISSION_DENIED, `当前用户没有${capability}权限`, { action, capability })
  }

  const send = (tr) => {
    if (session) { session.dispatch(tr, { origin }); return }
    editor.view.dispatch(tr)
  }
  const commit = (tr) => {
    if (pending) return { ok: true, committed: false }
    if (!tr || !tr.steps.length) return { ok: false, committed: false }
    closeHistory(tr)
    send(tr)
    return { ok: true, committed: true }
  }

  return {
    baseState, currentDoc, newTr, assertCapability, commit,
    get pending() { return pending },
    set pending(value) { pending = value },
  }
}

/** `keepChildren` 能上提的子块：容器只认 callout/blockquote，列表项只认嵌套子列表。 */
function hoistedChildren(entry) {
  const type = entry.node.type.name
  const node = entry.node
  if (type === 'callout' || type === 'blockquote') {
    const out = []
    for (let i = 0; i < node.childCount; i += 1) out.push(node.child(i))
    return out.length ? out : null
  }
  if (type === 'listItem' || type === 'taskItem') {
    const items = []
    for (let i = 0; i < node.childCount; i += 1) {
      const child = node.child(i)
      if (!BLOCK_LIST_TYPES.has(child.type.name)) continue
      for (let j = 0; j < child.childCount; j += 1) items.push(child.child(j))
    }
    return items.length ? items : null
  }
  return null
}

export function createBlockRemoval(context) {
  const { assertCapability, currentDoc, newTr, baseState, commit } = context
  return function remove(blockId, opts) {
    assertCapability('remove')
    const doc = currentDoc()
    const entry = blockEntry(doc, blockId)
    if (!entry || inTableContext(doc, entry)) return
    const tr = newTr()
    if (opts && opts.keepChildren) {
      const lifted = hoistedChildren(entry)
      if (lifted) {
        tr.replaceWith(entry.pos, entry.end, lifted)
        commit(tr)
        return
      }
    }
    const range = expandDeletion(doc, entry)
    // 删光整篇会造出空 doc（本仓库 doc 的 content 是 1*），留一个空段落兜底。
    if (range.from === 0 && range.to === doc.content.size) {
      const empty = baseState().schema.nodes.paragraph.create()
      tr.replaceWith(range.from, range.to, empty)
    } else {
      tr.delete(range.from, range.to)
    }
    commit(tr)
  }
}

/** Private keyboard entry; it shares the full API's deletion and authority checks. */
export function createBlockRemovalApi(options = {}) {
  return { remove: createBlockRemoval(createBlockMutationContext(options)) }
}
