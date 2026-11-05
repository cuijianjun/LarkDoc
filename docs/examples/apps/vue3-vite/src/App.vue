<template>
  <main>
    <div class="status">
      <strong>Vue {{ version }} + Vite</strong>
      <span>正文更新：{{ updates }}</span>
      <span role="status">图片：{{ uploadStatus }}</span>
      <button :disabled="!ready" @click="readJSON">读取 JSON</button>
    </div>
    <div ref="host" />
    <pre v-if="output">{{ output }}</pre>
  </main>
</template>

<script setup>
import { ref, version, onMounted, onBeforeUnmount } from 'vue'
import { LarkDoc } from 'lark-doc'
import 'lark-doc/style.css'

const host = ref(null)
const ready = ref(false)
const updates = ref(0)
const uploadStatus = ref('等待选图（本地 base64）')
const output = ref('')
let doc

onMounted(() => {
  doc = new LarkDoc({
    element: host.value,
    title: 'Vue3 + Vite',
    content: '<p>开始编辑，也可以选图、粘贴或拖入图片。</p>',
    storage: 'none',
    uploader: {
      onStart: event => { uploadStatus.value = `上传中（${event.mode}）` },
      onSuccess: () => { uploadStatus.value = '取得图片结果' },
      onError: event => { uploadStatus.value = event.error.message },
      onSettled: event => { uploadStatus.value = `${event.status}（${event.mode}）` },
    },
    onReady: () => { ready.value = true },
    onUpdate: () => { updates.value += 1 },
  })
})
onBeforeUnmount(() => { doc.destroy() })
function readJSON() { output.value = JSON.stringify({ title: doc.getTitle(), content: doc.getJSON() }, null, 2) }
</script>

<style>
body { margin: 0; font: 14px system-ui, sans-serif; color: #243042; background: #f6f8fc; } main { padding: 16px; } button { padding: 7px 12px; cursor: pointer; } pre { max-height: 220px; overflow: auto; white-space: pre-wrap; } .status { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin-bottom: 12px; }
</style>
