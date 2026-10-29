/**
 * 文档封面（requirements/04 §1.4 / §1.4.1 / §1.4.2 / §1.4.3）。
 *
 * 六条实测口径（都是踩过的坑，改这个文件前先看）：
 *
 *   1. **点「添加封面」立刻落默认灰封面，不需要选图**（§1.4.1 已确认）。默认底色是
 *      `#EFF0F1`，**不是纯白**；槽高 283、空态槽高 0。
 *   2. **真正的操作面板才有 3 项**：§1.4 表里那个 `1512×2` 的
 *      `.cover-panel-popover-content-wrapper` 只是**折叠壳**（`visibility:hidden`），
 *      真正的面板要 hover 封面 → 点「编辑封面」66×30 → 才是 **162×126** 的三项面板。
 *      照着 §1.4 的表做会得到一个永远展开不了的壳。
 *   3. **三项顺序固定**：选择图片 / 调整图片位置 / 移除封面。§1.4.3 的红字警告是真实
 *      事故：按 DOM 顺序取「最后一个」会把封面删掉（batch425），必须**按文案命中**。
 *      所以这里的三项用显式 id（`pick` / `reposition` / `remove`），不按下标。
 *   4. **选「选择图片」是原地扩展**，同一个 wrapper 从 162×126 变成 **542×522** 图库，
 *      **不是**跳新弹窗。
 *   5. **遮罩是全屏透明层 z78**（`rgba(0,0,0,0)`），只拦点击不压暗。面板 z80 —— **只差
 *      2 级**，别按 Dialog 的 1000+ 惯例写。给它加背景色整页会变灰。
 *   6. **`opacity: 0` 容器 + `opacity: 1` 按钮**：工具条容器自身透明、按钮才是实体，
 *      bg / radius 只能加在按钮上。
 *
 * 为什么封面状态是 `coverValue` 属性而不是文档里的一个块：
 *   封面属于**文档级元数据**，不在正文块树里（它也从不参与撤销栈）。放进 doc 会让每次
 *   换封面都产生一条 tr、并被协同当成正文变更广播。所以这里走 prop + `cover-change`
 *   事件由宿主持久化 —— 与市场份额/协同 Provider 同侧的取舍，注释留在这是为了说明
 *   「不是漏做 schema」。
 */
/**
 * ⚠️ `CoverSlot.vue` 的 import / 注册**不放在这里**，而是直接写在 `LarkDocEditor.vue`。
 *
 * 按常规做法它该跟 `p6bMixin.js` 注册 `LarkDocOverlays` 一样收进 mixin —— 但
 * `vitest.config.js` 的 `forbidVueImports` 门禁禁止单测闭包里出现 src 目录下的 .vue 组件，
 * mixin 一旦 import 组件，本文件的纯函数（`coverPanelStyle` / `coverImageStyle` 等）
 * 就彻底没法被单测 import 了。封面是 04 §1.4 里几何最密的一条线，宁可让门面多
 * 承担一行 import，也要保住它的可测性。
 */

/** 封面槽高度（§1.4.1：1212×283 里的 283）。 */
export const COVER_HEIGHT = 283

/**
 * 默认封面底色（无图时；不是白）。
 *
 * ⚠️ 这里写的是 **token 名**不是字面色：`scripts/check-theme-tokens.js` 禁止组件里新增
 * 字面 hex，色值统一在 `lark-doc.css` 的 `.lark-doc {}` token 区声明（`--ld-cover-*`）。
 */
export const COVER_DEFAULT_BG = 'var(--ld-cover-default)'

/** 面板/图库尺寸（§1.4.2 / §1.4.3）。 */
export const COVER_PANEL_SIZE = Object.freeze({ width: 162, height: 126 })
export const COVER_GALLERY_SIZE = Object.freeze({ width: 542, height: 522 })

/** 图库缩略图栅格（§1.4.3：4 列，118×64，x 步距 130，行距 74）。 */
export const COVER_THUMB_SIZE = Object.freeze({ width: 118, height: 64 })

/** 三项，顺序固定；id 显式化是因为「按下标取」曾删掉过封面（§1.4.3 红字）。 */
export const COVER_PANEL_ITEMS = Object.freeze([
  { id: 'pick', label: '选择图片', icon: 'image' },
  { id: 'reposition', label: '调整图片位置', icon: 'cover-position' },
  { id: 'remove', label: '移除封面', icon: 'trash' },
])

/**
 * 图库：两个 Tab + 官方组。
 *
 * ⚠️ requirements 只采集了面板几何与栅格，**没有给出图库图片的 URL 清单**：外链 CDN
 * 图片会让离线 Demo 直接开天窗（README 明确要求 Demo 可离线跑），所以这里用 12 张本地
 * 渐变封面兜底 —— 这是有意的取舍，不是「随便填的假数据」。本地上传 Tab 走 FileReader
 * 读成 data URL，同样不落外链依赖。
 *
 * ⚠️ `from` / `to` 是 **token 引用**（`--ld-cover-<id>-from/-to`），不是字面色：
 * 色值统一在 `lark-doc.css` 的 `.lark-doc {}` token 区声明。
 */
export const COVER_PRESETS = Object.freeze([
  { id: 'aurora', name: '极光', from: 'var(--ld-cover-aurora-from)', to: 'var(--ld-cover-aurora-to)' },
  { id: 'sunset', name: '落日', from: 'var(--ld-cover-sunset-from)', to: 'var(--ld-cover-sunset-to)' },
  { id: 'forest', name: '林间', from: 'var(--ld-cover-forest-from)', to: 'var(--ld-cover-forest-to)' },
  { id: 'grape', name: '葡萄', from: 'var(--ld-cover-grape-from)', to: 'var(--ld-cover-grape-to)' },
  { id: 'ocean', name: '深海', from: 'var(--ld-cover-ocean-from)', to: 'var(--ld-cover-ocean-to)' },
  { id: 'rose', name: '玫瑰', from: 'var(--ld-cover-rose-from)', to: 'var(--ld-cover-rose-to)' },
  { id: 'sand', name: '沙丘', from: 'var(--ld-cover-sand-from)', to: 'var(--ld-cover-sand-to)' },
  { id: 'ink', name: '水墨', from: 'var(--ld-cover-ink-from)', to: 'var(--ld-cover-ink-to)' },
  { id: 'mint', name: '薄荷', from: 'var(--ld-cover-mint-from)', to: 'var(--ld-cover-mint-to)' },
  { id: 'coral', name: '珊瑚', from: 'var(--ld-cover-coral-from)', to: 'var(--ld-cover-coral-to)' },
  { id: 'slate', name: '石板', from: 'var(--ld-cover-slate-from)', to: 'var(--ld-cover-slate-to)' },
  { id: 'peach', name: '蜜桃', from: 'var(--ld-cover-peach-from)', to: 'var(--ld-cover-peach-to)' },
])

/**
 * 封面图 CSS：`background-image` + `background-position-y`。
 * @param {{preset?:string,offset?:number}} cover
 */
export function coverImageStyle(cover) {
  const preset = COVER_PRESETS.filter((entry) => entry.id === (cover && cover.preset))[0]
  const offset = cover && typeof cover.offset === 'number' ? cover.offset : 50
  // 本地上传的 data URL 优先于 preset（`uploadCover` 写的是 `{ preset: null, url }`）。
  if (cover && typeof cover.url === 'string' && cover.url) {
    return {
      backgroundColor: COVER_DEFAULT_BG,
      backgroundImage: `url("${cover.url}")`,
      backgroundSize: 'cover',
      backgroundPosition: `center ${offset}%`,
    }
  }
  if (!preset) return { backgroundColor: COVER_DEFAULT_BG }
  return {
    backgroundColor: COVER_DEFAULT_BG,
    backgroundImage: `linear-gradient(135deg, ${preset.from} 0%, ${preset.to} 100%)`,
    backgroundSize: 'cover',
    backgroundPosition: `center ${offset}%`,
  }
}

/**
 * 面板定位纯函数。
 *
 * §1.4.2 锚点实测：面板 top = 按钮 top(309) + 按钮高(30) + **5**；面板右缘贴视口右侧
 * （右缘 1456，距视口右 56 —— 那是「距封面槽右缘往内 8」的表现，这里按按钮右缘对齐
 * 再向视口内夹 8px，保证窄屏也开得出来）。图库态面板变宽，同样按右缘对齐（实测图库
 * 左缘 914 右缘 1456，仍是右缘对齐）。
 */
export function coverPanelStyle(anchorRect, size = COVER_PANEL_SIZE, viewport = {}) {
  if (!anchorRect) return { left: 0, top: 0 }
  const width = size.width || COVER_PANEL_SIZE.width
  const height = size.height || COVER_PANEL_SIZE.height
  const maxLeft = Math.max(8, (viewport.width || 0) - width - 8)
  const left = Math.min(Math.max((anchorRect.right || 0) - width, 8), maxLeft)
  let top = (anchorRect.bottom || 0) + 5
  const limit = (viewport.height || 0) - height - 8
  if (top > limit && limit > 8) top = limit
  return { left, top: Math.max(8, top) }
}

export default {
  props: {
    /** 受控封面：`{ preset, offset }`，`null` 表示无封面。宿主不传则由内核自持草稿态。 */
    cover: { type: Object, default: undefined },
  },
  data() {
    return {
      coverPanelOpen: false,
      /** 'menu' = 162×126 三项；'gallery' = 542×522 图库。 */
      coverStage: 'menu',
      /** 图库头部两个 Tab（§1.4.3）：'storehouse' 官方图库 / 'upload' 本地上传。 */
      coverTab: 'storehouse',
      /** 「调整图片位置」拖拽态：工具条切成取消/确认。 */
      coverRepositioning: false,
      /** 拖拽过程中的 offset 草稿（0–100）。 */
      coverDraftOffset: 50,
      coverPanelStyleValue: { left: 0, top: 0 },
      /** 宿主不传 prop 时的自持草稿（仍是同一份数据形状）。 */
      coverInternal: null,
    }
  },
  computed: {
    /** 当前封面（prop 优先，否则用内部草稿）。 */
    coverValue() {
      return this.cover !== undefined ? this.cover : this.coverInternal
    },
    coverExists() {
      return Boolean(this.coverValue)
    },
    /** 槽 + 图的样式；无图时只给默认灰底。 */
    coverSlotStyle() {
      return coverImageStyle(this.coverRepositioning ? { ...this.coverValue, offset: this.coverDraftOffset } : this.coverValue)
    },
    coverThumbGroups() {
      return [{ id: 'official', title: '官方图库', items: COVER_PRESETS }]
    },
  },
  methods: {
    /** 点「添加封面」：立刻落默认灰封面（§1.4.1 实测，不需要先选图）。 */
    addCover() {
      this.commitCover({ preset: null, offset: 50 })
    },
    removeCover() {
      this.closeCoverPanel()
      this.commitCover(null)
    },
    openCoverPanel(event) {
      const el = event && event.currentTarget
      if (!el || !el.getBoundingClientRect) return
      const rect = el.getBoundingClientRect()
      this.coverStage = 'menu'
      this.coverPanelOpen = true
      this.coverPanelStyleValue = coverPanelStyle(rect, COVER_PANEL_SIZE, {
        width: window.innerWidth,
        height: window.innerHeight,
      })
    },
    closeCoverPanel() {
      this.coverPanelOpen = false
      this.coverStage = 'menu'
      this.coverRepositioning = false
    },
    /** 三项点击：按 id 派发，不按下标（§1.4.3 红字）。 */
    onCoverPanelItem(id) {
      if (id === 'pick') return this.openCoverGallery()
      if (id === 'reposition') return this.startCoverReposition()
      if (id === 'remove') return this.removeCover()
      return undefined
    },
    openCoverGallery() {
      this.coverStage = 'gallery'
      this.$nextTick(this.measureCoverGallery)
    },
    measureCoverGallery() {
      const el = this.$refs && this.$refs.coverPanel
      if (!el) return
      const width = window.innerWidth
      const height = window.innerHeight
      const left = Math.max(8, width - COVER_GALLERY_SIZE.width - 8)
      this.coverPanelStyleValue = { left, top: Math.min(this.coverPanelStyleValue.top || 344, Math.max(8, height - COVER_GALLERY_SIZE.height - 8)) }
    },
    pickCover(presetId) {
      const offset = this.coverValue && typeof this.coverValue.offset === 'number' ? this.coverValue.offset : 50
      this.commitCover({ preset: presetId, offset })
      this.closeCoverPanel()
    },
    setCoverTab(tab) {
      this.coverTab = tab === 'upload' ? 'upload' : 'storehouse'
    },
    /** 图库头部「随机」：从 12 张里挑一张，且不与当前重复（§1.4.3 头部右组）。 */
    pickRandomCover() {
      const current = this.coverValue ? this.coverValue.preset : null
      const pool = COVER_PRESETS.filter((entry) => entry.id !== current)
      const hit = pool[Math.floor(Math.random() * pool.length)] || COVER_PRESETS[0]
      this.pickCover(hit.id)
    },
    startCoverReposition() {
      // 有图（preset 或本地上传的 url）才谈得上「位置」；纯灰底封面拖了也没变化。
      // 只看 preset 会让上传图的封面调不了位置 —— 上传时写的是 `{ preset: null, url }`。
      if (!this.coverValue || !(this.coverValue.preset || this.coverValue.url)) return
      this.closeCoverPanel()
      this.coverDraftOffset = typeof this.coverValue.offset === 'number' ? this.coverValue.offset : 50
      this.coverRepositioning = true
    },
    cancelCoverReposition() {
      this.coverRepositioning = false
    },
    confirmCoverReposition() {
      this.coverRepositioning = false
      this.commitCover({ ...this.coverValue, offset: this.coverDraftOffset })
    },
    /** 拖拽 / 键盘调整图片位置：offset 夹紧 0–100。 */
    setCoverDraftOffset(value) {
      const next = Number(value)
      if (!Number.isFinite(next)) return
      this.coverDraftOffset = Math.min(100, Math.max(0, next))
    },
    /** 本地上传 Tab：读取成 data URL，避免 Demo 依赖外链。 */
    async uploadCover(event) {
      const file = event && event.target && event.target.files ? event.target.files[0] : null
      if (!file) return
      if (typeof FileReader !== 'function') return
      const url = await new Promise((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
        reader.onerror = () => resolve('')
        reader.readAsDataURL(file)
      })
      if (!url) return
      this.commitCover({ preset: null, url, offset: 50 })
      this.closeCoverPanel()
    },
    commitCover(next) {
      if (this.cover === undefined) this.coverInternal = next
      this.$emit('cover-change', next)
    },
    coverContains(node) {
      return Boolean(node && node.closest && node.closest('.lark-doc-cover-layer'))
    },
  },
}
