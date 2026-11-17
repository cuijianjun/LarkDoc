/**
 * tableInteractionMixin — WorkBuddy md 表格交互在 lark-doc 的 1:1 落地层
 * （feat/md-table-interaction · A + B 全部实现）。
 *
 * 分工：
 * - `src/ui/tableOverlays.js` 只按 state 画几何、把手势翻成回调，不碰 ProseMirror；
 * - 本 mixin 负责把「编辑器状态 + DOM 实测几何」算成那份 state，并把回调落到
 *   ProseMirror 命令（整行/整列 CellSelection、moveTableRow / moveTableColumn）。
 *
 * 三条硬约束（改之前先读）：
 * 1. **不改 schema / colgroup / 导出语义**：只在 view 层量 DOM、发命令，落库格式原样。
 * 2. **不新增颜色字面值**：所有颜色在 CSS 里走 `--ld-table-*` → 已有 `--ld-*` token，
 *    深色档由 theme-dark.css 覆盖底层 token 自动继承（见 lark-doc.css 末段）。
 * 3. **不干扰既有边界条**：`.lark-doc-table-overlay` 根 `pointer-events: none`，
 *    只有选择条 / 滚动条自己开 `auto`，否则 `updateTableBoundaryHover()` 的
 *    `posAtCoords` 会被吞掉，＋按钮全失效。
 *
 * 定位用 `position: fixed` + viewport 坐标：表格可能在任意滚动容器里，用相对 paper
 * 的 offset 会随滚动漂移；fixed + 每次 scroll / transaction 重算最稳。
 *
 * ⚠️ v5：本层**不再有浮窗开合状态、不再注册浮窗 action 回调**。唯一浮窗
 *    `.lark-doc-table-tools` 由 `tableToolsUiMixin.buildTableToolsState()` 直接读实时
 *    selection 判定显隐与 mode（text / table）；这里只保留几何层（选择条 / 重排 /
 *    横滚 / 渐隐）、活跃闸门 `tableUiActive()` 和离散点击 dismiss 闸门
 *    `tableToolsDismissed()`。选择条点选产生的整行 / 整列选区既是选区、也是浮窗驱动源，
 *    旧 `tableFloatOpen` 状态机、`onTableFloatAction()`、`.lark-doc-table-float` 已整体删除。
 */
import { bindTableInteraction, releaseTableInteraction } from './tableInteractionBindings'
import { tableGateMethods } from './tableGateMethods'
import { tableLineMethods } from './tableLineMethods'
import { tableOverlayMethods } from './tableOverlayMethods'

export default {
  data() {
    return {
      tableSelectedLine: null,
    }
  },
  mounted() {
    bindTableInteraction(this)
  },
  beforeDestroy() {
    releaseTableInteraction(this)
  },
  methods: {
    ...tableOverlayMethods,
    ...tableGateMethods,
    ...tableLineMethods,
  },
}
