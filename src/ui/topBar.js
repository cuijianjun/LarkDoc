/**
 * 顶部标题栏 —— 原生 DOM 版（`src/ui/` 积木 · 阶段 5 批次 2）。
 *
 * 与 `editor/TopBar.vue` 是同一个界面的两套渲染（并存期结束后 SFC 删除）。
 * 逐字段复刻三段结构：
 *
 *   ① `div.lark-doc-brand[aria-label="文档"]` —— 文本 `'✦ '` + `<span>文档</span>`
 *   ② `div.lark-doc-title-wrap` —— `input[aria-label="文档标题"]` + `span.lark-doc-title-sub`
 *   ③ `div.lark-doc-header-actions` —— 共享下拉 `span.lark-doc-select.lark-doc-mode-select` + 插槽宿主
 *
 * 三条规矩同 `toolbar.js`。这里额外两条：
 *
 * - **整行是 `v-if`**：`layout.headerVisible === false` 时 `<header>` 必须真的不在
 *   DOM 里（断言量顶栏隐藏时的安全线是 51 而非 64，多留一个空 header 就会改变
 *   `bubbleSafeTop()` 之外的每一处布局）。
 * - **模式切换走共享下拉原语**（`ui/select.js`，与工具栏「字号」同一套交互与 UI）：
 *   hover 即开 / 移开 150ms 关 / 键盘 ↑↓ Enter Esc / 外部点击关 / 下方放不下翻转，
 *   弹层 `position: fixed`（`.lark-doc-header-actions` 是 `overflow-x: auto`，absolute
 *   会被裁掉）。所以本模块**不再自己管开合与坐标**，只把选项表推给 select；
 *   容器宽度靠 `menuMinWidth`（340）撑，贴右边界时由 select 自己夹取。
 *   旧的手搓按钮 / 菜单（`toggleModeMenu(anchor)` + `modeMenuPos`）已删除 ——
 *   别把「自己算 fixed 坐标」那套再加回来，那正是两套下拉观感不一致的根源。
 *
 * `header-actions` 是 Vue 插槽，原生层接不住：调用方把 Vue 持有的宿主节点
 * （`actionsHost`）传进来，本模块把它 append 在 mode-switch **之后**（两者并存，
 * 历史上有一次「用 slot 替换掉 mode-switch」的改法让宿主控件全消失）。
 */

import { createSelect } from './select'
import { lockPageScroll, mountNode, setAttr, setText } from './dom'
import { iconNode } from './icon'
import { createScrollNavigator } from './scrollNavigator'
import { createTopBarMenus } from './topBarMenus'
import { createDesktopHeaderDetails } from './desktopHeaderDetails'
import { TOPBAR_MORE_CAPABILITY } from '../components/lark-doc/editor/topbarMoreMixin'
import { MODE_ICONS, MODE_MENU_MIN_WIDTH } from '../components/lark-doc/editor/docModes'
import { createMobileLibrary } from './mobileLibrary'

/** 缺省副标题（`effectiveReadonly` 为假时的文案）。 */
const SUB_EDITABLE = '单人编辑'
const SUB_READONLY = '阅读中'

const DEFAULT_TITLE_PLACEHOLDER = '未命名文档'
const activeMoreMenus = new WeakMap()

/**
 * @param {object} options
 * @param {HTMLElement} options.host 插入到哪个元素里（`.lark-doc` 的 `<section>`）
 * @param {HTMLElement} [options.anchor] 插在它前面；不给则 append 到末尾
 * @param {object} [options.handlers] 回调表
 * @param {((id: string) => void)|null} [options.handlers.updateTitle] 入参是输入框的 `value`
 * @param {((id: string) => void)|null} [options.handlers.setMode] 下拉里选中某个模式
 * @param {HTMLElement|null} [options.actionsHost] Vue 持有的 `header-actions` 宿主节点
 * @param {HTMLElement|null} [options.paperHost] Native mobile document-title host
 * @returns {{ el: HTMLElement, update(state: object): void, destroy(): void }}
 */
export function createTopBar(options = {}) {
  const handlers = options.handlers || {}
  const host = options.host || null
  const scrollNavigator = host ? createScrollNavigator({ host: options.overlayHost || host }) : null
  // 插入位置：`anchor` 为真时插在它**前面**（模板里的空 div 只是挂载点），
  // 不套一层包裹 div —— 包裹会把 sticky 的包含块压成顶栏自身高度，滚动时就不再吸附。
  const anchor = options.anchor || null
  const actionsHost = options.actionsHost || null
  const paperTitle = document.createElement('h1')
  paperTitle.className = 'lark-doc-mobile-document-title'
  const paperHeader = document.createElement('section'), paperHeading = document.createElement('div'), paperMeta = document.createElement('div')
  const paperMetaRow = document.createElement('div')
  paperHeader.className = 'lark-doc-mobile-document-header'; paperHeading.className = 'lark-doc-mobile-document-heading'; paperMeta.className = 'lark-doc-mobile-document-meta'
  paperMetaRow.className = 'lark-doc-paper-meta-row'
  paperMetaRow.appendChild(paperMeta)
  const documentOutline = document.createElement('button')
  const outlinePin = document.createElement('div'); outlinePin.className = 'lark-doc-document-outline-pin'
  documentOutline.type = 'button'; documentOutline.className = 'lark-doc-document-outline-trigger'
  documentOutline.setAttribute('aria-label', '文内目录'); documentOutline.setAttribute('aria-haspopup', 'dialog')
  documentOutline.appendChild(iconNode('outline', 18))
  documentOutline.addEventListener('click', () => {
    if (disposed || documentOutline.disabled || !documentOutline.isConnected) return
    const reopen = (outlineSource === 'float' || outlineDismissed) && latestState.outlineOpen
    releaseFloatOutline(); floatOutlineScope = null; outlineSource = 'paper'; outlineDismissed = false
    if (reopen) syncDocumentOutline(); else call('toggleOutline')
  })
  const outlinePopup = document.createElement('nav')
  outlinePopup.className = 'lark-doc-document-outline-popover'; outlinePopup.setAttribute('aria-label', '文内目录标题列表'); outlinePopup.setAttribute('role', 'dialog')
  let outlineSignature = '', outlineSource = 'paper', outlineDismissed = false, floatOutlineScope = null, floatOutlineActive = null, floatOutlineSignature = '', unlockFloatOutline = null
  const floatOutlineLayer = document.createElement('div'); floatOutlineLayer.className = 'lark-doc-float-outline-layer'
  const floatOutlineMask = document.createElement('button'); floatOutlineMask.type = 'button'; floatOutlineMask.className = 'lark-doc-float-outline-mask'; floatOutlineMask.setAttribute('aria-label', '关闭目录遮罩')
  const floatOutlineSheet = document.createElement('section'); floatOutlineSheet.className = 'lark-doc-float-outline-sheet'
  floatOutlineSheet.setAttribute('role', 'dialog'); floatOutlineSheet.setAttribute('aria-modal', 'true'); floatOutlineSheet.setAttribute('aria-label', '目录')
  const floatOutlineHead = document.createElement('header'), floatOutlineTitle = document.createElement('h2'), floatOutlineClose = document.createElement('button')
  floatOutlineTitle.textContent = '目录'; floatOutlineClose.type = 'button'; floatOutlineClose.textContent = '×'; floatOutlineClose.setAttribute('aria-label', '关闭目录')
  floatOutlineHead.append(floatOutlineClose, floatOutlineTitle)
  const floatOutlineList = document.createElement('nav'); floatOutlineList.className = 'lark-doc-float-outline-list'; floatOutlineList.setAttribute('aria-label', '目录标题列表')
  floatOutlineSheet.append(floatOutlineHead, floatOutlineList); floatOutlineLayer.append(floatOutlineMask, floatOutlineSheet)
  floatOutlineMask.addEventListener('click', event => { if (!floatOutlineLayer.isConnected) return; event.preventDefault(); event.stopPropagation(); dismissFloatOutline(true) })
  floatOutlineClose.addEventListener('click', () => { if (floatOutlineLayer.isConnected && floatOutlineCurrent()) dismissFloatOutline(true) })
  outlinePin.appendChild(documentOutline); paperHeading.append(outlinePin, paperTitle); paperHeader.append(paperHeading, paperMetaRow)
  // 顶栏分享按钮文字：手机与参考壳恒「分享」；桌面按权限态取「分享」或「分享只读链接」
  // （需求 05 §128：无管理权限时降级为只复制链接，而不是置灰）。
  const membersText = () => (window.innerWidth <= 760 || latestState.referenceMobileMenu === true)
    ? '分享' : (latestState.membersText || latestState.membersLabel || '分享只读链接')
  const syncMobileTitle = () => {
    const mobile = window.innerWidth <= 760
    if (mobile) {
      if (outlineButton.parentNode !== breadcrumb) breadcrumb.prepend(outlineButton, breadcrumbArrow)
      if (titleInput.parentNode !== breadcrumb) breadcrumb.appendChild(titleInput)
      if (breadcrumb.parentNode !== titleWrap) titleWrap.prepend(breadcrumb)
      if (modifiedLine.parentNode !== titleWrap) titleWrap.appendChild(modifiedLine)
    } else {
      if (outlineButton.parentNode !== el) el.insertBefore(outlineButton, brand)
      if (titleInput.parentNode !== titleWrap) titleWrap.prepend(titleInput)
      breadcrumb.remove(); modifiedLine.remove()
    }
    const shareLabel = membersText()
    setText(membersLabel, shareLabel)
    mountNode(membersButton, membersIcon, !mobile && latestState.compactHeader)
    if (membersIcon.parentNode === membersButton && membersButton.firstChild !== membersIcon) membersButton.prepend(membersIcon)
    if (options.paperHost && (mobile || latestState.compactHeader)) {
      const body = options.paperHost.querySelector('.lark-doc-editor-content')
      if (paperHeader.parentNode !== options.paperHost || paperHeader.nextSibling !== body) options.paperHost.insertBefore(paperHeader, body)
      options.paperHost.classList.toggle('has-mobile-title', mobile)
    } else { paperHeader.remove(); options.paperHost?.classList.remove('has-mobile-title') }
    syncDocumentOutline()
  }
  const call = (name, ...args) => {
    if (disposed) return
    if (name === 'toggleTopbarMore') {
      moreDismissed = false
      allowMoreFocus = true
      moreTrigger = args[0]?.currentTarget || moreTrigger
    }
    const fn = handlers[name]
    return typeof fn === 'function' ? fn(...args) : undefined
  }

  // ——————————————————— 根节点（v-if） ———————————————————
  const el = document.createElement('header')
  el.className = 'lark-doc-topbar'

  // ——————————————————— ① 品牌 ———————————————————
  const brand = document.createElement('div')
  brand.className = 'lark-doc-brand'
  brand.setAttribute('aria-label', '文档')
  // 模板里是 `✦ <span>文档</span>`：星号是裸文本节点，不能塞进 span。
  brand.appendChild(document.createTextNode('✦ '))
  const brandText = document.createElement('span')
  brandText.textContent = '文档'
  brand.appendChild(brandText)

  // ——————————————————— ② 标题 ———————————————————
  const titleWrap = document.createElement('div')
  titleWrap.className = 'lark-doc-title-wrap'
  const titleInput = document.createElement('input')
  titleInput.setAttribute('aria-label', '文档标题')
  titleInput.setAttribute('placeholder', DEFAULT_TITLE_PLACEHOLDER)
  // 模板里 input 与 span 之间**没有空白**（`></span` 紧贴），这里同样不留。
  titleInput.addEventListener('input', (event) => call('updateTitle', event.target.value))
  const titleSub = document.createElement('span')
  titleSub.className = 'lark-doc-title-sub'
  titleSub.textContent = SUB_EDITABLE
  titleWrap.appendChild(titleInput)
  titleWrap.appendChild(titleSub)

  // ——————————————————— ③ 右侧动作区 ———————————————————
  const headerActions = document.createElement('div')
  headerActions.className = 'lark-doc-header-actions'

  // 模式切换 = 共享下拉原语（与工具栏「字号」同一套交互 / 同一套弹层 UI）。
  // 只传口径：`className` 给宿主换皮、`menuMinWidth` 让三项标题+副标题一行放得下、
  // `icon` 由 update 推（编辑/修订/阅读三枚图标不同）。开合 / 定位 / Esc 全在 select 里。
  const modeSelect = createSelect({
    ariaLabel: '文档模式',
    className: 'lark-doc-mode-select',
    menuMinWidth: MODE_MENU_MIN_WIDTH,
    onChange: (id) => call('setMode', id),
  })
  // 触发按钮本体：`update()` 只负责往里推选项，`aria-haspopup` 这类语义按「能否切换」摘挂，
  // 所以在这里留一个引用（select 的第一个子节点恒为 trigger）。
  const modeTrigger = modeSelect.el.firstElementChild

  function actionButton(className, label, icon, popup, handler, size = 16) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = className
    button.setAttribute('aria-label', label)
    if (popup) button.setAttribute('aria-haspopup', popup)
    button.appendChild(iconNode(icon, size))
    if (handler) button.addEventListener('click', event => call(handler, event))
    return button
  }
  const createButton = actionButton('lark-doc-create-btn', '新建', 'plus', 'menu', 'toggleCreateMenu')
  const searchButton = actionButton('lark-doc-topbar-search', '查找', 'search', 'dialog', 'openSearch', 18)
  // 铃铛 18px：飞书顶栏这枚图标的字形实测 12×13.5 CSS，比同排的 16px 图标大一号。
  const notifyButton = actionButton('lark-doc-notify-btn', '当前文档通知', 'bell', 'dialog', 'toggleNotify', 18)
  const notifyDot = document.createElement('span')
  notifyDot.className = 'lark-doc-notify-dot'
  const moreButton = actionButton('lark-doc-more-btn', '更多', 'more', 'menu', 'toggleTopbarMore')
  // 模式切换是标题栏动作区的第一项；宿主动作紧随其后，创建/通知/更多再按
  // 飞书文档的常用操作顺序排列。这样宿主按钮不会被新增原生入口挤到模式之后。
  headerActions.append(modeSelect.el, createButton, notifyButton, moreButton)

  // Mobile keeps a single header row. Reuse the actual action nodes in an
  // overflow popover, so modes, host actions and notification state stay live.
  let mobileOpen = false, mobileRelease = null, disposed = false
  const homeButton = actionButton('lark-doc-mobile-home', '我的文档库', 'mobile-home', null, 'openHome', 16)
  let latestState = {}, moreTrigger = null, moreDismissed = false, allowMoreFocus = true
  const outlineButton = actionButton('lark-doc-mobile-outline', '文档库', 'more', 'dialog', null, 20)
  outlineButton.addEventListener('click', () => { if (!outlineButton.disabled) { if (latestState.referenceMobileMenu) library.open(); else call('toggleOutline') } })
  const headingButton = actionButton('lark-doc-mobile-heading-action', '文档大纲', 'outline', 'dialog', 'toggleOutline')
  const phoneOutline = () => window.innerWidth <= 760 && window.matchMedia?.('(max-width: 760px) and (pointer: coarse)').matches === true
  function floatOutlineCurrent() {
    const scope = floatOutlineScope
    return !disposed && !!scope && phoneOutline() && latestState.headerVisible !== false && latestState.outlineVisible !== false && !latestState.outlinePending
      && scope.context === latestState.mobileContextKey && scope.content === latestState.documentContent
      && scope.authority === latestState.mobileAuthority && scope.handler === latestState.mobileHostHandler
  }
  function releaseFloatOutline() {
    floatOutlineLayer.remove(); floatOutlineSignature = ''
    unlockFloatOutline?.(); unlockFloatOutline = null
  }
  function dismissFloatOutline(notify = true, focus = true) {
    const current = floatOutlineCurrent()
    releaseFloatOutline(); floatOutlineScope = null; outlineSource = 'paper'; outlineDismissed = true
    if (notify && current && latestState.outlineOpen) call('toggleOutline')
    if (focus && current) scrollNavigator?.focus()
  }
  function openFloatOutline(pos) {
    if (disposed || !phoneOutline() || latestState.outlineVisible === false || latestState.headerVisible === false || latestState.outlinePending) return
    outlineSource = 'float'; outlineDismissed = false; floatOutlineActive = pos
    floatOutlineScope = { context: latestState.mobileContextKey, content: latestState.documentContent, authority: latestState.mobileAuthority, handler: latestState.mobileHostHandler }
    if (!latestState.outlineOpen) call('toggleOutline'); else syncDocumentOutline()
  }
  function syncFloatOutline() {
    const items = latestState.outlineItems || [], scope = floatOutlineScope
    const active = items.some(item => item.pos === floatOutlineActive) ? floatOutlineActive : latestState.activeHeading
    const signature = JSON.stringify([scope.context, active, items.map(item => [item.pos, item.level, item.text])])
    if (signature !== floatOutlineSignature) {
      floatOutlineSignature = signature; floatOutlineList.replaceChildren()
      for (const item of items) {
        const row = document.createElement('button'); row.type = 'button'; row.textContent = item.text || '无标题'; row.dataset.headingPos = String(item.pos)
        row.style.paddingLeft = `${20 + Math.max(0, item.level - 1) * 14}px`
        row.classList.toggle('is-active', item.pos === active); setAttr(row, 'aria-current', item.pos === active ? 'location' : null)
        row.addEventListener('click', () => {
          if (!row.isConnected || scope !== floatOutlineScope || !floatOutlineCurrent()) return
          const navigate = latestState.onOutlineHeading
          dismissFloatOutline(true); navigate?.(item.pos)
        })
        floatOutlineList.appendChild(row)
      }
      if (!items.length) { const empty = document.createElement('p'); empty.textContent = '暂无标题'; floatOutlineList.appendChild(empty) }
    }
    const opening = !floatOutlineLayer.isConnected
    const overlay = options.overlayHost || host
    if (overlay && floatOutlineLayer.parentNode !== overlay) overlay.appendChild(floatOutlineLayer)
    if (!unlockFloatOutline) {
      const targets = [floatOutlineLayer.ownerDocument.body, latestState.documentContent?.closest('.lark-doc-main')].filter(Boolean)
      const release = [...new Set(targets)].map(lockPageScroll)
      unlockFloatOutline = () => release.reverse().forEach(unlock => unlock())
    }
    if (opening) floatOutlineClose.focus({ preventScroll: true })
  }
  function syncDocumentOutline() {
    if (outlineSource === 'float' && latestState.outlineOpen && floatOutlineCurrent()) {
      setAttr(documentOutline, 'aria-expanded', 'false')
      if (outlinePin.parentNode !== paperHeading) paperHeading.prepend(outlinePin)
      outlinePopup.remove(); outlineSignature = ''; syncFloatOutline(); return
    }
    releaseFloatOutline()
    if (!latestState.outlineOpen) { outlineSource = 'paper'; floatOutlineScope = null; outlineDismissed = false }
    const open = !disposed && window.innerWidth <= 760 && !outlineDismissed && paperHeader.isConnected && latestState.outlineOpen && latestState.outlineVisible !== false
    documentOutline.disabled = latestState.outlineVisible === false
    setAttr(documentOutline, 'aria-expanded', String(!!open))
    if (!open) { if (outlinePin.parentNode !== paperHeading) paperHeading.prepend(outlinePin); outlinePopup.remove(); outlineSignature = ''; return }
    const items = latestState.outlineItems || []
    const signature = `${latestState.mobileContextKey}|${latestState.title}|${latestState.outlinePending}|${latestState.activeHeading}|${items.map(item => `${item.pos}:${item.level}:${item.text}`).join('|')}`
    if (signature !== outlineSignature) {
      outlineSignature = signature; outlinePopup.replaceChildren(outlinePin)
      const context = latestState.mobileContextKey
      const choose = (button, pos) => {
        if (disposed || !outlinePopup.isConnected || !button.isConnected || context !== latestState.mobileContextKey || latestState.outlinePending) return
        const action = pos === null ? latestState.onOutlineStart : latestState.onOutlineHeading
        call('toggleOutline'); action?.(pos)
      }
      const root = document.createElement('button')
      root.type = 'button'; root.className = 'lark-doc-document-outline-root'; root.textContent = latestState.title || DEFAULT_TITLE_PLACEHOLDER
      root.disabled = !!latestState.outlinePending
      root.addEventListener('click', () => choose(root, null)); outlinePopup.appendChild(root)
      for (const item of items) {
        const row = document.createElement('button')
        row.type = 'button'; row.textContent = item.text || '无标题'; row.dataset.headingPos = String(item.pos)
        row.style.paddingLeft = `${Math.max(0, item.level - 1) * 14 + 12}px`
        row.classList.toggle('is-active', item.pos === latestState.activeHeading)
        row.disabled = !!latestState.outlinePending
        row.addEventListener('click', () => choose(row, item.pos)); outlinePopup.appendChild(row)
      }
    }
    if (outlinePopup.parentNode !== paperHeader) paperHeader.appendChild(outlinePopup)
  }
  const avatarButton = actionButton('lark-doc-mobile-avatar', '未登录', '', null, 'openProfile')
  const avatarBadge = document.createElement('span')
  avatarBadge.className = 'lark-doc-mobile-avatar-badge'
  avatarButton.replaceChildren(avatarBadge)
  const membersButton = actionButton('lark-doc-mobile-members', '管理成员', 'share-globe', 'dialog', 'openMembers', 16)
  const membersIcon = membersButton.firstChild, membersLabel = document.createElement('span')
  const membersTip = document.createElement('span')
  membersTip.className = 'lark-doc-header-tip'
  membersTip.setAttribute('aria-hidden', 'true')
  membersButton.append(membersLabel, membersTip)
  const desktopDetails = createDesktopHeaderDetails({ el, paperMetaRow, paperMeta, membersButton })
  const breadcrumb = document.createElement('div'), modifiedLine = document.createElement('span'), headerDivider = document.createElement('span')
  breadcrumb.className = 'lark-doc-mobile-breadcrumb'; modifiedLine.className = 'lark-doc-mobile-modified'; headerDivider.className = 'lark-doc-mobile-header-divider'
  const breadcrumbArrow = iconNode('chevron-right', 14, 'lark-doc-mobile-breadcrumb-arrow')
  headerDivider.setAttribute('aria-hidden', 'true')
  const mobileButton = document.createElement('button')
  mobileButton.type = 'button'
  mobileButton.className = 'lark-doc-mobile-actions-toggle'
  mobileButton.setAttribute('aria-label', '更多文档操作')
  mobileButton.setAttribute('aria-haspopup', 'menu')
  mobileButton.appendChild(iconNode('more', 26))
  const mobileBackdrop = document.createElement('div')
  mobileBackdrop.className = 'lark-doc-mobile-actions-backdrop'
  mobileBackdrop.setAttribute('aria-hidden', 'true')
  const mobileCancel = document.createElement('button')
  mobileCancel.type = 'button'
  mobileCancel.className = 'lark-doc-mobile-actions-cancel'
  mobileCancel.setAttribute('aria-label', '取消文档操作')
  mobileCancel.textContent = '取消'
  const focusableActions = () => [...headerActions.querySelectorAll('button, input, select, [tabindex="0"]')].filter(node => !node.disabled && node.getAttribute('aria-disabled') !== 'true' && !node.closest('[hidden]') && getComputedStyle(node).display !== 'none' && getComputedStyle(node).visibility !== 'hidden')
  function setMobileOpen(open, restoreFocus = false) {
    if (disposed && open) return
    if (!open && mobileOpen) {
      modeSelect.close()
      actionsHost?.dispatchEvent(new Event('lark-doc-actions-dismiss'))
    }
    mobileOpen = open
    const modal = open && window.innerWidth <= 760
    el.classList.toggle('is-mobile-actions-open', open)
    mobileButton.setAttribute('aria-expanded', String(open))
    headerActions.setAttribute('aria-label', '文档操作')
    headerActions.setAttribute('role', modal ? 'dialog' : 'group')
    setAttr(headerActions, 'aria-modal', modal ? 'true' : null)
    mountNode(el, mobileBackdrop, modal)
    mountNode(headerActions, mobileCancel, modal)
    if (modal && !mobileRelease) {
      const nodes = [el.ownerDocument.body, el.closest('.lark-doc')?.querySelector('.lark-doc-main')].filter(Boolean)
      const release = [...new Set(nodes)].map(lockPageScroll)
      mobileRelease = () => release.reverse().forEach(unlock => unlock())
    } else if (!modal && mobileRelease) { mobileRelease(); mobileRelease = null }
    if (modal) focusableActions()[0]?.focus()
    if (restoreFocus) mobileButton.focus()
  }
  const cancelMobile = () => setMobileOpen(false, true)
  const closeBackdrop = event => { event.preventDefault(); event.stopPropagation(); cancelMobile() }
  mobileCancel.addEventListener('click', cancelMobile)
  mobileBackdrop.addEventListener('click', closeBackdrop)
  setMobileOpen(false)
  const referenceLayer = document.createElement('section'), referenceMask = document.createElement('div'), referenceSheet = document.createElement('div'), referenceItems = document.createElement('div'), referenceStatus = document.createElement('p')
  referenceLayer.className = 'lark-doc-mobile-reference-menu'; referenceLayer.setAttribute('role', 'dialog'); referenceLayer.setAttribute('aria-modal', 'true'); referenceLayer.setAttribute('aria-label', '更多文档操作')
  referenceMask.className = 'lark-doc-mobile-reference-mask'; referenceSheet.className = 'lark-doc-mobile-reference-sheet'; referenceItems.className = 'lark-doc-mobile-reference-items'; referenceStatus.setAttribute('role', 'status')
  const referenceCancel = document.createElement('button'); referenceCancel.type = 'button'; referenceCancel.textContent = '取消'; referenceCancel.setAttribute('aria-label', '取消更多操作')
  let referenceRelease, referenceGeneration = 0, referenceBusy = null
  function setReferenceOpen(open, restore = false) {
    referenceGeneration++
    referenceBusy = null; referenceItems.querySelectorAll('button').forEach(button => { button.disabled = false })
    if (open && !disposed) {
      library.close(false); setMobileOpen(false); setText(referenceStatus, '')
      ;(options.overlayHost || host || el).append(referenceLayer)
      const locks = [...new Set([document.body, host?.querySelector('.lark-doc-main')].filter(Boolean))].map(lockPageScroll)
      referenceRelease?.(); referenceRelease = () => locks.reverse().forEach(fn => fn())
      mobileButton.setAttribute('aria-expanded', 'true'); referenceItems.querySelector('button')?.focus()
    } else { referenceLayer.remove(); referenceRelease?.(); referenceRelease = null; mobileButton.setAttribute('aria-expanded', String(mobileOpen)); if (restore) mobileButton.focus() }
  }
  [['open-in-app', '用飞书打开'], ['report', '举报']].forEach(([id, label]) => {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = label
    button.addEventListener('click', async () => {
      if (disposed || !referenceLayer.isConnected || referenceBusy !== null) return
      const ticket = ++referenceGeneration, owner = latestState.mobileHostHandler, context = latestState.mobileContextKey
      referenceBusy = ticket; setText(referenceStatus, '正在处理…'); referenceStatus.tabIndex = -1; referenceStatus.focus()
      referenceItems.querySelectorAll('button').forEach(item => { item.disabled = true })
      try {
        const result = await call('mobileHostAction', id)
        if (disposed || !referenceLayer.isConnected || ticket !== referenceGeneration || owner !== latestState.mobileHostHandler || context !== latestState.mobileContextKey) return
        if (result === true) setReferenceOpen(false, true)
        else setText(referenceStatus, typeof owner === 'function' ? '操作未完成，请重试。' : id === 'report' ? '宿主尚未接入举报服务。' : '宿主尚未配置飞书打开方式。')
      } catch { if (!disposed && referenceLayer.isConnected && ticket === referenceGeneration) setText(referenceStatus, '操作未完成，请重试。') }
      finally { if (referenceBusy === ticket) { referenceBusy = null; referenceItems.querySelectorAll('button').forEach(item => { item.disabled = false }); if (referenceLayer.isConnected && (document.activeElement === referenceStatus || document.activeElement === document.body)) button.focus() } }
    }); referenceItems.append(button)
  })
  referenceCancel.addEventListener('click', () => setReferenceOpen(false, true)); referenceMask.addEventListener('click', () => setReferenceOpen(false, true))
  referenceSheet.append(referenceItems, referenceStatus, referenceCancel); referenceLayer.append(referenceMask, referenceSheet)
  referenceLayer.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setReferenceOpen(false, true) }
    if (event.key === 'Tab') {
      const buttons = [...referenceLayer.querySelectorAll('button:not(:disabled)')], index = buttons.indexOf(document.activeElement)
      if (event.shiftKey ? index <= 0 : index === buttons.length - 1) { event.preventDefault(); buttons[event.shiftKey ? buttons.length - 1 : 0]?.focus() }
    }
  })
  const library = createMobileLibrary({ host: options.overlayHost || host || el, trigger: outlineButton,
    scope: () => call('libraryScope'), directory: () => call('libraryDirectory'), openDocument: id => call('openLibraryDocument', id),
    onOpen: open => outlineButton.setAttribute('aria-expanded', String(open)), openSdk: () => { setReferenceOpen(false); setMobileOpen(true) } })
  mobileButton.addEventListener('click', event => { if (disposed) return; if (latestState.referenceMobileMenu) { if (typeof handlers.toggleTopbarMore === 'function') call('toggleTopbarMore', event); else setReferenceOpen(!referenceLayer.isConnected) } else setMobileOpen(!mobileOpen) })
  mobileButton.addEventListener('keydown', event => { if (latestState.referenceMobileMenu && event.shiftKey && event.key === 'Enter') { event.preventDefault(); setReferenceOpen(false); setMobileOpen(true) } })
  headerActions.addEventListener('click', event => {
    const button = event.target.closest('button')
    // Host controls can own nested menus inside actionsHost. Keep their parent
    // visible; only the editor's portal actions dismiss this overflow layer.
    const portalAction = [createButton, notifyButton, moreButton, headingButton].includes(button) || button?.classList.contains('lark-doc-comment-entry-button')
    if (mobileOpen && window.innerWidth <= 760 && portalAction) setMobileOpen(false)
  })
  const closeMobileOutside = event => {
    if (mobileOpen && !el.contains(event.target)) setMobileOpen(false)
    if (floatOutlineLayer.isConnected) {
      if (!floatOutlineLayer.contains(event.target)) dismissFloatOutline(true)
    } else if (outlinePopup.isConnected && !outlinePopup.contains(event.target) && !documentOutline.contains(event.target)) call('toggleOutline')
  }
  const closeMobileEscape = event => {
    if (mobileOpen && window.innerWidth <= 760 && event.key === 'Tab' && !event.defaultPrevented) {
      const items = focusableActions(), first = items[0], last = items[items.length - 1]
      if ((event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
        event.preventDefault(); (event.shiftKey ? last : first)?.focus(); return
      }
    }
    if (mobileOpen && event.key === 'Escape' && !event.defaultPrevented) {
      // An open child popup consumes the first Escape. Once closed, capture
      // the next Escape before its trigger's stopPropagation handler.
      if (headerActions.querySelector('[aria-haspopup][aria-expanded="true"]')) return
      event.preventDefault(); event.stopPropagation(); setMobileOpen(false, true)
    }
  }
  document.addEventListener('pointerdown', closeMobileOutside)
  const closeDocumentOutline = event => {
    if (floatOutlineLayer.isConnected) {
      if (event.defaultPrevented || event.isComposing) return
      const dialog = event.target.closest?.('[role="dialog"], [role="alertdialog"]')
      if (dialog && dialog !== floatOutlineSheet) return
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismissFloatOutline(true); return }
      if (event.key === 'Tab') {
        const choices = [...floatOutlineSheet.querySelectorAll('button:not(:disabled)')], index = choices.indexOf(document.activeElement)
        if (index < 0 || (event.shiftKey ? index === 0 : index === choices.length - 1)) {
          event.preventDefault(); choices[event.shiftKey ? choices.length - 1 : 0]?.focus({ preventScroll: true })
        }
      }
      return
    }
    if (event.key === 'Escape' && !event.isComposing && outlinePopup.isConnected) {
      event.preventDefault(); event.stopPropagation(); call('toggleOutline'); documentOutline.focus({ preventScroll: true })
    }
  }
  document.addEventListener('keydown', closeDocumentOutline)
  el.addEventListener('keydown', closeMobileEscape, true)
  let desktopViewport = window.innerWidth > 760
  const resizeMobile = () => {
    if (disposed) return
    const desktop = window.innerWidth > 760
    if (floatOutlineScope && !phoneOutline()) dismissFloatOutline(false, false)
    if (desktop) {
      if (mobileOpen) setMobileOpen(false, true)
      setReferenceOpen(false)
    }
    if (desktop !== desktopViewport) {
      desktopViewport = desktop
      update(latestState)
      return
    }
    syncMobileTitle()
    library.update(latestState)
  }
  window.addEventListener('resize', resizeMobile)

  const menuDocument = el.ownerDocument
  const moreTriggerNode = () => moreTrigger || (window.innerWidth <= 760 ? mobileButton : moreButton)
  const menusVisible = state => state.headerVisible !== false && ((state.createMenuOpen && !state.readonly) || (state.topbarMoreOpen && !moreDismissed))
  const menusUi = createTopBarMenus({ host: options.overlayHost || null, el, refs: options.refs || {},
    mobileButton, moreButton, createButton, call, activeMoreMenus, moreTriggerNode, capabilities: TOPBAR_MORE_CAPABILITY,
    readState: () => latestState, isDisposed: () => disposed, getMobileOpen: () => mobileOpen,
    getMoreDismissed: () => moreDismissed, setMoreDismissed: value => { moreDismissed = value },
    canFocusOnOpen: () => allowMoreFocus,
    onReady: () => { if (!disposed && menusVisible(latestState)) options.onMenusReady?.() },
  })
  const pendingMoreToken = {}
  let pendingMoreOpen = false, pendingCreateOpen = false
  const trackPendingFocus = event => {
    if (!disposed && !menusUi.el && pendingMoreOpen && !moreTriggerNode().contains(event.target)) allowMoreFocus = false
  }
  function dismissPendingMore(restoreFocus = false) {
    if (disposed || !pendingMoreOpen) return
    moreDismissed = true; pendingMoreOpen = false
    if (activeMoreMenus.get(menuDocument) === pendingMoreToken) activeMoreMenus.delete(menuDocument)
    menusUi.update({ ...latestState, moreDismissed: true })
    setAttr(mobileButton, 'aria-expanded', String(mobileOpen)); setAttr(moreButton, 'aria-expanded', 'false')
    call('closeTopbarMore')
    if (restoreFocus && moreTriggerNode().isConnected) moreTriggerNode().focus({ preventScroll: true })
  }
  const closePendingOutside = event => {
    if (disposed || menusUi.el) return
    if (!moreTriggerNode().contains(event.target)) dismissPendingMore()
  }
  const closePendingEscape = event => {
    if (disposed || menusUi.el || event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return
    const owner = el.closest('.lark-doc'), targetOwner = event.target.closest?.('.lark-doc')
    if (targetOwner && targetOwner !== owner) return
    if (event.target.closest?.('[role="dialog"], [role="listbox"]')) return
    if (pendingMoreOpen && activeMoreMenus.get(menuDocument) === pendingMoreToken) {
      event.preventDefault(); event.stopPropagation(); dismissPendingMore(true)
    } else if (pendingCreateOpen && el.contains(event.target)) {
      event.preventDefault(); event.stopPropagation(); pendingCreateOpen = false
      menusUi.update({ ...latestState, createMenuOpen: false, moreDismissed })
      call('closeCreateMenu'); (window.innerWidth <= 760 ? mobileButton : createButton).focus()
    }
  }
  menuDocument.addEventListener('pointerdown', closePendingOutside)
  menuDocument.addEventListener('keydown', closePendingEscape)
  menuDocument.addEventListener('focusin', trackPendingFocus)

  el.append(homeButton, headerDivider, outlineButton)
  el.appendChild(brand)
  el.appendChild(titleWrap)
  el.appendChild(headerActions)
  el.append(avatarButton, membersButton)
  el.appendChild(mobileButton)

  // ——————————————————— 状态推入 ———————————————————
  // `modes.allow` 是否给了不止一项。只有一项时：按钮退化成静态文字（禁用 + 藏 caret）。
  let switchable = true
  let stopMeasuring = null

  function trackToolbarOffset(stacked) {
    if (!stacked) {
      stopMeasuring?.()
      stopMeasuring = null
      return
    }
    if (!host || stopMeasuring) return
    const measure = () => host.style.setProperty('--ld-titlebar-height', `${el.getBoundingClientRect().height}px`)
    const win = el.ownerDocument.defaultView
    const observer = win.ResizeObserver ? new win.ResizeObserver(measure) : null
    measure()
    if (observer) observer.observe(el, { box: 'border-box' })
    else win.addEventListener('resize', measure)
    stopMeasuring = () => {
      observer?.disconnect()
      win.removeEventListener('resize', measure)
      host.style.removeProperty('--ld-titlebar-height')
    }
  }

  /**
   * 唯一写入口。`state` 由 `toolbarUiMixin` 算好，字段与 `TopBar.vue` 里读的
   * `ed.xxx` 一一对应：`headerVisible` / `title` / `titleLength` / `readonly` /
   * `mode` / `modeVisible` / `modeLabel` / `modeIcon` / `modeSwitchable` / `modeOptions`。
   */
  function update(state = {}) {
    if (disposed) return
    if (state.topbarMoreOpen && !latestState.topbarMoreOpen) allowMoreFocus = true
    if (state.topbarMoreOpen === false) moreDismissed = false
    setText(referenceItems.querySelector('button'), state.mobileOpenInAppLabel || '用飞书打开')
    if (referenceLayer.isConnected && (state.headerVisible === false || state.referenceMobileMenu !== latestState.referenceMobileMenu || state.mobileContextKey !== latestState.mobileContextKey || state.mobileHostHandler !== latestState.mobileHostHandler || state.mobileAuthority !== latestState.mobileAuthority)) setReferenceOpen(false)
    if (floatOutlineScope && (state.mobileContextKey !== floatOutlineScope.context || state.documentContent !== floatOutlineScope.content || state.mobileAuthority !== floatOutlineScope.authority || state.mobileHostHandler !== floatOutlineScope.handler || state.headerVisible === false || state.outlineVisible === false || state.outlinePending)) dismissFloatOutline(false, false)
    latestState = state
    scrollNavigator?.update({ content: state.documentContent, contextKey: state.mobileContextKey,
      enabled: state.headerVisible !== false && state.outlineVisible !== false && !state.outlinePending,
      items: state.outlineItems || [], headingElement: state.headingElement, onHeading: state.onOutlineHeading,
      onOutline: pos => openFloatOutline(pos),
    })
    setAttr(mobileButton, 'aria-expanded', String(referenceLayer.isConnected || mobileOpen || (!!state.topbarMoreOpen && !moreDismissed)))
    setAttr(mobileButton, 'aria-label', state.referenceMobileMenu ? '更多文档操作' : '文档操作')
    if (state.referenceMobileMenu) el.insertBefore(headerDivider, outlineButton.parentNode === el ? outlineButton : titleWrap)
    else headerDivider.remove()
    host?.classList.toggle('has-reference-mobile-menu', state.referenceMobileMenu === true)
    library.update(state)
    mountNode(headerActions, headingButton, state.referenceMobileMenu === true)
    setAttr(headingButton, 'aria-expanded', String(!!state.outlineOpen)); headingButton.disabled = state.outlineVisible === false
    const focusedAction = mobileOpen && headerActions.contains(document.activeElement) ? document.activeElement : null
    // ① 整行 v-if：挂/摘都按锚点定位，插在锚点之前（锚点始终留在原地）
    const visible = state.headerVisible !== false
    if (!visible) setMobileOpen(false)
    homeButton.disabled = state.homeEnabled !== true
    membersButton.disabled = state.membersEnabled !== true
    setText(membersTip, state.membersHint || '')
    host?.classList.toggle('has-mobile-members-entry', visible && !membersButton.disabled && typeof handlers.openMembers === 'function')
    membersButton.setAttribute('aria-label', window.innerWidth <= 760 && state.referenceMobileMenu ? '分享文档' : state.membersLabel || '分享只读链接')
    mountNode(headerActions, searchButton, state.compactHeader && state.searchEnabled)
    setAttr(membersButton, 'aria-haspopup', state.membersHasPopup === true ? 'dialog' : null)
    setAttr(membersButton, 'aria-expanded', state.membersHasPopup === true ? String(state.membersExpanded === true) : null)
    const currentUser = state.currentUser?.id ? state.currentUser : null
    const userName = currentUser ? String(currentUser.name || '我') : ''
    setText(avatarBadge, Array.from(userName)[0] || '')
    avatarButton.setAttribute('aria-label', userName ? `当前用户：${userName}` : '未登录')
    avatarButton.disabled = !currentUser || state.profileEnabled !== true
    setAttr(outlineButton, 'aria-expanded', String(state.referenceMobileMenu ? library.el.isConnected : !!state.outlineOpen))
    setAttr(outlineButton, 'aria-label', state.referenceMobileMenu ? '文档库' : '文档目录')
    outlineButton.disabled = state.referenceMobileMenu ? state.libraryEnabled !== true : state.outlineVisible === false
    if (host) {
      if (visible && el.parentNode !== host) host.insertBefore(el, anchor || null)
      else if (!visible && el.parentNode) el.parentNode.removeChild(el)
    }
    // 插槽宿主固定紧跟模式切换。每次 update 都对齐一次而不是只在构造时搬：
    // 顶栏隐藏期间调用方会把宿主搬回停泊位（否则 DOM 更新会落进游离子树），
    // 重新显示时必须搬回来，否则宿主控件整块消失。
    el.classList.toggle('is-compact-header', state.compactHeader === true)
    if (visible && actionsHost && !state.compactHeader) {
      const hostAnchor = modeSelect.el.parentNode === headerActions ? modeSelect.el.nextSibling : headerActions.firstChild
      if (actionsHost.parentNode !== headerActions || actionsHost.previousSibling !== modeSelect.el) headerActions.insertBefore(actionsHost, hostAnchor || null)
    }
    const compactDesktop = state.compactHeader && window.innerWidth > 760
    if (compactDesktop) createButton.remove()
    else if (createButton.parentNode !== headerActions) headerActions.insertBefore(createButton, notifyButton)
    setAttr(createButton, 'aria-expanded', String(!!state.createMenuOpen))
    createButton.disabled = !!state.readonly || state.hostCreateEnabled === false
    notifyButton.disabled = !!state.notifyDisabled
    setAttr(notifyButton, 'aria-disabled', String(notifyButton.disabled))
    setAttr(notifyButton, 'data-capability', 'canView')
    setAttr(notifyButton, 'aria-expanded', String(!notifyButton.disabled && !!state.notifyOpen))
    const unread = notifyButton.disabled ? 0 : Math.max(0, Number(state.notifyUnreadCount) || 0)
    setText(notifyDot, unread > 99 ? '99+' : unread)
    mountNode(notifyButton, notifyDot, unread > 0)
    setAttr(moreButton, 'aria-expanded', String(!!state.topbarMoreOpen && !moreDismissed))
    menusUi.update({ ...state, moreDismissed })
    const nextPendingMore = !menusUi.el && visible && !!state.topbarMoreOpen && !moreDismissed
    if (nextPendingMore && !pendingMoreOpen) activeMoreMenus.set(menuDocument, pendingMoreToken)
    if (!nextPendingMore && activeMoreMenus.get(menuDocument) === pendingMoreToken) activeMoreMenus.delete(menuDocument)
    pendingMoreOpen = nextPendingMore
    pendingCreateOpen = !compactDesktop && !menusUi.el && visible && !!state.createMenuOpen && !state.readonly

    // ② 标题：只在真变了才写 value，否则用户输入时光标会被重置到末尾
    const title = state.title == null ? '' : String(state.title)
    setText(paperTitle, title || DEFAULT_TITLE_PLACEHOLDER)
    const metadata = state.documentMetadata || {}, author = typeof metadata.author?.name === 'string' ? metadata.author.name.trim() : ''
    const modifiedAt = metadata.modifiedAt
    const stamp = typeof modifiedAt === 'number' ? modifiedAt : Date.parse(modifiedAt)
    const modified = Number.isFinite(stamp) && stamp > 0 ? new Date(stamp) : null
    let recent = '未提供', bodyTime = '修改时间未提供'
    if (modified) {
      const elapsed = Math.max(0, Date.now() - stamp), minutes = Math.floor(elapsed / 60000), hours = Math.floor(minutes / 60), days = Math.floor(hours / 24)
      recent = minutes < 1 ? '刚刚' : minutes < 60 ? `${minutes}分钟前` : hours < 24 ? `${hours}小时前` : days < 7 ? `${days}天前` : modified.toLocaleDateString('zh-CN')
      bodyTime = modified.toDateString() === new Date().toDateString() ? '今天修改' : `${modified.toLocaleDateString('zh-CN')}修改`
    }
    setText(modifiedLine, `最近修改：${recent}`)
    if (!compactDesktop) {
      const authorBadge = document.createElement('span'), authorLabel = document.createElement('span'), metaDivider = document.createElement('span'), modifiedLabel = document.createElement('span')
      authorBadge.className = 'lark-doc-document-author-avatar'; authorBadge.setAttribute('aria-hidden', 'true'); authorBadge.textContent = author ? Array.from(author).slice(-2).join('') : '?'
      authorLabel.className = 'lark-doc-document-author-name'; authorLabel.textContent = author || '作者未提供'; metaDivider.className = 'lark-doc-document-meta-divider'; metaDivider.setAttribute('aria-hidden', 'true'); modifiedLabel.className = 'lark-doc-document-modified'; modifiedLabel.textContent = bodyTime
      paperMeta.replaceChildren(authorBadge, authorLabel, metaDivider, modifiedLabel)
    }
    desktopDetails.update({ ...state, open: visible && compactDesktop })
    syncMobileTitle()
    if (titleInput.value !== title) titleInput.value = title
    setAttr(titleInput, 'maxlength', state.titleLength == null ? null : state.titleLength)
    const readonly = Boolean(state.readonly)
    setAttr(titleInput, 'readonly', readonly ? '' : null)
    const sub = readonly ? SUB_READONLY : SUB_EDITABLE
    if (titleSub.textContent !== sub) titleSub.textContent = sub

    // 隐藏时摘掉整个控件，不留按钮或间距占位；重新显示仍排在宿主动作之前。
    if (state.modeVisible !== false) {
      if (modeSelect.el.parentNode !== headerActions) headerActions.insertBefore(modeSelect.el, headerActions.firstChild)
    } else {
      modeSelect.close()
      if (modeSelect.el.parentNode) modeSelect.el.parentNode.removeChild(modeSelect.el)
    }

    // ③ 模式下拉：选项表 / 当前值 / 前导图标 / 禁用态一次推完，开合与坐标不归这里管。
    const label = state.modeLabel == null ? '' : String(state.modeLabel)
    const items = Array.isArray(state.modeOptions) ? state.modeOptions : []
    switchable = state.modeSwitchable !== false
    modeSelect.update({
      options: items.map((item) => ({ value: item.id, label: item.label, hint: item.hint,
        ...(state.compactHeader ? { icon: MODE_ICONS[item.id] } : {}) })),
      value: state.mode,
      disabled: !switchable,
      icon: state.modeIcon || '',
      ariaLabel: `切换文档模式，当前${label}`,
    })
    // 只有一项可选：不给「可切换」的语义（aria-haspopup 摘掉 + 藏 caret），
    // 但**不加 disabled 的灰**（.is-static 在 CSS 里把 opacity 拉回 1）。
    setAttr(modeTrigger, 'aria-haspopup', switchable ? 'listbox' : null)
    if (modeSelect.el.classList.contains('is-static') !== !switchable) modeSelect.el.classList.toggle('is-static', !switchable)
    if (mobileOpen && window.innerWidth <= 760 && focusedAction && !focusableActions().includes(focusedAction)) focusableActions()[0]?.focus()
    trackToolbarOffset(visible && state.stackToolbar)
  }

  function destroy() {
    if (disposed) return
    trackToolbarOffset(false)
    dismissFloatOutline(false, false)
    scrollNavigator?.destroy()
    library.destroy(); setReferenceOpen(false)
    setMobileOpen(false)
    disposed = true
    desktopDetails.destroy()
    host?.classList.remove('has-mobile-members-entry')
    host?.classList.remove('has-reference-mobile-menu')
    paperHeader.remove(); outlinePopup.remove(); options.paperHost?.classList.remove('has-mobile-title')
    mobileCancel.removeEventListener('click', cancelMobile)
    mobileBackdrop.removeEventListener('click', closeBackdrop)
    window.removeEventListener('resize', resizeMobile)
    document.removeEventListener('pointerdown', closeMobileOutside)
    document.removeEventListener('keydown', closeDocumentOutline)
    menuDocument.removeEventListener('pointerdown', closePendingOutside)
    menuDocument.removeEventListener('keydown', closePendingEscape)
    menuDocument.removeEventListener('focusin', trackPendingFocus)
    if (activeMoreMenus.get(menuDocument) === pendingMoreToken) activeMoreMenus.delete(menuDocument)
    el.removeEventListener('keydown', closeMobileEscape, true)
    // 插槽宿主是调用方的财产：先交还，再摘自己（否则 Vue 更新时会找不到节点）。
    if (actionsHost && actionsHost.parentNode === headerActions) headerActions.removeChild(actionsHost)
    modeSelect.destroy()
    menusUi.destroy()
    if (el.parentNode) el.parentNode.removeChild(el)
  }

  return { el, update, destroy }
}
