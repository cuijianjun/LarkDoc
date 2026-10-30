# 打包产物与按需加载

发布包一次构建产出三份产物，另有第四份（UMD）只服务在线 Demo 与离线包，按「宿主怎么用」而不是「我们怎么编译」来分：

| 产物 | 入口 | 适用宿主 | 首屏 JS（gzip 实测，2026-10-28 / v0.12.1） |
| --- | --- | --- | --- |
| `dist/lark-doc.esm.js` | `src/index.js` | webpack / vite / rollup 等打包器（`module` 字段） | 1.00 MB → gzip 273 kB；连带 `tiptap.esm.js` 446 kB（gzip 136 kB）与 `vendor.esm.js` 101 kB（gzip 38 kB）并行，合计 **gzip 446 kB** |
| `dist/lark-doc.common.js` | `src/index.js` | Node / SSR / 只读 `main` 的老打包器（`main` 字段）；**webpack 4 的唯一入口** | 单文件 8.6 MB → gzip 2.34 MB（内联 mermaid 与全部按需区块，不拆） |
| `dist/lark-doc-element.umd.min.js` | `src/web-component/index.js` | 任意框架 / 无框架（`<lark-doc>`，Vue 内联）；**`unpkg` / `jsdelivr` 指向它**，兼 CDN 直挂 | ≈1.67 MB → gzip ≈500 kB |
| `dist/lark-doc.umd.min.js` | `src/index.js` | **不随包发布**：在线 Demo（`window.LarkDoc` 全局）与离线包用 | ≈1.51 MB → gzip ≈467 kB |

跑一次 `npm run size` 就能看到同样这些数：它为每份产物定了上限（ESM 320 kB、element 512 kB、CJS 1170 kB、collab 90 kB、lite 308 kB，全 gzip），超出即失败。UMD 档不在 size-limit 里（不发布）。
element 这一档余量最薄（实测 ≈500 kB / 上限 512 kB）：它把 Vue 内联进来，又比 UMD 多一层自定义元素壳，**别再把重依赖往首屏堆**。

**除了 ESM，其余三份（CJS / UMD / element）都已整体降到 ES2018 语法。**
0.13 起包里**没有 `browser` 字段**（有它 webpack 会跳过 ESM 直落「浏览器直挂档」，SSR 与浏览器就吃到
两份不同产物了），所以 webpack 4 的 `resolve.mainFields` 会落到 `module` → `esm.js` 而解析失败 ——
 webpack 4 宿主改一行 alias 指到 CJS 档即可，**不用再挂降语法 babel**（CJS 自身已是 ES2018）。
UMD / element 两份会自行注入样式；**打包器消费 ESM / CJS 时必须显式引样式**
（`import 'lark-doc/style.css'`，webpack 4 下写 `lark-doc/dist/lark-doc.css`）。
`__LARK_DOC_PUBLIC_PATH__` 只服务 UMD / element 那两份**旁挂懒区块**的产物 ——
CJS 是单文件全内联，走 CJS 的宿主不用设（详见 [多环境接入](./environments.md#env-vue2-wp4)）。
子路径（`lark-doc/element` 等）在 webpack 4 下要写全 `dist/` 路径，因为老版本读不到 `exports`。

改造前每份产物都是「一个巨大的单文件」：UMD 1.91 MB（gzip 548 kB）、element 2.16 MB（gzip 658 kB），
公式、Word 导入导出、代码高亮全部塞在首屏里。改造把这些重依赖从首屏挪走；上表的 gzip 数是 **v0.12.1 实测**，
比刚改造时大了一截（后续版本又加了 AI、Markdown 导入导出等能力），所以别拿「少掉一半」那种老口径来算收益——
拆分真正的收益是「这些能力不占首屏」，普通文档的常态是几乎 0 额外流量。

CJS 那份是**唯一反其道而行**的：它把 mermaid 与全部按需区块都内联进单文件（gzip 2.34 MB）。
原因是 `require('lark-doc')` 可能跑在 Node / jsdom / 任意老打包器里，运行时根本没法可靠地解析
chunk 地址，宁可体积换「拿走就能用」。嫌大的宿主走 ESM 入口即可。

重依赖（KaTeX、docx、mammoth、marked、turndown、highlight.js、mermaid）**都不在首屏**：
它们被拆成按需区块，只有用户真的插入公式、导出 Word、导入 .docx / Markdown、渲染代码块、插入图表时才下载。

## 产物构成

### 按需区块（四种产物都一样）

| 区块 | 内容 | 触发时机 |
| --- | --- | --- |
| `math` | KaTeX + KaTeX 样式 | 文档里出现公式节点 / 打开公式弹窗 |
| `office` | docx（导出）、mammoth（导入 .docx） | 导出 Word、导入 .docx |
| `markdown` | marked、turndown | 导入 / 导出 Markdown |
| `highlight` | highlight.js 内核与语言包 | 文档里出现代码块 |
| `import-export` | 导入导出的编排代码 | 同上（**只有 element 产物单独成块**，CJS / UMD / ESM 并进主文件） |
| `mermaid` | 图表渲染器（`import()` 懒 chunk，不是外置运行时文件） | 文档里出现 mermaid 图表块 |

### 初始区块（仅 ESM 产物拆分）

| 区块 | 内容 |
| --- | --- |
| `lark-doc.esm.js` | 编辑器内核、工具栏、工作区、会话与 Provider |
| `tiptap.esm.js` | `@tiptap/*` 与 prosemirror |
| `vendor.esm.js` | core-js、linkifyjs 等基础依赖 |

UMD / element 产物的首屏**永远只有一个文件**：它们的 `output.filename` 由 vue-cli 固定，
拆初始区块会互相覆盖，所以只拆按需区块——换来的是「首屏不依赖任何 chunk 加载」。

### 样式

- `lib`（CJS）：样式抽成 `dist/lark-doc.css`，宿主显式引 `import 'lark-doc/style.css'`
  （webpack4 不认 `exports` 子路径，要写全 `lark-doc/dist/lark-doc.css`）；
- `umd` / `esm` / `element`：样式随 JS 注入 `<style>`，宿主不需要额外引 CSS；
  KaTeX 那条 118 KB 的样式跟着 `math` 区块走，没有公式的文档不为它付费。

## 构建与部署

### 构建命令

```bash
npm run build          # CJS 单文件（main）
npm run build:umd      # UMD 压缩版 + 按需区块（在线 Demo / 离线包用；CDN 直挂由 element 兼任）
npm run build:esm      # ES Module + 完整拆包（module）
npm run build:element  # Web Component（Vue 内联 + CSS 注入）
npm run build:analyze  # 以上四份 + 体积诊断输出（按依赖聚合 + 产物清单）
```

`npm run check` 会按 `scripts/ensure-artifacts.mjs` 的清单补齐缺失产物（CJS / ESM / collab /
element / lite / 五特性包 / adapters），再跑 Vditor 兼容回归与 size-limit。UMD 档不在发布产物里，
只服务 Demo 与离线包，所以不参与 `check`。

### 部署注意

- 按需区块必须和主文件放在**同一个目录**：UMD / element 用 `publicPath:'auto'` 按主文件
  （`<script>` 自身 URL）推导 chunk 地址；ESM 用相对 `import()` 串按文件自身 URL 解析。
  所以只要把 **`dist/` 整目录同位托管**（主文件 + 各按需区块 `*.math.js` / `*.mermaid.js` … + `fonts/`），
  放在任意子目录都成立，不需要配置任何 base path；
- **不需要单独拷 `vendor/`**：0.11.0 起 mermaid 是普通按需区块，`dist/vendor/` 目录已不再产出
  （老版本残留的 `dist/vendor/mermaid.min.<hash>.js` 可以直接删）；
- 想改用自己托管的 mermaid（例如复用宿主的 CDN 镜像）才需要两种做法之一：挂载前置 `window.mermaid`，
  或传 `performance.diagramScriptUrl`（走 `<script data-lark-doc-diagram="mermaid">` 注入分支）；
- 二次打包（把 element 产物再打进自己的 bundle）时，chunk 地址会按**你自己的 chunk 目录**推导，
  把它们拷到对应目录即可（本仓库 Demo 用 `node scripts/demo-sync-vendor.mjs` 做这件事）。

### 在线 Demo 的 vendor 同步

`docs/public/demo/vendor/` 是 `dist/` 的镜像，**必须整目录同步**：UMD / element 运行时按
`document.currentScript.src` 推导 publicPath，只拷主文件的话 `lark-doc.umd.min.mermaid.js`
会被请求成 404，表现就是「图表 / 公式 / 代码高亮全不出来」。

```bash
npm run demo:sync    # dist/ → docs/public/demo/vendor/（含按需 chunk、math.*.css、fonts/、VERSION）
npm run demo:check   # 只校验，版本或大小不一致退出码 1（CI / 提交前用）
npm run demo:build   # build + build:umd + build:element，最后自动同步
```

同步脚本会从 UMD 主文件里反向解析 `.u`（chunk 表）与 `.miniCssF`（按需 CSS），
所以只要构建产物里有的区块，vendor 里就不会漏。

### 构建加速

- 开启 webpack `filesystem` 缓存：CJS 产物冷构建约 8 s、二次构建约 2 s（改造前跑一次三格式的
  lib 构建要 47 s），四份产物全量暖构建约 10 s；
- 每个 target 用独立的 `cache.name`（`lark-doc-lib` / `lark-doc-umd` / `lark-doc-esm` / `lark-doc-element`），
  避免不同产物的 output / externals 互相串味；
- 只构建真正要发布的格式：去掉没人引用的未压缩 UMD 与 element 的 CJS 产物，`dist` 从 23 MB 降到 14 MB。

### 为什么拆包策略分两档

拆包的收益来自「让首屏少下载」，但代价是运行时要能找到 chunk：

- **ESM**：`import()` 是原生语法，宿主打包器接管并重新分割，最干净，所以初始区块也敢拆；
- **UMD / element**：chunk 由 webpack 运行时按 URL 注入 `<script>`，只能保证「主文件同目录」这一条，
  因此只拆按需区块——即便 chunk 加载失败，首屏编辑器依旧可用，只是公式 / 导入导出不可用；
- **CJS**：宿主可能是任何打包器甚至 Node，运行时 chunk 加载完全不可控，坚持单文件。
