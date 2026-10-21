<template>
  <div
    class="feishu-command-menu"
    :class="{ 'is-plus': kind === 'plus', 'is-slash': kind === 'slash' }"
    role="menu"
    aria-label="插入内容"
    :style="positionStyle"
    @keydown="onKeydown"
  >
    <div class="feishu-command-head">
      <strong>插入内容</strong>
      <input
        ref="search"
        :value="query"
        aria-label="搜索插入内容"
        placeholder="搜索命令 / 拼音"
        @input="$emit('query', $event.target.value)"
        @compositionstart="composing = true"
        @compositionend="composing = false"
      >
    </div>
    <div
      v-if="!items.length"
      class="feishu-command-empty"
    >
      没有匹配的命令
    </div>
    <div
      v-for="category in categories"
      :key="category"
      class="feishu-command-section"
      :data-category="category"
    >
      <small>{{ category }}</small>
      <button
        v-for="item in items.filter(entry => entry.category === category)"
        :key="item.id"
        type="button"
        role="menuitem"
        :aria-label="item.label"
        :title="item.label"
        :aria-haspopup="item.submenu ? 'menu' : undefined"
        :aria-expanded="item.submenu ? String(submenuOpen === item.submenu) : undefined"
        :data-command-id="item.id"
        :class="{ active: item.id === activeId }"
        @mouseenter="item.submenu && openSubmenu(item, $event)"
        @focus="item.submenu && openSubmenu(item, $event)"
        @mousedown.prevent
        @click="item.submenu && (kind === 'plus' || ['columns', 'templates'].includes(item.submenuType)) ? openSubmenu(item, $event) : $emit('choose', item)"
      >
        <span
          class="feishu-command-icon"
          :class="`is-${item.tone || 'blue'}`"
          aria-hidden="true"
        >{{ item.glyph || '·' }}</span><span class="feishu-command-label">{{ item.label }}</span><span
          v-if="item.submenu"
          class="feishu-command-submenu-arrow"
          :class="{ 'is-open': submenuOpen === item.submenu }"
          role="button"
          tabindex="0"
          :aria-label="`打开${item.submenu}子菜单`"
          @click.stop.prevent="openSubmenu(item, $event)"
          @keydown.enter.stop.prevent="openSubmenu(item, $event)"
          @keydown.space.stop.prevent="openSubmenu(item, $event)"
        >›</span>
      </button>
    </div>
    <div
      v-if="submenuOpen"
      class="feishu-command-submenu"
      :class="`is-${submenuType || 'commands'}`"
      role="menu"
      :aria-label="`${submenuOpen}子菜单`"
      :style="submenuStyle"
      @mouseenter="submenuOpen = submenuOpen"
    >
      <template v-if="submenuType === 'templates'">
        <strong>选择模板插入文档</strong>
        <div
          v-if="!templates.length"
          class="feishu-command-empty"
        >
          暂无可用模板
        </div>
        <button
          v-for="template in templates"
          :key="`template-${template.id}`"
          type="button"
          role="menuitem"
          :aria-label="template.label || template.title || template.id"
          @mousedown.prevent
          @click="$emit('choose', { id: 'template', templateId: template.id })"
        >
          <span
            class="feishu-command-icon is-indigo"
            aria-hidden="true"
          >◇</span><span class="feishu-command-label"><span>{{ template.label || template.title || template.id }}</span><small v-if="template.label && template.title && template.label !== template.title">{{ template.title }}</small></span>
        </button>
      </template><template v-else-if="submenuType === 'columns'">
        <div class="feishu-submenu-picker-head">
          <span>选择栏数</span><output v-if="columnsHover">{{ columnsHover }}</output>
        </div>
        <div
          class="feishu-columns-picker"
          role="group"
          aria-label="选择栏数"
          @mouseleave="columnsHover = null"
        >
          <div
            class="feishu-columns-preview"
            aria-hidden="true"
          >
            <span
              v-for="column in 5"
              :key="`columns-preview-${column}`"
              :class="{ 'is-primary': column <= (columnsHover || 1) }"
            />
          </div>
          <button
            v-for="(count, index) in [2, 3, 4, 5]"
            :key="`columns-${count}`"
            type="button"
            role="menuitem"
            :aria-label="`${count}栏`"
            class="feishu-columns-choice"
            :class="{ 'is-preview': count === columnsHover }"
            :style="columnsChoiceStyle(index)"
            @mouseenter="columnsHover = count"
            @focus="columnsHover = count"
            @mousedown.prevent
            @click="$emit('choose', { id: `columns${count}` })"
          >
            <span
              v-for="column in count"
              :key="`${count}-${column}`"
            />
          </button>
        </div>
      </template><template v-else-if="submenuType === 'table'">
        <div class="feishu-submenu-picker-head">
          <span>选择大小</span><output>{{ tableHover.cols }} × {{ tableHover.rows }}</output>
        </div>
        <div
          class="feishu-table-submenu-grid"
          role="group"
          aria-label="选择表格大小"
        >
          <button
            v-for="cell in 36"
            :key="`table-${cell}`"
            type="button"
            role="menuitem"
            :aria-label="`${((cell - 1) % 6) + 1}列${Math.floor((cell - 1) / 6) + 1}行`"
            :class="{ 'is-preview': Math.floor((cell - 1) / 6) + 1 <= tableHover.rows && ((cell - 1) % 6) + 1 <= tableHover.cols }"
            @mouseenter="tableHover = { rows: Math.floor((cell - 1) / 6) + 1, cols: ((cell - 1) % 6) + 1 }"
            @focus="tableHover = { rows: Math.floor((cell - 1) / 6) + 1, cols: ((cell - 1) % 6) + 1 }"
            @mousedown.prevent
            @click="$emit('choose', { id: 'table', tableSize: { rows: Math.floor((cell - 1) / 6) + 1, cols: ((cell - 1) % 6) + 1 } })"
          />
        </div>
      </template><template v-else>
        <strong>{{ submenuOpen }}</strong><button
          v-for="item in items.filter(entry => entry.submenu === submenuOpen)"
          :key="`submenu-${item.id}`"
          type="button"
          role="menuitem"
          :aria-label="item.label"
          @mousedown.prevent
          @click="$emit('choose', item)"
        >
          <span
            class="feishu-command-icon"
            aria-hidden="true"
          >{{ item.glyph || '·' }}</span>{{ item.label }}
        </button>
      </template>
    </div>
    <p class="feishu-command-hint">
      ↑ ↓ 选择 · Enter 插入 · Esc 关闭
    </p>
  </div>
</template>

<script>
export default {
  name: 'FeishuCommandMenu',
  props: { items: { type: Array, required: true }, templates: { type: Array, default: () => [] }, query: { type: String, default: '' }, positionStyle: { type: Object, default: () => ({}) }, activeId: { type: String, default: '' }, kind: { type: String, default: 'slash' } },
  data() { return { composing: false, submenuOpen: '', submenuType: '', submenuStyle: {}, columnsHover: null, tableHover: { rows: 3, cols: 3 } } },
  computed: { categories() { const order = this.kind === 'plus' ? ['基础', '常用', '其他标题'] : []; const categories = [...new Set(this.items.map((item) => item.category))]; return order.concat(categories.filter((category) => !order.includes(category))) } },
  methods: {
    onKeydown(event) {
      // 组合键保留默认候选行为，同时阻止祖先的 Esc 关闭菜单。
      if (this.composing || event.isComposing || event.keyCode === 229) { event.stopPropagation(); return }
      const key = event.key
      if (!['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(key) || (event.target !== this.$refs.search && key !== 'Escape')) return
      event.preventDefault()
      if (key === 'Escape') { event.stopPropagation(); this.$emit('close') }
      else if (key === 'Enter') this.choose()
      else this.move(key === 'ArrowDown' ? 1 : -1)
    },
    move(step) { this.$emit('move', step) },
    columnsChoiceStyle(index) {
      const left = index === 0 ? 0 : 40 + ((index - 1) * 20)
      return { left: `${left}%`, width: `${index === 0 ? 40 : 20}%` }
    },
    choose() { const item = this.items.find((entry) => entry.id === this.activeId) || this.items[0]; if (item) { if (item.submenu && (this.kind === 'plus' || ['columns', 'templates'].includes(item.submenuType))) this.openSubmenu(item); else this.$emit('choose', item) } },
    openSubmenu(item, event) {
      if (!item?.submenu) return
      this.submenuOpen = item.submenu
      this.submenuType = item.submenuType || 'commands'
      if (this.submenuType === 'columns') this.columnsHover = null
      if (this.submenuType === 'table') this.tableHover = { rows: 3, cols: 3 }
      this.$nextTick(() => {
        const trigger = event?.currentTarget?.closest?.('button') || event?.currentTarget || this.$el.querySelector(`[data-command-id="${item.id}"]`)
        const triggerRect = trigger?.getBoundingClientRect?.()
        if (!triggerRect) return
        const margin = 8
        const gap = 5
        const width = this.submenuType === 'templates' ? 250 : 190
        const options = this.items.filter((entry) => entry.submenu === item.submenu)
        const estimatedHeight = this.submenuType === 'templates' ? Math.min(420, 42 + Math.max(1, this.templates.length) * 40) : this.submenuType === 'columns' ? 166 : this.submenuType === 'table' ? 304 : Math.min(420, 42 + options.length * 40)
        const right = triggerRect.right + gap
        const left = triggerRect.left - width - gap
        const leftPosition = right + width + margin <= window.innerWidth ? right : Math.max(margin, left)
        const top = Math.max(margin, Math.min(window.innerHeight - estimatedHeight - margin, triggerRect.top))
        this.submenuStyle = { left: `${Math.round(leftPosition)}px`, top: `${Math.round(top)}px`, ...(this.submenuType === 'templates' ? { width: `${width}px` } : {}) }
      })
    },
    focusSearch() { this.$refs.search?.focus() },
  },
}
</script>
