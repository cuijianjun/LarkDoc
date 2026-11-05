import { describe, expect, it, vi } from 'vitest'
import { createNativeOptionsHost } from '../../src/editor/nativeOptionsHost'
import notifyMixin from '../../src/components/lark-doc/editor/notifyMixin'
import { createDocumentSession } from '../../src/session/DocumentSession'
import { clearProviderTasks, getProviderTask } from '../../src/providers/provider-task'

function deferred() {
  let resolve
  let reject
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail })
  return { promise, resolve, reject }
}

function context(provider) {
  const ctx = {
    ...notifyMixin.data(),
    session: createDocumentSession({ documentId: 'doc-1', user: { id: 'u-1' }, notifications: provider }),
    $emit: vi.fn(), error: '',
  }
  Object.assign(ctx, notifyMixin.methods)
  Object.keys(notifyMixin.computed).forEach(key => {
    Object.defineProperty(ctx, key, { get: () => notifyMixin.computed[key].call(ctx) })
  })
  return ctx
}

function host(extra = {}) {
  return {
    list: vi.fn(async () => ({ items: [{ id: 'n-1', readAt: null }], muted: false })),
    markAllRead: vi.fn(async () => undefined),
    setMuted: vi.fn(async () => undefined),
    ...extra,
  }
}

function changeContext(ctx, change) {
  if (change === 'session') ctx.session = createDocumentSession({ notifications: host() })
  if (change === 'document') ctx.session.documentId = 'doc-2'
  if (change === 'account') ctx.session.user = { id: 'u-2' }
  if (change === 'account-id') ctx.session.user.id = 'u-2'
  if (change === 'provider') ctx.session.setProvider('notifications', host())
  if (change === 'permission') ctx.session._capabilities.canView = false
  if (change === 'destroy') notifyMixin.beforeDestroy.call(ctx)
  if (change === 'session-dispose') ctx.session._destroyed = true
}

const changes = ['session', 'document', 'account', 'account-id', 'provider', 'permission', 'destroy', 'session-dispose']

describe('通知 UI 的可选 Provider 接线（不导入 SFC）', () => {
  it('无 Provider 保留宿主注入、本地已读和静音事件', async () => {
    const ctx = context()
    ctx.setNotifications([{ id: 'host', readAt: null }])
    await ctx.bindNotifications()
    await ctx.markAllNotifyRead()
    expect(ctx.notifyItems[0].readAt).toBeTruthy()
    expect(ctx.$emit).toHaveBeenCalledWith('notify-read', { all: true })
    await ctx.toggleNotifyMute()
    expect(ctx.notifyMuted).toBe(true)
    expect(ctx.$emit).toHaveBeenCalledWith('notify-mute', { muted: true })
  })

  it('打开和关闭保持 notify-open 兼容，有 Provider 时打开触发回读', async () => {
    vi.stubGlobal('window', { innerWidth: 1440, innerHeight: 900 })
    try {
      for (const provider of [undefined, host()]) {
        const ctx = context(provider)
        ctx.$nextTick = vi.fn()
        ctx.toggleNotify({ currentTarget: { getBoundingClientRect: () => ({ left: 900, right: 930, top: 20, bottom: 50, width: 30, height: 30 }) } })
        expect(ctx.notifyOpen).toBe(true)
        expect(ctx.$emit).toHaveBeenCalledWith('notify-open')
        if (provider) expect(provider.list).toHaveBeenCalledTimes(1)
        await Promise.resolve()
        ctx.toggleNotify()
        expect(ctx.notifyOpen).toBe(false)
      }
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('读取失败后恢复仍保留未恢复的订阅故障，重新绑定后才清除', async () => {
    const provider = host({
      subscribe: vi.fn(() => { throw new Error('订阅失败') }),
      list: vi.fn().mockRejectedValueOnce(new Error('读取失败')).mockResolvedValue({ items: [] }),
    })
    const ctx = context(provider)
    await ctx.bindNotifications()
    expect(ctx.error).toContain('读取失败')
    await ctx.loadNotifications()
    expect(ctx.notifyLoadError).toBe('')
    expect(ctx.error).toContain('订阅失败')
    expect(ctx.error).toContain('刷新')
    provider.subscribe.mockImplementation(() => () => {})
    await ctx.bindNotifications()
    expect(ctx.error).toBe('')
  })

  it('清除读取错误不覆盖宿主后写入的错误', () => {
    const ctx = context()
    ctx.setNotifyError('订阅失败', 'subscription')
    ctx.setNotifyError('读取失败', 'load')
    ctx.error = '宿主错误'
    ctx.clearNotifyError('load')
    expect(ctx.error).toBe('宿主错误')
    ctx.clearNotifyError()
    expect(ctx.error).toBe('宿主错误')
  })

  it('挂载读取列表与静音快照，Provider 收到原 this 和文档/用户上下文', async () => {
    const provider = host()
    const ctx = context(provider)
    await notifyMixin.mounted.call(ctx)
    expect(ctx.notifyItems).toEqual([{ id: 'n-1', readAt: null }])
    expect(ctx.notifyMuted).toBe(false)
    expect(ctx.notifyLoading).toBe(false)
    expect(provider.list.mock.contexts[0]).toBe(provider)
    expect(provider.list).toHaveBeenCalledWith({ documentId: 'doc-1', user: ctx.session.user })
  })

  it('订阅五类事件均回读，不猜测事件载荷；替换与销毁各释放一次', async () => {
    let listener
    const off = vi.fn()
    const provider = host({ subscribe: vi.fn(callback => { listener = callback; return off }) })
    const ctx = context(provider)
    await ctx.bindNotifications()
    for (const type of ['snapshot', 'upsert', 'remove', 'read', 'mute']) await listener({ type })
    expect(provider.list).toHaveBeenCalledTimes(6)
    ctx.session.setProvider('notifications', host())
    await ctx.bindNotifications()
    expect(off).toHaveBeenCalledTimes(1)
    const calls = provider.list.mock.calls.length
    await listener({ type: 'upsert' })
    expect(provider.list).toHaveBeenCalledTimes(calls)
    notifyMixin.beforeDestroy.call(ctx)
    notifyMixin.beforeDestroy.call(ctx)
    expect(off).toHaveBeenCalledTimes(1)
  })

  it.each(['同步异常', '异步拒绝'])('取消订阅的%s被消费，重复释放不重复调用', async mode => {
    const off = vi.fn(() => {
      if (mode === '同步异常') throw new Error('释放失败')
      return Promise.reject(new Error('释放失败'))
    })
    const ctx = context(host({ subscribe: () => off }))
    await ctx.bindNotifications()
    await expect(ctx.releaseNotifications()).resolves.toBeUndefined()
    expect(ctx.error).toContain('订阅释放失败')
    await ctx.releaseNotifications()
    expect(off).toHaveBeenCalledTimes(1)
  })

  it.each(['同步异常', '异步拒绝'])('订阅期间切换上下文，迟到取消函数的%s不泄漏或污染新提示', async mode => {
    let ctx
    const off = vi.fn(() => {
      if (mode === '同步异常') throw new Error('释放失败')
      return Promise.reject(new Error('释放失败'))
    })
    const provider = host({ subscribe() { ctx.session.documentId = 'doc-2'; return off } })
    ctx = context(provider)
    ctx.error = '当前提示'
    await expect(ctx.bindNotifications()).resolves.toBeNull()
    expect(off).toHaveBeenCalledTimes(1)
    expect(ctx.error).toBe('当前提示')
    expect(provider.list).not.toHaveBeenCalled()
  })

  it('销毁时异步取消订阅失败被消费，不回写错误', async () => {
    const pending = deferred()
    const ctx = context(host({ subscribe: () => () => pending.promise }))
    await ctx.bindNotifications()
    ctx.error = '当前提示'
    notifyMixin.beforeDestroy.call(ctx)
    pending.reject(new Error('释放失败'))
    await Promise.resolve()
    expect(ctx.error).toBe('当前提示')
  })

  it('原生宿主失效通知后重绑文档、账号、Provider，不依赖 Vue 或 SFC', async () => {
    const originalOff = vi.fn()
    const replacementOff = vi.fn()
    const provider = host({ subscribe: () => originalOff })
    const replacement = host({ subscribe: () => replacementOff })
    const session = createDocumentSession({ documentId: 'doc-1', user: { id: 'u-1' }, notifications: provider })
    const runtime = createNativeOptionsHost({
      options: { mixins: [notifyMixin], data: () => ({ error: '' }) },
      state: { sessionInstance: session },
      aliases: { session: { get: (_host, state) => state.sessionInstance } },
    })
    const vm = runtime.host
    try {
      await vm.bindNotifications()
      session.documentId = 'doc-2'
      vm.$forceUpdate()
      await vm.$nextTick()
      await Promise.resolve()
      expect(originalOff).toHaveBeenCalledTimes(1)
      expect(provider.list).toHaveBeenLastCalledWith({ documentId: 'doc-2', user: session.user })
      session.user.id = 'u-2'
      vm.$forceUpdate()
      await vm.$nextTick()
      await Promise.resolve()
      expect(originalOff).toHaveBeenCalledTimes(2)
      session.setProvider('notifications', replacement)
      vm.$forceUpdate()
      await vm.$nextTick()
      await Promise.resolve()
      expect(originalOff).toHaveBeenCalledTimes(3)
      expect(replacement.list).toHaveBeenCalledTimes(1)
      expect(replacement.list).toHaveBeenCalledWith({ documentId: 'doc-2', user: session.user })
    } finally {
      runtime.destroy()
    }
    expect(replacementOff).toHaveBeenCalledTimes(1)
  })

  it('watch 上下文变化重绑；移除 Provider 清除旧通知而允许后续宿主注入', async () => {
    const ctx = context(host())
    await notifyMixin.mounted.call(ctx)
    ctx.session.setProvider('notifications', null)
    await notifyMixin.watch.notifyContext.call(ctx)
    expect(ctx.notifyItems).toEqual([])
    expect(ctx.notifyMuted).toBe(false)
    ctx.setNotifications([{ id: 'host' }])
    await ctx.loadNotifications()
    expect(ctx.notifyItems).toEqual([{ id: 'host' }])
  })

  it.each(changes)('读取期间切换 %s，迟到成功与失败不污染当前状态', async change => {
    for (const fail of [false, true]) {
      const pending = deferred()
      const ctx = context(host({ list: () => pending.promise }))
      const loading = ctx.bindNotifications()
      changeContext(ctx, change)
      ctx.notifyItems = [{ id: 'current' }]
      ctx.error = '当前提示'
      if (fail) pending.reject(new Error('旧请求失败'))
      else pending.resolve([{ id: 'old' }])
      expect(await loading).toBeNull()
      expect(ctx.notifyItems).toEqual([{ id: 'current' }])
      expect(ctx.error).toBe('当前提示')
    }
  })

  it('并发回读后发优先，旧请求不清除新请求 loading', async () => {
    const first = deferred()
    const second = deferred()
    const provider = host({ list: vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise) })
    const ctx = context(provider)
    const oldLoad = ctx.bindNotifications()
    const newLoad = ctx.loadNotifications()
    first.resolve([{ id: 'old' }])
    expect(await oldLoad).toBeNull()
    expect(ctx.notifyLoading).toBe(true)
    second.resolve([{ id: 'new' }])
    await newLoad
    expect(ctx.notifyItems).toEqual([{ id: 'new' }])
    expect(ctx.notifyLoading).toBe(false)
  })

  it('读取中直接调用写入也不发请求或报告成功', async () => {
    const pending = deferred()
    const provider = host({ list: () => pending.promise })
    const ctx = context(provider)
    const loading = ctx.bindNotifications()
    expect(await ctx.writeNotifications('setMuted', true)).toBeNull()
    expect(provider.setMuted).not.toHaveBeenCalled()
    expect(ctx.$emit).not.toHaveBeenCalled()
    pending.resolve([])
    await loading
  })

  it.each(['回读未完成', '回读刚完成'])('写后%s被并发读取替代，不发成功事件', async timing => {
    const provider = host()
    const ctx = context(provider)
    await ctx.bindNotifications()
    const pending = deferred()
    const newer = deferred()
    const started = deferred()
    provider.list.mockImplementationOnce(() => { started.resolve(); return pending.promise })
      .mockImplementationOnce(() => newer.promise)
    const writing = ctx.toggleNotifyMute()
    await started.promise
    let reading
    if (timing === '回读刚完成') {
      // 旧回读已经应用，但写入的 await 尚未恢复时发起新读取。
      pending.promise.then(() => { reading = ctx.loadNotifications() })
    } else {
      reading = ctx.loadNotifications()
    }
    pending.resolve({ items: [], muted: true })
    expect(await writing).toBeNull()
    expect(ctx.$emit).not.toHaveBeenCalled()
    expect(ctx.error).toContain('回读已被新请求替代')
    expect(ctx.notifyLoading).toBe(true)
    newer.reject(new Error('新读取失败'))
    await reading
    expect(ctx.notifyLoadError).toContain('读取失败')
    expect(ctx.notifyEmpty).toBe(false)
  })

  it.each(['markAllRead', 'setMuted'])('%s 等待回执和回读，不乐观伪造成功，重复点击不重发', async method => {
    const pending = deferred()
    const provider = host({ [method]: vi.fn(() => pending.promise) })
    const ctx = context(provider)
    await ctx.bindNotifications()
    provider.list.mockResolvedValue({ items: [{ id: 'n-1', readAt: 123 }], muted: true })
    const action = method === 'markAllRead' ? 'markAllNotifyRead' : 'toggleNotifyMute'
    const writing = ctx[action]()
    expect(ctx.notifyItems[0].readAt).toBeNull()
    expect(ctx.notifyMuted).toBe(false)
    await ctx[action]()
    expect(provider[method]).toHaveBeenCalledTimes(1)
    pending.resolve({ status: 'succeeded' })
    expect(await writing).toBe(true)
    expect(ctx.notifyItems[0].readAt).toBe(123)
    expect(ctx.notifyMuted).toBe(true)
    expect(ctx.notifyWriting).toBe(false)
    expect(ctx.$emit).toHaveBeenCalledWith(method === 'markAllRead' ? 'notify-read' : 'notify-mute', method === 'markAllRead' ? { all: true } : { muted: true })
    expect(provider[method].mock.calls[0]).toEqual(method === 'markAllRead'
      ? [{ documentId: 'doc-1', user: ctx.session.user }]
      : [true, { documentId: 'doc-1', user: ctx.session.user }])
  })

  it('静音回读兼容数组，快照存在 muted 时以快照为准，后续读取不清掉静音', async () => {
    const provider = host({ list: vi.fn(async () => []) })
    const ctx = context(provider)
    await ctx.bindNotifications()
    expect(await ctx.toggleNotifyMute()).toBe(true)
    expect(ctx.notifyMuted).toBe(true)
    await ctx.loadNotifications()
    expect(ctx.notifyMuted).toBe(true)
    provider.list.mockResolvedValue({ items: [], muted: true })
    expect(await ctx.toggleNotifyMute()).toBe(true)
    expect(ctx.notifyMuted).toBe(true)
    expect(ctx.$emit).toHaveBeenLastCalledWith('notify-mute', { muted: true })
  })

  it.each(['queued', 'running', 'partial'])('ProviderTask 的 %s 保留原任务状态但不 emit 完成', async status => {
    const ctx = context(host({ setMuted: async () => ({ status }) }))
    await ctx.bindNotifications()
    expect(await ctx.toggleNotifyMute()).toBeNull()
    expect(getProviderTask(ctx.notifyTaskId).status).toBe(status)
    expect(ctx.$emit).not.toHaveBeenCalled()
  })

  it.each([false, { ok: false }, { allowed: false }, { status: 'deny' }, { status: 'approval_required' }, { code: 403 }, { code: 'E_DENIED' }, { status: 'queued' }, { status: 'running' }, { status: 'partial' }, { status: 'failed' }, { status: 'rolled_back' }])(
    '拒绝或未成功回执 %j 不报告成功，保留失败反馈并回读', async receipt => {
      const provider = host({ setMuted: async () => receipt })
      const ctx = context(provider)
      await ctx.bindNotifications()
      expect(await ctx.toggleNotifyMute()).toBeNull()
      expect(ctx.notifyMuted).toBe(false)
      expect(ctx.error).toContain('通知设置未完成')
      expect(ctx.$emit).not.toHaveBeenCalled()
      expect(provider.list).toHaveBeenCalledTimes(2)
    },
  )

  it.each(['异常', '拒绝', '未完成'])('写入%s立即反馈并结束写入，不等待失败后的回读', async mode => {
    const provider = host({ setMuted: async () => {
      if (mode === '异常') throw new Error('离线')
      return mode === '拒绝' ? false : { status: 'queued' }
    } })
    const ctx = context(provider)
    await ctx.bindNotifications()
    const pending = deferred()
    const started = deferred()
    provider.list.mockImplementationOnce(() => { started.resolve(); return pending.promise })
    const writing = ctx.toggleNotifyMute()
    try {
      await started.promise
      expect(ctx.error).toContain('通知设置未完成')
      expect(ctx.notifyWriting).toBe(false)
      expect(ctx.notifyLoading).toBe(true)
      await expect(Promise.race([writing, Promise.resolve('仍在等待回读')])).resolves.toBeNull()
      expect(ctx.$emit).not.toHaveBeenCalled()
    } finally {
      pending.resolve([])
      await writing
      await Promise.resolve()
    }
    expect(ctx.error).toContain('通知设置未完成')
  })

  it.each(['读取', '写入', '写后回读', '回读被替代'])('%s失败成功恢复时只清理通知自有错误', async mode => {
    for (const hostError of ['', '宿主保存失败']) {
      const provider = host()
      const ctx = context(provider)
      await ctx.bindNotifications()
      if (mode === '回读被替代') {
        const pending = deferred()
        const started = deferred()
        provider.list.mockImplementationOnce(() => { started.resolve(); return pending.promise })
        const writing = ctx.toggleNotifyMute()
        await started.promise
        await ctx.loadNotifications()
        pending.resolve([])
        expect(await writing).toBeNull()
        expect(ctx.error).toContain('回读已被新请求替代')
      } else if (mode === '读取') {
        provider.list.mockRejectedValueOnce(new Error('离线'))
        await ctx.loadNotifications()
      } else {
        if (mode === '写入') provider.setMuted.mockRejectedValueOnce(new Error('离线'))
        else provider.list.mockRejectedValueOnce(new Error('回读失败'))
        await ctx.toggleNotifyMute()
        await Promise.resolve()
      }
      expect(ctx.error).not.toBe('')
      if (hostError) ctx.error = hostError
      if (mode === '写入') expect(await ctx.toggleNotifyMute()).toBe(true)
      else await ctx.loadNotifications()
      expect(ctx.error).toBe(hostError)
    }
  })

  it.each(['document', 'provider', 'permission'])('切换 %s 清理通知错误，不清理无关宿主错误', async change => {
    for (const hostError of ['', '宿主保存失败']) {
      const provider = host({ subscribe() { throw new Error('订阅失败') } })
      const ctx = context(provider)
      await ctx.bindNotifications()
      expect(ctx.error).toContain('订阅失败')
      if (hostError) ctx.error = hostError
      if (change === 'provider') ctx.session.setProvider('notifications', null)
      else changeContext(ctx, change)
      if (change === 'document') provider.subscribe = () => vi.fn()
      await ctx.bindNotifications()
      expect(ctx.error).toBe(hostError)
    }
  })

  it('写入异常写入 ProviderTask 失败状态；回读失败也不会 emit 成功', async () => {
    clearProviderTasks()
    const provider = host({ markAllRead: vi.fn(async () => { throw new Error('离线') }) })
    const ctx = context(provider)
    await ctx.bindNotifications()
    expect(await ctx.markAllNotifyRead()).toBeNull()
    expect(ctx.error).toContain('通知设置未完成')
    expect(getProviderTask(ctx.notifyTaskId).status).toBe('failed')
    provider.markAllRead.mockResolvedValue(undefined)
    provider.list.mockRejectedValue(new Error('回读失败'))
    expect(await ctx.markAllNotifyRead()).toBeNull()
    expect(ctx.error).toContain('回读失败')
    expect(ctx.$emit).not.toHaveBeenCalled()
    expect(ctx.notifyItems[0].readAt).toBeNull()
  })

  it.each(changes)('写入期间切换 %s，不回读新页面、不发旧成功或错误', async change => {
    for (const fail of [false, true]) {
      const pending = deferred()
      const provider = host({ setMuted: () => pending.promise })
      const ctx = context(provider)
      await ctx.bindNotifications()
      const writing = ctx.toggleNotifyMute()
      changeContext(ctx, change)
      ctx.error = '当前提示'
      if (fail) pending.reject(new Error('旧写入失败'))
      else pending.resolve()
      expect(await writing).toBeNull()
      expect(provider.list).toHaveBeenCalledTimes(1)
      expect(ctx.error).toBe('当前提示')
      expect(ctx.$emit).not.toHaveBeenCalled()
    }
  })

  it.each(changes)('写后回读期间切换 %s，不覆盖新页面或发成功事件', async change => {
    const provider = host()
    const ctx = context(provider)
    await ctx.bindNotifications()
    const pending = deferred()
    const started = deferred()
    provider.list.mockImplementation(() => { started.resolve(); return pending.promise })
    const writing = ctx.toggleNotifyMute()
    await started.promise
    changeContext(ctx, change)
    ctx.notifyItems = [{ id: 'current' }]
    pending.resolve({ items: [{ id: 'old' }], muted: true })
    expect(await writing).toBeNull()
    expect(ctx.notifyItems).toEqual([{ id: 'current' }])
    expect(ctx.$emit).not.toHaveBeenCalled()
  })

  it('失去 canView 时释放订阅并清空通知，恢复后重新读取', async () => {
    const off = vi.fn()
    const provider = host({ subscribe: () => off })
    const ctx = context(provider)
    await ctx.bindNotifications()
    ctx.session._capabilities.canView = false
    await ctx.bindNotifications()
    expect(off).toHaveBeenCalledTimes(1)
    expect(ctx.notifyItems).toEqual([])
    expect(provider.list).toHaveBeenCalledTimes(1)
    ctx.session._capabilities.canView = true
    await ctx.bindNotifications()
    expect(provider.list).toHaveBeenCalledTimes(2)
  })

  it.each(['请求失败', '无效列表'])('初次读取%s不能显示成功空态，重试成功后恢复空态', async mode => {
    const provider = host({ list: mode === '请求失败'
      ? vi.fn().mockRejectedValue(new Error('离线'))
      : vi.fn().mockResolvedValue({ items: null }) })
    const ctx = context(provider)
    expect(await ctx.bindNotifications()).toBeNull()
    expect(ctx.notifyLoading).toBe(false)
    expect(ctx.notifyItems).toEqual([])
    expect(ctx.notifyLoadError).toContain('读取失败')
    expect(ctx.notifyEmpty).toBe(false)
    provider.list.mockResolvedValue([])
    await ctx.loadNotifications()
    expect(ctx.notifyLoadError).toBe('')
    expect(ctx.error).toBe('')
    expect(ctx.notifyEmpty).toBe(true)
  })

  it.each([null, {}, { items: null }, [null]].map(result => ({ result })))('无效列表 $result 不冒充成功空态，不覆盖已有数据', async ({ result }) => {
    const provider = host()
    const ctx = context(provider)
    await ctx.bindNotifications()
    const items = ctx.notifyItems
    provider.list.mockResolvedValue(result)
    expect(await ctx.loadNotifications()).toBeNull()
    expect(ctx.notifyItems).toBe(items)
    expect(ctx.error).toContain('读取失败')
    expect(ctx.notifyLoading).toBe(false)
  })

  it('订阅失败提示刷新，单独回读不冒充订阅恢复，重绑成功后清理提示', async () => {
    const provider = host({ subscribe: vi.fn(() => { throw new Error('订阅失败') }) })
    const ctx = context(provider)
    await ctx.bindNotifications()
    expect(ctx.error).toBe('通知订阅失败，请刷新后重试')
    await ctx.loadNotifications()
    expect(provider.subscribe).toHaveBeenCalledTimes(1)
    expect(ctx.error).toBe('通知订阅失败，请刷新后重试')
    provider.subscribe.mockReturnValue(vi.fn())
    await ctx.bindNotifications()
    expect(provider.subscribe).toHaveBeenCalledTimes(2)
    expect(ctx.error).toBe('')
  })

  it('读取或订阅异常由 UI 消费；销毁后不再调用 Provider', async () => {
    const provider = host({ subscribe() { throw new Error('订阅失败') } })
    const ctx = context(provider)
    await ctx.bindNotifications()
    expect(ctx.error).toContain('订阅失败')
    provider.list.mockRejectedValue(new Error('读取失败'))
    expect(await ctx.loadNotifications()).toBeNull()
    expect(ctx.error).toContain('读取失败')
    notifyMixin.beforeDestroy.call(ctx)
    expect(await ctx.loadNotifications()).toBeNull()
    expect(await ctx.toggleNotifyMute()).toBeNull()
    expect(provider.setMuted).not.toHaveBeenCalled()
  })
})
