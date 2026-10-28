# 快速开始

lark-doc 是一个发布为 npm 包的 LarkDoc 风格文档编辑器（Vue 2.7 + Tiptap 3），提供两种使用方式：

- **命令式入口** `new LarkDoc()`：像 AiEditor 一样用构造函数驱动完整工作台，适合任何宿主（原生页面、Vue2 路由、微前端）。
- **组件式入口** `LarkDocEditor` / `LarkDocWorkspace`：直接把 Vue 组件挂进模板，适合已经在用 Vue 2.7 的项目。

推荐统一使用命令式入口，组件式入口保留为兼容导出。

## 第一步：先判断你属于哪一类

**只问一句：你的项目现在装的是不是 `vue@2.7`？**

| 你的情况 | 用哪个入口 | 装法 | 往下读 |
| --- | --- | --- | --- |
| **是** Vue 2.7（webpack 4/5、vite 都算） | 主入口 `lark-doc`，`new LarkDoc()` 或 `<lark-doc-editor>` | `npm i lark-doc` | 本文 [最小示例](#最小示例) |
| **否**：Vue 3 / React 18 | `lark-doc/element`（`<lark-doc>` 自定义元素） | `npm i lark-doc --legacy-peer-deps`，或**不装包**直接拷 `dist/` | [Web Component](/guide/web-component) |
| **没有打包器**：纯 HTML / 老系统 / 内网静态页 | `<script>` 引 UMD | 拷 `dist/` 整目录，不用 npm | [原生 / CDN](/guide/environments#env-static) |

为什么 Vue 3 / React 要绕一下：包的 `peerDependencies` 里 `vue ^2.7.14` 和 `@tiptap/vue-2` 都是**强制**的，Vue 3 项目直接 `npm i lark-doc` 会 `ERESOLVE` 失败；硬装上去再用主入口，会在 `new LarkDoc()` 时报 `Vue.extend is not a function`（Vue 3 已移除该 API）。

`lark-doc/element` 这条路是安全的：Vue 2 运行时、Tiptap、样式**全部内联在产物里**，宿主不需要装任何 Vue 2 相关依赖。

环境要求：Node 14.21.3 及以上，宿主有 `Promise` / `fetch`。样式与 KaTeX 字体随包发布，不需要另找字体文件。

## 引入写法速查

上面决定了走哪条路之后，这张表只回答一件事：**`import` 那一行怎么写**。

| 宿主环境 | 引入写法 | 初始化 | 备注 |
| --- | --- | --- | --- |
| Vue 2.7 + webpack5 / vite | `import { LarkDoc } from 'lark-doc'` | `new LarkDoc({...})` | 命中 `exports.import` → ESM；懒区块由宿主打包器接管，内外网零配置 |
| Vue 2.7 + webpack4（vue-cli 4） | `import { LarkDoc } from 'lark-doc'` + `import 'lark-doc/dist/lark-doc.css'` | 同上 | webpack4 不读 `exports`，CSS 必须写 `dist/` 全路径；样式不可省略 |
| Vue 2.7 直接嵌 SFC | `import { LarkDocEditor } from 'lark-doc'` | `<lark-doc-editor v-model="html" @change="fn" />` | props 与门面 options 同源（**正文是 `v-model` / `value`，不是 `content`**） |
| Vue 3 / React / 无框架 | `import 'lark-doc/element'`（自动注册）或 `mountLarkDoc(el, opts)` | `<lark-doc title="…">` | 产物内置 Vue；对象型能力（uploader / persistence / ai）只能 `setProperty` |
| CDN / 静态托管 / 内网 | `<script src="…/dist/lark-doc-element.umd.min.js">` | `<lark-doc>` | **`dist/` 整目录**同位部署（主文件 + `*.math.js`、`*.mermaid.js` 等按需区块 + `fonts/`） |
| Node / jsdom / SSR | `require('lark-doc')`；SSR 用 `process.client` 内 `await import('lark-doc/element')` | `new LarkDoc({ element: host })` | CJS 单文件（内联全部区块）；element 产物模块求值即注册元素，Node 端 import 会炸 → 必须 client-only |

::: tip 编译工具要点
- webpack5 / vite / rollup：认 `exports`，两条入口零配置；
- **webpack4 只认 `main` / `module`**：`import 'lark-doc/element'` 会报「找不到模块」，要写 `lark-doc/dist/lark-doc-element.umd.min.js`，或 `<script>` 直引；
- browserslist 为 `> 0.5% / last 2 versions / not dead`，**不含 IE11**：IE11 宿主需自己把 `node_modules/lark-doc` 加进 babel `include`；
- 默认假设宿主有 `Promise` / `fetch` 等运行环境能力；老浏览器请自行在入口加 polyfill。
:::

> 每个环境的**编译工具配置 + 可粘贴运行的完整 demo + 工具栏配置**见[各环境引入对照](/guide/environments)。

## 最小示例

下面这段只适用于 **Vue 2.7 宿主**。Vue 3 / React 走的是自定义元素，写法完全不同，见 [Web Component](/guide/web-component)。

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

- 查看全部[配置总览](/guide/configuration)与[实例方法](/guide/instance)
- 按[功能配置](/blocks/heading)逐项了解每个内容块
- 需要接入真实 AI、上传或持久化，参考 [View 层接入](/guide/view-integration)
