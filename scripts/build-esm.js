'use strict'

/**
 * 构建 ES Module 产物（dist/lark-doc.esm.js + 若干逻辑区块）。
 *
 * 为什么单独一个构建：vue-cli 的 lib 模式只支持 commonjs / umd，而这两种格式里的
 * `import()` 会被编译成「运行时按 URL 注入 <script>」，宿主打包器无法接管 ——
 * 于是以前只能用 LimitChunkCountPlugin 把一切压成单文件（3.8 MB）。
 *
 * ESM 产物保留原生 `import()`：vite / webpack / rollup 会把它当成自己的动态导入，
 * 重新做一次代码分割，宿主按自己的 publicPath 输出 chunk。这就是 AiEditor 之类
 * 现代编辑器包「主文件小、功能按需加载」的做法。
 *
 * 运行：npm run build:esm；也可通过 `--entry` 与 `--name` 构建隔离入口。
 */

const args = process.argv.slice(2)
function option(name, fallback) {
  const index = args.indexOf(name)
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback
}
const entry = option('--entry', 'src/index.js')
const name = option('--name', 'lark-doc')
const chunkPrefix = name === 'lark-doc' ? '' : `${name}.`
process.env.LARK_DOC_CACHE_FLAVOR = name

process.env.LARK_DOC_TARGET = 'esm'
process.env.VUE_CLI_MODE = 'production'
process.env.NODE_ENV = 'production'

const path = require('path')
const webpack = require('webpack')
const Service = require('@vue/cli-service')

const root = path.resolve(__dirname, '..')
const dist = path.resolve(root, 'dist')
const service = new Service(root)
service.init('production')

// resolveWebpackConfig 会应用 vue.config.js（含 LARK_DOC_TARGET=esm 的拆包配置），
// 这里只覆盖「产物形态」相关的几项，编译规则全部复用 vue-cli。
const config = service.resolveWebpackConfig()
// 具名入口：产物主文件叫 lark-doc.esm.js，而不是默认的 main.esm.js。
config.entry = { [name]: path.resolve(root, entry) }
config.experiments = Object.assign({}, config.experiments, { outputModule: true })
config.output = Object.assign({}, config.output, {
  module: true,
  // vue-cli 按 browserslist 推导环境；库导出和原生异步 import 都显式使用 ESM。
  environment: Object.assign({}, config.output.environment, { module: true, dynamicImport: true }),
  path: dist,
  // 初始区块也走 filename，必须带 [name]：入口 → lark-doc.esm.js，
  // 默认逻辑区块 → tiptap.esm.js / vendor.esm.js；隔离入口的全部区块带自己的前缀。
  filename: (data) => data.chunk.name === name ? `${name}.esm.js` : `${chunkPrefix}[name].esm.js`,
  chunkFilename: `${chunkPrefix}[name].esm.js`,
  // './'：chunk 地址必须以 ./ 开头，才能被浏览器/Vite 当作相对 import()
  // 解析；空串会生成裸 specifier（例如 "mermaid.esm.js"），在浏览器中被当成
  // 包名解析并失败。webpack4 不支持 import.meta.url，因此仍不使用它。
  publicPath: './',
})
// library.type='module' 是「把入口的 export 变成产物 export」的开关。
// 少了它 webpack 只把入口当 app 来打包：产物里只有 chunk 加载运行时
// （`export { r as __webpack_require__ }`），`import { LarkDoc } from 'lark-doc'`
// 会得到 undefined —— 0.11.0 / 0.11.1 的 esm 产物就缺这一行。
config.output.library = { type: 'module' }
// 默认与 legacy ESM 都是 DOM-only，不内联或外置 Vue。
// app 模式自带的 html / preload / prefetch 对库产物没有意义，还会多生成 index.html。
config.plugins = (config.plugins || []).filter((plugin) => {
  const name = plugin && plugin.constructor && plugin.constructor.name
  return !/HtmlWebpack|PreloadPlugin|PrefetchPlugin/i.test(String(name))
})

const startedAt = Date.now()
webpack(config, (error, stats) => {
  if (error) {
    console.error(error.stack || error)
    process.exit(1)
  }
  const json = stats.toJson({ all: false, errors: true, warnings: true, assets: true, timings: true })
  if (stats.hasErrors()) {
    console.error(json.errors.slice(0, 5).join('\n\n'))
    process.exit(1)
  }
  if (stats.hasWarnings()) {
    console.error('[esm 构建] warnings：\n' + json.warnings.map((item) => item.message || String(item)).join('\n\n'))
    process.exit(1)
  }
  const kb = (v) => `${(v / 1024).toFixed(1)} KiB`
  console.log('\n[esm 产物]')
  for (const asset of (json.assets || []).filter((item) => item && item.name).sort((a, b) => (b.size || 0) - (a.size || 0))) {
    console.log(`  ${asset.name.padEnd(48)}${kb(asset.size || 0).padStart(12)}`)
  }
  console.log(`\n构建耗时 ${((Date.now() - startedAt) / 1000).toFixed(1)}s`)
})
