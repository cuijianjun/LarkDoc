/**
 * 分享与权限的纯逻辑层 —— 几何常量、B24 capability 映射、密码规则、剪贴板文本。
 * 零 DOM、零 Vue，`test/unit/share-ui.test.js` 在 node 环境直接断言的就是这一份。
 *
 * 从 `shareMixin.js` 原样搬出：该文件头原本就把「纯逻辑 + Vue mixin 两层」写成设计意图，
 * 这里只是把两层落成两个模块。`shareMixin.js` 逐名重新导出，对外签名一字不变。
 */

import { DEFAULT_CAPABILITIES } from '../../../providers/authorization'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import { CellSelection } from '@tiptap/pm/tables'
import { BLOCK_ID_PATTERN } from '../../../core/documentOperations'
import { cloneShareExcerpt } from './shareContent'


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
export const SHARE_KEEP_OPEN_SELECTORS = Object.freeze([
  '.lark-doc-share-popover',
  '.lark-doc-share-entry',
  '.lark-doc-permission-layer',
  '.lark-doc-share-toast',
])

export function shareExcerpt(editor, node, pos, network) {
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

export function selectionShareKind(selection) {
  return selection instanceof CellSelection ? 'cell' : selection instanceof NodeSelection ? 'node' : selection instanceof TextSelection ? 'text' : null
}

export function selectionShareBlock(selection) {
  if (selection instanceof NodeSelection) return { node: selection.node, pos: selection.from }
  const $from = selection instanceof CellSelection ? selection.$anchorCell : selection.$from
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth)
    if (selection instanceof CellSelection ? node.type.name === 'table' : BLOCK_ID_PATTERN.test(node.attrs.blockId || '')) return { node, pos: $from.before(depth) }
  }
  return null
}

export const shareNetworkKey = host => JSON.stringify(host.larkDocConfig?.network || {})
export const INVITE_SCOPES = Object.freeze({
  read: ['document.read', 'version.read'],
  edit: ['document.read', 'document.write', 'comment.write', 'comment.resolve', 'version.read', 'version.create', 'document.export'],
  manage: ['document.read', 'document.write', 'comment.write', 'comment.resolve', 'version.read', 'version.create', 'version.restore', 'document.export', 'grant.manage'],
})
export const emptyInvitation = () => ({ status: 'idle', candidate: null, role: 'read', operationId: '', error: '' })
export const unresolvedInvitation = value => ['sending', 'querying', 'unknown', 'blocked'].includes(value?.status) || value?.status === 'committed' && !value.verified

