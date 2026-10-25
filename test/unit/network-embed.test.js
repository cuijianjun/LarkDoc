/**
 * P3-06 出网策略统一到嵌入层：`network.mode` 同时管 **iframe src** 与**卡片 provider 请求**。
 *
 * 09 §634 的验收口径：
 *   - `offline` 下 iframe 不设 src、显示 poster；
 *   - `allowlist` 拦截非白名单 host。
 *
 * 三层用例：
 * 1. 装配层（`components/lark-doc/extensions.js`）——策略怎么变成闸门：
 *    只有非 `open` 档才接线，`open` 保持「不干预」（P3-05 行为逐字节不变）；
 * 2. 内嵌网页 —— NodeView 的 `STATUS.BLOCKED` 真的不造 iframe、poster 真的看得见
 *    （块高必须留住，否则 poster 塌成 0）；
 * 3. 卡片抓取 —— 被拦的地址**连宿主函数都不进**，且降级结果与抓取失败同形
 *    （02 §24 ③-ter：失败 = 只有 URL + 域名的正常简卡，不加错误 UI）。
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { createLarkDocExtensions } from '../../src/components/lark-doc/extensions'
import { createNetworkPolicy } from '../../src/core/policy/network'
import { createUnfurlProvider, UNFURL_ERROR, withUnfurlGate } from '../../src/core/embed/unfurl'

const REMOTE = 'https://www.figma.com/embed?embed_host=lark'
const ALLOWED = 'https://docs.corp.example/a'
const POSTER = 'data:image/png;base64,iVBORw0KGgo='

const mounted = []
afterEach(() => {
  while (mounted.length) mounted.pop().cleanup()
})

/** 装配层产出的扩展数组里取某块的 options —— 不做 DOM 挂载，只看接线结果。 */
const optionsOf = (options, name) => createLarkDocExtensions(options).find((extension) => extension.name === name).options
const canEmbedOf = (network) => optionsOf({ config: { network } }, 'webEmbed').canEmbed
const unfurlOf = (network, provider) => optionsOf({ config: { network }, unfurlProvider: provider }, 'bookmark').unfurl

function mountEmbed(network) {
  const editor = new Editor({
    extensions: createLarkDocExtensions({ config: { network } }),
    content: { type: 'doc', content: [{ type: 'webEmbed', attrs: { src: REMOTE, poster: POSTER } }] },
  })
  mounted.push({ cleanup: () => editor.destroy() })
  return editor
}

describe('内嵌网页：iframe src 也归策略管', () => {
  it('offline 拦远端、放行本地资源', () => {
    const canEmbed = canEmbedOf({ mode: 'offline' })
    expect(canEmbed(REMOTE)).toBe(false)
    // 相对路径 / data: 是本地资源，任何模式都不拦（同 `isLocalUrl` 口径）。
    expect(canEmbed('./local.html')).toBe(true)
    expect(canEmbed('data:text/html,<b>x</b>')).toBe(true)
  })

  it('allowlist 只放行白名单 host 与它的子域，拦住后缀伪装', () => {
    const canEmbed = canEmbedOf({ mode: 'allowlist', allowlist: ['figma.com', 'https://Docs.Corp.example/x'] })
    expect(canEmbed('https://www.figma.com/embed')).toBe(true)
    expect(canEmbed('https://figma.com/embed')).toBe(true)
    // `evil-figma.com` 的 host 不以 `.figma.com` 结尾 —— 不能靠字符串包含判白名单。
    expect(canEmbed('https://evil-figma.com/embed')).toBe(false)
    // allowlist 项带协议与路径时要被归一化成 host（`normalizeHost`）。
    expect(canEmbed(ALLOWED)).toBe(true)
  })

  it('open 档不接线：canEmbed 为 null（P3-01 的「不干预」原样保留）', () => {
    expect(canEmbedOf({ mode: 'open' })).toBeNull()
    expect(canEmbedOf(undefined)).toBeNull()
  })

  it('宿主显式 canEmbed 优先于策略', () => {
    const canEmbed = optionsOf({ config: { network: { mode: 'open' } }, canEmbed: () => false }, 'webEmbed').canEmbed
    expect(canEmbed(REMOTE)).toBe(false)
  })

  it('offline 下真挂载：blocked、不造 iframe、poster 可见', () => {
    const editor = mountEmbed({ mode: 'offline' })
    const figure = editor.view.dom.querySelector('figure.lark-doc-embed')
    expect(figure.getAttribute('data-embed-state')).toBe('blocked')
    expect(figure.querySelector('iframe')).toBeNull()
    expect(figure.querySelector('.lark-doc-embed-fallback.is-blocked')).toBeTruthy()
    expect(figure.querySelector('.lark-doc-embed-poster')).toBeTruthy()
    // 块高必须留住：`flex: 1 1 auto` 的 poster 在 0 高的壳里是看不见的。
    expect(figure.querySelector('.lark-doc-embed-frame').style.height).toMatch(/^\d+px$/)
  })

  it('open 档真挂载照旧出 iframe', () => {
    const editor = mountEmbed({ mode: 'open' })
    const figure = editor.view.dom.querySelector('figure.lark-doc-embed')
    expect(figure.querySelector('iframe')).toBeTruthy()
  })
})

describe('卡片 provider 请求：被拦就不发请求', () => {
  const allowsOf = (network) => createNetworkPolicy(network).allows

  it('offline：宿主抓取器一次都不进，退回「只有 URL + 域名」的简卡', async () => {
    const spy = vi.fn(() => ({ title: '抓到了' }))
    const provider = withUnfurlGate(createUnfurlProvider(spy), allowsOf({ mode: 'offline' }))
    const result = await provider.unfurl(REMOTE)
    expect(spy).not.toHaveBeenCalled()
    expect(result.ok).toBe(false)
    expect(result.error).toBe(UNFURL_ERROR.BLOCKED)
    expect(result.title).toBeNull()
    expect(result.desc).toBeNull()
    expect(result.url).toBe(REMOTE)
  })

  it('allowlist：白名单照抓，非白名单不抓', async () => {
    const spy = vi.fn((url) => ({ title: `meta:${url}` }))
    const provider = withUnfurlGate(createUnfurlProvider(spy), allowsOf({ mode: 'allowlist', allowlist: ['corp.example'] }))
    await expect(provider.unfurl(ALLOWED)).resolves.toMatchObject({ ok: true, title: `meta:${ALLOWED}` })
    await expect(provider.unfurl(REMOTE)).resolves.toMatchObject({ ok: false, error: UNFURL_ERROR.BLOCKED })
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('open 档原样透传，连包装都不做（同一引用）', () => {
    const provider = createUnfurlProvider(() => ({ title: 'x' }))
    expect(unfurlOf({ mode: 'open' }, provider)).toBe(provider)
  })

  it('非 open 档的装配结果确实带闸门', async () => {
    const spy = vi.fn(() => ({ title: '抓到' }))
    const gated = unfurlOf({ mode: 'offline' }, createUnfurlProvider(spy))
    expect(spy).not.toHaveBeenCalled()
    await expect(gated.unfurl(REMOTE)).resolves.toMatchObject({ ok: false, error: UNFURL_ERROR.BLOCKED })
    expect(spy).not.toHaveBeenCalled()
  })

  it('闸门保持形状：裸函数 → 裸函数，null → null，无谓词 → 原样', async () => {
    const spy = vi.fn(() => ({ title: 'x' }))
    const bare = withUnfurlGate(spy, allowsOf({ mode: 'offline' }))
    expect(typeof bare).toBe('function')
    await expect(bare(REMOTE)).resolves.toMatchObject({ ok: false, error: UNFURL_ERROR.BLOCKED })

    expect(withUnfurlGate(null, allowsOf({ mode: 'offline' }))).toBeNull()
    const provider = { unfurl: spy }
    expect(withUnfurlGate(provider, null)).toBe(provider)
  })
})

describe('载入降级与单一策略实例', () => {
  const doc = (attrs) => ({ type: 'doc', content: [{ type: 'bookmark', attrs }] })

  it('offline 载入时清掉 bookmark 的远端 favicon（不发请求），原对象不动', () => {
    const input = doc({ url: REMOTE, favicon: `${REMOTE}/favicon.ico` })
    const output = createNetworkPolicy({ mode: 'offline' }).applyDocument(input)
    expect(output.content[0].attrs.favicon).toBeNull()
    expect(input.content[0].attrs.favicon).toBe(`${REMOTE}/favicon.ico`)
  })

  it('allowlist 保留白名单 favicon；本地 data: 图标任何模式都留', () => {
    const policy = createNetworkPolicy({ mode: 'allowlist', allowlist: ['corp.example'] })
    const kept = policy.applyDocument(doc({ url: ALLOWED, favicon: `${ALLOWED}/favicon.ico` }))
    expect(kept.content[0].attrs.favicon).toBe(`${ALLOWED}/favicon.ico`)
    const local = policy.applyDocument(doc({ url: REMOTE, favicon: POSTER }))
    expect(local.content[0].attrs.favicon).toBe(POSTER)
  })

  it('粘贴过滤与嵌入闸门共用同一个策略实例', () => {
    const editor = new Editor({
      extensions: createLarkDocExtensions({ config: { network: { mode: 'offline' } } }),
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] },
    })
    mounted.push({ cleanup: () => editor.destroy() })
    const network = editor.storage.larkDoc.network
    expect(network.mode).toBe('offline')
    // 同一个判定：storage 里的实例拦的东西，就是 iframe 闸门拦的东西。
    const canEmbed = editor.extensionManager.extensions.find((item) => item.name === 'webEmbed').options.canEmbed
    expect(canEmbed(REMOTE)).toBe(network.allows(REMOTE))
    expect(network.filterHtml('<img src="https://cdn.other.net/a.png">')).toContain('data-network-blocked')
  })
})
