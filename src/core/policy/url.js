/** Shared synchronous URL validation without editor/runtime dependencies. */
export function safeUrl(value, image = false) {
  if (typeof value !== 'string' || !value || Array.from(value).some((char) => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127)) return false
  if (image && /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/i.test(value)) return true
  // 图片的相对路径（/、./、../ 开头）是本地资源引用，与 networkPolicy.isLocalUrl 语义一致。
  // 它们不含 javascript:/data: 等危险协议，可直接进 schema（老系统图床 /note/... 即此类）。
  // 注意排除协议相对 URL（//host/... 会被浏览器解析为 http(s)://host/...，属外链而非本地资源）。
  if (image && /^(?:#|\.{1,2}\/|(?:\/(?!\/)))/.test(value)) return true
  if (/^https?:\/\//i.test(value)) {
    try { const url = new URL(value); return !!url.hostname && !url.username && !url.password } catch (_) { return false }
  }
  return !image && (/^(mailto|tel):[^:<>]+$/i.test(value) || /^#[\w\u0080-\uffff-]+$/.test(value))
}
