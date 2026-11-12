# LarkDoc 0.14.7 内网 Vue2 / Vue3 操作文档

本文对应本次生成的自包含内网包 `0.14.7-intranet.1`。两个 ZIP 都包含 SDK、对应最小 demo、锁文件和校验清单；安装时不访问公网 npm。

## 交付文件

本机交付目录：`/tmp/larkdoc-intranet-0.14.7-windows/`。

| 文件 | SHA256 | 用途 |
| --- | --- | --- |
| `lark-doc-vue2-webpack4-0.14.7-intranet.1-windows-x64.zip` | `69546113305d7609e05d1a869c2ba53c1bd726640b70304bfb768c27c6debe75` | Vue2 + Webpack4 + npm |
| `lark-doc-vue3-0.14.7-intranet.1-windows-x64.zip` | `917615886e81393d4d704d7ef819e0e59b14edf6a6bb0dc7811c2bb73c749a39` | Vue3 + Vite + pnpm 9/10 |

两个 ZIP 内的 SDK 文件名均为 `vendor/lark-doc-0.14.7-intranet.1.tgz`，SDK SHA256 为：

```text
4956ba6236568d9e65d5a6b3a591f1a36a41c8caa9652aaf31169fcc250159a7
```

交付前先校验顶层清单：

```bash
cd /d/larkdoc-delivery
sha256sum -c SHA256SUMS-0.14.7-intranet.1.txt
```

解压任一 ZIP 后，再在包根目录执行：

```bash
sha256sum -c SHA256SUMS.txt
```

## Vue2 + Webpack4

在 Git Bash 中进入已有 Vue2 应用，复制 SDK 并离线安装：

```bash
cd "/d/work/your-vue2-app"
mkdir -p vendor
cp "/d/larkdoc-vue2/vendor/lark-doc-0.14.7-intranet.1.tgz" vendor/
npm install "lark-doc@file:./vendor/lark-doc-0.14.7-intranet.1.tgz" \
  --save-exact --offline --no-audit --no-fund
```

组件中使用普通实例字段，不放进 Vue 响应式对象：

```js
import { LarkDoc } from 'lark-doc'
import 'lark-doc/dist/lark-doc.css'

export default {
  data: () => ({ doc: null }),
  mounted() {
    this.doc = new LarkDoc({
      element: this.$refs.editor,
      title: '内网文档',
      content: '<p>开始编辑</p>',
      storage: 'none',
    })
  },
  beforeDestroy() {
    this.doc?.destroy()
    this.doc = null
  },
}
```

模板中提供 `<div ref="editor" />`。接入后构建：

```bash
npm run build
```

## Vue3 + Vite

在 Git Bash 中进入已有 Vue3 应用，复制 SDK 并使用 pnpm 离线安装：

```bash
cd "/d/work/your-vue3-app"
mkdir -p vendor
cp "/d/larkdoc-vue3/vendor/lark-doc-0.14.7-intranet.1.tgz" vendor/
pnpm add "./vendor/lark-doc-0.14.7-intranet.1.tgz" --save-exact --offline
```

组件中使用 `onMounted` / `onBeforeUnmount` 管理实例：

```vue
<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { LarkDoc } from 'lark-doc'
import 'lark-doc/style.css'

const host = ref(null)
let doc

onMounted(() => {
  doc = new LarkDoc({
    element: host.value,
    title: '内网文档',
    content: '<p>开始编辑</p>',
    storage: 'none',
  })
})

onBeforeUnmount(() => {
  doc?.destroy()
  doc = null
})
</script>

<template><div ref="host" /></template>
```

接入后构建：

```bash
pnpm build
```

## 离线验收

分别在两个应用中确认：

1. 页面能显示编辑器并输入中文、emoji 和多段正文。
2. `getJSON()` 能返回正文；销毁组件后没有继续写入或控制台异常。
3. 图片可以显示；配置上传 Provider 时再验证真实接口的成功、失败、取消和重试回调。
4. 表格、图片 hover、四角缩放圆圈、块六点 SVG 句柄和工具栏动作符合当前交互验收。
5. 在物理断网状态下重新执行安装和构建，确认 npm/pnpm 没有访问公网。

本次本机验证结果：Vue2 Webpack4/5、Vue3 Vite、React Vite、HTML CDN、Web Component 六类页面均通过构建和浏览器 smoke；每页均确认编辑器 DOM、JSON 读取和 `pageerror=0`。Windows 真机断网安装尚未在本机执行，应由接收端按本文和包内 README 复验。

## 回滚

保留原应用的 `package-lock.json` 或 `pnpm-lock.yaml`。回滚时恢复原锁文件和 `package.json` 中的 `lark-doc` 版本，再执行对应包管理器的离线安装与构建。不要覆盖旧 SDK ZIP，也不要复用不同版本的 `vendor/lark-doc-*.tgz`。

