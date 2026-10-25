/**
 * P3-08 引用型卡片（`sub_page_list` / `source_synced` / `reference_synced`）。
 *
 * 验收项原文（09 §636）：**引用失效 → 置灰卡 + 可重新绑定**。所以四层都要测到，
 * 少一层就会有「状态存不下来」「置灰没生效」「重新绑定点了没反应」这类漏网：
 *
 * 1. `core/embed/reference.js` —— 三态状态机与文案（纯函数，零 DOM）；
 * 2. `core/embed/card.js` —— `reference` 键能否真的落库（以及摘要形态不能丢状态）；
 * 3. `core/blocks/card-embed.js` —— `data-reference-state` 是置灰的唯一入口；
 * 4. 命令 —— 插卡 / 置失效 / 重新绑定都走 `setNodeMarkup`，不重造节点。
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { createLarkDocExtensions } from '../../src/components/lark-doc/extensions'
import { encodeCard, readCard } from '../../src/core/embed/card'
import {
  REFERENCE_COMMAND, REFERENCE_KINDS, REFERENCE_STATE, buildReferenceCard, describeReference,
  isReferenceInactive, isReferenceKind, markReferenceStale, readReference, rebindReference,
  referenceKindLabel, toStoredReference, withReference,
} from '../../src/core/embed/reference'

const mounted = []
afterEach(() => {
  while (mounted.length) mounted.pop().cleanup()
})

function mountDoc(content, options = {}) {
  const editor = new Editor({
    extensions: createLarkDocExtensions({
      onEmbedCardAction: options.onAction || null,
      embedProviders: options.providers || null,
    }),
    content: content || { type: 'doc', content: [{ type: 'paragraph' }] },
  })
  mounted.push({ cleanup: () => editor.destroy() })
  return editor
}

/** 把引用卡对象直接塞进文档（绕过命令，专测渲染/落库）。 */
function mountCard(card, options = {}) {
  return mountDoc({
    type: 'doc',
    content: [{ type: 'cardEmbed', attrs: { card: encodeCard(card) } }],
  }, options)
}

const cardAt = (editor, index = 0) => readCard(editor.state.doc.child(index).attrs.card)
const actionIds = (card) => (card.actions || []).map((action) => action.id)

const boundCard = (kind = 'source_synced', extra = {}) => buildReferenceCard({
  kind,
  resourceId: 'doc_1',
  source: { resourceId: 'doc_1', title: '周会纪要' },
  ...extra,
})

describe('引用卡纯逻辑：三态状态机', () => {
  it('三种引用块认得出，providerId 就是块类型名', () => {
    REFERENCE_KINDS.forEach((kind) => {
      expect(isReferenceKind(kind)).toBe(true)
      expect(referenceKindLabel(kind)).not.toBe('')
    })
    expect(isReferenceKind('task_research')).toBe(false)
    expect(referenceKindLabel('task_research')).toBe('')
    expect(referenceKindLabel('source_synced')).toBe('同步块')
  })

  it('readReference 对普通卡片返回 null（调用方据此判「这不是引用卡」）', () => {
    expect(readReference({ providerId: 'task_research', resourceId: 'tr_1' })).toBe(null)
    expect(readReference(null)).toBe(null)
    expect(readReference('source_synced')).toBe(null)
  })

  it('没有 reference 字段的老数据：有 resourceId 算有效，没有算未绑定', () => {
    expect(readReference({ providerId: 'source_synced', resourceId: 'doc_1' }).state).toBe(REFERENCE_STATE.BOUND)
    expect(readReference({ providerId: 'source_synced' }).state).toBe(REFERENCE_STATE.UNBOUND)
  })

  it('写路径的 state 永远显式：读侧不必再靠 resourceId 兜底', () => {
    expect(toStoredReference('source_synced', 'doc_1', {}).state).toBe(REFERENCE_STATE.BOUND)
    expect(toStoredReference('source_synced', null, {}).state).toBe(REFERENCE_STATE.UNBOUND)
  })

  it('只给 kind = 未绑定空态卡：空态文案 + 唯一的「重新绑定」', () => {
    const card = buildReferenceCard({ kind: 'sub_page_list' })
    const reference = readReference(card)
    expect(reference.state).toBe(REFERENCE_STATE.UNBOUND)
    expect(card.resourceId).toBe(null)
    expect(card.payload.title).toBe('子页面列表')
    expect(card.payload.desc).toBe('目录下暂无子页面')
    expect(actionIds(card)).toEqual(['rebind'])
    expect(card.actions[0].commandId).toBe(REFERENCE_COMMAND.REBIND)
    expect(isReferenceInactive(card)).toBe(true)
  })

  it('有效引用：子页面列表给「打开 + 新建」，同步块只给「打开」', () => {
    const list = boundCard('sub_page_list', { count: 3 })
    expect(actionIds(list)).toEqual(['open', 'create'])
    expect(list.payload.desc).toBe('共 3 个子页面')
    expect(list.payload.fields).toContainEqual({ label: '子页面', value: '3 个' })
    expect(isReferenceInactive(list)).toBe(false)

    const synced = boundCard('source_synced')
    expect(actionIds(synced)).toEqual(['open'])
    expect(synced.actions[0].commandId).toBe(REFERENCE_COMMAND.OPEN)
    // 同步块没有子页面概念，不该凭空长出「新建」。
    expect(synced.payload.fields).toEqual([{ label: '来源', value: '周会纪要' }])
  })

  it('引用失效：原因写进 desc，动作只剩「重新绑定」；没给原因走规范文案', () => {
    const stale = markReferenceStale(boundCard(), '源文档已删除')
    expect(readReference(stale).state).toBe(REFERENCE_STATE.STALE)
    expect(stale.payload.desc).toBe('源文档已删除')
    expect(actionIds(stale)).toEqual(['rebind'])
    expect(isReferenceInactive(stale)).toBe(true)

    const noReason = markReferenceStale(boundCard(), '')
    expect(noReason.payload.desc).toBe('同步源已被删除，或当前账号无权访问')
  })

  it('重新绑定：状态回有效、旧计数消失、卡面按新目标重算', () => {
    const stale = markReferenceStale(boundCard('sub_page_list', { count: 7 }), '目录已删')
    const rebound = rebindReference(stale, { resourceId: 'dir_9', source: { resourceId: 'dir_9', title: '新目录' } })
    const reference = readReference(rebound)
    expect(reference.state).toBe(REFERENCE_STATE.BOUND)
    expect(reference.reason).toBe('')
    // `count: null` 是显式清空：换目录后旧目录的「7 个」必须消失，否则用户以为搬过来了。
    expect(reference.count).toBe(null)
    expect(rebound.payload.fields).toEqual([{ label: '来源', value: '新目录' }])
    expect(rebound.payload.desc).toBe('目录下暂无子页面')
    expect(actionIds(rebound)).toEqual(['open', 'create'])
  })

  it('reason 传空串是有效值（清掉上次的失效原因），不能被当成「没给」', () => {
    const stale = markReferenceStale(boundCard(), '源没了')
    const cleared = withReference(stale, { reason: '' })
    expect(readReference(cleared).reason).toBe('')
    expect(readReference(cleared).state).toBe(REFERENCE_STATE.STALE)
  })

  it('describeReference 是唯一渲染口径：卡面三件套与动作都由它给出', () => {
    const card = boundCard('reference_synced')
    const reference = readReference(card)
    const view = describeReference('reference_synced', card.resourceId, reference)
    expect(view.title).toBe(card.payload.title)
    expect(view.desc).toBe(card.payload.desc)
    expect(view.fields).toEqual(card.payload.fields)
    expect(view.actions).toEqual(card.actions)
  })

  it('非引用卡走状态流转返回 null，不静默改坏普通卡', () => {
    expect(withReference({ providerId: 'task_research' }, { state: REFERENCE_STATE.STALE })).toBe(null)
    expect(markReferenceStale({ providerId: 'task_research' }, 'x')).toBe(null)
    expect(rebindReference({ providerId: 'task_research' }, { resourceId: 'a' })).toBe(null)
    expect(isReferenceInactive({ providerId: 'task_research' })).toBe(false)
    expect(() => buildReferenceCard({ kind: 'task_research' })).toThrow()
  })
})

describe('引用卡落库：card.js 的 reference 键', () => {
  it('引用卡保留 reference；普通卡片塞进来也不长这个键', () => {
    const stored = readCard(encodeCard(buildReferenceCard({ kind: 'source_synced', resourceId: 'doc_1' })))
    expect(stored.reference).toEqual({
      state: REFERENCE_STATE.BOUND, reason: '', count: null,
      source: { resourceId: '', title: '' },
    })

    const plain = readCard(encodeCard({
      providerId: 'task_research',
      resourceId: 'tr_1',
      payload: { title: '调研' },
      reference: { state: 'stale' },
    }))
    expect('reference' in plain).toBe(false)
  })

  it('超 8 KB 的摘要形态不能丢引用状态（否则失效卡会「自愈」）', () => {
    const stale = markReferenceStale(boundCard('source_synced'), '源被删了')
    const fat = {
      ...stale,
      payload: {
        title: 't'.repeat(280),
        desc: '描'.repeat(1900),
        fields: Array.from({ length: 12 }, () => ({ label: 'L'.repeat(38), value: '值'.repeat(190) })),
      },
    }
    const text = encodeCard(fat)
    const stored = readCard(text)
    expect(stored.truncated).toBe(true)
    expect(stored.reference.state).toBe(REFERENCE_STATE.STALE)
    expect(readReference(stored).state).toBe(REFERENCE_STATE.STALE)
  })
})

describe('cardEmbed 块：置灰由 data-reference-state 驱动', () => {
  it('失效引用卡写 stale，且不被 provider 闸门打成占位卡', () => {
    const editor = mountCard(markReferenceStale(boundCard(), '源被删了'), { providers: ['task_research'] })
    const html = editor.getHTML()
    expect(html).toContain('data-reference-state="stale"')
    expect(html).toContain('源被删了')
    // 引用三块是内核块：宿主声明 providers 时列的是自己的业务卡，不该把内核块也拦掉。
    expect(html).not.toContain('不支持的卡片来源')
    expect(html).toContain('重新指定同步源')
  })

  it('有效与未绑定也带状态标记（宿主样式可挂钩），普通卡不带', () => {
    expect(mountCard(boundCard()).getHTML()).toContain('data-reference-state="bound"')
    expect(mountCard(buildReferenceCard({ kind: 'sub_page_list' })).getHTML())
      .toContain('data-reference-state="unbound"')
    expect(mountCard({
      providerId: 'task_research',
      payload: { title: '调研' },
    }).getHTML()).not.toContain('data-reference-state')
  })

  it('导出产物保留卡面文案与动作文字（导出只是快照，不需要可点）', () => {
    const html = mountCard(markReferenceStale(boundCard('sub_page_list'), '目录已删')).getHTML()
    expect(html).toContain('子页面列表')
    expect(html).toContain('目录已删')
    expect(html).toContain('role="button"')
    expect(html).toContain('重新绑定目录')
  })
})

describe('引用命令：改 attrs 不重造节点', () => {
  it('setReferenceCard 只给 kind 就落一张空态卡', () => {
    const editor = mountDoc()
    expect(editor.commands.setReferenceCard({ kind: 'reference_synced' })).toBe(true)
    const card = cardAt(editor)
    expect(card.providerId).toBe('reference_synced')
    expect(readReference(card).state).toBe(REFERENCE_STATE.UNBOUND)
    expect(actionIds(card)).toEqual(['rebind'])
  })

  it('setReferenceCard 拒绝非法 kind，正文不留半张卡', () => {
    const editor = mountDoc()
    expect(editor.commands.setReferenceCard({ kind: 'task_research' })).toBe(false)
    expect(editor.state.doc.childCount).toBe(1)
    expect(editor.state.doc.firstChild.type.name).toBe('paragraph')
  })

  it('markReferenceStale 两条入口都能置灰（显式 pos / 选中卡片）', () => {
    const editor = mountCard(boundCard())
    const nodeBefore = editor.state.doc.firstChild
    expect(editor.commands.markReferenceStale('源被删了', 0)).toBe(true)
    expect(readReference(cardAt(editor)).state).toBe(REFERENCE_STATE.STALE)
    expect(cardAt(editor).payload.desc).toBe('源被删了')
    // 改的是 attrs 而不是换节点：节点身份还在（`setNodeMarkup` 的口径）。
    expect(editor.state.doc.firstChild.type).toBe(nodeBefore.type)
    expect(editor.state.doc.firstChild.attrs.blockId).toBe(nodeBefore.attrs.blockId)

    editor.commands.setNodeSelection(0)
    expect(editor.commands.updateReferenceCard({ resourceId: 'doc_2' })).toBe(true)
    expect(cardAt(editor).resourceId).toBe('doc_2')
  })

  it('rebindReferenceCard 换绑后回到有效态，旧计数清空', () => {
    const editor = mountCard(markReferenceStale(boundCard('sub_page_list', { count: 5 }), '目录已删'))
    expect(editor.commands.rebindReferenceCard({ resourceId: 'dir_2', source: { title: '新目录' } }, 0)).toBe(true)
    const card = cardAt(editor)
    expect(readReference(card).state).toBe(REFERENCE_STATE.BOUND)
    expect(readReference(card).count).toBe(null)
    expect(card.payload.desc).toBe('目录下暂无子页面')
    expect(actionIds(card)).toEqual(['open', 'create'])
  })

  it('普通卡片上调用引用命令一律 false，卡片原样不动', () => {
    const editor = mountCard({ providerId: 'task_research', resourceId: 'tr_1', payload: { title: '调研' } })
    const before = editor.state.doc.firstChild.attrs.card
    expect(editor.commands.markReferenceStale('x', 0)).toBe(false)
    expect(editor.commands.rebindReferenceCard({ resourceId: 'a' }, 0)).toBe(false)
    expect(editor.commands.updateReferenceCard({ pos: 0, state: REFERENCE_STATE.STALE })).toBe(false)
    expect(editor.state.doc.firstChild.attrs.card).toBe(before)
  })

  it('光标在正文段落里（没选中卡片）时返回 false，不误改别的块', () => {
    const editor = mountDoc({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'x' }] },
        { type: 'cardEmbed', attrs: { card: encodeCard(boundCard()) } },
      ],
    })
    // 段落里的光标位置 2（段落起点 0 → 文字 1→2）。`selection.node` 为空，
    // 命令没有目标就返回 false —— 「改一张不是用户看着的卡」比失败更糟。
    editor.commands.setTextSelection(2)
    expect(editor.commands.updateReferenceCard({ state: REFERENCE_STATE.STALE })).toBe(false)
    expect(editor.commands.markReferenceStale('x')).toBe(false)
    expect(readReference(cardAt(editor, 1)).state).toBe(REFERENCE_STATE.BOUND)
  })
})
