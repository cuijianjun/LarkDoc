import { describe, expect, it } from 'vitest'

import {
  DEFAULT_LOAD_FACTOR,
  DEFAULT_LOAD_FLOOR,
  evaluateLoad,
  loadLimit,
} from '../../scripts/perf/preflight.mjs'

/**
 * perf/preflight.mjs 的回归夹具（纯函数，不读 `loadavg`、不起浏览器）。
 *
 * 这组用例守的是一次真实事故的具体数字：`check:perf` 串跑时构建尾流把 16 核机的
 * 1 分钟负载从 7.38 推到 **15.78**，紧随的 `measure` 采在热机上，得到 4 项「退化」；
 * 同一 bundle 在机器静下来（负载 **5.95**）单独跑是 7/7 全绿。
 * 所以「15.78 该等、5.95 该采」不是拍脑袋的阈值，是用例要钉住的行为。
 */

describe('loadLimit', () => {
  it('16 核按系数 0.5 得 8（相对值高于下限，取相对值）', () => {
    expect(loadLimit({ cores: 16 })).toBe(8)
  })

  it('核数少时下限生效：4 核算出 2，但仍要求 ≤ 4 才能采', () => {
    // 没有下限的话，2~4 核机在正常系统负载下永远等不到，采集直接卡死。
    expect(loadLimit({ cores: 4 })).toBe(DEFAULT_LOAD_FLOOR)
  })

  it('大机器按核数线性放宽：32 核得 16', () => {
    expect(loadLimit({ cores: 32 })).toBe(16)
  })

  it('系数与下限都可覆盖', () => {
    expect(loadLimit({ cores: 16, factor: 0.25 })).toBe(4)
    expect(loadLimit({ cores: 2, factor: 0.5, floor: 1 })).toBe(1)
  })

  it('核数缺失或非法时退到下限，而不是 NaN', () => {
    for (const cores of [undefined, null, 0, -1, Number.NaN]) {
      expect(loadLimit({ cores })).toBe(DEFAULT_LOAD_FLOOR)
    }
  })

  it('非法系数退回默认系数，而不是算出 0 让采集永远等不到', () => {
    expect(loadLimit({ cores: 16, factor: 0 })).toBe(8)
    expect(loadLimit({ cores: 16, factor: Number.NaN })).toBe(8)
  })

  it('默认常量本身不做成魔法数：系数 0.5 / 下限 4', () => {
    expect(DEFAULT_LOAD_FACTOR).toBe(0.5)
    expect(DEFAULT_LOAD_FLOOR).toBe(4)
  })
})

describe('evaluateLoad', () => {
  it('构建尾流后的 15.78 在 16 核机上不可采（假红灯的现场）', () => {
    const state = evaluateLoad({ load1: 15.78, cores: 16 })
    expect(state.idle).toBe(false)
    expect(state.limit).toBe(8)
    expect(state.load1).toBe(15.78)
  })

  it('静下来的 5.95 在 16 核机上可采（7/7 全绿的那一次）', () => {
    expect(evaluateLoad({ load1: 5.95, cores: 16 }).idle).toBe(true)
  })

  it('恰好等于上限算可采（边界取等号）', () => {
    expect(evaluateLoad({ load1: 8, cores: 16 }).idle).toBe(true)
    expect(evaluateLoad({ load1: 8.01, cores: 16 }).idle).toBe(false)
  })

  it('读不到负载时放行，并标记 known=false 让调用方能区分「真空闲」和「不知道」', () => {
    const state = evaluateLoad({ load1: Number.NaN, cores: 16 })
    expect(state.idle).toBe(true)
    expect(state.known).toBe(false)
    expect(state.load1).toBeNull()
  })

  it('已知负载时 known 为 true', () => {
    expect(evaluateLoad({ load1: 3.2, cores: 8 }).known).toBe(true)
  })

  it('limit 可直接指定，优先于核数换算（CI 按运行器写死时用）', () => {
    const state = evaluateLoad({ load1: 5, cores: 16, limit: 3 })
    expect(state.limit).toBe(3)
    expect(state.idle).toBe(false)
  })

  it('limit 传 0 或非数字时忽略，回到核数换算', () => {
    for (const limit of [0, Number.NaN, undefined]) {
      expect(evaluateLoad({ load1: 5, cores: 16, limit }).limit).toBe(8)
    }
  })
})
