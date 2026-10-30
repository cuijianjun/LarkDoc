# 更新日志

本文件按 `MASTER_PLAN.md` 的阶段推进记录**对外契约**变化。语义化版本：宿主接入写法变了才动 minor/major。

## 0.13.0（2026-10-30）

> 七阶段「框架无关改造」的 **V1 过渡态**：对外契约已脱离 Vue（门面、子入口、按需特性、构建插件），
> 但源码树里仍保留 3 个 Vue 主壳 SFC，因此 `vue` 仍是运行期依赖（V1 把它内联进产物，宿主不用装）。
> **V2/V3「源码完全不含 Vue」顺延到 0.14**，见阶段 7 的「未完成」。

**接入写法一句话**（替换 0.12 及更早的所有写法）：

```js
import { LarkDoc } from 'lark-doc'
import 'lark-doc/style.css'
const doc = new LarkDoc({ element, ... })   // 门面统一，三个产物档共用
```

### 阶段 0 · 基线与文档口径收口

**对外无变化**（纯内部准备）。基线从 `origin/master`（v0.11.6）切出，合入 `next/0.12` 的 155 个提交。

| 项 | 变化 |
|---|---|
| 文档口径 | 统一为 `import { LarkDoc } from 'lark-doc'`；`createLarkDoc` 保留导出但不再写进文档 |
| `check:quick` | `_codex/gen-contract.mjs` 未入库导致红 → 迁到 `scripts/gen-contract.mjs` |
| eslint | `__webpack_public_path__` 声明为 writable，消 4 个既有误报 |
| vitest | 关 isolate + pool forks：73 files / 1709 tests 从 409s 降到 157s |
| 构建告警 | 摘掉全库唯一的 SFC 样式块 → `src/styles/code-block.css`，构建零告警 |
| 主题 token | 修正则隔行漏报（去 `g` 标志）+ AI 预览富文本收编为 7 个 `--ld-ai-rich-*` token，基线清零（264 文件 / 0 违例） |
| 构建稳定性 | 新增 `LARK_DOC_NO_PARALLEL`：多核机器上 thread-loader 偶发 `Broker request timed out` / `write EPIPE`，设它关并行即可稳定复现（不设时保持 vue-cli 默认，CI 不受影响） |

判据：`check:gate` EXIT=0、`check:artifacts` EXIT=0、七产物齐全、size-limit 全绿。

### 阶段 1-A · 包契约收敛

**对外变化**

| 项 | 变化 | 是否 BREAKING |
|---|---|---|
| `browser` 字段 | **删除** | 否（0.12 及以前指向 UMD，是 bug 不是特性；删掉后 webpack4/5 与 vite 才不会被拖进 UMD 档。webpack4 宿主改用**一行 alias** 到 CJS 档，见阶段 1-C） |
| `unpkg` / `jsdelivr` | 由 `dist/lark-doc.umd.min.js` 改指 **`dist/lark-doc-element.umd.min.js`** | 否（CDN 直挂本来就该挂元素档：自带内联 Vue、`<lark-doc>` 开箱可用） |
| `sideEffects` | 由 `["**/*.css","**/*.scss","dist/*"]` 收窄为 **CSS/SCSS + UMD/CJS 档** | **是**（见下） |
| `exports` | 新增 `./lite`、`./features/*`、`./plugin`；保留 `./dist/*` 逃生口 | 否（新增；三个子入口的产物都在阶段 4 / 4 / 6 落地） |

**BREAKING 说明（唯一一条）**

`sideEffects` 不再含 `dist/*` —— 打包器现在认为 **`dist/lark-doc.esm.js` 是纯模块**。
如果你的代码里有「`import { X } from 'lark-doc'` 但一个导出都不用」这种写法，`X` 之外的整个包会被**整体丢弃**（这正是目的）。

需要保留副作用的入口请显式写副作用导入，它们不受影响：

```js
import 'lark-doc/element'          // 自定义元素自注册 —— 保留
import 'lark-doc/style.css'        // 样式 —— 保留
```

**样式本来就要求显式引入**（所有产物都是 CSS 抽取产物，JS 不带注入逻辑），所以这一条对按文档接入的宿主零影响。

**实测（`npm run check:pkg` 之外的人工验证，webpack 5 / Vite 8 双端）**

| 入口写法 | webpack 5 | Vite 8（rollup） |
|---|---|---|
| `import { LarkDoc } from 'lark-doc'`（不使用） | `151 B`（收窄前 `1,922,452 B`） | `0.05 kB` |
| `import 'lark-doc/element'`（纯副作用） | `1,695,666 B` 保留 | 保留 |
| `import { TOOLBAR_KEYS } from 'lark-doc'` | `1,922,429 B` | — |

字体（KaTeX 28 个 woff/woff2）在两端都被自动 emit，无需任何 `public/` 手工拷贝。

**新增校验**

- `npm run check:pkg`（已挂进 `check:deploy`）：校验 `exports` / `main` / `module` / `unpkg` / `files` / `sideEffects` 的每个落点真实存在，并禁止 `browser` 字段复活、`sideEffects` 回到 `dist/*` 一网打尽写法。

### 阶段 1-B · 钉死闸门（与 1-A 同批）

**纯内部加固，对外无变化**：`scripts/check-architecture.js` 追加 R1 / R2 / R3 三条闸门，防止架构在后续阶段悄悄回退。

| 闸门 | 守什么 |
|---|---|
| R1 | `src/core/**` 零框架引用 —— 禁 `vue` / `@tiptap/vue-*` / `@vue/*` / `.vue`（当前 117 个文件全过） |
| R2 | `.vue` 清单**只减不增**（基线固化在 `scripts/architecture-baseline.json`） |
| R3 | 挂载器契约恰好五个动作：`mount` / `update` / `destroy` / `getInstance` / `getRoot`，不多不少 |

顺手修正：`src/mount/vueRenderer.js` 头部注释写「四个动作」，实际导出五个（`getRoot` 是第五个）。

### 阶段 1-C · webpack 4 只留一行 alias

删掉 `browser` 字段的副作用是：webpack4 顺着 `resolve.mainFields`（默认 `['browser','module','main']`）会落到
`module` → `esm.js`，而 esm 档里有 `new URL('./fonts/x.woff2', import.meta.url)`，acorn 6.4.2 解析不了 →
`Module parse failed`。

解决办法不是把 `browser` 加回来（那等于把这份 SD 的老毛病恢复），而是**把 webpack4 唯一还会吃的那一档
——CJS——也降到 ES2018**，然后让宿主用一行 alias 明确指过去：

```js
// vue.config.js —— 唯一的编译工具配置
resolve: { alias: { 'lark-doc$': 'lark-doc/dist/lark-doc.common.js' } }
```

**内部改动**

| 项 | 变化 |
|---|---|
| `npm run build` | 加 `LARK_DOC_LEGACY=1`：CJS 档与 UMD / element 同享 `legacy-syntax.js` 的语法降级（可选链 / 空值合并 / 逻辑赋值 / 数字分隔符 / 省略绑定 catch / class 字段） |
| 产物 | `dist/lark-doc.common.js` 现在是 ES2018（此前含 454 处 `?.` / 300 处 `??`，webpack4 直接拒编译） |
| `npm run check:legacy` | **新增闸门**（已挂进 `check:artifacts`）：用 acorn 以 `ecmaVersion 2018` 真实解析 `common.js` / `umd.min.js` / `element.umd.min.js`，任一份降级失效立刻 EXIT=1 |
| size-limit | ESM 285 → **290 kB**、CJS 2500 → **2600 KB**：阶段 2 把代码块 NodeView 下沉进 core 后主包真实增重 2.4 kB，降级又给 CJS 加了 ~1%。两档都会在阶段 3（CJS 拆块）/ 阶段 4（`features/*` 子路径）回落 |

顺带的收益：webpack4 走 CJS 档后拿到的是**单文件、区块全内联**的形态，所以不再出现「首屏正常、一插公式就 404」，
`window.__LARK_DOC_PUBLIC_PATH__` 对它也不再需要（只有继续用 UMD / element 旁挂懒区块档时才设）。

代价：宿主必须显式引样式（`import 'lark-doc/dist/lark-doc.css'`）——CJS 档是 CSS 抽取产物，不像 UMD 那样随 JS 注入。
这条本来就是硬要求，见 README「样式」一行。

### 阶段 2 · 摘掉 `@tiptap/vue-2`

**对外无变化**（Vue 仍在 `peerDependencies` 里，阶段 3 才摘）。三处 `@tiptap/vue-2` 引用全部清零：

| 位置 | 改法 |
|---|---|
| `LarkDocEditor.vue` | `Editor` 改从 `@tiptap/core` 引入；`<editor-content>` 换成把容器元素交给 `new Editor({ element })` 原生挂载 |
| `adapters/vue2/nodeviews.js` | 清空 —— 不再注册任何 NodeView，仅保留 `registerVue2NodeViews()` 作为宿主覆盖用的注册表缝 |
| `adapters/vue2/CodeNode.vue` | **删除**（323 行），逻辑全量平移进新增的 `src/core/nodeviews/code-block.js`（431 行纯 DOM，三端共用） |

**源码结构调整**

- `diagram.js` / `themeSignal.js` 由 `src/components/lark-doc/` 下沉到 `src/core/`（R1 不允许 core 的 NodeView 反向引 UI 层）；原路径保留 5 行 `export *` shim，旧导入路径继续可用。
- R2 基线随之由 38 条收紧到 **37 条**。

**代码块行为逐条对齐原 Vue 实现**：懒加载 highlight.js（chunk `highlight`）、Mermaid 图表 300ms 防抖 + 版本号丢弃过期结果、正文轨换档只对图表块重画。唯一的可视差异是**语言下拉由 `LarkDocSelect.vue` 换成原生 `<select>`** —— core 不许引 `.vue`，而 `code-block.css` 里本就有 `.lark-doc-code-toolbar select` 这条规则，样式已经就位。

### 阶段 3 · 三产物 + 统一门面

**对外变化**

| 项 | 变化 | 是否 BREAKING |
|---|---|---|
| UMD 档 `dist/lark-doc.umd.min.js` | **不再产出**（`exports["."]` 只剩 esm / cjs 两档） | **是**（见下） |
| 门面 | 统一为 `new LarkDoc(options)`；原 `FeishuDocument` 等具名导出保留 | 否 |
| `peerDependencies` | **删除 `vue`** | 否（Vue 从这一版起被内联进 esm / cjs 产物，宿主不需要装） |
| CJS 档 | 由单文件改为 **主文件 + 5 个按需区块**（`highlight` / `markdown` / `math` / `mermaid` / `office`） | 否（webpack4 走 CJS 的宿主现在也要拷区块，阶段 6 的 plugin 会替你做） |

**BREAKING 说明**

UMD 退场。仍在 `<script src=".../lark-doc.umd.min.js">` 直挂的宿主请改挂 **element 档**
（`unpkg` / `jsdelivr` 从 0.12 起就已指向它）：

```html
<script src="https://unpkg.com/lark-doc"></script>   <!-- 自带内联 Vue，<lark-doc> 开箱可用 -->
```

**内部改动**：Vue 内联分两条路 —— `build`（CJS）与 `build:element` 走 vue-cli 的
`--inline-vue`；`build:esm` 是自写脚本，靠 `vue.config.js` 对 esm 把 `externals` 取空实现
（ESM 档没有 `--inline-vue` 这个开关）。`scripts/check-legacy-syntax.js` 把 ES2018 语法地板
纳入 `check:artifacts`。实测：CJS 主文件 4.14 MB + 5 个按需区块。

### 阶段 4 · 特性子路径 + 资源本地化

**对外变化**

| 新增子入口 | 产物 | 装载的依赖 |
|---|---|---|
| `lark-doc/features/math` | `dist/features/math.js` | katex |
| `lark-doc/features/mermaid` | `dist/features/mermaid.js` | mermaid |
| `lark-doc/features/highlight` | `dist/features/highlight.js` | highlight.js |
| `lark-doc/features/markdown` | `dist/features/markdown.js` | marked + turndown |
| `lark-doc/features/office` | `dist/features/office.js` | docx + mammoth |
| `lark-doc/lite` | `dist/lark-doc-lite.esm.js` | 以上七个**全部**置空 |

- **默认行为不变**：七个可选依赖仍是按需加载，宿主什么都不用改。
- **`lark-doc/features/*` 是「恢复能力」用的**：显式 import 后对应能力立刻可用，不再等懒加载
  （内网 / 离线环境下这是唯一形态，因为懒加载的 chunk 可能取不到）。
- **`lark-doc/lite` 是「确定不要」用的**：产物里这七个依赖被换成求值即抛错的 stub，
  体积只比全量小约 13 KB gzip —— 主包里绝大部分是我们自己的源码，不是可选依赖。
  别把 lite 当「精简版」期待。

**内部改动**：新增 `src/core/features/registry.js`（`loadFeature` / `registerFeature`）与
`src/core/features/stub.js`。**资源全部本地化**：断网渲染 mermaid 由
`scripts/verify-offline-mermaid.mjs` 实测，`check:offline` 扫描产物内无外链。

### 阶段 5 · UI 原生化（删 29 个 SFC）

**对外无变化**，纯内部重构：29 个 `.vue` 子组件改成 `src/ui/*.js` 原生 DOM 工厂（本阶段累计 30 个），
`UiMixin` 统一 mount / update / destroy / refresh。R2 基线 37 → **8**。

| 批次 | 范围 | 浏览器断言 |
|---|---|---|
| 5-A | 气泡条 | 44 条 |
| 5-B | 工具栏 / 顶栏 | 51 条 |
| 5-C | 块句柄 / 块菜单 / 命令菜单 | 37 + 48 条 |
| 5-D | 五个弹窗 | 52 条 |
| 5-E | 目录 / 历史 / 评论 / 另存为 | 87 条 |
| 5-F | 幻灯片演示舞台 | 33 条 |
| 5-G | 提及 / 日程 / 修订 / ISV / 颜色 / callout / 表格工具 / 搜索 / 帮助圆钮 | 复用 5-D~5-F |

每批都是**先补断言再改**，改造前后同一套断言、不放宽。

### 阶段 6 · 官方构建插件

**新增**：`lark-doc/plugin`（一套实现同时出 vite / webpack / rollup / rspack 适配器），
产物 `dist/plugin.mjs` + `dist/plugin.cjs`，`exports["./plugin"]` 按 import / require 分流。

只做四件事：**拷资源**（KaTeX 字体 + element 按需区块）、**注入 basePath**、**dev 静态中间件**、
**可选注入样式**（`injectStyles`）。

```js
// vite.config.js
import larkDoc from 'lark-doc/plugin'
export default defineConfig({ plugins: [larkDoc()] })
```

已接入：`react-vite` / `vue3-vite` 各自换成一行 `larkDoc()`。
未完成：`vue2-webpack-node14` 的手写 copy / alias / static 仍是旧写法（见阶段 7「未完成」）。

### 阶段 7 · 收尾（本轮只做了一半）

**已落地**：再删 5 个 SFC（`ExportDialog` / `LarkDocIcon` / `LarkDocSelect` / `PermissionDialog` /
`SharePopover`），R2 基线 8 → **3**；抽出 `src/editor/EditorController.js`、
`src/workspace/WorkspaceController.js`、`src/ui/templateLibrary.js`；新增 opt-in
`src/mount/domRenderer.js`（`setRenderer(domRenderer)` 可试跑无 Vue 路径）。

**未完成（顺延 0.14）**

| 项 | 现状 | 0.14 要做 |
|---|---|---|
| 默认 renderer | `src/mount/index.js` 仍是 `createVue2Renderer()` | 删 `vueRenderer.js`，默认切 `domRenderer` |
| `build:element` | 仍带 `--inline-vue` | 去掉，element gzip 预计 462.7 KiB → 约 447 KiB |
| `peerDependencies` | 仍含 `@tiptap/vue-2`（optional） | 删除 |
| 剩余 3 个 SFC | `LarkDocEditor.vue`(676) / `LarkDocWorkspace.vue`(780) / `TemplateLibrary.vue`(183) + `editor/` 下 46 个 mixin | 全部原生化 |
| vue2 demo | 手写 copy / alias / static 约 19 行 | 换成一行 `larkDoc()` |

### 本轮构建与门禁修复

- **lite 契约静默失效**（已发生两次，都不是报错而是「没检查」）：
  ① esm / lite 同为 `target=esm`，共用 webpack filesystem cache → stub alias 被绕过，产物与全量区块逐字节相同；
  ② `dist` 按全仓约定不清理，而区块集合会随 stub 化变化（markdown / highlight 塌成同一个 stub 后被别的区块吸收），
  上一版同名文件带着真依赖留在 dist 里，闸门读到的是旧内容。
  处置：`scripts/check-lite-artifacts.js` 改用 **7 个重依赖指纹双向校验**（负向：任何 lite 产物不许出现；
  正向：同一指纹必须能在全量产物里找到，防指纹失效后假通过），并把 `check:lite` 并进 `check:artifacts`；
  `scripts/build-lite.js` 收尾自清本轮未产出的 `lite.*`；`vue.config.js` 的 `cache.name` 追加
  `LARK_DOC_CACHE_FLAVOR`。实测 19/19，负向已验证会红。
- **size-limit 五档预算重标**（旧预算是被手工 `gzip -9` 的读数定穿的，差约 1 KB）：
  ESM 320 KB / element 490 KB / CJS 1170 KB / collab 90 KB / lite 308 KB，各留约 2% 余量。
  ESM 与 lite 的上涨是阶段 5~7 抽出 `src/ui/*` 的真实增量，**V2 删掉三个主壳 SFC 后必须重测回收**。
