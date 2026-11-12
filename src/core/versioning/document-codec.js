/** A tagged JSON document inside the existing opaque binary snapshot contract. */
import { normalizeDocumentRecord } from '../documentSchema'
import { utf8Bytes } from '../text-bytes'
import { toBytes, versioningError } from './types'

const PREFIX = 'LARKDOC-DOCUMENT/1\n'
export const E_VERSION_CONTENT_UNAVAILABLE = 'E_VERSION_CONTENT_UNAVAILABLE'

function encodeText(text) {
  if (typeof TextEncoder === 'function') return Uint8Array.from(new TextEncoder().encode(text))
  const bytes = new Uint8Array(utf8Bytes(text))
  let index = 0
  for (const character of text) {
    const code = character.codePointAt(0)
    if (code < 0x80) bytes[index++] = code
    else if (code < 0x800) { bytes[index++] = 0xc0 | code >> 6; bytes[index++] = 0x80 | code & 63 }
    else if (code < 0x10000) { bytes[index++] = 0xe0 | code >> 12; bytes[index++] = 0x80 | code >> 6 & 63; bytes[index++] = 0x80 | code & 63 }
    else { bytes[index++] = 0xf0 | code >> 18; bytes[index++] = 0x80 | code >> 12 & 63; bytes[index++] = 0x80 | code >> 6 & 63; bytes[index++] = 0x80 | code & 63 }
  }
  return bytes
}

export function isVersionDocumentPayload(payload) {
  const bytes = toBytes(payload)
  return !!bytes && bytes.length >= PREFIX.length && Array.from(PREFIX).every((character, index) => bytes[index] === character.charCodeAt(0))
}

export function encodeVersionDocument(record) {
  return encodeText(PREFIX + JSON.stringify(normalizeDocumentRecord(record)))
}

export function decodeVersionDocument(payload) {
  if (!isVersionDocumentPayload(payload)) throw versioningError(E_VERSION_CONTENT_UNAVAILABLE, '此版本的正文格式无法直接读取，请为 versioning Provider 配置 documentCodec')
  const bytes = toBytes(payload).subarray(PREFIX.length)
  try {
    const text = typeof TextDecoder === 'function' ? new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      : decodeURIComponent(Array.from(bytes, byte => `%${byte.toString(16).padStart(2, '0')}`).join(''))
    return normalizeDocumentRecord(JSON.parse(text))
  } catch (_) { throw versioningError(E_VERSION_CONTENT_UNAVAILABLE, '版本正文已损坏，当前正文未替换') }
}
