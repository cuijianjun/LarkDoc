---
pageClass: feature-guide
---

<script setup>
import FeatureDemo from '../examples/FeatureDemo.vue'
</script>

# 数学公式

<div class="feature-summary">

## 介绍

数学公式组件提供行内公式（inlineMath）与块级公式（blockMath）两种节点，语法为 LaTeX，渲染引擎为 KaTeX。KaTeX 样式与字体随包本地发布，离线可用；公式 JSON 契约始终保留，即使渲染失败也不丢内容。

</div>

## 基础用法 {#demo}

<FeatureDemo name="math" />

## API

| 参数 | 说明 | 类型 | 可选值 | 默认值 |
| --- | --- | --- | --- | --- |
| `features.math` | 关闭后公式入口隐藏（公式节点实际挂载时才加载 KaTeX 样式）。 | `boolean` | true / false | `true` |
| `commands.disabled: ['setInlineMath', 'setBlockMath']` | 按命令禁用。 | `string[]` | — | `[]` |

## 配置与用法

### 使用方式

| 入口 | 操作 |
| --- | --- |
| 斜杠命令 / 插入菜单 | 选择「行内公式」或「公式」。 |
| 编辑对话框 | 输入 LaTeX，实时预览，语法错误就地提示（不关闭对话框）。 |
| 双击已有公式 | 重新打开编辑对话框。 |

### 数据契约

| 节点 | HTML | JSON |
| --- | --- | --- |
| 行内公式 | `<span data-type="inline-math" data-latex="…">` | `{ type: 'inlineMath', attrs: { latex } }` |
| 块级公式 | `<div data-type="block-math" data-latex="…">` | `{ type: 'blockMath', attrs: { latex } }` |

- `latex` 属性最长 4096 字符。
- 渲染失败（非法 LaTeX）时显示原文并保留 `data-latex`，可随时修复。

::: tip 离线字体
公式字体从包内 `dist/fonts/` 加载（相对路径），详见[离线与资源本地化](/guide/offline)。
:::
