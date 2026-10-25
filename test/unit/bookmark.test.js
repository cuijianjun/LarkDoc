/**
 * P3-05 网页卡片 `bookmark`：契约层 → 块定义 / 导出产物 → NodeView → unfurl provider。
 *
 * 四组用例各自守一条曾经踩过 / 极易踩的口径：
 *
 * 1. `core/embed/bookmark.js` —— URL 闸门只认 http(s)、读路径永不抛错、`recordId` 必合法；
 * 2. `core/blocks/bookmark.js` —— `renderHTML` 就是导出产物：**必须能序列化**
 *    （P3-04 的 `RangeError: Invalid array passed to renderSpec` 只在 `getHTML()` 时炸，
 *    编辑器里完全看不出来）、卡内**没有 `a` / `button`**、无 favicon 时 icon span **不渲染**；
 * 3. `core/nodeviews/bookmark.js` —— 整卡点击走 `onOpen` / `window.open`，骨架态只在编辑器里；
 * 4. `core/embed/unfurl.js` —— **永远 resolve**，失败也只是「一张只有 URL + 域名的简卡」。
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { createLarkDocExtensions } from '../../src/components/lark-doc/extensions'
import {
  BOOKMARK_VARIANT, createRecordId, normalizeBookmark, readBookmark, readBookmarkHost,
  readBookmarkMeta, readBookmarkText, readBookmarkUrl, RECORD_ID_PATTERN,
} from '../../src/core/embed/bookmark'
import { createBookmarkNodeView } from '../../src/core/nodeviews/bookmark'
import { createUnfurlProvider, UNFURL_ERROR } from '../../src/core/embed/unfurl'

const mounted = []
afterEach(() => {
  while (mounted.length) mounted.pop().cleanup()
  vi.unstubAllGlobals()
})

const SAMPLE = 'https://www.example.com/'

function mountEditor(attrs, options = {}) {
  const editor = new Editor({
    extensions: createLarkDocExtensions({
      unfurlProvider: options.unfurl || null,
      onBookmarkOpen: options.onOpen || null,
    }),
    content: { type: 'doc', content: [{ type: 'bookmark', attrs }] },
  })
  mounted.push({ cleanup: () => editor.destroy() })
  return editor
}

function mountNodeView(attrs, options = {}) {
  const editor = mountEditor(attrs, options)
  const extension = editor.extensionManager.extensions.filter((item) => item.name === 'bookmark')[0]
  const nodeView = createBookmarkNodeView({
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

const click = (element) => element.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
const press = (element, key) => element.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true }))
const flush = () => new Promise((resolve) => { setTimeout(resolve, 0) })

/* ------------------------------------------------------------------ 契约层 */

describe('readBookmarkUrl：只认 http(s)，别把行内链接的闸门照搬过来', () => {
  it('放行 http / https，并去掉首尾空白', () => {
    expect(readBookmarkUrl('https://a.com/x')).toBe('https://a.com/x')
    expect(readBookmarkUrl('http://a.com')).toBe('http://a.com')
    expect(readBookmarkUrl('  https://a.com  ')).toBe('https://a.com')
  })

  it('拒掉 safeUrl 会放行、但网页卡片不该收的协议', () => {
    // 这三个是行内链接 / 动作 href 的合法值，拿来当卡片 src 就是坏数据。
    expect(readBookmarkUrl('mailto:a@b.com')).toBeNull()
    expect(readBookmarkUrl('tel:+8610000')).toBeNull()
    expect(readBookmarkUrl('#heading-1')).toBeNull()
    expect(readBookmarkUrl('javascript:alert(1)')).toBeNull()
  })

  it('空值 / 非字符串 / 超长一律 null（不抛错）', () => {
    expect(readBookmarkUrl(null)).toBeNull()
    expect(readBookmarkUrl(undefined)).toBeNull()
    expect(readBookmarkUrl(42)).toBeNull()
    expect(readBookmarkUrl('')).toBeNull()
    expect(readBookmarkUrl('   ')).toBeNull()
    expect(readBookmarkUrl(`https://a.com/${'x'.repeat(2100)}`)).toBeNull()
  })
})

describe('readBookmarkHost / readBookmarkText', () => {
  it('域名小写，解析不出来给空串（渲染层再回落 URL 本身）', () => {
    expect(readBookmarkHost('https://WWW.Example.COM/a')).toBe('www.example.com')
    expect(readBookmarkHost('not a url')).toBe('')
    expect(readBookmarkHost(null)).toBe('')
    expect(readBookmarkHost('')).toBe('')
  })

  it('折行压成单空格、按码点裁切、空串归零', () => {
    expect(readBookmarkText('  a\n\n b\tc  ', 50)).toBe('a b c')
    expect(readBookmarkText('😀😀😀', 2)).toBe('😀😀')
    expect(readBookmarkText('abcdef', 3)).toBe('abc')
    // 裁在空格上时把尾巴的空白一并 trim 掉，别留「hello 」这种尾巴。
    expect(readBookmarkText('hello world', 6)).toBe('hello')
    expect(readBookmarkText('', 10)).toBe('')
    expect(readBookmarkText(null, 10)).toBe('')
  })
})

describe('createRecordId：每卡唯一、无需服务端', () => {
  it('过 RECORD_ID_PATTERN，且连续两次不同', () => {
    const first = createRecordId()
    const second = createRecordId()
    expect(first).toMatch(RECORD_ID_PATTERN)
    expect(second).toMatch(RECORD_ID_PATTERN)
    expect(first).not.toBe(second)
  })
})

describe('normalizeBookmark（写路径严格）/ readBookmark（读路径宽容）', () => {
  it('URL 不合格直接 null —— 由命令转成「返回 false」', () => {
    expect(normalizeBookmark(null)).toBeNull()
    expect(normalizeBookmark({})).toBeNull()
    expect(normalizeBookmark({ url: 'mailto:a@b.com' })).toBeNull()
  })

  it('吃 resolveEmbed() 的出口形状 { src } —— 「没命中预设的链接」只有一条插入路径', () => {
    const bookmark = normalizeBookmark({ src: SAMPLE })
    expect(bookmark.url).toBe(SAMPLE)
    expect(bookmark.title).toBeNull()
    expect(bookmark.desc).toBeNull()
  })

  it('元数据不合格只丢自己，不连坐整块', () => {
    const bookmark = normalizeBookmark({
      url: SAMPLE,
      title: '  Example\nDomain  ',
      desc: 'x'.repeat(2500),
      favicon: 'data:image/png;base64,AAAA',
    })
    expect(bookmark.title).toBe('Example Domain')
    expect(bookmark.desc.length).toBe(2000)
    expect(bookmark.favicon).toBeNull() // data: 不给（远端抓回的地址不该带 payload）
  })

  it('没给 / 给了非法 recordId 都补一个合法的', () => {
    expect(normalizeBookmark({ url: SAMPLE }).recordId).toMatch(RECORD_ID_PATTERN)
    expect(normalizeBookmark({ url: SAMPLE, recordId: 'has space' }).recordId).toMatch(RECORD_ID_PATTERN)
    expect(normalizeBookmark({ url: SAMPLE, recordId: 'bk_keep' }).recordId).toBe('bk_keep')
  })

  it('readBookmark 永不抛错，只返回自己认识的字段', () => {
    expect(readBookmark(null)).toBeNull()
    expect(readBookmark('')).toBeNull()
    expect(readBookmark({ url: 'nope' })).toBeNull()
    const full = readBookmark({ url: SAMPLE, title: 'T', desc: 'D', favicon: 'https://a.com/f.ico' })
    expect(full).toMatchObject({ url: SAMPLE, host: 'www.example.com', title: 'T', desc: 'D' })
    expect(full.variant).toBe(BOOKMARK_VARIANT.rich)
  })

  it('有没有 desc 决定档位（富卡 113 / 简卡 74）', () => {
    expect(readBookmark({ url: SAMPLE }).variant).toBe(BOOKMARK_VARIANT.simple)
    expect(readBookmark({ url: SAMPLE, desc: 'D' }).variant).toBe(BOOKMARK_VARIANT.rich)
  })

  it('readBookmarkMeta 缺项一律 null', () => {
    expect(readBookmarkMeta(null)).toEqual({ title: null, desc: null, favicon: null })
    expect(readBookmarkMeta({ title: ' T ', favicon: 'javascript:1' }))
      .toEqual({ title: 'T', desc: null, favicon: null })
  })
})

/* ------------------------------------------------------------------ 导出产物 */

describe('renderHTML = 导出产物', () => {
  it('能序列化（P3-04 的嵌套 spec 只在这里炸）', () => {
    const editor = mountEditor({ url: SAMPLE, title: 'Example Domain' })
    expect(() => editor.getHTML()).not.toThrow()
    expect(editor.getHTML()).toContain('lark-doc-bookmark-container')
  })

  it('6 层壳链 + 块级标记齐全', () => {
    const html = mountEditor({ url: SAMPLE, title: 'T', desc: 'D' }).getHTML()
    for (const className of [
      'lark-doc-bookmark-wrapper',
      'lark-doc-bookmark-content',
      'lark-doc-bookmark-card',
      'lark-doc-bookmark-info',
      'lark-doc-bookmark-url-wrapper',
      'lark-doc-bookmark-detail',
    ]) expect(html).toContain(className)
    expect(html).toContain('data-type="bookmark"')
    expect(html).toContain('data-block-type="bookmark"')
    expect(html).toContain(`data-url="${SAMPLE}"`)
  })

  it('卡内没有 a / button —— 点了走 window.open，导出成 PDF 不该出现假按钮', () => {
    const editor = mountEditor({ url: SAMPLE, title: 'T', desc: 'D' })
    const root = new window.DOMParser().parseFromString(editor.getHTML(), 'text/html')
    expect(root.querySelectorAll('a').length).toBe(0)
    expect(root.querySelectorAll('button').length).toBe(0)
    expect(root.querySelector('.lark-doc-bookmark-card').getAttribute('role')).toBe('link')
  })

  it('无 favicon 时 icon span 根本不渲染，URL 也不吃 icon 位', () => {
    const editor = mountEditor({ url: SAMPLE, title: 'T' })
    const root = new window.DOMParser().parseFromString(editor.getHTML(), 'text/html')
    expect(root.querySelector('.lark-doc-bookmark-icon')).toBeNull()
    // URL 是 url-wrapper 的第一个（也是唯一）子节点 —— 不是「空占位后面跟着 URL」
    const wrapper = root.querySelector('.lark-doc-bookmark-url-wrapper')
    expect(wrapper.firstChild.className).toBe('lark-doc-bookmark-url')
  })

  it('有 favicon 时是 span + inline background-image，不是 img', () => {
    const editor = mountEditor({ url: SAMPLE, title: 'T', favicon: 'https://cdn.example.com/f.webp' })
    const root = new window.DOMParser().parseFromString(editor.getHTML(), 'text/html')
    const icon = root.querySelector('.lark-doc-bookmark-icon')
    expect(icon.tagName).toBe('SPAN')
    // ProseMirror 把 style 走 `dom.style.cssText` 落地，CSS 解析器会把 url() 的引号吃掉，
    // 所以断言只能落到「是不是 background-image、指向对不对」，不能比对带引号的原文。
    expect(icon.getAttribute('style')).toContain('background-image')
    expect(icon.getAttribute('style')).toContain('https://cdn.example.com/f.webp')
    expect(root.querySelector('.lark-doc-bookmark-url-wrapper img')).toBeNull()
  })

  it('标题与摘要之间是真 <br>，简卡没有摘要', () => {
    const rich = new window.DOMParser().parseFromString(
      mountEditor({ url: SAMPLE, title: 'T', desc: 'D' }).getHTML(), 'text/html',
    )
    const detail = rich.querySelector('.lark-doc-bookmark-detail')
    expect(detail.querySelectorAll('br').length).toBe(1)
    expect(detail.querySelectorAll('.lark-doc-bookmark-summary').length).toBe(1)

    const simple = new window.DOMParser().parseFromString(
      mountEditor({ url: SAMPLE, title: 'T' }).getHTML(), 'text/html',
    )
    expect(simple.querySelectorAll('.lark-doc-bookmark-summary').length).toBe(0)
  })

  it('url 为空（脏数据 / 被清过）时画「链接数据缺失」占位，不画空卡', () => {
    const editor = mountEditor({ url: null, recordId: 'bk_missing' })
    const html = editor.getHTML()
    expect(html).toContain('lark-doc-unknown-card')
    expect(html).toContain('链接数据缺失')
    expect(html).toContain('没有可用的 URL')
    expect(html).not.toContain('lark-doc-bookmark-card')
  })

  // 坏 URL 连文档都进不来 —— 属性校验在 `Node.create` 那一层就拒收，整块被丢掉。
  // 所以占位只在「url 是 null」时出现，不是「url 是垃圾字符串」时出现。
  it('非 http(s) 的 URL 进不了文档：属性校验拒收，节点被丢弃', () => {
    const editor = mountEditor({ url: 'mailto:a@b.com' })
    expect(editor.state.doc.firstChild.type.name).not.toBe('bookmark')
    expect(editor.getHTML()).not.toContain('bookmark')
  })

  it('导出永远出 ready 档：产物里不该有骨架 / shimmer', () => {
    const html = mountEditor({ url: SAMPLE }).getHTML()
    expect(html).not.toContain('is-skeleton')
    expect(html).not.toContain('lark-doc-bookmark-skeleton-item')
  })
})

/* ------------------------------------------------------------------ 命令 */

/**
 * 命令用例的宿主编辑器。
 *
 * ⚠️ 起始文档必须是 schema 合法的：`{ type: 'doc' }`（零子节点）违反 `block+`，
 * 只要 dispatch 任何事务，ProseMirror 会先把空 doc 填成一个段落 —— 跟命令本身无关，
 * 却会让「文档不动」的断言假红（实测 `toggleBold()` 返回 false 也照样补段）。
 */
function mountCommandEditor() {
  const editor = new Editor({
    extensions: createLarkDocExtensions({}),
    content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'anchor' }] }] },
  })
  mounted.push({ cleanup: () => editor.destroy() })
  return editor
}

/** 命令落块的位置取决于光标（可能插在段落前后），所以按类型找，不按 `firstChild` / `lastChild`。 */
function bookmarkNode(editor) {
  let found = null
  editor.state.doc.descendants((node) => {
    if (found) return false
    if (node.type.name === 'bookmark') found = node
    return !found
  })
  return found
}

describe('setBookmark / updateBookmarkMeta', () => {
  it('setBookmark 落块并补 recordId', () => {
    const editor = mountCommandEditor()
    expect(editor.commands.setBookmark({ url: SAMPLE, title: 'T' })).toBe(true)
    const node = bookmarkNode(editor)
    expect(node).not.toBeNull()
    expect(node.attrs.url).toBe(SAMPLE)
    expect(node.attrs.recordId).toMatch(RECORD_ID_PATTERN)
  })

  it('setBookmark 吃 resolveEmbed 的 { kind, attrs: { src } } 形状', () => {
    const editor = mountCommandEditor()
    expect(editor.commands.setBookmark({ kind: 'bookmark', attrs: { src: SAMPLE } })).toBe(true)
    expect(bookmarkNode(editor).attrs.url).toBe(SAMPLE)
  })

  it('URL 不合格返回 false，文档一个字都不动', () => {
    const editor = mountCommandEditor()
    const before = JSON.stringify(editor.getJSON())
    expect(editor.commands.setBookmark({ url: 'not-a-url' })).toBe(false)
    expect(editor.commands.setBookmark({})).toBe(false)
    expect(editor.commands.setBookmark(null)).toBe(false)
    expect(JSON.stringify(editor.getJSON())).toBe(before)
  })

  it('updateBookmarkMeta 按 recordId 定位回写（块搬走了也不写错）', () => {
    const editor = mountEditor({ url: SAMPLE, recordId: 'bk_target', title: null, desc: null })
    expect(editor.commands.updateBookmarkMeta({
      recordId: 'bk_target', title: 'Example Domain', desc: 'Illustrative examples', favicon: null,
    })).toBe(true)
    const attrs = editor.state.doc.firstChild.attrs
    expect(attrs.title).toBe('Example Domain')
    expect(attrs.desc).toBe('Illustrative examples')
    expect(attrs.favicon).toBeNull()
  })

  it('recordId 对不上 / 值没变化都返回 false', () => {
    const editor = mountEditor({ url: SAMPLE, recordId: 'bk_target', title: 'T' })
    expect(editor.commands.updateBookmarkMeta({ recordId: 'bk_other', title: 'X' })).toBe(false)
    expect(editor.commands.updateBookmarkMeta({ recordId: 'bk_target', title: 'T' })).toBe(false)
    expect(editor.state.doc.firstChild.attrs.title).toBe('T')
  })
})

/* ------------------------------------------------------------------ unfurl */

describe('createUnfurlProvider：第 6 个可选 provider', () => {
  it('没给实现返回 null（调用方据此走纯链接降级，不是异常）', () => {
    expect(createUnfurlProvider(null)).toBeNull()
    expect(createUnfurlProvider({})).toBeNull()
    expect(createUnfurlProvider({ unfurl: 'not a function' })).toBeNull()
  })

  it('裸函数 / { unfurl } / { fetch } 三种写法都认', () => {
    expect(createUnfurlProvider(() => ({ title: 'A' }))).toBeTruthy()
    expect(createUnfurlProvider({ unfurl: () => null })).toBeTruthy()
    expect(createUnfurlProvider({ fetch: () => null })).toBeTruthy()
  })

  it('成功：ok true + 裁切后的元数据', async () => {
    const provider = createUnfurlProvider(() => ({ title: '  A\nB  ', desc: ' D ', favicon: 'https://a.com/f.ico' }))
    await expect(provider.unfurl(SAMPLE)).resolves.toEqual({
      ok: true, url: SAMPLE, title: 'A B', desc: 'D', favicon: 'https://a.com/f.ico', error: null,
    })
  })

  it('非法 URL 直接返回 INVALID_URL，且不发请求', async () => {
    const spy = vi.fn()
    const provider = createUnfurlProvider(spy)
    const result = await provider.unfurl('mailto:a@b.com')
    expect(result.ok).toBe(false)
    expect(result.error).toBe(UNFURL_ERROR.INVALID_URL)
    expect(spy).not.toHaveBeenCalled()
  })

  it('宿主实现抛错 → 收成 ok:false，永不 reject', async () => {
    const provider = createUnfurlProvider(() => { throw new Error('boom') })
    const result = await provider.unfurl(SAMPLE)
    expect(result).toMatchObject({ ok: false, error: UNFURL_ERROR.FAILED, title: null })
  })

  it('异步 reject 同样收成 ok:false', async () => {
    const provider = createUnfurlProvider(() => Promise.reject(new Error('network')))
    await expect(provider.unfurl(SAMPLE)).resolves.toMatchObject({ ok: false, error: UNFURL_ERROR.FAILED })
  })

  it('超时也给结果：卡片必须从骨架翻到简卡，不能挂着等', async () => {
    const provider = createUnfurlProvider({ unfurl: () => new Promise(() => {}), timeout: 10 })
    const result = await provider.unfurl(SAMPLE)
    expect(result).toMatchObject({ ok: false, error: UNFURL_ERROR.TIMEOUT })
  })

  it('同一 URL 走缓存（只打一次接口），clear() 清掉', async () => {
    const spy = vi.fn(() => ({ title: 'A' }))
    const provider = createUnfurlProvider(spy)
    const first = provider.unfurl(SAMPLE)
    const second = provider.unfurl(SAMPLE)
    expect(second).toBe(first)
    await first
    expect(spy).toHaveBeenCalledTimes(1)
    expect(provider.size()).toBe(1)
    provider.clear()
    expect(provider.size()).toBe(0)
  })

  it('cache: false 可关掉缓存', async () => {
    const spy = vi.fn(() => ({ title: 'A' }))
    const provider = createUnfurlProvider({ unfurl: spy, cache: false })
    await provider.unfurl(SAMPLE)
    await provider.unfurl(SAMPLE)
    expect(spy).toHaveBeenCalledTimes(2)
  })
})

/* ------------------------------------------------------------------ NodeView */

describe('NodeView：整卡就是链接', () => {
  it('点卡身走 onOpen，交出去的是 url + recordId', () => {
    const onOpen = vi.fn()
    const { dom } = mountNodeView({ url: SAMPLE, recordId: 'bk_1', title: 'T' }, { onOpen })
    click(dom.querySelector('.lark-doc-bookmark-card'))
    expect(onOpen).toHaveBeenCalledWith({ url: SAMPLE, recordId: 'bk_1' })
  })

  it('没接 onOpen 就自己 window.open（与飞书一致：卡内没有 a）', () => {
    const open = vi.fn()
    vi.stubGlobal('open', open)
    const { dom } = mountNodeView({ url: SAMPLE, title: 'T' })
    click(dom.querySelector('.lark-doc-bookmark-url'))
    expect(open).toHaveBeenCalledWith(SAMPLE, '_blank', 'noopener')
  })

  it('onOpen 自己抛错时退回默认打开，不让点击变成「没反应」', () => {
    const open = vi.fn()
    vi.stubGlobal('open', open)
    const { dom } = mountNodeView({ url: SAMPLE, title: 'T' }, { onOpen: () => { throw new Error('x') } })
    click(dom.querySelector('.lark-doc-bookmark-card'))
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('点容器外的死区不跳（16px 外边距留给选中与拖拽）', () => {
    const onOpen = vi.fn()
    const { dom } = mountNodeView({ url: SAMPLE, title: 'T' }, { onOpen })
    click(dom) // root 本身不在 .lark-doc-bookmark-card 的 closest 链上
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('Enter / Space 也能开，其他键不动', () => {
    const onOpen = vi.fn()
    const { dom } = mountNodeView({ url: SAMPLE, title: 'T' }, { onOpen })
    const card = dom.querySelector('.lark-doc-bookmark-card')
    press(card, 'a')
    expect(onOpen).not.toHaveBeenCalled()
    press(card, 'Enter')
    press(card, ' ')
    expect(onOpen).toHaveBeenCalledTimes(2)
  })

  it('update()：属性没动让 PM 复用 DOM，动了返回 false 重造', () => {
    const editor = mountEditor({ url: SAMPLE, title: 'T' })
    const extension = editor.extensionManager.extensions.filter((item) => item.name === 'bookmark')[0]
    const nodeView = createBookmarkNodeView({ editor, node: editor.state.doc.firstChild, getPos: () => 0, extension })
    mounted.push({ cleanup: () => nodeView.destroy() })

    expect(nodeView.update(editor.state.doc.firstChild)).toBe(true)
    const next = editor.state.doc.firstChild.type.create({ ...editor.state.doc.firstChild.attrs, title: 'T2' })
    expect(nodeView.update(next)).toBe(false)
  })

  it('stopEvent 只拦 click / keydown，mousedown 放行（否则选不中整块）', () => {
    const { nodeView, dom } = mountNodeView({ url: SAMPLE, title: 'T' })
    const card = dom.querySelector('.lark-doc-bookmark-card')
    expect(nodeView.stopEvent({ type: 'click', target: card })).toBe(true)
    expect(nodeView.stopEvent({ type: 'keydown', target: card })).toBe(true)
    expect(nodeView.stopEvent({ type: 'mousedown', target: card })).toBe(false)
    expect(nodeView.stopEvent({ type: 'click', target: dom })).toBe(false)
    expect(nodeView.stopEvent(null)).toBe(false)
  })
})

describe('NodeView：骨架态只在编辑器里，失败不是错误态', () => {
  it('title 为空 + 有 unfurl → 先画骨架（122 高那档）', () => {
    const { nodeView, dom } = mountNodeView({ url: SAMPLE }, {
      unfurl: { unfurl: () => new Promise(() => {}) },
    })
    expect(nodeView.pending()).toBe(true)
    expect(dom.getAttribute('data-bookmark-state')).toBe('loading')
    expect(dom.querySelectorAll('.lark-doc-bookmark-skeleton-item').length).toBe(3)
    expect(dom.querySelector('.lark-doc-bookmark-icon').className).toContain('is-skeleton')
  })

  it('已经有标题就不再抓（文档是真相，也避免每次打开都打接口）', () => {
    const spy = vi.fn(() => ({ ok: true, title: 'X' }))
    const { nodeView, dom } = mountNodeView({ url: SAMPLE, title: 'T' }, { unfurl: { unfurl: spy } })
    expect(spy).not.toHaveBeenCalled()
    expect(nodeView.pending()).toBe(false)
    expect(dom.getAttribute('data-bookmark-state')).toBe('ready')
  })

  it('抓取成功：元数据回写到 attrs', async () => {
    const { editor } = mountNodeView({ url: SAMPLE, recordId: 'bk_1' }, {
      unfurl: { unfurl: () => Promise.resolve({ ok: true, title: 'Example Domain', desc: 'A description' }) },
    })
    await flush()
    const attrs = editor.state.doc.firstChild.attrs
    expect(attrs.title).toBe('Example Domain')
    expect(attrs.desc).toBe('A description')
  })

  it('抓取失败：收骨架，标题回落域名，无文案无重试（和就绪态同构）', async () => {
    const { nodeView, dom } = mountNodeView({ url: 'https://no-such-domain-abc123xyz.invalid/' }, {
      unfurl: { unfurl: () => Promise.resolve({ ok: false, title: null, error: UNFURL_ERROR.FAILED }) },
    })
    await flush()
    expect(nodeView.pending()).toBe(false)
    expect(dom.getAttribute('data-bookmark-state')).toBe('ready')
    expect(dom.querySelector('.lark-doc-bookmark-title').textContent).toBe('no-such-domain-abc123xyz.invalid')
    expect(dom.querySelectorAll('.lark-doc-bookmark-skeleton-item').length).toBe(0)
    expect(dom.textContent).not.toContain('失败')
  })

  it('provider 直接抛错 / 返回非 Promise 也不把卡片留在骨架上', async () => {
    const thrown = mountNodeView({ url: SAMPLE }, { unfurl: { unfurl: () => { throw new Error('x') } } })
    expect(thrown.nodeView.pending()).toBe(false)
    const sync = mountNodeView({ url: SAMPLE }, { unfurl: { unfurl: () => null } })
    expect(sync.nodeView.pending()).toBe(false)
  })

  it('destroy() 之后回来的结果不再落 DOM（旧任务作废）', async () => {
    let release
    const { nodeView } = mountNodeView({ url: SAMPLE }, {
      unfurl: { unfurl: () => new Promise((resolve) => { release = resolve }) },
    })
    nodeView.destroy()
    release({ ok: true, title: 'Late' })
    await flush()
    expect(nodeView.pending()).toBe(true) // 骨架仍是骨架，没有晚到的 showReady
  })
})
