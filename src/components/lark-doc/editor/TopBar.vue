<template>
  <!-- 顶部标题栏：layout.headerVisible=false 时整行隐藏，操作入口移入工具栏「⋯」下拉 -->
  <header
    v-if="ed.larkDocConfig.layout.headerVisible"
    class="lark-doc-topbar"
  >
    <div
      class="lark-doc-brand"
      aria-label="文档"
    >
      ✦ <span>文档</span>
    </div>
    <div class="lark-doc-title-wrap">
      <input
        :value="ed.localTitle"
        aria-label="文档标题"
        :maxlength="ed.titleLength"
        placeholder="未命名文档"
        :readonly="ed.effectiveReadonly"
        @input="ed.updateTitle($event.target.value)"
      ><span class="lark-doc-title-sub">{{ ed.effectiveReadonly ? '阅读中' : '单人编辑' }}</span>
    </div>
    <div class="lark-doc-header-actions">
      <!-- 顶栏「新建」（04 §4.6.5，182×509 菜单，z 1030）。
           菜单本体在 `LarkDocOverlays.vue` 的 fixed 兄弟层里：`.lark-doc-header-actions`
           带 `overflow-x: auto`，把 absolute 菜单挂在这里会被裁掉（与「更多」「模式」
           同一条纪律，也是这个按钮只做 `@click` 传锚点的原因）。
           `aria-haspopup="menu"` + `aria-expanded` 与「更多」保持同一套语义。 -->
      <button
        type="button"
        class="lark-doc-create-btn"
        aria-label="新建"
        aria-haspopup="menu"
        :aria-expanded="String(ed.createMenuOpen)"
        @click="ed.toggleCreateMenu($event)"
      >
        <lark-doc-icon
          name="plus"
          :size="16"
        />
      </button>
      <!-- 顶栏「通知」（04 §4.6.4，402×555 popover，z 999）。
           z 比「新建/更多」低一档是 04 §0.3 总表口径，不是笔误。 -->
      <button
        type="button"
        class="lark-doc-notify-btn"
        aria-label="当前文档通知"
        aria-haspopup="dialog"
        :aria-expanded="String(ed.notifyOpen)"
        @click="ed.toggleNotify($event)"
      >
        <lark-doc-icon
          name="bell"
          :size="16"
        />
        <!-- 未读红点：条数由 `notifyUnreadCount` 算，0 条不渲染（不做「0」占位，
             飞书的空态是纯铃铛）。 -->
        <span
          v-if="ed.notifyUnreadCount > 0"
          class="lark-doc-notify-dot"
        >{{ ed.notifyUnreadCount > 99 ? '99+' : ed.notifyUnreadCount }}</span>
      </button>
      <!-- P4-06 三态模式入口（03 顶栏右侧按钮组 #2：84×32、白底、深灰文字、radius 6）。
           必须与下面的 slot **并存**：slot 里是宿主塞进来的控件（LarkDocWorkspace 有 6+ 个），
           历史上「替换掉 slot」的一个改法会让宿主控件全部消失。 -->
      <div class="lark-doc-mode-switch">
        <button
          type="button"
          class="lark-doc-mode-btn"
          aria-haspopup="listbox"
          :aria-label="`切换文档模式，当前${ed.modeLabel}`"
          :aria-expanded="String(ed.modeMenuOpen)"
          @click="ed.toggleModeMenu($event.currentTarget)"
        >
          <lark-doc-icon
            class="lark-doc-mode-btn-icon"
            :name="ed.modeIcon"
            :size="16"
          />
          <span class="lark-doc-mode-btn-label">{{ ed.modeLabel }}</span>
          <lark-doc-icon
            class="lark-doc-mode-btn-caret"
            name="caretSolid"
            :size="12"
          />
        </button>
        <!-- 180×160，三项各 170×50（主标题 + 副标题两行），四周各留 5px -->
        <div
          v-if="ed.modeMenuOpen"
          class="lark-doc-mode-menu"
          :style="ed.modeMenuStyle"
          role="listbox"
          aria-label="文档模式"
        >
          <button
            v-for="item in ed.modeOptions"
            :key="item.id"
            type="button"
            role="option"
            class="lark-doc-mode-item"
            :class="{ 'is-active': ed.mode === item.id }"
            :aria-selected="String(ed.mode === item.id)"
            @click="ed.setMode(item.id)"
          >
            <span class="lark-doc-mode-item-label">{{ item.label }}</span>
            <span class="lark-doc-mode-item-hint">{{ item.hint }}</span>
          </button>
        </div>
      </div>
      <slot name="header-actions" />
      <!-- 顶栏「更多」入口（04 §4.2.1：23 项菜单）。
           菜单位置在 `LarkDocOverlays.vue` 的 fixed 兄弟层里 —— 顶栏 header-actions 有
           `overflow-x: auto`，用 absolute 会被裁掉（与 `.lark-doc-mode-menu` 同一条纪律）。 -->
      <button
        type="button"
        class="lark-doc-more-btn"
        aria-label="更多"
        aria-haspopup="menu"
        :aria-expanded="String(ed.topbarMoreOpen)"
        @click="ed.toggleTopbarMore($event)"
      >
        <lark-doc-icon
          name="more"
          :size="16"
        />
      </button>
    </div>
  </header>
</template>

<script>
import LarkDocIcon from '../LarkDocIcon.vue'

// TopBar —— 从 LarkDocEditor.vue 拆出的顶部标题栏（P0-03 段 1/8）。
// 通过实例 prop `ed` 直接引用父编辑器实例：父组件状态全部住在 editor/*.mixin.js，
// 显式声明 props 会让父组件超行数预算；子模板对 `ed.xxx` 的访问仍受 Vue 依赖
// 追踪精确管控（render 只跟踪实际读取的属性）。
export default {
  name: 'LarkDocTopBar',
  components: { LarkDocIcon },
  props: {
    ed: { type: Object, required: true },
  },
}
</script>
