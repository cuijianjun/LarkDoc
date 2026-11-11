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
      ><span class="lark-doc-title-sub">{{ ed.collaborationLabel }}</span>
    </div>
    <div class="lark-doc-header-actions">
      <div
        v-if="ed.collaborationUsers.length"
        class="lark-doc-collaborators"
        aria-label="当前协作者"
      >
        <span
          v-for="user in ed.collaborationUsers"
          :key="user.id || user.name"
          class="lark-doc-collaborator"
          :class="`lark-doc-peer-color-${user.colorIndex || 0}`"
          :title="user.name"
          :aria-label="`${user.name}，当前协作者`"
        >{{ user.name.slice(0, 1).toUpperCase() }}<i aria-hidden="true" /></span>
      </div>
      <div
        v-if="ed.shareEntryVisible"
        class="lark-doc-share-entry"
      >
        <button
          type="button"
          class="lark-doc-share-btn-filled"
          :aria-label="ed.shareEntryLabel"
          @click="ed.toggleSharePopover($event)"
        >
          {{ ed.shareEntryLabel }}
        </button>
      </div>
      <button v-if="ed.session && ed.session.can('canView') && !ed.session.can('canEdit') && ed.session.getProvider('authorization') && ed.session.getProvider('authorization').documentAccess"
        type="button" class="lark-doc-share-btn-outlined" aria-label="申请编辑权限" @click="ed.openDocumentAccessRequests('self')">申请编辑权限</button>
      <!-- 常用操作常驻；宿主控件由文档操作菜单完整承接。 -->
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
      <button
        v-if="ed.commentRemote && ed.commentCan('canView')"
        type="button"
        class="lark-doc-mode-btn"
        aria-label="展开评论侧栏"
        :aria-expanded="String(ed.commentSidebarOpen)"
        @click="ed.toggleCommentSidebar()"
      >
        <lark-doc-icon
          name="mode-comment"
          :size="16"
        /><span>评论{{ ed.commentSelectionCount ? `（${ed.commentSelectionCount}）` : '' }}</span>
      </button>
      <button
        v-if="ed.nativeSearchAvailable"
        type="button"
        class="lark-doc-mode-btn lark-doc-header-more lark-doc-native-search-button"
        aria-label="搜索云文档"
        title="搜索云文档"
        aria-haspopup="dialog"
        :aria-expanded="String(ed.nativePanel === 'search')"
        @click="ed.toggleNativePanel('search', $event)"
      ><lark-doc-icon name="search" :size="18" /></button>
      <button
        v-if="ed.nativeNotificationsAvailable"
        type="button"
        class="lark-doc-mode-btn lark-doc-header-more lark-doc-native-bell"
        :aria-label="`当前文档通知${ed.nativeUnreadCount == null ? '' : `，${ed.nativeUnreadCount}条未读`}`"
        title="当前文档通知"
        aria-haspopup="dialog"
        :aria-expanded="String(ed.nativePanel === 'notifications')"
        @click="ed.toggleNativePanel('notifications', $event)"
      ><svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 14h12l-1.5-2V8a4.5 4.5 0 0 0-9 0v4L4 14ZM8 17h4" /></svg><span v-if="ed.nativeUnreadCount > 0" class="lark-doc-native-unread">{{ ed.nativeUnreadCount > 99 ? '99+' : ed.nativeUnreadCount }}</span></button>
      <button
        type="button"
        class="lark-doc-mode-btn lark-doc-header-more"
        aria-label="文档操作"
        title="文档操作"
        aria-haspopup="menu"
        :aria-expanded="String(ed.headerMenuOpen)"
        @click="ed.toggleHeaderMenu($event)"
        @keydown.down.prevent="ed.openHeaderMenuFrom($event)"
      >
        ⋯
      </button>
      <div class="lark-doc-create-entry" @focusout="ed.onCreateMenuFocusout">
        <button
          type="button"
          class="lark-doc-mode-btn lark-doc-header-more"
          aria-label="创建"
          title="创建"
          aria-haspopup="menu"
          :aria-expanded="String(ed.createMenuOpen)"
          @click="ed.toggleCreateMenu($event)"
          @keydown.down.prevent="ed.openCreateMenuFrom($event)"
        >
          <lark-doc-icon name="plus" :size="18" />
        </button>
        <div
          v-if="ed.createMenuOpen"
          class="lark-doc-create-menu"
          :style="ed.createMenuStyle"
          role="menu"
          aria-label="创建"
          @keydown.esc.stop.prevent="ed.closeCreateMenu(true)"
        >
          <button
            v-for="item in ed.createMenuItems"
            :key="item.id"
            type="button"
            role="menuitem"
            :data-create-action="item.id"
            @click="ed.runCreateMenuItem(item, $event)"
          ><span class="lark-doc-create-menu-icon" aria-hidden="true">{{ item.glyph }}</span><span>{{ item.label }}</span></button>
        </div>
      </div>
      <DocumentMenu :ed="ed">
        <slot name="header-actions" />
      </DocumentMenu>
    </div>
  </header>
</template>

<script>
import LarkDocIcon from '../LarkDocIcon.vue'
const DocumentMenu = () => import(/* webpackChunkName: "document-menu" */ '../DocumentMenu.vue')

// TopBar —— 从 LarkDocEditor.vue 拆出的顶部标题栏（P0-03 段 1/8）。
// 通过实例 prop `ed` 直接引用父编辑器实例：父组件状态全部住在 editor/*.mixin.js，
// 显式声明 props 会让父组件超行数预算；子模板对 `ed.xxx` 的访问仍受 Vue 依赖
// 追踪精确管控（render 只跟踪实际读取的属性）。
export default {
  name: 'LarkDocTopBar',
  components: { LarkDocIcon, DocumentMenu },
  props: {
    ed: { type: Object, required: true },
  },
}
</script>

<style scoped>
.lark-doc .lark-doc-mode-btn.lark-doc-native-bell, .lark-doc .lark-doc-mode-btn.lark-doc-native-search-button { position: relative; justify-content: center; }
.lark-doc .lark-doc-native-unread { position: absolute; top: -3px; right: -5px; min-width: 14px; padding: 0 3px; border-radius: 8px; background: var(--ld-danger); color: var(--ld-text-inverse); font-size: 10px; line-height: 14px; }
.lark-doc .lark-doc-create-entry { position: relative; display: inline-flex; flex: 0 0 auto; }
.lark-doc .lark-doc-create-menu { position: fixed; z-index: 66; display: grid; width: 220px; max-height: min(520px, calc(100vh - 16px)); overflow-y: auto; padding: 6px; border: 1px solid var(--ld-border-chrome); border-radius: 8px; background: var(--ld-bg-surface-chrome); box-shadow: var(--ld-shadow-chrome); color: var(--ld-text); }
.lark-doc .lark-doc-create-menu button { display: flex; align-items: center; gap: 10px; box-sizing: border-box; width: 100%; height: 36px; padding: 0 10px; border: 0; border-radius: 6px; background: transparent; color: inherit; font-size: 14px; line-height: 22px; text-align: left; white-space: nowrap; cursor: pointer; }
.lark-doc .lark-doc-create-menu button:hover { background: var(--ld-bg-hover-chrome); }
.lark-doc .lark-doc-create-menu-icon { display: inline-flex; width: 20px; justify-content: center; color: var(--ld-text-secondary); font-size: 15px; }
</style>
