/**
 * 图片插入的纯逻辑（P2-03）。
 *
 * 拖拽文件、粘贴剪贴板图片、粘贴图片地址、工具栏选文件——四条入口最后都汇到
 * 编辑器的一处插入循环。这里只放「不碰 DOM、不碰编辑器实例」的判定：MIME 分流、
 * 粘贴文本识别、落点归一。0 DOM，Node 14 下可直接 require。
 */
import { TextSelection } from '@tiptap/pm/state'
import { safeUrl } from '../documentOperations'

/**
 * 允许插入的图片 MIME。
 * 与 schema 里 `image.src` 的 `safeUrl(value, true)` 白名单、以及 NodeView 能
 * 渲染的格式严格一致——多一种都会变成「能进文档但渲染不出来」的坏块。
 */
export const IMAGE_MIME_ALLOWLIST = Object.freeze(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

/** 分流被拒的原因；宿主可据此换文案，不要反向解析 message。 */
export const IMAGE_REJECT = Object.freeze({ MIME: 'IMAGE_MIME', SIZE: 'IMAGE_SIZE' })

// 粘贴图片地址：必须带图片扩展名。`?...` / `#...` 是图床常见签名参数，要放进来，
// 但整串里不许出现空白（多行粘贴进来的富文本不算「一个地址」）。
const IMAGE_URL_RE = /^https?:\/\/\S+\.(?:png|jpe?g|gif|webp)(?:\?\S*)?(?:#\S*)?$/i
// 小图内联（02 §11 ④-bis：飞书对 <3 KB 的图直接给 data URI），格式与 safeUrl 同一口径。
const DATA_IMAGE_RE = /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/i

/** MIME 是否是能插入的图片（大小写不敏感，宿主偶尔给 `IMAGE/PNG`）。 */
export function isImageMime(type) {
  return IMAGE_MIME_ALLOWLIST.includes(String(type || '').toLowerCase())
}

/** 字节数 → 给人看的 “5 MB” / “2.5 MB”。非法值退成 “0 MB”，不抛错。 */
export function formatImageSize(bytes) {
  const mb = Number(bytes) / 1024 / 1024
  if (!Number.isFinite(mb) || mb <= 0) return '0 MB'
  // 整数不留小数位，其余最多一位——避免 “5.0 MB” / “2.5000000001 MB” 这种噪音。
  return `${Number.isInteger(mb) ? mb : Number(mb.toFixed(1))} MB`
}

/** 被拒文案（中文，与工具栏上传报错同源，别在两处各写一遍）。 */
export function imageRejectMessage(code, options = {}) {
  if (code === IMAGE_REJECT.MIME) return '只支持 PNG/JPEG/GIF/WebP 图片'
  if (code === IMAGE_REJECT.SIZE) return `单张图片不能超过 ${formatImageSize(options.maxSize)}`
  return '图片插入失败'
}

/**
 * 把一次「拖入 / 粘贴 / 选择文件」拿到的列表分流成可插入与被拒两组。
 *
 * 顺序必须保持原样：多张图片要按用户看到的顺序落块。
 * `maxSize` 传 null / undefined / 0 表示不限——门面把 limits 交给宿主时用。
 */
export function sortImageFiles(files, options = {}) {
  const maxSize = Number(options.maxSize) > 0 ? Number(options.maxSize) : null
  const accepted = []
  const rejected = []
  for (const file of Array.isArray(files) ? files : []) {
    if (!file) continue
    if (!isImageMime(file.type)) {
      rejected.push({ file, code: IMAGE_REJECT.MIME, message: imageRejectMessage(IMAGE_REJECT.MIME) })
      continue
    }
    if (maxSize !== null && Number(file.size) > maxSize) {
      rejected.push({ file, code: IMAGE_REJECT.SIZE, message: imageRejectMessage(IMAGE_REJECT.SIZE, { maxSize }) })
      continue
    }
    accepted.push(file)
  }
  return { accepted, rejected }
}

/**
 * 从粘贴的纯文本里认出「一个图片地址」，返回可直接进 schema 的 src。
 *
 * 只认两种：http(s) 且扩展名是图片、或 `data:image/...;base64,...`。
 * 返回 null 表示「这不是图片地址」——调用方按普通文本粘贴处理，别吞用户的字。
 */
export function imageUrlFromText(text) {
  if (typeof text !== 'string') return null
  const value = text.trim()
  if (!value || /\s/.test(value)) return null
  if (!DATA_IMAGE_RE.test(value) && !IMAGE_URL_RE.test(value)) return null
  return safeUrl(value, true) ? value : null
}

/**
 * 把「拖拽 / 粘贴给出的落点」归一成能安全 `setTextSelection` 的文本位置。
 *
 * FileHandler 给的 pos 可能落在块边界（拖到两块之间）或超出文档（拖到末尾之外），
 * 直接塞进 `TextSelection.create` 会抛 RangeError。落在块边界时用 `TextSelection.near`
 * 退到最近的文字位置；一条文字位置都找不到（整篇都是原子块）返回 null，调用方按
 * 当前选区插入。
 */
export function nearestInsertPosition(doc, pos) {
  if (!doc || typeof doc.resolve !== 'function') return null
  const size = doc.content.size
  const raw = Number(pos)
  const clamped = Math.max(0, Math.min(Number.isFinite(raw) ? Math.round(raw) : 0, size))
  if (doc.resolve(clamped).parent.inlineContent) return clamped
  const near = TextSelection.near(doc.resolve(clamped), 1)
  return near && near.$from.parent.inlineContent ? near.from : null
}
