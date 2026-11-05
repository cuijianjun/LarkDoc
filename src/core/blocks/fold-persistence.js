const LEGACY_FOLD_KEY_SEPARATOR = '\u0001'

export function foldStorageKey(persistKey) {
  return persistKey ? `lark-doc:folds:${persistKey}` : ''
}

export function serializeFoldedIds(folded) {
  return JSON.stringify(Array.from(folded || []))
}

export function normalizeFoldStorageValues(saved) {
  const values = Array.isArray(saved)
    ? saved.filter((value) => typeof value === 'string' && value)
    : []
  return {
    values,
    blockIds: values.filter((value) => !value.includes(LEGACY_FOLD_KEY_SEPARATOR)),
    legacyKeys: values.filter((value) => value.includes(LEGACY_FOLD_KEY_SEPARATOR)),
  }
}

export function readFoldStorage(storage, key) {
  if (!key || !storage) return normalizeFoldStorageValues([])
  try {
    const target = typeof storage === 'function' ? storage() : storage
    return normalizeFoldStorageValues(JSON.parse(target.getItem(key) || '[]'))
  } catch (_) {
    return normalizeFoldStorageValues([])
  }
}

export function writeFoldStorage(storage, key, value) {
  if (!key || !storage) return
  try {
    const target = typeof storage === 'function' ? storage() : storage
    target.setItem(key, value)
  } catch (_) { /* 存储不可用时静默降级为会话内状态 */ }
}
