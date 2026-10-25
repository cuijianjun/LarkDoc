'use strict'

const PREFIX = 'tiptap-vue2:lark-doc:'

function validRecord(record) {
  return record && typeof record.title === 'string' && record.json && record.json.type === 'doc' &&
    Array.isArray(record.json.content) && Number.isFinite(record.updatedAt)
}

// 只管理新单人文档的键，不读取、迁移或清理原 Yjs 草稿。
function createWorkspace(storage, options = {}) {
  const configuredMaxSnapshots = Number(options.maxSnapshots)
  const maxSnapshots = Number.isFinite(configuredMaxSnapshots) ? Math.max(0, configuredMaxSnapshots) : 20
  let sequence = 0

  function read(key, fallback) {
    let value
    try { value = storage.getItem(PREFIX + key) } catch (error) { throw new Error('无法读取本地存储，请导出当前文档') }
    if (!value) return fallback
    try { return JSON.parse(value) } catch (error) { throw new Error('本地文档数据损坏，请导出当前文档后重新保存') }
  }

  function write(key, value) {
    try { storage.setItem(PREFIX + key, JSON.stringify(value)) } catch (error) { throw new Error('本地保存失败，可能已禁用存储或空间不足；请导出当前文档') }
    return value
  }

  function record(value) {
    const result = { title: value.title, json: value.json, updatedAt: Date.now() }
    // schemaVersion 透传：载入侧据此触发迁移链（P1-04）；缺失按 v1 处理。
    if (value.schemaVersion != null) result.schemaVersion = value.schemaVersion
    // 可选：透传 HTML 派生副本（saveHtml 开启时由 Workspace 注入）。
    if (value.html != null) result.html = value.html
    if (!validRecord(result)) throw new Error('文档结构无效，未保存')
    return result
  }

  function snapshots() {
    const list = read('snapshots', [])
    if (!Array.isArray(list) || list.some(item => !validRecord(item) || typeof item.id !== 'string')) {
      throw new Error('本地快照数据损坏，未覆盖现有文档')
    }
    return list.slice(0, maxSnapshots)
  }

  return {
    load() {
      const value = read('draft', null)
      if (value !== null && !validRecord(value)) throw new Error('本地文档数据损坏，未覆盖现有文档')
      return value
    },
    save(value) { return write('draft', record(value)) },
    snapshots,
    snapshot(value) {
      const entry = { ...record(value), id: `${Date.now()}-${sequence++}` }
      write('snapshots', [entry, ...snapshots()].slice(0, maxSnapshots))
      return entry
    },
    restore(id) {
      const entry = snapshots().find(item => item.id === id)
      if (!entry) throw new Error('该快照不存在')
      return entry
    },
  }
}

module.exports = { createWorkspace }
