export const BLOCK_API_ERRORS = Object.freeze({
  NOT_FOUND: 'ERR_BLOCK_NOT_FOUND',
  INVALID_PARENT: 'ERR_INVALID_PARENT',
  CYCLE: 'ERR_BLOCK_CYCLE',
  INVALID_PAYLOAD: 'ERR_INVALID_PAYLOAD',
  PERMISSION_DENIED: 'ERR_PERMISSION_DENIED',
  TRANSACTION_FAILED: 'ERR_TRANSACTION_FAILED',
})

export function blockApiError(code, message, details = {}) {
  const error = new Error(message)
  error.code = code
  Object.assign(error, details)
  return error
}
