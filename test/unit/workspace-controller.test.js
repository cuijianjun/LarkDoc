import { afterEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { getSchema } from '@tiptap/core'
import { createWorkspaceController, createWorkspaceState } from '../../src/workspace/WorkspaceController'
import { createLarkDocExtensions } from '../../src/components/lark-doc/extensions'
import { downloadText, htmlToMarkdown, exportDocx as legacyExportDocx } from '../../src/utils/importExport'
import { exportDocx as richExportDocx } from '../../src/utils/export'

vi.mock('../../src/utils/export', () => ({ exportDocx: vi.fn(async () => ({ failedImages: [] })) }))

vi.mock('../../src/utils/importExport', () => ({
  downloadText: vi.fn(),
  htmlToMarkdown: vi.fn(async () => 'converted markdown'),
  safeFileName: value => value,
  exportDocx: vi.fn(),
}))

const controllers = []
const importSchema = getSchema(createLarkDocExtensions())
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
  return { controller, state, persistence, events, editor }
}

describe('工作区 Word 下载闭环', () => {
  const content = () => ({ type: 'doc', content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '格式标题', marks: [{ type: 'bold' }] }] },
    { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '表格单元格' }] }] }] }] },
  ] })
  it('下载既有结构导出器的真实正文、标题和表格，正文不被修改', async () => {
    const doc = content(), before = JSON.stringify(doc)
    const { controller, state } = createHarness({ host: { getJSON: () => doc } })
    await controller.exportDocument('docx')
    expect(richExportDocx).toHaveBeenCalledWith(doc, { fileName: '文档', title: '文档', scope: 'contentOnly', images: {}, shouldDownload: expect.any(Function) })
    expect(legacyExportDocx).not.toHaveBeenCalled()
    expect(JSON.stringify(doc)).toBe(before)
    expect(state.notice).not.toContain('纯文本')
  })
  it.each(['canView', 'canExport'])('缺少%s时不读取图片或下载Word', async denied => {
    const fetchImage = vi.fn()
    const { controller, state } = createHarness({ host: { getJSON: content, getWindow: () => ({ fetch: fetchImage }) } })
    state.sessionInstance.can = permission => permission !== denied
    await controller.exportDocument('docx')
    expect(fetchImage).not.toHaveBeenCalled()
    expect(richExportDocx).not.toHaveBeenCalled()
    expect(legacyExportDocx).not.toHaveBeenCalled()
  })
  it.each(['offline', 'allowlist'])('%s模式不会隐式读取被拒绝的外部图片', async mode => {
    const fetchImage = vi.fn(), doc = content()
    doc.content.push({ type: 'image', attrs: { src: 'https://denied.example.test/image.png' } })
    const { controller, state } = createHarness({ config: { network: { mode, allowlist: ['allowed.example.test'] } }, host: { getJSON: () => doc, getWindow: () => ({ fetch: fetchImage }) } })
    await controller.exportDocument('docx')
    expect(fetchImage).not.toHaveBeenCalled()
    expect(richExportDocx).toHaveBeenCalledWith(doc, expect.objectContaining({ images: {} }))
    expect(state.notice).toContain('1 张图片')
  })
  it('允许的图片去重读取并禁止跳转，字节显式交给结构导出器', async () => {
    const src = 'https://allowed.example.test/image.png', doc = content()
    doc.content.push(...Array.from({ length: 2 }, () => ({ type: 'image', attrs: { src } })))
    const fetchImage = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }))
    const { controller } = createHarness({ config: { network: { mode: 'allowlist', allowlist: ['allowed.example.test'] } }, host: { getJSON: () => doc, getWindow: () => ({ fetch: fetchImage }) } })
    await controller.exportDocument('docx')
    expect(fetchImage).toHaveBeenCalledExactlyOnceWith(src, { credentials: 'same-origin', redirect: 'error' })
    expect(richExportDocx.mock.calls[0][1].images[src]).toEqual(new Uint8Array([1, 2, 3]))
  })
  it('读取图片等待期间撤销导出权限，不开始打包下载', async () => {
    let finish, canExport = true
    const doc = content()
    doc.content.push({ type: 'image', attrs: { src: 'https://allowed.example.test/image.png' } })
    const fetchImage = vi.fn(() => new Promise(resolve => { finish = resolve }))
    const { controller, state } = createHarness({ host: { getJSON: () => doc, getWindow: () => ({ fetch: fetchImage }) } })
    state.sessionInstance.can = permission => permission !== 'canExport' || canExport
    const job = controller.exportDocument('docx')
    await vi.waitFor(() => expect(fetchImage).toHaveBeenCalledOnce())
    canExport = false
    finish({ ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer })
    await job
    expect(richExportDocx).not.toHaveBeenCalled()
  })
  it('打包失败显示错误，原正文和格式都保留', async () => {
    const doc = content(), before = JSON.stringify(doc)
    richExportDocx.mockRejectedValueOnce(new Error('打包失败核验'))
    const { controller, state } = createHarness({ host: { getJSON: () => doc } })
    await controller.exportDocument('docx')
    expect(state.notice).toContain('打包失败核验')
    expect(JSON.stringify(doc)).toBe(before)
  })
})

describe('WorkspaceController 阶段7主壳前置', () => {
  it.each(['readonly', 'feature', 'network', 'provider', 'document', 'session'])('图片问答在 %s 改变时中止且清除引用', kind => {
    let writable = true
    const { controller, state } = createHarness({ host: { writable: () => writable }, props: { aiProvider: { supportsImages: true, stream() {} } } })
    const image = { pos: 2, blockId: 'image-ai', src: '/image.png' }
    controller.getEditor().state.doc.nodeAt = () => ({ type: { name: 'image' }, attrs: image })
    controller.openImageAI(image)
    state.aiMessages = [{ role: 'user', text: 'private image question' }, { role: 'assistant', text: 'private image answer' }]
    state.aiPrompt = 'private draft'
    state.aiPreview = 'private image answer'
    const cancel = vi.fn()
    controller._aiStream = { cancel }
    if (kind === 'readonly') writable = false
    if (kind === 'feature') state.editorConfig.features.ai = false
    if (kind === 'network') state.editorConfig.network = { mode: 'offline' }
    if (kind === 'provider') controller.props.aiProvider = { supportsImages: true, stream() {} }
    if (kind === 'document') controller.props.documentId = 'other-doc'
    if (kind === 'session') state.sessionInstance = { dispose() {} }
    controller.syncImageAI()
    expect(cancel).toHaveBeenCalledOnce()
    expect(state.aiOpen).toBe(false)
    expect(state.aiImage).toBeNull()
    expect(state.aiMessages).toEqual([])
    expect(state.aiPrompt).toBe('')
    expect(state.aiPreview).toBe('')
  })

  it('图片问答先附引用，空问题不请求；发送可见图片并隔离关闭后的旧流', async () => {
    const stream = vi.fn(() => ({ cancel: vi.fn() }))
    const image = { pos: 2, blockId: 'image-ai', src: 'data:image/png;base64,YQ==', crop: null }
    const { controller, state } = createHarness({ props: { aiProvider: { supportsImages: true, stream } } })
    controller.getEditor().state.doc.nodeAt = () => ({ type: { name: 'image' }, attrs: image })
    expect(controller.openImageAI(image)).toBe(true)
    expect(state.aiImage).toMatchObject({ blockId: 'image-ai' })
    expect(state.aiOpen).toBe(true)
    expect(stream).not.toHaveBeenCalled()
    await controller.sendAIChat()
    expect(stream).not.toHaveBeenCalled()
    controller.prepareAIImage = vi.fn(async () => ({ url: 'data:image/png;base64,Yg==', blockId: 'image-ai' }))
    state.aiPrompt = '这是什么？'
    await controller.sendAIChat()
    expect(stream).toHaveBeenCalledOnce()
    const request = stream.mock.calls[0][0]
    expect(request.images).toEqual([{ url: 'data:image/png;base64,Yg==', blockId: 'image-ai' }])
    expect(request.text).toBe('')
    expect(request.prompt).toBe('这是什么？')
    controller.closeAI()
    request.onChunk('旧回复')
    request.onDone()
    expect(state.aiPreview).toBe('')
    expect(state.aiImage).toBeNull()
  })

  it('无识图能力不发请求，准备途中关闭也不能泄漏图片到服务', async () => {
    const stream = vi.fn()
    const image = { pos: 2, blockId: 'image-ai', src: 'data:image/png;base64,YQ==' }
    const { controller, state } = createHarness({ props: { aiProvider: { stream } } })
    controller.getEditor().state.doc.nodeAt = () => ({ type: { name: 'image' }, attrs: image })
    controller.openImageAI(image)
    state.aiPrompt = '描述图片'
    await controller.sendAIChat()
    expect(stream).not.toHaveBeenCalled()
    expect(state.aiError).toContain('图片')
    controller.props.aiProvider = { supportsImages: true, stream }
    controller.openImageAI(image)
    let finish
    controller.prepareAIImage = () => new Promise(resolve => { finish = resolve })
    state.aiPrompt = '描述图片'
    const sending = controller.sendAIChat()
    controller.closeAI()
    finish({ url: 'data:image/png;base64,Yg==' })
    await sending
    expect(stream).not.toHaveBeenCalled()
    expect(state.aiRunning).toBe(false)
  })

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

  it('读取文件期间的临时 busy 锁不会把导入误判为只读', async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>')
    vi.stubGlobal('document', dom.window.document)
    const { controller, state, editor } = createHarness({
      host: {
        getEditor: () => editor,
        writable: () => !state.importing,
        setContent: vi.fn(),
      },
    })
    editor.schema = importSchema
    Object.defineProperty(editor, 'isEditable', {
      configurable: true,
      get: () => !state.importing,
    })
    const file = {
      name: 'notes.html',
      size: 100,
      text: vi.fn(async () => '<h1>导入标题</h1><p>导入正文</p>'),
    }

    await controller.importDocument({ target: { files: [file], value: 'selected' } })

    expect(file.text).toHaveBeenCalledOnce()
    expect(controller.host.setContent).toHaveBeenCalledOnce()
    expect(state.notice).toBe('导入完成')
    expect(state.importing).toBe(false)
    dom.window.close()
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


describe('最终补全：问答endpoint网络边界', () => {
  it.each(['offline', 'allowlist'])('%s下协议相对地址与反斜杠伪本地地址不能发送选区', mode => {
    for (const endpoint of ['//denied.example/ai', '/' + String.fromCharCode(92) + 'denied.example/ai']) {
      const { controller } = createHarness({ config: { network: { mode, allowlist: [] } }, props: { aiProvider: { endpoint } } })
      expect(controller.getAIChatAdapter()).toBeNull()
    }
  })
  it('合法同源API在本地网络策略下仍可配置', () => {
    const { controller } = createHarness({ config: { network: { mode: 'offline' } }, props: { aiProvider: { endpoint: '/api/ai' } } })
    expect(controller.getAIChatAdapter()?.endpoint).toBe('/api/ai')
  })
})
