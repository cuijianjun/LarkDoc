---
layout: false
search: false
title: LarkDoc 功能演示
---

<script setup>
import { shallowRef, ref, onMounted } from 'vue'
import { withBase } from 'vitepress'
import { featureDemos } from './feature-demos.js'
import { loaders } from 'virtual:larkdoc-feature-loaders'

const component = shallowRef()
const demo = shallowRef()
const embedded = ref(true)
const error = ref('')
const version = ref(0)

onMounted(async () => {
  const params = new URLSearchParams(location.search)
  const name = params.get('demo')
  embedded.value = params.get('embed') === '1'
  if (!Object.hasOwn(loaders, name)) {
    error.value = '请从功能文档进入对应的演示。'
    return
  }
  demo.value = featureDemos[name]
  try {
    component.value = (await loaders[name]()).default
  } catch {
    error.value = '演示加载失败，请刷新重试。'
  }
})
</script>

<main class="feature-runner" :class="{ embedded }">
  <header v-if="!embedded && demo">
    <a :href="withBase((demo.route || '/blocks/' + demo.id) + '.html#demo')">返回功能文档</a>
    <h1>{{ demo.title }}</h1>
    <p v-if="component">可以直接操作下方编辑器。重置会清空本次演示改动。</p>
    <button v-if="component" type="button" @click="version++">重置演示</button>
  </header>
  <component v-if="component" :is="component" :key="version" />
  <p v-else class="runner-status" role="status">{{ error || '正在加载演示…' }}</p>
  <a v-if="error && !demo" class="runner-status" :href="withBase('/blocks/')">查看功能总览</a>
</main>

<style scoped>
.feature-runner { max-width: 960px; margin: 24px auto; padding: 0 16px 24px; }
.feature-runner.embedded { max-width: none; margin: 0; padding: 0; }
header { margin-bottom: 16px; padding-bottom: 16px; border-bottom: 1px solid var(--vp-c-divider); }
header h1 { margin: 10px 0; font-size: 28px; font-weight: 650; }
header p { margin-bottom: 12px; color: var(--vp-c-text-2); }
header a, a.runner-status { color: var(--vp-c-brand-1); }
header button { min-height: 44px; padding: 0 12px; border: 1px solid var(--vp-c-divider); border-radius: 8px; }
.runner-status { margin: 12px; }
header a:focus-visible, header button:focus-visible { outline: 2px solid var(--vp-c-brand-1); outline-offset: 2px; }
</style>
