# 快速开始

lark-doc 是基于 Tiptap 3 与原生 DOM 的文档编辑器。默认、Element 和 lite 入口都不依赖 Vue 运行时。所有应用统一使用最新命令式入口；Vue2 也不再配置或引入旧的兼容入口：

- **命令式入口** `new LarkDoc()`：像 AiEditor 一样用构造函数驱动完整工作台，适合任何宿主（原生页面、Vue2 路由、微前端）。
Vue2 宿主同样使用命令式入口，在组件 `mounted` 中挂载、`beforeDestroy` 中销毁实例；不再提供旧的 options 兼容入口。

> 💡 想先上手看看？直接打开<a href="../demo/" target="_blank" rel="noopener">在线演示</a>（上方编辑器预览 + 下方可折叠代码预览，可在页面直接改初始化配置实时生效）。

## 第一步：先判断你属于哪一类

**按挂载方式选择，不再按宿主 Vue 版本选择。**

| 你的情况 | 用哪个入口 | 装法 | 往下读 |
| --- | --- | --- | --- |
| **命令式挂载**：任意框架或无框架 | 主入口 `lark-doc`，`new LarkDoc()` | `npm i lark-doc` | 本文 [最小示例](#最小示例) |
| **自定义元素**：Vue 2 / Vue 3 / React / 原生页面 | `lark-doc/element`（`<lark-doc>`） | `npm i lark-doc`，或直接拷 `dist/` | [Web Component](/guide/web-component) |
| **没有打包器**：纯 HTML / 老系统 / 内网静态页 | `<script>` 引 UMD | 拷 `dist/` 整目录，不用 npm | [原生 / CDN](/guide/environments#env-static) |

`vue`、`vue-template-compiler` 和 `@tiptap/vue-2` 已从顶层依赖移除；无需为了 lark-doc 安装 Vue2，也不需要 `--legacy-peer-deps`。默认与 Element 内部均为原生 DOM，不是把 Vue 隐藏在内联产物里。协同能力仅在显式使用协同子入口时需要相应 optional peer。

环境要求：Node 14.21.3 及以上，宿主有 `Promise` / `fetch`。样式与 KaTeX 字体随包发布，不需要另找字体文件。

## 引入写法速查

上面决定了走哪条路之后，这张表只回答一件事：**`import` 那一行怎么写**。

| 宿主环境 | 引入写法 | 初始化 | 备注 |
| --- | --- | --- | --- |
| Vue 2.7 + webpack5 / vite | `import { LarkDoc } from 'lark-doc'` | `new LarkDoc({...})` | 命中 `exports.import` → ESM；懒区块由宿主打包器接管，内外网零配置 |
| Vue 2.7 + webpack4 / vue-cli | `import { LarkDoc } from 'lark-doc'` + `import 'lark-doc/style.css'` | `new LarkDoc({...})` | 直接使用包的 CJS `main`，不需要 alias 或专属 babel |
| Vue 2.7 组件 | `import { LarkDoc } from 'lark-doc'` | `mounted` 中 `new LarkDoc({ element: this.$refs.editor })` | `beforeDestroy` 中调用 `destroy()` |
| Vue 3 / React / 无框架 | `import 'lark-doc/element'`（自动注册）或 `mountLarkDoc(el, opts)` | `<lark-doc title="…">` | 产物不含 Vue；也可用主入口 `new LarkDoc()`；对象型能力（uploader / persistence / ai）只能 `setProperty` |
| CDN / 静态托管 / 内网 | `<script src="…/dist/lark-doc-element.umd.min.js">` | `<lark-doc>` | **`dist/` 整目录**同位部署（主文件 + `*.math.js`、`*.mermaid.js` 等按需区块 + `fonts/`） |
| Node / jsdom / SSR | `require('lark-doc')`；SSR 用 `process.client` 内 `await import('lark-doc/element')` | `new LarkDoc({ element: host })` | CJS 主文件与按需兄弟 chunk（require 加载）；element 产物模块求值即注册元素，Node 端 import 会炸 → 必须 client-only |

::: tip 编译工具要点
- webpack5 / vite / rollup：认 `exports`，直接使用 `lark-doc`；
- webpack4 / vue-cli：默认解析包的 CJS `main`，直接使用 `lark-doc`；不要添加源码 alias 或 lark-doc 专属 babel；
- 所有宿主都不应把 `node_modules/lark-doc/dist` 再交给 Babel，避免重复编译拖慢启动和构建；
- browserslist 为 `> 0.5% / last 2 versions / not dead`，**不含 IE11**：IE11 宿主需自己把 `node_modules/lark-doc` 加进 babel `include`；
- 默认假设宿主有 `Promise` / `fetch` 等运行环境能力；老浏览器请自行在入口加 polyfill。
:::

> 每个环境的**编译工具配置 + 可粘贴运行的完整 demo + 工具栏配置**见[各环境引入对照](/guide/environments)。

## 最小示例

下面这段适用于任意浏览器宿主：框架只需提供一个挂载点并在卸载时调用 `destroy()`。使用标签的写法见 [Web Component](/guide/web-component)。

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

- **装包、内网搬运、`dist/` 拷贝**：[安装与引用总表](/guide/install)（一张表覆盖外网 / 内网 × 9 种宿主）
- 你的框架到底要贴哪些配置：[各环境引入对照](/guide/environments)
- 查看全部[配置总览](/guide/configuration)与[实例方法](/guide/instance)
- 按[功能配置](/blocks/heading)逐项了解每个内容块
- 需要接入真实 AI、上传或持久化，参考 [View 层接入](/guide/view-integration)
