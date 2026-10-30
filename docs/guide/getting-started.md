# 快速开始

三步：**选入口 → 装包 → 贴代码**。Vue 2.7 项目五分钟能跑起来。

> 想先看效果，直接开[在线演示](/demo/)：上半屏是真实编辑器，下半屏是它的初始化代码，改完即时生效。

## 一、先选入口

只问一句：**你的项目是 Vue 2.7 吗？**

| 你的情况 | 用哪个 | 装法 |
| --- | --- | --- |
| 是 Vue 2.7（webpack 4/5、vite 都算） | 主入口 `lark-doc` | `npm i lark-doc` |
| Vue 3 / React / 无框架 | 子入口 `lark-doc/element`（`<lark-doc>` 元素） | `npm i lark-doc --legacy-peer-deps` |
| 纯 HTML / 老系统 / 内网静态页 | UMD 脚本，不装包 | 拷 `dist/` 整目录 |

Vue 3 / React 为什么要绕开主入口：包的 `peerDependencies` 强依赖 `vue@2.7`，直接装会 `ERESOLVE`；硬装后调 `new LarkDoc()` 会报 `Vue.extend is not a function`。`lark-doc/element` 把 Vue 2 运行时、Tiptap、样式全内联进了产物，宿主什么都不用装。

## 二、跑起来

### Vue 2.7（最常见）

```js
import 'lark-doc/style.css'
import { LarkDoc } from 'lark-doc'

const doc = new LarkDoc({
  element: '#editor',
  content: '<p>hello lark-doc</p>',
})

// 常用方法
doc.getHTML()                 // 取 HTML
doc.getJSON()                 // 取结构化 JSON（要无损往返就用它）
doc.setContent('<h1>新内容</h1>')
doc.destroy()                 // 销毁：定时器、事件监听全清
```

```html
<div id="editor"></div>
```

就这两段。**自动保存默认已开**（草稿写浏览器 IndexedDB，刷新还在），不用额外配。

### Vue 3 / React / 无框架

```js
import 'lark-doc/element'   // 引入即注册 <lark-doc> 自定义元素
```

```html
<lark-doc title="未命名文档"></lark-doc>
```

元素上能写字符串类配置（`title` / `content` / `theme` / `readonly`）；函数类能力（`uploader`、`ai`）用 `el.setProperty('uploader', {...})` 注入。详见 [Web Component](/guide/web-component)。

### 纯 HTML / 内网静态页

```html
<link rel="stylesheet" href="./dist/lark-doc.css" />
<script src="./dist/lark-doc-element.umd.min.js"></script>
<lark-doc title="未命名文档"></lark-doc>
```

`dist/` 要**整目录**同位部署：主文件之外还有 `*.highlight.js`、`*.math.js`、`*.mermaid.js` 等按需区块和 `fonts/`，缺了对应功能就加载不出来。

## 三、常用配置

只列最常改的几项，全量见[配置总览](/guide/configuration)。

```js
new LarkDoc({
  element: '#editor',
  title: '未命名文档',
  placeholder: '输入正文，或输入 / 插入内容',
  readonly: false,
  theme: 'light',

  storage: 'local',                                  // 'none' = 完全不落盘
  autosave: { enabled: true, delay: 650 },           // 自动保存（默认开）

  importExport: { exportFormats: ['html', 'md'] },   // 只留两项导出
  media: { htmlMode: 'inline' },                      // 'link' = 导出 HTML 时图片只留地址；远程 https 地址两档都原样保留

  onReady: ({ editor }) => console.log('ready', editor),
  onUpdate: ({ html }) => console.log('change'),
})
```

## 四、环境要求

Node 14.21.3 及以上；运行环境需要有 `Promise` 与 `fetch`。样式与 KaTeX 字体随包发布，不用另找字体文件。browserslist 不含 IE11。

::: tip 三个常见坑
- **webpack 4** 不认 `exports` 字段：主入口加一行 alias `'lark-doc$' → 'lark-doc/dist/lark-doc.common.js'`（CJS 档已降到 ES2018，不用再过 babel）。
- **样式只引一次**：CJS 档需要 `import 'lark-doc/style.css'`；UMD / ESM / element 产物样式已随 JS 注入，不用再引。
- **Vue 2 路由里用完要 `destroy()`**，否则切页后定时器和事件监听会留着。
:::

## 下一步

- 装包 / 内网搬运 / `dist/` 拷贝：[安装与引用总表](/guide/install)
- 每个环境的完整可运行 demo：[各环境引入对照](/guide/environments)
- 实例方法与事件：[实例与事件](/guide/instance)
- 每个内容块怎么配：[标题](/blocks/heading)、[图片](/blocks/image)、[导入导出](/blocks/import-export)
