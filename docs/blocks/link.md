# 链接

## 概述

链接组件提供插入与编辑对话框，支持自定义链接文字、目标为选区或新插入。外链地址不做连通性校验；配合[网络策略](/blocks/network)可在渲染侧拦截外部资源。

## 配置内容

```ts
new LarkDoc({
  element: '#editor',
  features: { textStyle: true },   // 链接入口在 textStyle 分组（别名 link）
  content: '<p><a href="https://example.com" target="_blank" rel="noopener noreferrer">示例链接</a></p>',
})

// 命令式
doc.getEditor().commands.setLink({ href: 'https://example.com' })
```

## 配置说明

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `features.textStyle` | `boolean` | `true` | 关闭后链接入口隐藏。 |
| `commands.disabled: ['setLink', 'unsetLink']` | `string[]` | `[]` | 按命令禁用。 |

### 使用方式

| 入口 | 操作 |
| --- | --- |
| 工具栏 | 链接按钮打开对话框，可填写链接文字。 |
| 气泡菜单 | 选中文字后设为链接。 |
| 编辑 | 点击已有链接打开编辑态，可修改或移除。 |
| 粘贴 | 粘贴带超链接的 HTML 保留 `href` 与 `rel`。 |

### HTML 契约

```html
<a href="…" target="_blank" rel="noopener noreferrer">文字</a>
```

外部链接默认追加 `target="_blank"` 与 `rel="noopener noreferrer"`；仅当链接指向文档内部锚点时不带 `target`。
