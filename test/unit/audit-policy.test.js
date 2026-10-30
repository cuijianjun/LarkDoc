import { describe, expect, it } from 'vitest'
import { createAuditEvent } from '../../src/core/policy/audit'
import { redactSensitive } from '../../src/core/policy/sensitive-data'

describe('audit and sensitive data policy', () => {
  it('redacts nested credentials', () => {
    expect(redactSensitive({ token: 'secret', nested: { apiKey: 'key', value: 1 } })).toEqual({
      token: '[redacted]', nested: { apiKey: '[redacted]', value: 1 },
    })
  })

  it('creates a stable audit event without exposing token values', () => {
    const event = createAuditEvent({ action: 'export', result: 'denied', metadata: { accessToken: 'secret' } })
    expect(event).toMatchObject({ action: 'export', result: 'denied' })
    expect(event.metadata.accessToken).toBe('[redacted]')
    expect(event.eventId).toMatch(/^audit_/)
  })
})
