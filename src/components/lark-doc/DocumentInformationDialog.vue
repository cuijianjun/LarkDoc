<template>
  <div
    class="lark-doc-information-mask"
    @click.self="$emit('close')"
    @keydown.esc.stop.prevent="$emit('close')"
  >
    <section
      ref="dialog"
      class="lark-doc-information-dialog"
      role="dialog"
      aria-modal="true"
      aria-label="文档信息"
      tabindex="-1"
      @keydown.tab="trapFocus"
    >
      <header>
        <h2>文档信息</h2><button
          type="button"
          aria-label="关闭文档信息"
          @click="$emit('close')"
        >
          <LarkDocIcon
            name="close"
            :size="20"
          />
        </button>
      </header>
      <div class="lark-doc-information-layout">
        <nav
          role="tablist"
          aria-label="文档信息分类"
          aria-orientation="vertical"
        >
          <button
            v-for="item in tabs"
            :id="'information-tab-' + _uid + '-' + item.id"
            :key="item.id"
            type="button"
            role="tab"
            :aria-selected="String(tab === item.id)"
            :aria-controls="'information-page-' + _uid + '-' + item.id"
            :tabindex="tab === item.id ? 0 : -1"
            :class="{ 'is-active': tab === item.id, 'is-privacy': item.id === 'privacy' }"
            @click="selectTab(item.id)"
            @keydown.down.prevent="moveTab(1)"
            @keydown.up.prevent="moveTab(-1)"
          >
            <svg
              :width="item.graphic.width"
              :height="item.graphic.height"
              :viewBox="item.graphic.viewBox"
              aria-hidden="true"
            ><path
              v-for="(path, index) in item.graphic.paths"
              :key="index"
              :d="path.d"
              :fill-rule="path.fillRule"
              fill="currentColor"
            /></svg>{{ item.label }}
          </button>
        </nav>
        <div
          :id="'information-page-' + _uid + '-' + tab"
          class="lark-doc-information-content"
          :class="{ 'is-operations': tab === 'operations' }"
          role="tabpanel"
          :aria-labelledby="'information-tab-' + _uid + '-' + tab"
          :aria-busy="String(loading)"
        >
          <p
            v-if="loading && tab !== 'operations'"
            role="status"
          >
            正在加载…
          </p>
          <p
            v-if="error && tab !== 'operations'"
            role="alert"
          >
            {{ error }} <button
              type="button"
              :disabled="loading || busy"
              @click="load"
            >
              {{ pending ? '核对原操作' : '重新载入' }}
            </button>
          </p>
          <template v-if="tab === 'information'">
            <h3>概览</h3>
            <dl class="lark-doc-information-overview">
              <div><dt>所有者</dt><dd>{{ person(summary && summary.ownerId) }}</dd></div><div><dt>创建者</dt><dd>{{ person(summary && summary.creatorId) }}</dd></div><div><dt>创建时间</dt><dd>{{ time(summary && summary.createdAt) }}</dd></div><div><dt>最近修改</dt><dd>{{ time(summary && summary.updatedAt) }}</dd></div>
            </dl>
            <h3>文档统计</h3>
            <dl class="lark-doc-information-statistics">
              <div><dt>总字数</dt><dd>{{ statistics.words }}</dd></div><div><dt>总字符数</dt><dd>{{ statistics.characters }}</dd></div><div><dt>大小</dt><dd>{{ (statistics.bytes / 1024).toFixed(2) }} KB</dd></div>
            </dl>
            <h3>互动统计</h3>
            <dl class="lark-doc-information-statistics lark-doc-information-interactions">
              <div
                v-for="item in interactions"
                :key="item.id"
              >
                <dt>{{ item.label }}</dt><dd>{{ summary ? summary.interaction[item.id] == null ? '—' : summary.interaction[item.id] : '—' }}<small v-if="item.id === 'visits' && summary">今日新增 {{ summary.interaction.todayVisits }}</small></dd>
              </div>
            </dl>
          </template>
          <template v-else-if="tab === 'visits' && records">
            <p>文档访问人数：{{ records.items.length }}<span v-if="records.truncated">（部分记录）</span></p>
            <table>
              <thead><tr><th>访问者</th><th>最近访问时间</th></tr></thead><tbody>
                <tr
                  v-for="item in records.items"
                  :key="item.principalId"
                >
                  <td><span class="lark-doc-information-avatar">{{ person(item.principalId).slice(0, 1) }}</span>{{ person(item.principalId) }}</td><td>{{ time(item.lastVisitedAt) }}</td>
                </tr>
              </tbody>
            </table>
            <p v-if="!records.items.length && !loading">
              暂无访问记录
            </p>
            <p class="lark-doc-information-note">
              {{ records.coverageSince ? '访问记录数据从 ' + time(records.coverageSince) + ' 开始统计' : '访问记录尚未开始统计' }}
            </p><p class="lark-doc-information-note">
              访问记录中不会显示已关闭访问记录的用户。
            </p>
          </template>
          <template v-else-if="tab === 'operations'">
            <div
              ref="operationFilters"
              class="lark-doc-information-operation-filters"
              role="tablist"
              aria-label="操作记录分类"
              aria-orientation="horizontal"
            >
              <button
                v-for="item in operationCategories"
                :id="'information-operation-tab-' + _uid + '-' + item.id"
                :key="item.id"
                type="button"
                role="tab"
                :aria-selected="String(operationCategory === item.id)"
                :aria-controls="'information-operation-feed-' + _uid"
                :tabindex="operationCategory === item.id ? 0 : -1"
                :class="{ 'is-active': operationCategory === item.id }"
                :disabled="!operationSupport.includes(item.id)"
                :title="operationSupport.includes(item.id) ? null : '暂不支持查看此类操作记录'"
                @click="selectOperationCategory(item.id)"
                @keydown.right.prevent="moveOperationCategory(1)"
                @keydown.left.prevent="moveOperationCategory(-1)"
                @keydown.home.prevent="moveOperationCategory(0, 'first')"
                @keydown.end.prevent="moveOperationCategory(0, 'last')"
              >
                {{ item.label }}
              </button>
            </div>
            <div
              :id="'information-operation-feed-' + _uid"
              ref="operationFeed"
              class="lark-doc-information-operation-feed"
              role="tabpanel"
              :aria-labelledby="'information-operation-tab-' + _uid + '-' + operationCategory"
              :aria-busy="String(loading)"
              tabindex="0"
            >
              <p
                v-if="loading"
                class="lark-doc-information-operation-message"
                role="status"
              >
                正在加载…
              </p>
              <p
                v-if="error"
                class="lark-doc-information-operation-message"
                role="alert"
              >
                {{ error }} <button
                  type="button"
                  :disabled="loading || busy"
                  @click="load"
                >
                  {{ pending ? '核对原操作' : '重新载入' }}
                </button>
              </p>
              <ol
                v-if="operationRows.length"
                class="lark-doc-information-operation-list"
                aria-label="操作记录"
              >
                <li
                  v-for="(item, index) in operationRows"
                  :key="item.actorId + '/' + item.kind + '/' + item.occurredAt + '/' + index"
                  class="lark-doc-information-operation-item"
                >
                  <span
                    class="lark-doc-information-operation-avatar"
                    aria-hidden="true"
                  >{{ person(item.actorId).slice(0, 1) }}</span>
                  <div class="lark-doc-information-operation-info">
                    <div class="lark-doc-information-operation-main">
                      <strong>{{ person(item.actorId) }}</strong> {{ operationText(item.kind) }}
                    </div>
                    <time
                      class="lark-doc-information-operation-description"
                      :datetime="item.occurredAt"
                    >{{ time(item.occurredAt) }}</time>
                  </div>
                </li>
              </ol>
              <p
                v-else-if="records && !loading && !error"
                class="lark-doc-information-operation-message"
                role="status"
              >
                {{ operationEmptyText }}
              </p>
              <p
                v-if="records && operationCoverageNote"
                class="lark-doc-information-note lark-doc-information-operation-message"
              >
                {{ operationCoverageNote }}
              </p>
            </div>
          </template>
          <template v-else-if="tab === 'privacy'">
            <h3>权限与隐私</h3>
            <div
              v-for="item in privacyOptions"
              :key="item.id"
              class="lark-doc-information-privacy"
            >
              <div class="lark-doc-information-privacy-row">
                <strong>{{ item.label }}</strong>
                <button
                  type="button"
                  role="switch"
                  :aria-label="item.label"
                  :aria-checked="String(Boolean(privacy && privacy[item.id]))"
                  :disabled="!privacy || loading || busy || Boolean(pending)"
                  :class="{ 'is-on': privacy && privacy[item.id] }"
                  @click="changePrivacy(item.id)"
                >
                  <span />
                </button>
              </div>
              <p>{{ item.description }}</p>
              <a
                :href="privacyHelpUrl"
                target="_blank"
                rel="noopener noreferrer"
              >了解详情</a>
            </div>
          </template>
        </div>
      </div>
    </section>
  </div>
</template>

<script>
import LarkDocIcon from './LarkDocIcon.vue'
const OPERATION_CATEGORIES = [
  { id: 'all', label: '全部', kinds: [] },
  { id: 'share', label: '分享授权', kinds: ['permissions'] },
  { id: 'duplicate', label: '创建副本', kinds: ['duplicate'] },
  { id: 'download', label: '下载', kinds: [] },
  { id: 'settings', label: '权限设置变更', kinds: ['sharing-settings'] },
]
const INFORMATION_ICONS = [{"width":"18","height":"12","viewBox":null,"groups":[],"paths":[{"d":"M1.084.167h15.833c.23 0 .417.186.417.416v.834c0 .23-.187.416-.417.416H1.084a.417.417 0 01-.417-.416V.583c0-.23.187-.416.417-.416zm0 5h9.166c.23 0 .417.186.417.416v.834c0 .23-.187.416-.417.416H1.084a.417.417 0 01-.417-.416v-.834c0-.23.187-.416.417-.416zm0 5h9.166c.23 0 .417.186.417.416v.834c0 .23-.187.416-.417.416H1.084a.417.417 0 01-.417-.416v-.834c0-.23.187-.416.417-.416z","fillRule":null}]},{"width":"18","height":"16","viewBox":null,"groups":[],"paths":[{"d":"M8.987 13.417c2.698 0 5.197-1.717 7.513-5.428-2.257-3.698-4.75-5.406-7.513-5.406S3.741 4.291 1.5 7.99c2.3 3.712 4.79 5.428 7.487 5.428zM.252 8.742A1.485 1.485 0 01.27 7.21C2.69 3.014 5.595.917 8.986.917c3.405 0 6.328 2.115 8.77 6.344l.023.04c.247.433.245.967-.008 1.396-2.506 4.258-5.434 6.386-8.785 6.386-3.34 0-6.25-2.114-8.734-6.341zM9 11.333a3.333 3.333 0 110-6.666 3.333 3.333 0 010 6.666zm0-1.666a1.667 1.667 0 100-3.334 1.667 1.667 0 000 3.334z","fillRule":null}]},{"width":"18","height":"18","viewBox":"0 0 20 20","groups":[],"paths":[{"d":"M2.555 18.415a.89.89 0 01-.888-.894V2.561a.89.89 0 01.888-.894H15.77c.491 0 .889.4.889.893v5.421a6.622 6.622 0 00-1.666-.43V3.342H3.332V16.74h4.683c.255.61.598 1.174 1.013 1.676H2.555z","fillRule":null},{"d":"M13.75 11.667a.417.417 0 00-.417.417v2.5c0 .23.187.416.417.416h2.5c.23 0 .417-.186.417-.416v-.834a.417.417 0 00-.417-.416H15v-1.25a.417.417 0 00-.417-.417h-.833z","fillRule":null},{"d":"M14.167 19.167a5 5 0 100-10 5 5 0 000 10zm0-1.667a3.333 3.333 0 110-6.666 3.333 3.333 0 010 6.666z","fillRule":"evenodd"},{"d":"M5.22 5.85c-.123 0-.222.1-.222.224v1.229c0 .123.1.223.222.223h7.884c.123 0 .222-.1.222-.223V6.074c0-.123-.1-.223-.222-.223H5.22zM5.22 9.205c-.123 0-.222.1-.222.224v1.228c0 .124.1.224.222.224h3.387c.123 0 .222-.1.222-.224V9.43c0-.124-.1-.224-.222-.224H5.22z","fillRule":null}]},{"width":"18","height":"20","viewBox":null,"groups":[],"paths":[{"d":"M2.607 16.445l-.26-.283A9.092 9.092 0 01.36 12.707l-.113-.364L1.954 10 .247 7.657l.113-.363a9.092 9.092 0 011.988-3.456l.259-.283 2.868.314L6.64 1.213l.374-.084a9.036 9.036 0 013.972 0l.374.084 1.165 2.656 2.868-.314.26.283a9.093 9.093 0 011.987 3.456l.113.363L16.046 10l1.707 2.344-.113.363a9.093 9.093 0 01-1.988 3.455l-.26.283-2.867-.314-1.165 2.656-.374.084a9.037 9.037 0 01-3.972 0l-.374-.084-1.165-2.656-2.868.314zm2.904-1.842a1.24 1.24 0 011.27.735l.934 2.128a7.547 7.547 0 002.57 0l.933-2.128a1.24 1.24 0 011.27-.735l2.296.251a7.576 7.576 0 001.29-2.242l-1.37-1.882a1.24 1.24 0 010-1.46l1.37-1.882a7.576 7.576 0 00-1.29-2.242l-2.295.251a1.24 1.24 0 01-1.27-.735l-.934-2.128a7.545 7.545 0 00-2.57 0l-.934 2.128a1.24 1.24 0 01-1.27.735l-2.295-.25a7.577 7.577 0 00-1.29 2.241l1.37 1.882a1.24 1.24 0 010 1.46l-1.37 1.882a7.577 7.577 0 001.29 2.242l2.295-.25zM9 13.788A3.78 3.78 0 015.226 10 3.78 3.78 0 019 6.212 3.78 3.78 0 0112.773 10 3.78 3.78 0 019 13.788zm0-1.515A2.266 2.266 0 0011.258 10 2.266 2.266 0 009 7.727 2.266 2.266 0 006.742 10 2.266 2.266 0 009 12.273z","fillRule":null}]}]

export default {
  name: 'LarkDocDocumentInformationDialog',
  components: { LarkDocIcon },
  props: { ed: { type: Object, required: true }, statistics: { type: Object, required: true } },
  data() {
    return { tab: 'information', summary: null, records: null, privacy: null, loading: false, busy: false, pending: '', error: '',
      operationCategory: 'all', operationSupport: ['all'], operationCategories: OPERATION_CATEGORIES,
      tabs: [{ id: 'information', label: '信息与数据', icon: 'help-center' }, { id: 'visits', label: '访问记录', icon: 'outline' }, { id: 'operations', label: '操作记录', icon: 'undo' }, { id: 'privacy', label: '隐私设置', icon: 'mode-comment' }].map((item, index) => ({ ...item, graphic: INFORMATION_ICONS[index] })),
      interactions: [{ id: 'visitors', label: '访问人数' }, { id: 'visits', label: '访问次数' }, { id: 'likes', label: '点赞总数' }, { id: 'comments', label: '评论总数' }],
      privacyHelpUrl: 'https://www.feishu.cn/hc/zh-CN/articles/669630434840?from=in-ccm-privacy',
      privacyOptions: [{ id: 'showVisitRecords', label: '展示访问记录', description: '关闭后，你访问他人文档，及他人访问你的文档均不会被记录' }, { id: 'showVisitAvatars', label: '展示访问头像', description: '关闭后，你访问他人文档时，协作者栏将不展示你的头像' }] }
  },
  computed: {
    operationRows() {
      if (this.tab !== 'operations' || !this.records || !Array.isArray(this.records.items)) return []
      if (this.records.category !== undefined) return this.records.category === this.operationCategory ? this.records.items : []
      const category = this.operationCategories.find(item => item.id === this.operationCategory)
      return category?.id === 'all' ? this.records.items : this.records.items.filter(item => category?.kinds.includes(item.kind))
    },
    operationEmptyText() {
      return this.records?.truncated || this.records?.category === undefined ? '当前已加载记录中暂无此类操作。' : '当前记录范围内暂无此类操作。'
    },
    operationCoverageNote() {
      if (this.records?.truncated) return '当前仅展示部分操作记录，未显示的历史记录可能包含其他操作。'
      return this.records?.category === undefined ? '当前分类仅筛选已加载的操作记录。' : ''
    },
  },
  watch: { 'ed.session'() { this.bind() }, 'ed.commentIdentityGeneration'() { this.bind() } },
  mounted() { this.focus(); this.bind() },
  beforeDestroy() { this._readToken = null; this._stops?.forEach(stop => stop()); this._awareness?.off('privacy-generation', this._privacyChanged); this._awareness?.off('information-revision', this._informationChanged) },
  methods: {
    focus() { this.$nextTick(() => this.$refs.dialog?.querySelector('button:not(:disabled)')?.focus()) },
    scope() {
      const session = this.ed.session, provider = session?.getProvider?.('authorization'), principal = session?.user?.id, generation = session?._privateIdentityGeneration, auth = session?._authorizationGeneration
      return { provider, current: () => !this._isDestroyed && !this._isBeingDestroyed && session === this.ed.session && provider === session?.getProvider?.('authorization') && principal === session?.user?.id && generation === session?._privateIdentityGeneration && auth === session?._authorizationGeneration && (!session || session.can('canView')) }
    },
    bind() {
      this._readToken = null; this.summary = null; this.records = null; this.privacy = null; this.pending = ''; this.error = ''; this.loading = false; this.busy = false
      this.operationCategory = 'all'; this.operationSupport = ['all']
      this._stops?.forEach(stop => stop()); this._awareness?.off('privacy-generation', this._privacyChanged); this._awareness?.off('information-revision', this._informationChanged)
      const session = this.ed.session
      this._stops = session ? [session.on('provider-changed', () => this.bind()), session.on('identity', () => this.bind()), session.on('capabilities', () => { this._readToken = null; this.summary = null; this.records = null; this.privacy = null; if (!session.can('canView')) this.$emit('close'); else if (!this.busy) void this.load() })] : []
      this._awareness = this.ed.editor?.extensionManager.extensions.find(extension => extension.name === 'collaborationCaret')?.options.provider?.awareness
      this._privacyChanged = generation => { const scope = this.scope(); this._readToken = null; this.summary = null; this.records = null; this.privacy = null; void Promise.resolve(scope.provider?.documentInformation?.('observeGeneration', generation)).then(() => { if (scope.current()) return this.load() }).catch(() => {}) }
      this._informationChanged = revision => {
        const scope = this.scope()
        void Promise.resolve(scope.provider?.documentInformation?.('observeInformationRevision', revision)).then(() => {
          if (scope.current() && this.tab === 'information') return this.load()
        }).catch(() => {})
      }
      this._awareness?.on('information-revision', this._informationChanged)
      this._awareness?.on('privacy-generation', this._privacyChanged)
      if (this._awareness?.privacyGeneration) this._privacyChanged(this._awareness.privacyGeneration)
      else void this.load()
    },
    selectTab(value) { if (this.tab === value) return; this.tab = value; this.records = null; this.error = ''; void this.load() },
    moveTab(offset) { const index = this.tabs.findIndex(item => item.id === this.tab); this.selectTab(this.tabs[(index + offset + this.tabs.length) % this.tabs.length].id); this.$nextTick(() => this.$el.querySelector('[role=tab][aria-selected=true]')?.focus()) },
    selectOperationCategory(value) {
      if (!this.operationSupport.includes(value) || this.operationCategory === value) return
      this.operationCategory = value; this.records = null; this.error = ''
      if (this.$refs.operationFeed) this.$refs.operationFeed.scrollTop = 0
      return this.load()
    },
    moveOperationCategory(offset, edge) {
      const available = this.operationCategories.filter(item => this.operationSupport.includes(item.id))
      if (!available.length) return
      const index = available.findIndex(item => item.id === this.operationCategory)
      const next = edge === 'first' ? available[0] : edge === 'last' ? available[available.length - 1] : available[(index + offset + available.length) % available.length]
      void this.selectOperationCategory(next.id)
      this.$nextTick(() => this.$refs.operationFilters?.querySelector('[aria-selected="true"]')?.focus())
    },
    operationSupportFor(records) {
      return this.operationCategories.filter(item => item.id === 'all' || (Array.isArray(records.supportedCategories)
        ? records.supportedCategories.includes(item.id) : item.kinds.some(kind => Array.isArray(records.supportedKinds) && records.supportedKinds.includes(kind)))).map(item => item.id)
    },
    async load() {
      const scope = this.scope(), token = {}, tab = this.tab, category = this.operationCategory
      const current = () => scope.current() && token === this._readToken && tab === this.tab && (tab !== 'operations' || category === this.operationCategory)
      this._readToken = token; this.loading = true; this.error = ''
      if (tab === 'operations') this.records = null
      try {
        if (typeof scope.provider?.documentInformation !== 'function') throw Error('UNAVAILABLE')
        const unresolved = await scope.provider.documentInformation('operation', 'privacy')
        if (!current()) return
        this.pending = unresolved?.operationId || ''
        if (this.pending) { await scope.provider.documentInformation('query', this.pending); if (!current()) return; this.pending = '' }
        const result = await scope.provider.documentInformation('read', tab === 'operations' ? { kind: 'operations', category } : tab)
        if (!current()) return
        if (tab === 'information') this.summary = result
        else if (tab === 'privacy') {
          if (result.principalId !== this.ed.session?.user?.id) throw Error('DOCUMENT_INFORMATION_INVALID')
          this.privacy = result
        }
        else {
          if (tab === 'operations') {
            if (!result || result.category !== undefined && result.category !== category) throw Error('DOCUMENT_INFORMATION_INVALID')
            const support = this.operationSupportFor(result)
            if (!support.includes(category)) throw Error('DOCUMENT_INFORMATION_INVALID')
            this.operationSupport = support
          }
          this.records = result
        }
      } catch (cause) { if (current()) this.error = this.pending ? '设置结果待确认，请核对原操作。' : '暂时无法加载，请重试。' }
      finally { if (token === this._readToken) this.loading = false }
    },
    async changePrivacy(key) {
      if (!this.privacy || this.busy || this.loading || this.pending) return
      const scope = this.scope(), token = {}; this._readToken = token; this.busy = true; this.error = ''
      try {
        await scope.provider.documentInformation('request', { kind: 'privacy', expectedRevision: this.privacy.revision, changes: { [key]: !this.privacy[key] } })
        if (scope.current() && token === this._readToken) await this.load()
      } catch (cause) {
        if (!scope.current() || token !== this._readToken) return
        if (cause.status === 'unknown' && cause.operationId) { this.pending = cause.operationId; this.privacy = null; this.error = '设置结果待确认，请核对原操作。' }
        else if (cause.httpStatus === 409) { await this.load(); if (scope.current()) this.error = '设置已变化，请重新选择。' }
        else this.error = '设置未能更改，请重试。'
      } finally { if (scope.current()) this.busy = false }
    },
    person(id) { if (!id) return '—'; const user = this.ed.session?.user; return id === user?.id ? user.name || id : this.ed.collaborationUsers?.find(value => value.id === id)?.name || id },
    time(value) { const date = value ? new Date(value) : null; return date && Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—' },
    operationText(kind) { return ({ create: '创建文档', initialize: '编辑文档', edit: '编辑文档', version: '保存版本', permissions: '更改权限', bind: '关联文档', unbind: '解除关联', permission: '更改权限', privacy: '更改隐私设置', 'sharing-settings': '更改分享设置', rename: '重命名', move: '移动文档', duplicate: '创建副本', download: '下载文档', delete: '移入回收站', restore: '恢复文档' })[kind] || '更新文档' },
    trapFocus(event) { const buttons = [...this.$refs.dialog.querySelectorAll('button:not(:disabled):not([tabindex="-1"]), a[href], [tabindex="0"]:not(:disabled)')]; const first = buttons[0], last = buttons[buttons.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() } },
  },
}
</script>

<style>
.lark-doc .lark-doc-information-mask { position: fixed; inset: 0; z-index: 1001; display: grid; place-items: center; padding: 16px; background: var(--ld-mask); }
.lark-doc .lark-doc-information-dialog { box-sizing: border-box; width: min(840px, 100%); height: min(562px, calc(100dvh - 32px)); overflow: hidden; border-radius: 8px; background: var(--ld-bg-surface-chrome); color: var(--ld-text); font-size: 14px; line-height: 22px; display: flex; flex-direction: column; }
.lark-doc .lark-doc-information-dialog > header { box-sizing: border-box; height: 72px; flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; padding: 24px; }
.lark-doc .lark-doc-information-dialog h2 { margin: 0; font-size: 20px; line-height: 28px; font-weight: 600; }
.lark-doc .lark-doc-information-dialog button { border: 0; border-radius: 6px; background: transparent; color: inherit; font: inherit; cursor: pointer; }
.lark-doc .lark-doc-information-dialog > header > button { width: 28px; height: 28px; padding: 4px; }
.lark-doc .lark-doc-information-layout { display: flex; flex: 1; min-height: 0; }
.lark-doc .lark-doc-information-layout > nav { box-sizing: border-box; width: 224px; flex-shrink: 0; display: flex; flex-direction: column; padding: 14px 12px 15px; border-right: 1px solid var(--ld-border-chrome); }
.lark-doc .lark-doc-information-layout > nav > button { display: flex; align-items: center; flex-shrink: 0; gap: 8px; height: 46px; margin-bottom: 2px; padding: 12px; text-align: left; }
.lark-doc .lark-doc-information-layout > nav > button.is-privacy { margin-top: auto; margin-bottom: 0; }
.lark-doc .lark-doc-information-dialog button:hover:not(:disabled) { background: var(--ld-bg-hover-chrome); }
.lark-doc .lark-doc-information-layout > nav > button.is-active { color: var(--ld-brand-chrome); background: var(--ld-bg-hover-chrome); }
.lark-doc .lark-doc-information-content { box-sizing: border-box; min-width: 0; flex: 1; padding: 8px 40px 24px; overflow: auto; overscroll-behavior: contain; }
.lark-doc .lark-doc-information-content h3 { margin: 8px 0 16px; font-size: 14px; font-weight: 600; line-height: 22px; }
.lark-doc .lark-doc-information-content dl { margin: 0 0 24px; }
.lark-doc .lark-doc-information-content dl > div { display: flex; align-items: baseline; min-width: 0; }
.lark-doc .lark-doc-information-content dt { flex-shrink: 0; color: var(--ld-text-secondary); }
.lark-doc .lark-doc-information-content dd { margin: 0 0 0 16px; overflow-wrap: anywhere; }
.lark-doc .lark-doc-information-overview { display: grid; grid-template-columns: 1fr 1fr; gap: 24px 32px; }
.lark-doc .lark-doc-information-statistics { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px 20px; }
.lark-doc .lark-doc-information-statistics > div { flex-direction: row; }
.lark-doc .lark-doc-information-statistics dd { margin: 0 0 0 16px; font-size: 14px; line-height: 20px; }
.lark-doc .lark-doc-information-interactions { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.lark-doc .lark-doc-information-interactions > div { flex-direction: column; }
.lark-doc .lark-doc-information-interactions dd { margin: 8px 0 0; font-size: 28px; line-height: 36px; }
.lark-doc .lark-doc-information-statistics small { display: block; color: var(--ld-text-secondary); font-size: 12px; line-height: 18px; }
.lark-doc .lark-doc-information-content table { border-collapse: collapse; width: 100%; text-align: left; }
.lark-doc .lark-doc-information-content th { color: var(--ld-text-secondary); font-weight: 400; }
.lark-doc .lark-doc-information-content td, .lark-doc .lark-doc-information-content th { height: 48px; padding: 0 8px; overflow-wrap: anywhere; border-bottom: 1px solid var(--ld-border-chrome); }
.lark-doc .lark-doc-information-avatar { display: inline-grid; place-items: center; width: 28px; height: 28px; margin-right: 8px; border-radius: 50%; background: var(--ld-bg-hover-chrome); }
.lark-doc .lark-doc-information-note { color: var(--ld-text-secondary); font-size: 12px; line-height: 18px; }
.lark-doc .lark-doc-information-content.is-operations { display: flex; flex-direction: column; padding: 0; overflow: hidden; border-top: 1px solid var(--ld-border-chrome); }
.lark-doc .lark-doc-information-dialog .lark-doc-information-operation-filters { box-sizing: border-box; display: flex; flex-shrink: 0; height: 40px; padding: 0 10px; overflow-x: auto; overflow-y: hidden; scrollbar-width: none; border-bottom: 1px solid var(--ld-border-chrome); }
.lark-doc .lark-doc-information-dialog .lark-doc-information-operation-filters::-webkit-scrollbar { display: none; }
.lark-doc .lark-doc-information-dialog .lark-doc-information-operation-filters > button { position: relative; flex-shrink: 0; height: 39px; min-height: 39px; margin: 0; padding: 0 14px; border-radius: 0; white-space: nowrap; font-size: 12px; line-height: 22px; }
.lark-doc .lark-doc-information-dialog .lark-doc-information-operation-filters > button.is-active { color: var(--ld-brand-chrome); font-weight: 500; }
.lark-doc .lark-doc-information-dialog .lark-doc-information-operation-filters > button.is-active::after { position: absolute; bottom: 0; right: 14px; left: 14px; height: 2px; background: currentColor; content: ''; }
.lark-doc .lark-doc-information-dialog .lark-doc-information-operation-feed { box-sizing: border-box; flex: 1; min-height: 0; padding: 8px 0 14px; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; }
.lark-doc .lark-doc-information-dialog .lark-doc-information-operation-filters > button:focus-visible, .lark-doc .lark-doc-information-dialog .lark-doc-information-operation-feed:focus-visible { outline: 2px solid var(--ld-brand-chrome); outline-offset: -2px; }
.lark-doc .lark-doc-information-dialog .lark-doc-information-operation-list { margin: 0; padding: 0; list-style: none; }
.lark-doc .lark-doc-information-dialog .lark-doc-information-operation-item { box-sizing: border-box; display: flex; align-items: flex-start; min-height: 56px; gap: 12px; margin: 0; padding: 8px 24px; }
.lark-doc .lark-doc-information-dialog .lark-doc-information-operation-avatar { display: inline-grid; place-items: center; flex: 0 0 32px; width: 32px; height: 32px; border-radius: 50%; background: var(--ld-bg-hover-chrome); color: var(--ld-text-secondary); }
.lark-doc .lark-doc-information-dialog .lark-doc-information-operation-info { flex: 1; min-width: 0; }
.lark-doc .lark-doc-information-dialog .lark-doc-information-operation-main { font-size: 14px; line-height: 22px; overflow-wrap: anywhere; }
.lark-doc .lark-doc-information-dialog .lark-doc-information-operation-main > strong { font-weight: 500; }
.lark-doc .lark-doc-information-dialog .lark-doc-information-operation-description { display: block; color: var(--ld-text-secondary); font-size: 12px; line-height: 18px; }
.lark-doc .lark-doc-information-dialog .lark-doc-information-operation-message { margin: 8px 24px; }
.lark-doc .lark-doc-information-privacy { margin: 13px 0 0; }
.lark-doc .lark-doc-information-privacy-row { display: flex; align-items: center; justify-content: space-between; box-sizing: border-box; height: 40px; padding: 0 16px; border-radius: 6px; background: var(--ld-bg-file-preview); }

.lark-doc .lark-doc-information-privacy strong { font-weight: 400; }
.lark-doc .lark-doc-information-privacy p { color: var(--ld-text-secondary); margin: 4px 16px 0; font-size: 12px; line-height: 18px; }
.lark-doc .lark-doc-information-privacy a { display: block; margin: 0 16px; color: var(--ld-brand-chrome); font-size: 12px; line-height: 18px; text-decoration: none; }
.lark-doc .lark-doc-information-privacy-row > button { flex-shrink: 0; width: 40px; height: 22px; padding: 2px; border-radius: 999px; background: var(--ld-border-chrome); }
.lark-doc .lark-doc-information-privacy-row > button.is-on { background: var(--ld-brand-chrome); }
.lark-doc .lark-doc-information-privacy-row > button > span { display: block; width: 18px; height: 18px; border-radius: 50%; background: var(--ld-bg-surface-chrome); }
.lark-doc .lark-doc-information-privacy-row > button.is-on > span { margin-left: 18px; }
.lark-doc .lark-doc-information-dialog button:disabled { cursor: default; opacity: .45; }
@media (max-width: 680px) { .lark-doc .lark-doc-information-layout > nav { width: 144px; padding-inline: 8px; } .lark-doc .lark-doc-information-layout > nav > button { padding-inline: 8px; } .lark-doc .lark-doc-information-content { padding: 8px 16px 24px; } .lark-doc .lark-doc-information-overview, .lark-doc .lark-doc-information-statistics { grid-template-columns: 1fr; gap: 12px; } }
</style>
