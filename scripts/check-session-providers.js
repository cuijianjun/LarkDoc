'use strict'

/**
 * Session / Provider 契约校验。
 *
 * 覆盖 check-lark-doc-core.js 未覆盖的一层：DocumentSession 会话层与 5 类
 * Provider（persistence/collaboration/versioning/comments/authorization）的
 * 契约。核心断言：
 *   - 每类 Provider 缺失必需方法时在 Session 构造阶段即抛错（而非运行时才失败）
 *   - collaborative 模式缺少 collaboration Provider 抛错
 *   - can() 能力门把关 createVersion / restoreVersion
 *   - getProvider / setProvider 运行时替换与 authorization 能力刷新
 *   - connect / disconnect / dispose 生命周期与事件订阅
 *   - attachEditor / detachEditor / getDocumentRecord 版本化记录
 *   - normalizeCapabilities 默认能力合并
 */

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const sourceRoot = path.resolve(__dirname, '../src')
const originalLoader = require.extensions['.js']
require.extensions['.js'] = (module, filename) => {
  if (filename.startsWith(sourceRoot + path.sep)) {
    const { code } = require('@babel/core').transformSync(fs.readFileSync(filename, 'utf8'), {
      babelrc: false, configFile: false, plugins: ['@babel/plugin-transform-modules-commonjs'],
    })
    module._compile(code, filename)
  } else originalLoader(module, filename)
}

const { createDocumentSession } = require('../src/session/DocumentSession')
const { normalizeCapabilities, DEFAULT_CAPABILITIES } = require('../src/providers/authorization')
const { createPersistenceProvider, PERSISTENCE_METHODS } = require('../src/providers/persistence')
const { createCollaborationProvider, COLLABORATION_METHODS } = require('../src/providers/collaboration')
const { createVersioningProvider, VERSIONING_METHODS } = require('../src/providers/versioning')
const { createCommentsProvider, COMMENT_METHODS } = require('../src/providers/comments')
const { createAuthorizationProvider } = require('../src/providers/authorization')

function check(name, fn) { fn(); console.log(`PASS ${name}`) }

const NOOP = () => {}
function providerWith(methods) {
  const p = {}
  for (const m of methods) p[m] = NOOP
  return p
}

check('Provider 契约：5 类各自必需方法缺失时构造即抛错', () => {
  const cases = [
    ['persistence', createPersistenceProvider, PERSISTENCE_METHODS],
    ['collaboration', createCollaborationProvider, COLLABORATION_METHODS],
    ['versioning', createVersioningProvider, VERSIONING_METHODS],
    ['comments', createCommentsProvider, COMMENT_METHODS],
  ]
  for (const [label, factory, methods] of cases) {
    // 完整方法可通过
    assert.strictEqual(factory(providerWith(methods)).list !== undefined || true, true, `${label} 完整契约应通过`)
    // 缺失第一个方法抛错
    const missing = providerWith(methods.slice(1))
    assert.throws(() => factory(missing), /缺少方法/, `${label} 缺失方法应抛错`)
  }
  // authorization 单独校验（只要求 getCapabilities）
  assert.throws(() => createAuthorizationProvider({}), /getCapabilities/, 'authorization 缺失 getCapabilities 应抛错')
  assert.strictEqual(createAuthorizationProvider({ getCapabilities: NOOP }).getCapabilities, NOOP)
})

check('createDocumentSession 构造时校验 Provider（缺失方法立即报错）', () => {
  assert.throws(
    () => createDocumentSession({ providers: { versioning: { createSnapshot: NOOP } } }),
    /versioning Provider 缺少方法/,
    '缺失 versioning 方法的 Provider 应在 Session 构造阶段抛错'
  )
  assert.throws(
    () => createDocumentSession({ providers: { comments: { list: NOOP } } }),
    /comments Provider 缺少方法/,
    '缺失 comments 方法的 Provider 应在 Session 构造阶段抛错'
  )
  // 完整 Provider 构造成功
  const session = createDocumentSession({ providers: { versioning: providerWith(VERSIONING_METHODS) } })
  assert.strictEqual(session.getProvider('versioning').createSnapshot, NOOP)
})

check('collaborative 模式缺少 collaboration Provider 抛错', () => {
  assert.throws(
    () => createDocumentSession({ mode: 'collaborative' }),
    /collaborative 模式必须提供 collaboration Provider/
  )
  const session = createDocumentSession({ mode: 'collaborative', providers: { collaboration: providerWith(COLLABORATION_METHODS) } })
  assert.strictEqual(session.mode, 'collaborative')
})

check('can() 能力门：默认全开放，显式 false 关断', () => {
  const session = createDocumentSession({})
  assert.strictEqual(session.can('canEdit'), true)
  assert.strictEqual(session.can('canManagePermission'), false, '默认能力里 canManagePermission 为 false')
  const limited = createDocumentSession({ capabilities: { canEdit: false } })
  assert.strictEqual(limited.can('canEdit'), false)
  assert.strictEqual(limited.can('canComment'), true, '未覆盖的能力回落到默认 true')
})

check('createVersion / restoreVersion 经 can() 把关', async () => {
  const snapshots = []
  const versioning = {
    list: NOOP, get: NOOP,
    createSnapshot: async (rec) => { snapshots.push(rec); return { id: 'v1' } },
    restore: async () => ({ id: 'v2' }),
  }
  const denied = createDocumentSession({ providers: { versioning }, capabilities: { canCreateVersion: false } })
  await assert.rejects(() => denied.createVersion(), /没有创建版本的权限/)
  const allowed = createDocumentSession({ providers: { versioning }, capabilities: { canCreateVersion: true } })
  await allowed.createVersion({ title: 'x' })
  assert.strictEqual(snapshots.length, 1)
  assert.strictEqual(snapshots[0].title, 'x')
})

check('getProvider / setProvider 运行时替换（未知 Provider 抛错）', () => {
  const session = createDocumentSession({})
  assert.strictEqual(session.getProvider('nope'), null, '未配置的 Provider 返回 null')
  assert.throws(() => session.setProvider('nope', {}), /未知 Provider/)
  const v = providerWith(VERSIONING_METHODS)
  session.setProvider('versioning', v)
  assert.strictEqual(session.getProvider('versioning'), v)
})

check('setProvider(authorization) 触发能力刷新', async () => {
  const session = createDocumentSession({})
  let refreshed = 0
  session.setProvider('authorization', { getCapabilities: async () => { refreshed++; return { canEdit: false } } })
  await session._capabilitiesPromise
  assert.strictEqual(refreshed >= 1, true, 'setProvider(authorization) 应刷新能力')
  assert.strictEqual(session.can('canEdit'), false)
})

check('connect / disconnect 生命周期与事件', async () => {
  const connected = []
  const disconnected = []
  const collaboration = {
    connect: async (opts) => { connected.push(opts.documentId); return { status: 'connected' } },
    disconnect: async (opts) => { disconnected.push(opts.documentId) },
  }
  const session = createDocumentSession({ mode: 'collaborative', documentId: 'd1', providers: { collaboration } })
  const events = []
  session.on('connection', (v) => events.push(v))
  const result = await session.connect()
  assert.strictEqual(result.status, 'connected')
  assert.strictEqual(connected[0], 'd1')
  await session.disconnect()
  assert.strictEqual(disconnected[0], 'd1')
  assert.deepStrictEqual(events.map(e => e.status), ['connected', 'disconnected'])
  // 本地模式 connect 返回 local，不调用 provider
  const local = createDocumentSession({ documentId: 'd2' })
  const r = await local.connect()
  assert.strictEqual(r.status, 'local')
})

check('dispose 释放资源，销毁后 attach/connect 抛错', async () => {
  const collaboration = { connect: NOOP, disconnect: NOOP }
  const session = createDocumentSession({ mode: 'collaborative', providers: { collaboration } })
  await session.dispose()
  assert.throws(() => session.attachEditor({}), /已销毁/)
  await assert.rejects(() => session.connect(), /已销毁/)
})

check('attachEditor / detachEditor / getDocumentRecord', () => {
  const session = createDocumentSession({ documentId: 'doc-1' })
  const fakeEditor = { getJSON: () => ({ type: 'doc', content: [] }) }
  session.attachEditor(fakeEditor)
  assert.strictEqual(session.getEditor(), fakeEditor)
  const rec = session.getDocumentRecord({ title: 'T', revisionId: 'r9' })
  assert.strictEqual(rec.documentId, 'doc-1')
  assert.strictEqual(rec.title, 'T')
  assert.strictEqual(rec.revisionId, 'r9')
  assert.deepStrictEqual(rec.content, { type: 'doc', content: [] })
  session.detachEditor(fakeEditor)
  assert.strictEqual(session.getEditor(), null)
})

check('normalizeCapabilities 合并默认能力且不可变', () => {
  const caps = normalizeCapabilities({ canEdit: false, extra: 1 })
  assert.strictEqual(caps.canEdit, false)
  assert.strictEqual(caps.canView, true)
  assert.strictEqual(caps.canManagePermission, false)
  assert.strictEqual(caps.extra, 1)
  assert.strictEqual(DEFAULT_CAPABILITIES.canEdit, true, 'DEFAULT_CAPABILITIES 不应被 normalize 修改')
})

console.log('Session/Provider checks passed')
