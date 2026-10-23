# LarkDoc 包接入与架构指南

## 1. 包的职责

`lark-doc` 把 `/lark-doc` 的编辑能力从 Demo 路由中抽离出来。宿主应用负责路由、页面布局、登录用户和服务端 API；包负责 Tiptap 编辑器、工作区交互、文档格式、Provider 契约和本地单人模式。

包公开两个稳定的 Vue 2 组件入口：

| 入口 | 职责 | 适用场景 |
| --- | --- | --- |
| `LarkDocEditor` | Tiptap 实例、工具栏、块操作、表格、图片、公式、目录、搜索替换、命令菜单和 AI/审阅交互 | 只需要编辑器，页面状态由宿主自己管理 |
| `LarkDocWorkspace` | 编辑器之上的标题、模板、草稿、快照、导入导出、Mock AI 预览和持久化接入 | 需要完整文档工作台，或希望以后接协同/版本/评论 |

当前默认是本地模式：不会自动创建 Yjs、WebSocket 或后台请求。协同、版本、评论和权限只有在宿主显式传入对应 Provider 后才会启用。

## 2. 安装与最小用法

发布后，Vue 2.7 应用可以直接安装：

```bash
npm i lark-doc
```

### 2.1 命令式入口（推荐）

```js
import { LarkDoc } from 'lark-doc'
import 'lark-doc/style.css'

const doc = new LarkDoc({
  element: '#editor',
  title: '未命名文档',
  content: '<p>开始编辑。</p>',
})

doc.on('update', ({ html, json }) => { /* 自动保存 */ })
doc.destroy()
```

`src/LarkDoc.js` 只做四件事：把 AiEditor 风格配置翻译成 `createLarkDocConfig` 结构、用 Vue 渲染函数挂载 Workspace、把实例方法转发给 Workspace/Editor、按固定顺序销毁。它不实现编辑器逻辑。

### 2.2 组件式（原有方式）

```js
import Vue from 'vue'
import {
  LarkDocEditor,
  LarkDocWorkspace,
} from 'lark-doc'
import 'lark-doc/style.css'

Vue.component('LarkDocEditor', LarkDocEditor)
Vue.component('LarkDocWorkspace', LarkDocWorkspace)
```

`style.css` 是包根目录的公开样式入口，宿主应用只引入一次；入口会加载包内命名空间样式和本地 KaTeX 样式，`src/components/lark-doc/lark-doc.css` 不应由宿主应用直接引用。

### 2.3 离线承诺

- `network.mode` 默认 `offline`，外链图片降级为占位块并保留 `data-original-src`。
- KaTeX 样式与字体收在 `src/styles/vendor/katex.css` 与 `src/assets/fonts/katex/`，构建产物带 `dist/fonts/`。
- `npm run check:offline` 会扫描 `src`、`dist` 的远程地址并校验字体完整性。

本仓库的 `vue2-webpack-node14` Demo 通过同级本地 `file:` 依赖消费 `lark-doc` 包，入口只有 `src/views/LarkDocView.vue`（内部 `new LarkDoc(...)`）；这保证 Demo 的调用方式和 npm 使用方一致。

标题栏布局可以按宿主页面选择是否固定：

```vue
<LarkDocWorkspace :config="{ layout: { titleBarFixed: true } }" />
```

`layout.titleBarFixed` 默认值为 `false`。开启后只有顶部标题栏吸附到窗口顶端，编辑工具栏保持原有文档流位置；`LarkDocEditor` 与 `LarkDocWorkspace` 均支持该配置。

## 3. 目录结构

```text
src/
  index.js                         公共导出：默认 LarkDoc，具名保留组件与工具
  LarkDoc.js                命令式入口：配置翻译、挂载、方法转发、销毁
  toolbarKeys.js                   toolbarKeys / toolbarExcludes 到内部工具栏的映射
  networkPolicy.js                 出网策略：offline / allowlist / open 与图片拦截
  styles/vendor/katex.css          收编的 KaTeX 样式，字体为相对路径
  assets/fonts/katex/              随包发布的 KaTeX 字体（woff2 + woff）
  core/
    documentSchema.js              文档 JSON 信封、Schema 版本和节点身份
    migrations.js                  正文 Schema 迁移注册表
    transactionMetadata.js         ProseMirror transaction 来源和审计元数据
  session/
    DocumentSession.js             文档会话、编辑器绑定、能力判断和生命周期
  providers/
    authorization.js               权限能力集合和授权 Provider 校验
    collaboration.js               协同 Provider 最小接口校验
    comments.js                    评论线程 Provider 最小接口校验
    persistence.js                 草稿/本地快照 Provider 兼容层
    versioning.js                  不可变版本 Provider 最小接口校验
    index.js                       Provider 统一导出
  components/lark-doc/
    LarkDocEditor.vue       编辑器 UI 和 Tiptap 生命周期
    LarkDocWorkspace.vue    工作台 UI、持久化和 Session 接入
    CommandMenu.vue                `/` 命令菜单
    CodeNode.vue                   代码块 NodeView 和高亮加载
    ImageNode.vue                  图片 NodeView、附件和裁剪
    commands.js                    块级命令实现
    documentOperations.js          文档级操作和块移动/复制/删除
    ecsImages.js                   ECS 图片上传适配器
    extensions.js                  Tiptap 扩展集合
    larkDocConfig.js                默认配置和能力开关
    mockAI.js                      确定性 AI 预览、审阅和提案
    templates.js                   内置模板
    workspace.js                   本地草稿和快照存储
    lark-doc.css                     组件样式，使用 `.lark-doc` 命名空间
  utils/
    importExport.js                HTML/Markdown/DOCX/JSON 转换
    logger.js                      脱敏日志
    safety.js                      文档、评论和名称校验
scripts/
  check-architecture.js            Schema、Session、能力和 Provider 契约检查
  check-lark-doc-core.js             编辑器核心行为检查
  check-lark-doc-workspace.js        工作区和本地持久化检查
  check-ecs-images.js              ECS 图片适配器检查
```

包根目录的 `style.css` 组合包内命名空间样式与 KaTeX 样式，并随 npm 包发布；这样宿主应用可以使用与 AiEditor 相同的显式样式接入方式，同时避免宿主 `css-loader` 对已编译 CSS 的字体路径进行二次解析。

注释集中解释跨模块约束、Node 14 兼容、销毁顺序、数据边界和 Provider 设计；普通 Vue 模板、赋值和循环不重复写逐行注释。需要理解某个函数时，先看同目录的契约检查脚本，再看组件对外方法。

## 4. 文档数据模型

正文仍是 Tiptap JSON，包在可演进的文档信封中：

```js
{
  documentId: 'doc-1',
  schemaVersion: 1,
  revisionId: 'revision-42',
  content: { type: 'doc', content: [{ type: 'paragraph' }] },
  title: '示例文档',
  updatedAt: 1730000000000,
}
```

`normalizeDocumentRecord` 同时兼容历史 `{ title, json }` 记录，`getDocumentContent` 只返回正文。`schemaVersion` 由 `migrations.js` 逐版本迁移；评论、Presence、权限和 AI 运行状态不写入正文版本。`getNodeId` 为未来评论和 AI 锚点读取稳定块 ID，旧节点没有 ID 时返回 `null`，不会擅自改变现有文档。

## 5. DocumentSession 生命周期

`createDocumentSession(options)` 创建会话，常用字段如下：

```js
const session = createDocumentSession({
  documentId: 'doc-1',
  mode: 'local', // collaborative 模式必须提供 collaboration Provider
  user: { id: 'user-1' },
  providers: { persistence, authorization },
})
```

生命周期顺序是：组件创建 Session → 编辑器 `ready` 后 `attachEditor` → 宿主按需 `connect` → 路由离开时先销毁编辑器，再 `dispose` Session。`getProvider`、`setProvider`、`getCapabilities`、`can`、`createVersion` 和 `restoreVersion` 是宿主可调用的边界。`on(event, listener)` 用于监听 `editor`、`capabilities` 和 `connection` 事件。

每次需要标记来源的 ProseMirror transaction 都通过 `transactionMetadata.js` 写入统一 meta：`user`、`remote`、`import`、`restore`、`ai`、`host`。这样撤销、审计、协同合并和未来服务端事件可以区分来源，而不需要修改编辑器命令。

## 6. Provider 契约

Provider 是宿主实现的纯 JavaScript 对象。包只在创建 Session 时校验方法存在，不绑定后端框架、Yjs 或 HTTP 客户端。

| Provider | 最小方法 | 约束 |
| --- | --- | --- |
| `persistence` | `load`, `save`, `snapshots`, `snapshot`, `restore` | 兼容当前 Demo 的本地草稿和最多 20 份快照，可同步或返回 Promise |
| `collaboration` | `connect`, `disconnect` | 只有 `mode: 'collaborative'` 才连接；Provider 自己负责 Yjs/Hocuspocus、Presence 和远端事务 |
| `versioning` | `list`, `createSnapshot`, `get`, `restore` | 快照不可变；恢复应创建新修订，不能覆盖历史记录 |
| `comments` | `list`, `createThread`, `reply`, `resolve`, `reopen` | 评论独立存储；长期锚点使用稳定 block ID 和 Provider 位置，不保存瞬时 `from/to` |
| `authorization` | `getCapabilities` | 服务端能力是最终判断，UI 能力只用于按钮、只读状态和交互提示 |

默认能力包括 `canView`、`canEdit`、`canComment`、`canResolveComment`、`canCreateVersion`、`canRestoreVersion`、`canExport` 和 `canManagePermission`。权限拒绝会在 Session 方法层抛错，宿主应将错误映射为自己的提示。

## 7. 从本地模式扩展到协同产品

推荐按以下顺序接入服务端，不改变组件入口：

1. 用服务端 `persistence` 替换本地草稿，保存 `DocumentRecord` 和 `revisionId`。
2. 注入 `authorization`，让服务端返回能力集合；编辑器只根据 `session.can('canEdit')` 控制交互。
3. 注入 `versioning`，把每次发布或手动保存变成不可变快照，恢复时产生新修订。
4. 注入 `comments`，用 block ID/相对位置解析评论锚点，避免正文插入后坐标漂移。
5. 最后注入 `collaboration`，把远端 transaction 标记为 `remote`，Presence 单独走 awareness，不混入版本正文。

AI 预览和提案也应沿用同一套 transaction metadata：生成结果先留在预览状态，用户确认后以 `ai` 来源提交；源选区或锚点失效时拒绝写入。

## 8. 验证

在 Node 14.21.3/npm 8.19.4 下运行：

```bash
npm ci
npm run check:architecture
npm run check:lark-doc
npm run lint
npm run build
```

`check:architecture` 验证文档信封、事务 meta、Session 生命周期、权限能力和 Provider 方法；核心/工作区检查验证现有编辑功能。构建会输出较大的单文件库，这是为了让 npm 消费方不需要额外部署动态 chunk；Vue 和 Tiptap 仍作为 peer 依赖解析。
