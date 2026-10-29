/**
 * 顶栏「更多」菜单（P6b 顶栏四浮层之一）。
 *
 * 规格真源：requirements/04 §4.2.1（当前租户 **23 项**，最新真源）+ §4.2（历史 22 项快照
 * 的像素规格：z 1030、项 167×32、子菜单项 173×34、分隔线 173×1、子面板 z 1050）。
 *
 * 三条必须守住的红线：
 *
 *   1. **一级菜单是 23 项，不是 22 项**。§4.2.1 白纸黑字：`查看已存版本` 是独立一级项，
 *      位于 `另存为版本` 之后、`文档权限` 之前，带右侧箭头。历史上把 22 项当真源会漏掉
 *      这一项；把「更多」子菜单里的 5 项（上传日志/联系客服/功能更新/帮助中心/快捷键）
 *      计进来又会多出 5 项 —— 那 5 项来自**另一个离屏预挂载菜单**（采集快照坐标
 *      -8560,-9123），§4.2 明确「不要写进『更多』子菜单」。
 *   2. **4 个 submenu 里只有 3 个真的有子面板**（下载为 / 文档权限 / 更多）。
 *      `翻译为英语` 的类名是 `ud__menu-normal-submenu` 但 **hover 与 click 都不展开**，
 *      它是**立即执行的命令**（点击进入翻译模式）——飞书自身的类名复用，不是我们漏读。
 *      所以它的 `kind` 记成 `route`（有箭头、无面板、点击即执行），不能当成 submenu。
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

/** 一级菜单 23 项。顺序与 §4.2.1 逐字一致；`order` 从 1 起。 */
export const TOPBAR_MORE_ITEMS = Object.freeze([
  { id: 'width', label: '页宽设置', order: 1, kind: 'submenu', enabled: true, affordance: 'arrow', action: 'width' },
  { id: 'slides', label: '演示模式', order: 2, kind: 'item', enabled: true, affordance: 'none', action: 'slides' },
  { id: 'follow', label: '关注文档更新', order: 3, kind: 'item', enabled: true, affordance: 'none', action: 'follow' },
  { id: 'find', label: '查找和替换', order: 4, kind: 'item', enabled: true, affordance: 'none', action: 'find' },
  { id: 'shortcut', label: '添加快捷方式到', order: 5, kind: 'item', enabled: true, affordance: 'none', action: 'shortcut' },
  { id: 'move', label: '移动到', order: 6, kind: 'item', enabled: true, affordance: 'none', action: 'move' },
  { id: 'pin', label: '添加到“置顶”', order: 7, kind: 'item', enabled: true, affordance: 'none', action: 'pin' },
  { id: 'favorite', label: '添加到收藏', order: 8, kind: 'item', enabled: true, affordance: 'none', action: 'favorite' },
  { id: 'template', label: '转换为模板', order: 9, kind: 'item', enabled: true, affordance: 'none', action: 'template' },
  { id: 'duplicate', label: '创建副本', order: 10, kind: 'item', enabled: true, affordance: 'none', action: 'duplicate' },
  { id: 'download-as', label: '下载为', order: 11, kind: 'submenu', enabled: true, affordance: 'arrow', action: 'download-as' },
  // §4.2 ④-3：类名是 submenu，但实测无子面板，点击直接进翻译模式 ⇒ kind 记 route。
  { id: 'translate', label: '翻译为英语', order: 12, kind: 'route', enabled: true, affordance: 'arrow', action: 'translate' },
  { id: 'print', label: '打印', order: 13, kind: 'item', enabled: true, affordance: 'none', action: 'print' },
  { id: 'save-version', label: '另存为版本', order: 14, kind: 'item', enabled: true, affordance: 'none', action: 'save-version' },
  { id: 'view-versions', label: '查看已存版本', order: 15, kind: 'submenu', enabled: true, affordance: 'arrow', action: 'view-versions' },
  { id: 'doc-permission', label: '文档权限', order: 16, kind: 'submenu', enabled: true, affordance: 'arrow', action: 'doc-permission' },
  { id: 'widgets', label: '文档小组件', order: 17, kind: 'item', enabled: true, affordance: 'none', action: 'widgets' },
  { id: 'doc-info', label: '文档信息', order: 18, kind: 'item', enabled: true, affordance: 'none', action: 'doc-info' },
  { id: 'mentioned', label: '提及的人', order: 19, kind: 'item', enabled: true, affordance: 'none', action: 'mentioned' },
  { id: 'history', label: '历史记录', order: 20, kind: 'item', enabled: true, affordance: 'none', action: 'history' },
  { id: 'history-comments', label: '历史评论', order: 21, kind: 'item', enabled: true, affordance: 'none', action: 'history-comments' },
  { id: 'more', label: '更多', order: 22, kind: 'submenu', enabled: true, affordance: 'arrow', action: 'more' },
  { id: 'delete', label: '删除', order: 23, kind: 'item', enabled: true, affordance: 'none', action: 'delete' },
])

/**
 * 分隔线：标记「哪一项之后画线」。
 *
 * 依据 §4.2 ④-2 的 9 条分隔线 y 序列（127/202/345/488/529/570/611/651/794）反推出的
 * 10 个分组，再把 §4.2.1 新增的 `查看已存版本` 并入「版本」组：
 *
 *   ① 视图（页宽设置/演示模式）② 关注（关注文档更新/查找和替换）
 *   ③ 快捷方式（添加快捷方式到/移动到/添加到「置顶」/添加到收藏）
 *   ④ 模板与副本（转换为模板/创建副本）⑤ 导出（下载为/翻译为英语）
 *   ⑥ 打印 ⑦ 版本（另存为版本/查看已存版本）⑧ 权限与小组件（文档权限/文档小组件）
 *   ⑨ 信息（文档信息/提及的人/历史记录/历史评论）⑩ 危险区（更多/删除）
 *
 * 22 项时代版本组只有「另存为版本」一项，所以它前后各有一条线（570 / 611）；
 * 23 项时代版本组多了一项，两条线里靠前的那条顺移到组尾 ⇒ **变成 8 条**。
 * 这不是随手改的，是「组间只有一条线」这个不变量决定的。
 */
export const TOPBAR_MORE_DIVIDER_AFTER = Object.freeze([
  'slides', 'find', 'favorite', 'translate', 'print', 'view-versions', 'widgets', 'history-comments',
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
    { id: 'manage-collaborator', label: '管理协作者', action: 'permission.manage' },
    { id: 'permission-settings', label: '权限设置', action: 'permission.settings' },
    { id: 'divider', label: '', kind: 'divider' },
    { id: 'transfer-owner', label: '转移所有权', action: 'permission.transfer' },
  ]),
  more: Object.freeze([
    { id: 'add-app', label: '添加文档应用', action: 'more.add-app' },
    { id: 'show-author', label: '在段落前显示作者', kind: 'switch', action: 'more.show-author' },
    { id: 'offline', label: '设为离线可使用', kind: 'switch', action: 'more.offline' },
    { id: 'report', label: '举报', action: 'more.report' },
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
  'delete', 'save-version', 'duplicate', 'template', 'translate', 'move', 'pin', 'favorite', 'shortcut', 'follow',
])

/** 需要读 capability 才能决定启用态的项：不在表里的项恒启用。 */
export const TOPBAR_MORE_CAPABILITY = Object.freeze({
  'download-as': 'canExport',
  'save-version': 'canCreateVersion',
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
    }
  },
  computed: {
    /** 23 项（含运行时启用态），模板唯一数据源。 */
    topbarMoreItems() {
      const capability = TOPBAR_MORE_CAPABILITY
      return TOPBAR_MORE_ITEMS.map((item) => {
        const key = capability[item.id]
        let enabled = item.enabled
        if (key && typeof this.shareCan === 'function' && !this.shareCan(key)) enabled = false
        // 阅读态（只读）下写操作一律置灰：删除/另存为版本/创建副本/转换为模板/翻译。
        if (enabled && this.effectiveReadonly && TOPBAR_MORE_READONLY_DISABLED.indexOf(item.id) >= 0) enabled = false
        return { ...item, enabled }
      })
    },
    /** 渲染行（含分隔线）。 */
    topbarMoreRows() {
      return topbarMoreRows(this.topbarMoreItems)
    },
    /** 当前子面板项列表；无子面板时为 []。 */
    topbarMoreSubmenuItems() {
      if (!this.topbarMoreSubmenu) return []
      return TOPBAR_MORE_SUBPANELS[this.topbarMoreSubmenu] || []
    },
  },
  methods: {
    /** 顶栏「更多」按钮点击：同一按钮二次点击收起（与分享 popover 同口径）。 */
    toggleTopbarMore(event) {
      if (this.topbarMoreOpen) {
        this.closeTopbarMore()
        return
      }
      const rect = event && event.currentTarget && event.currentTarget.getBoundingClientRect
        ? event.currentTarget.getBoundingClientRect()
        : null
      if (!rect) return
      this.topbarMoreAnchor = rect
      this.topbarMoreOpen = true
      this.topbarMoreSubmenu = ''
      this.$nextTick(this.measureTopbarMore)
    },
    closeTopbarMore() {
      this.topbarMoreOpen = false
      this.topbarMoreSubmenu = ''
    },
    /** 打开后按实测尺寸定位（宽度自适应 ⇒ 必须先渲染再量）。 */
    measureTopbarMore() {
      const menu = this.$refs && this.$refs.topbarMoreMenu
      if (!menu) return
      const rect = menu.getBoundingClientRect()
      this.topbarMoreStyle = topbarMoreMenuStyle(this.topbarMoreAnchor, rect, {
        width: window.innerWidth,
        height: window.innerHeight,
      })
    },
    /** 一级项：submenu 展开子面板，其余立即执行。 */
    onTopbarMoreItem(item) {
      if (!item || item.enabled === false) return
      if (item.kind === 'submenu') {
        this.topbarMoreSubmenu = this.topbarMoreSubmenu === item.id ? '' : item.id
        this.$nextTick(this.measureTopbarMoreSubmenu)
        return
      }
      this.runTopbarMoreAction(item.action, item)
    },
    /** hover 一级项时切换子面板（§4.2 ④-3：hover ≥2000ms 才展开，这里简化为即展）。 */
    hoverTopbarMoreItem(item) {
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
    onTopbarMoreSubmenuItem(entry) {
      if (!entry) return
      if (entry.kind === 'switch') {
        if (entry.id === 'show-author') this.topbarMoreShowAuthor = !this.topbarMoreShowAuthor
        if (entry.id === 'offline') this.topbarMoreOffline = !this.topbarMoreOffline
        this.$emit('topbar-more', { action: entry.action, on: entry.id === 'show-author' ? this.topbarMoreShowAuthor : this.topbarMoreOffline })
        return
      }
      this.runTopbarMoreAction(entry.action, entry)
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
        case 'save-version':
          this.closeTopbarMore()
          this.openSaveVersionDialog()
          return
        case 'version.open':
          this.closeTopbarMore()
          this.openVersionPanel()
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
