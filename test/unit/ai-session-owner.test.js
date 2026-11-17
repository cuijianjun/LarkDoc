// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { LarkDoc } from '../../src/LarkDoc'
import { createDocumentSession } from '../../src/session/DocumentSession'
import { createWorkspaceController, createWorkspaceState } from '../../src/workspace/WorkspaceController'

const mounted = []

afterEach(() => {
  mounted.splice(0).reverse().forEach(({ doc, element }) => { doc.destroy(); element.remove() })
  vi.restoreAllMocks()
})

const capabilities = { canView: true, canEdit: true, canComment: true, canResolveComment: true, canCreateVersion: true, canRestoreVersion: true, canExport: true, canCopy: true }

/** 只由用例手动触发的受控流，避免真实 AI 服务。 */
function controlledProvider() {
  const calls = []
  const stream = vi.fn(args => {
    const handle = { cancelled: 0, cancel() { handle.cancelled += 1 } }
    calls.push({ args, handle })
    return handle
  })
  return { calls, stream, provider: { stream } }
}

function ownerHarness(user = 'actor-A') {
  const createRange = document.createRange.bind(document)
  vi.spyOn(document, 'createRange').mockImplementation(() => Object.assign(createRange(), {
    getClientRects: () => [], getBoundingClientRect: () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
  }))
  const session = createDocumentSession({ documentId: 'ai-owner', user: { id: user }, capabilities })
  const probe = createWorkspaceController({ state: createWorkspaceState({}) })
  const ready = vi.spyOn(Object.getPrototypeOf(probe), 'onReady')
  const persistence = { kind: 'memory', load: async () => null, save: async () => null, snapshots: async () => [], snapshot: async () => null, restore: async () => null }
  return {
    session,
    async mount(provider) {
      const element = document.createElement('div'); document.body.append(element)
      const doc = new LarkDoc({ element, storage: 'none', session, persistence, content: '<p>正文从这里开始</p>', title: '标题', ai: provider, autosave: { enabled: false } })
      mounted.push({ doc, element })
      await vi.waitFor(() => expect(ready).toHaveBeenCalledOnce())
      await ready.mock.results[0].value
      const controller = doc._handle.workspaceController
      expect(controller.state.initialized).toBe(true)
      expect(controller.writable()).toBe(true)
      return { doc, controller, state: controller.state, editor: doc.getEditor() }
    },
  }
}

describe('T091 AI same-session owner', () => {
  it('retires the A stream, preview, copy and accept when the actor changes inside the same session', async () => {
    const { session, mount } = ownerHarness()
    const { calls, provider } = controlledProvider()
    const { controller, state, doc } = await mount(provider)
    const bodyBefore = doc.getJSON()

    controller.startAI('rewrite')
    expect(calls).toHaveLength(1)
    calls[0].args.onChunk('A 私有结果')
    expect(state.aiPreview).toBe('A 私有结果')

    session.user = { id: 'actor-B' }
    expect(doc.getSession().can('canEdit')).toBe(true)
    expect(state.aiOpen).toBe(false)
    expect(state.aiPreview).toBe('')
    expect(state.aiError).toBe('')
    expect(state.aiRunning).toBe(false)
    expect(calls[0].handle.cancelled).toBe(1)

    calls[0].args.onChunk('A 迟到内容')
    calls[0].args.onDone()
    expect(state.aiPreview).toBe('')
    expect(state.aiMessages).toEqual([])

    await controller.copyAIPreview()
    expect(state.notice).not.toContain('已复制')
    expect(controller.acceptAI('insert')).toBe(false)
    expect(doc.getJSON()).toEqual(bodyBefore)
  })

  it('retires A when only the authorization generation rotates, even though B can still edit', async () => {
    const { session, mount } = ownerHarness()
    const { calls, provider } = controlledProvider()
    const { controller, state, doc } = await mount(provider)
    const bodyBefore = doc.getJSON()
    session.setProvider('authorization', { getCapabilities: async () => capabilities })
    await session.refreshCapabilities()

    controller.startAI('rewrite')
    expect(calls).toHaveLength(1)
    calls[0].args.onChunk('A 私有结果')
    const capabilitiesBefore = session._authorizationGeneration
    await session.refreshCapabilities()
    expect(session._authorizationGeneration).toBeGreaterThan(capabilitiesBefore)
    expect(doc.getSession().can('canEdit')).toBe(true)
    expect(state.aiOpen).toBe(false)
    expect(state.aiPreview).toBe('')
    expect(calls[0].handle.cancelled).toBe(1)

    calls[0].args.onChunk('A 迟到内容')
    calls[0].args.onDone()
    expect(state.aiPreview).toBe('')
    expect(controller.acceptAI('insert')).toBe(false)
    expect(doc.getJSON()).toEqual(bodyBefore)
  })

  it('keeps the same-owner flow intact and writes B back with Undo', async () => {
    const { session, mount } = ownerHarness()
    const { calls, provider } = controlledProvider()
    const { controller, state, doc } = await mount(provider)
    const bodyBefore = doc.getJSON()

    controller.startAI('rewrite')
    calls[0].args.onChunk('A 私有结果')
    calls[0].args.onDone()
    expect(state.aiPreview).toBe('A 私有结果')
    expect(state.aiRunning).toBe(false)
    expect(calls[0].handle.cancelled).toBe(0)
    controller.acceptAI('insert')
    expect(doc.getText()).toContain('A 私有结果')
    doc.undo()
    expect(doc.getJSON()).toEqual(bodyBefore)

    session.user = { id: 'actor-B' }
    controller.startAI('rewrite')
    expect(calls).toHaveLength(2)
    calls[1].args.onChunk('B 新结果')
    calls[1].args.onDone()
    expect(state.aiPreview).toBe('B 新结果')
    expect(state.aiStatus).toBe('已完成，等待确认')
    controller.acceptAI('insert')
    expect(doc.getText()).toContain('B 新结果')
    expect(doc.getText()).not.toContain('A 私有结果')
    doc.undo()
    expect(doc.getJSON()).toEqual(bodyBefore)
  })
})
