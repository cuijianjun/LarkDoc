# 进阶接入：业务保存与协同

第一次接入请从[统一示例中心](https://cuijianjun.github.io/LarkDoc/examples/)选择环境。每页已包含安装、引入、配置、最小工程与预览；本文只补充应用接入业务后端时的职责。

## 内容与业务保存

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

## Provider 与协同

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

## 更新上传配置

初始化式服务器上传和完整回调已放在各环境页面。运行时需要更换上传配置时：

```js
// 命令式实例：原位更新，保留正文、标题和撤销历史。
doc.setUploader(nextUploader)

// Web Component：通过 property 传递对象和函数。
el.options = { ...el.options, uploader: nextUploader }
```

配置了 HTTP 后，失败不会自动改为 base64。上传成功表示取得合法图片结果；正文变化和应用服务端保存成功应分别确认。
详情见[上传器参考](https://cuijianjun.github.io/LarkDoc/blocks/uploader.html)。

## 接入后检查

1. 编辑内容，确认更新事件能读到 JSON；切换页面后销毁编辑器。
2. 先验证本地 base64；接入后端后再检查请求、响应字段、图片地址和失败/取消回调。
3. 插入图表与公式，确认实际图形和字体显示，资源没有 404。
4. 业务保存和协同按自己的鉴权、接口与数据版本联调。

修改本仓库源码请按[本地开发与验证](./docs/guide/development.md)操作。需要查询具体模块约束时再看[开发导航](./dev/00-INDEX.md)。
