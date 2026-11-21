/**
 * 评论面板层 —— 原生 DOM 版（`display:contents` 容器 + 每线程一张卡）。
 *
 * 从 `ui/panels.js` 原样搬出，函数体与断言口径一行未改。这里只剩**有状态的那一层**：
 * 面板 state、移动端/抽屉的分支判定、滚动锁、删除确认、回复菜单悬停计时器、
 * 提及候选与草稿图片、以及签名驱动的 `render` / `update`。
 *
 * 另三份同目录实现（都只通过 `ctx` 回调，不持有可变状态副本）：
 * - `commentPanelChrome.js`：只建一次的静态骨架（壳体、侧栏头、两个输入区、图片预览、表情选择器）。
 * - `commentPanelThread.js`：单张线程卡片的建节点 / 控件条 / 回复流 / `renderPanel`。
 * - `commentPanelParts.js`：两段无闭包依赖的纯函数（富文本输入兜底、评论分段渲染）。
 *
 * 拆分代价实测：`feature:uiPanels:umd` raw 324,465 → 328,172、gzip 96,113 → 97,449
 * （+1.34%），全部来自「63 个节点出参 + 78 个节点回参」两份名单。该包是**懒加载**，
 * 首屏 601,740 B 一分未动；再往下压需要把这些节点推进各自的 `update`，属另一轮重构。
 */

import { applyStyle, lockPageScroll, mountNode, setAttr, setText, syncChildren } from './dom'
import { iconNode } from './icon'
import { handlerCaller, reactionIcon } from './panelShared'
import { placeMenu } from './menuLayout'
import { createPlainCommentInput, renderCommentSegments } from './commentPanelParts'
import { createCommentChrome } from './commentPanelChrome'
import { createThreadCard } from './commentPanelThread'
import { createCommentHistory } from './commentHistory'
import { commentAttachmentNodes } from './commentAttachments'

/* ═══════════════════════ ④ 评论面板层 ═══════════════════════ */

/**
 * 评论面板层（`CommentPanel.vue`）。
 *
 * 容器 `.lark-doc-comment-layer` 是 `display: contents`（`styles/comments.css`）——
 * 它不产生盒子，每张卡自己 `position: fixed`。断言量 `getComputedStyle(layer).display === 'contents'`。
 *
 * 一张卡由四段组成（顺序固定）：头（引用 + 六格控件条）/ 回复流 / 输入区 / 面板头「更多」。
 * 头、输入区、「更多」在 `createCommentChrome` 里建一次；回复流按签名重建（回复与菜单都可能随时变）。
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
  const imageDraftNodes = (scope, images = []) => commentAttachmentNodes(images, true,
    (name, id) => call(name, scope, id)).map(node => ({ node, on: true }))
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
    historyOpen: false,
    historyStyle: {},
    historyItems: [],
    composer: { open: false },
    items: [],
  }


  const el = document.createElement('div')
  el.className = 'lark-doc-comment-layer'

  /** @type {Map<string, ReturnType<typeof createThreadCard>['createPanelNode']>} */
  const panelNodes = new Map()

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
  let confirmationDialog = null
  const closeCommentConfirmation = (restore = false) => {
    const confirmation = confirmationDialog
    if (!confirmation) return
    const ownedFocus = confirmation.ownedFocus()
    confirmationDialog = null; confirmation.el.remove(); confirmation.unlock()
    if (restore && confirmation.intent.current() && ownedFocus) {
      const entry = panelNodes.get(confirmation.threadId)
      const reply = [...(entry?.replies.querySelectorAll('[data-comment-reply]') || [])].find(node => node.dataset.commentReply === confirmation.replyId)
      const trigger = confirmation.trigger || reply?.querySelector('[data-comment-reply-control="more"]')
      if (trigger?.isConnected) trigger.focus({ preventScroll: true })
    }
  }
  const requestDeleteConfirmation = (threadId, replyId, scope) => {
    if (!scope?.current()) return
    openCommentConfirmation(threadId, replyId, call('onRequestDelete', threadId, replyId, scope))
  }
  const requestResolveConfirmation = (threadId, trigger) => {
    openCommentConfirmation(threadId, '', call('onRequestResolve', threadId), trigger)
  }
  const openCommentConfirmation = (threadId, replyId, intent, trigger) => {
    if (!intent?.current()) return
    closeCommentConfirmation()
    call('onCloseMenus')
    const backdrop = document.createElement('div'); backdrop.className = 'lark-doc-comment-delete-mask'
    const dialog = document.createElement('section'); dialog.className = 'lark-doc-comment-delete-dialog'
    const label = replyId ? '删除评论' : '解决并隐藏'
    dialog.setAttribute('role', 'alertdialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-label', label)
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = '取消'; cancel.setAttribute('aria-label', replyId ? '取消删除评论' : '取消解决评论')
    const confirm = document.createElement('button'); confirm.type = 'button'; confirm.textContent = label; confirm.setAttribute('aria-label', '确认' + label)
    const focus = () => dialog.getRootNode().activeElement || dialog.ownerDocument.activeElement
    const targets = [el.ownerDocument.body, options.inlineHost?.closest('.lark-doc-main')].filter(Boolean)
    const release = [...new Set(targets)].map(lockPageScroll)
    const confirmation = { el: backdrop, intent, threadId, replyId, trigger,
      ownedFocus: () => dialog.contains(focus()), unlock: () => release.reverse().forEach(unlock => unlock()) }
    onAction(cancel, () => closeCommentConfirmation(true))
    onAction(confirm, () => {
      if (confirmationDialog !== confirmation) return
      if (!intent.current() || (state.viewerHost && state.viewerCurrent?.() !== true)) { closeCommentConfirmation(); return }
      closeCommentConfirmation()
      void intent.confirm()
    })
    dialog.addEventListener('keydown', event => {
      if (event.isComposing || event.keyCode === 229) return
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeCommentConfirmation(true) }
      if (event.key === 'Tab') { event.preventDefault(); (focus() === cancel ? confirm : cancel).focus() }
    })
    backdrop.addEventListener('click', event => { if (event.target === backdrop && confirmationDialog === confirmation) closeCommentConfirmation(true) })
    dialog.append(confirm, cancel); backdrop.append(dialog)
    confirmationDialog = confirmation
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

  const trackReplyHover = (id, threadId, replyId, node, event) => {
    cancelReplyMenuClose()
    dismissedReplyHover = id === 'more' && hoverReply(node, threadId, replyId, event)?.menuOpen ? { threadId, replyId } : null
  }

  const {
    documentFlow,
    launcher,
    launcherButton,
    documentHeading,
    notice,
    mobileSheet,
    mobileHead,
    mobileTitle,
    mobilePrev,
    mobileCarousel,
    mobileDocumentList,
    sidebarHead,
    sidebarTitle,
    historyButton,
    collapseButton,
    threadReader,
    emptyState,
    documentLike,
    likeButton,
    likeCount,
    composer,
    composerQuote,
    composerAuthor,
    composerInput,
    composerImageButton,
    composerImageDrafts,
    composerPrivate,
    composerPrivateLabel,
    composerCancel,
    composerSend,
    documentComposer,
    documentComposerTarget,
    documentComposerInputWrap,
    documentComposerInput,
    documentComposerPreview,
    documentComposerMentionPicker,
    documentMentionCancel,
    documentMentionSheet,
    documentComposerTools,
    documentComposerImageButton,
    documentComposerMore,
    backToTop,
    documentComposerImages,
    documentComposerActions,
    documentComposerPrivate,
    documentComposerCancel,
    documentComposerSend,
    imageStatus,
    imageStatusText,
    cancelUpload,
    queryImage,
    translationRecovery,
    queryTranslation,
    imageBackdrop,
    imageViewer,
    viewerImage,
    reactionPicker,
    reactionGrid,
    reactionRecent,
    mobileNext,
    mobileClose,
    likeStatus,
    viewerCaption,
  } = createCommentChrome({
    el, state, call, onAction, richInput, richInputs, bindSubmitShortcut, bindViewerEscape,
    isMobile, isInlineDocument, hasInlineDocument, isDocumentMentionOpen, isReferenceDrawer,
    update, setNativeThreadOpen: open => { nativeThreadOpen = open }, isDestroyed: () => destroyed,
  })

  onAction(mobileClose, dismissMobile)
  // 悬停打开的表情板要留 180ms 过桥时间：从「添加表情回复」挪到板子上的路上
  // 会经过面板空白，立刻关就等于不给点。
  let reactionCloseTimer = null
  const cancelReactionClose = () => { clearTimeout(reactionCloseTimer); reactionCloseTimer = null }
  const scheduleReactionClose = () => {
    cancelReactionClose()
    const identity = state.identityGeneration
    reactionCloseTimer = setTimeout(() => {
      reactionCloseTimer = null
      if (identity === state.identityGeneration && state.reactionPicker?.open) call('onCloseReaction')
    }, 180)
  }
  reactionPicker.addEventListener('mouseenter', cancelReactionClose)
  reactionPicker.addEventListener('mouseleave', scheduleReactionClose)
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


  const { createPanelNode, renderPanel, buildReplies } = createThreadCard({
    state, call, onAction, richInput, updateRichInput, bindSubmitShortcut, bindViewerEscape,
    imageDraftNodes, renderMentionPicker, isReferenceDrawer, hasInlineDocument, isMobile,
    moveMobile, requestDeleteConfirmation, requestResolveConfirmation, cancelReplyMenuClose, hoverReply, enterReplyMenu,
    leaveReplyMenu, trackReplyHover, cancelReactionClose, scheduleReactionClose,
    isNativeThreadOpen: () => nativeThreadOpen,
  })

  const historyLayer = createCommentHistory({ createPanelNode, buildReplies, call, ownerDocument: el.ownerDocument })

  // 目录近 1MB、188 项：只在目录对象换了才重建网格；「最近使用」按 key 序列去抖。
  let reactionGridCatalog = null, reactionRecentSignature = ''
  function reactionButton(catalog, item, size) {
    const button = document.createElement('button')
    button.type = 'button'
    button.setAttribute('role', 'menuitem')
    button.setAttribute('aria-label', item.name)
    button.title = item.name
    button.appendChild(reactionIcon(catalog, item.id, size, 'var(--ld-comment-reaction-sprite)'))
    onAction(button, () => call('onChooseReaction', item.id))
    return button
  }
  function renderReactionPicker(catalog, recent) {
    if (!catalog) { reactionGridCatalog = null; reactionRecentSignature = ''; return }
    if (catalog !== reactionGridCatalog) {
      reactionGridCatalog = catalog
      reactionPicker.style.setProperty('--ld-comment-reaction-sprite', `url("${catalog.sprite}")`)
      reactionGrid.replaceChildren(...catalog.items.map(item => reactionButton(catalog, item, 24)))
    }
    const keys = [...new Set([...(recent || []), 'applaud_v2', 'thumbsup_v2', 'typing', 'fighton_v2', 'ok_v2', 'heart', 'plusone'])].slice(0, 7)
    const signature = keys.join('|')
    if (signature === reactionRecentSignature) return
    reactionRecentSignature = signature
    reactionRecent.replaceChildren(...keys
      .map(key => catalog.items.find(item => item.id === key)).filter(Boolean)
      .map(item => reactionButton(catalog, item, 28)))
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
    composerPrivate.disabled = !!nextComposer.readonly || (nextComposer.privateAvailable === false && !nextComposer.privateOn)
    composerPrivateLabel.lastChild.nodeValue = nextComposer.privateAvailable === false ? '私密评论（仅全文支持）' : '私密评论'
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
    renderReactionPicker(picker.catalog, picker.recent)
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
    historyLayer.render(state)
    syncChildren(el, [...content, { node: imageStatus, on: !!media.busy || !!media.pending },
      { node: translationRecovery, on: !!state.translationRecovery?.pending },
      { node: historyLayer.history, on: !!state.historyOpen },
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
    if (confirmationDialog) {
      const { threadId, replyId, intent } = confirmationDialog
      const thread = state.items?.find(item => item.id === threadId)
      if (identityChanged || !thread || (replyId && !thread.replies?.some(reply => reply.id === replyId && !reply.tombstone)) ||
        !intent.current() || (state.viewerHost && state.viewerCurrent?.() !== true)) closeCommentConfirmation()
    }
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
    mountNode(options.inlineHost?.closest('.lark-doc') || host, launcher, (isMobile() || state.launcher?.desktop) && state.launcher?.visible === true && !state.sidebarOpen && !state.composer?.open)
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
    // 查看器评论栏（295px 的 `lark-doc-image-viewer-comments`）由外面建好，面板只是它里面的一张卡；
    // 没有右栏时才退回「面板自己绝对定位成右栏」的老路子。
    const viewerSidebar = !!state.viewerHost && !state.viewerColumn
    applyStyle(el, viewerSidebar ? { position: 'absolute', left: 'auto', right: '0',
      top: `${viewerClose?.height ? Math.max(0, viewerClose.bottom - viewerBounds.top + 8) : 56}px`,
      bottom: `${viewerToolbar?.height ? Math.max(0, viewerBounds.bottom - viewerToolbar.top + 8) : 95}px`, width: `${Math.min(300, el.ownerDocument.defaultView.innerWidth * .75)}px`, maxWidth: '100%',
      display: 'flex', flexDirection: 'column', gap: '12px', padding: '16px', boxSizing: 'border-box', overflow: 'auto', overscrollBehavior: 'contain',
      background: 'var(--ld-comment-surface)', color: 'var(--ld-text)', pointerEvents: 'auto', zIndex: '1003' } : {})
    mountNode(state.viewerColumn || state.viewerHost || (inline ? options.inlineHost : drawerHost || host), el, visible)
    if (drawerHost) el.style.minHeight = `${Math.max(drawerHost.clientHeight, options.inlineHost.scrollHeight)}px`
    else el.style.minHeight = ''
    if (!visible) {
      closeCommentConfirmation()
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
    destroy() { if (destroyed) return; destroyed = true; closeCommentConfirmation(); historyLayer.destroy(); menuViewport?.removeEventListener('resize', positionReplyMenus); menuViewport?.removeEventListener('scroll', positionReplyMenus); cancelReplyMenuClose(); dismissedReplyHover = null; syncScrollLock(false); launcher.remove(); notice.remove(); documentFlow.remove(); window.removeEventListener('resize', resizeMobile); cancelAnimationFrame(scrollFrame); richInputs.forEach(input => input.destroy()); richInputs.clear(); if (el.parentNode) el.parentNode.removeChild(el) },
  }
}
