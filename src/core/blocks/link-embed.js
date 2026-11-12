/** Card/preview block. URL and title views use the existing inline link mark. */
import { Node, mergeAttributes } from '@tiptap/core'
import { BLOCK_ID_PATTERN, safeUrl } from '../documentOperations'
import { validateAttribute } from './shared'
import { readBookmarkMeta, safeLinkCardMeta } from '../embed/bookmark'
import { getNodeView } from '../nodeviews/registry'
import { createLinkEmbedNodeView, LINK_EMBED_VIEWS, LINK_EMBED_DEFAULT_VIEW } from '../nodeviews/link-embed'

const safeHref = (value) => typeof value === 'string' && value.length <= 100000 && value !== '' && safeUrl(value)
const safeTitle = (value) => value === null || value === undefined || (typeof value === 'string' && value.length <= 100000 && !value.includes('\u0000'))
const safeView = (value) => LINK_EMBED_VIEWS.includes(value)
const dimension = (value, max) => value == null || (Number.isFinite(value) && value >= 88 && value <= max)
const readDimension = (name, max) => el => {
  const value = Number(el.getAttribute(name))
  return dimension(value, max) ? value : null
}

/** 从 `data-*` 取字符串；没有就是 null（不塞空串，免得 JSON 里全是噪音字段）。 */
const readAttr = (name) => (el) => {
  const value = el.getAttribute(name)
  return value === null || value === '' ? null : value
}

const LinkEmbed = Node.create({
  name: 'linkEmbed',
  group: 'block',
  atom: true,
  selectable: true,

  addOptions() { return { canEmbed: null, sandbox: null, allow: null, unfurl: null, canLoadMedia: null } },

  addGlobalAttributes() {
    return [{ types: ['link'], attributes: {
      linkView: {
        default: 'title',
        validate: validateAttribute('link.linkView', value => ['title', 'link'].includes(value)),
        parseHTML: el => el.getAttribute('data-link-view') === 'link' ? 'link' : 'title',
        renderHTML: attrs => attrs.linkView === 'link' ? { 'data-link-view': 'link' } : {},
      },
      linkTitle: {
        default: null,
        validate: validateAttribute('link.linkTitle', value => value === null || (typeof value === 'string' && value.length <= 100000 && !value.includes('\u0000'))),
        parseHTML: el => el.getAttribute('data-link-title'),
        renderHTML: attrs => attrs.linkTitle ? { 'data-link-title': attrs.linkTitle } : {},
      },
      linkCardMeta: {
        default: null,
        validate: validateAttribute('link.linkCardMeta', safeLinkCardMeta),
        parseHTML: el => el.getAttribute('data-link-card-meta'),
        renderHTML: attrs => attrs.linkCardMeta ? { 'data-link-card-meta': attrs.linkCardMeta } : {},
      },
    } }]
  },

  addAttributes() {
    return {
      href: {
        default: null,
        validate: validateAttribute('linkEmbed.href', (value) => value === null || safeHref(value)),
        parseHTML: (el) => {
          const value = readAttr('data-href')(el)
          return safeHref(value) ? value : null
        },
        rendered: false,
      },
      view: {
        default: LINK_EMBED_DEFAULT_VIEW,
        validate: validateAttribute('linkEmbed.view', (value) => value === null || safeView(value)),
        parseHTML: (el) => (safeView(el.getAttribute('data-view')) ? el.getAttribute('data-view') : LINK_EMBED_DEFAULT_VIEW),
        rendered: false,
      },
      title: {
        default: null,
        validate: validateAttribute('linkEmbed.title', safeTitle),
        parseHTML: (el) => readAttr('data-title')(el),
        rendered: false,
      },
      cardMeta: {
        default: null,
        validate: validateAttribute('linkEmbed.cardMeta', safeLinkCardMeta),
        parseHTML: readAttr('data-card-meta'),
        rendered: false,
      },
      width: {
        default: null,
        validate: validateAttribute('linkEmbed.width', value => dimension(value, 1060)),
        parseHTML: readDimension('data-width', 1060),
        rendered: false,
      },
      height: {
        default: null,
        validate: validateAttribute('linkEmbed.height', value => dimension(value, 4000)),
        parseHTML: readDimension('data-height', 4000),
        rendered: false,
      },
    }
  },

  parseHTML() {
    return [{
      tag: 'div[data-type="link-embed"]',
      getAttrs: (el) => (safeHref(el.getAttribute('data-href')) ? null : false),
    }]
  },

  addCommands() {
    return {
      setLinkEmbed: (attrs) => ({ state, commands }) => {
        const href = attrs && attrs.href
        if (!safeHref(href)) return false
        const view = attrs && safeView(attrs.view) ? attrs.view : LINK_EMBED_DEFAULT_VIEW
        const normalized = { href, view, title: (attrs && attrs.title) || null, cardMeta: attrs?.cardMeta ?? null, width: attrs?.width ?? null, height: attrs?.height ?? null }
        // 属性合法性交给 schema validator：先试 create，抛错即拒（防 insertContent
        // 「warning + 照常返回 true」的假成功，同 file-block）。
        try { state.schema.nodes[this.name].create(normalized).check() } catch (_) { return false }
        return commands.insertContent({ type: this.name, attrs: normalized })
      },
    }
  },

  renderHTML({ node }) {
    const attrs = node.attrs || {}
    if (!safeHref(attrs.href)) return ['div', { 'data-type': 'link-embed' }]
    const div = {
      class: 'lark-doc-link-embed',
      'data-type': 'link-embed',
      'data-view': safeView(attrs.view) ? attrs.view : LINK_EMBED_DEFAULT_VIEW,
      'data-href': attrs.href,
    }
    if (typeof attrs.blockId === 'string' && BLOCK_ID_PATTERN.test(attrs.blockId)) div['data-block-id'] = attrs.blockId
    if (attrs.title) div['data-title'] = attrs.title
    if (attrs.cardMeta) div['data-card-meta'] = attrs.cardMeta
    if (attrs.width) div['data-width'] = attrs.width
    if (attrs.height) div['data-height'] = attrs.height
    let title = attrs.title || attrs.href
    if (typeof attrs.cardMeta === 'string' && safeLinkCardMeta(attrs.cardMeta)) title = readBookmarkMeta(JSON.parse(attrs.cardMeta)).title || title
    return ['div', mergeAttributes(div), ['a', { href: attrs.href, target: '_blank', rel: 'noopener noreferrer' }, title]]
  },

  // NodeView 先查注册表（三端可覆盖），没有再落 core 的纯 DOM 实现。
  addNodeView() { return getNodeView('linkEmbed') || createLinkEmbedNodeView },
})

/** 一份块属性能不能渲染出东西 —— 插入侧与 NodeView 共用同一判据。 */
export function canRenderLinkEmbed(attrs) {
  return !!(attrs && safeHref(attrs.href))
}

export { LinkEmbed }
