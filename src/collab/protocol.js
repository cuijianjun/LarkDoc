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
