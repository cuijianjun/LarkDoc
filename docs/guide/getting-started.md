# 快速开始

## 概述

lark-doc 是一个发布为 npm 包的 LarkDoc 风格文档编辑器（Vue 2.7 + Tiptap 3），提供两种使用方式：

- **命令式入口** `new LarkDoc()`：像 AiEditor 一样用构造函数驱动完整工作台，适合任何宿主（原生页面、Vue2 路由、微前端）。
- **组件式入口** `LarkDocEditor` / `LarkDocWorkspace`：直接把 Vue 组件挂进模板，适合已经在用 Vue 2.7 的项目。

推荐统一使用命令式入口，组件式入口保留为兼容导出。

## 安装

```bash
npm i lark-doc
```

要求：Node 14.21.3 及以上；样式与 KaTeX 字体随包发布，无需额外引入字体文件。

## 最小示例

```ts
import 'lark-doc/style.css'
import { LarkDoc } from 'lark-doc'

const doc = new LarkDoc({
  element: '#editor',              // CSS 选择器或 HTMLElement
  title: '未命名文档',
  content: '<p>hello lark-doc</p>',  // 支持 HTML / Tiptap JSON / DocumentRecord
  placeholder: '输入正文，或输入 / 插入内容',
  theme: 'light',
  readonly: false,
  storage: 'none',                 // 'none' 不写本地草稿；'local' 使用浏览器草稿
  onReady: (payload) => console.log('ready', payload.editor),
  onUpdate: (payload) => console.log('update', payload.html),
  onError: (error) => console.error(error),
})

// 实例方法
doc.getHTML()
doc.setContent('<h1>新内容</h1>')
doc.setReadonly(true)
doc.destroy()
```

::: tip 样式入口
`import 'lark-doc/style.css'`（`exports` 里的 `./style.css`，解析到 `dist/lark-doc.css`）是唯一的公开样式入口，包含正文样式与本地 KaTeX 字体。它只服务于 **CJS（`main`）产物**——只有 lib 构建会抽出 CSS。`umd` / `esm` / `element` 三种产物样式已随 JS 注入 `<style>`，宿主**不需要**再引 CSS（重复引入也无害，只是多一份文本）。
:::

## 在 Vue 2 路由中使用

```vue
<template>
  <div ref="host" class="lark-doc-host" />
</template>

<script>
import { LarkDoc } from 'lark-doc'
import 'lark-doc/style.css'

export default {
  mounted() {
    this.doc = new LarkDoc({ element: this.$refs.host, title: '未命名文档' })
  },
  beforeDestroy() {
    if (this.doc) { this.doc.destroy(); this.doc = null }
  },
}
</script>
```

路由切走时 `beforeDestroy` 会销毁实例，不会有残留定时器或事件监听。

## 下一步

- 查看全部[配置总览](/guide/configuration)与[实例方法](/guide/instance)
- 按[功能配置](/blocks/heading)逐项了解每个内容块
- 需要接入真实 AI、上传或持久化，参考 [View 层接入](/guide/view-integration)
