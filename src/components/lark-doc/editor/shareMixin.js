/**
 * 分享与权限（P6b-03）—— 分享 popover 开关、二级权限 Dialog 链、权限项读写、
 * 加密链接（密码）状态机、复制链接。
 *
 * 规格：requirements/04 §4.1（分享 popover · batch60/61）、§4.1.1（权限设置 Dialog ·
 * batch441–443 + 加密链接 batch468–479）、requirements/05 §5.3.1「capability → UI
 * 映射表 B24」（唯一真源）、requirements/00-README 行 ~119（分享是 popover 非 Dialog）。
 *
 * 两层结构落在两个模块里：纯逻辑（几何常量、B24 capability 映射、密码规则、剪贴板文本）
 * 在 `shareModel.js`，零 DOM、零 Vue，供单测在 node 环境直接断言（vite 门禁禁止单测
 * import .vue，见 vitest.config.js 的 forbidVueImports）；本文件只剩 mixin，负责把这套
 * 逻辑接到 data / computed / methods 上，方法体按「链接与选区 / 弹窗与密码」两域展开。
 * 下面 38 个具名导出全部从 `shareModel.js` 重新导出，对外签名一字未变。
 *
 * 八条负结论（别实现，改之前先回来读）：
 *   1. **没有「链接有效期」，也没有「水印」**。04 §4.1.1 ⑤-11：在「已勾选加密链接、
 *      密码区已展开」的状态下全文本扫 `/有效期|到期|失效|水印/` **0 命中** —— 不是没采
 *      到，是 UI 上不存在。谁再往密码区底下加「有效期至 ___」就是在造需求。
 *   2. **没有「申请权限」闭环、没有「权限变更后已开页面即时降级」**。04 §4.1.1 ⑥ 明写
 *      「诚实未采」，门槛是双账号（本环境单人）。本库只在只读遮罩上留「申请权限」按钮，
 *      点击走宿主的 `onRequestAccess` 回调，不自建审批流。
 *   3. **修改密码的「保存」按钮永不置灰**。⑤-9 九档输入（空 / 1 位 / 7 位 / 8 位 /
 *      混合 / 18 位 / 19 位 / 25 位 / 纯符号）实测 `disabled:false`、`opacity:1`、
 *      bg 恒 `rgb(20,86,240)`。非法密码是**提交时静默拦截**（toast 告知），不是前置禁用。
 *   4. **校验失败不做 shake / animation**。⑤-9 实测规则框「无 animation」，弹窗不关、
 *      密码值不变，只出 toast。加抖动动画是凭空造反馈。
 *   5. **字符类不是「大写+小写算两种」**。⑤-8 决定性：判定是「数字 / 字母 / 英文符号」
 *      **三分**、大小写**合并**为一类，至少命中 2 类才 success。`AbCdEfGh`、`12345678`、
 *      `!!!!!!!!` 三条实测全是 `normal`。
 *   6. **失败 toast 是橙色 warning 不是红色 error**：`rgb(255,243,229)`（成功/复制那
 *      条是绿 `rgb(228,250,225)`）。别两套都做成红或都做成绿。
 *   7. **别用合成事件驱动这两个入口**。04 §4.1.1 ① 实测 DOM `el.click()` 对「分享」
 *      与「权限设置」一律 `hit=no`（batch440 逐个 `elementFromPoint().click()` 全灭），
 *      必须 trusted 事件。自动化联调同理，别在测试里 `dispatchEvent(new MouseEvent)`。
 *   8. **`canManagePermission` 是 B24 里唯一的「降级」项，不是置灰项**。它 false 时顶栏
 *      入口变成「分享只读链接」：仍可点、只复制链接、**不弹任何权限面板**。
 *      其余 7 项除 `canView`（整页替换）外一律「挂载 + 置灰」，不隐藏。
 *
 * 待定（本线自定、requirements 没拍板的四处，改动前先回来确认）：
 *   A. `LINK_SHARE_ENTITY.normal = 1`：⑤-1 只采到「加密 = 4」，关闭时回落的值没采到。
 *   B. `PERMISSION_SCOPE_OPTIONS` 里除「可阅读的用户」外的两项：04 未展开下拉采选项全集。
 *   C. 「不支持字符」是否含空格 / 控制字符：⑤-8 只有中文样本，这里按「密码不含空白」取严。
 *   D. 「提示」弹窗第 1 句正文在采集日志里被截断（⑤-2 原文带「…」），末尾句号是补的。
 *
 * 为什么权限判断统一走 `readCapability()` 而不是散着读 `session.capabilities`：
 *   Session 的 `can(k)` 语义是 `capabilities[k] !== false`（05 §5.3）——**缺省即允许**。
 *   散着读会退化成 `!!capabilities[k]`，把「provider 还没刷新回来 / 字段未下发」误判成
 *   无权限，浮层会在首屏闪一次置灰。另外 session 为空（宿主没传）时必须按「全允许」走，
 *   否则裸用编辑器会整页变只读遮罩。
 */
export { SECURE_CONFIRM_MESSAGES, SECURE_LINK_TIP, cloneShareExcerpt } from './shareContent'
import { safeUrl } from '../../../core/documentOperations'
import { PERMISSION_SCOPE_OPTIONS, LINK_PERM_OPTIONS, PERMISSION_ITEMS, PERMISSION_ADVANCED_ITEMS, shareEntryMode, shareEntryLabel, passwordRules, shareNetworkKey, INVITE_SCOPES, emptyInvitation, unresolvedInvitation } from './shareModel'
export {
  SHARE_POPOVER,
  SHARE_ENTRY_BUTTON,
  SHARE_FILLED_BUTTON,
  SHARE_OUTLINED_BUTTON,
  PERMISSION_DIALOG,
  SECURE_CONFIRM_DIALOG,
  PASSWORD_DIALOG,
  CAPABILITY_TREATMENTS,
  CAPABILITY_UI,
  GRAY_STYLE,
  SHARE_ENTRY_MODES,
  PERMISSION_SCOPE_OPTIONS,
  LINK_PERM_OPTIONS,
  PERMISSION_ITEMS,
  PERMISSION_ADVANCED_ITEMS,
  LINK_SHARE_ENTITY,
  PASSWORD_MIN,
  PASSWORD_MAX,
  PASSWORD_RULE_TEXTS,
  PASSWORD_RULE_STATES,
  PASSWORD_RULE_COLORS,
  SHARE_TOAST,
  SHARE_TOAST_TEXTS,
  SHARE_CLIPBOARD_SEPARATOR,
  buildShareLinkText,
  buildLinkScopeText,
  buildShareClipboardText,
  readCapability,
  capabilityTreatment,
  capabilityUiState,
  capabilityUiStates,
  shareEntryMode,
  shareEntryLabel,
  classifyPasswordChars,
  passwordCharClasses,
  passwordRules,
  isPasswordValid,
  randomPassword,
} from './shareModel'
import { createShareInteraction } from './shareInteraction'
import { shareLinkMethods } from './shareLinkMethods'
import { shareDialogMethods } from './shareDialogMethods'

const shareInteraction = createShareInteraction({ INVITE_SCOPES, emptyInvitation, unresolvedInvitation, safeUrl })

export default {
  data() {
    return {
      sharePopoverOpen: false,
      imageShare: null,
      /** popover 落点：`{ top, right }`，由触发按钮的 rect 反推（见 `toggleSharePopover`）。 */
      sharePopoverPos: { top: 0, right: 0 },
      sharePopoverAnchor: null,
      permissionDialogOpen: false,
      /** 「更多高级设置」折叠头。 */
      permissionAdvancedOpen: false,
      /** 加密链接状态机：`secureLinkEnabled` + `secureLinkPassword` 同进同退。 */
      secureLinkEnabled: false,
      secureLinkPassword: '',
      /** 「提示」二次确认（只在**开启**加密链接时弹；关闭是直接回落）。 */
      secureLinkConfirmOpen: false,
      /** 修改密码弹窗。 */
      passwordDialogOpen: false,
      passwordDraft: '',
      /** 权限项取值（④ 文案口径，默认值取实测的「可阅读的用户」）。 */
      permissionValues: {
        shareOutsideOrg: false,
        collaborators: '可阅读的用户',
        copy: '可阅读的用户',
        duplicate: '可阅读的用户',
        comment: '可阅读的用户',
        ownerLeaderAutoPass: false,
        ownerLeaderSearchable: false,
        visitorAvatar: '可阅读的用户',
        requestAccess: '仅协作者',
      },
      /** 当前 toast：`{ kind: 'success' | 'warning', text }`。 */
      shareToast: null,
      /** 组织名（④-2 实测「北京八人科技有限公司」）。宿主接了组织服务可覆盖。 */
      shareOrgName: '链接范围未配置',
      /** 邀请输入框（一级 popover 与二级 Dialog 各有一个，取值分开存）。 */
      shareInviteQuery: '',
      shareMembers: { status: 'idle', items: [], authzVersion: '' },
      shareDirectory: { status: 'idle', items: [], error: '' },
      shareInvitation: emptyInvitation(),
      /** 一级 popover 卡上的链接权限：§4.1 ③ 实测下拉取值为「可编辑」。 */
      shareLinkPerm: '可编辑',
      /** 二级 Dialog 里「链接分享」scope 文案的权限：§4.1.1 ③ 实测是「可阅读」。
       *  🔴 两处**不是同一个状态**（Dialog 里没有下拉可改），别合并成 `shareLinkPerm`。 */
      shareDialogLinkPerm: '可阅读',
      /** 已有协作者。04 §4.1 ④ 只采到「+2 头像聚合」，真实成员列表属宿主数据。 */
      shareCollaborators: ['我'],
      /** 文档链接。宿主可通过 prop/赋值覆盖；缺省取当前地址。 */
      shareLink: '',
      shareLinkState: null,
      shareLinkBusy: false,
      shareLinkPending: '',
      shareLinkError: '',
      _shareToastTimer: null,
    }
  },
  computed: {
    selectionShareEntryAvailable() { return this.selectionShareAllowed() },
    /** 入口显隐：只有 `canView:false` 才不挂（B24 交叉约束 3）；其余一律挂载。 */
    shareEntryVisible() {
      return this.shareCan('canView')
    },
    /** `canView:false` 的整页只读遮罩。这是 8 项里唯一「替换整页」的一项。 */
    shareViewMaskVisible() {
      return !this.shareCan('canView')
    },
    /** 入口形态：`manage`（完整分享）/ `readonly-link`（只复制链接）。 */
    shareEntryMode() {
      return shareEntryMode(this.session)
    },
    /** 入口文案：降级时按钮文字本身变成「分享只读链接」。 */
    shareEntryLabel() {
      return shareEntryLabel(this.session)
    },
    /** 渲染用的权限项（④ 全集，文案不改写）。 */
    sharePermissionItems() {
      return PERMISSION_ITEMS
    },
    sharePermissionAdvancedItems() {
      return PERMISSION_ADVANCED_ITEMS
    },
    sharePermissionOptions() {
      return PERMISSION_SCOPE_OPTIONS
    },
    /** 一级 popover 链接权限下拉的候选项。 */
    shareLinkPermOptions() {
      return LINK_PERM_OPTIONS
    },
    /** 卡片上的权限标签与 scope 文案同源：改下拉两处一起变（04 §4.1 ③）。 */
    shareLinkPermLabel() {
      return this.shareLinkState ? this.shareLinkPerm : '未配置'
    },
    shareLinkAvailable() {
      const provider = this.session?.getProvider?.('authorization')
      return provider?.isRemote === true && typeof provider.shareLink === 'function' && this.shareCan('canView') && this.shareCan('canManagePermission')
    },
    shareLinkWritable() {
      return this.shareLinkAvailable && !!this.shareLinkState && this._shareLinkSnapshotOwner?.() === true && !this.shareLinkBusy && !this.shareLinkPending
    },
    /** 一级 popover 的 scope 文案。 */
    shareScopeText() {
      return this.shareLinkState ? `${this.shareLinkState.audience === 'public' ? '互联网用户' : '仅协作者'}${this.shareLinkState.permission === 'edit' ? '可编辑' : '可阅读'}` : '链接范围与权限服务尚未配置'
    },
    /** 二级 Dialog 里的 scope 文案（取值与一级不同，见 data 注释）。 */
    shareDialogScopeText() {
      return this.shareScopeText
    },
    /** 头像里显示的字（取首个协作者的首个字符）。04 只采到「+2 聚合」，
     *  真实头像图属宿主数据，这里退化成文字头像，免得留一个空白圆。 */
    shareCollaboratorInitial() {
      const first = this.shareCollaborators && this.shareCollaborators.length ? this.shareCollaborators[0] : ''
      return String(first || '').charAt(0)
    },
    /** 规则框行：长度 / 字符类 /（不支持字符）。 */
    sharePasswordRules() {
      return passwordRules(this.passwordDraft)
    },
    /** 服务和管理权限有效时保持提交校验；未知写入期间不能再保存。 */
    sharePasswordSaveDisabled() {
      return !this.shareLinkWritable || !this.shareLinkState?.cryptoReady
    },
    /** 加密链接块的高度态：未开启 22，开启 78（⑤-1 步 4 / ⑤-3）。 */
    shareSecureLinkHeight() {
      return this.secureLinkEnabled ? 78 : 22
    },
  },
  watch: {
    session(value, previous) { if (value !== previous) { this.closeImageShareDialog(); this.resetShareLink(); this.bindShareReads() } },
    'session.user.id'() { this.closeImageShareDialog(); this.resetShareLink(); this.closePermissionDialog(); this.closeSharePopover() },
    onImageShare() { if (this.imageShare?.target !== 'selection') this.closeImageShareDialog() },
    onSelectionShare() { if (this.imageShare?.target === 'selection') this.closeImageShareDialog() },
    mentionSource() { if (this.imageShare?.target === 'selection') this.closeImageShareDialog() },
    shareLink() { if (this.imageShare?.target === 'selection') this.closeImageShareDialog() },
    larkDocConfig: { deep: true, handler() {
      if (this._selectionShareTarget && shareNetworkKey(this) !== this._selectionShareTarget.network) this.closeImageShareDialog()
    } },
  },
  mounted() {
    this.bindShareReads()
    // 两个浮层的关闭入口与 `overlayDismissMixin` 同源（点外部 / Esc），但那边的互斥链
    // 在本仓由主组件维护、本线不改它，所以这里自建一对监听，避免「新增浮层漏接关闭」。
    document.addEventListener('pointerdown', this.onSharePointerDown, true)
    window.addEventListener('keydown', this.onShareWindowKeydown)
    window.addEventListener('resize', this.onShareViewportResize)
  },
  beforeDestroy() {
    this._shareReadsDisposed = true
    this.resetShareLink()
    this._shareReadsOff?.()
    this.clearShareReads()
    this._selectionShareDisposed = true
    this.closeImageShareDialog()
    document.removeEventListener('pointerdown', this.onSharePointerDown, true)
    window.removeEventListener('keydown', this.onShareWindowKeydown)
    window.removeEventListener('resize', this.onShareViewportResize)
    this.hideShareToast()
  },
  methods: {
    ...shareInteraction.methods,
    ...shareLinkMethods,
    ...shareDialogMethods,
  },
}

