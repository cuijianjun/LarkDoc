<template>
  <section
    ref="root"
    class="feishu-document"
    :class="[`feishu-width-${widthMode}`, { 'feishu-reading': effectiveReadonly, 'feishu-slides': slides, 'feishu-fullscreen': fullscreen }]"
    @keydown.esc="closeOverlay"
  >
    <a
      class="feishu-skip"
      href="#feishu-editor"
    >跳到正文</a>
    <header class="feishu-topbar">
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
      <div v-if="toolbarEnabled('history')" class="feishu-tools">
        <button
          type="button"
          aria-label="撤销"
          title="撤销"
          :disabled="effectiveReadonly"
          @click="run('undo')"
        >
          ↶
        </button><button
          type="button"
          aria-label="重做"
          title="重做"
          :disabled="effectiveReadonly"
          @click="run('redo')"
        >
          ↷
        </button>
      </div>
      <div v-if="toolbarEnabled('headings')" class="feishu-tools feishu-heading-tool">
        <button
          type="button"
          aria-label="标题级别"
          title="标题级别"
          :disabled="effectiveReadonly"
          :aria-expanded="headingOpen ? 'true' : 'false'"
          @click="toggleHeadingMenu"
        >
          {{ currentBlockLabel }}⌄
        </button><div
          v-if="headingOpen"
          class="feishu-dropdown"
          :style="headingStyle"
          role="menu"
          aria-label="标题级别"
        >
          <button
            type="button"
            role="menuitem"
            @mousedown.prevent
            @click="setHeading(0)"
          >
            正文
          </button><button
            v-for="level in 9"
            :key="level"
            type="button"
            role="menuitem"
            @mousedown.prevent
            @click="setHeading(level)"
          >
            {{ '一二三四五六七八九'[level - 1] }}级标题
          </button>
        </div>
      </div>
      <div v-if="toolbarEnabled('marks')" class="feishu-tools">
        <button
          v-for="item in visibleMarks"
          :key="item.id"
          type="button"
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
      <div v-if="toolbarEnabled('textStyle')" class="feishu-tools">
        <button
          type="button"
          aria-label="设置链接"
          title="设置链接"
          :aria-pressed="String(isActive('link'))"
          :disabled="effectiveReadonly || !hasTextSelection"
          @mousedown.prevent
          @click="openLinkDialog"
        >
          链接
        </button>
        <select
          aria-label="字体"
          title="字体"
          :disabled="effectiveReadonly"
          @focus="rememberSelection"
          @change="setTextStyle('fontFamily', $event.target.value)"
        >
          <option value="">
            字体
          </option><option value="Arial">
            Arial
          </option><option value="Microsoft YaHei">
            微软雅黑
          </option><option value="SimSun">
            宋体
          </option><option value="Georgia">
            Georgia
          </option>
        </select><select
          aria-label="字号"
          title="字号"
          :disabled="effectiveReadonly"
          @focus="rememberSelection"
          @change="setTextStyle('fontSize', $event.target.value)"
        >
          <option value="">
            字号
          </option><option
            v-for="size in [12, 14, 16, 18, 20, 24, 28, 32, 40]"
            :key="size"
            :value="`${size}px`"
          >
            {{ size }}
          </option>
        </select><label
          class="feishu-color"
          title="文字颜色"
          aria-haspopup="menu"
          @click.prevent="toggleColorPalette('textColor', $event)"
        >字<input
          type="color"
          aria-label="文字颜色"
          :disabled="effectiveReadonly"
          value="#263b35"
          @focus="rememberSelection"
          @input="setTextStyle('color', $event.target.value)"
        ></label><label
          class="feishu-color"
          title="背景颜色"
          aria-haspopup="menu"
          @click.prevent="toggleColorPalette('textBackground', $event)"
        >底<input
          type="color"
          aria-label="背景颜色"
          :disabled="effectiveReadonly"
          value="#fff2a8"
          @focus="rememberSelection"
          @input="setTextStyle('backgroundColor', $event.target.value)"
        ></label>
      </div>
      <div v-if="toolbarEnabled('blockStyle')" class="feishu-tools">
        <select
          aria-label="行高"
          title="行高"
          :disabled="effectiveReadonly"
          @focus="rememberSelection"
          @change="setBlockAttribute('lineHeight', $event.target.value)"
        >
          <option value="">
            行高
          </option><option
            v-for="height in ['1', '1.25', '1.5', '1.75', '2', '2.5', '3']"
            :key="height"
            :value="height"
          >
            {{ height }}
          </option>
        </select><button
          v-for="align in ['left', 'center', 'right', 'justify']"
          :key="align"
          type="button"
          :aria-label="`对齐${alignNames[align]}`"
          :title="`对齐${alignNames[align]}`"
          :disabled="effectiveReadonly"
          @mousedown.prevent
          @click="setAlign(align)"
        >
          {{ alignGlyphs[align] }}
        </button><button
          type="button"
          aria-label="减少缩进"
          title="减少缩进"
          :disabled="effectiveReadonly"
          @mousedown.prevent
          @click="changeIndent(-1)"
        >
          ⇤
        </button><button
          type="button"
          aria-label="增加缩进"
          title="增加缩进"
          :disabled="effectiveReadonly"
          @mousedown.prevent
          @click="changeIndent(1)"
        >
          ⇥
        </button><button
          type="button"
          aria-label="清除格式"
          title="清除格式"
          :disabled="effectiveReadonly"
          @mousedown.prevent
          @click="clearFormatting"
        >
          清除
        </button>
      </div>
      <div v-if="toolbarEnabled('insert') || toolbarEnabled('tables') || toolbarEnabled('ai')" class="feishu-tools">
        <button
          v-if="toolbarEnabled('insert')"
          type="button"
          aria-label="插入"
          title="插入内容"
          :disabled="effectiveReadonly"
          @click="openCommandMenu('plus', $event)"
        >
          ＋ 插入
        </button><button
          v-if="toolbarEnabled('tables')"
          type="button"
          :aria-label="isActive('table') ? '表格工具' : '插入表格'"
          :title="isActive('table') ? '表格工具' : '插入表格'"
          :disabled="effectiveReadonly"
          @mousedown.prevent
          @click="isActive('table') ? tableToolsOpen = !tableToolsOpen : tablePicker = true"
        >
          表格
        </button><button
          v-if="toolbarEnabled('ai')"
          type="button"
          aria-label="AI 助手"
          title="AI 助手"
          :disabled="effectiveReadonly"
          @click="$emit('ai-request', 'rewrite')"
        >
          ✦ AI
        </button>
      </div>
      <div class="feishu-tools feishu-tools-end">
        <button
          v-if="toolbarEnabled('search')"
          type="button"
          aria-label="查找"
          title="查找"
          @click="searchOpen = !searchOpen; $nextTick(() => $refs.searchInput?.focus())"
        >
          ⌕ 查找
        </button><button
          v-if="toolbarEnabled('outline')"
          type="button"
          aria-label="目录"
          title="目录"
          :aria-expanded="String(outlineOpen)"
          @click="outlineOpen = !outlineOpen"
        >
          目录
        </button><select
          v-if="toolbarEnabled('viewModes')"
          v-model="widthMode"
          aria-label="页面宽度"
          title="页面宽度"
        >
          <option value="standard">
            标准
          </option><option value="wide">
            宽版
          </option><option value="full">
            通栏
          </option>
        </select><button
          v-if="toolbarEnabled('viewModes')"
          type="button"
          :aria-label="reading ? '退出阅读' : '阅读模式'"
          :title="reading ? '退出阅读' : '阅读模式'"
          @click="toggleReading"
        >
          {{ reading ? '退出阅读' : '阅读' }}
        </button><button
          v-if="toolbarEnabled('viewModes')"
          type="button"
          :aria-label="fullscreen ? '退出全屏' : '全屏'"
          :title="fullscreen ? '退出全屏' : '全屏'"
          @click="toggleFullscreen"
        >
          {{ fullscreen ? '退出全屏' : '全屏' }}
        </button><button
          v-if="toolbarEnabled('viewModes')"
          type="button"
          :aria-label="slides ? '退出演示' : '演示模式'"
          :title="slides ? '退出演示' : '演示模式'"
          @click="toggleSlides"
        >
          {{ slides ? '退出演示' : '演示' }}
        </button><button
          v-if="toolbarEnabled('shortcuts')"
          type="button"
          aria-label="快捷键帮助"
          title="快捷键帮助"
          @click="helpOpen = !helpOpen"
        >
          ?
        </button>
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
        ×
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
      ></label><select
        aria-label="单元格水平对齐"
        title="单元格水平对齐"
        @change="cellAttribute('textAlign', $event.target.value)"
      >
        <option value="">
          水平对齐
        </option><option value="left">
          左
        </option><option value="center">
          中
        </option><option value="right">
          右
        </option>
      </select><select
        aria-label="单元格垂直对齐"
        title="单元格垂直对齐"
        @change="cellAttribute('verticalAlign', $event.target.value)"
      >
        <option value="">
          垂直对齐
        </option><option value="top">
          上
        </option><option value="middle">
          中
        </option><option value="bottom">
          下
        </option>
      </select>
    </div>

    <div class="feishu-body">
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
            ×
          </button>
        </div><p v-if="!outline.length">
          添加标题后自动生成目录
        </p><div
          v-for="item in outline"
          :key="item.pos"
          class="feishu-outline-item"
          :style="{ paddingLeft: `${Math.min(item.level - 1, 5) * 10}px` }"
        >
          <button
            type="button"
            :aria-label="`${folded.has(item.pos) ? '展开' : '收起'}${item.text || '标题'}`"
            :aria-expanded="String(!folded.has(item.pos))"
            @click="toggleFold(item.pos)"
          >
            {{ folded.has(item.pos) ? '▸' : '▾' }}
          </button><button
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
              @click="openCommandMenu('plus', $event)"
            >
              ＋
            </button><template v-else-if="handleIsTaskList" /><template v-else>
              <button
                type="button"
                class="feishu-block-handle-main"
                :class="{ 'is-callout': handleBlockNode()?.type?.name === 'callout' }"
                aria-label="块操作"
                title="块操作与拖动"
                :draggable="featureEnabled('blockDrag')"
                @click="toggleBlockMenu"
                @pointerdown="handlePressed = true"
                @dragstart="startBlockDrag"
                @dragend="handlePressed = false; dragging = null; dropPosition = null; refreshHandleHighlight()"
              >
                <span class="feishu-block-handle-type">{{ handleGlyph }}</span><span class="feishu-block-handle-dots" aria-hidden="true">⠿</span>
              </button><div
                v-if="blockMenuOpen"
                class="feishu-block-menu"
                role="menu"
                aria-label="块操作"
                :style="blockMenuStyle"
              >
                <div v-if="visibleBlockTypeActions.length" class="feishu-block-menu-section feishu-block-type-actions" role="group" aria-label="类型转换">
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
                    <span class="feishu-block-type-icon" aria-hidden="true">{{ item.glyph }}</span><span class="sr-only">{{ item.label }}</span>
                  </button>
                </div>
                <div class="feishu-block-menu-divider" role="separator" />
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
                    <span class="feishu-block-color-swatch is-transparent" aria-hidden="true" /><span>恢复默认</span>
                  </button><button
                    v-for="color in colorPaletteOptions"
                    :key="`block-color-${color.value || 'default'}`"
                    type="button"
                    role="menuitem"
                    :aria-label="color.label"
                    @mousedown.prevent
                    @click="blockColorAction(color.value)"
                  >
                    <span class="feishu-block-color-swatch" :style="{ backgroundColor: color.value }" aria-hidden="true" /><span>{{ color.label }}</span>
                  </button>
                </div>
                <div v-if="visibleBlockActions.length" class="feishu-block-menu-divider" role="separator" />
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
                <div v-if="featureEnabled('blockStyle')" class="feishu-block-menu-divider" role="separator" />
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
                    <span class="feishu-block-align-glyph" aria-hidden="true">{{ alignGlyphs[align] }}</span><span>{{ alignNames[align] }}对齐</span><span
                      v-if="blockAlignValue() === align"
                      class="feishu-block-align-check"
                      aria-hidden="true"
                    >✓</span>
                  </button>
                  <div class="feishu-block-submenu-divider" role="separator" />
                  <button
                    type="button"
                    role="menuitem"
                    :disabled="blockAlignIndent() >= feishuConfig.limits.maxIndent"
                    @mousedown.prevent
                    @click="blockAlignAction('increaseIndent')"
                  >
                    <span class="feishu-block-align-glyph" aria-hidden="true">⇥</span><span>增加缩进</span><span
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
                    <span class="feishu-block-align-glyph" aria-hidden="true">⇤</span><span>减少缩进</span>
                  </button>
                </div>
            </template>
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
            <label title="高亮块文字颜色" aria-haspopup="menu" @click.prevent="toggleColorPalette('calloutColor', $event)"><span aria-hidden="true">A</span><input
              type="color"
              aria-label="高亮块文字颜色"
              :value="calloutColor('color', '#263830')"
              @input="setCalloutColor('color', $event.target.value)"
            ></label><label title="高亮块背景颜色" aria-haspopup="menu" @click.prevent="toggleColorPalette('calloutBackground', $event)"><span aria-hidden="true">◉</span><input
              type="color"
              aria-label="高亮块背景颜色"
              :value="calloutColor('backgroundColor', '#eff9f4')"
              @input="setCalloutColor('backgroundColor', $event.target.value)"
            ></label><label title="高亮块边框颜色" aria-haspopup="menu" @click.prevent="toggleColorPalette('calloutBorder', $event)"><span aria-hidden="true">▔</span><input
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
              </button><div class="feishu-callout-emoji-tabs" role="tablist" aria-label="高亮块图标分类"><button
                type="button"
                role="tab"
                aria-label="最近使用"
                :aria-selected="String(calloutEmojiCategory === 'recent')"
                @click="calloutEmojiCategory = 'recent'"
              >最近</button><button
                type="button"
                role="tab"
                aria-label="全部"
                :aria-selected="String(calloutEmojiCategory === 'all')"
                @click="calloutEmojiCategory = 'all'"
              >全部</button><button
                v-for="category in calloutEmojiCategories"
                :key="category"
                type="button"
                role="tab"
                :aria-label="category"
                :aria-selected="String(calloutEmojiCategory === category)"
                @click="calloutEmojiCategory = category"
              >{{ category }}</button></div><p
                v-if="calloutEmojiCategory === 'recent' && !filteredCalloutEmojiItems.length"
                class="feishu-callout-emoji-empty"
              >暂无最近使用</p><button
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
          <span aria-hidden="true">{{ alignGlyphs[bubbleAlignValue()] }}</span><span class="feishu-bubble-align-arrow" aria-hidden="true">⌄</span>
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
            <span class="feishu-block-align-glyph" aria-hidden="true">{{ alignGlyphs[align] }}</span><span>{{ alignNames[align] }}对齐</span><span
              v-if="bubbleAlignValue() === align"
              class="feishu-block-align-check"
              aria-hidden="true"
            >✓</span>
          </button>
          <div class="feishu-block-submenu-divider" role="separator" />
          <button
            type="button"
            role="menuitem"
            :disabled="bubbleAlignIndent() >= feishuConfig.limits.maxIndent"
            :data-tooltip="bubbleAlignTooltip('increaseIndent')"
            :title="bubbleAlignTooltip('increaseIndent')"
            @mousedown.prevent
            @click="bubbleAlignAction('increaseIndent')"
          >
            <span class="feishu-block-align-glyph" aria-hidden="true">⇥</span><span>增加缩进</span><span
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
            <span class="feishu-block-align-glyph" aria-hidden="true">⇤</span><span>减少缩进</span>
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
      role="menu"
      :aria-label="`${colorPaletteTitle}面板`"
      :style="colorPaletteStyle"
      @mousedown.prevent
    >
      <strong>{{ colorPaletteTitle }}</strong>
      <div v-if="colorPaletteRecent.length" class="feishu-color-palette-section">
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
      <button type="button" role="menuitem" class="feishu-color-palette-reset" aria-label="恢复默认颜色" @click="resetColorPalette">恢复默认</button>
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
            ×
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
            ×
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
            ×
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
            ×
          </button>
        </header><p>⌘/Ctrl+B 加粗 · ⌘/Ctrl+I 斜体 · ⌘/Ctrl+Z 撤销</p><p>行首或空格后输入 / 插入内容；Tab 调整列表层级。</p>
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
        ×
      </button>
    </p>
  </section>
</template>

<script>
import { Editor, EditorContent } from '@tiptap/vue-2'
import { DOMParser as ProseMirrorDOMParser } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import { closeHistory } from '@tiptap/pm/history'
import { selectedRect } from '@tiptap/pm/tables'
import CommandMenu from './CommandMenu.vue'
import ImageNode from './ImageNode.vue'
import CodeNode from './CodeNode.vue'
import { filterCommands } from './commands'
import { createFeishuExtensions } from './extensions'
import { collectOutline, findTextMatches, foldedRange, moveBlockRange, replaceText, safeAttachmentId, safeUrl, sanitizeHTML, validateDocument } from './documentOperations'
import { isBlockActionEnabled, isCommandEnabled, isConfigEnabled, mergeLegacyConfig } from './feishuConfig'
import './feishu.css'

const marks = [
  { id: 'bold', label: '加粗', glyph: 'B' }, { id: 'italic', label: '斜体', glyph: 'I' },
  { id: 'underline', label: '下划线', glyph: 'U' }, { id: 'strike', label: '删除线', glyph: 'S' },
  { id: 'code', label: '行内代码', glyph: '</>' }, { id: 'subscript', label: '下标', glyph: 'X₂' },
  { id: 'superscript', label: '上标', glyph: 'X²' }, { id: 'highlight', label: '高亮', glyph: '▣' },
]
const tableActions = [
  { id: 'addRowBefore', label: '上方加行' }, { id: 'addRowAfter', label: '下方加行' }, { id: 'deleteRow', label: '删行' },
  { id: 'addColumnBefore', label: '左侧加列' }, { id: 'addColumnAfter', label: '右侧加列' }, { id: 'deleteColumn', label: '删列' },
  { id: 'mergeCells', label: '合并单元格' }, { id: 'splitCell', label: '拆分单元格' }, { id: 'toggleHeaderRow', label: '表头行' },
  { id: 'toggleHeaderColumn', label: '表头列' }, { id: 'clearCellContent', label: '清空单元格' }, { id: 'distributeColumns', label: '均分列宽' }, { id: 'deleteTable', label: '删除表格' },
]
const blockActions = [
  { id: 'cut', label: '剪切' }, { id: 'copy', label: '复制' }, { id: 'translate', label: '翻译' },
  { id: 'duplicate', label: '创建副本' }, { id: 'moveUp', label: '上移区块' }, { id: 'moveDown', label: '下移区块' }, { id: 'delete', label: '删除区块' },
]
const blockTypeActions = [
  { id: 'paragraph', label: '转为正文', glyph: 'T' }, { id: 'heading1', label: '转为一级标题', glyph: 'H1' }, { id: 'heading2', label: '转为二级标题', glyph: 'H2' }, { id: 'heading3', label: '转为三级标题', glyph: 'H3' },
  { id: 'orderedList', label: '转为有序列表', glyph: '1≡' }, { id: 'bulletList', label: '转为无序列表', glyph: '☷' }, { id: 'taskList', label: '转为任务列表', glyph: '☑' }, { id: 'codeBlock', label: '转为代码块', glyph: '{}' }, { id: 'blockquote', label: '转为引用', glyph: '❝' },
]
const COLOR_PALETTE_OPTIONS = [
  { label: '墨绿', value: '#263b35' }, { label: '薄荷绿', value: '#d8f3e5' }, { label: '青绿', value: '#00b887' },
  { label: '天空蓝', value: '#dbeafe' }, { label: '靛蓝', value: '#586bff' }, { label: '暖黄', value: '#fff2a8' },
  { label: '橙色', value: '#ffb35c' }, { label: '珊瑚红', value: '#f58a8a' }, { label: '淡紫', value: '#eadcff' },
]

export default {
  name: 'FeishuDocumentEditor',
  components: { EditorContent, CommandMenu },
  props: {
    value: { type: String, default: '<p></p>' }, title: { type: String, default: '' }, readonly: { type: Boolean, default: false },
    config: { type: Object, default: () => ({}) }, maxLength: { type: Number, default: null }, imageMaxSize: { type: Number, default: null },
    templates: { type: Array, default: () => [] },
    uploadImage: { type: Function, default: null }, msgId: { type: [Number, String], default: null },
  },
  data() { return {
    editor: null, localTitle: this.title, reading: false, slides: false, fullscreen: false, widthMode: 'standard',
    outlineOpen: window.innerWidth > 760, outline: [], activeHeading: -1, folded: new Set(), wordCount: 0,
    marks, tableActions, blockActions, blockTypeActions, alignNames: { left: '左', center: '居中', right: '右', justify: '两端' }, alignGlyphs: { left: '≡', center: '☷', right: '≣', justify: '▤' },
    headingOpen: false, headingStyle: {}, tableToolsOpen: false, tablePicker: false, tablePickerHover: { rows: 3, cols: 3 }, tableBoundary: { visible: false, hover: null, columnSide: 'before', rowSide: 'before', rowIndex: -1, columnIndex: -1, rowSpan: 1, columnSpan: 1, cellPosition: null, style: { top: '0px', left: '0px', width: '0px', height: '0px' }, columnLineLeft: 0, rowLineTop: 0 }, helpOpen: false,
    menuOpen: false, menuKind: '', menuQuery: '', menuPosition: { left: 20, top: 120 }, menuMaxHeight: '', menuAnchor: null, activeCommandIndex: 0, slashMatch: null, menuTrigger: null,
    bubbleVisible: false, bubblePosition: { left: 20, top: 120 }, bubbleAlignOpen: false, bubbleAlignMenuStyle: {}, savedSelection: null, blockMenuOpen: false, blockTypeMenuOpen: false, blockAlignMenuOpen: false, blockColorMenuOpen: false, blockHandlePosition: { top: 200, left: 0 }, blockMenuStyle: {}, blockAlignMenuStyle: {}, blockColorMenuStyle: {}, handleRange: null, handleHideTimer: null, dragging: null, handlePressed: false, handleHovering: false, dropPosition: null, dropLineTop: 0, columnResize: null,
    calloutEmojiOpen: false, calloutEmojiQuery: '', calloutEmojiCategory: 'all', calloutEmojiRecent: [], calloutToolsPosition: { top: 0, left: 0 },
    colorPaletteOpen: '', colorPalettePosition: { top: 0, left: 0 }, colorPaletteRecent: [], colorPaletteOptions: COLOR_PALETTE_OPTIONS,
    searchOpen: false, searchQuery: '', replacement: '', searchMatches: [], searchIndex: 0,
    mathDialog: '', mathValue: '', mathError: '', emojiDialog: false,
    linkDialog: false, linkValue: '', linkText: '', linkInsertMode: false,
    emojiItems: [
      { value: 'smile', label: '微笑', glyph: '😄', category: '常用' }, { value: 'heart', label: '爱心', glyph: '❤️', category: '常用' },
      { value: 'thumbsup', label: '点赞', glyph: '👍', category: '常用' }, { value: 'tada', label: '庆祝', glyph: '🎉', category: '常用' },
      { value: 'pin', label: '图钉', glyph: '📌', category: '常用' }, { value: 'warning', label: '警告', glyph: '⚠️', category: '提示' },
      { value: 'check', label: '完成', glyph: '✅', category: '状态' }, { value: 'comment', label: '讨论', glyph: '💬', category: '沟通' },
      { value: 'target', label: '目标', glyph: '🎯', category: '目标' }, { value: 'fire', label: '重点', glyph: '🔥', category: '重点' },
      { value: 'star', label: '星星', glyph: '🌟', category: '重点' },
    ],
    error: '', slideIndex: 0, pendingHTML: null, htmlSeeded: false,
    pendingStateFrame: null, pendingChangeTimer: null,
  } },
  computed: {
    // ECS 的 ref.html 与新页面 v-model 使用同一正文，保留原调用方的读写契约。
    feishuConfig() { return mergeLegacyConfig(this.config, { maxLength: this.maxLength, imageMaxSize: this.imageMaxSize }) },
    effectiveMaxLength() { return Math.max(0, Number(this.feishuConfig.limits.maxLength) || 0) },
    effectiveImageMaxSize() { return this.feishuConfig.limits.maxImageSize },
    titleLength() { return this.feishuConfig.limits.titleLength },
    visibleMarks() { return this.feishuConfig.features.marks ? this.marks : [] },
    visibleTableActions() { return this.feishuConfig.features.tables ? this.tableActions : [] },
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
    effectiveReadonly() { return this.readonly || this.reading || this.slides },
    filteredCommands() { return filterCommands(this.menuQuery, this.menuKind || 'slash', this.feishuConfig) },
    activeCommandId() { return this.filteredCommands[this.activeCommandIndex]?.id || '' },
    calloutEmojiCategories() { return [...new Set(this.emojiItems.map(item => item.category).filter(Boolean))] },
    filteredCalloutEmojiItems() {
      const query = this.calloutEmojiQuery.toLocaleLowerCase()
      const recent = this.calloutEmojiRecent.map(value => this.emojiItems.find(item => item.value === value)).filter(Boolean)
      const source = this.calloutEmojiCategory === 'recent' ? recent : this.calloutEmojiCategory === 'all' ? this.emojiItems : this.emojiItems.filter(item => item.category === this.calloutEmojiCategory)
      return source.filter(item => !query || `${item.label} ${item.value} ${item.glyph}`.toLocaleLowerCase().includes(query))
    },
    colorPaletteTitle() {
      return { textColor: '文字颜色', textBackground: '背景颜色', calloutColor: '高亮块文字颜色', calloutBackground: '高亮块背景颜色', calloutBorder: '高亮块边框颜色' }[this.colorPaletteOpen] || '颜色'
    },
    colorPaletteStyle() {
      const width = 232
      return { top: `${Math.max(8, Math.min(window.innerHeight - 260, this.colorPalettePosition.top))}px`, left: `${Math.max(8, Math.min(window.innerWidth - width - 8, this.colorPalettePosition.left))}px` }
    },
    hasTextSelection() { return !!this.editor && !this.editor.state.selection.empty },
    currentBlockLabel() { if (!this.editor) return '正文'; const level = this.editor.getAttributes('heading').level; return this.editor.isActive('heading') ? `H${level}` : '正文' },
    menuStyle() { return { left: `${this.menuPosition.left}px`, top: `${this.menuPosition.top}px`, ...(this.menuMaxHeight ? { maxHeight: `${this.menuMaxHeight}px` } : {}) } },
    bubbleStyle() { return { left: `${this.bubblePosition.left}px`, top: `${this.bubblePosition.top}px` } },
    blockHandleStyle() { return { top: `${this.blockHandlePosition.top}px`, left: `${this.blockHandlePosition.left}px` } },
    handleIsEmptyParagraph() {
      if (!this.editor || !this.handleRange) return false
      const node = this.editor.state.doc.nodeAt(this.handleRange.from)
      return this.handleBlockNode() === node && node?.type.name === 'paragraph' && node.content.size === 0
    },
    handleIsTaskList() {
      if (!this.editor || !this.handleRange) return false
      const node = this.editor.state.doc.nodeAt(this.handleRange.from)
      return ['taskList', 'taskItem'].includes(node?.type?.name)
    },
    handleGlyph() {
      if (!this.editor || !this.handleRange) return '＋'
      const doc = this.editor.state.doc
      const directNode = doc.nodeAt(this.handleRange.from)
      const node = this.handleBlockNode() || directNode
      const glyphs = { paragraph: 'T', heading: 'H', bulletList: '•', orderedList: '1≡', taskList: '☑', listItem: '•', blockquote: '❝', codeBlock: '{}', horizontalRule: '≡', callout: '▤', details: '▾', columns: 'Ⅱ', table: '▦', image: '▧' }
      if (node?.type.name === 'listItem') {
        const $pos = doc.resolve(Math.min(doc.content.size, this.handleRange.from + 1))
        for (let depth = $pos.depth; depth > 0; depth -= 1) {
          const name = $pos.node(depth).type.name
          if (name === 'taskList' || name === 'orderedList' || name === 'bulletList') return glyphs[name]
        }
      }
      if (node?.type?.name === 'heading') return `H${node.attrs?.level || 1}`
      return glyphs[node?.type?.name] || 'T'
    },
    activeCalloutVisible() { return this.writable() && !!this.activeCalloutElement() },
    calloutToolsStyle() { return { top: `${this.calloutToolsPosition.top}px`, left: `${this.calloutToolsPosition.left}px` } },
    tableHeaderState() {
      if (!this.editor || !this.editor.isActive('table')) return { row: false, column: false }
      const table = this.activeTableNode()
      if (!table || !table.childCount) return { row: false, column: false }
      const row = table.child(0)
      const rowHeader = row.childCount > 0 && Array.from({ length: row.childCount }, (_, index) => row.child(index).type.name === 'tableHeader').every(Boolean)
      const columnHeader = Array.from({ length: table.childCount }, (_, index) => {
        const current = table.child(index)
        return current.childCount > 0 && current.child(0).type.name === 'tableHeader'
      }).every(Boolean)
      return { row: rowHeader, column: columnHeader }
    },
    slideChapters() {
      if (!this.editor) return [{ title: this.localTitle || '文档', text: '' }]
      const headings = this.outline.filter((item) => item.level === 1)
      if (!headings.length) return [{ title: this.localTitle || '文档', text: this.editor.getText() }]
      return headings.map((item, index) => ({ title: item.text || '章节', text: this.editor.state.doc.textBetween(item.pos, headings[index + 1]?.pos || this.editor.state.doc.content.size).replace(item.text, '').trim() }))
    },
  },
  watch: {
    title(value) { if (value !== this.localTitle) this.localTitle = value },
    value(value) { if (this.editor && value !== this.editor.getHTML()) { try { this.setContent(value) } catch (error) { this.error = error.message } } },
    maxLength() { if (this.editor) { this.editor.storage.characterCount.setLimit(this.effectiveMaxLength); this.refreshDocumentState() } },
    config: { deep: true, handler() {
      if (this.editor) this.editor.storage.characterCount.setLimit(this.effectiveMaxLength)
      this.$nextTick(() => this.refreshDocumentState())
    } },
    effectiveReadonly(value) { if (this.editor) { this.editor.setEditable(!value); this.editor.emit('editableUpdate', { editable: !value }); this.closeCommandMenu(); this.headingOpen = false; this.headingStyle = {}; this.blockMenuOpen = false; this.blockTypeMenuOpen = false; this.blockAlignMenuOpen = false; this.blockColorMenuOpen = false; this.blockAlignMenuStyle = {}; this.blockColorMenuStyle = {}; this.clearHandleHighlight(); this.colorPaletteOpen = ''; this.bubbleVisible = false; this.closeBubbleAlignMenu(); if (value) this.tableBoundary.visible = false; else this.$nextTick(() => this.updateTableBoundary()); this.$emit('mode-change', { readonly: value }) } },
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
        content: sanitizeHTML(initialHTML), editable: !this.effectiveReadonly,
        extensions: createFeishuExtensions({ imageView: ImageNode, codeView: CodeNode, maxLength: this.effectiveMaxLength, config: this.feishuConfig, resolveImageFile: this.resolveImageFile, onSlash: this.onSlash, onImageFiles: this.insertImageFiles, onBackspace: () => this.deletePreviousBlockOnBackspace(), onError: (message) => { this.error = message } }),
        onUpdate: () => this.onUpdate(), onTransaction: () => { this.syncFoldState(); this.$nextTick(() => this.syncHandleHighlightBackdrop()) }, onSelectionUpdate: () => this.onSelectionUpdate(),
      })
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
  beforeDestroy() { document.removeEventListener('fullscreenchange', this.onFullscreenChange); window.removeEventListener('keydown', this.onWindowKeydown); window.removeEventListener('scroll', this.onDocumentScroll, true); window.removeEventListener('resize', this.onDocumentScroll); window.removeEventListener('pointerup', this.onHandlePointerUp); window.removeEventListener('pointermove', this.onColumnPointerMove); window.removeEventListener('pointerup', this.onColumnPointerUp); document.removeEventListener('pointerdown', this.onDocumentPointerDown, true); window.removeEventListener('pointermove', this.onDocumentPointerMove, true); clearTimeout(this.handleHideTimer); clearTimeout(this.pendingChangeTimer); if (this.pendingStateFrame) cancelAnimationFrame(this.pendingStateFrame); this.clearHandleHighlight(); this.closeBubbleAlignMenu(); if (this._outlineFrame) cancelAnimationFrame(this._outlineFrame); this.closeCommandMenu(); this.dragging = null },
  destroyed() { this.editor?.destroy(); this.editor = null },
  methods: {
    featureEnabled(name) { return isConfigEnabled(this.feishuConfig, name) },
    toolbarEnabled(name) { return this.feishuConfig.toolbar[name] !== false && this.featureEnabled(name) },
    isBlockActionEnabled(id) { return isBlockActionEnabled(this.feishuConfig, id) },
    getEditor() { return this.editor }, getHTML() { return this.editor?.getHTML() || '' }, getJSON() { return this.editor?.getJSON() || null }, getText() { return this.editor?.getText() || '' },
    focus() { this.editor?.commands.focus() },
    setContent(content) {
      if (!this.editor) return false
      const schema = this.editor.schema
      let json
      if (typeof content === 'string') {
        const safe = sanitizeHTML(content)
        const container = document.createElement('div'); container.innerHTML = safe
        json = ProseMirrorDOMParser.fromSchema(schema).parse(container).toJSON()
      } else json = validateDocument(content, schema)
      const next = schema.nodeFromJSON(validateDocument(json, schema))
      // Keep this method usable by the legacy imperative API and small host-side
      // harnesses that call it without Vue's computed properties.
      const maxLength = this.effectiveMaxLength !== undefined
        ? this.effectiveMaxLength
        : Math.max(0, Number(this.maxLength) || 0)
      if (maxLength > 0 && this.editor.storage.characterCount.characters({ node: next }) > maxLength) throw new Error(`正文不能超过 ${maxLength} 字`)
      if (next.eq(this.editor.state.doc)) return false
      // 使用普通事务替换正文，让本地历史可撤销模板、导入与快照恢复。
      const tr = this.editor.state.tr.replaceWith(0, this.editor.state.doc.content.size, next.content)
      this.editor.view.dispatch(tr)
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
      if (from < 0 || from >= to || to > doc.content.size) { this.handleRange = null; return }
      const start = doc.resolve(from)
      const end = doc.resolve(to)
      if (!start.sameParent(end) || start.textOffset || end.textOffset || from !== start.posAtIndex(start.index(), start.depth) || to !== end.posAtIndex(end.index(), end.depth)) this.handleRange = null
      else this.positionBlockHandle(this.handleRange)
    },
    refreshDocumentState() {
      if (!this.editor) return
      this.outline = collectOutline(this.editor.state.doc)
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
    setHeading(level) { if (!this.featureEnabled('headings')) return; this.headingOpen = false; this.headingStyle = {}; if (level) this.run('setHeading', { level }); else this.run('setParagraph') },
    toggleHeadingMenu() {
      if (!this.writable()) return
      this.headingOpen = !this.headingOpen
      this.headingStyle = {}
      this.menuOpen = false
      if (this.headingOpen) this.$nextTick(() => this.positionHeadingMenu())
    },
    positionHeadingMenu() {
      if (!this.headingOpen) return
      const root = this.$refs.root
      const trigger = root?.querySelector('.feishu-heading-tool > button')
      const menu = root?.querySelector('.feishu-dropdown')
      if (!trigger || !menu) return
      const margin = 8
      const triggerRect = trigger.getBoundingClientRect()
      const menuRect = menu.getBoundingClientRect()
      const viewportSpace = Math.max(40, window.innerHeight - margin * 2)
      const naturalHeight = Math.max(menu.scrollHeight, menuRect.height)
      const desiredHeight = Math.min(naturalHeight, viewportSpace)
      const below = Math.max(0, window.innerHeight - triggerRect.bottom - margin)
      const above = Math.max(0, triggerRect.top - margin)
      const useAbove = below < desiredHeight && above > below
      const available = useAbove ? above : below
      const maxHeight = Math.max(40, Math.min(desiredHeight, available || viewportSpace))
      const top = useAbove ? triggerRect.top - maxHeight - 6 : triggerRect.bottom + 6
      const width = Math.min(menuRect.width || 155, window.innerWidth - margin * 2)
      const left = Math.max(margin, Math.min(window.innerWidth - width - margin, triggerRect.left))
      this.headingStyle = { top: `${Math.max(margin, Math.min(window.innerHeight - maxHeight - margin, top))}px`, left: `${left}px`, maxHeight: `${maxHeight}px`, marginTop: '0px' }
    },
    setTextStyle(attribute, value) { if (!value) return; const command = `set${attribute[0].toUpperCase()}${attribute.slice(1)}`; this.run(command, value) },
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
    bubbleAlignNode() {
      if (!this.editor || this.editor.state.selection.node) return null
      const { $from } = this.editor.state.selection
      for (let depth = $from.depth; depth > 0; depth -= 1) {
        const node = $from.node(depth)
        if (node.type.name === 'paragraph' || node.type.name === 'heading') return node
      }
      return null
    },
    bubbleAlignValue() { return this.bubbleAlignNode()?.attrs?.textAlign || 'left' },
    bubbleAlignIndent() { return Number(this.bubbleAlignNode()?.attrs?.indent) || 0 },
    bubbleAlignTooltip(id) {
      const shortcuts = { left: '⌘ + Shift + L', center: '⌘ + Shift + E', right: '⌘ + Shift + R', justify: '⌘ + Shift + J' }
      if (shortcuts[id]) return shortcuts[id]
      if (id === 'increaseIndent' && this.bubbleAlignIndent() >= 8) return '当前内容块已达最大缩进层级'
      if (id === 'decreaseIndent' && this.bubbleAlignIndent() <= 0) return '当前内容块已达最小缩进层级'
      return id === 'increaseIndent' ? '增加缩进' : '减少缩进'
    },
    openBubbleAlignMenu() {
      if (!this.bubbleVisible || !this.writable()) return
      if (this.bubbleAlignOpen) { this.$nextTick(() => this.positionBubbleAlignMenu()); return }
      this.bubbleAlignOpen = true
      this.bubbleAlignMenuStyle = {}
      this.$nextTick(() => this.positionBubbleAlignMenu())
    },
    closeBubbleAlignMenu() {
      this.bubbleAlignOpen = false
      this.bubbleAlignMenuStyle = {}
    },
    positionBubbleAlignMenu() {
      if (!this.bubbleAlignOpen) return
      const root = this.$refs.root
      const trigger = root?.querySelector('.feishu-bubble-align-trigger')
      const menu = root?.querySelector('.feishu-bubble-align-menu')
      if (!trigger || !menu) return
      const margin = 8
      const gap = 6
      const triggerRect = trigger.getBoundingClientRect()
      const menuRect = menu.getBoundingClientRect()
      const width = menuRect.width || 230
      const below = Math.max(0, window.innerHeight - triggerRect.bottom - margin)
      const above = Math.max(0, triggerRect.top - margin)
      const useAbove = below < menuRect.height && above > below
      const naturalTop = useAbove ? triggerRect.top - menuRect.height - gap : triggerRect.bottom + gap
      const left = Math.max(margin, Math.min(window.innerWidth - width - margin, triggerRect.left))
      const top = Math.max(margin, Math.min(window.innerHeight - menuRect.height - margin, naturalTop))
      this.bubbleAlignMenuStyle = { left: `${Math.round(left)}px`, top: `${Math.round(top)}px` }
    },
    bubbleAlignAction(id) {
      if (!this.writable()) return
      if (id === 'increaseIndent') this.changeIndent(1)
      else if (id === 'decreaseIndent') this.changeIndent(-1)
      else this.setAlign(id)
      this.closeBubbleAlignMenu()
    },
    blockTextblockTarget(range) {
      if (!range || !this.editor) return null
      const doc = this.editor.state.doc
      const probe = Math.min(doc.content.size, Math.max(0, range.from + 1))
      const $pos = doc.resolve(probe)
      for (let depth = $pos.depth; depth > 0; depth -= 1) {
        const node = $pos.node(depth)
        if (node.type.name === 'paragraph' || node.type.name === 'heading') return { node, pos: $pos.before(depth) }
      }
      const node = doc.nodeAt(range.from)
      return node && (node.type.name === 'paragraph' || node.type.name === 'heading') ? { node, pos: range.from } : null
    },
    applyBlockAttribute(target, name, value) {
      if (!this.writable() || !target?.node || value === null || value === undefined) return false
      const attrs = { ...target.node.attrs, [name]: value }
      const tr = this.editor.state.tr.setNodeMarkup(target.pos, target.node.type, attrs)
      if (!tr.docChanged) return false
      this.editor.view.dispatch(tr)
      this.editor.view.focus()
      this.$nextTick(() => this.positionBlockHandle(this.handleRange || this.currentBlockRange()))
      return true
    },
    blockAlignNode() {
      const range = this.handleActionRange()
      return this.blockTextblockTarget(range)?.node || null
    },
    blockAlignValue() { return this.blockAlignNode()?.attrs?.textAlign || 'left' },
    blockAlignIndent() { return Number(this.blockAlignNode()?.attrs?.indent) || 0 },
    clearFormatting() { if (!this.writable()) return; this.restoreSelection(); this.editor.chain().focus().unsetAllMarks().clearNodes().run() },
    openCommandMenu(kind, event) {
      if (!this.writable() || !this.featureEnabled('insert')) return
      if (this.menuOpen && this.menuKind === kind) { this.closeCommandMenu(true); return }
      this.rememberSelection(kind === 'plus')
      this.menuKind = kind
      this.menuTrigger = event?.currentTarget || null
      this.menuQuery = kind === 'slash' ? this.slashMatch?.query || '' : ''
      this.activeCommandIndex = 0
      const rect = event?.currentTarget?.getBoundingClientRect()
      this.menuAnchor = { left: rect?.left ?? 30, top: rect?.top ?? 90, bottom: rect?.bottom ?? 120 }
      this.menuPosition = { left: Math.max(8, this.menuAnchor.left), top: Math.max(8, this.menuAnchor.bottom + 6) }
      this.menuMaxHeight = ''
      this.menuOpen = true
      this.headingOpen = false
      this.headingStyle = {}
      this.blockMenuOpen = false
      this.blockTypeMenuOpen = false
      this.blockAlignMenuOpen = false
      this.blockColorMenuOpen = false
      this.blockAlignMenuStyle = {}
      this.blockColorMenuStyle = {}
      this.$nextTick(() => {
        this.positionCommandMenu()
        if (kind === 'plus') this.$children.find((child) => child.$options.name === 'FeishuCommandMenu')?.focusSearch()
      })
    },
    onSlash(match) {
      if (this._isDestroyed) return
      if (!this.featureEnabled('insert')) { this.closeCommandMenu(); return }
      this.slashMatch = match
      if (!match || !this.writable()) { if (this.menuKind === 'slash') this.closeCommandMenu(); return }
      const coords = this.editor.view.coordsAtPos(match.from)
      this.menuKind = 'slash'
      this.menuQuery = match.query
      this.activeCommandIndex = 0
      this.menuAnchor = { left: coords.left, top: coords.top, bottom: coords.bottom }
      this.menuPosition = { left: Math.max(8, coords.left), top: Math.max(8, coords.bottom + 6) }
      this.menuMaxHeight = ''
      this.menuOpen = true
      this.$nextTick(() => this.positionCommandMenu())
    },
    positionCommandMenu() {
      if (!this.menuOpen || !this.menuAnchor) return
      if (this.menuTrigger?.getBoundingClientRect) {
        const triggerRect = this.menuTrigger.getBoundingClientRect()
        this.menuAnchor = { left: triggerRect.left, top: triggerRect.top, bottom: triggerRect.bottom }
      } else if (this.menuKind === 'slash' && this.slashMatch && this.editor) {
        const coords = this.editor.view.coordsAtPos(this.slashMatch.from)
        this.menuAnchor = { left: coords.left, top: coords.top, bottom: coords.bottom }
      }
      const menu = this.$refs.root?.querySelector('.feishu-command-menu')
      if (!menu) return
      const margin = 8
      const rect = menu.getBoundingClientRect()
      const viewportSpace = Math.max(40, window.innerHeight - margin * 2)
      const naturalHeight = Math.max(menu.scrollHeight, rect.height)
      const desiredHeight = Math.min(naturalHeight, viewportSpace)
      const below = Math.max(0, window.innerHeight - this.menuAnchor.bottom - margin)
      const above = Math.max(0, this.menuAnchor.top - margin)
      const useAbove = below < desiredHeight && above > below
      const available = useAbove ? above : below
      const maxHeight = Math.max(40, Math.min(desiredHeight, available || viewportSpace))
      const rawTop = useAbove ? this.menuAnchor.top - maxHeight - 6 : this.menuAnchor.bottom + 6
      const top = Math.max(margin, Math.min(window.innerHeight - maxHeight - margin, rawTop))
      const width = Math.min(rect.width || (this.menuKind === 'plus' ? 470 : 280), window.innerWidth - margin * 2)
      const left = Math.max(margin, Math.min(window.innerWidth - width - margin, this.menuAnchor.left))
      this.menuPosition = { left, top }
      this.menuMaxHeight = Math.round(maxHeight)
    },
    closeCommandMenu(restoreFocus = false) {
      this.menuOpen = false
      this.menuKind = ''
      this.menuTrigger = null
      this.menuAnchor = null
      this.menuMaxHeight = ''
      this.slashMatch = null
      if (restoreFocus) {
        // 菜单按钮点击会先夺走焦点；结构命令提交前同步回到编辑器，避免紧接着输入落到 body。
        this.focus()
        this.$nextTick(() => this.focus())
      }
    },
    moveCommand(step) { const length = this.filteredCommands.length; if (length) this.activeCommandIndex = (this.activeCommandIndex + step + length) % length },
    onEditorKeydown(event) { if (event.isComposing || this.editor?.view.composing || !this.menuOpen) return; if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); this.moveCommand(event.key === 'ArrowDown' ? 1 : -1) } else if (event.key === 'Enter') { event.preventDefault(); this.chooseCommand(this.filteredCommands[this.activeCommandIndex]) } else if (event.key === 'Escape') { event.preventDefault(); this.closeCommandMenu() } },
    chooseCommand(item) {
      if (!item || !this.writable()) return
      const isSlashTable = this.menuKind === 'slash' && item.id === 'table'
      const isTableSize = item.id === 'table' && item.tableSize
      const isTemplateSelection = item.id === 'template' && !!item.templateId
      const focusAfter = isTemplateSelection || !['table', 'image', 'inlineMath', 'blockMath', 'emoji', 'link', 'template', 'ai'].includes(item.id)
      if (this.menuKind === 'plus') this.restoreSelection(true)
      if (this.menuKind === 'slash' && this.slashMatch) { const { from, to } = this.slashMatch; const tr = this.editor.state.tr.delete(from, to); tr.setSelection(TextSelection.create(tr.doc, from)); this.editor.view.dispatch(tr); this.savedSelection = null }
      this.closeCommandMenu(focusAfter)
      if (isSlashTable) this.insertTable(3, 3)
      else if (isTableSize) this.insertTable(item.tableSize.rows, item.tableSize.cols)
      else this.executeCommand(item.id, item.templateId)
      if (focusAfter) {
        this.focus()
        this.$nextTick(() => this.focus())
      }
    },
    executeCommand(id, templateId = '') {
      if (!this.writable()) return
      const feature = id === 'table' ? 'tables' : id === 'image' ? 'images' : id === 'code' ? 'codeBlocks' : id === 'callout' ? 'callouts' : id === 'columns' || /^columns[2-5]$/.test(id) ? 'columns' : id === 'inlineMath' || id === 'blockMath' ? 'math' : id === 'emoji' ? 'emoji' : id === 'template' ? 'templates' : id === 'ai' ? 'ai' : 'blockStyle'
      if (!isCommandEnabled(this.feishuConfig, id, feature)) return
      if (id === 'paragraph') this.run('setParagraph')
      else if (/^heading[1-9]$/.test(id)) this.run('setHeading', { level: Number(id.slice(-1)) })
      else if (id === 'bulletList') this.run('toggleBulletList')
      else if (id === 'orderedList') this.run('toggleOrderedList')
      else if (id === 'taskList') this.run('toggleTaskList')
      else if (id === 'blockquote') this.run('toggleBlockquote')
      else if (id === 'divider') this.run('setHorizontalRule')
      else if (id === 'details') this.run('setDetails')
      else if (id === 'code') this.run('setCodeBlock')
      else if (id === 'callout') this.run('insertContent', { type: 'callout', content: [{ type: 'paragraph' }] })
      else if (id === 'columns') this.executeCommand('columns2')
      else if (/^columns[2-5]$/.test(id)) { const count = Number(id.slice(-1)); this.run('insertContent', { type: 'columns', content: Array.from({ length: count }, () => ({ type: 'column', attrs: { width: Math.round(100 / count) }, content: [{ type: 'paragraph' }] })) }) }
      else if (id === 'table') this.tablePicker = true
      else if (id === 'image') this.$refs.imageInput.click()
      else if (id === 'inlineMath' || id === 'blockMath') { this.mathDialog = id; this.mathValue = ''; this.mathError = ''; this.$nextTick(() => this.$refs.mathInput?.focus()) }
      else if (id === 'emoji') this.emojiDialog = true
      else if (id === 'link') this.openLinkDialog(true)
      else if (id === 'template') {
        const template = this.templates.find(item => item.id === templateId)
        if (template) this.run('insertContent', template.html)
        else this.error = '模板不可用，请重新打开模板列表'
      }
      else if (id === 'ai') this.$emit('ai-request', 'rewrite')
      if (id === 'details') {
        let detailsPos = null
        this.editor.state.doc.descendants((node, pos) => { if (detailsPos === null && node.type.name === 'details') detailsPos = pos })
        if (detailsPos !== null) {
          this.editor.commands.setTextSelection(Math.min(this.editor.state.doc.content.size, detailsPos + 2))
          this.editor.commands.focus()
        }
      }
    },
    previewTableSize(rows, cols) { if (!this.tablePicker) return; this.tablePickerHover = { rows, cols } },
    insertTable(rows, cols) { if (!this.writable() || !this.featureEnabled('tables')) return; this.tablePicker = false; this.tablePickerHover = { rows: 3, cols: 3 }; this.run('insertTable', { rows, cols, withHeaderRow: false }); this.$nextTick(() => this.updateTableBoundary()) },
    activeTableElement() {
      if (!this.editor || !this.editor.isActive('table')) return null
      const { $from } = this.editor.state.selection
      for (let depth = $from.depth; depth > 0; depth -= 1) {
        if ($from.node(depth).type.name !== 'table') continue
        const element = this.editor.view.nodeDOM($from.before(depth))
        return element instanceof HTMLElement ? element : null
      }
      return null
    },
    updateTableBoundary() {
      if (!this.writable()) { this.tableBoundary.visible = false; return }
      const table = this.activeTableElement()
      const paper = this.$refs.root?.querySelector('.feishu-paper')
      if (!table || !paper) { this.tableBoundary.visible = false; return }
      const tableRect = table.getBoundingClientRect()
      const paperRect = paper.getBoundingClientRect()
      if (tableRect.width < 1 || tableRect.height < 1) {
        this.tableBoundary.visible = false
        if (!this._tableBoundaryRetry) {
          this._tableBoundaryRetry = true
          requestAnimationFrame(() => { this._tableBoundaryRetry = false; this.updateTableBoundary() })
        }
        return
      }
      const domAtSelection = this.editor.view.domAtPos(this.editor.state.selection.from).node
      const selectionElement = domAtSelection?.nodeType === 1 ? domAtSelection : domAtSelection?.parentElement
      const cell = selectionElement?.closest?.('td,th')
      const cellRect = cell?.getBoundingClientRect?.()
      this.tableBoundary = {
        visible: true,
        hover: this.tableBoundary.hover,
        columnSide: this.tableBoundary.columnSide,
        rowSide: this.tableBoundary.rowSide,
        style: {
          top: `${tableRect.top - paperRect.top}px`,
          left: `${tableRect.left - paperRect.left}px`,
          width: `${tableRect.width}px`,
          height: `${tableRect.height}px`,
        },
        columnLineLeft: cellRect ? cellRect.left - tableRect.left + cellRect.width / 2 : tableRect.width / 2,
        rowLineTop: cellRect ? cellRect.top - tableRect.top + cellRect.height / 2 : tableRect.height / 2,
      }
    },
    clearTableBoundaryHover() {
      if (this.tableBoundary.hover) this.tableBoundary.hover = null
    },
    keepTableBoundaryHover() {
      if (this.writable() && this.editor?.isActive('table')) return
      this.clearTableBoundaryHover()
    },
    updateTableBoundaryHover(event) {
      if (!this.writable() || !this.editor?.isActive('table')) { this.clearTableBoundaryHover(); return }
      const table = this.activeTableElement()
      const cell = event.target?.closest?.('td,th')
      if (!table || !cell || !table.contains(cell)) { this.clearTableBoundaryHover(); return }
      const rect = cell.getBoundingClientRect()
      const tableRect = table.getBoundingClientRect()
      const threshold = 9
      const x = event.clientX
      const y = event.clientY
      const row = cell.parentElement
      const rows = table.querySelectorAll('tr')
      const rowIndex = row ? Array.from(rows).indexOf(row) : -1
      const columnIndex = Number.isInteger(cell.cellIndex) ? cell.cellIndex : -1
      const paragraph = cell.querySelector('p')
      const cellPosition = paragraph ? this.editor.view.posAtDOM(paragraph, 0) : null
      const rowSpan = Math.max(1, cell.rowSpan || 1)
      const columnSpan = Math.max(1, cell.colSpan || 1)
      const verticalDistance = Math.min(Math.abs(x - rect.left), Math.abs(x - rect.right))
      const horizontalDistance = Math.min(Math.abs(y - rect.top), Math.abs(y - rect.bottom))
      const inVerticalRange = y >= rect.top - threshold && y <= rect.bottom + threshold
      const inHorizontalRange = x >= rect.left - threshold && x <= rect.right + threshold
      if (inVerticalRange && verticalDistance <= threshold && verticalDistance <= horizontalDistance) {
        const left = Math.abs(x - rect.left) <= Math.abs(x - rect.right)
        this.tableBoundary = { ...this.tableBoundary, hover: 'column', columnSide: left ? 'before' : 'after', rowIndex, columnIndex, rowSpan, columnSpan, cellPosition, columnLineLeft: (left ? rect.left : rect.right) - tableRect.left }
        return
      }
      if (inHorizontalRange && horizontalDistance <= threshold) {
        const top = Math.abs(y - rect.top) <= Math.abs(y - rect.bottom)
        this.tableBoundary = { ...this.tableBoundary, hover: 'row', rowSide: top ? 'before' : 'after', rowIndex, columnIndex, rowSpan, columnSpan, cellPosition, rowLineTop: (top ? rect.top : rect.bottom) - tableRect.top }
        return
      }
      this.clearTableBoundaryHover()
    },
    tableBoundaryAction(id) {
      if (!this.writable()) return
      const boundary = { ...this.tableBoundary }
      if (Number.isInteger(boundary.cellPosition)) this.editor.commands.setTextSelection(boundary.cellPosition)
      this.clearTableBoundaryHover()
      // 行/列操作要和相邻的表格变更分开记录，确保每次点击都对应一次撤销。
      this.editor.view.dispatch(closeHistory(this.editor.state.tr))
      this.tableAction(id)
      // Close the structural transaction after it is applied as well, so text typed
      // into the newly created cell starts its own undo group.
      this.editor.view.dispatch(closeHistory(this.editor.state.tr))
      this.$nextTick(() => {
        this.focusTableBoundaryCell(id, boundary)
        this.updateTableBoundary()
      })
    },
    focusTableBoundaryCell(id, boundary) {
      if (!this.writable() || !boundary || boundary.rowIndex < 0 || boundary.columnIndex < 0) return
      const table = this.activeTableElement()
      if (!table) return
      const rowOffset = id === 'addRowAfter' ? boundary.rowSpan : 0
      const columnOffset = id === 'addColumnAfter' ? boundary.columnSpan : 0
      const row = table.querySelectorAll('tr')[boundary.rowIndex + rowOffset]
      const cell = row?.cells[boundary.columnIndex + columnOffset]
      const paragraph = cell?.querySelector('p')
      if (!paragraph) return
      const position = this.editor.view.posAtDOM(paragraph, 0)
      if (Number.isInteger(position)) this.editor.commands.setTextSelection(position)
    },
    tableAction(id) {
      if (!this.writable() || !this.featureEnabled('tables')) return
      if (['addRowBefore', 'addRowAfter', 'deleteRow', 'addColumnBefore', 'addColumnAfter', 'deleteColumn', 'mergeCells', 'splitCell', 'toggleHeaderRow', 'toggleHeaderColumn', 'clearCellContent', 'distributeColumns', 'deleteTable'].includes(id)) this.editor.view.dispatch(closeHistory(this.editor.state.tr))
      const rect = this.editor.isActive('table') ? selectedRect(this.editor.state) : null
      if (id === 'clearCellContent') this.clearCellContent()
      else if (id === 'distributeColumns') this.distributeColumns()
      else if (id === 'deleteRow' && (this.activeTableNode()?.childCount <= 1 || (rect && rect.top === 0 && rect.bottom === rect.map.height))) this.deleteActiveTable()
      else if (id === 'deleteColumn' && (rect?.map.width <= 1 || (rect && rect.left === 0 && rect.right === rect.map.width))) this.deleteActiveTable()
      else this.run(id)
      if (id === 'deleteTable') { this.tableToolsOpen = false; this.tableBoundary.visible = false }
      this.$nextTick(() => this.updateTableBoundary())
    },
    cellAttribute(name, value) { if (value) this.run('setCellAttribute', name, value) },
    activeTableNode() {
      if (!this.editor || !this.editor.isActive('table')) return null
      const { $from } = this.editor.state.selection
      for (let depth = $from.depth; depth > 0; depth -= 1) if ($from.node(depth).type.name === 'table') return $from.node(depth)
      return null
    },
    deleteActiveTable() {
      if (!this.writable() || !this.editor.isActive('table')) return false
      const { $from } = this.editor.state.selection
      for (let depth = $from.depth; depth > 0; depth -= 1) {
        if ($from.node(depth).type.name !== 'table') continue
        const deleted = this.deleteBlockRange({ from: $from.before(depth), to: $from.after(depth) })
        this.tableToolsOpen = false
        this.tableBoundary.visible = false
        return deleted
      }
      return false
    },
    clearCellContent() {
      if (!this.writable() || !this.editor.isActive('table')) return false
      const state = this.editor.state
      const selected = selectedRect(state)
      const cellPositions = selected.map.cellsInRect(selected)
      const paragraph = this.editor.schema.nodes.paragraph?.createAndFill()
      if (!paragraph) return false
      const tr = state.tr
      cellPositions.sort((a, b) => b - a).forEach((cellPos) => {
        const cell = selected.table.nodeAt(cellPos)
        if (!cell || !cell.content.size) return
        const from = selected.tableStart + cellPos + 1
        tr.replaceWith(from, from + cell.content.size, paragraph)
      })
      if (tr.docChanged) this.editor.view.dispatch(tr)
      return tr.docChanged
    },
    distributeColumns() {
      if (!this.writable() || !this.editor.isActive('table')) return false
      const table = this.activeTableNode()
      const selected = selectedRect(this.editor.state)
      if (!table || !selected.map.width) return false
      const tableElement = this.activeTableElement()
      const width = Math.max(70, Math.round((tableElement?.clientWidth || selected.map.width * 120) / selected.map.width))
      const tr = this.editor.state.tr
      const cellPositions = [...new Set(selected.map.map)]
      cellPositions.forEach((cellPos) => {
        const cell = table.nodeAt(cellPos)
        if (cell) tr.setNodeMarkup(selected.tableStart + cellPos, undefined, { ...cell.attrs, colwidth: Array(cell.attrs.colspan || 1).fill(width) })
      })
      if (tr.docChanged) this.editor.view.dispatch(tr)
      return tr.docChanged
    },
    async insertMath() {
      if (!this.writable() || !this.featureEnabled('math')) return
      try {
        const module = await import('katex')
        if (!this.writable() || !this.mathDialog) return
        const katex = module.default || module
        katex.renderToString(this.mathValue, { throwOnError: true, trust: false })
        this.mathError = ''
        this.run('insertContent', { type: this.mathDialog, attrs: { latex: this.mathValue } })
        this.mathDialog = ''
      } catch (_) { this.mathError = '公式无法解析，请检查 LaTeX 语法' }
    },
    insertEmoji(name) { if (!this.writable() || !this.featureEnabled('emoji')) return; if (!this.run('setEmoji', name)) this.error = '无法插入该表情'; this.emojiDialog = false },
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
    updateSearch() { if (!this.editor || !this.featureEnabled('search')) return; this.searchMatches = findTextMatches(this.editor.state.doc, this.searchQuery); this.searchIndex = Math.min(this.searchIndex, Math.max(0, this.searchMatches.length - 1)); if (this.searchMatches.length) { const match = this.searchMatches[this.searchIndex]; this.editor.commands.revealFeishuMatch(match.from, match.to) } this.editor.commands.setFeishuSearch(this.searchQuery, this.searchIndex) },
    nextMatch(step) { if (!this.searchMatches.length) return; this.searchIndex = (this.searchIndex + step + this.searchMatches.length) % this.searchMatches.length; const match = this.searchMatches[this.searchIndex]; this.editor.commands.revealFeishuMatch(match.from, match.to); this.editor.commands.setFeishuSearch(this.searchQuery, this.searchIndex); this.editor.commands.setTextSelection(match); this.editor.view.domAtPos(match.from).node.parentElement?.scrollIntoView({ block: 'center' }) },
    replace(all) {
      if (!this.writable() || !this.searchQuery) return
      if (all) { replaceText(this.editor, this.searchQuery, this.replacement, true) } else {
        const match = this.searchMatches[this.searchIndex]
        if (!match) return
        const tr = this.editor.state.tr
        const marks = tr.doc.resolve(match.from).marks()
        if (this.replacement) tr.replaceWith(match.from, match.to, this.editor.schema.text(this.replacement, marks))
        else tr.delete(match.from, match.to)
        this.editor.view.dispatch(tr)
      }
      this.updateSearch()
    },
    closeSearch() { this.searchOpen = false; this.searchQuery = ''; this.searchMatches = []; this.editor?.commands.setFeishuSearch(''); this.focus() },
    toggleFold(pos) { if (!this.featureEnabled('folding')) return; this.editor?.commands.toggleFeishuFold(pos); this.folded = new Set(this.editor.storage.feishuDocument.folded) },
    jumpHeading(pos) { this.editor?.commands.setTextSelection(pos + 1); this.editor?.view.domAtPos(pos + 1).node.parentElement?.scrollIntoView({ behavior: 'smooth', block: 'start' }); this.activeHeading = pos },
    currentBlockRange() {
      if (!this.editor) return null
      const { selection } = this.editor.state
      if (selection.node) return { from: selection.from, to: selection.to }
      return this.rangeAt(selection.from, selection.to)
    },
    handleActionRange() {
      const selected = this.currentBlockRange()
      if (!selected) return this.handleRange
      const { selection, doc } = this.editor.state
      if (!selection.empty) {
        const start = doc.resolve(selected.from)
        const end = doc.resolve(selected.to)
        if (start.sameParent(end) && end.index() - start.index() > 1) return selected
      }
      return this.handleRange || selected
    },
    rangeAt(from, to = from) {
      const doc = this.editor.state.doc
      const $from = doc.resolve(from)
      const $to = doc.resolve(to)
      const containers = new Set(['doc', 'column', 'callout', 'detailsContent', 'bulletList', 'orderedList', 'taskList', 'columns', 'table', 'codeBlock', 'horizontalRule', 'image', 'details'])
      for (let depth = $from.depth; depth >= 1; depth -= 1) {
        if ($from.node(depth).type.name !== 'table' || $from.node(depth) !== $to.node(depth)) continue
        // 飞书把表格作为一个区块操作，表格内的行不能抢走左侧区块句柄。
        return { from: $from.before(depth), to: $from.after(depth), parentDepth: depth - 1 }
      }
      for (let depth = Math.min($from.depth, $to.depth); depth >= 0; depth -= 1) {
        if ($from.node(depth) !== $to.node(depth) || !containers.has($from.node(depth).type.name)) continue
        const startIndex = $from.index(depth)
        const endIndex = Math.min($from.node(depth).childCount, $to.index(depth) + Number($to.pos > $to.posAtIndex($to.index(depth), depth)))
        if (startIndex >= $from.node(depth).childCount) return null
        return { from: $from.posAtIndex(startIndex, depth), to: $from.posAtIndex(Math.max(startIndex + 1, endIndex), depth), parentDepth: depth }
      }
      return null
    },
    positionBlockHandle(range) {
      if (!range) return
      const dom = this.editor.view.nodeDOM(range.from)
      const paper = this.$refs.root?.querySelector('.feishu-paper')
      if (!(dom instanceof Element) || !paper) return
      clearTimeout(this.handleHideTimer)
      this.handleRange = range
      if (this.handleHovering || this.handlePressed || this.dragging || this.blockMenuOpen) this.setHandleHighlight(true)
      const callout = dom.closest?.('[data-type="callout"]')
      const anchor = callout instanceof Element ? callout : dom
      const domRect = anchor.getBoundingClientRect()
      const paperRect = paper.getBoundingClientRect()
      const isHeading = /^H[1-6]$/.test(anchor.tagName) || anchor.matches?.('[data-type="heading"]')
      const isCallout = anchor.matches?.('[data-type="callout"]')
      this.blockHandlePosition = {
        // Feishu centers the H1–H9 handle on the heading line. Keep other
        // block handles anchored to their block start so tables and callouts
        // do not shift when their first line is taller than the handle.
        top: Math.max(10, domRect.top - paperRect.top + (isHeading ? Math.max(0, (domRect.height - 26) / 2) : 0)),
        // Keep the narrow handle immediately before the fold widget and the
        // text, regardless of paper padding or viewport width.
        left: Math.round(domRect.left - paperRect.left - (isCallout ? 51 : 70)),
      }
    },
    columnsRangeFor(range) {
      if (!range || !this.editor) return null
      const doc = this.editor.state.doc
      const probes = [range.from, range.from + 1, Math.max(range.from, range.to - 1)]
      for (const probe of probes) {
        const $from = doc.resolve(Math.min(doc.content.size, Math.max(0, probe)))
        for (let depth = $from.depth; depth >= 1; depth -= 1) {
          if ($from.node(depth).type.name === 'columns') return { from: $from.before(depth), to: $from.after(depth), parentDepth: depth - 1 }
        }
      }
      return null
    },
    detailsRangeFor(range) {
      if (!range || !this.editor || this.editor.state.doc.nodeAt(range.from)?.type.name !== 'detailsSummary') return null
      const doc = this.editor.state.doc
      const $from = doc.resolve(Math.min(doc.content.size, Math.max(0, range.from + 1)))
      for (let depth = $from.depth; depth >= 1; depth -= 1) {
        if ($from.node(depth).type.name === 'details') return { from: $from.before(depth), to: $from.after(depth), parentDepth: depth - 1 }
      }
      return null
    },
    handleBlockNode() {
      if (!this.editor || !this.handleRange) return null
      const doc = this.editor.state.doc
      const direct = doc.nodeAt(this.handleRange.from)
      if (!direct || direct.type.name !== 'paragraph' || this.handleRange.parentDepth <= 0) return direct
      const parent = doc.resolve(this.handleRange.from).node(this.handleRange.parentDepth)
      return ['callout', 'details', 'columns', 'column'].includes(parent.type.name) ? parent : direct
    },
    handleHighlightRange() {
      if (!this.editor || !this.handleRange) return null
      const node = this.editor.state.doc.nodeAt(this.handleRange.from)
      if (node?.type.name === 'heading') {
        const section = foldedRange(this.editor.state.doc, this.handleRange.from)
        if (section) return { from: this.handleRange.from, to: section.to, section: true }
      }
      return { from: this.handleRange.from, to: this.handleRange.to }
    },
    syncHandleHighlightBackdrop() {
      const root = this.editor?.view?.dom
      if (!root) return
      const sectionNodes = root.querySelectorAll('.feishu-heading-section-hovered')
      if (!sectionNodes.length) {
        root.classList.remove('feishu-has-heading-handle-hover')
        root.style.removeProperty('--feishu-heading-hover-left')
        root.style.removeProperty('--feishu-heading-hover-top')
        root.style.removeProperty('--feishu-heading-hover-width')
        root.style.removeProperty('--feishu-heading-hover-height')
        return
      }
      const first = sectionNodes[0].getBoundingClientRect()
      const last = sectionNodes[sectionNodes.length - 1].getBoundingClientRect()
      const rootRect = root.getBoundingClientRect()
      root.style.setProperty('--feishu-heading-hover-left', `${first.left - rootRect.left}px`)
      root.style.setProperty('--feishu-heading-hover-top', `${first.top - rootRect.top}px`)
      root.style.setProperty('--feishu-heading-hover-width', `${Math.max(first.right, last.right) - first.left}px`)
      root.style.setProperty('--feishu-heading-hover-height', `${last.bottom - first.top}px`)
      root.classList.add('feishu-has-heading-handle-hover')
    },
    clearHandleHighlight() {
      if (!this.editor || this.editor.isDestroyed || !this.editor.commands?.setFeishuHandleHover) return
      const current = this.editor.storage.feishuDocument?.handleHover
      if (current) this.editor.commands.setFeishuHandleHover(null)
      this.$nextTick(() => this.syncHandleHighlightBackdrop())
    },
    setHandleHighlight(active) {
      if (!this.editor || this.editor.isDestroyed || !this.editor.commands?.setFeishuHandleHover) return
      const next = active ? this.handleHighlightRange() : null
      const current = this.editor.storage.feishuDocument?.handleHover
      if (current?.from === next?.from && current?.to === next?.to && current?.section === next?.section) return
      this.editor.commands.setFeishuHandleHover(next)
      this.$nextTick(() => this.syncHandleHighlightBackdrop())
    },
    refreshHandleHighlight() {
      this.setHandleHighlight(this.handleHovering || this.handlePressed || this.dragging || this.blockMenuOpen)
    },
    onBlockHandleEnter() {
      this.handleHovering = true
      this.refreshHandleHighlight()
    },
    onBlockHandleLeave() {
      this.handleHovering = false
      this.refreshHandleHighlight()
    },
    onEditorPointerMove(event) {
      if (this.dragging || this.handlePressed || this.columnResize || this.blockMenuOpen || this.blockTypeMenuOpen) return
      this.updateTableBoundaryHover(event)
      const pos = this.editor.view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
      if (Number.isInteger(pos)) this.positionBlockHandle(this.rangeAt(pos))
      else this.scheduleHandleHide()
    },
    onPaperPointerMove(event) {
      if (event.target?.closest?.('.ProseMirror, .feishu-table-boundary-tools')) return
      this.clearTableBoundaryHover()
    },
    scheduleHandleHide() {
      clearTimeout(this.handleHideTimer)
      this.handleHideTimer = setTimeout(() => {
        if (this.dragging || this.handlePressed || this.blockMenuOpen || this.blockTypeMenuOpen) return
        this.clearHandleHighlight()
        this.handleRange = null
      }, 220)
    },
    onDocumentPointerMove(event) {
      const root = this.$refs.root
      if (!root || root.contains(event.target)) return
      if (!event.target.closest?.('.feishu-block-handle, .feishu-callout-tools')) this.scheduleHandleHide()
    },
    onDocumentPointerDown(event) {
      const target = event.target
      if (this.menuOpen && !target.closest?.('.feishu-command-menu') && target !== this.menuTrigger && !this.menuTrigger?.contains(target)) this.closeCommandMenu()
      if (this.blockMenuOpen && !target.closest?.('.feishu-block-menu') && !target.closest?.('.feishu-block-handle')) { this.blockMenuOpen = false; this.blockAlignMenuOpen = false; this.blockColorMenuOpen = false; this.blockAlignMenuStyle = {}; this.blockColorMenuStyle = {}; this.refreshHandleHighlight() }
      if (this.blockTypeMenuOpen && !target.closest?.('.feishu-block-type-menu') && !target.closest?.('.feishu-block-handle')) this.blockTypeMenuOpen = false
      if (this.blockAlignMenuOpen && !target.closest?.('.feishu-block-menu') && !target.closest?.('.feishu-block-handle')) { this.blockAlignMenuOpen = false; this.blockMenuOpen = false; this.blockAlignMenuStyle = {}; this.refreshHandleHighlight() }
      if (this.blockColorMenuOpen && !target.closest?.('.feishu-block-menu') && !target.closest?.('.feishu-block-handle')) { this.blockColorMenuOpen = false; this.blockMenuOpen = false; this.blockColorMenuStyle = {}; this.refreshHandleHighlight() }
      if (this.bubbleAlignOpen && !target.closest?.('.feishu-bubble-align') && !target.closest?.('.feishu-bubble-align-menu')) this.closeBubbleAlignMenu()
      if (this.calloutEmojiOpen && !target.closest?.('.feishu-callout-tools')) this.calloutEmojiOpen = false
      if (this.colorPaletteOpen && !target.closest?.('.feishu-color-palette') && !target.closest?.('.feishu-color')) this.colorPaletteOpen = ''
      if (!this.$refs.root?.contains(target)) {
        this.headingOpen = false
        this.headingStyle = {}
        this.tableToolsOpen = false
      }
    },
    activeCalloutElement() {
      if (!this.editor) return null
      const { $from } = this.editor.state.selection
      for (let depth = $from.depth; depth > 0; depth -= 1) {
        if ($from.node(depth).type.name !== 'callout') continue
        const element = this.editor.view.nodeDOM($from.before(depth))
        return element instanceof Element ? element : null
      }
      return null
    },
    updateCalloutTools() {
      const callout = this.activeCalloutElement()
      const paper = this.$refs.root?.querySelector('.feishu-paper')
      if (!callout || !paper || !this.writable()) { this.calloutEmojiOpen = false; return }
      const rect = callout.getBoundingClientRect()
      const paperRect = paper.getBoundingClientRect()
      this.calloutToolsPosition = { top: Math.max(4, rect.top - paperRect.top - 44), left: Math.max(8, Math.min(paper.clientWidth - 190, rect.right - paperRect.left - 190)) }
    },
    calloutColor(name, fallback) { return this.editor?.getAttributes('callout')?.[name] || fallback },
    setCalloutColor(name, value) { if (this.writable() && /^#[0-9a-f]{6}$/i.test(value)) this.run('updateAttributes', 'callout', { [name]: value }) },
    pickRandomCalloutEmoji() { return this.emojiItems[Math.floor(Math.random() * this.emojiItems.length)]?.glyph || '💡' },
    toggleCalloutEmoji() { if (!this.writable()) return; this.calloutEmojiOpen = !this.calloutEmojiOpen; if (this.calloutEmojiOpen) this.calloutEmojiCategory = 'all'; else { this.calloutEmojiQuery = ''; this.calloutEmojiCategory = 'all' } },
    setCalloutEmoji(emoji) {
      if (!this.writable()) return
      const item = this.emojiItems.find(candidate => candidate.glyph === emoji)
      if (item) this.calloutEmojiRecent = [item.value, ...this.calloutEmojiRecent.filter(value => value !== item.value)].slice(0, 8)
      this.run('updateAttributes', 'callout', { emoji })
      this.calloutEmojiOpen = false
      this.calloutEmojiQuery = ''
      this.calloutEmojiCategory = 'all'
    },
    toggleColorPalette(target, event) {
      if (!this.writable()) return
      if (this.colorPaletteOpen === target) { this.colorPaletteOpen = ''; return }
      const rect = event?.currentTarget?.getBoundingClientRect?.()
      this.colorPaletteOpen = target
      this.colorPalettePosition = { top: (rect?.bottom || 80) + 6, left: rect?.left || 16 }
    },
    addRecentColor(value) { if (value) this.colorPaletteRecent = [value, ...this.colorPaletteRecent.filter(color => color !== value)].slice(0, 8) },
    applyColorPalette(value) {
      if (!this.writable()) return
      const target = this.colorPaletteOpen
      if (target === 'textColor') value ? this.run('setColor', value) : this.run('unsetColor')
      else if (target === 'textBackground') value ? this.run('setBackgroundColor', value) : this.run('unsetBackgroundColor')
      else if (target === 'calloutColor') this.run('updateAttributes', 'callout', { color: value || null })
      else if (target === 'calloutBackground') this.run('updateAttributes', 'callout', { backgroundColor: value || null })
      else if (target === 'calloutBorder') this.run('updateAttributes', 'callout', { borderColor: value || null })
      this.addRecentColor(value)
      this.colorPaletteOpen = ''
    },
    resetColorPalette() { this.applyColorPalette('') },
    deletePreviousBlockOnBackspace() {
      if (!this.writable()) return false
      const { selection } = this.editor.state
      const { $from } = selection
      if (!selection.empty || $from.depth !== 1 || $from.parent.type.name !== 'paragraph' || $from.parentOffset !== 0) return false
      const index = $from.index(0)
      const previous = index > 0 ? $from.node(0).child(index - 1) : null
      if (!previous || !['table', 'columns'].includes(previous.type.name)) return false
      return this.deleteBlockRange({ from: $from.posAtIndex(index - 1, 0), to: $from.posAtIndex(index, 0), parentDepth: 0 })
    },
    resetCalloutStyle() { if (this.writable()) this.run('updateAttributes', 'callout', { backgroundColor: null, borderColor: null, color: null, emoji: '💡' }) },
    deleteActiveCallout() {
      if (!this.writable()) return
      const { $from } = this.editor.state.selection
      for (let depth = $from.depth; depth > 0; depth -= 1) {
        if ($from.node(depth).type.name !== 'callout') continue
        const from = $from.before(depth)
        const to = $from.after(depth)
        this.deleteBlockRange({ from, to })
        this.calloutEmojiOpen = false
        this.handleRange = null
        return
      }
    },
    async copyBlock(range, cut = false) {
      if (!this.writable() || !range) return false
      const text = this.editor.state.doc.textBetween(range.from, range.to, '\n')
      const content = this.editor.state.doc.slice(range.from, range.to).content.toJSON()
      const structured = JSON.stringify({ schemaVersion: 1, type: 'feishu-block', content })
      let copied = false
      try {
        if (navigator.clipboard?.write && window.ClipboardItem) {
          const item = new window.ClipboardItem({
            'text/plain': new Blob([text], { type: 'text/plain' }),
            'application/x-feishu-block+json': new Blob([structured], { type: 'application/json' }),
          })
          await navigator.clipboard.write([item])
          copied = true
        }
      } catch (_) { copied = false }
      if (!copied) {
        try {
          if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text)
            copied = true
          } else {
            const textarea = document.createElement('textarea')
            textarea.value = text
            textarea.setAttribute('readonly', 'true')
            textarea.style.position = 'fixed'
            textarea.style.opacity = '0'
            document.body.appendChild(textarea)
            textarea.select()
            copied = document.execCommand('copy')
            textarea.remove()
          }
        } catch (_) { copied = false }
      }
      if (!copied) { this.error = '无法访问剪贴板，区块未被修改；可手动选择后复制'; return false }
      if (cut && this.writable()) this.deleteBlockRange(range)
      this.error = cut ? '已剪切区块' : '已复制区块'
      this.$nextTick(() => this.editor?.view.focus())
      return true
    },
    deleteBlockRange(range) {
      if (!this.writable() || !range) return false
      const wasRootTail = (range.parentDepth || 0) === 0 && range.to >= this.editor.state.doc.content.size
      this.editor.view.dispatch(closeHistory(this.editor.state.tr))
      const tr = this.editor.state.tr.delete(range.from, range.to)
      if (!tr.doc.content.size || (wasRootTail && tr.doc.lastChild?.type.name !== 'paragraph')) {
        const paragraph = this.editor.schema.nodes.paragraph?.createAndFill()
        if (paragraph) tr.insert(tr.doc.content.size, paragraph)
      }
      this.editor.view.dispatch(tr)
      this.$nextTick(() => this.focus())
      return true
    },
    positionBlockMenu(selector) {
      this.$nextTick(() => {
        const handle = this.$refs.root?.querySelector('.feishu-block-handle')
        const menu = handle?.querySelector(selector)
        if (!handle || !menu) return
        const top = handle.getBoundingClientRect().top
        const below = Math.max(0, window.innerHeight - top - 40)
        const above = Math.max(0, top - 8)
        const useAbove = below < menu.scrollHeight && above > below
        const available = Math.max(32, useAbove ? above : below)
        this.blockMenuStyle = { top: useAbove ? `${-Math.min(menu.scrollHeight, available) - 8}px` : '32px', maxHeight: `${available}px` }
      })
    },
    toggleBlockTypeMenu() { this.toggleBlockMenu() },
    toggleBlockMenu() {
      this.blockMenuOpen = !this.blockMenuOpen
      if (this.blockMenuOpen) {
        this.setHandleHighlight(true)
        this.blockTypeMenuOpen = false
        this.blockAlignMenuOpen = false
        this.blockColorMenuOpen = false
        this.blockAlignMenuStyle = {}
        this.blockColorMenuStyle = {}
        this.positionBlockMenu('.feishu-block-menu')
      } else { this.blockAlignMenuOpen = false; this.blockColorMenuOpen = false; this.blockAlignMenuStyle = {}; this.blockColorMenuStyle = {}; this.refreshHandleHighlight() }
    },
    openBlockAlignMenuOnHover() {
      if (!this.blockMenuOpen || !this.writable() || this.blockAlignMenuOpen) return
      this.blockAlignMenuOpen = true
      this.blockColorMenuOpen = false
      this.blockAlignMenuStyle = {}
      this.blockColorMenuStyle = {}
      this.$nextTick(() => this.positionBlockAlignMenu())
    },
    openBlockColorMenuOnHover() {
      if (!this.blockMenuOpen || !this.writable() || this.blockColorMenuOpen) return
      this.blockAlignMenuOpen = false
      this.blockColorMenuOpen = true
      this.blockAlignMenuStyle = {}
      this.blockColorMenuStyle = {}
      this.$nextTick(() => this.positionBlockColorMenu())
    },
    positionBlockAlignMenu() {
      if (!this.blockAlignMenuOpen) return
      const root = this.$refs.root
      const trigger = root?.querySelector('.feishu-block-submenu-trigger')
      const submenu = root?.querySelector('.feishu-block-submenu')
      if (!trigger || !submenu) return
      const margin = 8
      const gap = 5
      const triggerRect = trigger.getBoundingClientRect()
      const submenuRect = submenu.getBoundingClientRect()
      const right = triggerRect.right + gap
      const left = right + submenuRect.width + margin <= window.innerWidth
        ? right
        : Math.max(margin, triggerRect.left - submenuRect.width - gap)
      const top = Math.max(margin, Math.min(window.innerHeight - submenuRect.height - margin, triggerRect.top))
      this.blockAlignMenuStyle = { left: `${Math.round(left)}px`, top: `${Math.round(top)}px` }
    },
    positionBlockColorMenu() {
      if (!this.blockColorMenuOpen) return
      const root = this.$refs.root
      const trigger = [...(root?.querySelectorAll('.feishu-block-submenu-trigger') || [])].find((element) => element.getAttribute('title') === '颜色')
      const submenu = root?.querySelector('.feishu-block-color-submenu')
      if (!trigger || !submenu) return
      const margin = 8
      const gap = 5
      const triggerRect = trigger.getBoundingClientRect()
      const submenuRect = submenu.getBoundingClientRect()
      const right = triggerRect.right + gap
      const left = right + submenuRect.width + margin <= window.innerWidth ? right : Math.max(margin, triggerRect.left - submenuRect.width - gap)
      const top = Math.max(margin, Math.min(window.innerHeight - submenuRect.height - margin, triggerRect.top))
      this.blockColorMenuStyle = { left: `${Math.round(left)}px`, top: `${Math.round(top)}px` }
    },
    blockAlignAction(id) {
      if (!this.writable() || !this.featureEnabled('blockStyle')) return
      const range = this.handleActionRange()
      if (!range) return
      this.blockAlignMenuOpen = false
      this.blockColorMenuOpen = false
      this.blockMenuOpen = false
      this.blockAlignMenuStyle = {}
      this.blockColorMenuStyle = {}
      this.refreshHandleHighlight()
      const target = this.blockTextblockTarget(range)
      if (!target) return
      if (id === 'increaseIndent' || id === 'decreaseIndent') {
        const delta = id === 'increaseIndent' ? 1 : -1
        const indent = Math.max(0, Math.min(this.feishuConfig.limits.maxIndent, (Number(target.node.attrs.indent) || 0) + delta))
        this.applyBlockAttribute(target, 'indent', indent)
      } else this.applyBlockAttribute(target, 'textAlign', id)
    },
    blockColorAction(value) {
      if (!this.writable() || !this.featureEnabled('blockStyle')) return
      const range = this.handleActionRange()
      const target = this.blockTextblockTarget(range)
      if (!target) return
      const from = target.pos + 1
      const to = Math.max(from, target.pos + target.node.nodeSize - 1)
      this.blockColorMenuOpen = false
      this.blockMenuOpen = false
      this.blockColorMenuStyle = {}
      this.refreshHandleHighlight()
      this.editor.commands.setTextSelection({ from, to })
      if (value) this.editor.chain().focus().setColor(value).run()
      else this.editor.chain().focus().unsetColor().run()
      this.editor.view.focus()
    },
    blockTypeAction(id) {
      if (!this.writable() || !isBlockActionEnabled(this.feishuConfig, id)) return
      const range = this.handleActionRange()
      const node = range && this.editor.state.doc.nodeAt(range.from)
      if (!range || !node || !['paragraph', 'heading'].includes(node.type.name)) return
      this.blockTypeMenuOpen = false
      this.blockMenuOpen = false
      this.blockAlignMenuOpen = false
      this.blockColorMenuOpen = false
      this.blockAlignMenuStyle = {}
      this.blockColorMenuStyle = {}
      this.refreshHandleHighlight()
      this.savedSelection = null
      this.editor.commands.setTextSelection({ from: range.from + 1, to: Math.max(range.from + 1, range.to - 1) })
      if (id === 'paragraph') this.run('setParagraph')
      else if (/^heading[1-9]$/.test(id)) this.run('setHeading', { level: Number(id.slice(-1)) })
      else if (id === 'bulletList') this.run('toggleBulletList')
      else if (id === 'orderedList') this.run('toggleOrderedList')
      else if (id === 'taskList') this.run('toggleTaskList')
      else if (id === 'blockquote') this.run('toggleBlockquote')
      else if (id === 'codeBlock') this.run('setCodeBlock')
    },
    blockTypeActive(id) {
      if (!this.editor || !this.handleRange) return false
      const node = this.editor.state.doc.nodeAt(this.handleRange.from)
      if (!node) return false
      if (id === 'paragraph') return node.type.name === 'paragraph'
      if (/^heading[1-9]$/.test(id)) return node.type.name === 'heading' && Number(node.attrs?.level) === Number(id.slice(-1))
      return node.type.name === id
    },
    blockAction(id) {
      if (!this.writable() || !isBlockActionEnabled(this.feishuConfig, id)) return
      this.blockMenuOpen = false
      this.blockAlignMenuOpen = false
      this.blockColorMenuOpen = false
      this.blockAlignMenuStyle = {}
      this.blockColorMenuStyle = {}
      this.refreshHandleHighlight()
      const selectedRange = this.handleActionRange()
      const range = id === 'delete' ? (this.columnsRangeFor(selectedRange) || this.detailsRangeFor(selectedRange) || selectedRange) : selectedRange
      if (!range) return
      if (id === 'copy' || id === 'cut') { this.copyBlock(range, id === 'cut'); return }
      if (id === 'translate') { this.$emit('ai-request', 'translate'); this.editor.view.focus(); return }
      if (id === 'delete') { this.deleteBlockRange(range); return }
      const { from, to } = range
      this.editor.view.dispatch(closeHistory(this.editor.state.tr))
      const tr = this.editor.state.tr
      if (id === 'duplicate') { tr.insert(to, this.editor.state.doc.slice(from, to).content); this.editor.view.dispatch(tr) }
      else if (id === 'addBelow') { const paragraph = this.editor.schema.nodes.paragraph?.createAndFill(); if (paragraph) { tr.insert(to, paragraph); this.editor.view.dispatch(tr); this.editor.commands.setTextSelection(Math.min(to + 1, this.editor.state.doc.content.size)) } }
      else if (id === 'moveUp' || id === 'moveDown') {
        const resolved = this.editor.state.doc.resolve(from)
        const index = resolved.index()
        const endIndex = this.editor.state.doc.resolve(to).index()
        const targetIndex = id === 'moveUp' ? index - 1 : endIndex + 1
        if (targetIndex >= 0 && targetIndex <= resolved.parent.childCount) moveBlockRange(this.editor, from, to, resolved.posAtIndex(targetIndex, resolved.depth))
      }
    },
    // Callout handles sit outside the NodeView, but pointer positions resolve
    // into its contentDOM paragraph; dragging must preserve the outer module.
    blockDragRange(range) {
      if (!range || !this.editor) return range
      const doc = this.editor.state.doc
      const direct = doc.nodeAt(range.from)
      if (direct?.type.name === 'callout') return range
      const $from = doc.resolve(range.from)
      for (let depth = $from.depth; depth >= 1; depth -= 1) {
        if ($from.node(depth).type.name !== 'callout') continue
        return { from: $from.before(depth), to: $from.after(depth), parentDepth: depth - 1 }
      }
      return range
    },
    startBlockDrag(event) {
      if (!this.writable() || !this.featureEnabled('blockDrag')) return
      this.dragging = this.blockDragRange(this.handleActionRange())
      if (!this.dragging) return
      this.refreshHandleHighlight()
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('application/x-feishu-block', 'move')
      }
    },
    onHandlePointerUp() { this.handlePressed = false; this.refreshHandleHighlight() },
    onBlockDragOver(event) {
      if (!this.featureEnabled('blockDrag') || !this.dragging) return
      const pos = this.editor.view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
      const rawTarget = Number.isInteger(pos) ? this.rangeAt(pos) : null
      const targetRange = this.blockDragRange(rawTarget)
      const sameRange = targetRange && this.dragging.from === targetRange.from && this.dragging.to === targetRange.to
      if (!targetRange || sameRange) {
        this.dropPosition = null
        this.dropLineTop = 0
        return
      }
      const dom = this.editor.view.nodeDOM(targetRange.from)
      const paper = this.$refs.root.querySelector('.feishu-paper')
      if (!(dom instanceof Element) || !paper) return
      const rect = dom.getBoundingClientRect()
      const before = event.clientY < rect.top + rect.height / 2
      this.dropPosition = before ? targetRange.from : targetRange.to
      this.dropLineTop = (before ? rect.top : rect.bottom) - paper.getBoundingClientRect().top
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    },
    onBlockDrop(event) {
      if (!this.featureEnabled('blockDrag') || !this.dragging || !this.writable()) return
      event.preventDefault()
      const source = this.dragging
      this.dragging = null
      this.handlePressed = false
      this.refreshHandleHighlight()
      const pos = this.dropPosition
      this.dropPosition = null
      if (!Number.isInteger(pos)) return
      this.editor.view.dispatch(closeHistory(this.editor.state.tr))
      if (!moveBlockRange(this.editor, source.from, source.to, pos)) this.error = '当前区块不能移动到这里'
    },
    onColumnPointerDown(event) {
      if (!this.writable()) return
      const column = event.target.closest('[data-type="column"]')
      const next = column?.nextElementSibling
      if (!next || next.getAttribute('data-type') !== 'column') return
      const rect = column.getBoundingClientRect()
      if (rect.right - event.clientX > 9) return
      const pos = this.editor.view.posAtDOM(column, 0)
      const resolved = this.editor.state.doc.resolve(pos)
      const depth = Array.from({ length: resolved.depth }, (_, index) => index + 1).find((index) => resolved.node(index).type.name === 'column')
      if (!depth) return
      const firstPos = resolved.before(depth)
      const secondPos = firstPos + this.editor.state.doc.nodeAt(firstPos).nodeSize
      this.columnResize = { firstPos, secondPos, firstWidth: this.editor.state.doc.nodeAt(firstPos).attrs.width, secondWidth: this.editor.state.doc.nodeAt(secondPos).attrs.width, startX: event.clientX, pixels: rect.width + next.getBoundingClientRect().width, firstElement: column, secondElement: next, nextWidth: null }
      event.preventDefault()
      window.addEventListener('pointermove', this.onColumnPointerMove)
      window.addEventListener('pointerup', this.onColumnPointerUp, { once: true })
    },
    onColumnPointerMove(event) {
      const resize = this.columnResize
      if (!resize || !this.writable()) return
      const total = resize.firstWidth + resize.secondWidth
      const delta = (event.clientX - resize.startX) / resize.pixels * total
      const first = Math.max(10, Math.min(total - 10, Math.round(resize.firstWidth + delta)))
      resize.nextWidth = first
      resize.firstElement.style.flexBasis = `${first}%`
      resize.secondElement.style.flexBasis = `${total - first}%`
    },
    onColumnPointerUp() {
      const resize = this.columnResize
      this.columnResize = null
      window.removeEventListener('pointermove', this.onColumnPointerMove)
      if (!resize) return
      resize.firstElement.style.flexBasis = ''
      resize.secondElement.style.flexBasis = ''
      if (resize.nextWidth === null || !this.writable()) return
      const tr = this.editor.state.tr
      tr.setNodeMarkup(resize.firstPos, undefined, { width: resize.nextWidth })
      tr.setNodeMarkup(resize.secondPos, undefined, { width: resize.firstWidth + resize.secondWidth - resize.nextWidth })
      this.editor.view.dispatch(tr)
    },
    toggleReading() { this.reading = !this.reading },
    async toggleFullscreen() { if (!this.fullscreen) { try { await this.$refs.root.requestFullscreen() } catch (_) { this.fullscreen = true } } else if (document.fullscreenElement) await document.exitFullscreen(); else this.fullscreen = false },
    onFullscreenChange() { this.fullscreen = document.fullscreenElement === this.$refs.root },
    toggleSlides() { this.slides = !this.slides; this.slideIndex = 0 },
    onWindowKeydown(event) { if (event.key === 'Escape' && this.slides) this.toggleSlides(); else if (this.slides && event.key === 'ArrowRight') this.slideIndex = Math.min(this.slideChapters.length - 1, this.slideIndex + 1); else if (this.slides && event.key === 'ArrowLeft') this.slideIndex = Math.max(0, this.slideIndex - 1) },
    closeOverlay() { if (this.menuOpen) this.closeCommandMenu(); else if (this.colorPaletteOpen) this.colorPaletteOpen = ''; else if (this.mathDialog) this.mathDialog = ''; else if (this.emojiDialog) this.emojiDialog = false; else if (this.linkDialog) this.linkDialog = false; else if (this.tablePicker) { this.tablePicker = false; this.tablePickerHover = { rows: 3, cols: 3 } } else if (this.helpOpen) this.helpOpen = false; else if (this.headingOpen) { this.headingOpen = false; this.headingStyle = {} } else if (this.bubbleAlignOpen) this.closeBubbleAlignMenu(); else if (this.blockAlignMenuOpen) { this.blockAlignMenuOpen = false; this.blockAlignMenuStyle = {} } else if (this.blockColorMenuOpen) { this.blockColorMenuOpen = false; this.blockColorMenuStyle = {} } else if (this.blockTypeMenuOpen) this.blockTypeMenuOpen = false; else if (this.blockMenuOpen) { this.blockMenuOpen = false; this.refreshHandleHighlight() } else if (this.calloutEmojiOpen) this.calloutEmojiOpen = false; else if (this.tableToolsOpen) this.tableToolsOpen = false; else if (this.searchOpen) this.closeSearch(); this.focus() },
  },
}
</script>
