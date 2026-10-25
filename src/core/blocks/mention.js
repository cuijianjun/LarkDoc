/**
 * 行内提及节点 `mention`（P4-01）—— requirements/02 §19.3。
 *
 * 飞书的 `@` 提及是**行内 atom，不是块**：人员 / 群名片 / 云文档 / 任务清单共用
 * 同一个 node，靠 `kind` 区分（02:488、2918）。因此这里只造一个节点，四条命令
 * 都往它里面塞不同的 `kind`。
 *
 * 字段（02 §19.3 ⑥）：
 *   { type: 'mention', attrs: { kind, id, name, department, notify, mentionId } }
 *
 *   - `kind`        `'user' | 'chat' | 'page' | 'task'`，默认 `'user'`；
 *   - `id`          实体 id（人员 = open_id、群 = chat_id、云文档 = doc token）；
 *   - `name`        显示名；解析失败回退 `未知`（渲染成 `@未知`）；
 *   - `department`  副标题（人员是部门，云文档是所在文件夹）；
 *   - `notify`      「同时发送通知」，默认 **true**（02 §19.3 footer 默认勾选）；
 *   - `mentionId`   文档内**实例** UUID，与 `id` 无关 —— 同一个人 @ 两次得两个不同值。
 *
 * 三个必须守住的像素/行为口径（02 §19.3 ④-bis 实测，改样式前先读）：
 *   1. 视觉壳 79×22 里**只有内层**有底色和圆角：`rgba(148,180,255,.18)` +
 *      `border-radius: 11px`（写死，不是 50%）。外层是 `inline-flex` 的排版壳。
 *   2. 头像 20px = `calc(1em + 4px)`，**跟着字号走**，不能写死 20px。
 *   3. 点 chip **不开光标**（选区保持为空）。atom + selectable 天然如此，别再
 *      额外挂 click → setTextSelection，否则「点完再按 Backspace 会误删下一个」。
 *
 * 删除语义由 atom 免费提供：一次 `Backspace` 删整个节点，块数不变；`Cmd+Z` 可逆。
 */
import { Node, mergeAttributes } from '@tiptap/core'

export const MENTION_KINDS = Object.freeze(['user', 'chat', 'page', 'task'])

/** kind → 面板 tab 与菜单显示名（03:1537 团队协作组口径）。 */
export const MENTION_KIND_LABELS = Object.freeze({ user: '人员', chat: '群名片', page: '云文档', task: '任务清单' })

/** 各字段上限：与 `documentOperations.validateAttrs` 的兜底上限解耦，先自己收紧。 */
export const MENTION_LIMITS = Object.freeze({ id: 256, name: 64, department: 64, mentionId: 64 })

/** 名称解析失败时的回落文案（02 §19.3 ⑥：飞书显示 `@未知`）。 */
export const MENTION_UNKNOWN_NAME = '未知'

/** 空态文案（02 §19.3 面板三层壳实测）。 */
export const MENTION_EMPTY_TEXT = '没有匹配结果，换个关键词试试吧'

// 控制字符统一换成空格：`name` / `department` 会原样进 JSON 和 HTML，夹一个 `\u0000`
// 就能让 `validateAttrs` 把整份文档拒收。这里写属性转义 `\p{Cc}` 而不是
// `/[\u0000-\u001f]/` —— 后者会被 eslint 的 no-control-regex 拦下，两者等价（前者
// 还多覆盖 C1 区），不必为此加 disable 注释。
const CONTROL_RE = /\p{Cc}/gu

function safeKind(kind) {
  return MENTION_KINDS.indexOf(kind) === -1 ? 'user' : kind
}

function clampText(value, limit) {
  if (value === null || value === undefined) return ''
  return String(value).replace(CONTROL_RE, ' ').trim().slice(0, limit)
}

/**
 * 造实例 id（v4 形状 UUID）。
 *
 * 只需在**单篇文档内**唯一，不承担安全职责，所以不用 crypto：
 * 本包要同时跑在 Node 14 构建链与老浏览器里，`crypto.getRandomValues` 不是处处都有。
 */
export function createMentionId() {
  const bytes = []
  for (let index = 0; index < 16; index += 1) bytes.push(Math.floor(Math.random() * 256))
  bytes[6] = (bytes[6] & 15) | 64
  bytes[8] = (bytes[8] & 63) | 128
  let out = ''
  for (let index = 0; index < 16; index += 1) {
    if (index === 4 || index === 6 || index === 8 || index === 10) out += '-'
    const hex = bytes[index].toString(16)
    out += hex.length === 1 ? `0${hex}` : hex
  }
  return out
}

/**
 * 规范化一份提及数据（插入前必过）。
 *
 * `mentionId` 缺失时**当场生成**：`setMention` 可能被 Tiptap 的 chain 重放，
 * 但重放的是同一份 attrs 对象，所以生成的 id 会跟着走，不会一人两个 id。
 */
export function normalizeMention(input) {
  const source = input && typeof input === 'object' ? input : {}
  const kind = safeKind(source.kind)
  const name = clampText(source.name, MENTION_LIMITS.name) || MENTION_UNKNOWN_NAME
  return {
    kind,
    id: clampText(source.id, MENTION_LIMITS.id),
    name,
    department: clampText(source.department, MENTION_LIMITS.department),
    notify: source.notify === undefined || source.notify === null ? true : Boolean(source.notify),
    mentionId: clampText(source.mentionId, MENTION_LIMITS.mentionId) || createMentionId(),
  }
}

/** 从节点读回一份干净的提及数据；不是 mention 节点时返回 null。 */
export function readMention(node) {
  if (!node || !node.type || node.type.name !== 'mention') return null
  const attrs = node.attrs || {}
  return {
    kind: safeKind(attrs.kind),
    id: String(attrs.id === null || attrs.id === undefined ? '' : attrs.id),
    name: String(attrs.name === null || attrs.name === undefined ? '' : attrs.name),
    department: String(attrs.department === null || attrs.department === undefined ? '' : attrs.department),
    notify: attrs.notify !== false,
    mentionId: String(attrs.mentionId === null || attrs.mentionId === undefined ? '' : attrs.mentionId),
  }
}

/**
 * 纯文本形态：`@名字`。
 *
 * 用于 `getText()` / 复制成纯文本 —— chip 的可见文字**没有** `@`（飞书就是
 * 头像 + 名字），但落到剪贴板和 `textBetween` 时必须带 `@`，否则「@了谁」
 * 这条信息在纯文本通道里会丢。
 */
export function mentionPlainText(node) {
  const mention = readMention(node)
  return mention ? `@${mention.name || MENTION_UNKNOWN_NAME}` : ''
}

/** 头像里显示的首字（代理对安全：emoji 名字不会裂成半个字符）。 */
function mentionInitial(name) {
  const chars = Array.from(String(name || MENTION_UNKNOWN_NAME))
  return chars.length ? chars[0] : '@'
}

const LarkDocMention = Node.create({
  name: 'mention',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      kind: {
        default: 'user',
        parseHTML: (element) => safeKind(element.getAttribute('data-mention-kind')),
        renderHTML: (attrs) => ({ 'data-mention-kind': safeKind(attrs.kind) }),
      },
      id: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-token') || '',
        // data-token = 实体 id（飞书 chip 上就是这个名字，见 02 §19.3 ④-bis）。
        renderHTML: (attrs) => ({ 'data-token': String(attrs.id || '') }),
      },
      name: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-name') || '',
        renderHTML: (attrs) => ({ 'data-name': String(attrs.name || '') }),
      },
      department: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-department') || '',
        renderHTML: (attrs) => ({ 'data-department': String(attrs.department || '') }),
      },
      notify: {
        default: true,
        parseHTML: (element) => element.getAttribute('data-notify') !== 'false',
        renderHTML: (attrs) => ({ 'data-notify': attrs.notify === false ? 'false' : 'true' }),
      },
      mentionId: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-mention-id') || '',
        renderHTML: (attrs) => ({ 'data-mention-id': String(attrs.mentionId || '') }),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'span[data-type="mention"]' }]
  },
  renderHTML({ node, HTMLAttributes }) {
    const kind = safeKind(node.attrs.kind)
    const name = String(node.attrs.name || '') || MENTION_UNKNOWN_NAME
    return [
      'span',
      // 外层是排版壳（挂 margin: 0 5px），内层才是那个 79×22 的浅蓝圆角壳 ——
      // 与飞书五层 DOM 的分工一致，两层职责别混到一层里。
      mergeAttributes(HTMLAttributes, {
        'data-type': 'mention',
        class: `lark-doc-mention lark-doc-mention-${kind}`,
      }),
      ['span', { class: 'lark-doc-mention-chip' },
        ['span', { class: 'lark-doc-mention-avatar' }, mentionInitial(name)],
        ['span', { class: 'lark-doc-mention-name' }, name],
      ],
    ]
  },
  renderText({ node }) {
    return mentionPlainText(node)
  },
  addCommands() {
    return {
      /** 插入一个提及 chip；attrs 走 `normalizeMention` 收口（缺 mentionId 时当场造）。 */
      setMention: (attrs) => ({ commands }) => commands.insertContent({ type: this.name, attrs: normalizeMention(attrs) }),
    }
  },
})

export { LarkDocMention }
