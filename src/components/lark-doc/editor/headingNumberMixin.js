/**
 * headingNumberMixin — 编号菜单（继续 / 重新开始 / 设置编号的值）。
 *
 * 与飞书对齐：编号是块级 UI（不是正文文本），点编号弹出三项菜单。
 * 菜单同时服务两种块 —— 标题编号（`heading.attrs.numbering*`）和
 * 列表序号（`listItem.attrs.numberStart`，等价 `<li value>`）：飞书里
 * 这两个序号都是可点的，弹的是同一套菜单，所以这里只有一套状态。
 *
 * 状态归属：编号值本身都不存文档，只存「起点与编号层级」，由
 * computeHeadingNumbers / computeOrderedListNumbers 每帧算出来 —— 删除、移动、
 * 插入后编号自动更新，不需要任何补丁逻辑。
 */
export default {
  data() {
    return {
      headingNumberMenu: { open: false, kind: 'heading', pos: -1, label: '', level: 1, value: null, canContinue: false, rect: null },
      headingNumberMenuStyle: {},
      headingNumberEditing: false,
      headingNumberDraft: '',
      // 提交闸门：确认后的迟到事件不能再用清空的草稿覆盖编号。
      headingNumberApplying: false,
    }
  },
  methods: {
    headingNumberTargetPos() {
      const pos = this.headingNumberMenu.pos
      if (this.editor && this.editor.state.doc === this._headingNumberDoc && Number.isInteger(pos) && pos >= 0) return pos
      return -1
    },
    /** 由编号按钮的 click 回调触发（extensions.js 里的 widget 拿不到 Vue 实例）。 */
    openHeadingNumberMenu(payload) {
      if (!this.writable() || !payload) return
      const value = Number(payload.value)
      this._headingNumberDoc = this.editor.state.doc
      this.headingNumberMenu = {
        open: true,
        kind: payload.kind === 'list' ? 'list' : 'heading',
        pos: payload.pos,
        label: payload.label || '',
        level: payload.level || 1,
        value: Number.isFinite(value) && value > 0 ? value : null,
        canContinue: payload.canContinue === true,
        rect: payload.rect || null,
      }
      this.headingNumberEditing = false
      this.headingNumberApplying = false
      this.headingNumberDraft = ''
      this.$nextTick(() => this.positionHeadingNumberMenu())
    },
    /** 列表序号（1. / a. / i.）点击：同一套菜单，只是写入口不同。 */
    openListNumberMenu(payload) {
      this.openHeadingNumberMenu({ ...payload, kind: 'list' })
    },
    closeHeadingNumberMenu({ restoreFocus = false } = {}) {
      if (!this.headingNumberMenu.open) return
      this.headingNumberMenu = { open: false, kind: 'heading', pos: -1, label: '', level: 1, value: null, canContinue: false, rect: null }
      this._headingNumberDoc = null
      this.headingNumberMenuStyle = {}
      this.headingNumberEditing = false
      this.headingNumberDraft = ''
      if (restoreFocus) this.$nextTick(() => this.editor?.view?.focus?.())
    },
    ...Object.fromEntries(["positionHeadingNumberMenu", "applyBlockNumberStart", "headingNumberAction", "trailingNumber", "applyHeadingNumberValue", "onHeadingNumberInputKeydown", "stepHeadingNumberDraft"].map(name => [name, function (...args) { return this._headingNumberRuntime?.[name](...args) }])),
    setHeadingNumberDraft(value) { this.headingNumberDraft = value },
    /** 给标题开启/关闭编号（块菜单、工具栏、快捷键共用）。 */
    toggleHeadingNumbering() {
      if (!this.writable() || !this.editor) return false
      const range = this.handleActionRange?.() || this.currentBlockRange?.()
      const pos = range?.from
      if (!Number.isInteger(pos)) return false
      const node = this.editor.state.doc.nodeAt(pos)
      if (!node || node.type.name !== 'heading') { this.error = '只有标题可以加编号'; return false }
      this.editor.commands.toggleLarkDocHeadingNumber(pos)
      this.$nextTick(() => this.positionBlockHandle(this.handleRange || this.currentBlockRange()))
      return true
    },
    headingNumberingActive() {
      const range = this.handleRange || this.currentBlockRange?.()
      const node = this.editor?.state?.doc?.nodeAt?.(range?.from ?? -1)
      return Boolean(node && node.type.name === 'heading' && node.attrs?.numbering)
    },
  },
}
