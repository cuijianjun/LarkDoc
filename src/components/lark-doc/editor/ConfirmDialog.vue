<template>
  <!-- 通用二次确认框（requirements/04 §4.9）。九层 DOM 链压成三层：
       layer(fixed z1000) > mask(同在 layer 内，同一 z，靠 DOM 顺序在下) > content。
       规格里 wrap / mask 同 z1000 且靠顺序压低，这里用「一个 fixed 容器 + 内部 absolute
       遮罩」表达同一件事 —— 效果等价，还少一层 node（每层 1000 分支都要在
       overlayDismissMixin 里判 contain，层越少越不容易漏）。 -->
  <div
    v-if="ed.confirmOpen"
    class="lark-doc-confirm-layer"
    role="dialog"
    aria-modal="true"
    :aria-label="ed.confirmTitle"
    @keydown.esc.stop.prevent="ed.closeConfirm()"
  >
    <!-- 遮罩 rgba(0,0,0,0.55)：点它 = 取消（§4.9 ⑤ 三通路之一）。 -->
    <div
      class="lark-doc-confirm-mask"
      @mousedown.prevent="ed.closeConfirm()"
    />
    <section class="lark-doc-confirm">
      <div class="lark-doc-confirm-content">
        <!-- header：padding 24；图标 24×24 + gap 16 + 标题 16px/500。 -->
        <header class="lark-doc-confirm-header">
          <span
            class="lark-doc-confirm-icon"
            aria-hidden="true"
          >!</span>
          <h3 class="lark-doc-confirm-title">
            {{ ed.confirmTitle }}
          </h3>
        </header>

        <!-- body 332×44 / 14px/400：左缩进对齐标题（= 24 + 24 + 16），不是 0。 -->
        <div class="lark-doc-confirm-body">
          {{ ed.confirmBody }}
        </div>

        <!-- 「不再提示」勾选行 80×22，仅当调用方给了 extra 才渲染。 -->
        <button
          v-if="ed.confirmExtra"
          type="button"
          class="lark-doc-confirm-extra"
          :aria-pressed="String(ed.confirmExtraChecked)"
          @mousedown.prevent="ed.toggleConfirmExtra()"
        >
          <span
            class="lark-doc-confirm-checkbox"
            :class="{ 'is-on': ed.confirmExtraChecked }"
            aria-hidden="true"
          />
          <span>{{ ed.confirmExtra }}</span>
        </button>

        <!-- footer：padding 0 24px 24px；两钮各 80×32、gap 12、右对齐。 -->
        <footer class="lark-doc-confirm-footer">
          <button
            type="button"
            class="lark-doc-confirm-btn is-plain"
            @mousedown.prevent="ed.closeConfirm()"
          >
            {{ ed.confirmCancelText }}
          </button>
          <button
            type="button"
            class="lark-doc-confirm-btn is-primary"
            @mousedown.prevent="ed.acceptConfirm()"
          >
            {{ ed.confirmPrimaryText }}
          </button>
        </footer>
      </div>
    </section>
  </div>
</template>

<script>
// ConfirmDialog —— §4.9 通用二次确认框。状态机在 `editor/confirmMixin.js`，
// 这里只有结构；挂在 `LarkDocOverlays.vue` 的固定兄弟层里（同样是 fixed 纪律）。
//
// 图标：§4.9 那颗 24×24 `rgb(20,86,240)` 是圆底感叹号。`icons.js` 里没有它，
// 这里用 CSS 伪元素 / 文字「!」直接画 —— 一颗圆底惊叹号不值得为它加一条图标线段，
// 而且它的 24×24 尺寸与颜色都在 CSS 里，加进 icons.js 反而要额外传色。
//
// 行一律 `@mousedown.prevent`：点弹窗不能把焦点让给 body，否则编辑器选区掉了。
export default {
  name: 'LarkDocConfirmDialog',
  props: {
    ed: { type: Object, required: true },
  },
}
</script>
