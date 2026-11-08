// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWorkspaceController, createWorkspaceState } from '../../src/workspace/WorkspaceController'
import { LarkDoc } from '../../src/LarkDoc'
import { readOptionsFromElement, applyAttributeChange } from '../../src/web-component/attributes'
import { LarkDocElement } from '../../src/web-component/LarkDocElement'

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
