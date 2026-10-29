/**
 * 「关联已有多维表格」模态状态机（requirements/04 §4.5 / 17 §17.5 的 bitable provider 入口）。
 *
 * 为什么这个模态要写成一个独立 mixin 而不是塞进 `commandMenuMixin`：
 *   它有两步异步语义（选多维表格 → 选数据表）和一份外部数据（候选列表来自 provider），
 *   与「点一条命令就地插一个块」是两种交互。塞进命令层会让那个 switch 分支里出现
 *   loading / 空态 / 置灰三套状态，而命令层现在一条分支最多两句。
 *
 * 几何（§4.5 实测，中心对齐是**算出来的**不是猜的）：
 *   遮罩 1512×950 → 内容 **1080×676 @(216,137)**。
 *   (1512 − 1080) / 2 = 216 ✓，(950 − 676) / 2 = 137 ✓ —— 这就是「水平垂直都居中」，
 *   所以实现上用 flex 居中，不写真 top/left。
 *   Header **1032×72**（= 1080 − 24×2）、Body **1032×525**、Footer **1032×80**，
 *   72 + 525 + 80 = 677 ≈ 676：三段**刚好铺满**内容高，所以三段都不带上下 margin。
 *   🔴 Header **没有关闭 X**（§4.5 实测）—— 关闭只走「取消」/ Esc / 点遮罩三条。
 *
 * 未接入 provider 时的口径（17 §17.5 表下说明「fallback=readonly/disabled，
 * 并在 UI 留下可解释的 disabled 状态」）：
 *   **模态照开**，列表落空态、确认按钮置灰、把原因写在空态里。
 *   不在命令入口直接拦住 —— 「点了没反应」是最差的可解释性；「开出来告诉你缺什么」才是。
 */
import { defaultBitable } from '../../../core/blocks/bitable-render'
import {
  externalProviderStatus, resolveExternalProvider,
} from '../../../core/embed/provider-registry'
import { EXTERNAL_STATUS } from '../../../core/embed/external-block'

/** provider 名（与 `EXTERNAL_PROVIDER_LABELS` 的键同源，别再拼第二份）。 */
const BITABLE_PROVIDER = 'bitable'

export default {
  data() {
    return {
      relationOpen: false,
      /** `base` = 选多维表格（一级）/ `table` = 选数据表（二级）。 */
      relationStep: 'base',
      /** 候选多维表格：`{ appToken, name, ownerName }`。 */
      relationBases: [],
      /** 候选数据表：`{ tableId, name }`。 */
      relationTables: [],
      relationBaseToken: '',
      relationBaseName: '',
      relationTableId: '',
      relationLoading: false,
      /** provider 侧报错（宿主 `handlers.listBases` 抛出来的），只展示原文。 */
      relationError: '',
    }
  },
  computed: {
    /** 已注册且非只读 → 才可能真的关联成功。 */
    relationProviderReady() {
      return externalProviderStatus(BITABLE_PROVIDER) === EXTERNAL_STATUS.READY
    },
    /** 空态 / 置灰那句「为什么」：一句中文，直接渲染。 */
    relationHint() {
      if (!this.relationProviderReady) {
        return '尚未接入多维表格服务，无法列出可关联的表格。接入后此列表会自动出现候选。'
      }
      if (this.relationLoading) return '正在加载…'
      if (this.relationError) return this.relationError
      if (this.relationStep === 'table') return '该多维表格下还没有可关联的数据表'
      return '当前账号下还没有可关联的多维表格'
    },
    /** 确认按钮可用性：必须在 table 步且选中了表，且 provider 可用。 */
    relationConfirmDisabled() {
      return !this.relationProviderReady || !this.relationTableId
    },
    relationConfirmReason() {
      if (!this.relationProviderReady) return '需接入多维表格服务后才能关联'
      if (!this.relationTableId) return '请先选择数据表'
      return ''
    },
    /** Footer 左侧的当前选择摘要（「已选：XX / YY」），未选全时为空串。 */
    relationSelectionText() {
      if (!this.relationBaseToken) return ''
      return this.relationTableId
        ? `已选：${this.relationBaseName} / ${this.tableNameOf(this.relationTableId)}`
        : `已选：${this.relationBaseName}`
    },
  },
  methods: {
    /**
     * 打开模态。**总是打开**（含 provider 未接入）—— 见文件头「未接入 provider 时的口径」。
     *
     * 若宿主注册了 `handlers.listBases`，这里就拉一次；没注册就当空列表，
     * 本层不发任何请求（17 §17.13：不假设协议、不伪造成功）。
     */
    openRelationBitable() {
      this.relationOpen = true
      this.relationStep = 'base'
      this.relationBaseToken = ''
      this.relationBaseName = ''
      this.relationTableId = ''
      this.relationTables = []
      this.relationError = ''
      this.relationBases = []
      const provider = resolveExternalProvider(BITABLE_PROVIDER)
      const listBases = provider && provider.handlers ? provider.handlers.listBases : null
      if (!listBases) return
      this.relationLoading = true
      Promise.resolve()
        .then(() => listBases())
        .then((list) => {
          this.relationBases = Array.isArray(list) ? list.slice(0, 200) : []
        })
        .catch((error) => {
          this.relationError = (error && error.message) || '加载多维表格列表失败'
        })
        .then(() => { this.relationLoading = false })
    },
    /** 三通路（取消 / Esc / 点遮罩）共用：只收面板，不落块。 */
    closeRelationBitable() {
      this.relationOpen = false
      this.relationStep = 'base'
      this.relationBaseToken = ''
      this.relationBaseName = ''
      this.relationTableId = ''
      this.relationTables = []
      this.relationError = ''
    },
    /** 选一张多维表格 → 拉它的数据表（没注册 `handlers.listTables` 就停在空态）。 */
    pickRelationBase(base) {
      if (!base || !base.appToken) return
      if (!this.relationProviderReady) return
      this.relationBaseToken = base.appToken
      this.relationBaseName = base.name || '未命名多维表格'
      this.relationTableId = ''
      this.relationTables = []
      this.relationError = ''
      this.relationStep = 'table'
      const provider = resolveExternalProvider(BITABLE_PROVIDER)
      const listTables = provider && provider.handlers ? provider.handlers.listTables : null
      if (!listTables) return
      this.relationLoading = true
      Promise.resolve()
        .then(() => listTables({ appToken: base.appToken }))
        .then((list) => {
          this.relationTables = Array.isArray(list) ? list.slice(0, 200) : []
        })
        .catch((error) => {
          this.relationError = (error && error.message) || '加载数据表列表失败'
        })
        .then(() => { this.relationLoading = false })
    },
    pickRelationTable(table) {
      if (!table || !table.tableId) return
      this.relationTableId = table.tableId
    },
    tableNameOf(tableId) {
      const found = this.relationTables.find((table) => table.tableId === tableId)
      return found ? found.name || '未命名数据表' : ''
    },
    /** 返回一级（选多维表格），保留已选的多维表格。 */
    backToRelationBase() {
      this.relationStep = 'base'
      this.relationTableId = ''
      this.relationTables = []
    },
    /**
     * 确认：落一块**关联视图**的多维表格，然后关面板。
     *
     * 为什么落 `bitable` 块而不是 `externalBlock`：飞书的「关联已有多维表格」插进来的
     * 就是一个普通多维表格块，只是视图停在 `relation`（03 §3.4 ⑤ 的 5 项共用一个块类型）。
     * 落成 `externalBlock` 会让它在块内**再也切不回**表格 / 看板 —— 那是把「关联」
     * 误解成「另一种块」。
     *
     * 先关面板再落块：落块后 NodeView 可能抢焦点，面板还开着会把它顶掉。
     */
    confirmRelationBitable() {
      if (this.relationConfirmDisabled) return
      const reference = {
        appToken: this.relationBaseToken,
        tableId: this.relationTableId,
        name: this.tableNameOf(this.relationTableId),
      }
      const base = defaultBitable('relation')
      const token = this.relationBaseToken
      const tableId = this.relationTableId
      this.closeRelationBitable()
      this.run('setBitable', { ...base, reference })
      this.$emit('relation-bitable-confirmed', { appToken: token, tableId })
    },
    /** 供 `overlayDismissMixin` 判「点的是不是浮层内部」。 */
    relationContains(node) {
      if (!node || !node.closest) return false
      return !!node.closest('.lark-doc-relation-layer')
    },
  },
}
