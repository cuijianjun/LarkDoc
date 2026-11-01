import { describe, expect, it } from 'vitest'
import {
  foldStorageKey,
  normalizeFoldStorageValues,
  readFoldStorage,
  serializeFoldedIds,
  writeFoldStorage,
} from '../../src/core/blocks/fold-persistence'

describe('fold persistence core helpers', () => {
  it('按 document key 生成 storage key，缺省时使用空 key', () => {
    expect(foldStorageKey('doc-42')).toBe('lark-doc:folds:doc-42')
    expect(foldStorageKey('')).toBe('')
    expect(foldStorageKey(null)).toBe('')
  })

  it('把可迭代折叠状态序列化成原有 JSON 数组格式', () => {
    expect(serializeFoldedIds(new Set(['b2', 'b1']))).toBe('["b2","b1"]')
    expect(serializeFoldedIds()).toBe('[]')
  })

  it('只保留非空字符串，并按旧键分隔符拆分 blockId 与 legacy key', () => {
    expect(normalizeFoldStorageValues([
      'b1', '', ' level\u0001标题\u00010', 42, 'b2', null,
    ])).toEqual({
      values: ['b1', ' level\u0001标题\u00010', 'b2'],
      blockIds: ['b1', 'b2'],
      legacyKeys: [' level\u0001标题\u00010'],
    })
    expect(normalizeFoldStorageValues({})).toEqual({ values: [], blockIds: [], legacyKeys: [] })
  })

  it('读取 JSON 并在非法 JSON、非数组或 storage 异常时归一化为空', () => {
    const storage = { getItem: () => '["b1", "x\\u0001title\\u00010"]' }
    expect(readFoldStorage(storage, 'key')).toEqual({
      values: ['b1', 'x\u0001title\u00010'],
      blockIds: ['b1'],
      legacyKeys: ['x\u0001title\u00010'],
    })
    expect(readFoldStorage({ getItem: () => '{' }, 'key').values).toEqual([])
    expect(readFoldStorage({ getItem: () => '"b1"' }, 'key').values).toEqual([])
    expect(readFoldStorage({ getItem: () => { throw new Error('blocked') } }, 'key').values).toEqual([])
  })

  it('写入原始 JSON，不重复改变调用方传入的值，并静默处理 storage 异常', () => {
    const calls = []
    writeFoldStorage({ setItem: (...args) => calls.push(args) }, 'key', '["b1"]')
    expect(calls).toEqual([['key', '["b1"]']])
    expect(() => writeFoldStorage({ setItem: () => { throw new Error('blocked') } }, 'key', '[]')).not.toThrow()
    expect(() => writeFoldStorage(null, 'key', '[]')).not.toThrow()
  })
})
