/**
 * 代码语言选择器（requirements/04 §2.2）。
 *
 * 这里守的四条都是**错了不报错、只是悄悄和真机不一致**的事：
 *   1. 71 项**顺序照抄**，三处刻意插位不能按 locale 重排（`C#→C++→C` 等）；
 *   2. **存 id、显示 label** 的双轨 —— 存显示名会让 `C#` 代码块 round-trip 丢语言、
 *      且导出成非法 fence；
 *   3. 选完**立即关闭且只改 `attrs.language`**，正文一个字节都不动；
 *   4. 触发走模块信号 + `editor` 身份比对，同页多实例不串台。
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import codeLangMixin from '../../src/components/lark-doc/editor/codeLangMixin'
import {
  CODE_LANGUAGES,
  CODE_LANGUAGE_BY_ID,
  CODE_LANG_PICKER_SIZE,
  CODE_LANG_PICKER_TOP_OFFSET,
  codeLanguageId,
  codeLanguageLabel,
  codeLangPickerStyle,
  filterCodeLanguages,
} from '../../src/components/lark-doc/editor/codeLanguages'
import { requestCodeLangPicker, subscribeCodeLangPicker } from '../../src/components/lark-doc/editor/codeLangSignal'

/** 列表里的下标，用来断言「顺序」而不是断言内容。 */
function idAt(id) {
  return CODE_LANGUAGES.findIndex((item) => item.id === id)
}

function mixinCtx(extra = {}) {
  const emitted = []
  const ctx = {
    ...codeLangMixin.data(),
    editor: null,
    writable: () => true,
    emitted,
    $emit: (name, payload) => { emitted.push({ name, payload }) },
    ...extra,
  }
  // ⚠️ 方法要 bind 到 ctx：`mounted` 里 `subscribeCodeLangPicker(this.onCodeLangRequest)`
  // 交出去的是**裸函数引用**，Vue 在真实组件上会自动绑 this，替身不绑的话信号回调里
  // `this` 是 undefined，`payload.editor !== this.editor` 直接抛 —— 而且被 signal 的
  // try/catch 吞成一句 warn，表现为「点了没反应」。
  Object.keys(codeLangMixin.methods).forEach((key) => {
    if (typeof ctx[key] !== 'function') ctx[key] = codeLangMixin.methods[key].bind(ctx)
  })
  Object.keys(codeLangMixin.computed).forEach((key) => {
    Object.defineProperty(ctx, key, {
      configurable: true,
      enumerable: true,
      get: () => codeLangMixin.computed[key].call(ctx),
    })
  })
  return ctx
}

/** 最小 tiptap 替身：只提供 `pickCodeLanguage` 真正碰到的三个东西。 */
function fakeEditor(node) {
  const dispatched = []
  const tr = {
    doc: { nodeAt: () => node },
    setNodeMarkup(pos, type, attrs) { this.markup = { pos, type, attrs } },
  }
  return {
    dispatched,
    tr,
    state: { tr },
    view: { dispatch: (transaction) => { dispatched.push(transaction) } },
  }
}

beforeEach(() => {
  globalThis.window = { innerWidth: 1440, innerHeight: 900 }
})

afterEach(() => {
  delete globalThis.window
})

describe('代码语言清单 · 顺序与双轨', () => {
  it('71 项，id 与 label 都唯一', () => {
    expect(CODE_LANGUAGES).toHaveLength(71)
    expect(new Set(CODE_LANGUAGES.map((item) => item.id)).size).toBe(71)
    expect(new Set(CODE_LANGUAGES.map((item) => item.label)).size).toBe(71)
  })

  it('三处刻意插位：C# → C++ → C（按 locale 重排就会变成 C → C# → C++）', () => {
    const csharp = idAt('csharp')
    expect(CODE_LANGUAGES[csharp].label).toBe('C#')
    expect(CODE_LANGUAGES[csharp + 1].id).toBe('cpp')
    expect(CODE_LANGUAGES[csharp + 2].id).toBe('c')
  })

  it('Go → GraphQL → Groovy → HTML → HTMLBars → HTTP → Haskell 连续七项', () => {
    const start = idAt('go')
    expect(CODE_LANGUAGES.slice(start, start + 7).map((item) => item.id))
      .toEqual(['go', 'graphql', 'groovy', 'html', 'htmlbars', 'http', 'haskell'])
  })

  it('SQL → Scala → Scheme → Shell 连续四项', () => {
    const start = idAt('sql')
    expect(CODE_LANGUAGES.slice(start, start + 4).map((item) => item.id))
      .toEqual(['sql', 'scala', 'scheme', 'shell'])
  })

  it('id 是落库值：全部过 core/blocks/code-block 的 `/^[\\w+-]{0,32}$/`', () => {
    for (const item of CODE_LANGUAGES) {
      expect(/^[\w+-]{0,32}$/.test(item.id)).toBe(true)
    }
    // 反过来：label 里确实有 id 装不下的字符（`C#` / `C++` / `Plain Text`），
    // 这正是「存显示名会丢语言」的根因，双轨不能倒退回单轨。
    expect(CODE_LANGUAGES.filter((item) => /[^\w+-]/.test(item.label)).length).toBeGreaterThan(0)
  })

  it('id ↔ label 往返无损（未知 id 原样返回，历史文档可能有自定义值）', () => {
    for (const item of CODE_LANGUAGES) {
      expect(codeLanguageLabel(item.id)).toBe(item.label)
      expect(codeLanguageId(item.label)).toBe(item.id)
    }
    expect(codeLanguageLabel('not-a-lang')).toBe('not-a-lang')
    expect(codeLanguageId('not-a-label')).toBeNull()
  })

  it('`CODE_LANGUAGE_BY_ID` 与列表同源，热路径反查 O(1)', () => {
    expect(CODE_LANGUAGE_BY_ID.csharp.label).toBe('C#')
    expect(CODE_LANGUAGE_BY_ID['not-a-lang']).toBeUndefined()
  })

  it('grammar 为 null 的语言仍在列表里（缺语法 ≠ 不可选，共 7 项）', () => {
    const missing = CODE_LANGUAGES.filter((item) => item.grammar === null).map((item) => item.id)
    expect(missing).toEqual(['plaintext', 'abap', 'apex', 'cobol', 'graphql', 'solidity', 'toml'])
    // 缺语法的项依然能反查到显示名，UI 上就是「能选、但不高亮」。
    expect(codeLanguageLabel('graphql')).toBe('GraphQL')
  })

  it('html / shell 走 highlight.js 别名（xml / bash）', () => {
    expect(CODE_LANGUAGE_BY_ID.html.grammar).toBe('xml')
    expect(CODE_LANGUAGE_BY_ID.shell.grammar).toBe('bash')
  })
})

describe('代码语言 · 搜索过滤', () => {
  it('空串 / 非字符串输入返回全量，不返回空数组', () => {
    expect(filterCodeLanguages('')).toHaveLength(71)
    expect(filterCodeLanguages(null)).toHaveLength(71)
    expect(filterCodeLanguages(undefined)).toHaveLength(71)
    expect(filterCodeLanguages(0)).toHaveLength(71)
  })

  it('子串 + 大小写不敏感', () => {
    expect(filterCodeLanguages('java').map((item) => item.id)).toEqual(['java', 'javascript'])
    expect(filterCodeLanguages('JAVA').map((item) => item.id)).toEqual(['java', 'javascript'])
    expect(filterCodeLanguages('c#').map((item) => item.id)).toEqual(['csharp'])
  })

  it('保持原始顺序，不按匹配度重排（输入 `p` 时 Python 不跳位）', () => {
    const all = CODE_LANGUAGES.map((item) => item.id)
    const hit = filterCodeLanguages('p').map((item) => item.id)
    expect(hit).toEqual(all.filter((id) => CODE_LANGUAGE_BY_ID[id].label.toLowerCase().includes('p')))
    // 严格的「是原序的子序列」检查
    let cursor = -1
    for (const id of hit) {
      const next = all.indexOf(id, cursor + 1)
      expect(next).toBeGreaterThan(cursor)
      cursor = next
    }
  })

  it('不 trim：中间空格要参与匹配，外侧空格不该被吃掉', () => {
    expect(filterCodeLanguages('in t').map((item) => item.id)).toEqual(['plaintext'])
    // 若做了 trim，`' c'` 会退化成 `'c'`（命中十几项）；这里必须是 0 项。
    expect(filterCodeLanguages(' c')).toHaveLength(0)
    expect(filterCodeLanguages('c ')).toHaveLength(0)
  })

  it('无结果返回空数组（表现是列表区空、无空态文案）', () => {
    expect(filterCodeLanguages('zzzz')).toEqual([])
  })
})

describe('代码语言 · 浮层定位', () => {
  it('尺寸 219×317（旧记 219×771 已作废），顶 = 锚点底 + 3', () => {
    expect(CODE_LANG_PICKER_SIZE).toEqual({ width: 219, height: 317 })
    expect(CODE_LANG_PICKER_TOP_OFFSET).toBe(3)
    const style = codeLangPickerStyle({ left: 1148, top: 200, right: 1218, bottom: 230 }, CODE_LANG_PICKER_SIZE, { width: 1440, height: 900 })
    expect(style.left).toBe(1148)
    expect(style.top).toBe(233)
  })

  it('下方放不下时翻到按钮上方，且不越过视口顶 8px', () => {
    const style = codeLangPickerStyle({ left: 100, top: 800, right: 200, bottom: 860 }, CODE_LANG_PICKER_SIZE, { width: 1440, height: 900 })
    expect(style.top).toBe(800 - 317 - 3)
    const clamped = codeLangPickerStyle({ left: 100, top: 4, right: 200, bottom: 860 }, CODE_LANG_PICKER_SIZE, { width: 1440, height: 300 })
    expect(clamped.top).toBe(8)
  })

  it('左右夹 8px（窄屏也开得出来）', () => {
    const style = codeLangPickerStyle({ left: 1430, top: 10, right: 1500, bottom: 40 }, CODE_LANG_PICKER_SIZE, { width: 1440, height: 900 })
    expect(style.left).toBe(1440 - 219 - 8)
    expect(codeLangPickerStyle({ left: -50, top: 10, right: 0, bottom: 40 }, CODE_LANG_PICKER_SIZE, { width: 1440, height: 900 }).left).toBe(8)
  })

  it('缺锚点 / 缺视口都返回原点，不抛', () => {
    expect(codeLangPickerStyle(null)).toEqual({ left: 0, top: 0 })
    // 没有视口宽度时 `max(8, 0-219-8)` 退化成 8，left 同样被夹到 8 —— 宁可靠左也不飞出屏。
    expect(codeLangPickerStyle({ left: 10, top: 10, right: 20, bottom: 40 })).toEqual({ left: 8, top: 43 })
  })
})

describe('代码语言 · 模块信号', () => {
  it('订阅 → 广播 → 退订，退订后不再收到', () => {
    const got = []
    const off = subscribeCodeLangPicker((payload) => got.push(payload))
    requestCodeLangPicker({ editor: 'a', pos: 1 })
    off()
    off() // 幂等：重复退订不该把别人的订阅摘掉
    requestCodeLangPicker({ editor: 'b', pos: 2 })
    expect(got).toEqual([{ editor: 'a', pos: 1 }])
  })

  it('订阅者全量保留：多实例场景每个都要收到，各自按 editor 过滤', () => {
    const a = []
    const b = []
    const offA = subscribeCodeLangPicker((payload) => a.push(payload))
    const offB = subscribeCodeLangPicker((payload) => b.push(payload))
    requestCodeLangPicker({ pos: 9 })
    expect(a).toHaveLength(1)
    expect(b).toHaveLength(1)
    offA()
    offB()
  })

  it('非函数入参返回空退订器，且不会污染订阅表', () => {
    const off = subscribeCodeLangPicker(null)
    expect(typeof off).toBe('function')
    off()
    const got = []
    const real = subscribeCodeLangPicker((payload) => got.push(payload))
    requestCodeLangPicker({ pos: 1 })
    expect(got).toHaveLength(1)
    real()
  })

  it('某个订阅者抛异常不拖垮其它订阅者（浮层请求失败 = 没点开）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const got = []
    const bad = subscribeCodeLangPicker(() => { throw new Error('boom') })
    const good = subscribeCodeLangPicker((payload) => got.push(payload))
    expect(() => requestCodeLangPicker({ pos: 1 })).not.toThrow()
    expect(got).toHaveLength(1)
    expect(warn).toHaveBeenCalled()
    bad()
    good()
    warn.mockRestore()
  })

  it('无订阅者时广播是空操作', () => {
    expect(requestCodeLangPicker({ pos: 1 })).toBeUndefined()
  })
})

describe('代码语言 · mixin 行为', () => {
  it('mounted 订阅、beforeDestroy 退订，成对出现（同页多实例不留悬挂订阅）', () => {
    const ctx = mixinCtx()
    expect(ctx._codeLangOff).toBeNull()
    codeLangMixin.mounted.call(ctx)
    expect(typeof ctx._codeLangOff).toBe('function')
    const got = []
    const spy = subscribeCodeLangPicker((payload) => got.push(payload))
    requestCodeLangPicker({ pos: 1 })
    codeLangMixin.beforeDestroy.call(ctx)
    expect(ctx._codeLangOff).toBeNull()
    spy()
  })

  it('开了之后信号能到达（订阅的是 `onCodeLangRequest` 本身）', () => {
    const editor = fakeEditor(null)
    const ctx = mixinCtx({ editor })
    codeLangMixin.mounted.call(ctx)
    requestCodeLangPicker({ editor, pos: 12, language: 'csharp', rect: { left: 100, top: 200, right: 160, bottom: 230 } })
    expect(ctx.codeLangOpen).toBe(true)
    expect(ctx.codeLangPos).toBe(12)
    expect(ctx.codeLangValue).toBe('C#')
    expect(ctx.emitted).toEqual([{ name: 'code-lang-open', payload: expect.objectContaining({ pos: 12 }) }])
    codeLangMixin.beforeDestroy.call(ctx)
  })

  it('身份闸门：别的编辑器的请求一律不接（同页多实例不串台）', () => {
    const mine = fakeEditor(null)
    const ctx = mixinCtx({ editor: mine })
    ctx.onCodeLangRequest({ editor: fakeEditor(null), pos: 3, language: 'go', rect: { left: 0, top: 0, right: 1, bottom: 1 } })
    expect(ctx.codeLangOpen).toBe(false)
    expect(ctx.emitted).toEqual([])
  })

  it('只读闸门：不可写时不弹（评论态 / 阅读态）', () => {
    const editor = fakeEditor(null)
    const ctx = mixinCtx({ editor, writable: () => false })
    ctx.onCodeLangRequest({ editor, pos: 3, language: 'go', rect: { left: 0, top: 0, right: 1, bottom: 1 } })
    expect(ctx.codeLangOpen).toBe(false)
  })

  it('载荷缺 editor / 空载荷直接忽略', () => {
    const ctx = mixinCtx({ editor: fakeEditor(null) })
    ctx.onCodeLangRequest(null)
    ctx.onCodeLangRequest({})
    ctx.onCodeLangRequest({ editor: undefined, pos: 1 })
    expect(ctx.codeLangOpen).toBe(false)
  })

  it('未知语言显示名原样透出（历史文档的自定义值不该变成空）', () => {
    const editor = fakeEditor(null)
    const ctx = mixinCtx({ editor })
    ctx.onCodeLangRequest({ editor, pos: 1, language: 'my-lang', rect: { left: 0, top: 0, right: 1, bottom: 1 } })
    expect(ctx.codeLangValue).toBe('my-lang')
  })

  it('每次打开都清空搜索词（残留会让人以为列表少了几项）', () => {
    const editor = fakeEditor(null)
    const ctx = mixinCtx({ editor, codeLangQuery: 'java' })
    ctx.onCodeLangRequest({ editor, pos: 1, language: 'go', rect: { left: 0, top: 0, right: 1, bottom: 1 } })
    expect(ctx.codeLangQuery).toBe('')
  })

  it('搜索词一律转字符串，null / undefined 落空串', () => {
    const ctx = mixinCtx()
    ctx.setCodeLangQuery('java')
    expect(ctx.codeLangQuery).toBe('java')
    ctx.setCodeLangQuery(null)
    expect(ctx.codeLangQuery).toBe('')
    ctx.setCodeLangQuery(undefined)
    expect(ctx.codeLangQuery).toBe('')
    ctx.setCodeLangQuery('java')
    expect(ctx.codeLangItems.map((item) => item.id)).toEqual(['java', 'javascript'])
  })

  it('选语言：只改 attrs.language，正文与节点类型一个字节都不动', () => {
    const node = { type: { name: 'codeBlock' }, attrs: { language: 'javascript', wrap: false } }
    const editor = fakeEditor(node)
    const ctx = mixinCtx({ editor, codeLangPos: 42, codeLangOpen: true })
    ctx.pickCodeLanguage('typescript')
    expect(editor.tr.markup).toEqual({ pos: 42, type: undefined, attrs: { language: 'typescript', wrap: false } })
    expect(editor.dispatched).toEqual([editor.tr])
    expect(ctx.emitted).toEqual([{ name: 'code-lang-change', payload: { pos: 42, language: 'typescript' } }])
    // §2.2 ②：选完立即关闭，没有确认按钮
    expect(ctx.codeLangOpen).toBe(false)
    expect(ctx.codeLangPos).toBeNull()
  })

  it('pos 失效（期间插入/删除）或落点不是 codeBlock：静默放弃，不写到别的块上', () => {
    const paragraph = fakeEditor({ type: { name: 'paragraph' }, attrs: {} })
    const ctxP = mixinCtx({ editor: paragraph, codeLangPos: 7, codeLangOpen: true })
    ctxP.pickCodeLanguage('go')
    expect(paragraph.tr.markup).toBeUndefined()
    expect(paragraph.dispatched).toEqual([])
    expect(ctxP.emitted).toEqual([])

    const missing = fakeEditor(null)
    const ctxM = mixinCtx({ editor: missing, codeLangPos: 7, codeLangOpen: true })
    ctxM.pickCodeLanguage('go')
    expect(missing.dispatched).toEqual([])

    const noPos = mixinCtx({ editor: fakeEditor({ type: { name: 'codeBlock' }, attrs: {} }), codeLangOpen: true })
    noPos.pickCodeLanguage('go')
    expect(noPos.emitted).toEqual([])
  })

  it('关闭幂等：重复关闭只复位一次，不重复抛事件', () => {
    const ctx = mixinCtx({ codeLangOpen: true, codeLangQuery: 'ja', codeLangPos: 5 })
    ctx.closeCodeLangPicker()
    ctx.closeCodeLangPicker()
    expect(ctx.codeLangOpen).toBe(false)
    expect(ctx.codeLangQuery).toBe('')
    expect(ctx.emitted).toEqual([])
  })

  it('Plain Text 就是「无语言」，列表里有且没有独立删除入口', () => {
    expect(CODE_LANGUAGE_BY_ID.plaintext.label).toBe('Plain Text')
    expect(idAt('plaintext')).toBe(0)
    expect(CODE_LANGUAGES.filter((item) => /remove|delete|clear/i.test(item.id))).toHaveLength(0)
  })

  it('命中判定同时认浮层与触发按钮（点按钮不该被当点外面）', () => {
    const ctx = mixinCtx()
    const node = (sel) => ({ closest: (s) => (String(s).split(',').some((part) => part.trim() === sel) ? {} : null) })
    expect(ctx.codeLangContains(node('.lark-doc-code-lang'))).toBe(true)
    expect(ctx.codeLangContains(node('.lark-doc-code-lang-trigger'))).toBe(true)
    expect(ctx.codeLangContains(node('.other'))).toBe(false)
    expect(ctx.codeLangContains(null)).toBe(false)
  })
})
