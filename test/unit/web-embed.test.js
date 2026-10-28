/**
 * P3-01 内嵌网页块：`src` 合法性 / 块高解析 / 落块属性 / NodeView 四态。
 *
 * 三层用例：
 * 1. 判定层（core/embed/web-embed.js）——0 DOM，`safeEmbedSrc` 与 `resolveEmbedHeight`；
 * 2. 块定义（core/blocks/web-embed.js）——schema 形状、`setWebEmbed` 命令的预检、
 *    renderHTML 的 `data-*` 与 parseHTML 往返；
 * 3. NodeView（core/nodeviews/web-embed.js）——四态与两条飞书实测硬要求：
 *    「失败零反馈」（不许加错误 UI）、「loading 期间 DOM 里没有 iframe」。
 *
 * 为什么 `src` 的判据是「桥能否推出 origin」：见 `core/embed/web-embed.js` 的注释——
 * 能渲染和能握手必须是同一套规则，否则会出现「框在、桥永远连不上」的白块。
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { Editor, getSchema } from '@tiptap/core'
import { createLarkDocExtensions } from '../../src/components/lark-doc/extensions'
import {
  canRenderWebEmbed, resolveEmbedHeight, safeEmbedSrc,
  WEB_EMBED_DEFAULT_HEIGHT, WEB_EMBED_MAX_HEIGHT, WEB_EMBED_MIN_HEIGHT,
} from '../../src/core/embed/web-embed'
import { createWebEmbedNodeView } from '../../src/core/nodeviews/web-embed'

const FIGMA = 'https://www.figma.com/embed?embed_host=lark&url=x'
const POSTER = 'data:image/png;base64,iVBORw0KGgo='

const mounted = []
afterEach(() => {
  while (mounted.length) mounted.pop().cleanup()
})

function mountEditor(attrs, options) {
  const editor = new Editor({
    extensions: createLarkDocExtensions(options),
    content: { type: 'doc', content: [{ type: 'webEmbed', attrs }] },
  })
  mounted.push({ cleanup: () => editor.destroy() })
  return editor
}

/** 直接持有 NodeView 实例，方便调用 `status() / iframe()` 这些联调通道。 */
function mountNodeView(attrs, options = {}) {
  const editor = mountEditor(attrs, options)
  const extension = { options: { canEmbed: null, sandbox: null, allow: null, ...options } }
  const nodeView = createWebEmbedNodeView({
    editor,
    node: editor.state.doc.firstChild,
    getPos: () => 0,
    extension,
  })
  // 必须进文档：游离 iframe 没有 browsing context（`contentWindow` 为 null），
  // 既不 load 也起不了桥 —— 这条限制正是 NodeView 让 `.iframe-layer` 常驻的原因。
  document.body.appendChild(nodeView.dom)
  mounted.push({
    cleanup: () => {
      nodeView.destroy()
      if (nodeView.dom.parentNode) nodeView.dom.parentNode.removeChild(nodeView.dom)
    },
  })
  return { editor, nodeView, figure: nodeView.dom }
}

const heightOf = (figure) => figure.querySelector('.lark-doc-embed-frame').style.height
const stateOf = (figure) => figure.getAttribute('data-embed-state')

describe('safeEmbedSrc：能渲染 == 桥能握手', () => {
  it('https 放行', () => {
    expect(safeEmbedSrc('https://www.figma.com/embed')).toBe(true)
    expect(safeEmbedSrc('https://example.com/a/b?c=d#e')).toBe(true)
  })

  it('http 只给本地开发三兄弟放行（localhost / 127.0.0.1 / [::1]）', () => {
    expect(safeEmbedSrc('http://localhost:3000/')).toBe(true)
    expect(safeEmbedSrc('http://127.0.0.1:8080/x')).toBe(true)
    expect(safeEmbedSrc('http://[::1]:5173/')).toBe(true)
    expect(safeEmbedSrc('http://example.com/')).toBe(false)
  })

  it('空值算「尚未设置」，交给上层判 canRender，不是非法', () => {
    for (const value of [null, undefined, '']) expect(safeEmbedSrc(value)).toBe(true)
  })

  it('非字符串 / 非法协议 / 带账号密码一律拒', () => {
    expect(safeEmbedSrc(42)).toBe(false)
    expect(safeEmbedSrc({ href: FIGMA })).toBe(false)
    expect(safeEmbedSrc('javascript:alert(1)')).toBe(false)
    expect(safeEmbedSrc('data:text/html,<b>x</b>')).toBe(false)
    expect(safeEmbedSrc('// www.figma.com/embed')).toBe(false)
    expect(safeEmbedSrc('https://user:pw@example.com/embed')).toBe(false)
  })

  it('canRenderWebEmbed 额外要求 src 是字符串', () => {
    expect(canRenderWebEmbed({ src: FIGMA })).toBe(true)
    expect(canRenderWebEmbed({ src: null })).toBe(false)
    expect(canRenderWebEmbed(null)).toBe(false)
  })
})

describe('resolveEmbedHeight：height 优先，其次 aspect，最后 463', () => {
  it('height 合法就直接用，不做比例换算', () => {
    expect(resolveEmbedHeight({ height: 602 })).toBe(602)
    expect(resolveEmbedHeight({ height: 485 })).toBe(485)
    expect(resolveEmbedHeight({ height: 463.4 })).toBe(463)
  })

  it('height 压过 aspect（airtable / jcode 就是靠这条覆盖默认比例）', () => {
    expect(resolveEmbedHeight({ height: 602, aspect: 1.363 })).toBe(602)
  })

  it('没有 height 时按正文宽 ÷ aspect（airtable 1.363 → 602，jcode 1.691 → 485）', () => {
    expect(resolveEmbedHeight({ aspect: 1.363 })).toBe(602)
    expect(resolveEmbedHeight({ aspect: 1.691 })).toBe(485)
  })

  it('宽度跟着容器走：正文宽 1041 时同一比例算出更高', () => {
    expect(resolveEmbedHeight({ aspect: 1.771 }, 1041)).toBe(588)
    expect(resolveEmbedHeight({ aspect: 1.771 })).toBe(463)
  })

  it('越界 / 非数字一律退回默认档，不抛错', () => {
    expect(resolveEmbedHeight({})).toBe(WEB_EMBED_DEFAULT_HEIGHT)
    expect(resolveEmbedHeight(null)).toBe(WEB_EMBED_DEFAULT_HEIGHT)
    expect(resolveEmbedHeight({ height: WEB_EMBED_MIN_HEIGHT - 1 })).toBe(WEB_EMBED_DEFAULT_HEIGHT)
    expect(resolveEmbedHeight({ height: WEB_EMBED_MAX_HEIGHT + 1 })).toBe(WEB_EMBED_DEFAULT_HEIGHT)
    expect(resolveEmbedHeight({ height: 'auto', aspect: 'x' })).toBe(WEB_EMBED_DEFAULT_HEIGHT)
    expect(resolveEmbedHeight({ aspect: 0 })).toBe(WEB_EMBED_DEFAULT_HEIGHT)
    expect(resolveEmbedHeight({ aspect: -2 })).toBe(WEB_EMBED_DEFAULT_HEIGHT)
    expect(resolveEmbedHeight({ aspect: 99 })).toBe(WEB_EMBED_DEFAULT_HEIGHT)
  })

  it('宽度非法时按 820 兜底（不返回 NaN / Infinity）', () => {
    expect(resolveEmbedHeight({ aspect: 1.771 }, 0)).toBe(463)
    expect(resolveEmbedHeight({ aspect: 1.771 }, Number.NaN)).toBe(463)
  })
})

describe('webEmbed 块定义', () => {
  it('schema 里是一个原子块，8 个属性默认值都对', () => {
    const schema = getSchema(createLarkDocExtensions())
    const type = schema.nodes.webEmbed
    expect(type.isAtom).toBe(true)
    expect(type.spec.selectable).toBe(true)
    expect(type.spec.draggable).toBe(true)
    expect(type.spec.group).toBe('block')
    const node = type.create()
    expect(node.attrs).toMatchObject({
      providerId: 'generic', src: null, title: null, height: null, aspect: null, poster: null, bridgeVersion: 1,
    })
  })

  it('setWebEmbed 落块并补上 providerId=generic', () => {
    const editor = mountEditor({ src: FIGMA })
    editor.commands.setContent('')
    expect(editor.commands.setWebEmbed({ src: FIGMA, title: 'Figma 设计稿' })).toBe(true)
    const node = editor.state.doc.firstChild
    expect(node.type.name).toBe('webEmbed')
    expect(node.attrs.providerId).toBe('generic')
    expect(node.attrs.src).toBe(FIGMA)
    expect(node.attrs.title).toBe('Figma 设计稿')
  })

  it('setWebEmbed 拒绝非法 src —— 命令返回 false 且正文没落块', () => {
    const editor = mountEditor({ src: FIGMA })
    editor.commands.setContent('')
    for (const bad of ['http://example.com/x', 'javascript:alert(1)', 'https://u:p@example.com/']) {
      expect(editor.commands.setWebEmbed({ src: bad })).toBe(false)
    }
    expect(editor.commands.setWebEmbed({})).toBe(false)
    expect(editor.state.doc.childCount).toBe(1) // 只剩 setContent('') 留下的空段落
    expect(editor.state.doc.firstChild.type.name).toBe('paragraph')
  })

  it('renderHTML 带飞书块类型标记，且只写合法的属性', () => {
    const editor = mountEditor({ src: FIGMA, height: 602, poster: POSTER, title: '看板' })
    const html = editor.getHTML()
    expect(html).toContain('data-type="web-embed"')
    expect(html).toContain('data-block-type="iframe"')
    expect(html).toContain('class="lark-doc-embed docx-iframe-block"')
    expect(html).toContain(`data-src="${FIGMA.replace(/&/g, '&amp;')}"`)
    expect(html).toContain('data-height="602"')
    expect(html).toContain('data-bridge-version="1"')
    expect(html).toContain('data-provider-id="generic"')
    expect(html).not.toContain('data-aspect')
  })

  it('HTML 往返：合法 figure 读回同一个节点', () => {
    const html = '<figure class="lark-doc-embed docx-iframe-block" data-type="web-embed"'
      + ' data-block-type="iframe" data-src="https://www.figma.com/embed"'
      + ' data-provider-id="figma" data-height="602" data-bridge-version="1"></figure>'
    const editor = new Editor({ extensions: createLarkDocExtensions(), content: html })
    mounted.push({ cleanup: () => editor.destroy() })
    const node = editor.state.doc.firstChild
    expect(node.type.name).toBe('webEmbed')
    expect(node.attrs).toMatchObject({ src: 'https://www.figma.com/embed', providerId: 'figma', height: 602 })
  })

  it('没有 data-src 的 figure 不被认成 webEmbed（宁可不解析也不留空框）', () => {
    const editor = new Editor({
      extensions: createLarkDocExtensions(),
      content: '<figure class="lark-doc-embed docx-iframe-block" data-type="web-embed" data-block-type="iframe"></figure>',
    })
    mounted.push({ cleanup: () => editor.destroy() })
    expect(editor.state.doc.firstChild?.type.name).not.toBe('webEmbed')
  })

  it('非法 poster 进不了文档（validator 在 create 时就拒）', () => {
    const schema = getSchema(createLarkDocExtensions())
    expect(() => schema.nodes.webEmbed.create({ src: FIGMA, poster: 'javascript:alert(1)' })).toThrow(/poster/)
    expect(() => schema.nodes.webEmbed.create({ src: FIGMA, height: 9999 })).toThrow(/height/)
    expect(() => schema.nodes.webEmbed.create({ src: 'http://example.com/x' })).toThrow(/src/)
  })
})

describe('NodeView：四态', () => {
  it('默认落 loading：转圈出来、壳高 463，界面层先藏着', () => {
    const { figure, nodeView } = mountNodeView({ src: FIGMA })
    expect(nodeView.status()).toBe('loading')
    expect(stateOf(figure)).toBe('loading')
    const spin = figure.querySelector('.lark-doc-embed-spin')
    expect(spin).toBeTruthy()
    expect(spin.getAttribute('role')).toBe('progressbar')
    // iframe 已经造好并进 DOM（游离 iframe 不 load），但 loading 期由 CSS 藏起，
    // 视觉上只剩转圈 —— 对齐 04 §4.3 ⑥ 的 250ms 快照。
    expect(figure.querySelector('.iframe-layer > iframe')).toBeTruthy()
    expect(figure.querySelector('.lark-doc-embed-fallback')).toBeNull()
    expect(heightOf(figure)).toBe('463px')
    expect(figure.getAttribute('data-provider-id')).toBe('generic')
    expect(figure.getAttribute('data-src')).toBe(FIGMA)
  })

  it('aspect 决定高度：airtable 602 / jcode 485', () => {
    expect(heightOf(mountNodeView({ src: FIGMA, aspect: 1.363 }).figure)).toBe('602px')
    expect(heightOf(mountNodeView({ src: FIGMA, aspect: 1.691 }).figure)).toBe('485px')
  })

  it('iframe load 之后翻 ready，边框壳里挂 iframe-layer', () => {
    const { figure, nodeView } = mountNodeView({ src: FIGMA, title: '设计稿' })
    const element = nodeView.iframe()
    expect(element).toBeTruthy()
    // 沙箱基线（09 §3.4.2）：不给同源组合，referrer 不带上游地址。
    expect(element.getAttribute('sandbox')).toBe('allow-scripts allow-presentation allow-forms allow-popups allow-downloads')
    expect(element.getAttribute('allow')).toBe('clipboard-write; fullscreen')
    expect(element.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(element.getAttribute('title')).toBe('设计稿')

    element.dispatchEvent(new window.Event('load'))
    expect(nodeView.status()).toBe('ready')
    expect(stateOf(figure)).toBe('ready')
    expect(figure.querySelector('.iframe-layer > iframe')).toBe(element)
    expect(figure.querySelector('.lark-doc-embed-loading')).toBeNull()
  })

  it('桥 3s 没握手 + 有 poster → 降级成「快照 + 在新窗口打开」', async () => {
    const { figure, nodeView } = mountNodeView({ src: FIGMA, poster: POSTER, title: '看板' }, { bridgeTimeout: 30 })
    nodeView.iframe().dispatchEvent(new window.Event('load'))
    expect(nodeView.status()).toBe('ready')
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(nodeView.status()).toBe('degraded')
    const fallback = figure.querySelector('.lark-doc-embed-fallback')
    expect(fallback).toBeTruthy()
    expect(fallback.querySelector('.lark-doc-embed-poster').style.backgroundImage).toContain('data:image/png')
    expect(fallback.querySelector('.lark-doc-embed-fallback-text').textContent).toBe('看板')
    const open = fallback.querySelector('a.lark-doc-embed-open')
    expect(open.getAttribute('href')).toBe(FIGMA)
    expect(open.getAttribute('target')).toBe('_blank')
    expect(open.getAttribute('rel')).toContain('noopener')
  })

  it('桥超时但没有 poster：保持白块，不加任何错误 UI（1:1 飞书）', async () => {
    const { figure, nodeView } = mountNodeView({ src: FIGMA }, { bridgeTimeout: 30 })
    nodeView.iframe().dispatchEvent(new window.Event('load'))
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(nodeView.status()).toBe('ready')
    expect(figure.querySelector('.lark-doc-embed-fallback')).toBeNull()
    expect(figure.querySelector('iframe')).toBeTruthy()
  })

  it('canEmbed 返回 false → blocked，连 src 都不设', () => {
    const { figure, nodeView } = mountNodeView({ src: FIGMA }, { canEmbed: () => false })
    expect(nodeView.status()).toBe('blocked')
    expect(stateOf(figure)).toBe('blocked')
    expect(nodeView.iframe()).toBeNull()
    expect(figure.querySelector('iframe')).toBeNull()
    expect(figure.querySelector('.lark-doc-embed-fallback.is-blocked')).toBeTruthy()
    // 被拦的块不留 src 痕迹（P3-06：offline 下不发外部请求）。
    expect(figure.querySelector('[src]')).toBeNull()
  })

  it('被拦时若有 poster 只显示图，无 poster 就留白', () => {
    const withPoster = mountNodeView({ src: FIGMA, poster: POSTER }, { canEmbed: () => false })
    expect(withPoster.figure.querySelector('.lark-doc-embed-poster')).toBeTruthy()
    const blank = mountNodeView({ src: FIGMA }, { canEmbed: () => false })
    expect(blank.figure.querySelector('.lark-doc-embed-poster')).toBeNull()
    expect(blank.figure.querySelector('.lark-doc-embed-fallback').textContent).toBe('')
  })

  it('canEmbed 抛错一律当「拦」——宁可白块也不越权加载', () => {
    const { nodeView } = mountNodeView({ src: FIGMA }, { canEmbed: () => { throw new Error('policy') } })
    expect(nodeView.status()).toBe('blocked')
  })

  it('换 src 会重挂 iframe 并回到 loading；只换标题不重挂', () => {
    const { editor, nodeView } = mountNodeView({ src: FIGMA })
    const first = nodeView.iframe()
    first.dispatchEvent(new window.Event('load'))
    expect(nodeView.status()).toBe('ready')

    const setAttrs = (attrs) => {
      const { state, view } = editor
      view.dispatch(state.tr.setNodeMarkup(0, null, { ...state.doc.firstChild.attrs, ...attrs }))
      nodeView.update(editor.state.doc.firstChild)
    }

    setAttrs({ title: '改个标题' })
    expect(nodeView.status()).toBe('ready')
    expect(nodeView.iframe()).toBe(first)

    setAttrs({ src: 'https://www.figma.com/embed?v=2' })
    expect(nodeView.status()).toBe('loading')
    expect(nodeView.iframe()).not.toBe(first)
    expect(nodeView.embedSrc()).toBe('https://www.figma.com/embed?v=2')
  })

  it('选中态走 is-selected，不吃编辑器事件', () => {
    const { figure, nodeView } = mountNodeView({ src: FIGMA })
    nodeView.selectNode()
    expect(figure.classList.contains('is-selected')).toBe(true)
    nodeView.deselectNode()
    expect(figure.classList.contains('is-selected')).toBe(false)
    // 壳内元素都带 UI 标记 → stopEvent 拦下，链接点击不会变成编辑动作。
    expect(nodeView.stopEvent({ target: figure.querySelector('.lark-doc-embed-spin') })).toBe(true)
    expect(nodeView.stopEvent({ target: figure })).toBe(false)
  })
})
