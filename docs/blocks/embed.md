---
pageClass: feature-guide
---

<script setup>
import FeatureDemo from '../examples/FeatureDemo.vue'
</script>

# 内嵌网页与卡片

<div class="feature-summary">

## 介绍

从斜杠菜单插入网页或支持的内嵌卡片，也可以粘贴链接。服务是否允许放入 iframe 取决于目标站点和宿主配置。

</div>

## 基础用法 {#demo}

<FeatureDemo name="embed" />

## API

| 参数 | 说明 | 类型 | 可选值 | 默认值 |
| --- | --- | --- | --- | --- |
| `features.embed` | 显示内嵌网页入口 | `boolean` | true / false | true |
| `embedProviders` | 内嵌 Provider 白名单 | `string[]` | Provider ID | 识别全部内置项 |
| `embedSandbox` | 宿主项目允许的 iframe 沙箱能力 | `string` | — | SDK 默认策略 |
| `unfurlProvider` | 宿主提供链接标题、摘要等卡片元数据 | `function` | — | — |

以业务允许的域名和 Provider 范围开放内嵌。目标站点不允许嵌入时，保留普通链接供访问。
