/**
 * Host-owned import adapter.
 *
 * Import is a batch workflow: each file keeps its own job state and errors,
 * while the batch exposes commit, cancel and rollback explicitly. Parsing and
 * asset handling stay in the host so the editor never hides a failed file.
 */

const OPERATIONS = Object.freeze([
  'createBatch', 'getBatch', 'retry', 'cancel', 'commit', 'rollback', 'delete',
])

const STAGES = new Set(['uploaded', 'parsing', 'mapping', 'assets', 'ready', 'partial', 'failed', 'cancelled'])

function requireRequest(request) {
  if (typeof request !== 'function') throw new TypeError('import provider requires a host request function')
  return request
}

function withContext(ctx = {}, input = {}) {
  const value = { ...input }
  if (ctx.actorId !== undefined && value.actorId === undefined) value.actorId = ctx.actorId
  if (ctx.tenantId !== undefined && value.tenantId === undefined) value.tenantId = ctx.tenantId
  return value
}

function normalizeError(error = {}) {
  return {
    code: error.code || 'PARSE_FAILED',
    path: error.path,
    message: error.message || '导入失败',
    retryable: Boolean(error.retryable),
  }
}

export function normalizeImportJob(input = {}) {
  const jobs = Array.isArray(input.jobs) ? input.jobs.map(job => ({
    ...job,
    stage: STAGES.has(job.stage) ? job.stage : 'failed',
    progress: Number.isFinite(job.progress) ? job.progress : 0,
    warnings: Array.isArray(job.warnings) ? job.warnings : [],
    errors: Array.isArray(job.errors) ? job.errors.map(normalizeError) : [],
  })) : []
  const failedAssetCount = jobs.filter(job => job.stage === 'failed' || job.errors.length > 0).length
  return {
    ...input,
    jobs,
    assetCount: Number.isFinite(input.assetCount) ? input.assetCount : jobs.length,
    failedAssetCount,
    stage: STAGES.has(input.stage) ? input.stage : (failedAssetCount ? 'partial' : 'uploaded'),
    progress: Number.isFinite(input.progress) ? input.progress : 0,
    warnings: Array.isArray(input.warnings) ? input.warnings : [],
    errors: Array.isArray(input.errors) ? input.errors.map(normalizeError) : [],
    rollback: {
      requested: Boolean(input.rollback?.requested),
      completed: Boolean(input.rollback?.completed),
      markers: Array.isArray(input.rollback?.markers) ? input.rollback.markers : [],
    },
    batchStatus: input.batchStatus || (failedAssetCount ? 'partial' : 'running'),
  }
}

function cloneState(state) {
  return {
    ...state,
    jobs: state.jobs.map(job => ({ ...job, warnings: [...job.warnings], errors: job.errors.map(error => ({ ...error })) })),
    rollback: { ...state.rollback, markers: [...state.rollback.markers] },
  }
}

/**
 * Deterministic local batch state machine used by the UI before the host
 * commits a remote import. It never retries completed files and never hides a
 * failed asset behind a global completed flag.
 */
export function createImportBatchController(input = {}) {
  let state = normalizeImportJob(input)
  const snapshot = () => cloneState(state)
  return {
    getState: snapshot,
    retryFailed() {
      state = normalizeImportJob({
        ...state,
        stage: 'parsing',
        batchStatus: 'running',
        jobs: state.jobs.map(job => job.stage === 'failed'
          ? { ...job, stage: 'uploaded', progress: 0, errors: [] }
          : job),
      })
      return snapshot()
    },
    cancel() {
      state = normalizeImportJob({
        ...state,
        stage: 'cancelled',
        batchStatus: 'cancelled',
        jobs: state.jobs.map(job => ['ready', 'failed', 'cancelled'].includes(job.stage) ? job : { ...job, stage: 'cancelled' }),
      })
      return snapshot()
    },
    commit() {
      const hasFailed = state.jobs.some(job => job.stage === 'failed' || job.errors.length)
      state = normalizeImportJob({ ...state, stage: hasFailed ? 'partial' : 'ready', batchStatus: hasFailed ? 'partial' : 'completed' })
      return snapshot()
    },
    rollback() {
      state = normalizeImportJob({
        ...state,
        stage: 'cancelled',
        batchStatus: 'rolled_back',
        jobs: state.jobs.map(job => ({ ...job, stage: 'cancelled' })),
        rollback: { requested: true, completed: true, markers: [] },
      })
      return snapshot()
    },
  }
}

export function createImportProvider(options = {}) {
  const request = requireRequest(options.request)
  const routes = { ...(options.routes || {}) }
  const invoke = (operation, ctx, input = {}) => request(operation, withContext(ctx, input), {
    route: routes[operation] || operation,
    provider: 'import',
  })
  const provider = { capabilities: Object.freeze({ operations: OPERATIONS.slice(), requiresHostRequest: true }) }
  for (const operation of OPERATIONS) provider[operation] = (ctx, input) => invoke(operation, ctx, input)
  return provider
}

export { OPERATIONS as IMPORT_OPERATIONS }
