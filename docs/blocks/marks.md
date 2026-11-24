---
pageClass: feature-guide
---

<script setup>
import FeatureDemo from '../examples/FeatureDemo.vue'
</script>

# 文字格式

<div class="feature-summary">

## 介绍

行内格式组件包含 8 种 mark：加粗、斜体、下划线、删除线、行内代码、下标、上标、高亮。支持整组开关，也可通过 `toolbarKeys` 精确到单个 mark。

</div>

## 基础用法 {#demo}

<FeatureDemo name="marks" />

## API

| 参数 | 说明 | 类型 | 可选值 | 默认值 |
| --- | --- | --- | --- | --- |
| `features.marks` | 关闭后整组不可用。 | `boolean` | true / false | `true` |
| `toolbar.marksAllow` | 内部分组直传：`null` 展示全部 mark，数组为白名单（由 `toolbarKeys` 翻译生成）。 | `string[] \| null` | — | `null` |

## 配置与用法

| mark key | 效果 | HTML | 快捷键 |
| --- | --- | --- | --- |
| `bold` | 加粗 | `<strong>` | `Mod+B` |
| `italic` | 斜体 | `<em>` | `Mod+I` |
| `underline` | 下划线 | `<u>` | `Mod+U` |
| `strike` | 删除线 | `<s>` | `Mod+Shift+X` |
| `code` | 行内代码 | `<code>` | `Mod+E` |
| `subscript` | 下标 | `<sub>` | `Mod+,` |
| `superscript` | 上标 | `<sup>` | `Mod+.` |
| `highlight` | 高亮 | `<mark>` | - |

::: tip 入口
选中文字会弹出气泡菜单，包含常用 mark 与颜色入口；高亮颜色支持调色板与最近使用记录，见[文字样式](/blocks/text-style)。
:::
