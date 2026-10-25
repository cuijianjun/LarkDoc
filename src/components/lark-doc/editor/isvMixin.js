/**
 * isvMixin — 文档小组件（按钮 / 目录导航）的插入入口（P4-04，规格见 requirements/02 §22）。
 *
 * 一个 `isv` 节点两种形态，`kind` 分叉：
 *   - `catalog`（目录导航）：**不弹面板**，选完就地插块，NodeView 读全篇标题画树；
 *   - `button`（按钮）：**先弹配置面板**（270×386），「确定」通过校验才落块。
 *
 * 🔴 与 `calendarMixin` 的**关键差异**（别照抄）：
 *   1. 按钮面板的**取消 / Esc 都要关**，且关了就**不建块**（02 §22 ⑤-1 定判：
 *      「先弹窗后落块」，与 `bookmark` 同款）—— 日历面板 Esc 关不掉、关掉也不落块，
 *      两边恰好相反；所以本面板在 `overlayDismissMixin` 里**要**有 Esc 分支。
 *   2. 校验失败时面板**不关、撑高 38**（386 → 424），出错字段加红框 + 一行文案
 *      「超链接不合法，请重新输入」。不是 toast、不是 alert。
 *   3. 面板**无 backdrop**（02 §22 ⑤-2：`.overlay-container` 只有 z-index 600 的
 *      位置层，不盖全屏遮罩）—— 点外部照样关，但视觉上正文仍然可点。
 *   4. 面板高度随 `action` 变：`关注文档更新` 没有超链接行 → 308。
 *
 * 没有「编辑已有按钮」入口：0.12 的按钮块从命令菜单插入后即定型，改属性要删了重插。
 * 这不是偷懒 —— 02 §22 ⑤-3 的实测里按钮块的右键菜单没有「编辑」项。
 */
import { BUTTON_COLOR_ROWS, DEFAULT_BUTTON_COLOR } from './palette'
import {
  BUTTON_ACTION_DEFAULT, BUTTON_TEXT_DEFAULT, BUTTON_TEXT_MAX, ISV_BUTTON_ACTIONS,
  ISV_KINDS, ISV_PANEL, ISV_VALIDATION_MESSAGE, isvPanelHeight, normalizeButtonLink,
  validateIsvButton,
} from '../../../registry/blocks'

const PANEL_GAP = 6
const VIEWPORT_MARGIN = 8

export default {
  data() {
    return {
      isvPanelOpen: false,
      /** 面板表单四项；`isvErrorField` 为空字符串 = 未校验失败。 */
      isvAction: BUTTON_ACTION_DEFAULT,
      isvButtonText: BUTTON_TEXT_DEFAULT,
      isvButtonColor: DEFAULT_BUTTON_COLOR,
      /**
       * 色板**没被手动点过**的标志位（P4-04 像素校准，别删）。
       *
       * 02 §22 两处实测值不相等，且都对：**不能不选边**：
       *   - ⑤-3 真机按钮 idle 底 = rgb(224,233,255) #E0E9FF（`.light-blue` 类给的）；
       *   - ④-4a 色板默认选中项      = #E1EAFF（面板里第一格的可见值）。
       * 于是「打开面板直接确定」这一条路径必须渲染成 #E0E9FF（= 真机默认），
       * 而不是色板第一格的 #E1EAFF。做法：`isvColorPristine` 时不把颜色写进 attr，
       * NodeView 因此不落 inline style，由 CSS 的 `--ld-bg-selected`(#E0E9FF) 兜底；
       * 用户一旦点过任意一格（哪怕是同一格），标志位转 false，inline 照写进 attr。
       * 「照抄 attr 值」和「统一成一个色」两种偷懒做法都会掉像素，别改回去。
       */
      isvColorPristine: true,
      isvLinkUrl: '',
      isvErrorField: '',
      /** 「执行操作」下拉：常驻在面板里展开（244×102），不是二级浮层。 */
      isvActionSelectOpen: false,
      isvPanelStyle: {},
    }
  },
  computed: {
    /** 落块时真正写进 attr 的颜色（色板没动过就写空串，上文注释说明为什么）。 */
    isvResolvedButtonColor() {
      return this.isvColorPristine ? '' : this.isvButtonColor
    },
    /** 「执行操作」下拉的三项（02 §22 ⑤-2：恰好 3 项，没有第四项）。 */
    isvActions() {
      return ISV_BUTTON_ACTIONS
    },
    /** 校验失败文案，原文照抄（02 §22 ⑤-1）。 */
    isvValidationMessage() {
      return ISV_VALIDATION_MESSAGE
    },
    /** 面板当前高度：按 action 与是否已报错取 386 / 308 / 424。 */
    isvPanelBoxHeight() {
      return isvPanelHeight(this.isvAction, !!this.isvErrorField)
    },
    /** 色板 16 色（两行 × 8）—— 值从 `palette.js` 出，本文件不出现字面 hex。 */
    isvButtonColors() {
      return BUTTON_COLOR_ROWS
    },
    /** 「执行操作」的当前文案，下拉收起时显示它。 */
    isvActionLabel() {
      const hit = ISV_BUTTON_ACTIONS.find((item) => item.id === this.isvAction)
      return hit ? hit.label : ISV_BUTTON_ACTIONS[0].label
    },
    /** 只有「打开超链接」才有超链接地址那一行（02 §22 ⑤-1）。 */
    isvNeedsLink() {
      return this.isvAction === 'open_link'
    },
  },
  methods: {
    /**
     * 命令菜单「打开超链接 / 创建副本 / 关注文档更新」入口。
     * 🔴 这里只开面板，**不往正文写任何东西** —— 定判是「先弹窗后落块」。
     */
    startIsvButton(action) {
      if (!this.editor || !this.writable() || this.effectiveReadonly) return
      // 面板与斜杠菜单互斥：两者都吃键盘（面板里有 input 与下拉）。
      if (this.menuOpen) this.closeCommandMenu()
      const known = ISV_BUTTON_ACTIONS.some((item) => item.id === action)
      this.isvAction = known ? action : BUTTON_ACTION_DEFAULT
      this.isvButtonText = BUTTON_TEXT_DEFAULT
      this.isvButtonColor = DEFAULT_BUTTON_COLOR
      this.isvColorPristine = true
      this.isvLinkUrl = ''
      this.isvErrorField = ''
      this.isvActionSelectOpen = false
      this.isvPanelOpen = true
      this.isvPanelStyle = this.isvStyleAt(this.editor.state.selection.from)
    },
    /**
     * 命令菜单「目录导航」入口：不弹面板，就地插块。
     * 高度给节点默认值（335），标题树由 NodeView 在 `docChanged` 时重画。
     */
    startCatalogue() {
      if (!this.editor || !this.writable() || this.effectiveReadonly) return
      if (this.menuOpen) this.closeCommandMenu()
      this.closeIsvPanel()
      this.editor.chain().focus().setIsv({ kind: ISV_KINDS.catalog }).run()
    },
    onIsvButtonTextInput(event) {
      const value = event && event.target ? event.target.value : ''
      this.isvButtonText = Array.from(value).slice(0, BUTTON_TEXT_MAX).join('')
      if (this.isvErrorField === 'buttonText') this.isvErrorField = ''
    },
    onIsvLinkInput(event) {
      this.isvLinkUrl = event && event.target ? event.target.value : ''
      if (this.isvErrorField === 'linkUrl') this.isvErrorField = ''
    },
    /** 色板点选：16 色常驻（不是「点一下再展开」的二级浮层）。 */
    chooseIsvButtonColor(value) {
      this.isvButtonColor = value
      this.isvColorPristine = false
    },
    toggleIsvActionSelect() {
      this.isvActionSelectOpen = !this.isvActionSelectOpen
    },
    /** 换「执行操作」= 换面板形态（少一行 / 多一行），报错态随之清空。 */
    chooseIsvAction(id) {
      if (!ISV_BUTTON_ACTIONS.some((item) => item.id === id)) return
      this.isvAction = id
      this.isvActionSelectOpen = false
      this.isvErrorField = ''
    },
    /**
     * 「确定」：**先校验，通过才落块**（02 §22 ⑤-1）。
     * 失败时面板留着、撑到 424，出错字段加红框 —— 用户改完可以直接再点确定。
     */
    confirmIsvButton() {
      if (!this.editor || !this.writable()) return
      const payload = {
        kind: ISV_KINDS.button,
        action: this.isvAction,
        buttonText: this.isvButtonText,
        buttonColor: this.isvResolvedButtonColor,
        // `follow_page` / `duplicate_page` 不带链接：留空串比把上一动作的输入带过去干净。
        linkUrl: this.isvNeedsLink ? normalizeButtonLink(this.isvLinkUrl) : '',
      }
      const errors = validateIsvButton(payload)
      if (errors.length) {
        // 只标第一个出错字段：飞书实测两个都空时也只有超链接那行报红（按钮文字有默认值）。
        this.isvErrorField = errors[0]
        return
      }
      this.closeIsvPanel()
      // 走 `setIsv`（命令内部 `normalizeIsv` + schema 探路），不裸 insertContent。
      this.editor.chain().focus().setIsv(payload).run()
    },
    /** 取消 / Esc / 点外部：关面板，**不建块**。 */
    closeIsvPanel() {
      this.isvPanelOpen = false
      this.isvErrorField = ''
      this.isvActionSelectOpen = false
      this.isvPanelStyle = {}
    },
    /** 面板固定定位：贴选区下方 6px，下方放不下且上方更宽裕时翻到上方（同日历面板口径）。 */
    isvStyleAt(pos) {
      const coords = this.editor.view.coordsAtPos(pos)
      return this.fitIsvPanelStyle(coords, this.isvPanelBoxHeight)
    },
    fitIsvPanelStyle(coords, height) {
      const spaceBelow = window.innerHeight - coords.bottom - VIEWPORT_MARGIN
      const spaceAbove = coords.top - VIEWPORT_MARGIN
      const placeAbove = spaceBelow < height && spaceAbove > spaceBelow
      const top = placeAbove ? coords.top - height - PANEL_GAP : coords.bottom + PANEL_GAP
      const width = Math.min(ISV_PANEL.width, window.innerWidth - VIEWPORT_MARGIN * 2)
      const left = Math.max(VIEWPORT_MARGIN, Math.min(window.innerWidth - width - VIEWPORT_MARGIN, coords.left))
      return { left: `${left}px`, top: `${Math.max(VIEWPORT_MARGIN, top)}px` }
    },
    /** 高度会随 action / 报错变，重算一次定位（面板已经开着）。 */
    positionIsvPanel() {
      if (!this.isvPanelOpen || !this.editor) return
      this.isvPanelStyle = this.isvStyleAt(this.editor.state.selection.from)
    },
  },
}
