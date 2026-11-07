/**
 * P4-06 三态契约：纯数据/键位、原生行为宿主、真实 createTopBar/select DOM 与 controller。
 * 菜单开合/定位由共享 select 所有，模式状态/持久化由 viewModesMixin 所有。
 * 几何锁当前共享下拉契约：84×32 按钮、340 最小宽、两行 22/18+2、5px 内衬；
 * 成功提示为顶部居中卡片 @y32/z9999。JSDOM 只桩布局测量，不替换交互实现。
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { createNativeOptionsHost } from '../../src/editor/nativeOptionsHost'
import { createTopBar } from '../../src/ui/topBar'
import { createEditorController } from '../../src/editor/EditorController'
import { createWorkspaceController, createWorkspaceState } from '../../src/workspace/WorkspaceController'
import readingModeMixin from '../../src/components/lark-doc/editor/readingModeMixin'
import { createLarkDocConfig, DEFAULT_LARK_DOC_CONFIG } from '../../src/components/lark-doc/larkDocConfig'
import {
  DOC_MODES, DOC_MODE_IDS, MODE_ICONS, MODE_MENU_MIN_WIDTH, MODE_STORAGE_KEY, MODE_TOAST, MODE_TOAST_MS,
  DEFAULT_MODES_CONFIG, normalizeModesConfig,
  isDocMode, isEditableTarget, modeFromShortcut, modeLabel, modeMeta, modeToastText,
} from '../../src/components/lark-doc/editor/docModes'
import viewModesMixin from '../../src/components/lark-doc/editor/viewModesMixin'
import overlayDismissMixin from '../../src/components/lark-doc/editor/overlayDismissMixin'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const css = fs.readFileSync(path.join(root, 'src/components/lark-doc/lark-doc.css'), 'utf8')
const renderer = fs.readFileSync(path.join(root, 'src/mount/domRenderer.js'), 'utf8')
const shell = fs.readFileSync(path.join(root, 'src/ui/workspaceShell.js'), 'utf8')
const icons = fs.readFileSync(path.join(root, 'src/ui/icons.js'), 'utf8')
const collapseMixin = fs.readFileSync(path.join(root, 'src/components/lark-doc/editor/toolbarCollapseMixin.js'), 'utf8')

/** 取一条单行 CSS 规则（本仓库 CSS 一律一行一条，读整行即可）。 */
function ruleFor(selector) {
  return css.split('\n').find((line) => line.startsWith(`${selector} {`)) || ''
}

const modeCssStart = css.indexOf('.lark-doc .lark-doc-mode-select {')
if (modeCssStart < 0) throw new Error('缺少三态共享下拉样式')
const modeCssSection = css.slice(modeCssStart).replace(/\/\*[\s\S]*?\*\//g, '')

const runtimes = []
const nativeBars = []
const doms = []
const editors = []
const globalKeys = ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'DOMParser', 'MutationObserver',
  'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'innerHeight', 'innerWidth']
const originalGlobals = new Map(globalKeys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))

afterEach(() => {
  // 外层 describe 的 afterEach 可能先删 window；仍须在所属 DOM 存活时销毁监听。
  if (doms.length) Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: doms[doms.length - 1].window })
  nativeBars.splice(0).reverse().forEach(bar => bar.destroy())
  runtimes.splice(0).reverse().forEach(runtime => runtime.destroy())
  editors.splice(0).forEach(editor => editor.destroy())
  doms.splice(0).forEach(dom => dom.window.close())
  vi.restoreAllMocks()
  vi.useRealTimers()
  originalGlobals.forEach((descriptor, key) => {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else delete globalThis[key]
  })
})

function createDom() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://mode-switch.test/', pretendToBeVisual: true,
  })
  doms.push(dom)
  dom.window.innerWidth = 1512
  dom.window.innerHeight = 1000
  globalKeys.forEach(key => {
    const value = key === 'window' ? dom.window : dom.window[key]
    Object.defineProperty(globalThis, key, {
      configurable: true, writable: true, value: typeof value === 'function' && ['getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame'].includes(key) ? value.bind(dom.window) : value,
    })
  })
  Object.defineProperty(window, 'localStorage', { configurable: true, value: makeStorage() })
  return dom
}

function createModeBar({ rect = { left: 1088, right: 1172, top: 16, bottom: 48, width: 84 }, config } = {}) {
  createDom()
  const host = document.createElement('section')
  host.className = 'lark-doc'
  document.body.appendChild(host)
  const actionsHost = document.createElement('button')
  actionsHost.textContent = '宿主动作'
  let bar
  let visible = true
  const ed = createEd({ config, onChange: () => { if (bar) paint() } })
  function paint() {
    bar.update({
      headerVisible: visible, title: '测试文档', readonly: ed.reading, mode: ed.mode,
      modeLabel: ed.modeLabel, modeIcon: ed.modeIcon, modeOptions: ed.modeOptions,
      modeVisible: ed.modesConfig.visible, modeSwitchable: ed.modeSwitchable,
    })
  }
  ed.restoreMode()
  bar = createTopBar({ host, actionsHost, handlers: { setMode: id => ed.setMode(id) } })
  nativeBars.push(bar)
  paint()
  const trigger = host.querySelector('[role="combobox"]')
  trigger.getBoundingClientRect = () => rect
  // JSDOM 无布局；168 = 三行×(22+18+2+上下5) + 上下5内衬 + 上下1边框。
  Object.defineProperty(window.HTMLElement.prototype, 'offsetHeight', {
    configurable: true, get() { return this.classList.contains('lark-doc-select-menu') ? 168 : 0 },
  })
  return {
    ed, bar, host, trigger, actionsHost, rect,
    menu: () => host.querySelector('[role="listbox"]'),
    setVisible(value) { visible = value; paint() },
    setModeVisible(value) { ed.larkDocConfig = { ...ed.larkDocConfig, modes: { ...ed.larkDocConfig.modes, visible: value } }; paint() },
  }
}

describe('P4-06 三态数据（07 §1.1 三项文案原样）', () => {
  it('模式入口默认可见且向后兼容；只有显式 false 隐藏', () => {
    expect(DEFAULT_MODES_CONFIG.visible).toBe(true)
    expect(DEFAULT_LARK_DOC_CONFIG.modes.visible).toBe(true)
    expect(createLarkDocConfig().modes).toEqual(DEFAULT_MODES_CONFIG)
    for (const visible of [undefined, null, true, 0, 'false']) {
      expect(normalizeModesConfig({ visible }).visible).toBe(true)
      expect(createLarkDocConfig({ modes: { visible } }).modes.visible).toBe(true)
    }
    const input = { visible: false, allow: ['read', 'edit', 'edit', 'invalid'], default: 'suggest', labels: { read: ' 预览 ', invalid: '忽略' }, persist: false, shortcuts: false }
    const expected = { visible: false, allow: ['edit', 'read'], default: 'edit', labels: { read: '预览' }, persist: false, shortcuts: false }
    expect(normalizeModesConfig(input)).toEqual(expected)
    expect(createLarkDocConfig({ modes: input }).modes).toEqual(expected)
    expect(normalizeModesConfig(expected)).toEqual(expected)
    expect(normalizeModesConfig({ visible: false, allow: [] }).allow).toEqual(DOC_MODE_IDS)
  })

  it('三项、顺序为编辑 → 修订 → 阅读', () => {
    expect(DOC_MODES.map((item) => item.id)).toEqual(['edit', 'suggest', 'read'])
    expect(DOC_MODE_IDS).toEqual(['edit', 'suggest', 'read'])
  })

  it('主标题 + 副标题与飞书下拉逐字一致', () => {
    expect(DOC_MODES.map((item) => item.label)).toEqual(['编辑', '修订', '阅读'])
    expect(DOC_MODES.map((item) => item.hint)).toEqual(['可编辑文档', '提出修改建议', '仅查看或评论文档'])
  })

  it('每项都带非空快捷键数组（下拉虽不展示，快捷键抽屉与之同源）', () => {
    DOC_MODES.forEach((item) => {
      expect(Array.isArray(item.keys)).toBe(true)
      expect(item.keys.length).toBeGreaterThan(0)
      item.keys.forEach((key) => expect(String(key).trim().length).toBeGreaterThan(0))
    })
  })

  it('编辑两种键位（裸 E + Ctrl/⌘+⌥+E），修订与阅读各一种（07 §12.1）', () => {
    expect(modeMeta('edit').keys).toEqual(['E', 'Ctrl + ⌥ + E'])
    expect(modeMeta('suggest').keys).toEqual(['⌘ + ⌥ + X'])
    expect(modeMeta('read').keys).toEqual(['Ctrl + ⌥ + V'])
  })

  it('三条提示文案（07 §1.1「已切换为 X 模式」）', () => {
    expect(MODE_TOAST).toEqual({
      edit: '已切换为编辑模式', suggest: '已切换为修订模式', read: '已切换为阅读模式',
    })
  })

  it('存储键不分文档 —— 模式是当前用户维度的状态', () => {
    expect(MODE_STORAGE_KEY).toBe('lark-doc:mode')
    expect(MODE_STORAGE_KEY.includes(':doc:')).toBe(false)
  })

  it('提示停留 3300ms（07 §10 ② 实测 toast 存活 3302ms 取整）', () => {
    expect(MODE_TOAST_MS).toBe(3300)
  })

  it('共享模式下拉保留明确的 340px 最小宽度，行高由两行内容撑开', () => {
    expect(MODE_MENU_MIN_WIDTH).toBe(340)
  })

  it('图标映射：阅读复用既有 reading，另两个是新画的', () => {
    expect(MODE_ICONS).toEqual({ edit: 'mode-edit', suggest: 'mode-comment', read: 'reading' })
    // 三个 key 都必须真的在 ICONS 表里（键名带连字符的加了引号，reading 是裸标识符），
    // 否则原生 icon renderer 查不到会静默渲染空 span —— 按钮上就只剩文字。
    expect(icons).toContain("'mode-edit': wrap(")
    expect(icons).toContain("'mode-comment': wrap(")
    expect(icons).toContain('reading: wrap(')
  })

  it('isDocMode 只认三个 id，非法值一律 false', () => {
    expect(isDocMode('edit')).toBe(true)
    expect(isDocMode('suggest')).toBe(true)
    expect(isDocMode('read')).toBe(true)
    expect(isDocMode('')).toBe(false)
    expect(isDocMode('suggestion')).toBe(false)
    expect(isDocMode(null)).toBe(false)
    expect(isDocMode(undefined)).toBe(false)
  })

  it('modeMeta / modeLabel 对非法 id 回落「编辑」，模板里不用再写兜底', () => {
    expect(modeMeta('read').label).toBe('阅读')
    expect(modeMeta('nope')).toBe(DOC_MODES[0])
    expect(modeLabel('nope')).toBe('编辑')
    expect(modeLabel(undefined)).toBe('编辑')
  })

  it('modeToastText 非法 id 回落编辑文案', () => {
    expect(modeToastText('suggest')).toBe('已切换为修订模式')
    expect(modeToastText('zzz')).toBe('已切换为编辑模式')
  })
})

describe('P4-06 键位判定（07 §12.1）', () => {
  /** 最小键盘事件：只带判定用到的字段。 */
  function keyEvent(key, mods) {
    return Object.assign({ key, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false }, mods)
  }

  it('⌘+⌥+E → 编辑；Ctrl+⌥+E → 编辑（两平台同键位）', () => {
    expect(modeFromShortcut(keyEvent('e', { metaKey: true, altKey: true }), false)).toBe('edit')
    expect(modeFromShortcut(keyEvent('e', { ctrlKey: true, altKey: true }), false)).toBe('edit')
  })

  it('⌘+⌥+X → 修订；Ctrl+⌥+X → 修订', () => {
    expect(modeFromShortcut(keyEvent('x', { metaKey: true, altKey: true }), false)).toBe('suggest')
    expect(modeFromShortcut(keyEvent('x', { ctrlKey: true, altKey: true }), false)).toBe('suggest')
  })

  it('⌘+⌥+V → 阅读；Ctrl+⌥+V → 阅读', () => {
    expect(modeFromShortcut(keyEvent('v', { metaKey: true, altKey: true }), false)).toBe('read')
    expect(modeFromShortcut(keyEvent('v', { ctrlKey: true, altKey: true }), false)).toBe('read')
  })

  it('大小写不敏感（Caps Lock / 大写 key 也要命中）', () => {
    expect(modeFromShortcut(keyEvent('X', { metaKey: true, altKey: true }), false)).toBe('suggest')
    expect(modeFromShortcut(keyEvent('E', { metaKey: true, altKey: true }), false)).toBe('edit')
  })

  it('带 Shift 的组合键不抢（⌘+⌥+Shift+X 在气泡条里另有含义）', () => {
    expect(modeFromShortcut(keyEvent('x', { metaKey: true, altKey: true, shiftKey: true }), false)).toBe('')
    expect(modeFromShortcut(keyEvent('e', { metaKey: true, altKey: true, shiftKey: true }), false)).toBe('')
  })

  it('缺 alt 或缺 meta 都不算模式键', () => {
    expect(modeFromShortcut(keyEvent('x', { metaKey: true }), false)).toBe('')
    expect(modeFromShortcut(keyEvent('x', { altKey: true }), false)).toBe('')
  })

  it('⌘+⌥+其它字母不命中（不误吞系统组合键）', () => {
    expect(modeFromShortcut(keyEvent('k', { metaKey: true, altKey: true }), false)).toBe('')
  })

  it('裸 E 只在焦点不在输入区时接管（否则正文打 e 会切模式）', () => {
    expect(modeFromShortcut(keyEvent('e'), false)).toBe('edit')
    expect(modeFromShortcut(keyEvent('e'), true)).toBe('')
    expect(modeFromShortcut(keyEvent('E'), true)).toBe('')
  })

  it('裸 X / 裸 V 不接管（避免抢正文输入与粘贴）', () => {
    expect(modeFromShortcut(keyEvent('x'), false)).toBe('')
    expect(modeFromShortcut(keyEvent('v'), false)).toBe('')
    expect(modeFromShortcut(keyEvent('v', { metaKey: true }), false)).toBe('')
  })

  it('空事件 / 空 key 一律空串', () => {
    expect(modeFromShortcut(null, false)).toBe('')
    expect(modeFromShortcut(undefined, false)).toBe('')
    expect(modeFromShortcut({}, false)).toBe('')
    expect(modeFromShortcut({ key: '' }, false)).toBe('')
  })

  it('isEditableTarget：closest 命中输入区为 true，缺 closest 当 false（合成事件兜底）', () => {
    expect(isEditableTarget(null)).toBe(false)
    expect(isEditableTarget(undefined)).toBe(false)
    expect(isEditableTarget({})).toBe(false)
    expect(isEditableTarget({ closest: () => null })).toBe(false)
    expect(isEditableTarget({ closest: () => ({ tagName: 'DIV' }) })).toBe(true)
  })
})

/** 假 localStorage：记录写入，便于断言「切了就落库」。 */
function makeStorage(initial) {
  const store = Object.assign({}, initial)
  const writes = []
  return {
    store,
    writes,
    getItem(key) { return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null },
    setItem(key, value) { writes.push([key, value]); store[key] = value },
  }
}

/** 使用生产原生宿主，computed 链和方法绑定不再由测试手抄。 */
function createEd({ config, onChange } = {}) {
  const runtime = createNativeOptionsHost({
    options: {
      mixins: [viewModesMixin, overlayDismissMixin],
      methods: { focus() { this.focusCalls += 1 } },
    },
    state: {
      larkDocConfig: config || {}, focusCalls: 0, headingNumberMenu: { open: false },
      helpOpen: false, isvPanelOpen: false, menuOpen: false, mentionOpen: false, reminderOpen: false,
      calendarOpen: false, blockMenuOpen: false, blockTypeMenuOpen: false, blockAlignMenuOpen: false,
      blockColorMenuOpen: false, bubbleAlignOpen: false, bubbleHeadingOpen: false, calloutEmojiOpen: false,
      colorPaletteOpen: '', headerMenuOpen: false, diagramMenuOpen: false, tableToolsOpen: false,
      headingOpen: false, mathDialog: '', linkDialog: false, tablePicker: false,
    },
    refs: { root: { contains: () => true } }, onChange,
  })
  runtimes.push(runtime)
  return runtime.host
}

describe('P4-06 模式切换行为（viewModesMixin）', () => {
  beforeEach(() => {
    globalThis.window = { innerWidth: 1512, localStorage: makeStorage() }
  })
  afterEach(() => {
    delete globalThis.window
  })

  it('setMode 切态、落库并出提示；选项关闭在原生下拉层验证', () => {
    const ed = createEd()
    ed.setMode('suggest')
    expect(ed.mode).toBe('suggest')
    expect(window.localStorage.writes).toEqual([[MODE_STORAGE_KEY, 'suggest']])
    expect(ed.modeToast).toBe('已切换为修订模式')
  })

  it('setMode 幂等：当前态不重复落库或提示', () => {
    const ed = createEd()
    ed.mode = 'read'
    ed.setMode('read')
    expect(window.localStorage.writes).toEqual([])
    expect(ed.modeToast).toBe('')
  })

  it('setMode 非法 id 不改状态、不落库、不出提示', () => {
    const ed = createEd()
    ed.setMode('suggestion')
    expect(ed.mode).toBe('edit')
    expect(window.localStorage.writes).toEqual([])
    expect(ed.modeToast).toBe('')
  })

  it('reading 由 mode 派生：只有 read 为 true，修订态仍算可编辑', () => {
    const ed = createEd()
    expect(viewModesMixin.computed.reading.call(ed)).toBe(false)
    ed.mode = 'suggest'
    expect(viewModesMixin.computed.reading.call(ed)).toBe(false)
    ed.mode = 'read'
    expect(viewModesMixin.computed.reading.call(ed)).toBe(true)
  })

  it('modeLabel / modeIcon / modeOptions 跟当前态走', () => {
    const ed = createEd()
    expect(viewModesMixin.computed.modeLabel.call(ed)).toBe('编辑')
    expect(viewModesMixin.computed.modeIcon.call(ed)).toBe('mode-edit')
    ed.mode = 'suggest'
    expect(viewModesMixin.computed.modeLabel.call(ed)).toBe('修订')
    expect(viewModesMixin.computed.modeIcon.call(ed)).toBe('mode-comment')
    ed.mode = 'read'
    expect(viewModesMixin.computed.modeIcon.call(ed)).toBe('reading')
    expect(viewModesMixin.computed.modeOptions.call(ed)).toEqual(DOC_MODES)
  })

  it('隐藏入口不改变默认/持久化模式、快捷键与工具栏阅读切换', () => {
    window.localStorage = makeStorage({ [MODE_STORAGE_KEY]: 'suggest' })
    const ed = createEd({ config: { modes: { visible: false, default: 'read' } } })
    ed.restoreMode()
    expect(ed.mode).toBe('suggest')
    const event = { key: 'v', ctrlKey: true, altKey: true, preventDefault: vi.fn() }
    expect(ed.applyModeShortcut(event)).toBe(true)
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(ed.mode).toBe('read')
    ed.toggleReading()
    expect(ed.mode).toBe('edit')
    expect(window.localStorage.writes).toEqual([[MODE_STORAGE_KEY, 'read'], [MODE_STORAGE_KEY, 'edit']])
    const preview = createEd({ config: { modes: { visible: false, default: 'read', persist: false } } })
    preview.restoreMode()
    expect(preview.mode).toBe('read')
  })

  it('toggleReading 是二态入口：编辑 ↔ 阅读往返', () => {
    const ed = createEd()
    ed.toggleReading()
    expect(ed.mode).toBe('read')
    ed.toggleReading()
    expect(ed.mode).toBe('edit')
  })

  it('原生下拉定位：按按钮左侧展开，顶部 = 按钮底边 + 4', () => {
    const ui = createModeBar()
    ui.trigger.click()
    expect(ui.trigger.getAttribute('aria-expanded')).toBe('true')
    expect(ui.menu().style.minWidth).toBe('340px')
    expect(ui.menu().style.left).toBe('1088px')
    expect(ui.menu().style.top).toBe('52px')
  })

  it('原生下拉贴右时按 340px 宽度夹取，视口右侧保留 8px', () => {
    const ui = createModeBar({ rect: { left: 1416, right: 1500, top: 16, bottom: 48, width: 84 } })
    ui.trigger.click()
    expect(ui.menu().style.left).toBe('1164px')
    ui.rect.left = 1436
    ui.rect.right = 1520
    window.dispatchEvent(new window.Event('resize'))
    expect(ui.menu().style.left).toBe('1164px')
  })

  it('原生下拉贴左至少留 8px，下方不足则翻到按钮上方', () => {
    const ui = createModeBar({ rect: { left: -20, right: 64, top: 350, bottom: 382, width: 84 } })
    window.innerHeight = 400
    ui.trigger.click()
    expect(ui.menu().style.left).toBe('8px')
    expect(ui.menu().style.top).toBe('178px')
  })

  it('原生触发器二次点击收起；零布局测量仍安全展开', () => {
    const ui = createModeBar({ rect: { left: 0, right: 0, top: 0, bottom: 0, width: 0 } })
    ui.trigger.click()
    expect(ui.menu().style.left).toBe('8px')
    expect(ui.menu().style.top).toBe('4px')
    ui.trigger.click()
    expect(ui.menu()).toBe(null)
    expect(ui.trigger.getAttribute('aria-expanded')).toBe('false')
  })

  it('persistMode 写进 localStorage；restoreMode 读回三态', () => {
    globalThis.window.localStorage = makeStorage({ [MODE_STORAGE_KEY]: 'suggest' })
    const ed = createEd()
    ed.restoreMode()
    expect(ed.mode).toBe('suggest')
  })

  it('restoreMode 遇非法值 / 抛错都静默降级成编辑（隐私模式不能白屏）', () => {
    globalThis.window.localStorage = makeStorage({ [MODE_STORAGE_KEY]: 'admin' })
    const ed = createEd()
    ed.restoreMode()
    expect(ed.mode).toBe('edit')

    globalThis.window.localStorage = { getItem() { throw new Error('denied') } }
    const denied = createEd()
    expect(() => denied.restoreMode()).not.toThrow()
    expect(denied.mode).toBe('edit')
  })

  it('persistMode 写入被拒也不抛（本会话有效即可）', () => {
    globalThis.window.localStorage = { setItem() { throw new Error('quota') } }
    const ed = createEd()
    expect(() => ed.setMode('read')).not.toThrow()
    expect(ed.mode).toBe('read')
  })

  it('notifyMode 到点自动消失，且连续切换只留一个定时器', () => {
    vi.useFakeTimers()
    try {
      const ed = createEd()
      ed.notifyMode('suggest')
      const first = ed.modeToastTimer
      ed.notifyMode('read')
      expect(ed.modeToastTimer).not.toBe(first)
      expect(ed.modeToast).toBe('已切换为阅读模式')
      vi.advanceTimersByTime(MODE_TOAST_MS)
      expect(ed.modeToast).toBe('')
      expect(ed.modeToastTimer).toBe(null)
    } finally {
      vi.useRealTimers()
    }
  })

  it('卸载前清掉定时器（单页应用反复挂载不会野写 this.modeToast）', () => {
    const ed = createEd()
    ed.notifyMode('edit')
    expect(ed.modeToastTimer).not.toBe(null)
    viewModesMixin.beforeDestroy.call(ed)
    expect(ed.modeToastTimer).toBe(null)
  })
})

describe('P4-06 模式入口派发（overlayDismissMixin）', () => {
  beforeEach(() => {
    globalThis.window = { innerWidth: 1512, localStorage: makeStorage() }
  })
  afterEach(() => {
    delete globalThis.window
  })

  /** 带 preventDefault 记账的键盘事件。 */
  function keyEvent(key, mods) {
    const event = Object.assign({ key, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, target: { closest: () => null } }, mods)
    event.preventDefault = () => { event.prevented = true }
    return event
  }

  it.each([
    ['e', 'edit'], ['x', 'suggest'], ['v', 'read'],
  ])('⌘+⌥+%s 切到 %s，并 preventDefault', (key, expected) => {
    const ed = createEd()
    const event = keyEvent(key, { metaKey: true, altKey: true })
    overlayDismissMixin.methods.onWindowKeydown.call(ed, event)
    expect(ed.mode).toBe(expected)
    expect(event.prevented).toBe(true)
  })

  it('焦点在正文里的裸 e 不切模式（正文照常输入）', () => {
    const ed = createEd()
    const event = keyEvent('e', { target: { closest: () => ({ tagName: 'P' }) } })
    overlayDismissMixin.methods.onWindowKeydown.call(ed, event)
    expect(ed.mode).toBe('edit')
    expect(event.prevented).toBeUndefined()
  })

  it('焦点不在输入区的裸 e 切回编辑，并 preventDefault', () => {
    const ed = createEd()
    ed.mode = 'read'
    const event = keyEvent('e')
    overlayDismissMixin.methods.onWindowKeydown.call(ed, event)
    expect(ed.mode).toBe('edit')
    expect(event.prevented).toBe(true)
  })

  it('⌘+F / ⌘+Shift+H / ⌘+/ 未被模式分支挤掉（P4-05、P4-06 第 1 条回归）', () => {
    const find = createEd()
    find.openSearch = (tab) => { find.opened = tab }
    overlayDismissMixin.methods.onWindowKeydown.call(find, keyEvent('f', { metaKey: true }))
    expect(find.opened).toBe('find')

    const replace = createEd()
    replace.openSearch = (tab) => { replace.opened = tab }
    overlayDismissMixin.methods.onWindowKeydown.call(replace, keyEvent('h', { metaKey: true, shiftKey: true }))
    expect(replace.opened).toBe('replace')

    const help = createEd()
    help.toggleHelpOpen = () => { help.helpCalls = (help.helpCalls || 0) + 1 }
    overlayDismissMixin.methods.onWindowKeydown.call(help, keyEvent('/', { metaKey: true }))
    expect(help.helpCalls).toBe(1)
  })

  it('原生下拉点内部不关闭，document 外部 pointerdown 关闭', () => {
    const ui = createModeBar()
    ui.trigger.click()
    ui.menu().querySelector('.lark-doc-select-item-label').dispatchEvent(new window.Event('pointerdown', { bubbles: true }))
    expect(ui.menu()).not.toBe(null)
    document.body.dispatchEvent(new window.Event('pointerdown', { bubbles: true }))
    expect(ui.menu()).toBe(null)
    expect(ui.trigger.getAttribute('aria-expanded')).toBe('false')
  })

  it('原生 Esc 关闭下拉且不吞全局按键，overlay 关闭链仍回焦编辑器', () => {
    const ui = createModeBar()
    ui.trigger.click()
    const event = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    document.body.dispatchEvent(event)
    expect(ui.menu()).toBe(null)
    expect(event.defaultPrevented).toBe(false)
    ui.ed.closeOverlay()
    expect(ui.ed.focusCalls).toBe(1)
  })
})

describe('P4-06 三态规格（03 顶栏 #2 / 06 §6.2 §6.3 实测）', () => {
  it('顶栏按钮 84×32、radius 6、白底非主色、文字用正文色', () => {
    const btn = ruleFor('.lark-doc .lark-doc-mode-select .lark-doc-select-trigger')
    expect(btn).toContain('width: 84px')
    expect(btn).toContain('height: 32px')
    expect(btn).toContain('border-radius: 6px')
    expect(btn).toContain('background: var(--ld-bg-surface-chrome)')
    expect(btn).toContain('color: var(--ld-text)')
    // 03 实测是白底，绝不能改成品牌主色底（历史上有过把顶栏按钮画成蓝色的改法）。
    expect(btn).not.toContain('--ld-brand')
  })

  it('共享下拉 fixed、340px 最小宽度与5px内衬、层级1050', () => {
    expect(ruleFor('.lark-doc .lark-doc-select-menu')).toContain('position: fixed')
    expect(ruleFor('.lark-doc .lark-doc-select-menu')).toContain('border: 1px solid var(--ld-border-chrome)')
    const menu = ruleFor('.lark-doc .lark-doc-mode-select .lark-doc-select-menu')
    expect(menu).toContain('z-index: 1050')
    expect(menu).toContain('padding: 5px')
    const ui = createModeBar()
    ui.trigger.click()
    expect(ui.menu().style.minWidth).toBe(MODE_MENU_MIN_WIDTH + 'px')
  })

  it('下拉项保持左对齐两行22/18+2、上下5px内衬，自然撑高52px', () => {
    const item = ruleFor('.lark-doc .lark-doc-mode-select .lark-doc-select-menu button')
    expect(item).toContain('padding: 5px 10px')
    expect(ruleFor('.lark-doc .lark-doc-select-menu button')).toContain('text-align: left')
    expect(ruleFor('.lark-doc .lark-doc-select-text')).toContain('flex-direction: column')
    expect(ruleFor('.lark-doc .lark-doc-select-text')).toContain('gap: 2px')
    expect(ruleFor('.lark-doc .lark-doc-mode-select .lark-doc-select-item-label')).toContain('line-height: 22px')
    expect(ruleFor('.lark-doc .lark-doc-select-item-hint')).toContain('line-height: 18px')
    const labelHeight = Number(ruleFor('.lark-doc .lark-doc-mode-select .lark-doc-select-item-label').match(/line-height: (\d+)px/)[1])
    const hintHeight = Number(ruleFor('.lark-doc .lark-doc-select-item-hint').match(/line-height: (\d+)px/)[1])
    const gap = Number(ruleFor('.lark-doc .lark-doc-select-text').match(/gap: (\d+)px/)[1])
    const padding = Number(item.match(/padding: (\d+)px/)[1])
    expect(labelHeight + hintHeight + gap + padding * 2).toBe(52)
  })

  it('成功提示卡片：顶部居中、内容宽度、窄屏留边，并在打印时隐藏', () => {
    const toast = ruleFor('.lark-doc .lark-doc-mode-toast')
    expect(toast).toContain('position: fixed')
    expect(toast).toContain('z-index: 9999')
    expect(toast).toContain('top: 32px')
    expect(toast).toContain('left: 50%')
    expect(toast).toContain('transform: translateX(-50%)')
    expect(toast).toContain('width: max-content')
    expect(toast).toContain('min-height: 32px')
    expect(toast).toContain('max-width: min(420px, calc(100vw - 32px))')
    expect(toast).not.toContain('right: 0')
    const printRule = css.split('\n').find((line) => line.startsWith('@media print')) || ''
    expect(printRule).toContain('.lark-doc-mode-toast')
  })

  it('成功提示使用主题配色，不复用右下角琥珀 error toast', () => {
    const toast = ruleFor('.lark-doc .lark-doc-mode-toast')
    expect(toast).toContain('background: var(--ld-bg-surface-chrome)')
    expect(toast).not.toContain('error')
    expect(toast).not.toContain('#F54A45')
    // 老的琥珀 toast 仍在（搜索「未找到」等场景还在用），两者互不影响。
    // 那条规则和文件输入框等挤在同一行（CSS 迷你化历史遗留），不能按整行 startsWith 取。
    expect(css).toContain('.lark-doc .lark-doc-toast { position: fixed; z-index: 95;')
  })

  it('新增段零字面色值 / 零 rgba（全部走 token）', () => {
    expect(modeCssSection).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(modeCssSection).not.toMatch(/\brgba?\s*\(/)
    expect(modeCssSection).not.toMatch(/:\s*white\b/)
  })

  it('原生顶栏保留真实模式控件与宿主动作，隐藏再显示仍交还同一宿主', () => {
    const ui = createModeBar()
    const actions = ui.host.querySelector('.lark-doc-header-actions')
    expect(actions.children[0].classList.contains('lark-doc-mode-select')).toBe(true)
    expect(actions.children[1]).toBe(ui.actionsHost)
    ui.setVisible(false)
    expect(ui.host.querySelector('header')).toBe(null)
    document.body.appendChild(ui.actionsHost)
    ui.setVisible(true)
    expect(actions.children[1]).toBe(ui.actionsHost)
    expect(ui.host.querySelector('header')).toBe(ui.bar.el)
  })

  it('主组件挂提示条、根 class 带修订态、mounted 里先 restoreMode', () => {
    expect(shell).toContain("modeToast.className = 'lark-doc-mode-toast'")
    expect(renderer).toContain("shell.root.classList.toggle('lark-doc-mode-suggest', state.mode === 'suggest')")
    expect(renderer).toContain('documentHost.restoreMode()')
    // restoreMode 必须在 new Editor 之前，保证首帧 editable 就正确。
    expect(renderer.indexOf('documentHost.restoreMode()')).toBeLessThan(renderer.indexOf('new Editor('))
  })

  it('「更多」菜单里没有修订入口（07 §12.1 实测，别好心加回去）', () => {
    expect(collapseMixin).not.toContain('修订')
  })
})

describe('P4-06 原生控件与 controller 回归', () => {
  it.each(DOC_MODE_IDS)('真实菜单点击 %s 同步模式/标签/只读标题并关闭', id => {
    const ui = createModeBar()
    ui.trigger.click()
    const rows = Array.from(ui.menu().querySelectorAll('[role="option"]'))
    expect(rows.map(row => row.querySelector('.lark-doc-select-item-label').textContent)).toEqual(DOC_MODES.map(item => item.label))
    expect(rows.map(row => row.querySelector('.lark-doc-select-item-hint').textContent)).toEqual(DOC_MODES.map(item => item.hint))
    rows[DOC_MODE_IDS.indexOf(id)].click()
    expect(ui.ed.mode).toBe(id)
    expect(ui.trigger.querySelector('.lark-doc-select-label').textContent).toBe(modeLabel(id))
    expect(ui.host.querySelector('input').hasAttribute('readonly')).toBe(id === 'read')
    expect(ui.menu()).toBe(null)
    expect(window.localStorage.writes).toEqual(id === 'edit' ? [] : [[MODE_STORAGE_KEY, id]])
    expect(ui.ed.modeToast).toBe(id === 'edit' ? '' : MODE_TOAST[id])
  })

  it('hover即开，点击不误关，移开150ms后关闭；移入菜单取消关闭', () => {
    vi.useFakeTimers()
    const ui = createModeBar()
    ui.trigger.dispatchEvent(new window.MouseEvent('mouseenter'))
    ui.trigger.click()
    expect(ui.menu()).not.toBe(null)
    ui.trigger.dispatchEvent(new window.MouseEvent('mouseleave'))
    vi.advanceTimersByTime(149)
    expect(ui.menu()).not.toBe(null)
    ui.menu().dispatchEvent(new window.MouseEvent('mouseenter'))
    vi.advanceTimersByTime(1)
    expect(ui.menu()).not.toBe(null)
    ui.menu().dispatchEvent(new window.MouseEvent('mouseleave'))
    vi.advanceTimersByTime(150)
    expect(ui.menu()).toBe(null)
  })

  it('键盘上下选项与Enter真实切态，Escape关闭', () => {
    const ui = createModeBar()
    const key = value => ui.trigger.dispatchEvent(new window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }))
    key('ArrowDown')
    key('ArrowDown')
    key('Enter')
    expect(ui.ed.mode).toBe('suggest')
    expect(ui.menu()).toBe(null)
    key('ArrowUp')
    key('ArrowUp')
    key('Enter')
    expect(ui.ed.mode).toBe('edit')
    key('ArrowDown')
    key('Escape')
    expect(ui.menu()).toBe(null)
  })

  it('allow 裁剪真实下拉、labels 改写按钮和选项，未开放模式不能切入', () => {
    const ui = createModeBar({ config: { modes: { allow: ['read', 'edit'], labels: { edit: '撰写', read: '预览' }, persist: false } } })
    expect(ui.trigger.querySelector('.lark-doc-select-label').textContent).toBe('撰写')
    ui.trigger.click()
    const rows = [...ui.menu().querySelectorAll('[role="option"]')]
    expect(rows.map(row => row.querySelector('.lark-doc-select-item-label').textContent)).toEqual(['撰写', '预览'])
    ui.ed.setMode('suggest')
    expect(ui.ed.mode).toBe('edit')
    rows[1].click()
    expect(ui.ed.mode).toBe('read')
    expect(ui.trigger.querySelector('.lark-doc-select-label').textContent).toBe('预览')
    expect(ui.ed.modeToast).toBe('已切换为预览模式')
  })

  it('隐藏整个模式入口关闭已开菜单和监听，不留占位；恢复仍在同一宿主动作之前', () => {
    const ui = createModeBar()
    const select = ui.trigger.parentElement
    const actions = ui.actionsHost.parentElement
    const remove = vi.spyOn(document, 'removeEventListener')
    ui.trigger.click()
    expect(ui.menu()).not.toBe(null)
    ui.setModeVisible(false)
    expect(ui.host.querySelector('.lark-doc-mode-select')).toBe(null)
    expect(ui.menu()).toBe(null)
    expect(select.parentNode).toBe(null)
    expect(ui.trigger.getAttribute('aria-expanded')).toBe('false')
    expect(remove).toHaveBeenCalledWith('pointerdown', expect.any(Function), true)
    expect(remove).toHaveBeenCalledWith('keydown', expect.any(Function))
    expect([...actions.children]).toEqual([ui.actionsHost])
    expect(ui.host.querySelector('header')).toBe(ui.bar.el)
    expect(ui.ed.mode).toBe('edit')
    expect(window.localStorage.writes).toEqual([])
    ui.setModeVisible(true)
    expect([...actions.children]).toEqual([select, ui.actionsHost])
    expect(ui.host.querySelector('[role="combobox"]')).toBe(ui.trigger)
    ui.trigger.click()
    expect(ui.menu()).not.toBe(null)
  })

  it('单个允许模式成为静态控件，不暴露菜单语义或灰化', () => {
    const ui = createModeBar({ config: { modes: { allow: ['read'], default: 'read' } } })
    expect(ui.trigger.disabled).toBe(true)
    expect(ui.trigger.hasAttribute('aria-haspopup')).toBe(false)
    expect(ui.trigger.parentElement.classList.contains('is-static')).toBe(true)
    ui.trigger.click()
    expect(ui.menu()).toBe(null)
    expect(ruleFor('.lark-doc .lark-doc-mode-select .lark-doc-select-trigger:disabled')).toContain('opacity: 1')
    expect(ruleFor('.lark-doc .lark-doc-mode-select.is-static .lark-doc-select-caret')).toContain('display: none')
  })

  it('销毁原生菜单清除全局监听，并交还宿主动作节点', () => {
    const ui = createModeBar()
    const add = vi.spyOn(document, 'addEventListener')
    const remove = vi.spyOn(document, 'removeEventListener')
    ui.trigger.click()
    const pointer = add.mock.calls.find(call => call[0] === 'pointerdown')
    const keyboard = add.mock.calls.find(call => call[0] === 'keydown')
    ui.bar.destroy()
    expect(remove).toHaveBeenCalledWith('pointerdown', pointer[1], true)
    expect(remove).toHaveBeenCalledWith('keydown', keyboard[1])
    expect(ui.actionsHost.parentNode).toBe(null)
    expect(ui.host.querySelector('header')).toBe(null)
  })

  it('真实三态可编辑口径与controller保存：修订可写、阅读禁止改正文但仍可保存，再编辑不丢内容', async () => {
    createDom()
    const editor = new Editor({ element: document.createElement('div'), extensions: [StarterKit], content: '<p>待保存正文</p>' })
    editors.push(editor)
    const state = createWorkspaceState({ initialTitle: '文档', initialContent: '<p>待保存正文</p>', config: {} })
    state.initialized = true
    const persistence = { kind: 'host', save: vi.fn(async () => {}) }
    const runtime = createNativeOptionsHost({
      options: { mixins: [viewModesMixin, readingModeMixin] },
      state: { editor, readonly: false, larkDocConfig: {}, session: null },
      emit: (name, payload) => { if (name === 'mode-change') state.effectiveReadonly = payload.readonly },
    })
    runtimes.push(runtime)
    const ed = runtime.host
    const editorController = createEditorController({ editor })
    const workspace = createWorkspaceController({
      state, props: { persistence },
      host: {
        getEditor: () => editor, getJSON: () => editor.getJSON(), getHTML: () => editor.getHTML(),
        getText: () => editor.getText(), writable: () => ed.writable(), setReadonly: value => editorController.setReadonly(value),
        emit() {}, getWindow: () => window,
      },
    })
    ed.setMode('suggest')
    runtime.flush()
    expect(ed.interactionMode).toBe('suggest')
    expect(editor.isEditable).toBe(true)
    expect(workspace.insertText('保留修改')).toBe(true)
    const json = editor.getJSON()
    ed.setMode('read')
    runtime.flush()
    expect(ed.interactionMode).toBe('read')
    expect(editor.isEditable).toBe(false)
    expect(workspace.isReadonly()).toBe(true)
    expect(workspace.insertText('不得写入')).toBe(false)
    expect(workspace.setTitle('不得改标题')).toBe(false)
    expect(editor.getJSON()).toEqual(json)
    await workspace.saveNow(true)
    expect(persistence.save).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ title: '文档', json }))
    ed.setMode('edit')
    runtime.flush()
    expect(editor.isEditable).toBe(true)
    expect(workspace.isReadonly()).toBe(false)
    expect(ed.editor).toBe(editor)
    expect(editor.getJSON()).toEqual(json)
    expect(workspace.setReadonly(true)).toBe(true)
    expect(workspace.isReadonly()).toBe(true)
    expect(workspace.insertText('宿主只读也不得写入')).toBe(false)
    expect(workspace.setReadonly(false)).toBe(true)
    expect(editor.isEditable).toBe(true)
    expect(editor.getJSON()).toEqual(json)
  })
})
