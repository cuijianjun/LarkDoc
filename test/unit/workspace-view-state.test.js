import { describe, expect, it } from 'vitest'
import { createLarkDocConfig } from '../../src/components/lark-doc/larkDocConfig'
import {
  createWorkspaceViewState,
  deriveAIPreviewHtml,
  deriveNotice,
  deriveWorkspaceFeatureFlags,
  deriveWorkspaceReadonly,
} from '../../src/core/workspace/workspace-view-state'

describe('workspace view state 纯函数', () => {
  it('统一投影 notice 与 feature flags', () => {
    const state = {
      notice: '导入完成',
      editorConfig: { features: { history: false, ai: false } },
    }

    expect(createWorkspaceViewState(state)).toMatchObject({
      notice: '导入完成',
      persistenceEnabled: true,
      importExportEnabled: true,
      templatesEnabled: true,
      historyEnabled: false,
      aiEnabled: false,
    })
    expect(createWorkspaceViewState(state).featureFlags).toEqual({
      persistence: true,
      importExport: true,
      templates: true,
      history: false,
      ai: false,
    })
    expect(deriveNotice({ notice: null })).toBe('')
    expect(deriveWorkspaceFeatureFlags({ editorConfig: { features: { ai: false } } }, {}, ['ai', 'history'])).toEqual({
      ai: false,
      history: true,
    })
  })

  it('只在富文本预览条件满足时计算 aiPreviewHtml', () => {
    expect(deriveAIPreviewHtml({ aiPreview: '' })).toBe('')
    expect(deriveAIPreviewHtml({ aiPreview: '普通文本', aiContentFormat: 'text' })).toBe('')
    expect(deriveAIPreviewHtml({ aiPreview: '普通文本', aiContentFormat: 'auto' })).toBe('<p>普通文本</p>')
    expect(deriveAIPreviewHtml({ aiPreview: '# 标题', aiContentFormat: 'auto' })).toBe('<h1>标题</h1>')
    expect(deriveAIPreviewHtml({ aiPreview: '普通文本', aiContentFormat: 'html' })).toBe('普通文本')
  })

  it('按统一交互模式口径计算 readonly，修订态仍可编辑', () => {
    expect(deriveWorkspaceReadonly()).toBe(false)
    expect(deriveWorkspaceReadonly({}, { readonly: true })).toBe(true)
    expect(deriveWorkspaceReadonly({ forcedReadonly: true })).toBe(true)
    expect(deriveWorkspaceReadonly({ mode: 'read' })).toBe(true)
    expect(deriveWorkspaceReadonly({ slides: true })).toBe(true)
    expect(deriveWorkspaceReadonly({}, { capabilities: { canEdit: false } })).toBe(true)
    expect(deriveWorkspaceReadonly({ mode: 'suggest' })).toBe(false)
  })

  it('不修改输入对象', () => {
    const state = {
      notice: '提示',
      aiPreview: '**加粗**',
      aiContentFormat: 'auto',
      editorConfig: { features: { ai: false } },
    }
    const before = JSON.parse(JSON.stringify(state))
    createWorkspaceViewState(state)
    expect(state).toEqual(before)
  })

  it('默认投影提供可见的独立导入导出入口、accept与占位文案', () => {
    const view = createWorkspaceViewState()
    expect(view.importEnabled).toBe(true)
    expect(view.exportEnabled).toBe(true)
    expect(view.importAccept).toBe('.html,.htm,.json,.md,.markdown,.docx')
    expect(view.importLabel).toBe('导入')
    expect(view.exportOptions[0]).toEqual({ value: '', label: '导出' })
    expect(view.exportOptions.map(item => item.value)).toEqual(['', 'html', 'json', 'md', 'txt', 'docx', 'print'])
  })

  it('从当前配置投影独立开关、格式与文案，配置变化后不保留旧菜单', () => {
    const state = { editorConfig: createLarkDocConfig({ importExport: {
      importEnabled: false, exportEnabled: true,
      importLabel: '上传文档', exportLabel: '下载副本',
      importFormats: ['json'], exportFormats: ['txt'],
    } }) }
    const first = createWorkspaceViewState(state)
    expect(first).toMatchObject({ importEnabled: false, exportEnabled: true, importAccept: '.json', importLabel: '上传文档' })
    expect(first.exportOptions[0]).toEqual({ value: '', label: '下载副本' })
    expect(first.exportOptions.map(item => item.value)).toEqual(['', 'txt'])
    state.editorConfig = createLarkDocConfig({ importExport: { importEnabled: true, exportEnabled: false, importFormats: ['html'], exportFormats: ['json'] } })
    const next = createWorkspaceViewState(state)
    expect(next).toMatchObject({ importEnabled: true, exportEnabled: false, importAccept: '.html,.htm' })
    expect(next.exportOptions.map(item => item.value)).toEqual(['', 'json'])
    expect(first.exportOptions.map(item => item.value)).toEqual(['', 'txt'])
  })

  it('持久化之外的导入导出总闸仍同时隐藏两个入口', () => {
    expect(createWorkspaceViewState({ editorConfig: createLarkDocConfig({ features: { importExport: false } }) })).toMatchObject({ importEnabled: false, exportEnabled: false })
  })
})
