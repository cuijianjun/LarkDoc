# 文字样式

## 概述

文字样式组件提供颜色（文字色与高亮色）调色板，带最近使用记录。颜色应用于选区或当前块，工具栏归属 `textStyle` 分组。

## 配置内容

```ts
new LarkDoc({
  element: '#editor',
  features: { textStyle: true },
  toolbarKeys: ['textStyle'],   // 别名 link / color / font / fontSize 均落到此分组
  content: '<p><span style="color:#00b887">品牌绿文字</span></p>',
})
```

## 配置说明

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `features.textStyle` | `boolean` | `true` | 关闭后颜色入口隐藏。 |
| `toolbarKeys` 含 `textStyle` | `string[]` | 展示 | 工具栏裁剪。 |
| `commands.disabled: ['setTextColor', 'setHighlight']` | `string[]` | `[]` | 按命令粒度禁用。 |

### 使用方式

| 入口 | 操作 |
| --- | --- |
| 工具栏 | 文字颜色 / 高亮颜色按钮打开调色板。 |
| 气泡菜单 | 选中文字后直接选色。 |
| 块句柄菜单 | 「文字颜色」作用于整块。 |

### 内置调色板

墨绿、薄荷绿、青绿、天空蓝、靛蓝、暖黄、橙色、珊瑚红、淡紫等预设色；调色板记录最近使用颜色，跨会话保存在编辑器存储中。

::: tip HTML 契约
颜色以 `style="color:…"` / `<mark style="background-color:…">` 内联样式保存，导出 HTML 后样式保留。
:::
