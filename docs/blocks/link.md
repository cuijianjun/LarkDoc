# 链接

链接组件提供插入与编辑对话框，支持自定义链接文字、目标为选区或新插入。外链地址不做连通性校验；配合[网络策略](/blocks/network)可在渲染侧拦截外部资源。

## 配置示例

```ts
new LarkDoc({
  element: '#editor',
  features: { textStyle: true },   // 链接入口在 textStyle 分组（别名 link）
  content: '<p><a href="https://example.com" target="_blank" rel="noopener noreferrer">示例链接</a></p>',
})

// 命令式
doc.getEditor().commands.setLink({ href: 'https://example.com' })
```

## 配置与用法

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `features.textStyle` | `boolean` | `true` | 关闭后链接入口隐藏。 |
| `commands.disabled: ['setLink', 'unsetLink']` | `string[]` | `[]` | 按命令禁用。 |

### 使用方式

| 入口 | 操作 |
| --- | --- |
| 工具栏 | 链接按钮打开对话框，可填写链接文字。 |
| 气泡菜单 | 选中文字后设为链接。 |
| 插入 | 光标处按 Cmd/Ctrl+K，或从插入菜单选择链接；选区已有格式和段落保持原样。 |
| 编辑 | 悬浮链接后点击铅笔，在文字与地址双字段浮层中确认修改；移除按钮仅解除链接。 |
| 视图 | 在行内 URL、网站标题、网页卡片和可用的预览之间切换。标题取网站元数据，缺失时显示域名。 |
| 打开 | 单击行内链接或整张卡片打开新页；预览工具条提供“打开原网页”，内容区可滚动和操作。 |
| 复制 | 更多菜单提供富文本链接与原始网页 URL 两种复制。 |
| 粘贴 | 粘贴带超链接的 HTML 保留 `href` 与 `rel`。 |

### HTML 契约

```html
<a href="…" target="_blank" rel="noopener noreferrer">文字</a>
```

链接在新标签页打开，并使用 `noopener noreferrer`。空文本保存时显示 URL，裸域名补 `http://`。URL 视图通过 `data-link-view="link"` 标识；卡片使用既有 bookmark 节点，可选 `unfurlProvider(url)` 返回 `{ title, desc, favicon, cover, preview }`。`preview` 是可选布尔能力标记，用于决定外站是否显示预览入口，不能仅用“允许出网”代替可内嵌能力。同源网址与已有预览节点保留对应入口。封面通过 `data-cover` 持久化；单页应用元数据应取自渲染后的网页。抓取失败与超时不会永久缓存，后续操作可重新获取。

预览复用网页块加载界面，初始高度按宽度比例计算；悬浮显示八个缩放手柄，横向居中缩放、纵向独立调整。尺寸通过 `width`/`height` 及 HTML `data-width`/`data-height` 保存，并支持撤销。预览专用条提供刷新、打开原网页、视图切换与复制；卡片使用精简视图/复制条。所有资源遵守宿主网络策略，控件沿用项目主题 token。

Markdown/DOCX 按现有导出契约跳过卡片与预览块。

### 分享选区

表格选区、链接卡片和链接预览的分享入口复用“分享给”弹窗。表格缩略图保留整表及选中单元格，网页预览只显示静态“不支持预览”卡片，不加载网页。缺少分享服务时仍可查看和取消，发送按钮禁用。

标准门面及两个 Vue2 组件支持可选 `onSelectionShare(payload)`。它与 `onImageShare` 分开，参数为 `{ selection: { type, blockId, text, content }, url, recipients, message, signal }`：`type` 是 `node`、`text` 或 `cell`，`content` 是真实 ProseMirror Selection 的 Slice JSON 快照；`blockId` 定位主块（单元格选区使用表格标识），`url` 使用文档的 `#share-blockId` 定位。`recipients` 为已选择的用户/会话记录，`signal` 在取消或目标失效时中止。

宿主负责实际发送与服务端授权；回调返回 `false` 或抛错时保留接收人及留言，允许重试。阅读模式可分享已有内容，摘录要求现有 `canView`、`canExport` 权限。目标内容变化、删除替换、文档/会话/服务切换会取消旧请求，前方无关编辑可通过 bookmark 映射保持目标。预览移除活动控件、导航和外部样式资源，图片遵守当前网络策略。本机 Provider 验证只证明接口接线，不代表已向飞书云端发送消息。
