import { describe, expect, it } from 'vitest'
import { DEFAULT_PLUGIN_OPTIONS, normalizePluginOptions } from '../../src/plugin/options'
import { normalizeBasePath } from '../../src/plugin/publicPath'

describe('阶段6-A · plugin options', () => {
  it('使用公开默认选项', () => {
    expect(DEFAULT_PLUGIN_OPTIONS).toEqual({
      features: 'auto',
      basePath: undefined,
      fonts: true,
      injectStyles: false,
      copyAs: 'build',
    })
    expect(normalizePluginOptions()).toEqual(DEFAULT_PLUGIN_OPTIONS)
  })

  it('features 只接受 auto 或字符串数组', () => {
    expect(normalizePluginOptions({ features: ['math', 'mermaid'] }).features).toEqual(['math', 'mermaid'])
    expect(normalizePluginOptions({ features: [] }).features).toEqual([])
    expect(() => normalizePluginOptions({ features: 'all' })).toThrow('features 必须是 "auto" 或字符串数组')
    expect(() => normalizePluginOptions({ features: ['math', ''] })).toThrow('features 数组只能包含非空字符串')
  })

  it('规范化 basePath 并保留未配置的 undefined', () => {
    expect(normalizeBasePath(undefined)).toBeUndefined()
    expect(normalizeBasePath('/vendor/lark-doc')).toBe('/vendor/lark-doc/')
    expect(normalizeBasePath('/vendor/lark-doc/')).toBe('/vendor/lark-doc/')
    expect(normalizeBasePath('  /vendor/lark-doc  ')).toBe('/vendor/lark-doc/')
    expect(normalizeBasePath('')).toBe('/')
  })

  it('禁止网络/CDN 基址并报告清晰错误', () => {
    expect(() => normalizeBasePath('https://cdn.example.com/lark-doc')).toThrow('禁止使用网络或 CDN 地址')
    expect(() => normalizeBasePath('//cdn.example.com/lark-doc')).toThrow('禁止使用网络或 CDN 地址')
    expect(() => normalizeBasePath('cdn://lark-doc')).toThrow('禁止使用网络或 CDN 地址')
  })

  it('校验公开布尔选项和 copyAs', () => {
    expect(normalizePluginOptions({ fonts: false, injectStyles: true, copyAs: 'none' })).toEqual({
      features: 'auto',
      basePath: undefined,
      fonts: false,
      injectStyles: true,
      copyAs: 'none',
    })
    expect(() => normalizePluginOptions({ fonts: 'yes' })).toThrow('fonts 必须是布尔值')
    expect(() => normalizePluginOptions({ injectStyles: 1 })).toThrow('injectStyles 必须是布尔值')
    expect(() => normalizePluginOptions({ copyAs: 'cdn' })).toThrow('copyAs 必须是 "build" 或 "none"')
  })
})
