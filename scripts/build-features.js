'use strict'

/**
 * 构建可选特性包（阶段 4 · MASTER_PLAN §4）。
 *
 * 产物：dist/features/{math,mermaid,highlight,markdown,office}.js，
 * 对应 package.json exports 的 `./features/*`。每个文件自包含（依赖全部
 * 打进去、无共享 chunk），宿主 `<script>`（或 import）加载即完成对应
 * registerFeature 注册 —— 配合 dist/lark-doc-lite.esm.js 使用：lite 主产物
 * 的重依赖被 stub 掐断，加载特性包后按注册通道恢复，主产物不用换。
 *
 * 为什么不用 vue-cli Service：特性包只有 JS + CSS 两种输入、不碰 Vue，
 * 独立 webpack 配置反而简单可控。要点三条：
 *   1. CSS 走 vue-style-loader 运行时注入 —— 特性包单文件自包含，宿主不用
 *      再找同目录 .css（katex 字体由 css-loader 落成 dist/features/ 下相对
 *      路径引用，样式注入后按页面 URL 解析，所以字体必须与 math.css 同目录
 *      —— 见 output.assetModuleFilename）；
 *   2. 'lark-doc/katex.css' / 'lark-doc/mermaid-vendor' 与全量构建映射同一批
 *      vendored 真文件（vue.config.js 的 alias 口径一致）；
 *   3. 不做代码分割：特性包入口全是静态 import，每包天然单 chunk。
 *
 * 运行：npm run build:features（Node14 兼容：无语法糖，与 build-esm.js 同口径）
 */

process.env.NODE_ENV = 'production'

const path = require('path')
const webpack = require('webpack')

const root = path.resolve(__dirname, '..')
const dist = path.resolve(root, 'dist', 'features')

const config = {
  mode: 'production',
  devtool: false,
  target: ['web', 'es2018'],
  entry: {
    math: path.resolve(root, 'src/features/math.js'),
    mermaid: path.resolve(root, 'src/features/mermaid.js'),
    highlight: path.resolve(root, 'src/features/highlight.js'),
    markdown: path.resolve(root, 'src/features/markdown.js'),
    office: path.resolve(root, 'src/features/office.js'),
  },
  output: {
    path: dist,
    filename: '[name].js',
    // katex 字体等静态资源落在 dist/features/ 平铺目录，css 里的 url()
    // 是与 math.css 同目录的相对路径 —— 整目录托管即离线可用。
    assetModuleFilename: '[name][ext]',
  },
  resolve: {
    extensions: ['.js', '.json'],
    alias: {
      'lark-doc/katex.css$': path.resolve(root, 'src/styles/vendor/katex.css'),
      'lark-doc/mermaid-vendor$': path.resolve(root, 'src/assets/vendor/mermaid/mermaid.min.js'),
    },
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        include: [path.resolve(root, 'src')],
        use: { loader: 'babel-loader', options: { cacheDirectory: false } },
      },
      {
        test: /\.css$/,
        use: [{ loader: 'vue-style-loader' }, { loader: 'css-loader' }],
      },
    ],
  },
  performance: { hints: false },
  optimization: {
    // webpack5 默认 production 即压缩（内置 terser-webpack-plugin），无需配置。
    splitChunks: false,
    runtimeChunk: false,
  },
  stats: 'errors-warnings',
}

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
    console.error('[features 构建] warnings：\n' + json.warnings.slice(0, 5).join('\n\n'))
    process.exit(1)
  }
  const kb = (v) => `${(v / 1024).toFixed(1)} KiB`
  console.log('\n[features 产物]')
  for (const asset of (json.assets || []).filter((item) => item && item.name).sort((a, b) => (b.size || 0) - (a.size || 0))) {
    console.log(`  ${asset.name.padEnd(48)}${kb(asset.size || 0).padStart(12)}`)
  }
  console.log(`\n构建耗时 ${((Date.now() - startedAt) / 1000).toFixed(1)}s`)
})
