/**
 * 协同客户端子入口（P6a / requirements/09 §3.3、§5.7.3）。
 *
 * 边界（写死，别越界）：
 *   · 服务端**不在本仓库**（独立 package `@lark-doc/collab-server`）。本目录只有客户端；
 *     e2e 起内存服务端用第三方 `@hocuspocus/server`，且只准出现在 `test/`。
 *   · yjs / @hocuspocus/* / @tiptap/extension-collaboration* 均由协同宿主按 collabDependencies 安装：
 *     普通编辑不声明协同 peer，不因宿主未使用的旧版依赖阻止安装。所以这个文件不挂在 `src/index.js` 上，
 *     它是独立子入口 `lark-doc/collab`（产物 `dist/lark-doc-collab.esm.js`）。
 *   · `documentId` 是**不透明字符串**（建议 `<workspaceId>/<docId>`），客户端不解析它。
 *
 * 与 core 的唯一缝：`isRemoteTransaction`。core 不知道 yjs 存在，
 * 只接受一个「这笔事务是不是远端来的」谓词（§5.7.2-1 的 blockId 冲突就靠它）。
 */
import * as Y from 'yjs'
import { Collaboration, isChangeOrigin } from '@tiptap/extension-collaboration'
import { CollaborationCaret } from '@tiptap/extension-collaboration-caret'
import { HocuspocusProvider } from '@hocuspocus/provider'
import { COLLAB_PROTOCOL_VERSION, COLLAB_CONTENT_FIELD } from './protocol'
import { markCollabRuntime } from '../core/collabRuntime'

export { COLLAB_PROTOCOL_VERSION, COLLAB_CONTENT_FIELD }
/**
 * 运行策略一并导出（B22 UI 状态 / B23 离线快照 / B24 capability 交集 / 首次播种 / 协议校验）。
 * 宿主从这里拿到的是纯函数与纯状态机：不 import yjs、不碰 DOM、不建连接。
 */
export * from './policies'
/**
 * 评论锚点：编解码器 + 接进 `core/comments` 的那个 codec（P6b 才真正用上）。
 */
export * from './anchors'

/**
 * 这笔事务是不是「远端来的」。
 *
 * y-prosemirror 的远端更新会带 `y-sync` 插件 meta，官方给了 `isChangeOrigin` 判定。
 * core 侧只认这个谓词，不 import 任何协同包 —— 不装协同的宿主也跑同一套 core。
 */
export function isRemoteTransaction(transaction) {
  return isChangeOrigin(transaction)
}

/**
 * 协同编辑器扩展集合。
 *
 * @param {{ ydoc: Y.Doc, provider?: object, user?: { name: string, color: string } }} options
 *   `provider` + `user` 都给才装光标（CollaborationCaret 要 awareness）；
 *   只给 ydoc = 纯同步、不画别人的光标（导出、服务端渲染、只读镜像）。
 * @returns {Array} Tiptap 扩展数组，交给 `createLarkDocExtensions({ collab })`
 */
export function createCollabExtensions(options = {}) {
  const { ydoc, provider, user } = options
  if (!(ydoc instanceof Y.Doc)) {
    throw new TypeError('createCollabExtensions 需要同模块格式的真实 Y.Doc（ESM import 或 CJS require 必须与 lark-doc/collab 一致）')
  }
  const extensions = [Collaboration.configure({ document: ydoc, field: COLLAB_CONTENT_FIELD })]
  if (provider && provider.awareness && user && user.name) {
    extensions.push(CollaborationCaret.configure({ provider, user }))
  }
  return markCollabRuntime(extensions)
}

/**
 * Hocuspocus 桥：一个 Y.Doc + 一个 provider，连接、鉴权、重连都归它。
 *
 * 🔴 `gc: false` 不是可选优化：评论锚点用 `Y.RelativePosition`（§5.7.2-8），
 * GC 打开时被删片段会被回收，锚点就解不出来。代价是内存只增不减 ——
 * P6a 出口单独量这一项（§3.7.2），超了才上快照压缩。
 *
 * @param {object} options
 * @param {string} options.url ws(s):// 地址
 * @param {string} options.documentId 不透明文档键
 * @param {string} [options.token] 鉴权 token，原样透传给服务端 onAuthenticate
 * @param {(status: string) => void} [options.onStatus] connecting / connected / disconnected
 * @param {(payload?: object) => void} [options.onSynced] 首次同步完成 —— 首次播种的唯一时机
 * @param {(payload?: object) => void} [options.onAuthenticated] 鉴权回执；带 capabilities 时由宿主取交集（B24）
 * @param {(error: Error) => void} [options.onError]
 * @returns {{ ydoc: Y.Doc, provider: object, destroy: () => void }}
 */
export function createHocuspocusBridge(options = {}) {
  const { url, documentId, token, onStatus, onSynced, onAuthenticated, onError } = options
  if (!url) throw new TypeError('createHocuspocusBridge 需要 url')
  if (!documentId) throw new TypeError('createHocuspocusBridge 需要 documentId（不透明字符串）')
  // 普通编辑不声明这些 peer；显式协同时在创建任何连接前验证所需API。
  if (typeof HocuspocusProvider.prototype.attach !== 'function' || typeof HocuspocusProvider.prototype.detach !== 'function') {
    throw new TypeError('协同Provider不兼容：需要Hocuspocus 4.x的attach/detach API；请按collab安装契约提供依赖')
  }

  const ydoc = new Y.Doc({ gc: false })
  const provider = new HocuspocusProvider({
    url,
    name: String(documentId),
    document: ydoc,
    token: token || '',
    onStatus: ({ status }) => { if (onStatus) onStatus(status) },
    onSynced: (payload) => { if (onSynced) onSynced(payload) },
    onAuthenticated: (payload) => { if (onAuthenticated) onAuthenticated(payload) },
    onAuthenticationFailed: (payload) => {
      const error = new Error('协同鉴权失败')
      error.code = 'E_AUTH_FAILED'
      error.payload = payload
      if (onError) onError(error)
    },
    // onClose 单独给 disconnected：断线重连的提示条挂这里，不是挂 onStatus。
    onClose: () => { if (onStatus) onStatus('disconnected') },
  })

  let destroyed = false
  return {
    ydoc,
    provider,
    destroy() {
      if (destroyed) return
      destroyed = true
      // provider 先断，再销毁 doc：反过来会让 provider 的收尾回调读到已销毁的 doc。
      try { provider.destroy() } catch (error) { /* 已断开 */ }
      try { ydoc.destroy() } catch (error) { /* 已销毁 */ }
    },
  }
}

/**
 * 评论锚点编解码（§5.7.2-8；UI 到 P6b 才接）。
 *
 * 实现已搬到 `./anchors.js` —— 那里还要放接进 `core/comments` 的 codec，
 * 两件事共用一个坐标系，分开写迟早走样。
 */
