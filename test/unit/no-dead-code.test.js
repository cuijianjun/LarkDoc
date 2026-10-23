/**
 * P0-01 删死代码。
 *
 * 目标形态：image / codeBlock 的 NodeView 不再写死在 extensions 里，改由
 * `src/registry/nodeviews.js` 查表得到；查不到就用 Tiptap 默认渲染。
 * 因此这里守两条：
 *  1. extensions.js 的依赖闭包里不再出现 ImageNode / CodeNode 这两个 Vue 组件；
 *  2. src/ 下彻底搜不到这两个名字（连歇脚的文件也不留）。
 */

import { execFileSync } from 'child_process'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path from 'path'
import { describe, expect, it } from 'vitest'

const requireHere = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/**
 * vitest 走的是 ESM runner，被 import 的模块不会进 require.cache，
 * 所以在子进程里用与 scripts/check-architecture.js 相同的 babel loader 装载源码，
 * 再把 require.cache 掏出来看闭包。
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

function dependencyClosure() {
  const stdout = execFileSync(process.execPath, ['-e', HARNESS,
    path.join(root, 'src'),
    requireHere.resolve('@babel/core'),
    path.join(root, 'src/components/lark-doc/extensions.js'),
  ], { cwd: root, encoding: 'utf8' })
  return stdout.split('\n').filter(Boolean)
}

describe('P0-01 删死代码', () => {
  it('extensions.js 的依赖闭包内不含 ImageNode / CodeNode', () => {
    const leaks = dependencyClosure().filter((file) => /ImageNode|CodeNode/.test(file))
    expect(leaks).toEqual([])
  })

  it('core 目录（components/lark-doc）里搜不到 ImageNode / CodeNode', () => {
    // 这两个 NodeView 是 Vue 2 专属实现，P0-01 把它们搬到了 src/adapters/vue2/。
    // 搜索范围因此限定在 core 所在的 components/lark-doc/：要守的是"它们不再是 core 的
    // 一部分"，而不是"这两个名字在 src 下消失"（后者会误伤合法的适配层位置）。
    // 「core 依赖闭包里不能有它们」这件事，由上面那条闭包断言守。
    let status = 0
    try {
      execFileSync('git', ['grep', '-n', '-e', 'ImageNode', '-e', 'CodeNode', '--', 'src/components/lark-doc/'], { cwd: root, encoding: 'utf8' })
    } catch (error) {
      status = error.status
    }
    // git grep 找不到东西时退出码为 1；得到 0 意味着 core 目录里还有残留。
    expect(status).toBe(1)
  })
})
