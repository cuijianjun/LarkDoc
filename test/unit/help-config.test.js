// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { LarkDoc } from '../../src/LarkDoc'
import { createLarkDocConfig } from '../../src/components/lark-doc/larkDocConfig'
import { HELP_MENU_ITEMS } from '../../src/ui/shortcutGroups'

const mounted = []

function mount(options = {}) {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const doc = new LarkDoc({ element, content: '<p>正文</p>', storage: 'none', ...options })
  mounted.push({ element, doc })
  return { element, doc }
}

function openMenu(element) {
  element.querySelector('.lark-doc-help-fab').click()
  return [...element.querySelectorAll('.lark-doc-help-menu [role="menuitem"]')]
}

afterEach(() => {
  mounted.splice(0).forEach(({ doc, element }) => { doc.destroy(); element.remove() })
  vi.restoreAllMocks()
})

describe('帮助菜单配置', () => {
  it('默认保持现有五项菜单，配置数组不共享可变引用', () => {
    const config = createLarkDocConfig()
    expect(config.help).toMatchObject({ enabled: true, items: HELP_MENU_ITEMS.map(item => item.id), onAction: null })
    config.help.items.pop()
    const { element } = mount()
    expect(openMenu(element).map(item => item.textContent)).toEqual(HELP_MENU_ITEMS.map(item => item.label))
  })

  it('归一化菜单顺序、去重和未知项，保留显式空数组', () => {
    const action = vi.fn()
    const input = ['shortcuts', 'unknown', 'support', 'shortcuts']
    const config = createLarkDocConfig({ help: { items: input, onAction: action } })
    expect(config.help.items).toEqual(['shortcuts', 'support'])
    expect(config.help.onAction).toBe(action)
    expect(input).toEqual(['shortcuts', 'unknown', 'support', 'shortcuts'])
    expect(createLarkDocConfig({ help: { items: [] } }).help.items).toEqual([])
    expect(createLarkDocConfig({ help: { items: 'shortcuts', onAction: 'invalid' } }).help).toMatchObject({
      items: HELP_MENU_ITEMS.map(item => item.id), onAction: null,
    })
  })

  it.each([{ enabled: false }, { items: [] }])('%j 隐藏圆钮，键盘快捷键帮助仍可用', async help => {
    const { element } = mount({ help })
    expect(element.querySelector('.lark-doc-help-fab')).toBeNull()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '/', ctrlKey: true, bubbles: true, cancelable: true }))
    await vi.waitFor(() => expect(element.querySelector('.lark-doc-help-drawer')).not.toBeNull())
  })

  it('支持 config.help 及顶层 help 覆盖，只通知实际点击项', () => {
    const onAction = vi.fn()
    const { element } = mount({
      config: { help: { items: ['shortcuts'], onAction } },
      help: { items: ['help-center', 'support'] },
    })
    const rows = openMenu(element)
    expect(rows.map(row => row.textContent)).toEqual(['帮助中心', '联系客服'])
    rows[1].click()
    expect(onAction).toHaveBeenCalledExactlyOnceWith({ id: 'support', label: '联系客服' })
    expect(element.querySelector('.lark-doc-help-menu')).toBeNull()
    expect(element.querySelector('.lark-doc-help-drawer')).toBeNull()
  })

  it('快捷键项保持内置抽屉，并通知应用，回调参数不会改变内置菜单', async () => {
    const onAction = vi.fn(item => { item.id = 'changed' })
    const { element } = mount({ help: { items: ['shortcuts'], onAction } })
    const rows = openMenu(element)
    expect(rows).toHaveLength(1)
    rows[0].click()
    await vi.waitFor(() => expect(element.querySelector('.lark-doc-help-drawer')).not.toBeNull())
    expect(onAction).toHaveBeenCalledTimes(1)
    expect(HELP_MENU_ITEMS.find(item => item.label === '快捷键').id).toBe('shortcuts')
  })

  it('patchProps 隐藏已打开菜单，取消待关闭定时器，再启用时使用新配置', async () => {
    const onAction = vi.fn()
    const { element, doc } = mount()
    const editor = doc.getEditor()
    openMenu(element)
    const previous = element.querySelector('.lark-doc-help-fab-wrap')
    previous.dispatchEvent(new MouseEvent('mouseleave'))
    doc.patchProps({ config: { help: { enabled: false } } })
    await vi.waitFor(() => expect(element.querySelector('.lark-doc-help-fab-wrap')).toBeNull())
    await new Promise(resolve => setTimeout(resolve, 180))
    expect(previous.isConnected).toBe(false)
    expect(element.querySelector('.lark-doc-help-menu')).toBeNull()

    doc.patchProps({ config: { help: { items: ['support', 'shortcuts'], onAction } } })
    await vi.waitFor(() => expect(element.querySelector('.lark-doc-help-fab')).not.toBeNull())
    expect(doc.getEditor()).toBe(editor)
    expect(openMenu(element).map(row => row.textContent)).toEqual(['联系客服', '快捷键'])
    doc.patchProps({ config: { help: { items: ['help-center'], onAction } } })
    await vi.waitFor(() => expect([...element.querySelectorAll('.lark-doc-help-menu-item')].map(row => row.textContent)).toEqual(['帮助中心']))
    element.querySelector('.lark-doc-help-menu-item').click()
    expect(onAction).toHaveBeenCalledExactlyOnceWith({ id: 'help-center', label: '帮助中心' })
  })

  it.each(['throw', 'reject'])('onAction %s 进入实例 error 通道，不影响快捷键抽屉', async kind => {
    const failure = new Error('help action failed')
    const onError = vi.fn()
    const onAction = kind === 'throw' ? () => { throw failure } : () => Promise.reject(failure)
    const { element } = mount({ help: { items: ['shortcuts'], onAction }, onError })
    openMenu(element)[0].click()
    await vi.waitFor(() => expect(onError).toHaveBeenCalledExactlyOnceWith(failure))
    expect(element.querySelector('.lark-doc-help-drawer')).not.toBeNull()
  })
})
