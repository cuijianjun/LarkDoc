import { afterEach, describe, expect, it } from 'vitest'
import {
  clearProviderTasks, createProviderRecoveryQueue, createProviderTask, getProviderTask, providerTaskStatuses, updateProviderTask,
} from '../../src/providers/provider-task'

afterEach(() => clearProviderTasks())

describe('ProviderTask', () => {
  it('normalizes status, progress and snapshot', () => {
    const task = createProviderTask({ kind: 'import', idempotencyKey: 'same', status: 'running', progress: 120 })
    expect(task).toMatchObject({ kind: 'import', status: 'running', progress: 100, idempotencyKey: 'same' })
    expect(getProviderTask(task.taskId)).toEqual(task)
  })

  it('reuses the same task for an idempotency key', () => {
    const first = createProviderTask({ kind: 'survey', idempotencyKey: 'same' })
    const second = createProviderTask({ kind: 'survey', idempotencyKey: 'same', status: 'succeeded' })
    expect(second.taskId).toBe(first.taskId)
    expect(second.status).toBe('queued')
  })

  it('updates a task and exposes the stable lifecycle', () => {
    const task = createProviderTask({ kind: 'ai', idempotencyKey: 'ai-1' })
    expect(updateProviderTask(task.taskId, { status: 'failed', progress: 30 })).toMatchObject({ status: 'failed', progress: 30 })
    expect(providerTaskStatuses()).toEqual(['queued', 'running', 'partial', 'succeeded', 'failed', 'rolled_back'])
  })

  it('recovery queue deduplicates callbacks and does not replay acknowledged remote work', () => {
    const calls = []
    const queue = createProviderRecoveryQueue({ onRun: (item) => { calls.push(item.key); return { status: 'succeeded' } } })
    queue.enqueue({ key: 'remote-1', source: 'remote', payload: { value: 1 } })
    queue.enqueue({ key: 'remote-1', source: 'remote', payload: { value: 1 } })
    expect(queue.pending()).toHaveLength(1)
    expect(queue.flush()).toEqual([{ key: 'remote-1', status: 'succeeded' }])
    expect(calls).toEqual(['remote-1'])
    expect(queue.flush()).toEqual([])
    expect(queue.acknowledged()).toEqual(['remote-1'])
  })
})
