import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '../..')
const source = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')
const exists = (relative) => fs.existsSync(path.join(root, relative))

const editor = source('src/components/lark-doc/LarkDocEditor.vue')
const workspace = source('src/components/lark-doc/LarkDocWorkspace.vue')
const baseline = source('scripts/architecture-baseline.json')
const overlays = source('src/ui/overlays.js')
const overlaysUi = source('src/components/lark-doc/editor/overlaysUiMixin.js')
const shareMixin = source('src/components/lark-doc/editor/shareMixin.js')
const exportMixin = source('src/components/lark-doc/editor/exportMixin.js')
const index = source('src/index.js')

const removed = [
  'src/components/lark-doc/LarkDocIcon.vue',
  'src/components/lark-doc/LarkDocSelect.vue',
  'src/components/lark-doc/ExportDialog.vue',
  'src/components/lark-doc/SharePopover.vue',
  'src/components/lark-doc/PermissionDialog.vue',
]

const shareHandlers = [
  'onRequestAccess', 'onToggleSharePopover', 'onOpenPermissionDialog', 'onSetShareInviteQuery',
  'onSetShareLinkPerm', 'onCopyShareLink', 'onClosePermissionDialog', 'onTogglePermissionValue',
  'onSetPermissionValue', 'onToggleAdvancedSettings', 'onToggleSecureLink', 'onCopyLinkAndPassword',
  'onOpenPasswordDialog', 'onCancelSecureLinkConfirm', 'onConfirmSecureLink', 'onClosePasswordDialog',
  'onSetPasswordDraft', 'onRandomizePasswordDraft', 'onSaveSharePassword',
]

const exportHandlers = ['onCloseExportDialog', 'onCancelExport', 'onSelectExportScope', 'onSubmitExport']

describe('阶段7浮层批次 · 分享与权限 SFC 收口', () => {
  it('删除已由原生 renderer 覆盖的五个 SFC，并收紧架构基线', () => {
    removed.forEach((file) => expect(exists(file)).toBe(false))
    expect(baseline).not.toContain('components/lark-doc/SharePopover.vue')
    expect(baseline).not.toContain('components/lark-doc/PermissionDialog.vue')
  })

  it('不改变指定范围外的门面、工作区和模板库', () => {
    [
      'src/components/lark-doc/TemplateLibrary.vue',
      'src/components/lark-doc/LarkDocEditor.vue',
      'src/components/lark-doc/LarkDocWorkspace.vue',
    ].forEach((file) => expect(exists(file)).toBe(true))
    expect(workspace).toContain("import LarkDocEditor from './LarkDocEditor.vue'")
    expect(editor).toContain('import overlaysUiMixin from')
    expect(index).toContain("import LarkDocEditor from './components/lark-doc/LarkDocEditor.vue'")
  })

  it('移除真实 import/注册，不保留两个旧 SFC 的引用', () => {
    expect(editor).not.toContain('SharePopover')
    expect(editor).not.toContain('PermissionDialog')
    expect(overlaysUi).not.toContain("from '../SharePopover.vue'")
    expect(overlaysUi).not.toContain("from '../PermissionDialog.vue'")
    expect(overlays).toContain('export function createOverlays')
  })

  it('原生 renderer 与 overlaysUiMixin 覆盖分享、权限及全部业务回调', () => {
    shareHandlers.forEach((name) => {
      expect(overlays).toContain(`'${name}'`)
      expect(overlaysUi).toContain(`${name}:`)
    })
    exportHandlers.forEach((name) => expect(overlays).toContain(`'${name}'`))
    expect(overlaysUi).toContain('onSubmitExport: () => this.submitExport()')
    expect(overlays).toContain('function createPermissionView')
    expect(overlays).toContain('function createPasswordView')
    expect(overlays).toContain('function createConfirmView')
    expect(overlays).toContain('function createExportView')
  })

  it('覆盖加密链接、密码、Esc 层级、toast 与导出路径的状态接线', () => {
    [
      'secureLinkEnabled', 'secureLinkPassword', 'secureLinkConfirmOpen', 'passwordDialogOpen',
      'passwordDraft', 'sharePasswordRules', 'shareToast', 'shareDialogScopeText',
      'exportOpen', 'exportToast', 'exportPanelTitle', 'exportScopeOptions', 'exportScopeValue',
      'exportCanExport', 'exportSubmitDisabled',
    ].forEach((key) => expect(overlaysUi).toContain(key))
    expect(overlays).toContain('SECURE_CONFIRM_MESSAGES.forEach')
    expect(overlays).toContain('SECURE_LINK_TIP')
    expect(overlays).toContain('onCancelSecureLinkConfirm')
    expect(overlays).toContain('onConfirmSecureLink')
    expect(overlays).toContain('onCopyLinkAndPassword')
    expect(overlays).toContain('shareToast.kind')
    expect(overlays).toContain('onSubmitExport')
    expect(exportMixin).toContain('onExportKeydown')
    expect(shareMixin).toContain('onShareWindowKeydown')
    expect(shareMixin).toContain('this.passwordDialogOpen')
    expect(shareMixin).toContain('this.secureLinkConfirmOpen')
    expect(shareMixin).toContain('this.permissionDialogOpen')
    expect(shareMixin).toContain('this.sharePopoverOpen')
    expect(exportMixin).toContain('dispatchExport(format, scope, fileName)')
  })

  it('补齐 renderer 对动态协作者和二级 scope 的刷新监听', () => {
    expect(overlaysUi).toContain('shareCollaborators: { deep: true')
    expect(overlaysUi).toContain('shareDialogLinkPerm()')
    expect(overlaysUi).toContain('shareCollaboratorInitial: this.shareCollaboratorInitial')
    expect(overlaysUi).toContain('shareDialogScopeText: this.shareDialogScopeText')
  })
})
