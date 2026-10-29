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
import { Plugin } from '@tiptap/pm/state'
import { safeUrl } from '../documentOperations'
import { validateAttribute } from './shared'
import {
  EXTERNAL_STATUS,
  externalBlockMeta, externalBlockReason,
  safeExternalKind, safeExternalProvider, safeExternalStatus,
  safeExternalTitle, safeExternalPayload,
} from '../embed/external-block'
import {
  externalBlockStatus, externalBlockStatusHint, externalBlockStatusLabel,
} from '../embed/provider-registry'

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
    // 有效状态取**运行时**（registry），不取节点上的 `status` attr：文档可能从别的机器带来
    // `status: 'ready'`，但本机没注册 provider 时它其实点不动 —— 挂「已接入」角标比诚实地说
    // 未接入更糟（`externalBlockStatus()` 的注释）。`status` attr 仍原样留在 JSON 里（保真）。
    const status = externalBlockStatus(attrs.kind)
    const reason = attrs.reason || externalBlockReason(attrs.kind, status)
    const badge = externalBlockStatusLabel(attrs.kind)
    const children = [
      ['span', { class: 'lark-doc-external-card-icon', 'aria-hidden': 'true' }],
      ['span', { class: 'lark-doc-external-card-text' },
        ['span', { class: 'lark-doc-external-card-title' }, attrs.title || meta.label],
        ['span', { class: 'lark-doc-external-card-sub' }, reason]],
    ]
    if (attrs.title) {
      children.push(['span', { class: 'lark-doc-external-card-kind' }, meta.label])
    }
    // `ready` 时 `externalBlockStatusLabel()` 返回空串 —— 服务正常就不该有角标占住右上角。
    if (badge) {
      // 短标给人扫，完整句子给悬浮与读屏（「哪个服务、现在怎么了」）。两句话都出自
      // registry，组件这边不许再判一次状态，否则文案会跟闸门漂。
      const hint = externalBlockStatusHint(attrs.kind)
      children.push(['span', {
        class: 'lark-doc-external-card-badge',
        'data-external-badge': status,
        title: hint,
        'aria-label': hint,
      }, badge])
    }
    const root = mergeAttributes(HTMLAttributes, {
      'data-type': 'external-block',
      class: 'lark-doc-external-card',
      // 供宿主 CSS 按族定制图标 / 配色；不在 core 里内联样式（主题 token 门禁）。
      'data-external-family': meta.family,
      // 这一个属性就是卡片「可用 / 不可用」的**唯一**视觉开关（lark-doc.css 里由它把
      // 虚线描边转实线），所以写运行时状态而不是 attr 里的声明。
      'data-external-status': status,
    })
    // fallback 语义（§17.5）：`readonly` 可选中可复制不可编辑；`unavailable` 连输入都不该有。
    // 两档都钉 `contenteditable="false"` —— PM 对非文本节点本来就会补这一句，但显式写出来
    // 它才会跟着 getHTML / 复制 / 导出一路走下去（复制出去的 HTML 也不该是可编辑的错觉）。
    if (status !== EXTERNAL_STATUS.READY) {
      root.contenteditable = 'false'
      root['data-external-locked'] = status
      if (status === EXTERNAL_STATUS.UNAVAILABLE) root['aria-disabled'] = 'true'
    }
    return ['div', root, ...children]
  },

  /**
   * 「只读 = 改不动」不能只靠 `contenteditable`：中文输入法、移动端长按、拖放都会绕过它
   * 直接派发 `beforeinput`。这里在卡片内部把事件吃掉，正文一个字符都不动。
   *
   * 注意与 `Delete` 的关系：本插件只挡**输入**，不挡删除。删除走
   * `external-delete.js` 的键盘收口（§17.5：Delete 对块一律放行，统一走
   * `BlockModuleAPI.remove`）—— 未接入的卡片也必须能删掉。
   */
  addProseMirrorPlugins() {
    return [new Plugin({
      props: {
        handleDOMEvents: {
          beforeinput: (view, event) => {
            const locked = lockedCardOf(event.target)
            if (!locked) return false
            event.preventDefault()
            return true
          },
        },
      },
    })]
  },
})

/** 事件目标是否落在只读 / 未接入的卡片里；返回那张卡片（没有则 null）。 */
function lockedCardOf(target) {
  if (!target || target.nodeType !== 1) return null
  const card = target.closest?.('[data-type="external-block"][data-external-locked]')
  return card || null
}

export { ExternalBlock }
