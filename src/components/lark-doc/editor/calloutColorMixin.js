/**
 * calloutColorMixin — 高亮块（callout）工具条、表情选择器、颜色盘，以及通用区块删除辅助。
 * 通过 this.editor、this.writable()、this.run()、this.$refs.root、this.handleRange 与主组件协作；
 * 主组件的 onSelectionUpdate/onDocumentScroll 会调用 updateCalloutTools；deleteBlockRange 也被
 * tableToolsMixin（删表）与 blockMenuMixin（删除区块/剪切）复用。
 * 采用 mixin 而非子组件：工具条与颜色盘模板留在主 SFC，依赖 Vue 2 选项合并语义。
 */
import { closeHistory } from '@tiptap/pm/history'

const COLOR_PALETTE_OPTIONS = [
  { label: '墨绿', value: '#263b35' }, { label: '薄荷绿', value: '#d8f3e5' }, { label: '青绿', value: '#00b887' },
  { label: '天空蓝', value: '#dbeafe' }, { label: '靛蓝', value: '#586bff' }, { label: '暖黄', value: '#fff2a8' },
  { label: '橙色', value: '#ffb35c' }, { label: '珊瑚红', value: '#f58a8a' }, { label: '淡紫', value: '#eadcff' },
]

// 飞书式正文配色：字体颜色 A 字行（8 色）
const TEXT_COLOR_OPTIONS = [
  { label: '黑色', value: '#1f2329' }, { label: '灰色', value: '#646a73' }, { label: '红色', value: '#f54a45' },
  { label: '橙色', value: '#ff8800' }, { label: '黄色', value: '#dcad0c' }, { label: '绿色', value: '#00b42a' },
  { label: '蓝色', value: '#3491fa' }, { label: '紫色', value: '#722ed1' },
]

// 飞书式背景颜色：两行浅色网格，value 为空表示默认（斜杠格，清除背景色）
const TEXT_BACKGROUND_ROWS = [
  [
    { label: '默认', value: '' },
    { label: '浅红', value: '#fbd0d0' }, { label: '浅橙', value: '#fbd3a1' }, { label: '浅黄', value: '#fdeab4' },
    { label: '浅绿', value: '#bfecc7' }, { label: '浅青', value: '#aee9e4' }, { label: '浅蓝', value: '#b8d8f8' },
    { label: '浅紫', value: '#d9c4f1' }, { label: '浅灰', value: '#d5d9dc' },
  ],
  [
    { label: '樱红', value: '#fde9e8' }, { label: '杏橙', value: '#fdeacc' }, { label: '鹅黄', value: '#fff7d1' },
    { label: '草绿', value: '#e2f7e6' }, { label: '薄荷', value: '#ddf7f4' }, { label: '天蓝', value: '#e3f0fd' },
    { label: '香芋', value: '#efe5fa' }, { label: '云灰', value: '#f2f3f5' }, { label: '白', value: '#ffffff' },
  ],
]

// 需求文档 13.4.4：颜色选择器有默认色、最近使用色和恢复默认色；最近使用跨会话保留。
const RECENT_COLORS_STORAGE_KEY = 'lark-doc:recent-colors'
const RECENT_TEXT_COLORS_STORAGE_KEY = 'lark-doc:recent-text-colors'

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
    calloutEmojiOpen: false, calloutEmojiQuery: '', calloutEmojiCategory: 'all', calloutEmojiRecent: [], calloutToolsPosition: { top: 0, left: 0 },
    colorPaletteOpen: '', colorPalettePosition: { top: 0, left: 0 }, colorPaletteRecent: readRecentColors(), textColorRecent: readColorList(RECENT_TEXT_COLORS_STORAGE_KEY), colorPaletteOptions: COLOR_PALETTE_OPTIONS,
    emojiItems: [
      { value: 'smile', label: '微笑', glyph: '😄', category: '常用' }, { value: 'heart', label: '爱心', glyph: '❤️', category: '常用' },
      { value: 'thumbsup', label: '点赞', glyph: '👍', category: '常用' }, { value: 'tada', label: '庆祝', glyph: '🎉', category: '常用' },
      { value: 'pin', label: '图钉', glyph: '📌', category: '常用' }, { value: 'warning', label: '警告', glyph: '⚠️', category: '提示' },
      { value: 'check', label: '完成', glyph: '✅', category: '状态' }, { value: 'comment', label: '讨论', glyph: '💬', category: '沟通' },
      { value: 'target', label: '目标', glyph: '🎯', category: '目标' }, { value: 'fire', label: '重点', glyph: '🔥', category: '重点' },
      { value: 'star', label: '星星', glyph: '🌟', category: '重点' },
    ],
  } },
  computed: {
    calloutEmojiCategories() { return [...new Set(this.emojiItems.map(item => item.category).filter(Boolean))] },
    filteredCalloutEmojiItems() {
      const query = this.calloutEmojiQuery.toLocaleLowerCase()
      const recent = this.calloutEmojiRecent.map(value => this.emojiItems.find(item => item.value === value)).filter(Boolean)
      const source = this.calloutEmojiCategory === 'recent' ? recent : this.calloutEmojiCategory === 'all' ? this.emojiItems : this.emojiItems.filter(item => item.category === this.calloutEmojiCategory)
      return source.filter(item => !query || `${item.label} ${item.value} ${item.glyph}`.toLocaleLowerCase().includes(query))
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
      this.calloutToolsPosition = { top: Math.max(4, rect.top - paperRect.top - 44), left: Math.max(8, Math.min(paper.clientWidth - 190, rect.right - paperRect.left - 190)) }
    },
    calloutColor(name, fallback) { return this.editor?.getAttributes('callout')?.[name] || fallback },
    setCalloutColor(name, value) { if (this.writable() && /^#[0-9a-f]{6}$/i.test(value)) this.run('updateAttributes', 'callout', { [name]: value }) },
    pickRandomCalloutEmoji() { return this.emojiItems[Math.floor(Math.random() * this.emojiItems.length)]?.glyph || '💡' },
    // P0-03：表情搜索/分类的模板级赋值收敛为方法——子组件模板经 ed. 调用，避免 vue/no-mutating-props。
    setCalloutEmojiQuery(value) { this.calloutEmojiQuery = value },
    setCalloutEmojiCategory(category) { this.calloutEmojiCategory = category },
    toggleCalloutEmoji() { if (!this.writable()) return; this.calloutEmojiOpen = !this.calloutEmojiOpen; if (this.calloutEmojiOpen) this.calloutEmojiCategory = 'all'; else { this.calloutEmojiQuery = ''; this.calloutEmojiCategory = 'all' } },
    setCalloutEmoji(emoji) {
      if (!this.writable()) return
      const item = this.emojiItems.find(candidate => candidate.glyph === emoji)
      if (item) this.calloutEmojiRecent = [item.value, ...this.calloutEmojiRecent.filter(value => value !== item.value)].slice(0, 8)
      this.run('updateAttributes', 'callout', { emoji })
      this.calloutEmojiOpen = false
      this.calloutEmojiQuery = ''
      this.calloutEmojiCategory = 'all'
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
        this.appliedTextStyle.textColor = value || '#263b35'
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
      this.appliedTextStyle.textColor = '#263b35'
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
    resetCalloutStyle() { if (this.writable()) this.run('updateAttributes', 'callout', { backgroundColor: null, borderColor: null, color: null, emoji: '💡' }) },
    deleteActiveCallout() {
      if (!this.writable()) return
      const { $from } = this.editor.state.selection
      for (let depth = $from.depth; depth > 0; depth -= 1) {
        if ($from.node(depth).type.name !== 'callout') continue
        const from = $from.before(depth)
        const to = $from.after(depth)
        this.deleteBlockRange({ from, to })
        this.calloutEmojiOpen = false
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
