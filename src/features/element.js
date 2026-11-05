/** Element直挂档复用同目录的独立UMD特性包，不内联所有重依赖。 */
import { hasFeature, loadFeature, registerFeature } from '../core/features/registry'

const script = typeof document !== 'undefined' ? document.currentScript : null
const base = script && script.src ? new URL('.', script.src).href : null
const scripts = new Map()

function loadScript(file) {
  if (scripts.has(file)) return scripts.get(file)
  const promise = new Promise((resolve, reject) => {
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
  office: ['office.buildDocx', 'office.docx', 'office.mammoth'], ui: ['ui'],
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
