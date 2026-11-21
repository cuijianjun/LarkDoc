/**
 * Version history uses immutable binary provider records and a real readonly document preview.
 * Local sessions encode tagged document snapshots; custom binary formats use documentCodec.
 * Feishu source rechecked 2026-11-10: past-history restore opens a 420×178 confirmation,
 * Escape cancels that confirmation, backdrop clicks keep it open; restoring retains history.
 * The outer history view still closes through 返回文档. Summary helpers remain independently usable.
 */
import { Editor } from '@tiptap/core'
import { createLarkDocExtensions } from '../extensions'
import { validateDocument } from '../../../core/documentOperations'
import { createNetworkPolicy } from '../../../core/policy/network'
import { projectCapabilityUi } from '../../../core/policy/capability'
import { createVersioningPresentation } from './versioningPresentation'

/** 「编辑记录 N/M」的分隔口径：**版本条目** = `provider.list()` 的一条。 */
export const VERSIONING_CURSOR_LABEL = '编辑记录'

/** 无能力（权限 / 未配 Provider）时的置灰色 —— 04 §3.4-B 实测 `rgb(187,191,196)`。 */
const DISABLED_FILL = 'rgb(187, 191, 196)'

/**
 * capability 闸门（唯一入口）。
 *
 * 三件事必须**同时**成立：有 session、session.can 说是、session 挂了 versioning Provider。
 * 分开写的原因：`DocumentSession.createVersion / restoreVersion` 两步判的是两个不同的东西
 * （先 `can()`，后取 `providers.versioning`），混成一个布尔会让面板分不清该显示
 * 「无权限」还是「未接 Provider」—— 这两种置灰对用户的含义完全不同。
 *
 * @returns {{ allowed: boolean, reason: string, missingProvider: boolean }}
 */
export function versionCapabilityGate(session, capability) {
  if (!session || typeof session.can !== 'function') {
    return { allowed: false, reason: '未配置 DocumentSession', missingProvider: true }
  }
  // 与 `readCapability` 同口径：撤销阅读权限后，一切写能力同步拒绝。
  if (!session.can(capability) || !session.can('canView')) {
    return { allowed: false, reason: '当前用户没有该操作的权限', missingProvider: false }
  }
  const missingProvider = typeof session.getProvider === 'function' && !session.getProvider('versioning')
  if (missingProvider) return { allowed: false, reason: '未配置 versioning Provider', missingProvider: true }
  return { allowed: true, reason: '', missingProvider: false }
}

const versionPresentation = /*#__PURE__*/ createVersioningPresentation({
  Editor, createLarkDocExtensions, validateDocument, createNetworkPolicy,
  versionCapabilityGate,
  loadVersionUi: () => import('../../../features/ui').then(module => module.uiApi),
})

export default {
  data() {
    return {
      /** 全屏历史记录面板是否打开（05 §3.4-A：`docx-history-container`）。 */
      versionPanelOpen: false,
      /** `provider.list()` 的原样结果，new → old；已经是 `normalizeSnapshot` 后的九个字段。 */
      versionList: [],
      /**
       * 「编辑记录 N/M」的 N，从 1 起；翻的是**编辑记录**，不是版本（§3.4 ⑤ 反直觉 3）。
       *
       * 初值是 0 而不是 1：`versionCursorLabel` 承诺空列表显示 `0/0`。起 1 的话首次渲染
       * 会闪一下 `1/0` —— 那是「有一条记录但总数是 0」，自相矛盾。
       */
      versionIndex: 0,
      /** 选中的版本 id。选中 ≠ 游标：选中决定预览，游标决定「上一项 / 下一项」。 */
      versionSelectedId: '',
      versionLoading: false,
      /** 还原进行中：期间按钮保持置灰，避免连点造出两条恢复版本。 */
      versionRestoreBusy: false,
      versionRestorePending: false,
      versionRestoreOperationId: '',
      versionRestoreNeedsReload: false,
      versionTrashOpen: false,
      versionTrashBusy: false,
      versionDeletedList: [],
      versionTrashError: '',
      /** 列表级错误（拉不到列表时整个右栏走降级，不白屏）。 */
      versionError: '',
      /** Decoded document and immutable version metadata for the readonly preview. */
      versionPreview: null,
      versionPreviewLoading: false,
      versionPanelKind: 'history',
      versionChanges: [],
      versionChangeIndex: 0,
      versionChangesLoading: false,
      versionChangesError: '',
      /**
       * 右栏底部「显示更改」开关，默认开（= 飞书默认在预览里叠改动高亮）。
       *
       * 关掉只影响**这一屏的呈现**（差异行、改动清单、正文高亮），不重新拉数据 ——
       * 它是看版式用的开关，不是过滤器。
       */
      versionShowChanges: true,
      versionRestoreConfirmOpen: false,
      versionRestoreTargetId: '',
      versionRestoreTargetLabel: '',
      /** 预览级错误（单个版本取不到时只降级这一屏）。 */
      versionPreviewError: '',
      /** 成功提示（④-2 的 toast「版本已保存，可在 ··· 更多菜单中找到」）。 */
      versionNotice: '',
    }
  },

  watch: {
    session(next, previous) { if (next !== previous) this.resetVersionContext() },
    documentId(next, previous) { if (next !== previous) this.resetVersionContext() },
    'session.documentId'(next, previous) { if (next !== previous) this.resetVersionContext() },
    versionProvider(next, previous) { if (next !== previous) this.resetVersionContext() },
    versionRestoreDisabled(disabled) { if (disabled) this.closeVersionRestoreConfirm() },
  },
  beforeDestroy() {
    this.closeSaveVersion()
    this.closeVersionRestoreConfirm()
    this.closeVersionTrash()
    this._versionLoadToken = (this._versionLoadToken || 0) + 1
    this._versionPreviewToken = (this._versionPreviewToken || 0) + 1
    this._versionRestoreToken = (this._versionRestoreToken || 0) + 1
  },

  computed: {
    ...versionPresentation.computed,
    /** 与评论/导出同一套视觉投影，供时间线按钮复用 visible/gray/downgrade 语义。 */
    versionCreateCapabilityState() {
      return projectCapabilityUi(this.session, 'canCreateVersion')
    },
    versionCanSave() {
      return versionCapabilityGate(this.session, 'canCreateVersion').allowed && Boolean(this.versionProvider?.createSnapshot) &&
        typeof this.session?.createVersion === 'function' && (!this.writable || this.writable())
    },
    versionRestoreCapabilityState() {
      return projectCapabilityUi(this.session, 'canRestoreVersion')
    },
    /** 「还原此历史记录」闸门（05 §5.4 源码实测 `canRestoreVersion`）。 */
    versionCanRestore() {
      return (!this.writable || this.writable()) && versionCapabilityGate(this.session, 'canRestoreVersion').allowed
    },
    /** 置灰但不隐藏：rule「无权限 = 挂载 + 置灰」。文案告诉用户是权限还是接线问题。 */
    versionCanRestoreReason() {
      if (this.versionRestoreNeedsReload) return '恢复已提交，请重新打开文档'
      if (this.versionRestorePending) return '恢复结果待确认，只查询原操作'
      if (this.versionProvider?.supportsRestore === false) return '尚未配置可安全还原此版本的服务'
      return this.writable && !this.writable() ? '当前为只读模式，无法还原版本' : versionCapabilityGate(this.session, 'canRestoreVersion').reason
    },
    /** versioning Provider 的唯一取值点；没有就是 null，所有写操作在此统一截断。 */
    versionProvider() {
      return this.session && typeof this.session.getProvider === 'function'
        ? this.session.getProvider('versioning')
        : null
    },
    versionTotal() {
      return Array.isArray(this.versionList) ? this.versionList.length : 0
    },
    /** 「编辑记录 1/10」；空列表时给 `0/0`，不伪造 `1/0`。 */
    versionCursorLabel() {
      return `${VERSIONING_CURSOR_LABEL} ${this.versionIndex}/${this.versionTotal}`
    },
    versionSelected() {
      if (!this.versionSelectedId) return null
      for (let i = 0; i < this.versionList.length; i += 1) {
        if (this.versionList[i].id === this.versionSelectedId) return this.versionList[i]
      }
      return null
    },
    /** Current, unreadable and pending versions cannot start a restore. */
    versionRestoreDisabled() {
      if (this.versionRestoreNeedsReload) return true
      if (this.versionRestorePending) return this.versionRestoreBusy || !versionCapabilityGate(this.session, 'canRestoreVersion').allowed
      if (this.versionProvider?.supportsRestore === false) return true
      if (this.versionRestoreBusy || this.versionPreviewLoading || this.versionPreviewError) return true
      if (this.session?.readVersionDocument && !this.versionPreview?.document) return true
      if (this.versionSelectedId && this.session?.getCurrentVersionId?.() === this.versionSelectedId) return true
      return !this.versionSelected || !this.versionCanRestore
    },
    versionCanManageTrash() {
      return versionCapabilityGate(this.session, 'canRestoreVersion').allowed && (!this.writable || this.writable())
        && ['listDeleted', 'restoreDeleted', 'purge'].every(method => typeof this.versionProvider?.[method] === 'function')
    },
    versionTrashReason() {
      if (!versionCapabilityGate(this.session, 'canRestoreVersion').allowed) return versionCapabilityGate(this.session, 'canRestoreVersion').reason
      if (this.writable && !this.writable()) return '当前为只读模式，无法管理版本回收站'
      return this.versionCanManageTrash ? this.versionTrashError : '尚未配置版本回收站服务'
    },
    /** 上一项：游标在首条时禁用（实测 1/10 时 `#BBBFC4` + `not-allowed`）。 */
    versionPrevDisabled() {
      return this.versionTotal === 0 || this.versionIndex <= 1
    },
    /** 下一项：游标在末条时禁用（B 表只采到 1/10 的启用态，末条按对称处理）。 */
    versionNextDisabled() {
      return this.versionTotal === 0 || this.versionIndex >= this.versionTotal
    },
  },

  methods: {
    ...versionPresentation.methods,
    async openSaveVersion(opener, actionCurrent = () => true) {
      if (!this.versionCanSave) return false
      const scope = this.versionOperationScope()
      const { createSaveVersionDialog } = await import('../../../ui/dialogs')
      return scope === this.versionOperationScope() && actionCurrent() && this.openNamedVersion(createSaveVersionDialog, opener, actionCurrent)
    },
    closeSaveVersion() {
      this._namedVersionDialog?.destroy()
      this._namedVersionDialog = null
    },
    versionOperationScope() {
      const session = this.session
      return JSON.stringify([session?.documentId, session?.user?.id, session?._identityGeneration,
        session?._privateIdentityGeneration, session?._authorizationGeneration, session?._versioningProviderGeneration])
    },
    versionOperationMatches(context) {
      return context && this.versionContextMatches(context.session, context.provider, context.editor)
        && context.documentId === this.documentId && context.scope === this.versionOperationScope()
    },
    versionContextMatches(session, provider, editor) {
      return !this._isDestroyed && !editor?.isDestroyed && (!session?.can || session.can('canView')) && this.session === session && this.versionProvider === provider && this.editor === editor
    },
    resetVersionContext() {
      this.closeSaveVersion()
      this._namedVersionPending = null
      this._versionNoticeVersion = null
      this._versionLoadToken = (this._versionLoadToken || 0) + 1
      this._versionPreviewToken = (this._versionPreviewToken || 0) + 1
      this._versionRestoreToken = (this._versionRestoreToken || 0) + 1
      this.versionList = []
      this.versionIndex = 0
      this.versionSelectedId = ''
      this.versionPreview = null
      this.versionChanges = []
      this.versionChangeIndex = 0
      this.versionChangesError = ''
      this.versionChangesLoading = false
      this.versionPreviewError = ''
      this.versionPreviewLoading = false
      this.versionLoading = false
      this.versionRestoreBusy = false
      this.versionRestorePending = false
      this.versionRestoreOperationId = ''
      this.versionRestoreNeedsReload = false
      this._versionRestoreOperationContext = null
      this.closeVersionTrash()
      this.versionDeletedList = []
      this.versionRestoreConfirmOpen = false
      this.versionRestoreTargetId = ''
      this.closeVersionRestoreConfirm()
      this.versionError = ''
      this.versionNotice = ''
      if (this.versionPanelOpen) this.loadVersions()
    },
    /**
     * 打开历史面板。04 §3.4 ③ 的入口是顶栏「更多」菜单里的「历史记录」，
     * 那个菜单项不在本线的交付清单里 —— 由宿主调用本方法即可。
     */
    async openVersionPanel(options = {}) {
      this.versionPanelKind = options.kind === 'saved' ? 'saved' : 'history'
      this.versionPanelOpen = true
      this.versionError = ''
      await this.loadVersions()
      if (this.versionPanelOpen && this.versionSelectedId) await this.selectVersion(this.versionSelectedId)
    },

    /** 关面板 = 唯一的关闭路径（`Esc` 无效，见文件头负结论 1）。 */
    closeVersionPanel() {
      this._versionPreviewToken = (this._versionPreviewToken || 0) + 1
      this.versionPanelOpen = false
      this.versionRestoreConfirmOpen = false
      this.versionRestoreTargetId = ''
      this.closeVersionRestoreConfirm()
      this.versionPreview = null
      this.versionChanges = []
      this.versionChangeIndex = 0
      this.versionChangesLoading = false
      this.versionChangesError = ''
      this.versionPreviewLoading = false
      this.versionPreviewError = ''
      this.versionSelectedId = ''
      this.versionError = ''
    },

    indexOfVersion(versionId) {
      for (let i = 0; i < this.versionList.length; i += 1) {
        if (this.versionList[i].id === versionId) return i
      }
      return -1
    },

    closeVersionRestoreConfirm() {
      this._versionRestoreConfirmEpoch = (this._versionRestoreConfirmEpoch || 0) + 1
      this._versionRestoreConfirmation = null
      this.versionRestoreConfirmOpen = false; this.versionRestoreTargetId = ''; this.versionRestoreTargetLabel = ''
    },

    closeVersionTrash() {
      this._versionTrashToken = (this._versionTrashToken || 0) + 1
      this.versionTrashOpen = false; this.versionTrashBusy = false; this.versionTrashError = ''
    },

    dismissVersionNotice() {
      this.versionNotice = ''
    },

    /** 置灰态：底 `rgb(187,191,196)`、`cursor: not-allowed`（04 §3.4-B 实测 + 铁律 3）。 */
    versionDisabledStyle(disabled) {
      return disabled ? { backgroundColor: DISABLED_FILL, cursor: 'not-allowed' } : null
    },
  },
}
