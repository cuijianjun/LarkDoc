/**
 * 卡片块 `cardEmbed`（P3-04）—— requirements/09 §3.5。
 *
 *   - 一个**原子块**，但内容渲染在 DOM（不走 iframe）：可被搜索、可导出 PDF/DOCX、
 *     可被评论锚定、可参与协同。这正是它不能和 `webEmbed` 合并成一个节点的原因
 *     （09 §3.4「为什么不是一个节点带 kind 属性」）——两者 schema / 序列化 / 导出
 *     行为都不同，合并会让每个下游都写 `if (kind === ...)`。
 *   - 只存**一个** `card` 属性（JSON 字符串，形状 = `core/embed/card.js` 的 CardSchema）。
 *     不拆成 `providerId` / `payload` / `actions` 多个 attrs：§3.5 那张表就是卡的形状，
 *     拆开会造出两个真相。
 *   - `renderHTML` **同时是导出产物**（`getHTML()` / PDF / DOCX 都走它），所以标题、
 *     描述、字段、动作必须画成静态文本 —— 只写 `data-card` 的话导出的是一块空白。
 *     NodeView 直接复用这份 markup（见 `core/nodeviews/card-embed.js` 的 DOMSerializer），
 *     严格保证「编辑器里看到什么 = 导出的是什么」。
 *   - 动作按钮是 `span[role=button]` 而不是 `a` / `button`：块内容不可编辑，
 *     真正的点击语义由 NodeView 转成 `onAction` 冒泡给宿主（编辑器不持 token）。
 */
import { Node, mergeAttributes } from '@tiptap/core'
import { BLOCK_ID_PATTERN } from '../documentOperations'
import { validateAttribute } from './shared'
import { getNodeView } from '../nodeviews/registry'
import { createCardEmbedNodeView } from '../nodeviews/card-embed'
import {
  CARD_MAX_BYTES, encodeCard, isFutureCard, isKnownProvider, readCard, utf8Bytes,
} from '../embed/card'

/**
 * 判定层与块定义同源：常量与纯函数都在 `core/embed/card.js`，这里原样再导一次，
 * 上层只认 `registry/blocks.js` 一个入口（P0-04 硬规则 1）。
 */
export {
  CARD_MAX_BYTES, CARD_VERSION, cardSchema, encodeCard, isFutureCard, isKnownProvider,
  normalizeCard, readCard, utf8Bytes,
} from '../embed/card'

/**
 * `attrs.card` 的合法性 = 「能解析成对象」且「不超过 8 KB」。
 *
 * 允许 null（`default`），因为 atom 节点在 `create()` 时可能还没拿到 card；
 * 渲染层把 null 画成占位卡，而不是在这里拒收造成「节点建不出来」。
 */
const safeCard = (value) => value === null || value === undefined
  || (typeof value === 'string' && utf8Bytes(value) <= CARD_MAX_BYTES && readCard(value) !== null)

/** 字段/动作的读取上限与 `core/embed/card.js` 的 LIMITS 一致，这里只管渲染期防御。 */
const RENDER_LIMITS = Object.freeze({ title: 300, desc: 2000, fieldLabel: 40, fieldValue: 200, actionLabel: 40 })

function renderText(value, limit) {
  return typeof value === 'string' && value ? Array.from(value).slice(0, limit).join('') : ''
}

function renderFields(payload) {
  const fields = payload && Array.isArray(payload.fields) ? payload.fields : []
  return fields.reduce((acc, field) => {
    if (!field || typeof field !== 'object') return acc
    const label = renderText(field.label, RENDER_LIMITS.fieldLabel)
    const value = renderText(field.value, RENDER_LIMITS.fieldValue)
    if (!label || !value) return acc
    // ⚠️ renderSpec 只认「展平的 children」：`['div', attrs, childA, childB]`。
    // 把子 spec 收成一个数组当第三位会被递归当成单个 spec，然后因为
    // `structure[0]` 不是字符串抛 `RangeError: Invalid array passed to renderSpec`。
    acc.push(['div', { class: 'lark-doc-card-field' },
      ['dt', { class: 'lark-doc-card-field-label' }, label],
      ['dd', { class: 'lark-doc-card-field-value' }, value]])
    return acc
  }, [])
}

function renderActions(actions) {
  const list = Array.isArray(actions) ? actions : []
  return list.reduce((acc, action, index) => {
    if (!action || typeof action !== 'object') return acc
    const id = typeof action.id === 'string' ? action.id : ''
    const label = renderText(action.label, RENDER_LIMITS.actionLabel)
    if (!id || !label) return acc
    acc.push(['span', {
      class: index === 0 ? 'lark-doc-card-action is-primary' : 'lark-doc-card-action',
      role: 'button',
      tabindex: '0',
      'data-card-action': id,
      'data-card-action-kind': action.kind === 'open' ? 'open' : 'command',
    }, label])
    return acc
  }, [])
}

/** 封面用 `background-image` 而不是 `img`：图挂了不会破图标（同 bookmark favicon 口径）。 */
function renderCover(cover) {
  if (typeof cover !== 'string' || !cover) return null
  return ['div', {
    class: 'lark-doc-card-cover',
    role: 'img',
    'aria-label': '卡片封面',
    style: `background-image: url("${cover.replace(/"/g, '%22')}")`,
  }]
}

/** 无数据 / 未知来源共用的占位卡：复用 `unknown-block` 的 chrome，不新造一套令牌。 */
function placeholder(title, sub) {
  return ['div', { class: 'lark-doc-unknown-card' },
    ['span', { class: 'lark-doc-unknown-card-icon', 'aria-hidden': 'true' }],
    ['span', { class: 'lark-doc-unknown-card-text' },
      ['span', { class: 'lark-doc-unknown-card-title' }, title],
      ['span', { class: 'lark-doc-unknown-card-sub' }, sub]],
  ]
}

const CardEmbed = Node.create({
  name: 'cardEmbed',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addOptions() {
    return {
      /**
       * 动作冒泡通道（§3.5）：`onAction({ providerId, resourceId, actionId, payload, action })`。
       * 跳转 / 提交由宿主决定 —— 编辑器只转交，不持 token、不发请求。
       */
      onAction: null,
      /**
       * 认识的 providerId 列表（`null` = 全认，见 `core/embed/card.js` 的 `isKnownProvider`）。
       * 未声明的 providerId 走「未知卡片」占位，原 payload 原样保留。
       */
      providers: null,
    }
  },

  addAttributes() {
    return {
      card: {
        default: null,
        validate: validateAttribute('cardEmbed.card', safeCard),
        parseHTML: (el) => {
          const raw = el.getAttribute('data-card')
          return safeCard(raw) && raw ? raw : null
        },
        rendered: false,
      },
    }
  },

  // 只认自带标记；没有 `card` 数据的 DOM 一律拒收，让文档层退化成 unknown-block
  // 保留原文 —— 比渲染一张空卡诚实（同 webEmbed 对 src 的口径）。
  parseHTML() {
    return [{
      tag: 'div[data-type="card-embed"]',
      getAttrs: (el) => (safeCard(el.getAttribute('data-card')) && el.getAttribute('data-card') ? null : false),
    }]
  },

  addCommands() {
    return {
      setCardEmbed: (input) => ({ state, commands }) => {
        // 先过写路径：非法卡片在这里被拒（返回 false），不会走到「命令说成功、正文没块」。
        let card
        try { card = encodeCard(input) } catch (_) { return false }
        // 属性合不合法交给 schema validator；`insertContent` 遇到非法属性只打 warning
        // 然后照常返回 true，所以先 create 一遍探路（webEmbed / fileBlock 同口径）。
        try { state.schema.nodes[this.name].create({ card }) } catch (_) { return false }
        return commands.insertContent({ type: this.name, attrs: { card } })
      },
    }
  },

  renderHTML({ node }) {
    const attrs = node.attrs || {}
    const card = readCard(attrs.card)
    const wrapper = {
      class: 'lark-doc-card',
      'data-type': 'card-embed',
      'data-block-type': 'card',
      contenteditable: 'false',
    }
    // 自绘 renderHTML 不会自动合入全局属性，稳定块 id 要显式带上（同 image / webEmbed）。
    if (typeof attrs.blockId === 'string' && BLOCK_ID_PATTERN.test(attrs.blockId)) wrapper['data-block-id'] = attrs.blockId
    if (typeof attrs.card === 'string' && attrs.card) wrapper['data-card'] = attrs.card

    if (!card) return ['div', mergeAttributes(wrapper), placeholder('卡片数据缺失', '原始数据无法解析')]

    // 未知来源（宿主声明了 providers 且这张卡不在其中）：画占位卡，但 `data-card` 里
    // 原 payload 一个字节都不动 —— §3.5「不做 schema 迁移、不丢数据」。导出侧同一条
    // 逻辑：`this` 是 Tiptap 绑定的扩展上下文，`options` 与 NodeView 读到的是同一份。
    const providers = this && this.options ? this.options.providers : null
    if (!isKnownProvider(card.providerId, providers)) {
      return ['div', mergeAttributes(wrapper), placeholder('不支持的卡片来源', String(card.providerId || '未知来源'))]
    }

    const payload = card.payload && typeof card.payload === 'object' ? card.payload : {}
    const title = renderText(payload.title, RENDER_LIMITS.title)
    const desc = renderText(payload.desc, RENDER_LIMITS.desc)
    const fields = renderFields(payload)
    const actions = renderActions(card.actions)
    const cover = renderCover(payload.cover)

    // 版本比我们新：内容照画，但加一行「只读」说明 —— 动作按钮由 NodeView 关掉点击，
    // 导出侧保留文字（导出产物只是快照，不需要可点）。
    const notes = []
    if (isFutureCard(card)) notes.push(['p', { class: 'lark-doc-card-note' }, '该卡片由更高版本创建，当前仅可查看'])
    if (card.truncated === true) notes.push(['p', { class: 'lark-doc-card-note' }, '内容较大，此处只保留摘要'])

    const body = [['p', { class: 'lark-doc-card-title' }, title || '未命名卡片']]
    if (desc) body.push(['p', { class: 'lark-doc-card-desc' }, desc])
    if (fields.length) body.push(['dl', { class: 'lark-doc-card-fields' }, ...fields])

    const children = []
    if (cover) children.push(cover)
    children.push(['div', { class: 'lark-doc-card-body' }, ...body])
    if (actions.length) children.push(['div', { class: 'lark-doc-card-actions' }, ...actions])
    children.push(...notes)

    return ['div', mergeAttributes(wrapper), ...children]
  },

  // NodeView 先查注册表（三端可覆盖），没有再落 core 的纯 DOM 实现。
  addNodeView() { return getNodeView('cardEmbed') || createCardEmbedNodeView },
})

export { CardEmbed }
