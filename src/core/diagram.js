/**
 * 图表渲染器（mermaid）。
 *
 * 设计约束：
 * - JSON/HTML 契约不变：图表始终存为 codeBlock + language，渲染只发生在 NodeView；
 * - 渲染器懒加载：vendored UMD 通过动态 import() 拆成懒 chunk，寻址由构建
 *   工具统一接管——宿主从源码编译时由宿主输出 chunk（内网/外网零配置），
 *   直接消费预构建 dist 时按同目录 chunk 加载（整目录静态托管即可）；
 * - 全程本地渲染，不请求外部服务（遵守 check:offline）；
 * - mermaid.render 是异步竞态源，调用方必须用版本号丢弃过期结果；
 * - 深浅两档配色（12 T3-01）：mermaid 只认字面色，**取值一律从 CSS token 读**
 *   （`--ld-diagram-*`，定义在 lark-doc.css / theme-dark.css），JS 里不写 hex ——
 *   预设档与宿主才能覆盖，也满足 token lint 的「组件禁写字面色」。
 */

import { readContentTheme } from './themeSignal'
import { loadFeature } from './features/registry'

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
 * 默认加载通道：特性注册表 + 动态 import() 懒 chunk。
 * 宿主加载 lark-doc/features/mermaid.js（或自带实现注册 'mermaid'）时优先用
 * 注册实例；否则走内置通道 —— vendored UMD 通过动态 import() 拆成懒 chunk，
 * 寻址由构建工具统一接管（'lark-doc/mermaid-vendor' 是构建期 alias 指定符，
 * 见 vue.config.js / build-features.js / build-lite.js），宿主从源码编译时由
 * 宿主输出 chunk（内网/外网零配置），直接消费预构建 dist 时按同目录 chunk
 * 加载（整目录静态托管即可）。页面已自行加载 mermaid 时直接复用全局实例，
 * 避免双份运行时。
 */
function loadMermaidModule() {
  if (typeof window !== 'undefined' && window.mermaid && typeof window.mermaid.initialize === 'function') {
    return Promise.resolve(window.mermaid)
  }
  return loadFeature('mermaid', () =>
    import(/* webpackChunkName: "mermaid" */ 'lark-doc/mermaid-vendor'),
  ).then((m) => {
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

/* ------------------------------------------------------------------
   深色档 themeVariables（11 §4 / 06 §6.5.2）
   键 = mermaid themeVariables 名，值 = 承载颜色的 token 名。同一个 token 会被
   多个键复用（mermaid 的键按图形类型分叉，语义上是同一个「节点底色」）。
   读不到 token（宿主没引主题 CSS）时该键直接不传，由 mermaid 内置深色兜底。
   ------------------------------------------------------------------ */
const DIAGRAM_DARK_VARIABLES = Object.freeze({
  background: '--ld-diagram-bg',
  primaryColor: '--ld-diagram-node',
  mainBkg: '--ld-diagram-node',
  primaryTextColor: '--ld-diagram-text',
  primaryBorderColor: '--ld-diagram-node-border',
  nodeBorder: '--ld-diagram-node-border',
  textColor: '--ld-diagram-text',
  titleColor: '--ld-diagram-text',
  lineColor: '--ld-diagram-line',
  edgeLabelBackground: '--ld-diagram-bg',
  secondaryColor: '--ld-diagram-node-soft',
  tertiaryColor: '--ld-diagram-cluster',
  clusterBkg: '--ld-diagram-cluster',
  clusterBorder: '--ld-diagram-node-border',
  // 时序图
  actorBkg: '--ld-diagram-node',
  actorBorder: '--ld-diagram-node-border',
  actorTextColor: '--ld-diagram-text',
  signalColor: '--ld-diagram-line',
  signalTextColor: '--ld-diagram-text',
  labelBoxBkgColor: '--ld-diagram-node',
  labelBoxBorderColor: '--ld-diagram-node-border',
  labelTextColor: '--ld-diagram-text',
  loopTextColor: '--ld-diagram-text',
  sectionBkgColor: '--ld-diagram-cluster',
  altSectionBkgColor: '--ld-diagram-bg',
  // 备注与状态图
  noteBkgColor: '--ld-diagram-note',
  noteTextColor: '--ld-diagram-text',
  noteBorderColor: '--ld-diagram-node-border',
})

/** 读一个 token 的已解析值；非浏览器环境或未定义时返回空串。 */
function readThemeVariable(name) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return ''
  const host = document.querySelector('.lark-doc') || document.documentElement
  if (!host || typeof window.getComputedStyle !== 'function') return ''
  const value = window.getComputedStyle(host).getPropertyValue(name)
  return value ? value.trim() : ''
}

/** 组装深色一组 themeVariables（只放进读得到的键）。 */
function readDarkThemeVariables() {
  const variables = {}
  Object.keys(DIAGRAM_DARK_VARIABLES).forEach((key) => {
    const value = readThemeVariable(DIAGRAM_DARK_VARIABLES[key])
    if (value) variables[key] = value
  })
  return variables
}

function buildConfig(theme) {
  const config = {
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
  }
  if (theme !== 'dark') {
    // 浅色保持 mermaid 内置 default：现状外观零变化。
    config.theme = 'default'
    return config
  }
  config.theme = 'dark'
  config.themeVariables = readDarkThemeVariables()
  return config
}

/**
 * 已应用的配置签名。mermaid.initialize 是全局单例配置，同一份配置不必重复下发；
 * 签名里带上 token 的**解析结果**，所以切换预设档（变量值变了但档位没变）也能生效。
 */
let appliedSignature = null

function applyConfig(mermaid, theme) {
  const config = buildConfig(theme)
  const signature = JSON.stringify(config)
  if (signature === appliedSignature) return
  mermaid.initialize(config)
  appliedSignature = signature
}

function loadRenderer(scriptUrl, theme) {
  if (!rendererPromise) {
    const loaded = scriptUrl ? loadMermaidScript(scriptUrl) : loadMermaidModule()
    rendererPromise = loaded.then((mermaid) => {
      applyConfig(mermaid, theme)
      return mermaid
    })
    // 加载失败**不进永久缓存**：早先的实现会把失败的 Promise 一直留在 rendererPromise 上，
    // 于是「预构建产物少一个 mermaid chunk（404）」这种一次性事故会变成「本页之后的每个
    // 图表都报渲染失败，只能刷新」—— 清掉缓存，下一次渲染重新尝试，chunk 补齐后即时恢复。
    rendererPromise.catch(() => { rendererPromise = null })
  }
  // 每次渲染前对齐主题：同档位是常数时间（只比字符串），换档时才真正 re-initialize。
  return rendererPromise.then((mermaid) => {
    applyConfig(mermaid, theme)
    return mermaid
  })
}

/**
 * 渲染图表源码，resolve 出 SVG 字符串；语法错误或渲染器不可用时 reject。
 * 每次调用生成独立 id，避免 mermaid 内部注册表冲突。
 *
 * @param {string} source 图表源码
 * @param {{ scriptUrl?: string, theme?: 'light'|'dark' }} options 自定义渲染器地址
 *   （宿主自托管时用）；theme 缺省时读当前正文轨主题。默认走动态 import() 懒
 *   chunk，由构建工具统一接管寻址，无需任何配置。
 */
export function renderDiagram(source, options = {}) {
  const id = 'lark-doc-diagram-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
  const theme = options.theme || readContentTheme()
  return loadRenderer(options.scriptUrl, theme)
    .then((mermaid) => mermaid.render(id, String(source || '')))
    .then((result) => {
      const svg = result && result.svg
      if (!svg) throw new Error('empty svg')
      return svg
    })
}
