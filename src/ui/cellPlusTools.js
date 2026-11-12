/**
 * cellPlusTools — 表格单元格左侧 ＋ 按钮（v12e，飞书同款）。
 *
 * 飞书真源（2026-11-09 截图 3）：光标进单元格后，该单元格**左侧外**出现一颗灰底
 * 圆角 ＋，点击弹出 plus 插入菜单（按钮 / 公式 / 子文档 …，即命令菜单 plus 态）。
 *
 * 分工与 tableTools 一致：本文件只按 state 画 DOM、把手势翻成回调，不碰
 * ProseMirror —— 显隐与锚点由 `tableToolsUiMixin.buildCellPlusState()` 算好塞进
 * `state`（读 editor.state.selection 找单元格 DOM rect），点击经
 * `handlers.onOpen(btn)` 回 Vue 层开 `openCommandMenu('plus', …)`。
 *
 * 结构即契约（自测逐字段量）：
 *   div.lark-doc-cell-plus[.is-visible]
 *     button.lark-doc-cell-plus-btn[aria-label=插入内容] ＋
 *
 * `pointerdown preventDefault()` 与边界 ＋ 同义：按下不转移焦点，单元格里的
 * 光标不会被浏览器清掉 —— plus 菜单的 `rememberSelection` 靠它记住落点。
 */
import { applyStyle, mountNode } from './dom'
import { iconNode } from './icon'

export function createCellPlusTools({ host, handlers = {} }) {
  const el = document.createElement('div')
  el.className = 'lark-doc-cell-plus'

  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'lark-doc-cell-plus-btn'
  btn.setAttribute('aria-label', '插入内容')
  btn.appendChild(iconNode('plus', 14))
  el.appendChild(btn)

  btn.addEventListener('pointerdown', (event) => event.preventDefault())
  btn.addEventListener('click', () => { if (handlers.onOpen) handlers.onOpen(btn) })

  function update(state = {}) {
    if (!state.visible) {
      mountNode(host, el, false)
      el.classList.remove('is-visible')
      return
    }
    applyStyle(el, {
      left: `${Number(state.left) || 0}px`,
      top: `${Number(state.top) || 0}px`,
    })
    mountNode(host, el, true)
    el.classList.add('is-visible')
  }

  function destroy() { mountNode(host, el, false) }

  return { el, update, destroy }
}
