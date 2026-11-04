# 安装与引用总表（外网 · 内网 · 全环境）

只回答四个动作：**装 → 引 → 配 → 拷**。外网少一步（不用搬运），内网多一步（出包 + 搬过去）。

```
装包  →  写 import  →  （配置）  →  拷 dist  →  验收
 ↑          ↑             ↑           ↑          ↑
npm/ tgz   一行代码      0.13 起基本不用   静态托管才要   Network 看 200
```

> **0.13 起「配」这一步基本消失了。** 包自己的 `browser` 字段指向 ES2018 的 UMD 产物、
> `peerDependencies` 全部标成可选、样式随 JS 注入，webpack 4/5、Vite、Rollup 都能直接
> `import { LarkDoc } from 'lark-doc'`，不再需要 alias、也不再需要给 `node_modules` 挂
> babel-loader。旧版本的兼容写法保留在[各环境引入对照](/guide/environments#env-vue2-wp4)。

> 本文是**索引 + 最短路径**：每一步给出可照抄的命令，配置细节挂在《各环境引入对照》对应锚点上。
> 内网想直接看「分宿主的一步步操作」，跳到[内网迁移实战](/guide/intranet-migration)；服务器侧 nginx 看[内网服务器部署](/guide/deployment-intranet)。

## 先认宿主：30 秒决定三件事

| 你的项目 | 走哪个入口 | 装不装 npm 包 | 编译工具要改吗 |
| --- | --- | --- | --- |
| **Vue 2.7**（webpack 4/5、Vite 都算） | `lark-doc`（主入口，`new LarkDoc()` 或 `<lark-doc-editor>`） | 装 | **不用改** |
| **Vue 3** | `lark-doc/vue3`（薄壳）或 `lark-doc/element`（原样用标签） | 装 | 只要给 `lark-doc` 标签放行 |
| **React 18** | `lark-doc/react`（薄壳）或 `lark-doc/element` | 装 | TSX 里补一条 `JSX.IntrinsicElements` 声明 |
| **纯静态页 / 老系统 / 没有打包器** | `dist/lark-doc-element.umd.min.js`（`<script>` 直引） | **不装**，只拷 `dist/` | 不用 |

判断自己是哪一档：

```bash
node -p "require('vue/package.json').version" 2>/dev/null || echo "没有 vue"
node -p "require('webpack/package.json').version" 2>/dev/null || npx vite --version
```

`2.7.x` → 第一档；`3.x` / 项目里根本没 vue → 第二、三档；打不出这两个 → 最后一档。

::: warning 三个最容易走错的路
- **Vue 3 用主入口** → 运行时报 `Vue.extend is not a function`（Vue 3 已移除该 API）。走 `lark-doc/vue3` 或 `lark-doc/element`。
- **薄壳只装了一半** → 组件渲染成空白、控制台报「`<lark-doc>` 尚未注册」。薄壳只做属性/事件桥接，**元素本体在 element 入口**，宿主入口要最先 `import 'lark-doc/element'`。
- **只拷了主文件、没拷 `*.math.js` 这些** → 编辑器能开，但插公式、导出 Word 时 404。`dist/` 要**整目录**同位放。
:::

::: tip webpack 4 读不到 `exports` 字段
webpack 4 不看 `exports`，只能靠 `main` / `module` / `browser` 三个字段。`lark-doc` 的
`browser` 已指向 **ES2018 的 UMD 产物**（样式随 JS 注入），所以 `import { LarkDoc } from 'lark-doc'`
在 webpack 4 里同样能直接编译通过。但 `lark-doc/element`、`lark-doc/vue3` 这类**子路径**在
webpack 4 里解析不到，要写全：`lark-doc/dist/lark-doc-element.umd.min.js`。
:::

## 第 1 步 · 装（外网） {#do-install-online}

### A. npm 直装（99% 的情况）

```bash
# 一行装完（Vue 2.7 / Vue 3 / React 都一样，不需要 --legacy-peer-deps）
npm i lark-doc

# 想锁死版本（推荐，避免 CI 与本地不一致）
npm i lark-doc@<ver> -E
```

> 0.12 及更早版本把 `vue ^2.7`、`@tiptap/vue-2` 写成强制 peer，Vue 3 / React 项目
> `npm i` 会报 `ERESOLVE`，需要加 `--legacy-peer-deps`。0.13 起这些 peer 全部标成了
> optional，**不再需要**那个参数。

装完立刻验一遍，输出应该是**一个**版本号：

```bash
npm ls lark-doc
# lark-doc@<ver>
```

### B. 出 tgz 带走（准备进内网 / 多台机器复用）

`npm i` 拿不到 registry 的环境（内网、离线机、客户现场），先在联网机上把包和依赖一起打出来：

```bash
npm pack lark-doc@<ver>
# 得到 lark-doc-<ver>.tgz（只有包本体，不含 node_modules 依赖）
```

真正的内网包请用仓库脚本出，它会把 21 个运行时依赖一起打进去（见[第 2 步](#do-install-intranet)）。

### C. 不装包，只拿 dist（Vue 3 / React / 静态页）

```bash
# 从已装好的项目里拷
cp -r node_modules/lark-doc/dist public/vendor/lark-doc/

# 或者从 tgz 里取，不用装
npm pack lark-doc@<ver> && tar -xzf lark-doc-<ver>.tgz && cp -r package/dist public/vendor/lark-doc/
```

拷完的目录长这样，**这几个文件一个都不能少**（`fonts/` 也别漏，公式靠它）：

```
public/vendor/lark-doc/
├── lark-doc-element.umd.min.js            ← <script> 引这个（含 Vue 2 运行时 + 样式）
├── lark-doc-element.umd.min.math.js       ← 按需区块，必须与主文件同目录
├── lark-doc-element.umd.min.mermaid.js
├── lark-doc-element.umd.min.office.js     ← 导出 Word / 导入 docx
├── lark-doc-element.umd.min.highlight.js  ← 代码高亮
└── fonts/                                 ← KaTeX 本地字体
```

## 第 2 步 · 装（内网） {#do-install-intranet}

内网连不上 registry，`npm install lark-doc` 一定失败。流程固定成两段：**联网机出包 → 搬进去装**。

### 2.1 联网机出包（一条命令）

```bash
cd apps/lark-doc
node -v                                   # 必须 v14.21.3
npm run check                             # 全绿再往下
bash scripts/pack-intranet.sh --version <ver>
```

`dist/` 已是最新时加 `--skip-build` 省掉约 4 分钟构建。

产物在 `dist-intranet/`，**按你的宿主挑，不用全带**：

| 文件 | Vue2 webpack4/5 | Vue3 / React / 静态 | 说明 |
| --- | :---: | :---: | --- |
| `lark-doc-<ver>-intranet.tgz` | ✅ | — | 主包，已含 21 个运行时依赖，`npm i ./xxx.tgz` 一把装完 |
| `vue-<ver>-intranet.tgz` | 内网没有 `vue@2.7` 时才要 | — | 重打过的 vue，去掉了 macOS tar 头 |
| `lark-doc-<ver>-node-modules.zip` | 兜底 | — | `npm` 彻底装不上时直接解压进 `node_modules/` |
| `dist/`（整目录） | 需要时 | ✅ **必须** | 静态托管 / 二次打包用 |
| `INSTALL-内网.md` / `sha256.txt` | ✅ | ✅ | 说明 + 校验，一起带进去 |

搬运前后各验一次（传输出错比装错包常见得多）：

```bash
cd dist-intranet && sha256sum -c sha256.txt
```

### 2.2 内网机安装 · A：tgz（推荐）

```bash
# 把 tgz 放到项目外的固定目录，例如 /opt/pkgs/
npm i /opt/pkgs/lark-doc-<ver>-intranet.tgz
npm i /opt/pkgs/vue-<ver>-intranet.tgz        # 内网没有 vue@2.7 时
```

tgz 装完 `package.json` 里会出现 `"lark-doc": "file:../opt/pkgs/..."` —— 这是正常的，说明它走的是本地路径而不是 registry。

### 2.3 内网机安装 · B：node-modules.zip（兜底）

老 npm（6.x）在 Windows 上解 tgz 偶发 `EPERM` / 依赖不全，这时候别跟它较劲：

```bash
unzip lark-doc-<ver>-node-modules.zip -d /tmp/lark-doc-nm
cp -r /tmp/lark-doc-nm/* node_modules/
```

### 2.4 内网机安装 · C：只拷 dist（Vue3 / React / 静态页）

不装包，把 `dist/` 整目录放进宿主的静态目录即可，见[第 5 步](#do-copy)。

### 2.5 装完验一行

```bash
node -e "console.log(require('lark-doc/package.json').version)"
```

打得出版本号 = 装对了；`Cannot find module` = 路径或 zip 解错位置。

## 第 3 步 · 引：每个环境写哪一行 {#do-import}

| 环境 | 那一行 | 初始化 |
| --- | --- | --- |
| Vue 2.7 + webpack 5 | `import { LarkDoc } from 'lark-doc'` | `new LarkDoc({ element })` |
| Vue 2.7 + Vite | 同上（装 `@vitejs/plugin-vue2`） | 同上 |
| Vue 2.7 + webpack 4 | 同上（**样式随 JS 注入，不用另引 CSS**） | 同上 |
| Vue 2.7 组件式 | `import { LarkDocEditor } from 'lark-doc'` | `<lark-doc-editor v-model="html" />` |
| **Vue 3** | `import 'lark-doc/element'` + `import { resolveVue3Attrs } from 'lark-doc/vue3'` | `<lark-doc v-bind="resolveVue3Attrs(props)" @lark-doc-change="onChange">` |
| **React 18** | `import 'lark-doc/element'` + `import { createReactLarkDoc } from 'lark-doc/react'` | `const LarkDoc = createReactLarkDoc(React)` → `<LarkDoc content={html} onChange={fn} ref={docRef} />` |
| 原生 / CDN / 静态 | `<script src="…/lark-doc-element.umd.min.js">` | `<lark-doc>` 标签 |
| Node / jsdom | `require('lark-doc')` | `new LarkDoc({ element: host })` |
| SSR（Nuxt2 / Next13） | `await import('lark-doc/element')`，**只在客户端** | client-only 挂载 |

薄壳很小（Vue3 3.0 KiB / React 4.2 KiB，且不含任何第三方依赖），它只做两件事：把框架的
props / 事件翻成 Web Component 的属性 / 事件，以及在你忘记 `import 'lark-doc/element'` 时
**明确报错**而不是静默渲染空白。

```js
// Vue 3
import 'lark-doc/element'
import { resolveVue3Attrs, VUE3_EVENTS } from 'lark-doc/vue3'

// React 18
import 'lark-doc/element'
import { createReactLarkDoc } from 'lark-doc/react'
```


每个环境的完整可跑 demo（含 package.json、目录结构、业务代码）在：

- [Vue 2.7 + webpack5](/guide/environments#env-vue2-wp5) · [Vue 2.7 + Vite](/guide/environments#env-vue2-vite) · [Vue 2.7 + webpack4](/guide/environments#env-vue2-wp4)
- [Vue 2.7 组件式](/guide/environments#env-vue2-sfc) · [Vue 3](/guide/environments#env-vue3) · [React 18](/guide/environments#env-react)
- [原生 / CDN / 静态托管](/guide/environments#env-static) · [Node / jsdom](/guide/environments#env-node) · [SSR](/guide/environments#env-ssr)

## 第 4 步 · 配：0.13 起几乎不用改 {#do-config}

| 环境 | 要改的配置 | 一行结论 |
| --- | --- | --- |
| webpack 5 / vue-cli 5 | **什么都不用改** | `vue.config.js` 只放你自己的业务配置 |
| webpack 4 / vue-cli 4 | **主入口也不用改** | `browser` 字段已指向 ES2018 产物 |
| Vite（Vue 2） | 装 `@vitejs/plugin-vue2` | 与 lark-doc 无关，是 Vue 2 + Vite 的通用前置 |
| Vite（Vue 3 / React） | `compilerOptions.isCustomElement` 放行 `lark-doc` | 不放行会报「未知标签」的编译警告 |
| 静态页 / SSR | 无打包器配置 | 静态页靠 `<script>`；SSR 靠 client-only |

**webpack 4 为什么现在不用配了**：0.12 的产物是 ES2020+ 语法，webpack 4 自带的 acorn
读不了 `?.` / `??`，所以以前要 alias 到 `common.js` 再挂一条 babel-loader。0.13 把
UMD 与 element 两个产物降到了 **ES2018**，同时补上 `browser` 字段——webpack 4 的
`resolve.mainFields` 默认 `['browser','module','main']`，会直接命中 UMD，语法规避、
样式自动注入，全程零配置。

### webpack 4 唯一还要留意的一件事：按需区块的路径

UMD 产物把公式 / 导出 Word / mermaid / 代码高亮拆成了 `.umd.min.*.js` 旁挂区块，运行时
按「当前 script 的地址」推导目录。静态 `<script src>` 直挂时推导天然正确；被**打包器**
`import` 时，当前 script 指向的是宿主自己的 bundle，会去 `/js/math.js` 这种错误位置找 →
**首屏正常，一插公式就 404**。

宿主两行搞定（把 `dist/` 整目录放进静态目录，再告诉它基址）：

```js
// ① 把 node_modules/lark-doc/dist/* 拷到 public/vendor/lark-doc/
// ② 入口文件最顶部（任何 lark-doc 代码执行之前）
window.__LARK_DOC_PUBLIC_PATH__ = '/vendor/lark-doc/'
```

不用公式 / 导出 Word / mermaid 的项目可以不设，也不会报错——那几个区块根本不会被请求。

::: tip 老版本（0.12 及以前）的写法
alias + babel-loader 那一套仍然有效，留在[各环境引入对照 · webpack4](/guide/environments#env-vue2-wp4)，
只是 0.13 起不再需要。
:::

## 第 5 步 · 拷：dist 怎么放 {#do-copy}

**什么时候要拷**：静态页 / CDN / 内网 nginx 托管 → 必须；打包器直接引 npm 包的（webpack5、Vite）→ 不用，`import()` 的懒区块由宿主打包器接管。

```bash
# 放进宿主的 public 目录（Vue CLI / Vite 都是 public/）
mkdir -p public/vendor/lark-doc
cp -r node_modules/lark-doc/dist/* public/vendor/lark-doc/
```

页面里引：

```html
<script src="/vendor/lark-doc/lark-doc-element.umd.min.js"></script>
<lark-doc title="未命名文档"></lark-doc>
```

三条硬规则：

| 规则 | 为什么 |
| --- | --- |
| `dist/` **整目录**同位放，不要只挑主文件 | 主文件用 `publicPath:'auto'` 按自身 URL 推 chunk 地址，`*.math.js` / `*.office.js` / `*.mermaid.js` 必须在同一目录 |
| 放任意子路径都成立，不用配 base | 同上，地址是相对主文件推算的 |
| 不用再拷 `vendor/` 目录 | 0.11.0 起 mermaid 已是普通按需区块，`dist/vendor/` 不再产出 |

子路径部署（例如 `https://intra.example.com/static/lark-doc/`）只需要改 `<script src>` 和 nginx 的 `location`，产物本身一个字节都不用动。

## 第 6 步 · 验：三件事，全绿才算通 {#do-verify}

打开浏览器 DevTools → Network，然后：

1. **主文件 200**：过滤 `lark-doc-element.umd.min.js`（或 `lark-doc.esm.js`），状态必须是 `200`，不是 `404`、也不是 `(from disk cache)` 里的旧版本。
2. **编辑器真的出来了**：标题栏 + 工具栏 + 正文区都在，能输入文字、能回车换行。
3. **按需区块 200**：在正文里插一个公式 / 插一个代码块，Network 里应该多出 `*.math.js`、`*.highlight.js`（或 `*.office.js`）并全部 `200`。全是 `404` 就说明 `dist/` 没整目录拷。

内网再加一条：`fonts/KaTeX_*.woff2` 也要 200，否则公式会显示成方框。

## 出问题先看这张表

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| `npm i lark-doc` 报 `ERESOLVE` | 装的是 0.12 及更早版本（peer 里 `vue ^2.7` 是强制的） | 加 `--legacy-peer-deps`，或升到 0.13+ |
| 运行时 `Vue.extend is not a function` | Vue 3 项目用了主入口 | 换成 `lark-doc/vue3` 或 `import 'lark-doc/element'` + `<lark-doc>` |
| 控制台 `[lark-doc] <lark-doc> 尚未注册` | 薄壳引了，但漏了 `import 'lark-doc/element'` | 宿主入口最先 import 它（薄壳只桥接，元素本体在 element 入口） |
| `Module not found: 'lark-doc/element'` | webpack 4 不读 `exports` 字段 | 写全 `lark-doc/dist/lark-doc-element.umd.min.js` |
| `Module parse failed: Unexpected token` 指到 `?.` | 装了 0.12 及更早版本的产物 | 升到 0.13+（UMD/element 已降到 ES2018）；临时办法见[webpack4 老写法](/guide/environments#env-vue2-wp4) |
| 插公式 / 导出 Word 没反应，Network 里 `*.math.js` 404 | 走打包器 import 时按需区块基址算错 | 设 `window.__LARK_DOC_PUBLIC_PATH__ = '/vendor/lark-doc/'`（见[第 4 步](#do-config)） |
| 编辑器出来了但完全没样式（纯白、挤成一坨） | 用的是 0.12 的 CJS 产物，CSS 不会自动注入 | 升到 0.13+（UMD 样式随 JS 注入）；或 `import 'lark-doc/dist/lark-doc.css'` |
| 公式显示成方框 | `fonts/` 没拷 | 连 `fonts/` 一起拷 |
| `Cannot find module 'vue'` | 主入口需要宿主的 Vue 2.7 | 一起装 `vue-<ver>-intranet.tgz` |
| 内网 `npm i` 报 `ENOTFOUND` / 卡在 registry | 还在走外网源 | 改 `npm i /opt/pkgs/xxx.tgz` 本地路径 |
| 内网 tgz 装上但依赖缺一堆 | 用的是 `npm pack` 的裸包（不含依赖） | 用 `pack-intranet.sh` 出的 `-intranet.tgz` |
| Windows 上 tgz 解压 `EPERM` / 目录不全 | 老 npm 6 的 tgz 处理缺陷 | 改用 `-node-modules.zip` 解压进 `node_modules/` |
| SSR 端 `window is not defined` | `lark-doc/element` 模块求值即注册元素 | 只在客户端 `await import()`，文件头加 `'use client'` |

还有 16 条更细的排错在[各环境引入对照 · 排错对照](/guide/environments#env-troubleshoot)，按框架分。

## 下一步

- 内网要「分宿主一步步操作」（出包 → vendor → 改 package.json → 验收）：[内网迁移实战](/guide/intranet-migration)
- 服务器侧 nginx / 静态托管 / 协同反代 / 回滚：[内网服务器部署](/guide/deployment-intranet)
- 配置项（工具栏、上传、AI、持久化）全表：[配置总览](/guide/configuration)
- 产物为什么这么拆、按需区块怎么工作：[打包产物与按需加载](/guide/build-artifacts)
- 完全断网（连字体、CDN 都不出去）：[离线与资源本地化](/guide/offline)
