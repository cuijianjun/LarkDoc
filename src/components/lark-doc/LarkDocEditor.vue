<template>
  <section
    ref="root"
    class="lark-doc"
    :class="[`lark-doc-width-${widthMode}`, { 'lark-doc-reading': effectiveReadonly, 'lark-doc-slides': slides, 'lark-doc-fullscreen': fullscreen, 'lark-doc-titlebar-fixed': larkDocConfig.layout.titleBarFixed, 'lark-doc-toolbar-fixed': larkDocConfig.layout.toolbarFixed }]"
    @keydown.esc="closeOverlay"
  >
    <a
      class="lark-doc-skip"
      href="#lark-doc-editor"
    >跳到正文</a>
    <TopBar :ed="self">
      <template #header-actions>
        <slot name="header-actions" />
      </template>
    </TopBar>

    <ToolbarBar :ed="self">
      <template #header-actions>
        <slot name="header-actions" />
      </template>
    </ToolbarBar>
    <SearchPanel
      ref="searchInput"
      :ed="self"
    />
    <TableTools :ed="self" />


    <div class="lark-doc-body">
      <button
        v-if="!outlineOpen && featureEnabled('outline')"
        type="button"
        class="lark-doc-outline-reopen"
        aria-label="展开目录"
        title="展开目录"
        @click="outlineOpen = true"
      >
        ☰
      </button>
      <aside
        v-if="outlineOpen && featureEnabled('outline')"
        class="lark-doc-outline"
        aria-label="文档目录"
      >
        <div class="lark-doc-outline-heading">
          <strong>目录</strong><button
            type="button"
            aria-label="关闭目录"
            @click="outlineOpen = false"
          >
            <lark-doc-icon
              :size="14"
              name="close"
            />
          </button>
        </div><p v-if="!outline.length">
          添加标题后自动生成目录
        </p><div
          v-for="item in outlineItems"
          :key="item.pos"
          class="lark-doc-outline-item"
          :style="{ paddingLeft: `${Math.min(item.level - 1, 5) * 10}px` }"
        >
          <button
            v-if="item.hasChildren"
            type="button"
            :class="{ active: item.pos === activeHeading }"
            :aria-label="`${item.collapsed ? '展开' : '收起'}目录：${item.text || '标题'}`"
            :aria-expanded="String(!item.collapsed)"
            :title="item.collapsed ? '展开目录' : '收起目录'"
            @click="toggleOutline(item.pos)"
          >
            <span
              class="lark-doc-outline-arrow"
              :class="{ 'is-collapsed': item.collapsed }"
              aria-hidden="true"
            />
          </button><span
            v-else
            class="lark-doc-outline-toggle-placeholder"
            aria-hidden="true"
          />
          <button
            type="button"
            :class="{ active: item.pos === activeHeading }"
            @click="jumpHeading(item.pos)"
          >
            {{ item.text || '无标题' }}
          </button>
        </div>
      </aside>
      <main class="lark-doc-main">
        <div
          v-if="slides"
          class="lark-doc-slide-stage"
          aria-label="幻灯片演示"
        >
          <p class="lark-doc-slide-counter">
            {{ slideIndex + 1 }} / {{ slideChapters.length }}
          </p><h1>{{ slideChapters[slideIndex].title }}</h1><p>{{ slideChapters[slideIndex].text }}</p><div>
            <button
              type="button"
              :disabled="slideIndex === 0"
              @click="slideIndex -= 1"
            >
              上一页
            </button><button
              type="button"
              :disabled="slideIndex === slideChapters.length - 1"
              @click="slideIndex += 1"
            >
              下一页
            </button><button
              type="button"
              @click="toggleSlides"
            >
              退出演示
            </button>
          </div>
        </div><div
          v-show="!slides"
          class="lark-doc-paper"
          @pointermove="onPaperPointerMove"
        >
          <div
            v-if="editor && !effectiveReadonly && featureEnabled('blockHandle') && handleRange"
            class="lark-doc-block-handle"
            :class="{ 'is-menu-open': blockMenuOpen }"
            :style="blockHandleStyle"
            @mouseenter="onBlockHandleEnter"
            @mouseleave="onBlockHandleLeave"
          >
            <button
              v-if="handleIsEmptyParagraph"
              type="button"
              class="lark-doc-empty-block-insert"
              aria-label="插入内容"
              title="插入内容"
              @mousedown.prevent
              @mouseenter="openEmptyBlockInsertMenu"
              @click="openEmptyBlockInsertMenu"
            >
              ＋
            </button><button
              v-else-if="!handleIsTaskList"
              type="button"
              class="lark-doc-block-handle-main"
              :class="{ 'is-callout': handleBlockNode()?.type?.name === 'callout' }"
              aria-label="块操作"
              title="块操作与拖动"
              :draggable="featureEnabled('blockDrag')"
              @mouseenter="openBlockMenuOnHover"
              @focus="openBlockMenuOnHover"
              @click="openBlockMenu"
              @pointerdown="handlePressed = true"
              @dragstart="startBlockDrag"
              @dragend="handlePressed = false; dragging = null; dropPosition = null; refreshHandleHighlight()"
            >
              <span class="lark-doc-block-handle-type">{{ handleGlyph }}</span><span
                class="lark-doc-block-handle-dots"
                aria-hidden="true"
              >⠿</span>
            </button><div
              v-if="blockMenuOpen"
              class="lark-doc-block-menu"
              role="menu"
              aria-label="块操作"
              :style="blockMenuStyle"
              @mouseenter="onBlockMenuEnter"
              @mouseleave="onBlockMenuLeave"
              @focusin="onBlockMenuFocusIn"
              @focusout="onBlockMenuFocusOut"
            >
              <button
                v-if="featureEnabled('ai')"
                type="button"
                role="menuitem"
                class="lark-doc-block-menu-ai"
                title="问问 AI"
                @mousedown.prevent
                @click="$emit('ai-request', 'rewrite')"
              >
                <lark-doc-icon
                  class="lark-doc-block-menu-icon"
                  name="sparkle"
                  :size="16"
                /><span>问问 AI</span>
              </button>
              <div
                v-if="featureEnabled('ai')"
                class="lark-doc-block-menu-divider"
                role="separator"
              />
              <div
                v-if="visibleBlockTypeActions.length && !handleIsTable"
                class="lark-doc-block-menu-section lark-doc-block-type-actions"
                role="group"
                aria-label="类型转换"
              >
                <button
                  v-for="item in visibleBlockTypeActions"
                  :key="item.id"
                  type="button"
                  role="menuitem"
                  :aria-label="item.label"
                  :class="{ active: blockTypeActive(item.id) }"
                  :title="item.label"
                  @mousedown.prevent
                  @click="blockTypeAction(item.id)"
                >
                  <lark-doc-icon
                    class="lark-doc-block-type-icon"
                    :name="item.icon"
                    :size="18"
                  /><span class="sr-only">{{ item.label }}</span>
                </button>
              </div>
              <button
                v-if="isBlockActionEnabled('duplicate') && !handleIsTable"
                type="button"
                role="menuitem"
                class="lark-doc-block-menu-duplicate"
                title="创建副本"
                aria-label="创建副本"
                @mousedown.prevent
                @click="blockAction('duplicate')"
              >
                <lark-doc-icon
                  name="copy"
                  :size="16"
                />
              </button>
              <div
                v-if="!handleIsTable"
                class="lark-doc-block-menu-divider"
                role="separator"
              />
              <button
                v-if="featureEnabled('blockStyle') && !handleIsTable"
                type="button"
                role="menuitem"
                class="lark-doc-block-submenu-trigger"
                aria-haspopup="menu"
                :aria-expanded="blockAlignMenuOpen ? 'true' : 'false'"
                title="缩进和对齐"
                @mousedown.prevent
                @mouseenter="openBlockAlignMenuOnHover"
                @focus="openBlockAlignMenuOnHover"
                @click.stop="openBlockAlignMenuOnHover"
              >
                <lark-doc-icon
                  class="lark-doc-block-menu-icon"
                  name="align-left"
                  :size="16"
                /><span>缩进和对齐</span><span
                  class="lark-doc-block-menu-arrow"
                  aria-hidden="true"
                >›</span>
              </button><button
                v-if="featureEnabled('blockStyle') && !handleIsTable"
                type="button"
                role="menuitem"
                class="lark-doc-block-submenu-trigger"
                aria-haspopup="menu"
                :aria-expanded="blockColorMenuOpen ? 'true' : 'false'"
                title="颜色"
                @mousedown.prevent
                @mouseenter="openBlockColorMenuOnHover"
                @focus="openBlockColorMenuOnHover"
                @click.stop="openBlockColorMenuOnHover"
              >
                <lark-doc-icon
                  class="lark-doc-block-menu-icon"
                  name="palette"
                  :size="16"
                /><span>颜色</span><span
                  class="lark-doc-block-menu-arrow"
                  aria-hidden="true"
                >›</span>
              </button><div
                v-if="blockColorMenuOpen && featureEnabled('blockStyle')"
                class="lark-doc-block-submenu lark-doc-block-color-submenu"
                role="menu"
                aria-label="颜色"
                :style="blockColorMenuStyle"
              >
                <button
                  type="button"
                  role="menuitem"
                  aria-label="恢复默认颜色"
                  @mousedown.prevent
                  @click="blockColorAction('')"
                >
                  <span
                    class="lark-doc-block-color-swatch is-transparent"
                    aria-hidden="true"
                  /><span>恢复默认</span>
                </button><button
                  v-for="color in colorPaletteOptions"
                  :key="`block-color-${color.value || 'default'}`"
                  type="button"
                  role="menuitem"
                  :aria-label="color.label"
                  @mousedown.prevent
                  @click="blockColorAction(color.value)"
                >
                  <span
                    class="lark-doc-block-color-swatch"
                    :style="{ backgroundColor: color.value }"
                    aria-hidden="true"
                  /><span>{{ color.label }}</span>
                </button>
              </div>
              <div
                v-if="handleIsTable && featureEnabled('tables')"
                class="lark-doc-block-menu-table"
                role="group"
                aria-label="表格设置"
              >
                <button
                  type="button"
                  role="menuitemcheckbox"
                  class="lark-doc-block-menu-row"
                  :aria-checked="String(handleTableHeaderState().row)"
                  title="标题行"
                  @mousedown.prevent
                  @click="tableHandleAction('toggleHeaderRow')"
                >
                  <lark-doc-icon
                    class="lark-doc-block-menu-icon"
                    name="table-header-row"
                    :size="16"
                  /><span>标题行</span><span
                    class="lark-doc-menu-switch"
                    :class="{ on: handleTableHeaderState().row }"
                    aria-hidden="true"
                  ><span class="lark-doc-menu-switch-dot" /></span>
                </button>
                <button
                  type="button"
                  role="menuitemcheckbox"
                  class="lark-doc-block-menu-row"
                  :aria-checked="String(handleTableHeaderState().column)"
                  title="标题列"
                  @mousedown.prevent
                  @click="tableHandleAction('toggleHeaderColumn')"
                >
                  <lark-doc-icon
                    class="lark-doc-block-menu-icon"
                    name="table-header-col"
                    :size="16"
                  /><span>标题列</span><span
                    class="lark-doc-menu-switch"
                    :class="{ on: handleTableHeaderState().column }"
                    aria-hidden="true"
                  ><span class="lark-doc-menu-switch-dot" /></span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  class="lark-doc-block-menu-row"
                  title="均分列宽"
                  @mousedown.prevent
                  @click="tableHandleAction('distributeColumns')"
                >
                  <lark-doc-icon
                    class="lark-doc-block-menu-icon"
                    name="distribute-cols"
                    :size="16"
                  /><span>均分列宽</span>
                </button>
              </div>
              <div
                v-if="visibleBlockListActions.length"
                class="lark-doc-block-menu-divider"
                role="separator"
              />
              <button
                v-for="item in visibleBlockListActions"
                :key="item.id"
                type="button"
                role="menuitem"
                class="lark-doc-block-menu-row"
                :title="item.label"
                @mousedown.prevent
                @click="blockAction(item.id)"
              >
                <lark-doc-icon
                  class="lark-doc-block-menu-icon"
                  :name="item.icon"
                  :size="16"
                /><span>{{ item.label }}</span>
              </button>
              <div
                v-if="featureEnabled('blockStyle')"
                class="lark-doc-block-menu-divider"
                role="separator"
              />
              <button
                v-if="isBlockActionEnabled('addBelow')"
                type="button"
                role="menuitem"
                class="lark-doc-block-menu-row"
                title="在下方添加正文"
                @mousedown.prevent
                @click="blockAction('addBelow')"
              >
                <lark-doc-icon
                  class="lark-doc-block-menu-icon"
                  name="plus"
                  :size="16"
                /><span>在下方添加正文</span>
              </button>
            </div><div
              v-if="blockAlignMenuOpen && featureEnabled('blockStyle')"
              class="lark-doc-block-submenu"
              role="menu"
              aria-label="缩进和对齐"
              :style="blockAlignMenuStyle"
            >
              <button
                v-for="align in ['left', 'center', 'right', 'justify']"
                :key="`block-align-${align}`"
                type="button"
                role="menuitem"
                :aria-pressed="String(blockAlignValue() === align)"
                :class="{ active: blockAlignValue() === align }"
                @mousedown.prevent
                @click="blockAlignAction(align)"
              >
                <span
                  class="lark-doc-block-align-glyph"
                  aria-hidden="true"
                >{{ alignGlyphs[align] }}</span><span>{{ alignNames[align] }}对齐</span><span
                  v-if="blockAlignValue() === align"
                  class="lark-doc-block-align-check"
                  aria-hidden="true"
                >✓</span>
              </button>
              <div
                class="lark-doc-block-submenu-divider"
                role="separator"
              />
              <button
                type="button"
                role="menuitem"
                :disabled="!blockAlignCanIncrease()"
                @mousedown.prevent
                @click="blockAlignAction('increaseIndent')"
              >
                <span
                  class="lark-doc-block-align-glyph"
                  aria-hidden="true"
                >⇥</span><span>增加缩进</span><span
                  v-if="!blockAlignCanIncrease()"
                  class="lark-doc-block-align-help"
                  aria-label="已达到最大缩进"
                >?</span>
              </button><button
                type="button"
                role="menuitem"
                :disabled="blockAlignIndent() <= 0"
                @mousedown.prevent
                @click="blockAlignAction('decreaseIndent')"
              >
                <span
                  class="lark-doc-block-align-glyph"
                  aria-hidden="true"
                >⇤</span><span>减少缩进</span>
              </button>
            </div>
          </div><div
            v-if="dropPosition !== null"
            class="lark-doc-drop-line"
            :style="{ top: `${dropLineTop}px` }"
            aria-hidden="true"
          /><editor-content
            v-if="editor"
            id="lark-doc-editor"
            :editor="editor"
            class="lark-doc-editor-content"
            @keydown.native="onEditorKeydown"
            @pointerdown.native="onColumnPointerDown"
            @pointermove.native="onEditorPointerMove"
            @dragover.native="onBlockDragOver"
            @drop.native="onBlockDrop"
          /><div
            v-if="activeCalloutVisible && featureEnabled('callouts')"
            class="lark-doc-callout-tools"
            :style="calloutToolsStyle"
            role="toolbar"
            aria-label="高亮块工具"
            @mousedown.prevent
          >
            <label
              title="高亮块文字颜色"
              aria-haspopup="menu"
              @click.prevent="toggleColorPalette('calloutColor', $event)"
            ><span aria-hidden="true">A</span><input
              type="color"
              aria-label="高亮块文字颜色"
              :value="calloutColor('color', '#263830')"
              @input="setCalloutColor('color', $event.target.value)"
            ></label><label
              title="高亮块背景颜色"
              aria-haspopup="menu"
              @click.prevent="toggleColorPalette('calloutBackground', $event)"
            ><span aria-hidden="true">◉</span><input
              type="color"
              aria-label="高亮块背景颜色"
              :value="calloutColor('backgroundColor', '#eff9f4')"
              @input="setCalloutColor('backgroundColor', $event.target.value)"
            ></label><label
              title="高亮块边框颜色"
              aria-haspopup="menu"
              @click.prevent="toggleColorPalette('calloutBorder', $event)"
            ><span aria-hidden="true">▔</span><input
              type="color"
              aria-label="高亮块边框颜色"
              :value="calloutColor('borderColor', '#00b887')"
              @input="setCalloutColor('borderColor', $event.target.value)"
            ></label><button
              type="button"
              aria-label="更换高亮块图标"
              @click="toggleCalloutEmoji"
            >
              ☺
            </button><button
              type="button"
              aria-label="恢复高亮块默认样式"
              @click="resetCalloutStyle"
            >
              ↺
            </button><button
              type="button"
              aria-label="删除高亮块"
              @click="deleteActiveCallout"
            >
              ⌫
            </button><div
              v-if="calloutEmojiOpen"
              class="lark-doc-callout-emoji-picker"
              role="menu"
              aria-label="高亮块图标"
            >
              <label class="lark-doc-callout-emoji-search"><span class="sr-only">搜索表情</span><input
                v-model="calloutEmojiQuery"
                type="search"
                aria-label="搜索高亮块图标"
                placeholder="搜索"
              ></label><button
                type="button"
                aria-label="随机高亮块图标"
                title="随机高亮块图标"
                @click="setCalloutEmoji(pickRandomCalloutEmoji())"
              >
                ↺
              </button><div
                class="lark-doc-callout-emoji-tabs"
                role="tablist"
                aria-label="高亮块图标分类"
              >
                <button
                  type="button"
                  role="tab"
                  aria-label="最近使用"
                  :aria-selected="String(calloutEmojiCategory === 'recent')"
                  @click="calloutEmojiCategory = 'recent'"
                >
                  最近
                </button><button
                  type="button"
                  role="tab"
                  aria-label="全部"
                  :aria-selected="String(calloutEmojiCategory === 'all')"
                  @click="calloutEmojiCategory = 'all'"
                >
                  全部
                </button><button
                  v-for="category in calloutEmojiCategories"
                  :key="category"
                  type="button"
                  role="tab"
                  :aria-label="category"
                  :aria-selected="String(calloutEmojiCategory === category)"
                  @click="calloutEmojiCategory = category"
                >
                  {{ category }}
                </button>
              </div><p
                v-if="calloutEmojiCategory === 'recent' && !filteredCalloutEmojiItems.length"
                class="lark-doc-callout-emoji-empty"
              >
                暂无最近使用
              </p><button
                v-for="item in filteredCalloutEmojiItems"
                :key="item.value"
                type="button"
                role="menuitem"
                :aria-label="item.label"
                @click="setCalloutEmoji(item.glyph)"
              >
                {{ item.glyph }}
              </button>
            </div>
          </div><div
            v-if="featureEnabled('tables') && tableBoundary.visible && tableBoundary.hover && !effectiveReadonly"
            class="lark-doc-table-boundary-tools"
            :class="{ 'is-column': tableBoundary.hover === 'column', 'is-row': tableBoundary.hover === 'row' }"
            :style="{ ...tableBoundary.style, '--lark-doc-column-line-left': `${tableBoundary.columnLineLeft}px`, '--lark-doc-row-line-top': `${tableBoundary.rowLineTop}px` }"
            role="toolbar"
            aria-label="表格边界操作"
            @pointerenter="keepTableBoundaryHover"
            @pointerleave="clearTableBoundaryHover"
          >
            <span
              v-if="tableBoundary.hover === 'column'"
              class="lark-doc-table-boundary-line is-column-line"
              :style="{ left: `${tableBoundary.columnLineLeft}px` }"
              aria-hidden="true"
            /><span
              v-if="tableBoundary.hover === 'row'"
              class="lark-doc-table-boundary-line is-row-line"
              :style="{ top: `${tableBoundary.rowLineTop}px` }"
              aria-hidden="true"
            />
            <button
              v-if="tableBoundary.hover === 'column'"
              type="button"
              class="is-column-before"
              aria-label="在左侧插入列"
              title="在左侧插入列"
              @mousedown.prevent
              @click="tableBoundaryAction('addColumnBefore')"
            >
              ＋
            </button><button
              v-if="tableBoundary.hover === 'column'"
              type="button"
              class="is-column-after"
              aria-label="在右侧插入列"
              title="在右侧插入列"
              @mousedown.prevent
              @click="tableBoundaryAction('addColumnAfter')"
            >
              ＋
            </button><button
              v-if="tableBoundary.hover === 'row'"
              type="button"
              class="is-row-before"
              aria-label="在上方插入行"
              title="在上方插入行"
              @mousedown.prevent
              @click="tableBoundaryAction('addRowBefore')"
            >
              ＋
            </button><button
              v-if="tableBoundary.hover === 'row'"
              type="button"
              class="is-row-after"
              aria-label="在下方插入行"
              title="在下方插入行"
              @mousedown.prevent
              @click="tableBoundaryAction('addRowAfter')"
            >
              ＋
            </button>
          </div>
        </div><footer class="lark-doc-status">
          <span>{{ wordCount }}{{ effectiveMaxLength > 0 ? ` / ${effectiveMaxLength}` : '' }} 字 · {{ outline.length }} 个标题</span><span>{{ effectiveReadonly ? '仅阅读' : '输入 / 快速插入' }}</span>
        </footer>
      </main>
      <aside
        v-if="$slots['side-panel']"
        class="lark-doc-external-panel"
      >
        <slot name="side-panel" />
      </aside>
    </div>

    <div
      v-if="bubbleVisible && !effectiveReadonly"
      class="lark-doc-bubble"
      :style="bubbleStyle"
      role="toolbar"
      aria-label="划词工具栏"
      @mousedown.prevent
    >
      <button
        v-if="featureEnabled('ai')"
        type="button"
        class="lark-doc-bubble-ai"
        title="问问 AI"
        aria-label="问问 AI"
        @click="$emit('ai-request', 'rewrite')"
      >
        <lark-doc-icon
          name="block-quote"
          :size="16"
        /><span>问问 AI</span>
      </button>
      <span
        v-if="featureEnabled('ai')"
        class="lark-doc-bubble-divider"
        aria-hidden="true"
      />
      <div
        v-if="featureEnabled('blockStyle')"
        class="lark-doc-bubble-heading"
        @mouseleave="scheduleBubbleHeadingClose"
      >
        <button
          type="button"
          class="lark-doc-bubble-heading-trigger"
          title="标题级别"
          aria-label="标题级别"
          aria-haspopup="menu"
          :aria-expanded="bubbleHeadingOpen ? 'true' : 'false'"
          @mouseenter="openBubbleHeadingMenu"
          @focus="openBubbleHeadingMenu"
          @click.prevent="openBubbleHeadingMenu"
        >
          <span aria-hidden="true">{{ bubbleHeadingValue() }}</span><lark-doc-icon
            class="lark-doc-bubble-caret lark-doc-caret"
            :size="12"
            name="chevronDown"
          />
        </button>
        <lark-doc-heading-menu
          v-if="bubbleHeadingOpen"
          :active-level="bubbleHeadingLevel()"
          :style="bubbleHeadingMenuStyle"
          aria-label="划词标题级别"
          @keep-open="cancelBubbleHoverClose"
          @schedule-close="scheduleBubbleHeadingClose"
          @choose="bubbleHeadingAction"
        />
      </div>
      <div
        class="lark-doc-bubble-align"
        @mouseenter="openBubbleAlignMenu"
        @mouseleave="scheduleBubbleAlignClose"
      >
        <button
          type="button"
          class="lark-doc-bubble-align-trigger"
          aria-label="缩进和对齐"
          title="缩进和对齐"
          aria-haspopup="menu"
          :aria-expanded="bubbleAlignOpen ? 'true' : 'false'"
          @focus="openBubbleAlignMenu"
          @click.prevent="openBubbleAlignMenu"
        >
          <lark-doc-icon
            :name="`align-${bubbleAlignValue()}`"
            :size="16"
          /><lark-doc-icon
            class="lark-doc-bubble-caret lark-doc-caret"
            :size="12"
            name="chevronDown"
          />
        </button>
        <div
          v-if="bubbleAlignOpen"
          class="lark-doc-bubble-align-menu"
          role="menu"
          aria-label="划词缩进和对齐"
          :style="bubbleAlignMenuStyle"
          @mouseenter="cancelBubbleHoverClose"
          @mouseleave="scheduleBubbleAlignClose"
        >
          <button
            v-for="align in ['left', 'center', 'right', 'justify']"
            :key="`bubble-align-${align}`"
            type="button"
            role="menuitem"
            :aria-pressed="String(bubbleAlignValue() === align)"
            :class="{ active: bubbleAlignValue() === align }"
            :data-tooltip="bubbleAlignTooltip(align)"
            :title="bubbleAlignTooltip(align)"
            @mousedown.prevent
            @click="bubbleAlignAction(align)"
          >
            <span
              class="lark-doc-block-align-glyph"
              aria-hidden="true"
            >{{ alignGlyphs[align] }}</span><span>{{ alignNames[align] }}对齐</span><span
              v-if="bubbleAlignValue() === align"
              class="lark-doc-block-align-check"
              aria-hidden="true"
            >✓</span>
          </button>
          <div
            class="lark-doc-block-submenu-divider"
            role="separator"
          />
          <button
            type="button"
            role="menuitem"
            :disabled="!bubbleAlignCanIncrease()"
            :data-tooltip="bubbleAlignTooltip('increaseIndent')"
            :title="bubbleAlignTooltip('increaseIndent')"
            @mousedown.prevent
            @click="bubbleAlignAction('increaseIndent')"
          >
            <span
              class="lark-doc-block-align-glyph"
              aria-hidden="true"
            >⇥</span><span>增加缩进</span><span
              v-if="!bubbleAlignCanIncrease()"
              class="lark-doc-block-align-help"
              aria-label="已达到最大缩进"
            >?</span>
          </button>
          <button
            type="button"
            role="menuitem"
            :disabled="bubbleAlignIndent() <= 0"
            :data-tooltip="bubbleAlignTooltip('decreaseIndent')"
            :title="bubbleAlignTooltip('decreaseIndent')"
            @mousedown.prevent
            @click="bubbleAlignAction('decreaseIndent')"
          >
            <span
              class="lark-doc-block-align-glyph"
              aria-hidden="true"
            >⇤</span><span>减少缩进</span>
          </button>
        </div>
      </div>
      <span
        class="lark-doc-bubble-divider"
        aria-hidden="true"
      />
      <button
        v-for="item in bubbleMarkItems"
        :key="`bubble-mark-${item.id}`"
        type="button"
        :aria-label="item.label"
        :title="item.label"
        :aria-pressed="String(isActive(item.id))"
        @click="toggleMark(item.id)"
      >
        <lark-doc-icon
          :name="item.icon"
          :size="16"
        />
      </button>
      <template v-if="bubbleHighlightAllowed">
        <button
          type="button"
          class="lark-doc-bubble-mark-highlight"
          aria-label="高亮"
          title="高亮"
          :aria-pressed="String(isActive('highlight'))"
          @click="toggleMark('highlight')"
        >
          <lark-doc-icon
            name="mark-highlight"
            :size="16"
          />
        </button><button
          type="button"
          class="lark-doc-bubble-caret-button"
          aria-label="选择高亮颜色"
          title="选择高亮颜色"
          @click.prevent="toggleColorPalette('textBackground', $event)"
        >
          <lark-doc-icon
            class="lark-doc-bubble-caret lark-doc-caret"
            :size="12"
            name="chevronDown"
          />
        </button>
      </template>
      <span
        class="lark-doc-bubble-divider"
        aria-hidden="true"
      />
      <button
        type="button"
        aria-label="复制选中文字"
        title="复制选中文字"
        @click="bubbleCopy"
      >
        <lark-doc-icon
          name="copy"
          :size="16"
        />
      </button>
    </div>
    <command-menu
      v-if="menuOpen && !effectiveReadonly"
      :items="filteredCommands"
      :templates="templates"
      :query="menuQuery"
      :position-style="menuStyle"
      :active-id="activeCommandId"
      :kind="menuKind"
      @query="menuQuery = $event; activeCommandIndex = 0"
      @move="moveCommand"
      @choose="chooseCommand"
      @close="closeCommandMenu(true)"
    />
    <div
      v-if="colorPaletteOpen && !effectiveReadonly"
      class="lark-doc-color-palette"
      :class="{ 'lark-doc-color-palette-text': colorPaletteIsText }"
      role="menu"
      :aria-label="`${colorPaletteTitle}面板`"
      :style="colorPaletteStyle"
      @mousedown.prevent
      @mouseenter="cancelPopupHoverClose"
      @mouseleave="scheduleColorPaletteClose"
    >
      <template v-if="colorPaletteIsText">
        <div class="lark-doc-color-palette-text-section">
          <small>字体颜色</small>
          <div class="lark-doc-color-letters">
            <button
              v-for="color in textColorOptions"
              :key="`tc-${color.value}`"
              type="button"
              role="menuitem"
              :aria-label="`字体颜色 ${color.label}`"
              :title="color.label"
              :style="{ color: color.value }"
              :class="{ 'is-active': activeTextColor && activeTextColor.toLowerCase() === color.value.toLowerCase() }"
              @click="applyColorPalette(color.value, 'textColor')"
            >
              A
            </button>
          </div>
        </div>
        <div class="lark-doc-color-palette-text-section">
          <small>背景颜色</small>
          <div
            v-for="(row, rowIndex) in textBackgroundRows"
            :key="`row-${rowIndex}`"
            class="lark-doc-color-grid"
          >
            <button
              v-for="color in row"
              :key="`bg-${color.label}`"
              type="button"
              role="menuitem"
              :aria-label="`背景颜色 ${color.label}`"
              :title="color.label"
              :class="{ 'is-transparent': !color.value, 'is-active': color.value ? (activeTextBackground && activeTextBackground.toLowerCase() === color.value.toLowerCase()) : !activeTextBackground }"
              :style="color.value ? { backgroundColor: color.value } : {}"
              @click="applyColorPalette(color.value, 'textBackground')"
            />
          </div>
        </div>
        <div
          v-if="textColorRecent.length"
          class="lark-doc-color-palette-section lark-doc-color-palette-text-recent"
        >
          <small>最近</small><button
            v-for="color in textColorRecent"
            :key="`recent-text-${color}`"
            type="button"
            role="menuitem"
            :aria-label="`最近颜色 ${color}`"
            :title="color"
            :style="{ backgroundColor: color }"
            @click="applyColorPalette(color, 'textBackground')"
          />
        </div>
        <button
          type="button"
          role="menuitem"
          class="lark-doc-color-palette-reset"
          aria-label="恢复默认颜色"
          @click="resetTextColors"
        >
          恢复默认
        </button>
      </template>
      <template v-else>
        <strong>{{ colorPaletteTitle }}</strong>
        <div
          v-if="colorPaletteRecent.length"
          class="lark-doc-color-palette-section"
        >
          <small>最近</small><button
            v-for="color in colorPaletteRecent"
            :key="`recent-${color}`"
            type="button"
            role="menuitem"
            :aria-label="`最近颜色 ${color}`"
            :title="color"
            :style="{ backgroundColor: color }"
            @click="applyColorPalette(color)"
          />
        </div>
        <div class="lark-doc-color-palette-section">
          <small>推荐</small><button
            v-for="color in colorPaletteOptions"
            :key="color.value || 'default'"
            type="button"
            role="menuitem"
            :aria-label="color.label"
            :title="color.label"
            :class="{ 'is-transparent': !color.value }"
            :style="color.value ? { backgroundColor: color.value } : {}"
            @click="applyColorPalette(color.value)"
          />
        </div>
        <button
          type="button"
          role="menuitem"
          class="lark-doc-color-palette-reset"
          aria-label="恢复默认颜色"
          @click="resetColorPalette"
        >
          恢复默认
        </button>
      </template>
    </div>
    <div
      v-if="tablePicker"
      class="lark-doc-dialog-backdrop"
      @click.self="closeOverlay"
    >
      <section
        class="lark-doc-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="插入表格"
      >
        <header>
          <strong>插入表格</strong><span class="lark-doc-table-grid-size">{{ tablePickerHover.cols }} × {{ tablePickerHover.rows }}</span><button
            type="button"
            aria-label="关闭表格选择"
            @click="closeOverlay"
          >
            <lark-doc-icon
              :size="14"
              name="close"
            />
          </button>
        </header><p>插入支持富文本的表格</p><div class="lark-doc-table-grid">
          <button
            v-for="n in 81"
            :key="n"
            type="button"
            :class="{ 'is-preview': Math.floor((n - 1) / 9) + 1 <= tablePickerHover.rows && ((n - 1) % 9) + 1 <= tablePickerHover.cols }"
            :aria-label="`${((n - 1) % 9) + 1}行${Math.floor((n - 1) / 9) + 1}列`"
            @mouseenter="previewTableSize(Math.floor((n - 1) / 9) + 1, ((n - 1) % 9) + 1)"
            @focus="previewTableSize(Math.floor((n - 1) / 9) + 1, ((n - 1) % 9) + 1)"
            @click="insertTable(Math.floor((n - 1) / 9) + 1, ((n - 1) % 9) + 1)"
          >
            ▦
          </button>
        </div>
      </section>
    </div>
    <div
      v-if="mathDialog || emojiDialog"
      class="lark-doc-dialog-backdrop"
      @click.self="closeOverlay"
    >
      <section
        class="lark-doc-dialog"
        role="dialog"
        aria-modal="true"
        :aria-label="mathDialog ? '插入公式' : '插入表情'"
        @keydown.esc.stop.prevent="closeOverlay"
      >
        <header>
          <strong>{{ mathDialog ? '插入公式' : '插入表情' }}</strong><button
            type="button"
            aria-label="关闭对话框"
            @click="closeOverlay"
          >
            <lark-doc-icon
              :size="14"
              name="close"
            />
          </button>
        </header><template v-if="mathDialog">
          <label>LaTeX <input
            ref="mathInput"
            v-model="mathValue"
            aria-label="LaTeX 公式"
            placeholder="例如 x^2 + y^2"
            @keydown.enter.prevent="insertMath"
          ></label><p
            v-if="mathError"
            role="alert"
            class="lark-doc-error"
          >
            {{ mathError }}
          </p><button
            type="button"
            @click="insertMath"
          >
            插入
          </button>
        </template><div
          v-else
          class="lark-doc-emoji-grid"
        >
          <button
            v-for="item in emojiItems"
            :key="item.value"
            type="button"
            :aria-label="item.label"
            @click="insertEmoji(item.value)"
          >
            {{ item.glyph }}
          </button>
        </div>
      </section>
    </div>
    <div
      v-if="linkDialog"
      class="lark-doc-dialog-backdrop"
      @click.self="closeOverlay"
    >
      <section
        class="lark-doc-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="设置链接"
        @keydown.esc.stop.prevent="closeOverlay"
      >
        <header>
          <strong>设置链接</strong><button
            type="button"
            aria-label="关闭链接设置"
            @click="closeOverlay"
          >
            <lark-doc-icon
              :size="14"
              name="close"
            />
          </button>
        </header>
        <label v-if="linkInsertMode">链接文本 <input
          ref="linkTextInput"
          v-model="linkText"
          aria-label="链接文本"
          placeholder="输入链接显示文字"
          @keydown.enter.prevent="applyLink"
        ></label>
        <label>链接地址 <input
          ref="linkInput"
          v-model="linkValue"
          aria-label="链接地址"
          placeholder="https://example.com"
          @keydown.enter.prevent="applyLink"
        ></label>
        <p v-if="linkInsertMode">
          输入显示文字和地址后插入本地链接；
        </p><p>
          仅允许 http、https、mailto、tel 或 # 锚点链接；取消不会改变选区。
        </p>
        <button
          type="button"
          :disabled="!linkValue || (linkInsertMode && !linkText.trim())"
          @click="applyLink"
        >
          应用链接
        </button><button
          type="button"
          :disabled="linkInsertMode || !isActive('link')"
          @click="removeLink"
        >
          解除链接
        </button>
      </section>
    </div>
    <div
      v-if="helpOpen"
      class="lark-doc-dialog-backdrop"
      @click.self="closeOverlay"
    >
      <section
        class="lark-doc-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="快捷键帮助"
      >
        <header>
          <strong>快捷键</strong><button
            type="button"
            aria-label="关闭快捷键帮助"
            @click="closeOverlay"
          >
            <lark-doc-icon
              :size="14"
              name="close"
            />
          </button>
        </header><p>⌘/Ctrl+B 加粗 · ⌘/Ctrl+I 斜体 · ⌘/Ctrl+Z 撤销</p><p>行首或空格后输入 / 插入内容；Tab 调整列表层级或段落缩进，Shift+Tab 减少缩进。</p>
      </section>
    </div>
    <input
      ref="imageInput"
      type="file"
      accept="image/png,image/jpeg,image/gif,image/webp"
      class="lark-doc-file-input"
      aria-label="选择本地图片"
      @change="onImageInput"
    >
    <p
      v-if="error"
      class="lark-doc-toast"
      role="alert"
    >
      {{ error }} <button
        type="button"
        aria-label="关闭错误"
        @click="error = ''"
      >
        <lark-doc-icon
          :size="14"
          name="close"
        />
      </button>
    </p>
    <!-- 标题编号菜单：点编号按钮弹出，三项与飞书一致（继续/重新开始/设置值） -->
    <div
      v-if="headingNumberMenu.open"
      class="lark-doc-heading-number-menu"
      :class="{ 'is-editing': headingNumberEditing }"
      :style="headingNumberMenuStyle"
      role="menu"
      aria-label="编号设置"
      @mousedown.prevent
    >
      <template v-if="!headingNumberEditing">
        <button
          v-for="action in headingNumberActions"
          :key="action.id"
          type="button"
          class="lark-doc-heading-number-item"
          :class="{ 'is-disabled': headingNumberMenuDisabled(action.id) }"
          role="menuitem"
          :aria-disabled="headingNumberMenuDisabled(action.id) ? 'true' : 'false'"
          :data-menu-id="action.id"
          :disabled="headingNumberMenuDisabled(action.id)"
          @click="headingNumberAction(action.id)"
        >
          <span
            class="lark-doc-heading-number-icon"
            aria-hidden="true"
          ><lark-doc-icon
            :size="18"
            :name="action.icon"
          /></span><span class="lark-doc-heading-number-text">{{ action.label }}</span>
        </button>
      </template>
      <label
        v-else
        class="lark-doc-heading-number-editor"
      >
        <input
          v-model="headingNumberDraft"
          class="lark-doc-heading-number-input"
          type="text"
          inputmode="numeric"
          aria-label="编号值"
          @keydown="onHeadingNumberInputKeydown"
          @blur="applyHeadingNumberValue()"
        ><span
          class="lark-doc-heading-number-spinner"
          aria-hidden="true"
        ><button
          type="button"
          tabindex="-1"
          aria-label="增加编号"
          @click="headingNumberDraft = String(Math.min(999, (Number(headingNumberDraft) || 1) + 1))"
        ><lark-doc-icon
          :size="10"
          name="chevronUp"
        /></button><button
          type="button"
          tabindex="-1"
          aria-label="减少编号"
          @click="headingNumberDraft = String(Math.max(1, (Number(headingNumberDraft) || 1) - 1))"
        ><lark-doc-icon
          :size="10"
          name="chevronDown"
        /></button></span>
      </label>
    </div>
  </section>
</template>

<script>
// LarkDocEditor.vue —— 编辑器视图层：模板、props、生命周期与内容管理核心方法。
// 各 UI 子域拆分到 ./editor/ 下的 mixin（视图模式/命令菜单/表格工具/区块句柄/区块菜单/
// 气泡菜单/高亮块与颜色盘/工具栏菜单），经 Vue 2 选项合并后仍以 this.xxx 供模板与生命周期调用。
import { Editor, EditorContent } from '@tiptap/vue-2'
import { DOMParser as ProseMirrorDOMParser } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import { closeHistory } from '@tiptap/pm/history'
import CommandMenu from './CommandMenu.vue'
import LarkDocHeadingMenu from './LarkDocHeadingMenu.vue'
import LarkDocIcon from './LarkDocIcon.vue'
import TopBar from './editor/TopBar.vue'
import ToolbarBar from './editor/ToolbarBar.vue'
import SearchPanel from './editor/SearchPanel.vue'
import TableTools from './editor/TableTools.vue'
import { createLarkDocExtensions } from './extensions'
import { clampBlockIndent, maxIndentAt, stepBlockIndent, collectOutline, foldableIdPositions, safeAttachmentId, safeUrl, sanitizeHTML, validateDocument } from './documentOperations'
import { isBlockActionEnabled, isConfigEnabled, mergeLegacyConfig } from './larkDocConfig'
// Vue 2 专属 NodeView（图片 / 代码块）住在 adapters/vue2/，由它自己注册进 core 的
// NodeView 注册表；这里只负责把适配层拉起来，core 与 Vue 之间不再有静态绑定。
// 注意：core → adapters 这条 import 是刻意的临时反向依赖（P0-01 只做到「注册表缝」，
// 装配动作仍由 Vue 2 宿主触发），Task 6 拆三端适配时会把 registerVue2NodeViews()
// 的调用点从 core 移到真正的宿主入口，届时删除本行。
import { registerVue2NodeViews } from '../../adapters/vue2/nodeviews'
import viewModesMixin from './editor/viewModesMixin'
import commandMenuMixin from './editor/commandMenuMixin'
import tableToolsMixin from './editor/tableToolsMixin'
import toolbarCollapseMixin from './editor/toolbarCollapseMixin'
import blockHandleMixin from './editor/blockHandleMixin'
import blockMenuMixin from './editor/blockMenuMixin'
import bubbleMenuMixin from './editor/bubbleMenuMixin'
import calloutColorMixin from './editor/calloutColorMixin'
import toolbarMenusMixin from './editor/toolbarMenusMixin'
import headingNumberMixin from './editor/headingNumberMixin'
import { setTransactionMetadata, TRANSACTION_ORIGINS } from '../../core/transactionMetadata'
import { createNetworkPolicy } from '../../networkPolicy'
// 旧数据兼容：Vditor getHTML() 产物在 setContent 前归一化。
import { normalizeVditorHtml } from '../../legacy'
// lark-doc.css 由包样式入口（style.css ← src/index.js）统一引入：组件侧重复 import 会让
// 同一份样式在模块图里出现两次，改成单一归属，避免以后 CSS 被静默写两份。

// 把 Vue 2 专属 NodeView 注册进 core 的注册表：本模块一加载就可用，等价于过去的静态
// 注入；extensions.js 装配 schema 时按节点名查表，不再静态依赖任何 UI 框架。
registerVue2NodeViews()

export default {
  name: 'LarkDocEditor',
  components: { EditorContent, CommandMenu, LarkDocHeadingMenu, LarkDocIcon, TopBar, ToolbarBar, SearchPanel, TableTools },
  mixins: [viewModesMixin, commandMenuMixin, tableToolsMixin, blockHandleMixin, blockMenuMixin, bubbleMenuMixin, calloutColorMixin, toolbarMenusMixin, toolbarCollapseMixin, headingNumberMixin],
  props: {
    value: { type: String, default: '<p></p>' }, title: { type: String, default: '' }, readonly: { type: Boolean, default: false },
    config: { type: Object, default: () => ({}) }, maxLength: { type: Number, default: null }, imageMaxSize: { type: Number, default: null },
    templates: { type: Array, default: () => [] },
    uploadImage: { type: Function, default: null }, msgId: { type: [Number, String], default: null },
    session: { type: Object, default: null },
    // 'auto' 按指纹识别 Vditor HTML；'vditor' 强制归一化；'html' 明确跳过归一化。
    contentFormat: { type: String, default: 'auto' },
    // 折叠偏好持久化键（通常传 documentId）：非空时章节折叠状态按标题稳定键
    // 存入本设备 localStorage，刷新后恢复（需求文档 13.6.1 V1 本地偏好）。
    foldPersistKey: { type: String, default: '' },
  },
  data() { return {
    editor: null, localTitle: this.title,
    alignNames: { left: '左', center: '居中', right: '右', justify: '两端' }, alignGlyphs: { left: '≡', center: '☷', right: '≣', justify: '▤' },
    helpOpen: false, savedSelection: null,
    error: '', pendingHTML: null, htmlSeeded: false,
    pendingStateFrame: null, pendingChangeTimer: null,
  } },
  computed: {
    // 拆分出的子组件（editor/*.vue）经实例 prop 引用本组件：模板里写 :ed="self"。
    self() { return this },
    // ECS 的 ref.html 与新页面 v-model 使用同一正文，保留原调用方的读写契约。
    larkDocConfig() { return mergeLegacyConfig(this.config, { maxLength: this.maxLength, imageMaxSize: this.imageMaxSize }) },
    maxBlockIndent() { return clampBlockIndent(this.larkDocConfig.limits.maxIndent) },
    effectiveMaxLength() { return Math.max(0, Number(this.larkDocConfig.limits.maxLength) || 0) },
    effectiveImageMaxSize() { return this.larkDocConfig.limits.maxImageSize },
    titleLength() { return this.larkDocConfig.limits.titleLength },
    visibleBlockActions() { return this.blockActions.filter((item) => isBlockActionEnabled(this.larkDocConfig, item.id)) },
    visibleBlockTypeActions() {
      return this.blockTypeActions.filter((item) => {
        const feature = item.id === 'codeBlock' ? 'codeBlocks' : 'blockStyle'
        return isConfigEnabled(this.larkDocConfig, feature) && isBlockActionEnabled(this.larkDocConfig, item.id)
      })
    },
    visibleBlockListActions() {
      const list = this.visibleBlockActions.filter((item) => item.id !== 'duplicate')
      // 表格分支没有类型网格与独立副本按钮，创建副本回到操作列表里，不丢功能。
      if (this.handleIsTable && isBlockActionEnabled(this.larkDocConfig, 'duplicate')) {
        const dup = this.blockActions.find((item) => item.id === 'duplicate')
        if (dup) return [dup, ...list]
      }
      return list
    },
    html: {
      get() { return this.editor?.getHTML() || this.pendingHTML || this.value || '<p></p>' },
      set(value) { this.htmlSeeded = true; if (this.editor) this.setContent(value); else this.pendingHTML = value },
    },
    effectiveReadonly() { return this.readonly || this.reading || this.slides || (this.session && typeof this.session.can === 'function' && !this.session.can('canEdit')) },
    hasTextSelection() { return !!this.editor && !this.editor.state.selection.empty },
  },
  watch: {
    title(value) { if (value !== this.localTitle) this.localTitle = value },
    value(value) { if (this.editor && value !== this.editor.getHTML()) { try { this.setContent(value) } catch (error) { this.error = error.message } } },
    maxLength() { if (this.editor) { this.editor.storage.characterCount.setLimit(this.effectiveMaxLength); this.refreshDocumentState() } },
    config: { deep: true, handler() {
      if (this.editor) this.editor.storage.characterCount.setLimit(this.effectiveMaxLength)
      this.$nextTick(() => this.refreshDocumentState())
    } },
    effectiveReadonly(value) { if (this.editor) { this.editor.setEditable(!value); this.editor.emit('editableUpdate', { editable: !value }); this.closeCommandMenu(); this.headingOpen = false; this.headingStyle = {}; this.closeBlockMenu(); this.clearHandleHighlight(); this.colorPaletteOpen = ''; this.bubbleVisible = false; this.closeBubbleAlignMenu(); if (value) this.tableBoundary.visible = false; else this.$nextTick(() => this.updateTableBoundary()); this.$emit('mode-change', { readonly: value }) } },
    tablePicker(value) { if (value) { this.tablePickerHover = { rows: 3, cols: 3 }; this.$nextTick(() => this.$refs.root?.querySelector('.lark-doc-table-grid button')?.focus()) } },
    emojiDialog(value) { if (value) this.$nextTick(() => this.$refs.root?.querySelector('.lark-doc-emoji-grid button')?.focus()) },
    helpOpen(value) { if (value) this.$nextTick(() => this.$refs.root?.querySelector('[aria-label="关闭快捷键帮助"]')?.focus()) },
    linkDialog(value) { if (value) this.$nextTick(() => (this.linkInsertMode ? this.$refs.linkTextInput : this.$refs.linkInput)?.focus()) },
  },
  mounted() {
    try {
      let initialHTML = this.pendingHTML === null ? this.value || '<p></p>' : this.pendingHTML
      const hasInitialValue = Object.prototype.hasOwnProperty.call(this.$options.propsData || {}, 'value')
      if (!hasInitialValue && !this.htmlSeeded && (!initialHTML.trim() || initialHTML === '<p></p>') && this.msgId !== null) {
        // 未提供初始正文才只读兼容旧缓存；显式空 value 也是宿主的正文选择。
        try { const cached = localStorage.getItem(String(this.msgId)); if (cached) initialHTML = cached } catch (_) { this.error = '浏览器阻止读取公告缓存' }
      }
      this.editor = new Editor({
        content: this.prepareHTML(initialHTML), editable: !this.effectiveReadonly,
        extensions: createLarkDocExtensions({ maxLength: this.effectiveMaxLength, config: this.larkDocConfig, resolveImageFile: this.resolveImageFile, onSlash: this.onSlash, onHeadingNumberMenu: (payload) => this.openHeadingNumberMenu(payload), onListNumberMenu: (payload) => this.openListNumberMenu(payload), onImageFiles: this.insertImageFiles, onBackspace: () => this.deletePreviousBlockOnBackspace(), onError: (message) => { this.error = message } }),
        onUpdate: ({ transaction }) => this.onUpdate(transaction), onTransaction: () => { this.syncFoldState(); this.persistFolds(); this.$nextTick(() => this.syncHandleHighlightBackdrop()) }, onSelectionUpdate: () => this.onSelectionUpdate(),
      })
      this.session?.attachEditor(this.editor)
      this._sessionCapabilitiesOff = this.session?.on?.('capabilities', () => this.$forceUpdate()) || null
      // 首次挂载先补齐块的稳定 id：折叠偏好、锚点都按 id 引用块；没 id 就恢复不出折叠位。
      if (this.editor.commands && typeof this.editor.commands.ensureLarkDocBlockIds === 'function') this.editor.commands.ensureLarkDocBlockIds()
      // 老数据或外部 JSON 的缩进可能超过飞书上限（5 级），挂载/替换正文后一次性压回。
      if (this.editor.commands && typeof this.editor.commands.normalizeLarkDocIndents === 'function') this.editor.commands.normalizeLarkDocIndents()
      this.refreshDocumentState()
      this.restoreFolds()
      this.$nextTick(() => this.updateTableBoundary())
      this.$emit('mode-change', { readonly: this.effectiveReadonly })
      this.$nextTick(() => this.$emit('ready', this.editor))
      document.addEventListener('fullscreenchange', this.onFullscreenChange)
      window.addEventListener('keydown', this.onWindowKeydown)
      window.addEventListener('scroll', this.onDocumentScroll, true)
      window.addEventListener('resize', this.onDocumentScroll)
      window.addEventListener('pointerup', this.onHandlePointerUp)
      document.addEventListener('pointerdown', this.onDocumentPointerDown, true)
      window.addEventListener('pointermove', this.onDocumentPointerMove, true)
    } catch (error) { this.error = error.message }
  },
  beforeDestroy() { document.removeEventListener('fullscreenchange', this.onFullscreenChange); window.removeEventListener('keydown', this.onWindowKeydown); window.removeEventListener('scroll', this.onDocumentScroll, true); window.removeEventListener('resize', this.onDocumentScroll); window.removeEventListener('pointerup', this.onHandlePointerUp); window.removeEventListener('pointermove', this.onColumnPointerMove); window.removeEventListener('pointerup', this.onColumnPointerUp); document.removeEventListener('pointerdown', this.onDocumentPointerDown, true); window.removeEventListener('pointermove', this.onDocumentPointerMove, true); this._sessionCapabilitiesOff?.(); clearTimeout(this.handleHideTimer); clearTimeout(this.blockMenuCloseTimer); clearTimeout(this.pendingChangeTimer); if (this.pendingStateFrame) cancelAnimationFrame(this.pendingStateFrame); this.clearHandleHighlight(); this.closeBubbleAlignMenu(); if (this._outlineFrame) cancelAnimationFrame(this._outlineFrame); this.closeCommandMenu(); this.dragging = null },
  destroyed() {
    if (this.session && this.editor) this.session.detachEditor(this.editor)
    this.editor?.destroy()
    this.editor = null
  },
  methods: {
    featureEnabled(name) { return isConfigEnabled(this.larkDocConfig, name) },
    toolbarEnabled(name) { return this.larkDocConfig.toolbar[name] !== false && this.featureEnabled(name) },
    isBlockActionEnabled(id) { return isBlockActionEnabled(this.larkDocConfig, id) },
    getEditor() { return this.editor }, getHTML() { return this.editor?.getHTML() || '' }, getJSON() { return this.editor?.getJSON() || null }, getText() { return this.editor?.getText() || '' },
    focus() { this.editor?.commands.focus() },
    /**
     * 统一内容准备：旧数据（Vditor HTML）归一化 + 安全清洗。
     * 初始内容与 setContent 都走这里，避免两条路径行为不一致。
     */
    prepareHTML(content, format) {
      let mode = format || this.contentFormat || 'auto'
      if (mode === 'wangeditor') {
        // 0.4.0 起不再支持 wangEditor，老宿主传旧枚举时降级为自动识别，避免直接抛错。
        if (!this._legacyFormatWarned) {
          this._legacyFormatWarned = true
          console.warn("[lark-doc] contentFormat 'wangeditor' 已不支持，按 'auto' 处理")
        }
        mode = 'auto'
      }
      const legacy = normalizeVditorHtml(content, { force: mode === 'vditor', skip: mode === 'html' })
      if (legacy.converted) {
        this.lastImportReport = legacy.report
        this.$emit('import-report', legacy.report)
      }
      return sanitizeHTML(legacy.html)
    },
    setContent(content, options = {}) {
      if (!this.editor) return false
      const schema = this.editor.schema
      let json
      if (typeof content === 'string') {
        const safe = this.prepareHTML(content, options.format)
        const container = document.createElement('div'); container.innerHTML = safe
        json = ProseMirrorDOMParser.fromSchema(schema).parse(container).toJSON()
      } else json = validateDocument(content, schema)
      // 离线策略在这里统一生效：外链图片降级为占位，避免渲染时发起外部请求。
      // 旧宿主会绕过 Vue 计算属性直接调用本方法，此时没有归一化配置，按默认策略处理。
      json = createNetworkPolicy(this.larkDocConfig ? this.larkDocConfig.network : null).applyDocument(json)
      const next = schema.nodeFromJSON(validateDocument(json, schema))
      // Keep this method usable by the legacy imperative API and small host-side
      // harnesses that call it without Vue's computed properties.
      const maxLength = this.effectiveMaxLength !== undefined
        ? this.effectiveMaxLength
        : Math.max(0, Number(this.maxLength) || 0)
      if (maxLength > 0 && this.editor.storage.characterCount.characters({ node: next }) > maxLength) throw new Error(`正文不能超过 ${maxLength} 字`)
      if (next.eq(this.editor.state.doc)) return false
      // Content replacement invalidates the transient handle/menu target.
      if (typeof this.closeBlockMenu === 'function') this.closeBlockMenu()
      this.handleRange = null
      // 内容替换期间先关闭折叠写回：reset → 恢复之间不能把偏好写成空数组。
      this._foldsReady = false
      // 使用普通事务替换正文，让本地历史可撤销模板、导入与快照恢复。
      const tr = this.editor.state.tr.replaceWith(0, this.editor.state.doc.content.size, next.content)
      this.editor.view.dispatch(setTransactionMetadata(tr, { origin: TRANSACTION_ORIGINS.HOST }))
      if (this.editor.commands && typeof this.editor.commands.resetLarkDocFolds === 'function') this.editor.commands.resetLarkDocFolds()
      // 老文档（或外部 JSON）可能没有 blockId：先补号再按 id 恢复折叠偏好。
      if (this.editor.commands && typeof this.editor.commands.ensureLarkDocBlockIds === 'function') this.editor.commands.ensureLarkDocBlockIds()
      // 老数据或外部 JSON 的缩进可能超过飞书上限（5 级），挂载/替换正文后一次性压回。
      if (this.editor.commands && typeof this.editor.commands.normalizeLarkDocIndents === 'function') this.editor.commands.normalizeLarkDocIndents()
      // 内容替换后按持久化键恢复折叠偏好（加载草稿 / 恢复快照共用此路径）。
      if (typeof this.restoreFolds === 'function') this.restoreFolds()
      this.savedSelection = null
      this.editor.view.dispatch(closeHistory(this.editor.state.tr))
      return true
    },
    updateTitle(value) { if (this.effectiveReadonly) return; this.localTitle = value; this.$emit('update:title', value) },
    // —— 章节折叠偏好持久化：按 (foldPersistKey, 标题 blockId) 存本设备 localStorage ——
    // 存的是块的稳定 id，不是位置也不是「文本+序号」：同名标题、删除靠前标题、
    // 重命名、移动块都不会让折叠状态串到别的标题上。
    foldStorageKey() { return this.foldPersistKey ? `lark-doc:folds:${this.foldPersistKey}` : '' },
    persistFolds() {
      const key = this.foldStorageKey()
      // _foldsReady 之前不写回：编辑器初始化/内容替换会先清空折叠位，
      // 若此时写盘会把已保存的偏好覆盖成空数组，刷新后就永远恢复不出来。
      if (!key || !this.editor || !this._foldsReady) return
      // 宿主异步灌入正文时，编辑器会先处于「空文档」状态：此时没有任何可折叠块，
      // 写盘只会把上一次会话的偏好覆盖成空数组（刷新恢复失效的直接原因）。
      // 判定条件用「可折叠块」而不是「有标题」：段落/列表项挂了缩进子块也能折叠，
      // 没有标题的文档同样需要恢复折叠位。
      if (foldableIdPositions(this.editor.state.doc).size === 0) return
      const next = JSON.stringify(Array.from(this.editor.storage.larkDoc?.folded || []))
      if (next === this._persistedFolds) return
      this._persistedFolds = next
      try { window.localStorage.setItem(key, next) } catch (_) { /* 隐私模式等存储不可用时静默降级为会话内状态 */ }
    },
    restoreFolds() {
      const key = this.foldStorageKey()
      if (!key || !this.editor) { this._foldsReady = true; return }
      let saved = []
      try { saved = JSON.parse(window.localStorage.getItem(key) || '[]') } catch (_) { saved = [] }
      const values = Array.isArray(saved) ? saved.filter((value) => typeof value === 'string' && value) : []
      // 旧版本存的是 `层级\u0001文本\u0001同名序号` 派生键，新版本存 blockId。
      // 两批一起应用；成功恢复后 persistFolds 会把它们统一写成 id 完成迁移。
      const legacyKeys = values.filter((value) => value.includes('\u0001'))
      const blockIds = values.filter((value) => !value.includes('\u0001'))
      if (blockIds.length && typeof this.editor.commands.foldLarkDocByIds === 'function') this.editor.commands.foldLarkDocByIds(blockIds)
      if (legacyKeys.length && typeof this.editor.commands.foldLarkDocByKeys === 'function') this.editor.commands.foldLarkDocByKeys(legacyKeys)
      const applied = this.editor.storage.larkDoc?.folded?.size || 0
      this._foldsReady = true
      // 有偏好却一条都没命中，说明当前正文还不是最终内容（宿主挂载后会再灌一次
      // setContent）。此时绝不能写盘：写成空数组会让后面那次恢复也读不到偏好。
      if (values.length && !applied) return
      this.persistFolds()
    },
    onUpdate(transaction) {
      this.scheduleDocumentState()
      // 补 blockId 的事务只改属性、不改正文：不能当成一次内容修改冒泡给宿主，
      // 否则打开文档就会立刻被标记成「有未保存的改动」。
      if (transaction && transaction.getMeta && (transaction.getMeta('larkDocBlockIds') || transaction.getMeta('larkDocIndentNormalized'))) return
      const publish = () => {
        if (!this.editor || this._isBeingDestroyed || this._isDestroyed) return
        const html = this.getHTML()
        this.$emit('input', html)
        this.$emit('change', { html, json: this.getJSON(), text: this.getText() })
      }
      clearTimeout(this.pendingChangeTimer)
      const delay = this.larkDocConfig.performance.changeDebounce
      this.pendingChangeTimer = delay > 0 ? setTimeout(publish, delay) : null
      if (!delay) publish()
    },
    scheduleDocumentState() {
      if (!this.editor) return
      if (!this.larkDocConfig.performance.stateUpdateFrame) {
        this.refreshDocumentState()
        this.$nextTick(() => this.updateHandleAndTable())
        return
      }
      if (this.pendingStateFrame) return
      this.pendingStateFrame = requestAnimationFrame(() => {
        this.pendingStateFrame = null
        if (!this.editor || this._isBeingDestroyed || this._isDestroyed) return
        this.refreshDocumentState()
        this.$nextTick(() => this.updateHandleAndTable())
      })
    },
    updateHandleAndTable() {
      if (!this.editor) return
      this.updateTableBoundary()
      if (!this.handleRange) return
      const { from, to } = this.handleRange
      const doc = this.editor.state.doc
      if (from < 0 || from >= to || to > doc.content.size) { this.closeBlockMenu(); this.handleRange = null; return }
      const start = doc.resolve(from)
      const end = doc.resolve(to)
      if (!start.sameParent(end) || start.textOffset || end.textOffset || from !== start.posAtIndex(start.index(), start.depth) || to !== end.posAtIndex(end.index(), end.depth)) {
        this.closeBlockMenu()
        this.handleRange = null
      } else this.positionBlockHandle(this.handleRange)
    },
    refreshDocumentState() {
      if (!this.editor) return
      this.outline = collectOutline(this.editor.state.doc)
      this.syncOutlineCollapseState()
      this.syncFoldState()
      this.wordCount = this.editor.storage.characterCount.characters()
      if (this.effectiveMaxLength > 0 && this.wordCount > this.effectiveMaxLength) this.error = `正文不能超过 ${this.effectiveMaxLength} 字，请缩短正文`
      else if (this.error.startsWith('正文不能超过 ')) this.error = ''
      if (this.searchQuery) this.updateSearch()
    },
    syncFoldState() {
      if (!this.editor) return
      const current = this.editor.storage.larkDoc?.folded || new Set()
      const next = new Set(current)
      if (next.size === this.folded.size && [...next].every((pos) => this.folded.has(pos))) return
      this.folded = next
    },
    syncOutlineCollapseState() {
      const positions = new Set(this.outline.map((item) => item.pos))
      const next = new Set([...this.outlineCollapsed].filter((pos) => positions.has(pos)))
      if (next.size === this.outlineCollapsed.size && [...next].every((pos) => this.outlineCollapsed.has(pos))) return
      this.outlineCollapsed = next
    },
    onSelectionUpdate() {
      if (!this.editor) return
      const { selection } = this.editor.state
      if (this.editor.isFocused) this.savedSelection = { from: selection.from, to: selection.to }
      this.activeHeading = [...this.outline].reverse().find((item) => item.pos <= selection.from)?.pos ?? -1
      const coords = this.editor.view.coordsAtPos(selection.from)
      if (!this.handlePressed && !this.blockMenuOpen && !this.blockTypeMenuOpen) this.positionBlockHandle(this.currentBlockRange())
      if (this.editor.isActive('table') && this.writable()) this.tableToolsOpen = true
      this.clearTableBoundaryHover()
      this.updateTableBoundary()
      this.$nextTick(() => this.updateTableBoundary())
      this.updateCalloutTools()
      this.bubbleVisible = !selection.empty && !selection.node && !this.effectiveReadonly && this.editor.isFocused
      if (this.bubbleVisible) {
        // 顶部避让：选区贴近视口顶部时，气泡条不能钻进吸顶工具栏（飞书同样会把浮条翻到选区下方）。
        const safeTop = this.bubbleSafeTop()
        const endCoords = this.editor.view.coordsAtPos(selection.to)
        const naturalTop = coords.top - 50
        const top = naturalTop >= safeTop ? naturalTop : endCoords.bottom + 10
        this.bubblePosition = {
          left: Math.max(8, Math.min(window.innerWidth - 270, coords.left)),
          top: Math.max(safeTop, Math.min(top, window.innerHeight - 60)),
        }
      }
      else { this.closeBubbleAlignMenu(); this.closeBubbleHeadingMenu() }
    },
    onDocumentScroll() {
      if (this._outlineFrame || !this.editor) return
      this._outlineFrame = requestAnimationFrame(() => {
        this._outlineFrame = null
        if (!this.blockMenuOpen && !this.blockTypeMenuOpen && !this.handlePressed) this.positionBlockHandle(this.handleRange || this.currentBlockRange())
        this.syncHandleHighlightBackdrop()
        if (this.blockAlignMenuOpen) this.positionBlockAlignMenu()
        if (this.blockColorMenuOpen) this.positionBlockColorMenu()
        if (this.bubbleAlignOpen) this.positionBubbleAlignMenu()
        this.updateTableBoundary()
        if (this.headingOpen) this.positionHeadingMenu()
        if (this.menuOpen) this.positionCommandMenu()
        this.updateCalloutTools()
        let visible = -1
        for (const item of this.outline) {
          const dom = this.editor.view.nodeDOM(item.pos)
          if (dom instanceof Element && dom.getBoundingClientRect().top <= 170) visible = item.pos
          else if (visible !== -1) break
        }
        if (visible !== -1) this.activeHeading = visible
      })
    },
    rememberSelection(includeCursor = false) { if (!this.editor) return; const { from, to } = this.editor.state.selection; if (from !== to || includeCursor) this.savedSelection = { from, to } },
    restoreSelection(includeCursor = false) { if (!this.editor || !this.savedSelection || !(this.editor.state.selection instanceof TextSelection)) return; const { from, to } = this.savedSelection; const size = this.editor.state.doc.content.size; if ((from !== to || includeCursor) && from <= size && to <= size) this.editor.view.dispatch(this.editor.state.tr.setSelection(TextSelection.create(this.editor.state.doc, from, to))) },
    writable() { return !this._isBeingDestroyed && !this._isDestroyed && this.editor?.isEditable && !this.editor.isDestroyed && !this.effectiveReadonly },
    run(command, ...args) { if (!this.writable()) return false; this.restoreSelection(); const chain = this.editor.chain().focus(); const method = chain[command]; return typeof method === 'function' ? method(...args).run() : false },
    isActive(name) { return !!this.editor?.isActive(name) },
    toggleMark(name) { if (!this.featureEnabled('marks')) return; const command = `toggle${name[0].toUpperCase()}${name.slice(1)}`; this.run(command); this.bubbleVisible = false; this.closeBubbleAlignMenu() },
    setTextStyle(attribute, value) { if (!value) return; const command = `set${attribute[0].toUpperCase()}${attribute.slice(1)}`; this.run(command, value) },
    // 自绘下拉（LarkDocSelect）的回调：应用样式并记住最近值，供触发按钮回显。
    applyTextStyle(key, value) { this.setTextStyle(key, value); this.appliedTextStyle[key] = value },
    applyTextColor(value) { this.setTextStyle('color', value); this.appliedTextStyle.textColor = value },
    applyTextBackground(value) { this.setTextStyle('backgroundColor', value); this.appliedTextStyle.backgroundColor = value },
    applyLineHeight(value) { this.setBlockAttribute('lineHeight', value); this.appliedTextStyle.lineHeight = value },
    applyCellAlign(key, value) { this.cellAttribute(key, value); this.cellAlignState[key] = value },
    openLinkDialog(allowEmpty = false) {
      if (!this.writable() || (!allowEmpty && this.editor.state.selection.empty)) return
      this.rememberSelection(allowEmpty)
      this.linkInsertMode = this.editor.state.selection.empty
      this.linkText = ''
      this.linkValue = this.editor.getAttributes('link').href || ''
      this.linkDialog = true
    },
    applyLink() {
      if (!this.writable() || !this.linkValue || !safeUrl(this.linkValue)) { this.error = '链接地址无效，仅支持 http、https、mailto、tel 或 # 锚点'; return }
      const attrs = { href: this.linkValue, target: '_blank', rel: 'noopener noreferrer' }
      if (this.linkInsertMode) {
        if (!this.linkText.trim()) { this.error = '请输入链接显示文字'; return }
        this.restoreSelection(true)
        this.editor.chain().focus().insertContent({ type: 'text', text: this.linkText.trim(), marks: [{ type: 'link', attrs }] }).run()
      } else this.run('setLink', attrs)
      this.linkDialog = false
      this.linkInsertMode = false
      this.linkText = ''
    },
    removeLink() { if (this.writable() && !this.linkInsertMode) { this.run('unsetLink'); this.linkDialog = false } },
    setBlockAttribute(name, value, type) {
      if (!this.writable() || value === null || value === undefined || value === '') return
      this.restoreSelection()
      const block = type || (this.editor.isActive('heading') ? 'heading' : 'paragraph')
      // 缩进只有一个上限：所有入口（工具栏/气泡/块菜单/快捷键）都走 clampBlockIndent。
      const next = name === 'indent' ? clampBlockIndent(value, this.maxBlockIndent) : value
      this.editor.chain().focus().updateAttributes(block, { [name]: next }).run()
    },
    // 当前块的缩进载体（段落/标题/代码块都带 indent 属性），菜单与工具栏据此判断上限。
    blockIndentLevel() { return Number(this.blockIndentNode()?.attrs?.indent) || 0 },
    blockIndentNode() {
      if (!this.editor) return null
      const { $from } = this.editor.state.selection
      for (let depth = $from.depth; depth > 0; depth -= 1) {
        const node = $from.node(depth)
        if (Number.isInteger(node.attrs?.indent)) return node
      }
      return null
    },
    blockIndentPos() {
      if (!this.editor) return -1
      const { $from } = this.editor.state.selection
      for (let depth = $from.depth; depth > 0; depth -= 1) {
        if (Number.isInteger($from.node(depth).attrs?.indent)) return $from.before(depth)
      }
      return -1
    },
    // 增加缩进的上限由「前一个块」决定：飞书的缩进就是成为上一个块的子块，
    // 所以第一个块一级都缩不了（真飞书菜单里也是灰的）。
    blockIndentLimit() {
      if (!this.editor) return 0
      return maxIndentAt(this.editor.state.doc, this.blockIndentPos(), this.maxBlockIndent)
    },
    canIncreaseIndent() { return this.blockIndentLevel() < this.blockIndentLimit() },
    setAlign(value) { this.run('setTextAlign', value) },
    changeIndent(delta) {
      if (!this.writable()) return
      const node = this.blockIndentNode()
      if (!node) return
      const current = Number(node.attrs.indent) || 0
      // 增加受「前一个块」限制，减少只受 0 下限（可以一路减回文档开头）。
      const next = stepBlockIndent(this.editor.state.doc, this.blockIndentPos(), current, delta, this.maxBlockIndent)
      // 到顶/到底时不再派发事务，避免产生「看起来能一直点」的空操作。
      if (next === current) return
      this.setBlockAttribute('indent', next, node.type.name)
    },
    clearFormatting() { if (!this.writable()) return; this.restoreSelection(); this.editor.chain().focus().unsetAllMarks().clearNodes().run() },
    cellAttribute(name, value) { if (value) this.run('setCellAttribute', name, value) },
    onImageInput(event) { const files = Array.from(event.target.files || []); event.target.value = ''; this.insertImageFiles(files) },
    async resolveImageFile(file) {
      // Keep the imperative upload boundary compatible with older ECS hosts
      // that call the method with a small plain object instead of a Vue vm.
      const imagesEnabled = typeof this.featureEnabled === 'function' ? this.featureEnabled('images') : true
      const maxImageSize = this.effectiveImageMaxSize !== undefined
        ? this.effectiveImageMaxSize
        : Math.max(1, Number(this.imageMaxSize) || 5 * 1024 * 1024)
      if (!this.writable() || !imagesEnabled) return null
      if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) throw new Error('只支持 PNG/JPEG/GIF/WebP 图片')
      if (file.size > maxImageSize) throw new Error(`单张图片不能超过 ${maxImageSize / 1024 / 1024} MB`)
      if (this.uploadImage) {
        const uploaded = await this.uploadImage(file)
        if (!this.writable()) return null
        const attchId = typeof uploaded?.attchId === 'string' || Number.isFinite(uploaded?.attchId) ? String(uploaded.attchId) : null
        if (!safeUrl(uploaded?.url, true) || !safeAttachmentId(attchId)) throw new Error('图片上传未返回有效地址或附件 ID')
        return { src: uploaded.url, attchId }
      }
      const src = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result)
        reader.onerror = () => reject(new Error('本地图片读取失败'))
        reader.readAsDataURL(file)
      })
      if (!this.writable()) return null
      if (!safeUrl(src, true)) throw new Error('本地图片格式无效')
      return { src, attchId: null }
    },
    async insertImageFiles(files, pos) {
      if (!this.writable() || !this.featureEnabled('images')) return
      for (const file of files) {
        try {
          const image = await this.resolveImageFile(file)
          if (!image || !this.writable()) return
          if (Number.isInteger(pos)) this.editor.commands.setTextSelection(Math.max(0, Math.min(pos, this.editor.state.doc.content.size)))
          this.editor.chain().focus().setImage({ ...image, originalSrc: image.src, originalAttchId: image.attchId, alt: file.name }).run()
          this.error = ''
          if (Number.isInteger(pos)) pos = this.editor.state.selection.to
        } catch (error) { if (this.writable()) this.error = error.message || '图片上传失败' }
      }
    },
    onDocumentPointerMove(event) {
      const root = this.$refs.root
      if (!root || root.contains(event.target)) return
      if (!event.target.closest?.('.lark-doc-block-handle, .lark-doc-callout-tools')) this.scheduleHandleHide()
    },
    onDocumentPointerDown(event) {
      const target = event.target
      if (this.menuOpen && !target.closest?.('.lark-doc-command-menu') && target !== this.menuTrigger && !this.menuTrigger?.contains(target)) this.closeCommandMenu()
      if (this.blockMenuOpen && !target.closest?.('.lark-doc-block-menu') && !target.closest?.('.lark-doc-block-handle')) this.closeBlockMenu()
      if (this.blockTypeMenuOpen && !target.closest?.('.lark-doc-block-type-menu') && !target.closest?.('.lark-doc-block-handle')) this.blockTypeMenuOpen = false
      if (this.blockAlignMenuOpen && !target.closest?.('.lark-doc-block-menu') && !target.closest?.('.lark-doc-block-handle')) this.closeBlockMenu()
      if (this.blockColorMenuOpen && !target.closest?.('.lark-doc-block-menu') && !target.closest?.('.lark-doc-block-handle')) this.closeBlockMenu()
      if (this.bubbleAlignOpen && !target.closest?.('.lark-doc-bubble-align') && !target.closest?.('.lark-doc-bubble-align-menu')) this.closeBubbleAlignMenu()
      if (this.bubbleHeadingOpen && !target.closest?.('.lark-doc-bubble-heading')) this.closeBubbleHeadingMenu()
      if (this.calloutEmojiOpen && !target.closest?.('.lark-doc-callout-tools')) this.calloutEmojiOpen = false
      if (this.colorPaletteOpen && !target.closest?.('.lark-doc-color-palette') && !target.closest?.('.lark-doc-color')) this.colorPaletteOpen = ''
      if (this.headerMenuOpen && !target.closest?.('.lark-doc-header-menu') && !target.closest?.('button[aria-label="文档操作"]')) this.closeHeaderMenu()
      if (this.diagramMenuOpen && !target.closest?.('.lark-doc-diagram-menu') && !target.closest?.('button[aria-label="图表"]')) this.closeDiagramMenu()
      // 编号菜单点外部关闭；但点在编号按钮自己身上要留给它的 click 处理（重新定位/切换）。
      // 标题编号和列表序号共用这套菜单，两个锚点都要排除。
      // 正在输入编号值时，点外部按「提交」算（飞书同款），否则用户输完点开别处会丢值。
      if (this.headingNumberMenu.open && !target.closest?.('.lark-doc-heading-number-menu') && !target.closest?.('.lark-doc-heading-number') && !target.closest?.('.lark-doc-list-number')) {
        if (this.headingNumberEditing) this.applyHeadingNumberValue()
        else this.closeHeadingNumberMenu()
      }
      if (!this.$refs.root?.contains(target)) {
        this.headingOpen = false
        this.headingStyle = {}
        this.tableToolsOpen = false
      }
    },
    onWindowKeydown(event) {
      if (event.key === 'Escape' && this.headingNumberMenu.open) this.closeHeadingNumberMenu({ restoreFocus: true })
      else if (event.key === 'Escape' && this.slides) this.toggleSlides()
      else if (event.key === 'Escape' && (this.blockMenuOpen || this.blockTypeMenuOpen || this.blockAlignMenuOpen || this.blockColorMenuOpen)) this.closeBlockMenu()
      else if (this.slides && event.key === 'ArrowRight') this.slideIndex = Math.min(this.slideChapters.length - 1, this.slideIndex + 1)
      else if (this.slides && event.key === 'ArrowLeft') this.slideIndex = Math.max(0, this.slideIndex - 1)
    },
    closeOverlay() { if (this.menuOpen) this.closeCommandMenu(); else if (this.colorPaletteOpen) this.colorPaletteOpen = ''; else if (this.mathDialog) this.mathDialog = ''; else if (this.emojiDialog) this.emojiDialog = false; else if (this.linkDialog) this.linkDialog = false; else if (this.tablePicker) { this.tablePicker = false; this.tablePickerHover = { rows: 3, cols: 3 } } else if (this.helpOpen) this.helpOpen = false; else if (this.headingOpen) { this.headingOpen = false; this.headingStyle = {} } else if (this.headerMenuOpen) this.closeHeaderMenu(); else if (this.diagramMenuOpen) this.closeDiagramMenu(); else if (this.bubbleAlignOpen) this.closeBubbleAlignMenu(); else if (this.blockAlignMenuOpen || this.blockColorMenuOpen || this.blockTypeMenuOpen || this.blockMenuOpen) this.closeBlockMenu(); else if (this.calloutEmojiOpen) this.calloutEmojiOpen = false; else if (this.tableToolsOpen) this.tableToolsOpen = false; else if (this.searchOpen) this.closeSearch(); this.focus() },
  },
}
</script>
