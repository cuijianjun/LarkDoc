/**
 * P6b 接线（09 §5.8 收口）：五条线「互不重叠地挂进同一个编辑器实例」。
 *
 * 这里守的是四件**一眼看不见、错了也不报错**的事：
 *   1. `p6bMixin` 真的挂在门面的 mixins 数组里 —— 漏了不会崩，只会所有能力静默失效；
 *   2. 原生 overlays 宿主真的出现在模板里，并由 overlaysUiMixin 接线；
 *   3. 原生浮层各自按状态真实插入 / 移除，不能由 Vue 父级提前摘掉 toast；
 *   4. `readingModeMixin` 排在最后 —— 它的 `writable()` 是另四条线的判据上游，
 *      靠后才能压住前面的旧口径（Vue 2 同层后写胜）。
 *
 * 全部读源码文本：`.vue` 在本仓库单测里禁止 import（core 不得依赖组件）。
 */
import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'

const root = path.resolve(__dirname, '../..')
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')

const sfc = read('src/components/lark-doc/LarkDocEditor.vue')
const aggregator = read('src/components/lark-doc/editor/p6bMixin.js')
const overlaysUi = read('src/components/lark-doc/editor/overlaysUiMixin.js')
const overlaysRenderer = read('src/ui/overlays.js')

const mixinsLine = sfc.split('\n').find((line) => line.trim().startsWith('mixins: ['))
const aggregatorMixins = aggregator.split('\n').find((line) => line.trim().startsWith('mixins: ['))

// 「不许出现」类断言必须先看**代码**而不是注释：本文件的头注释里就把 transform /
// filter 这些禁词当说明写了，不剥注释会自己把自己判红。

describe('P6b · 门面接线', () => {
  it('p6bMixin 与 overlaysUiMixin 已注册 + 模板挂载原生浮层宿主', () => {
    expect(sfc).toContain("import p6bMixin from './editor/p6bMixin'")
    expect(sfc).toContain("import overlaysUiMixin from './editor/overlaysUiMixin'")
    expect(mixinsLine).toContain('p6bMixin')
    expect(mixinsLine).toContain('overlaysUiMixin')
    expect(sfc).toContain('<div ref="overlayHost" />')
    expect(overlaysUi).toContain('createOverlays')
  })

  it('门面仍守 P0-03 的 <700 行门禁（含 P6b 全部接线）', () => {
    expect(sfc.split('\n').length).toBeLessThan(700)
  })

  it('五个子 mixin 全在聚合层里，且 readingModeMixin 排最后', () => {
    const names = ['commentsMixin', 'versioningMixin', 'shareMixin', 'exportMixin', 'readingModeMixin']
    for (const name of names) {
      expect(aggregator).toContain(`import ${name} from './${name}'`)
      expect(aggregatorMixins).toContain(name)
    }
    expect(aggregatorMixins.trim().endsWith('readingModeMixin],')).toBe(true)
  })
})

describe('P6b · 浮层容器', () => {
  it('原生渲染器保留分享 / 权限 / 导出完整结构与语义属性', () => {
    for (const className of [
      'lark-doc-share-mask', 'lark-doc-share-popover', 'lark-doc-permission-layer',
      'lark-doc-share-confirm', 'lark-doc-share-password', 'lark-doc-export-backdrop',
      'lark-doc-export-panel',
    ]) expect(overlaysRenderer).toContain(className)
    expect(overlaysRenderer).toContain("role', 'dialog'")
    expect(overlaysRenderer).toContain("aria-modal",)
    expect(overlaysRenderer).toContain("aria-label",)
  })

  it('原生浮层使用真实插入 / 移除，并保留遮罩、Esc 业务出口', () => {
    expect(overlaysRenderer).toContain('mountNode(host, el, true)')
    expect(overlaysRenderer).toContain("event.target === backdrop")
    expect(overlaysUi).toContain('destroyOverlays()')
  })
})
