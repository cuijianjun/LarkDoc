# LarkDoc 接入与架构指南

初次接入按本文前五节操作。需要看内部边界时，再读后面的数据模型与 Provider。源码开发步骤在 [DEVELOPMENT.md](./DEVELOPMENT.md)，[在线开发说明](https://cuijianjun.github.io/LarkDoc/guide/development.html)会随文档站部署。

## 1. 安装和创建

```bash
npm install lark-doc@0.14.4 --save-exact
```

```html
<div id="editor"></div>
```

```js
import { LarkDoc } from 'lark-doc'
import 'lark-doc/style.css'

const doc = new LarkDoc({
  element: '#editor',
  title: '我的文档',
  content: '<p>开始编辑。</p>',
  storage: 'none',
  onUpdate: ({ json }) => console.log('正文变化', json),
})
// 离开页面时调用 doc.destroy()。
```

页面只需一个挂载点，框架负责它的生命周期，编辑器自己管理内部 DOM。默认 storage 为 local，示例明确使用 none，避免本地草稿覆盖演示内容。内容变化与业务后端保存应分别处理。

## 2. 选完整功能还是按需实现

| 入口 | 用途 |
| --- | --- |
| `lark-doc` | 推荐起点，重能力在使用时按需加载 |
| `lark-doc/full` | 同样的编辑器 API，一次注册全部本地特性并导出低频模块 |
| `lark-doc/lite` | 不带重实现；通过 `lark-doc/features/*` 按需恢复 |
| `lark-doc/element` | 自动注册自定义元素，也提供 mountLarkDoc |
| `lark-doc/vue2` | 交给应用已有 Vue2 使用的 options 兼容组件 |

默认/full/lite 显式引公共 CSS；Element ESM/UMD 注入样式。math 特性另引 `lark-doc/dist/features/math.css`。静态托管保留整个 dist；不能只拿入口小文件。完整规则见[产物文档](./docs/guide/build-artifacts.md)。

全部库产物由 Rollup 构建，不依赖 Vue 或 Webpack runtime。宿主应用的 Vue CLI/Webpack/Vite 保持原样；Vue2 兼容组件自身不导入 Vue，但仍交给宿主 Vue2 执行生命周期。

## 3. 服务器图片上传

初始化时传 uploader，库等待服务器返回图片地址后再写入编辑器：

```js
const uploader = {
  action: '/api/upload',
  fieldName: 'file',
  response: {
    success: { path: 'code', equals: 0 },
    url: 'data.url',
    attchId: 'data.id',
    message: 'message',
  },
  onProgress: event => console.log('进度', event.percent),
  onSuccess: event => console.log('取得结果', event.taskId),
  onError: event => console.error(event.error.message),
  onSettled: event => console.log('结束', event.status),
}
// 创建时加入：new LarkDoc({ element: '#editor', storage: 'none', uploader })
```

服务端返回 `{ "code": 0, "data": { "url": "/images/a.png", "id": "123" } }`。直接返回 `{ "url": "/images/a.png" }` 可省略 response。跨域后端通常应返回完整图片 URL，并配置允许页面来源的 CORS。

不传 action/upload 时本地转 base64；自定义 upload 优先于 action。服务器失败不回退 base64。选图、粘贴文件、拖拽、替换、裁剪共用 beforeUpload/start/progress/retry/success/error/cancel/reject/settled，另有 onCallbackError 处理应用通知异常。完整可复制代码见[上传器](./docs/blocks/uploader.md)。

不要在 onSuccess 再插图：它表示获得合法结果；文档 update/change 确认正文事务，业务保存结果应由应用保存接口或持久化流程确认。

## 4. Vue2、Vue3、React 和标签

三框架都推荐主入口 new LarkDoc，上传对象完全相同：

| 宿主 | 创建 | 清理 | 标签/兼容组件可选方案 |
| --- | --- | --- | --- |
| Vue2 | mounted | beforeDestroy → destroy | `:uploader` 传给 LarkDocEditor |
| Vue3 | onMounted | onBeforeUnmount → destroy | `<lark-doc :options.prop="options">` |
| React | useEffect | effect 返回 destroy | createReactLarkDoc(React)，options/uploader 走 property |
| 原生标签 | el.options 配对象 | 元素断开或手动 destroy | 完整 dist + Element UMD |

[各环境完整示例](./docs/guide/environments.md)包含共用上传配置、Vue2兼容组件、Vue3标签、React薄壳和SSR模式。Webpack4根入口无需旧alias，CSS/深子路径用实际dist文件；新Element ESM面向现代打包器。

需要更新上传配置时调用 `doc.setUploader(nextUploader)`，或更新元素的 `el.options`。仅上传配置变化保留编辑器、正文、标题和撤销历史；不对任意配置更新作相同承诺。函数对象不能 JSON 序列化成 HTML attribute。

## 5. 运行 demo 并验收

- [Playground](https://cuijianjun.github.io/LarkDoc/demo/)：修改初始化代码，查看真实编辑器。
- [base64 与回调](https://cuijianjun.github.io/LarkDoc/demo/?example=base64)：无需服务器。
- [服务器上传配置](https://cuijianjun.github.io/LarkDoc/demo/?example=server)：填入自己的接口后发起真实请求。
- [Mermaid 图表](https://cuijianjun.github.io/LarkDoc/demo/?example=diagram)：验证实际 SVG 渲染。

GitHub Pages 托管静态页面，不提供业务上传后端。先在控制台/页面查看回调，再在 Network 确认图片和配套资源可访问；应用后端仍需按真实接口联调。

## 6. 数据与应用职责

宿主负责路由、用户、登录、服务端接口和业务保存。包负责编辑器、工作台交互、文档格式、Provider 边界和本地模式。默认不会创建 Yjs、WebSocket 或后台协同连接。

正文是 Tiptap JSON，可放进版本化记录：

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

`content` 接收此记录、直接 JSON 或 HTML。Vditor HTML 可直接传入，或使用 doc.importVditor(html)；doc.getImportReport() 查看归一化结果。评论、Presence、权限与 AI 临时状态不应混进正文版本。

## 7. Provider 与协同边界

Provider 是应用提供的 JavaScript 对象，不绑定后端框架：

| Provider | 最小方法 |
| --- | --- |
| persistence | load/save/snapshots/snapshot/restore |
| collaboration | connect/disconnect |
| versioning | list/createSnapshot/get/restore |
| comments | list/createThread/reply/resolve/reopen |
| authorization | getCapabilities |

先接入服务端保存，再按需要添加权限、版本、评论与协同。权限 UI 不代替服务端鉴权；版本恢复应创建新修订，评论锚点使用稳定身份而非短暂选区坐标。

显式协同从 lark-doc/collab 接入，应用提供匹配的单例、同格式 ProseMirror/Yjs 依赖；ESM配ESM，CJS配CJS，UMD不接外部协同扩展。collabDependencies是契约元数据，不是npm安装约束。当前验证使用Node22、Yjs13.6.33、Hocuspocus Provider4.7.1与Tiptap协同扩展3.32.0，不据此推定任意旧版本兼容。Node14普通编辑契约不扩展为Node14协同承诺。

## 8. 开发入口

[开发说明](./DEVELOPMENT.md) → [开发手册索引](./dev/00-INDEX.md) → 对应模块源码和验证脚本。环境要求、快速检查和发版步骤以开发文档与仓库脚本为准。性能数据分别看库冷构建、应用冷/缓存构建，不用入口壳大小或单次结果替代完整证据。
