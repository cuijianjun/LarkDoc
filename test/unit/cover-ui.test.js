/**
 * 文档封面（requirements/04 §1.4 / §1.4.1 / §1.4.2 / §1.4.3）。
 *
 * 这里守的四条都是**错了不报错、只是慢慢变歪**的事：
 *   1. 三项面板按 **id** 派发而不是下标 —— §1.4.3 红字记录的事故就是「取最后一项」
 *      把封面删了（batch425）；
 *   2. 面板 162×126、图库 542×522 是**同一个 wrapper 原地扩展**，不是两个弹窗；
 *   3. 封面色一律是 `--ld-cover-*` token 引用，不出现字面 hex（check-theme-tokens 会拦
 *      组件里的字面色，但**不会**拦 token 引用写错 —— 这里补上那半边）；
 *   4. 点「添加封面」立刻落默认灰封面，不需要先选图（§1.4.1）。
 */
import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import coverMixin, {
  COVER_DEFAULT_BG,
  COVER_GALLERY_SIZE,
  COVER_HEIGHT,
  COVER_PANEL_ITEMS,
  COVER_PANEL_SIZE,
  COVER_PRESETS,
  COVER_THUMB_SIZE,
  coverImageStyle,
  coverPanelStyle,
} from '../../src/components/lark-doc/editor/coverMixin'

function mixinCtx(extra = {}) {
  const emitted = []
  const ctx = {
    ...coverMixin.data(),
    // prop `cover` 默认是 undefined ⇒ 走内部草稿；测试里显式传 null / 对象覆盖。
    cover: undefined,
    emitted,
    $emit: (name, payload) => { emitted.push({ name, payload }) },
    // 图库态要量 `coverPanel` 的真实宽度，替身里给它一个壳即可。
    $refs: { coverPanel: {} },
    ...extra,
  }
  ctx.$nextTick = (fn) => (typeof fn === 'function' ? fn.call(ctx) : undefined)
  // ⚠️ 方法一律 bind 到 ctx：`openCoverGallery` 里 `$nextTick(this.measureCoverGallery)`
  // 交出去的是**裸函数引用**，Vue 在真实组件上会自动绑 this，替身不绑就会丢接收者。
  const methods = coverMixin.methods
  Object.keys(methods).forEach((key) => {
    if (typeof ctx[key] !== 'function') ctx[key] = methods[key].bind(ctx)
  })
  // ⚠️ computed 必须也挂上：`startCoverReposition` / `pickCover` / `confirmCoverReposition`
  // 内部都是读 `this.coverValue`，只合 methods 会让它们一律走进「没封面」分支，
  // 表现为「不报错但什么都不发生」—— 这类假绿比红更危险。
  Object.keys(coverMixin.computed).forEach((key) => {
    Object.defineProperty(ctx, key, {
      configurable: true,
      enumerable: true,
      get: () => coverMixin.computed[key].call(ctx),
    })
  })
  return ctx
}

beforeEach(() => {
  globalThis.window = { innerWidth: 1440, innerHeight: 900 }
})

afterEach(() => {
  delete globalThis.window
})

describe('封面 · 几何常量', () => {
  it('槽高 283；三项面板 162×126；图库 542×522；缩略图 118×64', () => {
    expect(COVER_HEIGHT).toBe(283)
    expect(COVER_PANEL_SIZE).toEqual({ width: 162, height: 126 })
    expect(COVER_GALLERY_SIZE).toEqual({ width: 542, height: 522 })
    expect(COVER_THUMB_SIZE).toEqual({ width: 118, height: 64 })
  })

  it('三项顺序固定且带 id（按下标取曾删掉过封面）', () => {
    expect(COVER_PANEL_ITEMS.map((item) => item.id)).toEqual(['pick', 'reposition', 'remove'])
    expect(COVER_PANEL_ITEMS.map((item) => item.label)).toEqual(['选择图片', '调整图片位置', '移除封面'])
  })

  it('12 张预设，id 唯一', () => {
    expect(COVER_PRESETS).toHaveLength(12)
    expect(new Set(COVER_PRESETS.map((entry) => entry.id)).size).toBe(12)
  })

  it('所有色值都是 token 引用，没有一处字面 hex（与 check-theme-tokens 互补）', () => {
    expect(COVER_DEFAULT_BG).toBe('var(--ld-cover-default)')
    for (const entry of COVER_PRESETS) {
      expect(entry.from).toBe(`var(--ld-cover-${entry.id}-from)`)
      expect(entry.to).toBe(`var(--ld-cover-${entry.id}-to)`)
      expect(/#[0-9a-fA-F]{3,8}/.test(entry.from + entry.to)).toBe(false)
    }
  })
})

describe('封面 · 背景样式', () => {
  it('无封面：只给默认灰底，没有 backgroundImage', () => {
    expect(coverImageStyle(null)).toEqual({ backgroundColor: COVER_DEFAULT_BG })
    expect(coverImageStyle(undefined)).toEqual({ backgroundColor: COVER_DEFAULT_BG })
  })

  it('默认灰封面（preset 为 null）也只给底色 —— 落封面不需要先选图', () => {
    expect(coverImageStyle({ preset: null, offset: 50 })).toEqual({ backgroundColor: COVER_DEFAULT_BG })
  })

  it('预设：135° 渐变 + `center <offset>%`，offset 缺省 50', () => {
    const style = coverImageStyle({ preset: 'aurora' })
    expect(style.backgroundImage).toBe('linear-gradient(135deg, var(--ld-cover-aurora-from) 0%, var(--ld-cover-aurora-to) 100%)')
    expect(style.backgroundPosition).toBe('center 50%')
    expect(style.backgroundSize).toBe('cover')
    expect(coverImageStyle({ preset: 'ocean', offset: 20 }).backgroundPosition).toBe('center 20%')
  })

  it('本地上传的 data URL 优先于 preset（上传写的是 `{ preset: null, url }`）', () => {
    const style = coverImageStyle({ preset: 'aurora', url: 'data:image/png;base64,AAA', offset: 30 })
    expect(style.backgroundImage).toBe('url("data:image/png;base64,AAA")')
    expect(style.backgroundPosition).toBe('center 30%')
  })

  it('未知 preset id 退回灰底，不产生 `undefined` 进 CSS', () => {
    const style = coverImageStyle({ preset: 'not-a-preset', offset: 50 })
    expect(style).toEqual({ backgroundColor: COVER_DEFAULT_BG })
  })
})

describe('封面 · 面板定位', () => {
  it('右缘对齐锚点右缘、顶部 = 锚点底 + 5（§1.4.2 实测 309+30+5）', () => {
    const style = coverPanelStyle({ left: 1400, top: 309, right: 1448, bottom: 339 }, COVER_PANEL_SIZE, { width: 1512, height: 900 })
    expect(style.left).toBe(1448 - 162)
    expect(style.top).toBe(344)
  })

  it('贴视口右侧时向内夹 8px（窄屏也开得出来）', () => {
    const style = coverPanelStyle({ left: 1500, top: 309, right: 1560, bottom: 339 }, COVER_PANEL_SIZE, { width: 1512, height: 900 })
    expect(style.left).toBe(1512 - 162 - 8)
  })

  it('底部放不下时上提，且不越过视口顶部 8px', () => {
    const style = coverPanelStyle({ left: 100, top: 880, right: 200, bottom: 900 }, COVER_PANEL_SIZE, { width: 1512, height: 900 })
    expect(style.top + COVER_PANEL_SIZE.height).toBeLessThanOrEqual(900 - 8)
    expect(style.top).toBeGreaterThanOrEqual(8)
  })

  it('缺锚点返回原点，不抛', () => {
    expect(coverPanelStyle(null)).toEqual({ left: 0, top: 0 })
  })
})

describe('封面 · 面板三项按 id 派发', () => {
  it('pick → 图库态；remove → 清掉封面；未知 id 什么都不做', () => {
    const ctx = mixinCtx()
    ctx.onCoverPanelItem('pick')
    expect(ctx.coverStage).toBe('gallery')
    ctx.onCoverPanelItem('remove')
    expect(ctx.emitted).toContainEqual({ name: 'cover-change', payload: null })
    ctx.onCoverPanelItem('nope')
    ctx.onCoverPanelItem(null)
    expect(ctx.emitted.filter((item) => item.name === 'cover-change')).toHaveLength(1)
  })

  it('reposition 只在有图时进入拖拽态（纯灰底 / 上传图两种情况）', () => {
    const gray = mixinCtx({ cover: { preset: null, offset: 50 } })
    gray.onCoverPanelItem('reposition')
    expect(gray.coverRepositioning).toBe(false)

    const withPreset = mixinCtx({ cover: { preset: 'aurora', offset: 30 } })
    withPreset.onCoverPanelItem('reposition')
    expect(withPreset.coverRepositioning).toBe(true)
    expect(withPreset.coverDraftOffset).toBe(30)
    expect(withPreset.coverPanelOpen).toBe(false)

    const uploaded = mixinCtx({ cover: { preset: null, url: 'data:image/png;base64,AAA', offset: 70 } })
    uploaded.onCoverPanelItem('reposition')
    expect(uploaded.coverRepositioning).toBe(true)
  })

  it('offset 夹紧 0–100，非数字直接忽略（拖过头 / 输入框随手敲）', () => {
    const ctx = mixinCtx()
    ctx.setCoverDraftOffset(120)
    expect(ctx.coverDraftOffset).toBe(100)
    ctx.setCoverDraftOffset(-30)
    expect(ctx.coverDraftOffset).toBe(0)
    ctx.setCoverDraftOffset(42)
    ctx.setCoverDraftOffset('abc')
    expect(ctx.coverDraftOffset).toBe(42)
    ctx.setCoverDraftOffset(NaN)
    expect(ctx.coverDraftOffset).toBe(42)
  })

  it('确认位置只改 offset，preset 原样保留', () => {
    const ctx = mixinCtx({ cover: { preset: 'ocean', offset: 50 } })
    ctx.startCoverReposition()
    ctx.setCoverDraftOffset(15)
    ctx.confirmCoverReposition()
    expect(ctx.coverRepositioning).toBe(false)
    expect(ctx.emitted).toEqual([{ name: 'cover-change', payload: { preset: 'ocean', offset: 15 } }])
  })

  it('取消位置恢复拖拽态，且不落任何变更', () => {
    const ctx = mixinCtx({ cover: { preset: 'ocean', offset: 50 } })
    ctx.startCoverReposition()
    ctx.setCoverDraftOffset(90)
    ctx.cancelCoverReposition()
    expect(ctx.coverRepositioning).toBe(false)
    expect(ctx.emitted).toEqual([])
  })

  it('拖拽预览走 coverSlotStyle，落库前不写进 coverValue', () => {
    const ctx = mixinCtx({ cover: { preset: 'ocean', offset: 50 } })
    ctx.startCoverReposition()
    ctx.setCoverDraftOffset(10)
    expect(coverMixin.computed.coverSlotStyle.call(ctx).backgroundPosition).toBe('center 10%')
    expect(ctx.coverValue.offset).toBe(50)
  })
})

describe('封面 · 增删与图库', () => {
  it('点「添加封面」立刻落默认灰封面（§1.4.1：不需要先选图）', () => {
    const ctx = mixinCtx()
    ctx.addCover()
    expect(ctx.emitted).toEqual([{ name: 'cover-change', payload: { preset: null, offset: 50 } }])
    expect(ctx.coverInternal).toEqual({ preset: null, offset: 50 })
    expect(coverMixin.computed.coverExists.call(ctx)).toBe(true)
  })

  it('prop 优先于内部草稿：受控模式下 commit 不改内部态，只抛事件', () => {
    const ctx = mixinCtx({ cover: { preset: 'forest', offset: 50 } })
    expect(coverMixin.computed.coverValue.call(ctx)).toEqual({ preset: 'forest', offset: 50 })
    ctx.pickCover('rose')
    expect(ctx.coverInternal).toBeNull()
    expect(ctx.emitted).toEqual([{ name: 'cover-change', payload: { preset: 'rose', offset: 50 } }])
    expect(ctx.coverPanelOpen).toBe(false)
  })

  it('未受控时内部草稿跟着走（Demo 不传 cover 也能玩）', () => {
    const ctx = mixinCtx()
    ctx.pickCover('mint')
    expect(ctx.coverInternal).toEqual({ preset: 'mint', offset: 50 })
  })

  it('选封面保留当前 offset（换图不该把位置弹回中间）', () => {
    const ctx = mixinCtx({ cover: { preset: 'forest', offset: 18 } })
    ctx.pickCover('rose')
    expect(ctx.emitted[0].payload).toEqual({ preset: 'rose', offset: 18 })
  })

  it('随机封面不与当前那张重复，且总落在 12 张之内', () => {
    const ctx = mixinCtx({ cover: { preset: 'aurora', offset: 50 } })
    for (let i = 0; i < 40; i += 1) {
      ctx.pickRandomCover()
      const picked = ctx.emitted[ctx.emitted.length - 1].payload
      expect(picked.preset).not.toBe('aurora')
      expect(COVER_PRESETS.some((entry) => entry.id === picked.preset)).toBe(true)
    }
  })

  it('移除封面：关面板 + 抛 null（顺序无关，但两件都要发生）', () => {
    const ctx = mixinCtx({ cover: { preset: 'aurora', offset: 50 }, coverPanelOpen: true })
    ctx.removeCover()
    expect(ctx.coverPanelOpen).toBe(false)
    expect(ctx.emitted).toEqual([{ name: 'cover-change', payload: null }])
  })

  it('图库态扩展后仍右对齐（§1.4.3 实测图库右缘同样贴右）', () => {
    const ctx = mixinCtx()
    ctx.coverPanelStyleValue = { left: 1000, top: 344 }
    ctx.openCoverGallery()
    expect(ctx.coverStage).toBe('gallery')
    expect(ctx.coverPanelStyleValue.left).toBe(Math.max(8, 1440 - COVER_GALLERY_SIZE.width - 8))
    expect(ctx.coverPanelStyleValue.top).toBeGreaterThanOrEqual(8)
  })

  it('Tab 只有两个合法值，其它输入一律回落到图库', () => {
    const ctx = mixinCtx()
    ctx.setCoverTab('upload')
    expect(ctx.coverTab).toBe('upload')
    ctx.setCoverTab('whatever')
    expect(ctx.coverTab).toBe('storehouse')
    ctx.setCoverTab(null)
    expect(ctx.coverTab).toBe('storehouse')
  })

  it('图库只有一个官方组，12 张全在里面', () => {
    const ctx = mixinCtx()
    const groups = coverMixin.computed.coverThumbGroups.call(ctx)
    expect(groups).toHaveLength(1)
    expect(groups[0].items).toHaveLength(12)
  })

  it('关闭面板顺手复位 stage 与拖拽态（下次打开一定是三项态）', () => {
    const ctx = mixinCtx({ coverStage: 'gallery', coverRepositioning: true, coverPanelOpen: true })
    ctx.closeCoverPanel()
    expect(ctx.coverStage).toBe('menu')
    expect(ctx.coverRepositioning).toBe(false)
    expect(ctx.coverPanelOpen).toBe(false)
  })

  it('打开面板拿不到 rect 时不弹（宁可不弹，也不弹到 0,0）', () => {
    const ctx = mixinCtx()
    ctx.openCoverPanel({})
    ctx.openCoverPanel(null)
    expect(ctx.coverPanelOpen).toBe(false)
  })

  it('命中判定只认封面板层', () => {
    const ctx = mixinCtx()
    const node = (sel) => ({ closest: (s) => (String(s).split(',').some((part) => part.trim() === sel) ? {} : null) })
    expect(ctx.coverContains(node('.lark-doc-cover-layer'))).toBe(true)
    expect(ctx.coverContains(node('.other'))).toBe(false)
    expect(ctx.coverContains(null)).toBe(false)
  })
})
