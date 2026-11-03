# 表情

表情组件提供分类标签、搜索过滤与最近使用记录，插入的是内联 atom 节点（`span[data-type="emoji"]`）。内置 11 个基础表情，按「常用 / 提示」等分类组织；数据为内置字符表，离线可用。

## 配置示例

```ts
new LarkDoc({
  element: '#editor',
  features: { emoji: true },
  toolbarKeys: ['insert'],       // 表情入口在插入分组（别名 emoji）
  content: '<p><span data-type="emoji" data-name="tada"></span> 发布成功</p>',
})
```

## 配置与用法

### 内置表情表

| name | 字形 | name | 字形 | name | 字形 |
| --- | --- | --- | --- | --- | --- |
| `smile` | 😄 | `heart` | ❤️ | `thumbsup` | 👍 |
| `tada` | 🎉 | `pin` | 📌 | `warning` | ⚠️ |
| `check` | ✅ | `comment` | 💬 | `target` | 🎯 |
| `fire` | 🔥 | `star` | 🌟 | | |

分类：常用（smile / heart / thumbsup / tada）、提示（pin / warning / check / comment / target / fire / star）。

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `features.emoji` | `boolean` | `true` | 关闭后插入菜单中的表情入口隐藏。 |
| `commands.disabled: ['setEmoji']` | `string[]` | `[]` | 按命令禁用表情插入。 |

### 使用方式

| 入口 | 操作 |
| --- | --- |
| 插入菜单 / 斜杠命令 | 打开表情选择器，支持按分类浏览、按名称搜索。 |
| 最近使用 | 选择器顶部记录最近使用的表情。 |
| 高亮块 | 高亮块图标复用同一套表情选择器。 |

### 数据契约

```html
<span data-type="emoji" data-name="smile">😄</span>
```

- JSON：`{ type: 'emoji', attrs: { name: 'smile' } }`。
- 未知 `name` 渲染为 `:name:` 文本形式，导入旧 HTML 不会丢内容。
