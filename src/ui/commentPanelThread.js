/**
 * 评论线程卡片 —— 一张卡的建节点（`createPanelNode`）、控件条重建（`ensureControls`）、
 * 回复流重建（`buildReplies`）与签名驱动的整体刷新（`renderPanel`）。
 *
 * 从 `ui/commentPanel.js` 原样搬出，DOM 结构与断言口径一行未改。跨模块的可变状态
 * （悬停菜单计时器、删除确认、富文本输入注册表）全部留在 `commentPanel.js`，
 * 这里只通过 `ctx` 调用，不持有副本。
 */

import { applyStyle, setAttr, setText, syncChildren } from './dom'
import { iconNode } from './icon'
import { setInputValue } from './panelShared'
import { renderCommentSegments } from './commentPanelParts'

export function createThreadCard(ctx) {
  const {
    state, call, onAction, richInput, updateRichInput, bindSubmitShortcut, bindViewerEscape,
    imageDraftNodes, renderMentionPicker, isReferenceDrawer, hasInlineDocument, isMobile,
    moveMobile, requestDeleteConfirmation, cancelReplyMenuClose, hoverReply, enterReplyMenu,
    leaveReplyMenu, trackReplyHover, isNativeThreadOpen,
  } = ctx

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
      if (!isNativeThreadOpen() || event.touches.length !== 1) { edgeGesture = null; return }
      const touch = event.touches[0]
      edgeGesture = { x: touch.clientX, y: touch.clientY, top: threadScroll.scrollTop <= 1,
        bottom: threadScroll.scrollTop + threadScroll.clientHeight >= threadScroll.scrollHeight - 1 }
    }, { passive: true })
    threadScroll.addEventListener('touchcancel', () => { edgeGesture = null })
    threadScroll.addEventListener('touchend', event => {
      const start = edgeGesture; edgeGesture = null
      if (!start || !isNativeThreadOpen() || !threadScroll.isConnected) return
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
          trackReplyHover(id, item.id, reply.id, button, event)
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
    applyStyle(entry.root, isNativeThreadOpen() && !item.documentOnly ? { ...item.style, marginTop: '0px' } : item.style)
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
    if (isNativeThreadOpen() && !item.documentOnly) syncChildren(entry.threadScroll, threadContent)
    syncChildren(entry.root, [
      ...(isNativeThreadOpen() && !item.documentOnly ? [{ node: entry.threadScroll, on: true }] : threadContent),
      { node: entry.textareaWrap, on: !item.documentOnly && interactive },
      { node: entry.moreMenu, on: !!item.moreOpen && interactive },
    ])
  }


  return { createPanelNode, renderPanel }
}
