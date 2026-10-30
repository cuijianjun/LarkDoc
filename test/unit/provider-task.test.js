import { afterEach, describe, expect, it } from 'vitest'
import {
  clearProviderTasks, createProviderTask, getProviderTask, providerTaskStatuses, updateProviderTask,
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
})
