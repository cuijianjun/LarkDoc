/**
 * 链接悬浮卡（requirements/04 §1.6 A 态 + §1.6.1）。
 *
 * 这里守的是三条**错了也不报错**的实测口径：
 *   1. 触发是 hover ≥ 2.7s，不是即展 —— 定时器被取消就永远不该弹；
 *   2. 卡片 440×42 恒定、URL 再长也不撑宽（URL 在文本项内单行省略）；
 *   3. 水平严格以链接为中心、垂直 `链接 top − 50`。
 *
 * environment 是 node（vitest.config.js），所以 DOM 一律用**带 closest 的替身**：
 * 本文件测的是判定与几何，不需要真节点。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import linkHoverMixin, {
  LINK_HOVER_CARD_SIZE,
  LINK_HOVER_DELAY,
  LINK_HOVER_TOP_OFFSET,
  LINK_VIEW_MODES,
  linkHoverCardStyle,
  linkHoverDisplayText,
  linkHoverTargetOf,
} from '../../src/components/lark-doc/editor/linkHoverMixin'

/** 造一个带 closest 的假节点：`命中表` 里的选择器返回 self，其余返回 null。 */
function fakeNode(matched) {
  const self = {}
  self.closest = (sel) => (String(sel).split(',').some((part) => matched.indexOf(part.trim()) >= 0) ? self : null)
  self.getAttribute = (name) => (name === 'href' ? 'https://example.com/a?b=1' : null)
  self.textContent = '示例链接'
  self.getBoundingClientRect = () => ({ left: 700, top: 517, right: 760, bottom: 537, width: 60, height: 20 })
  return self
}

function mixinCtx(extra = {}) {
  const emitted = []
  const ctx = {
    ...linkHoverMixin.data(),
    emitted,
    $emit: (name, payload) => { emitted.push({ name, payload }) },
    $refs: {},
    ...extra,
  }
  ctx.$nextTick = (fn) => (typeof fn === 'function' ? fn.call(ctx) : undefined)
  const methods = linkHoverMixin.methods
  Object.keys(methods).forEach((key) => {
    if (typeof ctx[key] !== 'function') ctx[key] = methods[key]
  })
  return ctx
}

beforeEach(() => {
  // openLinkHover 会读 window.innerWidth/innerHeight —— node 环境没有 window。
  globalThis.window = { innerWidth: 1440, innerHeight: 900 }
})

afterEach(() => {
  delete globalThis.window
})

describe('链接悬浮卡 · 实测常量', () => {
  it('延迟 2700ms、卡片 440×42、顶部偏移 50', () => {
    expect(LINK_HOVER_DELAY).toBe(2700)
    expect(LINK_HOVER_CARD_SIZE).toEqual({ width: 440, height: 42 })
    expect(LINK_HOVER_TOP_OFFSET).toBe(50)
  })

  it('四种视图顺序固定（§1.6.1）：链接 / 标题 / 卡片 / 预览', () => {
    expect(LINK_VIEW_MODES.map((mode) => mode.id)).toEqual(['link', 'title', 'card', 'preview'])
    expect(LINK_VIEW_MODES.map((mode) => mode.label)).toEqual(['链接视图', '标题视图', '卡片视图', '预览视图'])
  })
})

describe('链接悬浮卡 · 命中判定', () => {
  it('正文里的 <a href> 才算；卡片自身与 chrome 里的 <a> 不算', () => {
    expect(linkHoverTargetOf(fakeNode(['a[href]']))).not.toBeNull()
    expect(linkHoverTargetOf(fakeNode(['a[href]', '.lark-doc-link-hover-card']))).toBeNull()
    expect(linkHoverTargetOf(fakeNode(['.other']))).toBeNull()
    expect(linkHoverTargetOf(null)).toBeNull()
    expect(linkHoverTargetOf({})).toBeNull()
  })
})

describe('链接悬浮卡 · 定位纯函数', () => {
  it('水平中心严格对齐链接中心（实测 730 → 730）', () => {
    const style = linkHoverCardStyle({ left: 700, top: 517, right: 760, bottom: 537, width: 60, height: 20 }, LINK_HOVER_CARD_SIZE, { width: 1440, height: 900 })
    expect(style.left).toBe(730 - 220)
    expect(style.top).toBe(517 - 50)
  })

  it('卡片尺寸恒定：URL 再长也不改宽高（宽度不参与计算以外的自适应）', () => {
    const short = linkHoverCardStyle({ left: 700, top: 517, width: 10, height: 20 }, LINK_HOVER_CARD_SIZE, { width: 2000, height: 900 })
    const long = linkHoverCardStyle({ left: 700, top: 517, width: 600, height: 20 }, LINK_HOVER_CARD_SIZE, { width: 2000, height: 900 })
    // 两次都以各自链接的**中心**对齐，卡片自身尺寸不变（440×42）。
    expect(short.left).toBe(705 - 220)
    expect(long.left).toBe(1000 - 220)
  })

  it('贴左缘时向左夹 8px（不溢出视口）', () => {
    const style = linkHoverCardStyle({ left: 10, top: 517, width: 20, height: 20 }, LINK_HOVER_CARD_SIZE, { width: 1440, height: 900 })
    expect(style.left).toBe(8)
  })

  it('贴右缘时向右夹 8px', () => {
    const style = linkHoverCardStyle({ left: 1400, top: 517, width: 40, height: 20 }, LINK_HOVER_CARD_SIZE, { width: 1440, height: 900 })
    expect(style.left).toBe(1440 - 440 - 8)
  })

  it('上方放不下时翻到链接下方 8px（飞书没给这条，但出视口不可用）', () => {
    const style = linkHoverCardStyle({ left: 700, top: 20, bottom: 40, width: 60, height: 20 }, LINK_HOVER_CARD_SIZE, { width: 1440, height: 900 })
    expect(style.top).toBe(48)
  })

  it('下方也超界时夹在视口内（不越底）', () => {
    const style = linkHoverCardStyle({ left: 700, top: 880, bottom: 900, width: 60, height: 20 }, LINK_HOVER_CARD_SIZE, { width: 1440, height: 900 })
    expect(style.top + 42).toBeLessThanOrEqual(900 - 8)
    expect(style.top).toBeGreaterThanOrEqual(8)
  })

  it('缺锚点返回原点；锚点畸形时退化到左上 8px 安全位，不抛也不产生负坐标', () => {
    expect(linkHoverCardStyle(null)).toEqual({ left: 0, top: 0 })
    expect(linkHoverCardStyle({ left: 0, top: 0 })).toEqual({ left: 8, top: 8 })
    expect(linkHoverCardStyle({ left: 0, top: 0 }, LINK_HOVER_CARD_SIZE, { width: 1440, height: 900 })).toEqual({ left: 8, top: 8 })
  })
})

describe('链接悬浮卡 · 文案', () => {
  it('有链接文本就用文本，没有才退回完整 URL（飞书显示的是完整 URL）', () => {
    expect(linkHoverDisplayText('https://a.com', '标题')).toBe('标题')
    expect(linkHoverDisplayText('https://a.com', '   ')).toBe('https://a.com')
    expect(linkHoverDisplayText('https://a.com', '')).toBe('https://a.com')
    expect(linkHoverDisplayText(null)).toBe('')
  })
})

describe('链接悬浮卡 · hover 触发与取消', () => {
  it('hover 只挂定时器，不立刻弹（≥1.2s 才展）', () => {
    const ctx = mixinCtx()
    ctx.onPaperLinkMouseOver({ target: fakeNode(['a[href]']) })
    expect(ctx.linkHoverOpen).toBe(false)
    expect(ctx._linkHoverTimer).toBeTruthy()
    ctx.cancelLinkHover()
    expect(ctx._linkHoverTimer).toBeNull()
  })

  it('非链接目标不挂定时器', () => {
    const ctx = mixinCtx()
    ctx.onPaperLinkMouseOver({ target: fakeNode(['.other']) })
    ctx.onPaperLinkMouseOver({})
    expect(ctx._linkHoverTimer).toBeUndefined()
  })

  it('已经是同一条链接的卡片时不再重挂（避免鼠标在链接内移动反复重置）', () => {
    const ctx = mixinCtx({ linkHoverOpen: true, linkHoverHref: 'https://example.com/a?b=1' })
    ctx.onPaperLinkMouseOver({ target: fakeNode(['a[href]']) })
    expect(ctx._linkHoverTimer).toBeUndefined()
  })

  it('鼠标移出链接就取消；移向卡片自身时不取消（否则还没进卡片就被关掉）', () => {
    const ctx = mixinCtx()
    ctx._linkHoverTimer = setTimeout(() => {}, 10000)
    ctx.onPaperLinkMouseOut({ target: fakeNode(['a[href]']), relatedTarget: fakeNode(['.lark-doc-link-hover-card']) })
    expect(ctx._linkHoverTimer).toBeTruthy()
    ctx.cancelLinkHover()

    ctx._linkHoverTimer = setTimeout(() => {}, 10000)
    ctx.onPaperLinkMouseOut({ target: fakeNode(['a[href]']), relatedTarget: fakeNode(['.other']) })
    expect(ctx._linkHoverTimer).toBeNull()
  })

  it('openLinkHover 取 href + text 并按实测几何定位', () => {
    const ctx = mixinCtx()
    ctx.openLinkHover(fakeNode(['a[href]']))
    expect(ctx.linkHoverHref).toBe('https://example.com/a?b=1')
    expect(ctx.linkHoverText).toBe('示例链接')
    expect(ctx.linkHoverOpen).toBe(true)
    expect(ctx.linkHoverMenuOpen).toBe(false)
    expect(ctx.linkHoverStyle.top).toBe(517 - 50)
  })

  it('closeLinkHover 顺手清掉待弹的定时器（关了就不会再自己弹出来）', () => {
    const ctx = mixinCtx({ linkHoverOpen: true })
    ctx._linkHoverTimer = setTimeout(() => {}, 10000)
    ctx.closeLinkHover()
    expect(ctx.linkHoverOpen).toBe(false)
    expect(ctx._linkHoverTimer).toBeNull()
  })

  it('mounted/beforeDestroy 成对增删监听，卸载后再无残留定时器', () => {
    const handlers = {}
    const root = {
      addEventListener: (name, fn) => { handlers[name] = fn },
      removeEventListener: (name) => { delete handlers[name] },
    }
    const ctx = mixinCtx({ $refs: { root } })
    linkHoverMixin.mounted.call(ctx)
    expect(typeof handlers.mouseover).toBe('function')
    expect(typeof handlers.mouseout).toBe('function')
    ctx._linkHoverTimer = setTimeout(() => {}, 10000)
    linkHoverMixin.beforeDestroy.call(ctx)
    expect(handlers.mouseover).toBeUndefined()
    expect(ctx._linkHoverTimer).toBeNull()
  })

  it('没有 root 引用时 mounted 静默早退（SSR / 未渲染场景）', () => {
    const ctx = mixinCtx()
    expect(() => linkHoverMixin.mounted.call(ctx)).not.toThrow()
    expect(() => linkHoverMixin.beforeDestroy.call(ctx)).not.toThrow()
  })
})

describe('链接悬浮卡 · 四种视图与动作', () => {
  it('切视图只留选择态 + 抛事件，内核不改写渲染（那是宿主策略）', () => {
    const ctx = mixinCtx({ linkHoverHref: 'https://a.com', linkHoverMenuOpen: true })
    ctx.setLinkHoverView('card')
    expect(ctx.linkHoverView).toBe('card')
    expect(ctx.linkHoverMenuOpen).toBe(false)
    expect(ctx.emitted).toEqual([{ name: 'link-view', payload: { href: 'https://a.com', view: 'card' } }])
  })

  it('linkViewModes 标出当前项，供模板画勾', () => {
    const ctx = mixinCtx({ linkHoverView: 'title' })
    const modes = linkHoverMixin.computed.linkViewModes.call(ctx)
    expect(modes.map((mode) => mode.active)).toEqual([false, true, false, false])
  })

  it('linkHoverLabel 优先取链接文本', () => {
    const ctx = mixinCtx({ linkHoverHref: 'https://a.com', linkHoverText: '标题' })
    expect(linkHoverMixin.computed.linkHoverLabel.call(ctx)).toBe('标题')
    ctx.linkHoverText = ''
    expect(linkHoverMixin.computed.linkHoverLabel.call(ctx)).toBe('https://a.com')
  })

  it('编辑：先关卡片再开既有 LinkDialog，并把 href 塞进去', () => {
    const calls = []
    const ctx = mixinCtx({
      linkHoverOpen: true,
      linkHoverHref: 'https://a.com',
      openLinkDialog: (...args) => calls.push(['openLinkDialog', ...args]),
      setLinkValue: (...args) => calls.push(['setLinkValue', ...args]),
    })
    ctx.editHoveredLink()
    expect(ctx.linkHoverOpen).toBe(false)
    expect(calls).toEqual([['openLinkDialog', true], ['setLinkValue', 'https://a.com']])
  })

  it('删除：只读态静默（有闸门），可写时走 unsetLink', () => {
    const calls = []
    const readonly = mixinCtx({ linkHoverOpen: true, writable: () => false, run: (...args) => calls.push(args) })
    readonly.removeHoveredLink()
    expect(calls).toEqual([])
    expect(readonly.linkHoverOpen).toBe(true)

    const writable = mixinCtx({ linkHoverOpen: true, writable: () => true, run: (...args) => calls.push(args) })
    writable.removeHoveredLink()
    expect(calls).toEqual([['unsetLink']])
    expect(writable.linkHoverOpen).toBe(false)
  })

  it('更多：抛给宿主，不弹空菜单', () => {
    const ctx = mixinCtx({ linkHoverOpen: true, linkHoverHref: 'https://a.com' })
    ctx.onLinkHoverMore()
    expect(ctx.linkHoverOpen).toBe(false)
    expect(ctx.emitted).toEqual([{ name: 'link-more', payload: { href: 'https://a.com' } }])
  })

  it('命中判定覆盖卡片与二级菜单', () => {
    const ctx = mixinCtx()
    expect(ctx.linkHoverContains(fakeNode(['.lark-doc-link-hover-card']))).toBe(true)
    expect(ctx.linkHoverContains(fakeNode(['.lark-doc-link-view-menu']))).toBe(true)
    expect(ctx.linkHoverContains(fakeNode(['.other']))).toBe(false)
    expect(ctx.linkHoverContains(null)).toBe(false)
  })
})
