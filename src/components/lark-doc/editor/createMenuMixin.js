/**
 * 顶栏「新建」菜单（requirements/04 §4.6.3，batch106 实测）。
 *
 * 尺寸口径（改这里前先看，四个数字互相咬合）：
 *   外壳 **182×509**（`.create-wiki-menu-popover`，padding `4px 0 0`，透明底无阴影无圆角），
 *   内层容器 `UL` **180×503**，项 **172×40**（行距 40 —— 注意是 40，不是「更多」菜单的 34，
 *   两类菜单**不能共用** `--menu-item-height`），文案列 116×40、图标外框 19×21。
 *   自校验：509 = 4(pad-top) + 503 + 2；503 = 6×40 + 1(divider) + 40(知识库) + 20(分组标题)
 *          + 4×40 + 2，误差来自分隔线的 1px 与上下 padding，实测就是 503。
 *
 * 三条不能「补全」的地方：
 *   1. **创建类图标是彩色的**（画板 `--ld-icon-board` / 思维导图 `--ld-icon-mindmap` /
 *      流程图 `--ld-icon-flow` / 上传及导入 `--ld-icon-upload`），与文档类单色
 *      `--ld-text-menu` 截然不同 —— 不要统一成单色。
 *   2. **分组标题「文档应用」是四级文字色 `--ld-text-tertiary`**（比 `--ld-text-secondary`
 *      那一档更浅）—— 此前未记录过这一档，别顺手写成次要色。
 *   3. **「上传及导入」右侧有 7×13 箭头**，其余 10 项都没有。
 *
 * 行为：`新建` 的语义是「创建另一篇文档 / 另一个应用」，文档编辑器自己造不出来，
 * 所以 11 项统一 `$emit('create-menu', { id, label, action })` 交给宿主路由
 * （`LarkDocWorkspace` 或宿主应用）。**这不是「用不了」**：菜单本身完整可用、
 * 键盘与点外关闭都通，落地动作属于宿主能力边界，与 `04 §4.6.3` 的实机行为一致
 * （飞书自己也是跳到 wiki/doc/sheet 路由）。
 */
import { anchorPopoverStyle } from './popoverPosition'

/** 外壳尺寸（实测 182×509；内层 180×503）。先渲染再量也能用，这个值用于首帧不闪。 */
export const CREATE_MENU_SIZE = Object.freeze({ width: 182, height: 509 })

/**
 * 单色文档类图标色。走 token 而不是字面值：`--ld-text-menu` 在飞书档等于主文字色，
 * 深色档会翻成浅色（见 `theme-dark.css`），写死 `#1F2329` 在深色主题下会变成墨点。
 */
const MONO = 'var(--ld-text-menu)'

/**
 * 渲染行（`Object.freeze` 防止运行时被模板改写）。
 * `kind`: `item` 可点项 / `divider` 分隔线 / `group` 分组标题。
 * 顺序严格照 `04 §4.6.3` 的 y 序：6 项 → 分隔线(y301) → 知识库(y306) → 分组标题(y359) → 4 项。
 */
export const CREATE_MENU_ROWS = Object.freeze([
  { kind: 'item', id: 'bitable', label: '多维表格', icon: 'doc-grid', iconColor: MONO, action: 'bitable' },
  { kind: 'item', id: 'doc', label: '文档', icon: 'doc', iconColor: MONO, action: 'doc' },
  { kind: 'item', id: 'sheet', label: '表格', icon: 'table', iconColor: MONO, action: 'sheet' },
  { kind: 'item', id: 'slides', label: '幻灯片', icon: 'slides', iconColor: MONO, action: 'slides' },
  { kind: 'item', id: 'form', label: '问卷', icon: 'form', iconColor: MONO, action: 'form' },
  { kind: 'item', id: 'mindnote', label: '思维笔记', icon: 'mindmap', iconColor: MONO, action: 'mindnote' },
  { kind: 'divider', id: 'divider-1' },
  { kind: 'item', id: 'wiki', label: '知识库', icon: 'outline', iconColor: MONO, action: 'wiki' },
  { kind: 'group', id: 'group-apps', label: '文档应用' },
  { kind: 'item', id: 'board', label: '画板', icon: 'board', iconColor: 'var(--ld-icon-board)', action: 'board' },
  { kind: 'item', id: 'mindmap', label: '思维导图', icon: 'mindmap', iconColor: 'var(--ld-icon-mindmap)', action: 'mindmap' },
  { kind: 'item', id: 'flow', label: '流程图', icon: 'flow', iconColor: 'var(--ld-icon-flow)', action: 'flow' },
  {
    kind: 'item', id: 'import', label: '上传及导入', icon: 'upload', iconColor: 'var(--ld-icon-upload)', action: 'import', arrow: true,
  },
])

export default {
  data() {
    return {
      createMenuOpen: false,
      createMenuAnchor: null,
      createMenuStyle: { left: 0, top: 0 },
    }
  },
  computed: {
    createMenuRows() {
      return CREATE_MENU_ROWS
    },
  },
  methods: {
    /** 「新建」按钮点击：同按钮二次点击收起。 */
    toggleCreateMenu(event) {
      if (this.createMenuOpen) {
        this.closeCreateMenu()
        return
      }
      if (this.effectiveReadonly) return
      const el = event && event.currentTarget
      const rect = el && el.getBoundingClientRect ? el.getBoundingClientRect() : null
      if (!rect) return
      this.createMenuAnchor = rect
      this.createMenuOpen = true
      // 顶栏按钮在左侧，菜单向右展开 ⇒ 左对齐锚点左缘。
      this.createMenuStyle = anchorPopoverStyle(rect, CREATE_MENU_SIZE, {
        width: window.innerWidth,
        height: window.innerHeight,
      }, { align: 'left' })
      this.$nextTick(this.measureCreateMenu)
    },
    closeCreateMenu() {
      this.createMenuOpen = false
      this.createMenuAnchor = null
    },
    /** 首帧后按实测尺寸纠正一次（宽度会随语言/字体微调）。 */
    measureCreateMenu() {
      const menu = this.$refs && this.$refs.createMenu
      if (!menu || !this.createMenuAnchor) return
      const rect = menu.getBoundingClientRect()
      this.createMenuStyle = anchorPopoverStyle(this.createMenuAnchor, rect, {
        width: window.innerWidth,
        height: window.innerHeight,
      }, { align: 'left' })
    },
    /**
     * 项点击：菜单先关，再派发。
     * 顺序不能反 —— 宿主若同步弹出自己的模态，先派发会让本菜单压在模态上（与导出线同坑）。
     */
    onCreateMenuItem(row) {
      if (!row || row.kind !== 'item') return
      this.closeCreateMenu()
      this.$emit('create-menu', { id: row.id, label: row.label, action: row.action })
    },
    createMenuContains(node) {
      if (!node || !node.closest) return false
      return Boolean(node.closest('.lark-doc-create-menu, .lark-doc-create-btn'))
    },
  },
}
