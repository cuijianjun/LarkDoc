/**
 * P6b 接线（09 §5.8 收口）：五条线「互不重叠地挂进同一个编辑器实例」。
 *
 * 这里守的是四件**一眼看不见、错了也不报错**的事：
 *   1. `p6bMixin` 真的挂在门面的 mixins 数组里 —— 漏了不会崩，只会所有能力静默失效；
 *   2. `LarkDocOverlays` 真的出现在模板里（Vue 2 `components` 走 mergeAssets，
 *      光 import 不写标签就是「注册了但没用」）；
 *   3. 浮层包裹层**不带 v-if**（04 §4.6.7③「弹窗关闭 → toast」会被父级提前摘掉）；
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
const overlays = read('src/components/lark-doc/editor/LarkDocOverlays.vue')

const mixinsLine = sfc.split('\n').find((line) => line.trim().startsWith('mixins: ['))
const aggregatorMixins = aggregator.split('\n').find((line) => line.trim().startsWith('mixins: ['))

// 「不许出现」类断言必须先看**代码**而不是注释：本文件的头注释里就把 transform /
// filter 这些禁词当说明写了，不剥注释会自己把自己判红。
const overlaysCode = overlays
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/^[^\n\S]*\/\/.*$/gm, '')

describe('P6b · 门面接线', () => {
  it('p6bMixin 已注册 + 模板挂载浮层组（缺一即全线静默失效）', () => {
    expect(sfc).toContain("import p6bMixin from './editor/p6bMixin'")
    expect(mixinsLine).toContain('p6bMixin')
    expect(sfc).toContain('<LarkDocOverlays :ed="self" />')
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
  it('五条线的面板都是兄弟节点（fixed 定位的祖先不能有 transform/非 static）', () => {
    for (const tag of ['CommentPanel', 'VersionPanel', 'SaveVersionDialog', 'SharePopover', 'ExportDialog']) {
      expect(overlays).toContain(`<${tag} :ed="ed" />`)
    }
    // 五个子节点同一个根 div 的直系孩子：不含第二层包裹容器。
    expect(overlays).toContain('<div class="lark-doc-p6b-layer">')
  })

  it('包裹层不带 v-if / transform / filter / overflow（会改写 fixed 包含块或提前摘 toast）', () => {
    const wrapper = '<div class="lark-doc-p6b-layer">'
    expect(overlaysCode).toContain(wrapper)
    expect(overlaysCode).not.toContain('v-if')
    // 五子节点自管理显隐，容器自身永不参与定位：连 <style> 都没有。
    expect(overlaysCode).not.toContain('<style')
    for (const forbidden of ['transform', 'filter', 'overflow', 'position']) {
      expect(overlaysCode).not.toContain(forbidden)
    }
  })

  it('ed 是 LarkDocEditor 实例本身，原样下传（面板直接读 ed.editor / ed.session）', () => {
    expect(overlays).toContain('ed: { type: Object, required: true }')
  })
})
