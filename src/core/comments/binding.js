/**
 * 评论锚点的**编辑器绑定层**（P6b-01）—— requirements/04 §3.1⑥、05 §5.5。
 *
 * 为什么单独开一个文件：`core/comments/anchor.js` 是**纯数据**的（只判 blockId 在不在
 * 集合里），它拿不到编辑器；而「当前文档里究竟有哪些块」只有编辑器知道。这一层就是把
 * 两者接起来 —— 补文件，**不改** `anchor.js` 的既有语义。
 *
 * 三条必须守住的口径：
 *   1. **core 不 import yjs**。`src/collab/anchors.js` 文件头第 20 行写死了这条边界
 *      （yjs 是 optional peer，进 core 依赖闭包会让不带协同的宿主也背上这个包）。所以
 *      yjs codec 由协同侧以**工厂函数**形式注入（`options.createYjsCodec`），本文件只做
 *      「探测协同态 + 拿不到就退回 plain」。
 *   2. **块没了只降级 unbound，绝不就近吸附**。把甲段落的回复挂到乙段落上，比明说
 *      「原引用已删除」难查得多 —— 本文件没有、也不该有 snap / nearest。
 *   3. **codec 只翻译持久化形态，不参与 bound 判定**。bound 只看 blockId 在不在当前文档
 *      的块集合里；offset 越界仍算 bound（见 `anchor.js` 文件头「待定」）。
 *
 * 负结论（别实现）：
 *   - 「解不出锚点时用相邻的块 id 兜底」：同上第 2 条，禁止。
 *   - 「把 from / to 全文坐标写回线程」：05 §5.5⑥ 明确不用 ProseMirror from/to，
 *     本层输出的 `anchor` 恒为 `{ blockId, offset, length }`。
 *   - 「探测不到 y-sync 插件就抛错」：单机模式是合法路径（collabMixin 里 `collab` 缺省
 *     为 null），退回 plain codec 即可。
 */

import {
  blockIdLookup,
  createAnchorCodec,
  decodeAnchor,
  plainAnchorCodec,
  withAnchorBinding,
} from './anchor'
import { normalizeThread } from './thread'

/**
 * 从 ProseMirror 文档里抽出 blockId 集合。
 *
 * blockId 是节点 attr（`core/blocks/block-id.js` 的全局属性），只有「用户能当作一个块
 * 操作」的节点才有 —— 结构性容器（listItem / tableRow …）不编号，故这里只收集非空值。
 */
export function documentBlockIds(doc) {
  const ids = new Set()
  if (!doc || typeof doc.descendants !== 'function') return ids
  doc.descendants((node) => {
    const id = node.attrs && typeof node.attrs.blockId === 'string' ? node.attrs.blockId.trim() : ''
    if (id) ids.add(id)
  })
  return ids
}

function isDoc(doc) {
  return Boolean(doc && typeof doc.get === 'function')
}

/**
 * 探测协同态的 Y.Doc；单机模式返回 null（**不 import 任何协同包**）。
 *
 * 只认 y-sync 插件：它是 y-prosemirror 唯一把 `Y.Doc` 挂在 ProseMirror state 上的位置
 * （`binding.doc` / `type.doc` 二选一，两个版本都兼容）。别的插件碰巧有 `.doc` 也不该被
 * 当成协同文档。
 */
export function collabYdocOf(editor) {
  if (!editor) return null
  const state = editor.state || (editor.view && editor.view.state)
  const plugins = state && Array.isArray(state.plugins) ? state.plugins : []
  for (let i = 0; i < plugins.length; i += 1) {
    const spec = plugins[i].spec || {}
    const key = spec.key ? String(spec.key.key || spec.key) : ''
    if (key.indexOf('y-sync') === -1) continue
    let pluginState = null
    try {
      pluginState = plugins[i].getState(state)
    } catch (error) {
      pluginState = null
    }
    if (!pluginState) continue
    const binding = pluginState.binding
    const doc = (binding && binding.doc) || (pluginState.type && pluginState.type.doc) || null
    if (isDoc(doc)) return doc
  }
  return null
}

/**
 * 选锚点 codec：协同态用注入的 yjs codec，否则 plain。
 *
 * 拿不到 ydoc、没注入工厂、或工厂自身抛错，一律退回 `plainAnchorCodec` —— 一条评论的
 * 持久化形态退化成纯对象，块级锚定仍然成立，不该让「加一条评论」整体失败。
 */
export function resolveAnchorCodec(editor, options) {
  const opts = options || {}
  const factory = typeof opts.createYjsCodec === 'function' ? opts.createYjsCodec : null
  if (!factory) return plainAnchorCodec
  const ydoc = isDoc(opts.ydoc) ? opts.ydoc : collabYdocOf(editor)
  if (!ydoc) return plainAnchorCodec
  try {
    return createAnchorCodec(factory({
      ydoc,
      type: opts.type,
      resolve: opts.resolve,
      locate: opts.locate,
    }))
  } catch (error) {
    return plainAnchorCodec
  }
}

/**
 * 把一批线程按「当前文档」重新绑一遍。
 *
 * `doc` 可以是 ProseMirror 文档（最常见），也可以是 `blockIdLookup` 认的任意形态
 * （数组 / Set / 对象 / 判定函数）—— 单测与「从别处已经拿到块表」的宿主不必再建文档。
 *
 * 返回新数组，每条是原线程 + `bound` / `anchorReason`，**不改入参**（Provider 的返回值
 * 常常直接被丢进来，改了会污染缓存）。脏条目（null / 非对象）由 `normalizeThread` 过滤。
 */
export function bindThreads(doc, threads, codec) {
  const source = doc && typeof doc.descendants === 'function' ? documentBlockIds(doc) : doc
  const lookup = blockIdLookup(source)
  const list = Array.isArray(threads) ? threads : []
  const bound = []
  for (let i = 0; i < list.length; i += 1) {
    const raw = list[i]
    const thread = normalizeThread(raw)
    if (!thread) continue
    // 解一次持久化形态：plain codec 原样透传，yjs codec 把相对位置翻回块内偏移。
    const decoded = decodeAnchor(raw && raw.anchor, codec)
    const target = decoded ? { ...thread, anchor: decoded } : thread
    bound.push(withAnchorBinding(target, lookup))
  }
  return bound
}
