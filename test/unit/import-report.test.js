// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { getSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { DOMParser as ProseMirrorDOMParser } from '@tiptap/pm/model'
import { EditorState } from '@tiptap/pm/state'
import { createEditorController } from '../../src/editor/EditorController'
import { createWorkspaceController, createWorkspaceState } from '../../src/workspace/WorkspaceController'
import { sanitizeHTML } from '../../src/components/lark-doc/documentOperations'
import { normalizeVditorHtml } from '../../src/legacy/vditorHtml'
import { LarkDoc } from '../../src/LarkDoc'

const VDITOR = '<ul><li class="vditor-task"><input type="checkbox">待办</li>' +
  '<li class="vditor-task vditor-task--done"><input type="checkbox" checked>完成</li></ul>'
const PLAIN = '<p>普通正文</p>'
const schema = getSchema([StarterKit, TaskList, TaskItem])

function prepareHTML(content, format) {
  const legacy = normalizeVditorHtml(content, { force: format === 'vditor', skip: format === 'html' })
  return { ...legacy, html: sanitizeHTML(legacy.html) }
}

function parseHTML(html) {
  const container = document.createElement('div')
  container.innerHTML = html
  return ProseMirrorDOMParser.fromSchema(schema).parse(container)
}

function createHarness(options = {}) {
  const emit = vi.fn()
  const state = createWorkspaceState({ config: { features: { persistence: false } }, initialTitle: '' })
  const editor = {
    schema,
    state: EditorState.create({ schema, doc: parseHTML(options.html || PLAIN) }),
    storage: { characterCount: { characters: ({ node }) => node.textContent.length } },
    commands: {},
    getJSON: () => editor.state.doc.toJSON(),
    getText: () => editor.state.doc.textContent,
    view: { dispatch: vi.fn(transaction => { editor.state = editor.state.apply(transaction) }) },
  }
  let editorController
  const workspaceController = createWorkspaceController({
    state,
    host: {
      emit,
      getEditor: () => editor,
      getJSON: () => editor.getJSON(),
      setContent: (content, settings) => editorController.setContent(content, settings),
    },
  })
  editorController = createEditorController({
    editor,
    prepareHTML: options.prepareHTML || prepareHTML,
    getMaxLength: options.getMaxLength,
    onImportReport: report => workspaceController.onImportReport(report),
  })
  return { editor, editorController, workspaceController, state, emit }
}

const documents = []
afterEach(() => {
  documents.splice(0).forEach(doc => {
    const element = doc.element
    doc.destroy()
    element.remove()
  })
})

// 只装配报告链路，不挂完整编辑器 UI；DOM renderer 需按同一契约接线。
function createReportRenderer() {
  return {
    mount({ element, props, on }) {
      const prepared = typeof props.initialContent === 'string'
        ? prepareHTML(props.initialContent, props.contentFormat)
        : null
      const harness = createHarness({ html: prepared ? prepared.html : PLAIN })
      harness.workspaceController.host.emit = (name, payload) => on[name]?.(payload)
      harness.editorController.prepareHTML = (content, format) => prepareHTML(content, format || props.contentFormat)
      harness.editorController.setImportReport(prepared?.converted ? prepared.report : null)
      return { ...harness, instance: harness.workspaceController, root: element }
    },
    getInstance: handle => handle.instance,
    getRoot: handle => handle.root,
    update() {},
    destroy() {},
  }
}

function createDocument(options = {}) {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const doc = new LarkDoc({
    element,
    features: { persistence: false },
    rendererFactory: createReportRenderer,
    ...options,
  })
  documents.push(doc)
  return doc
}

describe('导入报告 · EditorController', () => {
  it('首次归一化结果保留 source、统计并且只通知一次', () => {
    const { editor, editorController, workspaceController, state, emit } = createHarness()
    const prepare = vi.fn(prepareHTML)
    editorController.prepareHTML = prepare

    expect(editorController.setContent(VDITOR)).toBe(true)
    expect(prepare).toHaveBeenCalledTimes(1)
    expect(editor.state.doc.firstChild.type.name).toBe('taskList')
    expect(editor.state.doc.firstChild.child(1).attrs.checked).toBe(true)
    expect(editorController.getImportReport()).toMatchObject({ source: 'vditor', taskList: 1, taskItem: 2 })
    expect(workspaceController.getImportReport()).toBe(editorController.getImportReport())
    expect(state.importReport).toBe(editorController.getImportReport())
    expect(emit).toHaveBeenCalledExactlyOnceWith('import-report', editorController.getImportReport())
  })

  it('已转换 HTML 的初始化报告直接保存，不二次归一化丢失计数', () => {
    const prepared = prepareHTML(VDITOR)
    expect(normalizeVditorHtml(prepared.html).converted).toBe(false)
    const { editorController, workspaceController, emit } = createHarness({ html: prepared.html })

    editorController.setImportReport(prepared.report)

    expect(editorController.getImportReport()).toBe(prepared.report)
    expect(workspaceController.getImportReport()).toMatchObject({ source: 'vditor', taskItem: 2 })
    expect(emit).toHaveBeenCalledExactlyOnceWith('import-report', prepared.report)
  })

  it('正文相同仍提供本次转换报告，不派发替换事务', () => {
    const prepared = prepareHTML(VDITOR)
    const { editor, editorController, emit } = createHarness({ html: prepared.html })

    expect(editorController.setContent(VDITOR)).toBe(false)
    expect(editor.view.dispatch).not.toHaveBeenCalled()
    expect(editorController.getImportReport()).toMatchObject({ source: 'vditor', taskItem: 2 })
    expect(emit).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['普通 HTML', PLAIN, {}],
    ['显式 html 模式', VDITOR, { format: 'html' }],
    ['结构化 JSON', { type: 'doc', content: [{ type: 'paragraph' }] }, {}],
  ])('%s 清除上次报告且不发出伪导入事件', (_name, content, options) => {
    const { editorController, workspaceController, state, emit } = createHarness()
    editorController.setContent(VDITOR)
    emit.mockClear()

    editorController.setContent(content, options)

    expect(editorController.getImportReport()).toBeNull()
    expect(workspaceController.getImportReport()).toBeNull()
    expect(state.importReport).toBeNull()
    expect(emit).not.toHaveBeenCalled()
  })

  it('强制 vditor 模式在无指纹时仍生成报告', () => {
    const { editorController, emit } = createHarness()

    expect(editorController.setContent('<p>强制导入</p>', { format: 'vditor' })).toBe(true)
    expect(editorController.getImportReport()).toMatchObject({ source: 'vditor', taskItem: 0 })
    expect(emit).toHaveBeenCalledTimes(1)
  })

  it('超长及无效 JSON 被拒绝时保留上一次有效报告且不通知', () => {
    let maxLength = 0
    const { editorController, workspaceController, emit } = createHarness({ getMaxLength: () => maxLength })
    editorController.setContent(VDITOR)
    const previous = editorController.getImportReport()
    emit.mockClear()
    maxLength = 1

    expect(() => editorController.setContent('<p>超出长度</p>')).toThrow('正文不能超过 1 字')
    expect(() => editorController.setContent({ type: 'invalid' })).toThrow('请输入有效的 Tiptap 文档 JSON')
    expect(editorController.getImportReport()).toBe(previous)
    expect(workspaceController.getImportReport()).toBe(previous)
    expect(emit).not.toHaveBeenCalled()
  })

  it('兼容已有返回 HTML 字符串的 prepareHTML 回调', () => {
    const { editorController, emit } = createHarness({ prepareHTML: content => sanitizeHTML(content) })

    expect(editorController.setContent('<p>字符串准备器</p>')).toBe(true)
    expect(editorController.getImportReport()).toBeNull()
    expect(emit).not.toHaveBeenCalled()
  })
})

describe('导入报告 · LarkDoc 门面与控制器接线', () => {
  it('默认 DOM renderer 初始化保留回调、source 和实例统计', async () => {
    const onImportReport = vi.fn()
    const doc = createDocument({ rendererFactory: undefined, content: VDITOR, onImportReport })
    await Promise.resolve()

    expect(onImportReport).toHaveBeenCalledTimes(1)
    expect(onImportReport.mock.calls[0][0].source).toBe('vditor')
    expect(doc.getImportReport()).toMatchObject({ source: 'vditor', taskItem: 2 })
    expect(doc.getImportReport()).toBe(onImportReport.mock.calls[0][0])
    expect(doc.getJSON().content[0].type).toBe('taskList')
    expect(doc.importVditor(VDITOR.replace('待办', '再次导入'))).toBe(true)
    expect(onImportReport).toHaveBeenCalledTimes(2)
    expect(doc.getImportReport()).toMatchObject({ source: 'vditor', taskItem: 2 })
    expect(doc.setContent(PLAIN)).toBe(true)
    expect(doc.getImportReport()).toBeNull()
    expect(onImportReport).toHaveBeenCalledTimes(2)
  })

  it('初始化回调恰好一次，source 和实例读取保持原始统计', () => {
    const onImportReport = vi.fn()
    const doc = createDocument({ content: VDITOR, onImportReport })

    expect(onImportReport).toHaveBeenCalledTimes(1)
    expect(onImportReport.mock.calls[0][0].source).toBe('vditor')
    expect(doc.getImportReport()).toBe(onImportReport.mock.calls[0][0])
    expect(doc.getImportReport().taskItem).toBe(2)
  })

  it('importVditor 同时触发配置回调和事件，普通写入后实例不返回过期缓存', () => {
    const onImportReport = vi.fn()
    const doc = createDocument({ content: PLAIN, onImportReport })
    const listener = vi.fn()
    doc.on('import-report', listener)
    expect(onImportReport).not.toHaveBeenCalled()
    expect(doc.getImportReport()).toBeNull()

    expect(doc.importVditor(VDITOR)).toBe(true)
    expect(onImportReport).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledExactlyOnceWith(doc.getImportReport())
    expect(doc.getImportReport()).toMatchObject({ source: 'vditor', taskItem: 2 })
    expect(doc.setContent(PLAIN)).toBe(true)
    expect(doc.getImportReport()).toBeNull()
    expect(onImportReport).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('contentFormat html 跳过初始化和运行时导入报告', () => {
    const onImportReport = vi.fn()
    const doc = createDocument({ content: VDITOR, contentFormat: 'html', onImportReport })

    expect(doc.getImportReport()).toBeNull()
    doc.setContent(VDITOR)
    expect(doc.getImportReport()).toBeNull()
    expect(onImportReport).not.toHaveBeenCalled()
  })
})
