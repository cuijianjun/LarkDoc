/**
 * P3-03 `EmbedDef` 注册表 + `resolveEmbed` + 15 条 preset。
 *
 * 验收口径（09 §5.4）：**每条 preset 一条单测（URL → attrs）；未命中不报错**。
 * 另外把三条「容易复刻错」的实测结论单独钉住：
 *
 * 1. **`src` 按 URL 的 host 判定，不按菜单项**（04 §4.3 ⑤.1 W2/W3）—— 所以下面
 *    出现「点哔哩哔哩粘抖音链接」的跨站用例，它不是边角料，是这条设计的原件；
 * 2. **没有白名单**（⑤.1 W1）—— 任意 host 都给出可落的结果，`def: null` 只是
 *    「不认识」，不是失败；
 * 3. **块高不是全局等比** —— airtable 602 / jcode 485，其余 463。
 *
 * 纯数据 + 纯函数，不需要 DOM，所以不打 `@vitest-environment jsdom`。
 */
import { describe, expect, it } from 'vitest'
import { EMBED_PRESETS } from '../../src/core/embed/types'
import { EMBED_MENU_ITEMS, EMBED_PRESETS as PRESETS_FROM_DATA, EMBED_SRC_RULES } from '../../src/core/embed/presets'
import { findEmbedRule, resolveEmbed } from '../../src/core/embed/resolve'
import { resolveEmbedHeight } from '../../src/core/embed/web-embed'

/**
 * 15 条：id / 输入 URL / 期望 `src` / 期望块高。
 * URL 全部取自 04 §4.3 ④.1 的 placeholder 形态（换成真值），块高即该表最后一列。
 */
const CASES = [
  {
    id: 'douyin_embed_video',
    label: '抖音',
    url: 'https://www.douyin.com/video/7123456789012345678',
    src: 'https://open.douyin.com/player/video?vid=7123456789012345678&mode=pc&source_from=lark',
  },
  {
    id: 'bilibili',
    label: '哔哩哔哩',
    url: 'https://www.bilibili.com/video/BV1GJ411x7h7',
    src: 'https://player.bilibili.com/player.html?autoplay=0&bvid=1GJ411x7h7',
  },
  {
    id: 'youku',
    label: '优酷视频',
    url: 'https://v.youku.com/v_show/id_XNTk1MjM0NTY3OA==.html',
    src: 'https://player.youku.com/embed/XNTk1MjM0NTY3OA==',
  },
  {
    id: 'iqiyi_video',
    label: '爱奇艺',
    url: 'https://www.iqiyi.com/v_1a2b3c4d5e.html',
    src: 'https://www.iqiyi.com/v_1a2b3c4d5e.html?autoplay=false',
  },
  {
    id: 'byte_jimeng',
    label: '即梦AI',
    url: 'https://jimeng.jianying.com/ai-tool/work-detail/1234567890',
    src: 'https://jimeng.jianying.com/ai-tool/embed/work-detail/1234567890?autoplay=false',
  },
  {
    id: 'figma',
    label: 'Figma',
    url: 'https://www.figma.com/file/abc123/Design',
    src: 'https://www.figma.com/embed?embed_host=share&url=https%3A%2F%2Fwww.figma.com%2Ffile%2Fabc123%2FDesign',
  },
  {
    id: 'modao',
    label: '墨刀',
    url: 'https://modao.cc/app/45e1234567890abcdef',
    // 🔴 末尾那个孤零零的 `?` 是实测原样，不要「顺手清理」成不带 query 的地址。
    src: 'https://modao.cc/app/45e1234567890abcdef/embed/v2/sharing?',
  },
  {
    id: 'canva',
    label: 'Canva',
    url: 'https://www.canva.cn/design/DAF123456/view',
    src: 'https://www.canva.cn/design/DAF123456/view',
  },
  {
    id: 'jcode',
    label: '码上掘金',
    url: 'https://code.juejin.cn/pen/7123456789012345678',
    src: 'https://code.juejin.cn/pen/7123456789012345678',
    height: 485,
  },
  {
    id: 'codepen',
    label: 'CodePen',
    url: 'https://codepen.io/lark/pen/abcDEF',
    src: 'https://codepen.io/lark/pen/abcDEF',
  },
  {
    id: 'feishu_survey',
    label: '飞书问卷',
    url: 'https://wenjuan.feishu.cn/m/cfm1234567',
    src: 'https://wenjuan.feishu.cn/m/cfm1234567',
  },
  {
    id: 'jinshuju',
    label: '金数据',
    url: 'https://jinshuju.net/f/abcdefg',
    // id 只取前 6 位（实测 `abcdefg` → `abcdef`）+ 固定 4 个参数。
    src: 'https://jinshuju.net/f/abcdef?background=white&banner=show&embedded=true&inner_redirect=false',
  },
  {
    id: 'airtable',
    label: 'Airtable',
    url: 'https://airtable.com/shrAbCdEf123456/tblXYZ/viwABC',
    src: 'https://airtable.com/embed/shrAbCdEf123456?backgroundColor=purple&viewControls=on',
    height: 602,
  },
  {
    id: 'baidumap',
    label: '百度地图',
    url: 'https://map.baidu.com/@12958175,4825925,15z',
    src: 'https://map.baidu.com/@12958175,4825925,15z',
  },
  {
    id: 'autonavi',
    label: '高德地图',
    url: 'https://www.amap.com/place/B000A7V6C9',
    src: 'https://www.amap.com/place/B000A7V6C9',
  },
]

describe('P3-03 15 条预设', () => {
  it('数据文件自洽：15 条菜单项 / 15 条规则 / 15 条 def，id 一一对应', () => {
    expect(EMBED_PRESETS).toHaveLength(15)
    expect(EMBED_MENU_ITEMS).toHaveLength(15)
    expect(EMBED_SRC_RULES).toHaveLength(15)
    expect(CASES).toHaveLength(15)

    const ids = EMBED_PRESETS.map((preset) => preset.id)
    expect(new Set(ids).size).toBe(15)
    // 三份数据（菜单 / 规则 / 用例）的 id 集合必须与 def 完全一致：
    // 少一条说明有站点落不下来，多一条说明 def 是凭空写的。
    expect(EMBED_MENU_ITEMS.map((item) => item.id).sort()).toEqual([...ids].sort())
    expect(EMBED_SRC_RULES.map((rule) => rule.id).sort()).toEqual([...ids].sort())
    expect(CASES.map((item) => item.id).sort()).toEqual([...ids].sort())
  })

  it('types.js 转发的是同一份数据（不是又抄了一遍）', () => {
    // 同一引用即可证明「一个数据文件」；拷贝一份的话这里会是不同的数组实例。
    expect(EMBED_PRESETS).toBe(PRESETS_FROM_DATA)
  })

  describe.each(CASES)('$id', ({ id, label, url, src, height }) => {
    const { def, kind, attrs } = resolveEmbed(url)

    it('命中 def，落 iframe 块', () => {
      expect(def).not.toBeNull()
      expect(def.id).toBe(id)
      expect(def.label).toBe(label)
      expect(kind).toBe('iframe')
    })

    it('providerId / title 来自 def', () => {
      expect(attrs.providerId).toBe(id)
      expect(attrs.title).toBe(label)
    })

    it('src 规范化', () => {
      expect(attrs.src).toBe(src)
    })

    it(`块高 ${height || 463}`, () => {
      expect(resolveEmbedHeight(attrs)).toBe(height || 463)
    })
  })

  it('aspect 只写进两条例外，其余走 463 兜底（不撑 JSON 噪音字段）', () => {
    const withAspect = CASES.filter((item) => resolveEmbed(item.url).attrs.aspect !== undefined)
    expect(withAspect.map((item) => item.id)).toEqual(['jcode', 'airtable'])
    expect(resolveEmbed(CASES.find((item) => item.id === 'jcode').url).attrs.aspect).toBe(1.691)
    expect(resolveEmbed(CASES.find((item) => item.id === 'airtable').url).attrs.aspect).toBe(1.363)
    // 打头那条（douyin）代表其余 13 项：attrs 里连 aspect 这个 key 都不该出现。
    expect(Object.keys(resolveEmbed(CASES[0].url).attrs).sort()).toEqual(['providerId', 'src', 'title'])
  })
})

describe('P3-03 src 规范化的边界', () => {
  it('iqiyi 已经有 autoplay 就不再重复加', () => {
    expect(resolveEmbed('https://www.iqiyi.com/v_1a2b3c4d5e.html?autoplay=true').attrs.src)
      .toBe('https://www.iqiyi.com/v_1a2b3c4d5e.html?autoplay=true')
    // 已有别的 query 时用 `&` 接，不是 `?`。
    expect(resolveEmbed('https://www.iqiyi.com/v_1a2b3c4d5e.html?p1=2').attrs.src)
      .toBe('https://www.iqiyi.com/v_1a2b3c4d5e.html?p1=2&autoplay=false')
  })

  it('figma 已经包过 embed 就不二次包裹', () => {
    const wrapped = 'https://www.figma.com/embed?embed_host=share&url=https%3A%2F%2Fexample.com'
    expect(resolveEmbed(wrapped).attrs.src).toBe(wrapped)
  })

  it('modao 已经带 /embed/v2/sharing 就不再追加', () => {
    const shared = 'https://modao.cc/app/45e1234567890abcdef/embed/v2/sharing?'
    expect(resolveEmbed(shared).attrs.src).toBe(shared)
    // 尾部斜杠会被剥掉再拼，否则会出现 `//embed`。
    expect(resolveEmbed('https://modao.cc/app/45e1234567890abcdef/').attrs.src)
      .toBe('https://modao.cc/app/45e1234567890abcdef/embed/v2/sharing?')
  })

  it('认不出形态的站点 URL 原样直通（不抛错、不返回空串）', () => {
    // 命中了 bilibili 这个 host，但路径里没有 BV 号 —— def 照样命中，src 原样。
    const home = 'https://www.bilibili.com/'
    expect(resolveEmbed(home)).toMatchObject({ kind: 'iframe', attrs: { providerId: 'bilibili', src: home } })
    expect(resolveEmbed('https://jinshuju.net/').attrs.src).toBe('https://jinshuju.net/')
  })
})

describe('P3-03 host 匹配口径', () => {
  it('🔴 跨站：点「哔哩哔哩」粘抖音链接，落的是抖音播放器（W2）', () => {
    // 菜单项完全没参与匹配 —— 只要 URL 的 host 是 douyin.com 就走抖音规则。
    const { def, attrs } = resolveEmbed('https://www.douyin.com/video/7123456789012345678')
    expect(def.id).toBe('douyin_embed_video')
    expect(attrs.src).toBe('https://open.douyin.com/player/video?vid=7123456789012345678&mode=pc&source_from=lark')
  })

  it('🔴 跨站：点「CodePen」粘哔哩哔哩链接，落的是 bilibili 播放器（W3）', () => {
    const { def, attrs } = resolveEmbed('https://www.bilibili.com/video/BV1GJ411x7h7')
    expect(def.id).toBe('bilibili')
    expect(attrs.src).toBe('https://player.bilibili.com/player.html?autoplay=0&bvid=1GJ411x7h7')
  })

  it('后缀匹配覆盖子域，但不误伤同后缀的其他域名', () => {
    expect(findEmbedRule('https://m.douyin.com/share/video/7123456789').id).toBe('douyin_embed_video')
    expect(findEmbedRule('https://ditu.amap.com/place/B000A7V6C9').id).toBe('autonavi')
    // `notdouyin.com` 必须以点分界才算同一站，否则任意「长得像」的域名都能冒充。
    expect(findEmbedRule('https://notdouyin.com/video/7123456789')).toBeNull()
  })

  it('百度地图只认 map.baidu.com，不认 baidu.com 的其它页面', () => {
    expect(findEmbedRule('https://map.baidu.com/@1,2,15z').id).toBe('baidumap')
    expect(findEmbedRule('https://www.baidu.com/s?wd=lark')).toBeNull()
  })
})

describe('P3-03 未命中不报错', () => {
  const UNKNOWN = [
    'https://example.com/foo/bar',
    'https://notdouyin.com/video/7123456789',
    '', // 空串（用户没填就点确定）
    '   ', // 只有空白
    'example.com', // 缺协议，URL 解析失败
    'javascript:alert(1)', // 无 hostname
    'mailto:dev@example.com', // 无 hostname
  ]

  it.each(UNKNOWN)('%s → 书签卡，src 原样，不抛错', (url) => {
    let result
    expect(() => { result = resolveEmbed(url) }).not.toThrow()
    expect(result.def).toBeNull()
    expect(result.kind).toBe('bookmark')
    expect(result.attrs).toEqual({ providerId: 'generic', src: url.trim() })
  })

  it('非字符串输入同样不抛错（调用方可能传了 undefined）', () => {
    for (const value of [undefined, null, 42, {}]) {
      expect(resolveEmbed(value).attrs).toEqual({ providerId: 'generic', src: '' })
    }
  })

  it('未命中的 src 与 webEmbed 的 src 校验解耦（这里放行，判不合法是块定义的事）', () => {
    // 解析层只做映射；`javascript:` 会在这里原样返回，成败由 setWebEmbed / validator 判。
    // 混在一起会让「为什么这个链接不落块」无从排查。
    expect(resolveEmbed('javascript:alert(1)').attrs.src).toBe('javascript:alert(1)')
  })
})
