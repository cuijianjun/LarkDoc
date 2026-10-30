# lark-doc 终极方案（多环境统一 × 框架无关 · 合并版）

> 本文由 `MULTI_ENV_PLAN.md`（对外：宿主怎么引入）与 `FRAMEWORK_AGNOSTIC_PLAN.md`（对内：包内部怎么写）合并而成，**是唯一路线源**。那两份保留为细节备查，遇冲突以本文为准。
>
> 动 `src/` 之前先读本文；动任何一行代码之前先读 `DEVELOPMENT.md`。
>
> - 基线：`next/0.12` HEAD `837e329`，`package.json` version `0.12.1`
> - 撰写日期：2026-10-29
> - 文中所有「实测」均指在本地工作区对上述 HEAD 跑出来的数字

---

## 0. 一句话结论

两份方案问的是同一件事的两端，答案收敛到同一句话：

**对外只剩「一个元素 + 一个函数 + 三套运行时产物」，对内只剩「零框架内核 + 原生 DOM UI」——两轴在 `src/mount/` 这个早已存在的渲染接缝上会合。**

```
现在    对外：7 个发布面 / 3 种入口写法 / 5 套运行时产物 / 宿主要配 publicPath
        对内：core(零框架) → components(38 个 Vue2 SFC) → mount/vueRenderer

终局    对外：esm / cjs / element 三套运行时 + N 个零成本子入口
              <lark-doc> 元素 ｜ new LarkDoc({ element: el, ...opts }) ｜ 可选 vue3/react 薄壳
              宿主配置 0 行，内网可离线
        对内：core(零框架) → ui(原生 DOM)          → mount/domRenderer
                  ↑ 已达标        ↑ 唯一要干的活           ↑ 接缝早已存在
```

我们**不需要重写产品**：内核 `src/core` 已经是零框架的（114 个 js / 0 个 `.vue`），`src/mount/` 的 renderer 契约也早就带替换钩子。差的只有 UI 层，以及对外契约的收敛。

---

## 1. 合并口径：原 P0–P4 与 S0–S4 的对应与去重

| 原 `MULTI_ENV_PLAN`   | 原 `FRAMEWORK_AGNOSTIC_PLAN` | **合并后阶段**                 | 说明                                                                                |
| -------------------- | --------------------------- | ------------------------- | --------------------------------------------------------------------------------- |
| —                    | **S0** 0.13 打包收口            | **阶段 0**（代码已写，**未提交未发版**） | 实测 `browser` 仍 = `dist/lark-doc.umd.min.js`，说明 S0 尚未生效；`git status` 有 14 个改动文件待提交 |
| **P0** 契约收敛          | —                           | **阶段 1-A**                | `sideEffects` / `browser` / `exports`                                             |
| —                    | **S1** 架构闸门 R1/R2/R3        | **阶段 1-B**                | 与 1-A 同批做，同为「零风险、当天可完成」                                                           |
| —                    | **S2** 摘 `@tiptap/vue-2`    | **阶段 2**                  | **提前到 P1 之前**：独立性最强，且它决定了 P1 的门面能不能真正宣称「零框架」                                      |
| **P1** 三产物 + 统一门面    | —                           | **阶段 3**                  |                                                                                   |
| **P2** 特性子路径 + 资源本地化 | —                           | **阶段 4（内网命门）**            |                                                                                   |
| —                    | **S3** UI 原生化               | **阶段 5（长线，可与其他阶段穿插）**     | 5 批，每批独立发 MINOR，随时可停                                                              |
| **P3** 官方插件          | —                           | **阶段 6**                  |                                                                                   |
| **P4** 内核去框架化        | **S4** 收尾                   | **阶段 7（合并，删除重复）**         | 这两条本就是同一件事：补 DOM renderer 与删 vue2 renderer 是一个动作的两面                               |

**去重结果**：原 10 个阶段 → **8 个阶段**（0–7）。原 P4 与 S4 合并，是唯一一处实质重叠。

---

## 2. 标杆实证：七家教了我们什么

### 2.1 事实对比

外部七家为公开资料与 registry 实测，最后一行是本地 HEAD `837e329` 实测。

| 项目                      | 核心依赖                                                             | UI 谁写                           | 发布面                                          | 模块格式 / UMD                      | 宿主配置量                  |
| ----------------------- | ---------------------------------------------------------------- | ------------------------------- | -------------------------------------------- | ------------------------------- | ---------------------- |
| **Tiptap 3.32**         | `@tiptap/core` 的 `dependencies` = **`{}`**                       | **不写**（headless）                | core + 3 个框架适配包                              | ESM + CJS／**无 UMD**             | **0 行**                |
| **Lexical**（Meta）       | `@lexical/core` 零 UI 框架，自带 DOM reconciler                        | 宿主写（官方只给 binding）               | `lexical` + bindings                         | ESM／无 UMD                       | 0 行                    |
| **AIEditor 2.0**        | tiptap + 45 个扩展 + katex / lucide / floating-ui 等，**一个 UI 框架都没有** | **原生 DOM 手写**                   | exports 只有 `"."` 与 `"./style.css"` **两条**    | ESM／无 UMD                       | 0 行                    |
| **Milkdown**            | monorepo 按 package 拆分，UI 与框架分属不同包                                | headless + 宿主集成                 | 按 package 按需装                                | ESM／无 UMD                       | 0 行                    |
| **Swiper 12**           | 单包                                                               | 自带                              | `css` / `modules` / `element` / `bundle` 子路径 | **纯 ESM**（v7 起弃 CJS）／无 UMD      | 0 行                    |
| **Element Plus**        | 单包                                                               | 自带                              | 主入口 + unplugin 组件级按需                         | ESM + 全量 CSS／无 UMD              | **1 个插件**              |
| **Monaco**              | 单包，但多出 worker + CSS + 字体三件套                                      | 自带                              | `esm/vs/...` 子路径                             | ESM + AMD(min)／无 UMD            | **中~高**（worker 必配）     |
| **lark-doc 0.12.1**（我们） | `core` 零框架，但 Vue 2 在 UI 层                                        | **Vue 2 SFC 手写**（38 个 / 7370 行） | dist 22 个文件 + `exports` 9 条                  | esm / cjs / umd / element 四套运行时 | 要配 `publicPath`（UMD 档） |

### 2.2 六条可迁移的规律

| # | 规律                                   | 出处                                                          | 我们达标了吗                                                |
| - | ------------------------------------ | ----------------------------------------------------------- | ----------------------------------------------------- |
| 1 | **只发 ESM(+CJS)，不维护第二套运行时产物**         | Tiptap / Swiper / Lexical                                   | 未达标 —— 我们有 esm / cjs / umd / element 四套               |
| 2 | **子路径 = 特性开关**                       | Tiptap `pm/*` 13 个、Swiper `css`/`modules`、Monaco `esm/vs/*` | 部分 —— 有 `./collab`，但无 `./lite`、无 `./features/*`       |
| 3 | **重依赖做命名空间 shim，绝不内联**               | Tiptap `pm/state` 全文只有 `export * from "prosemirror-state"`  | **未达标** —— mermaid 被内联进 CJS，这是 8.5 MB 的主因             |
| 4 | **配置体力活收进官方插件**                      | Monaco plugin、Element Plus unplugin                         | 未达标 —— 各 demo 手写 `copy-webpack-plugin`                |
| 5 | **`sideEffects: false` + 单一 CSS 入口** | Tiptap 零 CSS、AIEditor 只留 `./style.css`                      | **未达标** —— `sideEffects` 含 `dist/*`，tree-shaking 完全失效 |
| 6 | **自有 UI 也不用 UI 框架写**                 | AIEditor / Lexical                                          | **未达标，唯一一条架构级欠账**                                     |

> 规律 5 是最要紧的一条：`sideEffects` 里的 `"dist/*"` 把整个 dist 标成有副作用，**现在任何 tree-shaking / 按需承诺都是空的**。这条不改，后面所有体积动作都白做。



---

## 3. 现状实测

### 3.1 对外契约（`package.json` 实测）

```jsonc
{
  "version": "0.12.1",
  "main":    "dist/lark-doc.common.js",
  "module":  "dist/lark-doc.esm.js",
  "browser": "dist/lark-doc.umd.min.js",   // ← 老 webpack4 会被它拖进 UMD 档
  "unpkg":   "dist/lark-doc.umd.min.js",
  "sideEffects": ["**/*.css", "**/*.scss", "dist/*"],   // ← tree-shaking 失效元凶
  "exports": { ".", "./element", "./vue3", "./react",
               "./adapters/vue3", "./adapters/react",
               "./collab", "./style.css", "./dist/*" }   // 9 条
}
```

### 3.2 产物实测（`dist/`，未压缩）

| 产物                                 | 主文件           | 按需块                                                                                       | 判定                                                              |
| ---------------------------------- | ------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `lark-doc.esm.js`                  | **1026.7 KB** | tiptap 456.7 / vendor 103.0 / highlight 52.9 / math 375.9 / office 821.2 / mermaid 3260.7 | 最干净的一档，重特性已拆出                                                   |
| `lark-doc.umd.min.js`              | **1594.8 KB** | highlight 53.0 / math 378.5 / mermaid 3263.0 / office 826.0                               | 拆块已生效，但宿主需配 publicPath                                          |
| `lark-doc-element.umd.min.js`      | **1635.0 KB** | 同上 4 块                                                                                    | 战略产物，但 Vue 2 内联                                                 |
| `lark-doc.common.js`               | **8757.0 KB** | **0**                                                                                     | `LimitChunkCountPlugin=1` 把 mermaid 全内联 → Node 侧一 require 吃掉整棵树 |
| `lark-doc.css`                     | 474.6 KB      | —                                                                                         | 单入口已存在（好底子）                                                     |
| `lark-doc-vue3.mjs` / `-react.mjs` | 3.0 / 4.2 KB  | —                                                                                         | 薄壳，成本可忽略，值得保留                                                   |
| `lark-doc-collab.esm.js`           | 6.8 KB        | —                                                                                         | 独立子入口，符合规律 2                                                    |

> gzip 口径（size-limit 实测）：esm 主包 272.5 KiB（门禁 285 KB）、umd 446.7（465）、element 462.7（480）、common 2399.4（2500）。

### 3.3 内部分层实测（`src/` 一级目录）

| 目录                                                      | js      | js 行数     | `.vue` | vue 行数   | 判定                                                                      |
| ------------------------------------------------------- | ------- | --------- | ------ | -------- | ----------------------------------------------------------------------- |
| `core`                                                  | 114     | 20369     | **0**  | 0        | 零框架内核（blocks 42 / commands 15 / nodeviews 11 / derive 2 / versioning 7） |
| `providers`                                             | 17      | 1059      | **0**  | 0        | 干净                                                                      |
| `collab`                                                | 4       | 565       | **0**  | 0        | 干净                                                                      |
| `utils`                                                 | 7       | 1982      | **0**  | 0        | 干净                                                                      |
| `session` / `registry` / `assets` / `styles` / `legacy` | 12      | 3758      | **0**  | 0        | 干净                                                                      |
| `web-component`                                         | 7       | 730       | **0**  | 0        | 已是纯 DOM 外壳                                                              |
| `mount`                                                 | 2       | 120       | **0**  | 0        | **渲染接缝，已带替换钩子**                                                         |
| `components`                                            | 41      | 8628      | **37** | **7008** | UI 层，Vue 2 全在这里                                                         |
| `adapters`                                              | 4       | 231       | **1**  | 362      | 仅 `vue2/CodeNode.vue` 一个 NodeView SFC                                   |
| **合计**                                                  | **209** | **37577** | **38** | **7370** |                                                                         |

关键事实：**全仓库显式 `from 'vue'` 的文件只有 1 个** —— `src/mount/vueRenderer.js`。Vue 的入口在法律意义上已经收得极窄；真正的耦合面是「37 个 SFC 的模板语法 + mixin 的响应式假设」，而不是散落的 `import Vue`。

### 3.4 三个 `@tiptap/vue-2` 耦合点（全仓库就这三处）

| 位置                                              | 用了什么                                                    | 摘除代价                                                                         |
| ----------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `src/components/lark-doc/LarkDocEditor.vue:161` | `Editor` / `EditorContent`                              | 低 —— `EditorContent` 干的事就是新建 `<div>` 后 `append` 编辑器 DOM，十几行原生代码              |
| `src/adapters/vue2/nodeviews.js:12`             | `VueNodeViewRenderer`                                   | 中 —— 换成 core 原生 NodeView（`constructor` 建 DOM / `update` 增量 / `stopEvent` 自拦） |
| `src/adapters/vue2/CodeNode.vue:98`             | `NodeViewWrapper` / `NodeViewContent` / `nodeViewProps` | 中 —— 随上一项一起改                                                                 |

### 3.5 已经就位的资产（我们比七家都容易的底气）

| 资产          | 位置                                                                     | 作用                                           |
| ----------- | ---------------------------------------------------------------------- | -------------------------------------------- |
| renderer 契约 | `src/mount/index.js`（`createRenderer` / `setRenderer`）                 | 阶段 7 只差一份 DOM renderer，**不用改内核**             |
| 命令式门面       | `src/LarkDoc.js` 的 `new LarkDoc(...)` + `src/index.js` 已导出                | 阶段 3 的统一入口**已存在**，只差文档化与其他两端对齐               |
| 元素门面        | `src/web-component/index.js` 的 `mountLarkDoc` / `createLarkDocElement` | 元素档已支持 `<script src>` 直挂（源码注释明写），可作为唯一 CDN 档 |
| 单一 CSS      | `dist/lark-doc.css` 474.6 KB，`./style.css` 已在 exports                  | 规律 5 的一半已达标                                  |
| 离线门禁        | `scripts/check-offline-assets.js`（`npm run check:offline`）             | 阶段 4 直接扩展，不必新造                               |
| 架构门禁        | `scripts/check-architecture.js`（216 行，已在 `npm run check` 链里）           | 阶段 1-B 追加规则零成本                               |

> 顺带纠正一个常见误判：**去 Vue 的收益不在体积**。Vue 运行时只占 UMD 首屏 446.7 KiB 的约 4%。真正的长期理由是 Vue 2 已于 2023-12-31 EOL，而我们是内网私有化部署，长期锁 Vue 2 是实打实的债。

---

## 4. 终局目标形态

### 4.1 对外契约（目标 `package.json` 关键片段）

```jsonc
{
  "type": "module",
  "sideEffects": ["**/*.css", "**/*.scss"],      // ← 去掉 "dist/*"，tree-shaking 才成立
  "main":    "./dist/lark-doc.cjs",
  "module":  "./dist/lark-doc.esm.js",
  // browser 字段删除：不做环境特判，浏览器/SSR 吃同一份（Tiptap 同款做法）
  "unpkg":   "./dist/lark-doc.element.js",       // CDN 直挂只留元素档
  "exports": {
    ".":            { "types": "./dist/index.d.ts", "import": "./dist/lark-doc.esm.js", "require": "./dist/lark-doc.cjs" },
    "./element":    "./dist/lark-doc.element.js",        // <lark-doc>，兼 CDN <script> 直挂
    "./lite":       "./dist/lark-doc-lite.esm.js",       // 无 mermaid / office / katex
    "./features/*": "./dist/features/*.js",              // mermaid / office / math / markdown / highlight
    "./collab":     "./dist/lark-doc-collab.esm.js",
    "./vue3":       "./dist/lark-doc-vue3.mjs",          // 可选糖衣，非必需
    "./react":      "./dist/lark-doc-react.mjs",         // 可选糖衣，非必需
    "./style.css":  "./dist/lark-doc.css",               // 唯一 CSS 入口
    "./plugin":     "./dist/plugin.mjs"                  // unplugin（阶段 6）
  }
}
```

三种宿主写法收敛成一句：

```js
import { LarkDoc } from 'lark-doc'
import 'lark-doc/style.css'
const doc = new LarkDoc({ element: el, content, readonly })
doc.on('change', fn); doc.destroy()
```

无构建场景用元素档（`<script src>` 直挂，**不设 publicPath**）：

```html
<script src="./lark-doc.element.js"></script>
<lark-doc readonly theme="light"></lark-doc>
```

框架宿主想要组件糖衣，走可选薄壳：`lark-doc/vue3`、`lark-doc/react`（各 3~4 KB，**不内置第二套 UI 实现**）。

### 4.2 对内七层单向依赖

```
L0  基础        utils / exception / networkPolicy / theme tokens
L1  文档内核    core（schema · blocks · commands · derive · nodeviews · decorations）  零 UI、零框架，Node 里能跑
L2  数据与接入  session / providers / collab / storage / registry
L3  特性单元    Feature Unit = 节点 + 命令 + 快捷键 + 装饰 + i18n + tier
L4  UI 层       原生 DOM：toolbar / bubble / block-menu / dialogs / comments / panel
L5  渲染接缝    renderer adapter：mount / update / destroy / getInstance / getRoot
L6  发布面      <lark-doc> Web Component + vue3 / react 薄壳
```

依赖只允许自下而上：`L0..L3` 不得 import `L4/L5/L6`。这条今天已基本成立，**缺的是校验它的断言**。

### 4.3 三条要写进 `check-architecture.js` 的硬规则

| #      | 规则                                                                                                                                       | 落地方式                             |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| **R1** | `src/core`、`session`、`providers`、`collab`、`registry`、`utils` 下任何文件不得出现 `from 'vue'`、`from '@tiptap/vue-*'`、`from 'react'` 等 UI 框架 import | 直接硬失败（当前应全绿，作用是防回潮）              |
| **R2** | `src/components` **新增**文件一律禁止引入 UI 框架；存量走**白名单清单**，断言清单只减不增                                                                              | 白名单固化当前 38 条，谁加新 SFC 就必须改清单，评审可见 |
| **R3** | `L0..L3` 不得 import `L4/L5`（反向依赖）                                                                                                         | 静态扫描 import 路径                   |

### 4.4 明确「不做」的事（写下来防止日后被重提）

| 提议                                | 为什么不采纳                                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 在包里内置 Vue 3 渲染器                   | 等于同时维护两套 UI 实现，成本与回归面都翻倍；Vue 3 宿主用 `<lark-doc>` 元素已拿到完全一样的能力                                            |
| 把内部 UI 组件也做成 Web Component        | 编辑器内部组件需要高频同步的父子树与大量 props 传递，Shadow DOM + attribute 序列化在这个密度下更慢且更难调。Web Component 适合当**边界**，不适合当内部实现机制 |
| 一把梭全量重写 UI                        | 37 个 UI 模块里踩过的坑（垂直居中 1px、标题下拉三入口、折叠取缩进子树、浮层避让吸顶栏、列表序号顶格）会全部重新验收一遍，风险远大于收益                               |
| 库内运行时 chunk loader                | Monaco 的痛。分块永远归宿主打包器，库不做 `import()` 路由                                                                  |
| 多套「环境专用产物」（webpack4 版、vue-cli 版…） | 老化包袱就是这么来的                                                                                              |
| 第二套皮肤 / CSS 入口                    | `lark-doc/style.css` 唯一                                                                                 |
| 与 TypeScript / SWC 迁移合并推进         | 另一条工程线，与本方案正交。混一起会让「是编译坏了还是重构坏了」无法归因                                                                    |
| **任何默认从 CDN 拉资源的设计**              | 内网就是故障源（Monaco `loader.config({paths:{vs}})` 是反面教材）                                                     |


### 4.5 终局接入矩阵（六个环境，一份口径）

**一致性判定：分两级达成，不是一次到位。**

- **L1 写法一致（阶段 3 达成）**：六个环境都写 `new LarkDoc({ element: el, ...opts })`，API 面 `{ on, destroy, getJSON, setJSON }` 完全相同。
- **L2 路径一致（阶段 7 达成）**：连 `from 'lark-doc'` 这个路径都统一 —— 阶段 7 前 Vue3 / React 必须走 `lark-doc/element`（源码入口含 Vue 2 SFC，这是硬约束），阶段 7 删掉 Vue 后自然消失。

| # | 环境 | 安装 | 引入 | 宿主配置 | 生效阶段 |
|---|---|---|---|---|---|
| 1 | **Vue 2**（webpack4 / vue-cli，我们的主战场） | `npm i lark-doc` | ```import { LarkDoc } from 'lark-doc'```<br>```import 'lark-doc/style.css'``` | **1 行** `larkDoc()`（webpack4 是唯一必装 plugin 的环境，见 §4.8 #1；现在手写 ~19 行） | 3 |
| 2 | **Vue 3**（vite） | 同上 | 阶段 7 前 `from 'lark-doc/element'`；<br>阶段 7 后同 #1。<br>想用组件糖衣走 `lark-doc/vue3`（3 KB） | **0 行** | 3 → 7 |
| 3 | **React**（vite / webpack） | 同上 | 阶段 7 前 `from 'lark-doc/element'`；<br>阶段 7 后同 #1。<br>糖衣 `lark-doc/react`（4 KB） | **0 行**（现 ~10 行：2 个 alias 直指 `dist/`、`src/` + optimizeDeps） | 3 → 7 |
| 4 | **无框架 + 构建**（vite / rollup） | 同上 | 同 #1 | **0 行** | 3 |
| 5 | **无构建 / 纯 HTML** | 拷 element 文件进内网静态目录 | ```<script src="./lark-doc.element.js"></script>```<br>```<lark-doc readonly theme="light"></lark-doc>``` | **0 行**，且**不设 publicPath** | 3 |
| 6 | **Node / SSR / 测试** | 同上 | `const { LarkDoc } = require('lark-doc')`<br>（或直接调 JSON 转换 API，不建编辑器） | **0 行** | 3 |

**唯一的不一致只有 #5**，而且它是物理限制不是设计分裂：没有打包器的 HTML 页无法 `import`，只能 `<script>`。这一档同时兼作 CDN 档，`unpkg` 字段指向它，`browser` 字段直接删掉。

**表格里「宿主配置 0 行」的兑现条件**：#1~#4 与 #6 的 0 行，都依赖阶段 6 的 `lark-doc/plugin` —— 由它在构建期搬 `dist/fonts`、element 按需区块，并注入资源基址（详见 4.6）。没有 plugin 之前，宿主就得自己手写那十几行 copy / alias（现有 demo 的实测成本：vue2 约 19 行、react 约 10 行）。

**每个环境具体怎么抄**：见 **§4.8**（逐环境给出安装 / 引入 / 构建配置 / 内网安装的完整代码块）。

**懒加载怎么落**：全部归宿主，库不做运行时 chunk loader（规律 6）。

```js
// ① 路由级（宿主侧，现存 demo 已这么干）
const DocView = () => import('./views/Doc.vue')
// ② 交互级（重特性，阶段 4 后）
const { renderMermaid } = await import('lark-doc/features/mermaid')
// ③ 轻档（不需要重特性时，阶段 4 后）
import { LarkDoc } from 'lark-doc/lite'   // ~300 KB，无 mermaid/office/katex
```

---

### 4.6 `lark-doc/plugin` 规格（阶段 6 交付）

**一句话**：把「宿主为了让 lark-doc 的运行时资源找得到而必须手写的那堆配置」，收成一行 `plugins: [larkDoc()]`。

#### 它到底要解决什么（按 dist 实测，不是假设）

宿主现在要手动处理三件事：

| 宿主必须搬 / 必须配的东西 | 实测来源 | 不配会怎样 |
|---|---|---|
| KaTeX 字体 `dist/fonts/`（实测 **28 个**：14 个 woff2 + 14 个 woff，目录 540 KB） | `src/assets/fonts/katex` | 公式渲染成豆腐块 |
| element 档按需区块 `lark-doc-element.umd.min.{math,mermaid,office,highlight}.js` —— 实测 387.6 KB / 3341.3 KB / 843.8 KB / 54.3 KB，合计约 4.6 MB | 二次打包时它们不在依赖图里，没人拷就丢 | 一点「插入公式 / 导出 Word / 插入流程图」就 404 |
| 资源基址 `__webpack_public_path__` | 现在靠宿主自己写 `window.__LARK_DOC_PUBLIC_PATH__` | 基址推导错 → 404，且排查口诀是「报什么前缀就往哪拷」（`docs/guide/deployment-intranet.md` 第 591 行就是这个现象） |

**手写成活成本（实测）**：

| demo | 手写配置 | 行数 |
|---|---|---|
| `vue2-webpack-node14/vue.config.js` | `copy-webpack-plugin` 两条 pattern（fonts 到 `js/fonts`、element 区块到 `js/`）+ 3 条 dev alias + `devServer.static` 挂 dist 到 `/js/` | 约 19 行 |
| `react-vite/vite.config.js` | 2 个 alias 直指 `dist/lark-doc-element.umd.min.js` 与 `src/adapters/react/index.js` + `optimizeDeps.include` | 约 10 行 |

两边写得还不一样 —— 这就是「配置少」的头号敌人。`plugin` 要消灭的正是这个「每个宿主各写一遍、写法还各不相同」的局面。

#### 职责边界（写死，防止它长成第二个 Monaco）

| 做 | 不做 |
|---|---|
| 拷贝 `dist/fonts` 与 element 按需区块到宿主输出目录 | **不**做源码级按需（不做 Element Plus `resolver` 那种自动 transform） |
| 编译期注入资源基址（`basePath`），替掉全局变量 | **不**自动注册 `features/*` —— 那是 `registerFeature` 的职责 |
| dev 期挂静态中间件，令 dev 与 prod 行为一致 | **不**联网、不 fallback CDN（内网硬性禁止） |
| 可选自动注入 `lark-doc/style.css` | **不**做运行时 loader / 动态 script 注入 |

> 判定标准一眼可查：**plugin 只在构建期干活，产物运行时不会因为它的存在而多出一行业务逻辑。**

#### 开发者怎么用（终局口径）

安装与平时一样，不新增第二个包：

```bash
npm i lark-doc
```

① Vite / Vue 3 / React / 无框架 + Vite：

```js
// vite.config.js
import larkDoc from 'lark-doc/plugin'

export default {
  plugins: [larkDoc()],
}
```

② Webpack 5：

```js
// webpack.config.js
const larkDoc = require('lark-doc/plugin')

module.exports = {
  plugins: [larkDoc.webpack({})],
}
```

③ vue-cli / webpack 4（我们的主 demo 这一档，删掉原有 19 行后只剩这几行）：

```js
// vue.config.js
const larkDoc = require('lark-doc/plugin')

module.exports = {
  chainWebpack(config) {
    config.plugin('lark-doc').use(larkDoc.raw, [{}, { framework: 'webpack' }])
  },
}
```

④ Rollup：

```js
// rollup.config.js
import larkDoc from 'lark-doc/plugin'

export default { plugins: [larkDoc.rollup()] }
```

⑤ 内网自托管（这一步取代原来的全局变量配置）：

```js
// 与 Nginx 上 dist 实际挂载的前缀保持一致即可
larkDoc({ basePath: '/vendor/lark-doc/current/' })
```

#### 选项表

| 选项 | 默认值 | 用途 |
|---|---|---|
| `features` | `'auto'` | 扫描宿主实际会用到的特性，只拷对应区块；不想全拷就写 `['math', 'mermaid']` |
| `basePath` | 宿主 `publicPath` + `lark-doc/` | 运行时资源基址 —— **取代 `window.__LARK_DOC_PUBLIC_PATH__`** |
| `fonts` | `true` | 是否拷 KaTeX 字体；已有自管字体时关掉 |
| `injectStyles` | `false` | 为 true 时在构建产物中发射命名为 `lark-doc.css` 的 CSS asset；不会改写源码 import，也不注入运行时 `<style>` |
| `copyAs` | `'build'` | `'none'` 用于纯 CDN 直挂场景（资源全由 CDN 提供时跳过拷贝） |

#### 终局效果

阶段 6 之后，**任意构建型宿主**的接入只剩两处：

1. `npm i lark-doc`
2. 打包配置里一行 `plugins: [larkDoc()]`

源码里照常写：

```js
import { LarkDoc } from 'lark-doc'
import 'lark-doc/style.css'
```

`window.__LARK_DOC_PUBLIC_PATH__` 这个全局变量从所有文档下线 —— 它不再是「宿主必读章节」，而是 plugin 内部由 `basePath` 编译注入的实现细节。

> **但 plugin 本身能不能也不要？** 见 §4.7 —— 那里给出的结论是：plugin 不删，但从「必装」降级为「可选逃生舱」。

### 4.7 `lark-doc/plugin` 能不能连它也不要 —— Tiptap 式「消灭需求」的三档方案

> 本节回答一个更狠的问题：§4.6 把宿主手写配置收成一行 plugin，那 **plugin 这一行能不能也省掉？**
> 结论先给：**plugin 不删，但从「必装」降级为「可选逃生舱」** —— 默认路径不需要它，它只服务 UMD 档、老打包器和 CDN 自托管三种人。

#### ① Tiptap 有没有同款插件：没有，而且它根本不是靠插件解决的

| 查证项 | 实测 / 出处 |
|---|---|
| 官方安装文档 | 只有 `npm i @tiptap/core @tiptap/pm @tiptap/starter-kit` + `new Editor({ element, extensions })`；Vite / Webpack / Rollup 三档**零构建配置**；CDN 档走 `esm.sh` 的 ESM 直挂 |
| `node_modules/@tiptap/core/dist` 实测 | 只有 `index.cjs` / `index.js` / `index.d.ts` / `jsx-runtime` —— **没有任何 `.css`、没有字体、没有 worker** |
| 有没有 `browser` 字段 | 无（不做环境特判，浏览器与 SSR 吃同一份） |

Tiptap 用的是「**消灭需求**」，不是「提供插件」，三条：

1. **不发 CSS** —— 样式让用户自己写（文档里给一段 copy-paste 的 CSS）。没有 CSS 就没有 `url()` 资源，也就没有字体/图片拷贝这回事；
2. **不发运行时加载的 chunk** —— 我们 `dist` 里那种 `import("./math.esm.js")` 懒区块，Tiptap 里不存在；可选能力一律是**独立 npm 包**（`@tiptap/extension-*`），靠普通 `import` 进宿主依赖图，打包器自己分块、自己算路径；
3. **不做环境特判** —— 无 `browser` 字段，谁都吃同一份。

**一句话对照**：Monaco = 有资源（worker + CSS + .ttf）→ 被迫每家各写一个 plugin；**Tiptap = 没有资源 → 不需要 plugin**。

#### ② 我们为什么需要它：根因只有两条（dist 实测）

| 现象 | 实测证据 | 根因 |
|---|---|---|
| 必须拷 `dist/fonts`（28 个 / 540 KB） | `dist/math.esm.js` 里是 `new URL("./fonts/KaTeX_*.woff2", import.meta.url)`；`dist/lark-doc.umd.min.math.js` 与 element 档里是 `r.p + "fonts/KaTeX_*"`（`__webpack_require__.p`） | 字体是**运行时 CSS 里的 `url()`**，不在宿主依赖图里 |
| 必须拷 element 按需区块（4.6 MB）+ 必须给基址 | `dist/lark-doc-element.umd.min.{math,mermaid,office,highlight}.js` | UMD 是**二次打包的黑盒**，它的懒区块不进依赖图，只能靠 `publicPath:'auto'` 推导（在 vue-cli demo 里被推成 `/js/`） |
| 而 **ESM 档本来不需要** | `dist/lark-doc.esm.js` 里就是 `import("./math.esm.js")` / `import("./mermaid.esm.js")` / `import("./office.esm.js")` / `import("./highlight.esm.js")`；`vue2-webpack-node14/vue.config.js` 注释原文：「ESM 产物（module 字段）走宿主打包器自己分割，不需要拷贝」 | 打包器会自己分块、自己算路径 |

**本节的关键发现**：现在每个宿主都要手写配置，**头号原因不是「有资源」，而是 `package.json` 的 `browser` 字段把浏览器端强制指到了 UMD 档**（`browser = dist/lark-doc.umd.min.js`），绕开了 ESM 那套「打包器自动寻址」。
**阶段 1-A 第 2 条（删 `browser`）一落地，plugin 的必要性直接砍掉一大半。**

#### ③ 三档方案：从「必装」到「可选」再到「可省」

**档 A · 摘 `browser` + 默认走 ESM**（归属阶段 1-A，成本 ≈ 0）

- 动作：删 `browser` 字段；`unpkg` 改指元素档（只给 `<script>` 直挂用）；README 写明「ESM 宿主零配置」。
- 效果：webpack5 / vite 宿主不再需要拷任何东西 —— 区块靠 `import()` 自动分块，字体靠 `new URL(..., import.meta.url)` 自动 emit。
- **必须先验证的三件事（写进 1-A 判据）**：
  1. Vite 项目插公式 → 字体是否被自动 emit 到 `assets/`（Vite 原生支持该语法）；
  2. Webpack 5 同上（webpack5 的 URLPlugin 支持 `new URL(..., import.meta.url)`）；
  3. **Rollup 默认不处理 `new URL(..., import.meta.url)`**（会原样保留 → 运行时 404），需 `@rollup/plugin-url`，或仍走 plugin。**这是档 A 唯一的漏网点。**
- 残留：**webpack4 / CJS 输出不支持 `import.meta`** → 我们的主 demo（vue-cli / webpack4）仍需拷字体。所以档 A 之后 plugin 仍要保留，但只服务 UMD 与老打包器。

**档 B · 把两样资源挪进依赖图**（归属阶段 4）

| 资源 | 做法 | 备注 |
|---|---|---|
| 按需区块 4.6 MB | 不再发预构建 UMD 区块，改发 `lark-doc/features/{math,mermaid,office,highlight}` **源码入口 + 真 npm 依赖**；宿主 `import('lark-doc/features/mermaid')` 后打包器全权接管 | `katex` / `docx` / `mammoth` 已是 `dependencies`；**`mermaid` 现在是 vendored UMD（`src/assets/vendor/mermaid/`），必须先改成 npm 依赖** |
| KaTeX 字体 540 KB | **B2-1（推荐）** 把 KaTeX 样式从「JS 注入字符串」改成**可被宿主 css-loader 处理的 CSS 模块**，按需 `import('lark-doc/katex.css')` —— 保留按需加载，且 `url()` 由打包器 emit | 需确认 webpack4/5 与 vite 都能处理 node_modules 里的动态 CSS import；不能就退回 B2-2 |
| | **B2-2** 字体子集化 + base64 内联进 CSS（常用字形约 50~80 KB），彻底没有文件 | 稀有符号退化到系统字体；构建期多一步子集化 |
| | **B2-3** 保留 `dist/fonts`，由 plugin 拷 —— 现状 | 兜底 |

档 A + 档 B 之后：**除 Rollup 与 webpack4 外，plugin 可以完全不装。**

**档 C · 终局：源码分发 / 能力外置**（与阶段 5 全量、阶段 7 同批）

- **C1 源码分发**：阶段 5 全量完成后源码不含 Vue，可额外开放 `lark-doc/src/*`（`files` 里本来就含 `src`）。愿意吃源码的宿主：所有资源天然进依赖图，plugin 100% 无事可做。
  👉 **这是 UI 原生化的第二重收益：它不只是「去掉 Vue」，它同时是「plugin 可省」的前置条件。**
- **C2 Tiptap Pro 模式**：`mermaid` / `office` / `katex` / `highlight` 改 `optional peerDependencies`，宿主自装自注册。代价：安装从 1 个包变 1+N 个，与「安装简单」冲突 → **只作为 `./lite` 档的可选玩法，不设为默认**。

#### ④ 结论与硬判据

| 项 | 口径 |
|---|---|
| 定性 | plugin 从「**必装**」降为「**可选逃生舱**」 |
| 硬判据（写进阶段 6 门禁） | **六个环境里，删掉 plugin 后全部跑通**：插入公式 / 插入流程图 / 导出 Word 均无 404，且不需要任何 `basePath` 或全局变量配置。达不到 = 档 B 没做完 |
| plugin 保留给谁 | ① element/UMD 档（`<script>` 直挂）② 资源托管到 CDN / 内网统一静态服务并要指定前缀 ③ 老打包器（webpack4、原生 rollup） |
| 一句话 | **Tiptap 的做法是「让需求不存在」；我们做不到 100%（KaTeX 字体与 4.6 MB 按需能力是真需求），但能做到「默认路径不需要 plugin，plugin 只是逃生舱」。** |

#### ⑤ 动作归属

| 动作 | 阶段 |
|---|---|
| 删 `browser`、`unpkg` 改指元素档；验证 vite / webpack5 自动 emit 字体 | **1-A** |
| `mermaid` 从 vendored UMD 改成 npm 依赖；`./features/*` 源码入口 | **4** |
| KaTeX 样式改成可动态 import 的 CSS 模块（或字体子集化内联） | **4** |
| 出 plugin（unplugin）—— 此时它已是可选 | **6** |
| `./lite` 档 + 开放 `lark-doc/src/*`（须在源码无 Vue 之后） | **5 全量后 / 7** |

### 4.8 终局六环境速查：安装 / 引入 / 配置，逐环境展开

> 本节把 §4.5 的矩阵**落成能直接抄的代码**，每个环境都按「安装 → 引入 → 构建配置 → 内网安装差异」四段给出。
> 时间口径：**除注明「阶段 7 前」的行，其余全部是七个阶段做完后的终局形态**。

#### ① 一张总表

| # | 环境 | 安装 | 引入路径 | 宿主构建配置 | 内网安装 |
|---|---|---|---|---|---|
| 1 | **Vue 2** + webpack4 / vue-cli（主战场） | `npm i lark-doc` | `lark-doc` | **1 行** `larkDoc()`（webpack4 必需） | 同公网，换 registry |
| 2 | **Vue 3** + vite | `npm i lark-doc` | `lark-doc` | **0 行** | 同上 |
| 3 | **React** + vite / webpack5 | `npm i lark-doc` | `lark-doc` | **0 行** | 同上 |
| 4 | **无框架 + 构建**（vite / webpack5） | `npm i lark-doc` | `lark-doc` | **0 行** | 同上 |
| 4b | **无框架 + Rollup**（原生） | `npm i lark-doc` | `lark-doc` | **0 行**（须补 `@rollup/plugin-url`） | 同上 |
| 5 | **无构建 / 纯 HTML / CDN** | 拷 1 个文件（不装包） | `<script src>` + `<lark-doc>` | **0 行**，且**不设 publicPath** | 拷目录，不走 registry |
| 6 | **Node / SSR / 测试** | `npm i lark-doc` | `require('lark-doc')` | **0 行** | 同上 |

**一句话**：#1~#4 与 #6 的安装命令**完全一致**（就一个包），#5 是物理限制（没有打包器无法 `import`），
配置行数从「每家各写一遍且写法不同」收敛到 **0 行或 1 行**。

---

#### ② 逐个环境

##### #1 Vue 2 + webpack4 / vue-cli（我们的主战场）

**安装**

```bash
npm i lark-doc --save-exact      # 不需要装 vue / @tiptap/vue-2
```

**引入**（与应用代码其他 import 毫无区别）

```js
import { LarkDoc } from 'lark-doc'
import 'lark-doc/style.css'

export default {
  mounted() {
    this.doc = new LarkDoc({ element: this.$refs.el, content: '<p>hi</p>', readonly: false })
    this.doc.on('change', this.onChange)
  },
  beforeDestroy() { this.doc?.destroy() },
}
```

**构建配置**（`vue.config.js`）

```js
// 终局：1 行。现在手写 19 行（2 条 copy + 3 条 alias + devServer.static 挂 dist 到 /js/）
const { defineConfig } = require('@vue/cli-service')
const larkDoc = require('lark-doc/plugin')

module.exports = defineConfig({
  transpileDependencies: true,
  chainWebpack(config) {
    // webpack4 是 vue-cli 的内置版本，chainWebpack 只能拿到底层 webpack 实例
    config.plugin('lark-doc').use(larkDoc.raw, [{}, { framework: 'webpack' }])
  },
})
```

> ⚠️ **#1 是唯一 plugin 必装的环境**，原因在 §4.7 档 A 的漏网点：**webpack4 / CJS 输出不支持 `import.meta`**，
> 字体只能靠 `publicPath` 推导 + 显式拷贝。判据照旧：删掉 plugin 后「插公式 / 插流程图 / 导出 Word」全无 404 才算档 B 做成 —— 做成了这里也能降到 0 行。

**内网安装差异**：无差异，`npm i lark-doc --save-exact --registry=http://npm.internal:4873`。

---

##### #2 Vue 3 + vite

**安装**：同上，一个包。

**引入**

```vue
<script setup>
import { onMounted, onBeforeUnmount, ref } from 'vue'
import { LarkDoc } from 'lark-doc'      // 阶段 7 前必须写成 'lark-doc/element'
import 'lark-doc/style.css'

const el = ref(null)
let doc
onMounted(() => { doc = new LarkDoc({ element: el.value, content }) })
onBeforeUnmount(() => doc?.destroy())
</script>
```

想要 `<LarkDoc>` 组件糖衣就换成 `import { LarkDocVue3 } from 'lark-doc/vue3'`（3 KB 薄壳，**不内置第二套 UI**）。

**构建配置**：**0 行**。`vite.config.js` 只剩框架自己的 `vue()`：

```js
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
export default defineConfig({ plugins: [vue()] })
```

> 现在是 10 行手写（2 个 alias 直指 `dist/` 与 `src/adapters/`、`optimizeDeps.include`）—— 那三条存在的唯一原因是
> 「源码入口含 Vue 2 SFC，Vue 3 宿主不许直引」。**阶段 7 把 Vue 从源码树摘掉后，alias 与 optimizeDeps 一并消失。**

**内网安装差异**：无。

---

##### #3 React + vite / webpack5

**安装**：同上。

**引入**

```jsx
import { useEffect, useRef } from 'react'
import { LarkDoc } from 'lark-doc'      // 阶段 7 前写成 'lark-doc/element'
import 'lark-doc/style.css'

export function Doc({ content }) {
  const ref = useRef(null)
  useEffect(() => {
    const doc = new LarkDoc({ element: ref.current, content })
    return () => doc.destroy()
  }, [])
  return <div ref={ref} />
}
```

组件糖衣：`import { LarkDocReact } from 'lark-doc/react'`（4 KB）。

**构建配置**：**0 行**，`vite.config.js` 只剩 `react()`。**现在是 10 行**（同上，纯为绕开 Vue 2 SFC）。

**内网安装差异**：无。

---

##### #4 / #4b 无框架 + 构建（vite / webpack5 / rollup）

**安装**：同上。

**引入**：与 #1 完全同一份代码。

```js
import { LarkDoc } from 'lark-doc'
import 'lark-doc/style.css'
const doc = new LarkDoc({ element: document.querySelector('#app'), content })
```

**构建配置**

| 打包器 | 终局配置 | 说明 |
|---|---|---|
| **vite** | **0 行** | `import()` 自动分块，`new URL(..., import.meta.url)` 自动 emit 字体 |
| **webpack 5** | **0 行** | 同上（webpack5 原生支持该语法） |
| **rollup（原生）** | **补 1 个通用插件**：`@rollup/plugin-url` | Rollup 默认不处理 `new URL(..., import.meta.url)`，会原样保留导致字体 404；补了它就是 0 行 lark-doc 配置，或者直接用 `larkDoc.rollup()` |

**内网安装差异**：无。

---

##### #5 无构建 / 纯 HTML / CDN（唯一形式不一致的一档）

**安装**：**不装包**，拷一个文件到静态目录。

```bash
# 公网（CDN 托管）
cp node_modules/lark-doc/dist/lark-doc.element.js   ./vendor/lark-doc.element.js
cp -r node_modules/lark-doc/dist/fonts              ./vendor/fonts
# 内网：把上面两个（含依赖资产）一并搬进静态目录
```

**引入**

```html
<script src="./vendor/lark-doc.element.js"></script>
<lark-doc readonly theme="light"></lark-doc>
```

**构建配置**：**0 行，而且不设 publicPath** —— element 档用 `publicPath:'auto'`，它会按 `<script>` 自身 URL 推导同目录下的 `fonts/` 与按需区块，**只要三者在同一目录层级就永远不会解析错**。
这是 §4.7 里唯一「手写配置天然为 0」的档位，也是它必须保持单文件直挂的原因。

> 注意：**这一档也不需要 `lark-doc/plugin`** —— plugin 只在构建期干活，而这里没有构建期。

**内网安装差异**：它是唯一不用 `npm i` 的 —— 把 element 文件 + `fonts/` 拷进内网静态服务即可（参考 `docs/guide/deployment-intranet.md`）。

---

##### #6 Node / SSR / 测试

**安装**：`npm i lark-doc --save-exact`（六环境里唯一的 CJS 消费路径已被 `exports["."].require` 覆盖）。

**引入**

```js
// ① 只用数据转换，不建编辑器（最轻）
const { htmlToJSON, jsonToHTML } = require('lark-doc')
const json = htmlToJSON('<h1>标题</h1>')

// ② 要建编辑器（SSR hydrate / jsdom 测试）
const { LarkDoc } = require('lark-doc')
const doc = new LarkDoc({ element: el, content })
```

**构建配置**：**0 行**。SSR 与浏览器吃**同一份产物**（阶段 1-A 删掉 `browser` 字段就是为了这一条，Tiptap 同款做法）。

**内网安装差异**：无。

---

#### ③ 内网安装：六环境共用一条命令

**这是终局最大的收益 —— 安装这件事没有任何「环境特判」。**

```bash
# 1) 内网机起 verdaccio（config.yaml 配 uplink 代理 npmjs，拉过一次永久缓存）
npm i -g verdaccio

# 2) 有网时预热一次（925 个包全进缓存，此后断网可装）
npm i lark-doc@<ver> --registry=http://npm.internal:4873

# 3) 六环境统一：--save-exact 禁 ^ 漂移 + lockfile 入库 + Node >= 14
npm i lark-doc --save-exact --registry=http://npm.internal:4873

# 4) 验（四道门禁全绿才算迁移完成）
npm run check:offline && npm run check:artifacts && npm run check:node14 && npm run check:gate
```

> ⚠️ `dependencies` 实测 **28 个**（含嵌套 **925 个包**），所以「内网装 lark-doc」永远不是搬一个 tgz —— **必须整棵依赖树镜像**（tgz 直装只含自身，别指望它单独解决离线）。
> #5（无构建）是唯一例外：它不走 registry，拷文件。

#### ④ 懒加载：写法在六个环境下逐字一样

```js
// ① 路由级 —— 宿主自己的，与库无关
const DocView = () => import('./views/Doc.vue')

// ② 交互级 —— 阶段 4 之后，六环境同一行
const { renderMermaid } = await import('lark-doc/features/mermaid')

// ③ 轻档 —— 不需要重特性时换这个入口（~300 KB，无 mermaid/office/katex）
import { LarkDoc } from 'lark-doc/lite'
```

库**不提供运行时 chunk loader**（§4.4 明确「不做」的第三条）：#5 走 `<script>` 的需求由 element 档自身解决，
其余五档的资源寻址**全部交给宿主打包器** —— 这正是 Tiptap 的做法。

---

## 5. 路线图（阶段 0 ~ 7）

> **已决策（2026-10-29）：默认终局 = V2/V3「源码完全不含 Vue」，阶段 0~7 全部必做，无一挂起。**
> 阶段 3 顺手拿到的 **V1（契约脱离）只作过渡态**，不作为终局口径 —— 见 §5 小节 ③。

每阶段**独立提交、独立发版、可单独回退**，不设大爆炸节点。

| 阶段 | 内容 | 风险 | 产物影响 | 状态 |
|---|---|---|---|---|
| **0** | 0.13 打包收口：`browser` 字段、UMD 降 ES2018、vue3/react 薄壳、`__LARK_DOC_PUBLIC_PATH__` | 低 | 发布面收口 | ✅ **已完成**（tag `stage/0`；尚未发 0.13，`version` 仍 0.12.1） |
| **1-A** | 契约收敛：`sideEffects` 去掉 `dist/*`、`browser` 删除、`exports` 补 `./lite` `./features/*` `./plugin` | 低 | tree-shaking 生效 | ✅ **已完成**（tag `stage/1-A`） |
| **1-B** | R1/R2/R3 三条闸门 + 渲染接缝契约文档化；**不动任何 UI** | 极低 | 无 | ✅ **已完成**（与 1-A 同批，同 tag） |
| **1-C** | webpack 4 收敛为一行 alias + ES2018 产物闸门 | 低 | 老宿主接入成本归零 | ✅ **已完成**（tag `stage/1-C`，1-A 之后追加） |
| **2** | 摘 `@tiptap/vue-2`：原生 Editor 挂载 + 原生 NodeView（3 个文件） | 中 | Vue 降级为「仅 UI 渲染器」 | ✅ **已完成**（tag `stage/2`） |
| **3** | 三产物收敛 + 统一门面 `new LarkDoc(...)`；CJS 放开拆块；顺手带出 **V1 过渡态** | 中 | 运行时产物 4 套 → 3 套 | ✅ **已完成**（tag `stage/3`） |
| **4** | 特性子路径 + 资源本地化（**内网命门**） | 中 | `lite` 档、`features/*`、零外链 | ✅ **已完成**（tag `stage/4`） |
| **5** | UI 原生化（5 批，长线主作业，可与 4/6 穿插） | **高（视觉回归）** | 逐模块替换，**all-or-nothing** | ✅ **已完成**（tag `stage/5-A`/`5-B`/`5-C` → `stage-5-ui-native`；`src/ui/*.js` 30 个原生 DOM 工厂，`src/` 只剩 3 个 `.vue`） |
| **6** | `lark-doc/plugin`（unplugin）替掉 demo 手写 copy | 低 | 宿主配置归零 | ✅ **已完成**（tag `stage-6-plugin`；`dist/plugin.{mjs,cjs}` + `exports["./plugin"]`） |
| **7** | 删 vue2 renderer + element 去 `--inline-vue` + 删 vue peerDeps → **V2/V3 终局达成** | 低（阶段 5 完成后） | element gzip 约降到 447 KiB | 🟡 **未完成（本轮唯一挂账）** —— 已落地：删 5 个 SFC、抽出 `WorkspaceController` / `EditorController` / `ui/templateLibrary`、新增 opt-in `domRenderer`（tag `stage-7-vue-closure`）。**未落地**：还剩 `LarkDocEditor.vue` / `LarkDocWorkspace.vue` / `TemplateLibrary.vue` 三个 SFC 与 `components/lark-doc/editor/` 下 46 个 mixin 依赖 Vue 响应式，因此 vue2 renderer 仍是默认、`--inline-vue` 未摘、vue peerDeps 未删 → **V2/V3 未达成** |

> **2026-10-30 口径修正**：阶段 5 / 6 已按批次收口，阶段 7 **只完成了一半**（去 SFC、抽 controller、备好 DOM renderer），
> 「删 vue2 renderer」这一刀必须等三个主壳 SFC + 46 个 mixin 全部原生化之后才能落，否则编辑器 UI 会整体失效。
> 因此 0.13.0 发的是 **V1 过渡态**（Vue 仍随产物内联），V2/V3 顺延到 0.14。

**阶段表没有可选项**。阶段 5 是唯一高风险项，靠「每批先补断言再重写 + 批次一重估排期」控住（见 §5 小节 ④），
不靠「降级为可选」规避 —— 一旦停在 V1，Vue 2.7（2023-12-31 起 EOL）将永久封产物内，且阶段 7 的收尾永远无法执行。

---

### 阶段 0 · 0.13 打包收口（代码已写完）

**当前状态核对**：`git status`（2026-10-29 复核）有 **15 个已跟踪文件改动**（`DEVELOPMENT.md`、`README.md`、`docs/guide/` 7 篇、`scripts/ensure-artifacts.mjs`、`src/index.js`、`src/web-component/{index,register}.js`、`src/adapters/{vue3,react}/index.js`），合计 +341 / -116；另有 3 个未跟踪文件（`MASTER_PLAN.md`、`MULTI_ENV_PLAN.md`、`FRAMEWORK_AGNOSTIC_PLAN.md`）。但 `package.json` 的 `browser` 实测**仍指向 UMD**（`dist/lark-doc.umd.min.js`），说明收口未生效 —— 归 1-A 处理。

**动作**：提交这 15 个改动文件 → `npm run ship:minor` 发 0.13.0（当前 `version` = `0.12.1`）→ 复核 `browser` 字段是否按 S0 设计落地。

> 注意：`scripts/release.sh` 默认 `git add -u`，**不带未跟踪文件**。三份方案文档要一并入库就加 `--include-new`；它们不在 `files` 名单里，无论入不入库都不会被打进 tarball。

**判据**：`npm run check` EXIT=0 且 0 warning；`npm run check:artifacts` 四产物齐全。

---

### 阶段 1-A · 契约收敛（最高性价比，1~2 天）

**动作**
1. `sideEffects` 去掉 `"dist/*"` → 只留 `["**/*.css","**/*.scss"]`。
2. 删除 `browser` 字段（或改指 ESM）；`unpkg` 改指元素档。
3. `exports` 补 `"./lite"`、`"./features/*"`、`"./plugin"`；`"./dist/*"` 保留为逃生口。
4. `build:esm` 产物移除顶层副作用（保留纯函数导出）。

**判据**
- `npm run check` EXIT=0 且 0 warning；
- 新建空 vite 项目 `import { LarkDoc } from 'lark-doc'`，只引一个导出，产物体积显著小于全量（证明 tree-shaking 生效）；
- 三个现有 demo（vue2 / vue3 / react）构建不报错。

**风险**：`sideEffects` 收窄会让「仅靠 import 触发样式注入」失效 → 样式必须显式 `import 'lark-doc/style.css'`（这本来就是目标，需在 changelog 里写明为 BREAKING）。

---

### 阶段 1-B · 钉死闸门（与 1-A 同批做）

**动作**
1. `scripts/check-architecture.js` 追加 R1 / R2 / R3；
2. R2 白名单固化为当前 38 条 `.vue` 清单，断言长度**只减不增**；
3. 把 `src/mount/index.js` 已有的 renderer 契约（`mount / update / destroy / getInstance / getRoot`）写进注释与类型标注 —— 抽象本身已经正确，只是没被锁死；
4. 顺手修：`src/mount/vueRenderer.js` 头部注释写「四个动作」，实际导出五个（`getRoot` 是第五个）。

**判据**：`npm run check` EXIT=0 且 0 warning。

---

### 阶段 2 · 摘 `@tiptap/vue-2`

**动作**
1. `LarkDocEditor.vue`：用 `@tiptap/core` 的 `Editor` + 十几行原生挂载替换 `EditorContent`；
2. `adapters/vue2/nodeviews.js` 与 `CodeNode.vue`：改为 core 原生 NodeView；
3. 改完后 `CodeNode.vue` 不必再是 SFC，R2 白名单顺势减 1。

**判据**：`npm run verify` 全绿；浏览器断言全绿；代码块的语言切换与增删仍能用；`code_block` 相关装饰行为不变。

**执行结果（2026-10-29 已落地，tag `stage/2`）**

| 动作 | 落地方式 | 备注 |
|---|---|---|
| ① 原生挂载 | `LarkDocEditor.vue` 改 `import { Editor } from '@tiptap/core'`，模板去掉 `<editor-content>`，改为把 `<div ref="editorEl">` 交给 `new Editor({ element })`；`beforeDestroy` 前移销毁编辑器（PM 的 DOM 现在挂在 Vue 容器里，必须先于 Vue 卸载子树） | 事件修饰符去掉 `.native`（直接挂在原生 div 上） |
| ② 代码块 NodeView | 新增 `src/core/nodeviews/code-block.js`（431 行纯 DOM），由 `CodeNode.vue`（323 行）全量平移；`core/blocks/code-block.js` 的 `addNodeView()` 改为 `getNodeView('codeBlock') \|\| createCodeBlockNodeView`（与 image 同构） | 语言下拉改原生 `<select>`（R1 禁引 `.vue`；`code-block.css` 早有该选择器）；图表分支**不渲染下拉** |
| ③ R2 白名单 | `CodeNode.vue` 删除 → 基线 38 → **37** | `architecture-baseline.json` 同步删条目 |
| ④ core 下沉 | `diagram.js` / `themeSignal.js` 由 `components/lark-doc/` 迁入 `core/`（R1 不允许 NodeView 反向引 UI 层），原路径留 5 行 `export *` shim | 与既有 `documentOperations.js` shim 同构 |
| ⑤ 适配层 | `adapters/vue2/nodeviews.js` 清空（不再注册任何 NodeView），保留 `registerVue2NodeViews()` 作为宿主覆盖用的注册表缝 | |

`scripts/check-lark-doc-core.js` 里两条原本直接 parse `CodeNode.vue` 源码的断言，改写为打在 core NodeView 上
（新增 `codeNodeViewFor()` 装配 helper，与 `imageNodeViewFor()` 同构）。

---

### 阶段 3 · 三产物 + 统一门面

**动作**
1. 产物收敛为 `esm` / `cjs` / `element`（元素档兼任 CDN `<script>` 直挂，UMD 档退场）；
   `vue3` / `react` / `collab` 作为零成本子入口保留。
2. CJS 放开 `LimitChunkCountPlugin` → 8757 KB 拆成主 ~1.5 MB + 按需块；
3. 统一门面 `new LarkDoc({ element: el, ...opts })` → 返回 `{ on, destroy, getJSON, setJSON }`，三端同一句；
4. `size-limit` 那条「CJS 全量 2500 KB」改为「拆后主文件」口径。
5. **带出 V1 过渡态（不是终局，别在这里停）** —— esm / cjs 两档加 `--inline-vue`；
   宿主从此刻起不用装 Vue 2.7；`peerDependencies` 删除 `vue` 项。
   成本约等于 0（复用 element 档 `--inline-vue` 已有能力），收益 = 六个环境的引入/安装写法提前统一。
   ⚠️ V1 只是把 Vue 封进产物，源码里 Vue 仍在；阶段 5 + 7 全部走完才够到 V2/V3（见 5 小节 ③）。

**判据**：三份产物各自 `npm run size` 绿；三个 demo 的引入写法全部替换为 `new LarkDoc(...)` / `<lark-doc>` 后功能断言不回退。
第 5 条追加判据（必查）：`npm i lark-doc` 后**不装 vue** 仍能跑通 esm 路径。

---

### 阶段 4 · 特性子路径 + 资源本地化（内网命门，2 周）

**动作**
1. `lark-doc/lite`：剔除 mermaid / docx / mammoth / katex，目标 ~300 KB；
|  |  |  |  |  |
| --- | --- | --- | --- | --- |
2. `lark-doc/features/mermaid|office|math|markdown|highlight`：各自 `registerFeature(name, loader)`，走运行期 `await import()`（已有 katex/docx/mermaid/highlight 懒加载，补齐 registry 与失败降级占位块）；
3. **静态资源零外部依赖**：mermaid 不再内联 UMD（这是 CJS 8.5 MB 的主因），katex 字体、highlight 主题全部随包分发，`assetsBase` 可由宿主指向自托管目录；
4. 扩展 `scripts/check-offline-assets.js`：断言「产物中不含任何 `http(s)://` 外部资源引用」。

**判据**：`npm run check:offline` 绿；断网环境下 `lark-doc/features/mermaid` 仍能渲染；
`npm run check:lite` 绿（1 个主包 + N 个区块里，7 个重依赖的指纹**一条都不许出现**，且同一指纹必须能在全量产物里找到 —— 后者防的是「指纹失效导致闸门假通过」）。

---

### 阶段 5 · UI 原生化（长线，按此顺序，每批一个 commit）

| 批次 | 模块 | 主要涉及文件 | 为什么排这个位置 |
|---|---|---|---|
| 1 | Tooltip / 气泡条 | `BubbleBar.vue`、`bubbleMenuMixin.js` | 独立浮层、无文档语义，失败面最小；`DEVELOPMENT.md` 里「浮层避让吸顶栏」正好当验收用例 |
| 2 | 工具栏 | `ToolbarBar.vue`、`TopBar.vue` + toolbar mixin | 纯按钮与下拉，无选区副作用 |
| 3 | 各级菜单 | `BlockHandleMenu.vue`、`LarkDocHeadingMenu.vue`、`CommandMenu.vue` + menu mixin | 开始碰到「菜单三入口展开」「假 mouseleave」等交互坑 |
| 4 | 弹窗 / 面板 | `dialogs/` 6 个 + CommentPanel / VersionPanel / OutlinePanel / TemplateLibrary | 体积大但交互套路统一 |
| 5 | 主壳 | `PaperStage.vue`、`LarkDocOverlays.vue`、`LarkDocWorkspace.vue` | 必须最后动 |

**混合期怎么过渡**：`src/mount/index.js` 的 `setRenderer()` 是换整渲染器的钩子，粒度不够；实际做法是在 Vue 主壳里**逐个把子组件替换成原生 DOM 片段**。一个批次做完即可发一个 MINOR，随时可停。

**进度**（逐批更新，别只写在 commit 里）

| 批次 | 状态 | 断言 | 原生实现落点 | commit |
|---|---|---|---|---|
| 1 Tooltip / 气泡条 | ✅ 完成 | `scripts/verify-browser-bubble.js` 44/44、`verify-browser-heading-menu.js` 16/16 | `src/ui/bubbleBar.js`、`src/ui/headingMenu.js`、`src/ui/icon.js`、`src/ui/menuLayout.js`；`editor/BubbleBar.vue` 已删，`bubbleMenuMixin.js` 退化为「算 state → `_bubbleUi.update()`」 | 见 `git log --grep '阶段 5 批次 1'` |
| 2 工具栏 | ✅ 完成 | `scripts/verify-browser-toolbar.js` 51/51 | `src/ui/toolbar.js`、`src/ui/topBar.js`、`src/ui/select.js`、`src/ui/dom.js`；`editor/ToolbarBar.vue`、`editor/TopBar.vue` 已删，`editor/toolbarUiMixin.js` 退化为「算 state → `update()`」 | `ff4f7aa`（断言 `d4c1b07`），tag `stage/5-B` |
| 3 各级菜单 | ✅ 完成（3/3 模块） | `scripts/verify-browser-block-menu.js` 37/37、`scripts/verify-browser-command-menu.js` 48/48、`verify-browser-heading-menu.js` 16/16（均为改前先绿、改后原样复跑，一条未放宽） | `src/ui/blockHandle.js` 533 行 + `editor/blockHandleUiMixin.js`（两段式刷新）；`src/ui/commandMenu.js` 约 540 行 + `editor/commandMenuUiMixin.js`；`editor/BlockHandleMenu.vue`、`CommandMenu.vue`、孤儿 `LarkDocHeadingMenu.vue` 已删，R2 34→31 | 见 `git log --grep '阶段 5 批次 3'`，tag `stage/5-C` |
| 4 弹窗 / 面板 | ✅ 完成（4a 五弹窗 + 4b 四面板） | `scripts/verify-browser-dialogs.js` 52/52（4a，改前先绿、改后原样复跑）；`scripts/verify-browser-panels.js` 87/87（4b，目录 17 + 版本 26 + 评论 22 + 另存为 12 + 模板库 9 + 无脚本错误 1） | `src/ui/dialogs.js` + `editor/dialogsUiMixin.js`（4a，表格选择器/公式/链接/快捷键抽屉/内嵌浮层）；`src/ui/panels.js` 1029 行 + `editor/panelsUiMixin.js`（4b，目录/历史/评论/另存为）；`editor/OutlinePanel.vue`、`CommentPanel.vue`、`VersionPanel.vue`、`SaveVersionDialog.vue` 已删，R2 26→22。`TemplateLibrary.vue` 是宿主侧组件（`src/index.js` 对外导出、独立路由），留到阶段 7 | `a583fa7`（4a）、`git log --grep '阶段 5 批次 4b'`（4b），tag `stage/5-D` / `stage/5-E` |
| 5 主壳 | 🟡 进行中（5F 幻灯片舞台 ✅ / 5G `LarkDocWorkspace` + `LarkDocOverlays` ⬜） | `scripts/verify-browser-stage.js` 33/33（5F，改前先绿、改后原样复跑，一条未放宽：开合 3 / 结构 6 / 版式 5 / 分章 7 / 翻页 5 / 键盘 3 / 退出 3 / 兜底 1） | 5F：`src/ui/stage.js` 113 行 + `editor/stageUiMixin.js` 81 行；`editor/PaperStage.vue` 已删（R2 22→21），宿主 `stageHost` 带 `display: contents` 落在 `.lark-doc-paper` 之前 | `git log --grep '阶段 5 批次 5F'` |

批次 3 已收尾。`LarkDocHeadingMenu.vue`（55 行）全仓无 import（只有注释在提它），是批次 1 把标题下拉换成 `src/ui/headingMenu.js` 之后留下的孤儿，直接删 + 减基线（R2 32→31），无断言影响 —— 那条路早就在 `verify-browser-heading-menu.js` 16/16 的覆盖下了。

批次 3 的两条新经验（后续批次会再撞上）：
① **键盘要挡住原生默认行为**：斜杠菜单的 ↑↓/Enter 若不 `preventDefault()`，浏览器原生移光标 → 选区变化 → slash match 消失 → 菜单先自关，组件层永远收不到键。`core/blocks/document.js` 因此加了 `slashActive` 闸门（与 `mentionActive` 同源）。
② **宿主可以是占位 div 本身**：命令菜单挂在 `commandMenuHost` 里（同 `bubbleHost`），不学块句柄插兄弟位 —— 往 Vue 管的子节点列表里塞节点，父级重渲染时容易被顺手挪走；菜单 `position: fixed`，父级是谁都不影响定位。

批次 4b 的一条新经验（阶段 5 批次 5 主壳会再撞上）：
**共用宿主的多个积木只能用「只增删自己这一棵」的挂载方式，不能用 `syncChildren(host, …)`**。`syncChildren` 的语义是「把 parent 的子节点整体对齐到期望序列」，不在序列里的一律 `removeChild`；而历史层 / 另存为 / 评论层三块面板都和 `dialogs.js` 一样共用一个 `panelHost`（它们都 `position: fixed`，父级是谁不影响定位）。各自 update 一次就会互相摘掉，症状是「只有最后更新的那个活着」—— 本轮的表现是目录（独占宿主）全绿、版本面板整块 `没渲染`。解法与 `dialogs.js` 逐字同款：`mountNode(host, el, on)` = 开则 `host.appendChild`、关则 `el.parentNode.removeChild`。**`syncChildren` 只用于自己独占的子树内部**。

批次 1 的经验（批次 2~5 直接复用）：① 原生化把 3 处 `$nextTick(定位)` 全部消掉了——原生节点同步插入即可同步 `getBoundingClientRect()`，这正是那 53 个时序点的解法；② 断言锁的「结构即契约」（段序、`role`、`aria-label`、`data-tooltip`）必须逐字段复刻，条件段要**真的不在 DOM 里**而不是 `hidden`；③ 事件要用**原事件**透传（`toggleColorPalette` 靠 `event.currentTarget` 定位），自造事件对象会静默退回默认坐标；④ 一次建好节点、之后只改属性，重建会丢焦点并让 160ms 悬停链断开。

**工作量修正**：mixin 里的逻辑大部分能留。`editor/` 下 31 个 mixin + 24 个 SFC（2968 行）中——
- **零改动可直接搬**：`icons.js` 104、`palette.js` 134、`constants.js` 70、`docModes.js` 107、`shortcutGroups.js` 125 → 共 **546 行**；
- **逻辑可搬、语法要改**：命令执行、列宽计算、折叠范围判定、标题编号计算 → 改写成普通函数即可；
- **真正要重写的是 Vue 响应式假设**：`$refs`（15 个 mixin）、`$emit`（4 处）、**`$nextTick` 53 处**。`$nextTick` 是最大单点，实质是「等 DOM 刷新后再做定位」，每一处时序都要重新验收。

> 所以阶段 5 必须「按模块渐进 + 每模块先补断言」：重写量看着只有约 7000 行模板，验收面是 53 个 nextTick 时序点。
> **用批次一的真实工时反推排期**，而不是现在拍脑袋估。

**每批开工前必做**：先给该模块补一组浏览器断言。现有基线（可作参照量级）：highlight-fold 74 / heading-number 38 / heading-menu 16 / icon-align 7 / list-marker 23 / list-number-menu 30 / element 14 / mermaid 12 / vditor 91。

---

### 阶段 6 · 官方插件（1 周）

> 交付物的完整规格、职责边界、六宿主写法与选项表见 **4.6 节**，本节只写执行动作。

**动作**

1. 用 `unplugin` 出 `lark-doc/plugin`，一套实现同时产出 vite / webpack / rollup / rspack 适配器；
   产物 `dist/plugin.mjs`，通过 `exports["./plugin"]` 暴露（节点已在 4.1 的目标 package.json 中预留）。
2. 只实现 4.6 职责边界表左侧那四件事：**拷资源、注入 basePath、dev 静态中间件、可选注入样式**。
3. 删掉两个 demo 的手写配置：`vue2-webpack-node14/vue.config.js` 的 copy/alias/static 约 19 行、
   `react-vite/vite.config.js` 的 2 个 alias + `optimizeDeps` 约 10 行，各自替换为一行 plugin。
4. `docs/guide/deployment-intranet.md` 里「按需区块 / fonts 手工拷贝」整章改写为「加 `basePath` 一行」，
   第 591 行那句 404 排查口诀降级为历史遗留问题说明。

**判据**

- 新宿主接入只需「装包 + 加一行 plugin」，不再有任何 copy / alias / devServer 配置；
- `window.__LARK_DOC_PUBLIC_PATH__` 从 README、`docs/**`、`DEMO_INTEGRATION_GUIDE.md` 全部下线；
- 三个现有 demo 换成 plugin 后 `npm run check:offline` 仍绿（证明资源仍然全部本地化）；
- 浏览器写断言：分别在 dev 与 prod 构建下触发「插入公式 / 流程图 / 导出 Word」，验证无 404。

---

### 阶段 7 · 收尾（原 P4 与 S4 合并）

> ⚠️ **本阶段的前置是阶段 5 必须 100% 完成**（见 §5 小节 ④ 的 all-or-nothing 说明）。
> 本阶段是**终局动作的最后一环**：只有它与阶段 5 一起做完，`peerDependencies` 里的 `vue` 才会彻底消失（V2/V3 达成）。
> 阶段 3 带出的 **V1 只是过渡，不能替代本阶段** —— V1 把 Vue 封进产物，本阶段才把它从源码树移出去。

**动作**
1. 删除 `src/mount/vueRenderer.js`，`createRenderer()` 默认切到 `domRenderer`（这就是原 P4「补无框架 renderer」的落点）；
2. `build:element` 去掉 `--inline-vue`，element gzip 预计从 462.7 KiB 降到约 447 KiB；
3. `peerDependencies` 删除 `vue` 与 `@tiptap/vue-2` 两项（其中 `vue` 在阶段 3 的 V1 过渡态已删，此处删 `@tiptap/vue-2` 并做最终核对）；
4. `size-limit` 门禁相应下调。

**判据**：`setRenderer(domRenderer)` 后可完全不依赖 Vue 运行；四个门禁全绿。

### 关于「Vue 依赖能不能去掉」的确定性说明

**结论：能。阶段 7 完成后，`package.json` 里不会再出现 `vue` 或 `@tiptap/vue-2` 任何一项。**
但下面三件事必须先说清楚，否则极易误判进度。

#### ① Vue 现在是 `peerDependencies`，不是 `dependencies`

```json
"peerDependencies": { "vue": "^2.7.14", "@tiptap/vue-2": "^3.32.0", ... }
```

`npm i lark-doc` **不会**自动装 Vue —— 这一条本来就是对的，框架不该进 `dependencies`。
真正的问题不是「装了不该装的」，而是**宿主必须自己装 Vue 2.7**（因为 38 个 SFC 是 Vue 2 写的）。

唯一例外是 **element 档**：`build:element` 带 `--inline-vue`（`vue.config.js` 注释明写），Vue 被内联进产物，
所以 `<lark-doc>` / `<script src>` 路径的宿主**现在就不需要装 Vue**。

| 入口 | 宿主现在需要装 vue 吗 | 阶段 7 后 |
|---|---|---|
| `lark-doc`（esm / cjs / umd） | **需要** 2.7.x | 不需要 |
| `lark-doc/element`、element UMD 直挂 | 不需要（已内联） | 不需要 |

#### ② 三处 `@tiptap/vue-2`，全仓库就这三个文件，阶段 2 一次摘完

| 文件 | 引用 | 换法 |
|---|---|---|
| `components/lark-doc/LarkDocEditor.vue` | `Editor, EditorContent` | `Editor` 本来就来自 core（框架无关），`EditorContent` 只是组件壳 → 自己 append DOM |
| ~~`adapters/vue2/nodeviews.js`~~ | ~~`VueNodeViewRenderer`~~ | ✅ 阶段 2：已清空，core 原生 NodeView |
| ~~`adapters/vue2/CodeNode.vue`~~ | ~~`NodeViewWrapper/Content/nodeViewProps`~~ | ✅ 阶段 2：已删除，逻辑平移进 `core/nodeviews/code-block.js` |

#### ③ 「脱离 Vue」有三个等级 —— 终局已定为最严的一级（V2/V3）

> **决策（2026-10-29 已拍板）：默认终局 = V2/V3「源码完全不含 Vue」，阶段 0~7 全部必做，无一可挂起。**
> V1 只是阶段 3 顺手拿到的**过渡态**，不构成「到此为止」的理由 —— 停在 V1 等于把 Vue 2.7（已 EOL）
> 永久封进产物，且阶段 7 的收尾动作永远执行不了。下面这张表保留下来，用途是**判断当前进度到了哪一级**。

| 等级 | 定义 | 用户（宿主）感受到的 | UI 要重写吗 | `package.json` 里还剩 vue 吗 | 达成于 |
|---|---|---|---|---|---|
| **V1 · 契约脱离** | Vue 只作为**实现细节**打包进产物，不外泄成宿主契约 | **宿主不用装 Vue**，六个环境写法完全一致 | **0 行** —— 把 element 档已有的 `--inline-vue` 推广到 esm / cjs 两档即可 | `peerDependencies` 删；`devDependencies` 保留（构建期用） | 阶段 3 |
| **V2 · 依赖脱离** | 源码里不再有 Vue | 同 V1 | **全部重写** —— 38 个 SFC / 7221 行原生化 | 彻底删除 | 阶段 5 + 7 |
| **V3 · 源码脱离** | V2 完成后的自然结果 | 同 V1 | 同 V2 | 彻底删除 | 阶段 7 |

> **命名说明**：本节一律用 **V1/V2/V3**（Vue 剥离等级），避免与 4.5 节 **L1/L2**（接入写法一致 / 路径一致）重名混淆。

**为什么终局选 V2/V3，而不是停在 V1 ——** 三条理由，写下来防止日后被翻案：

1. **EOL 债务必须出清**：Vue 2.7 已于 2023-12-31 停止维护。它留在产物里意味着安全补丁无处可修，
   且随着宿主升级（Vue 3 / 更新的 React 生态），二进制兼容风险只会逐年变大，越晚处理越贵。
2. **双份运行时是真成本**：V1 下若宿主自己也用 Vue 2，页面里会出现两份 Vue 运行时实例。
   体积多 40 KB 只是表象，真正麻烦的是两套实例互不共享 —— 事件总线、全局指令、devtools 全部错位。
3. **V2 是阶段 7 的前置**：阶段 7 承诺「element 去掉 `--inline-vue`、gzip 降到约 447 KiB」，
   只有源码无 Vue 才成立。停在 V1，等于同时接受「产物永久携带一个 EOL 运行时」和「阶段 7 永不执行」。

**代价同样要写清楚**（选 V2 必须付的账）：

- 38 个 SFC / 7221 行全部原生化，其中 `<template>` 段 4051 行属于真重写；
- 74 个 `$nextTick` 时序点必须逐一补断言重验（详见小节 ④）；
- 阶段 5 是 **all-or-nothing**：做一半等于白做。只能按批次推进、每批独立发版来压风险，不能靠「降级为可选」规避。

#### ④ 阶段 5 一定会做：重写量拆解与 all-or-nothing 性质

**只要还剩一个 `.vue` 文件，Vue 就不能从 `peerDependencies` 删掉。**
这与其它阶段不同 —— 1-A / 3 / 4 每做一步都有收益，**阶段 5 只有做到 100% 才有收益**。

- 现状：**37 个 SFC**（阶段 2 删掉 `adapters/vue2/CodeNode.vue` 后） —— `editor/` 18、`components/lark-doc` 13、`dialogs/` 6；
- `editor/` 下 31 个 `.js`（26 个 `*Mixin.js` + 5 个纯数据文件）共 **7655 行**。

**7221 行的构成**（这是判断「重写」真实工作量的依据）：

| 段 | 行数 | 占比 | 原生化时要动什么 |
|---|---|---|---|
| `<template>` | 4051 | 56% | **真正要重写** —— HTML 模板 → DOM 构建 / 模板字符串 |
| `<script>` | 2257 | 31% | 大部分**逻辑可搬**，改成普通函数即可 |
| `<style>` | 36 | 0.5% | **几乎不用动**（见下） |
| 其它（空行/块标签） | 877 | 12% | — |

✅ **一条被忽略的重大利好**：38 个 SFC 里只有 **2 个 `<style>` 块，且全部非 `scoped`**，`scoped` 出现 **0 次**。
5910 行样式**全部位于 11 个独立 `.css` 文件**（`lark-doc.css`、`theme-*.css`、`styles/*.css` …）。
**这意味着样式层已经天然与 Vue 解耦 —— 原生化时 CSS 一行都不用改，视觉回归风险大幅下降。**
（这也是 element 档能直接切、且能顺手做「单一 CSS 入口」的原因。）

**真正要重写的是 Vue 响应式假设**（按下表逐项换算，左列为出现次数、右列为涉及文件数）：

| API | 出现次数（mixin / SFC） | 实质 | 原生化替代 |
|---|---|---|---|
| `$nextTick` / `nextTick` | **74**（56 / 18） | 等 DOM 刷新后再定位 | `requestAnimationFrame` 或 `queueMicrotask`，**每处时序都要重新验收** |
| `$refs` | **80**（45 / 35） | 拿子组件 DOM | 直接持有 DOM 引用 |
| `$emit` | **40**（5 / 35） | 子组件 → 父组件 | 回调 / 事件总线 |
| `v-if` | 185 | 条件渲染 | 手写 `display` / `append`+`remove` 切换 |
| `v-for` | 72 | 列表渲染 | 手写循环 + 增量 diff |
| `props` | 52 | 父子传参 | 函数参数 / 局部状态 |
| `computed` | 41 | 派生状态 | 手写 getter |
| `v-model` / `v-show` / `v-html` | 9 / 9 / 6 | 语法糖 | 手写 |

> `$nextTick` 是最大单点：**74 个时序点**（不是 53，原数字只统计了 mixin 层）要逐一重新验收。
> 因此阶段 5 不能按「写完就发」推进，必须**每批先补断言再重写**，并用批次一的真实工时反推排期。

#### 过渡态：已完成

`vue` 与 `@tiptap/vue-2` **已经是 optional peer**，无需再改：

```json
"peerDependencies":     { "vue": "^2.7.14", "@tiptap/vue-2": "^3.32.0", ... }
"peerDependenciesMeta": { "vue": { "optional": true }, "@tiptap/vue-2": { "optional": true }, ... }
```

含义：**走 element 路径的宿主不装 Vue 也不会报 peer 警告**（Vue 已内联）；走 esm / cjs 路径的宿主看到提示但可选择忽略
—— 然而它实际运行时仍然需要 Vue 2.7，提示忽略会直接炸。阶段 7 是把这两项**整项删除**而非降级。

---

## 6. 排期与并行建议

```
轨道 A（对外契约）     1-A → 3 → 4 → 6
轨道 B（内部去框架）   1-B → 2 → 5(批1..5) → 7
                       ↑ 两条轨道在阶段 7 会合
```

- **1-A 与 1-B 同批做**：都是零/极低风险、当天可完成，且互相不冲突。
- **2 提到 3 之前**：只有摘掉 `@tiptap/vue-2`，阶段 3 的门面才配得上「零框架」这个说法。
- **4（内网命门）优先于 5**：内网可离线的商业价值直接，且不依赖 UI 是否原生。
- **5 长线穿插**：可与 4 / 6 并行推进，每批独立发 MINOR；**批次一做完立即用真实工时重估剩余排期**。
- **7 必须最后**：它是 5 完成的收尾动作，提前做等于把 Vue 主壳和无框架 renderer 同时维护。

**推荐起步顺序**：`0（提交发版）→ 1-A + 1-B（本周）→ 2 → 3 → 4 ∥ 5 试点 → 6 → 5 全量 → 7（V2/V3 终局）`。
七个阶段无一步可选，只有并行方式可选；任何「停在某阶段」的提议都要回到 §5 小节 ③ 重新决策。

---

## 7. 内网迁移 SOP（固定五步，不再临时处理）

> ⚠️ **先认清依赖面**（HEAD `837e329` 实测）：`dependencies` **28 个**（@tiptap 全家桶 18 个 + docx / mammoth / katex / highlight.js / marked / turndown / emojibase / core-js），装完含嵌套共 **925 个包**。
> 所以「内网装 lark-doc」从来不是搬一个 tgz —— **必须整棵依赖树镜像**。下面三种方案按推荐度排序。

```
① 取包（三种方案，按推荐度）

   A. 私有源 + uplink（推荐，一劳永逸）
      内网机装 verdaccio，config.yaml：
        uplinks: { npmjs: { url: https://registry.npmjs.org/ } }
        packages: { '**': { proxy: npmjs } }      # 拉过一次即永久缓存
      有网时跑一次 npm i lark-doc@<ver> --registry=http://npm.internal:4873
      → 此后断网也照样装，925 个包全部命中缓存

   B. tgz 直装（仅适合依赖已镜像或有网的环境）
      npm pack lark-doc@<version>                 # 有网机出 tarball
      npm i ./lark-doc-<version>.tgz              # ⚠️ 只含 lark-doc 自身
      → 28 个 dependencies 仍需联网，别指望它单独解决离线

   C. cache 搬运（一次性、无私有源时）
      有网机：npm i lark-doc --cache /tmp/npmcache
      拷到内网：npm i lark-doc --offline --cache /path/to/npmcache

   收尾三条（三种方案都要做）
      npm i lark-doc --save-exact                 # 禁 ^ 漂移
      git add package-lock.json                   # lockfile 必须入库
      node -v                                     # 需 >= 14（check:node14 门禁）

② 装包
   npm i lark-doc --save-exact
   锁死 lockfile，禁止 ^ 漂移

③ 配（目标：0 行）
   阶段 4 保证零外部资源 → 宿主无需任何 publicPath / copy 配置
   若走阶段 6 插件：vite / webpack config 加一行 larkDoc() 即可

④ 引（目标：1 种写法）
   import { LarkDoc } from 'lark-doc'
   import 'lark-doc/style.css'
   const doc = new LarkDoc({ element: el, content, readonly })
   // 无构建场景： <script src="./lark-doc.element.js"> + <lark-doc>

⑤ 验（四道门禁，全绿才算迁移完成）
   npm run check:offline       # 零外部资源
   npm run check:artifacts     # 产物齐全 + size
   npm run check:node14        # Node14 兼容
   npm run check:gate          # deploy + code + ui + lint
```

**Monaco 教训必须写进 SOP**：任何「默认从 CDN 拉」的设计在内网都是故障源。我们的网络默认已是 `open` + 静态资源本地化，阶段 4 要把这条**固化成断言而不是约定**。

---

## 8. 回归防线（复用现有资产，不必新造）

| 层 | 手段 | 命令 |
|---|---|---|
| 静态校验 | 架构闸门（含新增 R1/R2/R3）+ 契约 + lint | `npm run check` |
| 产物校验 | 重建 dist + lite 契约（重依赖指纹）+ vditor HTML + size-limit 门禁 | `npm run check:artifacts` |
| 端到端验收 | `verify.mjs` | `npm run verify` |
| 视觉 / 交互断言 | 浏览器断言 9 组（基线见阶段 5） | 按 `DEVELOPMENT.md` 的 playwright 口径 |
| 性能 | `perf/measure.mjs` | `npm run check:perf` |

**回滚粒度**：每个 commit 独立。阶段 5 任一批次出问题，回滚该批次 commit 即可，不影响 1-B / 2 的成果。

### 阶段门禁总表

| 阶段 | 出口判据 | 可回归指标 |
|---|---|---|
| 0 | `check` 绿 + `check:artifacts` 四产物齐全 | `browser` 字段按设计落地 |
| 1-A | `check` 绿 + 新 vite 项目 tree-shaking 生效 | `sideEffects` 收窄、webpack4 走 ESM |
| 1-B | `check` 绿 + R2 白名单固化 38 条 | 清单只减不增 |
| 2 | `verify` 全绿 + 浏览器断言全绿 | 代码块语言切换/增删正常 |
| 3 | 三产物 `size` 绿 + 三 demo 统一 `new LarkDoc(...)` | CJS 主文件 ≤ 1.5 MB |
| 4 | `check:offline` 绿 + 断网渲染 mermaid + `check:lite` 绿（7 个重依赖指纹不许出现在任何 lite 产物里） | lite 主包 gzip ≤ 308 KB |
| 5 | 每批次回归断言全绿 + `check:perf` 不倒退 | 每批次后采样一次性能 |
| 6 | 宿主接入零 copy 配置 | demo 手写 copy 全部删除 |
| 7 | `setRenderer(domRenderer)` 无 Vue 运行 | element gzip ≈ 447 KiB |

### 体积预算（`size-limit`，2026-10-30 实测）

读数一律以 `npm run size` 的输出为准（它自己的 gzip 参数与手工 `gzip -9` 差 ~1 KB，别拿手工数去定预算 ——
element / CJS 两档就是这么被定穿的）。

| 产物 | 实测 gzip | 预算 | 余量 | 备注 |
|---|---|---|---|---|
| ESM 主包 | 312.15 kB | 320 KB | ~2.5% | stage-4 定的 290 KB 已被阶段 5/6/7 的加码顶穿：每抽出一个 `src/ui/*.js` DOM 工厂 / Controller，原来挂在 Vue `data`/`methods` 里的逻辑就变成独立顶层模块。**V2 删掉三个主壳 SFC 后必须重测并往回收。** |
| lite 主包 | 300.12 kB | 308 KB | ~2.6% | 同上。注意 lite 只比全量小 ~12 KB gzip —— 主包里绝大部分体积是我们自己的源码，不是那七个可选依赖（它们本来就在按需区块里，lite 主包从来没装过）。「用了 lite 就小一半」是错觉。 |
| element | 481.44 kB | 490 KB | ~1.8% | 旧预算 480 KB 实测超 1.44 kB（阶段 5~7 抽 `src/ui/*` DOM 工厂的真实增量，非泄漏 —— 已排查主包内无 katex/mermaid/docx 代码，4 处 `KaTeX` 全是注释）。五档里余量最薄，别再往上堆。 |
| CJS 主文件 | 1,150,975 B | 1170 KB | ~1.7% | 旧预算 1150 KB 实测超 975 B，同上定性。 |
| collab | 2.91 kB | 90 KB | 充裕 | 未动。 |

**还没做的减重动作**（都不是预算问题，是行为取舍，需要浏览器实测后单独决定）：
① ESM 档关掉 core-js polyfill（`LARK_DOC_NO_POLYFILL=1`）—— 分析结果显示 core-js 占 ~204 KiB 模块源码，但关掉等于放弃对老浏览器的运行时兜底，必须先实测 `dist/lark-doc.esm.js` 在目标浏览器的行为；
② V2 删掉 `LarkDocEditor.vue` / `LarkDocWorkspace.vue` / `TemplateLibrary.vue` 后，新版 Controller 与旧 SFC 的双份逻辑消失，这是最干净的一次回落。

---

## 9. 风险登记

| 风险 | 影响 | 处置 |
|---|---|---|
| 阶段 5 期间 UI 分叉（一半 Vue 一半原生，风格漂） | 视觉不一致 | 每批次结束立即跑回归断言；不允许同一控件长期存在两个版本 |
| 原生化后性能反噬 | 体验倒退 | 有 `check:perf` 基线（mount / keystrokeP95 / scrollFps），每批次后采样一次 |
| 框架换成原生后，原先被响应式掩盖的时序 bug 暴露（**74 处** `$nextTick`，含 mixin 56 + SFC 18） | bug 群 | 本质上是收益（隐式依赖显性化），但要留缓冲 —— 建议阶段 5 批次之间隔一个 MINOR 稳定期 |
| 阶段 5 是 all-or-nothing，中途被叫停即前功尽弃 | 沉没成本 | 分批可独立发 MINOR 降单次风险；**但不要因为怕它就停在 V1** —— 见 5 小节 ③ 的三条理由 |
| `sideEffects` 收窄导致样式不注入 | 宿主样式丢失 | 视为 BREAKING 写进 changelog；`./style.css` 是唯一入口 |
| CJS 放开拆块后 Node 侧首 require 变慢 | Node/测试变慢 | 阶段 3 同步改 `size-limit` 口径，并给出「Node 侧建议走 `./lite`」的指引 |
| Vue 2 在完工前爆出必须修的安全问题 | 中 | 阶段 2 完成后 Vue 只存在于 UI 层，届时可直接跳做阶段 5 的批次 4 / 5，不必等全量排期 |
| 内网环境 Node 版本 / 打包器版本过旧 | 装不上、跑不动 | `check:node14` 门禁 + 产物 ES2018 语法地板（阶段 0 已铺） |
| **lite 契约静默失效**（已发生两次：① esm/lite 共用 webpack filesystem cache，alias 被绕过；② `dist` 不清理，区块集合变化后旧产物留着真依赖） | 宿主以为拿到了 300 KB 的 lite，实际下 3.3 MB mermaid；构建与 size-limit 都不报错 | `scripts/check-lite-artifacts.js` 用「重依赖指纹」双向校验（lite 里不许有 + 全量里必须有，防止指纹失效后假通过）+ `build-lite.js` 收尾自清本轮未产出的 `lite.*` 残留；已并入 `check:artifacts` |
| 摘掉 `browser` 后，`new URL("./fonts/*.woff2", import.meta.url)` **在 Rollup 与 webpack4 / CJS 输出下不被处理** | 公式字体 404（§4.7 档 A 的漏网点） | Rollup 宿主配 `@rollup/plugin-url` 或装 plugin；webpack4 宿主继续拷 `dist/fonts`；1-A 判据里逐个环境实测确认 |

---

## 10. 下一步（按推荐顺序）

1. **阶段 0**：提交 15 个已改动文件并发 0.13.0 —— 现成的工作成果，先落袋；
2. **阶段 1-A + 1-B**：`sideEffects` 收窄 + `browser` 摘 UMD + R1/R2/R3 三条闸门 —— 零风险、本周可做，立刻开始产生复利（防止新人往 `core/` 里塞 Vue）；
   - 其中「摘 `browser`」多了一重收益：**它同时砍掉 `lark-doc/plugin` 的大半必要性**（§4.7 档 A），判据里要补「vite / webpack5 下字体是否自动 emit」的实测；
3. **阶段 2**：摘 `@tiptap/vue-2` —— 独立性最强、收益最明确的下一个正式技术任务；
4. **阶段 5 试点**：选批次一（气泡条）做原生化试点，**用它的真实工时反推 5 的排期**，而不是现在拍脑袋估。

**终局顺序（七阶段无一步可选）**：

```
0 → (1-A ∥ 1-B) → 2 → 3 → 4 ∥ 5 试点 → 6 → 5 全量 → 7（V2/V3 达成）
```

- **1-B 是 2 与 5 的安全网** —— 没有 R1/R2/R3 闸门，原生化过程中会有人把 Vue 塞回 `core/`；
- **2 做完会让 5 的第一个批次更容易**（node view 那时已经是原生的了）；
- **4 与 5 试点可并行**（互不依赖），但 4 是内网命门，优先给资源；
- **6 排在 5 全量之前**：plugin 与 UI 原生化零耦合，先把宿主配置压到 0 行，后续回归验证也更省事；
- **7 只能在 5 全量之后**：它是收尾，提前做等于同时维护 Vue 主壳和无框架 renderer。
