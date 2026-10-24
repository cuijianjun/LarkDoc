/**
 * P0-02 core 去 Vue。
 *
 * `src/components/lark-doc/`（core 装配层）的依赖闭包里不允许出现 Vue：
 * 这是「core 零框架 + 三端薄适配」的第一道结构性门禁。UI 框架专属的
 * NodeView 已经搬到 `src/adapters/vue2/`，由适配层在模块加载时通过
 * `setNodeView()` 注册进 `src/registry/nodeviews.js`，core 只查表。
 *
 * 守卫内容：
 *  1. extensions.js 的依赖闭包不含任何 vue 系包（vue / @vue/* / @tiptap/vue-2）；
 *  2. 闭包里也不含 .vue 单文件组件（防止有人绕回去 import 组件）；
 *  3. 闭包必须非空且确实含 @tiptap/core —— 防止探测 harness 空转导致本测试
 *     空转放行（ vacuous pass ）。
 */

import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { dependencyClosure } from '../helpers/dependency-closure.js'

const requireHere = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

const VUE_PACKAGE = /[/\\]node_modules[/\\](vue[/\\]|@vue[/\\]|@tiptap[/\\]vue-2[/\\])/

describe('P0-02 core 去 Vue', () => {
  const closure = dependencyClosure({
    root,
    sourceRoot: path.join(root, 'src'),
    babelCore: requireHere.resolve('@babel/core'),
    entry: path.join(root, 'src/components/lark-doc/extensions.js'),
  })

  it('探测闭包非空且确实包含 @tiptap/core（防 harness 空转放行）', { timeout: 30000 }, () => {
    expect(closure.length).toBeGreaterThan(0)
    expect(closure.some((file) => /[/\\]node_modules[/\\]@tiptap[/\\]core[/\\]/.test(file))).toBe(true)
  })

  it('extensions.js 依赖闭包不含 vue / @vue/* / @tiptap/vue-2', { timeout: 30000 }, () => {
    const leaks = closure.filter((file) => VUE_PACKAGE.test(file))
    expect(leaks).toEqual([])
  })

  it('extensions.js 依赖闭包不含 .vue 单文件组件', { timeout: 30000 }, () => {
    const leaks = closure.filter((file) => file.endsWith('.vue'))
    expect(leaks).toEqual([])
  })
})
