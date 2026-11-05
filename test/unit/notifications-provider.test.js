import { describe, expect, it, vi } from 'vitest'
import { createNotificationsProvider, NOTIFICATION_METHODS } from '../../src/providers/notifications'
import * as providers from '../../src/providers'
import { createDocumentSession } from '../../src/session/DocumentSession'

function hostProvider() {
  return {
    list: vi.fn(async () => []),
    markAllRead: vi.fn(async () => undefined),
    setMuted: vi.fn(async () => undefined),
  }
}

describe('可选 notifications Provider', () => {
  it('通过现有 providers 出口公开工厂与必需方法', () => {
    expect(NOTIFICATION_METHODS).toEqual(['list', 'markAllRead', 'setMuted'])
    expect(providers.createNotificationsProvider).toBe(createNotificationsProvider)
    expect(providers.NOTIFICATION_METHODS).toBe(NOTIFICATION_METHODS)
  })

  it('未配置时返回 null，不要求既有 Session 接入通知服务', async () => {
    expect(createNotificationsProvider()).toBeNull()
    expect(createNotificationsProvider(null)).toBeNull()
    const session = createDocumentSession()
    expect(session.getProvider('notifications')).toBeNull()
    await session.dispose()
  })

  it.each(['list', 'markAllRead', 'setMuted'])('缺失或非函数的 %s 在工厂及 Session 构造时拒绝', (method) => {
    for (const value of [undefined, true]) {
      const provider = { ...hostProvider(), [method]: value }
      const message = `notifications Provider 缺少方法：${method}`
      expect(() => createNotificationsProvider(provider)).toThrow(message)
      expect(() => createDocumentSession({ providers: { notifications: provider } })).toThrow(message)
    }
  })

  it('一次报告全部缺失方法', () => {
    expect(() => createNotificationsProvider({})).toThrow('notifications Provider 缺少方法：list, markAllRead, setMuted')
  })

  it('不要求 subscribe，保留原对象和必需方法身份', () => {
    const provider = hostProvider()
    const methods = [provider.list, provider.markAllRead, provider.setMuted]
    expect(createNotificationsProvider(provider)).toBe(provider)
    expect([provider.list, provider.markAllRead, provider.setMuted]).toEqual(methods)
    expect(provider.subscribe).toBeUndefined()
  })

  it('保留方法 this、上下文、Promise 及可选订阅的取消函数', async () => {
    const context = { documentId: 'doc-1', user: { id: 'user-1' } }
    const items = [{ id: 'notice-1', title: '通知', readAt: null }]
    const result = Promise.resolve(items)
    const unsubscribe = vi.fn()
    const listener = vi.fn()
    const provider = {
      list: vi.fn(function (ctx) {
        expect(this).toBe(provider)
        expect(ctx).toBe(context)
        return result
      }),
      markAllRead: vi.fn(function (ctx) {
        expect(this).toBe(provider)
        expect(ctx).toBe(context)
        return result
      }),
      setMuted: vi.fn(function (muted, ctx) {
        expect(this).toBe(provider)
        expect(muted).toBe(true)
        expect(ctx).toBe(context)
        return result
      }),
      subscribe: vi.fn(function (callback, ctx) {
        expect(this).toBe(provider)
        expect(callback).toBe(listener)
        expect(ctx).toBe(context)
        return unsubscribe
      }),
    }
    const session = createDocumentSession({ providers: { notifications: provider } })
    const registered = session.getProvider('notifications')
    expect(registered).toBe(provider)
    expect(registered.list(context)).toBe(result)
    expect(registered.markAllRead(context)).toBe(result)
    expect(registered.setMuted(true, context)).toBe(result)
    expect(registered.subscribe(listener, context)).toBe(unsubscribe)
    expect(registered.subscribe).toBe(provider.subscribe)
    expect(await result).toBe(items)
    unsubscribe()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it.each(['list', 'markAllRead', 'setMuted'])('%s 的异步失败原样交给调用方，不伪造成功', async (method) => {
    const error = new Error('宿主通知服务失败')
    const provider = hostProvider()
    provider[method] = vi.fn(async () => { throw error })
    const session = createDocumentSession({ providers: { notifications: provider } })
    const registered = session.getProvider('notifications')
    const context = { documentId: 'doc-1' }
    const pending = method === 'setMuted' ? registered.setMuted(true, context) : registered[method](context)
    await expect(pending).rejects.toBe(error)
  })

  it('不改写宿主拒绝回执、void 成功或同步异常', async () => {
    const context = { documentId: 'doc-1' }
    const receipt = { ok: false, status: 'rejected' }
    const error = new Error('宿主同步拒绝')
    const provider = hostProvider()
    provider.markAllRead = vi.fn(async () => receipt)
    const registered = createDocumentSession({ providers: { notifications: provider } }).getProvider('notifications')
    expect(await registered.markAllRead(context)).toBe(receipt)
    expect(await registered.setMuted(true, context)).toBeUndefined()
    provider.list = vi.fn(() => { throw error })
    expect(() => registered.list(context)).toThrow(error)
  })

  it('构造支持 providers 与顶层快捷字段，并沿用 providers 优先级', () => {
    const shortcut = hostProvider()
    const nested = hostProvider()
    expect(createDocumentSession({ notifications: shortcut }).getProvider('notifications')).toBe(shortcut)
    const session = createDocumentSession({ notifications: shortcut, providers: { notifications: nested } })
    expect(session.getProvider('notifications')).toBe(nested)
  })

  it('运行时替换先校验，失败保留原 Provider，并允许清除', () => {
    const original = hostProvider()
    const replacement = hostProvider()
    const session = createDocumentSession({ providers: { notifications: original } })
    expect(() => session.setProvider('notifications', {})).toThrow('notifications Provider 缺少方法')
    expect(session.getProvider('notifications')).toBe(original)
    expect(session.setProvider('notifications', replacement)).toBe(replacement)
    expect(session.getProvider('notifications')).toBe(replacement)
    expect(session.setProvider('notifications', null)).toBeNull()
    expect(session.getProvider('notifications')).toBeNull()
  })

  it('注册、替换、清除和销毁不自动调用通知方法或接管宿主资源', async () => {
    const original = { ...hostProvider(), subscribe: vi.fn(), dispose: vi.fn(), disconnect: vi.fn() }
    const replacement = { ...hostProvider(), subscribe: vi.fn(), dispose: vi.fn(), disconnect: vi.fn() }
    const session = createDocumentSession({ providers: { notifications: original } })
    await session.connect()
    session.setProvider('notifications', replacement)
    session.setProvider('notifications', null)
    session.setProvider('notifications', replacement)
    await session.dispose()
    await session.dispose()
    for (const provider of [original, replacement]) {
      for (const method of ['list', 'markAllRead', 'setMuted', 'subscribe', 'dispose', 'disconnect']) {
        expect(provider[method]).not.toHaveBeenCalled()
      }
    }
  })
})
