'use strict'

import { execFileSync } from 'child_process'

/**
 * 依赖闭包探测（供 core 守卫类单测共用）。
 *
 * vitest 走的是 ESM runner，被 import 的模块不会进 require.cache，所以这里
 * 在子进程里用与 scripts/check-architecture.js 相同的 babel loader 装载源码，
 * 再把 require.cache 掏出来返回给调用方。
 *
 * 入参通过子进程 argv 传递（-e 模式下 process.argv[1] 起为自定义参数）。
 */
const HARNESS = `
const fs = require('fs')
const path = require('path')
const sourceRoot = process.argv[1]
const { transformSync } = require(process.argv[2])
const originalLoader = require.extensions['.js']
require.extensions['.js'] = (module, filename) => {
  if (!filename.startsWith(sourceRoot + path.sep)) return originalLoader(module, filename)
  const { code } = transformSync(fs.readFileSync(filename, 'utf8'), {
    babelrc: false, configFile: false, plugins: ['@babel/plugin-transform-modules-commonjs'],
  })
  module._compile(code, filename)
}
require(process.argv[3])
console.log(Object.keys(require.cache).join('\\n'))
`

const cache = new Map()

/**
 * 计算一个入口模块的 CJS require 依赖闭包（文件路径数组）。
 * 同一 entry 在同一 worker 内只算一次（子进程装载全量 tiptap 树并不便宜）。
 */
export function dependencyClosure({ root, sourceRoot, babelCore, entry }) {
  const cached = cache.get(entry)
  if (cached) return cached
  const stdout = execFileSync(process.execPath, ['-e', HARNESS, sourceRoot, babelCore, entry], {
    cwd: root,
    encoding: 'utf8',
    timeout: 60000,
  })
  const files = stdout.split('\n').filter(Boolean)
  cache.set(entry, files)
  return files
}
