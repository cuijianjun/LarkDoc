// @vitest-environment jsdom
/**
 * 协同测试脚手架：**多客户端、进程内**（09 §5.7.4 的 e2e 在这里落成单测形态）。
 *
 * 为什么不用真 WebSocket 跑 C1–C9：这九条要验的是「收敛行为」——
 * 两个 Y.Doc 之间怎么交换 update、收到远端后编辑器怎么反应、blockId 会不会被补两次。
 * 把 update 直接在两份 doc 之间投递，就把「线」抽掉只留「协议」，
 * 失败点因此只剩业务逻辑；真 WS 的那一段另有 `hocuspocus-wire.test.js` 专门验一次。
 *
 * 三条纪律（别在用例里绕过）：
 *   1. **每个 peer 是独立 Y.Doc**：共用一个 doc 会让「收敛」变成恒等式，什么都验不出来。
 *   2. **远端 update 必须带 ORIGIN 标记**：y-prosemirror 靠 origin 区分本地/远端，
 *      `document.js` 的「远端不补 blockId」也靠它。不带 origin 的投递 = 假装本地编辑，
 *      C5 会假绿。
 *   3. **`gc: false`**：与 `createHocuspocusBridge` 一致，评论锚点用
 *      `Y.RelativePosition` 需要它。顺手也让「并发删除后再插入」的用例可复现。
 */
import * as Y from 'yjs'
import { Editor } from '@tiptap/core'
import { createLarkDocExtensions } from '../../src/components/lark-doc/extensions'
import { createCollabExtensions, isRemoteTransaction } from '../../src/collab/index'

/** 远端投递统一用这个 origin。y-prosemirror 的本地 origin 是 `ySyncPluginKey`。 */
export const REMOTE_ORIGIN = 'collab-harness:remote'

/**
 * 一个「网络」：登记若干 peer，把每个 peer 的本地 update 广播给其余 peer。
 *
 * `setOnline(false)` 是断网（C4）与并发（C2/C5/C9）的实现方式 —— 分区期间各自的
 * update 不投递，`reconnect()` 用全量状态交换补齐。这与真实断线重连的语义一致：
 * 重连时服务端不重放逐条 update，而是交换 state vector 后补齐差集。
 */
export function createNetwork() {
  const peers = new Set()
  let online = true
  const broadcast = (from, update) => {
    if (!online) return
    peers.forEach((peer) => {
      if (peer !== from) Y.applyUpdate(peer.ydoc, update, REMOTE_ORIGIN)
    })
  }
  return {
    attach(peer) {
      // 新客户端进来先「同步」：把已有客户端的全量状态补给它（等价于 hocuspocus 的
      // sync 阶段）。少了这一步，后加入的客户端看到的是**空文档**，
      // C7 的「首次播种」就会每个客户端各种一遍 —— 那验的不是播种策略，是脚手架的漏洞。
      const existing = Array.from(peers)[0]
      if (existing) Y.applyUpdate(peer.ydoc, Y.encodeStateAsUpdate(existing.ydoc), REMOTE_ORIGIN)
      peers.add(peer)
      // 只转发本地产生的 update；远端投递（REMOTE_ORIGIN）不再转发，否则会互相回环。
      peer.ydoc.on('update', (update, origin) => {
        if (origin === REMOTE_ORIGIN) return
        broadcast(peer, update)
      })
      return peer
    },
    setOnline(value) { online = value !== false },
    /** 重连：双向补齐差集（等价于服务端 sync 阶段）。 */
    reconnect() {
      const list = Array.from(peers)
      for (const source of list) {
        const update = Y.encodeStateAsUpdate(source.ydoc)
        for (const target of list) {
          if (target !== source) Y.applyUpdate(target.ydoc, update, REMOTE_ORIGIN)
        }
      }
      online = true
    },
  }
}

/**
 * 建一个协同客户端。**不传 content**（§5.7.2-3：协同下初始正文只能播种一次）。
 *
 * @param {ReturnType<typeof createNetwork>} network
 * @param {{ name?: string, editable?: boolean, options?: object }} config
 */
export function createPeer(network, config = {}) {
  const ydoc = new Y.Doc({ gc: false })
  const editor = new Editor({
    extensions: createLarkDocExtensions({
      ...(config.options || {}),
      collab: {
        extensions: createCollabExtensions({ ydoc }),
        isRemoteTransaction,
      },
    }),
    editable: config.editable !== false,
  })
  const peer = {
    name: config.name || 'peer',
    ydoc,
    editor,
    get text() { return editor.state.doc.textContent },
    destroy() {
      try { editor.destroy() } catch (error) { /* 已销毁 */ }
      try { ydoc.destroy() } catch (error) { /* 已销毁 */ }
    },
  }
  network.attach(peer)
  return peer
}

/** 文档里出现过的 blockId 列表（保持文档顺序，重复项原样保留 —— 重复本身就是断言对象）。 */
export function blockIds(peer) {
  const ids = []
  peer.editor.state.doc.descendants((node) => {
    if (node.attrs && typeof node.attrs.blockId === 'string' && node.attrs.blockId) ids.push(node.attrs.blockId)
  })
  return ids
}

/** 文档里某段文本出现的次数（C4 的「无重复」与 C7 的「只播种一次」都用它）。 */
export function countOf(peer, needle) {
  return peer.text.split(needle).length - 1
}

/** 在第 pos 个位置插一段纯文本（走编辑器命令，因此会产生真正的本地事务）。 */
export function typeAt(peer, pos, text) {
  peer.editor.commands.setTextSelection(pos)
  return peer.editor.commands.insertContent(text)
}

/** 段落 / 标题这类块插入（配合 blockId 断言用）。 */
export function insertBlock(peer, node) {
  const size = peer.editor.state.doc.content.size
  peer.editor.commands.setTextSelection(size)
  return peer.editor.commands.insertContent(node)
}
