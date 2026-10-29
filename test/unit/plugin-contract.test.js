import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { describe, expect, it } from 'vitest'
import plugin, { raw, rollup, rspack, vite, webpack } from '../../src/plugin/index'

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist')

describe('阶段6-B · plugin contract', () => {
  it('提供默认工厂和五个适配器入口', () => {
    expect(typeof plugin).toBe('function')
    expect(vite).toBe(plugin)
    expect(rollup).toBe(plugin)
    expect(typeof webpack).toBe('function')
    expect(typeof rspack).toBe('function')
    expect(typeof raw).toBe('function')
  })

  it('默认工厂只返回构建期钩子，不注入运行时业务代码', () => {
    const instance = plugin({ features: ['math'], fonts: false })
    expect(instance).toMatchObject({ name: 'lark-doc-assets', apply: 'build' })
    expect(typeof instance.generateBundle).toBe('function')
    expect(instance.transform).toBeUndefined()
    expect(instance.load).toBeUndefined()
  })

  it('构建期只发射声明的本地资源', () => {
    const instance = plugin({ features: ['math'], fonts: false })
    const emitted = []
    instance.generateBundle.call({
      emitFile(asset) {
        emitted.push(asset)
      },
    }, {}, {})

    expect(emitted.map((asset) => asset.fileName)).toEqual([
      'lark-doc-element.umd.min.js',
      'lark-doc-element.umd.min.math.js',
    ])
    expect(emitted.every((asset) => Buffer.isBuffer(asset.source))).toBe(true)
    expect(emitted.every((asset) => fs.existsSync(path.join(dist, asset.fileName)))).toBe(true)
  })

  it('copyAs=none 不发射资源', () => {
    const instance = plugin({ copyAs: 'none' })
    const emitted = []
    instance.generateBundle.call({ emitFile: (asset) => emitted.push(asset) }, {}, {})
    expect(emitted).toEqual([])
  })

  it('webpack 适配器使用 webpack plugin 对象', () => {
    const instance = webpack({ copyAs: 'none' })
    expect(instance.constructor.name).toBe('LarkDocWebpackPlugin')
    expect(typeof instance.apply).toBe('function')
    expect(rspack({ copyAs: 'none' }).constructor.name).toBe('LarkDocWebpackPlugin')
  })
})
