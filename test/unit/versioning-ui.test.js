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
import { describe, expect, it } from 'vitest'
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

/* ---------------- 脚手架 ---------------- */

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
