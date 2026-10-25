/**
 * 文档核心的版本化外壳。
 *
 * Tiptap JSON 是正文格式；外壳保存文档身份和版本信息，避免把服务端
 * revision、评论线程或在线状态混入编辑器正文。后续协同 Provider 可以把
 * 同一份 JSON 投影到 Y.Doc，而本地 Provider 仍可直接保存它。
 */
/**
 * v2（P1-02/P1-04）：标题改容器——heading 可选携带 children（02 §2 heading-children
 * 语义）；写入侧（getJSON / 文档记录 / JSON 导出）输出容器形态，读取侧经
 * flattenHeadingContainers 兼容两种形态。v1 为扁平模型（0.11 历史格式）。
 */
export const DOCUMENT_SCHEMA_VERSION = 2

/** 创建可保存的文档信封；content 始终是 Tiptap doc 节点。 */
export function createDocumentRecord(options = {}) {
  return {
    documentId: options.documentId == null ? null : String(options.documentId),
    schemaVersion: Number(options.schemaVersion) || DOCUMENT_SCHEMA_VERSION,
    revisionId: options.revisionId == null ? null : String(options.revisionId),
    content: options.content || { type: 'doc', content: [{ type: 'paragraph' }] },
    title: typeof options.title === 'string' ? options.title : '',
    updatedAt: Number(options.updatedAt) || Date.now(),
  }
}

/**
 * 兼容当前工作区的 `{ title, json }` 记录和新的版本化记录。
 * 读取时只取正文，写入版本 Provider 时再使用完整外壳。
 */
export function normalizeDocumentRecord(value, options = {}) {
  if (!value || typeof value !== 'object') throw new Error('文档记录必须是对象')
  const content = value.content || value.json || value.document
  if (!content || content.type !== 'doc') throw new Error('文档记录缺少有效正文')
  return createDocumentRecord({
    documentId: options.documentId || value.documentId,
    schemaVersion: value.schemaVersion,
    revisionId: value.revisionId,
    content,
    title: value.title,
    updatedAt: value.updatedAt,
  })
}

/** 从兼容记录中提取正文，供编辑器和迁移函数使用。 */
export function getDocumentContent(value, options = {}) {
  return normalizeDocumentRecord(value, options).content
}

/**
 * 节点 ID 是评论和 AI 锚点的长期身份。旧 Schema 没有 id 属性时返回 null，
 * 由后续 Schema 迁移为支持 id 的节点后再启用，不向当前节点强行注入未知属性。
 */
export function getNodeId(node) {
  const id = node && node.attrs && node.attrs.id
  return typeof id === 'string' && id ? id : null
}
