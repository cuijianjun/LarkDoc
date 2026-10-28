<template>
  <div
    v-if="ed.helpOpen"
    class="lark-doc-drawer-mask"
    @click.self="ed.closeOverlay"
  >
    <!-- 04 §3.5：ud__drawer-right，宽 314、全高、右侧贴合；关闭按钮 24×24。
         04 未规定遮罩 —— 这里用**透明**满屏层承接「点外部关闭」，不画飞书没有的暗色蒙版。 -->
    <aside
      class="lark-doc-drawer lark-doc-help-drawer"
      role="dialog"
      aria-modal="true"
      aria-label="快捷键帮助"
    >
      <header class="lark-doc-drawer-head">
        <strong>快捷键</strong><button
          type="button"
          class="lark-doc-drawer-close"
          aria-label="关闭快捷键帮助"
          @click="ed.closeOverlay"
        >
          <lark-doc-icon
            :size="16"
            name="close"
          />
        </button>
      </header>
      <div class="lark-doc-drawer-body">
        <section
          v-for="group in groups"
          :key="group.title"
          class="lark-doc-kbd-group"
        >
          <h4 class="lark-doc-kbd-title">
            {{ group.title }}
          </h4>
          <div
            v-for="row in group.items"
            :key="row[0]"
            class="lark-doc-kbd-row"
          >
            <span class="lark-doc-kbd-name">{{ row[0] }}</span><kbd class="lark-doc-kbd-key">{{ row[1] }}</kbd>
          </div>
        </section>
      </div>
    </aside>
  </div>
</template>

<script>
import LarkDocIcon from '../../LarkDocIcon.vue'
import { DRAWER_GROUPS } from '../shortcutGroups'

export default {
  name: 'HelpDialog',
  components: { LarkDocIcon },
  props: {
    ed: { type: Object, required: true },
  },
  data() {
    return { groups: DRAWER_GROUPS }
  },
}
</script>
