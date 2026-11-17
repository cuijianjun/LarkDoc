/** Shared by synchronous bubble configuration and its deferred renderer. */
export function configSignature(config) {
  const { ai, blockStyle, marks = [], highlightAllowed } = config || {}
  return `${ai ? 1 : 0}|${blockStyle ? 1 : 0}|${highlightAllowed ? 1 : 0}|${config?.comment ? 1 : 0}|${marks.map((item) => item.id).join(',')}|${!!config?.mobile}|${!!config?.readonly}|${config?.canCopy}|${config?.canComment}|${config?.canShare}|${config?.canTranslate}|${config?.canAi}|${config?.aiUnavailableReason || ''}`
}
