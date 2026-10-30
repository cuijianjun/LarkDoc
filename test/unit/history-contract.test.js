import { describe, expect, it } from 'vitest'
import { createLarkDocExtensions } from '../../src/components/lark-doc/extensions'

describe('历史栈契约', () => {
  it('非协同编辑器使用 800ms 分组窗口和 100 步深度', () => {
    const extension = createLarkDocExtensions().find(item => item.name === 'starterKit')
    expect(extension.options.undoRedo).toMatchObject({ newGroupDelay: 800, depth: 100 })
  })

  it('协同编辑器不装本地 UndoRedo，避免远端事务进入本地历史', () => {
    const extension = createLarkDocExtensions({ collab: { extensions: [] } }).find(item => item.name === 'starterKit')
    expect(extension.options.undoRedo).toBe(false)
  })
})
