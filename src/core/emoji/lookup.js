/** Complete synchronous schema whitelist; picker labels live in the lazy catalog. */
import { EMOJI_LOOKUP } from './lookup-data'

export const normalizeEmojiName = value => typeof value === 'string' ? value.replace(/^:+|:+$/g, '').trim().toLowerCase().slice(0, 64) : ''
const normalizeGlyph = value => typeof value === 'string' ? value.replace(/\uFE0F/g, '') : ''
const byName = Object.create(null)
const byGlyph = Object.create(null)
export const emojiGlyphs = []
EMOJI_LOOKUP.split('\n').forEach(row => {
  const split = row.indexOf(' ')
  const item = { glyph: row.slice(0, split), value: row.slice(split + 1) }
  emojiGlyphs.push(item.glyph)
  if (!byName[item.value]) byName[item.value] = item
  if (!byGlyph[normalizeGlyph(item.glyph)]) byGlyph[normalizeGlyph(item.glyph)] = item
})
const legacyNames = { pin: '📌', check: '✅', comment: '💬', target: '🎯' }
export const findEmojiByGlyph = value => byGlyph[normalizeGlyph(value)] || null
export const findEmojiByName = value => {
  const name = normalizeEmojiName(value)
  return byName[name] || findEmojiByGlyph(legacyNames[name])
}
export const isEmojiGlyph = value => !!findEmojiByGlyph(value)
