/**
 * P7-01 脏区增量重扫：热路径结果必须与全量重建**逐条等价**。
 *
 * 这是这次优化唯一可靠的验收方式 —— 「快」可以靠任何手段伪造，「一样」不行。
 * 每条用例都同时算一遍冷路径（createDocumentDecorations），把两边的装饰投影成
 * 可比较的字符串数组后逐项比对：位置、样式类、widget key、分类都得对上。
 *
 * 覆盖的边界（都是容易漏扫的地方）：
 * - 段落文字编辑（最常见的击键路径）
 * - 编号标题编辑（编号向后传播，窗口要延伸到下一个更高级标题）
 * - 列表项 / 引用块内部编辑
 * - 折叠段内部编辑 + **折叠标题自身**编辑（折叠装饰覆盖标题，窗口起点要用标题 pos）
 * - 窗口右缘正好落在下一个块起点（`find` 闭区间 vs 窗口半开区间的口径差）
 * - 结构变更（插入编号标题 / 插入列表项 / 改缩进 / 粘贴多块）一律退回全量重建
 * - **多步事务**（一个 tr 里 ≥2 条 step）：纯文本仍走增量、混入结构变更则退回全量
 *   —— 补 P7 挂账 #7②「多步事务退回全量只在 /tmp 最小 schema 上跑过」
 * - **多笔事务**连续更新（`pendingSteps` 叠两段 mapping）：脏区不得残留旧坐标
 * - 搜索高亮开着时主动退回全量（active 期按全文序号判定，脏区里拼不回来）
 * - 纯选区事务不重算（装饰输入没变）
 */
import { describe, expect, it, vi } from 'vitest'
import { getSchema } from '@tiptap/core'
import { EditorState } from '@tiptap/pm/state'
import { createLarkDocExtensions } from '../../src/components/lark-doc/extensions'
import {
  createDocumentDecorations,
  updateDocumentDecorations,
} from '../../src/core/blocks/document-decorations'
import { createDerivedIndex } from '../../src/core/derive/index'

const schema = getSchema(createLarkDocExtensions())

const text = (value) => ({ type: 'text', text: value })
const p = (value, attrs = {}) => ({ type: 'paragraph', attrs, content: [text(value)] })
const h = (level, value, attrs = {}) => ({
  type: 'heading',
  attrs: { level, numbering: false, numberingStart: null, ...attrs },
  content: [text(value)],
})

const documentFixture = () => schema.nodeFromJSON({
  type: 'doc',
  content: [
    h(1, '章', { numbering: true, blockId: 'h1' }),
    p('第一段文字', { blockId: 'p1' }),
    h(2, '节一', { numbering: true, blockId: 'h2a' }),
    p('缩进子块', { blockId: 'p1a', indent: 1 }),
    h(2, '节二', { numbering: true, blockId: 'h2b' }),
    {
      type: 'orderedList',
      content: [
        { type: 'listItem', content: [p('甲项内容', { blockId: 'li1' })] },
        { type: 'listItem', content: [p('乙项内容', { blockId: 'li2' })] },
      ],
    },
    { type: 'bulletList', content: [{ type: 'listItem', content: [p('圆点项', { blockId: 'li3' })] }] },
    { type: 'blockquote', content: [p('引用块文字', { blockId: 'q1' })] },
    h(3, '小节', { numbering: false, blockId: 'h3' }),
    p('末段文字', { blockId: 'p2' }),
  ],
})

/**
 * 两块的极简文档：第二段带 reminder mark（块级蒙层装饰，起点正好是块起点）。
 * 用来复现「编辑第一段后，窗口右缘 == 第二段起点」这个边界。
 */
const reminderFixture = () => schema.nodeFromJSON({
  type: 'doc',
  content: [
    p('待编辑段落', { blockId: 'a' }),
    {
      type: 'paragraph',
      attrs: { blockId: 'b' },
      content: [{ type: 'text', marks: [{ type: 'reminder' }], text: '提醒块' }],
    },
  ],
})

/**
 * 未编号的可折叠标题 + 一个缩进子块。
 *
 * 必须用**未编号**标题：编号标题会把脏区向后传播到下一个同级标题（`extendHeadingRange`），
 * 顺带把折叠段盖住，折叠窗口的 bug 就被掩盖了 —— 这也是它上线时没被测出来的原因。
 */
const foldFixture = () => schema.nodeFromJSON({
  type: 'doc',
  content: [
    p('前置段落', { blockId: 'a' }),
    { type: 'heading', attrs: { level: 2, numbering: false, numberingStart: null, blockId: 'f' }, content: [{ type: 'text', text: '折叠标题' }] },
    p('被折叠的子块', { blockId: 'fc', indent: 1 }),
    p('末段', { blockId: 'z' }),
  ],
})

const fakeStorage = (overrides = {}) => ({
  folded: new Set(),
  query: '',
  activeIndex: 0,
  handleHover: null,
  ...overrides,
})

/** 收集时只用到 isEditable / storage（都在 widget 的事件回调里），这里给最小桩。 */
const buildContext = (storage) => ({
  storage,
  editor: { isEditable: true },
  enabled: () => true,
  options: {},
})

/**
 * 把 DecorationSet 投影成「可比较的字符串数组」：
 * 位置 + 样式类 + widget key + 分类。find() 已按位置升序返回。
 *
 * key 里嵌的**绝对位置**要抹掉再比：`DecorationSet.map` 只搬 from/to、不重写 key，
 * 所以脏区外的 key 天然保留编辑前的位置（视图只把 key 当身份令牌，见
 * updateDocumentDecorations 的注释）。key 剩下的部分（种类 + 编号/圆点 label）
 * 才是语义，必须逐字相等 —— 否则「编号没跟着重排」这种真 bug 会被位置差异掩盖。
 */
const stripKeyPos = (key) => String(key || '').replace(/-\d+-/, '-')
const project = (set) => set.find().map((decoration) => {
  const attrs = decoration.type.attrs || {}
  const spec = decoration.type.spec || {}
  return `${decoration.from}:${decoration.to}:${attrs.class || ''}:${stripKeyPos(spec.key)}:${spec.category || ''}`
})

/** 编号 label（`lark-doc-heading-number-<pos>-<label>` 的尾段）。 */
const labelOf = (decoration) => String(decoration.type.spec?.key || '').split('-').pop()

/** 造一个带 rebuild / incremental 计数的索引，沿真实装配路径跑。 */
const buildIndex = (state, storage, options = {}) => {
  const rebuild = vi.fn((current) => createDocumentDecorations({ state: current, ...buildContext(storage) }))
  const incremental = vi.fn((args) => updateDocumentDecorations({ ...buildContext(storage), ...args }))
  const index = createDerivedIndex({
    doc: state.doc,
    schema,
    rebuild,
    incremental,
  })
  return { index, rebuild, incremental, ...options }
}

/** 位置查找：按 blockId 找到块的起点。 */
const posOf = (doc, blockId) => {
  let found = -1
  doc.descendants((node, pos) => {
    if (found >= 0) return false
    if (node.attrs?.blockId === blockId) { found = pos; return false }
    return true
  })
  if (found < 0) throw new Error(`fixture 缺少块 ${blockId}`)
  return found
}

/**
 * 一处编辑 → 结果必须逐条等于同文档上的冷路径结果。
 *
 * `mode` 是**期望走哪条路**：
 * - `incremental`（默认）：文本块内的纯文字改动，必须只重扫脏区；
 * - `rebuild`：结构变更（节点增删 / attrs 变更），必须整份重建 —— 这类变更会让
 *   窗口外的序号、折叠资格变样，脏区重扫在原理上算不对，退回全量才是正确答案；
 * - `either`：只断言「结果与冷路径逐条等价」，不钉死走哪条路。
 *
 * 什么时候用 `either`：**多步事务**。`step.from/to` 记的是「该步应用时」的坐标，而
 * `isTextOnlyChange` 拿 `currentDoc`（本笔事务之前）去判是否落在同一文本块内 ——
 * 前一步插/删过大段文字时，后一步的坐标与原始文档错位，判定最多**偏保守**（该走增量
 * 却退回全量），不会偏危险（把结构变更当文本改动）。偏保守是性能问题不是正确性问题，
 * 钉死路径等于把实现的保守程度写成契约，改一次实现就要改一次用例。
 */
const expectEquivalentAfter = (mutate, { mode = 'incremental' } = {}) => {
  const storage = fakeStorage()
  const base = EditorState.create({ schema, doc: documentFixture() })
  const { index, rebuild, incremental } = buildIndex(base, storage)
  const initial = index.decorations(base)
  // 冷路径算过一次：编辑后的结果必须和「在同一份新文档上从零算」一样。
  expect(rebuild).toHaveBeenCalledTimes(1)

  const tr = mutate(base)
  const next = base.apply(tr)
  index.update(tr)
  const hot = index.decorations(next)

  if (mode === 'incremental') {
    expect(rebuild).toHaveBeenCalledTimes(1) // 热路径没有退回全量
    expect(incremental).toHaveBeenCalledTimes(1)
  } else if (mode === 'rebuild') {
    expect(incremental).not.toHaveBeenCalled()
    expect(rebuild).toHaveBeenCalledTimes(2)
  }
  const cold = createDocumentDecorations({ state: next, ...buildContext(storage) })
  expect(project(hot)).toEqual(project(cold))
  return { hot, initial, next, index, storage }
}

describe('P7-01 脏区增量重扫与全量重建等价', () => {
  it('段落文字编辑只重扫所在块', () => {
    expectEquivalentAfter((state) => state.tr.insertText('新', posOf(state.doc, 'p1') + 2))
  })

  it('编号标题编辑（编号向后传播）', () => {
    expectEquivalentAfter((state) => state.tr.insertText('改', posOf(state.doc, 'h2a') + 2))
  })

  it('插入一个新的编号标题：属结构变更，退回全量重建且编号正确', () => {
    const { hot } = expectEquivalentAfter((state) => state.tr.insert(
      posOf(state.doc, 'h2b'),
      schema.nodes.heading.create(
        { level: 2, numbering: true, numberingStart: null, blockId: 'h2new' },
        schema.text('新节'),
      ),
    ), { mode: 'rebuild' })
    // 结构变更走全量，后面的同级标题必然重排；这里守住「重建出来的是 1.3 不是两个 1.2」。
    const labels = hot.find()
      .filter((decoration) => (decoration.type.spec?.category || '') === 'heading-number')
      .map(labelOf)
    expect(labels).toEqual(['1.', '1.1', '1.2', '1.3'])
  })

  it('列表项内部编辑', () => {
    expectEquivalentAfter((state) => state.tr.insertText('补', posOf(state.doc, 'li2') + 2))
  })

  it('引用块内部编辑（块 + 一层父块）', () => {
    expectEquivalentAfter((state) => state.tr.insertText('补', posOf(state.doc, 'q1') + 2))
  })

  it('折叠段内部编辑：折叠隐藏装饰不摘半截、不重复', () => {
    const storage = fakeStorage({ folded: new Set(['h2a']) })
    const base = EditorState.create({ schema, doc: documentFixture() })
    const { index, rebuild } = buildIndex(base, storage)
    index.decorations(base)

    const tr = base.tr.insertText('补', posOf(base.doc, 'p1a') + 2)
    const next = base.apply(tr)
    index.update(tr)
    const hot = index.decorations(next)

    expect(rebuild).toHaveBeenCalledTimes(1)
    expect(project(hot)).toEqual(project(createDocumentDecorations({ state: next, ...buildContext(storage) })))
    // 折叠隐藏装饰必须还在（整段摘除后又整段补回，改成半截这里会掉到 0）。
    expect(hot.find().filter((d) => (d.type.spec?.category || '') === 'fold-hidden').length).toBeGreaterThan(0)
  })

  it('折叠标题自身编辑：折叠装饰覆盖标题，窗口起点必须含标题', () => {
    const storage = fakeStorage({ folded: new Set(['f']) })
    const base = EditorState.create({ schema, doc: foldFixture() })
    const { index, rebuild } = buildIndex(base, storage)
    index.decorations(base)

    const tr = base.tr.insertText('改', posOf(base.doc, 'f') + 2)
    const next = base.apply(tr)
    index.update(tr)
    const hot = index.decorations(next)

    expect(rebuild).toHaveBeenCalledTimes(1)
    expect(project(hot)).toEqual(project(createDocumentDecorations({ state: next, ...buildContext(storage) })))
    const categories = hot.find().map((decoration) => decoration.type.spec?.category || '')
    // 只按「后代段」判相交时这两条会一起消失：标题上的 folded 与后代块的 fold-hidden。
    expect(categories.filter((category) => category === 'fold-hidden').length).toBeGreaterThan(0)
  })

  it('编辑折叠标题的前一个块：窗口右缘落在标题起点时折叠装饰不能丢', () => {
    const storage = fakeStorage({ folded: new Set(['f']) })
    const base = EditorState.create({ schema, doc: foldFixture() })
    const { index, rebuild } = buildIndex(base, storage)
    index.decorations(base)

    const tr = base.tr.insertText('改', posOf(base.doc, 'a') + 2)
    const next = base.apply(tr)
    index.update(tr)
    const hot = index.decorations(next)

    expect(rebuild).toHaveBeenCalledTimes(1)
    expect(project(hot)).toEqual(project(createDocumentDecorations({ state: next, ...buildContext(storage) })))
    expect(hot.find().filter((d) => (d.type.spec?.category || '') === 'fold-hidden').length).toBeGreaterThan(0)
  })

  it('窗口右缘正好落在下一个块起点：下一块的提醒蒙层不会被摘掉', () => {
    const storage = fakeStorage()
    const base = EditorState.create({ schema, doc: reminderFixture() })
    const { index, rebuild } = buildIndex(base, storage)
    index.decorations(base)

    const tr = base.tr.insertText('改', posOf(base.doc, 'a') + 2)
    const next = base.apply(tr)
    index.update(tr)
    const hot = index.decorations(next)

    expect(rebuild).toHaveBeenCalledTimes(1)
    expect(project(hot)).toEqual(project(createDocumentDecorations({ state: next, ...buildContext(storage) })))
    expect(hot.find().filter((d) => (d.type.spec?.category || '') === 'reminder').length).toBe(1)
  })

  it('在有序列表中间插入一项：属结构变更，退回全量重建（序号不得错位）', () => {
    const { hot } = expectEquivalentAfter((state) => state.tr.insert(
      // blockId 挂在 listItem 内的段落上，段落起点 = listItem 起点 + 1。
      posOf(state.doc, 'li2') - 1,
      schema.nodes.listItem.create(null, [schema.nodes.paragraph.create({ blockId: 'li1x' }, schema.text('新项'))]),
    ), { mode: 'rebuild' })
    const numbers = hot.find()
      .filter((decoration) => (decoration.type.spec?.category || '') === 'list-marker' && String(decoration.type.spec?.key || '').startsWith('lark-doc-list-number'))
      .map(labelOf)
    expect(numbers).toEqual(['1.', '2.', '3.'])
  })

  it('改缩进：属结构变更，退回全量重建（可折叠性由缩进子树决定）', () => {
    expectEquivalentAfter((state) => {
      const pos = posOf(state.doc, 'p2')
      return state.tr.setNodeMarkup(pos, null, { ...state.doc.nodeAt(pos).attrs, indent: 2 })
    }, { mode: 'rebuild' })
  })

  it('粘贴多块内容：属结构变更，退回全量重建', () => {
    expectEquivalentAfter((state) => {
      const pos = posOf(state.doc, 'p1')
      const size = state.doc.nodeAt(pos).nodeSize
      return state.tr.replaceWith(pos, pos + size, [
        schema.nodeFromJSON({ type: 'paragraph', attrs: { blockId: 'n1' }, content: [{ type: 'text', text: '粘贴一' }] }),
        schema.nodeFromJSON({ type: 'paragraph', attrs: { blockId: 'n2' }, content: [{ type: 'text', text: '粘贴二' }] }),
      ])
    }, { mode: 'rebuild' })
  })

  it('搜索高亮开着时退回全量（active 项按全文序号判定，脏区里拼不回来）', () => {
    const storage = fakeStorage({ query: '文', activeIndex: 1 })
    const base = EditorState.create({ schema, doc: documentFixture() })
    const { index, rebuild } = buildIndex(base, storage)
    index.decorations(base)

    const tr = base.tr.insertText('文', posOf(base.doc, 'p2') + 2)
    const next = base.apply(tr)
    index.update(tr)
    const hot = index.decorations(next)

    expect(rebuild).toHaveBeenCalledTimes(2) // 第二次是增量回调返回 null 后的兜底
    expect(project(hot)).toEqual(project(createDocumentDecorations({ state: next, ...buildContext(storage) })))
  })

  it('脏区之外的 widget 复用同一个 WidgetType 实例（DOM 不重建的依据）', () => {
    const { hot, initial } = expectEquivalentAfter((state) => state.tr.insertText('新', posOf(state.doc, 'p1') + 2))
    const typeAt = (set, keyPrefix) => {
      const found = set.find().find((decoration) => String(decoration.type.spec?.key || '').startsWith(keyPrefix))
      return found && found.type
    }
    const before = typeAt(initial, 'lark-doc-list-number')
    const after = typeAt(hot, 'lark-doc-list-number')
    expect(before).toBeTruthy()
    expect(after).toBe(before)
  })

  it('纯选区事务不重算装饰', () => {
    const storage = fakeStorage()
    const base = EditorState.create({ schema, doc: documentFixture() })
    const { index, rebuild, incremental } = buildIndex(base, storage)
    const first = index.decorations(base)

    const tr = base.tr.setSelection(base.selection.constructor.near(base.doc.resolve(3)))
    index.update(tr, { touchesDecorations: false })
    const second = index.decorations(base.apply(tr))

    expect(incremental).not.toHaveBeenCalled()
    expect(rebuild).toHaveBeenCalledTimes(1)
    expect(second).toBe(first)
  })
})

/**
 * 多步事务：一个 tr 里 ≥2 条 step。
 *
 * 补的是 P7 挂账 #7② —— 复核子代理当时只用 `/tmp` 上的最小 schema 跑过「多步事务退回
 * 全量」，没在真实 schema + 真实文档 fixture 上验。这里全部沿用本文件的
 * `getSchema(createLarkDocExtensions())` 与 `documentFixture()`，走真实装配路径
 * （`createDerivedIndex` + `createDocumentDecorations` / `updateDocumentDecorations`）。
 *
 * 为什么值得单独测：`isTextOnlyChange` 是 `steps.every(...)`，多步时**每一步**都要过
 * 「slice 全文字 + 落在一个文本块内」两道关。任一步不过就 `resetPending()`，本帧整份重建。
 * 而脏区的坐标记账是另一套（`mapForward` 逐步前移）——两条路径在多步下同时被使用，
 * 任一处算错都会让「窗口外的装饰」缺席或重影，且单步用例永远照不出来。
 */
describe('多步事务：增量准入与退回全量的真实 fixture 实测', () => {
  it('同一 tr 两步插入、都落在同一文本块内：仍走增量', () => {
    expectEquivalentAfter((state) => {
      const tr = state.tr.insertText('甲', posOf(state.doc, 'p1') + 2)
      // 第二处要用映射后的坐标：第一步在它之前插了 1 个字。
      tr.insertText('乙', tr.mapping.map(posOf(state.doc, 'p1') + 4))
      expect(tr.steps.length).toBe(2)
      return tr
    })
  })

  it('同一 tr 两步插入、分属两个文本块：仍走增量，两段脏区各自扩张后合并', () => {
    expectEquivalentAfter((state) => {
      const tr = state.tr.insertText('甲', posOf(state.doc, 'p1') + 2)
      tr.insertText('乙', tr.mapping.map(posOf(state.doc, 'p2') + 2))
      expect(tr.steps.length).toBe(2)
      return tr
    })
  })

  it('同一 tr 文本编辑 + 改缩进（多步）：结构变更，退回全量重建', () => {
    expectEquivalentAfter((state) => {
      const tr = state.tr.insertText('甲', posOf(state.doc, 'p1') + 2)
      const at = tr.mapping.map(posOf(state.doc, 'p2'))
      tr.setNodeMarkup(at, null, { ...tr.doc.nodeAt(at).attrs, indent: 2 })
      expect(tr.steps.length).toBe(2)
      return tr
    }, { mode: 'rebuild' })
  })

  it('同一 tr 文本编辑 + 整段替换（多步）：slice 含段落，退回全量重建', () => {
    expectEquivalentAfter((state) => {
      const tr = state.tr.insertText('甲', posOf(state.doc, 'p1') + 2)
      const at = tr.mapping.map(posOf(state.doc, 'p1a'))
      const node = tr.doc.nodeAt(at)
      tr.replaceWith(at, at + node.nodeSize, schema.nodes.paragraph.create(
        { blockId: 'p1a', indent: 1 },
        schema.text('整段换掉'),
      ))
      expect(tr.steps.length).toBe(2)
      return tr
    }, { mode: 'rebuild' })
  })

  it('同一 tr 里前一步插入大段文字、后一步仍属同块：结果必须与冷路径等价', () => {
    // 后一步的 from/to 是「第一步应用后」的坐标，而判定用的是本笔事务之前的 currentDoc，
    // 两者相差第一步的长度。错位只可能让判定偏保守（该增量却退回全量），
    // 所以这里只断言等价，不钉死路径 —— 见 expectEquivalentAfter 的 `either` 说明。
    expectEquivalentAfter((state) => {
      const tr = state.tr.insertText('很长一段填充文字', posOf(state.doc, 'p1') + 2)
      tr.insertText('乙', tr.mapping.map(posOf(state.doc, 'p1') + 6))
      expect(tr.steps.length).toBe(2)
      return tr
    }, { mode: 'either' })
  })
})

/**
 * 多笔事务：一次 `dispatch` 里可能有两笔（用户那笔 + `appendTransaction` 追加的
 * blockId 补号）。`index.update` 对每笔都调一次，`pendingSteps` 必须能叠多段 mapping
 * —— 只留最后一笔的话，前一笔的偏移会丢，脏区落到错位置。
 */
describe('多笔事务：pending 批次按出现顺序叠加', () => {
  it('两笔纯文本事务连续更新：仍走增量，脏区不残留旧坐标', () => {
    const storage = fakeStorage()
    const base = EditorState.create({ schema, doc: documentFixture() })
    const { index, rebuild, incremental } = buildIndex(base, storage)
    index.decorations(base)

    const tr1 = base.tr.insertText('甲', posOf(base.doc, 'p1') + 2)
    const s1 = base.apply(tr1)
    index.update(tr1)

    const tr2 = s1.tr.insertText('乙', posOf(s1.doc, 'p2') + 2)
    const s2 = s1.apply(tr2)
    index.update(tr2)

    const hot = index.decorations(s2)
    expect(rebuild).toHaveBeenCalledTimes(1) // 只有最初那次冷路径
    expect(incremental).toHaveBeenCalledTimes(1)
    expect(project(hot)).toEqual(project(createDocumentDecorations({ state: s2, ...buildContext(storage) })))
  })

  it('两笔事务各含结构变更（拆块 + 补 blockId）：退回全量且编号正确', () => {
    const storage = fakeStorage()
    const base = EditorState.create({ schema, doc: documentFixture() })
    const { index, rebuild, incremental } = buildIndex(base, storage)
    index.decorations(base)

    // 第一笔：在 p1 中间拆块（结构变更）
    const split = base.tr.split(posOf(base.doc, 'p1') + 3)
    const s1 = base.apply(split)
    index.update(split)
    index.decorations(s1) // 真实装配里每帧都会取装饰集，退回全量发生在这里

    // 第二笔：给新块补 blockId —— 真实装配里这笔由 appendTransaction 追加，
    // 形状就是一条 setNodeMarkup（非文本 step）。
    // split 会把 attrs 复制给两半，所以拆完有**两个** blockId 为 'p1' 的段落，
    // 补号要补的是右半那个（这也正是 collectBlockIdFixes 要处理的重号）。
    const p1Positions = []
    s1.doc.descendants((node, pos) => {
      if (node.type.name === 'paragraph' && node.attrs.blockId === 'p1') p1Positions.push(pos)
      return true
    })
    expect(p1Positions).toHaveLength(2)
    const freshPos = p1Positions[1]
    const fix = s1.tr.setNodeMarkup(freshPos, null, { ...s1.doc.nodeAt(freshPos).attrs, blockId: 'p1split' })
    const s2 = s1.apply(fix)
    index.update(fix)

    const hot = index.decorations(s2)
    expect(incremental).not.toHaveBeenCalled()
    expect(rebuild).toHaveBeenCalledTimes(3) // 初始 + 两笔各一次
    expect(project(hot)).toEqual(project(createDocumentDecorations({ state: s2, ...buildContext(storage) })))
    // 编号没被拆块打乱：仍然只有「1.」「2.」两个列表序号。
    const numbers = hot.find()
      .filter((decoration) => String(decoration.type.spec?.key || '').startsWith('lark-doc-list-number'))
      .map(labelOf)
    expect(numbers).toEqual(['1.', '2.'])
  })
})
