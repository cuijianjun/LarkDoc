/**
 * 上传 Provider 出口（P2-02）。
 *
 * 宿主可传三种形态，门面都会归一成同一个 `(file, ctx?) => Promise<result>`：
 *   1. `uploader: { upload, limits?, retry?, chunked?, chunkSize? }` —— 推荐，
 *      四条路径（超限 / 重试 / 取消 / 断点）按需打开；
 *   2. `uploader: fn`（或 `uploadImage: fn`）—— 兼容老写法，等价于只返回 url
 *      的裸函数；
 *   3. 本文件导出的 `createUploadProvider(opt)` 自建实例，自己持有 cancel / pending。
 *
 * 契约见 05 §5.7：`upload(file, ctx) → { url, width?, height?, size, mime, name? }`。
 * 实现与四条路径的判定规则在 `src/core/media/upload.js`（纯逻辑、无 DOM，可单测）。
 */
export {
  createUploadProvider,
  validateUploadFile,
  normalizeUploadResult,
  isRetryable,
  isAbortError,
  fileSignature,
  uploadError,
  UPLOAD_ERROR,
  UPLOAD_MIME_ALLOWLIST,
  DEFAULT_UPLOAD_LIMITS,
  DEFAULT_RETRY,
  DEFAULT_CHUNK_SIZE,
} from '../core/media/upload'
