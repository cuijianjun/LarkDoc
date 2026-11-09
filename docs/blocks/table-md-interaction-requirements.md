# WorkBuddy md 文档表格 · 渲染与交互需求规格（1:1 复刻基线）

> 本文是从 WorkBuddy 真源（本机实现 CSS/JS）、`table改造` 会话记录（15 条消息）与《表格组件改造 · 交互文档 v3/v4》中提取的**需求侧完整规格**，目标是给 md 文档表格的渲染与交互做 1:1 复刻提供唯一依据。
> - 会话源：`https://workbuddy.link/p/SAwpCtlNrBeqLARUFfPU6Q`（含沉淀文档 `table-md-interaction`）
> - 真源文件（均在本机可直接读取）：
>   - `app.asar.unpacked/renderer/assets/markdown-editor-core-Czf_jjLC.css` — md 表格基础样式
>   - `app.asar.unpacked/renderer/assets/dist-eTnrGI8p.css` — 表格交互件（选择条、＋、拖拽、滚动条、浮窗）
>   - `app.asar.unpacked/renderer/assets/dist-DssmJYZd.js` — 表格命令与浮窗 items 组装
>   - `app.asar.unpacked/renderer/assets/markdown-editor-core-D2QTxLX7.js` — md 视图（AiEditButton、markdownFloatingItemsFactory、table-cell-range）
> - WorkBuddy md 视图是 **ProseMirror/Tiptap 系**（根选择器 `.sc-editor[data-sc-mode=markdown]`，表格块类名 `.sc-block-simple_table`），与 lark-doc 同一套 ProseMirror 表格模型，故可一一对齐。

---

## 1. 真实 DOM 结构

```
.sc-block-simple_table                     ← 表格块
├─ .sc-block-menu-handle                   ← 浮窗手柄（top:-25px）
│   └─ .sc-block-menu-handle-capsule       ← 胶囊
└─ .sc-table-wrapper (position:relative)
   └─ .sc-table-viewport                   ← clip-path:inset(-34px -12px -12px -80px)
      ├─ .sc-table-col-selector-host       ← 12px 高，top:-12px（列选择条）
      ├─ .sc-table-row-selector-host       ← 12px 宽，left:-12px（行选择条）
      ├─ .sc-table-col-plus-zone           ← 28×28，top:-28px（加列）
      ├─ .sc-table-row-plus-zone           ← 28×28，left 侧（加行）
      └─ .sc-table-content (width:max-content; min-width:100%)
         └─ table > tr > td/th > .sc-block-children
   ├─ .sc-table-edge-shadow--left / --right ← 14px 渐隐
   └─ .sc-table-scrollbar                   ← 14px sticky 横向滚动条
```

浮窗为全站单实例通用件：`.sc-floating-toolbar`（见 §6）。

---

## 2. 表格模型（边框/宽度，可直接照抄）

```css
table {
  border-collapse: separate;          /* 不是 collapse */
  border-spacing: 0;
  border: 1px solid var(--sc-border-grey);   /* 外框只在 table 上 */
  table-layout: auto;                 /* 按内容自适应 */
  min-width: 100%;                    /* is-table-fit：撑满 */
}
td, th {
  border-right: 1px solid var(--sc-border-grey);
  border-bottom: 1px solid var(--sc-border-grey);
  border-top: none;  border-left: none;      /* 内线只画右下，避免双线 */
  word-break: break-word;
}
td:last-child, th:last-child { border-right: none; }
tr:last-child > td, tr:last-child > th { border-bottom: none; }
td > .sc-block-children { min-width: 5em; }   /* 列最小宽 */
tr:first-child > td, tr:first-child > th {
  background: var(--sc-bg-grey_background);
  font-weight: 600;                            /* 表头 */
}
.sc-block-simple_table_cell { padding: 8px; position: relative; }
.sc-block-simple_table_cell.is-in-selection {
  box-shadow: inset 0 0 0 9999px var(--sc-table-selection-bg);
}
```

**关键**：外框 1px 挂在 `table` 上，内线只挂 `border-right/bottom`，末列末行去掉——整张表任何位置只有 1 条线，永不出现 2px 双线。

---

## 3. 颜色（CSS 变量，深色 + 浅色）

| token | 深色值 | 用途 | 截图实测对照 |
| --- | --- | --- | --- |
| `--sc-editor-bg` | `#131414` | 表格底 / 单元格底 | ✅ `#131414` |
| `--sc-bg-grey_background` | `#252526` | 表头底 | ✅ `#252526` |
| `--sc-border-grey` | `#ffffff26`（15% 白） | 边框 | ✅ 叠 `#131414` → `#363737`；叠表头 → `#464646` |
| `--sc-table-selection-bg` | `#2e2e2e` | **单元格/整列选中** | ✅ 首列 `#2E2E2E`（这是选中态，不是固定首列强调） |
| `--sc-table-selector-bg` | `#252526` | 行/列选择条默认 | — |
| `--sc-table-selector-active-bg` | `#ffffff26` | 选择条 hover | — |
| `--sc-table-selector-selected-bg` | `#0088ff26` | 选择条选中 | ✅ 首列顶部蓝条 `#243246` |
| `--sc-color-text-quaternary` | `#bbb` | ＋ 按钮底 | — |
| `--sc-table-plus-btn-hover-bg` | 主色 `#1677ff` | ＋ 按钮 hover | — |
| `--sc-menu-surface` | `#242424` | 浮窗底 | ✅ |
| `--sc-menu-border-color` | `#383838` | 浮窗 1px 描边 | — |
| `--sc-menu-active-bg` | `#383838` | 浮窗按压/选中 | — |
| `--sc-menu-radius` | `8px` | 浮窗圆角 | ✅ |
| `--sc-menu-shadow` | `0 6px 24px -4px #0003, 0 4px 6px -2px #0003` | 浮窗阴影 | — |
| `--sc-menu-padding-y/x` | `4px` | 浮窗内边距 | ✅ 4+28+4 = 36px 高 |
| `--sc-menu-icon-size` | `16px` | 浮窗图标 | — |

浅色对应：`--sc-editor-bg:#fff`、`--sc-bg-grey_background:#f7f7f7`、`--sc-border-grey:#ebebeb`、`--sc-table-selection-bg:#1677ff14`、`--sc-menu-surface:#fff`、`--sc-menu-border-color:#e5e5e5`。

> v3 纠偏：首列 `#2E2E2E` 不是固定强调设计，是**选中态**；顶部蓝条是 `--sc-table-selector-selected-bg`。全表边框同一个 `#ffffff26`，表头线显成 `#464646` 只是叠在更亮的 `#252526` 上，不存在「表头单独更亮的线」。

---

## 4. 几何规格

| 件 | 尺寸 / 位置 |
| --- | --- |
| 单元格内边距 | `8px` 四边等距（不是 `8px 16px`） |
| 列最小宽 | `5em` |
| 表头字重 | `600` |
| ＋ 按钮 | **18×18 圆形**，白十字由两个伪元素画（`10×2` + `2×10`），`box-shadow: 0 1px 3px #00000026` |
| ＋ 热区（列） | `28×28`，`top:-28px`、`margin-left:-14px`，按钮贴底；最左列特殊：高 `18px`、居中 |
| ＋ 热区（行） | `28×28`，`margin-top:-14px`、`margin-left:-14px`，按钮贴右 |
| hover 指示线 | 列 `2px` 宽 / 行 `2px` 高，主色蓝，`margin:-1px` 抵消 |
| 行/列选择条 | 厚 `12px`，列在 `top:-12px`、行在 `left:-12px`；hover `#ffffff26`，选中 `#0088ff26` |
| 列宽拖拽 | 热区 `12px`；手柄 `4×16`、圆角 2、`opacity:.5`；拖拽线 `2px`；吸附线 `3×10` **橙色 `#f5a623`** |
| 重排 | 指示线 `2px` 主色；拖拽预览卡 = `12px` 灰头 + 白底 body（圆角 4、`opacity:.92`、shadow-md） |
| 横向滚动条 | 高 `14px`（thumb `8px`）、`sticky`、默认 `opacity:0`，`.is-visible` 才显示 |
| 边缘渐隐 | `14px`，`linear-gradient(90deg,#00000014,#0000)`，**两侧都有** |
| 浮窗 | 表格块固定 `top:-25px; left:0; z-index:20`；高 `36px`、圆角 8、1px `#383838`、底色 `#242424` |

> v3 纠偏：编辑态超宽也是横向滚动（sticky 滚动条 + 两侧渐隐），**没有裁切**。

---

## 5. 交互清单：增 / 删 / 改 / 查

| 操作 | 触发 | 反馈 |
| --- | --- | --- |
| **加列** | hover 某列**内部**右边界 | 表格上方浮出 18px 灰圆 ＋；点击在该列**右侧插入** |
| **加行** | hover 某行**内部**下边界 | 行左侧浮出 ＋；点击在该行**下方插入** |
| **选列 / 选行** | 点上方 / 左侧 12px 选择条 | 选择条变蓝（`#0088ff26`），整列 / 整行叠 `#2e2e2e`（`CellSelection.colSelection/rowSelection`）；同时弹出状态 B 浮窗（§6.3） |
| **删行 / 删列** | 选中整行/列后 Delete / Backspace，或状态 B 浮窗「删除 N 行(列)」 | ProseMirror `deleteRow` / `deleteColumn`；**整表只剩 1 行 / 1 列时不删**；普通单元格内退格放行不误删 |
| **合并单元格** | md 视图**无工具条入口**（白名单过滤），仅通用全量变体提供 | `mergeCells`；已合并时该按钮变「拆分单元格」 |
| **改列宽** | 拖列边界 | `4×16` 蓝手柄 + 2px 蓝线，碰到吸附点变橙色；`<col style>` 与 `th[colwidth]` 同步 |
| **重排行 / 列** | 拖选择条 | 2px 指示线 + 拖拽预览卡；`moveTableColumn` / `moveTableRow` |
| **改内容** | 点单元格直接编辑 | 单元格内是块结构，可放标题/列表/代码块 |
| **表头行 / 列** | md 视图**无工具条入口**（白名单过滤），仅通用全量变体提供（条件见 §6.3） | `i$146` / `a$136`，选中态高亮 |
| **超宽** | 内容宽 > 容器 | 底部横向滚动条（自动显隐）+ 左右 14px 渐隐 |
| **排序 / 筛选** | — | **不存在**，纯展示 + 结构编辑 |

### 5.1 ＋ 按钮精确语义（真源 `nearestIdx` / `h$18()`）

- 候选边线**只收单元格右 / 下内部边界**：`nearestIdx` 的 filter 排除 `leftColIndex < 0`，`h$18()` 跳过 `< 0`——最左列左侧 / 首行上方的**外边缘永远不渲染 ＋**。
- **一条线一颗 ＋**（`o$34()` 构造 `colDividers` / `rowDividers`，整条边线只有一颗）。
- hover line 条件挂载（真源 `Ee && ye`）：指示线只在 ＋ 被 hover / focus 时进 DOM。
- 首列左侧 / 首行上方插入只能走浮窗的「左侧插入列 / 上方插入行」。

### 5.2 键盘可达性

- 选择条：`role=button` / `tabindex=0` / `aria-pressed` / `aria-label`，Enter / Space 等价指针单击。
- 自绘滚动条：`role=scrollbar` + `aria-valuemin/max/now` + `aria-orientation`；方向键 / Home / End / PageUp / PageDown 改 `scrollRatio`。
- 浮窗按钮为原生 `<button>`，Enter 走 click。
- 装饰件（渐隐 / 指示线 / 吸附线 / 预览卡）单独 `aria-hidden`，根节点不得整体 `aria-hidden`。

### 5.3 触屏

- 选择条 / 滚动条 `touch-action: none`（选择条另加 `user-select: none`），防止 `pointercancel` 打断拖拽。
- 主键判断 `button !== 0` 只在 `pointerType === 'mouse'` 时校验。
- 手势显式 `setPointerCapture` 到命中节点，detach 时 `releasePointerCapture`。

---

## 6. 弹窗系统（唯一浮窗 `sc-floating-toolbar`）★核心

### 6.1 单实例模型

- 全站**只有一个**浮窗 DOM：`.sc-floating-toolbar`。多个「贡献者（contributor）」按选择上下文提供 items；`exclusive: true` 的贡献者**整体替换**全部 items（真源 `n$91` 合并逻辑）。
- md 桌面视图的表格贡献者**非 exclusive**（真源：桌面分支返回值无 `exclusive` 标记）：table items 合并进基础列表，再经 md 工厂 transform（前置 AI 按钮）与 `toolbarItems` 白名单过滤（`e$38`）；移动端选择条工具条才是 exclusive（且 `suppressPersistent`）。
- 表格上下文出现「两个弹窗同时显示」即为缺陷——正确状态任何时刻最多一个浮窗。
- 通用文本浮窗在 `selection.type === 'table-cell-range'` 时被抑制（真源：`W?.type==='table-cell-range'` → 返回 null），由表格贡献者接管**同一个**浮窗节点。

### 6.2 显隐逻辑（与用户逐条确认的口径一致）

**显示（全部满足才显示）：**

| # | 条件 | 说明 |
| --- | --- | --- |
| 1 | selection.type ∈ { `text`(非折叠) , `table-cell-range` } | 折叠光标（单纯点进单元格）**不显示**浮窗；`text` → 状态 A（锚文字选区上方），`table-cell-range` → 状态 B（锚表格/选区，见 §6.3.1） |
| 2 | `table-cell-range` 由**点击顶部列选择条 / 左侧行选择条**产生 | 即用户口径「弹窗在点击表格最上边、左边才会显示」；单元格内选中文字走状态 A，与普通文本浮窗一致 |
| 3 | 非只读态 | 只读不挂浮窗 |
| 4 | 非打印 / 导出态 | `@media print` 隐藏；浮层不进 `getHTML()` |

**隐藏（任一即隐藏）：**

| # | 条件 |
| --- | --- |
| 1 | 任何其他 `pointerdown`（点单元格、点表格外、点 ＋ 等）——window capture 相位判定，目标不在浮窗内即收起 |
| 2 | `Escape` |
| 3 | `selectionChange`（选区变化离开表格；真源 `re.on('selectionChange', () => be())` 同时把插入菜单状态重置为 `idle`） |
| 4 | 变为只读 / 浮层未激活 |
| 5 | 打印 / 导出 |

- 隐藏必须是**真摘除 DOM**（不是 `display:none`），再次点击选择条再出现。
- 不是 hover-only：仅悬停不出现。
- 浮窗边界回弹：工具条超出宿主边界时按 `resolveFloatingToolbarBoundaryShift`（gap 8px）上下搬移。

### 6.3 浮窗内容（真源 items 全量枚举，2026-11-08 按真机截图修正）

md 文档（markdown surface）存在**三套**工具条内容，由 selection 类型 + md 白名单双重决定：

**状态 A：单元格内选中文字（`selection.type === 'text'`）** — 与普通文本浮窗**完全相同**（同一套 items、锚在文字选区上方，不在表格锚点）。真源 `markdownFloatingItemsFactory`：基础 items 过滤白名单 `jr = [bold, italic, underline, strike, inline-code, link]`（过滤保留基础数组顺序）：

```
[AI 编辑] | [加粗] [斜体] [下划线] [删除线] | [链接] [行内代码]
```

> 注意顺序：链接在行内代码**之前**（基础数组顺序 `[…link, inlineCode]` 过滤后即此序），与真机截图一致。

**状态 B：整行/整列选中（`table-cell-range`，点顶部/左侧选择条触发）** — md 视图真机口径（截图实证）：

```
[AI 编辑] | [加粗] [斜体] [下划线] [删除线] | [创建副本] [删除 {{count}} 行(列)]
```

- 这里的 B/I/U/S 是 **table 作用域格式按钮**（key `table-bold` 等，active 态查询整段 cell-range 的格式状态 `F$7`，应用 `I$6` 对整个选区生效），不是状态 A 的文本格式按钮。
- **md surface 白名单过滤**（真源配置 `features.block.table.toolbarItems`，经 `e$38` 过滤并清理首尾/连续 separator）：

  ```
  [`table-bold`, `table-italic`, `table-underline`, `table-strikethrough`,
   `table-duplicate`, `table-delete`]
  ```

- 因此通用全量条里的**表头 toggle / 合并 / 拆分 / 均分列宽 / 颜色 / 对齐 / 清除内容在 md 文档不出现**（被白名单滤掉）。lark-doc 复刻 md 视图时按状态 B 白名单口径实现。

**状态 B 全量变体（通用 block 编辑器 `ue()` 组装，非 md surface / 作为能力清单备查）：**

按顺序（各带条件渲染）：
1. **表头 toggle**（Y，条件挂载）：
   - `isFullRow && minRow===0` → 「设为标题行 / 取消标题行」（选中态高亮）
   - `isFullCol && minCol===0` → 「设为标题列 / 取消标题列」
   - → `separator`
2. **合并 / 拆分 / 均分**（X）：
   - 可拆分 → 「拆分单元格」；多格未合并 → 「合并单元格」
   - `isFullCol && 跨≥2 连续列` → 「均分列宽」
3. **颜色**（q，custom popover）：字色 + 底色两组色板，含「清除」；需要 `selection.type==='table-cell-range' && tableBlockId` 匹配，否则不渲染
4. **对齐**（J，custom popover 下拉）：
   - 水平对齐：左对齐 / 居中对齐 / 右对齐
   - 垂直对齐：顶部对齐 / 垂直居中 / 底部对齐
   - 当前项带 ✓；`sideOffset:6`、`collisionPadding:8`
5. `separator` → **加粗 斜体 下划线 删除线**（K，带 active 态，快捷键 Mod+B/I/U/Mod+Shift+S）
6. `separator` → **创建副本 / 清除内容 / 删除 {{count}} 行（列）**（Z）
   - 创建副本：`isFullRow||isFullCol` 时出现（复制整行/整列）
   - 清除内容：无条件出现
   - 删除按钮 label 动态计数（「删除 {{count}} 行 / 列」），tooltip「删除选中行 / 删除选中列」

**状态 A/B 合成链（真源合并模型 `n$91`）**：桌面端 table 贡献者**非 exclusive**，items 合并进基础列表 → md 工厂 transform 前置 AI 按钮 + separator → `e$38` 白名单过滤 → 去重/清理 separator。移动端（`compact-touch`）走 `mobileSelectorToolbar`。

**移动端变体**（`mobileSelectorToolbar`）：text-button 形态——插入列/插入行、删除列/删除行、剪切/复制/粘贴；行态另有「上方插入行 / 下方插入行」，列态「左侧插入列 / 右侧插入列」。

### 6.3.1 状态 B 浮窗锚定几何（真源 `me()` / `$()`）

| selection | 锚 rect | 工具条位置 |
| --- | --- | --- |
| 整列（`isFullCol`） | `DOMRect(所选列区间 minX, 表格顶部-16, 列区间宽, 0)`（12px 间隙 + 4px 偏移） | 水平居中于所选列区间，**表格上方** |
| 整行（`isFullRow`） | `DOMRect(表格左缘, 所选行顶部-4, 1, 0)` | 所选行上方 |
| 局部 cell-range（拖选多格） | `DOMRect(列区间 minX, 首行顶部-4, 列区间宽, 末行底部+4)` | 选区上方 |

- 锚 rect 完全落在 `.sc-table-viewport` 水平可视边界外（`pe()` 判定）→ 返回 null → **浮窗不显示**。
- 工具条超出宿主边界按 `resolveFloatingToolbarBoundaryShift`（gap 8px）上下搬移。

### 6.4 AI 编辑按钮（真源 `AiEditButton`）

- 仅当 `selection.type ∈ { text, table-cell-range }` 可用。
- 锚点计算：普通文本选区 → 选区端点矩形；`table-cell-range` → **表格块底部**（`tableRect.bottom + wr`，即弹出在表格下方）。
- 点击后 `openAiEdit({selectedText, highlightRange, anchorRect})`，并先 dismiss 当前浮窗。

### 6.5 浮窗视觉（全部实测）

| 项 | 值 |
| --- | --- |
| 容器 | flex，`gap: var(--sc-menu-gap)`，`padding: 4px`（y/x），底 `#242424`，1px `#383838` 描边，圆角 8，阴影 `--sc-menu-shadow`，`user-select:none`，`white-space:nowrap`，`pointer-events:all` |
| 图标按钮 | icon 16px；`is-active` → 色 `--sc-menu-icon-color-active` + 底 `--sc-menu-active-bg` |
| 文本按钮 | 高 `24px`、`padding: 0 6px`、字号 `--sc-menu-font-size`、hover `--sc-menu-hover-bg`、active `--sc-menu-active-bg`、disabled `opacity:.4` |
| 分隔线 | 宽 `1px`、高 `--sc-menu-separator-height`、色 `--sc-menu-separator-color` |
| tooltip | 两行结构：功能名 + 快捷键 chord + markdown 示例（如 `**文本**`、`*文本*`、`/文本/`、`~~文本~~`），mono 字体 11px |
| 对齐下拉 | `.sc-alignment-dropdown-content`，`side:bottom / align:start / sideOffset:6` |

### 6.6 结构禁用态

- 单元格内有复杂块 → 表格块加 `is-structure_disabled`，浮窗下移到表内 `top:4px`。

---

## 7. 边界与守住的约束

- ProseMirror schema、`<colgroup>` 落库格式、9×9 上限、导出语义（Markdown/DOCX/PDF）不动。
- 块级配置 `block.table.toolbarItems === false` 可整体禁用表格浮窗工具条（真源 `oe===!1` 分支）。
- 块锁（`isBlockLocked` / `isBlockReadOnly`）时颜色、格式等编辑项不渲染。
- 语义 `<table>` 不加 `role=grid`；只读态 overlay 整体不挂载；打印态 overlay 隐藏。
- 主题色不写死字面值：lark-doc 侧全部走 `--ld-*` token 转发（用户已确认「主题颜色还使用 lark-doc 默认颜色」）。

---

## 8. lark-doc 对齐映射（改造落点备忘）

| 项 | WorkBuddy 真源 | lark-doc 落点 |
| --- | --- | --- |
| 边框模型 | separate + 单边线 + table 外框 | `lark-doc.css` 覆盖旧 collapse 规则 |
| 宽度 / 列宽 | `width:100%` + `table-layout:auto` + `min-width:5em` | 同上 |
| ＋ | 18px 灰圆、内部边界、单＋、hover line 条件挂载 | `tableOverlays.js` / `tableTools.js` |
| 选择条 | 12px、选中 `#0088ff26`、CellSelection 节点边界定位 | `tableInteractionMixin.js` |
| 删行列 | Delete/Backspace 拦截完整单行/列 CellSelection | 同上 |
| 重排 | 拖选择条 + 预览卡 + moveTableColumn/Row | 同上 |
| 横滚 | 自绘 14px sticky 条 + 双向渐隐 | `tableOverlays.js` |
| 浮窗 | 唯一 `sc-floating-toolbar`；点选择条出现、点别处消失 | `tableOverlays.js` float + window capture pointerdown |
| 浮窗锚定 | fixed + viewport 坐标 + z-index 30，允许负值回退视口内 | `tableToolsMixin.js` clamp（`edge=12`） |

已由用户确认的取舍（2026-11-08）：
- A「1:1 复刻交互件」+ B「行列拖拽重排一起做」，不留 P2。
- 几何 / 交互 1:1 对齐；颜色走 lark-doc `--ld-*` 默认 token。
- 只在 `feat/md-table-interaction` 分支 / worktree 执行；实现后本地预览给链接。
- 32px 热区沿用 lark-doc 原实现（WorkBuddy 为 28px）；＋ 为 lark-doc 品牌绿（主题色约束的直接结果）。

---

## 9. 验收清单（v4 契约 51 项口径）

1. **格式浮窗（两套内容都要验）**：
   - 单元格内选中文字 → 状态 A `[AI | sep | B I U S 链接 </>]`，锚在文字选区上方；
   - 点列/行选择条 → 状态 B `[AI | sep | B I U S(table 作用域) | 创建副本 | 删除 N 行(列)]`，锚在所选列/行上方（§6.3.1）；
   - 点选择条出现、点其他地方消失、Escape 消失、再点再出现；hover-only 不出现；只读/打印消失；**两套内容不同**（截图实证，md 白名单过滤）。
2. **表格工具条 / 边界 ＋**：一条线一颗 ＋；线只在表格内；外边缘（最左/最上）无 ＋；＋ 真实插入（行/列各四向）；不被选择条 / 滚动条 / 宿主裁切遮挡；viewport 余量钳制允许负值回退。
3. **md 浮层几何**：选择条定位/点选整列整行、拖拽重排（含预览卡）、渐隐、自绘滚动条拖到最右 `scrollLeft=maxScroll`。
4. **列宽拖拽**：手柄出现、`<col style>` 与 `th[colwidth]` 同步（260→321px 实测）。
5. **只读态**：overlay 不挂载。
6. **无脚本错误**：`pageerror` / `console.error` = 0。
7. 主题：6 种组合随主题切换（注意 content 轨需 `data-content-theme`）；对比度门禁过。
8. 导出：`getHTML()` 不含浮层节点且仍含 `<table`。

已知遗留（单独立项，不阻塞表格 1:1）：Web Component「移除后重新插入恢复标签内 slot 初始内容」12/14 两条 FAIL；`overlays`（分享/权限/导出浮层）依赖 8080 dev server 未跑。
