/**
 * P3-04 卡片块：契约层（8 KB / 版本 / provider）→ 块定义（renderHTML = 导出产物）→
 * NodeView（动作冒泡、只读态）。
 *
 * 三层用例对应三份实现，任一层失守都会让「编辑器里看得见、导出后一片空白」或
 * 「按钮点了没反应」这类问题漏到宿主侧：
 * 1. `core/embed/card.js` —— 写路径严、读路径宽容，永不抛错；
 * 2. `core/blocks/card-embed.js` —— renderHTML 必须把内容画成**静态文本**；
 * 3. `core/nodeviews/card-embed.js` —— DOM 复用 renderHTML，动作只冒泡不自作主张。
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { createLarkDocExtensions } from '../../src/components/lark-doc/extensions'
import {
  CARD_MAX_BYTES, encodeCard, isFutureCard, isKnownProvider, readCard, utf8Bytes,
} from '../../src/core/embed/card'
import { createCardEmbedNodeView } from '../../src/core/nodeviews/card-embed'

const mounted = []
afterEach(() => {
  while (mounted.length) mounted.pop().cleanup()
})

const baseCard = () => ({
  providerId: 'task_research',
  resourceId: 'tr_123',
  payload: {
    title: '2026 Q4 用户调研',
    desc: '12 题，约 3 分钟',
    fields: [{ label: '截止', value: '11-15' }],
  },
  actions: [
    { id: 'open', label: '去填写', kind: 'open', href: 'https://example.com/survey/tr_123' },
    { id: 'submit', label: '提交', kind: 'command', commandId: 'card.submit' },
  ],
})

function mountEditor(card, options = {}) {
  const editor = new Editor({
    extensions: createLarkDocExtensions({ onEmbedCardAction: options.onAction || null, embedProviders: options.providers || null }),
    content: { type: 'doc', content: [{ type: 'cardEmbed', attrs: card === undefined ? {} : { card } }] },
  })
  mounted.push({ cleanup: () => editor.destroy() })
  return editor
}

function mountNodeView(input, options = {}) {
  const card = encodeCard(input)
  const editor = mountEditor(card, options)
  const extension = editor.extensionManager.extensions.filter((item) => item.name === 'cardEmbed')[0]
  const nodeView = createCardEmbedNodeView({
    editor,
    node: editor.state.doc.firstChild,
    getPos: () => 0,
    extension,
  })
  document.body.appendChild(nodeView.dom)
  mounted.push({
    cleanup: () => {
      nodeView.destroy()
      if (nodeView.dom.parentNode) nodeView.dom.parentNode.removeChild(nodeView.dom)
    },
  })
  return { editor, nodeView, dom: nodeView.dom }
}

const actionOf = (dom, id) => dom.querySelector(`[data-card-action="${id}"]`)

describe('utf8Bytes：8 KB 按字节算，不是字符数', () => {
  it('ASCII 一字节、中文三字节、emoji 四字节', () => {
    expect(utf8Bytes('abc')).toBe(3)
    expect(utf8Bytes('中文')).toBe(6)
    expect(utf8Bytes('😀')).toBe(4)
    expect(utf8Bytes('')).toBe(0)
    expect(utf8Bytes(null)).toBe(0)
  })
})

describe('encodeCard：写路径严格，但只在三处拒收', () => {
  it('正常卡片往返一致', () => {
    const text = encodeCard(baseCard())
    const card = readCard(text)
    expect(card.providerId).toBe('task_research')
    expect(card.payload.title).toBe('2026 Q4 用户调研')
    expect(card.payload.fields).toEqual([{ label: '截止', value: '11-15' }])
    expect(card.actions.map((action) => action.id)).toEqual(['open', 'submit'])
  })

  it('cardVersion 缺省补 1；比我们新的版本允许写入（只读由渲染层判）', () => {
    expect(readCard(encodeCard(baseCard())).cardVersion).toBe(1)
    expect(readCard(encodeCard({ ...baseCard(), cardVersion: 3 })).cardVersion).toBe(3)
  })

  it('三处拒收：不是对象 / providerId 不合格 / payload.title 不合格', () => {
    expect(() => encodeCard(null)).toThrow()
    expect(() => encodeCard([])).toThrow()
    expect(() => encodeCard({ ...baseCard(), providerId: '' })).toThrow()
    expect(() => encodeCard({ ...baseCard(), payload: { desc: '没有标题' } })).toThrow()
    expect(() => encodeCard({ ...baseCard(), payload: null })).toThrow()
  })

  it('超长 desc 裁齐而不是整张拒收（用户点了确定必须有卡片落地）', () => {
    const card = readCard(encodeCard({ ...baseCard(), payload: { title: 't', desc: 'a'.repeat(2500) } }))
    expect(card.payload.desc.length).toBe(2000)
  })

  it('超长 resourceId 直接判无效（截断的 id 指向另一个对象）', () => {
    const card = readCard(encodeCard({ ...baseCard(), resourceId: 'x'.repeat(200) }))
    expect(card.resourceId).toBeNull()
  })

  it('fields 只留前 12 条，label 或 value 为空即丢', () => {
    const fields = Array.from({ length: 15 }, (_, index) => ({ label: `L${index}`, value: `V${index}` }))
    fields.push({ label: '', value: 'x' }, { label: 'x', value: '' })
    const card = readCard(encodeCard({ ...baseCard(), payload: { title: 't', fields } }))
    expect(card.payload.fields.length).toBe(12)
    expect(card.payload.fields[11]).toEqual({ label: 'L11', value: 'V11' })
  })

  it('actions 只留前 4 条、按 id 去重、拒 javascript: 与未知 kind', () => {
    const card = readCard(encodeCard({
      ...baseCard(),
      actions: [
        { id: 'a', label: 'A', kind: 'command', commandId: 'x' },
        { id: 'a', label: '重复', kind: 'command', commandId: 'y' },
        { id: 'b', label: 'B', kind: 'open', href: 'javascript:alert(1)' },
        { id: 'c', label: 'C', kind: 'unknown' },
        { id: 'd', label: 'D', kind: 'open', href: 'https://example.com' },
        { id: 'e', label: 'E', kind: 'command', commandId: 'z' },
      ],
    }))
    expect(card.actions.map((action) => action.id)).toEqual(['a', 'd', 'e'])
  })

  it('cover 只收 http(s)：data URL 会直接顶爆 8 KB', () => {
    const ok = readCard(encodeCard({ ...baseCard(), payload: { title: 't', cover: 'https://example.com/a.png' } }))
    expect(ok.payload.cover).toBe('https://example.com/a.png')
    const bad = readCard(encodeCard({ ...baseCard(), payload: { title: 't', cover: 'data:image/png;base64,AAAA' } }))
    expect(bad.payload.cover).toBeNull()
  })

  it('超 8 KB 降级成摘要：只留 identity + 120 字标题 + truncated', () => {
    const huge = encodeCard({
      ...baseCard(),
      payload: {
        title: '标'.repeat(400),
        desc: '描'.repeat(2000),
        fields: Array.from({ length: 12 }, (_, index) => ({ label: `L${index}`, value: '值'.repeat(200) })),
      },
    })
    expect(utf8Bytes(huge)).toBeLessThanOrEqual(CARD_MAX_BYTES)
    const card = readCard(huge)
    expect(card.truncated).toBe(true)
    expect(card.providerId).toBe('task_research')
    expect(card.payload.title.length).toBe(120)
    expect(card.payload.desc).toBe('')
    expect(card.payload.fields).toEqual([])
    expect(card.actions).toEqual([])
  })
})

describe('readCard：永不抛错，且不做 normalize', () => {
  it('非字符串 / 坏 JSON / 数组 / 超 8 KB 一律 null', () => {
    expect(readCard(null)).toBeNull()
    expect(readCard('')).toBeNull()
    expect(readCard('{坏 JSON')).toBeNull()
    expect(readCard('[1,2]')).toBeNull()
    expect(readCard('"字符串"')).toBeNull()
    expect(readCard(`{"a":"${'x'.repeat(CARD_MAX_BYTES)}"}`)).toBeNull()
  })

  it('未知字段原样留着 —— 不做 schema 迁移，不丢数据', () => {
    const card = readCard(JSON.stringify({ providerId: 'x', payload: { title: 't' }, futureField: { deep: 1 } }))
    expect(card.futureField).toEqual({ deep: 1 })
  })
})

describe('isFutureCard / isKnownProvider', () => {
  it('版本比我们新才是只读', () => {
    expect(isFutureCard({ cardVersion: 2 })).toBe(true)
    expect(isFutureCard({ cardVersion: 1 })).toBe(false)
    expect(isFutureCard(null)).toBe(false)
  })

  it('宿主没声明 providers 时全认 —— 否则通用布局对所有卡片都变占位', () => {
    expect(isKnownProvider('any', null)).toBe(true)
    expect(isKnownProvider('any', [])).toBe(true)
    expect(isKnownProvider('any', ['task_research'])).toBe(false)
    expect(isKnownProvider('task_research', ['task_research'])).toBe(true)
  })
})

describe('cardEmbed 块定义', () => {
  it('schema：atom + 单属性 card（default null）', () => {
    const editor = mountEditor()
    const node = editor.state.schema.nodes.cardEmbed
    expect(node.isAtom).toBe(true)
    expect(Object.keys(node.spec.attrs)).toEqual(['card'])
    expect(node.spec.attrs.card.default).toBeNull()
  })

  it('setCardEmbed 合法即落块，非法返回 false 且正文不变', () => {
    const editor = mountEditor()
    expect(editor.commands.setCardEmbed(baseCard())).toBe(true)
    expect(editor.state.doc.content.childCount).toBe(2)
    expect(editor.state.doc.child(0).attrs.card).toBeTruthy()

    const before = editor.state.doc.childCount
    expect(editor.commands.setCardEmbed({ providerId: 'x' })).toBe(false)
    expect(editor.state.doc.childCount).toBe(before)
  })

  it('renderHTML 把内容画成静态文本（导出产物不能是空白）', () => {
    const editor = mountEditor(encodeCard(baseCard()))
    const html = editor.getHTML()
    expect(html).toContain('data-type="card-embed"')
    expect(html).toContain('2026 Q4 用户调研')
    expect(html).toContain('12 题，约 3 分钟')
    expect(html).toContain('截止')
    expect(html).toContain('11-15')
    expect(html).toContain('去填写')
    expect(html).toContain('提交')
  })

  it('动作是 span[role=button] 而不是 a：编辑器不持跳转语义', () => {
    const editor = mountEditor(encodeCard(baseCard()))
    expect(editor.getHTML()).not.toContain('<a ')
    expect(editor.getHTML()).toContain('role="button"')
  })

  it('首个动作带 is-primary（动作表按优先级排列）', () => {
    const { dom } = mountNodeView(baseCard())
    const actions = dom.querySelectorAll('[data-card-action]')
    expect(actions[0].classList.contains('is-primary')).toBe(true)
    expect(actions[1].classList.contains('is-primary')).toBe(false)
  })

  it('没有 card 数据 → 占位卡，而不是空卡', () => {
    const editor = mountEditor()
    expect(editor.getHTML()).toContain('卡片数据缺失')
  })

  it('truncated 卡片带「只保留摘要」提示', () => {
    const editor = mountEditor(encodeCard({
      ...baseCard(),
      payload: { title: 't', fields: Array.from({ length: 12 }, () => ({ label: 'L', value: '值'.repeat(200) })) },
      cardVersion: 1,
      truncated: true,
    }))
    expect(editor.getHTML()).toContain('内容较大，此处只保留摘要')
  })

  it('provider 闸门：未声明的来源降级占位，但 payload 一个字节不丢', () => {
    const raw = encodeCard({ ...baseCard(), providerId: 'other_app' })
    const editor = mountEditor(raw, { providers: ['task_research'] })
    const html = editor.getHTML()
    expect(html).toContain('不支持的卡片来源')
    // 正文一个字都不画（标题 / 动作 / 字段全不渲染）；但 `data-card` 里原串仍在
    // —— 所以这里断言的是「渲染层没输出」，不是「字符串里没出现」。
    expect(html).not.toContain('lark-doc-card-title')
    expect(html).not.toContain('lark-doc-card-desc')
    expect(html).not.toContain('data-card-action')

    const reopened = mountEditor(undefined)
    reopened.commands.setContent(html)
    expect(reopened.state.doc.firstChild.attrs.card).toBe(raw)
  })

  it('DOM 往返：data-card 原串读回后逐字节相同', () => {
    const raw = encodeCard(baseCard())
    const editor = mountEditor(raw)
    const reopened = mountEditor(undefined)
    reopened.commands.setContent(editor.getHTML())
    expect(reopened.state.doc.firstChild.attrs.card).toBe(raw)
  })
})

describe('cardEmbed NodeView', () => {
  it('DOM 直接来自 renderHTML（编辑器所见 == 导出所得）', () => {
    const { editor, dom } = mountNodeView(baseCard())
    expect(dom.getAttribute('data-type')).toBe('card-embed')
    expect(dom.getAttribute('contenteditable')).toBe('false')
    expect(dom.querySelector('.lark-doc-card-title').textContent).toBe('2026 Q4 用户调研')
    expect(dom.outerHTML).toContain('12 题，约 3 分钟')
    expect(editor.getHTML()).toContain('2026 Q4 用户调研')
  })

  it('点动作 → onAction 冒泡五件套，编辑器自己不跳转', () => {
    const calls = []
    const { dom } = mountNodeView(baseCard(), { onAction: (payload) => calls.push(payload) })
    actionOf(dom, 'open').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(calls.length).toBe(1)
    expect(calls[0].providerId).toBe('task_research')
    expect(calls[0].resourceId).toBe('tr_123')
    expect(calls[0].actionId).toBe('open')
    expect(calls[0].payload.title).toBe('2026 Q4 用户调研')
    expect(calls[0].action.href).toBe('https://example.com/survey/tr_123')
  })

  it('键盘 Enter / Space 同样触发（role=button 必须能用键盘）', () => {
    const calls = []
    const { dom } = mountNodeView(baseCard(), { onAction: (payload) => calls.push(payload.actionId) })
    const target = actionOf(dom, 'submit')
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    target.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))
    expect(calls).toEqual(['submit', 'submit'])
  })

  it('宿主回调抛错不会把编辑器带崩', () => {
    const { dom } = mountNodeView(baseCard(), { onAction: () => { throw new Error('boom') } })
    expect(() => actionOf(dom, 'open').dispatchEvent(new MouseEvent('click', { bubbles: true }))).not.toThrow()
  })

  it('更高版本卡片：内容照画，动作摘掉 tabindex 且点不动', () => {
    const calls = []
    const { dom, nodeView } = mountNodeView({ ...baseCard(), cardVersion: 2 }, { onAction: (payload) => calls.push(payload) })
    expect(nodeView.readonly()).toBe(true)
    expect(dom.getAttribute('data-card-state')).toBe('readonly')
    expect(dom.innerHTML).toContain('该卡片由更高版本创建，当前仅可查看')
    const target = actionOf(dom, 'open')
    expect(target.hasAttribute('tabindex')).toBe(false)
    expect(target.getAttribute('aria-disabled')).toBe('true')
    target.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(calls.length).toBe(0)
  })

  it('stopEvent 只拦动作，卡片空白处仍交给 ProseMirror 点选', () => {
    const { dom, nodeView } = mountNodeView(baseCard())
    expect(nodeView.stopEvent({ target: actionOf(dom, 'open') })).toBe(true)
    expect(nodeView.stopEvent({ target: dom })).toBe(false)
  })

  it('update：card 与 blockId 都没动返回 true（不重画），动了返回 false（让 PM 重造）', () => {
    const { editor, nodeView } = mountNodeView(baseCard())
    const node = editor.state.doc.firstChild
    expect(nodeView.update(node)).toBe(true)

    const other = editor.state.schema.nodes.cardEmbed.create({ card: encodeCard({ ...baseCard(), payload: { title: '换了标题' } }) })
    expect(nodeView.update(other)).toBe(false)
  })
})
