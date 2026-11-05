/**
 * dialogsUiMixin — 弹窗 / 抽屉 / 内嵌浮层原生化接线层（阶段 5 批次 4）。
 *
 * 与 `commandMenuUiMixin` / `bubbleMenuMixin` 同一套范式：DOM 由 `src/ui/dialogs.js`
 * （纯 DOM、零框架）创建，本 mixin 只做「把状态算成一份 state → 推给 UI」。
 * 五个弹窗原有的开合/校验/落块逻辑一行没动，全留在 `toolbarMenusMixin` /
 * `tableToolsMixin` / `commandMenuMixin` 里。
 *
 * 三条必须守住的线：
 *
 * 1. **`open` 就是原 `v-if` 的那个条件**（`tablePicker` / `mathDialog` / `linkDialog` /
 *    `helpOpen` / `embedDialog`）。原模板里 `v-if` 为假时组件整棵销毁，原生层用
 *    「从宿主摘节点」对齐 —— 断言用 `querySelector` 找不到才是对的，只 `display:none`
 *    会让 `measureDialog()` 多量出一层。
 * 2. **「打开即聚焦」从 `$nextTick` + `querySelector` 改成同步 `focus()`**：原生层
 *    `update()` 里已经把节点插进文档，紧接着 `focus()` 就能生效，不再需要等一拍。
 *    表格选择器尤其依赖这条：聚焦首格会再触发一次 `preview(1, 1)`，稳态 **1 × 1**
 *    是「复位 3×3 → 渲染 → 聚焦首格」三步接力出来的，顺序不能动。
 * 3. **五个弹层共用一个宿主**（`ref="dialogHost"`）。它们各自 `position: fixed`
 *    （内嵌浮层的 `fixed` 由 `embedDialogPos` 给），父级是谁不影响定位，而样式全是
 *    `.lark-doc .lark-doc-dialog*` 后代选择器，多一层空 div 不丢样式。
 */
import {
  createEmbedDialog,
  createHelpDrawer,
  createLinkDialog,
  createMathDialog,
  createTablePickerDialog,
} from '../../../ui/dialogs'

export default {
  watch: {
    /**
     * 表格选择器：复位 → 渲染 → 聚焦首格。
     *
     * 复位必须在渲染前（否则会先画出上一次的 5×3），聚焦必须在渲染后（节点不在文档里
     * `focus()` 静默失败，稳态就卡在 3×3）。原 watch 里 `$nextTick` 的那一拍在这里
     * 由「原生渲染是同步的」替代。
     */
    tablePicker(value) {
      if (value) this.tablePickerHover = { rows: 3, cols: 3 }
      this.refreshDialogs()
      if (value) this._dialogsUi?.table.focusTableGrid()
    },
    tablePickerHover: { deep: true, handler() { this.refreshDialogs() } },
    // 公式：错误行是 `v-if`（`role="alert"`），文案与错误态都要重推。
    mathDialog(value) { this.refreshDialogs(); if (value) this._dialogsUi?.math.focusInput() },
    mathValue() { this.refreshDialogs() },
    mathError() { this.refreshDialogs() },
    // 链接：插入 / 编辑两形态差两段（v-if），两个按钮的 disabled 也得跟着算。
    linkDialog(value) { this.refreshDialogs(); if (value) this._dialogsUi?.link.focusFirstField() },
    linkInsertMode() { this.refreshDialogs() },
    linkValue() { this.refreshDialogs() },
    linkText() { this.refreshDialogs() },
    // 快捷键抽屉：静态内容，只开关 + 关闭即聚焦关闭钮（`Esc` 之后焦点不丢）。
    helpOpen(value) { this.refreshDialogs(); if (value) this._dialogsUi?.help.focusClose() },
    // 内嵌浮层：标题/placeholder 由菜单项现查，拒绝态只改「确认」按钮底色。
    embedDialog(value) { this.refreshDialogs(); if (value) this._dialogsUi?.embed.focusInput() },
    embedValue() { this.refreshDialogs() },
    embedDialogRejected() { this.refreshDialogs() },
    embedDialogPos: { deep: true, handler() { this.refreshDialogs() } },
  },
  methods: {
    /** 挂载五个原生弹层（由主组件 `mounted` 调用，不依赖编辑器实例）。 */
    mountDialogs() {
      if (this._dialogsUi) return
      const host = this.$refs.dialogHost
      if (!host) return
      const handlers = this.dialogsHandlers()
      this._dialogsUi = {
        table: createTablePickerDialog({ host, handlers: handlers.table }),
        math: createMathDialog({ host, handlers: handlers.math }),
        link: createLinkDialog({ host, handlers: handlers.link }),
        help: createHelpDrawer({ host, handlers: handlers.help }),
        embed: createEmbedDialog({ host, handlers: handlers.embed }),
      }
      this.refreshDialogs()
    },
    destroyDialogs() {
      const ui = this._dialogsUi
      if (!ui) return
      Object.keys(ui).forEach((key) => ui[key].destroy())
      this._dialogsUi = null
    },

    /**
     * handler 全表（键名与 `src/ui/dialogs.js` 里的 `call('onXxx')` 一一对应）。
     *
     * 关闭一律走 `closeOverlay()` —— 与 SFC 的 `@click.self="ed.closeOverlay"` /
     * `@click="ed.closeOverlay"` 同一个入口（`closeOverlay` 的单行互斥链自己会算
     * 「这次该收哪一层」）。唯一例外是内嵌浮层：它刻意不在那条链里，
     * 关自己只认 `closeEmbedDialog()`。
     */
    dialogsHandlers() {
      return {
        table: {
          onPreview: (rows, cols) => this.previewTableSize(rows, cols),
          onInsert: (rows, cols) => this.insertTable(rows, cols),
          onClose: () => this.closeOverlay(),
        },
        math: {
          onInput: (value) => this.setMathValue(value),
          onSubmit: () => this.insertMath(),
          onClose: () => this.closeOverlay(),
        },
        link: {
          onTextInput: (value) => this.setLinkText(value),
          onValueInput: (value) => this.setLinkValue(value),
          onApply: () => this.applyLink(),
          onRemove: () => this.removeLink(),
          onClose: () => this.closeOverlay(),
        },
        help: { onClose: () => this.closeOverlay() },
        embed: {
          onInput: (value) => this.setEmbedValue(value),
          onApply: () => this.applyEmbedDialog(),
          onHelp: (viewer) => this.openEmbedHelp(viewer),
          onClose: () => this.closeEmbedDialog(),
        },
      }
    },

    /** 一份 state 推平（原 `<table-picker-dialog :ed :math-dialog :link-dialog :help-dialog :embed-link-dialog>`）。 */
    buildDialogsState() {
      return {
        table: { open: !!this.tablePicker, rows: this.tablePickerHover.rows, cols: this.tablePickerHover.cols },
        math: { open: !!this.mathDialog, value: this.mathValue, error: this.mathError },
        link: {
          open: !!this.linkDialog,
          insertMode: !!this.linkInsertMode,
          value: this.linkValue,
          text: this.linkText,
          // `:disabled="ed.linkInsertMode || !ed.isActive('link')"` 的那一半：
          // 弹窗打开期间编辑器的选区是冻结的，算一次就够，不必挂进热路径。
          linkActive: this.isActive('link'),
        },
        help: { open: !!this.helpOpen },
        embed: {
          open: !!this.embedDialog,
          title: this.embedDialogTitle,
          placeholder: this.embedDialogPlaceholder,
          value: this.embedValue,
          rejected: !!this.embedDialogRejected,
          position: this.embedDialogPos,
        },
      }
    },

    refreshDialogs() {
      const ui = this._dialogsUi
      if (!ui) return
      const state = this.buildDialogsState()
      ui.table.update(state.table)
      ui.math.update(state.math)
      ui.link.update(state.link)
      ui.help.update(state.help)
      ui.embed.update(state.embed)
    },
  },
}
