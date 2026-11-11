<template>
  <div
    class="lark-doc-comments-root"
    :class="{ 'is-document-root': documentOnly }"
  >
    <div
      v-if="documentOnly ? ed.commentRemote && ed.commentCan('canView') : ed.commentRemote ? ed.commentSidebarOpen && ed.commentCan('canView') : ed.commentPanels.length"
      class="lark-doc-comment-layer"
      :class="{ 'is-remote': ed.commentRemote && !documentOnly, 'is-document': documentOnly }"
      :style="ed.commentRemote && !documentOnly && ed.commentLayerHeight != null ? { top: `${ed.commentLayerTop}px`, maxHeight: `${ed.commentLayerHeight}px` } : null"
    >
      <header
        v-if="ed.commentRemote"
        class="lark-doc-comment-sidebar-head"
      >
        <span>{{ documentOnly ? '全文评论' : historicalOnly ? `历史评论（${ed.commentPanels.length}）` : `评论（${ed.commentSelectionCount + (ed.commentComposerOpen ? 1 : 0)}）` }}</span>
        <template v-if="!documentOnly">
          <button
            type="button"
            :aria-pressed="String(ed.commentHistory)"
            @click="ed.setCommentHistory(!ed.commentHistory && !historicalOnly)"
          >
            {{ ed.commentHistory || historicalOnly ? '返回未解决' : '已解决评论' }}
          </button>
          <button
            type="button"
            aria-label="收起评论侧栏"
            @click="ed.toggleCommentSidebar()"
          >
            »
          </button>
        </template>
      </header>
      <section
        v-if="ed.commentRemote && !documentOnly && !historicalOnly && ed.commentComposerOpen"
        class="lark-doc-comment-composer is-selection"
        :style="{ marginTop: `${ed.commentComposerGap}px` }"
        aria-label="发表选区评论"
        @keydown.stop
        @mousedown.stop
      >
        <div
          class="lark-doc-comment-head"
        >
          <span class="lark-doc-comment-quote">{{ ed.commentComposerContext && ed.commentComposerContext.text }}</span>
          <button
            type="button"
            class="lark-doc-comment-cancel-empty"
            aria-label="取消新评论"
            @click="ed.closeCommentComposer()"
          >
            ×
          </button>
        </div>
        <div class="lark-doc-comment-composer-author">
          <span class="lark-doc-comment-avatar">{{ commentAuthorInitial(ed.commentAuthor) }}</span><span>{{ ed.commentAuthorName(ed.commentAuthor) }}</span>
        </div>
        <div class="lark-doc-comment-input">
          <textarea
            class="lark-doc-comment-input-zone"
            :value="ed.commentCreateDraft"
            aria-label="新评论"
            placeholder="输入评论"
            :readonly="!ed.commentAllowed('create')"
            @input="ed.setCommentCreateDraft($event.target.value)"
          />
          <button
            type="button"
            class="lark-doc-comment-operation"
            aria-label="选区评论插入图片"
            :disabled="!ed.commentCanUploadImage('selection')"
            @click="chooseCommentImageFile('selection')"
          >
            <LarkDocIcon
              name="rev-image"
              :size="16"
            />
          </button>
          <input
            type="file"
            hidden
            multiple
            accept="image/png,image/jpeg,image/gif,image/webp"
            :data-comment-image-scope="'selection'"
            @change="uploadCommentImageFiles('selection', $event)"
          >
        </div>
        <div
          v-if="ed.commentDraftImages('selection').length"
          class="lark-doc-comment-image-drafts"
        >
          <div
            v-for="image in ed.commentDraftImages('selection')"
            :key="image.assetId"
          >
            <img
              v-if="image.previewUrl"
              :src="image.previewUrl"
              :alt="image.fileName"
            ><span v-else>{{ image.fileName }}</span>
            <button
              type="button"
              :aria-label="'移除图片：' + image.fileName"
              @click="ed.removeCommentDraftImage('selection', image.assetId)"
            >
              ×
            </button>
          </div>
        </div>
        <div
          v-if="(ed.commentCreateDraft).trim() || ed.commentDraftImages('selection').length"
          class="lark-doc-comment-compose-actions"
        >
          <label><input
            :checked="ed.commentCreatePrivate"
            type="checkbox"
            @change="ed.setCommentCreatePrivate($event.target.checked)"
          >私密评论</label>
          <button
            type="button"
            class="lark-doc-comment-action is-outlined"
            @click="ed.closeCommentComposer()"
          >
            取消
          </button>
          <button
            type="button"
            class="lark-doc-comment-action is-filled"
            :disabled="!ed.commentAllowed('create')"
            @click="ed.createCommentFromSelection(ed.commentCreateDraft, ed.commentCreatePrivate ? 'private' : 'document')"
          >
            发送
          </button>
        </div>
      </section>
      <div
        v-if="ed.commentMessage"
        class="lark-doc-comment-feedback"
        role="status"
      >
        {{ ed.commentMessage }}
      </div>
      <div
        v-if="ed.commentRemote && (ed.commentPendingOperation || ed.commentPendingFollowOperation || ed.commentPendingTranslationOperation)"
        class="lark-doc-comment-feedback"
      >
        <button
          v-if="ed.commentPendingOperation"
          type="button"
          :disabled="ed.commentBusy"
          @click="ed.queryPendingComment()"
        >
          查询原操作
        </button>
        <button
          v-if="ed.commentPendingFollowOperation"
          type="button"
          :disabled="ed.commentFollowBusy"
          @click="ed.queryPendingCommentFollow()"
        >
          查询原关注偏好
        </button>
        <button
          v-if="ed.commentPendingTranslationOperation"
          type="button"
          :disabled="ed.commentTranslationBusy"
          @click="queryPendingCommentTranslation()"
        >
          查询原翻译请求
        </button>
      </div>
      <p
        v-if="ed.commentRemote && !documentOnly && !ed.commentComposerOpen && !ed.commentPanels.length"
        class="lark-doc-comment-state"
      >
        {{ historicalOnly ? '暂无历史评论' : ed.commentHistory ? '暂无已解决评论' : '暂无选区评论，选中文字即可发表评论。' }}
      </p>
      <div
        v-for="item in documentOnly ? ed.commentDocumentThreads : ed.commentPanels"
        :key="item.id"
        class="lark-doc-comment-panel"
        :class="{ 'is-remote': ed.commentRemote, 'is-active': ed.commentActiveThreadId === item.id, 'is-document': documentOnly }"
        :data-comment-thread="item.id"
        :role="documentOnly ? 'group' : 'dialog'"
        :aria-label="commentPanelTitle"
        :style="ed.commentRemote ? { height: 'auto', marginTop: documentOnly ? '0' : `${item.gap || 0}px` } : { ...ed.commentPanelStyle(item), height: `${ed.commentPanelHeightOf(item)}px` }"
        @keydown.stop
        @click="ed.commentActiveThreadId !== item.id && ed.activateComment(item.id)"
      >
        <!-- 引用头 268×35：左侧引用原文（fs12、单行截断），右侧控件组 97×26。 -->
        <div
          v-if="!documentOnly"
          class="lark-doc-comment-head"
        >
          <span class="lark-doc-comment-quote">{{ ed.commentQuoteOf(item) }}</span>
          <div class="lark-doc-comment-controls">
            <span
              v-for="btn in commentControls"
              :key="btn.id"
              class="lark-doc-comment-cell"
            >
              <span
                v-if="btn.split"
                class="lark-doc-comment-split"
                aria-hidden="true"
              />
              <button
                v-else
                type="button"
                class="lark-doc-comment-btn"
                :class="{
                  'is-primary': btn.tone === 'primary',
                  'is-disabled': commentControlDisabled(btn.id, item.id),
                }"
                :aria-label="btn.id === 'resolve' && item.resolved ? '重开评论' : btn.label"
                :disabled="commentControlDisabled(btn.id, item.id)"
                @mousedown.prevent
                @click="runCommentControl(btn.id, item.id, $event)"
              >
                <LarkDocIcon
                  v-if="btn.icon"
                  :name="btn.icon"
                  :size="btn.iconSize"
                />
                <span
                  v-else
                  class="lark-doc-comment-dots"
                  aria-hidden="true"
                />
              </button>
            </span>
          </div>
        </div>
        <p
          v-if="ed.commentRemote && commentStateText(item)"
          class="lark-doc-comment-state"
        >
          {{ commentStateText(item) }}
        </p>
        <!-- 回复流：每条 268×61（main 244×49 = 头像 32 + 右列 200）。 -->
        <div class="lark-doc-comment-replies">
          <div
            v-for="reply in item.replies"
            :key="reply.id"
            class="lark-doc-comment-reply"
          >
            <div class="lark-doc-comment-reply-main">
              <span
                class="lark-doc-comment-avatar"
                aria-hidden="true"
              >
                <span v-if="ed.commentRemote">{{ commentAuthorInitial(reply.author) }}</span><LarkDocIcon
                  v-else
                  name="rev-avatar"
                  :size="18"
                />
              </span>
              <div class="lark-doc-comment-reply-right">
                <div class="lark-doc-comment-info">
                  <span class="lark-doc-comment-name">{{ ed.commentAuthorName(reply.author) }}</span>
                  <span class="lark-doc-comment-time">{{ documentOnly ? documentCommentTime(reply.editedAt == null ? reply.createdAt : reply.editedAt) : ed.commentTimeAt(reply.createdAt) }}</span>
                </div>
                <div class="lark-doc-comment-body">
                  <template v-if="reply.tombstone">
                    评论已删除
                  </template><template v-else>
                    <span
                      v-for="(segment, index) in commentMentionSegments(reply.content, reply.mentions, reply.references)"
                      :key="index"
                      :data-comment-mention="segment.principalId || null"
                      :data-comment-reference="segment.docId || null"
                      :role="segment.docId ? 'link' : null"
                      :tabindex="segment.docId ? 0 : null"
                      :class="segment.docId ? ['lark-doc-comment-document-reference', { 'is-disabled': segment.readable === false }] : segment.principalId ? ['lark-doc-comment-mention-chip', { 'is-self': segment.principalId === ed.commentAuthor.id }] : null"
                      @click="onCommentDocumentReferenceClick($event, item.id, reply.id, segment)"
                      @keydown.enter="onCommentDocumentReferenceClick($event, item.id, reply.id, segment)"
                    ><svg
                      v-if="segment.docId"
                      width="14"
                      height="14"
                      viewBox="0 0 14 14"
                      fill="none"
                      aria-hidden="true"
                    ><path
                      d="M3 1.5h5l3 3v8H3zM8 1.5v3h3M5 7h4M5 9h4"
                      stroke="currentColor"
                      stroke-linejoin="round"
                    /></svg><span :class="segment.docId ? 'lark-doc-comment-reference-label' : segment.principalId ? 'lark-doc-comment-mention-label' : null">{{ segment.text }}</span></span>
                  </template>
                </div>
                <div
                  v-if="!reply.tombstone && reply.attachments && reply.attachments.length"
                  class="lark-doc-comment-images"
                >
                  <button
                    v-for="image in reply.attachments"
                    :key="image.assetId"
                    type="button"
                    :aria-label="'查看评论图片：' + image.fileName"
                    :disabled="!ed.commentImageUrl(item, reply, image) && !ed.commentImageErrors[ed.commentImageKey(item, reply, image)]"
                    @click="ed.openCommentImage(item, reply, image, $event)"
                  >
                    <img
                      v-if="ed.commentImageUrl(item, reply, image)"
                      :src="ed.commentImageUrl(item, reply, image)"
                      :alt="image.fileName"
                    >
                    <span v-else>{{ ed.commentImageErrors[ed.commentImageKey(item, reply, image)] ? '图片加载失败，点击重试' : '图片加载中…' }}</span>
                  </button>
                </div>
                <div
                  v-if="!reply.tombstone && reply.reactions && reply.reactions.length"
                  class="lark-doc-comment-reactions"
                  aria-label="表情回复"
                >
                  <button
                    v-for="reaction in reply.reactions"
                    :key="reaction.emoji"
                    type="button"
                    class="lark-doc-comment-reaction"
                    :aria-pressed="String(reaction.reactedByMe)"
                    :aria-label="`${commentReactionLabel(reaction.emoji)} ${reaction.count} 人${reaction.reactedByMe ? '，已回应，点击取消' : '，点击回应'}`"
                    :disabled="!ed.commentAllowed('react', item.id, reply.id)"
                    @click="setCommentReaction(item.id, reply.id, reaction.emoji, !reaction.reactedByMe)"
                  >
                    <span>{{ reaction.emoji }}</span><span>{{ reaction.count }}</span>
                  </button>
                </div>
              </div>
            </div>
            <!-- hover 三按钮 14×14 / 步进 25，紧贴信息行右端（04 §3.1④-2）。 -->
            <div
              v-if="!historicalOnly"
              class="lark-doc-comment-reply-controls"
            >
              <button
                v-for="ctl in commentReplyControls"
                :key="ctl.id"
                type="button"
                class="lark-doc-comment-icon-btn"
                :aria-label="documentOnly ? documentControlLabel(ctl, item, reply) : ctl.label"
                :disabled="documentOnly ? documentControlDisabled(ctl.id, item, reply) : ctl.id === 'emoji' && !ed.commentAllowed('react', item.id, reply.id)"
                :data-tooltip="documentOnly ? documentControlLabel(ctl, item, reply) : null"
                :aria-expanded="ctl.id === 'emoji' ? String(!!ed.commentReactionContext && ed.commentReactionContext.threadId === item.id && ed.commentReactionContext.replyId === reply.id) : null"
                :aria-haspopup="ctl.id === 'emoji' ? 'dialog' : null"
                @mousedown.prevent
                @click="runCommentReplyControl(ctl.id, item.id, reply.id, $event)"
              >
                <svg
                  v-if="documentOnly && ctl.graphic"
                  width="14"
                  height="14"
                  :viewBox="ctl.graphic.viewBox"
                  aria-hidden="true"
                ><path
                  v-for="(path, index) in ctl.graphic.paths"
                  :key="index"
                  :d="path.d"
                  :fill-rule="path.rule"
                  fill="currentColor"
                /></svg>
                <LarkDocIcon
                  v-else-if="ctl.icon"
                  :name="ctl.icon"
                  :size="ctl.iconSize"
                />
                <span
                  v-else
                  class="lark-doc-comment-dots"
                  aria-hidden="true"
                />
              </button>
            </div>
            <!-- B 套「更多」：152×134，项 144×30 × 4（顺序固定，编辑 / 翻译 / 删除 / 举报）。 -->
            <div
              v-if="ed.commentMenuThreadId === item.id && ed.commentMenuCommentId === reply.id"
              class="lark-doc-comment-reply-menu"
              :style="ed.commentFloatingMenuStyle(ed.commentReplyMenuPosition)"
            >
              <ul
                class="lark-doc-comment-menu-list"
                role="menu"
                aria-label="评论操作"
                @keydown.esc.stop.prevent="ed.closeCommentMenus()"
              >
                <template v-for="menu in commentMenuItems">
                  <li
                    v-if="commentMenuVisible(menu, reply, item.id)"
                    :key="menu.id"
                    class="lark-doc-comment-menu-item"
                    role="menuitem"
                    :aria-disabled="commentMenuDisabled(menu) ? 'true' : null"
                    :tabindex="commentMenuDisabled(menu) ? -1 : 0"
                    @mousedown.prevent
                    @click="runCommentMenuItem(menu.id, item.id, reply.id)"
                    @keydown.enter.prevent="runCommentMenuItem(menu.id, item.id, reply.id)"
                    @keydown.space.prevent="runCommentMenuItem(menu.id, item.id, reply.id)"
                  >
                    <span class="lark-doc-comment-menu-label">{{ menu.label }}</span>
                    <LarkDocIcon
                      v-if="menu.submenu"
                      class="lark-doc-comment-menu-arrow"
                      name="chevronDown"
                      :size="12"
                    />
                  </li>
                </template>
              </ul>
            </div>
          </div>
        </div>
        <div
          v-if="!historicalOnly && ed.commentEditingReply && ed.commentEditingReply.threadId === item.id"
          class="lark-doc-comment-edit"
        >
          <CommentTextInput
            v-if="documentOnly"
            :key="item.id + '/' + ed.commentEditingReply.replyId + '/' + ed.commentEditingReply.generation"
            :ed="ed"
            :value="ed.commentEditContent"
            :mentions="ed.commentEditMentions"
            :references="ed.commentEditReferences"
            :draft-owner="ed.commentEditingReply"
            :readonly="!ed.commentAllowed('edit', item.id, ed.commentEditingReply.replyId)"
            label="编辑评论"
            @input="onDocumentEditInput"
            @keydown="onDocumentEditKeydown"
          />
          <textarea
            v-else
            :value="ed.commentEditContent"
            aria-label="编辑评论"
            @input="ed.setCommentEditContent($event.target.value)"
          />
          <div class="lark-doc-comment-image-drafts">
            <div
              v-for="image in ed.commentDraftImages('edit/' + item.id + '/' + ed.commentEditingReply.replyId)"
              :key="image.assetId"
            >
              <img
                v-if="image.previewUrl"
                :src="image.previewUrl"
                :alt="image.fileName"
              ><span v-else>{{ image.fileName }}</span><button
                type="button"
                :aria-label="'移除图片：' + image.fileName"
                @click="ed.removeCommentDraftImage('edit/' + item.id + '/' + ed.commentEditingReply.replyId, image.assetId)"
              >
                ×
              </button>
            </div>
          </div>
          <button
            type="button"
            aria-label="编辑评论插入图片"
            :disabled="!ed.commentCanUploadImage('edit/' + item.id + '/' + ed.commentEditingReply.replyId)"
            @click="chooseCommentImageFile('edit/' + item.id + '/' + ed.commentEditingReply.replyId)"
          >
            <LarkDocIcon
              name="rev-image"
              :size="16"
            />
          </button>
          <input
            type="file"
            hidden
            multiple
            accept="image/png,image/jpeg,image/gif,image/webp"
            :data-comment-image-scope="'edit/' + item.id + '/' + ed.commentEditingReply.replyId"
            @change="uploadCommentImageFiles('edit/' + item.id + '/' + ed.commentEditingReply.replyId, $event)"
          >
          <button
            type="button"
            @click="ed.cancelCommentEdit()"
          >
            取消编辑
          </button>
          <button
            type="button"
            :disabled="!ed.commentAllowed('edit', item.id, ed.commentEditingReply.replyId) || (!ed.commentEditContent.trim() && !ed.commentDraftImages('edit/' + item.id + '/' + ed.commentEditingReply.replyId).length)"
            @click="ed.saveEditedComment()"
          >
            保存编辑
          </button>
        </div>
        <div
          v-if="ed.commentTranslationContext && ed.commentTranslationContext.threadId === item.id"
          class="lark-doc-comment-edit"
          role="status"
        >
          <p>翻译仅处理当前回复，译文不会覆盖原文。</p>
          <p>来源回复修订：{{ ed.commentTranslationContext.sourceRevision }}</p>
          <label>目标语言代码
            <input
              :value="ed.commentTranslationLanguage"
              aria-label="目标语言代码（自由输入）"
              placeholder="例如 zh-CN"
              :readonly="ed.commentTranslationBusy || Boolean(ed.commentPendingTranslationOperation)"
              @input="ed.setCommentTranslationLanguage($event.target.value)"
            >
          </label>
          <p v-if="!ed.commentTranslationIsCurrent(ed.commentTranslationContext)">
            来源已失效或当前不可见，请重新选择回复。
          </p>
          <p v-if="ed.commentTranslationState && ed.commentTranslationIsCurrent(ed.commentTranslationState)">
            {{ commentTranslationMessage(ed.commentTranslationState) }}
            目标：{{ ed.commentTranslationState.targetLanguage }}
          </p>
          <p v-if="ed.commentTranslationState && ed.commentTranslationIsCurrent(ed.commentTranslationState) && ed.commentTranslationState.status === 'ready'">
            {{ ed.commentTranslationState.translatedText }}
          </p>
          <button
            type="button"
            @mousedown.prevent
            @click="ed.closeCommentTranslation()"
          >
            关闭
          </button>
          <button
            type="button"
            :disabled="ed.commentTranslationBusy || Boolean(ed.commentPendingTranslationOperation) || !ed.commentTranslationIsCurrent(ed.commentTranslationContext)"
            @mousedown.prevent
            @click="submitCommentTranslation()"
          >
            翻译
          </button>
        </div>
        <!-- 输入区 268×58（输入中 98）：外壳 193×26 + 配图 27×16，有字才浮出底部按钮组。 -->
        <div
          v-if="!documentOnly && !historicalOnly && (!ed.commentRemote || ed.commentActiveThreadId === item.id)"
          class="lark-doc-comment-textarea"
          :style="{ height: `${commentTextareaHeight(item)}px` }"
        >
          <div class="lark-doc-comment-input">
            <textarea
              class="lark-doc-comment-input-zone"
              :value="ed.commentDraftOf(item.id)"
              :readonly="!ed.commentAllowed('reply', item.id)"
              aria-label="回复"
              placeholder="回复"
              @input="ed.setCommentDraft(item.id, $event.target.value)"
            />
            <button
              type="button"
              class="lark-doc-comment-operation"
              aria-label="插入图片"
              :disabled="!ed.commentCanUploadImage(item.id)"
              @mousedown.prevent
              @click="chooseCommentImageFile(item.id)"
            >
              <LarkDocIcon
                name="rev-image"
                :size="16"
              />
            </button>
            <input
              type="file"
              hidden
              multiple
              accept="image/png,image/jpeg,image/gif,image/webp"
              :data-comment-image-scope="item.id"
              @change="uploadCommentImageFiles(item.id, $event)"
            >
          </div>
          <div
            v-if="ed.commentDraftImages(item.id).length"
            class="lark-doc-comment-image-drafts"
          >
            <div
              v-for="image in ed.commentDraftImages(item.id)"
              :key="image.assetId"
            >
              <img
                v-if="image.previewUrl"
                :src="image.previewUrl"
                :alt="image.fileName"
              ><span v-else>{{ image.fileName }}</span><button
                type="button"
                :aria-label="'移除图片：' + image.fileName"
                @click="ed.removeCommentDraftImage(item.id, image.assetId)"
              >
                ×
              </button>
            </div>
          </div>
          <div
            v-if="ed.commentHasDraft(item.id)"
            class="lark-doc-comment-actions"
          >
            <button
              type="button"
              class="lark-doc-comment-action is-outlined"
              @mousedown.prevent
              @click="ed.clearCommentDraft(item.id)"
            >
              取消
            </button>
            <button
              type="button"
              class="lark-doc-comment-action is-filled"
              :class="{ 'is-disabled': !ed.commentAllowed('reply', item.id) }"
              :disabled="!ed.commentAllowed('reply', item.id)"
              @mousedown.prevent
              @click="ed.submitCommentDraft(item.id)"
            >
              发送
            </button>
          </div>
        </div>
        <button
          v-else-if="!documentOnly && !historicalOnly"
          type="button"
          class="lark-doc-comment-reply-placeholder"
          @click="ed.activateComment(item.id)"
        >
          回复…
        </button>
        <!-- A 套「更多」：278×92 / z 1050，里头只有「私有评论」一个开关项。 -->
        <div
          v-if="!historicalOnly && ed.commentMoreThreadId === item.id"
          class="lark-doc-comment-more-menu"
          :style="ed.commentFloatingMenuStyle(ed.commentMoreMenuPosition)"
          :class="{ 'is-remote': ed.commentRemote }"
        >
          <div class="lark-doc-comment-more-row">
            <span
              class="lark-doc-comment-more-icon"
              aria-hidden="true"
            >
              <LarkDocIcon
                name="block-task"
                :size="20"
              />
            </span>
            <span class="lark-doc-comment-more-title">{{ commentPrivateTitle }}</span>
            <button
              type="button"
              class="lark-doc-comment-switch"
              :class="{ 'is-on': ed.commentPrivate(item.id) }"
              role="switch"
              :aria-checked="ed.commentPrivate(item.id) ? 'true' : 'false'"
              :disabled="ed.commentRemote && !ed.commentAllowed('visibility', item.id)"
              @mousedown.prevent
              @click="ed.toggleCommentPrivate(item.id)"
            >
              <span
                class="lark-doc-comment-switch-handler"
                aria-hidden="true"
              />
            </button>
          </div>
          <p class="lark-doc-comment-more-hint">
            {{ commentPrivateHint }}
          </p>
          <div
            v-if="ed.commentRemote"
            class="lark-doc-comment-participants"
          >
            <button
              type="button"
              :disabled="!ed.commentFollowAllowed(item.id)"
              @mousedown.prevent
              @click="ed.changeCommentFollow(item.id, 'follow')"
            >
              {{ ed.commentFollowPreference(item.id) && ed.commentFollowPreference(item.id).following ? '取消关注' : '关注' }}
            </button>
            <button
              type="button"
              :disabled="!ed.commentFollowAllowed(item.id)"
              @mousedown.prevent
              @click="ed.changeCommentFollow(item.id, 'mute')"
            >
              {{ ed.commentFollowPreference(item.id) && ed.commentFollowPreference(item.id).muted ? '取消静音' : '静音' }}
            </button>
            <button
              type="button"
              :disabled="!ed.commentAllowed('participants', item.id)"
              :aria-expanded="String(ed.commentParticipantThread === item.id)"
              @click="openCommentParticipants(item.id)"
            >
              管理参与者
            </button>
            <section
              v-if="ed.commentParticipantThread === item.id"
              aria-label="评论参与者"
              class="lark-doc-comment-member-picker"
            >
              <div class="lark-doc-comment-member-chips">
                <span
                  v-for="person in ed.commentParticipantSelection"
                  :key="person.principalId"
                >{{ person.displayName }}<button
                  type="button"
                  :aria-label="`移除参与者 ${person.displayName}`"
                  :disabled="!ed.commentAllowed('participants', item.id)"
                  @click="removeCommentParticipant(person.principalId)"
                >×</button></span>
              </div>
              <input
                :value="ed.commentParticipantQuery"
                aria-label="搜索评论参与者"
                role="combobox"
                aria-autocomplete="list"
                :aria-controls="`comment-members-${item.id}`"
                :aria-expanded="String(ed.commentParticipantCandidates.length > 0)"
                :aria-activedescendant="ed.commentParticipantIndex >= 0 ? `comment-member-${item.id}-${ed.commentParticipantIndex}` : null"
                :disabled="!ed.commentAllowed('participants', item.id)"
                placeholder="搜索姓名"
                maxlength="128"
                @input="setCommentParticipantQuery($event.target.value)"
                @keydown="commentParticipantKeydown($event)"
              >
              <div
                :id="`comment-members-${item.id}`"
                role="listbox"
                aria-label="人员搜索结果"
                :aria-busy="String(ed.commentParticipantBusy)"
              >
                <button
                  v-for="(person, personIndex) in ed.commentParticipantCandidates"
                  :id="`comment-member-${item.id}-${personIndex}`"
                  :key="person.principalId"
                  type="button"
                  role="option"
                  :aria-selected="String(personIndex === ed.commentParticipantIndex)"
                  :disabled="!ed.commentAllowed('participants', item.id)"
                  @click="selectCommentParticipant(person)"
                >
                  {{ person.displayName }}
                </button>
              </div>
              <p role="status">
                {{ ed.commentParticipantBusy ? '正在搜索…' : ed.commentParticipantError || (!ed.commentParticipantCandidates.length ? '没有其他匹配人员' : '') }}
              </p>
              <div class="lark-doc-comment-member-actions">
                <button
                  type="button"
                  @click="ed.resetCommentParticipants()"
                >
                  取消
                </button><button
                  type="button"
                  :disabled="!ed.commentAllowed('participants', item.id)"
                  @click="openCommentParticipants(item.id)"
                >
                  重新加载
                </button><button
                  type="button"
                  :disabled="ed.commentParticipantBusy || !ed.commentAllowed('participants', item.id)"
                  @click="saveCommentParticipants(item.id)"
                >
                  保存
                </button>
              </div>
            </section>
          </div>
        </div>
      </div>
      <DocumentCommentComposer
        v-if="documentOnly"
        ref="documentComposer"
        :ed="ed"
      />
    </div>
    <div
      v-if="!documentOnly && (ed.commentImageBusy || ed.commentPendingImage)"
      class="lark-doc-comment-media-status"
      role="status"
    >
      <span>{{ ed.commentImageBusy ? '正在处理图片…' : '图片上传结果尚未确认' }}</span><button
        v-if="ed.commentImageBusy && ed.commentImageCanCancel()"
        type="button"
        @click="ed.cancelCommentImageUpload()"
      >
        取消上传
      </button><button
        v-if="ed.commentPendingImage"
        type="button"
        :disabled="ed.commentImageBusy || !ed.commentCan('canView')"
        @click="queryPendingCommentImage()"
      >
        查询原图片操作
      </button>
    </div>
    <div
      v-if="!documentOnly && ed.commentImageViewer"
      class="lark-doc-comment-image-backdrop"
      @click.self="ed.closeCommentImage(true)"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="评论图片预览"
        class="lark-doc-comment-image-viewer"
        @keydown.tab.prevent="ed.focusCommentImageClose()"
      >
        <button
          type="button"
          aria-label="关闭图片预览"
          @click="ed.closeCommentImage(true)"
        >
          ×
        </button>
        <img
          :src="ed.commentImageViewer.url"
          :alt="ed.commentImageViewer.fileName"
        >
        <p>{{ ed.commentImageViewer.fileName }}</p>
      </div>
    </div>
    <div
      v-if="!documentOnly && ed.commentReactionContext"
      class="lark-doc-comment-reaction-picker"
      :style="ed.commentFloatingMenuStyle(ed.commentReactionContext.position)"
      role="dialog"
      aria-label="添加表情回复"
      @mousedown.stop
      @keydown.stop
    >
      <div class="lark-doc-comment-reaction-picker-head">
        <input
          type="search"
          aria-label="搜索评论表情"
          placeholder="搜索表情"
          :value="ed.commentReactionQuery"
          @input="ed.setCommentReactionQuery($event.target.value)"
        >
        <button
          type="button"
          aria-label="关闭表情面板"
          @click="ed.closeCommentReaction(true)"
        >
          ×
        </button>
      </div>
      <div
        class="lark-doc-comment-reaction-tabs"
        role="tablist"
        aria-label="评论表情分类"
      >
        <button
          v-for="category in commentReactionCategories"
          :key="category"
          type="button"
          role="tab"
          :aria-selected="String(ed.commentReactionCategory === category)"
          @click="ed.setCommentReactionCategory(category)"
        >
          {{ category }}
        </button>
      </div>
      <div
        class="lark-doc-comment-reaction-grid"
        aria-label="可选表情"
      >
        <button
          v-for="emoji in commentReactionVisibleItems"
          :key="emoji.value"
          type="button"
          :aria-label="emoji.label"
          :title="emoji.label"
          @click="chooseCommentReaction(emoji.glyph)"
        >
          {{ emoji.glyph }}
        </button>
        <p v-if="!commentReactionItems.length">
          没有匹配的表情
        </p>
      </div>
      <button
        v-if="commentReactionItems.length > ed.commentReactionLimit"
        type="button"
        class="lark-doc-comment-reaction-more"
        @click="ed.showMoreCommentReactions()"
      >
        更多表情
      </button>
    </div>
  </div>
</template>

<script>
// 本地与远端复用同一侧栏；远端动作和私密可见性由Provider确认。
import LarkDocIcon from './LarkDocIcon.vue'
import DocumentCommentComposer from './DocumentCommentComposer.vue'
import CommentTextInput from './CommentTextInput.vue'
import { commentPanelComputed, commentPanelMethods, commentPanelClock } from './editor/commentPanelView'

export default {
  name: 'LarkDocCommentPanel',
  components: { LarkDocIcon, DocumentCommentComposer, CommentTextInput },
  mixins: [commentPanelClock],
  props: {
    ed: { type: Object, required: true },
    documentOnly: { type: Boolean, default: false },
  },
  computed: commentPanelComputed,
  methods: commentPanelMethods,
}
</script>


<style>
/* 面板专用样式与惰性组件一同加载；正文 mark 与主题 token 留在公共样式入口。 */
/* 层壳只为「多实例 v-for 有共同父节点」，用 display: contents 彻底退出布局
   （同修订面板，换成 absolute/0×0 反而要再给面板补 pointer-events: auto）。 */
.lark-doc .lark-doc-comment-layer { display: contents; }
.lark-doc .lark-doc-comments-root { display: contents; }


/* Nonmodal comments sit below the toolbar (20/34) and sticky titlebar (35).
   A child menu cannot escape those stacking contexts by increasing its own z-index. */
.lark-doc .lark-doc-comment-composer {
  position: fixed;
  z-index: 19;
  right: 16px;
  bottom: 16px;
  width: 270px;
  padding: 8px;
  border: 1px solid var(--ld-comment-border);
  border-radius: 6px;
  background: var(--ld-comment-surface);
  box-shadow: var(--ld-shadow-float);
}
.lark-doc .lark-doc-comment-composer textarea,
.lark-doc .lark-doc-comment-edit textarea { box-sizing: border-box; width: 100%; }
.lark-doc .lark-doc-comment-state { margin: 0; padding: 4px 12px; color: var(--ld-comment-time); font-size: 12px; }
.lark-doc .lark-doc-comment-edit,
.lark-doc .lark-doc-comment-participants { padding: 8px 12px; }
.lark-doc .lark-doc-comment-more-menu.is-remote { height: auto; }
.lark-doc .lark-doc-comment-member-picker { display: grid; gap: 8px; margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--ld-comment-border); }
.lark-doc .lark-doc-comment-member-picker input { box-sizing: border-box; width: 100%; min-width: 0; }
.lark-doc .lark-doc-comment-member-chips { display: flex; flex-wrap: wrap; gap: 4px; }
.lark-doc .lark-doc-comment-member-chips > span { display: inline-flex; align-items: center; max-width: 100%; padding-left: 6px; border-radius: 4px; background: var(--ld-bg-selected); overflow-wrap: anywhere; }
.lark-doc .lark-doc-comment-member-chips button { border: 0; background: transparent; }
.lark-doc .lark-doc-comment-member-picker [role="listbox"] { display: grid; max-height: 140px; overflow-y: auto; }
.lark-doc .lark-doc-comment-member-picker [role="option"] { width: 100%; text-align: left; }
.lark-doc .lark-doc-comment-member-picker [aria-selected="true"] { background: var(--ld-bg-selected); }
.lark-doc .lark-doc-comment-member-picker p { margin: 0; color: var(--ld-comment-time); font-size: 12px; }
.lark-doc .lark-doc-comment-member-actions { display: flex; justify-content: flex-end; gap: 4px; }
.lark-doc .lark-doc-comment-panel.is-remote .lark-doc-comment-replies { overflow-y: auto; min-height: 0; flex: 1 1 auto; }

/* 远端线程和新评论共用一列；短窗先缩小线程并滚动，不能互相盖住发送按钮。 */
.lark-doc .lark-doc-comment-layer.is-remote {
  position: fixed;
  z-index: 18;
  right: 16px;
  bottom: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 296px;
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 145px);
  overflow-y: auto;
  pointer-events: none;
  box-sizing: border-box;
  padding: 0 12px 12px;
  border-left: 1px solid var(--ld-comment-border);
  background: var(--ld-comment-surface);
}
.lark-doc .lark-doc-comment-layer.is-remote > .lark-doc-comment-composer {
  position: relative;
  z-index: auto;
  right: auto;
  bottom: auto;
  order: 0;
  flex: 0 0 auto;
  width: 100%;
  max-height: 45vh;
  overflow: auto;
  pointer-events: auto;
}
.lark-doc .lark-doc-comment-layer.is-remote > .lark-doc-comment-panel {
  position: relative;
  z-index: auto;
  flex: 0 0 auto;
  min-height: 0;
  width: 100%;
  pointer-events: auto;
}
.lark-doc .lark-doc-comment-sidebar-head { position: sticky; top: 0; z-index: 1; display: flex; align-items: center; gap: 8px; min-height: 44px; font-size: 14px; background: var(--ld-comment-surface); pointer-events: auto; }
.lark-doc .lark-doc-comment-sidebar-head > span { flex: 1; }
.lark-doc .lark-doc-comment-sidebar-head button,
.lark-doc .lark-doc-comment-cancel-empty,
.lark-doc .lark-doc-comment-reply-placeholder { border: 0; background: transparent; color: var(--ld-comment-quote); cursor: pointer; font: inherit; }
.lark-doc .lark-doc-comment-reply-placeholder { padding: 12px; text-align: left; }
.lark-doc .lark-doc-comment-composer.is-selection,
.lark-doc .lark-doc-comment-panel.is-remote.is-active { border-top: 4px solid var(--ld-cat-yellow); }
.lark-doc .lark-doc-comment-composer-author { display: flex; align-items: center; gap: 8px; margin: 8px 0 20px; font-size: 12px; color: var(--ld-comment-name); }
.lark-doc .lark-doc-comment-compose-actions { display: flex; justify-content: flex-end; align-items: center; gap: 8px; margin-top: 8px; }
.lark-doc .lark-doc-comment-compose-actions label { margin-right: auto; font-size: 12px; }
.lark-doc .lark-doc-comment-feedback { padding: 8px; font-size: 12px; pointer-events: auto; }
.lark-doc .lark-doc-comment-layer.is-document { display: flex; position: relative; flex-direction: column; width: min(870px, calc(100% - 48px)); margin: 0 auto 48px; gap: 12px; }
.lark-doc .lark-doc-comment-layer.is-document > .lark-doc-comment-composer { position: relative; order: 1; right: auto; bottom: auto; width: 100%; box-sizing: border-box; box-shadow: none; }
.lark-doc .lark-doc-comment-panel.is-document { position: relative; width: 100%; box-shadow: none; }
.lark-doc .lark-doc-comment-panel.is-document .lark-doc-comment-state { display: none; }
.lark-doc .lark-doc-comment-panel.is-document .lark-doc-comment-reply-main { width: 100%; }
.lark-doc .lark-doc-comment-panel.is-document .lark-doc-comment-reply-right,
.lark-doc .lark-doc-comment-panel.is-document .lark-doc-comment-body { width: auto; flex: 1; }
.lark-doc .lark-doc-comment-panel.is-remote .lark-doc-comment-avatar,
.lark-doc .lark-doc-comment-composer .lark-doc-comment-avatar { background: var(--ld-comment-switch-on); color: var(--ld-comment-surface); font-size: 12px; }
.lark-doc .lark-doc-comment-composer .lark-doc-comment-input-zone { width: 100%; min-height: 32px; }
.lark-doc .lark-doc-comment-panel.is-document .lark-doc-comment-input-zone { width: calc(100% - 32px); }
@media (min-width: 1000px) { .lark-doc.lark-doc-comments-open .lark-doc-body { padding-right: 312px; box-sizing: border-box; } }

.lark-doc .lark-doc-comment-panel {
  position: fixed;
  z-index: 18;
  box-sizing: border-box;
  display: flex;
  width: 270px;
  flex-direction: column;
  border: 1px solid var(--ld-comment-border);
  border-radius: 6px;
  background: var(--ld-comment-surface);
  box-shadow: var(--ld-shadow-float);
}

/* —— 引用头 268 × 35 —— */
.lark-doc .lark-doc-comment-head {
  box-sizing: border-box;
  display: flex;
  width: 100%;
  height: 35px;
  min-height: 35px;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
}
.lark-doc .lark-doc-comment-quote {
  min-width: 0;
  flex: 1 1 auto;
  color: var(--ld-comment-quote);
  font-size: 12px;
  line-height: 20px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* 控件组 97 × 26：六格 = 16+16+1+16+16+18 = 83，余量做间隙。 */
.lark-doc .lark-doc-comment-controls {
  box-sizing: border-box;
  display: flex;
  width: 97px;
  min-width: 97px;
  height: 26px;
  align-items: center;
  justify-content: flex-end;
  padding: 0 5px;
  gap: 2px;
}
.lark-doc .lark-doc-comment-cell { display: inline-flex; min-width: 0; }
.lark-doc .lark-doc-comment-split {
  width: 1px;
  min-width: 1px;
  height: 16px;
  flex: 0 0 1px;
  background: var(--ld-border);
}
.lark-doc .lark-doc-comment-btn {
  box-sizing: border-box;
  display: grid;
  width: 16px;
  min-width: 16px;
  height: 16px;
  min-height: 16px;
  padding: 0;
  place-items: center;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--ld-text-secondary);
  line-height: 1;
  cursor: pointer;
}
.lark-doc .lark-doc-comment-btn:hover:not(:disabled),
.lark-doc .lark-doc-comment-btn:focus-visible:not(:disabled) { background: var(--ld-bg-hover-menu); outline: 0; }
/* 解决按钮是头部的主色项（04 §3.1④ 单独列了 icon 14×14 @13×13）。 */
.lark-doc .lark-doc-comment-btn.is-primary { color: var(--ld-text-accent); }
/* 无权限 / 到头：置灰但**保留 pointer-events**，点下去由 mixin 的闸门直接 return。 */
.lark-doc .lark-doc-comment-btn.is-disabled { color: var(--ld-text-disabled); cursor: not-allowed; }
/* 「更多」的三点省略号：图标库没有该字形，用径向渐变画三粒 1px 点（同 sheet-handle 的六点做法）。 */
.lark-doc .lark-doc-comment-dots {
  width: 12px;
  height: 12px;
  background-image: radial-gradient(circle, currentColor 1px, transparent 1.1px);
  background-size: 4px 12px;
}

/* —— 回复流：每条 268 × 61 —— */
.lark-doc .lark-doc-comment-replies { box-sizing: border-box; width: 100%; }
.lark-doc .lark-doc-comment-reply {
  position: relative;
  box-sizing: border-box;
  display: flex;
  width: 100%;
  min-height: 61px;
  align-items: flex-start;
  padding: 6px 12px;
}
/* main 244 × 49 = 头像 32 + gap 12 + 右列 200。 */
.lark-doc .lark-doc-comment-reply-main {
  box-sizing: border-box;
  display: flex;
  width: 244px;
  min-width: 0;
  align-items: flex-start;
  gap: 12px;
}
.lark-doc .lark-doc-comment-avatar {
  display: grid;
  width: 32px;
  min-width: 32px;
  height: 32px;
  place-items: center;
  border-radius: 50%;
  background: var(--ld-text-disabled);
  color: var(--ld-comment-surface);
  overflow: hidden;
}
.lark-doc .lark-doc-comment-reply-right {
  display: flex;
  width: 200px;
  min-width: 0;
  flex-direction: column;
}
.lark-doc .lark-doc-comment-info {
  display: flex;
  height: 17px;
  align-items: center;
  gap: 6px;
}
.lark-doc .lark-doc-comment-name {
  color: var(--ld-comment-name);
  font-size: 12px;
  line-height: 17px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.lark-doc .lark-doc-comment-time {
  color: var(--ld-comment-time);
  font-size: 12px;
  line-height: 17px;
  white-space: nowrap;
}
/* 正文 200 × 28（单行 22）：17 + 4 + 28 = 49。 */
.lark-doc .lark-doc-comment-body {
  min-height: 28px;
  margin-top: 4px;
  color: var(--ld-text);
  font-size: 14px;
  line-height: 22px;
  word-break: break-word;
}
/* hover 三按钮 14×14、步进 25（= 14 + 间隙 11），紧贴信息行右端。 */
.lark-doc .lark-doc-comment-reply-controls {
  position: absolute;
  top: 7px;
  right: 12px;
  display: flex;
  gap: 11px;
  opacity: 0;
  transition: opacity .12s linear;
}
.lark-doc .lark-doc-comment-reply:hover .lark-doc-comment-reply-controls,
.lark-doc .lark-doc-comment-reply-controls:focus-within { opacity: 1; }
.lark-doc .lark-doc-comment-icon-btn {
  box-sizing: border-box;
  display: grid;
  width: 14px;
  min-width: 14px;
  height: 14px;
  min-height: 14px;
  padding: 0;
  place-items: center;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--ld-comment-time);
  cursor: pointer;
}
.lark-doc .lark-doc-comment-icon-btn:hover:not(:disabled) { background: var(--ld-bg-hover-menu); color: var(--ld-text-secondary); }

/* —— B 套「更多」：152 × 134，项 144 × 30 × 4 —— */
.lark-doc .lark-doc-comment-reply-menu {
  position: absolute;
  top: 34px;
  right: 4px;
  z-index: 1041;
  box-sizing: border-box;
  width: 152px;
  height: 134px;
  padding: 7px 4px;
  border: 1px solid var(--ld-comment-border);
  border-radius: 6px;
  background: var(--ld-comment-surface);
  box-shadow: var(--ld-shadow-float);
}
.lark-doc .lark-doc-comment-menu-list { margin: 0; padding: 0; list-style: none; }
.lark-doc .lark-doc-comment-menu-item {
  box-sizing: border-box;
  display: flex;
  width: 144px;
  height: 30px;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px;
  border-radius: 4px;
  color: var(--ld-text);
  font-size: 14px;
  line-height: 30px;
  cursor: pointer;
}
.lark-doc .lark-doc-comment-menu-item:hover { background: var(--ld-bg-hover-menu); }
.lark-doc .lark-doc-comment-menu-item[aria-disabled="true"] { color: var(--ld-text-disabled); background: transparent; cursor: not-allowed; }
.lark-doc .lark-doc-comment-menu-label {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.lark-doc .lark-doc-comment-menu-arrow { transform: rotate(-90deg); color: var(--ld-text-icon-tertiary); }

/* —— 输入区 268 × 58（输入中 98）= 输入行 26 + gap 4 + 按钮行 28 —— */
.lark-doc .lark-doc-comment-textarea {
  box-sizing: border-box;
  display: flex;
  width: 100%;
  min-height: 58px;
  flex-direction: column;
  padding: 0 12px;
  gap: 4px;
}
/* 输入行：外壳 193 × 26 + 配图按钮 27 × 16，两端对齐吃掉余下的 24。 */
.lark-doc .lark-doc-comment-input {
  display: flex;
  width: 100%;
  min-height: 26px;
  flex: 1 1 auto;
  align-items: center;
  justify-content: space-between;
}
.lark-doc .lark-doc-comment-input-zone {
  box-sizing: border-box;
  width: 193px;
  height: 100%;
  min-height: 22px;
  padding: 0 6px;
  border: 1px solid var(--ld-border);
  border-radius: 4px;
  background: var(--ld-comment-surface);
  color: var(--ld-text);
  font: inherit;
  font-size: 14px;
  line-height: 22px;
  resize: none;
}
.lark-doc .lark-doc-comment-input-zone:focus-visible { border-color: var(--ld-brand-chrome); outline: 0; }
/* 无 canComment：照挂、置灰、可读（readonly 而非 disabled —— 后者会把焦点整个摘掉）。 */
.lark-doc .lark-doc-comment-input-zone:read-only { color: var(--ld-text-disabled); cursor: not-allowed; }
.lark-doc .lark-doc-comment-operation {
  box-sizing: border-box;
  display: grid;
  width: 27px;
  min-width: 27px;
  height: 16px;
  padding: 0;
  place-items: center;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--ld-comment-time);
  cursor: pointer;
}
.lark-doc .lark-doc-comment-operation:hover:not(:disabled) { background: var(--ld-bg-hover-menu); color: var(--ld-text-secondary); }
/* 底部按钮组 96 × 28 = 48 + 8 + 48。 */
.lark-doc .lark-doc-comment-actions {
  display: flex;
  height: 28px;
  min-height: 28px;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}
.lark-doc .lark-doc-comment-action {
  box-sizing: border-box;
  width: 48px;
  height: 28px;
  border-radius: 4px;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
}
.lark-doc .lark-doc-comment-action.is-outlined {
  border: 1px solid var(--ld-border);
  background: transparent;
  color: var(--ld-text-secondary);
}
.lark-doc .lark-doc-comment-action.is-filled {
  border: 1px solid var(--ld-brand-chrome);
  background: var(--ld-brand-chrome);
  color: var(--ld-text-on-brand);
}
.lark-doc .lark-doc-comment-action.is-disabled { color: var(--ld-text-disabled); cursor: not-allowed; }

/* —— A 套「更多」：278 × 92 / z 1050，只有「私有评论」一个开关项 —— */
.lark-doc .lark-doc-comment-more-menu {
  position: absolute;
  top: 35px;
  right: -4px;
  z-index: 1050;
  box-sizing: border-box;
  width: 278px;
  height: 92px;
  padding: 2px 0;
  border: 1px solid var(--ld-comment-border);
  border-radius: 6px;
  background: var(--ld-comment-surface);
  box-shadow: var(--ld-shadow-float);
}
/* 开关行 276 × 32：图标 20 + 标题 192（pad-left 12）+ 开关 40 × 22。 */
.lark-doc .lark-doc-comment-more-row {
  box-sizing: border-box;
  display: flex;
  width: 276px;
  height: 32px;
  align-items: center;
  padding: 10px 10px 0 14px;
}
.lark-doc .lark-doc-comment-more-icon {
  display: grid;
  width: 20px;
  min-width: 20px;
  height: 20px;
  place-items: center;
  color: var(--ld-comment-time);
}
.lark-doc .lark-doc-comment-more-title {
  width: 192px;
  min-width: 0;
  margin-left: 12px;
  color: var(--ld-comment-name);
  font-size: 14px;
  line-height: 20px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.lark-doc .lark-doc-comment-switch {
  box-sizing: border-box;
  display: flex;
  width: 40px;
  min-width: 40px;
  height: 22px;
  align-items: center;
  padding: 1px 2px;
  border: 0;
  border-radius: 11px;
  background: var(--ld-comment-switch-off);
  cursor: pointer;
}
.lark-doc .lark-doc-comment-switch.is-on { background: var(--ld-comment-switch-on); }
/* handler 18 × 18，滑程 18（关 x=1422 → 开 x=1440）。 */
.lark-doc .lark-doc-comment-switch-handler {
  display: block;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--ld-comment-handler);
  transition: transform .12s linear;
}
.lark-doc .lark-doc-comment-switch.is-on .lark-doc-comment-switch-handler { transform: translateX(18px); }
/* 说明文字 276 × 54：pad-left 46 = 图标 20 + 12 + 14，与标题对齐。 */
.lark-doc .lark-doc-comment-more-hint {
  box-sizing: border-box;
  width: 276px;
  height: 54px;
  margin: 0;
  padding: 6px 10px 8px 46px;
  color: var(--ld-comment-time);
  font-size: 12px;
  line-height: 20px;
}


.lark-doc .lark-doc-comment-body { white-space: pre-wrap; }
.lark-doc .lark-doc-comment-reactions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.lark-doc .lark-doc-comment-reaction { display: inline-flex; align-items: center; gap: 5px; min-height: 25px; padding: 1px 8px; border: 1px solid var(--ld-border); border-radius: 14px; background: var(--ld-bg-surface); color: var(--ld-text-secondary); cursor: pointer; font-size: 12px; }
.lark-doc .lark-doc-comment-reaction[aria-pressed="true"] { color: var(--ld-brand-chrome); border-color: var(--ld-brand-chrome); background: var(--ld-bg-accent); }
.lark-doc .lark-doc-comment-reaction:disabled { cursor: default; }
.lark-doc .lark-doc-comment-reaction-picker { box-sizing: border-box; z-index: 1160; width: min(328px, calc(100vw - 16px)); padding: 12px; border: 1px solid var(--ld-border); border-radius: 8px; background: var(--ld-bg-surface); color: var(--ld-text); box-shadow: var(--ld-shadow-menu); }
.lark-doc .lark-doc-comment-reaction-picker-head { display: flex; gap: 8px; }
.lark-doc .lark-doc-comment-reaction-picker-head input { min-width: 0; flex: 1; height: 30px; padding: 0 8px; border: 1px solid var(--ld-border); border-radius: 4px; background: var(--ld-bg-surface); color: inherit; }
.lark-doc .lark-doc-comment-reaction-picker-head button { border: 0; background: transparent; color: var(--ld-text-secondary); cursor: pointer; font-size: 20px; }
.lark-doc .lark-doc-comment-reaction-tabs { display: flex; gap: 5px; overflow-x: auto; margin: 10px 0; }
.lark-doc .lark-doc-comment-reaction-tabs button { flex: 0 0 auto; padding: 4px 6px; border: 0; border-radius: 4px; background: transparent; color: var(--ld-text-secondary); cursor: pointer; }
.lark-doc .lark-doc-comment-reaction-tabs button[aria-selected="true"] { color: var(--ld-brand-chrome); background: var(--ld-bg-accent); }
.lark-doc .lark-doc-comment-reaction-grid { display: grid; grid-template-columns: repeat(8, minmax(0, 1fr)); gap: 2px; max-height: 210px; overflow-y: auto; }
.lark-doc .lark-doc-comment-reaction-grid button { height: 34px; border: 0; border-radius: 4px; background: transparent; cursor: pointer; font-size: 22px; }
.lark-doc .lark-doc-comment-reaction-grid button:hover, .lark-doc .lark-doc-comment-reaction-grid button:focus-visible { background: var(--ld-bg-accent); }
.lark-doc .lark-doc-comment-reaction-grid p { grid-column: 1 / -1; font-size: 12px; color: var(--ld-text-secondary); }
.lark-doc .lark-doc-comment-reaction-more { display: block; width: 100%; margin-top: 8px; padding: 5px; border: 0; background: transparent; color: var(--ld-brand-chrome); cursor: pointer; }

.lark-doc .lark-doc-comment-images, .lark-doc .lark-doc-comment-image-drafts { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0; }
.lark-doc .lark-doc-comment-images button { display: inline-flex; justify-content: center; align-items: center; max-width: 100%; min-width: 72px; min-height: 54px; padding: 0; overflow: hidden; border: 1px solid var(--ld-border); border-radius: 4px; background: var(--ld-bg-hover); color: var(--ld-text-secondary); cursor: pointer; }
.lark-doc .lark-doc-comment-images img { display: block; max-width: 220px; max-height: 180px; object-fit: contain; }
.lark-doc .lark-doc-comment-images span { padding: 8px; font-size: 12px; }
.lark-doc .lark-doc-comment-image-drafts > div { position: relative; display: inline-flex; align-items: center; width: 64px; height: 64px; border: 1px solid var(--ld-border); border-radius: 4px; background: var(--ld-bg-hover); }
.lark-doc .lark-doc-comment-image-drafts img { width: 100%; height: 100%; object-fit: cover; border-radius: 4px; }
.lark-doc .lark-doc-comment-image-drafts span { overflow: hidden; padding: 4px; font-size: 11px; overflow-wrap: anywhere; }
.lark-doc .lark-doc-comment-image-drafts button { position: absolute; top: -6px; right: -6px; width: 19px; height: 19px; padding: 0; border: 1px solid var(--ld-border); border-radius: 50%; color: var(--ld-text-secondary); background: var(--ld-bg-surface); cursor: pointer; }
.lark-doc .lark-doc-comment-media-status { position: fixed; z-index: 1170; right: 16px; bottom: 16px; display: flex; gap: 8px; align-items: center; padding: 10px 14px; border: 1px solid var(--ld-border); border-radius: 6px; color: var(--ld-text-secondary); background: var(--ld-bg-surface); box-shadow: var(--ld-shadow-menu); font-size: 12px; }
.lark-doc .lark-doc-comment-media-status button { border: 0; background: transparent; color: var(--ld-text-accent); cursor: pointer; }
.lark-doc .lark-doc-comment-image-backdrop { position: fixed; z-index: 2000; inset: 0; display: flex; align-items: center; justify-content: center; padding: 32px; background: var(--ld-mask); }
.lark-doc .lark-doc-comment-image-viewer { position: relative; max-width: 100%; max-height: 100%; padding: 16px; border-radius: 8px; background: var(--ld-bg-surface); color: var(--ld-text); }
.lark-doc .lark-doc-comment-image-viewer > button { position: absolute; right: 4px; top: 0; border: 0; background: var(--ld-bg-surface); color: var(--ld-text-secondary); cursor: pointer; font-size: 24px; }
.lark-doc .lark-doc-comment-image-viewer > img { display: block; max-width: calc(100vw - 96px); max-height: calc(100vh - 150px); object-fit: contain; }
.lark-doc .lark-doc-comment-image-viewer > p { max-width: calc(100vw - 96px); margin: 8px 0 0; overflow-wrap: anywhere; font-size: 12px; }

/* 全文评论是正文页内平铺流：不继承选区侧栏的卡片、引用头与逐线程输入。 */
.lark-doc .lark-doc-comments-root.is-document-root { display: block; box-sizing: border-box; width: min(100%, 870px); margin: 0 auto; padding: 0 24px 30px; border: 1px solid var(--ld-border-paper); border-top: 0; background: var(--ld-bg-content); }
.lark-doc.lark-doc-width-wide .lark-doc-comments-root.is-document-root { width: min(100%, 1140px); }
.lark-doc.lark-doc-width-full .lark-doc-comments-root.is-document-root { width: 100%; }
.lark-doc .lark-doc-comment-layer.is-document { width: 100%; margin: 0; gap: 0; }
.lark-doc .lark-doc-comment-layer.is-document > .lark-doc-comment-sidebar-head { box-sizing: border-box; height: auto; min-height: 0; padding: 0 0 5px; margin: 0 0 8px; border-bottom: 1px solid var(--ld-comment-border); font-size: 24px; line-height: 40.32px; font-weight: 500; }
.lark-doc .lark-doc-comment-layer.is-document .lark-doc-comment-panel { position: relative; z-index: auto; width: 100%; padding: 0; border: 0; border-radius: 0; box-shadow: none; background: transparent; }
.lark-doc .lark-doc-comment-panel.is-document .lark-doc-comment-reply { min-height: 78px; padding: 12px; border-radius: 6px; }
.lark-doc .lark-doc-comment-panel.is-document .lark-doc-comment-reply:hover,
.lark-doc .lark-doc-comment-panel.is-document .lark-doc-comment-reply:focus-within { background: var(--ld-comment-row-hover); }
.lark-doc .lark-doc-comment-panel.is-document .lark-doc-comment-reply-main { width: 100%; }
.lark-doc .lark-doc-comment-panel.is-document .lark-doc-comment-info { height: 22px; line-height: 22px; }
.lark-doc .lark-doc-comment-panel.is-document .lark-doc-comment-name,
.lark-doc .lark-doc-comment-panel.is-document .lark-doc-comment-time { font-size: 14px; line-height: 22px; }
.lark-doc .lark-doc-comment-panel.is-document .lark-doc-comment-reply-controls { top: 16px; right: 12px; }
.lark-doc .lark-doc-comment-panel.is-document .lark-doc-comment-icon-btn { position: relative; }
.lark-doc .lark-doc-comment-panel.is-document .lark-doc-comment-icon-btn:hover:not(:disabled) { color: var(--ld-brand-chrome); background: transparent; }
.lark-doc .lark-doc-comment-panel.is-document [data-tooltip]:hover::after,
.lark-doc .lark-doc-comment-panel.is-document [data-tooltip]:focus-visible::after { content: attr(data-tooltip); position: absolute; z-index: 1042; bottom: calc(100% + 12px); left: 50%; padding: 8px 12px; border-radius: 8px; color: var(--ld-text-inverse); background: var(--ld-bg-tooltip); font-size: 12px; font-weight: 400; line-height: 20px; white-space: nowrap; transform: translateX(-50%); pointer-events: none; }
.lark-doc .lark-doc-comment-panel.is-document [data-tooltip]:hover::before,
.lark-doc .lark-doc-comment-panel.is-document [data-tooltip]:focus-visible::before { content: ''; position: absolute; z-index: 1042; bottom: calc(100% + 4px); left: 50%; border: 4px solid transparent; border-top-color: var(--ld-bg-tooltip); transform: translateX(-50%); pointer-events: none; }
.lark-doc .lark-doc-comment-layer.is-document > .lark-doc-document-composer { margin-top: 24px; }
@media (max-width: 760px) { .lark-doc .lark-doc-comments-root.is-document-root { padding-inline: 12px; } }

/* 面板主题色与本组件同步加载，保证首次暗色渲染。 */
.lark-doc[data-theme-preset="feishu"][data-theme="dark"] {
  --ld-comment-surface: var(--ld-bg-surface);
  --ld-comment-border: var(--ld-border);
  --ld-comment-name: var(--ld-text);
  --ld-comment-quote: var(--ld-text-secondary);
  --ld-comment-time: var(--ld-text-tertiary);
  --ld-comment-switch-off: var(--ld-bg-switch-off);
}
</style>
