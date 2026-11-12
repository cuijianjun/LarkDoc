// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createOverlays } from '../../src/ui/overlays'
import { createNotifications } from '../../src/ui/notifications'
import { createCommentPanel, createSaveVersionDialog, createVersionPanel } from '../../src/ui/panels'
import overlaysUiMixin from '../../src/components/lark-doc/editor/overlaysUiMixin'
import notifyMixin from '../../src/components/lark-doc/editor/notifyMixin'
import shareMixin from '../../src/components/lark-doc/editor/shareMixin'
import exportMixin from '../../src/components/lark-doc/editor/exportMixin'
import { createNativeOptionsHost } from '../../src/editor/nativeOptionsHost'
import { createDocumentSession } from '../../src/session/DocumentSession'

const cleanups = []
function hostNode() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  return host
}
afterEach(() => {
  cleanups.splice(0).reverse().forEach(cleanup => cleanup())
  document.body.textContent = ''
  vi.restoreAllMocks()
})
function runtimeFor(session) {
  const host = hostNode()
  const runtime = createNativeOptionsHost({
    options: { mixins: [shareMixin, exportMixin, notifyMixin, overlaysUiMixin] },
    state: { sessionInstance: session, error: '' },
    aliases: { session: { get: (_host, state) => state.sessionInstance } },
    refs: { overlayHost: host },
    emit: vi.fn(),
  })
  cleanups.push(() => { runtime.host.destroyOverlays(); runtime.destroy() })
  runtime.host.mountOverlays()
  return { ...runtime, container: host }
}

describe('原生浮层迁移契约', () => {
  it('通知空态、加载、失败和列表互斥，文本不作为 HTML 执行', () => {
    const host = hostNode()
    const ui = createNotifications({ host })
    cleanups.push(() => ui.destroy())
    const state = { open: true, style: { left: 8, top: 30 }, items: [], empty: true, allReadDisabled: true, muteLabel: '关闭通知' }
    ui.update(state)
    expect(ui.el.getAttribute('role')).toBe('dialog')
    expect(ui.el.getAttribute('aria-label')).toBe('当前文档通知')
    expect(ui.el.querySelector('.lark-doc-notify-loading-nested > .lark-doc-notify-loading-container > .lark-doc-notify-content')).not.toBeNull()
    expect(ui.el.querySelector('.lark-doc-notify-header-desc').textContent).toBe('当前文档通知')
    expect(ui.el.querySelector('.lark-doc-notify-header-bell .lark-doc-icon').style.width).toBe('14px')
    expect(ui.el.querySelector('.lark-doc-notify-empty-img .lark-doc-icon').style.width).toBe('72px')
    expect(ui.el.querySelector('.lark-doc-notify-readall').disabled).toBe(true)
    expect(ui.el.querySelector('.lark-doc-notify-readall').classList.contains('is-disabled')).toBe(true)
    expect(host.textContent).toContain('暂无通知')
    expect(ui.el.style.left).toBe('8px')
    ui.update({ ...state, empty: false, loading: true })
    expect(ui.el.getAttribute('aria-busy')).toBe('true')
    expect(host.textContent).not.toContain('暂无通知')
    expect(host.querySelector('[role="alert"]')).toBeNull()
    ui.update({ ...state, empty: false, loadError: '离线，请重试' })
    expect(host.querySelector('[role="alert"]').textContent).toContain('离线，请重试')
    expect(host.textContent).not.toContain('暂无通知')
    const items = [{ id: 'n1', title: '<img src=x onerror=alert(1)>', body: '正文', readAt: null }]
    ui.update({ ...state, empty: false, items })
    const row = host.querySelector('.lark-doc-notify-item')
    expect(row.textContent).toContain('<img')
    expect(row.querySelector('img')).toBeNull()
    ui.update({ ...state, empty: false, items: [{ ...items[0], readAt: 123 }] })
    expect(host.querySelector('.lark-doc-notify-item')).toBe(row)
    expect(row.classList.contains('is-unread')).toBe(false)
    ui.update({ open: false })
    expect(host.querySelector('.lark-doc-notify-popover')).toBeNull()
  })

  it('通知操作阻止焦点丢失，忙碌时不重复派发', () => {
    const onToggleMute = vi.fn()
    const onMarkAllRead = vi.fn()
    const ui = createNotifications({ host: hostNode(), handlers: { onToggleMute, onMarkAllRead } })
    cleanups.push(() => ui.destroy())
    const state = { open: true, style: { left: 0, top: 0 }, items: [], allReadDisabled: false }
    ui.update(state)
    const mute = ui.el.querySelector('.lark-doc-notify-mute')
    const readAll = ui.el.querySelector('.lark-doc-notify-readall')
    const event = new MouseEvent('mousedown', { cancelable: true })
    mute.dispatchEvent(event)
    readAll.dispatchEvent(new MouseEvent('mousedown'))
    expect(event.defaultPrevented).toBe(true)
    expect(onToggleMute).toHaveBeenCalledTimes(1)
    expect(onMarkAllRead).toHaveBeenCalledTimes(1)
    for (const busy of [{ loading: true }, { writing: true }]) {
      ui.update({ ...state, ...busy, allReadDisabled: true })
      expect(ui.el.getAttribute('aria-busy')).toBe('true')
      expect(mute.disabled).toBe(true)
      expect(readAll.disabled).toBe(true)
      mute.dispatchEvent(new MouseEvent('mousedown'))
      readAll.dispatchEvent(new MouseEvent('mousedown'))
      expect(onToggleMute).toHaveBeenCalledTimes(1)
      expect(onMarkAllRead).toHaveBeenCalledTimes(1)
    }
    ui.update({ ...state, muteLabel: '开启通知' })
    expect(ui.el.getAttribute('aria-busy')).toBe('false')
    expect(mute.textContent).toBe('开启通知')
    expect(mute.disabled).toBe(false)
    expect(readAll.classList.contains('is-disabled')).toBe(false)
  })

  it('原生挂载、宿主注入、测量纠偏和关闭都无需 SFC ref', async () => {
    const runtime = runtimeFor(null)
    const vm = runtime.host
    vm.setNotifications([{ id: 'n1', title: '通知' }])
    vm.toggleNotify({ currentTarget: { getBoundingClientRect: () => ({ left: 700, right: 730, top: 10, bottom: 40, width: 30, height: 30 }) } })
    await vm.$nextTick()
    const el = runtime.container.querySelector('.lark-doc-notify-popover')
    expect(el).toBe(vm._notificationsUi.el)
    const measure = vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ width: 402, height: 555 })
    vm.measureNotify()
    expect(measure).toHaveBeenCalledTimes(1)
    expect(vm.notifyContains(el.firstChild)).toBe(true)
    vm.markAllNotifyRead()
    await vm.$nextTick()
    expect(el.querySelector('.is-unread')).toBeNull()
    vm.closeNotify()
    await vm.$nextTick()
    expect(runtime.container.querySelector('.lark-doc-notify-popover')).toBeNull()
    expect(runtime.container.querySelector('.lark-doc-p6b-layer')).not.toBeNull()
  })

  it('读取失败不冒充空态，Provider 恢复后原生视图刷新', async () => {
    const provider = { list: vi.fn().mockRejectedValueOnce(new Error('离线')).mockResolvedValue([]), markAllRead: vi.fn(), setMuted: vi.fn() }
    const runtime = runtimeFor(createDocumentSession({ notifications: provider }))
    const vm = runtime.host
    await vm.bindNotifications()
    vm.notifyOpen = true
    await vm.$nextTick()
    expect(runtime.container.querySelector('[role="alert"]').textContent).toContain('读取失败')
    await vm.loadNotifications()
    await vm.$nextTick()
    expect(runtime.container.querySelector('[role="alert"]')).toBeNull()
    expect(runtime.container.textContent).toContain('暂无通知')
  })

  it('无 canView 不打开通知，失权后隐藏权限敏感浮层', async () => {
    const session = createDocumentSession({ capabilities: { canView: false, canManagePermission: true } })
    const runtime = runtimeFor(session)
    const vm = runtime.host
    vm.toggleNotify({ currentTarget: { getBoundingClientRect: vi.fn() } })
    expect(vm.notifyOpen).toBe(false)
    session._capabilities.canView = true
    vm.$forceUpdate()
    await vm.$nextTick()
    vm.sharePopoverOpen = true
    vm.permissionDialogOpen = true
    await vm.$nextTick()
    expect(runtime.container.querySelector('.lark-doc-permission-dialog')).not.toBeNull()
    session._capabilities.canManagePermission = false
    vm.$forceUpdate()
    await vm.$nextTick()
    expect(runtime.container.querySelector('.lark-doc-permission-dialog')).toBeNull()
    expect(runtime.container.querySelector('.lark-doc-share-popover')).toBeNull()
  })

  it('导出权限和水印属性迁移，关闭弹窗后仍保留异步 toast', () => {
    const ui = createOverlays({ host: hostNode() })
    cleanups.push(() => ui.destroy())
    const state = { exportOpen: true, exportPanelTitle: '导出', exportCanExport: false, exportSubmitDisabled: true,
      outputWatermarkAttributes: { 'data-watermark': 'visible', 'data-watermark-text': '内部' },
      exportScopeOptions: [{ value: 'all', label: '全部内容' }] }
    ui.update(state)
    const panel = ui.el.querySelector('.lark-doc-export-panel')
    expect(panel.getAttribute('data-watermark-text')).toBe('内部')
    expect(panel.querySelector('[data-capability="canExport"]').getAttribute('aria-disabled')).toBe('true')
    expect(panel.querySelector('input').disabled).toBe(true)
    ui.update({ ...state, outputWatermarkAttributes: {}, exportOpen: false, exportToast: '正在导出文档' })
    expect(ui.el.querySelector('.lark-doc-export-panel')).toBeNull()
    expect(ui.el.querySelector('[role="status"]').textContent).toContain('正在导出文档')
    ui.update({ ...state, outputWatermarkAttributes: {} })
    expect(panel.hasAttribute('data-watermark')).toBe(false)
    expect(panel.hasAttribute('data-watermark-text')).toBe(false)
  })

  it('水印由当前安全策略生成，不读旧 Vue 中不存在的 computed', () => {
    const runtime = runtimeFor({ can: () => true, getProvider: name => name === 'security' ? { policy: { watermark: 'visible', watermarkText: '内部' } } : null })
    expect(runtime.host.buildOverlaysState().outputWatermarkAttributes).toEqual({ 'data-watermark': 'visible', 'data-watermark-text': '内部' })
  })

  it('权限按钮和开关保留 capability、disabled 与 aria 标记', () => {
    const ui = createOverlays({ host: hostNode() })
    cleanups.push(() => ui.destroy())
    ui.update({ sharePopoverOpen: true, permissionDialogOpen: true, shareCanManagePermission: false })
    const button = ui.el.querySelector('.lark-doc-share-perm-btn')
    const toggle = ui.el.querySelector('.lark-doc-permission-switch')
    for (const el of [button, toggle]) {
      expect(el.disabled).toBe(true)
      expect(el.getAttribute('data-capability')).toBe('canManagePermission')
      expect(el.getAttribute('aria-disabled')).toBe('true')
    }
  })

  it('版本回收站完整渲染并派发动作，busy 时阻止重复操作', () => {
    const handlers = { onOpenTrash: vi.fn(), onCloseTrash: vi.fn(), onRestoreDeleted: vi.fn(), onPurgeDeleted: vi.fn() }
    const ui = createVersionPanel({ host: hostNode(), handlers })
    cleanups.push(() => ui.destroy())
    const trash = { open: true, canManage: true, busy: false, items: [{ id: 'v1', name: '10月27日', label: '版本' }] }
    ui.update({ open: true, trash })
    ui.el.querySelector('.lark-doc-version-trash-toggle').click()
    const actions = ui.el.querySelectorAll('.lark-doc-version-trash-list button')
    actions[0].click()
    actions[1].click()
    expect(handlers.onOpenTrash).toHaveBeenCalledTimes(1)
    expect(handlers.onRestoreDeleted).toHaveBeenCalledWith('v1')
    expect(handlers.onPurgeDeleted).toHaveBeenCalledWith('v1')
    expect(ui.el.querySelector('.lark-doc-version-restore').getAttribute('data-capability')).toBe('canRestoreVersion')
    ui.update({ trash: { ...trash, busy: true } })
    expect([...ui.el.querySelectorAll('.lark-doc-version-trash-list button')].every(button => button.disabled)).toBe(true)
    ui.update({ trash: { ...trash, items: [] } })
    expect(ui.el.querySelector('.lark-doc-version-trash').textContent).toContain('回收站为空')
    ui.update({ trash: { ...trash, open: false } })
    expect(ui.el.querySelector('.lark-doc-version-trash')).toBeNull()
  })

  it('评论与另存版本保留 dev 的权限语义', () => {
    const comment = createCommentPanel({ host: hostNode() })
    const save = createSaveVersionDialog({ host: hostNode() })
    cleanups.push(() => { comment.destroy(); save.destroy() })
    comment.update({ open: true, controls: [{ id: 'resolve', label: '解决' }], items: [{ id: 't1', disabled: ['resolve'], textarea: { height: 50 } }] })
    const resolve = comment.el.querySelector('.lark-doc-comment-btn')
    expect(resolve.getAttribute('data-capability')).toBe('canResolveComment')
    expect(resolve.getAttribute('aria-disabled')).toBe('true')
    save.update({ open: true, confirm: { disabled: true } })
    const confirm = save.el.querySelector('.lark-doc-save-version-confirm')
    expect(confirm.getAttribute('data-capability')).toBe('canCreateVersion')
    expect(confirm.getAttribute('aria-disabled')).toBe('true')
  })
  it('评论操作支持原生 click 和键盘激活，鼠标按下只保留焦点且禁用不执行', () => {
    const onSubmit = vi.fn(), onChooseImage = vi.fn(), onControl = vi.fn()
    const ui = createCommentPanel({ host: hostNode(), handlers: { onSubmit, onChooseImage, onControl } })
    cleanups.push(() => ui.destroy())
    const item = { id: 't1', hasDraft: true, allowedReply: true, canUploadImage: true, textarea: { value: '回复', height: 50 } }
    ui.update({ open: true, controls: [{ id: 'resolve', label: '解决' }], items: [item] })
    const send = ui.el.querySelector('.lark-doc-comment-action.is-filled')
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    send.dispatchEvent(down)
    expect(down.defaultPrevented).toBe(true)
    expect(onSubmit).not.toHaveBeenCalled()
    send.click()
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith('t1')
    ui.el.querySelector('.lark-doc-comment-operation').click()
    expect(onChooseImage).toHaveBeenCalledExactlyOnceWith('t1')
    ui.el.querySelector('.lark-doc-comment-btn').click()
    expect(onControl).toHaveBeenCalledExactlyOnceWith('resolve', 't1')
    ui.update({ items: [{ ...item, allowedReply: false, canUploadImage: false, disabled: ['resolve'] }] })
    send.click()
    ui.el.querySelector('.lark-doc-comment-operation').click()
    ui.el.querySelector('.lark-doc-comment-btn').click()
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onChooseImage).toHaveBeenCalledTimes(1)
    expect(onControl).toHaveBeenCalledTimes(1)
  })

  it('评论图片区分加载/失败/可预览，图片草稿可移除，刷新保留回复输入光标', () => {
    const onOpenImage = vi.fn(), onRemoveDraftImage = vi.fn()
    const ui = createCommentPanel({ host: hostNode(), handlers: { onOpenImage, onRemoveDraftImage } })
    cleanups.push(() => ui.destroy())
    const item = { id: 't1', hasDraft: true, allowedReply: true, textarea: { value: '继续输入', height: 80 },
      draftImages: [{ assetId: 'draft', fileName: '草稿.png', previewUrl: 'blob:draft' }],
      replies: [{ id: 'r1', body: '图片', images: [
        { assetId: 'loading', fileName: '加载.png', url: '', error: false },
        { assetId: 'retry', fileName: '重试.png', url: '', error: true },
        { assetId: 'ready', fileName: '已就绪.png', url: 'blob:ready', error: false },
      ] }] }
    ui.update({ open: true, items: [item] })
    const input = ui.el.querySelector('textarea')
    input.focus(); input.setSelectionRange(2, 2)
    const images = ui.el.querySelectorAll('.lark-doc-comment-images button')
    expect(images).toHaveLength(3)
    expect(images[0].disabled).toBe(true)
    expect(images[1].textContent).toContain('点击重试')
    images[1].click(); images[2].click()
    expect(onOpenImage.mock.calls.map(call => call.slice(0, 3))).toEqual([['t1', 'r1', 'retry'], ['t1', 'r1', 'ready']])
    expect(images[2].querySelector('img').getAttribute('src')).toBe('blob:ready')
    ui.el.querySelector('.lark-doc-comment-image-drafts button').click()
    expect(onRemoveDraftImage).toHaveBeenCalledExactlyOnceWith('t1', 'draft')
    ui.update({ items: [{ ...item, draftImages: [] }] })
    expect(ui.el.querySelector('textarea')).toBe(input)
    expect(input.selectionStart).toBe(2)
    expect(ui.el.querySelector('.lark-doc-comment-image-drafts')).toBeNull()
  })

  it('图片预览可关闭并约束键盘焦点，上传未知状态可查询原操作', () => {
    const onCloseImage = vi.fn(), onCancelImageUpload = vi.fn(), onQueryImage = vi.fn()
    const ui = createCommentPanel({ host: hostNode(), handlers: { onCloseImage, onCancelImageUpload, onQueryImage } })
    cleanups.push(() => ui.destroy())
    ui.update({ open: true, imageViewer: { url: 'blob:ready', fileName: '评论.png' }, imageStatus: { busy: true, canCancel: true, pending: true, canQuery: false } })
    const viewer = ui.el.querySelector('[aria-label="评论图片预览"]')
    expect(viewer.querySelector('img').getAttribute('src')).toBe('blob:ready')
    viewer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
    expect(document.activeElement).toBe(viewer.querySelector('button'))
    viewer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(onCloseImage).toHaveBeenCalledExactlyOnceWith(true)
    ui.el.querySelector('[aria-label="取消评论图片上传"]').click()
    expect(onCancelImageUpload).toHaveBeenCalledTimes(1)
    const query = ui.el.querySelector('[aria-label="查询原图片操作"]')
    expect(query.disabled).toBe(true)
    ui.update({ imageViewer: null, imageStatus: { busy: false, pending: true, canQuery: true } })
    expect(ui.el.querySelector('[aria-label="评论图片预览"]')).toBeNull()
    query.click()
    expect(onQueryImage).toHaveBeenCalledTimes(1)
  })

})
