import { describe, expect, it } from 'vitest'
import { createSurveyProvider } from '../../src/providers/survey'

describe('survey provider adapter', () => {
  it('exposes the full survey lifecycle through a host request', async () => {
    const calls = []
    const provider = createSurveyProvider({
      request: async (operation, input, meta) => {
        calls.push({ operation, input, meta })
        return { operation, input, status: 'ok' }
      },
    })

    await provider.create({ actorId: 'u1', tenantId: 't1' }, { documentId: 'doc-1', blockId: 'blk-1', title: 'Feedback', questions: [], allowDuplicate: false, idempotencyKey: 's1' })
    await provider.update({ actorId: 'u1' }, { surveyId: 's1', patch: { allowDuplicate: true }, version: 'v1' })
    await provider.publish({ actorId: 'u1' }, { surveyId: 's1', version: 'v2' })
    await provider.submit({ actorId: 'u2' }, { surveyId: 's1', respondentId: 'u2', answers: [], idempotencyKey: 'r1' })
    await provider.results({ actorId: 'u1' }, { surveyId: 's1', cursor: 'c1', limit: 20 })
    await provider.export({ actorId: 'u1' }, { surveyId: 's1', format: 'xlsx', idempotencyKey: 'e1' })
    await provider.close({ actorId: 'u1' }, { surveyId: 's1', version: 'v3' })

    expect(calls.map(call => call.operation)).toEqual(['create', 'update', 'publish', 'submit', 'results', 'export', 'close'])
    expect(calls[0].input).toMatchObject({ actorId: 'u1', tenantId: 't1', allowDuplicate: false, idempotencyKey: 's1' })
    expect(calls[3].input).toMatchObject({ respondentId: 'u2', idempotencyKey: 'r1' })
    expect(calls[5].meta).toMatchObject({ provider: 'survey' })
  })

  it('keeps permission and duplicate-submission operations explicit', async () => {
    const calls = []
    const provider = createSurveyProvider({ request: async (operation, input) => { calls.push({ operation, input }); return input } })
    await provider.getPermissions({ actorId: 'u1' }, { surveyId: 's1' })
    await provider.updatePermissions({ actorId: 'u1' }, { surveyId: 's1', role: 'collaborator', subjectId: 'u2', version: 'v1' })
    await provider.submit({ actorId: 'u2' }, { surveyId: 's1', respondentId: 'u2', answers: [], allowDuplicate: false, idempotencyKey: 'r2' })
    expect(calls.map(call => call.operation)).toEqual(['getPermissions', 'updatePermissions', 'submit'])
    expect(calls[2].input.allowDuplicate).toBe(false)
  })

  it('requires a host request and advertises the contract', () => {
    expect(() => createSurveyProvider()).toThrow(/host request/i)
    const provider = createSurveyProvider({ request: () => null })
    expect(provider.capabilities.operations).toContain('publish')
    expect(provider.capabilities.operations).toContain('export')
  })
})
