<template>
  <div
    v-if="ed.versionPanelOpen"
    class="lark-doc-version-layer"
    role="dialog"
    aria-label="历史记录"
    aria-modal="true"
    tabindex="-1"
    @keydown.esc.stop.prevent
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
          <div class="lark-doc-version-preview">
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
              <span v-if="ed.versionPreview">
                二进制快照 {{ ed.versionPreview.byteLength }} 字节
              </span>
              <span v-if="ed.versionPreview && Number.isInteger(ed.versionPreview.blockCount)">
                {{ ed.versionPreview.blockCount }} 个块
              </span>
            </div>

            <p
              v-if="ed.versionPreviewError"
              class="lark-doc-version-degraded"
            >
              {{ ed.versionPreviewError }}
            </p>

            <div
              v-if="ed.versionSelectedDiff"
              class="lark-doc-version-diff"
            >
              <span class="lark-doc-version-diff-title">与更早版本的差异</span>
              <span class="lark-doc-version-diff-row">
                块数 {{ ed.versionSelectedDiff.blockCount.prev }} →
                {{ ed.versionSelectedDiff.blockCount.next }}
                （{{ ed.versionSelectedDiff.blockCount.delta >= 0 ? '+' : '' }}{{ ed.versionSelectedDiff.blockCount.delta }}）
              </span>
              <!-- 字数与标题在历史侧取不到（正文只存二进制），这里不显示，也不补 0。 -->
            </div>

            <div class="lark-doc-version-body">
              <p
                v-if="ed.versionPreview && ed.versionPreview.hasPayload"
                class="lark-doc-version-binary"
              >
                该版本正文为二进制快照（{{ ed.versionPreview.byteLength }} 字节），需由协同运行时解码后才能渲染。
              </p>
              <p
                v-else
                class="lark-doc-version-binary"
              >
                该版本没有可取回的正文，只能查看元信息。
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
        显示更改
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
 *   6. **底栏「显示更改」没有行为**（⑦-4 未采）：按像素渲染文案，不绑事件。
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

export default {
  name: 'LarkDocVersionPanel',
  components: { LarkDocIcon },
  props: {
    ed: { type: Object, required: true },
  },
}
</script>
