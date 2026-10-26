<template>
  <div
    v-if="ed.revisionPanels.length"
    class="lark-doc-revision-layer"
  >
    <div
      v-for="item in ed.revisionPanels"
      :key="item.revisionId"
      class="lark-doc-revision-panel"
      :class="{ 'is-readonly': ed.revisionReadonly }"
      role="dialog"
      :aria-label="ed.revisionPanelTitle"
      :style="[ed.revisionPanelStyle(item), { height: `${ed.revisionPanelBoxHeight(item)}px` }]"
      @mouseenter="ed.enterRevisionPanel(item.revisionId)"
      @mouseleave="ed.leaveRevisionPanel()"
    >
      <!-- 头部 268×32（pad 8px 12px 0）：左侧恒「修订建议」，右侧六按钮 115×26。 -->
      <div class="lark-doc-revision-head">
        <span class="lark-doc-revision-label">{{ ed.revisionPanelTitle }}</span>
        <div class="lark-doc-revision-controls">
          <span
            v-for="btn in ed.revisionButtons"
            :key="btn.id"
            class="lark-doc-revision-cell"
          >
            <span
              v-if="btn.split"
              class="lark-doc-revision-split"
              aria-hidden="true"
            />
            <button
              v-else
              type="button"
              class="lark-doc-revision-btn"
              :class="{ 'is-reject': btn.tone === 'danger', 'is-accept': btn.tone === 'success' }"
              :aria-label="btn.tooltip"
              :disabled="ed.revisionButtonDisabled(btn.id, item.revisionId)"
              @mousedown.prevent="ed.runRevisionButton(btn.id, item.revisionId)"
            >
              <LarkDocIcon
                :name="btn.icon"
                :size="btn.iconSize"
              />
            </button>
          </span>
        </div>
      </div>
      <!-- 回复卡 268×83（pad 6px 12px）：头像 32 + 右列 200（信息行 17 / 正文区 50）。 -->
      <div class="lark-doc-revision-reply">
        <span
          class="lark-doc-revision-avatar"
          aria-hidden="true"
        >
          <LarkDocIcon
            name="rev-avatar"
            :size="18"
          />
        </span>
        <div class="lark-doc-revision-main">
          <div class="lark-doc-revision-meta">
            <span class="lark-doc-revision-author">{{ ed.revisionAuthorName(item.author) }}</span>
            <span class="lark-doc-revision-time">刚刚 （编辑过）</span>
          </div>
          <div class="lark-doc-revision-body">
            <b>{{ ed.revisionSummaryOf(item).label }}：</b>“{{ ed.revisionSummaryOf(item).text }}”
          </div>
        </div>
      </div>
      <!-- 激活态多 32px：输入占位 + 配图按钮（07 §12.3 三态高度 169）。
           P6b-05：read 态不展开 —— 面板是只读展示，不能给一个提交不了的输入框。 -->
      <div
        v-if="ed.revisionPanelActive(item) && !ed.revisionReadonly"
        class="lark-doc-revision-input"
      >
        <div
          class="lark-doc-revision-input-zone"
          role="textbox"
          aria-label="回复"
          tabindex="0"
        >
          回复...
        </div>
        <button
          type="button"
          class="lark-doc-revision-input-btn"
          aria-label="插入图片"
          @mousedown.prevent
        >
          <LarkDocIcon
            name="rev-image"
            :size="16"
          />
        </button>
      </div>
    </div>
  </div>
</template>

<script>
// RevisionPanel —— 修订建议面板（P4-06 ③，规格见 requirements/07 §12.3 / §12.4）。
//
// 四条实测负结论，别「补全」：
//   1. **没有 more-btn、没有「已解决」**（§12.6）—— 修订建议不是评论。
//   2. 六按钮**不写 `title` / `data-tooltip`**（§12.4）：飞书那层气泡是组件画的，
//      浏览器原生 title 会多出一层灰底气泡，位置还错。
//   3. 顺序**不可颠倒**：拒绝（红叉）在左、接受（绿勾）在右。
//   4. 头部标签文案恒为「修订建议」，不随新增 / 删除变（只有正文区前缀变）。
//
// P6b-05：read 态（阅读 / 演示 / 协同只读）下面板**只读展示** —— 面板本身不隐藏，
// 接受 / 拒绝靠既有 `:disabled` 通路置灰（色走 `--ld-text-disabled`），输入区不展开。
// 判断一律读 `ed.revisionReadonly`（= `interactionMode === 'read'`），本组件不自判权限。
//
// 行一律 `@mousedown.prevent`：点面板不能把焦点让给 body，否则编辑器选区掉了，
// 紧跟着的「接受 / 拒绝」就没有上下文可操作。
import LarkDocIcon from '../LarkDocIcon.vue'

export default {
  name: 'LarkDocRevisionPanel',
  components: { LarkDocIcon },
  props: {
    ed: { type: Object, required: true },
  },
}
</script>
