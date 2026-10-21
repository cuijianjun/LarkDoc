# feishu-document

Vue 2 + Tiptap 3 的飞书风格文档编辑器与工作台包（`0.4.0`）。

完整文档：[VitePress 使用手册](https://your-docs-host/feishu-document/)（源码在 `codex/开发agent/aieditor-core-docs`）。

## 接入方式

默认导出是命令式入口，View 层只留一个挂载点：

```js
import { FeishuDocument } from 'feishu-document'
import 'feishu-document/style.css'

const doc = new FeishuDocument({
  element: '#editor',
  title: '未命名文档',
  content: '<p>开始编辑。</p>',
})

doc.getHTML()
doc.getJSON()
doc.destroy()
```

## 旧数据兼容（Vditor）

Vditor `getHTML()` 导出的 HTML 可直接喂给 `content`，命中 `vditor-*` / `language-math` / 图表 `language-*` 等指纹时自动归一化公式、任务列表、图表代码块、脚注与表格列宽：

```js
const doc = new FeishuDocument({ element: '#editor', content: vditorHtml })
doc.importVditor(vditorHtml)      // 或显式强制归一化
doc.getImportReport()             // { source, math, taskList, taskItem, diagram, table, footnote, dropped }
```

图片无需配置（默认 `open`，http 直连）。校验脚本 `npm run check:vditor`。

旧调用方式仍然可用：

```js
import {
  FeishuDocumentEditor,
  FeishuDocumentWorkspace,
} from 'feishu-document'
```

`style.css` 是唯一公开样式入口，宿主只需引入一次；它包含正文样式与本地 KaTeX 字体，不要直接引 `src/components/feishu/feishu.css`。

## 资源本地化与网络策略

- KaTeX 样式与字体随包发布（`src/assets/fonts/katex`），构建产物带 `dist/fonts/`；代码高亮、Emoji 同样本地化，不请求任何 CDN。
- `network.mode` 默认 `open`：正文里的外链图片（含老系统的 http 图床）按原地址加载，开箱可用。
- 需要收敛时显式配置：

```js
new FeishuDocument({
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
new FeishuDocument({
  element: this.$refs.host,
  title: '项目说明',
  content: record,                 // HTML / Tiptap JSON / 文档信封
  readonly: false,
  storage: 'none',                 // 默认不写 localStorage
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

## 构建与校验

```bash
nvm use 14.21.3
npm ci
npm run check          # node14 + offline + feishu + architecture + lint + build
```

单独跑：

```bash
npm run check:offline
npm run check:feishu
npm run build
```

## 产物与按需加载

四份产物按「宿主怎么用」划分，重依赖（KaTeX / docx / mammoth / marked / turndown / highlight.js）
全部拆成按需区块，首屏不下载：

```bash
npm run build          # dist/feishu-document.common.js        CJS 单文件（main）
npm run build:umd      # dist/feishu-document.umd.min.js       <script> / CDN（unpkg）
npm run build:esm      # dist/feishu-document.esm.js           ES Module（module，拆包最彻底）
npm run build:element  # dist/feishu-document-element.umd.min.js  Web Component（Vue 内联）
npm run build:analyze  # 以上四份 + 体积诊断输出
```

首屏 JS：UMD 847 KB（gzip 246）、element 930 KB（gzip 275）、ESM 848 KB（gzip 248，三块并行），
改造前分别是 1.91 MB（gzip 548）与 2.16 MB（gzip 658）。
部署时按需区块要与主文件同目录，详见文档站「打包产物与按需加载」。

## 边界

包默认不创建 Yjs、WebSocket 或后台连接。`DocumentSession` 统一文档身份、事务来源、能力判断和 Provider 生命周期；协同、版本、评论、权限都通过显式 Provider 接入。数据模型与 Provider 契约见 [DEMO_INTEGRATION_GUIDE.md](DEMO_INTEGRATION_GUIDE.md)。

Demo 应用只负责路由与页面呈现；本仓库通过 `file:` 依赖以真实消费方的方式验证包，开发期再 alias 到源码。
