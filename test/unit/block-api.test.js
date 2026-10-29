/**
 * BlockAPI（05 §5.12）—— 全库唯一一层「按 blockId 操作单个块」的接口。
 *
 * 这里守的是**契约**，不是实现细节：
 *
 * 1. **寻址只用 blockId** —— 方法签名一律不收 pos；`BlockSnapshot.docPos` 只作调试输出。
 *    测试里刻意插入 / 移动若干次让位置漂移，再按同一个 id 找回来，验的就是这条；
 * 2. **一次调用 = 一步撤销** —— 每个写方法自己 `closeHistory()` 并单独 dispatch。
 *    `batch` 反过来：内部所有写合成一步；
 * 3. **写返回受影响的 id，读返回快照副本** —— 快照改了不能穿透进编辑器；
 * 4. **schema 的 content 表达式不能绕过** —— 自动包壳（listItem→bulletList、column→columns）、
 *    删完就空的父容器连坐删除、表格内部拒绝一切块级增删改。
 *
 * 环境用 jsdom：需要真 Editor（`view.dispatch` 与 undo 都要走完整链路）。
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { Editor, getSchema } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { createLarkDocExtensions } from '../../src/components/lark-doc/extensions'
import {
  BLOCK_CONTAINER_TYPES, assignIds, blockTree, collectIds, collectJsonIds, createBlockApi,
  expandDeletion, fitToParent, nodeFromJson, posAtId,
} from '../../src/core/blockApi'

// ── 夹具 ────────────────────────────────────────────────────────────────
/** 纯文本段落。id 显式写死 —— 断言里要按 id 找回。 */
const para = (id, text) => ({
  type: 'paragraph',
  attrs: { blockId: id },
  content: text ? [{ type: 'text', text }] : [],
})

const listItem = (id, text) => ({ type: 'listItem', attrs: { blockId: id }, content: [para(`${id}p`, text)] })
const bulletList = (id, texts) => ({
  type: 'bulletList',
  attrs: { blockId: id },
  content: texts.map((text, i) => listItem(`${id}-${i}`, text)),
})
const calloutOf = (id, children) => ({ type: 'callout', attrs: { blockId: id }, content: children })
const columnOf = children => ({ type: 'column', content: children })
const tableOf = () => ({
  type: 'table',
  content: [{
    type: 'tableRow',
    content: [{ type: 'tableCell', content: [para('c1', 'cell')] }],
  }],
})

let editor = null
afterEach(() => {
  if (editor) { editor.destroy(); editor = null }
})

/** 起一个带定稿内容的编辑器，并挂上 BlockAPI。 */
function setup(content) {
  editor = new Editor({ extensions: createLarkDocExtensions(), content: { type: 'doc', content } })
  return { editor, api: createBlockApi({ editor }) }
}

/** 文档里所有 blockId，按出现顺序。 */
function idsIn(doc) {
  const out = []
  doc.descendants((node) => {
    const id = node.attrs && node.attrs.blockId
    if (typeof id === 'string' && id) out.push(id)
    return true
  })
  return out
}

/** 顶层块的 [id, type, text] 序列 —— 验顺序时用，比整份 JSON 好读。 */
function outline(doc) {
  return Array.from({ length: doc.childCount }, (_, i) => {
    const child = doc.child(i)
    return [child.attrs.blockId, child.type.name, child.textContent]
  })
}

describe('BlockAPI · 读：快照与寻址', () => {
  it('get 返回九字段快照；未知 id 返回 null', () => {
    const { api } = setup([para('a', 'A'), para('b', 'B')])
    const snap = api.get('a')
    expect(snap).toMatchObject({
      blockId: 'a', type: 'paragraph', text: 'A', depth: 0, parentId: null, index: 0, isEmpty: false,
    })
    expect(snap.children).toEqual([])
    expect(snap.docPos).toEqual({ from: 0, to: 3 })
    expect(api.get('不存在')).toBeNull()
  })

  it('快照是副本：改 attrs / children / docPos 都不穿透回文档', () => {
    const { api, editor: ed } = setup([calloutOf('k', [para('p1', 'x'), para('p2', 'y')])])
    const snap = api.get('k')
    snap.attrs.blockId = 'hacked'
    snap.children.push('hacked')
    snap.docPos.from = -1
    expect(api.get('k').attrs.blockId).toBe('k')
    expect(api.get('k').children).toEqual(['p1', 'p2'])
    expect(api.get('k').docPos.from).toBe(0)
    expect(idsIn(ed.state.doc)).toContain('k')
  })

  it('children / parent / index 反映块树父子关系', () => {
    const { api } = setup([calloutOf('k', [para('p1', 'x'), para('p2', 'y')]), para('tail', 'T')])
    expect(api.children('k')).toEqual(['p1', 'p2'])
    expect(api.parent('p1')).toBe('k')
    expect(api.parent('k')).toBeNull()
    expect(api.index('p2')).toBe(1)
    expect(api.index('tail')).toBe(1)
  })

  it('siblings：顶层返回根序列，容器内返回同级（含自己）', () => {
    const { api } = setup([para('a', 'A'), calloutOf('k', [para('p1', 'x'), para('p2', 'y')])])
    expect(api.siblings('a')).toEqual(['a', 'k'])
    expect(api.siblings('p2')).toEqual(['p1', 'p2'])
    expect(api.siblings('不在')).toEqual([])
  })

  it('query 按文档序遍历过滤；非法谓词返回空', () => {
    const { api } = setup([para('a', 'A'), calloutOf('k', [para('p1', 'x')]), para('b', 'B')])
    expect(api.query(s => s.type === 'paragraph').map(s => s.blockId)).toEqual(['a', 'p1', 'b'])
    expect(api.query(s => s.type === 'paragraph' && s.text === 'x').map(s => s.blockId)).toEqual(['p1'])
    expect(api.query(null)).toEqual([])
  })

  it('selected：选区跨父子时只收最外层（删除选中块才不会重复处理子树）', () => {
    const { api, editor: ed } = setup([para('a', 'A'), calloutOf('k', [para('p1', 'x')]), para('b', 'B')])
    const k = api.get('k')
    ed.view.dispatch(ed.state.tr.setSelection(
      // +2 / -2：跳过节点边界，让两端都真正落在段落的 inline 内容里。
      TextSelection.create(ed.state.doc, k.docPos.from + 2, k.docPos.to - 2),
    ))
    expect(api.selected()).toEqual(['k'])
    // 光标落在段落里 → 只收这一段。
    const p1 = api.get('p1')
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, p1.docPos.from + 1)))
    expect(api.selected()).toEqual(['p1'])
  })

  it('isContainer：容器为真，heading / 段落为假', () => {
    const { api } = setup([para('a', 'A'), bulletList('L', ['x']), calloutOf('k', [para('p1', 'y')])])
    expect(api.isContainer('L')).toBe(true)
    expect(api.isContainer('k')).toBe(true)
    expect(api.isContainer('a')).toBe(false)
    expect(BLOCK_CONTAINER_TYPES.has('heading')).toBe(false)
  })

  it('posAtId：与快照 docPos 一致，事务后自动跟随新位置（缓存按 doc 实例作废）', () => {
    const { api, editor: ed } = setup([para('a', 'AAAA'), para('b', 'B')])
    const before = posAtId(ed.state, 'b')
    expect(before).toBe(api.get('b').docPos.from)
    api.insert(para('mid', 'MMMMMM'), { blockId: 'a' })
    const after = posAtId(ed.state, 'b')
    expect(after).toBeGreaterThan(before)
    expect(after).toBe(api.get('b').docPos.from)
    expect(ed.state.doc.nodeAt(after).textContent).toBe('B')
  })
})

describe('BlockAPI · insert：落点与自动包壳', () => {
  it('after / before / inside 三种落点', () => {
    const { api } = setup([para('a', 'A'), para('b', 'B')])
    api.insert(para('x', 'X'), { blockId: 'a' })
    expect(outline(editor.state.doc).map(o => o[0])).toEqual(['a', 'x', 'b'])

    api.insert(para('y', 'Y'), { blockId: 'b', position: 'before' })
    expect(outline(editor.state.doc).map(o => o[0])).toEqual(['a', 'x', 'y', 'b'])
  })

  it('inside 落在容器进容器开头；落在叶子降级为 after', () => {
    const { api } = setup([para('a', 'A'), calloutOf('k', [para('p1', 'x')])])
    api.insert(para('n1', 'N1'), { blockId: 'k', position: 'inside' })
    expect(api.parent('n1')).toBe('k')
    expect(api.index('n1')).toBe(0)

    // 段落装不下子块 → 落在它后面。
    api.insert(para('n2', 'N2'), { blockId: 'a', position: 'inside' })
    expect(api.parent('n2')).toBeNull()
    expect(api.index('n2')).toBe(1)
  })

  it('offset：块内字符偏移拆分文本块', () => {
    const { api } = setup([para('a', 'abcd')])
    api.insert(para('x', 'X'), { blockId: 'a', offset: 2 })
    expect(outline(editor.state.doc).map(o => o[2])).toEqual(['ab', 'X', 'cd'])
  })

  it('offset 落在非负文本块 / codeBlock 一律拒绝', () => {
    const { api } = setup([para('a', 'abcd'), { type: 'codeBlock', attrs: { blockId: 'c1' }, content: [{ type: 'text', text: 'x=1' }] }])
    const before = editor.state.doc.toJSON()
    api.insert(para('x', 'X'), { blockId: 'c1', offset: 1 })
    api.insert(para('x', 'X'), { blockId: 'c1' , position: 'inside' })
    expect(editor.state.doc.toJSON()).toEqual(before)
  })

  it('index 锚点：文档根按序插入，越界夹到首尾', () => {
    const { api } = setup([para('a', 'A'), para('b', 'B')])
    api.insert(para('head', 'H'), { index: 0 })
    api.insert(para('tail', 'T'), { index: 99 })
    expect(outline(editor.state.doc).map(o => o[0])).toEqual(['head', 'a', 'b', 'tail'])
  })

  it('index 锚点：容器内插入，父块不存在则拒绝', () => {
    const { api } = setup([calloutOf('k', [para('p1', 'x')])])
    api.insert(para('p2', 'y'), { index: 1, parentId: 'k' })
    expect(api.children('k')).toEqual(['p1', 'p2'])
    const before = editor.state.doc.toJSON()
    api.insert(para('ghost', 'g'), { index: 0, parentId: '不在' })
    expect(editor.state.doc.toJSON()).toEqual(before)
  })

  it('自动包壳：listItem 顶层插入 → bulletList；taskItem → taskList', () => {
    const { api } = setup([para('a', 'A')])
    api.insert(listItem('L1', 'item'), { blockId: 'a' })
    api.insert({ type: 'taskItem', attrs: { blockId: 'T1' }, content: [para('T1p', 'todo')] }, { blockId: 'a' })
    // 顶层收不下裸 item，两侧都自动补了列表容器。
    expect(api.get(api.parent('L1')).type).toBe('bulletList')
    expect(api.get(api.parent('T1')).type).toBe('taskList')
    expect(api.get('L1').type).toBe('listItem')
  })

  it('自动包壳：column 顶层插入 → columns（补足第二列）', () => {
    const { api } = setup([para('a', 'A')])
    // column 不编号，所以 `insert` 返回的是外层 columns 的 id。
    const [id] = api.insert(columnOf([para('x', 'X')]), { blockId: 'a' })
    expect(api.get(id).type).toBe('columns')
    expect(api.children(id)).toHaveLength(2)
  })

  it('父是列表容器时，非条目块自动包 listItem（条目内容以段落打头）', () => {
    const { api } = setup([bulletList('L', ['x'])])
    const [id] = api.insert(para('nested', 'N'), { blockId: 'L', position: 'inside' })
    // 返回的是最外层落地块 —— 这里就是新包出来的 listItem。
    expect(api.get(id).type).toBe('listItem')
    expect(api.parent(id)).toBe('L')
    expect(api.children('L')).toHaveLength(2)
  })

  it('insert 返回最外层落地块的 id：payload 被包壳时返回壳的 id', () => {
    const { api } = setup([para('a', 'A')])
    const [id] = api.insert(listItem('L1', 'item'), { blockId: 'a' })
    expect(api.get(id).type).toBe('bulletList')   // 壳
    expect(api.get('L1').type).toBe('listItem')    // payload 本体照原 id 可查
  })

  it('插进 listItem 内部：直接成为条目里的同级段落（schema 允许条目含多个块）', () => {
    const { api } = setup([bulletList('L', ['x'])])
    const [id] = api.insert(para('nested', 'N'), { blockId: 'L-0', position: 'inside' })
    expect(api.get(id).type).toBe('paragraph')
    expect(api.parent(id)).toBe('L-0')
  })

  it('显式 blockId 透传到文档 —— 包壳也不能把内层锚点重发掉', () => {
    const { api } = setup([para('a', 'A'), para('b', 'B')])
    api.insert(listItem('L1', 'item'), { blockId: 'a' })
    expect(api.get('L1')).not.toBeNull()
    expect(api.get('L1').type).toBe('listItem')
    // 内层段落自带 id 同样保留。
    expect(api.get('L1p')).not.toBeNull()
    expect(api.parent('L1p')).toBe('L1')
  })

  it('显式 blockId 与现有块撞号时才重发（一篇文档不许重号）', () => {
    const { api } = setup([para('dup', 'A')])
    const ids = api.insert(para('dup', 'B'), { blockId: 'dup' })
    expect(ids).toHaveLength(1)
    expect(ids[0]).not.toBe('dup')
    expect(api.get(ids[0]).text).toBe('B')
    expect(idsIn(editor.state.doc).filter(id => id === 'dup')).toHaveLength(1)
  })

  it('insertMany：按给定顺序排开，返回同序 id', () => {
    const { api } = setup([para('a', 'A'), para('b', 'B')])
    const ids = api.insertMany([para('x', 'X'), para('y', 'Y')], { blockId: 'a' })
    expect(ids).toEqual(['x', 'y'])
    expect(outline(editor.state.doc).map(o => o[0])).toEqual(['a', 'x', 'y', 'b'])
  })

  it('非法 payload / 空数组 → 返回空，文档不动', () => {
    const { api } = setup([para('a', 'A')])
    const before = editor.state.doc.toJSON()
    expect(api.insert({ type: '不存在的类型' }, { blockId: 'a' })).toEqual([])
    expect(api.insertMany([], { blockId: 'a' })).toEqual([])
    expect(api.insert(para('x', 'X'), { blockId: '不在' })).toEqual([])
    expect(editor.state.doc.toJSON()).toEqual(before)
  })

  it('表格内部一律拒绝插入（§5.12.4：表格无块级增删改）', () => {
    const { api } = setup([tableOf()])
    const before = editor.state.doc.toJSON()
    api.insert(para('x', 'X'), { blockId: 'c1' })
    api.insert(para('x', 'X'), { blockId: 'c1', position: 'inside' })
    expect(editor.state.doc.toJSON()).toEqual(before)
  })
})

describe('BlockAPI · update', () => {
  it('改 attrs 生效；blockId 不接受改写；未声明的 attrs 忽略', () => {
    const { api } = setup([para('a', 'A')])
    api.update('a', { indent: 2, textAlign: 'center' })
    expect(api.get('a').attrs.indent).toBe(2)
    expect(api.get('a').attrs.textAlign).toBe('center')

    api.update('a', { blockId: 'hacked' })
    expect(api.get('a').blockId).toBe('a')

    const before = api.get('a').attrs
    api.update('a', { 没这个属性: 1 })
    expect(api.get('a').attrs).toEqual(before)
  })

  it('无变化 / 非法入参 → 不产生事务', () => {
    const { api, editor: ed } = setup([para('a', 'A')])
    const before = ed.state.doc.toJSON()
    api.update('a', { indent: api.get('a').attrs.indent })
    api.update('a', null)
    api.update('不在', { indent: 1 })
    expect(ed.state.doc.toJSON()).toEqual(before)
  })
})

describe('BlockAPI · remove', () => {
  it('删单个块', () => {
    const { api } = setup([para('a', 'A'), para('b', 'B')])
    api.remove('a')
    expect(outline(editor.state.doc).map(o => o[0])).toEqual(['b'])
  })

  it('keepChildren：callout 的子块上提到原位', () => {
    const { api } = setup([calloutOf('k', [para('p1', 'x'), para('p2', 'y')]), para('tail', 'T')])
    api.remove('k', { keepChildren: true })
    expect(outline(editor.state.doc).map(o => o[0])).toEqual(['p1', 'p2', 'tail'])
    expect(api.get('k')).toBeNull()
  })

  it('删列表最后一项：连空壳 bulletList 一起删', () => {
    const { api } = setup([para('a', 'A'), bulletList('L', ['only'])])
    api.remove('L-0')
    expect(outline(editor.state.doc).map(o => o[0])).toEqual(['a'])
  })

  it('删到一篇空：留一个空段落兜底（doc content 是 1*）', () => {
    const { api } = setup([para('a', 'A')])
    api.remove('a')
    expect(editor.state.doc.childCount).toBe(1)
    expect(editor.state.doc.child(0).type.name).toBe('paragraph')
  })

  it('表格内的块拒绝删除', () => {
    const { api } = setup([tableOf()])
    const before = editor.state.doc.toJSON()
    api.remove('c1')
    expect(editor.state.doc.toJSON()).toEqual(before)
  })

  it('removeMany：逐个删，后面的位置左移不影响查找', () => {
    const { api } = setup([para('a', 'A'), para('b', 'B'), para('c', 'C'), para('d', 'D')])
    api.removeMany(['a', 'c'])
    expect(outline(editor.state.doc).map(o => o[0])).toEqual(['b', 'd'])
  })
})

describe('BlockAPI · move', () => {
  it('搬动后 blockId 不变、顺序改变', () => {
    const { api } = setup([para('a', 'A'), para('b', 'B'), para('c', 'C')])
    api.move('c', { blockId: 'a', position: 'before' })
    expect(outline(editor.state.doc).map(o => o[0])).toEqual(['c', 'a', 'b'])
    expect(api.get('c').text).toBe('C')
  })

  it('搬进容器：不适形状的块自动包壳', () => {
    const { api } = setup([bulletList('L', ['x']), calloutOf('k', [para('p1', 'y')])])
    api.move('L-0', { blockId: 'k', position: 'inside' })
    // listItem 进不了 callout（schema 只收列表容器），自动包一层 bulletList；
    // 块本身还是原来那个块、id 没变。
    expect(api.get('L-0').type).toBe('listItem')
    const shell = api.parent('L-0')
    expect(api.get(shell).type).toBe('bulletList')
    expect(api.parent(shell)).toBe('k')
  })

  it('防环：搬进自己 / 自己的子孙 → no-op', () => {
    const { api } = setup([calloutOf('k', [para('p1', 'x')])])
    const before = editor.state.doc.toJSON()
    api.move('k', { blockId: 'p1', position: 'before' })
    api.move('k', { blockId: 'k', position: 'inside' })
    expect(editor.state.doc.toJSON()).toEqual(before)
  })

  it('同位置 → no-op；目标不存在 → no-op', () => {
    const { api } = setup([para('a', 'A'), para('b', 'B')])
    const before = editor.state.doc.toJSON()
    api.move('a', { blockId: 'a', position: 'before' })   // 落点 = a 的开始
    api.move('a', { blockId: 'b', position: 'before' })   // 落点 = a 的结束
    api.move('a', { blockId: '不在' })
    expect(editor.state.doc.toJSON()).toEqual(before)
  })

  it('表格内的块搬不动', () => {
    const { api } = setup([para('a', 'A'), tableOf()])
    const before = editor.state.doc.toJSON()
    api.move('c1', { blockId: 'a' })
    expect(editor.state.doc.toJSON()).toEqual(before)
  })
})

describe('BlockAPI · duplicate', () => {
  it('deep 复制：返回新 id，整棵子树换号（不与原块共用锚点）', () => {
    const { api } = setup([calloutOf('k', [para('p1', 'x')]), para('b', 'B')])
    const copyId = api.duplicate('k')
    expect(copyId).not.toBe('k')
    expect(api.get(copyId).type).toBe('callout')
    expect(api.children(copyId)).not.toContain('p1')
    expect(api.children(copyId)).toHaveLength(1)
    expect(outline(editor.state.doc).map(o => o[0])).toEqual(['k', copyId, 'b'])
  })

  it('deep:false 只留壳：子块内容不复制，但容器 content 是 1* 得补一个空段落占位', () => {
    const { api } = setup([calloutOf('k', [para('p1', 'x'), para('p2', 'y')])])
    const copyId = api.duplicate('k', { deep: false })
    expect(api.get(copyId).type).toBe('callout')
    expect(api.children(copyId)).not.toContain('p1')
    expect(api.children(copyId)).toHaveLength(1)
    expect(api.get(api.children(copyId)[0]).text).toBe('')
  })

  it('复制列表项：自动包壳后返回的 id 仍能按图索骥', () => {
    const { api } = setup([bulletList('L', ['only'])])
    const copyId = api.duplicate('L-0')
    expect(api.get(copyId)).not.toBeNull()
    expect(api.get(copyId).type).toBe('listItem')
    expect(api.children('L')).toHaveLength(2)
  })
})

describe('BlockAPI · transform', () => {
  it('paragraph → heading：类型变了，blockId 沿用（评论锚点不丢）', () => {
    const { api } = setup([para('a', 'A')])
    api.transform('a', 'heading', { level: 2 })
    const snap = api.get('a')
    expect(snap.type).toBe('heading')
    expect(snap.attrs.level).toBe(2)
    expect(snap.blockId).toBe('a')
    expect(snap.text).toBe('A')
  })

  it('→ codeBlock：mark 与行内结构全丢，只留纯文本', () => {
    const { api } = setup([{
      type: 'paragraph',
      attrs: { blockId: 'a' },
      content: [{ type: 'text', text: 'bo', marks: [{ type: 'bold' }] }, { type: 'text', text: 'ld' }],
    }])
    api.transform('a', 'codeBlock')
    expect(api.get('a').type).toBe('codeBlock')
    expect(api.get('a').text).toBe('bold')
  })

  it('heading → paragraph：靠 attrs 过滤丢掉 level', () => {
    const { api } = setup([{ type: 'heading', attrs: { blockId: 'h', level: 3 }, content: [{ type: 'text', text: 'H' }] }])
    api.transform('h', 'paragraph')
    expect(api.get('h').type).toBe('paragraph')
    expect(api.get('h').attrs.level).toBeUndefined()
  })

  it('→ table / 表格骨架一律拒绝；同类型同 attrs → no-op', () => {
    const { api } = setup([para('a', 'A')])
    api.transform('a', 'table')
    expect(api.get('a').type).toBe('paragraph')
    const before = editor.state.doc.toJSON()
    api.transform('a', 'paragraph')
    expect(editor.state.doc.toJSON()).toEqual(before)
  })
})

describe('BlockAPI · batch：整体一步落地', () => {
  it('batch 内多次写 → 一次 dispatch，一次 undo 全部回退', () => {
    const { api, editor: ed } = setup([para('a', 'A')])
    api.batch(() => {
      api.insert(para('x', 'X'), { blockId: 'a' })
      api.insert(para('y', 'Y'), { blockId: 'x' })
    })
    expect(outline(ed.state.doc).map(o => o[0])).toEqual(['a', 'x', 'y'])
    ed.commands.undo()
    expect(outline(ed.state.doc).map(o => o[0])).toEqual(['a'])
  })

  it('batch 抛错 → 整批不落地（事务丢弃，文档不变）', () => {
    const { api, editor: ed } = setup([para('a', 'A')])
    const before = ed.state.doc.toJSON()
    expect(() => {
      api.batch(() => {
        api.insert(para('x', 'X'), { blockId: 'a' })
        throw new Error('中途失败')
      })
    }).toThrow('中途失败')
    expect(ed.state.doc.toJSON()).toEqual(before)
    // 抛错后 batch 状态已复位，后续写操作照常单步落地。
    api.insert(para('z', 'Z'), { blockId: 'a' })
    expect(outline(ed.state.doc).map(o => o[0])).toEqual(['a', 'z'])
  })

  it('batch 内的读能看见还没落地的写（过往 pending 事务看文档）', () => {
    const { api } = setup([para('a', 'A')])
    api.batch(() => {
      api.insert(para('x', 'X'), { blockId: 'a' })
      expect(api.get('x')).not.toBeNull()
      expect(api.index('x')).toBe(1)
    })
    expect(api.get('x')).not.toBeNull()
  })

  it('batch 不嵌套：内层直接复用外层事务', () => {
    const { api, editor: ed } = setup([para('a', 'A')])
    api.batch(() => {
      api.insert(para('x', 'X'), { blockId: 'a' })
      api.batch(() => { api.insert(para('y', 'Y'), { blockId: 'x' }) })
    })
    expect(outline(ed.state.doc).map(o => o[0])).toEqual(['a', 'x', 'y'])
    ed.commands.undo()
    expect(outline(ed.state.doc).map(o => o[0])).toEqual(['a'])
  })
})

describe('BlockAPI · 每方法一步撤销（§5.12 closeHistory）', () => {
  it('insert / update / remove / move / duplicate / transform 各自一步', () => {
    const cases = [
      api => api.insert(para('x', 'X'), { blockId: 'b' }),
      api => api.update('a', { indent: 3 }),
      api => api.remove('b'),
      api => api.move('b', { blockId: 'a', position: 'before' }),
      api => api.duplicate('a'),
      api => api.transform('a', 'heading', { level: 1 }),
    ]
    for (const run of cases) {
      const { api, editor: ed } = setup([para('a', 'A'), para('b', 'B')])
      const before = ed.state.doc.toJSON()
      run(api)
      expect(ed.state.doc.toJSON()).not.toEqual(before)
      ed.commands.undo()
      expect(ed.state.doc.toJSON()).toEqual(before)
    }
  })
})

describe('nodes.js：包壳 / 编号 / 删除连坐', () => {
  const schema = getSchema(createLarkDocExtensions())

  it('collectJsonIds 收集 JSON 树里写死的 id（数组也收）', () => {
    const own = collectJsonIds([listItem('L1', 'x'), para('p2', 'y')])
    expect([...own].sort()).toEqual(['L1', 'L1p', 'p2'])
  })

  it('assignIds 保留未撞号的显式 id，撞号才重发', () => {
    const taken = new Set(['occupied'])
    const { json: kept } = assignIds(para('free', 'x'), taken)
    expect(kept.attrs.blockId).toBe('free')
    const { json: reissued } = assignIds(para('occupied', 'x'), taken)
    expect(reissued.attrs.blockId).not.toBe('occupied')
  })

  it('fitToParent 给 shell 发号，且不动内层已有锚点', () => {
    const taken = collectIds(schema.nodeFromJSON({ type: 'doc', content: [para('a', 'A')] }))
    const assigned = assignIds(listItem('L1', 'x'), taken)
    const fitted = fitToParent(schema, assigned.json, 'doc', taken)
    expect(fitted.type).toBe('bulletList')
    expect(fitted.content[0].attrs.blockId).toBe('L1')
    expect(fitted.content[0].content[0].attrs.blockId).toBe('L1p')
    expect(fitted.attrs.blockId).not.toBe('L1')
    // 包出来的必须真能造出节点（content 表达式合法）。
    expect(nodeFromJson(schema, fitted)).not.toBeNull()
  })

  it('fitToParent：父是 columns 时非 column 一律包 column', () => {
    const taken = new Set()
    const fitted = fitToParent(schema, para('a', 'A'), 'columns', taken)
    expect(fitted.type).toBe('column')
  })

  it('expandDeletion：columns 剩到 1 列时连整行删掉', () => {
    const doc = schema.nodeFromJSON({
      type: 'doc',
      content: [para('a', 'A'), {
        type: 'columns',
        content: [columnOf([para('p1', 'x')]), columnOf([para('p2', 'y')])],
      }],
    })
    // column 是结构性容器、不编号，块树穿透它 —— 只能按里面的段落定位。
    const entry = blockTree(doc).byId.get('p1')
    expect(entry).toBeTruthy()
    const range = expandDeletion(doc, entry)
    expect(doc.textBetween(range.from, range.to)).toContain('y')
  })
})
