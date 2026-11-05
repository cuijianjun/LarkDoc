# 内网迁移实战（Vue 2 / webpack 4 / webpack 5 / Vue 3 + Vite）

本文回答一个具体问题：**一个已经在联网机器上跑通的宿主项目，怎么一步步搬进没有外网的内网，还能正常 `npm install` 和 `npm run build`。**

这几篇文档分工不同：

| 文档 | 管什么 |
| --- | --- |
| [安装与引用总表](/guide/install) | 内外网各怎么装、怎么写 import、`dist/` 怎么拷，一张表速查 |
| [各环境引入对照](/guide/environments) | 联网环境下，你的框架该写什么配置、贴什么代码 |
| **本文** | 从「本地能跑」到「内网能跑」，每个宿主一套按顺序的步骤 |
| [内网服务器部署](/guide/deployment-intranet) | 服务器侧：nginx、静态资源、协同、校验、回滚 |

四者是叠加关系：**总表用来查、本文用来走流程**，本文只做「让项目在内网编译通过」这一件事，部署上线看第四篇。

## 0. 三套宿主的差异，先看一眼 {#mig-host-matrix}

| 宿主 | 走哪个入口 | 联网侧要改的文件 | 内网侧要额外带什么 |
| --- | --- | --- | --- |
| **Vue 2.7 + webpack 4**（vue-cli 4 / 老 vue-cli） | 根 `lark-doc`，按 `module` 解析 ESM | 业务 import；样式与深子路径使用实际 `dist/` 文件，无需专属 alias / Babel 规则 | SDK 与应用已有依赖的完整离线来源 |
| **Vue 2.7 + webpack 5**（vue-cli 5 / 原生 webpack5） | `lark-doc` | 业务 import 和公共 CSS | SDK 与应用已有依赖的完整离线来源 |
| **Vue 3 + Vite** | `lark-doc`，`new LarkDoc({ element })` | 业务 import 和公共 CSS | npm 路线带齐依赖；静态 UMD 路线带整个 `dist/` |

判断自己是哪一档，只跑一条命令：

```bash
node -p "require('webpack/package.json').version" 2>/dev/null || npx vite --version
```

输出 `4.x` → 方案 A；`5.x` → 方案 B；Vite → 方案 C。

---

## 1. 所有方案共用的第一步：在联网机上出包 {#mig-pack}

### 1.1 先选安装路线

普通 `npm pack lark-doc@0.14.4` 得到的 tgz 不包含运行时 `node_modules`。仅搬一个 tgz，不能保证完全离线安装；应用自己的 Vue、Webpack/Vite 和其它依赖也必须在内网可用。

- **有内网 npm 镜像**：同步指定 SDK 版本及应用锁文件中的完整依赖，使用正常 `npm install` / `npm ci`。
- **搬运普通 tgz**：在联网机更新应用的 `file:` 引用和锁文件，验证后，带走 tgz 及能够满足整份锁文件的依赖镜像或 npm 缓存。缓存方案须使用兼容的 npm 版本，并在断网的干净目录实际安装验证。
- **静态 UMD**：不安装 SDK npm 包，直接搬整个 `dist/`；应用框架仍由应用原有安装流程管理。适用于下文 Vue3 标签方案，也适用于其它框架。

SDK 不要求 Vue runtime 或 Vue peer。宿主已有的 Vue2 / Vue3 保持原样，不为编辑器另装 Vue 或 `@tiptap/vue-2`。

### 1.2 在联网机器准备普通 tgz

```bash
# 在联网机器执行，得到 lark-doc-0.14.4.tgz
npm pack lark-doc@0.14.4
```

在应用目录把它放入已有的 `vendor/`，修改依赖，执行一次正常安装以更新锁文件，再运行应用构建。

### 1.3 既有离线出包脚本的范围

仓库还保留 `scripts/pack-intranet.sh`、`scripts/pack-offline.sh`，用于旧内网交付流程。它们会生成各自的安装说明与校验文件。本轮常规 npm/tgz 安装验证不等于这些历史 helper 的输出已经重新验收；使用前必须核对新版本实际依赖闭包，在目标 npm/操作系统断网安装并构建，不能沿用旧版“21 项依赖 / ESM 自包含 / 必带 Vue tgz”的结论。

静态 UMD 方案不依赖上述脚本；从已安装的 SDK 复制完整 `dist/` 即可。

### 1.4 搬运前先验一遍

```bash
sha256sum lark-doc-0.14.4.tgz > sha256.txt
# 将包与 sha256.txt 一起搬运；内网执行：
sha256sum -c sha256.txt
```

拷进内网（U 盘 / scp / 跳板机）后**再验一次**，传输出错比装错包更常见。

---

## 2. 方案 A：Vue 2.7 + webpack 4（vue-cli 4）{#mig-vue2-wp4}

当前根 ESM 入口及其可达 chunk 已降语法，可以交给 Webpack4 编译。保留应用自己的工具链，不配置旧的 `lark-doc$` alias，也不增加编辑器专属 Babel 插件。

### 2.1 联网机：确认宿主版本

```bash
node -p "require('webpack/package.json').version"    # 期望 4.x
node -p "require('vue/package.json').version"        # 应用已有的 Vue2
```

### 2.2 业务代码：根入口与实际 CSS 路径

```js
import { LarkDoc } from 'lark-doc'
import 'lark-doc/dist/lark-doc.css'
```

组件挂载与销毁、上传初始化配置直接复用[各环境示例](/guide/environments#env-vue2-wp4)。Webpack4 不读 `package.json` 的 exports，根包通过 module 解析，深子路径使用实际文件。例如需要 Vue2 options 组件时：

```js
import { LarkDocEditor } from 'lark-doc/dist/lark-doc-vue2.common.js'
```

新的 Element ESM 包含 `import.meta.url`，用于现代打包器。Webpack4 的标签方案应将 UMD 作为独立 script 静态加载，不能把 UMD 再打入应用 bundle；做法见[静态托管](/guide/install#do-copy)。

### 2.3 联网机：先构建应用

```bash
npm run build
```

确认能够编辑、图表实际显示 SVG、公式字体正常，图片 base64 / 服务器上传与回调符合预期；再准备搬运。

### 2.4 内网：安装同一份包与锁文件 {#mig-vendor}

在联网应用中先将包放进 `vendor/` 并修改依赖：

```json
{
  "dependencies": {
    "lark-doc": "file:./vendor/lark-doc-0.14.4.tgz"
  }
}
```

这是需要合并到现有 package.json 的片段；保留应用自己的 Vue、Webpack 和其它依赖。联网侧执行正常安装并提交更新后的锁文件，随后带走包、锁文件和完整依赖来源。

```bash
# 联网侧更新锁文件
npm install --no-audit --no-fund
# 内网侧：确认私服或缓存包含完整应用依赖后
npm ci --no-audit --no-fund
npm run build
```

没有完整依赖镜像或缓存时不要宣称 `npm ci` 能离线成功；参照第 1 节准备来源。不要用 `--force` 或 `--legacy-peer-deps` 掩盖依赖缺失或冲突，当前 SDK 不需要这些参数。

### 2.5 安装后验收

```bash
node -p "require('lark-doc/package.json').version" # 0.14.4
node -e "console.log(typeof require('lark-doc').LarkDoc)" # function
```

然后在浏览器重复 2.3 的操作，Network 无 chunk / 字体 404，控制台无新增异常。

### 2.6 方案 A 排错

| 现象 | 检查与处理 |
| --- | --- |
| 仍报旧入口的 `?.` / `??` 或 `import.meta` 解析失败 | 确认实际安装 0.14.4，移除旧 SDK alias / 专属转译规则，检查是否误把 Element ESM 作为 Webpack4 入口 |
| 样式子路径无法解析 | 改成实际文件 `lark-doc/dist/lark-doc.css` |
| 内网安装回连 registry | 镜像或缓存未包含锁文件的完整依赖；单个普通 tgz 不包含全部依赖 |
| `Vue packages version mismatch` | 检查应用自身 Vue / 模板编译器匹配；SDK 不提供或要求另一份 Vue |

---

## 3. 方案 B：Vue 2.7 + webpack 5（vue-cli 5 / 原生 webpack5）{#mig-vue2-wp5}

### 3.1 联网机：沿用现有配置

Webpack5 能读取 package exports，无需 SDK 专属 alias 或 transpileDependencies。业务代码：

```js
import { LarkDoc } from 'lark-doc'
import 'lark-doc/style.css'
```

默认入口 / full / lite 都需公共 CSS；只有 Element ESM/UMD 自动注入样式。

### 3.2 使用 Web Component 时 {#mig-element-assets}

现代打包器使用 `import 'lark-doc/element'`，解析到 Element ESM。动态 import、CSS 和字体交给宿主现有构建器处理，通常无需手动复制到 `js/`，也没有旧 Webpack UMD 的 `publicPath: 'auto'`。

若选静态 UMD，则整套 dist 同位部署，并使用独立 script 引用。不要把静态 UMD 再打入应用 bundle。两种方式的示例见[Web Component](/guide/web-component)。

### 3.3 内网安装与构建

按[2.4](#mig-vendor)保留应用框架依赖，搬运同一包、锁文件和完整依赖来源，运行普通 `npm ci` 与 `npm run build`。

### 3.4 两种 Webpack 的差别

| | Webpack4 | Webpack5 / Vite |
| --- | --- | --- |
| 根入口 | `lark-doc`，无需 SDK alias | 相同 |
| 公共 CSS | `lark-doc/dist/lark-doc.css` | `lark-doc/style.css` |
| 深子路径 | 实际 dist 文件路径 | 公开 exports 子路径 |
| Element | 独立 script 加载 UMD | npm Element ESM 或独立 UMD |


---

## 4. 方案 C：Vue 3 + Vite {#mig-vue3-vite}

### 4.1 Vue3 可以直接使用默认入口

当前默认、Element 和 lite 产物均无 Vue 运行时依赖，也没有 `vue` 或 `@tiptap/vue-2` peer。Vue3 / React / 原生宿主都可正常 `npm i lark-doc`，无需 `--force` 或 `--legacy-peer-deps`，随后在客户端挂载 `new LarkDoc()`。

下面保留的是另一条可选路线：静态托管 Element UMD，使用 `<lark-doc>` 标签。它使用同一份 DOM renderer，样式随 JS 注入，并非内联 Vue2 的避让方案。

### 4.2 可选静态路线：把 `dist/` 当静态资源引

这条路线无需安装 SDK 的 npm 依赖，也不经过应用打包器二次处理；它与正常 npm 接入并列可选。

**第 1 步（联网机）**：安装已锁定版本的 SDK，从 `node_modules/lark-doc/dist/` 复制整个目录。

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
│       └── fonts/            ← 完整保留包内字体
├── index.html
└── vite.config.js
```

::: warning 别只拷那一个 `.js`
`math` / `office` / `highlight` / `mermaid` 是运行时的**动态加载目标**，`fonts/` 是公式渲染的字体。少一个就是「编辑器能开、点公式 404」。整目录一起放，同位放置——UMD 使用主 script 的 URL 推导同目录特性资源地址。
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
    uploader: {
      action: '/api/upload', // 你的后端接口，接收 multipart/form-data
      response: { success: { path: 'code', equals: 0 }, url: 'data.url' },
      onSuccess: (event) => console.log('图片结果', event.result.url),
      onError: (event) => console.error(event.error),
      onSettled: (event) => console.log('结束', event.status),
    },
    features: { ai: false },
  }
  el.value.addEventListener('lark-doc-change', (e) => console.log(e.detail.payload.json))
})
onBeforeUnmount(() => el.value && el.value.destroy())
</script>
```

这里假设后端返回 `{ "code": 0, "data": { "url": "/images/a.png" } }`；路径和字段按你的接口修改。上传 SDK 会等待地址返回后插入图片；完整回调与错误处理见[上传器](/blocks/uploader)。

**第 6 步（内网）**：构建并检查资源是否跟着走。

```bash
npm run build
ls dist/vendor/lark-doc/         # public/ 下的东西原样复制到产物根
ls dist/vendor/lark-doc/fonts           # 与 SDK 内 fonts 目录完整一致
```

### 4.3 npm 路线：正常安装与 import

Vue3 无需跳过 peer 校验。内网按[2.4](#mig-vendor)带齐整个应用依赖后，普通 `npm ci` 即可。业务中推荐命令式根入口：

```js
import { LarkDoc } from 'lark-doc'
import 'lark-doc/style.css'
```

也可 `import 'lark-doc/element'` 注册标签，此时是现代 Element ESM，特性与字体由 Vite 构建处理，不再套用旧 UMD 的手动复制规则。Vue3 组件、完整上传回调及卸载示例见[各环境接入](/guide/environments#env-vue3)。

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
| Vue 2.7 + Webpack4 | 业务 import；CSS / 深入口用实际路径 | 同版 tgz、锁文件、完整依赖来源 |
| Vue 2.7 + Webpack5 | 业务 import 与公共 CSS | 同上 |
| Vue3 + Vite（npm） | 业务 import；用标签时配置 isCustomElement | 同上 |
| Vue3 + Vite（静态 UMD） | isCustomElement、index.html script | public/vendor/lark-doc/ 完整 dist |

超出这张表的改动，通常是踩了「抄错另一档配置」的坑——回到[第 0 节](#mig-host-matrix)重新对一遍。

## 7. 下一步

编译通过只说明包能在内网用。上线还差三件事：**静态资源托管（`dist/` 整目录同位）、nginx 路由与 MIME、验收与回滚**，全部在[内网服务器部署](/guide/deployment-intranet)；断网后的运行时行为（图片外链、AI 请求）见[离线与资源本地化](/guide/offline)。
