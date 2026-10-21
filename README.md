# feishu-document

Vue 2 + Tiptap 3 的飞书风格文档编辑器与工作台包。

当前迁移基线包含 `/feishu-document` 的全部单人编辑能力：富文本、块操作、表格、图片、公式、目录、搜索替换、模板、本地草稿、本地快照、导入导出和确定性 Mock AI。`FeishuDocumentEditor` 负责编辑器交互，`FeishuDocumentWorkspace` 负责文档工作台流程。

包不在默认模式创建 Yjs、WebSocket 或真实后台连接。`DocumentSession` 统一文档身份、事务来源、能力判断和 Provider 生命周期；后续协同编辑、版本服务、评论线程和权限控制通过 Provider 层接入，保持编辑器核心和 Demo 调用方式稳定。完整的文件职责、数据模型和 Provider 契约见 [DEMO_INTEGRATION_GUIDE.md](DEMO_INTEGRATION_GUIDE.md)。

## 构建

```bash
nvm use 14.21.3
npm ci
npm run check
```

## Vue 2 使用

```js
import {
  FeishuDocumentEditor,
  FeishuDocumentWorkspace,
} from 'feishu-document'
import 'feishu-document/style.css'
```

`style.css` 是包公开的样式入口，宿主应用只需要引入一次；入口会加载包内命名空间样式和 KaTeX 样式，组件内部的 `src/components/feishu/feishu.css` 不应由宿主应用直接引用。

标题栏默认随页面滚动。需要让标题栏吸附在窗口顶端时，在 `FeishuDocumentEditor` 或 `FeishuDocumentWorkspace` 上传入布局配置：

```vue
<FeishuDocumentWorkspace :config="{ layout: { titleBarFixed: true } }" />
```

`titleBarFixed` 默认是 `false`，只控制文档标题栏，下面的编辑工具栏仍按页面正常滚动。

Demo 应用只负责路由和页面呈现，包本身包含编辑器和工作台能力。发布包时，Vue 2.7 应用直接使用 `npm i feishu-document`；本仓库 Demo 通过本地 `file:` 依赖验证同样的调用方式。
