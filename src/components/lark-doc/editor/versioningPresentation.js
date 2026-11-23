/** Private version UI presentation. The host supplies its original editor/schema helpers.
 * No provider, session, operation or view is captured by this synchronous factory.
 */
import {
  E_SNAPSHOT_AUTHOR,
  E_SNAPSHOT_JSON_NOT_ALLOWED,
  E_SNAPSHOT_PAYLOAD_MISSING,
  E_VERSION_EVICTED,
  E_VERSION_NOT_FOUND,
  SNAPSHOT_KIND,
  SNAPSHOT_LABEL_MAX,
  diffSummary,
  payloadSize,
  projectionMetrics,
  toBytes,
} from '../../../core/versioning'

/** 时间线日期分组文案（实测只有「今天」「昨天」两级，再往前是 `M月D日`）。 */
export const VERSIONING_DAY_LABELS = Object.freeze({
  today: '今天',
  yesterday: '昨天',
  unknown: '未知时间',
})

/**
 * 错误码 → 降级文案。
 *
 * 为什么必须逐条映射而不是直接把 `error.message` 甩给用户：
 *   `E_VERSION_NOT_FOUND` 与 `E_VERSION_EVICTED` 在用户眼里是两件完全不同的事 ——
 *   前者可以要求重试，后者必须告诉他「这份版本被保留策略删了，回不去了」。混成一句
 *   「操作失败」会让用户反复点一个永远不可能成功的按钮。
 */
export const VERSIONING_ERROR_TEXT = Object.freeze({
  [E_VERSION_NOT_FOUND]: '该版本不存在或已被移除，请刷新历史记录后重试',
  [E_VERSION_EVICTED]: '该版本已被保留策略淘汰，无法预览或恢复',
  [E_SNAPSHOT_PAYLOAD_MISSING]: '该版本的正文快照缺失，只能查看元信息',
  [E_SNAPSHOT_AUTHOR]: '无法确定操作者：宿主未向 versioning Provider 传入当前作者',
  [E_SNAPSHOT_JSON_NOT_ALLOWED]: '版本快照只接受二进制正文（Yjs update），不接受 JSON',
})

/** 拿不到具体错误码时的兜底（拼上原文，方便宿主排查，但不裸抛给面板标题区）。 */
const VERSIONING_ERROR_FALLBACK = '版本操作失败'

/** `kind` 徽标文案（09 §5.8：自动 / 手动 / 恢复产生，三个都要能认）。 */
export const VERSION_KIND_LABELS = Object.freeze({
  [SNAPSHOT_KIND.AUTO]: '自动快照',
  [SNAPSHOT_KIND.MANUAL]: '手动保存',
  [SNAPSHOT_KIND.RESTORE]: '恢复产生',
})

/** 补零到两位（`00:04` 是实测口径，不能写成 `0:4`）。 */
function pad2(value) {
  return value < 10 ? `0${value}` : String(value)
}

/**
 * 时间线条目名：04 §3.4-C 实测「10月25日 00:04」，`M月D日 HH:mm`，HH / mm 都补零。
 *
 * @param {number} createdAt 毫秒时间戳
 * @returns {string} 非有限值返回空串（面板自己有兜底文案，这里不伪造时间）。
 */
export function formatVersionTime(createdAt) {
  if (!Number.isFinite(createdAt) || createdAt <= 0) return ''
  const date = new Date(createdAt)
  return `${date.getMonth() + 1}月${date.getDate()}日 ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

/** 只取 `HH:mm`（§⑤-2 的 Dialog 标题「保存 今天 00:18 的文档版本」用的就是这段）。 */
export function formatVersionClock(value) {
  const ts = Number.isFinite(value) && value > 0 ? value : Date.now()
  const date = new Date(ts)
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

/** 某一天的自然日 `YYYY-MM-DD` 键（本地时区；跨时区不是本面对的问题）。 */
function dayKeyOf(createdAt) {
  const date = new Date(createdAt)
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

/**
 * 日期分组标题：今天 / 昨天 / `M月D日`。
 *
 * @param {number} createdAt
 * @param {number} [now] 注入的「当前时间」，便于单测；缺省 `Date.now()`。
 */
export function formatVersionDayLabel(createdAt, now) {
  if (!Number.isFinite(createdAt) || createdAt <= 0) return VERSIONING_DAY_LABELS.unknown
  const base = Number.isFinite(now) ? now : Date.now()
  const key = dayKeyOf(createdAt)
  if (key === dayKeyOf(base)) return VERSIONING_DAY_LABELS.today
  if (key === dayKeyOf(base - 86400000)) return VERSIONING_DAY_LABELS.yesterday
  const date = new Date(createdAt)
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

/** 某个自然月的 `YYYY-MM` 键（跨年同月不能并组，所以带上年份）。 */
function monthKeyOf(createdAt) {
  const date = new Date(createdAt)
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`
}

/**
 * 时间线的分组标题：`M月`。
 *
 * 飞书真身按**月**分组：`hist_i_select2.png` 里分组标题是 `10月`，而条目自身的时间
 * 已经带日期（`10月26日 12:08`），所以组标题不再重复日期。
 * （`formatVersionDayLabel` 那套「今天 / 昨天 / M月D日」只剩保存版本 Dialog 的标题在用。）
 */
export function formatVersionMonthLabel(createdAt) {
  if (!Number.isFinite(createdAt) || createdAt <= 0) return VERSIONING_DAY_LABELS.unknown
  return `${new Date(createdAt).getMonth() + 1}月`
}

/**
 * 按自然月分组，月内再按**服务端组标识**分父子两层（04 §3.4-C + 009 C4）。
 *
 * **不做二次排序**：`provider.list()` 已保证新→旧（同毫秒按写入次序），面板再排一次
 * 就是两处口径打架。分组只做「连续同月切一段」，这样同一个月不会跨到两个组里。
 *
 * 传 `groups`（折叠组）而不是 `items`（扁平条目）的原因：飞书时间线是**父子折叠**结构，
 * 父行 + 子行，父行左上角一颗三角。层级只有一层，`month → groups[].children` 足够。
 *
 * 🔴 **禁止按时间间隔聚类**。真身 20 组实测：「组内最大间隔 30.1 分钟」比
 * 「组间最小间隔 2.1 分钟」还大，区间反向重叠 —— 任何阈值都复现不出飞书的分组。
 * 分组口径只有一条：`record.groupId` 相同且相邻即同组（`groupId` 空则自成一组）。
 *
 * @param {Array} records `provider.list()` 的返回
 * @returns {Array<{ key: string, label: string, groups: Array<{ id: string, head: object, children: Array }> }>}
 *   `children` 为空数组 = 这一条没有折叠子项（不画三角、只铺一行）；
 *   非空时 `children[0] === head` —— 飞书的父行就是 `minor_history[0]`，展开后第一行
 *   与父行同刻同文（实测 3 条 minors 展开成 4 行，其中前两行时间相同）。
 */
export function groupVersionsByMonth(records) {
  const groups = []
  if (!Array.isArray(records)) return groups
  for (let i = 0; i < records.length; i += 1) {
    const record = records[i]
    if (!record || typeof record !== 'object') continue
    const createdAt = Number.isFinite(record.createdAt) ? record.createdAt : 0
    // `createdAt <= 0` 是 `normalizeSnapshot` 给缺失时间的兜底；单独归到「未知时间」组，
    // 否则 `new Date(0)` 会让它掉进 1970-01，看着像一份真实的远古版本。
    const key = createdAt > 0 ? monthKeyOf(createdAt) : ''
    const groupId = typeof record.groupId === 'string' ? record.groupId : ''
    let month = groups.length ? groups[groups.length - 1] : null
    if (!month || month.key !== key) {
      month = { key, label: formatVersionMonthLabel(createdAt), groups: [] }
      groups.push(month)
    }
    const tail = month.groups.length ? month.groups[month.groups.length - 1] : null
    if (groupId && tail && tail.id === groupId) {
      tail.children.push(record)
      continue
    }
    // 有 groupId 时 `children` 从 `[record]` 起算：父行即 `children[0]`，与真身一致。
    month.groups.push({ id: groupId || record.id || '', head: record, children: groupId ? [record] : [] })
  }
  // 单条组抹平：飞书 `type 1/3`（创建 / 还原）的 `minor_history` 恒 1 条、**没有三角**，
  // 这时父行就是唯一那行。清成空数组让渲染层不必再判长度。
  groups.forEach((month) => {
    month.groups.forEach((node) => { if (node.children.length < 2) node.children = [] })
  })
  return groups
}

/** 错误对象 → 面板可读文案。优先吃 `code`，没有 code 时退回原文（`session` 抛的是裸 Error）。 */
export function versioningErrorMessage(error) {
  if (!error) return ''
  if (error.code && VERSIONING_ERROR_TEXT[error.code]) return VERSIONING_ERROR_TEXT[error.code]
  const message = typeof error.message === 'string' ? error.message : ''
  return message || VERSIONING_ERROR_FALLBACK
}

/**
 * 元字段 → `projectionMetrics` 认识的指标对象。
 *
 * `charCount` 与 `headings` 恒为 `0` / `[]`：**历史侧不提供**，不是「该版本是空文档」。
 * 面板因此只读 `blockCount.delta`，不读这两项。
 */
export function recordMetrics(record) {
  const input = record && typeof record === 'object' ? record : {}
  return {
    blockCount: Number.isInteger(input.blockCount) && input.blockCount >= 0 ? input.blockCount : 0,
    charCount: 0,
    headings: [],
  }
}

/**
 * 相邻两个版本的差异摘要（复用 `core/versioning` 的 `diffSummary`，不自己再算一遍）。
 *
 * @param {object} prevRecord **更早**的那份（new → old 序列里靠后的那个）
 * @param {object} nextRecord **更晚**的那份
 */
export function historyDiffSummary(prevRecord, nextRecord) {
  return diffSummary(recordMetrics(prevRecord), recordMetrics(nextRecord))
}

/**
 * 时间线 `-item-desc` 的文案（实测「最近更新编辑了封面」是飞书自己的运营文案，我们
 * 拿不到，所以用**真实指标**换一句话）。
 *
 * 两个分支都在说真话：块数已知就报差值，未知就明说未知 —— 不补0 假装「无变化」。
 */
export function describeVersionDiff(prevRecord, nextRecord) {
  const target = nextRecord && typeof nextRecord === 'object' ? nextRecord : null
  if (!target) return '暂无可选中的版本'
  // 序列是 new → old，所以「找不到 prev」发生在**最早**那条上。
  if (!prevRecord) return '最早一条记录，无更早版本可比'
  const prevKnown = Number.isInteger(prevRecord.blockCount)
  const nextKnown = Number.isInteger(target.blockCount)
  if (!prevKnown || !nextKnown) return '相邻版本的块数未知，无法生成摘要'
  const delta = historyDiffSummary(prevRecord, target).blockCount.delta
  if (delta > 0) return `新增 ${delta} 个块`
  if (delta < 0) return `减少 ${Math.abs(delta)} 个块`
  return '块数无变化'
}

/** 当前正文的投影（多维指标都真实：`projectionMetrics` 吃的就是 doc JSON）。 */
export function currentProjection(editor) {
  if (!editor || typeof editor.getJSON !== 'function') return null
  try {
    return projectionMetrics(editor.getJSON())
  } catch (error) {
    // 编辑器被销毁后 `getJSON` 会抛；面板此时该显示空，而不是跟着崩。
    return null
  }
}

function pairOf(records, index) {
  if (!Array.isArray(records) || index < 0) return { prev: null, current: null }
  // `records` 是 new → old，所以「更早的那份」是 index + 1。
  return { prev: records[index + 1] || null, current: records[index] || null }
}

function confirmedVersionResult(result, provider, field) {
  if (!result || ['unknown', 'pending', 'coordinating'].includes(result.status)) return false
  if (provider?.requiresDurableConfirmation) {
    return result.status === 'committed' && result[field]?.status === 'durable'
      && typeof result.operationId === 'string' && result.operationId.length > 0
  }
  return typeof result.id === 'string' && result.id.length > 0
}

export function createVersioningPresentation(dependencies) {
  const { Editor, createLarkDocExtensions, validateDocument, createNetworkPolicy, versionCapabilityGate,
    groupVersionsByMonth: versionGroupsOf = groupVersionsByMonth,
    versioningErrorMessage: errorMessage = versioningErrorMessage,
    confirmedVersionResult: confirmResult = confirmedVersionResult } = dependencies

  const computed = {
    versionRestoreConfirmText() {
      const record = this.versionList.find(item => item.id === this.versionRestoreTargetId)
      if (!record) return ''
      const date = new Date(record.createdAt)
      // 飞书真身正文只有一句：「将当前文档还原至 10月25日 17:05 的状态」——
      // 不点版本名、不追加「当前内容将被替换」那句（截图实测，别加戏）。
      return `将当前文档还原至 ${date.getMonth() + 1}月${date.getDate()}日 ${formatVersionClock(record.createdAt)} 的状态`
    },

    /** 右栏时间线：按自然月分组、月内按服务端组标识分父子后的 `[{ key, label, groups }]`。 */
    versionGroups() {
      return versionGroupsOf(this.versionList)
    },

    /**
     * 预览态顶栏那条记录。真身指示器显示的是**版本名本身**
     * （截图实测 `当前版本： 测试版本 自动化 ⌄`，不带时间），所以优先取 `label`，
     * 取不到才退回 `versionItemName()` 的「名字 · 时间」。
     */
    versionPreviewPageRecord() {
      if (!this.versionPreviewPageId) return null
      return (this.versionList || []).find(item => item.id === this.versionPreviewPageId) || null
    },

    /**
     * 预览态顶栏 state（`buildTopBarState()` 消费）。
     *
     * 下拉面板的每行文案照飞书真身 `_pv4_dd.png` 的字面拼：
     * `<文档名> 第 N 版<版本名>`（例：`会议/主题：… 第 3 版` / `/code 第 1 版复盘V1`）——
     * 只有标注了名字的那条才在「第 N 版」后面紧跟名字，中间不留空格。
     * N 按**列表倒序**算：最新一条是「第 <总数> 版」。
     */
    versionPreviewTopBar() {
      if (!this.versionPreviewPageId) return null
      const record = this.versionPreviewPageRecord
      const label = typeof record?.label === 'string' ? record.label.trim() : ''
      const list = Array.isArray(this.versionList) ? this.versionList : []
      const docTitle = this.localTitle || this.title || ''
      const total = list.length
      const savedAt = record && Number.isFinite(record.createdAt) && record.createdAt > 0
        ? `${formatVersionDayLabel(record.createdAt, Date.now())} ${formatVersionClock(record.createdAt)}`
        : ''
      return {
        open: true,
        name: label || (record ? this.versionItemName(record) : this.versionPreviewPageLabel || ''),
        menuOpen: this.versionIndicatorOpen === true,
        // 胶囊 hover 的深色提示条：`<作者> 保存于 <时间>`（实测 `崔健军 保存于 今天 02:07`）。
        author: record ? this.versionActorLabel(record) : '',
        savedAt,
        options: list.map((item, index) => {
          const name = typeof item.label === 'string' ? item.label.trim() : ''
          return {
            id: item.id,
            name: `${docTitle} 第 ${total - index} 版${name}`.trim(),
            current: item.id === this.versionPreviewPageId,
          }
        }),
      }
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

    /** 当前正文投影：这是 `projectionMetrics` 唯一能拿到真字数、真标题的输入。 */
    versionCurrentProjection() {
      return currentProjection(this.editor)
    },
  }

  const methods = {
    /** 拉列表；拉不动时右栏显示降级文案而不是空白（面板自己不抛、不白屏）。 */
    async loadVersions() {
      const provider = this.versionProvider
      const session = this.session, editor = this.editor
      const context = { session, provider, editor, documentId: this.documentId, scope: this.versionOperationScope() }
      const documentId = session ? session.documentId : ''
      const token = (this._versionLoadToken || 0) + 1
      this._versionLoadToken = token
      const current = () => token === this._versionLoadToken && this.versionOperationMatches(context)
      if (!provider) {
        this.versionList = []
        this.versionError = '未配置 versioning Provider，历史记录不可用'
        return []
      }
      this.versionLoading = true
      this.versionError = ''
      try {
        const list = await provider.list({ documentId })
        if (!current()) return []
        this.versionList = Array.isArray(list) ? list.filter(item => this.versionPanelKind !== 'saved' || item.pinned || ['manual', 'approval'].includes(item.kind)) : []
        this.versionIndex = this.versionList.length ? 1 : 0
        this.versionSelectedId = this.versionList.length ? this.versionList[0].id : ''
        return this.versionList
      } catch (error) {
        if (!current()) return []
        this.versionList = []
        this.versionError = errorMessage(error) || VERSIONING_ERROR_FALLBACK
        return []
      } finally {
        if (current()) this.versionLoading = false
      }
    },

    /** 选中某个版本 → 拉全文。`get()` 失败只降级这一屏，列表还在。 */
    async selectVersion(versionId) {
      this.closeVersionRestoreConfirm()
      const id = typeof versionId === 'string' ? versionId : ''
      if (!id) return null
      this.versionSelectedId = id
      const index = this.indexOfVersion(id)
      if (index >= 0) this.versionIndex = index + 1
      const provider = this.versionProvider
      const session = this.session, editor = this.editor
      const readScope = JSON.stringify([session?.documentId, session?._versioningProviderGeneration, session?._authorizationGeneration, session?._privateIdentityGeneration])
      const token = (this._versionPreviewToken || 0) + 1
      this._versionPreviewToken = token
      const current = () => token === this._versionPreviewToken && this.versionContextMatches(session, provider, editor) && this.versionSelectedId === id && readScope === JSON.stringify([session?.documentId, session?._versioningProviderGeneration, session?._authorizationGeneration, session?._privateIdentityGeneration])
      if (!provider) {
        this.versionPreview = null
        this.versionPreviewError = VERSIONING_ERROR_TEXT[E_SNAPSHOT_PAYLOAD_MISSING]
        return null
      }
      this.versionPreviewError = ''
      this.versionPreview = null
      this.versionPreviewLoading = true
      this.versionChanges = []
      this.versionChangeIndex = 0
      this.versionChangesError = ''
      this.versionChangesLoading = false
      try {
        const record = await provider.get(id)
        if (!current()) return null
        const bytes = toBytes(record && record.payload)
        let document = null, contentError = ''
        if (bytes && session?.readVersionDocument) {
          try {
            document = await session.readVersionDocument(id, record)
            if (editor?.schema) validateDocument(document.content, editor.schema)
          } catch (error) { document = null; contentError = errorMessage(error) }
        }
        if (!current()) return null
        this.versionPreview = {
          id: record.id,
          readScope,
          label: record.label,
          createdAt: record.createdAt,
          author: record.author,
          kind: record.kind,
          pinned: Boolean(record.pinned),
          sizeBytes: record.sizeBytes,
          blockCount: record.blockCount,
          sourceRevision: record.sourceRevision,
          sourceEpoch: record.sourceEpoch,
          capturedSeq: record.capturedSeq,
          contentHash: record.contentHash,
          stateHash: record.stateHash,
          // 有没有正文，决定左栏画「只读预览」还是「二进制快照 N 字节」的降级卡。
          hasPayload: Boolean(bytes),
          byteLength: payloadSize(record && record.payload),
          restore: record.kind === SNAPSHOT_KIND.RESTORE,
          document,
        }
        this.versionPreviewError = contentError
        await this.loadVersionChanges(id, current)
        return current() ? this.versionPreview : null
      } catch (error) {
        if (!current()) return null
        this.versionPreview = null
        this.versionPreviewError = errorMessage(error)
        return null
      } finally {
        if (current()) this.versionPreviewLoading = false
      }
    },

    async loadVersionChanges(id, current) {
      const index = this.indexOfVersion(id), older = this.versionList[index + 1]
      if (!older) { this.versionChangesError = '没有更早版本可比较'; return }
      if (typeof this.versionProvider?.diff !== 'function' || typeof this.session?.diffVersions !== 'function') {
        this.versionChangesError = '尚未配置版本差异服务'; return
      }
      this.versionChangesLoading = true
      try {
        const result = await this.session.diffVersions(older.id, id)
        if (!current()) return
        if (result?.algorithm !== 'json-pointer-v1' || result.from?.versionId !== older.id || result.to?.versionId !== id || !Array.isArray(result.changes)) throw new Error('版本差异结果无效')
        this.versionChanges = result.changes
      } catch (error) {
        if (current()) this.versionChangesError = errorMessage(error)
      } finally {
        if (current()) this.versionChangesLoading = false
      }
    },

    async openNamedVersion(factory, opener, actionCurrent) {
      if (!this.versionCanSave || this._namedVersionDialog) return false
      const { session, versionProvider: provider, editor } = this
      const context = { session, provider, editor, documentId: this.documentId, sessionDocumentId: session.documentId,
        principal: session.user?.id, identity: session._privateIdentityGeneration, scope: this.versionOperationScope() }
      const current = () => this.versionOperationMatches(context) && this.versionCanSave
      const sameOwner = value => this.session === value.session && this.versionProvider === value.provider && this.editor === value.editor &&
        this.documentId === value.documentId && session.documentId === value.sessionDocumentId &&
        session.user?.id === value.principal && session._privateIdentityGeneration === value.identity
      if (this._namedVersionPending && !sameOwner(this._namedVersionPending.context)) this._namedVersionPending = null
      const remote = provider.isRemote || typeof provider.documentCodec?.encode !== 'function'
      const query = remote ? id => provider.queryOperation(id) : id => session.queryLocalVersionCreation(id)
      const canQuery = () => typeof provider.queryOperation === 'function' && (remote || typeof session.queryLocalVersionCreation === 'function')
      const original = this._namedVersionPending
      const list = original ? [] : await provider.list({ documentId: session.documentId })
      if (!current() || !actionCurrent() || this._namedVersionDialog) return false
      const number = (Array.isArray(list) ? list.filter(record => record.kind === SNAPSHOT_KIND.MANUAL).length : 0) + 1
      const suffix = ` 第 ${number} 版`
      const title = String(this.localTitle || '未命名文档')
      const name = original?.label || title.slice(0, SNAPSHOT_LABEL_MAX - suffix.length) + suffix
      const when = Date.now()
      const host = this.$refs?.dialogHost || this.$el
      if (!host?.isConnected) return false
      const listeners = []
      let savedVersionId
      const close = () => {
        this.closeSaveVersion()
        if (!current()) return
        if (opener?.isConnected) opener.focus({ preventScroll: true })
        if (savedVersionId && current()) {
          this._versionNoticeVersion = savedVersionId
          this.versionNotice = '版本已保存，可在 ··· 更多菜单中找到'
          this.refreshPanels?.()
        }
      }
      const view = factory({ host, name, title: `保存 ${formatVersionDayLabel(when)} ${formatVersionClock(when)} 的文档版本`,
        maxLength: SNAPSHOT_LABEL_MAX, handlers: {
          onClose: close, isCurrent: current, isPending: () => !!this._namedVersionPending, canQuery,
          onSave: async label => {
            const previous = this._namedVersionPending
            if (!current() || !label || label.length > SNAPSHOT_LABEL_MAX || previous && !canQuery()) return false
            const operationId = !previous && remote && canQuery()
              ? 'version-' + Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('')
              : null
            const intent = operationId ? { context, label, operationId } : null
            if (intent) this._namedVersionPending = intent
            let result
            try {
              result = previous ? await query(previous.operationId) : await session.createVersion({ label, purpose: SNAPSHOT_KIND.MANUAL,
                ...(intent ? { operationId, recoverAfterAuthorization: true } : {}) })
            }
            catch (error) {
              if (error.status !== 'unknown' && error.code !== 'VERSION_CONTEXT_CHANGED') {
                if (current() && this._namedVersionPending === intent && intent) this._namedVersionPending = null
                throw new Error(previous ? '保存结果待确认，请查询原操作。' : errorMessage(error))
              }
              result = error
            }
            if (!current()) return false
            const originalKey = previous?.operationId || operationId
            if (!confirmResult(result, provider, 'version') || originalKey && originalKey !== result.operationId) {
              if (!this._namedVersionPending && typeof result?.operationId === 'string') this._namedVersionPending = { context, label, operationId: result.operationId }
              throw new Error(this._namedVersionPending ? '保存结果待确认，可查询原操作。' : '服务未确认版本保存。')
            }
            this._namedVersionPending = null
            savedVersionId = result.version?.id || result.id
            return true
          },
        },
      })
      const check = () => {
        if (this._namedVersionPending && !sameOwner(this._namedVersionPending.context)) this._namedVersionPending = null
        if (!current()) this.closeSaveVersion()
      }
      for (const event of ['capabilities', 'identity', 'provider-changed', 'editor']) {
        const off = session.on?.(event, check)
        if (typeof off === 'function') listeners.push(off)
      }
      this._namedVersionDialog = { destroy() { listeners.forEach(off => off()); view.destroy() } }
      return true
    },

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
     * 做成方法而不是 computed：`groupVersionsByMonth` 会打散下标，模板按记录取比按
     * 下标取更不容易错位（差一位就会把 A 的时间贴到 B 上）。
     */
    versionItemName(record) {
      const time = formatVersionTime(record ? record.createdAt : 0) || VERSIONING_DAY_LABELS.unknown
      const label = typeof record?.label === 'string' ? record.label.trim() : ''
      return label ? `${label} · ${time}` : time
    },

    /**
     * 时间线第二行：最新一条是 `最近更新`，其余是与**更早**那条的块数差。
     *
     * 飞书这一行是「最近更新编辑了封面」这种单句事件描述（`hist_i_select2.png` 里还出现
     * `还原自 10月25日 15:00 的版本` / `文档命名为会议/`），只有一行、没有单独的状态徽标 ——
     * 所以「最近更新」是**这一行的文案**，不是另一枚绿标。
     */
    versionItemDesc(record) {
      // `versionList` 是 new → old，所以判据是**首条**而不是最大时间戳：`createdAt` 缺失
      // （`normalizeSnapshot` 兜 0）时按时间比会把一条远古记录认成最新。
      const newest = this.versionList[0]
      if (record && newest && record.id === newest.id) return '最近更新'
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

    /**
     * 一条记录 → 时间线一行的渲染描述（父行与子行共用，避免两处字段口径走散）。
     *
     * 三行节点：时间（蓝 14）/ 事件描述（12）/ 作者（灰 12 + 紫点）。
     */
    versionTimelineItem(record) {
      return {
        id: record ? record.id : '',
        cls: this.versionTimelineClass(record).selected ? 'selected' : '',
        name: this.versionItemName(record),
        desc: this.versionItemDesc(record),
        user: this.versionActorLabel(record),
      }
    },
    // ——————————————— 已存版本整页预览态（T4 / T6 / T7 / T8） ———————————————
    // 飞书真身：`立即查看` 把**整页**换成只读版本正文，顶栏换
    // `当前版本：<名> ⌄` + 「回到源文档」「复制版本链接」。这里只管状态与 URL 契约，
    // 顶栏 DOM 落地在 `src/ui/topBar.js`。

    /**
     * 进整页预览态（飞书「立即查看」）。
     *
     * 真身是**整页替换**（`_pm_half.png`）：左侧文档库侧栏还在，正文区换成只读版本正文，
     * 顶栏换 T4 那套；**没有格式工具栏、没有历史记录侧栏面板、也没有版本信息条**。
     * 所以这里先收面板，再拉正文（`selectVersion` 才拿得到 `document.content`）再挂。
     */
    async enterVersionPreview(id) {
      if (!id || typeof id !== 'string') return false
      // 面板与预览态互斥：飞书预览态里没有历史记录侧栏。
      this.versionPanelOpen = false
      this.versionRestoreConfirmOpen = false
      this.closeVersionRestoreConfirm()
      this.versionPreviewPageId = id
      this.versionIndicatorOpen = false
      const loaded = await this.selectVersion(id)
      if (this.versionPreviewPageId !== id) return false
      const record = this.versionPreviewPageRecord
      this.versionPreviewPageLabel = typeof record?.label === 'string' ? record.label.trim() : ''
      this.mountVersionPreviewPage()
      this.refreshTopBar?.()
      return Boolean(loaded)
    },

    /** 预览态里从下拉切另一条版本：正文重挂，顶栏指示器跟着换。 */
    async selectVersionPreview(id) {
      if (!id || typeof id !== 'string' || !this.versionPreviewPageId) return false
      this.versionIndicatorOpen = false
      if (id === this.versionPreviewPageId) { this.refreshTopBar?.(); return true }
      this.versionPreviewPageId = id
      const loaded = await this.selectVersion(id)
      if (this.versionPreviewPageId !== id) return false
      const record = this.versionPreviewPageRecord
      this.versionPreviewPageLabel = typeof record?.label === 'string' ? record.label.trim() : ''
      this.mountVersionPreviewPage()
      this.refreshTopBar?.()
      return Boolean(loaded)
    },

    /**
     * 把版本正文挂进 `paper` 里的只读宿主。
     *
     * 换装靠 root 的 `.is-version-preview`：真编辑器与格式工具栏整块不显示，
     * 只留这棵只读正文（见 lark-doc.css「已存版本整页预览」段）。
     */
    mountVersionPreviewPage() {
      const host = this.$refs && this.$refs.versionPreviewHost
      if (!host) return false
      this.unmountVersionPreviewPage()
      const root = this.$refs && this.$refs.root
      if (root) root.classList.add('is-version-preview')
      const page = this.versionPreview && this.versionPreview.document
      if (!page) {
        // 没有正文（二进制快照）就不硬造一棵空树，照飞书给一句降级话。
        host.textContent = this.versionPreviewError || '此版本没有可预览的正文'
        return false
      }
      this._versionPagePreviewDispose = this.mountVersionDocumentPreview(host, page) || null
      return true
    },

    /** 摘掉只读正文并把编辑器/工具栏还回去。 */
    unmountVersionPreviewPage() {
      if (this._versionPagePreviewDispose) {
        try { this._versionPagePreviewDispose() } catch { /* 预览编辑器可能已被整体销毁 */ }
        this._versionPagePreviewDispose = null
      }
      const host = this.$refs && this.$refs.versionPreviewHost
      if (host) host.replaceChildren()
      const root = this.$refs && this.$refs.root
      if (root) root.classList.remove('is-version-preview')
    },

    /** 预览态顶栏指示器开合。非预览态下是无源之水，直接拒绝。 */
    toggleVersionIndicator() {
      if (!this.versionPreviewPageId) return false
      this.versionIndicatorOpen = !this.versionIndicatorOpen
      this.refreshTopBar?.()
      return this.versionIndicatorOpen
    },

    /** 点空白/Esc 关下拉（不动预览态本身）。 */
    closeVersionIndicator() {
      if (!this.versionIndicatorOpen) return false
      this.versionIndicatorOpen = false
      this.refreshTopBar?.()
      return true
    },

    /**
     * 版本预览链接 `<文档链接>?edition_id=<版本 id>`。
     * 飞书这条 URL 契约全仓原本 0 命中（见 tasks.md T7），所以从零接：
     * hash 一并清掉，否则 `#share-xxx` 会跟着版本链接一起发出去。
     */
    versionPreviewLink(id = this.versionPreviewPageId) {
      const base = this.shareDocumentLink ? this.shareDocumentLink() : ''
      if (!base || !id) return ''
      try {
        const url = new URL(base, typeof window !== 'undefined' ? window.location?.href : undefined)
        url.searchParams.set('edition_id', id)
        url.hash = ''
        return url.href
      } catch { return '' }
    },

    /** 「复制版本链接」：写剪贴板 → 复用既有 `showDocumentToast('复制成功')`。 */
    async copyVersionPreviewLink() {
      const link = this.versionPreviewLink()
      if (!link) {
        this.showDocumentToast?.('当前版本链接不可用')
        return false
      }
      const copied = typeof this.copyShareText === 'function' ? await this.copyShareText(link) : false
      if (!copied) {
        this.showDocumentToast?.('复制失败，请检查剪贴板权限')
        return false
      }
      this.showDocumentToast?.('复制成功')
      return true
    },

    /**
     * 「回到源文档」：退出预览态并摘掉 `?edition_id=`。
     * 只改地址不压历史栈（`replaceState`）—— 预览不该在浏览器后退里留痕。
     */
    exitVersionPreview() {
      if (!this.versionPreviewPageId) return false
      this.unmountVersionPreviewPage()
      this.versionPreviewPageId = ''
      this.versionPreviewPageLabel = ''
      this.versionIndicatorOpen = false
      this.versionPreview = null
      this.versionChanges = []
      this.versionSelectedId = ''
      this.versionError = ''
      if (typeof window !== 'undefined' && window.location && window.history?.replaceState) {
        try {
          const url = new URL(window.location.href)
          if (url.searchParams.has('edition_id')) {
            url.searchParams.delete('edition_id')
            window.history.replaceState(window.history.state, '', url.href)
          }
        } catch { /* 地址不可解析时不动它，也没有别的地方可改 */ }
      }
      this.refreshTopBar?.()
      return true
    },

    /** 右栏底部「显示更改」：只翻转本屏呈现，不重新拉差异数据。 */
    toggleVersionShowChanges() {
      this.versionShowChanges = !this.versionShowChanges
      return this.versionShowChanges
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
      } catch (error) { if (current()) this.versionPreviewError = errorMessage(error); return null }
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
        if (!confirmResult(created, provider, 'postVersion') || (pending && created.operationId !== operationId)) {
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
          this.versionPreviewError = `恢复结果待确认：${errorMessage(error)}`
        } else this.versionPreviewError = errorMessage(error)
        return null
      } finally {
        if (token === this._versionRestoreToken) this.versionRestoreBusy = false
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
        if (current()) this.versionTrashError = errorMessage(error)
        return false
      } finally {
        if (token === this._versionTrashToken) this.versionTrashBusy = false
      }
    },
  }

  return { computed, methods }
}
