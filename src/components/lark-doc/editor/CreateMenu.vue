<template>
  <!-- 顶栏「新建」菜单（requirements/04 §4.6.3）。外壳 182×509、内层 UL 180×503。
       固定在 LarkDocOverlays.vue 的兄弟层里 —— 顶栏的 `.lark-doc-header-actions`
       带 `overflow-x: auto`，absolute 会被裁掉（与 TopbarMoreMenu 同一条纪律）。 -->
  <div
    v-if="ed.createMenuOpen"
    class="lark-doc-create-menu"
    :style="ed.createMenuStyle"
    role="menu"
    aria-label="新建"
  >
    <ul
      ref="createMenuList"
      class="lark-doc-create-menu-list"
    >
      <!-- 11 行三类混排：item（172×40）/ divider（180×1）/ group（180×20）。
           用 template + v-if 三态，而不是「先按 kind 分组成三块再顺序渲染」——
           分组标题「文档应用」必须落在第 8 项与第 9 项之间，分组会打乱这个位置。 -->
      <template v-for="row in ed.createMenuRows">
        <li
          v-if="row.kind === 'divider'"
          :key="row.id"
          class="lark-doc-create-menu-divider"
          role="separator"
        />
        <li
          v-else-if="row.kind === 'group'"
          :key="row.id"
          class="lark-doc-create-menu-group"
          role="presentation"
        >
          {{ row.label }}
        </li>
        <li
          v-else
          :key="row.id"
          class="lark-doc-create-menu-item"
          role="menuitem"
          :data-create-menu-id="row.id"
          @click="ed.onCreateMenuItem(row)"
        >
          <!-- 图标外框 19×21：彩色项走 style.color（见 icons.js 头注），
               单色项统一 var(--ld-text-menu) —— 两态共用同一份 path。 -->
          <span
            class="lark-doc-create-menu-icon"
            :style="{ color: row.iconColor }"
          >
            <LarkDocIcon
              :name="row.icon"
              :size="16"
            />
          </span>
          <!-- 文案列 116×40 @x=1368：固定宽，图标列 x≈1334–1339 到文案有约 29px 空隙，
               靠 `padding-left` 而不是 gap 撑 —— 规格给的是绝对列位，gap 会随图标宽度漂。 -->
          <span class="lark-doc-create-menu-label">{{ row.label }}</span>
          <!-- 「上传及导入」独有右箭头 7×13 @(1473,525)。 -->
          <span
            v-if="row.arrow"
            class="lark-doc-create-menu-arrow"
            aria-hidden="true"
          >
            <LarkDocIcon
              name="chevron-right"
              :size="13"
            />
          </span>
        </li>
      </template>
    </ul>
  </div>
</template>

<script>
// CreateMenu —— 顶栏「新建」菜单视图层。状态与动作全在 `editor/createMenuMixin.js`
// （`CREATE_MENU_ROWS` / `toggleCreateMenu` / `onCreateMenuItem`），这里只渲染 + a11y。
import LarkDocIcon from '../LarkDocIcon.vue'

export default {
  name: 'LarkDocCreateMenu',
  components: { LarkDocIcon },
  props: {
    ed: { type: Object, required: true },
  },
}
</script>
