<!--
  内嵌网页「粘贴链接」浮层（P3-07 批 A）。

  🔴 与 LinkDialog / HelpDialog 的四处**故意不同**，改之前先读 requirements/04-浮层与弹窗.md §4.3：
  1. 宽 540 / 高 164 / 圆角 8 / z-index 99（04 §4.3 ④ 实测），**不套** .lark-doc-dialog-backdrop
     —— 它不遮罩、不居中弹，是贴着插入位置浮出来的小面板（落点由 ed.embedDialogPos 给）。
  2. **不绑 @keydown.esc**：04 §4.3 ③ 实测「Esc ×1、×2 都关不掉」，只认「点外部」和「点 ×」。
  3. 确认时**不校验、不报错、不 toast**：填空 / 填非法只是不落块、浮层留着，唯一反馈是「确认」
     按钮底色由 rgb(51,109,244) 变 rgb(80,131,251)（04 §4.3 ⑤ + §2558「错误态没有文案提示，
     只有按钮色变，别优化成红字报错」）。
  4. 外壳是普通 div，不是 role=dialog + aria-modal —— 非模态浮层，读屏不该按模态处理。
-->
<template>
  <div
    v-if="ed.embedDialog"
    class="lark-doc-embed-dialog"
    role="dialog"
    :aria-label="ed.embedDialogTitle"
    :style="ed.embedDialogPos"
  >
    <button
      type="button"
      class="lark-doc-embed-dialog-close"
      aria-label="关闭内嵌网页链接"
      @click="ed.closeEmbedDialog"
    >
      <lark-doc-icon
        :size="14"
        name="close"
      />
    </button>
    <header>
      <strong>{{ ed.embedDialogTitle }}</strong>
    </header>
    <input
      class="lark-doc-embed-dialog-input"
      type="text"
      aria-label="内嵌网页链接"
      :value="ed.embedValue"
      :placeholder="ed.embedDialogPlaceholder"
      @input="ed.setEmbedValue($event.target.value)"
      @keydown.enter.prevent="ed.applyEmbedDialog"
    >
    <footer>
      <button
        type="button"
        class="lark-doc-embed-dialog-help"
        @click="ed.openEmbedHelp('howto')"
      >
        如何获取链接
      </button>
      <div class="lark-doc-embed-dialog-actions">
        <button
          type="button"
          class="lark-doc-embed-dialog-sample"
          @click="ed.openEmbedHelp('example')"
        >
          查看示例
        </button>
        <button
          type="button"
          class="lark-doc-embed-dialog-confirm"
          :class="{ 'is-rejected': ed.embedDialogRejected }"
          @click="ed.applyEmbedDialog"
        >
          确认
        </button>
      </div>
    </footer>
  </div>
</template>

<script>
import LarkDocIcon from '../../LarkDocIcon.vue'

export default {
  name: 'EmbedLinkDialog',
  components: { LarkDocIcon },
  props: {
    ed: { type: Object, required: true },
  },
}
</script>
