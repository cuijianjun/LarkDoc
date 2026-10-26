import { describe, expect, it } from 'vitest'
import { createImportBatchController, createImportProvider, normalizeImportJob } from '../../src/providers/import'

describe('import provider adapter', () => {
  it('exposes batch and per-job recovery operations', async () => {
    const calls = []
    const provider = createImportProvider({
      request: async (operation, input, meta) => {
        calls.push({ operation, input, meta })
        return { operation, input, status: 'ok' }
      },
    })

    await provider.createBatch({}, { items: [{ filename: 'a.docx', format: 'docx' }, { filename: 'b.xmind', format: 'xmind' }], mode: 'new_document', idempotencyKey: 'b1' })
    await provider.getBatch({}, { batchId: 'batch-1' })
    await provider.retry({}, { batchId: 'batch-1', failedAssetIds: ['asset-2'], idempotencyKey: 'r1' })
    await provider.cancel({}, { batchId: 'batch-1', reason: 'user_cancelled' })
    await provider.commit({}, { batchId: 'batch-1', version: 'v1' })
    await provider.rollback({}, { batchId: 'batch-1', reason: 'fidelity_failed', idempotencyKey: 'rb1' })

    expect(calls.map(call => call.operation)).toEqual(['createBatch', 'getBatch', 'retry', 'cancel', 'commit', 'rollback'])
    expect(calls[0].input.items).toHaveLength(2)
    expect(calls[2].input.failedAssetIds).toEqual(['asset-2'])
    expect(calls[5].meta).toMatchObject({ provider: 'import' })
  })

  it('normalizes per-file failure and rollback state without hiding errors', () => {
    const job = normalizeImportJob({
      batchId: 'batch-1',
      stage: 'partial',
      progress: 50,
      jobs: [
        { jobId: 'j1', filename: 'ok.md', stage: 'ready', progress: 100, errors: [] },
        { jobId: 'j2', filename: 'bad.xmind', stage: 'failed', progress: 50, errors: [{ code: 'PARSE_FAILED', retryable: true, message: 'bad outline' }] },
      ],
      rollback: { requested: false, completed: false, markers: [] },
    })
    expect(job.failedAssetCount).toBe(1)
    expect(job.jobs[1].errors[0]).toMatchObject({ code: 'PARSE_FAILED', retryable: true })
    expect(job.stage).toBe('partial')
  })

  it('requires a host request and advertises recovery operations', () => {
    expect(() => createImportProvider()).toThrow(/host request/i)
    const provider = createImportProvider({ request: () => null })
    expect(provider.capabilities.operations).toEqual(expect.arrayContaining(['retry', 'cancel', 'commit', 'rollback']))
  })

  it('retries only failed files and preserves successful files', () => {
    const controller = createImportBatchController({
      batchId: 'batch-2',
      stage: 'partial',
      jobs: [
        { jobId: 'j1', filename: 'ok.md', stage: 'ready', progress: 100 },
        { jobId: 'j2', filename: 'bad.xmind', stage: 'failed', progress: 50, errors: [{ code: 'PARSE_FAILED', retryable: true }] },
      ],
    })
    const next = controller.retryFailed()
    expect(next.jobs.find(job => job.jobId === 'j1')).toMatchObject({ stage: 'ready', progress: 100 })
    expect(next.jobs.find(job => job.jobId === 'j2')).toMatchObject({ stage: 'uploaded', progress: 0, errors: [] })
  })

  it('supports cancellation, commit and rollback as explicit batch transitions', () => {
    const controller = createImportBatchController({
      batchId: 'batch-3',
      stage: 'parsing',
      jobs: [{ jobId: 'j1', filename: 'pending.md', stage: 'parsing', progress: 30 }],
      rollback: { markers: ['doc-1'] },
    })
    expect(controller.cancel().batchStatus).toBe('cancelled')
    expect(controller.commit().batchStatus).toBe('completed')
    const rolled = controller.rollback()
    expect(rolled.batchStatus).toBe('rolled_back')
    expect(rolled.rollback).toMatchObject({ requested: true, completed: true, markers: [] })
  })
})
