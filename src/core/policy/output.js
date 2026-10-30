import { createAuditEvent } from './audit'

export const OUTPUT_ACTIONS = Object.freeze(['copy', 'download', 'print', 'screenshot'])

const POLICY_KEYS = Object.freeze({
  copy: 'canCopy',
  download: 'canDownload',
  print: 'canPrint',
  screenshot: 'allowScreenshot',
})

export function evaluateOutputPolicy(policy = {}, action) {
  const key = POLICY_KEYS[action]
  if (!key) return { action, allowed: false, reason: 'unsupported-action' }
  const allowed = policy[key] !== false
  return {
    action,
    allowed,
    reason: allowed ? '' : (policy.denyReason || `output ${action} denied`),
    watermark: policy.watermark || 'none',
  }
}

export function watermarkAttributes(policy = {}) {
  const watermark = ['visible', 'invisible'].includes(policy.watermark) ? policy.watermark : 'none'
  if (watermark === 'none') return {}
  const attrs = { 'data-watermark': watermark }
  if (watermark === 'visible' && policy.watermarkText) attrs['data-watermark-text'] = String(policy.watermarkText)
  return attrs
}

export function sanitizeOutputText(value) {
  return String(value || '')
    .replace(/\b(token|accessToken|refreshToken|apiKey|authorization|password|secret)\s*[:=]\s*[^\s\n]+/gi, '$1=[redacted]')
}

export function createOutputAuditEvent(input = {}) {
  return createAuditEvent({
    ...input,
    source: input.source || 'output-policy',
    metadata: input.metadata || {},
  })
}
