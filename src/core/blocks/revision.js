/**
 * 修订（suggest mode）标记与契约 —— requirements/07 §12。
 *
 * 飞书的修订产出的是「**建议**」，不是正文：改动以 `span.revision-container` 包裹的
 * 行内标记呈现，配右侧建议面板。本文件只放**能纯 Node 跑**的部分（常量 / 规范化 /
 * 收集 / 接受拒绝的决策表）与 mark 定义；事务拦截在 `core/revision/tracker.js`，
 * 面板在 `editor/RevisionPanel.vue`。
 *
 * 三条必须守住的口径（改之前先读 07 §12.2）：
 *   1. **颜色写死在 CSS token 里，不引 `--B700`**。飞书用 `--B700` / `--B700-raw`
 *      下发修订色，那两个变量挂在某个中间层、作用域不稳 —— 实测同一元素两轮采集
 *      `background-color` 在 `rgba(4,66,210,0.1)` 与 `rgba(0,0,0,0)` 之间跳（取不到
 *      `--B700-raw` 时 `rgba(var(--B700-raw),0.1)` 属 invalid，整条声明失效）。
 *      故本库落 `--ld-revision` / `--ld-revision-halo` 两个稳定 token，值就是
 *      `#0442D2` 与 `rgba(4,66,210,0.1)`。
 *   2. **删除标记不染色**。删除态文字保持原色（`#1F2329`，在本库里即「继承正文色」，
 *      因为默认档的正文色由主题 token 决定），只有删除线与常驻底色是蓝的。
 *   3. **接受 / 拒绝都是「整条建议」粒度**，不是「选区」粒度 —— 一条 revisionId 可能
 *      横跨多个文本节点（连续键入被合并成同一条），必须整体处理。
 *
 * 四条负结论（别实现）：
 *   - 「修订本身可编辑」：07 §12.5「改」一行明确 ❌（要改只能拒绝后重做）。本库 V1 允许
 *     「在已有修订里继续键入 = 延用同一条建议」（见 tracker 的 id 复用），不做键入拦截 ——
 *     拦截按键会把 IME 与宿主快捷键搅乱，收益不抵风险。
 *   - 「作者区分颜色」：07 §12.2 行为标记一栏写「无（不区分作者颜色，全部同色）」。
 *   - 「拒绝后恢复被删的原文」：07 §12.5 两处都写死「删掉的原文**不会恢复**」。所以
 *     删除态的两颗按钮结果相同（文字都不回来），差别只在语义。
 *   - 「已解决 / 私有评论」概念：07 §12.6 差异表明确「无『已解决』概念」「无 more-btn」。
 */
import { Mark } from '@tiptap/core'

/** 两种标记：新增（蓝字 + 2px 蓝下划线）/ 删除（原色字 + 删除线 + 10% 蓝底）。 */
export const REVISION_KINDS = Object.freeze(['insert', 'delete'])

/** 面板正文区的两档前缀（07 §12.3 正文区 `<b>新增：</b>“…”`）。 */
export const REVISION_LABELS = Object.freeze({ insert: '新增', delete: '删除' })

export const REVISION_DEFAULT_KIND = 'insert'

/** 宿主没给作者信息时的兜底（面板名、`author-*` 类名都用它，不能崩）。 */
export const REVISION_AUTHOR_FALLBACK = 'local-user'
export const REVISION_AUTHOR_NAME_FALLBACK = '我'

/** 头部标签文案恒为这三个字（07 §12.3），不随修订类型变。 */
export const REVISION_PANEL_TITLE = '修订建议'

/**
 * 建议面板几何（07 §12.3 实测）。壳与评论面板同套：宽恒 270、radius 6，
 * 多实例沿右侧纵向排列、间距 6。
 */
export const REVISION_PANEL = Object.freeze({
  width: 270,
  radius: 6,
  gap: 6,
  headerHeight: 32,
  headerPadding: '8px 12px 0',
  labelFontSize: 12,
  controlsWidth: 115,
  controlsHeight: 26,
  controlsPadding: '3px 5px',
  splitWidth: 1,
  splitHeight: 16,
  replyHeight: 83,
  replyPadding: '6px 12px',
  avatarSize: 32,
  rightColumnWidth: 200,
  infoRowHeight: 17,
  bodyHeight: 50,
  bodyMarginTop: 4,
  hitSize: 16,
})

/** 三态高度：137（新增折叠）/ 115（删除折叠）/ 169（激活，多 32px 输入区）。 */
export const REVISION_HEIGHTS = Object.freeze({ insert: 137, delete: 115, active: 169 })

/**
 * 面板头部控件组的六项顺序 —— **不可颠倒**（07 §12.4：拒绝在左、接受在右）。
 * `tone` 只是语义标签，实际色值走 CSS token（不在这里写字面色）。
 */
export const REVISION_BUTTONS = Object.freeze([
  { id: 'go-next', tooltip: '下一个 (↓)', iconSize: 12, tone: 'muted', disabled: false },
  { id: 'go-previous', tooltip: '', iconSize: 12, tone: 'disabled', disabled: true },
  { id: 'split', tooltip: '', iconSize: 0, tone: 'split', disabled: false },
  { id: 'copyAnchor', tooltip: '复制链接', iconSize: 14, tone: 'muted', disabled: false },
  { id: 'reject', tooltip: '拒绝修订', iconSize: 12, tone: 'danger', disabled: false },
  { id: 'accept', tooltip: '接受修订', iconSize: 14, tone: 'success', disabled: false },
])

/** 六项 id 的顺序清单（测试与面板 v-for 共用一份，别各自字面量）。 */
export const REVISION_BUTTON_IDS = Object.freeze(REVISION_BUTTONS.map((item) => item.id))

/** 两种操作。语义见 §12.5：`accept` 采纳建议、`reject` 整条作废。 */
export const REVISION_ACTIONS = Object.freeze(['accept', 'reject'])

let revisionSeq = 0

/**
 * 生成一条修订 id。
 *
 * 带时间戳是为了「刷新后仍能区分两条不同来源的建议」，序号保证同一毫秒内不撞。
 * 传入 `now` 只为测试可复现 —— 生产路径不传，用当前时刻。
 */
export function createRevisionId(now) {
  const base = Number.isFinite(now) ? now : Date.now()
  revisionSeq += 1
  return `rev-${base.toString(36)}-${revisionSeq}`
}

/** 收口一份修订属性（写入前必过）：枚举越界落 `insert`，id / 作者为空则回落兜底。 */
export function normalizeRevision(input) {
  const source = input && typeof input === 'object' ? input : {}
  const id = source.revisionId === null || source.revisionId === undefined ? '' : String(source.revisionId)
  const author = source.author === null || source.author === undefined ? '' : String(source.author)
  return {
    revisionId: id || createRevisionId(),
    author: author || REVISION_AUTHOR_FALLBACK,
    kind: REVISION_KINDS.indexOf(source.kind) === -1 ? REVISION_DEFAULT_KIND : source.kind,
  }
}

/** 从 mark 读回一份干净的修订属性；不是 revision mark 时返回 null。 */
export function readRevision(mark) {
  if (!mark || !mark.type || mark.type.name !== 'revision') return null
  const attrs = mark.attrs || {}
  return normalizeRevision(attrs)
}

/** 节点上挂的第一条修订 mark（没有就 null）。 */
export function revisionMarkOf(node) {
  if (!node || !node.marks) return null
  for (let i = 0; i < node.marks.length; i += 1) {
    const mark = node.marks[i]
    if (mark.type && mark.type.name === 'revision') return mark
  }
  return null
}

/**
 * 扫描整篇文档，把「同一条 revisionId」的片段合并成一条建议。
 *
 * 合并规则：同 id 且**位置相邻或重叠**的片段算一条（连续键入会被 ProseMirror 自动
 * 并成一个文本节点，但跨段 / 跨 mark 边界时会拆开）。顺序按文档序，`from` 升序。
 */
export function collectRevisions(doc) {
  if (!doc || typeof doc.descendants !== 'function') return []
  const segments = []
  doc.descendants((node, pos) => {
    if (!node.isText) return
    const mark = revisionMarkOf(node)
    if (!mark) return
    const attrs = normalizeRevision(mark.attrs)
    segments.push({ revisionId: attrs.revisionId, author: attrs.author, kind: attrs.kind, from: pos, to: pos + node.nodeSize, text: node.text })
  })
  const merged = []
  segments.forEach((segment) => {
    const last = merged[merged.length - 1]
    if (last && last.revisionId === segment.revisionId && segment.from <= last.to) {
      last.to = Math.max(last.to, segment.to)
      last.text += segment.text
      return
    }
    merged.push({ ...segment })
  })
  return merged
}

/** 一条 revisionId 在文档里占的全部区间（升序）；不存在返回空数组。 */
export function revisionRanges(doc, revisionId) {
  const target = String(revisionId || '')
  return collectRevisions(doc)
    .filter((item) => item.revisionId === target)
    .map((item) => ({ from: item.from, to: item.to }))
}

/** 某个文档位置落在哪条修订里（没有就空串）。面板高亮 / 点标记定位共用。 */
export function revisionAt(doc, pos) {
  const items = collectRevisions(doc)
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i]
    // `to` 是开区间：光标停在标记末尾不该算「在修订里」（否则刚敲完就高亮错位）。
    if (pos >= item.from && pos < item.to) return item.revisionId
  }
  return ''
}

/**
 * 接受 / 拒绝的**决策表**（07 §12.5，两处原文互相印证）：
 *
 * | 类型 \ 动作 | accept            | reject                 |
 * | ---------- | ----------------- | ---------------------- |
 * | insert     | 留文字、摘标记     | 连文字一起丢            |
 * | delete     | 连文字一起丢（定稿）| 连文字一起丢（不恢复）  |
 *
 * 返回 `{ dropText }`：true = 把该条建议覆盖的文字删掉，false = 只摘 mark 留文字。
 */
export function revisionDecision(kind, action) {
  if (REVISION_ACTIONS.indexOf(action) === -1) return { dropText: false }
  if (kind === 'delete') return { dropText: true }
  return { dropText: action === 'reject' }
}

/** 面板正文区的一行摘要：`{ label: '新增'|'删除', text: '…' }`（文案来自正文，不落库）。 */
export function revisionSummary(item) {
  const source = item && typeof item === 'object' ? item : {}
  const kind = REVISION_KINDS.indexOf(source.kind) === -1 ? REVISION_DEFAULT_KIND : source.kind
  return { label: REVISION_LABELS[kind], text: source.text === null || source.text === undefined ? '' : String(source.text) }
}

/** 一条修订的面板高度：折叠态按类型分档，激活态恒 169（07 §12.3）。 */
export function revisionPanelHeight(kind, active) {
  if (active) return REVISION_HEIGHTS.active
  return REVISION_HEIGHTS[kind] || REVISION_HEIGHTS.insert
}

/**
 * 修订 mark。
 *
 * `inclusive: false`：mark 不跟着新键入自动延伸 —— 那样「切到编辑模式继续打字」会被
 * 旧建议吞掉。修订只由 tracker 显式落（id 复用逻辑在 tracker 里），语义更窄更可控。
 *
 * 层级严格照 07 §12.2：外层 `span.revision-container[data-inline-wrapper]`，内层
 * `span.text-revision.revision-id-*.author-*`（删除态内层多 `revision-linethrough`）。
 * 颜色不走 inline style —— 那正是复刻坑（§12.2 🔴），一律由 CSS 按 data 属性选。
 */
const LarkDocRevision = Mark.create({
  name: 'revision',
  inclusive: false,
  addAttributes() {
    return {
      // 空串是合法默认值（schema 建表期不能调 `createRevisionId()`）；真正写入选中的
      // 建议由 tracker 的 `normalizeRevision` 补齐。
      revisionId: { default: '', parseHTML: (element) => element.getAttribute('data-revision-id') || '', renderHTML: () => ({}) },
      author: { default: '', parseHTML: (element) => element.getAttribute('data-revision-author') || '', renderHTML: () => ({}) },
      kind: {
        default: REVISION_DEFAULT_KIND,
        parseHTML: (element) => (REVISION_KINDS.indexOf(element.getAttribute('data-revision-kind')) === -1 ? REVISION_DEFAULT_KIND : element.getAttribute('data-revision-kind')),
        renderHTML: () => ({}),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'span.revision-container' }]
  },
  renderHTML({ mark }) {
    const attrs = normalizeRevision(mark.attrs)
    const inner = `text-revision revision-id-${attrs.revisionId} author-${attrs.author}`
    return ['span', {
      class: 'revision-container',
      'data-inline-wrapper': 'true',
      'data-revision-id': attrs.revisionId,
      'data-revision-kind': attrs.kind,
      'data-revision-author': attrs.author,
    }, ['span', {
      class: attrs.kind === 'delete' ? `revision-linethrough ${inner}` : inner,
      'data-string': 'true',
      'data-leaf': 'true',
    }, 0]]
  },
})

export { LarkDocRevision }
