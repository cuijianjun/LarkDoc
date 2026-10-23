# 高亮块

## 概述

高亮块（Callout）是带底色与图标的提示容器，适合注意事项、要点强调。图标复用表情选择器（分类 + 搜索 + 最近使用），块内可承载任意块级内容。

## 配置内容

```ts
new LarkDoc({
  element: '#editor',
  features: { callouts: true },
  content: '<div data-type="callout" data-emoji="warning"><p>注意：发布前检查清单。</p></div>',
})
```

## 配置说明

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `features.callouts` | `boolean` | `true` | 关闭后插入菜单中高亮块入口隐藏。 |
| `commands.disabled: ['setCallout']` | `string[]` | `[]` | 按命令禁用。 |

### 使用方式

| 入口 | 操作 |
| --- | --- |
| 斜杠命令 / 插入菜单 | 插入高亮块。 |
| 图标按钮 | 点击高亮块左上角图标更换（复用表情选择器）。 |
| 工具条 | 选中高亮块时显示配色与删除工具。 |

### 数据契约

```html
<div data-type="callout" data-emoji="check"><p>…</p></div>
```

- JSON：`{ type: 'callout', attrs: { emoji: 'check' }, content: […] }`。
- 与表情组件共用 emoji 表，见[表情](/blocks/emoji)的内置表情表。
