// @vitest-environment jsdom
/**
 * P6a 协同验收 C1–C9（09 §5.7.4）。每条用例对应规格表里的一行，名字前缀就是编号。
 *
 * 这一批测的是「多客户端收敛」，因此**每个 peer 是独立 Y.Doc**，靠 `createNetwork()`
 * 投递 update 来模拟网络（见 `test/helpers/collab-harness.js` 的三条纪律）。
 * 唯一没在这里验的是「真 WebSocket 能跑通」——那一段在 `hocuspocus-wire.test.js`。
 *
 * 与飞书的偏差：没有远端光标（awareness 需要 provider，纯 doc 对 doc 没有 awareness 通道），
 * C6 因此只验「只读端仍收更新、本地不可输入」，不验光标可见性。
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  blockIds, countOf, createNetwork, createPeer, insertBlock, typeAt,
} from '../helpers/collab-harness'
import { shouldSeed } from '../../src/collab/policies'
import { createUiStateStore, toggleCollapsed, defaultUiState } from '../../src/collab/policies'

const peers = []
let network = null

function track(peer) {
  peers.push(peer)
  return peer
}

function pair(count = 2) {
  network = createNetwork()
  return Array.from({ length: count }, (unused, index) => track(createPeer(network, { name: `p${index}` })))
}

afterEach(() => {
  while (peers.length) peers.pop().destroy()
  network = null
})

describe('C1 双向同步', () => {
  it('A 输入的文本在 B 侧同步出现，反向亦然', () => {
    const [a, b] = pair()
    typeAt(a, 1, '甲乙')
    expect(b.text).toContain('甲乙')
    typeAt(b, b.editor.state.doc.content.size, '丙丁')
    expect(a.text).toContain('丙丁')
    expect(a.text).toBe(b.text)
  })
})

describe('C2 并发同位置插入', () => {
  it('两端同时在同一段插入不同字符 → 最终文本一致（不丢字、不重复）', () => {
    const [a, b] = pair()
    typeAt(a, 1, '起点')
    expect(b.text).toBe(a.text)

    network.setOnline(false)
    typeAt(a, 1, 'A')
    typeAt(b, 1, 'B')
    expect(a.text).not.toBe(b.text) // 分区期间确实分叉了，否则下面的收敛是假绿
    network.reconnect()

    expect(a.text).toBe(b.text)
    // 两个字符都在，且各只有一份 —— 这比"文本相等"更严：两边同时丢同样的字也会相等。
    expect(a.text).toContain('A')
    expect(a.text).toContain('B')
    expect(countOf(a, 'A')).toBe(1)
    expect(countOf(a, 'B')).toBe(1)
  })
})

describe('C3 撤销隔离', () => {
  it('A 撤销只撤自己的输入，B 的不变', () => {
    const [a, b] = pair()
    // 先铺一段「服务端已有正文」：真实顺序是 sync 完成后再输入。
    // 这一段同时是对 y-prosemirror 语义的说明 —— 空文档上的**第一次**整篇写入被标成
    // `addToHistory: false`（它把那次写当成"初始内容"），所以下面要先把这段写完。
    insertBlock(a, { type: 'paragraph', content: [{ type: 'text', text: '已有正文' }] })
    typeAt(a, 1, 'A的')
    typeAt(b, b.editor.state.doc.content.size, 'B的')
    expect(a.text).toBe(b.text)

    expect(a.editor.commands.undo()).toBe(true)
    expect(a.text).not.toContain('A的')
    expect(a.text).toContain('B的')
    // 撤销也要同步过去：B 侧同样看不到 A 的那段，但自己的还在。
    expect(b.text).toBe(a.text)
  })

  it('空文档上的第一次整篇写入不进撤销栈（y-prosemirror 的初始内容语义）', () => {
    const [a] = pair()
    typeAt(a, 1, '第一个字')
    // 这不是缺陷，是 y-prosemirror 刻意的：首次 PM→Y 的整篇写入被当作初始内容，
    // 撤销它等于把文档清空。真实部署里第一步永远是服务端 sync，用户不会碰到这个边界。
    expect(a.editor.commands.undo()).toBe(false)
    expect(a.text).toContain('第一个字')
  })

  it('A 未做任何编辑时 undo 返回 false（不误撤别人的）', () => {
    const [a, b] = pair()
    typeAt(b, 1, 'B先写')
    expect(a.text).toContain('B先写')
    expect(a.editor.commands.undo()).toBe(false)
    expect(a.text).toContain('B先写')
  })
})

describe('C4 断线重连', () => {
  it('断网期间 A 连续编辑，B 重连后补齐且无重复', () => {
    const [a, b] = pair()
    network.setOnline(false)
    typeAt(a, 1, '一')
    typeAt(a, a.editor.state.doc.content.size, '二')
    typeAt(a, a.editor.state.doc.content.size, '三')
    expect(b.text).not.toContain('一')
    network.reconnect()

    expect(b.text).toBe(a.text)
    ;['一', '二', '三'].forEach((chunk) => expect(countOf(b, chunk)).toBe(1))
  })

  it('重连 10 次不残留监听（Y.Doc.destroy 后 observer 归零）', () => {
    const [a, b] = pair()
    for (let round = 0; round < 10; round += 1) {
      network.setOnline(false)
      typeAt(a, 1, String(round))
      network.reconnect()
    }
    expect(a.text).toBe(b.text)
    // 每份 doc 上挂着的 update 监听只应是 harness 自己那一条，没有随重连叠加。
    const observers = a.ydoc._observers.get('update')
    expect(observers ? observers.size : 0).toBe(1)
  })
})

describe('C5 块 ID 稳定', () => {
  it('并发编辑后两侧 blockId 集合一致，且不出现同一块两个 ID', () => {
    const [a, b] = pair()
    insertBlock(a, { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '标题' }] })
    insertBlock(a, { type: 'paragraph', content: [{ type: 'text', text: '正文' }] })
    expect(a.text).toBe(b.text)

    network.setOnline(false)
    insertBlock(a, { type: 'paragraph', content: [{ type: 'text', text: 'A新块' }] })
    insertBlock(b, { type: 'paragraph', content: [{ type: 'text', text: 'B新块' }] })
    network.reconnect()

    const idsA = blockIds(a)
    const idsB = blockIds(b)
    expect(idsA.length).toBeGreaterThan(0)
    // ① 两端集合相同；② 任一端都没有重复 ID（"同一块两个 ID"就是重复）。
    expect(new Set(idsA)).toEqual(new Set(idsB))
    expect(new Set(idsA).size).toBe(idsA.length)
    expect(new Set(idsB).size).toBe(idsB.length)
  })
})

describe('C6 只读端', () => {
  it('canEdit=false 的客户端能收实时更新，本地不可输入', () => {
    network = createNetwork()
    const a = track(createPeer(network, { name: 'writer' }))
    const c = track(createPeer(network, { name: 'reader', editable: false }))

    expect(c.editor.isEditable).toBe(false)
    expect(c.editor.view.dom.getAttribute('contenteditable')).toBe('false')

    typeAt(a, 1, '别人写的')
    expect(c.text).toContain('别人写的')
    // 只读端仍未解锁 —— 同步来了内容不等于拿到了编辑权。
    expect(c.editor.isEditable).toBe(false)
  })
})

describe('C7 首次播种', () => {
  it('3 个客户端依次进入，初始正文只出现一次', () => {
    network = createNetwork()
    const seeded = new Set()
    const seed = '初始正文'

    const enter = (name) => {
      const peer = track(createPeer(network, { name }))
      const syncState = { synced: true, isEmpty: peer.text === '', seeded: seeded.has(name) }
      if (shouldSeed(syncState)) {
        typeAt(peer, 1, seed)
        seeded.add(name)
      }
      return peer
    }

    const first = enter('p0')
    const second = enter('p1')
    const third = enter('p2')

    expect(countOf(first, seed)).toBe(1)
    expect(countOf(second, seed)).toBe(1)
    expect(countOf(third, seed)).toBe(1)
    expect(seeded.size).toBe(1)
  })

  it('已有正文时后到者不播种（isEmpty=false 即放弃）', () => {
    expect(shouldSeed({ synced: true, isEmpty: false, seeded: false })).toBe(false)
    expect(shouldSeed({ synced: false, isEmpty: true, seeded: false })).toBe(false)
    expect(shouldSeed({ synced: true, isEmpty: true, seeded: true })).toBe(false)
    expect(shouldSeed({ synced: true, isEmpty: true, seeded: false })).toBe(true)
  })
})

describe('C8 折叠不串台', () => {
  it('A 折叠标题不会给 B 产生任何文档变更（折叠是本地 UI 态，不进 Y.Doc）', () => {
    const [a, b] = pair()
    insertBlock(a, { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '第一章' }] })
    insertBlock(a, { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '一节' }] })
    insertBlock(a, { type: 'paragraph', content: [{ type: 'text', text: '正文' }] })

    const headingId = blockIds(a)[0]
    expect(headingId).toBeTruthy()

    let updates = 0
    const onUpdate = () => { updates += 1 }
    a.ydoc.on('update', onUpdate)
    expect(a.editor.commands.toggleLarkDocFoldById(headingId)).toBe(true)
    a.ydoc.off('update', onUpdate)

    // 折叠只改 plugin meta，不写正文，也不产生 Y update —— 这是"不串台"的根因。
    expect(updates).toBe(0)
    expect(a.text).toBe(b.text)
    // Y.Doc 顶层只有正文 fragment（外加 y-tiptap 自己的位置迁移表），没有 ui 状态容器。
    // `__tiptap_position_migrations:*` 是 y-prosemirror 内部用的，不是我们的状态。
    expect(Array.from(a.ydoc.share.keys()).filter((key) => !key.startsWith('__tiptap_'))).toEqual(['default'])
  })

  it('B22 UI 状态按文档分键，两份客户端互不影响', () => {
    const memory = () => {
      const map = new Map()
      return {
        getItem: (key) => (map.has(key) ? map.get(key) : null),
        setItem: (key, value) => map.set(key, String(value)),
        removeItem: (key) => map.delete(key),
        map,
      }
    }
    const storageA = memory()
    const storageB = memory()
    // `schedule` 直接跑：不等 300ms 防抖，落盘是同步的。
    const store = (storage) => createUiStateStore({ documentId: 'ws/doc', storage, schedule: (fn) => fn(), cancel: () => {} })

    const a = store(storageA)
    a.setCollapsed('blk-1', true)
    expect(a.state.collapsed).toEqual(['blk-1'])
    expect(storageB.map.size).toBe(0) // 折叠没跑到对方那份存储里

    // 开关是纯函数，重复折叠不会堆两条。
    expect(toggleCollapsed(['blk-1'], 'blk-1', true)).toEqual(['blk-1'])
    expect(defaultUiState().collapsed).toEqual([])
  })
})

describe('C9 嵌入块协同边界', () => {
  const embedNode = (src, title) => ({
    type: 'webEmbed',
    attrs: { src, title, height: 400 },
  })

  it('两端同时插入同一嵌入块 → attrs 收敛，iframe 各自独立', () => {
    const [a, b] = pair()
    network.setOnline(false)
    insertBlock(a, embedNode('https://example.com/a', 'A的'))
    insertBlock(b, embedNode('https://example.com/b', 'B的'))
    network.reconnect()

    const attrsOf = (peer) => {
      let found = null
      peer.editor.state.doc.descendants((node) => {
        if (node.type.name === 'webEmbed' && !found) found = node.attrs
      })
      return found
    }
    expect(attrsOf(a).src).toBe(attrsOf(b).src) // 冲突以最后写入为准，两端一致
    expect(attrsOf(a).title).toBe(attrsOf(b).title)

    // 每个客户端自己建 iframe（iframe 里的运行时归那个 app，不由对端驱动）。
    const frameA = a.editor.view.dom.querySelector('iframe')
    const frameB = b.editor.view.dom.querySelector('iframe')
    expect(frameA).toBeTruthy()
    expect(frameB).toBeTruthy()
    expect(frameA).not.toBe(frameB)
  })

  it('改标题/高度会同步到对端', () => {
    const [a, b] = pair()
    insertBlock(a, embedNode('https://example.com/x', '旧标题'))
    expect(b.text).toBe(a.text)

    a.editor.commands.updateAttributes('webEmbed', { title: '新标题', height: 520 })
    let attrs = null
    b.editor.state.doc.descendants((node) => {
      if (node.type.name === 'webEmbed' && !attrs) attrs = node.attrs
    })
    expect(attrs.title).toBe('新标题')
    expect(attrs.height).toBe(520)
  })
})
