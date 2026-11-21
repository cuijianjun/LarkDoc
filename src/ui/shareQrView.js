/**
 * 分享二维码 / 微信面板（按需）。飞书源码的面板结构：返回、标题、二维码、扫码提示、
 * 权限 tip。ESM/CDN 路径用本地编码器绘制；Element UMD 形态由构建期 stub 替换。
 */
import { callHandler } from './overlayShared'
import { QR_CODE_DARK, QR_CODE_LIGHT } from './palette'

export function createShareQrView(handlers) {
  const layer = document.createElement('div')
  layer.className = 'lark-doc-share-qr-layer'
  layer.innerHTML = '<div class="lark-doc-share-qr-mask"></div><div class="lark-doc-share-qr-dialog" role="dialog" aria-label="扫码分享"><header class="lark-doc-share-qr-head"><button type="button" class="lark-doc-share-qr-back" aria-label="返回">‹</button><strong class="lark-doc-share-qr-title">扫码分享</strong></header><canvas></canvas><p class="lark-doc-share-qr-desc">扫码分享文档</p><p class="lark-doc-share-qr-tip" hidden></p></div>'
  const canvas = layer.querySelector('canvas'), title = layer.querySelector('.lark-doc-share-qr-title')
  const desc = layer.querySelector('.lark-doc-share-qr-desc'), tip = layer.querySelector('.lark-doc-share-qr-tip')
  const close = () => callHandler(handlers, 'onCloseShareQrCode')
  layer.querySelector('.lark-doc-share-qr-mask').addEventListener('click', close)
  layer.querySelector('.lark-doc-share-qr-back').addEventListener('click', close)
  return {
    el: layer,
    update(qr) {
      if (!qr) return
      title.textContent = qr.title || '扫码分享'
      desc.textContent = '扫码分享文档'
      tip.textContent = qr.tip || ''
      tip.hidden = !qr.tip
      const scale = 5, quiet = 4, side = (qr.size + quiet * 2) * scale
      canvas.width = canvas.height = side
      canvas.style.width = canvas.style.height = `${side}px`
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.fillStyle = QR_CODE_LIGHT; ctx.fillRect(0, 0, side, side); ctx.fillStyle = QR_CODE_DARK
      for (let i = 0; i < qr.modules.length; i += 1) {
        if (qr.modules[i]) ctx.fillRect(((i % qr.size) + quiet) * scale, (Math.floor(i / qr.size) + quiet) * scale, scale, scale)
      }
    },
  }
}
