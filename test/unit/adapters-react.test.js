import { describe, expect, it, vi } from 'vitest'
import { createReactLarkDoc, LARK_DOC_EVENTS } from '../../src/adapters/react'
import { EVENT_MAP } from '../../src/web-component/events'

describe('React adapter contract', () => {
  it('rejects a missing React runtime', () => {
    expect(() => createReactLarkDoc()).toThrow('需要传入 React 实例')
    expect(() => createReactLarkDoc({})).toThrow('需要传入 React 实例')
  })

  it('creates a forwardRef component and filters event props', () => {
    const calls = []
    const React = {
      createElement: (...args) => (calls.push(args), args),
      forwardRef: (render) => render,
      useEffect: () => {},
      useImperativeHandle: () => {},
      useRef: (value) => ({ current: value }),
    }
    const Component = createReactLarkDoc(React)
    expect(Component.displayName).toBe('LarkDoc')
    const result = Component({ contentFormat: 'html', onChange: vi.fn(), typoProp: 'ignored' }, {})
    expect(result[0]).toBe('lark-doc')
    expect(result[1]['content-format']).toBe('html')
    expect(result[1].onChange).toBeUndefined()
    expect(result[1].ref).toBeTruthy()
    expect(calls).toHaveLength(1)
  })

  it('serializes list and boolean props with Web Component semantics', () => {
    const React = {
      createElement: (...args) => args,
      forwardRef: (render) => render,
      useEffect: () => {},
      useImperativeHandle: () => {},
      useRef: (value) => ({ current: value }),
    }
    const Component = createReactLarkDoc(React)
    const result = Component({ toolbarKeys: ['bold', 'link'], readonly: true, autofocus: false }, {})
    expect(result[1]['toolbar-keys']).toBe('bold,link')
    expect(result[1].readonly).toBe('')
    expect(result[1].autofocus).toBe('false')
  })

  it('exports the framework-neutral event map', () => {
    expect(LARK_DOC_EVENTS).toEqual(EVENT_MAP)
  })
})
