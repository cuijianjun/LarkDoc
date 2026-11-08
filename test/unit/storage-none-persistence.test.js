// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LarkDoc } from '../../src/LarkDoc'
import { isAutoSaveEnabled } from '../../src/components/lark-doc/larkDocConfig'
import { createDocumentSession } from '../../src/session/DocumentSession'

const DRAFT_KEY = 'tiptap-vue2:lark-doc:draft'
const mounted = []

function seedDraft(text) {
  const value = JSON.stringify({
    title: '上一次的草稿',
    json: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
    updatedAt: Date.now(),
  })
  localStorage.setItem(DRAFT_KEY, value)
  return value
}

function mount(options = {}) {
  const element = document.createElement('div')
  document.body.appendChild(element)
  let resolveReady
  const ready = new Promise(resolve => { resolveReady = resolve })
  const doc = new LarkDoc({
    element,
    content: '<p>本次传入的正文</p>',
    ...options,
    onReady: payload => { options.onReady?.(payload); resolveReady() },
  })
  mounted.push({ element, doc })
  return { element, doc, ready }
}

function hostAdapter(draft = null) {
  return {
    load: vi.fn(async () => draft),
    save: vi.fn(async () => null),
    snapshots: vi.fn(async () => []),
    snapshot: vi.fn(async () => null),
    restore: vi.fn(async () => null),
  }
}

// 复刻宿主 wrapper 的真实写法：`this.instance = new LarkDoc(...)`。
// 若 ready 在构造函数内部同步派发，回调里拿到的 instance 还是 null。
function readyTimingProbe(options = {}) {
  const element = document.createElement('div')
  document.body.appendChild(element)
  let instance = null
  let resolveReady
  const ready = new Promise(resolve => { resolveReady = resolve })
  const seen = []
  const doc = new LarkDoc({
    element,
    content: '<p>本次传入的正文</p>',
    ...options,
    onReady: payload => {
      seen.push({
        hasInstance: Boolean(instance),
        html: instance ? instance.getHTML() : null,
        hasDocumentHandle: Boolean(payload && payload.document),
      })
      resolveReady()
    },
  })
  instance = doc
  mounted.push({ element, doc })
  return { ready, seen }
}

const tick = () => new Promise(resolve => setTimeout(resolve, 30))

beforeEach(() => {
  // jsdom 不提供 Range 布局几何；块手柄定位会读 getClientRects。
  vi.spyOn(document, 'createRange').mockImplementation(() => {
    const range = new Range()
    range.getClientRects = () => []
    range.getBoundingClientRect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })
    return range
  })
})

afterEach(() => {
  mounted.splice(0).reverse().forEach(({ doc, element }) => { doc.destroy(); element.remove() })
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('storage: none 是持久化总闸', () => {
  it('宿主的 features.persistence:true 不能重新打开内置草稿，也不会覆盖本次正文', async () => {
    const seeded = seedDraft('上一次的旧草稿正文')
    const { doc, ready } = mount({ storage: 'none', features: { persistence: true } })

    expect(doc.config.features.persistence).toBe(false)
    expect(isAutoSaveEnabled(doc.config)).toBe(false)
    await ready
    await tick()

    expect(doc.getText()).toBe('本次传入的正文')
    expect(localStorage.getItem(DRAFT_KEY)).toBe(seeded)
  })

  it('旧草稿在本次编辑后也不会被改写', async () => {
    const seeded = seedDraft('上一次的旧草稿正文')
    const { doc, ready } = mount({
      storage: 'none',
      features: { persistence: true },
      autosave: { delay: 0 },
    })
    await ready
    expect(doc.setContent('<p>编辑后的新正文</p>')).toBe(true)
    await tick()

    expect(doc.getText()).toBe('编辑后的新正文')
    expect(localStorage.getItem(DRAFT_KEY)).toBe(seeded)
  })

  it('config.features.persistence:true 这条旧入口同样被 storage:none 覆盖', async () => {
    seedDraft('上一次的旧草稿正文')
    const { doc, ready } = mount({ storage: 'none', config: { features: { persistence: true } } })

    expect(doc.config.features.persistence).toBe(false)
    await ready
    expect(doc.getText()).toBe('本次传入的正文')
  })

  it('默认 storage:local 仍按原语义恢复草稿（对照组）', async () => {
    seedDraft('上一次的旧草稿正文')
    const { doc, ready } = mount()

    expect(doc.config.features.persistence).toBe(true)
    await ready
    expect(doc.getText()).toBe('上一次的旧草稿正文')
  })

  it('宿主注入 persistence 适配器时，storage:none 仍走宿主落点', async () => {
    const draft = {
      title: '宿主草稿',
      schemaVersion: 1,
      json: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '后端返回的正文' }] }] },
    }
    const adapter = hostAdapter(draft)
    const { doc, ready } = mount({ storage: 'none', persistence: adapter })

    expect(doc.config.features.persistence).toBe(true)
    await ready
    expect(adapter.load).toHaveBeenCalledTimes(1)
    expect(doc.getText()).toBe('后端返回的正文')
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull()
  })

  it('有适配器时宿主仍可用 features.persistence:false 主动关闭', async () => {
    const adapter = hostAdapter(null)
    const { doc, ready } = mount({ storage: 'none', persistence: adapter, features: { persistence: false } })

    expect(doc.config.features.persistence).toBe(false)
    await ready
    await tick()
    expect(adapter.load).not.toHaveBeenCalled()
    expect(adapter.save).not.toHaveBeenCalled()
    expect(doc.getText()).toBe('本次传入的正文')
  })

  it('providers.persistence / session provider 也识别为宿主落点', async () => {
    const adapter = hostAdapter(null)
    const fromProviders = mount({ storage: 'none', providers: { persistence: adapter } })
    expect(fromProviders.doc.config.features.persistence).toBe(true)
    await fromProviders.ready
    expect(adapter.load).toHaveBeenCalledTimes(1)
    expect(fromProviders.doc.getText()).toBe('本次传入的正文')

    const session = createDocumentSession({ providers: { persistence: hostAdapter(null) } })
    const fromSession = mount({ storage: 'none', session })
    expect(fromSession.doc.config.features.persistence).toBe(true)
    await fromSession.ready
    expect(session.getProvider('persistence')).not.toBeNull()
    expect(fromSession.doc.getText()).toBe('本次传入的正文')
  })

  it('关掉内置草稿后 ready 仍在 new LarkDoc() 返回之后派发，宿主可读取实例', async () => {
    const { ready, seen } = readyTimingProbe({ storage: 'none', features: { persistence: true } })
    await ready

    expect(seen).toHaveLength(1)
    expect(seen[0].hasInstance).toBe(true)
    expect(seen[0].hasDocumentHandle).toBe(true)
    expect(seen[0].html).toContain('本次传入的正文')
  })

  it('开启内置草稿时 ready 时序一致（对照组）', async () => {
    const { ready, seen } = readyTimingProbe()
    await ready

    expect(seen).toHaveLength(1)
    expect(seen[0].hasInstance).toBe(true)
    expect(seen[0].hasDocumentHandle).toBe(true)
    expect(seen[0].html).toContain('本次传入的正文')
  })
})
