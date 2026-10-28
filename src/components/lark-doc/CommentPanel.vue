<template>
  <div
    v-if="ed.commentPanels.length"
    class="lark-doc-comment-layer"
  >
    <div
      v-for="item in ed.commentPanels"
      :key="item.id"
      class="lark-doc-comment-panel"
      role="dialog"
      :aria-label="ed.commentPanelTitle"
      :style="[ed.commentPanelStyle(item), { height: `${ed.commentPanelHeightOf(item)}px` }]"
      @mousedown="ed.activateComment(item.id)"
    >
      <!-- 引用头 268×35：左侧引用原文（fs12、单行截断），右侧控件组 97×26。 -->
      <div class="lark-doc-comment-head">
        <span class="lark-doc-comment-quote">{{ ed.commentQuoteOf(item) }}</span>
        <div class="lark-doc-comment-controls">
          <span
            v-for="btn in ed.commentControls"
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
                'is-disabled': ed.commentControlDisabled(btn.id, item.id),
              }"
              :aria-label="btn.label"
              @mousedown.prevent="ed.runCommentControl(btn.id, item.id)"
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
              <LarkDocIcon
                name="rev-avatar"
                :size="18"
              />
            </span>
            <div class="lark-doc-comment-reply-right">
              <div class="lark-doc-comment-info">
                <span class="lark-doc-comment-name">{{ ed.commentAuthorName(reply.author) }}</span>
                <span class="lark-doc-comment-time">{{ ed.commentTimeAt(reply.createdAt) }}</span>
              </div>
              <div class="lark-doc-comment-body">
                {{ reply.content }}
              </div>
            </div>
          </div>
          <!-- hover 三按钮 14×14 / 步进 25，紧贴信息行右端（04 §3.1④-2）。 -->
          <div class="lark-doc-comment-reply-controls">
            <button
              v-for="ctl in ed.commentReplyControls"
              :key="ctl.id"
              type="button"
              class="lark-doc-comment-icon-btn"
              :aria-label="ctl.label"
              @mousedown.prevent="ed.runCommentReplyControl(ctl.id, item.id, reply.id)"
            >
              <LarkDocIcon
                v-if="ctl.icon"
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
          >
            <ul class="lark-doc-comment-menu-list">
              <template v-for="menu in ed.commentMenuItems">
                <li
                  v-if="ed.commentMenuVisible(menu, reply)"
                  :key="menu.id"
                  class="lark-doc-comment-menu-item"
                  @mousedown.prevent="ed.runCommentMenuItem(menu.id, item.id, reply.id)"
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
      <!-- 输入区 268×58（输入中 98）：外壳 193×26 + 配图 27×16，有字才浮出底部按钮组。 -->
      <div
        class="lark-doc-comment-textarea"
        :style="{ height: `${ed.commentTextareaHeight(item)}px` }"
      >
        <div class="lark-doc-comment-input">
          <textarea
            class="lark-doc-comment-input-zone"
            :value="ed.commentDraftOf(item.id)"
            :readonly="!ed.commentAllowed('reply')"
            aria-label="回复"
            @input="ed.setCommentDraft(item.id, $event.target.value)"
          />
          <button
            type="button"
            class="lark-doc-comment-operation"
            aria-label="插入图片"
            @mousedown.prevent
          >
            <LarkDocIcon
              name="rev-image"
              :size="16"
            />
          </button>
        </div>
        <div
          v-if="ed.commentHasDraft(item.id)"
          class="lark-doc-comment-actions"
        >
          <button
            type="button"
            class="lark-doc-comment-action is-outlined"
            @mousedown.prevent="ed.clearCommentDraft(item.id)"
          >
            取消
          </button>
          <button
            type="button"
            class="lark-doc-comment-action is-filled"
            :class="{ 'is-disabled': !ed.commentAllowed('reply') }"
            @mousedown.prevent="ed.submitCommentDraft(item.id)"
          >
            发送
          </button>
        </div>
      </div>
      <!-- A 套「更多」：278×112 / z 1050，里头只有「私有评论」一个开关项。 -->
      <div
        v-if="ed.commentMoreThreadId === item.id"
        class="lark-doc-comment-more-menu"
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
          <span class="lark-doc-comment-more-title">{{ ed.commentPrivateTitle }}</span>
          <button
            type="button"
            class="lark-doc-comment-switch"
            :class="{ 'is-on': ed.commentPrivate(item.id) }"
            role="switch"
            :aria-checked="ed.commentPrivate(item.id) ? 'true' : 'false'"
            @mousedown.prevent="ed.toggleCommentPrivate(item.id)"
          >
            <span
              class="lark-doc-comment-switch-handler"
              aria-hidden="true"
            />
          </button>
        </div>
        <p class="lark-doc-comment-more-hint">
          {{ ed.commentPrivateHint }}
        </p>
      </div>
    </div>
  </div>
</template>

<script>
// CommentPanel —— 评论线程面板（P6b-01，规格见 requirements/04 §3.1、05 §5.5）。
//
// 五条实测负结论，别「补全」：
//   1. **两套「更多」不合并**：面板头是 278×112 / z-index 1050、内容只有「私有评论」
//      开关；回复行是 152×134 的四项菜单（编辑 / 翻译为简体中文 / 删除 / 举报）。尺寸、
//      层级、内容都不同，④-3 与 ⑤ 两次点名不要做成同一个组件。
//   2. **`⌘+Enter` 不提交**（⑤ 实测 batch152/153）：草稿只有「点发送」一条出口，所以
//      本面板不绑任何 keydown 提交，textarea 上也不加 `@keydown.enter.meta`。
//   3. **删除无二次确认、无 `delete-item` 红字变体**（④-3 B）：危险项在飞书就是普通
//      菜单项，别自作主张加弹窗或改红。
//   4. **面板头「更多」里没有删除 / 解决 / 重开**：🔴 修正历史记录明确了，「解决」是头部
//      独立按钮，`删除` 在回复行菜单里。
//   5. **无权限是置灰而不是隐藏**：按钮照挂，加 `is-disabled`（色 `--ld-text-disabled`、
//      `cursor: not-allowed`、保留 pointer-events），点下去由 mixin 的闸门直接 return。
//
// 交互一律 `@mousedown.prevent`：点面板不能把焦点让给 body，否则编辑器选区掉了，
// 紧跟着的「解决 / 发送」就没有上下文可操作。textarea 是唯一例外（它要拿到焦点）。
import LarkDocIcon from './LarkDocIcon.vue'

export default {
  name: 'LarkDocCommentPanel',
  components: { LarkDocIcon },
  props: {
    ed: { type: Object, required: true },
  },
}
</script>
