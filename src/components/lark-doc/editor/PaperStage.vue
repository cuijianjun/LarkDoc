<template>
  <div
    v-if="ed.slides"
    class="lark-doc-slide-stage"
    aria-label="幻灯片演示"
  >
    <p class="lark-doc-slide-counter">
      {{ ed.slideIndex + 1 }} / {{ ed.slideChapters.length }}
    </p><h1>{{ ed.slideChapters[ed.slideIndex].title }}</h1><p>{{ ed.slideChapters[ed.slideIndex].text }}</p><div>
      <button
        type="button"
        :disabled="ed.slideIndex === 0"
        @click="ed.prevSlide"
      >
        上一页
      </button><button
        type="button"
        :disabled="ed.slideIndex === ed.slideChapters.length - 1"
        @click="ed.nextSlide"
      >
        下一页
      </button><button
        type="button"
        @click="ed.toggleSlides"
      >
        退出演示
      </button>
    </div>
  </div>
</template>

<script>
// PaperStage —— 从 LarkDocEditor.vue 拆出的幻灯片演示舞台（P0-03 段 4/8）。
// 演示模式激活时替换正文纸张视图；纸张容器（.lark-doc-paper）及其子元素留父模板。
export default {
  name: 'LarkDocPaperStage',
  props: {
    ed: { type: Object, required: true },
  },
}
</script>
