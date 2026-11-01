// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let exportLoads
let loadExport
let exportMarkdown
let exportDocx

async function createHost(overrides = {}) {
  const { default: mixin } = await import('../../src/components/lark-doc/editor/exportMixin.js')
  const host = { ...mixin.data(), ...mixin.methods, ...overrides }
  for (const [key, getter] of Object.entries(mixin.computed)) {
    Object.defineProperty(host, key, { get: () => getter.call(host) })
  }
  return host
}

beforeEach(() => {
  vi.resetModules()
  exportLoads = 0
  exportMarkdown = vi.fn()
  exportDocx = vi.fn()
  loadExport = () => ({ exportMarkdown, exportDocx })
  // 工厂只在模块真正被加载时执行；静态引入统一出口也会触发计数。
  vi.doMock('../../src/utils/export/index.js', () => {
    exportLoads += 1
    return loadExport()
  })
})

afterEach(() => {
  window.dispatchEvent(new window.Event('afterprint'))
  document.body.innerHTML = ''
  vi.doUnmock('../../src/utils/export/index.js')
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('exportMixin 按需加载边界', () => {
  it('初始化、文件名、打开、切换与取消均不加载统一出口', async () => {
    const host = await createHost({ localTitle: '  ..周报 / 草稿  ' })
    expect(host.exportFileBaseName).toBe('周报 - 草稿')
    for (const format of ['markdown', 'word', 'pdf']) {
      host.openExportDialog(format)
      host.selectExportScope('withComments')
      host.cancelExport()
    }
    expect(host.exportOpen).toBe(false)
    expect(exportLoads).toBe(0)
  })

  it('无权限、输出策略拒绝、忙碌和未知档位均不加载统一出口', async () => {
    const denied = await createHost({
      session: { can: () => false },
      exportFormat: 'markdown',
    })
    await denied.submitExport()
    const blocked = await createHost({
      session: { can: () => true, getProvider: () => ({ policy: { canPrint: false } }) },
      exportFormat: 'pdf',
    })
    await blocked.submitExport()
    expect(blocked.outputAuditEvents[0].result).toBe('denied')
    const busy = await createHost({ exportFormat: 'word', exportBusy: true })
    await busy.submitExport()
    const unknown = await createHost({ exportFormat: 'unknown' })
    await unknown.submitExport()
    await expect(unknown.dispatchExport('unknown', '', '')).resolves.toBeNull()
    expect(exportLoads).toBe(0)
  })

  it.each(['markdown', 'word'])('%s 无文档时返回 Promise<null> 且不加载统一出口', async (format) => {
    const host = await createHost()
    const pending = host.dispatchExport(format, 'all', '周报')
    expect(pending).toBeInstanceOf(Promise)
    await expect(pending).resolves.toBeNull()
    expect(exportLoads).toBe(0)
  })

  it.each(['markdown', 'word'])('%s 派发时才加载，保留取数时机、参数和返回值', async (format) => {
    let finishLoad
    loadExport = () => new Promise((resolve) => { finishLoad = resolve })
    const originalDoc = { type: 'doc', content: [] }
    const getJSON = vi.fn(() => originalDoc)
    const host = await createHost({ editor: { getJSON } })
    const result = format === 'markdown'
      ? { fileName: '周报.md', markdown: '正文', scope: 'all' }
      : { fileName: '周报.docx', blob: new Blob(['正文']), failedImages: [], scope: 'withComments' }
    const exporter = format === 'markdown' ? exportMarkdown : exportDocx
    if (format === 'markdown') exporter.mockReturnValue(result)
    else exporter.mockResolvedValue(result)
    const pending = host.dispatchExport(format, result.scope, '周报')
    expect(pending).toBeInstanceOf(Promise)
    expect(getJSON).toHaveBeenCalledTimes(1)
    host.editor.getJSON = () => ({ type: 'doc', content: [{ type: 'paragraph' }] })
    await vi.waitFor(() => expect(exportLoads).toBe(1))
    expect(exporter).not.toHaveBeenCalled()
    finishLoad({ exportMarkdown, exportDocx })
    await expect(pending).resolves.toBe(result)
    expect(exporter).toHaveBeenCalledExactlyOnceWith(originalDoc, format === 'markdown'
      ? { fileName: '周报', scope: 'all' }
      : { fileName: '周报', title: '周报', scope: 'withComments' })
    expect(format === 'markdown' ? exportDocx : exportMarkdown).not.toHaveBeenCalled()
  })

  it.each(['markdown', 'word'])('%s 等待加载和导出期间保留 toast 并阻止重复提交', async (format) => {
    let finishLoad
    let finishExport
    loadExport = () => new Promise((resolve) => { finishLoad = resolve })
    const exporter = format === 'markdown' ? exportMarkdown : exportDocx
    exporter.mockImplementation(() => new Promise((resolve) => { finishExport = resolve }))
    const host = await createHost({ title: '周报', editor: { getJSON: () => ({ type: 'doc', content: [] }) } })
    host.openExportDialog(format)
    const pending = host.submitExport()
    expect(host.exportOpen).toBe(false)
    expect(host.exportBusy).toBe(true)
    expect(host.exportToast).toBe('正在导出文档')
    await host.submitExport()
    await vi.waitFor(() => expect(exportLoads).toBe(1))
    finishLoad({ exportMarkdown, exportDocx })
    await vi.waitFor(() => expect(exporter).toHaveBeenCalledTimes(1))
    expect(host.exportBusy).toBe(true)
    expect(host.exportToast).toBe('正在导出文档')
    finishExport({ fileName: '周报' })
    await expect(pending).resolves.toBeUndefined()
    expect(host.exportBusy).toBe(false)
    expect(host.exportToast).toBe('')
  })

  it.each(['markdown', 'word'])('%s 加载失败时保留拒绝并清理 busy/toast', async (format) => {
    const error = new Error('导出模块加载失败')
    loadExport = () => { throw error }
    const host = await createHost({ editor: { getJSON: () => ({ type: 'doc', content: [] }) } })
    host.openExportDialog(format)
    // Vitest 会包装 mock 工厂抛出的加载异常，原始异常保留在 cause。
    await expect(host.submitExport()).rejects.toMatchObject({ cause: error })
    expect(exportLoads).toBe(1)
    expect(exportMarkdown).not.toHaveBeenCalled()
    expect(exportDocx).not.toHaveBeenCalled()
    expect(host.exportBusy).toBe(false)
    expect(host.exportToast).toBe('')
  })

  it.each(['markdown', 'word'])('%s 导出失败时保留拒绝并清理 busy/toast', async (format) => {
    const error = new Error('导出失败')
    if (format === 'markdown') exportMarkdown.mockImplementation(() => { throw error })
    else exportDocx.mockRejectedValue(error)
    const host = await createHost({ editor: { getJSON: () => ({ type: 'doc', content: [] }) } })
    host.openExportDialog(format)
    await expect(host.submitExport()).rejects.toBe(error)
    expect(host.exportBusy).toBe(false)
    expect(host.exportToast).toBe('')
  })

  it('PDF 同步启动打印，不加载统一出口，Promise 返回原结果并由 afterprint 收 toast', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    const root = document.createElement('div')
    document.body.appendChild(root)
    const host = await createHost({ $refs: { root }, exportToast: '正在导出文档' })
    const pending = host.dispatchExport('pdf', 'withComments', '周报')
    expect(print).toHaveBeenCalledTimes(1)
    expect(document.title).toBe('周报')
    expect(exportLoads).toBe(0)
    expect(pending).toBeInstanceOf(Promise)
    await expect(pending).resolves.toEqual({ ok: true, cleanup: expect.any(Function), scope: 'withComments' })
    expect(host.exportToast).toBe('正在导出文档')
    window.dispatchEvent(new window.Event('afterprint'))
    expect(host.exportToast).toBe('')
  })

  it('PDF 无打印根时保持失败结果并立即清理 toast，不加载统一出口', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    const host = await createHost({ exportToast: '正在导出文档' })
    const pending = host.dispatchPdf('contentOnly', '周报')
    expect(host.exportToast).toBe('')
    expect(print).not.toHaveBeenCalled()
    await expect(pending).resolves.toEqual({ ok: false, reason: 'no-root', scope: 'contentOnly' })
    expect(exportLoads).toBe(0)
  })
})
