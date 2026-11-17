/** Private callout emoji presentation. Source consumers keep a synchronous full factory. */
import { emojiCategories, findEmojiByName, searchEmoji } from '../../../core/emoji/catalog'

export function createCalloutPresentation() {
  return { computed: {
    // 分类 tab：9 个 emojibase 分组，「最近 / 全部」两个固定项在模板里写死（02 §16 ④）。
    calloutEmojiCategories() { return emojiCategories },
    // 「最近」只在会话内按名字记，跨会话不落盘；搜索对「最近」同样生效，否则切到最近像失灵。
    filteredCalloutEmojiItems() {
      const keyword = String(this.calloutEmojiQuery || '').trim().toLowerCase()
      const hit = (item) => !keyword
        || item.label.toLowerCase().indexOf(keyword) !== -1
        || item.value.indexOf(keyword) !== -1
        || item.glyph.indexOf(keyword) !== -1
      if (this.calloutEmojiCategory === 'recent') {
        return this.calloutEmojiRecent.map((name) => findEmojiByName(name)).filter(Boolean).filter(hit)
      }
      // 空分类 = 「全部」，由 catalog 内部跳过分类裁剪，省一次全量拷贝。
      return searchEmoji(keyword, this.calloutEmojiCategory === 'all' ? '' : this.calloutEmojiCategory)
    },
  } }
}
