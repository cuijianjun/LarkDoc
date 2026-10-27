/**
 * P4-01 `@` 提及：节点契约 → 往返序列化 → `@` 上下文判定 → 候选源排序。
 *
 * 四组用例各守一条**看起来能跑、实际会静默坏掉**的口径：
 *
 * 1. `core/blocks/mention.js` —— `mentionId` 缺失必须当场补（`setMention` 是唯一入口，
 *    漏了它 `getJSON()` 里就是「没有实例 id 的提及」，后端认不出是哪一次 @）；
 * 2. 往返 —— `getHTML()` → 再 `setContent` 回来，六个 attrs 一个不能掉
 *    （`renderHTML` 的 `data-*` 名字与 `parseHTML` 不对齐时，编辑器里完全看不出，
 *    只有「存一次盘再打开」才现形）；
 * 3. `validateDocument` 放行 mention 的四个非字符串 attrs：兜底分支只收字符串，
 *    `notify` 是布尔 —— 与 P3-07 的 `aspect` 完全同型的坑；
 * 4. `getMentionMatch` —— `a@b.com` 不能弹面板、代码里不能弹、选区非空不能弹。
 *
 * 另加 `searchMentionDirectory` 的排序与去重：面板高亮第一行是用户回车就落下的那一条，
 * 排错了等于「搜张三、@到张四」。
 */
// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { Editor, getSchema } from '@tiptap/core'
import { createLarkDocExtensions } from '../../src/components/lark-doc/extensions'
import { getMentionMatch, validateDocument } from '../../src/core/documentOperations'
import {
  MENTION_EMPTY_TEXT, MENTION_LIMITS, MENTION_UNKNOWN_NAME,
  createMentionId, mentionPlainText, normalizeMention, readMention,
} from '../../src/core/blocks/mention'
import { MENTION_SEARCH_LIMIT, createMentionProvider, searchMentionDirectory } from '../../src/core/mention/directory'
import mentionMixin from '../../src/components/lark-doc/editor/mentionMixin'

const mounted = []
afterEach(() => {
  while (mounted.length) mounted.pop()
})

function mount(content, options = {}) {
  const editor = new Editor({ extensions: createLarkDocExtensions(options), content })
  mounted.push(() => editor.destroy())
  return editor
}

/** 把光标放到正文第一个段落里的 `offset` 个字符之后。 */
function caretAt(editor, offset) {
  editor.commands.setTextSelection(1 + offset)
}

let schema
beforeAll(() => {
  schema = getSchema(createLarkDocExtensions())
})

describe('mention 节点契约', () => {
  it('mentionId 缺失时当场补一个 UUID，且同一份 attrs 只补一次', () => {
    const attrs = { kind: 'user', id: 'ou_1', name: '张三', department: '产品部' }
    const once = normalizeMention(attrs)
    expect(once.mentionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(once.notify).toBe(true)
    // 已带 mentionId 的走原值，不重新生成（否则「同一次 @」会在重放里变成两个实例）。
    expect(normalizeMention({ ...attrs, mentionId: once.mentionId }).mentionId).toBe(once.mentionId)
  })

  it('名称缺失回落「未知」，kind 越界回落 user，超长字段被截断', () => {
    const entry = normalizeMention({ kind: 'nope', name: '', id: 'x'.repeat(MENTION_LIMITS.id + 20) })
    expect(entry.kind).toBe('user')
    expect(entry.name).toBe(MENTION_UNKNOWN_NAME)
    expect(entry.id).toHaveLength(MENTION_LIMITS.id)
  })

  it('两次 createMentionId 不相等（文档内实例 id 的语义）', () => {
    expect(createMentionId()).not.toBe(createMentionId())
  })

  it('纯文本形态带 `@`：chip 里没有 @，剪贴板通道不能丢', () => {
    const editor = mount('<p></p>')
    editor.commands.setMention({ id: 'ou_1', name: '张三' })
    const node = editor.state.doc.firstChild.firstChild
    expect(mentionPlainText(node)).toBe('@张三')
    expect(readMention(node).notify).toBe(true)
    expect(readMention(editor.state.doc)).toBe(null)
  })
})

describe('mention 往返', () => {
  it('getJSON() 里是标准 mention 节点，六个 attrs 齐全', () => {
    const editor = mount('<p>前文</p>')
    editor.commands.setTextSelection(3)
    editor.commands.setMention({ kind: 'page', id: 'docX', name: '需求文档', department: '云空间', notify: false })
    const node = editor.getJSON().content[0].content[1]
    expect(node.type).toBe('mention')
    expect(node.attrs.kind).toBe('page')
    expect(node.attrs.id).toBe('docX')
    expect(node.attrs.department).toBe('云空间')
    expect(node.attrs.notify).toBe(false)
    expect(node.attrs.mentionId).toMatch(/^[\w-]{1,64}$/)
  })

  it('getHTML() 的 data-* 能被自己重新解析回来', () => {
    const editor = mount('<p></p>')
    editor.commands.setMention({ kind: 'chat', id: 'oc_9', name: '露营选品群', notify: false })
    const html = editor.getHTML()
    expect(html).toContain('data-type="mention"')
    expect(html).toContain('data-mention-kind="chat"')
    expect(html).toContain('data-notify="false"')
    const reopened = mount(html)
    const node = reopened.getJSON().content[0].content[0]
    expect(node.type).toBe('mention')
    expect(node.attrs.kind).toBe('chat')
    expect(node.attrs.id).toBe('oc_9')
    expect(node.attrs.name).toBe('露营选品群')
    expect(node.attrs.notify).toBe(false)
  })

  it('chip 是行内 atom：块数不变、纯文本带 @', () => {
    const editor = mount('<p>甲</p><p>乙</p>')
    editor.commands.setTextSelection(2)
    editor.commands.setMention({ id: 'ou_2', name: '李四' })
    expect(editor.getJSON().content).toHaveLength(2)
    expect(editor.getText()).toContain('@李四')
  })
})

describe('validateDocument × mention attrs', () => {
  function docWith(attrs) {
    return {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'mention', attrs }] }],
    }
  }

  it('notify（布尔）/ kind / mentionId / id 全部放行', () => {
    const json = validateDocument(docWith({
      kind: 'task', id: 'task-1', name: '张三', department: '运营',
      notify: false, mentionId: 'a1b2c3',
    }), schema)
    expect(json.content[0].content[0].attrs.notify).toBe(false)
  })

  it('kind 越界与 mentionId 非法形态都拒收', () => {
    expect(() => validateDocument(docWith({ kind: 'robot', name: 'x' }), schema)).toThrow()
    expect(() => validateDocument(docWith({ name: 'x', mentionId: '带空格 的' }), schema)).toThrow()
  })
})

describe('getMentionMatch', () => {
  it('行首 @ 与空白后的 @ 都触发', () => {
    const head = mount('<p>@张</p>')
    caretAt(head, 2)
    expect(getMentionMatch(head.state)).toEqual({ from: 1, to: 3, query: '张' })

    const after = mount('<p>你好 @ab</p>')
    caretAt(after, 6)
    expect(getMentionMatch(after.state)).toMatchObject({ query: 'ab' })
  })

  it('@ 前不是词边界时不触发（a@b.com 不弹面板）', () => {
    const editor = mount('<p>a@b.com</p>')
    caretAt(editor, 7)
    expect(getMentionMatch(editor.state)).toBe(null)
  })

  it('@ 后出现空白就关掉面板（查询串不跨空格）', () => {
    // 注意别写成 `<p>@张 </p>`：段落尾部空白会被 DOM 解析吃掉，光标永远落不到空格后面，
    // 这条用例就变成「永远绿」的假断言。这里让空格后面还有字。
    const editor = mount('<p>@张 你好</p>')
    caretAt(editor, 3)
    expect(getMentionMatch(editor.state)).toBe(null)
  })

  it('代码块与 code mark 内都不触发', () => {
    const block = mount('<pre><code>@a</code></pre>')
    caretAt(block, 2)
    expect(getMentionMatch(block.state)).toBe(null)

    const marked = mount('<p><code>@a</code></p>')
    caretAt(marked, 2)
    expect(getMentionMatch(marked.state)).toBe(null)
  })

  it('选区非空时不触发（选中一段再输入 @ 不该弹）', () => {
    const editor = mount('<p>@ab</p>')
    editor.commands.setTextSelection({ from: 1, to: 2 })
    expect(getMentionMatch(editor.state)).toBe(null)
  })
})

describe('searchMentionDirectory', () => {
  const directory = [
    { kind: 'user', id: 'ou_1', name: '张三', department: '产品部' },
    { kind: 'user', id: 'ou_2', name: '李张三', department: '设计部' },
    { kind: 'chat', id: 'oc_1', name: '张三的群', department: '' },
    { kind: 'page', id: 'p_1', name: '周报', department: '产品部文档' },
    // 同名不同 id = 两个同名的人：**不能**被当成重复丢掉（去重键只有 `kind:id`），
    // 面板里靠部门那一列区分，否则「@张三」会静默落到错的人身上。
    { kind: 'user', id: 'ou_3', name: '张三', department: '研发部' },
    // 同 `kind:id` 的完全重复：只留第一条。
    { kind: 'user', id: 'ou_1', name: '张三', department: '产品部' },
    // 空名：丢弃。
    { kind: 'user', id: 'ou_4', name: '' },
  ]

  it('前缀命中排在包含命中前面；同档保原序；按 kind:id 去重', () => {
    const out = searchMentionDirectory(directory, '张三', 'all')
    // 前缀档按原顺序：张三(ou_1) / 张三的群 / 张三(ou_3)，再是包含档的李张三。
    expect(out.map((item) => item.name)).toEqual(['张三', '张三的群', '张三', '李张三'])
    expect(out.map((item) => item.id)).toEqual(['ou_1', 'oc_1', 'ou_3', 'ou_2'])
  })

  it('tab 过滤只留该 kind', () => {
    expect(searchMentionDirectory(directory, '', 'chat').map((item) => item.id)).toEqual(['oc_1'])
    expect(searchMentionDirectory(directory, '产品', 'page').map((item) => item.id)).toEqual(['p_1'])
  })

  it('空查询不过滤、大小写不敏感、limit 生效', () => {
    expect(searchMentionDirectory(directory, '', 'all')).toHaveLength(5)
    expect(searchMentionDirectory([{ kind: 'user', id: 'ou_9', name: 'Alice' }], 'ali', 'all')).toHaveLength(1)
    expect(searchMentionDirectory(directory, '', 'all', 2)).toHaveLength(2)
    expect(MENTION_SEARCH_LIMIT).toBeGreaterThan(0)
  })

  it('部门命中也能搜到（排在名字命中之后）', () => {
    const out = searchMentionDirectory(directory, '设计', 'all')
    expect(out.map((item) => item.id)).toEqual(['ou_2'])
  })

  it('空态文案就是飞书那句', () => {
    expect(MENTION_EMPTY_TEXT).toBe('没有匹配结果，换个关键词试试吧')
  })
})

describe('createMentionProvider', () => {
  it('没给实现就返回 null（调用方回落本地名单，别当异常）', () => {
    expect(createMentionProvider(null)).toBe(null)
    expect(createMentionProvider([{ name: '张三' }])).toBe(null)
  })

  it('裸函数等价于 { search }，抛错与超时都 resolve 成空数组', async () => {
    const ok = createMentionProvider((query) => [{ kind: 'user', id: 'ou_1', name: query || '张三' }])
    await expect(ok.search('李四')).resolves.toEqual([
      { kind: 'user', id: 'ou_1', name: '李四', department: '', keywords: '', avatar: '' },
    ])

    const boom = createMentionProvider(() => { throw new Error('network') })
    await expect(boom.search('x')).resolves.toEqual([])

    const slow = createMentionProvider({ search: () => new Promise(() => {}), timeout: 5 })
    await expect(slow.search('x')).resolves.toEqual([])
  })
})

/**
 * 面板文案的来源必须与定义处一致。
 *
 * 曾经 `mentionMixin.js` 把 `MENTION_EMPTY_TEXT` 和三个 directory 函数写在同一行 import 里，
 * 而 `core/mention/directory` 并不导出它 —— 打包器只吐一句
 * 「export 'MENTION_EMPTY_TEXT' was not found」，运行期拿到 `undefined`，
 * 面板空态（`{{ mentionLoading ? '搜索中…' : mentionEmptyText }}`）渲染成**空白**。
 * 没有任何断言看得见这件事，所以在这里钉住：mixin 暴露的文案必须是那句真话。
 */
describe('mention 面板文案 × mixin', () => {
  it('mixin 的 mentionEmptyText 是真实文案，不是 undefined', () => {
    expect(mentionMixin.data().mentionEmptyText).toBe(MENTION_EMPTY_TEXT)
    expect(typeof mentionMixin.data().mentionEmptyText).toBe('string')
    expect(mentionMixin.data().mentionEmptyText.length).toBeGreaterThan(0)
  })
})
