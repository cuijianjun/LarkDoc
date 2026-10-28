<template>
  <div
    v-if="ed.isvPanelOpen"
    class="lark-doc-isv-overlay"
    role="dialog"
    aria-label="按钮配置"
    :style="[ed.isvPanelStyle, { height: `${ed.isvPanelBoxHeight}px` }]"
  >
    <div class="lark-doc-isv-button-panel">
      <!-- 内容区 268×324（padding 12px 12px 0）：四行表单，行距 16。 -->
      <div class="lark-doc-isv-panel-content">
        <div class="lark-doc-isv-field">
          <label class="lark-doc-isv-field-label">按钮文字<span class="is-required">*</span></label>
          <div class="lark-doc-isv-field-control">
            <input
              class="lark-doc-isv-input"
              type="text"
              aria-label="按钮文字"
              placeholder="请输入按钮"
              :maxlength="20"
              :value="ed.isvButtonText"
              :class="{ 'is-error': ed.isvErrorField === 'buttonText' }"
              @input="ed.onIsvButtonTextInput"
            >
          </div>
        </div>
        <!-- 按钮颜色：16 色常驻（两行 × 8），不是「点一下再展开」的二级浮层。 -->
        <div class="lark-doc-isv-field is-color">
          <label class="lark-doc-isv-field-label">按钮颜色</label>
          <div class="lark-doc-isv-field-control">
            <div class="lark-doc-isv-color-picker">
              <div
                v-for="row in ed.isvButtonColors"
                :key="row.map((item) => item.label).join('-')"
                class="lark-doc-isv-color-row"
              >
                <button
                  v-for="color in row"
                  :key="color.value"
                  type="button"
                  class="lark-doc-isv-color-item"
                  :class="{ 'is-active': ed.isvButtonColor === color.value }"
                  :style="{ backgroundColor: color.value }"
                  :aria-label="color.label"
                  :title="color.label"
                  @mousedown.prevent="ed.chooseIsvButtonColor(color.value)"
                />
              </div>
            </div>
          </div>
        </div>
        <div class="lark-doc-isv-field">
          <label class="lark-doc-isv-field-label">执行操作</label>
          <div class="lark-doc-isv-field-control">
            <button
              type="button"
              class="lark-doc-isv-select"
              aria-label="执行操作"
              :class="{ 'is-open': ed.isvActionSelectOpen }"
              @mousedown.prevent="ed.toggleIsvActionSelect()"
            >
              <span class="lark-doc-isv-select-value">{{ ed.isvActionLabel }}</span>
              <span
                class="lark-doc-isv-select-arrow"
                aria-hidden="true"
              />
            </button>
            <!-- 下拉 244×102（3 项 × 32 + 上下 3px）：与飞书同款，不滚动。 -->
            <div
              v-if="ed.isvActionSelectOpen"
              class="lark-doc-isv-select-menu"
              role="listbox"
              aria-label="执行操作"
            >
              <button
                v-for="action in ed.isvActions"
                :key="action.id"
                type="button"
                role="option"
                class="lark-doc-isv-select-option"
                :aria-selected="action.id === ed.isvAction ? 'true' : 'false'"
                @mousedown.prevent="ed.chooseIsvAction(action.id)"
              >
                {{ action.label }}
              </button>
            </div>
          </div>
        </div>
        <!-- 只有「打开超链接」有这一行；`关注文档更新` 时整行不在（面板 386 → 308）。 -->
        <div
          v-if="ed.isvNeedsLink"
          class="lark-doc-isv-field"
        >
          <label class="lark-doc-isv-field-label">超链接地址<span class="is-required">*</span></label>
          <div class="lark-doc-isv-field-control">
            <input
              class="lark-doc-isv-input"
              type="text"
              aria-label="超链接地址"
              placeholder="请输入链接地址"
              :value="ed.isvLinkUrl"
              :class="{ 'is-error': ed.isvErrorField === 'linkUrl' }"
              @input="ed.onIsvLinkInput"
              @keydown.enter.prevent="ed.confirmIsvButton()"
            >
            <!-- 报错行 +38：面板不关、块不插入，用户改完可以直接再点确定。 -->
            <p
              v-if="ed.isvErrorField === 'linkUrl'"
              class="lark-doc-isv-field-explain"
            >
              {{ ed.isvValidationMessage }}
            </p>
          </div>
        </div>
      </div>
      <div class="lark-doc-isv-panel-footer">
        <button
          type="button"
          class="lark-doc-isv-button"
          @mousedown.prevent="ed.closeIsvPanel()"
        >
          取消
        </button>
        <button
          type="button"
          class="lark-doc-isv-button is-primary"
          @mousedown.prevent="ed.confirmIsvButton()"
        >
          确定
        </button>
      </div>
    </div>
  </div>
</template>

<script>
// IsvButtonPanel —— 「按钮」小组件的配置面板（P4-04，规格见 requirements/02 §22 ⑤）。
//
// 🔴 四条实测负结论，别「补全」：
//   1. **无 backdrop**：外层只是 270×386 的定位层（z-index 600），不盖全屏遮罩。
//   2. 色板**常驻** 16 色（两行 × 8，23×23 r5），不是「点一下展开」的二级浮层。
//   3. 「执行操作」只有 3 项（打开超链接 / 创建副本 / 关注文档更新），下拉 244×102 不滚动。
//   4. 校验失败时面板**不关**，撑高 38 显示一行红字；取消 / Esc 则直接关且**不建块**。
//
// 行一律 `@mousedown.prevent`：面板靠「点外部」关闭，点自己人不能把焦点让给 body，
// 否则编辑器选区掉了，`确定` 时的 `setIsv` 就没有落点。
export default {
  name: 'LarkDocIsvButtonPanel',
  props: {
    ed: { type: Object, required: true },
  },
}
</script>
