/**
 * 工作区控制器 —— 文件导入导出域。
 *
 * 三条入口都是「点下去才走」的懒边界，实现按需 import；构建侧对这三个 import 有
 * **按导入方文件路径**的白名单（`rollup.config.mjs` 的 `LAZY_PACKAGE_CALLERS` 与
 * transform 里的 `importCaller`），拆文件时这份名单必须同步，否则实现会被急切
 * 打进内核首屏。
 */
import { isImportEnabled, isExportEnabled } from '../components/lark-doc/larkDocConfig'
import { DOCUMENT_SCHEMA_VERSION } from '../core/documentSchema'
import { flattenHeadingContainers, safeUrl } from '../core/documentOperations'
import { createNetworkPolicy } from '../core/policy/network'
import { evaluateOutputPolicy } from '../core/policy/output'

export const transferMethods = {
  async importDocument(event) {
    if (!isImportEnabled(this.state.editorConfig)) return
    const file = event.target.files && event.target.files[0]
    event.target.value = ''
    if (this._fileImportIntent && !this._fileImportIntent.current()) this._fileImportIntent.retire()
    if (!file || this.state.importing || !this.writable()) return
    const importingEditor = this.getEditor()
    if (!importingEditor || !importingEditor.isEditable) return
    const session = this.getSession(), initialDoc = importingEditor.state.doc
    const providers = ['identity', 'authorization', 'security'].map(name => session?.getProvider?.(name))
    const scope = () => JSON.stringify([this.props.documentId, session?.documentId, this.props.user?.id, session?.user?.id,
      session?._identityGeneration, session?._privateIdentityGeneration, session?._authorizationGeneration])
    const key = scope(), abort = new AbortController(), cancelled = Symbol('retired file import'), stops = []
    let cancelWait
    const cancellation = new Promise(resolve => { cancelWait = () => resolve(cancelled) })
    const intent = {
      file, editor: importingEditor, abort, closed: false, committing: false,
      current: () => !intent.closed && this._fileImportIntent === intent && !this._disposed && !importingEditor.isDestroyed
        && this.getEditor() === importingEditor && this.getSession() === session && !session?._destroyed
        && this.state.mode !== 'read' && !this.state.forcedReadonly && isImportEnabled(this.state.editorConfig)
        && (typeof session?._identityCurrent !== 'function' || session._identityCurrent())
        && (typeof session?.can !== 'function' || session.can('canView') && session.can('canEdit'))
        && key === scope() && providers.every((provider, index) => provider === session?.getProvider?.(['identity', 'authorization', 'security'][index])),
      wait: async promise => {
        const value = await Promise.race([promise, cancellation])
        if (value === cancelled || !intent.current()) throw Object.assign(new Error('导入已取消'), { name: 'AbortError' })
        return value
      },
    }
    const release = cancelled => {
      if (intent.closed) return
      intent.closed = true
      if (cancelled) abort.abort()
      cancelWait(); stops.splice(0).forEach(stop => stop())
      if (this._fileImportIntent === intent) { this._fileImportIntent = null; if (!this._disposed) this.state.importing = false }
    }
    intent.retire = () => release(true)
    this._fileImportIntent = intent
    const check = () => { if (!intent.current() || !intent.committing && importingEditor.state.doc !== initialDoc) intent.retire() }
    for (const event of ['identity', 'comments-reset', 'capabilities', 'provider-changed', 'connection']) {
      const stop = session?.on?.(event, check)
      if (typeof stop === 'function') stops.push(stop)
    }
    importingEditor.on('transaction', check); importingEditor.on('editableUpdate', check); importingEditor.on('destroy', intent.retire)
    stops.push(() => importingEditor.off('transaction', check), () => importingEditor.off('editableUpdate', check), () => importingEditor.off('destroy', intent.retire))
    this.state.importing = true
    try {
      const { importWorkspaceFile } = await intent.wait(import('../editor/pagedDocumentSource'))
      if (intent.current()) return await importWorkspaceFile(this, file, importingEditor)
    } catch (error) { if (intent.current() && error.name !== 'AbortError') this.state.notice = `导入失败：${error.message}` }
    finally { release(false) }
  },

  async exportDocument(format) {
    if (this.state.importing || this.getEditor()?.storage?.larkDoc?.pagedImport) return false
    if (!isExportEnabled(this.state.editorConfig) || !format) return
    if (!this.state.editorConfig.importExport.exportFormats.includes(format)) return
    if (format === 'docx') return this.exportWordDocument()
    const editor = this.getEditor(), session = this.getSession(), principal = session?.user?.id
    const generation = session?._privateIdentityGeneration, auth = session?._authorizationGeneration
    const documentId = this.props.documentId, sessionDocumentId = session?.documentId, source = editor?.state?.doc
    const action = format === 'print' ? 'print' : 'download'
    const ports = ['identity', 'authorization', 'security']
    const providers = ports.map(name => session?.getProvider?.(name))
    const allowed = () => !this._disposed && !editor?.isDestroyed && !session?._destroyed
      && !this.state.importing && !editor?.storage?.larkDoc?.pagedImport
      && ports.every((name, index) => session?.getProvider?.(name) === providers[index])
      && this.getEditor() === editor && this.getSession() === session && session?.user?.id === principal
      && session?._privateIdentityGeneration === generation && session?._authorizationGeneration === auth
      && this.props.documentId === documentId && session?.documentId === sessionDocumentId && editor?.state?.doc === source
      && (typeof session?._identityCurrent !== 'function' || session._identityCurrent())
      && (typeof session?.can !== 'function' || (session.can('canView') && session.can('canExport')))
      && evaluateOutputPolicy(session?.getProvider?.('security')?.policy, action).allowed
      && isExportEnabled(this.state.editorConfig) && this.state.editorConfig.importExport.exportFormats.includes(format)
    if (!allowed()) return false
    try {
      const { downloadText, htmlToMarkdown, safeFileName } = await import(/* webpackChunkName: "import-export" */ '../utils/importExport')
      if (!allowed()) return false
      const filename = safeFileName(this.state.title)
      if (format === 'html') downloadText(this.getExportHTML(), `${filename}.html`, 'text/html;charset=utf-8')
      else if (format === 'json') downloadText(JSON.stringify({ schemaVersion: DOCUMENT_SCHEMA_VERSION, title: this.state.title, document: this.getJSON() }, null, 2), `${filename}.json`, 'application/json')
      else if (format === 'txt') downloadText(this.getText(), `${filename}.txt`, 'text/plain;charset=utf-8')
      else if (format === 'md') {
        const markdown = await htmlToMarkdown(this.getExportHTML())
        if (!allowed()) return false
        downloadText(markdown, `${filename}.md`, 'text/markdown;charset=utf-8')
        this.state.notice = 'Markdown 为简化导出，字体、分栏、公式和图片裁剪布局可能降级；JSON 可保留完整正文'
      } else if (format === 'print') {
        const folded = Array.from(editor.storage.larkDoc.folded)
        folded.forEach(id => editor.commands.toggleLarkDocFoldById(id))
        if (this.host.nextTick) this.host.nextTick(() => {
          try { if (allowed()) this.getWindow().print() }
          finally { if (!editor.isDestroyed) folded.forEach(id => editor.commands.toggleLarkDocFoldById(id)) }
        })
      }
      return true
    } catch (error) {
      if (allowed()) this.state.notice = `导出失败：${error.message}`
      return false
    }
  },

  async exportWordDocument() {
    const editor = this.getEditor(), session = this.getSession()
    const sourceDoc = editor?.state?.doc
    const documentId = this.props.documentId, sessionDocumentId = session?.documentId
    const networkKey = JSON.stringify(this.state.editorConfig.network)
    const current = () => !this._disposed && !editor?.isDestroyed && !session?._destroyed
      && this.getEditor() === editor && this.getSession() === session
      && this.props.documentId === documentId && session?.documentId === sessionDocumentId
      && editor?.state?.doc === sourceDoc
    const allowed = () => current() && isExportEnabled(this.state.editorConfig)
      && this.state.editorConfig.importExport.exportFormats.includes('docx')
      && (typeof session?.can !== 'function' || (session.can('canView') && session.can('canExport')))
      && JSON.stringify(this.state.editorConfig.network) === networkKey
    try {
      if (!current()) return false
      if (!allowed()) throw new Error('当前用户没有导出权限或导出已关闭')
      const title = this.state.title
      const doc = flattenHeadingContainers(JSON.parse(JSON.stringify(this.getJSON())))
      if (!doc || doc.type !== 'doc' || !Array.isArray(doc.content)) throw new Error('没有可导出的正文结构')
      const network = createNetworkPolicy(this.state.editorConfig.network)
      const sources = new Set()
      const visit = node => {
        if (node.type === 'image' && typeof node.attrs?.src === 'string' && node.attrs.src) sources.add(node.attrs.src)
        if (Array.isArray(node.content)) node.content.forEach(visit)
      }
      visit(doc)
      const { exportDocx } = await import(/* webpackChunkName: "import-export" */ '../utils/export/index.js')
      const images = {}, failed = new Set()
      const viewWindow = this.getWindow()
      const fetchImage = viewWindow.fetch || (typeof fetch === 'function' ? fetch : null)
      for (const src of sources) {
        if (!allowed()) throw new Error('导出期间文档、权限或网络策略已改变，请重新导出')
        // Never let collectImages implicitly fetch an off-policy resource or follow redirects.
        if (src.includes('\\') || !safeUrl(src, true) || !network.allows(src) || !fetchImage) { failed.add(src); continue }
        try {
          const response = await fetchImage(src, { credentials: 'same-origin', redirect: 'error' })
          if (!allowed()) throw new Error('导出条件已改变')
          if (!response.ok) throw new Error('图片读取失败')
          images[src] = new Uint8Array(await response.arrayBuffer())
        } catch (_) { failed.add(src) }
      }
      if (!allowed()) throw new Error('导出期间文档、权限或网络策略已改变，请重新导出')
      // Supplying even an empty map keeps the canonical exporter from fetching on its own.
      const result = await exportDocx(doc, { fileName: title, title, scope: 'contentOnly', images, shouldDownload: allowed })
      for (const src of result?.failedImages || []) failed.add(src)
      if (allowed()) {
        const warnings = [...(result?.warnings || [])]
        if (failed.size) warnings.push(`${failed.size} 张图片因网络策略或读取失败未导出`)
        this.state.notice = ['Word 已导出', ...warnings].join('；')
      }
      return result
    } catch (error) {
      if (current()) this.state.notice = `导出失败：${error.message}`
      return false
    }
  }
}
