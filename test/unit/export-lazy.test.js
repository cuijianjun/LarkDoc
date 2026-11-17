// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { DocumentSession } from '../../src/session/DocumentSession'
import { createMemoryCommentsProvider } from '../../src/core/comments/memory-provider'

let exportLoads, loadExport, exportMarkdown, exportDocx, exportPdf
const hosts = []
const nativeHosts = []

function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

async function exporterModule() {
  // Keep the real comment projection and print path; only file-producing endpoints are spies.
  const actual = await vi.importActual('../../src/utils/export/index.js')
  exportPdf.mockImplementation(actual.exportPdf)
  return { ...actual, exportMarkdown, exportDocx, exportPdf }
}

async function createHost(overrides = {}) {
  const { default: mixin } = await import('../../src/components/lark-doc/editor/exportMixin.js')
  const root = document.createElement('div')
  root.className = 'lark-doc'
  const element = document.createElement('div')
  element.className = 'lark-doc-editor'
  root.append(element)
  document.body.append(root)
  const editor = new Editor({ element, extensions: [Document, Paragraph, Text], content: '<p>固定来源正文</p>' })
  const session = new DocumentSession({ documentId: 'doc-export', user: { id: 'alice', name: 'Alice' }, capabilities: { canView: true, canExport: true } })
  const host = { ...mixin.data(), ...mixin.methods, editor, session, documentId: 'doc-export', title: '周报', $refs: { root }, ...overrides }
  for (const [key, getter] of Object.entries(mixin.computed)) {
    Object.defineProperty(host, key, { get: () => getter.call(host) })
  }
  hosts.push({ host, editor, session })
  return host
}

async function addComments(host) {
  const provider = createMemoryCommentsProvider({ now: () => 1234 })
  await provider.createThread({ blockId: 'body', quote: '固定来源正文', author: { id: 'alice', name: 'Alice' }, content: '真实评论内容' })
  host.session.setProvider('comments', provider)
  return host.session.getProvider('comments')
}

beforeEach(() => {
  vi.resetModules()
  exportLoads = 0
  exportMarkdown = vi.fn()
  exportDocx = vi.fn()
  exportPdf = vi.fn()
  loadExport = exporterModule
  vi.doMock('../../src/utils/export/index.js', () => {
    exportLoads += 1
    return loadExport()
  })
})

afterEach(async () => {
  window.dispatchEvent(new window.Event('afterprint'))
  nativeHosts.splice(0).forEach(runtime => runtime.destroy())
  for (const { host, editor, session } of hosts.splice(0)) {
    host.invalidateExportContext()
    editor.destroy()
    await session.dispose()
  }
  document.body.replaceChildren()
  vi.doUnmock('../../src/utils/export/index.js')
  vi.doUnmock('../../src/utils/download')
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('exportMixin 按需加载与固定来源', () => {
  it.each([false, true])('default-session native Markdown source characterization (Y.Doc=%s)', async collaborative => {
    // JSDOM has no Range layout API; this source-path check makes no geometry assertions.
    const createRange = document.createRange.bind(document)
    vi.spyOn(document, 'createRange').mockImplementation(() => Object.assign(createRange(), {
      getClientRects: () => [],
      getBoundingClientRect: () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 }),
    }))
    const { LarkDoc } = await import('../../src/LarkDoc')
    const { Yjs, createCollabExtensions, isRemoteTransaction } = await import('../../src/collab')
    const ydoc = collaborative ? new Yjs.Doc({ gc: false }) : null
    const element = document.createElement('div'); document.body.appendChild(element)
    const content = '<p data-block-id="qa_export_source">QA模板库前正文</p>'
    const doc = new LarkDoc({ element, storage: 'none', documentId: 'qa-export-source', user: { id: 'qa-export-user', name: 'QA export' },
      content, collab: ydoc ? { extensions: createCollabExtensions({ ydoc }), isRemoteTransaction } : undefined,
      config: { network: { mode: 'offline' }, importExport: { exportFormats: ['md', 'docx', 'print'] } } })
    const host = doc._handle.nativeHost.host, editor = doc.getEditor(), events = [], contexts = [], stops = []
    const transaction = ({ transaction: tr }) => events.push({ source: 'pm', docChanged: tr.docChanged, steps: tr.steps.length })
    try {
      doc.setContent(content)
      await host.$nextTick()
      await vi.waitFor(() => expect(doc.getText()).toBe('QA模板库前正文'))
      expect(host.session.user).toBeNull()
      expect(host.exportCanExport).toBe(true)
      expect(host.remoteExportProvider()).toBeNull()
      const before = doc.getJSON(), source = editor.state.doc
      editor.on('transaction', transaction)
      for (const name of ['capabilities', 'provider-changed', 'identity', 'comments-reset']) {
        const off = host.session.on(name, () => events.push({ source: 'session', name }))
        if (typeof off === 'function') stops.push(off)
      }
      const create = host.createExportContext
      vi.spyOn(host, 'createExportContext').mockImplementation((...args) => {
        const context = create(...args)
        contexts.push({ present: !!context, initiallyCurrent: context?.current?.() === true, originalPMDoc: editor.state.doc === source })
        return context
      })
      exportMarkdown.mockResolvedValue({ fileName: 'qa-export-source.md' })
      host.openExportFormatPicker()
      await host.$nextTick()
      const markdown = element.querySelector('[data-export-format="markdown"]')
      expect(markdown).not.toBeNull(); markdown.click()
      await host.$nextTick()
      expect(host.exportRoute).toBe('local'); expect(host.exportScopeValue).toBe('textOnly')
      const submit = element.querySelector('.lark-doc-export-submit')
      expect(submit?.disabled).toBe(false); submit.click()
      await vi.waitFor(() => expect(exportMarkdown).toHaveBeenCalledOnce())
      await vi.waitFor(() => expect(host.exportBusy).toBe(false))
      expect(contexts).toEqual([{ present: true, initiallyCurrent: true, originalPMDoc: true }])
      expect(exportMarkdown).toHaveBeenCalledWith(before, expect.objectContaining({ scope: 'textOnly', shouldDownload: expect.any(Function) }))
      expect(host.error).toBe(''); expect(host._exportContext).toBeNull()
      expect(editor.state.doc).toBe(source); expect(doc.getJSON()).toEqual(before)
      expect(events).toEqual([])
      console.info('SOURCE_EXPORT_CHARACTERIZATION', JSON.stringify({ collaborative, contexts, events, exportLoads, exportCalls: exportMarkdown.mock.calls.length,
        sessionUser: host.session.user, fileProducingEndpointIsSpy: true, browserDownloadReceiptVerified: false }))
    } finally {
      stops.forEach(stop => stop()); editor.off('transaction', transaction)
      doc.destroy(); element.remove(); ydoc?.destroy()
    }
  })

  it('private source factory preserves lazy namespace results and the original loader error', async () => {
    const { createExportInteraction } = await import('../../src/components/lark-doc/editor/exportInteraction')
    const { EXPORT_FORMATS, EXPORT_TOAST_TEXT } = await import('../../src/components/lark-doc/editor/exportMixin')
    const { isExportEnabled } = await import('../../src/components/lark-doc/larkDocConfig')
    const { evaluateOutputPolicy, createOutputAuditEvent } = await import('../../src/core/policy/output')
    const gate = deferred(), local = vi.fn(() => gate.promise), remote = vi.fn()
    const methods = createExportInteraction({ EXPORT_FORMATS, EXPORT_TOAST_TEXT, isExportEnabled, evaluateOutputPolicy, createOutputAuditEvent,
      loadExportModule: local, loadRemoteConversionModule: remote }).methods
    const host = await createHost()
    Object.assign(host, methods)
    host.openExportDialog('markdown'); host.selectExportScope('all'); host.cancelExport()
    expect(local).not.toHaveBeenCalled(); expect(remote).not.toHaveBeenCalled()
    const source = host.editor.getJSON(), expected = { fileName: 'original-namespace.md' }
    const namespace = { exportMarkdown: vi.fn(async () => expected) }
    const pending = host.dispatchMarkdown('all', 'original-namespace')
    expect(pending).toBeInstanceOf(Promise)
    expect(local).toHaveBeenCalledOnce(); expect(namespace.exportMarkdown).not.toHaveBeenCalled()
    gate.resolve(namespace)
    expect(await pending).toBe(expected)
    expect(namespace.exportMarkdown).toHaveBeenCalledWith(source, expect.objectContaining({ fileName: 'original-namespace', scope: 'all', shouldDownload: expect.any(Function) }))
    const failure = new Error('original import rejection')
    local.mockRejectedValueOnce(failure)
    await expect(host.dispatchMarkdown('all', 'original-error')).rejects.toBe(failure)
    expect(remote).not.toHaveBeenCalled()
    expect(host.editor.getJSON()).toEqual(source)
  })

  it('real complete UI graph keeps export implementation loaders and PM in the original host', async () => {
    const { rollup } = await import('rollup')
    const { getRollupConfig } = await import('../../rollup.config.mjs')
    const config = getRollupConfig('feature:ui:umd')
    const { output, ...input } = config
    const bundle = await rollup(input)
    try {
      const generated = await bundle.generate({ ...output, plugins: [] })
      const modules = generated.output.filter(item => item.type === 'chunk').flatMap(chunk => Object.keys(chunk.modules))
      expect(modules.some(id => id.endsWith('/src/components/lark-doc/editor/exportInteraction.js'))).toBe(true)
      expect(modules.filter(id => /node_modules\/(?:@tiptap|prosemirror-)/.test(id))).toEqual([])
      expect(modules.some(id => id.endsWith('/src/components/lark-doc/editor/exportMixin.js'))).toBe(false)
      expect(modules.some(id => id.endsWith('/src/utils/export/index.js') || id.endsWith('/src/utils/remoteConversion.js'))).toBe(false)
    } finally { await bundle.close() }
  }, 30000)

  it('真实 native host、Editor 与 Session 能建立并提交固定来源 Word 导出', async () => {
    const fixture = await createHost()
    const { createNativeEditorHost } = await import('../../src/editor/nativeEditorHost')
    const { createWorkspaceState } = await import('../../src/workspace/WorkspaceController')
    const runtime = createNativeEditorHost({
      shell: { root: fixture.$refs.root, editorEl: fixture.editor.view.dom, paper: fixture.$refs.root },
      props: { documentId: 'doc-export' },
      state: { ...createWorkspaceState({ initialContent: '<p>固定来源正文</p>', initialTitle: '周报' }),
        editor: fixture.editor, sessionInstance: fixture.session },
      resolveImageFile: { cancelAll: vi.fn() },
    })
    nativeHosts.push(runtime)
    const host = runtime.host, source = fixture.editor.state.doc
    expect(host.editor).toBe(fixture.editor)
    expect(host.session).toBe(fixture.session)
    const context = host.createExportContext('word', 'contentOnly')
    expect(context).not.toBeNull()
    expect(context.current()).toBe(true)
    host.invalidateExportContext()
    host.openExportDialog('word')
    expect(host.exportOpen).toBe(true)
    await host.submitExport()
    expect(exportDocx).toHaveBeenCalledExactlyOnceWith(fixture.editor.getJSON(), expect.objectContaining({ scope: 'contentOnly', shouldDownload: expect.any(Function) }))
    expect(host.error).toBe('')
    expect(host.exportBusy).toBe(false)
    expect(host.exportToast).toBe('')
    expect(fixture.editor.state.doc).toBe(source)
  })

  it('真实 native host 格式浮层点击链在模块与 Word 导出等待期间保留有效来源', async () => {
    const fixture = await createHost()
    const { createNativeEditorHost } = await import('../../src/editor/nativeEditorHost')
    const { createWorkspaceState } = await import('../../src/workspace/WorkspaceController')
    const { createWorkspaceShell } = await import('../../src/ui/workspaceShell')
    const shell = createWorkspaceShell(document)
    document.body.appendChild(shell.root)
    shell.editorEl.appendChild(fixture.editor.view.dom)
    const runtime = createNativeEditorHost({ shell, props: { documentId: 'doc-export' },
      state: { ...createWorkspaceState({ initialContent: '<p>固定来源正文</p>', initialTitle: '周报' }), editor: fixture.editor, sessionInstance: fixture.session },
      resolveImageFile: { cancelAll: vi.fn() } })
    nativeHosts.push(runtime)
    const host = runtime.host, source = fixture.editor.state.doc
    const moduleGate = deferred(), exportGate = deferred()
    loadExport = () => moduleGate.promise
    let guard
    exportDocx.mockImplementation((_doc, options) => { guard = options.shouldDownload; return exportGate.promise })
    const tap = node => {
      for (const type of ['pointerdown', 'pointerup']) {
        const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 })
        Object.defineProperties(event, { pointerType: { value: 'touch' }, pointerId: { value: 1 } })
        node.dispatchEvent(event)
      }
      const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 })
      node.dispatchEvent(down)
      if (!down.defaultPrevented) node.focus()
      node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }))
      node.click()
    }
    const submitCall = vi.spyOn(host, 'submitExport'), cancelCall = vi.spyOn(host, 'cancelExport')
    host.mountOverlays()
    host.openExportFormatPicker()
    await host.$nextTick()
    const word = shell.root.querySelector('[data-export-format="word"]')
    expect(word).not.toBeNull()
    tap(word)
    await host.$nextTick()
    expect(host.exportFormat).toBe('word')
    expect(host.exportScopeValue).toBe('contentOnly')
    const submit = shell.root.querySelector('.lark-doc-export-submit')
    expect(submit.disabled).toBe(false)
    tap(submit)
    expect(submitCall).toHaveBeenCalledTimes(1)
    expect(cancelCall).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(exportLoads).toBe(1))
    expect(host.exportOpen).toBe(false)
    expect(host.exportBusy).toBe(true)
    expect(host._exportContext?.current()).toBe(true)
    moduleGate.resolve(await exporterModule())
    await vi.waitFor(() => expect(exportDocx).toHaveBeenCalledTimes(1))
    await host.$nextTick()
    expect(guard()).toBe(true)
    expect(host.error).toBe('')
    expect(host.exportToast).toBe('正在导出文档')
    exportGate.resolve({ fileName: '周报.docx' })
    await vi.waitFor(() => expect(host.exportBusy).toBe(false))
    expect(host.exportToast).toBe('')
    expect(fixture.editor.state.doc).toBe(source)
  })

  it('初始化、格式选择页、打开、切换与取消均不加载统一出口', async () => {
    const host = await createHost({ localTitle: '  ..周报 / 草稿  ' })
    const original = host.editor.state.doc
    expect(host.exportFileBaseName).toBe('周报 - 草稿')
    host.openExportFormatPicker()
    expect(host.exportPanelTitle).toBe('下载为')
    expect(host.exportFormat).toBe('')
    for (const [format, title, scope] of [['markdown', 'Markdown', 'textOnly'], ['word', 'Word', 'contentOnly'], ['pdf', 'PDF', 'contentOnly']]) {
      host.openExportDialog(format)
      expect(host.exportPanelTitle).toBe(`导出 ${title} 设置`)
      expect(host.exportScopeValue).toBe(scope)
      host.selectExportScope('withComments')
      host.cancelExport()
    }
    expect(host.editor.state.doc).toBe(original)
    expect(host.exportOpen).toBe(false)
    expect(exportLoads).toBe(0)
  })

  it.each(['canView', 'canExport'])('%s 被撤销时不打开或加载导出', async capability => {
    const host = await createHost()
    host.session._capabilities[capability] = false
    host.openExportFormatPicker()
    expect(host.exportOpen).toBe(false)
    host.exportFormat = 'markdown'
    await host.submitExport()
    expect(exportLoads).toBe(0)
  })

  it.each([['pdf', 'canPrint', 'print'], ['word', 'canDownload', 'download']])('%s 输出策略拒绝留下真实审计且不加载', async (format, policyKey, action) => {
    const host = await createHost()
    host.session.providers.security = { policy: { [policyKey]: false, denyReason: '当前策略禁止输出' } }
    host.openExportDialog(format)
    await host.submitExport()
    expect(host.error).toBe('当前策略禁止输出')
    expect(host.outputAuditEvents).toEqual([expect.objectContaining({ action, result: 'denied', reason: '当前策略禁止输出', source: 'output-policy', docId: 'doc-export', actorId: 'alice' })])
    expect(exportLoads).toBe(0)
    expect(host.exportBusy).toBe(false)
  })

  it('忙碌和未知格式不加载统一出口', async () => {
    const host = await createHost({ exportFormat: 'word', exportBusy: true })
    await host.submitExport()
    host.exportBusy = false
    host.exportFormat = 'unknown'
    await host.submitExport()
    await expect(host.dispatchExport('unknown', '', '')).resolves.toBeNull()
    expect(exportLoads).toBe(0)
  })

  it.each(['markdown', 'word', 'pdf'])('%s 无文档时返回 Promise<null> 且不加载', async format => {
    const host = await createHost({ editor: null })
    await expect(host.dispatchExport(format, 'contentOnly', '周报')).resolves.toBeNull()
    expect(exportLoads).toBe(0)
  })

  it.each(['markdown', 'word'])('%s 派发时才加载并保留稳定文档、参数和返回值', async format => {
    const gate = deferred()
    loadExport = () => gate.promise
    const host = await createHost()
    if (format === 'word') await addComments(host)
    const source = host.editor.getJSON(), sourceNode = host.editor.state.doc
    const scope = format === 'markdown' ? 'all' : 'withComments'
    const result = { fileName: format === 'markdown' ? '周报.md' : '周报.docx' }
    const exporter = format === 'markdown' ? exportMarkdown : exportDocx
    exporter.mockResolvedValue(result)
    const pending = host.dispatchExport(format, scope, '周报')
    await vi.waitFor(() => expect(exportLoads).toBe(1))
    expect(exporter).not.toHaveBeenCalled()
    expect(host.editor.state.doc).toBe(sourceNode)
    gate.resolve(await exporterModule())
    await expect(pending).resolves.toBe(result)
    expect(exporter).toHaveBeenCalledExactlyOnceWith(source, expect.objectContaining({ fileName: '周报', scope, shouldDownload: expect.any(Function) }))
    if (format === 'word') {
      expect(exporter.mock.calls[0][1].comments).toEqual([{
        author: { id: 'alice', name: 'Alice' }, quote: '固定来源正文', resolved: false,
        replies: [{ author: { id: 'alice', name: 'Alice' }, content: '真实评论内容', createdAt: 1234, attachments: [] }],
      }])
    }
    expect(format === 'markdown' ? exportDocx : exportMarkdown).not.toHaveBeenCalled()
  })

  it.each([
    ['正文事务', host => host.editor.commands.insertContent('新增')],
    ['文档标识', host => { host.documentId = 'other-doc' }],
    ['查看权限', host => { host.session._capabilities.canView = false }],
    ['导出权限', host => { host.session._capabilities.canExport = false }],
    ['动态输出策略', host => { host.session.providers.security.policy.canDownload = false }],
    ['同对象用户 id', host => { host.session.user.id = 'bob' }],
    ['替换同会话用户', host => { host.session.user = { id: 'bob' } }],
    ['身份代际', host => { host.session._identityGeneration += 1 }],
    ['私有身份代际', host => { host.session._privateIdentityGeneration += 1 }],
    ['授权代际', host => { host.session._authorizationGeneration += 1 }],
  ])('加载期间%s变化即使会话仍存在也禁止输出', async (_label, change) => {
    const gate = deferred()
    loadExport = () => gate.promise
    const host = await createHost()
    host.session.providers.security = { policy: { canDownload: true } }
    host.openExportDialog('word')
    const pending = host.submitExport()
    await vi.waitFor(() => expect(exportLoads).toBe(1))
    change(host)
    gate.resolve(await exporterModule())
    await expect(pending).resolves.toBeUndefined()
    expect(exportDocx).not.toHaveBeenCalled()
    expect(host.exportBusy).toBe(false)
    expect(host.exportToast).toBe('')
  })

  it('身份 Provider 读回另一 principal 时禁止旧 pending 输出', async () => {
    const gate = deferred()
    loadExport = () => gate.promise
    const host = await createHost()
    let state = { status: 'authenticated', principalId: 'alice', generation: 0, canCreate: false, expiresInMs: 4000 }
    host.session.setProvider('identity', {
      getState: () => ({ ...state }), getCsrfToken: () => null, subscribe: () => () => {},
      login: vi.fn(), queryLogin: vi.fn(), refresh: vi.fn(), logout: vi.fn(), dispose: vi.fn(),
    })
    host.session._capabilities = { ...host.session.getCapabilities(), canView: true, canExport: true }
    expect(host.session.can('canExport')).toBe(true)
    host.openExportDialog('word')
    const pending = host.submitExport()
    await vi.waitFor(() => expect(exportLoads).toBe(1))
    state = { ...state, principalId: 'bob' }
    gate.resolve(await exporterModule())
    await pending
    expect(exportDocx).not.toHaveBeenCalled()
    expect(host.exportBusy).toBe(false)
    expect(host.exportToast).toBe('')
  })

  it.each(['comments-reset', 'provider-changed'])('%s 真实会话事件立即作废待返回评论', async event => {
    const host = await createHost()
    const provider = await addComments(host)
    const gate = deferred(), realList = provider.list.bind(provider)
    vi.spyOn(provider, 'list').mockImplementation(async input => {
      const rows = await realList(input)
      await gate.promise
      return rows
    })
    host.openExportDialog('word')
    host.selectExportScope('withComments')
    const pending = host.submitExport()
    expect(host.exportBusy).toBe(true)
    if (event === 'provider-changed') host.session.setProvider('comments', createMemoryCommentsProvider())
    else {
      // DocumentSession increments this generation before broadcasting comments-reset.
      host.session._commentGeneration += 1
      host.session.emit('comments-reset', 'identity-changed')
    }
    const busyAfterEvent = host.exportBusy
    gate.resolve()
    await pending
    expect(busyAfterEvent).toBe(false)
    expect(exportLoads).toBe(0)
    expect(exportDocx).not.toHaveBeenCalled()
    expect(host.exportToast).toBe('')
  })

  it.each(['word', 'pdf'])('%s 缺评论服务时明确失败且不伪造包含评论', async format => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    const host = await createHost()
    host.openExportDialog(format)
    host.selectExportScope('withComments')
    await expect(host.submitExport()).resolves.toBeUndefined()
    expect(host.error).toBe('导出失败：尚未配置评论服务，无法导出正文及评论')
    expect(exportLoads).toBe(0)
    expect(print).not.toHaveBeenCalled()
    expect(host.exportBusy).toBe(false)
    expect(host.exportToast).toBe('')
  })

  it('真实评论服务读取失败转为 UI 错误且不加载出口', async () => {
    const host = await createHost(), provider = await addComments(host)
    vi.spyOn(provider, 'list').mockRejectedValue(new Error('评论读取失败'))
    host.openExportDialog('word')
    host.selectExportScope('withComments')
    await host.submitExport()
    expect(host.error).toBe('导出失败：评论读取失败')
    expect(exportLoads).toBe(0)
    expect(host.exportBusy).toBe(false)
  })

  it.each(['markdown', 'word'])('%s 等待加载和导出期间保留 toast 并阻止重复提交', async format => {
    const moduleGate = deferred(), exportGate = deferred()
    loadExport = () => moduleGate.promise
    const exporter = format === 'markdown' ? exportMarkdown : exportDocx
    exporter.mockReturnValue(exportGate.promise)
    const host = await createHost()
    host.openExportDialog(format)
    const pending = host.submitExport()
    expect(host.exportOpen).toBe(false)
    expect(host.exportBusy).toBe(true)
    expect(host.exportToast).toBe('正在导出文档')
    await host.submitExport()
    await vi.waitFor(() => expect(exportLoads).toBe(1))
    moduleGate.resolve(await exporterModule())
    await vi.waitFor(() => expect(exporter).toHaveBeenCalledTimes(1))
    expect(host.exportBusy).toBe(true)
    expect(host.exportToast).toBe('正在导出文档')
    const guard = exporter.mock.calls[0][1].shouldDownload
    expect(guard()).toBe(true)
    host.session._authorizationGeneration += 1
    expect(guard()).toBe(false)
    exportGate.resolve({ fileName: '周报' })
    await expect(pending).resolves.toBeUndefined()
    expect(host.exportBusy).toBe(false)
    expect(host.exportToast).toBe('')
  })

  it.each(['markdown', 'word'])('%s 加载失败转为 UI 错误并清理 busy/toast', async format => {
    loadExport = () => { throw new Error('导出模块加载失败') }
    const host = await createHost()
    host.openExportDialog(format)
    await expect(host.submitExport()).resolves.toBeUndefined()
    expect(host.error).toMatch(/^导出失败：/)
    expect(exportLoads).toBe(1)
    expect(exportMarkdown).not.toHaveBeenCalled()
    expect(exportDocx).not.toHaveBeenCalled()
    expect(host.exportBusy).toBe(false)
    expect(host.exportToast).toBe('')
  })

  it.each(['markdown', 'word'])('%s 导出失败转为 UI 错误并清理 busy/toast', async format => {
    const exporter = format === 'markdown' ? exportMarkdown : exportDocx
    exporter.mockRejectedValue(new Error('文件生成失败'))
    const host = await createHost()
    host.openExportDialog(format)
    await expect(host.submitExport()).resolves.toBeUndefined()
    expect(host.error).toBe('导出失败：文件生成失败')
    expect(host.exportBusy).toBe(false)
    expect(host.exportToast).toBe('')
  })

  it('PDF 按需加载并打印真实评论，afterprint 收 toast、标题和附录', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    const host = await createHost(), previousTitle = document.title
    const source = host.editor.state.doc
    await addComments(host)
    host.openExportDialog('pdf')
    host.selectExportScope('withComments')
    const pending = host.submitExport()
    expect(print).not.toHaveBeenCalled()
    expect(exportLoads).toBe(0)
    await pending
    expect(exportLoads).toBe(1)
    expect(print).toHaveBeenCalledTimes(1)
    expect(exportPdf).toHaveBeenCalledExactlyOnceWith(host.$refs.root, expect.objectContaining({ title: '周报', scope: 'withComments', shouldPrint: expect.any(Function) }))
    expect(document.title).toBe('周报')
    expect(host.$refs.root.querySelector('[data-lark-doc-export-comments]')?.textContent).toContain('真实评论内容')
    expect(host.editor.state.doc).toBe(source)
    expect(host.exportToast).toBe('正在导出文档')
    window.dispatchEvent(new window.Event('afterprint'))
    expect(host.exportToast).toBe('')
    expect(host.exportBusy).toBe(false)
    expect(document.title).toBe(previousTitle)
    expect(document.querySelector('[data-lark-doc-export-comments]')).toBeNull()
    expect(document.body.classList.contains('lark-doc-printing')).toBe(false)
  })

  it('PDF 无打印根时保留失败结果，不打印并清理 toast', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    const host = await createHost({ exportToast: '正在导出文档' })
    host.$refs.root.remove()
    host.$refs.root = null
    await expect(host.dispatchPdf('contentOnly', '周报')).resolves.toEqual({ ok: false, reason: 'no-root', scope: 'contentOnly' })
    expect(exportLoads).toBe(1)
    expect(host.error).toBe('导出失败：no-root')
    expect(host.exportToast).toBe('')
    expect(print).not.toHaveBeenCalled()
  })
})


describe('受控远端导出接线', () => {
  async function remoteHost() {
    const host = await createHost()
    const download = vi.fn()
    vi.doMock('../../src/utils/download', () => ({ downloadBlob: download }))
    const provider = { isRemote: true, list: vi.fn(async () => []), get: vi.fn(), createSnapshot: vi.fn(), restore: vi.fn(),
      requestExport: vi.fn(async ({ format }) => ({ status: 'pending', operation: 'export', operationId: 'export-original', requestedFormat: format })),
      queryConversion: vi.fn(async () => ({ status: 'ready', operation: 'export', operationId: 'export-original', requestedFormat: 'docx' })),
      downloadConversion: vi.fn(async () => ({ status: 'downloaded', operationId: 'export-original', bytes: new Uint8Array([1, 2, 3]), mimeType: 'application/docx' })) }
    host.session.setProvider('versioning', provider)
    return { host, provider, download }
  }

  it('默认经真实Session请求、原键查询并仅下载已校验输出，正文保持原样', async () => {
    const { host, provider, download } = await remoteHost(), source = host.editor.state.doc
    host.openExportDialog('word')
    expect(host.exportRoute).toBe('remote')
    await host.submitExport()
    expect(provider.requestExport).toHaveBeenCalledExactlyOnceWith({ format: 'docx' })
    expect(exportDocx).not.toHaveBeenCalled()
    expect(download).not.toHaveBeenCalled()
    expect(host.exportPendingOperationId).toBe('export-original')
    await host.queryRemoteExport()
    expect(provider.queryConversion).toHaveBeenCalledExactlyOnceWith('export-original')
    expect(provider.downloadConversion).toHaveBeenCalledExactlyOnceWith('export-original')
    expect(download).toHaveBeenCalledExactlyOnceWith(expect.any(Blob), '周报.docx')
    expect(host.exportPendingOperationId).toBe('')
    expect(host.editor.state.doc).toBe(source)
  })

  it('远端Provider存在时显式本地导出仍使用原格式链，不发送服务请求', async () => {
    const { host, provider } = await remoteHost()
    host.openExportDialog('word'); host.selectExportRoute('local')
    await host.submitExport()
    expect(exportDocx).toHaveBeenCalledOnce()
    expect(provider.requestExport).not.toHaveBeenCalled()
  })
  it('未知提交保留原键，换格式或标题后也只查询并下载原任务', async () => {
    const { host, provider, download } = await remoteHost()
    provider.requestExport.mockRejectedValue(Object.assign(Error('lost'), { status: 'unknown', operationId: 'export-original' }))
    host.openExportDialog('word'); await host.submitExport()
    expect(host.exportPendingOperationId).toBe('export-original')
    host.title = '新标题'; host.openExportDialog('pdf'); await host.submitExport()
    expect(provider.requestExport).toHaveBeenCalledOnce()
    expect(provider.queryConversion).toHaveBeenCalledExactlyOnceWith('export-original')
    expect(download).toHaveBeenCalledWith(expect.any(Blob), '周报.docx')
  })

  it.each(['actor-aba', 'session', 'provider-aba', 'permission', 'document', 'destroy'])('下载等待期间%s变化不输出旧文件或旧状态', async change => {
    const { host, provider, download } = await remoteHost(), gate = deferred()
    provider.requestExport.mockResolvedValue({ status: 'ready', operation: 'export', operationId: 'export-original', requestedFormat: 'docx' })
    provider.downloadConversion.mockReturnValue(gate.promise)
    host.openExportDialog('word'); const pending = host.submitExport()
    await vi.waitFor(() => expect(provider.downloadConversion).toHaveBeenCalledOnce())
    if (change === 'actor-aba') { host.session.user = { id: 'bob' }; host.session.user = { id: 'alice' } }
    if (change === 'session') host.session = new DocumentSession({ documentId: 'other', user: { id: 'alice' } })
    if (change === 'provider-aba') { host.session.setProvider('versioning', { ...provider }); host.session.setProvider('versioning', provider) }
    if (change === 'permission') host.session._capabilities.canExport = false
    if (change === 'document') host.documentId = 'other'
    if (change === 'destroy') { host._exportDisposed = true; host.clearRemoteExport() }
    gate.resolve({ status: 'downloaded', operationId: 'export-original', bytes: new Uint8Array([1]), mimeType: 'application/docx' })
    await pending
    expect(download).not.toHaveBeenCalled()
    expect(host.exportToast).toBe('')
    if (change === 'session') await host.session.dispose()
  })

  it('冷加载取消零请求；已提交取消保留原键并阻止并发新写', async () => {
    const { host, provider, download } = await remoteHost()
    host.openExportDialog('word'); const cold = host.submitExport(); host.cancelExport(); await cold
    expect(provider.requestExport).not.toHaveBeenCalled()
    const gate = deferred(); provider.requestExport.mockReturnValue(gate.promise)
    host.openExportDialog('word'); const sent = host.submitExport()
    await vi.waitFor(() => expect(provider.requestExport).toHaveBeenCalledOnce())
    host.cancelExport(); expect(host.exportBusy).toBe(true)
    await host.submitExport(); expect(provider.requestExport).toHaveBeenCalledOnce()
    gate.resolve({ status: 'ready', operation: 'export', operationId: 'export-original', requestedFormat: 'docx' }); await sent
    expect(host.exportPendingOperationId).toBe('export-original')
    expect(download).not.toHaveBeenCalled(); expect(provider.downloadConversion).not.toHaveBeenCalled()
  })

  it('服务不支持的内容范围明确拒绝，未静默执行本地导出', async () => {
    const { host, provider } = await remoteHost()
    host.openExportDialog('word'); host.selectExportScope('withComments'); await host.submitExport()
    expect(host.error).toContain('本地导出'); expect(provider.requestExport).not.toHaveBeenCalled(); expect(exportDocx).not.toHaveBeenCalled()
  })

  it('错误任务或无有效字节不能落盘，原查询键保持不变', async () => {
    const { host, provider, download } = await remoteHost()
    host.openExportDialog('word'); await host.submitExport()
    provider.queryConversion.mockResolvedValueOnce({ status: 'ready', operation: 'export', operationId: 'forged', requestedFormat: 'pdf' })
    await host.queryRemoteExport()
    expect(host.exportPendingOperationId).toBe('export-original'); expect(provider.downloadConversion).not.toHaveBeenCalled()
    provider.queryConversion.mockResolvedValueOnce({ status: 'ready', operation: 'export', operationId: 'export-original' })
    await host.queryRemoteExport()
    expect(provider.downloadConversion).not.toHaveBeenCalled()
    provider.downloadConversion.mockResolvedValue({ status: 'downloaded', operationId: 'export-original', bytes: new Uint8Array(), mimeType: 'application/docx' })
    await host.queryRemoteExport()
    expect(download).not.toHaveBeenCalled(); expect(host.exportPendingOperationId).toBe('export-original')
  })

  it.each([false, true])('真实HTTP版本端口固定不可变来源并校验审计下载字节（corrupt=%s）', async corrupt => {
    const { host, download } = await remoteHost()
    const { createHttpVersioningProvider } = await import('../../src/providers/versioning')
    const { createHash, webcrypto } = await import('node:crypto')
    vi.stubGlobal('crypto', webcrypto)
    const bytes = new Uint8Array([7, 8, 9]), checksum = 'sha256:' + createHash('sha256').update(bytes).digest('hex')
    const source = { versionId: 'immutable-one', sourceEpoch: '1', sourceRevision: '2', capturedSeq: '3', schemaVersion: '1', stateHash: 'sha256:' + '1'.repeat(64), contentHash: 'sha256:' + '2'.repeat(64) }
    let intent
    const request = vi.fn(async (url, options) => {
      if (url.endsWith('/versions')) return { status: 200, json: async () => [{ ...source, tenantId: 'tenant', docId: 'doc-export', operationId: 'snapshot-one',
        createdBy: 'alice', createdAt: '2026-11-15T00:00:00.000Z', label: 'fixed', purpose: 'manual', kind: 'manual', status: 'durable', protocolVersion: 'editor-crdt-v1', sizeBytes: 1 }] }
      if (url.includes('/content?')) return { status: 200, arrayBuffer: async () => (corrupt ? new Uint8Array([7, 8, 0]) : bytes).buffer }
      intent = JSON.parse(options.body)
      return { status: 200, json: async () => ({ status: 'ready', operation: 'export', operationId: intent.operationId, tenantId: 'tenant', docId: 'doc-export',
        requestHash: 'sha256:' + '3'.repeat(64), requestedFormat: intent.format, persisted: true, taskId: intent.operationId, sourceVerified: true, code: null, source,
        output: { mimeType: 'application/docx', sizeBytes: '3', checksum } }) }
    })
    const provider = createHttpVersioningProvider({ tenantId: 'tenant', docId: 'doc-export', request, csrfToken: 'fixture-csrf', auditedDownloads: true,
      getCapabilities: () => host.session.getCapabilities(), getState: () => ({ status: 'ready', epoch: '1', revision: '2', lastSeq: '3', pending: [] }) })
    host.session.setProvider('versioning', provider)
    host.openExportDialog('word'); await host.submitExport()
    expect(intent).toMatchObject({ versionId: 'immutable-one', format: 'docx' })
    const audit = request.mock.calls.find(([url]) => url.includes('/content?'))
    expect(audit?.[1].method).toBe('POST')
    const auditBody = JSON.parse(audit[1].body)
    expect(audit[1].headers['Idempotency-Key']).toBe(auditBody.downloadOperationId)
    if (corrupt) { expect(download).not.toHaveBeenCalled(); expect(host.exportPendingOperationId).toBe(intent.operationId) }
    else { expect(download).toHaveBeenCalledExactlyOnceWith(expect.any(Blob), '周报.docx'); expect(host.exportPendingOperationId).toBe('') }
  })

  it('同身份复权使迟到结果失效但保留原键，恢复后只查询原请求', async () => {
    const { host, provider, download } = await remoteHost(), gate = deferred()
    provider.requestExport.mockReturnValue(gate.promise)
    host.openExportDialog('word'); const pending = host.submitExport()
    await vi.waitFor(() => expect(provider.requestExport).toHaveBeenCalledOnce())
    host.session._clearPrivateIdentityView('authorization-required')
    gate.resolve({ status: 'pending', operation: 'export', operationId: 'export-original', requestedFormat: 'docx' }); await pending
    expect(download).not.toHaveBeenCalled(); expect(host.exportToast).toBe(''); expect(host.exportPendingOperationId).toBe('export-original')
    await host.queryRemoteExport()
    expect(provider.requestExport).toHaveBeenCalledOnce(); expect(provider.queryConversion).toHaveBeenCalledExactlyOnceWith('export-original')
    expect(download).toHaveBeenCalledOnce()
  })

  it('显式远端Provider缺少转换端口时不可静默改成本地导出', async () => {
    const { host, provider } = await remoteHost()
    delete provider.requestExport; delete provider.queryConversion; delete provider.downloadConversion
    host.openExportDialog('word'); await host.submitExport()
    expect(host.exportRoute).toBe('remote'); expect(host.exportRemoteAvailable).toBe(false)
    expect(host.error).toContain('尚未接入'); expect(exportDocx).not.toHaveBeenCalled()
  })

})
