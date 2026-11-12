/**
 * P4-04 文档小组件块（isv）：校验 → 写读路径 → 面板几何 → 目录树 → 编辑器往返。
 *
 * 六组用例各守一条**跑得通但会静默错**的口径，改任一条都要先回头看 02 §22：
 *
 * 1. `isButtonLinkValid` / `normalizeButtonLink` —— 只放 `http(s)`。`javascript:` /
 *    `data:` / `mailto:` 一律非法（按钮点击直接进 `window.open`，放行等于把脚本执行权
 *    交给文档内容），空串也是非法（`超链接地址` 是必填项）。
 * 2. `validateIsvButton` —— `关注文档更新` **不判链接必填**（面板上那行根本不在）；
 *    返回的是字段名数组不是文案，面板按字段加红框。
 * 3. `normalizeIsv` 造实例键 / `readIsv` 只判不造 —— 缺 `instanceId` 时后者返回 `null`
 *    （→ NodeView 画「数据缺失」），写路径则会补一个。宽容/严格两侧别混用。
 * 4. `catalogIndent` / `catalogFontWeight` —— 缩进恒 `6 + 16×(level−1)`，
 *    **只有一级是 500**；`buildCatalogTree` 必须真嵌套（父高 = 32 + 后代之和）。
 * 5. `isvPanelHeight` —— 386 / 308（`follow_page` 少一行）/ 424（校验失败撑高）。
 * 6. 编辑器往返 —— `setIsv` 校验不过返回 `false` 且**正文不变**（面板据此不关不插块）；
 *    默认按钮**不写 inline 底色**，走 CSS 的 #E0E9FF（真机实测值，不是色板默认格）。
 */
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { getSchema } from '@tiptap/core'
import { createLarkDocExtensions } from '../../src/components/lark-doc/extensions'
import {
  BUTTON_ACTION_DEFAULT, BUTTON_TEXT_DEFAULT, ISV_APP_ID, ISV_BUTTON_ACTIONS,
  ISV_BUTTON_HEIGHT, ISV_DEFAULT_HEIGHT, ISV_KINDS, ISV_PANEL, ISV_VALIDATION_MESSAGE,
  buildCatalogTree, catalogFontWeight, catalogIndent, flattenCatalogTree, isButtonLinkValid,
  isvPanelHeight, normalizeButtonLink, normalizeIsv, readIsv, validateIsvButton,
} from '../../src/core/blocks/isv'
import { createIsvPanel } from '../../src/ui/isvPanel'
import readingModeMixin from '../../src/components/lark-doc/editor/readingModeMixin'
import isvPanelUiMixin from '../../src/components/lark-doc/editor/isvPanelUiMixin'

describe('button configuration input and keyboard lifecycle', () => {
  function panel(run) {
    const host = document.createElement('div')
    document.body.append(host)
    const state = { open: true, text: '按钮', link: '', color: '#E1EAFF', colors: [[{ value: '#E1EAFF', label: '浅色' }]], action: 'open_link', actionLabel: '打开超链接', actions: ISV_BUTTON_ACTIONS, needsLink: true, height: 386 }
    const confirm = vi.fn(), close = vi.fn(), color = vi.fn()
    const ui = createIsvPanel({ host, handlers: {
      onText: event => { state.text = event.target.value; ui.update(state) },
      onLink: event => { state.link = event.target.value; ui.update(state) },
      onToggleAction: () => { state.selectOpen = !state.selectOpen; ui.update(state) },
      onAction: id => { state.action = id; state.needsLink = id === 'open_link'; state.selectOpen = false; ui.update(state) },
      onColor: color, onConfirm: confirm, onClose: close,
    } })
    try { ui.update(state); return run({ host, state, ui, confirm, close, color }) } finally { ui.destroy(); host.remove() }
  }
  it('retains the focused input, caret and typed characters across state refreshes', () => panel(({ host, ui }) => {
    const input = host.querySelector('input[aria-label="按钮文字"]')
    expect(document.activeElement).toBe(input)
    for (const value of ['新', '新按钮', '新按钮ABC']) {
      input.value = value; input.setSelectionRange(value.length, value.length)
      input.dispatchEvent(new Event('input', { bubbles: true }))
      expect(host.querySelector('input[aria-label="按钮文字"]')).toBe(input)
      expect(document.activeElement).toBe(input)
      expect(input.selectionStart).toBe(value.length)
    }
    ui.update({ errorField: 'linkUrl' })
    expect(document.activeElement).toBe(input)
  }))
  it('preserves IME drafts through unrelated updates and does not submit a composition Enter', () => panel(({ host, ui, state, confirm }) => {
    const input = host.querySelector('input')
    input.dispatchEvent(new CompositionEvent('compositionstart'))
    input.value = '正在组字'
    input.dispatchEvent(new InputEvent('input', { isComposing: true }))
    ui.update({ errorField: 'linkUrl' })
    expect(input.value).toBe('正在组字')
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }))
    expect(confirm).not.toHaveBeenCalled()
    input.dispatchEvent(new CompositionEvent('compositionend'))
    expect(state.text).toBe('正在组字')
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(confirm).toHaveBeenCalledTimes(1)
  }))
  it('accepts keyboard-generated click for footer, swatch and action options exactly once', () => panel(({ host, confirm, close, color, state }) => {
    host.querySelector('.is-primary').click()
    host.querySelector('.lark-doc-isv-panel-footer button').click()
    const swatch = host.querySelector('.lark-doc-isv-color-item')
    swatch.focus(); swatch.click()
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
    expect(color).toHaveBeenCalledWith('#E1EAFF')
    host.querySelector('.lark-doc-isv-select').click()
    host.querySelectorAll('[role="option"]')[2].click()
    expect(state.action).toBe('follow_page')
    expect(host.querySelector('input[aria-label="超链接地址"]')).toBeNull()
  }))
  it('keeps color and dropdown nodes alive while editing and traverses the dropdown with arrows', () => panel(({ host, ui }) => {
    const swatch = host.querySelector('.lark-doc-isv-color-item')
    swatch.focus(); ui.update({ link: 'https://www.barenkeji.com' })
    expect(document.activeElement).toBe(swatch)
    const select = host.querySelector('.lark-doc-isv-select')
    select.click()
    const options = host.querySelectorAll('[role="option"]')
    options[0].focus()
    options[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    expect(document.activeElement).toBe(options[1])
    options[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(host.querySelector('[role="listbox"]')).toBeNull()
    expect(document.activeElement).toBe(select)
  }))
  it('clears and closes stale configuration when read permissions change', () => {
    const closeIsvPanel = vi.fn(), refreshIsvPanel = vi.fn()
    isvPanelUiMixin.watch.effectiveReadonly.call({ closeIsvPanel, refreshIsvPanel }, true)
    expect(closeIsvPanel).toHaveBeenCalledTimes(1)
    expect(refreshIsvPanel).toHaveBeenCalledTimes(1)
    readingModeMixin.methods.closeEditingOverlays.call({ closeIsvPanel })
    expect(closeIsvPanel).toHaveBeenCalledTimes(2)
  })
})

describe('P4-04 isv 链接合法性（02 §22 ⑤-1）', () => {
  it('只放 http(s)，脚本协议与空串一律非法', () => {
    expect(isButtonLinkValid('https://example.com/a?b=1')).toBe(true)
    expect(isButtonLinkValid('http://example.com')).toBe(true)
    expect(isButtonLinkValid('javascript:alert(1)')).toBe(false)
    expect(isButtonLinkValid('data:text/html,<script>')).toBe(false)
    expect(isButtonLinkValid('mailto:a@b.com')).toBe(false)
    expect(isButtonLinkValid('ftp://example.com')).toBe(false)
    expect(isButtonLinkValid('')).toBe(false)
    expect(isButtonLinkValid('   ')).toBe(false)
    expect(isButtonLinkValid(null)).toBe(false)
    // 有协议没主机名：URL 构造得出来但没有跳转目标，仍然非法。
    expect(isButtonLinkValid('https://')).toBe(false)
  })

  it('归一化后非法一律回空串（上层用「空 = 未通过」判）', () => {
    expect(normalizeButtonLink('  https://example.com/  ')).toBe('https://example.com/')
    expect(normalizeButtonLink('javascript:alert(1)')).toBe('')
    expect(normalizeButtonLink('')).toBe('')
  })
})

describe('P4-04 isv 按钮校验（02 §22 ⑤-1）', () => {
  it('缺链接报 linkUrl；缺文案报 buttonText', () => {
    expect(validateIsvButton({ action: 'open_link', buttonText: '按钮', linkUrl: '' })).toEqual(['linkUrl'])
    expect(validateIsvButton({ action: 'open_link', buttonText: '  ', linkUrl: 'https://a.com' })).toEqual(['buttonText'])
    expect(validateIsvButton({ action: 'open_link', buttonText: '按钮', linkUrl: 'https://a.com' })).toEqual([])
  })

  it('关注文档更新不判链接必填', () => {
    expect(validateIsvButton({ action: 'follow_page', buttonText: '按钮', linkUrl: '' })).toEqual([])
    expect(validateIsvButton({ action: 'duplicate_page', buttonText: '按钮', linkUrl: '' })).toEqual([])
  })

  it('默认 action 是打开超链接，文案原文不改写', () => {
    expect(BUTTON_ACTION_DEFAULT).toBe('open_link')
    expect(ISV_VALIDATION_MESSAGE).toBe('超链接不合法，请重新输入')
    expect(ISV_BUTTON_ACTIONS).toHaveLength(3)
    expect(BUTTON_TEXT_DEFAULT).toBe('按钮')
  })
})

describe('P4-04 isv 写读路径', () => {
  it('normalizeIsv 补实例键与默认色，非法 kind 落 catalog', () => {
    const one = normalizeIsv({ kind: 'button', buttonText: '按钮', linkUrl: 'https://a.com' })
    expect(one.kind).toBe(ISV_KINDS.button)
    expect(one.instanceId).toBeTruthy()
    expect(one.appId).toBe(ISV_APP_ID)
    expect(one.align).toBe('left')
    expect(one.height).toBe(ISV_BUTTON_HEIGHT)
    expect(one.buttonColor).toBe('')
    const two = normalizeIsv({ kind: 'button' })
    expect(two.instanceId).not.toBe(one.instanceId)

    const catalog = normalizeIsv({ kind: 'nope' })
    expect(catalog.kind).toBe(ISV_KINDS.catalog)
    expect(catalog.height).toBe(ISV_DEFAULT_HEIGHT)
    expect(catalog.buttonText).toBe('')
    expect(catalog.linkUrl).toBe('')
  })

  it('readIsv 缺实例键返回 null（不画假组件），有则只读不造', () => {
    expect(readIsv({ kind: 'button', buttonText: '按钮' })).toBe(null)
    const view = readIsv({ ...normalizeIsv({ kind: 'button', buttonText: '按钮' }), height: 300 })
    expect(view.kind).toBe(ISV_KINDS.button)
    expect(view.height).toBe(300)
    expect(view.buttonText).toBe('按钮')
  })

  it('非 open_link 的链接一律清空，不带上一动作的输入串味', () => {
    const view = normalizeIsv({ kind: 'button', action: 'follow_page', linkUrl: 'https://a.com' })
    expect(view.action).toBe('follow_page')
    expect(view.linkUrl).toBe('')
  })
})

describe('P4-04 目录导航几何与树（02 §22 ④-5）', () => {
  it('缩进 6/22/38，只有一级 500', () => {
    expect(catalogIndent(1)).toBe(6)
    expect(catalogIndent(2)).toBe(22)
    expect(catalogIndent(3)).toBe(38)
    expect(catalogIndent(0)).toBe(6)
    expect(catalogFontWeight(1)).toBe(500)
    expect(catalogFontWeight(2)).toBe(400)
    expect(catalogFontWeight(3)).toBe(400)
  })

  it('父子真嵌套：父高 = 32 + 后代之和，平铺画不出这个关系', () => {
    const tree = buildCatalogTree([
      { pos: 1, level: 1, text: 'A' },
      { pos: 5, level: 2, text: 'A1' },
      { pos: 9, level: 2, text: 'A2' },
      { pos: 20, level: 1, text: 'B' },
    ])
    expect(tree).toHaveLength(2)
    expect(tree[0].children).toHaveLength(2)
    expect(tree[1].children).toHaveLength(0)

    const flat = flattenCatalogTree(tree)
    expect(flat).toHaveLength(4)
    expect(flat[0]).toMatchObject({ text: 'A', depth: 0, leaves: 2 })
    expect(flat[1]).toMatchObject({ text: 'A1', depth: 1, leaves: 0 })
    expect(flat[3]).toMatchObject({ text: 'B', depth: 0, leaves: 0 })
  })
})

describe('P4-04 按钮面板几何（02 §22 ④-4 / ⑤-1）', () => {
  it('386 / 308 / 424 三档', () => {
    expect(isvPanelHeight('open_link', false)).toBe(ISV_PANEL.height)
    expect(isvPanelHeight('duplicate_page', false)).toBe(ISV_PANEL.height)
    expect(isvPanelHeight('follow_page', false)).toBe(ISV_PANEL.followHeight)
    expect(isvPanelHeight('open_link', true)).toBe(ISV_PANEL.errorHeight)
    expect(ISV_PANEL.width).toBe(270)
  })
})

describe('P4-04 isv 编辑器往返', () => {
  const schema = getSchema(createLarkDocExtensions())

  it('进 schema，且是原子块（不可编辑内容）', () => {
    expect(schema.nodes.isv).toBeTruthy()
    expect(schema.nodes.isv.isAtom).toBe(true)
    expect(schema.nodes.isv.spec.selectable).toBe(true)
  })

  it('默认按钮不写 inline 底色 —— 留空走 CSS 的 #E0E9FF（真机实测，不是色板默认格）', () => {
    const attrs = normalizeIsv({ kind: 'button', buttonText: '按钮', linkUrl: 'https://a.com' })
    const node = schema.nodes.isv.create(attrs)
    expect(node.attrs.buttonColor).toBeFalsy()
    // 反过来：选过色才带值。
    const colored = normalizeIsv({ kind: 'button', buttonText: '按钮', linkUrl: '', action: 'follow_page', buttonColor: '#ff0000' })
    expect(colored.buttonColor).toBe('#ff0000')
  })

  it('非法底色 / 非法链接进不了 schema（属性校验拦，不是靠 insertContent 的 warning）', () => {
    const bad = normalizeIsv({ kind: 'button', buttonText: '按钮', action: 'follow_page', buttonColor: 'rgb(1,2,3)' })
    expect(() => schema.nodes.isv.create(bad)).toThrow()
    const badLink = normalizeIsv({ kind: 'button', buttonText: '按钮', linkUrl: 'javascript:alert(1)' })
    expect(badLink.linkUrl).toBe('')
  })
})
