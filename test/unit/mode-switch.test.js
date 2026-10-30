/**
 * P4-06 三态模式切换（编辑 / 修订 / 阅读）单测 —— Node 环境、无 DOM。
 * 规格出处：07 §1 / §1.1 / §12.1；尺寸与层级出处：03 顶栏按钮组 #2、06 §6.2、06 §6.3。
 * 顶栏按钮与下拉已经由原生 renderer 接管，所以照 help-drawer.test.js 的三层守：
 *  1. 数据层：import docModes.js，锁三项文案 / 顺序 / 提示语 / 键位判定；
 *  2. 行为层：import viewModesMixin + overlayDismissMixin，用假宿主直测
 *     切换幂等、持久化降级、提示条定时器、三套键位派发；
 *  3. 规格层：读 css / src/ui/topBar.js / LarkDocEditor.vue 文本，锁 84×32 / 菜单最小宽 340 /
 *     顶部条 16 高 @y32 / z 9999，以及「原生动作宿主仍在」「没给『更多』菜单加修订入口」这两条回归点。
 *
 * ⚠️ 下拉本身（开合 / 定位 / Esc / 键盘）不在这里测 —— 顶栏用的是共享下拉原语
 * `src/ui/select.js`（与工具栏「字号」同一套），它要真 DOM，由浏览器脚本
 * `scripts/verify-browser-toolbar.js` 负责。这里只守「mixins 不再自己管一套开合」。
 *
 * 🔴 这批像素或文案一变就要同步改这里 —— 它们是「飞书实测值」的唯一守卫。
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_MODES_CONFIG, DOC_MODES, DOC_MODE_IDS, MODE_ICONS, MODE_MENU_MIN_WIDTH,
  MODE_STORAGE_KEY, MODE_TOAST, MODE_TOAST_MS,
  isDocMode, isEditableTarget, modeFromShortcut, modeLabel, modeMeta, modeToastText,
  normalizeModesConfig, resolveModeOptions,
} from '../../src/components/lark-doc/editor/docModes'
import viewModesMixin from '../../src/components/lark-doc/editor/viewModesMixin'
import overlayDismissMixin from '../../src/components/lark-doc/editor/overlayDismissMixin'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const css = fs.readFileSync(path.join(root, 'src/components/lark-doc/lark-doc.css'), 'utf8')
const topbar = fs.readFileSync(path.join(root, 'src/ui/topBar.js'), 'utf8')
/** 去掉块注释的顶栏源码 —— 反向守卫只看真代码，注释里写明「旧 API 已删除」不算残留。 */
const topbarCode = topbar.replace(/\/\*[\s\S]*?\*\//g, '')
const editorVue = fs.readFileSync(path.join(root, 'src/components/lark-doc/LarkDocEditor.vue'), 'utf8')
const icons = fs.readFileSync(path.join(root, 'src/ui/icons.js'), 'utf8')
const collapseMixin = fs.readFileSync(path.join(root, 'src/components/lark-doc/editor/toolbarCollapseMixin.js'), 'utf8')
const viewModesSource = fs.readFileSync(path.join(root, 'src/components/lark-doc/editor/viewModesMixin.js'), 'utf8')
const overlaySource = fs.readFileSync(path.join(root, 'src/components/lark-doc/editor/overlayDismissMixin.js'), 'utf8')
const toolbarUiSource = fs.readFileSync(path.join(root, 'src/components/lark-doc/editor/toolbarUiMixin.js'), 'utf8')

/** 取一条单行 CSS 规则（本仓库 CSS 一律一行一条，读整行即可）。 */
function ruleFor(selector) {
  return css.split('\n').find((line) => line.startsWith(`${selector} {`)) || ''
}

/** P4-06 新增的那一段（从三态起到底），用来验「这一段不许出现字面色值」。 */
const modeCssSection = css.slice(css.indexOf('.lark-doc .lark-doc-mode-select {'))
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

  it('下拉最小宽 340（两行文案不折行），且 topBar 直接取这个常量不另写一份', () => {
    expect(MODE_MENU_MIN_WIDTH).toBe(340)
    expect(topbar).toContain('menuMinWidth: MODE_MENU_MIN_WIDTH')
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

/**
 * 假宿主：viewModesMixin（被测）+ overlayDismissMixin（入口层）+ 这两个方法读到的零散状态。
 * `config` 直接放进 `larkDocConfig.modes` —— `modesConfig` computed 只认这一段。
 */
function createEd(config) {
  const ed = {
    mode: 'edit', modeToast: '', modeToastTimer: null,
    larkDocConfig: config ? { modes: config } : null,
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
  // reading / modesConfig / modeOptions / modeSwitchable 在真身里是 computed，假宿主用 getter 复刻同一语义。
  Object.defineProperty(ed, 'reading', { get() { return ed.mode === 'read' } })
  Object.defineProperty(ed, 'modesConfig', { get() { return viewModesMixin.computed.modesConfig.call(ed) } })
  Object.defineProperty(ed, 'modeOptions', { get() { return viewModesMixin.computed.modeOptions.call(ed) } })
  Object.defineProperty(ed, 'modeSwitchable', { get() { return viewModesMixin.computed.modeSwitchable.call(ed) } })
  Object.assign(ed, viewModesMixin.methods, overlayDismissMixin.methods)
  return ed
}

describe('config.modes 归一化（normalizeModesConfig / resolveModeOptions）', () => {
  it('缺省：三项全开、默认编辑、持久化开、快捷键开、无文案覆盖', () => {
    expect(normalizeModesConfig()).toEqual({ default: 'edit', allow: ['edit', 'suggest', 'read'], persist: true, labels: {}, shortcuts: true })
    expect(normalizeModesConfig(null)).toEqual(normalizeModesConfig())
    expect(normalizeModesConfig('nonsense')).toEqual(normalizeModesConfig())
    expect(DEFAULT_MODES_CONFIG.default).toBe('edit')
  })

  it('allow 按规格顺序收，宿主数组顺序不参与', () => {
    expect(normalizeModesConfig({ allow: ['read', 'edit'] }).allow).toEqual(['edit', 'read'])
  })

  it('allow 去非法 id、去重', () => {
    expect(normalizeModesConfig({ allow: ['edit', 'edit', 'admin', 'suggest'] }).allow).toEqual(['edit', 'suggest'])
  })

  it('allow 过滤后为空 / 非数组 → 回落三项全留（空数组更可能是一次笔误）', () => {
    expect(normalizeModesConfig({ allow: [] }).allow).toEqual(['edit', 'suggest', 'read'])
    expect(normalizeModesConfig({ allow: ['nope'] }).allow).toEqual(['edit', 'suggest', 'read'])
    expect(normalizeModesConfig({ allow: 'edit' }).allow).toEqual(['edit', 'suggest', 'read'])
  })

  it('只想留一项就写 allow: [\'edit\'] —— 这是关掉切换的正确姿势', () => {
    const cfg = normalizeModesConfig({ allow: ['edit'] })
    expect(cfg.allow).toEqual(['edit'])
    expect(cfg.default).toBe('edit')
  })

  it('default 不在 allow 里 → 回落 allow[0]，保证初始态一定是可选项', () => {
    expect(normalizeModesConfig({ allow: ['edit', 'read'], default: 'suggest' }).default).toBe('edit')
    expect(normalizeModesConfig({ allow: ['read'], default: 'edit' }).default).toBe('read')
  })

  it('default 非法值 → 回落编辑；编辑不在 allow 时再落到 allow[0]', () => {
    expect(normalizeModesConfig({ default: 'admin' }).default).toBe('edit')
    expect(normalizeModesConfig({ allow: ['suggest', 'read'], default: 'whatever' }).default).toBe('suggest')
  })

  it('labels 只认三项已知 id 的非空字符串，其余键与空值丢弃', () => {
    expect(normalizeModesConfig({ labels: { edit: ' 撰写 ', read: '预览', suggest: '', admin: 'X', other: null } }).labels)
      .toEqual({ edit: '撰写', read: '预览' })
    expect(normalizeModesConfig({ labels: { edit: 123 } }).labels).toEqual({})
    expect(normalizeModesConfig({ labels: null }).labels).toEqual({})
  })

  it('persist / shortcuts 只有显式 false 才关（undefined 视为开）', () => {
    expect(normalizeModesConfig({ persist: false, shortcuts: false })).toMatchObject({ persist: false, shortcuts: false })
    expect(normalizeModesConfig({ persist: 0, shortcuts: '' })).toMatchObject({ persist: true, shortcuts: true })
    expect(normalizeModesConfig({ persist: undefined, shortcuts: undefined })).toMatchObject({ persist: true, shortcuts: true })
  })

  it('幂等：归一化结果再过一遍不变（配置旁路会跑两次）', () => {
    const once = normalizeModesConfig({ allow: ['read', 'edit'], default: 'read', labels: { read: '只读' }, persist: false, shortcuts: false })
    expect(normalizeModesConfig(once)).toEqual(once)
  })

  it('resolveModeOptions 按 allow 裁剪、顺序仍是编辑 → 修订 → 阅读', () => {
    expect(resolveModeOptions(normalizeModesConfig({ allow: ['read', 'edit'] })).map((item) => item.id)).toEqual(['edit', 'read'])
    expect(resolveModeOptions(DEFAULT_MODES_CONFIG).map((item) => item.id)).toEqual(['edit', 'suggest', 'read'])
    expect(resolveModeOptions(null).length).toBe(3)
  })

  it('resolveModeOptions 用 labels 覆盖主标题，副标题与键位不受影响', () => {
    const options = resolveModeOptions(normalizeModesConfig({ labels: { suggest: '审阅' } }))
    const suggest = options.filter((item) => item.id === 'suggest')[0]
    expect(suggest.label).toBe('审阅')
    expect(suggest.hint).toBe('提出修改建议')
    expect(suggest.keys).toEqual(['⌘ + ⌥ + X'])
  })
})

describe('config.modes 接线（viewModesMixin）', () => {
  beforeEach(() => {
    globalThis.window = { innerWidth: 1512, localStorage: makeStorage() }
  })
  afterEach(() => {
    delete globalThis.window
  })

  it('无 larkDocConfig 时走缺省：三项 + 可切换', () => {
    const ed = createEd()
    expect(ed.modeOptions.map((item) => item.id)).toEqual(['edit', 'suggest', 'read'])
    expect(ed.modeSwitchable).toBe(true)
  })

  it('allow 裁剪后下拉只剩这两项', () => {
    const ed = createEd({ allow: ['edit', 'read'] })
    expect(ed.modeOptions.map((item) => item.id)).toEqual(['edit', 'read'])
    expect(ed.modeSwitchable).toBe(true)
  })

  it('allow: [\'edit\'] → modeSwitchable 为 false（按钮退化成静态文字）', () => {
    const ed = createEd({ allow: ['edit'] })
    expect(ed.modeSwitchable).toBe(false)
    expect(ed.modeOptions.length).toBe(1)
  })

  it('allow 不含 read 时 reading 仍由 mode 派生，但 setMode(\'read\') 被拦', () => {
    const ed = createEd({ allow: ['edit', 'suggest'] })
    ed.setMode('read')
    expect(ed.mode).toBe('edit')
    expect(ed.modeToast).toBe('')
  })

  it('setMode 只放行 allow 内的项', () => {
    const ed = createEd({ allow: ['edit', 'read'] })
    ed.setMode('suggest')
    expect(ed.mode).toBe('edit')
    ed.setMode('read')
    expect(ed.mode).toBe('read')
  })

  it('default: \'read\' → restoreMode 首屏即阅读态', () => {
    const ed = createEd({ default: 'read' })
    ed.restoreMode()
    expect(ed.mode).toBe('read')
  })

  it('persist: false → 不读也不写 localStorage', () => {
    globalThis.window.localStorage = makeStorage({ [MODE_STORAGE_KEY]: 'read' })
    const ed = createEd({ persist: false, default: 'edit' })
    ed.restoreMode()
    expect(ed.mode).toBe('edit')
    ed.setMode('suggest')
    expect(globalThis.window.localStorage.writes).toEqual([])
  })

  it('persist: true 时旧存储值不在 allow 里 → 回落 default（宿主改配置后不残留旧态）', () => {
    globalThis.window.localStorage = makeStorage({ [MODE_STORAGE_KEY]: 'suggest' })
    const ed = createEd({ allow: ['edit', 'read'], default: 'edit' })
    ed.restoreMode()
    expect(ed.mode).toBe('edit')
  })

  it('labels 覆盖按钮文案与提示条文案', () => {
    const ed = createEd({ labels: { read: '只读', suggest: '审阅' } })
    ed.mode = 'read'
    expect(viewModesMixin.computed.modeLabel.call(ed)).toBe('只读')
    ed.setMode('edit')
    ed.setMode('suggest')
    expect(ed.modeToast).toBe('已切换为审阅模式')
  })

  it('labels 没覆盖的项仍用规格原文案（提示条不跑偏）', () => {
    const ed = createEd({ labels: { read: '只读' } })
    ed.setMode('suggest')
    expect(ed.modeToast).toBe('已切换为修订模式')
  })

  it('shortcuts: false → 键位不切模式，也不 preventDefault', () => {
    const ed = createEd({ shortcuts: false })
    const event = { key: 'x', metaKey: true, altKey: true, shiftKey: false, target: { closest: () => null } }
    event.preventDefault = () => { event.prevented = true }
    expect(ed.applyModeShortcut(event)).toBe(false)
    expect(ed.mode).toBe('edit')
    expect(event.prevented).toBeUndefined()
  })

  it('键位命中但该项不在 allow 里 → 不 preventDefault（不白吞宿主组合键）', () => {
    const ed = createEd({ allow: ['edit', 'read'] })
    const event = { key: 'x', metaKey: true, altKey: true, shiftKey: false, target: { closest: () => null } }
    event.preventDefault = () => { event.prevented = true }
    expect(ed.applyModeShortcut(event)).toBe(false)
    expect(ed.mode).toBe('edit')
    expect(event.prevented).toBeUndefined()
  })

  it('键位命中且在 allow 里 → 切换 + preventDefault', () => {
    const ed = createEd({ allow: ['edit', 'read'] })
    const event = { key: 'v', metaKey: true, altKey: true, shiftKey: false, target: { closest: () => null } }
    event.preventDefault = () => { event.prevented = true }
    expect(ed.applyModeShortcut(event)).toBe(true)
    expect(ed.mode).toBe('read')
    expect(event.prevented).toBe(true)
  })
})

describe('P4-06 模式切换行为（viewModesMixin）', () => {
  beforeEach(() => {
    globalThis.window = { innerWidth: 1512, localStorage: makeStorage() }
  })
  afterEach(() => {
    delete globalThis.window
  })

  it('setMode 切态 + 落库 + 出提示', () => {
    const ed = createEd()
    ed.setMode('suggest')
    expect(ed.mode).toBe('suggest')
    expect(window.localStorage.writes).toEqual([[MODE_STORAGE_KEY, 'suggest']])
    expect(ed.modeToast).toBe('已切换为修订模式')
  })

  it('setMode 幂等：切到当前态不重复落库也不重复提示（下拉点当前项等同空操作）', () => {
    const ed = createEd()
    ed.mode = 'read'
    ed.setMode('read')
    expect(window.localStorage.writes).toEqual([])
    expect(ed.modeToast).toBe('')
  })

  it('setMode 非法 id 不改状态', () => {
    const ed = createEd()
    ed.setMode('suggestion')
    expect(ed.mode).toBe('edit')
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
    // 缺省配置下渲染结果与 DOC_MODES 逐项一致（resolveModeOptions 会新建对象，故用 toEqual）。
    expect(viewModesMixin.computed.modeOptions.call(ed)).toEqual(DOC_MODES)
  })

  it('toggleReading 是二态入口：编辑 ↔ 阅读往返', () => {
    const ed = createEd()
    ed.toggleReading()
    expect(ed.mode).toBe('read')
    ed.toggleReading()
    expect(ed.mode).toBe('edit')
  })

  it('下拉开合 / 定位已交给共享下拉原语：mixin 里不再有手搓的一套', () => {
    const ed = createEd()
    // 方法层：旧 API 全删了（再想加回来就等于又造一套下拉）。
    expect(ed.toggleModeMenu).toBeUndefined()
    expect(ed.closeModeMenu).toBeUndefined()
    // 数据层：开合状态与坐标都不在 data 里。
    expect(viewModesMixin.data().modeMenuOpen).toBeUndefined()
    expect(viewModesMixin.data().modeMenuPos).toBeUndefined()
    // computed 层：菜单定位样式也删了（原语自己 position()）。
    expect(viewModesMixin.computed.modeMenuStyle).toBeUndefined()
    expect(viewModesSource).not.toContain('modeMenuOpen')
    expect(viewModesSource).not.toContain('modeMenuPos')
    // 顶栏 state 不再透传开合字段。
    expect(toolbarUiSource).not.toContain('modeMenuOpen')
    expect(toolbarUiSource).not.toContain('modeMenuStyle')
    expect(toolbarUiSource).not.toContain('toggleModeMenu')
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

  it('模式下拉不在这条互斥链里（原语自己挂 document pointerdown / keydown），但 Esc 仍回焦', () => {
    const ed = createEd()
    // 假宿主默认 root.contains 恒 true（别处断言「点内部不乱收」），这里要测「点外部」。
    ed.$refs.root = { contains: () => false }
    // 点外部：不再有 modeMenu 分支，其他浮层照旧（这里造一个假的 heading 菜单验证链还在）。
    ed.headingOpen = true
    overlayDismissMixin.methods.onDocumentPointerDown.call(ed, { target: { closest: () => null } })
    expect(ed.headingOpen).toBe(false)
    overlayDismissMixin.methods.closeOverlay.call(ed)
    expect(ed.focusCalls).toBe(1)
    // 源码层守：别把这套手搓开合状态塞回互斥链。
    expect(overlaySource).not.toContain('modeMenuOpen')
    expect(overlaySource).not.toContain('closeModeMenu')
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
    // 内衬 9 + gap 4 把文字推到 x+29（图标位 16 @x+9 之后）。
    expect(btn).toContain('padding: 0 0 0 9px')
    expect(btn).toContain('gap: 4px')
  })

  it('下拉复用共享原语：fixed 由 select 给，层级 1050、内衬 5px、圆角 9', () => {
    // `position: fixed` / 翻转 / 右侧夹取都在 `ui/select.js` 的 position() 里，CSS 不该再写一遍。
    expect(css).toContain('.lark-doc .lark-doc-select-menu { position: fixed;')
    const menu = ruleFor('.lark-doc .lark-doc-mode-select .lark-doc-select-menu')
    expect(menu).toContain('z-index: 1050')
    expect(menu).toContain('padding: 5px')
    // 圆角跟通用 `.lark-doc-select-menu` 的 9px 对齐（原来写 8 是自己一套）。
    expect(menu).toContain('border-radius: 9px')
  })

  it('下拉项两行（主标题 22 + 副标题 18 + 2 间距），选中态整行激活底、无勾选列', () => {
    expect(ruleFor('.lark-doc .lark-doc-mode-select .lark-doc-select-item-label')).toContain('font-size: 14px')
    expect(ruleFor('.lark-doc .lark-doc-mode-select .lark-doc-select-item-label')).toContain('line-height: 22px')
    expect(ruleFor('.lark-doc .lark-doc-select-item-hint')).toContain('line-height: 18px')
    expect(ruleFor('.lark-doc .lark-doc-select-text')).toContain('flex-direction: column')
    // 飞书这份菜单不画 ✓ 列，选中态靠整行底色（截图口径）。
    expect(ruleFor('.lark-doc .lark-doc-mode-select .lark-doc-select-check')).toContain('display: none')
    // 底色/文字必须走主题激活 token，不许写死飞书蓝（--ld-bg-selected / --ld-brand-content
    // 在绿档也是 #E0E9FF / #1456f0，选中行会跟整个主题打架 —— 用户实测反馈过）。
    const active = ruleFor('.lark-doc .lark-doc-mode-select .lark-doc-select-menu button.lark-doc-select-active')
    expect(active).toContain('background: var(--ld-bg-accent-active)')
    expect(active).not.toContain('--ld-bg-selected')
    expect(active).not.toContain('--ld-brand-content')
    expect(ruleFor('.lark-doc .lark-doc-mode-select .lark-doc-select-menu button.lark-doc-select-active .lark-doc-select-item-label'))
      .toContain('color: var(--ld-text-accent-hover)')
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

  it('原生顶栏的模式切换走共享下拉原语，且宿主动作节点仍排在它之后', () => {
    expect(topbar).toContain("import { createSelect } from './select'")
    expect(topbar).toContain("className: 'lark-doc-mode-select'")
    expect(topbar).toContain('onChange: (id) => call(\'setMode\', id)')
    // 选项表带 hint（两行式）—— 漏传 hint 菜单就退化成三行单行文字。
    expect(topbar).toContain('hint: item.hint')
    expect(topbar).toContain('actionsHost')
    expect(topbar).toContain('headerActions.appendChild(modeSelect.el)')
    expect(topbar).toContain('headerActions.appendChild(actionsHost)')
    // 插槽宿主必须排在模式切换之后（历史上换成 slot 替换掉 mode-switch，宿主控件整块消失）。
    expect(topbar.indexOf('headerActions.appendChild(actionsHost)'))
      .toBeGreaterThan(topbar.indexOf('headerActions.appendChild(modeSelect.el)'))
    // 手搓的那套 DOM 类名一个都不许留（同一交互只维护一份渲染）。
    expect(topbarCode).not.toContain('lark-doc-mode-btn')
    expect(topbarCode).not.toContain('lark-doc-mode-menu')
    expect(topbarCode).not.toContain('toggleModeMenu')
    expect(topbarCode).not.toContain('modeMenuPos')
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
