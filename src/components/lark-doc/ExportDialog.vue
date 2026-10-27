<template>
  <!-- 导出层：一个无语义的包裹节点，只为满足 Vue 2「单根」。里面两项都是 position: fixed，
       所以这层不占文档流；弹窗关掉后它是一个空 div，不影响布局。
       —— toast 必须挂在这一层而不是弹窗里：§4.6.7③ 的顺序是「弹窗关闭 → toast」，
       弹窗 v-if 掉了以后 toast 还得活着，直到文件落盘才自行消失（④）。 -->
  <div class="lark-doc-export-layer">
    <!-- 提交后提示条（§4.6.7④）：ud__msg-manager--t 1512×102 @[0,32] z9999。
         全宽而非固定 1512 —— 那只是实测视口宽度，写死会在窄屏溢出。 -->
    <div
      v-if="ed.exportToast"
      class="lark-doc-export-toast"
      role="status"
      aria-live="polite"
    >
      <div class="lark-doc-export-toast-inner">
        {{ ed.exportToast }}
      </div>
    </div>
    <!-- 遮罩 z1000（§4.6.7②）。点遮罩 = 取消语义（零请求）—— 实测只采了 Esc / 取消 / 导出，
         遮罩点击按「取消」处理是最小外推，不额外发请求。 -->
    <div
      v-if="ed.exportOpen"
      class="lark-doc-export-backdrop"
      @click.self="ed.cancelExport()"
    >
      <!-- 面板 docx-export-panel 720×215 @(396,368)（1512 视口下居中），radius 8、白底 -->
      <section
        class="lark-doc-export-panel"
        role="dialog"
        aria-modal="true"
        :aria-label="ed.exportPanelTitle"
      >
        <header class="lark-doc-export-header">
          <!-- ud__modal__titleContent [420,392,640,24]：16px / 500 / var(--ld-share-text) -->
          <strong class="lark-doc-export-title">{{ ed.exportPanelTitle }}</strong>
          <!-- ud__modal__close 28×28 @[1068,390]：radius 6、色 var(--ld-share-text-secondary) -->
          <button
            type="button"
            class="lark-doc-export-close"
            aria-label="关闭导出设置"
            @click="ed.closeExportDialog()"
          >
            <lark-doc-icon
              :size="14"
              name="close"
            />
          </button>
        </header>
        <div class="lark-doc-export-body">
          <!-- range-context [420,465,56,22]：14px / var(--ld-share-text-secondary) -->
          <span class="lark-doc-export-range-label">内容范围</span>
          <!-- ud__radio-group--mode-solid [516,465,212|296,22]：14px，两项间距实测 24 -->
          <div
            class="lark-doc-export-radio-group"
            role="radiogroup"
            aria-label="内容范围"
          >
            <label
              v-for="option in ed.exportScopeOptions"
              :key="option.value"
              class="lark-doc-export-option"
              :class="{ 'is-disabled': !ed.exportCanExport }"
            >
              <!-- 三层：原生 input（16×16，可读 .checked）+ wallpaper（1px 描边圆）+ checked-ink（6×6 实心点） -->
              <span class="lark-doc-export-radio">
                <input
                  class="lark-doc-export-radio-input"
                  type="radio"
                  name="lark-doc-export-scope"
                  :value="option.value"
                  :checked="ed.exportScopeValue === option.value"
                  :disabled="!ed.exportCanExport"
                  @change="ed.selectExportScope(option.value)"
                >
                <span class="lark-doc-export-radio-wallpaper"><span
                  v-if="ed.exportScopeValue === option.value"
                  class="lark-doc-export-radio-ink"
                /></span>
              </span>
              <span class="lark-doc-export-option-text">{{ option.label }}</span>
            </label>
          </div>
        </div>
        <!-- ud__modal__footer [396,527,720,56] → __btns [420,527,672,44] -->
        <footer class="lark-doc-export-footer">
          <div class="lark-doc-export-btns">
            <!-- 取消 80×32 @[920,527]：白底 / 边 var(--ld-share-border-control) / 文字 var(--ld-share-text) / rad 6 -->
            <button
              type="button"
              class="lark-doc-export-cancel"
              @click="ed.cancelExport()"
            >
              取消
            </button>
            <!-- 导出 80×32 @[1012,527]：底 var(--ld-share-brand) / 文字 var(--ld-share-surface) / rad 6。
                 无权限时置灰但不隐藏，且保留 pointer-events，让 not-allowed 光标能显示出来。 -->
            <button
              type="button"
              class="lark-doc-export-submit"
              :class="{ 'is-disabled': ed.exportSubmitDisabled }"
              :disabled="ed.exportSubmitDisabled"
              :aria-disabled="ed.exportSubmitDisabled ? 'true' : 'false'"
              @click="ed.submitExport()"
            >
              导出
            </button>
          </div>
        </footer>
      </section>
    </div>
  </div>
</template>

<script>
/**
 * 导出设置弹窗（P6b-04）—— 三档同壳的纯渲染层。
 *
 * 规格：requirements/04 §4.6.7②。所有尺寸 / 色值 / 字号都来自该节表格，本组件**不含任何
 * 逻辑**：开关、档位、派发、toast、权限闸门全在 editor/exportMixin.js，这里只经 `ed.` 读。
 * 组件内刻意不写 `<style>` —— 全仓弹窗组件的样式都集中在 src/styles / lark-doc.css，
 * 本线样式在 src/styles/print.css（屏幕态段）。
 *
 * 类名对照（实测类名 → 本线类名，统一 `lark-doc-` 前缀）：
 *   `docx-export-panel` → `.lark-doc-export-panel`
 *   `ud__modal__titleContent` → `.lark-doc-export-title`
 *   `ud__modal__close` → `.lark-doc-export-close`
 *   `range-context` → `.lark-doc-export-range-label`
 *   `ud__radio-group--mode-solid` → `.lark-doc-export-radio-group`
 *   `ud__radio__input / __wallpaper / __checked-ink` → `.lark-doc-export-radio-*`
 *   `ud__button--outlined / --filled` → `.lark-doc-export-cancel / -submit`
 *
 * 两条负结论（别实现）：
 *   1. **弹窗里没有「进度条 / 百分比 / 成功文案」**（§4.6.7④）：处理中 toast 保持同一句
 *      「正在导出文档」，完成后自行消失。别在面板里加进度态或结果态。
 *   2. **不做遮罩点击的二次确认**，也不因为点在遮罩上就当成「导出」—— 它等价于取消，
 *      零请求。实测只采了 Esc / 取消 / 导出三态，遮罩行为是最小外推。
 */
import LarkDocIcon from './LarkDocIcon.vue'

export default {
  name: 'ExportDialog',
  components: { LarkDocIcon },
  props: {
    ed: { type: Object, required: true },
  },
}
</script>
