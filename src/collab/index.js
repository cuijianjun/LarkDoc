/**
 * 协同客户端子入口 —— requirements/09 §3.3 / §5.7.3（决策 5）。
 *
 * 边界（写死）：协同服务端不在本仓库（独立 package `@lark-doc/collab-server`），
 * 本目录只暴露三个客户端工厂签名与协议版本；P6a 才真正实现。
 * e2e 起内存服务端用第三方 `@hocuspocus/server`（devDependencies，
 * 只准出现在 test/），本仓不含任何自有服务端代码。
 *
 * 契约版本：握手时客户端与服务端双向校验 `COLLAB_PROTOCOL_VERSION`；
 * 不一致 → 客户端抛 `E_PROTOCOL_MISMATCH`，不回退、不静默、不半连。
 *
 * 零依赖约束：本文件不得 import yjs / @hocuspocus/* / 网络库 ——
 * P6a 实现时 yjs 由 `lark-doc/collab` 子入口外部化给宿主（§3.6 产物矩阵）。
 */

/** 与独立服务端 package 双向校验的契约版本。 */
export const COLLAB_PROTOCOL_VERSION = 1

/**
 * 创建协同编辑器扩展集合。
 * @param {{ ydoc: object, onError?: (err: Error) => void }} options
 * @returns {Array} [Collaboration, CollaborationCaret?]
 * @throws {Error} P6a 前未实现
 */
export function createCollabExtensions(options) {
  throw new Error(`not implemented: createCollabExtensions（P6a 落地，契约见 docs/guide/collab-server.md）received=${typeof options}`)
}

/**
 * 创建 Hocuspocus 桥（连接、鉴权、断线重连都归它）。
 * @param {{ url: string, documentId: string, token: string, user: { id: string, name: string, color: string } }} options
 * @returns {{ ydoc: object, provider: object, destroy: () => void }}
 * @throws {Error} P6a 前未实现
 */
export function createHocuspocusBridge(options) {
  throw new Error(`not implemented: createHocuspocusBridge（P6a 落地，契约见 docs/guide/collab-server.md）received=${typeof options}`)
}

/**
 * 评论锚点：Y.RelativePosition 编解码（P6b 才真正用）。
 * @param {{ ydoc: object }} options
 * @returns {{ encode: Function, decode: Function }}
 * @throws {Error} P6b 前未实现
 */
export function createCommentAnchors(options) {
  throw new Error(`not implemented: createCommentAnchors（P6b 落地，契约见 docs/guide/collab-server.md）received=${typeof options}`)
}
