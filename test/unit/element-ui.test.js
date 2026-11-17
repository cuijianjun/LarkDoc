// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import postcss from 'postcss'
import { inlineCssImports } from '../../rollup.config.mjs'
import { createDeferredUi } from '../../src/features/element-ui'
import { registerFeature } from '../../src/core/features/registry'

import { createNativeOptionsHost } from '../../src/editor/nativeOptionsHost'
import commandMenuMixin from '../../src/components/lark-doc/editor/commandMenuMixin'
import commandMenuUiMixin from '../../src/components/lark-doc/editor/commandMenuUiMixin'

// 与 Element UMD 的 Rollup 工厂替换相同，验证真实懒加载接线。
vi.mock('../../src/ui/commandMenu', async () => {
  const { createDeferredUi } = await import('../../src/features/element-ui')
  return { createCommandMenu: options => createDeferredUi('createCommandMenu', options) }
})

vi.mock('../../src/ui/templateLibrary', async () => {
  const { createDeferredUi } = await import('../../src/features/element-ui')
  return { createTemplateLibrary: options => createDeferredUi('createTemplateLibrary', options) }
})

const cleanups = []
const projectFile = file => path.resolve(__dirname, '../..', file)
async function packageStyles(deferredVersioning = false) {
  const from = projectFile('style.css')
  return (await postcss([inlineCssImports({ deferredVersioning })]).process(fs.readFileSync(from, 'utf8'), { from })).root
}
function hasClassRule(root, name, screenOnly = false) {
  let found = false
  root.walkRules(rule => {
    let parent = rule.parent
    while (parent?.type === 'atrule') {
      if (screenOnly && parent.name === 'media' && /\bprint\b/.test(parent.params)) return
      parent = parent.parent
    }
    // Shared read/print guards stay eager; they only hide controls and do not
    // pull the optional surface's layout into the initial screen.
    const declarations = rule.nodes.filter(node => node.type === 'decl')
    if (screenOnly && declarations.every(node => node.prop === 'display' && node.value === 'none')) return
    // Mobile-selection overrides are a separate public layer; this boundary
    // checks the optional factory's base surface rather than those overrides.
    const pattern = new RegExp(screenOnly ? `\\.${name}$` : `\\.${name}(?![\\w-])`)
    if (postcss.list.comma(rule.selector).some(selector => pattern.test(selector.trim()))) found = true
  })
  return found
}
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

describe('Element 首屏与冷 UI 样式边界', () => {
  it('公开入口保持完整，Element 初始只排除真实延迟工厂的浮层样式', async () => {
    const full = await packageStyles(), initial = await packageStyles(true)
    for (const name of ['lark-doc-command-menu', 'lark-doc-color-palette', 'lark-doc-share-popover',
      'lark-doc-permission-dialog', 'lark-doc-export-panel', 'lark-doc-bubble', 'lark-doc-table-tools',
      'lark-doc-notify-popover', 'lark-doc-link-tools', 'lark-doc-version-layer']) {
      expect(hasClassRule(full, name), `${name} stays in the public stylesheet`).toBe(true)
      expect(hasClassRule(initial, name, true), `${name} must wait for its UI feature`).toBe(false)
    }
    for (const name of ['lark-doc-topbar', 'lark-doc-toolbar', 'lark-doc-notify-btn', 'lark-doc-editor-content',
      'lark-doc-share-layer', 'lark-doc-share-mask', 'lark-doc-share-entry', 'lark-doc-share-btn-filled', 'lark-doc-share-toast',
      'lark-doc-comment', 'lark-doc-comment-composer', 'lark-doc-comment-launcher',
      'lark-doc-scroll-navigator', 'lark-doc-code', 'lark-doc-image-viewer-shell', 'lark-doc-reminder-chip']) {
      expect(hasClassRule(initial, name), `${name} must be styled before any optional UI loads`).toBe(true)
    }
    expect(initial.toString()).toContain('@media print')
    expect(initial.toString()).toContain('.lark-doc-print-root')
    expect(initial.toString()).toContain('.tableWrapper')
    expect(initial.toString()).toContain('.column-resize-handle')
  })

  it('冷层在发布 ui.ready 前静态加载，公开入口只包含一次原始规则', async () => {
    // 两半各有自己的入口：交互包（ui-core）负责把冷层样式带进 <link>，所以它必须在
    // 发布 ui.ready 之前静态引样式；面板包（ui-panels）共用同一张表，刻意不引，
    // 否则两支 UMD 会各打一份 CSS。非 Element 的全量出口（ui.js）同理。
    const readEntry = name => fs.readFileSync(projectFile(`src/features/${name}`), 'utf8')
    for (const name of ['ui.js', 'ui-core.js']) {
      const source = readEntry(name)
      const styleImport = source.indexOf("import '../styles/deferred-ui.css'")
      expect(styleImport, name).toBeGreaterThanOrEqual(0)
      expect(styleImport, name).toBeLessThan(source.indexOf('registerUiApi('))
    }
    expect(readEntry('ui-panels.js')).not.toContain('styles/deferred-ui.css')
    const deferred = postcss.parse(fs.readFileSync(projectFile('src/styles/deferred-ui.css'), 'utf8'))
    const full = await packageStyles(), initial = await packageStyles(true)
    const declarations = root => {
      const result = new Map()
      root.walkRules(rule => {
        const ancestors = []; let parent = rule.parent
        while (parent?.type === 'atrule') { ancestors.unshift(`@${parent.name} ${parent.params}`); parent = parent.parent }
        const key = JSON.stringify([ancestors, rule.selector, rule.nodes.filter(node => node.type === 'decl').map(node => [node.prop, node.value, !!node.important])])
        result.set(key, (result.get(key) || 0) + 1)
      })
      return result
    }
    const coldRules = declarations(deferred), fullRules = declarations(full), initialRules = declarations(initial)
    expect(coldRules.size).toBeGreaterThan(100)
    for (const [key, count] of coldRules) {
      expect(fullRules.get(key), key).toBe(count)
      expect(initialRules.has(key), key).toBe(false)
    }
  })
})

describe('Element 延迟 UI 生命周期', () => {
  it('cold bubble configuration stays synchronous and hide prevents late resurrection', async () => {
    const host = document.createElement('div'); document.body.append(host)
    let resolve
    cleanups.push(registerFeature('ui', () => new Promise(yes => { resolve = yes })))
    const config = { ai: false, blockStyle: true, marks: [] }
    const ui = createDeferredUi('createBubbleBar', { host, config })
    cleanups.push(() => ui.destroy())
    config.ai = true
    expect(ui.setConfig(config)).toBe(true)
    expect(ui.setConfig({ ...config })).toBe(false)
    const latest = { ...config, readonly: true }
    expect(ui.setConfig(latest)).toBe(true)
    ui.update({ open: true, left: 10, top: 20 })
    ui.positionHeadingMenu(); ui.positionAlignMenu(); ui.hide()
    const actual = await vi.importActual('../../src/ui/bubbleBar')
    const factory = vi.fn(options => actual.createBubbleBar(options.host, options))
    const api = { createBubbleBar: factory }
    cleanups.push(registerFeature('ui.ready', () => api))
    resolve(api); await settle()
    expect(factory).not.toHaveBeenCalled()
    ui.update({ open: true, left: 20, top: 30 })
    expect(factory).toHaveBeenCalledOnce()
    expect(factory.mock.calls[0][0].config).toBe(latest)
    expect(ui.el.isConnected).toBe(true)
    expect(ui.setConfig({ ...latest })).toBe(false)
    ui.hide()
    expect(ui.el.isConnected).toBe(false)
    ui.destroy(); ui.update({ open: true }); ui.positionHeadingMenu()
    expect(factory).toHaveBeenCalledOnce()
  })

  it('真实 commandMenu 接线在冷加载完成后定位和聚焦', async () => {
    let resolve
    const pending = new Promise(yes => { resolve = yes })
    cleanups.push(registerFeature('ui', () => pending))
    const root = document.createElement('div'); document.body.append(root)
    const runtime = createNativeOptionsHost({ options: {
      mixins: [commandMenuMixin, commandMenuUiMixin],
      methods: { writable: () => true, featureEnabled: () => true,
        cancelPopupHoverClose: vi.fn(), closeBlockMenu: vi.fn(), rememberSelection: vi.fn(),
        stopTemplateMenuTracking: vi.fn(), trackTemplateMenu: vi.fn() },
    }, state: { effectiveReadonly: false, templates: [], larkDocConfig: {} }, refs: { root, commandMenuHost: root } })
    cleanups.push(() => { runtime.host.destroyCommandMenu(); runtime.destroy() })
    runtime.host.mountCommandMenu()
    runtime.host.openCommandMenu('plus')
    await settle()
    expect(root.querySelector('input')).toBeNull()
    const api = await vi.importActual('../../src/ui/commandMenu')
    resolve(api); await settle()
    expect(document.activeElement).toBe(root.querySelector('input'))
    expect(runtime.host.menuMaxHeight).not.toBe('')
  })

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

  it('标准入口内置加载器只在首次可见时启动，使用最新状态并复用实例', async () => {
    const host = document.createElement('div'); document.body.appendChild(host)
    const instance = { update: vi.fn(), destroy: vi.fn(), focusInput: vi.fn(), choose: vi.fn() }
    const factory = vi.fn(() => instance)
    const fallback = vi.fn(async () => ({ createFallback: factory }))
    const ui = createDeferredUi('createFallback', { host }, undefined, fallback)
    cleanups.push(() => ui.destroy())
    expect(ui.choose).toBeUndefined()
    ui.update({ open: false }); await settle()
    expect(fallback).not.toHaveBeenCalled()
    ui.update({ open: true, value: '旧' }); ui.focusInput()
    ui.update({ value: '新' }); await settle()
    expect(fallback).toHaveBeenCalledOnce()
    expect(factory).toHaveBeenCalledOnce()
    expect(instance.update).toHaveBeenLastCalledWith({ open: true, value: '新' })
    expect(instance.focusInput).toHaveBeenCalledOnce()
    ui.choose()
    expect(instance.choose).toHaveBeenCalledOnce()
    ui.update({ open: false }); ui.update({ open: true })
    expect(fallback).toHaveBeenCalledOnce()
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
  it('模板库真实工厂冷加载后保留焦点和关闭契约', async () => {
    const host = document.createElement('div'); document.body.appendChild(host)
    const gate = {}; gate.promise = new Promise(resolve => { gate.resolve = resolve })
    const loader = vi.fn(() => gate.promise); cleanups.push(registerFeature('ui', loader))
    const name = 'createTemplateLibrary'
    const actual = await vi.importActual('../../src/ui/templateLibrary')
    const ui = createDeferredUi(name, { host, mode: 'insert', handlers: { onClose: () => ui.update({ open: false }) } })
    cleanups.push(() => ui.destroy())
    ui.update({ open: false }); await settle(); expect(loader).not.toHaveBeenCalled()
    ui.update({ open: true, templates: [], items: [], empty: true, style: { left: 10, top: 20 } })
    ui.focusSearch()
    await settle(); expect(host.children).toHaveLength(0)
    gate.resolve(actual); await settle()
    expect(ui.el?.isConnected).toBe(true)
    expect(document.activeElement.tagName).toBe('INPUT'); host.querySelector('[aria-label="关闭模板库"]').click()
    expect(host.children).toHaveLength(0)
    ui.update({ open: true }); expect(loader).toHaveBeenCalledOnce()
  })

  it('模板库关闭后的迟到工厂不挂载退役私有视图', async () => {
    const host = document.createElement('div'); document.body.appendChild(host)
    let finish
    cleanups.push(registerFeature('ui', () => new Promise(resolve => { finish = resolve })))
    const name = 'createTemplateLibrary'
    const actual = await vi.importActual('../../src/ui/templateLibrary')
    const factory = vi.fn(actual[name]), ui = createDeferredUi(name, { host })
    cleanups.push(() => ui.destroy())
    ui.update({ open: true, templates: [], items: [], empty: true, style: { left: 10, top: 20 } }); await settle()
    ui.update({ open: false }); finish({ [name]: factory }); await settle()
    expect(factory).not.toHaveBeenCalled(); expect(host.children).toHaveLength(0)
  })

  it('模板库冷加载时真实Escape取消意图，迟到模块不得弹回', async () => {
    const root = document.createElement('div'); document.body.appendChild(root)
    const editor = { on: vi.fn(), off: vi.fn(), view: { dom: root, focus: vi.fn() }, state: {} }
    const scope = { editor }
    let finish
    cleanups.push(registerFeature('ui', () => new Promise(resolve => { finish = resolve })))
    const runtime = createNativeOptionsHost({ options: { mixins: [commandMenuMixin], methods: {
      templateInsertionScope: () => scope, templateInsertionCurrent(current) { return !!current && this._templateInsertion === current }, closeCommandMenu: vi.fn(),
    } }, state: { templates: [] }, refs: { root, panelHost: root } })
    cleanups.push(() => { runtime.host.closeTemplateLibrary(false); runtime.destroy() })
    runtime.host.openTemplateLibrary(); await settle()
    editor.view.composing = true
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: false, cancelable: true }))
    expect(runtime.host._templateInsertion).toBe(scope)
    expect(editor.view.focus).not.toHaveBeenCalled()
    editor.view.composing = false
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, cancelable: true }))
    expect(runtime.host._templateInsertion).toBe(scope)
    const consumed = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }); consumed.preventDefault(); window.dispatchEvent(consumed)
    expect(runtime.host._templateInsertion).toBe(scope)
    for (const tag of ['input', 'div']) {
      const foreign = document.createElement(tag); foreign.tabIndex = 0
      if (tag === 'div') foreign.setAttribute('contenteditable', 'true')
      document.body.appendChild(foreign); foreign.focus()
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }))
      expect(runtime.host._templateInsertion).toBe(scope)
      foreign.remove()
    }
    root.tabIndex = 0; root.focus()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(runtime.host._templateInsertion === null).toBe(true)
    const actual = await vi.importActual('../../src/ui/templateLibrary'), factory = vi.fn(actual.createTemplateLibrary)
    finish({ createTemplateLibrary: factory }); await settle()
    expect(factory).not.toHaveBeenCalled(); expect(root.children).toHaveLength(0)
    expect(editor.view.focus).toHaveBeenCalledOnce()
  })

})
