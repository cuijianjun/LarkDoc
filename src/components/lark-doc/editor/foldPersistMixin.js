/**
 * foldPersistMixin — 章节折叠偏好的本设备持久化（localStorage → 标题 blockId）。
 * 通过 this.editor、this.foldPersistKey 读写；主组件的 mounted / setContent 调 restoreFolds()，
 * 编辑器 onTransaction 调 syncFoldState() + persistFolds()。
 * 采用 mixin 而非子组件：没有模板，只有三条带闸门的方法，依赖 Vue 2 的 methods 合并语义。
 */
import { foldableIdPositions } from '../documentOperations'

export default {
  methods: {
    // 存的是块的稳定 id，不是位置也不是「文本+序号」：同名标题、删除靠前标题、
    // 重命名、移动块都不会让折叠状态串到别的标题上。
    foldStorageKey() { return this.foldPersistKey ? `lark-doc:folds:${this.foldPersistKey}` : '' },
    persistFolds() {
      const key = this.foldStorageKey()
      // 闸门 1 —— _foldsReady 之前不写回：编辑器初始化/内容替换会先清空折叠位，
      // 若此时写盘会把已保存的偏好覆盖成空数组，刷新后就永远恢复不出来。
      if (!key || !this.editor || !this._foldsReady) return
      // 闸门 2 —— 宿主异步灌入正文时，编辑器会先处于「空文档」状态：此时没有任何可折叠块，
      // 写盘只会把上一次会话的偏好覆盖成空数组（刷新恢复失效的直接原因）。
      // 判定条件用「可折叠块」而不是「有标题」：段落/列表项挂了缩进子块也能折叠，
      // 没有标题的文档同样需要恢复折叠位。
      if (foldableIdPositions(this.editor.state.doc).size === 0) return
      const next = JSON.stringify(Array.from(this.editor.storage.larkDoc?.folded || []))
      // 闸门 3 —— 与上次写盘内容一致就不重复写。
      if (next === this._persistedFolds) return
      this._persistedFolds = next
      try { window.localStorage.setItem(key, next) } catch (_) { /* 隐私模式等存储不可用时静默降级为会话内状态 */ }
    },
    restoreFolds() {
      const key = this.foldStorageKey()
      if (!key || !this.editor) { this._foldsReady = true; return }
      let saved = []
      try { saved = JSON.parse(window.localStorage.getItem(key) || '[]') } catch (_) { saved = [] }
      const values = Array.isArray(saved) ? saved.filter((value) => typeof value === 'string' && value) : []
      // 旧版本存的是 `层级\u0001文本\u0001同名序号` 派生键，新版本存 blockId。
      // 两批一起应用；成功恢复后 persistFolds 会把它们统一写成 id 完成迁移。
      const legacyKeys = values.filter((value) => value.includes('\u0001'))
      const blockIds = values.filter((value) => !value.includes('\u0001'))
      if (blockIds.length && typeof this.editor.commands.foldLarkDocByIds === 'function') this.editor.commands.foldLarkDocByIds(blockIds)
      if (legacyKeys.length && typeof this.editor.commands.foldLarkDocByKeys === 'function') this.editor.commands.foldLarkDocByKeys(legacyKeys)
      const applied = this.editor.storage.larkDoc?.folded?.size || 0
      this._foldsReady = true
      // 有偏好却一条都没命中，说明当前正文还不是最终内容（宿主挂载后会再灌一次
      // setContent）。此时绝不能写盘：写成空数组会让后面那次恢复也读不到偏好。
      if (values.length && !applied) return
      this.persistFolds()
    },
  },
}
