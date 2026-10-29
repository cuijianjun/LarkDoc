/**
 * confirmMixin —— 通用二次确认框状态机（requirements/04 §4.9）。
 *
 * 为什么是**横切件**而不是第 27 个浮层：
 *   §4.9 的实测对象是「发布」这一次操作，但它的九层 DOM 链（wrap → mask → content →
 *   confirm__content → header/icon/title + body + footer）在每个需要二次确认的命令里
 *   都一模一样 —— 删除封面、覆盖版本、发布按钮…… 规格里写的也是「建一个
 *   `<ConfirmDialog>` 通用组件（title / body / extra? / confirmText / cancelText /
 *   onConfirm）」。所以它按**能力**交付，按**条目**验收时单列第 28 项。
 *
 * 几何自校验（§4.9 实测值，改之前先算）：
 *   - 卡片 **420 × 180**、`r8`、`box-shadow: none`。
 *   - footer 高 **56** = `padding: 0 24px 24px`（24 底）+ 按钮 **32**；两钮 gap **12**，
 *     主钮右缘 942 = 546 + 420 − 24 ⇒ 右对齐是 footer 右 padding 的产物，不要写 right。
 *   - body **332 × 44**（14px/400），y=441 相对卡片顶 385 只有 **56** —— 这是唯一一处
 *     规格内部对不上的地方：`ud__confirm__header` 被记作高 124，而正文离卡片顶只有 56，
 *     两者不可能同时成立（124 > 56）。取舍是**保外层几何**（420×180 / 56 footer /
 *     32 按钮 / gap 12 这四条互相自洽且可反复验证），header 高度按「24 顶 padding +
 *     一行标题」自然撑开，不写死 124 —— 写死它会把整卡顶到 204，直接违约。
 *   - `titleContent` x=610 = 546（卡片左缘）+ 24（header 左 padding）+ 24（图标宽）
 *     + 16（图标与文字间距）。让 flex 的 `gap: 16px` 去算，别写死 left。
 *   - `titleContent` x=610 = 546（卡片左缘）+ 24（header 左 padding）+ 24（图标宽）
 *     + 16（图标与文字间距）。让 flex 的 `gap: 16px` 去算，别写死 left。
 *   - 主按钮右缘 942 = 546 + 420 − 24（footer 右 padding），两钮 gap **12**。
 *   - 遮罩 `rgba(0,0,0,0.55)` 与 wrap 同 z 1000，靠 DOM 顺序压住；卡片**无阴影**
 *     （`box-shadow: none`）—— 压暗靠遮罩，加阴影会得到「飘在灰底上」的脏边。
 *
 * 三通路关闭（§4.9 ⑤）：「取消」/ `Esc` / 点遮罩，三条都只是 `close`，
 * **主块零变化**（规格原文）。所以 `close()` 只清本地态，不派发任何事务。
 *
 * 「点主按钮执行后无 toast」也是实测结论 —— 别顺手加 `exportToast` 那种提示。
 */
export const CONFIRM_SIZE = Object.freeze({ width: 420, height: 180 })

export default {
  data() {
    return {
      // 单例：同一时刻只可能有一个二次确认框（§4.9 是模态，叠两个没有语义）。
      confirmOpen: false,
      confirmTitle: '',
      confirmBody: '',
      // `extra` = 「不再提示」勾选行（`confirm-with-no-tips__container` 80×22）。
      // 空串表示这次确认没有勾选项 —— 规格里它是可选件，只有带 `extra` 的调用才有。
      confirmExtra: '',
      confirmExtraChecked: false,
      confirmPrimaryText: '确定',
      confirmCancelText: '取消',
    }
  },
  methods: {
    /**
     * 打开二次确认框。返回 `Promise<boolean>`：`true` = 点了主按钮，
     * `false` = 取消 / Esc / 点遮罩。
     *
     * 为什么返回 Promise 而不是直接回调：调用点大多是
     *   `if (await this.confirmDialog({...})) doDangerous()`
     * 这种形状，Promise 让「确认后才执行」的因果写在同一个表达式里，不会出现
     * 「点了确定但忘了看返回值」的静默丢操作。
     */
    confirmDialog(options) {
      const opts = options || {}
      // 已有确认框时先把它判为取消，避免上一个 promise 永远挂着（重入兜底）。
      if (this._confirmResolve) this._confirmResolve(false)
      this.confirmTitle = opts.title || '确认操作'
      this.confirmBody = opts.body || ''
      this.confirmExtra = opts.extra || ''
      this.confirmExtraChecked = !!opts.extraChecked
      this.confirmPrimaryText = opts.confirmText || '确定'
      this.confirmCancelText = opts.cancelText || '取消'
      // 回调挂在实例私有键上（下划线前缀，不被 Vue 2 代理成响应式）：
      // 模板不读它，没必要为它付观察开销；闭包住大对象也不会被深遍历。
      this._confirmOnConfirm = typeof opts.onConfirm === 'function' ? opts.onConfirm : null
      this.confirmOpen = true
      return new Promise((resolve) => {
        this._confirmResolve = resolve
      })
    },
    /** 点主按钮：关闭 → 跑 `onConfirm(checked)` → resolve(true)。 */
    acceptConfirm() {
      const onConfirm = this._confirmOnConfirm
      const resolve = this._confirmResolve
      const checked = this.confirmExtraChecked
      this._confirmOnConfirm = null
      this._confirmResolve = null
      this.confirmOpen = false
      // 先关再跑：`onConfirm` 里可能同步弹下一个模态，若本框还开着会把它压住
      // （与 `createMenuMixin.onCreateMenuItem` 同一条纪律）。
      if (onConfirm) onConfirm(checked)
      if (resolve) resolve(true)
    },
    /** 三通路共用：Esc / 取消 / 点遮罩都走这里，只清本地态。 */
    closeConfirm() {
      const resolve = this._confirmResolve
      this._confirmOnConfirm = null
      this._confirmResolve = null
      this.confirmOpen = false
      if (resolve) resolve(false)
    },
    toggleConfirmExtra() {
      this.confirmExtraChecked = !this.confirmExtraChecked
    },
    /** 供 `overlayDismissMixin` 判「点的是不是浮层内部」。 */
    confirmContains(node) {
      if (!node || !node.closest) return false
      return !!node.closest('.lark-doc-confirm-layer')
    },
  },
}
