import { afterEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { createWorkspaceController, createWorkspaceState } from '../../src/workspace/WorkspaceController'
import { downloadText, htmlToMarkdown } from '../../src/utils/importExport'

vi.mock('../../src/utils/importExport', () => ({
  downloadText: vi.fn(),
  htmlToMarkdown: vi.fn(async () => 'converted markdown'),
  safeFileName: value => value,
  exportDocx: vi.fn(),
}))

const controllers = []
afterEach(() => {
  controllers.splice(0).forEach(controller => controller.dispose())
  vi.clearAllMocks()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function createHarness(overrides = {}) {
  const state = createWorkspaceState({ config: overrides.config || {}, initialContent: '<p>正文</p>', initialTitle: '文档' })
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
    chain() {
      const chain = {
        focus: () => chain,
        insertContent: () => chain,
        undo: () => chain,
        redo: () => chain,
        run: () => true,
      }
      return chain
    },
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
    dispose() {},
  }
  controllers.push(controller)
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

  it('无 Vue 命令式 API 由 controller 统一处理标题、只读、撤销与正文写入', () => {
    const { controller, state } = createHarness()
    expect(controller.getTitle()).toBe('文档')
    expect(controller.setTitle('新标题')).toBe(true)
    expect(state.title).toBe('新标题')
    expect(controller.setReadonly(true)).toBe(true)
    expect(controller.isReadonly()).toBe(true)
    expect(controller.setTitle('不应写入')).toBe(false)
    expect(state.title).toBe('新标题')
    expect(controller.setReadonly(false)).toBe(true)
    expect(controller.insertText('追加')).toBe(true)
    expect(controller.undo()).toBe(true)
    expect(controller.redo()).toBe(true)
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

  it('关闭自动保存后不调度落盘，手动保存和离开保存仍可用', async () => {
    vi.useFakeTimers()
    const { controller, state, persistence } = createHarness({ config: { autosave: { enabled: false } } })
    state.initialized = true
    const save = vi.spyOn(persistence, 'save')
    controller.queueSave()
    await vi.advanceTimersByTimeAsync(1000)
    expect(save).not.toHaveBeenCalled()
    expect(state.saveStatus).toBe('自动保存已关闭')
    await controller.save()
    expect(save).toHaveBeenCalledTimes(1)
    controller.flushOnLeave()
    expect(save).toHaveBeenCalledTimes(2)
  })

  it.each([0, 120, 900])('自动保存按配置延迟 %ims 生效', async delay => {
    vi.useFakeTimers()
    const { controller, state, persistence } = createHarness({ config: { autosave: { delay } } })
    state.initialized = true
    const save = vi.spyOn(persistence, 'save')
    controller.queueSave()
    expect(save).not.toHaveBeenCalled()
    if (delay) {
      await vi.advanceTimersByTimeAsync(delay - 1)
      expect(save).not.toHaveBeenCalled()
    }
    await vi.advanceTimersByTimeAsync(delay ? 1 : 0)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('关闭持久化总闸时，自动和手动保存均不写入', async () => {
    vi.useFakeTimers()
    const { controller, state, persistence } = createHarness({ config: { features: { persistence: false } } })
    state.initialized = true
    const save = vi.spyOn(persistence, 'save')
    controller.queueSave()
    await vi.advanceTimersByTimeAsync(1000)
    await controller.save()
    expect(save).not.toHaveBeenCalled()
  })

  it.each([
    { importExport: { importEnabled: false } },
    { importExport: { importFormats: ['json'] } },
  ])('导入独立开关和格式白名单在读取文件前阻止操作：%j', async config => {
    const { controller } = createHarness({ config })
    const file = { name: 'notes.md', size: 100, text: vi.fn(async () => { throw new Error('不应读取文件') }) }
    await controller.importDocument({ target: { files: [file], value: 'selected' } })
    expect(file.text).not.toHaveBeenCalled()
  })

  it.each([
    { importExport: { exportEnabled: false } },
    { importExport: { exportFormats: ['json'] } },
  ])('导出独立开关和格式白名单阻止禁用格式下载：%j', async config => {
    const { controller } = createHarness({ config })
    await controller.exportDocument('html')
    expect(downloadText).not.toHaveBeenCalled()
  })

  it.each(['html', 'md'])('%s 导出跟随媒体链接配置，原始编辑器 HTML 保持不变', async format => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>')
    vi.stubGlobal('document', dom.window.document)
    const raw = '<figure data-type="image"><img src="https://example.test/a.png" alt="原图"></figure>'
    const { controller } = createHarness({
      config: { media: { htmlMode: 'link', linkText: '查看图片', newTab: false } },
      host: { getHTML: () => raw },
    })
    try {
      await controller.exportDocument(format)
      expect(downloadText).toHaveBeenCalledTimes(1)
      const html = format === 'html' ? downloadText.mock.calls[0][0] : htmlToMarkdown.mock.calls[0][0]
      expect(html).not.toContain('<img')
      expect(html).toContain('<a href="https://example.test/a.png"')
      expect(html).toContain('查看图片</a>')
      expect(html).not.toContain('target="_blank"')
      expect(controller.getHTML()).toBe(raw)
    } finally { dom.window.close() }
  })
})
