---
pageClass: feature-guide
---

<script setup>
import FeatureDemo from '../examples/FeatureDemo.vue'
</script>

# 文字样式

<div class="feature-summary">

## 介绍

文字样式组件提供颜色（文字色与高亮色）调色板，带最近使用记录。颜色应用于选区或当前块，工具栏归属 `textStyle` 分组。

</div>

<div class="feature-summary">

## 引入

在已有的 Vue 3 项目中安装示例版本，将基础用法里的完整组件代码复制到 `App.vue`。

```bash
npm install lark-doc@0.14.10
```

```js
import { LarkDoc } from 'lark-doc'
import 'lark-doc/style.css'
```

</div>

## 基础用法 {#demo}

<FeatureDemo name="text-style" />

## API

| 参数 | 说明 | 类型 | 可选值 | 默认值 |
| --- | --- | --- | --- | --- |
| `features.textStyle` | 关闭后颜色入口隐藏。 | `boolean` | true / false | `true` |
| `toolbarKeys` 含 `textStyle` | 工具栏裁剪。 | `string[]` | — | 展示 |
| `commands.disabled: ['setTextColor', 'setHighlight']` | 按命令粒度禁用。 | `string[]` | — | `[]` |

## 配置示例

```ts
new LarkDoc({
  element: '#editor',
  features: { textStyle: true },
  toolbarKeys: ['textStyle'],   // 别名 link / color / font / fontSize 均落到此分组
  content: '<p><span style="color:#00b887">品牌绿文字</span></p>',
})
```

## 配置与用法

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
