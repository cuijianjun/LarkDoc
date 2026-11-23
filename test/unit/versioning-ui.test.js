/**
 * P6b-02 历史版本 · UI 层纯函数（`src/components/lark-doc/editor/versioningMixin.js`）。
 *
 * 只测**不碰 Vue** 的那部分：时间格式化、按天分组、diff 投影、错误码 → 降级文案、
 * capability 闸门分支。数据层本身由 `versioning-core.test.js` 覆盖，这里不重复。
 *
 * 为什么这个 mixin 要把逻辑拆成命名导出：
 *   `vitest.config.js` 的 `forbidVueImports` 插件拒载 `/src/` 下的 `.vue`，所以组件没法进
 *   Node 单测。把「算得出结果」的部分做成模块级纯函数导出，UI 才有可测面 —— 组件模板里
 *   剩下的只是把值贴上去。
 *
 * 挂载手法说明：mixin 的 `computed` / `methods` 在 Vue 2 里由运行时绑 `this`；这里没有
 * 运行时，所以用手写的一次性求值器（`computedOf` / `callOf`）把同一个 `vm` 传进去。
 * 这不是真组件，只用来断言**分支选择**，不模拟响应式刷新 —— 需要刷新的场景（列表拉取
 * 后重算游标）都是手工改完 state 再读一次。
 *
 * 时区：`test/bootstrap.js` 固定 `TZ=UTC`，所以下面的日期全部用 `Date.UTC` 构造，
 * 「今天 / 昨天」的判定不会随跑测机器漂移。
 */
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { describe, expect, it, vi } from 'vitest'
import { createVersionPanel } from '../../src/ui/panels'
import { createHttpVersioningProvider } from '../../src/providers/versioning'
import { DocumentSession } from '../../src/session/DocumentSession'
import {
  E_SNAPSHOT_AUTHOR,
  E_SNAPSHOT_JSON_NOT_ALLOWED,
  E_SNAPSHOT_PAYLOAD_MISSING,
  E_VERSION_EVICTED,
  E_VERSION_NOT_FOUND,
  SNAPSHOT_KIND,
  createMemoryVersioningProvider,
} from '../../src/core/versioning/index'
import {
  createVersioningPresentation,
  VERSIONING_DAY_LABELS,
  VERSIONING_ERROR_TEXT,
  currentProjection,
  describeVersionDiff,
  formatVersionClock,
  formatVersionDayLabel,
  formatVersionTime,
  groupVersionsByMonth,
  historyDiffSummary,
  recordMetrics,
  versioningErrorMessage,
} from '../../src/components/lark-doc/editor/versioningPresentation'
import versioningMixin, { VERSIONING_CURSOR_LABEL, versionCapabilityGate } from '../../src/components/lark-doc/editor/versioningMixin'

/** 一个月度组里每个折叠节点的父行 id（`versionGroups` 已是两层：月份 → 折叠组）。 */
const headIds = (month) => (month.groups || []).map((node) => node.head.id)

describe('历史版本窄屏样式覆盖', () => {
  it.each(['layer', 'left', 'right', 'left-header', 'left-content', 'restore', 'pager'])(
    '%s 的窄屏规则与桌面规则使用相同作用域及优先级',
    (part) => {
      const css = readFileSync(new URL('../../src/styles/versioning.css', import.meta.url), 'utf8')
      const dom = new JSDOM(`<style>${css}</style>`)
      try {
        const rules = Array.from(dom.window.document.styleSheets[0].cssRules)
        const media = rules.find(rule => rule.media?.mediaText === '(max-width: 1024px)')
        const selector = `.lark-doc .lark-doc-version-${part}`
        expect(rules.some(rule => rule.selectorText === selector)).toBe(true)
        expect(Array.from(media.cssRules).some(rule => rule.selectorText === selector)).toBe(true)
      } finally {
        dom.window.close()
      }
    },
  )
})

/* ---------------- 脚手架 ---------------- */

it('named versions retain their saved name in the history timeline with a time fallback', () => {
  const name = versioningMixin.methods.versionItemName
  const createdAt = Date.UTC(2026, 10, 15, 6, 0)
  expect(name({ label: '验收版本', createdAt })).toContain('验收版本')
  expect(name({ label: '  ', createdAt })).toBe(formatVersionTime(createdAt))
})

describe('private version presentation boundary', () => {
  it('keeps the factory and preview synchronous with the supplied editor, schema and live policy references', () => {
    const dom = new JSDOM('<div id="preview"></div>')
    const element = dom.window.document.getElementById('preview')
    const content = { type: 'doc', content: [{ type: 'paragraph' }] }, schema = {}, extensions = []
    const destroyed = vi.fn(), constructed = []
    class HostEditor {
      constructor(options) { constructed.push(options); element.textContent = 'readonly preview' }
      destroy() { destroyed() }
    }
    const validate = vi.fn(value => value)
    const configureExtensions = vi.fn(() => extensions)
    const network = vi.fn(settings => ({ applyDocument: value => value, allows: src => src === settings.allowed }))
    const presentation = createVersioningPresentation({ Editor: HostEditor, createLarkDocExtensions: configureExtensions,
      validateDocument: validate, createNetworkPolicy: network })
    try {
      expect(presentation.then).toBeUndefined()
      const host = { editor: { schema }, larkDocConfig: { network: { allowed: 'first' } } }
      const cleanup = presentation.methods.mountVersionDocumentPreview.call(host, element, { content })
      expect(typeof cleanup).toBe('function')
      expect(validate).toHaveBeenCalledWith(content, schema)
      expect(constructed).toHaveLength(1)
      expect(constructed[0].content).toBe(content)
      expect(constructed[0].extensions).toBe(extensions)
      expect(constructed[0].editable).toBe(false)
      expect(configureExtensions.mock.calls[0][0].config).toBe(host.larkDocConfig)
      const imageOptions = configureExtensions.mock.calls[0][0].getImageOptions()
      host.larkDocConfig = { network: { allowed: 'second' } }
      expect(imageOptions.canLoad('first')).toBe(false)
      expect(imageOptions.canLoad('second')).toBe(true)
      expect(network.mock.calls.at(-1)[0]).toBe(host.larkDocConfig.network)
      cleanup()
      expect(destroyed).toHaveBeenCalledTimes(1)
      expect(element.childNodes).toHaveLength(0)
    } finally { dom.window.close() }
  })

  it('keeps panel actions synchronous at entry and returns the original delegated promise', async () => {
    const gate = vi.fn(), errorText = vi.fn(), confirmation = vi.fn()
    const presentation = createVersioningPresentation({ versionCapabilityGate: gate, versioningErrorMessage: errorText,
      confirmedVersionResult: confirmation })
    expect(presentation.then).toBeUndefined()
    for (const helper of [gate, errorText, confirmation]) expect(helper).not.toHaveBeenCalled()
    const pending = Promise.resolve({ id: 'selected' }), selectVersion = vi.fn(() => pending)
    const host = { versionIndex: 1, versionTotal: 2, versionList: [{ id: 'first' }, { id: 'second' }], selectVersion,
      versionPrevDisabled: false, versionNextDisabled: false, stepVersion: vi.fn(() => pending) }
    expect(presentation.methods.versionNext.call(host)).toBe(pending)
    expect(host.stepVersion).toHaveBeenCalledExactlyOnceWith(1)
    const result = presentation.methods.stepVersion.call(host, 1)
    expect(host.versionIndex).toBe(2)
    expect(selectVersion).toHaveBeenCalledExactlyOnceWith('second')
    expect(await result).toEqual({ id: 'selected' })
  })

  it('keeps preview failure text inert and returns synchronous cleanup', () => {
    const dom = new JSDOM('<div id="preview"></div>')
    try {
      const element = dom.window.document.getElementById('preview')
      const presentation = createVersioningPresentation({
        validateDocument() { throw new Error('<img src=x onerror=alert(1)>') },
        createNetworkPolicy: () => ({ applyDocument: value => value }),
      })
      const cleanup = presentation.methods.mountVersionDocumentPreview.call({ editor: { schema: {} } }, element, { content: {} })
      expect(typeof cleanup).toBe('function')
      expect(element.textContent).toContain('无法预览此版本：<img src=x onerror=alert(1)>')
      expect(element.querySelector('img')).toBeNull()
      cleanup()
      expect(element.childNodes).toHaveLength(0)
    } finally { dom.window.close() }
  })
})

/** 假二进制：只关心字节数，不关心是不是合法 Yjs update。 */
function bytes(length) {
  return new Uint8Array(length).fill(7)
}

/** 一份合法快照的写路径入参。 */
function snapshotInput(overrides) {
  return Object.assign({
    documentId: 'doc-1',
    author: 'u-1',
    kind: SNAPSHOT_KIND.AUTO,
    createdAt: 0,
    payload: bytes(16),
  }, overrides || {})
}

/**
 * 造一份跨「今天 / 昨天 / 前天」的版本列表。
 *
 * 插入顺序刻意打乱：分组函数**不做二次排序**（mixin 里有注释说明为什么不排），
 * 排序的责任在 `provider.list()`，所以这里顺带断言「打乱插入 → 出来仍是新→旧」。
 */
async function listAcrossDays() {
  const provider = createMemoryVersioningProvider()
  const day = 86400000
  const now = Date.UTC(2026, 9, 27, 12, 0, 0)
  await provider.createSnapshot(snapshotInput({ id: 'v1', createdAt: now - day * 2, blockCount: 3 }))
  await provider.createSnapshot(snapshotInput({ id: 'v2', createdAt: now, blockCount: 7 }))
  await provider.createSnapshot(snapshotInput({ id: 'v3', createdAt: now - day, blockCount: 5 }))
  await provider.createSnapshot(snapshotInput({ id: 'v4', createdAt: now - 3600000, blockCount: 9 }))
  return { provider, list: await provider.list({ documentId: 'doc-1' }), now }
}

/** 假 session：`can()` 按表回答，`getProvider()` 只认 versioning。 */
function fakeSession(options) {
  const config = options || {}
  const capabilities = config.capabilities || {}
  const provider = config.provider === undefined
    ? createMemoryVersioningProvider({ author: 'u-1' })
    : config.provider
  return {
    documentId: 'doc-1',
    can(capability) {
      return capabilities[capability] !== false
    },
    getProvider(name) {
      return name === 'versioning' ? provider : null
    },
    createVersion(meta) {
      return provider.createSnapshot(snapshotInput({
        id: `v${Math.random()}`,
        kind: SNAPSHOT_KIND.MANUAL,
        createdAt: Date.UTC(2026, 9, 27, 13, 0, 0),
        label: (meta && meta.label) || '',
      }))
    },
    restoreVersion(versionId) {
      // 与 `DocumentSession.restoreVersion` 同口径：只传 documentId，**不传 author**。
      return provider.restore(versionId, { documentId: 'doc-1' })
    },
  }
}

/**
 * 把 mixin 的 data 摊平成普通对象，并把 `computed` 装成**现算的 getter**。
 *
 * 为什么要装 getter 而不是只在断言处现算：methods 之间会互相读 computed（例如
 * `selectVersion` 读 `this.versionProvider`、`loadVersions` 读同一个），只读断言侧的话
 * 方法内部拿到的会是 undefined，测出来的就不是同一条分支。
 */
function mountMixin(state) {
  /**
   * 默认打开版本历史入口（`features.versionHistory` 缺省 false，见 `larkDocConfig`）。
   *
   * 本文件测的是「版本能力 + UI 纯函数」本身，入口开关不该参与其中；「缺省关闭」由
   * `workspace-view-state.test.js` 覆盖，入口闸门另有一条显式 `versionHistory: false`
   * 的用例（见「另存为版本 Dialog」段末）。放在最前面，让 `state` 能覆盖它。
   */
  const vm = Object.assign(
    { larkDocConfig: { features: { versionHistory: true } } },
    versioningMixin.data(),
    state || {},
  )
  /**
   * computed 与 methods 都装到实例上：`this.versionProvider` / `this.indexOfVersion`
   * 这类内部互调必须能走通，否则测到的不是同一条分支。
   */
  const names = Object.keys(versioningMixin.computed)
  for (let i = 0; i < names.length; i += 1) {
    const name = names[i]
    Object.defineProperty(vm, name, {
      configurable: true,
      get() {
        return versioningMixin.computed[name].call(vm)
      },
    })
  }
  const methodNames = Object.keys(versioningMixin.methods)
  for (let i = 0; i < methodNames.length; i += 1) {
    const name = methodNames[i]
    vm[name] = function boundMethod(...args) {
      return versioningMixin.methods[name].apply(vm, args)
    }
  }
  return vm
}

/** 求值某个 computed（带 `this`，与 Vue 2 运行时同签名）。 */
function computedOf(vm, name) {
  return versioningMixin.computed[name].call(vm)
}

/** 调用某个 method（同上）。 */
function callOf(vm, name, ...args) {
  return versioningMixin.methods[name].apply(vm, args)
}

/* ---------------- 1. 时间格式化 ---------------- */

it('opens a named version dialog and saves a separate manual version', async () => {
  const dom = new JSDOM('<section></section>')
  const host = dom.window.document.querySelector('section')
  vi.stubGlobal('document', dom.window.document)
  const session = fakeSession()
  const vm = mountMixin({ session, documentId: session.documentId, localTitle: '协同文档', $el: host })
  const opener = dom.window.document.createElement('button')
  opener.setAttribute('aria-haspopup', 'menu')
  host.append(opener)
  host.addEventListener('focusin', event => {
    if (event.target === opener && vm.versionNotice) vm.dismissVersionNotice()
  })
  try {
    expect(vm.versionCanSave).toBe(true)
    expect(await vm.openSaveVersion(opener)).toBe(true)
    const dialog = host.querySelector('[role="dialog"]')
    const input = dialog.querySelector('input')
    expect(input.value).toBe('协同文档 第 1 版')
    expect(input.maxLength).toBe(1000)
    input.value = '评审版'
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    Array.from(dialog.querySelectorAll('button')).find(button => button.textContent === '确定').click()
    await vi.waitFor(() => expect(dialog.isConnected).toBe(false))
    const versions = await session.getProvider('versioning').list({ documentId: session.documentId })
    expect(versions.map(({ label, kind }) => ({ label, kind }))).toEqual([{ label: '评审版', kind: 'manual' }])
    expect(dom.window.document.activeElement).toBe(opener)
    expect(vm.versionNotice).toMatch(/版本已保存/)
  } finally { vi.unstubAllGlobals(); dom.window.close() }
})

it('keeps the named version draft and checks the original operation after an unknown outcome', async () => {
  const dom = new JSDOM('<section></section>')
  const host = dom.window.document.querySelector('section')
  vi.stubGlobal('document', dom.window.document)
  const provider = {
    isRemote: true, requiresDurableConfirmation: true, createSnapshot: vi.fn(), list: vi.fn(async () => []),
    queryOperation: vi.fn(async operationId => ({ operationId, status: 'committed', version: { id: 'snapshot-1', status: 'durable' } })),
  }
  const session = fakeSession({ provider })
  session.createVersion = vi.fn(async ({ operationId }) => ({ operationId, status: 'unknown' }))
  const vm = mountMixin({ session, documentId: session.documentId, localTitle: '协同文档', $el: host })
  const click = label => Array.from(host.querySelectorAll('button')).find(button => button.textContent === label)?.click()
  try {
    expect(await vm.openSaveVersion()).toBe(true)
    click('确定')
    await vi.waitFor(() => expect(host.querySelector('input').readOnly).toBe(true))
    await vi.waitFor(() => expect(host.querySelector('[role="alert"]').textContent).toMatch(/待确认/))
    expect(vm.versionNotice).toBe('')
    click('取消')
    expect(await vm.openSaveVersion()).toBe(true)
    expect(host.querySelector('input').value).toBe('协同文档 第 1 版')
    click('查询原操作')
    await vi.waitFor(() => expect(vm.versionNotice).toMatch(/版本已保存/))
    expect(session.createVersion).toHaveBeenCalledTimes(1)
    expect(provider.queryOperation).toHaveBeenCalledWith(session.createVersion.mock.calls[0][0].operationId)
  } finally { vm.closeSaveVersion(); vi.unstubAllGlobals(); dom.window.close() }
})

it.each(['alice', 'bob'])('handles a pending named version after authorization resumes as %s', async principal => {
  const dom = new JSDOM('<section></section>')
  const host = dom.window.document.querySelector('section')
  vi.stubGlobal('document', dom.window.document)
  const posts = [], queries = []
  let admitted
  const admission = new Promise(resolve => { admitted = resolve })
  const provider = createHttpVersioningProvider({
    tenantId: 'tenant-1', docId: 'doc-1', csrfToken: () => 'current',
    getState: () => ({ status: 'ready', pending: [], revision: '1' }),
    async request(url, options) {
      if (options.method === 'POST') {
        posts.push(JSON.parse(options.body))
        admitted()
        return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new Error('续权前已保存，回执中断')), { once: true }))
      }
      if (url.endsWith('/versions')) return { status: 200, json: async () => [] }
      queries.push(url)
      if (queries.length === 1) return { status: 401, json: async () => ({ code: 'AUTHENTICATION_REQUIRED' }) }
      const { operationId, label, purpose } = posts[0]
      return { status: 200, json: async () => ({ status: 'committed', operationId, requestHash: 'sha256:' + 'd'.repeat(64),
        version: { tenantId: 'tenant-1', docId: 'doc-1', status: 'durable', versionId: 'original-version', operationId,
          createdBy: 'alice', createdAt: '2026-11-21T00:00:00.000Z', capturedSeq: '1', sourceRevision: '1', sourceEpoch: '1',
          schemaVersion: '1', label, purpose, kind: purpose, contentHash: 'sha256:' + 'a'.repeat(64), stateHash: 'sha256:' + 'b'.repeat(64),
          protocolVersion: 'editor-crdt-v1', sizeBytes: 1 } }) }
    },
  })
  const session = new DocumentSession({ documentId: 'doc-1', user: { id: 'alice' }, providers: { versioning: provider,
    authorization: { async getCapabilities() { return { canView: true, canCreateVersion: true } } } } })
  const vm = mountMixin({ session, documentId: session.documentId, localTitle: '协作记录', $el: host })
  const button = label => Array.from(host.querySelectorAll('button')).find(item => item.textContent === label)
  try {
    await session._capabilitiesPromise
    expect(await vm.openSaveVersion()).toBe(true)
    const input = host.querySelector('input')
    input.value = 'Alice 的原草稿'
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    button('确定').click()
    await admission
    expect(Object.keys(posts[0])).toEqual(['operationId', 'expectedRevision', 'label', 'purpose'])
    if (principal === 'bob') session.user = { id: 'bob' }
    await session.refreshCapabilities()
    expect(host.querySelector('[role="dialog"]')).toBeNull()
    expect(vm.versionNotice).toBe('')
    expect(await vm.openSaveVersion()).toBe(true)
    if (principal === 'alice') {
      expect(host.querySelector('input').value).toBe('Alice 的原草稿')
      button('查询原操作').click()
      await vi.waitFor(() => expect(host.querySelector('[role="alert"]').textContent).toMatch(/待确认/))
      await session.refreshCapabilities()
      expect(await vm.openSaveVersion()).toBe(true)
      button('查询原操作').click()
      await vi.waitFor(() => expect(vm.versionNotice).toMatch(/版本已保存/))
      expect(queries).toEqual(Array(2).fill(`/editor/v1/tenants/tenant-1/operations/${posts[0].operationId}?commandType=version`))
    } else {
      expect(host.querySelector('input').value).toBe('协作记录 第 1 版')
      expect(button('查询原操作')).toBeUndefined()
      await expect(provider.queryOperation(posts[0].operationId)).rejects.toMatchObject({ code: 'VERSION_CONTEXT_CHANGED' })
      expect(queries).toEqual([])
    }
    expect(posts).toHaveLength(1)
  } finally {
    vm.closeSaveVersion()
    await session.dispose()
    vi.unstubAllGlobals()
    dom.window.close()
  }
})

describe('版本时间格式化', () => {
  it('条目名是「M月D日 HH:mm」，时与分都补零（04 §3.4-C 实测 10月25日 00:04）', () => {
    expect(formatVersionTime(Date.UTC(2026, 9, 25, 0, 4))).toBe('10月25日 00:04')
    expect(formatVersionTime(Date.UTC(2026, 0, 1, 23, 59))).toBe('1月1日 23:59')
  })

  it('拿不到有效时间时返回空串，不伪造 1970 或当前时间', () => {
    expect(formatVersionTime(0)).toBe('')
    expect(formatVersionTime(NaN)).toBe('')
    expect(formatVersionTime(undefined)).toBe('')
  })

  it('formatVersionClock 只取 HH:mm，非法入参退回「当前时刻」而不是报错', () => {
    expect(formatVersionClock(Date.UTC(2026, 9, 27, 0, 18))).toBe('00:18')
    // 只断言形态：这一支依赖 Date.now()，值本身不稳定。
    expect(formatVersionClock(NaN)).toMatch(/^\d{2}:\d{2}$/)
  })

  it('日期分组标题：今天 / 昨天 / M月D日 / 未知时间', () => {
    const now = Date.UTC(2026, 9, 27, 12, 0, 0)
    const day = 86400000
    expect(formatVersionDayLabel(now, now)).toBe(VERSIONING_DAY_LABELS.today)
    expect(formatVersionDayLabel(now - day, now)).toBe(VERSIONING_DAY_LABELS.yesterday)
    expect(formatVersionDayLabel(now - day * 2, now)).toBe('10月25日')
    expect(formatVersionDayLabel(0, now)).toBe(VERSIONING_DAY_LABELS.unknown)
  })

  it('「今天 / 昨天」按自然日算，不是按 24 小时窗口', () => {
    // 反例 1：距今仅 1 小时，但已经跨过午夜 → 昨天，不是今天。
    const justAfterMidnight = Date.UTC(2026, 9, 27, 0, 30)
    expect(formatVersionDayLabel(Date.UTC(2026, 9, 26, 23, 30), justAfterMidnight))
      .toBe(VERSIONING_DAY_LABELS.yesterday)
    // 反例 2：距今 47 小时，超过一个 24 小时窗口，但仍是同一个自然日 → 昨天。
    const lateAtNight = Date.UTC(2026, 9, 27, 23, 30)
    expect(formatVersionDayLabel(Date.UTC(2026, 9, 26, 0, 30), lateAtNight))
      .toBe(VERSIONING_DAY_LABELS.yesterday)
  })
})

/* ---------------- 2. 列表排序与按月分组 ---------------- */

describe('按月分组（009 §T9 时间线）', () => {
  it('provider.list() 保证新→旧，分组只切段不重排', async () => {
    const { list } = await listAcrossDays()
    expect(list.map((item) => item.id)).toEqual(['v2', 'v4', 'v3', 'v1'])
  })

  it('同一个月连续归并成一组，标题只写 `M月`', async () => {
    // 飞书真身（`hist_i_select2.png`）分组标题是 `10月`：条目自己已经带 `10月26日 12:08`，
    // 组标题不再重复日期。
    const { list } = await listAcrossDays()
    const groups = groupVersionsByMonth(list)
    expect(groups.map((group) => group.label)).toEqual(['10月'])
    expect(headIds(groups[0])).toEqual(['v2', 'v4', 'v3', 'v1'])
  })

  it('跨月另起一组；跨年同月不能并组（key 带年份）', () => {
    const groups = groupVersionsByMonth([
      { id: 'a', createdAt: Date.UTC(2026, 9, 27, 10, 0) },
      { id: 'b', createdAt: Date.UTC(2026, 9, 2, 10, 0) },
      { id: 'c', createdAt: Date.UTC(2026, 8, 30, 10, 0) },
      { id: 'd', createdAt: Date.UTC(2025, 8, 30, 10, 0) },
    ])
    expect(groups.map((group) => group.label)).toEqual(['10月', '9月', '9月'])
    expect(groups.map((group) => group.key)).toEqual(['2026-10', '2026-09', '2025-09'])
    expect(headIds(groups[0])).toEqual(['a', 'b'])
  })

  it('分组只切连续段，不打散顺序（下标错位会把 A 的时间贴到 B 上）', async () => {
    const { list } = await listAcrossDays()
    const flat = []
    for (const month of groupVersionsByMonth(list)) flat.push(...headIds(month))
    expect(flat).toEqual(list.map((item) => item.id))
  })

  it('缺失时间的条目单独归到「未知时间」，key 留空而不是 1970-01', () => {
    const groups = groupVersionsByMonth([
      { id: 'a', createdAt: Date.UTC(2026, 9, 27, 10, 0) },
      { id: 'b', createdAt: 0 },
    ])
    expect(groups.map((group) => group.label)).toEqual(['10月', VERSIONING_DAY_LABELS.unknown])
    expect(groups[1].key).toBe('')
    expect(headIds(groups[1])).toEqual(['b'])
  })

  it('空输入与非数组输入都返回空数组（面板右栏走降级而不是白屏）', () => {
    expect(groupVersionsByMonth([])).toEqual([])
    expect(groupVersionsByMonth(null)).toEqual([])
    expect(groupVersionsByMonth(undefined)).toEqual([])
  })

  // ——— 父子折叠（009 C4）：分组口径只有 `groupId` 一条，禁止按时间间隔聚类 ———
  it('同一 groupId 且相邻的记录并成一个折叠组，父行是组内第一条', () => {
    const groups = groupVersionsByMonth([
      { id: 'c', createdAt: Date.UTC(2026, 9, 26, 12, 8), groupId: 'g1' },
      { id: 'b', createdAt: Date.UTC(2026, 9, 26, 12, 8), groupId: 'g1' },
      { id: 'a', createdAt: Date.UTC(2026, 9, 26, 12, 2), groupId: 'g1' },
    ])
    expect(groups[0].groups).toHaveLength(1)
    const [node] = groups[0].groups
    expect(node.id).toBe('g1')
    expect(node.head.id).toBe('c')
    // 父行 === children[0]：飞书父行就是 `minor_history[0]`，展开后前两行同刻同文。
    expect(node.children.map((item) => item.id)).toEqual(['c', 'b', 'a'])
    expect(node.children[0]).toBe(node.head)
  })

  it('groupId 只在**相邻**时并组：中间夹了别的组就断开（不跨组回捞）', () => {
    const groups = groupVersionsByMonth([
      { id: 'c', createdAt: Date.UTC(2026, 9, 26, 12, 8), groupId: 'g1' },
      { id: 'b', createdAt: Date.UTC(2026, 9, 26, 11, 0), groupId: 'g2' },
      { id: 'a', createdAt: Date.UTC(2026, 9, 26, 10, 0), groupId: 'g1' },
    ])
    expect(groups[0].groups.map((node) => node.id)).toEqual(['g1', 'g2', 'g1'])
    expect(groups[0].groups.map((node) => node.children.length)).toEqual([0, 0, 0])
  })

  it('单条组没有折叠子项（飞书 type 1/3 的 minor_history 恒 1 条 → 不画三角）', () => {
    const groups = groupVersionsByMonth([
      { id: 'b', createdAt: Date.UTC(2026, 9, 26, 12, 8), groupId: 'g1' },
      { id: 'a', createdAt: Date.UTC(2026, 9, 26, 10, 0) },
    ])
    expect([...groups[0].groups].map((node) => node.children)).toEqual([[], []])
  })

  it('没有 groupId 的记录各自成组（缺省空串，不做时间聚类）', () => {
    // 两条相隔 1 分钟：任何「按间隔聚类」都会把它们并起来，这里必须仍是两组。
    const groups = groupVersionsByMonth([
      { id: 'b', createdAt: Date.UTC(2026, 9, 26, 12, 8) },
      { id: 'a', createdAt: Date.UTC(2026, 9, 26, 12, 7) },
    ])
    expect(groups[0].groups.map((node) => node.id)).toEqual(['b', 'a'])
  })
})


/* ---------------- 3. diffSummary 投影 ---------------- */

describe('差异摘要投影', () => {
  it('recordMetrics 只带 blockCount：历史侧没有正文，字数与标题恒为「不提供」', () => {
    expect(recordMetrics({ blockCount: 12 })).toEqual({ blockCount: 12, charCount: 0, headings: [] })
    expect(recordMetrics(null)).toEqual({ blockCount: 0, charCount: 0, headings: [] })
    expect(recordMetrics({ blockCount: null })).toEqual({ blockCount: 0, charCount: 0, headings: [] })
  })

  it('historyDiffSummary 复用 core 的 diffSummary，delta = 新 - 旧', () => {
    const summary = historyDiffSummary({ blockCount: 3 }, { blockCount: 7 })
    expect(summary.blockCount).toEqual({ prev: 3, next: 7, delta: 4 })
    expect(summary.charCount).toEqual({ prev: 0, next: 0, delta: 0 })
    expect(summary.headings).toEqual({ added: [], removed: [] })
  })

  it('describeVersionDiff 只报块数差，两侧都要真实存在才算数', () => {
    expect(describeVersionDiff({ blockCount: 3 }, { blockCount: 7 })).toBe('新增 4 个块')
    expect(describeVersionDiff({ blockCount: 7 }, { blockCount: 3 })).toBe('减少 4 个块')
    expect(describeVersionDiff({ blockCount: 5 }, { blockCount: 5 })).toBe('块数无变化')
  })

  it('最早一条没有更早版本可比 —— 明说「无更早版本」，不谎报成「新增 n 个块」', () => {
    expect(describeVersionDiff(null, { blockCount: 7 })).toBe('最早一条记录，无更早版本可比')
    expect(describeVersionDiff(undefined, null)).toBe('暂无可选中的版本')
  })

  it('块数未知时说未知，不补 0 假装「无变化」', () => {
    expect(describeVersionDiff({}, { blockCount: 7 })).toBe('相邻版本的块数未知，无法生成摘要')
    expect(describeVersionDiff({ blockCount: 3 }, {})).toBe('相邻版本的块数未知，无法生成摘要')
  })

  it('currentProjection 拿的是真字数与真标题（当前正文是唯一有 JSON 的一侧）', () => {
    const editor = {
      getJSON() {
        return {
          type: 'doc',
          content: [
            { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '标题' }] },
            { type: 'paragraph', content: [{ type: 'text', text: '正文' }] },
          ],
        }
      },
    }
    expect(currentProjection(editor)).toEqual({
      blockCount: 2,
      charCount: 4,
      headings: [{ level: 2, text: '标题' }],
    })
  })

  it('编辑器缺失或已销毁时返回 null，面板不跟着崩', () => {
    expect(currentProjection(null)).toBe(null)
    expect(currentProjection({})).toBe(null)
    const dead = {
      getJSON() {
        throw new Error('editor is destroyed')
      },
    }
    expect(currentProjection(dead)).toBe(null)
  })
})

/* ---------------- 4. 错误码 → 降级文案 ---------------- */

describe('版本回收站 UI 工作流', () => {
  it('回收站管理在无权限时 fail-closed，并支持恢复/彻底删除', async () => {
    const provider = createMemoryVersioningProvider({ author: 'u-1' })
    const first = await provider.createSnapshot(snapshotInput({ id: 'trash-1' }))
    await provider.remove(first.id)
    const vm = mountMixin({ session: fakeSession({ provider }), localTitle: '文档' })
    await vm.openVersionTrash()
    expect(vm.versionDeletedList).toHaveLength(1)
    await vm.restoreDeletedVersion(first.id)
    expect(vm.versionDeletedList).toHaveLength(0)
    await provider.remove(first.id)
    await vm.loadDeletedVersions()
    await vm.purgeDeletedVersion(first.id)
    expect(vm.versionDeletedList).toHaveLength(0)

    // 回收站门禁跟还原按钮同口径：没有 `canRestoreVersion` 就 fail-closed。
    const denied = mountMixin({ session: fakeSession({ provider, capabilities: { canRestoreVersion: false } }) })
    await expect(denied.openVersionTrash()).resolves.toBe(false)
    expect(denied.versionTrashOpen).toBe(false)
  })

  it('远端缺回收站端口明确不可用，跨文档 id 不进入内存写端口', async () => {
    const unavailable = mountMixin({ session: fakeSession({ provider: { requiresDurableConfirmation: true } }) })
    expect(await unavailable.openVersionTrash()).toBe(false)
    expect(unavailable.versionTrashReason).toContain('尚未配置')
    const provider = createMemoryVersioningProvider({ author: 'u-1' })
    const other = await provider.createSnapshot(snapshotInput({ id: 'other', documentId: 'doc-2' }))
    await provider.remove(other.id)
    const purge = vi.spyOn(provider, 'purge')
    const vm = mountMixin({ session: fakeSession({ provider }) })
    expect(await vm.purgeDeletedVersion(other.id)).toBe(false)
    expect(purge).not.toHaveBeenCalled()
    expect(vm.versionTrashError).toContain('当前文档')
    expect(await provider.listDeleted({ documentId: 'doc-2' })).toHaveLength(1)
  })
})

describe('版本状态投影', () => {
  it('真实远端 Provider 拒绝 unknown 元数据，面板显示错误而非可恢复版本', async () => {
    const provider = createHttpVersioningProvider({ tenantId: 'tenant-1', docId: 'doc-1',
      request: async () => ({ status: 200, json: async () => [{ tenantId: 'tenant-1', docId: 'doc-1', status: 'unknown',
        versionId: 'v1', operationId: 'op-1', createdBy: 'alice', createdAt: '2026-11-15T00:00:00Z',
        capturedSeq: '1', sourceRevision: '1', sourceEpoch: '1', schemaVersion: '2', label: 'A', purpose: 'manual', kind: 'manual',
        contentHash: 'sha256:' + 'a'.repeat(64), stateHash: 'sha256:' + 'b'.repeat(64), protocolVersion: 'editor-crdt-v1', sizeBytes: 16 }] }) })
    const vm = mountMixin({ session: fakeSession({ provider }) })
    await vm.openVersionPanel()
    expect(vm.versionList).toEqual([])
    expect(vm.versionError).toBe('VERSION_INVALID_RESPONSE')
    expect(vm.versionRestoreDisabled).toBe(true)
    const dom = new JSDOM('<div id="host"></div>')
    vi.stubGlobal('document', dom.window.document)
    const panel = createVersionPanel({ host: dom.window.document.querySelector('#host') })
    try {
      panel.update({ open: true, view: 'error', errorText: vm.versionError, restore: { disabled: vm.versionRestoreDisabled },
        pager: { cursor: '0/0', prev: { disabled: true }, next: { disabled: true } } })
      expect(panel.el.textContent).toContain('VERSION_INVALID_RESPONSE')
      expect(panel.el.querySelector('.lark-doc-version-restore').disabled).toBe(true)
    } finally { panel.destroy(); vi.unstubAllGlobals(); dom.window.close(); provider.dispose() }
  })
})

describe('错误码 → 面板文案', () => {
  it('两个「找不到」必须分开：不存在可重试，已淘汰回不去', () => {
    expect(VERSIONING_ERROR_TEXT[E_VERSION_NOT_FOUND]).toContain('刷新')
    expect(VERSIONING_ERROR_TEXT[E_VERSION_EVICTED]).toContain('淘汰')
    expect(VERSIONING_ERROR_TEXT[E_VERSION_NOT_FOUND]).not.toBe(VERSIONING_ERROR_TEXT[E_VERSION_EVICTED])
  })

  it('映射表是冻结常量，且每个已声明错误码都有非空文案', () => {
    expect(Object.isFrozen(VERSIONING_ERROR_TEXT)).toBe(true)
    const codes = [E_VERSION_NOT_FOUND, E_VERSION_EVICTED, E_SNAPSHOT_PAYLOAD_MISSING,
      E_SNAPSHOT_AUTHOR, E_SNAPSHOT_JSON_NOT_ALLOWED]
    for (let i = 0; i < codes.length; i += 1) {
      expect(typeof VERSIONING_ERROR_TEXT[codes[i]]).toBe('string')
      expect(VERSIONING_ERROR_TEXT[codes[i]].length).toBeGreaterThan(0)
    }
  })

  it('versioningErrorMessage 优先吃 code，其次吃 message（session 抛的是裸 Error）', () => {
    expect(versioningErrorMessage(null)).toBe('')
    expect(versioningErrorMessage({ code: E_VERSION_NOT_FOUND })).toBe(VERSIONING_ERROR_TEXT[E_VERSION_NOT_FOUND])
    expect(versioningErrorMessage(new Error('未配置 versioning Provider'))).toBe('未配置 versioning Provider')
    expect(versioningErrorMessage({})).toBe('版本操作失败')
  })

  it('真实的「已淘汰」路径：prune 之后 get 报 E_VERSION_EVICTED，文案是淘汰而不是不存在', async () => {
    const provider = createMemoryVersioningProvider({ author: 'u-1' })
    await provider.createSnapshot(snapshotInput({ id: 'old', createdAt: 1000 }))
    await provider.createSnapshot(snapshotInput({ id: 'new', createdAt: 2000 }))
    // keepAuto=1 只留最新那份自动快照，old 被淘汰并立墓碑。
    const dropped = provider.prune({ keepAuto: 1 }).dropped.map((item) => item.id)
    expect(dropped).toEqual(['old'])

    let captured = null
    try {
      await provider.get('old')
    } catch (error) {
      captured = error
    }
    expect(captured && captured.code).toBe(E_VERSION_EVICTED)
    expect(versioningErrorMessage(captured)).toBe(VERSIONING_ERROR_TEXT[E_VERSION_EVICTED])
  })

  it('恢复缺 author 时报 E_SNAPSHOT_AUTHOR，文案点明是宿主没传当前作者', async () => {
    // 复现接线缺口：DocumentSession.restoreVersion 只传 documentId，Provider 没有 author 兜底。
    const provider = createMemoryVersioningProvider()
    await provider.createSnapshot(snapshotInput({ id: 'v1', createdAt: 1000 }))
    let captured = null
    try {
      await provider.restore('v1', { documentId: 'doc-1' })
    } catch (error) {
      captured = error
    }
    expect(captured && captured.code).toBe(E_SNAPSHOT_AUTHOR)
    expect(versioningErrorMessage(captured)).toBe(VERSIONING_ERROR_TEXT[E_SNAPSHOT_AUTHOR])
  })
})

/* ---------------- 5. capability 闸门 ---------------- */

describe('capability 闸门（04 §3.4-B 置灰，不隐藏）', () => {
  it('没有 session → 未配置 DocumentSession', () => {
    expect(versionCapabilityGate(null, 'canCreateVersion')).toEqual({
      allowed: false, reason: '未配置 DocumentSession', missingProvider: true,
    })
    expect(versionCapabilityGate({}, 'canCreateVersion').allowed).toBe(false)
  })

  it('capability 被显式关掉 → 无权限（不是接线问题）', () => {
    const session = fakeSession({ capabilities: { canCreateVersion: false } })
    const gate = versionCapabilityGate(session, 'canCreateVersion')
    expect(gate).toEqual({ allowed: false, reason: '当前用户没有该操作的权限', missingProvider: false })
  })

  it('有权限但没挂 Provider → 未配置 versioning Provider', () => {
    const session = fakeSession({ provider: null })
    const gate = versionCapabilityGate(session, 'canRestoreVersion')
    expect(gate).toEqual({ allowed: false, reason: '未配置 versioning Provider', missingProvider: true })
  })

  it('三件事都成立才放行，且 reason 为空', () => {
    const gate = versionCapabilityGate(fakeSession(), 'canRestoreVersion')
    expect(gate).toEqual({ allowed: true, reason: '', missingProvider: false })
  })

  it('只关 canRestoreVersion：列表照读，只有还原被拦（手动另存为已下线，不再有第二个能力位）', () => {
    const session = fakeSession({ capabilities: { canRestoreVersion: false } })
    const vm = mountMixin({ session })
    expect(computedOf(vm, 'versionCanRestore')).toBe(false)
    expect(computedOf(vm, 'versionCanRestoreReason')).toBe('当前用户没有该操作的权限')
  })

  it('无权限时置灰但不隐藏：置灰样式照给，按钮照挂', () => {
    const vm = mountMixin()
    expect(callOf(vm, 'versionDisabledStyle', true)).toEqual({
      backgroundColor: 'rgb(187, 191, 196)', cursor: 'not-allowed',
    })
    expect(callOf(vm, 'versionDisabledStyle', false)).toBe(null)
  })
})

/* ---------------- 6. 选中 / 游标 / 还原按钮 ---------------- */

describe('选中态与编辑记录游标', () => {
  it('游标文案是「编辑记录 N/M」，翻的是编辑记录不是版本（§3.4 ⑤ 反直觉 3）', () => {
    const vm = mountMixin({
      versionList: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      versionIndex: 2,
    })
    expect(VERSIONING_CURSOR_LABEL).toBe('编辑记录')
    expect(computedOf(vm, 'versionCursorLabel')).toBe('编辑记录 2/3')
  })

  it('空列表时是 0/0，不伪造 1/0', () => {
    expect(computedOf(mountMixin(), 'versionCursorLabel')).toBe('编辑记录 0/0')
  })

  it('首条禁用上一项，末条禁用下一项（1/10 时上一项实测置灰）', () => {
    const vm = mountMixin({ versionList: [{ id: 'a' }, { id: 'b' }], versionIndex: 1 })
    expect(computedOf(vm, 'versionPrevDisabled')).toBe(true)
    expect(computedOf(vm, 'versionNextDisabled')).toBe(false)
    vm.versionIndex = 2
    expect(computedOf(vm, 'versionPrevDisabled')).toBe(false)
    expect(computedOf(vm, 'versionNextDisabled')).toBe(true)
  })

  it('还原按钮：没选中 → 禁用；无 canRestoreVersion → 禁用（⑦-1 推断实现）', () => {
    const session = fakeSession()
    const bare = mountMixin({ session, versionList: [{ id: 'a' }] })
    expect(computedOf(bare, 'versionRestoreDisabled')).toBe(true)

    bare.versionSelectedId = 'a'
    expect(computedOf(bare, 'versionRestoreDisabled')).toBe(false)

    const denied = mountMixin({
      session: fakeSession({ capabilities: { canRestoreVersion: false } }),
      versionList: [{ id: 'a' }],
      versionSelectedId: 'a',
    })
    expect(computedOf(denied, 'versionRestoreDisabled')).toBe(true)
  })

  it('还原进行中保持禁用，避免连点造出两条恢复版本', () => {
    const vm = mountMixin({
      session: fakeSession(),
      versionList: [{ id: 'a' }],
      versionSelectedId: 'a',
      versionRestoreBusy: true,
    })
    expect(computedOf(vm, 'versionRestoreDisabled')).toBe(true)
  })

  it('选中项的差异摘要取「更早那份」；最早一份没有可比对象时给 null', () => {
    const vm = mountMixin({
      versionList: [{ id: 'a', blockCount: 9 }, { id: 'b', blockCount: 4 }],
      versionIndex: 1,
    })
    expect(computedOf(vm, 'versionSelectedDiff').blockCount).toEqual({ prev: 4, next: 9, delta: 5 })
    vm.versionIndex = 2
    expect(computedOf(vm, 'versionSelectedDiff')).toBe(null)
  })

  it('选中类只认 id，不认对象引用（provider.list() 每次返回新对象）', () => {
    const vm = mountMixin({ versionList: [{ id: 'a' }, { id: 'b' }], versionSelectedId: 'b' })
    expect(callOf(vm, 'versionTimelineClass', { id: 'a' })).toEqual({ selected: false })
    expect(callOf(vm, 'versionTimelineClass', { id: 'b' })).toEqual({ selected: true })
    expect(callOf(vm, 'versionTimelineClass', null)).toEqual({ selected: false })
  })
})

/* ---------------- 8. 列表拉取与降级 ---------------- */

describe('列表拉取与降级', () => {
  function pendingListHost() {
    const requests = []
    const provider = { list: vi.fn(() => new Promise((resolve, reject) => { requests.push({ resolve, reject }) })) }
    const session = Object.assign(fakeSession({ provider }), { user: { id: 'actor' }, _identityGeneration: 1,
      _privateIdentityGeneration: 1, _authorizationGeneration: 1, _versioningProviderGeneration: 1 })
    return { vm: mountMixin({ session, documentId: 'doc-1', editor: { isDestroyed: false } }), session, provider, requests }
  }

  it.each([
    ['actor', vm => { vm.session.user.id = 'next-actor' }],
    ['identity generation', vm => { vm.session._identityGeneration += 1 }],
    ['private identity generation', vm => { vm.session._privateIdentityGeneration += 1 }],
    ['authorization generation', vm => { vm.session._authorizationGeneration += 1 }],
    ['versioning provider generation', vm => { vm.session._versioningProviderGeneration += 1 }],
    ['session document', vm => { vm.session.documentId = 'next-doc' }],
    ['host document', vm => { vm.documentId = 'next-doc' }],
  ])('同Session切换%s后，迟到版本列表不能写入新上下文', async (_, change) => {
    const { vm, provider, requests } = pendingListHost()
    const pending = vm.loadVersions()
    expect(provider.list).toHaveBeenCalledExactlyOnceWith({ documentId: 'doc-1' })
    change(vm)
    const nextList = [{ id: 'next-visible' }]
    vm.versionList = nextList
    vm.versionSelectedId = 'next-visible'
    vm.versionIndex = 1
    vm.versionError = 'next-context'
    requests[0].resolve([{ id: 'retired-private', kind: SNAPSHOT_KIND.MANUAL }])
    expect(await pending).toEqual([])
    expect(vm.versionList).toBe(nextList)
    expect(vm.versionSelectedId).toBe('next-visible')
    expect(vm.versionIndex).toBe(1)
    expect(vm.versionError).toBe('next-context')
    expect(vm.versionLoading).toBe(true)
  })

  it('身份变化后的旧列表失败与finally均不清除新上下文状态', async () => {
    const { vm, requests } = pendingListHost()
    const pending = vm.loadVersions()
    vm.session.user.id = 'next-actor'
    const nextList = [{ id: 'next-visible' }]
    vm.versionList = nextList
    vm.versionError = 'next-context'
    requests[0].reject(new Error('retired-private-error'))
    expect(await pending).toEqual([])
    expect(vm.versionList).toBe(nextList)
    expect(vm.versionError).toBe('next-context')
    expect(vm.versionLoading).toBe(true)
  })

  it('新scope列表可正常完成，旧请求的finally不清新loading且请求固定原documentId', async () => {
    const { vm, provider, requests } = pendingListHost()
    const old = vm.loadVersions()
    vm.session.documentId = vm.documentId = 'next-doc'
    const pending = vm.loadVersions()
    requests[0].resolve([{ id: 'retired-private' }])
    expect(await old).toEqual([])
    expect(vm.versionLoading).toBe(true)
    const visible = [{ id: 'next-visible', kind: SNAPSHOT_KIND.MANUAL }]
    requests[1].resolve(visible)
    expect(await pending).toEqual(visible)
    expect(vm.versionList).toEqual(visible)
    expect(vm.versionSelectedId).toBe('next-visible')
    expect(vm.versionLoading).toBe(false)
    expect(provider.list.mock.calls).toEqual([[{ documentId: 'doc-1' }], [{ documentId: 'next-doc' }]])
  })

  it('没有 Provider 时给降级文案，不白屏也不抛', async () => {
    const vm = mountMixin({ session: fakeSession({ provider: null }) })
    const list = await callOf(vm, 'loadVersions')
    expect(list).toEqual([])
    expect(vm.versionError).toBe('未配置 versioning Provider，历史记录不可用')
  })

  it('拉到列表后游标落在首条并默认选中它', async () => {
    const { provider, list } = await listAcrossDays()
    const vm = mountMixin({ session: fakeSession({ provider }) })
    await callOf(vm, 'loadVersions')
    expect(vm.versionList.length).toBe(list.length)
    expect(vm.versionIndex).toBe(1)
    expect(vm.versionSelectedId).toBe(list[0].id)
    expect(vm.versionError).toBe('')
  })

  it('选中一个版本后，游标跟着走到它的位置', async () => {
    const { provider, list } = await listAcrossDays()
    const vm = mountMixin({ session: fakeSession({ provider }) })
    await callOf(vm, 'loadVersions')
    await callOf(vm, 'selectVersion', list[2].id)
    expect(vm.versionIndex).toBe(3)
    expect(vm.versionSelectedId).toBe(list[2].id)
    // 正文是二进制：预览只记「有没有」与字节数，不试图解码。
    expect(vm.versionPreview.hasPayload).toBe(true)
    expect(vm.versionPreview.byteLength).toBe(16)
  })

  it('取不到单个版本时只降级这一屏，列表还在（不白屏）', async () => {
    const provider = createMemoryVersioningProvider({ author: 'u-1' })
    await provider.createSnapshot(snapshotInput({ id: 'v1', createdAt: 1000 }))
    const vm = mountMixin({ session: fakeSession({ provider }) })
    await callOf(vm, 'loadVersions')
    await callOf(vm, 'selectVersion', 'ghost')
    expect(vm.versionList.length).toBe(1)
    expect(vm.versionPreview).toBe(null)
    expect(vm.versionPreviewError).toBe(VERSIONING_ERROR_TEXT[E_VERSION_NOT_FOUND])
  })

  it('恢复走 session.restoreVersion；成功后提示「原版本仍保留」并刷新列表', async () => {
    // Provider 带 author 兜底，绕开「宿主未传 author」那条接线缺口。
    const provider = createMemoryVersioningProvider({ author: 'u-1' })
    await provider.createSnapshot(snapshotInput({ id: 'v1', createdAt: 1000, blockCount: 3 }))
    const vm = mountMixin({ session: fakeSession({ provider }), versionList: [], versionIndex: 0 })
    await callOf(vm, 'loadVersions')
    vm.versionSelectedId = 'v1'
    await callOf(vm, 'restoreSelectedVersion')
    expect(vm.versionList.length).toBe(2)
    expect(vm.versionList[0].kind).toBe(SNAPSHOT_KIND.RESTORE)
    expect(vm.versionNotice).toContain('原版本仍保留')
    expect(vm.versionRestoreBusy).toBe(false)
  })

  it('恢复失败时把错误翻成人话挂到预览区，不静默吞掉', async () => {
    const provider = createMemoryVersioningProvider()
    await provider.createSnapshot(snapshotInput({ id: 'v1', createdAt: 1000 }))
    const vm = mountMixin({ session: fakeSession({ provider }) })
    await callOf(vm, 'loadVersions')
    vm.versionSelectedId = 'v1'
    await callOf(vm, 'restoreSelectedVersion')
    expect(vm.versionPreviewError).toBe(VERSIONING_ERROR_TEXT[E_SNAPSHOT_AUTHOR])
  })

  it('没选中任何版本时还原直接返回，不打 Provider', async () => {
    const vm = mountMixin({ session: fakeSession() })
    expect(await callOf(vm, 'restoreSelectedVersion')).toBe(null)
    expect(vm.versionPreviewError).toBe('')
  })
})

describe('C07真实版本投影与原操作状态（mixin行为，非浏览器渲染）', () => {
  const projection = text => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
  const record = (id, text) => ({ id, documentId: 'doc-1', label: id, createdAt: 1000, author: 'alice',
    kind: 'manual', payload: bytes(16), contentJson: projection(text), sourceRevision: '7', sourceEpoch: '1',
    capturedSeq: '7', contentHash: 'sha256:' + 'a'.repeat(64), stateHash: 'sha256:' + 'b'.repeat(64) })
  const deferred = () => {
    let resolve
    const promise = new Promise(done => { resolve = done })
    return { promise, resolve }
  }

  it('首项自动get真实投影，预览保留正文与来源hash，不改活动正文', async () => {
    const calls = []
    let activeWrites = 0
    const provider = { list: async () => [{ id: 'v1' }], get: async id => { calls.push(id); return record(id, '冻结A') },
      createSnapshot: vi.fn(), restore: vi.fn() }
    const session = new DocumentSession({ documentId: 'doc-1', user: { id: 'alice' }, providers: { versioning: provider } })
    const read = vi.spyOn(session, 'readVersionDocument')
    const vm = mountMixin({ session, editor: { commands: { setContent() { activeWrites++ } } } })
    try {
      await callOf(vm, 'openVersionPanel')
      expect(read).toHaveBeenCalledExactlyOnceWith('v1', expect.objectContaining({ documentId: 'doc-1' }))
      expect(calls).toEqual(['v1', 'v1']) // The authorized read port fetches a fresh provider record.
      expect(vm.versionPreview.document.content).toEqual(projection('冻结A'))
      expect(vm.versionPreview.sourceRevision).toBe('7')
      expect(vm.versionPreview.contentHash).toBe(record('v1', '').contentHash)
      expect(activeWrites).toBe(0)
      expect(provider.createSnapshot).not.toHaveBeenCalled()
      expect(provider.restore).not.toHaveBeenCalled()
    } finally { read.mockRestore(); await session.dispose() }
  })

  it('切换和关闭使旧get失效，不回显旧版本或越权缓存', async () => {
    const first = deferred(), second = deferred(), third = deferred()
    const provider = { get: id => ({ v1: first, v2: second, v3: third })[id].promise }
    const vm = mountMixin({ session: fakeSession({ provider }), versionList: [{ id: 'v1' }, { id: 'v2' }, { id: 'v3' }] })
    const a = callOf(vm, 'selectVersion', 'v1')
    const b = callOf(vm, 'selectVersion', 'v2')
    second.resolve(record('v2', 'B')); await b
    first.resolve(record('v1', 'A')); await a
    expect(vm.versionPreview.id).toBe('v2')
    const c = callOf(vm, 'selectVersion', 'v3')
    callOf(vm, 'closeVersionPanel')
    third.resolve(record('v3', 'C')); await c
    expect(vm.versionPreview).toBe(null)
  })

  it('远端恢复unknown保原op与只读，后续只query；DBcommitted但未重开不谎称失败', async () => {
    let restores = 0, queries = 0
    const editable = []
    const provider = { requiresDurableConfirmation: true, supportsRestore: true,
      queryRestoreOperation: async operationId => { queries++; return { status: 'committed', operationId,
        postVersion: { status: 'durable' }, reloadRequired: true, editingResumed: false } },
      list: async () => [],
    }
    const session = fakeSession({ provider })
    session.restoreVersion = async () => { restores++; return { status: 'unknown', operationId: 'restore-original' } }
    const vm = mountMixin({ session, editor: { setEditable: value => editable.push(value) },
      versionList: [{ id: 'v1' }], versionSelectedId: 'v1', versionPanelOpen: true })
    await callOf(vm, 'restoreSelectedVersion')
    expect(vm.versionNotice).toBe('')
    expect(vm.versionRestoreOperationId).toBe('restore-original')
    expect(vm.versionPreviewError).toContain('待确认')
    await callOf(vm, 'restoreSelectedVersion')
    expect(restores).toBe(1)
    expect(queries).toBe(1)
    expect(editable).toEqual([false, false])
    expect(vm.versionNotice).toBe('恢复已提交，请重新打开文档')
    expect(vm.versionRestoreNeedsReload).toBe(true)
    expect(vm.versionRestoreDisabled).toBe(true)
    await callOf(vm, 'restoreSelectedVersion')
    expect(restores).toBe(1)
    expect(queries).toBe(1)
  })

  it('恢复待确认无查询服务时保持原键和只读，不发第二次恢复', async () => {
    const provider = { requiresDurableConfirmation: true, supportsRestore: true }
    const session = fakeSession({ provider })
    session.restoreVersion = vi.fn(async () => ({ status: 'unknown', operationId: 'restore-original' }))
    let editable = true
    const vm = mountMixin({ session, writable: () => editable, editor: { setEditable: value => { editable = value } },
      versionList: [{ id: 'v1' }], versionSelectedId: 'v1', versionPanelOpen: true })
    await vm.restoreSelectedVersion()
    expect(editable).toBe(false)
    await vm.requestVersionRestore()
    expect(session.restoreVersion).toHaveBeenCalledTimes(1)
    expect(vm.versionRestoreOperationId).toBe('restore-original')
    expect(vm.versionPreviewError).toContain('原操作查询服务')
    expect(vm.versionNotice).toBe('')
  })
})

/**
 * 右栏与飞书 1:1 对齐的 DOM 契约。
 *
 * 飞书历史面板的右栏条目是固定三行（时间 / 事件描述 / 作者），底栏「显示更改」是
 * 开关而不是说明文字。这两条都是纯 DOM 结构，只有真的把面板建出来才断言得到 ——
 * 上面那些 describe 走的都是纯函数，覆盖不到。
 */
describe('右栏飞书对齐的 DOM 契约', () => {
  const mountPanel = (hosted) => {
    const dom = new JSDOM('<div id="host"></div>')
    vi.stubGlobal('document', dom.window.document)
    const host = dom.window.document.querySelector('#host')
    const handlers = { onToggleShowChanges: vi.fn() }
    const panel = createVersionPanel({ host, handlers })
    return { dom, panel, handlers, update: extra => panel.update({ open: true, view: 'timeline',
      pager: { cursor: '编辑记录 2/2', prev: { disabled: false }, next: { disabled: true } },
      restore: { disabled: false }, ...hosted, ...extra }) }
  }

  it('时间线条目固定三行：时间 / 事件描述 / 作者，描述为空时节点仍在但不撑高', () => {
    const { dom, panel, update } = mountPanel({
      days: [{ key: '2026-11', label: '11月', groups: [
        { id: 'v2', head: { id: 'v2', name: '11月17日 10:00', desc: '最近更新', user: '张三' }, children: [] },
        { id: 'v1', head: { id: 'v1', name: '11月17日 09:00', desc: '', user: '李四' }, children: [] },
      ] }],
    })
    try {
      update()
      const items = panel.el.querySelectorAll('.lark-doc-version-item')
      expect(items).toHaveLength(2)
      const [newest, older] = items
      expect(newest.querySelector('.lark-doc-version-item-name').textContent).toBe('11月17日 10:00')
      // 飞书真身里「最近更新」就是这一行的文案，不是另挂的状态徽标（没有绿底块）。
      expect(newest.querySelector('.lark-doc-version-item-desc').textContent).toBe('最近更新')
      expect(newest.querySelector('.lark-doc-version-item-user').textContent).toBe('张三')
      // 空描述也要留节点：飞书同样是常驻节点靠高度 0 + 外边距自折叠维持 66 高，
      // 改成条件渲染会让两行条目的高度口径和真身分叉。
      expect(older.querySelector('.lark-doc-version-item-desc').textContent).toBe('')
      expect(older.querySelector('.lark-doc-version-item-user').textContent).toBe('李四')
      expect(items[0].children).toHaveLength(3)
      expect(items[1].children).toHaveLength(3)
    } finally { panel.destroy(); vi.unstubAllGlobals(); dom.window.close() }
  })

  it('「显示更改」是 role=switch 的开关，状态走 aria-checked 且可点击回调', () => {
    const { dom, panel, handlers, update } = mountPanel({ showChanges: true })
    try {
      update()
      const toggle = panel.el.querySelector('.lark-doc-version-changes-switch')
      expect(toggle).not.toBeNull()
      expect(toggle.getAttribute('role')).toBe('switch')
      expect(toggle.getAttribute('aria-label')).toBe('显示更改')
      expect(toggle.getAttribute('aria-checked')).toBe('true')
      expect(toggle.classList.contains('on')).toBe(true)
      toggle.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
      expect(handlers.onToggleShowChanges).toHaveBeenCalledTimes(1)
      // 关：滑块回左、语义同步；差异行与改动清单一起让位。
      update({ showChanges: false, preview: { id: 'v2', title: 'A', diff: { row: '新增 1 个块' }, changes: [{ kind: 'add', path: '/content/0', after: {} }] } })
      expect(toggle.getAttribute('aria-checked')).toBe('false')
      expect(toggle.classList.contains('on')).toBe(false)
      expect(panel.el.querySelector('.lark-doc-version-diff')).toBeNull()
      expect(panel.el.querySelector('.lark-doc-version-changes')).toBeNull()
    } finally { panel.destroy(); vi.unstubAllGlobals(); dom.window.close() }
  })

  it('返回按钮带「返回文档」文字，翻页是「上一页 / 下一页」而不是「上一版本」', () => {
    const { dom, panel, update } = mountPanel({})
    try {
      update()
      expect(panel.el.querySelector('.lark-doc-version-back-label').textContent).toBe('返回文档')
      const steps = [...panel.el.querySelectorAll('.lark-doc-version-step')].map(node => node.textContent)
      expect(steps).toEqual(['上一页', '下一页'])
      expect(panel.el.querySelector('.lark-doc-version-right-title').textContent).toBe('历史记录')
      // ⓘ 只是说明图标，不是可点控件。
      expect(panel.el.querySelector('.lark-doc-version-right-info').getAttribute('role')).toBe('img')
    } finally { panel.destroy(); vi.unstubAllGlobals(); dom.window.close() }
  })

  it('整月条目一次性铺开，没有「先给三条 + 更多历史」的截断', () => {
    const nodes = Array.from({ length: 4 }, (_, index) => ({
      id: `v${index}`,
      head: { id: `v${index}`, name: `条目 ${index}`, desc: '', user: '张三' },
      children: [],
    }))
    const { dom, panel, update } = mountPanel({ days: [{ key: '2026-11', label: '11月', groups: nodes }] })
    try {
      update()
      // 飞书（`hist_i_select2.png`）一个月 11 条全在，没有折叠闸门。
      expect(panel.el.querySelectorAll('.lark-doc-version-item')).toHaveLength(4)
      expect(panel.el.querySelector('.lark-doc-version-more-history')).toBeNull()
      // 月份标题是纯文字分组头，不是可点按钮。
      const label = panel.el.querySelector('.lark-doc-version-day-label')
      expect(label.tagName).toBe('DIV')
      expect(label.textContent).toBe('11月')
    } finally { panel.destroy(); vi.unstubAllGlobals(); dom.window.close() }
  })

  /* ——— 父子折叠（009 C4）：三角只在有子项时出现；三角管折叠，行管选中 ——— */

  const foldDays = () => [{
    key: '2026-11', label: '11月', groups: [
      {
        id: 'g1',
        head: { id: 'v3', name: '11月17日 10:00', desc: '', user: '张三' },
        children: [
          { id: 'v3', name: '11月17日 10:00', desc: '', user: '张三' },
          { id: 'v2', name: '11月17日 09:58', desc: '', user: '张三' },
        ],
      },
      { id: 'v1', head: { id: 'v1', name: '11月16日 20:00', desc: '', user: '李四' }, children: [] },
    ],
  }]

  it('默认全折叠：只铺父行，三角朝向折叠态（不写 is-open）', () => {
    const { dom, panel, update } = mountPanel({ days: foldDays() })
    try {
      update()
      expect(panel.el.querySelectorAll('.lark-doc-version-item')).toHaveLength(2)
      const toggle = panel.el.querySelector('.lark-doc-version-item-toggle')
      expect(toggle).not.toBeNull()
      expect(toggle.classList.contains('is-open')).toBe(false)
      expect(toggle.querySelector('svg')).not.toBeNull()
      // 三角没有 tooltip 文案（真身面板内 title/aria-label 探测为空）。
      expect(toggle.hasAttribute('title')).toBe(false)
      expect(toggle.getAttribute('aria-hidden')).toBe('true')
      expect(panel.el.querySelector('.lark-doc-version-item.has-children').getAttribute('aria-expanded')).toBe('false')
    } finally { panel.destroy(); vi.unstubAllGlobals(); dom.window.close() }
  })

  it('无子的组不出现三角（飞书 type 1/3 没有 minor_history 可折叠）', () => {
    const { dom, panel, update } = mountPanel({ days: foldDays() })
    try {
      update()
      // 两颗条目里只有第一颗有三角。
      expect(panel.el.querySelectorAll('.lark-doc-version-item-toggle')).toHaveLength(1)
      expect(panel.el.querySelectorAll('.lark-doc-version-item.has-padding')).toHaveLength(0)
    } finally { panel.destroy(); vi.unstubAllGlobals(); dom.window.close() }
  })

  it('点三角 = 展开（子行带 has-padding 缩进、三角转 90°），再点收回，全程不选中', () => {
    const { dom, panel, update } = mountPanel({ days: foldDays() })
    try {
      update()
      const group = panel.el.querySelector('.lark-doc-version-group')
      group.querySelector('.lark-doc-version-item-toggle').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
      // 父行 1 + 子行 2 = 3，同一组的容器没被整体重建掉顺序。
      expect(panel.el.querySelectorAll('.lark-doc-version-group')[0].querySelectorAll('.lark-doc-version-item')).toHaveLength(3)
      const padded = panel.el.querySelectorAll('.lark-doc-version-item.has-padding')
      expect([...padded].map(row => row.querySelector('.lark-doc-version-item-name').textContent))
        .toEqual(['11月17日 10:00', '11月17日 09:58'])
      expect(panel.el.querySelector('.lark-doc-version-item-toggle').classList.contains('is-open')).toBe(true)
      // 折叠是折叠、选中是选中：三角拦住了冒泡，父行的选中回调一次都不该响。
      expect(panel.el.querySelector('.lark-doc-version-item.has-children').getAttribute('aria-expanded')).toBe('true')
      // 再点一次收回。
      panel.el.querySelector('.lark-doc-version-item-toggle').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
      expect(panel.el.querySelectorAll('.lark-doc-version-item')).toHaveLength(2)
      expect(panel.el.querySelector('.lark-doc-version-item-toggle').classList.contains('is-open')).toBe(false)
    } finally { panel.destroy(); vi.unstubAllGlobals(); dom.window.close() }
  })

  it('点父行（组头）是选中并回传它自己的 id，不折叠', () => {
    const onSelect = vi.fn()
    const dom = new JSDOM('<div id="host"></div>')
    vi.stubGlobal('document', dom.window.document)
    const host = dom.window.document.querySelector('#host')
    const panel = createVersionPanel({ host, handlers: { onSelect } })
    try {
      panel.update({ open: true, view: 'timeline', days: foldDays(), pager: { cursor: '', prev: {}, next: {} }, restore: {} })
      panel.el.querySelector('.lark-doc-version-item.has-children').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
      // 组头就是 `minor_history[0]` 那条版本 —— 打开面板时自动选中的正是它，必须点得到。
      expect(onSelect).toHaveBeenLastCalledWith('v3')
      // 行没折叠：子行一个都没铺出来。
      expect(panel.el.querySelectorAll('.lark-doc-version-item')).toHaveLength(2)
    } finally { panel.destroy(); vi.unstubAllGlobals(); dom.window.close() }
  })

  it('点子行是选中并回传 id；无三角的父行点自己也选中', () => {
    const onSelect = vi.fn()
    const dom = new JSDOM('<div id="host"></div>')
    vi.stubGlobal('document', dom.window.document)
    const host = dom.window.document.querySelector('#host')
    const panel = createVersionPanel({ host, handlers: { onSelect } })
    try {
      panel.update({ open: true, view: 'timeline', days: foldDays(), pager: { cursor: '', prev: {}, next: {} }, restore: {} })
      panel.el.querySelector('.lark-doc-version-item-toggle').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
      panel.el.querySelectorAll('.lark-doc-version-item.has-padding')[1].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
      expect(onSelect).toHaveBeenLastCalledWith('v2')
      panel.el.querySelectorAll('.lark-doc-version-item.has-children')[0].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
      expect(onSelect).toHaveBeenLastCalledWith('v3')
    } finally { panel.destroy(); vi.unstubAllGlobals(); dom.window.close() }
  })
})
