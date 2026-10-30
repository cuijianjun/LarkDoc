# 配置总览

全部配置都写在 `new LarkDoc({ ... })` 的入参里。关掉某个能力只是隐藏入口、阻止新操作，已有 JSON 仍能正常打开。

## 最常用的一段

```js
const doc = new LarkDoc({
  element: '#editor',
  title: '未命名文档',
  content: '<p></p>',
  placeholder: '输入正文，或输入 / 插入内容',
  readonly: false,
  theme: 'light',                     // 'light' | 'dark'

  storage: 'local',                   // 'none' = 完全不落盘
  autosave: { enabled: true, delay: 650 },

  features: { ai: false, folding: true },   // 关掉不需要的能力
  toolbarKeys: ['history', 'headings', 'marks', 'insert'],

  importExport: { importEnabled: true, exportEnabled: true },
  media: { htmlMode: 'inline' },      // HTML 产物里图片内嵌还是只留地址

  onReady: ({ editor }) => {},
  onUpdate: ({ html }) => {},
})
```

## 顶层配置

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `element` | 必填 | 挂载容器，CSS 选择器或 `HTMLElement`。 |
| `content` | `''` | 初始内容，HTML / Tiptap JSON / DocumentRecord 都行。 |
| `title` | `'未命名文档'` | 文档标题。 |
| `placeholder` | `'输入正文，或输入 / 插入内容'` | 空文档提示。 |
| `readonly` | `false` | 只读模式。 |
| `theme` | `'light'` | 主题。 |
| `storage` | `'local'` | 草稿落点：IndexedDB → localStorage → 内存三级降级。`'none'` 则完全不落盘。 |
| `autofocus` | `false` | 挂载后自动聚焦。 |
| `contentFormat` | `'auto'` | 旧数据归一化：`'auto'` / `'vditor'` / `'html'`，见[旧数据导入](/guide/vditor-import)。 |
| `toolbarKeys` / `toolbarExcludes` | - | 工具栏白名单 / 黑名单，见[工具栏配置](/guide/toolbar)。 |
| `features` | 全开 | 能力开关，见下表。 |
| `uploader` | 内置本地读取 | 图片上传钩子，见[上传器](/blocks/uploader)。 |
| `ai` | 内置 Mock | AI 服务接管，见 [AI 组件](/blocks/ai)。 |
| `network` | `{ mode: 'open' }` | 出网策略，见[网络策略](/blocks/network)。 |
| `mode` / `documentId` / `user` / `capabilities` | - | 会话与权限，见[协同与权限](/guide/collaboration)。 |
| `collaboration` / `authorization` / `versioning` / `comments` | - | 五大 Provider 快捷注入。 |
| `onReady` / `onUpdate` / `onSave` / `onError` / `onDestroy` | - | 生命周期回调，见[实例与事件](/guide/instance)。 |

### features 能力开关

`features: { ai: false }` 就关掉 AI 入口。键名全表：

| 键 | 对应能力 | 键 | 对应能力 |
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
| `callouts` | 高亮块 | `diagram` | 图表（mermaid） |
| `columns` | 分栏 | | |

## 三组高频配置

### autosave 自动保存

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 默认开。改完正文后 `delay` 毫秒落一次草稿。 |
| `delay` | `650` | 防抖毫秒；`0` = 每次改动立刻存。填负数 / NaN 会回落到 650。 |

两种「关」不一样，别混：

- `autosave.enabled: false` → 只停自动那一层，手动保存按钮和 `save()` 照旧可用；
- `features.persistence: false` 或 `storage: 'none'` → 整套持久化下线，不读草稿也不写。

### importExport 导入 / 导出

两个入口各自显隐，格式也各自白名单。`features.importExport` 是它们共同的总闸。

```js
importExport: {
  importEnabled: true,                                  // false = 「导入」按钮消失
  exportEnabled: true,                                  // false = 「导出」下拉消失
  importLabel: '导入', exportLabel: '导出',
  importFormats: ['html', 'json', 'md', 'docx'],
  exportFormats: ['html', 'json', 'md', 'txt', 'docx', 'print'],   // 数组顺序 = 菜单顺序
}
```

`importFormats` 同时决定文件选择框的 `accept`；不在白名单里的扩展名会被挡下并提示，不会静默失败。格式 id 对照见[导入导出](/blocks/import-export)。

### media 媒体在 HTML 里的写法

只影响 **HTML 产物**（`getHTML()`、导出 HTML）；JSON 不动，永远可无损往返。

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `htmlMode` | `'inline'` | `inline` = 直出 `<figure><img>`，正文能直接看到图；`link` = 只留一条媒体地址链接。 |
| `linkText` | `''` | `link` 档的链接文案，支持 `{name}` / `{url}` / `{type}` 占位；留空用地址本身。 |
| `newTab` | `true` | `link` 档是否新窗口打开。 |

```js
// 全局：只留地址，适合贴到邮件 / IM / 工单系统
new LarkDoc({ element: '#editor', media: { htmlMode: 'link', linkText: '{name}' } })

// 单次覆盖，不改实例配置
const html = doc.getHTML({ media: { mode: 'link' } })
```

`link` 档是**单向**的：链接态 HTML 再导回编辑器会变成普通超链接，图片不会复原。要可逆请用 JSON。

## 其余分组

不想用扁平项、想直接传内部结构也可以：

| 分组 | 关键字段 | 用途 |
| --- | --- | --- |
| `commands` | `disabled` / `allow` | 按命令 id 禁用或白名单。 |
| `blockMenu` | `disabled` / `allow` | 块句柄菜单动作裁剪（`duplicate` / `delete` 等）。 |
| `layout` | `headerVisible` / `titleBarFixed` / `toolbarFixed` | 顶栏显隐与吸附。`headerVisible: false` 时操作入口收进工具栏「⋯」。 |
| `limits` | `titleLength` 120、`maxLength` 0、`maxImageSize` 5MB、`maxTableRows` 9、`maxIndent` 5、`maxSnapshots` 20 | 各项上限（`maxLength: 0` = 不限）。 |
| `performance` | `changeDebounce` 16、`syntaxHighlight` true、`diagramScriptUrl` null | 通知防抖、代码高亮、图表脚本地址（默认走包内懒加载，内网不用配）。 |
