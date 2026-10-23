const { defineConfig } = require('@vue/cli-service')
const path = require('path')
const webpack = require('webpack')

/**
 * 四种构建目标（LARK_DOC_TARGET）：
 * - lib（默认，src/index.js）：**单文件** CJS 产物。宿主可能是任意打包器、任意版本，
 *   运行时按 URL 去加载 chunk 不可靠，所以动态 import 全部内联，保持「拿走就能用」；
 *   样式抽成 dist/lark-doc.css，宿主显式 import。
 * - umd（同入口）：CDN / <script> 直挂产物。只拆按需区块，首屏永远不依赖 chunk 加载；
 *   样式随 JS 注入，宿主不需要额外引 CSS。
 * - element（src/web-component/index.js）：自定义元素产物，Vue 内联 + CSS 由 JS 注入，
 *   publicPath:'auto' 能可靠推导出 chunk 地址 → 同上只拆按需区块。
 * - esm（scripts/build-esm.js）：ES Module 产物，`module` 字段指向它。宿主打包器会接管
 *   原生 import() 重新做代码分割 → 初始区块也能拆，是体积与首屏收益最大的产物。
 *
 * 拆包策略：首屏只需要「编辑器内核 + 工具栏」，所以按依赖性质分组——
 *   tiptap / vue / vendor 属于初始区块（并行下载、长期缓存，仅 esm 可拆）；
 *   math(katex) / office(docx+mammoth) / markdown(marked+turndown) / highlight 只在
 *   真正用到时才下载（按需区块），主包因此小一半。
 */
const target = process.env.LARK_DOC_TARGET || 'lib'
const isElement = target === 'element'
const isUmd = target === 'umd'
const isEsm = target === 'esm'
const isLib = !isElement && !isUmd && !isEsm
const split = !isLib
/** 只有 esm 能安全拆初始区块（它的 output.filename 带 [name]）。 */
const initialChunks = isEsm ? 'all' : 'async'

/**
 * 体积诊断插件（LARK_DOC_ANALYZE=1 时启用）：按 npm 包聚合模块体积 + 列出产物清单。
 * 用来判断「该把谁拆出去 / 该把谁懒加载」，不进产物，只在构建结束时打印。
 */
class BundleAnalyzePlugin {
  apply(compiler) {
    compiler.hooks.done.tap('lark-doc-bundle-analyze', (stats) => {
      const json = stats.toJson({ modules: true, assets: true, chunks: true, reasons: false, source: false })
      const groups = new Map()
      for (const mod of json.modules || []) {
        const name = mod.nameForCondition || mod.name || mod.identifier || ''
        let key = '(包内源码)'
        const idx = name.lastIndexOf('node_modules/')
        if (idx >= 0) {
          const rest = name.slice(idx + 13)
          const parts = rest.split('/')
          key = rest.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
        } else if (name.includes('src/assets')) {
          key = '(静态资源)'
        }
        groups.set(key, (groups.get(key) || 0) + (mod.size || 0))
      }
      const rows = [...groups.entries()].sort((a, b) => b[1] - a[1])
      const total = rows.reduce((sum, row) => sum + row[1], 0)
      const kb = (v) => `${(v / 1024).toFixed(1)} KiB`
      console.log('\n[体积诊断] 按依赖聚合（模块源码大小，非 gzip）')
      for (const [key, size] of rows.slice(0, 20)) {
        console.log(`  ${key.padEnd(38)}${kb(size).padStart(12)}  ${((size / total) * 100).toFixed(1)}%`)
      }
      console.log(`  ${'合计'.padEnd(38)}${kb(total).padStart(12)}`)
      if (process.env.LARK_DOC_ANALYZE_MODULES) {
        console.log('[体积诊断] 单模块 Top 20')
        const mods = (json.modules || []).slice().sort((a, b) => (b.size || 0) - (a.size || 0)).slice(0, 20)
        for (const mod of mods) {
          console.log(`  ${kb(mod.size || 0).padStart(12)}  ${mod.nameForCondition || mod.name || mod.identifier || ''}`)
        }
      }
      console.log('[体积诊断] JS 产物清单')
      for (const asset of (json.assets || []).filter((a) => /\.js$/.test(a.name)).sort((a, b) => b.size - a.size)) {
        console.log(`  ${asset.name.padEnd(48)}${kb(asset.size).padStart(12)}`)
      }
    })
  }
}

/** node_modules 路径匹配（Windows 反斜杠兼容）。 */
const nodeModule = (names) => new RegExp(`[\\\\/]node_modules[\\\\/](?:${names})[\\\\/]`)
/**
 * 按需依赖：katex / docx / mammoth / marked / turndown / highlight.js。
 * vendor 组用负向前瞻把它们排除掉，避免「拆分优先级」这类隐式行为让重依赖回流首屏。
 */
const ON_DEMAND = 'katex|docx|mammoth|marked|turndown|highlight\\.js'
const vendorModule = new RegExp(`[\\\\/]node_modules[\\\\/](?!${ON_DEMAND}[\\\\/])`)

module.exports = defineConfig({
  transpileDependencies: true,
  productionSourceMap: false,
  // lib：相对路径，保证产物 CSS 里的 KaTeX 字体能从包自身 dist/fonts 解析。
  // element / esm：委托 webpack 运行时按脚本 URL（'auto'）推导，产物被托管到任意子目录
  // 都不会把 chunk / mermaid vendor / 字体解析到错误位置。
  publicPath: isLib ? './' : 'auto',
  chainWebpack(config) {
    // vendored 第三方 UMD（mermaid）绝不能进 babel：transpileDependencies 的
    // core-js 注入会往文件头加 require()，file-loader 落盘后在浏览器里
    // 直接 ReferenceError: require is not defined。源码资产按原样落盘。
    config.module.rule('js').exclude.add(path.resolve(__dirname, 'src/assets'))
  },
  css: {
    // element / umd / esm 都是「直挂即用」的产物：样式随 JS 注入 <style>，宿主不需要
    // 再引 CSS，按需区块（如 KaTeX 样式）也跟着自己的 chunk 走。
    // 只有 lib（CJS）抽成 dist/lark-doc.css —— 保持既有接入方式不变。
    extract: isLib,
  },
  configureWebpack: {
    // 构建加速：跨进程复用编译缓存（babel / vue-loader 结果），二次构建提速明显。
    // 每个 target 独立 cache.name：三种产物的 output / externals 不同，
    // 共用一份缓存会让模块级别的结果串味（external vue 的 ESM/CJS 形态就是典型）。
    cache: {
      type: 'filesystem',
      name: `lark-doc-${target}`,
      buildDependencies: { config: [__filename] },
    },
    // 包内 vendored mermaid（3 MB）必然超阈值，警告没有意义。
    performance: { hints: false },
    // The library is consumed as an npm package. In lib mode Vue must resolve to the
    // CommonJS constructor so Tiptap's Vue 2 node-view runtime receives the
    // same constructor shape as a normal Vue 2 application.
    // In element mode Vue is bundled instead: the custom element must work in
    // hosts that are not Vue at all.
    // element 必须内联 Vue（宿主可能不是 Vue 应用），esm 由 scripts/build-esm.js 自己配
    // externals（externalsType: 'module'）；只有 lib / umd 把 Vue 留给宿主。
    externals: isElement || isEsm ? {} : {
      vue: {
        commonjs: 'vue/dist/vue.runtime.common.js',
        commonjs2: 'vue/dist/vue.runtime.common.js',
        amd: 'vue',
        root: 'Vue',
      },
    },
    optimization: split
      ? {
        // 按逻辑拆分：初始区块（首屏并行下载）+ 按需区块（用到才下载）。
        // element 产物的 output.filename 由 vue-cli 固定成不带 [name] 的单文件名，
        // 初始区块一旦拆开就会互相覆盖 → element 只拆 async；esm 由 scripts/build-esm.js
        // 自己控制文件名，可以完整拆初始区块。
        splitChunks: {
          chunks: 'all',
          maxInitialRequests: 12,
          cacheGroups: {
            defaultVendors: false,
            default: false,
            vue: { test: nodeModule('vue'), name: 'vue', chunks: initialChunks, priority: 50, reuseExistingChunk: true },
            tiptap: { test: nodeModule('@tiptap|prosemirror-[^/\\\\]+'), name: 'tiptap', chunks: initialChunks, priority: 40, reuseExistingChunk: true },
            vendor: { test: vendorModule, name: 'vendor', chunks: initialChunks, priority: 10, reuseExistingChunk: true },
            // 以下四组永远只服务按需区块：绝不能因为被 vendor 兜住而回到首屏。
            math: { test: nodeModule('katex'), name: 'math', chunks: 'async', priority: 35, reuseExistingChunk: true },
            office: { test: nodeModule('docx|mammoth'), name: 'office', chunks: 'async', priority: 35, reuseExistingChunk: true },
            markdown: { test: nodeModule('marked|turndown'), name: 'markdown', chunks: 'async', priority: 35, reuseExistingChunk: true },
            highlight: { test: nodeModule('highlight\\.js'), name: 'highlight', chunks: 'async', priority: 35, reuseExistingChunk: true },
          },
        },
      }
      : {},
    plugins: [
      // lib 产物保持单文件：动态 import 全部内联，宿主不需要复制/解析任何 chunk。
      ...(isLib ? [new webpack.optimize.LimitChunkCountPlugin({ maxChunks: 1 })] : []),
      ...(process.env.LARK_DOC_ANALYZE ? [new BundleAnalyzePlugin()] : []),
    ],
  },
})
