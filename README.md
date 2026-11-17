# lark-doc

> 本项目用于个人学习与技术研究，界面与交互参考飞书文档；与飞书、Lark、字节跳动无隶属、合作或授权关系。使用前请阅读本文末尾的背景、免责声明与协议。

基于 Tiptap 3 和原生 DOM 的文档编辑器，支持 Vue2、Vue3、React、普通 HTML 和 Web Component。

## 从你的环境开始

[打开统一示例中心](https://cuijianjun.github.io/LarkDoc/examples/)。每个页面都有完整的**安装、引入、配置、最小工程代码和可运行预览**，照着一个页面即可跑起来。

| 你的环境 | 完整接入页面 |
| --- | --- |
| Vue2 + Webpack5 | [安装、配置与 demo](https://cuijianjun.github.io/LarkDoc/examples/vue2-webpack5.html) |
| Vue2 + Webpack4 | [安装、配置与 demo](https://cuijianjun.github.io/LarkDoc/examples/vue2-webpack4.html) |
| Vue3 + Vite | [安装、配置与 demo](https://cuijianjun.github.io/LarkDoc/examples/vue3-vite.html) |
| React + Vite | [安装、配置与 demo](https://cuijianjun.github.io/LarkDoc/examples/react-vite.html) |
| 原生 HTML / CDN | [安装、配置与 demo](https://cuijianjun.github.io/LarkDoc/examples/html-cdn.html) |
| Web Component | [安装、配置与 demo](https://cuijianjun.github.io/LarkDoc/examples/web-component.html) |

已有应用先安装 SDK，再按对应环境页检查构建配置；原有框架和打包器保持不变：

```bash
npm install lark-doc@0.14.6 --save-exact
```

六个示例使用同一版本。库由 Rollup 构建，不携带 Vue 或 Webpack 运行时；Vue/React 由应用提供。

## 跑起来之后

- **保存正文**：监听 `onUpdate`，读取 `doc.getJSON()`；页面卸载时调用 `doc.destroy()`。示例显式使用 `storage: 'none'`，由应用保存内容；默认 `local` 使用浏览器草稿。
- **图片上传**：未配置上传接口时本地转 base64。配置 `uploader.action` 和 `response` 后，SDK 先上传、等待地址、再插图；各环境页面都附有服务器配置与完整回调。
- **帮助菜单**：`help: { enabled: false }` 关闭右下角问号；`items` 选择菜单，`onAction` 接入应用行为，见[帮助菜单配置](https://cuijianjun.github.io/LarkDoc/guide/configuration.html#help)。
- **图表与公式**：工具栏、插入「＋」和斜杠菜单提供同一套六类型图表选择与图标；默认按需加载实现。需要全量或 lite 时再看[产物与按需加载](https://cuijianjun.github.io/LarkDoc/guide/build-artifacts.html)。

GitHub Pages 托管静态页面，服务器上传需要填写你自己的接口。

公开 npm 版 `0.14.6` 保持由宿主共享运行依赖。完全离线接入使用基于它单独构建的 `0.14.6-intranet.1` 自包含 tgz，带齐 SDK 运行依赖和 Webpack4 兼容入口；普通 `npm pack lark-doc@0.14.6` 不能代替它。Vue2 使用 npm，Vue3 使用 pnpm 9/10，安装命令和两套最小 demo 见[内网接入说明](./docs/guide/intranet-migration.md)。npm 本地安装使用显式包名 `lark-doc@file:...`，可省去 npm 8 的一次识名解包。SDK 自包含不包含原应用的 Vue、构建工具和业务依赖。

## 文档怎么查

| 你要做什么 | 阅读入口 |
| --- | --- |
| 首次接入、运行最小 demo | [统一示例中心](https://cuijianjun.github.io/LarkDoc/examples/) |
| 查询上传参数和回调时序 | [上传器参考](https://cuijianjun.github.io/LarkDoc/blocks/uploader.html) |
| 查询工具栏、功能和实例 API | [配置参考](https://cuijianjun.github.io/LarkDoc/guide/configuration.html) · [实例与事件](https://cuijianjun.github.io/LarkDoc/guide/instance.html) |
| 修改编辑器源码、测试或发布 | [仓库开发入口](https://github.com/cuijianjun/LarkDoc/blob/master/DEVELOPMENT.md) |
| 业务保存、Provider 与协同 | [业务接入指南](https://cuijianjun.github.io/LarkDoc/guide/view-integration.html) |
| 查询新增功能、问题修复和上线状态 | [变更与上线记录](./DEVELOPMENT.md#release-history) |
| Windows 内网安装、Linux 文档部署 | [两环境内网迁移](https://cuijianjun.github.io/LarkDoc/guide/intranet-migration.html) |

[配置 Playground](https://cuijianjun.github.io/LarkDoc/demo/)用于在线修改初始化代码。
源码构建、历史性能验收和文档站部署资料保留在[仓库开发导航](https://github.com/cuijianjun/LarkDoc/blob/master/dev/00-INDEX.md)，由维护者继续更新。

## 背景

- **为什么写**：用于个人学习与技术研究的练习项目，目的是吃透富文本编辑器的工程实现 —— ProseMirror 文档模型、
  Tiptap 3 扩展机制、原生 DOM 渲染层，以及块级结构、折叠/高亮、标题自动编号、列表缩进、气泡菜单、表格交互等
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



# TODOLIST
1. 自动保存开启
2. 安装 引入 webpack配置 适配vue2 vue3 react script
3. ai模块适合接口和api_key两种形式
4. ai模块交互形成各个选项配置 并且满足目前互联网的要求
4. 移动端交互兼容设备范围（苹果8 9 10 11）图片 文字 媒体块的兼容
5. mcp 
6. 包整体的格式化
7. 导入导出按钮分开 格式可配
8. 图片，等媒体在html中的展示方式
9. 图表渲染不出来
10. 编辑模式 编辑-修订-只读


### H5 knowledge-library and host actions

The mobile directory is separate from document headings. Search uses the current authorization Provider's `searchDocuments({ query })` (up to 20 authorized results); this is not a full-library tree. Without a directory adapter the drawer shows only the current document and an integration notice.

The existing `onDocumentAction` hook can handle `list-knowledge-library` with the current `documentId`/`actorId`. Return `{ status: 'resolved', items: [...] }`; each item has `displayName` and `docId` (document) or `id`/`children` (folder). Documents may also have `children`, with separate expansion and navigation controls. Node IDs must be unique, names bounded to 255 characters, at most 200 nodes and eight nested levels. The host must authorize names and nodes before returning them. Omitted/unsupported results do not imply a complete directory.

Before mounting, the host may attach `onDocumentAction.documentMetadata = { documentId, author: { name }, modifiedAt }` for the mobile header. Supply authorized document metadata: the document ID must exactly match the current, known Session ID, and `modifiedAt` must be an actual modification timestamp (epoch milliseconds or a valid date string). Missing metadata remains unknown; the viewing user and the Session export clock are not substitutes for the document author or modification time. This display metadata does not grant permissions or configure sharing services.

Sharing selected content uses a separate recipient flow, not the document's link-permission card. Its existing `onSelectionShare({ selection, url, recipients, message, signal })` callback must wait for a real send acknowledgement; reject or return `false` on failure. A placeholder callback must not report a completed send. The SDK does not supply an external sender or create real chat groups by default; these integrations remain visibly unavailable until the host configures them. Recipient search uses the authorized mention directory and does not establish a full contact list.

`open-document-reference` retains its existing navigation acknowledgement. `open-in-app` and `report` delegate the mobile more-menu action to the host; return `true` only after successfully opening/handing off that flow. This is not a report-submission receipt. Missing integrations show an unavailable message. `文档功能` in the library drawer (or Shift+Enter on the more button) retains the SDK's modes, host actions and in-document outline.

The HTTP demo wires `createHttpDocumentHost` to a PostgreSQL-backed `knowledge-library` endpoint and a separate `examples/document-report.html` page. The local directory is explicitly a local test library; existing bodies, titles and folder placement are retained. A partial adapter must declare `onDocumentAction.supportedActions` as an array of implemented action names; unsupported host actions stay disabled, while callbacks without this metadata retain their existing behavior. The host callback may supply `openInAppLabel` to describe its configured launch target: the demo says **在浏览器中打开** and opens the same document in a new browser tab. It does not launch a Feishu native client or map the local document to the Feishu reference.

New tabs receive CSRF through an opaque, same-origin BroadcastChannel while the source page remains open; credentials and actor IDs never enter the URL. A report stores an original operation ID in its fragment, keeps it after an uncertain response, and queries that ID after reload. A closed source page requires reopening the flow from an authenticated document; no new submission should replace an uncertain original. Only a durable `committed` receipt displays **举报已接收**. `received` is local persistence, not moderation completion. Image evidence is visibly unavailable pending an upload integration. The Java host can proxy the end-user contract documented in the backend `ops/document-business.openapi.json`; it must not invent actor identity or reuse its service mTLS as a user session.
