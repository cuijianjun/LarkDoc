---
pageClass: feature-guide
---

<script setup>
import FeatureDemo from '../examples/FeatureDemo.vue'
</script>

# 文件与附件

<div class="feature-summary">

## 介绍

通过「视频或文件」选择附件，也可以拖拽文件。普通附件主要显示为文件卡片，视频或 PDF 可按浏览器能力使用预览形式。

</div>

## 基础用法 {#demo}

<FeatureDemo name="file" />

## API

| 参数 | 说明 | 类型 | 可选值 | 默认值 |
| --- | --- | --- | --- | --- |
| `features.files` | 开启文件入口 | `boolean` | true / false | true |
| `limits.maxFileSize` | 单个文件上限，单位字节，文件不能为空 | `number` | 正整数 | 10 GiB |
| `uploadFile` | 附件上传通道 | `function \| object` | 函数或 `{ upload }` | — |
| `resolveFileUrl` | 按 token 获取可预览或下载的地址 | `function` | — | — |
| `fileBlock.attrs.viewType` | 文件展示方式 | `string` | `Card` / `Preview` / `Inline` | `Card` |

返回至少一个 `url` 或 `token`，建议带上 `name`、`size`、`mimeType`。文件与[图片上传](/blocks/uploader)是独立通道。服务器需要校验权限、MIME 类型和文件大小。
