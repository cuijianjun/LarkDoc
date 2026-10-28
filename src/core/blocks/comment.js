/**
 * 评论（comment）标记与几何契约 —— requirements/04 §3.1、05 §5.5（P6b-01）。
 *
 * 与 `revision.js` 同目录、同范式：本文件只放**能纯 Node 跑**的部分（常量 / 规范化 /
 * 收集 / 高度推导）与 mark 定义；面板状态机在 `editor/commentsMixin.js`，DOM 在
 * `CommentPanel.vue`，样式在 `styles/comments.css`。
 *
 * 三条必须守住的口径（改之前先读 04 §3.1）：
 *   1. **mark 只带 `threadId`，不带位置**。05 §5.5⑥ 写明锚点是 `blockId + offset + length`
 *      的**块内相对偏移**，「不用 ProseMirror from/to」。所以本文件的 `from` / `to` 只在
 *      视图里活着（点亮高亮、算面板 y、跳上下一条），**绝不入持久化** —— 全文坐标在任意
 *      一次编辑后就会指向别人。
 *   2. **块被删只降级 unbound，绝不就近吸附**。把甲段落的回复挂到乙段落上，比明说
 *      「原引用已删除」难查得多（数据层 `core/comments/anchor.js` 文件头同一条口径）。
 *   3. **`⌘+Enter` 不提交**。04 §3.1⑤ 是实测结论（batch152 按下后仍停在草稿态，batch153
 *      点「发送」才落库）。所以本层不提供任何 submit-on-keydown 的开关位。
 *
 * 五条负结论（别实现）：
 *   - 「面板头『更多』里放删除 / 解决 / 重开」：04 §3.1④-3 的 🔴 修正历史记录明确这是**错的**。
 *     「解决」是头部独立按钮 `resolve-btn`（16×16）；「删除」在**回复行**的更多菜单里；
 *     面板头「更多」**只有「私有评论」一个开关项**。
 *   - 「两套『更多』合并成一个组件」：面板头下拉 278×112 / z-index 1050，回复行下拉
 *     152×134 / 默认层，尺寸与层级都不同，04 §3.1⑤ 点名要求别做成同一个组件。
 *   - 「删除加二次确认 / 红字变体」：④-3 B 表写明**无二次确认**，且飞书**未**加
 *     `delete-item` 红字变体。
 *   - 「正文高亮复刻飞书原类名」：飞书是 `SPAN.comment-hl text-comment local-comment
 *     comment-id-{uuid}`，本库统一走 `lark-doc-` 前缀（见 `revision.js` 的取舍注释另一路：
 *     修订照抄了飞书类名）。评论这里按项目口径取 `lark-doc-comment`，飞书原类名只在
 *     requirements 留档 —— 混写两套会让主题档的选择器互相覆盖。
 *   - 「mark 自己生成线程 id 顶替 Provider」：`normalizeComment` 的空值兜底只用于「mark 已
 *     落到文档上但没有 key」这种坏数据，防止面板失去连线键；真正建评论时 id 由 Provider
 *     下发并覆盖（与 `core/comments/thread.js` 的「本层不造 id」不冲突，那条约束针对落库）。
 */

import { Mark } from '@tiptap/core'
import { partitionThreads } from '../comments/anchor'

/** mark 名。写死成常量是为了面板 / 命令 / 测试共用一份字面量。 */
export const COMMENT_MARK_NAME = 'comment'

/** 正文高亮的外层类名（本项目统一 `lark-doc-` 前缀，见文件头负结论）。 */
export const COMMENT_HIGHLIGHT_CLASS = 'lark-doc-comment'

/** 没有作者信息时的兜底（面板名、头像色都用它，不能崩）。 */
export const COMMENT_AUTHOR_NAME_FALLBACK = '我'

/**
 * 面板几何（04 §3.1④ 实测 2026-10-24 · batch152/153/155）。
 *
 * 值与文档逐格对齐，**不自己凑**：宽度恒 270、x 常驻 1214，卡片 radius 6、bg `#FFFFFF`。
 *
 * 只放**尺寸与字号**：色值一律不进本文件（ `--ld-comment-*` 定义在 `styles/comments.css`
 * ）。两条原因：① `revision.js` 同款取舍 —— 逻辑层用不到颜色；② `scripts/check-theme-tokens.js`
 * 禁止在 `.js` 里新增字面 hex，色值收在 CSS 的自定义属性声明处不触发止血。
 */
export const COMMENT_PANEL = Object.freeze({
  width: 270,
  x: 1214,
  radius: 6,
  headerWidth: 268,
  headerHeight: 35,
  quoteFontSize: 12,
  controlsWidth: 97,
  controlsHeight: 26,
  splitWidth: 1,
  splitHeight: 16,
  hitSize: 16,
  moreWidth: 18,
  moreHeightDraft: 20,
  moreHeightSubmitted: 18,
  replyWidth: 268,
  replyHeight: 61,
  replyMainWidth: 244,
  replyMainHeight: 49,
  avatarSize: 32,
  rightColumnWidth: 200,
  rightColumnHeight: 49,
  infoRowHeight: 17,
  nameFontSize: 12,
  timeFontSize: 12,
  bodyWidth: 200,
  bodyHeight: 28,
  bodyLineHeight: 22,
  bodyFontSize: 14,
  textareaWidth: 268,
  textareaHeight: 58,
  textareaHeightActive: 98,
  editorShellWidth: 193,
  editorShellHeight: 26,
  inputLineHeight: 22,
  operationWidth: 27,
  operationHeight: 16,
  imageSize: 16,
  buttonWidth: 48,
  buttonHeight: 28,
  buttonGap: 8,
  buttonGroupWidth: 96,
})

/** 三态高度（04 §3.1④「三态高度」表）+ 每条回复的增量（+61，旧记 55 已作废）。 */
export const COMMENT_HEIGHTS = Object.freeze({
  empty: 150,
  drafting: 238,
  submittedOne: 156,
  perReply: 61,
  textarea: 58,
  textareaActive: 98,
})

/** 右下角圆形入口 36×36、右侧悬浮快捷条 154×36（04 §3.1③）。 */
export const COMMENT_ENTRANCE = Object.freeze({ firstButton: 36, goFirstWidth: 154, goFirstHeight: 36 })

/**
 * 回复行 hover 的三颗按钮（04 §3.1④-2）：每格 14×14、步进 25、三格总宽 92。
 * 右边贴齐卡片右缘，故只记尺寸与步进，绝对 x（1414/1439/1464）随视口变，不落常量。
 */
export const COMMENT_REPLY_CONTROLS = Object.freeze({ size: 14, step: 25, totalWidth: 92 })

/** 三颗的顺序：添加表情 / 引用回复 / 更多菜单。 */
export const COMMENT_REPLY_CONTROL_IDS = Object.freeze(['emoji', 'quote', 'more'])

/** 面板头「更多」下拉（04 §3.1④-3 A）：278×112、z 1050，里头只有「私有评论」开关。 */
export const COMMENT_MORE_MENU = Object.freeze({
  width: 278,
  height: 112,
  zIndex: 1050,
  radius: 6,
  rowWidth: 276,
  rowHeight: 32,
  iconSize: 20,
  titleWidth: 192,
  titleFontSize: 14,
  switchWidth: 40,
  switchHeight: 22,
  handlerSize: 18,
  handlerTravel: 18,
  hintWidth: 276,
  hintHeight: 74,
  hintFontSize: 12,
  hintLineHeight: 20,
})

/** 「私有评论」的标题与说明文案（04 §3.1④-3 A 原文，一字不改）。 */
export const COMMENT_PRIVATE_SWITCH = Object.freeze({
  title: '私有评论',
  hint: '开启后，仅提及的协作者、文档所有者、有文档管理权限的用户、内容编写者可见。',
})

/**
 * 回复行「更多」下拉（04 §3.1④-3 B）：152×134、菜单项 144×30 × 4。
 * 飞书把 dropdown 拼成了 **dorpdown**，复刻保留原类名便于与实机比对。
 */
export const COMMENT_REPLY_MENU = Object.freeze({ width: 152, height: 134, itemWidth: 144, itemHeight: 30 })

/** 四项顺序固定（04 §3.1④-3 B）：编辑 / 翻译为简体中文 / 删除 / 举报。 */
export const COMMENT_REPLY_MENU_ITEMS = Object.freeze([
  { id: 'edit', label: '编辑', ownOnly: true },
  { id: 'translate', label: '翻译为简体中文', submenu: true },
  { id: 'delete', label: '删除', danger: false },
  { id: 'report', label: '举报', othersOnly: true },
])

/** 四项 id 的顺序清单（测试与面板 v-for 共用一份）。 */
export const COMMENT_REPLY_MENU_IDS = Object.freeze(COMMENT_REPLY_MENU_ITEMS.map((item) => item.id))

/**
 * 头部控件组的顺序 —— **不可颠倒**（04 §3.1④）：下一条 / 上一条 / 分隔 / 复制锚点 /
 * 解决 / 更多。`tone` 只是语义标签，色值走 CSS token。
 */
export const COMMENT_CONTROLS = Object.freeze([
  { id: 'go-next', iconSize: 12, tone: 'muted' },
  { id: 'go-previous', iconSize: 12, tone: 'muted' },
  { id: 'split', iconSize: 0, tone: 'split' },
  { id: 'copyAnchor', iconSize: 14, tone: 'muted' },
  { id: 'resolve', iconSize: 14, tone: 'primary' },
  { id: 'more', iconSize: 14, tone: 'muted' },
])

export const COMMENT_CONTROL_IDS = Object.freeze(COMMENT_CONTROLS.map((item) => item.id))

let commentSeq = 0

/**
 * 生成一个本地 threadId。
 *
 * 只用于「mark 已在文档上但没带 threadId」的坏数据兜底（见文件头负结论最后一条），
 * 不代替 Provider 下发的 id。传 `now` 只为测试可复现。
 */
export function createCommentThreadId(now) {
  const base = Number.isFinite(now) ? now : Date.now()
  commentSeq += 1
  return `cmt-${base.toString(36)}-${commentSeq}`
}

/** 收口一份评论属性（写入前必过）：threadId 为空则兜一个本地 id。 */
export function normalizeComment(input) {
  const source = input && typeof input === 'object' ? input : {}
  const raw = source.threadId === null || source.threadId === undefined ? '' : String(source.threadId)
  return { threadId: raw.trim() || createCommentThreadId() }
}

/** 从 mark 读回干净的评论属性；不是 comment mark 时返回 null。 */
export function readComment(mark) {
  if (!mark || !mark.type || mark.type.name !== COMMENT_MARK_NAME) return null
  return normalizeComment(mark.attrs)
}

/** 节点上挂的第一条评论 mark（没有就 null）。 */
export function commentMarkOf(node) {
  if (!node || !node.marks) return null
  for (let i = 0; i < node.marks.length; i += 1) {
    const mark = node.marks[i]
    if (mark.type && mark.type.name === COMMENT_MARK_NAME) return mark
  }
  return null
}

/**
 * 扫描整篇文档，把「同一个 threadId」的片段合并成一条。
 *
 * 合并规则与 `collectRevisions` 同源：同 threadId 且**位置相邻或重叠**算一条（划词跨段 /
 * 跨 mark 边界时 ProseMirror 会拆成多个文本节点）。顺序按文档序，`from` 升序。
 *
 * 这里的 `from` / `to` 是**视图坐标**，只用于高亮与定位，不入持久化（见文件头口径 1）。
 */
export function collectComments(doc) {
  if (!doc || typeof doc.descendants !== 'function') return []
  const segments = []
  doc.descendants((node, pos) => {
    if (!node.isText) return
    const mark = commentMarkOf(node)
    if (!mark) return
    const attrs = normalizeComment(mark.attrs)
    segments.push({ threadId: attrs.threadId, from: pos, to: pos + node.nodeSize, text: node.text })
  })
  const merged = []
  segments.forEach((segment) => {
    const last = merged[merged.length - 1]
    if (last && last.threadId === segment.threadId && segment.from <= last.to) {
      last.to = Math.max(last.to, segment.to)
      last.text += segment.text
      return
    }
    merged.push({ ...segment })
  })
  return merged
}

/** 一个 threadId 在文档里占的全部区间（升序）；不存在返回空数组。 */
export function commentRanges(doc, threadId) {
  const target = String(threadId || '')
  return collectComments(doc)
    .filter((item) => item.threadId === target)
    .map((item) => ({ from: item.from, to: item.to }))
}

/** 某个文档位置落在哪条评论里（没有就空串）；`to` 是开区间。 */
export function commentAt(doc, pos) {
  const items = collectComments(doc)
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i]
    // 开区间：光标停在标记末尾不该算「在评论里」，否则刚划完词就点亮错位。
    if (pos >= item.from && pos < item.to) return item.threadId
  }
  return ''
}

/**
 * 面板高度（04 §3.1④「三态高度」）。
 *
 * 三档实测值直接用，多出来的回复按 `perReply` 线性叠加 —— 文档只写了「每条新增回复
 * +61」，没有第四档实测，故不做别的插值。
 */
export function commentPanelHeight(replyCount, drafting) {
  const count = Number.isInteger(replyCount) && replyCount > 0 ? replyCount : 0
  if (drafting) return COMMENT_HEIGHTS.drafting + (count - 1) * COMMENT_HEIGHTS.perReply
  if (!count) return COMMENT_HEIGHTS.empty
  return COMMENT_HEIGHTS.submittedOne + (count - 1) * COMMENT_HEIGHTS.perReply
}

/**
 * 给面板做 UI 分组：能画高亮的 / 只能显示「原引用已失联」的。
 *
 * 直接复用数据层的 `partitionThreads`，这里不做第二份判定 —— 两处口径一分为二就会出现
 * 「面板说失联、高亮却还画着」的错位。
 */
export function partitionCommentThreads(threads, source) {
  return partitionThreads(threads, source)
}

/**
 * 评论 mark。
 *
 * `inclusive: false`：mark 不跟着新键入自动延伸 —— 否则在评论末尾继续打字会把新文字也
 * 圈进旧线程，与 05 §5.5「锚点是 blockId + offset + length」的块内偏移语义打架。
 *
 * 层级照 `revision.js`：外层 `span.lark-doc-comment[data-inline-wrapper][data-thread-id]`，
 * 内层 `span[data-string][data-leaf]`。颜色一律交给 CSS 按 data 属性选，不写 inline style。
 */
const LarkDocComment = Mark.create({
  name: COMMENT_MARK_NAME,
  inclusive: false,
  addAttributes() {
    return {
      // 空串是合法默认值（schema 建表期不能调 `createCommentThreadId()`）；真正建评论时
      // 由 mixin 用 Provider 下发的 id 覆盖。
      threadId: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-thread-id') || '',
        renderHTML: () => ({}),
      },
    }
  },
  parseHTML() {
    return [{ tag: `span.${COMMENT_HIGHLIGHT_CLASS}` }]
  },
  renderHTML({ mark }) {
    const attrs = normalizeComment(mark.attrs)
    return ['span', {
      class: COMMENT_HIGHLIGHT_CLASS,
      'data-inline-wrapper': 'true',
      'data-thread-id': attrs.threadId,
    }, ['span', {
      class: `${COMMENT_HIGHLIGHT_CLASS}-inner`,
      'data-string': 'true',
      'data-leaf': 'true',
    }, 0]]
  },
})

export { LarkDocComment }
