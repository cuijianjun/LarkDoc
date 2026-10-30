/**
 * P6b-05 交互模式（edit / suggest / read）单测 —— Node 环境、无 DOM。
 * 规格出处：requirements/07 §1（三态表）/ §1.1（交叉核对）/ §12.1（修订入口权限）。
 *
 * 三层，照 mode-switch.test.js 的老规矩：
 *  1. 数据层：import `core/blocks/interaction-mode.js`，表驱动锁四源 → 三态的**全分支**
 *     与四个派生谓词；
 *  2. 行为层：import `editor/readingModeMixin.js` + `editor/revisionMixin.js`，用假宿主
 *     直测模式落下去的副作用（editable / 浮层 / 修订按钮置灰）；
 *  3. 规格层：读 `styles/reading.css` / `RevisionPanel.vue` 文本，锁「read 态隐藏哪三层
 *     浮层」「置灰走 --ld-text-disabled」「面板不隐藏」。
 *
 * 🔴 推导顺序一变就要同步改这里 —— 它是「三态口径」的唯一守卫。
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CAPABILITIES, INTERACTION_MODES, INTERACTION_MODE_EDIT, INTERACTION_MODE_FALLBACK,
  INTERACTION_MODE_READ, INTERACTION_MODE_SUGGEST, READ_REASONS,
  canCommentIn, canDecideRevision, canEditContent, canShowEditingChrome,
  deriveInteractionMode, interactionReadReason, isInteractionMode, isReadMode, isSuggestMode,
  normalizeCapabilities,
} from '../../src/core/blocks/interaction-mode'
import readingModeMixin from '../../src/components/lark-doc/editor/readingModeMixin'
import revisionMixin from '../../src/components/lark-doc/editor/revisionMixin'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const readingCss = fs.readFileSync(path.join(root, 'src/styles/reading.css'), 'utf8')
const panelUi = fs.readFileSync(path.join(root, 'src/ui/revision.js'), 'utf8')
const panelMixin = fs.readFileSync(path.join(root, 'src/components/lark-doc/editor/revisionUiMixin.js'), 'utf8')
const editorVue = fs.readFileSync(path.join(root, 'src/components/lark-doc/LarkDocEditor.vue'), 'utf8')
const revisionMixinSrc = fs.readFileSync(path.join(root, 'src/components/lark-doc/editor/revisionMixin.js'), 'utf8')

/** 剥块注释后再找字面 hex —— 与 scripts/check-theme-tokens.js 同口径。 */
function stripBlockComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
}

/**
 * 假宿主：只放 mixin 会读的字段，缺的一律落到「最宽松」的默认值。
 * `_caps` 是要喂给假 Session 的能力位（不进宿主本身）。
 * computed 链（interactionCapabilities → interactionInput → interactionMode）在假宿主上
 * 得手动按依赖顺序铺一遍 —— Vue 的响应式在这里不存在。
 */
function createEd(overrides) {
  const options = overrides || {}
  const capabilities = options._caps || {}
  const ed = {
    readonly: false,
    reading: false,
    slides: false,
    mode: 'edit',
    editor: null,
    $emit() {},
    $nextTick(fn) { fn() },
  }
  Object.keys(options).forEach((key) => {
    if (key !== '_caps') ed[key] = options[key]
  })
  ed.session = { can: (name) => capabilities[name] !== false }
  ed.$data = ed
  Object.assign(ed, readingModeMixin.methods)
  ed.interactionCapabilities = readingModeMixin.computed.interactionCapabilities.call(ed)
  ed.interactionInput = readingModeMixin.computed.interactionInput.call(ed)
  ed.interactionMode = readingModeMixin.computed.interactionMode.call(ed)
  return ed
}

function fakeEditor(editable = true) {
  return {
    isDestroyed: false,
    isEditable: editable,
    setEditable(value) { this.isEditable = value },
    emit() {},
  }
}

describe('数据层 · 常量与判定顺序', () => {
  it('三态枚举只有 edit / suggest / read，顺序即语义顺序', () => {
    expect(INTERACTION_MODES).toEqual(['edit', 'suggest', 'read'])
    expect(INTERACTION_MODE_EDIT).toBe('edit')
    expect(INTERACTION_MODE_SUGGEST).toBe('suggest')
    expect(INTERACTION_MODE_READ).toBe('read')
    expect(INTERACTION_MODE_FALLBACK).toBe('edit')
    for (const mode of INTERACTION_MODES) expect(isInteractionMode(mode)).toBe(true)
    expect(isInteractionMode('readonly')).toBe(false)
    expect(isInteractionMode(undefined)).toBe(false)
  })

  it('read 的四源顺序 = 判定优先级，不是集合', () => {
    expect(READ_REASONS).toEqual(['slides', 'canEdit', 'reading', 'readonly'])
  })

  it('能力位缺省 = 有权（与 DocumentSession.can 同口径：只有显式 false 才算禁用）', () => {
    expect(DEFAULT_CAPABILITIES).toEqual({ canEdit: true, canComment: true })
    expect(normalizeCapabilities(null)).toEqual({ canEdit: true, canComment: true })
    expect(normalizeCapabilities({})).toEqual({ canEdit: true, canComment: true })
    expect(normalizeCapabilities({ canEdit: false })).toEqual({ canEdit: false, canComment: true })
    expect(normalizeCapabilities({ canComment: false })).toEqual({ canEdit: true, canComment: false })
  })

  it('isReadMode / isSuggestMode 只认枚举值', () => {
    expect(isReadMode('read')).toBe(true)
    expect(isReadMode('edit')).toBe(false)
    expect(isSuggestMode('suggest')).toBe(true)
    expect(isSuggestMode(undefined)).toBe(false)
  })
})

describe('数据层 · 四源 → 三态（表驱动全分支）', () => {
  const cases = [
    // —— 基线 ——
    { name: '空输入 → 编辑', input: {}, mode: 'edit' },
    { name: 'mode=edit → 编辑', input: { mode: 'edit' }, mode: 'edit' },
    { name: 'mode=suggest → 修订（可编辑态，不是只读）', input: { mode: 'suggest' }, mode: 'suggest' },
    // —— 四条 read 分支，各命中一次 ——
    { name: 'slides → 阅读（压过用户自己选的模式）', input: { slides: true, mode: 'suggest' }, mode: 'read' },
    { name: '!canEdit → 阅读（协同只读）', input: { capabilities: { canEdit: false } }, mode: 'read' },
    { name: 'reading → 阅读（顶栏下拉 / Ctrl+⌥+V）', input: { reading: true }, mode: 'read' },
    { name: 'readonly → 阅读（宿主开关）', input: { readonly: true }, mode: 'read' },
    // —— 优先级交叉 ——
    { name: '!canEdit 压过 suggest（§12.1：修订也要编辑权限）', input: { capabilities: { canEdit: false }, mode: 'suggest' }, mode: 'read' },
    { name: 'slides 压过 reading', input: { slides: true, reading: true }, mode: 'read' },
    { name: '显式 false 的四源全假 → 编辑', input: { slides: false, reading: false, readonly: false, mode: 'edit' }, mode: 'edit' },
    // —— 评论权不参与模式推导 ——
    { name: 'canComment=false 不把文档推进 read', input: { capabilities: { canComment: false } }, mode: 'edit' },
    { name: 'canComment=false 的 suggest 仍是 suggest', input: { capabilities: { canComment: false }, mode: 'suggest' }, mode: 'suggest' },
    { name: 'canEdit 显式 true + suggest → suggest', input: { capabilities: { canEdit: true }, mode: 'suggest' }, mode: 'suggest' },
  ]

  cases.forEach((item) => {
    it(item.name, () => {
      expect(deriveInteractionMode(item.input)).toBe(item.mode)
    })
  })

  it('裸调（无参）兜底成编辑态', () => {
    expect(deriveInteractionMode()).toBe('edit')
    expect(deriveInteractionMode(null)).toBe('edit')
  })

  it('「用户选了 read 但没传 reading」不归 read —— 调用方得把派生值传进来', () => {
    // 口径上 `reading` 就是 `mode === 'read'` 的派生（viewModesMixin.computed.reading），
    // 这里刻意不再判一次 mode，避免两处真相。
    expect(deriveInteractionMode({ mode: 'read' })).toBe('edit')
    expect(deriveInteractionMode({ mode: 'read', reading: true })).toBe('read')
  })
})

describe('数据层 · interactionReadReason', () => {
  const cases = [
    { input: {}, reason: '' },
    { input: { mode: 'suggest' }, reason: '' },
    { input: { slides: true }, reason: 'slides' },
    { input: { capabilities: { canEdit: false } }, reason: 'canEdit' },
    { input: { reading: true }, reason: 'reading' },
    { input: { readonly: true }, reason: 'readonly' },
    { input: { slides: true, reading: true, readonly: true }, reason: 'slides' },
    { input: { reading: true, readonly: true }, reason: 'reading' },
    { input: { capabilities: { canEdit: false }, reading: true }, reason: 'canEdit' },
  ]

  cases.forEach((item) => {
    it(`${JSON.stringify(item.input)} → "${item.reason}"`, () => {
      expect(interactionReadReason(item.input)).toBe(item.reason)
    })
  })
})

describe('数据层 · 派生谓词（表驱动）', () => {
  const cases = [
    { mode: 'edit', canEdit: true, canComment: true, editable: true, chrome: true, decide: true, comment: true },
    { mode: 'suggest', canEdit: true, canComment: true, editable: true, chrome: true, decide: true, comment: true },
    { mode: 'read', canEdit: true, canComment: true, editable: false, chrome: false, decide: false, comment: true },
    { mode: 'read', canEdit: false, canComment: true, editable: false, chrome: false, decide: false, comment: true },
    { mode: 'read', canEdit: true, canComment: false, editable: false, chrome: false, decide: false, comment: false },
    { mode: 'edit', canEdit: false, canComment: true, editable: true, chrome: true, decide: false, comment: true },
    { mode: 'suggest', canEdit: true, canComment: false, editable: true, chrome: true, decide: true, comment: false },
  ]

  cases.forEach((item) => {
    const caps = { canEdit: item.canEdit, canComment: item.canComment }
    const label = `${item.mode} / canEdit=${item.canEdit} / canComment=${item.canComment}`
    it(label, () => {
      expect(canEditContent(item.mode)).toBe(item.editable)
      expect(canShowEditingChrome(item.mode)).toBe(item.chrome)
      expect(canDecideRevision(item.mode, caps)).toBe(item.decide)
      expect(canCommentIn(item.mode, caps)).toBe(item.comment)
    })
  })

  it('read 态保留评论入口（§1 表三档「可评论」全是 ✅）', () => {
    expect(canCommentIn('read', { canComment: true })).toBe(true)
    expect(canCommentIn('read', null)).toBe(true)
    expect(canCommentIn('read', { canComment: false })).toBe(false)
  })

  it('修订态 editor 必须可编辑，否则一条建议也敲不出来', () => {
    expect(canEditContent('suggest')).toBe(true)
  })
})

describe('行为层 · readingModeMixin', () => {
  it('默认宿主 → edit，浮层可显示', () => {
    const ed = createEd()
    expect(ed.interactionMode).toBe('edit')
    expect(readingModeMixin.computed.isReadMode.call(ed)).toBe(false)
    expect(readingModeMixin.computed.canShowChrome.call(ed)).toBe(true)
    expect(readingModeMixin.computed.canDecideNow.call(ed)).toBe(true)
    expect(readingModeMixin.computed.canCommentNow.call(ed)).toBe(true)
  })

  it('reading=true → read，浮层关、接受拒绝关、评论**留着**', () => {
    const ed = createEd({ reading: true, mode: 'read' })
    expect(ed.interactionMode).toBe('read')
    expect(readingModeMixin.computed.isReadMode.call(ed)).toBe(true)
    expect(readingModeMixin.computed.canShowChrome.call(ed)).toBe(false)
    expect(readingModeMixin.computed.canDecideNow.call(ed)).toBe(false)
    expect(readingModeMixin.computed.canCommentNow.call(ed)).toBe(true)
  })

  it('协同只读（canEdit=false）→ read，评论入口仍在', () => {
    const ed = createEd({ _caps: { canEdit: false } })
    expect(ed.interactionMode).toBe('read')
    expect(readingModeMixin.computed.interactionReason.call(ed)).toBe('canEdit')
    expect(readingModeMixin.computed.canCommentNow.call(ed)).toBe(true)
    expect(readingModeMixin.computed.canDecideNow.call(ed)).toBe(false)
  })

  it('canComment=false 时三态都没有评论入口（§2 能力位表）', () => {
    const ed = createEd({ _caps: { canComment: false } })
    expect(ed.interactionMode).toBe('edit')
    expect(readingModeMixin.computed.canCommentNow.call(ed)).toBe(false)
  })

  it('slides → read，且压过 suggest', () => {
    const ed = createEd({ slides: true, mode: 'suggest' })
    expect(ed.interactionMode).toBe('read')
    expect(readingModeMixin.computed.interactionReason.call(ed)).toBe('slides')
  })

  it('没有 Session 时按「有权」处理（不被误判成只读）', () => {
    const ed = createEd()
    ed.session = null
    expect(ed.interactionMode).toBe('edit')
    expect(readingModeMixin.computed.interactionCapabilities.call(ed)).toBe(DEFAULT_CAPABILITIES)
  })

  it('applyInteractionMode(read)：关 editable、收浮层、清修订点亮', () => {
    const ed = createEd({ reading: true, mode: 'read' })
    ed.editor = fakeEditor(true)
    ed.menuOpen = true
    ed.bubbleVisible = true
    ed.headingOpen = true
    ed.colorPaletteOpen = 'text'
    ed.revisionActiveId = 'rev-1'
    ed.revisionHoverId = 'rev-1'
    ed.closeCommandMenu = () => { ed.commandMenuClosed = true }
    readingModeMixin.methods.applyInteractionMode.call(ed, 'read')
    expect(ed.editor.isEditable).toBe(false)
    expect(ed.commandMenuClosed).toBe(true)
    expect(ed.menuOpen).toBe(false)
    expect(ed.bubbleVisible).toBe(false)
    expect(ed.headingOpen).toBe(false)
    expect(ed.colorPaletteOpen).toBe('')
    expect(ed.revisionActiveId).toBe('')
    expect(ed.revisionHoverId).toBe('')
  })

  it('applyInteractionMode(suggest)：editable 保持 true（否则敲不出建议）', () => {
    const ed = createEd({ mode: 'suggest' })
    ed.editor = fakeEditor(true)
    readingModeMixin.methods.applyInteractionMode.call(ed, 'suggest')
    expect(ed.editor.isEditable).toBe(true)
  })

  it('applyInteractionMode 幂等：editable 已对就不重复 setEditable', () => {
    const ed = createEd()
    ed.editor = fakeEditor(true)
    let calls = 0
    const original = ed.editor.setEditable
    ed.editor.setEditable = function setEditable(value) { calls += 1; original.call(this, value) }
    readingModeMixin.methods.applyInteractionMode.call(ed, 'edit')
    expect(calls).toBe(0)
    readingModeMixin.methods.applyInteractionMode.call(ed, 'read')
    expect(calls).toBe(1)
    expect(ed.editor.isEditable).toBe(false)
  })

  it('writable()：read 态一律 false；suggest 态可写（改动落建议）', () => {
    const editable = createEd({ mode: 'suggest', editor: fakeEditor(true) })
    expect(readingModeMixin.computed.interactionMode.call(editable)).toBe('suggest')
    expect(readingModeMixin.methods.writable.call(editable)).toBe(true)

    const read = createEd({ reading: true, mode: 'read', editor: fakeEditor(true) })
    expect(readingModeMixin.methods.writable.call(read)).toBe(false)

    const destroyed = createEd({ editor: { isDestroyed: true, isEditable: true } })
    expect(readingModeMixin.methods.writable.call(destroyed)).toBe(false)
  })

  it('watch.interactionMode：变了才落副作用，并沿用 mode-change 事件负载形状', () => {
    const ed = createEd()
    const events = []
    ed.$emit = (name, payload) => events.push([name, payload])
    ed.applyInteractionMode = () => { ed.applied = (ed.applied || 0) + 1 }
    readingModeMixin.watch.interactionMode.call(ed, 'edit', 'edit')
    expect(ed.applied).toBeUndefined()
    readingModeMixin.watch.interactionMode.call(ed, 'read', 'edit')
    expect(ed.applied).toBe(1)
    expect(events).toEqual([['mode-change', { readonly: true, mode: 'read' }]])
  })

  it('closeEditingOverlays 只写宿主声明过的 data 位', () => {
    const ed = createEd()
    ed.bubbleVisible = true
    readingModeMixin.methods.closeEditingOverlays.call(ed)
    expect(ed.bubbleVisible).toBe(false)
    expect('menuOpen' in ed).toBe(false)
  })
})

describe('行为层 · revisionMixin 的 read 态分支', () => {
  it('revisionReadonly 由 interactionMode 派生；mixin 缺席时为 false', () => {
    expect(revisionMixin.computed.revisionReadonly.call({ interactionMode: 'read' })).toBe(true)
    expect(revisionMixin.computed.revisionReadonly.call({ interactionMode: 'edit' })).toBe(false)
    expect(revisionMixin.computed.revisionReadonly.call({ interactionMode: 'suggest' })).toBe(false)
    expect(revisionMixin.computed.revisionReadonly.call({})).toBe(false)
  })

  it('read 态：接受 / 拒绝置灰（不隐藏），跳转与复制链接照旧可用', () => {
    const ed = { interactionMode: 'read', editor: null, revisionReadonly: true }
    expect(revisionMixin.methods.revisionButtonDisabled.call(ed, 'accept', 'rev-1')).toBe(true)
    expect(revisionMixin.methods.revisionButtonDisabled.call(ed, 'reject', 'rev-1')).toBe(true)
    expect(revisionMixin.methods.revisionButtonDisabled.call(ed, 'copyAnchor', 'rev-1')).toBe(false)
  })

  it('非 read 态：接受 / 拒绝不置灰（置灰只由首尾跳转那条规则管）', () => {
    const ed = { interactionMode: 'edit', editor: null, revisionReadonly: false }
    expect(revisionMixin.methods.revisionButtonDisabled.call(ed, 'accept', 'rev-1')).toBe(false)
    expect(revisionMixin.methods.revisionButtonDisabled.call(ed, 'reject', 'rev-1')).toBe(false)
  })

  it('read 态不展开输入区（hover 也不给一个提交不了的框）', () => {
    const ed = { interactionMode: 'read', revisionReadonly: true, revisionHoverId: '' }
    revisionMixin.methods.enterRevisionPanel.call(ed, 'rev-1')
    expect(ed.revisionHoverId).toBe('')

    const editable = { interactionMode: 'edit', revisionReadonly: false, revisionHoverId: '' }
    revisionMixin.methods.enterRevisionPanel.call(editable, 'rev-1')
    expect(editable.revisionHoverId).toBe('rev-1')
  })

  it('read 态下 decideRevision 直接短路（不看 writable 也不派事务）', () => {
    let dispatched = 0
    const ed = {
      interactionMode: 'read',
      revisionReadonly: true,
      editor: { view: { dispatch() { dispatched += 1 } } },
      writable: () => true,
    }
    revisionMixin.methods.decideRevision.call(ed, 'rev-1', 'accept')
    expect(dispatched).toBe(0)
  })

  it('syncRevisionTracking 跟着派生结果走：协同只读时 suggest 也要关掉', () => {
    const storage = { active: true }
    const makeEd = (interactionMode) => ({
      editor: { storage: { larkDocRevisionTracker: storage } },
      mode: 'suggest',
      interactionMode,
      revisionActiveId: '',
      revisionHoverId: '',
      updateRevisionPanels() {},
    })
    revisionMixin.methods.syncRevisionTracking.call(makeEd('read'))
    expect(storage.active).toBe(false)
    revisionMixin.methods.syncRevisionTracking.call(makeEd('suggest'))
    expect(storage.active).toBe(true)
  })
})

describe('规格层 · reading.css / 面板 / 接线点', () => {
  it('read 态卸载三层编辑浮层（§1 表：气泡条 / 块手柄 / 斜杠菜单）', () => {
    expect(readingCss).toContain('.lark-doc.lark-doc-reading .lark-doc-block-handle')
    expect(readingCss).toContain('.lark-doc.lark-doc-reading .lark-doc-bubble')
    expect(readingCss).toContain('.lark-doc.lark-doc-reading .lark-doc-command-menu')
    expect(readingCss).toContain('display: none !important;')
  })

  it('read 态保留选中复制，只藏光标', () => {
    expect(readingCss).toContain('user-select: text')
    expect(readingCss).toContain('caret-color: transparent')
  })

  it('置灰走 --ld-text-disabled（#BBBFC4），且必须带 is-reject / is-accept 抬特异性', () => {
    expect(readingCss).toContain('var(--ld-text-disabled)')
    expect(readingCss).toContain('.lark-doc .lark-doc-revision-btn.is-reject:disabled')
    expect(readingCss).toContain('.lark-doc .lark-doc-revision-btn.is-accept:disabled')
    expect(readingCss).toContain('cursor: not-allowed;')
  })

  it('css 里没有字面 hex（check-theme-tokens 同口径，注释不算）', () => {
    expect(stripBlockComments(readingCss)).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })

  it('面板只读展示：不隐藏，只加 is-readonly + 关输入区', () => {
    expect(panelUi).toContain("state.readonly ? ' is-readonly' : ''")
    expect(panelUi).toContain('item.active && !state.readonly')
    expect(panelMixin).toContain('this.revisionButtonDisabled(button.id, item.revisionId)')
    expect(panelMixin).toContain('items: this.revisionPanels.map')
  })

  it('既有四条负结论没被改坏（无 title / tooltip / more-btn / 已解决）', () => {
    expect(panelUi).not.toContain('title=')
    expect(panelUi).not.toContain('data-tooltip=')
    expect(panelUi).not.toContain('more-btn')
    expect(panelUi).not.toContain('resolved')
  })

  it('revisionMixin 读 interactionMode，不自己拼 ||', () => {
    expect(revisionMixinSrc).toContain("this.interactionMode === 'read'")
    expect(revisionMixinSrc).not.toContain("this.mode === 'suggest' && ")
  })

  it('根 class 仍由 effectiveReadonly 挂 lark-doc-reading（reading.css 的作用域依赖它）', () => {
    expect(editorVue).toContain("'lark-doc-reading': effectiveReadonly")
  })
})
