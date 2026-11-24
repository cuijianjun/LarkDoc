---
pageClass: feature-guide
---

<script setup>
import FeatureDemo from '../examples/FeatureDemo.vue'
</script>

# 分栏

<div class="feature-summary">

## 介绍

分栏组件把一段内容切分为多列排版，适合对比展示、图文并排。列间支持拖拽分隔线调整宽度，列内可放任意块级内容。

</div>

## 基础用法 {#demo}

<FeatureDemo name="columns" />

## API

| 参数 | 说明 | 类型 | 可选值 | 默认值 |
| --- | --- | --- | --- | --- |
| `features.columns` | 关闭后分栏入口隐藏，已有分栏仍按原结构渲染。 | `boolean` | true / false | `true` |
| `commands.disabled: ['setColumn']` | 按命令禁用。 | `string[]` | — | `[]` |

## 配置与用法

### 使用方式

| 入口 | 操作 |
| --- | --- |
| 斜杠命令 / 插入菜单 | 插入分栏容器。 |
| 列间分隔线 | 拖拽调整列宽比例。 |
| 列工具条 | 增删列、左右移动列。 |

### 注意

- 分栏内的折叠、目录定位等行为与正文一致。
- 导出 Markdown 时分栏退化为顺序块（Markdown 无分栏语法）。
