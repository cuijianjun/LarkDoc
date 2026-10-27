/**
 * calloutColorMixin — 高亮块（callout）工具条、表情选择器、颜色盘，以及通用区块删除辅助。
 * 通过 this.editor、this.writable()、this.run()、this.$refs.root、this.handleRange 与主组件协作；
 * selectionPacingMixin 的 onSelectionUpdate 与主组件的 onDocumentScroll 会调用 updateCalloutTools；deleteBlockRange 也被
 * tableToolsMixin（删表）与 blockMenuMixin（删除区块/剪切）复用。
 * 采用 mixin 而非子组件：工具条与颜色盘模板留在主 SFC，依赖 Vue 2 选项合并语义。
 */
import { closeHistory } from '@tiptap/pm/history'
// 色板常量表（T0-04）：字面色只允许住在 palette.js，组件内一律引用常量。
import {
  TEXT_COLOR_OPTIONS,
  TEXT_BACKGROUND_ROWS,
  DEFAULT_TEXT_COLOR,
  calloutColorOptions,
  calloutDefaults,
} from './palette'
// 正文轨主题广播（T3-01）：色板是整组替换的两套色，必须跟着档位重算。
import { readContentTheme, subscribeContentTheme } from '../themeSignal'
// 表情面板全量（P4-03）：字形 / 中文名 / 9 组分类 / 搜索全部来自 core 的 catalog，
// 面板不再自维护 11 条硬编码；写入侧的归一化与 schema 校验共用同一张表。
import { emojiCategories, emojiItems, findEmojiByGlyph, findEmojiByName, searchEmoji } from '../../../core/emoji/catalog'
// 随机与「恢复默认样式」回落到与 schema 一致的 `💡`（02 §654），不再散落字面量。
import { CALLOUT_EMOJI_DEFAULT } from '../../../core/blocks/callout'

// 需求文档 13.4.4：颜色选择器有默认色、最近使用色和恢复默认色；最近使用跨会话保留。
const RECENT_COLORS_STORAGE_KEY = 'lark-doc:recent-colors'
const RECENT_TEXT_COLORS_STORAGE_KEY = 'lark-doc:recent-text-colors'

// 表情面板尺寸（02 §16 ④ 实测 456×392）。只用来判「工具条下方还放不放得下」，
// 真实宽高写在 CSS 里 —— 这里再取一次 DOM 尺寸只会多一次强制重排。
const CALLOUT_EMOJI_PANEL_HEIGHT = 392
const CALLOUT_EMOJI_PANEL_OFFSET = 8
// 工具条自身宽度（3 个取色 label + 3 个动作按钮各 30px + 5×2 gap + 左右 padding 4）
// 用来把工具条夹在纸张内：夹晚了工具条会被纸张右边缘切掉一截。
const CALLOUT_TOOLS_WIDTH = 190

function readColorList(key, limit = 8) {
  try {
    const value = JSON.parse(window.localStorage.getItem(key) || '[]')
    return Array.isArray(value) ? value.filter((color) => typeof color === 'string' && color).slice(0, limit) : []
  } catch (_) { return [] }
}

function writeColorList(key, colors) {
  try { window.localStorage.setItem(key, JSON.stringify(colors)) } catch (_) { /* 存储不可用时仅保留会话内记录 */ }
}

const readRecentColors = () => readColorList(RECENT_COLORS_STORAGE_KEY)
const writeRecentColors = (colors) => writeColorList(RECENT_COLORS_STORAGE_KEY, colors)

export default {
  data() { return {
    calloutEmojiOpen: false, calloutEmojiQuery: '', calloutEmojiCategory: 'all', calloutEmojiRecent: [], calloutEmojiPlacement: 'below', calloutToolsPosition: { top: 0, left: 0 },
    // 色板是两套色整组替换，所以只存档位、具体色值由 computed 现算（T3-03）。
    contentTheme: readContentTheme(),
    colorPaletteOpen: '', colorPalettePosition: { top: 0, left: 0 }, colorPaletteRecent: readRecentColors(), textColorRecent: readColorList(RECENT_TEXT_COLORS_STORAGE_KEY),
  } },
  computed: {
    // 色板随正文轨档位整组替换（06 §1.5.1：深纸上是独立一套去饱和暗色）。
    colorPaletteOptions() { return calloutColorOptions(this.contentTheme) },
    calloutDefaultColors() { return calloutDefaults(this.contentTheme) },
    // 分类 tab：9 个 emojibase 分组，「最近 / 全部」两个固定项在模板里写死（02 §16 ④）。
    calloutEmojiCategories() { return emojiCategories },
    // 「最近」只在会话内按名字记，跨会话不落盘；搜索对「最近」同样生效，否则切到最近像失灵。
    filteredCalloutEmojiItems() {
      const keyword = String(this.calloutEmojiQuery || '').trim().toLowerCase()
      const hit = (item) => !keyword
        || item.label.toLowerCase().indexOf(keyword) !== -1
        || item.value.indexOf(keyword) !== -1
        || item.glyph.indexOf(keyword) !== -1
      if (this.calloutEmojiCategory === 'recent') {
        return this.calloutEmojiRecent.map((name) => findEmojiByName(name)).filter(Boolean).filter(hit)
      }
      // 空分类 = 「全部」，由 catalog 内部跳过分类裁剪，省一次全量拷贝。
      return searchEmoji(keyword, this.calloutEmojiCategory === 'all' ? '' : this.calloutEmojiCategory)
    },
    colorPaletteTitle() {
      return { textColor: '文字颜色', textBackground: '背景颜色', calloutColor: '高亮块文字颜色', calloutBackground: '高亮块背景颜色', calloutBorder: '高亮块边框颜色' }[this.colorPaletteOpen] || '颜色'
    },
    colorPaletteIsText() { return this.colorPaletteOpen === 'textColor' || this.colorPaletteOpen === 'textBackground' },
    textColorOptions() { return TEXT_COLOR_OPTIONS },
    textBackgroundRows() { return TEXT_BACKGROUND_ROWS },
    activeTextColor() { return this.editor?.getAttributes('textStyle')?.color || '' },
    activeTextBackground() { return this.editor?.getAttributes('textStyle')?.backgroundColor || '' },
    colorPaletteStyle() {
      const width = this.colorPaletteIsText ? 280 : 232
      return { top: `${Math.max(8, Math.min(window.innerHeight - 300, this.colorPalettePosition.top))}px`, left: `${Math.max(8, Math.min(window.innerWidth - width - 8, this.colorPalettePosition.left))}px` }
    },
    activeCalloutVisible() { return this.writable() && !!this.activeCalloutElement() },
    calloutToolsStyle() { return { top: `${this.calloutToolsPosition.top}px`, left: `${this.calloutToolsPosition.left}px` } },
  },
  // mixin 的 created/beforeDestroy 与主组件的钩子合并执行（Vue 2 选项合并），
  // 这里只负责色板的档位订阅；主题广播的观察器全库只有一个（themeSignal）。
  created() {
    this._unsubscribeTheme = subscribeContentTheme(({ theme }) => { this.contentTheme = theme })
  },
  beforeDestroy() {
    if (this._unsubscribeTheme) { this._unsubscribeTheme(); this._unsubscribeTheme = null }
  },
  methods: {
    activeCalloutElement() {
      if (!this.editor) return null
      const { $from } = this.editor.state.selection
      for (let depth = $from.depth; depth > 0; depth -= 1) {
        if ($from.node(depth).type.name !== 'callout') continue
        const element = this.editor.view.nodeDOM($from.before(depth))
        return element instanceof Element ? element : null
      }
      return null
    },
    updateCalloutTools() {
      const callout = this.activeCalloutElement()
      const paper = this.$refs.root?.querySelector('.lark-doc-paper')
      if (!callout || !paper || !this.writable()) { this.calloutEmojiOpen = false; return }
      const rect = callout.getBoundingClientRect()
      const paperRect = paper.getBoundingClientRect()
      this.calloutToolsPosition = { top: Math.max(4, rect.top - paperRect.top - 44), left: Math.max(8, Math.min(paper.clientWidth - CALLOUT_TOOLS_WIDTH, rect.right - paperRect.left - CALLOUT_TOOLS_WIDTH)) }
    },
    // 未设置属性时回落到默认三色（色值集中在 palette.js，模板里不再写字面 hex）。
    calloutColor(name, fallback) { return this.editor?.getAttributes('callout')?.[name] || fallback || this.calloutDefaultColors[name] },
    setCalloutColor(name, value) { if (this.writable() && /^#[0-9a-f]{6}$/i.test(value)) this.run('updateAttributes', 'callout', { [name]: value }) },
    pickRandomCalloutEmoji() { return emojiItems[Math.floor(Math.random() * emojiItems.length)].glyph || CALLOUT_EMOJI_DEFAULT },
    // P0-03：表情搜索/分类的模板级赋值收敛为方法——子组件模板经 ed. 调用，避免 vue/no-mutating-props。
    setCalloutEmojiQuery(value) { this.calloutEmojiQuery = value },
    setCalloutEmojiCategory(category) { this.calloutEmojiCategory = category },
    /**
     * 开合表情面板（02 §16 ③ / ④）。
     *  - 面板 456×392 挂在工具条下方；下方放不下就翻到上方（`is-above`），
     *    否则靠近页底的块一点面板就顶出可视区；
     *  - 每次打开都回到「全部」并清空搜索，避免上次的过滤条件把人困在空列表里。
     */
    toggleCalloutEmoji() {
      if (!this.writable()) return
      if (this.calloutEmojiOpen) { this.closeCalloutEmoji(); return }
      this.calloutEmojiQuery = ''
      this.calloutEmojiCategory = 'all'
      const tools = this.$refs.root && this.$refs.root.querySelector('.lark-doc-callout-tools')
      const box = tools && tools.getBoundingClientRect ? tools.getBoundingClientRect() : null
      const room = box ? window.innerHeight - box.bottom : 0
      const fits = !!box && room >= CALLOUT_EMOJI_PANEL_HEIGHT + CALLOUT_EMOJI_PANEL_OFFSET
      this.calloutEmojiPlacement = fits ? 'below' : 'above'
      this.calloutEmojiOpen = true
    },
    closeCalloutEmoji() {
      this.calloutEmojiOpen = false
      this.calloutEmojiQuery = ''
      this.calloutEmojiCategory = 'all'
    },
    /**
     * 点图标 → 写进 callout 的 emoji 属性。**面板不关**（02 §16 ③ 实测：可以连续换几个再关），
     * Esc / 点外部由 overlayDismissMixin 收尾；图标写的是字形，最近列表记的是名字（落库形态）。
     */
    setCalloutEmoji(emoji) {
      if (!this.writable()) return
      const item = findEmojiByGlyph(emoji)
      if (item) this.calloutEmojiRecent = [item.value, ...this.calloutEmojiRecent.filter(value => value !== item.value)].slice(0, 8)
      this.run('updateAttributes', 'callout', { emoji })
    },
    toggleColorPalette(target, event) {
      if (!this.writable()) return
      // hover 已打开时点击不关闭（飞书行为：hover 弹窗靠移开鼠标关闭）。
      if (this._paletteHoverOpened && target === 'textColor' && this.colorPaletteOpen === 'textColor') return
      if (this.colorPaletteOpen === target) { this.colorPaletteOpen = ''; return }
      const rect = event?.currentTarget?.getBoundingClientRect?.()
      this.colorPaletteOpen = target
      this.colorPalettePosition = { top: (rect?.bottom || 80) + 6, left: rect?.left || 16 }
    },
    addRecentColor(value) {
      if (!value) return
      this.colorPaletteRecent = [value, ...this.colorPaletteRecent.filter(color => color !== value)].slice(0, 8)
      writeRecentColors(this.colorPaletteRecent)
    },
    addRecentTextColor(value) {
      if (!value) return
      this.textColorRecent = [value, ...this.textColorRecent.filter(color => color !== value)].slice(0, 8)
      writeColorList(RECENT_TEXT_COLORS_STORAGE_KEY, this.textColorRecent)
    },
    applyColorPalette(value, targetOverride) {
      if (!this.writable()) return
      const target = targetOverride || this.colorPaletteOpen
      if (target === 'textColor') {
        value ? this.run('setColor', value) : this.run('unsetColor')
        this.appliedTextStyle.textColor = value || DEFAULT_TEXT_COLOR
      } else if (target === 'textBackground') {
        value ? this.run('setBackgroundColor', value) : this.run('unsetBackgroundColor')
        this.appliedTextStyle.backgroundColor = value || 'transparent'
      } else if (target === 'calloutColor') this.run('updateAttributes', 'callout', { color: value || null })
      else if (target === 'calloutBackground') this.run('updateAttributes', 'callout', { backgroundColor: value || null })
      else if (target === 'calloutBorder') this.run('updateAttributes', 'callout', { borderColor: value || null })
      if (this.colorPaletteIsText) this.addRecentTextColor(value)
      else this.addRecentColor(value)
      this.colorPaletteOpen = ''
    },
    resetColorPalette() { this.applyColorPalette('') },
    // 恢复默认色：同时清掉文字颜色与背景高亮（需求 13.4.4）。
    resetTextColors() {
      if (!this.writable()) return
      this.run('unsetColor')
      this.run('unsetBackgroundColor')
      this.appliedTextStyle.textColor = DEFAULT_TEXT_COLOR
      this.appliedTextStyle.backgroundColor = 'transparent'
      this.colorPaletteOpen = ''
    },
    deletePreviousBlockOnBackspace() {
      if (!this.writable()) return false
      const { selection } = this.editor.state
      const { $from } = selection
      if (!selection.empty || $from.depth !== 1 || $from.parent.type.name !== 'paragraph' || $from.parentOffset !== 0) return false
      const index = $from.index(0)
      const previous = index > 0 ? $from.node(0).child(index - 1) : null
      if (!previous || !['table', 'columns'].includes(previous.type.name)) return false
      return this.deleteBlockRange({ from: $from.posAtIndex(index - 1, 0), to: $from.posAtIndex(index, 0), parentDepth: 0 })
    },
    resetCalloutStyle() { if (this.writable()) this.run('updateAttributes', 'callout', { backgroundColor: null, borderColor: null, color: null, emoji: CALLOUT_EMOJI_DEFAULT }) },
    deleteActiveCallout() {
      if (!this.writable()) return
      const { $from } = this.editor.state.selection
      for (let depth = $from.depth; depth > 0; depth -= 1) {
        if ($from.node(depth).type.name !== 'callout') continue
        const from = $from.before(depth)
        const to = $from.after(depth)
        this.deleteBlockRange({ from, to })
        this.closeCalloutEmoji()
        this.handleRange = null
        return
      }
    },
    deleteBlockRange(range) {
      if (!this.writable() || !range) return false
      const wasRootTail = (range.parentDepth || 0) === 0 && range.to >= this.editor.state.doc.content.size
      this.editor.view.dispatch(closeHistory(this.editor.state.tr))
      const tr = this.editor.state.tr.delete(range.from, range.to)
      if (!tr.doc.content.size || (wasRootTail && tr.doc.lastChild?.type.name !== 'paragraph')) {
        const paragraph = this.editor.schema.nodes.paragraph?.createAndFill()
        if (paragraph) tr.insert(tr.doc.content.size, paragraph)
      }
      this.editor.view.dispatch(tr)
      this.$nextTick(() => this.focus())
      return true
    },
  },
}
