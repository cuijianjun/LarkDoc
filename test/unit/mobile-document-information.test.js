// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDocumentInformationPanel } from '../../src/ui/documentInformation'
import topbarMoreMixin from '../../src/components/lark-doc/editor/topbarMoreMixin'

const mounted = [], originalMedia = window.matchMedia
afterEach(() => {
  mounted.splice(0).forEach(ui => ui.destroy()); document.body.replaceChildren()
  window.matchMedia = originalMedia; vi.restoreAllMocks()
})
function setup(options = {}) {
  const host = document.createElement('section'), origin = document.createElement('button')
  host.append(origin); document.body.append(host); origin.focus()
  const ui = createDocumentInformationPanel({ host, ...options }); mounted.push(ui)
  return { ui, root: ui.el, origin }
}
const information = { ownerId: 'owner-from-provider', creatorId: 'creator-from-provider', createdAt: '2026-01-02T03:04:05Z', updatedAt: '2026-03-04T05:06:07Z',
  interaction: { visitors: '7', visits: '82', comments: '9', likes: null } }
const snapshot = (items = [], extra = {}) => ({ items, coverageSince: null, truncated: false, ...extra })
const settled = () => new Promise(resolve => setTimeout(resolve, 0))
const click = (root, view) => root.querySelector(`[data-information-view="${view}"]`).click()

describe('phone information read views', () => {
  it('distinguishes missing services from real empty records, keeps settings unknown, and restores focus on Escape', () => {
    const originalOverflow = document.body.style.overflow
    const onClose = vi.fn(), { root, origin } = setup({ statistics: { words: 17, characters: 29, bytes: 2048 }, onClose })
    expect(document.body.style.overflow).toBe('hidden')
    const drag = new Event('touchmove', { cancelable: true, bubbles: true })
    root.querySelector('.lark-doc-document-information-mask').dispatchEvent(drag)
    expect(drag.defaultPrevented).toBe(true)
    expect(root.textContent).toContain('17')
    expect(root.textContent).toContain('正文 JSON 大小2.00 KB')
    expect(root.textContent).toContain('所有者未知')
    expect(root.textContent).toContain('尚未配置文档信息服务')
    click(root, 'visits')
    expect(root.textContent).not.toContain('暂无访问记录')
    expect(root.textContent).toContain('尚未配置文档信息服务')
    root.querySelector('header button').click(); click(root, 'privacy')
    expect([...root.querySelectorAll('input')].every(input => input.disabled && input.indeterminate)).toBe(true)
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(root.isConnected).toBe(false); expect(onClose).toHaveBeenCalledOnce(); expect(document.activeElement).toBe(origin)
    expect(document.body.style.overflow).toBe(originalOverflow)
    const settings = setup({ initialView: 'page-settings' }).root
    expect(settings.textContent).toContain('尚未配置页面显示设置服务')
    expect(settings.querySelectorAll('input')).toHaveLength(8)
    expect([...settings.querySelectorAll('input')].every(input => input.disabled && input.indeterminate)).toBe(true)
  })

  it('reads information, visits, five operation categories and private flags without issuing any write', async () => {
    const read = vi.fn(async input => {
      if (input === 'information') return information
      if (input === 'visits') return snapshot([{ principalId: 'visitor-7', lastVisitedAt: '2026-03-04T05:06:07Z' }])
      if (input === 'privacy') return { showVisitRecords: false, showVisitAvatars: true }
      return snapshot(input.category === 'download' ? [{ actorId: 'downloader-8', kind: 'download', occurredAt: '2026-03-04T05:06:07Z' }] : [], {
        category: input.category, supportedCategories: ['all', 'share', 'duplicate', 'download', 'settings'] })
    })
    const { root } = setup({ read }); await settled()
    expect(root.textContent).toContain('所有者owner-from-provider')
    expect(root.textContent).toContain('访问人数7'); expect(root.textContent).toContain('访问次数82')
    expect(root.textContent).toContain('点赞总数未知')
    click(root, 'visits'); await settled()
    expect(root.textContent).toContain('visitor-7'); expect(root.textContent).toContain('文档访问人数7')
    root.querySelector('header button').click(); await settled(); click(root, 'operations'); await settled()
    expect(root.querySelectorAll('[role="tab"]')).toHaveLength(5)
    root.querySelector('[data-information-category="share"]').click(); await settled()
    expect(read).toHaveBeenLastCalledWith({ kind: 'operations', category: 'share' })
    expect(root.textContent).toContain('暂无操作记录')
    root.querySelector('[data-information-category="download"]').click(); await settled()
    expect(root.textContent).toContain('downloader-8'); expect(root.textContent).not.toContain('暂无操作记录')
    root.querySelector('header button').click(); await settled(); click(root, 'privacy'); await settled()
    expect([...root.querySelectorAll('input')].map(input => [input.checked, input.disabled, input.indeterminate])).toEqual([[false, true, false], [true, true, false]])
    expect(read.mock.calls.every(([input]) => typeof input === 'string' || input.kind === 'operations')).toBe(true)
  })

  it('discards stale category responses and never labels unsupported filters as empty', async () => {
    let finishShare
    const read = vi.fn(async input => {
      if (input === 'information') return information
      if (input.category === 'share') return new Promise(resolve => { finishShare = resolve })
      return snapshot([], { category: input.category, supportedCategories: ['all', 'download'] })
    })
    const { root } = setup({ read }); await settled(); click(root, 'operations'); await settled()
    root.querySelector('[data-information-category="share"]').click()
    root.querySelector('[data-information-category="download"]').click(); await settled()
    finishShare(snapshot([{ actorId: 'stale-private-actor', kind: 'permissions', occurredAt: '2026-03-04T05:06:07Z' }], { category: 'share', supportedCategories: ['all', 'share'] }))
    await settled()
    expect(root.textContent).not.toContain('stale-private-actor')
    expect(root.querySelector('[data-information-category="download"]').getAttribute('aria-selected')).toBe('true')
    root.querySelector('[data-information-category="settings"]').click(); await settled()
    expect(root.textContent).toContain('未提供此类别的操作记录')
    expect(root.textContent).not.toContain('暂无操作记录')
  })

  it('reports permission errors, retries safely, and removes an obsolete pending view', async () => {
    let finish, allowed = true, attempt = 0
    const read = vi.fn(() => {
      attempt++
      if (attempt === 1) return Promise.reject({ status: 403 })
      return new Promise(resolve => { finish = resolve })
    })
    const { root } = setup({ read, current: () => allowed, statistics: { words: 123 } }); await settled()
    expect(root.textContent).toContain('当前权限无法读取此信息')
    expect(root.textContent).not.toContain('123')
    const retry = [...root.querySelectorAll('button')].find(button => button.textContent === '重试')
    retry.click()
    allowed = false; finish(information); await settled()
    expect(root.isConnected).toBe(false)
    expect(root.textContent).not.toContain('owner-from-provider')
  })
})

describe('phone More information/export lifecycle', () => {
  function owner(extra = {}) {
    const host = document.createElement('section'); document.body.appendChild(host)
    const result = { ...topbarMoreMixin.data(), $el: host, $refs: {}, $nextTick: fn => fn?.call(result),
      _mobileEditorMedia: { matches: true }, featureEnabled: () => true, toolbarEnabled: () => true,
      writable: () => true, shareCan: () => true, exportCanExport: true, ...extra }
    Object.assign(result, topbarMoreMixin.methods)
    return result
  }
  it('uses only the read port and clears visible private data on session capability/provider events', async () => {
    const listeners = new Map(), documentInformation = vi.fn(async () => information), provider = { documentInformation }
    const session = { documentId: 'doc-7', user: { id: 'person-1' }, can: () => true, getProvider: () => provider,
      on(name, callback) { listeners.set(name, callback); return () => listeners.delete(name) } }
    const host = owner({ session })
    try {
      expect(await host.openDocumentInformation()).toBe(true); await settled()
      expect(host.$el.textContent).toContain('owner-from-provider')
      expect(documentInformation).toHaveBeenCalledExactlyOnceWith('read', 'information')
      listeners.get('capabilities')()
      expect(host.$el.querySelector('[role="dialog"]')).toBeNull(); expect(listeners.size).toBe(0)
      expect(await host.openDocumentInformation()).toBe(true); await settled()
      listeners.get('provider-changed')({ name: 'authorization' })
      expect(host.$el.querySelector('[role="dialog"]')).toBeNull()
      expect(await host.openDocumentInformation('information', () => false)).toBe(false)
    } finally { host.closeDocumentInformation() }
  })

  it('routes coarse phone download to the format sheet while preserving a desktop submenu', () => {
    window.matchMedia = () => ({ matches: true })
    const openExportFormatPicker = vi.fn(), host = owner({ openExportFormatPicker })
    host.topbarMoreOpen = true
    host.onTopbarMoreItem({ id: 'download' })
    expect(openExportFormatPicker).toHaveBeenCalledOnce(); expect(host.topbarMoreOpen).toBe(false)
    window.matchMedia = () => ({ matches: false }); host.topbarMoreOpen = true
    host.onTopbarMoreItem({ id: 'download' })
    expect(openExportFormatPicker).toHaveBeenCalledOnce(); expect(host.topbarMoreSubmenu).toBe('download')
  })
})
