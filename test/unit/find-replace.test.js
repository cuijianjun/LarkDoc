/**
 * P4-05 查找替换浮层（04 §3.2）单测 —— Node 环境、无 DOM。
 *
 * 面板本体是 .vue（单测闭包不许 import .vue），所以分两层守：
 *  1. 行为层：真 import viewModesMixin / overlayDismissMixin，用假 this 直测
 *     tab 切换、⌘+F / ⌘+Shift+H 派发、拖拽位置写入、关闭归位；
 *  2. 规格层：读 lark-doc.css / SearchPanel.vue 文本，锁住 04 §3.2 实测像素
 *     （406 宽、186/286 高、z-index 100、radius 8、ink 位移 60）与宿主契约
 *     （ref="searchInput" + focus() 转发）。像素改了要同步改这里，避免悄悄漂。
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { describe, expect, it } from 'vitest'
import viewModesMixin from '../../src/components/lark-doc/editor/viewModesMixin'
import overlayDismissMixin from '../../src/components/lark-doc/editor/overlayDismissMixin'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const css = fs.readFileSync(path.join(root, 'src/components/lark-doc/lark-doc.css'), 'utf8')
const darkCss = fs.readFileSync(path.join(root, 'src/components/lark-doc/theme-dark.css'), 'utf8')
const panel = fs.readFileSync(path.join(root, 'src/components/lark-doc/editor/SearchPanel.vue'), 'utf8')
const editorVue = fs.readFileSync(path.join(root, 'src/components/lark-doc/LarkDocEditor.vue'), 'utf8')

/** 取一条单行 CSS 规则（本仓库 CSS 一律一行一条，读整行即可）。 */
function ruleFor(selector) {
  return css.split('\n').find((line) => line.startsWith(`${selector} {`)) || ''
}

/**
 * 造一个够用的假宿主：先挂 viewModesMixin 的真实 methods（被测的就是它们），
 * 再用 overrides 盖掉属于 LarkDocEditor.vue 的协作件（featureEnabled / focus / $refs …）。
 */
function createEd(overrides) {
  const ed = {
    searchOpen: false, searchTab: 'find', searchPanelPos: null,
    searchQuery: '飞书', replacement: '', searchMatches: [{ from: 1, to: 3 }], searchIndex: 0,
    features: { search: true },
    focusCalls: 0, panelFocusCalls: 0,
    headingNumberMenu: { open: false },
    featureEnabled(name) { return ed.features[name] !== false },
    focus() { ed.focusCalls += 1 },
    $nextTick(fn) { fn() },
    $refs: { searchInput: { focus: () => { ed.panelFocusCalls += 1 } } },
  }
  Object.assign(ed, viewModesMixin.methods, overrides || {})
  return ed
}

describe('P4-05 查找替换 —— 打开与 tab（04 §3.2）', () => {
  it('⌘+F / 工具栏入口：面板关闭时打开并落在「查找」', () => {
    const ed = createEd()
    ed.openSearch('find')
    expect(ed.searchOpen).toBe(true)
    expect(ed.searchTab).toBe('find')
  })

  it('⌘+Shift+H：面板关闭时打开并落在「替换」', () => {
    const ed = createEd()
    ed.openSearch('replace')
    expect(ed.searchOpen).toBe(true)
    expect(ed.searchTab).toBe('replace')
  })

  it('featureDisabled 时打开被吞（面板不出现，也不切 tab）', () => {
    const ed = createEd({ features: { search: false } })
    ed.openSearch('replace')
    expect(ed.searchOpen).toBe(false)
    expect(ed.searchTab).toBe('find')
  })

  it('已开时只切 tab 并回焦输入框（浮层常驻不重建，mounted 不会再来一次）', () => {
    const ed = createEd({ searchOpen: true, searchTab: 'find' })
    ed.openSearch('replace')
    expect(ed.searchTab).toBe('replace')
    expect(ed.panelFocusCalls).toBe(1)
  })

  it('setSearchTab 非法值兜底到「查找」', () => {
    const ed = createEd()
    ed.setSearchTab('replace')
    expect(ed.searchTab).toBe('replace')
    ed.setSearchTab('nonsense')
    expect(ed.searchTab).toBe('find')
  })
})

describe('P4-05 查找替换 —— 关闭与拖拽位置', () => {
  it('关闭时 tab 归位到「查找」，下次打开不带上次痕迹', () => {
    const ed = createEd({ searchOpen: true, searchTab: 'replace' })
    ed.closeSearch()
    expect(ed.searchOpen).toBe(false)
    expect(ed.searchTab).toBe('find')
    expect(ed.searchQuery).toBe('')
    expect(ed.searchMatches).toEqual([])
  })

  it('关闭后拖拽位置刻意保留（同一次会话里再开还在原地）', () => {
    const ed = createEd({ searchOpen: true, searchPanelPos: { left: 320, top: 180 } })
    ed.closeSearch()
    expect(ed.searchPanelPos).toEqual({ left: 320, top: 180 })
  })

  it('setSearchPanelPos 原样写入（钳制在组件里做，这里只管状态落点）', () => {
    const ed = createEd()
    ed.setSearchPanelPos({ left: 12, top: 34 })
    expect(ed.searchPanelPos).toEqual({ left: 12, top: 34 })
  })
})

/** 只给被测分支用的最小键盘事件，preventDefault 记一笔便于断言「拦了浏览器原生查找」。 */
function keyEvent(key, mods) {
  const event = Object.assign({ key, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false }, mods)
  event.preventDefault = () => { event.prevented = true }
  return event
}

describe('P4-05 查找替换 —— 快捷键（overlayDismissMixin）', () => {
  const od = overlayDismissMixin.methods

  it('⌘+F → 查找，且拦掉浏览器原生查找条', () => {
    const ed = createEd()
    const event = keyEvent('f', { metaKey: true })
    od.onWindowKeydown.call(ed, event)
    expect(event.prevented).toBe(true)
    expect(ed.searchOpen).toBe(true)
    expect(ed.searchTab).toBe('find')
  })

  it('⌘+Shift+H → 替换', () => {
    const ed = createEd()
    const event = keyEvent('H', { metaKey: true, shiftKey: true })
    od.onWindowKeydown.call(ed, event)
    expect(event.prevented).toBe(true)
    expect(ed.searchTab).toBe('replace')
  })

  it('Ctrl+F / Ctrl+Shift+H 同样认（Windows / Linux 同键位）', () => {
    const a = createEd()
    od.onWindowKeydown.call(a, keyEvent('f', { ctrlKey: true }))
    expect(a.searchOpen).toBe(true)
    const b = createEd()
    od.onWindowKeydown.call(b, keyEvent('h', { ctrlKey: true, shiftKey: true }))
    expect(b.searchTab).toBe('replace')
  })

  it('⌘+Shift+F / 单独 F / ⌘+Alt+F 都不拦（不抢别的快捷键）', () => {
    const cases = [keyEvent('f', { metaKey: true, shiftKey: true }), keyEvent('f'), keyEvent('f', { metaKey: true, altKey: true })]
    cases.forEach((event) => {
      const ed = createEd()
      od.onWindowKeydown.call(ed, event)
      expect(ed.searchOpen).toBe(false)
      expect(event.prevented).toBeUndefined()
    })
  })

  it('Esc 仍走原互斥链：查找面板由 closeOverlay 末链收掉', () => {
    const ed = createEd({ searchOpen: true })
    od.closeOverlay.call(ed)
    expect(ed.searchOpen).toBe(false)
    // 2 次是既有行为：closeSearch 自己收尾 focus 一次，closeOverlay 末尾再统一 focus 一次。
    expect(ed.focusCalls).toBe(2)
  })
})

describe('P4-05 查找替换 —— 面板规格（04 §3.2 实测像素）', () => {
  it('面板 406 宽 / z-index 100 / radius 8 / fixed', () => {
    const rule = ruleFor('.lark-doc .lark-doc-fr')
    expect(rule).toMatch(/position: fixed/)
    expect(rule).toMatch(/z-index: 100/)
    expect(rule).toMatch(/width: 406px/)
    expect(rule).toMatch(/border-radius: 8px/)
  })

  it('Tab 32×48 / fs16，激活色走 --ld-brand-content（不新造蓝）', () => {
    expect(ruleFor('.lark-doc .lark-doc-fr .lark-doc-fr-tab')).toMatch(/width: 32px; min-width: 32px; height: 48px/)
    expect(ruleFor('.lark-doc .lark-doc-fr .lark-doc-fr-tab')).toMatch(/font-size: 16px/)
    expect(ruleFor('.lark-doc .lark-doc-fr .lark-doc-fr-tab.is-active')).toMatch(/color: var\(--ld-brand-content\)/)
  })

  it('激活 ink：容器 32×3 裁 ::before 32×6，替换 Tab 右移 60px', () => {
    expect(ruleFor('.lark-doc .lark-doc-fr .lark-doc-fr-ink')).toMatch(/width: 32px; height: 3px/)
    expect(ruleFor('.lark-doc .lark-doc-fr .lark-doc-fr-ink::before')).toMatch(/height: 6px/)
    expect(ruleFor('.lark-doc .lark-doc-fr.is-replace .lark-doc-fr-ink')).toMatch(/translateX\(60px\)/)
  })

  it('输入框外壳 356 等效宽 + 32 高 + radius 6；按钮 80×32 间距 12', () => {
    expect(ruleFor('.lark-doc .lark-doc-fr .lark-doc-fr-input')).toMatch(/height: 32px/)
    expect(ruleFor('.lark-doc .lark-doc-fr .lark-doc-fr-input')).toMatch(/border-radius: 6px/)
    const actions = ruleFor('.lark-doc .lark-doc-fr .lark-doc-fr-actions')
    expect(actions).toMatch(/gap: 12px/)
    expect(ruleFor('.lark-doc .lark-doc-fr .lark-doc-fr-btn')).toMatch(/width: 80px; min-width: 80px; height: 32px/)
  })

  it('关闭按钮 28×28、主按钮填 --ld-fr-primary-bg（深档是 #3370EB 不是品牌蓝）', () => {
    expect(ruleFor('.lark-doc .lark-doc-fr .lark-doc-fr-close')).toMatch(/width: 28px; min-width: 28px; height: 28px/)
    expect(ruleFor('.lark-doc .lark-doc-fr .lark-doc-fr-btn.is-primary')).toMatch(/background: var\(--ld-fr-primary-bg\)/)
  })

  it('打印时隐藏（浮层不该进纸张）', () => {
    const printBlock = css.slice(css.indexOf('@media print'))
    expect(printBlock).toContain('.lark-doc .lark-doc-fr,')
  })
})

describe('P4-05 查找替换 —— 组件契约与深档同步', () => {
  it('高度按 tab 分叉：查找 186 / 替换 286（04 §3.2）', () => {
    expect(panel).toMatch(/isReplace \? 286 : 186/)
  })

  it('保留 ref="searchInput" 与 focus() 转发 —— 父组件与 toolbarCollapseMixin 靠它聚焦', () => {
    expect(panel).toMatch(/ref="searchInput"/)
    expect(panel).toMatch(/focus\(\) \{ const input = this\.\$refs\.searchInput; if \(input\) input\.focus\(\) \}/)
    expect(editorVue).toMatch(/<SearchPanel\n\s+ref="searchInput"/)
  })

  it('计数器 N / M：无匹配 0 / 0，有匹配是 1-based 当前序号', () => {
    expect(panel).toMatch(/return `\$\{total \? this\.ed\.searchIndex \+ 1 : 0\} \/ \$\{total\}`/)
  })

  it('刻意不做 More / 区分大小写 / 全字匹配 / 正则（④-3 实测不存在）：只有四个动作按钮、没有开关控件', () => {
    // 按钮文案独占一行（eslint vue/multiline-html-element-content-newline），两侧要能吃空白。
    const labels = [...panel.matchAll(/>\s*([^\s<>{}\n][^<>{}\n]*?)\s*<\/button>/g)].map((m) => m[1])
    expect(labels).toEqual(['查找', '替换', '全部替换', '替换', '上一处', '下一处'])
    expect(panel).not.toMatch(/type="checkbox"/)
  })

  it('浅档每个 --ld-fr-* 都在深档有同名覆盖（少一个面板就透明）', () => {
    const names = (source) => new Set((source.match(/--ld-fr-[a-z-]+(?=:)/g) || []))
    const light = names(css)
    const dark = names(darkCss)
    expect(light.size).toBeGreaterThan(0)
    ;[...light].forEach((name) => expect(dark.has(name)).toBe(true))
  })
})
