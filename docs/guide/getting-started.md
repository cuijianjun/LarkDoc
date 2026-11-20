# 快速开始

打开[在线试用](/demo/)即可编辑文档。要接入已有项目，直接选一个[对应环境的示例](/examples/)。

## 1. 在本地跑一个示例

准备 Git、Node.js 22.13+ 和 npm。下面以 Vue 3 + Vite 为例。

```bash
git clone --depth 1 https://github.com/cuijianjun/LarkDoc.git
cd LarkDoc/docs/examples/apps/vue3-vite
npm ci
npm run dev -- --host 127.0.0.1
```

打开终端打印的地址。输入一段正文，点击「读取 JSON」，确认输出里有刚输入的内容。选一张图片，即可试用浏览器内的图片预览。

## 2. 接入自己的项目

在已有项目根目录安装 SDK。

```bash
npm install lark-doc@0.14.12 --save-exact
```

在页面放一个 `<div id="editor"></div>`，容器挂载后执行以下代码。离开页面时调用 `doc.destroy()`。

```js
import { LarkDoc } from 'lark-doc'
import 'lark-doc/style.css'

const doc = new LarkDoc({
  element: '#editor',
  content: '<p>你好，LarkDoc</p>',
  storage: 'none',
})
```

`storage: 'none'` 关闭示例里的内置草稿。业务需要保存时，用 `doc.getJSON()` 取正文、`doc.getTitle()` 取标题，再提交给自己的后端。Vue、React、Webpack4 和静态 HTML 的完整写法见[示例中心](/examples/)。

## 3. 按需配置

| 想做什么 | 从哪里开始 |
| --- | --- |
| 调整界面和编辑功能 | [功能总览](/blocks/) · [常用配置](/guide/configuration) |
| 读取内容、监听变化 | [实例与事件](/guide/instance) |
| 使用服务器上传 | [图片上传](/blocks/uploader#初始化配置-http-上传) |
| 加评论、权限或多人协同 | [协同与权限](/guide/collaboration) |

源码构建和发布流程见[仓库开发手册](https://github.com/cuijianjun/LarkDoc/blob/master/DEVELOPMENT.md)。
