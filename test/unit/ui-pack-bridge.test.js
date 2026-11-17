// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { readFeature, registerFeature } from '../../src/core/features/registry'
import { registerUiApi } from '../../src/features/ui-registry'
import { createDeferredUi } from '../../src/features/element-ui'

/** 合并桥的状态挂在宿主全局上，用完清干净，别串到同 worker 的下一个文件。 */
function resetBridge() {
  delete globalThis.__LARK_DOC_UI_API__
  delete globalThis.__LARK_DOC_UI_READY__
  const map = globalThis.__LARK_DOC_FEATURES__
  if (map) for (const name of ['ui', 'ui.panels', 'ui.ready']) map.delete(name)
}
afterEach(() => { resetBridge(); document.body.innerHTML = '' })

describe('UI 拆包合并桥', () => {
  it('后到的包并进同一张表，先前取得的 ui.ready 句柄自动看得见它', () => {
    const core = registerUiApi('ui', { createBubbleBar: () => 'bubble' })
    const handle = readFeature('ui.ready')
    expect(handle).toBe(core)
    expect(handle.createSearchPanel).toBeUndefined()
    const panels = registerUiApi('ui.panels', { createSearchPanel: () => 'search' })
    // 同一对象而不是拷贝：面板包是 Object.assign 进 A 包建的那张表。
    expect(panels).toBe(core)
    expect(handle.createSearchPanel()).toBe('search')
    expect(handle.createBubbleBar()).toBe('bubble')
  })

  it('ui.ready 只注册一次，重复挂包不会把先到的工厂顶掉', () => {
    const core = registerUiApi('ui', { a: () => 1 })
    registerUiApi('ui.panels', { b: () => 2 })
    const again = registerUiApi('ui', { c: () => 3 })
    expect(again).toBe(core)
    const api = readFeature('ui.ready')
    expect(Object.keys(api).sort()).toEqual(['a', 'b', 'c'])
    // 两个加载槽位都指向同一张表，谁后到都读得到全集。
    expect(readFeature('ui')).toBe(api)
    expect(readFeature('ui.panels')).toBe(api)
  })

  it('本包只认自己下发的工厂：表里没有它就去拉所属包', async () => {
    registerUiApi('ui', { createBubbleBar: () => 'bubble' })
    const host = document.createElement('div')
    document.body.append(host)
    let loads = 0
    const mounted = []
    registerFeature('ui.panels', () => {
      loads += 1
      return Promise.resolve(registerUiApi('ui.panels', {
        createSearchPanel: options => { mounted.push(options.host); return { update() {}, destroy() {} } },
      }))
    })
    const panel = createDeferredUi('createSearchPanel', { host }, undefined, undefined, 'ui.panels')
    panel.update({ open: true })
    // 拿到「半个 api」不该直接 mount：那样只会在 api[name] 上撞 undefined。
    for (let i = 0; i < 8; i += 1) await Promise.resolve()
    expect(loads).toBe(1)
    expect(mounted).toEqual([host])
    // 包已经在表里之后，同名单子同步挂载，不再多拉一次。
    const another = createDeferredUi('createSearchPanel', { host }, undefined, undefined, 'ui.panels')
    another.update({ open: true })
    expect(loads).toBe(1)
    expect(mounted).toHaveLength(2)
    another.destroy(); panel.destroy()
  })
})
