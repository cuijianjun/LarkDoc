/**
 * 代码语言选择器（requirements/04 §2.2）。
 *
 * 为什么「触发」要走模块信号而不是 props：
 *   codeBlock 的 NodeView 在 ProseMirror 渲染树里，**拿不到**
 *   LarkDocEditor 实例（也拿不到上层 ref）—— `adapters/vue2/nodeviews.js` 只把它注册成
 *   节点渲染器（Vue 2 专属实现，不在 core 目录内）。而真正的浮层必须挂在 `LarkDocOverlays.vue`（`LarkDocEditor.vue` 有
 *   <700 行门禁，且 fixed 元素要兄弟层）。两端之间因此用一条**模块级信号**连线，
 *   与 `themeSignal.js` 同为「订阅式、无实例引用」的通道。
 *
 *   信号带着 `editor`（tiptap Editor 实例）一起走，宿主收到后比对身份再决定要不要开，
 *   同页多实例不会互相串台。
 *
 * 三条实测口径（改这里前先看）：
 *   1. **选完立即关闭**（§2.2 ②）：点选 → 回调 → 关闭，**没有确认按钮**。
 *   2. **只改 `attrs.language`，正文文本一个字节都不动**（§2.2 ②「改」行）。
 *   3. **`Plain Text` 就是「无语言」**，没有独立的删除入口（§2.2 ②「删」行）。
 */
import {
  CODE_LANG_PICKER_SIZE,
  codeLangPickerStyle,
  codeLanguageLabel,
  filterCodeLanguages,
} from './codeLanguages'
import { subscribeCodeLangPicker } from './codeLangSignal'

export default {
  data() {
    return {
      codeLangOpen: false,
      codeLangPos: null,
      /** 当前语言的显示名（用于 `#336DF4` 高亮当前项）。 */
      codeLangValue: 'Plain Text',
      codeLangQuery: '',
      codeLangStyle: { left: 0, top: 0 },
      /** 信号退订器（beforeDestroy 里要用）。 */
      _codeLangOff: null,
    }
  },
  mounted() {
    this._codeLangOff = subscribeCodeLangPicker(this.onCodeLangRequest)
  },
  beforeDestroy() {
    if (this._codeLangOff) { this._codeLangOff(); this._codeLangOff = null }
  },
  computed: {
    /** 搜索过滤后的列表（子串、大小写不敏感、保持原序）。 */
    codeLangItems() {
      return filterCodeLanguages(this.codeLangQuery)
    },
  },
  methods: {
    /** NodeView → 宿主：`{ editor, pos, language, rect }`。 */
    onCodeLangRequest(payload) {
      if (!payload || payload.editor !== this.editor) return
      if (!this.writable()) return
      this.codeLangPos = typeof payload.pos === 'number' ? payload.pos : null
      this.codeLangValue = codeLanguageLabel(payload.language)
      this.codeLangQuery = ''
      this.codeLangOpen = true
      this.codeLangStyle = codeLangPickerStyle(payload.rect, CODE_LANG_PICKER_SIZE, {
        width: window.innerWidth,
        height: window.innerHeight,
      })
      this.$emit('code-lang-open', payload)
    },
    /**
     * 搜索框输入。
     *
     * 为什么要用方法来接而不是在视图里直接改 `ed.codeLangQuery`：`ed` 是 prop，
     * 直接赋值会触发 `vue/no-mutating-props`（`plugin:vue/recommended` 内置）。
     * 全库浮层组件都走「视图只读 ed、写入一律调方法」这一条口径。
     */
    setCodeLangQuery(value) {
      this.codeLangQuery = String(value === null || value === undefined ? '' : value)
    },
    closeCodeLangPicker() {
      if (!this.codeLangOpen) return
      this.codeLangOpen = false
      this.codeLangQuery = ''
      this.codeLangPos = null
    },
    /**
     * 选语言：只动节点 attrs。
     *
     * `pos` 可能因为期间插入/删除而失效，所以每次都以「doc.nodeAt(pos) 是不是 codeBlock」
     * 复核一遍 —— 失效就静默放弃（相当于没点），不要把语言写到别的块上。
     */
    pickCodeLanguage(id) {
      // ⚠️ 先把 pos 抓在手里再关闭：`closeCodeLangPicker()` 会把 `codeLangPos` 清成 null，
      // 反过来写就等于「点了语言但什么都没发生」—— 这种失败不抛错，只会让人以为选择器是坏的。
      const pos = this.codeLangPos
      this.closeCodeLangPicker()
      if (typeof pos !== 'number') return
      const tr = this.editor.state.tr
      const node = tr.doc.nodeAt(pos)
      if (!node || node.type.name !== 'codeBlock') return
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, language: id })
      this.editor.view.dispatch(tr)
      this.$emit('code-lang-change', { pos, language: id })
    },
    codeLangContains(node) {
      return Boolean(node && node.closest && node.closest('.lark-doc-code-lang, .lark-doc-code-lang-trigger'))
    },
  },
}
