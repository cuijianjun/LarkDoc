import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { copyAssets, discoverAssets, getAssetEntries } from '../../src/plugin/assets'

const tempDirs = []

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lark-doc-plugin-'))
  tempDirs.push(root)
  const dist = path.join(root, 'dist')
  fs.mkdirSync(path.join(dist, 'fonts'), { recursive: true })
  fs.writeFileSync(path.join(dist, 'fonts', 'KaTeX_Main-Regular.woff2'), 'font')
  fs.writeFileSync(path.join(dist, 'lark-doc-element.umd.min.js'), 'main')
  fs.writeFileSync(path.join(dist, 'lark-doc-element.umd.min.math.js'), 'math')
  fs.writeFileSync(path.join(dist, 'lark-doc-element.umd.min.mermaid.js'), 'mermaid')
  fs.writeFileSync(path.join(dist, 'lark-doc-element.umd.min.vendor.js'), 'vendor')
  fs.writeFileSync(path.join(dist, 'not-an-element-asset.js'), 'ignore')
  return { root, dist }
}

afterEach(() => {
  while (tempDirs.length) fs.rmSync(tempDirs.pop(), { recursive: true, force: true })
})

describe('阶段6-A · plugin assets', () => {
  it('动态发现 fonts 与所有 element 区块，不依赖固定文件清单', () => {
    const { dist } = fixture()
    const assets = discoverAssets({ distDir: dist })
    expect(assets.fonts.map((file) => path.basename(file))).toEqual(['KaTeX_Main-Regular.woff2'])
    expect(assets.chunks.map((file) => path.basename(file))).toEqual([
      'lark-doc-element.umd.min.js',
      'lark-doc-element.umd.min.math.js',
      'lark-doc-element.umd.min.mermaid.js',
      'lark-doc-element.umd.min.vendor.js',
    ])
  })

  it('features 数组只发现指定区块，缺失特性时报清晰错误', () => {
    const { dist } = fixture()
    expect(discoverAssets({ distDir: dist, features: ['math'] }).chunks.map((file) => path.basename(file))).toEqual([
      'lark-doc-element.umd.min.js',
      'lark-doc-element.umd.min.math.js',
    ])
    expect(() => discoverAssets({ distDir: dist, features: ['office'] })).toThrow('未找到指定特性资源：office')
  })

  it('fonts=false 不发现字体，主产物仍必须存在', () => {
    const { dist } = fixture()
    const assets = discoverAssets({ distDir: dist, fonts: false })
    expect(assets.fonts).toEqual([])
    expect(assets.chunks).toHaveLength(4)
  })

  it('copyAs=none 不拷贝且不要求输出目录', () => {
    const { dist } = fixture()
    expect(getAssetEntries({ distDir: dist, copyAs: 'none' })).toEqual([])
    expect(copyAssets({ distDir: dist, copyAs: 'none' })).toEqual([])
  })

  it('build 模式生成并执行 fonts / 区块复制条目', () => {
    const { root, dist } = fixture()
    const outputDir = path.join(root, 'build', 'assets')
    const entries = getAssetEntries({ distDir: dist, outputDir, features: ['math'] })
    expect(entries.map((entry) => path.relative(outputDir, entry.to))).toEqual([
      path.join('fonts', 'KaTeX_Main-Regular.woff2'),
      'lark-doc-element.umd.min.js',
      'lark-doc-element.umd.min.math.js',
    ])
    const copied = copyAssets({ distDir: dist, outputDir, features: ['math'] })
    expect(copied).toEqual(entries.map((entry) => entry.to))
    expect(fs.readFileSync(path.join(outputDir, 'fonts', 'KaTeX_Main-Regular.woff2'), 'utf8')).toBe('font')
    expect(fs.readFileSync(path.join(outputDir, 'lark-doc-element.umd.min.math.js'), 'utf8')).toBe('math')
    expect(fs.existsSync(path.join(outputDir, 'lark-doc-element.umd.min.mermaid.js'))).toBe(false)
  })
})
