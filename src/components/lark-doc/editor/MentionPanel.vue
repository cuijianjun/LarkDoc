<template>
  <div
    v-if="ed.mentionOpen"
    class="lark-doc-mention-panel"
    role="dialog"
    aria-label="提及"
    :style="ed.mentionStyle"
  >
    <div
      class="lark-doc-mention-tabs"
      role="tablist"
    >
      <button
        v-for="tab in ed.mentionTabs"
        :key="tab.id"
        type="button"
        role="tab"
        class="lark-doc-mention-tab"
        :class="{ 'is-active': ed.mentionKind === tab.id }"
        :aria-selected="ed.mentionKind === tab.id ? 'true' : 'false'"
        @mousedown.prevent="ed.setMentionKind(tab.id)"
      >
        {{ tab.label }}
      </button>
    </div>
    <!-- 候选行一律 `@mousedown.prevent`：面板全程不抢焦点，正文选区与 `@` 上下文都留在
         编辑器里，落 chip 后用户能直接接着打字（点完再按 Backspace 也不会误删下一个 chip）。 -->
    <div
      class="lark-doc-mention-list"
      role="listbox"
    >
      <button
        v-for="(item, index) in ed.mentionItems"
        :key="`${item.kind}:${item.id}`"
        type="button"
        role="option"
        class="lark-doc-mention-row"
        :class="{ 'is-active': index === ed.mentionActiveIndex }"
        :aria-selected="index === ed.mentionActiveIndex ? 'true' : 'false'"
        @mousedown.prevent="ed.chooseMention(item)"
        @mouseenter="ed.setMentionActive(index)"
      >
        <span class="lark-doc-mention-row-name">{{ item.name }}</span><span
          v-if="item.department"
          class="lark-doc-mention-row-dept"
        >{{ item.department }}</span>
      </button>
      <p
        v-if="!ed.mentionItems.length"
        class="lark-doc-mention-empty"
      >
        {{ ed.mentionLoading ? '搜索中…' : ed.mentionEmptyText }}
      </p>
    </div>
    <div class="lark-doc-mention-footer">
      <label class="lark-doc-mention-notify">
        <input
          type="checkbox"
          :checked="ed.mentionNotify"
          aria-label="同时发送通知"
          @change="ed.setMentionNotify($event.target.checked)"
        ><span>同时发送通知</span>
      </label>
      <button
        type="button"
        class="lark-doc-mention-confirm"
        :disabled="!ed.mentionItems.length"
        @mousedown.prevent="ed.chooseMention()"
      >
        提及
      </button>
    </div>
  </div>
</template>

<script>
// MentionPanel —— `@` 提及候选面板（P4-01，规格见 requirements/02 §19.3 与 04-quinquies）。
//
// 与 SearchPanel 同一范式：父组件传 `:ed="self"`，本组件只做渲染，状态与方法全在
// `mentionMixin.js` 里 —— 面板没有自己的输入框（关键词就是正文里 `@` 后面那段文字），
// 所以这里连 ref 都不需要暴露。
//
// 高度不是写死的：`.lark-doc-mention-list` 撑出 `37 + 8 + 48n + 8 + 44`，空态靠
// list 的 min-height 兜底成 168；`mentionMixin.positionMentionPanel()` 落 DOM 后会读
// 真实 offsetHeight 再校一次上下翻转。
export default {
  name: 'LarkDocMentionPanel',
  props: {
    ed: { type: Object, required: true },
  },
}
</script>
