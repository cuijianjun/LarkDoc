/** 图片扩展：figure/img 双层契约，所有 src 与附件 id 入 schema 前先做安全校验。 */
import { nodeInputRule } from '@tiptap/core'
import Image, { inputRegex as imageInputRegex } from '@tiptap/extension-image'
import { BLOCK_ID_PATTERN, safeAttachmentId, safeUrl } from '../documentOperations'
import { validateAttribute } from './shared'
// NodeView 由适配层注册进注册表；这里只查表，静态依赖里不许再出现 UI 框架。
import { getNodeView } from '../nodeviews/registry'

function imageExtension(resolveImageFile) {
  return Image.extend({
    addAttributes() {
      return {
        ...this.parent(),
        alt: { default: null, parseHTML: (el) => (el.tagName === 'FIGURE' ? el.querySelector('img') : el)?.getAttribute('alt') || null },
        title: { default: null, parseHTML: (el) => (el.tagName === 'FIGURE' ? el.querySelector('img') : el)?.getAttribute('title') || null },
        src: { default: null, validate: validateAttribute('image.src', (value) => value === null || safeUrl(value, true)), parseHTML: (el) => { const src = el.tagName === 'FIGURE' ? el.querySelector('img')?.getAttribute('src') : el.getAttribute('src'); return safeUrl(src, true) ? src : null }, rendered: false },
        originalSrc: { default: null, validate: validateAttribute('image.originalSrc', (value) => value === null || safeUrl(value, true)), parseHTML: (el) => { const src = el.getAttribute('data-original-src'); return safeUrl(src, true) ? src : null }, rendered: false },
        attchId: { default: null, validate: validateAttribute('image.attchId', (value) => value === null || safeAttachmentId(value)), parseHTML: (el) => { const id = el.getAttribute('data-attch-id') || el.querySelector('img')?.getAttribute('data-attch-id'); return safeAttachmentId(id) ? id : null }, rendered: false },
        originalAttchId: { default: null, validate: validateAttribute('image.originalAttchId', (value) => value === null || safeAttachmentId(value)), parseHTML: (el) => { const id = el.getAttribute('data-original-attch-id'); return safeAttachmentId(id) ? id : null }, rendered: false },
        width: { default: null, validate: validateAttribute('image.width', (value) => value === null || Number.isFinite(value) && value >= 40 && value <= 2400), parseHTML: (el) => { const width = Number(el.getAttribute('data-width') || el.getAttribute('width')); return width >= 40 && width <= 2400 ? width : null }, rendered: false },
        align: { default: 'center', validate: validateAttribute('image.align', (value) => ['left', 'center', 'right'].includes(value)), parseHTML: (el) => ['left', 'center', 'right'].includes(el.getAttribute('data-align')) ? el.getAttribute('data-align') : 'center', rendered: false },
        caption: { default: '', parseHTML: (el) => el.getAttribute('data-caption') || el.querySelector('figcaption')?.textContent || '', rendered: false },
      }
    },
    parseHTML() { return [{ tag: 'figure[data-type="image"]', getAttrs: (el) => safeUrl(el.querySelector('img')?.getAttribute('src'), true) ? null : false }, { tag: 'img[src]', getAttrs: (el) => safeUrl(el.getAttribute('src'), true) ? null : false }] },
    addCommands() { return { setImage: (attrs) => ({ commands }) => safeUrl(attrs.src, true) && (!attrs.originalSrc || safeUrl(attrs.originalSrc, true)) && commands.insertContent({ type: this.name, attrs }) } },
    addInputRules() { return [nodeInputRule({ find: imageInputRegex, type: this.type, getAttributes: (match) => safeUrl(match[3], true) ? { src: match[3], alt: match[2], title: match[4] } : false })] },
    renderHTML({ node }) {
      const attrs = node.attrs
      const figure = { 'data-type': 'image', 'data-caption': attrs.caption || '', 'data-align': ['left', 'center', 'right'].includes(attrs.align) ? attrs.align : 'center' }
      // 图片用自绘 renderHTML，全局属性不会自动合入外框，这里显式带上稳定块 id。
      if (typeof attrs.blockId === 'string' && BLOCK_ID_PATTERN.test(attrs.blockId)) figure['data-block-id'] = attrs.blockId
      if (safeUrl(attrs.originalSrc, true)) figure['data-original-src'] = attrs.originalSrc
      if (safeAttachmentId(attrs.attchId)) figure['data-attch-id'] = attrs.attchId
      if (safeAttachmentId(attrs.originalAttchId)) figure['data-original-attch-id'] = attrs.originalAttchId
      if (attrs.width) figure['data-width'] = attrs.width
      const image = { src: safeUrl(attrs.src, true) ? attrs.src : '', alt: attrs.alt || '', title: attrs.title || '' }
      if (safeAttachmentId(attrs.attchId)) image['data-attch-id'] = attrs.attchId
      if (attrs.width) image.width = Math.max(40, Math.min(2400, Number(attrs.width) || 640))
      return ['figure', figure, ['img', image], ['figcaption', {}, attrs.caption || '']]
    },
    // 图片 NodeView 查注册表：没注册就走上面的 renderHTML 默认渲染。
    addNodeView() { const view = getNodeView('image'); if (view) return view },
  }).configure({ allowBase64: true, resolveImageFile })
}

export { imageExtension }
