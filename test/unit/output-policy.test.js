import { describe, expect, it } from 'vitest'
import {
  OUTPUT_ACTIONS,
  evaluateOutputPolicy,
  createOutputAuditEvent,
  watermarkAttributes,
  sanitizeOutputText,
} from '../../src/core/policy/output'

describe('output policy', () => {
  it('fails closed for copy/download/print/screenshot', () => {
    const policy = { canCopy: false, canDownload: false, canPrint: false, allowScreenshot: false }
    for (const action of OUTPUT_ACTIONS) {
      expect(evaluateOutputPolicy(policy, action)).toMatchObject({ allowed: false, action })
    }
  })

  it('allows unspecified actions and preserves explicit reasons', () => {
    expect(evaluateOutputPolicy({ canCopy: true }, 'copy')).toMatchObject({ allowed: true, action: 'copy' })
    expect(evaluateOutputPolicy({ canCopy: false, denyReason: 'confidential' }, 'copy')).toMatchObject({
      allowed: false, reason: 'confidential',
    })
  })

  it('projects visible and invisible watermark metadata without leaking secrets', () => {
    expect(watermarkAttributes({ watermark: 'visible', watermarkText: 'Alice · doc-1' })).toEqual({
      'data-watermark': 'visible', 'data-watermark-text': 'Alice · doc-1',
    })
    expect(watermarkAttributes({ watermark: 'none', watermarkText: 'secret-token' })).toEqual({})
  })

  it('sanitizes sensitive output fields before copy or audit', () => {
    expect(sanitizeOutputText('token=abc password: hunter2\n正文')).toBe('token=[redacted] password=[redacted]\n正文')
    const event = createOutputAuditEvent({ action: 'download', result: 'denied', metadata: { token: 'abc' } })
    expect(event).toMatchObject({ action: 'download', result: 'denied', metadata: { token: '[redacted]' } })
  })
})
