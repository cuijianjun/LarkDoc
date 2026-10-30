/** core/blocks 共享小工具：标题层级、异步块状态与 schema 属性校验器。 */
export const levels = [1, 2, 3, 4, 5, 6, 7, 8, 9]
export const validateAttribute = (name, predicate) => (value) => { if (!predicate(value)) throw new Error(`无效属性：${name}`) }

export const ASYNC_BLOCK_STATES = Object.freeze([
  'empty',
  'loading',
  'failed',
  'unauthorized',
  'over_limit',
])

const DEFAULT_ASYNC_STATE = Object.freeze({
  state: 'empty',
  attempt: 0,
  error: null,
  message: '',
})

const copyError = (error) => {
  if (!error || typeof error !== 'object') return error || null
  return { ...error }
}

/** 将文件、图片、表格和嵌入块的异步字段收敛到同一份安全载荷。 */
export function normalizeAsyncBlockState(input = {}) {
  const value = input && typeof input === 'object' ? input : {}
  const state = ASYNC_BLOCK_STATES.includes(value.state) ? value.state : 'empty'
  const attempt = Number.isInteger(value.attempt) && value.attempt >= 0 ? value.attempt : 0
  return {
    ...value,
    state,
    attempt,
    error: copyError(value.error),
    message: typeof value.message === 'string' ? value.message : '',
  }
}

export function createAsyncBlockState(input = {}) {
  const normalized = normalizeAsyncBlockState({ ...DEFAULT_ASYNC_STATE, ...input })
  return { ...normalized }
}

export function transitionAsyncBlockState(current, state, patch = {}) {
  if (!ASYNC_BLOCK_STATES.includes(state)) throw new Error(`无效异步块状态：${state}`)
  const previous = normalizeAsyncBlockState(current)
  if (patch.idempotencyKey && previous.lastTransitionKey === patch.idempotencyKey) return { ...previous }
  return normalizeAsyncBlockState({
    ...previous,
    ...patch,
    state,
    lastTransitionKey: patch.idempotencyKey || previous.lastTransitionKey || null,
    attempt: state === 'loading' ? previous.attempt + 1 : previous.attempt,
  })
}
