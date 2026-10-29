# lark-doc

> ⚠️ **声明**：本项目是**个人学习用途**的开源练习项目，界面与交互模仿飞书文档（Lark Docs / Feishu Docs），
> **与飞书、Lark、字节跳动无任何隶属、合作或授权关系，非官方产物，禁止用于任何商业用途**。
> 使用产生的侵权等后果由使用者自行承担。详见 [背景](#背景) 与 [免责声明](#免责声明)。

飞书风格富文本文档编辑器与工作台组件库 —— 基于 Vue 2.7 + Tiptap 3，完整还原飞书文档排版与交互（折叠/高亮、标题编号、列表、表格、气泡菜单），支持 Web Component 与命令式 API，零依赖嵌入 Vue 2 项目（`0.10.0`）。

完整文档：[VitePress 使用手册](https://cuijianjun.github.io/LarkDoc/)（源码在 `docs/` 目录，随仓库自动部署到 GitHub Pages）。

在线演示：[https://cuijianjun.github.io/LarkDoc/demo/](https://cuijianjun.github.io/LarkDoc/demo/)（上方编辑器预览 + 下方可折叠代码预览，可在页面直接改初始化配置实时生效）。

> **开发/改代码前必读**：[DEVELOPMENT.md](./DEVELOPMENT.md) —— 踩坑清单与回归防护（折叠高亮、blockId、缩进、编号、弹窗、排版实测值、Vditor 兼容）。

> **长期路线两份**
> - [MULTI_ENV_PLAN.md](./MULTI_ENV_PLAN.md) —— **宿主怎么引入**：产物格式、`exports` 路由、webpack4/5/Vite/内网 的配置收敛。
> - [FRAMEWORK_AGNOSTIC_PLAN.md](./FRAMEWORK_AGNOSTIC_PLAN.md) —— **包内部怎么写**：分层、UI 去 Vue 的演进节奏（S0~S4）与验收口径。

## 环境要求

- **运行时（接入方）**：Node `>= 14.21.3`（`engines.node` 已放宽；Tiptap 3 依赖的 ES2022+ API 已由入口 core-js polyfill 补齐，Node 14 可正常运行）。无需固定某个版本。
- **peerDependencies**：`@tiptap/vue-2 ^3.32.0`（可选，协同/标注类能力用到）。
  **不再需要装 Vue** —— 阶段 3 起 Vue 被打进 esm / cjs / element 三档产物（V1 契约脱离），
  `peerDependencies` 里的 `vue` 一项已删除；源码树里的 Vue 会在阶段 5 + 7 摘掉（V2/V3）。
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
| Vue 2.7 + webpack4（vue-cli 4） | `import { LarkDoc } from 'lark-doc'` + `import 'lark-doc/dist/lark-doc.css'` | 主入口要**一行 alias**（`'lark-doc$' → 'lark-doc/dist/lark-doc.common.js'`）：webpack4 不读 `exports`，会落到含 `import.meta` 的 esm 档，acorn 6.4.2 解析不了；CJS 档已降到 ES2018 所以**不用 babel**。子路径与样式要写全 `dist/` 路径 |
| Vue 3 / React | `import { mountLarkDoc } from 'lark-doc/element'` | 预打包产物，自带内联 Vue；`dist/` 整目录拷入静态目录 |
| 原生 / CDN / 静态托管 | `<script src=".../lark-doc-element.umd.min.js">` | `<lark-doc>` 标签直接可用，`dist/` 整目录拷贝（按需区块同目录寻址） |
| Nuxt / Next（SSR） | `process.client` / `dynamic(..., { ssr: false })` 内动态 `import('lark-doc/element')` | 仅客户端挂载 |

mermaid 图表默认走懒区块自动加载（无需任何配置）；要接管加载可挂载前设 `window.mermaid`，或传 `performance.diagramScriptUrl` 指定自托管渲染器地址。

> 每个环境的**编译工具配置、工具栏（编辑工具）配置、可直接粘贴运行的完整 demo** 见文档站「各环境引入对照」：<https://cuijianjun.github.io/LarkDoc/guide/environments.html>（源文件 `docs/guide/environments.md`）。

### 包契约（v0.13 起）

对外只承诺一份契约，宿主不需要为环境写任何特判：

| 契约项 | 口径 | 为什么 |
|---|---|---|
| **`browser` 字段** | **已删除** | 它会让 webpack4/5 与部分工具跳过 ESM、直接落到 UMD「浏览器直挂档」，宿主拿到的就不是可 tree-shaking 的模块产物。SSR 与浏览器吃**同一份产物**；需要环境差异一律走 `exports` 的 condition。 |
| **`sideEffects`** | 只列 `**/*.css`、`**/*.scss` 与 UMD / element 自注册档、CJS 档 | UMD 档确实有顶层副作用（自定义元素注册、`__webpack_public_path__`），不能谎报为纯；ESM 档是唯一需要被 tree-shake 的路径，已排除在名单外。 |
| **`exports` 子入口** | `.` / `./element` / `./vue3` / `./react` / `./adapters/*` / `./collab` / `./style.css` / `./dist/*`（逃生口）/ `./package.json`，另预留 `./lite`、`./features/*`、`./plugin` | 后三个是**终点契约**，提前声明好让宿主今天就能照着写；实际产物分别在阶段 7 / 4 / 6 落地产出（`npm run check:pkg` 会在它们产出后自动提醒把待产出标记摘掉）。 |
| **样式** | 必须显式 `import 'lark-doc/style.css'`（webpack4 写 `lark-doc/dist/lark-doc.css`） | 所有产物都是 **CSS 抽取**产物，JS 里不带注入逻辑 —— 这一条**从 0.11 起就一直是硬要求**，v0.13 只是把它写进契约。 |

> `sideEffects` 收窄的实测收益（webpack 5，入口只 `import { LarkDoc } from 'lark-doc'` 但**从不使用**）：
> 收窄前 `1,922,452 B` → 收窄后 **`151 B`**；而副作用型入口 `import 'lark-doc/element'` 仍完整保留 `1,695,666 B`，不会被误删。

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

三份产物按「宿主怎么用」划分，重依赖（KaTeX / docx / mammoth / marked / turndown / highlight.js / mermaid）
全部拆成按需区块，首屏不下载：

```bash
npm run build          # dist/lark-doc.common.js        CJS 单文件（main，Vue 已内联）
npm run build:esm      # dist/lark-doc.esm.js           ES Module（module，拆包最彻底）
npm run build:element  # dist/lark-doc-element.umd.min.js  Web Component，兼职 CDN <script> 直挂（unpkg / jsdelivr）
npm run build:analyze  # 以上三份 + 体积诊断输出
```

首屏 JS：CJS 3.85 MB（gzip 1.04，Vue 已内联）、element 930 KB（gzip 275）、ESM 848 KB（gzip 248，三块并行）。
部署时按需区块要与主文件同目录，详见文档站「打包产物与按需加载」。

### lite 主产物与可选特性包

体积敏感的宿主可以走 `lark-doc/lite`（`dist/lark-doc-lite.esm.js`）：它把六个重依赖
（KaTeX / docx / mammoth / marked / turndown / highlight.js，以及 vendored mermaid）
从主产物里整体掐断，首屏进一步变小。被掐断的能力不消失——改走**特性注册表**：

- 主产物未注册特性时，对应功能沿内置 catch 降级（公式留 LaTeX 纯文本、代码块纯文本、
  Markdown/Word 导入导出给可读提示）；
- 宿主按需加载 `lark-doc/features/<name>`（`<script>` 或 import）后，对应能力即刻恢复，
  主产物不用换、不重发。

| 特性包 | 注册名 | 恢复的能力 |
|---|---|---|
| `lark-doc/features/math` | `math` | 公式渲染（KaTeX 样式随包注入，字体同目录发布） |
| `lark-doc/features/mermaid` | `mermaid` | 图表渲染（自带 vendored mermaid） |
| `lark-doc/features/highlight` | `highlight` | 代码语法高亮（全语言） |
| `lark-doc/features/markdown` | `markdown` | Markdown 导入 / 导出 |
| `lark-doc/features/office` | `office.buildDocx` / `office.docx` / `office.mammoth` | Word 导入导出 |

接入示例：

```html
<script type="module">
  import { LarkDoc } from './dist/lark-doc-lite.esm.js'
  // 部署时 features/ 目录整体拷入（math.js 的 KaTeX 字体按同目录相对路径解析）
  import './dist/features/math.js'
  import './dist/features/highlight.js'

  new LarkDoc({ element: '#editor', content: '<p>开始编辑。</p>' })
</script>
```

自定义宿主也可以用同一注册表接入自己的实现（`registerFeature(name, loader)`，
见 `src/core/features/registry.js`）。全量产物不受影响：未注册特性时走内置按需区块，
行为与 0.12 完全一致。

## 边界

包默认不创建 Yjs、WebSocket 或后台连接。`DocumentSession` 统一文档身份、事务来源、能力判断和 Provider 生命周期；协同、版本、评论、权限都通过显式 Provider 接入。数据模型与 Provider 契约见 [DEMO_INTEGRATION_GUIDE.md](DEMO_INTEGRATION_GUIDE.md)。

Demo 应用只负责路由与页面呈现；本仓库通过 `file:` 依赖以真实消费方的方式验证包，开发期再 alias 到源码。

## 背景

- **为什么写**：用于个人学习与技术研究的练习项目，目的是吃透富文本编辑器的工程实现 —— ProseMirror 文档模型、
  Tiptap 3 扩展机制、Vue 2.7 渲染层，以及块级结构、折叠/高亮、标题自动编号、列表缩进、气泡菜单、表格交互等
  具体问题的解法。仓库里大量注释与 `DEVELOPMENT.md` 的踩坑清单，本质上是学习笔记，不是产品交付物。
- **为什么长这样**：把「飞书文档」作为还原目标，是为了有一个明确、可对照的高标准参照物 —— 排版数值、菜单层级、
  图标位置都去真飞书里量过。这是**模仿练习**（类似临摹），不是复刻其实现：所有代码、图标、样式均为本仓库自写，
  未使用飞书的任何代码、接口、设计源文件、商标或 Logo。
- **为什么开源**：方便自己回溯和与他人交流编辑器实现细节；顺带给同样在研究 Tiptap / Vue2 编辑器的人一个可跑的样本。

## 免责声明

1. **非官方、无授权**：本项目与飞书、Lark、字节跳动及其关联公司**没有任何隶属、合作、授权或背书关系**，
   不是其官方产品或衍生版本。「飞书 / Lark / Feishu」仅为描述交互风格时的指代性说明。
2. **禁止商用**：不得用于任何商业用途，包括但不限于对外销售、交付、运营，或用于面向客户/用户的收费服务。
   仅允许个人学习、研究与技术评估。
3. **侵权风险自负**：界面与交互的模仿在部分司法辖区可能涉及知识产权、外观设计或不正当竞争风险。
   使用者应自行完成合规评估并承担全部后果；作者不对因使用、修改、分发本软件产生的任何直接或间接责任负责。
4. **按现状提供**：软件按「AS IS」提供，不附带任何明示或默示担保（见 [LICENSE](./LICENSE)）。

## 第三方资源与协议

包内所有静态资源均为本地化打包，不请求 CDN，各自遵循原始开源协议：

| 资源 | 用途 | 协议 |
|---|---|---|
| KaTeX（样式 + 字体） | 数学公式渲染 | MIT |
| highlight.js | 代码高亮 | BSD-3-Clause |
| emojibase | Emoji 数据 | MIT |
| docx / mammoth | Word 导出 / 导入 | MIT / BSD-2-Clause |
| marked / turndown | Markdown 互转 | MIT |
| Tiptap / ProseMirror | 编辑器内核 | MIT |

## 开源协议

[MIT](./LICENSE) —— 允许自由使用、复制、修改、合并、发布、分发、再许可，**但须保留版权声明与许可声明**，
且**附加声明中的「禁止商用」为使用建议与风险提示**，请务必遵守。软件按「AS IS」提供，作者不承担任何责任。
