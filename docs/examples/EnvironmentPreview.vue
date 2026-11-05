<script setup>
import { computed } from 'vue'
import { withBase } from 'vitepress'

const props = defineProps({
  env: { type: String, required: true },
  title: { type: String, required: true },
})

const source = computed(() => withBase(`/examples-runtime/${props.env}/index.html`))
</script>

<template>
  <section class="environment-preview" :aria-label="`${title}运行预览`">
    <div class="preview-heading">
      <span>运行预览</span>
      <a :href="source" target="_blank" rel="noopener noreferrer">新窗口打开 ↗</a>
    </div>
    <iframe :src="source" :title="`${title}运行预览`" loading="lazy" />
  </section>
</template>

<style scoped>
.environment-preview {
  margin: 24px 0;
  overflow: hidden;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
}

.preview-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 16px;
  color: var(--vp-c-text-1);
  background: var(--vp-c-bg-soft);
  border-bottom: 1px solid var(--vp-c-divider);
  font-size: 14px;
}

.preview-heading a {
  color: var(--vp-c-brand-1);
  font-weight: 600;
}

.environment-preview iframe {
  display: block;
  width: 100%;
  height: 600px;
  border: 0;
  background: #fff;
}

@media (max-width: 640px) {
  .environment-preview iframe {
    height: 540px;
  }
}
</style>
