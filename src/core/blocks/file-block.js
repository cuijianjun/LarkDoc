/**
 * 文件 / 视频块（P2-04）。
 *
 * 02 §19.5 定死：`data-block-type` 恒为 `file`，视频 / PDF / 普通附件是**同一个块**，
 * 差异全在 NodeView 里那层 iframe / video —— 不新增 `video` 节点类型
 * （③-quater 第 1 条：「不要新增 video 块类型」）。
 *
 * attrs 对齐 ⑤（`token` / `name` / `size` / `mimeType` / `viewType` / `coverUrl`），
 * 另加两个可选字段：`src` —— `token` 是飞书那套「附件 token 换预览地址」的稳定 id，本仓库
 * 没有那个 SDK，`src` 直接存宿主上传回来的直链，渲染不必每次异步换票；`originalSrc` ——
 * 出网策略（P2-05）拦下远端地址时，`src` 清空、原地址留在这里，与 image 节点同构。
 * 两个都缺的块无法渲染，parseHTML 直接拒收（退化成 unknown-block，不静默丢内容）。
 *
 * 已知偏离（记入 09 §5.3 P2-04 注记）：
 *   - 上传中态不做：③-quinquies 实测飞书 90 秒窗口内 DOM 零命中、零进度条，
 *     上传完成前页面什么都不变就是 1:1 行为；
 *   - 失败态**照常落块**（与图片相反）：预览元素一报错就切兜底文案 + 保留下载入口；
 *   - `status` 不进 schema：③-ter 三条判据要求状态由预览元素事件驱动，运行时态留在 NodeView。
 */
import { Node, mergeAttributes } from '@tiptap/core'
import { BLOCK_ID_PATTERN, safeAttachmentId, safeUrl } from '../documentOperations'
import { validateAttribute } from './shared'
import { getNodeView } from '../nodeviews/registry'
import { createFileBlockNodeView } from '../nodeviews/file-block'
import { FILE_VIEW_TYPES, fileKindOf, isPreviewableKind } from '../media/file-block'

// 文件地址走 `safeUrl(value, true)`（宽松档）：同时放行 http(s) 与 `/files/x.pdf`
// 这类同源相对路径（老系统附件目录常见），但依旧挡掉 `javascript:` 与协议相对 `//host`。
const safeFileUrl = (value) => value === null || value === undefined || value === '' || safeUrl(value, true)
const text = (value) => typeof value === 'string' && value.length <= 512 && !value.includes('\u0000')
const safeText = (value) => value === null || value === undefined || text(value)

/** 从 `data-*` 取字符串；没有就是 null（不塞空串，免得 JSON 里全是噪音字段）。 */
const readAttr = (name) => (el) => {
  const value = el.getAttribute(name)
  return value === null || value === '' ? null : value
}

/** 从 `data-*` 取数字；非法值回 null，别把 NaN 塞进 schema。 */
const readNumber = (name) => (el) => {
  const value = Number(el.getAttribute(name))
  return Number.isFinite(value) && value >= 0 && el.getAttribute(name) !== null ? value : null
}

const FileBlock = Node.create({
  name: 'fileBlock',
  group: 'block',
  // 原子块：内部是 iframe / video / 卡片，没有可编辑的 contentDOM。
  // selectable 让点击能选中整块（删除键 1 次删整块，02 L4248）。
  atom: true,
  draggable: true,
  selectable: true,

  // 宿主只存附件 token、不存直链时，由适配层注入 `resolveFileUrl(token, node)`
  // 换出可渲染地址（本仓库没有飞书那套预览 SDK，`src` 仍是 V1 主路径）。
  addOptions() {
    return { resolveFileUrl: null }
  },

  addAttributes() {
    return {
      token: {
        default: null,
        validate: validateAttribute('fileBlock.token', (value) => value === null || safeAttachmentId(value)),
        parseHTML: (el) => {
          const value = readAttr('data-token')(el)
          return safeAttachmentId(value) ? value : null
        },
        rendered: false,
      },
      src: {
        default: null,
        validate: validateAttribute('fileBlock.src', safeFileUrl),
        parseHTML: (el) => {
          const value = el.getAttribute('data-src')
          return safeFileUrl(value) && value ? value : null
        },
        rendered: false,
      },
      // 出网策略拦下远端文件地址时，`src` 被清空、原地址存在这里（与 image 节点同构）：
      // NodeView 据此判定「不是缺地址，是被策略挡住」，不再去换票，也方便宿主后补上传。
      originalSrc: {
        default: null,
        validate: validateAttribute('fileBlock.originalSrc', safeFileUrl),
        parseHTML: (el) => {
          const value = el.getAttribute('data-original-src')
          return safeFileUrl(value) && value ? value : null
        },
        rendered: false,
      },
      name: {
        default: null,
        validate: validateAttribute('fileBlock.name', safeText),
        parseHTML: readAttr('data-name'),
        rendered: false,
      },
      size: {
        default: null,
        validate: validateAttribute('fileBlock.size', (value) => value === null || (Number.isFinite(Number(value)) && Number(value) >= 0)),
        parseHTML: readNumber('data-size'),
        rendered: false,
      },
      mimeType: {
        default: null,
        validate: validateAttribute('fileBlock.mimeType', safeText),
        parseHTML: readAttr('data-mime-type'),
        rendered: false,
      },
      viewType: {
        default: 'Card',
        validate: validateAttribute('fileBlock.viewType', (value) => FILE_VIEW_TYPES.includes(value)),
        parseHTML: (el) => (FILE_VIEW_TYPES.includes(el.getAttribute('data-view-type')) ? el.getAttribute('data-view-type') : 'Card'),
        rendered: false,
      },
      coverUrl: {
        default: null,
        validate: validateAttribute('fileBlock.coverUrl', safeFileUrl),
        parseHTML: (el) => {
          const value = el.getAttribute('data-cover-url')
          return safeFileUrl(value) && value ? value : null
        },
        rendered: false,
      },
    }
  },

  // `data-block-type="file"` 是飞书的块类型标记（02 §19.5 ①），`data-type="file"`
  // 是本仓库其余块（figure[data-type=image] 等）的既有约定，两者都写。
  parseHTML() {
    return [{
      tag: 'figure[data-type="file"]',
      getAttrs: (el) => {
        const token = el.getAttribute('data-token')
        const src = el.getAttribute('data-src')
        return (safeAttachmentId(token) || safeUrl(src, true)) ? null : false
      },
    }]
  },

  addCommands() {
    return {
      setFileBlock: (attrs) => ({ commands }) => {
        const token = attrs && attrs.token
        const src = attrs && attrs.src
        if (!safeAttachmentId(token) && !safeUrl(src, true)) return false
        return commands.insertContent({ type: this.name, attrs })
      },
    }
  },

  renderHTML({ node }) {
    const attrs = node.attrs || {}
    const figure = {
      class: 'lark-doc-file docx-file-block',
      'data-type': 'file',
      'data-block-type': 'file',
    }
    // 自绘 renderHTML 不会自动合入全局属性，稳定块 id 要显式带上（同 image.js）。
    if (typeof attrs.blockId === 'string' && BLOCK_ID_PATTERN.test(attrs.blockId)) figure['data-block-id'] = attrs.blockId
    if (safeAttachmentId(attrs.token)) figure['data-token'] = attrs.token
    if (attrs.src && safeFileUrl(attrs.src)) figure['data-src'] = attrs.src
    if (attrs.originalSrc && safeFileUrl(attrs.originalSrc)) figure['data-original-src'] = attrs.originalSrc
    if (attrs.name) figure['data-name'] = attrs.name
    if (Number.isFinite(Number(attrs.size)) && Number(attrs.size) >= 0) figure['data-size'] = String(attrs.size)
    if (attrs.mimeType) figure['data-mime-type'] = attrs.mimeType
    figure['data-view-type'] = FILE_VIEW_TYPES.includes(attrs.viewType) ? attrs.viewType : 'Card'
    if (attrs.coverUrl && safeFileUrl(attrs.coverUrl)) figure['data-cover-url'] = attrs.coverUrl
    return ['figure', mergeAttributes(figure)]
  },

  // NodeView 先查注册表（三端可覆盖），没有再落 core 的纯 DOM 实现。
  addNodeView() { return getNodeView('fileBlock') || createFileBlockNodeView },
})

/** 一份块属性能不能渲染出东西——插入侧与 NodeView 共用同一判据。 */
export function canRenderFileBlock(attrs) {
  if (!attrs) return false
  if (safeAttachmentId(attrs.token)) return true
  return Boolean(attrs.src && safeFileUrl(attrs.src))
}

/** 分流给上层用：`video/*` / `application/pdf` / 其它。 */
export function fileBlockKind(attrs) {
  return fileKindOf(attrs && attrs.mimeType)
}

/** 该形态是否需要一个内嵌预览挂载点（卡片态不需要）。 */
export function fileBlockNeedsPreview(attrs) {
  return isPreviewableKind(fileBlockKind(attrs))
}

export { FileBlock }
