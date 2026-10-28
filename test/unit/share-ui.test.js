/**
 * P6b-03 权限与分享 —— capability→UI 映射、入口降级、加密链接状态机、密码三态校验。
 *
 * 只 import `editor/shareMixin` 的**纯逻辑具名导出**与其 Vue options 对象：这两层都零 DOM、
 * 零 Vue 运行时，node 环境下跑得动（vite 门禁禁止单测 import `src/**\/*.vue`）。
 *
 * 五组用例各自守一条「看着能跑、实际静默错位」的口径：
 *
 * 1. **B24 逐条映射**：8 项 capability 逐个走「有权限 / 无权限」两遍。最容易坏的是
 *    `canView` 与其他 7 项的**不对称** —— 前者是唯一允许不挂载的（整页只读遮罩），
 *    后者一律「挂载 + 置灰」，`hidden` 必须恒为 false。少了这条断言，
 *    「抄 permission === false 就 v-if 掉」的写法会让置灰检查在线上悄悄失效。
 * 2. **`canManagePermission:false` 是降级不是置灰**：按钮仍可点、仍挂载，点了只复制链接、
 *    不弹任何权限面板。它和另外 6 个置灰项在数据结构上必须**可区分**（treatment 不同）。
 * 3. **加密链接开启链路**：必须经「提示」二次确认才落 `link_share_entity:4`，取消 = 丢弃；
 *    密码随「关→开」重新生成。省掉确认直接勾上，等于把风险告知步骤抹掉。
 * 4. **密码校验三态**：大小写**合并**为一种字符类（⑤-8 决定性 —— `AbCdEfGh` 实测 normal），
 *    纯数字/纯符号也不算两类。按常见「大写+小写算两种」实现会整体判反。
 * 5. **保存按钮恒可点 + 提交时静默拦截**：非法密码点保存，弹窗不关、密码值不变、出 warning
 *    toast。做成 `disabled` 就偏离实景；做成抛异常才是真静默失败。
 */
'use strict'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CAPABILITIES } from '../../src/providers/authorization'
import {
  CAPABILITY_TREATMENTS, CAPABILITY_UI, GRAY_STYLE, LINK_SHARE_ENTITY, PASSWORD_MAX, PASSWORD_MIN,
  PASSWORD_RULE_COLORS, PASSWORD_RULE_STATES, PASSWORD_RULE_TEXTS, PERMISSION_DIALOG,
  SHARE_CLIPBOARD_SEPARATOR, SHARE_ENTRY_BUTTON, SHARE_ENTRY_MODES, SHARE_POPOVER, SHARE_TOAST,
  SHARE_TOAST_TEXTS, buildLinkScopeText, buildShareClipboardText, buildShareLinkText,
  capabilityTreatment, capabilityUiState, capabilityUiStates, classifyPasswordChars,
  isPasswordValid, passwordCharClasses, passwordRules, randomPassword, readCapability,
  shareEntryLabel, shareEntryMode,
} from '../../src/components/lark-doc/editor/shareMixin'
import shareMixin from '../../src/components/lark-doc/editor/shareMixin'

// —— 夹具 ——

/** 按 DocumentSession 的语义伪造 session：`can(k)` = `caps[k] !== false`（缺省即允许）。 */
function fakeSession(overrides = {}) {
  const caps = { ...DEFAULT_CAPABILITIES, ...overrides }
  return { can(key) { return caps[key] !== false } }
}

/** 全禁 session：8 项全 false。 */
function deniedAllSession() {
  const caps = {}
  const keys = Object.keys(DEFAULT_CAPABILITIES)
  for (let i = 0; i < keys.length; i += 1) caps[keys[i]] = false
  return fakeSession(caps)
}

/**
 * 造一个「半 Vue 实例」：把 mixin 的 data/methods 拍平，并把 computed 用 getter 挂回去。
 * 不引 Vue 运行时 —— 本文件断言的是逻辑分支，不是渲染。
 */
function createVm(session, overrides = {}) {
  const vm = { ...shareMixin.data(), ...shareMixin.methods, ...overrides }
  vm.session = session == null ? null : session
  const keys = Object.keys(shareMixin.computed)
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i]
    Object.defineProperty(vm, key, {
      get() { return shareMixin.computed[key].call(vm) },
      configurable: true,
    })
  }
  return vm
}

/** 把 mixin 的剪贴板出口换成探针，避免 node 下真的去摸 navigator / document。 */
function withClipboardProbe(vm) {
  const written = []
  vm.shareClipboardWriter = () => ({ writeText: (text) => { written.push(text); return Promise.resolve() } })
  return written
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

// —— 1. B24 capability → UI 逐条映射 ——

describe('05 §5.3.1 B24 capability → UI 映射（8 项逐一对照）', () => {
  it('B24 的键与 DEFAULT_CAPABILITIES 完全对齐，没有漏项暗落到 allow', () => {
    const keys = Object.keys(DEFAULT_CAPABILITIES)
    expect(keys).toHaveLength(8)
    for (let i = 0; i < keys.length; i += 1) {
      expect(Object.prototype.hasOwnProperty.call(CAPABILITY_UI, keys[i])).toBe(true)
    }
    // 未知 key 才允许回落 allow —— 这是「新增 capability 不炸」的兜底，不是给已知 key 用的。
    expect(capabilityTreatment('canSomethingElse')).toBe(CAPABILITY_TREATMENTS.allow)
  })

  it('有权限时 8 项一律 allow / 挂载 / 不置灰 / 无附加样式', () => {
    // 显式打开 canManagePermission：DEFAULT_CAPABILITIES 里它默认 false，
    // 用裸 session 会把「降级」分支混进这条「全部允许」的断言里。
    const session = fakeSession({ canManagePermission: true })
    const states = capabilityUiStates(session)
    const keys = Object.keys(DEFAULT_CAPABILITIES)
    for (let i = 0; i < keys.length; i += 1) {
      const state = states[keys[i]]
      expect(state.allowed).toBe(true)
      expect(state.treatment).toBe(CAPABILITY_TREATMENTS.allow)
      expect(state.mounted).toBe(true)
      expect(state.gray).toBe(false)
      expect(state.downgraded).toBe(false)
      expect(state.style).toBeNull()
    }
  })

  it('canView:false —— 8 项里唯一允许「不挂载」的一项（整页只读遮罩）', () => {
    const state = capabilityUiState(deniedAllSession(), 'canView')
    expect(state.allowed).toBe(false)
    expect(state.treatment).toBe(CAPABILITY_TREATMENTS.replace)
    expect(state.mounted).toBe(false)
    // 它不是「隐藏但占位」：置灰样式也不该给它，因为它根本不该出现在 DOM 里。
    expect(state.gray).toBe(false)
    expect(state.style).toBeNull()
  })

  it('另外 6 项（edit/comment/resolveComment/createVersion/restoreVersion/export）无权限一律挂载 + 置灰', () => {
    const grayKeys = [
      'canEdit', 'canComment', 'canResolveComment',
      'canCreateVersion', 'canRestoreVersion', 'canExport',
    ]
    const session = deniedAllSession()
    for (let i = 0; i < grayKeys.length; i += 1) {
      const state = capabilityUiState(session, grayKeys[i])
      expect(state.treatment).toBe(CAPABILITY_TREATMENTS.gray)
      // 交叉约束 3：除 canView 外必须挂载 —— 挂载后才谈得上「看得见的置灰」。
      expect(state.mounted).toBe(true)
      expect(state.gray).toBe(true)
      expect(state.downgraded).toBe(false)
      expect(state.style).toBe(GRAY_STYLE)
    }
  })

  it('置灰样式：色 var(--ld-share-text-disabled)、cursor not-allowed，但 pointer-events 必须保留（还要能 hover 出原因）', () => {
    // 写 token 引用而非字面 hex：真值只在 styles/share.css 的 --ld-share-* 声明处（T0-05）。
    expect(GRAY_STYLE.color).toBe('var(--ld-share-text-disabled)')
    expect(GRAY_STYLE.cursor).toBe('not-allowed')
    expect(GRAY_STYLE.pointerEvents).toBe('auto')
  })

  it('canManagePermission:false 是「降级」不是「置灰」—— 三者必须可区分', () => {
    const state = capabilityUiState(deniedAllSession(), 'canManagePermission')
    expect(state.treatment).toBe(CAPABILITY_TREATMENTS.downgrade)
    expect(state.mounted).toBe(true)
    // 降级项**不置灰**：按钮还得能点、能复制链接。
    expect(state.gray).toBe(false)
    expect(state.style).toBeNull()
    expect(state.downgraded).toBe(true)
  })

  it('全禁时没有任何一项 hidden === true（B24 里就没有「隐藏」这种处置）', () => {
    const states = capabilityUiStates(deniedAllSession())
    const keys = Object.keys(states)
    for (let i = 0; i < keys.length; i += 1) expect(states[keys[i]].hidden).toBe(false)
  })

  it('session 缺失 / 未实现 can() 时按「缺省即允许」，不会把裸用编辑器整页变只读遮罩', () => {
    expect(readCapability(null, 'canView')).toBe(true)
    expect(readCapability(undefined, 'canView')).toBe(true)
    expect(readCapability({}, 'canView')).toBe(true)
    expect(capabilityUiState(null, 'canView').mounted).toBe(true)
    // `undefined` 这类「字段还没下发」不能当成 false —— 否则首屏会闪一次置灰。
    const pending = { can: () => undefined }
    expect(readCapability(pending, 'canEdit')).toBe(true)
  })
})

// —— 2. 入口降级：canManagePermission:false → 分享只读链接 ——

describe('分享入口降级（B24 末行）', () => {
  it('mode / label 随 canManagePermission 翻转', () => {
    expect(shareEntryMode(fakeSession({ canManagePermission: true }))).toBe(SHARE_ENTRY_MODES.manage)
    expect(shareEntryLabel(fakeSession({ canManagePermission: true }))).toBe('分享')
    // DEFAULT_CAPABILITIES 里 canManagePermission 默认就是 false ⇒ 裸 session 应当是降级态。
    expect(shareEntryMode(fakeSession())).toBe(SHARE_ENTRY_MODES.readonlyLink)
    expect(shareEntryLabel(fakeSession())).toBe('分享只读链接')
  })

  it('降级态下入口仍然挂载且可见（不是置灰、不是消失）', () => {
    const vm = createVm(fakeSession())
    expect(vm.shareEntryMode).toBe(SHARE_ENTRY_MODES.readonlyLink)
    expect(vm.shareEntryVisible).toBe(true)
    expect(vm.shareViewMaskVisible).toBe(false)
    expect(vm.shareGrayStyle('canManagePermission')).toBeNull()
  })

  it('降级态点入口 = 只复制链接：**不**开 popover、**不**开权限面板', () => {
    const vm = createVm(fakeSession())
    const written = withClipboardProbe(vm)
    vm.shareLink = 'https://example.com/wiki/abc'
    vm.toggleSharePopover(null)
    expect(vm.sharePopoverOpen).toBe(false)
    expect(vm.permissionDialogOpen).toBe(false)
    expect(written).toEqual(['https://example.com/wiki/abc'])
    // 降级路径里 openPermissionDialog 也必须自己挡住（防外部直调绕过入口）。
    vm.openPermissionDialog()
    expect(vm.permissionDialogOpen).toBe(false)
    vm.hideShareToast()
  })

  it('canView:false 时入口不挂载、整页只读遮罩生效', () => {
    const vm = createVm(fakeSession({ canView: false }))
    expect(vm.shareEntryVisible).toBe(false)
    expect(vm.shareViewMaskVisible).toBe(true)
    // 遮罩上的「申请权限」只把点击抛给宿主，不自造审批流。
    let asked = 0
    vm.onRequestAccess = () => { asked += 1 }
    vm.requestShareAccess()
    expect(asked).toBe(1)
  })

  it('普通态点入口开 popover，popover 里点「权限设置」才开二级 Dialog（两层叠加，popover 不关）', () => {
    const vm = createVm(fakeSession({ canManagePermission: true }))
    const rect = { bottom: 48, right: 1076 }
    vm.toggleSharePopover({ currentTarget: { getBoundingClientRect: () => rect } })
    expect(vm.sharePopoverOpen).toBe(true)
    vm.openPermissionDialog()
    expect(vm.permissionDialogOpen).toBe(true)
    expect(vm.sharePopoverOpen).toBe(true)
  })

  it('Esc 逐层收一次只收一层：改密 → 提示 → 权限 → popover', () => {
    const vm = createVm(fakeSession({ canManagePermission: true }))
    vm.sharePopoverOpen = true
    vm.permissionDialogOpen = true
    vm.secureLinkConfirmOpen = true
    vm.passwordDialogOpen = true
    vm.onShareWindowKeydown({ key: 'Escape' })
    expect([vm.passwordDialogOpen, vm.secureLinkConfirmOpen, vm.permissionDialogOpen, vm.sharePopoverOpen])
      .toEqual([false, true, true, true])
    vm.onShareWindowKeydown({ key: 'Escape' })
    vm.onShareWindowKeydown({ key: 'Escape' })
    vm.onShareWindowKeydown({ key: 'Escape' })
    expect([vm.secureLinkConfirmOpen, vm.permissionDialogOpen, vm.sharePopoverOpen]).toEqual([false, false, false])
    // 非 Esc 不收任何层。
    vm.sharePopoverOpen = true
    vm.onShareWindowKeydown({ key: 'Enter' })
    expect(vm.sharePopoverOpen).toBe(true)
  })
})

// —— 3. 加密链接开启链路 ——

describe('加密链接状态机（⑤-1 / ⑤-3 / ⑤-10）', () => {
  it('勾选 → 只弹「提示」，此时**还没**生效（取消 = 丢弃）', () => {
    const vm = createVm(fakeSession({ canManagePermission: true }))
    vm.toggleSecureLink()
    expect(vm.secureLinkConfirmOpen).toBe(true)
    expect(vm.secureLinkEnabled).toBe(false)
    expect(vm.secureLinkPassword).toBe('')
    vm.cancelSecureLinkConfirm()
    expect(vm.secureLinkConfirmOpen).toBe(false)
    expect(vm.secureLinkEnabled).toBe(false)
    expect(vm.secureLinkPassword).toBe('')
  })

  it('确认后才开启 + 生成密码：块高 22 → 78', () => {
    const vm = createVm(fakeSession({ canManagePermission: true }))
    expect(vm.shareSecureLinkHeight).toBe(22)
    vm.toggleSecureLink()
    vm.confirmSecureLink()
    expect(vm.secureLinkEnabled).toBe(true)
    expect(vm.shareSecureLinkHeight).toBe(78)
    expect(isPasswordValid(vm.secureLinkPassword)).toBe(true)
  })

  it('关闭不需要确认，直接回落且清掉密码', () => {
    const vm = createVm(fakeSession({ canManagePermission: true }))
    vm.toggleSecureLink()
    vm.confirmSecureLink()
    vm.toggleSecureLink()
    expect(vm.secureLinkConfirmOpen).toBe(false)
    expect(vm.secureLinkEnabled).toBe(false)
    expect(vm.secureLinkPassword).toBe('')
  })

  it('密码随「关 → 开」重新生成（⑤-10：5 次序列全不同）', () => {
    const vm = createVm(fakeSession({ canManagePermission: true }))
    const seen = []
    for (let i = 0; i < 5; i += 1) {
      vm.toggleSecureLink()
      vm.confirmSecureLink()
      seen.push(vm.secureLinkPassword)
      vm.toggleSecureLink() // 关
    }
    const unique = new Set(seen)
    expect(unique.size).toBe(5)
    for (let i = 0; i < seen.length; i += 1) expect(isPasswordValid(seen[i])).toBe(true)
  })

  it('无 canManagePermission 时整条链路都不许往前走', () => {
    const vm = createVm(fakeSession())
    vm.toggleSecureLink()
    expect(vm.secureLinkConfirmOpen).toBe(false)
    vm.openPasswordDialog()
    expect(vm.passwordDialogOpen).toBe(false)
    const before = vm.permissionValues.collaborators
    vm.setPermissionValue('collaborators', '仅协作者')
    expect(vm.permissionValues.collaborators).toBe(before)
  })

  it('「复制链接和密码」真值：链接 + **3 个半角空格** + 密码（⑤-4）', () => {
    expect(SHARE_CLIPBOARD_SEPARATOR).toBe('   ')
    expect(SHARE_CLIPBOARD_SEPARATOR).not.toContain('\t')
    const vm = createVm(fakeSession({ canManagePermission: true }))
    const written = withClipboardProbe(vm)
    vm.shareLink = 'https://example.com/wiki/abc'
    vm.applySecureLink(true)
    vm.secureLinkPassword = '93875&4A'
    vm.copyLinkAndPassword()
    expect(written).toEqual(['飞书链接：https://example.com/wiki/abc   密码：93875&4A'])
    // 成功态是**绿** toast，不是橙的。
    expect(vm.shareToast.kind).toBe(SHARE_TOAST.success.kind)
    expect(vm.shareToast.text).toBe(SHARE_TOAST_TEXTS.copiedLinkAndPassword)
    vm.hideShareToast()
  })

  it('无密码时复制文本退化成纯链接', () => {
    expect(buildShareClipboardText('L', '')).toBe('L')
    expect(buildShareClipboardText('L', null)).toBe('L')
    expect(buildShareLinkText(null)).toBe('')
    expect(buildShareClipboardText('L', 'p')).toBe(`飞书链接：L${SHARE_CLIPBOARD_SEPARATOR}密码：p`)
  })

  it('scope 文案：一级用「可编辑」、二级用「可阅读」，两处**不是**同一个状态', () => {
    expect(buildLinkScopeText('可编辑')).toBe('组织内获得链接的人可编辑')
    expect(buildLinkScopeText('可阅读')).toBe('组织内获得链接的人可阅读')
    const vm = createVm(fakeSession({ canManagePermission: true }))
    expect(vm.shareScopeText).toBe('组织内获得链接的人可编辑')
    expect(vm.shareDialogScopeText).toBe('组织内获得链接的人可阅读')
  })

  it('LINK_SHARE_ENTITY：secure 是实测值 4，normal 是自定占位（见 shareMixin 文件头待定 A）', () => {
    expect(LINK_SHARE_ENTITY.secure).toBe(4)
    expect(LINK_SHARE_ENTITY.normal).toBe(1)
  })
})

// —— 4. 密码校验三态（⑤-6 / ⑤-8 实证表）——

describe('密码校验三态（⑤-6 三态配色 + ⑤-8 实证表）', () => {
  it('三态配色：normal 灰 / success 绿 / error 且**文字一起变红**', () => {
    // 断言 token 引用而非字面 hex：真值只在 styles/share.css 的 --ld-share-* 声明处（T0-05）。
    expect(PASSWORD_RULE_COLORS.normal).toEqual({ icon: 'var(--ld-share-text-disabled)', text: 'var(--ld-share-text)' })
    expect(PASSWORD_RULE_COLORS.success).toEqual({ icon: 'var(--ld-share-success)', text: 'var(--ld-share-text)' })
    expect(PASSWORD_RULE_COLORS.error).toEqual({ icon: 'var(--ld-share-danger)', text: 'var(--ld-share-danger)' })
    // success 与 normal 只差 icon 色（⑤-7：同一段 SVG 只换 color）。
    expect(PASSWORD_RULE_COLORS.success.text).toBe(PASSWORD_RULE_COLORS.normal.text)
  })

  it('第 3 条「不支持的字符」只在出现非法字符时存在，且恒在末尾', () => {
    const ok = passwordRules('abcd1234')
    expect(ok).toHaveLength(2)
    expect(ok.map((r) => r.id)).toEqual(['length', 'classes'])
    const bad = passwordRules('中文密码测试一二')
    expect(bad).toHaveLength(3)
    expect(bad[2].id).toBe('unsupported')
    expect(bad[2].state).toBe(PASSWORD_RULE_STATES.error)
  })

  it('字符类判定是「数字 / 字母 / 符号」三分，大小写**合并**为一类', () => {
    expect(passwordCharClasses('AbCdEfGh')).toBe(1) // ⑤-8：纯字母，大小写不另算
    expect(passwordCharClasses('12345678')).toBe(1)
    expect(passwordCharClasses('!!!!!!!!')).toBe(1)
    expect(passwordCharClasses('Test@1234')).toBe(3)
    expect(passwordCharClasses('')).toBe(0)
    expect(classifyPasswordChars('中文密码')).toEqual({ digit: false, letter: false, symbol: false, unsupported: true })
  })

  /**
   * ⑤-8 实证表逐行回归：[输入, 长度态, 类型态, 是否有第 3 条]。
   * 🔴 `abcdefg` 一行在原文里是自相矛盾的（见下面那条用例），故不进这张表。
   */
  const EMPIRICAL = [
    ['', 'normal', 'normal', false],
    ['a', 'normal', 'normal', false],
    ['abcdefgh', 'success', 'normal', false], // 8 位纯字母只有一类
    ['abcd1234', 'success', 'success', false],
    ['abc12345', 'success', 'success', false],
    ['Test@1234', 'success', 'success', false],
    ['Test@1234567890123', 'success', 'success', false], // 18 位混合
    ['Test@12345678901234', 'normal', 'success', false], // 19 位 → 长度回落 normal
    ['Test@1234567890123456789', 'normal', 'success', false], // 25 位
    ['!!!!!!!!', 'success', 'normal', false],
    ['12345678', 'success', 'normal', false],
    ['AbCdEfGh', 'success', 'normal', false],
    ['中文密码测试一二', 'success', 'normal', true],
  ]

  it.each(EMPIRICAL)('%s → 长度 %s / 类型 %s / 第3条 %s', (input, lengthState, classState, hasUnsupported) => {
    const rules = passwordRules(input)
    expect(rules[0].state).toBe(PASSWORD_RULE_STATES[lengthState])
    expect(rules[1].state).toBe(PASSWORD_RULE_STATES[classState])
    expect(rules.length === 3).toBe(!!hasUnsupported)
    // 含第 3 条时必然不通过。
    expect(isPasswordValid(input)).toBe(lengthState === 'success' && classState === 'success' && !hasUnsupported)
  })

  /**
   * 规格冲突（已上报，见交付报告）：⑤-8 表里 `abcdefg`（7 位纯字母）记「类型规则 = success」，
   * 但同一张表紧接着记 `abcdefgh`（8 位纯字母）为 normal，并注明结论「纯字母只有一种类」；
   * 且纯数字 `12345678`、纯符号 `!!!!!!!!`、大小写混合 `AbCdEfGh` 三条全记 normal。
   * 「至少命中 2 类」是能让其余 12 行 + ⑤-8 末尾「关键口径」注释同时自洽的**唯一**解释，
   * 所以这里按它实现，把 `abcdefg` 那一行当成采集异常留档 —— 不为了迁就它去加特例分支。
   */
  it('⑤-8 的 `abcdefg` 行与同一张表的其余 12 行冲突，本库按「至少两类」判 normal', () => {
    const rules = passwordRules('abcdefg')
    expect(rules[0].state).toBe(PASSWORD_RULE_STATES.normal) // 7 位 ⇒ 长度不满足
    expect(rules[1].state).toBe(PASSWORD_RULE_STATES.normal)
    expect(isPasswordValid('abcdefg')).toBe(false) // 结论「7 位不行」与原文一致
  })

  it('边界：长度阈值取闭区间 [8, 18]', () => {
    expect(PASSWORD_MIN).toBe(8)
    expect(PASSWORD_MAX).toBe(18)
    expect(isPasswordValid('abcd1234')).toBe(true) // 8
    expect(isPasswordValid('abcd123')).toBe(false) // 7
    expect(isPasswordValid('abcd12345678901234')).toBe(true) // 18
    expect(isPasswordValid('abcd123456789012345')).toBe(false) // 19
  })

  it('三条规则文案照抄（顺序固定）', () => {
    const rules = passwordRules('中文')
    expect(rules[0].text).toBe(PASSWORD_RULE_TEXTS.length)
    expect(rules[1].text).toBe(PASSWORD_RULE_TEXTS.classes)
    expect(rules[2].text).toBe(PASSWORD_RULE_TEXTS.unsupported)
    expect(PASSWORD_RULE_TEXTS.length).toBe('长度为 8-18 个字符')
    expect(PASSWORD_RULE_TEXTS.classes).toBe('包含数字、英文字母或英文符号中的至少两种')
    expect(PASSWORD_RULE_TEXTS.unsupported).toBe('包含不支持的字符类型')
  })

  it('randomPassword 恒产出合规 8 位密码（含符号）—— 「随机生成」只填不提交', () => {
    for (let i = 0; i < 200; i += 1) {
      const pwd = randomPassword()
      expect(pwd).toHaveLength(PASSWORD_MIN)
      expect(isPasswordValid(pwd)).toBe(true)
      expect(passwordCharClasses(pwd)).toBeGreaterThanOrEqual(2)
    }
  })
})

// —— 5. 保存按钮恒可点 + 提交时静默拦截（⑤-9）——

describe('修改密码弹窗：保存恒可点 + 静默拦截（⑤-9）', () => {
  it('save 按钮 disabled 恒 false', () => {
    const vm = createVm(fakeSession({ canManagePermission: true }))
    expect(vm.sharePasswordSaveDisabled).toBe(false)
    vm.setPasswordDraft('')
    expect(vm.sharePasswordSaveDisabled).toBe(false)
    vm.setPasswordDraft('25'.padEnd(25, 'x'))
    expect(vm.sharePasswordSaveDisabled).toBe(false)
  })

  it('非法密码：不关弹窗、不改密码值、只出**橙色** warning toast', () => {
    const vm = createVm(fakeSession({ canManagePermission: true }))
    vm.applySecureLink(true)
    const original = vm.secureLinkPassword
    vm.openPasswordDialog()
    vm.setPasswordDraft('!!!!!!!!') // 长度过但只有一类
    const saved = vm.saveSharePassword()
    expect(saved).toBe(false)
    expect(vm.passwordDialogOpen).toBe(true)
    expect(vm.secureLinkPassword).toBe(original)
    expect(vm.shareToast.kind).toBe(SHARE_TOAST.warning.kind)
    expect(vm.shareToast.text).toBe(SHARE_TOAST_TEXTS.invalidPassword)
    expect(vm.shareToast.text).toBe('密码不符合要求，请修改后重试')
    vm.hideShareToast()
  })

  it('warning toast 是橙的不是绿的（⑤-9 两型对照）', () => {
    expect(SHARE_TOAST.warning.background).toBe('var(--ld-share-toast-warning-bg)')
    expect(SHARE_TOAST.success.background).toBe('var(--ld-share-toast-success-bg)')
    expect(SHARE_TOAST.success.background).not.toBe(SHARE_TOAST.warning.background)
    expect(SHARE_TOAST.warning.width).toBe(260)
    expect(SHARE_TOAST.success.width).toBe(414)
    expect(SHARE_TOAST.duration).toBe(3000)
  })

  it('合法密码：写入并关弹窗；取消则丢弃（弹窗关掉但密码不变）', () => {
    const vm = createVm(fakeSession({ canManagePermission: true }))
    vm.applySecureLink(true)
    const original = vm.secureLinkPassword
    vm.randomizePasswordDraft()
    expect(vm.passwordDraft).not.toBe(original)
    expect(vm.saveSharePassword()).toBe(true)
    expect(vm.passwordDialogOpen).toBe(false)
    expect(vm.secureLinkPassword).not.toBe(original)

    vm.openPasswordDialog()
    vm.setPasswordDraft('临时别的值aaaa1')
    vm.closePasswordDialog()
    expect(vm.passwordDialogOpen).toBe(false)
    expect(vm.secureLinkPassword).not.toBe('临时别的值aaaa1')
  })
})

// —— 6. 几何口径（防止「凭手感改像素」）——

describe('几何与按钮口径', () => {
  it('分享是 popover 不是 Dialog：480×331 / z 99 / 顶部留白 2px', () => {
    expect(SHARE_POPOVER.width).toBe(480)
    expect(SHARE_POPOVER.height).toBe(331)
    expect(SHARE_POPOVER.zIndex).toBe(99)
    expect(SHARE_POPOVER.padding).toBe('2px 0 0')
    // 45 + 54 + 36 + 194 = 329 = 内层高，三者与外壳 331 差的就是顶部 2px。
    expect(SHARE_POPOVER.headerHeight + SHARE_POPOVER.memberRowHeight
      + SHARE_POPOVER.inviteHeight + SHARE_POPOVER.lowerHeight).toBe(SHARE_POPOVER.innerHeight)
  })

  it('主按钮 80×32 / var(--ld-share-brand) / radius 6', () => {
    expect(SHARE_ENTRY_BUTTON.width).toBe(80)
    expect(SHARE_ENTRY_BUTTON.height).toBe(32)
    expect(SHARE_ENTRY_BUTTON.background).toBe('var(--ld-share-brand)')
    expect(SHARE_ENTRY_BUTTON.radius).toBe(6)
    expect(SHARE_ENTRY_BUTTON.padding).toBe('4px 11px')
  })

  it('权限 Dialog 500×830，且 **hasFooter === false**（② 末行实测 footer 为 null）', () => {
    expect(PERMISSION_DIALOG.width).toBe(500)
    expect(PERMISSION_DIALOG.height).toBe(830)
    expect(PERMISSION_DIALOG.maskZIndex).toBe(1000)
    expect(PERMISSION_DIALOG.maskBackground).toBe('rgba(0, 0, 0, 0.55)')
    expect(PERMISSION_DIALOG.contentWidth).toBe(437)
    expect(PERMISSION_DIALOG.hasFooter).toBe(false)
  })
})
