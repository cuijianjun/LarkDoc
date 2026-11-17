// @vitest-environment jsdom

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
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import postcss from 'postcss'
import panelsUiMixin from '../../src/components/lark-doc/editor/panelsUiMixin'
import readingModeMixin from '../../src/components/lark-doc/editor/readingModeMixin'
import { createDocumentSession } from '../../src/session/DocumentSession'
import { LarkDoc } from '../../src/LarkDoc'
import { createNativeOptionsHost } from '../../src/editor/nativeOptionsHost'
import { iconMarkup } from '../../src/ui/icon'
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

const runtimes = [], sessions = [], documents = []

beforeEach(() => {
  vi.stubGlobal('innerWidth', 1440)
  vi.stubGlobal('innerHeight', 900)
})

afterEach(async () => {
  documents.splice(0).forEach(doc => doc.destroy())
  runtimes.splice(0).reverse().forEach(runtime => {
    runtime.host.destroyPanels()
    runtime.destroy()
  })
  await Promise.all(sessions.splice(0).map(session => session.dispose()))
  document.body.textContent = ''
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function nativeCover(extra = {}) {
  const paper = document.createElement('main')
  const title = document.createElement('h1')
  paper.appendChild(title)
  const panelHost = document.createElement('div')
  const sibling = document.createElement('aside')
  panelHost.appendChild(sibling)
  document.body.append(paper, panelHost)
  const emit = vi.fn()
  const runtime = createNativeOptionsHost({
    options: { mixins: [coverMixin, panelsUiMixin] },
    state: { cover: undefined, effectiveReadonly: false, ...extra },
    refs: { paper, panelHost, outlineHost: document.createElement('div') },
    emit,
  })
  runtimes.push(runtime)
  // 这里只验证封面域，不装配无关的评论、历史记录业务状态。
  runtime.host.buildPanelsState = () => ({ outline: {}, version: {}, saveVersion: {}, comment: {} })
  runtime.host.mountPanels()
  return { ...runtime, paper, title, panelHost, sibling, emit }
}

function pointer(node, type, clientY) {
  node.dispatchEvent(new MouseEvent(type, { clientY, bubbles: true }))
}

describe('封面 · 原生 UI 契约', () => {
  it('封面槽位于标题前，添加、编辑、遮罩关闭和移除保留原有动作', async () => {
    const { host: vm, paper, title, panelHost, sibling, emit } = nativeCover()
    const slot = paper.querySelector('.lark-doc-cover-slot')
    expect(paper.firstChild).toBe(slot)
    expect(slot.nextSibling).toBe(title)
    expect(slot.classList.contains('is-empty')).toBe(true)
    slot.querySelector('[aria-label="添加封面"]').click()
    await vm.$nextTick()
    expect(emit).toHaveBeenCalledWith('cover-change', { preset: null, offset: 50 })
    expect(slot.querySelector('.lark-doc-cover-entry')).toBeNull()
    expect(slot.classList.contains('is-empty')).toBe(false)
    const edit = slot.querySelector('[aria-label="编辑封面"]')
    expect(edit.getAttribute('aria-haspopup')).toBe('menu')
    edit.click()
    await vm.$nextTick()
    const panel = panelHost.querySelector('[role="dialog"][aria-label="封面"]')
    expect(panel).toBe(vm.$refs.coverPanel)
    expect(panel.style.left).toBe(`${vm.coverPanelStyleValue.left}px`)
    expect(panel.style.top).toBe(`${vm.coverPanelStyleValue.top}px`)
    expect(edit.getAttribute('aria-expanded')).toBe('true')
    expect(panel.querySelector('[role="menu"]').getAttribute('aria-label')).toBe('封面操作')
    const items = [...panel.querySelectorAll('[role="menuitem"]')]
    expect(items.map(node => node.dataset.coverItem)).toEqual(['pick', 'reposition', 'remove'])
    items.forEach((node, index) => {
      expect(node.textContent).toBe(COVER_PANEL_ITEMS[index].label)
      const icon = node.querySelector('.lark-doc-icon')
      expect(icon.style.width).toBe('20px')
      const expected = document.createElement('span')
      expected.innerHTML = iconMarkup(COVER_PANEL_ITEMS[index].icon)
      expect(icon.innerHTML).toBe(expected.innerHTML)
    })
    panelHost.querySelector('.lark-doc-cover-mask').dispatchEvent(new Event('pointerdown'))
    await vm.$nextTick()
    expect(panelHost.querySelector('.lark-doc-cover-layer')).toBeNull()
    expect(edit.getAttribute('aria-expanded')).toBe('false')
    expect(sibling.parentNode).toBe(panelHost)
    edit.click()
    await vm.$nextTick()
    panel.querySelector('[data-cover-item="remove"]').click()
    await vm.$nextTick()
    expect(emit).toHaveBeenLastCalledWith('cover-change', null)
    expect(slot.querySelector('.lark-doc-cover-wrapper')).toBeNull()
    expect(slot.querySelector('.lark-doc-cover-entry')).not.toBeNull()
  })

  it('同一面板原地扩展图库，保留分组、无文字缩略图、选中与随机/移除操作', async () => {
    const { host: vm, panelHost, emit } = nativeCover({ coverInternal: { preset: 'ocean', offset: 18 } })
    vm._coverUi.edit.click()
    await vm.$nextTick()
    const panel = vm.$refs.coverPanel
    panel.querySelector('[data-cover-item="pick"]').click()
    await vm.$nextTick()
    expect(panelHost.querySelector('.lark-doc-cover-panel')).toBe(panel)
    expect(panel.classList.contains('is-gallery')).toBe(true)
    expect(panel.querySelector('[role="menu"]')).toBeNull()
    expect(panel.querySelectorAll('.lark-doc-cover-gallery-tabs > button')).toHaveLength(2)
    expect(panel.querySelectorAll('.lark-doc-cover-gallery-head-right > button')).toHaveLength(2)
    expect(panel.querySelector('.lark-doc-cover-group-title').textContent).toBe('官方图库')
    const thumbs = [...panel.querySelectorAll('ul.lark-doc-cover-thumbs > li.lark-doc-cover-thumb > button')]
    expect(thumbs).toHaveLength(12)
    expect(thumbs.map(node => node.getAttribute('aria-label'))).toEqual(COVER_PRESETS.map(preset => preset.name))
    expect(thumbs.every(node => !node.textContent)).toBe(true)
    const selected = thumbs.find(node => node.getAttribute('aria-label') === '深海')
    expect(selected.getAttribute('aria-pressed')).toBe('true')
    expect(selected.classList.contains('is-active')).toBe(true)
    thumbs.find(node => node.getAttribute('aria-label') === '玫瑰').click()
    await vm.$nextTick()
    expect(emit).toHaveBeenLastCalledWith('cover-change', { preset: 'rose', offset: 18 })
    expect(panelHost.querySelector('.lark-doc-cover-layer')).toBeNull()
    vm._coverUi.edit.click()
    await vm.$nextTick()
    panel.querySelector('[data-cover-item="pick"]').click()
    await vm.$nextTick()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    panel.querySelector('[aria-label="随机封面"]').click()
    await vm.$nextTick()
    expect(emit).toHaveBeenLastCalledWith('cover-change', { preset: 'aurora', offset: 18 })
    vm._coverUi.edit.click()
    await vm.$nextTick()
    panel.querySelector('[data-cover-item="pick"]').click()
    await vm.$nextTick()
    panel.querySelector('[aria-label="移除封面"]').click()
    await vm.$nextTick()
    expect(emit).toHaveBeenLastCalledWith('cover-change', null)
  })

  it('本地上传切换替换图库，通过 FileReader 落 data URL 并关闭面板', async () => {
    const url = 'data:image/png;base64,AAA'
    const read = vi.fn(function () { this.result = url; this.onload() })
    vi.stubGlobal('FileReader', class { readAsDataURL = read })
    const { host: vm, emit } = nativeCover({ coverInternal: { preset: null, offset: 50 } })
    vm._coverUi.edit.click()
    await vm.$nextTick()
    vm.$refs.coverPanel.querySelector('[data-cover-item="pick"]').click()
    await vm.$nextTick()
    vm.$refs.coverPanel.querySelector('[aria-label="本地上传"]').click()
    await vm.$nextTick()
    expect(vm._coverUi.uploadTab.classList.contains('is-active')).toBe(true)
    expect(vm.$refs.coverPanel.querySelector('.lark-doc-cover-storehouse')).toBeNull()
    const file = vm.$refs.coverPanel.querySelector('input[type="file"]')
    expect(file.accept).toBe('image/*')
    const image = new File(['image'], 'cover.png', { type: 'image/png' })
    Object.defineProperty(file, 'files', { value: [image] })
    file.dispatchEvent(new Event('change'))
    await vm.$nextTick()
    expect(read).toHaveBeenCalledWith(image)
    expect(emit).toHaveBeenLastCalledWith('cover-change', { preset: null, url, offset: 50 })
    expect(vm.coverPanelOpen).toBe(false)
    expect(vm._coverUi.wrapper.style.backgroundImage).toContain(url)
  })

  it('拖拽只预览，取消不提交，确认落 offset，pointerup/cancel 结束会话', async () => {
    const { host: vm, emit } = nativeCover({ coverInternal: { preset: 'ocean', offset: 50 } })
    vm._coverUi.edit.click()
    await vm.$nextTick()
    vm.$refs.coverPanel.querySelector('[data-cover-item="reposition"]').click()
    await vm.$nextTick()
    const image = vm._coverUi.image
    // jsdom 16 不解析 center + 百分比；断言原生样式写入而非它的序列化结果。
    const position = vi.spyOn(vm._coverUi.wrapper.style, 'backgroundPosition', 'set')
    expect(image.classList.contains('is-dragging')).toBe(true)
    expect(vm._coverUi.toolbar.querySelector('[aria-label="编辑封面"]')).toBeNull()
    pointer(image, 'pointerdown', 100)
    pointer(image, 'pointermove', 200)
    await vm.$nextTick()
    expect(vm.coverDraftOffset).toBe(30)
    expect(position).toHaveBeenLastCalledWith('center 30%')
    expect(vm.coverValue.offset).toBe(50)
    pointer(image, 'pointerup', 200)
    pointer(image, 'pointermove', 400)
    expect(vm.coverDraftOffset).toBe(30)
    vm._coverUi.cancel.click()
    await vm.$nextTick()
    expect(emit).not.toHaveBeenCalled()
    expect(position).toHaveBeenLastCalledWith('center 50%')
    vm.startCoverReposition()
    await vm.$nextTick()
    pointer(image, 'pointerdown', 100)
    pointer(image, 'pointermove', 300)
    pointer(image, 'pointercancel', 300)
    pointer(image, 'pointermove', 500)
    expect(vm.coverDraftOffset).toBe(10)
    vm._coverUi.confirm.click()
    await vm.$nextTick()
    expect(emit).toHaveBeenLastCalledWith('cover-change', { preset: 'ocean', offset: 10 })
    expect(image.classList.contains('is-dragging')).toBe(false)
  })

  it('只读隐藏编辑入口并阻断旧按钮、上传及拖拽，恢复后可操作', async () => {
    const { host: vm, emit, panelHost } = nativeCover()
    const add = vm._coverUi.add
    vm.effectiveReadonly = true
    await vm.$nextTick()
    expect(vm._coverUi.slot.querySelector('button')).toBeNull()
    add.click()
    expect(emit).not.toHaveBeenCalled()
    vm.coverInternal = { preset: 'ocean', offset: 50 }
    vm.coverPanelOpen = true
    vm.coverRepositioning = true
    await vm.$nextTick()
    expect(vm._coverUi.toolbar.children).toHaveLength(0)
    expect(panelHost.querySelector('.lark-doc-cover-layer')).toBeNull()
    const upload = vi.spyOn(vm, 'uploadCover')
    vm._coverUi.upload.querySelector('input').dispatchEvent(new Event('change'))
    vm._coverUi.confirm.click()
    pointer(vm._coverUi.image, 'pointerdown', 100)
    pointer(vm._coverUi.image, 'pointermove', 300)
    expect(vm.coverDraftOffset).toBe(50)
    expect(upload).not.toHaveBeenCalled()
    expect(emit).not.toHaveBeenCalled()
    vm.effectiveReadonly = false
    await vm.$nextTick()
    vm._coverUi.confirm.click()
    expect(emit).toHaveBeenCalledWith('cover-change', { preset: 'ocean', offset: 50 })
  })

  it('多实例拖拽和销毁互不影响，不移除纸张正文或共享浮层兄弟', async () => {
    const first = nativeCover({ coverInternal: { preset: 'ocean', offset: 50 } })
    const second = nativeCover({ coverInternal: { preset: 'rose', offset: 60 } })
    first.host.startCoverReposition()
    second.host.startCoverReposition()
    await Promise.all([first.host.$nextTick(), second.host.$nextTick()])
    pointer(first.host._coverUi.image, 'pointerdown', 100)
    pointer(second.host._coverUi.image, 'pointermove', 200)
    expect(second.host.coverDraftOffset).toBe(60)
    pointer(first.host._coverUi.image, 'pointermove', 200)
    expect(first.host.coverDraftOffset).toBe(30)
    first.host.destroyPanels()
    first.host.destroyPanels()
    expect(first.paper.querySelector('.lark-doc-cover-slot')).toBeNull()
    expect(first.host.$refs.coverPanel).toBeUndefined()
    expect(first.title.parentNode).toBe(first.paper)
    expect(first.sibling.parentNode).toBe(first.panelHost)
    expect(second.paper.querySelector('.lark-doc-cover-slot')).not.toBeNull()
  })
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


describe('T082 cover upload ownership', () => {
  function session() {
    const value = createDocumentSession({ documentId: 'cover-doc', user: { id: 'cover-author' } })
    sessions.push(value); return value
  }
  function scopedCover(extra = {}) {
    return nativeCover({ session: session(), documentId: 'cover-doc', interactionMode: 'edit',
      editor: { isEditable: true, isDestroyed: false }, writable: readingModeMixin.methods.writable,
      coverInternal: { preset: 'ocean', offset: 18 }, ...extra })
  }
  function heldReaders() {
    const readers = [], loads = [], original = FileReader.prototype.readAsDataURL
    vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(function (file) {
      const load = this.onload
      readers.push(this)
      this.onload = event => { loads.push(() => load.call(this, event)) }
      // The real FileReader still reads the real File and produces its data URL;
      // only delivery to the component is held across a context transition.
      return original.call(this, file)
    })
    return { readers, loads }
  }
  async function chooseFile(vm, text = 'cover A') {
    vm.coverPanelOpen = true; vm.coverStage = 'gallery'; vm.coverTab = 'upload'
    await vm.$nextTick()
    const input = vm._coverUi.upload.querySelector('input[type="file"]')
    Object.defineProperty(input, 'files', { configurable: true, value: [new File([text], 'cover.png', { type: 'image/png' })] })
    const upload = vi.isMockFunction(vm.uploadCover) ? vm.uploadCover : vi.spyOn(vm, 'uploadCover')
    input.dispatchEvent(new Event('change'))
    expect(input.isConnected).toBe(true)
    expect(upload.mock.results.at(-1)?.value).toBeInstanceOf(Promise)
    return { pending: upload.mock.results.at(-1).value }
  }
  const expected = text => ({ preset: null, url: 'data:image/png;base64,' + btoa(text), offset: 50 })

  async function withLiveCover(run, cover) {
    const descriptors = ['getClientRects', 'getBoundingClientRect'].map(name => [name, Object.getOwnPropertyDescriptor(Range.prototype, name)])
    Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] })
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => ({ left: 0, top: 0, right: 1, bottom: 1, width: 1, height: 1 }) })
    vi.spyOn(window, 'scrollBy').mockImplementation(() => {})
    let doc
    try {
      const element = document.createElement('div'); document.body.append(element)
      doc = new LarkDoc({ element, session: session(), cover, storage: 'none', content: '<p>正文</p>' }); documents.push(doc)
      const host = doc._handle.nativeHost.host, editor = doc.getEditor()
      await host.$nextTick()
      // Cover is a renderer prop: use the supported hot-prop port before testing
      // a same-value update rather than assuming it is an AiEditor constructor option.
      if (cover !== undefined) { doc.patchProps({ cover }); await host.$nextTick(); expect(host.cover).toBe(cover) }
      return await run({ doc, host, editor })
    } finally {
      doc?.destroy()
      descriptors.forEach(([name, descriptor]) => { if (descriptor) Object.defineProperty(Range.prototype, name, descriptor); else delete Range.prototype[name] })
    }
  }

  it('commits one real FileReader result and closes the current panel', async () => {
    const { host, emit } = scopedCover(), { readers, loads } = heldReaders(), { pending } = await chooseFile(host)
    await vi.waitFor(() => expect(loads).toHaveLength(1))
    const abort = vi.spyOn(readers[0], 'abort')
    loads[0](); loads[0](); await pending
    expect(abort).not.toHaveBeenCalled()
    expect(host.coverInternal).toEqual(expected('cover A'))
    expect(emit.mock.calls.filter(([name]) => name === 'cover-change')).toEqual([['cover-change', expected('cover A')]])
    expect(host.coverPanelOpen).toBe(false)
  })

  it('closes after a synchronous controlled-prop acknowledgement without consuming a second write', async () => {
    const runtime = scopedCover({ cover: { preset: 'ocean', offset: 18 }, coverInternal: null })
    runtime.emit.mockImplementation((name, value) => {
      if (name === 'cover-change') { runtime.host.cover = value; runtime.flush() }
    })
    const { loads } = heldReaders(), { pending } = await chooseFile(runtime.host)
    await vi.waitFor(() => expect(loads).toHaveLength(1))
    loads[0](); await pending
    expect(runtime.host.coverValue).toEqual(expected('cover A')); expect(runtime.host.coverInternal).toBeNull()
    expect(runtime.host.coverPanelOpen).toBe(false)
    expect(runtime.emit.mock.calls.filter(([name]) => name === 'cover-change')).toEqual([['cover-change', expected('cover A')]])
  })

  it.each(['readonly', 'readonly-aba', 'session', 'actor', 'actor-aba', 'document', 'component-document', 'component-document-aba', 'authentication', 'authorization', 'credentials', 'editor', 'session-dispose', 'controlled-cover'])('does not commit a late real load after %s changes', async reason => {
    const { host, emit } = scopedCover(), { loads } = heldReaders(), { pending } = await chooseFile(host)
    await vi.waitFor(() => expect(loads).toHaveLength(1))
    const before = host.coverInternal
    if (reason === 'readonly' || reason === 'readonly-aba') { host.effectiveReadonly = true; await host.$nextTick() }
    if (reason === 'readonly-aba') { host.effectiveReadonly = false; await host.$nextTick() }
    if (reason === 'session') host.session = session()
    if (reason === 'actor' || reason === 'actor-aba') { host.session.user = { id: 'another-author' }; expect(host.session.can('canEdit')).toBe(true) }
    if (reason === 'actor-aba') host.session.user = { id: 'cover-author' }
    if (reason === 'document') host.session.documentId = 'another-doc'
    if (reason === 'component-document' || reason === 'component-document-aba') host.documentId = 'another-doc'
    if (reason === 'component-document-aba') { await host.$nextTick(); host.documentId = 'cover-doc'; await host.$nextTick() }
    if (reason === 'authentication') host.session._identityGeneration++
    if (reason === 'authorization') host.session._authorizationGeneration++
    if (reason === 'credentials') host.session._privateIdentityGeneration++
    if (reason === 'editor') host.editor = { isEditable: true, isDestroyed: false }
    if (reason === 'session-dispose') await host.session.dispose()
    if (reason === 'controlled-cover') host.cover = { preset: 'rose', offset: 50 }
    loads[0](); await pending; await host.$nextTick()
    expect(host.coverInternal).toEqual(before)
    expect(emit.mock.calls.filter(([name]) => name === 'cover-change')).toEqual([])
  })

  it.each(['preset', 'remove'])('retires upload A when the latest intent is %s', async intent => {
    const { host, emit } = scopedCover(), { loads } = heldReaders(), { pending } = await chooseFile(host)
    await vi.waitFor(() => expect(loads).toHaveLength(1))
    if (intent === 'preset') host.pickCover('rose')
    else host.removeCover()
    const latest = intent === 'preset' ? { preset: 'rose', offset: 18 } : null
    loads[0](); await pending
    expect(host.coverInternal).toEqual(latest)
    expect(emit.mock.calls.filter(([name]) => name === 'cover-change')).toEqual([['cover-change', latest]])
  })

  it.each(['A-first', 'B-first'])('keeps upload B as the latest intent when callbacks finish %s', async order => {
    const { host, emit } = scopedCover(), { loads } = heldReaders(), a = await chooseFile(host)
    await vi.waitFor(() => expect(loads).toHaveLength(1))
    const b = await chooseFile(host, 'cover B')
    await vi.waitFor(() => expect(loads).toHaveLength(2))
    if (order === 'A-first') { loads[0](); await a.pending; expect(host.coverInternal).toEqual({ preset: 'ocean', offset: 18 }); loads[1]() }
    else { loads[1](); await b.pending; loads[0]() }
    await Promise.all([a.pending, b.pending])
    expect(host.coverInternal).toEqual(expected('cover B'))
    expect(emit.mock.calls.filter(([name]) => name === 'cover-change')).toEqual([['cover-change', expected('cover B')]])
  })

  it('settles reader errors without cover writes', async () => {
    const { host, emit } = scopedCover(), { readers, loads } = heldReaders(), { pending } = await chooseFile(host)
    await vi.waitFor(() => expect(loads).toHaveLength(1))
    // A fault event on the real reader is an injected IO negative, not a remote service.
    readers[0].dispatchEvent(new ProgressEvent('error')); await pending
    expect(host.coverInternal).toEqual({ preset: 'ocean', offset: 18 })
    expect(emit).not.toHaveBeenCalled()
  })

  it('settles a synchronous reader failure without cover writes', async () => {
    vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(() => { throw new Error('reader unavailable') })
    const { host, emit } = scopedCover(), { pending } = await chooseFile(host)
    await expect(pending).resolves.toBeUndefined()
    expect(host.coverInternal).toEqual({ preset: 'ocean', offset: 18 }); expect(emit).not.toHaveBeenCalled()
  })

  it('retires the real reader through the actual native beforeDestroy hook', async () => {
    const runtime = scopedCover(), { readers, loads } = heldReaders(), { pending } = await chooseFile(runtime.host)
    await vi.waitFor(() => expect(loads).toHaveLength(1))
    const abort = vi.spyOn(readers[0], 'abort'), commit = vi.spyOn(runtime.host, 'commitCover')
    runtime.host.destroyPanels(); runtime.destroy()
    loads[0](); await pending
    expect(abort).toHaveBeenCalledOnce(); expect(commit).not.toHaveBeenCalled()
    expect(runtime.emit).not.toHaveBeenCalled()
  })

  it.each(['readonly', 'writable', 'authorization', 'editor-destroyed', 'destroyed'])('rechecks direct commit authority at %s', reason => {
    const { host, emit, destroy } = scopedCover(), before = host.coverInternal
    if (reason === 'readonly') host.effectiveReadonly = true
    if (reason === 'writable') host.interactionMode = 'read'
    if (reason === 'authorization') vi.spyOn(host.session, 'can').mockReturnValue(false)
    if (reason === 'editor-destroyed') host.editor.isDestroyed = true
    if (reason === 'destroyed') destroy()
    host.commitCover(null)
    expect(host.coverInternal).toEqual(before)
    expect(emit).not.toHaveBeenCalled()
  })

  it.each(['transaction', 'selection'])('keeps a real native reader pending through a benign body %s', change => withLiveCover(async ({ host, editor }) => {
    host.addCover()
    const { readers, loads } = heldReaders(), { pending } = await chooseFile(host)
    await vi.waitFor(() => expect(loads).toHaveLength(1))
    const abort = vi.spyOn(readers[0], 'abort')
    if (change === 'transaction') editor.commands.insertContent('编辑')
    else editor.commands.setTextSelection(2)
    await host.$nextTick()
    expect(abort).not.toHaveBeenCalled()
    const body = editor.getJSON()
    loads[0](); await pending
    expect(host.coverInternal).toEqual(expected('cover A'))
    expect(editor.getJSON()).toEqual(body)
  }))

  it.each(['patchProps', 'forceUpdate'])('keeps the same controlled cover during a benign native %s', async change => {
    const cover = { preset: 'ocean', offset: 18 }
    await withLiveCover(async ({ doc, host, editor }) => {
      const { readers, loads } = heldReaders(), emit = vi.spyOn(host, '$emit'), { pending } = await chooseFile(host)
      await vi.waitFor(() => expect(loads).toHaveLength(1))
      const abort = vi.spyOn(readers[0], 'abort'), body = editor.getJSON()
      if (change === 'patchProps') expect(doc.patchProps({ cover })).toBe(true)
      else host.$forceUpdate()
      await host.$nextTick()
      expect(host.cover).toBe(cover); expect(abort).not.toHaveBeenCalled()
      loads[0](); await pending
      expect(emit.mock.calls.filter(([name]) => name === 'cover-change')).toEqual([['cover-change', expected('cover A')]])
      expect(host.coverInternal).toBeNull(); expect(editor.getJSON()).toEqual(body)
    }, cover)
  })

  it.each(['preset', 'url', 'offset'])('does not overwrite a real in-place controlled cover %s change', async field => {
    const cover = { preset: 'ocean', offset: 18 }
    await withLiveCover(async ({ doc, host }) => {
      const { loads } = heldReaders(), emit = vi.spyOn(host, '$emit'), { pending } = await chooseFile(host)
      await vi.waitFor(() => expect(loads).toHaveLength(1))
      cover[field] = { preset: 'rose', url: 'data:image/png;base64,Qg==', offset: 32 }[field]
      doc.patchProps({ cover }); await host.$nextTick()
      loads[0](); await pending
      expect(host.coverValue).toEqual(cover)
      expect(emit.mock.calls.filter(([name]) => name === 'cover-change')).toEqual([])
    }, cover)
  })

  it('retires the pending real reader when the actual cover backdrop closes the panel', async () => {
    const { host, emit } = scopedCover(), { readers, loads } = heldReaders(), { pending } = await chooseFile(host)
    await vi.waitFor(() => expect(loads).toHaveLength(1))
    const abort = vi.spyOn(readers[0], 'abort')
    host._coverUi.layer.querySelector('.lark-doc-cover-mask').dispatchEvent(new Event('pointerdown'))
    await host.$nextTick()
    expect(abort).toHaveBeenCalledOnce()
    loads[0](); await pending
    expect(host.coverPanelOpen).toBe(false); expect(host.coverInternal).toEqual({ preset: 'ocean', offset: 18 })
    expect(emit).not.toHaveBeenCalled()
  })

  it('keeps cover upload and crop out of the actual body Undo/Redo history', () => withLiveCover(async ({ doc, host, editor }) => {
    const before = editor.getJSON()
    editor.commands.insertContent('新增'); host.addCover()
    const edited = editor.getJSON(), { loads } = heldReaders(), { pending } = await chooseFile(host)
    await vi.waitFor(() => expect(loads).toHaveLength(1))
    loads[0](); await pending
    host.startCoverReposition(); host.setCoverDraftOffset(21); host.confirmCoverReposition()
    expect(host.coverInternal).toEqual({ ...expected('cover A'), offset: 21 })
    expect(editor.getJSON()).toEqual(edited)
    expect(doc.undo()).toBe(true); expect(editor.getJSON()).toEqual(before)
    expect(host.coverInternal.offset).toBe(21)
    expect(doc.redo()).toBe(true); expect(editor.getJSON()).toEqual(edited)
  }))
})


describe('T096 no-hover phone cover CSS on the native cover DOM', () => {
  const sheets = []
  afterEach(() => sheets.splice(0).forEach(sheet => sheet.remove()))
  function styleFor({ width = 393, height = 852, coarse = true, hover = false } = {}) {
    vi.stubGlobal('innerWidth', width); vi.stubGlobal('innerHeight', height)
    // JSDOM has no viewport media/layout engine. Select the production cover
    // rules for this environment, then let its real selector/cascade engine run.
    // Vitest rewrites `import.meta.url` to an http:// module URL under jsdom, so
    // resolve the stylesheet from the project root instead of fileURLToPath.
    const css = postcss.parse(readFileSync(`${process.cwd()}/src/components/lark-doc/lark-doc.css`, 'utf8'))
    const output = []
    css.walkRules(rule => {
      if (!rule.selector.includes('lark-doc-cover-') && !['.lark-doc button', '.lark-doc *, .lark-doc *::before, .lark-doc *::after'].includes(rule.selector)) return
      for (let parent = rule.parent; parent?.type !== 'root'; parent = parent.parent) {
        if (parent.type !== 'atrule' || parent.name !== 'media' || /print/.test(parent.params)) return
        const query = parent.params
        if ([...query.matchAll(/max-width:\s*(\d+)px/g)].some(match => width > Number(match[1]))) return
        if ([...query.matchAll(/min-width:\s*(\d+)px/g)].some(match => width < Number(match[1]))) return
        if (/pointer:\s*coarse/.test(query) && !coarse || /pointer:\s*fine/.test(query) && coarse) return
        if (/hover:\s*none/.test(query) && hover || /hover:\s*hover/.test(query) && !hover) return
      }
      // jsdom 16's nwsapi cascade engine throws on `:focus-within` (the rule
      // still keeps its `:hover` half); drop only that pseudo-class arm.
      const selector = rule.selector.split(',').filter(part => !part.includes(':focus-within')).join(',')
      if (!selector.trim()) return
      output.push(rule.clone({ selector }).toString())
    })
    const sheet = document.createElement('style'); sheet.textContent = output.join('\n'); document.head.append(sheet); sheets.push(sheet)
  }
  function styledCover(extra = {}) {
    const ui = nativeCover(extra), root = document.createElement('div'); root.className = 'lark-doc'
    ui.paper.className = 'lark-doc-paper'; root.append(ui.paper, ui.panelHost); document.body.append(root)
    return ui
  }
  // Resolve only the px/vw/vh sums used by the production declarations. This is
  // a declared viewport budget assertion, never a claim about Chrome hit testing.
  function extent(value) {
    const text = String(value).replace(/([+-])\s+(?=\d)/g, '$1')
    const terms = [...text.matchAll(/([+-]?[\d.]+)(px|vw|vh)/g)]
    if (!terms.length) return Infinity
    return terms.reduce((sum, match) => sum + Number(match[1]) * (match[2] === 'vw' ? window.innerWidth / 100 : match[2] === 'vh' ? window.innerHeight / 100 : 1), 0)
  }
  it('keeps the empty editable entry visible in reserved flow before the title, then exposes edit controls after adding', async () => {
    styleFor()
    const { host, paper, title } = styledCover(), ui = host._coverUi
    const slot = getComputedStyle(ui.slot), entry = getComputedStyle(ui.add)
    expect(entry.opacity).toBe('1'); expect(entry.position).toBe('static')
    expect(parseFloat(slot.minHeight)).toBeGreaterThanOrEqual(parseFloat(entry.minHeight))
    expect(ui.slot.nextElementSibling).toBe(title)
    ui.add.click(); await host.$nextTick()
    expect(paper.querySelector('.lark-doc-cover-entry')).toBeNull()
    expect(getComputedStyle(ui.toolbar).opacity).toBe('1')
    expect(ui.edit.isConnected).toBe(true); expect(host.coverExists).toBe(true)
    host.removeCover(); await host.$nextTick()
    expect(paper.querySelector('.lark-doc-cover-entry')).toBe(ui.add)
    expect(getComputedStyle(ui.add).opacity).toBe('1')
  })
  it('keeps readonly empty cover at zero height without adding a visible control or spacer', () => {
    styleFor()
    const { host } = styledCover({ effectiveReadonly: true }), ui = host._coverUi
    expect(ui.add.isConnected).toBe(false)
    expect(getComputedStyle(ui.slot).height).toBe('0px')
    expect(parseFloat(getComputedStyle(ui.slot).minHeight) || 0).toBe(0)
  })
  it.each([{ width: 1440, coarse: false, hover: true }, { width: 393, coarse: false, hover: true }])('retains hover-only desktop entry and gallery dimensions for %j', async environment => {
    styleFor(environment)
    const { host } = styledCover(), ui = host._coverUi
    expect(getComputedStyle(ui.slot).height).toBe('0px')
    expect(getComputedStyle(ui.add).opacity).toBe('0'); expect(getComputedStyle(ui.add).position).toBe('absolute')
    ui.add.click(); await host.$nextTick(); ui.edit.click(); await host.$nextTick()
    ui.menu.querySelector('[data-cover-item="pick"]').click(); await host.$nextTick()
    expect(getComputedStyle(ui.panel).width).toBe('542px')
    expect(getComputedStyle(ui.panel).height).toBe('522px')
  })
  it.each([{ width: 320, height: 852 }, { width: 393, height: 852 }, { width: 393, height: 480 }, { width: 667, height: 375 }])('bounds the gallery declaration budget and keeps tabs/upload/close usable for %j', async environment => {
    styleFor(environment)
    const { host, panelHost } = styledCover(), ui = host._coverUi
    ui.add.click(); await host.$nextTick(); ui.edit.click(); await host.$nextTick()
    ui.menu.querySelector('[data-cover-item="pick"]').click(); await host.$nextTick()
    const panel = getComputedStyle(ui.panel)
    const width = Math.min(extent(panel.width), extent(panel.maxWidth)), height = Math.min(extent(panel.height), extent(panel.maxHeight))
    expect(Number.isFinite(width)).toBe(true); expect(Number.isFinite(height)).toBe(true)
    expect(parseFloat(ui.panel.style.left) + width).toBeLessThanOrEqual(environment.width - 8)
    expect(parseFloat(ui.panel.style.top) + height).toBeLessThanOrEqual(environment.height - 8)
    expect(getComputedStyle(ui.gallery.querySelector('.lark-doc-cover-gallery-head')).flexWrap).toBe('wrap')
    expect(getComputedStyle(ui.storehouse.querySelector('.lark-doc-cover-thumbs')).gridTemplateColumns).toContain('auto-fit')
    expect(ui.storehouse.querySelectorAll('.lark-doc-cover-group')).toHaveLength(host.coverThumbGroups.length)
    ui.uploadTab.click(); await host.$nextTick()
    const upload = panelHost.querySelector('.lark-doc-cover-upload')
    expect(upload.isConnected).toBe(true); expect(getComputedStyle(upload).display).toBe('grid')
    expect(upload.querySelector('input[type="file"]').accept).toBe('image/*')
    panelHost.querySelector('.lark-doc-cover-mask').dispatchEvent(new Event('pointerdown'))
    await host.$nextTick(); expect(host.coverPanelOpen).toBe(false)
  })
})
