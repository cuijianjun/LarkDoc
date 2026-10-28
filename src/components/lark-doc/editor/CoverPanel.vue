<template>
  <!-- 封面操作面板（04 §1.4.2 / §1.4.3）。
       两级形态**共用一个 wrapper**（这是必须照做的：真机里 162×126 与 542×522 是同一个
       `.cover-panel-popover-content-wrapper` 换内容，做成两个 popover 就要写两份关闭逻辑）：
         - menu    = 162×126 的三项；
         - gallery = 542×522 的图库（点「选择图片」**原地扩展**，不是跳新弹窗）。

       z 口径（§1.4.2 红字 ②）：面板 **80**、遮罩 **78**，**只差 2 级**。别按 Dialog 的
       1000+ 惯例写；遮罩是全屏**透明**层，给它加背景色整页会变灰。 -->
  <div
    v-if="ed.coverPanelOpen"
    class="lark-doc-cover-layer"
  >
    <div
      class="lark-doc-cover-mask"
      aria-hidden="true"
      @pointerdown="ed.closeCoverPanel"
    />
    <div
      ref="coverPanel"
      class="lark-doc-cover-panel"
      :class="{ 'is-gallery': ed.coverStage === 'gallery' }"
      :style="ed.coverPanelStyleValue"
      role="dialog"
      aria-label="封面"
    >
      <!-- ===== menu 态：162×126 三项 ===== -->
      <ul
        v-if="ed.coverStage === 'menu'"
        class="lark-doc-cover-options"
        role="menu"
        aria-label="封面操作"
      >
        <li
          v-for="item in items"
          :key="item.id"
          class="lark-doc-cover-option"
          role="menuitem"
          :data-cover-item="item.id"
          @click="ed.onCoverPanelItem(item.id)"
        >
          <LarkDocIcon
            :name="item.icon"
            :size="20"
          /><span>{{ item.label }}</span>
        </li>
      </ul>

      <!-- ===== gallery 态：542×522 图库 ===== -->
      <div
        v-else
        class="lark-doc-cover-gallery"
      >
        <div class="lark-doc-cover-gallery-head">
          <div class="lark-doc-cover-gallery-tabs">
            <button
              type="button"
              class="lark-doc-cover-tab"
              :class="{ 'is-active': ed.coverTab === 'storehouse' }"
              aria-label="官方图库"
              @click="ed.setCoverTab('storehouse')"
            >
              官方图库
            </button><button
              type="button"
              class="lark-doc-cover-tab"
              :class="{ 'is-active': ed.coverTab === 'upload' }"
              aria-label="本地上传"
              @click="ed.setCoverTab('upload')"
            >
              本地上传
            </button>
          </div>
          <div class="lark-doc-cover-gallery-head-right">
            <button
              type="button"
              class="lark-doc-cover-head-btn is-random"
              aria-label="随机封面"
              @click="ed.pickRandomCover"
            >
              随机
            </button><button
              type="button"
              class="lark-doc-cover-head-btn"
              aria-label="移除封面"
              @click="ed.removeCover"
            >
              移除
            </button>
          </div>
        </div>

        <div class="lark-doc-cover-gallery-scroll">
          <!-- 官方图库：4 列 118×64 栅格（§1.4.3 可直接写死）。 -->
          <div
            v-if="ed.coverTab === 'storehouse'"
            class="lark-doc-cover-storehouse"
          >
            <div
              v-for="group in ed.coverThumbGroups"
              :key="group.id"
              class="lark-doc-cover-group"
            >
              <h6 class="lark-doc-cover-group-title">
                {{ group.title }}
              </h6>
              <ul class="lark-doc-cover-thumbs">
                <li
                  v-for="preset in group.items"
                  :key="preset.id"
                  class="lark-doc-cover-thumb"
                >
                  <button
                    type="button"
                    class="lark-doc-cover-thumb-btn"
                    :class="{ 'is-active': ed.coverValue && ed.coverValue.preset === preset.id }"
                    :style="thumbStyle(preset)"
                    :aria-label="preset.name"
                    :aria-pressed="ed.coverValue && ed.coverValue.preset === preset.id ? 'true' : 'false'"
                    @click="ed.pickCover(preset.id)"
                  />
                </li>
              </ul>
            </div>
          </div>
          <!-- 本地上传：走 FileReader 读成 data URL，避免 Demo 依赖外链 CDN。 -->
          <label
            v-else
            class="lark-doc-cover-upload"
          >
            <input
              type="file"
              accept="image/*"
              class="lark-doc-cover-file"
              @change="ed.uploadCover"
            ><span>点击上传本地图片</span>
          </label>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
// CoverPanel —— 封面操作面板（fixed 浮层，挂在 `LarkDocOverlays.vue`）。
//
// 三项**按 id 派发**而不是按下标：§1.4.3 的红字是真实事故（batch425 按 DOM 取「最后一个」
// 把封面删了）。所以 `COVER_PANEL_ITEMS` 的 id 写死在这里，模板只做遍历。
import { COVER_PANEL_ITEMS, coverImageStyle } from './coverMixin'
import LarkDocIcon from '../LarkDocIcon.vue'

export default {
  name: 'LarkDocCoverPanel',
  components: { LarkDocIcon },
  props: {
    ed: { type: Object, required: true },
  },
  data() {
    return { items: COVER_PANEL_ITEMS }
  },
  methods: {
    /** 缩略图：与封面同源的 `coverImageStyle`，保证「所见即所得」。 */
    thumbStyle(preset) {
      return coverImageStyle({ preset: preset.id, offset: 50 })
    },
  },
}
</script>
