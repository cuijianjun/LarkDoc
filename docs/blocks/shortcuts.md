---
pageClass: feature-guide
---

<script setup>
import FeatureDemo from '../examples/FeatureDemo.vue'
</script>

# 快捷键与帮助

<div class="feature-summary">

## 介绍

从工具栏查看编辑器支持的键盘操作，也可以给帮助菜单配置应用自己的入口。

</div>

## 基础用法 {#demo}

<FeatureDemo name="shortcuts" />

## API

| 参数 | 说明 | 类型 | 可选值 | 默认值 |
| --- | --- | --- | --- | --- |
| `features.shortcuts` | 开启快捷键相关入口 | `boolean` | true / false | true |
| `toolbarKeys` | 指定格式工具栏分组 | `string[]` | 可包含 `shortcuts` | 默认工具栏 |
| `help.enabled` | 开启帮助菜单 | `boolean` | true / false | true |
| `help.onAction` | 处理帮助菜单动作 | `function` | — | — |

键位因操作系统而异，使用演示里的列表核对当前浏览器上的说明。
