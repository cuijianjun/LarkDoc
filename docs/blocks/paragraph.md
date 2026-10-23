# 段落样式

## 概述

段落样式组件控制块级排版：对齐（左 / 居中 / 右 / 两端）、缩进（层级由前一个块决定，最深 5 级）、行高与清除格式。气泡菜单与块句柄菜单同步提供入口。

## 配置内容

```ts
new LarkDoc({
  element: '#editor',
  features: { blockStyle: true },
  toolbarKeys: ['blockStyle'],  // 别名 align / indent / lineHeight / clear 均落到此分组
  limits: { maxIndent: 5 },     // 缩进层级硬上限（飞书是 6 层 = 5 级缩进）
  content: '<p style="text-align:center">居中段落</p>',
})
```

## 配置说明

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `features.blockStyle` | `boolean` | `true` | 关闭后整组入口隐藏。 |
| `limits.maxIndent` | `number` | `5` | 缩进层级硬上限，只能往下调（传 99 也是 5）。 |
| `blockMenu.disabled` | `string[]` | `[]` | 可禁用块菜单中的对齐 / 缩进动作。 |

### 缩进上限

缩进**不是绝对的层级上限**，而是由**前一个块**决定——飞书的块缩进本质是「成为上一个块的子块」：

| 情形 | 能缩到几级 |
| --- | --- |
| 文档 / 父容器的**第一个块** | 0（缩不动，菜单项置灰，提示「当前内容块已达最大缩进层级」） |
| 前一个块 0 级 | 1 |
| 前一个块 2 级 | 3 |
| 前一个块已经 5 级 | 5（硬上限，不再变深） |

减少缩进**不受这个限制**：只受 0 下限约束，可以一路减回文档开头。列表项内部的代码块同理——它的前兄弟是 item 的首段落（0 级），所以最多只能再缩 1 级。

### 对齐

| 取值 | HTML | 说明 |
| --- | --- | --- |
| `left` | `text-align:left` | 默认 |
| `center` | `text-align:center` | 居中 |
| `right` | `text-align:right` | 右对齐 |
| `justify` | `text-align:justify` | 两端对齐 |

### 使用方式

| 入口 | 操作 |
| --- | --- |
| 工具栏 | 对齐四态、增减缩进、行高。 |
| 气泡菜单 | 选中多段后批量设置对齐。 |
| 块句柄菜单 | 单块对齐、缩进与清除格式。 |
| 快捷键 | `Tab` / `Shift+Tab` 增减缩进（列表内为层级）。 |
