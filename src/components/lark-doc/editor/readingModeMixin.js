/**
 * readingModeMixin — 把「修订 / 阅读 / 协同只读」三态收成**一个**口径（P6b-05）。
 *
 * 规格：requirements/07 §1（三态表）/ §1.1（交叉核对）/ §12.1（修订入口归客栈）。
 *
 * 推导本身是纯函数（`core/blocks/interaction-mode.js`，零 DOM 零 Vue），本 mixin 只做
 * 三件事：把宿主状态喂进去、把结果暴露成 computed、在模式变化时把副作用一次性落下去。
 * UI 组件一律读这里的 `interactionMode` / `isReadMode`，不要再自己拼
 * `readonly || reading || slides || !canEdit`。
 *
 * 三条负结论（别实现）：
 *   1. **别 `watch: { reading / slides / mode }` 各写一份副作用** —— 四源会交叉触发
 *      （比如 `slides` 打开时 `mode` 没变），watch 分散写就会漏组合。副作用只挂在
 *      `interactionMode` 这一个 watch 上。
 *   2. **别在 read 态里 `$emit('mode-change', { readonly: true })` 之外再关评论**：
 *      三档「可评论」列全是 ✅（§1 表），read 态卸的是**编辑控件**，评论入口必须留。
 *   3. **别在这里自判角色 / 权限来源**：能力位只从 `this.session.can()` 取，
 *      拿不到 Session 就按「有权」处理（`DocumentSession.can()` 的口径：只有显式
 *      `false` 才算禁用）。
 *
 * 为什么 `mounted` 里要再延一帧：
 *   Vue 2 的 mixin 钩子**先于**组件自身的钩子执行，而编辑器是宿主在自己的 `mounted`
 *   里 new 出来的 —— 此刻 `this.editor` 还是 undefined，`setEditable` 无从下手。
 *   跟 `revisionMixin` 同一个折法，`$nextTick` 里补一次。
 */
import {
  DEFAULT_CAPABILITIES,
  canCommentIn,
  canDecideRevision,
  canEditContent,
  canShowEditingChrome,
  deriveInteractionMode,
  interactionReadReason,
  isReadMode,
  isSuggestMode,
} from '../../../core/blocks/interaction-mode'

/**
 * read 态要收起的浮层：方法与 data 位两组。
 *
 * 故意写成**名字清单 + typeof 守卫**，而不是直接 `this.xxx()`：本 mixin 也给别的线 /
 * 单测单独挂载，写死调用会在缺方法的宿主上炸；漏掉的方法只是那一层浮层没收，
 * 而越界调用会让整个组件白屏。
 */
const OVERLAY_CLOSERS = Object.freeze([
  'closeCommandMenu',
  'closeBubbleAlignMenu',
  'closeMentionPanel',
  'closeReminderPopover',
  'closeCalendarSearch',
  'closeBlockMenu',
  'clearHandleHighlight',
  'closeEmbedDialog',
])

/** 没有对应 close 方法、只能直接赋值的开关位（值取自宿主原 `effectiveReadonly` watch）。 */
const OVERLAY_FLAGS = Object.freeze({
  menuOpen: false,
  headingOpen: false,
  headingStyle: null,
  colorPaletteOpen: '',
  bubbleVisible: false,
})

export default {
  computed: {
    /** 能力位快照。Session 没注入时按「全有权」处理（与 `can()` 缺省口径一致）。 */
    interactionCapabilities() {
      const session = this.session
      if (!session || typeof session.can !== 'function') return DEFAULT_CAPABILITIES
      return { canEdit: session.can('canEdit'), canComment: session.can('canComment') }
    },
    /** 喂给纯函数的输入。集中一处，改口径只改这里。 */
    interactionInput() {
      return {
        readonly: !!this.readonly,
        reading: !!this.reading,
        slides: !!this.slides,
        mode: this.mode,
        capabilities: this.interactionCapabilities,
      }
    },
    /** 本文档此刻的交互模式：`edit` / `suggest` / `read`。UI 的唯一判据。 */
    interactionMode() {
      return deriveInteractionMode(this.interactionInput)
    },
    isReadMode() {
      return isReadMode(this.interactionMode)
    },
    isSuggestMode() {
      return isSuggestMode(this.interactionMode)
    },
    /** 编辑态浮层能不能出现（§1 表：只有阅读行是 ❌）。 */
    canShowChrome() {
      return canShowEditingChrome(this.interactionMode)
    },
    /** 评论入口。三档都可评论，实际取决于能力位 —— read 态保留的就是它。 */
    canCommentNow() {
      return canCommentIn(this.interactionMode, this.interactionCapabilities)
    },
    /** 修订建议的接受 / 拒绝是否可用（§12.1：需编辑权限）。面板据此置灰而不是隐藏。 */
    canDecideNow() {
      return canDecideRevision(this.interactionMode, this.interactionCapabilities)
    },
    /** 落到 read 的是哪一条（空串 = 不是 read）。只给调试与事件负载。 */
    interactionReason() {
      return interactionReadReason(this.interactionInput)
    },
  },
  watch: {
    // 副作用**只有这一个入口**（见文件头负结论第 1 条）：四源不论怎么组合变化，
    // 最终只会在这里收口一次，`slides` 打开而 `mode` 没变这类组合不会漏。
    interactionMode(mode, previous) {
      if (mode === previous) return
      this.applyInteractionMode(mode)
      // 沿用宿主既有的 `mode-change` 事件名与负载形状，宿主侧不用改监听。
      this.$emit('mode-change', { readonly: mode === 'read', mode })
    },
  },
  mounted() {
    this.$nextTick(() => this.applyInteractionMode())
  },
  methods: {
    /**
     * 把当前模式落下去：`editable`、浮层、修订态。
     * 幂等 —— `mounted` 补帧与 watch 都会调，重复调用不产生额外事务。
     */
    applyInteractionMode(mode) {
      const current = mode || this.interactionMode
      const editable = canEditContent(current)
      const editor = this.editor
      // `setEditable` 每次都会往 ProseMirror 派一条 meta 事务，先比一次省掉无谓的重算。
      if (editor && !editor.isDestroyed && editor.isEditable !== editable) {
        editor.setEditable(editable)
        editor.emit('editableUpdate', { editable })
      }
      if (current === 'read') {
        this.closeEditingOverlays()
        this.collapseRevisionPanels()
      }
      // tracker 的开关也跟着派生结果走：协同只读时哪怕 `mode` 还停在 suggest，
      // 也不能让主机继续产出建议（那种「能产出建议但不能编辑」的怪态要掐掉）。
      if (typeof this.syncRevisionTracking === 'function') this.syncRevisionTracking()
    },
    /** read 态把编辑态浮层全部收掉（§1 表：气泡条 / 块手柄 / 拖拽 ❌）。 */
    closeEditingOverlays() {
      for (let i = 0; i < OVERLAY_CLOSERS.length; i += 1) {
        const name = OVERLAY_CLOSERS[i]
        if (typeof this[name] === 'function') this[name]()
      }
      const data = this.$data || this
      const keys = Object.keys(OVERLAY_FLAGS)
      for (let i = 0; i < keys.length; i += 1) {
        const key = keys[i]
        // 只写宿主真正声明过的 data 位：给没声明的键赋值会得到一个非响应式的属性。
        if (Object.prototype.hasOwnProperty.call(data, key)) this[key] = OVERLAY_FLAGS[key]
      }
    },
    /**
     * 收修订面板的展开态。read 态下面板**保留**（要能读建议），只是不再点亮输入区 ——
     * 点亮会让 height 走 169 那一档，等于在一个不能提交的面板里给了一个输入框。
     */
    collapseRevisionPanels() {
      if (Object.prototype.hasOwnProperty.call(this.$data || this, 'revisionActiveId')) this.revisionActiveId = ''
      if (Object.prototype.hasOwnProperty.call(this.$data || this, 'revisionHoverId')) this.revisionHoverId = ''
    },
    /**
     * 可写判定的统一口径。**注意 Vue 2 的合并语义**：组件自身的 methods 会覆盖 mixin 的
     * 同名方法，所以宿主（`LarkDocEditor.vue`）若还留着自己的 `writable()`，这一份不会被执行 ——
     * 接线时把宿主那份删掉，让 `effectiveReadonly` 那串 `||` 彻底退役。
     */
    writable() {
      if (this._isBeingDestroyed || this._isDestroyed) return false
      // 修订态算可写：它的「写」落到建议上（§1 表 ⚠️），不是落到正文。
      if (!canEditContent(this.interactionMode)) return false
      return !!(this.editor && this.editor.isEditable && !this.editor.isDestroyed)
    },
    /** 块手柄 / 气泡条 / 斜杠菜单的显示闸门，给模板 `v-if` 用。 */
    showEditingChrome() {
      return canShowEditingChrome(this.interactionMode)
    },
  },
}
