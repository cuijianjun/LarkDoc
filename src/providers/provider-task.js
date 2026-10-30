const STATUSES = Object.freeze(['queued', 'running', 'partial', 'succeeded', 'failed', 'rolled_back'])
const tasks = new Map()

function taskIdFor(key) {
  return `task_${String(key || Date.now()).replace(/[^A-Za-z0-9_-]/g, '_')}`
}

export function normalizeProviderTask(input = {}) {
  const status = STATUSES.includes(input.status) ? input.status : 'queued'
  return {
    ...input,
    taskId: input.taskId || taskIdFor(input.idempotencyKey),
    kind: input.kind || 'unknown',
    status,
    idempotencyKey: input.idempotencyKey || '',
    progress: Math.max(0, Math.min(100, Number(input.progress) || 0)),
    items: Array.isArray(input.items) ? input.items : [],
    snapshot: input.snapshot && typeof input.snapshot === 'object' ? input.snapshot : {},
  }
}

export function createProviderTask(input = {}) {
  const normalized = normalizeProviderTask(input)
  if (normalized.idempotencyKey && tasks.has(normalized.idempotencyKey)) return cloneProviderTask(tasks.get(normalized.idempotencyKey))
  tasks.set(normalized.idempotencyKey || normalized.taskId, normalized)
  return cloneProviderTask(normalized)
}

export function updateProviderTask(taskId, patch = {}) {
  const current = [...tasks.values()].find(task => task.taskId === taskId)
  if (!current) return null
  const next = normalizeProviderTask({ ...current, ...patch, taskId: current.taskId })
  tasks.set(next.idempotencyKey || next.taskId, next)
  return cloneProviderTask(next)
}

export function getProviderTask(taskIdOrKey) {
  const task = tasks.get(taskIdOrKey) || [...tasks.values()].find(item => item.taskId === taskIdOrKey)
  return task ? cloneProviderTask(task) : null
}

export function clearProviderTasks() { tasks.clear() }
export function providerTaskStatuses() { return STATUSES.slice() }

/**
 * 断线恢复队列：以宿主提供的幂等 key 去重，flush 后将成功项记为 acknowledged，
 * 后续重复回调只会被丢弃，不会再次触发远端写入。
 */
export function createProviderRecoveryQueue(options = {}) {
  const onRun = typeof options.onRun === 'function' ? options.onRun : (() => ({ status: 'succeeded' }))
  const pending = new Map()
  const acknowledged = new Set()

  return {
    enqueue(item = {}) {
      const key = String(item.key || item.idempotencyKey || '')
      if (!key || acknowledged.has(key)) return false
      if (!pending.has(key)) pending.set(key, { ...item, key })
      return true
    },
    pending() { return Array.from(pending.values()).map(item => ({ ...item })) },
    flush() {
      const results = []
      for (const [key, item] of pending) {
        const outcome = onRun({ ...item }) || {}
        const status = outcome.status || 'succeeded'
        results.push({ key, status })
        pending.delete(key)
        if (status === 'succeeded') acknowledged.add(key)
      }
      return results
    },
    acknowledged() { return Array.from(acknowledged) },
  }
}

function cloneProviderTask(task) {
  return { ...task, items: task.items.map(item => ({ ...item })), snapshot: { ...task.snapshot } }
}
