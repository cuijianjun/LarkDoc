/**
 * 评论锚点与 Yjs 的接缝（P6b / 09 §5.7.2-8、§710）。
 *
 * core/comments 的锚点是 `{ blockId, offset, length }` —— **块内相对偏移**，身份跟着块走；
 * Yjs 的位置是**某个 type 内的相对 index**，跟着内容走。两者不是一个坐标系，中间必须有一对
 * 解析器才能互相翻译，而「块起点对应哪个 Y.XmlText、在它第几个字符」只有拿着编辑器 doc 的
 * 宿主知道。所以这里不做「猜」，只做「接」。
 *
 * 🔴 两个实测出来的坑（改这个文件前先读，别凭直觉）：
 *
 * 1. **`type` 必须是承载字符的 `Y.XmlText`，不是外层 `XmlFragment`。**
 *    `createRelativePositionFromTypeIndex(fragment, 6)` 里的 6 是**顶层第几个子节点**，
 *    不是第几个字符；插入一个块就整体错位。现象不是报错，而是「锚点不漂移，但永远指错块」——
 *    比漂移难查。默认 type 保留 fragment 只是为了兼容 P6a 已发的行为签名。
 *
 * 2. **内容被删，yjs 不会告诉你。** `gc: false` 时 tombstone 还在，
 *    `createAbsolutePositionFromRelativePosition` 照样返回值（实测删空后仍返回 `{ index: 0 }`）。
 *    所以「失联」只能由宿主 `locate` 判定（块不在文档里了），不能靠 decode 出 null。
 *
 * 边界：本文件可以 import yjs（它活在 collab 子入口里），core 一律不 import。
 */

import * as Y from 'yjs'
import { COLLAB_CONTENT_FIELD } from './protocol'

/**
 * 相对位置编解码（P6a 已落地，P6b 才真正被评论用上）。
 *
 * 落库的是 `encode(index)` 出来的字节，不是数字 index。
 * `gc: false` 是它能解回来的前提：GC 打开时被删片段会被回收，位置直接变成 null。
 *
 * @param {object} options
 * @param {import('yjs').Doc} options.ydoc
 * @param {Y.AbstractType<any>} [options.type] 默认正文 fragment（**块级**，见文件头坑 1）；
 *   字符级锚点请显式传承载文本的 `Y.XmlText`，或用 `encode(index, type)` 逐个指定。
 */
export function createCommentAnchors(options = {}) {
  const { ydoc } = options
  if (!ydoc || typeof ydoc.get !== 'function') {
    throw new TypeError('createCommentAnchors 需要真实的 Y.Doc')
  }
  const defaultType = options.type || ydoc.getXmlFragment(COLLAB_CONTENT_FIELD)
  return {
    /** 绝对 index → 可编码的相对位置（落库的是它，不是数字）。 */
    encode(index, type) {
      return Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(type || defaultType, index))
    },
    /** 相对位置 → 当前绝对位置 `{ type, index }`；`null` = 解不出来。 */
    decode(encoded) {
      if (!encoded) return null
      const absolute = Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(encoded), ydoc)
      return absolute ? { type: absolute.type, index: absolute.index } : null
    },
  }
}

/** 纯对象锚点：拿不到 Y 坐标时的降级形态，块级锚定仍然成立。 */
function plainAnchor(blockId, offset, length) {
  return { blockId, offset, length }
}

/**
 * 把 `core/comments` 的锚点 codec 注入点接到 Yjs。
 *
 * 返回的 codec 符合 `createAnchorCodec` 的契约（`encode` / `decode` 成对），
 * 可以直接传给 `encodeAnchor(anchor, codec)` / `decodeAnchor(payload, codec)`。
 *
 * @param {object} options
 * @param {import('yjs').Doc} [options.ydoc] 与 `anchors` 二选一
 * @param {ReturnType<typeof createCommentAnchors>} [options.anchors] 现成的编解码器
 * @param {(anchor: { blockId: string, offset: number, length: number }) =>
 *          { type: Y.AbstractType<any>, index: number } | null} [options.resolve]
 *   块内锚点 → **字符所在 type + 该 type 内的 index**。返回 null 表示这个块当前不在正文里。
 * @param {({ type: Y.AbstractType<any>, index: number }) =>
 *          { blockId: string, offset: number } | null} [options.locate]
 *   Y 位置 → 块内锚点。给了它，锚点才能在并发插入后精确回位；
 *   不给则退回「块还在、offset 用原值」——比失联好，但不保证落在原词上。
 * @returns {{ encode: Function, decode: Function }}
 */
export function createYjsAnchorCodec(options = {}) {
  const { ydoc, anchors, resolve, locate } = options
  const engine = anchors || createCommentAnchors({ ydoc, type: options.type })

  return {
    /**
     * 写路径。`resolve` 解不出坐标时**不抛**，退化成纯对象：
     * 块可能是刚插入还没同步、也可能在协同 fragment 之外，此时块级锚定仍成立，
     * 而抛错会让「加一条评论」这个动作整体失败 —— 不值得。
     */
    encode(anchor) {
      const base = plainAnchor(anchor.blockId, anchor.offset, anchor.length)
      const position = typeof resolve === 'function' ? resolve(base) : null
      if (!position || !position.type || !Number.isInteger(position.index) || position.index < 0) return base
      const { type, index } = position
      return {
        kind: 'y',
        blockId: base.blockId,
        offset: base.offset,
        length: base.length,
        from: engine.encode(index, type),
        to: engine.encode(index + base.length, type),
      }
    },

    /**
     * 读路径。返回 null 的语义与 core 一致：**解不出来就当失联**，由调用方显示
     * 「原引用已删除」。这里不猜、不吸附到相邻块 —— 把甲段落的回复挂到乙段落上，
     * 比明说失联难查得多（core/comments/anchor.js 文件头同一条口径）。
     *
     * 失联的两种来源：① yjs 解不出位置；② 位置能解出来但宿主 `locate` 说块没了
     * （坑 2：删除场景只能靠 ②，yjs 自己不会报）。
     */
    decode(payload) {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
      if (payload.kind !== 'y') {
        // 旧数据 / 降级产物：没有相对位置，按纯对象回读。
        if (typeof payload.blockId !== 'string' || !payload.blockId) return null
        return plainAnchor(payload.blockId, Number(payload.offset) || 0, Number(payload.length) || 0)
      }
      const start = engine.decode(payload.from)
      const end = engine.decode(payload.to)
      if (!start) return null
      // 长度优先用两个相对位置解出来的差：并发插入后原 length 已经不代表原选区。
      const length = end && end.type === start.type
        ? Math.max(0, end.index - start.index)
        : Number(payload.length) || 0
      if (typeof locate !== 'function') {
        return plainAnchor(payload.blockId, Number(payload.offset) || 0, length)
      }
      const at = locate(start)
      if (!at || !at.blockId) return null
      return plainAnchor(at.blockId, Number(at.offset) || 0, length)
    },
  }
}
