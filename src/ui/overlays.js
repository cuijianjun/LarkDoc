/**
 * 分享 / 导出浮层 —— 出口文件。
 *
 * 原 SharePopover.vue、PermissionDialog.vue、ExportDialog.vue 的渲染层，按「谁跟谁
 * 共享作用域」拆开，本文件只负责把三块挂进同一个层并转发 update：
 *
 *   overlayShared.js    建元素 / 按钮 / 属性 / 内联 SVG / 受控输入 / 下拉
 *   shareView.js        分享浮层（分享对象、链接权限、服务入口、二维码）
 *   permissionView.js   权限浮层（含安全确认与密码校验）
 *   exportView.js       导出浮层
 *   imageShareView.js   图片分享浮层（裁剪、样式、下载）
 *
 * 状态和业务动作仍由 shareMixin / exportMixin 持有，渲染器只负责 DOM、事件和显隐。
 * 拆的是文件边界，不是行为：两个导出名与 `ui/overlays` 的 import 路径都没变。
 */
import { mountNode } from './dom'
import { createShareEntry } from './shareEntry'
import { text } from './overlayShared'
import { createExportView } from './exportView'
import { createImageShareView } from './imageShareView'
import { createShareView } from './shareView'

export function createDocumentOverlays(options = {}) {
  let destroyed = false
  const host = options.host || null
  const handlers = options.handlers || {}
  const share = createShareView({ handlers, host })
  const exportView = createExportView({ handlers })
  const imageShare = createImageShareView(handlers)
  const el = text('div', 'lark-doc-p6b-layer')
  el.appendChild(share.el)
  el.appendChild(exportView.el)
  function update(state) {
    if (destroyed) return
    mountNode(host, el, true)
    share.update(state)
    exportView.update(state)
    mountNode(el, imageShare.el, !!state.imageShare)
    imageShare.update(state)
  }
  return {
    el,
    update,
    destroy() { if (destroyed) return; destroyed = true; share.destroy(); exportView.destroy(); imageShare.destroy(); if (el.parentNode) el.parentNode.removeChild(el) },
  }
}

/** Preserve the synchronous standalone renderer, including permission denial. */
export function createOverlays(options = {}) {
  const dialogs = createDocumentOverlays(options)
  const entry = createShareEntry({ ...options, host: dialogs.el })
  return { el: dialogs.el,
    update(state) { dialogs.update(state); entry.update(state) },
    destroy() { entry.destroy(); dialogs.destroy() },
  }
}

