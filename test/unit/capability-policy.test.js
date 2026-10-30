import { describe, expect, it } from 'vitest'
import { asyncBlockActionCapability, projectCapabilityUi, projectCapabilityUiStates } from '../../src/core/policy/capability'

const session = (capabilities = {}) => ({
  can: (key) => capabilities[key] !== false,
})

describe('异步块 capability UI policy', () => {
  it('状态权限与 session 权限取交集，并保持 visible/gray/downgrade 语义', () => {
    const states = projectCapabilityUiStates(session({ canExport: false }), 'failed')
    expect(states.canView).toMatchObject({ allowed: true, treatment: 'allow', mounted: true })
    expect(states.canEdit).toMatchObject({ allowed: false, treatment: 'gray', mounted: true, gray: true })
    expect(states.canComment).toMatchObject({ allowed: false, treatment: 'gray', mounted: true })
    expect(states.canExport).toMatchObject({ allowed: false, treatment: 'gray', mounted: true })
    expect(states.canManagePermission).toMatchObject({ allowed: false, treatment: 'downgrade', mounted: true, gray: false })
  })

  it('无权限可见但不可读时不替换整个异步块', () => {
    const state = projectCapabilityUi(session(), 'canView', { visible: true, read: false })
    expect(state).toMatchObject({ allowed: true, mounted: true, treatment: 'allow' })
  })

  it('块菜单动作复用 session 与异步状态矩阵', () => {
    expect(asyncBlockActionCapability('duplicate', 'loading')).toMatchObject({ allowed: false, capability: 'edit', state: 'loading', sessionCapability: 'canEdit' })
    expect(asyncBlockActionCapability('delete', 'loading')).toMatchObject({ allowed: true, capability: 'delete' })
    expect(asyncBlockActionCapability('retry', 'failed')).toMatchObject({ allowed: true, capability: 'retry' })
    expect(asyncBlockActionCapability('retry', 'unauthorized')).toMatchObject({ allowed: false, capability: 'retry' })
    expect(asyncBlockActionCapability('delete', 'loading', session({ canEdit: false }))).toMatchObject({ allowed: false, sessionAllowed: false })
    expect(asyncBlockActionCapability('copy', 'empty', session({ canView: false }))).toMatchObject({ allowed: false, sessionAllowed: false })
  })
})
