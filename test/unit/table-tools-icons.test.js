// @vitest-environment jsdom
/**
 * 表格浮窗图标：`TABLE_ICONS` 是表格选区浮窗专用的按值图标表（见 `src/ui/tableToolsIcons.js`）。
 *
 * 这张表不进初始图标表，所以取图路径必须走「现成 SVG 透传」：
 * 任何一处退回 `ICONS[name]` 查表都会让浮窗按钮渲染成空 span（图标消失但不报错）。
 */
import { describe, expect, it } from 'vitest'
import { iconMarkup, iconNode, setIcon } from '../../src/ui/icon'
import { ICONS } from '../../src/ui/icons'
import { TABLE_ICONS } from '../../src/ui/tableToolsIcons'

const KEYS = [
  'table-insert-boundary', 'table-float-header-row', 'table-float-header-column', 'table-float-merge',
  'table-float-background', 'table-float-text', 'table-float-align', 'table-float-bold', 'table-float-strike',
  'table-float-italic', 'table-float-underline', 'table-float-code', 'table-float-more', 'table-float-distribute',
  'table-float-highlight', 'valign-top', 'valign-middle', 'valign-bottom',
]

describe('表格浮窗按值图标', () => {
  it('every table-tool icon ships a complete svg and is no longer in the initial icon table', () => {
    for (const key of KEYS) {
      const svg = TABLE_ICONS[key]
      expect(typeof svg, key).toBe('string')
      expect(svg.startsWith('<svg'), key).toBe(true)
      expect(svg.trimEnd().endsWith('</svg>'), key).toBe(true)
      expect(svg.length, key).toBeGreaterThan(80)
      // 初始表里只保留跨区块复用的键：表格浮窗专用的必须搬走，否则初始包会带上整批图形。
      expect(ICONS[key], key).toBeUndefined()
    }
  })

  it('iconMarkup resolves names from trusted icon tables only', () => {
    expect(iconMarkup('table-float-bold', TABLE_ICONS)).toBe(TABLE_ICONS['table-float-bold'])
    expect(iconMarkup('block-text')).toBe(ICONS['block-text'])
    expect(iconMarkup('block-text')).toContain('<svg')
    expect(iconMarkup('no-such-icon')).toBe('')
    expect(iconMarkup(undefined)).toBe('')
    expect(iconMarkup('<svg></svg>')).toBe('')
  })

  it('iconNode and setIcon render the svg payload with the documented span contract', () => {
    const node = iconNode('valign-top', 24, 'lark-doc-table-tools-icon', TABLE_ICONS)
    expect(node.className).toBe('lark-doc-table-tools-icon lark-doc-icon')
    expect(node.style.width).toBe('24px')
    expect(node.style.height).toBe('24px')
    // jsdom 会重排属性顺序，比结构不比整串。
    expect(node.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 16 16')
    expect(node.innerHTML.length).toBeGreaterThan(80)

    const target = document.createElement('span')
    target.innerHTML = '<svg></svg>'
    setIcon(target, 'table-float-distribute', 18, TABLE_ICONS)
    expect(target.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 24 24')
    expect(target.style.width).toBe('18px')
    // 键名路径不变：已知键仍然按表取图。
    setIcon(target, 'block-text', 16)
    expect(target.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 24 24')
    expect(target.innerHTML).not.toContain('<svg></svg>')
  })
})
