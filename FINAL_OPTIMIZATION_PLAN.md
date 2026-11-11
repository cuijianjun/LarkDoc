# lark-doc 最终优化方案

> 基于 `master` 分支制定。本文只描述最终架构、接入方式、懒加载策略、构建优化和实施顺序，不代表本分支已经完成全部代码改造。
>
> 基线：`master`，HEAD `033e9cd`，版本 `0.14.1`。  
> 工作分支：`docs/final-optimization-plan`。  
> 目标：在不改变用户安装习惯的前提下，统一 API，降低应用首屏加载、应用打包体积、冷启动编译时间和重复构建时间，同时保持 Node 14、Vue 2 + Webpack 4、Vue 3、React、原生 DOM、Web Component 和 SSR 客户端接入能力。

---

## 1. 最终结论

lark-doc 采用以下总原则：

> **一次安装、一个默认 API、一套配置对象、多入口分发、宿主控制页面懒加载、lark-doc 控制功能懒加载。**

最终推荐使用方式固定为：

```bash
npm install lark-doc
```

```js
import { LarkDoc } from 'lark-doc'
import 'lark-doc/style.css'

const editor = new LarkDoc({
  element,
  content,
  readonly: false,
})
```

不采用以下形式作为最终 API：

```js
import { createLarkDoc } from 'lark-doc'
createLarkDoc(element, options)
LarkDoc(element, options)
```

### 1.1 API 规则

| 项目 | 最终规则 |
| --- | --- |
| 安装 | 所有构建型环境统一 `npm install lark-doc` |
| 默认入口 | `import { LarkDoc } from 'lark-doc'` |
| 初始化 | `new LarkDoc(options)` |
| 入参 | 一个配置对象，必须包含 `element` |
| 返回值 | 有生命周期的编辑器实例 |
| 销毁 | `editor.destroy()` |
| 框架差异 | 由宿主生命周期和可选薄适配器处理，不改变核心 API |
| `createLarkDoc` | 从最终公开 API 删除，不再作为兼容导出 |
| `new LarkDoc(element, options)` | 不支持 |

`LarkDoc` 是 class，不是工厂函数。内部直接使用当前门面已有的初始化逻辑：解析 element、归一化配置、创建 renderer、挂载 Workspace、连接事件和 provider。

---

## 2. master 当前事实与目标差异

### 2.1 master 已经具备的基础

master 当前的 `src/LarkDoc.js` 已经是命令式 class：

```js
export class LarkDoc {
  constructor(options = {}) {
    // 通过 options.element 挂载
  }
}
```

当前门面已经具备：

- 原生 DOM renderer 接缝：`src/mount/`；
- 框架无关的 `LarkDoc` 实例门面；
- `content`、`readonly`、`theme`、`storage`、`providers`、`features` 等配置入口；
- Math、Mermaid、Office、Markdown、Highlight 等动态 import 基础；
- `esm`、`commonjs`、`element`、`lite`、`features/*`、`collab`、Vue 3、React 等构建入口或产物规划；
- `ensure-artifacts.mjs` 的构建输入指纹和产物复用机制；
- 构建缓存按 Node 版本、target、legacy、lite 等口径隔离。

### 2.2 master 仍需收口的部分

当前 `src/index.js` 仍同时导出：

- `LarkDoc`；
- `createLarkDoc`；
- 模板库；
- 文档操作；
- Mock AI；
- migrations；
- comments；
- versioning；
- providers；
- 其他内部数据层对象。

这会造成两个问题：

1. 对外出现两套初始化语义；
2. 默认入口静态依赖图过大，宿主只使用编辑器时仍可能携带低频能力。

最终要做的是：

- 保留 `class LarkDoc`，删除公开 `createLarkDoc`；
- 默认入口只导出稳定核心 API 和必要基础工具；
- 低频能力迁移到子路径；
- 保持已有内部模块可以继续被测试和特性入口使用，但不再全部挂到默认入口。

---

## 3. 统一配置对象

默认配置保持顶层兼容，避免为了优化架构强制改变已有业务配置：

```js
const editor = new LarkDoc({
  element: document.querySelector('#editor'),
  content: '<p>Hello</p>',
  readonly: false,
  placeholder: '开始编辑',
  autofocus: false,
  theme: 'light',
  storage: 'local',

  // 工具栏
  toolbarKeys: ['undo', 'redo', 'bold', 'italic', 'heading'],
  toolbarExcludes: [],

  // 能力开关
  features: {
    math: true,
    mermaid: false,
    office: false,
    highlight: true,
  },

  // 业务接入
  uploader: uploadFile,
  persistence: documentPersistence,
  providers: {
    storage: saveDocument,
    ai: generateText,
  },
})
```

配置语义固定为：

| 配置区域 | 责任 |
| --- | --- |
| `element` | 挂载节点或选择器 |
| `content` | 初始 HTML、Tiptap JSON 或文档信封 |
| `readonly` | 编辑/只读状态 |
| `toolbarKeys` / `toolbarExcludes` | 工具栏显示控制 |
| `features` | 功能启用和功能策略 |
| `providers` | AI、存储、协同、权限等业务服务 |
| `uploader` / `persistence` | 文件上传和持久化适配 |
| `theme` | 编辑器主题和宿主主题联动 |
| `storage` / `autosave` | 本地草稿与自动保存策略 |

Vue、React、原生 DOM 只改变 `element` 的获取方式，不改变配置对象和实例方法。

实例 API 统一为：

```js
editor.on('change', handler)
editor.off('change', handler)
editor.getJSON()
editor.setJSON(json)
editor.getHTML()
editor.setContent(content)
editor.focus()
editor.blur()
editor.isReadonly()
editor.setReadonly(true)
editor.save()
editor.destroy()
```

---

## 4. 多入口分发设计

多入口借鉴 ECharts 的按能力分发，但不复制 ECharts 的图表注册模型；借鉴 AiEditor 的框架无关核心、原生 DOM UI 和统一实例配置。

### 4.1 推荐入口

```text
lark-doc
├── lark-doc                  默认构建入口，导出 class LarkDoc
├── lark-doc/lite             不含低频重依赖的轻量入口，同样导出 LarkDoc
├── lark-doc/features/math    公式能力包
├── lark-doc/features/mermaid Mermaid 能力包
├── lark-doc/features/office  Office/Word 能力包
├── lark-doc/features/markdown Markdown 能力包
├── lark-doc/features/highlight 代码高亮能力包
├── lark-doc/collab           协同能力
├── lark-doc/element          Web Component / CDN 入口
├── lark-doc/vue3             可选 Vue 3 薄适配器
├── lark-doc/react            可选 React 薄适配器
└── lark-doc/style.css        唯一样式入口
```

### 4.2 入口责任

| 入口 | 面向用户 | 是否默认加载低频能力 | 说明 |
| --- | --- | --- | --- |
| `lark-doc` | 普通 npm 项目 | 按当前默认能力 | 最简单的推荐入口 |
| `lark-doc/lite` | 对首屏和体积敏感的项目 | 否 | 配合 feature 包按需恢复能力 |
| `lark-doc/features/*` | 宿主或动态 loader | 仅加载指定能力 | 不重复初始化编辑器 |
| `lark-doc/element` | 原生 HTML、CDN | 包含可直挂运行时 | 不要求宿主构建工具 |
| `lark-doc/collab` | 协同场景 | 否 | 独立加载协同依赖 |
| `lark-doc/vue3` / `react` | 需要标签式组件的项目 | 仅薄适配层 | 不重新实现编辑器 |

原则是：

> **不同入口可以有不同构建产物，但默认导出名称、配置语义和实例 API 必须一致。**

### 4.3 package exports 目标

```json
{
  "main": "./dist/lark-doc.common.js",
  "module": "./dist/lark-doc.esm.js",
  "unpkg": "./dist/lark-doc-element.umd.min.js",
  "jsdelivr": "./dist/lark-doc-element.umd.min.js",
  "exports": {
    ".": {
      "import": "./dist/lark-doc.esm.js",
      "require": "./dist/lark-doc.common.js",
      "default": "./dist/lark-doc.common.js"
    },
    "./lite": "./dist/lark-doc-lite.esm.js",
    "./features/*": "./dist/features/*.js",
    "./collab": "./dist/lark-doc-collab.esm.js",
    "./element": "./dist/lark-doc-element.umd.min.js",
    "./vue3": "./dist/lark-doc-vue3.mjs",
    "./react": "./dist/lark-doc-react.mjs",
    "./style.css": "./dist/lark-doc.css"
  }
}
```

实际落地时需继续通过 `check-package-exports.js` 验证 Node 14、Webpack 4 和现代 bundler 的解析行为，不能只依据现代 `exports` 规范推断兼容性。

---

## 5. 三层懒加载模型

懒加载必须拆成三层，不能把宿主首屏策略和包内部功能策略混为一谈。

### 5.1 第一层：应用页面懒加载（宿主负责）

lark-doc 无法决定业务首页是否加载编辑器。宿主如果在 `main.js`、`App.vue` 或公共 Layout 静态导入，编辑器必然进入首屏依赖图。

正确做法是编辑器页面异步化。

#### Vue 2 + Webpack 4

```js
const EditorPage = () => import('./views/EditorPage.vue')
```

```vue
<script>
import { LarkDoc } from 'lark-doc'
import 'lark-doc/style.css'

export default {
  mounted() {
    this.editor = new LarkDoc({
      element: this.$refs.editor,
      content: this.content,
      readonly: false,
    })
  },
  beforeDestroy() {
    if (this.editor) this.editor.destroy()
  },
}
</script>

<template>
  <div ref="editor" />
</template>
```

Vue CLI 项目应关闭编辑器页面的无条件预取：

```js
// vue.config.js
chainWebpack(config) {
  config.plugins.delete('prefetch')
  config.plugins.delete('preload')
}
```

#### Vue 3 + Vite

```js
const EditorPage = () => import('./views/EditorPage.vue')
```

页面内部仍然：

```js
import { LarkDoc } from 'lark-doc'
```

#### React

```js
const EditorPage = React.lazy(() => import('./EditorPage'))
```

页面组件内部创建：

```js
const editor = new LarkDoc({
  element: containerRef.current,
})
```

#### 原生浏览器 / Web Component

```js
document.querySelector('#open-editor').addEventListener('click', async () => {
  await import('/vendor/lark-doc-element.umd.min.js')
  const element = document.createElement('lark-doc')
  document.querySelector('#editor-container').appendChild(element)
})
```

宿主负责：

- 路由和页面是否异步；
- 首屏是否预加载；
- loading、error、重试；
- 权限和业务条件；
- 缓存与资源部署；
- 是否在 hover、点击前或空闲时 preload。

lark-doc 负责提供稳定、可被动态导入的入口，以及不会因为默认导出适配器而强制拉入 Vue 的运行时。

### 5.2 第二层：编辑器功能懒加载（lark-doc 负责）

低频能力按用户行为加载：

```text
进入编辑器
  ↓
加载核心编辑器和基础 UI
  ↓
用户插入公式
  ↓
加载 math feature 与 KaTeX
  ↓
用户插入 Mermaid
  ↓
加载 mermaid feature
  ↓
用户导入 Word / 导出 docx
  ↓
加载 office feature 与 mammoth/docx
```

宿主显式加载：

```js
const { MathFeature } = await import('lark-doc/features/math')
const { MermaidFeature } = await import('lark-doc/features/mermaid')
```

也可以由编辑器内部根据功能调用自动触发，但必须通过统一 feature registry 管理状态，避免同一能力重复加载。

### 5.3 第三层：第三方依赖懒加载（feature 内部负责）

feature 入口内部继续拆第三方库：

```js
const katex = await import('katex')
const mermaid = await import('lark-doc/mermaid-vendor')
const mammoth = await import('mammoth/mammoth.browser')
const docx = await import('docx')
```

这样用户只打开编辑器时不会下载 Mermaid、KaTeX、Mammoth、docx 和全部高亮语言包。

### 5.4 preload 只提供能力，不强制策略

宿主可以自己缓存动态 import：

```js
let editorPagePromise

export function preloadEditorPage() {
  if (!editorPagePromise) {
    editorPagePromise = import('./views/EditorPage.vue')
  }
  return editorPagePromise
}
```

推荐触发时机：

- 用户 hover “新建文档”；
- 用户打开编辑器菜单后、真正跳转前；
- 用户权限确认后；
- 网络状况允许且浏览器空闲时。

不建议应用首屏无条件 preload 编辑器，否则只是把“首屏加载”改成“首屏预加载”。

---

## 6. 产物体积优化

优化目标不是让所有文件都小，而是让**首屏必须下载的文件最小**，低频能力独立且可缓存。

### 6.1 产物分层

```text
dist/
├── lark-doc.esm.js                 现代 bundler 入口
├── lark-doc.common.js              Webpack 4 / CommonJS 入口
├── lark-doc-element.umd.min.js     CDN / Web Component 直挂入口
├── lark-doc-lite.esm.js            轻量入口
├── features/
│   ├── math.js
│   ├── mermaid.js
│   ├── office.js
│   ├── markdown.js
│   └── highlight.js
├── lark-doc-collab.esm.js
├── lark-doc-vue3.mjs
├── lark-doc-react.mjs
└── lark-doc.css
```

### 6.2 默认入口减负

默认入口只保留：

```js
export { LarkDoc }
export default LarkDoc
```

必要时再保留少量基础类型和配置工具。以下内容不再从默认入口静态导出：

- 模板库；
- comments；
- versioning；
- migrations；
- Mock AI；
- providers 全量集合；
- 文档转换和导入导出工具；
- 协同实现。

迁移为：

```text
lark-doc/templates
lark-doc/comments
lark-doc/versioning
lark-doc/providers
lark-doc/collab
lark-doc/features/*
```

删除 `createLarkDoc` 本身对体积帮助有限，真正的收益来自减少默认入口静态依赖图。

### 6.3 sideEffects 收窄

目标是只标记真实副作用入口：

```json
{
  "sideEffects": [
    "**/*.css",
    "**/*.scss"
  ]
}
```

不应把整个 `dist/*` 标为副作用，否则宿主 bundler 会放弃大量 Tree Shaking。所有 CSS 必须通过明确入口引入：

```js
import 'lark-doc/style.css'
```

若后续源码副作用审计完成，可进一步评估：

```json
{
  "sideEffects": false
}
```

但 CSS、Web Component 注册和 feature 自动注册必须先单独处理，不能直接粗暴改成 `false`。

### 6.4 CJS 不能强制单文件

当前 master 的构建配置已经采用 CommonJS `require` 加载异步兄弟 chunk 的方向。必须保持：

- CJS 主文件不内联 Mermaid；
- Office、KaTeX、Highlight、Markdown 保持异步 chunk；
- `lark-doc.common.js` 与其兄弟 chunk 一起发布；
- 不使用 `LimitChunkCountPlugin=1` 把所有能力压回单文件；
- SSR / Node 场景使用 CommonJS chunk loading，不依赖浏览器 `<script>` 注入。

### 6.5 ESM 交给宿主继续拆包

`lark-doc.esm.js` 保留原生 `import()`，让 Vite、Webpack 5、Rollup 根据宿主应用重新分割：

- 应用可以把编辑器页面拆成独立 chunk；
- 多个页面可以共享 Tiptap/vendor chunk；
- 低频功能可以被应用二次拆分；
- 应用可统一控制 hash、CDN、publicPath 和缓存。

### 6.6 Element / CDN 单独承担直挂兼容

`element` 是给无构建工具环境使用的完整运行时，允许比 ESM 主入口更大，但必须：

- 主文件和异步 chunk 同目录发布；
- `publicPath` 能从脚本 URL 正确推导；
- 不让 Webpack 4 的 `browser` 字段误消费 UMD 异步运行时；
- 文档明确 CDN 静态资源目录结构；
- 不把 CDN 体积目标当成 npm 首屏体积目标。

---

## 7. 缩短应用打包时间和编译时间

### 7.1 包本身的减负收益

减少默认入口静态依赖后，应用 bundler 需要处理的模块数下降，收益包括：

- 依赖解析时间降低；
- Babel / loader 转换模块数减少；
- Webpack 4 依赖图和 optimization 时间降低；
- HMR 更新范围缩小；
- 应用 source map 生成更快；
- 首次构建内存峰值下降。

这是最根本的编译优化，优先级高于调大 Babel 警告阈值。

### 7.2 构建缓存

保留并完善 master 已有的缓存设计：

- Webpack filesystem cache；
- cache name 按 Node 主版本隔离；
- 按 `lib`、`esm`、`element`、`lite`、`legacy`、`adapters` 口径隔离；
- 构建配置和 Babel 配置纳入 cache dependencies；
- 不同 alias 方案不能共享同一缓存。

应用侧建议：

- Webpack 4 开启 `cache: true` 或持久化缓存方案；
- 不要在每次 dev 启动时删除 `node_modules/.cache`；
- 开发环境关闭生产级压缩和完整 source map；
- 编辑器页面异步化后，首页开发编译不会立即触发所有编辑器模块。

### 7.3 Babel 和 loader 范围

目标：只转译真正需要转译的源码。

- 不对已压缩的 Mermaid vendor 做完整 Babel preset 转换；
- vendor 只做必要语法降级；
- 不对 `node_modules` 做无差别全量转译；
- Webpack 4 仅对需要的现代语法做兼容转换；
- 不用修改 Babel `compact` 或 `max` 阈值掩盖大入口问题。

500KB warning 的处理原则：

> 警告是入口过大的信号，不是把阈值从 500KB 改成 5MB 就完成优化。

### 7.4 并行构建和稳定性

库发布构建可以继续使用并行 loader，但必须保留串行降级开关：

```bash
LARK_DOC_NO_PARALLEL=1 npm run build
```

CI 以稳定通过为先。若 thread-loader 冷启动造成 timeout，宁可在 CI 使用稳定串行模式，也不要让失败后整套产物重复构建。

### 7.5 产物指纹避免重复构建

保留 `scripts/ensure-artifacts.mjs` 的策略：

- 根据 `src`、构建脚本、构建配置、依赖声明、目标环境计算指纹；
- `check:artifacts` 已生成且输入未变时，`prepack` 跳过重复构建；
- 同一脚本生成多个文件时按 script 去重；
- 产物缺失、大小漂移或输入改变才重建；
- 构建期间输入改变时不写入成功 stamp。

该机制直接减少发布和本地 `npm pack` 的重复编译时间。

### 7.6 将重型分析从常规构建移出

Bundle analyzer、完整 stats、source map 分析只在显式命令开启：

```bash
LARK_DOC_ANALYZE=1 npm run build:analyze
```

普通开发和 CI 不输出完整模块 source，避免内存和序列化开销。

---

## 8. 首屏加载优化目标

首屏优化按用户真实路径定义，不按整个 npm 包大小定义。

### 8.1 页面级目标

编辑器不参与应用首页依赖图：

```text
首页首屏
  ├── 不 import lark-doc
  ├── 不 import lark-doc/style.css
  ├── 不触发编辑器页面 chunk
  └── 不触发 Mermaid / Math / Office / Highlight

进入编辑器
  ├── 加载 EditorPage
  ├── 加载 lark-doc 核心
  └── 加载基础样式

首次使用低频功能
  └── 只加载该功能及其第三方依赖
```

### 8.2 编辑器页面目标

编辑器首屏只应包含：

- 基础文档模型和编辑事务；
- 基础 DOM UI；
- 工具栏实际启用能力；
- 必要 CSS；
- 必要 polyfill。

不应在编辑器首屏加载：

- Mermaid vendor；
- KaTeX；
- mammoth/docx；
- 全量 highlight.js 语言；
- 协同 provider；
- 模板库；
- 评论和版本历史面板。

### 8.3 资源缓存目标

- 核心 chunk 使用稳定内容 hash；
- Tiptap/vendor 与业务编辑器页面分开缓存；
- feature chunk 长期缓存；
- CSS 与核心版本保持一致；
- CDN / 内网静态部署时主文件和兄弟 chunk 不拆到不确定的目录。

---

## 9. 各环境最终案例

### 9.1 Vue 2 + Webpack 4

```bash
npm install lark-doc
```

```js
// EditorPage.vue
import { LarkDoc } from 'lark-doc'
import 'lark-doc/style.css'

export default {
  mounted() {
    this.editor = new LarkDoc({
      element: this.$refs.editor,
      content: '<p>Hello</p>',
      readonly: false,
    })
  },
  beforeDestroy() {
    if (this.editor) this.editor.destroy()
  },
}
```

```js
// router.js
const EditorPage = () => import('./views/EditorPage.vue')
```

注意：

- 不在 `main.js`、`App.vue`、公共 Layout、全局 plugin 中引入；
- 关闭 Vue CLI prefetch/preload；
- 确保 CJS 主文件和兄弟异步 chunk 都被部署；
- 检查 `publicPath`，不能只上传主文件；
- Node 14 运行时不应执行浏览器 Element 入口。

### 9.2 Vue 3 + Vite

```js
import { LarkDoc } from 'lark-doc'
import 'lark-doc/style.css'

const editor = new LarkDoc({
  element: editorRef.value,
  content: initialContent,
})
```

路由使用动态 import，Vite 负责宿主侧拆包。`lark-doc/vue3` 只在需要标签式 Vue 薄壳时使用。

### 9.3 React

```jsx
import { useEffect, useRef } from 'react'
import { LarkDoc } from 'lark-doc'
import 'lark-doc/style.css'

export default function Editor() {
  const ref = useRef(null)

  useEffect(() => {
    const editor = new LarkDoc({
      element: ref.current,
      content: '<p>Hello</p>',
    })
    return () => editor.destroy()
  }, [])

  return <div ref={ref} />
}
```

页面使用 `React.lazy(() => import('./EditorPage'))`。

### 9.4 原生 DOM + Vite/Rollup

```js
import { LarkDoc } from 'lark-doc'
import 'lark-doc/style.css'

const editor = new LarkDoc({
  element: document.querySelector('#editor'),
})
```

### 9.5 原生 HTML / CDN

```html
<link rel="stylesheet" href="./lark-doc.css">
<script src="./lark-doc-element.umd.min.js"></script>

<lark-doc></lark-doc>
```

如需点击后加载，应将 Element 脚本放到点击处理逻辑中，并把主文件与旁挂 chunk 放在同一个静态目录。

### 9.6 SSR / Nuxt / Next

编辑器只能在客户端初始化：

```js
const EditorPage = lazy(() => import('./EditorPage'))
```

禁止在服务端执行：

```js
new LarkDoc({ element: ... })
```

因为初始化依赖 DOM、Selection、ResizeObserver、浏览器事件和编辑器视图。

---

## 10. 实施顺序

### 阶段 0：基线和契约冻结

1. 以 master 为基线建立包体积、构建时长、首次编译时长和应用首屏 Network 基线；
2. 冻结 `new LarkDoc(options)` 作为唯一默认 API；
3. 明确 `createLarkDoc` 删除范围；
4. 增加 API/exports 契约检查。

### 阶段 1：默认入口收口

1. `src/index.js` 删除 `createLarkDoc` 公开导出；
2. 删除或迁移非首屏能力的静态导出；
3. 为 templates、comments、versioning、providers、migrations 建立独立子入口；
4. 保证默认入口仍导出 `LarkDoc` 和 default export；
5. 所有 demo 和文档统一改成 `new LarkDoc(options)`。

### 阶段 2：包元数据和 Tree Shaking

1. 校正 `exports`、`main`、`module`、`unpkg`、`jsdelivr`；
2. 收窄 `sideEffects`；
3. 保证 CSS 只有 `lark-doc/style.css` 正式入口；
4. 检查 Webpack 4 不会被 `browser` 字段错误导向 UMD；
5. 增加 Node 14、Webpack 4、Vite、Rollup 入口解析测试。

### 阶段 3：异步 chunk 和 feature 包

1. CJS 保持 CommonJS chunk loading，不内联重依赖；
2. ESM 保留原生动态 import，交给宿主拆分；
3. 完善 `lite` 主入口；
4. 输出 math、mermaid、office、markdown、highlight feature 包；
5. 统一 feature registry，保证重复加载只执行一次；
6. 验证主文件、异步 chunk、CSS、字体和 vendor 资源可一起部署。

### 阶段 4：应用集成案例

为以下环境提供可运行 demo：

- Vue 2 + Webpack 4；
- Vue 3 + Vite；
- Webpack 5；
- React；
- 原生 DOM；
- Web Component/CDN；
- SSR 客户端加载。

每个案例必须包含：

- 安装；
- 默认引入；
- `new LarkDoc(options)`；
- 路由懒加载；
- preload 可选写法；
- 销毁；
- 异步资源部署说明。

### 阶段 5：构建速度优化

1. 保留 filesystem cache 和 cache flavor 隔离；
2. 确认 `ensure-artifacts` 指纹覆盖所有真正的构建输入；
3. 普通构建不生成完整 analyzer stats；
4. 只对必要源码执行 Babel；
5. 对 vendor 采用最小语法转换；
6. 发布链路按脚本去重，避免同一产物重复构建；
7. 测量冷构建、热构建、单入口构建和完整发布构建。

### 阶段 6：长期 UI 去框架

master 的默认运行时继续保持框架无关。Vue 2 legacy 只作为独立兼容入口存在。长期将 Vue SFC UI 按批次迁移到原生 DOM UI，不要求一次性重写，也不把该阶段作为首屏优化的前置条件。

---

## 11. 验收指标

所有指标都应以 master 基线实测后再定最终数值，不能只凭文件大小推测。

### 11.1 API 验收

- `import { LarkDoc } from 'lark-doc'` 可用；
- `new LarkDoc({ element, content, readonly })` 可用；
- `createLarkDoc` 不再是默认入口公开导出；
- `new LarkDoc(element, options)` 不在文档和契约中出现；
- `destroy()` 后无事件、定时器、provider 泄漏。

### 11.2 首屏验收

- 首页 Network 不出现 lark-doc 核心 chunk；
- 首页 Network 不出现 style.css、Mermaid、KaTeX、Office 和 Highlight chunk；
- 进入编辑器后只下载页面和核心 chunk；
- 首次使用低频能力时才出现对应 feature chunk；
- 刷新页面时异步资源不会 404。

### 11.3 体积验收

至少记录以下数据：

| 口径 | 必须记录 |
| --- | --- |
| 原始大小 | 每个入口和每个 async chunk |
| gzip | 主入口、核心 chunk、feature chunk |
| brotli | 生产 CDN 若启用则记录 |
| 首屏传输 | 首页和编辑器页分别记录 |
| 依赖归属 | Tiptap、vendor、Mermaid、KaTeX、Office、Highlight |

建议门禁方向：

- 默认 ESM 主入口不得重新内联 Mermaid、Office、KaTeX；
- lite 主入口不包含低频重依赖；
- CJS 主文件不得回到单文件内联全部重依赖；
- 任一 feature 包只包含自己的能力和必要共享契约；
- 体积变化超过阈值时输出明确诊断，而不是只报 Babel 500KB warning。

### 11.4 构建时间验收

至少比较：

```text
冷构建：删除缓存后完整构建
热构建：输入不变再次构建
单文件修改：修改基础 UI 后的增量编译
低频功能修改：修改 mermaid/math 后的增量编译
发布链路：check → build → pack 的总耗时
```

目标方向：

- 热构建命中 filesystem cache；
- 未改变输入时 `ensure-artifacts` 跳过重复构建；
- 仅修改低频 feature 时不触发首页应用全部依赖重新处理；
- 删除默认静态导出后，应用解析和 Babel 模块数下降；
- 不通过关闭正确性检查换取速度。

---

## 12. 不做的事情

1. 不把 `LarkDoc` 改成 `LarkDoc(element, options)` 工厂函数；
2. 不保留 `createLarkDoc` 和 `LarkDoc` 两套公开初始化 API；
3. 不要求业务方拆装多个 npm 包；
4. 不让 lark-doc 强制决定宿主首页是否懒加载；
5. 不为了消除 500KB warning 简单调大 Babel 阈值；
6. 不把 Mermaid、Office、KaTeX 等低频依赖塞回默认主入口；
7. 不把所有构建格式都维护成相同职责；
8. 不用 UMD 作为 Webpack 4 的默认 npm 消费入口；
9. 不在 SSR 服务端构造编辑器实例；
10. 不为了首屏优化一次性重写全部 Vue UI。

---

## 13. 最终对外口径

文档、README、Demo 和发布说明统一使用以下口径：

> lark-doc 是一个框架无关的文档编辑器。用户只需安装一个 `lark-doc` 包，并通过 `import { LarkDoc } from 'lark-doc'` 获取统一核心 API，再使用 `new LarkDoc(options)` 传入配置对象初始化。应用页面是否在首屏加载由宿主路由和 bundler 决定；lark-doc 通过 ESM/CJS/Element 多入口、feature 子路径和内部动态 import，负责减少默认入口体积并按用户行为加载低频能力。Vue 2 + Webpack 4、Vue 3、React、原生 DOM 和 Web Component 使用同一套核心配置语义，不要求为不同环境改变初始化 API。

最终示例固定为：

```js
import { LarkDoc } from 'lark-doc'
import 'lark-doc/style.css'

const editor = new LarkDoc({
  element: document.querySelector('#editor'),
  content: '<p>Hello</p>',
  readonly: false,
})
```
