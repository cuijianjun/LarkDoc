import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { rollup } from 'rollup'
import { declaredExports, getRollupConfig, sharedHostModules } from '../../rollup.config.mjs'

const root = path.resolve(__dirname, '../..')
const sourceOf = file => path.join(root, file)

describe('跨产物共享模块', () => {
  it('登记表与内核发布表一一对齐，且发布的是仓库里的同一份文件', () => {
    const source = fs.readFileSync(sourceOf('src/web-component/standalone.js'), 'utf8')
    const published = new Map()
    for (const [, key, binding] of source.matchAll(/'([\w.]+)':\s*(\w+),?/g)) published.set(key, binding)

    // 名字对不上，包内 shim 拿到 undefined 就直接抛错；绑定指向别的文件，发布的就是另一份实现。
    expect([...published.keys()].sort()).toEqual(Object.values(sharedHostModules).sort())
    for (const [file, name] of Object.entries(sharedHostModules)) {
      expect(published.get(name), name).toBeDefined()
      expect(source, name).toContain(`import * as ${published.get(name)} from '${file.replace(/^src\//, '../').replace(/\.js$/, '')}'`)
    }
  })

  it('shim 转发源文件全部导出，既不缺也不重', async () => {
    for (const [file, name] of Object.entries(sharedHostModules)) {
      const declared = declaredExports(fs.readFileSync(sourceOf(file), 'utf8'), name)
      // 缺一个导出，用到它的地方就是 undefined；重复声明则构建期直接报错。
      expect(declared, name).toEqual([...new Set(declared)])
      expect(declared.sort(), name).toEqual(Object.keys(await import(sourceOf(file))).sort())
    }
  })

  it('三支 UI 包内不再含登记模块的实现体', async () => {
    const replaced = new Set()
    for (const target of ['feature:ui:umd', 'feature:uiPanels:umd', 'feature:uiExtra:umd']) {
      const config = getRollupConfig(target)
      const bundle = await rollup(config)
      const { output } = await bundle.generate(config.output)
      await bundle.close()
      const modules = output.find(item => item.type === 'chunk').modules
      const ids = Object.keys(modules)
      let shimCount = 0

      for (const [file, name] of Object.entries(sharedHostModules)) {
        const shim = ids.find(key => key.startsWith('\0lark-doc-shared-host:') && key.endsWith(`:${name}`))
        if (!shim) continue // 这个包没有引用该模块，两边都不该出现
        shimCount += 1
        replaced.add(name)
        // 实现体还在 = 模块没被换成 shim：字节白付，还与内核各持一份可变状态。
        expect(ids.find(key => key.endsWith(`/${file}`)), `${target} 里 ${name} 的实现体仍在`).toBeUndefined()
        // shim 只列导出名，渲染长度必然远小于源文件。
        expect(modules[shim].renderedLength, `${name} 的 shim 疑似带上了实现`).toBeLessThan(fs.statSync(sourceOf(file)).size)
        expect(modules[shim].code).toContain('__LARK_DOC_SHARED__')
      }
      // 每支包只换它真正用到的那些；两个包合起来必须覆盖整张登记表。
      expect(shimCount, `${target} 一个共享模块都没换`).toBeGreaterThan(0)
    }
    // 表格专用图标直接引用 icons 的 wrap，两条导入都应走运行时共享表。
    expect(replaced).toContain('ui.icon')
    expect(replaced).toContain('ui.icons')
    expect(replaced.size).toBeGreaterThan(12)
  }, 180_000)
})
