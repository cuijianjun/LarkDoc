// 迁自 ECS src/api/cloudDisk/uploadFiles/index.js；注入原 request，保留认证与部署配置归宿主所有。
function createEcsImageApi(request) {
  return {
    uploadImages: data => request({ url: '/system/bulletin-board/upload', method: 'post', headers: { 'Content-Type': 'multipart/form-data' }, data }),
    filePreviews: data => request({ url: `/system/bulletin-board/getFileByte/${encodeURIComponent(data.attchId)}`, method: 'get', responseType: 'blob' }),
  }
}

// 复用 ECS MyEditor 的 file/json/suffix 与 upload→preview 流程，输出 Tiptap Image 属性。
function createEcsImageUpload(api, imageBaseURL) {
  return async file => {
    if (!file || !/^image\/(png|jpeg|gif|webp)$/.test(file.type)) throw new Error('不支持的图片类型')
    if (file.size > 20 * 1024 * 1024) throw new Error('上传图片大小不能超过 20 MB')
    const data = new FormData()
    data.append('file', file)
    data.append('json', JSON.stringify({ suffix: file.name.slice(-4) }))
    const response = await api.uploadImages(data)
    const attachment = response && response.data
    if (!attachment || attachment.attchId == null || String(attachment.attchId) === '' || typeof attachment.url !== 'string') throw new Error('上传返回的附件信息无效')
    let url
    try {
      if (Array.from(attachment.url).some(char => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127)) throw new Error()
      const parsed = new URL(attachment.url, imageBaseURL)
      if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error()
      url = parsed.href
    } catch (_) { throw new Error('上传图片地址无效') }
    await api.filePreviews(attachment)
    return { url, attchId: String(attachment.attchId) }
  }
}

module.exports = { createEcsImageApi, createEcsImageUpload }
