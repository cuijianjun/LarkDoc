/**
 * P4-06 三态模式切换（编辑 / 修订 / 阅读）单测 —— Node 环境、无 DOM。
 * 规格出处：07 §1 / §1.1 / §12.1；尺寸与层级出处：03 顶栏按钮组 #2、06 §6.2、06 §6.3。
 *
 * 顶栏按钮与下拉都是 .vue（本仓库单测禁止 import .vue），所以照 help-drawer.test.js 的老三层守：
 *  1. 数据层：import docModes.js，锁三项文案 / 顺序 / 提示语 / 键位判定；
 *  2. 行为层：import viewModesMixin + overlayDismissMixin，用假宿主直测
 *     切换幂等、持久化降级、下拉定位、提示条定时器、三套键位派发；
 *  3. 规格层：读 css / TopBar.vue / LarkDocEditor.vue 文本，锁 84×32 / 180×160 / 170×50 /
 *     顶部条 16 高 @y32 / z 9999，以及「slot 必须还在」「没给『更多』菜单加修订入口」这两条回归点。
 *
 * 🔴 这批像素或文案一变就要同步改这里 —— 它们是「飞书实测值」的唯一守卫。
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DOC_MODES, DOC_MODE_IDS, MODE_ICONS, MODE_MENU_HEIGHT, MODE_MENU_ITEM_HEIGHT, MODE_MENU_ITEM_WIDTH,
  MODE_MENU_WIDTH, MODE_STORAGE_KEY, MODE_TOAST, MODE_TOAST_MS,
  isDocMode, isEditableTarget, modeFromShortcut, modeLabel, modeMeta, modeToastText,
} from '../../src/components/lark-doc/editor/docModes'
import viewModesMixin from '../../src/components/lark-doc/editor/viewModesMixin'
import overlayDismissMixin from '../../src/components/lark-doc/editor/overlayDismissMixin'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const css = fs.readFileSync(path.join(root, 'src/components/lark-doc/lark-doc.css'), 'utf8')
const topbar = fs.readFileSync(path.join(root, 'src/components/lark-doc/editor/TopBar.vue'), 'utf8')
const editorVue = fs.readFileSync(path.join(root, 'src/components/lark-doc/LarkDocEditor.vue'), 'utf8')
const icons = fs.readFileSync(path.join(root, 'src/ui/icons.js'), 'utf8')
const collapseMixin = fs.readFileSync(path.join(root, 'src/components/lark-doc/editor/toolbarCollapseMixin.js'), 'utf8')

/** 取一条单行 CSS 规则（本仓库 CSS 一律一行一条，读整行即可）。 */
function ruleFor(selector) {
  return css.split('\n').find((line) => line.startsWith(`${selector} {`)) || ''
}

/** P4-06 新增的那一段（从三态起到底），用来验「这一段不许出现字面色值」。 */
const modeCssSection = css.slice(css.indexOf('.lark-doc .lark-doc-mode-switch {'))
if (!modeCssSection) throw new Error('lark-doc.css 里找不到 P4-06 三态样式段')

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

  it('下拉尺寸 180×160，三项各 170×50 ⇒ 四周各留 5px', () => {
    expect([MODE_MENU_WIDTH, MODE_MENU_HEIGHT]).toEqual([180, 160])
    expect([MODE_MENU_ITEM_WIDTH, MODE_MENU_ITEM_HEIGHT]).toEqual([170, 50])
    expect(MODE_MENU_ITEM_WIDTH * 1 + 5 * 2).toBe(MODE_MENU_WIDTH)
    expect(MODE_MENU_ITEM_HEIGHT * 3 + 5 * 2).toBe(MODE_MENU_HEIGHT)
  })

  it('图标映射：阅读复用既有 reading，另两个是新画的', () => {
    expect(MODE_ICONS).toEqual({ edit: 'mode-edit', suggest: 'mode-comment', read: 'reading' })
    // 三个 key 都必须真的在 ICONS 表里（键名带连字符的加了引号，reading 是裸标识符），
    // 否则 LarkDocIcon 查不到会静默渲染空 span —— 按钮上就只剩文字。
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

/** 假宿主：viewModesMixin（被测）+ overlayDismissMixin（入口层）+ 这两个方法读到的零散状态。 */
function createEd() {
  const ed = {
    mode: 'edit', modeMenuOpen: false, modeMenuPos: null, modeToast: '', modeToastTimer: null,
    focusCalls: 0,
    headingNumberMenu: { open: false },
    helpOpen: false, isvPanelOpen: false, menuOpen: false, mentionOpen: false, reminderOpen: false,
    calendarOpen: false, blockMenuOpen: false, blockTypeMenuOpen: false, blockAlignMenuOpen: false,
    blockColorMenuOpen: false, bubbleAlignOpen: false, bubbleHeadingOpen: false, calloutEmojiOpen: false,
    colorPaletteOpen: '', headerMenuOpen: false, diagramMenuOpen: false, tableToolsOpen: false,
    searchOpen: false, headingOpen: false, mathDialog: '', linkDialog: false, tablePicker: false,
    $refs: { root: { contains: () => true } },
    focus() { ed.focusCalls += 1 },
  }
  // reading 在真身里是 computed，假宿主用 getter 复刻同一语义。
  Object.defineProperty(ed, 'reading', { get() { return ed.mode === 'read' } })
  Object.assign(ed, viewModesMixin.methods, overlayDismissMixin.methods)
  return ed
}

describe('P4-06 模式切换行为（viewModesMixin）', () => {
  beforeEach(() => {
    globalThis.window = { innerWidth: 1512, localStorage: makeStorage() }
  })
  afterEach(() => {
    delete globalThis.window
  })

  it('setMode 切态 + 关菜单 + 落库 + 出提示', () => {
    const ed = createEd()
    ed.modeMenuOpen = true
    ed.setMode('suggest')
    expect(ed.mode).toBe('suggest')
    expect(ed.modeMenuOpen).toBe(false)
    expect(window.localStorage.writes).toEqual([[MODE_STORAGE_KEY, 'suggest']])
    expect(ed.modeToast).toBe('已切换为修订模式')
  })

  it('setMode 幂等：切到当前态只关菜单，不重复落库也不重复提示', () => {
    const ed = createEd()
    ed.mode = 'read'
    ed.modeMenuOpen = true
    ed.setMode('read')
    expect(ed.modeMenuOpen).toBe(false)
    expect(window.localStorage.writes).toEqual([])
    expect(ed.modeToast).toBe('')
  })

  it('setMode 非法 id 不改状态、只关菜单', () => {
    const ed = createEd()
    ed.modeMenuOpen = true
    ed.setMode('suggestion')
    expect(ed.mode).toBe('edit')
    expect(ed.modeMenuOpen).toBe(false)
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
    expect(viewModesMixin.computed.modeOptions.call(ed)).toBe(DOC_MODES)
  })

  it('toggleReading 是二态入口：编辑 ↔ 阅读往返', () => {
    const ed = createEd()
    ed.toggleReading()
    expect(ed.mode).toBe('read')
    ed.toggleReading()
    expect(ed.mode).toBe('edit')
  })

  it('toggleModeMenu 定位：右缘对齐菜单右缘，top = 按钮底边 + 2（84×32 @1088,16）', () => {
    const ed = createEd()
    ed.toggleModeMenu({ getBoundingClientRect: () => ({ right: 1172, bottom: 48 }) })
    expect(ed.modeMenuOpen).toBe(true)
    expect(ed.modeMenuPos).toEqual({ left: 992, top: 50 })
    expect(viewModesMixin.computed.modeMenuStyle.call(ed)).toEqual({ left: '992px', top: '50px' })
  })

  it('toggleModeMenu 右侧夹取：贴右边时菜单左移留 8px', () => {
    const ed = createEd()
    ed.toggleModeMenu({ getBoundingClientRect: () => ({ right: 1500, bottom: 48 }) })
    // 1500 - 180 = 1320 < 1512 - 180 - 8 = 1324 ⇒ 不触顶，保持右缘对齐。
    expect(ed.modeMenuPos.left).toBe(1320)
    // 真的贴到视口右缘（right = 1520 越界）才夹到 1324。
    const flush = createEd()
    flush.toggleModeMenu({ getBoundingClientRect: () => ({ right: 1520, bottom: 48 }) })
    expect(flush.modeMenuPos.left).toBe(1324)
  })

  it('toggleModeMenu 左侧夹取：贴左边时菜单至少留 8px', () => {
    const ed = createEd()
    ed.toggleModeMenu({ getBoundingClientRect: () => ({ right: 100, bottom: 48 }) })
    expect(ed.modeMenuPos.left).toBe(8)
  })

  it('toggleModeMenu 二次点击收起；无锚点时仍能展开（坐标留空用 CSS 兜）', () => {
    const ed = createEd()
    ed.toggleModeMenu(null)
    expect(ed.modeMenuOpen).toBe(true)
    expect(ed.modeMenuPos).toBe(null)
    expect(viewModesMixin.computed.modeMenuStyle.call(ed)).toBe(null)
    ed.toggleModeMenu(null)
    expect(ed.modeMenuOpen).toBe(false)
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

  it('点外部收下拉；点下拉自身（含按钮）不拦', () => {
    const ed = createEd()
    ed.modeMenuOpen = true
    overlayDismissMixin.methods.onDocumentPointerDown.call(ed, { target: { closest: () => null } })
    expect(ed.modeMenuOpen).toBe(false)

    ed.modeMenuOpen = true
    overlayDismissMixin.methods.onDocumentPointerDown.call(ed, {
      target: { closest: (sel) => (sel === '.lark-doc-mode-switch' ? { className: 'lark-doc-mode-switch' } : null) },
    })
    expect(ed.modeMenuOpen).toBe(true)
  })

  it('closeOverlay 收掉下拉并回焦（Esc 复用同一条互斥链）', () => {
    const ed = createEd()
    ed.modeMenuOpen = true
    overlayDismissMixin.methods.closeOverlay.call(ed)
    expect(ed.modeMenuOpen).toBe(false)
    expect(ed.focusCalls).toBe(1)
  })
})

describe('P4-06 三态规格（03 顶栏 #2 / 06 §6.2 §6.3 实测）', () => {
  it('顶栏按钮 84×32、radius 6、白底非主色、文字用正文色', () => {
    const btn = ruleFor('.lark-doc .lark-doc-mode-btn')
    expect(btn).toContain('width: 84px')
    expect(btn).toContain('height: 32px')
    expect(btn).toContain('border-radius: 6px')
    expect(btn).toContain('background: var(--ld-bg-surface-chrome)')
    expect(btn).toContain('color: var(--ld-text)')
    // 03 实测是白底，绝不能改成品牌主色底（历史上有过把顶栏按钮画成蓝色的改法）。
    expect(btn).not.toContain('--ld-brand')
  })

  it('下拉 180×160、四周 5px 内衬、fixed + 层级 1050（顶栏子面板档）', () => {
    const menu = ruleFor('.lark-doc .lark-doc-mode-menu')
    expect(menu).toContain('position: fixed')
    expect(menu).toContain('z-index: 1050')
    expect(menu).toContain(`width: ${MODE_MENU_WIDTH}px`)
    expect(menu).toContain(`height: ${MODE_MENU_HEIGHT}px`)
    expect(menu).toContain('padding: 5px')
  })

  it('下拉项 170×50，两行（主标题 22 + 副标题 18 + 2 间距 = 42 ≤ 50）', () => {
    const item = ruleFor('.lark-doc .lark-doc-mode-item')
    expect(item).toContain(`width: ${MODE_MENU_ITEM_WIDTH}px`)
    expect(item).toContain(`height: ${MODE_MENU_ITEM_HEIGHT}px`)
    expect(item).toContain('flex-direction: column')
    expect(ruleFor('.lark-doc .lark-doc-mode-item-label')).toContain('line-height: 22px')
    expect(ruleFor('.lark-doc .lark-doc-mode-item-hint')).toContain('line-height: 18px')
  })

  it('顶部提示条：fixed / 通栏 / 16 高 @y32 / z 9999（06 §6.2）+ 打印隐藏', () => {
    const toast = ruleFor('.lark-doc .lark-doc-mode-toast')
    expect(toast).toContain('position: fixed')
    expect(toast).toContain('z-index: 9999')
    expect(toast).toContain('top: 32px')
    expect(toast).toContain('height: 16px')
    expect(toast).toContain('left: 0')
    expect(toast).toContain('right: 0')
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

  it('TopBar 里模式按钮插在 slot 之前，宿主控件（slot）必须仍然存在', () => {
    expect(topbar).toContain('<slot name="header-actions" />')
    const btnIndex = topbar.indexOf('lark-doc-mode-btn')
    const slotIndex = topbar.indexOf('<slot name="header-actions" />')
    expect(btnIndex).toBeGreaterThan(-1)
    expect(btnIndex).toBeLessThan(slotIndex)
    // 图标组件要在子组件里注册，否则模板里的 <lark-doc-icon> 不会渲染。
    expect(topbar).toMatch(/components:\s*\{[^}]*\bLarkDocIcon\b/)
  })

  it('主组件挂提示条、根 class 带修订态、mounted 里先 restoreMode', () => {
    expect(editorVue).toContain('class="lark-doc-mode-toast"')
    expect(editorVue).toContain("'lark-doc-mode-suggest': mode === 'suggest'")
    expect(editorVue).toContain('this.restoreMode()')
    // restoreMode 必须在 new Editor 之前 —— 否则首帧 editable 会按旧默认值建出来再回滚。
    expect(editorVue.indexOf('this.restoreMode()')).toBeLessThan(editorVue.indexOf('new Editor('))
  })

  it('「更多」菜单里没有修订入口（07 §12.1 实测，别好心加回去）', () => {
    expect(collapseMixin).not.toContain('修订')
  })
})
