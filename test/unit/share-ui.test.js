/**
 * P6b-03 权限与分享 —— capability→UI 映射、入口降级、加密链接状态机、密码三态校验。
 *
 * 只 import `editor/shareMixin` 的**纯逻辑具名导出**与其 Vue options 对象：这两层都零 DOM、
 * 零 Vue 运行时，node 环境下跑得动（vite 门禁禁止单测 import `src/**\/*.vue`）；
 * 权限下拉另按既有冷面板模式读取组件脚本，直接检验选项与交互方法。
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
import { readFileSync } from 'fs'
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
import bubbleMenuMixin from '../../src/components/lark-doc/editor/bubbleMenuMixin'
import blockMenuMixin from '../../src/components/lark-doc/editor/blockMenuMixin'
import * as contentClipboard from '../../src/utils/contentClipboard'

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
  it('原8项与新增canCopy的键与DEFAULT_CAPABILITIES对齐，没有漏项暗落到allow', () => {
    const keys = Object.keys(DEFAULT_CAPABILITIES)
    expect(keys).toHaveLength(9)
    for (let i = 0; i < keys.length; i += 1) {
      expect(Object.prototype.hasOwnProperty.call(CAPABILITY_UI, keys[i])).toBe(true)
    }
    // 未知 key 才允许回落 allow —— 这是「新增 capability 不炸」的兜底，不是给已知 key 用的。
    expect(capabilityTreatment('canSomethingElse')).toBe(CAPABILITY_TREATMENTS.allow)
  })

  it('有权限时9项一律allow / 挂载 / 不置灰 / 无附加样式', () => {
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

  it('canView:false —— 9项里唯一允许「不挂载」的一项（整页只读遮罩）', () => {
    const state = capabilityUiState(deniedAllSession(), 'canView')
    expect(state.allowed).toBe(false)
    expect(state.treatment).toBe(CAPABILITY_TREATMENTS.replace)
    expect(state.mounted).toBe(false)
    // 它不是「隐藏但占位」：置灰样式也不该给它，因为它根本不该出现在 DOM 里。
    expect(state.gray).toBe(false)
    expect(state.style).toBeNull()
  })

  it('原6项和canCopy无权限一律挂载 + 置灰', () => {
    const grayKeys = [
      'canEdit', 'canComment', 'canResolveComment',
      'canCreateVersion', 'canRestoreVersion', 'canExport', 'canCopy',
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

describe('remote member interaction ownership and source changes', () => {
  it.each([[1000, 792], [320, 360]])('keeps a share popover inside a %s x %s viewport even from a lower-left trigger', (width, height) => {
    vi.stubGlobal('window', { innerWidth: width, innerHeight: height })
    try {
      const vm = createVm(fakeSession({ canManagePermission: true }))
      vm.toggleSharePopover({ currentTarget: { getBoundingClientRect: () => ({ bottom: height - 20, right: 120 }) } })
      const menuWidth = Math.min(480, width - 16), left = width - vm.sharePopoverPos.right - menuWidth
      expect(left).toBeGreaterThanOrEqual(8); expect(left + menuWidth).toBeLessThanOrEqual(width - 8)
      expect(vm.sharePopoverPos.top).toBeGreaterThanOrEqual(8); expect(vm.sharePopoverPos.top + Math.min(331, height - 16)).toBeLessThanOrEqual(height - 8)
    } finally { vi.unstubAllGlobals() }
  })
  const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes }); return { promise, resolve } }
  const member = () => ({ principalId: 'bob', scopes: ['document.read', 'document.write'], sources: [
    { originType: 'direct', sourceGrantKey: 'external-source', sourceRevision: '77', scopes: ['document.read', 'document.write'], revoked: false, sourceGap: false },
    { originType: 'share', sourceGrantKey: 'editor-share-original', sourceRevision: '999999999999999999', scopes: ['document.read', 'document.write'], revoked: false, sourceGap: false }] })
  const session = (extra = {}) => {
    const provider = { isRemote: true }
    return { ...fakeSession({ canManagePermission: true }), user: { id: 'alice' }, _privateIdentityGeneration: 1, _authorizationGeneration: 1,
      getProvider: () => provider, listMembers: vi.fn(async () => ({ authzVersion: '12', members: [member()] })), ...extra }
  }
  it('downgrade/removal reuse the same share source and exact decimal CAS; never remove independent sources', async () => {
    const vm = createVm(session(), { submitRemoteShare: vi.fn(async input => input) })
    await vm.loadShareMembers()
    const changed = await vm.changeShareMember('bob', 'reader')
    expect(changed).toMatchObject({ sourceGrantKey: 'editor-share-original', sourceRevision: '1000000000000000000', expectedRevision: '12', revoked: false })
    expect(changed.scopes).not.toContain('document.write')
    const removed = await vm.changeShareMember('bob', 'reader', true)
    expect(removed).toMatchObject({ sourceGrantKey: 'editor-share-original', scopes: [], revoked: true })
    expect(vm.shareMembers.members[0].sources[0].sourceRevision).toBe('77')
  })
  it.each(['identity ABA', 'authorization'])('late member snapshot cannot repopulate after %s', async boundary => {
    const held = deferred(), s = session({ listMembers: vi.fn(() => held.promise) }), vm = createVm(s)
    const pending = vm.loadShareMembers()
    if (boundary === 'identity ABA') { s._privateIdentityGeneration++; s.user = { id: 'alice' } } else s._authorizationGeneration++
    vm.clearRemoteShareView(boundary === 'authorization'); held.resolve({ authzVersion: '12', members: [member()] }); await pending
    expect(vm.shareMembers).toBeNull(); expect(vm.shareMembersBusy).toBe(false)
  })
  it('old share unknown cannot block or alter a replacement identity', async () => {
    let reject
    const held = new Promise((_, no) => { reject = no }), s = session({ requestShare: vi.fn(() => held) }), vm = createVm(s, { showShareToast: vi.fn() })
    const pending = vm.submitRemoteShare({ subject: 'bob' })
    s._privateIdentityGeneration++; vm.clearRemoteShareView(false)
    reject(Object.assign(Error('lost'), { status: 'unknown', operationId: 'old-share' })); await pending
    expect(vm.sharePendingOperation).toBe(''); expect(vm.shareRemoteBusy).toBe(false); expect(vm.showShareToast).not.toHaveBeenCalled()
  })
})

describe('实测基础权限下拉与共享选择器边界', () => {
  function componentScript(name) {
    const source = readFileSync(new URL(`../../src/components/lark-doc/${name}.vue`, import.meta.url), 'utf8')
    const script = source.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/^import .*$/gm, '').replace('export default', 'return')
    return new Function('LarkDocIcon', 'LarkDocSelect', script)({}, {})
  }
  const select = componentScript('LarkDocSelect'), permission = componentScript('PermissionDialog')
  const selectVm = extra => ({ ...select.data(), ...select.methods, hoverOpen: select.props.hoverOpen.default,
    menuMinWidth: select.props.menuMinWidth.default, ...extra })
  const permissionSnapshot = (extra = {}) => ({ tenantId: 'tenant', docId: 'doc', settingsRevision: '9007199254740993', authzVersion: '5', canManage: true,
    values: { collaborators: 'readers', copy: 'readers', duplicate: 'readers', comment: 'readers' },
    supported: { collaborators: ['readers', 'editors', 'managers'], copy: ['readers', 'editors', 'managers'], duplicate: ['readers', 'editors', 'managers'], comment: ['readers', 'editors'] }, ...extra })
  function permissionVm(provider) {
    const session = { documentId: 'doc', user: { id: 'alice' }, _privateIdentityGeneration: 1, _authorizationGeneration: 1,
      getProvider: () => provider, refreshCapabilities: vi.fn(async () => {}) }
    const ed = { shareRemote: true, session, shareCan: () => true, permissionValues: { copy: '可阅读的用户' } }
    const vm = { ...permission.data(), ...permission.methods, ed, $nextTick: callback => callback() }
    for (const key of ['permissionDisabled', 'permissionPlaceholder', 'scopeOptions', 'commentOptions']) {
      Object.defineProperty(vm, key, { get: () => permission.computed[key].call(vm) })
    }
    return vm
  }

  it('远端加载失败不借本地默认值；未知只查询原操作，确认后才换值', async () => {
    const provider = { getSharingSettingsOperation: vi.fn(async () => null), getSharingSettings: vi.fn(async () => permissionSnapshot()),
      requestSharingSettings: vi.fn(async () => { throw Object.assign(Error('unknown'), { status: 'unknown', operationId: 'settings1' }) }),
      querySharingSettingsOperation: vi.fn(async () => ({ ...permissionSnapshot({ values: { ...permissionSnapshot().values, copy: 'managers' } }), operationId: 'settings1' })) }
    const vm = permissionVm(provider)
    expect(vm.permissionValue('copy')).toBe(''); expect(vm.permissionOptions('copy')).toEqual([]); expect(vm.permissionDisabled).toBe(true)
    await vm.loadRemotePermissions()
    expect(vm.permissionValue('copy')).toBe('readers')
    await vm.changePermission('copy', 'managers')
    expect(vm.copyConfirmOpen).toBe(true); expect(provider.requestSharingSettings).not.toHaveBeenCalled()
    expect(vm.permissionValue('copy')).toBe('readers')
    await vm.confirmCopyPermission()
    expect(vm.pendingOperation).toBe('settings1'); expect(vm.permissionValue('copy')).toBe(''); expect(vm.permissionDisabled).toBe(true)
    provider.getSharingSettingsOperation.mockResolvedValue({ operationId: 'settings1', status: 'unknown' })
    provider.getSharingSettings.mockResolvedValue(permissionSnapshot({ settingsRevision: '9007199254740995', authzVersion: '6', values: { ...permissionSnapshot().values, copy: 'editors' } }))
    await vm.loadRemotePermissions()
    expect(provider.requestSharingSettings).toHaveBeenCalledOnce()
    expect(provider.requestSharingSettings).toHaveBeenCalledWith({ expectedRevision: '9007199254740993', changes: { copy: 'managers' } })
    expect(provider.querySharingSettingsOperation).toHaveBeenCalledWith('settings1')
    expect(vm.permissionValue('copy')).toBe('editors'); expect(vm.remoteSettings.settingsRevision).toBe('9007199254740995')
    expect(provider.getSharingSettings).toHaveBeenCalledTimes(2); expect(vm.ed.session.refreshCapabilities).toHaveBeenCalledOnce()
    provider.getSharingSettingsOperation.mockResolvedValue(null); provider.getSharingSettings.mockRejectedValue(Error('unavailable'))
    await vm.loadRemotePermissions()
    expect(vm.permissionValue('copy')).toBe(''); expect(vm.permissionOptions('copy')).toEqual([])
  })

  it('冲突只重新读取，不重发；旧主体的迟到值不能进入新主体', async () => {
    const provider = { getSharingSettingsOperation: vi.fn(async () => null), getSharingSettings: vi.fn(async () => permissionSnapshot()),
      requestSharingSettings: vi.fn(async () => { throw Object.assign(Error('conflict'), { status: 'rejected', httpStatus: 409 }) }) }
    const vm = permissionVm(provider)
    await vm.loadRemotePermissions(); await vm.changePermission('copy', 'managers'); await vm.confirmCopyPermission()
    expect(provider.requestSharingSettings).toHaveBeenCalledOnce(); expect(provider.getSharingSettings).toHaveBeenCalledTimes(2)
    expect(vm.remoteError).toContain('重新选择')
    let resolve, entered
    const gate = new Promise(done => { resolve = done }), started = new Promise(done => { entered = done })
    provider.getSharingSettings = vi.fn(() => { entered(); return gate })
    const pending = vm.loadRemotePermissions(); await started
    vm.ed.session.user = { id: 'bob' }; vm.ed.session._privateIdentityGeneration++
    resolve(permissionSnapshot()); await pending
    expect(vm.remoteSettings).toBeNull(); expect(vm.permissionValue('copy')).toBe('')
  })

  it('copy→managers取消不提交且保旧值，身份变化后旧确认不得提交', async () => {
    const provider = { getSharingSettingsOperation: vi.fn(async () => null), getSharingSettings: vi.fn(async () => permissionSnapshot()), requestSharingSettings: vi.fn() }
    const vm = permissionVm(provider)
    await vm.loadRemotePermissions(); await vm.changePermission('copy', 'managers'); vm.cancelCopyPermission()
    expect(vm.copyConfirmOpen).toBe(false); expect(vm.permissionValue('copy')).toBe('readers'); expect(provider.requestSharingSettings).not.toHaveBeenCalled()
    await vm.changePermission('copy', 'managers'); vm.ed.session._privateIdentityGeneration++
    await vm.confirmCopyPermission(); expect(provider.requestSharingSettings).not.toHaveBeenCalled()
  })

  it.each([['collaborators', 'managers'], ['duplicate', 'managers'], ['comment', 'editors'], ['copy', 'editors']])('%s→%s不触发copy管理权限确认', async (key, value) => {
    const provider = { getSharingSettingsOperation: vi.fn(async () => null), getSharingSettings: vi.fn(async () => permissionSnapshot()),
      requestSharingSettings: vi.fn(async () => ({ ...permissionSnapshot({ values: { ...permissionSnapshot().values, [key]: value } }), operationId: 'settings1' })) }
    const vm = permissionVm(provider)
    await vm.loadRemotePermissions(); await vm.changePermission(key, value)
    expect(vm.copyConfirmOpen).toBe(false); expect(provider.requestSharingSettings).toHaveBeenCalledOnce()
    expect(provider.requestSharingSettings).toHaveBeenCalledWith({ expectedRevision: '9007199254740993', changes: { [key]: value } })
  })

  it('三项基础权限采用阅读/编辑/管理，评论只有阅读/编辑，高级旧选项与默认保持', () => {
    const options = permission.computed.scopeOptions()
    expect(options.map(item => item.label)).toEqual(['可阅读的用户', '可编辑的用户', '可管理的用户'])
    expect(options.map(item => item.value)).toEqual(options.map(item => item.label))
    expect(permission.computed.commentOptions.call({ scopeOptions: options }).map(item => item.value)).toEqual(['可阅读的用户', '可编辑的用户'])
    const vm = createVm(fakeSession({ canManagePermission: true }))
    expect(vm.sharePermissionOptions).toEqual(['可阅读的用户', '可编辑的用户', '仅协作者'])
    expect(vm.permissionValues.requestAccess).toBe('仅协作者')
  })

  it('click-only不因鼠标进入打开或离开关闭，保留键盘选项确认与外部关闭', () => {
    vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
    try {
      expect(select.props.hoverOpen.default).toBe(true)
      expect(select.props.menuMinWidth.default).toBe(132)
      const vm = selectVm({ hoverOpen: false, value: 'reader', options: [{ value: 'reader' }, { value: 'editor' }],
        position: vi.fn(), $refs: { trigger: { focus: vi.fn() } }, $el: { contains: () => false }, $emit: vi.fn() })
      vm.onTriggerEnter(); expect(vm.open).toBe(false)
      vm.toggle(); expect(vm.open).toBe(true); expect(vm.$refs.trigger.focus).toHaveBeenCalledOnce()
      vm.onTriggerLeave(); vm.onMenuLeave(); vi.advanceTimersByTime(200); expect(vm.open).toBe(true)
      vm.moveHighlight(1); vm.commitHighlight()
      expect(vm.$emit).toHaveBeenCalledWith('change', 'editor'); expect(vm.open).toBe(false)
      vm.toggle(); vm.onOutside({ target: {} }); expect(vm.open).toBe(false)
      expect(document.removeEventListener).toHaveBeenCalledWith('pointerdown', vm.onOutside, true)
    } finally { vi.unstubAllGlobals() }
  })

  it.each([[360, 240, 330, 198, 230, 128, 102], [100, 70, -20, 10, 42, 84, 54]])('菜单按实际尺寸留在%s×%s视口内', (width, height, left, top, bottom, menuWidth, menuHeight) => {
    vi.stubGlobal('window', { innerWidth: width, innerHeight: height })
    try {
      const vm = selectVm({ menuMinWidth: 128, $nextTick: callback => callback(), $refs: {
        trigger: { getBoundingClientRect: () => ({ left, top, bottom, width: 104 }) },
        menu: { getBoundingClientRect: () => ({ width: menuWidth, height: menuHeight }) },
      } })
      vm.position()
      const x = parseFloat(vm.menuStyle.left), y = parseFloat(vm.menuStyle.top)
      expect(x).toBeGreaterThanOrEqual(8); expect(x + menuWidth).toBeLessThanOrEqual(width - 8)
      expect(y).toBeGreaterThanOrEqual(8); expect(y + menuHeight).toBeLessThanOrEqual(height - 8)
      expect(parseFloat(vm.menuStyle.minWidth)).toBe(Math.min(128, width - 16))
    } finally { vi.unstubAllGlobals() }
  })
})

describe('正文canCopy门与异步剪贴板上下文', () => {
  const source = readFileSync(new URL('../../src/components/lark-doc/LarkDocEditor.vue', import.meta.url), 'utf8')
  const copySource = source.slice(source.indexOf('    contentCopyAllowed()'), source.indexOf('    featureEnabled('))
  const methods = new Function(`return ({${copySource}})`)()
  function copyVm(session = null) {
    return { ...methods, session, editor: { isDestroyed: false, state: { selection: { from: 0, to: 1, empty: false },
      doc: { textBetween: () => '正文', slice: () => ({ content: { toJSON: () => [] } }) } }, view: { focus: vi.fn() } },
    shareCan: key => !session || session.can(key) !== false, writable: () => true, $nextTick: callback => callback(), deleteBlockRange: vi.fn() }
  }
  const session = () => ({ documentId: 'doc', user: { id: 'alice' }, _privateIdentityGeneration: 1, _authorizationGeneration: 1,
    getProvider: () => provider, can: () => true })
  const provider = { isRemote: true }
  function coldCopyEntry(name, loadClipboard) {
    const entries = {
      bubbleCopy: ['components/lark-doc/editor/bubbleMenuMixin.js', '    bubbleCopy()'],
      copyBlock: ['components/lark-doc/editor/blockMenuMixin.js', '    async copyBlock('],
      copyCode: ['adapters/vue2/CodeNode.vue', '    async copyCode()'],
    }
    const [file, signature] = entries[name], code = readFileSync(new URL('../../src/' + file, import.meta.url), 'utf8')
    const start = code.indexOf(signature), end = code.indexOf('\n  },\n}', start)
    return new Function('loadClipboard', `return ({${code.slice(start, end).replace(/import\(/g, 'loadClipboard(')}}).${name}`)(loadClipboard)
  }

  it.each(['bubbleCopy', 'copyBlock', 'copyCode'].flatMap(name => ['identity', 'authorization', 'provider', 'editor', 'doc', 'document', 'permission'].map(boundary => [name, boundary])))('%s首次冷加载期间%s变化，不读旧正文或写剪贴板', async (name, boundary) => {
    let finish
    const load = vi.fn(() => new Promise(resolve => { finish = resolve }))
    const run = coldCopyEntry(name, load), s = session(), vm = copyVm(s)
    const readText = vi.fn(() => '正文'); vm.editor.state.doc.textBetween = readText
    vm.editor.options = { editorProps: { larkDocCanCopy: () => vm.contentCopyAllowed(), larkDocCopyContext: () => vm.contentCopyContext() } }
    const node = { editor: vm.editor, node: { textContent: '代码' } }
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(), write: vi.fn() } })
    try {
      const pending = run.call(name === 'copyCode' ? node : vm, { from: 0, to: 1 }, true)
      expect(load).toHaveBeenCalledOnce()
      if (boundary === 'identity') { s.user = { id: 'alice' }; s._privateIdentityGeneration++ }
      else if (boundary === 'authorization') s._authorizationGeneration++
      else if (boundary === 'provider') s.getProvider = () => ({ isRemote: true })
      else if (boundary === 'editor') vm.editor = { ...vm.editor }
      else if (boundary === 'doc') vm.editor.state.doc = { ...vm.editor.state.doc }
      else if (boundary === 'document') s.documentId = 'other-document'
      else s.can = key => key !== 'canCopy'
      finish(contentClipboard)
      expect(await pending).toBe(false)
      expect(readText).not.toHaveBeenCalled(); expect(navigator.clipboard.writeText).not.toHaveBeenCalled(); expect(navigator.clipboard.write).not.toHaveBeenCalled()
      expect(vm.deleteBlockRange).not.toHaveBeenCalled()
    } finally { vi.unstubAllGlobals() }
  })

  it('预览代码首次冷加载期间换版本，原快照不能写剪贴板', async () => {
    let finish
    const run = coldCopyEntry('copyCode', () => new Promise(resolve => { finish = resolve })), vm = copyVm(session())
    const panel = readFileSync(new URL('../../src/components/lark-doc/VersionPanel.vue', import.meta.url), 'utf8')
    const start = panel.indexOf('    previewCopyContext()'), end = panel.indexOf('    destroyPreview()', start)
    const previewCopyContext = new Function(`return ({${panel.slice(start, end)}}).previewCopyContext`)()
    const preview = { isDestroyed: false, state: { doc: {} } }, view = { ed: vm, previewEditor: preview }
    preview.options = { editorProps: { larkDocCanCopy: () => vm.contentCopyAllowed(), larkDocCopyContext: () => previewCopyContext.call(view) } }
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn() } })
    try {
      const pending = run.call({ editor: preview, node: { textContent: '旧版本代码' } })
      view.previewEditor = { isDestroyed: false, state: { doc: {} } }; finish(contentClipboard)
      expect(await pending).toBe(false); expect(navigator.clipboard.writeText).not.toHaveBeenCalled()
    } finally { vi.unstubAllGlobals() }
  })

  it('冷加载后上下文未变，保留区块剪切与富文本MIME', async () => {
    const write = vi.fn(async () => {}), vm = copyVm(session())
    vi.stubGlobal('navigator', { clipboard: { write } })
    vi.stubGlobal('window', { ClipboardItem: class { constructor(types) { this.types = types } } })
    try {
      const run = coldCopyEntry('copyBlock', () => Promise.resolve(contentClipboard))
      expect(await run.call(vm, { from: 0, to: 1 }, true)).toBe(true)
      expect(Object.keys(write.mock.calls[0][0][0].types)).toEqual(['text/plain', 'application/x-lark-doc-block+json'])
      expect(vm.deleteBlockRange).toHaveBeenCalledWith({ from: 0, to: 1 }); expect(vm.error).toBe('已剪切区块')
    } finally { vi.unstubAllGlobals() }
  })

  it('无session本地仍能复制，远端缺canCopy严格拒绝；原生正文copy/cut不拦评论等输入草稿', () => {
    expect(copyVm().contentCopyAllowed()).toBe(true)
    const s = session(); s.can = key => key === 'canView' ? true : undefined
    const vm = copyVm(s), body = {}, draft = {}
    expect(vm.contentCopyAllowed()).toBe(false)
    vm.editor.view.dom = { contains: target => target === body }
    for (const type of ['copy', 'cut']) {
      const event = { type, target: body, preventDefault: vi.fn(), stopPropagation: vi.fn() }
      vm.onContentClipboard(event); expect(event.preventDefault).toHaveBeenCalledOnce()
      event.target = draft; event.preventDefault.mockClear(); vm.onContentClipboard(event)
      expect(event.preventDefault).not.toHaveBeenCalled()
    }
  })

  it('演示仍用活动正文门，历史派生内容按精确容器守卫；输入草稿不因旧正文选区被阻止', () => {
    const s = session(); s.can = key => key === 'canView'
    const vm = copyVm(s), body = {}, preview = {}, dialog = {}, input = { closest: () => input }
    vm.slides = true; vm.editor.view.dom = { contains: target => target === body }
    const event = { target: body, preventDefault: vi.fn(), stopPropagation: vi.fn() }
    vm.onContentClipboard(event); expect(event.preventDefault).toHaveBeenCalledOnce()
    vi.stubGlobal('window', { getSelection: () => ({ anchorNode: preview, focusNode: preview }) })
    try {
      const content = { contains: target => target === preview }
      event.target = dialog; event.preventDefault.mockClear(); vm.onContentClipboard(event, content)
      expect(event.preventDefault).toHaveBeenCalledOnce()
      event.target = input; event.preventDefault.mockClear(); vm.onContentClipboard(event, content)
      expect(event.preventDefault).not.toHaveBeenCalled()
      const panel = readFileSync(new URL('../../src/components/lark-doc/VersionPanel.vue', import.meta.url), 'utf8')
      const start = panel.indexOf('    previewCopyContext()'), end = panel.indexOf('    destroyPreview()', start)
      const previewCopyContext = new Function(`return ({${panel.slice(start, end)}}).previewCopyContext`)()
      const previewVm = { previewEditor: { isDestroyed: false }, ed: vm }
      const context = previewCopyContext.call(previewVm); expect(contentClipboard.copyContextCurrent(context)).toBe(false)
      s.can = () => true
      const allowed = previewCopyContext.call(previewVm); expect(contentClipboard.copyContextCurrent(allowed)).toBe(true)
      previewVm.ed = copyVm(session())
      expect(contentClipboard.copyContextCurrent(allowed)).toBe(false)
      previewVm.ed = vm
      previewVm.previewEditor = { isDestroyed: false }; expect(contentClipboard.copyContextCurrent(allowed)).toBe(false)
    } finally { vi.unstubAllGlobals() }
  })

  it.each(['identity', 'authorization', 'editor'])('气泡异步失败后%s已变不再fallback复制旧正文', async boundary => {
    let reject, entered
    const started = new Promise(done => { entered = done })
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(() => { entered(); return new Promise((_, no) => { reject = no }) }) } })
    vi.stubGlobal('document', { createElement: vi.fn() })
    try {
      const s = session(), vm = copyVm(s)
      const pending = bubbleMenuMixin.methods.bubbleCopy.call(vm)
      await started
      if (boundary === 'identity') { s.user = { id: 'bob' }; s._privateIdentityGeneration++ }
      else if (boundary === 'authorization') s._authorizationGeneration++
      else vm.editor = { ...vm.editor }
      reject(Error('clipboard')); await pending
      expect(document.createElement).not.toHaveBeenCalled()
    } finally { vi.unstubAllGlobals() }
  })

  it('区块剪切等到剪贴板返回后校验原doc，编辑期间不删除旧范围', async () => {
    let resolve, entered
    const started = new Promise(done => { entered = done })
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(() => { entered(); return new Promise(done => { resolve = done }) }) } })
    vi.stubGlobal('window', {})
    try {
      const vm = copyVm(session()), pending = blockMenuMixin.methods.copyBlock.call(vm, { from: 0, to: 1 }, true)
      await started
      vm.editor.state.doc = { ...vm.editor.state.doc }; resolve(); expect(await pending).toBe(false)
      expect(vm.deleteBlockRange).not.toHaveBeenCalled()
    } finally { vi.unstubAllGlobals() }
  })

  it('代码NodeView只读轻量内部桥；拒绝时不触及剪贴板，本地无桥保留原复制', async () => {
    const code = readFileSync(new URL('../../src/adapters/vue2/CodeNode.vue', import.meta.url), 'utf8')
    const start = code.indexOf('    async copyCode() {'), end = code.indexOf('\n  },\n}\n</script>', start)
    const copyCode = new Function('loadClipboard', `return ({${code.slice(start, end).replace(/import\(/g, 'loadClipboard(')}}).copyCode`)(() => Promise.resolve(contentClipboard))
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(async () => {}) } })
    try {
      const vm = { node: { textContent: '代码' }, editor: { options: { editorProps: { larkDocCanCopy: () => false } } } }
      expect(await copyCode.call(vm)).toBe(false); expect(navigator.clipboard.writeText).not.toHaveBeenCalled()
      vm.editor.options = {}; await copyCode.call(vm)
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('代码'); expect(vm.message).toBe('已复制')
    } finally { vi.unstubAllGlobals() }
  })
})
