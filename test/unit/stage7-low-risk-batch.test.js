import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '../..')
const source = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')
const exists = (relative) => fs.existsSync(path.join(root, relative))

const editor = source('src/components/lark-doc/LarkDocEditor.vue')
const share = source('src/components/lark-doc/SharePopover.vue')
const workspace = source('src/components/lark-doc/LarkDocWorkspace.vue')
const icon = source('src/ui/icon.js')
const select = source('src/ui/select.js')
const overlays = source('src/ui/overlays.js')
const overlaysUi = source('src/components/lark-doc/editor/overlaysUiMixin.js')

const removed = [
  'src/components/lark-doc/LarkDocIcon.vue',
  'src/components/lark-doc/LarkDocSelect.vue',
  'src/components/lark-doc/ExportDialog.vue',
]

describe('阶段7低风险批次 · SFC 收口', () => {
  it('删除三个已被原生 renderer 覆盖的 SFC', () => {
    removed.forEach((file) => expect(exists(file)).toBe(false))
  })

  it('编辑器和保留分享组件不再依赖旧图标组件', () => {
    expect(editor).toContain('class="lark-doc-error-close-icon lark-doc-icon"')
    expect(editor).toContain('<svg')
    expect(editor).not.toContain('LarkDocIcon')
    expect(share).toContain('class="lark-doc-icon"')
    expect(share).toContain('<svg')
    expect(share).not.toContain('LarkDocIcon')
  })

  it('原生下拉和导出浮层保留业务回调接线', () => {
    expect(select).toContain('export function createSelect')
    expect(select).toContain('onChange(value)')
    expect(overlaysUi).toContain('createOverlays')
    expect(overlaysUi).toContain('onSubmitExport: () => this.submitExport()')
    expect(overlays).toContain('function createExportView')
    expect(overlays).toContain("onCloseExportDialog")
    expect(overlays).toContain("onSelectExportScope")
    expect(overlays).toContain("onSubmitExport")
  })

  it('公开门面与指定保留组件仍存在', () => {
    ;[
      'src/components/lark-doc/SharePopover.vue',
      'src/components/lark-doc/PermissionDialog.vue',
      'src/components/lark-doc/TemplateLibrary.vue',
      'src/components/lark-doc/LarkDocEditor.vue',
      'src/components/lark-doc/LarkDocWorkspace.vue',
    ].forEach((file) => expect(exists(file)).toBe(true))
    expect(workspace).toContain("import LarkDocEditor from './LarkDocEditor.vue'")
    expect(source('src/index.js')).toContain("import LarkDocEditor from './components/lark-doc/LarkDocEditor.vue'")
  })

  it('原生图标仍保持尺寸、类名和未知图标兼容契约', () => {
    expect(icon).toContain('export function iconMarkup(name)')
    expect(icon).toContain("return ICONS[name] || ''")
    expect(icon).toContain("span.className = className ? `${className} lark-doc-icon` : 'lark-doc-icon'")
    expect(icon).toContain('span.style.width = `${size}px`')
    expect(icon).toContain('span.style.height = `${size}px`')
  })
})
