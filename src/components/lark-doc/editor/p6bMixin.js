/**
 * p6bMixin —— P6b 五条线的**聚合挂载点**（评论 / 历史版本 / 分享 / 导出 / 三态统一）。
 *
 * 为什么不是五条线各自在 `LarkDocEditor.vue` 里 import：
 *   P0-03 的门禁要求门面组件持续瘦身（`scripts/check-architecture.js` 断言
 *   `LarkDocEditor.vue < 700 行`）。五条线各自的 mixin 都已经在自己的分支里交付完成，
 *   让它们各占一行 import 会直接把门面顶到 700 以上 —— 而它们本来就是同一批交付、
 *   同一层语义（「文档级能力」，不是编辑器内核）。所以这里只做聚合，门面只多一行。
 *
 * 为什么把 `components` 也写在这：
 *   同样的行数账。五个面板收进 `LarkDocOverlays.vue` 后，门面只剩一个模板位；
 *   注册也跟着聚合走，门面就不需要为它再开一行 import。Vue 2 的 `mergeOptions`
 *   对 `components` 走 `mergeAssets`（原型链合并），mixin 里注册的组件在宿主的
 *   模板里可以直接用 —— 与 `mixins` 自身的合并是同一套机制。
 *
 * ⚠️ 合并顺序（Vue 2 语义，改这个文件的顺序前先想清楚）：
 *   - `methods` / `computed` / `data`：宿主自己的同名键**覆盖** mixin 的。
 *     所以 `readingModeMixin` 的 `writable()` 要生效，宿主那份必须删掉
 *     （已在接线时删除；`LarkDocEditor.vue` 现在没有自己的 `writable`）。
 *   - 生命周期钩子：`mixin 先于宿主`执行，两边都会跑，不会互相覆盖。
 *   - 数组里靠后的 mixin，其 `methods` 覆盖靠前的（同层后写胜）。
 */
import commentsMixin from './commentsMixin'
import versioningMixin from './versioningMixin'
import shareMixin from './shareMixin'
import exportMixin from './exportMixin'
// 三态统一放最后：它的 `writable()` / `interactionMode` 是另四条线的判据上游
// （「能不能评论」「能不能另存版本」最终都落到 `canEditContent(interactionMode)`），
// 靠后放才能在有同名键时压住前面的旧口径。
import readingModeMixin from './readingModeMixin'
import LarkDocOverlays from './LarkDocOverlays.vue'

export default {
  mixins: [commentsMixin, versioningMixin, shareMixin, exportMixin, readingModeMixin],
  components: { LarkDocOverlays },
}
