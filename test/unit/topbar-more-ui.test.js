/**
 * 顶栏「更多」菜单（requirements/04 §4.2.1 项序 + §4.2 像素规格）。
 *
 * 只测**不碰 DOM** 的部分：清单结构、分隔线分组、子面板归属、定位纯函数、动作分发。
 * 面板 DOM 与像素交给 `scripts/verify-browser-*.js`，这里不掺和。
 *
 * 为什么要为「一张菜单清单」写这么多断言：这份清单是 23 项手抄自真机快照的，
 * 抄错一项（漏 `查看已存版本`、或多抄 5 项离屏菜单）在 UI 上**只会少/多一行**，
 * 没有任何报错 —— 只有在这里写成不变量才拦得住。
 */
import { describe, expect, it } from 'vitest'
import topbarMoreMixin, {
  TOPBAR_MORE_CAPABILITY,
  TOPBAR_MORE_DIVIDER_AFTER,
  TOPBAR_MORE_ITEMS,
  TOPBAR_MORE_READONLY_DISABLED,
  TOPBAR_MORE_SUBPANELS,
  topbarMoreHasArrow,
  topbarMoreMenuStyle,
  topbarMoreRows,
  topbarMoreSubmenuStyle,
} from '../../src/components/lark-doc/editor/topbarMoreMixin'

const ids = TOPBAR_MORE_ITEMS.map((item) => item.id)
const idAt = (id) => ids.indexOf(id)

/**
 * 造一个能调 mixin 方法的假 `this`。
 *
 * `$nextTick` 同步执行，但**必须绑回 ctx**：Vue 调 `$nextTick(this.measureX)` 时靠
 * 实例把 `this` 带进去，裸函数引用在这里会丢接收者（ESM 严格模式下 `this` 是 undefined）。
 * 绑定后 `measure*` 读到空 `$refs` 走早退分支，等价「组件还没渲染完」。
 */
function mixinCtx(extra = {}) {
  const emitted = []
  const ctx = {
    // data() 的初值必须落进来：`topbarMoreOpen` / `topbarMoreSubmenu` 是这些方法的
    // 判据（未初始化时是 undefined，断言「点一下变 true」就会假绿）。
    ...topbarMoreMixin.data(),
    emitted,
    $emit: (name, payload) => { emitted.push({ name, payload }) },
    $refs: {},
    ...extra,
  }
  ctx.$nextTick = (fn) => (typeof fn === 'function' ? fn.call(ctx) : undefined)
  const methods = topbarMoreMixin.methods
  Object.keys(methods).forEach((key) => {
    if (typeof ctx[key] !== 'function') ctx[key] = methods[key]
  })
  return ctx
}

/** 把所有宿主能力记成 spy 的上下文 —— 用来断言「action 打到哪一个宿主方法」。 */
function hostCtx(extra = {}) {
  const calls = []
  const record = (name) => (...args) => { calls.push([name, ...args]) }
  const ctx = mixinCtx({
    toggleSlides: record('toggleSlides'),
    openSearch: record('openSearch'),
    setWidthMode: record('setWidthMode'),
    openExportDialog: record('openExportDialog'),
    openSaveVersionDialog: record('openSaveVersionDialog'),
    openVersionPanel: record('openVersionPanel'),
    toggleSharePopover: record('toggleSharePopover'),
    openPermissionDialog: record('openPermissionDialog'),
    printDocument: record('printDocument'),
    ...extra,
  })
  ctx.calls = calls
  return ctx
}

describe('顶栏更多 · 清单结构（§4.2.1 逐字）', () => {
  it('一级菜单是 23 项，id 唯一，order 连续 1..23', () => {
    expect(TOPBAR_MORE_ITEMS).toHaveLength(23)
    expect(new Set(ids).size).toBe(23)
    TOPBAR_MORE_ITEMS.forEach((item, index) => {
      expect(item.order).toBe(index + 1)
    })
  })

  it('「查看已存版本」是独立一级项，夹在「另存为版本」与「文档权限」之间', () => {
    expect(ids).toContain('view-versions')
    expect(idAt('view-versions')).toBe(idAt('save-version') + 1)
    expect(idAt('view-versions')).toBe(idAt('doc-permission') - 1)
  })

  it('§4.2 的 5 项离屏菜单（上传日志/联系客服/功能更新/帮助中心/快捷键）不在一级菜单里', () => {
    for (const banned of ['upload-log', 'contact', 'changelog', 'help', 'shortcuts']) {
      expect(ids).not.toContain(banned)
    }
    // 「添加快捷方式到」是正文里真有的项，别和上面那条一起被误删。
    expect(ids).toContain('shortcut')
  })

  it('首项「页宽设置」、末项「删除」——顺序由 order 守，不由数组位置守', () => {
    expect(TOPBAR_MORE_ITEMS[0].id).toBe('width')
    expect(TOPBAR_MORE_ITEMS[22].id).toBe('delete')
  })

  it('分隔线 8 条：每个 id 都真在清单里，且数量随 23 项口径（22 项是 9 条）', () => {
    expect(TOPBAR_MORE_DIVIDER_AFTER).toHaveLength(8)
    for (const id of TOPBAR_MORE_DIVIDER_AFTER) expect(ids).toContain(id)
    // 单列「打印」组只有一项，所以相邻分隔线允许只差 1 —— 这里守的是「严格递增、
    // 无重复」，也就是不会出现两条线连在一起（连在一起会画出双线）。
    const positions = TOPBAR_MORE_DIVIDER_AFTER.map(idAt)
    positions.forEach((pos, i) => {
      if (i > 0) expect(pos).toBeGreaterThan(positions[i - 1])
    })
  })

  it('不在末项后画线 —— 末项「删除」就是危险区组的收尾，再画一条会拖出空尾', () => {
    expect(TOPBAR_MORE_DIVIDER_AFTER).not.toContain('delete')
    expect(TOPBAR_MORE_DIVIDER_AFTER).not.toContain('')
  })
})

describe('顶栏更多 · 子菜单归属（kind 与子面板必须一一对应）', () => {
  it('5 个 kind=submenu 的项，每个都能在 SUBPANELS 里取到非空中面板', () => {
    const submenus = TOPBAR_MORE_ITEMS.filter((item) => item.kind === 'submenu').map((item) => item.id)
    expect(submenus.sort()).toEqual(Object.keys(TOPBAR_MORE_SUBPANELS).sort())
    for (const id of submenus) expect(TOPBAR_MORE_SUBPANELS[id].length).toBeGreaterThan(0)
  })

  it('「翻译为英语」是 route（有箭头无面板、点击即执行），不能被当成 submenu', () => {
    const item = TOPBAR_MORE_ITEMS[idAt('translate')]
    expect(item.kind).toBe('route')
    expect(item.affordance).toBe('arrow')
    expect(TOPBAR_MORE_SUBPANELS.translate).toBeUndefined()
  })

  it('带箭头的项 = 5 个 submenu + 1 个 route，共 6 个；其余一律无箭头', () => {
    const arrows = TOPBAR_MORE_ITEMS.filter((item) => topbarMoreHasArrow(item)).map((item) => item.id)
    expect(arrows).toEqual(['width', 'download-as', 'translate', 'view-versions', 'doc-permission', 'more'])
  })

  it('子面板项 id 在各自面板内唯一（模板用 id 做 key，撞了会渲染错行）', () => {
    Object.keys(TOPBAR_MORE_SUBPANELS).forEach((key) => {
      const list = TOPBAR_MORE_SUBPANELS[key].map((entry) => entry.id)
      expect(new Set(list).size).toBe(list.length)
    })
  })

  it('页宽三档映射内核 widthMode：standard / wide / full', () => {
    expect(TOPBAR_MORE_SUBPANELS.width.map((entry) => entry.id)).toEqual(['standard', 'wide', 'full'])
  })

  it('权限面板含一条 divider 行，且它不参与动作分发', () => {
    const divider = TOPBAR_MORE_SUBPANELS['doc-permission'].filter((entry) => entry.kind === 'divider')
    expect(divider).toHaveLength(1)
    expect(divider[0].action).toBeUndefined()
  })
})

describe('顶栏更多 · 启用态表', () => {
  it('只读置灰项与 capability 项的 id 都在清单里（拼错不会被 JS 报错）', () => {
    for (const id of TOPBAR_MORE_READONLY_DISABLED) expect(ids).toContain(id)
    for (const id of Object.keys(TOPBAR_MORE_CAPABILITY)) expect(ids).toContain(id)
  })

  it('「更多」子面板里的两个 switch 项被认出来（只翻本地态，不关菜单）', () => {
    const switches = TOPBAR_MORE_SUBPANELS.more.filter((entry) => entry.kind === 'switch')
    expect(switches.map((entry) => entry.id)).toEqual(['show-author', 'offline'])
  })
})

describe('顶栏更多 · 定位纯函数', () => {
  it('一级菜单：右缘对齐锚点右缘、下方 4px', () => {
    const anchor = { left: 1235, top: 40, right: 1251, bottom: 56 }
    const style = topbarMoreMenuStyle(anchor, { width: 175, height: 620 }, { width: 1440, height: 900 })
    expect(style.left).toBe(1251 - 175)
    expect(style.top).toBe(60)
  })

  it('右侧放不下时向左夹 8px（不溢出视口）', () => {
    const anchor = { left: 1420, top: 40, right: 1440, bottom: 56 }
    const style = topbarMoreMenuStyle(anchor, { width: 175, height: 620 }, { width: 1440, height: 900 })
    expect(style.left).toBe(1440 - 175 - 8)
  })

  it('下方放不下且上方放得下 → 翻到上方（仍留 4px 间隙）', () => {
    const anchor = { left: 100, top: 700, right: 120, bottom: 720 }
    const style = topbarMoreMenuStyle(anchor, { width: 175, height: 200 }, { width: 1440, height: 800 })
    expect(style.top).toBe(700 - 200 - 4)
  })

  it('上下都放不下时不翻（翻了会露出视口顶部之外，宁可让下方裁切）', () => {
    const anchor = { left: 100, top: 100, right: 120, bottom: 120 }
    const style = topbarMoreMenuStyle(anchor, { width: 175, height: 700 }, { width: 1440, height: 800 })
    expect(style.top).toBe(124)
  })

  it('缺锚点 / 缺尺寸时返回原点，不抛', () => {
    expect(topbarMoreMenuStyle(null, { width: 175, height: 620 }, { width: 1440, height: 900 })).toEqual({ left: 0, top: 0 })
    expect(topbarMoreMenuStyle({ right: 100, bottom: 10 }, null, { width: 1440, height: 900 })).toEqual({ left: 0, top: 0 })
  })

  it('子面板：零间隙贴靠主菜单右缘（§4.2 ④-4，不是 +4）', () => {
    const style = topbarMoreSubmenuStyle(
      { left: 1073, top: 60, right: 1248 },
      { top: 200, height: 32 },
      { width: 120, height: 108 },
      { width: 1440, height: 900 },
    )
    expect(style.left).toBe(1248)
    expect(style.top).toBe(198)
  })

  it('子面板右侧溢出时翻到主菜单左侧', () => {
    const style = topbarMoreSubmenuStyle(
      { left: 1300, top: 60, right: 1440 },
      { top: 200, height: 32 },
      { width: 198, height: 142 },
      { width: 1440, height: 900 },
    )
    expect(style.left).toBe(1300 - 198)
  })

  it('子面板贴底时被上提，且永不越过视口顶部 8px', () => {
    const style = topbarMoreSubmenuStyle(
      { left: 100, top: 60, right: 220 },
      { top: 880, height: 32 },
      { width: 120, height: 108 },
      { width: 1440, height: 900 },
    )
    expect(style.top + 108).toBeLessThanOrEqual(900 - 8)
    expect(style.top).toBeGreaterThanOrEqual(8)
  })
})

describe('顶栏更多 · 渲染行', () => {
  it('行数 = 23 项 + 8 条分隔线，且分隔线紧跟在被标记的项之后', () => {
    const rows = topbarMoreRows()
    expect(rows).toHaveLength(31)
    expect(rows[0]).toEqual({ kind: 'item', item: TOPBAR_MORE_ITEMS[0] })
    expect(rows[1].kind).toBe('item')
    // slides 之后是第一条分隔线。
    expect(rows[2]).toEqual({ kind: 'divider', id: 'divider-slides' })
  })

  it('分隔线不占 order（项序断言不受插入影响）', () => {
    const orders = topbarMoreRows()
      .filter((row) => row.kind === 'item')
      .map((row) => row.item.order)
    expect(orders).toEqual(Array.from({ length: 23 }, (_, i) => i + 1))
  })

  it('分隔线 id 互不相同（模板拿它当 key）', () => {
    const dividers = topbarMoreRows().filter((row) => row.kind === 'divider').map((row) => row.id)
    expect(new Set(dividers).size).toBe(dividers.length)
  })
})

describe('顶栏更多 · 开关与子面板交互', () => {
  it('同一按钮二次点击即收起（与分享 popover 同口径）', () => {
    const ctx = mixinCtx({ topbarMoreOpen: false })
    const event = { currentTarget: { getBoundingClientRect: () => ({ left: 1, top: 2, right: 3, bottom: 4 }) } }
    ctx.toggleTopbarMore(event)
    expect(ctx.topbarMoreOpen).toBe(true)
    ctx.toggleTopbarMore(event)
    expect(ctx.topbarMoreOpen).toBe(false)
    expect(ctx.topbarMoreSubmenu).toBe('')
  })

  it('拿不到触发按钮 rect 时不打开（宁可不弹，也不弹到 0,0）', () => {
    const ctx = mixinCtx()
    ctx.toggleTopbarMore({})
    ctx.toggleTopbarMore(null)
    expect(ctx.topbarMoreOpen).toBe(false)
  })

  it('submenu 项点击切换子面板，再点同一个收起；普通项立即执行', () => {
    const ctx = hostCtx()
    ctx.topbarMoreOpen = true
    ctx.onTopbarMoreItem(TOPBAR_MORE_ITEMS[idAt('download-as')])
    expect(ctx.topbarMoreSubmenu).toBe('download-as')
    ctx.onTopbarMoreItem(TOPBAR_MORE_ITEMS[idAt('download-as')])
    expect(ctx.topbarMoreSubmenu).toBe('')
    ctx.onTopbarMoreItem(TOPBAR_MORE_ITEMS[idAt('print')])
    expect(ctx.calls).toContainEqual(['printDocument'])
  })

  it('禁用项（enabled=false）点了什么都不做 —— 不执行也不抛事件', () => {
    const ctx = hostCtx()
    ctx.onTopbarMoreItem({ id: 'print', label: '打印', kind: 'item', enabled: false, action: 'print' })
    ctx.onTopbarMoreItem(null)
    expect(ctx.calls).toEqual([])
    expect(ctx.emitted).toEqual([])
  })

  it('hover 只对 submenu 生效，且不会重复展开同一个', () => {
    const ctx = mixinCtx()
    ctx.hoverTopbarMoreItem(TOPBAR_MORE_ITEMS[idAt('print')])
    expect(ctx.topbarMoreSubmenu).toBe('')
    ctx.hoverTopbarMoreItem(TOPBAR_MORE_ITEMS[idAt('more')])
    ctx.hoverTopbarMoreItem(TOPBAR_MORE_ITEMS[idAt('more')])
    expect(ctx.topbarMoreSubmenu).toBe('more')
  })

  it('switch 项只翻本地态并抛事件，菜单保持打开（与飞书 Switch 同行为）', () => {
    const ctx = mixinCtx({ topbarMoreOpen: true })
    ctx.onTopbarMoreSubmenuItem({ id: 'show-author', kind: 'switch', action: 'more.show-author' })
    expect(ctx.topbarMoreShowAuthor).toBe(true)
    expect(ctx.topbarMoreOpen).toBe(true)
    expect(ctx.emitted).toEqual([{ name: 'topbar-more', payload: { action: 'more.show-author', on: true } }])
    ctx.onTopbarMoreSubmenuItem({ id: 'offline', kind: 'switch', action: 'more.offline' })
    expect(ctx.topbarMoreOffline).toBe(true)
    expect(ctx.topbarMoreShowAuthor).toBe(true)
  })
})

describe('顶栏更多 · action 分发（哪些真接了线，一眼数得清）', () => {
  it('逐个打到对应宿主方法，且先关菜单', () => {
    const cases = [
      ['slides', ['toggleSlides']],
      ['find', ['openSearch', 'find']],
      ['width.full', ['setWidthMode', 'full']],
      ['width.standard', ['setWidthMode', 'standard']],
      ['width.wide', ['setWidthMode', 'wide']],
      ['export.pdf', ['openExportDialog', 'pdf']],
      ['export.word', ['openExportDialog', 'word']],
      ['export.markdown', ['openExportDialog', 'markdown']],
      ['save-version', ['openSaveVersionDialog']],
      ['version.open', ['openVersionPanel']],
      ['permission.settings', ['openPermissionDialog']],
      ['print', ['printDocument']],
    ]
    for (const [action, expected] of cases) {
      const ctx = hostCtx({ topbarMoreOpen: true })
      ctx.runTopbarMoreAction(action, { id: action })
      expect(ctx.calls).toContainEqual(expected)
      expect(ctx.topbarMoreOpen).toBe(false)
    }
  })

  it('permission.manage 走分享 popover，且宿主没实现时不炸', () => {
    const ctx = hostCtx({ topbarMoreOpen: true })
    ctx.runTopbarMoreAction('permission.manage', {})
    expect(ctx.calls).toContainEqual(['toggleSharePopover', null])

    const bare = mixinCtx({ topbarMoreOpen: true })
    bare.runTopbarMoreAction('permission.manage', {})
    expect(bare.topbarMoreOpen).toBe(false)
  })

  it('未接线的能力一律抛给宿主并收起（无数据时静默失败，不弹空框）', () => {
    const ctx = hostCtx({ topbarMoreOpen: true })
    ctx.runTopbarMoreAction('history', { id: 'history' })
    expect(ctx.calls).toEqual([])
    expect(ctx.emitted).toEqual([{ name: 'topbar-more', payload: { action: 'history', item: { id: 'history' } } }])
    expect(ctx.topbarMoreOpen).toBe(false)
  })

  it('打印走浏览器原生能力，不抛给宿主', () => {
    const ctx = hostCtx({ topbarMoreOpen: true, printDocument: () => { ctx.printed = true } })
    ctx.runTopbarMoreAction('print', {})
    expect(ctx.printed).toBe(true)
    expect(ctx.emitted).toEqual([])
  })
})

describe('顶栏更多 · 命中判定', () => {
  it('菜单本体与触发按钮都算「菜单内」，其余不算', () => {
    const ctx = mixinCtx()
    // 真实选择器是逗号连接的复合串，替身要按「命中其中任意一个」判定。
    const inside = (selector) => ({
      closest: (sel) => (String(sel).split(',').some((part) => part.trim() === selector) ? {} : null),
    })
    expect(ctx.topbarMoreContains(inside('.lark-doc-topbar-more'))).toBe(true)
    expect(ctx.topbarMoreContains(inside('.lark-doc-more-btn'))).toBe(true)
    expect(ctx.topbarMoreContains(inside('.lark-doc-other'))).toBe(false)
    expect(ctx.topbarMoreContains(null)).toBe(false)
  })
})
