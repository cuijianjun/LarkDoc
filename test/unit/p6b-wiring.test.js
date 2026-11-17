/**
 * P6b 接线：文档级能力通过原生宿主和原生 UI 挂进同一个编辑器实例。
 *
 * 守卫聚合顺序、浮层宿主、真实插入 / 移除以及 capability 视觉投影。
 * 全部读取源码文本，不加载组件或编辑器的运行时依赖。
 */
import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'

const root = path.resolve(__dirname, '../..')
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')

const nativeHost = read('src/editor/nativeEditorHost.js')
const shell = read('src/ui/workspaceShell.js')
const aggregator = read('src/components/lark-doc/editor/p6bMixin.js')
const overlaysUi = read('src/components/lark-doc/editor/overlaysUiMixin.js')
// 浮层实现已从 ui/overlays.js 拆到同目录五个文件（overlays.js 只剩出口），
// 这里直接读实现文件：断言口径不变，量的还是同一批 DOM 结构与语义属性。
const overlaysRenderer = read('src/ui/overlays.js') +
  ['overlayShared', 'shareView', 'permissionView', 'exportView', 'imageShareView']
    .map((name) => read(`src/ui/${name}.js`)).join('\n')
const shareEntryRenderer = read('src/ui/shareEntry.js')
// 面板实现已从 ui/panels.js 拆到 commentPanel / versionPanel（panels.js 只剩出口），
// 评论面板内部再按「静态骨架 / 线程卡片 / 纯函数」拆成三份实现文件；
// 这里直接读实现文件，切片锚点仍是那两个导出函数。
const commentPanelFiles = ['commentPanel', 'commentPanelChrome', 'commentPanelThread', 'commentPanelParts']
const panelsRenderer = [...commentPanelFiles, 'versionPanel'].map(name => read(`src/ui/${name}.js`)).join('\n')
const panelsUi = read('src/components/lark-doc/editor/panelsUiMixin.js')
const panelPresentation = read('src/components/lark-doc/editor/panelPresentation.js')
const topBarRenderer = read('src/ui/topBar.js')
const topBarMenusRenderer = read('src/ui/topBarMenus.js')

// 宿主和聚合层都可能使用多行 mixins 数组，必须匹配完整数组。
const hostMixins = nativeHost.match(/mixins:\s*\[([\s\S]*?)\]/)[1]
const aggregatorMixins = aggregator.match(/mixins:\s*\[([\s\S]*?)\]/)[1]

describe('P6b · 门面接线', () => {
  it('p6bMixin 与 overlaysUiMixin 已注册，外壳挂载原生浮层宿主', () => {
    expect(nativeHost).toContain("import p6bMixin from '../components/lark-doc/editor/p6bMixin'")
    expect(nativeHost).toContain("import overlaysUiMixin from '../components/lark-doc/editor/overlaysUiMixin'")
    expect(hostMixins).toContain('p6bMixin')
    expect(hostMixins).toContain('overlaysUiMixin')
    expect(shell).toContain("const overlayHost = ownerDocument.createElement('div')")
    expect(shell).toContain('headingNumberMenuHost, overlayHost)')
    expect(nativeHost).toContain("['Overlays', 'refreshOverlays']")
    expect(nativeHost).toContain('host[`mount${domain}`]()')
    expect(overlaysUi).toContain('createDocumentOverlays')
    expect(overlaysUi).toContain('createShareEntry')
  })

  it('原生宿主仍守 P0-03 的 <700 行门禁（含 P6b 全部接线）', () => {
    expect(nativeHost.split('\n').length).toBeLessThan(700)
  })

  it('文档级子 mixin 全在聚合层里，且 readingModeMixin 排最后', () => {
    const names = [
      'commentsMixin', 'versioningMixin', 'shareMixin', 'exportMixin',
      'topbarMoreMixin', 'linkHoverMixin', 'coverMixin', 'codeLangMixin',
      'confirmMixin', 'createMenuMixin', 'notifyMixin', 'relationBitableMixin',
      'readingModeMixin',
    ]
    for (const name of names) {
      expect(aggregator).toContain(`import ${name} from './${name}'`)
    }
    expect(aggregatorMixins.split(',').map(name => name.trim()).filter(Boolean)).toEqual(names)
  })
})

describe('P6b · 浮层容器', () => {
  it('原生渲染器保留分享 / 权限 / 导出完整结构与语义属性', () => {
    for (const className of [
      'lark-doc-share-popover', 'lark-doc-permission-layer',
      'lark-doc-share-confirm', 'lark-doc-share-password', 'lark-doc-export-backdrop',
      'lark-doc-export-panel',
    ]) expect(overlaysRenderer).toContain(className)
    expect(shareEntryRenderer).toContain('lark-doc-share-mask')
    expect(shareEntryRenderer).toContain('shareViewMaskVisible')
    expect(overlaysRenderer).toContain('createShareEntry')
    expect(overlaysRenderer).toContain("role', 'dialog'")
    expect(overlaysRenderer).toContain('aria-modal')
    expect(overlaysRenderer).toContain('aria-label')
  })

  it('原生浮层使用真实插入 / 移除，并保留遮罩、Esc 业务出口', () => {
    expect(overlaysRenderer).toContain('mountNode(host, el, true)')
    expect(overlaysRenderer).toContain('event.target === backdrop')
    expect(overlaysUi).toContain('destroyOverlays()')
  })

  it('评论、历史版本控件保留 capability 与禁用态投影', () => {
    const commentPanel = commentPanelFiles.map(name => read(`src/ui/${name}.js`)).join('\n')
    const versionPanel = panelsRenderer.slice(
      panelsRenderer.indexOf('export function createVersionPanel('),
      panelsRenderer.indexOf('export function createVersionToast('),
    )
    for (const source of [commentPanel, versionPanel]) {
      expect(source).toContain("'data-capability'")
      expect(source).toContain("'aria-disabled'")
    }
    expect(commentPanel).toContain("control.id === 'resolve' ? 'canResolveComment' : 'canComment'")
    expect(versionPanel).toContain("'data-capability', 'canRestoreVersion'")
    // 面板内每个 capability 点都必须是「还原」口径；`canCreateVersion` 已无前端入口。
    expect(versionPanel).not.toContain("'canCreateVersion'")
    // 手动「另存为版本」已下线：只保留只读的历史列表 + 自动保存提示浮条。
    expect(panelsRenderer).not.toContain('createSaveVersionDialog')
  })

  it('原生评论菜单把线程 id 传给编辑/删除权限判定', () => {
    expect(panelsUi).toContain('...panelPresentation.methods')
    expect(panelPresentation).toContain('visible: this.commentMenuVisible(menu, reply, item.id)')
  })

  it('分享、权限设置和导出控件保留 capability 与禁用态投影', () => {
    for (const control of ['permissionButton', 'toggle', 'submit', 'label']) {
      const capability = control === 'permissionButton' || control === 'toggle' ? 'canManagePermission' : 'canExport'
      expect(overlaysRenderer).toContain(`attr(${control}, 'data-capability', '${capability}')`)
      expect(overlaysRenderer).toContain(`attr(${control}, 'aria-disabled',`)
    }
    expect(overlaysUi).toContain("shareCanManagePermission: this.shareCan('canManagePermission')")
    expect(overlaysUi).toContain('exportCanExport: this.exportCanExport')
    expect(overlaysUi).toContain('exportSubmitDisabled: this.exportSubmitDisabled')
  })

  it('顶栏更多菜单按权限映射 capability 与禁用态', () => {
    expect(topBarRenderer).toContain('TOPBAR_MORE_CAPABILITY')
    expect(topBarRenderer).toContain('capabilities: TOPBAR_MORE_CAPABILITY')
    expect(topBarMenusRenderer).toContain("setAttr(node, 'data-capability', capability || null)")
    expect(topBarMenusRenderer).toContain("setAttr(node, 'aria-disabled', String(node.disabled))")
  })
})
