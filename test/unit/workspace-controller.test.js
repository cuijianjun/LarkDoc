import { describe, expect, it } from 'vitest'
import { createWorkspaceController, createWorkspaceState } from '../../src/workspace/WorkspaceController'

function createHarness(overrides = {}) {
  const state = createWorkspaceState({ config: {}, initialContent: '<p>正文</p>', initialTitle: '文档' })
  const events = []
  const persistence = {
    kind: 'memory',
    load: async () => null,
    save: async value => { persistence.last = value },
    snapshots: async () => persistence.items || [],
    snapshot: async value => { persistence.items = [{ id: 's1', ...value }] },
    restore: async () => ({ id: 's1', title: '旧标题', json: { type: 'doc', content: [] }, schemaVersion: 3 }),
  }
  const editor = {
    isEditable: true,
    schema: {},
    state: { doc: {}, selection: { from: 1 } },
    on() {},
    off() {},
  }
  const host = {
    getEditor: () => editor,
    getJSON: () => ({ type: 'doc', content: [] }),
    getHTML: () => '<p>正文</p>',
    getText: () => '正文',
    writable: () => true,
    emit: (event, payload) => events.push([event, payload]),
    getWindow: () => ({ localStorage: null, indexedDB: null }),
    getNavigator: () => ({}),
    confirm: () => true,
    ...overrides.host,
  }
  const provider = overrides.props?.persistence || persistence
  const controller = createWorkspaceController({
    state,
    props: { documentId: 'doc-1', persistence: provider, ...overrides.props },
    host,
  })
  state.sessionInstance = {
    getProvider: () => provider,
    setProvider() {},
    getDocumentRecord: ({ title }) => ({ title, content: { type: 'doc', content: [] }, schemaVersion: 3 }),
    attachEditor() {},
  }
  return { controller, state, persistence, events }
}

describe('WorkspaceController 阶段7主壳前置', () => {
  it('在无 Vue 环境下保留 session、record、save 与快照边界', async () => {
    const { controller, state, persistence } = createHarness()
    state.initialized = true
    expect(controller.getSession()).toBe(state.sessionInstance)
    expect(controller.record()).toMatchObject({ title: '文档', schemaVersion: 3 })
    await controller.saveNow(true)
    expect(persistence.last.title).toBe('文档')
    await controller.createSnapshot()
    expect(state.snapshots).toHaveLength(1)
    expect(state.notice).toContain('快照已保存')
  })

  it('保存失败进入 storageError 闸门并发出失败事件', async () => {
    const { controller, state, events } = createHarness({
      props: { persistence: { kind: 'host', save: async () => { throw new Error('写入失败') } } },
    })
    state.initialized = true
    await controller.saveNow(true)
    expect(state.storageError).toBe(true)
    expect(state.saveStatus).toBe('写入失败')
    expect(events.at(-1)[0]).toBe('error')
  })

  it('停止 AI 会使旧流失效并清理运行状态', () => {
    let cancelled = 0
    const { controller, state } = createHarness()
    controller._aiStream = { cancel: () => { cancelled += 1 } }
    state.aiOpen = true
    state.aiStatus = '生成中…'
    controller.stopAI()
    expect(cancelled).toBe(1)
    expect(state.aiRunning).toBe(false)
    expect(state.aiStatus).toBe('已停止')
  })
})
