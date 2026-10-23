/**
 * 图表渲染器（mermaid）。
 *
 * 设计约束：
 * - JSON/HTML 契约不变：图表始终存为 codeBlock + language，渲染只发生在 NodeView；
 * - 渲染器懒加载：vendored UMD 通过动态 import() 拆成懒 chunk，寻址由构建
 *   工具统一接管——宿主从源码编译时由宿主输出 chunk（内网/外网零配置），
 *   直接消费预构建 dist 时按同目录 chunk 加载（整目录静态托管即可）；
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

/**
 * 默认加载通道：动态 import() 懒 chunk。
 * vendored 产物是 UMD（`module.exports = factory()`），webpack 以 CJS 互操作
 * 处理后完整接口挂在 namespace.default 上；页面已自行加载 mermaid 时直接复用
 * 全局实例，避免双份运行时。
 */
function loadMermaidModule() {
  if (typeof window !== 'undefined' && window.mermaid && typeof window.mermaid.initialize === 'function') {
    return Promise.resolve(window.mermaid)
  }
  return import(/* webpackChunkName: "mermaid" */ '../../assets/vendor/mermaid/mermaid.min.js')
    .then((m) => {
      const mermaid = (m && m.default) || m
      if (mermaid && typeof mermaid.initialize === 'function') return mermaid
      throw new Error('mermaid 模块缺失 initialize 接口')
    })
}

/**
 * 逃生舱通道：宿主自托管 mermaid 或需要固定 URL 时，仍通过 <script> 注入。
 * 仅当调用方显式传 scriptUrl 时启用。
 */
function loadMermaidScript(scriptUrl) {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') { reject(new Error('图表渲染需要浏览器环境')); return }
    const existing = window.mermaid
    if (existing && typeof existing.initialize === 'function') { resolve(existing); return }
    if (!scriptUrl) { reject(new Error('mermaid 自定义地址缺失')); return }
    const script = document.createElement('script')
    script.src = String(scriptUrl)
    script.async = true
    script.setAttribute('data-lark-doc-diagram', 'mermaid')
    script.onload = () => {
      if (window.mermaid && typeof window.mermaid.initialize === 'function') resolve(window.mermaid)
      else reject(new Error('mermaid 加载失败'))
    }
    script.onerror = () => reject(new Error('mermaid 加载失败'))
    document.head.appendChild(script)
  })
}

/**
 * 图表字体栈：与 Vditor 一致使用 mermaid 默认字体（trebuchet ms 起头），
 * 追加 CJK 兜底。必须用具体字体而不是 'inherit' —— mermaid 在隐藏容器里按该
 * fontFamily 测量文本宽度，'inherit' 在测量容器与 SVG 内解析不一致，中文会被
 * 算窄导致节点标签横向被裁剪。
 */
const DIAGRAM_FONT_FAMILY = '"trebuchet ms", verdana, arial, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif'

function loadRenderer(scriptUrl) {
  if (!rendererPromise) {
    const loaded = scriptUrl ? loadMermaidScript(scriptUrl) : loadMermaidModule()
    rendererPromise = loaded.then((mermaid) => {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        fontFamily: DIAGRAM_FONT_FAMILY,
        // 标签一律用 SVG <text> 渲染，关闭 HTML 标签（foreignObject）：
        // mermaid 在页面隐藏容器里测量 HTML 标签、又在 SVG 内渲染，宿主
        // 样式（行高/字号/边距）两边继承不一致，节点文字就会上下偏移——
        // 这是此前「文字偏上/偏下」反复出现的根因。SVG 文本由 mermaid 用
        // getBBox 实测尺寸定位，居中精确且不受宿主任何 CSS 影响。
        flowchart: { htmlLabels: false },
        class: { htmlLabels: false },
        state: { htmlLabels: false },
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
 *   默认走动态 import() 懒 chunk，由构建工具统一接管寻址，无需任何配置。
 */
export function renderDiagram(source, options = {}) {
  const id = 'lark-doc-diagram-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
  return loadRenderer(options.scriptUrl)
    .then((mermaid) => mermaid.render(id, String(source || '')))
    .then((result) => {
      const svg = result && result.svg
      if (!svg) throw new Error('empty svg')
      return svg
    })
}
