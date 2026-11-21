/**
 * 评论面板的静态骨架 —— 容器壳体、移动端卡片、侧栏头、两个输入区、图片预览、表情选择器。
 *
 * 从 `ui/commentPanel.js` 原样搬出：节点创建顺序、类名、ARIA 与事件接线一行未改。
 * 只做「建一次」的部分；签名驱动的重建仍在 `commentPanel.js`（`render`）与
 * `commentPanelThread.js`（`renderPanel` / `buildReplies`）。
 */

import { iconNode } from './icon'
import { COMMENT_IMAGE_ACCEPT } from '../components/lark-doc/editor/commentImages'

export function createCommentChrome(ctx) {
  const {
    el, state, call, onAction, richInput, richInputs, bindSubmitShortcut, bindViewerEscape,
    isInlineDocument, hasInlineDocument, isDocumentMentionOpen, isReferenceDrawer,
    update, setNativeThreadOpen, isDestroyed,
  } = ctx

  const documentFlow = document.createElement('section')
  documentFlow.className = 'lark-doc-comment-layer is-mobile is-inline-document is-drawer-document'
  documentFlow.setAttribute('role', 'region'); documentFlow.setAttribute('aria-label', '全文评论')
  const launcher = document.createElement('div'); launcher.className = 'lark-doc-comment-launcher'
  const launcherButton = document.createElement('button'); launcherButton.type = 'button'
  launcherButton.setAttribute('aria-label', '展开评论'); launcherButton.setAttribute('aria-expanded', 'false')
  launcherButton.appendChild(iconNode('mode-comment', 18)); launcher.appendChild(launcherButton)
  launcherButton.addEventListener('mousedown', event => event.preventDefault())
  launcherButton.addEventListener('click', () => {
    if (!isDestroyed() && launcherButton.isConnected && state.launcher?.visible && !state.sidebarOpen && !state.composer?.open) call('onToggleSidebar')
  })
  const documentHeading = document.createElement('h2')
  const notice = document.createElement('div')
  notice.className = 'lark-doc-comment-media-status lark-doc-comment-notice'
  notice.setAttribute('role', 'alert')
  notice.setAttribute('aria-live', 'assertive')
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
  collapseButton.appendChild(iconNode('chevron-right', 18))
  collapseButton.addEventListener('click', () => call('onToggleSidebar'))
  const threadReader = document.createElement('button')
  threadReader.type = 'button'; threadReader.textContent = '逐条查看'; threadReader.setAttribute('aria-label', '逐条查看评论')
  threadReader.addEventListener('click', () => { if (!isDestroyed() && isReferenceDrawer()) { setNativeThreadOpen(true); update({}) } })
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
  composer.setAttribute('role', 'dialog')
  composer.setAttribute('aria-label', '添加评论')
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
  const composerInput = richInput('lark-doc-comment-input-zone', '输入评论', '输入评论', value => callComposer('onComposerDraft', value))
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
  composerImageInput.accept = COMMENT_IMAGE_ACCEPT
  composerImageInput.className = 'lark-doc-file-input'
  composerImageInput.dataset.commentImageScope = 'selection'
  composerImageInput.setAttribute('aria-label', '选择评论图片')
  composerImageInput.addEventListener('change', event => callComposer('onUploadImage', 'selection', event))
  composerInputRow.append(composerImageButton, composerImageInput)
  const composerImageDrafts = document.createElement('div')
  composerImageDrafts.className = 'lark-doc-comment-attachments'

  const composerActions = document.createElement('div')
  composerActions.className = 'lark-doc-comment-edit-actions'
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
  documentComposerImageInput.type = 'file'; documentComposerImageInput.multiple = true; documentComposerImageInput.accept = COMMENT_IMAGE_ACCEPT; documentComposerImageInput.className = 'lark-doc-file-input'; documentComposerImageInput.dataset.commentImageScope = 'document'; documentComposerImageInput.setAttribute('aria-label', '选择全文评论图片')
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
  documentComposerImages.className = 'lark-doc-comment-attachments'
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

  // 表情选择器：一张 346×342 的固定板子 —— 上段 276px 可滚的九列网格，下段最近使用。
  // 根节点吃掉 mousedown 的默认行为，别让点表情把焦点从面板里挪走。
  const reactionPicker = document.createElement('div')
  reactionPicker.className = 'lark-doc-comment-reaction-picker'
  reactionPicker.setAttribute('role', 'menu')
  reactionPicker.setAttribute('aria-label', '评论表情回复')
  reactionPicker.addEventListener('mousedown', event => event.preventDefault())
  const reactionScroll = document.createElement('div')
  reactionScroll.className = 'lark-doc-comment-reaction-scroll'
  const reactionTitle = document.createElement('div')
  reactionTitle.className = 'lark-doc-comment-reaction-title'
  reactionTitle.textContent = '默认表情'
  const reactionGrid = document.createElement('div')
  reactionGrid.className = 'lark-doc-comment-reaction-grid'
  reactionScroll.append(reactionTitle, reactionGrid)
  const reactionRecentTitle = document.createElement('div')
  reactionRecentTitle.className = 'lark-doc-comment-reaction-title'
  reactionRecentTitle.textContent = '最近使用'
  const reactionRecent = document.createElement('div')
  reactionRecent.className = 'lark-doc-comment-reaction-recent'
  reactionPicker.append(reactionScroll, reactionRecentTitle, reactionRecent)


  return {
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
    likeCaption,
    likeCount,
    composer,
    composerHead,
    composerQuote,
    composerCancelEmpty,
    composerAuthor,
    composerInput,
    composerInputRow,
    composerImageButton,
    composerImageInput,
    composerImageDrafts,
    composerActions,
    composerPrivateLabel,
    composerPrivate,
    composerCancel,
    composerSend,
    documentComposer,
    documentComposerTarget,
    documentComposerInputWrap,
    documentComposerInput,
    documentComposerPreview,
    documentComposerMentionPicker,
    documentMentionSheet,
    documentMentionHead,
    documentMentionCancel,
    documentMentionTitle,
    documentComposerTools,
    documentComposerImageButton,
    documentComposerImageInput,
    documentComposerMore,
    backToTop,
    documentComposerImages,
    documentComposerActions,
    documentComposerPrivateLabel,
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
    imageClose,
    viewerImage,
    reactionPicker,
    reactionScroll,
    reactionGrid,
    reactionRecent,
    mobileNext,
    mobileClose,
    likeStatus,
    viewerCaption,
  }
}
