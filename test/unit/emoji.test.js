/**
 * P4-03 表情面板全量：名字归一化 → 双向查表 → 面板搜索 → 行内节点往返 → 高亮块白名单。
 *
 * 五组用例各守一条**看起来能跑、实际会静默坏掉**的口径：
 *
 * 1. `normalizeEmojiName` —— 去首尾冒号 + 小写 + 截 64。只在一侧归一化，就会出现
 *    「插入时能显示，存一次盘再打开变成 `:smile:` 纯文本」这类最典型的坏法。
 * 2. 双向查表 —— `findEmojiByName` 必须兜住 0.11 的 4 个旧短名（📌/✅/💬/🎯 已经不是
 *    emojibase 主名），否则老文档里这些图标全变纯文本；`findEmojiByGlyph` 必须剥 VS16，
 *    因为历史数据 `👍`/`👍️` 两种都存过。
 * 3. `searchEmoji` —— 中文名与英文名都能过滤（02 §16 ④）；分类参数漏传会把「笑脸」tab
 *    渲染成整库 1898 条。
 * 4. 行内节点往返 —— `data-name` 干净、`renderHTML`/`parseHTML` 对齐；未知名字回退
 *    `:name:` 纯文本且**不抛错**（一条坏数据不能拖垮整篇渲染）。
 * 5. 高亮块白名单 —— 12 个硬编码扩到全量后，`blocks/callout.js` 与 `documentOperations.js`
 *    必须同源，一侧松一侧紧会出现「能存不能读」。
 */
// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { Editor, getSchema } from '@tiptap/core'
import { createLarkDocExtensions } from '../../src/components/lark-doc/extensions'
import { validateDocument } from '../../src/core/documentOperations'
import { CALLOUT_EMOJI_DEFAULT, safeCalloutEmoji } from '../../src/core/blocks/callout'
import { EMOJI_DEFAULT_NAME } from '../../src/core/blocks/emoji'
import {
  EMOJI_GROUP_META, EMOJI_NAME_MAX, emojiCategories, emojiGroupOf, emojiItems,
  findEmojiByGlyph, findEmojiByName, isEmojiGlyph,
  normalizeEmojiGlyph, normalizeEmojiName, searchEmoji,
} from '../../src/core/emoji/catalog'

const mounted = []
afterEach(() => {
  while (mounted.length) mounted.pop()()
})

function mount(content) {
  const editor = new Editor({ extensions: createLarkDocExtensions(), content })
  mounted.push(() => editor.destroy())
  return editor
}

let schema
beforeAll(() => {
  schema = getSchema(createLarkDocExtensions())
})

describe('名字归一化 normalizeEmojiName（02 §16 ⑤：去冒号 / 小写 / 截 64）', () => {
  it('去首尾冒号 + 小写 + trim，两侧都有冒号也只剥一层', () => {
    expect(normalizeEmojiName(':SMILE:')).toBe('smile')
    expect(normalizeEmojiName('  ThumbsUp  ')).toBe('thumbsup')
    expect(normalizeEmojiName(':smile')).toBe('smile')
    expect(normalizeEmojiName('smile:')).toBe('smile')
    // 中间冒号不属于「首尾」，不剥 —— 剥了会把 `a:b` 变成查不到的 `b`。
    expect(normalizeEmojiName('a:b')).toBe('a:b')
  })

  it('超 64 截断（不是拒绝：写入侧只截不断，避免用户输入被静默丢弃）', () => {
    const long = `:${'a'.repeat(80)}:`
    expect(normalizeEmojiName(long)).toHaveLength(EMOJI_NAME_MAX)
    expect(EMOJI_NAME_MAX).toBe(64)
  })

  it('非字符串一律空串（null 不变成 `null` 字符串）', () => {
    expect(normalizeEmojiName(null)).toBe('')
    expect(normalizeEmojiName(undefined)).toBe('')
    expect(normalizeEmojiName(42)).toBe('')
    expect(normalizeEmojiName({})).toBe('')
  })
})

describe('字形归一化 normalizeEmojiGlyph（VS16 陷阱）', () => {
  it('剥掉 U+FE0F，双向都能对上同一张表', () => {
    expect(normalizeEmojiGlyph('❤️')).toBe(normalizeEmojiGlyph('❤'))
    expect(normalizeEmojiGlyph('👍️')).toBe(normalizeEmojiGlyph('👍'))
    expect(normalizeEmojiGlyph(null)).toBe('')
  })
})

describe('双向查表 findEmojiByName / findEmojiByGlyph', () => {
  it('主名可查，且回查出来的字形属于同一个名字', () => {
    const item = findEmojiByName('smile')
    expect(item).toBeTruthy()
    expect(item.value).toBe('smile')
    expect(item.glyph).toBe('😄')
    expect(findEmojiByGlyph(item.glyph)).toBe(item)
  })

  it('名字查表对冒号与大小写不敏感（同一份归一化）', () => {
    expect(findEmojiByName(':SMILE:')).toBe(findEmojiByName('smile'))
    expect(findEmojiByName('  Smile ')).toBe(findEmojiByName('smile'))
  })

  it('0.11 的 4 个旧短名兜住，老文档不会退化成纯文本', () => {
    // 断言统一过一遍 normalizeEmojiGlyph：emojibase 的 unicode 自带 VS16
    // （`✅️` = U+2705 U+FE0F、`📌️` 同理），写入侧保留原样是既定口径，
    // 这里只关心「查得到、且是同一个图形」。
    expect(normalizeEmojiGlyph(findEmojiByName('pin').glyph)).toBe(normalizeEmojiGlyph('📌'))
    expect(normalizeEmojiGlyph(findEmojiByName('check').glyph)).toBe(normalizeEmojiGlyph('✅'))
    expect(normalizeEmojiGlyph(findEmojiByName('comment').glyph)).toBe(normalizeEmojiGlyph('💬'))
    expect(normalizeEmojiGlyph(findEmojiByName('target').glyph)).toBe(normalizeEmojiGlyph('🎯'))
  })

  it('未收录 / 空值 → null（不返回占位条目，回退形态交给调用方）', () => {
    expect(findEmojiByName('不存在的表情')).toBe(null)
    expect(findEmojiByName('')).toBe(null)
    expect(findEmojiByName(null)).toBe(null)
    expect(findEmojiByGlyph('')).toBe(null)
    expect(findEmojiByGlyph('不是表情')).toBe(null)
  })

  it('带不带 VS16 都能查到同一个条目（历史数据两种都存过）', () => {
    expect(findEmojiByGlyph('❤️')).toBe(findEmojiByGlyph('❤'))
    expect(findEmojiByGlyph('✅️')).toBe(findEmojiByGlyph('✅'))
  })
})

describe('面板搜索 searchEmoji（02 §16 ④：英文名或中文都能过滤）', () => {
  it('英文名匹配', () => {
    const hits = searchEmoji('smile')
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.every((item) => `${item.label} ${item.value} ${item.glyph}`.toLowerCase().includes('smile'))).toBe(true)
    expect(hits.some((item) => item.value === 'smile')).toBe(true)
  })

  it('中文名匹配（`笑` 能搜到笑脸组）', () => {
    const hits = searchEmoji('笑')
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.some((item) => item.category === '笑脸')).toBe(true)
  })

  it('空关键词 → 全库；带分类 → 只回该组', () => {
    expect(searchEmoji('')).toHaveLength(emojiItems.length)
    expect(searchEmoji(null)).toHaveLength(emojiItems.length)
    const smileys = searchEmoji('', '笑脸')
    expect(smileys.length).toBeGreaterThan(0)
    expect(smileys.length).toBeLessThan(emojiItems.length)
    expect(smileys.every((item) => item.category === '笑脸')).toBe(true)
  })

  it('分类 + 关键词同时生效，且搜不到时返回空数组而不是 null', () => {
    expect(searchEmoji('smile', '旗帜')).toHaveLength(0)
    expect(Array.isArray(searchEmoji('不存在的表情'))).toBe(true)
    expect(searchEmoji('不存在的表情')).toHaveLength(0)
  })

  it('字形本身也能搜（粘贴一个 emoji 进搜索框不至于立刻空列表）', () => {
    const unicorn = findEmojiByName('unicorn')
    expect(unicorn).toBeTruthy()
    expect(searchEmoji(unicorn.glyph).some((item) => item.glyph === unicorn.glyph)).toBe(true)
  })
})

describe('分类表（9 组，与面板 tab 顺序一致）', () => {
  it('emojiCategories 就是 9 个组名，且每组都真的有条目', () => {
    expect(emojiCategories).toEqual(EMOJI_GROUP_META.map((group) => group.label))
    expect(emojiCategories).toHaveLength(9)
    emojiCategories.forEach((category) => {
      expect(emojiItems.some((item) => item.category === category)).toBe(true)
    })
  })

  it('emojiItems 每条都有 value / label / glyph / category 四字段，且 value 全局唯一', () => {
    // 1898 是 `scripts/build-emoji-catalog.js` 的当前输出（1933 条原始数据减去
    // component 9 / 无分组 26），上界卡在 1900 会随 emojibase 小版本抖动，直接对齐实测值。
    expect(emojiItems.length).toBe(1898)
    emojiItems.forEach((item) => {
      expect(typeof item.value).toBe('string')
      expect(item.value).not.toBe('')
      expect(typeof item.label).toBe('string')
      expect(item.label).not.toBe('')
      expect(typeof item.glyph).toBe('string')
      expect(item.glyph).not.toBe('')
      expect(emojiCategories).toContain(item.category)
    })
    expect(new Set(emojiItems.map((item) => item.value)).size).toBe(emojiItems.length)
  })

  it('emojiGroupOf 回组名，未知字形回空串', () => {
    expect(emojiGroupOf('😄')).toBe('笑脸')
    expect(emojiGroupOf('🦄')).toBe('野生动物')
    expect(emojiGroupOf('不是表情')).toBe('')
    expect(emojiGroupOf('')).toBe('')
  })
})

describe('行内 emoji 节点（02 §16 ⑤）', () => {
  it('schema 里是 inline atom 节点，默认名沿用 0.11 的 smile（快照不许变）', () => {
    const node = schema.nodes.emoji
    expect(node).toBeTruthy()
    expect(node.isInline).toBe(true)
    expect(node.isAtom).toBe(true)
    expect(node.spec.group).toBe('inline')
    expect(node.spec.attrs.name.default).toBe('smile')
    expect(EMOJI_DEFAULT_NAME).toBe('smile')
  })

  it('getHTML 渲染图形字符，data-name 是归一化后的干净名字', () => {
    const editor = mount('<p>前<span data-type="emoji" data-name=":SMILE:"></span>后</p>')
    const html = editor.getHTML()
    expect(html).toContain('data-type="emoji"')
    expect(html).toContain('data-name="smile"')
    expect(html).toContain('😄')
  })

  it('未收录的名字回退 `:name:` 纯文本，不抛错、不吞掉整篇', () => {
    const editor = mount('<p>甲<span data-type="emoji" data-name="不存在的表情"></span>乙</p>')
    const html = editor.getHTML()
    expect(html).toContain(':不存在的表情:')
    // 前后文必须还在 —— 「渲染失败就整块消失」是最难排查的一种坏法。
    expect(html).toContain('甲')
    expect(html).toContain('乙')
  })

  it('空串 → `::`，属性缺失 → `:null:`（两种「空」不能混成一种）', () => {
    const editor = mount('<p></p>')
    // 走 insertContent 而不是裸 tr.insert：后者要自己算 pos，空段落里第 2 次插入用
    // 的还是插入前的 nodeSize，两个节点都进不去 doc（静默过、不留痕）。
    editor.commands.insertContent({ type: 'emoji', attrs: { name: '' } })
    editor.commands.insertContent({ type: 'emoji', attrs: { name: null } })
    const html = editor.getHTML()
    expect(html).toContain('::')
    expect(html).toContain(':null:')
    // null 不能被字符串化成 `data-name="null"` —— 那样重新打开会查一个叫 null 的表情。
    expect(html).not.toContain('data-name="null"')
    const [empty, missing] = editor.getJSON().content[0].content
    expect(empty.attrs.name).toBe('')
    expect(missing.attrs.name).toBe(null)
  })

  it('往返一次名字不变形（`:SMILE:` 写进去、读回来是 `smile`）', () => {
    const editor = mount('<p></p>')
    editor.commands.setEmoji(':SMILE:')
    expect(editor.getJSON().content[0].content[0].attrs.name).toBe('smile')
    const reopened = mount(editor.getHTML())
    expect(reopened.getJSON().content[0].content[0].attrs.name).toBe('smile')
  })

  it('setEmoji 空入参回落默认名，不写一个空名字进正文', () => {
    const editor = mount('<p></p>')
    editor.commands.setEmoji('')
    expect(editor.getJSON().content[0].content[0].attrs.name).toBe(EMOJI_DEFAULT_NAME)
    editor.commands.setEmoji(null)
    expect(editor.getJSON().content[0].content[1].attrs.name).toBe(EMOJI_DEFAULT_NAME)
  })
})

describe('高亮块图标白名单（12 个硬编码 → 全量，两侧同源）', () => {
  it('默认值与 safeCalloutEmoji 回落都是 💡（02 §654）', () => {
    expect(CALLOUT_EMOJI_DEFAULT).toBe('💡')
    expect(schema.nodes.callout.spec.attrs.emoji.default).toBe('💡')
    expect(safeCalloutEmoji('🦄')).toBe('🦄')
    expect(safeCalloutEmoji('不是表情')).toBe('💡')
    expect(safeCalloutEmoji(null)).toBe('💡')
  })

  it('isEmojiGlyph 认全量：老 12 个、新收录的都放行，乱码/URL 全拒', () => {
    ['💡', '🌟', '📌', '✅', '💬', '🎯', '🎉', '🔥', '⚠️', '❤️', '👍', '😄'].forEach((glyph) => {
      expect(isEmojiGlyph(glyph)).toBe(true)
    })
    expect(isEmojiGlyph('🦄')).toBe(true)
    expect(isEmojiGlyph('javascript:alert(1)')).toBe(false)
    expect(isEmojiGlyph('')).toBe(false)
    expect(isEmojiGlyph(null)).toBe(false)
  })

  it('callout 属性往返：data-emoji 存字形，新收录的图标也能存能读', () => {
    const editor = mount('<p>正文</p>')
    editor.commands.setTextSelection(2)
    editor.commands.insertContent({ type: 'callout', attrs: { emoji: '🦄' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '高亮' }] }] })
    expect(editor.getHTML()).toContain('data-emoji="🦄"')
    const reopened = mount(editor.getHTML())
    const callout = reopened.getJSON().content.find((node) => node.type === 'callout')
    expect(callout.attrs.emoji).toBe('🦄')
  })

  it('validateDocument 与 schema 同一张表：全量图标放行，非法值抛「无效高亮块图标」', () => {
    const docWith = (emoji) => ({
      type: 'doc',
      content: [{ type: 'callout', attrs: { emoji }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] }],
    })
    expect(() => validateDocument(docWith('🦄'), schema)).not.toThrow()
    expect(() => validateDocument(docWith('🎉'), schema)).not.toThrow()
    expect(() => validateDocument(docWith('javascript:alert(1)'), schema)).toThrow(/emoji|图标/)
    expect(() => validateDocument(docWith(''), schema)).toThrow(/emoji|图标/)
  })
})
