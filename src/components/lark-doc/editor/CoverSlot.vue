<template>
  <!-- 封面槽（04 §1.4 / §1.4.1）。
       为什么这个组件**不放在** `LarkDocOverlays.vue`：它是文档流里的元素（在纸张之上、
       标题之前），不是浮层。浮层层里的都是 `position: fixed`，塞进去会脱离流、飘到页尾。
       真正浮起的只有 `CoverPanel.vue`（162×126 面板 / 542×522 图库），那个在浮层层。

       两种形态：
         - 空态：槽高 **0**（`.doc-cover-toolbar` 820×0），hover 主区才浮出「添加封面」84×28；
         - 已添加：槽 **高 283**、`overflow:hidden`，hover 时右下角浮出「编辑封面」66×30
           （容器 `opacity:0`、按钮实体 —— §1.4.1 红字，别把 bg/radius 加到容器上）。 -->
  <div
    class="lark-doc-cover-slot"
    :class="{ 'is-empty': !ed.coverExists }"
  >
    <div
      v-if="ed.coverExists"
      class="lark-doc-cover-wrapper"
      :style="ed.coverSlotStyle"
    >
      <!-- 图容器：比槽高，靠 clip 裁中间段（§1.4.1「图比槽高」口径）。
           拖拽定位态下整块可拖 —— 竖向位移换算成 `background-position-y`。 -->
      <div
        class="lark-doc-cover-image-wrapper"
        :class="{ 'is-dragging': ed.coverRepositioning }"
        @pointerdown="onDragStart"
        @pointermove="onDragMove"
        @pointerup="onDragEnd"
        @pointercancel="onDragEnd"
      />
      <div class="lark-doc-cover-toolbar">
        <template v-if="ed.coverRepositioning">
          <button
            type="button"
            class="lark-doc-cover-btn is-plain"
            aria-label="取消调整封面位置"
            @click="ed.cancelCoverReposition"
          >
            取消
          </button><button
            type="button"
            class="lark-doc-cover-btn"
            aria-label="确认封面位置"
            @click="ed.confirmCoverReposition"
          >
            确认
          </button>
        </template>
        <button
          v-else
          type="button"
          class="lark-doc-cover-btn"
          aria-label="编辑封面"
          aria-haspopup="menu"
          :aria-expanded="ed.coverPanelOpen ? 'true' : 'false'"
          @click="ed.openCoverPanel"
        >
          编辑封面
        </button>
      </div>
    </div>
    <button
      v-else
      type="button"
      class="lark-doc-cover-entry"
      aria-label="添加封面"
      @click="ed.addCover"
    >
      添加封面
    </button>
  </div>
</template>

<script>
// CoverSlot —— 封面槽（文档流内）。
//
// 唯一的本地状态是拖拽会话 `_coverDrag`，它只在「调整图片位置」期间存在、不进 Vue 响应式
// 体系也行，但挂在实例上比模块级变量安全（多实例互不干扰）。
export default {
  name: 'LarkDocCoverSlot',
  props: {
    ed: { type: Object, required: true },
  },
  methods: {
    onDragStart(event) {
      if (!this.ed.coverRepositioning) return
      // 竖向拖 1px ≈ offset 0.2%：槽高 283、图高 655，全行程 ≈ (655-283)/655 ≈ 57%，
      // 取整换算后一次拖拽不会「跳到底」。
      this._coverDrag = { y: event.clientY, offset: this.ed.coverDraftOffset }
    },
    onDragMove(event) {
      const drag = this._coverDrag
      if (!drag || !this.ed.coverRepositioning) return
      this.ed.setCoverDraftOffset(drag.offset + (event.clientY - drag.y) * -0.2)
    },
    onDragEnd() {
      this._coverDrag = null
    },
  },
}
</script>
