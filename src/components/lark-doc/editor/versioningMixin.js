/**
 * Version history uses immutable binary provider records and a real readonly document preview.
 * Local sessions encode tagged document snapshots; custom binary formats use documentCodec.
 * Feishu source rechecked 2026-11-10: past-history restore opens a 420×178 confirmation,
 * Escape cancels that confirmation, backdrop clicks keep it open; restoring retains history.
 * The outer history view still closes through 返回文档. Summary helpers remain independently usable.
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
import { Editor } from '@tiptap/core'
import { createLarkDocExtensions } from '../extensions'
import { validateDocument } from '../../../core/documentOperations'
import { createNetworkPolicy } from '../../../core/policy/network'

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

/** 「编辑记录 N/M」的分隔口径：**版本条目** = `provider.list()` 的一条。 */
export const VERSIONING_CURSOR_LABEL = '编辑记录'

/** `kind` 徽标文案（09 §5.8：自动 / 手动 / 恢复产生，三个都要能认）。 */
export const VERSION_KIND_LABELS = Object.freeze({
  [SNAPSHOT_KIND.AUTO]: '自动快照',
  [SNAPSHOT_KIND.MANUAL]: '手动保存',
  [SNAPSHOT_KIND.RESTORE]: '恢复产生',
})

/** 无能力（权限 / 未配 Provider）时的置灰色 —— 04 §3.4-B 实测 `rgb(187,191,196)`。 */
const DISABLED_FILL = 'rgb(187, 191, 196)'

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

/**
 * 按天分组（04 §3.4-C）。
 *
 * **不做二次排序**：`provider.list()` 已保证新→旧（同毫秒按写入次序），面板再排一次
 * 就是两处口径打架。分组只做「连续同日切一段」，这样同一天不会跨到两个组里。
 *
 * @param {Array} records `provider.list()` 的返回
 * @param {number} [now] 注入的「当前时间」
 * @returns {Array<{ key: string, label: string, items: Array }>}
 */
export function groupVersionsByDay(records, now) {
  const groups = []
  if (!Array.isArray(records)) return groups
  for (let i = 0; i < records.length; i += 1) {
    const record = records[i]
    if (!record || typeof record !== 'object') continue
    const createdAt = Number.isFinite(record.createdAt) ? record.createdAt : 0
    // `createdAt <= 0` 是 `normalizeSnapshot` 给缺失时间的兜底；单独归到「未知时间」组，
    // 否则 `new Date(0)` 会让它掉进 1970-01-01，看着像一份真实的远古版本。
    const key = createdAt > 0 ? dayKeyOf(createdAt) : ''
    const tail = groups.length ? groups[groups.length - 1] : null
    if (tail && tail.key === key) {
      tail.items.push(record)
      continue
    }
    groups.push({ key, label: formatVersionDayLabel(createdAt, now), items: [record] })
  }
  return groups
}

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
  if (!session.can(capability)) {
    return { allowed: false, reason: '当前用户没有该操作的权限', missingProvider: false }
  }
  const missingProvider = typeof session.getProvider === 'function' && !session.getProvider('versioning')
  if (missingProvider) return { allowed: false, reason: '未配置 versioning Provider', missingProvider: true }
  return { allowed: true, reason: '', missingProvider: false }
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

/** 默认版本名：04 §⑤-2 实测「{文档名} 第 {N} 版」（`/code 第 1 版` 共 11 字符）。 */
export function defaultVersionLabel(title, ordinal) {
  const bag = (title && String(title).trim()) || '未命名文档'
  const n = Number.isInteger(ordinal) && ordinal > 0 ? ordinal : 1
  return `${bag} 第 ${n} 版`
}

/** 默认版本名里的 {N}。实测只有一条样本（`/code 第 1 版`），口径未采，见方法内注释。 */
function nextVersionOrdinal(records) {
  return Array.isArray(records) ? records.length + 1 : 1
}

function pairOf(records, index) {
  if (!Array.isArray(records) || index < 0) return { prev: null, current: null }
  // `records` 是 new → old，所以「更早的那份」是 index + 1。
  return { prev: records[index + 1] || null, current: records[index] || null }
}

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
      /** 列表级错误（拉不到列表时整个右栏走降级，不白屏）。 */
      versionError: '',
      /** Decoded document and immutable version metadata for the readonly preview. */
      versionPreview: null,
      versionPreviewLoading: false,
      versionRestoreConfirmOpen: false,
      versionRestoreTargetId: '',
      /** 预览级错误（单个版本取不到时只降级这一屏）。 */
      versionPreviewError: '',
      /** 成功提示（④-2 的 toast「版本已保存，可在 ··· 更多菜单中找到」）。 */
      versionNotice: '',
      /** 「另存为版本」Dialog（04 §⑤-2）。 */
      saveVersionOpen: false,
      /** 版本名；计数上限来自 `SNAPSHOT_LABEL_MAX`（实测 `11/1000`）。 */
      saveVersionName: '',
      saveVersionBusy: false,
      saveVersionError: '',
    }
  },

  watch: {
    session(next, previous) { if (next !== previous) this.resetVersionContext() },
    documentId(next, previous) { if (next !== previous) this.resetVersionContext() },
    'session.documentId'(next, previous) { if (next !== previous) this.resetVersionContext() },
  },
  beforeDestroy() {
    this._versionLoadToken = (this._versionLoadToken || 0) + 1
    this._versionPreviewToken = (this._versionPreviewToken || 0) + 1
    this._versionSaveToken = (this._versionSaveToken || 0) + 1
    this._versionRestoreToken = (this._versionRestoreToken || 0) + 1
  },

  computed: {
    versionRestoreConfirmText() {
      const record = this.versionList.find(item => item.id === this.versionRestoreTargetId)
      if (!record) return ''
      const date = new Date(record.createdAt)
      return `将当前文档还原至 ${date.getMonth() + 1}月${date.getDate()}日 ${formatVersionClock(record.createdAt)} 的状态`
    },
    /** 「另存为版本」闸门（05 §5.4 源码实测 `canCreateVersion`）。 */
    versionCanCreate() {
      return (!this.writable || this.writable()) && versionCapabilityGate(this.session, 'canCreateVersion').allowed
    },
    /** 「还原此历史记录」闸门（05 §5.4 源码实测 `canRestoreVersion`）。 */
    versionCanRestore() {
      return (!this.writable || this.writable()) && versionCapabilityGate(this.session, 'canRestoreVersion').allowed
    },
    /** 置灰但不隐藏：rule「无权限 = 挂载 + 置灰」。文案告诉用户是权限还是接线问题。 */
    versionCanCreateReason() {
      return this.writable && !this.writable() ? '当前为只读模式，无法创建版本' : versionCapabilityGate(this.session, 'canCreateVersion').reason
    },
    versionCanRestoreReason() {
      return this.writable && !this.writable() ? '当前为只读模式，无法还原版本' : versionCapabilityGate(this.session, 'canRestoreVersion').reason
    },
    /** versioning Provider 的唯一取值点；没有就是 null，所有写操作在此统一截断。 */
    versionProvider() {
      return this.session && typeof this.session.getProvider === 'function'
        ? this.session.getProvider('versioning')
        : null
    },
    /** 右栏时间线：按天分组后的 `[{ key, label, items }]`。 */
    versionDayGroups() {
      return groupVersionsByDay(this.versionList)
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
      if (this.versionRestoreBusy || this.versionPreviewLoading || this.versionPreviewError) return true
      if (this.session?.readVersionDocument && !this.versionPreview?.document) return true
      if (this.versionSelectedId && this.session?.getCurrentVersionId?.() === this.versionSelectedId) return true
      return !this.versionSelected || !this.versionCanRestore
    },
    /** 上一项：游标在首条时禁用（实测 1/10 时 `#BBBFC4` + `not-allowed`）。 */
    versionPrevDisabled() {
      return this.versionTotal === 0 || this.versionIndex <= 1
    },
    /** 下一项：游标在末条时禁用（B 表只采到 1/10 的启用态，末条按对称处理）。 */
    versionNextDisabled() {
      return this.versionTotal === 0 || this.versionIndex >= this.versionTotal
    },
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
    /** 输入框 `maxlength`：与 `SNAPSHOT_LABEL_MAX` 同源，避免 lint/表里两处写 1000。 */
    versionNameMax() {
      return SNAPSHOT_LABEL_MAX
    },
    /** §⑤-2 的标题原文「保存 今天 00:18 的文档版本」—— 时间点 = 打开 Dialog 的那一刻。 */
    saveVersionDialogTitle() {
      const now = Date.now()
      return `保存 ${formatVersionDayLabel(now, now)} ${formatVersionClock(now)} 的文档版本`
    },
    /** 草稿版本名的计数，实测 `11/1000` → 输入 4 字后 `15/1000`（**追加**，不是全选替换）。 */
    versionNameCounter() {
      return `${this.saveVersionName.length}/${SNAPSHOT_LABEL_MAX}`
    },
  },

  methods: {
    versionContextMatches(session, provider, editor) {
      return !this._isDestroyed && !editor?.isDestroyed && this.session === session && this.versionProvider === provider && this.editor === editor
    },
    resetVersionContext() {
      this._versionLoadToken = (this._versionLoadToken || 0) + 1
      this._versionPreviewToken = (this._versionPreviewToken || 0) + 1
      this._versionSaveToken = (this._versionSaveToken || 0) + 1
      this._versionRestoreToken = (this._versionRestoreToken || 0) + 1
      this.versionList = []
      this.versionIndex = 0
      this.versionSelectedId = ''
      this.versionPreview = null
      this.versionPreviewError = ''
      this.versionPreviewLoading = false
      this.versionLoading = false
      this.versionRestoreBusy = false
      this.versionRestoreConfirmOpen = false
      this.versionRestoreTargetId = ''
      this.saveVersionOpen = false
      this.saveVersionBusy = false
      this.saveVersionName = ''
      this.saveVersionError = ''
      this.versionError = ''
      this.versionNotice = ''
      if (this.versionPanelOpen) this.loadVersions()
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
     * 打开历史面板。04 §3.4 ③ 的入口是顶栏「更多」菜单里的「历史记录」，
     * 那个菜单项不在本线的交付清单里 —— 由宿主调用本方法即可。
     */
    async openVersionPanel() {
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
      this.versionPreview = null
      this.versionPreviewLoading = false
      this.versionPreviewError = ''
      this.versionSelectedId = ''
      this.versionError = ''
    },

    /** 拉列表；拉不动时右栏显示降级文案而不是空白（面板自己不抛、不白屏）。 */
    async loadVersions() {
      const provider = this.versionProvider
      const session = this.session, editor = this.editor
      const token = (this._versionLoadToken || 0) + 1
      this._versionLoadToken = token
      const current = () => token === this._versionLoadToken && this.versionContextMatches(session, provider, editor)
      if (!provider) {
        this.versionList = []
        this.versionError = '未配置 versioning Provider，历史记录不可用'
        return []
      }
      this.versionLoading = true
      this.versionError = ''
      try {
        const list = await provider.list({ documentId: session ? session.documentId : '' })
        if (!current()) return []
        this.versionList = Array.isArray(list) ? list : []
        this.versionIndex = this.versionList.length ? 1 : 0
        this.versionSelectedId = this.versionList.length ? this.versionList[0].id : ''
        return this.versionList
      } catch (error) {
        if (!current()) return []
        this.versionList = []
        this.versionError = versioningErrorMessage(error) || VERSIONING_ERROR_FALLBACK
        return []
      } finally {
        if (current()) this.versionLoading = false
      }
    },

    /** 选中某个版本 → 拉全文。`get()` 失败只降级这一屏，列表还在。 */
    async selectVersion(versionId) {
      const id = typeof versionId === 'string' ? versionId : ''
      if (!id) return null
      this.versionSelectedId = id
      const index = this.indexOfVersion(id)
      if (index >= 0) this.versionIndex = index + 1
      const provider = this.versionProvider
      const session = this.session, editor = this.editor
      const token = (this._versionPreviewToken || 0) + 1
      this._versionPreviewToken = token
      const current = () => token === this._versionPreviewToken && this.versionContextMatches(session, provider, editor) && this.versionSelectedId === id
      if (!provider) {
        this.versionPreview = null
        this.versionPreviewError = VERSIONING_ERROR_TEXT[E_SNAPSHOT_PAYLOAD_MISSING]
        return null
      }
      this.versionPreviewError = ''
      this.versionPreview = null
      this.versionPreviewLoading = true
      try {
        const record = await provider.get(id)
        if (!current()) return null
        const bytes = toBytes(record && record.payload)
        let document = null, contentError = ''
        if (bytes && session?.readVersionDocument) {
          try {
            document = await session.readVersionDocument(id, record)
            if (editor?.schema) validateDocument(document.content, editor.schema)
          } catch (error) { document = null; contentError = versioningErrorMessage(error) }
        }
        if (!current()) return null
        this.versionPreview = {
          id: record.id,
          label: record.label,
          createdAt: record.createdAt,
          author: record.author,
          kind: record.kind,
          pinned: Boolean(record.pinned),
          sizeBytes: record.sizeBytes,
          blockCount: record.blockCount,
          // 有没有正文，决定左栏画「只读预览」还是「二进制快照 N 字节」的降级卡。
          hasPayload: Boolean(bytes),
          byteLength: payloadSize(record && record.payload),
          restore: record.kind === SNAPSHOT_KIND.RESTORE,
          document,
        }
        this.versionPreviewError = contentError
        return this.versionPreview
      } catch (error) {
        if (!current()) return null
        this.versionPreview = null
        this.versionPreviewError = versioningErrorMessage(error)
        return null
      } finally {
        if (current()) this.versionPreviewLoading = false
      }
    },

    /**
     * 时间线条目名（04 §3.4-C：`-item-name` 实测「10月25日 00:04」）。
     *
     * 做成方法而不是 computed：`groupVersionsByDay` 会打散下标，模板按记录取比按
     * 下标取更不容易错位（差一位就会把 A 的时间贴到 B 上）。
     */
    versionItemName(record) {
      return formatVersionTime(record ? record.createdAt : 0) || VERSIONING_DAY_LABELS.unknown
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

    indexOfVersion(versionId) {
      for (let i = 0; i < this.versionList.length; i += 1) {
        if (this.versionList[i].id === versionId) return i
      }
      return -1
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
      if (this.versionRestoreDisabled) return false
      this.versionRestoreTargetId = this.versionSelectedId
      this.versionRestoreConfirmOpen = true
      return true
    },
    closeVersionRestoreConfirm() { this.versionRestoreConfirmOpen = false; this.versionRestoreTargetId = '' },
    confirmVersionRestore() {
      if (!this.versionRestoreConfirmOpen || !this.versionRestoreTargetId) return null
      const id = this.versionRestoreTargetId
      this.closeVersionRestoreConfirm()
      return this.restoreSelectedVersion(id)
    },
    async restoreSelectedVersion(versionId = this.versionSelectedId) {
      if (this.versionRestoreBusy || !this.versionSelected) return null
      if (!this.versionCanRestore) {
        this.versionPreviewError = versionCapabilityGate(this.session, 'canRestoreVersion').reason
        return null
      }
      this.versionRestoreBusy = true
      this.versionPreviewError = ''
      const session = this.session, provider = this.versionProvider, editor = this.editor
      const token = (this._versionRestoreToken || 0) + 1
      this._versionRestoreToken = token
      const current = () => token === this._versionRestoreToken && this.versionContextMatches(session, provider, editor)
      try {
        const created = await session.restoreVersion(versionId)
        if (!current()) return created
        await this.loadVersions()
        if (!current()) return created
        if (this.versionSelectedId) await this.selectVersion(this.versionSelectedId)
        if (!current()) return created
        this.versionNotice = '已恢复为新版本，原版本仍保留在历史记录中'
        return created
      } catch (error) {
        if (!current()) return null
        this.versionPreviewError = versioningErrorMessage(error)
        return null
      } finally {
        if (current()) this.versionRestoreBusy = false
      }
    },

    /**
     * 开「另存为版本」Dialog。无 `canCreateVersion` 时**挂载但不打开**（rule：置灰 + 直接
     * return，不隐藏）—— 由调用方决定要不要把入口画成置灰。
     */
    openSaveVersionDialog() {
      if (!this.versionCanCreate) {
        this.saveVersionError = versionCapabilityGate(this.session, 'canCreateVersion').reason
        return false
      }
      this.saveVersionOpen = true
      this._saveVersionDialogEpoch = (this._saveVersionDialogEpoch || 0) + 1
      this.saveVersionError = ''
      // 04 §⑤-2 实测默认名 =「{文档名} 第 {N} 版」。N 的口径未采（`/code 第 1 版` 只有一条
      // 样本），这里取「当前版本总数 + 1」—— 包含自动快照也算一条，属推断。
      if (!this.saveVersionName) {
        const ordinal = nextVersionOrdinal(this.versionList)
        this.saveVersionName = defaultVersionLabel(this.localTitle, ordinal)
      }
      return true
    },

    closeSaveVersionDialog() {
      this._saveVersionDialogEpoch = (this._saveVersionDialogEpoch || 0) + 1
      this.saveVersionOpen = false
      this.saveVersionName = ''
      this.saveVersionError = ''
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
      const token = (this._versionSaveToken || 0) + 1
      const epoch = this._saveVersionDialogEpoch
      this._versionSaveToken = token
      const current = () => token === this._versionSaveToken && this.versionContextMatches(session, provider, editor)
      try {
        const label = this.saveVersionName.trim() || defaultVersionLabel(this.localTitle, nextVersionOrdinal(this.versionList))
        const created = await session.createVersion({ label, title: this.localTitle })
        if (!current()) return created
        if (this._saveVersionDialogEpoch === epoch) this.closeSaveVersionDialog()
        // 04 §⑤-2 的成功 toast 原文：「版本已保存，可在 ··· 更多菜单中找到」+「立即查看」。
        this.versionNotice = '版本已保存，可在 ··· 更多菜单中找到'
        if (this.versionPanelOpen) await this.loadVersions()
        return created
      } catch (error) {
        if (!current()) return null
        this.saveVersionError = versioningErrorMessage(error)
        return null
      } finally {
        if (current()) this.saveVersionBusy = false
      }
    },

    dismissVersionNotice() {
      this.versionNotice = ''
    },

    /** 时间线项的类：选中态 `selected` 由 04 §3.4-C 定义（底 `#E0E9FF`、字 `#336DF4`）。 */
    versionTimelineClass(record) {
      return {
        selected: Boolean(record) && record.id === this.versionSelectedId,
      }
    },

    /** 置灰态：底 `rgb(187,191,196)`、`cursor: not-allowed`（04 §3.4-B 实测 + 铁律 3）。 */
    versionDisabledStyle(disabled) {
      return disabled ? { backgroundColor: DISABLED_FILL, cursor: 'not-allowed' } : null
    },
  },
}
