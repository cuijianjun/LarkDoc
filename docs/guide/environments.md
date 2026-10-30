# 各环境引入对照

包对外只有**两条 JS 入口**，所有环境差异都收敛在三件事上：

| 判断维度 | 说明 |
| --- | --- |
| 宿主有没有 Vue 2.7 | 有 → 主入口 `lark-doc`（Vue 是 peer 依赖）；没有 → `lark-doc/element`（Vue 已内联进产物） |
| 打包器认不认 `exports` | 认（webpack5 / vite / rollup / Node）→ 零配置，浏览器与 SSR 吃**同一份产物**；不认（webpack4 / 老 rspack）→ 主入口要**一行 alias** 指到 CJS 档（见 [env-vue2-wp4](#env-vue2-wp4)），子路径（`lark-doc/element` 等）照旧要写全 `dist/` 路径 |
| 渲染在哪一端 | 浏览器 → 直接挂载；Node / SSR → `require()` 单文件或 client-only 动态 `import()` |

> 本文给出**每个环境的编译工具配置 + 可直接粘贴运行的代码 demo**。改代码前要看的踩坑清单在仓库 [`dev/02-多环境接入.md`](https://github.com/cuijianjun/LarkDoc/tree/master/dev)，两者结论一致、面向对象不同（本文面向使用方，手册面向改代码的人）。
>
> 只想先跑起来？[安装与引用总表](/guide/install) 用一张表给出「怎么装 / 怎么引 / 内网怎么搬」，配置细节再回到本文对应小节。

## 一张表看全

**在「宿主环境」列里找到你的那一行，点进去就是完整配置和可运行代码。**

> 这张表只管「怎么配、怎么引」。**怎么装包、内网怎么搬、`dist/` 怎么拷**在[安装与引用总表](/guide/install)，两页配合看：先按总表装好，再回本文贴配置。

| 宿主环境 | 引入写法 | 编译工具配置 | 编辑器初始化 |
| --- | --- | --- | --- |
| [Vue 2.7 + webpack5 / vue-cli 5](#env-vue2-wp5) | `import { LarkDoc } from 'lark-doc'` | **不用配**（`vue.config.js` 只放业务配置） | `new LarkDoc({ element })` |
| [Vue 2.7 + Vite](#env-vue2-vite) | 同上 | **不用配**，装 `@vitejs/plugin-vue2` 即可 | 同上 |
| [Vue 2.7 + **webpack4**](#env-vue2-wp4) | `import { LarkDoc } from 'lark-doc'` | **一行 alias**（`lark-doc$` → `lark-doc/dist/lark-doc.common.js`）＋样式写全路径；仅按需区块路径可能要设 `__LARK_DOC_PUBLIC_PATH__` | 同上 |
| [Vue 2.7 组件式（SFC）](#env-vue2-sfc) | `import { LarkDocEditor } from 'lark-doc'` | 同宿主；另需让 `style.css` 里的 woff2 走 asset 资源 | `<lark-doc-editor v-model="html" />` |
| [Vue 3](#env-vue3) | `import 'lark-doc/element'` + `import { resolveVue3Attrs } from 'lark-doc/vue3'` | `vite.config.js`：`compilerOptions.isCustomElement` | `<lark-doc v-bind="resolveVue3Attrs(props)">` |
| [React 16.8+](#env-react) | `import 'lark-doc/element'` + `createReactLarkDoc(React)`，或 `mountLarkDoc(el, opts)` | CRA5 / Vite **不用配**；TSX 直接写标签才补 `.d.ts` | `mountLarkDoc(ref.current, opts)` |
| [原生 / CDN / 内网静态](#env-static) | `<script src="…/lark-doc-element.umd.min.js">` | **不用配**，`dist/` 整目录同位托管 | `<lark-doc>` 标签 |
| [Node / jsdom（单测）](#env-node) | `require('lark-doc')` | `jest.config.js`：`testEnvironment: 'jsdom'`，CJS 无需转译 | `new LarkDoc({ element: host })` |
| [SSR · Next 13](#env-ssr) | 客户端内 `await import('lark-doc/element')` | **不用配**，文件头 `'use client'` | client-only 挂载 |
| [SSR · Nuxt 2](#env-ssr) | `dist/lark-doc-element.umd.min.js` 或 `<script>` 直引 | **要**：`nuxt.config.js` 里 `build.transpile` + alias 到 `dist` | client-only 挂载 |

## 通用的编辑器配置

每个环境的 demo 都用同一份 `options`，先集中讲清楚，后面 demo 里只写与「该环境有关」的部分。

```js
const doc = new LarkDoc({
  element: '#editor',                 // 必填：选择器 / HTMLElement / Vue 组件实例（自动取 $el）
  title: '未命名文档',
  content: '<p>开始编辑。</p>',        // HTML / Tiptap JSON / DocumentRecord 三种都收
  placeholder: '输入正文，或输入 / 插入内容',

  // ── 编辑状态 ──
  readonly: false,
  theme: 'light',                     // 'light' | 'dark'
  storage: 'local',                   // 默认 'local'：自动存浏览器草稿；'none' 关掉持久化
  autosave: { enabled: true, delay: 650 },  // 自动保存（默认开，delay 毫秒）
  autofocus: false,
  contentFormat: 'auto',              // 'auto' | 'vditor' | 'html'，老数据归一化策略
  saveHtml: false,                    // true 时持久化 record 额外带 html 派生副本

  // ── 编辑工具（工具栏）──
  toolbarKeys: ['history', 'headings', 'marks', 'textStyle', 'blockStyle', 'insert', 'tables'],
  toolbarExcludes: ['shortcuts'],

  // ── 能力开关 / 版式 / 上限 / 网络 ──
  features: { ai: false, folding: true, importExport: true, diagram: true },
  layout: { headerVisible: true, titleBarFixed: false, toolbarFixed: true },
  limits: { maxLength: 0, maxImageSize: 5 * 1024 * 1024, maxIndent: 5 },
  network: { mode: 'open' },          // 'open' | 'allowlist' | 'offline'

  // ── 宿主注入 ──
  uploader: { upload: (file) => uploadToOss(file) },
  ai: { stream: myStreamFn },
  persistence: myPersistenceAdapter,

  // ── 生命周期 ──
  onReady: ({ editor }) => {},
  onUpdate: ({ html, json, text }) => {},
  onSave: ({ status }) => {},
  onError: (error) => console.error(error),
})
```

配置分组的完整字段见[配置总览](/guide/configuration)，这里只强调三个最容易搞错的点：

| 容易搞错 | 正确做法 |
| --- | --- |
| 以为还要自己开自动保存 | `storage` 默认 `'local'`、`autosave.enabled` 默认 `true`，**开箱即存**；不想要就显式写 `storage: 'none'`（关持久化）或 `autosave: { enabled: false }`（只停自动、保留落点，手动 `doc.save()` 仍可写） |
| 用 `toolbarKeys` 想"禁用"能力 | 它只隐藏入口；要真正禁用改 `features`，历史 JSON 仍可读 |
| 传 `uploadImage` 还是 `uploader` | 两者都收：`uploader.upload` 优先，`uploadImage` 作兼容别名；SFC 里只有 `upload-image` 一个 prop |

### 编辑工具（工具栏）配置

`toolbarKeys` 白名单、`toolbarExcludes` 黑名单，粒度是 12 个分组 + 8 个 mark，别名（`heading` / `table` / `undo`）自动落位，未知 key 只记进 `instance.unknownToolbarKeys`，不会初始化失败。

```js
// ① 全功能：不传，默认全部 12 组
new LarkDoc({ element: '#editor' })

// ② 轻量写作：只留写作必需
new LarkDoc({
  element: '#editor',
  toolbarKeys: ['history', 'headings', 'marks', 'textStyle', 'insert'],
})

// ③ 表格/报表场景：把表格工具条顶上来
new LarkDoc({
  element: '#editor',
  toolbarKeys: ['history', 'headings', 'marks', 'tables', 'insert'],
  toolbarExcludes: ['highlight'],     // 在保留的分组里再摘掉高亮
})

// ④ 只读展示：隐藏所有入口（推荐直接 readonly，而不是靠 toolbarKeys: []）
new LarkDoc({ element: '#editor', readonly: true, toolbarKeys: [] })
```

| 写法 | 效果 |
| --- | --- |
| 不传 `toolbarKeys` | 12 个分组全部平铺 |
| `toolbarKeys: []` | 空白名单，一个分组都不显示 |
| `toolbarKeys: ['bold']` | 自动打开 `marks` 分组，且只留加粗 |
| `toolbarExcludes: ['marks']` | 整组隐藏；`['highlight']` 只隐藏单个 mark |

分组 key 与别名全表见[工具栏配置](/guide/toolbar)。

## 分环境完整示例

以下 demo 均以「Vue 2.7 里挂一个文档页」或「对应框架最小可跑片段」为准，省略掉的只有你自己的业务代码。每个环境先给**编译工具配置**，再给业务代码。

### 1. Vue 2.7 + webpack5 / vue-cli 5 {#env-vue2-wp5}

> 进内网的分步操作（出包 → vendor 目录 → 改 `package.json` → 验收）见[内网迁移实战 · 方案 B](/guide/intranet-migration#mig-vue2-wp5)。

**编译工具：不用配。** 宿主认 `exports`，`import` 命中 `dist/lark-doc.esm.js`，懒区块（公式 / Word / Markdown / 代码高亮 / mermaid）由宿主自己的 `import()` 分割并输出。

lark-doc 没有专属配置，所以这里给的是**一份明确「不配什么」的 `vue.config.js`**：

```js
// vue.config.js（vue-cli 5）—— 与 lark-doc 相关的部分全是"不需要"
const { defineConfig } = require('@vue/cli-service')

module.exports = defineConfig({
  // ① 不用 alias：webpack5 默认 mainFields 含 'module'，命中 exports.import
  // ② 不用 transpileDependencies：esm 产物已按 browserslist 编好
  // ③ 不用改 rules：webpack5 自己能吃 import.meta（webpack4 才是那个坑）
  // ④ 不用引 CSS：esm 产物随 JS 注入 <style>（想拆独立 css 文件才引 style.css）
  // transpileDependencies: [],        // ← 默认值，保持不动即可
  configureWebpack: {
    // 只有你自己的业务配置放这里，例如：
    resolve: { alias: { '@': require('path').resolve(__dirname, 'src') } },
  },
})
```

非 vue-cli 的原生 webpack5 宿主，`vue-loader` 用 15.x（Vue 2 对应版本）：

```js
// webpack.config.js（webpack5 + Vue 2.7，非 vue-cli）
const path = require('path')
const { VueLoaderPlugin } = require('vue-loader')   // 必须 vue-loader@15

module.exports = {
  mode: 'production',
  entry: './src/main.js',
  output: { path: path.resolve(__dirname, 'dist'), filename: '[name].[contenthash:8].js' },
  resolve: {
    extensions: ['.js', '.vue', '.json'],
    alias: { '@': path.resolve(__dirname, 'src') },
    // lark-doc 用不到 alias；webpack5 天然读 package.json 的 exports
  },
  module: {
    rules: [
      { test: /\.vue$/, loader: 'vue-loader' },
      {
        test: /\.js$/,
        exclude: /node_modules/,       // lark-doc 在 node_modules 里，不要一起转译
        use: { loader: 'babel-loader' },
      },
      { test: /\.css$/, use: ['style-loader', 'css-loader'] },
    ],
  },
  plugins: [new VueLoaderPlugin()],
  optimization: { splitChunks: { chunks: 'all' } },   // 懒区块自动切分
}
```

```jsonc
// package.json 片段：Vue 2 要求 vue 与 vue-template-compiler 严格同版本
{
  "dependencies": { "vue": "2.7.16", "lark-doc": "^0.11.6" },
  "devDependencies": {
    "vue-template-compiler": "2.7.16",
    "vue-loader": "^15.11.1",
    "@vue/cli-service": "^5.0.8"
  }
}
```

```js
// main.js
import Vue from 'vue'
import App from './App.vue'
// 不需要 import 'lark-doc/style.css' —— ESM 产物随 JS 注入 <style>，
// 再引一份只是多一份重复规则（无害）。若你确实想要独立 CSS 文件，也可以引。
new Vue({ render: (h) => h(App) }).$mount('#app')
```

```vue
<!-- src/views/Doc.vue -->
<template>
  <div ref="host" class="doc-host" />
</template>

<script>
import { LarkDoc } from 'lark-doc'

export default {
  data: () => ({ doc: null }),
  async mounted() {
    const record = await fetch(`/api/doc/${this.$route.params.id}`).then((r) => r.json())
    this.doc = new LarkDoc({
      element: this.$refs.host,
      title: record.title,
      content: record.content,
      toolbarKeys: ['history', 'headings', 'marks', 'insert', 'tables'],
      features: { ai: false },
      uploader: { upload: (file) => this.upload(file) },
      onUpdate: ({ json }) => this.scheduleSave(json),
    })
  },
  beforeDestroy() {
    if (this.doc) { this.doc.destroy(); this.doc = null }
  },
}
</script>

<style scoped>
.doc-host { height: calc(100vh - 60px); }
</style>
```

### 2. Vue 2.7 + Vite {#env-vue2-vite}

**编译工具：不用配 alias**，与 webpack5 同一套（`exports.import` → esm.js）。唯一要装对的是 Vue 2 的 Vite 插件。

```js
// vite.config.js
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue2'      // 官方插件（Vite 3~5 均支持 Vue 2.7）

export default defineConfig({
  plugins: [vue()],
  // 无需 alias / optimizeDeps.include：vite 读 exports，
  // import 'lark-doc' 直接命中 esm 产物，懒区块由 Rollup 自动分割。
  build: {
    // 默认 'modules' 即可；只有要兼容老浏览器时才降 target，
    // 降了要自己补 polyfill（包不假设宿主有原生可选链）
    target: 'modules',
  },
})
```

```js
// 如果用的是社区版插件（二选一，别同时装）
import { defineConfig } from 'vite'
import { createVuePlugin } from 'vite-plugin-vue2'
export default defineConfig({ plugins: [createVuePlugin()] })
```

```jsonc
// package.json 片段
{
  "dependencies": { "vue": "2.7.16", "lark-doc": "^0.11.6" },
  "devDependencies": {
    "vite": "^5.4.0",
    "@vitejs/plugin-vue2": "^2.3.3",
    "vue-template-compiler": "2.7.16"
  }
}
```

::: warning Vite 下 Vue 2.7 的两个硬约束
1. `vue` 与 `vue-template-compiler` **必须同版本**（都是 `2.7.16`），版本错位会在编译模板时报 `Vue packages version mismatch`；
2. 插件要和 Vite 大版本匹配：`@vitejs/plugin-vue2@2.x` 配 Vite 3/4/5，`vite-plugin-vue2@2.x` 只到 Vite 4 左右。装错插件报的错通常是 `Cannot find module 'vite/plugin'`，与 lark-doc 无关。
:::

```vue
<template><div ref="host" style="height:100vh" /></template>
<script>
import { LarkDoc } from 'lark-doc'
export default {
  mounted() {
    this.doc = new LarkDoc({
      element: this.$refs.host,
      content: '<p>hello vite</p>',
      toolbarKeys: ['history', 'headings', 'marks'],
    })
  },
  beforeUnmount() { this.doc && this.doc.destroy() },
}
</script>
```

### 3. Vue 2.7 + webpack4（vue-cli 4） {#env-vue2-wp4}

**0.13 只要一行 alias。** webpack4 不读 `exports`，`resolve.mainFields` 默认 `['browser', 'module', 'main']`；
而 0.13 的 `package.json` **刻意不再有 `browser` 字段**（它一旦存在，webpack4/5 会跳过 ESM 直落
UMD 的「浏览器直挂档」，SSR 与浏览器就吃到两份不同产物了）。于是 webpack4 会落到 `module` →
`esm.js`，而 `esm.js` 里有 `import.meta`，acorn 6.4.2 解析不了。把主入口显式指到 CJS 档即可 ——
**CJS 档和 UMD / element 一样已整体降到 ES2018**，所以不用再挂 babel：

```js
// vue.config.js —— 就这么一处，没有第二处
module.exports = {
  configureWebpack: {
    resolve: { alias: { 'lark-doc$': 'lark-doc/dist/lark-doc.common.js' } },
  },
}
```

```js
// src/main.js
import { LarkDoc } from 'lark-doc'
import 'lark-doc/dist/lark-doc.css' // webpack4 读不到 exports，样式要写全 dist 路径
```

| 你担心的事 | 0.13 的实际情况 |
| --- | --- |
| `Module parse failed` / 不认识 `import.meta` | alias 命中的是 CJS 档，不含 `import.meta`，不会走到 esm 那条路 |
| 不认识 `?.` / `??` | CJS 与 UMD / element 产物已整体降到 ES2018 语法，acorn 6.4.2 能解析 |
| 还要装 babel 插件吗 | 不用，`@babel/plugin-proposal-optional-chaining` 之类可以卸了 |
| 样式怎么进 | 打包器消费（ESM / CJS）都要**显式引样式**；webpack4 下写 `lark-doc/dist/lark-doc.css`（`exports` 读不到） |

**好消息：按需区块的基址不用管了。** `__LARK_DOC_PUBLIC_PATH__` 只服务 UMD / element 那两份
**旁挂懒区块**的产物（公式 / Word 导出 / Mermaid / 代码高亮是运行时按 `document.currentScript`
反推目录去拉的）。webpack 4 现在走的是 CJS 档 —— 它是**单文件、所有区块内联**，压根不发起
懒加载请求，所以不会出现「首屏正常、一插公式就 404」。

只有当你**继续用 UMD / element 档**（`<script src>` 直挂，或被打包器 import）时才需要设：

```js
// src/main.js —— 指向 node_modules/lark-doc/dist 被拷到/托管到的 URL 前缀
window.__LARK_DOC_PUBLIC_PATH__ = '/vendor/lark-doc/'
import 'lark-doc/dist/lark-doc-element.umd.min.js'
```

- 用了 `copy-webpack-plugin` 把 `dist/*.js` 拷到 `public/vendor/lark-doc/`，就填 `/vendor/lark-doc/`；
- 不用公式、不出 Word 的话可以不设，报错时才需要。

::: tip 子路径仍然要写全
`exports` 不支持，所以 `lark-doc/element`、`lark-doc/style.css` 这类**子路径**在 webpack4 下解析不到，得写 `lark-doc/dist/lark-doc-element.umd.min.js`、`lark-doc/dist/lark-doc.css`。主入口 `lark-doc` 不受影响。
:::

> Vue 仍然是 **peer 依赖**：CJS 档里是 `require('vue/dist/vue.runtime.common.js')`，解析到宿主自己的 Vue 2.7，不会打进来第二份 Vue。宿主 Vue 不是 2.7 的话换 `lark-doc/element`（Vue 已内联）。
>
> 进内网的完整搬运步骤（含 `dist/` 怎么拷、nginx 怎么配）见[内网迁移实战 · 方案 A](/guide/intranet-migration#mig-vue2-wp4)。

<details>
<summary>0.12 及更早版本的老写法（alias 到 common.js + babel 降语法）</summary>

> 只在版本锁在 0.12.x 及以下时需要。升级到 0.13 后整段都可以删掉。

**编译工具：两处配置，缺一不可。** 不配就编译不过或白屏：

| 问题 | 现象 | 配置 |
| --- | --- | --- |
| webpack4 不读 `exports`，按 `resolve.mainFields` 落到 `module`（`esm.js`） | `Module parse failed: Unexpected token` —— esm 产物里 katex 字体地址是 `new URL('./fonts/x.woff2', import.meta.url)`，acorn 6.4.2 解析不了 `import.meta` | `alias: { 'lark-doc$': 'lark-doc/dist/lark-doc.common.js' }` 显式指到 `main` |
| lib 产物里仍有 ES2020 语法（`?.` / `??`） | 同上，acorn 6.4.2 不认识 | 给该文件单独挂 babel，只加两个 proposal 插件 |
| webpack4 不读 `exports` | `import 'lark-doc/style.css'` 解析不到 | 写全路径 `lark-doc/dist/lark-doc.css` |
| 同上 | `import 'lark-doc/element'` 报"找不到模块" | 写 `lark-doc/dist/lark-doc-element.umd.min.js`，或 `<script>` 直引 |

```js
// vue.config.js（vue-cli 4）
module.exports = {
  configureWebpack: {
    resolve: {
      alias: {
        // ① 强制命中 main 的 lib 单文件（webpack4 唯一能用的入口）
        'lark-doc$': 'lark-doc/dist/lark-doc.common.js',
      },
    },
  },
  chainWebpack(config) {
    // ② lib 产物含 ?. / ??，webpack4 的 acorn 6.4.2 解析不了，
    //    用 babel-loader 只降级这两个语法。configFile/babelrc 必须关掉，
    //    否则会被项目根 babel.config.js 二次转译，破坏产物模块语义。
    config.module.rules.unshift({
      test: /lark-doc[\\/]dist[\\/]lark-doc(\.common|\.umd\.min)\.js$/,
      use: {
        loader: 'babel-loader',
        options: {
          configFile: false,
          babelrc: false,
          sourceType: 'script',
          compact: false,
          plugins: [
            '@babel/plugin-proposal-optional-chaining',
            '@babel/plugin-proposal-nullish-coalescing-operator',
          ],
        },
      },
    })
    // ③ 规则必须排在默认 js 规则之前才生效（unshift 已保证）
  },
}
```

```bash
npm i -D @babel/plugin-proposal-optional-chaining@7 @babel/plugin-proposal-nullish-coalescing-operator@7
npm i lark-doc          # 版本号锁死就写 npm i lark-doc@<你锁的版本> -E
```

不用 vue-cli 的原生 webpack4 宿主，同一套规则搬到 `webpack.config.js`（**顺序也是 rules 在最前**）：

```js
// webpack.config.js（webpack4 + Vue 2.7，非 vue-cli）
const path = require('path')
const { VueLoaderPlugin } = require('vue-loader')      // webpack4 用 vue-loader@15

module.exports = {
  mode: 'production',
  entry: './src/main.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].[contenthash:8].js',
    publicPath: '/',
    chunkFilename: '[name].[contenthash:8].js',          // 懒区块（公式/图表）靠它命名
  },
  resolve: {
    extensions: ['.js', '.vue', '.json'],
    alias: {
      '@': path.resolve(__dirname, 'src'),
      // ★ 与 vue-cli 版完全等价：强制走 main 的 lib 单文件
      'lark-doc$': 'lark-doc/dist/lark-doc.common.js',
    },
  },
  module: {
    rules: [
      // ① 必须放在最前面（数组前面的规则优先匹配）
      {
        test: /lark-doc[\\/]dist[\\/]lark-doc(\.common|\.umd\.min)\.js$/,
        use: {
          loader: 'babel-loader',
          options: {
            configFile: false,          // 不要读项目根的 babel.config.js
            babelrc: false,
            sourceType: 'script',       // 产物是脚本，不是 ESM
            compact: false,
            plugins: [
              '@babel/plugin-proposal-optional-chaining',
              '@babel/plugin-proposal-nullish-coalescing-operator',
            ],
          },
        },
      },
      { test: /\.vue$/, loader: 'vue-loader' },
      { test: /\.js$/, exclude: /node_modules/, use: { loader: 'babel-loader' } },
      // ② css 走常规链路；lark-doc 的 dist/lark-doc.css 也是从这条进来
      { test: /\.css$/, use: ['style-loader', 'css-loader'] },
    ],
  },
  plugins: [new VueLoaderPlugin()],
  optimization: { splitChunks: { chunks: 'all' } },
}
```

::: tip 判断你的宿主到底是不是 webpack4
`npx webpack --version`（或 `vue-cli-service inspect --version`）。webpack4 的 `webpack --version` 输出 `4.x`；vue-cli 4 内部固定 4.x，vue-cli 5 内部是 5.x。**只有 4.x 需要上面这段配置**，5.x 里加了反而多一层无谓编译。
:::

```vue
<!-- 业务组件 -->
<template>
  <div ref="host" class="doc-host" />
</template>

<script>
// webpack4 走 lib 单文件：样式必须写全 dist 路径
import 'lark-doc/dist/lark-doc.css'
import { LarkDoc } from 'lark-doc'

export default {
  mounted() {
    this.doc = new LarkDoc({
      element: this.$refs.host,
      title: '未命名文档',
      content: this.record,          // 老的 Vditor HTML 也能直接喂，contentFormat: 'auto' 会自动归一化
      contentFormat: 'auto',
      storage: 'none',               // 草稿交给宿主自己管
      toolbarKeys: ['history', 'headings', 'marks', 'textStyle', 'blockStyle', 'insert', 'tables'],
      features: { ai: false, importExport: true },
      uploader: { upload: (file) => this.$forage.upload(file) },
      onUpdate: ({ json }) => this.debouncedSave(json),
    })
  },
  beforeDestroy() {
    if (this.doc) { this.doc.destroy(); this.doc = null }   // 路由切走必须销毁，否则定时器残留
  },
}
</script>
```

::: warning webpack4 的两个历史坑，0.11.2 起已由包侧修掉
1. **内层 runtime 标识符遮蔽**：lib 产物自带一份 webpack runtime，里面有真实外部依赖 `require("vue/dist/vue.runtime.common.js")`；宿主会把它改写成自己的 `__webpack_require__("<id>")`，而 lib 内层恰好也有同名函数 → 查自己的模块表查不到 → `Cannot read properties of undefined (reading 'call')`，白屏。包侧已把内层改名为 `__larkDocRequire__`，**0.11.2 及以上不需要宿主做任何事**。
2. **ESM 产物导出为空**：0.11.0 / 0.11.1 的 `dist/lark-doc.esm.js` 缺 `output.library = { type: 'module' }`，`import { LarkDoc }` 会拿到 `undefined`。0.11.2 已补。

> 在 0.12 及更早版本里，webpack4 依然**必须**用第 ① ② 两处配置走 `main`——ESM 那条路在 webpack4 下照样编译不过（`import.meta` 无解）。0.13 起不需要，直接 `import { LarkDoc } from 'lark-doc'` 即可。
:::

</details>

### 4. Vue 2.7 组件式（直接嵌 SFC） {#env-vue2-sfc}

主入口还导出了 `LarkDocEditor` / `LarkDocWorkspace`，适合"模板里就想要一个编辑器"的场景。注意它是 **`v-model` 语义（`value` + `input`）**，不是 `content`。

**编译工具：与宿主完全相同**（webpack5 / Vite 零配置；webpack4 0.13 起也零配置，见上一节）。组件式**不需要**额外的 loader 或 `transpileDependencies`，因为组件本身就在主入口的产物里。全局注册写法：

```js
// src/main.js
import Vue from 'vue'
import App from './App.vue'
import { LarkDocEditor } from 'lark-doc'
import 'lark-doc/style.css'                    // ← webpack4 写 'lark-doc/dist/lark-doc.css'

Vue.component('LarkDocEditor', LarkDocEditor)  // 注册后才能直接写 <lark-doc-editor>
new Vue({ render: (h) => h(App) }).$mount('#app')
```

组件式**没有 lark-doc 专属编译配置**，只要确认两件已有的东西对齐（这两条走错才是踩坑源头）：

```bash
# ① Vue 2 对应 vue-loader 15.x（Vue 3 才是 17.x）
npm ls vue-loader          # 期望 vue-loader@15.11.x

# ② vue 与 vue-template-compiler 同版本
npm ls vue vue-template-compiler   # 期望两行都是 2.7.16
```

vue-cli 5 宿主的最小 `vue.config.js`：

```js
// vue.config.js（vue-cli 5，组件式）
const { defineConfig } = require('@vue/cli-service')

module.exports = defineConfig({
  // 组件就在 esm 产物里、已按 browserslist 编好，不需要再转译
  // transpileDependencies: [],
  chainWebpack: (config) => {
    // 组件式会引 lark-doc/style.css，里面有 @font-face 指向 dist/fonts/*.woff2（公式字体）。
    // vue-cli 5 默认已按 asset/resource 处理 woff2，这条只是显式写出来、防止被自己的规则覆盖。
    config.module.rule('fonts').test(/\.(woff2?|eot|ttf|otf)(\?.*)?$/i).type('asset/resource')
  },
})
```

非 vue-cli 的 webpack5 宿主，字体这条必须自己写，否则公式字体 404（控制台会看到 `.woff2` 返回 `text/html`）：

```js
// webpack.config.js（非 vue-cli 的 webpack5）—— 只列组件式真正会踩的两处
module.exports = {
  module: {
    rules: [
      { test: /\.vue$/, loader: 'vue-loader' },                    // 组件式必须有
      { test: /\.css$/, use: ['style-loader', 'css-loader'] },     // style.css 要能被吃
      {
        test: /\.(woff2?|eot|ttf|otf)(\?.*)?$/i,
        type: 'asset/resource',                                    // webpack4 用 url-loader
        generator: { filename: 'fonts/[name][ext]' },
      },
    ],
  },
}
```

宿主是 webpack4 时，第 3 节那条针对 `lark-doc/dist/lark-doc.common.js` 的 alias + babel 规则**照样必须存在**——组件式只是换个用法，产物没变；`style.css` 也要改用 `lark-doc/dist/lark-doc.css`，字体交给 `url-loader`。

```vue
<template>
  <lark-doc-editor
    v-model="html"
    :title="title"
    :readonly="readonly"
    :config="editorConfig"
    content-format="auto"
    @ready="onReady"
    @change="onChange"
    @ai-request="onAiRequest"
  />
</template>

<script>
import { LarkDocEditor } from 'lark-doc'
import 'lark-doc/style.css'          // webpack4 宿主改成 lark-doc/dist/lark-doc.css

export default {
  components: { LarkDocEditor },
  data: () => ({
    html: '<p>hello</p>',
    title: '未命名文档',
    readonly: false,
    // config 是内部 createLarkDocConfig 结构，等价于门面的 features/layout/limits/toolbar
    editorConfig: {
      features: { ai: false, folding: true },
      layout: { headerVisible: true, toolbarFixed: true },
      toolbar: { history: true, headings: true, marks: true, insert: true },
      limits: { maxLength: 0 },
    },
  }),
  methods: {
    onReady(editor) { this.editor = editor },
    onChange({ html, json, text }) { this.html = html; this.lastJson = json },
    onAiRequest(action) { /* 接管 AI 动作 */ },
  },
}
</script>
```

| prop | 类型 | 说明 |
| --- | --- | --- |
| `v-model` / `value` | string | HTML 内容双向绑定（**不是 `content`**） |
| `title` | string | 标题，配合 `update:title` |
| `readonly` | boolean | 只读 |
| `config` | object | 内部配置结构（`features` / `layout` / `limits` / `toolbar`） |
| `content-format` | string | `auto` \| `vditor` \| `html` |
| `upload-image` | function | 图片上传钩子（**SFC 里没有 `uploader` 对象**） |
| `templates` / `max-length` / `image-max-size` / `fold-persist-key` | - | 见 [配置总览](/guide/configuration) |

### 5. Vue 3 {#env-vue3}

> Vue 3 宿主**不要**引 `lark-doc` 主入口（Vue 2 渲染层，`Vue.extend` 在 Vue 3 里已移除），要用 `lark-doc/element`（Web Component）。内网做法见[内网迁移实战 · 方案 C](/guide/intranet-migration#mig-vue3-vite)。

**两条 import 就够：**

```js
import 'lark-doc/element'                                     // 元素本体 + 样式（自动注册 <lark-doc>）
import { resolveVue3Attrs } from 'lark-doc/vue3'              // 薄壳：props → 属性、事件名单、漏引报错
```

`lark-doc/vue3` 是 3.0 KiB 的薄壳，不含任何第三方依赖，只做三件事：按属性白名单把 props 序列化成 HTML 属性（未登记的 key 会告警而不是静默失效）、导出 `VUE3_EVENTS` 事件名单、在你忘了 `import 'lark-doc/element'` 时打一条可行动的 error。它**不注册元素**，也不替你做下面的 `isCustomElement`。

**编译工具：告诉 Vue 编译器 `<lark-doc>` 是自定义元素**，否则会报 `Failed to resolve component: lark-doc`。

```js
// vite.config.js（Vue 3）
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [
    vue({
      template: {
        compilerOptions: {
          isCustomElement: (tag) => tag === 'lark-doc',
        },
      },
    }),
  ],
})
```

用 vue-cli 5 + Vue 3（webpack5）时，改的是 `vue-loader` 的 `compilerOptions`：

```js
// vue.config.js（vue-cli 5 + Vue 3）
module.exports = {
  chainWebpack: (config) => {
    config.plugin('vue-loader').tap((args) => {
      const options = args[0] || {}
      options.compilerOptions = Object.assign({}, options.compilerOptions, {
        isCustomElement: (tag) => tag === 'lark-doc',
      })
      args[0] = options
      return args
    })
  },
}
```

::: tip 忘了配 `isCustomElement` 会怎样
开发期控制台刷 `Failed to resolve component: lark-doc`。Vue 3 对解析失败的标签一般仍按原生元素输出，所以自定义元素有可能照常升级、功能看起来是好的 —— 但这是靠运行期兜底，别依赖：SSR 场景会报水合不匹配，属性透传也不再受控。**按上面的配置显式声明才是正解。**
:::

```vue
<template>
  <lark-doc ref="el" v-bind="attrs" />
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import 'lark-doc/element'                          // 元素本体，自动注册 <lark-doc>，样式随产物注入
import { resolveVue3Attrs } from 'lark-doc/vue3'   // props → 属性（白名单序列化，拼错会告警）

const props = { title: '会议纪要', theme: 'light', toolbarKeys: 'history,headings,marks,insert' }
const attrs = computed(() => resolveVue3Attrs(props))

const el = ref(null)
onMounted(() => {
  // 对象型能力（uploader / ai / persistence）写不进 HTML 属性，用 options 注入
  el.value.options = {
    uploader: { upload: async (file) => (await upload(file)).url },
    ai: { enabled: false },
  }
  el.value.addEventListener('lark-doc-change', (e) => console.log(e.detail.payload.json))
})
onBeforeUnmount(() => el.value && el.value.destroy())
</script>
```

::: tip options 的时序
`options` 赋值会**重建实例**（运行时内容回到初始值），所以要在意保留现场就先 `getJSON()`。`connectedCallback` 延迟一个宏任务，命令式调用请等 `lark-doc-ready` 事件。
:::

### 6. React 18 {#env-react}

**编译工具：CRA（`react-scripts@5`）零配置**，它内部是 webpack5，读 `exports`；Vite 也只要装 React 插件。只有 TSX 里想直接写 `<lark-doc>` 才需要补类型声明。

**三种写法，按需挑一个：**

| 写法 | 适合 | 要点 |
| --- | --- | --- |
| `mountLarkDoc(el, opts)` | 大多数场景（推荐） | 命令式拿门面实例，`options` 里对象型配置随便写，没有属性序列化的限制 |
| `createReactLarkDoc(React)`（薄壳，4.2 KiB） | 想要 `<LarkDoc onChange={fn} />` 这种声明式写法 | props → 属性白名单、`onChange/onSave/onReady/onError` 转成元素事件、ref 透传方法 |
| 直接写 `<lark-doc>` 标签 | 属性全是字符串、事件用 `addEventListener` | 需补 `.d.ts`；对象型配置要靠 `el.options` 赋值 |

```jsonc
// package.json 片段：CRA 5（webpack5）—— 没有任何 lark-doc 专属配置
{
  "dependencies": { "lark-doc": "^0.11.6", "react": "^18.3.1", "react-dom": "^18.3.1" },
  "devDependencies": { "react-scripts": "^5.0.1" }
}
```

```js
// vite.config.js（React + Vite）
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // 无需 optimizeDeps.include / alias：vite 读 exports，按需区块自动分割
})
```

```ts
// src/lark-doc.d.ts —— 只在 TSX 里直接写 <lark-doc> 标签时需要
import type { DetailedHTMLProps, HTMLAttributes } from 'react'

// 元素实例：门面常用方法已代理到元素上，不必先 getInstance()
export interface LarkDocElementHost extends HTMLElement {
  ready: boolean
  /** 门面实例（需要全量 API 时用它） */
  document: unknown
  /** 对象型能力入口；赋值会重建实例 */
  options: Record<string, unknown>
  getInstance(): unknown
  getEditor(): unknown
  getHTML(): string
  getJSON(): unknown
  getText(): string
  getTitle(): string
  setTitle(title: string): void
  setContent(content: string | object): void
  setReadonly(readonly: boolean): void
  focus(): void
  undo(): void
  redo(): void
  save(): void
  destroy(): void
}

// 属性表与 src/web-component/attributes.js 一一对应，别自己发明
type LarkDocAttributes = {
  title?: string
  content?: string
  'content-format'?: 'auto' | 'vditor' | 'html'
  placeholder?: string
  theme?: 'light' | 'dark'
  readonly?: boolean | ''
  'save-html'?: boolean | ''
  autofocus?: boolean | ''
  storage?: 'none' | 'local'
  mode?: string
  'document-id'?: string
  'toolbar-keys'?: string          // 逗号分隔，如 "history,headings,marks"
  'toolbar-excludes'?: string
  'max-length'?: number
  /** json 型属性只能写字符串；对象请用 ref + el.options 注入 */
  features?: string
  limits?: string
  layout?: string
  network?: string
}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      'lark-doc': DetailedHTMLProps<HTMLAttributes<LarkDocElementHost>, LarkDocElementHost> &
        LarkDocAttributes
    }
  }
}
```

::: tip CRA 为什么不用 `customize-cra`
`react-scripts@5` 已是 webpack5，`import 'lark-doc/element'` 能正常解析；只有 `react-scripts@4`（webpack4）才需要 eject 或多加一层 alias，那种宿主建议直接升到 5 —— 比在 CRA 里打 webpack4 补丁便宜得多。
:::

React 侧更推荐 `mountLarkDoc`（命令式，直接拿门面实例，绕开自定义元素的属性/对象限制）：

```jsx
import { useEffect, useRef } from 'react'
import { mountLarkDoc } from 'lark-doc/element'   // 同时完成 <lark-doc> 注册与样式注入

export default function DocEditor({ record, onSave }) {
  const hostRef = useRef(null)
  const docRef = useRef(null)

  useEffect(() => {
    const doc = mountLarkDoc(hostRef.current, {
      title: record.title,
      content: record.content,          // HTML / Tiptap JSON / DocumentRecord
      placeholder: '输入正文，或输入 / 插入内容',
      toolbarKeys: ['history', 'headings', 'marks', 'insert', 'tables'],
      features: { ai: false },
      uploader: { upload: (file) => uploadToOss(file) },
      onUpdate: ({ json }) => onSave(json),
      onError: (err) => console.error('[lark-doc]', err),
    })
    docRef.current = doc
    return () => { doc.destroy(); docRef.current = null }   // 卸载必须销毁
  }, [])                               // 依赖留空：文档身份变化请用 setContent 而不是重建

  return <div ref={hostRef} style={{ height: '100vh' }} />
}
```

想用标签写法也行（React 18 对未知属性能正常透传，事件用 `addEventListener`）：

```jsx
import 'lark-doc/element'
export default function Doc() {
  return <lark-doc title="未命名文档" theme="light" />
}
```

要用声明式组件但又不想手写属性/事件桥接，用薄壳工厂（`lark-doc` 源码零 React 依赖，React 实例由宿主传入）：

```jsx
import 'lark-doc/element'                              // 元素本体，必须最先引
import { createReactLarkDoc } from 'lark-doc/react'

const LarkDoc = createReactLarkDoc(React)              // 在模块级建一次，别放进组件体

export default function DocEditor({ record, onSave }) {
  const docRef = useRef(null)
  return (
    <LarkDoc
      ref={docRef}
      title={record.title}
      content={record.content}
      contentFormat="html"
      onChange={(payload) => onSave(payload.json)}      // 事件名已桥接，不用手写 addEventListener
    />
  )
}
```

### 7. 原生 / CDN / 内网静态托管 {#env-static}

**编译工具：不用配，但 `dist/` 必须整目录部署**（主文件 + `*.math.js`、`*.mermaid.js` 等按需区块 + `fonts/`）。`publicPath: 'auto'` 按 `<script>` 自身 URL 推导区块地址，放在任意子目录都成立。

```bash
# ① 从 node_modules 里把整目录拷进静态资源目录（CDN / 内网 nginx / 后端 public）
mkdir -p public/vendor/lark-doc
cp -r node_modules/lark-doc/dist/* public/vendor/lark-doc/
#   dist 里至少要有：lark-doc-element.umd.min.js、*.math.js / *.mermaid.js 等懒区块、fonts/
#   漏掉懒区块 → 公式 / 图表 / Word 导入 404，但编辑器本身能打开

# ② 只想要单文件离线副本时（不装 npm 包）
npm pack lark-doc && tar -xzf lark-doc-*.tgz && cp -r package/dist/* public/vendor/lark-doc/
```

```js
// vite 宿主：把上面拷好的目录当静态资源，publicDir 内的文件原样输出
export default {
  publicDir: 'public',       // public/vendor/lark-doc/... → 站点根 /vendor/lark-doc/...
}
```

```nginx
# nginx / 内网静态服务器：确认 .js 与字体都按静态文件返回，别把 .woff2 当 404
location /vendor/lark-doc/ {
  alias /srv/static/vendor/lark-doc/;
  types {
    application/javascript js;
    font/woff2              woff2;
  }
  add_header Cache-Control "public, max-age=31536000, immutable";
}
```

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <!-- 产物自带 Vue 运行时与样式，不需要再引 css -->
  <script src="/vendor/lark-doc/lark-doc-element.umd.min.js"></script>
</head>
<body>
  <lark-doc
    title="会议纪要"
    theme="light"
    toolbar-keys="history,headings,marks,insert,tables"
    features='{"ai":false,"folding":true}'
  >
    <h1>标签内的 HTML 会成为初始内容</h1>
    <p>长正文直接写在这里，不必往属性里塞转义字符串。</p>
  </lark-doc>

  <script>
    const el = document.querySelector('lark-doc')
    el.options = { uploader: { upload: (file) => uploadToOss(file) } }
    el.addEventListener('lark-doc-ready', () => {
      console.log('ready', el.getJSON())
    })
    el.addEventListener('lark-doc-change', (event) => {
      localStorage.setItem('draft', JSON.stringify(event.detail.payload.json))
    })
  </script>
</body>
</html>
```

| 常见故障 | 原因 | 处理 |
| --- | --- | --- |
| 编辑器能开，插公式 / 图表 / 导出 Word 报 404 | 只拷了主文件 | 整个 `dist/` 目录同位部署 |
| 想复用站点自己的 mermaid | 内置副本被加载 | 挂载前置 `window.mermaid`，或设 `options.performance.diagramScriptUrl` |
| 页面 unload 报错 | 没销毁 | 离开前调 `el.destroy()` |

### 8. Node / jsdom（单测、服务端渲染 HTML 快照） {#env-node}

`require('lark-doc')` 命中 `main` 的 lib 单文件，按需区块全部内联（mermaid 会真执行，所以单测里尽量别插图表）。CSS 不用引。

**编译工具：测试运行器默认 `node` 环境跑不了编辑器**，换成 jsdom 即可，产物本身不用转译（`main` 是 CJS）：

```js
// babel.config.js —— 只为把你自己 src/ 里的 ESM 压成 jest 能吃的 node 语法
// lark-doc 是 CJS，不需要过 babel，所以不用去 transformIgnorePatterns 里开白名单
module.exports = {
  presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
}
```

```js
// jest.config.js
module.exports = {
  testEnvironment: 'jsdom',                 // Jest 28+ 需另装 jest-environment-jsdom
  // 不需要 transformIgnorePatterns 白名单：main 是 CJS，jest 直接 require 即可；
  // 若你的项目全局设了 ESM（"type":"module"），给本包单独留 CJS 例外即可。
  setupFiles: ['<rootDir>/test/bootstrap.js'],   // 补 customElements / ResizeObserver 等
  testTimeout: 20000,                       // 首次挂载要初始化 Tiptap，别用默认 5s
}
```

```js
// vitest.config.js（Vite 项目里的等价写法）
import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/bootstrap.js'],
    server: { deps: { inline: ['lark-doc'] } },   // 让 lark-doc 走 node 侧 require 而不是外部化
  },
})
```

```js
// test/bootstrap.js —— 只补 jsdom 缺的东西，不要自己再造一个 JSDOM
// （testEnvironment 已经是 jsdom，再造一份会出现两套 window，坑自己）
if (!global.ResizeObserver) {
  global.ResizeObserver = class {
    observe() {} unobserve() {} disconnect() {}
  }
}
if (!window.matchMedia) {
  window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {} })
}
// 只有单测里要用 lark-doc/element（自定义元素）时才需要 customElements：
// 用主入口的 LarkDoc 门面不需要它，别为此绕路。
if (typeof HTMLElement !== 'undefined' && !global.customElements) {
  global.customElements = {
    _m: new Map(),
    define(n, c) { this._m.set(n, c) },
    get(n) { return this._m.get(n) },
    whenDefined(n) { return Promise.resolve(this._m.get(n)) },
    upgrade() {},
  }
}
```

```js
// test/lark-doc.test.js
const { LarkDoc } = require('lark-doc')

test('round trip', async () => {
  document.body.innerHTML = '<div id="host"></div>'
  const doc = new LarkDoc({
    element: document.getElementById('host'),
    content: '<p>hi</p>',
    storage: 'none',          // 单测别写本地草稿
    network: { mode: 'offline' },   // 不发起任何外网请求
  })
  expect(doc.getHTML()).toContain('<p>hi</p>')
  doc.destroy()
})
```

::: tip 为什么单测要关 network
默认 `network.mode = 'open'`，粘贴外链图片 / 加载 mermaid 会走真实请求，CI 里既慢又偶发失败。直接设 `'offline'` 最省心（该模式下外链图片降级为占位，公式仍本地渲染）。另外 `storage` 默认已是 `'local'`，单测必须显式写 `'none'`（或 `test/setup` 里清 `localStorage` / `indexedDB`），否则用例之间会互相串草稿。
:::

### 9. SSR（Nuxt 2 / Next 13 App Router） {#env-ssr}

element 产物**在模块求值时就会 `customElements.define` 并注入 `<style>`**，Node 端直接 `import` 会炸，必须 client-only。

::: danger Nuxt 2 是 webpack 4，`import('lark-doc/element')` 会失败
Nuxt 2 内部固定 webpack4，**不读 `exports`** → 报 `Cannot find module 'lark-doc/element'`。要么写全 `lark-doc/dist/lark-doc-element.umd.min.js`，要么干脆走 `<script>` 直引（最省事、不经过 bundler）。Nuxt 3 用 Vite，`lark-doc/element` 可以直接写。
:::

```js
// nuxt.config.js（Nuxt 2）—— 走 static 直引，最稳
export default {
  // ① 把 node_modules/lark-doc/dist 整目录拷进 static/
  //    cp -r node_modules/lark-doc/dist static/lark-doc
  head: {
    script: [{ src: '/lark-doc/lark-doc-element.umd.min.js', defer: true }],
  },
  // ② 若坚持走 bundler 动态导入，则必须指全产物路径 + 让 babel 处理 ?. / ??
  build: {
    transpile: ['lark-doc'],
    extend(config) {
      config.resolve.alias['lark-doc$'] = 'lark-doc/dist/lark-doc.common.js'
    },
  },
}
```

```js
// plugins/lark-doc.client.js（.client 后缀 = 只在浏览器加载）
export default async function () {
  if (typeof customElements === 'undefined') return      // 双保险：SSR 阶段直接跳过
  if (!customElements.get('lark-doc')) {
    // Nuxt 2 必须写全 dist 路径；Nuxt 3 可写 'lark-doc/element'
    await import('lark-doc/dist/lark-doc-element.umd.min.js')
  }
}
```

```js
// next.config.js（Next 13）—— 通常一个字都不用改
/** @type {import('next').NextConfig} */
module.exports = {
  // 只有用 turbopack dev 且遇到自定义元素解析问题时才需要显式排除
  // experimental: { turbo: { resolveAlias: { 'lark-doc': 'lark-doc' } } },
}
```

```vue
<!-- Nuxt 2 页面：只在客户端挂载 -->
<template>
  <div ref="host" style="height: 100vh" />
</template>

<script>
export default {
  mounted() {
    // UMD 全局名带横线（output.library = 'lark-doc-element'），只能按字符串取
    const { mountLarkDoc } = window['lark-doc-element'] || {}
    if (!mountLarkDoc) return console.error('[lark-doc] UMD 未加载')
    this.doc = mountLarkDoc(this.$refs.host, {
      title: '未命名文档',
      content: '<p></p>',
      toolbarKeys: ['history', 'headings', 'marks', 'insert'],
    })
  },
  beforeDestroy() { this.doc && this.doc.destroy() },
}
</script>
```

```tsx
// Next 13 App Router
'use client'                                    // 整个文件只在客户端执行
import { useEffect, useRef } from 'react'
import { mountLarkDoc } from 'lark-doc/element'

export default function Editor() {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const doc = mountLarkDoc(host.current!, { title: '未命名文档', content: '<p></p>' })
    return () => doc.destroy()
  }, [])
  return <div ref={host} style={{ height: '100vh' }} />
}
```

```ts
// Next 12（Pages Router）：动态导入关掉 SSR
import dynamic from 'next/dynamic'
const Editor = dynamic(() => import('../components/Editor'), { ssr: false })
```

::: warning SSR 只想要 HTML 时
用 `require('lark-doc')` 的 CJS 单文件在 Node 侧跑一次 `getHTML()` 做快照即可，别在服务端引 element 产物。
:::

## 排错对照 {#env-troubleshoot}

| 报错 / 现象 | 大概率原因 | 处理 |
| --- | --- | --- |
| `Module parse failed: Unexpected token` + `import.meta.url` | webpack4 落到了 esm.js（0.13 起没有 `browser` 字段兜底） | 加一行 `alias: { 'lark-doc$': 'lark-doc/dist/lark-doc.common.js' }`（CJS 档已降到 ES2018，不用再挂 babel） |
| `Cannot read properties of undefined (reading 'call')`（白屏） | 0.11.1 及以下的 lib 内层 runtime 被遮蔽 | 升级到 `lark-doc@^0.11.2` |
| `LarkDoc` is `undefined`（`import { LarkDoc }`） | 0.11.1 及以下的 ESM 产物缺 `library.type` | 同上，升级到 `^0.11.2` |
| `Failed to resolve component: lark-doc` | 框架把标签当自家组件 | Vue 3 配 `isCustomElement`；Vue 2 用 `Vue.config.ignoredElements` |
| `[lark-doc] <lark-doc> 尚未注册` | 引了 `lark-doc/vue3` / `lark-doc/react` 薄壳，但漏了 `import 'lark-doc/element'` | 宿主入口最先 `import 'lark-doc/element'`（薄壳只桥接，元素本体在 element 入口） |
| `Cannot find module 'lark-doc/element'` | webpack4 不读 `exports`（vue-cli 4、**Nuxt 2**） | 写 `lark-doc/dist/lark-doc-element.umd.min.js`，或 `<script>` 直引 |
| 插公式 / 导出 Word 无反应，Network 里 `*.math.js` / `*.office.js` 404 | 走打包器 `import` 时按需区块基址被算成宿主目录（`document.currentScript` 指向宿主 bundle） | `window.__LARK_DOC_PUBLIC_PATH__ = '/vendor/lark-doc/'`，放在引包之前 |
| `Vue packages version mismatch` | `vue` 与 `vue-template-compiler` 版本不一致 | 两者锁同一版本（如都 `2.7.16`） |
| `Cannot find module 'vite/plugin'` / 插件报内部错误 | Vue 2 的 Vite 插件与 Vite 大版本不匹配 | `@vitejs/plugin-vue2@2.x` 配 Vite 3~5；社区版 `vite-plugin-vue2` 只到 Vite 4 |
| `Property 'lark-doc' does not exist on type 'JSX.IntrinsicElements'` | TSX 里直接写自定义元素标签，缺类型声明 | 补 `JSX.IntrinsicElements` 声明（见第 6 节） |
| 单测 `Exceeded timeout of 5000 ms` | 首次挂载要初始化 Tiptap / 加载区块 | `testTimeout: 20000`，并把 `testEnvironment` 设为 `jsdom` |
| `Failed to execute 'define' ... has already been used` | 同一页引了两次 element 产物（UMD + 打包各一份） | 只保留一处引入；打包版靠 `customElements.get()` 判重 |
| 字体 404 或 `.woff2` 返回 `text/html` | 静态服务器 MIME / 目录没覆盖 `fonts/`；或打包时没给 woff2 配 asset 规则 | 打包侧见第 4 节的 `asset/resource`；部署侧拷 `dist/` 整目录并确认 `font/woff2`（见第 7 节 nginx 片段） |
| 样式全丢 | 漏引 CSS，或用的是 0.12 及更早的 CJS/lib 产物（那时不注入样式） | 0.13 起 UMD / element 产物自带样式注入；lib 单文件宿主仍需引 `lark-doc/dist/lark-doc.css`（webpack5 可写 `lark-doc/style.css`） |
| 公式 / 图表 404 | 只部署了主文件，或按需区块基址算错 | `dist/` 整目录同位托管；打包器 import 的场景设 `__LARK_DOC_PUBLIC_PATH__` |
| SSR 报 `customElements is not defined` | 服务端引了 element 产物 | client-only 动态 `import()` |
| 页面切换后卡顿 / 定时器警告 | 没销毁实例 | 卸载钩子里 `doc.destroy()` |
| `Cannot find module 'vue/dist/vue.runtime.common.js'` | 宿主 Vue 版本不是 2.7 或装的是仅 runtime 的别名 | 主入口要求 `vue ^2.7.14` peer；非 Vue 2.7 宿主改用 `lark-doc/element` |

## 下一步

- [内网迁移实战](/guide/intranet-migration)：webpack4 / webpack5 / Vue3+Vite 三套宿主从联网机搬进内网的分步操作
- [打包产物与按需加载](/guide/build-artifacts)：四份产物分别给谁用、`dist/` 里哪些文件必须部署
- [配置总览](/guide/configuration)：全部配置项与默认值
- [工具栏配置](/guide/toolbar)：12 个分组 + 8 个 mark + 别名全表
- [Web Component（跨框架）](/guide/web-component)：属性、事件、方法与生命周期
