/**
 * 特性包：媒体操作、资源回执和大文档快照
 * （UMD：lark-doc-element.umd.min.background.js）。
 *
 * 共同点：由媒体操作、投票菜单或达到大文档阈值时触发。内核对它们全是
 * `await import()`，单文件 UMD 的 `inlineDynamicImports` 却把实现压进了首屏。
 *
 * 注册的名字与 element.js 的 groups.background 一一对应：
 *   media.httpUpload        → core/media/http-upload.js       命名空间（uploadHttpImage）
 *   media.fileUploadTasks   → core/media/file-upload-tasks.js 命名空间（createFileUploadTasks）
 *   session.resourceOutcome → session/resourceOutcome.js      命名空间（resourceOutcome / queryResourceOperation）
 *   versioning.snapshot     → core/versioning/snapshot.js     命名空间（createSnapshot / normalizeSnapshot）
 *
 *   document.snapshot       → 大文档快照、字数和大纲计算，复用内核的 Tiptap / PM 实例
 *   media.fileDownload      → 文件下载与跨域兜底
 *   ui.pollTools            → 投票更多操作菜单
 *
 * 包内会自带 core/media/upload.js、core/media/file-block.js 等实现（内核各自树摇后
 * 只留一小片），这是懒加载换首屏的既定代价：只有真发起上传的人多下一次。
 */
import { registerFeature } from '../core/features/registry'
import * as httpUpload from '../core/media/http-upload'
import * as fileUploadTasks from '../core/media/file-upload-tasks'
import * as resourceOutcome from '../session/resourceOutcome'
import * as versionSnapshot from '../core/versioning/snapshot'
import { bindVideoPopups } from '../core/nodeviews/video-popups'
import { renderImageCrop, downloadViewerImage, prepareAIImageData } from '../core/media/image-output'
import { createDocumentSnapshotReader, createDocumentStatsReader } from '../editor/documentSnapshot'
import { downloadFile } from '../core/nodeviews/file-download'
import { createPollTools } from '../core/nodeviews/poll-tools'

registerFeature('media.httpUpload', () => httpUpload)
registerFeature('media.fileUploadTasks', () => fileUploadTasks)
registerFeature('session.resourceOutcome', () => resourceOutcome)
registerFeature('versioning.snapshot', () => versionSnapshot)
registerFeature('document.snapshot', () => ({ createDocumentSnapshotReader, createDocumentStatsReader }))
registerFeature('media.fileDownload', () => ({ downloadFile }))
registerFeature('ui.pollTools', () => ({ createPollTools }))
registerFeature('media.videoPopups', () => ({ bindVideoPopups }))
registerFeature('media.imageOutput', () => ({ renderImageCrop, downloadViewerImage, prepareAIImageData }))
