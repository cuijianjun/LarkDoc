<template>
  <div
    v-if="visible"
    class="lark-doc-business-mask"
    @click.self="close"
    @keydown.esc.stop.prevent="close"
  >
    <section
      ref="dialog"
      class="lark-doc-business-dialog"
      role="dialog"
      aria-modal="true"
      :aria-label="title"
      tabindex="-1"
      @keydown.tab="trap"
    >
      <header>
        <h2>{{ title }}</h2><button
          type="button"
          aria-label="关闭业务弹窗"
          @click="close"
        >
          <LarkDocIcon name="close" />
        </button>
      </header>
      <div class="lark-doc-business-body">
        <template v-if="confirmationOnly">
          <p>当前无法查看文档，可在这里核对刚才的操作结果。</p>
          <p>核对只查询原操作，不会重新执行。</p>
        </template>
        <template v-else-if="pending">
          <p>操作结果正在确认，请先核对结果。</p>
          <p>核对只查询刚才的操作，不会重复执行。</p>
        </template>
        <template v-else-if="deleted">
          <p>文档已移入回收站。</p><p>恢复后，原来的协作者和文档内容会保留。</p>
        </template>
        <template v-else-if="action === 'delete'">
          <p>确定删除“{{ ed.localTitle || '未命名文档' }}”？</p>
          <p>删除后协作者将无法查看或编辑，可以从此处恢复。</p>
        </template>
        <template v-else-if="action === 'transfer-ownership'">
          <p>选择接收所有权的当前文档协作者。</p>
          <div role="listbox" aria-label="选择新所有者" class="lark-doc-business-folders" :aria-busy="String(candidatesLoading)" @keydown="ownerKey">
            <button v-for="person in candidates" :key="person.principalId" type="button" role="option" :aria-selected="String(targetPrincipalId === person.principalId)" :disabled="busy || candidatesLoading" @click="selectOwner(person.principalId)">
              {{ person.displayName }}
            </button>
            <p v-if="!candidatesLoading && !candidates.length">暂无符合转移条件的协作者。</p>
          </div>
          <button type="button" :disabled="busy || candidatesLoading" @click="loadOwnershipCandidates">刷新协作者</button>
          <fieldset class="lark-doc-business-retention" :disabled="busy || candidatesLoading || Boolean(pending)">
            <legend>转移后</legend>
            <label><input type="radio" :name="'ownership-retention-' + _uid" :checked="!removeOldOwner" @change="setRetention(false)">保留我的协作者权限</label>
            <select aria-label="转移后保留的权限" :value="oldOwnerPerm" :disabled="removeOldOwner" @change="setOldOwnerPerm($event.target.value)">
              <option value="full_access">可管理</option><option value="edit">可编辑</option><option value="view">可阅读</option>
            </select>
            <label><input type="radio" :name="'ownership-retention-' + _uid" :checked="removeOldOwner" @change="setRetention(true)">不保留我的协作者权限</label>
          </fieldset>
          <p>{{ retentionSummary }}</p>
          <p>其他独立授权可能仍然有效，请以转移后的实际权限为准。</p>
          <p v-if="transferConfirm" role="status">确认将所有权转移给“{{ selectedOwner && selectedOwner.displayName }}”？</p>
        </template>
        <template v-else-if="['move', 'duplicate', 'shortcut'].includes(action)">
          <label
            v-if="action === 'duplicate'"
            class="lark-doc-business-name"
          >副本名称<input
            v-model="name"
            aria-label="副本名称"
            maxlength="100"
          ></label>
          <div class="lark-doc-business-location">
            <strong>{{ action === 'move' ? '移动到' : action === 'shortcut' ? '添加快捷方式到' : '保存到' }}</strong><button
              type="button"
              :disabled="busy"
              @click="loadFolders"
            >
              刷新位置
            </button>
          </div>
          <nav
            class="lark-doc-business-path"
            aria-label="当前位置"
          >
            <button
              type="button"
              @click="parentId = null; selected = null"
            >
              全部位置
            </button>
            <button
              v-for="item in breadcrumbs"
              :key="item.id"
              type="button"
              @click="parentId = item.id; selected = item.id"
            >
              {{ item.name }}
            </button>
          </nav>
          <div
            role="listbox"
            aria-label="选择目标文件夹"
            class="lark-doc-business-folders"
            @keydown="folderKey"
          >
            <button
              v-for="folder in visibleFolders"
              :key="folder.id"
              type="button"
              role="option"
              :aria-selected="String(selected === folder.id)"
              :aria-disabled="String(!folder.canWrite)"
              @click="selected = folder.id"
              @dblclick="parentId = folder.id; selected = folder.id"
            >
              <LarkDocIcon name="outline" /><span>{{ folder.name }}</span><small v-if="!folder.canWrite">只读</small><span aria-hidden="true">›</span>
            </button>
            <p v-if="!visibleFolders.length">
              此位置没有子文件夹
            </p>
          </div>
          <div
            v-if="canCreateFolder"
            class="lark-doc-business-new-folder"
          >
            <input
              v-model="folderName"
              aria-label="新文件夹名称"
              placeholder="新文件夹名称"
              maxlength="100"
            ><button
              type="button"
              :disabled="busy || !folderName.trim()"
              @click="createFolder"
            >
              新建文件夹
            </button>
          </div>
          <p v-if="action === 'move'">
            移动不会改变现有协作者和文档权限。
          </p>
          <p v-else-if="action === 'shortcut'">
            快捷方式仅添加到你的目标目录，不会移动原文档、复制正文或改变协作者权限。
          </p>
          <p v-else>
            副本包含当前正文和附件，不包含原文档的评论、历史版本或协作者权限。
          </p>
          <p v-if="action === 'shortcut' && existingShortcut">此位置已包含该文档的快捷方式。</p>
        </template>
        <p
          v-if="error"
          class="lark-doc-business-error"
          role="alert"
        >
          {{ error }}
        </p>
        <p
          v-if="notice"
          role="status"
        >
          {{ notice }}
        </p>
      </div>
      <footer>
        <button
          v-if="!deleted"
          type="button"
          :disabled="busy"
          @click="close"
        >
          取消
        </button>
        <button
          v-if="pending"
          type="button"
          class="is-primary"
          :disabled="busy"
          @click="query"
        >
          核对结果
        </button>
        <button
          v-else-if="deleted && state.capabilities.canRestore"
          type="button"
          class="is-primary"
          :disabled="busy"
          @click="submit('restore')"
        >
          恢复文档
        </button>
        <button
          v-else-if="!deleted && !confirmationOnly"
          type="button"
          :class="action === 'delete' ? 'is-danger' : 'is-primary'"
          :disabled="busy || !canSubmit"
          @click="action === 'transfer-ownership' ? confirmTransfer() : submit(action)"
        >
          {{ action === 'transfer-ownership' ? transferConfirm ? '确认转移' : '下一步' : action === 'move' ? '移动' : action === 'duplicate' ? '创建副本' : action === 'shortcut' ? '添加快捷方式' : action === 'delete' ? '删除' : '重试' }}
        </button>
      </footer>
    </section>
  </div>
  <p
    v-else
    class="lark-doc-toast"
    role="status"
  >
    正在{{ action === 'follow' ? '更新关注状态' : action === 'pin' ? '更新置顶状态' : '更新收藏状态' }}…
  </p>
</template>

<script>
/* global globalThis */
import LarkDocIcon from './LarkDocIcon.vue'
const operationId = () => 'business-' + globalThis.crypto.randomUUID()
export default {
  name: 'LarkDocDocumentBusinessDialog',
  components: { LarkDocIcon },
  props: { ed: { type: Object, required: true }, provider: { type: Object, required: true }, state: { type: Object, default: null }, action: { type: String, required: true }, confirmationOnly: { type: Boolean, default: false }, originalOperation: { type: Object, default: null } },
  data() { return { folders: [], selected: null, parentId: null, folderName: '', name: '', busy: false, pending: null, error: '', notice: '', baseline: null,
    candidates: [], candidatesLoading: false, targetPrincipalId: '', transferConfirm: false, removeOldOwner: false, oldOwnerPerm: 'full_access' } },
  computed: {
    deleted() { return !this.confirmationOnly && this.state?.status === 'deleted' },
    visible() { return this.confirmationOnly || this.deleted || !['follow', 'favorite', 'pin'].includes(this.action) || !!this.pending || !!this.error },
    title() { return this.confirmationOnly || this.pending ? '确认操作结果' : this.deleted ? '文档已删除' : ({ move: '移动到', duplicate: '创建副本', shortcut: '添加快捷方式到', 'transfer-ownership': '转移所有权', delete: '删除文档', follow: '关注文档更新', favorite: '收藏文档', pin: '置顶文档' })[this.action] || '文档操作' },
    visibleFolders() { return this.folders.filter(f => (f.parentId || null) === this.parentId) },
    selectedFolder() { return this.folders.find(f => f.id === this.selected) },
    canCreateFolder() { return !!this.folders.find(f => f.id === (this.parentId || this.selected) && f.canWrite) },
    selectedOwner() { return this.candidates.find(item => item.principalId === this.targetPrincipalId) },
    retentionSummary() { return (this.removeOldOwner ? '不保留原所有者的协作者权限' : '原所有者保留' + ({ full_access: '可管理', edit: '可编辑', view: '可阅读' })[this.oldOwnerPerm] + '权限') + '，文档位置保持不变。' },
    existingShortcut() { return this.state?.shortcuts?.some(item => item.folderId === this.selected) },
    canSubmit() { return !this.confirmationOnly && !!this.state && (this.action === 'transfer-ownership' ? !this.candidatesLoading && !!this.selectedOwner && typeof this.removeOldOwner === 'boolean' && ['full_access', 'edit', 'view'].includes(this.oldOwnerPerm) && this.state.capabilities.canTransferOwnership === true : ['move', 'duplicate', 'shortcut'].includes(this.action) ? this.selectedFolder?.canWrite && (this.action !== 'duplicate' || this.name.trim()) : true) },
    breadcrumbs() { const result = [], seen = new Set(); let at = this.parentId; while (at && !seen.has(at)) { seen.add(at); const row = this.folders.find(f => f.id === at); if (!row) break; result.unshift(row); at = row.parentId } return result },
  },
  watch: {
    'state.status'(value) { if (value === 'deleted') this.error = '' },
    'state.capabilities.canTransferOwnership'(value) { if (value !== true) { this._candidateRead = (this._candidateRead || 0) + 1; this.transferConfirm = false; this.targetPrincipalId = ''; this.candidates = []; this.candidatesLoading = false } },
    visible(value) { if (value) this.focusDialog() },
  },
  mounted() {
    const session = this.ed.session
    this._owner = { session, generation: session?._privateIdentityGeneration, principal: session?.user?.id, documentId: session?.documentId, provider: this.provider, action: this.action }
    this.baseline = this.state ? { ...this.state } : null; this.name = (this.ed.localTitle || '未命名文档').slice(0, 90) + ' 的副本'
    this.pending = this.confirmationOnly ? this.confirmationOperation() : this.provider.getPending()[0] || null
    this.focusDialog()
    if (this.confirmationOnly) { if (!this.pending) this.error = '当前没有可核对的原操作。'; return }
    if (!this.pending && !this.deleted && ['move', 'duplicate', 'shortcut'].includes(this.action)) void this.loadFolders()
    if (!this.pending && !this.deleted && ['follow', 'favorite', 'pin'].includes(this.action)) void this.submit(this.action)
    if (!this.pending && !this.deleted && this.action === 'transfer-ownership') void this.loadOwnershipCandidates()
  },
  beforeDestroy() { this._closed = true },
  methods: {
    confirmationOperation() { const original = this.originalOperation; return original && this.provider.getPending().find(value => value.operationId === original.operationId && value.kind === original.kind) || null },
    current() { const o = this._owner, s = this.ed.session; return !this._closed && !this._isBeingDestroyed && !this._isDestroyed && !this.ed._isBeingDestroyed && !this.ed._isDestroyed && !!o && o.session === s && !s?._destroyed && o.generation === s?._privateIdentityGeneration && o.principal === s?.user?.id && o.documentId === s?.documentId && o.provider === this.provider && (!s?.getProvider || s.getProvider('documentBusiness') === o.provider) && o.action === this.action },
    focusDialog() { this.$nextTick(() => { if (!this._closed) this.$refs.dialog?.focus() }) },
    close() { if (this.busy) return; this.$emit('close') },
    trap(event) { const list = [...this.$refs.dialog.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled)')]; if (!list.length) return; const at = list.indexOf(event.target), next = at + (event.shiftKey ? -1 : 1); if (next < 0 || next >= list.length) { event.preventDefault(); list[event.shiftKey ? list.length - 1 : 0].focus() } },
    folderKey(event) {
      const rows = [...event.currentTarget.querySelectorAll('[role="option"]')], at = rows.indexOf(event.target)
      if (at < 0) return
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault()
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : (at + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length
        this.selected = this.visibleFolders[next].id; rows[next].focus()
      } else if (event.key === 'ArrowRight') {
        event.preventDefault(); this.parentId = this.visibleFolders[at].id; this.selected = this.parentId
        this.$nextTick(() => this.$refs.dialog.querySelector('[role="option"]')?.focus())
      } else if (event.key === 'ArrowLeft' && this.parentId) {
        event.preventDefault(); const row = this.folders.find(f => f.id === this.parentId)
        this.selected = this.parentId; this.parentId = row?.parentId || null
        this.$nextTick(() => this.$refs.dialog.querySelector('[aria-selected="true"]')?.focus())
      }
    },
    async loadFolders() {
      if (this.confirmationOnly) return
      const request = this._folderRead = (this._folderRead || 0) + 1
      try { const rows = await this.provider.folders(); if (!this.current() || request !== this._folderRead) return; this.folders = rows; if (!rows.some(f => f.id === this.selected && f.canWrite)) this.selected = rows.find(f => f.canWrite)?.id || null }
      catch { if (this.current()) this.error = '无法读取目标位置，请稍后重试。' }
    },
    async refreshFolders() { if (['move', 'duplicate', 'shortcut'].includes(this.action)) await this.loadFolders() },
    selectOwner(id) { this.targetPrincipalId = id; this.transferConfirm = false },
    setRetention(value) { if (!this.busy && !this.pending && typeof value === 'boolean') { this.removeOldOwner = value; this.transferConfirm = false } },
    setOldOwnerPerm(value) { if (!this.busy && !this.pending && !this.removeOldOwner && ['full_access', 'edit', 'view'].includes(value)) { this.oldOwnerPerm = value; this.transferConfirm = false } },
    ownerKey(event) {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
      const rows = [...event.currentTarget.querySelectorAll('[role="option"]')], at = rows.indexOf(event.target)
      if (!rows.length || at < 0) return
      event.preventDefault()
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : (at + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length
      this.selectOwner(this.candidates[next].principalId); rows[next].focus()
    },
    async loadOwnershipCandidates() {
      if (this.confirmationOnly || this.state?.capabilities.canTransferOwnership !== true) return
      const request = this._candidateRead = (this._candidateRead || 0) + 1
      this.transferConfirm = false; this.targetPrincipalId = ''; this.candidates = []; this.candidatesLoading = true
      try {
        const value = await this.provider.ownershipCandidates()
        if (!this.current() || request !== this._candidateRead || this.state?.capabilities.canTransferOwnership !== true) return
        this.baseline = { ...this.baseline, revision: value.revision, authzVersion: value.authzVersion, ownershipEligibilityRevision: value.eligibilityRevision }
        this.candidates = value.items
      } catch { if (this.current() && request === this._candidateRead) this.error = '无法确认接收者资格，请刷新协作者或联系管理员。' }
      finally { if (this.current() && request === this._candidateRead) this.candidatesLoading = false }
    },
    confirmTransfer() {
      if (this.busy || this.pending || !this.canSubmit) return
      if (!this.transferConfirm) { this.transferConfirm = true; return }
      return this.submit('transfer-ownership')
    },
    async createFolder() {
      if (this.confirmationOnly || !this.current() || this.busy || !this.canCreateFolder) return
      await this.perform({ kind: 'create-folder', operationId: operationId(), expectedRevision: '0', folderId: this.parentId || this.selected, name: this.folderName.trim() }, true)
    },
    async submit(kind) {
      if (this.busy || this.pending || !this.canSubmit) return
      let base = this.baseline
      if (kind === 'duplicate') {
        this.busy = true
        try { const latest = await this.provider.load(); if (!this.current()) return; base = { ...base, epoch: latest.epoch, contentRevision: latest.contentRevision } }
        catch { if (this.current()) this.error = '无法读取当前正文，请稍后重试。'; return }
        finally { if (this.current()) this.busy = false }
      }
      const preference = ['follow', 'favorite', 'pin', 'shortcut'].includes(kind)
      const input = { kind, operationId: operationId(), expectedRevision: kind === 'restore' ? this.state.revision : preference ? base.preferenceRevision : base.revision }
      if (['follow', 'favorite', 'pin'].includes(kind)) input.value = !base[kind === 'follow' ? 'followed' : kind === 'pin' ? 'pinned' : 'favorite']
      if (['move', 'duplicate', 'shortcut'].includes(kind)) input.folderId = this.selected
      if (kind === 'transfer-ownership') {
        if (!this.transferConfirm || !this.canSubmit) return
        Object.assign(input, { targetPrincipalId: this.targetPrincipalId, expectedAuthzVersion: base.authzVersion, expectedEligibilityRevision: base.ownershipEligibilityRevision,
          removeOldOwner: this.removeOldOwner, oldOwnerPerm: this.oldOwnerPerm, stayPut: true })
      }
      if (kind === 'duplicate') Object.assign(input, { name: this.name.trim(), sourceEpoch: base.epoch, sourceRevision: base.contentRevision })
      await this.perform(input)
    },
    async perform(input, folder = false) {
      if (this.confirmationOnly || !this.current()) return
      this.busy = true; this.error = ''; this.notice = ''
      try { const result = await this.provider.execute(input); if (!this.current()) return; this.settle(result, folder) }
      catch (error) { if (!this.current()) return; if (input.kind === 'transfer-ownership') { this.transferConfirm = false; this.targetPrincipalId = ''; this.candidates = [] } this.error = error.code === 'BUSINESS_BODY_NOT_CURRENT' ? '正文尚未完成同步，请等待保存后再创建副本。' : error.status === 409 ? '文档或位置已发生变化，请检查最新状态后重试。' : '此操作未完成，请检查权限与目标位置。'; try { const latest = await this.provider.load(); if (this.current()) this.baseline = { ...latest } } catch { /* keep the explicit error */ } }
      finally { if (this.current()) this.busy = false }
    },
    settle(result, folder = false) {
      if (result.status !== 'committed') { this.pending = { operationId: result.operationId, kind: folder ? 'create-folder' : this.pending?.kind || this.action }; return }
      this.pending = null
      if (!this.confirmationOnly && (folder || result.kind === 'create-folder')) { this.folderName = ''; void this.loadFolders(); this.notice = '文件夹已创建'; return }
      this.$emit('complete', result)
    },
    async query() {
      if (!this.pending || this.busy || !this.current()) return
      if (this.confirmationOnly && this.confirmationOperation()?.operationId !== this.pending.operationId) { this.error = '当前没有可核对的原操作。'; return }
      this.busy = true; this.error = ''
      try { const result = await this.provider.query(this.pending.operationId); if (this.current()) { if (result.status === 'unknown') this.notice = '结果尚未确认，请稍后再次核对。'; this.settle(result, this.pending.kind === 'create-folder') } }
      catch { if (this.current()) this.error = '暂时无法核对，请保留当前操作，稍后再试。' }
      finally { if (this.current()) this.busy = false }
    },
  },
}
</script>

<style>
.lark-doc .lark-doc-business-mask { position: fixed; z-index: 1002; inset: 0; display: grid; place-items: center; padding: 16px; background: var(--ld-mask); }
.lark-doc .lark-doc-business-dialog { display: flex; flex-direction: column; width: min(520px,100%); max-height: calc(100dvh - 32px); overflow: hidden; border-radius: 8px; background: var(--ld-bg-surface-chrome); box-shadow: var(--ld-shadow-dialog); }
.lark-doc .lark-doc-business-dialog header, .lark-doc .lark-doc-business-dialog footer { display: flex; align-items: center; gap: 12px; padding: 16px 24px; flex-shrink: 0; }
.lark-doc .lark-doc-business-dialog header { justify-content: space-between; border-bottom: 1px solid var(--ld-border-chrome); }
.lark-doc .lark-doc-business-dialog h2 { margin: 0; font-size: 18px; }
.lark-doc .lark-doc-business-body { min-height: 0; padding: 16px 24px; overflow: auto; overscroll-behavior: contain; }
.lark-doc .lark-doc-business-dialog footer { justify-content: flex-end; border-top: 1px solid var(--ld-border-chrome); }
.lark-doc .lark-doc-business-dialog footer button.is-primary { color: var(--ld-code-bg); background: var(--ld-brand-chrome); border-color: var(--ld-brand-chrome); }
.lark-doc .lark-doc-business-dialog footer button.is-danger { color: var(--ld-text-on-brand); background: var(--ld-danger); border-color: var(--ld-danger); }
.lark-doc .lark-doc-business-name { display: grid; gap: 8px; margin-bottom: 16px; }
.lark-doc .lark-doc-business-location, .lark-doc .lark-doc-business-new-folder { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.lark-doc .lark-doc-business-new-folder { margin-top: 12px; }
.lark-doc .lark-doc-business-new-folder input { flex: 1; }
.lark-doc .lark-doc-business-path { display: flex; flex-wrap: wrap; gap: 4px; padding: 8px 0; }
.lark-doc .lark-doc-business-path button { color: var(--ld-text-accent); }
.lark-doc .lark-doc-business-folders { min-height: 128px; border: 1px solid var(--ld-border-chrome); border-radius: 4px; }
.lark-doc .lark-doc-business-dialog .lark-doc-business-folders > button { width: 100%; display: flex; align-items: center; gap: 10px; min-height: 44px; border: 0; border-radius: 0; text-align: left; }
.lark-doc .lark-doc-business-folders > button span:first-of-type { flex: 1; }
.lark-doc .lark-doc-business-folders > button[aria-selected="true"] { background: var(--ld-bg-accent); color: var(--ld-text-accent); }
.lark-doc .lark-doc-business-folders [aria-disabled="true"], .lark-doc .lark-doc-business-folders small { color: var(--ld-text-tertiary); }
.lark-doc .lark-doc-business-error { color: var(--ld-text-error); }
.lark-doc .lark-doc-business-retention { display: grid; gap: 8px; margin: 16px 0; border: 1px solid var(--ld-border-chrome); border-radius: 4px; }
.lark-doc .lark-doc-business-retention label { display: flex; align-items: center; gap: 6px; }
.lark-doc .lark-doc-business-retention select { width: 112px; margin-left: 22px; color: inherit; background: var(--ld-bg-surface-chrome); }
</style>
