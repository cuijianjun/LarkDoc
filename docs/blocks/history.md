---
pageClass: feature-guide
---

<script setup>
import FeatureDemo from '../examples/FeatureDemo.vue'
</script>

# 撤销与版本历史

<div class="feature-summary">

## 介绍

撤销与重做用于当前编辑。版本历史用于有权限的应用查看存档，默认关闭，需要显式开启并提供版本 Provider。

</div>

## 基础用法 {#demo}

<FeatureDemo name="history" />

## API

| 参数 | 说明 | 类型 | 可选值 | 默认值 |
| --- | --- | --- | --- | --- |
| `features.history` | 启用编辑撤销和重做 | `boolean` | true / false | true |
| `features.versionHistory` | 显示历史版本入口 | `boolean` | true / false | false |
| `versioning` | 版本操作 Provider | `VersioningProvider` | 例如内存 Provider 或服务器实现 | — |
| `limits.maxSnapshots` | 本地快照保留上限 | `number` | 正整数 | 20 |

应用可以使用 `lark-doc/versioning` 的内存 Provider 试用。跨会话版本需要持久化服务和权限控制。
