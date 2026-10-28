/**
 * 评论锚点的 Yjs 接缝（P6b / 09 §710）。
 *
 * 只验一件事：**并发插入后锚点还指在原词上**。绝对坐标会在别人插字后指偏，
 * 相对位置不会 —— 这条如果退化，评论会静默挂到错误的词上，比报错难查得多。
 */
import { describe, it, expect } from 'vitest'
import * as Y from 'yjs'
import { createCommentAnchors, createYjsAnchorCodec } from '../../src/collab/anchors'
import { createAnchorCodec, encodeAnchor, decodeAnchor } from '../../src/core/comments/anchor'
import { COLLAB_CONTENT_FIELD } from '../../src/collab/protocol'

/**
 * 一个够用的「假正文」：fragment 里每个块是一个 Y.XmlText，块内字符偏移能翻译成
 * `{ type, index }`。真实场景里这对解析器由编辑器侧提供（posAtBlockId 一类），
 * 这里只保证坐标系一致 —— **index 必须是 type 内的字符序，不是顶层块序**（见 anchors.js 坑 1）。
 */
function createBody(blocks) {
  const ydoc = new Y.Doc({ gc: false })
  const fragment = ydoc.getXmlFragment(COLLAB_CONTENT_FIELD)
  const layout = []
  blocks.forEach(({ blockId, text }) => {
    const type = new Y.XmlText()
    type.insert(0, text)
    fragment.push([type])
    layout.push({ blockId, type })
  })
  const resolve = (anchor) => {
    const block = layout.find((item) => item.blockId === anchor.blockId)
    return block ? { type: block.type, index: anchor.offset } : null
  }
  const locate = ({ type, index }) => {
    // 真实宿主会查「当前文档里的块索引」，块被删了就查不到 —— 这里必须同样先确认
    // type 还在 fragment 里，否则 layout 数组一直持有引用，删除场景就测不出来。
    const alive = fragment.toArray().includes(type)
    if (!alive) return null
    const block = layout.find((item) => item.type === type)
    return block ? { blockId: block.blockId, offset: index } : null
  }
  return { ydoc, fragment, layout, resolve, locate }
}

describe('P6b 评论锚点 · Yjs 相对位置', () => {
  it('字符级 type 上，别人在前面插入后仍解回同一个词', () => {
    const { ydoc, fragment } = createBody([{ blockId: 'b1', text: 'hello world' }])
    const anchors = createCommentAnchors({ ydoc, type: fragment.get(0) })
    const encoded = anchors.encode(6) // 'world' 的 w

    fragment.get(0).insert(0, 'abcde')

    expect(anchors.decode(encoded)).toMatchObject({ index: 11 })
  })

  it('codec 接进 core 的注入点：encode/decode 往返不丢锚点', () => {
    const { ydoc, resolve, locate } = createBody([{ blockId: 'b1', text: 'hello world' }])
    const codec = createAnchorCodec(createYjsAnchorCodec({ ydoc, resolve, locate }))
    const payload = encodeAnchor({ blockId: 'b1', offset: 6, length: 5 }, codec)
    expect(decodeAnchor(payload, codec)).toEqual({ blockId: 'b1', offset: 6, length: 5 })
  })

  it('块内并发插入后，offset 跟着内容走而不是停在旧数字上', () => {
    const { ydoc, fragment, resolve, locate } = createBody([{ blockId: 'b1', text: 'hello world' }])
    const codec = createAnchorCodec(createYjsAnchorCodec({ ydoc, resolve, locate }))
    const payload = encodeAnchor({ blockId: 'b1', offset: 6, length: 5 }, codec)

    fragment.get(0).insert(0, 'say ') // 在 'hello' 之前插入 4 个字符

    // 仍然落在 w 上（6 + 4），不是原来的 6。
    expect(decodeAnchor(payload, codec)).toEqual({ blockId: 'b1', offset: 10, length: 5 })
  })

  it('跨块插入不影响后面块的锚点（块序变了，字符序没变）', () => {
    const { ydoc, fragment, resolve, locate } = createBody([
      { blockId: 'b1', text: 'hello' },
      { blockId: 'b2', text: 'world' },
    ])
    const codec = createAnchorCodec(createYjsAnchorCodec({ ydoc, resolve, locate }))
    const payload = encodeAnchor({ blockId: 'b2', offset: 0, length: 5 }, codec)

    // 在 b1 前插一个新块：顶层块序整体后移，但 b2 的字符锚点不动。
    const inserted = new Y.XmlText()
    inserted.insert(0, 'new')
    fragment.insert(0, [inserted])

    expect(decodeAnchor(payload, codec)).toEqual({ blockId: 'b2', offset: 0, length: 5 })
  })

  it('承载文本的块被整体删除 → locate 解不出 → codec 返回 null（不吸附相邻块）', () => {
    const { ydoc, fragment, resolve, locate } = createBody([
      { blockId: 'b1', text: 'hello' },
      { blockId: 'b2', text: 'world' },
    ])
    const codec = createAnchorCodec(createYjsAnchorCodec({ ydoc, resolve, locate }))
    const payload = encodeAnchor({ blockId: 'b1', offset: 0, length: 5 }, codec)

    const removed = layout0(fragment)
    expect(removed).toBeTruthy()

    // yjs 自己不会因为删除而返回 null（gc:false 的 tombstone 还在），
    // 失联只能由宿主 locate 判定 —— 这正是这条用例要锁住的口径。
    expect(decodeAnchor(payload, codec)).toBeNull()
  })

  /** 删掉第 0 个顶层节点，并返回被删掉的 type。 */
  function layout0(fragment) {
    const target = fragment.get(0)
    fragment.delete(0, 1)
    return target
  }

  it('resolve 解不出坐标时降级为纯对象锚点，不让「加评论」整体失败', () => {
    const { ydoc } = createBody([])
    const codec = createAnchorCodec(createYjsAnchorCodec({ ydoc, resolve: () => null }))
    const payload = encodeAnchor({ blockId: 'b1', offset: 0, length: 3 }, codec)

    expect(payload).toEqual({ blockId: 'b1', offset: 0, length: 3 })
    expect(decodeAnchor(payload, codec)).toEqual({ blockId: 'b1', offset: 0, length: 3 })
  })

  it('旧数据 / 降级产物（无 kind 标记）按纯对象回读', () => {
    const { ydoc, resolve, locate } = createBody([{ blockId: 'b1', text: 'hello' }])
    const codec = createAnchorCodec(createYjsAnchorCodec({ ydoc, resolve, locate }))
    expect(decodeAnchor({ blockId: 'b1', offset: 2, length: 3 }, codec)).toEqual({ blockId: 'b1', offset: 2, length: 3 })
  })

  it('没有 ydoc 也没有 anchors 时报错，不静默产出无效 codec', () => {
    expect(() => createYjsAnchorCodec({})).toThrow(/Y\.Doc/)
  })
})
