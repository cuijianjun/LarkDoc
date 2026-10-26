/**
 * 导出设置弹窗（P6b-04 导出线）—— 弹窗开关、三档切换、导出派发、toast、canExport 闸门。
 *
 * 规格：requirements/04 §4.6.7②（三档同壳 720×215）/ ③（交互闭环）/ ④（提交后 toast 与下载）。
 *
 * 五条负结论（别实现）：
 *   1. **「导出正文及评论」不真的带评论**。评论线不在本线交付范围，本线只把该档位
 *      透传进派发参数，不伪造评论内容、也不因为「暂时没实现」就把这一档藏掉 ——
 *      藏了就等于改了三档同壳的规格。
 *   2. **点「取消」零请求**（§4.6.7③ 实测 `creates=0`）：`cancelExport` 只关弹窗，
 *      不碰 utils/export 里任何一个函数，不发 fetch、不生成 Blob。
 *   3. **无权限不隐藏入口**：只置灰（`canExport` 为假 → 按钮 disabled、点击直接 return），
 *      权限判断一律 `session.can('canExport')`，**不自判角色、不读 user 对象**
 *      （authorization.js 的注释：能力集合是服务端最终判断）。
 *   4. **toast 不显示进度、不变「导出成功」**（§4.6.7④）：处理中保持同一文案
 *      「正在导出文档」，落盘后**自行消失**。所以这里没有「成功/失败」两种 toast。
 *   5. **不在这里做格式实现**：markdown/docx/pdf 三个产物全部由 utils/export/index.js
 *      产出，本 mixin 只负责「取文档 → 取文件名 → 派发 → 收 toast」。
 *
 * 为什么三档共用一个 mixin 而不是三个：
 *   规格明写「三档共用同一个弹窗壳，只有标题与选项文案不同」，壳一分为三就会各自
 *   长出一套默认值与派发分支，切档时极易出现「默认项残留上一档的值」——这正是
 *   §4.6.7② 红字强调「默认不是全量」想避免的问题。所以档位定义收进 EXPORT_FORMATS
 *   一张表，打开弹窗时**按档重设默认值**，从不继承上一次的选择。
 */
import { exportDocx, exportMarkdown, exportPdf, safeFileName } from '../../../utils/export/index.js'

/**
 * 三档定义。顺序 = 「更多 → 下载为」二级菜单的实测顺序（Word / PDF / Markdown，
 * §4.6.7① 的 y=418/452/486）。
 *
 * `defaultScope` 是 §4.6.7② 红字：PDF/Word 默认「仅正文」，Markdown 默认「仅文本」。
 */
export const EXPORT_FORMATS = Object.freeze([
  {
    id: 'word',
    label: 'Word',
    extension: 'docx',
    defaultScope: 'contentOnly',
    options: [
      { value: 'withComments', label: '导出正文及评论' },
      { value: 'contentOnly', label: '仅正文' },
    ],
  },
  {
    id: 'pdf',
    label: 'PDF',
    extension: 'pdf',
    defaultScope: 'contentOnly',
    options: [
      { value: 'withComments', label: '导出正文及评论' },
      { value: 'contentOnly', label: '仅正文' },
    ],
  },
  {
    id: 'markdown',
    label: 'Markdown',
    extension: 'md',
    defaultScope: 'textOnly',
    options: [
      { value: 'textOnly', label: '仅文本（不含图片和附件）' },
      { value: 'all', label: '所有内容' },
    ],
  },
])

/** 提交后的 toast 文案（§4.6.7④：处理中与成功都是这一句，且不变文案）。 */
export const EXPORT_TOAST_TEXT = '正在导出文档'

/** 拿不到标题时的文件名兜底（utils/export/index.js 的 safeFileName 也兜一层，这里再兜一次只为展示）。 */
export const EXPORT_FILE_NAME_FALLBACK = 'document'

function formatDefOf(id) {
  for (let i = 0; i < EXPORT_FORMATS.length; i += 1) {
    if (EXPORT_FORMATS[i].id === id) return EXPORT_FORMATS[i]
  }
  return null
}

export default {
  data() {
    return {
      /** 弹窗开关。三档共用这一个开关，档位看 `exportFormat`。 */
      exportOpen: false,
      /** 当前档位 id（'' = 未开）。 */
      exportFormat: '',
      /** 内容范围选项值。打开弹窗时按档重设为该档默认值，不继承上次选择。 */
      exportScope: '',
      /** 提交后的顶部提示条文案；空串 = 不显示。 */
      exportToast: '',
      /** 派发中：只用于挡住重复点击，不用于显示进度（见负结论 4）。 */
      exportBusy: false,
    }
  },
  computed: {
    /**
     * 权限闸门。与 `effectiveReadonly` 同口径：拿不到 session 时视为「无权可证」→ 放行，
     * 而不是一律置灰 —— 编辑器在纯展示 demo 里经常没有 session。
     */
    exportCanExport() {
      if (!this.session || typeof this.session.can !== 'function') return true
      return !!this.session.can('canExport')
    },
    /** 当前档位定义；未开 / 未知档返回 null，模板靠它整块 v-if。 */
    exportFormatDef() {
      return formatDefOf(this.exportFormat)
    },
    /** 弹窗标题：`导出 X 设置`（§4.6.7② 三档差异表）。 */
    exportPanelTitle() {
      const def = this.exportFormatDef
      return def ? `导出 ${def.label} 设置` : ''
    },
    /** 两个 radio 的文案，顺序恒为「选项1 / 选项2」。 */
    exportScopeOptions() {
      const def = this.exportFormatDef
      return def ? def.options : []
    },
    /** 实际生效的范围值：没选过就用该档默认值。 */
    exportScopeValue() {
      const def = this.exportFormatDef
      if (!def) return ''
      for (let i = 0; i < def.options.length; i += 1) {
        if (def.options[i].value === this.exportScope) return this.exportScope
      }
      return def.defaultScope
    },
    /** 置灰态：无权限或正在派发。渲染层只加 disabled 类，**不隐藏**（负结论 3）。 */
    exportSubmitDisabled() {
      return !this.exportCanExport || this.exportBusy
    },
    /** 导出文件名（不含扩展名）：取编辑器标题，空标题回落到常量。 */
    exportFileBaseName() {
      const title = this.localTitle || this.title || ''
      return safeFileName(title || EXPORT_FILE_NAME_FALLBACK)
    },
  },
  mounted() {
    // Esc 挂 window 捕获阶段：根元素那句 `@keydown.esc="closeOverlay"` 是冒泡监听，
    // 这里先手 + `stopPropagation`，弹窗开时才不会被 closeOverlay 的互斥链顺手收掉
    // 别的浮层（overlayDismissMixin 不认识导出弹窗，别去改那个共享文件）。
    window.addEventListener('keydown', this.onExportKeydown, true)
  },
  beforeDestroy() {
    window.removeEventListener('keydown', this.onExportKeydown, true)
  },
  methods: {
    // —— 开关 ——
    /** 打开某一档。无权限直接 return（置灰态的第二次保险）。 */
    openExportDialog(format) {
      if (!this.exportCanExport) return
      const def = formatDefOf(format)
      if (!def) return
      this.exportFormat = def.id
      this.exportScope = def.defaultScope
      this.exportOpen = true
    },
    closeExportDialog() {
      this.exportOpen = false
    },
    /** 点「取消」：只关弹窗，**零请求**（负结论 2）。 */
    cancelExport() {
      this.closeExportDialog()
    },
    /** 切 radio：纯前端状态，不发请求（§4.6.7③）。 */
    selectExportScope(value) {
      this.exportScope = value
    },
    onExportKeydown(event) {
      if (!this.exportOpen) return
      if (event.key !== 'Escape' && event.key !== 'Esc') return
      event.stopPropagation()
      this.closeExportDialog()
    },

    // —— 提交 ——
    /**
     * 点「导出」：关弹窗 → 出 toast → 派发 → 产物落盘后 toast 自行消失（§4.6.7④）。
     *
     * 顺序刻意是「先关再派发」：实测里弹窗在 toast 出现之前就消失了，反过来做会让
     * 用户看到弹窗卡在屏幕上直到文件生成完。
     */
    async submitExport() {
      if (!this.exportCanExport || this.exportBusy) return
      const def = this.exportFormatDef
      if (!def) return
      const format = def.id
      const scope = this.exportScopeValue
      const fileName = this.exportFileBaseName
      this.closeExportDialog()
      this.exportBusy = true
      this.exportToast = EXPORT_TOAST_TEXT
      try {
        await this.dispatchExport(format, scope, fileName)
      } finally {
        this.exportBusy = false
        // PDF 是唯一「完成时机由用户在打印框里决定」的一档，toast 由 onPrinted 收，
        // 这里不再清一次 —— 否则打印框还没关提示条就没了。
        if (format !== 'pdf') this.exportToast = ''
      }
    },
    /** 按档派发。返回 Promise（PDF 同步返回，await 一下统一形态）。 */
    dispatchExport(format, scope, fileName) {
      if (format === 'markdown') return this.dispatchMarkdown(scope, fileName)
      if (format === 'word') return this.dispatchDocx(scope, fileName)
      if (format === 'pdf') return this.dispatchPdf(scope, fileName)
      return Promise.resolve(null)
    },
    /**
     * Markdown 档：`textOnly` = 不含图片和附件。
     *
     * **范围语义不在这一层解释**：本 mixin 只把 UI 选中的 `scope` 原样传给出口层，
     * 「textOnly 要丢图片」「附件本来就不落盘」这些规则归 utils/export/index.js，
     * 否则同一个档位会在两处各判一次，改一处漏一处。
     */
    dispatchMarkdown(scope, fileName) {
      const doc = this.currentDoc()
      if (!doc) return Promise.resolve(null)
      return Promise.resolve(exportMarkdown(doc, { fileName, scope }))
    },
    /** Word 档：`scope` 只透传，本线不附带评论内容（负结论 1）。 */
    dispatchDocx(scope, fileName) {
      const doc = this.currentDoc()
      if (!doc) return Promise.resolve(null)
      return exportDocx(doc, { fileName, title: fileName, scope })
    },
    /**
     * PDF 档走浏览器打印，文件名由用户在系统打印框里定。
     * `onPrinted` 在打印框关闭（afterprint）时触发，用来收掉 toast。
     */
    dispatchPdf(scope, fileName) {
      const result = exportPdf(this.$refs ? this.$refs.root : null, {
        title: fileName,
        scope,
        onPrinted: () => { this.exportToast = '' },
      })
      if (!result || !result.ok) this.exportToast = ''
      return Promise.resolve(result)
    },

    // —— 取数 ——
    /**
     * 当前文档 JSON。拿 editor 的 `getJSON()` 而不是 `state.doc`：
     * 序列化层要的是普通对象（单测里也是 JSON），传节点实例会让 Node 侧单测必须伪造实例。
     */
    currentDoc() {
      if (!this.editor || typeof this.editor.getJSON !== 'function') return null
      return this.editor.getJSON()
    },
    /** 关掉 toast（宿主想手动收时用；正常路径走「落盘后自行消失」）。 */
    hideExportToast() {
      this.exportToast = ''
    },
  },
}
