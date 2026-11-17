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
import { buildRevisionDecisionTr } from '../../src/core/revision/commands'
import { createUiStateStore, toggleCollapsed, defaultUiState } from '../../src/collab/policies'
import { collectRevisions } from '../../src/core/blocks/revision'
import { createEditorCommentAnchorCodec } from '../../src/collab/anchors'
import * as Y from 'yjs'
import commentsMixin from '../../src/components/lark-doc/editor/commentsMixin'
import revisionBehavior from '../../src/components/lark-doc/editor/revisionMixin'

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
  it('正式编辑器评论codec使用真实y-sync字符映射，另一端前插后仍指向原词', () => {
    const [a, b] = pair()
    typeAt(a, 1, 'hello world')
    const blockId = blockIds(a)[0], codec = createEditorCommentAnchorCodec({ editor: a.editor, ydoc: a.ydoc })
    const payload = codec.encode({ blockId, offset: 6, length: 5 })
    expect(payload.kind).toBe('y')
    typeAt(b, 1, 'say ')
    expect(codec.decode(payload)).toEqual({ blockId, offset: 10, length: 5 })
  })
  it('跨段评论分别保存两端位置，远端在选区内插入仍覆盖完整范围', () => {
    const [a, b] = pair()
    a.editor.commands.setContent({ type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'hello' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'world' }] },
    ] })
    const blockId = blockIds(a)[0], codec = createEditorCommentAnchorCodec({ editor: a.editor, ydoc: a.ydoc })
    const payload = codec.encode({ blockId, offset: 1, length: 9 })
    expect(payload.kind).toBe('y')
    const from = Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(payload.from), a.ydoc)
    const to = Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(payload.to), a.ydoc)
    expect(from.type).not.toBe(to.type)
    expect(codec.decode(payload)).toEqual({ blockId, offset: 1, length: 9 })
    typeAt(b, 9, 'new')
    expect(codec.decode(payload)).toEqual({ blockId, offset: 1, length: 12 })
  })
  it('跨mention两侧的评论终点来自独立文本type，不截到首段文字尾', () => {
    const [a] = pair()
    a.editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', content: [
      { type: 'text', text: 'alpha ' }, { type: 'mention', attrs: { id: 'bob', label: 'Bob' } }, { type: 'text', text: ' omega' },
    ] }] })
    const blockId = blockIds(a)[0], codec = createEditorCommentAnchorCodec({ editor: a.editor, ydoc: a.ydoc })
    const payload = codec.encode({ blockId, offset: 2, length: 9 })
    expect(payload.kind).toBe('y')
    const end = Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(payload.to), a.ydoc)
    expect(end.type.toString().slice(0, end.index)).toBe(' ome')
    expect(codec.decode(payload)).toEqual({ blockId, offset: 2, length: 9 })
    a.editor.commands.deleteRange({ from: 8, to: 14 })
    expect(codec.decode(payload)).toBeNull()
  })
  it('跨段评论和输入草稿在两段正文中均显示实际高亮', () => {
    const [a] = pair()
    a.editor.commands.setContent({ type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'hello' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'world' }] },
    ] })
    const blockId = blockIds(a)[0], codec = createEditorCommentAnchorCodec({ editor: a.editor, ydoc: a.ydoc })
    const anchor = codec.encode({ blockId, offset: 1, length: 9 })
    const vm = { editor: a.editor, commentProvider: () => ({ isRemote: true }), commentCan: () => true,
      commentAnchorCodec: codec, commentSourceThreads: [{ id: 'cross', blockId, anchor, scope: 'selection', replies: [] }], commentActiveThreadId: 'cross' }
    commentsMixin.methods.installCommentDecorations.call(vm)
    const text = selector => [...a.editor.view.dom.querySelectorAll(selector)].map(node => node.textContent)
    expect(text('[data-thread-id="cross"]')).toEqual(['ello', 'wor'])
    vm.commentSourceThreads = []; vm.commentComposerOpen = true; vm.commentComposerContext = { anchor }
    commentsMixin.methods.refreshCommentDecorations.call(vm)
    expect(text('.lark-doc-comment.is-draft')).toEqual(['ello', 'wor'])
    expect(a.editor.getJSON().content.every(node => node.content.every(child => !child.marks))).toBe(true)
  })
  it('原生表格选区刚变化立即按评论快捷键时，读取DOM当前选区而非PM旧空选区', () => {
    const [a] = pair()
    a.editor.commands.setContent({ type: 'doc', content: [{ type: 'table', content: [{ type: 'tableRow', content: [
      { type: 'tableCell', content: [{ type: 'paragraph', attrs: { blockId: 'table_text' }, content: [{ type: 'text', text: 'table quote' }] }] },
    ] }] }] })
    let from
    a.editor.state.doc.descendants((node, position) => { if (node.isText && node.text === 'table quote') from = position })
    a.editor.commands.setTextSelection(from)
    const dom = a.editor.view.dom; document.body.appendChild(dom)
    const native = document.getSelection(), range = document.createRange(), text = dom.querySelector('td p').firstChild
    range.setStart(text, 0); range.setEnd(text, 5); native.removeAllRanges(); native.addRange(range)
    let captured
    const vm = { ...commentsMixin.methods, editor: a.editor, commentCan: () => true, openSelectionComment() { captured = this.commentSelectionRange() } }
    try {
      expect(a.editor.state.selection.empty).toBe(true)
      commentsMixin.methods.onCommentShortcut.call(vm, { metaKey: true, altKey: true, code: 'KeyM', preventDefault() {}, stopPropagation() {} })
      expect(captured).toMatchObject({ blockId: 'table_text', offset: 0, length: 5, text: 'table' })
    } finally { native.removeAllRanges(); dom.remove() }
  })
  it('修订态不把远端同步正文重新标成本地建议，本地键入仍带原建议', () => {
    const [a, b] = pair()
    typeAt(a, 1, '原文')
    b.editor.storage.larkDocRevisionTracker.active = true
    typeAt(a, 1, '远端')
    expect(b.text).toBe(a.text)
    expect(collectRevisions(b.editor.state.doc)).toEqual([])
    typeAt(b, 1, '本地建议')
    const revisions = collectRevisions(b.editor.state.doc)
    expect(revisions).toHaveLength(1)
    expect(revisions[0].text).toBe('本地建议')
    expect(collectRevisions(a.editor.state.doc)).toEqual(revisions)
  })
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
  it('协同历史捕获窗口为 800ms，跟踪本地 origin 且不跟踪远端', () => {
    const [a] = pair()
    const plugin = a.editor.state.plugins.find(item => item.key.startsWith('y-undo$'))
    const manager = plugin.getState(a.editor.state).undoManager
    expect(manager.captureTimeout).toBe(800)
    expect(manager.trackedOrigins.has('local')).toBe(true)
    expect(manager.trackedOrigins.has('collab-harness:remote')).toBe(false)
  })

  it.each(['accept', 'reject'])('协同 %s 文档Undo恢复建议且另一客户端收敛', (action) => {
    const [a, b] = pair()
    insertBlock(a, { type: 'paragraph', content: [{ type: 'text', text: '建议', marks: [
      { type: 'revision', attrs: { revisionId: 'r1', kind: 'insert', author: 'a' } },
    ] }] })
    const manager = a.editor.state.plugins.find(item => item.key.startsWith('y-undo$')).getState(a.editor.state).undoManager
    manager.clear()
    const before = a.editor.getJSON()
    a.editor.view.dispatch(buildRevisionDecisionTr(a.editor.state, 'r1', action))
    const decided = a.editor.getJSON()
    expect(manager.undoStack).toHaveLength(1)
    expect(b.text).toBe(a.text)
    expect(a.text.includes('建议')).toBe(action === 'accept')
    expect(a.editor.commands.undo()).toBe(true)
    expect(a.editor.getJSON()).toEqual(before)
    expect(b.editor.getJSON()).toEqual(before)
    expect(b.editor.commands.undo()).toBe(false)
    expect(a.editor.commands.redo()).toBe(true)
    expect(a.editor.getJSON()).toEqual(decided)
    expect(b.editor.getJSON()).toEqual(decided)
  })

  it.each(['accept', 'reject'])('host %s 决策与前后本地输入保持三个独立Yjs Undo步骤', action => {
    const [a, b] = pair()
    insertBlock(a, { type: 'paragraph', content: [{ type: 'text', text: '建议', marks: [
      { type: 'revision', attrs: { revisionId: 'r-group', kind: 'insert', author: 'a' } },
    ] }] })
    const manager = a.editor.state.plugins.find(item => item.key.startsWith('y-undo$')).getState(a.editor.state).undoManager
    manager.clear()
    a.editor.commands.insertContentAt(1, '前文')
    const before = a.editor.getJSON()
    const host = { ...revisionBehavior.methods, editor: a.editor, writable: () => true, revisionReadonly: false }
    host.decideRevision('r-group', action)
    const decided = a.editor.getJSON()
    expect(manager.undoStack).toHaveLength(2)
    a.editor.commands.insertContentAt(a.editor.state.doc.content.size - 1, '后文')
    expect(manager.undoStack).toHaveLength(3)
    expect(a.editor.commands.undo()).toBe(true)
    expect(a.editor.getJSON()).toEqual(decided)
    expect(a.editor.commands.undo()).toBe(true)
    expect(a.editor.getJSON()).toEqual(before)
    expect(b.editor.getJSON()).toEqual(before)
    expect(b.editor.commands.undo()).toBe(false)
  })

  it('协同历史严格裁剪到 100 组，远端编辑不入本地栈', () => {
    const [a, b] = pair()
    insertBlock(a, { type: 'paragraph', content: [{ type: 'text', text: '已有' }] })
    const manager = a.editor.state.plugins.find(item => item.key.startsWith('y-undo$')).getState(a.editor.state).undoManager
    for (let index = 0; index < 105; index += 1) {
      manager.stopCapturing()
      typeAt(a, 1, 'x')
    }
    expect(manager.undoStack).toHaveLength(100)
    typeAt(b, b.editor.state.doc.content.size - 1, '远端保留')
    expect(manager.undoStack).toHaveLength(100)
    for (let index = 0; index < 100; index += 1) expect(a.editor.commands.undo()).toBe(true)
    expect(a.editor.commands.undo()).toBe(false)
    expect(countOf(a, 'x')).toBe(5)
    expect(a.text).toContain('远端保留')
    expect(a.text).toBe(b.text)
  })

  it('A 撤销只撤自己的输入，B 的不变', () => {
    const [a, b] = pair()
    // 先铺一段「服务端已有正文」：真实顺序是 sync 完成后再输入。
    // 先有正文，再验证各端仅撤销自己的输入；远端同步不进入本地撤销栈。
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

  it('空文档上的第一次用户输入及补块ID可以撤销和重做', () => {
    const [a] = pair()
    typeAt(a, 1, '第一个字')
    const ids = blockIds(a)
    expect(a.editor.commands.undo()).toBe(true)
    expect(a.text).toBe('')
    expect(a.editor.commands.redo()).toBe(true)
    expect(a.text).toBe('第一个字')
    expect(blockIds(a)).toEqual(ids)
  })

  it('宿主显式非历史播种不会进入撤销栈', () => {
    const [a, b] = pair()
    a.editor.view.dispatch(a.editor.state.tr.insertText('初始正文', 1).setMeta('addToHistory', false))
    expect(a.editor.commands.undo()).toBe(false)
    expect(a.text).toBe('初始正文')
    expect(b.text).toBe(a.text)
    expect(b.editor.commands.undo()).toBe(false)
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
