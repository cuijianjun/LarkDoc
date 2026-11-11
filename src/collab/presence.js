import { Awareness, applyAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness'
import { createEncoder, writeVarUint, writeVarString, toUint8Array } from 'lib0/encoding'

// 光标是临时相对位置，不写入Y.Doc或正文pending。身份只采用当前服务端投影。
export const PRESENCE_PROTOCOL = 'cursor-v1'
export function validPresenceCursor(cursor) {
  const id = value => value && Object.keys(value).length === 2 &&
    Number.isSafeInteger(value.client) && value.client >= 0 && Number.isSafeInteger(value.clock) && value.clock >= 0
  const position = value => value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).every(key => ['type', 'tname', 'item', 'assoc'].includes(key)) &&
    (value.type == null || id(value.type)) && (value.item == null || id(value.item)) &&
    (value.tname == null || value.tname === 'default') &&
    (value.type != null || value.tname != null) && (value.assoc === undefined || [-1, 0, 1].includes(value.assoc))
  return cursor === null || Boolean(cursor && Object.keys(cursor).length === 2 && position(cursor.anchor) && position(cursor.head))
}

export function createDurablePresence(ydoc, send, state) {
  const awareness = new Awareness(ydoc), peers = new Map()
  let enabled = false, destroyed = false, timer = null, lastSent = 0, nextId = 1, clock = 0
  const remoteIds = () => [...awareness.getStates().keys()].filter(id => id !== ydoc.clientID)
  const clear = () => {
    removeAwarenessStates(awareness, remoteIds(), 'server'); peers.clear()
    for (const id of awareness.meta.keys()) if (id !== ydoc.clientID) awareness.meta.delete(id)
  }
  const flush = () => {
    timer = null
    const current = state()
    if (destroyed || !enabled || !['ready', 'blocked'].includes(current.status)) return
    const cursor = awareness.getLocalState()?.cursor || null
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
  return {
    awareness,
    ready(protocol) { enabled = protocol === PRESENCE_PROTOCOL; clear(); if (enabled) schedule() },
    receive(message) {
      if (!enabled || message.epoch !== state().epoch || !Array.isArray(message.peers) || message.peers.length > 64) throw new Error('INVALID_PRESENCE')
      if (message.privacyGeneration !== undefined && (typeof message.privacyGeneration !== 'string' || !/^(0|[1-9][0-9]*)$/.test(message.privacyGeneration))) throw new Error('INVALID_PRESENCE')
      if (message.informationRevision !== undefined && (typeof message.informationRevision !== 'string' || !/^(0|[1-9][0-9]*)$/.test(message.informationRevision))) throw new Error('INVALID_PRESENCE')
      const generation = message.privacyGeneration, floor = awareness.privacyGeneration || '0'
      if ((generation === undefined && floor !== '0') || (generation !== undefined && (generation.length < floor.length || (generation.length === floor.length && generation < floor)))) return
      const seen = new Set()
      for (const peer of message.peers) {
        if (!peer || typeof peer.peerId !== 'string' || peer.peerId.length > 128 || !peer.peerId || seen.has(peer.peerId) ||
          typeof peer.principalId !== 'string' || !peer.principalId || peer.principalId.length > 256 || !validPresenceCursor(peer.cursor) ||
          (peer.avatarVisible !== undefined && typeof peer.avatarVisible !== 'boolean') ||
          (peer.privacyRevision !== undefined && (typeof peer.privacyRevision !== 'string' || !/^(0|[1-9][0-9]*)$/.test(peer.privacyRevision)))) throw new Error('INVALID_PRESENCE')
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
      removeAwarenessStates(awareness, remoteIds().filter(id => !active.includes(id)), 'server')
      for (const id of awareness.meta.keys()) if (id !== ydoc.clientID && !active.includes(id)) awareness.meta.delete(id)
      for (const key of peers.keys()) if (!seen.has(key)) peers.delete(key)
      const info = message.informationRevision, infoFloor = awareness.informationRevision || '0'
      if (info !== undefined && (info.length > infoFloor.length || (info.length === infoFloor.length && info > infoFloor))) {
        awareness.informationRevision = info
        awareness.emit('information-revision', [info])
      }
      const value = message.privacyGeneration, previous = awareness.privacyGeneration || '0'
      if (value !== undefined && (value.length > previous.length || (value.length === previous.length && value > previous))) {
        awareness.privacyGeneration = value
        awareness.emit('privacy-generation', [value])
      }
    },
    closed() { enabled = false; clearTimeout(timer); timer = null; clear() },
    destroy() { destroyed = true; enabled = false; clearTimeout(timer); timer = null; clear(); awareness.destroy() },
  }
}
