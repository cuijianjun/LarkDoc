/**
 * P7-03 早期水合：`hydrateOutline` 的契约。
 *
 * 这个方法本身只有五行，但它站在「落库快照」和「目录面板」之间，判错就会把用户
 * 送到错误的位置上。三条主张：
 *   1. 只认数组 —— 校验器判伪返回 `null` 时（`?.outline`），绝不能把面板清空；
 *   2. 只搬 `pos` / `level` / `text` —— 快照里的 `blockId` 是给落库记录用的，
 *      目录面板不读它，多带字段只会让 `outlineItems` 的展开/折叠算出界外状态；
 *   3. 空数组返回 `false` —— 调用方据此决定「要不要为这一帧让出渲染」。
 *
 * 另有一组「水合闸门」用例（`outlinePending`）：水合出来的目录是**占位值**，它的 `pos`
 * 对应的是「正文还没灌进去的编辑器」，点了会把选区丢到文末。闸门必须真的挡住点击，
 * 也必须真的会被 `refreshDocumentState()` 落下 —— 只上不落等于永久禁用目录跳转。
 */
/* global globalThis */
// 上面这行是给 eslint 的（与 `src/core/derive/index.js` 同一处处理）：`globalThis`
// 是 ES2020 标准全局，但本仓库 `.eslintrc` 只开了 `env: { node: true }`，
// 认不出来。这里不改成 `es2020: true` —— 那会连带放宽 ecmaVersion，影响面更大。
import fs from 'fs'
import path from 'path'
import { beforeAll, describe, expect, it } from 'vitest'
import viewModesMixin from '../../src/components/lark-doc/editor/viewModesMixin'

const { hydrateOutline, jumpHeading } = viewModesMixin.methods

const root = path.resolve(__dirname, '../..')
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')

/** 只为这些方法造一个最小 `this`：真实组件要整棵 Vue 实例，这里不需要。 */
const host = () => ({ outline: [{ pos: 0, level: 1, text: '旧的实测标题' }], outlinePending: false })

const snapshotOutline = () => [
  { pos: 0, level: 1, text: '总则', blockId: 'blk-a' },
  { pos: 12, level: 2, text: '细则', blockId: 'blk-c' },
]

describe('P7-03 derived snapshot: early outline hydration', () => {
  it('replaces the measured outline with the persisted one', () => {
    const self = host()
    expect(hydrateOutline.call(self, snapshotOutline())).toBe(true)
    expect(self.outline).toEqual([{ pos: 0, level: 1, text: '总则' }, { pos: 12, level: 2, text: '细则' }])
  })

  it('drops fields the outline panel never reads', () => {
    const self = host()
    hydrateOutline.call(self, snapshotOutline())
    expect(Object.keys(self.outline[0]).sort()).toEqual(['level', 'pos', 'text'])
  })

  it('leaves the panel untouched when the snapshot was rejected', () => {
    // `validateDerivedSnapshot(...)?.outline` 在判伪时就是 undefined / null。
    for (const rejected of [null, undefined, {}, 'outline', 0, false]) {
      const self = host()
      expect(hydrateOutline.call(self, rejected)).toBe(false)
      expect(self.outline).toEqual([{ pos: 0, level: 1, text: '旧的实测标题' }])
    }
  })

  it('treats an empty snapshot as nothing to hydrate', () => {
    const self = host()
    expect(hydrateOutline.call(self, [])).toBe(false)
    expect(self.outline).toEqual([{ pos: 0, level: 1, text: '旧的实测标题' }])
  })

  it('does not alias the persisted array', () => {
    const self = host()
    const source = snapshotOutline()
    hydrateOutline.call(self, source)
    source[0].text = '被改掉的'
    expect(self.outline[0].text).toBe('总则')
  })

  it('raises the pending gate — a hydrated outline is a placeholder, not a map', () => {
    const self = host()
    expect(self.outlinePending).toBe(false)
    hydrateOutline.call(self, snapshotOutline())
    expect(self.outlinePending).toBe(true)
  })

  it('leaves the gate down when nothing was hydrated', () => {
    for (const rejected of [null, undefined, [], {}, 0]) {
      const self = host()
      hydrateOutline.call(self, rejected)
      expect(self.outlinePending).toBe(false)
    }
  })
})

/**
 * 闸门的下游：`jumpHeading` 在水合期必须一步不动。
 *
 * 这组用例存在的理由：闸门只是个布尔，写漏了不会报错，只会让用户在「目录已经显示、
 * 正文还没灌进去」的那几百毫秒里点出一个落在文末的选区。
 */
describe('P7-03 derived snapshot: the pending gate blocks navigation', () => {
  /**
   * 最小 editor 替身。`jumpHeading` 往下走会碰 `node instanceof Element`
   * （node 环境没有这个全局），所以这里补一个哑实现 —— 只在本文件生效，
   * vitest 每个测试文件是独立环境，不会外溢到别的用例。
   */
  const fakeEditor = (size = 100) => {
    const calls = []
    return {
      calls,
      state: { doc: { content: { size } } },
      storage: { larkDoc: { folded: new Set() } },
      commands: {
        setTextSelection: (pos) => calls.push(['setTextSelection', pos]),
        toggleLarkDocFold: (pos) => calls.push(['toggleLarkDocFold', pos]),
      },
      view: {
        nodeDOM: () => null,
        domAtPos: () => ({ node: { parentElement: { scrollIntoView: () => calls.push(['scrollIntoView']) } } }),
      },
    }
  }

  beforeAll(() => { if (!('Element' in globalThis)) globalThis.Element = class Element {} })

  it('does nothing while the outline is still a hydrated placeholder', () => {
    const self = host()
    const editor = fakeEditor()
    self.editor = editor
    self.outlinePending = true
    jumpHeading.call(self, 12)
    expect(editor.calls).toEqual([])
    expect(self.activeHeading).toBeUndefined()
  })

  it('ignores out-of-range positions (the doc does not have that heading yet)', () => {
    const self = host()
    const editor = fakeEditor(40)
    self.editor = editor
    jumpHeading.call(self, 40)
    jumpHeading.call(self, -1)
    jumpHeading.call(self, Number.NaN)
    expect(editor.calls).toEqual([])
  })

  it('navigates once the gate is down — the guard must not over-block', () => {
    const self = host()
    const editor = fakeEditor()
    self.editor = editor
    jumpHeading.call(self, 12)
    expect(editor.calls).toEqual([['setTextSelection', 13], ['scrollIntoView']])
    expect(self.activeHeading).toBe(12)
  })
})

/**
 * 闸门的两侧接线（`.vue` 在本仓库单测里禁止 import，只能读源码文本）。
 *
 * 「置 true」在 mixin 里、「置 false」在主组件里，中间隔着一个文件 ——
 * 任一侧漏掉都不会报错，只会让目录跳转要么一直可跳（原缺陷）、要么一直不可跳。
 */
describe('P7-03 derived snapshot: gate wiring on both sides', () => {
  it('refreshDocumentState() lowers the gate when the measured outline lands', () => {
    const sfc = read('src/components/lark-doc/LarkDocEditor.vue')
    const body = sfc.slice(sfc.indexOf('refreshDocumentState()'))
    const clearAt = body.indexOf('outlinePending = false')
    const outlineAt = body.indexOf('this.outline = collectOutline(')
    expect(clearAt).toBeGreaterThan(-1)
    expect(outlineAt).toBeGreaterThan(clearAt)
  })

  it('OutlinePanel disables the jump button while the gate is up', () => {
    const panel = read('src/components/lark-doc/editor/OutlinePanel.vue')
    expect(panel).toContain(':disabled="ed.outlinePending"')
    expect(panel).toContain('@click="ed.jumpHeading(item.pos)"')
  })
})
