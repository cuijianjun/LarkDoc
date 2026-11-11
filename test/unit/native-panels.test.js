import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'fs'
import documentSearchMixin, { captureDocumentSearchScope, nativePanelSurface } from '../../src/components/lark-doc/editor/documentSearchMixin'
import { openCommentDocumentTarget } from '../../src/components/lark-doc/editor/commentPanelView'

vi.mock('../../src/components/lark-doc/editor/commentPanelView', () => ({ openCommentDocumentTarget: vi.fn() }))
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const page = id => ({ kind: 'page', docId: id, displayName: `文档 ${id}` })
const result = (...ids) => ({ tenantId: 'tenant', docId: 'source', items: ids.map(page) })

function sessionFixture(provider, kind = 'authorization') {
  const events = new Map(), providers = { [kind]: provider }
  const session = { documentId: 'source', user: { id: 'alice' }, _privateIdentityGeneration: 1, _identityGeneration: 1, _authorizationGeneration: 1,
    allowed: true, can() { return this.allowed }, getProvider: name => providers[name],
    on(name, fn) { if (!events.has(name)) events.set(name, new Set()); events.get(name).add(fn); return () => events.get(name).delete(fn) },
    emit(name, value) { for (const fn of events.get(name) || []) fn(value) },
  }
  return { session, providers, events }
}
function methods(vm, source) { for (const [key, fn] of Object.entries(source.methods)) vm[key] = fn.bind(vm); return vm }
function searchFixture(provider = { searchDocuments: vi.fn(async() => result('a')) }) {
  const context = sessionFixture(provider), ed = { session: context.session, nativeScopeValid: true }
  const vm = methods({ ...documentSearchMixin.data(), ed, visible: true, $refs: { searchInput: {} }, $emit: vi.fn(), $nextTick: fn => fn() }, documentSearchMixin)
  return { ...context, ed, vm, provider }
}
function component(name, imports = {}) {
  const source = readFileSync(new URL(`../../src/components/lark-doc/${name}.vue`, import.meta.url), 'utf8')
  const script = source.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/^import .*$/gm, '').replace('export default', 'return')
  return new Function(...Object.keys(imports), script)(...Object.values(imports))
}
const notification = component('NotificationPanel', { nativePanelSurface })
const cloudSearch = component('CloudDocumentSearch', { LarkDocIcon: {}, nativePanelSurface, documentSearchMixin })
const overlays = component('editor/LarkDocOverlays', Object.fromEntries(['CommentPanel', 'VersionPanel', 'SaveVersionDialog', 'SharePopover', 'ExportDialog', 'LarkDocIcon', 'CloudDocumentSearch', 'NotificationPanel'].map(key => [key, {}])))
function notificationFixture(provider = { markAllRead: vi.fn(async() => ({})), queryOperation: vi.fn(async() => ({})) }) {
  const context = sessionFixture(provider, 'notifications')
  let publish
  const stop = vi.fn(), session = context.session
  session.subscribeNotifications = vi.fn(fn => { publish = fn; return stop })
  session.refreshNotifications = vi.fn(async() => ({})); session.loadMoreNotifications = vi.fn(async() => ({}))
  session.markNotificationRead = vi.fn(async() => ({})); session.setNotificationsMuted = vi.fn(async() => ({})); session.openNotificationThread = vi.fn(async() => ({ target: { threadId: 'thread' } }))
  const vm = methods({ ...notification.data(), session, visible: false, contextCurrent: () => true, $emit: vi.fn() }, notification)
  for (const [key, fn] of Object.entries(notification.computed)) Object.defineProperty(vm, key, { get: fn.bind(vm) })
  vm.bindSession()
  const snapshot = extra => ({ status: 'ready', connection: 'connected', unreadCount: 1, items: [{ notificationId: 'n1', threadId: 'thread', type: 'mention', read: false, readRevision: '1' }], preference: { muted: false, preferenceRevision: '1' }, ...extra })
  return { ...context, session, vm, provider, stop, snapshot, publish: value => publish(value) }
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks() })

describe('独立云文档搜索状态', () => {
  it('空查询真实读取；结果为独立元数据副本，没有最近访问假数据', async() => {
    const raw = result('a'), { vm, provider } = searchFixture({ searchDocuments: vi.fn(async() => raw) })
    await vm.searchDocumentsNow()
    expect(provider.searchDocuments).toHaveBeenCalledWith({ query: '' }); expect(vm.results).toEqual(raw.items)
    vm.results[0].displayName = 'local'; expect(raw.items[0].displayName).toBe('文档 a')
  })
  it('后发查询先返回，早响应不覆盖；旧错误不覆盖新结果', async() => {
    const first = deferred(), second = deferred(), provider = { searchDocuments: vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise) }
    const { vm } = searchFixture(provider)
    vm.query = 'old'; const old = vm.searchDocumentsNow(); vm.query = 'new'; const latest = vm.searchDocumentsNow()
    second.resolve(result('new')); await latest; first.reject(Error('offline')); await old
    expect(vm.results).toEqual([page('new')]); expect(vm.searchStatus).toBe('ready'); expect(vm.searchMessage).toBe('')
  })
  it('查询变动立即清旧结果，连续输入只在debounce后读取最后查询', async() => {
    vi.useFakeTimers(); const { vm, provider } = searchFixture()
    await vm.searchDocumentsNow(); provider.searchDocuments.mockClear()
    vm.query = 'a'; documentSearchMixin.watch.query.call(vm)
    expect(vm.results).toEqual([])
    vm.query = 'ab'; documentSearchMixin.watch.query.call(vm)
    expect(provider.searchDocuments).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(180)
    expect(provider.searchDocuments).toHaveBeenCalledOnce(); expect(provider.searchDocuments).toHaveBeenCalledWith({ query: 'ab' })
  })
  it.each(['identityABA', 'privateABA', 'authABA', 'providerABA', 'document', 'session', 'denied', 'retired', 'destroy'])('搜索迟响应在 %s 后不回填', async boundary => {
    const gate = deferred(), { vm, ed, session, providers } = searchFixture({ searchDocuments: vi.fn(() => gate.promise) })
    const pending = vm.searchDocumentsNow()
    if (boundary === 'identityABA') { session.user.id = 'bob'; session._identityGeneration++; session.user.id = 'alice'; session._identityGeneration++ }
    if (boundary === 'privateABA') session._privateIdentityGeneration += 2
    if (boundary === 'authABA') session._authorizationGeneration += 2
    if (boundary === 'providerABA') { const old = providers.authorization; providers.authorization = {}; session._authorizationGeneration++; providers.authorization = old; session._authorizationGeneration++ }
    if (boundary === 'document') session.documentId = 'other'
    if (boundary === 'session') ed.session = { ...session }
    if (boundary === 'denied') session.allowed = false
    if (boundary === 'retired') ed.nativeScopeValid = false
    if (boundary === 'destroy') documentSearchMixin.beforeDestroy.call(vm)
    gate.resolve(result('secret')); await pending
    expect(vm.results).toEqual([]); expect(vm.$emit).not.toHaveBeenCalled()
  })
  it('正文协作编辑不会使已读查询失效；没有服务或当前权限时不调用', async() => {
    const { ed, session, provider } = searchFixture(), scope = captureDocumentSearchScope(ed)
    session.state = { epoch: '1', lastSeq: '900' }; expect(scope.current()).toBe(true)
    session.allowed = false; expect(captureDocumentSearchScope(ed)).toBeNull(); expect(provider.searchDocuments).not.toHaveBeenCalled()
  })
  it('失败可显式重试，关闭清查询/结果/待发timer，不暗重发', async() => {
    vi.useFakeTimers(); const provider = { searchDocuments: vi.fn().mockRejectedValueOnce(Error('offline')).mockResolvedValue(result('ok')) }, { vm } = searchFixture(provider)
    await vm.searchDocumentsNow(); expect(vm.searchStatus).toBe('error')
    await vm.searchDocumentsNow(); expect(vm.results).toEqual([page('ok')])
    vm.query = 'pending'; documentSearchMixin.watch.query.call(vm)
    vm.visible = false; documentSearchMixin.watch.visible.call(vm, false)
    await vi.runAllTimersAsync()
    expect(provider.searchDocuments).toHaveBeenCalledTimes(2); expect(vm.query).toBe(''); expect(vm.results).toEqual([])
  })
  it('候选键盘循环；IME Enter不导航，普通Enter只打开选中受权项', async() => {
    const { vm } = searchFixture(); vm.$refs.surface = { querySelector: () => null }
    await vm.searchDocumentsNow()
    const key = name => ({ key: name, preventDefault: vi.fn() })
    vm.searchKeydown(key('ArrowUp')); expect(vm.activeResult).toBe(0)
    vm.composingSearch = true; vm.searchKeydown(key('Enter')); expect(openCommentDocumentTarget).not.toHaveBeenCalled()
    vm.composingSearch = false; openCommentDocumentTarget.mockResolvedValue(true)
    await vm.openDocumentResult(vm.results[0]); expect(openCommentDocumentTarget).toHaveBeenCalledWith(vm.ed, 'a'); expect(vm.$emit).toHaveBeenCalledWith('close', true)
    await vm.openDocumentResult(page('forged')); expect(openCommentDocumentTarget).toHaveBeenCalledTimes(1)
  })
  it('未配置导航只显示失败；异步导航回执过期不能关闭新面板', async() => {
    const { vm, session } = searchFixture(); await vm.searchDocumentsNow()
    openCommentDocumentTarget.mockResolvedValueOnce(false)
    await vm.openDocumentResult(vm.results[0]); expect(vm.searchMessage).toBe('暂时无法打开该文档。')
    const gate = deferred(); openCommentDocumentTarget.mockReturnValueOnce(gate.promise)
    const opening = vm.openDocumentResult(vm.results[0]); session._privateIdentityGeneration++; gate.resolve(true); await opening
    expect(vm.$emit).not.toHaveBeenCalled()
  })
  it('组合输入在旧身份/旧input结束时清旧query，不跨身份提交', async() => {
    const { vm, session, provider } = searchFixture(), input = vm.$refs.searchInput
    vm.searchCompositionStart({ target: input }); vm.query = '旧输入'; session._privateIdentityGeneration++
    vm.searchCompositionEnd({ target: input }); expect(vm.query).toBe(''); expect(provider.searchDocuments).not.toHaveBeenCalled()
    vm.searchCompositionStart({ target: input }); vm.$refs.searchInput = {}; vm.query = 'detached'
    vm.searchCompositionEnd({ target: input }); expect(vm.query).toBe(''); expect(provider.searchDocuments).not.toHaveBeenCalled()
  })
})

describe('通知受权投影与原操作', () => {
  it('关闭面板仍只订阅一次transport，不自动标已读/静音/全部已读，静默连接不展示技术状态', async() => {
    const { vm, session, provider, publish, snapshot } = notificationFixture()
    publish(snapshot()); vm.publishStatus()
    expect(session.subscribeNotifications).toHaveBeenCalledOnce(); expect(vm.connectionLabel).toBe('')
    expect(vm.$emit).toHaveBeenCalledWith('status', { available: true, unreadCount: 1 })
    expect(session.markNotificationRead).not.toHaveBeenCalled(); expect(session.setNotificationsMuted).not.toHaveBeenCalled(); expect(provider.markAllRead).not.toHaveBeenCalled()
    await vm.openThread(vm.projection.items[0])
    expect(session.openNotificationThread).toHaveBeenCalledWith('n1'); expect(session.markNotificationRead).not.toHaveBeenCalled()
  })
  it('全部已读显式调用唯一原provider；不将回执items覆盖SSE新通知', async() => {
    const gate = deferred(), provider = { markAllRead: vi.fn(() => gate.promise), queryOperation: vi.fn() }, { vm, publish, snapshot } = notificationFixture(provider)
    publish(snapshot()); const pending = vm.markAllRead(); expect(provider.markAllRead).toHaveBeenCalledWith({})
    publish(snapshot({ unreadCount: 2, items: [{ notificationId: 'new', read: false }] }))
    gate.resolve({ items: [], unreadCount: 0 }); await pending
    expect(vm.projection.items[0].notificationId).toBe('new'); expect(vm.projection.unreadCount).toBe(2)
  })
  it('unknown只查询原键，阻再次all-read/单条/静音；确认后才解锁', async() => {
    const provider = { markAllRead: vi.fn(async() => { throw Object.assign(Error('lost'), { status: 'unknown', operationId: 'all-original' }) }), queryOperation: vi.fn(async() => ({})) }
    const { vm, publish, snapshot, session } = notificationFixture(provider); publish(snapshot())
    await vm.markAllRead(); expect(vm.pendingOperation).toBe('all-original'); expect(vm.message).toBe('结果待确认，可重试查询')
    await vm.markAllRead(); await vm.read(vm.projection.items[0]); await vm.mute()
    expect(provider.markAllRead).toHaveBeenCalledOnce(); expect(session.markNotificationRead).not.toHaveBeenCalled(); expect(session.setNotificationsMuted).not.toHaveBeenCalled()
    await vm.queryOriginal(); expect(provider.queryOperation).toHaveBeenCalledWith('all-original'); expect(vm.pendingOperation).toBe('')
  })
  it('切换provider保旧unknown原键；查询只到原provider并刷新新投影', async() => {
    const first = { markAllRead: vi.fn(async() => { throw Object.assign(Error('lost'), { status: 'unknown', operationId: 'original' }) }), queryOperation: vi.fn(async() => ({})) }
    const { vm, providers, session, publish, snapshot } = notificationFixture(first); publish(snapshot()); await vm.markAllRead()
    const second = { queryOperation: vi.fn() }; providers.notifications = second; session.emit('notifications-provider')
    await vm.queryOriginal(); expect(first.queryOperation).toHaveBeenCalledWith('original'); expect(second.queryOperation).not.toHaveBeenCalled(); expect(session.refreshNotifications).toHaveBeenCalledOnce()
  })
  it('原键查询仍未知不解锁写，迟查询回执不能清下一身份的新原键', async() => {
    const query = deferred(), provider = { markAllRead: vi.fn(async() => { throw Object.assign(Error('lost'), { status: 'unknown', operationId: 'original' }) }), queryOperation: vi.fn().mockRejectedValueOnce(Error('offline')).mockReturnValueOnce(query.promise) }
    const { vm, session, publish, snapshot } = notificationFixture(provider); publish(snapshot()); await vm.markAllRead()
    await vm.queryOriginal(); expect(vm.pendingOperation).toBe('original'); expect(vm.message).toBe('结果待确认，可重试查询')
    const pending = vm.queryOriginal(); session._privateIdentityGeneration++; vm.retireIdentity()
    vm.pendingOperation = 'new-identity'; vm._pendingNotificationProvider = {}; vm.message = 'new'
    query.resolve({}); await pending
    expect(vm.pendingOperation).toBe('new-identity'); expect(vm.message).toBe('new'); expect(provider.markAllRead).toHaveBeenCalledOnce()
  })
  it('单条read与静音保原CAS；路由退役即拒绝动作，不等下一DOM更新', async() => {
    const { vm, session, publish, snapshot, provider } = notificationFixture(); publish(snapshot())
    await vm.read(vm.projection.items[0]); await vm.mute()
    expect(session.markNotificationRead).toHaveBeenCalledWith({ notificationId: 'n1', value: true, expectedRevision: '1' })
    expect(session.setNotificationsMuted).toHaveBeenCalledWith({ value: true, expectedRevision: '1' })
    expect(vm.projection.items[0].read).toBe(false); expect(vm.projection.preference.muted).toBe(false)
    vm.contextCurrent = () => false; await vm.markAllRead(); await vm.openThread(vm.projection.items[0])
    expect(provider.markAllRead).not.toHaveBeenCalled(); expect(session.openNotificationThread).not.toHaveBeenCalled()
  })
  it.each(['identity', 'session', 'document', 'destroy'])('迟unknown与错误在 %s 后不回填', async boundary => {
    const gate = deferred(), { vm, session, publish, snapshot } = notificationFixture({ markAllRead: vi.fn(() => gate.promise) })
    publish(snapshot()); const pending = vm.markAllRead()
    if (boundary === 'identity') { session._privateIdentityGeneration++; session.emit('notifications-identity') }
    if (boundary === 'session') { vm.session = { ...session }; vm.bindSession() }
    if (boundary === 'document') session.documentId = 'other'
    if (boundary === 'destroy') notification.beforeDestroy.call(vm)
    gate.reject(Object.assign(Error('lost'), { status: 'unknown', operationId: 'old' })); await pending
    expect(vm.pendingOperation).toBe(''); expect(vm.message).toBe('')
  })
  it('撤权立即清投影/计数/浮层；恢复只重新绑定当前transport', () => {
    const { vm, session, publish, snapshot, stop } = notificationFixture(); publish(snapshot())
    session.allowed = false; session._authorizationGeneration++; session.emit('capabilities')
    expect(vm.projection.items).toEqual([]); expect(vm.projection.unreadCount).toBeNull(); expect(stop).toHaveBeenCalled(); expect(vm.$emit).toHaveBeenCalledWith('close', false)
    vm.publishStatus(); expect(vm.$emit).toHaveBeenCalledWith('status', { available: false, unreadCount: null })
    session.allowed = true; session.emit('capabilities'); expect(session.subscribeNotifications).toHaveBeenCalledTimes(2)
  })
  it('旧refresh/openThread拒绝不污染新身份，所有session listeners成对清理', async() => {
    const { vm, session, events, publish, snapshot, stop } = notificationFixture(); publish(snapshot())
    const read = deferred(), open = deferred(); session.refreshNotifications.mockReturnValue(read.promise); session.openNotificationThread.mockReturnValue(open.promise)
    const refreshing = vm.refresh(), opening = vm.openThread(vm.projection.items[0])
    session._privateIdentityGeneration++; session.emit('notifications-identity'); vm.$emit.mockClear()
    read.reject(Error('old')); open.reject(Error('old')); await Promise.all([refreshing, opening])
    expect(vm.message).toBe(''); expect(vm.$emit).not.toHaveBeenCalled()
    notification.beforeDestroy.call(vm); expect(stop).toHaveBeenCalled(); expect([...events.values()].every(listeners => listeners.size === 0)).toBe(true)
  })
  it('旧finally不能解锁下一身份正在执行的操作', async() => {
    const old = deferred(), current = deferred(), provider = { markAllRead: vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise) }
    const { vm, session, publish, snapshot } = notificationFixture(provider); publish(snapshot())
    const first = vm.markAllRead(); session._privateIdentityGeneration++; vm.retireIdentity(); vm.bindTransport(); publish(snapshot())
    const second = vm.markAllRead(); old.resolve({}); await first; expect(vm.busy).toBe(true)
    current.resolve({}); await second; expect(vm.busy).toBe(false)
  })
})

describe('原生搜索模态与通知稳定空态', () => {
  function modalFixture(width = 1000, height = 723, offsetLeft = 0, offsetTop = 0) {
    const viewport = { width, height, offsetLeft, offsetTop }
    vi.stubGlobal('window', { visualViewport: viewport })
    vi.stubGlobal('document', { documentElement: { clientWidth: width, clientHeight: height }, activeElement: null })
    const anchor = { isConnected: true, getBoundingClientRect: () => ({ left: offsetLeft + 20, right: offsetLeft + 40, top: offsetTop + 20, bottom: offsetTop + 40 }) }
    const surface = { focus: vi.fn(), querySelectorAll: vi.fn(() => []) }
    const vm = methods({ ...cloudSearch.data(), visible: true, anchor: () => anchor, $refs: { surface }, $emit: vi.fn() }, cloudSearch)
    return { vm, viewport, anchor, surface }
  }
  it('1000×723搜索居中540×603，上下各60；高视口最大630', () => {
    const { vm, viewport } = modalFixture()
    vm.positionNativeSurface()
    expect(vm.nativeSurfaceStyle).toEqual({ position: 'fixed', left: '230px', top: '60px', width: '540px', height: '603px', maxHeight: '603px' })
    viewport.width = 1440; viewport.height = 1080; vm.positionNativeSurface()
    expect(vm.nativeSurfaceStyle.left).toBe('450px'); expect(vm.nativeSurfaceStyle.top).toBe('225px'); expect(vm.nativeSurfaceStyle.height).toBe('630px')
  })
  it('visualViewport偏移和小屏收缩，不使用顶栏锚点的y；锚点退休仍关闭', () => {
    const { vm, viewport, anchor } = modalFixture(360, 600, 24, 100)
    vm.positionNativeSurface()
    expect(vm.nativeSurfaceStyle).toEqual({ position: 'fixed', left: '32px', top: '160px', width: '344px', height: '480px', maxHeight: '480px' })
    viewport.height = 150; vm.positionNativeSurface(); expect(vm.nativeSurfaceStyle.top).toBe('108px'); expect(vm.nativeSurfaceStyle.height).toBe('134px')
    anchor.isConnected = false; vm.positionNativeSurface(); expect(vm.$emit).toHaveBeenCalledWith('close', false)
  })
  it('Tab与Shift+Tab在可见控件首尾循环，普通中间Tab保浏览器顺序', () => {
    const { vm, surface } = modalFixture(), first = { focus: vi.fn(), getClientRects: () => [{}] },
      middle = { focus: vi.fn(), getClientRects: () => [{}] }, last = { focus: vi.fn(), getClientRects: () => [{}] },
      hidden = { focus: vi.fn(), getClientRects: () => [] }
    surface.querySelectorAll.mockReturnValue([first, middle, last, hidden])
    const key = shiftKey => ({ key: 'Tab', shiftKey, preventDefault: vi.fn(), stopPropagation: vi.fn() })
    document.activeElement = first; const back = key(true); vm.nativeSurfaceKeydown(back)
    expect(back.preventDefault).toHaveBeenCalledOnce(); expect(last.focus).toHaveBeenCalledWith({ preventScroll: true })
    document.activeElement = last; const forward = key(false); vm.nativeSurfaceKeydown(forward)
    expect(forward.preventDefault).toHaveBeenCalledOnce(); expect(first.focus).toHaveBeenCalledWith({ preventScroll: true }); expect(hidden.focus).not.toHaveBeenCalled()
    document.activeElement = middle; const normal = key(false); vm.nativeSurfaceKeydown(normal); expect(normal.preventDefault).not.toHaveBeenCalled()
    surface.querySelectorAll.mockReturnValue([]); const empty = key(false); vm.nativeSurfaceKeydown(empty)
    expect(empty.preventDefault).toHaveBeenCalledOnce(); expect(surface.focus).toHaveBeenCalledWith({ preventScroll: true })
  })
  it('搜索仍沿原Esc返焦意图，IME Esc不关闭；通知保持非模态outside退出', () => {
    const { vm } = modalFixture(), key = extra => ({ key: 'Escape', preventDefault: vi.fn(), stopPropagation: vi.fn(), ...extra })
    vm.nativeSurfaceKeydown(key({ isComposing: true })); expect(vm.$emit).not.toHaveBeenCalled()
    vm.nativeSurfaceKeydown(key({})); expect(vm.$emit).toHaveBeenCalledWith('close', true)
    const search = readFileSync(new URL('../../src/components/lark-doc/CloudDocumentSearch.vue', import.meta.url), 'utf8').split('<script>')[0]
    expect(search).toContain('aria-modal="true"')
    const panel = readFileSync(new URL('../../src/components/lark-doc/NotificationPanel.vue', import.meta.url), 'utf8').split('<script>')[0]
    expect(panel).not.toContain('aria-modal="true"'); expect(panel).not.toContain('lark-doc-notification-close')
    expect(notification.data().nativePanelHeight).toBe(552)
  })
  it('通知空态使用实证静态120px插画与完整文案，无脚本或远端资产', () => {
    const source = readFileSync(new URL('../../src/components/lark-doc/NotificationPanel.vue', import.meta.url), 'utf8')
    const illustration = source.match(/class="lark-doc-notification-empty">([\s\S]*?)<strong>/)[1]
    expect(illustration).toContain('width="120" height="120"'); expect(illustration).toContain('M103.587 73.962V64')
    expect(illustration).not.toMatch(/<(?:script|foreignObject|image|use)\b|\bon[a-z]+\s*=|\b(?:href|src)\s*=/i)
    expect(source).toContain('当有人在当前文档提及你，评论你编辑的内容，或回复了你的评论，你将在这里收到通知')
  })
})

describe('浮层定位/退出与导航父级', () => {
  it('没有通知provider时身份换代仍关闭云搜索；父事件listeners成对清理', () => {
    const { session, events } = sessionFixture({ searchDocuments: vi.fn() })
    const ed = { session, nativeScopeValid: true, nativePanel: '', _nativePanelAnchor: null }, vm = methods({ ed }, overlays)
    vm.bindNativeSession(); expect(ed.nativeSearchAvailable).toBe(true)
    ed.nativePanel = 'search'; session.user.id = 'bob'; session._privateIdentityGeneration++; session.emit('comments-reset', 'identity-changed')
    expect(ed.nativePanel).toBe(''); expect(ed._nativePanelAnchor).toBeNull()
    overlays.beforeDestroy.call(vm); expect([...events.values()].every(listeners => listeners.size === 0)).toBe(true)
  })
  it('窄视窗限定宽高；外部focus/点击关闭，Esc返焦意图；所有事件成对移除', () => {
    const docEvents = new Map(), winEvents = new Map(), viewportEvents = new Map(), observer = { observe: vi.fn(), disconnect: vi.fn() }
    const surface = { contains: target => target === 'inside', scrollHeight: 555, focus: vi.fn() }
    const anchor = { isConnected: true, contains: target => target === 'anchor', getBoundingClientRect: () => ({ left: 330, right: 350, width: 20, top: 20, bottom: 40 }) }
    const listen = map => ({ addEventListener: vi.fn((name, fn) => map.set(name, fn)), removeEventListener: vi.fn((name, fn) => { if (map.get(name) === fn) map.delete(name) }) })
    const doc = { ...listen(docEvents), documentElement: { clientWidth: 360, clientHeight: 600 } }
    const viewport = { ...listen(viewportEvents), width: 360, height: 600, offsetLeft: 0, offsetTop: 0 }
    const win = { ...listen(winEvents), visualViewport: viewport }
    vi.stubGlobal('document', doc); vi.stubGlobal('window', win); vi.stubGlobal('ResizeObserver', function() { return observer })
    const vm = methods({ visible: true, anchor: () => anchor, $refs: { surface }, $emit: vi.fn(), nativePanelWidth: 402, nativePanelHeight: 555 }, nativePanelSurface)
    vm.startNativeSurface(); expect(vm.nativeSurfaceStyle.width).toBe('344px'); expect(vm.nativeSurfaceStyle.left).toBe('8px'); expect(surface.focus).toHaveBeenCalled()
    docEvents.get('pointerdown')({ target: 'inside' }); expect(vm.$emit).not.toHaveBeenCalled()
    docEvents.get('pointerdown')({ target: 'anchor' }); expect(vm.$emit).not.toHaveBeenCalled()
    docEvents.get('pointerdown')({ target: 'shadow-host', composedPath: () => [surface] }); expect(vm.$emit).not.toHaveBeenCalled()
    expect(docEvents.has('keydown')).toBe(true)
    docEvents.get('keydown')({ key: 'Escape', target: 'body-after-disabled-button', preventDefault: vi.fn(), stopPropagation: vi.fn() }); expect(vm.$emit).toHaveBeenCalledWith('close', true)
    vm.$emit.mockClear(); docEvents.get('keydown')({ key: 'Escape', isComposing: true }); expect(vm.$emit).not.toHaveBeenCalled()
    docEvents.get('focusin')({ target: 'outside' }); expect(vm.$emit).toHaveBeenCalledWith('close', false)
    vm.nativeSurfaceKeydown({ key: 'Escape', preventDefault: vi.fn(), stopPropagation: vi.fn() }); expect(vm.$emit).toHaveBeenCalledWith('close', true)
    nativePanelSurface.beforeDestroy.call(vm); expect(observer.disconnect).toHaveBeenCalledOnce(); expect(docEvents.size).toBe(0); expect(winEvents.size).toBe(0); expect(viewportEvents.size).toBe(0)
    vm.startNativeSurface(); expect(docEvents.size).toBe(0)
  })
  it('通知目标读取后重新核当前父session/评论provider，撤权不激活旧thread', async() => {
    const gate = deferred(), { session, providers } = sessionFixture({}, 'comments')
    const ed = { session, nativeScopeValid: true, loadComments: vi.fn(() => gate.promise), commentThreads: [{ id: 'thread' }], activateComment: vi.fn(), scrollCommentIntoView: vi.fn() }
    const vm = methods({ ed }, overlays)
    const opening = vm.openNotificationThread({ target: { threadId: 'thread' } }, () => true)
    providers.comments = {}; session._privateIdentityGeneration++; gate.resolve(); await opening
    expect(ed.activateComment).not.toHaveBeenCalled()
  })
  it('hiddenHeader fallback与顶栏共享一个panel状态；关闭按意图返焦，不改变正文或评论草稿', () => {
    const anchor = { isConnected: true, focus: vi.fn() }, ed = { nativePanel: 'notifications', _nativePanelAnchor: anchor, commentDocumentDraft: 'draft', editor: { state: { doc: 'unchanged' } } }
    const vm = methods({ ed }, overlays)
    vm.closeNativePanel(true)
    expect(anchor.focus).toHaveBeenCalledWith({ preventScroll: true }); expect(ed.nativePanel).toBe(''); expect(ed._nativePanelAnchor).toBeNull(); expect(ed.commentDocumentDraft).toBe('draft'); expect(ed.editor.state.doc).toBe('unchanged')
  })
})
