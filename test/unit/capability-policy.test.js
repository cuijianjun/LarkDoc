import { describe, expect, it } from 'vitest'
import { projectCapabilityUi, projectCapabilityUiStates } from '../../src/core/policy/capability'

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
})
