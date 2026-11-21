/** Element直挂档复用同目录的独立UMD特性包，不内联所有重依赖。 */
import { hasFeature, loadFeature, registerFeature } from '../core/features/registry'

const script = typeof document !== 'undefined' ? document.currentScript : null
const base = script && script.src ? new URL('.', script.src).href : null
const scripts = new Map()
const stylesheets = new Map()
const sharedUiStylesheet = 'lark-doc-element.ui.css'
const panelToolsStylesheet = 'lark-doc-element.panels.css'
const sharedUiPacks = new Set(['ui', 'uiPanels', 'uiOverlays'])
const panelToolsPacks = new Set(['uiPanels', 'uiOverlays', 'uiExtra'])

function loadStyle(file, before) {
  if (stylesheets.has(file)) return stylesheets.get(file)
  const existing = document.querySelector(`link[data-lark-doc-feature="${file}"]`)
  const link = existing || document.createElement('link')
  const ready = existing ? Promise.resolve(true) : new Promise(resolve => {
    link.addEventListener('load', () => resolve(true), { once: true })
    link.addEventListener('error', () => {
      link.remove()
      stylesheets.delete(file)
      resolve(false)
    }, { once: true })
  })
  const stylesheet = { link, ready }
  stylesheets.set(file, stylesheet)
  if (!existing) {
    link.rel = 'stylesheet'
    link.href = new URL(file, base).href
    link.dataset.larkDocFeature = file
    const head = document.head || document.documentElement
    head.insertBefore(link, before?.parentNode === head ? before : null)
  }
  return stylesheet
}

function loadScript(group) {
  const file = `lark-doc-element.umd.min.${group}.js`
  if (scripts.has(file)) return scripts.get(file)
  const promise = new Promise((resolve, reject) => {
    // Only the pure document group supports direct CommonJS consumers. Keep
    // Module.require bound to this runtime's real adjacent output directory.
    const nodeModule = file === 'lark-doc-element.umd.min.document.js' && typeof module === 'object' ? module : null
    if (nodeModule && typeof nodeModule.require === 'function') {
      Promise.resolve().then(() => nodeModule.require('./' + file)).then(resolve, error => { scripts.delete(file); reject(error) })
      return
    }
    if (!base || typeof document === 'undefined') {
      reject(new Error('Element特性包需要与主文件同目录静态托管；打包器宿主请使用lark-doc主入口'))
      return
    }
    const node = document.createElement('script')
    node.src = new URL(file, base).href
    node.onload = resolve
    node.onerror = () => { node.remove(); scripts.delete(file); reject(new Error(`无法加载本地特性包 ${file}`)) }
    const shared = sharedUiPacks.has(group) ? loadStyle(sharedUiStylesheet) : null
    // Optional factories can mount as soon as the script registers them. Keep
    // panel styles ahead of shared dialog overrides and wait for both sheets.
    if (panelToolsPacks.has(group)) {
      const sharedLink = stylesheets.get(sharedUiStylesheet)?.link
      const panels = loadStyle(panelToolsStylesheet, sharedLink)
      Promise.all([panels.ready, shared?.ready]).then(([panelsLoaded, sharedLoaded]) => {
        if (!panelsLoaded || sharedLoaded === false) throw new Error(`无法加载 ${group} 界面样式`)
        document.head.appendChild(node)
      }).catch(error => {
        scripts.delete(file)
        reject(error)
      })
    } else document.head.appendChild(node)
  })
  scripts.set(file, promise)
  return promise
}

const groups = {
  math: ['math'], mermaid: ['mermaid'], highlight: ['highlight'], markdown: ['markdown', 'markdown.serialize'],
  office: ['office.buildDocx', 'office.docx', 'office.mammoth'],
  // 加载槽位与包名一一对应，createDeferredUi 只拉对应的工厂表。
  ui: ['ui'], uiPanels: ['ui.panels', 'ui.aiHttp'],
  uiOverlays: ['ui.overlays', 'ui.templateSave', 'ui.importConfirmation', 'ui.stage'],
  document: ['document.segmented', 'document.pagedView', 'document.pagedImport', 'document.shareLinks', 'document.shareLinkAccess'],
  // 导出/导入编排与远程转换：源码里就是点「导出」「导入」才 import()，单文件 UMD
  // 会把它压回首屏，所以单独出包，等真正点下去再拉。
  export: ['export.api', 'export.remoteConversion'],
  // 点了才出现的顶栏「文档信息」与标题编号菜单。
  uiExtra: ['ui.documentInformation', 'ui.headingNumberMenu'],
  background: ['media.videoPopups', 'media.imageOutput', 'media.httpUpload', 'media.fileUploadTasks', 'session.resourceOutcome', 'versioning.snapshot', 'document.snapshot', 'media.fileDownload', 'ui.pollTools'],
}
for (const group of Object.keys(groups)) {
  for (const name of groups[group]) {
    if (hasFeature(name)) continue
    let loaded = false
    registerFeature(name, () => {
      if (loaded) throw new Error(`特性包未注册 ${name}`)
      return loadScript(group).then(() => {
        loaded = true
        return loadFeature(name)
      })
    })
  }
}
