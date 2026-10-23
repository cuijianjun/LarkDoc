# lark-doc

飞书风格富文本文档编辑器与工作台组件库 —— 基于 Vue 2.7 + Tiptap 3，完整还原飞书文档排版与交互（折叠/高亮、标题编号、列表、表格、气泡菜单），支持 Web Component 与命令式 API，零依赖嵌入 Vue 2 项目（`0.10.0`）。

完整文档：[VitePress 使用手册](https://cuijianjun.github.io/LarkDoc/)（源码在 `docs/` 目录，随仓库自动部署到 GitHub Pages）。

> **开发/改代码前必读**：[DEVELOPMENT.md](./DEVELOPMENT.md) —— 踩坑清单与回归防护（折叠高亮、blockId、缩进、编号、弹窗、排版实测值、Vditor 兼容）。

## 环境要求

- **运行时（接入方）**：Node `>= 14.21.3`（`engines.node` 已放宽；Tiptap 3 依赖的 ES2022+ API 已由入口 core-js polyfill 补齐，Node 14 可正常运行）。无需固定某个版本。
- **peerDependencies**：`vue ^2.7.14` + `@tiptap/vue-2 ^3.32.0`（Vue 2.7 项目专属）。
- **从源码构建/跑 check**：Node `>= 14.21.3` + npm `>= 8.19.4` 即可（`check-node14.js` 只做最低版本门禁，Node 20 等更高版本同样合法）。

## 接入方式

默认导出是命令式入口，View 层只留一个挂载点：

```js
import { LarkDoc } from 'lark-doc'
import 'lark-doc/style.css'

const doc = new LarkDoc({
  element: '#editor',
  title: '未命名文档',
  content: '<p>开始编辑。</p>',
})

doc.getHTML()
doc.getJSON()
doc.destroy()
```

### 各环境引入对照（内网 / 外网统一，零配置）

| 宿主环境 | 引入写法 | 说明 |
|---|---|---|
| Vue 2.7 + webpack5 / vite | `import { LarkDoc } from 'lark-doc'` | 宿主统一编译：懒区块（公式 / Word / 高亮 / mermaid）由宿主输出，内网外网零配置 |
| Vue 2.7 + webpack4（vue-cli 4） | `import { LarkDoc } from 'lark-doc'` + `import 'lark-doc/dist/lark-doc.css'` | 0.11.0 起主入口可直接引入；CSS 需显式写 dist 路径（webpack4 不读 `exports`） |
| Vue 3 / React | `import { mountLarkDoc } from 'lark-doc/element'` | 预打包产物，自带内联 Vue；`dist/` 整目录拷入静态目录 |
| 原生 / CDN / 静态托管 | `<script src=".../lark-doc-element.umd.min.js">` | `<lark-doc>` 标签直接可用，`dist/` 整目录拷贝（按需区块同目录寻址） |
| Nuxt / Next（SSR） | `process.client` / `dynamic(..., { ssr: false })` 内动态 `import('lark-doc/element')` | 仅客户端挂载 |

mermaid 图表默认走懒区块自动加载（无需任何配置）；要接管加载可挂载前设 `window.mermaid`，或传 `performance.diagramScriptUrl` 指定自托管渲染器地址。

## 旧数据兼容（Vditor）

Vditor `getHTML()` 导出的 HTML 可直接喂给 `content`，命中 `vditor-*` / `language-math` / 图表 `language-*` 等指纹时自动归一化公式、任务列表、图表代码块、脚注与表格列宽：

```js
const doc = new LarkDoc({ element: '#editor', content: vditorHtml })
doc.importVditor(vditorHtml)      // 或显式强制归一化
doc.getImportReport()             // { source, math, taskList, taskItem, diagram, table, footnote, dropped }
```

图片无需配置（默认 `open`，http 直连）。校验脚本 `npm run check:vditor`。

旧调用方式仍然可用：

```js
import {
  LarkDocEditor,
  LarkDocWorkspace,
} from 'lark-doc'
```

`style.css` 是唯一公开样式入口，宿主只需引入一次；它包含正文样式与本地 KaTeX 字体，不要直接引 `src/components/lark-doc/lark-doc.css`。

## 资源本地化与网络策略

- KaTeX 样式与字体随包发布（`src/assets/fonts/katex`），构建产物带 `dist/fonts/`；代码高亮、Emoji 同样本地化，不请求任何 CDN。
- `network.mode` 默认 `open`：正文里的外链图片（含老系统的 http 图床）按原地址加载，开箱可用。
- 需要收敛时显式配置：

```js
new LarkDoc({
  element: '#editor',
  // 只放行白名单 host
  network: { mode: 'allowlist', allowlist: ['img.your-corp.com'] },
  // 或完全离线：外链图片显示占位并保留 data-original-src
  // network: { mode: 'offline' },
})
```

- 构建守卫：`npm run check:offline` 扫描 `src`、`dist` 的远程地址与字体完整性。

## 配置示例

```js
new LarkDoc({
  element: this.$refs.host,
  title: '项目说明',
  content: record,                 // HTML / Tiptap JSON / 文档信封
  readonly: false,
  storage: 'none',                 // 默认不写 localStorage
  saveHtml: false,                 // true 时保存 record 附带 html 派生副本（默认仅存 json）
  toolbarKeys: ['bold', 'italic', 'heading', 'table', 'image', 'ai'],
  features: { ai: false, importExport: false },
  limits: { maxLength: 5000, maxImageSize: 3 * 1024 * 1024 },
  uploader: { upload: fileToOss },
  onUpdate: ({ html, json }) => { /* 自动保存 */ },
  onError: (error) => console.error(error),
})
```

- `toolbarKeys` 是白名单，`toolbarExcludes` 是黑名单，12 个分组 + 8 个 mark key，详见文档「配置总览」。
- `storage: 'local'` 才启用浏览器草稿；命令式入口默认关闭，避免不同文档互相覆盖。
- `saveHtml: true` 时，`persistence.save(record)` 的 `record` 会额外带 `html` 字段（Tiptap 还原后的 HTML），方便后端直接渲染；默认 `false` 只传 `json` 结构化数据（无损、可协同）。

## 构建与校验

```bash
nvm use 14   # 任意 >= 14.21.3 均可（Node 20 等更高版本同样合法）
npm ci
npm run check          # node14 门禁 + offline + lark-doc + architecture + lint + build
```

单独跑：

```bash
npm run check:offline
npm run check:lark-doc
npm run build
```

## 产物与按需加载

四份产物按「宿主怎么用」划分，重依赖（KaTeX / docx / mammoth / marked / turndown / highlight.js / mermaid）
全部拆成按需区块，首屏不下载：

```bash
npm run build          # dist/lark-doc.common.js        CJS 单文件（main）
npm run build:umd      # dist/lark-doc.umd.min.js       <script> / CDN（unpkg）
npm run build:esm      # dist/lark-doc.esm.js           ES Module（module，拆包最彻底）
npm run build:element  # dist/lark-doc-element.umd.min.js  Web Component（Vue 内联）
npm run build:analyze  # 以上四份 + 体积诊断输出
```

首屏 JS：UMD 847 KB（gzip 246）、element 930 KB（gzip 275）、ESM 848 KB（gzip 248，三块并行），
改造前分别是 1.91 MB（gzip 548）与 2.16 MB（gzip 658）。
部署时按需区块要与主文件同目录，详见文档站「打包产物与按需加载」。

## 边界

包默认不创建 Yjs、WebSocket 或后台连接。`DocumentSession` 统一文档身份、事务来源、能力判断和 Provider 生命周期；协同、版本、评论、权限都通过显式 Provider 接入。数据模型与 Provider 契约见 [DEMO_INTEGRATION_GUIDE.md](DEMO_INTEGRATION_GUIDE.md)。

Demo 应用只负责路由与页面呈现；本仓库通过 `file:` 依赖以真实消费方的方式验证包，开发期再 alias 到源码。
