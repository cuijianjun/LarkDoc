const { defineConfig } = require('@vue/cli-service')
const path = require('path')

/**
 * 四种构建目标（LARK_DOC_TARGET）：
 * - lib（默认，src/index.js）：CJS 产物（`main` 字段）。Node / SSR / webpack4 alias 这一条路
 *   吃它。动态 import 保留，按需区块（math / office / mermaid / highlight）落成
 *   `lark-doc.common.<name>.js` 兄弟文件，并用 `require()` 加载 —— Node 与打包器两种宿主
 *   都能拿到它们，不必担心「运行时按 URL 注入 script」在 Node 里不成立。
 *   样式抽成 dist/lark-doc.css，宿主显式 import。
 * - element（src/web-component/index.js）：自定义元素产物，Vue 内联 + CSS 由 JS 注入，
 *   publicPath:'auto' 能可靠推导出 chunk 地址 → 只拆按需区块。它同时兼职 CDN `<script>` 直挂
 *   （`unpkg` / `jsdelivr` 都指向它），所以**不再单独出 UMD 档**（阶段 3）。
 * - esm（scripts/build-esm.js）：ES Module 产物，`module` 字段指向它。宿主打包器会接管
 *   原生 import() 重新做代码分割 → 初始区块也能拆，是体积与首屏收益最大的产物。
 * - adapters（scripts/build-adapters.js）：跨框架薄壳，dist/lark-doc-{vue3,react}.mjs。
 *   两个入口必须**各自自包含**，所以这一档既不拆包也不抽 CSS。
 *
 * 拆包策略：首屏只需要「编辑器内核 + 工具栏」，所以按依赖性质分组——
 *   tiptap / vue / vendor 属于初始区块（并行下载、长期缓存，仅 esm 可拆）；
 *   math(katex) / office(docx+mammoth) / markdown(marked+turndown) / highlight 只在
 *   真正用到时才下载（按需区块），主包因此小一半。
 */
const target = process.env.LARK_DOC_TARGET || 'lib'
/** lib（CJS）/ element 两档降级到 ES2018，让 webpack 4 宿主能直接解析（见 babel.config.js）；
 *  esm 留给认 `exports` 的现代打包器，保留 ES2020+。 */
const isLegacy = process.env.LARK_DOC_LEGACY === '1'
const isElement = target === 'element'
const isEsm = target === 'esm'
/** 薄壳档：build-adapters.js 自己配 output / splitChunks，这里只需不套用统一的产出形态。 */
const isAdapters = target === 'adapters'
/**
 * V1 过渡态（阶段 3）：esm / cjs 两档把 Vue 打进产物，宿主不必再装 Vue 2.7，
 * `peerDependencies` 里也删掉 vue。真正的收尾（源码树摘 Vue）在阶段 5 + 7。
 * element 档本来就内联 Vue，所以走的是同一个开关。
 */
const inlineVue = process.env.LARK_DOC_INLINE_VUE === '1'
/** 薄壳关掉 polyfill 注入（见 babel.config.js），同样影响 babel 输出，缓存必须分流。 */
const noPolyfill = process.env.LARK_DOC_NO_POLYFILL === '1'
/** 同一 target 下的不同构建链（build-esm / build-lite）必须各占一份缓存，见 cache.name。 */
const cacheFlavor = process.env.LARK_DOC_CACHE_FLAVOR ? `-${process.env.LARK_DOC_CACHE_FLAVOR}` : ''
const isLib = !isElement && !isEsm && !isAdapters
// 只有 adapters 不拆（两个薄壳必须各自自包含）；lib / element / esm 都拆按需区块。
const split = !isAdapters
/** 只有 esm 能安全拆初始区块（它的 output.filename 带 [name]）。lib 拆初始区块会与
 *  vue-cli 的 `${entryName}.js` / `${entryName}.[name].js` 模板撞名（两个 chunk 落到
 *  同一文件名），且 Vue 内联主文件是 V1 既定契约（阶段 5/7 摘 Vue 后自然回落），不折腾。 */
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

    // 但「不进 babel」不等于「可以带着新语法出门」：vendored mermaid 是别人压好的
    // 产物，里面有 `??` / `?.`，webpack 4 的 acorn 一样读不了。于是单独挂一条
    // 只做语法降级的 loader —— 不带 preset、不带 targets、不带 core-js，
    // 因此不会注入 require()，不会破坏 UMD 形态。
    if (isLegacy) {
      config.module
        .rule('legacy-vendor-syntax')
        .enforce('pre')
        .test(/[\\/]src[\\/]assets[\\/]vendor[\\/].*\.js$/)
        .use('babel-loader')
        .loader(require.resolve('babel-loader'))
        .options({
          configFile: false,
          babelrc: false,
          sourceType: 'script',
          presets: [],
          plugins: require('./legacy-syntax'),
          // 源文件本来就是压缩过的，别让 generator 再排版一遍。
          compact: true,
          minified: true,
          comments: false,
        })
    }
  },
  css: {
    // element / esm 是「直挂即用」的产物：样式随 JS 注入 <style>，宿主不需要
    // 再引 CSS，按需区块（如 KaTeX 样式）也跟着自己的 chunk 走。
    // 只有 lib（CJS）抽成 dist/lark-doc.css —— 保持既有接入方式不变。
    extract: isLib,
  },
  chainWebpack: (config) => {
    if (!isLib) return
    // lib 档按需区块的 CSS（如 math 的 KaTeX 样式）默认落 dist/css/[name].css，
    // 而字体在 dist/fonts/ —— CSS 里的 `url(./fonts/…)` 会指向不存在的 dist/css/fonts/。
    // 把区块 CSS 提到 dist 根目录，`./fonts/…` 与主文件 lark-doc.css 一样命中 dist/fonts/，
    // 宿主（Node require / 打包器二次处理 css-loader）都能解析到。
    config.plugin('extract-css').tap((args) => {
      args[0].chunkFilename = '[name].[contenthash:8].css'
      return args
    })
  },
  // 默认 true（vue-cli 按 CPU 核数推导）：babel-loader 走 thread-loader 并行。
  // 多核机器上冷启动一批 worker 时偶发 `Broker request timed out`（本机实测 3 次里
  // 撞到 1 次，重跑才过），一次失败要白等 5 分钟重跑全量校验。
  // 串行构建的稳定性对这个仓库更值钱，所以提供开关：本机 / 高负载 CI 设
  // LARK_DOC_NO_PARALLEL=1 关掉 thread-loader，默认口径不变、CI 不受影响。
  parallel: process.env.LARK_DOC_NO_PARALLEL === '1' ? false : undefined,
  configureWebpack: {
    // 构建加速：跨进程复用编译缓存（babel / vue-loader 结果），二次构建提速明显。
    // 每个 target 独立 cache.name：三种产物的 output / externals 不同，
    // 共用一份缓存会让模块级别的结果串味（external vue 的 ESM/CJS 形态就是典型）。
    cache: {
      type: 'filesystem',
      // LARK_DOC_LEGACY 会改变 babel 输出（降语法），必须换一份缓存，否则同一个
      // target 在两种口径间来回构建会命中对方的 babel 结果。
      // LARK_DOC_CACHE_FLAVOR 是「同 target 不同构建链」的分流开关：build-esm.js
      // 与 build-lite.js 都是 target=esm，但 lite 多了一套把重依赖 alias 成 stub
      // 的 resolve 配置 —— 共用一份缓存会命中 esm 那条链的解析结果，stub 整套失效
      // （表现：dist/lite.math.esm.js 与 dist/math.esm.js 逐字节相同）。
      name: `lark-doc-${target}${isLegacy ? '-legacy' : ''}${noPolyfill ? '-nopolyfill' : ''}${cacheFlavor}`,
      buildDependencies: { config: [__filename, path.resolve(__dirname, 'babel.config.js')] },
    },
    // 包内 vendored mermaid（3 MB）必然超阈值，警告没有意义。
    performance: { hints: false },
    // 阶段 4 的构建期 alias 指定符：源码里 math / mermaid 的可选依赖用
    // 'lark-doc/katex.css' / 'lark-doc/mermaid-vendor' 这样的稳定指定符引用，
    // 三条构建链各自映射 —— 全量构建映射到 vendored 真文件（下面这两条），
    // lite 构建映射到 stub（build-lite.js），特性包构建同样映射真文件
    // （build-features.js）。这样 lite 不用动源码，改 alias 就能掐断依赖。
    resolve: {
      alias: {
        'lark-doc/katex.css$': path.resolve(__dirname, 'src/styles/vendor/katex.css'),
        'lark-doc/mermaid-vendor$': path.resolve(__dirname, 'src/assets/vendor/mermaid/mermaid.min.js'),
      },
    },
    // The library is consumed as an npm package.
    // V1（阶段 3）起 esm / cjs / element 三档都不再外部化 Vue —— 宿主不装 Vue 也能跑，
    // peerDependencies 因此不再声明 vue。真正的 V2/V3 是把 Vue 从源码树摘掉（阶段 5 + 7），
    // 到时候再回头把这里的 inlineVue 收掉。
    externals: isElement || isEsm || inlineVue ? {} : {
      vue: {
        commonjs: 'vue/dist/vue.runtime.common.js',
        commonjs2: 'vue/dist/vue.runtime.common.js',
        amd: 'vue',
        root: 'Vue',
      },
    },
    output: isLib
      ? {
        // CJS 档要把按需区块落成兄弟文件，并且**用 require() 去加载**：
        // 默认是 web 口径（JSONP 注入 <script>），Node 里 `document` 不存在会直接炸，
        // 而这条路的典型宿主恰恰是 Node / SSR。改成 commonjs + require 后，
        // Node 与 webpack 宿主两种环境都能拿到按需区块。
        chunkFormat: 'commonjs',
        chunkLoading: 'require',
      }
      : {},
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
    plugins: [...(process.env.LARK_DOC_ANALYZE ? [new BundleAnalyzePlugin()] : [])],
  },
})
