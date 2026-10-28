# 内网迁移实战（Vue 2 / webpack 4 / webpack 5 / Vue 3 + Vite）

本文回答一个具体问题：**一个已经在联网机器上跑通的宿主项目，怎么一步步搬进没有外网的内网，还能正常 `npm install` 和 `npm run build`。**

三篇文档分工不同，别混着读：

| 文档 | 管什么 |
| --- | --- |
| [各环境引入对照](/guide/environments) | 联网环境下，你的框架该写什么配置、贴什么代码 |
| **本文** | 从「本地能跑」到「内网能跑」，每个宿主一套按顺序的步骤 |
| [内网服务器部署](/guide/deployment-intranet) | 服务器侧：nginx、静态资源、协同、校验、回滚 |

三者是叠加关系：**本文只做「让项目在内网编译通过」这件事**，部署上线看第三篇。

## 0. 三套宿主的差异，先看一眼 {#mig-host-matrix}

| 宿主 | 走哪个入口 | 联网侧要改的文件 | 内网侧要额外带什么 |
| --- | --- | --- | --- |
| **Vue 2.7 + webpack 4**（vue-cli 4 / 老 vue-cli） | `main` → `dist/lark-doc.common.js` | `vue.config.js`（alias + babel 规则）、业务组件的 `import` 写全路径 | `lark-doc` tgz、`vue` tgz、**2 个 babel 插件 tgz** |
| **Vue 2.7 + webpack 5**（vue-cli 5 / 原生 webpack5） | `module` → `dist/lark-doc.esm.js` | **不用改配置**，只改业务代码的 `import` | `lark-doc` tgz、`vue` tgz |
| **Vue 3 + Vite** | `lark-doc/element`（UMD，自带 Vue 2 运行时与样式） | `vite.config.js`（`isCustomElement`）、`index.html` 加一行 `<script>` | **只要 `dist/` 目录，不用装 npm 包** |

判断自己是哪一档，只跑一条命令：

```bash
node -p "require('webpack/package.json').version" 2>/dev/null || npx vite --version
```

输出 `4.x` → 方案 A；`5.x` → 方案 B；Vite → 方案 C。

---

## 1. 所有方案共用的第一步：在联网机上出包 {#mig-pack}

### 1.1 为什么必须单独出包

内网连不上 registry，`npm install lark-doc` 会直接失败。而 lark-doc 的 `dist` 在运行时还要从自身 `node_modules` 取 28 个运行时依赖（`vue`、`@tiptap/*`、`katex`、`mammoth` 等），所以不能只拷 `dist/` 了事——**必须打成自带依赖闭包的 tgz**。

`scripts/pack-intranet.sh` 就是干这个的，它顺手修掉三类只有老 npm / Windows 才暴露的坑（详见[内网服务器部署 · 3.4](/guide/deployment-intranet#deploy-npm6)）。

### 1.2 三条命令

```bash
cd apps/lark-doc
node -v          # 必须是 v14.21.3
npm -v           # >= 8.19.4
npm run check    # 全绿再往下走
bash scripts/pack-intranet.sh --version 0.12.0
```

`dist/` 已是最新时可跳过约 4 分钟的构建：

```bash
bash scripts/pack-intranet.sh --version 0.12.0 --skip-build
```

### 1.3 产出什么、带走什么

`dist-intranet/` 里会有这些文件，**按你的宿主挑**：

| 文件 | 方案 A | 方案 B | 方案 C | 说明 |
| --- | :---: | :---: | :---: | --- |
| `lark-doc-<ver>-intranet.tgz` | ✅ | ✅ | — | 主包，含依赖闭包 |
| `vue-<ver>-intranet.tgz` | 内网没有 `vue@2.7` 时 | 同左 | — | 重打过的 vue（去掉 macOS tar 头） |
| `lark-doc-<ver>-node-modules.zip` | 兜底 | 兜底 | — | `npm` 彻底装不上时才用 |
| `INSTALL-内网.md` / `sha256.txt` | ✅ | ✅ | ✅ | 说明 + 校验 |
| `dist/`（从 `apps/lark-doc/dist` 拷） | 需要时 | 用 element 时需要 | ✅ **必须** | 整目录，别只挑一个 `.js` |

### 1.4 搬运前先验一遍

```bash
cd dist-intranet && sha256sum -c sha256.txt
```

拷进内网（U 盘 / scp / 跳板机）后**再验一次**，传输出错比装错包更常见。

---

## 2. 方案 A：Vue 2.7 + webpack 4（vue-cli 4）{#mig-vue2-wp4}

这是唯一「联网侧就要动配置」的宿主。**关键顺序：先在联网机上改好、跑通，再把改好的项目搬进去**——在内网排编译错，成本是联网时的十倍。

### 2.1 联网机 · 第 1 步：确认宿主版本

```bash
node -p "require('webpack/package.json').version"    # 期望 4.x
node -p "require('vue/package.json').version"        # 期望 2.7.x
```

`vue-cli 4` 内部固定 webpack 4.x；`vue-cli 5` 是 5.x，**看到 5.x 就别抄本节配置**，直接去[方案 B](#mig-vue2-wp5)。

### 2.2 联网机 · 第 2 步：改 `vue.config.js`（两处，缺一不可）

```js
// vue.config.js（vue-cli 4 + Vue 2.7）
module.exports = {
  productionSourceMap: false,
  configureWebpack: {
    resolve: {
      alias: {
        // ① webpack4 的 mainFields 里 module 优先，会命中 esm 产物，
        //    而 esm 产物含 import.meta（KaTeX 字体地址），acorn 6.4.2 解析不了。
        //    显式把入口指到 main 的 CJS 单文件。
        'lark-doc$': 'lark-doc/dist/lark-doc.common.js',
      },
    },
  },
  chainWebpack(config) {
    // ② CJS 产物里还有 ?. / ??，webpack4 默认 babel 不管 node_modules，
    //    要对这一个文件单独降级。configFile / babelrc 必须关掉，
    //    否则会被项目根 babel.config.js 二次转译，破坏产物的模块语义。
    config.module.rules.unshift({
      test: /lark-doc[\\/]dist[\\/]lark-doc(\.common|\.umd\.min)\.js$/,
      use: {
        loader: 'babel-loader',
        options: {
          configFile: false,
          babelrc: false,
          sourceType: 'script',
          compact: false,
          plugins: [
            '@babel/plugin-proposal-optional-chaining',
            '@babel/plugin-proposal-nullish-coalescing-operator',
          ],
        },
      },
    })
  },
}
```

这两条规则必须**排在默认 js 规则之前**（`rules.unshift` 已保证）；写成 `rules.push` 等于没写。

### 2.3 联网机 · 第 3 步：业务代码里三处写全路径

webpack 4 不读 `package.json` 的 `exports` 字段，所有子路径都要落到真实文件：

```js
// ① 样式：不能写 'lark-doc/style.css'
import 'lark-doc/dist/lark-doc.css'
// ② 主入口：由 2.2 的 alias 兜住，这里照常写包名
import { LarkDoc } from 'lark-doc'
// ③ 如果用 Web Component：也是全路径
import 'lark-doc/dist/lark-doc-element.umd.min.js'
```

### 2.4 联网机 · 第 4 步：本地先 `build` 一次

```bash
npm run build
```

产物里能 `grep` 到 lark-doc 的内容，说明入口确实走的是 CJS：

```bash
grep -l "lark-doc" dist/js/*.js | head
```

这一步不通过，别往下走。

### 2.5 联网机 · 第 5 步：把 babel 插件也打成 tgz（最容易漏的一步）

2.2 里那两个 `@babel/plugin-proposal-*` 是 **devDependencies**，内网装不上就编译不过。在联网机上先落成 tgz：

```bash
mkdir -p vendor && cd vendor
npm pack @babel/plugin-proposal-optional-chaining@7
npm pack @babel/plugin-proposal-nullish-coalescing-operator@7
```

### 2.6 内网 · 第 6 步：铺 `vendor/` 并安装 {#mig-vendor}

拷进去的目录长这样：

```
你的项目/
└── vendor/
    ├── lark-doc-0.12.0-intranet.tgz
    ├── vue-2.7.14-intranet.tgz
    ├── babel-plugin-proposal-optional-chaining-7.x.x.tgz
    └── babel-plugin-proposal-nullish-coalescing-operator-7.x.x.tgz
```

`package.json` 改成文件引用（比 `npm i ./xxx.tgz` 更好，`npm ci` 也能复现）：

```jsonc
{
  "dependencies": {
    "vue": "file:./vendor/vue-2.7.14-intranet.tgz",
    "lark-doc": "file:./vendor/lark-doc-0.12.0-intranet.tgz"
  },
  "devDependencies": {
    "@babel/plugin-proposal-optional-chaining": "file:./vendor/babel-plugin-proposal-optional-chaining-7.x.x.tgz",
    "@babel/plugin-proposal-nullish-coalescing-operator": "file:./vendor/babel-plugin-proposal-nullish-coalescing-operator-7.x.x.tgz"
  }
}
```

然后：

```bash
npm install --no-audit --no-fund
```

::: warning 两个不要
- **不要加 `--legacy-peer-deps`**：npm 6 不认识这个参数，直接 `unknown option` 退出。
- **不要装 `@tiptap/vue-2`**：tgz 里已带，再装一份变双实例，症状是 `Vue packages version mismatch` 或白屏。
:::

### 2.7 内网 · 第 7 步：冒烟三条

```bash
node -p "require('lark-doc/package.json').version"          # 0.12.0
node -e "const m=require('lark-doc');console.log(typeof m.LarkDoc, Object.keys(m).length)"
# 期望：function 27
node -p "require('@babel/plugin-proposal-optional-chaining/package.json').version"
```

### 2.8 内网 · 第 8 步：`build` 并验收

```bash
npm run build
```

打开产物页面，控制台应该满足：无 `Unexpected token`、无 `Cannot read properties of undefined`、编辑区能输入、工具栏图标正常。缓存与字体的验收清单见[内网服务器部署 · 8.4](/guide/deployment-intranet)。

### 2.9 方案 A 报错对照

| 报错 | 根因 | 改哪里 |
| --- | --- | --- |
| `Module parse failed: Unexpected token` | alias 没生效，命中了 esm 产物（`import.meta`） | 2.2 的 ① 是否真的写进 `configureWebpack.resolve.alias` |
| `Module parse failed` 但报在 `?.` / `??` 处 | babel 规则没匹配上或排在后面 | 2.2 的 ② 必须 `unshift`；正则要能匹配 `node_modules/lark-doc/dist/...` |
| `Cannot read properties of undefined (reading 'call')`，白屏 | 0.11.2 之前的 lib 内层 runtime 标识符冲突 | 升级包，宿主侧无法绕过 |
| `Failed to resolve entry for 'lark-doc/style.css'` | webpack4 不读 `exports` | 改成 `lark-doc/dist/lark-doc.css` |
| `Can't resolve '@babel/plugin-proposal-*'` | 插件没带进内网 | 回到 2.5 补 tgz |

---

## 3. 方案 B：Vue 2.7 + webpack 5（vue-cli 5 / 原生 webpack5）{#mig-vue2-wp5}

### 3.1 联网机 · 第 1 步：什么配置都不用改

webpack 5 认 `exports` 字段，`import { LarkDoc } from 'lark-doc'` 直接命中 `dist/lark-doc.esm.js`，懒区块由宿主自己切分。**不要**把方案 A 的 alias 和 babel 规则抄过来——多一层编译，还容易把 esm 语义弄坏。

对照一下「不需要」的清单：

```js
// vue.config.js（vue-cli 5）—— 与 lark-doc 相关的部分全是"不需要"
const { defineConfig } = require('@vue/cli-service')
module.exports = defineConfig({
  // 不需要 alias（webpack5 默认 mainFields 含 module）
  // 不需要 transpileDependencies（esm 产物已按 browserslist 编好）
  // 不需要改 rules（webpack5 自己能吃 import.meta）
  // 不需要引 CSS（esm 产物随 JS 注入 <style>）
})
```

业务代码只需要一行：

```js
import { LarkDoc } from 'lark-doc'
```

### 3.2 联网机 · 第 2 步（可选）：用了 Web Component 才需要拷资源 {#mig-element-assets}

如果宿主里还有 `<lark-doc>` 那类页面（`import 'lark-doc/element'`），element 产物的 `publicPath: 'auto'` 会按**宿主的 chunk 目录**（vue-cli 默认 `js/`）推导资源地址，所以字体和按需区块必须落在 `js/` 下：

```js
// vue.config.js 追加
const path = require('path')
const larkDocSource = path.dirname(require.resolve('lark-doc/package.json'))

module.exports = {
  chainWebpack(config) {
    config.plugins.delete('prefetch')      // 别让 KaTeX / DOCX 首屏被预取
    config.plugin('copy-lark-doc-vendor').use(require('copy-webpack-plugin'), [{
      patterns: [
        { from: path.join(larkDocSource, 'dist/fonts'), to: 'js/fonts' },
        { from: path.join(larkDocSource, 'dist/lark-doc-element.umd.min*.js'), to: 'js' },
      ],
    }])
    config.module.rule('js').exclude.add(path.join(larkDocSource, 'src/assets'))
  },
}
```

只用主入口（`LarkDoc` 类 / `LarkDocEditor` 组件）的话，这一节整段跳过。

::: tip 一句话判断
浏览器 404 的路径前缀是什么，就往那个目录拷。报 `js/fonts/KaTeX_Main-Regular.woff2` 404，就补 `dist/fonts → js/fonts`；报 `js/lark-doc-element.umd.min.math.js` 404，就补懒区块。
:::

### 3.3 内网 · 第 3 步：装包

与 [2.6](#mig-vendor) 完全一样，只是**不需要**那两个 babel 插件 tgz：

```jsonc
{
  "dependencies": {
    "vue": "file:./vendor/vue-2.7.14-intranet.tgz",
    "lark-doc": "file:./vendor/lark-doc-0.12.0-intranet.tgz"
  }
}
```

```bash
npm install --no-audit --no-fund
npm run build
```

### 3.4 方案 A 与 B 的差别，只记三行

| | webpack 4 | webpack 5 |
| --- | --- | --- |
| 入口 | `main`（CJS，7.5 MB） | `module`（ESM，首屏 gzip ≈ 276 KB） |
| 宿主配置 | alias + babel 规则，两处 | 无 |
| 额外依赖 | 2 个 babel 插件 | 无 |

---

## 4. 方案 C：Vue 3 + Vite {#mig-vue3-vite}

### 4.1 先搞清楚为什么不能照 Vue 2 那样装包

`lark-doc` 主入口的 peer 依赖是**强制**的：`vue ^2.7.14` 和 `@tiptap/vue-2 ^3.32.0`。在 Vue 3 项目里 `npm i lark-doc`：

- npm 7+ → `ERESOLVE unable to resolve dependency tree`，装不上；
- 硬装（`--force` / `--legacy-peer-deps`）→ 浏览器里 `Vue.extend is not a function`，白屏。

Vue 3 能用的只有 **element 入口**：它是一份 UMD，**内联了自己的 Vue 2 运行时和全部样式**，和宿主的 Vue 3 互不干扰。

### 4.2 推荐路线：不装包，把 `dist/` 当静态资源引

这条路线没有 peer 冲突、不需要内网 npm、也不经过打包器二次处理，是内网最稳的一条。

**第 1 步（联网机）**：按[第 1 节](#mig-pack)出包，然后拷 `dist/`。

**第 2 步（内网）**：把**整个 `dist/` 目录**放进 Vite 的 `public/`：

```
你的 vue3 项目/
├── public/
│   └── vendor/lark-doc/
│       ├── lark-doc-element.umd.min.js
│       ├── lark-doc-element.umd.min.math.js
│       ├── lark-doc-element.umd.min.office.js
│       ├── lark-doc-element.umd.min.highlight.js
│       ├── lark-doc-element.umd.min.mermaid.js
│       └── fonts/            ← 28 个 KaTeX 字体
├── index.html
└── vite.config.js
```

::: warning 别只拷那一个 `.js`
`math` / `office` / `highlight` / `mermaid` 是运行时的**动态加载目标**，`fonts/` 是公式渲染的字体。少一个就是「编辑器能开、点公式 404」。整目录一起放，同位放置——这也是 `publicPath: 'auto'` 能自己算对地址的前提。
:::

**第 3 步（内网）**：`index.html` 加一行（放在 `<div id="app">` 之前的 head 里）：

```html
<!-- 根路径部署 -->
<script src="/vendor/lark-doc/lark-doc-element.umd.min.js"></script>

<!-- 子路径部署（vite.config.js 里 base: '/wiki/'）时改用这个 -->
<script src="%BASE_URL%vendor/lark-doc/lark-doc-element.umd.min.js"></script>
```

样式不用另外引，产物自己注入 `<style>`。

**第 4 步（内网）**：`vite.config.js` 告诉 Vue 编译器 `<lark-doc>` 是自定义元素：

```js
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  base: '/',            // 子路径部署改成 '/wiki/'，并同步第 3 步的写法
  plugins: [
    vue({
      template: {
        compilerOptions: {
          // 不配 → 控制台刷 Failed to resolve component: lark-doc
          isCustomElement: (tag) => tag === 'lark-doc',
        },
      },
    }),
  ],
})
```

**第 5 步（内网）**：业务组件里直接用标签，对象型能力走 `options`：

```vue
<template>
  <lark-doc ref="el" title="会议纪要" toolbar-keys="history,headings,marks,insert" />
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'

const el = ref(null)
onMounted(() => {
  el.value.options = {
    uploader: { upload: async (file) => (await upload(file)).url },
    ai: { enabled: false },
  }
  el.value.addEventListener('lark-doc-change', (e) => console.log(e.detail.payload.json))
})
onBeforeUnmount(() => el.value && el.value.destroy())
</script>
```

**第 6 步（内网）**：构建并检查资源是否跟着走。

```bash
npm run build
ls dist/vendor/lark-doc/         # public/ 下的东西原样复制到产物根
ls dist/vendor/lark-doc/fonts | wc -l    # 期望 28
```

### 4.3 备选路线：一定想写 `import` 语句

Vue 3 项目里装 tgz 要显式跳过 peer 校验（内网 npm 8+ 才有这个参数；npm 6 只会 warn，不用加）：

```bash
npm i ./vendor/lark-doc-0.12.0-intranet.tgz --legacy-peer-deps --no-audit --no-fund
```

```js
import 'lark-doc/element'   // 自动注册 <lark-doc>
```

这条路的代价：element 产物被宿主打包器再打一遍，`publicPath: 'auto'` 推出来的是**宿主的 chunk 目录**（Vite 默认 `assets/`），字体和按需区块要手动拷到 `assets/` 下，否则 404。排查口诀与 [3.2](#mig-element-assets) 相同。**除非团队强制统一走 npm 依赖，否则用 4.2。**

### 4.4 方案 C 三个常见卡点

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 标签渲染成空、控制台 `Failed to resolve component: lark-doc` | 没配 `isCustomElement` | 4.2 第 4 步 |
| 编辑器能开，点公式 / 图表 / 导入 Word 报 404 | `dist/` 没整目录拷，或没放在同一层 | 4.2 第 2 步 |
| 子路径部署后所有资源 404 | `base` 与 `script src` 写法不匹配 | 4.2 第 3、4 步一起改 |

---

## 5. 内网构建的五个通病（三套宿主都适用）

| # | 症状 | 原因 | 处理 |
| --- | --- | --- | --- |
| 1 | `The engine "node" is incompatible` | 宿主 `engines` 锁 `node 14.21.3` | 内网构建机装同版本；或确认宿主已放开 engines |
| 2 | 装完能用，跑一次 `npm ci` 全没了 | `npm ci` 会先删 `node_modules/` | 走方案 2 直铺的，禁止再跑 `npm ci`；要复现就用 `file:` 引用 |
| 3 | `npm install` 卡在 postinstall 联网下载 | `node-sass` / `canvas` / `puppeteer` 类包要在装的时候下二进制 | 内网镜像源或 `--ignore-scripts`，并把二进制预先放好 |
| 4 | `JavaScript heap out of memory` | terser 并行压缩在低配构建机上爆内存 | `NODE_OPTIONS=--max-old-space-size=4096`，或关掉并行压缩 |
| 5 | 页面白屏，Network 里 chunk 全 404 | 宿主 `publicPath` / nginx 子路径不一致 | 先对齐 `publicPath` 与 `location`，再看资源是否整目录就位 |

---

## 6. 三套宿主的改动清单（`git diff` 应该只有这些）

| 宿主 | 联网侧改的文件 | 内网侧新增的文件 |
| --- | --- | --- |
| Vue 2.7 + webpack 4 | `vue.config.js`、业务组件 `import` | `vendor/*.tgz`、`package.json` 的 `file:` |
| Vue 2.7 + webpack 5 | 业务组件 `import`（用了 element 再加 `vue.config.js`） | `vendor/*.tgz`、`package.json` 的 `file:` |
| Vue 3 + Vite | `vite.config.js`、`index.html` | `public/vendor/lark-doc/`（整目录） |

超出这张表的改动，通常是踩了「抄错另一档配置」的坑——回到[第 0 节](#mig-host-matrix)重新对一遍。

## 7. 下一步

编译通过只说明包能在内网用。上线还差三件事：**静态资源托管（`dist/` 整目录同位）、nginx 路由与 MIME、验收与回滚**，全部在[内网服务器部署](/guide/deployment-intranet)；断网后的运行时行为（图片外链、AI 请求）见[离线与资源本地化](/guide/offline)。
