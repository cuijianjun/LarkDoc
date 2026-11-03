# 目录

目录组件根据正文标题层级实时生成大纲，支持跳转定位、当前章节高亮、章节收起。面板默认在宽屏（>760px）自动展开，可整体收起为图标。

## 配置示例

```ts
new LarkDoc({
  element: '#editor',
  features: { outline: true },
  toolbarKeys: ['outline'],       // 目录面板开关（别名 toc）
  content: '<h1>章节一</h1><h2>小节</h2><h1>章节二</h1>',
})
```

## 配置与用法

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `features.outline` | `boolean` | `true` | 关闭后目录面板与工具栏入口隐藏。 |
| `features.headings` | `boolean` | `true` | 目录依赖标题；标题能力关闭时目录为空。 |
| `commands.disabled: ['toggleOutline']` | `string[]` | `[]` | 禁用面板开关命令。 |

### 使用方式

| 入口 | 操作 |
| --- | --- |
| 工具栏 | 打开 / 关闭目录面板。 |
| 目录项 | 点击跳转到对应标题。 |
| 章节箭头 | 收起 / 展开该章节的子级（独立于[折叠块](/blocks/folding)的正文折叠）。 |
| 当前位置 | 滚动时高亮光标所在章节（`activeHeading`）。 |

### 状态说明

| 状态 | 作用域 | 说明 |
| --- | --- | --- |
| `outlineOpen` | 目录面板 | 面板整体开关，宽屏默认开。 |
| `outlineCollapsed` | 目录面板 | 面板内章节的收起态。 |
| `folded` | 正文 | 正文折叠态，与目录收起互不影响。 |
