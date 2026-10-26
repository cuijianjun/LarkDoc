/**
 * 协同接入点（P6a / 09 §5.7.1）：`LarkDocEditor` 的 `collab` 通道。
 *
 * 这里守的是三件**容易被改回去**的事，不是实现细节：
 *   1. 没传 `collab` 时，`collabOptions` 必须是 `null`（单机路径零变化）；
 *   2. 协同下**不传 content**（初始正文只播种一次，§5.7.2-3）；
 *   3. `collab` 原样透传给 `createLarkDocExtensions`（否则扩展装不上，连上也不同步）。
 *
 * 断言直接读 SFC 源码 + 直接调 mixin 的 computed：Vue 2 的 `.vue` 在本仓库的单测里
 * 是被 `vitest.config.js` 明令禁止 import 的（core 不得依赖组件），所以两者都绕开。
 */
import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'
import collabMixin from '../../src/components/lark-doc/editor/collabMixin'

const root = path.resolve(__dirname, '../..')
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')
const sfc = read('src/components/lark-doc/LarkDocEditor.vue')

/** 用最小替身跑 mixin 的 computed（不建组件实例，避免把 Vue 拖进 Node 单测）。 */
const optionsOf = (collab) => collabMixin.computed.collabOptions.call({ collab })

describe('P6a · 编辑器侧的协同通道', () => {
  it('没传 collab → null（单机路径与 P5 逐字节一致）', () => {
    expect(optionsOf(null)).toBeNull()
    expect(optionsOf(undefined)).toBeNull()
    expect(optionsOf('nope')).toBeNull()
  })

  it('传了 collab → 保留 extensions，缺 isRemoteTransaction 时降级为 null', () => {
    const extensions = [{ name: 'collaboration' }]
    const full = optionsOf({ extensions, isRemoteTransaction: () => true })
    expect(full.extensions).toBe(extensions)
    expect(typeof full.isRemoteTransaction).toBe('function')
    // 只给 extensions 的宿主：core 侧按「没有远端判定」处理（安全的一侧，行为等同单机补 ID）。
    expect(optionsOf({ extensions }).isRemoteTransaction).toBeNull()
    expect(optionsOf({}).extensions).toEqual([])
  })

  it('协同下不传 content（初始正文只播种一次）', () => {
    expect(sfc).toContain('content: this.collabOptions ? undefined : this.prepareHTML(initialHTML)')
  })

  it('collab 透传给 createLarkDocExtensions', () => {
    expect(sfc).toContain('collab: this.collabOptions || undefined')
  })

  it('mixin 已注册（否则 prop 收不到，宿主传了也白传）', () => {
    expect(sfc).toContain("import collabMixin from './editor/collabMixin'")
    expect(sfc).toContain('collabMixin]')
  })

  it('主入口不导出 collab（协同走 lark-doc/collab 子入口，不装协同的宿主不加字节）', () => {
    const entry = read('src/index.js')
    expect(entry).not.toContain("from './collab")
    expect(entry).not.toContain('createCollabExtensions')
  })

  /**
   * 09 §3.6 的第四个入口（`dist/lark-doc-collab.umd.min.js`）**决定不发**，理由见
   * `docs/guide/collab-server.md`：UMD 协同会自带一份 prosemirror/tiptap，与 element 产物
   * 混用即两个实例（instanceof 失效、ySyncPluginKey 不同对象 → 连上了但不同步）。
   * 这条断言就是那个决定的看门人 —— 有人回来把它加回 exports，先让这里红一次。
   */
  it('不发 UMD 协同产物（只发 ESM 子入口）', () => {
    const pkg = JSON.parse(read('package.json'))
    expect(pkg.exports['./collab']).toBeTruthy()
    const paths = JSON.stringify(pkg.exports)
    expect(paths).not.toMatch(/collab[^"']*umd/i)
    // size 预算只有一条（ESM），没有第二条给 UMD 的
    const collabBudgets = pkg['size-limit'].filter((item) => /collab/i.test(item.path))
    expect(collabBudgets).toHaveLength(1)
    expect(collabBudgets[0].path).toBe('dist/lark-doc-collab.esm.js')
  })
})
