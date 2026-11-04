# 打包产物与按需加载

当前源码使用 Tiptap 3 与原生 DOM UI。默认、Element、lite 和 legacy 兼容产物都不导入、内联或 external Vue；Vue CLI 仍作为当前稳定库产物与兼容链的构建工具，Rollup 通过并行候选链逐步迁移。

## 入口与样式

| 产物 | 源码入口 | 用途 | 样式 |
| --- | --- | --- | --- |
| `dist/lark-doc.esm.js` | `src/index.js` | webpack5 / Vite / Rollup，`module` 与 `exports.import` | 随 JS 注入 |
| `dist/lark-doc.common.js` | `src/index.js` | Node / SSR，以及 webpack4 alias，`main` 与 `exports.require` | 显式引 `lark-doc/style.css` |
| `dist/lark-doc-element.umd.min.js` | `src/web-component/index.js` | `<lark-doc>` 标签、CDN、静态页；`unpkg` / `jsdelivr` | 随 JS 注入 |
| `dist/lark-doc-vue2.{common,esm}.js` | `src/legacy-vue/index.js` | Vue2 宿主注册普通 options 兼容对象；实际渲染仍为 DOM | CJS 引 `dist/lark-doc-vue2.css`；ESM 注入 |
| `dist/lark-doc-lite.esm.js` | `src/index.js` + 重依赖 alias | 重依赖外置为可选特性包 | 随 JS 注入 |
| `dist/lark-doc-{vue3,react}.mjs` | `src/adapters/*` | props / 事件 / 方法桥接；需先引 Element 本体 | 不含编辑器样式 |
| `dist/lark-doc-collab.esm.js` | `src/collab/index.js` | 显式协同接入，第三方运行时保持 external | 无 |
| `dist/features/*.js` / `dist/plugin.{mjs,cjs}` | `src/features/*` / `src/plugin/index.js` | 可选特性与宿主资源构建插件 | 特性包自行处理样式 |

不再单独构建 `lark-doc.umd.min.js`，浏览器直挂统一走 Element。默认入口不再导出 `LarkDocEditor` / `LarkDocWorkspace`；旧宿主从 `lark-doc` 引入 options 对象。适配器不负责安装或加载 Vue。

CJS / Element / adapters 使用 ES2018 语法降级；默认 ESM 保留现代语法。webpack4 不读 `exports`，应将 `lark-doc$` alias 到 `lark-doc/dist/lark-doc.common.js`，子路径写全 `dist/` 路径。

## chunk 与部署

- ESM 初始区块包括 `lark-doc.esm.js`、`tiptap.esm.js`、`vendor.esm.js`，宿主打包器接管原生动态 import。
- CJS **不是全内联单文件**：按需区块为 `lark-doc.common.<name>.js`，通过 `require()` 加载兄弟文件。无需 URL 基址，但不能只复制主文件。
- Element 初始主文件不拆分，按需区块为 `lark-doc-element.umd.min.<name>.js`，默认按主脚本 URL 推导目录。
- legacy ESM 的所有共享和异步 chunk 使用 `lark-doc-vue2.*.esm.js`；lite 初始共享区块使用 `lark-doc-lite.initial.*.esm.js`，按需 stub 区块使用 `lite.*.esm.js`。两者不覆盖默认 ESM chunk，构建顺序不会改变主包依赖。
- math / office / markdown / highlight / mermaid 区块按需加载；marked 仍因静态 Markdown 导出引用进入全量主文件。lite 将这些依赖 alias 到 stub，宿主可再加载 `lark-doc/features/*` 注册实现。
- 静态部署时保留完整 `dist/`（主文件、chunk、CSS、`fonts/`）；ESM 使用相对 import，CJS 使用相对 require，Element 使用脚本基址。
- Element 被宿主再次打包时，应让资源插件复制其 chunk，必要时在挂载前设置 `window.__LARK_DOC_PUBLIC_PATH__`。直接 `<script src>` 同位托管无需设置。

Mermaid 自包含 UMD 不进入常规 Babel polyfill 注入，也不由 webpack 解析其 `arguments.callee` 兼容分支；旧语法降级通过独立 loader 完成。此处理不修改源码、不屏蔽其他构建警告。

## Rollup 并行构建（迁移阶段）

Rollup 是库产物的长期目标构建器，但迁移期间不替换现有稳定产物：

```bash
npm run build:rollup:adapters  # 构建 Vue3/React 纯适配薄壳
npm run build:rollup:collab   # 构建协同入口，Yjs/Tiptap/Hocuspocus 保持 external
npm run build:rollup           # 执行以上两组并行候选构建
npm run check:rollup           # 检查格式、产物和协同 external 约束
```

这些命令只生成与现有 `dist/` 路径兼容的候选产物，不改变用户的安装、`import`、配置和运行方式。当前 `build`、`build:esm`、`build:element` 仍保持原构建链，待 Node14、Webpack4、Vue3/Vite、React/Vite、原生浏览器和离线部署矩阵全部验证后再切换默认后端。

## 构建与校验

完整开发依赖的安装需 Node `>=22`（Hocuspocus / Vitest 开发工具要求）。依赖已安装时，以下库构建可以使用 Node `14.21.3` / npm `8.19.4`：

```bash
nvm use 14.21.3
npm run build
npm run build:esm
npm run build:element
npm run build:legacy
npm run build:lite
npm run build:features
npm run build:adapters
npm run build:collab
npm run build:plugin
npm run lint
npm run size
```

也可将探测到的 Node14 `bin` 目录加入 `PATH` 后执行，避免子进程意外使用系统 Node。各构建脚本只读取源码并写入 `dist/` 与构建缓存，不改写 `src/`；`build-emoji-catalog.js` 是显式数据维护生成器，不属于产物构建链。

`npm run check:artifacts` 按输入指纹去重构建并执行产物门禁；指纹包含源码、依赖锁、配置、公共 `style.css`、全部 `build*.js`、CJS 后处理与 `build:*` 命令，legacy 两个主文件也参与存在性校验。构建期间输入变动时拒绝写入成功 stamp，需停止修改后重新构建。legacy 构建通过入口插件补齐公共 CSS 与 Node14 polyfill，不向适配器源码写入临时 import。`npm run artifacts:check` 只检查，不重建；指纹含 npm 用户代理，构建与检查应使用同一 Node/npm 环境和 npm 入口，避免裸 `node` 调用造成口径差异。

体积以 `npm run size` 为准，只统计指定主文件的 gzip，不等同于所有初始区块之和。阶段7重测后只收紧预算，不因新产物超限而放宽；确切读数与预算记录在现有 `MASTER_PLAN.md` 的体积预算表。
