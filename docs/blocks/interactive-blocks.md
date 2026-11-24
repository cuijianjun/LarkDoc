---
pageClass: feature-guide
---

<script setup>
import FeatureDemo from '../examples/FeatureDemo.vue'
</script>

# 文档小组件

<div class="feature-summary">

## 介绍

从斜杠菜单添加分割线、目录导航、提及、投票、日期提醒、日程、会议议程和文档按钮。目录导航在正文中显示。人员、群名片、日程等候选可以由应用提供。

</div>

## 基础用法 {#demo}

<FeatureDemo name="interactive-blocks" />

## API

| 参数 | 说明 | 类型 | 可选值 | 默认值 |
| --- | --- | --- | --- | --- |
| `config.commands.allow` | 显示指定斜杠命令 | `string[]` | 例如 `divider`、`catalogue`、`agenda` | 内置命令 |
| `mentionSource` | 提及候选，如人员或云文档 | `array \| object` | 数组或 `{ search }` | — |
| `calendarSource` | 日程候选 | `array \| function \| object` | 数组、函数或 `{ search }` | — |
| `onIsvButtonAction` | 接管文档按钮动作 | `function` | — | — |

实际文档权限由宿主处理。接入外部业务按钮时，用回调绑定应用自己的复制或关注接口。
