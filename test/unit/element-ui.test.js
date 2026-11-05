// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDeferredUi } from '../../src/features/element-ui'
import { registerFeature } from '../../src/core/features/registry'

const cleanups = []
const settle = async () => { for (let i = 0; i < 16; i += 1) await Promise.resolve() }
function fixture(visible) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  const loader = vi.fn(() => promise)
  cleanups.push(registerFeature('ui', loader))
  const instance = { el: document.createElement('div'), update: vi.fn(), destroy: vi.fn(), focusInput: vi.fn() }
  const factory = vi.fn(() => instance)
  const api = { createExample: factory }
  const onReady = vi.fn()
  const ui = createDeferredUi('createExample', { host, onReady }, visible)
  cleanups.push(() => ui.destroy())
  return { host, loader, instance, factory, api, onReady, ui, resolve, reject }
}
afterEach(() => {
  cleanups.splice(0).reverse().forEach(cleanup => cleanup())
  document.body.innerHTML = ''
})

describe('Element 延迟 UI 生命周期', () => {
  it('关闭时不加载；并发更新只加载一次并保留最新状态、聚焦与 ready', async () => {
    const h = fixture()
    h.ui.update({ open: false, query: '初始' })
    h.ui.focusInput()
    await settle()
    expect(h.loader).not.toHaveBeenCalled()
    h.ui.update({ open: true })
    h.ui.focusInput()
    h.ui.update({ query: '最新' })
    await settle()
    expect(h.loader).toHaveBeenCalledOnce()
    h.resolve(h.api)
    await settle()
    expect(h.factory).toHaveBeenCalledOnce()
    expect(h.instance.update).toHaveBeenCalledWith({ open: true, query: '最新' })
    expect(h.instance.focusInput).toHaveBeenCalledOnce()
    expect(h.onReady).toHaveBeenCalledOnce()
    expect(h.ui.el).toBe(h.instance.el)
    h.ui.update({ open: false })
    h.ui.update({ open: true })
    expect(h.loader).toHaveBeenCalledOnce()
    expect(h.instance.update).toHaveBeenLastCalledWith({ open: true, query: '最新' })
  })

  it.each(['关闭', '销毁'])('加载完成前%s不会挂载或偷焦点', async action => {
    const h = fixture()
    h.ui.update({ open: true })
    h.ui.focusInput()
    if (action === '关闭') h.ui.update({ open: false })
    else h.ui.destroy()
    h.resolve(h.api)
    await settle()
    expect(h.factory).not.toHaveBeenCalled()
    expect(h.onReady).not.toHaveBeenCalled()
    expect(h.instance.focusInput).not.toHaveBeenCalled()
    expect(h.host.childNodes).toHaveLength(0)
  })

  it('加载期间关闭后重开，取消旧聚焦并使用新状态', async () => {
    const h = fixture()
    h.ui.update({ open: true, query: '旧值' })
    h.ui.focusInput()
    h.ui.update({ open: false })
    h.ui.update({ open: true, query: '新值' })
    h.resolve(h.api)
    await settle()
    expect(h.instance.focusInput).not.toHaveBeenCalled()
    expect(h.instance.update).toHaveBeenCalledWith({ open: true, query: '新值' })
    h.ui.focusInput()
    expect(h.instance.focusInput).toHaveBeenCalledOnce()
  })

  it('命令菜单从 plus 切换到 slash 时取消待执行的搜索聚焦', async () => {
    const h = fixture()
    h.instance.focusSearch = vi.fn()
    h.ui.update({ open: true, kind: 'plus' })
    h.ui.focusSearch()
    h.ui.update({ open: true, kind: 'slash' })
    h.resolve(h.api)
    await settle()
    expect(h.instance.focusSearch).not.toHaveBeenCalled()
  })

  it('缓存命中同步创建，销毁后拒绝更新和重复销毁', () => {
    const h = fixture()
    cleanups.push(registerFeature('ui.ready', () => h.api))
    h.ui.update({ open: true })
    expect(h.ui.el).toBe(h.instance.el)
    expect(h.factory).toHaveBeenCalledOnce()
    expect(h.loader).not.toHaveBeenCalled()
    h.ui.destroy()
    h.ui.destroy()
    h.ui.update({ open: true })
    h.ui.focusInput()
    expect(h.instance.destroy).toHaveBeenCalledOnce()
    expect(h.instance.update).toHaveBeenCalledOnce()
    expect(h.instance.focusInput).not.toHaveBeenCalled()
  })

  it('失败显示可访问的重试入口，事件携带错误且重试后恢复', async () => {
    const h = fixture()
    const onError = vi.fn()
    h.host.addEventListener('lark-doc-error', onError)
    h.ui.update({ open: true })
    h.reject(new Error('<网络失败>'))
    await settle()
    const alert = h.host.querySelector('[role="alert"]')
    expect(alert.textContent).toContain('<网络失败>')
    expect(alert.querySelector('网络失败')).toBeNull()
    expect(onError.mock.calls[0][0].detail.error.message).toContain('特性 "ui"')
    h.loader.mockResolvedValue(h.api)
    alert.click()
    await settle()
    expect(h.loader).toHaveBeenCalledTimes(2)
    expect(h.factory).toHaveBeenCalledOnce()
    expect(h.host.querySelector('[role="alert"]')).toBeNull()
  })

  it.each(['关闭', '销毁'])('失败前%s不产生迟到错误 UI 或事件', async action => {
    const h = fixture()
    const onError = vi.fn()
    h.host.addEventListener('lark-doc-error', onError)
    h.ui.update({ open: true })
    if (action === '关闭') h.ui.update({ open: false })
    else h.ui.destroy()
    h.reject(new Error('断网'))
    await settle()
    expect(onError).not.toHaveBeenCalled()
    expect(h.host.childNodes).toHaveLength(0)
  })

  it('保存提示及修订面板支持非 open 可见条件', async () => {
    const h = fixture(state => state.notice || state.items?.length)
    h.ui.update({ items: [] })
    await settle()
    expect(h.loader).not.toHaveBeenCalled()
    h.ui.update({ notice: '已保存' })
    h.resolve(h.api)
    await settle()
    expect(h.instance.update).toHaveBeenCalledWith({ items: [], notice: '已保存' })
  })
})
