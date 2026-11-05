# lark-doc

> 本项目用于个人学习与技术研究，界面与交互参考飞书文档；与飞书、Lark、字节跳动无隶属、合作或授权关系。使用前请阅读本文末尾的背景、免责声明与协议。

基于 Tiptap 3 和原生 DOM 的文档编辑器，支持 Vue2、Vue3、React、Web Component 和普通 HTML 页面。

[使用文档](https://cuijianjun.github.io/LarkDoc/) · [在线 demo](https://cuijianjun.github.io/LarkDoc/demo/) · [开发说明](./DEVELOPMENT.md)

## 1. 安装并显示编辑器

在已有应用中安装，不需要为编辑器补装 Vue，也不需要更换应用的 Vue CLI、Webpack 或 Vite。

```bash
npm install lark-doc@0.14.4 --save-exact
```

页面先放一个容器，再执行初始化代码：

```html
<div id="editor"></div>
```

```js
import { LarkDoc } from 'lark-doc'
import 'lark-doc/style.css'

const doc = new LarkDoc({
  element: '#editor',
  title: '我的第一篇文档',
  content: '<p>开始编辑，也可以粘贴或拖入图片。</p>',
  storage: 'none', // 示例不读取或保存本地草稿
  onUpdate: ({ json }) => console.log('正文已更新', json),
})

// 需要时读取内容：doc.getJSON() / doc.getHTML()
// 离开页面时调用：doc.destroy()
```

`content` 接收 HTML、Tiptap JSON 或文档记录。`storage` 默认是 `local`，会使用浏览器草稿；由应用管理正文时建议明确传 `none`。框架中必须在挂载后创建、卸载时销毁，完整示例见[各环境接入](./docs/guide/environments.md)。

## 2. 上传到服务器，再显示图片

只需要在初始化时配置上传接口和响应字段。库负责发送文件、等待响应、校验地址和写入编辑器，应用不用再实现 `upload()`。

```js
const uploader = {
  action: '/api/upload', // 改为你的后端上传接口
  fieldName: 'file',     // 后端接收的文件字段名
  response: {
    success: { path: 'code', equals: 0 },
    url: 'data.url',
    attchId: 'data.id',
    message: 'message',
  },
  onProgress: event => console.log('上传进度', event.percent),
  onSuccess: event => console.log('取得图片地址', event.taskId),
  onError: event => console.error('上传失败', event.error.message),
  onSettled: event => console.log('任务结束', event.status),
}

const doc = new LarkDoc({ element: '#editor', storage: 'none', uploader })
```

上例后端返回 JSON：

```json
{ "code": 0, "message": "上传成功", "data": { "url": "/images/a.png", "id": "123" } }
```

`url` 可以是 HTTP(S) 地址、相对图片路径或支持的图片 base64。后端直接返回 `{ "url": "/images/a.png" }` 时，可省略 `response`。

- **本地 base64**：不配置 `action` 和 `upload`，仍可收到上传生命周期回调。
- **自定义流程**：提供 `uploader.upload(file, ctx)`，返回 `{ url, attchId? }`；它优先于 `action`。
- **完整回调**：`beforeUpload`、`onStart`、`onProgress`、`onRetry`、`onSuccess`、`onError`、`onCancel`、`onReject`、`onSettled`，五种图片来源共用；`onCallbackError` 处理应用通知异常。
- **失败处理**：服务器失败不会改成本地 base64；`onSuccess` 无需再次插图。正文更新与服务端保存应分别监听文档事件。

[上传器完整配置与回调](./docs/blocks/uploader.md)包含请求头、额外字段、跨域、超时、重试、取消和 Vue2/Vue3 透传写法。

## 3. 全量引入或按需引入

| 入口 | 适合的场景 | 样式 |
| --- | --- | --- |
| `lark-doc` | 推荐起点；重功能在使用时加载 | 显式引 `lark-doc/style.css` |
| `lark-doc/full` | 一次注册所有本地特性，仍提供相同编辑器 API | 同上 |
| `lark-doc/lite` + `lark-doc/features/*` | 只加载需要的公式、图表等实现 | 同上；math 还需特性 CSS |
| `lark-doc/element` | `<lark-doc>` 自定义元素或 `mountLarkDoc()` | JS 自动注入 |
| `lark-doc/vue2` | 旧 Vue2 模板使用 options 兼容组件 | 显式引公共 CSS |

全量写法只需把第一节的 import 改成 `import { LarkDoc } from 'lark-doc/full'`。按需示例：

```js
import { LarkDoc } from 'lark-doc/lite'
import 'lark-doc/style.css'
import 'lark-doc/features/mermaid' // 图表
import 'lark-doc/features/math'    // 公式
import 'lark-doc/dist/features/math.css'

const doc = new LarkDoc({ element: '#editor', storage: 'none' })
```

可选特性还有 `highlight`、`markdown`、`office`。lite 没注册某特性时保留可读降级或提示，不会自动下载被排除的实现。协同始终从 `lark-doc/collab` 显式接入。

## 4. 各环境怎么用

| 环境 | 推荐写法 | 配置差异 |
| --- | --- | --- |
| Vue2 | `mounted` 中 `new LarkDoc()`，`beforeDestroy` 中销毁 | 保留宿主现有 Vue2 工具链 |
| Vue3 | `onMounted` 中创建，`onBeforeUnmount` 中销毁 | 命令式无需专属配置；标签方式配置 `isCustomElement` |
| React | `useEffect` 中创建并返回销毁函数 | 标签薄壳用 `createReactLarkDoc(React)` |
| Webpack4 | 同一主入口 | CSS 写实际路径 `lark-doc/dist/lark-doc.css`；深入口也使用实际文件路径 |
| 普通 HTML / CDN | 独立 script 加载 `dist/lark-doc-element.umd.min.js` | 完整托管 `dist/`，保留特性脚本、字体和子目录 |
| SSR | 客户端生命周期内动态导入并创建 | 不在服务端创建依赖 DOM 的编辑器 |

库的默认、full、lite、Element 和兼容产物均由 **Rollup** 构建，不包含 Vue 运行时或包内 Webpack runtime。`lark-doc/vue2` 的 options 对象交给应用已有 Vue2 注册，库自身不导入 Vue。主库的构建方式不改变应用自己的打包器。

Webpack4 根 ESM 已降语法，无需旧的 `lark-doc$` alias；新的 Element ESM 面向现代 Vite/Webpack5，Webpack4 标签方案使用独立 script 加载 UMD。安装、引入、配置与清理的[完整示例](./docs/guide/environments.md)使用同一套上传配置。

## 5. 先运行这些 demo

- [编辑器 Playground](https://cuijianjun.github.io/LarkDoc/demo/)：编辑初始化代码并预览。
- [本地 base64 与回调](https://cuijianjun.github.io/LarkDoc/demo/?example=base64)：无需上传服务器。
- [服务器上传配置](https://cuijianjun.github.io/LarkDoc/demo/?example=server)：填入自己的接口后测试。
- [图表渲染](https://cuijianjun.github.io/LarkDoc/demo/?example=diagram)：查看 Mermaid 图表。

GitHub Pages 托管文档与静态 demo，不提供业务上传后端。跨域接口需要后端允许页面来源；不要在演示代码里保存长期凭证。

## 6. 开发、性能与边界

[DEVELOPMENT.md](./DEVELOPMENT.md)介绍源码安装、快速检查和发布流程。[性能记录](./docs/guide/performance.md)分别记录库冷构建、应用冷构建与缓存构建，不能用切换库打包器来推断应用速度。

普通编辑不会主动创建 Yjs 或 WebSocket。显式协同需要应用提供匹配格式的协同依赖和单例，见[接入与架构指南](./DEMO_INTEGRATION_GUIDE.md)。Node14.21.3 的兼容范围为库构建和普通 CJS 编辑，不代表所有开发工具或协同依赖都能在 Node14 运行。

Vditor HTML 可直接作为 `content`，也可用 `doc.importVditor(html)`；字体、Mermaid、公式与高亮资源随包发布。静态部署应保留整个 `dist/`，本地资源不依赖外部 CDN；正文外链和上传接口仍按应用网络配置访问。

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
