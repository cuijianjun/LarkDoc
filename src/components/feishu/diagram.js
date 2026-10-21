/**
 * 图表渲染器（mermaid）。
 *
 * 设计约束：
 * - JSON/HTML 契约不变：图表始终存为 codeBlock + language，渲染只发生在 NodeView；
 * - 渲染器懒加载：vendored UMD 产物不参与打包，只在文档真的出现 mermaid
 *   代码块且需要预览时，才通过 <script> 注入加载；
 * - 全程本地渲染，不请求外部服务（遵守 check:offline）；
 * - mermaid.render 是异步竞态源，调用方必须用版本号丢弃过期结果。
 */

const DIAGRAM_LANGUAGES = Object.freeze(['mermaid'])

let rendererPromise = null

/** 该语言是否由内置图表渲染器接管。 */
export function isDiagramLanguage(name) {
  return DIAGRAM_LANGUAGES.indexOf(name) !== -1
}

/** 当前支持的图表语言清单（配置层用它生成下拉项）。 */
export function listDiagramLanguages() {
  return DIAGRAM_LANGUAGES.slice()
}

/** vendored mermaid.min.js 的运行时地址（构建期由 file-loader 落盘）。 */
function defaultScriptUrl() {
  // eslint-disable-next-line global-require
  const module = require('file-loader?name=vendor/[name].[hash:8].[ext]!../../assets/vendor/mermaid/mermaid.min.js')
  return module && module.default ? module.default : module
}

function loadMermaidScript(scriptUrl) {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') { reject(new Error('图表渲染需要浏览器环境')); return }
    const existing = window.mermaid
    if (existing && typeof existing.initialize === 'function') { resolve(existing); return }
    let url
    if (scriptUrl) {
      url = String(scriptUrl)
    } else {
      try {
        url = defaultScriptUrl()
      } catch (error) { reject(new Error('mermaid 资源缺失')); return }
    }
    const script = document.createElement('script')
    script.src = url
    script.async = true
    script.setAttribute('data-feishu-diagram', 'mermaid')
    script.onload = () => {
      if (window.mermaid && typeof window.mermaid.initialize === 'function') resolve(window.mermaid)
      else reject(new Error('mermaid 加载失败'))
    }
    script.onerror = () => reject(new Error('mermaid 加载失败'))
    document.head.appendChild(script)
  })
}

function loadRenderer(scriptUrl) {
  if (!rendererPromise) {
    rendererPromise = loadMermaidScript(scriptUrl).then((mermaid) => {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'default',
        fontFamily: 'inherit',
      })
      return mermaid
    })
  }
  return rendererPromise
}

/**
 * 渲染图表源码，resolve 出 SVG 字符串；语法错误或渲染器不可用时 reject。
 * 每次调用生成独立 id，避免 mermaid 内部注册表冲突。
 *
 * @param {string} source 图表源码
 * @param {{ scriptUrl?: string }} options 自定义渲染器地址（宿主自托管时用）；
 *   默认使用包内 vendored 产物——从源码打包的宿主由 file-loader 自动落盘，
 *   直接消费预构建 dist 的宿主需把 `dist/vendor/` 拷进站点静态目录，或传此参数。
 */
export function renderDiagram(source, options = {}) {
  const id = 'feishu-diagram-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
  return loadRenderer(options.scriptUrl)
    .then((mermaid) => mermaid.render(id, String(source || '')))
    .then((result) => {
      const svg = result && result.svg
      if (!svg) throw new Error('empty svg')
      return svg
    })
}
