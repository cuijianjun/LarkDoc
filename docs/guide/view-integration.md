# View 层接入

lark-doc 与宿主的边界是显式的：编辑器只负责文档交互，**数据存哪里、AI 用什么模型、图片传到哪**都由宿主通过 Provider 契约注入。本页覆盖三种接入形态：原生页面、Vue2 组件、以及持久化 / 协作扩展点。

## 三种接入形态

### 原生页面

无构建链时用 `dist/lark-doc.umd.min.js`：Vue 已内联，**不需要先挂全局 `Vue`**，样式也随 JS 注入。全局暴露的是**命名空间对象** `window['lark-doc']`（含 `LarkDoc` / `createDocumentSession` / `TOOLBAR_GROUPS` 等具名导出，以及 `default` 指向 `LarkDoc` 类）：

```html
<script src="./vendor/lark-doc.umd.min.js"></script>
<div id="editor"></div>
<script>
  const { LarkDoc } = window['lark-doc']
  const doc = new LarkDoc({ element: '#editor', title: '未命名文档' })
</script>
```

::: warning UMD 档不随 npm 发布
0.13 起 npm 包里只有 ESM / CJS / element 三份产物（`unpkg` / `jsdelivr` 指向 **element**）。
需要 JS API 的 `<script>` 直挂时，从本仓库 `npm run build:umd` 的产物或在线 Demo 的
`docs/public/demo/vendor/` 取 `lark-doc.umd.min.js` —— **必须连按需 chunk 一起拷到同目录**
（`lark-doc.umd.min.mermaid.js` 等），否则图表渲染取不到渲染器。
:::

走 CDN 且只需要 `new LarkDoc()` 之外的能力时，用 element 产物 + `<lark-doc>` 标签更省事：

```html
<script src="https://unpkg.com/lark-doc/dist/lark-doc-element.umd.min.js"></script>
<lark-doc id="doc" title="未命名文档" theme="light"></lark-doc>
```

### Vue2 路由薄壳（本仓库 Demo 的接法）

```vue
<template>
  <div ref="host" class="lark-doc-host" />
</template>

<script>
import { LarkDoc } from 'lark-doc'
import 'lark-doc/style.css'

export default {
  name: 'LarkDocView',
  mounted() {
    this.doc = new LarkDoc({
      element: this.$refs.host,
      title: '未命名文档',
      storage: 'none',   // 只读视图不写本地草稿（默认 'local' 会自动存草稿，这里显式关掉）
      onError: (error) => console.error('[lark-doc]', error),
    })
  },
  beforeDestroy() {
    if (this.doc) { this.doc.destroy(); this.doc = null }
  },
}
</script>
```

### 持久化 Provider（草稿 / 快照落库）

```ts
import { LarkDoc } from 'lark-doc'

const doc = new LarkDoc({
  element: '#editor',
  persistence: {
    // 适配器需要实现 load / save / snapshots / snapshot / restore
    load: async () => db.get('draft-1'),
    save: async (payload) => db.put('draft-1', payload),
    snapshots: async () => db.listSnapshots(),
    snapshot: async (snap) => db.addSnapshot(snap),
    restore: async (id) => db.getSnapshot(id),
  },
})
```

### 协作 Provider（Yjs / 自定义后端）

```ts
import { createDocumentSession } from 'lark-doc'

// 协作 Provider 只暴露最小边界：connect(options) / disconnect(options)。
// 核心包不绑定 Yjs / Hocuspocus / 具体 WebSocket 地址，传输细节由宿主在
// connect 里自建。user / authorization 走 session，而非 provider 字段。
const collaboration = {
  connect: async (options) => { /* 建立自己的传输通道 */ },
  disconnect: async (options) => { /* 释放连接 */ },
}
const authorization = {
  async getCapabilities() { return { canEdit: true } }, // 可选，缺省全放行
}

const session = createDocumentSession({
  documentId: 'doc-1',
  user: { id: 'u-1', name: '张三', color: '#3370ff' },
  authorization,
  collaboration,
})

const doc = new LarkDoc({ element: '#editor', session })
```

## 形态对照与权限

| 接入形态 | 说明 |
| --- | --- |
| 原生页面 | UMD 产物（Vue 内联、样式随 JS 注入）+ 同目录按需 chunk；适合无构建链的宿主。 |
| Vue2 薄壳 | `mounted` 创建、`beforeDestroy` 销毁；dev 用 alias 指向包源码，生产走 dist，两条路径都验证。 |
| 组件式 | `LarkDocEditor`（纯编辑器）与 `LarkDocWorkspace`（完整工作台）仍是具名导出，老宿主不受影响。 |
| 持久化 Provider | 实现即插即用（方法名 `load/save/snapshots/snapshot/restore`）；缺省为浏览器 localStorage 草稿。 |
| 协作 Provider | 只暴露 `connect(options)/disconnect(options)` 最小边界；不传不建连接。评论、版本、授权同理，对应 providers/comments、versioning、authorization。 |

### 会话与权限

所有写操作走 `session.can('canEdit')` 判权，拒绝时在 Session 层抛错：

```ts
import { createDocumentSession } from 'lark-doc'

const session = createDocumentSession({ documentId: 'doc-1', user, authorization })
new LarkDoc({ element: '#editor', session })
```

::: tip 按需裁剪
只要编辑器不要工作台：`new LarkDoc({ element })` 加 `features: { templates: false, importExport: false, persistence: false }`，标题栏、模板、快照入口全部隐藏。
:::
