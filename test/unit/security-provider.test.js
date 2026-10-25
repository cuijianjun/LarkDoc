import { describe, expect, it } from 'vitest'
import { createSecurityProvider } from '../../src/providers/security'

describe('workspace security provider adapter', () => {
  it('separates policy decisions from audit-record queries', async () => {
    const calls = []
    const provider = createSecurityProvider({ request: async (operation, input) => { calls.push({ operation, input }); return input } })

    await provider.getPolicy({ actorId: 'admin' }, { scope: 'workspace' })
    await provider.updatePolicy({ actorId: 'admin' }, { key: 'externalShare', value: false, version: 4 })
    await provider.requestDecision({ actorId: 'u2' }, { action: 'download', resourceId: 'doc-1' })
    await provider.resolveDecision({ actorId: 'admin' }, { decisionId: 'd1', decision: 'deny', version: 5 })
    await provider.listAuditRecords({ actorId: 'admin' }, { resourceId: 'doc-1', cursor: 'c1' })

    expect(calls.map(call => call.operation)).toEqual(['getPolicy', 'updatePolicy', 'requestDecision', 'resolveDecision', 'listAuditRecords'])
    expect(calls[1].input).toMatchObject({ key: 'externalShare', value: false, version: 4 })
    expect(calls[4].input).toMatchObject({ resourceId: 'doc-1', cursor: 'c1' })
  })

  it('requires a host request', () => {
    expect(() => createSecurityProvider()).toThrow(/host request/i)
  })
})
