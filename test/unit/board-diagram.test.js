/**
 * P5-05 绘图板三件（思维导图 / 流程图 / UML 图）。
 *
 * 验收项原文（09 §5.6 P5-05）：三种都是「**可插入、可绑定 resourceId、可打开**」的
 * 空态卡。所以断言分四层，一层不测就会有「插不进去」「绑了还是置灰」「打开没动作」：
 *
 * 1. `core/embed/board-diagram.js` —— 真值表与三条映射（纯数据，零 DOM）；
 * 2. `core/embed/reference.js` —— 三个 providerId 认得出、三态与文案走得通；
 * 3. `core/commands/*` —— 3 条命令在表里、连续成段、位置对、tier 是 skeleton；
 * 4. 编辑器端 —— `setReferenceCard` 真能落块、DOM 带 `data-reference-state`。
 *
 * 🔴 一条守护用例写在最后：**飞书那 4 项点下去没有任何产出**（04 §5.2 / 16 §2.11），
 * 所以这里绝不该出现 canvas / 绘图引擎的痕迹。谁哪天想「顺手补个渲染」，先看那条。
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { createLarkDocExtensions } from '../../src/components/lark-doc/extensions'
import { COMMANDS } from '../../src/core/commands'
import {
  BOARD_DIAGRAM_ITEMS, BOARD_TEMPLATES, boardLabelOf, boardProviderOf, boardTemplateOf,
} from '../../src/core/embed/board-diagram'
import { encodeCard, readCard } from '../../src/core/embed/card'
import {
  REFERENCE_COMMAND, REFERENCE_STATE, buildReferenceCard, isReferenceInactive, isReferenceKind,
  markReferenceStale, readReference, rebindReference,
} from '../../src/core/embed/reference'

const mounted = []
afterEach(() => {
  while (mounted.length) mounted.pop().cleanup()
})

function freshEditor() {
  const editor = new Editor({
    extensions: createLarkDocExtensions(),
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
  })
  mounted.push({ cleanup: () => editor.destroy() })
  document.body.appendChild(editor.view.dom)
  return editor
}

const cardsIn = (editor) => {
  const found = []
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'cardEmbed') found.push(node)
    return true
  })
  return found
}

const cardAt = (editor, index = 0) => readCard(cardsIn(editor)[index].attrs.card)

describe('真值表：三项、四项字段、与 03 §3.4 ⑥ 逐字对齐', () => {
  it('恰好 3 项，顺序是真值的 1420 / 1452 / 1484（画板不在本组）', () => {
    expect(BOARD_DIAGRAM_ITEMS).toHaveLength(3)
    expect(BOARD_DIAGRAM_ITEMS.map((item) => item.id)).toEqual(['mindMap', 'flowChart', 'umlDiagram'])
    expect(BOARD_DIAGRAM_ITEMS.map((item) => item.dataName)).toEqual([
      'diagram whiteboard mindmap', 'diagram whiteboard flowchart', 'diagram whiteboard uml',
    ])
  })

  it('label 逐字照真值（含 `UML图` 不带空格）', () => {
    expect(BOARD_DIAGRAM_ITEMS.map((item) => item.label)).toEqual(['思维导图', '流程图', 'UML图'])
  })

  it('三种模板与三个 providerId 一一对应，且 providerId 带 board_ 前缀', () => {
    expect(BOARD_TEMPLATES).toEqual(['mindmap', 'flowchart', 'uml'])
    for (const item of BOARD_DIAGRAM_ITEMS) {
      expect(item.providerId).toBe(`board_${item.template}`)
      expect(boardTemplateOf(item.providerId)).toBe(item.template)
      expect(boardLabelOf(item.providerId)).toBe(item.label)
      expect(boardProviderOf(item.id)).toBe(item.providerId)
    }
  })

  it('不是绘图的入参一律返回 null / 空串，绝不抛错', () => {
    for (const value of [null, undefined, '', 'cardEmbed', 'source_synced', 'mindmap', 42]) {
      expect(boardProviderOf(value)).toBe(null)
      expect(boardTemplateOf(value)).toBe(null)
      expect(boardLabelOf(value)).toBe('')
    }
  })

  it('providerId 全部进了 REFERENCE_KINDS（否则读侧当普通卡，三态丢失）', () => {
    for (const item of BOARD_DIAGRAM_ITEMS) {
      expect(isReferenceKind(item.providerId)).toBe(true)
    }
  })
})

describe('三态：空态可绑、绑定后可开、失效后置灰且只能重绑', () => {
  it('🔴 只给 kind = 未绑定空态卡，动作只有「绑定」', () => {
    for (const item of BOARD_DIAGRAM_ITEMS) {
      const card = buildReferenceCard({ kind: item.providerId })
      expect(card.resourceId).toBe(null)
      expect(readReference(card).state).toBe(REFERENCE_STATE.UNBOUND)
      expect(card.payload.title).toBe(item.label)
      // 空态文案要说人话（「尚未绑定 X」），不能是 loading 那种永远不来的状态
      expect(card.payload.desc).toContain('尚未绑定')
      expect(card.actions.map((action) => action.id)).toEqual(['rebind'])
      expect(card.actions[0].commandId).toBe(REFERENCE_COMMAND.REBIND)
      expect(isReferenceInactive(card)).toBe(true)
    }
  })

  it('给了 resourceId = 有效态，「打开」带 reference.open 动作', () => {
    for (const item of BOARD_DIAGRAM_ITEMS) {
      const card = buildReferenceCard({
        kind: item.providerId,
        resourceId: 'brd_2026',
        source: { resourceId: 'brd_2026', title: '需求评审导图' },
      })
      expect(readReference(card).state).toBe(REFERENCE_STATE.BOUND)
      expect(card.actions.map((action) => action.id)).toEqual(['open'])
      expect(card.actions[0].commandId).toBe(REFERENCE_COMMAND.OPEN)
      // 绘图没有「子页面」概念，不该凭空长出「新建」
      expect(card.actions.map((action) => action.id)).not.toContain('create')
      expect(card.payload.fields).toContainEqual({ label: '来源', value: '需求评审导图' })
      expect(isReferenceInactive(card)).toBe(false)
    }
  })

  it('置失效 → 置灰 + 原因，动作退回「重新绑定」', () => {
    const bound = buildReferenceCard({ kind: 'board_uml', resourceId: 'brd_1' })
    const stale = markReferenceStale(bound, '画板已删除')
    expect(readReference(stale).state).toBe(REFERENCE_STATE.STALE)
    expect(stale.payload.desc).toBe('画板已删除')
    expect(stale.actions.map((action) => action.id)).toEqual(['rebind'])
    expect(isReferenceInactive(stale)).toBe(true)
  })

  it('重新绑定 → 回到有效态、清掉原因、resourceId 换新', () => {
    const stale = markReferenceStale(buildReferenceCard({ kind: 'board_mindmap', resourceId: 'brd_old' }), '没了')
    const next = rebindReference(stale, { resourceId: 'brd_new' })
    expect(readReference(next).state).toBe(REFERENCE_STATE.BOUND)
    expect(next.resourceId).toBe('brd_new')
    expect(readReference(next).reason).toBe('')
    expect(next.actions.map((action) => action.id)).toEqual(['open'])
  })
})

describe('命令表接线', () => {
  const at = (id) => COMMANDS.findIndex((item) => item.id === id)

  it('3 条在表里，category / group / tier 都合规', () => {
    for (const item of BOARD_DIAGRAM_ITEMS) {
      const command = COMMANDS[at(item.id)]
      expect(command).toBeTruthy()
      expect(command.label).toBe(item.label)
      expect(command.category).toBe('绘图')
      expect(command.group).toBe('draw')
      // 能插入但没有引擎 —— 别因为「验收过了」就写成 required
      expect(command.tier).toBe('skeleton')
      expect(command.plus).not.toBe(false)
    }
  })

  it('🔴 连续成段，且夹在 bitableRefer 与 inlineMath 之间（组序 1164 → 1356 → 1516）', () => {
    const start = at('mindMap')
    expect(start).toBeGreaterThan(at('bitableRefer'))
    expect(at('flowChart')).toBe(start + 1)
    expect(at('umlDiagram')).toBe(start + 2)
    expect(at('inlineMath')).toBe(start + 3)
  })
})

describe('编辑器端：插得进去、落得下来、画得出来', () => {
  it('setReferenceCard({ kind }) 落一个 cardEmbed，attrs 里带 providerId 与 unbound', () => {
    const editor = freshEditor()
    expect(editor.commands.setReferenceCard({ kind: 'board_mindmap' })).toBe(true)
    expect(cardsIn(editor)).toHaveLength(1)
    const card = cardAt(editor)
    expect(card.providerId).toBe('board_mindmap')
    expect(card.resourceId).toBe(null)
    expect(readReference(card).state).toBe(REFERENCE_STATE.UNBOUND)
  })

  it('三种命令各插各的，providerId 不串味', () => {
    const editor = freshEditor()
    for (const item of BOARD_DIAGRAM_ITEMS) {
      // 每次先把光标放到文末：卡片是 `selectable` 的 atom，插完选区落在卡上，
      // 直接再插会**替换**掉上一张（PM 的正常语义，不是 bug）。
      editor.commands.setTextSelection(editor.state.doc.content.size)
      expect(editor.commands.setReferenceCard({ kind: item.providerId })).toBe(true)
    }
    expect(cardsIn(editor).map((node) => readCard(node.attrs.card).providerId))
      .toEqual(['board_mindmap', 'board_flowchart', 'board_uml'])
  })

  it('DOM 上 `data-reference-state` 是置灰的唯一入口，空态卡有它', () => {
    const editor = freshEditor()
    editor.commands.setReferenceCard({ kind: 'board_flowchart' })
    const dom = editor.view.dom.querySelector('[data-type="card-embed"]')
    expect(dom).toBeTruthy()
    expect(dom.getAttribute('data-reference-state')).toBe(REFERENCE_STATE.UNBOUND)
    // 卡面文案与唯一的「绑定」按钮都真的落在 DOM 里（导出/读屏都靠它）
    expect(dom.textContent).toContain('流程图')
    expect(dom.querySelectorAll('[data-card-action]')).toHaveLength(1)
  })

  it('绑定后同一个块变成 bound：DOM 状态翻转、动作换成「打开」', () => {
    const editor = freshEditor()
    editor.commands.setReferenceCard({ kind: 'board_uml' })
    editor.commands.rebindReferenceCard({ resourceId: 'brd_9' }, 0)
    const dom = editor.view.dom.querySelector('[data-type="card-embed"]')
    expect(dom.getAttribute('data-reference-state')).toBe(REFERENCE_STATE.BOUND)
    const actions = Array.prototype.map.call(dom.querySelectorAll('[data-card-action]'), (el) => el.getAttribute('data-card-action'))
    expect(actions).toEqual(['open'])
  })

  it('非法 kind 直接返回 false，正文里不留半点东西', () => {
    const editor = freshEditor()
    expect(editor.commands.setReferenceCard({ kind: 'not_a_board' })).toBe(false)
    expect(cardsIn(editor)).toHaveLength(0)
  })

  it('🔴 空态卡不画 canvas：飞书那 4 项点下去本就无产出，别凭空造引擎', () => {
    const editor = freshEditor()
    for (const item of BOARD_DIAGRAM_ITEMS) {
      editor.commands.setTextSelection(editor.state.doc.content.size)
      editor.commands.setReferenceCard({ kind: item.providerId })
    }
    expect(editor.view.dom.querySelector('canvas')).toBe(null)
    expect(editor.view.dom.innerHTML).not.toContain('<svg')
    // 卡是语义化 DOM：标题是 p，不是 data URI 画出来的图
    expect(editor.view.dom.querySelectorAll('.lark-doc-card-title')).toHaveLength(3)
  })

  it('落库串能原样往返（encode → read 不丢 providerId / reference）', () => {
    const card = buildReferenceCard({ kind: 'board_mindmap', resourceId: 'brd_1' })
    const round = readCard(encodeCard(card))
    expect(round.providerId).toBe('board_mindmap')
    expect(readReference(round).state).toBe(REFERENCE_STATE.BOUND)
  })
})
