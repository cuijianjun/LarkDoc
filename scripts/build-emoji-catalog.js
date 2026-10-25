#!/usr/bin/env node
/**
 * 表情面板数据生成器（P4-03）。
 *
 * 数据源 = `emojibase-data`（devDependency，**只用于生成**，不进运行时依赖）：
 *   - `zh/compact.json`                中文名（`label`）
 *   - `en/shortcodes/emojibase.json`   英文短名（`smile` / `thumbsup` …）
 *
 * 产出 = `src/core/emoji/data.js`（提交入库）。这样做的理由：
 *   1. 运行时零依赖、零网络请求（`check:offline` 要求），也不把 480 KB 的完整
 *      compact.json 打进包；
 *   2. 只留面板要用的三列（字形 / 中文名 / 英文主名）；
 *   3. 分组用「按组切好的 9 个数组」，省掉每条一个 group 字段。
 *
 * 过滤口径（02 §16 只有「可插入的表情」才有意义）：
 *   - `group: 2`（component，9 条肤色/发色片段）**丢弃** —— 不是独立表情；
 *   - 无 `group` 的 26 条（区域指示符 `🇦`）**丢弃** —— 是旗帜的组合上半段，单独插入是乱码；
 *   - 同字形去重（VS16 变体）。
 *
 * 英文主名怎么挑：emojibase 一条常带 2~3 个别名，飞书落库的 `data-name` 是**短名**
 * 且语义清楚（`smile` / `thumbsup`）。规则 = 「字母开头、只含 `[a-z0-9_+-]`、够长（≥4）
 * 的前提下最短」：
 *   - `+1` 这种符号别名被首字母规则排除；
 *   - `yes` / `ok` / `up` 这种三字母别名语义太泛，被 `NAME_MIN` 排除，于是 👍 拿到
 *     `thumbsup` 而不是 `yes`；
 *   - 若一条表情**只有**短别名，退回最短那个（宁可名字泛，也不能整条丢掉）。
 *
 * 用法：node scripts/build-emoji-catalog.js
 */
'use strict'

const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const output = path.join(root, 'src/core/emoji/data.js')

// 顺序即面板 tab 顺序；group 编号沿用 emojibase 的 0-based 分类。
const GROUPS = [
  { key: 'smileys', group: 0 },
  { key: 'people', group: 1 },
  { key: 'nature', group: 3 },
  { key: 'food', group: 4 },
  { key: 'travel', group: 5 },
  { key: 'activity', group: 6 },
  { key: 'objects', group: 7 },
  { key: 'symbols', group: 8 },
  { key: 'flags', group: 9 },
]

const toArray = (value) => {
  if (Array.isArray(value)) return value
  return typeof value === 'string' ? [value] : []
}

const NAME_LIKE = /^[a-z][a-z0-9_+-]*$/
// 三字母以下的别名（`yes` / `ok` / `up` / `no`）语义太泛，不是好主名 —— 具体见头注释。
const NAME_MIN = 4

const pickName = (hexcode, shortcodes) => {
  const aliases = toArray(shortcodes[hexcode])
  const named = aliases.filter((alias) => NAME_LIKE.test(alias))
  const pool = named.length ? named : aliases
  const preferred = pool.filter((alias) => alias.length >= NAME_MIN)
  const sorted = (preferred.length ? preferred : pool).slice()
    .sort((a, b) => (a.length - b.length) || (a < b ? -1 : a > b ? 1 : 0))
  return sorted[0] || ''
}

const main = () => {
  const emojis = require(path.join(root, 'node_modules/emojibase-data/zh/compact.json'))
  const shortcodes = require(path.join(root, 'node_modules/emojibase-data/en/shortcodes/emojibase.json'))

  const seen = new Set()
  const buckets = new Map(GROUPS.map((item) => [item.group, []]))
  let dropped = { component: 0, ungrouped: 0, duplicate: 0, unnamed: 0 }

  emojis.forEach((emoji) => {
    if (emoji.group === 2) { dropped.component += 1; return }
    if (emoji.group === undefined) { dropped.ungrouped += 1; return }
    const bucket = buckets.get(emoji.group)
    if (!bucket) { dropped.ungrouped += 1; return }
    const glyph = String(emoji.unicode || '')
    if (!glyph || seen.has(glyph)) { dropped.duplicate += 1; return }
    const name = pickName(emoji.hexcode, shortcodes)
    if (!name) { dropped.unnamed += 1; return }
    seen.add(glyph)
    bucket.push([glyph, String(emoji.label || name), name])
  })

  const lines = []
  lines.push('/**')
  lines.push(' * 表情面板数据（P4-03）。**自动生成，请勿手改** ——')
  lines.push(' * 重新生成：`node scripts/build-emoji-catalog.js`。')
  lines.push(' *')
  lines.push(' * 每条形如 `[字形, 中文名, 英文主名]`；分组按 `catalog.js` 的 EMOJI_GROUP_META 顺序对齐，')
  lines.push(' * 所以条目不重复带 group 字段。数据源 = emojibase-data 15.3.1（zh/compact + en/shortcodes）。')
  lines.push(' */')
  lines.push('const EMOJI_DATA = {')
  GROUPS.forEach((item, index) => {
    const rows = buckets.get(item.group)
    lines.push(`  ${item.key}: [`)
    rows.forEach((row) => {
      lines.push(`    [${row.map((cell) => JSON.stringify(cell)).join(', ')}],`)
    })
    lines.push(`  ]${index === GROUPS.length - 1 ? '' : ','}`)
  })
  lines.push('}')
  lines.push('')
  lines.push('export { EMOJI_DATA }')
  lines.push('')

  fs.writeFileSync(output, lines.join('\n'), 'utf8')

  const total = GROUPS.reduce((sum, item) => sum + buckets.get(item.group).length, 0)
  console.log(`写入 ${path.relative(root, output)}：${total} 条 / ${GROUPS.length} 组`)
  GROUPS.forEach((item) => console.log(`  ${item.key.padEnd(9)} ${buckets.get(item.group).length}`))
  console.log(`丢弃：component ${dropped.component} / 无分组 ${dropped.ungrouped} / 重复字形 ${dropped.duplicate} / 无名 ${dropped.unnamed}`)
}

main()
