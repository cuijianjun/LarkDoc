// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWorkspaceController, createWorkspaceState } from '../../src/workspace/WorkspaceController'
import { LarkDoc } from '../../src/LarkDoc'
import { readOptionsFromElement, applyAttributeChange } from '../../src/web-component/attributes'
import { LarkDocElement } from '../../src/web-component/LarkDocElement'
import { createDocumentSession } from '../../src/session/DocumentSession'

const controllers = []
const mounted = []

afterEach(() => {
  controllers.splice(0).forEach(controller => controller.dispose())
  mounted.splice(0).reverse().forEach(({ doc, element }) => { doc.destroy(); element.remove() })
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function harness(config = {}) {
  const state = createWorkspaceState({ config, initialContent: '<p>正文</p>', initialTitle: '文档' })
  const persistence = {
    kind: 'memory',
    load: async () => null,
    save: vi.fn(async value => { persistence.last = value }),
    snapshots: async () => [],
    snapshot: async () => null,
    restore: async () => null,
  }
  const editor = {
    isEditable: true,
    schema: {},
    state: { doc: {}, selection: { from: 1 } },
    on() {}, off() {},
    chain() {
      const chain = { focus: () => chain, insertContent: () => chain, undo: () => chain, redo: () => chain, run: () => true }
      return chain
    },
  }
  const host = {
    getEditor: () => editor,
    getJSON: () => ({ type: 'doc', content: [] }),
    getHTML: () => '<p>正文</p>',
    getText: () => '正文',
    writable: () => true,
    emit() {},
    getWindow: () => ({ localStorage: null, indexedDB: null }),
    getNavigator: () => ({}),
    confirm: () => true,
  }
  const controller = createWorkspaceController({ state, props: { documentId: 'doc-1', persistence }, host })
  state.sessionInstance = {
    getProvider: () => persistence,
    setProvider() {},
    getDocumentRecord: ({ title }) => ({ title, content: { type: 'doc', content: [] }, schemaVersion: 3 }),
    attachEditor() {},
    dispose() {},
  }
  controllers.push(controller)
  return { controller, state, persistence }
}

function hostAdapter() {
  return {
    load: vi.fn(async () => null),
    save: vi.fn(async () => null),
    snapshots: vi.fn(async () => []),
    snapshot: vi.fn(async () => null),
    restore: vi.fn(async () => null),
  }
}

describe('自动保存：构造期配置与运行时读取', () => {
  it('默认值与显式配置都能读回，effective 叠加持久化总闸', () => {
    const { controller } = harness()
    expect(controller.getAutoSave()).toEqual({ enabled: true, delay: 650, effective: true })

    const custom = harness({ autosave: { enabled: false, delay: 1200 } })
    expect(custom.controller.getAutoSave()).toEqual({ enabled: false, delay: 1200, effective: false })

    const gated = harness({ features: { persistence: false } })
    expect(gated.controller.getAutoSave()).toEqual({ enabled: true, delay: 650, effective: false })
  })

  it('非法 delay 统一回落到 650，0 是合法值', () => {
    const { controller } = harness()
    expect(controller.setAutoSave({ delay: -1 }).delay).toBe(650)
    expect(controller.setAutoSave({ delay: 'abc' }).delay).toBe(650)
    expect(controller.setAutoSave({ delay: NaN }).delay).toBe(650)
    expect(controller.setAutoSave({ delay: 0 }).delay).toBe(0)
  })

  it('只改 autosave 段，其它配置不受影响', () => {
    const { controller, state } = harness({ limits: { maxLength: 500 } })
    const before = state.editorConfig.features
    controller.setAutoSave({ delay: 200 })
    expect(state.editorConfig.limits.maxLength).toBe(500)
    expect(state.editorConfig.features).toBe(before)
  })
})

describe('自动保存：运行时热更与已排队定时器', () => {
  beforeEach(() => { vi.useFakeTimers() })

  it('运行中关闭会取消已排队的落盘，手动保存与离页保存仍可用', async () => {
    const { controller, state, persistence } = harness()
    state.initialized = true
    controller.queueSave()
    expect(controller._saveTimer).not.toBeNull()
    expect(controller.setAutoSave({ enabled: false }).effective).toBe(false)

    await vi.advanceTimersByTimeAsync(2000)
    expect(persistence.save).not.toHaveBeenCalled()
    expect(state.saveStatus).toBe('自动保存已关闭')

    await controller.save()
    expect(persistence.save).toHaveBeenCalledTimes(1)
    controller.flushOnLeave()
    await vi.advanceTimersByTimeAsync(0)
    expect(persistence.save).toHaveBeenCalledTimes(2)
  })

  it('改大延迟时，已排队定时器按新值重新计时', async () => {
    const { controller, state, persistence } = harness()
    state.initialized = true
    controller.queueSave()
    controller.setAutoSave({ delay: 1200 })

    await vi.advanceTimersByTimeAsync(649)
    expect(persistence.save).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(551)
    expect(persistence.save).toHaveBeenCalledTimes(1)
  })

  it('改小延迟时立即按新值生效，不会等到原来的 650ms', async () => {
    const { controller, state, persistence } = harness()
    state.initialized = true
    controller.queueSave()
    controller.setAutoSave({ delay: 100 })

    await vi.advanceTimersByTimeAsync(99)
    expect(persistence.save).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(persistence.save).toHaveBeenCalledTimes(1)
  })

  it('关闭后重新开启，后续编辑恢复自动落盘', async () => {
    const { controller, state, persistence } = harness()
    state.initialized = true
    controller.setAutoSave({ enabled: false })
    controller.queueSave()
    await vi.advanceTimersByTimeAsync(1000)
    expect(persistence.save).not.toHaveBeenCalled()

    expect(controller.setAutoSave({ enabled: true, delay: 0 }).effective).toBe(true)
    controller.queueSave()
    await vi.advanceTimersByTimeAsync(0)
    expect(persistence.save).toHaveBeenCalledTimes(1)
  })

  it('空闲状态改配置不会凭空产生一次落盘', async () => {
    const { controller, state, persistence } = harness()
    state.initialized = true
    controller.setAutoSave({ delay: 10 })
    await vi.advanceTimersByTimeAsync(1000)
    expect(persistence.save).not.toHaveBeenCalled()
    expect(controller._saveTimer).toBeNull()
  })
})

describe('自动保存：门面 API', () => {
  beforeEach(() => {
    // jsdom 不提供 Range 布局几何；块手柄定位会读 getClientRects。
    vi.spyOn(document, 'createRange').mockImplementation(() => {
      const range = new Range()
      range.getClientRects = () => []
      range.getBoundingClientRect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })
      return range
    })
  })

  it('setAutoSave 同步 options / config / getConfig，getAutoSave 读回生效值', () => {
    const element = document.createElement('div')
    document.body.appendChild(element)
    const adapter = hostAdapter()
    const doc = new LarkDoc({ element, content: '<p>正文</p>', storage: 'none', persistence: adapter })
    mounted.push({ element, doc })

    expect(doc.getAutoSave()).toEqual({ enabled: true, delay: 650, effective: true })
    const next = doc.setAutoSave({ enabled: false, delay: 200 })

    expect(next).toEqual({ enabled: false, delay: 200, effective: false })
    expect(doc.getAutoSave()).toEqual(next)
    expect(doc.options.autosave).toEqual({ enabled: false, delay: 200 })
    expect(doc.config.autosave).toEqual({ enabled: false, delay: 200 })
    expect(doc.getConfig().autosave).toEqual({ enabled: false, delay: 200 })
  })

  it('构造期传 autosave 与运行时 setAutoSave 走同一套归一化', () => {
    const element = document.createElement('div')
    document.body.appendChild(element)
    const doc = new LarkDoc({
      element, content: '<p>正文</p>', storage: 'none', persistence: hostAdapter(),
      autosave: { delay: 0 },
    })
    mounted.push({ element, doc })

    expect(doc.getAutoSave().delay).toBe(0)
    expect(doc.setAutoSave({ delay: 'oops' }).delay).toBe(650)
    expect(doc.getAutoSave().delay).toBe(650)
  })
})

describe('自动保存：Web Component 声明式属性', () => {
  it('readOptionsFromElement 支持整段 JSON 与两个标量属性，标量优先', () => {
    const el = document.createElement('lark-doc')
    el.setAttribute('autosave', '{"enabled":false,"delay":1200}')
    el.setAttribute('autosave-enabled', 'true')
    el.setAttribute('autosave-delay', '300')

    const { options } = readOptionsFromElement(el)
    expect(options.autosave).toEqual({ enabled: true, delay: 300 })
  })

  it('只有标量属性时也能拼出 autosave 段', () => {
    const el = document.createElement('lark-doc')
    el.setAttribute('autosave-enabled', 'false')
    expect(readOptionsFromElement(el).options.autosave).toEqual({ enabled: false })
  })

  it('标量属性是 live（不重建实例），整段 JSON 变更才重建', () => {
    expect(applyAttributeChange('autosave-enabled', 'false')).toMatchObject({ live: true, rebuild: false, value: false })
    expect(applyAttributeChange('autosave-delay', '250')).toMatchObject({ live: true, rebuild: false, value: 250 })
    expect(applyAttributeChange('autosave-enabled', null)).toMatchObject({ live: true, rebuild: false, value: null })
    expect(applyAttributeChange('autosave', '{}').rebuild).toBe(true)
  })

  it('元素上改标量属性走 setAutoSave 热更，不重建；移除属性回落默认值', () => {
    const tag = 'lark-doc-autosave-probe'
    if (!customElements.get(tag)) customElements.define(tag, LarkDocElement)
    // 不 append：只要元素类已注册，attributeChangedCallback 在游离节点上同样触发，
    // 也避免 connectedCallback 的微任务挂载覆盖这里的门面 stub。
    const el = document.createElement(tag)
    const setAutoSave = vi.fn()
    const facade = { setAutoSave, options: {} }
    el.document = facade

    el.setAttribute('autosave-enabled', 'false')
    expect(setAutoSave).toHaveBeenLastCalledWith({ enabled: false })
    el.setAttribute('autosave-delay', '250')
    expect(setAutoSave).toHaveBeenLastCalledWith({ delay: 250 })

    el.removeAttribute('autosave-enabled')
    expect(setAutoSave).toHaveBeenLastCalledWith({ enabled: undefined })
    el.removeAttribute('autosave-delay')
    expect(setAutoSave).toHaveBeenLastCalledWith({ delay: undefined })
    expect(el.document).toBe(facade) // 门面实例未被重建
    expect(setAutoSave).toHaveBeenCalledTimes(4)
  })
})

describe('自动保存：Web Component 重建时的配置延续', () => {
  // 同一个构造函数在 Custom Elements 注册表里只能绑定一个 tag，
  // 复用上面 describe 已注册的名字（那里只创建游离元素，不会与本组冲突）。
  const TAG = 'lark-doc-autosave-probe'

  beforeEach(() => { vi.useFakeTimers() })

  /** 只观察 _scheduleRebuild() 交给 _mount() 的 preservedState，不真正挂载编辑器。 */
  function rebuildHarness(attrs = {}, runtime = { enabled: false, delay: 220, effective: false }) {
    if (!customElements.get(TAG)) customElements.define(TAG, LarkDocElement)
    const el = document.createElement(TAG)
    Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, value))
    document.body.appendChild(el)
    // connectedCallback 的微任务挂载会调用 _mount()，这里只测重建分支。
    clearTimeout(el._connectTask)
    el._connectTask = null
    el.document = {
      getAutoSave: () => runtime,
      getJSON: () => ({ type: 'doc', content: [] }),
      getTitle: () => '标题',
      options: {},
      destroy() {},
    }
    const capture = { value: null, el }
    el._unmount = () => { el.document = null }
    el._mount = (preservedState) => { capture.value = preservedState }
    return capture
  }

  it('其它非 live 属性触发重建时，保留运行时 setAutoSave() 的配置', () => {
    const capture = rebuildHarness()
    capture.el._scheduleRebuild()
    vi.advanceTimersByTime(30)
    expect(capture.value.autosave).toEqual({ enabled: false, delay: 220 })
    capture.el.remove()
  })

  it('DOM 上的声明式标量优先于运行时值', () => {
    const capture = rebuildHarness({ 'autosave-delay': '500' })
    capture.el._scheduleRebuild()
    vi.advanceTimersByTime(30)
    expect(capture.value.autosave).toEqual({ enabled: false, delay: 500 })
    capture.el.remove()
  })

  it('整段 autosave 属性变更 / 移除时以 DOM 为准，不带上旧实例的运行时值', () => {
    const capture = rebuildHarness()
    capture.el.setAttribute('autosave', '{"enabled":true,"delay":900}')
    vi.advanceTimersByTime(30)
    expect(capture.value.autosave).toBeUndefined()

    capture.el.document = {
      getAutoSave: () => ({ enabled: true, delay: 900, effective: true }),
      getJSON: () => ({ type: 'doc', content: [] }),
      getTitle: () => '标题',
      options: {},
      destroy() {},
    }
    capture.el.removeAttribute('autosave')
    vi.advanceTimersByTime(30)
    expect(capture.value.autosave).toBeUndefined()
    capture.el.remove()
  })

  it('宿主用 el.options 显式给 autosave 时不注入保留值，由 property 生效', () => {
    const capture = rebuildHarness()
    capture.el.__options = { autosave: { enabled: true, delay: 10 } }
    capture.el._scheduleRebuild()
    vi.advanceTimersByTime(30)
    expect(capture.value.autosave).toBeUndefined()
    capture.el.remove()
  })
})

describe('T092 persistence operation ownership', () => {
  function deferred() {
    let resolve
    const promise = new Promise(done => { resolve = done })
    return { promise, resolve }
  }
  const draft = (title, text) => ({ title, schemaVersion: 3, json: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } })
  async function withOwner(run, adapterA) {
    const createRange = document.createRange.bind(document)
    vi.spyOn(document, 'createRange').mockImplementation(() => Object.assign(createRange(), {
      getClientRects: () => [], getBoundingClientRect: () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
    }))
    // Observe the real lifecycle Promise, including its continuation after load.
    const probe = createWorkspaceController({ state: createWorkspaceState({}) }); controllers.push(probe)
    const ready = vi.spyOn(Object.getPrototypeOf(probe), 'onReady')
    const sessions = []
    const sessionFor = (documentId, user, persistence) => {
      const session = createDocumentSession({ documentId, user: { id: user }, persistence })
      sessions.push(session); return session
    }
    const sessionA = sessionFor('autosave-owner-a', 'actor-A', adapterA)
    const element = document.createElement('div'); document.body.append(element)
    const doc = new LarkDoc({ element, storage: 'none', session: sessionA, persistence: adapterA,
      content: '<p>A seed</p>', title: 'A seed title', autosave: { enabled: false } })
    try {
      await vi.waitFor(() => expect(ready).toHaveBeenCalledOnce())
      const controller = doc._handle.workspaceController, initialReady = ready.mock.results[0].value
      expect(doc.getEditor()).toBeTruthy()
      return await run({ doc, controller, initialReady, sessionA, sessionFor })
    } finally { doc.destroy(); await Promise.all(sessions.map(session => session.dispose())); element.remove() }
  }

  it.each(['actor', 'session-document', 'provider', 'config'])('does not restore A load into current B content/title after %s changes, and reads the current provider next', async reason => {
    const loadA = deferred(), adapterA = hostAdapter(), adapterB = hostAdapter()
    adapterA.load.mockReturnValueOnce(loadA.promise)
    await withOwner(async ({ doc, controller, initialReady, sessionA, sessionFor }) => {
      expect(adapterA.load).toHaveBeenCalledOnce()
      if (reason === 'actor') sessionA.user = { id: 'actor-B' }
      if (reason === 'session-document') expect(doc.patchProps({ session: sessionFor('autosave-owner-b', 'actor-B', adapterB), documentId: 'autosave-owner-b' })).toBe(true)
      if (reason === 'provider') sessionA.setProvider('persistence', adapterB)
      if (reason === 'config') doc.patchProps({ config: { features: { persistence: false } } })
      expect(doc.getSession().can('canEdit')).toBe(true)
      doc.setContent('<p data-block-id="current_b">B current body</p>')
      doc.patchProps({ initialTitle: 'B current title' })
      const current = doc.getJSON()
      loadA.resolve(draft('Private A title', 'Private A body'))
      await initialReady
      expect(doc.getJSON()).toEqual(current)
      expect(controller.state.title).toBe('B current title')
      if (reason === 'config') doc.patchProps({ config: { features: { persistence: true } } })
      const currentAdapter = reason === 'session-document' || reason === 'provider' ? adapterB : adapterA
      currentAdapter.load.mockResolvedValue(draft('B loaded title', 'B loaded body'))
      await controller.onReady()
      expect(currentAdapter.load).toHaveBeenCalledTimes(currentAdapter === adapterA ? 2 : 1)
      expect(doc.getText()).toBe('B loaded body')
      expect(controller.state.title).toBe('B loaded title')
      await doc.save()
      expect(currentAdapter.save).toHaveBeenCalledOnce()
      expect(currentAdapter.save.mock.calls[0][0]).toMatchObject({ title: 'B loaded title', documentId: doc.getSession().documentId, json: doc.getJSON() })
    }, adapterA)
  })

  it.each(['actor', 'session-document', 'provider', 'config'])('ignores old A save ACK after %s without clearing B feedback or its new save timer, then saves B normally', async reason => {
    const saveA = deferred(), adapterA = hostAdapter(), adapterB = hostAdapter()
    adapterA.save.mockReturnValueOnce(saveA.promise)
    await withOwner(async ({ doc, controller, initialReady, sessionA, sessionFor }) => {
      await initialReady
      const receipts = vi.fn(); doc.on('save', receipts)
      const pendingA = doc.save()
      expect(adapterA.save).toHaveBeenCalledOnce()
      if (reason === 'actor') sessionA.user = { id: 'actor-B' }
      if (reason === 'session-document') doc.patchProps({ session: sessionFor('autosave-owner-b', 'actor-B', adapterB), documentId: 'autosave-owner-b' })
      if (reason === 'provider') sessionA.setProvider('persistence', adapterB)
      if (reason === 'config') {
        doc.patchProps({ config: { features: { persistence: false } } })
        doc.patchProps({ config: { features: { persistence: true } } })
      }
      expect(doc.getSession().can('canEdit')).toBe(true)
      vi.useFakeTimers()
      doc.setAutoSave({ enabled: true, delay: 60000 })
      doc.setContent('<p data-block-id="b_unsaved">B unsaved body</p>')
      doc.patchProps({ initialTitle: 'B unsaved title' })
      const timer = controller._saveTimer, status = controller.state.saveStatus, current = doc.getJSON()
      expect(timer).not.toBeNull(); expect(status).toContain('等待本地保存')
      // This ACK is local test data. The original save was already submitted.
      saveA.resolve(null); await pendingA
      expect(controller.state.saveStatus).toBe(status)
      expect(controller._saveTimer).toBe(timer)
      expect(receipts).not.toHaveBeenCalled()
      expect(doc.getJSON()).toEqual(current); expect(controller.state.title).toBe('B unsaved title')
      const currentAdapter = reason === 'session-document' || reason === 'provider' ? adapterB : adapterA
      await doc.save()
      expect(currentAdapter.save).toHaveBeenCalledTimes(currentAdapter === adapterA ? 2 : 1)
      expect(currentAdapter.save.mock.calls.at(-1)[0]).toMatchObject({ title: 'B unsaved title', documentId: doc.getSession().documentId, json: current })
      expect(controller.state.saveStatus).toContain('已保存')
      expect(receipts).toHaveBeenCalledOnce()
    }, adapterA)
  })
  it('preserves user edits during same-owner initial loading instead of restoring a late draft over them', async () => {
    const load = deferred(), adapter = hostAdapter()
    adapter.load.mockReturnValueOnce(load.promise)
    await withOwner(async ({ doc, controller, initialReady, sessionA }) => {
      expect(sessionA.can('canEdit')).toBe(true)
      expect(doc.getEditor().isEditable).toBe(true)
      doc.setContent('<p data-block-id="same_owner_edit">User current body</p>')
      doc.patchProps({ initialTitle: 'User current title' })
      const current = doc.getJSON()
      load.resolve(draft('Late stored title', 'Late stored body')); await initialReady
      expect(doc.getJSON()).toEqual(current)
      expect(controller.state.title).toBe('User current title')
    }, adapter)
  })
  it('still restores a same-owner draft when only selection/meta transactions happened during initial loading', async () => {
    const load = deferred(), adapter = hostAdapter()
    adapter.load.mockReturnValueOnce(load.promise)
    await withOwner(async ({ doc, controller, initialReady }) => {
      const editor = doc.getEditor(), initialDoc = editor.state.doc
      editor.commands.setTextSelection(3)
      editor.view.dispatch(editor.state.tr.setMeta('owner-selection-control', true).setMeta('addToHistory', false))
      expect(editor.state.doc).toBe(initialDoc)
      load.resolve(draft('Restored title', 'Restored body')); await initialReady
      expect(doc.getText()).toBe('Restored body')
      expect(controller.state.title).toBe('Restored title')
    }, adapter)
  })
  it.each(['actor', 'session-document'])('lets current B publicly save after late initial A load retires without a second onReady (%s)', async reason => {
    const load = deferred(), adapterA = hostAdapter(), adapterB = hostAdapter()
    adapterA.load.mockReturnValueOnce(load.promise)
    await withOwner(async ({ doc, controller, initialReady, sessionA, sessionFor }) => {
      if (reason === 'actor') sessionA.user = { id: 'actor-B' }
      else doc.patchProps({ session: sessionFor('autosave-owner-b', 'actor-B', adapterB), documentId: 'autosave-owner-b' })
      doc.setContent('<p data-block-id="public_b_save">B public save body</p>')
      doc.patchProps({ initialTitle: 'B public save title' })
      const current = doc.getJSON()
      load.resolve(draft('Retired A', 'Retired A body')); await initialReady
      expect(doc.getJSON()).toEqual(current)
      await doc.save()
      const adapter = reason === 'actor' ? adapterA : adapterB
      expect(adapter.save).toHaveBeenCalledOnce()
      expect(adapter.save.mock.calls[0][0]).toMatchObject({ title: 'B public save title', documentId: doc.getSession().documentId, json: current })
      expect(controller.state.initialized).toBe(true)
    }, adapterA)
  })
  it('continues autosaving current same-owner edits after rejecting the old initial draft', async () => {
    const load = deferred(), adapter = hostAdapter()
    adapter.load.mockReturnValueOnce(load.promise)
    await withOwner(async ({ doc, initialReady }) => {
      doc.setContent('<p data-block-id="same_owner_autosave">Current user body</p>')
      doc.patchProps({ initialTitle: 'Current user title' })
      const current = doc.getJSON()
      load.resolve(draft('Stored old title', 'Stored old body')); await initialReady
      expect(doc.getJSON()).toEqual(current)
      doc.setAutoSave({ enabled: true, delay: 0 })
      doc.patchProps({ initialTitle: 'Current autosaved title' })
      await vi.waitFor(() => expect(adapter.save).toHaveBeenCalledOnce())
      expect(adapter.save.mock.calls[0][0]).toMatchObject({ title: 'Current autosaved title', json: current })
    }, adapter)
  })
  it('unlocks current-owner autosaving when the old load remains unresolved after actor retirement', async () => {
    const load = deferred(), adapter = hostAdapter()
    let settled = false
    load.promise.then(() => { settled = true })
    adapter.load.mockReturnValueOnce(load.promise)
    try {
      await withOwner(async ({ doc, controller, sessionA }) => {
        sessionA.user = { id: 'actor-B' }
        await vi.waitFor(() => expect(controller.state.initialized).toBe(true))
        expect(settled).toBe(false)
        doc.setAutoSave({ enabled: true, delay: 0 })
        doc.setContent('<p data-block-id="hung_load_current">B live body</p>')
        doc.patchProps({ initialTitle: 'B live title' })
        const current = doc.getJSON()
        await vi.waitFor(() => expect(adapter.save).toHaveBeenCalledOnce())
        expect(adapter.save.mock.calls[0][0]).toMatchObject({ title: 'B live title', documentId: sessionA.documentId, json: current })
        expect(settled).toBe(false)
      }, adapter)
    } finally { load.resolve(null) }
  })
  it('unlocks autosaving after a public documentId-only patch while the old initial load stays unresolved', async () => {
    const load = deferred(), adapter = hostAdapter()
    let settled = false
    load.promise.then(() => { settled = true })
    adapter.load.mockReturnValueOnce(load.promise)
    try {
      await withOwner(async ({ doc, controller, initialReady, sessionA }) => {
        const ready = vi.spyOn(controller, 'onReady')
        expect(ready).toHaveBeenCalledOnce()
        expect(doc.patchProps({ documentId: 'autosave-public-doc-b' })).toBe(true)
        expect(doc.getSession()).toBe(sessionA)
        expect(sessionA.user.id).toBe('actor-A')
        expect(controller.props.documentId).toBe('autosave-public-doc-b')
        await vi.waitFor(() => expect(controller.state.initialized).toBe(true))
        await initialReady
        expect(settled).toBe(false)
        expect(ready).toHaveBeenCalledOnce()
        doc.setAutoSave({ enabled: true, delay: 0 })
        doc.setContent('<p data-block-id="public_doc_b">Public B document body</p>')
        doc.patchProps({ initialTitle: 'Public B document title' })
        const current = doc.getJSON()
        await vi.waitFor(() => expect(adapter.save).toHaveBeenCalledOnce())
        expect(adapter.save.mock.calls[0][0]).toMatchObject({ title: 'Public B document title', documentId: sessionA.documentId, json: current })
        expect(doc.getJSON()).toEqual(current)
        expect(settled).toBe(false)
        expect(ready).toHaveBeenCalledOnce()
      }, adapter)
    } finally { load.resolve(null) }
  })
})
