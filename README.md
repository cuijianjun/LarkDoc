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
npm install lark-doc@0.14.4 --save-exact
```

六个示例使用同一版本。库由 Rollup 构建，不携带 Vue 或 Webpack 运行时；Vue/React 由应用提供。

## 跑起来之后

- **保存正文**：监听 `onUpdate`，读取 `doc.getJSON()`；页面卸载时调用 `doc.destroy()`。示例显式使用 `storage: 'none'`，由应用保存内容；默认 `local` 使用浏览器草稿。
- **图片上传**：未配置上传接口时本地转 base64。配置 `uploader.action` 和 `response` 后，SDK 先上传、等待地址、再插图；各环境页面都附有服务器配置与完整回调。
- **图表与公式**：默认入口按需加载实现；需要全量或 lite 时再看[产物与按需加载](https://cuijianjun.github.io/LarkDoc/guide/build-artifacts.html)。

GitHub Pages 托管静态页面，服务器上传需要填写你自己的接口。

## 文档怎么查

| 你要做什么 | 阅读入口 |
| --- | --- |
| 首次接入、运行最小 demo | [统一示例中心](https://cuijianjun.github.io/LarkDoc/examples/) |
| 查询上传参数和回调时序 | [上传器参考](https://cuijianjun.github.io/LarkDoc/blocks/uploader.html) |
| 查询工具栏、功能和实例 API | [配置参考](https://cuijianjun.github.io/LarkDoc/guide/configuration.html) · [实例与事件](https://cuijianjun.github.io/LarkDoc/guide/instance.html) |
| 修改编辑器源码、测试或发布 | [本地开发与验证](https://cuijianjun.github.io/LarkDoc/guide/development.html) |
| 业务保存、Provider 与协同 | [进阶接入指南](https://github.com/cuijianjun/LarkDoc/blob/master/DEMO_INTEGRATION_GUIDE.md) |
| 内网安装或部署 | [安装与离线](https://cuijianjun.github.io/LarkDoc/guide/install.html) |

[配置 Playground](https://cuijianjun.github.io/LarkDoc/demo/)用于调整编辑器配置；[性能记录](https://cuijianjun.github.io/LarkDoc/guide/performance.html)包含构建耗时和验证边界。

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
