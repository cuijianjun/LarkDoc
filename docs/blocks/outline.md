---
pageClass: feature-guide
---

<script setup>
import FeatureDemo from '../examples/FeatureDemo.vue'
</script>

# 目录

<div class="feature-summary">

## 介绍

目录组件根据正文标题层级实时生成大纲，支持跳转定位、当前章节高亮、章节收起。面板默认在宽屏（>760px）自动展开，可整体收起为图标。

</div>

## 基础用法 {#demo}

<FeatureDemo name="outline" />

## API

| 参数 | 说明 | 类型 | 可选值 | 默认值 |
| --- | --- | --- | --- | --- |
| `features.outline` | 关闭后目录面板与工具栏入口隐藏。 | `boolean` | true / false | `true` |
| `features.headings` | 目录依赖标题；标题能力关闭时目录为空。 | `boolean` | true / false | `true` |
| `commands.disabled: ['toggleOutline']` | 禁用面板开关命令。 | `string[]` | — | `[]` |

## 配置与用法

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
