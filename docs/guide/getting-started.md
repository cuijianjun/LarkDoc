# 快速开始

先让编辑器显示出来，再按需要配置图片上传和你的框架。想直接体验，可以打开<a href="../demo/" target="_blank" rel="noopener">在线 demo</a>。

## 1. 在现有应用安装

```bash
npm install lark-doc@0.14.4 --save-exact
```

库内部使用原生 DOM，不要求为了安装它补装 Vue，也不需要更换应用已有的 Vue CLI、Webpack 或 Vite。应用本身的框架与插件继续由应用管理。

## 2. 放一个容器

```html
<div id="editor"></div>
```

容器存在后，再执行下面的代码。Vue/React 中把创建放进挂载生命周期，具体见[各环境示例](/guide/environments)。

```js
import { LarkDoc } from 'lark-doc'
import 'lark-doc/style.css'

const doc = new LarkDoc({
  element: '#editor',
  title: '我的第一篇文档',
  content: '<p>你好，lark-doc。</p>',
  storage: 'none',
  onUpdate: ({ json }) => console.log('正文已更新', json),
  onError: error => console.error(error),
})

// 需要读取时调用：doc.getJSON() / doc.getHTML()
// 页面卸载时调用：doc.destroy()
```

`content` 可以传 HTML、Tiptap JSON 或文档记录。示例显式使用 `storage: 'none'`，由应用管理内容；默认 `local` 会读写浏览器草稿。不要把「内容更新」当成「业务后端保存成功」。

::: tip Webpack4 的样式路径
Webpack4 不读取 package exports。主入口仍写 `import { LarkDoc } from 'lark-doc'`，样式改成 `import 'lark-doc/dist/lark-doc.css'`，无需旧的根 alias。默认/full/lite 都需显式引 CSS；Element ESM/UMD 的 CSS 才由 JS 注入。
:::

## 3. 选择图片保存方式

**先体验本地 base64**：不配 `uploader.upload` 和 `uploader.action`，选图后由浏览器读取图片。这不需要服务器。

**上传到服务器**：在初始化时加入以下配置，库会先上传文件，拿到地址后再插入图片。

```js
const uploader = {
  action: '/api/upload', // 换成你的上传接口
  response: { url: 'data.url' },
  onProgress: event => console.log('进度', event.percent),
  onSuccess: event => console.log('已取得地址', event.taskId),
  onError: event => console.error(event.error.message),
  onSettled: event => console.log('结束', event.status),
}

const doc = new LarkDoc({ element: '#editor', storage: 'none', uploader })
```

该例期望服务器返回 `{ "data": { "url": "/images/a.png" } }`。返回 `{ "url": "/images/a.png" }` 时可省略 `response`。不要在 `onSuccess` 里再插一次图片，编辑器会完成写入。

回调在 Vue2、Vue3、React 和 Web Component 中共用；请求头、业务成功判断、附件 ID、取消和完整回调见[上传器](/blocks/uploader)。

## 4. 选择需要的功能

第一次接入推荐默认 `lark-doc`。它保留常用能力，重实现按需加载。

```js
// 全部本地特性一次注册：
import { LarkDoc } from 'lark-doc/full'
```

或只加载编辑器和图表：

```js
import { LarkDoc } from 'lark-doc/lite'
import 'lark-doc/features/mermaid'
import 'lark-doc/style.css'
```

两段是替代方案，选一段使用。lite 还可配合 math、highlight、markdown、office；[产物说明](/guide/build-artifacts)解释对应样式与资源。协同仍需独立显式接入。

## 5. 跟着 demo 验收

1. 编辑文字，确认 `onUpdate` 能收到 JSON。
2. 打开<a href="../demo/?example=base64" target="_blank" rel="noopener">base64 demo</a>，选图并查看回调。
3. 打开<a href="../demo/?example=server" target="_blank" rel="noopener">服务器上传 demo</a>，按提示配置自己的接口。
4. 打开<a href="../demo/?example=diagram" target="_blank" rel="noopener">图表 demo</a>，确认图表实际显示为 SVG。

GitHub Pages 只托管静态页面，不内置上传服务器。图表、公式和字体资源随 SDK 提供；业务上传接口由应用提供。

下一步按顺序阅读[安装与离线搬运](/guide/install)、[Vue2/Vue3/React 完整示例](/guide/environments)、[上传配置与回调](/blocks/uploader)。
