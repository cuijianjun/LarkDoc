import { describe, expect, it } from 'vitest'
import { createSecurityProvider, normalizeAuditRecord, normalizeSecurityDecision, normalizeSecurityPolicy, requirePermittedDecision } from '../../src/providers/security'
import { projectCapabilitiesForState } from '../../src/providers/authorization'
import { createAuditEvent } from '../../src/core/policy/audit'

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

  it('rejects business-denied security mutations with stable decision metadata', async () => {
    const provider = createSecurityProvider({
      request: async () => ({ status: 'deny', code: 'SECURITY_DENIED', reason: 'download blocked', requestId: 'req-1', permissionVersion: 7 }),
    })
    await expect(provider.requestDecision({ actorId: 'u1' }, { action: 'download' })).rejects.toMatchObject({
      code: 'SECURITY_DENIED', status: 'deny', requestId: 'req-1', permissionVersion: 7, reason: 'download blocked',
    })
    expect(() => requirePermittedDecision({ status: 'approval_required', requestId: 'req-2' })).toThrow(/security request denied/i)
  })

  it('normalizes Feishu-style policy, decision and audit states', () => {
    expect(normalizeSecurityPolicy({ canCopy: false, watermark: 'visible' })).toMatchObject({
      canCopy: false, canDownload: true, canPrint: true, watermark: 'visible', allowScreenshot: true,
    })
    expect(normalizeSecurityDecision({ status: 'approval_required', auditId: 'a1' })).toMatchObject({
      status: 'approval_required', allowed: false, auditId: 'a1',
    })
    expect(normalizeAuditRecord({ auditId: 'a1', kind: 'download', actorId: 'u1' })).toMatchObject({ auditId: 'a1', kind: 'download', actorId: 'u1' })
  })

  it('projects unauthorized and over-limit blocks as visible read-only cards', () => {
    expect(projectCapabilitiesForState('unauthorized')).toMatchObject({ visible: true, read: false, edit: false, delete: true, comment: false, retry: false })
    expect(projectCapabilitiesForState('over_limit')).toMatchObject({ visible: true, read: false, edit: false, delete: true, comment: false, retry: false })
  })

  it('redacts provider tokens before creating audit events', () => {
    const event = createAuditEvent({
      actorId: 'u1', action: 'load', result: 'failed',
      metadata: { token: 'secret-token', nested: { accessToken: 'secret-access-token' } },
    })
    expect(event.metadata).toEqual({ token: '[redacted]', nested: { accessToken: '[redacted]' } })
  })
})
