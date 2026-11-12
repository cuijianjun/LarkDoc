// @vitest-environment jsdom
/** Table viewport clipping, scrollability, and live boundary geometry. */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { describe, expect, it, vi } from 'vitest'
import tableToolsMixin from '../../src/components/lark-doc/editor/tableToolsMixin'
import tableToolsUiMixin from '../../src/components/lark-doc/editor/tableToolsUiMixin'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')
const CSS = read('src/components/lark-doc/lark-doc.css')
const MIXIN = read('src/components/lark-doc/editor/tableToolsMixin.js')
const HOST = read('src/editor/nativeEditorHost.js')

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

describe('fixed 表格边界线的可视范围', () => {
  function boundaryHost(tableLeft = -100, tableWidth = 1200) {
    const wrapper = wrapperOf(tableWidth, 500)
    wrapper.getBoundingClientRect = () => ({ left: 100, right: 600, top: 100, bottom: 180, width: 500, height: 80 })
    const table = document.createElement('table')
    const p = document.createElement('p')
    table.appendChild(p)
    wrapper.appendChild(table)
    table.getBoundingClientRect = () => ({ left: tableLeft, right: tableLeft + tableWidth, top: 100, bottom: 180, width: tableWidth, height: 80 })
    const root = document.createElement('div')
    root.innerHTML = '<div class="lark-doc-paper"></div>'
    root.appendChild(wrapper)
    const host = { $refs: { root }, tableBoundary: { visible: false, style: {} }, editor: { state: { selection: { from: 0 } }, view: { domAtPos: () => ({ node: p }) } }, writable: () => true, featureEnabled: () => true, effectiveReadonly: false }
    Object.entries(tableToolsMixin.methods).forEach(([name, method]) => { host[name] = method.bind(host) })
    host.activeTableElement = () => table
    return { host, table, wrapper }
  }

  it.each([-100, -300, -600])('宽表横滚 left=%s，横线只覆盖 wrapper 的可视内容区', left => {
    const { host } = boundaryHost(left)
    host.updateTableBoundary()
    host.tableBoundary.hover = 'row'
    const state = tableToolsUiMixin.methods.buildTableBoundaryState.call(host)
    expect(state.lineLength).toBe(500)
    expect(state.rowLineLeft).toBe(100 - left)
  })

  it('窄表不会把横线延长到整个 wrapper', () => {
    const { host } = boundaryHost(100, 200)
    host.updateTableBoundary()
    host.tableBoundary.hover = 'row'
    const state = tableToolsUiMixin.methods.buildTableBoundaryState.call(host)
    expect(state.lineLength).toBe(200)
    expect(state.rowLineLeft).toBe(0)
  })

  it('删除行使表格缩小时，旧横线不会留在表格外', () => {
    const { host, table } = boundaryHost(100, 200)
    host.updateTableBoundary()
    host.tableBoundary = { ...host.tableBoundary, hover: 'row', rowLineTop: 70 }
    table.getBoundingClientRect = () => ({ left: 100, right: 300, top: 100, bottom: 140, width: 200, height: 40 })
    host.updateTableBoundary()
    expect(tableToolsUiMixin.methods.buildTableBoundaryState.call(host).open).toBe(false)
  })

  it('行高变化后，横线跟随原来的活单元格边缘', () => {
    const { host, table } = boundaryHost(100, 200)
    const cell = document.createElement('td')
    table.appendChild(cell)
    cell.getBoundingClientRect = () => ({ left: 100, right: 200, top: 100, bottom: 140, width: 100, height: 40 })
    host._tableBoundaryHoverCell = cell
    host.tableBoundary = { ...host.tableBoundary, hover: 'row', rowLineTop: 70 }
    host.updateTableBoundary()
    expect(host.tableBoundary.rowLineTop).toBe(40)
    cell.remove()
    host.updateTableBoundary()
    expect(tableToolsUiMixin.methods.buildTableBoundaryState.call(host).open).toBe(false)
  })

  it('光标在 A 时悬浮 B，命中与后续几何刷新均属于 B', () => {
    const { host, table } = boundaryHost()
    const other = document.createElement('table')
    other.getBoundingClientRect = () => ({ left: 200, right: 400, top: 200, bottom: 280, width: 200, height: 80 })
    host.$refs.root.appendChild(other)
    host.tableRectElementAtPoint = () => other
    expect(host.activeTableElement()).toBe(table)
    expect(host.activeTableRectElement({ clientX: 250, clientY: 240 })).toBe(other)
    host._tableBoundaryHoverTable = other
    host.tableBoundary.hover = 'row'
    host.updateTableBoundary()
    expect(host.tableBoundary.style.left).toBe('200px')
    expect(host.tableBoundary.style.width).toBe('200px')
  })
})

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

describe('规格层：表格的最终滚动规则', () => {
  const finalRule = selector => {
    const at = CSS.lastIndexOf(selector)
    const open = CSS.indexOf('{', at)
    return CSS.slice(open + 1, CSS.indexOf('}', open))
  }

  it('最终生效的 wrapper 允许横滚并隐藏原生滚动条', () => {
    const rule = finalRule('.ProseMirror .tableWrapper {')
    expect(rule).toContain('overflow-x: auto')
    expect(rule).toContain('overflow-y: hidden')
    expect(rule).toContain('scrollbar-width: none')
    expect(finalRule('.ProseMirror .tableWrapper::-webkit-scrollbar {')).toContain('display: none')
  })

  it('关闭旧静态渐隐层，由表格交互层随滚动计算阴影', () => {
    expect(finalRule('.tableWrapper.is-clipped::after {')).toContain('display: none')
  })

  it('窄表保留实际列宽，不再强制撑满整个文档', () => {
    const rule = finalRule('.ProseMirror table {')
    expect(rule).toContain('min-width: 0')
    expect(rule).toContain('table-layout: fixed')
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
    expect(HOST).toContain('host.syncTableClip()')
  })
})
