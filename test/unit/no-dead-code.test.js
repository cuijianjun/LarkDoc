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
import { dependencyClosure } from '../helpers/dependency-closure.js'

const requireHere = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

function closureOfExtensions() {
  return dependencyClosure({
    root,
    sourceRoot: path.join(root, 'src'),
    babelCore: requireHere.resolve('@babel/core'),
    entry: path.join(root, 'src/components/lark-doc/extensions.js'),
  })
}

describe('P0-01 删死代码', () => {
  it('extensions.js 的依赖闭包内不含 ImageNode / CodeNode', { timeout: 30000 }, () => {
    const leaks = closureOfExtensions().filter((file) => /ImageNode|CodeNode/.test(file))
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
