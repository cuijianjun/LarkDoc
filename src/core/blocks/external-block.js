/**
 * 外部服务块 `externalBlock`（17 §17.5 的 tier C / P3 批次：chat_card / mindnote /
 * task / okr* / jira_issue / agenda* / board / whiteboard / view / diagram / synced）。
 *
 * 为什么收成一个节点而不是十一（二十二）个：见 `core/embed/external-block.js` 头注。
 * 一句话复述 —— 这批块的正文形态由**外部服务**决定，本地能给的只有一张「钥匙卡」：
 *   - `kind` 认得出是哪一类（22 个官方 type，归 11 个块族）；
 *   - `payload` 逐字节留着原始块 JSON（与 `unknownBlock` 同款保真通道）；
 *   - `status` / `reason` 给出**可解释的 disabled 状态**（§17.5 表下说明要求）。
 *
 * 与 `unknownBlock` 的边界：unknownBlock = 认不出来（type 不在目录里）；
 * externalBlock = 认得出但没接服务。两者都能读、能删、能保真，差别只在卡片文案。
 *
 * 接入路径留给宿主：服务接上后把 `status` 推到 `ready`（标准 `updateAttributes` 即可），
 * 需要真 iframe / canvas 时再挂 NodeView —— 节点与 JSON 形状不变，不用迁移数据。
 */
import { Node, mergeAttributes } from '@tiptap/core'
import { safeUrl } from '../documentOperations'
import { validateAttribute } from './shared'
import {
  EXTERNAL_STATUS, EXTERNAL_STATUS_LABELS,
  externalBlockMeta, externalBlockReason,
  safeExternalKind, safeExternalProvider, safeExternalStatus,
  safeExternalTitle, safeExternalPayload,
} from '../embed/external-block'

/**
 * 目录层常量与判定函数原样再导一次（先例 `core/blocks/isv.js`）：上层只认识
 * `registry/blocks.js` 一个入口，不用记 core 内部路径（P0-04 硬规则 1）。
 * 「哪一类能做什么」必须从这里取，不许按 kind 字符串自己 if。
 */
export {
  EXTERNAL_BLOCK_FAMILIES, EXTERNAL_BLOCK_GENERIC, EXTERNAL_BLOCK_KINDS,
  EXTERNAL_PROVIDER_LABELS, EXTERNAL_PAYLOAD_MAX, EXTERNAL_STATUS, EXTERNAL_STATUS_LABELS,
  EXTERNAL_STATUSES, ERR_PROVIDER_REQUIRED, ERR_UNSUPPORTED_OPERATION,
  externalBlockCapabilities, externalBlockCapability, externalBlockMeta,
  externalBlockPreview, externalBlockReason, isExternalBlockType, isExternalKind,
  normalizeExternalBlock,
} from '../embed/external-block'

/** payload 超过这个长度就不进 DOM：1M 的原始 JSON 挂成属性会把渲染拖死，保真仍走 JSON。 */
const DOM_PAYLOAD_MAX = 8000

const readAttr = (name, fallback = '') => (el) => el.getAttribute(name) || fallback

const ExternalBlock = Node.create({
  name: 'externalBlock',
  group: 'block',
  // 未接入时卡片没有可编辑区域；`selectable` 让点击选中整块、删除键一次删整块
  // （与 unknownBlock / isv / webEmbed 同口径）。
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      /** 官方/实机 block type 名（目录 see `core/embed/external-block.js`）；空串 = 兜底「外部内容块」。 */
      kind: {
        default: '',
        validate: validateAttribute('externalBlock.kind', safeExternalKind),
        parseHTML: (el) => {
          const value = readAttr('data-external-kind')(el)
          return safeExternalKind(value) ? value : ''
        },
        renderHTML: (attrs) => ({ 'data-external-kind': attrs.kind || '' }),
      },
      /** 原始块 JSON（逐字节保真，导出侧还原）。与 unknownBlock.payload 同上限同口径。 */
      payload: {
        default: '',
        validate: validateAttribute('externalBlock.payload', safeExternalPayload),
        parseHTML: readAttr('data-external-payload'),
        renderHTML: (attrs) => (
          typeof attrs.payload === 'string' && attrs.payload.length <= DOM_PAYLOAD_MAX
            ? { 'data-external-payload': attrs.payload }
            : {}
        ),
      },
      /** 卡片副标题（从原始 JSON 浅摘，纯展示，丢了不影响保真）。 */
      title: {
        default: '',
        validate: validateAttribute('externalBlock.title', safeExternalTitle),
        parseHTML: readAttr('data-external-title'),
        renderHTML: (attrs) => (attrs.title ? { 'data-external-title': attrs.title } : {}),
      },
      /** 源地址（外部对象在哪）：只存钥匙，不拉内容。 */
      sourceUrl: {
        default: '',
        validate: validateAttribute('externalBlock.sourceUrl', (value) => value === '' || safeUrl(value)),
        parseHTML: readAttr('data-external-url'),
        renderHTML: (attrs) => (attrs.sourceUrl ? { 'data-external-url': attrs.sourceUrl } : {}),
      },
      /** 该 kind 归哪个服务（jira / okr / wiki…），卡片文案与能力判定都用它。 */
      provider: {
        default: '',
        validate: validateAttribute('externalBlock.provider', (value) => value === '' || safeExternalProvider(value)),
        parseHTML: readAttr('data-external-provider'),
        renderHTML: (attrs) => (attrs.provider ? { 'data-external-provider': attrs.provider } : {}),
      },
      /** 接入状态：unavailable（默认）/ readonly / ready。 */
      status: {
        default: EXTERNAL_STATUS.UNAVAILABLE,
        validate: validateAttribute('externalBlock.status', safeExternalStatus),
        parseHTML: (el) => {
          const value = readAttr('data-external-status')(el)
          return safeExternalStatus(value) ? value : EXTERNAL_STATUS.UNAVAILABLE
        },
        renderHTML: (attrs) => ({ 'data-external-status': attrs.status || EXTERNAL_STATUS.UNAVAILABLE }),
      },
      /** 宿主可覆写的解释文案（「Jira 未接入」这类）；空串时由 `externalBlockReason` 派生。 */
      reason: {
        default: '',
        validate: validateAttribute('externalBlock.reason', safeExternalTitle),
        parseHTML: readAttr('data-external-reason'),
        renderHTML: (attrs) => (attrs.reason ? { 'data-external-reason': attrs.reason } : {}),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="external-block"]' }]
  },

  // ⚠️ 子 spec 必须**展平**成 `['div', attrs, childA, childB]`（与 unknown-block.js 同一
  // 条踩坑：收成嵌套数组只在序列化时炸 `RangeError: Invalid array passed to renderSpec`，
  // 编辑器里看不出来）。
  //
  // ⚠️ 必须把 `HTMLAttributes` 合进根节点：它才是各 attribute 的 renderHTML 汇总
  // （data-external-kind / payload / status…）。漏了它，卡片在编辑器里看着一样，但
  // 复制出的 HTML、getHTML()、导出里这些属性全是空的 —— 保真只走 JSON 通道，
  // 一走 HTML 就丢卡片的身份与状态。
  renderHTML({ node, HTMLAttributes }) {
    const attrs = node.attrs || {}
    const meta = externalBlockMeta(attrs.kind)
    const status = attrs.status || EXTERNAL_STATUS.UNAVAILABLE
    const reason = attrs.reason || externalBlockReason(attrs.kind, status)
    const children = [
      ['span', { class: 'lark-doc-external-card-icon', 'aria-hidden': 'true' }],
      ['span', { class: 'lark-doc-external-card-text' },
        ['span', { class: 'lark-doc-external-card-title' }, attrs.title || meta.label],
        ['span', { class: 'lark-doc-external-card-sub' }, reason]],
    ]
    if (attrs.title) {
      children.push(['span', { class: 'lark-doc-external-card-kind' }, meta.label])
    }
    children.push(['span', { class: 'lark-doc-external-card-badge' }, EXTERNAL_STATUS_LABELS[status]])
    return ['div', mergeAttributes(HTMLAttributes, {
      'data-type': 'external-block',
      class: 'lark-doc-external-card',
      // 供宿主 CSS 按族定制图标 / 配色；不在 core 里内联样式（主题 token 门禁）。
      'data-external-family': meta.family,
    }), ...children]
  },
})

export { ExternalBlock }
