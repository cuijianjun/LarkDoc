<template>
  <div
    v-if="ed.headingNumberMenu.open"
    class="lark-doc-heading-number-menu"
    :class="{ 'is-editing': ed.headingNumberEditing }"
    :style="ed.headingNumberMenuStyle"
    role="menu"
    aria-label="编号设置"
    @mousedown.prevent
  >
    <template v-if="!ed.headingNumberEditing">
      <button
        v-for="action in ed.headingNumberActions"
        :key="action.id"
        type="button"
        class="lark-doc-heading-number-item"
        :class="{ 'is-disabled': ed.headingNumberMenuDisabled(action.id) }"
        role="menuitem"
        :aria-disabled="ed.headingNumberMenuDisabled(action.id) ? 'true' : 'false'"
        :data-menu-id="action.id"
        :disabled="ed.headingNumberMenuDisabled(action.id)"
        @click="ed.headingNumberAction(action.id)"
      >
        <span
          class="lark-doc-heading-number-icon"
          aria-hidden="true"
        ><lark-doc-icon
          :size="18"
          :name="action.icon"
        /></span><span class="lark-doc-heading-number-text">{{ action.label }}</span>
      </button>
    </template>
    <label
      v-else
      class="lark-doc-heading-number-editor"
    >
      <input
        :value="ed.headingNumberDraft"
        class="lark-doc-heading-number-input"
        type="text"
        inputmode="numeric"
        aria-label="编号值"
        @input="ed.setHeadingNumberDraft($event.target.value)"
        @keydown="ed.onHeadingNumberInputKeydown"
        @blur="ed.applyHeadingNumberValue()"
      ><span
        class="lark-doc-heading-number-spinner"
        aria-hidden="true"
      ><button
        type="button"
        tabindex="-1"
        aria-label="增加编号"
        @click="ed.stepHeadingNumberDraft(1)"
      ><lark-doc-icon
        :size="10"
        name="chevronUp"
      /></button><button
        type="button"
        tabindex="-1"
        aria-label="减少编号"
        @click="ed.stepHeadingNumberDraft(-1)"
      ><lark-doc-icon
        :size="10"
        name="chevronDown"
      /></button></span>
    </label>
  </div>
</template>

<script>
import LarkDocIcon from '../../LarkDocIcon.vue'

export default {
  name: 'HeadingNumberMenu',
  components: { LarkDocIcon },
  props: {
    ed: { type: Object, required: true },
  },
}
</script>
