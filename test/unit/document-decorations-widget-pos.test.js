// @vitest-environment jsdom
/**
 * P7-01 引入的回归守卫：widget 装饰的点击目标必须是**当前**位置，不是建 DOM 那一帧的位置。
 *
 * 为什么这条缺陷上线时没被测出来 —— 现有等价性测试抓不到它，原因有两个：
 * 1. 那条只比「位置 + 样式 + key + 分类」的投影，而 `toDOM` 闭包里的点击目标
 *    根本不在投影范围内；
 * 2. 它还用 `stripKeyPos` 把 key 里的绝对位置**故意抹掉**了 —— key 的陈旧位置
 *    本就被判为无害，于是「位置会陈旧」这件事整体被当成了已知且可接受的行为。
 *
 * 但 key 陈旧和点击目标陈旧是两回事。机制链条：
 * - 热路径靠 `previous.map` 把脏区外的装饰带到新坐标；
 * - `WidgetType.map`（prosemirror-view 1.42.7）只重算 from/to，**原样返回同一个
 *   WidgetType 实例**（dist/index.js:4018-4021）；
 * - 视图侧 `matchesWidget` 判 `widget.type.eq(this.widget.type)`，而
 *   `WidgetType.eq` 里 `this == other` 为真（dist/index.js:4023-4027）→ DOM 直接复用，
 *   `toDOM` 闭包**不会重新执行**；
 * - 闭包捕获的绝对 `pos` 因此停在编辑前的位置。
 *
 * 用户能碰到的三个后果：
 * - 列表序号：点下去菜单不弹 —— `nodeAtSafe(doc, 旧 pos)` 拿不到 listItem，直接 return；
 * - 标题编号：菜单弹了，但作用在错误的标题上；
 * - 折叠箭头：折叠了错误的块。
 *
 * 修法：闭包不再使用捕获的 `pos`，改用 ProseMirror 传给 `toDOM` 的第二个参数
 * `getPos()`（返回 widget 的当前位置），按各类 widget 的固定偏移换算回块起点。
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

/**
 * 待编辑段落 + 编号标题 + 有序列表 + 可折叠标题（带一个缩进子块）。
 *
 * 三个被测 widget 都排在 `p1` 之后：编辑 `p1` 的窗口只覆盖 p1 自己
 * （`expandBlockRange` 最多并两个块，p1 是顶层块，父级是 doc），
 * 所以它们三个必然走「脏区外 → map 带过来」这条路径。
 */
const docFixture = () => schema.nodeFromJSON({
  type: 'doc',
  content: [
    p('待编辑段落', { blockId: 'p1' }),
    h(2, '编号标题', { numbering: true, blockId: 'h' }),
    { type: 'orderedList', content: [{ type: 'listItem', content: [p('列表项', { blockId: 'li' })] }] },
    h(2, '可折叠标题', { blockId: 'fh' }),
    p('子块', { blockId: 'fhc', indent: 1 }),
  ],
})

const fakeStorage = () => ({
  folded: new Set(),
  query: '',
  activeIndex: 0,
  handleHover: null,
})

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
 * 有序列表项的起点。
 *
 * 不能拿 `posOf(doc, 'li')` 顶替：blockId 挂在列表项**内部那个段落**上，
 * listItem 自己按 block-id.js 的设计不带 blockId（结构性容器不编号），
 * 而序号 widget 的 pos 指的是 listItem —— 两者差 1。
 */
const listItemPosOf = (doc, blockId) => {
  let found = -1
  doc.descendants((node, pos) => {
    if (found >= 0) return false
    if (node.type.name === 'listItem' && node.firstChild?.attrs?.blockId === blockId) { found = pos; return false }
    return true
  })
  if (found < 0) throw new Error(`fixture 缺少列表项 ${blockId}`)
  return found
}

/**
 * 沿真实装配路径跑一次「编辑 p1 一个字」的热路径更新。
 *
 * `editor` 是共享的可变桩：`state` 在应用到新文档后才指向新文档，
 * 闭包里读的都是点击那一刻的 `editor.state`，与真实编辑器一致。
 */
const runHotPath = () => {
  const storage = fakeStorage()
  const base = EditorState.create({ schema, doc: docFixture() })
  const onHeadingNumberMenu = vi.fn()
  const onListNumberMenu = vi.fn()
  const toggleLarkDocFold = vi.fn()
  const editor = {
    isEditable: true,
    state: base,
    storage: { larkDoc: { folded: new Set() } },
    view: { nodeDOM: () => null, focus: () => {} },
    commands: { toggleLarkDocFold, setTextSelection: vi.fn() },
  }
  const ctx = { storage, editor, enabled: () => true, options: { onHeadingNumberMenu, onListNumberMenu } }
  const rebuild = vi.fn((current) => createDocumentDecorations({ state: current, ...ctx }))
  const index = createDerivedIndex({
    doc: base.doc,
    schema,
    rebuild,
    incremental: (args) => updateDocumentDecorations({ ...ctx, ...args }),
  })
  index.decorations(base)
  // 在 p1 内部插入一个字：纯文字改动 → 走脏区增量，且窗口只覆盖 p1。
  const tr = base.tr.insertText('新', posOf(base.doc, 'p1') + 2)
  const next = base.apply(tr)
  editor.state = next
  index.update(tr)
  const hot = index.decorations(next)
  // 热路径没有退回全量 —— 否则下面测的就不是这条路径了。
  expect(rebuild).toHaveBeenCalledTimes(1)
  return { base, next, hot, onHeadingNumberMenu, onListNumberMenu, toggleLarkDocFold }
}

/**
 * 按「**当前**位置 + 类别」取出 widget 装饰。
 *
 * 不能按 key 前缀取：key 里嵌的是建 DOM 那一帧的绝对位置，文档里往往有多个同类
 * widget（本 fixture 有两个折叠箭头），`find()[0]` 会拿到位置最靠前那个而不是想测的。
 * 也不能只看位置：同一位置上叠着多个 widget（折叠箭头与标题编号都在 `h + 1`），
 * 必须再按 category 定类别。
 */
const widgetAt = (set, pos, category) => {
  const found = set.find().filter(
    (decoration) => decoration.from === pos
      && decoration.type.spec?.category === category
      && typeof decoration.type.toDOM === 'function',
  )
  if (found.length !== 1) throw new Error(`位置 ${pos} 上 ${category} widget 不唯一（找到 ${found.length} 个）`)
  return found[0]
}

/** 装饰集里某一类别的全部 widget，按位置升序。 */
const widgetsOfCategory = (set, category) => set.find()
  .filter((decoration) => decoration.type.spec?.category === category && typeof decoration.type.toDOM === 'function')

/**
 * 走 ProseMirror 创建 widget DOM 的同一条路：`toDOM(view, getPos)`。
 * `getPos` 在真实视图里返回 widget 的当前位置，这里直接给 `from`（已被 map 到新坐标）。
 */
const clickWidget = (decoration) => {
  const dom = decoration.type.toDOM(null, () => decoration.from)
  dom.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  return dom
}

describe('widget 装饰的点击目标跟随当前位置（P7-01 回归）', () => {
  it('fixture 确实让后面的块整体后移一位', () => {
    const { base, next } = runHotPath()
    expect(posOf(next.doc, 'h')).toBe(posOf(base.doc, 'h') + 1)
    expect(posOf(next.doc, 'li')).toBe(posOf(base.doc, 'li') + 1)
    expect(posOf(next.doc, 'fh')).toBe(posOf(base.doc, 'fh') + 1)
  })

  it('标题编号按钮报出的是当前位置，不是建 DOM 那一帧的位置', () => {
    const { next, hot, onHeadingNumberMenu } = runHotPath()
    const heading = posOf(next.doc, 'h')
    clickWidget(widgetAt(hot, heading + 1, 'heading-number'))
    expect(onHeadingNumberMenu).toHaveBeenCalledTimes(1)
    expect(onHeadingNumberMenu.mock.calls[0][0].pos).toBe(heading)
  })

  it('列表序号按钮能弹出菜单，且报的是当前位置', () => {
    const { next, hot, onListNumberMenu } = runHotPath()
    const item = listItemPosOf(next.doc, 'li')
    clickWidget(widgetAt(hot, item + 2, 'list-marker'))
    // 旧代码在这里直接 return：nodeAtSafe(doc, 旧 pos) 拿不到 listItem。
    expect(onListNumberMenu).toHaveBeenCalledTimes(1)
    expect(onListNumberMenu.mock.calls[0][0].pos).toBe(item)
  })

  it('每个折叠箭头折叠的都是它当前所在的块', () => {
    const { next, hot, toggleLarkDocFold } = runHotPath()
    const arrows = widgetsOfCategory(hot, 'fold-toggle')
    // 文档里不止一个箭头：只测「第一个」会漏掉后面那些，逐个断言。
    expect(arrows.length).toBeGreaterThanOrEqual(2)
    arrows.forEach((arrow) => {
      toggleLarkDocFold.mockClear()
      clickWidget(arrow)
      // 箭头挂在块内容起点（非列表项 +1），落点必须是它所在的那个块。
      expect(toggleLarkDocFold).toHaveBeenCalledWith(arrow.from - 1)
    })
    expect(toggleLarkDocFold).toHaveBeenCalledWith(posOf(next.doc, 'fh'))
  })
})
