/**
 * P4-06 快捷键抽屉 + 右下角帮助圆钮（04 §3.5 / 07 §7 §8 §9）单测 —— Node 环境、无 DOM。
 *
 * 抽屉与圆钮都是 .vue（单测闭包不许 import .vue），所以分三层守：
 *  1. 数据层：直接 import shortcutGroups.js，锁五组快捷键与 Markdown 表的条数、顺序、
 *     关键键位，以及「飞书不生效的键位不得进表」这条容易被人好心加回去的口径；
 *  2. 行为层：真 import overlayDismissMixin，用假 this 直测 ⌘+/ 派发与 Esc 收层；
 *  3. 规格层：读 lark-doc.css / 抽屉原生积木（`src/ui/dialogs.js`）/ 宿主文本，锁 04 §3.5
 *     实测像素（314 宽、关闭 24×24、圆钮 36×36、菜单 120 / 项 112×30、层级 60）。
 * 像素或键位改了要同步改这里，避免悄悄漂。
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { describe, expect, it } from 'vitest'
import {
  SHORTCUT_GROUPS, MARKDOWN_GROUPS, DRAWER_GROUPS, HELP_MENU_ITEMS,
} from '../../src/ui/shortcutGroups'
import overlayDismissMixin from '../../src/components/lark-doc/editor/overlayDismissMixin'
import viewModesMixin from '../../src/components/lark-doc/editor/viewModesMixin'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const css = fs.readFileSync(path.join(root, 'src/components/lark-doc/lark-doc.css'), 'utf8')
// 阶段 5 批次 4：`HelpDialog.vue` 已删除，抽屉 DOM 由 `src/ui/dialogs.js` 的
// `createHelpDrawer` 产出；这里守的是同一批结构口径（盒子仍是抽屉外壳、仍是 314 宽右贴边）。
const dialog = fs.readFileSync(path.join(root, 'src/ui/dialogs.js'), 'utf8')
const fab = fs.readFileSync(path.join(root, 'src/components/lark-doc/editor/HelpFab.vue'), 'utf8')
const editorVue = fs.readFileSync(path.join(root, 'src/components/lark-doc/LarkDocEditor.vue'), 'utf8')
const dialogsMixin = fs.readFileSync(path.join(root, 'src/components/lark-doc/editor/dialogsUiMixin.js'), 'utf8')
// `icons.js` 在阶段 5 批次 3 已随图标积木迁到 `src/ui/`（原路径读不到会直接抛 ENOENT）。
const icons = fs.readFileSync(path.join(root, 'src/ui/icons.js'), 'utf8')

/** 抽屉工厂那一段源码（`createEmbedDialog` 之后是另一个积木，不参与本组断言）。 */
const drawerSource = dialog.slice(dialog.indexOf('export function createHelpDrawer'), dialog.indexOf('export function createEmbedDialog'))
/** 取一条单行 CSS 规则（本仓库 CSS 一律一行一条，读整行即可）。 */
function ruleFor(selector) {
  return css.split('\n').find((line) => line.startsWith(`${selector} {`)) || ''
}

/** 把某组拍平成「名称 → 组合键」便于按键位查询。 */
function keyOf(groupTitle, name) {
  const group = SHORTCUT_GROUPS.filter((g) => g.title === groupTitle)[0]
  const row = group ? group.items.filter((r) => r[0] === name)[0] : null
  return row ? row[1] : ''
}

/** 全部组合键拍成一个数组，供「不得出现某键位」这类反向断言用（按整条比对，不拼串）。 */
const ALL_KEYS = DRAWER_GROUPS.reduce((acc, g) => acc.concat(g.items.map((r) => r[1])), [])

describe('P4-06 快捷键数据（07 §7 五组 + §8 Markdown 表）', () => {
  it('五组，标题与顺序跟飞书面板一致', () => {
    expect(SHORTCUT_GROUPS.map((g) => g.title)).toEqual([
      '模式与导航', '编辑与历史', '行内格式', '块类型', '其他',
    ])
  })

  it('每组条数锁死：11 / 7 / 7 / 10 / 2，合计 37', () => {
    expect(SHORTCUT_GROUPS.map((g) => g.items.length)).toEqual([11, 7, 7, 10, 2])
    const total = SHORTCUT_GROUPS.reduce((n, g) => n + g.items.length, 0)
    expect(total).toBe(37)
  })

  it('每行都是 [名称, 组合键] 的非空二元组', () => {
    SHORTCUT_GROUPS.concat(MARKDOWN_GROUPS).forEach((group) => {
      expect(typeof group.title).toBe('string')
      expect(group.title.length).toBeGreaterThan(0)
      group.items.forEach((row) => {
        expect(Array.isArray(row)).toBe(true)
        expect(row.length).toBe(2)
        expect(typeof row[0]).toBe('string')
        expect(typeof row[1]).toBe('string')
        expect(row[0].trim().length).toBeGreaterThan(0)
        expect(row[1].trim().length).toBeGreaterThan(0)
      })
    })
  })

  it('同一组内名称不重复（避免复制粘贴出重条）', () => {
    SHORTCUT_GROUPS.concat(MARKDOWN_GROUPS).forEach((group) => {
      const names = group.items.map((r) => r[0])
      expect(new Set(names).size).toBe(names.length)
    })
  })

  it('三态模式键位：编辑 E 或 Ctrl+⌥+E、修订 ⌘+⌥+X、阅读 Ctrl+⌥+V（07 §1）', () => {
    expect(keyOf('模式与导航', '编辑模式')).toBe('E 或 Ctrl + ⌥ + E')
    expect(keyOf('模式与导航', '修订模式')).toBe('⌘ + ⌥ + X')
    expect(keyOf('模式与导航', '阅读模式')).toBe('Ctrl + ⌥ + V')
  })

  it('⌘ + / 在「模式与导航」组（抽屉自身入口，07 §7）', () => {
    expect(keyOf('模式与导航', '查看快捷键')).toBe('⌘ + /')
  })

  it('查找 / 替换键位与 P4-05 实现一致：⌘+F 与 ⌘+Shift+H', () => {
    expect(keyOf('模式与导航', '查找')).toBe('⌘ + F')
    expect(keyOf('模式与导航', '查找和替换')).toBe('⌘ + Shift + H')
  })

  it('公式「完成输入」是 Esc 不是回车（07 §7.5 21.29 实测）', () => {
    expect(keyOf('其他', '完成公式输入')).toBe('Esc')
  })

  it('Markdown 一组 18 条，含三条直接识别规则（---/***、$$$$、```）', () => {
    expect(MARKDOWN_GROUPS.length).toBe(1)
    expect(MARKDOWN_GROUPS[0].title).toBe('Markdown 输入')
    expect(MARKDOWN_GROUPS[0].items.length).toBe(18)
    const keys = MARKDOWN_GROUPS[0].items.map((r) => r[1])
    expect(keys).toContain('--- 或 ***')
    expect(keys).toContain('$$文字$$')
    expect(keys).toContain('``` 或 ```lang')
  })

  it('Markdown 表首条是「# + 空格」，末两条是 Tab / Shift + Tab', () => {
    const items = MARKDOWN_GROUPS[0].items
    expect(items[0][1]).toBe('# + 空格')
    expect(items[items.length - 2][1]).toBe('Tab')
    expect(items[items.length - 1][1]).toBe('Shift + Tab')
  })

  it('不写 ⌘+E 行内代码 —— 07 §8 明确飞书不生效', () => {
    // 按整条比对而不是拼串：`⌘ + Enter`（提交评论）里含有 `⌘ + E` 子串，拼串会假红。
    const inlineCodeKeys = ALL_KEYS.filter((k) => /^(⌘|Cmd|Ctrl) \+ E$/.test(k))
    expect(inlineCodeKeys).toEqual([])
  })

  it('DRAWER_GROUPS = 快捷键五组 + Markdown 一组，共 55 条', () => {
    expect(DRAWER_GROUPS.length).toBe(6)
    expect(DRAWER_GROUPS.length).toBe(SHORTCUT_GROUPS.length + MARKDOWN_GROUPS.length)
    const total = DRAWER_GROUPS.reduce((n, g) => n + g.items.length, 0)
    expect(total).toBe(55)
  })

  it('帮助菜单 5 项，顺序即飞书实测顺序（04 §3.5）', () => {
    expect(HELP_MENU_ITEMS.map((i) => i.label)).toEqual([
      '上传日志', '联系客服', '功能更新', '帮助中心', '快捷键',
    ])
    expect(HELP_MENU_ITEMS.map((i) => i.id)).toEqual([
      'upload-log', 'support', 'whats-new', 'help-center', 'shortcuts',
    ])
  })

  it('帮助菜单每项都有图标，且图标名都在 icons.js 里存在', () => {
    HELP_MENU_ITEMS.forEach((item) => {
      expect(typeof item.icon).toBe('string')
      expect(icons).toContain(`'${item.icon}':`)
    })
  })

  it('只有「快捷键」一项在本项目有落点（其余是外部服务入口，不伪造跳转）', () => {
    const handled = HELP_MENU_ITEMS.filter((i) => i.id === 'shortcuts')
    expect(handled.length).toBe(1)
    expect(fab).toContain("if (item.id === 'shortcuts') this.ed.toggleHelpOpen()")
  })
})

/** 只给被测分支用的最小键盘事件，preventDefault 记一笔便于断言「拦了浏览器默认行为」。 */
function keyEvent(key, mods) {
  const event = Object.assign({ key, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false }, mods)
  event.preventDefault = () => { event.prevented = true }
  return event
}

/** 假宿主：只挂被测的 overlayDismissMixin.methods + 协作件。 */
function createEd() {
  const ed = {
    helpOpen: false,
    focusCalls: 0,
    headingNumberMenu: { open: false },
    toggleCalls: 0,
    focus() { ed.focusCalls += 1 },
  }
  Object.assign(ed, overlayDismissMixin.methods)
  // onWindowKeydown 现在开头就派发三态模式键（P4-06 第 2 条），宿主必须真挂
  // viewModesMixin，否则 applyModeShortcut 未定义直接抛 TypeError。
  Object.assign(ed, viewModesMixin.methods)
  ed.mode = 'edit'
  // toggleHelpOpen 真实体在 viewModesMixin（一行翻转），这里只需记调用次数。
  ed.toggleHelpOpen = () => { ed.toggleCalls += 1; ed.helpOpen = !ed.helpOpen }
  return ed
}

describe('P4-06 快捷键抽屉入口（07 §9 第 426 行）', () => {
  it('⌘ + / 开抽屉，且 preventDefault 拦掉 Firefox 原生「快速查找」', () => {
    const ed = createEd()
    const event = keyEvent('/', { metaKey: true })
    overlayDismissMixin.methods.onWindowKeydown.call(ed, event)
    expect(event.prevented).toBe(true)
    expect(ed.toggleCalls).toBe(1)
    expect(ed.helpOpen).toBe(true)
  })

  it('Ctrl + / 同样认（Windows / Linux 同键位）', () => {
    const ed = createEd()
    const event = keyEvent('/', { ctrlKey: true })
    overlayDismissMixin.methods.onWindowKeydown.call(ed, event)
    expect(event.prevented).toBe(true)
    expect(ed.toggleCalls).toBe(1)
  })

  it('Shift + / 也命中（key 仍是 /，不判 shiftKey）', () => {
    const ed = createEd()
    const event = keyEvent('/', { metaKey: true, shiftKey: true })
    overlayDismissMixin.methods.onWindowKeydown.call(ed, event)
    expect(ed.toggleCalls).toBe(1)
  })

  it('不按修饰键的 / 不拦（正文照常输入斜杠）', () => {
    const ed = createEd()
    const event = keyEvent('/')
    overlayDismissMixin.methods.onWindowKeydown.call(ed, event)
    expect(ed.toggleCalls).toBe(0)
    expect(event.prevented).toBeUndefined()
  })

  it('⌘+⌥+/ 不吞（altKey 被外层分支排除，留给系统字符）', () => {
    const ed = createEd()
    const event = keyEvent('/', { metaKey: true, altKey: true })
    overlayDismissMixin.methods.onWindowKeydown.call(ed, event)
    expect(ed.toggleCalls).toBe(0)
    expect(event.prevented).toBeUndefined()
  })

  it('⌘+F / ⌘+Shift+H 未被 / 分支挤掉（P4-05 回归）', () => {
    const find = createEd()
    find.openSearch = () => { find.opened = 'find' }
    overlayDismissMixin.methods.onWindowKeydown.call(find, keyEvent('f', { metaKey: true }))
    expect(find.opened).toBe('find')
    const replace = createEd()
    replace.openSearch = (tab) => { replace.opened = tab }
    overlayDismissMixin.methods.onWindowKeydown.call(replace, keyEvent('h', { metaKey: true, shiftKey: true }))
    expect(replace.opened).toBe('replace')
  })

  it('closeOverlay() 能收掉抽屉（Esc / 点外部复用同一条链）', () => {
    const ed = createEd()
    ed.helpOpen = true
    overlayDismissMixin.methods.closeOverlay.call(ed)
    expect(ed.helpOpen).toBe(false)
    expect(ed.focusCalls).toBe(1)
  })
})

describe('P4-06 抽屉与圆钮规格（04 §3.5 实测像素）', () => {
  it('抽屉宽 314、全高、贴右', () => {
    const mask = ruleFor('.lark-doc .lark-doc-drawer-mask')
    expect(mask).toContain('position: fixed')
    expect(mask).toContain('inset: 0')
    expect(mask).toContain('justify-content: flex-end')
    expect(mask).toContain('z-index: 100')
    const drawer = ruleFor('.lark-doc .lark-doc-drawer')
    expect(drawer).toContain('width: 314px')
    expect(drawer).toContain('height: 100%')
  })

  it('04 未规定遮罩 ⇒ 遮罩必须是透明的（不画飞书没有的暗色蒙版）', () => {
    expect(ruleFor('.lark-doc .lark-doc-drawer-mask')).not.toContain('background')
    expect(css).not.toContain('.lark-doc-drawer-mask { position: fixed; z-index: 100; inset: 0; display: flex; justify-content: flex-end; background')
  })

  it('关闭按钮 24×24', () => {
    const close = ruleFor('.lark-doc .lark-doc-drawer-close')
    expect(close).toContain('width: 24px')
    expect(close).toContain('height: 24px')
    expect(close).toContain('min-width: 24px')
  })

  it('内容区可滚动且不出原生滚动条（ud__scrollArea）', () => {
    const body = ruleFor('.lark-doc .lark-doc-drawer-body')
    expect(body).toContain('overflow-y: auto')
    expect(body).toContain('scrollbar-width: none')
    expect(css).toContain('.lark-doc .lark-doc-drawer-body::-webkit-scrollbar')
  })

  it('键值行左侧名称、右侧组合键，两端对齐', () => {
    const row = ruleFor('.lark-doc .lark-doc-kbd-row')
    expect(row).toContain('display: flex')
    expect(row).toContain('justify-content: space-between')
    expect(ruleFor('.lark-doc .lark-doc-kbd-key')).toContain('white-space: nowrap')
  })

  it('圆钮 36×36 / 圆形 / shadow 走 --shadow-fab 映射的 token / 层级 60', () => {
    const wrap = ruleFor('.lark-doc .lark-doc-help-fab-wrap')
    expect(wrap).toContain('z-index: 60')
    expect(wrap).toContain('position: fixed')
    const button = ruleFor('.lark-doc .lark-doc-help-fab')
    expect(button).toContain('width: 36px')
    expect(button).toContain('height: 36px')
    expect(button).toContain('border-radius: 50%')
    expect(button).toContain('box-shadow: var(--ld-shadow-tooltip)')
  })

  it('hover 菜单 120 宽、项 112×30、图标 16×16', () => {
    expect(ruleFor('.lark-doc .lark-doc-help-menu')).toContain('width: 120px')
    const item = ruleFor('.lark-doc .lark-doc-help-menu-item')
    expect(item).toContain('width: 112px')
    expect(item).toContain('height: 30px')
    expect(ruleFor('.lark-doc .lark-doc-help-menu-item .lark-doc-icon')).toContain('width: 16px')
  })

  it('菜单项显式 color: inherit —— 否则被通用 button:hover 刷成强调色', () => {
    expect(ruleFor('.lark-doc .lark-doc-help-menu-item')).toContain('color: inherit')
    const hover = css.split('\n').find((line) => line.indexOf('.lark-doc .lark-doc-help-menu-item:hover:not(:disabled)') === 0) || ''
    expect(hover).toContain('color: inherit')
  })

  it('P4-06 新增样式零字面色（全部走 token / var）', () => {
    const start = css.indexOf('P4-06 · 快捷键抽屉')
    expect(start).toBeGreaterThan(0)
    const section = css.slice(start)
    expect(section).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    // 只否定「把 white 当颜色值」（white-space: nowrap 是正常写法，不能误伤）。
    expect(section).not.toMatch(/:\s*white\b/)
  })

  it('打印时抽屉与圆钮都隐藏', () => {
    const printAt = css.indexOf('@media print')
    expect(printAt).toBeGreaterThan(0)
    const printBlock = css.slice(printAt, css.indexOf('.lark-doc .lark-doc-drawer-mask,', printAt) + 200)
    expect(printBlock).toContain('.lark-doc .lark-doc-drawer-mask')
    expect(printBlock).toContain('.lark-doc .lark-doc-help-fab-wrap')
  })
})

describe('P4-06 组件契约（宿主接线与交互细节）', () => {
  it('HelpDialog 已是抽屉，不再复用居中弹窗背板', () => {
    expect(drawerSource).toContain('lark-doc-drawer-mask')
    expect(drawerSource).toContain('lark-doc-drawer lark-doc-help-drawer')
    // 抽屉工厂里**不许**出现居中弹窗的背板类名（另外三个弹窗用，抽屉不用）。
    expect(drawerSource).not.toContain('lark-doc-dialog-backdrop')
    expect(drawerSource).toContain('关闭快捷键帮助')
    // `@click.self` 的原生等价物：只有点在遮罩本身才关。
    expect(drawerSource).toContain('event.target === el')
  })

  it('HelpDialog 数据直接来自 shortcutGroups（文案不外飘）', () => {
    expect(dialog).toContain("import { DRAWER_GROUPS } from './shortcutGroups'")
    expect(drawerSource).toContain('DRAWER_GROUPS.forEach')
  })

  it('圆钮 hover 展开、移开 160ms 延时关闭（07 §9 同口径）', () => {
    expect(fab).toContain('@mouseenter="showMenu"')
    expect(fab).toContain('@mouseleave="hideLater"')
    expect(fab).toContain('160')
    expect(fab).toContain('clearTimeout')
  })

  it('圆钮有 aria-haspopup / aria-expanded，菜单 role="menu"', () => {
    expect(fab).toContain('aria-haspopup="menu"')
    expect(fab).toContain(':aria-expanded')
    expect(fab).toContain('role="menu"')
    expect(fab).toContain('role="menuitem"')
  })

  it('宿主挂着 HelpFab，抽屉挂在原生弹层宿主上（同一 helpOpen 驱动）', () => {
    expect(editorVue).toContain('<HelpFab :ed="self" />')
    expect(editorVue).toContain("import HelpFab from './editor/HelpFab.vue'")
    // 注册表是一整行，末尾就是 `HelpFab }`，不能用 `HelpFab,` 匹配。
    expect(editorVue).toMatch(/components:\s*\{[^}]*\bHelpFab\b/)
    // 阶段 5 批次 4：`<HelpDialog :ed="self" />` 换成空宿主 div，DOM 由原生层建。
    expect(editorVue).toContain('<div ref="dialogHost" />')
    expect(editorVue).toContain('this.mountDialogs()')
  })

  it('宿主仍然在 helpOpen 变化时把焦点送到关闭按钮（watch 未断）', () => {
    // 原 `$nextTick` + `querySelector('[aria-label="关闭快捷键帮助"]')` 已改成原生层同步 focus()。
    expect(dialogsMixin).toContain('helpOpen(value)')
    expect(dialogsMixin).toContain('help.focusClose()')
    expect(drawerSource).toContain("closeButtonNode('关闭快捷键帮助', 16)")
  })

  it('工具栏的「快捷键帮助」按钮仍是第二入口（未删）', () => {
    const toolbar = fs.readFileSync(path.join(root, 'src/components/lark-doc/editor/ToolbarBar.vue'), 'utf8')
    expect(toolbar).toContain('ed.toggleHelpOpen')
  })
})
