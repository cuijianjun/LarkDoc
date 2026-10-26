/**
 * 交互模式（edit / suggest / read）的**唯一推导口径** —— P6b-05，规格 requirements/07 §1。
 *
 * 为什么要有这一个纯函数：
 *   `LarkDocEditor.vue` 的 `computed.effectiveReadonly` 把「宿主 `readonly` / 阅读模式
 *   `reading` / 演示模式 `slides` / 协同只读 `!canEdit`」四个来源用 `||` 揉成一个布尔，
 *   各 UI（块手柄、气泡条、斜杠菜单、修订面板）再各自判一次 —— 布尔只有一个 bit，
 *   「是哪种只读」被丢掉了，于是「阅读态要不要留评论入口」「修订态算不算只读」这类
 *   问题每个组件答得都不一样，改一处就会漂。飞书是**三态**（07 §1 开篇：「三种交互
 *   模式，不是只读/可编辑二态」），所以这里把四源收成一个三值枚举，UI 一律问派生
 *   谓词，不再自己拼 `||`。
 *
 * 纯 Node 可跑：零 DOM、零 Vue、零编辑器实例，单测直接 import 即可。
 *
 * 四条负结论（别实现）：
 *   - **别把 `suggest` 归进只读**：07 §1 表「修订」行的可编辑正文是 ⚠️（变修订建议），
 *     气泡条 ✅、块手柄 ✅ —— 它是**可编辑态**，只是改动落建议。`docModes.js` 文件头
 *     的 🔴 是同一条，两边都得守。
 *   - **别在 read 态把评论一起关掉**：三档的「可评论」列**全是 ✅**（§1 表 + §1.1
 *     「仅查看或评论文档」）。read 态只卸编辑控件，评论入口留着。
 *   - **别按角色自判权限**：只看 `capabilities.canEdit` / `canComment`，且判定口径跟随
 *     `DocumentSession.can()`（**只有显式 `false` 才算禁用**，缺省视为有权限）。
 *   - **别拿 reason 字符串当状态用**：`interactionReadReason` 只用于调试与事件负载，
 *     UI 分支一律判 `mode` —— 字符串会漂移，枚举不会。
 */
/** 三态。顺序即 `DOC_MODES` 的语义顺序，别当集合乱排。 */
export const INTERACTION_MODES = Object.freeze(['edit', 'suggest', 'read'])

export const INTERACTION_MODE_EDIT = 'edit'
export const INTERACTION_MODE_SUGGEST = 'suggest'
export const INTERACTION_MODE_READ = 'read'

/** 输入残缺（宿主没传、单测裸调）时的兜底：宁可给编辑态，也不给只读态。 */
export const INTERACTION_MODE_FALLBACK = 'edit'

/**
 * 缺省能力位。与 `DocumentSession.can()` 同口径 —— 只有显式 `false` 才算禁用，
 * 所以缺省是「有编辑权、有评论权」，未接 Session 的宿主不会被误判成只读。
 */
export const DEFAULT_CAPABILITIES = Object.freeze({ canEdit: true, canComment: true })

/** 落到 read 的四种来源。**数组顺序 = 判定优先级**，不是集合。 */
export const READ_REASONS = Object.freeze(['slides', 'canEdit', 'reading', 'readonly'])

/** 能力位归一化：缺字段 / 传 null / 传了 Session 之外的东西都回到布尔，后续判定不用再判空。 */
export function normalizeCapabilities(capabilities) {
  const source = capabilities || DEFAULT_CAPABILITIES
  return {
    canEdit: source.canEdit !== false,
    canComment: source.canComment !== false,
  }
}

export function isInteractionMode(value) {
  return INTERACTION_MODES.indexOf(value) !== -1
}

/**
 * 四源 → 三态。**顺序即优先级，从上往下第一个命中的生效**：
 *
 * | 顺序 | 条件 | 结果 | 为什么是这个优先级 |
 * | --- | --- | --- | --- |
 * | 1 | `slides === true` | `read` | 演示态是「投屏讲」的场景，翻页期间绝不能让人改到正文；它压过用户自己选的模式。 |
 * | 2 | `!canEdit` | `read` | 协同只读（服务端没给编辑权）。压在 `reading` / `mode` 之前：没权限时任何「我要编辑」的本地选择都不作数。**这一档仍可评论**（`canComment` 独立判）。 |
 * | 3 | `reading === true` | `read` | 用户主动选的阅读模式（07 §1 表「阅读」行：`Ctrl+⌥+V`，气泡条 ❌ 块手柄 ❌ 拖拽 ❌）。 |
 * | 4 | `readonly === true` | `read` | 宿主把整个编辑器当展示用的开关。它不是三态之一，是宿主的外挂约束，故排在用户选的三态之后。 |
 * | 5 | `mode === 'suggest'` | `suggest` | 修订是**独立的第三态**（§1「不能简化成编辑态的一个开关」）。能走到这里说明上面四条都没拦 —— 即有权编辑且没选只读。 |
 * | 6 | 其余 | `edit` | 默认完整编辑权限。 |
 *
 * 注意第 5 行必须在第 2 行之后：没编辑权限时「修订」也不能进（§12.1「有编辑权限的
 * 用户可进入修订模式」），否则会得到一个「能敲字产生建议、但正文不可写」的怪态。
 */
export function deriveInteractionMode(input) {
  const source = input || {}
  const capabilities = normalizeCapabilities(source.capabilities)
  if (source.slides === true) return INTERACTION_MODE_READ
  if (!capabilities.canEdit) return INTERACTION_MODE_READ
  if (source.reading === true) return INTERACTION_MODE_READ
  if (source.readonly === true) return INTERACTION_MODE_READ
  if (source.mode === INTERACTION_MODE_SUGGEST) return INTERACTION_MODE_SUGGEST
  return INTERACTION_MODE_FALLBACK
}

/**
 * 落到 read 的**是哪一条**（非 read 返回空串）。只给调试、日志与 `mode-change` 事件
 * 负载用；UI 分支别判它（见文件头负结论第 4 条）。
 */
export function interactionReadReason(input) {
  const source = input || {}
  const capabilities = normalizeCapabilities(source.capabilities)
  if (source.slides === true) return 'slides'
  if (!capabilities.canEdit) return 'canEdit'
  if (source.reading === true) return 'reading'
  if (source.readonly === true) return 'readonly'
  return ''
}

export function isReadMode(mode) {
  return mode === INTERACTION_MODE_READ
}

export function isSuggestMode(mode) {
  return mode === INTERACTION_MODE_SUGGEST
}

/**
 * 编辑器 `editable` / 能不能往正文里写东西。
 * **修订态必须 true**：07 §1 表修订行的「可编辑正文」是 ⚠️（变修订建议）——
 * 编辑器不可编辑就一条建议也敲不出来，修订模式直接废掉。
 */
export function canEditContent(mode) {
  return mode === INTERACTION_MODE_EDIT || mode === INTERACTION_MODE_SUGGEST
}

/**
 * 编辑态浮层（块手柄 / 气泡条 / 斜杠菜单 / 拖拽手柄）能不能出现。
 * 07 §1 表只有「阅读」行的气泡条 / 块手柄 / 拖拽是 ❌，修订行是 ✅ —— 所以这里只排 read。
 */
export function canShowEditingChrome(mode) {
  return mode !== INTERACTION_MODE_READ
}

/**
 * 评论入口。三档**全是 ✅**（§1 表 + §1.1「仅查看或评论文档」），所以只看能力位、
 * **不看模式** —— 这就是 read 态「隐藏编辑控件但保留评论」的那一个 bit。
 */
export function canCommentIn(mode, capabilities) {
  return normalizeCapabilities(capabilities).canComment
}

/**
 * 接受 / 拒绝一条修订建议。
 * 07 §12.1：「有编辑权限的用户可接受/拒绝建议」—— 所以是「非 read 态」**且**
 * 「有编辑权」两个条件，协同只读（read 态）时两颗按钮只读展示、置灰不隐藏。
 */
export function canDecideRevision(mode, capabilities) {
  return canEditContent(mode) && normalizeCapabilities(capabilities).canEdit
}
