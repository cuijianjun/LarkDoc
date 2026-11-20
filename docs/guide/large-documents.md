---
pageClass: feature-guide
---

<script setup>
import FeatureDemo from '../examples/FeatureDemo.vue'
</script>

# 大文件导出与渲染优化

长文档建议用 JSON 分批载入。编辑时让视口只挂载可见正文，保存、导出和打印仍使用完整文档。

## 分批导入与可见区渲染 {#demo}

<FeatureDemo name="large-documents" />

- 调用 `doc.setContentAsync(content, { format: 'json', pagedView: true, signal })`。用 `AbortController` 在切换文档或离开页面时中止导入。
- 分页维护逻辑正文、块位置和可视窗口。超过 4,096 块的分批导入也会尝试分页；选区或定位跨出视口时，编辑器会加载相关内容。
- 高频变更可设置 `config: { performance: { changeDebounce: 150 } }`。初始值为 16 ms，实测互动延迟后再为应用调节。
- 应用应在保存时读取全文，避免在每次击键里重复调用同步的 `getJSON()` 或 `getHTML()`。编辑器内部按块缓存快照并分批处理，条件允许时由 Worker 协助处理 JSON。

## 大文件怎么导出

| 目标 | 做法 |
| --- | --- |
| 业务数据、迁移或后台处理 | 保存完整 `getJSON()`，由应用服务异步转成目标格式。 |
| 浏览器导出或打印 | 使用编辑器内置导出入口，或在用户点击后读取完整 `getHTML()`。检查离屏内容和媒体都在产物内。 |
| 减小 HTML 文件 | 对已有可访问的媒体地址使用 `doc.getHTML({ media: { mode: 'link' } })` 输出链接。图片或视频 URL 需要在查看产物时仍可访问。 |
| 导出已保存的版本 | 配置支持远程转换的版本 Provider，由宿主保存不可变版本、查询转换状态并下载结果。 |

浏览器 DOCX 首次使用会加载 Office 依赖；按需构建时保留相关异步文件。大量图片宜由服务端提供稳定地址，避免在前端导出时将每张图都重复转为 Base64。打印、Markdown 和 DOCX 的可用格式见[导入导出](/blocks/import-export)。

## 怎么验证

1. 使用与实际文档相近的段落数、表格数、图片大小，记录首屏可编辑时间、滚动是否卡顿和导出时间。
2. 对长文查找最后一段，保存后重开，确认正文完整。打开导出文件，检查首尾段落、表格、媒体和权限。
3. 测试取消导入、导出失败和重新发起。远程转换优先查询既有操作，以免重复创建导出任务。
