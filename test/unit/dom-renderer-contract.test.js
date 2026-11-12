// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { Plugin } from '@tiptap/pm/state'
import { CellSelection } from '@tiptap/pm/tables'
import { createDomRenderer } from '../../src/mount/domRenderer'
import { createRenderer, setRenderer } from '../../src/mount'
import { LarkDoc } from '../../src/LarkDoc'
import { createUploadProvider } from '../../src/core/media/upload'
import { diagramTypes } from '../../src/components/lark-doc/editor/constants'
import { createMemoryCommentsProvider } from '../../src/core/comments/memory-provider'
import { createDocumentSession } from '../../src/session/DocumentSession'
import { BLOCKED_IMAGE_PLACEHOLDER, createNetworkPolicy } from '../../src/core/policy/network'
import { cloneShareExcerpt } from '../../src/components/lark-doc/editor/shareMixin'

const ACTIONS = ['mount', 'update', 'destroy', 'getInstance', 'getRoot']
const mounted = []

describe('源模板插入与更多模板闭环', () => {
  async function withTemplateDocument(run, options = {}) {
    stubRangeLayout()
    const element = document.createElement('div')
    document.body.appendChild(element)
    const doc = new LarkDoc({ element, storage: 'none', title: '保留原文标题', content: '<p data-block-id="before_template">前文</p><p data-block-id="template_target">目标正文</p>', ...options })
    try { return await run({ doc, host: doc._handle.nativeHost.host, element, editor: doc.getEditor() }) }
    finally { doc.destroy(); element.remove() }
  }
  it.each([
    ['reading', '基本信息', 'columns', 6], ['personal', '目标完成情况', 'table', 1],
    ['report', '【工作内容】', 'table', 1], ['minutes', '会议主题：简要描述会议主题和目标', 'taskList', 1],
  ])('%s 插入真实结构且一次撤销完整恢复，重做和原标题保留', (id, text, type, count) => withTemplateDocument(async ({ doc, host, editor }) => {
    editor.commands.setTextSelection(editor.state.doc.firstChild.nodeSize + 1)
    const before = doc.getJSON()
    expect(host.chooseCommand({ id: 'template', templateId: id })).toBe(true)
    expect(doc.getText()).toContain(text)
    let total = 0
    const ids = []
    editor.state.doc.descendants(node => { if (node.type.name === type) total++; if (node.attrs.blockId) ids.push(node.attrs.blockId) })
    expect(total).toBe(count)
    expect(new Set(ids).size).toBe(ids.length)
    expect(doc.getTitle()).toBe('保留原文标题')
    expect(editor.commands.undo()).toBe(true)
    expect(doc.getJSON()).toEqual(before)
    expect(editor.commands.redo()).toBe(true)
    expect(doc.getText()).toContain(text)
  }))
  it('标准门面自定义模板和空数组保留明确覆盖语义', async () => {
    await withTemplateDocument(async ({ host, doc }) => {
      expect(host.templates.map(item => item.id)).toEqual(['custom'])
      expect(host.chooseCommand({ id: 'template', templateId: 'custom' })).toBe(true)
      expect(doc.getText()).toContain('自定义正文')
    }, { templates: [{ id: 'custom', label: '自定义', html: '<h2>自定义正文</h2>' }] })
    await withTemplateDocument(async ({ host, doc }) => {
      const before = doc.getJSON()
      expect(host.templates).toEqual([])
      expect(host.chooseCommand({ id: 'template', templateId: 'reading' })).toBe(false)
      expect(doc.getJSON()).toEqual(before)
    }, { templates: [] })
  })
  it('更多模板提供真实只读预览、前后浏览与Esc取消，保留映射选区', () => withTemplateDocument(async ({ doc, host, element, editor }) => {
    editor.commands.setTextSelection(editor.state.doc.firstChild.nodeSize + 1)
    expect(host.openTemplateLibrary()).toBe(true)
    editor.commands.insertContentAt(0, '<p>新前文</p>')
    const before = doc.getJSON()
    const library = element.querySelector('[aria-label="模板库"]')
    expect(library).not.toBeNull()
    library.querySelector('[data-template-id="personal"] .lark-doc-template-preview').click()
    const preview = library.querySelector('[aria-label="模板正文预览"]')
    expect(preview.textContent).toContain('全年目标')
    expect(preview.querySelector('[contenteditable="false"]')).not.toBeNull()
    expect(preview.querySelector('iframe,script')).toBeNull()
    const next = [...preview.querySelectorAll('button')].find(button => button.textContent === '下一个')
    next.click()
    expect(preview.textContent).toContain('【工作内容】')
    library.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }))
    expect(element.querySelector('[aria-label="模板库"]')).toBeNull()
    expect(doc.getJSON()).toEqual(before)
    expect(host.openTemplateLibrary()).toBe(true)
    element.querySelector('[data-template-id="personal"] .lark-doc-template-use').click()
    expect(doc.getText()).toContain('新前文')
    expect(doc.getText()).toContain('目标正文')
    expect(doc.getText()).toContain('全年目标')
    expect(element.querySelector('[aria-label="模板库"]')).toBeNull()
    expect(editor.commands.undo()).toBe(true)
    expect(doc.getJSON()).toEqual(before)
  }))
  it.each(['host-replace', 'readonly', 'feature-disabled'])('%s 后旧模板按钮不能修改当前正文', action => withTemplateDocument(async ({ doc, host, element }) => {
    expect(host.openTemplateLibrary()).toBe(true)
    const stale = element.querySelector('[data-template-id="personal"] .lark-doc-template-use')
    if (action === 'host-replace') doc.setContent('<p>新文档内容</p>')
    if (action === 'readonly') doc.setReadonly(true)
    if (action === 'feature-disabled') doc.patchProps({ config: { features: { templates: false } } })
    const before = doc.getJSON()
    stale.click()
    expect(doc.getJSON()).toEqual(before)
    if (action !== 'host-replace') expect(host.insertEditorTemplate('personal')).toBe(false)
  }))
  it.each(['reading', 'personal', 'report', 'minutes'])('真实Y.Doc中%s模板独立撤销，前一段输入不会一起丢失', async id => {
    const { Yjs, createCollabExtensions, isRemoteTransaction } = await import('../../src/collab')
    const ydoc = new Yjs.Doc({ gc: false })
    try {
      await withTemplateDocument(async ({ doc, host, editor }) => {
        editor.commands.insertContent('base')
        const manager = editor.state.plugins.map(plugin => plugin.getState(editor.state)?.undoManager).find(Boolean)
        expect(manager).toBeTruthy()
        manager.clear()
        manager.stopCapturing()
        editor.commands.insertContent(' prior')
        const before = doc.getJSON(), text = doc.getText()
        expect(host.chooseCommand({ id: 'template', templateId: id })).toBe(true)
        expect(doc.getText()).not.toBe(text)
        expect(manager.undoStack.length).toBe(2)
        doc.undo()
        expect(doc.getJSON()).toEqual(before)
        doc.undo()
        expect(doc.getText()).not.toContain(' prior')
        expect(doc.getText()).toContain('base')
        doc.redo()
        expect(doc.getText()).toBe(text)
        doc.redo()
        expect(doc.getText()).not.toBe(text)
      }, { content: '<p></p>', collab: { extensions: createCollabExtensions({ ydoc }), isRemoteTransaction } })
    } finally { ydoc.destroy() }
  })
})

describe('表格与链接选区分享真实门面', () => {
  const target = { type: 'linkEmbed', attrs: { blockId: 'shared_link', href: 'https://www.barenkeji.com', view: 'preview' } }
  async function withSelectionShare(run, options = {}) {
    stubRangeLayout()
    const element = document.createElement('div')
    document.body.appendChild(element)
    const onImageShare = vi.fn(), onSelectionShare = options.onSelectionShare || vi.fn(async () => true)
    const doc = new LarkDoc({ element, storage: 'none', onImageShare, onSelectionShare,
      mentionSource: [{ kind: 'user', id: 'recipient', name: '接收人' }], content: { type: 'doc', content: [target] }, ...options })
    try { return await run({ doc, host: doc._handle.nativeHost.host, element, onSelectionShare, onImageShare }) }
    finally { doc.destroy(); element.remove() }
  }
  function choose(host) { host.toggleImageShareRecipient('recipient', 'user') }
  it.each(['bookmark', 'linkEmbed'])('%s网页卡片摘录保留经网络策略允许的真实封面与图标', kind => withSelectionShare(async ({ host, element }) => {
    expect(host.openSelectionShareDialog(0)).toBe(true)
    await vi.waitFor(() => expect(element.querySelector('.lark-doc-image-share-preview .lark-doc-bookmark-cover')).not.toBeNull())
    const preview = element.querySelector('.lark-doc-image-share-preview')
    expect(preview.querySelector('.lark-doc-bookmark-cover').style.backgroundImage).toContain('https://assets.example.test/cover.png')
    expect(preview.querySelector('.lark-doc-bookmark-icon').style.backgroundImage).toContain('https://assets.example.test/icon.png')
    expect(preview.querySelector('iframe,script,button,a[href]')).toBeNull()
  }, { content: { type: 'doc', content: [{ type: kind, attrs: kind === 'bookmark' ? { blockId: 'shared_card_media', url: 'https://example.test', title: '网页卡片', cover: 'https://assets.example.test/cover.png', favicon: 'https://assets.example.test/icon.png' } : { blockId: 'shared_card_media', href: 'https://example.test', view: 'card', cardMeta: JSON.stringify({ title: '网页卡片', cover: 'https://assets.example.test/cover.png', favicon: 'https://assets.example.test/icon.png' }) } }] } }))
  it.each(['offline', 'allowlist'])('摘录%s不将伪本地图片路径当作离线资源', mode => {
    const source = document.createElement('div'), image = document.createElement('img')
    image.setAttribute('src', '/' + String.fromCharCode(92) + 'outside.example.test/track.png')
    source.appendChild(image)
    const clone = cloneShareExcerpt(source, createNetworkPolicy({ mode, allowlist: [] }))
    expect(clone.querySelector('img').getAttribute('src')).toBe(BLOCKED_IMAGE_PLACEHOLDER)
  })
  it('静态摘录只对合法网页卡片媒体保留单个URL，其余活动内容仍被清理', () => {
    const source = document.createElement('div')
    source.innerHTML = '<div class="lark-doc-bookmark-cover" style="background-image:url(https://denied.example/cover.png)"></div><div class="lark-doc-bookmark-icon" style="background-image:url(javascript:alert)"></div><div class="arbitrary" style="background-image:url(https://allowed.example/track.png)"></div><iframe src="https://allowed.example/frame"></iframe><button onclick="alert(1)">按钮</button><script>alert(1)</script>'
    const clone = cloneShareExcerpt(source, createNetworkPolicy({ mode: 'allowlist', allowlist: ['allowed.example'] }))
    expect(clone.querySelectorAll('[style*="url("]')).toHaveLength(0)
    expect(clone.querySelector('iframe,script,button,[onclick]')).toBeNull()
  })
  it('预览分享使用静态内嵌网页卡且派发独立回调，正文不变', () => withSelectionShare(async ({ doc, host, element, onSelectionShare, onImageShare }) => {
    const before = doc.getJSON()
    expect(host.openSelectionShareDialog(0)).toBe(true)
    await vi.waitFor(() => expect(element.querySelector('.lark-doc-image-share-dialog')).not.toBeNull())
    const preview = element.querySelector('.lark-doc-image-share-preview')
    expect(preview.textContent).toContain('内嵌网页')
    expect(preview.textContent).toContain('该内容暂不支持预览')
    expect(preview.querySelector('iframe,script,input,button')).toBeNull()
    await vi.waitFor(() => expect(element.querySelectorAll('.lark-doc-image-share-result')).toHaveLength(1))
    choose(host)
    host.setImageShareMessage('发送留言')
    expect(await host.submitImageShare()).toBe(true)
    expect(onImageShare).not.toHaveBeenCalled()
    expect(onSelectionShare).toHaveBeenCalledOnce()
    expect(onSelectionShare.mock.calls[0][0]).toMatchObject({ selection: { type: 'node', blockId: 'shared_link' }, recipients: [{ id: 'recipient', kind: 'user' }], message: '发送留言' })
    expect(onSelectionShare.mock.calls[0][0].url).toContain('#share-shared_link')
    expect(doc.getJSON()).toEqual(before)
  }))
  it('表格分享静态预览保留整表与所选格，回调content只取真实矩形', () => withSelectionShare(async ({ doc, host, element, onSelectionShare }) => {
    const editor = doc.getEditor()
    editor.commands.setContent({ type: 'doc', content: [{ type: 'table', attrs: { blockId: 'shared_table' }, content: Array.from({ length: 3 }, (_, row) => ({ type: 'tableRow', content: Array.from({ length: 3 }, (_, col) => ({ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: `${'ABC'[col]}${row + 1}` }] }] })) })) }] })
    const cells = []
    editor.state.doc.descendants((node, pos) => { if (node.type.name === 'tableCell') cells.push(pos) })
    editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc, cells[0], cells[4])))
    expect(host.openSelectionShareDialog()).toBe(true)
    await vi.waitFor(() => expect(element.querySelectorAll('.lark-doc-image-share-preview td')).toHaveLength(9))
    const preview = element.querySelector('.lark-doc-image-share-preview')
    expect(preview.querySelectorAll('td.selectedCell')).toHaveLength(4)
    expect(preview.querySelector('button,input,iframe,[contenteditable]')).toBeNull()
    await vi.waitFor(() => expect(element.querySelectorAll('.lark-doc-image-share-result')).toHaveLength(1))
    choose(host)
    expect(await host.submitImageShare()).toBe(true)
    const sent = onSelectionShare.mock.calls[0][0].selection
    expect(sent).toMatchObject({ type: 'cell', blockId: 'shared_table' })
    expect(JSON.stringify(sent.content)).toContain('A1')
    expect(JSON.stringify(sent.content)).not.toContain('C1')
  }))
  it('表格块菜单提供真实分享和可解析的区块定位链接', () => withSelectionShare(async ({ doc, host }) => {
    doc.getEditor().commands.setContent('<table data-block-id="block_share_table"><tbody><tr><td><p>表格内容</p></td></tr></tbody></table>')
    host.handleRange = { from: 0, to: doc.getEditor().state.doc.firstChild.nodeSize }
    expect(host.buildBlockMenuState().listActions.map(item => item.id)).toEqual(expect.arrayContaining(['share', 'copyLink']))
    expect(await host.blockAction('share')).toBe(true)
    expect(host.imageShare).toMatchObject({ target: 'selection', selection: { blockId: 'block_share_table', type: 'cell' } })
    host.closeImageShareDialog()
    host.copyShareText = vi.fn(async () => true)
    expect(await host.blockAction('copyLink')).toBe(true)
    expect(host.copyShareText.mock.calls[0][0]).toContain('#share-block_share_table')
  }))
  it.each([false, true])('复制链接等待期间替换正文后忽略旧%s提示', rejected => withSelectionShare(async ({ doc, host }) => {
    doc.getEditor().commands.setContent('<table data-block-id="clipboard_table"><tbody><tr><td><p>复制原表</p></td></tr></tbody></table>')
    host.handleRange = { from: 0, to: doc.getEditor().state.doc.firstChild.nodeSize }
    let finish
    host.copyShareText = () => new Promise((resolve, reject) => { finish = () => rejected ? reject(new Error('旧剪贴板错误')) : resolve(true) })
    host.showShareToast = vi.fn()
    const errorBefore = host.error
    const pending = host.blockAction('copyLink')
    doc.getEditor().commands.setContent('<p>新文档正文</p>')
    finish()
    expect(await pending).toBe(false)
    expect(host.showShareToast).not.toHaveBeenCalled()
    expect(host.error).toBe(errorBefore)
  }))
  it('链接预览浮窗的分享按钮打开真实选区分享弹窗', () => withSelectionShare(async ({ host, element }) => {
    host.onLinkMouseOver({ target: element.querySelector('[data-type="link-embed"]') })
    await vi.waitFor(() => expect(element.querySelector('.lark-doc-link-tools')).not.toBeNull())
    const button = element.querySelector('.lark-doc-link-tools button[aria-label="分享"]')
    expect(button).not.toBeNull()
    button.click()
    expect(host.imageShare).toMatchObject({ target: 'selection', selection: { blockId: 'shared_link' } })
  }))
  it.each([{ crop: null }, { crop: [0.1, 0.1, 0.8, 0.8] }])('选区分享后切图片分享不能继承198px旧视窗（%j）', ({ crop }) => withSelectionShare(async ({ doc, host, element }) => {
    host.openSelectionShareDialog(0)
    await vi.waitFor(() => expect(element.querySelector('.lark-doc-selection-share-content')).not.toBeNull())
    expect(element.querySelector('.lark-doc-selection-share-content').style.height).toBe('198px')
    doc.getEditor().commands.setContent({ type: 'doc', content: [{ type: 'image', attrs: { blockId: 'image_after_selection', src: '/a.png', width: 323, naturalWidth: 323, naturalHeight: 275, crop } }] })
    host.openImageShareDialog({ ...doc.getEditor().state.doc.firstChild.attrs, pos: 0 })
    await vi.waitFor(() => expect(element.querySelector('.lark-doc-image-share-preview-frame img')).not.toBeNull())
    const image = element.querySelector('.lark-doc-image-share-preview-frame img')
    expect(image.parentElement.style.height).toBe('')
  }))
  it('未接分享服务时保留查看与取消，绝不派发图片服务假成功', () => withSelectionShare(async ({ host, element, onImageShare }) => {
    expect(host.openSelectionShareDialog(0)).toBe(true)
    await vi.waitFor(() => expect(element.querySelectorAll('.lark-doc-image-share-result')).toHaveLength(1))
    choose(host)
    const send = element.querySelector('.lark-doc-image-share-footer .is-primary')
    expect(send.disabled).toBe(true)
    expect(await host.submitImageShare()).toBe(false)
    expect(onImageShare).not.toHaveBeenCalled()
    expect(host.imageShare).not.toBeNull()
    host.closeImageShareDialog()
    expect(host.imageShare).toBeNull()
  }, { onSelectionShare: null }))
  it.each(['insert-before', 'delete-target'])('选区建立后 %s 只发送仍有效的真实块', change => withSelectionShare(async ({ doc, host, element, onSelectionShare }) => {
    host.openSelectionShareDialog(0)
    await vi.waitFor(() => expect(element.querySelectorAll('.lark-doc-image-share-result')).toHaveLength(1))
    choose(host)
    if (change === 'insert-before') doc.getEditor().commands.insertContentAt(0, '<p>前置段落</p>')
    else doc.getEditor().commands.setContent('<p data-block-id="replacement">新正文</p>')
    const result = await host.submitImageShare()
    if (change === 'insert-before') { expect(result).toBe(true); expect(onSelectionShare).toHaveBeenCalledOnce() }
    else { expect(result).toBe(false); expect(onSelectionShare).not.toHaveBeenCalled() }
  }))
  it('取消中止旧发送，迟到响应不能清除新打开的分享', () => {
    let finish, signal
    const onSelectionShare = vi.fn(input => { signal = input.signal; return new Promise(resolve => { finish = resolve }) })
    return withSelectionShare(async ({ host, element }) => {
      host.openSelectionShareDialog(0)
      await vi.waitFor(() => expect(element.querySelectorAll('.lark-doc-image-share-result')).toHaveLength(1))
      choose(host)
      const pending = host.submitImageShare()
      host.closeImageShareDialog()
      expect(signal.aborted).toBe(true)
      host.openSelectionShareDialog(0)
      const current = host.imageShare
      finish(true)
      expect(await pending).toBe(false)
      expect(host.imageShare).toBe(current)
    }, { onSelectionShare })
  })
  it('服务拒绝发送时保留接收人与留言，允许明确重试', () => {
    const onSelectionShare = vi.fn().mockRejectedValueOnce(new Error('选区发送失败')).mockResolvedValue(true)
    return withSelectionShare(async ({ host, element }) => {
      host.openSelectionShareDialog(0)
      await vi.waitFor(() => expect(element.querySelectorAll('.lark-doc-image-share-result')).toHaveLength(1))
      choose(host)
      host.setImageShareMessage('保留的留言')
      expect(await host.submitImageShare()).toBe(false)
      expect(host.imageShare).toMatchObject({ sending: false, message: '保留的留言', error: '选区发送失败', recipients: [{ id: 'recipient' }] })
      expect(await host.submitImageShare()).toBe(true)
      expect(onSelectionShare).toHaveBeenCalledTimes(2)
      expect(host.imageShare).toBeNull()
    }, { onSelectionShare })
  })
  it('发送等待期间撤销内容导出权限会中止并拒绝迟到确认', () => {
    let finish, signal
    const onSelectionShare = vi.fn(input => { signal = input.signal; return new Promise(resolve => { finish = resolve }) })
    return withSelectionShare(async ({ doc, host, element }) => {
      host.openSelectionShareDialog(0)
      await vi.waitFor(() => expect(element.querySelectorAll('.lark-doc-image-share-result')).toHaveLength(1))
      choose(host)
      const pending = host.submitImageShare()
      const session = doc.getSession()
      session.setProvider('authorization', { getCapabilities: async () => ({ canView: true, canExport: false }) })
      await session.refreshCapabilities()
      expect(signal.aborted).toBe(true)
      expect(host.imageShare).toBeNull()
      finish(true)
      expect(await pending).toBe(false)
      expect(host.openSelectionShareDialog(0)).toBe(false)
    }, { onSelectionShare })
  })
})

describe('图片 AI 真实门面接线', () => {
  it.each(['insert-before', 'delete', 'replace'])('图片准备期间 %s 保留有效提问或取消真实失效引用', async change => {
    stubRangeLayout()
    const element = document.createElement('div')
    document.body.appendChild(element)
    const stream = vi.fn(() => ({ cancel() {} }))
    const doc = new LarkDoc({ element, storage: 'none', ai: { supportsImages: true, stream }, content: { type: 'doc', content: [{ type: 'image', attrs: { src: '/image.png', blockId: 'image_ai' } }] } })
    try {
      await new Promise(resolve => setTimeout(resolve, 0))
      const editor = doc.getEditor(), workspace = doc.getWorkspace()
      workspace.openImageAI({ ...editor.state.doc.firstChild.attrs, pos: 0 })
      const controller = doc._handle.workspaceController
      let finish
      controller.prepareAIImage = () => new Promise(resolve => { finish = resolve })
      workspace.state.aiPrompt = '有效问题'
      const sending = workspace.sendAIChat()
      if (change === 'insert-before') editor.commands.insertContentAt(0, '<p>新段落</p>')
      if (change === 'delete') editor.commands.deleteRange({ from: 0, to: 1 })
      if (change === 'replace') editor.commands.updateAttributes('image', { src: '/other.png' })
      finish({ url: 'data:image/png;base64,YQ==', blockId: 'image_ai' })
      await sending
      if (change === 'insert-before') {
        expect(workspace.state.aiImage.pos).toBeGreaterThan(0)
        expect(stream).toHaveBeenCalledOnce()
        expect(stream.mock.calls[0][0].prompt).toBe('有效问题')
      } else {
        expect(stream).not.toHaveBeenCalled()
        expect(workspace.state.aiImage).toBeNull()
        expect(workspace.state.aiRunning).toBe(false)
      }
    } finally { doc.destroy(); element.remove() }
  })

  it('调整宽度、对齐和说明保留图片引用，实际裁剪或地址变化才使引用失效', async () => {
    stubRangeLayout()
    const element = document.createElement('div')
    document.body.appendChild(element)
    const doc = new LarkDoc({ element, storage: 'none', content: { type: 'doc', content: [{ type: 'image', attrs: { src: '/image.png', blockId: 'image_ai' } }] } })
    try {
      await new Promise(resolve => setTimeout(resolve, 0))
      const editor = doc.getEditor(), workspace = doc.getWorkspace()
      expect(workspace.openImageAI({ ...editor.state.doc.firstChild.attrs, pos: 0 })).toBe(true)
      for (const attrs of [{ width: 200 }, { align: 'left' }, { caption: 'new caption' }]) {
        editor.commands.updateAttributes('image', attrs)
        expect(workspace.state.aiImage?.blockId).toBe('image_ai')
        expect(workspace.state.aiError).toBe('')
      }
      editor.commands.updateAttributes('image', { crop: [0, 0, .5, 1] })
      expect(workspace.state.aiImage).toBeNull()
      expect(workspace.state.aiError).toContain('图片已改变')
      expect(workspace.openImageAI({ ...editor.state.doc.firstChild.attrs, pos: 0 })).toBe(true)
      editor.commands.updateAttributes('image', { src: '/other.png' })
      expect(workspace.state.aiImage).toBeNull()
    } finally { doc.destroy(); element.remove() }
  })

  it('不同 session 打开普通 AI 时看不到上一图片问答的草稿、问题和回复', async () => {
    stubRangeLayout()
    const element = document.createElement('div')
    document.body.appendChild(element)
    const sessionB = createDocumentSession({ documentId: 'image-ai-b', user: { id: 'b' } })
    const doc = new LarkDoc({ element, storage: 'none', ai: { stream(args) { args.onChunk('PRIVATE A ANSWER'); args.onDone(); return { cancel() {} } } }, content: { type: 'doc', content: [{ type: 'image', attrs: { src: '/image.png', blockId: 'image_ai' } }] } })
    try {
      const nodeView = doc.getEditor().view.docView.children.find(child => child.node.type.name === 'image').spec
      nodeView.mountToolbar()
      nodeView.dom.querySelector('[data-action="ai"]').click()
      await new Promise(resolve => setTimeout(resolve, 0))
      const panel = element.querySelector('[aria-label="图片问答"]')
      panel.querySelector('[aria-label="移除图片引用"]').click()
      const prompt = panel.querySelector('textarea')
      prompt.value = 'PRIVATE A QUESTION'
      prompt.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise(resolve => setTimeout(resolve, 0))
      panel.querySelector('[aria-label="发送图片问答"]').click()
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(panel.textContent).toContain('PRIVATE A ANSWER')
      prompt.value = 'PRIVATE A DRAFT'
      prompt.dispatchEvent(new Event('input', { bubbles: true }))
      doc.patchProps({ session: sessionB })
      await new Promise(resolve => setTimeout(resolve, 0))
      const workspace = doc.getWorkspace()
      expect(workspace.state.aiMessages).toEqual([])
      expect(workspace.state.aiPrompt).toBe('')
      expect(workspace.state.aiPreview).toBe('')
      workspace.startAI('chat', { prompt: 'B question' })
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(element.querySelector('.lark-doc-ai-messages')).toBeNull()
      expect(element.textContent).not.toContain('PRIVATE A QUESTION')
      expect(element.textContent).not.toContain('PRIVATE A DRAFT')
    } finally { doc.destroy(); sessionB.dispose(); element.remove() }
  })

  it('工具条打开图片引用而不生成，移除引用不改正文，热禁用 AI 关闭侧栏并隐藏入口', async () => {
    stubRangeLayout()
    const element = document.createElement('div')
    document.body.appendChild(element)
    const stream = vi.fn(() => ({ cancel() {} }))
    const doc = new LarkDoc({ element, storage: 'none', ai: { supportsImages: true, stream }, content: { type: 'doc', content: [{ type: 'image', attrs: { src: '/image.png', blockId: 'image_ai' } }] } })
    try {
      const before = JSON.stringify(doc.getJSON())
      const nodeView = doc.getEditor().view.docView.children.find(child => child.node.type.name === 'image').spec
      nodeView.mountToolbar()
      const ask = nodeView.dom.querySelector('[data-action="ai"]')
      expect(ask.textContent).toBe('问问AI')
      ask.click()
      await new Promise(resolve => setTimeout(resolve, 0))
      const panel = element.querySelector('[aria-label="图片问答"]')
      expect(panel).not.toBeNull()
      expect(panel.querySelector('.lark-doc-image-ai-reference').hidden).toBe(false)
      expect(panel.querySelector('[aria-label="发送图片问答"]').disabled).toBe(true)
      expect(document.activeElement).toBe(panel.querySelector('textarea'))
      expect(stream).not.toHaveBeenCalled()
      panel.querySelector('[aria-label="移除图片引用"]').click()
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(panel.querySelector('.lark-doc-image-ai-reference').hidden).toBe(true)
      expect(JSON.stringify(doc.getJSON())).toBe(before)
      doc.patchProps({ config: { features: { ai: false } } })
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(element.querySelector('[aria-label="图片问答"]')).toBeNull()
      nodeView.mountToolbar()
      expect(nodeView.dom.querySelector('[data-action="ai"]')).toBeNull()
    } finally { doc.destroy(); element.remove() }
  })
})

describe('public reference content and asynchronous comments', () => {
  it.each(['offline', 'allowlist'])('does not restore blocked originals through image Reset in %s mode', async mode => {
    stubRangeLayout()
    const element = document.createElement('div')
    document.body.appendChild(element)
    const doc = new LarkDoc({ element, storage: 'none', config: { network: { mode, allowlist: ['allowed.example'] } }, content: { type: 'doc', content: [{ type: 'image', attrs: { src: 'https://blocked.example/original.png', blockId: 'image_a' } }] } })
    try {
      const editor = doc.getEditor(), view = editor.view.docView.children.find(child => child.node.type.name === 'image').spec
      view.mountToolbar()
      expect(editor.state.doc.firstChild.attrs.src).toBe(BLOCKED_IMAGE_PLACEHOLDER)
      expect(view.dom.querySelector('[data-action="reset"]')).toBeNull()
      expect(view.reset()).toBe(false)
      expect(editor.state.doc.firstChild.attrs.src).toBe(BLOCKED_IMAGE_PLACEHOLDER)
      expect(view.dom.querySelector('img').getAttribute('src')).toBeNull()
      doc.setContent({ type: 'doc', content: [{ type: 'image', attrs: { src: '/safe-crop.png', originalSrc: 'https://blocked.example/original.png', blockId: 'image_a' } }] })
      const replacement = editor.view.docView.children.find(child => child.node.type.name === 'image').spec
      expect(replacement.reset()).toBe(false)
      expect(editor.state.doc.firstChild.attrs.src).toBe('/safe-crop.png')
    } finally { doc.destroy(); element.remove() }
  })

  it('checks current policy on Reset while allowing metadata-only crop reset of a local image', () => {
    stubRangeLayout()
    const element = document.createElement('div')
    document.body.appendChild(element)
    const attrs = { blockId: 'image_a', src: '/safe-crop.png', originalSrc: 'https://blocked.example/original.png', width: 463, naturalWidth: 323, naturalHeight: 275, crop: [0, 0, 0.8704, 1] }
    const doc = new LarkDoc({ element, storage: 'none', content: { type: 'doc', content: [{ type: 'image', attrs }] } })
    try {
      doc.patchProps({ config: { network: { mode: 'offline' } } })
      const editor = doc.getEditor(), view = editor.view.docView.children.find(child => child.node.type.name === 'image').spec
      expect(view.reset()).toBe(true)
      expect(editor.state.doc.firstChild.attrs).toMatchObject({ src: '/safe-crop.png', crop: null, width: 463 })
    } finally { doc.destroy(); element.remove() }
  })

  it('locates viewer image comments by stable block identity after preceding text changes', async () => {
    stubRangeLayout()
    const element = document.createElement('div')
    document.body.appendChild(element)
    const comments = createMemoryCommentsProvider()
    const doc = new LarkDoc({ element, storage: 'none', comments, user: { id: 'me' }, content: { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'x' }] },
      { type: 'image', attrs: { blockId: 'image_a', src: '/a.png' } },
      { type: 'image', attrs: { blockId: 'image_b', src: '/b.png' } },
    ] } })
    try {
      const editor = doc.getEditor(), host = doc._handle.nativeHost.host
      const snapshot = { ...editor.state.doc.nodeAt(3).attrs, pos: 3 }
      editor.commands.deleteRange({ from: 1, to: 2 })
      const viewer = document.createElement('div')
      element.appendChild(viewer)
      host.openImageComments(snapshot, true, viewer)
      expect(host.commentSelectionRange().blockId).toBe('image_a')
      host.setCommentComposerDraft('A 的评论')
      await host.submitCommentComposer()
      expect((await comments.list())[0].blockId).toBe('image_a')
    } finally { doc.destroy(); element.remove() }
  })

  it('clears and reloads comments, private drafts and edits on session and provider replacement', async () => {
    stubRangeLayout()
    const element = document.createElement('div')
    document.body.appendChild(element)
    const provider = content => createMemoryCommentsProvider({ threads: [{ id: 'same', blockId: 'b1', author: { id: 'me' }, replies: [{ id: 'r1', author: { id: 'me' }, content }] }] })
    const sessionA = createDocumentSession({ documentId: 'a', user: { id: 'me' }, providers: { comments: provider('A 私有内容') } })
    const sessionB = createDocumentSession({ documentId: 'b', user: { id: 'me' }, providers: { comments: provider('B 内容') } })
    const doc = new LarkDoc({ element, storage: 'none', session: sessionA, content: '<p data-block-id="b1">正文</p>' })
    try {
      const host = doc._handle.nativeHost.host
      await host.loadComments()
      host.commentDrafts = { same: 'A 私有草稿' }
      host.beginCommentEdit('same', 'r1')
      doc.patchProps({ session: sessionB })
      await vi.waitFor(() => expect(host.commentThreads[0]?.replies[0]?.content).toBe('B 内容'))
      expect(host.commentDrafts).toEqual({})
      expect(host.commentEditing).toBeNull()
      host.commentDrafts = { same: 'B 草稿' }
      sessionB.setProvider('comments', provider('C 新来源'))
      await vi.waitFor(() => expect(host.commentThreads[0]?.replies[0]?.content).toBe('C 新来源'))
      expect(host.commentDrafts).toEqual({})
    } finally { doc.destroy(); await sessionA.dispose(); await sessionB.dispose(); element.remove() }
  })

  it('preserves the active edit DOM, draft and caret when another reply reloads', async () => {
    stubRangeLayout()
    const element = document.createElement('div')
    document.body.appendChild(element)
    const comments = createMemoryCommentsProvider({ threads: [{ id: 'thread', blockId: 'b1', author: { id: 'me' }, replies: [{ id: 'r1', author: { id: 'me' }, content: 'saved' }] }] })
    const doc = new LarkDoc({ element, storage: 'none', comments, user: { id: 'me' }, content: '<p data-block-id="b1">正文</p>' })
    try {
      const host = doc._handle.nativeHost.host
      await host.loadComments()
      host.beginCommentEdit('thread', 'r1')
      await vi.waitFor(() => expect(element.querySelector('.lark-doc-comment-edit-input')).not.toBeNull())
      const input = element.querySelector('.lark-doc-comment-edit-input')
      input.value = 'unsaved draft'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.focus()
      input.setSelectionRange(2, 2)
      await comments.reply({ threadId: 'thread', author: { id: 'other' }, content: 'remote reply' })
      await host.loadComments()
      expect(element.querySelector('.lark-doc-comment-edit-input')).toBe(input)
      expect(input.value).toBe('unsaved draft')
      expect(input.selectionStart).toBe(2)
      expect(await host.confirmCommentEdit('thread', 'r1', input.value)).toBe(true)
      expect(host.commentEditing).toBeNull()
      expect((await comments.list())[0].replies[0].content).toBe('unsaved draft')
    } finally { doc.destroy(); element.remove() }
  })

  it('closes an acknowledged image comment even if the post-write list refresh fails', async () => {
    stubRangeLayout()
    const element = document.createElement('div')
    document.body.appendChild(element)
    const comments = createMemoryCommentsProvider(), listStored = comments.list
    const doc = new LarkDoc({ element, storage: 'none', comments, user: { id: 'me' }, content: { type: 'doc', content: [{ type: 'image', attrs: { src: '/a.png', blockId: 'image_a' } }] } })
    try {
      const host = doc._handle.nativeHost.host
      await host.loadComments()
      host.beginCommentComposer(0)
      host.setCommentComposerDraft('已保存的评论')
      comments.list = vi.fn(async () => { throw new Error('refresh failed') })
      expect((await host.submitCommentComposer()).id).toBeTruthy()
      expect(host.commentComposer).toBeNull()
      expect(host.error).toContain('已保存')
      expect(await host.submitCommentComposer()).toBeNull()
      expect(await listStored()).toHaveLength(1)
    } finally { doc.destroy(); element.remove() }
  })

  it('shares a contextual image excerpt and selects recipients without changing the document', async () => {
    stubRangeLayout()
    const element = document.createElement('div')
    document.body.appendChild(element)
    const doc = new LarkDoc({ element, storage: 'none', onImageShare: vi.fn(async () => true),
      mentionSource: [{ kind: 'user', id: 'one', name: 'First' }, { kind: 'chat', id: 'two', name: 'Second' }],
      content: { type: 'doc', content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Before image', marks: [{ type: 'bold' }] }] },
        { type: 'image', attrs: { src: '/a.png', width: 323, naturalWidth: 323, naturalHeight: 275, blockId: 'image_a' } },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'After image' }] },
      ] } })
    try {
      const host = doc._handle.nativeHost.host, saved = doc.getJSON()
      const imagePos = doc.getEditor().state.doc.firstChild.nodeSize
      host.openImageShareDialog({ ...doc.getEditor().state.doc.nodeAt(imagePos).attrs, pos: imagePos })
      await vi.waitFor(() => expect(element.querySelectorAll('.lark-doc-image-share-result')).toHaveLength(2))
      const excerpt = element.querySelector('.lark-doc-image-share-excerpt')
      expect(excerpt.style.height).toBe('397px')
      expect(excerpt.querySelector('.is-before').textContent).toBe('Before image')
      expect(excerpt.querySelector('.is-before strong')).toBeTruthy()
      expect(excerpt.querySelector('[data-block-id]')).toBeNull()
      expect(excerpt.querySelector('.is-after').textContent).toBe('After image')
      host.$forceUpdate()
      await host.$nextTick()
      expect(host.imageShare).not.toBeNull()
      const input = element.querySelector('.lark-doc-image-share-selector input')
      input.focus()
      const results = element.querySelector('.lark-doc-image-share-results')
      element.querySelector('.lark-doc-image-share-result').click()
      expect(results.hidden).toBe(true)
      expect(document.activeElement).toBe(input)
      input.click()
      expect(results.hidden).toBe(false)
      element.querySelectorAll('.lark-doc-image-share-result')[1].click()
      expect(results.hidden).toBe(true)
      expect(host.imageShare.recipients.map(item => item.id)).toEqual(['one', 'two'])
      host.toggleImageShareRecipient('one', 'user')
      host.toggleImageShareRecipient('two', 'chat')
      await vi.waitFor(() => expect(element.querySelectorAll('.lark-doc-image-share-recipients button')).toHaveLength(0))
      input.click()
      element.querySelector('.lark-doc-image-share-results-head button').click()
      expect(element.querySelectorAll('.lark-doc-image-share-check')).toHaveLength(2)
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, isComposing: true }))
      expect(host.imageShare.recipients).toHaveLength(0)
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      expect(host.imageShare.recipients.map(item => item.id)).toEqual(['two'])
      await vi.waitFor(() => expect(element.querySelector('.lark-doc-image-share-recipients button')).toBeTruthy())
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }))
      expect(host.imageShare.recipients).toHaveLength(0)
      expect(doc.getJSON()).toEqual(saved)
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      expect(host.imageShare).toBeNull()
      host.openImageShareDialog({ ...doc.getEditor().state.doc.nodeAt(imagePos).attrs, pos: imagePos })
      const previous = host.session, replacement = createDocumentSession()
      try {
        host.session = replacement
        await host.$nextTick()
        expect(host.imageShare).toBeNull()
      } finally { host.session = previous; replacement.dispose() }
    } finally { doc.destroy(); element.remove() }
  })

  it('keeps a cropped small image at its displayed size in the share excerpt', async () => {
    stubRangeLayout()
    const element = document.createElement('div')
    document.body.appendChild(element)
    const doc = new LarkDoc({ element, storage: 'none', content: { type: 'doc', content: [
      { type: 'image', attrs: { src: '/a.png', width: 180, naturalWidth: 400, naturalHeight: 300, crop: [0, 0, .5, 1], caption: 'Caption', blockId: 'image_a' } },
    ] } })
    try {
      const host = doc._handle.nativeHost.host
      host.openImageShareDialog({ ...doc.getEditor().state.doc.firstChild.attrs, pos: 0 })
      await vi.waitFor(() => expect(element.querySelector('.lark-doc-image-share-excerpt')).toBeTruthy())
      const excerpt = element.querySelector('.lark-doc-image-share-excerpt')
      expect(excerpt.children[1].style.width).toBe('90px')
      expect(excerpt.style.height).toBe('285px')
      expect(excerpt.querySelector('figcaption').textContent).toBe('Caption')
      expect(excerpt.parentElement.style.width).toBe('322px')
      expect(excerpt.parentElement.style.height).toBe('228px')
    } finally { doc.destroy(); element.remove() }
  })

  it.each(['offline', 'allowlist', 'open'])('applies the live %s network gate to share avatars and copied context', async mode => {
    stubRangeLayout()
    const element = document.createElement('div')
    document.body.appendChild(element)
    const doc = new LarkDoc({ element, storage: 'none', config: { network: { mode, allowlist: ['allowed.example'] } },
      mentionSource: [{ kind: 'user', id: 'allowed', name: 'Allowed', avatar: 'https://allowed.example/avatar.png' }, { kind: 'user', id: 'blocked', name: 'Blocked', avatar: 'https://blocked.example/avatar.png' }],
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Context' }] }, { type: 'image', attrs: { src: '/a.png', blockId: 'image_a', naturalWidth: 400, naturalHeight: 300 } }] } })
    try {
      const editor = doc.getEditor(), host = doc._handle.nativeHost.host
      const context = editor.view.nodeDOM(0), remote = document.createElement('img')
      remote.src = 'https://blocked.example/context.png'
      remote.setAttribute('srcset', 'https://blocked.example/context-2x.png 2x')
      remote.setAttribute('onerror', 'window.leakedContext = true')
      context.appendChild(remote)
      const pos = editor.state.doc.firstChild.nodeSize
      host.openImageShareDialog({ ...editor.state.doc.nodeAt(pos).attrs, pos })
      await vi.waitFor(() => expect(element.querySelectorAll('.lark-doc-image-share-result')).toHaveLength(2))
      const share = element.querySelector('.lark-doc-image-share-dialog')
      const sources = [...share.querySelectorAll('.lark-doc-image-share-avatar img')].map(img => img.src)
      expect(sources).toEqual(mode === 'offline' ? [] : mode === 'allowlist' ? ['https://allowed.example/avatar.png'] : ['https://allowed.example/avatar.png', 'https://blocked.example/avatar.png'])
      const copy = share.querySelector('.is-before img')
      expect(copy.getAttribute('srcset')).toBeNull()
      expect(copy.getAttribute('onerror')).toBeNull()
      expect(copy.src).toBe(mode === 'open' ? remote.src : BLOCKED_IMAGE_PLACEHOLDER)
      if (mode === 'open') {
        doc.patchProps({ config: { network: { mode: 'offline' } } })
        await vi.waitFor(() => expect(share.querySelectorAll('.lark-doc-image-share-avatar img')).toHaveLength(0))
        expect(share.querySelector('.is-before img').src).toBe(BLOCKED_IMAGE_PLACEHOLDER)
      }
    } finally { doc.destroy(); element.remove() }
  })

  it('aborts and closes pending image sharing when the callback changes through patchProps', async () => {
    stubRangeLayout()
    const element = document.createElement('div')
    document.body.appendChild(element)
    let complete, signal
    const onImageShare = vi.fn(payload => { signal = payload.signal; return new Promise(resolve => { complete = resolve }) })
    const doc = new LarkDoc({ element, storage: 'none', onImageShare, content: { type: 'doc', content: [{ type: 'image', attrs: { src: '/a.png', blockId: 'image_a' } }] } })
    try {
      const host = doc._handle.nativeHost.host
      host.shareDocumentLink = () => 'http://localhost/document'
      const image = { ...doc.getEditor().state.doc.firstChild.attrs, pos: 0 }
      host.openImageShareDialog(image)
      host.imageShare = { ...host.imageShare, recipients: [{ id: 'test-user', kind: 'user' }] }
      const pending = host.submitImageShare()
      doc.patchProps({ onImageShare: vi.fn(async () => true) })
      await vi.waitFor(() => expect(host.imageShare).toBeNull())
      expect(signal.aborted).toBe(true)
      complete(true)
      expect(await pending).toBe(false)
    } finally { doc.destroy(); element.remove() }
  })

  it('passes host directories and actions through the real facade to candidates and node views', async () => {
    stubRangeLayout()
    const element = document.createElement('div')
    document.body.appendChild(element)
    const mentionSource = [{ id: 'u-parity', kind: 'user', name: 'Parity User' }]
    const event = { eventId: 'event-parity', title: 'Parity Event', start: '2026-11-11T10:00:00+08:00', end: '2026-11-11T11:00:00+08:00' }
    const calendarSource = { search: vi.fn(async () => [event]) }
    const onCalendarEventJoin = vi.fn()
    const calendarEventRefetch = vi.fn()
    const onIsvButtonAction = vi.fn()
    const onIsvCatalogJump = vi.fn()
    const doc = new LarkDoc({ element, storage: 'none', content: '<p></p>', mentionSource, calendarSource,
      onCalendarEventJoin, calendarEventRefetch, onIsvButtonAction, onIsvCatalogJump })
    try {
      const host = doc._handle.nativeHost.host
      host.startMention('mentionUser')
      await vi.waitFor(() => expect(host.mentionItems[0]?.id).toBe('u-parity'))
      host.setMentionNotify(false)
      host.chooseMention(host.mentionItems[0])
      expect(doc.getHTML()).toContain('Parity User')
      // Finish the mention command's scheduled focus before opening the next UI.
      await new Promise(resolve => requestAnimationFrame(resolve))
      host.startCalendarEvent()
      expect(calendarSource.search).toHaveBeenCalledWith({ query: '', range: 'future' })
      await vi.waitFor(() => expect({ open: host.calendarOpen, loading: host.calendarLoading, events: host.calendarEvents })
        .toEqual({ open: true, loading: false, events: [expect.objectContaining({ eventId: event.eventId })] }))
      await vi.waitFor(() => expect(element.querySelector('.lark-doc-calendar-search-row')?.textContent).toBe(event.title))
      element.querySelector('.lark-doc-calendar-search-row').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
      element.querySelector('.lark-doc-calendar-join').click()
      expect(onCalendarEventJoin).toHaveBeenCalledWith({ eventId: event.eventId, title: event.title })
      const extensions = doc.getEditor().extensionManager.extensions
      expect(extensions.find(extension => extension.name === 'calendar_event').options.refetch).toBe(calendarEventRefetch)
      expect(extensions.find(extension => extension.name === 'isv').options.onCatalogJump).toBe(onIsvCatalogJump)
      doc.getEditor().commands.setIsv({ kind: 'button', action: 'follow_page', buttonText: 'Follow' })
      element.querySelector('.docx-button-component').click()
      expect(onIsvButtonAction).toHaveBeenCalledWith('follow_page', expect.objectContaining({ buttonText: 'Follow' }))
    } finally { doc.destroy(); element.remove() }
  })

  async function pendingComment(action) {
    stubRangeLayout()
    const comments = createMemoryCommentsProvider()
    const createThread = comments.createThread
    let complete
    comments.createThread = input => new Promise(resolve => { complete = async () => resolve(await createThread(input)) })
    const element = document.createElement('div')
    document.body.appendChild(element)
    const doc = new LarkDoc({ element, storage: 'none', content: '<p>alpha target omega</p>', comments,
      user: { id: 'u-parity', name: 'Parity' } })
    const host = doc._handle.nativeHost.host
    const editor = doc.getEditor()
    const markText = () => {
      const parts = []
      editor.state.doc.descendants(node => { if (node.isText && node.marks.some(mark => mark.type.name === 'comment')) parts.push(node.text) })
      return parts.join('')
    }
    try {
      editor.commands.setTextSelection({ from: 7, to: 13 })
      const pending = host.createCommentFromSelection('Review target')
      action({ doc, host, editor })
      await complete()
      const result = await pending
      return { result, marked: editor.isDestroyed ? '' : markText() }
    } finally { doc.destroy(); element.remove() }
  }

  it('keeps an in-flight comment on the same text when preceding typing moves its range', async () => {
    const result = await pendingComment(({ editor }) => editor.commands.insertContentAt(1, 'XXX '))
    expect(result.result?.id).toBeTruthy()
    expect(result.marked).toBe('target')
  })

  it.each(['readonly', 'destroy', 'replace', 'target', 'permission', 'provider'])('does not attach a late comment after %s', async action => {
    const result = await pendingComment(({ doc, host, editor }) => {
      if (action === 'readonly') doc.setReadonly(true)
      if (action === 'destroy') doc.destroy()
      if (action === 'replace') doc.setContent('<p>different document</p>')
      if (action === 'target') editor.commands.deleteRange({ from: 7, to: 13 })
      if (action === 'permission') vi.spyOn(host.session, 'can').mockImplementation(capability => capability !== 'canComment')
      if (action === 'provider') host.session.providers.comments = createMemoryCommentsProvider()
    })
    expect(result.result).toBeNull()
    expect(result.marked).toBe('')
  })
})

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
  it('默认图片上限为 20 MB，并保留宿主自定义上限', () => {
    const element = document.createElement('div')
    document.body.appendChild(element)
    const doc = new LarkDoc({ element, content: '<p></p>' })
    try {
      expect(doc._handle.nativeHost.host.effectiveImageMaxSize).toBe(20 * 1024 * 1024)
      doc.patchProps({ config: { limits: { maxImageSize: 1024 } } })
      expect(doc._handle.nativeHost.host.effectiveImageMaxSize).toBe(1024)
    } finally { doc.destroy(); element.remove() }
  })

  it('cancels an upload when images are disabled and rejects a provider that still resolves late', async () => {
    let finish, signal
    const element = document.createElement('div'); document.body.appendChild(element)
    const doc = new LarkDoc({ element, content: '<p>keep</p>', uploader: { upload: (_file, context) => { signal = context.signal; return new Promise(resolve => { finish = resolve }) } } })
    try {
      const pending = doc._handle.nativeHost.host.insertImageFiles([new File(['png'], 'delayed.png', { type: 'image/png' })])
      doc.patchProps({ config: { features: { images: false } } })
      expect(signal.aborted).toBe(true)
      finish({ url: '/late.png' })
      await pending
      expect(doc.getJSON().content.some(node => node.type === 'image')).toBe(false)
      expect(doc.getEditor().state.doc.textContent).toBe('keep')
    } finally { doc.destroy(); element.remove() }
  })

  it.each([true, false])('uses the current image policy for URL paste (initial=%s)', async initial => {
    const element = document.createElement('div'); document.body.appendChild(element)
    const doc = new LarkDoc({ element, content: '<p></p>', config: { features: { images: initial } } })
    const paste = () => {
      const event = new Event('paste', { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'clipboardData', { value: { files: [], getData: type => type === 'text/plain' ? 'https://example.com/photo.png' : '' } })
      doc.getEditor().view.dom.dispatchEvent(event)
      return event
    }
    try {
      doc.patchProps({ config: { features: { images: false } } })
      paste()
      expect(doc.getJSON().content.some(node => node.type === 'image')).toBe(false)
      expect(doc.getEditor().state.doc.textContent).toContain('https://example.com/photo.png')
      doc.patchProps({ config: { features: { images: true } } })
      doc.setContent('<p></p>')
      expect(paste().defaultPrevented).toBe(true)
      expect(doc.getJSON().content.some(node => node.type === 'image')).toBe(true)
    } finally { doc.destroy(); element.remove() }
  })

  it('does not consume a file paste or drop while the image capability is disabled', async () => {
    const upload = vi.fn(async () => ({ url: '/photo.png' }))
    const element = document.createElement('div'); document.body.appendChild(element)
    const doc = new LarkDoc({ element, content: '<p></p>', uploader: { upload } })
    try {
      vi.spyOn(doc.getEditor().view, 'posAtCoords').mockReturnValue({ pos: 1, inside: 0 })
      doc.patchProps({ config: { features: { images: false } } })
      for (const type of ['paste', 'drop']) {
        const event = new Event(type, { bubbles: true, cancelable: true })
        Object.defineProperty(event, type === 'paste' ? 'clipboardData' : 'dataTransfer', { value: { files: [new File(['png'], 'photo.png', { type: 'image/png' })], getData: () => '', types: ['Files'] } })
        doc.getEditor().view.dom.dispatchEvent(event)
        expect(event.defaultPrevented).toBe(false)
      }
      await Promise.resolve()
      expect(upload).not.toHaveBeenCalled()
    } finally { doc.destroy(); element.remove() }
  })

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

  it('上传占位随正文编辑映射，完成时保留用户的新光标和原来的插入位置', async () => {
    stubRangeLayout()
    let complete
    const element = document.createElement('div')
    document.body.appendChild(element)
    const doc = new LarkDoc({ element, content: '<p>first</p><p>second</p>', uploader: () => new Promise(resolve => { complete = resolve }) })
    try {
      const editor = doc.getEditor()
      editor.commands.setTextSelection(3)
      const pending = doc._handle.nativeHost.host.insertImageFiles([new File(['png'], 'a.png', { type: 'image/png' })])
      expect(element.querySelectorAll('.lark-doc-image-upload')).toHaveLength(1)
      expect(JSON.stringify(doc.getJSON())).not.toContain('blob:')
      editor.commands.insertContentAt(1, 'prefix')
      editor.commands.setTextSelection(editor.state.doc.content.size - 1)
      editor.commands.insertContent(' suffix')
      complete({ url: '/completed.png' })
      await pending
      expect(doc.getJSON().content.map(node => node.type)).toEqual(['paragraph', 'image', 'paragraph', 'paragraph'])
      expect(doc.getJSON().content.at(-1).content[0].text).toBe('second suffix')
      expect(editor.state.selection.$from.parent.textContent).toBe('second suffix')
      expect(element.querySelectorAll('.lark-doc-image-upload')).toHaveLength(0)
    } finally { doc.destroy(); element.remove() }
  })

  it('多文件预览保持顺序；删除上传占位会取消任务，晚结果不会复活图片', async () => {
    stubRangeLayout()
    const completions = []
    const onCancel = vi.fn()
    const element = document.createElement('div')
    document.body.appendChild(element)
    const doc = new LarkDoc({ element, content: '<p></p>', uploader: { upload: () => new Promise(resolve => completions.push(resolve)), onCancel } })
    try {
      const files = ['one', 'two'].map(name => new File([name], `${name}.png`, { type: 'image/png' }))
      const pending = doc._handle.nativeHost.host.insertImageFiles(files)
      expect(element.querySelectorAll('.lark-doc-image-upload')).toHaveLength(2)
      element.querySelector('.lark-doc-image-upload').dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
      doc.getEditor().view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }))
      await vi.waitFor(() => expect(completions).toHaveLength(2))
      completions[0]({ url: '/deleted.png' })
      completions[1]({ url: '/second.png' })
      await pending
      expect(onCancel).toHaveBeenCalledTimes(1)
      expect(doc.getJSON().content.filter(node => node.type === 'image').map(node => node.attrs.src)).toEqual(['/second.png'])
      expect(element.querySelectorAll('.lark-doc-image-upload')).toHaveLength(0)
    } finally { doc.destroy(); element.remove() }
  })

  it.each([false, true])('独立批次在同一空段落反向完成=%s，仍按预览顺序插入', async reverse => {
    const complete = {}
    const element = document.createElement('div')
    document.body.appendChild(element)
    const doc = new LarkDoc({ element, content: '<p></p>', uploader: file => new Promise(resolve => { complete[file.name] = resolve }) })
    try {
      const host = doc._handle.nativeHost.host
      const first = host.insertImageFiles([new File(['one'], 'one.png', { type: 'image/png' })])
      const second = host.insertImageFiles([new File(['two'], 'two.png', { type: 'image/png' })])
      const order = reverse ? ['two', 'one'] : ['one', 'two']
      complete[`${order[0]}.png`]({ url: `/${order[0]}.png` })
      await (reverse ? second : first)
      expect(element.querySelectorAll('.lark-doc-image-upload')).toHaveLength(1)
      complete[`${order[1]}.png`]({ url: `/${order[1]}.png` })
      await Promise.all([first, second])
      expect(doc.getJSON().content.filter(node => node.type === 'image').map(node => node.attrs.src)).toEqual(['/one.png', '/two.png'])
    } finally { doc.destroy(); element.remove() }
  })

  it.each([false, true])('撤销上传占位（替换选区=%s）不会撤销先前正文，或让晚结果插回来', async selected => {
    let complete
    const element = document.createElement('div')
    document.body.appendChild(element)
    const doc = new LarkDoc({ element, content: '<p>keep text</p>', uploader: () => new Promise(resolve => { complete = resolve }) })
    try {
      const editor = doc.getEditor()
      editor.commands.setTextSelection(selected ? { from: 1, to: 5 } : 1)
      const pending = doc._handle.nativeHost.host.insertImageFiles([new File(['png'], 'a.png', { type: 'image/png' })])
      editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }))
      await pending
      expect(element.querySelectorAll('.lark-doc-image-upload')).toHaveLength(0)
      expect(doc.getEditor().state.doc.textContent).toBe('keep text')
      complete({ url: '/late.png' })
      await Promise.resolve()
      expect(doc.getJSON().content.some(node => node.type === 'image')).toBe(false)
    } finally { doc.destroy(); element.remove() }
  })

  it.each([false, true])('后续输入先撤销，再撤销 pending；门面重做恢复原落点（选区=%s）', async selected => {
    stubRangeLayout()
    const complete = []
    const element = document.createElement('div')
    document.body.appendChild(element)
    const doc = new LarkDoc({ element, content: '<p>keep</p>', uploader: () => new Promise(resolve => complete.push(resolve)) })
    try {
      const editor = doc.getEditor()
      editor.commands.setTextSelection(selected ? { from: 1, to: 5 } : 5)
      const pending = doc._handle.nativeHost.host.insertImageFiles([new File(['png'], 'a.png', { type: 'image/png' })])
      const enqueueDoc = doc.getJSON()
      editor.commands.insertContent(' later')
      doc.undo()
      expect(doc.getJSON()).toEqual(enqueueDoc)
      expect(editor.state.doc.textContent).toBe(selected ? '' : 'keep')
      expect(element.querySelectorAll('.lark-doc-image-upload')).toHaveLength(1)
      doc.undo()
      expect(element.querySelectorAll('.lark-doc-image-upload')).toHaveLength(0)
      await pending
      expect(editor.state.doc.textContent).toBe('keep')
      expect(element.querySelectorAll('.lark-doc-image-upload')).toHaveLength(0)
      doc.redo()
      expect(element.querySelectorAll('.lark-doc-image-upload')).toHaveLength(1)
      doc.redo()
      expect(editor.state.doc.textContent).toBe(selected ? ' later' : 'keep later')
      complete[0]({ url: '/stale.png' })
      complete[1]({ url: '/redo.png' })
      await vi.waitFor(() => expect(doc.getJSON().content.filter(node => node.type === 'image').map(node => node.attrs.src)).toEqual(['/redo.png']))
    } finally { doc.destroy(); element.remove() }
  })

  it('连续撤销两个选区上传后，连续重做仍恢复两张预览与文件顺序', async () => {
    stubRangeLayout()
    const completions = []
    const element = document.createElement('div')
    document.body.appendChild(element)
    const doc = new LarkDoc({ element, content: '<p>aa bb cc</p>', uploader: () => new Promise(resolve => completions.push(resolve)) })
    try {
      const editor = doc.getEditor(), host = doc._handle.nativeHost.host
      editor.commands.setTextSelection({ from: 1, to: 3 })
      const first = host.insertImageFiles([new File(['one'], 'one.png', { type: 'image/png' })])
      editor.commands.setTextSelection({ from: 2, to: 4 })
      const second = host.insertImageFiles([new File(['two'], 'two.png', { type: 'image/png' })])
      doc.undo(); doc.undo()
      await Promise.all([first, second])
      expect(editor.state.doc.textContent).toBe('aa bb cc')
      doc.redo(); doc.redo()
      expect(editor.state.doc.textContent).toBe('  cc')
      expect(element.querySelectorAll('.lark-doc-image-upload')).toHaveLength(2)
      completions[2]({ url: '/one.png' })
      completions[3]({ url: '/two.png' })
      await vi.waitFor(() => expect(doc.getJSON().content.filter(node => node.type === 'image').map(node => node.attrs.src)).toEqual(['/one.png', '/two.png']))
    } finally { doc.destroy(); element.remove() }
  })

  it('协同上传选区的撤销边界保留上传前输入，重做只替换原选区', async () => {
    stubRangeLayout()
    const { Yjs, createCollabExtensions, isRemoteTransaction } = await import('../../src/collab')
    const ydoc = new Yjs.Doc({ gc: false })
    const element = document.createElement('div')
    document.body.appendChild(element)
    const complete = []
    const doc = new LarkDoc({ element, storage: 'none', content: '<p></p>', collab: { extensions: createCollabExtensions({ ydoc }), isRemoteTransaction }, uploader: () => new Promise(resolve => complete.push(resolve)) })
    try {
      const editor = doc.getEditor()
      editor.commands.insertContent('keep base')
      const undoManager = editor.state.plugins.map(plugin => plugin.getState(editor.state)?.undoManager).find(Boolean)
      undoManager.clear()
      undoManager.stopCapturing()
      editor.commands.insertContent(' prior')
      editor.commands.setTextSelection({ from: 1, to: 5 })
      const pending = doc._handle.nativeHost.host.insertImageFiles([new File(['png'], 'a.png', { type: 'image/png' })])
      doc.undo()
      await pending
      expect(editor.state.doc.textContent).toBe('keep base prior')
      doc.redo()
      expect(editor.state.doc.textContent).toBe(' base prior')
      complete[0]({ url: '/stale.png' })
      complete[1]({ url: '/redo.png' })
      await vi.waitFor(() => expect(doc.getJSON().content.filter(node => node.type === 'image').map(node => node.attrs.src)).toEqual(['/redo.png']))
    } finally { doc.destroy(); element.remove(); ydoc.destroy() }
  })

  it.each([false, true])('上传前输入与 pending 交错撤销重做仍保留正文和预览（选区=%s）', async selected => {
    stubRangeLayout()
    const complete = []
    const element = document.createElement('div')
    document.body.appendChild(element)
    const doc = new LarkDoc({ element, content: '<p>keep</p>', uploader: () => new Promise(resolve => complete.push(resolve)) })
    try {
      const editor = doc.getEditor()
      editor.commands.setTextSelection(5)
      editor.commands.insertContent(' prior')
      if (selected) editor.commands.setTextSelection({ from: 1, to: 5 })
      const pending = doc._handle.nativeHost.host.insertImageFiles([new File(['png'], 'a.png', { type: 'image/png' })])
      doc.undo(); doc.undo()
      await pending
      expect(editor.state.doc.textContent).toBe('keep')
      doc.redo(); doc.redo()
      expect(editor.state.doc.textContent).toBe(selected ? ' prior' : 'keep prior')
      expect(element.querySelectorAll('.lark-doc-image-upload')).toHaveLength(1)
      complete[1]({ url: '/restored.png' })
      await vi.waitFor(() => expect(doc.getJSON().content.some(node => node.type === 'image')).toBe(true))
    } finally { doc.destroy(); element.remove() }
  })

  it('粘贴上传后连续输入位于图片下方段落，上传完成不改变段落顺序', async () => {
    stubRangeLayout()
    let complete
    const element = document.createElement('div')
    document.body.appendChild(element)
    const doc = new LarkDoc({ element, content: '<p>before</p>', uploader: () => new Promise(resolve => { complete = resolve }) })
    try {
      const editor = doc.getEditor()
      editor.commands.setTextSelection(7)
      const pending = doc._handle.nativeHost.host.insertImageFiles([new File(['png'], 'a.png', { type: 'image/png' })], 7, 'paste')
      expect(editor.state.selection.$from.parent.textContent).toBe('')
      editor.commands.insertContent('after')
      complete({ url: '/middle.png' })
      await pending
      expect(doc.getJSON().content.map(node => node.type)).toEqual(['paragraph', 'image', 'paragraph'])
      expect(editor.state.doc.firstChild.textContent).toBe('before')
      expect(editor.state.doc.lastChild.textContent).toBe('after')
    } finally { doc.destroy(); element.remove() }
  })

  it('撤销后一个上传后，前一个上传完成并规范化 ID 不会阻断重做', async () => {
    const completions = []
    const element = document.createElement('div')
    document.body.appendChild(element)
    const doc = new LarkDoc({ element, content: '<p></p>', uploader: () => new Promise(resolve => completions.push(resolve)) })
    try {
      const host = doc._handle.nativeHost.host
      const first = host.insertImageFiles([new File(['one'], 'one.png', { type: 'image/png' })])
      const second = host.insertImageFiles([new File(['two'], 'two.png', { type: 'image/png' })])
      doc.undo()
      await second
      completions[0]({ url: '/one.png' })
      await first
      doc.redo()
      expect(completions).toHaveLength(3)
      expect(element.querySelectorAll('.lark-doc-image-upload')).toHaveLength(1)
      completions[2]({ url: '/two.png' })
      await vi.waitFor(() => expect(doc.getJSON().content.filter(node => node.type === 'image').map(node => node.attrs.src)).toEqual(['/one.png', '/two.png']))
    } finally { doc.destroy(); element.remove() }
  })

  it.each(['pending-split', 'completed'])('协同上传 %s 的结构与图片进入自己的撤销事件', async scenario => {
    stubRangeLayout()
    const { Yjs, createCollabExtensions, isRemoteTransaction } = await import('../../src/collab')
    const ydoc = new Yjs.Doc({ gc: false })
    const element = document.createElement('div')
    document.body.appendChild(element)
    let complete
    const doc = new LarkDoc({ element, storage: 'none', content: '<p></p>', collab: { extensions: createCollabExtensions({ ydoc }), isRemoteTransaction }, uploader: () => new Promise(resolve => { complete = resolve }) })
    try {
      const editor = doc.getEditor()
      editor.commands.insertContent('keep')
      const manager = editor.state.plugins.map(plugin => plugin.getState(editor.state)?.undoManager).find(Boolean)
      manager.clear(); manager.stopCapturing()
      editor.commands.insertContent(' prior')
      if (scenario === 'completed') editor.commands.setTextSelection(1)
      const pending = doc._handle.nativeHost.host.insertImageFiles([new File(['png'], 'a.png', { type: 'image/png' })])
      if (scenario === 'pending-split') {
        expect(editor.state.doc.childCount).toBe(2)
        doc.undo()
        await pending
        expect(editor.state.doc.childCount).toBe(1)
        expect(editor.state.doc.textContent).toBe('keep prior')
      } else {
        complete({ url: '/uploaded.png' })
        await pending
        doc.undo()
        expect(editor.state.doc.textContent).toBe('keep prior')
        expect(doc.getJSON().content.some(node => node.type === 'image')).toBe(false)
        doc.redo()
        expect(doc.getJSON().content.some(node => node.type === 'image')).toBe(true)
      }
    } finally { doc.destroy(); element.remove(); ydoc.destroy() }
  })

  it.each([false, true])('真实拖入按目标段落上/下半区吸附（下方=%s），不拆字或抢光标', async below => {
    stubRangeLayout()
    let complete
    const element = document.createElement('div')
    document.body.appendChild(element)
    const doc = new LarkDoc({ element, content: '<p>target text</p><p>caret here</p>', uploader: () => new Promise(resolve => { complete = resolve }) })
    try {
      const editor = doc.getEditor()
      editor.commands.setTextSelection(editor.state.doc.content.size - 1)
      vi.spyOn(editor.view, 'posAtCoords').mockReturnValue({ pos: 4, inside: 0 })
      vi.spyOn(editor.view.nodeDOM(0), 'getBoundingClientRect').mockReturnValue({ top: 100, height: 40 })
      const event = new MouseEvent('drop', { bubbles: true, cancelable: true, clientX: 120, clientY: below ? 130 : 110 })
      Object.defineProperty(event, 'dataTransfer', { value: { files: [new File(['png'], 'drop.png', { type: 'image/png' })], types: ['Files'], getData: () => '' } })
      editor.view.dom.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(true)
      expect(editor.state.doc.childCount).toBe(2)
      expect(editor.state.selection.$from.parent.textContent).toBe('caret here')
      complete({ url: '/drop.png' })
      await vi.waitFor(() => expect(doc.getJSON().content.filter(node => node.type === 'image')).toHaveLength(1))
      expect(doc.getJSON().content.map(node => node.type)).toEqual(below ? ['paragraph', 'image', 'paragraph'] : ['image', 'paragraph', 'paragraph'])
      expect(editor.state.doc.textContent).toBe('target textcaret here')
      expect(editor.state.selection.$from.parent.textContent).toBe('caret here')
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

  it('成功回调抛错时应用 onCallbackError 和门面 error 均收到原异常，图片仍成功插入', async () => {
    const failure = new Error('success-notification')
    const onCallbackError = vi.fn()
    const onError = vi.fn()
    const onSettled = vi.fn()
    const handler = vi.fn()
    const upload = vi.fn(async () => ({ url: '/ok.png' }))
    const element = document.createElement('div')
    document.body.appendChild(element)
    const doc = new LarkDoc({
      element, content: '<p></p>', onError,
      uploader: { upload, onCallbackError, onSettled, onSuccess: () => { throw failure } },
    })
    doc.on('error', handler)
    try {
      await doc._handle.nativeHost.host.insertImageFiles([new File(['png'], 'a.png', { type: 'image/png' })])
      expect(onCallbackError).toHaveBeenCalledExactlyOnceWith(failure)
      expect(onError).toHaveBeenCalledExactlyOnceWith(failure)
      expect(handler).toHaveBeenCalledExactlyOnceWith(failure)
      expect(onSettled).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: 'success' }))
      expect(upload).toHaveBeenCalledTimes(1)
      expect(doc.getJSON().content[0]).toMatchObject({ type: 'image', attrs: { src: '/ok.png' } })
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
      new File(['heic'], 'unsupported.heic', { type: 'image/heic' }),
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
        expect(element.querySelector('.lark-doc-image-upload-error').textContent).toContain('不支持的上传 Provider 协议版本')
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

describe('图表菜单交互', () => {
  function fixture(props = {}) {
    stubRangeLayout()
    vi.stubGlobal('mermaid', { initialize: vi.fn(), render: vi.fn(async () => ({ svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' })) })
    const renderer = createDomRenderer()
    const handle = mountRenderer(renderer, { element: document.createElement('div'), props: { initialContent: '<p></p>', ...props } })
    return { root: renderer.getRoot(handle), host: handle.nativeHost.host, editor: handle.editor }
  }

  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  it('工具栏图表显示文字和箭头，六种菜单项各有不同的 SVG 图标', async () => {
    const { root } = fixture()
    const trigger = root.querySelector('button[aria-label="图表"]')
    expect(trigger.textContent).toContain('图表')
    expect(trigger.querySelector('.lark-doc-caret svg')).not.toBeNull()
    trigger.click()
    await Promise.resolve()
    const items = [...root.querySelectorAll('.lark-doc-diagram-menu [role="menuitem"]')]
    expect(items.map(item => item.textContent)).toEqual(diagramTypes.map(item => item.label))
    const icons = items.map(item => item.querySelector('.lark-doc-diagram-menu-icon svg'))
    expect(icons.every(Boolean)).toBe(true)
    expect(new Set(icons.map(icon => icon.outerHTML)).size).toBe(diagramTypes.length)
  })

  it('图表 hover 后点击保持打开，跨入菜单保活，离开后延迟关闭', async () => {
    const { root, host } = fixture()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const trigger = root.querySelector('button[aria-label="图表"]')
    trigger.dispatchEvent(new MouseEvent('mouseenter'))
    await Promise.resolve()
    expect(host.diagramMenuOpen).toBe(true)
    trigger.click()
    expect(host.diagramMenuOpen).toBe(true)
    const menu = root.querySelector('.lark-doc-diagram-menu')
    trigger.dispatchEvent(new MouseEvent('mouseleave'))
    menu.dispatchEvent(new MouseEvent('mouseenter'))
    await vi.advanceTimersByTimeAsync(200)
    expect(host.diagramMenuOpen).toBe(true)
    menu.dispatchEvent(new MouseEvent('mouseleave'))
    await vi.advanceTimersByTimeAsync(200)
    expect(host.diagramMenuOpen).toBe(false)
  })

  it.each(['toolbar', 'plus', 'slash'])('%s 入口选择六种类型均插入对应 Mermaid 源码', async kind => {
    const { root, host, editor } = fixture()
    for (const type of diagramTypes) {
      editor.commands.setContent('<p></p>')
      if (kind === 'toolbar') root.querySelector('button[aria-label="图表"]').click()
      else if (kind === 'plus') root.querySelector('button[aria-label="插入"]').click()
      else editor.commands.insertContent('/图表')
      await Promise.resolve()
      if (kind !== 'toolbar') {
        const item = root.querySelector('.lark-doc-command-menu [aria-label="图表"]')
        expect(item).not.toBeNull()
        item.click()
        await Promise.resolve()
      }
      const menu = root.querySelector(kind === 'toolbar' ? '.lark-doc-diagram-menu' : '.lark-doc-command-submenu.is-diagram')
      expect(menu).not.toBeNull()
      expect(menu.querySelectorAll('svg')).toHaveLength(diagramTypes.length)
      const item = [...menu.querySelectorAll('[role="menuitem"]')].find(item => item.textContent === type.label)
      item.click()
      await Promise.resolve()
      const block = editor.getJSON().content.find(node => node.type === 'codeBlock')
      expect(block).toMatchObject({ attrs: { language: 'mermaid' }, content: [{ type: 'text', text: type.source }] })
      expect(host.diagramMenuOpen).toBe(false)
      expect(host.menuOpen).toBe(false)
    }
  })

  it('斜杠图表按 Enter 先打开类型菜单，选择后才插入相应源码', async () => {
    const { root, editor } = fixture()
    editor.commands.insertContent('/图表')
    await Promise.resolve()
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    await Promise.resolve()
    const menu = root.querySelector('.lark-doc-command-submenu.is-diagram')
    expect(menu).not.toBeNull()
    expect(menu.querySelectorAll('[role="menuitem"]')).toHaveLength(diagramTypes.length)
    expect(editor.getJSON().content.some(node => node.type === 'codeBlock')).toBe(false)
    expect(editor.getText()).toBe('/图表')
    menu.querySelector('[aria-label="时序图"]').click()
    await Promise.resolve()
    const block = editor.getJSON().content.find(node => node.type === 'codeBlock')
    expect(block).toMatchObject({ attrs: { language: 'mermaid' }, content: [{ type: 'text', text: diagramTypes.find(type => type.id === 'sequence').source }] })
    expect(root.querySelector('.lark-doc-command-menu')).toBeNull()
  })

  it('斜杠普通叶命令按 Enter 仍直接执行', async () => {
    const { root, editor } = fixture()
    editor.commands.insertContent('/引用')
    await Promise.resolve()
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    await Promise.resolve()
    expect(editor.getJSON().content[0].type).toBe('blockquote')
    expect(root.querySelector('.lark-doc-command-menu')).toBeNull()
  })

  it.each([['分栏', 'columns'], ['模板', 'templates']])('斜杠 %s 按 Enter 复用已有二级菜单', async (label, kind) => {
    const { root, editor } = fixture()
    editor.commands.insertContent('/' + label)
    await Promise.resolve()
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    await Promise.resolve()
    expect(root.querySelector('.lark-doc-command-submenu.is-' + kind)).not.toBeNull()
    expect(editor.getText()).toBe('/' + label)
  })

  it('下方空间不足时图表菜单上翻，右侧不越过视口', async () => {
    const { root, host } = fixture()
    vi.stubGlobal('innerWidth', 360)
    vi.stubGlobal('innerHeight', 600)
    const trigger = root.querySelector('button[aria-label="图表"]')
    trigger.click()
    await Promise.resolve()
    const menu = root.querySelector('.lark-doc-diagram-menu')
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({ left: 320, right: 352, top: 560, bottom: 592, width: 32, height: 32 })
    vi.spyOn(menu, 'getBoundingClientRect').mockReturnValue({ left: 0, right: 180, top: 0, bottom: 246, width: 180, height: 246 })
    host.positionDiagramMenu()
    const { top, left, maxHeight } = host.diagramMenuStyle
    expect(parseFloat(top)).toBeGreaterThanOrEqual(8)
    expect(parseFloat(top) + parseFloat(maxHeight)).toBeLessThanOrEqual(560)
    expect(parseFloat(left) + 180).toBeLessThanOrEqual(352)
  })

  it.each(['toolbar', 'empty'])('%s 插入入口到菜单和图表子菜单保活，移开后收起', async kind => {
    const { root, host } = fixture()
    host.handleRange = { from: 0, to: 2 }
    await Promise.resolve()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const trigger = root.querySelector(kind === 'toolbar' ? 'button[aria-label="插入"]' : '.lark-doc-empty-block-insert')
    if (kind === 'toolbar') trigger.click()
    else trigger.dispatchEvent(new MouseEvent('mouseenter'))
    await Promise.resolve()
    const menu = root.querySelector('.lark-doc-command-menu')
    trigger.dispatchEvent(new MouseEvent('mouseleave'))
    trigger.dispatchEvent(new MouseEvent('mouseenter'))
    await vi.advanceTimersByTimeAsync(200)
    expect(host.menuOpen).toBe(true)
    trigger.dispatchEvent(new MouseEvent('mouseleave'))
    menu.dispatchEvent(new MouseEvent('mouseenter'))
    await vi.advanceTimersByTimeAsync(200)
    expect(host.menuOpen).toBe(true)
    menu.querySelector('[aria-label="图表"]').click()
    const submenu = root.querySelector('.lark-doc-command-submenu.is-diagram')
    expect(submenu).not.toBeNull()
    menu.dispatchEvent(new MouseEvent('mouseleave'))
    submenu.dispatchEvent(new MouseEvent('mouseenter'))
    await vi.advanceTimersByTimeAsync(200)
    expect(host.menuOpen).toBe(true)
    submenu.dispatchEvent(new MouseEvent('mouseleave'))
    await vi.advanceTimersByTimeAsync(200)
    expect(host.menuOpen).toBe(false)
  })

  it.each([{ readonly: true }, { config: { features: { diagram: false } } }])('只读或关闭图表时不打开图表菜单', props => {
    const { root, host } = fixture(props)
    root.querySelector('button[aria-label="图表"]')?.dispatchEvent(new MouseEvent('mouseenter'))
    host.toggleDiagramMenu()
    expect(host.diagramMenuOpen).toBe(false)
  })
})

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
    // ready 是异步生命周期事件：只断言「最终会派发」，不绑定具体微任务数量。
    let resolveReady
    const readyFired = new Promise(resolve => { resolveReady = resolve })
    const renderer = createDomRenderer()
    const handle = mountRenderer(renderer, {
      element: host,
      props: { initialTitle: '迁移期文档', initialContent: '<p>正文</p>' },
      on: { ready: (payload) => { ready(payload); resolveReady() } },
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
    await readyFired
    expect(ready).toHaveBeenCalled()

    renderer.destroy(handle)
    expect(renderer.getRoot(handle)).toBeNull()
    expect(host.firstElementChild).toBeNull()
  })

  it.each([
    ['edit', false], ['suggest', false], ['read', false], ['edit', true],
  ])('modes.visible 经真实门面和顶栏 state 显隐，保留 %s 模式与宿主只读 %s', async (mode, readonly) => {
    const element = document.createElement('div')
    document.body.appendChild(element)
    const modes = { visible: false, default: mode, persist: false, labels: { read: '预览' } }
    const doc = new LarkDoc({ element, storage: 'none', content: '<p>保留正文</p>', readonly, config: { modes } })
    try {
      const editor = doc.getEditor()
      const host = doc._handle.nativeHost.host
      const root = element.querySelector('.lark-doc')
      const editable = mode !== 'read' && !readonly
      await vi.waitFor(() => expect(editor.isEditable).toBe(editable))
      expect(doc.getConfig().modes.visible).toBe(false)
      expect(host.buildTopBarState().modeVisible).toBe(false)
      expect(root.querySelector('.lark-doc-mode-select')).toBeNull()
      expect(root.querySelector('.lark-doc-topbar')).not.toBeNull()
      expect(host.mode).toBe(mode)
      const json = doc.getJSON()
      const actions = root.querySelector('.lark-doc-actions-host')
      const reading = root.querySelector('button[aria-label="阅读模式"], button[aria-label="退出阅读"]')
      expect(reading).not.toBeNull()

      doc.patchProps({ config: { modes: { ...modes, visible: true } } })
      await vi.waitFor(() => expect(root.querySelector('.lark-doc-mode-select')).not.toBeNull())
      const select = root.querySelector('.lark-doc-mode-select')
      select.querySelector('[role="combobox"]').click()
      expect(select.querySelectorAll('[role="option"]')).toHaveLength(3)
      expect(select.querySelectorAll('.lark-doc-select-item-label')[2].textContent).toBe('预览')
      doc.patchProps({ config: { modes } })
      await vi.waitFor(() => expect(root.querySelector('.lark-doc-mode-select')).toBeNull())
      expect(select.parentNode).toBeNull()
      expect(select.querySelector('[role="listbox"]')).toBeNull()
      expect(host.buildTopBarState().modeVisible).toBe(false)
      expect(host.mode).toBe(mode)
      expect(editor.isEditable).toBe(editable)
      expect(doc.getEditor()).toBe(editor)
      expect(doc.getJSON()).toEqual(json)
      expect(root.querySelector('.lark-doc-actions-host')).toBe(actions)
      expect(root.querySelector('.lark-doc-topbar').contains(actions)).toBe(true)
      expect(root.querySelector('button[aria-label="阅读模式"], button[aria-label="退出阅读"]')).toBe(reading)
    } finally { doc.destroy(); element.remove() }
  })

  it('连续切换三态只更新成功提示文字，保留同一成功图标和正文', async () => {
    const host = document.createElement('div')
    const renderer = createDomRenderer()
    const handle = mountRenderer(renderer, {
      element: host,
      props: { initialContent: '<p>正文</p>', config: { modes: { persist: false } } },
    })
    const root = renderer.getRoot(handle)
    const toast = root.querySelector('.lark-doc-mode-toast')
    const icon = toast.querySelector('.lark-doc-mode-toast-icon')
    expect(toast.hidden).toBe(true)
    expect(toast.getAttribute('role')).toBe('status')
    expect(icon).not.toBeNull()
    expect(icon.textContent).toBe('✓')
    expect(icon.getAttribute('aria-hidden')).toBe('true')
    const json = handle.editor.getJSON()

    for (const [index, label] of [[1, '修订'], [2, '阅读'], [0, '编辑']]) {
      root.querySelector('.lark-doc-mode-select [role="combobox"]').click()
      root.querySelectorAll('.lark-doc-mode-select [role="option"]')[index].click()
      await vi.waitFor(() => expect(toast.querySelector('.lark-doc-mode-toast-text')?.textContent).toBe(`已切换为${label}模式`))
      expect(toast.hidden).toBe(false)
      expect(toast.querySelector('.lark-doc-mode-toast-icon')).toBe(icon)
      expect(handle.editor.getJSON()).toEqual(json)
    }
  })

  it('DOM renderer 的演示显示完整富文档、单一返回入口且支持退出', async () => {
    const host = document.createElement('div')
    const renderer = createDomRenderer()
    const handle = mountRenderer(renderer, {
      element: host,
      props: { initialTitle: '演示文档', initialContent: '<h1>第一节</h1><p><strong>正文</strong></p><table><tr><td>表格正文</td></tr></table><h1>第二节</h1><p>末尾正文</p>' },
    })
    const instance = renderer.getInstance(handle)
    const root = renderer.getRoot(handle)
    const before = handle.editor.getJSON()

    expect(root.querySelector('.lark-doc-slide-stage')).toBeNull()
    instance.toggleSlides()
    expect(instance.isSlides()).toBe(true)
    expect(root.classList.contains('lark-doc-slides')).toBe(true)
    expect(root.querySelector('.lark-doc-paper').style.display).toBe('none')
    await vi.waitFor(() => expect(root.querySelector('.lark-doc-slide-stage strong')?.textContent).toBe('正文'))
    expect(root.querySelector('.lark-doc-slide-stage')?.textContent).toContain('演示文档')
    expect(root.querySelectorAll('.lark-doc-slide-stage header button')).toHaveLength(1)
    expect(root.querySelector('.lark-doc-slide-stage header button').textContent).toBe('返回')
    expect(root.querySelector('.lark-doc-slide-stage strong').textContent).toBe('正文')
    expect(root.querySelector('.lark-doc-slide-stage td').textContent).toBe('表格正文')
    expect(root.querySelector('.lark-doc-slide-stage').textContent).toContain('末尾正文')
    expect(root.querySelector('.lark-doc-slide-stage [contenteditable="true"]')).toBeNull()
    expect(handle.editor.getJSON()).toEqual(before)

    const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(root.querySelector('.lark-doc-slide-counter')).toBeNull()

    root.querySelector('.lark-doc-slide-stage button:last-child').click()
    expect(instance.isSlides()).toBe(false)
    await Promise.resolve()
    expect(root.querySelector('.lark-doc-slide-stage')).toBeNull()
    expect(root.querySelector('.lark-doc-paper').style.display).toBe('')
    expect(handle.editor.getJSON()).toEqual(before)

    await Promise.resolve()
    renderer.destroy(handle)
  })

  it.each(['close', 'destroy'])('演示原生全屏等待期间%s，晚到成功会退出全屏且不重开副本', async action => {
    const renderer = createDomRenderer(), element = document.createElement('div')
    const handle = mountRenderer(renderer, { element, props: { initialContent: '<p>原文</p>' } })
    const instance = renderer.getInstance(handle), root = renderer.getRoot(handle)
    const previousDescriptor = Object.getOwnPropertyDescriptor(document, 'fullscreenElement')
    const previousExit = document.exitFullscreen
    let fullscreen = null, finish
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fullscreen })
    document.exitFullscreen = vi.fn(async () => { fullscreen = null; document.dispatchEvent(new Event('fullscreenchange')) })
    root.requestFullscreen = vi.fn(() => new Promise(resolve => { finish = () => { fullscreen = root; document.dispatchEvent(new Event('fullscreenchange')); resolve() } }))
    try {
      instance.toggleSlides()
      await vi.waitFor(() => expect(root.requestFullscreen).toHaveBeenCalledOnce())
      if (action === 'destroy') renderer.destroy(handle)
      else instance.toggleSlides()
      finish()
      await vi.waitFor(() => expect(document.exitFullscreen).toHaveBeenCalledOnce())
      expect(fullscreen).toBeNull()
      expect(root.querySelector('.lark-doc-slide-stage')).toBeNull()
      if (action === 'close') {
        expect(instance.isSlides()).toBe(false)
        expect(handle.editor.state.doc.textContent).toBe('原文')
      }
    } finally {
      if (previousDescriptor) Object.defineProperty(document, 'fullscreenElement', previousDescriptor)
      else delete document.fullscreenElement
      document.exitFullscreen = previousExit
    }
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

  it('运行时正文跨过大文档阈值时刷新滚动优化类，缩回后也会清除', async () => {
    const host = document.createElement('div')
    const renderer = createDomRenderer()
    const handle = mountRenderer(renderer, { element: host, props: { initialContent: '<p>正文</p>' } })
    // jsdom has no layout-backed Range rects; this test only checks the
    // renderer's threshold projection, so keep geometry out of the fixture.
    handle.nativeHost.host.updateHandleAndTable = () => {}
    handle.nativeHost.host.selectionBatcher().dispose()
    handle.editor.commands.setContent(`<p>${'x'.repeat(500001)}</p>`)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(renderer.getRoot(handle).classList.contains('lark-doc-large-document')).toBe(true)
    handle.editor.commands.setContent('<p>正文</p>')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(renderer.getRoot(handle).classList.contains('lark-doc-large-document')).toBe(false)
    renderer.destroy(handle)
  })

  it('partial config patch 保留未修改的布局与网络段，文档操作入口不丢失', async () => {
    const host = document.createElement('div')
    const renderer = createDomRenderer()
    const handle = mountRenderer(renderer, {
      element: host,
      props: {
        initialContent: '<p>正文</p>',
        config: { layout: { headerVisible: false, toolbarFixed: true }, network: { mode: 'allowlist', allowlist: ['example.com'] } },
      },
    })
    await Promise.resolve()
    expect(renderer.getRoot(handle).querySelector('[aria-label="文档操作"]')).not.toBeNull()
    renderer.update(handle, { config: { features: { marks: false } } })
    await Promise.resolve()
    expect(handle.state.editorConfig.layout.headerVisible).toBe(false)
    expect(handle.state.editorConfig.layout.toolbarFixed).toBe(true)
    expect(handle.state.editorConfig.network).toEqual({ mode: 'allowlist', allowlist: ['example.com'] })
    expect(renderer.getRoot(handle).querySelector('[aria-label="文档操作"]')).not.toBeNull()
    expect(renderer.getRoot(handle).querySelector('.lark-doc-mark-bold')).toBeNull()
    renderer.destroy(handle)
  })

  it('mount/index 默认使用 DOM，Vue renderer 必须由宿主显式注入', () => {
    expect(createRenderer().name).toBe('dom-migration')
    expect(() => createRenderer({ renderer: 'vue2' })).toThrow(/隔离/)
    expect(createRenderer({ rendererFactory: createDomRenderer }).name).toBe('dom-migration')
    expect(typeof setRenderer).toBe('function')
    setRenderer(null)
  })
})


describe('真实工作台导入导出配置', () => {
  it('初始化与热更新均采用独立开关、格式白名单和文案，保持同一编辑器', async () => {
    const element = document.createElement('div')
    document.body.appendChild(element)
    const doc = new LarkDoc({ element, storage: 'none', content: '<p>保留正文</p>', config: {
      importExport: { importFormats: ['json'], exportFormats: ['json'], importLabel: '读取 JSON', exportLabel: '保存 JSON' },
    } })
    try {
      const editor = doc.getEditor()
      await vi.waitFor(() => expect(element.querySelector('input[aria-label="导入文档"]')?.accept).toBe('.json'))
      expect(element.querySelector('button[title="读取 JSON"]')?.textContent).toBe('读取 JSON')
      const trigger = element.querySelector('[role="combobox"][aria-label="导出文档格式"]')
      expect(trigger.textContent).toContain('保存 JSON')
      trigger.click()
      expect(Array.from(element.querySelectorAll('[role="listbox"][aria-label="导出文档格式"] .lark-doc-select-item-label')).map(item => item.textContent)).toEqual(['保存 JSON', 'JSON（完整正文）'])
      doc.patchProps({ config: { importExport: { importEnabled: false, exportEnabled: false } } })
      await vi.waitFor(() => {
        expect(element.querySelector('input[aria-label="导入文档"]')).toBeNull()
        expect(element.querySelector('[role="combobox"][aria-label="导出文档格式"]')).toBeNull()
      })
      expect(doc.getEditor()).toBe(editor)
      expect(doc.getText()).toBe('保留正文')
    } finally { doc.destroy(); element.remove() }
  })
})


describe('真实门面媒体 HTML 回传', () => {
  it.each(['inline', 'link'])('%s 的 update/change 与 getHTML 一致，编辑器内仍保留媒体节点', async htmlMode => {
    const element = document.createElement('div')
    document.body.appendChild(element)
    const doc = new LarkDoc({ element, storage: 'none',
      content: '<p>正文</p><img src="data:image/png;base64,cG5n" alt="示例图片">',
      config: { media: { htmlMode }, performance: { changeDebounce: 0 } },
    })
    const updates = []
    const changes = []
    doc.on('update', event => updates.push(event))
    doc.on('change', event => changes.push(event))
    try {
      doc.getEditor().commands.insertContent('追加')
      await vi.waitFor(() => expect(changes.length).toBeGreaterThan(0))
      for (const event of [updates[updates.length - 1], changes[changes.length - 1]]) {
        expect(event.html).toBe(doc.getHTML())
        expect(event.json).toEqual(doc.getJSON())
        expect(event.html.includes('<img')).toBe(htmlMode === 'inline')
      }
      expect(doc.getEditor().getHTML()).toContain('<img')
      expect(doc.getJSON().content.some(node => node.type === 'image')).toBe(true)
    } finally { doc.destroy(); element.remove() }
  })
})


it('两个真实编辑器之间点击插入按钮会关闭另一个编辑器的菜单', async () => {
  const elements = [document.createElement('div'), document.createElement('div')]
  elements.forEach(element => document.body.appendChild(element))
  const docs = elements.map(element => new LarkDoc({ element, storage: 'none', content: '<p>正文</p>' }))
  try {
    const firstHost = docs[0]._handle.nativeHost.host
    firstHost.openCommandMenu('plus')
    await Promise.resolve()
    expect(firstHost.menuOpen).toBe(true)
    const own = elements[0].querySelector('button[aria-label="插入"] .lark-doc-icon')
    own.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(firstHost.menuOpen).toBe(true)
    const other = elements[1].querySelector('button[aria-label="插入"] .lark-doc-icon')
    other.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(firstHost.menuOpen).toBe(false)
  } finally { docs.forEach(doc => doc.destroy()); elements.forEach(element => element.remove()) }
})


it('斜杠菜单连续 ArrowDown 与 Enter 使用当前高亮项', async () => {
  stubRangeLayout()
  const element = document.createElement('div')
  document.body.appendChild(element)
  const doc = new LarkDoc({ element, storage: 'none', content: '<p></p>', config: { commands: { allow: ['blockquote', 'diagram'] } } })
  try {
    const editor = doc.getEditor()
    editor.commands.insertContent('/')
    const host = doc._handle.nativeHost.host
    await vi.waitFor(() => expect(host.menuOpen).toBe(true))
    expect(host.filteredCommands.map(item => item.id)).toEqual(['diagram', 'blockquote'])
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    expect(doc.getJSON().content.some(node => node.type === 'blockquote')).toBe(true)
    expect(doc.getJSON().content.some(node => node.type === 'codeBlock')).toBe(false)
  } finally { doc.destroy(); element.remove() }
})


it('媒体配置热更新后 getConfig/getHTML 与实际 update/change 保持一致', async () => {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const doc = new LarkDoc({ element, storage: 'none', content: '<p>正文</p><img src="data:image/png;base64,cG5n" alt="原图">' })
  const events = { update: [], change: [] }
  Object.keys(events).forEach(name => doc.on(name, event => events[name].push(event)))
  try {
    const editor = doc.getEditor()
    const before = doc.getJSON()
    expect(doc.getConfig().media.htmlMode).toBe('inline')
    for (const htmlMode of ['link', 'inline']) {
      doc.patchProps({ config: { media: { htmlMode }, performance: { changeDebounce: 0 } } })
      expect(doc.getConfig().media.htmlMode).toBe(htmlMode)
      expect(doc.getJSON()).toEqual(before)
      editor.commands.insertContent('继续编辑')
      await vi.waitFor(() => {
        for (const name of ['update', 'change']) {
          const event = events[name][events[name].length - 1]
          expect(event.html).toBe(doc.getHTML())
          expect(event.json).toEqual(doc.getJSON())
        }
      })
      expect(doc.getHTML().includes('<img')).toBe(htmlMode === 'inline')
      expect(editor.getHTML()).toContain('<img')
      editor.commands.undo()
    }
    expect(doc.getEditor()).toBe(editor)
  } finally { doc.destroy(); element.remove() }
})


it('无工作台 state 的自注入 renderer 继续读取初始化配置，单次 HTML 覆盖仍优先', () => {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const html = '<img src="https://example.test/a.png" alt="原图">'
  const workspace = { getHTML: () => html }
  const rendererFactory = () => ({
    mount: () => ({}), update() {}, destroy() {}, getInstance: () => workspace, getRoot: () => element,
  })
  const doc = new LarkDoc({ element, rendererFactory, storage: 'none', config: { media: { htmlMode: 'link' } } })
  try {
    expect(doc.getConfig()).toBe(doc.config)
    expect(doc.getConfig().media.htmlMode).toBe('link')
    expect(doc.getHTML()).toContain('<a href="https://example.test/a.png"')
    expect(doc.getHTML()).not.toContain('<img')
    expect(doc.getHTML({ media: { mode: 'inline' } })).toBe(html)
  } finally { doc.destroy(); element.remove() }
})

describe('v12e card keyboard editing', () => {
  it('opens the existing card editor for Cmd+K on a node-selected link card', () => {
    const element = document.createElement('div')
    document.body.appendChild(element)
    const doc = new LarkDoc({ element, content: { type: 'doc', content: [{ type: 'bookmark', attrs: { url: 'https://example.com', title: 'Example' } }] } })
    try {
      doc.getEditor().commands.setNodeSelection(0)
      const host = doc._handle.nativeHost.host
      host.openLinkDialog()
      expect(host._linkDialogTarget?.node.type.name).toBe('bookmark')
      expect(host.linkValue).toBe('https://example.com')
      expect(host.linkText).toBe('Example')
    } finally { doc.destroy(); element.remove() }
  })
})


describe('最终补全：文本与表格AI真实编辑器闭环', () => {
  function chatFixture(content = '<p>前文</p><p>需要改写的文字</p>') {
    stubRangeLayout()
    const requests = [], cancel = vi.fn()
    const aiProvider = { contentFormat: 'text', stream: args => { requests.push(args); return { cancel } } }
    const renderer = createDomRenderer()
    const handle = mountRenderer(renderer, { element: document.createElement('div'), props: { initialContent: content, aiProvider, storage: 'none' } })
    return { renderer, handle, root: renderer.getRoot(handle), editor: handle.editor, workspace: handle.workspaceController, requests, cancel }
  }
  it('UI改写入口先引用后提问，流式回复可替换映射后的选区且撤销保留前文', async () => {
    const { handle, editor, workspace, requests, root } = chatFixture()
    const start = editor.state.doc.firstChild.nodeSize + 1
    editor.commands.setTextSelection({ from: start, to: start + '需要改写的文字'.length })
    handle.nativeHost.host.$emit('ai-request', 'rewrite')
    expect(workspace.state.aiSelectionChat).toBe(true)
    expect(requests).toHaveLength(0)
    await vi.waitFor(() => expect(root.querySelector('[aria-label="AI 问答"]')).not.toBeNull())
    const original = editor.getJSON()
    workspace.state.aiPrompt = '简短改写'
    await workspace.sendAIChat()
    expect(requests).toHaveLength(1)
    expect(requests[0].text).toBe('需要改写的文字')
    requests[0].onChunk('改写回复'); requests[0].onDone()
    editor.commands.insertContentAt(1, '新前缀')
    expect(workspace.acceptAI('replace')).toBe(true)
    expect(editor.getText()).toContain('新前缀前文')
    expect(editor.getText()).toContain('改写回复')
    editor.commands.undo()
    expect(editor.getText()).toContain('需要改写的文字')
    expect(original.content[1].content[0].text).toBe('需要改写的文字')
  })
  it('矩形选区只引用选中格；表格回复只能插入表后，不能破坏未选单元格', async () => {
    const rows = Array.from({ length: 3 }, (_, r) => `<tr>${Array.from({ length: 3 }, (_, c) => `<td><p>R${r}C${c}</p></td>`).join('')}</tr>`).join('')
    const { editor, workspace, requests } = chatFixture('<table>' + rows + '</table><p>后文</p>')
    const cells = []
    editor.state.doc.descendants((node, pos) => { if (node.type.name === 'tableCell') cells.push(pos) })
    editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc, cells[0], cells[4])))
    expect(workspace.openSelectionAI()).toBe(true)
    workspace.state.aiPrompt = '分析选中格'
    await workspace.sendAIChat()
    expect(requests[0].text).toBe('R0C0\nR0C1\nR1C0\nR1C1')
    expect(requests[0].context.ranges).toHaveLength(4)
    expect(JSON.stringify(requests[0].context.content)).not.toContain('R0C2')
    requests[0].onChunk('表格分析回复'); requests[0].onDone()
    const before = editor.getJSON().content.find(node => node.type === 'table')
    expect(workspace.acceptAI('replace')).toBe(false)
    expect(editor.getJSON().content.find(node => node.type === 'table')).toEqual(before)
    expect(workspace.acceptAI('insert')).toBe(true)
    expect(editor.getJSON().content.find(node => node.type === 'table')).toEqual(before)
    expect(editor.getText()).toContain('表格分析回复')
  })
  it('缺provider保持配置状态；撤销编辑权限后拒绝旧流回复与应用', async () => {
    const { workspace, editor, requests, cancel } = chatFixture()
    editor.commands.setTextSelection({ from: 1, to: 3 })
    workspace.openSelectionAI()
    workspace.state.aiPrompt = '描述选区'
    await workspace.sendAIChat()
    workspace.setReadonly(true)
    requests[0].onChunk('过期回复'); requests[0].onDone()
    expect(cancel).toHaveBeenCalled()
    expect(workspace.state.aiOpen).toBe(false)
    expect(workspace.state.aiPreview).toBe('')
    expect(editor.getText()).not.toContain('过期回复')
  })
  it('关闭重开问答后旧输入与IME事件不能写入新会话，流式更新保留当前输入节点', async () => {
    const { workspace, root } = chatFixture()
    workspace.openSelectionAI()
    await vi.waitFor(() => expect(root.querySelector('[aria-label="AI 问答消息"]')).not.toBeNull())
    const previous = root.querySelector('[aria-label="AI 问答消息"]')
    workspace.closeAI(); workspace.openSelectionAI()
    await vi.waitFor(() => expect(root.querySelector('[aria-label="AI 问答消息"]')).not.toBe(previous))
    previous.value = '旧会话迟到输入'
    previous.dispatchEvent(new Event('input', { bubbles: true }))
    previous.dispatchEvent(new Event('compositionend', { bubbles: true }))
    expect(workspace.state.aiPrompt).toBe('')
    const current = root.querySelector('[aria-label="AI 问答消息"]')
    current.value = '当前问题'
    current.dispatchEvent(new Event('input', { bubbles: true }))
    expect(workspace.state.aiPrompt).toBe('当前问题')
    await workspace.sendAIChat()
    await Promise.resolve()
    expect(root.querySelector('[aria-label="AI 问答消息"]')).toBe(current)
  })
  it('未配置provider的新问答不执行mock生成', async () => {
    const { workspace, handle } = chatFixture()
    handle.workspaceController.props.aiProvider = null
    workspace.openSelectionAI()
    workspace.state.aiPrompt = '不可伪生成'
    await workspace.sendAIChat()
    expect(workspace.state.aiRunning).toBe(false)
    expect(workspace.state.aiPreview).toBe('')
    expect(workspace.state.aiError).toContain('配置')
  })
})
