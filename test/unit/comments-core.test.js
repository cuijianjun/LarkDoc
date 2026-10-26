/**
 * P6b-01 评论数据层 —— requirements/09 §5.8（任务单）、04 §3.1（面板要什么数据）、
 * 05 §5.5（Thread / Comment / Anchor 契约）、02 §1（blockId 格式）。
 *
 * 这一层是纯逻辑：零 DOM、零网络、零 Vue，所以用例全部用 node 环境，不挂 jsdom。
 * 四条主线与四个实现文件一一对应：
 *   1. `thread.js` —— 读路径宽容（脏数据不抛）/ 写路径严格（空内容、缺作者必抛）。
 *   2. `anchor.js` —— blockId + 块内偏移的编解码；块被删只降级 unbound，不吸附到别块。
 *   3. `state.js`  —— resolve / reopen 幂等迁移、未读、未解决优先 + createdAt 升序。
 *   4. `memory-provider.js` —— 五方法内存实现，必须能过 `createCommentsProvider` 校验。
 *
 * 断言里刻意区分「05 的命名」与「任务单的命名」：读路径要认 status/comments/from-to，
 * 写路径输出 resolved/replies/offset-length；这条差异写进实现文件头的 待定 条目。
 */
import { describe, expect, it } from 'vitest'
import { createCommentsProvider } from '../../src/providers/comments'
import {
  ANONYMOUS_AUTHOR,
  anchorBinding,
  buildReply,
  buildThread,
  createAnchorCodec,
  createMemoryCommentsProvider,
  decodeAnchor,
  encodeAnchor,
  normalizeAnchor,
  normalizeReply,
  normalizeThread,
  partitionThreads,
  reopenThread,
  resolveThread,
  sortThreads,
  unreadCount,
  validateAnchor,
  withAnchorBinding,
} from '../../src/core/comments/index'

describe('线程与回复：读路径宽容', () => {
  it('normalizeThread 对空值 / 非对象给 null，对空对象给安全默认', () => {
    expect(normalizeThread(null)).toBeNull()
    expect(normalizeThread(undefined)).toBeNull()
    expect(normalizeThread('c1')).toBeNull()
    expect(normalizeThread([])).toBeNull()

    const thread = normalizeThread({})
    expect(thread).toEqual({
      id: '',
      blockId: '',
      anchor: { blockId: '', offset: 0, length: 0 },
      quote: '',
      resolved: false,
      createdAt: 0,
      author: ANONYMOUS_AUTHOR,
      replies: [],
    })
  })

  it('normalizeThread 认 05 §5.5 的别名：status / comments / anchor.from,to / body / updatedAt', () => {
    const thread = normalizeThread({
      id: 'c1',
      blockId: 'b1',
      status: 'resolved',
      createdAt: 1000,
      anchor: { blockId: 'b1', from: 3, to: 8, text: '被引用的原文' },
      author: { id: 'u1', name: '崔' },
      comments: [
        {
          id: 'r1',
          author: { id: 'u1', name: '崔' },
          body: { type: 'doc', content: [{ type: 'text', text: '改过的正文' }] },
          createdAt: 1000,
          modify: 1,
          updatedAt: 1200,
        },
        null,
      ],
    })

    expect(thread.resolved).toBe(true)
    expect(thread.anchor).toEqual({ blockId: 'b1', offset: 3, length: 5 })
    expect(thread.quote).toBe('被引用的原文')
    expect(thread.replies).toHaveLength(1)
    expect(thread.replies[0].content).toBe('改过的正文')
    expect(thread.replies[0].editedAt).toBe(1200)
  })

  it('blockId 以顶层为准：05 §5.5 把它列为身份主键，anchor.blockId 只是冗余副本', () => {
    const thread = normalizeThread({
      id: 'c1',
      blockId: 'b-main',
      anchor: { blockId: 'b-old', from: 1, to: 4 },
    })
    expect(thread.blockId).toBe('b-main')
    expect(thread.anchor.blockId).toBe('b-main')
  })

  it('normalizeReply 对脏值不抛，缺字段落到安全默认', () => {
    expect(normalizeReply(null)).toBeNull()
    expect(normalizeReply('回复')).toBeNull()
    expect(normalizeReply({})).toEqual({
      id: '',
      author: ANONYMOUS_AUTHOR,
      content: '',
      createdAt: 0,
      editedAt: null,
    })
    expect(normalizeReply({ author: '张三', content: '看这里' }).author.name).toBe('张三')
  })

  it('normalizeAnchor 认 from/to，脏值落到零值', () => {
    expect(normalizeAnchor({ blockId: ' b1 ', offset: 2, length: 3 }))
      .toEqual({ blockId: 'b1', offset: 2, length: 3 })
    expect(normalizeAnchor({ blockId: 'b1', from: 2, to: 6 }))
      .toEqual({ blockId: 'b1', offset: 2, length: 4 })
    expect(normalizeAnchor({ blockId: 'b1', offset: -3, length: -1 }))
      .toEqual({ blockId: 'b1', offset: 0, length: 0 })
    expect(normalizeAnchor(null)).toEqual({ blockId: '', offset: 0, length: 0 })
  })
})

describe('线程与回复：写路径严格', () => {
  it('buildThread 缺 blockId / 内容 / 作者 id 都抛', () => {
    const base = { blockId: 'b1', author: { id: 'u1' }, content: '看这里' }
    expect(() => buildThread({ ...base, blockId: '' }, { id: 'c1', replyId: 'r1' }))
      .toThrow(/blockId 不合法/)
    // 02 §1 的 blockId 只允许 [A-Za-z0-9_-]，空格不是合法字符。
    expect(() => buildThread({ ...base, blockId: 'b 1' }, { id: 'c1', replyId: 'r1' }))
      .toThrow(/blockId 不合法/)
    expect(() => buildThread({ ...base, content: '   ' }, { id: 'c1', replyId: 'r1' }))
      .toThrow('首条评论内容不能为空')
    expect(() => buildThread({ ...base, author: { name: '崔' } }, { id: 'c1', replyId: 'r1' }))
      .toThrow(/作者 id/)
  })

  it('buildReply 拒绝空白内容与匿名作者', () => {
    expect(() => buildReply({ author: { id: 'u1' }, content: ' \n ' }, { id: 'r1' }))
      .toThrow('回复内容不能为空')
    expect(() => buildReply({ author: { id: '' }, content: '有内容' }, { id: 'r1' }))
      .toThrow(/作者 id/)
  })

  it('buildThread 一次产出线程 + 首条回复（05 §5.5：至少 1 条，首条即发起评论）', () => {
    const thread = buildThread(
      { blockId: 'b1', quote: '原文', author: { id: 'u1', name: '崔' }, content: '看看这里' },
      { id: 'c1', replyId: 'r1', now: 1000 },
    )
    expect(thread).toEqual({
      id: 'c1',
      blockId: 'b1',
      anchor: { blockId: 'b1', offset: 0, length: 0 },
      quote: '原文',
      resolved: false,
      createdAt: 1000,
      author: { id: 'u1', name: '崔', avatarUrl: '', color: '' },
      replies: [{
        id: 'r1',
        author: { id: 'u1', name: '崔', avatarUrl: '', color: '' },
        content: '看看这里',
        createdAt: 1000,
        editedAt: null,
      }],
    })
  })

  it('buildThread 带锚点时校验偏移，并把 blockId 同步进 anchor', () => {
    const thread = buildThread(
      { blockId: 'b1', anchor: { blockId: 'b1', offset: 4, length: 6 }, author: { id: 'u1' }, content: 'x' },
      { id: 'c1', replyId: 'r1', now: 1 },
    )
    expect(thread.anchor).toEqual({ blockId: 'b1', offset: 4, length: 6 })
    expect(() => validateAnchor({ blockId: 'b1', offset: 1.5, length: 1 }))
      .toThrow(/offset 必须是非负整数/)
    expect(() => validateAnchor({ blockId: 'b1', offset: 0, length: -1 }))
      .toThrow(/length 必须是非负整数/)
    expect(() => validateAnchor({ blockId: '', offset: 0, length: 0 }))
      .toThrow(/blockId 不合法/)
  })
})

describe('锚点：持久化编码与失联判定', () => {
  it('默认 codec 往返一致，decode 对垃圾返回 null', () => {
    const anchor = { blockId: 'b1', offset: 4, length: 6 }
    expect(decodeAnchor(encodeAnchor(anchor))).toEqual(anchor)
    expect(decodeAnchor(null)).toBeNull()
    expect(decodeAnchor('b1:0:1')).toBeNull()
    expect(decodeAnchor({ blockId: '', offset: 0, length: 0 })).toBeNull()
  })

  it('codec 可注入（协同场景换成 Yjs 相对位置），encode/decode 走注入实现', () => {
    const seen = []
    const codec = {
      encode: (anchor) => {
        seen.push(anchor)
        return `a|${anchor.blockId}|${anchor.offset}|${anchor.length}`
      },
      decode: (payload) => {
        const [tag, blockId, offset, length] = String(payload).split('|')
        return tag === 'a' ? { blockId, offset: Number(offset), length: Number(length) } : null
      },
    }
    const payload = encodeAnchor({ blockId: 'b9', offset: 2, length: 3 }, codec)
    expect(payload).toBe('a|b9|2|3')
    expect(decodeAnchor(payload, codec)).toEqual({ blockId: 'b9', offset: 2, length: 3 })
    expect(seen).toEqual([{ blockId: 'b9', offset: 2, length: 3 }])
    expect(() => createAnchorCodec({ encode: () => '' })).toThrow(/encode 与 decode/)
    // codec 自己解不出（块被远端删）时按失联处理，不抛给面板。
    expect(decodeAnchor('x', { encode: () => '', decode: () => { throw new Error('stale') } })).toBeNull()
  })

  it('块被删 → unbound，且 blockId 原样保留，不就近吸附到别的块', () => {
    const threads = [
      { id: 'c1', blockId: 'b1', anchor: { blockId: 'b1', offset: 0, length: 0 } },
      { id: 'c2', blockId: 'b-gone', anchor: { blockId: 'b-gone', offset: 0, length: 4 } },
    ]
    const { bound, unbound } = partitionThreads(threads, ['b1', 'b2'])
    expect(bound.map((thread) => thread.id)).toEqual(['c1'])
    expect(unbound.map((thread) => thread.id)).toEqual(['c2'])
    expect(unbound[0].anchor.blockId).toBe('b-gone')
    expect(unbound[0].bound).toBe(false)
    expect(unbound[0].anchorReason).toBe('missing-block')
  })

  it('文档 blockId 集合支持 Set / 函数 / 纯对象；空 blockId 归为 invalid-anchor', () => {
    const thread = { id: 'c1', blockId: 'b1', anchor: { blockId: 'b1', offset: 0, length: 0 } }
    expect(withAnchorBinding(thread, new Set(['b1'])).bound).toBe(true)
    expect(withAnchorBinding(thread, (blockId) => blockId === 'b1').bound).toBe(true)
    expect(withAnchorBinding(thread, { b1: true }).bound).toBe(true)
    expect(withAnchorBinding(thread, ['b2']).bound).toBe(false)
    expect(anchorBinding({ blockId: '' }, ['b1']).reason).toBe('invalid-anchor')
  })
})

describe('状态机：resolve / reopen 幂等', () => {
  it('关→开→关的迁移不改原对象，重复操作返回同一引用', () => {
    const open = { id: 'c1', resolved: false }
    const resolved = resolveThread(open)
    expect(resolved).not.toBe(open)
    expect(open.resolved).toBe(false)
    expect(resolved.resolved).toBe(true)
    // 05 §5.5.1「保留幂等失败态」+ 04 §3.1 没有重复操作的错误文案 → 不抛、返回原值。
    expect(resolveThread(resolved)).toBe(resolved)

    const reopened = reopenThread(resolved)
    expect(reopened.resolved).toBe(false)
    expect(reopenThread(open)).toBe(open)
    expect(resolveThread(null)).toBeNull()
    expect(reopenThread(null)).toBeNull()
  })

  it('未解决在前，组内 createdAt 升序，同毫秒按 id 兜底（确定性）', () => {
    const source = [
      { id: 'c3', resolved: false, createdAt: 300 },
      { id: 'c2', resolved: true, createdAt: 100 },
      { id: 'c1', resolved: false, createdAt: 100 },
      { id: 'c0', resolved: false, createdAt: 100 },
    ]
    expect(sortThreads(source).map((thread) => thread.id)).toEqual(['c0', 'c1', 'c3', 'c2'])
    // 不改入参。
    expect(source.map((thread) => thread.id)).toEqual(['c3', 'c2', 'c1', 'c0'])
  })

  it('unreadCount 只算「未解决且未读」，readIds 支持数组与 Set', () => {
    const threads = [
      { id: 'c1', resolved: false },
      { id: 'c2', resolved: false },
      { id: 'c3', resolved: true },
    ]
    expect(unreadCount(threads, ['c1'])).toBe(1)
    expect(unreadCount(threads, new Set(['c1', 'c2']))).toBe(0)
    expect(unreadCount(threads)).toBe(2)
    expect(unreadCount(null, ['c1'])).toBe(0)
  })
})

describe('内存 Provider：五方法契约', () => {
  it('createCommentsProvider 校验通过；缺一个方法就抛', () => {
    const provider = createMemoryCommentsProvider()
    expect(() => createCommentsProvider(provider)).not.toThrow()

    delete provider.reply
    expect(() => createCommentsProvider(provider)).toThrow('comments Provider 缺少方法：reply')
  })

  it('增 / 回复 / 解决 / 重开闭环，list 顺序随状态变化', async () => {
    let tick = 0
    const provider = createMemoryCommentsProvider({ now: () => (tick += 100) })
    const first = await provider.createThread({
      blockId: 'b1', quote: '引用', author: { id: 'u1', name: '崔' }, content: '第一',
    })
    const second = await provider.createThread({
      blockId: 'b2', author: { id: 'u1', name: '崔' }, content: '第二',
    })

    expect(first.createdAt).toBe(100)
    expect(first.replies).toHaveLength(1)
    expect(first.replies[0].createdAt).toBe(100)

    const reply = await provider.reply({ threadId: first.id, author: { id: 'u2', name: '李' }, content: '回复' })
    expect(reply.content).toBe('回复')
    expect(reply.createdAt).toBe(300)

    let listed = await provider.list()
    expect(listed.map((thread) => thread.id)).toEqual([first.id, second.id])
    expect(listed[0].replies).toHaveLength(2)

    const resolved = await provider.resolve(first.id)
    expect(resolved.resolved).toBe(true)
    expect((await provider.resolve(first.id)).resolved).toBe(true)

    listed = await provider.list()
    expect(listed.map((thread) => thread.id)).toEqual([second.id, first.id])
    expect(listed[1].resolved).toBe(true)

    await provider.reopen(first.id)
    listed = await provider.list()
    expect(listed.map((thread) => thread.id)).toEqual([first.id, second.id])
    expect(listed[0].resolved).toBe(false)
  })

  it('list 顺序确定：同一 createdAt 也能稳定复现', async () => {
    const provider = createMemoryCommentsProvider({
      threads: [
        { id: 'c2', blockId: 'b2', createdAt: 500, anchor: { blockId: 'b2', offset: 0, length: 0 } },
        { id: 'c1', blockId: 'b1', createdAt: 500, anchor: { blockId: 'b1', offset: 0, length: 0 } },
        { id: 'c0', blockId: 'b0', createdAt: 100, anchor: { blockId: 'b0', offset: 0, length: 0 } },
      ],
    })
    const first = (await provider.list()).map((thread) => thread.id)
    expect(first).toEqual(['c0', 'c1', 'c2'])
    expect((await provider.list()).map((thread) => thread.id)).toEqual(first)
  })

  it('返回的是拷贝：外部改数组 / 线程都不会污染内部存储', async () => {
    const provider = createMemoryCommentsProvider({ now: () => 1000 })
    const created = await provider.createThread({
      blockId: 'b1', author: { id: 'u1' }, content: '原文',
    })
    created.replies.push({ id: 'hack', author: { id: 'x' }, content: 'hack', createdAt: 0, editedAt: null })
    created.resolved = true

    const listed = await provider.list()
    expect(listed[0].replies).toHaveLength(1)
    expect(listed[0].resolved).toBe(false)

    listed[0].replies[0].content = '被外部改了'
    expect((await provider.list())[0].replies[0].content).toBe('原文')
  })

  it('未知线程 id 一律抛可定位错误', async () => {
    const provider = createMemoryCommentsProvider()
    await expect(provider.reply({ threadId: 'nope', author: { id: 'u1' }, content: 'x' }))
      .rejects.toThrow('评论线程不存在：nope')
    await expect(provider.resolve('nope')).rejects.toThrow(/评论线程不存在/)
    await expect(provider.reopen('nope')).rejects.toThrow(/评论线程不存在/)
  })
})
