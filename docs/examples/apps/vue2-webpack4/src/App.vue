<template>
  <main>
    <div class="status">
      <strong>Vue {{ vueVersion }} + Webpack4</strong>
      <span>正文更新：{{ updates }}</span>
      <span role="status">图片：{{ uploadStatus }}</span>
      <button :disabled="!ready" @click="readJSON">读取 JSON</button>
    </div>
    <div ref="host" />
    <pre v-if="output">{{ output }}</pre>
  </main>
</template>

<script>
import Vue from 'vue'
import { LarkDoc } from 'lark-doc'
import 'lark-doc/dist/lark-doc.css'

export default {
  data: () => ({ vueVersion: Vue.version, ready: false, updates: 0, uploadStatus: '等待选图（本地 base64）', output: '' }),
  mounted() {
    // 编辑器使用普通实例字段，避免进入 Vue2 的响应式系统。
    this.doc = new LarkDoc({
      element: this.$refs.host,
      title: 'Vue2 + Webpack4',
      content: '<p>开始编辑，也可以选图、粘贴或拖入图片。</p>',
      storage: 'none',
      uploader: {
        onStart: event => { this.uploadStatus = `上传中（${event.mode}）` },
        onSuccess: () => { this.uploadStatus = '取得图片结果' },
        onError: event => { this.uploadStatus = event.error.message },
        onSettled: event => { this.uploadStatus = `${event.status}（${event.mode}）` },
      },
      onReady: () => { this.ready = true },
      onUpdate: () => { this.updates += 1 },
    })
  },
  beforeDestroy() {
    this.doc.destroy()
    this.doc = null
  },
  methods: {
    readJSON() { this.output = JSON.stringify({ title: this.doc.getTitle(), content: this.doc.getJSON() }, null, 2) },
  },
}
</script>

<style>
body { margin: 0; font: 14px system-ui, sans-serif; color: #243042; background: #f6f8fc; } main { padding: 16px; } button { padding: 7px 12px; cursor: pointer; } pre { max-height: 220px; overflow: auto; white-space: pre-wrap; } .status { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin-bottom: 12px; }
</style>
