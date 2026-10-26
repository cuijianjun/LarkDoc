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
