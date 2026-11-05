// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_TAG } from '../../src/web-component/index'
import { createDomRenderer } from '../../src/mount'

const elements = []

function createElement(options = {}, html = '') {
  const element = document.createElement(DEFAULT_TAG)
  element.options = options
  element.innerHTML = html
  elements.push(element)
  return element
}

afterEach(() => {
  elements.splice(0).reverse().forEach(element => {
    element.destroy()
    element.remove()
  })
  vi.clearAllTimers()
  vi.restoreAllMocks()
  vi.useRealTimers()
  localStorage.clear()
})

beforeEach(() => {
  vi.useFakeTimers()
  // jsdom 不提供 Range 布局；这里只补 DOM 几何，不替换真实编辑器或初始化链路。
  vi.spyOn(document, 'createRange').mockImplementation(() => {
    const range = new Range()
    range.getClientRects = () => []
    range.getBoundingClientRect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })
    return range
  })
})

describe('Web Component 的 ready 初始化边界', () => {
  it('两个实例分别派发 ready，第二实例回调写入正文且不被默认模板覆盖', async () => {
    const first = createElement({}, '<p>首个实例的初始内容</p>')
    const second = createElement({ uploadImage: vi.fn(), ai: { enabled: false } })
    second.setAttribute('readonly', '')
    const firstReady = vi.fn()
    const writes = []
    const secondReady = vi.fn(event => {
      writes.push({
        document: event.detail.document,
        editor: event.detail.editor,
        written: second.setContent('<h2>通过 JS 注入能力</h2><p>宿主 ready 回调正文</p>'),
      })
      second.removeAttribute('readonly')
    })
    first.addEventListener('lark-doc-ready', firstReady)
    second.addEventListener('lark-doc-ready', secondReady, { once: true })
    document.body.append(first, second)

    await vi.advanceTimersByTimeAsync(100)

    expect(firstReady).toHaveBeenCalledTimes(1)
    expect(secondReady).toHaveBeenCalledTimes(1)
    expect(writes).toEqual([{
      document: second.getInstance(), editor: second.getEditor(), written: true,
    }])
    expect(writes[0].editor).not.toBeNull()
    expect(first.getText()).toBe('首个实例的初始内容')
    expect(second.getText()).toBe('通过 JS 注入能力\n\n宿主 ready 回调正文')
    expect(second.querySelector('.ProseMirror').textContent).toBe('通过 JS 注入能力宿主 ready 回调正文')
    expect(second.isReadonly()).toBe(false)
    expect(second.getEditor().isEditable).toBe(true)

    await vi.advanceTimersByTimeAsync(1000)
    expect(second.getText()).toBe('通过 JS 注入能力\n\n宿主 ready 回调正文')
    expect(firstReady).toHaveBeenCalledTimes(1)
    expect(secondReady).toHaveBeenCalledTimes(1)
  })

  it('ready 回调使用有效门面句柄，且保留宿主 rendererFactory 与 options', async () => {
    const rendererFactory = vi.fn(() => createDomRenderer())
    const onReady = vi.fn(({ document: instance, editor }) => {
      expect(editor).not.toBeNull()
      expect(editor).toBe(instance.getEditor())
      expect(instance.setContent('<p>选项回调写入</p>')).toBe(true)
    })
    const options = { rendererFactory, onReady }
    const element = createElement(options)
    const ready = vi.fn()
    element.addEventListener('lark-doc-ready', ready)
    document.body.appendChild(element)
    await vi.advanceTimersByTimeAsync(100)

    expect(rendererFactory).toHaveBeenCalledTimes(1)
    expect(onReady).toHaveBeenCalledTimes(1)
    expect(ready).toHaveBeenCalledTimes(1)
    expect(element.options).toBe(options)
    expect(element.getText()).toBe('选项回调写入')
  })

  it('ready 交付前销毁实例，不向已销毁元素补发事件', async () => {
    const element = createElement()
    const ready = vi.fn()
    element.addEventListener('lark-doc-ready', ready)
    element.addEventListener('lark-doc-mounted', () => element.destroy(), { once: true })
    document.body.appendChild(element)
    await vi.advanceTimersByTimeAsync(100)

    expect(ready).not.toHaveBeenCalled()
    expect(element.getInstance()).toBeNull()
    expect(element.querySelector('.ProseMirror')).toBeNull()
  })

  it.each([
    ['none', ['重建时的初始正文', '重建时的初始正文']],
    ['local', ['重建时的初始正文', '第 1 次 ready 写入']],
  ])('移除再插入后重新就绪（storage=%s），slot或草稿恢复后ready写入持续有效', async (storage, expectedTexts) => {
    const element = createElement({ storage }, '<p>重建时的初始正文</p>')
    const initialTexts = []
    const ready = vi.fn(() => {
      initialTexts.push(element.getText())
      element.setContent(`<p>第 ${initialTexts.length} 次 ready 写入</p>`)
    })
    element.addEventListener('lark-doc-ready', ready)
    document.body.appendChild(element)
    await vi.advanceTimersByTimeAsync(100)
    const firstInstance = element.getInstance()
    expect(element.getText()).toBe('第 1 次 ready 写入')
    element.setTitle('应随草稿恢复的标题')
    await element.save()

    element.remove()
    await vi.advanceTimersByTimeAsync(100)
    expect(element.getInstance()).toBeNull()
    document.body.appendChild(element)
    await vi.advanceTimersByTimeAsync(100)

    expect(ready).toHaveBeenCalledTimes(2)
    expect(element.getInstance()).not.toBe(firstInstance)
    expect(initialTexts).toEqual(expectedTexts)
    if (storage === 'local') expect(element.getTitle()).toBe('应随草稿恢复的标题')
    expect(element.getText()).toBe('第 2 次 ready 写入')
    await vi.advanceTimersByTimeAsync(1000)
    expect(element.getText()).toBe('第 2 次 ready 写入')
    expect(ready).toHaveBeenCalledTimes(2)
  })

  it('关闭持久化时，属性重建保留当前正文，断开重连从原始 slot 初始化', async () => {
    const element = createElement({ storage: 'none' }, '<p>缓存的声明正文</p>')
    const initialTexts = []
    const ready = vi.fn(() => {
      initialTexts.push(element.getText())
      expect(element.setContent(`<p>第 ${initialTexts.length} 轮覆写</p>`)).toBe(true)
    })
    element.addEventListener('lark-doc-ready', ready)
    document.body.appendChild(element)
    await vi.advanceTimersByTimeAsync(100)
    const firstInstance = element.getInstance()

    element.setAttribute('placeholder', '触发非 live 属性重建')
    await vi.advanceTimersByTimeAsync(100)
    expect(element.getInstance()).not.toBe(firstInstance)
    expect(element.getText()).toBe('第 2 轮覆写')

    element.remove()
    await vi.advanceTimersByTimeAsync(100)
    expect(element.getInstance()).toBeNull()
    document.body.appendChild(element)
    await vi.advanceTimersByTimeAsync(100)

    expect(initialTexts).toEqual(['缓存的声明正文', '第 1 轮覆写', '缓存的声明正文'])
    expect(element.getText()).toBe('第 3 轮覆写')
    expect(element.querySelectorAll('.ProseMirror')).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(element.getText()).toBe('第 3 轮覆写')
    expect(ready).toHaveBeenCalledTimes(3)
  })

  it.each(['attribute', 'options'])('显式 %s content 在重连时仍优先于 slot 兜底', async source => {
    const element = createElement({ storage: 'none' }, '<p>不应采用的 slot 正文</p>')
    element.setAttribute('content', '<p>属性正文</p>')
    if (source === 'options') element.options = { storage: 'none', content: '<p>选项正文</p>' }
    const expected = source === 'options' ? '选项正文' : '属性正文'
    document.body.appendChild(element)
    await vi.advanceTimersByTimeAsync(100)
    expect(element.getText()).toBe(expected)
    element.setContent('<p>临时覆写</p>')

    element.remove()
    await vi.advanceTimersByTimeAsync(100)
    document.body.appendChild(element)
    await vi.advanceTimersByTimeAsync(100)
    expect(element.getText()).toBe(expected)
  })

  it('同一 tick 内移动元素保留实例与当前正文，不重复派发 ready', async () => {
    const element = createElement({ storage: 'none' }, '<p>移动前的初始正文</p>')
    const ready = vi.fn()
    element.addEventListener('lark-doc-ready', ready)
    document.body.appendChild(element)
    await vi.advanceTimersByTimeAsync(100)
    const instance = element.getInstance()
    element.setContent('<p>移动时保留的正文</p>')

    element.remove()
    document.body.appendChild(element)
    await vi.advanceTimersByTimeAsync(100)

    expect(element.getInstance()).toBe(instance)
    expect(element.getText()).toBe('移动时保留的正文')
    expect(ready).toHaveBeenCalledTimes(1)
  })

  it('异步恢复草稿完成后才派发一次 ready，回调写入优先于草稿', async () => {
    let resolveLoad
    const persistence = {
      load: vi.fn(() => new Promise(resolve => { resolveLoad = resolve })),
      save: vi.fn(async () => null),
      snapshots: vi.fn(async () => []),
      snapshot: vi.fn(async () => null),
      restore: vi.fn(async () => null),
    }
    const element = createElement({ persistence, features: { persistence: true } })
    const observed = []
    const ready = vi.fn(event => {
      observed.push(element.getText())
      expect(event.detail.editor).toBe(element.getEditor())
      expect(element.setContent('<p>ready 后的宿主正文</p>')).toBe(true)
    })
    element.addEventListener('lark-doc-ready', ready)
    document.body.appendChild(element)
    await vi.advanceTimersByTimeAsync(100)
    expect(persistence.load).toHaveBeenCalledTimes(1)
    expect(ready).not.toHaveBeenCalled()

    resolveLoad({
      title: '宿主草稿', schemaVersion: 1,
      json: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '异步草稿正文' }] }] },
    })
    await vi.advanceTimersByTimeAsync(100)

    expect(ready).toHaveBeenCalledTimes(1)
    expect(observed).toEqual(['异步草稿正文'])
    expect(element.getTitle()).toBe('宿主草稿')
    expect(element.getText()).toBe('ready 后的宿主正文')
    await vi.advanceTimersByTimeAsync(1000)
    expect(element.getText()).toBe('ready 后的宿主正文')
    expect(ready).toHaveBeenCalledTimes(1)
  })
})
