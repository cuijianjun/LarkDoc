---
outline: 2
---

# 配置总览

第一次接入，先到[示例中心](/examples/)选好环境，准备 SDK 和容器。之后按本页配置，复杂功能在需要时再展开查。

## 先用这段配置 {#最常用的一段}

```js
const doc = new LarkDoc({
  element: '#editor',
  title: '未命名文档',
  content: '<p>开始编辑</p>',
  storage: 'none',
  onUpdate: ({ json }) => {
    console.log(json) // 换成应用自己的保存逻辑
  },
})
```

示例由应用保存正文，`storage: 'none'` 会关闭浏览器草稿。需要浏览器记住草稿时使用默认的 `storage: 'local'`；它不会替你把正文保存到业务服务器。
离开页面时调用 `doc.destroy()`。Vue、React 等环境的创建和销毁位置，见对应环境的完整示例。

## 按要做的事查配置

| 你要做什么 | 入口与配置 |
| --- | --- |
| 读取或保存正文 | `onUpdate`、`getJSON()`，见[实例与事件](/guide/instance)。 |
| 上传图片到服务器，再用返回地址插图 | `uploader.action`、`response` 与回调，见[上传器](/blocks/uploader)。 |
| 减少工具栏按钮 | `toolbarKeys` / `toolbarExcludes`，见[工具栏配置](/guide/toolbar)。 |
| 开关 AI、图表等功能 | `features`，展开下方[功能开关](#features-能力开关)。 |
| 设置只读、修订或阅读模式 | `readonly` / `modes`，见[视图模式](/blocks/view-modes)。 |
| 限制导入或导出格式 | `importExport`，见[导入导出](/blocks/import-export)。 |
| 设置右下角问号菜单 | `help` 控制开关、菜单和点击回调，展开下方[帮助菜单](#help)。 |
| 接入协同、权限与评论 | 见[协同与权限](/guide/collaboration)。 |

## 完整参数参考

以下按需展开。配置仍传给 `new LarkDoc({ ... })`；关闭能力会阻止新操作，已有 JSON 内容仍可打开。

<span id="顶层配置"></span>

:::: details 基本参数

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

::::

<span id="features-能力开关"></span>

:::: details 功能开关（features）

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

::::

<span id="几组高频配置"></span>

<span id="autosave-自动保存"></span>

:::: details 自动保存：浏览器草稿

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 默认开。改完正文后 `delay` 毫秒落一次草稿。 |
| `delay` | `650` | 防抖毫秒；`0` = 每次改动立刻存。填负数 / NaN 会回落到 650。 |

两种「关」不一样，别混：

- `autosave.enabled: false` → 停止编辑后的防抖保存；手动保存、离页及销毁时的最后一次草稿保存仍可用；
- `features.persistence: false` 或 `storage: 'none'` → 整套持久化下线，不读草稿也不写。

::::

<span id="importexport-导入-导出"></span>

:::: details 导入与导出

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

::::

<span id="media-媒体在-html-里的写法"></span>

:::: details HTML 中的图片与链接

只影响 **HTML 产物**（`getHTML()`、导出 HTML）；JSON 不动，永远可无损往返。

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `htmlMode` | `'inline'` | `inline` = 直出 `<figure><img>`，正文能直接看到图；`link` = 只留一条媒体地址链接。两种档位都**原样保留** `src` 是 `https://…` 的远程地址，不转存、不转 base64。 |
| `linkText` | `''` | `link` 档的链接文案，支持 `{name}` / `{url}` / `{type}` 占位；留空用地址本身。 |
| `newTab` | `true` | `link` 档是否新窗口打开。 |

```js
// 全局：只留地址，适合贴到邮件 / IM / 工单系统
new LarkDoc({ element: '#editor', media: { htmlMode: 'link', linkText: '{name}' } })

// 单次覆盖，不改实例配置
const html = doc.getHTML({ media: { mode: 'link' } })
```

`link` 档是**单向**的：链接态 HTML 再导回编辑器会变成普通超链接，图片不会复原。要可逆请用 JSON。

::::

<span id="modes-顶栏「编辑-修订-阅读」"></span>

:::: details 编辑、修订与阅读模式

顶栏右上角那个按钮的三种状态。全部字段都可选，不传就是全开：

```js
modes: {
  default: 'edit',                          // 首屏模式 'edit' | 'suggest' | 'read'
  allow: ['edit', 'suggest', 'read'],       // 下拉里保留哪几项
  persist: true,                            // 是否记住用户上次选的
  labels: { read: '预览' },                  // 改某一项的叫法
  shortcuts: true,                          // 要不要 ⌘⌥E / ⌘⌥X / ⌘⌥V
}
```

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `default` | `'edit'` | 初始模式。不在 `allow` 里就自动回落到 `allow[0]`。 |
| `allow` | 三项全留 | 下拉裁剪。只剩一项时按钮变成静态文字（无箭头、点不动）。传空数组或非法值会回落成三项全留 —— 想关切换请写 `allow: ['edit']`。 |
| `persist` | `true` | `false` = 不读写 `localStorage`，每次打开都从 `default` 开始。 |
| `labels` | `{}` | 只认 `edit` / `suggest` / `read` 三个键，值是非空字符串；提示卡片跟着改写（`已切换为预览模式`）。 |
| `shortcuts` | `true` | `false` = 三套键位全部不接管，也不会 `preventDefault`，宿主可以自己用这些组合键。 |

```js
// 只读站：不留修订入口，打开即阅读态，也不记住状态
new LarkDoc({ element: '#viewer', modes: { allow: ['edit', 'read'], default: 'read', persist: false } })
```

::: tip 配置压不过协同权限
会话里没有编辑权限时，`suggest` 会被服务端降级成 `read` —— 配 `allow: ['suggest']` 也强开不出修订态。详见[协同与权限](/guide/collaboration)。
:::

**已知边界**：`shortcuts: false` 只关实际按键，快捷键帮助面板（⌘/）里那三行仍是静态文案，不会跟着消失。

::::

<span id="其余分组"></span>

:::: details 命令、布局与内容上限

限制命令、布局或内容上限时，可按下表配置。`commands`、`blockMenu`、`performance` 放在 `config` 内，其余分组也支持下表所示的顶层写法。

| 分组 | 关键字段 | 用途 |
| --- | --- | --- |
| `config.commands` | `disabled` / `allow` | 按命令 id 禁用或白名单。 |
| `config.blockMenu` | `disabled` / `allow` | 块句柄菜单动作裁剪（`duplicate` / `delete` 等）。 |
| `layout` | `headerVisible` / `titleBarFixed` / `toolbarFixed` | 顶栏显隐与吸附。`headerVisible: false` 时操作入口收进工具栏「⋯」。 |
| `modes` | `default` / `allow` / `persist` / `labels` / `shortcuts` | 顶栏编辑 / 修订 / 阅读三态，见上一节。 |
| `limits` | `titleLength` 120、`maxLength` 0、`maxImageSize` 5MB、`maxTableRows` 9、`maxIndent` 5、`maxSnapshots` 20 | 各项上限（`maxLength: 0` = 不限）。 |
| `config.performance` | `changeDebounce` 16、`syntaxHighlight` true、`diagramScriptUrl` null | 通知防抖、代码高亮、图表脚本地址（默认走包内懒加载，内网不用配）。 |

::::

<span id="help"></span>

:::: details 右下角帮助菜单（help）

```js
new LarkDoc({
  element: '#editor',
  help: {
    enabled: true,
    items: ['help-center', 'shortcuts'],
    onAction: ({ id, label }) => {
      console.log('帮助菜单', id, label) // 在这里接入你自己的帮助页或客服
    },
  },
})
```

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 控制整个右下角问号菜单。`false` 会收起并移除它。 |
| `items` | 下述五项 | 按数组顺序显示已知项，去重并忽略未知 ID；`[]` 隐藏菜单。 |
| `onAction` | `null` | 每次点击通知应用 `{ id, label }`；异常进入实例 `onError` 通道。 |

可选 ID：`upload-log`（上传日志）、`support`（联系客服）、`whats-new`（功能更新）、`help-center`（帮助中心）、`shortcuts`（快捷键）。默认保留原有五项；其中快捷键会打开内置抽屉，其余入口的业务由应用通过 `onAction` 提供。

```js
// 整体关闭
help: { enabled: false }

// 只保留内置快捷键
help: { items: ['shortcuts'] }
```

`help` 只控制右下角菜单。工具栏的快捷键入口仍由 `features.shortcuts` / 工具栏配置控制。
也可把这组设置放入 `config.help`；同时提供时，顶层 `help` 的设置优先。

::::
