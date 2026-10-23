# 配置总览

## 概述

`new LarkDoc(options)` 的扁平配置会被翻译成编辑器内部的 `createLarkDocConfig` 结构。配置分为 9 个分组：`features` / `toolbar` / `commands` / `blockMenu` / `layout` / `text` / `network` / `limits` / `performance`。关闭某个能力只隐藏入口并阻止新操作，历史 JSON 仍可读取。

## 配置内容

```ts
new LarkDoc({
  element: '#editor',

  // ── 顶层便捷项（会翻译进对应分组） ──
  title: '未命名文档',          // → initialTitle
  content: '<p></p>',           // → initialContent
  placeholder: '输入正文…',     // → text.placeholder
  readonly: false,              // → readonly
  theme: 'light',               // 'light' | 'dark'（当前默认浅色）
  storage: 'none',              // 'none' | 'local'
  autofocus: false,             // 挂载后自动聚焦（只读态不聚焦）
  contentFormat: 'auto',        // 'auto' | 'vditor' | 'html'（旧数据归一化策略）

  // ── 工具栏裁剪 ──
  toolbarKeys: ['history', 'headings', 'marks', 'insert', 'tables'],
  toolbarExcludes: ['shortcuts'],

  // ── 能力开关 ──
  features: { ai: false, folding: true, importExport: true, diagram: true },

  // ── 上传 / AI / 网络 ──
  uploader: { upload: (file) => uploadToServer(file) },
  ai: { stream: myStreamFn },
  network: { mode: 'open', allowlist: [], imageProxy: async (url) => uploadByUrl(url) },

  // ── 协同 / 权限 ──
  mode: 'local',                // 'local' | 'collaborative'
  documentId: 'doc-42',         // 折叠偏好分键 / 协同文档标识
  user: { id: 'u-1', name: '张三' },
  capabilities: { canEdit: true },
  collaboration: myCollaborationProvider,  // 或 authorization / versioning / comments

  // ── 生命周期 ──
  onReady: () => {}, onUpdate: () => {}, onError: () => {}, onDestroy: () => {},
})
```

## 配置说明

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `element` | `string \| HTMLElement` | 必填 | 编辑器挂载容器。 |
| `title` | `string` | `'未命名文档'` | 文档标题，写入 `initialTitle`。 |
| `content` | `string \| object` | `''` | 初始内容，HTML / Tiptap JSON / DocumentRecord 均可。 |
| `placeholder` | `string` | `'输入正文，或输入 / 插入内容'` | 正文为空时的占位提示。 |
| `theme` | `'light' \| 'dark'` | `'light'` | 主题。 |
| `readonly` | `boolean` | `false` | 只读模式。 |
| `storage` | `'none' \| 'local'` | `'none'` | 控制器默认不写浏览器草稿；显式 `'local'` 才开启。 |
| `autofocus` | `boolean` | `false` | 挂载后自动聚焦（只读态不聚焦）。 |
| `contentFormat` | `'auto' \| 'vditor' \| 'html'` | `'auto'` | 旧数据归一化策略，详见[旧数据导入](/guide/vditor-import)。 |
| `toolbarKeys` | `string[]` | - | 工具栏白名单，详见[工具栏配置](/guide/toolbar)。 |
| `toolbarExcludes` | `string[]` | - | 工具栏黑名单。 |
| `features` | `Record<string, boolean>` | 全开 | 能力开关，见下表。 |
| `uploader` | `{ upload }` | - | 图片上传钩子，详见[上传器](/blocks/uploader)。 |
| `ai` | `{ stream }` | 内置 Mock | AI 服务接管，详见 [AI 组件](/blocks/ai)。 |
| `network` | `{ mode, allowlist, imageProxy }` | `{ mode: 'open' }` | 出网策略与转存钩子，详见[网络策略](/blocks/network)。 |
| `mode` | `'local' \| 'collaborative'` | `'local'` | 会话模式；`collaborative` 必须同时提供 `collaboration` Provider。 |
| `documentId` | `string` | `''` | 折叠偏好分键 / 协同文档标识。 |
| `user` | `object` | `null` | 当前用户，传给协同 / 授权 Provider。 |
| `capabilities` | `object` | 全放行 | 权限能力初始值，见[协同与权限](/guide/collaboration)。 |
| `collaboration` / `authorization` / `versioning` / `comments` | Provider 对象 | - | 协同 / 权限 / 版本 / 评论 Provider 快捷项，门面代建会话。 |
| `onReady` | `(payload) => void` | - | 编辑器就绪回调。 |
| `onUpdate` | `(payload) => void` | - | 内容变更回调。 |
| `onChange` | `(payload) => void` | - | 编辑器原生 change 回调。 |
| `onSave` | `(payload) => void` | - | 保存完成回调。 |
| `onImportReport` | `(report) => void` | - | 旧数据归一化完成回调。 |
| `onError` | `(error) => void` | - | 错误回调。 |
| `onDestroy` | `() => void` | - | 销毁回调。 |

### features 能力开关

| 名称 | 说明 | 名称 | 说明 |
| --- | --- | --- | --- |
| `history` | 撤销 / 重做 | `search` | 查找替换 |
| `headings` | 标题 | `outline` | 目录 |
| `marks` | 行内格式 | `folding` | 折叠块 |
| `textStyle` | 文字样式 | `blockHandle` | 块句柄 |
| `blockStyle` | 段落样式 | `blockDrag` | 块拖拽 |
| `tables` | 表格 | `ai` | AI 组件 |
| `images` | 图片 | `viewModes` | 视图模式 |
| `codeBlocks` | 代码块 | `shortcuts` | 快捷键面板 |
| `math` | 数学公式 | `insert` | 插入菜单 |
| `emoji` | 表情 | `persistence` | 草稿持久化 |
| `templates` | 模板 | `importExport` | 导入导出 |
| `callouts` | 高亮块 | `diagram` | 图表渲染（mermaid） |
| `columns` | 分栏 | | |

### 内部分组直传

跳过扁平翻译、直接传内部结构也是支持的：

| 分组 | 关键字段 | 说明 |
| --- | --- | --- |
| `commands` | `disabled: string[]`、`allow: string[] \| null` | 按命令 id 禁用或白名单（如 `setEmoji`）。 |
| `blockMenu` | `disabled: string[]`、`allow: string[] \| null` | 块句柄菜单动作裁剪（`duplicate` / `moveUp` / `delete` 等）。 |
| `layout` | `titleBarFixed: boolean`、`toolbarFixed: boolean`、`headerVisible: boolean` | 标题栏 / 格式工具栏是否吸附顶端；`headerVisible: false` 隐藏顶栏并把操作入口移入工具栏「⋯」下拉。 |
| `limits` | 见下 | 上限控制。 |
| `performance` | 见下 | 性能开关。 |

### limits 上限

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `titleLength` | `120` | 标题最大长度。 |
| `maxLength` | `0`（不限） | 正文最大字符数。 |
| `maxImageSize` | `5MB` | 单张图片大小上限。 |
| `maxTableRows` / `maxTableColumns` | `9` / `9` | 表格行列上限（硬上限 9）。 |
| `maxIndent` | `5` | 缩进层级硬上限（只能调低；单块的实际上限还受「前一个块」约束）。 |
| `maxSnapshots` | `20` | 快照数量上限。 |

### performance 开关

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `changeDebounce` | `16` | change 通知防抖毫秒数，`0` 为同步。 |
| `stateUpdateFrame` | `true` | 状态更新按帧合并。 |
| `syntaxHighlight` | `true` | 代码块语法高亮。 |
| `diagramScriptUrl` | `null` | 图表渲染器（mermaid）自托管地址；默认用包内 vendored 产物。 |
