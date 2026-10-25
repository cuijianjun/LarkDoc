/**
 * 15 条内嵌网页预设 + 按 host 匹配的 `src` 改写规则（P3-03）。
 *
 * 规格来源 requirements/04 §4.3 ④.1（15 项浮层文案 + URL 规范化全表）与
 * §4.3 ⑤.1（三探针，两条旧口径被推翻）。
 *
 * 🔴 **为什么拆成两层，而不是「一个菜单项一条规则」**：
 * ⑤.1 的 W2/W3 探针证明 `src` 改写**按 URL 的 host 判定，不按用户点的菜单项**——
 * 点「哔哩哔哩」粘抖音链接，落下来的是抖音的播放器。菜单项**只决定浮层文案**
 * （标题 / placeholder）。所以：
 *   - `EMBED_MENU_ITEMS`：15 条文案数据（浮层标题 + placeholder），顺序 = 斜杠菜单顺序；
 *   - `EMBED_SRC_RULES`：host → 规范化后的 src（+ 站点级默认比例），与菜单项**互不引用**；
 *   - 两者只靠 `id` 发生一次弱联系：命中规则后拿同 id 的 label 当块标题。
 *
 * 🔴 **不存在域名白名单**（⑤.1 W1）：任意 host 都能落块、无 toast、无报错 UI。
 * 这里因此没有任何 `allow` / `deny` 清单，`hosts` 只用于「要不要改写 src」。
 *
 * 新增一种内嵌只需改本文件一条数据（09 §5.4 出口标准），不碰 core。
 */
import { WEB_EMBED_DEFAULT_ASPECT } from './web-embed'

/**
 * 站点级默认比例（04 §4.3 ④.1 实测）。
 *
 * 13 项是 820×463 = 1.771，两条例外说明「高度不是全局等比，是站点级覆盖」：
 * airtable 820×602 = 1.363、jcode 820×485 = 1.691。
 */
const AIRTABLE_ASPECT = 1.363
const JCODE_ASPECT = 1.691

/* ==================================================================
   src 规范化（9 条特例；范式分布：换域重写 3 / 同域加参 1 / 插段 2 /
   包裹 1 / 加后缀 1 / 加 4 参并截 id 1，其余 6 条原样直通）
   每条都「认不出就原样返回」，绝不抛错、绝不返回空串 —— 落块失败比
   src 不规范更糟（⑤.1：无报错 UI，抛错等于用户点了没反应）。
   ================================================================== */

/** 换域重写：`douyin.com/video/{id}` → open.douyin.com 播放器。 */
function douyinSrc(url) {
  const match = /\/video\/(\d+)/.exec(url)
  if (!match) return url
  return `https://open.douyin.com/player/video?vid=${match[1]}&mode=pc&source_from=lark`
}

/** 换域重写：`bilibili.com/video/BVxxx` → player.bilibili.com。
 *
 *  🔴 **`bvid` 参数要把 `BV` 前缀剥掉**（`BV1GJ411x7h7` → `bvid=1GJ411x7h7`）。
 *  这不是笔误：04 §4.3 ④.1 与 ⑤.1 W3 两张实测表逐字都是 `bvid=1GJ411x7h7`。
 *  看着像飞书自己少拼了前缀，但目标是复刻实测结果，别按「B 站文档要求」改成
 *  `bvid=BV1GJ411x7h7` —— 那会和飞书落下来的 src 不一致。 */
function bilibiliSrc(url) {
  const match = /\/video\/(BV[0-9A-Za-z]+)/.exec(url)
  if (!match) return url
  return `https://player.bilibili.com/player.html?autoplay=0&bvid=${match[1].slice(2)}`
}

/** 换域重写：`v.youku.com/v_show/id_XXX.html` → player.youku.com/embed/XXX（剥 `.html`）。 */
function youkuSrc(url) {
  const match = /id_([0-9A-Za-z=]+)/.exec(url)
  if (!match) return url
  return `https://player.youku.com/embed/${match[1]}`
}

/** 同域加参：原 URL + `?autoplay=false`（已有 query 用 `&`，hash 之前插）。 */
function iqiyiSrc(url) {
  if (/[?&]autoplay=/.test(url)) return url
  const hashAt = url.indexOf('#')
  const base = hashAt === -1 ? url : url.slice(0, hashAt)
  const suffix = hashAt === -1 ? '' : url.slice(hashAt)
  return base + (base.indexOf('?') === -1 ? '?' : '&') + 'autoplay=false' + suffix
}

/** 插段：`/ai-tool/work-detail/{id}` → `/ai-tool/embed/work-detail/{id}?autoplay=false`。 */
function byteJimengSrc(url) {
  const match = /\/ai-tool\/work-detail\/([\w-]+)/.exec(url)
  if (!match) return url
  return `https://jimeng.jianying.com/ai-tool/embed/work-detail/${match[1]}?autoplay=false`
}

/** 包裹：原 URL 整个塞进 figma 的 embed 参数（已经包过的不二次包）。 */
function figmaSrc(url) {
  if (/figma\.com\/embed\b/.test(url)) return url
  return `https://www.figma.com/embed?embed_host=share&url=${encodeURIComponent(url)}`
}

/** 加后缀：`{原 URL}/embed/v2/sharing?`（**保留空 query 的那个 `?`**，实测就是这样）。 */
function modaoSrc(url) {
  if (/\/embed\/v2\/sharing/.test(url)) return url
  return `${url.replace(/\/+$/, '')}/embed/v2/sharing?`
}

/** 加 4 参并截 id：表单 id 只取前 6 位（实测 `abcdefg` → `abcdef`）。 */
function jinshujuSrc(url) {
  const match = /\/f\/([0-9A-Za-z]+)/.exec(url)
  if (!match) return url
  const id = match[1].slice(0, 6)
  return `https://jinshuju.net/f/${id}?background=white&banner=show&embedded=true&inner_redirect=false`
}

/** 插段 + 加参：`airtable.com/{shrId}` → `airtable.com/embed/{shrId}?backgroundColor=purple&viewControls=on`。 */
function airtableSrc(url) {
  const match = /shr[0-9A-Za-z]+/.exec(url)
  if (!match) return url
  return `https://airtable.com/embed/${match[0]}?backgroundColor=purple&viewControls=on`
}

/* ==================================================================
   15 条菜单文案（顺序 = 斜杠菜单「内嵌网页」组顺序，03 §内嵌网页）
   浮层三处文案：标题「粘贴{服务名}{类型词}链接」、placeholder、确认。
   `label` 是菜单可见文案，🔴 与 id 不同名的 3 项：youku→优酷视频 /
   byte_jimeng→即梦AI / autonavi→高德地图（别用文案反查 id）。
   ================================================================== */
export const EMBED_MENU_ITEMS = [
  { id: 'douyin_embed_video', label: '抖音', dialogTitle: '粘贴抖音视频链接', placeholder: 'https://www.douyin.com/...' },
  { id: 'bilibili', label: '哔哩哔哩', dialogTitle: '粘贴哔哩哔哩视频链接', placeholder: 'https://www.bilibili.com/video/...' },
  { id: 'youku', label: '优酷视频', dialogTitle: '粘贴优酷视频链接', placeholder: 'https://v.youku.com/v_show/...' },
  { id: 'iqiyi_video', label: '爱奇艺', dialogTitle: '粘贴爱奇艺视频链接', placeholder: 'https://www.iqiyi.com/...' },
  { id: 'byte_jimeng', label: '即梦AI', dialogTitle: '粘贴即梦AI素材链接', placeholder: 'https://jimeng.jianying.com/ai-tool/work-detail/...' },
  { id: 'figma', label: 'Figma', dialogTitle: '粘贴 Figma 文件或原型链接', placeholder: 'https://www.figma.com/...' },
  { id: 'modao', label: '墨刀', dialogTitle: '粘贴墨刀分享链接', placeholder: 'https://modao.cc/app/45e...' },
  { id: 'canva', label: 'Canva', dialogTitle: '粘贴 Canva 嵌入链接', placeholder: 'https://www.canva.cn/design/...' },
  { id: 'jcode', label: '码上掘金', dialogTitle: '粘贴码上掘金链接', placeholder: 'https://code.juejin.cn/pen/...' },
  { id: 'codepen', label: 'CodePen', dialogTitle: '粘贴 CodePen 链接', placeholder: 'https://codepen.io/...' },
  { id: 'feishu_survey', label: '飞书问卷', dialogTitle: '粘贴飞书问卷链接', placeholder: 'https://wenjuan.feishu.cn/m/...' },
  { id: 'jinshuju', label: '金数据', dialogTitle: '粘贴金数据表单链接', placeholder: 'https://jinshuju.net/f/...' },
  { id: 'airtable', label: 'Airtable', dialogTitle: '粘贴 Airtable Base 或 View 的共享链接', placeholder: 'https://airtable.com/shr...' },
  { id: 'baidumap', label: '百度地图', dialogTitle: '粘贴百度地图链接', placeholder: 'https://map.baidu.com/...' },
  { id: 'autonavi', label: '高德地图', dialogTitle: '粘贴高德地图链接', placeholder: 'https://www.amap.com/place/...' },
]

/* ==================================================================
   host → src 改写规则（顺序即匹配顺序；命中即停）
   `hosts` 是**后缀匹配**（`host === h || host.endsWith('.' + h)`），
   所以 'douyin.com' 同时覆盖 www / v 两个子域。
   没有 `toSrc` = 原样直通（6 条），但仍要留规则：一是 jcode 要带比例，
   二是「这个 host 属于某个站点」本身要能被识别出来（决定块标题）。
   ================================================================== */
export const EMBED_SRC_RULES = [
  { id: 'douyin_embed_video', hosts: ['douyin.com'], toSrc: douyinSrc },
  { id: 'bilibili', hosts: ['bilibili.com'], toSrc: bilibiliSrc },
  { id: 'youku', hosts: ['youku.com'], toSrc: youkuSrc },
  { id: 'iqiyi_video', hosts: ['iqiyi.com'], toSrc: iqiyiSrc },
  { id: 'byte_jimeng', hosts: ['jimeng.jianying.com'], toSrc: byteJimengSrc },
  { id: 'figma', hosts: ['figma.com'], toSrc: figmaSrc },
  { id: 'modao', hosts: ['modao.cc'], toSrc: modaoSrc },
  { id: 'canva', hosts: ['canva.cn', 'canva.com'] },
  { id: 'jcode', hosts: ['code.juejin.cn'], aspect: JCODE_ASPECT },
  { id: 'codepen', hosts: ['codepen.io'] },
  { id: 'feishu_survey', hosts: ['wenjuan.feishu.cn'] },
  { id: 'jinshuju', hosts: ['jinshuju.net'], toSrc: jinshujuSrc },
  { id: 'airtable', hosts: ['airtable.com'], toSrc: airtableSrc, aspect: AIRTABLE_ASPECT },
  { id: 'baidumap', hosts: ['map.baidu.com'] },
  { id: 'autonavi', hosts: ['amap.com'] },
]

/**
 * 15 条 `EmbedDef`（09 §3.4 的形状，`tier` 复用命令表三档）。
 *
 * 从菜单数据派生而不是另写一份：id / label / 顺序天然不会与浮层文案漂移，
 * `check-architecture` 守的「15 条、id 不重复、kind/tier 合法」也照旧成立。
 * `aspect` 只给两条例外，其余按 `WEB_EMBED_DEFAULT_ASPECT` 兜底。
 */
export const EMBED_PRESETS = EMBED_MENU_ITEMS.map(({ id, label }) => {
  const rule = EMBED_SRC_RULES.find((item) => item.id === id)
  return {
    id,
    kind: 'iframe',
    label,
    tier: 'skeleton',
    aspect: (rule && rule.aspect) || WEB_EMBED_DEFAULT_ASPECT,
  }
})
