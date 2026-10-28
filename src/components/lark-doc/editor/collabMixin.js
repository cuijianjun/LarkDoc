/**
 * 协同接入（P6a / 09 §5.7.1、§5.7.2-3）。
 *
 * 只做两件事，其余一概不动 —— 协同是**宿主主动开**的能力，没传 `collab` 的宿主
 * 走的是与 P5 逐字节相同的路径（这条是回归底线，动这里务必先跑非协同用例）。
 *
 *   1. 透传 `collab` 给 `createLarkDocExtensions`：宿主从 `lark-doc/collab` 拿
 *      `createCollabExtensions({ ydoc })` 与 `isRemoteTransaction` 塞进来；
 *   2. **协同下不传 `content`**：初始正文只能由「首个客户端播种」写一次
 *      （`shouldSeed`），每台客户端各传一份 = 三份正文叠在一起。
 *
 * 刻意没做的三件（P6a 之外的活，写在这里免得被当成漏做）：
 *   · `mode: 'collaborative'` 的 DocumentSession 接线与在线人数广播；
 *   · 离线应急快照（B23 的 `createOfflineSnapshot` 已就绪，等会话层调用）；
 *   · awareness 远端光标（要 provider，`createCollabExtensions` 收到 provider+user 才会装）。
 */
export default {
  props: {
    /**
     * 协同运行时。形状与 `createLarkDocExtensions` 的 `collab` 选项一致：
     * `{ extensions, isRemoteTransaction }`。缺省 `null` = 单机模式。
     *
     * ```js
     * // 宿主侧（Vue 2）
     * const ydoc = new Y.Doc({ gc: false })
     * const provider = new HocuspocusProvider({ url, name: documentId, document: ydoc })
     * const collab = { extensions: createCollabExtensions({ ydoc, provider, user }), isRemoteTransaction }
     * ```
     */
    collab: { type: Object, default: null },
  },
  computed: {
    /** 归一化后的协同选项；`null` 表示单机模式。 */
    collabOptions() {
      const collab = this.collab
      if (!collab || typeof collab !== 'object') return null
      return {
        extensions: Array.isArray(collab.extensions) ? collab.extensions : [],
        // core 只认这个谓词，不 import 任何协同包（见 core/blocks/document.js）。
        isRemoteTransaction: typeof collab.isRemoteTransaction === 'function' ? collab.isRemoteTransaction : null,
      }
    },
  },
}
