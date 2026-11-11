import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const Vue = require('vue/dist/vue.common.js')
const compiler = require('vue-template-compiler')
const source = readFileSync(new URL('../../src/components/lark-doc/editor/TableBoundaryTools.vue', import.meta.url), 'utf8')
const template = compiler.parseComponent(source).template.content
const compiled = compiler.compile(template)
const Component = Vue.extend({ props: ['ed'], render: new Function(compiled.render), staticRenderFns: compiled.staticRenderFns.map(code => new Function(code)) })

describe('表格边界工具栏真实Vue模板渲染', () => {
  for (const hover of ['column', 'row']) it(`${hover}悬停读取父编辑器几何并保留前后插入按钮`, () => {
    expect(compiled.errors).toEqual([])
    const errors = [], previous = Vue.config.errorHandler
    Vue.config.errorHandler = error => errors.push(error)
    const component = new Component({ propsData: { ed: {
      featureEnabled: () => true, effectiveReadonly: false,
      tableBoundary: { visible: true, hover, style: { left: '17px', top: '29px' }, columnLineLeft: 43, rowLineTop: 59 },
      keepTableBoundaryHover() {}, clearTableBoundaryHover() {}, tableBoundaryAction() {},
    } } })
    try {
      const node = component._render()
      expect(errors).toEqual([])
      expect(node.data.style.left).toBe('17px')
      expect(node.data.style.top).toBe('29px')
      expect(node.data.style['--lark-doc-column-line-left']).toBe('43px')
      expect(node.data.style['--lark-doc-row-line-top']).toBe('59px')
      expect(node.children.filter(child => child.tag === 'button').map(child => child.data.attrs['aria-label'])).toEqual(
        hover === 'column' ? ['在左侧插入列', '在右侧插入列'] : ['在上方插入行', '在下方插入行'],
      )
    } finally { component.$destroy(); Vue.config.errorHandler = previous }
  })
})

describe('高亮块工具栏真实Vue模板事件', () => {
  it('文字颜色按钮传递原颜色目标，选择颜色可进入对应父处理分支', () => {
    const file = readFileSync(new URL('../../src/components/lark-doc/editor/CalloutTools.vue', import.meta.url), 'utf8')
    const compiled = compiler.compile(compiler.parseComponent(file).template.content)
    expect(compiled.errors).toEqual([])
    const Component = Vue.extend({ props: ['ed'], render: new Function(compiled.render), staticRenderFns: compiled.staticRenderFns.map(code => new Function(code)) })
    const calls = [], component = new Component({ propsData: { ed: {
      activeCalloutVisible: true, featureEnabled: () => true, calloutToolsStyle: {}, calloutColor: () => '#123456', calloutEmojiOpen: false,
      toggleColorPalette: (...args) => calls.push(args), setCalloutColor() {}, toggleCalloutEmoji() {}, resetCalloutStyle() {}, deleteActiveCallout() {},
    } } })
    try {
      const event = { preventDefault() {} }
      component._render().children.find(child => child.tag === 'label').data.on.click(event)
      expect(calls).toEqual([['calloutColor', event]])
    } finally { component.$destroy() }
  })
})
