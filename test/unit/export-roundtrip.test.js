/**
 * P6b-04 导出线：Markdown 往返 / docx 结构 / 统一出口 / canExport 闸门。
 *
 * 规格出处：requirements/04 §4.6.7 导出设置弹窗（三档同壳）与其下的三档派发。对应交付
 * 清单第 1–4、6、8 项（markdown.js / docx.js / pdf.js / export/index.js / exportMixin.js）。
 *
 * 本文件守护的主线只有一条：**导出的产物能不能被自己再吃回来**。
 * 分三个层次钉死：
 *   1. `md → doc → md'`（parse ∘ serialize）必须稳定到第二次 —— 这是「幂等」列；
 *   2. `md` 与 `md'` 的**块结构签名**必须一致 —— 只看字符串相等会被空白/标记风格骗过；
 *   3. `doc → md` 必须落在经验的字面 Margkdown 上 —— 这是「照抄规格」那一列。
 *
 * 四条负结论（别在这里做）：
 *   1. **不测像素**：弹窗尺寸 / 色值归 print.css 与 §4.6.7 的测量表，单测断言不到，
 *      硬写一个 720×215 的数字只会把两边一起钉死。
 *   2. **不测「文件真的落盘了」**：jsdom 里 stub 掉 anchor.click 与 URL.createObjectURL，
 *      只断言返回值（文件名 / 正文 / scope）。真下载是浏览器行为，不是本仓能测的。
 *   3. **不把已知取舍写成宽松断言**：「已知取舍」那一节是显式断言 —— 丢的东西被钉住，
 *      哪天有人改对了会**亮红**提醒同步更新清单，而不是悄悄变绿蒙混过关。
 *   4. **不 import .vue**：vitest 配置里有 .vue 门禁，这里只用 plain object 假宿主驱动
 *      exportMixin，不用挂载组件。
 */
// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  serializeMarkdown,
  parseMarkdown,
  htmlToDoc,
  escapeText,
  MD_ESCAPE_CHARS,
  MD_HARD_BREAK,
  BLOCK_SKIP,
  INLINE_FALLBACK,
} from '../../src/utils/export/markdown.js'
import {
  buildDocxElements,
  buildDocxDocument,
  buildDocx,
  buildNumberingConfig,
  DOCX_BLOCK_SKIP,
} from '../../src/utils/export/docx.js'
import { PRINT_CLASS, printDocument } from '../../src/utils/export/pdf.js'
import {
  exportMarkdown,
  exportDocx,
  exportPdf,
  safeFileName,
  withExtension,
} from '../../src/utils/export/index.js'
import exportMixin, { EXPORT_FORMATS, EXPORT_TOAST_TEXT } from '../../src/components/lark-doc/editor/exportMixin.js'

// —— 造文档的小工具（JSON 直写，不依赖编辑器实例）——

function text(value, marks) {
  return marks ? { type: 'text', text: value, marks } : { type: 'text', text: value }
}

function para(...children) {
  return { type: 'paragraph', content: children }
}

function item(node, extra) {
  return { type: 'listItem', ...extra, content: [node] }
}

function cell(type, value) {
  return { type, content: [para(text(value))] }
}

function row(...cells) {
  return { type: 'tableRow', content: cells }
}

function doc(content) {
  return { type: 'doc', content }
}

/**
 * 块结构签名：把 doc 摊成「缩进的 type 列表」。
 *
 * 为什么要有它：字符串相等会被书写风格骗过去 —— `**粗 _斜_ 粗**` 与 `**粗 *斜* 粗**`
 * 字符串不等但结构完全一致。真正要守的是结构，不是字节。
 */
function signature(target) {
  const lines = []
  const walk = (nodes, depth) => {
    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i]
      lines.push(`${'  '.repeat(depth)}${node.type}`)
      if (Array.isArray(node.content)) walk(node.content, depth + 1)
    }
  }
  walk((target && target.content) || [], 0)
  return lines.join('\n')
}

function roundTrip(markdown) {
  const once = serializeMarkdown(parseMarkdown(markdown))
  const twice = serializeMarkdown(parseMarkdown(once))
  return { once, twice }
}

/**
 * MD → doc → MD 幂等覆盖表。
 *
 * `expect` 列是该输入在**归一后**应落的规范写法。凡是输入不等于规范写法的地方
 * （松散列表收敛、软换行变空格、`_` 变 `*`），都在 `note` 里写明原因 —— 这些是刻意
 * 的 CommonMark 语义，不是 bug。
 */
const ROUND_TRIP_CASES = [
  { name: 'heading-1', md: '# 一级标题', expect: '# 一级标题' },
  { name: 'heading-2', md: '## 二级标题', expect: '## 二级标题' },
  { name: 'heading-6', md: '###### 六级标题', expect: '###### 六级标题' },
  { name: 'paragraph', md: '普通段落', expect: '普通段落' },
  { name: 'bullet-list', md: '- 一\n- 二', expect: '- 一\n- 二' },
  { name: 'bullet-list-nested', md: '- 一\n  - 一点一', expect: '- 一\n  - 一点一' },
  { name: 'bullet-list-3-level', md: '- 一\n  - 一点一\n    - 一点一一', expect: '- 一\n  - 一点一\n    - 一点一一' },
  { name: 'ordered-list', md: '1. 一\n2. 二', expect: '1. 一\n2. 二' },
  { name: 'ordered-list-nested', md: '1. 一\n   1. 一点一', expect: '1. 一\n   1. 一点一' },
  {
    name: 'ordered-list-loose',
    md: '1. 一\n\n2. 二',
    expect: '1. 一\n2. 二',
    note: '松散列表收敛为紧凑列表：ProseMirror 没有「松散」这个属性，落回 md 只能取紧凑写法',
  },
  {
    name: 'ordered-list-wide-index',
    md: '1. 一\n2. 二\n3. 三\n4. 四\n5. 五\n6. 六\n7. 七\n8. 八\n9. 九\n10. 十\n    1. 十点一',
    expect: '1. 一\n2. 二\n3. 三\n4. 四\n5. 五\n6. 六\n7. 七\n8. 八\n9. 九\n10. 十\n    1. 十点一',
    note: '序号跨到两位数时内容列跟着变宽，子块缩进必须逐项算而不是取全表最大值',
  },
  { name: 'task-list', md: '- [ ] 待办\n- [x] 已完成', expect: '- [ ] 待办\n- [x] 已完成' },
  {
    name: 'task-list-nested',
    md: '- [x] 勾选\n  - 子项',
    expect: '- [x] 勾选\n  - 子项',
    note: '勾选框是正文的一部分，内容列仍定在 `- ` 之后（2 列），不是标记长度 6 列',
  },
  { name: 'blockquote', md: '> 引用', expect: '> 引用' },
  { name: 'blockquote-list', md: '> - a\n>   - b', expect: '> - a\n>   - b' },
  { name: 'blockquote-code', md: '> ```\n> 代码块\n> ```', expect: '> ```\n> 代码块\n> ```' },
  { name: 'blockquote-in-list', md: '- 项\n  > 引用', expect: '- 项\n  > 引用' },
  { name: 'code-block-lang', md: '```js\nconst a = 1\n```', expect: '```js\nconst a = 1\n```' },
  { name: 'code-block-plain', md: '```\n纯代码\n```', expect: '```\n纯代码\n```' },
  { name: 'code-block-backtick', md: '```\na`b\n```', expect: '```\na`b\n```' },
  { name: 'horizontal-rule', md: 'a\n\n---\n\nb', expect: 'a\n\n---\n\nb' },
  { name: 'table', md: '| 列A | 列B |\n| --- | --- |\n| 1 | 2 |', expect: '| 列A | 列B |\n| --- | --- |\n| 1 | 2 |' },
  { name: 'image', md: '![图](https://x/a.png)', expect: '![图](https://x/a.png)' },
  { name: 'link', md: '[链接](https://x)', expect: '[链接](https://x)' },
  { name: 'link-paren', md: '[链接](<https://x/(a)>)', expect: '[链接](<https://x/(a)>)' },
  { name: 'marks-flat', md: '**粗** *斜* ~~删~~ `码`', expect: '**粗** *斜* ~~删~~ `码`' },
  {
    name: 'marks-nested',
    md: '**粗 _斜_ 粗**',
    expect: '**粗 *斜* 粗**',
    note: '强调标记统一成 `*`：保留 `_` 会让同义写法在 diff 里反复出现',
  },
  {
    name: 'hard-break',
    md: '第一行  \n第二行',
    expect: `第一行${MD_HARD_BREAK}第二行`,
    note: '硬换行落成 `\\` + 换行：行尾两空格形式会被多数编辑器 trim 掉',
  },
  { name: 'escape', md: 'a\\*b\\_c', expect: 'a\\*b\\_c' },
  { name: 'heading-inline', md: '# 标题**粗**', expect: '# 标题**粗**' },
  { name: 'list-item-bold', md: '- 含**粗**项', expect: '- 含**粗**项' },
  { name: 'blockquote-bold', md: '> 含**粗**引用', expect: '> 含**粗**引用' },
  { name: 'table-bold', md: '| A | B |\n| --- | --- |\n| **粗** | 2 |', expect: '| A | B |\n| --- | --- |\n| **粗** | 2 |' },
  { name: 'inline-code-backtick', md: '``带\\`反引号``', expect: '``带\\`反引号``' },
  { name: 'inline-code-backslash', md: '`a\\b`', expect: '`a\\b`' },
  { name: 'underline', md: '<u>下划</u>', expect: '<u>下划</u>' },
  { name: 'highlight', md: '<mark>高亮</mark>', expect: '<mark>高亮</mark>' },
]

describe('P6b-04 Markdown 往返：md → doc → md', () => {
  for (let i = 0; i < ROUND_TRIP_CASES.length; i += 1) {
    const itemCase = ROUND_TRIP_CASES[i]
    it(`[${itemCase.name}] 落到规范写法且第二轮稳定`, () => {
      const { once, twice } = roundTrip(itemCase.md)
      expect(once).toBe(itemCase.expect)
      expect(twice).toBe(once)
      // 结构签名：字符串相等还不够 —— 标记风格的变化不能在结构层留下痕迹。
      expect(signature(parseMarkdown(itemCase.md))).toBe(signature(parseMarkdown(once)))
    })
  }
})

/**
 * doc → Markdown 覆盖表（序列化方向）。
 *
 * 与上一张表的分工：那张是「md 进来 md 出去」，这张是「ProseMirror JSON 进来 md 出去」——
 * 真实导出路径走的是后者（`editor.getJSON()`）。
 */
const SERIALIZE_CASES = [
  { name: 'heading-clamp-9', node: { type: 'heading', attrs: { level: 9 }, content: [text('九级')] }, expect: '###### 九级' },
  { name: 'task-item', node: {
    type: 'taskList',
    content: [
      item(para(text('已完成')), { attrs: { checked: true } }),
      item(para(text('未完成')), { attrs: { checked: false } }),
    ],
  }, expect: '- [x] 已完成\n- [ ] 未完成' },
  { name: 'task-item-nested', node: {
    type: 'taskList',
    // 子列表挂在 listItem 的 content 里，不是挂在 taskList 上 —— 与 ProseMirror 的
    // 列表嵌套规则一致（父项的 content = [段落, 子列表]）。
    content: [{
      type: 'listItem',
      attrs: { checked: false },
      content: [para(text('带子的')), { type: 'bulletList', content: [item(para(text('子项')))] }],
    }],
  }, expect: '- [ ] 带子的\n  - 子项' },
  { name: 'underline-mark', node: para(text('下划', [{ type: 'underline' }])), expect: '<u>下划</u>' },
  { name: 'highlight-mark', node: para(text('高亮', [{ type: 'highlight' }])), expect: '<mark>高亮</mark>' },
  {
    name: 'link-outside-bold-inside',
    node: para(text('链接粗', [{ type: 'link', attrs: { href: 'https://x' } }, { type: 'bold' }])),
    expect: '[**链接粗**](https://x)',
  },
  { name: 'image-title', node: para({ type: 'image', attrs: { src: 'https://x/a.png', alt: '图', title: '标题' } }), expect: '![图](https://x/a.png "标题")' },
  { name: 'hard-break-node', node: para(text('第一行'), { type: 'hardBreak' }, text('第二行')), expect: `第一行${MD_HARD_BREAK}第二行` },
  { name: 'link-space', node: para(text('链接', [{ type: 'link', attrs: { href: 'https://x/a b' } }])), expect: '[链接](<https://x/a%20b>)' },
]

describe('P6b-04 doc → Markdown：逐块类型', () => {
  for (let i = 0; i < SERIALIZE_CASES.length; i += 1) {
    const itemCase = SERIALIZE_CASES[i]
    it(`[${itemCase.name}]`, () => {
      expect(serializeMarkdown(doc([itemCase.node]))).toBe(itemCase.expect)
    })
  }

  it('[empty-paragraph] 空段落不落成空行', () => {
    expect(serializeMarkdown(doc([para(), para(text('后'))]))).toBe('后')
  })

  it('[table-header-and-cell] 表头行 + 分隔行 + 数据行', () => {
    const table = {
      type: 'table',
      content: [
        row(cell('tableHeader', 'A'), cell('tableHeader', 'B')),
        row(cell('tableCell', '1'), cell('tableCell', '2')),
      ],
    }
    expect(serializeMarkdown(doc([table]))).toBe('| A | B |\n| --- | --- |\n| 1 | 2 |')
  })

  it('[inline-fallback] 三种内联原子块退化成纯文本而不是静默消失', () => {
    expect(Object.keys(INLINE_FALLBACK)).toEqual(['emoji', 'mention', 'inlineMath'])
    expect(serializeMarkdown(doc([para({ type: 'emoji', attrs: { name: 'smile' } })]))).toBe('smile')
    expect(serializeMarkdown(doc([para({ type: 'mention', attrs: { name: '张三', id: 'u1' } })]))).toBe('@张三')
    expect(serializeMarkdown(doc([para({ type: 'inlineMath', attrs: { latex: 'a+b' } })]))).toBe('$a+b$')
  })
})

describe('P6b-04 HTML → doc → Markdown', () => {
  it('标题 / 段落 / 嵌套列表 / 表格（含 thead+tbody）', () => {
    const html = '<h1>标题</h1><p>段落 <strong>粗</strong></p>'
      + '<ul><li>一<ul><li>一点一</li></ul></li></ul>'
      + '<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>'
    expect(serializeMarkdown(doc(htmlToDoc(html)))).toBe(
      '# 标题\n\n段落 **粗**\n\n- 一\n  - 一点一\n\n| A | B |\n| --- | --- |\n| 1 | 2 |',
    )
  })

  it('有序列表 / 引用 / 代码块 / 分隔线 都能归一', () => {
    const html = '<h1>标题</h1><p>段落 <em>斜</em></p><ol><li>一</li></ol>'
      + '<blockquote><p>引用</p></blockquote><pre><code>x=1</code></pre><hr>'
      + '<table><tr><th>A</th></tr><tr><td>1</td></tr></table>'
    const once = serializeMarkdown(doc(htmlToDoc(html)))
    expect(once).toBe('# 标题\n\n段落 *斜*\n\n1. 一\n\n> 引用\n\n```\nx=1\n```\n\n---\n\n| A |\n| --- |\n| 1 |')
    // 再走一轮 doc：HTML 归出来的结构必须是稳定的第二轮输入。
    expect(serializeMarkdown(parseMarkdown(once))).toBe(once)
  })

  it('空 HTML 不炸，退化成一个空段落', () => {
    expect(parseMarkdown('')).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] })
    expect(serializeMarkdown(parseMarkdown(''))).toBe('')
  })
})

describe('P6b-04 转义', () => {
  it('MD_ESCAPE_CHARS 里的字符逐个前置反斜杠', () => {
    const expected = MD_ESCAPE_CHARS.map((char) => `\\${char}`).join('')
    expect(escapeText(MD_ESCAPE_CHARS.join(''), false)).toBe(expected)
  })

  it('只有行首的 - / + / . 才转义，行中的不转义', () => {
    expect(escapeText('- 开头', true)).toBe('\\- 开头')
    expect(escapeText('- 中间', false)).toBe('- 中间')
    expect(escapeText('. 行首', true)).toBe('\\. 行首')
  })

  it('正文里的换行落成硬换行，而不是把一段劈成两块', () => {
    expect(escapeText('a\nb', false)).toBe(`a${MD_HARD_BREAK}b`)
    expect(escapeText('a\r\nb', false)).toBe(`a${MD_HARD_BREAK}b`)
  })

  it('`<e>` 这种字面标签不会被当成真 HTML 注入到导出结果里', () => {
    const once = serializeMarkdown(doc([para(text('<e>'))]))
    expect(once).toBe('\\<e\\>')
    expect(serializeMarkdown(parseMarkdown(once))).toBe(once)
  })

  it('markdown 源码里的 `\\` 不会在下一轮翻倍（曾经每转一轮翻倍一次）', () => {
    const once = serializeMarkdown(doc([para(text('a\\b'))]))
    expect(once).toBe('a\\\\b')
    expect(serializeMarkdown(parseMarkdown(once))).toBe(once)
  })
})

/**
 * 已知取舍登记。
 *
 * 这一节**不是**宽松断言：每一条都把「丢/变了什么」写成精确期望值。改对了这里会红，
 * 提醒同步更新交付报告里的「未能严格往返」清单。
 */
describe('P6b-04 已知取舍：没能严格往返的块', () => {
  it('[取舍] 引用里的软换行收敛成空格（CommonMark：同一段的续行）', () => {
    const once = serializeMarkdown(parseMarkdown('> 引用第一行\n> 引用第二行'))
    expect(once).toBe('> 引用第一行 引用第二行')
    expect(serializeMarkdown(parseMarkdown(once))).toBe(once)
  })

  it('[取舍] 表格首行非表头时会被升为表头（GFM 没有无表头表格）', () => {
    const table = { type: 'table', content: [row(cell('tableCell', 'a'), cell('tableCell', 'b'))] }
    expect(serializeMarkdown(doc([table]))).toBe('| a | b |\n| --- | --- |')
    // 一格一个 tableHeader：原本的 tableCell 升格后，单元格里的段落与文本仍在。
    expect(signature(parseMarkdown(serializeMarkdown(doc([table]))))).toBe(
      [
        'table',
        '  tableRow',
        '    tableHeader',
        '      paragraph',
        '        text',
        '    tableHeader',
        '      paragraph',
        '        text',
      ].join('\n'),
    )
  })

  it('[取舍] 表格单元格里的多块塌成一行，块间用 <br>', () => {
    const table = { type: 'table', content: [row({ type: 'tableCell', content: [para(text('甲')), para(text('乙'))] })] }
    expect(serializeMarkdown(doc([table]))).toBe('| 甲<br>乙 |\n| --- |')
  })

  it('[取舍] BLOCK_SKIP 的 12 类块不落任何 Markdown（含 blockMath / externalBlock）', () => {
    expect(BLOCK_SKIP.length).toBe(12)
    expect(BLOCK_SKIP).toContain('blockMath')
    expect(BLOCK_SKIP).toContain('externalBlock')
    const nodes = BLOCK_SKIP.map((type) => ({ type, attrs: {} }))
    const serialized = serializeMarkdown(doc([para(text('前')), ...nodes, para(text('后'))]))
    expect(serialized).toBe('前\n\n后')
    // docx 侧的跳过清单必须与 markdown 侧一致，否则「md 里没了但 Word 里还在」。
    expect(DOCX_BLOCK_SKIP).toEqual(BLOCK_SKIP)
  })

  it('[取舍] 内联原子块（emoji / mention / inlineMath）往返后丢失节点身份', () => {
    const mention = doc([para({ type: 'mention', attrs: { name: '张三', id: 'u1' } })])
    expect(signature(parseMarkdown(serializeMarkdown(mention)))).toBe(signature(doc([para(text('@张三'))])))
  })

  it('[取舍] 有序列表的序号重新从 1 数起，子块缩进跟着重排后的序号宽度走', () => {
    // 原文档第 10 项的子块缩进是 4 列，重排成第 2 项后只剩 3 列 —— 缩进取的是
    // **重排后**的标记宽度，不是原文档里的宽度。
    const once = serializeMarkdown(parseMarkdown('9. 九\n    - 九点一\n10. 十\n     - 十点一'))
    expect(once).toBe('1. 九\n   - 九点一\n2. 十\n   - 十点一')
    expect(serializeMarkdown(parseMarkdown(once))).toBe(once)
  })
})

// —— 出口层：把真实下载 stub 掉，只断言返回值 ——

let anchorClickCalls = 0
let originalAnchorClick = null
let originalCreateObjectURL = null
let originalRevokeObjectURL = null
let originalWindowPrint = null

beforeAll(() => {
  anchorClickCalls = 0
  originalAnchorClick = window.HTMLAnchorElement.prototype.click
  originalCreateObjectURL = URL.createObjectURL
  originalRevokeObjectURL = URL.revokeObjectURL
  originalWindowPrint = window.print
  window.HTMLAnchorElement.prototype.click = function click() {
    anchorClickCalls += 1
  }
  URL.createObjectURL = () => 'blob:mock'
  URL.revokeObjectURL = () => {}
  window.print = () => {}
})

afterAll(() => {
  window.HTMLAnchorElement.prototype.click = originalAnchorClick
  URL.createObjectURL = originalCreateObjectURL
  URL.revokeObjectURL = originalRevokeObjectURL
  window.print = originalWindowPrint
})

describe('P6b-04 统一出口：文件名与内容范围', () => {
  it('文件名安全化：非法字符、前导点、连续空白、空标题都兜得住', () => {
    expect(safeFileName('机密/会议:纪要')).toBe('机密-会议-纪要')
    expect(safeFileName('  ..周报  ')).toBe('周报')
    expect(safeFileName('a\\b')).toBe('a-b')
    expect(safeFileName('')).toBe('document')
    expect(withExtension('周报', 'md')).toBe('周报.md')
    expect(withExtension('  ..a  ', 'md')).toBe('a.md')
  })

  it('导出 Markdown 会真的触发一次下载，并返回正文与文件名', () => {
    anchorClickCalls = 0
    const result = exportMarkdown(doc([para(text('正文'))]), { fileName: '周报' })
    expect(anchorClickCalls).toBe(1)
    expect(result.fileName).toBe('周报.md')
    expect(result.markdown).toBe('正文')
    expect(result.scope).toBe('')
  })

  it('「仅文本」档丢掉图片（附件类本来就不落盘），「所有内容」档保留', () => {
    const withImage = doc([para(text('有图')), para({ type: 'image', attrs: { src: 'https://x/a.png', alt: '图' } })])
    const all = exportMarkdown(withImage, { fileName: 'n', scope: 'all' })
    const textOnly = exportMarkdown(withImage, { fileName: 'n', scope: 'textOnly' })
    expect(all.markdown).toContain('![图](https://x/a.png)')
    expect(textOnly.markdown).not.toContain('![图]')
    expect(textOnly.markdown).toBe('有图')
    // 丢图不能反过来改到调用方手上的 doc。
    expect(withImage.content.length).toBe(2)
  })

  it('导出 Word：返回 Blob 与文件名，没有图片时不产生失败清单', async () => {
    anchorClickCalls = 0
    const result = await exportDocx(doc([para(text('正文'))]), { fileName: '文档' })
    expect(anchorClickCalls).toBe(1)
    expect(result.fileName).toBe('文档.docx')
    expect(result.blob.size).toBeGreaterThan(0)
    expect(result.failedImages).toEqual([])
    expect(result.scope).toBe('')
  })

  it('导出 PDF：拿不到打印根时明确报 no-root，不打空打印', () => {
    expect(exportPdf(null, { scope: 'contentOnly' })).toEqual({ ok: false, reason: 'no-root', scope: 'contentOnly' })
  })

  it('导出 PDF：有根时打标记 → afterprint 清理 → scope 原样返回', () => {
    const sibling = window.document.createElement('div')
    const root = window.document.createElement('div')
    root.innerHTML = '<h2>标题</h2><table><tr><td>1</td></tr></table>'
    window.document.body.appendChild(sibling)
    window.document.body.appendChild(root)

    const result = exportPdf(root, { scope: 'contentOnly' })
    expect(result.ok).toBe(true)
    expect(result.scope).toBe('contentOnly')
    expect(root.classList.contains(PRINT_CLASS.root)).toBe(true)
    expect(sibling.classList.contains(PRINT_CLASS.hidden)).toBe(true)
    expect(root.querySelector('table').classList.contains(PRINT_CLASS.avoidBreak)).toBe(true)
    expect(root.querySelector('h2').classList.contains(PRINT_CLASS.keepWithNext)).toBe(true)

    result.cleanup()
    expect(root.classList.contains(PRINT_CLASS.root)).toBe(false)
    expect(sibling.classList.contains(PRINT_CLASS.hidden)).toBe(false)
    expect(root.querySelector('table').classList.contains(PRINT_CLASS.avoidBreak)).toBe(false)
    expect(root.querySelector('h2').classList.contains(PRINT_CLASS.keepWithNext)).toBe(false)

    root.remove()
    sibling.remove()
  })

  it('printDocument 拿不到根时不抛错，也不调用 window.print', () => {
    expect(printDocument(null).reason).toBe('no-root')
  })
})

describe('P6b-04 docx 结构', () => {
  const content = [
    { type: 'heading', attrs: { level: 2 }, content: [text('标题')] },
    para(text('粗', [{ type: 'bold' }])),
    { type: 'bulletList', content: [item(para(text('无序一'))), item(para(text('无序二')))] },
    { type: 'orderedList', content: [item(para(text('有序一'))), item(para(text('有序二')))] },
    { type: 'taskList', content: [item(para(text('待办')), { attrs: { checked: false } })] },
    { type: 'codeBlock', attrs: { language: 'js' }, content: [text('const a = 1')] },
    { type: 'blockquote', content: [para(text('引用'))] },
    { type: 'horizontalRule' },
    { type: 'table', content: [row(cell('tableHeader', 'A'), cell('tableHeader', 'B')), row(cell('tableCell', '1'), cell('tableCell', '2'))] },
  ]
  const sample = doc(content)

  it('九类块落成 10 个 Paragraph + 1 个 Table（顺序与个数都不动）', () => {
    const names = buildDocxElements(content, {}, 0).map((element) => element.constructor.name)
    expect(names).toEqual([
      'Paragraph', 'Paragraph',
      'Paragraph', 'Paragraph',
      'Paragraph', 'Paragraph',
      'Paragraph',
      'Paragraph',
      'Paragraph',
      'Paragraph',
      'Table',
    ])
  })

  it('空文档不抛错，元素数组为空（兜底空段落只在 Document 层加）', () => {
    expect(() => buildDocxDocument(doc([]), {})).not.toThrow()
    expect(buildDocxElements([], {}, 0)).toEqual([])
  })

  it('三种列表的编号 reference 必须逐个存在（缺一个 Word 打开就退化成无编号）', () => {
    const references = buildNumberingConfig().config.map((entry) => entry.reference)
    expect(references).toEqual(['bullet-0', 'ordered-0', 'task-0'])
  })

  it('Packer 能真的打包出 Blob', async () => {
    const blob = await buildDocx(sample, {})
    expect(blob.size).toBeGreaterThan(0)
  })
})

/**
 * 用 plain object 驱动 mixin：data 放进实例、methods 拷上去、computed 定义成 getter。
 *
 * 为什么不挂载真组件：vitest 有 .vue 门禁，而且这条线要守的是「闸门与派发」逻辑，
 * 挂载带来的只有模板渲染噪声。
 */
function createHost(overrides) {
  const host = { ...exportMixin.data(), ...overrides }
  Object.assign(host, exportMixin.methods)
  const computed = exportMixin.computed
  const keys = Object.keys(computed)
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i]
    Object.defineProperty(host, key, {
      get: () => computed[key].call(host),
      configurable: true,
    })
  }
  return host
}

/** `canExport` 为假的 session（只有能力查询，没有角色字段 —— 禁止自判角色）。 */
function deniedSession() {
  return { can: (name) => (name === 'canExport' ? false : true) }
}

function allowedSession() {
  return { can: () => true }
}

describe('P6b-04 exportMixin：canExport 闸门与派发', () => {
  it('三档顺序是 Word / PDF / Markdown，默认值不是「全量」', () => {
    expect(EXPORT_FORMATS.map((format) => format.id)).toEqual(['word', 'pdf', 'markdown'])
    for (let i = 0; i < EXPORT_FORMATS.length; i += 1) {
      const format = EXPORT_FORMATS[i]
      // §4.6.7② 红字：PDF/Word 默认「仅正文」，Markdown 默认「仅文本」。
      const expectedDefault = format.id === 'markdown' ? 'textOnly' : 'contentOnly'
      expect(format.defaultScope).toBe(expectedDefault)
      expect(format.options.length).toBe(2)
    }
  })

  it('无权限时提交按钮置灰，但选项一项不少（不隐藏）', () => {
    const host = createHost({ session: deniedSession() })
    host.openExportDialog('word')
    // 闸门先手：入口被挡住，压根不会开。
    expect(host.exportOpen).toBe(false)
    expect(host.exportCanExport).toBe(false)
    expect(host.exportSubmitDisabled).toBe(true)
    // 手动推成「已打开」状态，验证渲染层拿到的数据是完整的：置灰而非隐藏。
    host.exportFormat = 'word'
    expect(host.exportScopeOptions.length).toBe(2)
    expect(host.exportScopeValue).toBe('contentOnly')
    expect(host.exportPanelTitle).toBe('导出 Word 设置')
  })

  it('无权限时 submitExport 直接折返，不派发、不出 toast', async () => {
    const host = createHost({ session: deniedSession(), editor: { getJSON: () => doc([para(text('x'))]) } })
    let dispatched = 0
    host.dispatchExport = () => { dispatched += 1; return Promise.resolve(null) }
    host.exportFormat = 'markdown'
    await host.submitExport()
    expect(dispatched).toBe(0)
    expect(host.exportToast).toBe('')
    expect(host.exportBusy).toBe(false)
  })

  it('没有 session 时视为放行（同 effectiveReadonly 口径），不一刀切置灰', () => {
    expect(createHost({}).exportCanExport).toBe(true)
    expect(createHost({ session: {} }).exportCanExport).toBe(true)
  })

  it('切档时按新档重设默认值，不继承上一次的选择', () => {
    const host = createHost({ session: allowedSession() })
    host.openExportDialog('markdown')
    expect(host.exportScope).toBe('textOnly')
    host.selectExportScope('all')
    expect(host.exportScopeValue).toBe('all')
    host.openExportDialog('word')
    expect(host.exportScope).toBe('contentOnly')
    expect(host.exportScopeValue).toBe('contentOnly')
  })

  it('未知档位进不来，已开的弹窗拿不到定义时标题为空', () => {
    const host = createHost({ session: allowedSession() })
    host.openExportDialog('xlsx')
    expect(host.exportOpen).toBe(false)
    expect(host.exportPanelTitle).toBe('')
    expect(host.exportScopeOptions).toEqual([])
  })

  it('点「取消」零请求：不派发、不下载、不发接口', () => {
    anchorClickCalls = 0
    const host = createHost({ session: allowedSession(), editor: { getJSON: () => doc([para(text('x'))]) } })
    let dispatched = 0
    host.dispatchExport = () => { dispatched += 1; return Promise.resolve(null) }
    host.openExportDialog('markdown')
    host.cancelExport()
    expect(host.exportOpen).toBe(false)
    expect(dispatched).toBe(0)
    expect(anchorClickCalls).toBe(0)
    expect(host.exportToast).toBe('')
  })

  it('切 radio 是纯前端状态，不发请求', () => {
    anchorClickCalls = 0
    const host = createHost({ session: allowedSession() })
    host.openExportDialog('word')
    host.selectExportScope('withComments')
    expect(host.exportScopeValue).toBe('withComments')
    expect(anchorClickCalls).toBe(0)
  })

  it('Escape 关弹窗（挂在 window 捕获阶段，不被别的浮层互斥链吃掉）', () => {
    const host = createHost({ session: allowedSession() })
    let added = null
    const addSpy = (type, handler, capture) => { if (type === 'keydown') added = capture }
    const originAdd = window.addEventListener
    window.addEventListener = addSpy
    exportMixin.mounted.call(host)
    window.addEventListener = originAdd
    expect(added).toBe(true)

    host.openExportDialog('word')
    expect(host.exportOpen).toBe(true)
    exportMixin.methods.onExportKeydown.call(host, { key: 'Escape', stopPropagation: () => {} })
    expect(host.exportOpen).toBe(false)

    // 非 Escape 不该收弹窗。
    host.openExportDialog('word')
    exportMixin.methods.onExportKeydown.call(host, { key: 'a', stopPropagation: () => {} })
    expect(host.exportOpen).toBe(true)

    exportMixin.beforeDestroy.call(host)
  })

  it('Markdown 档提交：先关弹窗 → 出 toast → 落盘后 toast 自行消失', async () => {
    anchorClickCalls = 0
    const host = createHost({
      session: allowedSession(),
      title: '周报',
      editor: { getJSON: () => doc([para(text('正文'))]) },
    })
    host.openExportDialog('markdown')
    const pending = host.submitExport()
    expect(host.exportOpen).toBe(false)
    expect(host.exportToast).toBe(EXPORT_TOAST_TEXT)
    expect(host.exportBusy).toBe(true)
    await pending
    expect(anchorClickCalls).toBe(1)
    expect(host.exportBusy).toBe(false)
    expect(host.exportToast).toBe('')
  })

  it('提交时把 UI 选中的 scope 原样透传，档位语义不在 UI 层解释', async () => {
    const host = createHost({
      session: allowedSession(),
      title: '文档',
      editor: { getJSON: () => doc([para(text('正文'))]) },
    })
    let seen = null
    host.dispatchExport = (format, scope, fileName) => {
      seen = { format, scope, fileName }
      return Promise.resolve(null)
    }
    host.openExportDialog('word')
    host.selectExportScope('withComments')
    await host.submitExport()
    expect(seen).toEqual({ format: 'word', scope: 'withComments', fileName: '文档' })
  })

  it('PDF 档的 toast 不在这里清：由 onPrinted（afterprint）收', async () => {
    const root = window.document.createElement('div')
    root.innerHTML = '<p>正文</p>'
    window.document.body.appendChild(root)
    const host = createHost({ session: allowedSession(), title: '文档', $refs: { root } })
    host.openExportDialog('pdf')
    await host.submitExport()
    // 打印框还没关，提示条必须在。
    expect(host.exportToast).toBe(EXPORT_TOAST_TEXT)
    window.dispatchEvent(new window.Event('afterprint'))
    expect(host.exportToast).toBe('')
    root.remove()
  })

  it('没有 editor 时不派发（拿不到文档就不该出一个空文件）', async () => {
    anchorClickCalls = 0
    const host = createHost({ session: allowedSession(), title: '文档' })
    host.openExportDialog('markdown')
    await host.submitExport()
    expect(anchorClickCalls).toBe(0)
    expect(host.exportToast).toBe('')
  })

  it('文件名取编辑器标题并安全化', () => {
    const host = createHost({ localTitle: '机密/会议:纪要' })
    expect(host.exportFileBaseName).toBe('机密-会议-纪要')
    expect(createHost({}).exportFileBaseName).toBe('document')
  })
})
