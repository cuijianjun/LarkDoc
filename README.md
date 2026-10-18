# @tiptap-integration/feishu-document

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
} from '@tiptap-integration/feishu-document'
import '@tiptap-integration/feishu-document/dist/feishu-document.css'
```

Demo 应用只负责路由和页面呈现，包本身包含编辑器和工作台能力。发布包时，Vue 2.7 应用直接使用 `npm i @tiptap-integration/feishu-document`；本仓库 Demo 通过本地 `file:` 依赖验证同样的调用方式。
