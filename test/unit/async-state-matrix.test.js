import { describe, expect, it } from 'vitest'
import {
  ASYNC_BLOCK_STATES,
  createAsyncBlockState,
  normalizeAsyncBlockState,
  transitionAsyncBlockState,
} from '../../src/core/blocks/shared'
import { projectCapabilitiesForState } from '../../src/providers/authorization'

const states = ['empty', 'loading', 'failed', 'unauthorized', 'over_limit']

describe('async block state matrix', () => {
  it('exposes exactly the five persisted states', () => {
    expect(ASYNC_BLOCK_STATES).toEqual(states)
    expect(states.map((state) => normalizeAsyncBlockState({ state }).state)).toEqual(states)
  })

  it('normalizes malformed state and preserves safe diagnostic metadata', () => {
    expect(normalizeAsyncBlockState({ state: 'unknown', message: 'retry', attempt: 2 })).toMatchObject({
      state: 'empty', message: 'retry', attempt: 2,
    })
    expect(normalizeAsyncBlockState({ state: 'failed', error: { code: 'E_LOAD' } })).toMatchObject({
      state: 'failed', error: { code: 'E_LOAD' },
    })
  })

  it('creates immutable-shaped state and allows explicit transitions', () => {
    const initial = createAsyncBlockState({ blockId: 'b1', kind: 'file' })
    expect(initial).toMatchObject({ blockId: 'b1', kind: 'file', state: 'empty', attempt: 0 })
    expect(transitionAsyncBlockState(initial, 'loading')).toMatchObject({ state: 'loading', attempt: 1 })
    expect(transitionAsyncBlockState(initial, 'failed', { error: { code: 'E_LOAD' } })).toMatchObject({
      state: 'failed', error: { code: 'E_LOAD' },
    })
    const retry = transitionAsyncBlockState(initial, 'loading', { idempotencyKey: 'retry-1' })
    expect(transitionAsyncBlockState(retry, 'loading', { idempotencyKey: 'retry-1' })).toEqual(retry)
    expect(() => transitionAsyncBlockState(initial, 'not-a-state')).toThrow(/状态/)
  })

  it('projects write and recovery capabilities by state', () => {
    expect(projectCapabilitiesForState('empty')).toMatchObject({ visible: true, read: true, edit: true, delete: true, comment: true, retry: true })
    expect(projectCapabilitiesForState('loading')).toMatchObject({ visible: true, read: false, edit: false, delete: true, comment: false, retry: false })
    expect(projectCapabilitiesForState('failed')).toMatchObject({ visible: true, read: false, edit: false, delete: true, comment: false, retry: true })
    expect(projectCapabilitiesForState('unauthorized')).toMatchObject({ visible: true, read: false, edit: false, delete: true, comment: false, retry: false })
    expect(projectCapabilitiesForState('over_limit')).toMatchObject({ visible: true, read: false, edit: false, delete: true, comment: false, retry: false })
  })
})
