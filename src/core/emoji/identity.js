/** Canonical emoji identities for synchronous document rendering and validation.
 * UI search labels stay in catalog.js; both tables are generated in matching order.
 */
import { EMOJI_IDENTITIES } from './identity-data'

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

// This factory only allocates local records/maps and never mutates generated data.
function createIdentityIndex() {
  const items = []
  const byGlyph = Object.create(null)
  const byName = Object.create(null)
  EMOJI_GROUP_META.forEach((group) => {
    const rows = EMOJI_IDENTITIES[group.key] || []
    rows.forEach(([glyph, name]) => {
      const item = { value: name, glyph, category: group.label }
      items.push(item)
      const key = normalizeEmojiGlyph(glyph)
      if (!byGlyph[key]) byGlyph[key] = item
      if (!byName[name]) byName[name] = item
    })
  })
  return { items, byGlyph, byName }
}

const identityIndex = /*#__PURE__*/ createIdentityIndex()
const emojiIdentityItems = identityIndex.items

function findEmojiIdentityByName(name) {
  const key = normalizeEmojiName(name)
  if (!key) return null
  const item = identityIndex.byName[key]
  if (item) return item
  const legacy = LEGACY_EMOJI_NAMES[key]
  return legacy ? identityIndex.byGlyph[normalizeEmojiGlyph(legacy)] || null : null
}

function findEmojiIdentityByGlyph(glyph) {
  const key = normalizeEmojiGlyph(glyph)
  return key ? identityIndex.byGlyph[key] || null : null
}

function isEmojiGlyph(value) {
  return !!findEmojiIdentityByGlyph(value)
}

export {
  EMOJI_GROUP_META, EMOJI_NAME_MAX, LEGACY_EMOJI_NAMES, emojiIdentityItems,
  normalizeEmojiName, normalizeEmojiGlyph,
  findEmojiIdentityByName, findEmojiIdentityByGlyph, isEmojiGlyph,
}
