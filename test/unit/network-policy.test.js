/**
 * P2-05 出网策略：open / allowlist / offline 三档下的媒体降级。
 *
 * 断言分四段：
 * 1. 放行判定（allows / isLocalUrl / urlHost）——三个模式各一条；
 * 2. `applyDocument`（载入 JSON）——图片换透明占位、文件块清 src 保 originalSrc；
 * 3. `filterHtml`（粘贴 HTML）——img / video / iframe / poster 四条降级路径；
 * 4. `resolveImage`（宿主代理）——允许直通、无代理抛错、代理回外链抛错。
 *
 * 需要 DOM 才能验证 ②③（document.createElement + innerHTML 解析）。
 */
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  BLOCKED_IMAGE_PLACEHOLDER, DEFAULT_NETWORK, NETWORK_MODES,
  createNetworkPolicy, isLocalUrl, urlHost,
} from '../../src/core/policy/network'

const IMG = 'https://cdn.example.com/a.png'
const PDF = 'https://files.example.com/a.pdf'
const portal = (mode, allowlist = []) => createNetworkPolicy({ mode, allowlist })

describe('放行判定', () => {
  it('NETWORK_MODES 与默认值稳定（改动等于改公开契约）', () => {
    expect(NETWORK_MODES).toEqual(['offline', 'allowlist', 'open'])
    expect(DEFAULT_NETWORK).toEqual({ mode: 'open', allowlist: [] })
  })

  it('open：远端一律放行，非法 mode 也回落 open', () => {
    expect(portal('open').allows(IMG)).toBe(true)
    expect(portal('open').allows('https://any.other.site/x.pdf')).toBe(true)
    expect(portal('bogus').mode).toBe('open')
    expect(portal('bogus').allows(IMG)).toBe(true)
  })

  it('allowlist：只放行白名单主机及其子域，其余拦下', () => {
    const policy = portal('allowlist', ['example.com'])
    expect(policy.allows('https://example.com/a.png')).toBe(true)
    expect(policy.allows('https://cdn.example.com/a.png')).toBe(true)
    expect(policy.allows('https://EXAMPLE.com:8443/a.png')).toBe(true)
    expect(policy.allows('https://notexample.com/a.png')).toBe(false)
    expect(policy.allows('https://example.com.evil.net/a.png')).toBe(false)
  })

  it('offline：远端全拦', () => {
    expect(portal('offline').allows(IMG)).toBe(false)
    expect(portal('offline').allows('http://127.0.0.1:8080/a.png')).toBe(false)
  })

  it('三个模式都放行本地引用（相对路径 / data: / blob: / 锚点）', () => {
    const locals = ['/files/a.pdf', './a.png', '../a.png', 'data:image/gif;base64,R0lGOD', 'blob:abc', '#anchor', '']
    NETWORK_MODES.forEach((mode) => {
      const policy = portal(mode)
      locals.forEach((url) => expect(policy.allows(url), `${mode} ${url}`).toBe(true))
    })
    expect(isLocalUrl('https://cdn.example.com/a.png')).toBe(false)
    expect(isLocalUrl(null)).toBe(true)
  })

  it('urlHost 取不到主机时返回空串（不抛）', () => {
    expect(urlHost('https://cdn.example.com/a.png')).toBe('cdn.example.com')
    expect(urlHost('/local/a.png')).toBe('local.invalid')
    expect(urlHost(null)).toBe('')
    expect(urlHost(123)).toBe('')
  })

  it('describe() 报出的是脱敏后的白名单（去协议、去路径）', () => {
    const described = createNetworkPolicy({ mode: 'allowlist', allowlist: ['https://A.com/x/y'] }).describe()
    expect(described).toEqual({ mode: 'allowlist', allowlist: ['a.com'], imageProxy: false })
  })
})

describe('applyDocument：载入时降级', () => {
  const doc = (node) => ({ type: 'doc', content: [{ type: 'paragraph', content: [node] }] })

  it('open：文档原样返回', () => {
    const input = doc({ type: 'image', attrs: { src: IMG } })
    expect(portal('open').applyDocument(input)).toEqual(input)
  })

  it('offline：图片 src 换透明占位，原地址进 originalSrc', () => {
    const output = portal('offline').applyDocument(doc({ type: 'image', attrs: { src: IMG, alt: '图' } }))
    const image = output.content[0].content[0]
    expect(image.attrs.src).toBe(BLOCKED_IMAGE_PLACEHOLDER)
    expect(image.attrs.originalSrc).toBe(IMG)
    expect(image.attrs.alt).toBe('图')
  })

  it('已有 originalSrc 时不覆盖（第二次处理保持最初原地址）', () => {
    const input = doc({ type: 'image', attrs: { src: IMG, originalSrc: 'https://old.example.com/o.png' } })
    const image = portal('offline').applyDocument(input).content[0].content[0]
    expect(image.attrs.originalSrc).toBe('https://old.example.com/o.png')
    expect(image.attrs.src).toBe(BLOCKED_IMAGE_PLACEHOLDER)
  })

  it('allowlist：白名单内的图片不动，名单外的图降级', () => {
    const policy = portal('allowlist', ['example.com'])
    const kept = policy.applyDocument(doc({ type: 'image', attrs: { src: 'https://cdn.example.com/a.png' } }))
    expect(kept.content[0].content[0].attrs.src).toBe('https://cdn.example.com/a.png')
    const blocked = policy.applyDocument(doc({ type: 'image', attrs: { src: 'https://img.other.net/a.png' } }))
    expect(blocked.content[0].content[0].attrs.src).toBe(BLOCKED_IMAGE_PLACEHOLDER)
  })

  it('offline：文件块 src 清成 null 并保留 originalSrc（iframe 塞 GIF 会得到空白预览）', () => {
    const input = doc({ type: 'fileBlock', attrs: { token: null, src: PDF, name: 'a.pdf', mimeType: 'application/pdf' } })
    const attrs = portal('offline').applyDocument(input).content[0].content[0].attrs
    expect(attrs.src).toBeNull()
    expect(attrs.originalSrc).toBe(PDF)
    // 其余属性和文件名不受影响：块壳仍要在，只是没有可渲染地址。
    expect(attrs.name).toBe('a.pdf')
    expect(attrs.mimeType).toBe('application/pdf')
  })

  it('offline：文件块 coverUrl 换透明占位（封面是图，可以就地顶替）', () => {
    const input = doc({ type: 'fileBlock', attrs: { src: 'https://files.example.com/a.mp4', mimeType: 'video/mp4', coverUrl: IMG } })
    const attrs = portal('offline').applyDocument(input).content[0].content[0].attrs
    expect(attrs.src).toBeNull()
    expect(attrs.coverUrl).toBe(BLOCKED_IMAGE_PLACEHOLDER)
  })

  it('不修改入参（深拷贝后再降级）', () => {
    const input = doc({ type: 'image', attrs: { src: IMG } })
    portal('offline').applyDocument(input)
    expect(input.content[0].content[0].attrs.src).toBe(IMG)
    expect(input.content[0].content[0].attrs.originalSrc).toBeUndefined()
  })

  it('递归到嵌套结构（引用块里的图一样拦）', () => {
    const input = {
      type: 'doc',
      content: [{ type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'image', attrs: { src: IMG } }] }] }],
    }
    const image = portal('offline').applyDocument(input).content[0].content[0].content[0]
    expect(image.attrs.src).toBe(BLOCKED_IMAGE_PLACEHOLDER)
  })

  it('非对象入参原样返回（null / 字符串不炸）', () => {
    const policy = portal('offline')
    expect(policy.applyDocument(null)).toBeNull()
    expect(policy.applyDocument('x')).toBe('x')
  })
})

describe('filterHtml：粘贴时降级', () => {
  const html = (fragment) => portal('offline').filterHtml(fragment)
  const parse = (source) => {
    const container = document.createElement('div')
    container.innerHTML = source
    return container
  }

  it('offline：img 换透明占位，并留下原地址与拦截标记', () => {
    const el = parse(html(`<p><img src="${IMG}" alt="图"></p>`)).querySelector('img')
    expect(el.getAttribute('src')).toBe(BLOCKED_IMAGE_PLACEHOLDER)
    expect(el.getAttribute('data-original-src')).toBe(IMG)
    expect(el.getAttribute('data-network-blocked')).toBe('true')
    expect(el.getAttribute('alt')).toBe('图')
  })

  it('重复过滤不覆盖最初的原地址', () => {
    const once = html(`<img src="${IMG}">`)
    const twice = parse(html(once)).querySelector('img')
    expect(twice.getAttribute('data-original-src')).toBe(IMG)
  })

  it('offline：video 摘掉 src 但保留原地址（不留空白 GIF 预览）', () => {
    const el = parse(html(`<video src="${PDF}" controls></video>`)).querySelector('video')
    expect(el.hasAttribute('src')).toBe(false)
    expect(el.getAttribute('data-original-src')).toBe(PDF)
    expect(el.getAttribute('data-network-blocked')).toBe('true')
  })

  it('offline：iframe 同样只摘 src（PDF 内嵌预览不留空白帧）', () => {
    const el = parse(html(`<iframe src="${PDF}" title="预览"></iframe>`)).querySelector('iframe')
    expect(el.hasAttribute('src')).toBe(false)
    expect(el.getAttribute('data-original-src')).toBe(PDF)
    expect(el.getAttribute('title')).toBe('预览')
  })

  it('offline：video poster 直接摘掉（封面没了不影响布局，塞 GIF 会盖住首帧）', () => {
    const el = parse(html(`<video src="/local/a.mp4" poster="${IMG}"></video>`)).querySelector('video')
    expect(el.hasAttribute('poster')).toBe(false)
    // 本地视频地址本身放行，不能被顺带摘掉。
    expect(el.getAttribute('src')).toBe('/local/a.mp4')
  })

  it('open：HTML 原样返回', () => {
    const source = `<img src="${IMG}"><iframe src="${PDF}"></iframe>`
    expect(portal('open').filterHtml(source)).toBe(source)
  })

  it('本地引用在白名单 / 离线模式下都不动', () => {
    const source = '<img src="/static/a.png">'
    NETWORK_MODES.forEach((mode) => expect(portal(mode).filterHtml(source)).toBe(source))
  })

  it('非字符串入参原样返回', () => {
    expect(portal('offline').filterHtml(null)).toBeNull()
    expect(portal('offline').filterHtml(42)).toBe(42)
  })
})

describe('resolveImage：宿主代理兜底', () => {
  it('放行时直通，不调代理', async () => {
    let called = 0
    const policy = createNetworkPolicy({ mode: 'open', imageProxy: () => { called += 1; return '/x.png' } })
    await expect(policy.resolveImage(IMG)).resolves.toBe(IMG)
    expect(called).toBe(0)
  })

  it('offline 且没有 imageProxy：抛错（不静默留一个会发请求的地址）', async () => {
    await expect(portal('offline').resolveImage(IMG)).rejects.toThrow('未提供 imageProxy')
  })

  it('proxy 换回外链地址：仍然抛错', async () => {
    const policy = createNetworkPolicy({ mode: 'offline', imageProxy: async () => 'https://cdn.other.net/a.png' })
    await expect(policy.resolveImage(IMG)).rejects.toThrow('未返回本地图片地址')
  })

  it('proxy 换回本地地址：返回本地地址', async () => {
    const policy = createNetworkPolicy({ mode: 'offline', imageProxy: async () => '/proxied/a.png' })
    await expect(policy.resolveImage(IMG)).resolves.toBe('/proxied/a.png')
  })
})
