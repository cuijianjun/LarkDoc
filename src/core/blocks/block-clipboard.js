import { Extension, getText, getTextSerializersFromSchema } from '@tiptap/core'
import { createMentionId } from './mention'
import { Plugin, NodeSelection, AllSelection } from '@tiptap/pm/state'
import { DOMSerializer, Fragment, Slice } from '@tiptap/pm/model'
import { closeHistory } from '@tiptap/pm/history'
import { BLOCK_ID_TYPES, createBlockId, validateDocument } from '../documentOperations'

export const BLOCK_CLIPBOARD_MIME = 'application/vnd.lark-doc.blocks+json'
export const BLOCK_CLIPBOARD_VERSION = 1

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value))
}

export function createClipboardPayload(blocks, options = {}) {
  if (!Array.isArray(blocks) || !blocks.length) return null
  return {
    version: BLOCK_CLIPBOARD_VERSION,
    source: typeof options.source === 'string' ? options.source : 'editor',
    blocks: clone(blocks),
  }
}

export function encodeClipboardPayload(payload) {
  if (!payload || payload.version !== BLOCK_CLIPBOARD_VERSION || !Array.isArray(payload.blocks) || !payload.blocks.length) return ''
  return JSON.stringify(payload)
}

export function decodeClipboardPayload(value) {
  if (typeof value !== 'string' || !value) return null
  try {
    const payload = JSON.parse(value)
    if (payload.version !== BLOCK_CLIPBOARD_VERSION || !Array.isArray(payload.blocks) || !payload.blocks.length) return null
    return clone(payload)
  } catch (error) {
    return null
  }
}

export function remapClipboardIds(blocks, taken = new Set()) {
  const used = taken instanceof Set ? new Set(taken) : new Set()
  const idMap = {}
  const remap = (node) => {
    const copy = clone(node)
    if (!copy || typeof copy !== 'object') return copy
    if (BLOCK_ID_TYPES.has(copy.type)) {
      const oldId = copy.attrs && copy.attrs.blockId
      const nextId = createBlockId(used)
      used.add(nextId)
      copy.attrs = { ...(copy.attrs || {}), blockId: nextId }
      if (typeof oldId === 'string' && oldId) idMap[oldId] = nextId
    }
    if (copy.type === 'mention') copy.attrs = { ...copy.attrs, mentionId: createMentionId() }
    if (Array.isArray(copy.marks)) copy.marks = copy.marks.filter(mark => !['comment', 'revision'].includes(mark.type))
    if (Array.isArray(copy.content)) copy.content = copy.content.map(remap)
    return copy
  }
  return { blocks: blocks.map(remap), idMap }
}

export function serializeBlockClipboard(view, content) {
  const encoded = encodeClipboardPayload(createClipboardPayload(content.toJSON()))
  if (!encoded || encoded.length > 5000000) throw new Error('剪贴板内容为空或过大')
  const dom = view.dom.ownerDocument.createElement('div')
  dom.appendChild(DOMSerializer.fromSchema(view.state.schema).serializeFragment(content, { document: view.dom.ownerDocument }))
  const doc = view.state.schema.topNodeType.create(null, content)
  return { [BLOCK_CLIPBOARD_MIME]: encoded, 'text/html': dom.innerHTML,
    'text/plain': getText(doc, { blockSeparator: '\n\n', textSerializers: getTextSerializersFromSchema(view.state.schema) }) }
}

// Only exact sibling-block boundaries qualify; ordinary text stays on PM's native path.
function selectedBlocks(state) {
  const { selection, doc } = state
  if (selection.empty) return null
  if (selection instanceof AllSelection) return { from: 0, to: doc.content.size, content: doc.content }
  if (selection instanceof NodeSelection) return selection.node.isBlock
    ? { from: selection.from, to: selection.to, content: Fragment.from(selection.node) } : null
  const { $from, $to } = selection
  if (!$from.sameParent($to) && $from.depth === 1 && $to.depth === 1
    && $from.parentOffset === 0 && $to.parentOffset === $to.parent.content.size) {
    const from = $from.before(1)
    const to = $to.after(1)
    return { from, to, content: doc.slice(from, to).content }
  }
  return null
}

export function blockClipboardExtension(options = {}) {
  return Extension.create({
    name: 'larkDocBlockClipboard',
    priority: 1100,
    addProseMirrorPlugins() {
      const copy = (view, event, cut) => {
        if (options.canCopy && options.canCopy() === false) {
          event.preventDefault()
          return true
        }
        const selected = selectedBlocks(view.state)
        if (!selected || !view.state.schema.topNodeType.validContent(selected.content)) return false
        event.preventDefault()
        // A readonly cut must never fall through to native deletion.
        if (cut && !view.editable) return true
        try {
          const data = event.clipboardData
          if (!data) throw new Error('剪贴板不可用')
          const values = serializeBlockClipboard(view, selected.content)
          data.setData('text/html', values['text/html'])
          data.setData('text/plain', values['text/plain'])
          data.setData(BLOCK_CLIPBOARD_MIME, values[BLOCK_CLIPBOARD_MIME])
          if (cut) view.dispatch(closeHistory(view.state.tr).delete(selected.from, selected.to).scrollIntoView())
        } catch (error) {
          options.onError?.(`复制失败：${error.message}`)
        }
        return true
      }
      return [new Plugin({ props: {
        handleDOMEvents: {
          copy: (view, event) => copy(view, event, false),
          cut: (view, event) => copy(view, event, true),
          paste(view, event) {
            const data = event.clipboardData
            if (event.shiftKey || view.input?.shiftKey || view.state.selection.$from.parent.type.spec.code) return false
            const mime = data && [BLOCK_CLIPBOARD_MIME, `web ${BLOCK_CLIPBOARD_MIME}`].find(type => Array.from(data.types || []).includes(type))
            if (!mime) return false
            event.preventDefault()
            if (!view.editable) return true
            try {
              const raw = data.getData(mime)
              if (raw.length > 5000000) throw new Error('剪贴板内容过大')
              const payload = decodeClipboardPayload(raw)
              if (!payload) throw new Error('剪贴板格式无效')
              const validated = validateDocument({ type: 'doc', content: payload.blocks }, view.state.schema)
              const taken = new Set()
              view.state.doc.descendants(node => { if (node.attrs.blockId) taken.add(node.attrs.blockId) })
              const filtered = options.filterDocument ? options.filterDocument(validated) : validated
              const { blocks } = remapClipboardIds(filtered.content, taken)
              const content = Fragment.from(blocks.map(node => view.state.schema.nodeFromJSON(node)))
              view.dispatch(closeHistory(view.state.tr).replaceSelection(new Slice(content, 0, 0)).scrollIntoView())
            } catch (error) {
              options.onError?.(`粘贴失败：${error.message}`)
            }
            return true
          },
        },
      } })]
    },
  })
}
