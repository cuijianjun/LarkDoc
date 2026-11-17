/** Private version UI presentation. The host supplies its original editor/schema helpers.
 * No provider, session, operation or view is captured by this synchronous factory.
 */
export function createVersioningPresentation(dependencies) {
  const { Editor, createLarkDocExtensions, validateDocument, createNetworkPolicy,
    formatVersionClock, formatVersionTime, groupVersionsByDay, historyDiffSummary, describeVersionDiff, pairOf,
    VERSIONING_DAY_LABELS, VERSION_KIND_LABELS, SNAPSHOT_KIND,
    versionCapabilityGate, versioningErrorMessage, confirmedVersionResult, defaultVersionLabel, nextVersionOrdinal, SNAPSHOT_LABEL_MAX } = dependencies

  const computed = {
    versionRestoreConfirmText() {
      const record = this.versionList.find(item => item.id === this.versionRestoreTargetId)
      if (!record) return ''
      const date = new Date(record.createdAt)
      return `将当前文档还原为「${this.versionRestoreTargetLabel || '未命名版本'}」：${date.getMonth() + 1}月${date.getDate()}日 ${formatVersionClock(record.createdAt)}。当前内容将被替换，历史记录仍保留。`
    },

    /** 右栏时间线：按天分组后的 `[{ key, label, items }]`。 */
    versionDayGroups() {
      return groupVersionsByDay(this.versionList)
    },

    versionChangeCursor() { return `编辑记录 ${this.versionChangeIndex}/${this.versionChanges.length}` },

    /**
     * 选中版本与其**更早**版本的差异摘要。
     *
     * 没有更早版本时返回 `null`，而不是 `diffSummary(0, n)` —— 后者会报成「新增 n 个块」，
     * 而真相是「没有更早的一条可比」。`recordMetrics(null)` 的 0 只在**两侧都真实存在**
     * 时才不会说谎。
     */
    versionSelectedDiff() {
      const pair = pairOf(this.versionList, this.versionIndex - 1)
      if (!pair.prev || !pair.current) return null
      return historyDiffSummary(pair.prev, pair.current)
    },
  }

  const methods = {
    mountVersionDocumentPreview(element, record) {
      try {
        const network = createNetworkPolicy(this.larkDocConfig?.network)
        const content = network.applyDocument(validateDocument(record.content, this.editor.schema))
        const preview = new Editor({
          element, editable: false,
          content,
          extensions: createLarkDocExtensions({ config: this.larkDocConfig, getImageOptions: () => ({ canLoad: src => createNetworkPolicy(this.larkDocConfig?.network).allows(src) }) }),
          editorProps: { attributes: { 'aria-label': '历史版本正文' } },
        })
        return () => { preview.destroy(); element.replaceChildren() }
      } catch (error) {
        const message = element.ownerDocument.createElement('p')
        message.textContent = `无法预览此版本：${error.message}`
        element.appendChild(message)
        return () => element.replaceChildren()
      }
    },

    /**
     * 时间线条目名（04 §3.4-C：`-item-name` 实测「10月25日 00:04」）。
     *
     * 做成方法而不是 computed：`groupVersionsByDay` 会打散下标，模板按记录取比按
     * 下标取更不容易错位（差一位就会把 A 的时间贴到 B 上）。
     */
    versionItemName(record) {
      const time = formatVersionTime(record ? record.createdAt : 0) || VERSIONING_DAY_LABELS.unknown
      const label = typeof record?.label === 'string' ? record.label.trim() : ''
      return label ? `${label} · ${time}` : time
    },

    /** 时间线 `-item-desc`：与**更早**那条的块数差。 */
    versionItemDesc(record) {
      const index = this.indexOfVersion(record ? record.id : '')
      if (index < 0) return ''
      const pair = pairOf(this.versionList, index)
      return describeVersionDiff(pair.prev, pair.current)
    },

    /** `kind` 徽标文案（09 §5.8 要求区分「自动 / 手动 / 恢复产生」）。 */
    versionKindLabel(kind) {
      return VERSION_KIND_LABELS[kind] || VERSION_KIND_LABELS[SNAPSHOT_KIND.MANUAL]
    },

    /** 左栏预览的「作者」行；`provider.list()` 给的是 author id，不冒充花名。 */
    versionActorLabel(record) {
      if (!record) return ''
      return record.author || '未知作者'
    },

    /** 时间线项的类：选中态 `selected` 由 04 §3.4-C 定义（底 `#E0E9FF`、字 `#336DF4`）。 */
    versionTimelineClass(record) {
      return {
        selected: Boolean(record) && record.id === this.versionSelectedId,
      }
    },
    stepVersionChange(delta) {
      const index = this.versionChangeIndex + delta
      if (!this.versionPanelOpen || this.versionChangesLoading || index < 1 || index > this.versionChanges.length) return false
      this.versionChangeIndex = index
      return true
    },

    /**
     * 「上一项 / 下一项」。翻的是**编辑记录游标**，不是版本，也不改变选中（§3.4 ⑤ 反直觉 3）。
     * 游标越界由 `versionPrevDisabled / versionNextDisabled` 先挡一层，这里再兜一次。
     */
    async stepVersion(delta) {
      const next = this.versionIndex + delta
      if (next < 1 || next > this.versionTotal) return null
      this.versionIndex = next
      const record = this.versionList[next - 1]
      return this.selectVersion(record ? record.id : '')
    },

    versionPrev() {
      if (this.versionPrevDisabled) return null
      return this.stepVersion(-1)
    },

    versionNext() {
      if (this.versionNextDisabled) return null
      return this.stepVersion(1)
    },

    /** Confirmation captures one version id; provider restore appends a new immutable record. */
    requestVersionRestore() {
      if (this.versionRestorePending) return this.restoreSelectedVersion()
      if (!this.versionPanelOpen || this.versionRestoreDisabled || !this.versionSelected || !this.versionPreview?.document) return false
      if (!versionCapabilityGate(this.session, 'canRestoreVersion').allowed || (this.writable && !this.writable())) return false
      this.closeVersionRestoreConfirm()
      this._versionRestoreConfirmation = Object.freeze({ id: this.versionSelectedId, session: this.session, provider: this.versionProvider, editor: this.editor,
        documentId: this.session?.documentId, readScope: this.versionPreview.readScope })
      this.versionRestoreTargetId = this.versionSelectedId
      this.versionRestoreTargetLabel = this.versionSelected.label || '未命名版本'
      this.versionRestoreConfirmOpen = true
      return true
    },

    async confirmVersionRestore() {
      const scope = this._versionRestoreConfirmation
      if (!this.versionRestoreConfirmOpen || !scope || this.versionRestoreTargetId !== scope.id) return null
      this.closeVersionRestoreConfirm()
      const epoch = this._versionRestoreConfirmEpoch
      const current = () => epoch === this._versionRestoreConfirmEpoch && this.versionPanelOpen && !this.versionRestoreDisabled
        && versionCapabilityGate(scope.session, 'canRestoreVersion').allowed && (!this.writable || this.writable())
        && this.versionContextMatches(scope.session, scope.provider, scope.editor) && scope.documentId === this.session?.documentId
        && this.versionSelectedId === scope.id && this.versionPreview?.id === scope.id && this.versionPreview?.readScope === scope.readScope
        && scope.readScope === JSON.stringify([this.session?.documentId, this.session?._versioningProviderGeneration, this.session?._authorizationGeneration, this.session?._privateIdentityGeneration])
        && this.versionList.some(record => record.id === scope.id && record.documentId === scope.documentId)
      if (!current()) return null
      try {
        const record = await scope.provider.get(scope.id)
        if (!current() || record?.id !== scope.id || record.documentId !== scope.documentId) return null
      } catch (error) { if (current()) this.versionPreviewError = versioningErrorMessage(error); return null }
      return this.restoreSelectedVersion(scope.id)
    },

    async restoreSelectedVersion(versionId = this.versionSelectedId) {
      if (this.versionRestoreBusy || this.versionRestoreNeedsReload) return null
      const pending = this.versionRestorePending
      if (!pending && (!this.versionSelected || versionId !== this.versionSelectedId || this.versionProvider?.supportsRestore === false)) return null
      if (!versionCapabilityGate(this.session, 'canRestoreVersion').allowed || (!pending && this.writable && !this.writable())) {
        this.versionPreviewError = versionCapabilityGate(this.session, 'canRestoreVersion').reason
        return null
      }
      this.versionRestoreBusy = true
      this.versionPreviewError = ''
      const session = this.session, provider = this.versionProvider, editor = this.editor
      const context = pending ? this._versionRestoreOperationContext : { session, provider, editor, documentId: this.documentId, scope: this.versionOperationScope() }
      this._versionRestoreOperationContext = context
      const token = (this._versionRestoreToken || 0) + 1
      this._versionRestoreToken = token
      const current = () => token === this._versionRestoreToken && this.versionOperationMatches(context) && session.can('canRestoreVersion')
      try {
        if (!current()) { this.versionPreviewError = '原恢复操作的身份或文档已改变，结果仍待确认'; return null }
        if (pending && (!this.versionRestoreOperationId || typeof provider.queryRestoreOperation !== 'function')) {
          this.versionPreviewError = '恢复结果待确认，尚无可用的原操作查询服务'; return null
        }
        const operationId = this.versionRestoreOperationId
        const local = !provider.isRemote && typeof provider.documentCodec?.encode === 'function'
        const created = pending ? await (local ? session.queryLocalVersionRestore(operationId) : provider.queryRestoreOperation(operationId)) : await session.restoreVersion(versionId)
        if (!current()) return created
        if (!confirmedVersionResult(created, provider, 'postVersion') || (pending && created.operationId !== operationId)) {
          this.versionRestorePending = true
          if (!operationId && typeof created?.operationId === 'string') this.versionRestoreOperationId = created.operationId
          editor?.setEditable?.(false)
          this.versionNotice = ''
          this.versionPreviewError = this.versionRestoreOperationId && typeof provider.queryRestoreOperation === 'function'
            ? '恢复结果待确认，请查询原操作；确认前保持只读' : '恢复结果待确认，尚无可用的原操作查询服务；确认前保持只读'
          return created
        }
        this.versionRestorePending = false
        this.versionRestoreOperationId = ''
        this._versionRestoreOperationContext = null
        if (provider.requiresDurableConfirmation && (created.reloadRequired !== false || created.editingResumed !== true)) {
          editor?.setEditable?.(false)
          this.versionRestoreNeedsReload = true
          this.versionNotice = '恢复已提交，请重新打开文档'
          return created
        }
        await this.loadVersions()
        if (!current()) return created
        if (this.versionSelectedId) await this.selectVersion(this.versionSelectedId)
        if (!current()) return created
        this.versionNotice = '已恢复为新版本，原版本仍保留在历史记录中'
        return created
      } catch (error) {
        if (!current()) return null
        if (pending || error.status === 'unknown') {
          this.versionRestorePending = true
          if (!this.versionRestoreOperationId && typeof error.operationId === 'string') this.versionRestoreOperationId = error.operationId
          editor?.setEditable?.(false)
          this.versionPreviewError = `恢复结果待确认：${versioningErrorMessage(error)}`
        } else this.versionPreviewError = versioningErrorMessage(error)
        return null
      } finally {
        if (token === this._versionRestoreToken) this.versionRestoreBusy = false
      }
    },

    /** 输入有两处约束：上限 `SNAPSHOT_LABEL_MAX`，且**追加不清空**（§⑤-2 实测 11 → 15）。 */
    setSaveVersionName(value) {
      const text = typeof value === 'string' ? value : ''
      this.saveVersionName = text.length > SNAPSHOT_LABEL_MAX ? text.slice(0, SNAPSHOT_LABEL_MAX) : text
    },

    async confirmSaveVersion() {
      if (this.saveVersionBusy) return null
      if (!this.versionCanCreate) {
        this.saveVersionError = versionCapabilityGate(this.session, 'canCreateVersion').reason
        return null
      }
      this.saveVersionBusy = true
      this.saveVersionError = ''
      const session = this.session, provider = this.versionProvider, editor = this.editor
      const pending = this.saveVersionPending
      const context = pending ? this._versionSaveOperationContext : { session, provider, editor, documentId: this.documentId, scope: this.versionOperationScope() }
      this._versionSaveOperationContext = context
      const token = (this._versionSaveToken || 0) + 1
      const epoch = this._saveVersionDialogEpoch
      this._versionSaveToken = token
      const current = () => token === this._versionSaveToken && this.versionOperationMatches(context) && session.can('canCreateVersion')
      try {
        if (!current()) { this.saveVersionError = '原保存操作的身份或文档已改变，结果仍待确认'; return null }
        if (pending && (!this.saveVersionOperationId || typeof provider.queryOperation !== 'function')) {
          this.saveVersionError = '保存结果待确认，尚无可用的原操作查询服务'; return null
        }
        const label = this.saveVersionName.trim() || defaultVersionLabel(this.localTitle, nextVersionOrdinal(this.versionList))
        const operationId = this.saveVersionOperationId
        const local = !provider.isRemote && typeof provider.documentCodec?.encode === 'function'
        const created = pending ? await (local ? session.queryLocalVersionCreation(operationId) : provider.queryOperation(operationId)) : await session.createVersion({ label, title: this.localTitle })
        if (!current()) return created
        if (!confirmedVersionResult(created, provider, 'version') || (pending && created.operationId !== operationId)) {
          this.saveVersionPending = true
          if (!operationId && typeof created?.operationId === 'string') this.saveVersionOperationId = created.operationId
          this.versionNotice = ''
          this.saveVersionError = this.saveVersionOperationId && typeof provider.queryOperation === 'function'
            ? '保存结果待确认，请查询原操作，不会重复保存' : '保存结果待确认，尚无可用的原操作查询服务，不会重复保存'
          return created
        }
        this.saveVersionPending = false
        this.saveVersionOperationId = ''
        this._versionSaveOperationContext = null
        if (this._saveVersionDialogEpoch === epoch) this.closeSaveVersionDialog()
        // 04 §⑤-2 的成功 toast 原文：「版本已保存，可在 ··· 更多菜单中找到」+「立即查看」。
        this.versionNotice = '版本已保存，可在 ··· 更多菜单中找到'
        if (this.versionPanelOpen) await this.loadVersions()
        return created
      } catch (error) {
        if (!current()) return null
        if (pending || error.status === 'unknown') {
          this.saveVersionPending = true
          if (!this.saveVersionOperationId && typeof error.operationId === 'string') this.saveVersionOperationId = error.operationId
          this.saveVersionError = `保存结果待确认：${versioningErrorMessage(error)}`
        } else this.saveVersionError = versioningErrorMessage(error)
        return null
      } finally {
        if (token === this._versionSaveToken) this.saveVersionBusy = false
      }
    },

    async openVersionTrash() {
      if (!this.versionCanManageTrash) return false
      this.versionTrashOpen = true
      await this.loadDeletedVersions()
      return true
    },

    async loadDeletedVersions() { return this.updateVersionTrash() },

    async restoreDeletedVersion(id) { return this.updateVersionTrash('restoreDeleted', id) },

    async purgeDeletedVersion(id) { return this.updateVersionTrash('purge', id) },

    async updateVersionTrash(method, id) {
      if (!this.versionCanManageTrash || this.versionTrashBusy || (method && !['restoreDeleted', 'purge'].includes(method))) return false
      const session = this.session, provider = this.versionProvider, editor = this.editor
      const context = { session, provider, editor, documentId: this.documentId, scope: this.versionOperationScope() }
      const token = (this._versionTrashToken || 0) + 1
      this._versionTrashToken = token
      const current = () => token === this._versionTrashToken && this.versionOperationMatches(context) && this.versionCanManageTrash
      this.versionTrashBusy = true
      this.versionTrashError = ''
      try {
        let list = await provider.listDeleted({ documentId: session.documentId })
        if (!current()) return false
        if (method) {
          if (!Array.isArray(list) || !list.some(record => record.id === id && record.documentId === session.documentId)) throw new Error('该版本不在当前文档回收站')
          await provider[method](id)
          if (!current()) return false
          list = await provider.listDeleted({ documentId: session.documentId })
          if (!current()) return false
          if (this.versionPanelOpen) await this.loadVersions()
        }
        if (current()) this.versionDeletedList = Array.isArray(list) ? list.filter(record => record.documentId === session.documentId) : []
        return true
      } catch (error) {
        if (current()) this.versionTrashError = versioningErrorMessage(error)
        return false
      } finally {
        if (token === this._versionTrashToken) this.versionTrashBusy = false
      }
    },
  }

  return { computed, methods }
}
