import { documentStatistics, documentMenuChildren, referenceDocumentMenuItems, referenceDocumentMenuChildren, runDocumentMenuAction, runReferenceDocumentMenuAction } from './documentMenuView'

const referenceMenu = host => host._mobileEditorMedia ? host._mobileEditorMedia.matches === true : typeof window !== 'undefined' && window.innerWidth <= 760

/**
 * 顶栏「更多」菜单（P6b 顶栏四浮层之一）。
 *
 * 规格真源：requirements/04 §4.2.1 + 2026-11-22 的飞书「更多」菜单 2× 截图逐行复核
 * （像素规格：z 1030、面板 186 宽、行 30 高、9 条分隔线穿满整宽、子面板 z 1050）。
 *
 * 三条必须守住的红线：
 *
 *   1. **一级菜单是 23 项**，顺序照截图自上而下；`主题` 是我们自加的第 24 项，恒在末尾
 *      （飞书没有这一项，见 `topbarMoreItems` 的追加）。历史上曾按「手动建版本已改为
 *      后端自动快照」把 `另存为版本` 从表里删掉 —— 截图证明飞书桌面端仍然保留它，
 *      已恢复，并落在「打印」与「查看已存版本」之间。把「更多」子菜单里的 5 项
 *      （上传日志/联系客服/功能更新/帮助中心/快捷键）计进来会多出 5 项 —— 那 5 项来自
 *      **另一个离屏预挂载菜单**（采集快照坐标 -8560,-9123），§4.2 明确「不要写进『更多』
 *      子菜单」。
 *   2. **7 个项带右侧箭头**（页宽设置 / 下载为 / 翻译为英语 / 查看已存版本 / 文档权限 /
 *      文档小组件 / 更多），其中「文档小组件」的子面板内容来自 `documentWidgetItems`
 *      而非静态表。`翻译为英语` 的类名是 `ud__menu-normal-submenu` 但 **hover 与 click
 *      都不展开**，它是**立即执行的命令**（点击进入翻译模式）——飞书自身的类名复用，
 *      不是我们漏读。所以它的 `kind` 记成 `route`（有箭头、无面板、点击即执行）。
 *      另外 2 个项右侧是开关（关注文档更新 / 转换为模板），1 个是 help 圆点（添加快捷方式到）。
 *   3. **菜单宽度不许硬编码 175**。§4.2 ④-2 末尾给的反证：翻译模式菜单宽 160、项 152、
 *      分隔线 158，整体窄 15 —— 宽度由**最长文案自适应**。所以这里用 `fit-content`
 *      + `min-width`，CSS 里不写 175。
 *
 * 为什么把菜单项抽成常量而不是写在模板里：
 *   ① 23 项里大部分能力（打印 / 创建副本 / 移动到 / 历史记录 …）在编辑器内核里**没有
 *      对应实现**，只有「抛给宿主」一条路；清单收在一张表里，才能一眼看出哪些是真接了线
 *      的、哪些是 emit 出去的，避免以后有人把 emit 项误当成已实现。
 *   ② 单测要能脱离 Vue 验证「顺序 / 分组 / 子面板归属 / 定位」，逻辑必须是纯函数。
 */

/**
 * 一级菜单 23 项，逐项对齐飞书「更多」菜单的 2× 截图（行 30 高、面板 186 宽、
 * 右侧附属物 7 个箭头 / 2 个开关 / 1 个 help 圆点全部逐行核对过）。
 *
 * `icon` 指向 `src/ui/icons.js` 的 `menu-*`，注释里是飞书的 `data-icon` 原名 ——
 * 逐个用 16px 截图做过墨迹重合度校验（IoU ≥ 0.98），只有 `menu-history` 是拟合的。
 * 第 5 列 `help` 存在时，右侧画 `?` 圆点并在悬停时给说明气泡（文案取飞书原文）。
 */
export const TOPBAR_MORE_ITEMS = Object.freeze([
  ['width', '页宽设置', 'menu-width', 'submenu'], // FullWidthOutlined
  ['slides', '演示模式', 'menu-presentation'], // PresentationOutlined
  ['follow', '关注文档更新', 'menu-follow', 'switch'], // SubscribeAddOutlined
  ['find', '查找和替换', 'menu-find'], // CardSearchOutlined
  // 「添加快捷方式到」右侧是 help 圆点而非子菜单箭头，悬停出说明。
  ['shortcut', '添加快捷方式到', 'menu-shortcut', 'item', '添加后支持从不同位置展示并链接到原始内容'], // NewShortcutOutlined
  ['move', '移动到', 'menu-move'], // MoveToOutlined
  ['pin', '添加到“置顶”', 'menu-pin'], // ChatPinOutlined
  ['favorite', '添加到收藏', 'menu-favorite'], // CollectionOutlined
  ['template', '转换为模板', 'menu-template', 'switch'], // TemplateOutlined
  ['duplicate', '创建副本', 'menu-duplicate'], // CopyOutlined
  ['download-as', '下载为', 'menu-download', 'submenu'], // ExportOutlined
  // 翻译点击后进入翻译模式，右侧箭头指向该操作。
  ['translate', '翻译为英语', 'menu-translate', 'route'], // TranslateOutlined
  ['print', '打印', 'menu-print'], // PrinterOutlined
  ['save-version', '另存为版本', 'menu-save-version'], // ReadinfoOutlined
  ['view-versions', '查看已存版本', 'menu-versions', 'submenu'], // OperationrecordOutlined
  ['doc-permission', '文档权限', 'menu-permission', 'submenu'], // SettingOutlined
  ['widgets', '文档小组件', 'menu-widgets', 'submenu'], // PluginOutlined
  ['doc-info', '文档信息', 'menu-info'], // InfoOutlined
  ['mentioned', '提及的人', 'menu-mention'], // AtOutlined
  ['history', '历史记录', 'menu-history'], // 飞书该图标未捕获，按截图拟合
  ['history-comments', '历史评论', 'menu-history-comments'], // HistoryCommantOutlined
  ['more', '更多', 'menu-more', 'submenu'], // MoreOutlined
  ['delete', '删除', 'menu-delete'], // DeleteTrashOutlined
].map(([id, label, icon, kind = 'item', help], index) => ({
  id, label, icon, kind, order: index + 1, enabled: true, action: id,
  ...(help ? { help } : {}),
  // 右侧是开关的项（关注文档更新 / 转换为模板）不画子面板箭头。
  affordance: kind === 'submenu' || kind === 'route' ? 'arrow' : 'none',
})))

/**
 * 分隔线：标记「哪一项之后画线」。
 *
 * 直接照 2× 截图里 9 条线的位置写死（y 序列 236/370/624/886/960/1102/1184/1264 + 尾段
 * 「历史评论」之后那条），落成 10 个分组：
 *
 *   ① 视图（页宽设置/演示模式）② 关注（关注文档更新/查找和替换）
 *   ③ 快捷方式（添加快捷方式到/移动到/添加到「置顶」/添加到收藏）
 *   ④ 模板与副本（转换为模板/创建副本）⑤ 导出（下载为/翻译为英语）
 *   ⑥ 打印 ⑦ 版本（另存为版本/查看已存版本）⑧ 权限（文档权限）
 *   ⑨ 小组件（文档小组件）⑩ 信息（文档信息/提及的人/历史记录/历史评论）
 *   ⑪ 危险区（更多/删除）
 *
 * 注意两处「反直觉」但截图确凿的事实：
 *   ① 「页宽设置」与「演示模式」之间**没有**线（都在视图组里）；
 *   ② 「打印」独自成组 —— 它前后各有一条线，别把「另存为版本」并进去。
 */
export const TOPBAR_MORE_DIVIDER_AFTER = Object.freeze([
  'slides', 'find', 'favorite', 'translate', 'print', 'view-versions', 'doc-permission', 'widgets', 'history-comments',
])

/**
 * 5 个子面板。
 *
 * 前 3 个来自 §4.2 ④-3 的实测（下载为 120×108 / 文档权限 121×115 / 更多 198×142），
 * 后 2 个来自 §4.2.1 的前台复核（查看已存版本窄面板 / 页宽设置三档）。
 * 宽度同样是自适应，不做常量断言。
 */
export const TOPBAR_MORE_SUBPANELS = Object.freeze({
  'download-as': Object.freeze([
    { id: 'word', label: 'Word', action: 'export.word' },
    { id: 'pdf', label: 'PDF', action: 'export.pdf' },
    { id: 'markdown', label: 'Markdown', action: 'export.markdown' },
  ]),
  'doc-permission': Object.freeze([
    // 飞书只有「管理协作者」这一项带图标（`AdminSettingOutlined`），另两项源码无 icon，别补。
    { id: 'manage-collaborator', label: '管理协作者', icon: 'menu-admin-setting', action: 'permission.manage' },
    { id: 'permission-settings', label: '权限设置', action: 'permission.settings' },
    { id: 'divider', label: '', kind: 'divider' },
    { id: 'transfer-owner', label: '转移所有权', action: 'permission.transfer' },
  ]),
  more: Object.freeze([
    { id: 'add-app', label: '添加文档应用', action: 'more.add-app' },
    { id: 'show-author', label: '在段落前显示作者', kind: 'switch', action: 'more.show-author' },
    { id: 'offline', label: '设为离线可使用', kind: 'switch', action: 'more.offline' },
    // 飞书该项带图标（`WarnReportOutlined`）；同面板其余项源码无 icon。
    { id: 'report', label: '举报', icon: 'menu-report', action: 'more.report' },
  ]),
  'view-versions': Object.freeze([
    { id: 'v1', label: '/code 第 1 版复盘V1', action: 'version.open' },
    { id: 'trash', label: '版本回收站', action: 'version.trash' },
  ]),
  // §4.2.1：页宽三档文案是 默认 / 较宽 / 全宽，映射到内核 widthMode 的 standard/wide/full。
  width: Object.freeze([
    { id: 'standard', label: '默认', action: 'width.standard' },
    { id: 'wide', label: '较宽', action: 'width.wide' },
    { id: 'full', label: '全宽', action: 'width.full' },
  ]),
})

/** 只读态（阅读模式）下必须置灰的项 —— 全是写操作，读态不该给入口。 */
export const TOPBAR_MORE_READONLY_DISABLED = Object.freeze([
  'delete', 'duplicate', 'template', 'translate', 'move', 'pin', 'favorite', 'shortcut', 'follow',
])

/** 需要读 capability 才能决定启用态的项：不在表里的项恒启用。 */
export const TOPBAR_MORE_CAPABILITY = Object.freeze({
  'download-as': 'canExport',
  'view-versions': 'canRestoreVersion',
  'doc-permission': 'canManagePermission',
  duplicate: 'canCopy',
  template: 'canCopy',
})

/**
 * 定位纯函数：一级菜单。
 *
 * 飞书实测 popover 在触发按钮下方 4px、右边缘与按钮右边缘基本对齐（§4.2 里 popover
 * x=1073..1248、more-btn x=1235），所以规则是「右对齐锚点右边缘 + 下方 4px」，
 * 放不下就翻到上方，左右再各夹 8px 视口边距。
 *
 * @param {{left:number,top:number,right:number,bottom:number}} anchor 触发按钮 rect
 * @param {{width:number,height:number}} size 菜单实测尺寸（宽度自适应，运行时给）
 * @param {{width:number,height:number}} viewport 视口尺寸
 * @returns {{left:number,top:number}} fixed 定位坐标（px）
 */
export function topbarMoreMenuStyle(anchor, size, viewport) {
  if (!anchor || !size) return { left: 0, top: 0 }
  const width = size.width || 0
  const height = size.height || 0
  const maxLeft = Math.max(8, (viewport && viewport.width ? viewport.width : 0) - width - 8)
  const left = Math.min(Math.max(anchor.right - width, 8), maxLeft)
  const below = anchor.bottom + 4
  const flip = below + height > (viewport && viewport.height ? viewport.height : Infinity) && anchor.top - height - 4 >= 8
  return { left, top: flip ? anchor.top - height - 4 : below }
}

/** 窄屏命中区大于26px视觉图标；弹层跟视觉图标定位，给底部系统区域留白。 */
export function referenceTopbarMoreMenuStyle(anchor, size, viewport) {
  if (!anchor || !size) return { left: 0, top: 0 }
  const width = anchor.width || anchor.right - anchor.left, height = anchor.height || anchor.bottom - anchor.top
  const visualRight = anchor.right - Math.max(0, (width - 26) / 2)
  const visualBottom = anchor.bottom - Math.max(0, (height - 26) / 2)
  const left = Math.max(16, Math.min(visualRight - 4 - size.width, viewport.width - size.width - 16))
  const top = Math.max(8, Math.round(visualBottom + 4))
  return { left, top, maxHeight: Math.max(32, viewport.height - top - 27) }
}

/**
 * 定位纯函数：二级子面板。
 *
 * §4.2 ④-4「子面板贴边规律（补）」：主菜单右边缘 1247 = 子面板左边缘 1247 ⇒ **零间隙
 * 贴靠**，不是常见的 +4 偏移（内容区才从 +4 起）。右侧放不下时翻到父菜单左侧。
 *
 * @param {{left:number,top:number,right:number}} menu 一级菜单 rect
 * @param {{top:number,height:number}} item 被 hover 的一级项 rect
 * @param {{width:number,height:number}} size 子面板尺寸
 * @param {{width:number,height:number}} viewport 视口尺寸
 */
export function topbarMoreSubmenuStyle(menu, item, size, viewport) {
  if (!menu || !size) return { left: 0, top: 0 }
  const width = size.width || 0
  const height = size.height || 0
  const right = menu.right || 0
  const overflowRight = right + width > (viewport && viewport.width ? viewport.width : Infinity)
  const left = overflowRight ? Math.max(8, (menu.left || 0) - width) : right
  let top = item && typeof item.top === 'number' ? item.top - 2 : (menu.top || 0)
  const limit = (viewport && viewport.height ? viewport.height : Infinity) - height - 8
  if (top > limit) top = Math.max(8, limit)
  return { left, top: Math.max(8, top) }
}

/** 单项是否展示右侧箭头（submenu / route 且有 affordance）。 */
export function topbarMoreHasArrow(item) {
  return Boolean(item) && item.affordance === 'arrow'
}

/**
 * 把 23 项展平成「渲染行」：菜单项之间按需插入 divider 行。
 * divider 不占 `order`，因此不影响 §4.2.1 的项序断言。
 */
export function topbarMoreRows(items = TOPBAR_MORE_ITEMS, dividerAfter = TOPBAR_MORE_DIVIDER_AFTER) {
  const rows = []
  for (let i = 0; i < items.length; i += 1) {
    rows.push({ kind: 'item', item: items[i] })
    if (dividerAfter.indexOf(items[i].id) >= 0) rows.push({ kind: 'divider', id: `divider-${items[i].id}` })
  }
  return rows
}

export default {
  data() {
    return {
      topbarMoreOpen: false,
      /** 触发按钮的 rect（渲染后按实测尺寸定位时需要）。 */
      topbarMoreAnchor: null,
      /** 当前展开的子面板 id（'' = 无）。 */
      topbarMoreSubmenu: '',
      /** 一级菜单/子面板的 fixed 定位样式。 */
      topbarMoreStyle: { left: 0, top: 0 },
      topbarMoreSubmenuStyle: { left: 0, top: 0 },
      /** 「在段落前显示作者 / 设为离线可使用」两个 switch 的本地态。 */
      topbarMoreShowAuthor: false,
      topbarMoreOffline: false,
      topbarMoreMessage: '',
      topbarMoreBusy: false,
      /** 关注状态来自 Provider（非 Vue 响应式），成功后靠 revision 强制刷新开关。 */
      topbarMoreRevision: 0,
      docToast: '',
      /** 飞书消息条栈：连续操作各占一条，互不替换（真身截图两条上下并存）。 */
      docToasts: [],
    }
  },
  computed: {
    /** 23 项（含运行时启用态），模板唯一数据源。 */
    topbarMoreItems() {
      if (referenceMenu(this) || this.compactHeader) {
        const items = this.topbarMoreOpen ? referenceDocumentMenuItems(this) : []
        // 读取 revision 建立依赖：关注写入后开关必须立刻反映新状态。
        if (this.topbarMoreRevision < 0) return []
        return items.map(item => this.topbarMoreBusy ? { ...item, enabled: false, title: '正在处理文档操作。' } : item)
      }
      const capability = TOPBAR_MORE_CAPABILITY
      // 读取 revision 建立依赖：关注写入后开关必须立刻反映新状态（Provider 状态不是响应式的）。
      if (this.topbarMoreRevision < 0) return []
      const business = this.session?.getProvider?.('documentBusiness')?.getState?.()
      const followed = business?.followed
      return [...TOPBAR_MORE_ITEMS, { id: 'theme', label: '主题', kind: 'submenu', icon: 'sparkle', enabled: true }].map((item) => {
        const key = capability[item.id]
        let enabled = item.enabled
        if (key && typeof this.shareCan === 'function' && !this.shareCan(key)) enabled = false
        // 阅读态（只读）下写操作一律置灰：删除/创建副本/转换为模板/翻译。
        if (enabled && this.effectiveReadonly && TOPBAR_MORE_READONLY_DISABLED.indexOf(item.id) >= 0) enabled = false
        if (item.id === 'history-comments') enabled = enabled && this.commentCanViewHistory?.() === true
        if (item.id === 'save-version') enabled = enabled && this.versionCanSave === true
        // 没有任何已装小组件时子面板会是空的，飞书此时也不给入口。
        if (item.id === 'widgets') enabled = enabled && !!this.documentWidgetItems?.length
        // 关注 / 转换为模板是开关：勾选态来自 documentBusiness，写入期间整行禁用（飞书同款）。
        if (item.id === 'follow' || item.id === 'template') return { ...item, enabled: enabled && !this.topbarMoreBusy,
          ...(this.topbarMoreBusy ? { title: '正在处理文档操作。' } : {}),
          checked: (item.id === 'follow' ? followed : business?.isTemplate) === true }
        return { ...item, enabled, ...(!enabled && item.id === 'history-comments' ? { title: '当前评论服务不可用或没有查看权限' } : {}) }
      })
    },
    /** 渲染行（含分隔线）。 */
    topbarMoreRows() {
      if (referenceMenu(this) || this.compactHeader) {
        const rows = []
        this.topbarMoreItems.forEach(item => {
          if (item.separator) rows.push({ kind: 'divider', item: { id: 'before-' + item.id } })
          rows.push({ kind: 'item', item })
        })
        if (this.topbarMoreMessage) rows.push({ kind: 'item', item: { id: 'operation-status', label: this.topbarMoreMessage, enabled: false, title: this.topbarMoreMessage } })
        return rows
      }
      return topbarMoreRows(this.topbarMoreItems)
    },
    /** 当前子面板项列表；无子面板时为 []。 */
    topbarMoreSubmenuItems() {
      if (!this.topbarMoreSubmenu) return []
      if (referenceMenu(this) || this.compactHeader) {
        const items = referenceDocumentMenuChildren(this, this.topbarMoreSubmenu)
        if (this.topbarMoreSubmenu === 'saved-versions' && (this.versionLoading || this.versionError || !items.some(item => item.id === 'saved-versions'))) {
          const label = this.versionLoading ? '正在加载已存版本…' : this.versionError ? '已存版本加载失败，请关闭后重试' : '暂无已存版本'
          items.unshift({ id: 'saved-versions-status', label, title: label, enabled: false, disabled: true })
        }
        return items
      }
      if (this.topbarMoreSubmenu === 'theme') return documentMenuChildren(this, 'theme')
      // 文档小组件的子面板是动态的（已装小组件 + 「更多/管理小组件」两个入口），不在静态表里。
      if (this.topbarMoreSubmenu === 'widgets') return (this.documentWidgetItems || []).map(item => ({ ...item, action: 'widgets' }))
      return TOPBAR_MORE_SUBPANELS[this.topbarMoreSubmenu] || []
    },
  },
  watch: {
    topbarMoreMessage() { this.refreshTopBar?.() },
    topbarMoreBusy() { this.refreshTopBar?.() },
    session() { this.closeDocumentInformation(); this.retireSavedVersionsMenu() },
    'session.user.id'() { this.closeDocumentInformation(); this.retireSavedVersionsMenu() },
    versionProvider() { this.retireSavedVersionsMenu() },
  },
  beforeDestroy() {
    this.closeDocumentInformation(); this.retireSavedVersionsMenu()
    if (this._docToastTimers) { this._docToastTimers.forEach(clearTimeout); this._docToastTimers = null }
  },
  methods: {
    /**
     * 飞书文档级消息条（关注/取消关注）：顶部居中、每条独立 3s 自收、连续操作上下堆叠。
     * 真身两条并存（见 specs/008 的 REA 截图），所以不再用单条替换。
     * `docToast` 保留为最后一条的影子，兼容旧调用方与测试。
     */
    showDocumentToast(text = '') {
      if (!text) {
        if (this._docToastTimers) { this._docToastTimers.forEach(clearTimeout); this._docToastTimers = [] }
        this.docToasts = []; this.docToast = ''
        this.refreshTopBar?.()
        return
      }
      const timers = this._docToastTimers || (this._docToastTimers = [])
      if (!this._docToastSeq) this._docToastSeq = 0
      const id = ++this._docToastSeq
      this.docToasts = [...(this.docToasts || []), { id, text }]
      this.docToast = text
      this.refreshTopBar?.()
      // 用闭包 id 精确摘除自己，避免并发时误删别的消息条。
      const timer = setTimeout(() => {
        const at = timers.indexOf(timer)
        if (at >= 0) timers.splice(at, 1)
        this.docToasts = (this.docToasts || []).filter(item => item.id !== id)
        this.docToast = this.docToasts.length ? this.docToasts[this.docToasts.length - 1].text : ''
        this.refreshTopBar?.()
      }, 3000)
      timers.push(timer)
    },
    retireSavedVersionsMenu() {
      this._savedVersionsMenuRead = null
      if (this.topbarMoreSubmenu === 'saved-versions') this.topbarMoreSubmenu = ''
    },
    async loadSavedVersionsMenu() {
      const ticket = this._savedVersionsMenuRead = {}, epoch = this._referenceMoreEpoch
      const context = { session: this.session, provider: this.versionProvider, editor: this.editor,
        documentId: this.documentId, scope: this.versionOperationScope() }
      const current = () => this._savedVersionsMenuRead === ticket && epoch === this._referenceMoreEpoch
        && this.topbarMoreOpen && this.topbarMoreSubmenu === 'saved-versions' && !this._isBeingDestroyed
        && this.versionOperationMatches(context) && this.shareCan('canView')
      if (!current()) return false
      await this.loadVersions()
      if (!current()) return false
      this.refreshTopBar?.()
      this.$nextTick(() => { if (current()) this.measureTopbarMoreSubmenu() })
      return true
    },
    closeDocumentInformation() {
      this._documentInformationTicket = null
      this._documentInformationOff?.splice(0).forEach(off => off?.())
      const panel = this._documentInformationPanel; this._documentInformationPanel = null
      panel?.destroy()
    },
    async openDocumentInformation(view = 'information', actionCurrent = () => true) {
      this.closeDocumentInformation()
      const ticket = this._documentInformationTicket = {}
      const session = this.session, editor = this.editor, provider = session?.getProvider?.('authorization'),
        principal = session?.user?.id, identity = session?._privateIdentityGeneration, auth = session?._authorizationGeneration,
        documentId = session?.documentId
      const current = () => this._documentInformationTicket === ticket && !this._isDestroyed && !this._isBeingDestroyed
        && session === this.session && !session?._destroyed && editor === this.editor && !editor?.isDestroyed && documentId === session?.documentId && principal === session?.user?.id
        && identity === session?._privateIdentityGeneration && auth === session?._authorizationGeneration
        && provider === session?.getProvider?.('authorization') && (!session?.can || session.can('canView'))
      const { createDocumentInformationPanel } = await import('../../../ui/documentInformation')
      if (!current() || !actionCurrent()) return false
      if (typeof session?.on === 'function') this._documentInformationOff = ['capabilities', 'identity', 'provider-changed', 'comments-reset'].map(name => session.on(name, () => this.closeDocumentInformation()))
      this._documentInformationPanel = createDocumentInformationPanel({ host: this.$el, initialView: view, current,
        statistics: documentStatistics(this), returnFocus: this.$el?.querySelector('.lark-doc-more-btn'),
        read: typeof provider?.documentInformation === 'function' ? input => provider.documentInformation('read', input) : undefined,
        onClose: () => { this._documentInformationTicket = null; this._documentInformationPanel = null; this._documentInformationOff?.splice(0).forEach(off => off?.()) },
      })
      if (!this._documentInformationPanel) this.closeDocumentInformation()
      return Boolean(this._documentInformationPanel)
    },
    /** 顶栏「更多」按钮点击：同一按钮二次点击收起（与分享 popover 同口径）。 */
    toggleTopbarMore(event) {
      if (this.topbarMoreOpen) {
        this.closeTopbarMore()
        return
      }
      const trigger = event?.currentTarget
      const rect = trigger?.getBoundingClientRect?.()
      if (!rect) return
      this._topbarMoreTrigger = trigger
      this.topbarMoreAnchor = rect
      this.topbarMoreOpen = true
      this._referenceMoreEpoch = (this._referenceMoreEpoch || 0) + 1
      this.topbarMoreMessage = ''
      this.topbarMoreSubmenu = ''
      this.$nextTick(this.measureTopbarMore)
    },
    closeTopbarMore() {
      this._referenceMoreEpoch = (this._referenceMoreEpoch || 0) + 1
      this._savedVersionsMenuRead = null
      this.topbarMoreOpen = false
      this.topbarMoreSubmenu = ''
    },
    /** 打开后按实测尺寸定位（宽度自适应 ⇒ 必须先渲染再量）。 */
    measureTopbarMore() {
      const menu = this.$refs && this.$refs.topbarMoreMenu
      if (!menu || !this.topbarMoreOpen) return
      const rect = menu.getBoundingClientRect()
      const viewport = {
        width: window.innerWidth,
        height: window.innerHeight,
      }
      const mobile = referenceMenu(this)
      this.topbarMoreStyle = (mobile ? referenceTopbarMoreMenuStyle : topbarMoreMenuStyle)(this.topbarMoreAnchor, rect, viewport)
      const list = menu.querySelector('.lark-doc-topbar-more-list')
      if (list) {
        if (mobile) {
          const css = getComputedStyle(menu)
          const inset = side => (parseFloat(css[`padding${side}`]) || 0) + (parseFloat(css[`border${side}Width`]) || 0)
          const offset = list.getBoundingClientRect().top - rect.top
          const consumed = Number.isFinite(offset) ? Math.max(inset('Top'), offset) : inset('Top')
          list.style.boxSizing = 'border-box'; list.style.padding = '2px 0'
          list.style.maxHeight = `${Math.max(0, this.topbarMoreStyle.maxHeight - consumed - inset('Bottom'))}px`
        } else { list.style.boxSizing = ''; list.style.padding = ''; list.style.maxHeight = '' }
      }
    },
    /** 一级项：submenu 展开子面板，其余立即执行。 */
    onTopbarMoreItem(item, event) {
      if (referenceMenu(this) || this.compactHeader) {
        if (!this.topbarMoreOpen || this.topbarMoreBusy) return
        const current = referenceDocumentMenuItems(this).find(entry => entry.id === item?.id)
        if (!current || !current.enabled) return
        if (!this.compactHeader && current.id === 'download' && window.matchMedia?.('(max-width:760px) and (pointer:coarse)').matches) {
          this.closeTopbarMore(); this.openExportFormatPicker(); return
        }
        if (current.id === 'translate' && event?.type === 'click' && !event.target?.closest?.('.lark-doc-topbar-more-item-arrow')) {
          return this.runReferenceMoreAction('translate', 'en', event)
        }
        if (current.kind === 'submenu') {
          this.topbarMoreSubmenu = this.topbarMoreSubmenu === current.id ? '' : current.id
          this.$nextTick(() => {
            this.measureTopbarMoreSubmenu()
            if (this.compactHeader && event?.detail === 0 && this.topbarMoreSubmenu === current.id) {
              this.$refs.topbarMoreSubmenu?.querySelector('button:not(:disabled)')?.focus()
            }
          })
          if (this.topbarMoreSubmenu === 'saved-versions') return this.loadSavedVersionsMenu()
          this._savedVersionsMenuRead = null
          return
        }
        return this.runReferenceMoreAction(current.id, undefined, event)
      }
      if (!item || item.enabled === false) return
      // 关注文档更新：原地翻开关并写 documentBusiness，菜单不关（飞书同款）。
      if (item.kind === 'switch') return this.runReferenceMoreAction(item.id, undefined, event)
      if (item.kind === 'submenu') {
        this.topbarMoreSubmenu = this.topbarMoreSubmenu === item.id ? '' : item.id
        this.$nextTick(this.measureTopbarMoreSubmenu)
        return
      }
      this.runTopbarMoreAction(item.action, item)
    },
    /** hover 一级项时切换子面板（§4.2 ④-3：hover ≥2000ms 才展开，这里简化为即展）。 */
    hoverTopbarMoreItem(item) {
      if (referenceMenu(this) || this.compactHeader) return
      if (!item || item.kind !== 'submenu' || item.enabled === false) return
      if (this.topbarMoreSubmenu === item.id) return
      this.topbarMoreSubmenu = item.id
      this.$nextTick(this.measureTopbarMoreSubmenu)
    },
    measureTopbarMoreSubmenu() {
      const menu = this.$refs && this.$refs.topbarMoreMenu
      const sub = this.$refs && this.$refs.topbarMoreSubmenu
      if (!menu || !sub || !this.topbarMoreSubmenu) return
      // 用 data 属性而不是 ref 数组： items 与 divider 混排在同一层，
      // ref-in-v-for 的下标会把分隔线也算进去，导致面板对齐到错误的行。
      const anchor = menu.querySelector(`[data-topbar-more-id="${this.topbarMoreSubmenu}"]`)
      const itemRect = anchor ? anchor.getBoundingClientRect() : menu.getBoundingClientRect()
      this.topbarMoreSubmenuStyle = topbarMoreSubmenuStyle(menu.getBoundingClientRect(), itemRect, sub.getBoundingClientRect(), {
        width: window.innerWidth,
        height: window.innerHeight,
      })
    },
    /** 子面板项点击。switch 项只翻本地态，不关菜单（与飞书 Switch 行为一致）。 */
    onTopbarMoreSubmenuItem(entry, event) {
      if (referenceMenu(this) || this.compactHeader) {
        if (!this.topbarMoreOpen || !this.topbarMoreSubmenu || this.topbarMoreBusy) return
        const current = referenceDocumentMenuChildren(this, this.topbarMoreSubmenu).find(item => item.id === entry?.id && item.value === entry?.value)
        if (!current || current.enabled === false || current.disabled) return
        return this.runReferenceMoreAction(current.action.slice('document:'.length), current.value, event)
      }
      if (!entry) return
      if (this.topbarMoreSubmenu === 'theme') { this.closeTopbarMore(); return runDocumentMenuAction(this, 'theme', entry.value, event) }
      if (entry.kind === 'switch') {
        if (entry.id === 'show-author') this.topbarMoreShowAuthor = !this.topbarMoreShowAuthor
        if (entry.id === 'offline') this.topbarMoreOffline = !this.topbarMoreOffline
        this.$emit('topbar-more', { action: entry.action, on: entry.id === 'show-author' ? this.topbarMoreShowAuthor : this.topbarMoreOffline })
        return
      }
      this.runTopbarMoreAction(entry.action, entry)
    },
    async runReferenceMoreAction(id, value, event) {
      if (this.topbarMoreBusy) return false
      const ticket = {}, epoch = this._referenceMoreEpoch
      this._referenceMoreTicket = ticket; this.topbarMoreBusy = true
      const session = this.session, editor = this.editor, handler = this.onDocumentAction,
        principal = session?.user?.id, identity = session?._privateIdentityGeneration, auth = session?._authorizationGeneration,
        business = session?.getProvider?.('documentBusiness'), followedBefore = business?.getState?.()?.followed
      const current = () => this._referenceMoreTicket === ticket && epoch === this._referenceMoreEpoch
        && !this._isDestroyed && !this._isBeingDestroyed && session === this.session && editor === this.editor
        && handler === this.onDocumentAction && principal === session?.user?.id && identity === session?._privateIdentityGeneration
        && auth === session?._authorizationGeneration && this.shareCan('canView')
      try {
        const done = await runReferenceDocumentMenuAction(this, id, value, event, current)
        if (current()) {
          if (done) {
            if (id === 'follow') {
              // 关注开关留在菜单里（飞书同款），只刷新开关并给文档级提示。
              this.topbarMoreRevision += 1
              const followed = business?.getState?.()?.followed
              if (typeof followedBefore === 'boolean' && typeof followed === 'boolean' && followedBefore !== followed) {
                this.showDocumentToast(followed ? '已关注，你将会收到该文档的内容更新提醒' : '已取消关注，你将不再收到该文档的内容更新提醒。')
              }
            } else {
              this.closeTopbarMore()
              if (id === 'width' && event?.detail === 0) this._topbarMoreTrigger?.focus({ preventScroll: true })
            }
          } else this.topbarMoreMessage = '操作未完成，请在文档服务中核对。'
        }
        return done
      } catch { if (current()) this.topbarMoreMessage = '操作未完成，请在文档服务中核对。'; return false }
      finally { if (this._referenceMoreTicket === ticket) { this._referenceMoreTicket = null; this.topbarMoreBusy = false } }
    },
    /**
     * action 分发。
     *
     * 只有 `真正接了线` 的能力在这里落地；其余一律 `topbar-more` 事件抛给宿主
     * （§4.2 ④-2 复刻口径：无数据时允许静默失败 —— 抛事件而不是弹一个空对话框）。
     * 这样「哪些是编辑器内核真的做了的」在这一个 switch 里可以一眼数清。
     */
    runTopbarMoreAction(action, payload) {
      switch (action) {
        case 'slides':
          this.closeTopbarMore()
          this.toggleSlides()
          return
        case 'find':
          this.closeTopbarMore()
          this.openSearch('find')
          return
        case 'width.standard':
        case 'width.wide':
        case 'width.full':
          this.setWidthMode(action.slice('width.'.length))
          this.closeTopbarMore()
          return
        case 'export.word':
        case 'export.pdf':
        case 'export.markdown':
          this.closeTopbarMore()
          this.openExportDialog(action.slice('export.'.length))
          return
        case 'duplicate':
          if (this.shareCan && !this.shareCan('canCopy')) return
          this.closeTopbarMore()
          this.$emit('duplicate-document', {
            title: this.localTitle || this.title || '未命名文档',
            document: this.editor && typeof this.editor.getJSON === 'function' ? this.editor.getJSON() : null,
          })
          return
        case 'history-comments':
          if (this.commentCanViewHistory?.() !== true) return false
          this.closeTopbarMore()
          this.openCommentHistory()
          return
        case 'version.open':
          this.closeTopbarMore()
          this.openVersionPanel()
          return
        case 'save-version':
          this.closeTopbarMore()
          this.openSaveVersion(this._topbarMoreTrigger)
          return
        // 文档小组件的子面板项：值即小组件 id（含 discover / manage 两个入口）。
        case 'widgets':
          this.closeTopbarMore()
          this.runDocumentWidget(payload && payload.value)
          return
        case 'permission.manage':
          this.closeTopbarMore()
          if (typeof this.toggleSharePopover === 'function') this.toggleSharePopover(null)
          return
        case 'permission.settings':
          this.closeTopbarMore()
          this.openPermissionDialog()
          return
        case 'print':
          this.closeTopbarMore()
          this.printDocument()
          return
        case 'history':
          if (this.larkDocConfig?.features?.versionHistory && this.versionProvider && this.shareCan('canView')) {
            this.closeTopbarMore()
            return this.openVersionPanel()
          }
          // Falls through to the host-owned action when no local history is configured.
        default:
          // 未接线的能力：抛给宿主；宿主没监听就是静默失败（飞书在无权限/无数据时同样不弹窗）。
          this.$emit('topbar-more', { action, item: payload || null })
          this.closeTopbarMore()
      }
    },
    /** 打印：浏览器原生能力，不需要外部服务，因此不抛宿主。 */
    printDocument() {
      if (typeof window !== 'undefined' && typeof window.print === 'function') window.print()
    },
    /** 供 overlayDismissMixin 判定「点击是否落在菜单内」。 */
    topbarMoreContains(node) {
      return Boolean(node && node.closest && node.closest('.lark-doc-topbar-more, .lark-doc-more-btn'))
    },
  },
}
