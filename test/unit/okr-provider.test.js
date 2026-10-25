import { describe, expect, it } from 'vitest'
import { createOkrProvider } from '../../src/providers/okr'

describe('OKR provider adapter', () => {
  it('keeps cycle, objective, key result and check-in commands explicit', async () => {
    const calls = []
    const provider = createOkrProvider({ request: async (operation, input) => { calls.push({ operation, input }); return input } })

    await provider.createCycle({ actorId: 'admin' }, { lengthMonths: 3, firstEffectiveCycle: '2026-Q4', idempotencyKey: 'c1' })
    await provider.activateCycle({}, { cycleId: 'cycle-1', version: 1 })
    await provider.createObjective({ actorId: 'u1' }, { cycleId: 'cycle-1', title: 'Ship', idempotencyKey: 'o1' })
    await provider.createKeyResult({}, { objectiveId: 'obj-1', title: '100%', target: 100 })
    await provider.checkIn({}, { keyResultId: 'kr-1', progress: 25, note: 'started' })
    await provider.closeCycle({ actorId: 'admin' }, { cycleId: 'cycle-1', version: 2 })

    expect(calls.map(call => call.operation)).toEqual(['createCycle', 'activateCycle', 'createObjective', 'createKeyResult', 'checkIn', 'closeCycle'])
    expect(calls[0].input).toMatchObject({ actorId: 'admin', lengthMonths: 3, firstEffectiveCycle: '2026-Q4' })
    expect(calls[4].input).toMatchObject({ keyResultId: 'kr-1', progress: 25 })
  })

  it('requires a host request', () => {
    expect(() => createOkrProvider()).toThrow(/host request/i)
  })
})
