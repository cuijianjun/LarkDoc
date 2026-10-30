'use strict'

/**
 * 构建 lite 产物（dist/lark-doc-lite.esm.js，阶段 4 · MASTER_PLAN §4）。
 *
 * 与 build-esm.js 唯一的区别：重依赖被 alias 成「求值即抛错」的 stub
 * （src/core/features/stub.js），katex 样式 alias 成空 CSS。主产物因此
 * 不含 katex / docx / marked / turndown / highlight.js / mammoth —— 这些
 * 能力全部改走特性注册表：宿主按需加载 lark-doc/features/*（scripts/
 * build-features.js 的产物）后恢复，或沿调用方既有 catch 降级。
 *
 * chunk 命名空间：async 区块一律带 `lite.` 前缀（lite.math.esm.js…）。
 * 不加前缀 lite 构建会覆盖全量 esm 的同名 chunk —— 两份产物共存于同一
 * dist 目录（exports 契约 ./lite 与 . 各指一路），互不能踩。
 * 初始区块（vue / tiptap / vendor）与全量 esm 同名：三者内容与全量构建
 * 逐字节一致（stub 只影响 async 路径），覆盖无副作用。
 * 区块集合不是固定的：重依赖全部塌成同一个 stub 后，某些区块会被别的区块吸收
 * （实测 markdown / highlight 就是这样消失的），构建收尾会清掉上一版同名的残留文件。
 *
 * 运行：npm run build:lite（Node14 兼容：与 build-esm.js 同口径）
 */

process.env.LARK_DOC_TARGET = 'esm'
// 与 build-esm.js 同为 target=esm，但本文件的 resolve.alias 把重依赖掐成 stub：
// 两条链必须各占一份 webpack filesystem cache，否则会命中 esm 那条链的解析结果，
// stub 整套失效（产物与全量 chunk 逐字节相同，lite 契约等于没兑现）。
process.env.LARK_DOC_CACHE_FLAVOR = 'lite'
process.env.VUE_CLI_MODE = 'production'
process.env.NODE_ENV = 'production'

const fs = require('fs')
const path = require('path')
const webpack = require('webpack')
const Service = require('@vue/cli-service')

const root = path.resolve(__dirname, '..')
const dist = path.resolve(root, 'dist')
const service = new Service(root)
service.init('production')

const LITE_STUB = path.resolve(root, 'src/core/features/stub.js')
const EMPTY_CSS = path.resolve(root, 'src/core/features/empty.css')

// resolveWebpackConfig 会应用 vue.config.js（含 LARK_DOC_TARGET=esm 的拆包配置），
// 这里覆盖「产物形态」与「lite 掐断重依赖」两类，编译规则全部复用 vue-cli。
const config = service.resolveWebpackConfig()
config.entry = { 'lark-doc-lite': path.resolve(root, 'src/index.js') }
config.experiments = Object.assign({}, config.experiments, { outputModule: true })
config.output = Object.assign({}, config.output, {
  module: true,
  environment: Object.assign({}, config.output.environment, { module: true, dynamicImport: true }),
  path: dist,
  // 入口主文件 + 初始区块走 filename；async 区块走 chunkFilename（带 lite. 前缀）。
  filename: '[name].esm.js',
  chunkFilename: 'lite.[name].esm.js',
  publicPath: '',
})
config.output.library = { type: 'module' }
config.plugins = (config.plugins || []).filter((plugin) => {
  const name = plugin && plugin.constructor && plugin.constructor.name
  return !/HtmlWebpack|PreloadPlugin|PrefetchPlugin/i.test(String(name))
})
// Mermaid 是离线 vendored UMD；其压缩代码包含 arguments.callee，webpack
// 在 ESM 严格模式下会报告已知 warning。这里仅忽略该精确的第三方 warning，
// 不放宽其他依赖、语法或产物错误门禁。
config.ignoreWarnings = [
  {
    module: /src[\\/]assets[\\/]vendor[\\/]mermaid[\\/]mermaid\\.min\\.js/,
    message: /Accessing ["']arguments\.callee["'] is not allowed/,
  },
]

/* ---- lite 掐断重依赖：全部是动态 import 的落点，静态路径零涉及 ---- */
// highlight.js 逐子路径精确 alias：非精确 alias 是前缀替换（value + 余段），
// 会拼出不存在的路径，反而让构建期 Module not found。
config.resolve.alias = Object.assign({}, config.resolve.alias, {
  'katex$': LITE_STUB,
  'docx$': LITE_STUB,
  'marked$': LITE_STUB,
  'turndown$': LITE_STUB,
  'mammoth/mammoth.browser$': LITE_STUB,
  'highlight.js/lib/core.js$': LITE_STUB,
  'highlight.js/lib/languages/javascript.js$': LITE_STUB,
  'highlight.js/lib/languages/typescript.js$': LITE_STUB,
  'highlight.js/lib/languages/json.js$': LITE_STUB,
  'highlight.js/lib/languages/css.js$': LITE_STUB,
  'highlight.js/lib/languages/xml.js$': LITE_STUB,
  'highlight.js/lib/languages/python.js$': LITE_STUB,
  'highlight.js/lib/languages/bash.js$': LITE_STUB,
  'highlight.js/lib/languages/sql.js$': LITE_STUB,
  'lark-doc/mermaid-vendor$': LITE_STUB,
  'lark-doc/katex.css$': EMPTY_CSS,
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
  const warnings = (json.warnings || []).filter((warning) => {
    const moduleIdentifier = String(warning && warning.moduleIdentifier || '')
    const message = String(warning && warning.message || '')
    return !(moduleIdentifier.includes('/src/assets/vendor/mermaid/mermaid.min.js')
      && message.includes('Accessing "arguments.callee" is not allowed'))
  })
  if (warnings.length) {
    console.error('[lite 构建] warnings：\n' + warnings.slice(0, 5).map((warning) => JSON.stringify(warning)).join('\n\n'))
    process.exit(1)
  }
  // 自清残留：dist 按全仓约定不清理（--no-clean），而 lite 的区块集合会随 stub 化变化
  // —— 某些区块整块塌成同一个 stub 后被别的区块吸收，本轮就不再落文件了。上一版的同名
  // 文件会带着真依赖继续躺在 dist 里，scripts/check-lite-artifacts.js 读到的就是旧内容
  // （2026-10-30 实测：lite.markdown / lite.highlight 就是这么假失败的）。
  // 所以收尾时把「本轮没产出的 lite.* 区块」删掉，dist 里只留本轮真的产出的。
  const emitted = new Set((json.assets || []).map((asset) => asset.name))
  for (const file of fs.readdirSync(dist)) {
    if (!/^lite\..+\.esm\.js$/.test(file) || emitted.has(file)) continue
    fs.unlinkSync(path.resolve(dist, file))
    console.log(`[lite 构建] 清理上一版残留区块 ${file}（本轮不再产出）`)
  }

  const kb = (v) => `${(v / 1024).toFixed(1)} KiB`
  console.log('\n[lite 产物]')
  for (const asset of (json.assets || [])
    .filter((item) => item && item.name && (item.name.startsWith('lite.') || item.name === 'lark-doc-lite.esm.js'))
    .sort((a, b) => (b.size || 0) - (a.size || 0))) {
    console.log(`  ${asset.name.padEnd(48)}${kb(asset.size || 0).padStart(12)}`)
  }
  console.log(`\n构建耗时 ${((Date.now() - startedAt) / 1000).toFixed(1)}s`)
})
