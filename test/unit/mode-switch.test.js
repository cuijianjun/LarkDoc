// @vitest-environment jsdom

/**
 * 三态模式回归：数据与快捷键、真实 nativeOptionsHost 的业务行为、原生顶栏共享 select。
 * 菜单开合与定位归 src/ui/select.js，业务宿主不再维护旧菜单状态。
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DOC_MODES, DOC_MODE_IDS, MODE_ICONS, MODE_MENU_MIN_WIDTH, MODE_STORAGE_KEY, MODE_TOAST, MODE_TOAST_MS,
  isDocMode, isEditableTarget, modeFromShortcut, modeLabel, modeMeta, modeToastText,
} from '../../src/components/lark-doc/editor/docModes'
import viewModesMixin from '../../src/components/lark-doc/editor/viewModesMixin'
import overlayDismissMixin from '../../src/components/lark-doc/editor/overlayDismissMixin'
import toolbarUiMixin from '../../src/components/lark-doc/editor/toolbarUiMixin'
import readingModeMixin from '../../src/components/lark-doc/editor/readingModeMixin'
import { createNativeOptionsHost } from '../../src/editor/nativeOptionsHost'
import { createTopBar } from '../../src/ui/topBar'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const css = fs.readFileSync(path.join(root, 'src/components/lark-doc/lark-doc.css'), 'utf8')
const nativeHost = fs.readFileSync(path.join(root, 'src/editor/nativeEditorHost.js'), 'utf8')
const renderer = fs.readFileSync(path.join(root, 'src/mount/domRenderer.js'), 'utf8')
const shell = fs.readFileSync(path.join(root, 'src/ui/workspaceShell.js'), 'utf8')
const icons = fs.readFileSync(path.join(root, 'src/ui/icons.js'), 'utf8')
const collapseMixin = fs.readFileSync(path.join(root, 'src/components/lark-doc/editor/toolbarCollapseMixin.js'), 'utf8')

/** 取一条单行 CSS 规则（本仓库 CSS 一律一行一条，读整行即可）。 */
function ruleFor(selector) {
  return css.split('\n').find((line) => line.startsWith(`${selector} {`)) || ''
}

/** 只检查当前模式 UI 的规则，避免旧选择器消失后误取文件末尾。 */
const modeCssSection = css.split('\n').filter(line => line.startsWith('.lark-doc .lark-doc-mode-')).join('\n')
if (!modeCssSection) throw new Error('lark-doc.css 里找不到三态样式规则')

describe('P4-06 三态数据（07 §1.1 三项文案原样）', () => {
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

  it('共享下拉保留 340px 最小宽度，高度由选项自然撑开', () => {
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

describe('跨端 viewport runtime', () => {
  it('响应窄屏与横屏变化，并在销毁时移除监听', () => {
    const source = fs.readFileSync(path.join(root, 'src/components/lark-doc/editor/viewModesMixin.js'), 'utf8')
    expect(source).toContain('viewportWidth')
    expect(source).toContain('viewportOrientation')
    expect(source).toContain("window.addEventListener('orientationchange'")
    expect(source).toContain("window.removeEventListener('orientationchange'")
    expect(source).toContain("window.addEventListener('resize'")
  })

  it('原生宿主投影窄屏与横屏 class，便于移动端 CSS 降级', () => {
    expect(nativeHost).toContain("this.$refs.root.classList.toggle('lark-doc-narrow', this.isNarrowViewport)")
    expect(nativeHost).toContain("this.$refs.root.classList.toggle('lark-doc-landscape', this.viewportOrientation === 'landscape')")
    const ed = createEd()
    vi.stubGlobal('innerWidth', 600)
    vi.stubGlobal('innerHeight', 900)
    ed.syncViewportState()
    expect(ed.isNarrowViewport).toBe(true)
    expect(ed.viewportOrientation).toBe('portrait')
    vi.stubGlobal('innerWidth', 900)
    vi.stubGlobal('innerHeight', 600)
    ed.syncViewportState()
    expect(ed.isNarrowViewport).toBe(false)
    expect(ed.viewportOrientation).toBe('landscape')
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

const runtimes = []
const topBars = []

beforeEach(() => {
  vi.stubGlobal('localStorage', makeStorage())
  vi.stubGlobal('innerWidth', 1512)
  vi.stubGlobal('innerHeight', 982)
})

afterEach(() => {
  topBars.splice(0).reverse().forEach(ui => ui.destroy())
  runtimes.splice(0).reverse().forEach(runtime => runtime.destroy())
  document.body.textContent = ''
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

/** 使用真实 computed 依赖与 watch 调度，不手工复制模式派生链。 */
function createEd() {
  const runtime = createNativeOptionsHost({
    options: {
      mixins: [viewModesMixin, overlayDismissMixin, readingModeMixin, toolbarUiMixin],
      computed: { effectiveReadonly() { return this.interactionMode === 'read' } },
      methods: { focus() { this.focusCalls += 1 } },
    },
    state: {
      focusCalls: 0,
      headingNumberMenu: { open: false },
      larkDocConfig: { layout: { headerVisible: true } },
      localTitle: '模式测试',
    },
    refs: { root: document.body },
  })
  runtimes.push(runtime)
  return runtime.host
}

function mountTopBar() {
  const ed = createEd()
  const actionsHost = document.createElement('div')
  const ui = createTopBar({ host: document.body, actionsHost, handlers: { setMode: id => ed.setMode(id) } })
  topBars.push(ui)
  ed._topBarUi = ui
  ed.refreshTopBar()
  return {
    ed, ui, actionsHost,
    trigger: ui.el.querySelector('[role="combobox"]'),
    menu: () => ui.el.querySelector('[role="listbox"]'),
    rows: () => [...ui.el.querySelectorAll('[role="option"]')],
  }
}

describe('P4-06 模式切换行为（viewModesMixin）', () => {
  it('setMode 切态 + 落库 + 出提示 + 同步修订追踪', () => {
    const ed = createEd()
    ed.syncRevisionTracking = vi.fn()
    ed.setMode('suggest')
    expect(ed.mode).toBe('suggest')
    expect(window.localStorage.writes).toEqual([[MODE_STORAGE_KEY, 'suggest']])
    expect(ed.modeToast).toBe('已切换为修订模式')
    expect(ed.syncRevisionTracking).toHaveBeenCalledTimes(1)
  })

  it('setMode 幂等：不重复落库也不重复提示', () => {
    const ed = createEd()
    ed.mode = 'read'
    ed.setMode('read')
    expect(window.localStorage.writes).toEqual([])
    expect(ed.modeToast).toBe('')
  })

  it('setMode 非法或未开放 id 不改状态、不落库、不提示', () => {
    const ed = createEd()
    ed.larkDocConfig.modes = { allow: ['edit', 'read'] }
    ed.setMode('suggestion')
    ed.setMode('suggest')
    expect(ed.mode).toBe('edit')
    expect(window.localStorage.writes).toEqual([])
    expect(ed.modeToast).toBe('')
  })

  it('reading 由 mode 派生：只有 read 为 true，修订态仍算可编辑', () => {
    const ed = createEd()
    expect(ed.reading).toBe(false)
    ed.mode = 'suggest'
    expect(ed.reading).toBe(false)
    ed.mode = 'read'
    expect(ed.reading).toBe(true)
  })

  it('modeLabel / modeIcon / modeOptions 跟当前态走', () => {
    const ed = createEd()
    expect(ed.modeLabel).toBe('编辑')
    expect(ed.modeIcon).toBe('mode-edit')
    ed.mode = 'suggest'
    expect(ed.modeLabel).toBe('修订')
    expect(ed.modeIcon).toBe('mode-comment')
    ed.mode = 'read'
    expect(ed.modeIcon).toBe('reading')
    expect(ed.modeOptions).toEqual(DOC_MODES)
  })

  it('toggleReading 是二态入口：编辑 ↔ 阅读往返', () => {
    const ed = createEd()
    ed.toggleReading()
    expect(ed.mode).toBe('read')
    ed.toggleReading()
    expect(ed.mode).toBe('edit')
  })

  it('修订可编辑，阅读禁用编辑器，切回编辑恢复可写', async () => {
    const ed = createEd()
    const editor = {
      isEditable: true, isDestroyed: false,
      setEditable: vi.fn(function (value) { this.isEditable = value }),
      emit: vi.fn(),
    }
    ed.editor = editor
    ed.setMode('suggest')
    await ed.$nextTick()
    expect(ed.effectiveReadonly).toBe(false)
    expect(ed.writable()).toBe(true)
    expect(editor.setEditable).not.toHaveBeenCalled()
    ed.setMode('read')
    await ed.$nextTick()
    expect(ed.effectiveReadonly).toBe(true)
    expect(ed.writable()).toBe(false)
    expect(editor.setEditable).toHaveBeenLastCalledWith(false)
    ed.setMode('edit')
    await ed.$nextTick()
    expect(ed.writable()).toBe(true)
    expect(editor.setEditable).toHaveBeenLastCalledWith(true)
  })

  it('persist 关闭时使用配置默认态，不读写存储', () => {
    const ed = createEd()
    ed.larkDocConfig.modes = { default: 'read', persist: false }
    window.localStorage.store[MODE_STORAGE_KEY] = 'suggest'
    ed.restoreMode()
    expect(ed.mode).toBe('read')
    ed.setMode('edit')
    expect(window.localStorage.writes).toEqual([])
  })

  it('存储模式被 allow 移除后回落配置默认态', () => {
    const ed = createEd()
    ed.larkDocConfig.modes = { allow: ['edit', 'read'], default: 'read' }
    window.localStorage.store[MODE_STORAGE_KEY] = 'suggest'
    ed.restoreMode()
    expect(ed.mode).toBe('read')
  })

  it('persistMode 写进 localStorage；restoreMode 读回三态', () => {
    vi.stubGlobal('localStorage', makeStorage({ [MODE_STORAGE_KEY]: 'suggest' }))
    const ed = createEd()
    ed.restoreMode()
    expect(ed.mode).toBe('suggest')
  })

  it('restoreMode 遇非法值 / 抛错都静默降级成编辑（隐私模式不能白屏）', () => {
    vi.stubGlobal('localStorage', makeStorage({ [MODE_STORAGE_KEY]: 'admin' }))
    const ed = createEd()
    ed.restoreMode()
    expect(ed.mode).toBe('edit')

    vi.stubGlobal('localStorage', { getItem() { throw new Error('denied') } })
    const denied = createEd()
    expect(() => denied.restoreMode()).not.toThrow()
    expect(denied.mode).toBe('edit')
  })

  it('persistMode 写入被拒也不抛（本会话有效即可）', () => {
    vi.stubGlobal('localStorage', { setItem() { throw new Error('quota') } })
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

  it('禁用快捷键或移除对应模式后不吞组合键', () => {
    const ed = createEd()
    ed.larkDocConfig.modes = { shortcuts: false }
    const disabled = keyEvent('x', { metaKey: true, altKey: true })
    ed.onWindowKeydown(disabled)
    expect(disabled.prevented).toBeUndefined()
    ed.larkDocConfig.modes = { allow: ['edit', 'read'] }
    const removed = keyEvent('x', { metaKey: true, altKey: true })
    ed.onWindowKeydown(removed)
    expect(removed.prevented).toBeUndefined()
    expect(ed.mode).toBe('edit')
  })
})

describe('原生顶栏模式菜单（共享 select + nativeOptionsHost）', () => {
  it('渲染三项文案与当前选中，选中新模式后关闭并同步按钮、存储和只读 UI', async () => {
    const { ed, ui, trigger, menu, rows } = mountTopBar()
    trigger.click()
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(rows().map(row => row.querySelector('.lark-doc-select-item-label').textContent)).toEqual(DOC_MODES.map(item => item.label))
    expect(rows().map(row => row.querySelector('.lark-doc-select-item-hint').textContent)).toEqual(DOC_MODES.map(item => item.hint))
    expect(rows().map(row => row.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false'])
    rows()[2].click()
    expect(menu()).toBeNull()
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    await ed.$nextTick()
    expect(ed.mode).toBe('read')
    expect(window.localStorage.writes).toEqual([[MODE_STORAGE_KEY, 'read']])
    expect(ed.modeToast).toBe('已切换为阅读模式')
    expect(trigger.querySelector('.lark-doc-select-label').textContent).toBe('阅读')
    expect(trigger.getAttribute('aria-label')).toBe('切换文档模式，当前阅读')
    expect(ui.el.querySelector('input').readOnly).toBe(true)
    expect(ui.el.querySelector('.lark-doc-title-sub').textContent).toBe('阅读中')
    trigger.click()
    expect(rows().map(row => row.getAttribute('aria-selected'))).toEqual(['false', 'false', 'true'])
  })

  it('点当前项仍关闭菜单，但不重复触发业务切换', () => {
    const { ed, trigger, menu, rows } = mountTopBar()
    const change = vi.spyOn(ed, 'setMode')
    trigger.click()
    rows()[0].click()
    expect(menu()).toBeNull()
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(change).not.toHaveBeenCalled()
    expect(window.localStorage.writes).toEqual([])
    expect(ed.modeToast).toBe('')
  })

  it.each(['trigger', 'outside'])('Esc 在 %s 焦点下均关闭菜单', (focus) => {
    const { trigger, menu } = mountTopBar()
    trigger.click()
    const target = focus === 'trigger' ? trigger : document.createElement('input')
    if (focus === 'outside') document.body.appendChild(target)
    target.focus()
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    target.dispatchEvent(event)
    expect(menu()).toBeNull()
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(event.defaultPrevented).toBe(false)
  })

  it('外部 pointerdown 关闭，菜单内部与触发按钮上的 pointerdown 不误关', () => {
    const { trigger, menu, rows } = mountTopBar()
    trigger.click()
    rows()[1].querySelector('.lark-doc-select-item-label').dispatchEvent(new Event('pointerdown', { bubbles: true }))
    trigger.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(menu()).not.toBeNull()
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(menu()).toBeNull()
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  })

  it('键盘上下选择并用 Enter 切换，二次点击触发按钮收起', async () => {
    const { ed, trigger, menu } = mountTopBar()
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    expect(menu()).not.toBeNull()
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(menu()).toBeNull()
    await ed.$nextTick()
    expect(ed.mode).toBe('suggest')
    trigger.click()
    expect(menu()).not.toBeNull()
    trigger.click()
    expect(menu()).toBeNull()
  })

  it('动态 labels/allow 经真实 computed 与 watch 更新，单项时关闭并退化为静态按钮', async () => {
    const { ed, trigger, menu, rows } = mountTopBar()
    trigger.click()
    const first = rows()[0]
    ed.larkDocConfig.modes = { labels: { edit: '撰写' } }
    await ed.$nextTick()
    expect(menu()).not.toBeNull()
    expect(rows()[0]).toBe(first)
    expect(first.querySelector('.lark-doc-select-item-label').textContent).toBe('撰写')
    expect(trigger.querySelector('.lark-doc-select-label').textContent).toBe('撰写')
    ed.larkDocConfig.modes = { allow: ['edit', 'read'], labels: { read: '浏览' } }
    await ed.$nextTick()
    expect(rows().map(row => row.querySelector('.lark-doc-select-item-label').textContent)).toEqual(['编辑', '浏览'])
    rows()[1].click()
    await ed.$nextTick()
    expect(ed.mode).toBe('read')
    expect(ed.modeToast).toBe('已切换为浏览模式')
    trigger.click()
    ed.larkDocConfig.modes = { allow: ['read'], labels: { read: '浏览' } }
    await ed.$nextTick()
    expect(menu()).toBeNull()
    expect(trigger.disabled).toBe(true)
    expect(trigger.hasAttribute('aria-haspopup')).toBe(false)
    expect(trigger.parentElement.classList.contains('is-static')).toBe(true)
    trigger.click()
    expect(menu()).toBeNull()
    ed.larkDocConfig.modes = { allow: ['edit', 'read'] }
    await ed.$nextTick()
    expect(trigger.disabled).toBe(false)
    expect(trigger.getAttribute('aria-haspopup')).toBe('listbox')
    trigger.click()
    expect(rows()).toHaveLength(2)
  })

  it.each([
    [100, 100], [1400, 1164], [-20, 8],
  ])('共享 select 按按钮 left=%s 定位并夹取至 %s', (left, expected) => {
    const { trigger, menu } = mountTopBar()
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({ left, top: 16, bottom: 48, width: 84 })
    trigger.click()
    expect(menu().style.minWidth).toBe(`${MODE_MENU_MIN_WIDTH}px`)
    expect(menu().style.left).toBe(`${expected}px`)
    expect(menu().style.top).toBe('52px')
  })

  it('模式选择器与宿主动作节点并存，隐藏再显示顶栏也不丢宿主', () => {
    const { ed, ui, actionsHost, trigger } = mountTopBar()
    expect(trigger.parentElement.nextSibling).toBe(actionsHost)
    expect(actionsHost.parentElement.className).toBe('lark-doc-header-actions')
    ui.update({ ...ed.buildTopBarState(), headerVisible: false })
    expect(ui.el.isConnected).toBe(false)
    document.body.appendChild(actionsHost)
    ed.refreshTopBar()
    expect(ui.el.isConnected).toBe(true)
    expect(trigger.parentElement.nextSibling).toBe(actionsHost)
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

  it('共享菜单 fixed、模式换皮保留层级 1050 与四周 5px 内衬', () => {
    expect(ruleFor('.lark-doc .lark-doc-select-menu')).toContain('position: fixed')
    const menu = ruleFor('.lark-doc .lark-doc-mode-select .lark-doc-select-menu')
    expect(menu).toContain('z-index: 1050')
    expect(menu).toContain('padding: 5px')
    expect(menu).not.toMatch(/(?:^|[;{])\s*height:/)
  })

  it('模式项沿用共享两行布局，主标题行高 22px', () => {
    expect(ruleFor('.lark-doc .lark-doc-select-text')).toContain('flex-direction: column')
    expect(ruleFor('.lark-doc .lark-doc-mode-select .lark-doc-select-item-label')).toContain('line-height: 22px')
    expect(ruleFor('.lark-doc .lark-doc-select-item-hint')).toContain('line-height: 18px')
  })

  it('顶部提示居中：fixed / 16px 行高 / y32 / z 9999 + 打印隐藏', () => {
    const toast = ruleFor('.lark-doc .lark-doc-mode-toast')
    expect(toast).toContain('position: fixed')
    expect(toast).toContain('z-index: 9999')
    expect(toast).toContain('top: 32px')
    expect(toast).toContain('line-height: 16px')
    expect(toast).toContain('left: 50%')
    expect(toast).toContain('transform: translateX(-50%)')
    const printRule = css.split('\n').find((line) => line.startsWith('@media print')) || ''
    expect(printRule).toContain('.lark-doc-mode-toast')
  })

  it('提示条是中性条：不复用右下角琥珀 error toast', () => {
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
