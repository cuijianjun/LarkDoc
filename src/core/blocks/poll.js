/**
 * 投票块 `poll`（P5-03）—— requirements/02 §23（DOM / 几何 / 时序）、§19.1 ⑥（数据模型）。
 *
 *   - **原子块**，正文里只占一个节点，内容全画在 DOM 里（不用 iframe）：可被评论锚定、
 *     可参与协同、可整体选中拖动（§23：`draggable`）。
 *   - 只存**一个** `poll` 属性（JSON 字符串，形状见 `./poll-render.js`）。不拆
 *     `title` / `options` / `multiple` 多个 attrs：这些字段必须**原子地**一起变
 *     （发布时 published 翻真、选项票数同步刷新），拆开后中间态会渲染出「已发布但票数
 *     对不上」的残影。
 *   - `renderHTML` **同时是导出产物**（`getHTML()` / PDF / DOCX 都走它）。所以这里画的是
 *     一张**只读**的投票卡：标题 + 标签 + 选项 + 结果条 + 按钮文案。编辑态的
 *     textarea / 开关 / 加删按钮在 NodeView 里建（`../nodeviews/poll.js`）—— 导出件里
 *     出现输入框才是错的。
 *
 * 🔴 V1 范围（已拍板，别顺手扩张）：编辑态 + 本地状态机 + 结果条。
 *   不做：日期选择器日历、header「更多」菜单三态、任何真实请求。
 *   详见 `./poll-render.js` 文件头。
 */
import { Node, mergeAttributes } from '@tiptap/core'
import { BLOCK_ID_PATTERN } from '../documentOperations'
import { validateAttribute } from './shared'
import { getNodeView } from '../nodeviews/registry'
import { createPollNodeView } from '../nodeviews/poll'
import { utf8Bytes } from '../embed/card'
import {
  POLL_LIMITS, defaultPoll, encodePoll, formatPercent, headerLabels, readPoll, tally,
} from './poll-render'

/**
 * 判定层与块定义同源：几何常量与纯函数都在 `./poll-render.js`，这里原样再导一次，
 * 上层只认 `registry/blocks.js` 一个入口（P0-04 硬规则 1）。
 */
export {
  POLL_GEOMETRY, POLL_HEIGHT, POLL_LIMITS, POLL_STATUS, POLL_VERSION,
  blockHeight, byteLength, canVote, cleanText, deadlineLabel, defaultPoll, encodePoll,
  formatPercent, headerLabels, normalizePoll, optionLabel, pollReducer, pollStatus,
  publishHint, publishReady, readPoll, tally, tomorrowDeadline,
} from './poll-render'

/**
 * `attrs.poll` 的合法性 = 「能解析成 poll 对象」且「不超过 32 KB」。
 *
 * 允许 `null`（`default`）：atom 节点在 `create()` 时可能还没拿到数据，渲染层把 null
 * 画成占位块而不是在这里拒收 —— 否则「节点建不出来」比「渲染一块占位」更难排查。
 */
const safePoll = (value) => value === null || value === undefined
  || (typeof value === 'string' && utf8Bytes(value) <= POLL_LIMITS.bytes && readPoll(value) !== null)

/** 标签的色调类名。`tone` 只有三种，CSS 里各有一条规则。 */
const labelClass = (tone) => `lark-doc-poll-label lark-doc-poll-label--${tone || 'accent'}`

/**
 * header 的标签行。
 *
 * 顺序与配色全由 `headerLabels()` 决定（票数 tag 在截止 chip **之前**，§23 实测），
 * 这里只负责把 `tone` 翻成类名 —— 别在这层再排一次序。
 */
function staticLabels(poll) {
  return headerLabels(poll).map((label) => ['span', { class: labelClass(label.tone) }, label.text])
}

/** footer 文案：未发布是「发布投票」，发布后是「立即投票」（§23）。 */
function footerText(poll) {
  return poll.published ? '立即投票' : '发布投票'
}

/** 只读选项行：已投票时带结果条所需的票数与百分比。 */
function staticOption(row, withResult) {
  const children = [
    ['span', { class: 'lark-doc-poll-option-key' }, row.label],
    ['span', { class: 'lark-doc-poll-option-text' }, row.text],
  ]
  if (!withResult) return ['li', { class: 'lark-doc-poll-option' }, ...children]
  children.push(['span', { class: 'lark-doc-poll-option-count' }, `${row.votes} 票`])
  children.push(['span', { class: 'lark-doc-poll-option-percent' }, formatPercent(row.percent)])
  return ['li', {
    class: `lark-doc-poll-option${row.chosen ? ' is-chosen' : ''}`,
    'data-votes': String(row.votes),
  }, ...children]
}

/**
 * 结果条。
 *
 * 宽度按真实票数占比写进行内样式（进度条是**数据**不是装饰，CSS 给不出这个值）。
 * 颜色一律走类名 → token，别在 JS 里写色值（`check-theme-tokens.js` 会拦）。
 */
function staticProgress(rows) {
  return ['div', { class: 'lark-doc-poll-progress' }, ...rows.map((row) => ['div', {
    class: `lark-doc-poll-progress-track${row.chosen ? ' is-chosen' : ''}`,
    'data-option': row.id,
  }, ['div', {
    class: 'lark-doc-poll-progress-bar',
    style: `width:${row.width.toFixed(4)}%`,
  }]])]
}

/** 只读投票卡 —— 导出产物，也是编辑器里的「静态底」。 */
function renderStaticCard(poll) {
  const { rows } = tally(poll)
  // 结果条只在**投过票**时出现（§23：未投票的已发布卡片仍是纯选项列表，228 高）。
  const withResult = poll.voted.length > 0
  const body = [['ul', { class: 'lark-doc-poll-options' }, ...rows.map((row) => staticOption(row, withResult))]]
  if (withResult) body.push(staticProgress(rows))
  return ['div', { class: 'lark-doc-poll-card' },
    ['div', { class: 'lark-doc-poll-header' },
      ['div', { class: 'lark-doc-poll-title' }, poll.title || '投票主题'],
      ['div', { class: 'lark-doc-poll-labels' }, ...staticLabels(poll)]],
    ['div', { class: 'lark-doc-poll-content' }, ...body],
    ['div', { class: 'lark-doc-poll-footer' },
      ['span', { class: `lark-doc-poll-submit${poll.published ? '' : ' is-draft'}` }, footerText(poll)]]]
}

const Poll = Node.create({
  name: 'poll',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addOptions() {
    return {
      /**
       * header「更多」菜单的点击通道：`onMenu({ blockId, pos })`。
       * V1 只转交、不自己开菜单 —— 编辑器不认识宿主的块菜单面板（同 `sheet`）。
       */
      onMenu: null,
      /**
       * 投票后的通知：`onVote({ blockId, ids, poll })`。
       *
       * 本地状态机已经把票记进 `attrs.poll.votes`，这个回调只是让宿主有机会同步到
       * 服务端。宿主不接也完全可用（V1 默认路径）。
       */
      onVote: null,
    }
  },

  addAttributes() {
    return {
      poll: {
        default: null,
        validate: validateAttribute('poll.poll', safePoll),
        parseHTML: (el) => {
          const raw = el.getAttribute('data-poll')
          return safePoll(raw) && raw ? raw : null
        },
        rendered: false,
      },
    }
  },

  // 只认自带标记；没有 `poll` 数据的 DOM 一律拒收，让文档层退化成 unknown-block
  // 保留原文 —— 比渲染一块空壳卡片诚实（同 sheet / cardEmbed / webEmbed 口径）。
  parseHTML() {
    return [{
      tag: 'div[data-type="poll"]',
      getAttrs: (el) => (safePoll(el.getAttribute('data-poll')) && el.getAttribute('data-poll') ? null : false),
    }]
  },

  addCommands() {
    return {
      /**
       * 插入一个投票块。无参 = 默认空投票（空标题 + 两个空选项，`defaultPoll()`）。
       *
       * 斜杠菜单「投票」与 `+` 菜单都走这一个入口（§23：插入**无配置面板**，
       * 落块后直接在块内输入）。
       */
      setPoll: (input) => ({ state, commands }) => {
        // 先过写路径：超 32 KB / 字段越界在这里被拒（返回 false），
        // 不会走到「命令说成功、正文没块」。
        let poll
        try { poll = encodePoll(input === undefined || input === null ? defaultPoll() : input) } catch (_) { return false }
        // `insertContent` 遇到非法属性只打 warning 然后照常返回 true，
        // 所以先 create 一遍探路（setSheet / cardEmbed / webEmbed 同口径）。
        try { state.schema.nodes[this.name].create({ poll }) } catch (_) { return false }
        return commands.insertContent({ type: this.name, attrs: { poll } })
      },

      /**
       * 改写已有投票块的数据。**编辑态的全部写入都走这里**：输入标题 / 输入选项 /
       * 加删选项 / 拨开关 / 发布 / 投票 —— NodeView 里跑一遍 `pollReducer` 再把结果交过来。
       *
       * `pos` 是块位置。校验顺序照 `setPoll`：先 encode、再 find 节点、最后 setNodeMarkup。
       */
      updatePoll: (input) => ({ state, tr }) => {
        const patch = input && typeof input === 'object' ? input : {}
        if (!Number.isInteger(patch.pos)) return false
        // 越界 pos 会让 `nodeAt` 抛 RangeError（不是返回 null）—— 先自己挡一道，
        // 否则宿主同步一份对不上位置的补丁时整个编辑器会崩。
        if (patch.pos < 0 || patch.pos > state.doc.content.size) return false
        const current = state.doc.nodeAt(patch.pos)
        if (!current || current.type.name !== this.name) return false
        let poll
        try { poll = encodePoll(patch.poll) } catch (_) { return false }
        try { state.schema.nodes[this.name].create(Object.assign({}, current.attrs, { poll })) } catch (_) { return false }
        tr.setNodeMarkup(patch.pos, null, Object.assign({}, current.attrs, { poll }))
        return true
      },
    }
  },

  renderHTML({ node }) {
    const attrs = node.attrs || {}
    const poll = readPoll(attrs.poll)
    const wrapper = {
      class: 'lark-doc-poll',
      'data-type': 'poll',
      'data-block-type': 'poll',
      contenteditable: 'false',
    }
    // 自绘 renderHTML 不会自动合入全局属性，稳定块 id 要显式带上（同 image / sheet）。
    if (typeof attrs.blockId === 'string' && BLOCK_ID_PATTERN.test(attrs.blockId)) wrapper['data-block-id'] = attrs.blockId
    if (typeof attrs.poll === 'string' && attrs.poll) wrapper['data-poll'] = attrs.poll

    // 数据缺失：画占位而不是空白 —— 导出件里一块白比一句说明更难定位问题。
    if (!poll) {
      return ['div', mergeAttributes(wrapper),
        ['p', { class: 'lark-doc-poll-empty' }, '投票数据缺失']]
    }
    return ['div', mergeAttributes(wrapper), renderStaticCard(poll)]
  },

  // NodeView 先查注册表（三端可覆盖），没有再落 core 的纯 DOM 实现。
  addNodeView() { return getNodeView('poll') || createPollNodeView },
})

export { Poll }
export default Poll
