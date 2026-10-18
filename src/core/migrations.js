import { DOCUMENT_SCHEMA_VERSION } from './documentSchema'

const migrations = new Map()

/**
 * 注册正文迁移。迁移只处理 Tiptap JSON，不接触用户权限、评论或 Presence 数据。
 */
export function registerDocumentMigration(fromVersion, migrate) {
  const version = Number(fromVersion)
  if (!Number.isInteger(version) || version < 0 || typeof migrate !== 'function') throw new Error('文档迁移参数无效')
  migrations.set(version, migrate)
}

export function migrateDocument(content, fromVersion = DOCUMENT_SCHEMA_VERSION, toVersion = DOCUMENT_SCHEMA_VERSION) {
  let version = Number(fromVersion) || 0
  let next = content
  while (version < toVersion) {
    const migrate = migrations.get(version)
    if (!migrate) throw new Error(`缺少文档 Schema ${version} 到 ${version + 1} 的迁移`)
    next = migrate(next)
    version += 1
  }
  return next
}

/** 返回已注册的起始版本，便于启动检查确认迁移链完整。 */
export function listDocumentMigrations() {
  return [...migrations.keys()].sort((a, b) => a - b)
}
