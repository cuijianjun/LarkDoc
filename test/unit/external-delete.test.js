/**
 * 17 §17.5 表头：「Delete 对块一律放行，统一走 `BlockModuleAPI.remove`」。
 *
 * 这里守的是**删除路径的唯一性**，不是键盘手感：
 *
 * 1. `externalDeleteTargets` 只在两条真实路径上给答案 —— 整块选中、光标贴邻段落的首/尾；
 *    其余一切情况返回空数组，按键交回 ProseMirror 默认（不能把普通排版键吃掉）；
 * 2. 命中后真的走了 `remove` —— 判据是「块没了，且同一次按键只产生一步撤销」；
 * 3. 表格骨架里的块不接（`remove` 本来就不动它），交回默认，按键不能没反应。
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import { createLarkDocExtensions } from '../../src/components/lark-doc/extensions'
import { createBlockApi } from '../../src/core/blockApi'
import { externalDeleteTargets } from '../../src/core/blocks/external-delete'

const card = (id, kind = 'jira_issue') => ({
  type: 'externalBlock',
  attrs: { blockId: id, kind, title: 'DOC-7', provider: 'jira' },
})
const para = (id, text) => ({ type: 'paragraph', attrs: { blockId: id }, content: [{ type: 'text', text }] })

let editor = null
afterEach(() => {
  if (editor) { editor.destroy(); editor = null }
})

function setup(content) {
  if (editor) editor.destroy()
  editor = new Editor({ extensions: createLarkDocExtensions(), content: { type: 'doc', content } })
  return editor
}

/** 真走一遍 PM 的 handleKeyDown 链（keymap 插件就是这条路上挂的）。 */
function pressKey(ed, key) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  return ed.view.someProp('handleKeyDown', (handler) => handler(ed.view, event)) || false
}

/** 只问本扩展那一个 handler 的返回值（不被 baseKeymap 顺带返回的 true 混淆）。 */
function ownHandler(ed, key) {
  const ext = ed.extensionManager.extensions.find((item) => item.name === 'larkDocExternalDelete')
  const shortcuts = ext.config.addKeyboardShortcuts.call(ext)
  return shortcuts[key]()
}

const idsOf = (doc) => {
  const out = []
  doc.descendants((node) => {
    if (typeof node.attrs.blockId === 'string') out.push(node.attrs.blockId)
    return true
  })
  return out
}

describe('externalDeleteTargets：只认两条真实路径', () => {
  it('整块选中（点卡片 / 方向键走到 atom）→ 给这一个 id', () => {
    const ed = setup([card('x'), para('p', 'P')])
    const selection = NodeSelection.create(ed.state.doc, 0)
    expect(externalDeleteTargets(ed.state.doc, selection, 'Backspace')).toEqual(['x'])
    expect(externalDeleteTargets(ed.state.doc, selection, 'Delete')).toEqual(['x'])
  })

  it('整块选中的是普通块 → 不归这里管', () => {
    const ed = setup([card('x'), para('p', 'P')])
    const selection = NodeSelection.create(ed.state.doc, 1)
    expect(externalDeleteTargets(ed.state.doc, selection, 'Backspace')).toEqual([])
  })

  it('光标在卡片后一段的行首按 Backspace → 吞掉前一块卡片', () => {
    const ed = setup([card('x'), para('p', 'P')])
    const selection = TextSelection.create(ed.state.doc, 2)
    expect(externalDeleteTargets(ed.state.doc, selection, 'Backspace')).toEqual(['x'])
    // Delete 在行首不该动前面的块
    expect(externalDeleteTargets(ed.state.doc, selection, 'Delete')).toEqual([])
  })

  it('光标在卡片前一段的行尾按 Delete → 吞掉后一块卡片', () => {
    const ed = setup([para('p', 'P'), card('x')])
    const end = 1 + 1
    const selection = TextSelection.create(ed.state.doc, end)
    expect(externalDeleteTargets(ed.state.doc, selection, 'Delete')).toEqual(['x'])
    expect(externalDeleteTargets(ed.state.doc, selection, 'Backspace')).toEqual([])
  })

  it('光标在段落中间 / 容器内部 / 文档边界 → 一律交回默认', () => {
    const ed = setup([card('x'), para('p', 'hello')])
    // 段落中间（parentOffset 既非 0 也非末尾）
    expect(externalDeleteTargets(ed.state.doc, TextSelection.create(ed.state.doc, 4), 'Backspace')).toEqual([])
    // 末块行尾：后面没有块可吞
    expect(externalDeleteTargets(ed.state.doc, TextSelection.create(ed.state.doc, 7), 'Delete')).toEqual([])

    // 首段行首：前面没有块可吞
    const alone = setup([para('q', 'hi')])
    expect(externalDeleteTargets(alone.state.doc, TextSelection.create(alone.state.doc, 1), 'Backspace')).toEqual([])
  })
})

describe('键盘收口：命中即走 BlockModuleAPI.remove', () => {
  it('行首 Backspace 删卡片，且一步撤销只回退这一下', () => {
    const ed = setup([card('x'), para('p', 'P')])
    expect(idsOf(ed.state.doc)).toEqual(['x', 'p'])
    ed.commands.setTextSelection(2)
    expect(pressKey(ed, 'Backspace')).toBe(true)
    expect(idsOf(ed.state.doc)).toEqual(['p'])
    // 一步撤销：卡片回来
    ed.commands.undo()
    expect(idsOf(ed.state.doc)).toEqual(['x', 'p'])
  })

  it('整块选中按 Delete：删干净，且不留空 doc（兜底空段落）', () => {
    const ed = setup([card('x')])
    ed.commands.setNodeSelection(0)
    expect(pressKey(ed, 'Delete')).toBe(true)
    expect(ed.state.doc.childCount).toBe(1)
    expect(ed.state.doc.child(0).type.name).toBe('paragraph')
  })

  it('与外部块无关的按键原样交回默认（不能把普通排版键吃掉）', () => {
    const ed = setup([para('a', 'AB'), para('b', 'CD')])
    ed.commands.setTextSelection(2)
    expect(pressKey(ed, 'Backspace')).toBe(false)
    expect(ed.state.doc.textContent).toBe('ABCD')
  })

  it('表格骨架内的块不接：交回默认，按键不静默消失', () => {
    const ed = setup([{
      type: 'table',
      content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [card('x')] }] }],
    }])
    const api = createBlockApi({ editor: ed })
    // remove 本来就把表格内的块挡在外面 —— 所以键盘层必须交回默认，而不是「按下没反应」
    api.remove('x')
    expect(api.get('x')).not.toBeNull()

    // 纯函数这一层是「该删这个 id」，过滤器再按 inTableContext 把它摘掉
    const inCell = (() => {
      let pos = null
      ed.state.doc.descendants((node, nodePos) => {
        if (node.type.name === 'externalBlock') { pos = nodePos; return false }
        return true
      })
      return NodeSelection.create(ed.state.doc, pos)
    })()
    expect(externalDeleteTargets(ed.state.doc, inCell, 'Backspace')).toEqual(['x'])

    // 直接问我们这个 handler 的返回值：false = 交回 PM 默认（表格删除有自己的规矩）
    ed.commands.setNodeSelection(inCell.from)
    expect(ownHandler(ed, 'Backspace')).toBe(false)
    expect(api.get('x')).not.toBeNull()
  })
})
