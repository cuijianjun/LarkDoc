import { describe, expect, it, vi } from 'vitest'
import { createEditorUiRegistry } from '../../src/ui/editorUiRegistry'

describe('editor UI registry', () => {
  it('按注册顺序 mount，并把参数传给每个实例', () => {
    const calls = []
    const first = { mount: vi.fn((...args) => calls.push(['first', ...args])) }
    const second = { mount: vi.fn((...args) => calls.push(['second', ...args])) }
    const registry = createEditorUiRegistry()

    registry.register(first)
    registry.register(second)
    registry.mount('editor', { ready: true })

    expect(calls).toEqual([
      ['first', 'editor', { ready: true }],
      ['second', 'editor', { ready: true }],
    ])
  })

  it('按逆序 destroy，并跳过缺少 destroy 的实例', () => {
    const calls = []
    const first = { destroy: vi.fn(() => calls.push('first')) }
    const second = {}
    const third = { destroy: vi.fn(() => calls.push('third')) }
    const registry = createEditorUiRegistry()

    registry.register(first)
    registry.register(second)
    registry.register(third)
    registry.destroy('editor')

    expect(calls).toEqual(['third', 'first'])
    expect(first.destroy).toHaveBeenCalledWith('editor')
    expect(third.destroy).toHaveBeenCalledWith('editor')
  })

  it('update 只调用存在的 update，并保持注册顺序', () => {
    const calls = []
    const first = { update: vi.fn((...args) => calls.push(['first', ...args])) }
    const second = {}
    const third = { update: vi.fn((...args) => calls.push(['third', ...args])) }
    const registry = createEditorUiRegistry()

    registry.register(first)
    registry.register(second)
    registry.register(third)
    registry.update({ readonly: true })

    expect(calls).toEqual([
      ['first', { readonly: true }],
      ['third', { readonly: true }],
    ])
    expect(first.update).toHaveBeenCalledTimes(1)
    expect(third.update).toHaveBeenCalledTimes(1)
  })
})
