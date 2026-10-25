/**
 * `resolveEmbed(url)` —— 一个 URL 该落成哪个节点、带什么属性（P3-03）。
 *
 * 规格来源 requirements/09 §3.4.3 与 requirements/04 §4.3 ⑤.1（三探针实测）。
 *
 * 三件必须说清的事：
 *
 * 1. **匹配按 URL 的 host，不按用户点的菜单项**（⑤.1 W2/W3）。点「哔哩哔哩」粘抖音链接，
 *    落的是抖音播放器；`EMBED_SRC_RULES` 因此只认 host，菜单项那份数据只供浮层文案用。
 *
 * 2. **没有白名单**（⑤.1 W1）。任意 host 都返回可落的结果，`def: null` 不是失败、
 *    不是异常，只是「这个站点我们不认识」——调用方据此落书签卡（09 §3.4.3）。
 *    本文件**不抛错、不返回 null**：抛错等于「用户粘了链接，点确定什么也没发生」。
 *
 * 3. **`aspect` 只在站点覆盖时才写进 attrs**。13 项走 `resolveEmbedHeight` 的 463 兜底，
 *    只有 airtable（1.363 → 602）和 jcode（1.691 → 485）落显式值 —— 与块定义
 *    「不要塞默认值把 JSON 撑出噪音字段」同一条纪律。
 */
import { EMBED_PRESETS, EMBED_SRC_RULES } from './presets'
import { GENERIC_PROVIDER_ID } from './web-embed'

/** 规则 id → preset（拿 label / kind / aspect）。数据文件是唯一出处，这里只建索引。 */
const PRESET_BY_ID = new Map(EMBED_PRESETS.map((preset) => [preset.id, preset]))

/**
 * 取出 host（小写）。推不出 host 的输入（空串、相对路径、`javascript:`、坏 URL）
 * 一律返回 `null` —— 那就是「未命中」，走书签卡，不报错。
 */
function readHost(value) {
  if (typeof value !== 'string') return null
  const raw = value.trim()
  if (!raw) return null
  try {
    const parsed = new URL(raw)
    // `mailto:` / `javascript:` 这类没有 hostname，靠这一条自然掉到未命中。
    return parsed.hostname ? parsed.hostname.toLowerCase() : null
  } catch (_) {
    return null
  }
}

/**
 * host 是否属于某条规则。**后缀匹配**：`host === h || host.endsWith('.' + h)`，
 * 所以 `douyin.com` 同时覆盖 `www.douyin.com` / `v.douyin.com`，但不会误伤
 * `notdouyin.com`（必须以点分界）。
 */
function hostMatches(host, candidate) {
  return host === candidate || host.endsWith(`.${candidate}`)
}

/**
 * 命中的规则（`EMBED_SRC_RULES` 的顺序即优先级，命中即停）。
 * 未命中返回 `null`；给「要不要按某个站点处理」的外部判断用（如出网白名单提示）。
 *
 * @param {string} url
 * @returns {{id: string, hosts: string[], toSrc?: Function, aspect?: number}|null}
 */
export function findEmbedRule(url) {
  const host = readHost(url)
  if (!host) return null
  return EMBED_SRC_RULES.find((rule) => rule.hosts.some((candidate) => hostMatches(host, candidate))) || null
}

/**
 * URL → `{ def, kind, attrs }`。
 *
 * - `def`：命中的 `EmbedDef`，未命中 `null`（**不是错误**）；
 * - `kind`：`'iframe'` = 落 `webEmbed`；`'bookmark'` = 落书签卡（09 §3.4.3 的降级出路）；
 * - `attrs`：直接喂给目标节点。命中时是 `webEmbed` 形状（`providerId` / `src` /
 *   `title` / 可选 `aspect`），未命中只有 `providerId: 'generic'` + 原样 `src`。
 *
 * `src` 的**合法性**不在这里判（`safeEmbedSrc` 才是那道闸）：解析层只管「映射成什么」，
 * 放不放行是块定义与出网策略的事，两者混在一起会让「为什么这个链接不落块」无从排查。
 *
 * @param {string} url 用户粘贴的地址
 */
export function resolveEmbed(url) {
  const raw = typeof url === 'string' ? url.trim() : ''
  const rule = findEmbedRule(raw)

  if (!rule) {
    return {
      def: null,
      kind: 'bookmark',
      attrs: { providerId: GENERIC_PROVIDER_ID, src: raw },
    }
  }

  const def = PRESET_BY_ID.get(rule.id) || null
  /** `toSrc` 认不出形态时原样返回（见 presets.js 每条实现的兜底），这里不再二次判空。 */
  const attrs = {
    providerId: rule.id,
    src: rule.toSrc ? rule.toSrc(raw) : raw,
    title: def ? def.label : null,
  }
  if (rule.aspect) attrs.aspect = rule.aspect

  return { def, kind: def ? def.kind : 'iframe', attrs }
}
