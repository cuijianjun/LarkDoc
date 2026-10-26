/**
 * 评论锚点 —— requirements/04 §3.1⑥、05 §5.5「Anchor」、02 §1（blockId 格式）。
 *
 * 锚点只由 `{ blockId, offset, length }` 组成：blockId 是块的身份，offset / length 是
 * **块内相对偏移**。04 §3.1⑥ 与 05 §5.5 都写明「不用 ProseMirror from/to」——全文坐标在
 * 任意一次编辑后就指向别人，而 blockId 跟着块走。
 *
 * 块被删时只降级成 unbound，**绝不就近吸附**：05 §5.5 把 blockId 定为身份主键，
 * 指到相邻块会把甲段落的回复挂到乙段落上，这种错误比「失联、请重新锚定」难查得多。
 * 所以本文件没有、也不该有 snap / nearest 之类的兜底函数。
 *
 * 持久化编码由宿主注入（协同场景要换成 Yjs RelativePosition 一类的 codec）。默认 codec
 * 只做无依赖的对象搬运，够单机与单测用；编码结果是否 stringify 由宿主决定。
 *
 * 待定：offset / length 是否越界只能由宿主按块文本长度判断（本层拿不到块文本），
 * 越界不等于失联——仍算 bound，避免把「块还在、只是文本变短」误报成删除。
 */

const BLOCK_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

/** 02 §1：blockId 格式 `/^[A-Za-z0-9_-]{1,64}$/`，与 `data-block-id` 的解析口径同源。 */
export function isValidBlockId(value) {
  return typeof value === 'string' && BLOCK_ID_PATTERN.test(value.trim())
}

function toOffset(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

/**
 * 读路径：把服务端 / 旧快照里的锚点收敛成 `{ blockId, offset, length }`。
 * 认 05 §5.5 的 `from` / `to` 写法（`length = to - from`），脏值一律落到零值。
 */
export function normalizeAnchor(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { blockId: '', offset: 0, length: 0 }
  }
  const blockId = typeof raw.blockId === 'string' ? raw.blockId.trim() : ''
  const offset = toOffset(raw.offset != null ? raw.offset : raw.from)
  const length = raw.length != null ? toOffset(raw.length) : Math.max(0, toOffset(raw.to) - offset)
  return { blockId, offset, length }
}

/**
 * 写路径：三重校验后返回规范锚点。
 * 这里直接读原始字段而不用 normalizeAnchor：后者会把 1.5 取整成 1，校验就失去意义。
 */
export function validateAnchor(anchor) {
  if (!anchor || typeof anchor !== 'object' || Array.isArray(anchor)) {
    throw new Error('评论锚点必须是对象')
  }
  if (!isValidBlockId(anchor.blockId)) {
    throw new Error(`评论锚点 blockId 不合法：${anchor.blockId || '(空)'}`)
  }
  if (!Number.isInteger(anchor.offset) || anchor.offset < 0) {
    throw new Error('评论锚点 offset 必须是非负整数')
  }
  if (!Number.isInteger(anchor.length) || anchor.length < 0) {
    throw new Error('评论锚点 length 必须是非负整数')
  }
  return { blockId: anchor.blockId.trim(), offset: anchor.offset, length: anchor.length }
}

/** 注入点：codec 必须同时能 encode / decode，否则宁可在这里就报错。 */
export function createAnchorCodec(codec) {
  if (!codec || typeof codec.encode !== 'function' || typeof codec.decode !== 'function') {
    throw new Error('锚点 codec 必须同时提供 encode 与 decode')
  }
  return codec
}

/** 默认 codec：纯对象搬运，不带任何位置语义，换 Yjs 时整块替换。 */
export const plainAnchorCodec = {
  encode: (anchor) => ({ blockId: anchor.blockId, offset: anchor.offset, length: anchor.length }),
  decode: (payload) => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
    return { blockId: payload.blockId, offset: payload.offset, length: payload.length }
  },
}

function resolveCodec(codec) {
  return codec == null ? plainAnchorCodec : createAnchorCodec(codec)
}

/** 写路径：校验不过就抛（持久化坏数据比丢一条评论更难修）。 */
export function encodeAnchor(anchor, codec) {
  return resolveCodec(codec).encode(validateAnchor(anchor))
}

/**
 * 读路径：codec 自己解不出（协同里块已被远端删除）或解出的形状不对，一律返回 null，
 * 由调用方当 unbound 处理；不让一条坏锚点打断整个面板的渲染。
 */
export function decodeAnchor(payload, codec) {
  if (payload == null) return null
  const target = resolveCodec(codec)
  let decoded
  try {
    decoded = target.decode(payload)
  } catch (error) {
    return null
  }
  const anchor = normalizeAnchor(decoded)
  return anchor.blockId ? anchor : null
}

/**
 * 文档里的 blockId 集合。支持 Set / Map / 数组 / 纯对象 / 判定函数：
 * 调用方手里有什么就用什么，避免为了判联先建一遍索引。
 */
export function blockIdLookup(source) {
  if (typeof source === 'function') return (blockId) => Boolean(source(blockId))
  if (source instanceof Set || source instanceof Map) return (blockId) => source.has(blockId)
  if (Array.isArray(source)) {
    const ids = new Set(source)
    return (blockId) => ids.has(blockId)
  }
  if (source && typeof source === 'object') {
    return (blockId) => Object.prototype.hasOwnProperty.call(source, blockId)
  }
  return () => false
}

/**
 * 单个锚点的联与失联。`anchor` 原样回传（只做归一化，不改 blockId），
 * 让上层既能拿到判定又能保留「原引用块」用于展示。
 */
export function anchorBinding(anchor, source) {
  const value = normalizeAnchor(anchor)
  if (!value.blockId) return { anchor: value, bound: false, reason: 'invalid-anchor' }
  if (!blockIdLookup(source)(value.blockId)) {
    return { anchor: value, bound: false, reason: 'missing-block' }
  }
  return { anchor: value, bound: true, reason: 'ok' }
}

/**
 * 给线程补上派生字段 `bound` / `anchorReason`（不持久化，也不回写线程模型）。
 * offset 越界不参与判定，见文件头。
 */
export function withAnchorBinding(thread, source) {
  const target = thread || {}
  const binding = anchorBinding(target.anchor || { blockId: target.blockId }, source)
  return { ...target, anchor: binding.anchor, bound: binding.bound, anchorReason: binding.reason }
}

/** 面板要的只有两堆：能画高亮的、以及只能显示「原引用已失联」的。 */
export function partitionThreads(threads, source) {
  const bound = []
  const unbound = []
  const list = threads || []
  list.forEach((thread) => {
    const item = withAnchorBinding(thread, source)
    if (item.bound) bound.push(item)
    else unbound.push(item)
  })
  return { bound, unbound }
}
