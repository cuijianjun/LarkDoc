/* global globalThis */
/**
 * 协同协议版本（P6a / 09 §5.7.3）。
 *
 * 客户端与服务端握手时**双向校验**；不一致 → 客户端抛 `E_PROTOCOL_MISMATCH`，
 * 不回退、不静默、不半连。改这个数字等于宣布不兼容旧服务端。
 *
 * 单独一个文件是为了让 `policies.js`（纯策略）与 `index.js`（会 import yjs）
 * 共用同一个常量，而纯策略层不必为了一个数字去加载协同运行时。
 */
export const COLLAB_PROTOCOL_VERSION = 1

/**
 * 正文所在的 Y.XmlFragment 名（`Y.Doc.getXmlFragment(COLLAB_CONTENT_FIELD)`）。
 *
 * 必须是 `'default'`：`@tiptap/extension-collaboration` 的 `field` 默认值就是它，
 * 客户端与服务端读的也必须是同一个键 —— 写错名字的现象是「连上了、peer 数正常、
 * 但正文永远空白」，因为这个 fragment 建了两份。
 *
 * 统一到这里是因为踩过一次：评论锚点默认取了 `'content'`（听起来更自然），
 * 与编辑器实际写库的 fragment 不是同一个。
 */
export const COLLAB_CONTENT_FIELD = 'default'
export const PRESENCE_PROTOCOL = 'cursor-v1'

/** 已验证的十进制水位按位数/字典序比较，不经 Number 丢失大整数精度。 */
export const laterRevision = (value, floor) => value.length > floor.length || (value.length === floor.length && value > floor)

export const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key)
export const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)
export const matches = (value, expected) => Object.keys(expected).every(key => value[key] === expected[key])
export const project = (value, fields) => {
  const result = {}
  for (const key of fields) result[key] = value[key]
  return result
}

export const validResourceId = value => typeof value === 'string' && /^[A-Za-z0-9._-]{1,128}(?![\s\S])/.test(value)

export const hex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
export async function payloadHash(bytes) {
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))
  return 'sha256:' + hex(digest)
}

export const sendFrame = (provider, scope, message) => provider.sendStateless(JSON.stringify({ ...scope, ...message }))
