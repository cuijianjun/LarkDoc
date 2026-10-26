/**
 * P3-07 批 A：15 条内嵌网页命令的接线（09 §635 ②③）+ 浮层「静默无效」的分界口径。
 *
 * 这里钉的是**接线**，不是视觉：浮层那 540×164 / z-index 99 / 按钮变色的像素验收
 * 在 `scripts/verify-browser-*.js` 里跑，单测拿不到 computedStyle 也不该去拿。
 *
 * 四条容易改坏、且改坏后不会报错的结论，各有一条用例守着：
 *
 * 1. **15 项必须整段连续贴尾** —— `CommandMenu.categories` 按首次出现顺序出组标题，
 *    插在中间会把「内嵌网页」顶到别的分类前面（`COMMAND_ORDER` 注释里写的原因）；
 * 2. **15 项都是 `plus: false`** —— `+` 菜单那 55 项里同类只有一条 `third content blocks`
 *    （03 §1185），漏了这个字段 `+` 菜单会凭空多出 15 行；
 * 3. **没有 `submenu`** —— 03 §1849 batch589 更正：它们不是二级面板，
 *    `A1_hit.arrow: false`，点击就是开浮层。给了 `submenu` 会变成右侧面板；
 * 4. **浮层「填 abc 静默无效」与「填任意 http URL 照样落块」是同一根分界线** ——
 *    `readHost` 返回 null 与否（04 §4.3 ⑤ / ⑤.1 W1）。两处口径分叉就会出现
 *    「浮层说 abc 不合法、但 resolveEmbed 却能落块」这种无法排查的状态。
 *
 * 纯数据 + 纯函数，不打 `@vitest-environment jsdom`。
 */
import { describe, expect, it } from 'vitest'
import { COMMANDS, commandFeatureOf, filterCommands } from '../../src/core/commands'
import { EMBED_HELP_URL, EMBED_MENU_ITEMS } from '../../src/core/embed/presets'
import { readHost, resolveEmbed } from '../../src/core/embed/resolve'

const EMBED_IDS = EMBED_MENU_ITEMS.map((item) => item.id)

/** 一条命令是不是内嵌网页那 15 项 —— 沿用生产代码的判定，别在这里另抄一份 id 表。 */
const isEmbed = (item) => commandFeatureOf(item.id) === 'embed'

describe('P3-07 内嵌网页命令接线', () => {
  it('COMMANDS 共 62 条，末 15 条就是 EMBED_MENU_ITEMS 的派生（顺序一致）', () => {
    // 62 = 原 32（22 条显式 + 9 个生成标题 + file）+ 15 条内嵌网页 + 3 条 mention（P4-01）
    //      + 1 条 reminder（P4-02a）+ 1 条 calendar_event（P4-02b）
    //      + 3 条按钮 + 1 条 catalogue（P4-04）+ 1 条 sheet（P5-02）+ 1 条 poll（P5-03）
    //      + 5 条多维表格（P5-04）
    //      − 1 条 emoji。
    // emoji 不是飞书斜杠的入口（02 §16 定判：唯一入口是高亮块图标位），0.12 起从命令表摘掉。
    // 这个字面量是「有人动了命令表」的显式提醒：加命令时请同时确认 order / 架构断言。
    expect(COMMANDS).toHaveLength(62)
    expect(COMMANDS.slice(-15).map((item) => item.id)).toEqual(EMBED_IDS)
  })

  it('派生没有多带字段：15 项全是 embed 组 / 内嵌网页分类 / plus:false / skeleton', () => {
    const embedItems = COMMANDS.filter(isEmbed)
    expect(embedItems).toHaveLength(15)

    for (const item of embedItems) {
      expect(item.group).toBe('embed')
      expect(item.category).toBe('内嵌网页')
      expect(item.plus).toBe(false)
      expect(item.tier).toBe('skeleton')
      // 03 §1849 batch589：没有箭头、点击即开浮层 —— 有 submenu 就会被渲染成二级面板。
      expect(item.submenu).toBeUndefined()
      expect(item.submenuType).toBeUndefined()
    }
  })

  it('15 个菜单字不重复（避免 15 个一样的点）', () => {
    const glyphs = COMMANDS.filter(isEmbed).map((item) => item.glyph)
    expect(glyphs.every(Boolean)).toBe(true)
    expect(new Set(glyphs).size).toBe(15)
  })

  it('label 来自 EMBED_MENU_ITEMS：3 条与 id 不同名，别按 id 反推文案', () => {
    for (const menu of EMBED_MENU_ITEMS) {
      expect(COMMANDS.find((item) => item.id === menu.id).label).toBe(menu.label)
    }
    // 这三条是最容易被「顺手改成 id 同名」的：
    expect(COMMANDS.find((item) => item.id === 'youku').label).toBe('优酷视频')
    expect(COMMANDS.find((item) => item.id === 'byte_jimeng').label).toBe('即梦AI')
    expect(COMMANDS.find((item) => item.id === 'autonavi').label).toBe('高德地图')
  })

  it('「内嵌网页」是斜杠菜单最后一个分类（贴尾 → 组标题落最后）', () => {
    const categories = []
    for (const item of filterCommands('', 'slash')) {
      if (!categories.includes(item.category)) categories.push(item.category)
    }
    expect(categories[categories.length - 1]).toBe('内嵌网页')
    // 前置分类还在（贴尾不等于抢位）。
    expect(categories).toContain('文字')
  })

  it('🔴 斜杠菜单 15 条、+ 菜单 0 条', () => {
    expect(filterCommands('', 'slash').filter(isEmbed)).toHaveLength(15)
    // 这条是 03 §1185「+ 菜单同类只有一条 third content blocks」的守门：
    // 15 条都是 plus:false，所以一条都不该出现在 + 菜单里。
    expect(filterCommands('', 'plus').filter(isEmbed)).toHaveLength(0)
  })

  it('搜索能按中文名和英文 id 命中', () => {
    const idsOf = (query) => filterCommands(query, 'slash').map((item) => item.id)
    expect(idsOf('哔哩')).toContain('bilibili')
    expect(idsOf('bilibili')).toContain('bilibili')
    expect(idsOf('高德')).toContain('autonavi')
    expect(idsOf('autonavi')).toContain('autonavi')
  })

  it('`embed` 一个开关管 15 条，且不误伤其它组', () => {
    const off = filterCommands('', 'slash', { features: { embed: false } })
    expect(off.filter(isEmbed)).toHaveLength(0)
    expect(off.some((item) => item.id === 'paragraph')).toBe(true)
    expect(off.some((item) => item.id === 'image')).toBe(true)
  })
})

describe('P3-07 commandFeatureOf', () => {
  it('15 条都指向同一个 embed 开关', () => {
    for (const id of EMBED_IDS) expect(commandFeatureOf(id)).toBe('embed')
  })

  it('没有专属开关的落 blockStyle（executeCommand 用这个值挑分支）', () => {
    expect(commandFeatureOf('paragraph')).toBe('blockStyle')
    expect(commandFeatureOf('heading1')).toBe('blockStyle')
    expect(commandFeatureOf('image')).toBe('images')
    expect(commandFeatureOf('file')).toBe('files')
    // P4-02a：日期提醒与三条 mention 共用一个「插入」开关（落正文的行内物件）。
    expect(commandFeatureOf('reminder')).toBe('insert')
    // 未知 id 不该炸，也不该被当成 embed。
    expect(commandFeatureOf('no_such_command')).toBe('blockStyle')
  })
})

describe('P3-07 浮层行为口径（纯函数侧）', () => {
  it('🔴 readHost 是「静默无效 / 落块」的分界线', () => {
    // 填这些 → 浮层不关、不 toast、不落块，只有「确认」底色变（04 §4.3 ⑤）。
    expect(readHost('abc')).toBeNull()
    expect(readHost('')).toBeNull()
    expect(readHost('   ')).toBeNull()
    expect(readHost('example.com')).toBeNull() // 缺协议，URL 解析失败
    expect(readHost('javascript:alert(1)')).toBeNull() // 无 hostname
    expect(readHost('mailto:dev@example.com')).toBeNull()
    expect(readHost(undefined)).toBeNull()
    expect(readHost(42)).toBeNull()

    // 填这些 → 浮层消失 + 落块（没有域名白名单，⑤.1 W1）。
    expect(readHost('https://example.com/foo/bar')).toBe('example.com')
    expect(readHost('  HTTPS://WWW.Bilibili.com/video/BV1  ')).toBe('www.bilibili.com')
  })

  it('未命中的 URL 落书签卡，不是错误、也不是「什么都不发生」', () => {
    const { def, kind, attrs } = resolveEmbed('https://example.com/foo/bar')
    expect(def).toBeNull()
    expect(kind).toBe('bookmark')
    expect(attrs).toEqual({ providerId: 'generic', src: 'https://example.com/foo/bar' })
  })

  it('命中的 URL 落 iframe 块', () => {
    const { def, kind, attrs } = resolveEmbed('https://www.bilibili.com/video/BV1GJ411x7h7')
    expect(def).not.toBeNull()
    expect(kind).toBe('iframe')
    expect(attrs.providerId).toBe('bilibili')
  })

  it('菜单项不参与匹配：点「抖音」粘哔哩哔哩链接，落的是 bilibili 播放器（⑤.1 W2/W3）', () => {
    // 浮层只把 URL 交给 resolveEmbed，菜单项只决定文案 —— 所以这里没有任何
    // 「用户点了哪一项」的参数可传。这条用例守的就是「别给 resolveEmbed 加菜单项入参」。
    expect(resolveEmbed.length).toBe(1)
    expect(resolveEmbed('https://www.bilibili.com/video/BV1GJ411x7h7').attrs.providerId).toBe('bilibili')
  })
})

describe('P3-07 帮助文档地址', () => {
  it('「如何获取链接 / 查看示例」两处共用同一个常量', () => {
    // 仓库里只有 requirements/04-浮层与弹窗.md:2552 的缩短片段
    // `feishu.cn/hc/…635939752168`，完整路径前缀是补全的 —— 要改只改这一处。
    expect(EMBED_HELP_URL).toBe('https://www.feishu.cn/hc/zh-CN/articles/635939752168')
  })
})
