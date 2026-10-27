/**
 * P7-03 早期水合：`hydrateOutline` 的契约。
 *
 * 这个方法本身只有五行，但它站在「落库快照」和「目录面板」之间，判错就会把用户
 * 送到错误的位置上。三条主张：
 *   1. 只认数组 —— 校验器判伪返回 `null` 时（`?.outline`），绝不能把面板清空；
 *   2. 只搬 `pos` / `level` / `text` —— 快照里的 `blockId` 是给落库记录用的，
 *      目录面板不读它，多带字段只会让 `outlineItems` 的展开/折叠算出界外状态；
 *   3. 空数组返回 `false` —— 调用方据此决定「要不要为这一帧让出渲染」。
 */
import { describe, expect, it } from 'vitest'
import viewModesMixin from '../../src/components/lark-doc/editor/viewModesMixin'

const { hydrateOutline } = viewModesMixin.methods

/** 只为这个方法造一个最小 `this`：真实组件要整棵 Vue 实例，这里不需要。 */
const host = () => ({ outline: [{ pos: 0, level: 1, text: '旧的实测标题' }] })

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
})
