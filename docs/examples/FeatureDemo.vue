<script setup>
import { computed, ref } from 'vue'
import { withBase } from 'vitepress'
import { demoSource, featureDemos } from './feature-demos.js'

const props = defineProps({ name: { type: String, required: true } })
const demo = computed(() => featureDemos[props.name])
const runner = computed(() => withBase('/examples/feature-runner.html?demo=' + encodeURIComponent(props.name)))
const showCode = ref(false)
const feedback = ref('')

function toggleCode() {
  showCode.value = !showCode.value
  feedback.value = ''
}

async function copyCode() {
  try {
    await navigator.clipboard.writeText(demoSource(demo.value))
    feedback.value = '已复制 Vue 代码'
  } catch {
    feedback.value = '请选中上方 Vue 代码进行复制。'
  }
}
</script>

<template>
  <ol class="feature-steps">
    <li v-for="step in demo.steps" :key="step">{{ step }}</li>
  </ol>
  <section class="feature-demo" :aria-label="`${demo.title}基础用法演示`">
    <iframe :src="runner + '&embed=1'" :title="`${demo.title}互动演示`" loading="lazy" :class="{ tall: demo.tall }" />
    <div v-show="showCode" :id="'vue-code-' + name" class="demo-code">
      <slot />
    </div>
    <div class="demo-actions">
      <button type="button" :aria-controls="'vue-code-' + name" :aria-expanded="showCode" @click="toggleCode">
        {{ showCode ? '隐藏代码' : '显示代码' }}
      </button>
      <button v-if="showCode" type="button" @click="copyCode">复制代码</button>
      <a :href="runner" target="_blank" rel="noopener" aria-label="在线运行（新窗口）">在线运行<span aria-hidden="true"> ↗</span></a>
    </div>
    <p v-if="showCode && feedback" class="copy-feedback" role="status">{{ feedback }}</p>
  </section>
</template>

<style scoped>
.feature-demo {
  margin: 20px 0 32px;
  overflow: hidden;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
}
.feature-demo iframe { display: block; width: 100%; height: 365px; border: 0; }
.feature-demo .tall { height: 515px; }
.demo-code {
  border-top: 1px solid var(--vp-c-divider);
  background: var(--vp-code-block-bg);
}
.demo-code :deep([class*="language-"]) { margin: 0; border-radius: 0; }
.demo-code :deep(button.copy) { display: none; }
.demo-code :deep(pre) { max-height: 380px; }
.demo-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 10px;
  min-height: 56px;
  padding: 4px 12px;
  border-top: 1px solid var(--vp-c-divider);
}
.demo-actions :is(button, a) {
  display: inline-flex;
  min-height: 44px;
  align-items: center;
  padding: 0 9px;
  border-radius: 6px;
  color: var(--vp-c-text-2);
  font-size: 14px;
}
.demo-actions a { margin-inline-start: auto; color: var(--vp-c-brand-1); font-weight: 600; text-decoration: none; }
.demo-actions :is(button, a):hover { background: var(--vp-c-bg-soft); color: var(--vp-c-brand-1); }
.demo-actions :is(button, a):focus-visible { outline: 2px solid var(--vp-c-brand-1); outline-offset: -2px; }
.feature-demo .copy-feedback { margin: 0; padding: 0 21px 10px; color: var(--vp-c-text-2); font-size: 14px; }
@media (max-width: 640px) {
  .feature-demo iframe { height: 415px; }
  .feature-demo .tall { height: 540px; }
  .demo-actions { padding-inline: 8px; gap: 2px; }
}
</style>

<style>
.feature-guide .VPDoc h1 { letter-spacing: -0.035em; }
.feature-guide .VPDoc h2 { margin: 36px 0 14px; padding-top: 20px; }
.feature-guide .VPDoc .feature-summary {
  margin: 24px 0;
  padding: 0 20px 12px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  background: var(--vp-c-bg-soft);
}
.feature-guide .VPDoc .feature-summary h2 { margin-top: 0; border-top: 0; }
.feature-guide .VPDoc .feature-summary [class^="language-"] { margin-inline: 0; }
.feature-guide .VPDoc .feature-summary > :last-child { margin-bottom: 8px; }
.feature-guide .VPDoc :is(td, th) { vertical-align: top; }
</style>
