/**
 * headingNumberMixin — 编号菜单（继续 / 重新开始 / 设置编号的值）。
 *
 * 与飞书对齐：编号是块级 UI（不是正文文本），点编号弹出三项菜单。
 * 菜单同时服务两种块 —— 标题编号（`heading.attrs.numbering*`）和
 * 列表序号（`listItem.attrs.numberStart`，等价 `<li value>`）：飞书里
 * 这两个序号都是可点的，弹的是同一套菜单，所以这里只有一套状态。
 *
 * 状态归属：编号值本身都不存文档，只存「起点」，由
 * computeHeadingNumbers / computeOrderedListNumbers 每帧算出来 —— 删除、移动、
 * 插入后编号自动更新，不需要任何补丁逻辑。
 */
// 编号值上限，与 documentOperations.HEADING_NUMBER_MAX 保持一致。
const NUMBER_MAX = 999

export default {
  data() {
    return {
      headingNumberMenu: { open: false, kind: 'heading', pos: -1, label: '', level: 1, value: null, canContinue: false, rect: null },
      headingNumberMenuStyle: {},
      headingNumberEditing: false,
      headingNumberDraft: '',
      // 提交闸门：Enter 提交后输入框随之卸载会再触发一次 blur，
      // 那次 blur 拿到的是已经被清空的 draft（=0，会被夹成 1），把刚设的值覆盖掉。
      headingNumberApplying: false,
      headingNumberActions: [
        { id: 'continue', label: '继续编号', icon: 'numbered-continue' },
        { id: 'restart', label: '重新开始编号', icon: 'numbered-restart' },
        { id: 'renumber', label: '设置编号的值', icon: 'numbered-value' },
      ],
    }
  },
  methods: {
    headingNumberTargetPos() {
      const pos = this.headingNumberMenu.pos
      if (this.editor && Number.isInteger(pos) && pos >= 0) return pos
      return this.handleRange?.from ?? -1
    },
    headingNumberMenuDisabled(id) {
      // 「继续编号」只在已经处于「重新开始 / 指定值」状态时可点（飞书同款禁用逻辑）
      return id === 'continue' && !this.headingNumberMenu.canContinue
    },
    /** 由编号按钮的 click 回调触发（extensions.js 里的 widget 拿不到 Vue 实例）。 */
    openHeadingNumberMenu(payload) {
      if (!this.writable() || !payload) return
      const value = Number(payload.value)
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
      this.headingNumberMenuStyle = {}
      this.headingNumberEditing = false
      this.headingNumberDraft = ''
      if (restoreFocus) this.$nextTick(() => this.editor?.view?.focus?.())
    },
    /** 菜单贴着编号左侧弹出（飞书实测：left 与编号左对齐，top = 编号底边 + 2）。 */
    positionHeadingNumberMenu() {
      const rect = this.headingNumberMenu.rect
      if (!rect) return
      const menu = this.$refs.root?.querySelector('.lark-doc-heading-number-menu')
      const width = menu?.getBoundingClientRect?.().width || 192
      const height = menu?.getBoundingClientRect?.().height || 108
      const gap = 8
      const left = Math.min(Math.max(gap, rect.left), Math.max(gap, window.innerWidth - width - gap))
      const below = rect.bottom + 2
      const top = below + height + gap <= window.innerHeight ? below : Math.max(gap, rect.top - height - 2)
      this.headingNumberMenuStyle = { left: `${Math.round(left)}px`, top: `${Math.round(top)}px` }
    },
    /**
     * 编号起点的唯一写入口：标题写 attrs.numberingStart，列表项写 attrs.numberStart。
     * `null` = 继续前序；数字 = 从该值起算。
     */
    applyBlockNumberStart(pos, value) {
      if (!this.editor || !Number.isInteger(pos)) return false
      if (this.headingNumberMenu.kind === 'list') return this.editor.commands.setLarkDocListItemNumber(pos, value)
      return this.editor.commands.setLarkDocHeadingNumber(pos, { numbering: true, numberingStart: value })
    },
    headingNumberAction(id) {
      const pos = this.headingNumberTargetPos()
      if (!this.writable() || pos < 0 || !this.editor) return
      if (id === 'continue') {
        // 列表的「继续编号」多一种语义：首项可以接上**前面紧邻**的另一个列表的序号
        //（两个相邻列表都从 1. 开始时，只清起点等于什么都没做）。
        if (this.headingNumberMenu.kind === 'list') this.editor.commands.continueLarkDocListNumber(pos)
        else this.applyBlockNumberStart(pos, null)
        this.closeHeadingNumberMenu({ restoreFocus: true })
        return
      }
      if (id === 'restart') {
        // 「重新开始编号」= 从该层初始编号（1）重开，飞书菜单项点击后即关闭。
        this.applyBlockNumberStart(pos, 1)
        this.closeHeadingNumberMenu({ restoreFocus: true })
        return
      }
      if (id === 'renumber') {
        // 就地变成输入框，值预填当前编号：标题取「2.」的末位数字，列表直接用真实序号
        //（列表是 a./i. 这类格式时 label 里没有数字，只能靠 value）。
        this.headingNumberEditing = true
        this.headingNumberApplying = false
        this.headingNumberDraft = String(this.headingNumberMenu.kind === 'list'
          ? (this.headingNumberMenu.value || 1)
          : this.trailingNumber(this.headingNumberMenu.label))
        this.$nextTick(() => {
          this.positionHeadingNumberMenu()
          const input = this.$refs.root?.querySelector('.lark-doc-heading-number-input')
          if (input) { input.focus(); input.select?.() }
        })
      }
    },
    trailingNumber(label) {
      const parts = String(label || '').replace(/\.$/, '').split('.')
      const last = Number(parts[parts.length - 1])
      return Number.isFinite(last) && last > 0 ? last : 1
    },
    applyHeadingNumberValue() {
      // 只认第一次提交：Enter → 关闭菜单 → 输入框卸载 → blur，第二次会拿着空 draft 把值重置成 1。
      if (this.headingNumberApplying) return
      const pos = this.headingNumberTargetPos()
      if (!this.writable() || pos < 0 || !this.editor) { this.closeHeadingNumberMenu(); return }
      const raw = Number(this.headingNumberDraft)
      // 空值 / 非数字 / 0 一律视为放弃修改，不要把编号悄悄改成 1。
      if (!Number.isFinite(raw) || raw <= 0) { this.closeHeadingNumberMenu({ restoreFocus: true }); return }
      this.headingNumberApplying = true
      const value = Math.max(1, Math.min(NUMBER_MAX, Math.round(raw)))
      this.applyBlockNumberStart(pos, value)
      this.closeHeadingNumberMenu({ restoreFocus: true })
      this.$nextTick(() => { this.headingNumberApplying = false })
    },
    onHeadingNumberInputKeydown(event) {
      if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); this.applyHeadingNumberValue() }
      else if (event.key === 'Escape') { event.preventDefault(); this.closeHeadingNumberMenu({ restoreFocus: true }) }
      else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault()
        const step = event.key === 'ArrowUp' ? 1 : -1
        this.headingNumberDraft = String(Math.max(1, Math.min(NUMBER_MAX, (Number(this.headingNumberDraft) || 1) + step)))
      }
    },
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
