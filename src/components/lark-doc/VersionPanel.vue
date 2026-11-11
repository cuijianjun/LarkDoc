<template>
  <div
    v-if="ed.versionPanelOpen"
    class="lark-doc-version-layer"
    role="dialog"
    aria-label="历史记录"
    aria-modal="true"
    tabindex="-1"
    @copy.capture="ed.onContentClipboard($event, $refs.preview || null)"
    @cut.capture="ed.onContentClipboard($event, $refs.preview || null)"
    @keydown.esc.stop.prevent
    @keydown.stop
  >
    <!-- 左栏 1218 × 950 @(0,0)：只读预览（含 diff 摘要）+ 顶栏 4 个控件。 -->
    <div class="lark-doc-version-left">
      <div class="lark-doc-version-left-header">
        <button
          type="button"
          class="lark-doc-version-back"
          aria-label="返回文档"
          @mousedown.prevent="ed.closeVersionPanel()"
        >
          <LarkDocIcon
            name="undo"
            :size="24"
          />
        </button>
        <button
          type="button"
          class="lark-doc-version-restore"
          :disabled="ed.versionRestoreDisabled"
          :title="ed.versionCanRestoreReason"
          :style="ed.versionDisabledStyle(ed.versionRestoreDisabled)"
          @mousedown.prevent="ed.restoreSelectedVersion()"
        >
          还原此历史记录
        </button>
        <div class="lark-doc-version-pager">
          <span class="lark-doc-version-cursor">{{ ed.versionCursorLabel }}</span>
          <button
            type="button"
            class="lark-doc-version-step"
            :disabled="ed.versionPrevDisabled"
            :style="ed.versionDisabledStyle(ed.versionPrevDisabled)"
            @mousedown.prevent="ed.versionPrev()"
          >
            上一项
          </button>
          <button
            type="button"
            class="lark-doc-version-step"
            :disabled="ed.versionNextDisabled"
            :style="ed.versionDisabledStyle(ed.versionNextDisabled)"
            @mousedown.prevent="ed.versionNext()"
          >
            下一项
          </button>
        </div>
        <span class="lark-doc-version-header-divider" />
      </div>

      <div class="lark-doc-version-left-content">
        <p
          v-if="ed.versionError"
          class="lark-doc-version-empty"
        >
          {{ ed.versionError }}
        </p>
        <p
          v-else-if="!ed.versionTotal"
          class="lark-doc-version-empty"
        >
          {{ ed.versionLoading ? '正在载入历史记录…' : '暂无历史版本' }}
        </p>

        <template v-else>
          <div
            ref="preview"
            class="lark-doc-version-preview"
          >
            <div class="lark-doc-version-preview-head">
              <span class="lark-doc-version-preview-title">
                {{ (ed.versionPreview && ed.versionPreview.label) || '未命名版本' }}
              </span>
              <span class="lark-doc-version-preview-kind">
                {{ ed.versionKindLabel(ed.versionSelected && ed.versionSelected.kind) }}
              </span>
            </div>
            <div class="lark-doc-version-preview-meta">
              <span>{{ ed.versionItemName(ed.versionSelected) }}</span>
              <span>{{ ed.versionActorLabel(ed.versionSelected) }}</span>
            </div>

            <p
              v-if="ed.versionPreviewError"
              class="lark-doc-version-degraded"
            >
              {{ ed.versionPreviewError }}
            </p>

            <div
              v-if="ed.versionRemoteDiff && ed.versionShowChanges"
              class="lark-doc-version-diff"
              role="region"
              aria-label="更改内容"
              :style="{ maxHeight: '40vh', overflowY: 'auto' }"
            >
              <p v-if="ed.versionDiffLoading">
                正在载入更改…
              </p>
              <p
                v-else-if="ed.versionDiffError"
                role="status"
              >
                {{ ed.versionDiffError }}
              </p>
              <template v-else-if="ed.versionDiff">
                <p v-if="ed.versionDiff.identical">
                  内容没有更改。
                </p>
                <div
                  v-for="(change, index) in displayChanges"
                  :key="index"
                >
                  <strong>{{ change.formatting ? '格式已更改' : { add: '新增内容', remove: '删除内容', replace: '替换内容' }[change.kind] }}</strong>
                  <p v-if="!change.formatting && !change.hasText">
                    此更改不包含文字。
                  </p>
                  <pre
                    v-if="!change.formatting && change.hasText && change.kind !== 'add'"
                    :style="{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }"
                  >之前：{{ change.before || '（空）' }}</pre>
                  <pre
                    v-if="!change.formatting && change.hasText && change.kind !== 'remove'"
                    :style="{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }"
                  >之后：{{ change.after || '（空）' }}</pre>
                </div>
              </template>
            </div>

            <div class="lark-doc-version-body">
              <p
                v-if="previewRenderError"
                class="lark-doc-version-degraded"
              >
                {{ previewRenderError }}
              </p>
              <EditorContent
                v-else-if="previewEditor"
                :editor="previewEditor"
              />
              <p
                v-else-if="!ed.versionPreview && !ed.versionPreviewError"
                class="lark-doc-version-binary"
              >
                正在载入此历史记录…
              </p>
              <p
                v-else-if="ed.versionPreview && ed.versionPreview.hasPayload"
                class="lark-doc-version-binary"
              >
                暂时无法预览此历史记录。
              </p>
              <p
                v-else
                class="lark-doc-version-binary"
              >
                此历史记录暂无可预览的正文。
              </p>
            </div>
          </div>
        </template>
      </div>
    </div>

    <!-- 右栏 294 × 950 @(1218,0)：顶栏「历史记录」+ 按天分组的时间线 + 底栏「显示更改」。 -->
    <div class="lark-doc-version-right">
      <div class="lark-doc-version-right-header">
        <span class="lark-doc-version-right-title">历史记录</span>
        <span class="lark-doc-version-right-icon">
          <LarkDocIcon
            name="chevronDown"
            :size="24"
          />
        </span>
      </div>

      <div class="lark-doc-version-timeline">
        <p
          v-if="ed.versionError"
          class="lark-doc-version-empty"
        >
          {{ ed.versionError }}
        </p>
        <div
          v-for="group in ed.versionDayGroups"
          v-else
          :key="group.key"
          class="lark-doc-version-day"
        >
          <div class="lark-doc-version-day-label">
            {{ group.label }}
          </div>
          <div
            v-for="item in group.items"
            :key="item.id"
            class="lark-doc-version-item"
            :class="ed.versionTimelineClass(item)"
            @mousedown.prevent="ed.selectVersion(item.id)"
          >
            <div class="lark-doc-version-item-name">
              {{ ed.versionItemName(item) }}
            </div>
            <div class="lark-doc-version-item-desc">
              {{ ed.versionItemDesc(item) }}
            </div>
            <div class="lark-doc-version-item-user">
              {{ ed.versionActorLabel(item) }}
            </div>
          </div>
        </div>
      </div>

      <div class="lark-doc-version-right-footer">
        <button
          v-if="ed.versionRemoteDiff"
          type="button"
          :aria-pressed="ed.versionShowChanges ? 'true' : 'false'"
          @mousedown.prevent="ed.toggleVersionChanges()"
        >
          {{ ed.versionShowChanges ? '隐藏更改' : '显示更改' }}
        </button>
        <span v-else>显示更改</span>
      </div>
    </div>
  </div>
</template>

<script>
/**
 * VersionPanel —— 历史记录全屏模态层（P6b-02，规格见 requirements/04 §3.4）。
 *
 * 六条实测负结论，别「补全」：
 *   1. **`Esc` 关不掉**（§3.4 ⑤ `stillOpenAfterEsc=true`）：根节点 `@keydown.esc.stop.prevent`
 *      不接任何关闭逻辑，目的只是**不让 Esc 冒泡到 `overlayDismissMixin.closeOverlay()`**
 *      —— 那条链里没有版本面板分支，Esc 传过去只会误关别的浮层。唯一关闭入口是左栏顶栏
 *      返回图标 @(16,20)。
 *   2. **「还原此历史记录」默认 `disabled`**（§3.4-B 反直觉 1，灰底见 `versioning.css`、
 *      `cursor: not-allowed`）。启用条件是 ⑦-1 未采项，只能推断，见 mixin 注释。
 *   3. **上一项 / 下一项翻的是「编辑记录」不是版本**（§3.4 ⑤ 反直觉 3）：页码文案恒为
 *      「编辑记录 N/M」，两个按钮移动的是**游标**，与「哪个版本被选中」是两条独立状态。
 *   4. **时间线条目名是蓝色**（§3.4-C 反直觉 2，色值见 `versioning.css`），不是正文色
 *      `rgb(31,35,41)`。
 *   5. **不实现删除 / 改备注 / 展开子记录**（⑦-2 / ⑦-3 未采 + 没有子记录数据源）。
 *   6. 本地底栏保留原样；远端「显示更改」读取受权差异，只展示正文内容与格式变更提示。
 *
 * 为什么写成块注释：`scripts/check-theme-tokens.js` 只剥**块注释**，行注释里的字面色值
 * 会被当成新增并让门禁失败。所以本文件所有注释不放字面色值。
 *
 * 图标复用的说明：`editor/icons.js` 里**没有** history / version 专用键。返回图标复用
 * `undo`（弯曲箭头，最接近「返回文档」），右栏顶栏图标复用 `chevronDown`。这是替代方案
 * 不是规格 —— 有正式图标时应替换这两处。
 *
 * 行一律 `@mousedown.prevent`：点面板不能把焦点让给 body，否则编辑器选区掉了，
 * 紧跟着的「还原」就没有上下文可操作。
 */
import LarkDocIcon from './LarkDocIcon.vue'
import { Editor, EditorContent } from '@tiptap/vue-2'
import { createLarkDocExtensions } from './extensions'

/* 只读取正文节点的text/content，不把属性或协议对象序列化到界面。 */
function versionChangeText(value) {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(versionChangeText).join('')
  if (!value || typeof value !== 'object') return ''
  if (typeof value.text === 'string') return value.text
  return Array.isArray(value.content) ? value.content.map(versionChangeText).join(value.type === 'doc' ? '\n' : '') : ''
}

export default {
  name: 'LarkDocVersionPanel',
  components: { LarkDocIcon, EditorContent },
  props: {
    ed: { type: Object, required: true },
  },
  data() { return { previewEditor: null, previewRenderError: '' } },
  computed: {
    displayChanges() {
      return (this.ed.versionDiff?.changes || []).map(change => {
        const before = versionChangeText(change.before), after = versionChangeText(change.after)
        const formatting = /\/(attrs|marks|type)(\/|$)/.test(change.path)
        return { kind: change.kind, before, after, formatting, hasText: Boolean(before || after) }
      })
    },
  },
  watch: {
    'ed.versionPreview': {
      immediate: true,
      handler(record) {
        this.destroyPreview()
        this.previewRenderError = ''
        if (!record || !record.contentJson || !this.ed.versionPanelOpen) return
        try {
          // 独立只读渲染器：无session、无collab、无活动Y.Doc，投影只用于预览。
          this.previewEditor = new Editor({ editable: false, content: record.contentJson,
            editorProps: { larkDocCanCopy: () => this.ed.contentCopyAllowed(), larkDocCopyContext: () => this.previewCopyContext() },
            extensions: createLarkDocExtensions({ config: this.ed.larkDocConfig }) })
        } catch { this.previewRenderError = '暂时无法预览此历史记录。' }
      },
    },
    'ed.versionPanelOpen'(open) {
      if (!open) this.destroyPreview()
      else this.$nextTick(() => {
        if (this.ed.versionPanelOpen && this.$el && typeof this.$el.focus === 'function') this.$el.focus()
      })
    },
    'ed.editor'() { this.bindPreviewCopy() },
  },
  mounted() { this.bindPreviewCopy() },
  beforeDestroy() { this._previewCopyEditor?.off('lark-doc-copy-permission', this.forwardPreviewCopy); this.destroyPreview() },
  methods: {
    bindPreviewCopy() {
      this._previewCopyEditor?.off('lark-doc-copy-permission', this.forwardPreviewCopy)
      this._previewCopyEditor = this.ed.editor
      this._previewCopyEditor?.on('lark-doc-copy-permission', this.forwardPreviewCopy)
      this.forwardPreviewCopy()
    },
    forwardPreviewCopy() { this.previewEditor?.emit('lark-doc-copy-permission') },
    previewCopyContext() {
      return { kind: 'preview', owner: this, editor: this.previewEditor, doc: this.previewEditor?.state?.doc, parent: this.ed.contentCopyContext() }
    },
    destroyPreview() {
      if (this.previewEditor) this.previewEditor.destroy()
      this.previewEditor = null
    },
  },
}
</script>
