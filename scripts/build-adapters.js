'use strict'

/**
 * 构建跨框架薄壳产物（dist/lark-doc-vue3.mjs、dist/lark-doc-react.mjs）。
 *
 * 为什么单独一个构建：
 * src/adapters/{vue3,react} 是**桥接层**，不碰渲染，只做三件事——props→attributes、
 * 事件转发、方法代理。它们依赖 allowlist（web-component/attributes）与事件名单
 * （web-component/events），这两个文件零依赖、零副作用；薄壳整体只有几 KB。
 *
 * 但它们的**源码形态是 ESM**，而 webpack4 宿主（内网大量存在）不认 `.mjs` 之外的
 * 现代语法，也不该让宿主去编译 node_modules 里的源码 —— 所以这里预编译成两个
 * 自包含的 ES Module 文件：
 *
 *   import { createReactLarkDoc } from 'lark-doc/react'
 *
 * 两个关键约束（改这个脚本前必须知道）：
 *
 * 1. **必须自包含**：关掉 splitChunks / runtimeChunk。默认配置下 webpack 会把两个
 *    入口共用的 attributes.js 抽成共享 chunk，产物之间互相 import —— 单独拷一个
 *    `lark-doc-vue3.mjs` 就会缺依赖。几 KB 的重复换「一个文件拿走就能用」，值。
 * 2. **语法地板与其它产物一致**：LARK_DOC_LEGACY=1 → ES2018。薄壳虽由现代宿主消费，
 *    但统一地板后，`lark-doc/*` 任何子入口都不会因为宿主的 acorn 版本踩坑。
 *
 * 运行：npm run build:adapters
 */

process.env.LARK_DOC_TARGET = 'adapters'
process.env.LARK_DOC_LEGACY = '1'
// 关掉 preset 的 polyfill 注入：薄壳零第三方依赖，那 4 个「默认可依赖」polyfill
// 会把产物从 ~5 KiB 撑到 34 KiB（见 babel.config.js 第三段说明）。
process.env.LARK_DOC_NO_POLYFILL = '1'
process.env.VUE_CLI_MODE = 'production'
process.env.NODE_ENV = 'production'

const path = require('path')
const webpack = require('webpack')
const Service = require('@vue/cli-service')

const root = path.resolve(__dirname, '..')
const dist = path.resolve(root, 'dist')
const service = new Service(root)
service.init('production')

const config = service.resolveWebpackConfig()

// 具名双入口：产物文件名直接对应 package.json 的 exports 条目。
config.entry = {
  'lark-doc-vue3': path.resolve(root, 'src/adapters/vue3/index.js'),
  'lark-doc-react': path.resolve(root, 'src/adapters/react/index.js'),
}

config.experiments = Object.assign({}, config.experiments, { outputModule: true })
config.output = Object.assign({}, config.output, {
  module: true,
  // external 的 ESM 形态只看 environment.module；薄壳目前没有 external（React 由宿主
  // 显式传入），但保持与 build-esm.js 同口径，将来加 external 不必再想一遍。
  environment: Object.assign({}, config.output.environment, { module: true, dynamicImport: true }),
  path: dist,
  filename: '[name].mjs',
  chunkFilename: '[name].mjs',
  // 无 chunk（下面关掉了拆分），给空串表示「按本文件 URL 相对寻址」。
  publicPath: '',
  library: { type: 'module' },
})

// 自包含：两个入口共用的 attributes/events 各自内联，不产出共享 chunk。
config.optimization = Object.assign({}, config.optimization, {
  splitChunks: false,
  runtimeChunk: false,
})

// 薄壳不引 vue / react / tiptap：React 实例由宿主传入，Vue 3 只写标签。
config.externals = {}
delete config.externalsType

config.devtool = false
// app 模式自带的 html / preload / prefetch / copy 对库产物没意义，还会往 dist 里
// 塞 index.html 与 public/ 的副本（dist 是 --no-clean 累积目录，混进去很难清理）。
config.plugins = (config.plugins || []).filter((plugin) => {
  const name = plugin && plugin.constructor && plugin.constructor.name
  return !/HtmlWebpack|PreloadPlugin|PrefetchPlugin|CopyPlugin/i.test(String(name))
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
  console.log('\n[adapters 产物]')
  for (const asset of (json.assets || [])
    .filter((item) => item && item.name)
    .sort((a, b) => (b.size || 0) - (a.size || 0))) {
    console.log(`  ${asset.name.padEnd(48)}${kb(asset.size || 0).padStart(12)}`)
  }
  console.log(`\n构建耗时 ${((Date.now() - startedAt) / 1000).toFixed(1)}s`)
})
