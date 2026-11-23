/**
 * 历史记录全屏层与版本提示 toast —— 原生 DOM 版。
 *
 * 从 `ui/panels.js` 原样搬出，函数体、类名、断言口径一行未改：结构即契约，
 * `scripts/verify-browser-panels.js` 逐字段量这里产出的 DOM。
 */

import { applyStyle, mountNode, setAttr, setText, syncChildren } from './dom'
import { iconNode } from './icon'
import { handlerCaller, onMouseDownPrevent } from './panelShared'

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
  // 飞书这里是「箭头 + 返回文档」的文字按钮，不是一个裸图标。
  const backLabel = document.createElement('span')
  backLabel.className = 'lark-doc-version-back-label'
  backLabel.textContent = '返回文档'
  backButton.appendChild(backLabel)
  backButton.addEventListener('mousedown', (event) => {
    event.preventDefault()
    if (mobile() && mobileView === 'preview') { mobileView = 'list'; render(); return }
    call('onClose')
  })
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
  // 飞书这排是版本翻页（66×28），文案是「上一页 / 下一页」；「上一项 / 下一项」留给
  // 差异游标那两颗（`aria-label="上一项编辑"`）。两者语义不同，别混用。
  prevButton.textContent = '上一页'
  onMouseDownPrevent(prevButton, () => call('onPrev'))
  const nextButton = document.createElement('button')
  nextButton.type = 'button'
  nextButton.className = 'lark-doc-version-step'
  nextButton.textContent = '下一页'
  onMouseDownPrevent(nextButton, () => call('onNext'))
  pager.appendChild(cursorLabel)
  pager.appendChild(prevButton)
  pager.appendChild(nextButton)

  const headerDivider = document.createElement('span')
  headerDivider.className = 'lark-doc-version-header-divider'

  leftHeader.appendChild(backButton)
  leftHeader.appendChild(restoreButton)
  leftHeader.appendChild(pager)
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
  restoreConfirmMask.addEventListener('mousedown', event => { if (event.target === restoreConfirmMask) event.preventDefault() })
  const restoreConfirm = document.createElement('section'); restoreConfirm.className = 'lark-doc-version-restore-dialog'
  restoreConfirm.setAttribute('role', 'alertdialog'); restoreConfirm.setAttribute('aria-modal', 'true'); restoreConfirm.setAttribute('aria-label', '还原此记录确认')
  const restoreConfirmTitle = document.createElement('h2'); restoreConfirmTitle.textContent = '还原此记录？'
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
  // 「历史记录 ⓘ」是一个整体：图标紧贴标题，不参与右侧 space-between 的分布。
  const rightHeading = document.createElement('div')
  rightHeading.className = 'lark-doc-version-right-heading'
  const rightTitle = document.createElement('span')
  rightTitle.className = 'lark-doc-version-right-title'
  rightTitle.textContent = '历史记录'
  const rightInfo = document.createElement('span')
  rightInfo.className = 'lark-doc-version-right-info'
  rightInfo.setAttribute('role', 'img')
  rightInfo.setAttribute('aria-label', '历史记录会自动保存，可随时还原任意一条')
  setAttr(rightInfo, 'title', '历史记录会自动保存，可随时还原任意一条')
  // 飞书头部是「圆圈问号」（MaybeOutlined），不是 info 的「i」——放大截图逐像素确认。
  rightInfo.appendChild(iconNode('menu-help', 16))
  rightHeading.appendChild(rightTitle)
  rightHeading.appendChild(rightInfo)
  // 飞书历史记录头部只有「历史记录 + 圆圈问号」两个元素：既没有折叠用的 chevronDown，
  // 也没有「回收站」按钮。回收站入口在「已存版本」子菜单末尾（documentMenuView.js）。
  rightHeader.appendChild(rightHeading)

  const timeline = document.createElement('div')
  timeline.className = 'lark-doc-version-timeline'
  const timelineError = document.createElement('p')
  timelineError.className = 'lark-doc-version-empty'

  const rightFooter = document.createElement('div')
  rightFooter.className = 'lark-doc-version-right-footer'
  // 飞书底栏是「显示更改 + 开关」，不是一个说明文字：关掉后预览里不再叠改动高亮。
  const showChangesLabel = document.createElement('span')
  showChangesLabel.className = 'lark-doc-version-changes-label'
  showChangesLabel.textContent = '显示更改'
  const showChangesToggle = document.createElement('button')
  showChangesToggle.type = 'button'
  showChangesToggle.className = 'lark-doc-version-changes-switch'
  showChangesToggle.setAttribute('role', 'switch')
  showChangesToggle.setAttribute('aria-label', '显示更改')
  const showChangesThumb = document.createElement('span')
  showChangesThumb.className = 'lark-doc-version-changes-switch-handler'
  showChangesThumb.setAttribute('aria-hidden', 'true')
  showChangesToggle.appendChild(showChangesThumb)
  showChangesToggle.addEventListener('click', () => { if (!showChangesToggle.disabled && !destroyed) call('onToggleShowChanges') })
  rightFooter.appendChild(showChangesLabel)
  rightFooter.appendChild(showChangesToggle)

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
    // 飞书的月份标题是纯文字，不是折叠按钮（折叠落在条目自己的三角上，见 009 T9/C4）。
    const label = document.createElement('div')
    label.className = 'lark-doc-version-day-label'
    label.textContent = day.label == null ? '' : String(day.label)
    box.appendChild(label)
    const rows = document.createElement('div'); box.appendChild(rows)
    // 飞书整月一次性铺开（`hist_i_select2.png` 一个月 11 条全在），没有「先给三条 + 更多」。
    ;(day.items || []).forEach((item) => {
      const row = document.createElement('button')
      row.type = 'button'
      row.className = item.cls ? `lark-doc-version-item ${item.cls}` : 'lark-doc-version-item'
      row.addEventListener('click', () => { if (destroyed) return; mobileView = 'preview'; mobileSelectedId = item.id; call('onSelect', item.id); render() })
      const name = document.createElement('div')
      name.className = 'lark-doc-version-item-name'
      name.textContent = item.name == null ? '' : String(item.name)
      row.appendChild(name)
      // 第二行事件描述。飞书这个节点**始终存在**（空的时候高度 0，上下外边距自折叠成一个
      // 4px 间隙），条目因此停在 66 高；有描述时多一行 18 高，条目 88 高。别改成条件渲染，
      // 否则两行条目的高度就和飞书差 0px 之外的塌陷行为。
      const desc = document.createElement('div')
      desc.className = 'lark-doc-version-item-desc'
      desc.textContent = item.desc == null ? '' : String(item.desc)
      row.appendChild(desc)
      const user = document.createElement('div')
      user.className = 'lark-doc-version-item-user'
      user.textContent = item.user == null ? '' : String(item.user)
      row.appendChild(user)
      rows.appendChild(row)
    })
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
    const decoded = !!preview.document && typeof options.renderDocument === 'function'
    previewBox.classList.toggle('has-document', decoded)
    setText(previewTitle, preview.title || '未命名版本')
    setText(previewKind, preview.kind)
    const meta = preview.meta || []
    metaSpans.forEach((span, index) => {
      if (index < meta.length) setText(span, meta[index])
    })
    syncChildren(previewMeta, metaSpans.map((span, index) => ({ node: span, on: index < meta.length })))
    setText(degradedNode, preview.degraded)
    const degradedOn = !!preview.degraded
    const showChanges = state.showChanges !== false
    // 关掉「显示更改」= 只看版式：差异行、改动清单、翻页器和高亮一起让位。
    if (!showChanges) {
      documentBody.querySelectorAll('.is-version-change').forEach(node => node.classList.remove('is-version-change'))
      lastChangeIndex = -1
    }
    // `v-if` / 组件外的兄弟：降级文案与 diff 段各自独立。
    syncChildren(previewBox, [
      { node: previewHead, on: true },
      { node: previewMeta, on: !decoded },
      { node: degradedNode, on: degradedOn },
      { node: diffBox, on: !decoded && showChanges && !!preview.diff },
      { node: bodyBox, on: true },
      { node: changesMessage, on: showChanges }, { node: changesList, on: showChanges && !!preview.changes?.length }, { node: changePager, on: showChanges },
    ])
    if (preview.diff) setText(diffRow, preview.diff.row)
    // `payload` 非空 = 该版本正文是可解码的二进制快照（模板里的 `v-if`）；空则走兜底文案。
    const payload = preview.payload || ''
    if (payload) setText(binaryPayload, payload)
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
    if (at !== lastChangeIndex && at > 0 && showChanges) {
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
    backLabel.textContent = mobile() && mobileView === 'preview' ? '返回列表' : '返回文档'
    setText(rightTitle, state.kind === 'saved' ? '已存版本' : '历史记录')
    // 对话框名跟着视图走：`查看已存版本` 打开的仍是这个层，但读屏不能报成「历史记录」。
    el.setAttribute('aria-label', state.kind === 'saved' ? '已存版本' : '历史记录')
    // 「显示更改」开关的当前态：视觉靠 `.on`，语义靠 `aria-checked`。
    const showChanges = state.showChanges !== false
    showChangesToggle.setAttribute('aria-checked', String(showChanges))
    showChangesToggle.classList.toggle('on', showChanges)
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
    if (state.view === 'preview') renderPreview(); else { clearDocument(); previewBox.classList.remove('has-document') }
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

/* ═════════════════════ ③ 版本提示 toast ═════════════════════ */

/**
 * 版本提示 toast（对应飞书 `.ud__toast` 里的 success 通知）。
 *
 * 手动「另存为版本」成功后与还原成功后都靠它回话。
 *
 * 实测一份（`[510.95,40,418.09,54]`、viewport 1440×900）：
 * ```
 * div.ud__notice.ud__notice-success.ud__notice-closable.ud__notice-showIcon.ud__notice-has-action.ud__notice--outlined.ud__toast
 * ├ span.universe-icon.ud__notice__statusIcon   16×16 @[530,59]  rgb(50,166,69)
 * ├ div.ud__notice__description                 14/22  #1F2329  @[554,56]
 * │ └ button.ud__button--text.ud__button--text-primary  立即查看 24×26 @[813.05,54]
 * │      padding:2px 4px  radius:6px  color:#1456F0
 * └ button.ud__button--icon                     24×24 @[889.05,55]  padding:4px  #646A73
 * ```
 * 三个数对上才敢落笔：`19 + 16 + 8 + 正文 + 12 + 24 + 3 = 418`（内边距 + 图标 + 间隔 + 正文
 * + 关闭前留白 + 关闭 + 内边距）；行高 24 由关闭钮撑开（正文 22 居中、图标 16 居中）；
 * 高度 54 = `15 + 24 + 15`。底色是浅绿 `rgb(228,250,225)`，圆角 6（不是历史记录面板的 8）。
 *
 * state: `{ notice }`；空串即整棵摘掉。
 */
export function createVersionToast(options = {}) {
  const host = options.host || null
  const call = handlerCaller(options.handlers || {})

  const state = { notice: '' }

  const el = document.createElement('div')

  const notice = document.createElement('div')
  notice.className = 'lark-doc-version-notice'
  notice.setAttribute('role', 'status')
  const noticeIcon = document.createElement('span')
  noticeIcon.className = 'lark-doc-version-notice-icon'
  noticeIcon.setAttribute('aria-hidden', 'true')
  noticeIcon.appendChild(iconNode('check-circle', 16))
  // 正文与「立即查看」同处一个行盒：按钮是行内元素，行高被它从 22 顶到 26。
  const noticeBody = document.createElement('div')
  noticeBody.className = 'lark-doc-version-notice-body'
  const noticeText = document.createElement('span')
  const noticeLink = document.createElement('button')
  noticeLink.type = 'button'
  noticeLink.className = 'lark-doc-version-notice-link'
  noticeLink.textContent = '立即查看'
  onMouseDownPrevent(noticeLink, () => call('onNoticeLink'))
  noticeLink.addEventListener('click', event => { if (event.detail === 0) call('onNoticeLink') })
  const noticeClose = document.createElement('button')
  noticeClose.type = 'button'
  noticeClose.className = 'lark-doc-version-notice-close'
  noticeClose.setAttribute('aria-label', '关闭')
  noticeClose.appendChild(iconNode('close', 16))
  noticeClose.addEventListener('click', () => call('onNoticeClose'))
  noticeBody.append(noticeText, noticeLink)
  notice.append(noticeIcon, noticeBody, noticeClose)
  el.appendChild(notice)

  function update(patch) {
    Object.assign(state, patch || {})
    mountNode(host, el, !!state.notice)
    if (!el.parentNode) return
    setText(noticeText, state.notice)
  }

  return {
    el,
    update,
    destroy() { if (el.parentNode) el.parentNode.removeChild(el) },
  }
}

