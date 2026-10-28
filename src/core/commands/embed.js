/**
 * 内嵌网页组命令（P3-07 接线）：15 项 = `EMBED_MENU_ITEMS` 的派生，别手写第二份。
 *
 * 位置与数量：03 §1390 的 72 项斜杠命令核对里「内嵌网页 15」就是本组，它排在第 12 类
 * （`COMMAND_ORDER` 里挂在 `ai` 之后，`CommandMenu.categories` 按首次出现顺序出组标题，
 * 所以组标题自然落到最后一位）。
 *
 * 🔴 **`plus: false` 是有意的**：`+` 菜单那 55 项清单里，同类内容只占**一条**
 * `third content blocks`（03 §1185），不是 15 条。`filterCommands` 的
 * `kind !== 'plus' || item.plus !== false` 就是那道闸——别为了「顺手让 + 菜单也能插」
 * 把这个字段去掉，那会让 + 菜单凭空多出 15 行。
 *
 * 🔴 **点击行为是「开浮层」，不是二级面板**（03 §1849 batch589 更正）：
 * 15 项都没有 `item-arrow`（`A1_hit.arrow: false`），所以这里**不给** `submenu` /
 * `submenuType`。`CommandMenu.vue` 的点击分支对无 `submenu` 的项直接
 * `$emit('choose', item)` → `executeCommand(id)` → 打开 540×164 的「粘贴链接」浮层
 * （04 §4.3 ④）。给它们加 `submenu` 会让它们变成右侧面板，与实测不符。
 *
 * 落哪个块不在这里决定：URL 交给 `resolveEmbed`（`core/embed/resolve.js`），
 * 命中 preset 落 `webEmbed`、未命中落 `bookmark`。04 §4.3 ⑤.1 W1 已推翻「域名白名单」
 * 的旧口径——任意 host 都能落块，这里因此没有任何 `allow` / `deny`。
 */
import { EMBED_MENU_ITEMS } from '../embed/presets'

/**
 * 菜单图标字：`EMBED_MENU_ITEMS` 只管文案（03 §内嵌网页），不带图标字段。
 * 15 项对位取值，中文取首字、英文取两字母缩写，避免 15 个一样的点（`·`）。
 */
const GLYPHS = ['抖', '哔', '优', '爱', '即', 'Fi', '墨', 'Ca', '码', 'Cp', '问', '金', 'At', '百', '高']

export const embedCommands = EMBED_MENU_ITEMS.map(({ id, label }, index) => ({
  id,
  label,
  category: '内嵌网页',
  plus: false,
  glyph: GLYPHS[index] || '·',
  tone: 'blue',
  // 搜索按 `${label} ${id}` 命中（id 本身就是拼音/英文名），不另造拼音表——
  // 两份清单一定会漂移，而 label 改一次就得同步改一次拼音。
  keywords: '',
  group: 'embed',
  tier: 'skeleton',
}))
