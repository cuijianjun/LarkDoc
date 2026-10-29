<template>
  <div
    v-if="open"
    class="lark-doc-template-library"
    role="dialog"
    aria-modal="true"
    aria-label="模板库"
    :style="rootStyle"
    @keydown.esc.stop.prevent="$emit('close')"
  >
    <div
      class="lark-doc-template-library-mask"
      @click="$emit('close')"
    />
    <div class="lark-doc-template-library-modal">
      <header class="lark-doc-template-library-header">
        <p class="lark-doc-template-target">
          新建到 <strong>{{ target }}</strong>
        </p>
        <div class="lark-doc-template-search">
          <input
            :value="keyword"
            type="search"
            placeholder="搜索模板"
            aria-label="搜索模板"
            @input="keyword = $event.target.value"
          >
        </div>
        <div class="lark-doc-template-header-right">
          <span class="lark-doc-template-type">所有类型</span>
          <button
            type="button"
            class="lark-doc-template-close"
            aria-label="关闭模板库"
            @click="$emit('close')"
          >
            ×
          </button>
        </div>
      </header>

      <div class="lark-doc-template-library-body">
        <nav
          class="lark-doc-template-categories"
          role="tablist"
          aria-label="模板分类"
        >
          <button
            v-for="category in categories"
            :key="category.id"
            type="button"
            role="tab"
            :aria-selected="String(category.id === activeCategory)"
            :class="{ 'is-active': category.id === activeCategory }"
            :data-category-id="category.id"
            @click="activeCategory = category.id"
          >
            {{ category.label }}
          </button>
        </nav>

        <div class="lark-doc-template-scroll">
          <div
            v-if="visible.length"
            class="lark-doc-template-grid"
          >
            <article
              v-for="template in visible"
              :key="template.id"
              class="lark-doc-template-card"
              tabindex="0"
              :data-template-id="template.id"
            >
              <div class="lark-doc-template-card-head">
                <span
                  class="lark-doc-template-card-icon"
                  aria-hidden="true"
                >▤</span>
                <span class="lark-doc-template-card-name">{{ template.name }}</span>
              </div>
              <div class="lark-doc-template-card-thumb">
                <img
                  v-if="template.thumb"
                  :src="template.thumb"
                  alt=""
                  loading="lazy"
                >
              </div>
              <div class="lark-doc-template-card-foot">
                <span class="lark-doc-template-card-meta">{{ template.meta }}</span>
                <div class="lark-doc-template-card-actions">
                  <button
                    type="button"
                    class="lark-doc-template-preview"
                    @click.stop="$emit('preview', template)"
                  >
                    预览
                  </button>
                  <button
                    type="button"
                    class="lark-doc-template-use"
                    @click.stop="$emit('use', template)"
                  >
                    使用
                  </button>
                </div>
              </div>
            </article>
          </div>
          <p
            v-else
            class="lark-doc-template-empty"
          >
            没有匹配的模板
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
/**
 * 文档模板库弹窗（P5-07）—— **宿主侧组件，不进编辑器**。
 *
 * 三条硬约束（全部来自 02 §28，改动前先看那边）：
 *
 *   1. **入口只在宿主**：编辑器页内零入口（`nTpl=0` / `nBar=0`，侧栏也没有）。
 *      所以本组件不从 `LarkDocEditor` 里挂，也不进斜杠菜单；宿主自己决定在哪开它。
 *   2. **「使用」= 通知宿主去复制文档**：只 `emit('use', template)`。
 *      飞书实测是服务端 `create_node` 整篇 Copy + 新开 tab（§28.7），
 *      所以这里**不允许**出现 `insertContent` / 逐块灌入 —— 那是错的语义。
 *   3. **缩略图用宿主自己的静态图**（§28.5：飞书那边是 `blob:`，原始 URL 不可得）。
 *
 * 几何数字**只在 `core/templates/library.js` 里写一次**，组件把它们以 CSS 自定义
 * 属性注入根节点，样式表只写 `var(--tpl-*)`。这样改一个数不用动两处。
 */
import { templateLibraryRootStyle } from '../../ui/templateLibrary'
import { buildCategoryList, searchTemplates, templatesOf } from '../../core/templates/library'

export default {
  name: 'LarkDocTemplateLibrary',
  props: {
    /** 是否打开。关着的时候整个组件不渲染（同页 modal，不是路由）。 */
    open: { type: Boolean, default: false },
    /** 「新建到」后面的落点文案（宿主的当前目录）。 */
    target: { type: String, default: '我的文档库' },
    /**
     * 卡片数据。形状：`{ id, name, thumb, meta, categories[] }`。
     * `categories` 是分类 id 数组，用于左栏过滤；缺省表示「所有分类都可见」。
     */
    templates: { type: Array, default: () => [] },
    /**
     * 运营位分类（02 §28.4 的 8 个带 emoji 项）。传了就整组替换缺省值 ——
     * 规格明确要求**不要硬编码**这 8 项，所以宿主应尽量传自己的配置。
     */
    promoCategories: { type: Array, default: null },
  },
  data() {
    return {
      // 缺省停在「推荐」：真飞书打开就是推荐流，不是「我的模板」。
      activeCategory: 'recommend',
      keyword: '',
    }
  },
  computed: {
    categories() {
      return buildCategoryList(this.promoCategories || undefined)
    },
    /**
     * 先分类过滤再关键词过滤，两步都在 `core/templates/library.js` 里，
     * 组件不重复写一遍筛选逻辑（写两份必然分叉）。
     */
    visible() {
      return searchTemplates(templatesOf(this.templates, this.activeCategory), this.keyword)
    },
    /** 几何常量 → CSS 自定义属性（唯一真相在 `src/ui/templateLibrary.js`）。 */
    rootStyle() {
      return templateLibraryRootStyle()
    },
  },
}
</script>
