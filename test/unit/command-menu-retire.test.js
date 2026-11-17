// @vitest-environment jsdom
// T086：命令菜单退役入口 —— 关闭或销毁后的入口不得再委托 onChoose。
// 物理 click 已有 activeTarget 守卫；`choose()` 是 `commandMenuMixin.onEditorKeydown`
// 直调的公开键盘入口，此前只认 `menuOpen`，不认 UI 自己的 open/挂载/销毁状态。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCommandMenu } from '../../src/ui/commandMenu'

const uiList = []
function mount(handlers = {}) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const onChoose = vi.fn()
  const onClose = vi.fn()
  const ui = createCommandMenu({ host, handlers: { onChoose, onClose, ...handlers } })
  uiList.push(ui)
  const items = [{ id: 'paragraph', label: '正文' }, { id: 'divider', label: '分割线' }]
  const state = extra => ({ open: true, kind: 'plus', items, templates: [], query: '', activeId: '', activeIndex: null, positionStyle: null, ...extra })
  ui.update(state())
  return { host, ui, onChoose, state }
}

afterEach(() => {
  while (uiList.length) uiList.pop().destroy()
  document.body.innerHTML = ''
})

describe('T086 命令菜单退役入口', () => {
  it('打开且已挂载时键盘选择仍提交（正控制，防止守卫误伤正常入口）', () => {
    const { ui, onChoose } = mount()
    expect(ui.el.isConnected).toBe(true)
    ui.choose()
    expect(onChoose).toHaveBeenCalledTimes(1)
  })

  it('close 后未挂载的 UI 再被 choose 不得委托 onChoose', () => {
    const { ui, onChoose, state } = mount()
    ui.update(state({ open: false }))
    expect(ui.el.isConnected).toBe(false)
    ui.choose()
    expect(onChoose).not.toHaveBeenCalled()
  })

  it('销毁后即使宿主把旧节点挂回，choose/点击都不得委托 onChoose', () => {
    const { ui, onChoose, host } = mount()
    const button = ui.el.querySelector('button[data-command-id]')
    ui.destroy()
    host.appendChild(ui.el)
    ui.choose()
    button?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    expect(onChoose).not.toHaveBeenCalled()
  })
})
