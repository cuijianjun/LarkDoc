/**
 * 内嵌网页块 `webEmbed`（P3-01）。
 *
 * 规格来源 requirements/09 §3.4.1 + requirements/04 §4.3：
 *
 *   - 一个**原子块**，内部是 iframe，没有可编辑 contentDOM。飞书落的是
 *     `.docx-iframe-block`（`data-block-type="iframe"`），本仓库节点名取 `webEmbed`
 *     与 `cardEmbed`（09 §3.5）成对 —— 块类型名只在这一层出现，UI 里叫「内嵌网页」。
 *   - **正文/数据不进 JSON**：只存「打开它的钥匙」`src`（+ `providerId`）。
 *     iframe 里的内容是那个 app 的，协同 / 导出 / 体积对它都是零负担。
 *   - `height` 与 `aspect` 两者取一，**`height` 优先**（04 §4.3 实测默认 820×463，
 *     airtable 602、jcode 485 —— 所以尺寸必须能被 preset 覆盖，不能写死 463）。
 *   - `poster` 是快照兜底：只有它存在时，桥 3s 超时才降级成「图 + 在新窗口打开」；
 *     没有 poster 就保持飞书的「静默白块」（04 §4.3 ⑦ 实测：加载失败零反馈，
 *     **不许自己加错误态 UI**）。判据放在数据上，不放在 providerId 上。
 *
 * 与 `fileBlock` 的差别：文件块失败态**照常落块换文案**（用户要能下载），
 * 内嵌网页失败态**什么都不换**（内容在别人家的 iframe 里，宿主拿不到）。
 */
import { Node, mergeAttributes } from '@tiptap/core'
import { BLOCK_ID_PATTERN, safeUrl } from '../documentOperations'
import { validateAttribute } from './shared'
import { getNodeView } from '../nodeviews/registry'
import { createWebEmbedNodeView } from '../nodeviews/web-embed'
import {
  GENERIC_PROVIDER_ID, WEB_EMBED_MIN_HEIGHT, WEB_EMBED_MAX_HEIGHT,
  safeEmbedSrc,
} from '../embed/web-embed'

/**
 * 常量与判定函数的唯一出处是判定层 `core/embed/web-embed.js`（块定义与 NodeView 共用，
 * 两点互相 import 会成环 —— 先例 `core/media/file-block.js`）。这里原样再导一次：
 * 上层只需要认识 `registry/blocks.js` 一个入口，不用记 core 内部路径（P0-04 硬规则 1）。
 */
export {
  GENERIC_PROVIDER_ID, WEB_EMBED_DEFAULT_HEIGHT, WEB_EMBED_MIN_HEIGHT, WEB_EMBED_MAX_HEIGHT,
  WEB_EMBED_MAX_WIDTH, DEFAULT_EMBED_SANDBOX, DEFAULT_EMBED_ALLOW,
  safeEmbedSrc, resolveEmbedHeight, canRenderWebEmbed,
} from '../embed/web-embed'

/** `poster` 放宽到 `safeUrl(value, true)`：快照通常是 data URL，也允许远程图。 */
const safePoster = (value) => value === null || value === undefined || value === '' || safeUrl(value, true)

const safeTitle = (value) => value === null || value === undefined || (typeof value === 'string' && value.length <= 512 && !value.includes('\u0000'))

const safeProviderId = (value) => typeof value === 'string' && value.length > 0 && value.length <= 64
  && !Array.from(value).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)

const safeHeight = (value) => value === null || value === undefined
  || (Number.isFinite(Number(value)) && Number(value) >= WEB_EMBED_MIN_HEIGHT && Number(value) <= WEB_EMBED_MAX_HEIGHT)

const safeAspect = (value) => value === null || value === undefined
  || (Number.isFinite(Number(value)) && Number(value) > 0 && Number(value) <= 20)

const readAttr = (name) => (el) => {
  const value = el.getAttribute(name)
  return value === null || value === '' ? null : value
}

const readNumber = (name) => (el) => {
  const raw = el.getAttribute(name)
  if (raw === null || raw === '') return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

const WebEmbed = Node.create({
  name: 'webEmbed',
  group: 'block',
  // 内容在 iframe 里，没有可编辑 contentDOM；selectable 让点击选中整块，
  // 删除键一次删整块（与 fileBlock 同口径）。
  atom: true,
  draggable: true,
  selectable: true,

  addOptions() {
    return {
      /**
       * 出网策略闸门（P3-06 接线）。
       *
       * `canEmbed(src) => boolean`：返回 false 表示「按策略不许加载」。
       * 现在是 `null` = 不干预，保持 P3-01 之前的行为；P3-06 把
       * `network.mode: 'offline' / 'allowlist'` 注进来即可，core 不 import policy
       * （否则策略就成了 core 的硬依赖，三端想换一套策略得改 core）。
       */
      canEmbed: null,
      /**
       * sandbox / allow 的覆盖通道（默认值见 `core/embed/web-embed.js`）。
       * 留空就用安全基线，个别站点确需同源能力由 `EmbedDef.sandbox` 从数据层注进来。
       */
      sandbox: null,
      allow: null,
      /** 桥握手超时（ms）；不传用 `BRIDGE_TIMEOUT_MS`（3s）。 */
      bridgeTimeout: undefined,
      /** 桥回调：`onSetTitle(title, attrs)` / `onSave({ payload, attrs })`。 */
      onSetTitle: null,
      onSave: null,
    }
  },

  addAttributes() {
    return {
      // 命中的 EmbedDef.id；未命中恒为 'generic'（09 §3.4.1）。不允许为 null：
      // 一个「不知道是谁」的内嵌块连降级卡都画不出来。
      providerId: {
        default: GENERIC_PROVIDER_ID,
        validate: validateAttribute('webEmbed.providerId', safeProviderId),
        parseHTML: (el) => {
          const value = readAttr('data-provider-id')(el)
          return safeProviderId(value) ? value : GENERIC_PROVIDER_ID
        },
        rendered: false,
      },
      src: {
        default: null,
        validate: validateAttribute('webEmbed.src', safeEmbedSrc),
        parseHTML: (el) => {
          const value = el.getAttribute('data-src')
          return value && safeEmbedSrc(value) ? value : null
        },
        rendered: false,
      },
      title: {
        default: null,
        validate: validateAttribute('webEmbed.title', safeTitle),
        parseHTML: readAttr('data-title'),
        rendered: false,
      },
      // 三者取一：height 优先，其次 aspect，最后 463。都为空是合法状态
      // （preset 没给尺寸的站点走默认），不要在这里塞默认值把 JSON 撑出噪音字段。
      height: {
        default: null,
        validate: validateAttribute('webEmbed.height', safeHeight),
        parseHTML: readNumber('data-height'),
        rendered: false,
      },
      aspect: {
        default: null,
        validate: validateAttribute('webEmbed.aspect', safeAspect),
        parseHTML: readNumber('data-aspect'),
        rendered: false,
      },
      poster: {
        default: null,
        validate: validateAttribute('webEmbed.poster', safePoster),
        parseHTML: (el) => {
          const value = el.getAttribute('data-poster')
          return value && safePoster(value) ? value : null
        },
        rendered: false,
      },
      // 渲染时的桥版本，用于兼容老 iframe（09 §3.4.2 版本协商）。落进 JSON 是因为
      // 同一份文档可能被不同版本的宿主打开过，读侧据此决定降级策略。
      bridgeVersion: {
        default: 1,
        validate: validateAttribute('webEmbed.bridgeVersion', (value) => Number.isInteger(value) && value >= 1 && value <= 99),
        parseHTML: (el) => {
          const value = Number(el.getAttribute('data-bridge-version'))
          return Number.isInteger(value) && value >= 1 && value <= 99 ? value : 1
        },
        rendered: false,
      },
    }
  },

  // 只认自带标记：`data-type="web-embed"` 是本仓库约定，`data-block-type="iframe"`
  // 是飞书块的块类型标记。没有可用 `src` 的节点一律拒收 —— 让文档层退化成
  // unknown-block 保留原文，比渲染一个空白框诚实。
  parseHTML() {
    return [{
      tag: 'figure[data-type="web-embed"]',
      getAttrs: (el) => (safeEmbedSrc(el.getAttribute('data-src')) && el.getAttribute('data-src') ? null : false),
    }]
  },

  addCommands() {
    return {
      setWebEmbed: (attrs) => ({ state, commands }) => {
        if (!attrs || !attrs.src || !safeEmbedSrc(attrs.src)) return false
        // 属性合不合法交给 schema validator 判：`insertContent` 遇到非法属性只打一条
        // warning 然后**照常返回 true**，不先 `create` 一遍就会「命令说成功、正文空」。
        const next = { ...attrs, providerId: attrs.providerId || GENERIC_PROVIDER_ID }
        try { state.schema.nodes[this.name].create(next) } catch (_) { return false }
        return commands.insertContent({ type: this.name, attrs: next })
      },
    }
  },

  renderHTML({ node }) {
    const attrs = node.attrs || {}
    const figure = {
      class: 'lark-doc-embed docx-iframe-block',
      'data-type': 'web-embed',
      'data-block-type': 'iframe',
    }
    // 自绘 renderHTML 不会自动合入全局属性，稳定块 id 要显式带上（同 image / fileBlock）。
    if (typeof attrs.blockId === 'string' && BLOCK_ID_PATTERN.test(attrs.blockId)) figure['data-block-id'] = attrs.blockId
    figure['data-provider-id'] = safeProviderId(attrs.providerId) ? attrs.providerId : GENERIC_PROVIDER_ID
    if (attrs.src && safeEmbedSrc(attrs.src)) figure['data-src'] = attrs.src
    if (attrs.title) figure['data-title'] = attrs.title
    if (safeHeight(attrs.height) && attrs.height !== null) figure['data-height'] = String(attrs.height)
    if (safeAspect(attrs.aspect) && attrs.aspect !== null) figure['data-aspect'] = String(attrs.aspect)
    if (attrs.poster && safePoster(attrs.poster)) figure['data-poster'] = attrs.poster
    figure['data-bridge-version'] = String(Number.isInteger(attrs.bridgeVersion) ? attrs.bridgeVersion : 1)
    return ['figure', mergeAttributes(figure)]
  },

  // NodeView 先查注册表（三端可覆盖），没有再落 core 的纯 DOM 实现。
  addNodeView() { return getNodeView('webEmbed') || createWebEmbedNodeView },
})

export { WebEmbed }
