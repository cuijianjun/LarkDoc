import { describe, expect, it } from 'vitest'
import { createJiraProvider } from '../../src/providers/jira'

describe('Jira provider adapter', () => {
  it('covers project, issue, comment and transition operations', async () => {
    const calls = []
    const provider = createJiraProvider({ request: async (operation, input) => { calls.push({ operation, input }); return input } })

    await provider.getConnection({ actorId: 'u1' }, { baseUrl: 'https://jira.example.test' })
    await provider.listProjects({}, { cursor: 'c1' })
    await provider.createIssue({ actorId: 'u1' }, { projectId: 'PRJ', summary: 'test', idempotencyKey: 'i1' })
    await provider.updateIssue({}, { issueId: 'PRJ-1', summary: 'edited', version: 2 })
    await provider.addComment({}, { issueId: 'PRJ-1', body: 'hello' })
    await provider.transition({}, { issueId: 'PRJ-1', transitionId: 'done', version: 3 })
    await provider.deleteIssue({}, { issueId: 'PRJ-1', version: 4 })

    expect(calls.map(call => call.operation)).toEqual(['getConnection', 'listProjects', 'createIssue', 'updateIssue', 'addComment', 'transition', 'deleteIssue'])
    expect(calls[2].input).toMatchObject({ actorId: 'u1', projectId: 'PRJ', idempotencyKey: 'i1' })
    expect(calls[5].input).toMatchObject({ issueId: 'PRJ-1', transitionId: 'done', version: 3 })
    expect(provider.capabilities.operations).toEqual(expect.arrayContaining(['getProjectPermissions', 'getIssuePermissions']))
  })

  it('does not construct a network client without a host request', () => {
    expect(() => createJiraProvider()).toThrow(/host request/i)
  })
})
