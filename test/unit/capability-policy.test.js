import { describe, expect, it } from 'vitest'
import { asyncBlockActionCapability, projectCapabilityUi, projectCapabilityUiStates } from '../../src/core/policy/capability'
import commentsMixin from '../../src/components/lark-doc/editor/commentsMixin'
import exportMixin from '../../src/components/lark-doc/editor/exportMixin'
import versioningMixin, { versionCapabilityGate } from '../../src/components/lark-doc/editor/versioningMixin'

const session = (capabilities = {}) => ({
  can: (key) => capabilities[key] !== false,
})

describe('异步块 capability UI policy', () => {
  it('阅读权限撤销后，评论、导出和版本操作同步拒绝', () => {
    const denied = { ...session({ canView: false }), getProvider: () => ({}) }
    expect(projectCapabilityUi(denied, 'canComment').allowed).toBe(false)
    expect(commentsMixin.methods.commentCan.call({ session: denied }, 'canComment')).toBe(false)
    expect(exportMixin.computed.exportCanExport.call({ session: denied })).toBe(false)
    expect(versionCapabilityGate(denied, 'canRestoreVersion').allowed).toBe(false)
  })

  it('未撤销阅读权限时保留独立评论权限和纯 demo 行为', () => {
    expect(commentsMixin.methods.commentCan.call({ session: session({ canEdit: false }) }, 'canComment')).toBe(true)
    expect(exportMixin.computed.exportCanExport.call({ session: null })).toBe(true)
    expect(versionCapabilityGate(null, 'canRestoreVersion').allowed).toBe(false)
  })

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
    expect(state).toMatchObject({ allowed: true, mounted: true, visible: true, disabled: false, rejected: false, treatment: 'allow' })
  })

  it('统一投影显式区分 visible、disabled、read-only 和 rejected', () => {
    const gray = projectCapabilityUi(session({ canComment: false }), 'canComment')
    expect(gray).toMatchObject({ visible: true, mounted: true, disabled: true, readOnly: false, rejected: true, gray: true })
    const downgrade = projectCapabilityUi(session({ canManagePermission: false }), 'canManagePermission')
    expect(downgrade).toMatchObject({ visible: true, mounted: true, disabled: false, readOnly: true, rejected: true, downgraded: true })
    const hidden = projectCapabilityUi(session({ canView: false }), 'canView')
    expect(hidden).toMatchObject({ visible: false, mounted: false, hidden: false, disabled: false, readOnly: true, rejected: true })
  })

  it('评论、版本、导出 mixin 暴露同一套视觉投影', () => {
    const denied = session({ canComment: false, canCreateVersion: false, canRestoreVersion: false, canExport: false })
    expect(commentsMixin.methods.commentCapabilityState.call({ session: denied })).toMatchObject({ visible: true, disabled: true, rejected: true })
    expect(exportMixin.computed.exportCapabilityState.call({ session: denied })).toMatchObject({ visible: true, disabled: true, rejected: true })
    expect(versioningMixin.computed.versionCreateCapabilityState.call({ session: denied })).toMatchObject({ visible: true, disabled: true, rejected: true })
    expect(versioningMixin.computed.versionRestoreCapabilityState.call({ session: denied })).toMatchObject({ visible: true, disabled: true, rejected: true })
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
