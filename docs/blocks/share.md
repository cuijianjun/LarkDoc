---
pageClass: feature-guide
---

<script setup>
import FeatureDemo from '../examples/FeatureDemo.vue'
</script>

# 分享入口

<div class="feature-summary">

## 介绍

分享开关控制正文选区、表格和链接工具条中的分享入口。应用可用回调接入自己的分享面板。

</div>

## 基础用法 {#demo}

<FeatureDemo name="share" />

## API

| 参数 | 说明 | 类型 | 可选值 | 默认值 |
| --- | --- | --- | --- | --- |
| `features.share` | 显示相关分享入口 | `boolean` | true / false | true |
| `onSelectionShare` | 接管选中文字的分享动作 | `function` | — | — |
| `onImageShare` | 接管图片分享动作 | `function` | — | — |

如果分享链接需要授权访问，应用应在服务端校验文档与用户权限，再生成可分享的地址。
