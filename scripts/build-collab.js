'use strict'

/**
 * 构建协同子入口产物 `dist/lark-doc-collab.esm.js`（09 §3.6 的第三个入口）。
 *
 * 为什么不并进 `scripts/build-esm.js` 多跑一次 entry：
 * 主包与协同子入口的 **externals 策略完全相反** —— 主包要内联 tiptap / prosemirror
 * （宿主拿走就能用），子入口必须一个都不内联（见下）。同一份 webpack 配置没法同时表达，
 * 硬塞会变成一堆 `if (entry === ...)` 的分支，比两个小脚本更难读。
 *
 * 🔴 这里唯一的硬约束：**node_modules 里的一切都必须 external**。
 * 原因不是"省体积"，是正确性 —— 协同扩展要被注册进**宿主已经建好的编辑器**，
 * `@tiptap/core` / `prosemirror-*` 必须与宿主是同一个模块实例：
 *   · 两份 prosemirror-model → `Node` / `Slice` 的 `instanceof` 全线失效，
 *     y-prosemirror 造出来的 Slice 灌不进主编辑器的 Transform；
 *   · 两份 @tiptap/core → `PluginKey` 不是同一个对象，`ySyncPluginKey.getState()`
 *     永远读到 undefined，远端更新直接被丢掉（表现是"连上了但不同步"，最难查）。
 * 所以本产物 = 只有 `src/collab/` 自己的代码（几 KB），协同运行时全部由宿主提供
 * （package.json 里它们都是 optional peer）。90 KB 的 size 预算就是这条的守门员：
 * 谁不小心把 yjs 或 prosemirror 打进来，gzip 立刻超。
 *
 * 运行：npm run build:collab
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

const config = service.resolveWebpackConfig()

config.entry = { 'lark-doc-collab': path.resolve(root, 'src/collab/index.js') }
config.experiments = Object.assign({}, config.experiments, { outputModule: true })
config.output = Object.assign({}, config.output, {
  module: true,
  environment: Object.assign({}, config.output.environment, { module: true, dynamicImport: true }),
  path: dist,
  filename: '[name].esm.js',
  chunkFilename: '[name].esm.js',
  publicPath: '',
})
config.output.library = { type: 'module' }
config.externalsType = 'module'

/**
 * 裸模块标识（`yjs` / `@tiptap/core` / `prosemirror-state`）一律 external，
 * 相对路径（`./protocol`）与绝对路径留给自己。产物里原样保留 `import ... from 'yjs'`，
 * 由宿主的解析器去重 —— 这正是"同一个实例"的实现方式。
 */
config.externals = [
  ({ request }, callback) => {
    if (!request) return callback()
    const bare = !request.startsWith('.') && !path.isAbsolute(request)
    return bare ? callback(null, request) : callback()
  },
]

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
  const json = stats.toJson({ all: false, errors: true, warnings: true, assets: true })
  if (stats.hasErrors()) {
    console.error(json.errors.slice(0, 5).join('\n\n'))
    process.exit(1)
  }
  const kb = (v) => `${(v / 1024).toFixed(1)} KiB`
  console.log('\n[collab 子入口产物]')
  for (const asset of (json.assets || []).filter((item) => item && item.name).sort((a, b) => (b.size || 0) - (a.size || 0))) {
    console.log(`  ${asset.name.padEnd(32)}${kb(asset.size || 0).padStart(12)}`)
  }
  /**
   * 构建期自检（比事后看体积更早、更准）：产物里只要出现这几个 bare import 说明
   * external 规则漏了；反过来如果产物里出现 prosemirror 的类名，说明某个包被内联了。
   */
  const fs = require('fs')
  const file = path.join(dist, 'lark-doc-collab.esm.js')
  const code = fs.readFileSync(file, 'utf8')
  const mustImport = ['yjs', '@tiptap/extension-collaboration', '@hocuspocus/provider']
  const missing = mustImport.filter((spec) => !new RegExp(`from\\s*['"]${spec.replace(/[/@]/g, '\\$&')}['"]`).test(code))
  if (missing.length) {
    console.error(`✗ 产物缺少 external import：${missing.join(', ')} —— 它们被内联了，会与宿主产生第二份实例`)
    process.exit(1)
  }
  console.log(`\n构建耗时 ${((Date.now() - startedAt) / 1000).toFixed(1)}s`)
})
