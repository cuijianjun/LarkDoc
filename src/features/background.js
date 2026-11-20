/**
 * 特性包：字节上传通道与转换/版本回执
 * （UMD：lark-doc-element.umd.min.background.js）。
 *
 * 共同点：都由「一次显式动作」触发，没有一条在首屏必跑 —— 粘贴图片 / 拖入文件才要
 * 上传实现，发起远程转换、确认版本才要回执与快照归一。内核对它们全是
 * `await import()`，单文件 UMD 的 `inlineDynamicImports` 却把实现压进了首屏。
 *
 * 注册的名字与 element.js 的 groups.background 一一对应：
 *   media.httpUpload        → core/media/http-upload.js       命名空间（uploadHttpImage）
 *   media.fileUploadTasks   → core/media/file-upload-tasks.js 命名空间（createFileUploadTasks）
 *   session.resourceOutcome → session/resourceOutcome.js      命名空间（resourceOutcome / queryResourceOperation）
 *   versioning.snapshot     → core/versioning/snapshot.js     命名空间（createSnapshot / normalizeSnapshot）
 *
 * 边界（为什么到此为止）：`editor/documentSnapshot.js`（挂载后算大纲与字数）不在本包里。
 * 它经 documentStats → documentOperations 静态拉住 @tiptap/pm/model 全家 —— 实测会把
 * 包体从 26 KB 撑到 176 KB，还多一份 Fragment/Node 类身份。首屏省 9.6 KB 换这个不划算，
 * 判定写进 docs/guide/performance.md。
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

registerFeature('media.httpUpload', () => httpUpload)
registerFeature('media.fileUploadTasks', () => fileUploadTasks)
registerFeature('session.resourceOutcome', () => resourceOutcome)
registerFeature('versioning.snapshot', () => versionSnapshot)
registerFeature('media.videoPopups', () => ({ bindVideoPopups }))
registerFeature('media.imageOutput', () => ({ renderImageCrop, downloadViewerImage, prepareAIImageData }))
