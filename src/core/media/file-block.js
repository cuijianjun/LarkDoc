/**
 * 文件 / 视频块的纯判定层（P2-04）。
 *
 * 02 §19.5 ③-quater 第 1 条定死了形态：**没有 `video` 块类型**。视频、PDF、
 * 普通附件共用同一个 `file` 块壳，只靠 `mimeType` 分流渲染：
 *   `video/*`         → 播放器
 *   `application/pdf` → PDF viewer（iframe）
 *   其余              → 卡片 + 下载
 * 所以这里没有「视频块」的分支，只有 `fileKindOf()` 一个分流函数。
 *
 * 本文件 0 DOM、0 编辑器实例，Node 14 可直接 require——大小格式化、失败文案、
 * 超限文案都只有这一份，NodeView / 编辑器 / 测试共用。
 * 规格出处：02 §19.5 ③-sexies（超限文案）、③-octies（视频降级文案 + 大小格式）、
 * L3853（损坏态文案）、L4188（限值区间）。
 */

/** 块内三种呈现形态；`CARD` 是兜底（不在上面两类的任何东西）。 */
export const FILE_KIND = Object.freeze({ VIDEO: 'video', PDF: 'pdf', CARD: 'card' })

/** 被拒原因；宿主据此换文案，不要反解 message。 */
export const FILE_REJECT = Object.freeze({ EMPTY: 'FILE_EMPTY', SIZE: 'FILE_SIZE' })

/**
 * 附件上限 10 GB（02 L4188：斜杠 `file` 的文案是「文件大小为 0 MB 或者大于 10 GB」，
 * 上下限同一句）。下限是**开区间 0**：0 字节文件直接拒。
 * >10GB 那一半飞书侧未实测，V1 按文档上限硬拦——超了就报错，不假装能传。
 */
export const DEFAULT_FILE_MAX_SIZE = 10 * 1024 * 1024 * 1024

/** `data-view-type` 的两个合法值（02 L3930–3951）。 */
export const FILE_VIEW_TYPES = Object.freeze(['Preview', 'Card'])

/** MIME → 呈现形态。大小写不敏感，空值兜底为卡片。 */
export function fileKindOf(mimeType) {
  const type = String(mimeType || '').toLowerCase().trim()
  if (type.startsWith('video/')) return FILE_KIND.VIDEO
  if (type === 'application/pdf') return FILE_KIND.PDF
  return FILE_KIND.CARD
}

/** 能内嵌预览的形态（卡片形态不需要预览区挂载点）。 */
export function isPreviewableKind(kind) {
  return kind === FILE_KIND.VIDEO || kind === FILE_KIND.PDF
}

const SIZE_UNITS = ['KB', 'MB', 'GB']

/**
 * 字节数 → footer 上那串「39.08KB」/「45.00MB」。
 *
 * 口径来自 02 实测：`recon-doc.pdf · 39.08KB`（40016 B）、`b382_45.mp4 · 45.00MB`。
 * 因此 KB 起**固定两位小数、无空格**、1024 进制；B 档实测没有样本，取整数不补小数
 * （避免「512.00B」这种浏览器里没人写过的形状）。非法值退成 `0B`，不抛错。
 */
export function formatFileSize(bytes) {
  const size = Number(bytes)
  if (!Number.isFinite(size) || size <= 0) return '0B'
  if (size < 1024) return `${Math.round(size)}B`
  let value = size / 1024
  let unit = 0
  while (value >= 1024 && unit < SIZE_UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(2)}${SIZE_UNITS[unit]}`
}

/** footer 文案：`<文件名> · <大小>`；名字缺失时不留下孤零零的间隔点。 */
export function fileFooterText(name, size) {
  const label = String(name || '').trim()
  const formatted = formatFileSize(size)
  return label ? `${label} · ${formatted}` : formatted
}

/**
 * 预览区兜底文案（02 L3853 与 ③-octies B 段各一条，按形态分开写）。
 *
 * 视频解码失败跟「文件损坏/加密」不是同一件事，飞书也给了两套字：
 * 视频是「不支持的音频/视频格式 请下载文件后用其他软件打开」，其余是
 * 「文件因损坏或加密等原因无法预览，请下载到本地打开」。
 */
export function fileFallbackText(kind) {
  if (kind === FILE_KIND.VIDEO) return '不支持的音频/视频格式 请下载文件后用其他软件打开'
  return '文件因损坏或加密等原因无法预览，请下载到本地打开'
}

/**
 * 超限 / 空文件文案。
 *
 * 02 L4188 原文：「「文件名」上传失败，文件大小为 0 MB 或者大于 10 GB」——
 * 与图片三条不同，**这条带文件名**，且上下限写在同一个句子里。
 */
export function fileRejectMessage(code, options = {}) {
  const maxSize = Number(options.maxSize) > 0 ? Number(options.maxSize) : DEFAULT_FILE_MAX_SIZE
  const name = String(options.name || '').trim()
  const prefix = name ? `「${name}」` : ''
  if (code === FILE_REJECT.EMPTY) return `${prefix}上传失败，文件大小为 0 MB 或者大于 ${formatFileSize(maxSize)}`
  if (code === FILE_REJECT.SIZE) return `${prefix}上传失败，文件大小为 0 MB 或者大于 ${formatFileSize(maxSize)}`
  return '文件上传失败'
}

/**
 * 把一次「选文件 / 拖入」的列表分流成可上传与被拒两组，顺序保持原样。
 *
 * 与 `sortImageFiles` 的关键差异：**不限 MIME**（02 L4168–4188：斜杠 `file` 的
 * `accept` 是 null，任何类型都能进来），只查区间 `(0, maxSize]`。
 * `maxSize` 传 null / undefined / 0 表示不限。
 */
export function sortFileFiles(files, options = {}) {
  const maxSize = Number(options.maxSize) > 0 ? Number(options.maxSize) : null
  const accepted = []
  const rejected = []
  for (const file of Array.isArray(files) ? files : []) {
    if (!file) continue
    const size = Number(file.size)
    if (!Number.isFinite(size) || size <= 0) {
      rejected.push({ file, code: FILE_REJECT.EMPTY, message: fileRejectMessage(FILE_REJECT.EMPTY, { maxSize, name: file.name }) })
      continue
    }
    if (maxSize !== null && size > maxSize) {
      rejected.push({ file, code: FILE_REJECT.SIZE, message: fileRejectMessage(FILE_REJECT.SIZE, { maxSize, name: file.name }) })
      continue
    }
    accepted.push(file)
  }
  return { accepted, rejected }
}

/**
 * 上传结果 + 源文件 → 可直接进 schema 的块属性。
 *
 * `token` 是稳定附件 id（飞书用附件 token 换预览地址）；`src` 是宿主上传返回的
 * 直链，V1 靠它直接渲染 iframe / video，免得每次落块都异步换一次票。
 * 宿主没给 attchId 时退用 url 当 token，保证块永远有一个可引用的稳定键。
 */
export function fileBlockAttrs(file, uploaded = {}) {
  const url = typeof uploaded.url === 'string' && uploaded.url ? uploaded.url : null
  const rawToken = uploaded.attchId ?? uploaded.token ?? url
  const token = rawToken === null || rawToken === undefined ? null : String(rawToken)
  const mimeType = String(uploaded.mimeType || (file && file.type) || '')
  const kind = fileKindOf(mimeType)
  return {
    token,
    src: url,
    name: String(uploaded.name || (file && file.name) || '').trim(),
    size: Number.isFinite(Number(uploaded.size)) ? Number(uploaded.size) : Number(file && file.size) || 0,
    mimeType,
    // 能内嵌预览的形态标 Preview，其余标 Card——卡片态点击才走下载。
    viewType: FILE_VIEW_TYPES.includes(uploaded.viewType)
      ? uploaded.viewType
      : (isPreviewableKind(kind) ? 'Preview' : 'Card'),
    coverUrl: typeof uploaded.coverUrl === 'string' && uploaded.coverUrl ? uploaded.coverUrl : null,
  }
}
