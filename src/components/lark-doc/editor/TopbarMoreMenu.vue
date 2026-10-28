<template>
  <!-- 顶栏「更多」一级菜单 + 二级子面板（requirements/04 §4.2.1 / §4.2）。
       挂在 LarkDocOverlays.vue 的固定兄弟层里（祖先有 transform 会让 fixed 漂走，
       且 LarkDocEditor.vue 有 <700 行门禁，新浮层一律不往里塞）。 -->
  <div
    v-if="ed.topbarMoreOpen"
    class="lark-doc-topbar-more"
    :style="ed.topbarMoreStyle"
    role="menu"
    aria-label="更多"
  >
    <ul
      ref="topbarMoreMenu"
      class="lark-doc-topbar-more-list"
    >
      <template v-for="row in ed.topbarMoreRows">
        <li
          v-if="row.kind === 'divider'"
          :key="row.id"
          class="lark-doc-topbar-more-divider"
          role="separator"
        />
        <li
          v-else
          :key="row.item.id"
          class="lark-doc-topbar-more-item"
          :class="{
            'is-submenu': row.item.kind === 'submenu',
            'is-disabled': row.item.enabled === false,
          }"
          :data-topbar-more-id="row.item.id"
          role="menuitem"
          :aria-haspopup="row.item.kind === 'submenu' ? 'menu' : null"
          :aria-expanded="row.item.kind === 'submenu' ? String(ed.topbarMoreSubmenu === row.item.id) : null"
          :aria-disabled="String(row.item.enabled === false)"
          @mouseenter="ed.hoverTopbarMoreItem(row.item)"
          @click="ed.onTopbarMoreItem(row.item)"
        >
          <span class="lark-doc-topbar-more-item-label">{{ row.item.label }}</span>
          <span
            v-if="row.item.affordance === 'arrow'"
            class="lark-doc-topbar-more-item-arrow"
            aria-hidden="true"
          />
        </li>
      </template>
    </ul>

    <!-- 二级：z 1050，零间隙贴父菜单右侧（§4.2 ④-4：父菜单右边缘 = 子面板左边缘）。 -->
    <ul
      v-if="ed.topbarMoreSubmenuItems.length"
      ref="topbarMoreSubmenu"
      class="lark-doc-topbar-more-submenu"
      :style="ed.topbarMoreSubmenuStyle"
      role="menu"
      :aria-label="`更多-${ed.topbarMoreSubmenu}`"
    >
      <template v-for="entry in ed.topbarMoreSubmenuItems">
        <li
          v-if="entry.kind === 'divider'"
          :key="`d-${entry.id}`"
          class="lark-doc-topbar-more-divider"
          role="separator"
        />
        <li
          v-else
          :key="entry.id"
          class="lark-doc-topbar-more-submenu-item"
          :class="{ 'is-switch': entry.kind === 'switch' }"
          role="menuitem"
          @click="ed.onTopbarMoreSubmenuItem(entry)"
        >
          <span class="lark-doc-topbar-more-item-label">{{ entry.label }}</span>
          <span
            v-if="entry.kind === 'switch'"
            class="lark-doc-topbar-more-switch"
            :class="{ 'is-on': isSwitchOn(entry.id) }"
            role="switch"
            :aria-checked="String(isSwitchOn(entry.id))"
            :aria-label="entry.label"
          ><span class="lark-doc-topbar-more-switch-handler" /></span>
        </li>
      </template>
    </ul>
  </div>
</template>

<script>
// TopbarMoreMenu —— 顶栏「更多」菜单视图层。状态与动作全在 editor/topbarMoreMixin.js，
// 这里只做渲染与 a11y 属性；通过实例 prop `ed` 引用编辑器（与 TopBar.vue 同口径）。
export default {
  name: 'LarkDocTopbarMoreMenu',
  props: {
    ed: { type: Object, required: true },
  },
  methods: {
    isSwitchOn(id) {
      if (id === 'show-author') return this.ed.topbarMoreShowAuthor
      if (id === 'offline') return this.ed.topbarMoreOffline
      return false
    },
  },
}
</script>
