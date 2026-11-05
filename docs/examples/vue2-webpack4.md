<script setup>
import EnvironmentPreview from './EnvironmentPreview.vue'
</script>

# Vue2 + Webpack4

适合使用 Vue2 和 Webpack4（包括 Vue CLI4）的应用。本页最小工程使用 **Node 14.21.3、npm 8.19.4、lark-doc 0.14.5**；Vue 与模板编译器版本由下面的 `package.json` 配对固定。

<EnvironmentPreview env="vue2-webpack4" title="Vue2 + Webpack4" />

预览运行下面的真实 Vue2 工程。编辑正文后，页面的更新次数会变化；点击“读取 JSON”可读取标题和正文。选择或拖入图片，可以看到本地 base64 上传状态。

## 1. 安装

已有应用在项目根目录执行：

```bash
npm install lark-doc@0.14.5 --save-exact
```

保留已有的 Vue2、Vue CLI、Webpack 和 loader 配置。下面的完整工程用于从空目录练习，不需要拿它覆盖已有项目的配置。

## 2. 引入与生命周期

```js
import { LarkDoc } from 'lark-doc'
import 'lark-doc/dist/lark-doc.css'
```

在 `mounted` 里创建实例，在 `beforeDestroy` 里调用 `destroy()`。实例保存在普通实例字段上，避免放进 Vue2 的 `data` 响应式系统。初始化、内容读取和上传回调都在下面的 `src/App.vue` 中。

Webpack4 不读取 package exports，因此样式使用实际的 `dist` 路径。根 ESM 主入口已降语法，不需要旧的 `lark-doc$` alias。此页使用命令式 API；新 Element ESM 含 `import.meta.url`，旧宿主如需标签方案，应使用独立 UMD script。

## 3. 完整最小工程

在新建目录中，按文件名保存以下五个文件；其中 `src` 是子目录。所有必需配置和组件均在本页，无需另建共用上传配置文件。

::: code-group

```json [package.json]
<!--@include: ./apps/vue2-webpack4/package.json-->
```

```js [webpack.config.cjs]
<!--@include: ./apps/vue2-webpack4/webpack.config.cjs-->
```

```html [index.html]
<!--@include: ./apps/vue2-webpack4/index.html-->
```

```js [src/main.js]
<!--@include: ./apps/vue2-webpack4/src/main.js-->
```

```vue [src/App.vue]
<!--@include: ./apps/vue2-webpack4/src/App.vue-->
```

:::

示例显式使用 `storage: 'none'`，刷新后恢复初始内容。上传器没有配置 `action` 或 `upload`，图片在浏览器中读取为 base64，不请求上传服务器。

## 4. 启动与验收

在上述 `package.json` 所在目录执行：

```bash
npm install
npm run dev
```

打开 `http://localhost:4174`。需要生成静态产物时执行 `npm run build`，输出到 `dist/`。

1. 修改标题与正文，点击“读取 JSON”，确认读到当前值，正文更新次数增加。
2. 选一张图片或将图片拖入正文，确认图片显示，页面图片状态最终变为 `success（local）`。
3. 在应用内切换页面时保留 `beforeDestroy` 清理，取消当前编辑器未完成的任务。

## 可选：改为服务器上传

::: details 配置上传地址、响应字段与完整回调

在 `src/App.vue` 的 `mounted` 中、`new LarkDoc(...)` 之前定义下面的 `uploader`，再把初始化参数中的 `uploader: { ... }` 替换为 `uploader`。这里的回调输出到浏览器控制台；可按应用需要改成页面提示。

```js
const uploader = {
  action: 'https://your-api.example.com/upload', // 换成你的上传接口
  fieldName: 'file',
  response: {
    success: { path: 'code', equals: 0 },
    url: 'data.url',
    attchId: 'data.id',
    message: 'message',
  },
  beforeUpload: (file, ctx) => {
    console.log('上传前检查', ctx.taskId, file.name)
    return true // 返回 false 可取消本次任务
  },
  onStart: event => console.log('开始', event.taskId),
  onProgress: event => console.log('进度', event.taskId, event.percent),
  onRetry: event => console.log('重试', event.taskId, event.nextAttempt),
  onSuccess: event => console.log('取得图片结果', event.taskId),
  onError: event => console.error('失败', event.taskId, event.error.message),
  onCancel: event => console.log('取消', event.taskId, event.reason),
  onReject: event => console.log('拒绝', event.taskId),
  onSettled: event => console.log('结束', event.taskId, event.status),
  onCallbackError: error => console.error('应用回调异常', error.message),
}
```

后端应返回：

```json
{ "code": 0, "message": "上传成功", "data": { "url": "https://your-api.example.com/images/a.png", "id": "123" } }
```

库会发送 multipart 文件，等待 HTTP 与业务成功、提取并校验地址后写入图片。不要在 `onSuccess` 里再插图；它表示取得合法结果，不表示业务后端已保存文档。选图、粘贴文件、拖拽、替换和裁剪共用这套回调；粘贴已有图片 URL 不触发文件上传回调。

文档站没有上传后端。请使用自己的 HTTPS 接口，跨域时由后端允许页面来源；图片地址也要能被页面访问。服务器失败会触发错误回调，不会自动改成本地 base64。重试、请求头和取消的更多选项见[上传器 API](/blocks/uploader)。

:::
