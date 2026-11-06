# View 层接入

lark-doc 与宿主的边界是显式的：编辑器只负责文档交互，**数据存哪里、AI 用什么模型、图片传到哪**都由宿主通过 Provider 契约注入。本页覆盖三种接入形态：原生页面、Vue2 组件、以及持久化 / 协作扩展点。

## 三种接入形态

### 原生页面

Element UMD 使用原生 DOM，不依赖全局 `Vue`；样式随 JS 注入，无需单独引 CSS。将 `dist/` 整目录同位部署后即可使用自定义元素：

```html
<script src="./dist/lark-doc-element.umd.min.js"></script>
<lark-doc id="editor" title="未命名文档"></lark-doc>
<script>
  document.getElementById('editor').addEventListener('lark-doc-ready', (event) => {
    console.log(event.target.getJSON())
  })
</script>
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
      storage: 'none',
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
| 原生页面 | UMD 产物 + 样式链接；适合无构建链的宿主。 |
| Vue2 薄壳 | `mounted` 创建、`beforeDestroy` 销毁；dev 用 alias 指向包源码，生产走 dist，两条路径都验证。 |
| 组件式 | 从 `lark-doc/vue2` 引入 `LarkDocEditor` / `LarkDocWorkspace` options 对象供 Vue2 宿主注册；内部同样挂载原生 DOM，不导入 Vue。 |
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

## 内容与业务保存

宿主负责路由、用户、登录、服务端接口和业务保存；SDK 负责编辑器交互、文档格式与 Provider 边界。默认不会创建 Yjs、WebSocket 或后台协同连接。

正文是 Tiptap JSON，可保存在版本化记录中：

```js
const record = {
  documentId: 'doc-1',
  schemaVersion: 1,
  revisionId: 'revision-42',
  content: { type: 'doc', content: [{ type: 'paragraph' }] },
  title: '示例文档',
  updatedAt: Date.now(),
}
```

`content` 接收文档记录、直接 JSON 或 HTML。Vditor HTML 也可通过 `doc.importVditor(html)` 导入，使用 `doc.getImportReport()` 查看归一化结果。评论、Presence、权限与 AI 临时状态应与正文版本分别保存。

### Provider 方法与接入顺序

| Provider | 最小方法 |
| --- | --- |
| persistence | load/save/snapshots/snapshot/restore |
| collaboration | connect/disconnect |
| versioning | list/createSnapshot/get/restore |
| comments | list/createThread/reply/resolve/reopen |
| authorization | getCapabilities |

先接入服务端保存，再按需添加权限、版本、评论与协同。权限 UI 不代替服务端鉴权；版本恢复应创建新修订，评论锚点使用稳定身份而非临时选区坐标。

显式协同从 `lark-doc/collab` 接入，宿主提供匹配的单例和同格式 ProseMirror/Yjs：ESM 配 ESM，CJS 配 CJS，UMD 不接外部协同扩展。`collabDependencies` 是契约元数据，不是 npm 安装约束。当前验证使用 Node22、Yjs13.6.33、Hocuspocus Provider4.7.1 与 Tiptap 协同扩展3.32.0，不能据此推定任意旧版本兼容；Node14 普通编辑契约不扩展为 Node14 协同承诺。详细配置见[协同接入](./collaboration.md)与[服务端契约](./collab-server.md)。

## 更新上传配置

初始化式服务器上传和完整回调已放在[六环境示例](../examples/index.md)。运行时更换上传配置可以原位更新，保留正文、标题和撤销历史：

```js
doc.setUploader(nextUploader)

// Web Component 通过 property 传递对象和函数。
el.options = { ...el.options, uploader: nextUploader }
```

配置了 HTTP 后，失败不会自动改为 base64。上传成功表示取得合法图片结果；正文变化和应用服务端保存成功应分别确认。参数和回调时序见[上传器参考](../blocks/uploader.md)。

## 接入后检查

1. 编辑内容，确认更新事件能读到 JSON；切换页面时销毁编辑器。
2. 先验证本地 base64；接入后端后检查请求、响应字段、图片地址和成功、失败、取消、重试等回调。
3. 插入图表与公式，确认实际 SVG、公式字体及资源加载正常。
4. 业务保存和协同按自己的鉴权、接口与数据版本联调。
