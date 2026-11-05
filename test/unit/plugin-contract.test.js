import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'
import { fileURLToPath, pathToFileURL } from 'url'
import { describe, expect, it } from 'vitest'
import plugin, { raw, rollup, rspack, vite, webpack } from '../../src/plugin/index'

const require = createRequire(import.meta.url)

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

  it('源码保留 named exports', () => {
    expect(vite).toBe(plugin)
    expect(rollup).toBe(plugin)
    expect(typeof webpack).toBe('function')
    expect(typeof rspack).toBe('function')
    expect(typeof raw).toBe('function')
  })

  it('构建产物保留 ESM 与 CommonJS named exports', async () => {
    const esm = await import(pathToFileURL(path.join(dist, 'plugin.mjs')).href)
    const cjs = require(path.join(dist, 'plugin.cjs'))
    for (const exports of [esm, cjs]) {
      expect(typeof exports.default).toBe('function')
      expect(exports.vite).toBe(exports.default)
      expect(exports.rollup).toBe(exports.default)
      expect(typeof exports.webpack).toBe('function')
      expect(typeof exports.rspack).toBe('function')
      expect(typeof exports.raw).toBe('function')
    }
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

  it('injectStyles 发射命名 CSS asset，而不是改写源码 import', () => {
    const instance = plugin({ features: [], fonts: false, injectStyles: true })
    const emitted = []
    instance.generateBundle.call({ emitFile: (asset) => emitted.push(asset) }, {}, {})
    expect(emitted.map((asset) => asset.fileName)).toEqual([
      'lark-doc-element.umd.min.js',
      'lark-doc.css',
    ])
    expect(emitted[1].source.equals(fs.readFileSync(path.resolve(dist, '../style.css')))).toBe(true)
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

  it('webpack 已有相同 publicPath 时不覆盖，冲突时明确报错', () => {
    const compiler = {
      options: { output: { publicPath: '/vendor/lark-doc/' } },
      hooks: {
        thisCompilation: { tap() {} },
        emit: { tapAsync() {} },
      },
    }
    expect(() => webpack({ basePath: '/vendor/lark-doc/' }).apply(compiler)).not.toThrow()
    expect(compiler.options.output.publicPath).toBe('/vendor/lark-doc/')
    expect(() => webpack({ basePath: '/other/' }).apply(compiler)).toThrow('publicPath')
  })
})
