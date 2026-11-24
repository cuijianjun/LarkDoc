---
pageClass: feature-guide
---

<script setup>
import FeatureDemo from '../examples/FeatureDemo.vue'
</script>

# 视频

<div class="feature-summary">

## 介绍

播放已有视频、上传所选的视频，或通过文件 token 获取可访问的播放地址。视频使用文件节点 `fileBlock`，播放器支持进度、倍速、音量和全屏。

</div>

## 基础用法 {#demo}

<FeatureDemo name="video" />

## API

| 参数 | 说明 | 类型 | 可选值 | 默认值 |
| --- | --- | --- | --- | --- |
| `features.files` | 启用视频和文件入口 | `boolean` | true / false | true |
| `fileBlock.attrs.src` | 可播放的视频地址 | `string` | 浏览器支持的媒体 URL | — |
| `fileBlock.attrs.mimeType` | 识别视频类型 | `string` | 例如 `video/mp4` | — |
| `fileBlock.attrs.viewType` | 文件展示方式 | `string` | `Preview` / `Card` / `Inline` | `Card` |
| `uploadFile` | 选择或拖入文件后的上传函数 | `(file, context) => UploadFileResult` | 可同步或异步返回 | — |
| `resolveFileUrl` | 把 token 换为当前用户可访问的 URL | `(token, node) => string \| Promise<string>` | — | — |

服务器返回 `{ url, mimeType, name }`，或者返回 `{ token, mimeType, name }` 并配置 `resolveFileUrl`。要长期使用，请保存稳定资源标识，在读取时重新鉴权。文件类型和大小限制见[文件与附件](/blocks/file)。
