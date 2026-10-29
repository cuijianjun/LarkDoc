'use strict'

/**
 * 构建 lark-doc/plugin 的 ESM 与 CommonJS 产物。
 *
 * 插件只包含构建期资源处理逻辑，不把编辑器或业务入口打进产物。
 * 当前仓库没有 unplugin / Rollup / Rspack 依赖，因此用已锁定的 webpack
 * 生成双格式文件；src/plugin/index.js 自己提供各 bundler 的兼容适配器。
 */

const fs = require('fs')
const path = require('path')
const webpack = require('webpack')

const root = path.resolve(__dirname, '..')
const dist = path.join(root, 'dist')
const entry = path.join(root, 'src/plugin/index.js')

function config(filename, libraryType, libraryExport) {
  return {
    mode: 'production',
    context: root,
    entry,
    target: ['node14'],
    externalsPresets: { node: true },
    output: {
      path: dist,
      filename,
      library: { type: libraryType, export: libraryExport },
      clean: false,
      devtoolModuleFilenameTemplate: '[resource-path]',
    },
    optimization: {
      minimize: false,
    },
    devtool: false,
    performance: { hints: false },
  }
}

function runWebpack(configuration) {
  return new Promise((resolve, reject) => {
    webpack(configuration, (error, stats) => {
      if (error) return reject(error)
      if (stats.hasErrors()) {
        return reject(new Error(stats.toString({ all: false, errors: true, errorDetails: true })))
      }
      resolve(stats)
    })
  })
}

async function main() {
  fs.mkdirSync(dist, { recursive: true })
  await runWebpack(config('plugin.mjs', 'module', 'default'))
  await runWebpack(config('plugin.cjs', 'commonjs2', 'default'))
  for (const filename of ['plugin.mjs', 'plugin.cjs']) {
    const file = path.join(dist, filename)
    if (!fs.existsSync(file) || fs.statSync(file).size === 0) {
      throw new Error(`插件产物不存在或为空：${file}`)
    }
  }
  console.log('✓ plugin 产物已生成：dist/plugin.mjs、dist/plugin.cjs')
}

main().catch((error) => {
  console.error(error.stack || error)
  process.exitCode = 1
})
