import { describe, expect, it } from 'vitest'
import { createReferenceProvider, normalizeReference } from '../../src/providers/reference'

describe('sheet reference provider adapter', () => {
  it('exposes reference lifecycle operations through a host request', async () => {
    const calls = []
    const provider = createReferenceProvider({
      request: async (operation, input, meta) => {
        calls.push({ operation, input, meta })
        return { operation, input, state: 'approved' }
      },
    })

    await provider.create({ actorId: 'u1', tenantId: 't1' }, { sourceToken: 'app-1', sourceRange: 'Sheet1!A1:B2', idempotencyKey: 'r1' })
    await provider.request({ actorId: 'u2' }, { referenceId: 'ref-1', sourceToken: 'app-1', sourceRange: 'Sheet1!A1:B2', version: 'v1' })
    await provider.approve({ actorId: 'u1' }, { referenceId: 'ref-1', version: 'v2' })
    await provider.refresh({ actorId: 'u2' }, { referenceId: 'ref-1' })
    await provider.disconnect({ actorId: 'u1' }, { referenceId: 'ref-1' })

    expect(calls.map(call => call.operation)).toEqual(['create', 'request', 'approve', 'refresh', 'disconnect'])
    expect(calls[0].input).toMatchObject({ actorId: 'u1', tenantId: 't1', sourceToken: 'app-1', idempotencyKey: 'r1' })
    expect(calls[0].meta).toMatchObject({ provider: 'sheet-reference' })
    expect(calls[1].input).toMatchObject({ actorId: 'u2', version: 'v1' })
  })

  it('requires a host request and lists capability operations', () => {
    expect(() => createReferenceProvider()).toThrow(/host request/i)
    const provider = createReferenceProvider({ request: () => null })
    expect(provider.capabilities.operations).toContain('reject')
  })

  it('normalizes source metadata and lifecycle states without hiding invalidity', () => {
    expect(normalizeReference({ sourceToken: 'sht-1', sourceRange: 'Sheet1!A1:B2', state: 'approved' })).toMatchObject({
      sourceType: 'sheet', sourceToken: 'sht-1', sourceRange: 'Sheet1!A1:B2', state: 'approved', permissions: {},
    })
    expect(normalizeReference({ state: 'unknown', sourceType: 'chart' }).state).toBe('unavailable')
  })
})
