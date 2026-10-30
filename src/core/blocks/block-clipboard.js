import { BLOCK_ID_TYPES, createBlockId } from '../documentOperations'

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
    if (Array.isArray(copy.content)) copy.content = copy.content.map(remap)
    return copy
  }
  return { blocks: blocks.map(remap), idMap }
}
