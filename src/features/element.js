/** Element直挂档复用同目录的独立UMD特性包，不内联所有重依赖。 */
import { hasFeature, loadFeature, registerFeature } from '../core/features/registry'

const script = typeof document !== 'undefined' ? document.currentScript : null
const base = script && script.src ? new URL('.', script.src).href : null
const scripts = new Map()
// ui 组的样式独立成表，跟脚本同目录同位部署；这里只负责把 <link> 提前塞进去，
// 让样式与 JS 并行下载。样式缺失不影响功能，绝不 reject。
// 面板包拆成两半（选区/悬浮与侧栏面板），但共用同一张样式表：先到的那个把
// <link> 塞进 head，后到的靠 data-lark-doc-feature 去重，不会重复下载。
const stylesheets = {
  'lark-doc-element.umd.min.ui.js': 'lark-doc-element.ui.css',
  'lark-doc-element.umd.min.uiPanels.js': 'lark-doc-element.ui.css',
}

function loadStyle(file) {
  if (!file || !base || typeof document === 'undefined') return
  if (document.querySelector(`link[data-lark-doc-feature="${file}"]`)) return
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = new URL(file, base).href
  link.dataset.larkDocFeature = file
  ;(document.head || document.documentElement).appendChild(link)
}

function loadScript(file) {
  if (scripts.has(file)) return scripts.get(file)
  const promise = new Promise((resolve, reject) => {
    loadStyle(stylesheets[file])
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
    document.head.appendChild(node)
  })
  scripts.set(file, promise)
  return promise
}

const groups = {
  math: ['math'], mermaid: ['mermaid'], highlight: ['highlight'], markdown: ['markdown', 'markdown.serialize'],
  office: ['office.buildDocx', 'office.docx', 'office.mammoth'],
  // 面板包按触发时机拆成两支：ui 守选区/悬浮/表格/顶栏，ui.panels 守侧栏面板
  // 与对话框。加载槽位与包名一一对应，createDeferredUi 只拉自己那一个。
  ui: ['ui'], uiPanels: ['ui.panels', 'ui.aiHttp'],
  document: ['document.segmented', 'document.pagedView', 'document.pagedImport', 'document.shareLinks', 'document.shareLinkAccess'],
  // 导出/导入编排与远程转换：源码里就是点「导出」「导入」才 import()，单文件 UMD
  // 会把它压回首屏，所以单独出包，等真正点下去再拉。
  export: ['export.api', 'export.remoteConversion'],
  // 点了才出现的顶栏「文档信息」与标题编号菜单。幻灯片、模板保存对话框留在内核：
  // 它们经 documentOperations 静态拉住 @tiptap/pm/model，搬进包就得多下一份 PM。
  uiExtra: ['ui.documentInformation', 'ui.headingNumberMenu'],
  // 字节上传通道与转换/版本回执。后台统计（editor.documentSnapshot）留在内核，
  // 理由同上：documentSnapshot → documentStats → documentOperations 会带进 PM 全家。
  background: ['media.videoPopups', 'media.imageOutput', 'media.httpUpload', 'media.fileUploadTasks', 'session.resourceOutcome', 'versioning.snapshot'],
}
for (const group of Object.keys(groups)) {
  for (const name of groups[group]) {
    if (hasFeature(name)) continue
    let loaded = false
    registerFeature(name, () => {
      if (loaded) throw new Error(`特性包未注册 ${name}`)
      return loadScript(`lark-doc-element.umd.min.${group}.js`).then(() => {
        loaded = true
        return loadFeature(name)
      })
    })
  }
}
