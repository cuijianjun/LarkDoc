/**
 * 特性注册表单测（阶段 4）—— Node 环境、无 DOM。
 *
 * 锁四件事：
 *  1. 契约：registerFeature / hasFeature / loadFeature 的参数校验与返回值；
 *  2. 优先级：注册 loader 优先于 fallback，未注册走 fallback，两者皆无 reject；
 *  3. 全局共享：注册表挂在 globalThis.__LARK_DOC_FEATURES__ —— 主产物与
 *     dist/features/*.js 两个 bundle 各持 registry.js 副本也能互通（这里用
 *     「重新 import 同一模块 + 直查全局」近似锁住共享语义）；
 *  4. 错误注名：loader / fallback 抛错都要带 `[lark-doc] 特性 "x"` 前缀，
 *     调用方 catch 才能把「哪个可选能力没装上」带进 UI。
 *
 * 用例跑在共享 worker（isolate:false）里，全局注册表用完必须清空，
 * 否则桩会泄漏给同 worker 的后续文件。
 */

import { describe, expect, it } from 'vitest'
import { hasFeature, loadFeature, registerFeature } from '../../src/core/features/registry'

const KEY = '__LARK_DOC_FEATURES__'

/** 清掉本文件注册的所有特性，防桩泄漏（isolate:false 的共享 worker）。 */
function cleanup(names) {
  names.forEach((name) => {
    const map = globalThis[KEY]
    if (map instanceof Map) map.delete(name)
  })
}

describe('registerFeature / hasFeature 参数契约', () => {
  it('特性名必须是非空字符串', () => {
    expect(() => registerFeature('', () => {})).toThrow(TypeError)
    expect(() => registerFeature(42, () => {})).toThrow(TypeError)
    expect(() => registerFeature(undefined, () => {})).toThrow(TypeError)
  })

  it('loader 必须是函数', () => {
    expect(() => registerFeature('bad-loader', 'not-a-function')).toThrow(TypeError)
    expect(() => registerFeature('bad-loader', null)).toThrow(TypeError)
  })

  it('hasFeature：注册为 true、未注册为 false', () => {
    const unbind = registerFeature('probe-has', () => 1)
    expect(hasFeature('probe-has')).toBe(true)
    expect(hasFeature('probe-missing')).toBe(false)
    unbind()
    cleanup(['probe-has'])
    expect(hasFeature('probe-has')).toBe(false)
  })
})

describe('registerFeature 返回解绑函数', () => {
  it('解绑后 loadFeature 回落到 fallback', async () => {
    const unbind = registerFeature('probe-unbind', () => 'registered')
    expect(await loadFeature('probe-unbind', () => 'fallback')).toBe('registered')
    unbind()
    // 解绑函数只在映射未被覆盖时移除：重复解绑不抛错。
    expect(() => unbind()).not.toThrow()
    expect(await loadFeature('probe-unbind', () => 'fallback')).toBe('fallback')
    cleanup(['probe-unbind'])
  })

  it('解绑不影响被覆盖后的新注册（后写覆盖先写）', async () => {
    const first = registerFeature('probe-override', () => 'first')
    registerFeature('probe-override', () => 'second')
    first()
    expect(await loadFeature('probe-override')).toBe('second')
    cleanup(['probe-override'])
  })
})

describe('loadFeature 优先级', () => {
  it('注册 loader 优先于 fallback', async () => {
    const unbind = registerFeature('probe-priority', () => ({ from: 'registry' }))
    expect(await loadFeature('probe-priority', () => ({ from: 'fallback' }))).toEqual({ from: 'registry' })
    unbind()
    cleanup(['probe-priority'])
  })

  it('未注册走 fallback（同步返回值也接受）', async () => {
    expect(await loadFeature('probe-fallback', () => 42)).toBe(42)
  })

  it('未注册且无 fallback：reject 可读错误', async () => {
    await expect(loadFeature('probe-none')).rejects.toThrow('probe-none')
    await expect(loadFeature('probe-none')).rejects.toThrow('lark-doc/features')
  })
})

describe('loadFeature 错误加注特性名', () => {
  it('loader 同步抛错 → 带特性名', async () => {
    const unbind = registerFeature('probe-throw', () => { throw new Error('boom') })
    await expect(loadFeature('probe-throw')).rejects.toThrow('[lark-doc] 特性 "probe-throw" 加载失败：boom')
    unbind()
    cleanup(['probe-throw'])
  })

  it('loader 返回 rejected Promise → 带特性名', async () => {
    const unbind = registerFeature('probe-reject', () => Promise.reject(new Error('async-boom')))
    await expect(loadFeature('probe-reject')).rejects.toThrow('特性 "probe-reject" 加载失败：async-boom')
    unbind()
    cleanup(['probe-reject'])
  })

  it('fallback 抛错同样加注特性名', async () => {
    await expect(loadFeature('probe-fb-throw', () => { throw new Error('fb-boom') }))
      .rejects.toThrow('特性 "probe-fb-throw" 加载失败：fb-boom')
  })

  it('非 Error 抛出值也能注名成 Error', async () => {
    const unbind = registerFeature('probe-nonerror', () => Promise.reject('plain string'))
    await expect(loadFeature('probe-nonerror')).rejects.toThrow('特性 "probe-nonerror" 加载失败：plain string')
    unbind()
    cleanup(['probe-nonerror'])
  })
})

describe('全局共享语义', () => {
  it('注册表挂 globalThis 且为 Map（跨 bundle 副本互通的根基）', () => {
    const unbind = registerFeature('probe-global', () => 1)
    expect(globalThis[KEY] instanceof Map).toBe(true)
    expect(globalThis[KEY].get('probe-global')).toBeTypeOf('function')
    unbind()
    cleanup(['probe-global'])
  })
})
