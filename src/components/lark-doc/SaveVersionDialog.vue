<template>
  <div v-if="ed.saveVersionOpen || ed.versionNotice">
    <!-- 遮罩 1512 × 950 @(0,0)，bg rgba(0,0,0,0.55)，z 1000。 -->
    <div
      v-if="ed.saveVersionOpen"
      class="lark-doc-save-version-mask"
    >
      <div
        class="lark-doc-save-version-wrap"
        tabindex="-1"
        role="dialog"
        aria-modal="true"
        :aria-label="ed.saveVersionDialogTitle"
        @keydown.esc.stop.prevent="ed.closeSaveVersionDialog()"
      >
        <section class="lark-doc-save-version-dialog">
          <!-- 头部 420 × 72，padding 24px 56px 24px 24px。 -->
          <header class="lark-doc-save-version-header">
            <h3 class="lark-doc-save-version-title">
              {{ ed.saveVersionDialogTitle }}
            </h3>
            <button
              type="button"
              class="lark-doc-save-version-close"
              aria-label="关闭"
              @mousedown.prevent="ed.closeSaveVersionDialog()"
            >
              <LarkDocIcon
                name="close"
                :size="20"
              />
            </button>
          </header>

          <!-- 主体 420 × 90，padding 0 24px。 -->
          <div class="lark-doc-save-version-body">
            <div class="lark-doc-save-version-field">
              <label
                class="lark-doc-save-version-label"
                for="lark-doc-save-version-input"
              >版本名称</label>
              <div class="lark-doc-save-version-input-row">
                <input
                  id="lark-doc-save-version-input"
                  class="lark-doc-save-version-input"
                  type="text"
                  placeholder="请输入名称"
                  :maxlength="ed.versionNameMax"
                  :value="ed.saveVersionName"
                  @input="ed.setSaveVersionName($event.target.value)"
                >
                <span class="lark-doc-save-version-counter">{{ ed.versionNameCounter }}</span>
              </div>
            </div>
          </div>

          <!-- 底部 420 × 56，padding 0 24px 24px。 -->
          <footer class="lark-doc-save-version-footer">
            <button
              type="button"
              class="lark-doc-save-version-cancel"
              @mousedown.prevent="ed.closeSaveVersionDialog()"
            >
              取消
            </button>
            <button
              type="button"
              class="lark-doc-save-version-confirm"
              :disabled="!ed.versionCanCreate || ed.saveVersionBusy"
              :title="ed.versionCanCreateReason"
              :style="ed.versionDisabledStyle(!ed.versionCanCreate || ed.saveVersionBusy)"
              @mousedown.prevent="ed.confirmSaveVersion()"
            >
              确定
            </button>
          </footer>

          <p
            v-if="ed.saveVersionError"
            class="lark-doc-save-version-error"
          >
            {{ ed.saveVersionError }}
          </p>
        </section>
      </div>
    </div>

    <!-- 成功 toast 418 × 54（04 §⑤-2 末尾），与 Dialog 同级，关掉 Dialog 后仍在。 -->
    <div
      v-if="ed.versionNotice"
      class="lark-doc-version-notice"
      role="status"
    >
      <span>{{ ed.versionNotice }}</span>
      <button
        type="button"
        class="lark-doc-version-notice-link"
        @mousedown.prevent="ed.openVersionPanel(); ed.dismissVersionNotice()"
      >
        立即查看
      </button>
    </div>
  </div>
</template>

<script>
// SaveVersionDialog —— 「另存为版本」Dialog（P6b-02，规格见 requirements/04 §3.4 ⑤-2）。
//
// 五条实测 / 推断结论：
//   1. 弹窗 **420 × 242 @(546,354)**，radius 8；遮罩 `rgba(0,0,0,0.55)`，z 1000（实测）。
//   2. 输入框 **268 × 22**，透明底、无边框（`0px none`）、radius 0（实测）—— 别顺手加
//      圆角边框「好看一点」，飞书那层视觉是下边一条分隔线撑出来的。
//   3. 计数 **默认 `11/1000`，输入 4 字后 `15/1000`** ⇒ **追加，不是全选替换**（实测）。
//      所以这里从不主动清空 `saveVersionName`，只在关闭 Dialog 时整体重置。
//   4. **遮罩点击不关闭**（推断：⑤-2 未采，且关掉会丢输入 —— 与 LinkDialog 的
//      `@click.self` 口径不同，这里刻意保守）。
//   5. **Esc 关闭**（推断：⑤-2 未采，按项目 Dialog 通用口径 `@keydown.esc.stop.prevent`）。
//      注意它与历史面板相反 —— 面板的 Esc 无效是 §3.4 ⑤ 实测结论，两者不是同一个浮层。
//
// 图标复用：`editor/icons.js` 没有 history / version 专用键，关闭 X 复用 `close`。
//
// 行一律 `@mousedown.prevent`：点弹窗不能把焦点让给 body，否则编辑器选区掉了。
import LarkDocIcon from './LarkDocIcon.vue'

export default {
  name: 'LarkDocSaveVersionDialog',
  components: { LarkDocIcon },
  props: {
    ed: { type: Object, required: true },
  },
}
</script>
