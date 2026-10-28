/**
 * 文档 Schema 迁移链。
 *
 * 正文版本从 fromVersion 逐级 +1 走到 DOCUMENT_SCHEMA_VERSION，每个跨版本
 * 步骤由 registerDocumentMigration 注册；缺链会直接抛错，避免静默丢数据。
 */
import { DOCUMENT_SCHEMA_VERSION } from './documentSchema'
import { aggregateHeadingContainers } from './documentOperations'

const migrations = new Map()

// v1 → v2：扁平模型聚合为标题容器形态（P1-02 第二步切写入 + P1-04，09 §5.2）。
// 聚合对容器形态幂等，老记录（v1）与新记录（v2）重复迁移均无损。
registerDocumentMigration(1, (content) => aggregateHeadingContainers(content))

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

/**
 * 载入侧统一入口：按记录声明的 schemaVersion 迁移到当前版本。
 * 版本号缺失（旧本地草稿 / 旧导出 JSON）按 v1 处理；声明版本 ≥ 当前版本时直通。
 */
export function migrateRecordContent(content, fromVersion) {
  const version = Number(fromVersion)
  return migrateDocument(content, Number.isInteger(version) && version >= 1 ? version : 1, DOCUMENT_SCHEMA_VERSION)
}
