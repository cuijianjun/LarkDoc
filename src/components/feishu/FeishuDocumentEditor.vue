<template>
  <section
    ref="root"
    class="feishu-document"
    :class="[`feishu-width-${widthMode}`, { 'feishu-reading': effectiveReadonly, 'feishu-slides': slides, 'feishu-fullscreen': fullscreen, 'feishu-titlebar-fixed': feishuConfig.layout.titleBarFixed, 'feishu-toolbar-fixed': feishuConfig.layout.toolbarFixed }]"
    @keydown.esc="closeOverlay"
  >
    <a
      class="feishu-skip"
      href="#feishu-editor"
    >跳到正文</a>
    <!-- 顶部标题栏：layout.headerVisible=false 时整行隐藏，操作入口移入工具栏「⋯」下拉 -->
    <header
      v-if="feishuConfig.layout.headerVisible"
      class="feishu-topbar"
    >
      <div
        class="feishu-brand"
        aria-label="文档"
      >
        ✦ <span>文档</span>
      </div>
      <div class="feishu-title-wrap">
        <input
          :value="localTitle"
          aria-label="文档标题"
          :maxlength="titleLength"
          placeholder="未命名文档"
          :readonly="effectiveReadonly"
          @input="updateTitle($event.target.value)"
        ><span class="feishu-title-sub">{{ effectiveReadonly ? '阅读中' : '单人编辑' }}</span>
      </div>
      <div class="feishu-header-actions">
        <slot name="header-actions" />
      </div>
    </header>

    <div
      class="feishu-toolbar"
      role="toolbar"
      aria-label="文档工具栏"
      @mousedown="rememberSelection"
    >
      <div
        v-if="toolbarEnabled('history')"
        v-show="!isGroupCollapsed('history')"
        class="feishu-tools"
      >
        <button
          type="button"
          aria-label="撤销"
          title="撤销"
          :disabled="effectiveReadonly"
          @click="run('undo')"
        >
          <feishu-icon name="undo" />
        </button><button
          type="button"
          aria-label="重做"
          title="重做"
          :disabled="effectiveReadonly"
          @click="run('redo')"
        >
          <feishu-icon name="redo" />
        </button>
      </div>
      <div
        v-if="toolbarEnabled('headings')"
        v-show="!isGroupCollapsed('headings')"
        class="feishu-tools feishu-heading-tool"
      >
        <button
          type="button"
          aria-label="标题级别"
          title="标题级别"
          :disabled="effectiveReadonly"
          :aria-expanded="headingOpen ? 'true' : 'false'"
          @mouseenter="openHeadingMenuOnHover"
          @mouseleave="scheduleHeadingMenuClose"
          @click="toggleHeadingMenu"
        >
          {{ currentBlockLabel }}<feishu-icon
            class="feishu-caret"
            :size="12"
            name="chevronDown"
          />
        </button><div
          v-if="headingOpen"
          class="feishu-dropdown"
          :style="headingStyle"
          role="menu"
          aria-label="标题级别"
          @mouseenter="cancelPopupHoverClose"
          @mouseleave="scheduleHeadingMenuClose"
        >
          <button
            type="button"
            role="menuitem"
            :class="{ 'feishu-menu-active': editor && !editor.isActive('heading') }"
            @mousedown.prevent
            @click="setHeading(0)"
          >
            <span
              class="feishu-heading-glyph"
              aria-hidden="true"
            >T</span>正文
          </button><button
            v-for="level in 9"
            :key="level"
            type="button"
            role="menuitem"
            :class="{ 'feishu-menu-active': editor && editor.isActive('heading') && editor.getAttributes('heading').level === level }"
            @mousedown.prevent
            @click="setHeading(level)"
          >
            <span
              class="feishu-heading-glyph"
              aria-hidden="true"
            >H{{ level }}</span>{{ '一二三四五六七八九'[level - 1] }}级标题
          </button>
        </div>
      </div>
      <div
        v-if="toolbarEnabled('marks')"
        v-show="!isGroupCollapsed('marks')"
        class="feishu-tools"
      >
        <button
          v-for="item in visibleMarks"
          :key="item.id"
          type="button"
          :class="`feishu-mark-${item.id}`"
          :aria-label="item.label"
          :title="item.label"
          :aria-pressed="String(isActive(item.id))"
          :disabled="effectiveReadonly"
          @mousedown.prevent
          @click="toggleMark(item.id)"
        >
          {{ item.glyph }}
        </button>
      </div>
      <div
        v-if="toolbarEnabled('textStyle')"
        v-show="!isGroupCollapsed('textStyle')"
        class="feishu-tools"
      >
        <button
          type="button"
          aria-label="设置链接"
          title="设置链接"
          :aria-pressed="String(isActive('link'))"
          :disabled="effectiveReadonly || !hasTextSelection"
          @mousedown.prevent
          @click="openLinkDialog"
        >
          <feishu-icon name="link" />
        </button>
        <feishu-select
          aria-label="字体"
          :options="fontFamilyOptions"
          :value="appliedTextStyle.fontFamily"
          :disabled="effectiveReadonly"
          @change="applyTextStyle('fontFamily', $event)"
        />
        <feishu-select
          aria-label="字号"
          :options="fontSizeOptions"
          :value="appliedTextStyle.fontSize"
          :disabled="effectiveReadonly"
          @change="applyTextStyle('fontSize', $event)"
        />        <label
          class="feishu-color"
          title="颜色"
          aria-haspopup="menu"
          :aria-expanded="colorPaletteOpen === 'textColor' ? 'true' : 'false'"
          @mouseenter="openColorPaletteOnHover"
          @mouseleave="scheduleColorPaletteClose"
          @click.prevent="toggleColorPalette('textColor', $event)"
        ><span
          class="feishu-color-letter feishu-color-letter-hl"
          aria-hidden="true"
          :style="{ color: appliedTextStyle.textColor, background: `linear-gradient(transparent 52%, ${appliedTextStyle.backgroundColor} 52%)` }"
        >A</span><feishu-icon
          :size="12"
          name="chevronDown"
          class="feishu-caret feishu-color-arrow"
        /><input
          type="color"
          aria-label="文字颜色"
          :disabled="effectiveReadonly"
          :value="appliedTextStyle.textColor"
          @focus="rememberSelection"
          @input="applyTextColor($event.target.value)"
        ><input
          type="color"
          aria-label="背景颜色"
          :disabled="effectiveReadonly"
          :value="appliedTextStyle.backgroundColor"
          @focus="rememberSelection"
          @input="applyTextBackground($event.target.value)"
        ></label>
      </div>
      <div
        v-if="toolbarEnabled('blockStyle')"
        v-show="!isGroupCollapsed('blockStyle')"
        class="feishu-tools"
      >
        <feishu-select
          aria-label="行高"
          :options="lineHeightOptions"
          :value="appliedTextStyle.lineHeight"
          :disabled="effectiveReadonly"
          @change="applyLineHeight($event)"
        /><button
          v-for="align in ['left', 'center', 'right', 'justify']"
          :key="align"
          type="button"
          :aria-label="`对齐${alignNames[align]}`"
          :title="`对齐${alignNames[align]}`"
          :disabled="effectiveReadonly"
          @mousedown.prevent
          @click="setAlign(align)"
        >
          <feishu-icon :name="`align-${align}`" />
        </button><button
          type="button"
          aria-label="减少缩进"
          title="减少缩进"
          :disabled="effectiveReadonly"
          @mousedown.prevent
          @click="changeIndent(-1)"
        >
          <feishu-icon name="indent-dec" />
        </button><button
          type="button"
          aria-label="增加缩进"
          title="增加缩进"
          :disabled="effectiveReadonly"
          @mousedown.prevent
          @click="changeIndent(1)"
        >
          <feishu-icon name="indent-inc" />
        </button><button
          type="button"
          aria-label="清除格式"
          title="清除格式"
          :disabled="effectiveReadonly"
          @mousedown.prevent
          @click="clearFormatting"
        >
          <feishu-icon name="clear" />
        </button>
      </div>
      <div
        v-if="toolbarEnabled('insert') || toolbarEnabled('tables') || toolbarEnabled('ai')"
        v-show="!isGroupCollapsed('insert')"
        class="feishu-tools"
      >
        <button
          v-if="toolbarEnabled('insert')"
          type="button"
          aria-label="插入"
          title="插入内容"
          :disabled="effectiveReadonly"
          @click="openCommandMenu('plus', $event)"
        >
          <feishu-icon name="plus" />插入
        </button><button
          v-if="toolbarEnabled('tables')"
          type="button"
          :aria-label="isActive('table') ? '表格工具' : '插入表格'"
          :title="isActive('table') ? '表格工具' : '插入表格'"
          :disabled="effectiveReadonly"
          @mousedown.prevent
          @click="isActive('table') ? tableToolsOpen = !tableToolsOpen : tablePicker = true"
        >
          <feishu-icon name="table" />
        </button><button
          v-if="toolbarEnabled('insert') && feishuConfig.features.diagram"
          type="button"
          aria-label="图表"
          title="插入图表"
          :disabled="effectiveReadonly"
          :aria-expanded="String(diagramMenuOpen)"
          @click="toggleDiagramMenu"
        >
          <feishu-icon name="chart" />
        </button><button
          v-if="toolbarEnabled('ai')"
          type="button"
          aria-label="AI 助手"
          title="AI 助手"
          :disabled="effectiveReadonly"
          @click="$emit('ai-request', 'rewrite')"
        >
          <feishu-icon name="sparkle" />AI
        </button>
        <!-- 图表类型下拉：流程图/时序图/甘特图等，承接图表插入的全部功能 -->
        <div
          v-if="diagramMenuOpen"
          class="feishu-dropdown feishu-diagram-menu"
          :style="diagramMenuStyle"
          role="menu"
          aria-label="图表类型"
        >
          <button
            v-for="item in diagramTypes"
            :key="item.id"
            type="button"
            role="menuitem"
            @mousedown.prevent
            @click="insertDiagramType(item.id)"
          >
            {{ item.label }}
          </button>
        </div>
      </div>
      <div class="feishu-tools feishu-tools-end">
        <span
          v-show="!isGroupCollapsed('toolsEnd')"
          class="feishu-tools-end-inner"
        >        <button
          v-if="toolbarEnabled('search')"
          type="button"
          aria-label="查找"
          title="查找"
          @click="searchOpen = !searchOpen; $nextTick(() => $refs.searchInput?.focus())"
        >
          <feishu-icon name="search" />
        </button><button
          v-if="toolbarEnabled('outline')"
          type="button"
          aria-label="目录"
          title="目录"
          :aria-expanded="String(outlineOpen)"
          @click="outlineOpen = !outlineOpen"
        >
          <feishu-icon name="outline" />
        </button>        <feishu-select
          v-if="toolbarEnabled('viewModes')"
          aria-label="页面宽度"
          :options="widthModeOptions"
          :value="widthMode"
          @change="widthMode = $event"
        /><button
          v-if="toolbarEnabled('viewModes')"
          type="button"
          :aria-label="reading ? '退出阅读' : '阅读模式'"
          :title="reading ? '退出阅读' : '阅读模式'"
          :aria-pressed="String(reading)"
          @click="toggleReading"
        >
          <feishu-icon name="reading" />
        </button><button
          v-if="toolbarEnabled('viewModes')"
          type="button"
          :aria-label="fullscreen ? '退出全屏' : '全屏'"
          :title="fullscreen ? '退出全屏' : '全屏'"
          :aria-pressed="String(fullscreen)"
          @click="toggleFullscreen"
        >
          <feishu-icon name="fullscreen" />
        </button><button
          v-if="toolbarEnabled('viewModes')"
          type="button"
          :aria-label="slides ? '退出演示' : '演示模式'"
          :title="slides ? '退出演示' : '演示模式'"
          :aria-pressed="String(slides)"
          @click="toggleSlides"
        >
          <feishu-icon name="slides" />
        </button>        <button
          v-if="toolbarEnabled('shortcuts')"
          type="button"
          aria-label="快捷键帮助"
          title="快捷键帮助"
          @click="helpOpen = !helpOpen"
        >
          ?
        </button><button
          v-if="!feishuConfig.layout.headerVisible && $slots['header-actions']"
          type="button"
          aria-label="文档操作"
          title="文档操作"
          :aria-expanded="String(headerMenuOpen)"
          @click="toggleHeaderMenu"
        >
          ⋯
        </button></span>
        <!-- header-menu 弹层放在 span 外：tools-end 被收纳隐藏时弹层仍可由「更多」打开 -->
        <div
          v-if="!feishuConfig.layout.headerVisible && headerMenuOpen"
          class="feishu-dropdown feishu-header-menu"
          :style="headerMenuStyle"
          role="menu"
          aria-label="文档操作"
        >
          <!-- 顶栏隐藏时承接 header-actions 插槽（字数/保存/模板/导入导出/快照） -->
          <slot name="header-actions" />
        </div>
        <!-- 工具栏自适应折叠：「更多 ▾」承接被收纳分组的全部功能（按组分节） -->
        <button
          v-if="collapsedGroups.length"
          type="button"
          aria-label="更多"
          title="更多工具"
          :aria-expanded="String(moreMenuOpen)"
          @mouseenter="openMoreMenuOnHover"
          @mouseleave="scheduleMoreMenuClose"
          @click="toggleMoreMenuGuarded"
        >
          更多<feishu-icon
            class="feishu-caret"
            :size="12"
            name="chevronDown"
          />
        </button><div
          v-if="moreMenuOpen"
          class="feishu-dropdown feishu-more-menu"
          :style="moreMenuStyle"
          role="menu"
          aria-label="更多工具"
          @mouseenter="cancelPopupHoverClose"
          @mouseleave="scheduleMoreMenuClose"
        >
          <template v-for="section in visibleToolbarSections">
            <div
              :key="section.id"
              class="feishu-more-title"
            >
              {{ section.title }}
            </div>
            <button
              v-for="item in section.items"
              :key="section.id + item.label"
              type="button"
              role="menuitem"
              :disabled="item.disabled"
              :class="{ 'feishu-more-active': item.checked }"
              @mousedown.prevent
              @click="runMoreItem(item, $event)"
            >
              <span
                class="feishu-select-check"
                aria-hidden="true"
              >{{ item.checked ? '✓' : '' }}</span>{{ item.label }}
            </button>
          </template>
        </div>
      </div>
    </div>

    <div
      v-if="searchOpen && featureEnabled('search')"
      class="feishu-search"
      role="search"
    >
      <input
        ref="searchInput"
        v-model="searchQuery"
        aria-label="查找内容"
        placeholder="查找文档"
        @input="updateSearch"
        @keydown.enter.prevent="nextMatch(1)"
      ><span>{{ searchMatches.length ? `${searchIndex + 1}/${searchMatches.length}` : (searchQuery ? '无结果' : '输入关键词') }}</span><button
        type="button"
        aria-label="上一处"
        :disabled="!searchMatches.length"
        @click="nextMatch(-1)"
      >
        ↑
      </button><button
        type="button"
        aria-label="下一处"
        :disabled="!searchMatches.length"
        @click="nextMatch(1)"
      >
        ↓
      </button><input
        v-model="replacement"
        aria-label="替换为"
        placeholder="替换为"
      ><button
        type="button"
        :disabled="effectiveReadonly || !searchMatches.length"
        @click="replace(false)"
      >
        替换
      </button><button
        type="button"
        :disabled="effectiveReadonly || !searchMatches.length"
        @click="replace(true)"
      >
        全部替换
      </button><button
        type="button"
        aria-label="关闭查找"
        @click="closeSearch"
      >
        <feishu-icon
          :size="14"
          name="close"
        />
      </button>
    </div>
    <div
      v-if="!effectiveReadonly && featureEnabled('tables') && isActive('table')"
      class="feishu-table-tools"
      role="toolbar"
      aria-label="表格工具"
    >
      <button
        v-for="item in visibleTableActions"
        :key="item.id"
        type="button"
        :aria-pressed="item.id === 'toggleHeaderRow' ? String(tableHeaderState.row) : item.id === 'toggleHeaderColumn' ? String(tableHeaderState.column) : undefined"
        :title="item.label"
        @mousedown.prevent
        @click="tableAction(item.id)"
      >
        {{ item.label }}
      </button><label title="单元格背景">单元格背景 <input
        type="color"
        aria-label="单元格背景"
        value="#f2faf6"
        @change="cellAttribute('backgroundColor', $event.target.value)"
      ></label><feishu-select
        aria-label="单元格水平对齐"
        :options="cellTextAlignOptions"
        :value="cellAlignState.textAlign"
        @change="applyCellAlign('textAlign', $event)"
      /><feishu-select
        aria-label="单元格垂直对齐"
        :options="cellVerticalAlignOptions"
        :value="cellAlignState.verticalAlign"
        @change="applyCellAlign('verticalAlign', $event)"
      />
    </div>

    <div class="feishu-body">
      <button
        v-if="!outlineOpen && featureEnabled('outline')"
        type="button"
        class="feishu-outline-reopen"
        aria-label="展开目录"
        title="展开目录"
        @click="outlineOpen = true"
      >
        ☰
      </button>
      <aside
        v-if="outlineOpen && featureEnabled('outline')"
        class="feishu-outline"
        aria-label="文档目录"
      >
        <div class="feishu-outline-heading">
          <strong>目录</strong><button
            type="button"
            aria-label="关闭目录"
            @click="outlineOpen = false"
          >
            <feishu-icon
              :size="14"
              name="close"
            />
          </button>
        </div><p v-if="!outline.length">
          添加标题后自动生成目录
        </p><div
          v-for="item in outlineItems"
          :key="item.pos"
          class="feishu-outline-item"
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
              class="feishu-outline-arrow"
              :class="{ 'is-collapsed': item.collapsed }"
              aria-hidden="true"
            />
          </button><span
            v-else
            class="feishu-outline-toggle-placeholder"
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
      <main class="feishu-main">
        <div
          v-if="slides"
          class="feishu-slide-stage"
          aria-label="幻灯片演示"
        >
          <p class="feishu-slide-counter">
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
          class="feishu-paper"
          @pointermove="onPaperPointerMove"
        >
          <div
            v-if="editor && !effectiveReadonly && featureEnabled('blockHandle') && handleRange"
            class="feishu-block-handle"
            :class="{ 'is-menu-open': blockMenuOpen }"
            :style="blockHandleStyle"
            @mouseenter="onBlockHandleEnter"
            @mouseleave="onBlockHandleLeave"
          >
            <button
              v-if="handleIsEmptyParagraph"
              type="button"
              class="feishu-empty-block-insert"
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
              class="feishu-block-handle-main"
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
              <span class="feishu-block-handle-type">{{ handleGlyph }}</span><span
                class="feishu-block-handle-dots"
                aria-hidden="true"
              >⠿</span>
            </button><div
              v-if="blockMenuOpen"
              class="feishu-block-menu"
              role="menu"
              aria-label="块操作"
              :style="blockMenuStyle"
              @mouseenter="onBlockMenuEnter"
              @mouseleave="onBlockMenuLeave"
              @focusin="onBlockMenuFocusIn"
              @focusout="onBlockMenuFocusOut"
            >
              <div
                v-if="visibleBlockTypeActions.length"
                class="feishu-block-menu-section feishu-block-type-actions"
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
                  <span
                    class="feishu-block-type-icon"
                    aria-hidden="true"
                  >{{ item.glyph }}</span><span class="sr-only">{{ item.label }}</span>
                </button>
              </div>
              <div
                class="feishu-block-menu-divider"
                role="separator"
              />
              <button
                v-if="featureEnabled('blockStyle')"
                type="button"
                role="menuitem"
                class="feishu-block-submenu-trigger"
                aria-haspopup="menu"
                :aria-expanded="blockAlignMenuOpen ? 'true' : 'false'"
                title="缩进和对齐"
                @mousedown.prevent
                @mouseenter="openBlockAlignMenuOnHover"
                @focus="openBlockAlignMenuOnHover"
                @click.stop="openBlockAlignMenuOnHover"
              >
                <span>缩进和对齐</span><span aria-hidden="true">›</span>
              </button><button
                v-if="featureEnabled('blockStyle')"
                type="button"
                role="menuitem"
                class="feishu-block-submenu-trigger"
                aria-haspopup="menu"
                :aria-expanded="blockColorMenuOpen ? 'true' : 'false'"
                title="颜色"
                @mousedown.prevent
                @mouseenter="openBlockColorMenuOnHover"
                @focus="openBlockColorMenuOnHover"
                @click.stop="openBlockColorMenuOnHover"
              >
                <span>颜色</span><span aria-hidden="true">›</span>
              </button><div
                v-if="blockColorMenuOpen && featureEnabled('blockStyle')"
                class="feishu-block-submenu feishu-block-color-submenu"
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
                    class="feishu-block-color-swatch is-transparent"
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
                    class="feishu-block-color-swatch"
                    :style="{ backgroundColor: color.value }"
                    aria-hidden="true"
                  /><span>{{ color.label }}</span>
                </button>
              </div>
              <div
                v-if="visibleBlockActions.length"
                class="feishu-block-menu-divider"
                role="separator"
              />
              <button
                v-for="item in visibleBlockActions"
                :key="item.id"
                type="button"
                role="menuitem"
                :title="item.label"
                @mousedown.prevent
                @click="blockAction(item.id)"
              >
                {{ item.label }}
              </button>
              <div
                v-if="featureEnabled('blockStyle')"
                class="feishu-block-menu-divider"
                role="separator"
              />
              <button
                v-if="isBlockActionEnabled('addBelow')"
                type="button"
                role="menuitem"
                title="在下方添加正文"
                @mousedown.prevent
                @click="blockAction('addBelow')"
              >
                在下方添加正文
              </button>
            </div><div
              v-if="blockAlignMenuOpen && featureEnabled('blockStyle')"
              class="feishu-block-submenu"
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
                  class="feishu-block-align-glyph"
                  aria-hidden="true"
                >{{ alignGlyphs[align] }}</span><span>{{ alignNames[align] }}对齐</span><span
                  v-if="blockAlignValue() === align"
                  class="feishu-block-align-check"
                  aria-hidden="true"
                >✓</span>
              </button>
              <div
                class="feishu-block-submenu-divider"
                role="separator"
              />
              <button
                type="button"
                role="menuitem"
                :disabled="blockAlignIndent() >= feishuConfig.limits.maxIndent"
                @mousedown.prevent
                @click="blockAlignAction('increaseIndent')"
              >
                <span
                  class="feishu-block-align-glyph"
                  aria-hidden="true"
                >⇥</span><span>增加缩进</span><span
                  v-if="blockAlignIndent() >= feishuConfig.limits.maxIndent"
                  class="feishu-block-align-help"
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
                  class="feishu-block-align-glyph"
                  aria-hidden="true"
                >⇤</span><span>减少缩进</span>
              </button>
            </div>
          </div><div
            v-if="dropPosition !== null"
            class="feishu-drop-line"
            :style="{ top: `${dropLineTop}px` }"
            aria-hidden="true"
          /><editor-content
            v-if="editor"
            id="feishu-editor"
            :editor="editor"
            class="feishu-editor-content"
            @keydown.native="onEditorKeydown"
            @pointerdown.native="onColumnPointerDown"
            @pointermove.native="onEditorPointerMove"
            @dragover.native="onBlockDragOver"
            @drop.native="onBlockDrop"
          /><div
            v-if="activeCalloutVisible && featureEnabled('callouts')"
            class="feishu-callout-tools"
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
              class="feishu-callout-emoji-picker"
              role="menu"
              aria-label="高亮块图标"
            >
              <label class="feishu-callout-emoji-search"><span class="sr-only">搜索表情</span><input
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
                class="feishu-callout-emoji-tabs"
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
                class="feishu-callout-emoji-empty"
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
            class="feishu-table-boundary-tools"
            :class="{ 'is-column': tableBoundary.hover === 'column', 'is-row': tableBoundary.hover === 'row' }"
            :style="{ ...tableBoundary.style, '--feishu-column-line-left': `${tableBoundary.columnLineLeft}px`, '--feishu-row-line-top': `${tableBoundary.rowLineTop}px` }"
            role="toolbar"
            aria-label="表格边界操作"
            @pointerenter="keepTableBoundaryHover"
            @pointerleave="clearTableBoundaryHover"
          >
            <span
              v-if="tableBoundary.hover === 'column'"
              class="feishu-table-boundary-line is-column-line"
              :style="{ left: `${tableBoundary.columnLineLeft}px` }"
              aria-hidden="true"
            /><span
              v-if="tableBoundary.hover === 'row'"
              class="feishu-table-boundary-line is-row-line"
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
        </div><footer class="feishu-status">
          <span>{{ wordCount }}{{ effectiveMaxLength > 0 ? ` / ${effectiveMaxLength}` : '' }} 字 · {{ outline.length }} 个标题</span><span>{{ effectiveReadonly ? '仅阅读' : '输入 / 快速插入' }}</span>
        </footer>
      </main>
      <aside
        v-if="$slots['side-panel']"
        class="feishu-external-panel"
      >
        <slot name="side-panel" />
      </aside>
    </div>

    <div
      v-if="bubbleVisible && !effectiveReadonly"
      class="feishu-bubble"
      :style="bubbleStyle"
      role="toolbar"
      aria-label="划词工具栏"
      @mousedown.prevent
    >
      <div
        class="feishu-bubble-align"
        @mouseenter="openBubbleAlignMenu"
      >
        <button
          type="button"
          class="feishu-bubble-align-trigger"
          aria-label="缩进和对齐"
          title="缩进和对齐"
          aria-haspopup="menu"
          :aria-expanded="bubbleAlignOpen ? 'true' : 'false'"
          @focus="openBubbleAlignMenu"
          @click.prevent="openBubbleAlignMenu"
        >
          <span aria-hidden="true">{{ alignGlyphs[bubbleAlignValue()] }}</span><feishu-icon
            class="feishu-bubble-align-arrow"
            :size="8"
            name="caretSolid"
          />
        </button>
        <div
          v-if="bubbleAlignOpen"
          class="feishu-bubble-align-menu"
          role="menu"
          aria-label="划词缩进和对齐"
          :style="bubbleAlignMenuStyle"
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
              class="feishu-block-align-glyph"
              aria-hidden="true"
            >{{ alignGlyphs[align] }}</span><span>{{ alignNames[align] }}对齐</span><span
              v-if="bubbleAlignValue() === align"
              class="feishu-block-align-check"
              aria-hidden="true"
            >✓</span>
          </button>
          <div
            class="feishu-block-submenu-divider"
            role="separator"
          />
          <button
            type="button"
            role="menuitem"
            :disabled="bubbleAlignIndent() >= feishuConfig.limits.maxIndent"
            :data-tooltip="bubbleAlignTooltip('increaseIndent')"
            :title="bubbleAlignTooltip('increaseIndent')"
            @mousedown.prevent
            @click="bubbleAlignAction('increaseIndent')"
          >
            <span
              class="feishu-block-align-glyph"
              aria-hidden="true"
            >⇥</span><span>增加缩进</span><span
              v-if="bubbleAlignIndent() >= feishuConfig.limits.maxIndent"
              class="feishu-block-align-help"
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
              class="feishu-block-align-glyph"
              aria-hidden="true"
            >⇤</span><span>减少缩进</span>
          </button>
        </div>
      </div>
      <button
        v-for="item in visibleMarks.slice(0, 4)"
        :key="item.id"
        type="button"
        :aria-label="item.label"
        @click="toggleMark(item.id)"
      >
        {{ item.glyph }}
      </button><button
        v-if="featureEnabled('ai')"
        type="button"
        @click="$emit('ai-request', 'rewrite')"
      >
        AI 改写
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
      class="feishu-color-palette"
      :class="{ 'feishu-color-palette-text': colorPaletteIsText }"
      role="menu"
      :aria-label="`${colorPaletteTitle}面板`"
      :style="colorPaletteStyle"
      @mousedown.prevent
      @mouseenter="cancelPopupHoverClose"
      @mouseleave="scheduleColorPaletteClose"
    >
      <template v-if="colorPaletteIsText">
        <div class="feishu-color-palette-text-section">
          <small>字体颜色</small>
          <div class="feishu-color-letters">
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
        <div class="feishu-color-palette-text-section">
          <small>背景颜色</small>
          <div
            v-for="(row, rowIndex) in textBackgroundRows"
            :key="`row-${rowIndex}`"
            class="feishu-color-grid"
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
      </template>
      <template v-else>
        <strong>{{ colorPaletteTitle }}</strong>
        <div
          v-if="colorPaletteRecent.length"
          class="feishu-color-palette-section"
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
        <div class="feishu-color-palette-section">
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
          class="feishu-color-palette-reset"
          aria-label="恢复默认颜色"
          @click="resetColorPalette"
        >
          恢复默认
        </button>
      </template>
    </div>
    <div
      v-if="tablePicker"
      class="feishu-dialog-backdrop"
      @click.self="closeOverlay"
    >
      <section
        class="feishu-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="插入表格"
      >
        <header>
          <strong>插入表格</strong><span class="feishu-table-grid-size">{{ tablePickerHover.cols }} × {{ tablePickerHover.rows }}</span><button
            type="button"
            aria-label="关闭表格选择"
            @click="closeOverlay"
          >
            <feishu-icon
              :size="14"
              name="close"
            />
          </button>
        </header><p>插入支持富文本的表格</p><div class="feishu-table-grid">
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
      class="feishu-dialog-backdrop"
      @click.self="closeOverlay"
    >
      <section
        class="feishu-dialog"
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
            <feishu-icon
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
            class="feishu-error"
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
          class="feishu-emoji-grid"
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
      class="feishu-dialog-backdrop"
      @click.self="closeOverlay"
    >
      <section
        class="feishu-dialog"
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
            <feishu-icon
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
      class="feishu-dialog-backdrop"
      @click.self="closeOverlay"
    >
      <section
        class="feishu-dialog"
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
            <feishu-icon
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
      class="feishu-file-input"
      aria-label="选择本地图片"
      @change="onImageInput"
    >
    <p
      v-if="error"
      class="feishu-toast"
      role="alert"
    >
      {{ error }} <button
        type="button"
        aria-label="关闭错误"
        @click="error = ''"
      >
        <feishu-icon
          :size="14"
          name="close"
        />
      </button>
    </p>
  </section>
</template>

<script>
// FeishuDocumentEditor.vue —— 编辑器视图层：模板、props、生命周期与内容管理核心方法。
// 各 UI 子域拆分到 ./editor/ 下的 mixin（视图模式/命令菜单/表格工具/区块句柄/区块菜单/
// 气泡菜单/高亮块与颜色盘/工具栏菜单），经 Vue 2 选项合并后仍以 this.xxx 供模板与生命周期调用。
import { Editor, EditorContent } from '@tiptap/vue-2'
import { DOMParser as ProseMirrorDOMParser } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import { closeHistory } from '@tiptap/pm/history'
import CommandMenu from './CommandMenu.vue'
import ImageNode from './ImageNode.vue'
import CodeNode from './CodeNode.vue'
import FeishuSelect from './FeishuSelect.vue'
import FeishuIcon from './FeishuIcon.vue'
import { createFeishuExtensions } from './extensions'
import { collectOutline, safeAttachmentId, safeUrl, sanitizeHTML, validateDocument } from './documentOperations'
import { isBlockActionEnabled, isConfigEnabled, mergeLegacyConfig } from './feishuConfig'
import viewModesMixin from './editor/viewModesMixin'
import commandMenuMixin from './editor/commandMenuMixin'
import tableToolsMixin from './editor/tableToolsMixin'
import toolbarCollapseMixin from './editor/toolbarCollapseMixin'
import blockHandleMixin from './editor/blockHandleMixin'
import blockMenuMixin from './editor/blockMenuMixin'
import bubbleMenuMixin from './editor/bubbleMenuMixin'
import calloutColorMixin from './editor/calloutColorMixin'
import toolbarMenusMixin from './editor/toolbarMenusMixin'
import { setTransactionMetadata, TRANSACTION_ORIGINS } from '../../core/transactionMetadata'
import { createNetworkPolicy } from '../../networkPolicy'
// 旧数据兼容：Vditor getHTML() 产物在 setContent 前归一化。
import { normalizeVditorHtml } from '../../legacy'
import './feishu.css'

export default {
  name: 'FeishuDocumentEditor',
  components: { EditorContent, CommandMenu, FeishuSelect, FeishuIcon },
  mixins: [viewModesMixin, commandMenuMixin, tableToolsMixin, blockHandleMixin, blockMenuMixin, bubbleMenuMixin, calloutColorMixin, toolbarMenusMixin, toolbarCollapseMixin],
  props: {
    value: { type: String, default: '<p></p>' }, title: { type: String, default: '' }, readonly: { type: Boolean, default: false },
    config: { type: Object, default: () => ({}) }, maxLength: { type: Number, default: null }, imageMaxSize: { type: Number, default: null },
    templates: { type: Array, default: () => [] },
    uploadImage: { type: Function, default: null }, msgId: { type: [Number, String], default: null },
    session: { type: Object, default: null },
    // 'auto' 按指纹识别 Vditor HTML；'vditor' 强制归一化；'html' 明确跳过归一化。
    contentFormat: { type: String, default: 'auto' },
  },
  data() { return {
    editor: null, localTitle: this.title,
    alignNames: { left: '左', center: '居中', right: '右', justify: '两端' }, alignGlyphs: { left: '≡', center: '☷', right: '≣', justify: '▤' },
    helpOpen: false, savedSelection: null,
    error: '', pendingHTML: null, htmlSeeded: false,
    pendingStateFrame: null, pendingChangeTimer: null,
  } },
  computed: {
    // ECS 的 ref.html 与新页面 v-model 使用同一正文，保留原调用方的读写契约。
    feishuConfig() { return mergeLegacyConfig(this.config, { maxLength: this.maxLength, imageMaxSize: this.imageMaxSize }) },
    effectiveMaxLength() { return Math.max(0, Number(this.feishuConfig.limits.maxLength) || 0) },
    effectiveImageMaxSize() { return this.feishuConfig.limits.maxImageSize },
    titleLength() { return this.feishuConfig.limits.titleLength },
    visibleBlockActions() { return this.blockActions.filter((item) => isBlockActionEnabled(this.feishuConfig, item.id)) },
    visibleBlockTypeActions() {
      return this.blockTypeActions.filter((item) => {
        const feature = item.id === 'codeBlock' ? 'codeBlocks' : 'blockStyle'
        return isConfigEnabled(this.feishuConfig, feature) && isBlockActionEnabled(this.feishuConfig, item.id)
      })
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
    tablePicker(value) { if (value) { this.tablePickerHover = { rows: 3, cols: 3 }; this.$nextTick(() => this.$refs.root?.querySelector('.feishu-table-grid button')?.focus()) } },
    emojiDialog(value) { if (value) this.$nextTick(() => this.$refs.root?.querySelector('.feishu-emoji-grid button')?.focus()) },
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
        extensions: createFeishuExtensions({ imageView: ImageNode, codeView: CodeNode, maxLength: this.effectiveMaxLength, config: this.feishuConfig, resolveImageFile: this.resolveImageFile, onSlash: this.onSlash, onImageFiles: this.insertImageFiles, onBackspace: () => this.deletePreviousBlockOnBackspace(), onError: (message) => { this.error = message } }),
        onUpdate: () => this.onUpdate(), onTransaction: () => { this.syncFoldState(); this.$nextTick(() => this.syncHandleHighlightBackdrop()) }, onSelectionUpdate: () => this.onSelectionUpdate(),
      })
      this.session?.attachEditor(this.editor)
      this._sessionCapabilitiesOff = this.session?.on?.('capabilities', () => this.$forceUpdate()) || null
      this.refreshDocumentState()
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
    featureEnabled(name) { return isConfigEnabled(this.feishuConfig, name) },
    toolbarEnabled(name) { return this.feishuConfig.toolbar[name] !== false && this.featureEnabled(name) },
    isBlockActionEnabled(id) { return isBlockActionEnabled(this.feishuConfig, id) },
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
          console.warn("[feishu-document] contentFormat 'wangeditor' 已不支持，按 'auto' 处理")
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
      json = createNetworkPolicy(this.feishuConfig ? this.feishuConfig.network : null).applyDocument(json)
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
      // 使用普通事务替换正文，让本地历史可撤销模板、导入与快照恢复。
      const tr = this.editor.state.tr.replaceWith(0, this.editor.state.doc.content.size, next.content)
      this.editor.view.dispatch(setTransactionMetadata(tr, { origin: TRANSACTION_ORIGINS.HOST }))
      if (this.editor.commands && typeof this.editor.commands.resetFeishuFolds === 'function') this.editor.commands.resetFeishuFolds()
      this.savedSelection = null
      this.editor.view.dispatch(closeHistory(this.editor.state.tr))
      return true
    },
    updateTitle(value) { if (this.effectiveReadonly) return; this.localTitle = value; this.$emit('update:title', value) },
    onUpdate() {
      this.scheduleDocumentState()
      const publish = () => {
        if (!this.editor || this._isBeingDestroyed || this._isDestroyed) return
        const html = this.getHTML()
        this.$emit('input', html)
        this.$emit('change', { html, json: this.getJSON(), text: this.getText() })
      }
      clearTimeout(this.pendingChangeTimer)
      const delay = this.feishuConfig.performance.changeDebounce
      this.pendingChangeTimer = delay > 0 ? setTimeout(publish, delay) : null
      if (!delay) publish()
    },
    scheduleDocumentState() {
      if (!this.editor) return
      if (!this.feishuConfig.performance.stateUpdateFrame) {
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
      const current = this.editor.storage.feishuDocument?.folded || new Set()
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
      if (this.bubbleVisible) this.bubblePosition = { left: Math.max(8, Math.min(window.innerWidth - 270, coords.left)), top: Math.max(8, coords.top - 50) }
      else this.closeBubbleAlignMenu()
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
    // 自绘下拉（FeishuSelect）的回调：应用样式并记住最近值，供触发按钮回显。
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
    setBlockAttribute(name, value) { if (!this.writable() || value === null || value === undefined || value === '') return; this.restoreSelection(); const block = this.editor.isActive('heading') ? 'heading' : 'paragraph'; this.editor.chain().focus().updateAttributes(block, { [name]: value }).run() },
    setAlign(value) { this.run('setTextAlign', value) },
    changeIndent(delta) { if (!this.writable()) return; const block = this.editor.isActive('heading') ? 'heading' : 'paragraph'; const indent = Math.max(0, Math.min(8, (this.editor.getAttributes(block).indent || 0) + delta)); this.setBlockAttribute('indent', indent) },
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
      if (!event.target.closest?.('.feishu-block-handle, .feishu-callout-tools')) this.scheduleHandleHide()
    },
    onDocumentPointerDown(event) {
      const target = event.target
      if (this.menuOpen && !target.closest?.('.feishu-command-menu') && target !== this.menuTrigger && !this.menuTrigger?.contains(target)) this.closeCommandMenu()
      if (this.blockMenuOpen && !target.closest?.('.feishu-block-menu') && !target.closest?.('.feishu-block-handle')) this.closeBlockMenu()
      if (this.blockTypeMenuOpen && !target.closest?.('.feishu-block-type-menu') && !target.closest?.('.feishu-block-handle')) this.blockTypeMenuOpen = false
      if (this.blockAlignMenuOpen && !target.closest?.('.feishu-block-menu') && !target.closest?.('.feishu-block-handle')) this.closeBlockMenu()
      if (this.blockColorMenuOpen && !target.closest?.('.feishu-block-menu') && !target.closest?.('.feishu-block-handle')) this.closeBlockMenu()
      if (this.bubbleAlignOpen && !target.closest?.('.feishu-bubble-align') && !target.closest?.('.feishu-bubble-align-menu')) this.closeBubbleAlignMenu()
      if (this.calloutEmojiOpen && !target.closest?.('.feishu-callout-tools')) this.calloutEmojiOpen = false
      if (this.colorPaletteOpen && !target.closest?.('.feishu-color-palette') && !target.closest?.('.feishu-color')) this.colorPaletteOpen = ''
      if (this.headerMenuOpen && !target.closest?.('.feishu-header-menu') && !target.closest?.('button[aria-label="文档操作"]')) this.closeHeaderMenu()
      if (this.diagramMenuOpen && !target.closest?.('.feishu-diagram-menu') && !target.closest?.('button[aria-label="图表"]')) this.closeDiagramMenu()
      if (!this.$refs.root?.contains(target)) {
        this.headingOpen = false
        this.headingStyle = {}
        this.tableToolsOpen = false
      }
    },
    onWindowKeydown(event) {
      if (event.key === 'Escape' && this.slides) this.toggleSlides()
      else if (event.key === 'Escape' && (this.blockMenuOpen || this.blockTypeMenuOpen || this.blockAlignMenuOpen || this.blockColorMenuOpen)) this.closeBlockMenu()
      else if (this.slides && event.key === 'ArrowRight') this.slideIndex = Math.min(this.slideChapters.length - 1, this.slideIndex + 1)
      else if (this.slides && event.key === 'ArrowLeft') this.slideIndex = Math.max(0, this.slideIndex - 1)
    },
    closeOverlay() { if (this.menuOpen) this.closeCommandMenu(); else if (this.colorPaletteOpen) this.colorPaletteOpen = ''; else if (this.mathDialog) this.mathDialog = ''; else if (this.emojiDialog) this.emojiDialog = false; else if (this.linkDialog) this.linkDialog = false; else if (this.tablePicker) { this.tablePicker = false; this.tablePickerHover = { rows: 3, cols: 3 } } else if (this.helpOpen) this.helpOpen = false; else if (this.headingOpen) { this.headingOpen = false; this.headingStyle = {} } else if (this.headerMenuOpen) this.closeHeaderMenu(); else if (this.diagramMenuOpen) this.closeDiagramMenu(); else if (this.bubbleAlignOpen) this.closeBubbleAlignMenu(); else if (this.blockAlignMenuOpen || this.blockColorMenuOpen || this.blockTypeMenuOpen || this.blockMenuOpen) this.closeBlockMenu(); else if (this.calloutEmojiOpen) this.calloutEmojiOpen = false; else if (this.tableToolsOpen) this.tableToolsOpen = false; else if (this.searchOpen) this.closeSearch(); this.focus() },
  },
}
</script>
