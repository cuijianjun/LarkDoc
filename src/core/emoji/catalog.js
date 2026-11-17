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

import {
  EMOJI_GROUP_META, EMOJI_NAME_MAX, LEGACY_EMOJI_NAMES,
  normalizeEmojiName, normalizeEmojiGlyph, isEmojiGlyph,
} from './identity'

// Public UI records retain the original full, synchronous catalog shape.
// Only new local arrays/maps are written; generated identity and label tables stay intact.
function createCatalogIndex() {
  const items = []
  const byGlyph = Object.create(null)
  const byName = Object.create(null)
  EMOJI_GROUP_META.forEach((group) => {
    const rows = EMOJI_DATA[group.key] || []
    rows.forEach((row) => {
      const item = { value: row[2], label: row[1], glyph: row[0], category: group.label }
      items.push(item)
      // 同字形/同名只认第一条：emojibase 的短名偶尔被两个码位共用，以分组靠前者为准。
      if (!byGlyph[normalizeEmojiGlyph(item.glyph)]) byGlyph[normalizeEmojiGlyph(item.glyph)] = item
      if (!byName[item.value]) byName[item.value] = item
    })
  })
  return { items, byGlyph, byName }
}

const catalogIndex = /*#__PURE__*/ createCatalogIndex()
const emojiItems = catalogIndex.items
const emojiByGlyph = catalogIndex.byGlyph
const emojiByName = catalogIndex.byName

/** 面板分类 tab（按组顺序，不含「最近 / 全部」两个固定项）。 */
const emojiCategories = /*#__PURE__*/ EMOJI_GROUP_META.map((group) => group.label)

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
