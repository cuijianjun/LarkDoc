<script setup>
import EnvironmentPreview from './EnvironmentPreview.vue'
</script>

# Web Component

使用 `<lark-doc>` 自定义标签，通过 property 传递对象和函数；不需要 Vue、React 或打包器。本页使用 **lark-doc 0.14.5**，Node/npm 只用于获取 SDK，Python 3 用于启动本地静态服务。

<EnvironmentPreview env="web-component" title="Web Component" />

预览使用下面的完整 HTML 与同版本 SDK 静态资源。修改正文、点击“读取 JSON”或插入图片，都能在页面上看到实际状态。

## 1. 安装与准备资源

在一个空目录执行：

```bash
npm init -y
npm install lark-doc@0.14.5 --save-exact
mkdir -p public/vendor
cp -R node_modules/lark-doc/dist/. public/vendor/
```

将完整 `dist/` 的内容复制到 `public/vendor/`，保留 feature 脚本、CSS、字体和所有子目录。上面的复制命令适用于 macOS/Linux；Windows 也可以直接复制目录内容。不要只复制主 JS，公式、图表、Word 与高亮会用到配套文件。

## 2. 引入与配置

HTML 使用普通 script 引入：

```html
<script src="./vendor/lark-doc-element.umd.min.js"></script>
```

这个入口自动注册 `<lark-doc>` 并注入样式。先 `document.createElement('lark-doc')`，设置 `element.options` 并绑定事件，最后才插入 DOM。含上传回调的对象必须走 property，不能序列化成 HTML attribute。

等 `lark-doc-ready` 后再读取内容；正文变化通过 `lark-doc-update` 的 `event.detail.payload` 取得。元素移出 DOM 时会自动释放编辑器；下面的示例在页面离开时移除元素。示例设置 `storage: 'none'`，刷新后恢复初始内容。

## 3. 完整 HTML

将以下内容保存为 `public/index.html`，与上面的 `vendor/` 目录同级：

```html [public/index.html]
<!--@include: ./apps/static/web-component.html-->
```

没有配置 `uploader.action` 和 `uploader.upload` 时，图片在浏览器中读取为 base64。页面状态来自真实的正文事件和上传回调。

## 4. 启动与验收

在 `public` 的上一级目录执行：

```bash
python3 -m http.server 4177 --directory public
```

打开 `http://localhost:4177`，通过 HTTP 访问，不直接双击 HTML。

1. 修改标题与正文，点击“读取 JSON”，确认读到当前值，正文更新次数增加。
2. 选一张图片或将图片拖入正文，确认图片显示，页面图片状态最终变为 `success（local）`。
3. 插入公式或图表，确认字体和配套脚本正常加载，Network 中没有资源 404。

部署时完整上传 `public/`。如果使用自己的 CDN，把 script 地址改为 CDN 上同版本的主 JS 地址，并在该地址的同目录保留整套配套资源；UMD 会相对主脚本定位它们。

## 可选：改为服务器上传

::: details 配置上传地址、响应字段与完整回调

在 `public/index.html` 中，用下面的完整对象替换原有的 `const uploader = { ... }`，保留初始化中的 `uploader` 引用。仍在 `element.options` 赋值和元素插入 DOM 之前完成配置。这里的回调输出到浏览器控制台；可按应用需要改成页面提示。

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
