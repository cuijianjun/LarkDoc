/**
 * 面板 / 宿主弹窗 —— 原生 DOM 版（`src/ui/` 积木 · 阶段 5 批次 4b）。
 *
 * 原 SFC 在本批次删除，这里是四个面板的唯一实现：
 *   ① `editor/OutlinePanel.vue`   —— 目录侧栏（210px sticky，父级另有一颗 ☰ 兄弟钮）
 *   ② `VersionPanel.vue`          —— 历史记录全屏层（左预览 + 右按天时间线）
 *   ③ `SaveVersionDialog.vue`     —— 另存为版本 Dialog + 恢复成功 toast
 *   ④ `CommentPanel.vue`          —— 评论面板层（`display:contents` 容器 + 每线程一张卡）
 *
 * `TemplateLibrary.vue` 是**宿主侧**组件（`src/index.js` 对外导出、独立路由），
 * 不在编辑器里，刻意留到阶段 7，不在本文件里。
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

import { applyStyle, setAttr, syncChildren } from './dom'
import { iconNode } from './icon'

/** 统一取 handler：缺项静默（与 `dialogs.js` 同口径，漏接线不该炸在渲染里）。 */
function handlerCaller(handlers) {
  return (name, ...args) => {
    const fn = handlers[name]
    return typeof fn === 'function' ? fn(...args) : undefined
  }
}

/** 只在文案真的变了才写 —— 无脑赋值会把子节点全换成新 Text，丢掉选区与测量缓存。 */
function setText(node, text) {
  if (!node) return
  const target = text === null || text === undefined ? '' : String(text)
  if (node.textContent !== target) node.textContent = target
}

/** `:value` —— 走 DOM property，且只在真的变了才写（否则光标被踢到末尾）。 */
function setInputValue(input, value) {
  if (!input) return
  const text = value === null || value === undefined ? '' : String(value)
  if (input.value !== text) input.value = text
}

/** `@mousedown.prevent` —— 点面板内的控件不许把焦点让给 body。 */
function onMouseDownPrevent(node, run) {
  node.addEventListener('mousedown', (event) => {
    event.preventDefault()
    run(event)
  })
}

/**
 * 面板开合 = 「只增删自己这一棵」，**不能用 `syncChildren`**。
 *
 * 历史层 / 另存为 / 评论层三者共用同一个宿主（与 `dialogs.js` 的 `dialogHost` 同款：
 * 它们都 `position: fixed`，父级是谁不影响定位）。而 `syncChildren(host, …)` 会把
 * 「不在期望序列里」的子节点一律 `removeChild` —— 三个面板各自 update 一次就会
 * 互相把对方摘掉，最后只有最后更新的那个活着。
 *
 * 与 `dialogs.js` 逐字同款，别在这里换成 `syncChildren`。
 */
function mountNode(host, node, on) {
  if (!on) {
    if (node.parentNode) node.parentNode.removeChild(node)
    return
  }
  if (host && node.parentNode !== host) host.appendChild(node)
}

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
export function createOutlinePanel(options = {}) {
  const host = options.host || null
  const call = handlerCaller(options.handlers || {})

  const state = { open: false, empty: true, pending: false, active: -1, items: [] }

  const el = document.createElement('aside')
  el.className = 'lark-doc-outline'
  el.setAttribute('aria-label', '文档目录')

  const heading = document.createElement('div')
  heading.className = 'lark-doc-outline-heading'
  const headingTitle = document.createElement('strong')
  headingTitle.textContent = '目录'
  const closeButton = document.createElement('button')
  closeButton.type = 'button'
  closeButton.setAttribute('aria-label', '关闭目录')
  closeButton.appendChild(iconNode('close', 14))
  closeButton.addEventListener('click', () => call('onToggleOpen'))
  heading.appendChild(headingTitle)
  heading.appendChild(closeButton)

  // 空态：必须是 `aside` 的**直系** `<p>`（断言读 `:scope > p`）。
  const emptyNode = document.createElement('p')
  emptyNode.textContent = '添加标题后自动生成目录'

  /** @type {Map<number, ReturnType<typeof createItemNode>>} */
  const itemNodes = new Map()

  function createItemNode(pos) {
    const root = document.createElement('div')
    root.className = 'lark-doc-outline-item'

    const toggle = document.createElement('button')
    toggle.type = 'button'
    // 箭头是 8×12 的 CSS 三角（`border-left` 撑出来的），**不是** SVG。
    const arrow = document.createElement('span')
    arrow.className = 'lark-doc-outline-arrow'
    arrow.setAttribute('aria-hidden', 'true')
    toggle.appendChild(arrow)
    toggle.addEventListener('click', () => call('onToggle', pos))

    const placeholder = document.createElement('span')
    placeholder.className = 'lark-doc-outline-toggle-placeholder'
    placeholder.setAttribute('aria-hidden', 'true')

    const jump = document.createElement('button')
    jump.type = 'button'
    jump.addEventListener('click', () => call('onJump', pos))

    return { root, toggle, arrow, placeholder, jump }
  }

  function render() {
    const slots = [
      { node: heading, on: true },
      { node: emptyNode, on: !!state.empty },
    ]
    const alive = new Set()
    state.items.forEach((item) => {
      alive.add(item.pos)
      let entry = itemNodes.get(item.pos)
      if (!entry) {
        entry = createItemNode(item.pos)
        itemNodes.set(item.pos, entry)
      }
      const { root, toggle, arrow, placeholder, jump } = entry
      // `:style="{ paddingLeft: min(level-1,5)*10 }"` —— 替换语义，整体覆盖。
      applyStyle(root, { paddingLeft: `${Math.min(item.level - 1, 5) * 10}px` })
      const active = item.pos === state.active
      if (item.hasChildren) {
        toggle.classList.toggle('active', active)
        setAttr(toggle, 'aria-label', `${item.collapsed ? '展开' : '收起'}目录：${item.text || '标题'}`)
        setAttr(toggle, 'aria-expanded', String(!item.collapsed))
        setAttr(toggle, 'title', item.collapsed ? '展开目录' : '收起目录')
        arrow.classList.toggle('is-collapsed', !!item.collapsed)
      }
      jump.classList.toggle('active', active)
      jump.disabled = !!state.pending
      // 未 pending 时**不输出** title（模板里是 `undefined`），断言会量 null。
      setAttr(jump, 'title', state.pending ? '正文还在载入，稍后可跳转' : null)
      setText(jump, item.text || '无标题')
      syncChildren(root, [
        { node: toggle, on: !!item.hasChildren },
        { node: placeholder, on: !item.hasChildren },
        { node: jump, on: true },
      ])
      slots.push({ node: root, on: true })
    })
    // 折叠掉的 pos 从缓存里删掉，别让它跟着文档一直长。
    Array.from(itemNodes.keys()).forEach((pos) => {
      if (!alive.has(pos)) itemNodes.delete(pos)
    })
    syncChildren(el, slots)
  }

  function update(patch) {
    Object.assign(state, patch || {})
    mountNode(host, el, !!state.open)
    if (!state.open) return
    render()
  }

  return {
    el,
    update,
    destroy() { if (el.parentNode) el.parentNode.removeChild(el) },
  }
}

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
  onMouseDownPrevent(backButton, () => call('onClose'))

  const restoreButton = document.createElement('button')
  restoreButton.type = 'button'
  restoreButton.className = 'lark-doc-version-restore'
  restoreButton.textContent = '还原此历史记录'
  onMouseDownPrevent(restoreButton, () => call('onRestore'))

  const pager = document.createElement('div')
  pager.className = 'lark-doc-version-pager'
  const cursorLabel = document.createElement('span')
  cursorLabel.className = 'lark-doc-version-cursor'
  const prevButton = document.createElement('button')
  prevButton.type = 'button'
  prevButton.className = 'lark-doc-version-step'
  prevButton.textContent = '上一项'
  onMouseDownPrevent(prevButton, () => call('onPrev'))
  const nextButton = document.createElement('button')
  nextButton.type = 'button'
  nextButton.className = 'lark-doc-version-step'
  nextButton.textContent = '下一项'
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

  previewBox.appendChild(previewHead)
  previewBox.appendChild(previewMeta)
  previewBox.appendChild(degradedNode)
  previewBox.appendChild(diffBox)
  previewBox.appendChild(bodyBox)

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

  syncChildren(el, [{ node: left, on: true }, { node: right, on: true }])

  /** 时间线的重建闸门：签名没变就一个节点都不动。 */
  let daysSignature = null

  function buildDay(day) {
    const box = document.createElement('div')
    box.className = 'lark-doc-version-day'
    const label = document.createElement('div')
    label.className = 'lark-doc-version-day-label'
    label.textContent = day.label == null ? '' : String(day.label)
    box.appendChild(label)
    ;(day.items || []).forEach((item) => {
      const row = document.createElement('div')
      row.className = item.cls ? `lark-doc-version-item ${item.cls}` : 'lark-doc-version-item'
      onMouseDownPrevent(row, () => call('onSelect', item.id))
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
      box.appendChild(row)
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
    const preview = state.preview || {}
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
    ])
    if (preview.diff) setText(diffRow, preview.diff.row)
    // `payload` 非空 = 该版本正文是可解码的二进制快照（模板里的 `v-if`）；空则走兜底文案。
    const payload = preview.payload || ''
    if (payload) setText(binaryPayload, payload)
    syncChildren(bodyBox, [
      { node: binaryPayload, on: !!payload },
      { node: binaryMissing, on: !payload },
    ])
  }

  function render() {
    setText(cursorLabel, state.pager.cursor)
    restoreButton.disabled = !!state.restore.disabled
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
    if (state.view === 'preview') renderPreview()
    renderTimeline()
  }

  function update(patch) {
    Object.assign(state, patch || {})
    mountNode(host, el, !!state.open)
    if (!state.open) return
    render()
  }

  return {
    el,
    update,
    destroy() { if (el.parentNode) el.parentNode.removeChild(el) },
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
  const label = document.createElement('label')
  label.className = 'lark-doc-save-version-label'
  label.setAttribute('for', 'lark-doc-save-version-input')
  label.textContent = '版本名称'
  const inputRow = document.createElement('div')
  inputRow.className = 'lark-doc-save-version-input-row'
  const input = document.createElement('input')
  input.id = 'lark-doc-save-version-input'
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
  onMouseDownPrevent(confirmButton, () => call('onConfirm'))
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
  const call = handlerCaller(options.handlers || {})

  const state = {
    open: false,
    title: '评论',
    controls: [],
    replyControls: [],
    moreTitle: '',
    moreHint: '',
    items: [],
  }

  const el = document.createElement('div')
  el.className = 'lark-doc-comment-layer'

  /** @type {Map<string, ReturnType<typeof createPanelNode>>} */
  const panelNodes = new Map()

  function createPanelNode(id) {
    const root = document.createElement('div')
    root.className = 'lark-doc-comment-panel'
    root.setAttribute('role', 'dialog')
    // 根节点**没有** `.prevent`：它要抢焦点去点亮线程。
    root.addEventListener('mousedown', () => call('onActivate', id))

    const head = document.createElement('div')
    head.className = 'lark-doc-comment-head'
    const quote = document.createElement('span')
    quote.className = 'lark-doc-comment-quote'
    const controls = document.createElement('div')
    controls.className = 'lark-doc-comment-controls'
    head.appendChild(quote)
    head.appendChild(controls)

    const replies = document.createElement('div')
    replies.className = 'lark-doc-comment-replies'

    const textareaWrap = document.createElement('div')
    textareaWrap.className = 'lark-doc-comment-textarea'
    const inputRow = document.createElement('div')
    inputRow.className = 'lark-doc-comment-input'
    const textarea = document.createElement('textarea')
    textarea.className = 'lark-doc-comment-input-zone'
    textarea.setAttribute('aria-label', '回复')
    textarea.addEventListener('input', (event) => call('onDraft', id, event.target.value))
    const operation = document.createElement('button')
    operation.type = 'button'
    operation.className = 'lark-doc-comment-operation'
    operation.setAttribute('aria-label', '插入图片')
    operation.appendChild(iconNode('rev-image', 16))
    onMouseDownPrevent(operation, () => {})
    inputRow.appendChild(textarea)
    inputRow.appendChild(operation)

    const actions = document.createElement('div')
    actions.className = 'lark-doc-comment-actions'
    const cancelAction = document.createElement('button')
    cancelAction.type = 'button'
    cancelAction.className = 'lark-doc-comment-action is-outlined'
    cancelAction.textContent = '取消'
    onMouseDownPrevent(cancelAction, () => call('onClearDraft', id))
    const sendAction = document.createElement('button')
    sendAction.type = 'button'
    sendAction.className = 'lark-doc-comment-action is-filled'
    sendAction.textContent = '发送'
    onMouseDownPrevent(sendAction, () => call('onSubmit', id))
    actions.appendChild(cancelAction)
    actions.appendChild(sendAction)

    textareaWrap.appendChild(inputRow)
    textareaWrap.appendChild(actions)

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
    onMouseDownPrevent(switchButton, () => call('onTogglePrivate', id))
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
      controlCells: [],
      controlSignature: null,
      replies,
      repliesSignature: null,
      textareaWrap,
      inputRow,
      textarea,
      actions,
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
        onMouseDownPrevent(button, () => call('onControl', control.id, entry.threadId))
        cell.appendChild(button)
      }
      entry.controls.appendChild(cell)
      entry.controlCells.push({ cell, control })
    })
  }

  function buildReplies(entry, item) {
    const nodes = []
    ;(item.replies || []).forEach((reply) => {
      const root = document.createElement('div')
      root.className = 'lark-doc-comment-reply'

      const main = document.createElement('div')
      main.className = 'lark-doc-comment-reply-main'
      const avatar = document.createElement('span')
      avatar.className = 'lark-doc-comment-avatar'
      avatar.setAttribute('aria-hidden', 'true')
      avatar.appendChild(iconNode('rev-avatar', 18))
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
      body.textContent = reply.body == null ? '' : String(reply.body)
      right.appendChild(info)
      right.appendChild(body)
      main.appendChild(avatar)
      main.appendChild(right)

      const replyControls = document.createElement('div')
      replyControls.className = 'lark-doc-comment-reply-controls'
      state.replyControls.forEach((control) => {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'lark-doc-comment-icon-btn'
        button.setAttribute('aria-label', control.label)
        if (control.icon) button.appendChild(iconNode(control.icon, control.iconSize))
        else {
          const dots = document.createElement('span')
          dots.className = 'lark-doc-comment-dots'
          dots.setAttribute('aria-hidden', 'true')
          button.appendChild(dots)
        }
        onMouseDownPrevent(button, () => call('onReplyControl', control.id, item.id, reply.id))
        replyControls.appendChild(button)
      })

      const menuBox = document.createElement('div')
      menuBox.className = 'lark-doc-comment-reply-menu'
      const menuList = document.createElement('ul')
      menuList.className = 'lark-doc-comment-menu-list'
      ;(reply.menus || []).forEach((menu) => {
        if (!menu.visible) return
        const li = document.createElement('li')
        li.className = 'lark-doc-comment-menu-item'
        onMouseDownPrevent(li, () => call('onMenuItem', menu.id, item.id, reply.id))
        const menuLabel = document.createElement('span')
        menuLabel.className = 'lark-doc-comment-menu-label'
        menuLabel.textContent = menu.label == null ? '' : String(menu.label)
        li.appendChild(menuLabel)
        if (menu.submenu) li.appendChild(iconNode('chevronDown', 12, 'lark-doc-comment-menu-arrow'))
        menuList.appendChild(li)
      })
      menuBox.appendChild(menuList)

      root.appendChild(main)
      root.appendChild(replyControls)
      root.appendChild(menuBox)
      syncChildren(root, [
        { node: main, on: true },
        { node: replyControls, on: true },
        { node: menuBox, on: !!reply.menuOpen },
      ])
      nodes.push(root)
    })
    return nodes
  }

  function renderPanel(entry, item) {
    entry.threadId = item.id
    setAttr(entry.root, 'aria-label', state.title)
    // SFC 是数组形式（合并语义）；接线层已经把 `{left, top}` 与 `{height}` 合成一份。
    applyStyle(entry.root, item.style)
    setText(entry.quote, item.quote)

    ensureControls(entry)
    const disabled = new Set(item.disabled || [])
    entry.controlCells.forEach(({ cell, control }) => {
      if (control.split) return
      const button = cell.children[0]
      if (!button) return
      button.classList.toggle('is-primary', control.tone === 'primary')
      button.classList.toggle('is-disabled', disabled.has(control.id))
    })

    const repliesSignature = JSON.stringify(item.replies || [])
    if (repliesSignature !== entry.repliesSignature) {
      entry.repliesSignature = repliesSignature
      syncChildren(entry.replies, buildReplies(entry, item).map((node) => ({ node, on: true })))
    }

    const textareaState = item.textarea || {}
    applyStyle(entry.textareaWrap, { height: `${textareaState.height}px` })
    setInputValue(entry.textarea, textareaState.value)
    entry.textarea.readOnly = !!textareaState.readonly
    entry.sendAction.classList.toggle('is-disabled', !item.allowedReply)
    syncChildren(entry.textareaWrap, [
      { node: entry.inputRow, on: true },
      { node: entry.actions, on: !!item.hasDraft },
    ])

    setText(entry.moreTitle, state.moreTitle)
    setText(entry.moreHint, state.moreHint)
    entry.switchButton.classList.toggle('is-on', !!item.privateOn)
    setAttr(entry.switchButton, 'aria-checked', item.privateOn ? 'true' : 'false')

    syncChildren(entry.root, [
      { node: entry.head, on: true },
      { node: entry.replies, on: true },
      { node: entry.textareaWrap, on: true },
      { node: entry.moreMenu, on: !!item.moreOpen },
    ])
  }

  function render() {
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
      slots.push({ node: entry.root, on: true })
    })
    Array.from(panelNodes.keys()).forEach((id) => {
      if (!alive.has(id)) panelNodes.delete(id)
    })
    syncChildren(el, slots)
  }

  function update(patch) {
    Object.assign(state, patch || {})
    mountNode(host, el, !!state.open)
    if (!state.open) return
    render()
  }

  return {
    el,
    update,
    destroy() { if (el.parentNode) el.parentNode.removeChild(el) },
  }
}
