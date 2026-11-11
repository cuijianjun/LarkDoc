<template>
  <div
    class="lark-doc-document-menu-root"
    @focusout="onFocusout"
  >
    <div
      v-show="ed.headerMenuOpen"
      class="lark-doc-dropdown lark-doc-header-menu lark-doc-document-menu"
      :style="ed.headerMenuStyle"
      role="menu"
      aria-label="文档操作"
      @keydown="onMenuKeydown"
      @keydown.esc.capture="ed.onHeaderMenuEscape($event)"
      @scroll="positionSubmenu"
    >
      <template v-for="item in items">
        <div
          v-if="item.separator"
          :key="`${item.id}-separator`"
          class="lark-doc-document-separator"
          role="separator"
        />
        <button
          :key="item.id"
          type="button"
          :role="item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'"
          :aria-checked="item.checked === undefined ? null : String(item.checked)"
          :data-document-action="item.id"
          :disabled="item.disabled || busy"
          :title="item.disabled ? '当前文档暂不支持此操作' : item.label"
          :aria-haspopup="item.kind === 'submenu' ? 'menu' : null"
          :aria-expanded="item.kind === 'submenu' ? String(submenu === item.id) : null"
          @mouseenter="openSubmenu(item, $event)"
          @click="choose(item, $event)"
        >
          <LarkDocIcon
            :name="item.icon"
            :size="16"
          />
          <span>{{ item.label }}</span><span
            v-if="item.checked !== undefined"
            class="lark-doc-business-switch"
            :class="{ 'is-on': item.checked }"
            aria-hidden="true"
          />
          <LarkDocIcon
            v-if="item.kind === 'submenu'"
            class="lark-doc-document-arrow"
            name="chevronDown"
            :size="12"
          />
        </button>
      </template>
      <details class="lark-doc-document-host-tools">
        <summary>其他工具</summary>
        <div
          role="group"
          aria-label="其他工具"
        >
          <slot />
        </div>
      </details>
    </div>
    <div
      v-if="ed.headerMenuOpen && submenu"
      class="lark-doc-dropdown lark-doc-header-menu lark-doc-document-submenu"
      :style="submenuStyle"
      role="menu"
      :aria-label="submenuLabel"
      @keydown="onSubmenuKeydown"
    >
      <p v-if="submenu === 'width'">
        为当前窗口选择合适页宽
      </p>
      <p
        v-if="!children.length"
        role="status"
      >
        暂无已存版本
      </p>
      <button
        v-for="item in children"
        :key="`${item.id}/${item.value || ''}`"
        type="button"
        :role="['width', 'theme'].includes(submenu) ? 'menuitemradio' : 'menuitem'"
        :aria-checked="['width', 'theme'].includes(submenu) ? String(item.checked) : null"
        :disabled="item.disabled || busy"
        @click="run(item, $event)"
      >
        <span>{{ item.label }}</span><span
          v-if="item.checked !== undefined && submenu !== 'theme'"
          class="lark-doc-business-switch"
          :class="{ 'is-on': item.checked }"
          aria-hidden="true"
        /><span
          v-if="item.checked"
          aria-hidden="true"
        >✓</span>
      </button>
    </div>
    <DocumentInformationDialog
      v-if="information === 'information' && canView"
      ref="information"
      :ed="ed"
      :statistics="statistics"
      @close="closeInformation"
    />
    <div
      v-if="information === 'mentions' && canView"
      class="lark-doc-document-info-mask"
      @keydown.esc.stop.prevent="closeInformation"
      @click.self="closeInformation"
    >
      <section
        ref="information"
        class="lark-doc-document-info"
        role="dialog"
        aria-modal="true"
        :aria-label="information === 'mentions' ? '提及的人' : '文档信息'"
        tabindex="-1"
        @keydown.tab="trapInformationFocus"
      >
        <header>
          <h2>{{ information === 'mentions' ? '提及的人' : '文档信息' }}</h2><button
            type="button"
            aria-label="关闭文档信息"
            @click="closeInformation"
          >
            <LarkDocIcon name="close" />
          </button>
        </header>
        <div
          v-if="information === 'mentions'"
          class="lark-doc-document-statistics"
        >
          <p>当前正文中提及的人，随正文编辑实时更新。</p>
          <ul class="lark-doc-document-people">
            <li
              v-for="person in people"
              :key="person.id"
            >
              <span
                class="lark-doc-document-person-avatar"
                aria-hidden="true"
              >{{ Array.from(person.name)[0] }}</span>
              <div>
                <strong>{{ person.name }}</strong><p v-if="person.department">
                  {{ person.department }}
                </p>
              </div>
            </li>
          </ul>
          <p v-if="!people.length">
            当前正文暂无提及的人
          </p>
        </div>
      </section>
    </div>
    <DocumentBusinessDialog
      v-if="businessProvider && ((businessState && (businessAction || (businessState.status === 'deleted' && !businessDismissed))) || (!businessState && businessPending && !businessDismissed))"
      :key="businessGeneration + (businessState ? '-view' : '-confirmation')"
      ref="businessDialog"
      :ed="ed"
      :provider="businessProvider"
      :state="businessState"
      :action="(!businessState && businessPending ? businessPending.kind : businessAction) || 'restore'"
      :confirmation-only="!businessState"
      :original-operation="businessPending"
      @close="closeBusiness"
      @complete="completeBusiness"
    />
    <div v-if="!businessState && businessPending && businessDismissed" class="lark-doc-toast" role="status">
      操作结果待确认。<button type="button" @click="businessDismissed = false">核对原操作</button>
    </div>
    <div
      v-if="businessState && businessState.status === 'deleted' && businessDismissed"
      class="lark-doc-toast"
      role="status"
    >
      文档已移入回收站。<button
        v-if="businessState.capabilities.canRestore"
        type="button"
        @click="businessAction = 'restore'"
      >
        恢复文档
      </button>
    </div>
    <div
      v-if="businessNotice && (!businessState || businessState.status !== 'deleted')"
      class="lark-doc-toast"
      role="status"
    >
      {{ businessNotice }} <a
        v-if="copyUrl"
        :href="copyUrl"
        target="_blank"
        rel="noopener"
      >打开副本</a><button
        type="button"
        aria-label="关闭操作提示"
        @click="businessNotice = ''; copyUrl = null"
      >
        ×
      </button>
    </div>
    <p
      v-if="error"
      class="lark-doc-toast"
      role="alert"
    >
      {{ error }}
    </p>
  </div>
</template>

<script>
import LarkDocIcon from './LarkDocIcon.vue'
import { createThemeController } from '../../theme'
import { documentMenuItems, documentMenuChildren, documentThemeChoice, documentStatistics, documentMentions, documentMenuRequestMethods } from './editor/documentMenuView'

export default {
  name: 'LarkDocDocumentMenu',
  components: { LarkDocIcon, DocumentInformationDialog: () => import(/* webpackChunkName: "document-information-ui" */ './DocumentInformationDialog.vue'), DocumentBusinessDialog: () => import(/* webpackChunkName: "document-business" */ './DocumentBusinessDialog.vue') },
  props: { ed: { type: Object, required: true } },
  data() { return { submenu: '', submenuStyle: {}, appearance: 'default', information: false, busy: false, error: '', businessProvider: null, businessState: null, businessPending: null, businessAction: '', businessDismissed: false, businessGeneration: 0, businessNotice: '', copyUrl: null } },
  computed: {
    items() { return documentMenuItems(this.ed, this.businessState) },
    children() { return documentMenuChildren(this.ed, this.submenu, this.appearance, this.businessState) },
    submenuLabel() { return this.items.find(item => item.id === this.submenu)?.label || '' },
    canView() { return !this.ed.session || this.ed.session.can('canView') },
    people() { return this.information === 'mentions' && this.ed.editorRevision >= 0 ? documentMentions(this.ed) : [] },
    statistics() { return this.ed.editorRevision >= 0 ? documentStatistics(this.ed) : null },
  },
  watch: {
    'ed.headerMenuOpen'(open) { this.submenu = ''; if (open) { this.error = ''; this.businessNotice = ''; this.copyUrl = null } },
    'ed.session'(value, previous) { if (value !== previous) { this.invalidateRequest(); this.bindBusiness() } },
    'ed.session.documentId'() { this.invalidateRequest(); this.bindBusiness() },
    'ed.commentIdentityGeneration'() { this.invalidateRequest(); this.bindBusiness() },
    'ed.onDocumentAction'() { this.invalidateRequest() },
    canView(value) { if (!value) this.invalidateRequest() },
    'ed.slides'(value) { if (value) this.information = false },
  },
  mounted() {
    const root = this.ed.$el
    if (!root._larkDocTheme) { this._ownedTheme = createThemeController({ theme: root.getAttribute('data-theme') || 'light', contentTheme: root.getAttribute('data-content-theme') || 'auto', getRoot: () => root }); this._ownedTheme.applyToRoot() }
    const sync = () => { this.appearance = documentThemeChoice(root) }
    sync()
    if (typeof MutationObserver === 'function') {
      this._themeObserver = new MutationObserver(sync)
      this._themeObserver.observe(root, { attributes: true, attributeFilter: ['data-theme', 'data-theme-preset'] })
    }
    this.bindBusiness(); window.addEventListener('resize', this.closeSubmenu); if (this.ed.headerMenuOpen) this.$nextTick(() => { this.ed.positionHeaderMenu(); this.ed.focusHeaderMenu() }) },
  beforeDestroy() { this._themeObserver?.disconnect(); this._ownedTheme?.destroy(); this._businessOff?.(); this._businessEvents?.forEach(stop => stop()); window.removeEventListener('resize', this.closeSubmenu) },
  methods: {
    ...documentMenuRequestMethods,
    bindBusiness() {
      this._businessOff?.(); this._businessOff = null
      const session = this.ed.session
      let provider = session?.getProvider?.('documentBusiness')
      if (session !== this._businessSession) {
        this._businessEvents?.forEach(stop => stop()); this._businessSession = session
        const renew = () => { this.$nextTick(() => { if (!this._isDestroyed) this.bindBusiness() }) }
        this._businessEvents = session ? [session.on('identity', renew), session.on('provider-changed', event => { if (['documentBusiness', 'authorization'].includes(event.name)) renew() })] : []
      }
      this.businessGeneration++; this.businessDismissed = false; this.businessAction = ''; this.businessNotice = ''; this.copyUrl = null
      this.businessState = null; this.businessPending = null
      // A reused transport keeps its original document binding, even without an advertised scope.
      this._businessProviderScopes = this._businessProviderScopes || new WeakMap()
      if (provider) {
        try {
          const authorizationScope = session?.getProvider?.('authorization')?.getScope?.()
          const known = provider.getScope?.() || this._businessProviderScopes.get(provider)
          const snapshot = known ? null : provider.getState()
          const bound = known || { docId: snapshot?.docId || session?.documentId, tenantId: snapshot?.tenantId || authorizationScope?.tenantId }
          this._businessProviderScopes.set(provider, bound)
          if (bound.docId !== session?.documentId || (authorizationScope?.docId && bound.docId !== authorizationScope.docId) || (authorizationScope?.tenantId && bound.tenantId && bound.tenantId !== authorizationScope.tenantId)) provider = null
        } catch { provider = null }
      }
      const scope = JSON.stringify([session?.documentId, session?.user?.id, session?._privateIdentityGeneration])
      if (scope !== this._businessScope || provider !== this.businessProvider) { this._businessSeenDeleted = false; this._businessScope = scope }
      this.businessProvider = provider || null; this.businessState = provider?.getState() || null; this.businessPending = provider?.getPending()[0] || null; this.ed.setDocumentBusinessDeleted(this.businessState?.status === 'deleted')
      if (!provider) return
      const binding = this.businessGeneration, identity = session._privateIdentityGeneration, documentId = session.documentId, principal = session.user?.id
      this._businessOff = provider.subscribe(value => {
        if (this._isDestroyed || binding !== this.businessGeneration || session !== this.ed.session || provider !== this.businessProvider || provider !== session.getProvider('documentBusiness') || identity !== session._privateIdentityGeneration || documentId !== session.documentId || principal !== session.user?.id) return
        const restored = value.document?.status === 'active' && this._businessSeenDeleted
        if (value.document) this._businessSeenDeleted = value.document.status === 'deleted'
        this.businessState = value.document; this.businessPending = provider.getPending()[0] || null; this.ed.setDocumentBusinessDeleted(value.document?.status === 'deleted')
        if (!value.document) { this.businessAction = ''; return }
        if (value.foldersChanged) this.$refs.businessDialog?.refreshFolders()
        if (value.document.status === 'active') this.businessDismissed = false
        if (restored || (!this._businessRefresh && ((value.document.status === 'deleted' && session.can('canView')) || (value.document.status === 'active' && !session.can('canView'))))) {
          const identity = session._privateIdentityGeneration, previous = this._businessRefresh
          const current = () => !this._isDestroyed && session === this.ed.session && provider === this.businessProvider && identity === session._privateIdentityGeneration
          const work = (async () => {
            await previous
            if (!current()) return
            await session.refreshCapabilities()
            if (restored && current() && this.businessState?.status === 'active' && session.can('canView')) return session.connect()
          })().catch(() => {})
          this._businessRefresh = work
          void work.finally(() => { if (this._businessRefresh === work) this._businessRefresh = null })
        }
      })
    },
    closeBusiness() { this.businessAction = ''; this.businessDismissed = true; this.ed._headerMenuTrigger?.focus() },
    async completeBusiness(result) {
      const session = this.ed.session, provider = this.businessProvider, generation = session?._privateIdentityGeneration
      const confirmationOnly = !this.businessState && Boolean(this.businessPending)
      this.businessPending = null
      this.businessAction = ''
      this.businessNotice = ({ follow: '关注状态已更新', favorite: '收藏状态已更新', move: '已移动', duplicate: '副本已创建', delete: '已移入回收站', restore: '文档已恢复', pin: '置顶状态已更新', shortcut: '快捷方式已添加', 'transfer-ownership': '所有权已转移' })[result.kind] || '操作已完成'
      this.copyUrl = result.newDocId ? provider.getDocumentUrl?.(result.newDocId) : null
      if (confirmationOnly) return
      session?.emit('document-business-committed', result)
      try { const current = await provider.load(); if (!this._isDestroyed && session === this.ed.session && provider === this.businessProvider && generation === session?._privateIdentityGeneration) this.businessState = current } catch { /* committed acknowledgement remains authoritative; stream will re-authorize the view */ }
    },
    closeSubmenu() { this.submenu = '' },
    openSubmenu(item, event) {
      if (item.disabled || this.busy) return
      if (item.kind !== 'submenu') { this.submenu = ''; return }
      if (this.submenu === item.id) return
      this.submenu = item.id; this._submenuTrigger = event.currentTarget
      if (item.id === 'saved-versions') void this.ed.loadVersions().catch(() => {})
      this.$nextTick(this.positionSubmenu)
    },
    positionSubmenu() {
      if (!this.submenu) return
      const anchor = this._submenuTrigger
      if (!anchor?.isConnected) return this.closeSubmenu()
      const node = this.$el.querySelector('.lark-doc-document-submenu')
      if (!node) return
      const rect = anchor.getBoundingClientRect()
      const menu = this.$el.querySelector('.lark-doc-document-menu').getBoundingClientRect()
      // scroll可能晚于mouseenter到达；触发项仍可见时只重定位，避免卸载刚打开的子菜单。
      if (rect.bottom <= menu.top || rect.top >= menu.bottom) return this.closeSubmenu()
      const submenu = node.getBoundingClientRect()
      const right = menu.right, left = right + submenu.width <= window.innerWidth - 8 ? right : Math.max(8, menu.left - submenu.width)
      this.submenuStyle = { left: `${left}px`, right: 'auto', top: `${Math.max(8, Math.min(rect.top, window.innerHeight - submenu.height - 8))}px`, maxHeight: `${window.innerHeight - 16}px`, marginTop: '0' }
    },
    choose(item, event) { if (item.kind === 'submenu') return this.openSubmenu(item, event); return this.run(item, event) },
    onMenuKeydown(event) {
      if (event.key === 'ArrowRight') {
        const item = this.items.find(item => item.id === event.target?.dataset?.documentAction)
        if (item?.kind === 'submenu' && !item.disabled) { event.preventDefault(); event.stopPropagation(); this.openSubmenu(item, { currentTarget: event.target }); this.$nextTick(() => this.$el.querySelector('.lark-doc-document-submenu button:not(:disabled)')?.focus()) }
        return
      }
      if (event.key === 'Escape' && this.submenu) { event.preventDefault(); event.stopPropagation(); this.submenu = ''; return }
      this.ed.onHeaderMenuKeydown(event)
    },
    onSubmenuKeydown(event) {
      if (['Escape', 'ArrowLeft'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); this.submenu = ''; this._submenuTrigger?.focus(); return }
      this.ed.onHeaderMenuKeydown(event)
    },
    onFocusout(event) { this.ed.onHeaderMenuFocusout(event) },
    closeInformation() { this.information = false; this.ed._headerMenuTrigger?.focus() },
    openHostInformation(tab) { this.information = false; void this.run({ id: 'information-host', value: tab }) },
    trapInformationFocus(event) {
      const items = [...this.$refs.information.querySelectorAll('button:not(:disabled)')]
      if (!items.length) return
      const index = items.indexOf(event.target), next = event.shiftKey ? index - 1 : index + 1
      if (next < 0 || next >= items.length) { event.preventDefault(); items[event.shiftKey ? items.length - 1 : 0].focus() }
    },
  },
}
</script>

<style>
.lark-doc .lark-doc-deleted-document { display: grid; place-items: center; flex: 1; margin: 0; padding: 32px; color: var(--ld-text-tertiary); }
.lark-doc .lark-doc-document-menu-root { display: contents; }
.lark-doc .lark-doc-document-menu-root > .lark-doc-header-menu { box-sizing: border-box; width: max-content; max-width: calc(100vw - 16px); max-height: calc(100vh - 16px); padding: 2px 0; gap: 0; border: 1px solid var(--ld-border-chrome); border-radius: 6px; box-shadow: var(--ld-shadow-chrome); color: var(--ld-text); font-size: 14px; line-height: 22px; overflow-y: auto; }
.lark-doc[data-theme-preset="feishu"][data-theme="light"] .lark-doc-document-menu-root > .lark-doc-header-menu { box-shadow: rgba(31, 35, 41, 0.04) 0 8px 24px 8px, rgba(31, 35, 41, 0.04) 0 6px 12px 0, rgba(31, 35, 41, 0.06) 0 4px 8px -8px; }
.lark-doc[data-theme-preset="feishu"][data-theme="dark"] .lark-doc-document-menu-root > .lark-doc-header-menu { box-shadow: rgba(0, 0, 0, 0.04) 0 8px 24px 8px, rgba(0, 0, 0, 0.04) 0 6px 12px 0, rgba(0, 0, 0, 0.06) 0 4px 8px -8px; }
.lark-doc .lark-doc-document-menu-root .lark-doc-document-menu { min-width: min(175px, calc(100vw - 16px)); }
.lark-doc .lark-doc-document-menu-root .lark-doc-document-menu > button[role], .lark-doc .lark-doc-document-menu-root .lark-doc-document-submenu > button[role] { display: flex; box-sizing: border-box; align-items: center; flex-shrink: 0; gap: 8px; width: auto; height: 28px; min-height: 28px; margin: 1px 3px; padding: 3px 8px; border: 0; border-radius: 4px; background: transparent; text-align: left; font-size: 14px; line-height: 22px; white-space: nowrap; }
.lark-doc .lark-doc-document-menu-root .lark-doc-document-separator { flex: 0 0 1px; margin: 3px 0; background: var(--ld-divider); }
.lark-doc .lark-doc-document-menu > button > .lark-doc-icon { flex-shrink: 0; color: var(--ld-text-secondary); }
.lark-doc .lark-doc-document-menu button:hover:not(:disabled), .lark-doc .lark-doc-document-submenu button:hover:not(:disabled) { background: var(--ld-bg-hover-chrome); }
.lark-doc .lark-doc-document-menu > button > .lark-doc-document-arrow { margin-left: auto; color: var(--ld-text-tertiary); transform: rotate(-90deg); }
.lark-doc .lark-doc-document-menu-root .lark-doc-document-submenu { z-index: 66; }
.lark-doc .lark-doc-document-submenu > p { margin: 5px 12px; color: var(--lark-doc-muted); font-size: 12px; }
.lark-doc .lark-doc-document-menu-root .lark-doc-document-submenu > button[role] { justify-content: space-between; }
.lark-doc .lark-doc-document-submenu [aria-checked="true"] { color: var(--lark-doc-green); }
.lark-doc .lark-doc-document-host-tools { border-top: 1px solid var(--ld-border-chrome); padding: 8px 12px; font-size: 13px; }
.lark-doc .lark-doc-document-host-tools summary { cursor: pointer; }
.lark-doc .lark-doc-document-host-tools [role="group"] { display: grid; gap: 5px; margin-top: 8px; }
.lark-doc .lark-doc-document-info-mask { position: fixed; inset: 0; z-index: 1001; display: grid; place-items: center; padding: 16px; background: var(--ld-mask); }
.lark-doc .lark-doc-document-info { box-sizing: border-box; width: min(720px, 100%); max-height: calc(100dvh - 32px); display: flex; flex-direction: column; overflow: hidden; border-radius: 8px; background: var(--ld-bg-surface-chrome); box-shadow: var(--ld-shadow-dialog); }
.lark-doc .lark-doc-document-info header { flex-shrink: 0; display: flex; justify-content: space-between; align-items: center; padding: 16px 24px; border-bottom: 1px solid var(--ld-border-chrome); }
.lark-doc .lark-doc-document-info h2 { margin: 0; font-size: 18px; }
.lark-doc .lark-doc-document-info nav { flex-shrink: 0; display: flex; flex-wrap: wrap; gap: 8px; padding: 12px 24px; }
.lark-doc .lark-doc-document-info [aria-current="page"] { color: var(--lark-doc-green); background: var(--ld-bg-selected); }
.lark-doc .lark-doc-document-statistics { min-height: 0; overflow: auto; overscroll-behavior: contain; padding: 8px 24px 24px; }
.lark-doc .lark-doc-document-statistics dl { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.lark-doc .lark-doc-document-statistics dd { margin: 0; }
.lark-doc .lark-doc-document-statistics p { font-size: 12px; color: var(--lark-doc-muted); }
.lark-doc .lark-doc-document-people { list-style: none; padding: 0; }
.lark-doc .lark-doc-document-people li { display: flex; align-items: center; gap: 12px; padding: 10px 0; }
.lark-doc .lark-doc-document-person-avatar { display: grid; place-items: center; flex: 0 0 32px; height: 32px; border-radius: 50%; color: var(--ld-text-on-brand); background: var(--lark-doc-green); }
.lark-doc .lark-doc-business-switch { position: relative; margin-left: auto; width: 26px; height: 14px; border-radius: 8px; background: var(--ld-bg-switch-off); }
.lark-doc .lark-doc-business-switch::after { content: ''; position: absolute; left: 2px; top: 2px; width: 10px; height: 10px; border-radius: 50%; background: var(--ld-bg-switch-thumb); }
.lark-doc .lark-doc-business-switch.is-on { background: var(--ld-brand-chrome); }
.lark-doc .lark-doc-business-switch.is-on::after { left: 14px; }
</style>
