import { describe, expect, it, vi } from 'vitest'
import { resolveVue3Attrs, VUE3_EVENTS } from '../../src/adapters/vue3'
import { EVENT_MAP } from '../../src/web-component/events'

describe('Vue 3 adapter contract', () => {
  it('serializes registered camelCase props to HTML attributes', () => {
    expect(resolveVue3Attrs({ contentFormat: 'html', readonly: true, toolbarKeys: ['bold', 'link'] })).toEqual({
      'content-format': 'html',
      readonly: '',
      'toolbar-keys': 'bold,link',
    })
  })

  it('uses HTML boolean semantics and skips nullish values', () => {
    expect(resolveVue3Attrs({ readonly: true, autofocus: false, saveHtml: 'off', title: null })).toEqual({
      readonly: '',
      autofocus: 'false',
      'save-html': 'off',
    })
  })

  it('serializes list props using the Web Component comma-list format', () => {
    expect(resolveVue3Attrs({ toolbarKeys: ['bold', 'link'], toolbarExcludes: [] })).toEqual({
      'toolbar-keys': 'bold,link',
      'toolbar-excludes': '',
    })
  })

  it('serializes JSON attributes and warns for unknown props', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(resolveVue3Attrs({ features: { comments: true }, typoProp: 'ignored' })).toEqual({
      features: JSON.stringify({ comments: true }),
    })
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })

  it('keeps the framework-neutral event map unchanged', () => {
    expect(VUE3_EVENTS).toEqual(EVENT_MAP)
    expect(VUE3_EVENTS.change).toBe('lark-doc-change')
  })
})
