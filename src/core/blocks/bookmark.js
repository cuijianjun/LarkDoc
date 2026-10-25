/**
 * 网页卡片块 `bookmark`（P3-05）—— requirements/02 §24、09 §633。
 *
 * 与 `cardEmbed`（P3-04）的关系：**同一个 chrome，不同的事**。
 *   - `cardEmbed` 存一整份结构化 payload（provider 定义的卡片），谁来画由 provider 决定；
 *   - `bookmark` 只存「一个 URL + 三条抓取回来的元数据」，形状固定，不需要 provider 契约，
 *     抓取器是**第 6 个可选 provider**（`providers/unfurl`），缺失时降级成纯链接卡。
 *
 * 四条硬口径（02 §24 实测，别按直觉改）：
 *
 *   1. **类型名是 `bookmark`，不是 `link_preview`**（batch319 D6 定判）。
 *   2. **卡内没有 `a` / `button`**：整卡点击走 `window.open`（NodeView 实现），导出产物里
 *      不塞任何可交互元素 —— 否则 PDF / DOCX 里就是一堆假链接。
 *   3. **favicon 是 `span` + inline `background-image`**，且**没有 favicon 时该 span 不渲染**
 *      （不是透明占位，URL 也不左移）。
 *   4. **两档高度是内容长出来的**：74（无摘要）/ 113（有摘要），不写死 `height`。
 *
 * `renderHTML` 同时是导出产物，NodeView 直接复用（`DOMSerializer.serializeNode`），
 * 保证「编辑器里看到什么 = 导出的是什么」（同 `cardEmbed` 的理由）。
 */
import { Node, mergeAttributes } from '@tiptap/core'
import { BLOCK_ID_PATTERN } from '../documentOperations'
import { validateAttribute } from './shared'
import { getNodeView } from '../nodeviews/registry'
import { createBookmarkNodeView } from '../nodeviews/bookmark'
import {
  BOOKMARK_LIMITS, BOOKMARK_VARIANT, RECORD_ID_PATTERN,
  normalizeBookmark, readBookmark, readBookmarkUrl, renderBookmarkCard,
} from '../embed/bookmark'

/**
 * 判定层与块定义同源：契约常量、读路径、markup 全在 `core/embed/bookmark.js`，
 * 这里原样再导一次，上层只认 `registry/blocks.js` 一个入口（P0-04 硬规则 1）。
 */
export {
  BOOKMARK_HEIGHTS, BOOKMARK_LIMITS, BOOKMARK_VARIANT, BOOKMARK_VERSION,
  RECORD_ID_PATTERN, createRecordId, normalizeBookmark, readBookmark, readBookmarkHost,
  readBookmarkMeta, readBookmarkUrl, renderBookmarkCard,
} from '../embed/bookmark'

const safeText = (limit) => (value) => value === null || value === undefined
  || (typeof value === 'string' && Array.from(value).length <= limit && !value.includes('\u0000'))

/** favicon / 封面走 `background-image`，只认 http(s)；`data:` 不给（远端抓回的地址不该带 payload）。 */
const safeMetaUrl = (value) => value === null || value === undefined || value === ''
  || readBookmarkUrl(value) !== null

const safeRecordId = (value) => value === null || value === undefined || value === ''
  || (typeof value === 'string' && RECORD_ID_PATTERN.test(value))

const readAttr = (name) => (el) => {
  const value = el.getAttribute(name)
  return value === null || value === '' ? null : value
}

const readUrlAttr = (name) => (el) => {
  const value = el.getAttribute(name)
  return value && readBookmarkUrl(value) ? value : null
}

const Bookmark = Node.create({
  name: 'bookmark',
  group: 'block',
  // 卡片内容不可编辑（没有 contentDOM）：整块选中、一次删掉（同 cardEmbed / webEmbed）。
  atom: true,
  draggable: true,
  selectable: true,

  addOptions() {
    return {
      /**
       * 抓取通道（09 §265）：宿主传 `createUnfurlProvider(...)` 的返回值，或任意
       * `{ unfurl(url) => Promise<meta> }`。`null` = 没有抓取器，卡片降级成
       * 「URL + 域名标题」的简卡 —— 这是**正常路径**，不是错误（02 §24 ③-ter：
       * 飞书抓取失败也是同一张卡，无文案、无重试、无 toast）。
       */
      unfurl: null,
      /**
       * 打开链接的通道：`onOpen({ url, recordId })`。不传就自己 `window.open`，
       * 与飞书一致（卡内没有 `a`，点击由 JS 打开）。
       */
      onOpen: null,
    }
  },

  addAttributes() {
    return {
      url: {
        default: null,
        validate: validateAttribute('bookmark.url', (value) => value === null || readBookmarkUrl(value) !== null),
        parseHTML: readUrlAttr('data-url'),
        rendered: false,
      },
      title: {
        default: null,
        validate: validateAttribute('bookmark.title', safeText(BOOKMARK_LIMITS.title)),
        parseHTML: readAttr('data-title'),
        rendered: false,
      },
      desc: {
        default: null,
        validate: validateAttribute('bookmark.desc', safeText(BOOKMARK_LIMITS.desc)),
        parseHTML: readAttr('data-desc'),
        rendered: false,
      },
      favicon: {
        default: null,
        validate: validateAttribute('bookmark.favicon', safeMetaUrl),
        parseHTML: readUrlAttr('data-favicon'),
        rendered: false,
      },
      // 飞书的 `data-record-id`：一条抓取记录的标识，**每卡唯一**，不参与渲染判定。
      // 留着是为了「重新抓取」能对上同一条记录（也是导出的稳定锚点之一）。
      recordId: {
        default: null,
        validate: validateAttribute('bookmark.recordId', safeRecordId),
        parseHTML: readAttr('data-record-id'),
        rendered: false,
      },
    }
  },

  // 只认自带标记；没有合法 `data-url` 的 DOM 一律拒收，让文档层退化成 unknown-block
  // 保留原文 —— 比渲染一张空卡诚实（同 webEmbed 的 src 口径）。
  parseHTML() {
    const accept = (el) => {
      const url = readBookmarkUrl(el.getAttribute('data-url'))
      return url ? null : false
    }
    return [
      { tag: 'div[data-type="bookmark"]', getAttrs: accept },
      // 飞书原生块（`.docx-bookmark-block` + `data-block-type="bookmark"`）粘贴进来时的入口。
      { tag: 'div.docx-bookmark-block[data-block-type="bookmark"]', getAttrs: accept },
    ]
  },

  addCommands() {
    return {
      /**
       * 插入一张网页卡片。
       *
       * `input` 可直接吃 `resolveEmbed()` 的出口（`{ kind: 'bookmark', attrs: { src } }`），
       * 所以「粘贴一个没有 preset 的链接」只有一条代码路径（`normalizeBookmark` 认 `src`）。
       */
      setBookmark: (input) => ({ state, commands }) => {
        const bookmark = normalizeBookmark(input)
        if (!bookmark) return false
        // `insertContent` 遇到非法属性只打 warning 然后照常返回 true，
        // 所以先 create 一遍探路（webEmbed / cardEmbed 同口径）。
        try { state.schema.nodes[this.name].create(bookmark) } catch (_) { return false }
        return commands.insertContent({ type: this.name, attrs: bookmark })
      },

      /**
       * 回写抓取结果（宿主 `/api/docx/bookmark/unfurl` 回来后调，或 NodeView 自己调）。
       * 按 `recordId` 定位而不是位置：抓取是异步的，等回来时块可能已经被搬走。
       */
      updateBookmarkMeta: (input) => ({ state, tr }) => {
        const source = input && typeof input === 'object' ? input : {}
        const recordId = typeof source.recordId === 'string' ? source.recordId : ''
        if (!recordId || !RECORD_ID_PATTERN.test(recordId)) return false
        const patched = []
        state.doc.descendants((node, pos) => {
          if (node.type.name !== this.name) return true
          if ((node.attrs || {}).recordId !== recordId) return true
          patched.push({ node, pos })
          return false
        })
        if (!patched.length) return false
        let changed = false
        patched.forEach(({ node, pos }) => {
          const attrs = node.attrs || {}
          const next = {}
          if (typeof source.title === 'string' && source.title && source.title !== attrs.title) next.title = source.title
          if (typeof source.desc === 'string' && source.desc && source.desc !== attrs.desc) next.desc = source.desc
          const favicon = readBookmarkUrl(source.favicon)
          if (favicon && favicon !== attrs.favicon) next.favicon = favicon
          if (!Object.keys(next).length) return
          tr.setNodeMarkup(pos, undefined, { ...attrs, ...next })
          changed = true
        })
        return changed
      },
    }
  },

  renderHTML({ node }) {
    const attrs = node.attrs || {}
    const bookmark = readBookmark(attrs)
    const root = {
      class: 'lark-doc-bookmark docx-bookmark-block',
      'data-type': 'bookmark',
      'data-block-type': 'bookmark',
      contenteditable: 'false',
    }
    // 自绘 renderHTML 不会自动合入全局属性，稳定块 id 要显式带上（同 image / cardEmbed）。
    if (typeof attrs.blockId === 'string' && BLOCK_ID_PATTERN.test(attrs.blockId)) root['data-block-id'] = attrs.blockId
    if (typeof attrs.recordId === 'string' && RECORD_ID_PATTERN.test(attrs.recordId)) root['data-record-id'] = attrs.recordId
    if (bookmark) root['data-url'] = bookmark.url

    // URL 不合法 = 数据坏了。不画空卡：画一行「链接数据缺失」，样式复用 unknown-block 的
    // 中性 chrome（P3-04 placeholder 同口径），原文 url 是什么就写什么，便于人工修。
    if (!bookmark) {
      const raw = typeof attrs.url === 'string' ? attrs.url : ''
      return ['div', mergeAttributes(root),
        ['div', { class: 'lark-doc-unknown-card' },
          ['span', { class: 'lark-doc-unknown-card-icon', 'aria-hidden': 'true' }],
          ['span', { class: 'lark-doc-unknown-card-text' },
            ['span', { class: 'lark-doc-unknown-card-title' }, '链接数据缺失'],
            ['span', { class: 'lark-doc-unknown-card-sub' }, raw || '没有可用的 URL']]],
      ]
    }

    // 元数据也写进属性：导出成 HTML 后再被导回时，不依赖抓取器重新联网。
    if (bookmark.title) root['data-title'] = bookmark.title
    if (bookmark.desc) root['data-desc'] = bookmark.desc
    if (bookmark.favicon) root['data-favicon'] = bookmark.favicon

    // `renderHTML` 永远出 ready 档：骨架态（122）只在编辑器里由 NodeView 顶替，
    // 导出产物里不该有 shimmer（同「导出不带 hover / 不带工具条」的口径）。
    return ['div', mergeAttributes(root),
      ['div', { class: 'lark-doc-bookmark-container' },
        renderBookmarkCard(bookmark, bookmark.variant === BOOKMARK_VARIANT.rich
          ? BOOKMARK_VARIANT.rich
          : BOOKMARK_VARIANT.simple)],
    ]
  },

  // NodeView 先查注册表（三端可覆盖），没有再落 core 的纯 DOM 实现。
  addNodeView() { return getNodeView('bookmark') || createBookmarkNodeView },
})

export { Bookmark }
