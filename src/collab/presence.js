import { Awareness, applyAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness'
import { createEncoder, writeVarUint, writeVarString, toUint8Array } from 'lib0/encoding'
import { laterRevision, PRESENCE_PROTOCOL, isRecord } from './protocol'

// 光标是临时相对位置，不写入Y.Doc或正文pending。身份只采用当前服务端投影。
export { PRESENCE_PROTOCOL } from './protocol'
export const validRevision = value => typeof value === 'string' && /^(0|[1-9][0-9]*)(?![\s\S])/.test(value)
export function validPresenceCursor(cursor) {
  const id = value => value && Object.keys(value).length === 2 &&
    Number.isSafeInteger(value.client) && value.client >= 0 && Number.isSafeInteger(value.clock) && value.clock >= 0
  const position = value => isRecord(value) &&
    Object.keys(value).every(key => ['type', 'tname', 'item', 'assoc'].includes(key)) &&
    (value.type == null || id(value.type)) && (value.item == null || id(value.item)) &&
    (value.tname == null || value.tname === 'default') &&
    (value.type != null || value.tname != null) && (value.assoc === undefined || [-1, 0, 1].includes(value.assoc))
  return cursor === null || Boolean(cursor && Object.keys(cursor).length === 2 && position(cursor.anchor) && position(cursor.head))
}

export function createDurablePresence(ydoc, send, state, existingAwareness) {
  const awareness = existingAwareness || new Awareness(ydoc), peers = new Map()
  let enabled = false, destroyed = false, timer = null, lastSent = 0, nextId = 1, clock = 0
  const remoteIds = () => [...awareness.getStates().keys()].filter(id => id !== ydoc.clientID)
  const removeAbsent = (active = []) => {
    removeAwarenessStates(awareness, remoteIds().filter(id => !active.includes(id)), 'server')
    for (const id of awareness.meta.keys()) if (id !== ydoc.clientID && !active.includes(id)) awareness.meta.delete(id)
  }
  const clear = () => {
    removeAbsent(); peers.clear()
  }
  const flush = () => {
    timer = null
    const current = state()
    if (destroyed || !enabled || !['ready', 'blocked'].includes(current.status)) return
    const local = awareness.getLocalState(), cursor = local && local.cursor || null
    if (!validPresenceCursor(cursor)) return
    lastSent = Date.now()
    send({ type: 'PRESENCE', epoch: current.epoch, cursor })
  }
  const schedule = () => {
    if (!destroyed && enabled && timer === null) timer = setTimeout(flush, Math.max(0, 120 - (Date.now() - lastSent)))
  }
  awareness.on('update', (change, origin) => {
    if (origin === 'local' && [...change.added, ...change.updated, ...change.removed].includes(ydoc.clientID)) schedule()
  })
  const closed = () => { enabled = false; clearTimeout(timer); timer = null; clear() }
  return {
    awareness,
    ready(protocol) { enabled = protocol === PRESENCE_PROTOCOL; clear(); if (enabled) schedule() },
    receive(message) {
      if (!enabled || message.epoch !== state().epoch || !Array.isArray(message.peers) || message.peers.length > 64) throw new Error('INVALID_PRESENCE')
      if (['privacyGeneration', 'informationRevision'].some(field => message[field] !== undefined && !validRevision(message[field]))) throw new Error('INVALID_PRESENCE')
      const generation = message.privacyGeneration, floor = awareness.privacyGeneration || '0'
      if ((generation === undefined && floor !== '0') || (generation !== undefined && laterRevision(floor, generation))) return
      const seen = new Set()
      for (const peer of message.peers) {
        if (!peer || typeof peer.peerId !== 'string' || peer.peerId.length > 128 || !peer.peerId || seen.has(peer.peerId) ||
          typeof peer.principalId !== 'string' || !peer.principalId || peer.principalId.length > 256 || !validPresenceCursor(peer.cursor) ||
          (peer.avatarVisible !== undefined && typeof peer.avatarVisible !== 'boolean') ||
          (peer.privacyRevision !== undefined && !validRevision(peer.privacyRevision))) throw new Error('INVALID_PRESENCE')
        seen.add(peer.peerId)
      }
      const active = []
      for (const peer of message.peers) {
        let id = peers.get(peer.peerId)
        if (id === undefined) { while (nextId === ydoc.clientID) nextId++; id = nextId++; peers.set(peer.peerId, id) }
        active.push(id)
        // 复用文档已有的三种强调色；颜色由主体稳定映射，客户端不能伪造远端名字。
        const index = [...peer.principalId].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 3
        const encoder = createEncoder()
        writeVarUint(encoder, 1); writeVarUint(encoder, id); writeVarUint(encoder, ++clock)
        writeVarString(encoder, JSON.stringify({ user: { id: peer.principalId, name: peer.principalId, colorIndex: index, avatarVisible: peer.avatarVisible === true }, cursor: peer.cursor }))
        applyAwarenessUpdate(awareness, toUint8Array(encoder), 'server')
      }
      removeAbsent(active)
      for (const key of peers.keys()) if (!seen.has(key)) peers.delete(key)
      for (const [field, event] of [['informationRevision', 'information-revision'], ['privacyGeneration', 'privacy-generation']]) {
        const value = message[field]
        if (value !== undefined && laterRevision(value, awareness[field] || '0')) {
          awareness[field] = value
          awareness.emit(event, [value])
        }
      }
    },
    closed,
    destroy() { destroyed = true; closed(); awareness.destroy() },
  }
}
