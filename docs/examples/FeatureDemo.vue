<script setup>
import { computed, ref } from 'vue'
import { withBase } from 'vitepress'
import { demoMarkup, featureDemos, publishedLoader } from './feature-demos.js'

const props = defineProps({ name: { type: String, required: true } })
const demo = computed(() => featureDemos[props.name])
const source = computed(() => demoMarkup(demo.value, publishedLoader))
const preview = computed(() => demoMarkup(demo.value, withBase('/demo/vendor/lark-doc-element.umd.min.js')))
const feedback = ref('')

async function copyCode() {
  try {
    await navigator.clipboard.writeText(source.value)
    feedback.value = '已复制 HTML'
  } catch {
    feedback.value = '请选中下方代码进行复制。'
  }
}
</script>

<template>
  <ol>
    <li v-for="step in demo.steps" :key="step">{{ step }}</li>
  </ol>
  <section class="feature-demo" :aria-label="`${demo.title}代码演示`">
    <ClientOnly>
      <iframe :srcdoc="preview" :title="`${demo.title}运行演示`" :class="{ tall: demo.tall }" />
      <template #fallback>
        <p class="loading" :class="{ tall: demo.tall }" role="status">正在加载编辑器…</p>
      </template>
    </ClientOnly>
    <details>
      <summary>查看完整代码</summary>
      <div class="code-actions">
        <span>保存为 <code>index.html</code>，在联网的浏览器中打开。</span>
        <button type="button" @click="copyCode">复制 HTML</button>
      </div>
      <span class="copy-feedback" role="status">{{ feedback }}</span>
      <pre><code>{{ source }}</code></pre>
    </details>
  </section>
</template>

<style scoped>
.feature-demo {
  margin: 16px 0 28px;
  overflow: hidden;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
}
.feature-demo iframe { display: block; width: 100%; height: 365px; border: 0; background: #fff; }
.feature-demo .loading { box-sizing: border-box; margin: 0; height: 365px; padding: 12px 16px; }
.feature-demo .tall { height: 515px; }
.feature-demo details { border-top: 1px solid var(--vp-c-divider); background: var(--vp-c-bg-soft); }
.feature-demo summary { padding: 12px 16px; min-height: 44px; cursor: pointer; color: var(--vp-c-brand-1); font-weight: 600; }
.feature-demo summary:focus-visible, .feature-demo button:focus-visible { outline: 2px solid var(--vp-c-brand-1); outline-offset: -2px; }
.feature-demo .code-actions { display: flex; align-items: center; flex-wrap: wrap; justify-content: space-between; gap: 8px; padding: 2px 16px; font-size: 14px; }
.feature-demo button { padding: 0 12px; min-height: 44px; color: var(--vp-c-brand-1); border: 1px solid var(--vp-c-divider); border-radius: 6px; }
.feature-demo .copy-feedback { display: block; padding: 0 16px; color: var(--vp-c-text-2); font-size: 14px; }
.feature-demo pre { margin: 12px 0 0; padding: 14px 16px; overflow: auto; max-height: 380px; background: var(--vp-code-block-bg); font-size: 13px; }
.feature-demo pre code { padding: 0; color: var(--vp-c-text-1); background: transparent; }
@media (max-width: 640px) {
  .feature-demo iframe, .feature-demo .loading { height: 415px; }
  .feature-demo .tall { height: 540px; }
}
</style>
