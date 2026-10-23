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
 * 运行：npm run build:esm（LARK_DOC_TARGET=esm 会让 vue.config.js 走拆包分支）
 */

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
config.entry = { 'lark-doc': path.resolve(root, 'src/index.js') }
config.experiments = Object.assign({}, config.experiments, { outputModule: true })
config.output = Object.assign({}, config.output, {
  module: true,
  // vue-cli 会按 browserslist 推导 output.environment；external vue 的 ESM 形态只看
  // environment.module（而不是 output.module），所以这里必须显式打开，否则报
  // "The target environment doesn't support EcmaScriptModule syntax"。
  environment: Object.assign({}, config.output.environment, { module: true, dynamicImport: true }),
  path: dist,
  // 初始区块也走 filename，必须带 [name]：入口 → lark-doc.esm.js，
  // 逻辑区块 → vue.esm.js / tiptap.esm.js / vendor.esm.js，按需区块 → math.esm.js 等。
  filename: '[name].esm.js',
  chunkFilename: '[name].esm.js',
  // 'auto'：chunk 地址按 import.meta.url 推导，产物放到任意目录都不会 404。
  publicPath: 'auto',
})
// Vue 仍是 peer 依赖：产物里保留 `import ... from 'vue'`，交给宿主去重。
config.externalsType = 'module'
config.externals = { vue: 'vue' }
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
  const kb = (v) => `${(v / 1024).toFixed(1)} KiB`
  console.log('\n[esm 产物]')
  for (const asset of (json.assets || []).filter((item) => item && item.name).sort((a, b) => (b.size || 0) - (a.size || 0))) {
    console.log(`  ${asset.name.padEnd(48)}${kb(asset.size || 0).padStart(12)}`)
  }
  console.log(`\n构建耗时 ${((Date.now() - startedAt) / 1000).toFixed(1)}s`)
})
