/**
 * 分享与权限（P6b-03）—— 分享 popover 开关、二级权限 Dialog 链、权限项读写、
 * 加密链接（密码）状态机、复制链接。
 *
 * 规格：requirements/04 §4.1（分享 popover · batch60/61）、§4.1.1（权限设置 Dialog ·
 * batch441–443 + 加密链接 batch468–479）、requirements/05 §5.3.1「capability → UI
 * 映射表 B24」（唯一真源）、requirements/00-README 行 ~119（分享是 popover 非 Dialog）。
 *
 * 本文件刻意做成「纯逻辑 + Vue 2 options mixin」两层：上面的具名导出零 DOM、零 Vue，
 * 供 `test/unit/share-ui.test.js` 在 node 环境下直接断言（vite 门禁禁止单测 import
 * .vue，见 vitest.config.js 的 forbidVueImports）。下层的 mixin 只负责把这套逻辑
 * 接到组件的 data / computed / methods 上。
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
import { DEFAULT_CAPABILITIES } from '../../../providers/authorization'
import { searchMentionDirectory } from '../../../core/mention/directory'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import { CellSelection } from '@tiptap/pm/tables'
import { BLOCK_ID_PATTERN, safeUrl } from '../../../core/documentOperations'
import { createNetworkPolicy } from '../../../core/policy/network'
import { cloneShareExcerpt } from './shareContent'
import { createShareInteraction } from './shareInteraction'
export { SECURE_CONFIRM_MESSAGES, SECURE_LINK_TIP, cloneShareExcerpt } from './shareContent'

// —— 几何：分享 popover（04 §4.1 ④-2 实测 batch60/61）——

/** popover 外壳：480×331，**z 99，无遮罩**（00-README 行 ~119：分享不是 Dialog）。 */
export const SHARE_POPOVER = Object.freeze({
  width: 480,
  height: 331,
  zIndex: 99,
  padding: '2px 0 0',
  /** 内层容器 480×329（外壳 331 减去顶部 2px padding）。 */
  innerHeight: 329,
  /** 标题栏 480×45，pad `13px 16px 8px`。 */
  headerHeight: 45,
  /** 标题文字 fs16 / `#1F2329`。色值写成 token 引用而不是字面 hex：真值在
   *  `styles/share.css` 的 `--ld-share-*` 声明处，JS 侧写字面色会被 `check-theme-tokens` 拦。 */
  titleFontSize: 16,
  titleColor: 'var(--ld-share-text)',
  /** 「权限设置」按钮 84×24，图标 20×16。实测 ③ 里同一按钮是 80×24 —— 两批次量到的
   *  含/不含图标右内边距不同，这里取 ④-2 的 84×24（一级 popover 的口径）。 */
  permButtonWidth: 84,
  permButtonHeight: 24,
  /** 协作者行 480×54。 */
  memberRowHeight: 54,
  /** 邀请输入框外壳 448×36（聚焦态主色描边，不是 input 自身描边）。 */
  inviteWidth: 448,
  inviteHeight: 36,
  /** 下半区 480×194。45 + 54 + 36 + 194 = 329，与内层容器高自洽。 */
  lowerHeight: 194,
  /** 链接分享卡 480×116，pad 16。 */
  linkCardHeight: 116,
})

/** 顶栏触发按钮：容器 100×32、本体 **80×32 / `#1456F0` / radius 6 / pad `4px 11px`**。 */
export const SHARE_ENTRY_BUTTON = Object.freeze({
  containerWidth: 100,
  containerHeight: 32,
  width: 80,
  height: 32,
  background: 'var(--ld-share-brand)',
  radius: 6,
  padding: '4px 11px',
})

/** 飞书实心主按钮通用规格（04 §4.1 ④-2 复刻要点 2），两个 Dialog 的底部按钮都用它。 */
export const SHARE_FILLED_BUTTON = Object.freeze({ width: 80, height: 32, radius: 6, background: 'var(--ld-share-brand)', color: 'var(--ld-share-surface)' })

/** 描边次按钮：bg `#FFF` / bd `1px solid #D0D3D6` / radius 6。 */
export const SHARE_OUTLINED_BUTTON = Object.freeze({ width: 80, height: 32, radius: 6, border: '1px solid var(--ld-share-border-control)', color: 'var(--ld-share-text)' })

// —— 几何：权限设置 Dialog（04 §4.1.1 ②）——

export const PERMISSION_DIALOG = Object.freeze({
  /** 遮罩 `rgba(0,0,0,0.55)` / z 1000 / fixed。 */
  maskBackground: 'rgba(0, 0, 0, 0.55)',
  maskZIndex: 1000,
  width: 500,
  height: 830,
  /** 垂直居中偏上：950 视口里顶边 60、底边 890。 */
  top: 60,
  radius: 8,
  background: 'var(--ld-share-surface)',
  headerHeight: 72,
  bodyHeight: 734,
  /** 内容列 x=530 → 左内边距 24，列宽 437。 */
  paddingX: 24,
  contentWidth: 437,
  /** 权限 Dialog **没有 footer**（② 末行实测 null）：改完即关，无「保存」。 */
  hasFooter: false,
})

/** 「提示」二次确认弹窗：500×262 @(506,344)。 */
export const SECURE_CONFIRM_DIALOG = Object.freeze({ width: 500, height: 262, top: 344, bodyHeight: 110, footerHeight: 56 })

/** 修改密码弹窗：420×312 @(546,319)。 */
export const PASSWORD_DIALOG = Object.freeze({ width: 420, height: 312, top: 319, headerHeight: 72, bodyHeight: 160, contentWidth: 372 })

// —— capability → UI（05 §5.3.1 B24 唯一真源）——

/**
 * 四种处置：
 *   - `replace`  整页替换为只读遮罩，**唯一允许不挂载**的一项（B24 交叉约束 3）；
 *   - `gray`     挂载 + 置灰，点击直接 return，但不隐藏；
 *   - `downgrade`降级为「分享只读链接」，仍可点；
 *   - `allow`    正常。
 */
export const CAPABILITY_TREATMENTS = Object.freeze({ allow: 'allow', gray: 'gray', downgrade: 'downgrade', replace: 'replace' })

/** 8 项 capability 在「无权限」时的处置。键与 `DEFAULT_CAPABILITIES` 同源。 */
export const CAPABILITY_UI = Object.freeze({
  canView: CAPABILITY_TREATMENTS.replace,
  canEdit: CAPABILITY_TREATMENTS.gray,
  canComment: CAPABILITY_TREATMENTS.gray,
  canResolveComment: CAPABILITY_TREATMENTS.gray,
  canCreateVersion: CAPABILITY_TREATMENTS.gray,
  canRestoreVersion: CAPABILITY_TREATMENTS.gray,
  canExport: CAPABILITY_TREATMENTS.gray,
  canManagePermission: CAPABILITY_TREATMENTS.downgrade,
})

/** 置灰的统一视觉（05 §5.3.1 ③）：色 `#BBBFC4`、`cursor: not-allowed`、
 *  `pointer-events` **保留**（要能 hover 出 tooltip 解释原因），点击无副作用。 */
export const GRAY_STYLE = Object.freeze({ color: 'var(--ld-share-text-disabled)', cursor: 'not-allowed', pointerEvents: 'auto' })

/** 分享入口的两种形态。 */
export const SHARE_ENTRY_MODES = Object.freeze({ manage: 'manage', readonlyLink: 'readonly-link' })

// —— 权限项（04 §4.1.1 ④ 文案口径，可直接照抄）——

/** 下拉选项。🔴 只有「可阅读的用户」是实测值（③ 三处下拉都取它），
 *  另两项是本库自定（04 未采下拉展开后的选项全集），见文件头「待定」。 */
export const PERMISSION_SCOPE_OPTIONS = Object.freeze(['可阅读的用户', '可编辑的用户', '仅协作者'])

/**
 * 一级 popover「链接分享」卡上的链接权限下拉（04 §4.1 ③）。
 * 🔴 只有「可编辑」是实测取值；「可阅读」是按对称补齐的自定项
 * （04 未展开这个下拉，只认证了当前取值与下方 scope 文案）。
 * 注意它和上面的 `PERMISSION_SCOPE_OPTIONS` **不是同一组口径**：后者带「的用户」后缀，
 * 是二级权限 Dialog 里的成员范围；这个是链接本身的读写级别，照抄时别合并成一组。
 */
export const LINK_PERM_OPTIONS = Object.freeze(['可阅读', '可编辑'])

/** 权限项定义。`type`：toggle（开关）/ secure（加密链接，自带二次确认与密码区）/
 *  select（下拉）/ group（分组标题）。文案与 ④ 逐字对齐，不改写。 */
export const PERMISSION_ITEMS = Object.freeze([
  { id: 'invite', type: 'entry', title: '邀请协作者' },
  { id: 'outside', type: 'group', title: '对外分享' },
  {
    id: 'shareOutsideOrg',
    type: 'toggle',
    title: '允许内容被分享到组织外',
    desc: '仅"可管理权限"可以将内容分享到组织外',
  },
  { id: 'secureLink', type: 'secure', title: '启用加密链接' },
  {
    id: 'collaborators',
    type: 'select',
    title: '谁可以查看、添加、移除协作者',
    value: '可阅读的用户',
    desc: '仅组织内的用户可以查看、添加、移除协作者',
  },
  { id: 'copy', type: 'select', title: '谁可以复制内容', value: '可阅读的用户' },
  { id: 'duplicate', type: 'select', title: '谁可以创建副本、打印和下载', value: '可阅读的用户' },
  { id: 'comment', type: 'select', title: '谁可以评论', value: '可阅读的用户' },
])

/** 「更多高级设置」折叠区（④ 末四行 + ③ 滚到底才露出的两行）。 */
export const PERMISSION_ADVANCED_ITEMS = Object.freeze([
  { id: 'publicInfo', type: 'group', title: '企业信息公开设置' },
  { id: 'ownerLeaderAutoPass', type: 'toggle', title: '文档所有者上级', desc: '申请访问时自动通过' },
  { id: 'ownerLeaderSearchable', type: 'toggle', title: '文档所有者上级', desc: '可搜索和访问该文档' },
  { id: 'visitorAvatar', type: 'select', title: '谁可以查看访问者头像和点赞者头像', value: '可阅读的用户' },
  { id: 'requestAccess', type: 'select', title: '谁可以在文档内申请引用文档访问权限', value: '仅协作者', desc: '仅可管理权限的用户可以申请' },
])

/** 加密链接实体枚举。🔴 只有 `secure: 4` 是实测（⑤-1 报文 `link_share_entity: 4`）；
 *  `normal: 1` 是自定占位 —— 原文只说「关掉时回落到普通枚举」但没采到具体值。 */
export const LINK_SHARE_ENTITY = Object.freeze({ normal: 1, secure: 4 })

// —— 加密链接：文案与校验规则（04 §4.1.1 ⑤）——

export const PASSWORD_MIN = 8
export const PASSWORD_MAX = 18

/** 规则框三行文案（⑤-6，顺序固定）。第 3 行仅在出现不支持字符时存在。 */
export const PASSWORD_RULE_TEXTS = Object.freeze({
  length: '长度为 8-18 个字符',
  classes: '包含数字、英文字母或英文符号中的至少两种',
  unsupported: '包含不支持的字符类型',
})

/** 规则三态。`normal` 与 `success` **是同一段 SVG，只换 color**（⑤-7）。 */
export const PASSWORD_RULE_STATES = Object.freeze({ normal: 'normal', success: 'success', error: 'error' })

/** 三态配色（⑤-6）：normal 图标 `#BBBFC4`；success 图标 `#32A645`；error 图标与文字一起 `#F54A45`。 */
export const PASSWORD_RULE_COLORS = Object.freeze({
  normal: { icon: 'var(--ld-share-text-disabled)', text: 'var(--ld-share-text)' },
  success: { icon: 'var(--ld-share-success)', text: 'var(--ld-share-text)' },
  error: { icon: 'var(--ld-share-danger)', text: 'var(--ld-share-danger)' },
})

/** 两型 toast：成功/复制绿 `rgb(228,250,225)`，校验失败橙 `rgb(255,243,229)`（⑤-4 / ⑤-9）。 */
export const SHARE_TOAST = Object.freeze({
  success: { kind: 'success', background: 'var(--ld-share-toast-success-bg)', width: 414, height: 54, top: 40 },
  warning: { kind: 'warning', background: 'var(--ld-share-toast-warning-bg)', width: 260, height: 54, top: 40 },
  /** 约 3s 后自动消失（⑤-9：batch479 再等 3.2s 已查无此节点）。 */
  duration: 3000,
})

export const SHARE_TOAST_TEXTS = Object.freeze({
  copiedLinkAndPassword: '链接和密码已复制，互联网上获得链接和密码的人可阅读',
  copiedLink: '链接已复制',
  invalidPassword: '密码不符合要求，请修改后重试',
})

/**
 * 复制到剪贴板的真值（⑤-4）：链接与「密码：」之间是 **3 个半角空格**
 * （不是 tab、不是换行）—— 照抄是为了用户粘到 IM 里不断行。
 */
export const SHARE_CLIPBOARD_SEPARATOR = '   '

/**
 * 只读链接降级路径的复制内容。🔴 自定：B24 只说「只复制链接」，未采文案，
 * 这里不给前缀（带密码的那条才有「飞书链接：」前缀，见 `buildShareClipboardText`）。
 */
export function buildShareLinkText(link) {
  return String(link == null ? '' : link)
}

/**
 * scope 文案：一级 popover 与二级 Dialog **各有一份且取值不同**（§4.1 ③ vs §4.1.1 ③），
 * 所以做成函数而不是常量 —— 别合并成一个「全局链接权限」。
 */
export function buildLinkScopeText(perm) {
  return `组织内获得链接的人${perm == null ? '' : perm}`
}

/** 带密码的复制文本（⑤-4 真值格式）。 */
export function buildShareClipboardText(link, password) {
  const text = buildShareLinkText(link)
  const pwd = String(password == null ? '' : password)
  if (!pwd) return text
  return `飞书链接：${text}${SHARE_CLIPBOARD_SEPARATOR}密码：${pwd}`
}

// —— capability 读取 ——

/**
 * 读一项能力。session 缺失（宿主没传）或没实现 `can()` 时按「缺省即允许」返回 true。
 * 用 `!== false` 而不是 `=== true`：Session 的语义就是「只有显式 false 才禁用」。
 */
export function readCapability(session, key) {
  if (!session || typeof session.can !== 'function') return true
  return session.can(key) !== false
}

/** 无权限时这项 UI 怎么处置：见 `CAPABILITY_TREATMENTS`。未知 key 按 `allow`。 */
export function capabilityTreatment(key) {
  return CAPABILITY_UI[key] || CAPABILITY_TREATMENTS.allow
}

/**
 * 单条 B24 映射的落值。
 * @returns {{key:string, allowed:boolean, treatment:string, mounted:boolean,
 *            hidden:boolean, gray:boolean, downgraded:boolean, style:object|null}}
 *   `mounted` 为 false 只可能来自 `canView:false`（B24 交叉约束 3：其余 7 项一律挂载）。
 */
export function capabilityUiState(session, key) {
  const allowed = readCapability(session, key)
  const treatment = allowed ? CAPABILITY_TREATMENTS.allow : capabilityTreatment(key)
  const gray = treatment === CAPABILITY_TREATMENTS.gray
  return {
    key,
    allowed,
    treatment,
    // 只有整页替换这一项可以不挂载；置灰与降级都要求「看得见」。
    mounted: treatment !== CAPABILITY_TREATMENTS.replace,
    hidden: false,
    gray,
    downgraded: treatment === CAPABILITY_TREATMENTS.downgrade,
    style: gray ? GRAY_STYLE : null,
  }
}

/** 全部 8 项的落值（键序与 `DEFAULT_CAPABILITIES` 一致），供宿主一次性取用。 */
export function capabilityUiStates(session) {
  const keys = Object.keys(DEFAULT_CAPABILITIES)
  const result = {}
  for (let i = 0; i < keys.length; i += 1) result[keys[i]] = capabilityUiState(session, keys[i])
  return result
}

/** 分享入口形态：`canManagePermission` 为真 → 完整分享；否则降级为「分享只读链接」。 */
export function shareEntryMode(session) {
  return readCapability(session, 'canManagePermission') ? SHARE_ENTRY_MODES.manage : SHARE_ENTRY_MODES.readonlyLink
}

/** 入口文案（B24 末行）：降级时按钮文字本身就变了，不是加一个小字说明。 */
export function shareEntryLabel(session) {
  return shareEntryMode(session) === SHARE_ENTRY_MODES.manage ? '分享' : '分享只读链接'
}

// —— 密码校验（04 §4.1.1 ⑤-6 / ⑤-8）——

/**
 * 字符归类。判定是「数字 / 字母 / 英文符号」**三分**，大小写**合并**为「字母」
 * （⑤-8：`AbCdEfGh` 实测只有一类）。
 *
 * 「不支持字符」= 不在 ASCII 可见区间 33–126 的一切：中文、全角、空格、控制字符。
 * 🔴 自定口径：⑤-8 只实测了中文触发第 3 条，空格与控制字符没有实测样本，
 * 这里按「密码里不该出现空白」取严（见文件头「待定」）。
 */
export function classifyPasswordChars(password) {
  const text = typeof password === 'string' ? password : ''
  const hit = { digit: false, letter: false, symbol: false, unsupported: false }
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i)
    if (code >= 48 && code <= 57) hit.digit = true
    else if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) hit.letter = true
    else if (code >= 33 && code <= 126) hit.symbol = true
    else hit.unsupported = true
  }
  return hit
}

/** 命中的字符类数量（0..3），用于「至少两种」判定。 */
export function passwordCharClasses(password) {
  const hit = classifyPasswordChars(password)
  let count = 0
  if (hit.digit) count += 1
  if (hit.letter) count += 1
  if (hit.symbol) count += 1
  return count
}

/**
 * 规则框的三（或两）行。顺序固定：长度 → 字符类 → （不支持字符）。
 * 第 3 行**只在出现不支持字符时存在**，其余时候整行不渲染（⑤-6）。
 */
export function passwordRules(password) {
  const text = typeof password === 'string' ? password : ''
  const hit = classifyPasswordChars(text)
  const rules = [
    {
      id: 'length',
      text: PASSWORD_RULE_TEXTS.length,
      state: text.length >= PASSWORD_MIN && text.length <= PASSWORD_MAX ? PASSWORD_RULE_STATES.success : PASSWORD_RULE_STATES.normal,
    },
    {
      id: 'classes',
      text: PASSWORD_RULE_TEXTS.classes,
      state: passwordCharClasses(text) >= 2 ? PASSWORD_RULE_STATES.success : PASSWORD_RULE_STATES.normal,
    },
  ]
  // error 行是「后插入的裸行」（比另两条矮 6px），所以它恒在末尾。
  if (hit.unsupported) rules.push({ id: 'unsupported', text: PASSWORD_RULE_TEXTS.unsupported, state: PASSWORD_RULE_STATES.error })
  return rules
}

/** 只有三条全 success 才算通过；error 行存在时必然不通过。 */
export function isPasswordValid(password) {
  const rules = passwordRules(password)
  for (let i = 0; i < rules.length; i += 1) {
    if (rules[i].state !== PASSWORD_RULE_STATES.success) return false
  }
  return true
}

/** 随机密码的字符池：字母 / 数字 / 符号各一池，保证三类各至少取一个。 */
const RANDOM_PASSWORD_POOLS = Object.freeze([
  'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ',
  '23456789',
  '!@#$%^&*',
])

/**
 * 生成一条合规随机密码（默认 8 位，等长、含符号）。
 * 「随机生成」按钮只**填进输入框**，仍需手动点「保存」才提交（⑤-10）。
 * `random` 可注入是为了让测试可复现。
 */
export function randomPassword(random = Math.random) {
  const chars = []
  for (let i = 0; i < RANDOM_PASSWORD_POOLS.length; i += 1) {
    const pool = RANDOM_PASSWORD_POOLS[i]
    chars.push(pool.charAt(Math.floor(random() * pool.length)))
  }
  const all = RANDOM_PASSWORD_POOLS.join('')
  for (let i = chars.length; i < PASSWORD_MIN; i += 1) chars.push(all.charAt(Math.floor(random() * all.length)))
  // Fisher–Yates：先把「三类各一个」打散，否则前缀恒为字母+数字+符号，看着像模板串。
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    const temp = chars[i]
    chars[i] = chars[j]
    chars[j] = temp
  }
  return chars.join('')
}

// —— mixin ——

/** popover / Dialog 的「点外部不算外部」白名单：这些子树里的点击都不收浮层。 */
const SHARE_KEEP_OPEN_SELECTORS = Object.freeze([
  '.lark-doc-share-popover',
  '.lark-doc-share-entry',
  '.lark-doc-permission-layer',
  '.lark-doc-share-toast',
])

function shareExcerpt(editor, node, pos, network) {
  if (!node) return null
  const snapshot = { text: node.textContent, type: node.type.name, level: node.attrs.level || null }
  if (node.type.name === 'webEmbed' || (node.type.name === 'linkEmbed' && node.attrs.view === 'preview')) return { ...snapshot, text: '[内嵌网页]' }
  const source = editor.view.nodeDOM(pos)
  if (!source?.cloneNode || source.nodeType !== 1) return snapshot
  const clone = cloneShareExcerpt(source, network)
  const style = source.ownerDocument.defaultView.getComputedStyle(source)
  Object.assign(clone.style, { margin: '0', fontSize: '14px', fontWeight: style.fontWeight, lineHeight: '22px', textAlign: style.textAlign })
  return { ...snapshot, dom: clone }
}

function selectionShareKind(selection) {
  return selection instanceof CellSelection ? 'cell' : selection instanceof NodeSelection ? 'node' : selection instanceof TextSelection ? 'text' : null
}

function selectionShareBlock(selection) {
  if (selection instanceof NodeSelection) return { node: selection.node, pos: selection.from }
  const $from = selection instanceof CellSelection ? selection.$anchorCell : selection.$from
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth)
    if (selection instanceof CellSelection ? node.type.name === 'table' : BLOCK_ID_PATTERN.test(node.attrs.blockId || '')) return { node, pos: $from.before(depth) }
  }
  return null
}

const shareNetworkKey = host => JSON.stringify(host.larkDocConfig?.network || {})
const INVITE_SCOPES = Object.freeze({
  read: ['document.read', 'version.read'],
  edit: ['document.read', 'document.write', 'comment.write', 'comment.resolve', 'version.read', 'version.create', 'document.export'],
  manage: ['document.read', 'document.write', 'comment.write', 'comment.resolve', 'version.read', 'version.create', 'version.restore', 'document.export', 'grant.manage'],
})
const emptyInvitation = () => ({ status: 'idle', candidate: null, role: 'read', operationId: '', error: '' })
const unresolvedInvitation = value => ['sending', 'querying', 'unknown', 'blocked'].includes(value?.status) || value?.status === 'committed' && !value.verified

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
    remoteShareScope() {
      const session = this.session, provider = session?.getProvider?.('authorization'), user = session?.user
      const actor = user?.id, documentId = session?.documentId, identity = session?._privateIdentityGeneration
      const identityGeneration = session?._identityGeneration, authorization = session?._authorizationGeneration
      const generation = this._shareLinkGeneration
      const owner = () => !this._shareReadsDisposed && !this._isDestroyed && !this._isBeingDestroyed && !session?._destroyed &&
        session === this.session && provider === session?.getProvider?.('authorization') && user === session?.user && actor === session?.user?.id &&
        documentId === session?.documentId && identity === session?._privateIdentityGeneration && identityGeneration === session?._identityGeneration &&
        authorization === session?._authorizationGeneration && generation === this._shareLinkGeneration
      return { provider, session, owner, current: () => owner() && provider?.isRemote === true && typeof provider.shareLink === 'function' &&
        (this.sharePopoverOpen || this.permissionDialogOpen) && this.shareCan('canView') && this.shareCan('canManagePermission') }
    },
    resetShareLink() {
      this._shareLinkGeneration = (this._shareLinkGeneration || 0) + 1
      this._shareLinkToken = null
      this._shareLinkSnapshotOwner = null
      this.shareLinkState = null; this.shareLinkBusy = false; this.shareLinkPending = ''; this.shareLinkError = ''
      this.secureLinkEnabled = false; this.secureLinkPassword = ''; this.passwordDraft = ''
      this.secureLinkConfirmOpen = false; this.passwordDialogOpen = false
    },
    async shareLinkAction(action, input) {
      const scope = this.remoteShareScope()
      if (!scope.current()) {
        if (scope.owner() && (this.sharePopoverOpen || this.permissionDialogOpen)) {
          this.shareLinkError = '链接权限服务尚未接入，当前不可用。'
          this.showShareToast('warning', this.shareLinkError)
        }
        return null
      }
      try {
        const module = await import(/* webpackChunkName: "share-links" */ '../../../providers/share-links')
        if (!scope.current()) return null
        return await module.remoteShareLinkAction(this, action, input)
      } catch {
        if (scope.current()) { this.shareLinkError = '链接设置未能完成，请重试。'; this.showShareToast('warning', this.shareLinkError) }
        return null
      }
    },
    loadShareLink() { return this.shareLinkAction('load') },
    queryShareLink() { return this.shareLinkAction('load') },
    setShareLinkAudience(value) {
      if (!['collaborators', 'public'].includes(value) || !this.shareLinkWritable) return null
      return this.shareLinkAction('audience', value)
    },
    clearShareReads({ keepInvitation = false } = {}) {
      clearTimeout(this._shareDirectoryTimer)
      this._shareReadTokens = keepInvitation ? { invitation: this._shareReadTokens?.invitation } : {}
      this.shareMembers = { status: 'idle', items: [], authzVersion: '' }
      this.shareDirectory = { status: 'idle', items: [], error: '' }
      this.shareInviteQuery = ''
      if (!keepInvitation) { this.shareInvitation = emptyInvitation(); this._shareInviteCurrent = null }
    },
    bindShareReads() {
      this._shareReadsOff?.()
      this.clearShareReads()
      const session = this.session
      let context = [session?.documentId, session?.user?.id, session?._privateIdentityGeneration, session?.getProvider?.('authorization')]
      const invalidate = () => {
        const next = [session?.documentId, session?.user?.id, session?._privateIdentityGeneration, session?.getProvider?.('authorization')]
        if (this.session === session && next.every((value, index) => value === context[index])) return
        context = next
        this.closeImageShareDialog()
        this.resetShareLink()
        this.closePermissionDialog()
        this.clearShareReads()
        this.closeSharePopover()
      }
      // `comments-reset` 是 Session 私有身份视图清理的唯一广播通道（换人、凭据轮换、
      // provider 替换）；上面的 context 比较保证同身份授权复核不会误清在读的接收人。
      const stops = ['identity', 'provider-changed', 'comments-reset'].map(name => session?.on?.(name, invalidate)).filter(Boolean)
      const capabilityStop = session?.on?.('capabilities', () => {
        this.resetShareLink()
        if (!this.shareCan('canView') || !this.shareCan('canManagePermission')) { this.closeSharePopover(); this.closePermissionDialog() }
        else if (this.sharePopoverOpen || this.permissionDialogOpen) void this.loadShareLink()
      })
      if (typeof capabilityStop === 'function') stops.push(capabilityStop)
      this._shareReadsOff = () => stops.forEach(stop => stop())
    },
    shareReadCurrent(kind, requirePermission = true) {
      const session = this.session, provider = session?.getProvider?.('authorization'), actor = session?.user?.id, documentId = session?.documentId, generation = session?._privateIdentityGeneration
      const token = {}; this._shareReadTokens ||= {}; this._shareReadTokens[kind] = token
      return () => !this._shareReadsDisposed && this._shareReadTokens[kind] === token && session === this.session && !session?._destroyed && documentId === session?.documentId && actor === session?.user?.id && generation === session?._privateIdentityGeneration && provider === session?.getProvider?.('authorization') && (!requirePermission || this.shareCan('canView') && this.shareCan('canManagePermission'))
    },
    async loadShareMembers() {
      if (!this.shareCan('canView') || !this.shareCan('canManagePermission')) return
      const current = this.shareReadCurrent('members')
      this.shareMembers = { status: 'loading', items: [], authzVersion: '' }
      try {
        if (typeof this.session?.getProvider?.('authorization')?.listMembers !== 'function') throw new Error('协作者服务尚未接入')
        const result = await this.session.listMembers()
        if (current()) this.shareMembers = { status: 'ready', items: result.members, authzVersion: result.authzVersion }
      } catch (error) { if (current()) this.shareMembers = { status: 'failed', items: [], authzVersion: '', error: error.message === '协作者服务尚未接入' ? error.message : '无法加载协作者，请重试。' } }
    },
    async searchShareDirectory() {
      const query = this.shareInviteQuery.trim()
      if (!query || !this.shareCan('canView') || !this.shareCan('canManagePermission')) return
      const current = this.shareReadCurrent('directory')
      this.shareDirectory = { status: 'loading', items: [], error: '' }
      try {
        if (typeof this.session?.getProvider?.('authorization')?.resolveMentions !== 'function') throw new Error('协作者搜索服务尚未接入')
        const result = await this.session.resolveMentions({ query, kinds: ['user'] })
        if (current() && query === this.shareInviteQuery.trim()) this.shareDirectory = { status: result.status === 'resolved' ? 'ready' : 'blocked', items: result.status === 'resolved' ? result.candidates : [], error: result.status === 'resolved' ? '' : '协作者目录暂不可用。' }
      } catch (error) { if (current()) this.shareDirectory = { status: 'failed', items: [], error: error.message === '协作者搜索服务尚未接入' ? error.message : '搜索失败，请重试。' } }
    },
    selectionShareAllowed() { return !this._selectionShareDisposed && this.shareCan('canView') && this.shareCan('canExport') },
    selectionShareTargetValid(target = this._selectionShareTarget, doc = this.editor?.state.doc) {
      if (!target || !doc || this.editor !== target.editor || target.editor.isDestroyed || this.session !== target.session || this.session?._destroyed || this.session?.documentId !== target.documentId || this.onSelectionShare !== target.callback || this._mentionProvider !== target.directory || !this.selectionShareAllowed() || shareNetworkKey(this) !== target.network || this.shareDocumentLink() !== target.documentLink) return false
      const session = this.session
      if (target.actor !== session?.user?.id || target.identity !== session?._privateIdentityGeneration || target.identityGeneration !== session?._identityGeneration ||
        target.authorizationGeneration !== session?._authorizationGeneration || target.authorizationProvider !== session?.getProvider?.('authorization')) return false
      try {
        const selection = target.bookmark.resolve(doc)
        const block = selectionShareBlock(selection)
        // Node/Slice equality also binds the captured descendant blockIds.
        return selectionShareKind(selection) === target.kind && block?.node.attrs.blockId === target.blockId && block.node.eq(target.node) && selection.content().eq(target.slice)
      } catch (_) { return false }
    },
    openSelectionShareDialog(pos) {
      const editor = this.editor
      if (!editor || editor.isDestroyed || !this.selectionShareAllowed()) return false
      try {
        if (pos !== undefined) {
          const node = Number.isInteger(pos) && editor.state.doc.nodeAt(pos)
          if (!node?.isBlock || !NodeSelection.isSelectable(node)) return false
          editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)).setMeta('addToHistory', false))
        }
        const selection = editor.state.selection
        const kind = selectionShareKind(selection), block = selectionShareBlock(selection)
        if (!kind || selection.empty || !block || !BLOCK_ID_PATTERN.test(block.node.attrs.blockId || '')) return false
        const slice = selection.content()
        const policy = createNetworkPolicy(this.larkDocConfig?.network)
        const source = editor.view.nodeDOM(block.pos)
        const table = block.node.type.name === 'table' ? (source?.matches?.('table') ? source : source?.querySelector?.('table')) : null
        const previewSource = table || source
        const unsupported = block.node.type.name === 'webEmbed' || (block.node.type.name === 'linkEmbed' && block.node.attrs.view === 'preview')
        const bounds = previewSource?.getBoundingClientRect?.()
        let dom = !unsupported && previewSource?.nodeType === 1 ? cloneShareExcerpt(previewSource, policy) : null
        if (kind === 'text') {
          const range = source?.ownerDocument.createRange(), start = editor.view.domAtPos(selection.from), end = editor.view.domAtPos(selection.to)
          if (!range) return false
          range.setStart(start.node, start.offset); range.setEnd(end.node, end.offset)
          const holder = source.ownerDocument.implementation.createHTMLDocument('').createElement('div')
          holder.appendChild(range.cloneContents())
          dom = cloneShareExcerpt(holder, policy)
        }
        const $block = editor.state.doc.resolve(block.pos), index = $block.index(), parent = $block.parent
        const beforeNode = index > 0 ? parent.child(index - 1) : null
        const afterNode = index + 1 < parent.childCount ? parent.child(index + 1) : null
        const context = (node, at) => node?.type.name === 'image' ? { type: 'image', text: '[图片]' } : shareExcerpt(editor, node, at, policy)
        const excerpt = { before: context(beforeNode, block.pos - (beforeNode?.nodeSize || 0)), after: context(afterNode, block.pos + block.node.nodeSize) }
        const session = this.session
        const target = { editor, session, documentId: session?.documentId, actor: session?.user?.id, identity: session?._privateIdentityGeneration,
          identityGeneration: session?._identityGeneration, authorizationGeneration: session?._authorizationGeneration, authorizationProvider: session?.getProvider?.('authorization'),
          callback: this.onSelectionShare, directory: this._mentionProvider, documentLink: this.shareDocumentLink(), network: shareNetworkKey(this), bookmark: selection.getBookmark(), kind, blockId: block.node.attrs.blockId, node: block.node, slice }
        this.closeImageShareDialog()
        this._selectionShareTarget = target
        const cancel = () => { if (this._selectionShareTarget === target) this.closeImageShareDialog() }
        const check = () => { if (!this.selectionShareTargetValid(target)) cancel() }
        const map = event => { if (this._selectionShareTarget === target) this.mapSelectionShare(event) }
        editor.on('transaction', map); editor.on('destroy', cancel)
        this._selectionShareOffs = [() => editor.off('transaction', map), () => editor.off('destroy', cancel)]
        for (const event of ['provider', 'editor', 'connection', 'capabilities', 'identity', 'provider-changed', 'comments-reset']) {
          const off = session?.on?.(event, ['provider', 'editor', 'connection'].includes(event) ? cancel : check)
          if (typeof off === 'function') this._selectionShareOffs.push(off)
        }
        const text = slice.content.textBetween(0, slice.content.size, '\n', node => node.type.name === 'image' ? '[图片]' : String(node.attrs.title || node.attrs.url || node.attrs.href || ''))
        this.imageShare = { target: 'selection', selection: { type: kind, blockId: target.blockId, text, content: slice.toJSON() }, preview: { dom, unsupported, width: bounds?.width || 340, height: bounds?.height || 44 }, excerpt, query: '', recipients: [], results: [], message: '', error: '', loading: false, sending: false }
        this.searchImageShareRecipients('')
        return true
      } catch (_) { return false }
    },
    mapSelectionShare({ transaction }) {
      const target = this._selectionShareTarget
      if (!target || !transaction.docChanged) return
      try {
        const previous = target.bookmark.resolve(transaction.before)
        if (previous.ranges.some(range => transaction.mapping.mapResult(range.$from.pos, 1).deleted || transaction.mapping.mapResult(range.$to.pos, -1).deleted)) { this.closeImageShareDialog(); return }
        target.bookmark = target.bookmark.map(transaction.mapping)
        if (!this.selectionShareTargetValid(target, transaction.doc)) this.closeImageShareDialog()
      } catch (_) { this.closeImageShareDialog() }
    },
    openImageShareDialog(image) {
      this.closeImageShareDialog()
      const doc = this.editor?.state.doc
      const resolved = doc && Number.isInteger(image.pos) ? doc.resolve(image.pos) : null
      const index = resolved?.index()
      const parent = resolved?.parent
      const context = (node, pos) => shareExcerpt(this.editor, node, pos)
      const previous = index > 0 ? parent?.child(index - 1) : null
      const excerpt = parent ? { before: context(previous, image.pos - (previous?.nodeSize || 0)), after: context(index + 1 < parent.childCount ? parent.child(index + 1) : null, image.pos + parent.child(index).nodeSize) } : null
      this.imageShare = { image, excerpt, query: '', recipients: [], results: [], message: '', error: '', loading: false, sending: false }
      this.searchImageShareRecipients('')
      return true
    },
    closeImageShareDialog() {
      this._imageShareSearchToken = (this._imageShareSearchToken || 0) + 1
      this._selectionShareOffs?.forEach(off => off())
      this._selectionShareOffs = null
      this._selectionShareTarget = null
      const controller = this._imageShareAbort
      this._imageShareAbort = null
      this.imageShare = null
      controller?.abort()
    },
    async searchImageShareRecipients(query) {
      if (!this.imageShare || this.imageShare.sending) return
      if (this.imageShare.target === 'selection' && !this.selectionShareTargetValid()) { this.closeImageShareDialog(); return }
      const token = this._imageShareSearchToken = (this._imageShareSearchToken || 0) + 1
      this.imageShare = { ...this.imageShare, query, loading: true }
      try {
        const items = this._mentionProvider ? await this._mentionProvider.search(query, { kind: 'all' }) : searchMentionDirectory(this.mentionDirectory, query, 'all')
        if (!this.imageShare || this.imageShare.sending || token !== this._imageShareSearchToken) return
        if (this.imageShare.target === 'selection' && !this.selectionShareTargetValid()) { this.closeImageShareDialog(); return }
        this.imageShare = { ...this.imageShare, loading: false, results: items.filter(item => item?.id && ['user', 'chat'].includes(item.kind)) }
      } catch (error) {
        if (this.imageShare && token === this._imageShareSearchToken) {
          if (this.imageShare.target === 'selection' && !this.selectionShareTargetValid()) this.closeImageShareDialog()
          else this.imageShare = { ...this.imageShare, loading: false, error: error?.message || '接收人搜索失败，请重试' }
        }
      }
    },
    // —— 权限读取（唯一入口，禁止在模板里直接读 session 字段）——
    shareCan(key) {
      return readCapability(this.session, key)
    },
    /** 取一项 capability 的 UI 落值（B24 逐条）。 */
    shareCapabilityState(key) {
      return capabilityUiState(this.session, key)
    },
    /** 置灰样式：有权限返回 null，无权限返回统一置灰视觉（保留 pointer-events）。 */
    shareGrayStyle(key) {
      return capabilityUiState(this.session, key).style
    },

    // —— 一级 popover ——
    /**
     * 入口点击。降级形态（`canManagePermission:false`）**不开任何面板**，直接复制链接
     * （B24 末行：「只复制链接，不弹权限面板」）。
     */
    toggleSharePopover(event) {
      if (!this.shareCan('canView')) return
      if (this.shareEntryMode === SHARE_ENTRY_MODES.readonlyLink) {
        this.copyShareLink()
        return
      }
      if (this.sharePopoverOpen) {
        this.closeSharePopover()
        return
      }
      const rect = event && event.currentTarget && event.currentTarget.getBoundingClientRect
        ? event.currentTarget.getBoundingClientRect()
        : null
      // 实测 popover @(596,52)、按钮本体 @(996,16) 80×32 ⇒ 顶边 = 按钮底边 + 4，
      // 右缘与按钮右缘**对齐**（1076 = 996+80），故 `right` 直接用视口宽减按钮右缘。
      const viewportWidth = typeof window !== 'undefined' && window.innerWidth ? window.innerWidth : 0
      this.sharePopoverAnchor = rect ? { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width } : null
      this.sharePopoverPos = {
        top: rect ? rect.bottom + 4 : 52,
        right: rect ? Math.max(0, viewportWidth - rect.right) : 436,
      }
      this.sharePopoverOpen = true
      void this.loadShareLink()
    },
    sharePopoverStyle() {
      if (typeof window !== 'undefined' && window.innerWidth <= 760) {
        const anchor = this.sharePopoverAnchor
        const top = Math.round(Math.min(anchor ? anchor.bottom + 6 : 54, Math.max(8, window.innerHeight - Math.min(329, window.innerHeight - 68) - 8)))
        return { left: '24px', right: '0px', top: `${top}px`, bottom: '' }
      }
      return { left: '', bottom: '', top: `${this.sharePopoverPos.top}px`, right: `${this.sharePopoverPos.right}px` }
    },
    onShareViewportResize() {
      if (this.sharePopoverOpen) this.refreshOverlays?.()
    },
    closeSharePopover() {
      this.sharePopoverOpen = false
      this.resetShareLink()
      this.closePermissionDialog()
      const keepInvitation = unresolvedInvitation(this.shareInvitation)
      // Reads may be discarded on dismissal; an unresolved write must retain its query guard.
      this.clearShareReads?.({ keepInvitation })
    },
    /** 点外部关闭。权限 Dialog 打开时**不收 popover**（04 §4.1.1 ①：两层叠加）。 */
    onSharePointerDown(event) {
      if (!this.sharePopoverOpen) return
      const target = event.target
      if (!target || typeof target.closest !== 'function') return
      for (let i = 0; i < SHARE_KEEP_OPEN_SELECTORS.length; i += 1) {
        if (target.closest(SHARE_KEEP_OPEN_SELECTORS[i])) return
      }
      this.closeSharePopover()
    },
    /** Esc 逐层收（互斥链，一次只收一层）：改密 → 提示 → 权限 → popover。 */
    onShareWindowKeydown(event) {
      if (!event || event.key !== 'Escape') return
      if (this.passwordDialogOpen) this.closePasswordDialog()
      else if (this.secureLinkConfirmOpen) this.cancelSecureLinkConfirm()
      else if (this.permissionDialogOpen) this.closePermissionDialog()
      else if (this.sharePopoverOpen) this.closeSharePopover()
    },

    // —— 二级权限 Dialog ——
    openPermissionDialog() {
      // 降级形态连二级面板都没有，这里再挡一次（入口已经不弹 popover，防的是外部直调）。
      if (!this.shareCan('canView') || !this.shareCan('canManagePermission')) return
      this.permissionDialogOpen = true
      if (!this.shareLinkState && !this.shareLinkBusy) void this.loadShareLink()
    },
    closePermissionDialog() {
      this.permissionDialogOpen = false
      this.secureLinkConfirmOpen = false
      this.passwordDialogOpen = false
      this.passwordDraft = ''
      if (!this.sharePopoverOpen) this.resetShareLink()
    },
    setPermissionValue(id, value) {
      if (id === 'shareOutsideOrg') return this.setShareLinkAudience(value ? 'public' : 'collaborators')
      this.showShareToast('warning', '此项组织权限服务尚未接入，当前不可用。')
    },
    /** 邀请输入框。受控写法：模板 `:value` + `@input`，不引 v-model（本仓统一口径）。 */
    setShareInviteQuery(value) {
      if (unresolvedInvitation(this.shareInvitation)) return
      this.shareInviteQuery = String(value == null ? '' : value)
      clearTimeout(this._shareDirectoryTimer)
      if (this._shareReadTokens) delete this._shareReadTokens.directory
      this.shareDirectory = { status: 'idle', items: [], error: '' }
      if (this.shareInviteQuery.trim()) this._shareDirectoryTimer = setTimeout(() => this.searchShareDirectory(), 250)
    },
    /** 一级 popover 的链接权限下拉。 */
    setShareLinkPerm(value) {
      if (!LINK_PERM_OPTIONS.includes(value) || !this.shareLinkWritable) return null
      return this.shareLinkAction('permission', value)
    },
    toggleAdvancedSettings() {
      this.permissionAdvancedOpen = !this.permissionAdvancedOpen
    },

    // —— 加密链接状态机（⑤-1 / ⑤-10）——
    /**
     * 点复选框。**开启**要走「提示」二次确认（⑤-1 步 1→2），**关闭**是直接回落
     * （04 只记了开启弹确认，关闭只写「`link_share_entity` 回落到普通枚举」）。
     */
    toggleSecureLink() {
      if (!this.shareLinkWritable) return null
      return this.shareLinkAction('toggle')
    },
    confirmSecureLink() {
      if (!this.secureLinkConfirmOpen || !this.shareLinkWritable || !this.shareLinkState?.cryptoReady) return null
      return this.shareLinkAction('confirm')
    },
    /** 「取消」= 丢弃：复选框回到未勾选，密码区不长出来。 */
    cancelSecureLinkConfirm() {
      this.secureLinkConfirmOpen = false
    },
    applySecureLink(on) {
      if (!this.shareLinkWritable || on && !this.shareLinkState?.cryptoReady) return null
      return on ? this.confirmSecureLink() : this.shareLinkAction('save', { enabled: false })
    },

    // —— 修改密码弹窗（⑤-5 / ⑤-9）——
    openPasswordDialog() {
      if (!this.shareLinkWritable || !this.shareLinkState?.enabled || !this.shareLinkState?.cryptoReady) return
      this.passwordDraft = ''
      this.passwordDialogOpen = true
    },
    /** 取消即丢弃：密码值不变（⑤-10 `k_afterCancel`）。 */
    closePasswordDialog() {
      this.passwordDialogOpen = false
      this.passwordDraft = ''
    },
    setPasswordDraft(value) {
      if (!this.passwordDialogOpen || !this.shareLinkWritable) return
      this.passwordDraft = String(value == null ? '' : value)
    },
    randomizePasswordDraft() {
      if (!this.passwordDialogOpen || !this.shareLinkWritable) return null
      return this.shareLinkAction('random')
    },
    /**
     * 保存。按钮恒可点，非法输入**在提交时静默拦截**：弹窗不关、密码值不变、
     * 不做 shake，只出橙色 warning toast（⑤-9）。
     */
    saveSharePassword() {
      if (!this.passwordDialogOpen || !this.shareLinkWritable || !this.shareLinkState?.enabled || !this.shareLinkState.cryptoReady) return false
      if (!isPasswordValid(this.passwordDraft)) {
        this.showShareToast('warning', SHARE_TOAST_TEXTS.invalidPassword)
        return false
      }
      return this.shareLinkAction('password', this.passwordDraft)
    },

    // —— 复制 ——
    /** 复制链接 + 密码（⑤-4 两个入口行为完全等价：复制按钮 / 点密码值本体）。 */
    copyLinkAndPassword() {
      return this.shareLinkAction('copy-password', buildShareClipboardText)
    },
    /** 降级路径：只复制链接，不带密码、不弹面板。 */
    copyShareLink() {
      if (!this.sharePopoverOpen && !this.permissionDialogOpen) return this.copyReadonlyDocumentLink()
      if (this.shareCan('canManagePermission')) return this.shareLinkAction('copy', (url, password) => password ? buildShareClipboardText(url, password) : buildShareLinkText(url))
      return this.copyReadonlyDocumentLink()
    },
    async copyReadonlyDocumentLink() {
      const scope = this.remoteShareScope(), provider = scope.provider
      const current = () => scope.owner() && this.shareCan('canView') && provider?.isRemote === true
      if (!current() || typeof this.session?.getShareLink !== 'function') { this.showShareToast('warning', '文档链接服务尚未接入，当前不可用。'); return false }
      try {
        const url = await scope.session.getShareLink()
        if (!current()) return false
        const clipboard = this.shareClipboardWriter()
        if (!clipboard?.writeText) throw new Error('clipboard unavailable')
        await clipboard.writeText(buildShareLinkText(url))
        if (current()) this.showShareToast('success', SHARE_TOAST_TEXTS.copiedLink)
        return true
      } catch { if (current()) this.showShareToast('warning', '链接未能复制，请重试。'); return false }
    },
    /** 文档链接：宿主赋值优先，缺省取当前地址。 */
    shareDocumentLink() {
      if (this.shareLink) return this.shareLink
      return typeof window !== 'undefined' && window.location ? window.location.href : ''
    },
    copyShareText(text) {
      const clipboard = this.shareClipboardWriter()
      if (clipboard && typeof clipboard.writeText === 'function') {
        return clipboard.writeText(text).then(() => true).catch(() => this.copyShareTextFallback(text))
      }
      return Promise.resolve(this.copyShareTextFallback(text))
    },
    /** 拆成方法是为了让 http 页面（非安全上下文）与单测都能替换剪贴板实现。 */
    shareClipboardWriter() {
      return typeof navigator !== 'undefined' && navigator.clipboard ? navigator.clipboard : null
    },
    /** 兜底路径：textarea + execCommand（与 `revisionMixin.copyRevisionAnchorFallback` 同写法）。 */
    copyShareTextFallback(text) {
      let area
      try {
        area = document.createElement('textarea')
        area.value = text
        area.setAttribute('readonly', 'readonly')
        area.style.position = 'fixed'
        area.style.top = '-1000px'
        document.body.appendChild(area)
        area.select()
        return document.execCommand('copy') === true
      } catch (error) {
        return false
      } finally { area?.remove() }
    },

    // —— toast ——
    showShareToast(kind, text) {
      this.hideShareToast()
      this.shareToast = { kind, text }
      this._shareToastTimer = setTimeout(() => this.hideShareToast(), SHARE_TOAST.duration)
    },
    hideShareToast() {
      if (this._shareToastTimer) {
        clearTimeout(this._shareToastTimer)
        this._shareToastTimer = null
      }
      this.shareToast = null
    },

    // —— 只读遮罩 ——
    /**
     * 「申请权限」按钮。04 §4.1.1 ⑥ 明写申请流程**诚实未采**（需双账号），
     * 所以这里只把点击抛给宿主，不自造审批流。
     */
    requestShareAccess() {
      try { if (this.openDocumentAccessRequests?.() === true) return true }
      catch { this.showShareToast?.('warning', '权限申请入口暂不可用。'); return false }
      if (typeof this.onRequestAccess === 'function') return this.onRequestAccess()
      return false
    },
  },
}
