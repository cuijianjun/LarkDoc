/**
 * 面板 / 宿主弹窗 —— 原生 DOM 版（`src/ui/` 积木 · 阶段 5 批次 4b）。
 *
 * 原 SFC 在本批次删除，这里是四个面板的唯一实现：
 *   ① `editor/OutlinePanel.vue`   —— 目录侧栏（210px sticky，父级另有一颗 ☰ 兄弟钮）
 *   ② `VersionPanel.vue`          —— 历史记录全屏层（左预览 + 右按天时间线）
 *   ③ `SaveVersionDialog.vue`     —— 另存为版本 Dialog + 恢复成功 toast
 *   ④ `CommentPanel.vue`          —— 评论面板层（`display:contents` 容器 + 每线程一张卡）
 *
 * 模板库是**宿主侧**原生 UI（`src/ui/templateLibrary.js`，`src/index.js` 对外导出、独立路由），
 * 不在编辑器里，不在本文件里。
 *
 * `scripts/verify-browser-panels.js` 的 87 条断言逐字段量这里产出的 DOM，改之前先跑一遍。
 *
 * 五条与其它积木一致的规矩：
 * 1. **结构即契约**：类名 / `role` / `aria-*` / 段序逐字段复刻 SFC。
 * 2. **`v-if` → 真 insert/remove**：空态 / 降级态 / diff / 草稿按钮组 / 回复菜单
 *    一律走 `syncChildren`。这些段位断言量的是 `querySelector` 找不找得到，
 *    只 `display:none` 会被当场量出来。
 * 3. **一次建节点、之后只改属性**：目录条目、评论卡的 head/输入区/更多菜单都在工厂里
 *    建好，`update()` 只切类名与文案。重建会把焦点、hover 态与鼠标下的节点一起丢掉 ——
 *    评论的 textarea 尤其明显（重建一次等于用户打字打到一半光标被踢到末尾）。
 * 4. **关闭即摘节点**：面板开合走 `mountNode(host, el, on)`（只增删自己这一棵），
 *    `open: false` 时整棵从宿主摘掉，与 Vue 的销毁语义一致。
 * 5. **样式一律 `applyStyle`（替换语义）**：这些面板的 `left/top/height` 每帧重算，
 *    合并语义会把上一轮的位置留在原地。
 *
 * ⚠️ 四处**故意不统一**，别顺手改成「看起来更合理」的样子：
 * - `VersionPanel` 的 `Esc` **关不掉**：根节点只 `stop + prevent`，不接关闭逻辑 ——
 *   目的是拦住冒泡到 `overlayDismissMixin.closeOverlay()`（那条链里没有版本面板分支）。
 *   唯一出口是左栏顶栏的返回图标。`SaveVersionDialog` 正好相反：`Esc` 能关、点遮罩不关。
 * - `CommentPanel` 的根节点是 `@mousedown`（**没有** `.prevent`）：它要抢焦点去点亮线程；
 *   里面的按钮则一律 `.prevent`（点面板不能把焦点让给 body，否则编辑器选区掉了）。
 *   唯一例外是 textarea —— 它必须拿到焦点。
 * - 评论卡的 `:style` 在 SFC 里是**数组**（`[commentPanelStyle(item), { height }]` =
 *   合并语义）。原生层 `applyStyle` 是替换语义，所以由接线层先算成一份对象再传，
 *   不能分两次 `applyStyle`。
 * - `OutlinePanel` 的根 `aside` 必须是 `.lark-doc-body` 的**直接 flex 子元素**
 *   （`lark-doc.css` 里它是 `flex: 0 0 210px` + `position: sticky`）。它的宿主因此带
 *   `display: contents`，不占一格 flex。
 */

import { applyStyle, lockPageScroll, mountNode, setAttr, setText, syncChildren } from './dom'
import { iconNode } from './icon'
import { placeMenu } from './menuLayout'

let saveVersionInputSequence = 0

// Standalone UI keeps its dependency-free textarea contract. The native editor
// injects the rich factory from its existing PM runtime instead of bundling PM
// again into the independently loaded UI feature.
function createPlainCommentInput({ label, placeholder, onChange }) {
  const el = document.createElement('textarea')
  el.setAttribute('aria-label', label); el.placeholder = placeholder
  el.addEventListener('input', () => onChange({ content: el.value, mentions: [], references: [], caret: el.selectionStart }))
  el.addEventListener('keydown', event => el.dispatchEvent(new CustomEvent('comment-keydown', { detail: event })))
  return {
    el, focus: () => el.focus(),
    update(next) { setInputValue(el, next.value); el.readOnly = !!next.readonly },
    destroy: () => el.remove(),
  }
}

/** 统一取 handler：缺项静默（与 `dialogs.js` 同口径，漏接线不该炸在渲染里）。 */
function handlerCaller(handlers) {
  return (name, ...args) => {
    const fn = handlers[name]
    return typeof fn === 'function' ? fn(...args) : undefined
  }
}

/** `:value` —— 走 DOM property，且只在真的变了才写（否则光标被踢到末尾）。 */
function setInputValue(input, value) {
  if (!input) return
  const text = value === null || value === undefined ? '' : String(value)
  if (input.value !== text) input.value = text
}

function renderCommentSegments(node, segments, onReference) {
  node.textContent = ''
  const list = Array.isArray(segments) && segments.length ? segments : [{ text: '' }]
  list.forEach((segment) => {
    const value = segment && typeof segment === 'object' ? segment : { text: segment }
    const text = value.text == null ? '' : String(value.text)
    const linkMark = Array.isArray(value.marks) && value.marks.find(mark => mark?.type === 'link' && typeof mark.attrs?.href === 'string' && /^https?:\/\//.test(mark.attrs.href))
    const part = document.createElement(linkMark ? 'a' : 'span')
    if (linkMark) { part.href = linkMark.attrs.href; part.target = '_blank'; part.rel = 'noopener noreferrer'; part.className = 'lark-doc-comment-rich-link' }
    if (Array.isArray(value.marks)) {
      value.marks.forEach(mark => {
        if (mark?.type === 'bold') part.classList.add('is-bold')
        if (mark?.type === 'italic') part.classList.add('is-italic')
        if (mark?.type === 'strike') part.classList.add('is-strike')
        if (mark?.type === 'code') part.classList.add('is-code')
      })
    }
    if (value.docId) {
      part.className = 'lark-doc-comment-document-reference' + (value.readable === false ? ' is-disabled' : '')
      part.dataset.commentReference = value.docId
      part.setAttribute('role', 'link')
      part.tabIndex = value.readable === false ? -1 : 0
      part.setAttribute('aria-disabled', String(value.readable === false))
      part.appendChild(document.createTextNode(text))
      if (value.readable !== false && typeof onReference === 'function') {
        const activate = (event) => {
          event.preventDefault(); event.stopPropagation(); onReference(value, event)
        }
        part.addEventListener('click', activate)
        part.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') activate(event) })
      }
    } else if (value.principalId) {
      part.className = 'lark-doc-comment-mention-chip'
      part.dataset.commentMention = value.principalId
      if (value.isSelf) part.classList.add('is-self')
      part.appendChild(document.createTextNode(text))
    } else {
      part.appendChild(document.createTextNode(text))
    }
    node.appendChild(part)
  })
}

/** `@mousedown.prevent` —— 点面板内的控件不许把焦点让给 body。 */
function onMouseDownPrevent(node, run) {
  node.addEventListener('mousedown', (event) => {
    event.preventDefault()
    run(event)
  })
}

// 面板开合走 `mountNode(host, el, on)`（只增删自己这一棵，`dom.js`），**不是
// `syncChildren`** —— 历史层 / 另存为 / 评论层共用同一个 `panelHost`，用后者会互相摘除。

/* ═══════════════════════════ ① 目录侧栏 ═══════════════════════════ */

/**
 * 目录侧栏（`OutlinePanel.vue`）。
 *
 * 宿主必须是 `.lark-doc-body` 里的 `ref="outlineHost"`（带 `display: contents`）：
 * `aside` 的 `flex: 0 0 210px` / `position: sticky` 都要求它是那层 flex 的直接子项。
 *
 * 条目按 `pos` 缓存：折叠 / 展开只改类名与条目集合，节点本身复用。
 * `hasChildren` 决定首格是折叠钮还是占位 span —— 两个节点都建好，用
 * `syncChildren` 二选一，等价于模板里的 `v-if` / `v-else`。
 *
 * state: `{ open, empty, pending, active, items: [{ pos, text, level, hasChildren, collapsed }] }`
 */
export { createOutlinePanel } from './outlinePanel'

/* ═══════════════════════ ② 历史记录全屏层 ═══════════════════════ */

/**
 * 历史记录面板（`VersionPanel.vue`）。
 *
 * `Esc` 只 `stop + prevent`、**不关**（SFC 文件头负结论 1）：它唯一的用途是不让 Esc
 * 冒泡到 `closeOverlay()`，那条链里没有版本面板分支，传过去只会误关别的浮层。
 *
 * 左栏内容是三选一（错误 / 空态 / 预览），走 `syncChildren`；预览里的
 * meta 段是「前两项恒在 + 后两项恒条件」的前缀序列，用一个 4 格 span 池对齐。
 * 右栏时间线按 `days` 的签名重建 —— 选中态 / 分组 / 条目文案任一变化都会换一批节点。
 *
 * state:
 * ```
 * {
 *   open,
 *   restore: { disabled, title, style },
 *   pager: { cursor, prev: { disabled, style }, next: { disabled, style } },
 *   view: 'error' | 'empty' | 'preview',
 *   errorText, emptyText,
 *   preview: null | { title, kind, meta: [String], degraded, diff: null | { row }, payload },
 *   timelineError, days: [{ key, label, items: [{ id, cls, name, desc, user }] }],
 * }
 * ```
 */
export function createVersionPanel(options = {}) {
  const host = options.host || null
  const win = (host?.ownerDocument || document).defaultView
  const mobile = () => win.innerWidth <= 760
  let mobileView = 'list', mobileSelectedId = '', previewRecord = null, releasePreview = null, mountedPolicy = null, destroyed = false
  const collapsedDays = new Set(), expandedDays = new Set()
  function clearDocument() { releasePreview?.(); releasePreview = null; previewRecord = null; mountedPolicy = null; documentBody.replaceChildren(); lastChangeIndex = -1 }
  const call = handlerCaller(options.handlers || {})

  const state = {
    open: false,
    restore: { disabled: true, title: '', style: null },
    pager: { cursor: '', prev: { disabled: true, style: null }, next: { disabled: true, style: null } },
    view: 'empty',
    errorText: '',
    emptyText: '',
    preview: null,
    timelineError: '',
    days: [],
  }

  const el = document.createElement('div')
  el.className = 'lark-doc-version-layer'
  el.setAttribute('role', 'dialog')
  el.setAttribute('aria-label', '历史记录')
  el.setAttribute('aria-modal', 'true')
  el.setAttribute('tabindex', '-1')
  el.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return
    event.stopPropagation()
    event.preventDefault()
  })

  // ── 左栏 ──
  const left = document.createElement('div')
  left.className = 'lark-doc-version-left'

  const leftHeader = document.createElement('div')
  leftHeader.className = 'lark-doc-version-left-header'

  const backButton = document.createElement('button')
  backButton.type = 'button'
  backButton.className = 'lark-doc-version-back'
  backButton.setAttribute('aria-label', '返回文档')
  backButton.appendChild(iconNode('undo', 24))
  backButton.addEventListener('click', () => {
    if (mobile() && mobileView === 'preview') { mobileView = 'list'; render(); return }
    call('onClose')
  })
  const sourceButton = document.createElement('button')
  sourceButton.type = 'button'; sourceButton.className = 'lark-doc-version-source'; sourceButton.textContent = '回到源文档'
  sourceButton.addEventListener('click', () => { if (!destroyed) call('onClose') })
  const savedMenu = document.createElement('details'); savedMenu.className = 'lark-doc-version-saved-menu'
  const savedSummary = document.createElement('summary'); savedSummary.setAttribute('aria-label', '版本更多操作'); savedSummary.textContent = '···'
  savedMenu.appendChild(savedSummary)
  for (const label of ['分享版本', '添加到导航栏', '浮窗', '查找', '目录', '翻译', '下载为', '打印', '重命名版本', '删除版本']) {
    const action = document.createElement('button'); action.type = 'button'; action.textContent = label; action.disabled = true
    action.title = '尚未配置版本操作服务'; savedMenu.appendChild(action)
  }
  const savedSource = sourceButton.cloneNode(true); savedSource.addEventListener('click', () => { if (!destroyed) call('onClose') }); savedMenu.appendChild(savedSource)

  const restoreButton = document.createElement('button')
  restoreButton.type = 'button'
  restoreButton.className = 'lark-doc-version-restore'
  restoreButton.textContent = '还原此历史记录'
  restoreButton.setAttribute('data-capability', 'canRestoreVersion')
  onMouseDownPrevent(restoreButton, () => { if (!restoreButton.disabled) call('onRestore') })

  const pager = document.createElement('div')
  pager.className = 'lark-doc-version-pager'
  const cursorLabel = document.createElement('span')
  cursorLabel.className = 'lark-doc-version-cursor'
  const prevButton = document.createElement('button')
  prevButton.type = 'button'
  prevButton.className = 'lark-doc-version-step'
  prevButton.textContent = '上一版本'
  onMouseDownPrevent(prevButton, () => call('onPrev'))
  const nextButton = document.createElement('button')
  nextButton.type = 'button'
  nextButton.className = 'lark-doc-version-step'
  nextButton.textContent = '下一版本'
  onMouseDownPrevent(nextButton, () => call('onNext'))
  pager.appendChild(cursorLabel)
  pager.appendChild(prevButton)
  pager.appendChild(nextButton)

  const headerDivider = document.createElement('span')
  headerDivider.className = 'lark-doc-version-header-divider'

  leftHeader.appendChild(backButton)
  leftHeader.appendChild(restoreButton)
  leftHeader.appendChild(pager)
  leftHeader.append(sourceButton, savedMenu)
  leftHeader.appendChild(headerDivider)

  const leftContent = document.createElement('div')
  leftContent.className = 'lark-doc-version-left-content'

  const errorNode = document.createElement('p')
  errorNode.className = 'lark-doc-version-empty'
  const emptyNode = document.createElement('p')
  emptyNode.className = 'lark-doc-version-empty'

  const previewBox = document.createElement('div')
  previewBox.className = 'lark-doc-version-preview'

  const previewHead = document.createElement('div')
  previewHead.className = 'lark-doc-version-preview-head'
  const previewTitle = document.createElement('span')
  previewTitle.className = 'lark-doc-version-preview-title'
  const previewKind = document.createElement('span')
  previewKind.className = 'lark-doc-version-preview-kind'
  previewHead.appendChild(previewTitle)
  previewHead.appendChild(previewKind)

  // meta 是「前缀序列」：前两项（时间 / 作者）恒在，后两项（字节数 / 块数）随载荷出现。
  const previewMeta = document.createElement('div')
  previewMeta.className = 'lark-doc-version-preview-meta'
  const metaSpans = [0, 1, 2, 3].map(() => document.createElement('span'))
  metaSpans.forEach((span) => previewMeta.appendChild(span))

  const degradedNode = document.createElement('p')
  degradedNode.className = 'lark-doc-version-degraded'

  const diffBox = document.createElement('div')
  diffBox.className = 'lark-doc-version-diff'
  const diffTitle = document.createElement('span')
  diffTitle.className = 'lark-doc-version-diff-title'
  diffTitle.textContent = '与更早版本的差异'
  const diffRow = document.createElement('span')
  diffRow.className = 'lark-doc-version-diff-row'
  diffBox.appendChild(diffTitle)
  diffBox.appendChild(diffRow)

  const bodyBox = document.createElement('div')
  bodyBox.className = 'lark-doc-version-body'
  const binaryPayload = document.createElement('p')
  binaryPayload.className = 'lark-doc-version-binary'
  const binaryMissing = document.createElement('p')
  binaryMissing.className = 'lark-doc-version-binary'
  binaryMissing.textContent = '该版本没有可取回的正文，只能查看元信息。'
  bodyBox.appendChild(binaryPayload)
  bodyBox.appendChild(binaryMissing)
  const documentBody = document.createElement('div'); documentBody.className = 'lark-doc-version-document'
  const changePager = document.createElement('footer'); changePager.className = 'lark-doc-version-change-pager'
  const changePrev = document.createElement('button'), changeNext = document.createElement('button'), changeCursor = document.createElement('span')
  changePrev.type = changeNext.type = 'button'; changePrev.textContent = '上一项'; changeNext.textContent = '下一项'
  changePrev.setAttribute('aria-label', '上一项编辑'); changeNext.setAttribute('aria-label', '下一项编辑')
  changePrev.addEventListener('click', () => { if (!changePrev.disabled && !destroyed) call('onChangePrev') })
  changeNext.addEventListener('click', () => { if (!changeNext.disabled && !destroyed) call('onChangeNext') })
  changePager.append(changeCursor, changePrev, changeNext)
  const changesMessage = document.createElement('p'); changesMessage.className = 'lark-doc-version-changes-message'; changesMessage.setAttribute('role', 'status')
  const changesList = document.createElement('ol'); changesList.className = 'lark-doc-version-changes'
  let changesSignature = '', lastChangeIndex = -1
  const restoreConfirmMask = document.createElement('div'); restoreConfirmMask.className = 'lark-doc-version-restore-mask'
  const restoreConfirm = document.createElement('section'); restoreConfirm.className = 'lark-doc-version-restore-dialog'
  restoreConfirm.setAttribute('role', 'alertdialog'); restoreConfirm.setAttribute('aria-modal', 'true'); restoreConfirm.setAttribute('aria-label', '还原历史版本确认')
  const restoreConfirmTitle = document.createElement('h2'); restoreConfirmTitle.textContent = '还原此历史版本？'
  const restoreConfirmText = document.createElement('p')
  const restoreCancel = document.createElement('button'), restoreConfirmButton = document.createElement('button')
  restoreCancel.type = restoreConfirmButton.type = 'button'
  restoreCancel.textContent = '取消'; restoreCancel.setAttribute('aria-label', '取消还原')
  restoreConfirmButton.textContent = '还原'; restoreConfirmButton.setAttribute('aria-label', '确认还原')
  restoreCancel.addEventListener('click', () => { if (!destroyed && restoreConfirmMask.isConnected) call('onCancelRestore') })
  restoreConfirmButton.addEventListener('click', () => { if (!destroyed && restoreConfirmMask.isConnected && !restoreConfirmButton.disabled) call('onConfirmRestore') })
  restoreConfirm.append(restoreConfirmTitle, restoreConfirmText, restoreCancel, restoreConfirmButton); restoreConfirmMask.appendChild(restoreConfirm)
  let restoreWasOpen = false, restoreFocus = null
  restoreConfirm.addEventListener('keydown', event => {
    if (destroyed || !restoreConfirmMask.isConnected) return
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); call('onCancelRestore'); return }
    if (event.key !== 'Tab') return
    const choices = [restoreCancel, restoreConfirmButton].filter(button => !button.disabled), index = choices.indexOf(document.activeElement)
    if (index < 0 || (event.shiftKey ? index === 0 : index === choices.length - 1)) {
      event.preventDefault(); choices[event.shiftKey ? choices.length - 1 : 0].focus({ preventScroll: true })
    }
  })
  function renderRestoreConfirm() {
    const open = !!state.open && state.restoreConfirm?.open === true
    if (open && !restoreWasOpen) restoreFocus = document.activeElement
    left.inert = right.inert = open
    setText(restoreConfirmText, open ? state.restoreConfirm.text : '')
    restoreConfirmButton.disabled = !!state.restoreConfirm?.disabled
    mountNode(el, restoreConfirmMask, open)
    if (open && !restoreWasOpen) restoreCancel.focus({ preventScroll: true })
    if (!open && restoreWasOpen && state.open && el.isConnected) {
      const focus = restoreFocus?.isConnected && el.contains(restoreFocus) && !restoreFocus.disabled ? restoreFocus : restoreButton.disabled ? backButton : restoreButton
      focus.focus({ preventScroll: true })
    }
    restoreWasOpen = open
  }

  previewBox.appendChild(previewHead)
  previewBox.appendChild(previewMeta)
  previewBox.appendChild(degradedNode)
  previewBox.appendChild(diffBox)
  previewBox.appendChild(bodyBox)
  previewBox.append(changesMessage, changesList, changePager)

  leftContent.appendChild(errorNode)
  leftContent.appendChild(emptyNode)
  leftContent.appendChild(previewBox)

  left.appendChild(leftHeader)
  left.appendChild(leftContent)

  // ── 右栏 ──
  const right = document.createElement('div')
  right.className = 'lark-doc-version-right'

  const rightHeader = document.createElement('div')
  rightHeader.className = 'lark-doc-version-right-header'
  const rightTitle = document.createElement('span')
  rightTitle.className = 'lark-doc-version-right-title'
  rightTitle.textContent = '历史记录'
  const rightIcon = document.createElement('span')
  rightIcon.className = 'lark-doc-version-right-icon'
  rightIcon.appendChild(iconNode('chevronDown', 24))
  rightHeader.appendChild(rightTitle)
  const trashToggle = document.createElement('button')
  trashToggle.type = 'button'
  trashToggle.className = 'lark-doc-version-trash-toggle'
  trashToggle.textContent = '回收站'
  trashToggle.addEventListener('click', () => { if (!trashToggle.disabled) call('onOpenTrash') })
  rightHeader.appendChild(trashToggle)
  rightHeader.appendChild(rightIcon)

  const timeline = document.createElement('div')
  timeline.className = 'lark-doc-version-timeline'
  const timelineError = document.createElement('p')
  timelineError.className = 'lark-doc-version-empty'

  const rightFooter = document.createElement('div')
  rightFooter.className = 'lark-doc-version-right-footer'
  rightFooter.textContent = '显示更改'

  right.appendChild(rightHeader)
  right.appendChild(timeline)
  right.appendChild(rightFooter)

  const trash = document.createElement('section')
  trash.className = 'lark-doc-version-trash'
  setAttr(trash, 'role', 'dialog')
  setAttr(trash, 'aria-label', '版本回收站')
  const trashHeader = document.createElement('header')
  trashHeader.className = 'lark-doc-version-trash-header'
  const trashTitle = document.createElement('strong')
  trashTitle.textContent = '版本回收站'
  const trashClose = document.createElement('button')
  trashClose.type = 'button'
  trashClose.textContent = '关闭'
  trashClose.addEventListener('click', () => call('onCloseTrash'))
  trashHeader.appendChild(trashTitle)
  trashHeader.appendChild(trashClose)
  const trashEmpty = document.createElement('p')
  trashEmpty.className = 'lark-doc-version-empty'
  trashEmpty.textContent = '回收站为空'
  const trashList = document.createElement('ul')
  trashList.className = 'lark-doc-version-trash-list'
  let trashSignature = null

  function renderTrash() {
    const stateTrash = state.trash
    // 接线尚未提供时不展示无效入口；由 panelsUiMixin 明确传入完整契约。
    trashToggle.hidden = !stateTrash
    trashToggle.disabled = !stateTrash || !stateTrash.canManage
    setAttr(trashToggle, 'title', stateTrash ? stateTrash.reason : '')
    setAttr(trashToggle, 'data-capability', 'canCreateVersion')
    setAttr(trashToggle, 'aria-disabled', String(trashToggle.disabled))
    const items = stateTrash ? stateTrash.items || [] : []
    const signature = JSON.stringify({ items, busy: stateTrash?.busy, canManage: stateTrash?.canManage })
    if (signature !== trashSignature) {
      trashSignature = signature
      const rows = items.map(item => {
        const row = document.createElement('li')
        const label = document.createElement('span')
        setText(label, `${item.name || ''} · ${item.label || '未命名版本'}`)
        row.appendChild(label)
        ;[['恢复', 'onRestoreDeleted'], ['彻底删除', 'onPurgeDeleted']].forEach(([title, handler]) => {
          const action = document.createElement('button')
          action.type = 'button'
          action.textContent = title
          action.disabled = !!stateTrash.busy || !stateTrash.canManage
          setAttr(action, 'aria-disabled', String(action.disabled))
          action.addEventListener('click', () => { if (!action.disabled) call(handler, item.id) })
          row.appendChild(action)
        })
        return { node: row, on: true }
      })
      syncChildren(trashList, rows)
    }
    syncChildren(trash, [
      { node: trashHeader, on: true },
      { node: trashEmpty, on: !items.length },
      { node: trashList, on: !!items.length },
    ])
    syncChildren(el, [
      { node: left, on: true }, { node: right, on: true },
      { node: trash, on: !!stateTrash?.open }, { node: restoreConfirmMask, on: !!state.restoreConfirm?.open },
    ])
  }

  syncChildren(el, [{ node: left, on: true }, { node: right, on: true }])

  /** 时间线的重建闸门：签名没变就一个节点都不动。 */
  let daysSignature = null

  function buildDay(day) {
    const box = document.createElement('div')
    box.className = 'lark-doc-version-day'
    const label = document.createElement('button')
    label.type = 'button'
    label.className = 'lark-doc-version-day-label'
    label.textContent = day.label == null ? '' : String(day.label)
    box.appendChild(label)
    const rows = document.createElement('div'); rows.hidden = collapsedDays.has(day.key); box.appendChild(rows)
    label.setAttribute('aria-expanded', String(!rows.hidden))
    label.addEventListener('click', () => { rows.hidden = !rows.hidden; label.setAttribute('aria-expanded', String(!rows.hidden)); if (rows.hidden) collapsedDays.add(day.key); else collapsedDays.delete(day.key) })
    const items = day.items || [], visible = expandedDays.has(day.key) ? items : items.slice(0, 3)
    visible.forEach((item) => {
      const row = document.createElement('button')
      row.type = 'button'
      row.className = item.cls ? `lark-doc-version-item ${item.cls}` : 'lark-doc-version-item'
      row.addEventListener('click', () => { if (destroyed) return; mobileView = 'preview'; mobileSelectedId = item.id; call('onSelect', item.id); render() })
      const name = document.createElement('div')
      name.className = 'lark-doc-version-item-name'
      name.textContent = item.name == null ? '' : String(item.name)
      const desc = document.createElement('div')
      desc.className = 'lark-doc-version-item-desc'
      desc.textContent = item.desc == null ? '' : String(item.desc)
      const user = document.createElement('div')
      user.className = 'lark-doc-version-item-user'
      user.textContent = item.user == null ? '' : String(item.user)
      row.appendChild(name)
      row.appendChild(desc)
      row.appendChild(user)
      rows.appendChild(row)
    })
    if (items.length > visible.length) {
      const more = document.createElement('button'); more.type = 'button'; more.className = 'lark-doc-version-more-history'; more.textContent = '展开更多历史记录'
      more.addEventListener('click', () => { expandedDays.add(day.key); daysSignature = null; renderTimeline() }); rows.appendChild(more)
    }
    return box
  }

  function renderTimeline() {
    const signature = JSON.stringify({ error: state.timelineError, days: state.days })
    if (signature === daysSignature) return
    daysSignature = signature
    setText(timelineError, state.timelineError)
    syncChildren(timeline, [
      { node: timelineError, on: !!state.timelineError },
      ...(state.days || []).map((day) => ({ node: buildDay(day), on: true })),
    ])
  }

  function renderPreview() {
    const preview = mobile() && mobileView === 'preview' && mobileSelectedId && state.preview?.id !== mobileSelectedId ? {} : state.preview || {}
    setText(previewTitle, preview.title || '未命名版本')
    setText(previewKind, preview.kind)
    const meta = preview.meta || []
    metaSpans.forEach((span, index) => {
      if (index < meta.length) setText(span, meta[index])
    })
    syncChildren(previewMeta, metaSpans.map((span, index) => ({ node: span, on: index < meta.length })))
    setText(degradedNode, preview.degraded)
    const degradedOn = !!preview.degraded
    // `v-if` / 组件外的兄弟：降级文案与 diff 段各自独立。
    syncChildren(previewBox, [
      { node: previewHead, on: true },
      { node: previewMeta, on: true },
      { node: degradedNode, on: degradedOn },
      { node: diffBox, on: !!preview.diff },
      { node: bodyBox, on: true },
      { node: changesMessage, on: true }, { node: changesList, on: !!preview.changes?.length }, { node: changePager, on: true },
    ])
    if (preview.diff) setText(diffRow, preview.diff.row)
    // `payload` 非空 = 该版本正文是可解码的二进制快照（模板里的 `v-if`）；空则走兜底文案。
    const payload = preview.payload || ''
    if (payload) setText(binaryPayload, payload)
    const decoded = preview.document && typeof options.renderDocument === 'function'
    if (previewRecord !== preview.document || mountedPolicy !== state.previewPolicyKey || !decoded) {
      clearDocument()
      if (decoded) { previewRecord = preview.document; mountedPolicy = state.previewPolicyKey; releasePreview = options.renderDocument(documentBody, preview.document) || null }
    }
    syncChildren(bodyBox, [
      { node: documentBody, on: !!decoded },
      { node: binaryPayload, on: !decoded && !!payload },
      { node: binaryMissing, on: !decoded && !payload },
    ])
    const changes = preview.changes || [], at = preview.changeIndex || 0
    setText(changeCursor, preview.changeCursor || '编辑记录 0/0')
    changePrev.disabled = !!preview.changesLoading || at <= 1
    changeNext.disabled = !!preview.changesLoading || at >= changes.length
    setText(changesMessage, preview.changesLoading ? '正在载入版本差异…' : preview.changesError || (!changes.length ? '没有编辑差异' : ''))
    const signature = JSON.stringify(changes)
    if (signature !== changesSignature) {
      changesSignature = signature; changesList.replaceChildren(); lastChangeIndex = -1
      changes.forEach((change, index) => {
        const row = document.createElement('li'); row.className = 'lark-doc-version-change'; row.dataset.changeIndex = String(index + 1)
        const title = document.createElement('strong'), path = document.createElement('code'), value = document.createElement('pre')
        setText(title, ({ add: '添加', remove: '删除', replace: '修改' })[change.kind] || '变更'); setText(path, change.path)
        setText(value, [Object.hasOwn(change, 'before') ? JSON.stringify(change.before, null, 2) : '', Object.hasOwn(change, 'after') ? JSON.stringify(change.after, null, 2) : ''].filter(Boolean).join(' → '))
        row.append(title, path, value); changesList.appendChild(row)
      })
    }
    changesList.querySelectorAll('[data-change-index]').forEach(row => row.classList.toggle('is-active', Number(row.dataset.changeIndex) === at))
    if (at !== lastChangeIndex && at > 0) {
      documentBody.querySelectorAll('.is-version-change').forEach(node => node.classList.remove('is-version-change'))
      lastChangeIndex = at
      const change = changes[at - 1]
      let value = preview.document?.content, blockId = value?.attrs?.blockId
      if (change?.kind !== 'remove' && typeof change?.path === 'string') {
        for (const part of change.path.split('/').slice(1).map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'))) {
          if (!value || typeof value !== 'object' || !Object.hasOwn(value, part)) { blockId = null; break }
          value = value[part]; if (value?.attrs?.blockId) blockId = value.attrs.blockId
        }
      } else blockId = null
      const target = blockId ? [...documentBody.querySelectorAll('[data-block-id]')].find(node => node.getAttribute('data-block-id') === blockId) : null
      target?.classList.add('is-version-change')
      ;(target || changesList.children[at - 1])?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
    }
  }

  function render() {
    el.classList.toggle('is-phone-list', mobile() && mobileView === 'list')
    el.classList.toggle('is-phone-preview', mobile() && mobileView === 'preview')
    el.classList.toggle('is-saved-versions', state.kind === 'saved')
    backButton.setAttribute('aria-label', mobile() && mobileView === 'preview' ? '返回版本列表' : '返回文档')
    savedMenu.hidden = state.kind !== 'saved'
    setText(rightTitle, state.kind === 'saved' ? '已存版本' : '历史记录')
    setText(cursorLabel, state.pager.cursor)
    restoreButton.disabled = !!state.restore.disabled
    setAttr(restoreButton, 'aria-disabled', String(restoreButton.disabled))
    setAttr(restoreButton, 'title', state.restore.title)
    applyStyle(restoreButton, state.restore.style)
    prevButton.disabled = !!state.pager.prev.disabled
    applyStyle(prevButton, state.pager.prev.style)
    nextButton.disabled = !!state.pager.next.disabled
    applyStyle(nextButton, state.pager.next.style)

    setText(errorNode, state.errorText)
    setText(emptyNode, state.emptyText)
    syncChildren(leftContent, [
      { node: errorNode, on: state.view === 'error' },
      { node: emptyNode, on: state.view === 'empty' },
      { node: previewBox, on: state.view === 'preview' },
    ])
    if (state.view === 'preview') renderPreview(); else clearDocument()
    renderTimeline()
    renderTrash()
    renderRestoreConfirm()
  }

  function update(patch) {
    if (destroyed) return
    const opening = !state.open && patch?.open, changed = patch?.contextKey !== undefined && patch.contextKey !== state.contextKey
    if (opening || changed) { mobileView = 'list'; mobileSelectedId = ''; clearDocument(); changesSignature = ''; lastChangeIndex = -1 }
    Object.assign(state, patch || {})
    mountNode(host, el, !!state.open)
    if (!state.open) { clearDocument(); restoreWasOpen = false; left.inert = right.inert = false; restoreConfirmMask.remove(); setText(restoreConfirmText, ''); return }
    render()
  }

  return {
    el,
    update,
    destroy() { if (destroyed) return; destroyed = true; clearDocument(); restoreConfirmMask.remove(); setText(restoreConfirmText, ''); if (el.parentNode) el.parentNode.removeChild(el) },
  }
}

/* ═════════════════════ ③ 另存为版本 Dialog ═════════════════════ */

/**
 * 「另存为版本」Dialog + 恢复成功 toast（`SaveVersionDialog.vue`）。
 *
 * 两件事与历史面板**正好相反**（不是笔误）：
 * - `Esc` **能关**（`@keydown.esc.stop.prevent="closeSaveVersionDialog()"`）；
 * - **点遮罩不关**（⑤-2 未采，关掉会丢输入，刻意保守）。
 *
 * toast 与 Dialog 是**同级兄弟**且共用一层包裹（`v-if="open || notice"`）：
 * 关掉 Dialog 后 toast 仍在，所以包裹层不能跟着 `open` 一起摘。
 *
 * state: `{ open, notice, title, value, maxLength, counter, confirm: { disabled, title, style }, error }`
 */
export function createSaveVersionDialog(options = {}) {
  const host = options.host || null
  const call = handlerCaller(options.handlers || {})

  const state = {
    open: false,
    notice: '',
    title: '',
    value: '',
    maxLength: 1000,
    counter: '0/1000',
    confirm: { disabled: true, title: '', style: null },
    error: '',
  }

  // 包裹层：`v-if="open || notice"` —— 两个子节点共用，摘掉它会把 toast 一起带走。
  const el = document.createElement('div')

  const mask = document.createElement('div')
  mask.className = 'lark-doc-save-version-mask'

  const wrap = document.createElement('div')
  wrap.className = 'lark-doc-save-version-wrap'
  wrap.setAttribute('tabindex', '-1')
  wrap.setAttribute('role', 'dialog')
  wrap.setAttribute('aria-modal', 'true')
  wrap.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return
    event.stopPropagation()
    event.preventDefault()
    call('onClose')
  })

  const dialog = document.createElement('section')
  dialog.className = 'lark-doc-save-version-dialog'

  const header = document.createElement('header')
  header.className = 'lark-doc-save-version-header'
  const titleNode = document.createElement('h3')
  titleNode.className = 'lark-doc-save-version-title'
  const closeButton = document.createElement('button')
  closeButton.type = 'button'
  closeButton.className = 'lark-doc-save-version-close'
  closeButton.setAttribute('aria-label', '关闭')
  closeButton.appendChild(iconNode('close', 20))
  onMouseDownPrevent(closeButton, () => call('onClose'))
  header.appendChild(titleNode)
  header.appendChild(closeButton)

  const body = document.createElement('div')
  body.className = 'lark-doc-save-version-body'
  const field = document.createElement('div')
  field.className = 'lark-doc-save-version-field'
  const inputId = `lark-doc-save-version-input-${++saveVersionInputSequence}`
  const label = document.createElement('label')
  label.className = 'lark-doc-save-version-label'
  label.setAttribute('for', inputId)
  label.textContent = '版本名称'
  const inputRow = document.createElement('div')
  inputRow.className = 'lark-doc-save-version-input-row'
  const input = document.createElement('input')
  input.id = inputId
  input.className = 'lark-doc-save-version-input'
  input.type = 'text'
  input.setAttribute('placeholder', '请输入名称')
  input.addEventListener('input', (event) => call('onInput', event.target.value))
  const counter = document.createElement('span')
  counter.className = 'lark-doc-save-version-counter'
  inputRow.appendChild(input)
  inputRow.appendChild(counter)
  field.appendChild(label)
  field.appendChild(inputRow)
  body.appendChild(field)

  const footer = document.createElement('footer')
  footer.className = 'lark-doc-save-version-footer'
  const cancelButton = document.createElement('button')
  cancelButton.type = 'button'
  cancelButton.className = 'lark-doc-save-version-cancel'
  cancelButton.textContent = '取消'
  onMouseDownPrevent(cancelButton, () => call('onClose'))
  const confirmButton = document.createElement('button')
  confirmButton.type = 'button'
  confirmButton.className = 'lark-doc-save-version-confirm'
  confirmButton.textContent = '确定'
  confirmButton.setAttribute('data-capability', 'canCreateVersion')
  onMouseDownPrevent(confirmButton, () => { if (!confirmButton.disabled) call('onConfirm') })
  footer.appendChild(cancelButton)
  footer.appendChild(confirmButton)

  const errorNode = document.createElement('p')
  errorNode.className = 'lark-doc-save-version-error'

  dialog.appendChild(header)
  dialog.appendChild(body)
  dialog.appendChild(footer)
  dialog.appendChild(errorNode)
  wrap.appendChild(dialog)
  mask.appendChild(wrap)

  // toast：首个子节点**必须**是 span（断言读 `notice.firstChild.textContent`）。
  const notice = document.createElement('div')
  notice.className = 'lark-doc-version-notice'
  notice.setAttribute('role', 'status')
  const noticeText = document.createElement('span')
  const noticeLink = document.createElement('button')
  noticeLink.type = 'button'
  noticeLink.className = 'lark-doc-version-notice-link'
  noticeLink.textContent = '立即查看'
  onMouseDownPrevent(noticeLink, () => call('onNoticeLink'))
  notice.appendChild(noticeText)
  notice.appendChild(noticeLink)

  el.appendChild(mask)
  el.appendChild(notice)

  function render() {
    setText(titleNode, state.title)
    setAttr(wrap, 'aria-label', state.title)
    setAttr(input, 'maxlength', state.maxLength)
    setInputValue(input, state.value)
    setText(counter, state.counter)
    confirmButton.disabled = !!state.confirm.disabled
    setAttr(confirmButton, 'aria-disabled', String(confirmButton.disabled))
    setAttr(confirmButton, 'title', state.confirm.title)
    applyStyle(confirmButton, state.confirm.style)
    setText(errorNode, state.error)
    syncChildren(dialog, [
      { node: header, on: true },
      { node: body, on: true },
      { node: footer, on: true },
      { node: errorNode, on: !!state.error },
    ])
    setText(noticeText, state.notice)
    syncChildren(el, [
      { node: mask, on: !!state.open },
      { node: notice, on: !!state.notice },
    ])
  }

  function update(patch) {
    Object.assign(state, patch || {})
    // 包裹层跟着 `open || notice` 走；两者都假时整棵摘掉。
    mountNode(host, el, !!state.open || !!state.notice)
    if (!el.parentNode) return
    render()
  }

  return {
    el,
    update,
    focusInput() { if (el.parentNode) input.focus() },
    destroy() { if (el.parentNode) el.parentNode.removeChild(el) },
  }
}

/* ═══════════════════════ ④ 评论面板层 ═══════════════════════ */

/**
 * 评论面板层（`CommentPanel.vue`）。
 *
 * 容器 `.lark-doc-comment-layer` 是 `display: contents`（`styles/comments.css`）——
 * 它不产生盒子，每张卡自己 `position: fixed`。断言量 `getComputedStyle(layer).display === 'contents'`。
 *
 * 一张卡由四段组成（顺序固定）：头（引用 + 六格控件条）/ 回复流 / 输入区 / 面板头「更多」。
 * 头、输入区、「更多」在工厂里建一次；回复流按签名重建（回复与菜单都可能随时变）。
 *
 * 五条实测负结论（SFC 文件头），别「补全」：
 * 1. 两套「更多」不合并：面板头是「私有评论」开关，回复行是四项菜单。
 * 2. `⌘+Enter` 不提交，草稿只有「点发送」一条出口。
 * 3. 删除无二次确认、无红色变体。
 * 4. 面板头「更多」里没有删除 / 解决 / 重开。
 * 5. 无权限是**置灰**（`is-disabled`）而不是隐藏，点下去由 mixin 的闸门 return。
 *
 * state:
 * ```
 * {
 *   open, title,
 *   controls: [{ id, label, split, icon, iconSize, tone }],
 *   replyControls: [{ id, label, icon, iconSize }],
 *   moreTitle, moreHint,
 *   items: [{
 *     id, style,
 *     quote,
 *     disabled: [controlId…],
 *     replies: [{ id, name, time, body, menuOpen, menus: [{ id, label, submenu, visible }] }],
 *     textarea: { value, readonly, height },
 *     hasDraft, allowedReply, moreOpen, privateOn,
 *   }],
 * }
 * ```
 */
export function createCommentPanel(options = {}) {
  const host = options.host || null
  let destroyed = false
  const invoke = handlerCaller(options.handlers || {})
  const call = (...args) => { if (!destroyed && (!state.viewerHost || state.viewerCurrent?.() === true)) return invoke(...args) }
  const richInputs = new Map()
  const richInput = (className, label, placeholder, onChange) => {
    const editor = (options.composerFactory || createPlainCommentInput)({ label, placeholder, onChange: draft => {
      const event = new CustomEvent('comment-input', { detail: draft })
      event.commentDraft = draft
      onChange(draft.content, event)
    } })
    editor.el.classList.add(className)
    richInputs.set(editor.el, editor)
    return editor.el
  }
  const updateRichInput = (input, draft, scope) => richInputs.get(input).update({ ...draft, scopeKey: `${state.identityGeneration || 0}/${scope}` })
  // Preserve the editing selection on pointer press; activate through native click
  // so keyboard and assistive-technology activation follow the same guarded path.
  const onAction = (node, run) => {
    node.addEventListener('mousedown', event => { event.preventDefault(); event.stopPropagation() })
    // Wait for the browser's click. A pointerup action can replace this node
    // and retarget the compatibility click into the newly opened picker.
    node.addEventListener('click', event => {
      if (!node.isConnected || !el.isConnected || node.closest('[hidden], details:not([open])') || node.disabled || node.getAttribute('aria-disabled') === 'true') return
      run(event)
    })
  }
  // The injected rich input forwards this only after its ProseMirror IME guard.
  const bindSubmitShortcut = (input, send) => {
    input.addEventListener('comment-keydown', ({ detail: event }) => {
      if (event.defaultPrevented || event.key !== 'Enter' || !(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey
        || event.isComposing || event.keyCode === 229 || input.__composing) return
      event.preventDefault(); event.stopPropagation()
      if (!destroyed && el.isConnected && input.isConnected && send.isConnected && !input.readOnly
        && input.getAttribute('aria-readonly') !== 'true' && input.getAttribute('contenteditable') !== 'false'
        && !send.disabled && send.getAttribute('aria-disabled') !== 'true' && !send.classList.contains('is-disabled')) send.click()
    })
  }
  // PM consumes native Escape (keyCode 27) after its DOM hook. Close the image
  // portal here, after child pickers but before that default can hide the intent.
  const bindViewerEscape = input => input.addEventListener('comment-keydown', ({ detail: event }) => {
    if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || event.keyCode === 229 || input.__composing
      || !state.viewerHost || state.viewerCurrent?.() !== true || !el.isConnected || !input.isConnected || !state.open) return
    event.preventDefault(); event.stopPropagation()
    call('onToggleSidebar')
  })
  const imageDraftNodes = (scope, images = []) => images.map(image => {
    const row = document.createElement('div')
    const preview = document.createElement(image.previewUrl ? 'img' : 'span')
    if (image.previewUrl) { preview.src = image.previewUrl; preview.alt = image.fileName || '' }
    else preview.textContent = image.fileName || ''
    const remove = document.createElement('button')
    remove.type = 'button'; remove.textContent = '×'
    remove.setAttribute('aria-label', '移除图片：' + (image.fileName || ''))
    onAction(remove, () => call('onRemoveDraftImage', scope, image.assetId))
    row.append(preview, remove)
    return { node: row, on: true }
  })
  const renderMentionPicker = (node, picker, input, scope = 'document') => {
    const editable = () => !input.readOnly && input.getAttribute('aria-readonly') !== 'true'
    const ownedFocus = node.contains(node.ownerDocument.activeElement)
    const focusedIndex = [...node.querySelectorAll('[role="option"]')].indexOf(node.ownerDocument.activeElement)
    node.textContent = ''
    const pending = picker && !(picker.candidates || []).length && picker.status
    setAttr(node, 'role', pending ? 'group' : 'listbox')
    setAttr(node, 'aria-busy', picker?.status === 'loading' ? 'true' : null)
    if (pending) {
      const message = document.createElement('p'); message.className = 'lark-doc-comment-mention-status'; message.setAttribute('role', 'status')
      message.textContent = picker.status === 'loading' ? '加载中…' : picker.status === 'empty' ? '未找到可提及对象' : picker.status === 'unknown' ? '结果尚未确定，请查询原操作。' : picker.status === 'blocked' ? '目录暂不可用，请稍后重试。' : '加载失败，请重试。'
      node.append(message)
      if (picker.status === 'loading') {
        const skeleton = document.createElement('div'); skeleton.className = 'lark-doc-comment-mention-skeleton'; skeleton.setAttribute('aria-hidden', 'true')
        for (let i = 0; i < 4; i++) skeleton.append(document.createElement('span'))
        node.append(skeleton)
      } else if (picker.status !== 'empty') {
        const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'lark-doc-comment-mention-retry'
        retry.textContent = picker.operationId ? '查询原提及操作' : '重试'; retry.setAttribute('aria-label', retry.textContent)
        retry.disabled = !editable()
        onAction(retry, () => { if (retry.parentElement === node && !node.closest('[hidden]') && editable()) call('onRetryDocumentMention', scope) }); node.append(retry)
      }
    }
    (picker?.candidates || []).forEach((candidate, index) => {
      const button = document.createElement('button')
      button.type = 'button'; button.setAttribute('role', 'option'); button.setAttribute('aria-selected', String(index === picker.index))
      button.disabled = !editable()
      const label = candidate.displayName || candidate.name || candidate.principalId || candidate.docId || ''
      button.setAttribute('aria-label', label)
      if (node === documentComposerMentionPicker) {
        const avatar = document.createElement('span'), name = document.createElement('span')
        avatar.className = 'lark-doc-comment-mention-avatar'; avatar.setAttribute('aria-hidden', 'true'); avatar.textContent = candidate.docId ? '文' : Array.from(label)[0] || ''
        name.textContent = label; button.append(avatar, name)
      } else button.textContent = label
      button.addEventListener('mousedown', event => event.stopPropagation())
      onAction(button, () => {
        if (button.parentElement !== node || node.closest('[hidden]') || !editable() || (node === documentComposerMentionPicker && !isDocumentMentionOpen())) return
        call(scope.startsWith('reply/') ? 'onChooseMention' : 'onChooseDocumentMention', candidate); richInputs.get(input)?.focus()
      })
      node.appendChild(button)
    })
    if (ownedFocus) {
      const option = focusedIndex >= 0 ? node.querySelectorAll('[role="option"]')[focusedIndex] : null
      if (option) option.focus({ preventScroll: true })
      else if (node === documentComposerMentionPicker && isDocumentMentionOpen()) documentMentionCancel.focus({ preventScroll: true })
      else richInputs.get(input)?.focus()
    }
  }

  const state = {
    open: false,
    remote: false,
    title: '评论',
    controls: [],
    replyControls: [],
    moreTitle: '',
    moreHint: '',
    emptyText: '',
    sidebarOpen: false,
    composer: { open: false },
    items: [],
  }

  const el = document.createElement('div')
  el.className = 'lark-doc-comment-layer'
  const documentFlow = document.createElement('section')
  documentFlow.className = 'lark-doc-comment-layer is-mobile is-inline-document is-drawer-document'
  documentFlow.setAttribute('role', 'region'); documentFlow.setAttribute('aria-label', '全文评论')
  const launcher = document.createElement('div'); launcher.className = 'lark-doc-comment-launcher'
  const launcherButton = document.createElement('button'); launcherButton.type = 'button'
  launcherButton.setAttribute('aria-label', '展开评论'); launcherButton.setAttribute('aria-expanded', 'false')
  launcherButton.appendChild(iconNode('mode-comment', 18)); launcher.appendChild(launcherButton)
  launcherButton.addEventListener('mousedown', event => event.preventDefault())
  launcherButton.addEventListener('click', () => {
    if (!destroyed && launcherButton.isConnected && isMobile() && state.launcher?.visible && !state.sidebarOpen && !state.composer?.open) call('onToggleSidebar')
  })
  const documentHeading = document.createElement('h2')
  const notice = document.createElement('div')
  notice.className = 'lark-doc-comment-media-status lark-doc-comment-notice'
  notice.setAttribute('role', 'status')
  notice.setAttribute('aria-live', 'polite')
  notice.setAttribute('aria-atomic', 'true')
  documentHeading.className = 'lark-doc-document-comment-heading'
  documentHeading.textContent = '全文评论'
  const mobileSheet = document.createElement('section')
  mobileSheet.className = 'lark-doc-comment-mobile-sheet'
  mobileSheet.setAttribute('role', 'dialog')
  mobileSheet.setAttribute('aria-modal', 'true')
  const mobileHead = document.createElement('header')
  mobileHead.className = 'lark-doc-comment-mobile-head'
  const mobileTitle = document.createElement('span')
  mobileTitle.setAttribute('aria-live', 'polite')
  const mobilePrev = document.createElement('button'), mobileNext = document.createElement('button'), mobileClose = document.createElement('button')
  ;[mobilePrev, mobileNext, mobileClose].forEach(button => { button.type = 'button' })
  mobilePrev.setAttribute('aria-label', '上一条评论'); mobilePrev.textContent = '‹'
  mobileNext.setAttribute('aria-label', '下一条评论'); mobileNext.textContent = '›'
  mobileClose.setAttribute('aria-label', '关闭评论'); mobileClose.textContent = '×'
  mobileHead.append(mobileTitle, mobilePrev, mobileNext, mobileClose)
  const mobileCarousel = document.createElement('div')
  mobileCarousel.className = 'lark-doc-comment-mobile-carousel'
  mobileCarousel.setAttribute('aria-label', '选区评论轮播')
  const mobileDocumentList = document.createElement('div')
  mobileDocumentList.className = 'lark-doc-comment-mobile-document-list'
  let mobileIds = [], mobileActive = '', scrollFrame = 0, restoreMobileFocus = null, wasMobileOpen = false, mobileScope = '', unlockScroll = null
  let nativeThreadOpen = false
  const syncScrollLock = enabled => {
    if (enabled && !unlockScroll) {
      const targets = [el.ownerDocument.body, options.inlineHost?.closest('.lark-doc-main')].filter(Boolean)
      const release = [...new Set(targets)].map(lockPageScroll)
      unlockScroll = () => release.reverse().forEach(unlock => unlock())
    }
    else if (!enabled && unlockScroll) { unlockScroll(); unlockScroll = null }
  }
  const isMobile = () => !state.viewerHost && el.ownerDocument.defaultView.innerWidth <= 760
  let deleteConfirmation = null
  const closeDeleteConfirmation = (restore = false) => {
    const confirmation = deleteConfirmation
    if (!confirmation) return
    const ownedFocus = confirmation.ownedFocus()
    deleteConfirmation = null; confirmation.el.remove(); confirmation.unlock()
    if (restore && confirmation.intent.current() && ownedFocus) {
      const entry = panelNodes.get(confirmation.threadId)
      const reply = [...(entry?.replies.querySelectorAll('[data-comment-reply]') || [])].find(node => node.dataset.commentReply === confirmation.replyId)
      reply?.querySelector('[data-comment-reply-control="more"]')?.focus({ preventScroll: true })
    }
  }
  const requestDeleteConfirmation = (threadId, replyId, scope) => {
    if (!scope?.current()) return
    const intent = call('onRequestDelete', threadId, replyId, scope)
    if (!intent?.current()) return
    closeDeleteConfirmation()
    call('onCloseMenus')
    const backdrop = document.createElement('div'); backdrop.className = 'lark-doc-comment-delete-mask'
    const dialog = document.createElement('section'); dialog.className = 'lark-doc-comment-delete-dialog'
    dialog.setAttribute('role', 'alertdialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-label', '删除评论')
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = '取消'; cancel.setAttribute('aria-label', '取消删除评论')
    const confirm = document.createElement('button'); confirm.type = 'button'; confirm.textContent = '删除评论'; confirm.setAttribute('aria-label', '确认删除评论')
    const focus = () => dialog.getRootNode().activeElement || dialog.ownerDocument.activeElement
    const targets = [el.ownerDocument.body, options.inlineHost?.closest('.lark-doc-main')].filter(Boolean)
    const release = [...new Set(targets)].map(lockPageScroll)
    const confirmation = { el: backdrop, intent, threadId, replyId,
      ownedFocus: () => dialog.contains(focus()), unlock: () => release.reverse().forEach(unlock => unlock()) }
    onAction(cancel, () => closeDeleteConfirmation(true))
    onAction(confirm, () => {
      if (deleteConfirmation !== confirmation || !intent.current() || (state.viewerHost && state.viewerCurrent?.() !== true)) { closeDeleteConfirmation(); return }
      closeDeleteConfirmation()
      void intent.confirm()
    })
    dialog.addEventListener('keydown', event => {
      if (event.isComposing || event.keyCode === 229) return
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeDeleteConfirmation(true) }
      if (event.key === 'Tab') { event.preventDefault(); (focus() === cancel ? confirm : cancel).focus() }
    })
    backdrop.addEventListener('click', event => { if (event.target === backdrop) closeDeleteConfirmation(true) })
    dialog.append(confirm, cancel); backdrop.append(dialog)
    deleteConfirmation = confirmation
    ;(state.viewerHost || host || el.parentElement).append(backdrop)
    cancel.focus({ preventScroll: true })
  }
  const positionReplyMenus = () => {
    panelNodes.forEach(entry => entry.replies.querySelectorAll('.is-mobile-menu').forEach(menu => {
      const trigger = menu.closest('[data-comment-reply]')?.querySelector('[data-comment-reply-control="more"]')
      if (menu.isConnected && trigger?.isConnected) placeMenu(menu, trigger, 8, { align: 'end', maxWidth: menu.classList.contains('is-mobile-document-menu') ? 326 : 328 })
    }))
  }
  let replyMenuCloseTimer = null, dismissedReplyHover = null
  const cancelReplyMenuClose = () => { clearTimeout(replyMenuCloseTimer); replyMenuCloseTimer = null }
  const hoverReply = (node, threadId, replyId, event) => {
    const view = el.ownerDocument.defaultView
    if (destroyed || !state.open || !el.isConnected || !node.isConnected || !el.contains(node) || node.closest('[hidden], [inert]') ||
        view.innerWidth <= 760 || event?.sourceCapabilities?.firesTouchEvents || (event?.pointerType && event.pointerType !== 'mouse') ||
        (view.matchMedia && (!view.matchMedia('(hover: hover)').matches || view.matchMedia('(pointer: coarse)').matches))) return null
    const reply = state.items?.find(item => item.id === threadId)?.replies?.find(item => item.id === replyId && !item.tombstone)
    return reply || null
  }
  const enterReplyMenu = (node, threadId, replyId, event) => {
    const reply = hoverReply(node, threadId, replyId, event)
    if (!reply || node.disabled || (dismissedReplyHover?.threadId === threadId && dismissedReplyHover.replyId === replyId)) return
    cancelReplyMenuClose()
    if (!reply.menuOpen) call('onReplyControl', 'more', threadId, replyId, event)
  }
  const leaveReplyMenu = (node, threadId, replyId, event) => {
    if (!hoverReply(node, threadId, replyId, event)) return
    if (dismissedReplyHover?.threadId === threadId && dismissedReplyHover.replyId === replyId) { dismissedReplyHover = null; return }
    const region = node.closest('.lark-doc-comment-reply'), next = event.relatedTarget
    if (next?.nodeType && region?.contains(next) && next.closest?.('[data-comment-reply-control="more"], .lark-doc-comment-reply-menu')) { cancelReplyMenuClose(); return }
    cancelReplyMenuClose()
    const identity = state.identityGeneration
    replyMenuCloseTimer = setTimeout(() => {
      replyMenuCloseTimer = null
      if (identity === state.identityGeneration && hoverReply(node, threadId, replyId)?.menuOpen) call('onCloseMenus')
    }, 150)
  }
  const isInlineDocument = () => !!options.inlineHost && state.documentInline === true && isMobile() && (!state.open || (state.mobileScope !== 'selection' && !state.composer?.open))
  const isReferenceDrawer = () => !nativeThreadOpen && isMobile() && state.open && state.sidebarOpen && state.mobileScope === 'selection' && !state.composer?.open && !state.historical
  const isMobileBackdrop = () => isMobile() && !isInlineDocument() && !isReferenceDrawer()
  const hasInlineDocument = () => isInlineDocument() || (isReferenceDrawer() && state.documentInline === true)
  const isDocumentMentionOpen = () => state.documentComposer?.open === true && state.documentComposer.readonly !== true && !!(state.documentComposer.mentionPicker?.status || state.documentComposer.mentionPicker?.candidates?.length) && !state.imageViewer && !state.reactionPicker?.open
  const dismissMobile = () => {
    if (nativeThreadOpen) { nativeThreadOpen = false; update({}); return }
    if (state.composer?.open) call('onComposerCancel')
    call('onCloseMobile')
  }
  onAction(mobileClose, dismissMobile)
  const moveMobile = delta => {
    const index = mobileIds.indexOf(mobileActive), next = mobileIds[index + delta]
    if (next) call('onActivate', next)
  }
  onAction(mobilePrev, () => moveMobile(-1))
  onAction(mobileNext, () => moveMobile(1))
  mobileCarousel.addEventListener('scroll', () => {
    if (nativeThreadOpen) return
    cancelAnimationFrame(scrollFrame)
    scrollFrame = requestAnimationFrame(() => {
      const width = mobileCarousel.clientWidth
      if (!width) return
      const id = mobileIds[Math.round(mobileCarousel.scrollLeft / width)]
      if (id && id !== mobileActive) { mobileActive = id; call('onActivate', id) }
    })
  }, { passive: true })
  let backdropPointer = null
  el.addEventListener('pointerdown', event => { backdropPointer = isMobileBackdrop() && event.target === el ? event.pointerId : null })
  el.addEventListener('pointercancel', () => { backdropPointer = null })
  el.addEventListener('click', event => {
    // Opening an anchored comment on pointerdown can retarget its compatibility
    // click to this new mask. Dismiss only a gesture that started on the mask.
    const startedOnBackdrop = backdropPointer !== null
    backdropPointer = null
    if (isMobileBackdrop() && event.target === el && startedOnBackdrop) dismissMobile()
  })
  const stopBackdropScroll = event => { if (isMobileBackdrop() && event.target === el) event.preventDefault() }
  el.addEventListener('touchmove', stopBackdropScroll, { passive: false })
  el.addEventListener('wheel', stopBackdropScroll, { passive: false })
  el.addEventListener('keydown', event => {
    if (!isMobile() || (!state.open && !isInlineDocument()) || event.isComposing || event.keyCode === 229) return
    if (event.key === 'Escape' && !event.defaultPrevented) {
      if (isInlineDocument() && !state.imageViewer && !state.reactionPicker?.open) return
      event.preventDefault(); event.stopPropagation()
      if (state.imageViewer) call('onCloseImage', true)
      else if (state.reactionPicker?.open) call('onCloseReaction', true)
      else dismissMobile()
    }
    if (event.key !== 'Tab' || event.defaultPrevented) return
    if (isInlineDocument() && !state.imageViewer && !state.reactionPicker?.open) return
    const focusScope = state.imageViewer ? imageViewer : state.reactionPicker?.open ? reactionPicker : mobileSheet
    const items = [...focusScope.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), [contenteditable="true"], [tabindex="0"]')].filter(node => {
      const rect = node.getBoundingClientRect()
      return rect.width && rect.height && rect.left >= 0 && rect.right <= window.innerWidth && rect.bottom > 0 && rect.top < window.innerHeight && !node.closest('[hidden], [inert], [aria-hidden="true"]')
    })
    if (!items.length) return
    const index = items.indexOf(document.activeElement)
    if (event.shiftKey ? index <= 0 : index < 0 || index === items.length - 1) {
      event.preventDefault(); items[event.shiftKey ? items.length - 1 : 0].focus()
    }
  })
  const resizeMobile = () => update({})
  window.addEventListener('resize', resizeMobile)
  const menuViewport = el.ownerDocument.defaultView.visualViewport
  menuViewport?.addEventListener('resize', positionReplyMenus)
  menuViewport?.addEventListener('scroll', positionReplyMenus)

  const sidebarHead = document.createElement('header')
  sidebarHead.className = 'lark-doc-comment-sidebar-head'
  const sidebarTitle = document.createElement('span')
  const historyButton = document.createElement('button')
  historyButton.type = 'button'
  historyButton.className = 'lark-doc-comment-sidebar-history'
  historyButton.addEventListener('click', () => call('onToggleHistory'))
  const collapseButton = document.createElement('button')
  collapseButton.type = 'button'
  collapseButton.className = 'lark-doc-comment-sidebar-collapse'
  collapseButton.setAttribute('aria-label', '收起评论侧栏')
  collapseButton.textContent = '»'
  collapseButton.addEventListener('click', () => call('onToggleSidebar'))
  const threadReader = document.createElement('button')
  threadReader.type = 'button'; threadReader.textContent = '逐条查看'; threadReader.setAttribute('aria-label', '逐条查看评论')
  threadReader.addEventListener('click', () => { if (!destroyed && isReferenceDrawer()) { nativeThreadOpen = true; update({}) } })
  sidebarHead.append(sidebarTitle, historyButton, threadReader, collapseButton)

  const emptyState = document.createElement('p')
  emptyState.className = 'lark-doc-comment-state'

  const documentLike = document.createElement('section')
  documentLike.className = 'lark-doc-document-like'
  const likeButton = document.createElement('button'); likeButton.type = 'button'
  likeButton.appendChild(iconNode('document-like', 32))
  onAction(likeButton, () => { if (el.isConnected && hasInlineDocument() && !likeButton.disabled) call('onDocumentLike') })
  const likeCaption = document.createElement('p'); likeCaption.textContent = '真诚点赞，手留余香'
  const likeCount = document.createElement('span'), likeStatus = document.createElement('span'); likeStatus.setAttribute('role', 'status')
  documentLike.append(likeButton, likeCount, likeCaption, likeStatus)

  const composer = document.createElement('section')
  composer.className = 'lark-doc-comment-composer is-selection'
  composer.setAttribute('aria-label', '发表选区评论')
  const callComposer = (name, ...args) => {
    if (el.isConnected && state.open && state.composer?.open && composer.isConnected) return call(name, ...args)
  }
  const composerHead = document.createElement('div')
  composerHead.className = 'lark-doc-comment-head'
  const composerQuote = document.createElement('span')
  composerQuote.className = 'lark-doc-comment-quote'
  const composerCancelEmpty = document.createElement('button')
  composerCancelEmpty.type = 'button'
  composerCancelEmpty.className = 'lark-doc-comment-cancel-empty'
  composerCancelEmpty.setAttribute('aria-label', '取消新评论')
  composerCancelEmpty.textContent = '×'
  composerCancelEmpty.addEventListener('click', () => callComposer('onComposerCancel'))
  composerHead.append(composerQuote, composerCancelEmpty)
  const composerAuthor = document.createElement('div')
  composerAuthor.className = 'lark-doc-comment-composer-author'
  const composerInput = richInput('lark-doc-comment-input-zone', '新评论', '输入评论', value => callComposer('onComposerDraft', value))
  const composerInputRow = document.createElement('div')
  composerInputRow.className = 'lark-doc-comment-input'
  composerInputRow.appendChild(composerInput)
  const composerImageButton = document.createElement('button')
  composerImageButton.type = 'button'
  composerImageButton.className = 'lark-doc-comment-operation'
  composerImageButton.setAttribute('aria-label', '插入图片')
  composerImageButton.appendChild(iconNode('rev-image', 16))
  onAction(composerImageButton, () => callComposer('onChooseImage', 'selection'))
  const composerImageInput = document.createElement('input')
  composerImageInput.type = 'file'; composerImageInput.multiple = true
  composerImageInput.accept = 'image/png,image/jpeg,image/gif,image/webp'
  composerImageInput.className = 'lark-doc-file-input'
  composerImageInput.dataset.commentImageScope = 'selection'
  composerImageInput.setAttribute('aria-label', '选择评论图片')
  composerImageInput.addEventListener('change', event => callComposer('onUploadImage', 'selection', event))
  composerInputRow.append(composerImageButton, composerImageInput)
  const composerImageDrafts = document.createElement('div')
  composerImageDrafts.className = 'lark-doc-comment-image-drafts'

  const composerActions = document.createElement('div')
  composerActions.className = 'lark-doc-comment-compose-actions'
  const composerPrivateLabel = document.createElement('label')
  const composerPrivate = document.createElement('input')
  composerPrivate.type = 'checkbox'
  composerPrivate.addEventListener('change', event => callComposer('onComposerPrivate', event.target.checked))
  composerPrivateLabel.append(composerPrivate, document.createTextNode('私密评论'))
  const composerCancel = document.createElement('button')
  composerCancel.type = 'button'
  composerCancel.className = 'lark-doc-comment-action is-outlined'
  composerCancel.textContent = '取消'
  composerCancel.addEventListener('click', () => callComposer('onComposerCancel'))
  const composerSend = document.createElement('button')
  composerSend.type = 'button'
  composerSend.className = 'lark-doc-comment-action is-filled'
  composerSend.textContent = '发送'
  composerSend.addEventListener('click', () => {
    if (state.composer?.canSubmit && !state.composer?.readonly) callComposer('onComposerSubmit')
  })
  bindSubmitShortcut(composerInput, composerSend)
  bindViewerEscape(composerInput)
  composerActions.append(composerPrivateLabel, composerCancel, composerSend)
  composer.append(composerHead, composerAuthor, composerInputRow, composerImageDrafts, composerActions)

  const documentComposer = document.createElement('section')
  documentComposer.className = 'lark-doc-document-composer'
  documentComposer.setAttribute('aria-label', '发表全文评论')
  const callDocumentComposer = (name, ...args) => {
    if (el.isConnected && documentComposer.isConnected && state.documentComposer?.open) return call(name, ...args)
  }
  const documentComposerTarget = document.createElement('p')
  documentComposerTarget.className = 'lark-doc-comment-state'
  const documentComposerInputWrap = document.createElement('div')
  documentComposerInputWrap.className = 'lark-doc-document-comment-input lark-doc-comment-rich-input'
  const documentComposerInput = richInput('lark-doc-document-composer-input', '全文评论', '输入全文评论', (value, event) => callDocumentComposer('onDocumentComposerDraft', value, event))
  documentComposerInput.dataset.commentDraftEditor = 'true'
  documentComposerInput.setAttribute('aria-label', '全文评论')
  documentComposerInput.placeholder = '输入全文评论'
  documentComposerInput.addEventListener('comment-keydown', ({ detail: event }) => {
    if (event.isComposing) return
    if (!['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(event.key)) return
    if (call('onDocumentMentionKeydown', 'document', event.key) === true) event.preventDefault()
  })
  documentComposerInputWrap.appendChild(documentComposerInput)
  const documentComposerPreview = document.createElement('div')
  documentComposerPreview.className = 'lark-doc-document-composer-rich-preview'
  const documentComposerMentionPicker = document.createElement('div')
  documentComposerMentionPicker.className = 'lark-doc-comment-mention-picker'
  documentComposerMentionPicker.setAttribute('role', 'listbox')
  documentComposerMentionPicker.setAttribute('aria-label', '全文评论提及候选人')
  const documentMentionSheet = document.createElement('section')
  documentMentionSheet.className = 'lark-doc-document-mention-sheet'
  documentMentionSheet.setAttribute('aria-label', '你可能想提及')
  const documentMentionHead = document.createElement('header')
  documentMentionHead.className = 'lark-doc-document-mention-head'
  const documentMentionCancel = document.createElement('button')
  documentMentionCancel.type = 'button'; documentMentionCancel.textContent = '取消'; documentMentionCancel.setAttribute('aria-label', '取消提及选择')
  const cancelDocumentMention = () => { call('onDocumentMentionKeydown', 'document', 'Escape'); richInputs.get(documentComposerInput)?.focus() }
  onAction(documentMentionCancel, cancelDocumentMention)
  const documentMentionTitle = document.createElement('span'); documentMentionTitle.textContent = '你可能想提及'
  documentMentionHead.append(documentMentionCancel, documentMentionTitle)
  documentMentionSheet.append(documentMentionHead, documentComposerMentionPicker)
  documentMentionSheet.addEventListener('keydown', event => {
    if (event.key === 'Tab' && isInlineDocument() && isDocumentMentionOpen()) {
      const controls = [documentMentionCancel, ...documentComposerMentionPicker.querySelectorAll('button:not(:disabled)')]
      const index = controls.indexOf(documentMentionSheet.ownerDocument.activeElement)
      if (event.shiftKey ? index <= 0 : index === controls.length - 1) {
        event.preventDefault(); event.stopPropagation(); controls[event.shiftKey ? controls.length - 1 : 0].focus()
      }
    }
    if (event.key === 'Escape' && !event.defaultPrevented && isDocumentMentionOpen()) {
      event.preventDefault(); event.stopPropagation(); cancelDocumentMention()
    }
  })
  const documentComposerTools = document.createElement('div')
  documentComposerTools.className = 'lark-doc-document-comment-tools'
  const documentComposerImageButton = document.createElement('button')
  documentComposerImageButton.type = 'button'; documentComposerImageButton.className = 'lark-doc-comment-operation'; documentComposerImageButton.appendChild(iconNode('rev-image', 20)); documentComposerImageButton.setAttribute('aria-label', '全文评论插入图片')
  onAction(documentComposerImageButton, () => callDocumentComposer('onChooseImage', 'document'))
  const documentComposerImageInput = document.createElement('input')
  documentComposerImageInput.type = 'file'; documentComposerImageInput.multiple = true; documentComposerImageInput.accept = 'image/png,image/jpeg,image/gif,image/webp'; documentComposerImageInput.className = 'lark-doc-file-input'; documentComposerImageInput.dataset.commentImageScope = 'document'; documentComposerImageInput.setAttribute('aria-label', '选择全文评论图片')
  documentComposerImageInput.addEventListener('change', event => callDocumentComposer('onUploadImage', 'document', event))
  documentComposerTools.append(documentComposerImageButton, documentComposerImageInput)
  const documentComposerMore = document.createElement('button'); documentComposerMore.type = 'button'
  documentComposerMore.className = 'lark-doc-document-comment-more'; documentComposerMore.setAttribute('aria-label', '更多全文评论操作'); documentComposerMore.setAttribute('aria-expanded', 'false')
  documentComposerMore.appendChild(iconNode('more', 20))
  onAction(documentComposerMore, () => {
    if (!el.isConnected || !hasInlineDocument()) return
    const open = documentComposerMore.getAttribute('aria-expanded') !== 'true'
    documentComposerMore.setAttribute('aria-expanded', String(open)); documentComposerActions.hidden = !open
  })
  const backToTop = document.createElement('button'); backToTop.type = 'button'
  backToTop.className = 'lark-doc-comment-back-top'; backToTop.setAttribute('aria-label', '返回顶部'); backToTop.title = '返回顶部'
  backToTop.appendChild(iconNode('move-up', 22)); onAction(backToTop, () => { if (el.isConnected && hasInlineDocument()) call('onBackToTop') })
  const documentComposerImages = document.createElement('div')
  documentComposerImages.className = 'lark-doc-comment-image-drafts'
  const documentComposerActions = document.createElement('div')
  documentComposerActions.className = 'lark-doc-document-composer-actions'
  const documentComposerPrivateLabel = document.createElement('label')
  const documentComposerPrivate = document.createElement('input')
  documentComposerPrivate.type = 'checkbox'; documentComposerPrivate.addEventListener('change', event => callDocumentComposer('onDocumentComposerPrivate', event.target.checked))
  documentComposerPrivateLabel.append(documentComposerPrivate, document.createTextNode('私密评论'))
  const documentComposerCancel = document.createElement('button')
  documentComposerCancel.type = 'button'; documentComposerCancel.textContent = '取消'; onAction(documentComposerCancel, () => callDocumentComposer('onDocumentComposerCancel'))
  const documentComposerSend = document.createElement('button')
  documentComposerSend.type = 'button'; documentComposerSend.textContent = '发送'; onAction(documentComposerSend, () => callDocumentComposer('onDocumentComposerSubmit'))
  bindSubmitShortcut(documentComposerInput, documentComposerSend)
  documentComposerActions.append(documentComposerPrivateLabel, documentComposerCancel, documentComposerSend)
  documentComposer.append(documentComposerTarget, documentComposerInputWrap, documentComposerPreview, documentMentionSheet, documentComposerTools, documentComposerImages, documentComposerActions)

  const imageStatus = document.createElement('div')
  imageStatus.className = 'lark-doc-comment-media-status'; imageStatus.setAttribute('role', 'status')
  const imageStatusText = document.createElement('span')
  const cancelUpload = document.createElement('button')
  cancelUpload.type = 'button'; cancelUpload.textContent = '取消上传'
  cancelUpload.setAttribute('aria-label', '取消评论图片上传')
  onAction(cancelUpload, () => call('onCancelImageUpload'))
  const queryImage = document.createElement('button')
  queryImage.type = 'button'; queryImage.textContent = '查询原图片操作'
  queryImage.setAttribute('aria-label', '查询原图片操作')
  onAction(queryImage, () => call('onQueryImage'))
  const translationRecovery = document.createElement('div')
  translationRecovery.className = 'lark-doc-comment-feedback'
  const queryTranslation = document.createElement('button')
  queryTranslation.type = 'button'; queryTranslation.textContent = '查询翻译结果'
  queryTranslation.setAttribute('aria-label', '查询翻译结果')
  onAction(queryTranslation, () => call('onQueryTranslation'))
  translationRecovery.append(document.createTextNode('翻译任务尚未确认。'), queryTranslation)
  const imageBackdrop = document.createElement('div')
  imageBackdrop.className = 'lark-doc-comment-image-backdrop'
  imageBackdrop.addEventListener('click', event => { if (event.target === imageBackdrop) call('onCloseImage', true) })
  const imageViewer = document.createElement('div')
  imageViewer.className = 'lark-doc-comment-image-viewer'
  imageViewer.setAttribute('role', 'dialog'); imageViewer.setAttribute('aria-modal', 'true')
  imageViewer.setAttribute('aria-label', '评论图片预览')
  const imageClose = document.createElement('button')
  imageClose.type = 'button'; imageClose.textContent = '×'; imageClose.setAttribute('aria-label', '关闭图片预览')
  onAction(imageClose, () => call('onCloseImage', true))
  imageViewer.addEventListener('keydown', event => {
    if (event.key === 'Tab') { event.preventDefault(); imageClose.focus() }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); call('onCloseImage', true) }
  })
  const viewerImage = document.createElement('img'), viewerCaption = document.createElement('p')
  imageViewer.append(imageClose, viewerImage, viewerCaption); imageBackdrop.append(imageViewer)

  const reactionPicker = document.createElement('div')
  reactionPicker.className = 'lark-doc-comment-reaction-picker'
  reactionPicker.setAttribute('role', 'dialog')
  reactionPicker.setAttribute('aria-label', '选择表情回复')
  const reactionPickerHead = document.createElement('div')
  reactionPickerHead.className = 'lark-doc-comment-reaction-picker-head'
  const reactionSearch = document.createElement('input')
  reactionSearch.type = 'search'; reactionSearch.placeholder = '搜索表情'; reactionSearch.setAttribute('aria-label', '搜索表情')
  reactionSearch.addEventListener('input', event => call('onReactionQuery', event.target.value))
  const reactionClose = document.createElement('button')
  reactionClose.type = 'button'; reactionClose.textContent = '×'; reactionClose.setAttribute('aria-label', '关闭表情回复')
  onAction(reactionClose, () => call('onCloseReaction', true))
  reactionPickerHead.append(reactionSearch, reactionClose)
  const reactionTabs = document.createElement('div')
  reactionTabs.className = 'lark-doc-comment-reaction-tabs'
  const reactionGrid = document.createElement('div')
  reactionGrid.className = 'lark-doc-comment-reaction-grid'
  const reactionMore = document.createElement('button')
  reactionMore.type = 'button'; reactionMore.className = 'lark-doc-comment-reaction-more'; reactionMore.textContent = '查看更多'
  onAction(reactionMore, () => call('onMoreReaction'))
  reactionPicker.append(reactionPickerHead, reactionTabs, reactionGrid, reactionMore)

  /** @type {Map<string, ReturnType<typeof createPanelNode>>} */
  const panelNodes = new Map()

  function createPanelNode(id) {
    const root = document.createElement('div')
    root.className = 'lark-doc-comment-panel'
    root.dataset.commentThread = id
    root.setAttribute('role', 'dialog')
    // 根节点**没有** `.prevent`：它要抢焦点去点亮线程。
    root.addEventListener('mousedown', () => { if (!isReferenceDrawer()) call('onActivate', id) })
    root.addEventListener('click', () => { if (isReferenceDrawer() && root.isConnected) call('onActivate', id) })

    const head = document.createElement('div')
    head.className = 'lark-doc-comment-head'
    const quote = document.createElement('span')
    quote.className = 'lark-doc-comment-quote'
    const controls = document.createElement('div')
    controls.className = 'lark-doc-comment-controls'
    const drawerActions = document.createElement('details'); drawerActions.className = 'lark-doc-comment-drawer-actions'
    const drawerSummary = document.createElement('summary'); drawerSummary.setAttribute('aria-label', '评论操作'); drawerSummary.appendChild(iconNode('more', 18))
    drawerActions.appendChild(drawerSummary)
    head.appendChild(quote)
    head.appendChild(controls)

    const replies = document.createElement('div')
    replies.className = 'lark-doc-comment-replies'
    const threadScroll = document.createElement('div'); threadScroll.className = 'lark-doc-comment-thread-scroll'
    let edgeGesture = null
    threadScroll.addEventListener('touchstart', event => {
      if (!nativeThreadOpen || event.touches.length !== 1) { edgeGesture = null; return }
      const touch = event.touches[0]
      edgeGesture = { x: touch.clientX, y: touch.clientY, top: threadScroll.scrollTop <= 1,
        bottom: threadScroll.scrollTop + threadScroll.clientHeight >= threadScroll.scrollHeight - 1 }
    }, { passive: true })
    threadScroll.addEventListener('touchcancel', () => { edgeGesture = null })
    threadScroll.addEventListener('touchend', event => {
      const start = edgeGesture; edgeGesture = null
      if (!start || !nativeThreadOpen || !threadScroll.isConnected) return
      const touch = event.changedTouches[0]; if (!touch) return
      const dy = touch.clientY - start.y, dx = touch.clientX - start.x
      if (Math.abs(dy) < 65 || Math.abs(dy) <= Math.abs(dx) * 1.3) return
      if (dy < 0 && start.bottom) moveMobile(1)
      else if (dy > 0 && start.top) moveMobile(-1)
    }, { passive: true })

    const textareaWrap = document.createElement('div')
    textareaWrap.className = 'lark-doc-comment-textarea'
    const inputRow = document.createElement('div')
    inputRow.className = 'lark-doc-comment-input'
    const textarea = richInput('lark-doc-comment-input-zone', '回复', '回复评论', (value, event) => call('onDraft', id, value, event))
    textarea.addEventListener('comment-keydown', ({ detail: event }) => {
      if (event.isComposing) return
      if (!['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(event.key)) return
      if (call('onMentionKeydown', id, event.key) === true) event.preventDefault()
    })
    bindViewerEscape(textarea)
    const operation = document.createElement('button')
    operation.type = 'button'
    operation.className = 'lark-doc-comment-operation'
    operation.setAttribute('aria-label', '插入图片')
    operation.appendChild(iconNode('rev-image', 16))
    onAction(operation, () => call('onChooseImage', id))
    const imageInput = document.createElement('input')
    imageInput.type = 'file'
    imageInput.multiple = true
    imageInput.accept = 'image/png,image/jpeg,image/gif,image/webp'
    imageInput.className = 'lark-doc-file-input'
    imageInput.dataset.commentImageScope = id
    imageInput.setAttribute('aria-label', '选择评论图片')
    imageInput.addEventListener('change', event => call('onUploadImage', id, event))
    inputRow.appendChild(textarea)
    inputRow.appendChild(operation)
    inputRow.appendChild(imageInput)

    const draftImages = document.createElement('div')
    draftImages.className = 'lark-doc-comment-image-drafts'
    const actions = document.createElement('div')
    actions.className = 'lark-doc-comment-actions'
    const cancelAction = document.createElement('button')
    cancelAction.type = 'button'
    cancelAction.className = 'lark-doc-comment-action is-outlined'
    cancelAction.textContent = '取消'
    onAction(cancelAction, () => call('onClearDraft', id))
    const sendAction = document.createElement('button')
    sendAction.type = 'button'
    sendAction.className = 'lark-doc-comment-action is-filled'
    sendAction.textContent = '发送'
    onAction(sendAction, () => call('onSubmit', id))
    bindSubmitShortcut(textarea, sendAction)
    actions.appendChild(cancelAction)
    actions.appendChild(sendAction)

    textareaWrap.appendChild(inputRow)
    textareaWrap.appendChild(actions)
    const mentionPicker = document.createElement('div')
    mentionPicker.className = 'lark-doc-comment-mention-picker'
    mentionPicker.setAttribute('role', 'listbox')
    mentionPicker.setAttribute('aria-label', '提及候选人')
    textareaWrap.appendChild(mentionPicker)

    const edit = document.createElement('section')
    edit.className = 'lark-doc-comment-edit'
    edit.setAttribute('aria-label', '编辑评论')
    const editInput = richInput('lark-doc-comment-edit-input', '编辑评论', '', (value, event) => call('onEditDraft', id, edit.dataset.replyId || '', value, event))
    editInput.addEventListener('comment-keydown', ({ detail: event }) => {
      if (event.isComposing) return
      if (!['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(event.key)) return
      if (call('onDocumentMentionKeydown', `edit/${id}/${edit.dataset.replyId || ''}`, event.key) === true) event.preventDefault()
    })
    bindViewerEscape(editInput)
    const editMentionPicker = document.createElement('div')
    editMentionPicker.className = 'lark-doc-comment-mention-picker'
    editMentionPicker.setAttribute('role', 'listbox')
    editMentionPicker.setAttribute('aria-label', '编辑评论提及候选人')
    const editTools = document.createElement('div')
    editTools.className = 'lark-doc-comment-edit-tools'
    const editImageButton = document.createElement('button')
    editImageButton.type = 'button'; editImageButton.textContent = '图片'; editImageButton.setAttribute('aria-label', '编辑评论插入图片')
    onAction(editImageButton, () => call('onChooseImage', edit.dataset.scope || ''))
    const editImageInput = document.createElement('input')
    editImageInput.type = 'file'; editImageInput.multiple = true; editImageInput.accept = 'image/png,image/jpeg,image/gif,image/webp'; editImageInput.className = 'lark-doc-file-input'
    editImageInput.addEventListener('change', event => call('onUploadImage', edit.dataset.scope || '', event))
    editTools.append(editImageButton, editImageInput)
    const editActions = document.createElement('div')
    const editDraftImages = document.createElement('div')
    editDraftImages.className = 'lark-doc-comment-image-drafts'
    editActions.className = 'lark-doc-comment-edit-actions'
    const editCancel = document.createElement('button')
    editCancel.type = 'button'; editCancel.textContent = '取消编辑'; onAction(editCancel, () => call('onCancelEdit'))
    const editSave = document.createElement('button')
    editSave.type = 'button'; editSave.textContent = '保存编辑'; onAction(editSave, () => call('onSaveEdit'))
    editActions.append(editCancel, editSave)
    edit.append(editInput, editMentionPicker, editTools, editActions)

    const translation = document.createElement('section')
    translation.className = 'lark-doc-comment-translation'
    translation.setAttribute('role', 'status')
    const translationHint = document.createElement('p')
    const translationMessage = document.createElement('p')
    const translationResult = document.createElement('p')
    translationResult.setAttribute('role', 'status'); translationResult.setAttribute('aria-live', 'polite')
    const translationLabel = document.createElement('label')
    translationLabel.textContent = '翻译成'
    const translationLanguages = [['zh-CN', '简体中文'], ['zh-TW', '繁體中文'], ['en', '英语'], ['ja', '日语'], ['ko', '韩语'], ['fr', '法语'], ['de', '德语'], ['es', '西班牙语']]
    const translationSelect = document.createElement('select')
    translationSelect.setAttribute('aria-label', '翻译语言')
    ;[...translationLanguages, ['custom', '其他语言…']].forEach(([value, label]) => {
      const option = document.createElement('option'); option.value = value; option.textContent = label; translationSelect.appendChild(option)
    })
    const translationInput = document.createElement('input')
    translationInput.setAttribute('aria-label', '其他翻译语言')
    translationInput.placeholder = '语言代码，例如 pt-BR'
    translationInput.hidden = true
    translationInput.addEventListener('input', event => call('onTranslationLanguage', event.target.value))
    translationSelect.addEventListener('change', event => {
      const custom = event.target.value === 'custom'
      translation.dataset.customLanguage = String(custom)
      translationInput.hidden = !custom
      if (custom) { translationInput.focus(); translationInput.select() }
      else call('onTranslationLanguage', event.target.value)
    })
    translationLabel.append(translationSelect, translationInput)
    const translationActions = document.createElement('div')
    translationActions.className = 'lark-doc-comment-translation-actions'
    const translationClose = document.createElement('button')
    translationClose.type = 'button'; translationClose.textContent = '关闭'; onAction(translationClose, () => call('onCloseTranslation'))
    const translationSubmit = document.createElement('button')
    translationSubmit.type = 'button'; translationSubmit.textContent = '翻译'; onAction(translationSubmit, () => call('onSubmitTranslation'))
    const translationQuery = document.createElement('button')
    translationQuery.type = 'button'; translationQuery.textContent = '查询翻译结果'; translationQuery.setAttribute('aria-label', '查询翻译结果')
    onAction(translationQuery, () => call('onQueryTranslation'))
    translationActions.append(translationClose, translationSubmit)
    translation.append(translationHint, translationLabel, translationMessage, translationResult, translationActions)

    const moreMenu = document.createElement('div')
    moreMenu.className = 'lark-doc-comment-more-menu'
    const moreRow = document.createElement('div')
    moreRow.className = 'lark-doc-comment-more-row'
    const moreIcon = document.createElement('span')
    moreIcon.className = 'lark-doc-comment-more-icon'
    moreIcon.setAttribute('aria-hidden', 'true')
    moreIcon.appendChild(iconNode('block-task', 20))
    const moreTitle = document.createElement('span')
    moreTitle.className = 'lark-doc-comment-more-title'
    const switchButton = document.createElement('button')
    switchButton.type = 'button'
    switchButton.className = 'lark-doc-comment-switch'
    switchButton.setAttribute('role', 'switch')
    const switchHandler = document.createElement('span')
    switchHandler.className = 'lark-doc-comment-switch-handler'
    switchHandler.setAttribute('aria-hidden', 'true')
    switchButton.appendChild(switchHandler)
    onAction(switchButton, () => call('onTogglePrivate', id))
    moreRow.appendChild(moreIcon)
    moreRow.appendChild(moreTitle)
    moreRow.appendChild(switchButton)
    const moreHint = document.createElement('p')
    moreHint.className = 'lark-doc-comment-more-hint'
    moreMenu.appendChild(moreRow)
    moreMenu.appendChild(moreHint)

    return {
      root,
      // 控件条只在签名变化时重建，所以回调里必须读实时 id，不能闭包 `id`。
      threadId: id,
      head,
      quote,
      controls,
      drawerActions,
      controlCells: [],
      controlSignature: null,
      replies,
      threadScroll,
      repliesSignature: null,
      textareaWrap,
      mentionPicker,
      edit,
      editInput,
      editMentionPicker,
      editDraftImages,
      editTools,
      editActions,
      editImageButton,
      editImageInput,
      editCancel,
      editSave,
      translation,
      translationHint,
      translationSelect,
      translationLanguages,
      translationInput,
      translationMessage,
      translationResult,
      translationClose,
      translationSubmit,
      translationQuery,
      translationActions,
      inputRow,
      textarea,
      imageInput,
      draftImages,
      draftImagesSignature: null,
      actions,
      cancelAction,
      operation,
      sendAction,
      moreMenu,
      moreTitle,
      switchButton,
      moreHint,
    }
  }

  /** 控件条六格：分隔条走 `split` 分支，其余是带图标（或圆点）的按钮。 */
  function ensureControls(entry) {
    const signature = state.controls.map((control) => control.id).join(',')
    if (entry.controlSignature === signature) return
    entry.controlSignature = signature
    entry.controlCells = []
    entry.controls.textContent = ''
    state.controls.forEach((control) => {
      const cell = document.createElement('span')
      cell.className = 'lark-doc-comment-cell'
      if (control.split) {
        const split = document.createElement('span')
        split.className = 'lark-doc-comment-split'
        split.setAttribute('aria-hidden', 'true')
        cell.appendChild(split)
      } else {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'lark-doc-comment-btn'
        button.setAttribute('aria-label', control.label)
        if (control.icon) button.appendChild(iconNode(control.icon, control.iconSize))
        else {
          const dots = document.createElement('span')
          dots.className = 'lark-doc-comment-dots'
          dots.setAttribute('aria-hidden', 'true')
          button.appendChild(dots)
        }
        onAction(button, () => call('onControl', control.id, entry.threadId))
        cell.appendChild(button)
      }
      entry.controls.appendChild(cell)
      entry.controlCells.push({ cell, control })
    })
  }

  function buildReplies(entry, item) {
    const nodes = []
    const controlId = control => control.id || ({ '添加表情回复': 'emoji', '引用回复': 'quote', '更多菜单': 'more' }[control.label] || '')
    const compactControls = hasInlineDocument() && item.documentOnly === true && state.replyControls.some(control => controlId(control) === 'more')
    ;(item.replies || []).forEach((reply) => {
      const root = document.createElement('div')
      root.className = 'lark-doc-comment-reply'
      root.dataset.commentReply = reply.id

      const main = document.createElement('div')
      main.className = 'lark-doc-comment-reply-main'
      const avatar = document.createElement('span')
      avatar.className = 'lark-doc-comment-avatar'
      avatar.setAttribute('aria-hidden', 'true')
      if (isMobile() && reply.name) {
        const name = String(reply.name).trim()
        avatar.textContent = /^[\p{Script=Han}]+$/u.test(name) ? Array.from(name).slice(-2).join('') : Array.from(name)[0]?.toLocaleUpperCase() || ''
        avatar.classList.add('has-initials')
      } else avatar.appendChild(iconNode('rev-avatar', 18))
      const right = document.createElement('div')
      right.className = 'lark-doc-comment-reply-right'
      const info = document.createElement('div')
      info.className = 'lark-doc-comment-info'
      const name = document.createElement('span')
      name.className = 'lark-doc-comment-name'
      name.textContent = reply.name == null ? '' : String(reply.name)
      const time = document.createElement('span')
      time.className = 'lark-doc-comment-time'
      time.textContent = reply.time == null ? '' : String(reply.time)
      info.appendChild(name)
      info.appendChild(time)
      const body = document.createElement('div')
      body.className = 'lark-doc-comment-body'
      if (Array.isArray(reply.richSegments)) renderCommentSegments(body, reply.richSegments, (reference, event) => call('onDocumentReference', item.id, reply.id, reference, event))
      else if (Array.isArray(reply.segments)) renderCommentSegments(body, reply.segments, (reference, event) => call('onDocumentReference', item.id, reply.id, reference, event))
      else body.textContent = reply.body == null ? '' : String(reply.body)
      right.appendChild(info)
      right.appendChild(body)
      if (reply.images?.length) {
        const images = document.createElement('div'); images.className = 'lark-doc-comment-images'
        reply.images.forEach(image => {
          const button = document.createElement('button'); button.type = 'button'
          button.setAttribute('aria-label', '查看评论图片：' + (image.fileName || ''))
          button.disabled = !image.url && !image.error
          onAction(button, event => call('onOpenImage', item.id, reply.id, image.assetId, event))
          const preview = document.createElement(image.url ? 'img' : 'span')
          if (image.url) { preview.src = image.url; preview.alt = image.fileName || '' }
          else preview.textContent = image.error ? '图片加载失败，点击重试' : '图片加载中…'
          button.appendChild(preview); images.appendChild(button)
        })
        right.appendChild(images)
      }
      if (!reply.tombstone && Array.isArray(reply.reactions) && reply.reactions.length) {
        const reactions = document.createElement('div')
        reactions.className = 'lark-doc-comment-reactions'
        reactions.setAttribute('aria-label', '表情回复')
        reply.reactions.forEach(reaction => {
          const button = document.createElement('button')
          button.type = 'button'; button.className = 'lark-doc-comment-reaction'
          const emoji = reaction.emoji == null ? '' : String(reaction.emoji)
          const count = reaction.count == null ? '' : String(reaction.count)
          button.setAttribute('aria-pressed', String(reaction.reactedByMe === true))
          button.setAttribute('aria-label', `${reaction.label || emoji} ${count} 人${reaction.reactedByMe ? '，已回应，点击取消' : '，点击回应'}`)
          button.disabled = reaction.canReact === false
          button.append(document.createTextNode(emoji), document.createTextNode(reaction.people ? `｜${reaction.people}` : count ? ` ${count}` : ''))
          onAction(button, () => call('onReaction', item.id, reply.id, emoji, reaction.reactedByMe !== true))
          reactions.appendChild(button)
        })
        right.appendChild(reactions)
      }
      main.appendChild(avatar)
      main.appendChild(right)

      const replyControls = document.createElement('div')
      replyControls.className = 'lark-doc-comment-reply-controls'
      const disabledControl = control => control.disabled === true || (controlId(control) === 'emoji' && (reply.tombstone || reply.canReact === false)) || (controlId(control) === 'quote' && (reply.tombstone || reply.canReply === false))
      state.replyControls.forEach((control) => {
        const id = controlId(control)
        if (compactControls && id !== 'more') return
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'lark-doc-comment-icon-btn'
        button.dataset.commentReplyControl = id
        button.disabled = disabledControl(control)
        // The card root activates a thread on mousedown. Stop that gesture at
        // the reply control so a mobile tap cannot replace the button before
        // its click handler opens the picker/menu.
        button.addEventListener('mousedown', event => event.stopPropagation())
        button.setAttribute('aria-label', control.label)
        if (control.icon) button.appendChild(iconNode(control.icon, control.iconSize))
        else {
          const dots = document.createElement('span')
          dots.className = 'lark-doc-comment-dots'
          dots.setAttribute('aria-hidden', 'true')
          button.appendChild(dots)
        }
        onAction(button, event => {
          cancelReplyMenuClose()
          dismissedReplyHover = id === 'more' && hoverReply(button, item.id, reply.id, event)?.menuOpen ? { threadId: item.id, replyId: reply.id } : null
          call('onReplyControl', id, item.id, reply.id, event)
        })
        if (id === 'more') {
          button.setAttribute('aria-haspopup', 'menu'); button.setAttribute('aria-expanded', String(!!reply.menuOpen))
          button.addEventListener('mouseenter', event => enterReplyMenu(button, item.id, reply.id, event))
          button.addEventListener('mouseleave', event => leaveReplyMenu(button, item.id, reply.id, event))
        }
        replyControls.appendChild(button)
      })

      const menuBox = document.createElement('div')
      menuBox.className = 'lark-doc-comment-reply-menu'
      menuBox.classList.toggle('is-mobile-menu', reply.mobileMenu === true)
      menuBox.addEventListener('mouseenter', event => { if (hoverReply(menuBox, item.id, reply.id, event)) cancelReplyMenuClose() })
      menuBox.addEventListener('mouseleave', event => leaveReplyMenu(menuBox, item.id, reply.id, event))
      const menuList = document.createElement('ul')
      menuList.className = 'lark-doc-comment-menu-list'
      menuList.setAttribute('role', 'menu')
      menuList.setAttribute('aria-label', '评论操作')
      menuBox.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !event.isComposing && event.keyCode !== 229 && !event.defaultPrevented) {
          if (reply.mobileMenu && (!menuBox.isConnected || !reply.menuScope?.current())) return
          event.preventDefault(); event.stopPropagation()
          call('onCloseMenus', { threadId: item.id, replyId: reply.id, restoreFocus: !reply.mobileMenu || menuBox.contains(menuBox.ownerDocument.activeElement) })
        }
      })
      const replyMenus = compactControls && !reply.mobileMenu ? [
        ...state.replyControls.filter(control => controlId(control) !== 'more' && !reply.tombstone).map(control => ({ ...control, replyControlId: controlId(control), visible: true, disabled: disabledControl(control) })),
        ...(reply.menus || []),
      ] : reply.menus || []
      menuBox.classList.toggle('is-mobile-document-menu', reply.mobileMenu === true && item.documentOnly === true && replyMenus.filter(menu => menu.visible).length === 9)
      replyMenus.forEach((menu) => {
        if (!menu.visible) return
        const li = document.createElement('li')
        li.className = 'lark-doc-comment-menu-item'
        li.setAttribute('role', 'menuitem')
        const menuDisabled = menu.disabled === true
        li.setAttribute('aria-disabled', String(menuDisabled))
        const reason = menuDisabled && typeof menu.reason === 'string' ? menu.reason : ''
        setAttr(li, 'title', reason || null)
        setAttr(li, 'aria-description', reason || null)
        li.tabIndex = menuDisabled ? -1 : 0
        const activate = event => {
          if (menuDisabled || (reply.mobileMenu && !reply.menuScope?.current())) return
          if (reply.mobileMenu && menu.id === 'delete') requestDeleteConfirmation(item.id, reply.id, reply.menuScope)
          else if (reply.mobileMenu) call('onMobileMenuItem', menu.id, item.id, reply.id, reply.menuScope)
          else if (menu.replyControlId) call('onReplyControl', menu.replyControlId, item.id, reply.id, event)
          else call('onMenuItem', menu.id, item.id, reply.id)
        }
        onAction(li, activate)
        li.addEventListener('keydown', event => {
          if (menuDisabled) return
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(event) }
        })
        const menuLabel = document.createElement('span')
        menuLabel.className = 'lark-doc-comment-menu-label'
        menuLabel.textContent = menu.label == null ? '' : String(menu.label)
        if (reply.mobileMenu && menu.glyph) {
          const glyph = document.createElement('span'); glyph.className = 'lark-doc-icon'
          glyph.dataset.commentMenuGlyph = menu.id; glyph.setAttribute('aria-hidden', 'true'); glyph.textContent = menu.glyph
          Object.assign(glyph.style, { width: '20px', height: '20px', fontSize: '20px', lineHeight: '20px' })
          li.appendChild(glyph)
        } else if (reply.mobileMenu && menu.icon) li.appendChild(iconNode(menu.icon, 20))
        li.appendChild(menuLabel)
        if (menu.submenu) li.appendChild(iconNode('chevronDown', 12, 'lark-doc-comment-menu-arrow'))
        menuList.appendChild(li)
      })
      menuBox.appendChild(menuList)
      if (reply.mobileMenu && !reply.tombstone) {
        const quick = document.createElement('div'); quick.className = 'lark-doc-comment-quick-reactions'; quick.setAttribute('role', 'group'); quick.setAttribute('aria-label', '快捷表情回复')
        ;(reply.quickReactions || []).forEach(reaction => {
          const button = document.createElement('button'); button.type = 'button'; button.textContent = reaction.emoji
          button.dataset.commentQuickReaction = reaction.emoji; button.setAttribute('aria-label', reaction.label || reaction.emoji)
          button.setAttribute('aria-pressed', String(reaction.active === true)); button.disabled = reply.canReact === false
          if (button.disabled) button.title = reply.reactionDisabledReason || '当前无法添加表情回复'
          onAction(button, () => {
            if (!reply.menuScope?.current()) return
            call('onReaction', item.id, reply.id, reaction.emoji, reaction.active !== true); call('onCloseMenus')
          })
          quick.append(button)
        })
        const more = document.createElement('button'); more.type = 'button'; more.textContent = '＋'; more.setAttribute('aria-label', '更多表情回复'); more.disabled = reply.canReact === false
        if (more.disabled) more.title = reply.reactionDisabledReason || '当前无法添加表情回复'
        onAction(more, event => { if (reply.menuScope?.current()) call('onReplyControl', 'emoji', item.id, reply.id, event) })
        quick.append(more); menuBox.append(quick)
      }

      root.appendChild(main)
      root.appendChild(replyControls)
      root.appendChild(menuBox)
      syncChildren(root, [
        { node: main, on: true },
        { node: replyControls, on: !isReferenceDrawer() || state.activeThreadId === item.id },
        { node: menuBox, on: !!reply.menuOpen && (!isReferenceDrawer() || state.activeThreadId === item.id) },
      ])
      nodes.push(root)
    })
    return nodes
  }

  function renderPanel(entry, item) {
    entry.threadId = item.id
    setAttr(entry.root, 'aria-label', state.title)
    entry.root.classList.toggle('is-document', item.documentOnly === true)
    const interactive = !isReferenceDrawer() || state.activeThreadId === item.id
    entry.root.classList.toggle('is-active', state.activeThreadId === item.id)
    entry.root.setAttribute('role', item.documentOnly ? 'group' : 'dialog')
    // SFC 是数组形式（合并语义）；接线层已经把 `{left, top}` 与 `{height}` 合成一份。
    applyStyle(entry.root, nativeThreadOpen && !item.documentOnly ? { ...item.style, marginTop: '0px' } : item.style)
    setText(entry.quote, item.quote)
    entry.quote.setAttribute('role', 'button'); entry.quote.tabIndex = 0
    entry.quote.onclick = () => { if (entry.quote.isConnected) call('onLocate', item.id) }
    entry.quote.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); entry.quote.click() } }

    ensureControls(entry)
    if (isReferenceDrawer()) {
      if (entry.controls.parentNode !== entry.drawerActions) entry.drawerActions.appendChild(entry.controls)
      if (entry.drawerActions.parentNode !== entry.head) entry.head.appendChild(entry.drawerActions)
      entry.drawerActions.hidden = !interactive
      if (!interactive) entry.drawerActions.open = false
    } else {
      if (entry.controls.parentNode !== entry.head) entry.head.appendChild(entry.controls)
      entry.drawerActions.remove()
    }
    const disabled = new Set(item.disabled || [])
    entry.controlCells.forEach(({ cell, control }) => {
      if (control.split) return
      const button = cell.children[0]
      if (!button) return
      button.classList.toggle('is-primary', control.tone === 'primary')
      button.classList.toggle('is-disabled', disabled.has(control.id))
      button.disabled = disabled.has(control.id)
      setAttr(button, 'aria-disabled', String(disabled.has(control.id)))
      setAttr(button, 'data-capability', control.id === 'resolve' ? 'canResolveComment' : 'canComment')
    })

    const repliesSignature = JSON.stringify([hasInlineDocument(), item.documentOnly === true, interactive, state.replyControls, item.replies || []])
    if (repliesSignature !== entry.repliesSignature) {
      entry.repliesSignature = repliesSignature
      syncChildren(entry.replies, buildReplies(entry, item).map((node) => ({ node, on: true })))
    }

    const textareaState = item.textarea || {}
    applyStyle(entry.textareaWrap, { height: `${textareaState.height}px` })
    updateRichInput(entry.textarea, textareaState, `reply/${item.id}`)
    entry.sendAction.classList.toggle('is-disabled', !item.allowedReply)
    entry.sendAction.disabled = !item.allowedReply
    entry.cancelAction.disabled = !item.hasDraft
    entry.operation.disabled = item.canUploadImage === false
    const draftImagesSignature = JSON.stringify(item.draftImages || [])
    if (entry.draftImagesSignature !== draftImagesSignature) {
      entry.draftImagesSignature = draftImagesSignature
      syncChildren(entry.draftImages, imageDraftNodes(item.id, item.draftImages))
    }
    syncChildren(entry.textareaWrap, [
      { node: entry.inputRow, on: true },
      { node: entry.draftImages, on: !!item.draftImages?.length },
      { node: entry.actions, on: !!item.hasDraft },
      { node: entry.mentionPicker, on: !!(item.mentionPicker?.status || item.mentionPicker?.candidates?.length) },
    ])
    renderMentionPicker(entry.mentionPicker, item.mentionPicker, entry.textarea, `reply/${item.id}`)

    const editState = item.edit || null
    if (!editState) updateRichInput(entry.editInput, { value: '' }, `closed-edit/${item.id}`)
    if (editState) {
      entry.edit.dataset.replyId = editState.replyId || ''
      entry.edit.dataset.scope = `edit/${item.id}/${editState.replyId || ''}`
      updateRichInput(entry.editInput, editState, `edit/${item.id}/${editState.replyId}`)
      entry.editImageButton.disabled = editState.canUploadImage === false
      entry.editImageInput.dataset.commentImageScope = entry.edit.dataset.scope
      entry.editCancel.disabled = false
      entry.editSave.disabled = !!editState.readonly || (!String(editState.value || '').trim() && !(editState.draftImages || []).length)
      renderMentionPicker(entry.editMentionPicker, editState.mentionPicker, entry.editInput, `edit/${item.id}/${editState.replyId}`)
      entry.editMentionPicker.hidden = editState.readonly === true || !(editState.mentionPicker?.status || editState.mentionPicker?.candidates?.length)
      syncChildren(entry.editDraftImages, imageDraftNodes(entry.edit.dataset.scope, editState.draftImages))
      syncChildren(entry.edit, [
        { node: entry.editInput, on: true },
        { node: entry.editMentionPicker, on: true },
        { node: entry.editTools, on: true },
        { node: entry.editDraftImages, on: !!editState.draftImages?.length },
        { node: entry.editActions, on: true },
      ])
    }

    const translationState = item.translation || null
    if (translationState) {
      setText(entry.translationHint, '翻译仅处理当前回复，译文不会覆盖原文。')
      const contextKey = `${translationState.replyId || ''}/${translationState.sourceRevision || ''}`
      if (entry.translation.dataset.context !== contextKey) { entry.translation.dataset.context = contextKey; delete entry.translation.dataset.customLanguage }
      const customLanguage = entry.translation.dataset.customLanguage === 'true' || !entry.translationLanguages.some(([value]) => value === translationState.language)
      setInputValue(entry.translationSelect, customLanguage ? 'custom' : translationState.language)
      entry.translationSelect.disabled = !!translationState.busy || !!translationState.pending
      entry.translationInput.hidden = !customLanguage
      setInputValue(entry.translationInput, translationState.language || '')
      entry.translationInput.readOnly = !!translationState.busy || !!translationState.pending
      setText(entry.translationMessage, translationState.current === false ? '来源已失效或当前不可见，请重新选择回复。' : (translationState.message || ''))
      setText(entry.translationResult, translationState.translatedText || '')
      entry.translationSubmit.disabled = !!translationState.busy || !!translationState.pending || translationState.current === false
      entry.translationQuery.disabled = !!translationState.busy
      syncChildren(entry.translationActions, [{ node: entry.translationClose, on: true },
        { node: entry.translationSubmit, on: !translationState.pending },
        { node: entry.translationQuery, on: !!translationState.pending }])
    }

    setText(entry.moreTitle, state.moreTitle)
    setText(entry.moreHint, state.moreHint)
    entry.switchButton.classList.toggle('is-on', !!item.privateOn)
    entry.switchButton.disabled = item.privateEnabled === false
    setAttr(entry.switchButton, 'aria-checked', item.privateOn ? 'true' : 'false')

    const threadContent = [
      { node: entry.head, on: !item.documentOnly }, { node: entry.replies, on: true },
      { node: entry.edit, on: !!editState && interactive }, { node: entry.translation, on: !!translationState && interactive },
    ]
    if (nativeThreadOpen && !item.documentOnly) syncChildren(entry.threadScroll, threadContent)
    syncChildren(entry.root, [
      ...(nativeThreadOpen && !item.documentOnly ? [{ node: entry.threadScroll, on: true }] : threadContent),
      { node: entry.textareaWrap, on: !item.documentOnly && interactive },
      { node: entry.moreMenu, on: !!item.moreOpen && interactive },
    ])
  }

  function render() {
    if (!state.open || !isMobile()) nativeThreadOpen = false
    threadReader.hidden = !isReferenceDrawer()
    let focusMobile = false, scrollMobile = null
    syncScrollLock(isMobile() && ((!isInlineDocument() && !isReferenceDrawer() && state.open) || !!state.imageViewer || (hasInlineDocument() && isDocumentMentionOpen())))
    const alive = new Set()
    const slots = []
    ;(state.items || []).forEach((item) => {
      alive.add(item.id)
      let entry = panelNodes.get(item.id)
      if (!entry) {
        entry = createPanelNode(item.id)
        panelNodes.set(item.id, entry)
      }
      renderPanel(entry, item)
      slots.push({ node: entry.root, on: true, item })
    })
    Array.from(panelNodes.keys()).forEach((id) => {
      if (!alive.has(id)) {
        const entry = panelNodes.get(id)
        ;[entry.textarea, entry.editInput].forEach(input => { richInputs.get(input)?.destroy(); richInputs.delete(input) })
        panelNodes.delete(id)
      }
    })
    const chrome = []
    if (state.remote || isReferenceDrawer() || state.viewerHost) {
      setText(sidebarTitle, state.title)
      setText(historyButton, state.composer?.history || '')
      historyButton.hidden = !state.sidebarOpen || !!state.viewerHost
      collapseButton.hidden = !state.sidebarOpen
      collapseButton.setAttribute('aria-label', state.viewerHost ? '关闭图片评论' : '折叠评论')
      chrome.push({ node: sidebarHead, on: true })
    }
    const nextComposer = state.composer || {}
    applyStyle(composer, state.viewerHost ? { position: 'relative', right: 'auto', bottom: 'auto', width: '100%', boxSizing: 'border-box', flexShrink: '0' } : {})
    setText(composerQuote, nextComposer.quote || '')
    setText(composerAuthor, nextComposer.author || '')
    updateRichInput(composerInput, nextComposer, 'selection')
    composerPrivate.checked = !!nextComposer.privateOn
    composerPrivate.disabled = !!nextComposer.readonly
    composerSend.disabled = !nextComposer.canSubmit || (!String(nextComposer.value || '').trim() && !nextComposer.hasImages)
    composerCancel.disabled = false
    composerImageButton.disabled = nextComposer.canUploadImage === false
    syncChildren(composerImageDrafts, imageDraftNodes('selection', nextComposer.draftImages))
    composerImageDrafts.hidden = !nextComposer.draftImages?.length
    chrome.push({ node: composer, on: !!nextComposer.open })
    const nextDocumentComposer = state.documentComposer || {}
    const inlineDocument = hasInlineDocument()
    const like = state.like || {}, snapshot = like.snapshot
    likeButton.disabled = !like.available || !!like.busy || (!snapshot && !like.pending)
    likeButton.setAttribute('aria-pressed', String(snapshot?.liked === true))
    likeButton.setAttribute('aria-label', like.pending ? '查询点赞结果' : snapshot?.liked ? '取消文档点赞' : '点赞文档')
    likeButton.title = !like.available ? '未配置文档点赞服务' : like.error || ''
    setText(likeCount, snapshot?.total || ''); likeCount.hidden = !snapshot?.total || snapshot.total === '0'
    setText(likeStatus, like.error || ''); likeStatus.hidden = !like.error
    const documentHasDraft = Boolean(String(nextDocumentComposer.value || '').trim()) || Boolean(nextDocumentComposer.replyTarget) || Boolean(nextDocumentComposer.draftImages?.length)
    setText(documentComposerTarget, nextDocumentComposer.replyTarget ? `回复：${nextDocumentComposer.replyTarget.displayName || nextDocumentComposer.replyTarget.principalId || ''}` : '')
    updateRichInput(documentComposerInput, nextDocumentComposer, 'document')
    documentComposerInput.title = nextDocumentComposer.reason || ''
    documentComposerInputWrap.classList.toggle('is-multiline', String(nextDocumentComposer.value || '').includes('\n'))
    documentComposerPrivate.checked = !!nextDocumentComposer.privateOn
    documentComposerPrivate.disabled = !!nextDocumentComposer.readonly
    documentComposerImageButton.disabled = nextDocumentComposer.canUploadImage === false
    documentComposerSend.disabled = !nextDocumentComposer.canSubmit || (!String(nextDocumentComposer.value || '').trim() && !nextDocumentComposer.hasImages)
    const sendHost = inlineDocument ? documentComposerInputWrap : documentComposerActions
    if (documentComposerSend.parentNode !== sendHost) sendHost.appendChild(documentComposerSend)
    setAttr(documentComposerSend, 'aria-label', inlineDocument ? '发送全文评论' : null)
    if (inlineDocument) {
      if (!documentComposerSend.firstElementChild) documentComposerSend.replaceChildren(iconNode('comment-send', 24))
    } else setText(documentComposerSend, '发送')
    const documentPlaceholder = inlineDocument ? '输入评论' : '输入全文评论'
    documentComposerInput.setAttribute('data-placeholder', documentPlaceholder)
    documentComposerInput.placeholder = documentPlaceholder
    documentComposerCancel.disabled = false
    renderCommentSegments(documentComposerPreview, nextDocumentComposer.segments || [])
    renderMentionPicker(documentComposerMentionPicker, nextDocumentComposer.mentionPicker, documentComposerInput)
    documentComposerMentionPicker.hidden = !(nextDocumentComposer.mentionPicker?.status || nextDocumentComposer.mentionPicker?.candidates?.length)
    documentMentionSheet.hidden = !isDocumentMentionOpen()
    documentComposer.classList.toggle('is-mention-open', isInlineDocument() && !documentMentionSheet.hidden)
    setAttr(documentMentionSheet, 'role', isInlineDocument() && !documentMentionSheet.hidden ? 'dialog' : null)
    syncChildren(documentComposerImages, imageDraftNodes('document', nextDocumentComposer.draftImages))
    documentComposerTarget.hidden = !nextDocumentComposer.replyTarget
    documentComposerPreview.hidden = true
    documentComposerTools.hidden = !documentHasDraft
    documentComposerImages.hidden = !nextDocumentComposer.draftImages?.length
    documentComposerActions.hidden = !documentHasDraft && !(inlineDocument && documentComposerMore.getAttribute('aria-expanded') === 'true')
    chrome.push({ node: documentComposer, on: nextDocumentComposer.open === true })
    setText(emptyState, state.emptyText || '')
    chrome.push({ node: emptyState, on: !!state.emptyText && !nextComposer.open && !(state.items || []).length })
    const media = state.imageStatus || {}
    setText(imageStatusText, media.busy ? '正在处理图片…' : '图片上传结果尚未确认')
    queryImage.disabled = !media.canQuery
    syncChildren(imageStatus, [{ node: imageStatusText, on: true }, { node: cancelUpload, on: !!media.busy && !!media.canCancel }, { node: queryImage, on: !!media.pending }])
    const viewer = state.imageViewer
    if (viewer) { viewerImage.src = viewer.url; viewerImage.alt = viewer.fileName || ''; setText(viewerCaption, viewer.fileName) }
    else viewerImage.removeAttribute('src')
    const picker = state.reactionPicker || {}
    if (picker.position) applyStyle(reactionPicker, {
      position: 'fixed',
      left: `${picker.position.left}px`,
      top: `${picker.position.top}px`,
    })
    setInputValue(reactionSearch, picker.query || '')
    syncChildren(reactionTabs, (picker.categories || []).map(category => {
      const button = document.createElement('button')
      button.type = 'button'; button.textContent = category
      button.setAttribute('aria-selected', String(category === picker.category))
      onAction(button, () => call('onReactionCategory', category))
      return { node: button, on: true }
    }))
    reactionGrid.textContent = ''
    ;(picker.items || []).forEach(item => {
      const button = document.createElement('button')
      button.type = 'button'; button.textContent = item.glyph || item.emoji || ''
      button.setAttribute('aria-label', item.label || item.value || item.glyph || item.emoji || '')
      onAction(button, () => call('onChooseReaction', item.glyph || item.emoji))
      reactionGrid.appendChild(button)
    })
    const hasMore = (picker.items || []).length >= (picker.limit || 120)
    reactionMore.hidden = !hasMore
    queryTranslation.disabled = !state.translationRecovery?.canQuery
    let content = [...chrome, ...slots], documentContent = []
    if (inlineDocument) {
      slots.forEach(slot => { slot.node.inert = false; slot.node.removeAttribute('aria-hidden') })
      const documentSlots = slots.filter(slot => slot.item.documentOnly)
      if (!documentSlots.length) setText(emptyState, '暂无全文评论')
      if (documentComposerImageButton.parentNode !== documentComposerInputWrap) documentComposerInputWrap.append(documentComposerImageButton, documentComposerMore)
      documentComposerMore.hidden = documentHasDraft
      documentComposerSend.hidden = !documentHasDraft
      documentContent = [{ node: documentLike, on: true }, { node: documentHeading, on: true }, ...documentSlots,
        { node: emptyState, on: !documentSlots.length },
        { node: documentComposer, on: nextDocumentComposer.open === true }, { node: backToTop, on: true }]
    }
    if (isInlineDocument()) {
      content = documentContent
      wasMobileOpen = false
    } else if (isReferenceDrawer()) {
      const cards = slots.filter(slot => !slot.item.documentOnly)
      documentFlow.classList.toggle('is-remote', state.remote === true)
      syncChildren(documentFlow, documentContent)
      mountNode(options.inlineHost, documentFlow, state.documentInline === true)
      setText(sidebarTitle, state.title)
      collapseButton.hidden = false; collapseButton.setAttribute('aria-label', '折叠评论')
      historyButton.hidden = true
      content = [{ node: sidebarHead, on: true }, ...cards]
      cards.forEach(slot => { slot.node.inert = false; slot.node.removeAttribute('aria-hidden') })
      wasMobileOpen = false
    } else if (isMobile()) {
      documentComposerSend.hidden = false
      if (documentComposerImageButton.parentNode !== documentComposerTools) documentComposerTools.prepend(documentComposerImageButton)
      documentComposerMore.remove()
      const selection = state.mobileScope === 'selection' || !!nextComposer.open
      const cards = slots.filter(slot => !slot.item.documentOnly)
      mobileIds = cards.map(slot => slot.item.id)
      const requested = mobileIds.includes(state.activeThreadId) ? state.activeThreadId : mobileIds.includes(mobileActive) ? mobileActive : mobileIds[0] || ''
      const activeChanged = requested !== mobileActive
      mobileActive = requested
      const index = Math.max(0, mobileIds.indexOf(mobileActive))
      setText(mobileTitle, selection ? `评论${mobileIds.length ? ` ${index + 1}/${mobileIds.length}` : ''}` : '全文评论 · 扩展')
      mobilePrev.hidden = mobileNext.hidden = !selection || mobileIds.length < 2 || !!nextComposer.open
      mobilePrev.disabled = index === 0; mobileNext.disabled = index >= mobileIds.length - 1
      mobileSheet.setAttribute('aria-label', selection ? '选区评论' : '全文评论扩展')
      mobileSheet.classList.toggle('is-selection', selection)
      mobileSheet.classList.toggle('is-vertical-thread', nativeThreadOpen)
      mobileSheet.classList.toggle('is-document', !selection)
      if (!selection && !slots.some(slot => slot.item.documentOnly)) setText(emptyState, '暂无全文评论')
      cards.forEach((slot, cardIndex) => {
        slot.node.setAttribute('aria-label', `评论 ${cardIndex + 1}/${cards.length}`)
        slot.node.setAttribute('aria-hidden', String(selection && slot.item.id !== mobileActive))
        slot.node.inert = selection && slot.item.id !== mobileActive
      })
      syncChildren(mobileCarousel, nativeThreadOpen ? cards.filter(slot => slot.item.id === mobileActive) : cards)
      if (nativeThreadOpen && (activeChanged || !wasMobileOpen)) { const active = panelNodes.get(mobileActive); if (active) active.threadScroll.scrollTop = 0 }
      syncChildren(mobileDocumentList, [...slots.filter(slot => slot.item.documentOnly), { node: emptyState, on: !slots.some(slot => slot.item.documentOnly) }])
      syncChildren(mobileSheet, [{ node: mobileHead, on: true },
        { node: composer, on: selection && !!nextComposer.open },
        { node: mobileCarousel, on: selection && !nextComposer.open && cards.length > 0 },
        { node: emptyState, on: selection && !nextComposer.open && !cards.length },
        { node: mobileDocumentList, on: !selection },
        { node: documentComposer, on: !selection && nextDocumentComposer.open === true }])
      content = [{ node: mobileSheet, on: true }]
      if (selection && (activeChanged || !wasMobileOpen || mobileScope !== 'selection')) scrollMobile = index
      mobileScope = selection ? 'selection' : 'document'
      if (!wasMobileOpen) {
        focusMobile = !nextComposer.open
      }
      wasMobileOpen = true
    } else {
      documentComposerSend.hidden = false
      if (documentComposerImageButton.parentNode !== documentComposerTools) documentComposerTools.prepend(documentComposerImageButton)
      documentComposerMore.remove()
      slots.forEach(slot => { slot.node.inert = false; slot.node.removeAttribute('aria-hidden') })
      wasMobileOpen = false
    }
    syncChildren(el, [...content, { node: imageStatus, on: !!media.busy || !!media.pending },
      { node: translationRecovery, on: !!state.translationRecovery?.pending },
      { node: imageBackdrop, on: !!viewer }, { node: reactionPicker, on: picker.open === true }])
    // Measure soft wrapping only after the composer is attached in its current scope.
    const composerStyle = inlineDocument ? documentComposerInput.ownerDocument.defaultView?.getComputedStyle(documentComposerInput) : null
    const metric = (name, fallback) => { const value = parseFloat(composerStyle?.[name]); return Number.isFinite(value) ? value : fallback }
    const minimumHeight = metric('minHeight', 40)
    documentComposerInput.style.height = `${minimumHeight}px`
    if (documentHasDraft) {
      const lines = String(nextDocumentComposer.value || '').split('\n').length
      const lineHeight = metric('lineHeight', inlineDocument ? 24 : 22)
      const border = metric('borderTopWidth', 1) + metric('borderBottomWidth', 1)
      const inset = metric('paddingTop', 7) + metric('paddingBottom', 7) + border
      const contentHeight = inlineDocument ? Math.max(lines * lineHeight + inset, documentComposerInput.scrollHeight + border) : 40 + Math.max(0, lines - 1) * lineHeight
      documentComposerInput.style.height = `${Math.min(Math.max(minimumHeight, contentHeight), Math.max(minimumHeight, Math.round((documentComposerInput.ownerDocument.defaultView?.innerHeight || 800) * 0.4)))}px`
    }
    if (scrollMobile !== null && !nativeThreadOpen) mobileCarousel.scrollLeft = scrollMobile * mobileCarousel.clientWidth
    positionReplyMenus()
    if (focusMobile) mobileClose.focus({ preventScroll: true })
  }

  function update(patch) {
    if (destroyed) return
    const identityChanged = patch && Object.hasOwn(patch, 'identityGeneration') && patch.identityGeneration !== state.identityGeneration
    Object.assign(state, patch || {})
    const confirmationReply = deleteConfirmation && state.items?.find(item => item.id === deleteConfirmation.threadId)?.replies?.find(reply => reply.id === deleteConfirmation.replyId && !reply.tombstone)
    if (identityChanged || (deleteConfirmation && (!confirmationReply || !deleteConfirmation.intent.current() || (state.viewerHost && state.viewerCurrent?.() !== true)))) closeDeleteConfirmation()
    if (identityChanged || state.open === false) { cancelReplyMenuClose(); dismissedReplyHover = null }
    if (identityChanged) {
      if (!Object.hasOwn(patch, 'message')) state.message = ''
      syncScrollLock(false)
      restoreMobileFocus = null
      richInputs.forEach(editor => editor.update({ value: '', readonly: true, scopeKey: `${state.identityGeneration}/cleared` }))
      panelNodes.forEach(entry => {
        const inputs = [entry.textarea, entry.editInput]
        inputs.forEach(input => { richInputs.get(input)?.destroy(); richInputs.delete(input) })
        entry.root.replaceChildren()
      })
      panelNodes.clear()
      mobileCarousel.replaceChildren(); mobileDocumentList.replaceChildren(); mobileSheet.replaceChildren(); documentFlow.replaceChildren(); el.replaceChildren()
      composerQuote.textContent = ''; composerImageDrafts.replaceChildren(); documentComposerImages.replaceChildren(); documentComposerPreview.textContent = ''; documentComposerTarget.textContent = ''
      viewerImage.removeAttribute('src'); viewerCaption.textContent = ''
      if (!patch.items) state.items = []
      if (!Object.hasOwn(patch, 'documentComposer')) state.documentComposer = { open: false }
      if (!Object.hasOwn(patch, 'launcher')) state.launcher = { visible: false }
    }
    const message = typeof state.message === 'string' ? state.message : ''
    launcher.style.top = `${Math.max(0, state.launcher?.top || 0)}px`
    launcher.style.right = `${Math.max(0, state.launcher?.right || 0)}px`
    launcherButton.setAttribute('aria-expanded', String(!!state.sidebarOpen))
    mountNode(options.inlineHost?.closest('.lark-doc') || host, launcher, isMobile() && state.launcher?.visible === true && !state.sidebarOpen && !state.composer?.open)
    setText(notice, message)
    mountNode(state.viewerHost || host, notice, Boolean(message))
    el.classList.toggle('is-remote', state.remote === true)
    el.classList.toggle('is-mobile', isMobile())
    const inline = isInlineDocument()
    el.classList.toggle('is-inline-document', inline)
    const drawer = isReferenceDrawer()
    el.classList.toggle('is-reference-drawer', drawer)
    if (drawer) el.style.setProperty('--ld-comment-drawer-width', `${Math.round(Math.min(300, el.ownerDocument.defaultView.innerWidth * 0.75))}px`)
    if (!drawer) mountNode(null, documentFlow, false)
    setAttr(el, 'role', inline ? 'region' : drawer ? 'complementary' : null)
    setAttr(el, 'aria-label', inline ? '全文评论' : drawer ? state.title : null)
    const visible = inline || (!!state.open && (!isMobile() || state.mobileOpen !== false))
    const restoreInline = inline && wasMobileOpen ? restoreMobileFocus : null
    if (visible && isMobile() && !inline && !wasMobileOpen) restoreMobileFocus = el.ownerDocument.activeElement
    const drawerHost = drawer && options.inlineHost?.closest('.lark-doc-main')
    const viewerBounds = state.viewerHost?.getBoundingClientRect()
    const viewerClose = state.viewerHost?.querySelector('[data-viewer-action="close"]')?.getBoundingClientRect()
    const viewerToolbar = state.viewerHost?.querySelector('.lark-doc-image-viewer-toolbar')?.getBoundingClientRect()
    applyStyle(el, state.viewerHost ? { position: 'absolute', left: 'auto', right: '0',
      top: `${viewerClose?.height ? Math.max(0, viewerClose.bottom - viewerBounds.top + 8) : 56}px`,
      bottom: `${viewerToolbar?.height ? Math.max(0, viewerBounds.bottom - viewerToolbar.top + 8) : 95}px`, width: `${Math.min(300, el.ownerDocument.defaultView.innerWidth * .75)}px`, maxWidth: '100%',
      display: 'flex', flexDirection: 'column', gap: '12px', padding: '16px', boxSizing: 'border-box', overflow: 'auto', overscrollBehavior: 'contain',
      background: 'var(--ld-comment-surface)', color: 'var(--ld-text)', pointerEvents: 'auto', zIndex: '1003' } : {})
    mountNode(state.viewerHost || (inline ? options.inlineHost : drawerHost || host), el, visible)
    if (drawerHost) el.style.minHeight = `${Math.max(drawerHost.clientHeight, options.inlineHost.scrollHeight)}px`
    else el.style.minHeight = ''
    if (!visible) {
      closeDeleteConfirmation()
      syncScrollLock(false)
      if (wasMobileOpen && restoreMobileFocus?.isConnected) restoreMobileFocus.focus({ preventScroll: true })
      wasMobileOpen = false
      return
    }
    render()
    if (restoreInline?.isConnected && !state.imageViewer && !state.reactionPicker?.open) restoreInline.focus({ preventScroll: true })
  }

  return {
    el,
    update,
    destroy() { if (destroyed) return; destroyed = true; closeDeleteConfirmation(); menuViewport?.removeEventListener('resize', positionReplyMenus); menuViewport?.removeEventListener('scroll', positionReplyMenus); cancelReplyMenuClose(); dismissedReplyHover = null; syncScrollLock(false); launcher.remove(); notice.remove(); documentFlow.remove(); window.removeEventListener('resize', resizeMobile); cancelAnimationFrame(scrollFrame); richInputs.forEach(input => input.destroy()); richInputs.clear(); if (el.parentNode) el.parentNode.removeChild(el) },
  }
}
