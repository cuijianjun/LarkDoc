import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { closeHistory, isHistoryTransaction } from '@tiptap/pm/history'
import { nearestInsertPosition } from './image-insert'
import { collectBlockIdFixes, createBlockId } from '../documentOperations'

// Files, local preview URLs and controllers live only in this editor instance.
// Only successful image attributes enter the document/history/export contract.
export function imageUploadTasksExtension(createPlaceholder) {
  return Extension.create({
    name: 'imageUploadTasks',
    addStorage() { return { insertFiles: null, dropTarget: null, cancelAll: () => {}, undoPending: () => false, redoPending: () => false } },
    addProseMirrorPlugins() {
      const editor = this.editor, storage = this.storage, key = new PluginKey('imageUploadTasks')
      const tasks = new Map()
      const normalizeIds = tr => {
        collectBlockIdFixes(tr.doc, { doc: tr.before, mapping: tr.mapping }).forEach(({ pos, id }) => {
          tr.setNodeMarkup(pos, undefined, { ...tr.doc.nodeAt(pos).attrs, blockId: id })
        })
      }
      let sequence = 0, selected = null, destroyed = false, restoringHistory = false, pendingActions = [], redoActions = []
      const stopCapturing = () => {
        // Collaborating hosts own their undo manager; keep the optional runtime
        // out of the ordinary editor bundle while respecting its capture boundary.
        editor.state.plugins.forEach(plugin => plugin.getState(editor.state)?.undoManager?.stopCapturing?.())
      }
      const restoreHistory = command => {
        restoringHistory = true
        try { return editor.commands[command]() } finally { restoringHistory = false }
      }
      const closeCapture = () => {
        stopCapturing()
        editor.view.dispatch(closeHistory(editor.state.tr).setMeta('addToHistory', false))
      }
      const entries = () => key.getState(editor.state) || []
      storage.dropTarget = (pos, point) => {
        if (!Number.isInteger(pos)) return null
        const resolved = editor.state.doc.resolve(Math.max(0, Math.min(pos, editor.state.doc.content.size)))
        const blockPos = resolved.depth ? resolved.before(resolved.depth) : resolved.pos
        const block = resolved.depth ? resolved.parent : editor.state.doc.nodeAt(blockPos)
        const rect = editor.view.nodeDOM(blockPos)?.getBoundingClientRect?.()
        if (!rect) return null
        const below = point.y > rect.top + rect.height / 2
        return { pos: below ? blockPos + (block?.nodeSize || 0) : blockPos, top: rect.top + (below ? rect.height : 0) }
      }
      const remove = id => {
        if (!destroyed && !editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(key, { remove: id }).setMeta('addToHistory', false))
      }
      const discard = (task, reason) => {
        task.controller.abort(reason)
        task.preview.destroy()
        tasks.delete(task.id)
        if (selected === task.id) selected = null
      }
      storage.cancelAll = reason => {
        pendingActions = []
        redoActions = []
        tasks.forEach(task => discard(task, reason))
        if (!destroyed && !editor.isDestroyed && entries().length) editor.view.dispatch(editor.state.tr.setMeta(key, { clear: true }).setMeta('addToHistory', false))
      }
      storage.undoPending = () => {
        const candidate = pendingActions.slice().reverse().find(action => action.doc.eq(editor.state.doc) && action.ids.some(id => tasks.has(id)))
        if (!candidate) return false
        const position = entries().find(entry => candidate.ids.includes(entry.id))?.pos
        const files = candidate.ids.map(id => tasks.get(id)?.file).filter(Boolean)
        candidate.ids.forEach(remove)
        if (candidate.historyChange) restoreHistory('undo')
        redoActions.push({ files, context: candidate.context, anchor: position, historyChange: candidate.historyChange, doc: editor.state.doc })
        return true
      }
      storage.redoPending = () => {
        const candidate = redoActions[redoActions.length - 1]
        if (!candidate || !candidate.context.isAllowed() || !candidate.doc.eq(editor.state.doc)) return false
        redoActions.pop()
        if (candidate.historyChange && !restoreHistory('redo')) return false
        storage.insertFiles(candidate.files, { ...candidate.context, restoredAction: candidate }).catch(candidate.context.onError)
        return true
      }
      storage.insertFiles = async (files, { pos, restoredAction, source, dropPoint, maxSize, resolve, isAllowed, onError }) => {
        if (destroyed || !isAllowed()) return
        if (!restoredAction) redoActions = []
        const batch = []
        const tr = editor.state.tr
        if (restoredAction) {
          pos = restoredAction.anchor
        } else if (source === 'drop' && dropPoint && Number.isInteger(pos)) {
          pos = storage.dropTarget(pos, dropPoint)?.pos ?? pos
        } else if (Number.isInteger(pos) && source === 'drop') {
          pos = nearestInsertPosition(tr.doc, pos) ?? tr.selection.from
        } else {
          // File paste/chooser replaces the selection immediately, like normal paste.
          tr.deleteSelection()
          pos = tr.selection.from
        }
        if (!restoredAction && !(source === 'drop' && dropPoint)) {
          const point = tr.doc.resolve(pos)
          if (point.parent.inlineContent) {
            if (point.parentOffset > 0) {
              tr.split(pos, 1, [{ type: editor.schema.nodes.paragraph, attrs: { blockId: createBlockId() } }])
              pos += 1
              tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 1)))
            } else pos = point.before(point.depth)
          }
        }
        for (const file of Array.from(files || [])) {
          const id = ++sequence, controller = new AbortController()
          const preview = createPlaceholder({ ownerDocument: editor.view.dom.ownerDocument, file, maxSize, onSelect: () => {
            selected = id
            tasks.forEach(task => task.preview.setSelected(task.id === id))
            editor.view.focus()
          } })
          const task = { id, file, controller, preview }
          tasks.set(id, task)
          batch.push(task)
        }
        if (!batch.length) return
        normalizeIds(tr)
        const pendingAction = { ids: batch.map(task => task.id), historyChange: restoredAction?.historyChange || tr.docChanged, doc: tr.doc, context: { source, maxSize, resolve, isAllowed, onError } }
        pendingActions.push(pendingAction)
        stopCapturing()
        editor.view.dispatch(closeHistory(tr).setMeta(key, { add: batch.map(task => ({ id: task.id, pos })) }))
        closeCapture()
        pendingAction.doc = editor.state.doc
        for (const task of batch) {
          if (!tasks.has(task.id)) continue
          if (!isAllowed()) { storage.cancelAll('disabled'); break }
          try {
            const image = await resolve(task.file, { source, signal: task.controller.signal, onProgress: event => task.preview.update(event.percent) })
            const entry = entries().find(entry => entry.id === task.id)
            if (!image || !entry || task.controller.signal.aborted || !isAllowed()) continue
            const attrs = { ...image, blockId: createBlockId(), originalSrc: image.src, originalAttchId: image.attchId, alt: task.file.name }
            // A transaction maps the current selection; never focus or restore a stale caret.
            const transaction = editor.state.tr.replaceRangeWith(entry.pos, entry.pos, editor.schema.nodes.image.create(attrs))
            normalizeIds(transaction)
            const affectedRedo = redoActions.filter(candidate => candidate.doc.eq(editor.state.doc))
            stopCapturing()
            editor.view.dispatch(closeHistory(transaction).setMeta(key, { complete: task.id, pos: entry.pos }))
            closeCapture()
            affectedRedo.forEach(candidate => { if (redoActions.includes(candidate)) candidate.doc = editor.state.doc })
          } catch (error) {
            if (tasks.has(task.id) && !task.controller.signal.aborted && isAllowed()) onError(error)
          } finally {
            remove(task.id)
            if (tasks.has(task.id)) discard(task, 'settled')
          }
        }
      }
      return [new Plugin({
        key,
        state: {
          init: () => [],
          apply(tr, previous) {
            const action = tr.getMeta(key) || {}
            const history = restoringHistory || isHistoryTransaction(tr) || editor.state.plugins.some(plugin => {
              const manager = plugin.getState(editor.state)?.undoManager
              return manager?.undoing || manager?.redoing
            })
            if (tr.docChanged && action.complete != null) {
              redoActions.forEach(candidate => {
                if (candidate.doc.eq(tr.before)) { candidate.anchor = tr.mapping.map(candidate.anchor, 1); candidate.doc = tr.doc }
              })
            } else if (tr.docChanged && !action.add && !history && tr.getMeta('addToHistory') !== false) redoActions = []
            if (action.clear) return []
            const next = []
            previous.forEach(entry => {
              if (entry.id === action.remove || entry.id === action.complete) return
              const side = action.complete > entry.id && entry.pos === action.pos ? -1 : 1
              const mapped = tr.mapping.mapResult(entry.pos, side)
              // Fitting a block can replace an empty paragraph. That structural
              // change must not cancel another upload sharing its insertion point.
              if (!mapped.deletedAcross || action.complete != null) next.push({ ...entry, pos: mapped.pos })
            })
            return next.concat(action.add || [])
          },
        },
        props: {
          decorations(state) {
            return DecorationSet.create(state.doc, (key.getState(state) || []).map(entry => Decoration.widget(entry.pos, () => tasks.get(entry.id).preview.el, { key: `image-upload-${entry.id}`, side: 1, stopEvent: () => true })))
          },
          handleDOMEvents: { pointerdown(_view, event) {
            if (!event.target.closest?.('.lark-doc-image-upload')) {
              selected = null
              tasks.forEach(task => task.preview.setSelected(false))
            }
            return false
          } },
          handleKeyDown(_view, event) {
            if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === 'z' && storage.undoPending()) {
              event.preventDefault()
              return true
            }
            if ((event.metaKey || event.ctrlKey) && ((event.shiftKey && event.key.toLowerCase() === 'z') || event.key.toLowerCase() === 'y') && storage.redoPending()) {
              event.preventDefault()
              return true
            }
            if (selected && ['Backspace', 'Delete'].includes(event.key)) {
              event.preventDefault()
              remove(selected)
              return true
            }
            if (!['Shift', 'Control', 'Meta', 'Alt'].includes(event.key)) {
              selected = null
              tasks.forEach(task => task.preview.setSelected(false))
            }
            return false
          },
        },
        view() { return {
          update() {
            const present = new Set(entries().map(entry => entry.id))
            tasks.forEach(task => { if (!present.has(task.id)) discard(task, 'placeholder-removed') })
            pendingActions = pendingActions.filter(action => action.ids.some(id => tasks.has(id)))
          },
          destroy() {
            destroyed = true
            pendingActions = []
            redoActions = []
            tasks.forEach(task => discard(task, 'destroy'))
          },
        } },
      })]
    },
  })
}
