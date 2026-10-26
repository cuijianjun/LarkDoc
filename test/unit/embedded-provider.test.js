import { describe, expect, it } from 'vitest'
import {
  createInfoCollectionProvider,
  createMiajiProvider,
  createMobileProvider,
  createPresentationProvider,
  createProviderRegistry,
  createCollaboratorProvider,
  createDocumentAIProvider,
  createDocumentAppProvider,
  createDocumentInfoProvider,
  createDictionaryProvider,
  createFileViewProvider,
  createIsvProvider,
  createLocalTemplateProvider,
  createMentionProvider,
  createReportProvider,
  createSubscriptionProvider,
  normalizeEmbeddedResource,
  normalizeMobileCapabilities,
} from '../../src/providers/embedded'

function recorder() {
  const calls = []
  return {
    calls,
    request: async (operation, input, meta) => {
      calls.push({ operation, input, meta })
      return { operation, input }
    },
  }
}

describe('official embedded provider adapters', () => {
  it('forwards Miaji and subscription lifecycle operations with host context', async () => {
    const r = recorder()
    const miaji = createMiajiProvider({ request: r.request })
    const subscription = createSubscriptionProvider({ request: r.request, routes: { publish: '/subscription/publish' } })
    await miaji.resolve({ actorId: 'u1', tenantId: 't1' }, { blockId: 'b1', sourceUrl: 'https://miao.example/1', idempotencyKey: 'm1' })
    await subscription.publish({ actorId: 'u1', tenantId: 't1' }, { documentId: 'd1', title: 'marker' })
    expect(r.calls.map(call => call.operation)).toEqual(['resolve', 'publish'])
    expect(r.calls[0].input).toMatchObject({ actorId: 'u1', tenantId: 't1', idempotencyKey: 'm1' })
    expect(r.calls[1].meta).toMatchObject({ provider: 'subscription', route: '/subscription/publish' })
  })

  it('covers information collection and presentation state transitions', async () => {
    const r = recorder()
    const info = createInfoCollectionProvider({ request: r.request })
    const presentation = createPresentationProvider({ request: r.request })
    await info.create({ actorId: 'u1' }, { documentId: 'd1', kind: 'info_collection' })
    await info.submit({ identityMode: 'anonymous' }, { cardId: 'c1', answers: { email: 'redacted@example.invalid' } })
    await presentation.publish({ actorId: 'u1' }, { presentationId: 'p1', version: 'v1' })
    await presentation.close({ actorId: 'u1' }, { presentationId: 'p1', version: 'v2' })
    expect(r.calls.map(call => call.operation)).toEqual(['create', 'submit', 'publish', 'close'])
    expect(r.calls[1].input).toMatchObject({ identityMode: 'anonymous' })
    expect(info.capabilities.operations).toContain('requestPermission')
  })

  it('normalizes unavailable resource and mobile capability states fail closed', () => {
    expect(normalizeEmbeddedResource({ id: 'r1', state: 'ready', version: 'v4' })).toMatchObject({
      resourceId: 'r1', state: 'ready', providerVersion: 'v4', permissions: {},
    })
    expect(normalizeEmbeddedResource({ id: 'r2', state: 'unknown' }).state).toBe('unavailable')
    expect(normalizeMobileCapabilities({ platform: 'watch', supportsInfoCollection: 'write' })).toMatchObject({
      platform: 'web', supportsInfoCollection: 'unsupported', supportsOffline: false, supportsComments: false,
    })
  })

  it('provides mobile comment, version and health operations through the host', async () => {
    const r = recorder()
    const mobile = createMobileProvider({ request: r.request })
    await mobile.getCapabilities({ actorId: 'u1' }, { documentId: 'd1', platform: 'ios' })
    await mobile.createComment({ actorId: 'u1' }, { documentId: 'd1', body: 'marker' })
    await mobile.resolveComment({ actorId: 'u1' }, { threadId: 't1', resolved: true })
    await mobile.getVersion({ actorId: 'u1' }, { versionId: 'v1' })
    await mobile.healthCheck({ tenantId: 't1' })
    expect(r.calls.map(call => call.operation)).toEqual(['getCapabilities', 'createComment', 'resolveComment', 'getVersion', 'healthCheck'])
    expect(mobile.capabilities.provider).toBe('mobile')
  })

  it('registers providers without allowing an unshaped adapter', async () => {
    const registry = createProviderRegistry()
    const provider = createMiajiProvider({ request: async () => ({}) })
    registry.register('miaji', provider)
    expect(registry.get('miaji')).toBe(provider)
    await expect(registry.capabilities()).resolves.toEqual([
      expect.objectContaining({ name: 'miaji', provider: 'miaji' }),
    ])
    expect(() => registry.register('broken', {})).toThrow(/named provider/i)
  })

  it('exposes the remaining document surface adapters through one host contract', () => {
    const request = async () => ({})
    const providers = [
      createDocumentInfoProvider({ request }),
      createCollaboratorProvider({ request }),
      createMentionProvider({ request }),
      createDocumentAppProvider({ request }),
      createReportProvider({ request }),
      createIsvProvider({ request }),
      createDocumentAIProvider({ request }),
      createFileViewProvider({ request }),
      createLocalTemplateProvider({ request }),
      createDictionaryProvider({ request }),
    ]
    expect(providers.map(provider => provider.capabilities.provider)).toEqual([
      'documentInfo', 'collaborator', 'mention', 'documentApp', 'report', 'isv', 'documentAI', 'fileView', 'localTemplate', 'dictionary',
    ])
    expect(providers[0].capabilities.operations).toContain('updatePrivacy')
    expect(providers[6].capabilities.operations).toContain('insertCommentSuggestion')
  })

  it('requires host transport for every factory', () => {
    expect(() => createMiajiProvider()).toThrow(/host request/i)
    expect(() => createSubscriptionProvider()).toThrow(/host request/i)
    expect(() => createInfoCollectionProvider()).toThrow(/host request/i)
    expect(() => createPresentationProvider()).toThrow(/host request/i)
    expect(() => createMobileProvider()).toThrow(/host request/i)
  })
})
