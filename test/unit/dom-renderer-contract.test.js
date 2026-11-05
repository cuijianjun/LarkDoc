// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { Plugin } from '@tiptap/pm/state'
import { createDomRenderer } from '../../src/mount/domRenderer'
import { createRenderer, setRenderer } from '../../src/mount'
import { LarkDoc } from '../../src/LarkDoc'
import { createUploadProvider } from '../../src/core/media/upload'

const ACTIONS = ['mount', 'update', 'destroy', 'getInstance', 'getRoot']
const mounted = []

function stubRangeLayout() {
  const createRange = document.createRange.bind(document)
  vi.spyOn(document, 'createRange').mockImplementation(() => Object.assign(createRange(), {
    getClientRects: () => [],
    getBoundingClientRect: () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 }),
  }))
}

function dispatchFileEvent(editor, source, files, html = '') {
  const event = new Event(source, { bubbles: true, cancelable: true })
  const transfer = { files, types: ['Files'], getData: type => type === 'text/html' ? html : '' }
  Object.defineProperty(event, source === 'paste' ? 'clipboardData' : 'dataTransfer', { value: transfer })
  if (source === 'drop') vi.spyOn(editor.view, 'posAtCoords').mockReturnValue({ pos: 1, inside: 0 })
  editor.view.dom.dispatchEvent(event)
  return event
}

describe('真实门面图片上传', () => {
  it.each(['object', 'function', 'legacy', 'provider', 'legacy-provider'])('%s uploader 实际执行并采用无附件 ID 的地址', async kind => {
    const upload = vi.fn(async () => ({ url: 'https://cdn.example.com/uploaded.png' }))
    const options = kind === 'legacy' ? { uploadImage: upload } : kind === 'legacy-provider' ? { uploadImage: createUploadProvider({ upload }) }
      : { uploader: kind === 'object' ? { upload } : kind === 'provider' ? createUploadProvider({ upload }) : upload }
    const element = document.createElement('div')
    document.body.appendChild(element)
    const doc = new LarkDoc({ element, content: '<p></p>', ...options })
    try {
      await doc._handle.nativeHost.host.insertImageFiles([new File(['png'], 'a.png', { type: 'image/png' })])
      expect(upload).toHaveBeenCalledTimes(1)
      expect(doc.getJSON().content[0]).toMatchObject({ type: 'image', attrs: { src: 'https://cdn.example.com/uploaded.png', attchId: null } })
    } finally { doc.destroy(); element.remove() }
  })

  it.each(['data', 'local', 'failure', 'reject'])('%s 经公共管线通知应用且不会静默降级', async scenario => {
    const calls = []
    const upload = vi.fn(async () => {
      if (scenario === 'failure') throw new Error('denied')
      return { url: 'data:image/png;base64,cG5n' }
    })
    const uploader = {
      ...(scenario === 'local' ? {} : { upload }),
      beforeUpload: () => calls.push('before'),
      onStart: event => { expect(event.source).toBe('select'); calls.push('start') },
      onSuccess: () => calls.push('success'),
      onError: () => calls.push('error'),
      onReject: () => calls.push('reject'),
      onSettled: event => calls.push(event.status),
    }
    const element = document.createElement('div')
    document.body.appendChild(element)
    const doc = new LarkDoc({ element, content: '<p></p>', uploader, config: { limits: { maxImageSize: scenario === 'reject' ? 1 : 1024 } } })
    try {
      await doc._handle.nativeHost.host.insertImageFiles([new File(['png'], 'a.png', { type: 'image/png' })])
      if (['data', 'local'].includes(scenario)) {
        expect(doc.getJSON().content[0]).toMatchObject({ type: 'image', attrs: { src: expect.stringMatching(/^data:image\/png;base64,/), attchId: null } })
        expect(calls).toEqual(['before', 'start', 'success', 'success'])
      } else {
        expect(doc.getJSON().content.some(node => node.type === 'image')).toBe(false)
        expect(calls).toEqual(scenario === 'reject' ? ['reject', 'rejected'] : ['before', 'start', 'error', 'error'])
      }
      expect(upload).toHaveBeenCalledTimes(['local', 'reject'].includes(scenario) ? 0 : 1)
    } finally { doc.destroy(); element.remove() }
  })

  it.each(['destroy', 'content', 'readonly', 'session'])('%s 取消不响应 signal 的请求，晚结果和排队文件不会写回', async action => {
    let complete
    const onCancel = vi.fn()
    const onSettled = vi.fn()
    const upload = vi.fn(() => new Promise(resolve => { complete = resolve }))
    const provider = createUploadProvider({ upload, onCancel, onSettled })
    const element = document.createElement('div')
    document.body.appendChild(element)
    const doc = new LarkDoc({ element, content: '<p>old</p>', uploader: provider })
    try {
      const files = [new File(['one'], 'one.png', { type: 'image/png' }), new File(['two'], 'two.png', { type: 'image/png' })]
      const pending = doc._handle.nativeHost.host.insertImageFiles(files)
      expect(provider.pending()).toBe(1)
      if (action === 'destroy') doc.destroy()
      if (action === 'content') doc.setContent('<p>new</p>')
      if (action === 'readonly') { doc.setReadonly(true); doc.setReadonly(false) }
      if (action === 'session') doc.patchProps({ documentId: 'next-document' })
      await pending
      expect(provider.pending()).toBe(0)
      complete({ url: '/late.png' })
      await Promise.resolve()
      expect(upload).toHaveBeenCalledTimes(1)
      expect(onCancel).toHaveBeenCalledTimes(1)
      expect(onSettled).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: 'cancelled' }))
      if (action !== 'destroy') expect(doc.getJSON().content.some(node => node.type === 'image')).toBe(false)
    } finally { doc.destroy(); element.remove() }
  })

  it('上传通知异常通过门面 error 渠道报告，错误监听器自己的异步异常也被接住', async () => {
    const failure = new Error('notification')
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const onError = vi.fn(async () => { throw new Error('error-listener') })
    const upload = vi.fn(async () => ({ url: '/ok.png' }))
    const element = document.createElement('div')
    document.body.appendChild(element)
    const doc = new LarkDoc({ element, content: '<p></p>', onError, uploader: { upload, onStart: () => Promise.reject(failure) } })
    const handler = vi.fn(async () => { throw new Error('event-listener') })
    doc.on('error', handler)
    try {
      await doc._handle.nativeHost.host.insertImageFiles([new File(['png'], 'a.png', { type: 'image/png' })])
      await Promise.resolve()
      expect(onError).toHaveBeenCalledExactlyOnceWith(failure)
      expect(handler).toHaveBeenCalledExactlyOnceWith(failure)
      expect(upload).toHaveBeenCalledTimes(1)
      expect(error).toHaveBeenCalledTimes(2)
      expect(doc.getJSON().content[0].type).toBe('image')
    } finally { doc.destroy(); element.remove() }
  })

  it('beforeUpload 同步换文档后不执行 upload，也不开始旧队列的第二张图', async () => {
    const upload = vi.fn(async () => ({ url: '/ok.png' }))
    const beforeUpload = vi.fn(() => { doc.setContent('<p>new</p>'); return true })
    const element = document.createElement('div')
    document.body.appendChild(element)
    const doc = new LarkDoc({ element, content: '<p>old</p>', uploader: { upload, beforeUpload } })
    try {
      const file = new File(['png'], 'a.png', { type: 'image/png' })
      await doc._handle.nativeHost.host.insertImageFiles([file, file])
      expect(upload).not.toHaveBeenCalled()
      expect(beforeUpload).toHaveBeenCalledTimes(1)
      expect(doc.getJSON().content[0]).toMatchObject({ type: 'paragraph', content: [{ type: 'text', text: 'new' }] })
    } finally { doc.destroy(); element.remove() }
  })

  it('共享 Provider 的两个编辑器只取消自身任务', async () => {
    const complete = new Map()
    const onCancel = vi.fn()
    const provider = createUploadProvider({
      upload: (file, ctx) => new Promise(resolve => { complete.set(ctx.documentId, resolve) }),
      onCancel,
    })
    const elements = [document.createElement('div'), document.createElement('div')]
    elements.forEach(element => document.body.appendChild(element))
    const docs = elements.map((element, index) => new LarkDoc({ element, documentId: `doc-${index}`, content: '<p></p>', uploader: provider }))
    try {
      const file = new File(['png'], 'a.png', { type: 'image/png' })
      const pending = docs.map(doc => doc._handle.nativeHost.host.insertImageFiles([file]))
      expect(provider.pending()).toBe(2)
      docs[0].destroy()
      await pending[0]
      expect(provider.pending()).toBe(1)
      expect(onCancel).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ documentId: 'doc-0', reason: 'destroy' }))
      complete.get('doc-0')({ url: '/stale.png' })
      complete.get('doc-1')({ url: '/second.png' })
      await pending[1]
      expect(docs[1].getJSON().content[0]).toMatchObject({ type: 'image', attrs: { src: '/second.png' } })
      expect(provider.pending()).toBe(0)
    } finally {
      docs.forEach(doc => doc.destroy())
      elements.forEach(element => element.remove())
    }
  })

  it('paste/drop/select 保持 source、文件身份和独立 taskId；已有链接不触发上传', async () => {
    stubRangeLayout()
    const events = []
    const element = document.createElement('div')
    document.body.appendChild(element)
    const doc = new LarkDoc({ element, content: '<p></p>', uploader: { upload: async file => ({ url: `/${file.name}` }), onSuccess: event => events.push(event) } })
    try {
      const editor = doc.getEditor()
      const pasted = new File(['one'], 'paste.png', { type: 'image/png' })
      const dropped = new File(['two'], 'drop.png', { type: 'image/png' })
      dispatchFileEvent(editor, 'paste', [pasted])
      await vi.waitFor(() => expect(events).toHaveLength(1))
      dispatchFileEvent(editor, 'drop', [dropped])
      await vi.waitFor(() => expect(events).toHaveLength(2))
      await doc._handle.nativeHost.host.onImageInput({ target: { files: [pasted], value: 'same-file' } })
      expect(events.map(event => event.source)).toEqual(['paste', 'drop', 'select'])
      expect(events.map(event => event.file)).toEqual([pasted, dropped, pasted])
      expect(new Set(events.map(event => event.taskId)).size).toBe(3)
      editor.commands.insertContent({ type: 'image', attrs: { src: '/existing.png' } })
      expect(events).toHaveLength(3)
    } finally { doc.destroy(); element.remove() }
  })

  it.each(['paste', 'drop'])('真实 %s 链对混合图片只插入一次，并通知被过滤的 MIME/缺失 MIME 图片', async source => {
    stubRangeLayout()
    const upload = vi.fn(async () => ({ url: '/accepted.png' }))
    const onReject = vi.fn()
    const onSettled = vi.fn()
    const element = document.createElement('div')
    document.body.appendChild(element)
    const doc = new LarkDoc({ element, content: '<p></p>', uploader: { upload, onReject, onSettled } })
    const files = [
      new File(['png'], 'accepted.png', { type: 'image/png' }),
      new File(['svg'], 'vector.svg', { type: 'image/svg+xml' }),
      new File(['bmp'], 'unsupported.bmp', { type: 'image/bmp' }),
      new File(['png'], 'missing.png', { type: '' }),
    ]
    try {
      dispatchFileEvent(doc.getEditor(), source, files)
      await vi.waitFor(() => expect(onSettled).toHaveBeenCalledTimes(4))
      expect(upload).toHaveBeenCalledExactlyOnceWith(files[0], expect.objectContaining({ source }))
      expect(onReject.mock.calls.map(([event]) => event.file)).toEqual(files.slice(1))
      expect(onReject.mock.calls.every(([event]) => event.code === 'UPLOAD_MIME' && event.source === source)).toBe(true)
      expect(onSettled.mock.calls.filter(([event]) => event.status === 'rejected')).toHaveLength(3)
      expect(doc.getJSON().content.filter(node => node.type === 'image')).toHaveLength(1)
    } finally { doc.destroy(); element.remove() }
  })

  it.each(['paste', 'drop'])('真实 %s 链的非图片附件继续交给后续插件', async source => {
    const uploader = { upload: vi.fn(), onReject: vi.fn(), onSettled: vi.fn() }
    const element = document.createElement('div')
    document.body.appendChild(element)
    const doc = new LarkDoc({ element, content: '<p></p>', uploader })
    const files = [new File(['pdf'], 'a.pdf', { type: 'application/pdf' }), new File(['txt'], 'notes.txt', { type: '' })]
    const attachment = vi.fn((view, event) => {
      expect((event.clipboardData || event.dataTransfer).files).toEqual(files)
      return true
    })
    doc.getEditor().registerPlugin(new Plugin({ props: { [source === 'paste' ? 'handlePaste' : 'handleDrop']: attachment } }))
    try {
      dispatchFileEvent(doc.getEditor(), source, files)
      expect(attachment).toHaveBeenCalledTimes(1)
      await Promise.resolve()
      expect(uploader.upload).not.toHaveBeenCalled()
      expect(uploader.onReject).not.toHaveBeenCalled()
      expect(uploader.onSettled).not.toHaveBeenCalled()
    } finally { doc.destroy(); element.remove() }
  })

  it.each(['paste', 'drop'])('真实 %s 链的拒绝通知不吞掉伴随 HTML', async source => {
    stubRangeLayout()
    const onReject = vi.fn()
    const upload = vi.fn()
    const element = document.createElement('div')
    document.body.appendChild(element)
    const doc = new LarkDoc({ element, content: '<p></p>', uploader: { upload, onReject } })
    try {
      dispatchFileEvent(doc.getEditor(), source, [new File(['svg'], 'a.svg', { type: 'image/svg+xml' })], '<p>保留 HTML 正文</p>')
      await vi.waitFor(() => expect(onReject).toHaveBeenCalledTimes(1))
      expect(doc.getText()).toContain('保留 HTML 正文')
      expect(upload).not.toHaveBeenCalled()
    } finally { doc.destroy(); element.remove() }
  })

  it('setUploader 原地更新回调并保留编辑器、正文、标题和撤销历史', async () => {
    const oldUpload = vi.fn(async () => ({ url: '/old.png' }))
    const upload = vi.fn(async () => ({ url: '/new.png' }))
    const onSuccess = vi.fn()
    const element = document.createElement('div')
    document.body.appendChild(element)
    const doc = new LarkDoc({ element, content: '<p></p>', uploadImage: oldUpload })
    try {
      const editor = doc.getEditor()
      editor.commands.insertContent('编辑后的正文')
      doc.setTitle('编辑后的标题')
      const json = doc.getJSON()
      const uploader = { upload, onSuccess }
      expect(doc.setUploader(uploader)).toBe(doc)
      expect(doc.getEditor()).toBe(editor)
      expect(doc.getJSON()).toEqual(json)
      expect(doc.getTitle()).toBe('编辑后的标题')
      expect(doc.options.uploader).toBe(uploader)
      expect(doc.options.uploadImage).toBeUndefined()
      expect(editor.commands.undo()).toBe(true)
      expect(doc.getText()).toBe('')
      expect(editor.commands.redo()).toBe(true)
      expect(doc.getJSON()).toEqual(json)
      await doc._handle.nativeHost.host.insertImageFiles([new File(['png'], 'a.png', { type: 'image/png' })])
      expect(upload).toHaveBeenCalledTimes(1)
      expect(oldUpload).not.toHaveBeenCalled()
      expect(onSuccess).toHaveBeenCalledTimes(1)
      doc.destroy()
      expect(doc.setUploader(null)).toBe(doc)
    } finally { doc.destroy(); element.remove() }
  })

  it('切换到未知 Provider 协议后每次都明确失败，不复用旧上传实现', async () => {
    const upload = vi.fn(async () => ({ url: '/old.png' }))
    const element = document.createElement('div')
    document.body.appendChild(element)
    const doc = new LarkDoc({ element, content: '<p></p>', uploader: { upload } })
    const file = new File(['png'], 'a.png', { type: 'image/png' })
    try {
      await doc._handle.nativeHost.host.insertImageFiles([file])
      doc.setUploader({ [Symbol.for('lark-doc.uploadProvider')]: 99, upload })
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await doc._handle.nativeHost.host.insertImageFiles([file])
        expect(doc._handle.nativeHost.host.error).toBe('不支持的上传 Provider 协议版本')
      }
      expect(upload).toHaveBeenCalledTimes(1)
    } finally { doc.destroy(); element.remove() }
  })
})

function mountRenderer(renderer, options) {
  document.body.appendChild(options.element)
  const handle = renderer.mount(options)
  mounted.push({ renderer, handle, host: options.element })
  return handle
}

afterEach(() => {
  mounted.splice(0).reverse().forEach(({ renderer, handle, host }) => {
    renderer.destroy(handle)
    host.remove()
  })
  vi.restoreAllMocks()
  localStorage.clear()
})

function expectContract(renderer) {
  expect(Object.keys(renderer).filter(key => typeof renderer[key] === 'function')).toEqual(ACTIONS)
  ACTIONS.forEach(action => expect(typeof renderer[action]).toBe('function'))
}

describe('迁移期 DOM renderer 契约', () => {
  it('暴露且只暴露五个 renderer 动作', () => {
    expectContract(createDomRenderer())
  })

  it('在普通 DOM 宿主下创建等价根节点并提供实例', async () => {
    const host = document.createElement('div')
    const ready = vi.fn()
    const renderer = createDomRenderer()
    const handle = mountRenderer(renderer, {
      element: host,
      props: { initialTitle: '迁移期文档', initialContent: '<p>正文</p>' },
      on: { ready },
    })

    expect(renderer.getRoot(handle)).toBe(host.firstElementChild)
    expect(renderer.getRoot(handle).className).toContain('lark-doc')
    expect(renderer.getRoot(handle).dataset.renderer).toBe('dom-migration')
    expect(renderer.getRoot(handle).querySelector('#lark-doc-editor')).not.toBeNull()
    expect(renderer.getRoot(handle).querySelector('.lark-doc-actions-host')).not.toBeNull()
    expect(renderer.getRoot(handle).querySelector('.lark-doc-external-panel')).not.toBeNull()
    expect(renderer.getInstance(handle)).toBe(handle.instance)
    const instance = renderer.getInstance(handle)
    expect(handle.editor).toBeInstanceOf(Editor)
    expect(handle.editor.state.selection).toBeInstanceOf(TextSelection)
    expect(handle.editor.state.doc.textContent).toBe('正文')
    expect(instance.getTitle()).toBe('迁移期文档')
    expect(instance.getText()).toContain('正文')
    ;[
      'getWorkspace', 'callWorkspace', 'record', 'onReady', 'queueSave', 'flushOnLeave', 'saveNow',
      'storageFailure', 'toggleHistory', 'createSnapshot', 'restoreSnapshot', 'importDocument',
      'exportDocument', 'currentAIContext', 'resetAIPreview', 'startAI', 'sendAIChat', 'regenerateAI',
      'stopAI', 'closeAI', 'copyAIPreview', 'acceptAI', 'insertAIResult', 'acceptReviewIssue',
      'ignoreReviewIssue', 'applyAIProposal', 'toggleSlides', 'isSlides',
    ].forEach((method) => expect(typeof instance[method]).toBe('function'))
    await Promise.resolve()
    expect(ready).toHaveBeenCalled()

    renderer.destroy(handle)
    expect(renderer.getRoot(handle)).toBeNull()
    expect(host.firstElementChild).toBeNull()
  })

  it('DOM renderer 的演示模式复用 stage DOM 契约并支持退出', async () => {
    const host = document.createElement('div')
    const renderer = createDomRenderer()
    const handle = mountRenderer(renderer, {
      element: host,
      props: { initialTitle: '演示文档', initialContent: '<p>正文</p>' },
    })
    const instance = renderer.getInstance(handle)
    const root = renderer.getRoot(handle)

    expect(root.querySelector('.lark-doc-slide-stage')).toBeNull()
    instance.toggleSlides()
    expect(instance.isSlides()).toBe(true)
    expect(root.classList.contains('lark-doc-slides')).toBe(true)
    expect(root.querySelector('.lark-doc-paper').style.display).toBe('none')
    expect(root.querySelector('.lark-doc-slide-stage')?.textContent).toContain('演示文档')
    expect(root.querySelectorAll('.lark-doc-slide-stage button')).toHaveLength(3)

    const next = root.querySelector('.lark-doc-slide-stage button:nth-child(2)')
    const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(root.querySelector('.lark-doc-slide-counter').textContent).toBe('1 / 1')
    expect(next.disabled).toBe(true)

    root.querySelector('.lark-doc-slide-stage button:last-child').click()
    expect(instance.isSlides()).toBe(false)
    await Promise.resolve()
    expect(root.querySelector('.lark-doc-slide-stage')).toBeNull()
    expect(root.querySelector('.lark-doc-paper').style.display).toBe('')

    await Promise.resolve()
    renderer.destroy(handle)
  })

  it('工具栏投影使用真实 marks/options，并按配置裁剪入口', async () => {
    const host = document.createElement('div')
    const renderer = createDomRenderer()
    const handle = mountRenderer(renderer, {
      element: host,
      props: {
        initialContent: '<p>正文</p>',
        config: { toolbar: { marksAllow: ['bold', 'strike'] }, features: { ai: false, outline: false } },
      },
    })
    await Promise.resolve()
    const root = renderer.getRoot(handle)
    expect(root.querySelectorAll('.lark-doc-mark-bold')).toHaveLength(1)
    expect(root.querySelectorAll('.lark-doc-mark-strike')).toHaveLength(1)
    expect(root.querySelectorAll('.lark-doc-mark-italic')).toHaveLength(0)
    expect(root.querySelector('[aria-label="字体"]')).not.toBeNull()
    expect(root.querySelector('[aria-label="字号"]')).not.toBeNull()
    expect(root.querySelector('[aria-label="目录"]')).toBeNull()
    expect(root.querySelector('[aria-label="AI 助手"]')).toBeNull()
    renderer.destroy(handle)
  })

  it('正文标题切换走 setParagraph，清除格式同时清节点', async () => {
    const host = document.createElement('div')
    const renderer = createDomRenderer()
    const handle = mountRenderer(renderer, { element: host, props: { initialContent: '<p>正文</p>' } })
    await Promise.resolve()
    const root = renderer.getRoot(handle)
    const editor = handle.editor
    const commands = editor.commandManager.rawCommands
    const setParagraph = vi.spyOn(commands, 'setParagraph')
    const unsetAllMarks = vi.spyOn(commands, 'unsetAllMarks')
    const clearNodes = vi.spyOn(commands, 'clearNodes')
    editor.commands.setHeading({ level: 2 })
    editor.commands.setTextSelection({ from: 1, to: 3 })
    editor.commands.toggleBold()
    expect(editor.isActive('heading', { level: 2 })).toBe(true)
    expect(editor.isActive('bold')).toBe(true)
    root.querySelector('[aria-label="标题级别"]').click()
    await Promise.resolve()
    root.querySelector('.lark-doc-heading-menu button').click()
    root.querySelector('[aria-label="清除格式"]').click()
    expect(setParagraph).toHaveBeenCalledWith()
    expect(unsetAllMarks).toHaveBeenCalledWith()
    expect(clearNodes).toHaveBeenCalledWith()
    expect(editor.isActive('paragraph')).toBe(true)
    expect(editor.isActive('bold')).toBe(false)
    expect(editor.state.doc.textContent).toBe('正文')
    renderer.destroy(handle)
  })

  it('update props 触发重新投影，destroy 后不再接受延迟刷新', async () => {
    const host = document.createElement('div')
    const renderer = createDomRenderer()
    const handle = mountRenderer(renderer, { element: host, props: { initialContent: '<p>正文</p>' } })
    renderer.update(handle, { config: { features: { marks: false } } })
    await Promise.resolve()
    expect(renderer.getRoot(handle).querySelector('.lark-doc-mark-bold')).toBeNull()
    renderer.destroy(handle)
    handle.requestRender()
    await Promise.resolve()
    expect(renderer.getRoot(handle)).toBeNull()
  })

  it('mount/index 默认使用 DOM，Vue renderer 必须由宿主显式注入', () => {
    expect(createRenderer().name).toBe('dom-migration')
    expect(() => createRenderer({ renderer: 'vue2' })).toThrow(/隔离/)
    expect(createRenderer({ rendererFactory: createDomRenderer }).name).toBe('dom-migration')
    expect(typeof setRenderer).toBe('function')
    setRenderer(null)
  })
})
