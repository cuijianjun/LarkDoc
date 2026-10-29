<template>
  <!-- 关联已有多维表格（requirements/04 §4.5）。内容 1080×676 居中 —— 216/137 这两个
       偏移就是「(1512−1080)/2、(950−676)/2」，所以这里用 flex 居中，不写死 top/left。
       🔴 Header **没有关闭 X**（§4.5 实测）：关闭只走「取消」/ Esc / 点遮罩。 -->
  <div
    v-if="ed.relationOpen"
    class="lark-doc-relation-layer"
    role="dialog"
    aria-modal="true"
    aria-label="关联已有多维表格"
    @keydown.esc.stop.prevent="ed.closeRelationBitable()"
  >
    <div
      class="lark-doc-relation-mask"
      @mousedown.prevent="ed.closeRelationBitable()"
    />
    <section class="lark-doc-relation-content">
      <!-- Header 1032×72（= 1080 − 24×2），只有标题 + 面包屑，右侧刻意留空。 -->
      <header class="lark-doc-relation-header">
        <button
          v-if="ed.relationStep === 'table'"
          type="button"
          class="lark-doc-relation-back"
          aria-label="返回选择多维表格"
          @mousedown.prevent="ed.backToRelationBase()"
        >
          <LarkDocIcon
            name="chevron-right"
            :size="16"
            style="transform: rotate(180deg)"
          />
        </button>
        <h3 class="lark-doc-relation-title">
          {{ ed.relationStep === 'table' ? '选择数据表' : '关联已有多维表格' }}
        </h3>
        <span
          v-if="ed.relationStep === 'table'"
          class="lark-doc-relation-crumb"
        >{{ ed.relationBaseName }}</span>
      </header>

      <!-- Body 1032×525：列表 + （空态 / 加载 / 报错三选一）。 -->
      <div class="lark-doc-relation-body">
        <ul
          v-if="ed.relationStep === 'base' && ed.relationBases.length"
          class="lark-doc-relation-list"
        >
          <li
            v-for="base in ed.relationBases"
            :key="base.appToken"
            class="lark-doc-relation-item"
            :class="{ 'is-active': ed.relationBaseToken === base.appToken }"
            role="button"
            tabindex="0"
            @mousedown.prevent="ed.pickRelationBase(base)"
            @keydown.enter.prevent="ed.pickRelationBase(base)"
          >
            <!-- 列表项文案形如「{多维表格名} 所有者: {用户名}」（§4.5 实测）。 -->
            <span class="lark-doc-relation-item-name">{{ base.name || '未命名多维表格' }}</span>
            <span class="lark-doc-relation-item-owner">所有者: {{ base.ownerName || '未知' }}</span>
          </li>
        </ul>

        <ul
          v-else-if="ed.relationStep === 'table' && ed.relationTables.length"
          class="lark-doc-relation-list"
        >
          <li
            v-for="table in ed.relationTables"
            :key="table.tableId"
            class="lark-doc-relation-item"
            :class="{ 'is-active': ed.relationTableId === table.tableId }"
            role="button"
            tabindex="0"
            @mousedown.prevent="ed.pickRelationTable(table)"
            @keydown.enter.prevent="ed.pickRelationTable(table)"
          >
            <span class="lark-doc-relation-item-name">{{ table.name || '未命名数据表' }}</span>
          </li>
        </ul>

        <!-- 空态 / 加载 / 报错共用一块位置：三者互斥，且**都要能解释**为什么没东西可选。 -->
        <div
          v-else
          class="lark-doc-relation-empty"
          :class="{ 'is-error': !!ed.relationError }"
        >
          {{ ed.relationHint }}
        </div>
      </div>

      <!-- Footer 1032×80：左摘要 + 右「取消 确认」。 -->
      <footer class="lark-doc-relation-footer">
        <span class="lark-doc-relation-selection">{{ ed.relationSelectionText }}</span>
        <button
          type="button"
          class="lark-doc-relation-btn is-plain"
          @mousedown.prevent="ed.closeRelationBitable()"
        >
          取消
        </button>
        <button
          type="button"
          class="lark-doc-relation-btn is-primary"
          :disabled="ed.relationConfirmDisabled"
          :aria-disabled="String(ed.relationConfirmDisabled)"
          :title="ed.relationConfirmReason"
          @mousedown.prevent="ed.confirmRelationBitable()"
        >
          确认
        </button>
      </footer>
    </section>
  </div>
</template>

<script>
// RelationBitableDialog —— §4.5 模态视图层。状态机在 `editor/relationBitableMixin.js`。
//
// 挂在 `LarkDocOverlays.vue` 的固定兄弟层（同一条 fixed 纪律：祖先带 transform 会漂）。
// 遮罩与内容都在 `.lark-doc-relation-layer` 内：规格里 wrap 与 mask 同 z 1000，
// 靠 DOM 顺序压住，这里用「一个 fixed 容器 + 内部 absolute 遮罩」表达同一件事。
import LarkDocIcon from '../LarkDocIcon.vue'

export default {
  name: 'LarkDocRelationBitableDialog',
  components: { LarkDocIcon },
  props: {
    ed: { type: Object, required: true },
  },
}
</script>
