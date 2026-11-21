// Word 97–2003 main story reader. Stream layout follows [MS-CFB] and
// piece positions follow [MS-DOC] §2.4.1. Layout and embedded objects are omitted.
const END = 0xfffffffe
const FREE = 0xffffffff
const OLE_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
const view = bytes => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

function invalid() {
  throw new Error('无法读取此 Word 97–2003 文件，请检查文件或另存为 .docx')
}

function wordStreams(bytes) {
  const header = view(bytes)
  if (bytes.length < 512 || !OLE_SIGNATURE.every((byte, i) => bytes[i] === byte)) invalid()
  const shift = header.getUint16(30, true)
  if (![9, 12].includes(shift) || header.getUint16(32, true) !== 6 || header.getUint16(28, true) !== 0xfffe) invalid()
  const sectorSize = 2 ** shift
  const sectorCount = Math.floor(bytes.length / sectorSize) - 1
  const sector = (id) => {
    if (id >= sectorCount) invalid()
    const start = (id + 1) * sectorSize
    return bytes.subarray(start, start + sectorSize)
  }
  const fatCount = header.getUint32(44, true)
  const difatCount = header.getUint32(72, true)
  if (fatCount + difatCount > sectorCount) invalid()
  const fatIds = new Set()
  const addFat = (id) => {
    if (id === FREE) return
    if (id >= sectorCount || fatIds.has(id) || fatIds.size >= fatCount) invalid()
    fatIds.add(id)
  }
  for (let i = 0; i < 109; i++) addFat(header.getUint32(76 + i * 4, true))
  let difat = header.getUint32(68, true)
  const difatIds = new Set()
  for (let i = 0; i < difatCount; i++) {
    if (difatIds.has(difat)) invalid()
    difatIds.add(difat)
    const table = view(sector(difat))
    for (let offset = 0; offset < sectorSize - 4; offset += 4) addFat(table.getUint32(offset, true))
    difat = table.getUint32(sectorSize - 4, true)
  }
  if (fatIds.size !== fatCount) invalid()
  // Only the slots for existing sectors can describe file data.
  const fat = new Uint32Array(sectorCount)
  let slot = 0
  for (const id of fatIds) {
    const entries = view(sector(id))
    for (let pos = 0; pos < sectorSize && slot < fat.length; pos += 4) fat[slot++] = entries.getUint32(pos, true)
  }
  if (slot !== fat.length) invalid()

  function readChain(id, allocation, readSector, limit, unit) {
    if (limit !== Infinity && limit > bytes.length) invalid()
    const chain = [], visited = new Set()
    let length = 0
    while (id !== END && length < limit) {
      if (id >= allocation.length || visited.has(id)) invalid()
      visited.add(id)
      chain.push(readSector(id))
      length += unit
      id = allocation[id]
    }
    if (length < limit && limit !== Infinity) invalid()
    const result = new Uint8Array(Math.min(length, limit))
    let offset = 0
    for (const part of chain) {
      const chunk = part.subarray(0, result.length - offset)
      result.set(chunk, offset)
      offset += chunk.length
    }
    return result
  }

  const directory = view(readChain(header.getUint32(48, true), fat, sector, Infinity, sectorSize))
  if (directory.byteLength < 128 || directory.getUint8(66) !== 5) invalid()
  const entries = new Map(), pending = [directory.getUint32(76, true)], visited = new Set()
  const decoder = new TextDecoder('utf-16le')
  while (pending.length) {
    const id = pending.pop()
    if (id === FREE) continue
    const offset = id * 128
    if (offset + 128 > directory.byteLength || visited.has(id)) invalid()
    visited.add(id)
    pending.push(directory.getUint32(offset + 68, true), directory.getUint32(offset + 72, true))
    if (directory.getUint8(offset + 66) !== 2) continue
    const nameLength = directory.getUint16(offset + 64, true)
    if (nameLength < 2 || nameLength > 64 || nameLength % 2) invalid()
    const name = decoder.decode(new Uint8Array(directory.buffer, offset, nameLength - 2))
    entries.set(name, offset)
  }

  const large = (offset, limit) => readChain(directory.getUint32(offset + 116, true), fat, sector, limit, sectorSize)
  let miniStream, miniFat
  return (name) => {
    const offset = entries.get(name)
    if (offset === undefined) invalid()
    const size = directory.getUint32(offset + 120, true)
    if (size >= 4096 || size === 0) return large(offset, size)
    if (!miniStream) {
      miniStream = large(0, directory.getUint32(120, true))
      const tableBytes = readChain(header.getUint32(60, true), fat, sector, header.getUint32(64, true) * sectorSize, sectorSize)
      const table = view(tableBytes)
      miniFat = new Uint32Array(tableBytes.length / 4)
      for (let index = 0; index < miniFat.length; index++) miniFat[index] = table.getUint32(index * 4, true)
    }
    return readChain(directory.getUint32(offset + 116, true), miniFat, (id) => {
      if ((id + 1) * 64 > miniStream.length) invalid()
      return miniStream.subarray(id * 64, (id + 1) * 64)
    }, size, 64)
  }
}

export function readLegacyWord(buffer) {
  try {
    const stream = wordStreams(new Uint8Array(buffer))
    const word = stream('WordDocument')
    const fib = view(word)
    const flags = fib.getUint16(10, true)
    if (fib.getUint16(0, true) !== 0xa5ec || fib.getUint16(2, true) < 0xc1 || flags & 0x8100) invalid()
    const longWords = 34 + fib.getUint16(32, true) * 2
    const longCount = fib.getUint16(longWords, true)
    const offsets = longWords + 2 + longCount * 4
    if (longCount < 4 || fib.getUint16(offsets, true) <= 33) invalid()
    const textLength = fib.getUint32(longWords + 14, true)
    const table = view(stream(flags & 0x0200 ? '1Table' : '0Table'))
    let current = fib.getUint32(offsets + 2 + 33 * 8, true)
    const end = current + fib.getUint32(offsets + 6 + 33 * 8, true)
    if (textLength > word.length || end > table.byteLength) invalid()
    if (!textLength) return ''
    while (current + 3 <= end && table.getUint8(current) === 1) current += 3 + table.getUint16(current + 1, true)
    if (current + 5 > end || table.getUint8(current) !== 2) invalid()
    const size = table.getUint32(current + 1, true)
    current += 5
    if (current + size > end || size < 16 || (size - 4) % 12) invalid()
    const pieceCount = (size - 4) / 12
    const pieces = current + (pieceCount + 1) * 4
    const decoders = [new TextDecoder('utf-16le', { ignoreBOM: true }), new TextDecoder('windows-1252')]
    const output = []
    let start = table.getUint32(current, true)
    if (start !== 0) invalid()
    for (let i = 0; i < pieceCount && start < textLength; i++) {
      const next = table.getUint32(current + (i + 1) * 4, true)
      const position = table.getUint32(pieces + i * 8 + 2, true)
      const compressed = (position & 0x40000000) !== 0
      const stride = compressed ? 1 : 2
      const from = (position & 0x3fffffff) / (compressed ? 2 : 1)
      const to = from + (Math.min(next, textLength) - start) * stride
      if (next <= start || !Number.isInteger(from) || to > word.length) invalid()
      output.push(decoders[Number(compressed)].decode(word.subarray(from, to)))
      start = next
    }
    if (start < textLength) invalid()
    // The Word binary format uses control characters for field boundaries and paragraph breaks.
    /* eslint-disable no-control-regex */
    return output.join('').replace(/\x13[^\x14\x15]*[\x14\x15]/g, '').replace(/[\r\v\f]/g, '\n')
      .replace(/\x07/g, '\t').replace(/[\x00-\x08\x0e-\x1f]/g, '').replace(/\n$/, '')
    /* eslint-enable no-control-regex */
  } catch (error) {
    if (!(error instanceof RangeError)) throw error
    invalid()
  }
}
