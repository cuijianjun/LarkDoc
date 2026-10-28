/**
 * 表情目录查询层（P4-03）：把构建期生成的 `EMOJI_DATA` 包成「面板 / schema / 渲染」共用的接口。
 *
 * 这里只做三件事，数据本身在 `data.js`（`node scripts/build-emoji-catalog.js` 生成）：
 *   1. **名字归一化**（02 §16 ⑤④：去首尾冒号 + 小写 + 截 64）—— 全库单一出处，
 *      schema 写属性、命令插入、catalog 查表都必须走它，否则会出现「插入能显示、
 *      存一次盘再打开变成 `:smile:` 纯文本」这类只在一侧归一化的经典 bug；
 *   2. **名字 ⇄ 字形**双向查表（面板按 glyph 写回 name，历史文档按 name 还原字形）；
 *   3. **高亮块图标白名单**（`isEmojiGlyph`）—— 12 个硬编码字形扩到全量后，
 *      `blocks/callout.js` 与 `documentOperations.js` 两处校验共用它。
 *
 * 运行时零请求、零第三方依赖（`check:offline` 要求）。
 */
import { EMOJI_DATA } from './data'

// 顺序 = 面板 tab 顺序，必须与 `data.js` 的键顺序、`build-emoji-catalog.js` 的 `GROUPS` 一致。
// 组名取自 emojibase 的 `zh/messages.json`，其中 4 个原文是繁体（食物飲料 / 旅遊地點 / …），
// 这里统一成简体 —— tab 上简体繁体混排会显得像没做完。
const EMOJI_GROUP_META = [
  { key: 'smileys', label: '笑脸' },
  { key: 'people', label: '人体' },
  { key: 'nature', label: '野生动物' },
  { key: 'food', label: '食物饮料' },
  { key: 'travel', label: '旅游地点' },
  { key: 'activity', label: '个人活动' },
  { key: 'objects', label: '物件' },
  { key: 'symbols', label: '人的符号' },
  { key: 'flags', label: '旗帜' },
]

const EMOJI_NAME_MAX = 64
// VS16（U+FE0F）只是「按 emoji 方式渲染」的修饰符，不带它同样是一个图形字符。
// 历史数据两种都存过（`❤️` 带、`✅` 不带），所以比对时统一剥掉，**写入时保留原样**。
const VARIATION_SELECTOR = /\uFE0F/g

// 0.11 及以前落库的 `name` 用的是旧的 11 个短名。其中 4 个已不是 emojibase 的主名
// （📌=`pushpin`、✅=`white_check_mark`、💬=`speech_balloon`、🎯=`dart`），
// 不兜住就会把老文档里的图标渲染成 `:pin:` 这样的纯文本。**只读兼容，不进面板**。
const LEGACY_EMOJI_NAMES = { pin: '📌', check: '✅', comment: '💬', target: '🎯' }

/** 归一化表情名字：去首尾冒号 + 小写 + 截 64 字符。非字符串返回空串。 */
function normalizeEmojiName(value) {
  if (typeof value !== 'string') return ''
  return value.replace(/^:+|:+$/g, '').trim().toLowerCase().slice(0, EMOJI_NAME_MAX)
}

/** 只用于比对的字形归一化（剥掉 VS16）。 */
function normalizeEmojiGlyph(value) {
  return typeof value === 'string' ? value.replace(VARIATION_SELECTOR, '') : ''
}

// 面板要的扁平列表：`{ value(英文主名), label(中文名), glyph, category(组中文名) }`，
// 唯一的消费方是高亮块的 emoji 面板（02 §16：飞书没有别的表情入口）。
const emojiItems = []
const emojiByGlyph = Object.create(null)
const emojiByName = Object.create(null)

EMOJI_GROUP_META.forEach((group) => {
  const rows = EMOJI_DATA[group.key] || []
  rows.forEach((row) => {
    const item = { value: row[2], label: row[1], glyph: row[0], category: group.label }
    emojiItems.push(item)
    // 同字形/同名只认第一条：emojibase 的短名偶尔被两个码位共用，以分组靠前者为准。
    if (!emojiByGlyph[normalizeEmojiGlyph(item.glyph)]) emojiByGlyph[normalizeEmojiGlyph(item.glyph)] = item
    if (!emojiByName[item.value]) emojiByName[item.value] = item
  })
})

/** 面板分类 tab（按组顺序，不含「最近 / 全部」两个固定项）。 */
const emojiCategories = EMOJI_GROUP_META.map((group) => group.label)

/** 按名字取条目；查不到返回 null（调用方决定回退文案）。 */
function findEmojiByName(name) {
  const key = normalizeEmojiName(name)
  if (!key) return null
  const item = emojiByName[key]
  if (item) return item
  const legacy = LEGACY_EMOJI_NAMES[key]
  return legacy ? emojiByGlyph[normalizeEmojiGlyph(legacy)] || null : null
}

/** 按字形取条目；查不到返回 null。 */
function findEmojiByGlyph(glyph) {
  const key = normalizeEmojiGlyph(glyph)
  return key ? emojiByGlyph[key] || null : null
}

/** 字形是否是一个已知表情 —— 高亮块图标的唯一白名单判断（12 个硬编码已扩到全量）。 */
function isEmojiGlyph(value) {
  return !!findEmojiByGlyph(value)
}

/**
 * 面板搜索：中文名 / 英文主名 / 字形三路包含匹配（02 §16 ④ 要求「英文名或中文都能过滤」）。
 * 空关键词返回该分类全量；`category` 省略 = 不限分类（「全部」）。
 * 1898 条线性过滤对单次输入来说是微秒级，不需要预建索引。
 */
function searchEmoji(query, category) {
  const keyword = String(query === undefined || query === null ? '' : query).trim().toLowerCase()
  return emojiItems.filter((item) => {
    if (category && item.category !== category) return false
    if (!keyword) return true
    return item.label.indexOf(keyword) !== -1
      || item.value.indexOf(keyword) !== -1
      || item.glyph.indexOf(keyword) !== -1
  })
}

/** 字形属于哪个分组（中文组名）；未知字形返回空串。 */
function emojiGroupOf(value) {
  const item = findEmojiByGlyph(value)
  return item ? item.category : ''
}

export {
  EMOJI_GROUP_META,
  EMOJI_NAME_MAX,
  emojiItems,
  emojiCategories,
  normalizeEmojiName,
  normalizeEmojiGlyph,
  findEmojiByName,
  findEmojiByGlyph,
  isEmojiGlyph,
  searchEmoji,
  emojiGroupOf,
}
