import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createLarkDocConfig, mergeLegacyConfig } from '../../src/components/lark-doc/larkDocConfig'

const editorSource = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/components/lark-doc/LarkDocEditor.vue'), 'utf8')

describe('spec002 默认上下文工具栏与宿主兼容', () => {
  it('默认不挂载格式工具栏，不关闭上下文格式能力', () => {
    const config = createLarkDocConfig()
    expect(config.layout.toolbarVisible).toBe(false)
    expect(config.layout.toolbarFixed).toBe(false)
    for (const feature of ['marks', 'headings', 'blockStyle', 'insert', 'blockHandle']) expect(config.features[feature]).toBe(true)
    expect(editorSource).toMatch(/<ToolbarBar\s+v-if="larkDocConfig\.layout\.toolbarVisible"/)
    expect(editorSource).toContain('<BubbleBar :ed="self" />')
    expect(editorSource).toContain('<BlockHandleMenu :ed="self" />')
  })

  it('显式显示支持非吸附工具栏，原 toolbarFixed=true 仍可兼容开启', () => {
    expect(createLarkDocConfig({ layout: { toolbarVisible: true } }).layout).toMatchObject({ toolbarVisible: true, toolbarFixed: false })
    expect(createLarkDocConfig({ layout: { toolbarFixed: true } }).layout).toMatchObject({ toolbarVisible: true, toolbarFixed: true })
    expect(createLarkDocConfig({ layout: { toolbarFixed: true, toolbarVisible: false } }).layout.toolbarVisible).toBe(false)
    expect(createLarkDocConfig({ layout: { toolbarVisible: 'true' } }).layout.toolbarVisible).toBe(false)
    expect(mergeLegacyConfig({ layout: { toolbarVisible: true } }).layout.toolbarVisible).toBe(true)
  })

  it('标题栏和格式栏都隐藏时仍直接渲染普通或作用域宿主操作插槽', () => {
    const config = createLarkDocConfig({ layout: { headerVisible: false } })
    expect(config.layout).toMatchObject({ headerVisible: false, toolbarVisible: false })
    expect(editorSource).toMatch(/v-else-if="!larkDocConfig\.layout\.headerVisible && \(\$slots\['header-actions'\] \|\| \$scopedSlots\['header-actions'\]\)"[^>]*><slot name="header-actions"\s*\/>/)
    expect(editorSource).toContain('<slot name="side-panel" />')
  })
})
