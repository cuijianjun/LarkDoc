/** 图片扩展：figure/img 双层契约，所有 src 与附件 id 入 schema 前先做安全校验。 */
import { nodeInputRule } from '@tiptap/core'
import Image, { inputRegex as imageInputRegex } from '@tiptap/extension-image'
import { BLOCK_ID_PATTERN, safeAttachmentId, safeUrl } from '../documentOperations'
import { validateAttribute } from './shared'
// NodeView 优先由适配层注册进注册表（三端可各自覆盖）；没人注册就用 core 自带的
// 纯 DOM 实现，element / 无框架宿主因此也能拿到完整图片交互。
// 静态依赖里不许再出现任何 UI 框架。
import { getNodeView } from '../nodeviews/registry'
import { createImageNodeView } from '../nodeviews/image'
import { imageCropGeometry, imageCropStyles, isImageCrop, isImageDimension, parseImageCrop } from '../media/image-crop'

function imageExtension(resolveImageFile, getOptions, canLoad) {
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
        naturalWidth: { default: null, validate: validateAttribute('image.naturalWidth', value => value === null || isImageDimension(value)), parseHTML: el => Number(el.getAttribute('data-natural-width')) || null, rendered: false },
        naturalHeight: { default: null, validate: validateAttribute('image.naturalHeight', value => value === null || isImageDimension(value)), parseHTML: el => Number(el.getAttribute('data-natural-height')) || null, rendered: false },
        crop: { default: null, validate: validateAttribute('image.crop', value => value === null || isImageCrop(value)), parseHTML: el => parseImageCrop(el.getAttribute('data-crop')), rendered: false },
        align: { default: 'center', validate: validateAttribute('image.align', (value) => ['left', 'center', 'right'].includes(value)), parseHTML: (el) => ['left', 'center', 'right'].includes(el.getAttribute('data-align')) ? el.getAttribute('data-align') : 'center', rendered: false },
        caption: { default: '', parseHTML: (el) => el.getAttribute('data-caption') || el.querySelector('figcaption')?.textContent || '', rendered: false },
      }
    },
    parseHTML() { return [{ tag: 'figure[data-type="image"]', getAttrs: (el) => safeUrl(el.querySelector('img')?.getAttribute('src'), true) ? null : false }, { tag: 'img[src]', getAttrs: (el) => safeUrl(el.getAttribute('src'), true) ? null : false }] },
    addCommands() { return { setImage: (attrs) => ({ commands }) => safeUrl(attrs.src, true) && (!attrs.originalSrc || safeUrl(attrs.originalSrc, true))
      && (attrs.naturalWidth == null || isImageDimension(attrs.naturalWidth)) && (attrs.naturalHeight == null || isImageDimension(attrs.naturalHeight))
      && (attrs.crop == null || isImageCrop(attrs.crop) && isImageDimension(attrs.naturalWidth) && isImageDimension(attrs.naturalHeight))
      && commands.insertContent({ type: this.name, attrs }) } },
    addInputRules() { return [nodeInputRule({ find: imageInputRegex, type: this.type, getAttributes: (match) => safeUrl(match[3], true) ? { src: match[3], alt: match[2], title: match[4] } : false })] },
    renderHTML({ node }) {
      const attrs = node.attrs
      const figure = { class: 'lark-doc-image', 'data-type': 'image', 'data-caption': attrs.caption || '', 'data-align': ['left', 'center', 'right'].includes(attrs.align) ? attrs.align : 'center' }
      // 图片用自绘 renderHTML，全局属性不会自动合入外框，这里显式带上稳定块 id。
      if (typeof attrs.blockId === 'string' && BLOCK_ID_PATTERN.test(attrs.blockId)) figure['data-block-id'] = attrs.blockId
      if (safeUrl(attrs.originalSrc, true)) figure['data-original-src'] = attrs.originalSrc
      if (safeAttachmentId(attrs.attchId)) figure['data-attch-id'] = attrs.attchId
      if (safeAttachmentId(attrs.originalAttchId)) figure['data-original-attch-id'] = attrs.originalAttchId
      if (attrs.width) figure['data-width'] = attrs.width
      const image = { class: 'lark-doc-image-img', src: safeUrl(attrs.src, true) ? attrs.src : '', alt: attrs.alt || '', title: attrs.title || '' }
      if (safeAttachmentId(attrs.attchId)) image['data-attch-id'] = attrs.attchId
      if (attrs.width) image.width = Math.max(40, Math.min(2400, Number(attrs.width) || 640))
      if (attrs.naturalWidth) figure['data-natural-width'] = attrs.naturalWidth
      if (attrs.naturalHeight) figure['data-natural-height'] = attrs.naturalHeight
      let imageDOM = ['img', image]
      if (isImageCrop(attrs.crop)) {
        figure['data-crop'] = JSON.stringify(attrs.crop)
        const width = attrs.width || attrs.naturalWidth
        const geometry = imageCropGeometry(width, width * attrs.naturalHeight / attrs.naturalWidth, attrs.crop)
        const styles = imageCropStyles(geometry)
        if (styles) {
          const css = style => Object.entries(style).map(([key, value]) => `${key.replace(/[A-Z]/g, character => `-${character.toLowerCase()}`)}:${value}`).join(';')
          delete image.width
          image.style = css(styles.image)
          imageDOM = ['div', { class: 'lark-doc-image-viewport', style: css(styles.viewport) }, ['img', image]]
        }
      }
      return ['figure', figure, imageDOM, ['figcaption', { class: 'lark-doc-image-caption-text' }, attrs.caption || '']]
    },
    // NodeView 先查注册表（适配层可覆盖），没有再落 core 的纯 DOM 实现；都没有才用上面的 renderHTML。
    addNodeView() { return getNodeView('image') || createImageNodeView },
  }).configure({ allowBase64: true, resolveImageFile, getOptions, canLoad })
}

export { imageExtension }
