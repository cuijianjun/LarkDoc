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
editor.setJSON({ type: 'doc', content: [{ type: 'paragraph' }] })
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
| Vue 2.7 + webpack 5 / Vite | `import { LarkDoc } from 'lark-doc'` | 不需要 lark-doc 专用配置 |
| Vue 2.7 + webpack 4 | 默认入口 + CJS alias | 需要一行 alias，子路径写 `dist/` 全路径 |
| Vue 3 | `lark-doc/element` + `lark-doc/vue3`，或直接默认入口 | 自定义元素需放行 |
| React | `lark-doc/element` + `lark-doc/react`，或直接默认入口 | CRA/Vite 通常不需要配置 |
| 原生 HTML / CDN | `dist/lark-doc-element.umd.min.js` | `dist/` 整目录同位托管 |
| Next / Nuxt SSR | 客户端动态 import | 不要在服务端创建编辑器 |
| 协同编辑 | `lark-doc/collab` | 宿主自行安装并提供 Yjs / Provider |

### webpack 4

webpack 4 不读取 `exports`，主入口指向 CJS：

```js
// vue.config.js
module.exports = {
  configureWebpack: {
    resolve: {
      alias: {
        'lark-doc$': 'lark-doc/dist/lark-doc.common.js',
      },
    },
  },
}
```

样式和其他子入口也写完整路径：

```js
import 'lark-doc/dist/lark-doc.css'
// Element：import 'lark-doc/dist/lark-doc-element.umd.min.js'
```

不要把 `lark-doc` 整包交给业务 Babel 重复转译；CJS 产物已经按 webpack 4 可解析语法构建。

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
  plugins: [vue()],
  compilerOptions: { isCustomElement: (tag) => tag === 'lark-doc' },
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

## 4. 懒加载：默认不加载低频能力

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
import 'lark-doc/features/highlight'
import 'lark-doc/style.css'

new LarkDoc({ element: '#editor', content: '<p>轻量入口</p>' })
```

`lite` 会把低频依赖替换为可读错误或降级文本；加载对应 feature 后，注册表会恢复能力。不要同时把 `lark-doc` 和 `lark-doc/lite` 当作两个编辑器核心引入。

### 何时选择哪一种

- **普通项目**：直接用 `lark-doc`，功能最完整，按功能动态加载。
- **首屏极敏感**：用 `lark-doc/lite`，再按页面需要加载 feature。
- **页面级懒加载**：把编辑器所在页面和 feature 一起 `import()`，例如：

```js
const { LarkDoc } = await import('lark-doc/lite')
await import('lark-doc/features/mermaid')
```

- **CDN / Element**：保留 `dist/` 全目录；Element 的异步 chunk 由主脚本地址推导。

## 5. 低频子入口

默认入口不再静态导出模板、评论、版本、providers、migrations 等低频模块，按需引入：

```js
import { createTemplateLibrary } from 'lark-doc/templates'
import { createMemoryCommentsProvider } from 'lark-doc/comments'
import { createMemoryVersioningProvider } from 'lark-doc/versioning'
import { createDocumentSession } from 'lark-doc/providers'
import { migrateDocument } from 'lark-doc/migrations'
```

这些入口仍由同一个 `lark-doc` npm 包提供，不需要拆装多个包。

## 6. 常见故障排查

| 现象 | 先检查 |
|---|---|
| webpack 4 解析 `import.meta` 失败 | 是否配置了 `lark-doc$` → `lark-doc/dist/lark-doc.common.js` |
| Vue/React 标签空白 | 是否先 `import 'lark-doc/element'` |
| 公式、Word 或图表时报 feature 未加载 | 是否加载对应 `lark-doc/features/*`，或改用完整 `lark-doc` 入口 |
| 静态页首次能打开、点击功能 404 | 是否完整复制 `dist/` 和 `fonts/`，chunk 是否同位 |
| SSR 报 `document is not defined` | 是否把 import/初始化放进客户端生命周期 |
| 协同入口依赖缺失 | 是否额外安装并配置 `yjs`、Provider 与 Tiptap 协同扩展 |
| 配置生效但功能入口不见 | `toolbarKeys` 只控制显示；真正禁用/启用看 `features` |

开发 lark-doc 本身时，修改后先运行：

```bash
npm run check:quick
npm run check:pkg
npm run check:lite
```

发布前再按仓库约定运行 `npm run check`，并确保 `dist/` 由当前 worktree 重新生成。
