---
pageClass: feature-guide
---

<script setup>
import FeatureDemo from '../examples/FeatureDemo.vue'
</script>

# 保存与恢复

<div class="feature-summary">

## 介绍

把草稿保存在浏览器，或把编辑器接到应用自己的持久化服务。自动保存会在输入停顿后执行，手动保存可直接调用 `doc.save()`。

</div>

## 基础用法 {#demo}

<FeatureDemo name="persistence" />

## API

| 参数 | 说明 | 类型 | 可选值 | 默认值 |
| --- | --- | --- | --- | --- |
| `storage` | 内置浏览器保存模式 | `string` | `local` / `none` | `local` |
| `documentId` | 草稿所属文档 | `string` | — | — |
| `autosave.enabled` | 启用自动保存 | `boolean` | true / false | true |
| `autosave.delay` | 连续输入结束后的等待毫秒数 | `number` | 非负数 | 650 |
| `persistence` | 自定义存取适配器 | `object` | `load`、`save` | — |
| `saveHtml` | 在保存记录中附带 HTML | `boolean` | true / false | false |

后端接入将 `storage` 设为 `none`，并通过 `persistence` 或 `providers.persistence` 提供保存能力。持久化适配器也需要提供 `snapshots`、`snapshot` 和 `restore`。示例用 SDK 的本地适配器实现这三个方法。大文档接入见[优化参考](/guide/large-documents)。
