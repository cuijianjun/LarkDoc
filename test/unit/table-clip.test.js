// @vitest-environment jsdom
/**
 * P5-01：表格超宽是**裁切**不是滚动（02 §10 ⑦-5 / A20 定判）。
 *
 * 这条规格有两半，缺一半都不算完成：
 *   ① CSS 把 `.tableWrapper` 从 `overflow-x: auto` 改成 `hidden`，并在右端叠 24px 渐隐；
 *   ② `is-clipped` 只在**真的溢出**时挂 —— CSS 自己在 hidden 下无从判断溢出，
 *      必须由 JS 量 `scrollWidth > clientWidth`。
 * 只做 ① 会让不溢出的表格右边缘也淡掉 24px（看着像描边缺一段），所以两组都要锁。
 *
 * 渐隐宽度与色值没有飞书实测值（那层由飞书组件内联算），24px + 纸面底色是我们兜底的
 * 选择，一旦真机采到就改 CSS 与本文件的常量，别只改一处。
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { describe, expect, it, vi } from 'vitest'
import tableToolsMixin from '../../src/components/lark-doc/editor/tableToolsMixin'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')
const CSS = read('src/components/lark-doc/lark-doc.css')
const MIXIN = read('src/components/lark-doc/editor/tableToolsMixin.js')
const HOST = read('src/components/lark-doc/LarkDocEditor.vue')

const FADE_WIDTH = 24

/** 造一个 wrapper，并按需伪造两个只读布局属性（jsdom 里恒为 0）。 */
function wrapperOf(contentWidth, boxWidth) {
  const wrapper = document.createElement('div')
  wrapper.className = 'tableWrapper'
  Object.defineProperty(wrapper, 'scrollWidth', { value: contentWidth, configurable: true })
  Object.defineProperty(wrapper, 'clientWidth', { value: boxWidth, configurable: true })
  return wrapper
}

/** 以「只挂了 tableToolsMixin 的假宿主」调用 syncTableClip。 */
function syncWith(wrappers) {
  const dom = document.createElement('div')
  wrappers.forEach((w) => dom.appendChild(w))
  const host = { editor: { view: { dom } } }
  tableToolsMixin.methods.syncTableClip.call(host)
}

const clipped = (w) => w.classList.contains('is-clipped')

describe('syncTableClip 溢出判定', () => {
  it('溢出才挂 is-clipped，不溢出保持干净', () => {
    const over = wrapperOf(320, 200)
    const fit = wrapperOf(200, 200)
    syncWith([over, fit])
    expect(clipped(over)).toBe(true)
    expect(clipped(fit)).toBe(false)
  })

  it('1px 容差内不算溢出（缩放与亚像素会把 equals 变成 0.5 的差）', () => {
    const almost = wrapperOf(201, 200)
    syncWith([almost])
    expect(clipped(almost)).toBe(false)
    const real = wrapperOf(202, 200)
    syncWith([real])
    expect(clipped(real)).toBe(true)
  })

  it('收窄窗口后原本溢出的表格要能摘掉 is-clipped', () => {
    const wrapper = wrapperOf(320, 200)
    syncWith([wrapper])
    expect(clipped(wrapper)).toBe(true)
    Object.defineProperty(wrapper, 'scrollWidth', { value: 200, configurable: true })
    syncWith([wrapper])
    expect(clipped(wrapper)).toBe(false)
  })

  it('状态没变时不重复写 classList（避免每帧事务都碰 DOM）', () => {
    const wrapper = wrapperOf(320, 200)
    syncWith([wrapper])
    const spy = vi.spyOn(wrapper.classList, 'toggle')
    syncWith([wrapper])
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('没有编辑器 / 没有 DOM 时静默返回，不抛', () => {
    expect(() => tableToolsMixin.methods.syncTableClip.call({ editor: null })).not.toThrow()
    expect(() => tableToolsMixin.methods.syncTableClip.call({ editor: { view: {} } })).not.toThrow()
    expect(() => tableToolsMixin.methods.syncTableClip.call({})).not.toThrow()
  })

  it('非表格页面上没有 .tableWrapper 也不抛', () => {
    expect(() => syncWith([])).not.toThrow()
  })
})

describe('规格层：裁切 + 渐隐（CSS）', () => {
  /** 取 `.tableWrapper { ... }` 与 `.tableWrapper.is-clipped::after { ... }` 的声明体。 */
  const ruleOf = (selector) => {
    const at = CSS.indexOf(selector)
    if (at < 0) return ''
    const open = CSS.indexOf('{', at)
    const close = CSS.indexOf('}', open)
    return CSS.slice(open + 1, close)
  }

  it('.tableWrapper 是裁切不是滚动', () => {
    const rule = ruleOf('.ProseMirror .tableWrapper {')
    expect(rule).toContain('overflow-x: hidden')
    expect(rule).not.toContain('overflow-x: auto')
    expect(rule).not.toContain('overflow-x: scroll')
    // ::after 要绝对定位贴右，父级必须有定位上下文。
    expect(rule).toContain('position: relative')
  })

  it('右端渐隐层：宽度、位置、不吃点击', () => {
    const rule = ruleOf('.tableWrapper.is-clipped::after')
    expect(rule).toContain(`width: ${FADE_WIDTH}px`)
    expect(rule).toContain('position: absolute')
    expect(rule).toContain('right: 0')
    expect(rule).toContain('pointer-events: none')
    expect(rule).toContain('linear-gradient(to right')
    // z-index 要压住单元格描边，否则渐隐盖不住右边缘那条线。
    expect(rule).toContain('z-index: 2')
  })

  it('渐隐终点用纸面底色 token，不写死颜色', () => {
    const rule = ruleOf('.tableWrapper.is-clipped::after')
    expect(rule).toContain('var(--ld-bg-content)')
    expect(rule).not.toMatch(/#[0-9a-fA-F]{3,8}/)
  })

  it('渐隐起点不能是 transparent（黑色透明会在中途泛灰雾）', () => {
    const rule = ruleOf('.tableWrapper.is-clipped::after')
    expect(rule).not.toMatch(/linear-gradient\([^)]*transparent/)
    // 必须是零透明度的白。
    expect(rule).toMatch(/rgba\(255,\s*255,\s*255,\s*0\)/)
  })

  it('渐隐只在 is-clipped 时出现，默认规则里没有 ::after', () => {
    expect(ruleOf('.ProseMirror .tableWrapper {')).toBeTruthy()
    expect(ruleOf('.ProseMirror .tableWrapper {')).not.toContain('::after')
  })
})

describe('规格层：接线', () => {
  it('mixin 用 scrollWidth/clientWidth 判定', () => {
    expect(MIXIN).toContain('scrollWidth > wrapper.clientWidth + 1')
    expect(MIXIN).toContain('.tableWrapper')
    expect(MIXIN).toContain('is-clipped')
  })

  it('首屏与窗口尺寸变化都会重算', () => {
    expect(MIXIN).toContain("window.addEventListener('resize', this.syncTableClip)")
    expect(MIXIN).toContain("window.removeEventListener('resize', this.syncTableClip)")
    expect(MIXIN).toContain('requestAnimationFrame(() => this.syncTableClip())')
  })

  it('列宽拖拽结束会 dispatch 事务，所以 onTransaction 里重算就够', () => {
    expect(HOST).toContain('this.syncTableClip()')
  })
})
