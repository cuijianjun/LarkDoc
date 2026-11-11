# lark-doc 多环境统一 · 终极计划

> ⚠️ **本文档已合并进 [MASTER_PLAN.md](./MASTER_PLAN.md)**（多环境统一 × 框架无关 合并版）。本文保留为「宿主怎么引入」一侧的细节备查，**遇冲突以 MASTER_PLAN.md 为准**。
>
> 目标：**一套内核、一份契约、一次安装、零宿主配置**，覆盖 Vue2 / Vue3 / React / 无框架 / Node / 内网离线六种环境。
> 本计划为长期路线，替代一切临时改法。改代码前先读本文件，再读 `DEVELOPMENT.md`。
>
> 姊妹篇：[FRAMEWORK_AGNOSTIC_PLAN.md](./FRAMEWORK_AGNOSTIC_PLAN.md) —— 本文管「宿主怎么引入」，那边管「包内部怎么写」（UI 去 Vue 的 S0~S4 演进）。

---

## 0. 一句话结论

Tiptap / Monaco / Swiper / Element Plus 四家**没有一家的"兼容"是靠多产物解决的**：
它们全都是「**只发 ESM(+CJS) 两种模块格式 → 用 `exports` 做条件路由 → 用子路径做特性开关 → 把配置体力活收进官方插件 → 分块交给宿主打包器**」。

我们的差距不在机制（机制基本都有），而在**三处收敛**：产物 5 套→3 套、入口写法 3 种→1 种、手工拷贝→1 个插件。

---

## 1. 四家基线对比（实证）

| 维度 | **Tiptap** v3.32 | **Monaco** | **Swiper** v12 | **Element Plus** |
|---|---|---|---|---|
| 产物格式 | ESM + CJS 双发，`type: module` | ESM 主 + `min/vs` AMD 档 + worker 文件 | **纯 ESM**（v7 起彻底弃 CJS） | ESM + `dist/index.css` 全量档 |
| UMD | **无** | 无（AMD loader 另算） | 无 | 无 |
| 寻址手段 | `exports` 条件（types/import/require）+ 子路径 | 子路径 `esm/vs/...` + **宿主插件** | `exports` 子路径：`swiper/css`、`/modules`、`/element` | 主入口 + **unplugin** 自动按需 |
| 子路径数量 | `@tiptap/pm/*` 13 个 | 按语言/特性切分 | css / modules / element / bundle | 组件级 |
| 内置 CSS | **零** | 有（需 css-loader + file-loader 处理 .ttf） | 有，但走 `swiper/css` 子路径 import | 有，且是体积大头 |
| 运行时动态 import | **0 处** | worker 由宿主决定加载方式 | 0 处 | 0 处 |
| 宿主配置量 | **0 行** | **中~高**（worker 必须配） | 0 行 | **1 个插件** |
| tree-shaking 开关 | `sideEffects: false` | 插件裁语言 | `exports` 强制规范 import 路径 | `sideEffects` + 插件 |
| 版本锁定 | peerDeps **精确版本** `3.32.0` | 单包 | 单包 | 单包 |
| CDN 形态 | `esm.sh`（不自己发 CDN 产物） | `loader.config({ paths: { vs } })` | `swiper-bundle.min.mjs` | `dist/index.css` 整包 |
| **内网友好度** | ★★★★★ | ★★☆☆☆（默认走 CDN，必须改造） | ★★★★☆ | ★★★★☆（pnpm + dayjs 有坑） |

### 各家的"招牌动作"

- **Tiptap**：`pm/state` 子入口全文只有 `export * from "prosemirror-state";` —— **重依赖做命名空间 shim，绝不内联**。
  `vue-2` 适配层仅 16 KB，且 `index.d.ts` 第一行 `export * from '@tiptap/core'`（装适配壳就不用再装内核）。
- **Monaco**：**反例教材**。因为多出 worker + CSS + 字体三件套，宿主被迫在 webpack / vite / esbuild / parcel 下各配一遍 `MonacoEnvironment`。
  它的补救方式正是我们要学的：**官方插件（`monaco-editor-webpack-plugin`）把体力活收进去**。
- **Swiper**：**`exports` 当规范用**——v7 起禁止直引 `swiper/swiper.min.css`，必须写 `swiper/css`。用 exports 门禁强制统一口径。
- **Element Plus**：**零配置 = 一个插件**。`ElementPlusResolver` 让宿主写 `<el-button>` 就自动引入组件 + 样式，插件内部负责样式路径解析。

---

## 2. 我们能学的五条（按可抄顺序）

| # | 规律 | 出处 | 我们怎么抄 |
|---|---|---|---|
| 1 | **只发 ESM+CJS，不维护第二套"运行时产物"** | Tiptap | `browser` 字段摘掉 UMD；UMD 退为 `./cdn` 单档，只服务 `<script>` 直挂 |
| 2 | **子路径 = 特性开关** | Tiptap `pm/*`、Swiper `css/*`、Monaco `esm/vs/*` | 开 `./lite`（无 mermaid/office/katex）与 `./features/*`（mermaid / office / math / markdown） |
| 3 | **重依赖做 shim，不内联** | Tiptap `pm/state` | vendored mermaid UMD 不再内联进 CJS（这是 8.9 MB 主因）；改成稳定子路径门面 |
| 4 | **配置体力活收进官方插件** | Monaco plugin、Element Plus unplugin | 出 `lark-doc/plugin`（unplugin），替掉 demo 里手写的 `copy-webpack-plugin` |
| 5 | **`sideEffects: false` + 单一 CSS 入口** | Tiptap | 现在 `sideEffects` 含 `dist/*`，**等于把整个 dist 标成有副作用，tree-shaking 全失效**，必须收窄 |

---

## 3. 现状差距（逐条对照）

| 项 | 现状（实测） | 目标 | 优先级 |
|---|---|---|---|
| `sideEffects` | `["**/*.css","**/*.scss","dist/*"]` | `["**/*.css","**/*.scss"]` 或 `false` | **P0** |
| `browser` 字段 | `dist/lark-doc.umd.min.js` | 删除（或指 ESM） | **P0** |
| 产物套数 | 5：common / esm / umd / element / adapters | 3：esm / cjs / cdn | P1 |
| CJS 体积 | 8.9 MB（`LimitChunkCountPlugin=1` 全内联） | 主 ~1.5 MB + 按需块 | P1 |
| 入口写法 | 3 种（`import {LarkDoc}` / `import 'lark-doc/element'` / `createReactLarkDoc`） | 1 种 `createLarkDoc(el, opts)` | P1 |
| 重依赖 | `docx / mammoth / marked / turndown / highlight.js / katex / mermaid` 全进主包 | `lite` 不含，`features/*` 按需 | P2 |
| 运行时外部资源 | mermaid vendored UMD 内联 + katex 字体 | 本地化 + `assetsBase` 可替换 | **P2（内网命门）** |
| 拷贝体力活 | 各 demo 手写 `copy-webpack-plugin` | `lark-doc/plugin` 一个插件 | P3 |
| 内核框架耦合 | `src/mount/` renderer 契约**已就位**（好底子） | 补无框架 renderer，WC 退为兼容档 | P4 |

---

## 4. 终极计划（五个阶段）

### P0 · 契约收敛（1~2 天，收益最大，风险最低）

**动作**
1. `package.json`：`sideEffects` 去掉 `"dist/*"`；`browser` 删除；`unpkg`/`jsdelivr` 保留给 UMD 档。
2. `exports` 补三条：`"./lite"`、`"./features/*"`、`"./cdn"`。
3. `build:esm` 产物声明 `sideEffects` 友好（保留纯函数导出，移除顶层副作用）。

**判据**
- `npm run check` EXIT=0 且 0 warning。
- 新建一个空 vite 项目 `import { LarkDoc } from 'lark-doc'`，只引一个导出，产物体积应显著小于全量（证明 tree-shaking 生效）。
- 三个现有 demo（vue2 / vue3 / react）构建不报错。

**风险**：`sideEffects` 收窄可能让"仅靠 import 触发样式注入"的行为失效 → 样式必须显式 `import 'lark-doc/style.css'`（这本来就是目标）。

---

### P1 · 三产物 + 统一门面（1 周）

**动作**
1. 产物收敛：
   - `dist/lark-doc.esm.js`（主，ESM）
   - `dist/lark-doc.cjs`（Node/老工具链）
   - `dist/lark-doc.cdn.js`（`<script>` 直挂，唯一 UMD）
2. CJS 放开 `LimitChunkCountPlugin`，允许拆块。
3. 统一门面 `createLarkDoc(el, { content, readonly })` → 返回 `{ on, destroy, getJSON, setJSON }`，三端同一句。
   框架糖衣保留为可选：`lark-doc/vue3`、`lark-doc/react`。
4. `size-limit` 那条 "CJS 全量 2500 KB" 的线改为「拆后主文件」口径。

**判据**：三份产物各自 `npm run size` 绿；demo 三种写法全部替换成 `createLarkDoc` 后功能断言不回退。

---

### P2 · 特性子路径 + 资源本地化（内网命门，2 周）

**动作**
1. `lark-doc/lite`：剔除 mermaid / docx / mammoth / katex，目标 ~300 KB。
2. `lark-doc/features/mermaid|office|math|markdown|highlight`：各自 `registerFeature(name, loader)`，走运行期 `await import()`（已有 katex/docx/mermaid/highlight 懒加载，补齐 registry 与失败降级）。
3. **静态资源零外部依赖**：mermaid 不再内联 UMD；katex 字体、highlight 主题全部随包分发，`assetsBase` 可由宿主指向自托管目录。
4. 扩展 `scripts/check-offline-assets.js`：断言"产物中不含任何 `http(s)://` 外部资源引用"。

**判据**：`npm run check:offline` 绿；断网环境下 `lark-doc/features/mermaid` 仍能渲染。

---

### P3 · 官方插件（1 周）

**动作**
1. 出 `lark-doc/plugin`（unplugin，同时支持 vite / webpack / rollup）。
2. 插件唯一职责：把按需 chunk + KaTeX 字体拷贝到宿主输出目录、设置 publicPath、可选自动注入 `style.css`。
3. 删掉各 demo 手写的 `copy-webpack-plugin` 配置。

**判据**：新宿主接入只需「装包 + 加一行 plugin」，不再有任何 copy 配置；`window.__LARK_DOC_PUBLIC_PATH__` 可从文档下线。

---

### P4 · 内核去框架化（长期）

**动作**
1. `src/mount/` renderer 契约已就位，补一份原生 DOM renderer。
2. `core/` 与 `adapters/vue2` 的 SFC 渲染层解耦，WC 退为兼容档（Tiptap 路径）。

**判据**：`setRenderer(domRenderer)` 后可完全不依赖 Vue 运行。

---

## 5. 内网迁移 SOP（固定流程，不再临时处理）

```
① 取包
   npm pack lark-doc@<version>            # 出 tarball
   或：内网 verdaccio / Nexus 建私有源，npm publish --registry=<内网源>

② 装包
   npm i ./lark-doc-<version>.tgz         # 离线直装
   或：npm config set registry <内网源> && npm i lark-doc
   锁死 lockfile，禁止 ^ 漂移

③ 配（目标：0 行）
   无 CDN 依赖（P2 保证）→ 宿主无需任何 publicPath / copy 配置
   若走 P3 插件：vite/webpack config 加一行 larkDoc() 即可

④ 引（目标：1 种写法）
   import { createLarkDoc } from 'lark-doc'
   import 'lark-doc/style.css'
   const doc = createLarkDoc(el, { content, readonly })

⑤ 验（四道门禁，全绿才算迁移完成）
   npm run check:offline       # 零外部资源
   npm run check:artifacts     # 四产物齐全 + size
   npm run check:node14        # Node14 兼容
   npm run check:gate          # deploy + code + ui + lint
```

**Monaco 教训必须写进 SOP**：任何"默认从 CDN 拉"的设计在内网都是故障源。我们的网络默认已是 `open` + 静态资源本地化，P2 要把这条固化成断言而不是约定。

---

## 6. 明确不做的事

- **不做**多套"环境专用产物"（webpack4 版、vue-cli 版…）——老化包袱就是这么来的。
- **不做**库内运行时 chunk loader（Monaco 的痛）——分块永远归宿主打包器。
- **不做**第二套皮肤/CSS 入口——`lark-doc/style.css` 唯一。
- **不提前**用 `report.mjs --update` 覆盖性能基线。

---

## 7. 阶段门禁总表

| 阶段 | 出口判据 | 可回归指标 |
|---|---|---|
| P0 | `check` 绿 + 新 vite 项目 tree-shaking 生效 | `sideEffects` 收窄、webpack4 走 ESM |
| P1 | 三产物 `size` 绿 + 三 demo 统一 `createLarkDoc` | CJS 主文件 ≤ 1.5 MB |
| P2 | `check:offline` 绿 + 断网渲染 mermaid | `lite` ≤ 300 KB |
| P3 | 宿主接入零 copy 配置 | demo 手写 copy 全部删除 |
| P4 | `setRenderer(domRenderer)` 无 Vue 运行 | WC 退为兼容档 |
