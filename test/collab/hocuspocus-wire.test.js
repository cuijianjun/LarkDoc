// @vitest-environment jsdom
/**
 * 协同验收里的「真线」那一段（09 §5.7.3 末条 / §5.7.4 C1、C4）。
 *
 * 与 `converge.test.js` 的分工：那边把 update 直接在两份 Y.Doc 之间投递，验的是**收敛逻辑**；
 * 这里起一个真的 `@hocuspocus/server` 内存实例（随机端口、`extensions: []`），
 * 客户端走真的 WebSocket，验的是**线能通**：握手、sync、增量、断线重连。
 *
 * 🔴 **服务端不在本仓库**：这里用的是第三方 `@hocuspocus/server`，只是被 e2e 当依赖调起来，
 * 没有一行自有服务端代码。`scripts/check-architecture.js` 有一条断言守着这件事 ——
 * 全仓 `hocuspocus/server` 只能出现在 `test/` 下。
 *
 * 用真端口而不是 mock：`@hocuspocus/provider` 的重连是「关掉 socket 后自己再拨」，
 * mock 掉传输就只剩一个不会断的假连接，C4 会假绿。
 */
import { afterEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { Server } from '@hocuspocus/server'
import { HocuspocusProvider } from '@hocuspocus/provider'
import { createHocuspocusBridge, COLLAB_CONTENT_FIELD } from '../../src/collab/index'

const TIMEOUT = 30000
const servers = []
const providers = []

afterEach(async () => {
  while (providers.length) {
    const provider = providers.pop()
    try { provider.destroy() } catch (error) { /* 已断开 */ }
  }
  while (servers.length) {
    const server = servers.pop()
    try { await server.destroy() } catch (error) { /* 已关闭 */ }
  }
})

/** 起一个内存实例，返回 ws 地址（端口由系统分配，避免并行跑测试时撞端口）。 */
async function startServer(options = {}) {
  const server = new Server({
    port: 0,
    address: '127.0.0.1',
    quiet: true,
    // 只挂鉴权钩子，其余一律用库的默认实现（我们不做自有服务端）。
    ...options,
  })
  await server.listen()
  servers.push(server)
  return { server, url: `ws://127.0.0.1:${server.address.port}` }
}

function connect(url, documentId, doc, extra = {}) {
  const provider = new HocuspocusProvider({ url, name: documentId, document: doc, ...extra })
  providers.push(provider)
  return provider
}

/** 等到所有 provider 都 synced（超时抛错，避免用例挂住整个门禁）。 */
function waitSynced(list, timeout = 8000) {
  return Promise.all(list.map((provider) => new Promise((resolve, reject) => {
    if (provider.synced) return resolve()
    const timer = setTimeout(() => reject(new Error('等待 synced 超时')), timeout)
    provider.on('synced', () => { clearTimeout(timer); resolve() })
  })))
}

/** 等某个条件成立（增量同步不是同步调用，得让事件循环转几圈）。 */
async function until(check, timeout = 5000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeout) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('等待条件超时')
}

describe('真线 C1：两个客户端经 WebSocket 双向同步', () => {
  it('A 写入 → B 收到；B 写入 → A 收到', async () => {
    const { url } = await startServer()
    const docA = new Y.Doc({ gc: false })
    const docB = new Y.Doc({ gc: false })
    const a = connect(url, 'wire/c1', docA)
    const b = connect(url, 'wire/c1', docB)
    await waitSynced([a, b])

    docA.getText('probe').insert(0, '甲乙')
    await until(() => docB.getText('probe').toString() === '甲乙')

    docB.getText('probe').insert(2, '丙丁')
    await until(() => docA.getText('probe').toString() === '甲乙丙丁')
    expect(docA.getText('probe').toString()).toBe(docB.getText('probe').toString())
  }, TIMEOUT)

  it('正文 fragment 名与服务端一致（默认 default，写错就是「连上了但正文空白」）', async () => {
    const { url } = await startServer()
    const docA = new Y.Doc({ gc: false })
    const docB = new Y.Doc({ gc: false })
    const a = connect(url, 'wire/field', docA)
    const b = connect(url, 'wire/field', docB)
    await waitSynced([a, b])

    docA.getXmlFragment(COLLAB_CONTENT_FIELD).insert(0, [new Y.XmlElement('paragraph')])
    await until(() => docB.getXmlFragment(COLLAB_CONTENT_FIELD).length === 1)
    expect(COLLAB_CONTENT_FIELD).toBe('default')
  }, TIMEOUT)
})

describe('真线 C4：断线重连补齐', () => {
  it('B 断开期间 A 继续写，B 重连后无重复无丢失', async () => {
    const { url } = await startServer()
    const docA = new Y.Doc({ gc: false })
    const docB = new Y.Doc({ gc: false })
    const a = connect(url, 'wire/c4', docA)
    const b = connect(url, 'wire/c4', docB)
    await waitSynced([a, b])

    // 断网 = 把 B 的连接彻底收掉（provider 自带的 disconnect() 会自动重拨，
    // 用它验"重连"其实验的是"没断"，C4 会假绿）。docB 保留在内存里，等价于用户闭网。
    b.destroy()
    await until(() => !b.isConnected)

    docA.getText('probe').insert(0, '一')
    docA.getText('probe').insert(1, '二')
    docA.getText('probe').insert(2, '三')
    expect(docB.getText('probe').toString()).toBe('')

    // 重连：新开一条连接到同一 documentId，服务端走 sync 阶段补齐差集。
    const reconnected = connect(url, 'wire/c4', docB)
    await waitSynced([reconnected])
    await until(() => docB.getText('probe').toString() === '一二三')
    expect(docB.getText('probe').toString().split('一').length - 1).toBe(1)
  }, TIMEOUT)
})

describe('createHocuspocusBridge 与真服务端', () => {
  it('连上后 onStatus/onSynced 上报，且能收远端写入', async () => {
    const { url } = await startServer()
    const statuses = []
    let synced = 0
    const bridge = createHocuspocusBridge({
      url,
      documentId: 'wire/bridge',
      onStatus: (status) => statuses.push(status),
      onSynced: () => { synced += 1 },
    })
    providers.push(bridge.provider)

    await until(() => synced > 0)
    expect(statuses).toContain('connected')

    const other = new Y.Doc({ gc: false })
    const peer = connect(url, 'wire/bridge', other)
    await waitSynced([peer])
    other.getXmlFragment(COLLAB_CONTENT_FIELD).insert(0, [new Y.XmlElement('paragraph')])
    await until(() => bridge.ydoc.getXmlFragment(COLLAB_CONTENT_FIELD).length === 1)

    bridge.destroy()
    // destroy 之后不留监听：再往这份 doc 上写不会有人接（也不会抛错）。
    expect(() => bridge.ydoc.getText('probe').insert(0, 'x')).not.toThrow()
    bridge.destroy() // 幂等
  }, TIMEOUT)

  it('鉴权失败走 onError（E_AUTH_FAILED），不静默半连', async () => {
    const { url } = await startServer({
      async onAuthenticate({ token }) {
        if (token !== 'good-token') throw new Error('bad token')
        return { user: { id: 'u1', name: '测试', color: '#1456f0' } }
      },
    })
    const errors = []
    const bridge = createHocuspocusBridge({
      url,
      documentId: 'wire/auth',
      token: 'bad-token',
      onError: (error) => errors.push(error),
    })
    providers.push(bridge.provider)

    await until(() => errors.length > 0)
    expect(errors[0].code).toBe('E_AUTH_FAILED')
    bridge.destroy()
  }, TIMEOUT)
})
