const SENSITIVE_KEYS = new Set(['token', 'accessToken', 'refreshToken', 'apiKey', 'authorization', 'password', 'secret'])

export function redactSensitive(value) {
  if (Array.isArray(value)) return value.map(redactSensitive)
  if (!value || typeof value !== 'object') return value
  const output = {}
  Object.keys(value).forEach((key) => {
    output[key] = SENSITIVE_KEYS.has(key) ? '[redacted]' : redactSensitive(value[key])
  })
  return output
}

export function isSensitiveKey(key) { return SENSITIVE_KEYS.has(key) }
