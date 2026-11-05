# 安装、兼容与懒加载速查

这页只解决接入时最常见的几个问题：**怎么安装、怎么引用、怎么配置、不同环境怎么选、功能什么时候加载**。

## 1. 推荐写法：一次安装，一个 API

```bash
npm install lark-doc
```

```js
import { LarkDoc } from 'lark-doc'
import 'lark-doc/style.css'

const editor = new LarkDoc({
  element: document.querySelector('#editor'),
  content: '<p>开始编辑</p>',
  readonly: false,
})

editor.on('update', ({ json }) => console.log(json))
editor.getJSON()
editor.setContent({ type: 'doc', content: [{ type: 'paragraph' }] })
editor.focus()
editor.destroy()
```

`LarkDoc` 是 class，构造函数只接收一个 options 对象。不要使用以下旧形式：

```js
// 不支持
import { createLarkDoc } from 'lark-doc'
createLarkDoc(element, options)
new LarkDoc(element, options)
```

### 常用 options

```js
new LarkDoc({
  element,                         // 必填：选择器或 HTMLElement
  content,                         // HTML、Tiptap JSON 或文档 record
  readonly: false,
  theme: 'light',                  // light | dark
  storage: 'none',                 // 不需要草稿时建议显式关闭
  autosave: { enabled: true, delay: 650 },
  toolbarKeys: ['history', 'headings', 'marks', 'insert', 'tables'],
  toolbarExcludes: ['shortcuts'],
  features: { ai: false, importExport: true },
  network: { mode: 'open' },       // open | allowlist | offline
  uploader: { upload: uploadFile },
  persistence: saveAdapter,
})
```

配置仍然是 options 对象；低频功能拆成入口后，**配置字段不会自动安装对应实现**，需要额外加载 feature（见第 4 节）。

## 2. 不同环境怎么选

| 环境 | 推荐入口 | 是否需要额外配置 |
|---|---|---|
| Vue 2.7 + webpack 5 / Vite | `import { LarkDoc } from 'lark-doc'` | 默认/full/lite 显式引 CSS；不需专属 alias |
| Vue 2.7 + webpack 4 | `import { LarkDoc } from 'lark-doc'` | 主入口无需 alias；深子路径与样式写 dist 实际路径 |
| Vue 3 | `lark-doc/element` + `lark-doc/vue3`，或直接默认入口 | 自定义元素需放行 |
| React | `lark-doc/element` + `lark-doc/react`，或直接默认入口 | CRA/Vite 通常不需要配置 |
| 原生 HTML / CDN | `dist/lark-doc-element.umd.min.js` | `dist/` 整目录同位托管 |
| Next / Nuxt SSR | 客户端动态 import | 不要在服务端创建编辑器 |
| 协同编辑 | `lark-doc/collab` | 宿主自行安装并提供 Yjs / Provider |

### Vue2 / webpack 4

webpack4 通常按 module 选择公开 ESM，不能假定它读取 exports 或优先 main/CJS。包侧已覆盖该 ESM 及可达 chunk 的语法降级，不要求根 alias、源码路径或专属 Babel 配置；本轮同版包已在真实 webpack4.47 / Node14 消费夹具通过编译、异步图表/公式和运行时 API 补全：

```js
import { LarkDoc } from 'lark-doc'
import 'lark-doc/dist/lark-doc.css'

// mounted
const editor = new LarkDoc({ element: this.$refs.editor })
```

不要把 `lark-doc/dist` 交给业务 Babel 重复转译；发布产物已经按宿主兼容目标构建。Element 等标签入口只有在明确选择 Web Component 方案时才引入。

### Vue 3 / React

使用 Web Component 时，先注册元素，再使用薄适配器：

```js
import 'lark-doc/element'
import { resolveVue3Attrs } from 'lark-doc/vue3'
```

```js
import 'lark-doc/element'
import { createReactLarkDoc } from 'lark-doc/react'
const Editor = createReactLarkDoc(React)
```

Vue 3 的 Vite 配置：

```js
export default {
  plugins: [vue({ template: { compilerOptions: { isCustomElement: tag => tag === 'lark-doc' } } })],
}
```

### SSR

编辑器依赖 DOM，只在客户端创建：

```js
// Next：组件文件顶部写 'use client'
const { LarkDoc } = await import('lark-doc')
const editor = new LarkDoc({ element, content })
```

Nuxt 使用 `<ClientOnly>`；不要在 `getServerSideProps`、服务端插件或 Node 进程启动阶段执行 `new LarkDoc()`。

## 3. 外网、内网和静态部署

### 外网项目

```bash
npm install lark-doc
npm ls lark-doc
```

### 内网或离线项目

联网机器生成包，目标机器安装：

```bash
npm pack lark-doc@<version>
# 或在仓库中：bash scripts/pack-intranet.sh --version <version>
npm install ./lark-doc-<version>.tgz
```

### 没有打包器的静态页

不要只复制主文件，至少复制 `dist/` 中的主文件、异步 chunk、CSS 和 `fonts/`，并保持相对目录不变：

```html
<script src="./vendor/lark-doc/lark-doc-element.umd.min.js"></script>
<lark-doc content="<p>静态页</p>"></lark-doc>
```

如果异步 chunk 404，优先检查：主文件与 chunk 是否同目录、`fonts/` 是否存在、nginx 是否允许静态文件返回 200。

## 4. 全量与按需能力

默认入口保留核心编辑器；公式、Mermaid、Office、Markdown、代码高亮通过动态 import 在真正使用时加载。应用只使用默认入口时，不会主动把这些低频实现作为首屏代码执行。

| 能力 | 触发时机 | 可选入口 |
|---|---|---|
| 数学公式 | 首次渲染公式 | `lark-doc/features/math` |
| Mermaid | 首次渲染图表 | `lark-doc/features/mermaid` |
| Word 导入导出 | 首次导入或导出 | `lark-doc/features/office` |
| Markdown | 首次导入或导出 | `lark-doc/features/markdown` |
| 代码高亮 | 首次渲染代码块 | `lark-doc/features/highlight` |

体积敏感时使用 lite：

```js
import { LarkDoc } from 'lark-doc/lite'
import 'lark-doc/features/math'
import 'lark-doc/dist/features/math.css'
import 'lark-doc/features/highlight'
import 'lark-doc/style.css'

new LarkDoc({ element: '#editor', content: '<p>轻量入口</p>' })
```

`lite` 会把低频依赖替换为可读错误或降级文本；加载对应 feature 后，注册表会恢复能力。不要同时把 `lark-doc` 和 `lark-doc/lite` 当作两个编辑器核心引入。

### 一次性引入全部能力

如果应用希望用一次 import 静态注册 Mermaid、Office、KaTeX、Markdown、Highlight，以及 Templates、Comments、Versioning、Providers、Migrations，可以使用：

```js
import {
  LarkDoc,
  createTemplateLibrary,
  createMemoryCommentsProvider,
  createMemoryVersioningProvider,
  createPersistenceProvider,
  migrateRecordContent,
} from 'lark-doc/full'
import 'lark-doc/style.css'
```

`lark-doc/full` 是独立的全量产物：它静态注册五个可选 feature，并转出全部低频子入口；因此应用不需要再逐个 `import('lark-doc/features/*')`。代价是首屏 bundle 会包含这些能力及其依赖，适合功能覆盖完整、首屏体积不敏感的后台或桌面应用。它不是默认入口的别名，也不要与 `lark-doc/lite` 同时作为两个编辑器核心加载。

Collab 不并入这个全量文件：它依赖宿主安装的 `yjs`、Tiptap 协同扩展和 Hocuspocus Provider，并且必须与宿主保持单例。全量应用若需要协同，再额外引入 `lark-doc/collab`，同时配对 SDK、collab 和 Yjs 的模块格式：

```js
import * as Collab from 'lark-doc/collab'
const collabExtensions = Collab.createCollabExtensions({ ydoc, provider, user })
```

### 何时选择哪一种

- **普通项目**：直接用 `lark-doc`，功能最完整，按功能动态加载。
- **全量后台/桌面应用**：用 `lark-doc/full`，一次性获得所有可选能力。
- **首屏极敏感**：用 `lark-doc/lite`，再按页面需要加载 feature。
- **页面级懒加载**：把编辑器所在页面和 feature 一起 `import()`，例如：

```js
const { LarkDoc } = await import('lark-doc/lite')
await import('lark-doc/features/mermaid')
```

- **Element import**：ESM 原生动态 import，由宿主输出；**require/CDN UMD**：保留 dist 全目录，配套 feature UMD 按主脚本目录加载。

## 5. 低频子入口

默认入口聚焦编辑器核心，模板、评论、版本、providers、migrations 等低频模块按需引入；full 同时转出这些模块：

```js
import { createTemplateLibrary } from 'lark-doc/templates'
import { createMemoryCommentsProvider } from 'lark-doc/comments'
import { createMemoryVersioningProvider } from 'lark-doc/versioning'
import { createPersistenceProvider } from 'lark-doc/providers'
import { migrateRecordContent } from 'lark-doc/migrations'
```

这些入口仍由同一个 `lark-doc` npm 包提供，不需要拆装多个包。

## 6. 常见故障排查

| 现象 | 先检查 |
|---|---|
| webpack4 解析失败 | 是否消费当前同版 Rollup 产物及全部 chunk；主 ESM 不要求根 alias，深子路径仍写 dist 文件 |
| Vue/React 标签空白 | 是否先 `import 'lark-doc/element'` |
| 公式、Word 或图表时报 feature 未加载 | 是否加载对应 `lark-doc/features/*`，或改用完整 `lark-doc` 入口 |
| 静态页首次能打开、点击功能 404 | 是否完整复制 `dist/` 和 `fonts/`，chunk 是否同位 |
| SSR 报 `document is not defined` | 是否把 import/初始化放进客户端生命周期 |
| 协同入口依赖缺失 | 是否额外安装并配置 `yjs`、Provider 与 Tiptap 协同扩展 |
| 配置生效但功能入口不见 | `toolbarKeys` 只控制显示；真正禁用/启用看 `features` |

修改库源码与发布前检查，见仓库的[开发指南](https://github.com/cuijianjun/LarkDoc/blob/master/docs/guide/development.md)。

## 7. 上传和显式协同

图片完整生命周期、取消、base64 与 URL 结果见[上传器](/blocks/uploader)。仅上传配置更新使用 doc.setUploader 或框架 property 路径，保留正文、标题和撤销历史；函数不可序列化成 attribute。

普通编辑不声明协同 optional peer。collabDependencies 是版本契约元数据，不是 npm constraints；显式 collab 保持宿主单例。当前依赖验证基于 Hocuspocus Provider 4.7.1、Yjs 13.6.33、Tiptap 协同扩展 3.32.0；Hocuspocus 桥在连接前检查 attach/detach 并拒绝旧 API，不据此宣称任意旧版本受支持。

显式协同入口面向支持 package exports 的现代 bundler 与 Node22；webpack4 的验证范围是普通主入口，不包含外部协同栈。

显式协同当前验证使用 Node 22；Yjs 13.6.33 自身声明 Node >=16，库的 Node14 构建/普通编辑兼容不扩展为 Node14 协同承诺。

SDK 与协同位置算法共享 ProseMirror 类身份。npm 入口通过直接依赖及窄范围 browser 映射共享 PM，离线 ESM 保留 dist/pm。支持客户端 ESM SDK + ESM collab + ESM Yjs，或 CJS SDK + CJS collab + require Yjs。Node 的 exports.node 选择 CJS，请整组使用 require；UMD 与外部 collab、ESM/CJS 混用会在挂载前明确拒绝。不要复制两份 PM、添加宿主 alias 或修改 plugin key 绕过检查。

```js
// Node + jsdom；浏览器应用使用前面的 ESM import 组合
const { LarkDoc } = require('lark-doc')
const { createCollabExtensions, isRemoteTransaction } = require('lark-doc/collab')
const Y = require('yjs')
const ydoc = new Y.Doc({ gc: false })
const doc = new LarkDoc({
  element: document.querySelector('#editor'), storage: 'none',
  collab: { extensions: createCollabExtensions({ ydoc }), isRemoteTransaction },
})
// 先销毁 doc，再销毁 ydoc；共享 Y.Doc 应在全部编辑器销毁后释放。
```
