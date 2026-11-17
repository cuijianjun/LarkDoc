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
  SNAPSHOT_LABEL_MAX,
  createMemoryVersioningProvider,
} from '../../src/core/versioning/index'
import {
  VERSIONING_CURSOR_LABEL,
  VERSIONING_DAY_LABELS,
  VERSIONING_ERROR_TEXT,
  VERSION_KIND_LABELS,
  currentProjection,
  defaultVersionLabel,
  describeVersionDiff,
  formatVersionClock,
  formatVersionDayLabel,
  formatVersionTime,
  groupVersionsByDay,
  historyDiffSummary,
  recordMetrics,
  versionCapabilityGate,
  versioningErrorMessage,
} from '../../src/components/lark-doc/editor/versioningMixin'
import versioningMixin from '../../src/components/lark-doc/editor/versioningMixin'
import { createVersioningPresentation } from '../../src/components/lark-doc/editor/versioningPresentation'

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
    const gate = vi.fn(), errorText = vi.fn(), confirmation = vi.fn(), defaultLabel = vi.fn(), ordinal = vi.fn()
    const presentation = createVersioningPresentation({ versionCapabilityGate: gate, versioningErrorMessage: errorText,
      confirmedVersionResult: confirmation, defaultVersionLabel: defaultLabel, nextVersionOrdinal: ordinal, SNAPSHOT_LABEL_MAX: 3 })
    expect(presentation.then).toBeUndefined()
    for (const helper of [gate, errorText, confirmation, defaultLabel, ordinal]) expect(helper).not.toHaveBeenCalled()
    const pending = Promise.resolve({ id: 'selected' }), selectVersion = vi.fn(() => pending)
    const host = { versionIndex: 1, versionTotal: 2, versionList: [{ id: 'first' }, { id: 'second' }], selectVersion,
      versionPrevDisabled: false, versionNextDisabled: false, stepVersion: vi.fn(() => pending) }
    expect(presentation.methods.versionNext.call(host)).toBe(pending)
    expect(host.stepVersion).toHaveBeenCalledExactlyOnceWith(1)
    const result = presentation.methods.stepVersion.call(host, 1)
    expect(host.versionIndex).toBe(2)
    expect(selectVersion).toHaveBeenCalledExactlyOnceWith('second')
    expect(await result).toEqual({ id: 'selected' })
    expect(presentation.methods.setSaveVersionName.call(host, 'abcdef')).toBeUndefined()
    expect(host.saveVersionName).toBe('abc')
  })

  it('keeps save busy immediate and ignores a late result after the live actor changes', async () => {
    let finish
    const write = vi.fn(() => new Promise(resolve => { finish = resolve }))
    const session = fakeSession({ provider: {} }); session.user = { id: 'first' }; session.createVersion = write
    const host = mountMixin({ session, saveVersionOpen: true, saveVersionName: 'original' })
    const result = host.confirmSaveVersion()
    expect(host.saveVersionBusy).toBe(true)
    expect(write).toHaveBeenCalledExactlyOnceWith({ label: 'original', title: undefined })
    session.user.id = 'second'
    finish({ id: 'committed-for-first' })
    expect(await result).toEqual({ id: 'committed-for-first' })
    expect(host.saveVersionOpen).toBe(true)
    expect(host.versionNotice).toBe('')
    expect(host.saveVersionBusy).toBe(false)
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
  const vm = Object.assign({}, versioningMixin.data(), state || {})
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

/* ---------------- 2. 列表排序与按天分组 ---------------- */

describe('按天分组（04 §3.4-C 时间线）', () => {
  it('provider.list() 保证新→旧，分组只切段不重排', async () => {
    const { list } = await listAcrossDays()
    expect(list.map((item) => item.id)).toEqual(['v2', 'v4', 'v3', 'v1'])
  })

  it('同一天连续归并成一组，跨天另起一组', async () => {
    const { list, now } = await listAcrossDays()
    const groups = groupVersionsByDay(list, now)
    expect(groups.map((group) => group.label)).toEqual(['今天', '昨天', '10月25日'])
    expect(groups[0].items.map((item) => item.id)).toEqual(['v2', 'v4'])
    expect(groups[1].items.map((item) => item.id)).toEqual(['v3'])
    expect(groups[2].items.map((item) => item.id)).toEqual(['v1'])
  })

  it('分组后条目总数不变，且不打散顺序（下标错位会把 A 的时间贴到 B 上）', async () => {
    const { list, now } = await listAcrossDays()
    const flat = []
    const groups = groupVersionsByDay(list, now)
    for (let i = 0; i < groups.length; i += 1) {
      for (let j = 0; j < groups[i].items.length; j += 1) flat.push(groups[i].items[j].id)
    }
    expect(flat).toEqual(list.map((item) => item.id))
  })

  it('缺失时间的条目单独归到「未知时间」，不掉进 1970-01-01', () => {
    const groups = groupVersionsByDay([
      { id: 'a', createdAt: Date.UTC(2026, 9, 27, 10, 0) },
      { id: 'b', createdAt: 0 },
    ], Date.UTC(2026, 9, 27, 12, 0))
    expect(groups.map((group) => group.label)).toEqual(['今天', VERSIONING_DAY_LABELS.unknown])
    expect(groups[1].items.map((item) => item.id)).toEqual(['b'])
  })

  it('空输入与非数组输入都返回空数组（面板右栏走降级而不是白屏）', () => {
    expect(groupVersionsByDay([], Date.now())).toEqual([])
    expect(groupVersionsByDay(null, Date.now())).toEqual([])
    expect(groupVersionsByDay(undefined, Date.now())).toEqual([])
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

    const denied = mountMixin({ session: fakeSession({ provider, capabilities: { canCreateVersion: false } }) })
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

  it('两个能力互相独立：只关 canCreateVersion 不影响 canRestoreVersion', () => {
    const session = fakeSession({ capabilities: { canCreateVersion: false } })
    const vm = mountMixin({ session })
    expect(computedOf(vm, 'versionCanCreate')).toBe(false)
    expect(computedOf(vm, 'versionCanRestore')).toBe(true)
    expect(computedOf(vm, 'versionCanCreateReason')).toBe('当前用户没有该操作的权限')
    expect(computedOf(vm, 'versionCanRestoreReason')).toBe('')
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

/* ---------------- 7. 另存为版本 Dialog ---------------- */

describe('另存为版本 Dialog（04 §3.4 ⑤-2）', () => {
  it('默认名是「{文档名} 第 {N} 版」，N = 当前版本数 + 1（实测只有一条样本，属推断）', () => {
    expect(defaultVersionLabel('/code', 1)).toBe('/code 第 1 版')
    expect(defaultVersionLabel('  ', 3)).toBe('未命名文档 第 3 版')
    expect(defaultVersionLabel(undefined, 0)).toBe('未命名文档 第 1 版')
  })

  it('计数是「已输入/1000」，且与 SNAPSHOT_LABEL_MAX 同源', () => {
    const vm = mountMixin({ saveVersionName: '/code 第 1 版' })
    expect(computedOf(vm, 'versionNameCounter')).toBe('11/1000')
    // 04 §⑤-2 实测：输入 4 个字后是 15/1000 —— 追加，不是全选替换。
    callOf(vm, 'setSaveVersionName', '/code 第 1 版abcd')
    expect(computedOf(vm, 'versionNameCounter')).toBe('15/1000')
    expect(computedOf(vm, 'versionNameMax')).toBe(SNAPSHOT_LABEL_MAX)
  })

  it('超长输入被截断到上限，不靠 maxlength 属性兜底', () => {
    const vm = mountMixin()
    callOf(vm, 'setSaveVersionName', 'x'.repeat(SNAPSHOT_LABEL_MAX + 50))
    expect(vm.saveVersionName.length).toBe(SNAPSHOT_LABEL_MAX)
    callOf(vm, 'setSaveVersionName', null)
    expect(vm.saveVersionName).toBe('')
  })

  it('Dialog 标题是「保存 今天 HH:mm 的文档版本」', () => {
    const vm = mountMixin()
    expect(computedOf(vm, 'saveVersionDialogTitle'))
      .toBe(`保存 ${VERSIONING_DAY_LABELS.today} ${formatVersionClock(Date.now())} 的文档版本`)
  })

  it('无 canCreateVersion 时开不了 Dialog，但入口照挂（置灰 + 直接 return，不隐藏）', () => {
    const denied = mountMixin({ session: fakeSession({ capabilities: { canCreateVersion: false } }) })
    expect(callOf(denied, 'openSaveVersionDialog')).toBe(false)
    expect(denied.saveVersionOpen).toBe(false)
    expect(denied.saveVersionError).toBe('当前用户没有该操作的权限')

    const allowed = mountMixin({ session: fakeSession(), localTitle: 'doc' })
    expect(callOf(allowed, 'openSaveVersionDialog')).toBe(true)
    expect(allowed.saveVersionOpen).toBe(true)
    expect(allowed.saveVersionName).toBe('doc 第 1 版')
  })

  it('kind 徽标三个值都有中文文案，未知 kind 退回「手动保存」而不是空串', () => {
    expect(VERSION_KIND_LABELS[SNAPSHOT_KIND.AUTO]).toBe('自动快照')
    expect(VERSION_KIND_LABELS[SNAPSHOT_KIND.MANUAL]).toBe('手动保存')
    expect(VERSION_KIND_LABELS[SNAPSHOT_KIND.RESTORE]).toBe('恢复产生')
    const vm = mountMixin()
    expect(callOf(vm, 'versionKindLabel', 'whatever')).toBe('手动保存')
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

  it('unknown保原op且不成功toast，再次保存只query原结果', async () => {
    let posts = 0, queries = 0
    const provider = { requiresDurableConfirmation: true, supportsRestore: false,
      queryOperation: async operationId => { queries++; return { status: 'committed', operationId, version: { status: 'durable' } } } }
    const session = fakeSession({ provider })
    session.createVersion = async () => { posts++; return { status: 'unknown', operationId: 'original-op' } }
    const vm = mountMixin({ session, saveVersionOpen: true, saveVersionName: 'A' })
    await callOf(vm, 'confirmSaveVersion')
    expect(vm.saveVersionOpen).toBe(true)
    expect(vm.versionNotice).toBe('')
    expect(vm.saveVersionOperationId).toBe('original-op')
    expect(vm.saveVersionError).toContain('待确认')
    vm.closeSaveVersionDialog()
    vm.openSaveVersionDialog()
    vm.saveVersionName = '不能另造此版本'
    await callOf(vm, 'confirmSaveVersion')
    expect(posts).toBe(1)
    expect(queries).toBe(1)
    expect(vm.saveVersionOperationId).toBe('')
    expect(vm.versionNotice).toContain('版本已保存')
  })

  it('remote provider未收到durable wrapper不成功，US8接线前恢复置灰', async () => {
    const provider = { requiresDurableConfirmation: true, supportsRestore: false }
    const session = fakeSession({ provider })
    session.createVersion = vi.fn(async () => ({ id: 'looks-like-version' }))
    const vm = mountMixin({ session, saveVersionOpen: true, saveVersionName: 'A', versionList: [{ id: 'v1' }], versionSelectedId: 'v1' })
    await callOf(vm, 'confirmSaveVersion')
    expect(vm.versionNotice).toBe('')
    expect(vm.saveVersionOpen).toBe(true)
    expect(vm.versionRestoreDisabled).toBe(true)
    await callOf(vm, 'confirmSaveVersion')
    expect(session.createVersion).toHaveBeenCalledTimes(1)
    expect(vm.saveVersionError).toContain('原操作查询服务')
  })

  it('保存待确认缺查询服务或查询返回异键均不重新 POST 或伪成功', async () => {
    const provider = { requiresDurableConfirmation: true }
    const session = fakeSession({ provider })
    session.createVersion = vi.fn(async () => ({ status: 'unknown', operationId: 'original-op' }))
    const vm = mountMixin({ session, saveVersionOpen: true, saveVersionName: 'A' })
    await vm.confirmSaveVersion()
    await vm.confirmSaveVersion()
    expect(vm.saveVersionError).toContain('原操作查询服务')
    expect(vm.saveVersionOperationId).toBe('original-op')
    provider.queryOperation = vi.fn(async () => ({ status: 'committed', operationId: 'wrong-op', version: { status: 'durable' } }))
    await vm.confirmSaveVersion()
    expect(provider.queryOperation).toHaveBeenCalledExactlyOnceWith('original-op')
    expect(session.createVersion).toHaveBeenCalledTimes(1)
    expect(vm.saveVersionOperationId).toBe('original-op')
    expect(vm.versionNotice).toBe('')
    expect(vm.saveVersionOpen).toBe(true)
  })

  it('待确认保存绑定原身份，代际改变后既不查询旧键也不新 POST', async () => {
    const provider = { requiresDurableConfirmation: true, queryOperation: vi.fn() }
    const session = fakeSession({ provider })
    session.createVersion = vi.fn(async () => ({ status: 'unknown', operationId: 'original-op' }))
    session._privateIdentityGeneration = 0
    const vm = mountMixin({ session, saveVersionOpen: true, saveVersionName: 'A' })
    await vm.confirmSaveVersion()
    session._privateIdentityGeneration += 1
    await vm.confirmSaveVersion()
    expect(provider.queryOperation).not.toHaveBeenCalled()
    expect(session.createVersion).toHaveBeenCalledTimes(1)
    expect(vm.saveVersionError).toContain('身份或文档已改变')
    expect(vm.versionNotice).toBe('')
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
