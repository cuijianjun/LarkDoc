<template>
  <!-- 顶栏「通知」popover（requirements/04 §4.6.4）。外壳 402×555 / z999，
       透明底 + `padding: 3px 0 0`，白底在内层 content。
       挂在 LarkDocOverlays.vue 的固定兄弟层（顶栏 header-actions 有 overflow-x: auto）。 -->
  <div
    v-if="ed.notifyOpen"
    ref="notifyPopover"
    class="lark-doc-notify-popover"
    :style="ed.notifyStyle"
    role="dialog"
    aria-label="当前文档通知"
  >
    <!-- 双层 loading 壳：`ud__loading-nested-loading` → `ud__loading__container`。
         后者必须 `position: relative`（04 §4.6.4 🔴），骨架屏靠它定位。
         空态下这两层都是零高度透传容器，看不出存在 —— 刻意保留。 -->
    <div class="lark-doc-notify-loading-nested">
      <div class="lark-doc-notify-loading-container">
        <div class="lark-doc-notify-content">
          <!-- 头部四件套：标题 14px/700 var(--ld-text-menu) / 铃铛 14×14 /
               「关闭通知」56×22 14px/400 / 「全部已读」56×17 14px/400
               （0 未读转 var(--ld-text-disabled)）。 -->
          <header class="lark-doc-notify-header">
            <h3 class="lark-doc-notify-header-desc">
              {{ title }}
            </h3>
            <span
              class="lark-doc-notify-header-bell"
              aria-hidden="true"
            >
              <LarkDocIcon
                name="bell"
                :size="14"
              />
            </span>
            <button
              type="button"
              class="lark-doc-notify-mute"
              @mousedown.prevent="ed.toggleNotifyMute()"
            >
              {{ ed.notifyMuteLabel }}
            </button>
            <button
              type="button"
              class="lark-doc-notify-readall"
              :class="{ 'is-disabled': ed.notifyAllReadDisabled }"
              :disabled="ed.notifyAllReadDisabled"
              @mousedown.prevent="ed.markAllNotifyRead()"
            >
              全部已读
            </button>
          </header>

          <!-- 空态三件套：插图 120×120 / 主文案 64×24 16px/500 /
               副文案 250×66 14px var(--ld-text-secondary)。 -->
          <div
            v-if="ed.notifyEmpty"
            class="lark-doc-notify-empty"
          >
            <!-- 插图：规格未采集到图片资源，用同尺寸的线性「铃铛静音」自绘占位。
                 给死尺寸（120×120）而不是让它自适应 —— 三件套的垂直居中靠这个固定高。 -->
            <span
              class="lark-doc-notify-empty-img"
              aria-hidden="true"
            >
              <LarkDocIcon
                name="bell"
                :size="72"
              />
            </span>
            <p class="lark-doc-notify-empty-title">
              暂无通知
            </p>
            <p class="lark-doc-notify-empty-sub">
              当协作者在文档中提及你、回复你的评论或修改你关注的内容时，通知会出现在这里
            </p>
          </div>

          <!-- 列表态：同一套计量（行高 64 / 标题 14px/500 /
               时间 12px var(--ld-text-tertiary)）。 -->
          <ul
            v-else
            class="lark-doc-notify-list"
          >
            <li
              v-for="item in ed.notifyItems"
              :key="item.id"
              class="lark-doc-notify-item"
              :class="{ 'is-unread': !item.readAt }"
            >
              <span class="lark-doc-notify-item-title">{{ item.title }}</span>
              <span class="lark-doc-notify-item-body">{{ item.body }}</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
// NotifyPopover —— 顶栏「通知」popover 视图层。状态机在 `editor/notifyMixin.js`。
//
// `ref="notifyPopover"` 是被 mixin 依赖的：`measureNotify()` 用它取实测尺寸做二次定位，
// 改名会静默失配（尺寸纠正失效，但不报错）—— 改 ref 前先改 mixin。
import LarkDocIcon from '../LarkDocIcon.vue'
import { NOTIFY_TITLE } from './notifyMixin'

export default {
  name: 'LarkDocNotifyPopover',
  components: { LarkDocIcon },
  props: {
    ed: { type: Object, required: true },
  },
  computed: {
    /** 标题只有一处出处（mixin 的 `NOTIFY_TITLE`），模板里不写字面量。 */
    title() {
      return NOTIFY_TITLE
    },
  },
}
</script>
