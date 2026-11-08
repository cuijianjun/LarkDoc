# 表格组件改造 · 交互文档 v3（对齐真实实现）

> 状态：**已确认并实现**：用户 2026-11-08 明确「A B 都做，一起做」「和 workbuddy 的交互是 1:1 的」「主题颜色还使用 lark-doc 默认颜色」「在当前分支 当前 worktree 开始执行 然后本地先预览 给我链接」。实现已落地，见 §11。
> 分支：`feat/md-table-interaction`（基于 `master` @ `7211bfe`）
> Worktree：`/Users/cjjxw/codex/.wt-larkdoc/md-table-interaction`
> v3 依据：**直接读了 WorkBuddy 自身的渲染实现**，不再是「看图猜」

---

## 0. 证据来源

| 文件 | 内容 |
| --- | --- |
| `…/WorkBuddy.app/Contents/Resources/app.asar.unpacked/renderer/assets/markdown-editor-core-Czf_jjLC.css` | md 表格基础样式（`table/td/th`、表头、边框模型） |
| `…/renderer/assets/dist-eTnrGI8p.css` | 表格交互件（选择条、＋按钮、拖拽、滚动条、浮窗） |
| `…/renderer/assets/dist-DssmJYZd.js` | 表格命令（`deleteRow` / `deleteColumn` / `mergeCells`） |

> WorkBuddy 的 md 视图是 **sc-editor**（ProseMirror/Tiptap 系），根选择器 `.sc-editor[data-sc-mode=markdown]`，表格块类名 `.sc-block-simple_table`。这也解释了为什么它和 lark-doc 能一一对上——**同一套 ProseMirror 表格模型**。

---

## 1. 真实 DOM 结构

```
.sc-block-simple_table                     ← 表格块
├─ .sc-block-menu-handle                   ← 浮窗手柄（top:-25px）
│   └─ .sc-block-menu-handle-capsule       ← 胶囊：AI编辑｜B I U S｜复制 删除
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

---

## 2. 真实表格模型（可直接抄）

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

> **关键**：外框 1px 在 `table` 上，内线只挂 `border-right/bottom`，末列末行去掉 —— 所以整张表**任何位置都只有 1 条线，不会出现 2px 双线**。lark-doc 现在是 `border-collapse: collapse` + 每格四边 1px，要复刻必须换这套模型。

---

## 3. 真实颜色（深色，取自 CSS 变量）

| token | 深色值 | 用途 | 截图实测对照 |
| --- | --- | --- | --- |
| `--sc-editor-bg` | `#131414` | 表格底 / 单元格底 | ✅ `#131414` |
| `--sc-bg-grey_background` | `#252526` | 表头底 | ✅ `#252526` |
| `--sc-border-grey` | `#ffffff26`（15% 白） | 边框 | ✅ 叠在 `#131414` 上 → `#363737`；叠在表头 `#252526` 上 → `#464646` |
| `--sc-table-selection-bg` | `#2e2e2e` | **单元格/整列选中** | ✅ 首列 `#2E2E2E` |
| `--sc-table-selector-bg` | `#252526` | 行/列选择条默认 | — |
| `--sc-table-selector-active-bg` | `#ffffff26` | 选择条 hover | — |
| `--sc-table-selector-selected-bg` | `#0088ff26` | 选择条选中 | ✅ 首列顶部蓝条 `#243246` |
| `--sc-color-text-quaternary` | `#bbb` | ＋ 按钮底 | — |
| `--sc-table-plus-btn-hover-bg` | 主色 `#1677ff` | ＋ 按钮 hover | — |
| `--sc-menu-surface` | `#242424` | 浮窗底 | ✅ `#242424` |
| `--sc-menu-border-color` | `#383838` | 浮窗 1px 描边 | — |
| `--sc-menu-active-bg` | `#383838` | 浮窗按压 | — |
| `--sc-menu-radius` | `8px` | 浮窗圆角 | ✅ |
| `--sc-menu-shadow` | `0 6px 24px -4px #0003, 0 4px 6px -2px #0003` | 浮窗阴影 | — |
| `--sc-menu-padding-y/x` | `4px` | 浮窗内边距 | ✅ 4+28+4 = 36px 高 |
| `--sc-menu-icon-size` | `16px` | 浮窗图标 | — |

> 浅色对应：`--sc-editor-bg:#fff`、`--sc-bg-grey_background:#f7f7f7`、`--sc-border-grey:#ebebeb`、`--sc-table-selection-bg:#1677ff14`、`--sc-menu-surface:#fff`、`--sc-menu-border-color:#e5e5e5`。

---

## 4. 真实几何

| 件 | 尺寸 / 位置 |
| --- | --- |
| 单元格内边距 | `8px`（`--sc-table-cell-padding`） |
| 列最小宽 | `5em` |
| 表头字重 | `600` |
| **＋ 按钮** | **18×18 圆形**，白十字由两个伪元素画（`10×2` + `2×10`），`box-shadow: 0 1px 3px #00000026` |
| ＋ 热区（列） | `28×28`，`top:-28px`、`margin-left:-14px`，按钮贴底；最左列特殊：高 `18px`、居中 |
| ＋ 热区（行） | `28×28`，`margin-top:-14px`、`margin-left:-14px`，按钮贴右 |
| hover 指示线 | 列 `2px` 宽 / 行 `2px` 高，主色蓝，`margin:-1px` 抵消 |
| 行/列选择条 | 厚 `12px`，列在 `top:-12px`、行在 `left:-12px`；hover 变 `#ffffff26`，选中变 `#0088ff26` |
| 列宽拖拽 | 热区 `12px`；手柄 `4×16`、圆角 2、`opacity:.5`；拖拽线 `2px`；吸附线 `3×10` **橙色** `#f5a623` |
| 重排 | 指示线 `2px` 主色；拖拽预览卡 = `12px` 灰头 + 白底 body（圆角 4、`opacity:.92`、`shadow-md`） |
| 横向滚动条 | 高 `14px`（thumb `8px`）、`sticky`、默认 `opacity:0`，`.is-visible` 才显示 |
| 边缘渐隐 | `14px`，`linear-gradient(90deg,#00000014,#0000)`，两侧都有 |
| **浮窗** | 表格块固定 `top:-25px; left:0; z-index:20`；高 `36px`（4+28+4）、圆角 8、1px `#383838`、底色 `#242424` |

---

## 5. 真实交互清单（增 / 删 / 改 / 查）

| 操作 | 触发 | 反馈 |
| --- | --- | --- |
| **加列** | hover 某列右边界 | 表格上方浮出 18px 灰圆 ＋；点击在该列**右侧插入** |
| **加行** | hover 某行下边界 | 行左侧浮出 ＋；点击在该行**下方插入** |
| **选列 / 选行** | 点上方 / 左侧 12px 选择条 | 选择条变蓝，整列 / 整行叠 `#2e2e2e` |
| **删行 / 删列** | 选中后 Delete | ProseMirror `deleteRow` / `deleteColumn` |
| **合并单元格** | 多选后合并 | `mergeCells` |
| **改列宽** | 拖列边界 | 4×16 蓝手柄 + 2px 蓝线，碰到吸附点变橙色 |
| **重排行 / 列** | 拖选择条 | 2px 指示线 + 拖拽预览卡片 |
| **改内容** | 点单元格直接编辑 | 单元格内是块结构，可放标题/列表/代码块 |
| **浮窗** | hover 表格块 | 表格上方 25px 处浮出胶囊：`AI 编辑`｜`B I U S`｜`复制` `删除` |
| **超宽** | 内容宽 > 容器 | 底部横向滚动条 + 左右 14px 渐隐 |
| **结构禁用** | 单元格内有复杂块 | 加 `is-structure_disabled`，浮窗下移到表内 `top:4px` |
| **排序 / 筛选** | — | **不存在**，纯展示 + 结构编辑 |

---

## 6. 这一轮把 v2 的 4 个判断推翻了

| # | v2 说法 | 真实情况 | 影响 |
| --- | --- | --- | --- |
| 1 | 首列 `#2E2E2E` 是**固定强调设计** | 是**选中态**：token 就叫 `--sc-table-selection-bg`，深色值恰为 `#2e2e2e`；顶部蓝条是 `--sc-table-selector-selected-bg` | **撤销** `--ld-bg-table-lead`，改为新增「行/列选中」 |
| 2 | 表头下边线是**单独更亮的颜色**，外框也更强 | 全表**同一个** `#ffffff26`；表头线显成 `#464646` 只是叠在了更亮的 `#252526` 上 | **撤销** `--ld-border-table-head`、`--ld-border-table-strong` 两个 token |
| 3 | 阅读态超宽改横向滚动，编辑态保持裁切 | 编辑态**也是横向滚动**（sticky 滚动条 + 两侧渐隐），没有裁切 | lark-doc 的 `overflow-x:hidden` + 单向 24px 渐隐要换成滚动 + 双向 14px |
| 4 | 单元格内边距 `8px 16px` | 代码是 `padding: 8px` 四边等距 | 按 8px 实现，视觉差再按截图微调 |

> 另外补一条 v2 没抓到的：**表格支持整行/整列拖拽重排**（带预览卡片），lark-doc 目前没有。

---

## 7. 映射到 lark-doc 的改造清单

| 项 | lark-doc 现状 | 目标 | 落点 |
| --- | --- | --- | --- |
| 边框模型 | `border-collapse: collapse` + 每格四边 1px | `separate` + 只右下边 + table 外框 | `lark-doc.css:595/608` |
| 宽度 | `fixed` + colgroup px，不撑满 | `width:100%` + `min-width:100%` | 同上 |
| 列宽算法 | 固定 px | `table-layout:auto` + 单元格 `min-width:5em` | 同上 |
| 单元格 | `padding:7px`、`min-width:70px` | `padding:8px`、`min-width:5em` | `lark-doc.css:608` |
| 表头 | `--ld-bg-th`（飞书预设为 transparent） | 独立 token，`font-weight:600` | 4 个主题文件 |
| 边框色 | `--ld-border-table` 绿系 `#d4e0d9` | 中性：深 `#ffffff26`、浅 `#ebebeb` | 4 个主题文件 |
| 加列/加行 | 绿色 `#00B887` 16×32 药丸 + 蓝色 42% 引线 | **18×18 灰圆** ＋ 2px 主色 hover 线 | `lark-doc.css:737`、`ui/tableTools.js` |
| 行/列选择 | 无 | 12px 选择条 + 选中态 | 新增 |
| 列宽拖拽 | 有（`resizable:true`） | 4×16 蓝手柄 + 橙色吸附线 | `lark-doc.css` |
| 重排 | 无 | 拖选择条 + 预览卡 | 新增（P2） |
| 超宽 | `overflow-x:hidden` + 24px 单向渐隐 | 横向滚动 + 双向 14px 渐隐 | `lark-doc.css:606/607`、`tableToolsMixin.syncTableClip` |
| 浮窗 | 顶部 `TableTools` 横条（12 个动作） | 表格上方 25px 胶囊（复用 `ui/bubbleBar.js`） | `bubbleMenuMixin` / `bubbleBar` |

> `extensions.js` 的 schema、`<colgroup>` 落库格式、9×9 上限、导出链路 **一律不动**。

---

## 8. 明确不做

1. 不改 ProseMirror schema、colgroup 落库格式、9×9 上限。
2. 不删 lark-doc 现有表格编辑能力（＋ 只换外观不删入口）。
3. 不改 `sheet` / `bitable` 及其 NodeView。
4. 不改 Markdown / DOCX / PDF 导出语义。
5. 不写死色值，全部落 4 个主题文件的 token（`check:theme-tokens` / `check:theme-contrast` 必须过）。
6. 不引入第三方依赖。

---

## 9. 验收标准

- [ ] 表格撑满，列宽按内容自适应，长文本换行不截断，任何位置只有 1px 单线（无 2px 双线）。
- [ ] 表头底 / 加粗在浅色、深色、飞书、pcvue 四套主题下都成立且对比度达标。
- [ ] hover 列边界出 18px 灰圆 ＋，点击在右侧插列；行同理。
- [ ] 选择条点选后整列/整行叠选中色，Delete 能删。
- [ ] 拖列宽有 4×16 手柄 + 吸附线；列宽拖拽后 colgroup 与文档数据不变形。
- [ ] 超宽可横向滚动，滚动条自动显隐，两侧有渐隐。
- [ ] 浮窗位置/尺寸/圆角/描边/阴影与实测一致，键盘可达，打印与导出时消失。
- [ ] `check:quick`、`check:unit`、`check:theme-tokens`、`check:theme-contrast` 全过。
- [ ] 主工作区（detached HEAD）零改动。

---

## 10. 待确认（已由用户答复覆盖）

| 编号 | 问题 | 用户答复 |
| --- | --- | --- |
| **A** | 交互件按真实实现 1:1 复刻（18px 灰圆 ＋、12px 选择条、双向渐隐、滚动条），还是只做视觉、不动这些手柄？ | **A 做**：1:1 复刻 |
| **B** | 行/列**拖拽重排**（预览卡）要不要一起做？ | **B 做**：一起做，不留 P2 |

> 附加约束：几何 / 交互 1:1 对齐 WorkBuddy；**颜色不照搬 `--sc-*` 深色值**，全部走 lark-doc 默认 `--ld-*` token；只在当前分支 / 当前 worktree 执行；实现后先起本地预览给链接。

---

## 11. 实现落点（2026-11-08）

| 层 | 文件 | 改动 |
| --- | --- | --- |
| 几何 UI | `src/ui/tableOverlays.js`（新增） | 独立 overlay：`＋` 浮窗、行/列选择条、重排指示线 + 吸附线 + 预览卡、自绘横滚条、左右渐隐。根 `pointer-events:none`，只按 state 重画 + 把手势翻成回调，不读 ProseMirror。 |
| 状态 / 命令 | `src/components/lark-doc/editor/tableInteractionMixin.js`（新增） | 把 DOM 实测几何算成 state；`CellSelection.colSelection` / `rowSelection` 选整行/整列（位置必须是**单元格节点边界**，不能 `+1` 进内容，否则 `pointsAtCell` 抛错被吞掉）；`moveTableColumn` / `moveTableRow` 做重排；`scrollLeft` 做横滚；hover / scroll / transaction / selection 全量重算。 |
| 接线 | `src/components/lark-doc/editor/tableToolsUiMixin.js` | `mountTableTools()` 一并 `mountTableOverlays()`；`refreshTableTools()` 一并刷 overlay；`destroyTableTools()` 一并销毁。 |
| 接线 | `src/ui/workspaceShell.js` | 新增 `tableOverlayHost`（`display:contents`），不与两条工具条抢宿主。 |
| 接线 | `src/editor/nativeEditorHost.js` | 注册 mixin；`mount` / `transaction` / `selection` / `onDocumentScroll` 各加一次 `refreshTableOverlays()`。 |
| 视觉 | `src/components/lark-doc/lark-doc.css` 末段 | 追加 `--ld-table-*`（全部 `var()` 转发已有 token，无新字面色）；覆盖旧表格规则为 `border-collapse:separate` + 单边线 + 8px padding + 5em 最小列宽 + 表头 600；超宽改横滚；overlay 全套几何；打印隐藏。 |
| 预览 | `examples/element-demo.html` | 初始内容内置 6 列 × 4 行表格，容器高度 620px，便于直接验证超宽横滚与交互件。 |

### 与 v3 规格的偏差（如实记录）

1. ＋按钮的 32px 热区沿用 lark-doc 原实现（WorkBuddy 为 28px）；视觉已压成 18px 圆 + 十字，颜色为 lark-doc 品牌绿而非 WorkBuddy 灰 —— 这是用户「主题颜色用 lark-doc 默认色」的直接结果。
2. 浮窗显隐条件为「光标在表格内 或 鼠标 hover 表格块」，与 WorkBuddy 的 hover 块等价但更宽松，避免只读点击时选区丢失导致浮窗闪烁。
3. 单元格选中态挂在 ProseMirror 的 `.selectedCell`（`box-shadow: inset …`），类名不同但视觉效果与 `--sc-table-selection-bg` 的 `.is-in-selection` 一致。
4. `overflow-x` 由旧的 `hidden`（裁切）改为 `auto`（横滚），原生滚动条隐藏、由 overlay 自绘 14px 条替代；旧 `is-clipped::after` 单侧渐隐停用，改由 overlay 双向渐隐接管。`syncTableClip()` 保留但不再影响视觉。

### 未改（守住的边界）

ProseMirror schema、`<colgroup>` 落库格式、Markdown / DOCX / PDF 导出语义、语义 `<table>`（未加 `role=grid`）、只读态（overlay 不挂载）、打印态（overlay 隐藏）、`verify-browser-table-tools.js` 断言的 DOM 结构（工具条 / 边界条的 class、按钮顺序、aria 全部原样）。

### 实现期修掉的 4 个真实缺陷

1. **选择条 / 滚动块不定位**：两者漏了 `position:absolute`，`left/top/width/height` 全部失效。补齐后列选择条按 180/260/118px 实测列宽落位。
2. **浮窗压住首列选择条**：浮窗原 `top:-25px`，与 `top:-12px` 的列选择条重叠，`elementFromPoint` 命中浮窗按钮。改为 `top:-50px`（36px 高，底边 -14px，留 2px 间隙）。
3. **点选择条无反应**：`selectTableLine()` 原按 `start + offsets[i] + 1` 把位置传进单元格内容，`pointsAtCell()` 要求 `$pos.parent` 是 `tableRow` 且 `$pos.nodeAfter` 是 cell，`rectBetween` 抛 `RangeError` 被 `catch` 吞掉。改用 `CellSelection.colSelection/rowSelection` + 节点边界位置；这也是后续 `moveTableColumn` / `moveTableRow` 能生效的前提。
4. **单测 `p6b-wiring` 断言被破坏**：`append(root, headingNumberMenuHost, overlayHost, tableOverlayHost)` 改成了原文两参调用 + 单独 `append(root, tableOverlayHost)`，既保留新宿主又不改既有契约字符串。

> 构建注意：环境里 `NODE_OPTIONS` 注入了 WorkBuddy 的 stdout shim，直接 `npm run build:*` 会在管道里报 `write EPIPE`（外层 exit code 还会误报 0）。统一用 `env -u NODE_OPTIONS ROLLUP_TARGET=... node scripts/build-rollup.mjs` 并把输出重定向到文件。

---

## 12. 浏览器验收结果（headless Chromium · 2026-11-08）

预览：`http://127.0.0.1:8123/examples/element-demo.html`，脚本 `/tmp/ld_final.cjs`。以下均为真实 DOM / computed style / ProseMirror selection 断言，不是截图目测。

| 项 | 结果 |
| --- | --- |
| 基础视觉 | `border-collapse:separate`、`border-spacing:0`、`table-layout:auto`、外框 1px、单元格 8px 四边等距、内线只挂 right/bottom、末列 `border-right:0`、末行 `border-bottom:0`、`min-width:80px`（5em） |
| 横滚 | `overflow-x:auto`，`scrollWidth=1240 > clientWidth=558`，`colgroup` 6 列 |
| overlay | `is-visible` / `has-right` / `is-scroll-visible` 齐全；3 条可见列选择条 + 4 条行选择条；thumb `position:absolute` |
| 命中 | 首列 / 首行选择条 `elementFromPoint` 都命中 `.lark-doc-table-selector`（浮窗不再遮挡） |
| 整列选择 | `CellSelection` 生效，`.selectedCell` = 4，选择条 `is-selected` = 1 |
| 整列重排 | 拖动中 `is-reordering` + 预览卡「第 1 列 → 第 3 列」+ 竖向指示线；结果 `["结论","内容","理由",…]` → `["内容","理由","结论",…]` |
| 整行选择 | `.selectedCell` = 6，选择条 `is-selected` = 1 |
| 整行重排 | 拖动中 `is-reordering` + 预览卡「第 1 行 → 第 4 行」+ 横向指示线；首行被移到末行 |
| 浮窗 | ＋行 4→5 行、＋列 6→7 列 |
| 自绘滚动条 | 拖动到最右：`scrollLeft=707=maxScroll`，`has-left=true`、`has-right=false`，`thumbLeft=312px` |
| 列宽拖拽 | hover 出现 4~5 个 `.column-resize-handle`，拖 +60px 后 `<col style>` 与 `th[colwidth]` 同步 `260px → 321px` |
| 运行时错误 | `pageerror` / `console.error` 均为 0（favicon 404 已用 `<link rel="icon" href="data:,">` 消除） |

上述 4 项当时留待人工确认，现已全部落成开发并用真实浏览器实测，见 §13。

## 13. 验收缺口补齐与统一回归（2026-11-08 · 收尾轮）

### 13.1 本轮补强的开发

| 项 | 落点 | 说明 |
| --- | --- | --- |
| 键盘可达性 | `src/ui/tableOverlays.js` | 选择条 `role=button` / `tabindex=0` / `aria-pressed` / `aria-label`，Enter / Space 等价指针单击；自绘滚动条 `role=scrollbar` + `aria-valuemin/max/now` + `aria-orientation`，方向键 / Home / End / PageUp / PageDown 改 `scrollRatio`；浮窗为原生 `<button>`，Enter 走 click |
| 无障碍树 | `src/ui/tableOverlays.js` | 根节点去掉 `aria-hidden`（否则整棵可聚焦控件被读屏抹掉），只给纯装饰件（渐隐 / 指示线 / 吸附线 / 预览卡）单独隐藏 |
| 焦点环 | `src/components/lark-doc/lark-doc.css` | `:focus-visible` 描边走 `var(--ld-table-accent)`，不新增色值 |
| Delete / Backspace 删行列 | `src/components/lark-doc/editor/tableInteractionMixin.js` | window capture 拦截完整单行 / 单列 `CellSelection`，调 `deleteRow` / `deleteColumn` 并 `stopPropagation()`，避免 ProseMirror 自带 `deleteCellSelection` 只清空内容；普通单元格内退格放行；整表只剩 1 行 / 1 列时不删 |
| 打印 / 导出态 | 既有规则 | `@media print` 隐藏 overlay；overlay 挂在 `tableOverlayHost` 而非 ProseMirror doc，`getHTML()` 天然不含 |

### 13.2 统一回归结果

命令：`env -u NODE_OPTIONS ROLLUP_TARGET=all node scripts/build-rollup.mjs`，随后 `npm run check` / `check:quick` / `check:unit` / `check:theme-tokens` / `check:theme-contrast`，**六项全部 exit 0**。

| 门 | 结果 |
| --- | --- |
| 全量构建 | `Rollup all 全量构建完成，manifest 已写入 dist/lark-doc-manifest.json` |
| `npm run check` | 通过（含 deploy / code / ui / lint / artifacts 全链、Vditor 兼容 94 项、Rollup 产物检查） |
| `check:quick` / `check:unit` | 通过；`95 passed (95)` 文件、`2053 passed (2053)` 用例 |
| `check:theme-tokens` / `check:theme-contrast` | 通过；对比度合计 70 组、通过 68、豁免 2、失败 0（两项豁免是宿主既有取舍，非本次改动） |

浏览器验收：对最终产物跑 `/tmp/ld_final.cjs`（原 9 项交互）与 `/tmp/ld_extra.cjs`（本轮 9 组），`pageerror` / `console.error` 均为 0。

| 组 | 实测结果 |
| --- | --- |
| 原 9 项交互 | 全部通过：视觉 / 横滚 / overlay 几何 / 整列整行选择 / 整列整行重排（含预览卡）/ 浮窗加行列 / 自绘条拖到最右 `scrollLeft=707=maxScroll` / 列宽拖拽 `260px→321px` 且 `<col style>` 与 `th[colwidth]` 同步 |
| A11Y | 根节点 `aria-hidden=null`；装饰件全部隐藏；浮窗 5 个按钮均有 `aria-label`；选择条 `tabindex=0` / `aria-pressed=false`；滚动条 `role=scrollbar` / `tabindex=0` / `aria-valuenow=0` / `aria-orientation=horizontal` |
| KEY_SELECT | 聚焦首列选择条按 Enter → `CellSelection`，`.selectedCell=4` |
| DELETE_COL | `6 列 → 5 列`，行数保持 4 |
| DELETE_ROW | 点击首行选择条按 Backspace → `4 行 → 3 行`，列数保持 5 |
| PLAIN_BACKSPACE | 普通单元格内 End + Backspace，表格 shape 不变（不误删行列） |
| KEY_FLOAT | 聚焦「在右侧插入列」按 Enter → 列数 +1 |
| KEY_SCROLL | `End` → `scrollLeft=527=maxScroll` / `aria-valuenow=100` / `has-right=false`；`Home` → 归零 / `aria-valuenow=0` |
| THEMES | 6 种组合全部 `allResolved`；`dark-full` 边框 `#434343`、表头 `rgba(207,207,207,.08)`、浮窗 `#292929`；`feishu` 边框 `#dee0e3`、表头透明；`pcvue-dark` 边框 `#425756`；选择条随主题变化 |
| PRINT_EXPORT | `printDisplay=none` / `screenDisplay=block`；DOM 有 overlay 但 `getHTML()` 不含 `lark-doc-table-overlay`，且仍含 `<table` |

### 13.3 排查记录（两处读数假象，均非产品缺陷）

1. 主题脚本报 `getComputedStyle(null)`：前面 `DELETE_ROW` 删掉了含 `<th>` 的首行。改为在全新浏览器 context 里做主题 / 导出检查（顺带验证二次冷启动），另给 `th || td` 兜底。
2. 曾观察到「深色档选择条仍是浅色」：选择条有 `transition: background .12s`，切主题同帧读 computed style 拿到的是过渡起点。改为切主题后等 220ms 再读；同时补齐 `data-content-theme="dark"`——表格线 / 表头 token 属 content 轨，只设 `data-theme="dark"`（外壳深）不会切换，这是 `theme-dark.css` 既有的 chrome / content 分层，不是本次改造引入。修正后 6 种组合的边框、表头、浮窗、选择条均正确随主题切换。

**§13 那一轮未改动产品代码**，仅补强验收脚本并修订文档；产品改动已在第 11 节描述的那一轮完成。

## 14. 收尾补强：触屏手势与 hover-only 浮窗（2026-11-08）

按「先开发、后统一回归」再做一轮实现层审查，找到并修掉两个真实缺陷（不是读数假象）：

| # | 缺陷 | 修法 | 落点 |
| --- | --- | --- | --- |
| 1 | 触屏下按住选择条横移会被浏览器判成页面平移，随后发 `pointercancel`，拖拽重排 / 自绘滚动条拖不动；且部分 Safari 触屏 `pointerdown` 的 `button` 不是 0，被无条件主键判断吞掉 | 选择条 / 滚动条加 `touch-action: none`（选择条另加 `user-select: none`）；`button !== 0` 改为只在 `pointerType === 'mouse'` 时校验；`startDrag` 与滚动条手势显式 `setPointerCapture` 到命中节点、`detach` 时 `releasePointerCapture`，避免触屏 implicit capture 因节点被摘除而中断；滚动条再加 `cleanupScroll?.()` 防监听叠加 | `lark-doc.css`、`src/ui/tableOverlays.js` |
| 2 | overlay 挂在独立的 `tableOverlayHost`，不在 `.tableWrapper` 内。鼠标从表格移向浮窗时 `pointerout` 会清掉 hover，导致「只 hover、未点进表格」时浮窗在鼠标靠近瞬间自己消失，按钮点不到（与既有 `keepTableBoundaryHover` 同类问题） | `pointerout` 时若 `relatedTarget` 落在 overlay 内则保留 hover，真正移出才复位；同时给 `contains()` 加 `nodeType` 判定，防 `relatedTarget` 为 Window / null 时抛 TypeError | `src/components/lark-doc/editor/tableInteractionMixin.js` |

**核查后明确不改**：`window.resize` 已由 `nativeEditorHost.js` 的 `listen(window, 'resize', host.onDocumentScroll)` → `refreshTableOverlays()` 覆盖，不是缺口；四套主题色、`workspaceShell.js` 字符串断言面、`examples/element-demo.html`、生产门禁均未动，也未新增任何颜色字面值。

### 14.1 统一回归（一次性跑完，全部 exit 0）

命令：`env -u NODE_OPTIONS ROLLUP_TARGET=all node scripts/build-rollup.mjs`，随后 `npm run check` / `check:quick` / `check:unit` / `check:theme-tokens` / `check:theme-contrast`，再跑三轮 headless Chromium 验收。

| 门 | 结果 |
| --- | --- |
| 全量构建 | `Rollup all 全量构建完成，manifest 已写入 dist/lark-doc-manifest.json` |
| `npm run check` / `check:quick` | 通过（含 lint、artifacts、Vditor 兼容、Rollup 产物预算与协同 external 约束） |
| `check:unit` | `95 passed (95)` 文件 / `2053 passed (2053)` 用例 |
| `check:theme-tokens` | 通过：308 文件、存量违例 0、新增 0 |
| `check:theme-contrast` | 通过：70 组、通过 68、豁免 2、失败 0（`pcvue-dark` 次级文字为宿主既有保真取舍） |
| 浏览器 · 原 9 项 | 全通过：视觉 / 横滚 / 整列整行选择 / 重排 / 浮窗 / 自绘条 `scrollLeft=707=maxScroll` / 列宽 `260→321px`；`ERRORS []` |
| 浏览器 · 补齐 9 组 | 全通过：A11Y / KEY_SELECT / DELETE_COL / DELETE_ROW / PLAIN_BACKSPACE / KEY_FLOAT / KEY_SCROLL / 6 种主题组合 / PRINT_EXPORT；`ERRORS []` |
| 浏览器 · 本轮 5 组 | 全通过，见下表；`ERRORS []` |

`/tmp/ld_touch.cjs` 用合成 `pointerType: 'touch'`、`button: -1` 的 PointerEvent 验证触屏路径：

| 组 | 实测结果 |
| --- | --- |
| TOUCH_STYLE | 选择条 `touch-action=none` / `user-select=none`，滚动条 `touch-action=none` |
| TOUCH_SELECT | 合成 touch 点首列 → `CellSelection`，`.selectedCell=4`，选择条高亮 1 个（主键判断不再吞触屏） |
| TOUCH_REORDER | 合成 touch 拖拽第 1 列 → 第 3 列，预览卡「第 1 列 → 第 3 列」，表头顺序 `结论/内容/理由…` → `内容/理由/结论…` |
| TOUCH_SCROLL | 合成 touch 拖自绘条 → `scrollLeft=682=maxScroll`，`aria-valuenow=100` |
| HOVER_FLOAT | 全新 context 只 hover 不点表格；鼠标移到浮窗后 overlay 仍 visible、`elementFromPoint` 命中「在右侧插入列」，点击后 6 列 → 7 列 |

### 14.2 排查记录（测试脚本不真实，非产品缺陷）

首轮 `/tmp/ld_touch.cjs` 出现 6 个 `pageerror: Failed to execute 'contains' on 'Node'`，堆栈指向既有 `onDocumentPointerMove`：合成 `pointermove` 被派发到 `window`，而真实指针事件的 `target` 永远是 Element，`contains(window)` 才抛错。改为派发到 `document.body`（window 的 capture 监听照样收得到，`target` 是合法 Node）后 `ERRORS []`。同时仍给新增的 `overlay.contains(related)` 加了 `nodeType` 判定作为防御。

**边界**：本轮只改 `lark-doc.css` / `tableOverlays.js` / `tableInteractionMixin.js`，外加文档与 `/tmp/ld_touch.cjs`；主工作区未被触碰，未 commit / push / 部署。仍需人工过一眼：真机触屏（尤其 iOS Safari）、真实读屏器播报、四套主题主观观感、打印实际出纸效果。

## 15. 交付前一次性统一回归（2026-11-08）

用户再次要求「先开发、最后统一测试回归」。先核对状态再做回归：`feat/md-table-interaction` 上 7 个改动/新增文件齐全，新增源码中无 `TODO` / `FIXME` / 未实现标记，9 个任务全部 completed——开发已收口，本轮**不重复改产品代码**，只做一次性全量回归。

命令：worktree 根目录先 `unset NODE_OPTIONS`（WorkBuddy 注入的 stdout shim 会让 rollup 写 `EPIPE`），再 `ROLLUP_TARGET=all node scripts/build-rollup.mjs`，随后 `npm run check` / `check:quick` / `check:unit` / `check:theme-tokens` / `check:theme-contrast`，最后三轮 headless Chromium 验收。

| 门 | 结果 |
| --- | --- |
| 全量构建 | exit 0，`Rollup all 全量构建完成`，manifest 已写入 `dist/lark-doc-manifest.json` |
| `npm run check` | exit 0（部署/离线/包导出、核心代码、UI 主题、lint、产物预算与 legacy 语法） |
| `check:quick` | exit 0（架构、契约、lint） |
| `check:unit` | exit 0（vitest 全量） |
| `check:theme-tokens` | exit 0，308 文件、存量违例 0、新增 0 |
| `check:theme-contrast` | exit 0，70 组、失败 0（`pcvue-dark` 次级文字为宿主既有保真取舍） |
| 浏览器 · 原 9 项 | exit 0，`SCROLL scrollLeft=707=maxScroll`、`RESIZE 260→321px`、行列重排与浮窗增行增列均生效，`ERRORS []` |
| 浏览器 · 补齐 9 组 | exit 0，A11Y / 键盘选中 / Delete 删列删行 / 普通退格不动结构 / 键盘插列 / 键盘滚条 / 6 种主题 / 打印导出，`ERRORS []` |
| 浏览器 · 触屏 hover 5 组 | exit 0，touch 选中/重排/滚动与 hover-only 浮窗 6→7 列，`ERRORS []` |

**浏览器脚本运行前提（本轮新记录）**：`/tmp/ld_*.cjs` 位于 `/tmp`，Node 从脚本所在目录向上解析 `node_modules`，拿不到仓库侧依赖，3 个脚本首跑全部 `MODULE_NOT_FOUND: playwright-core`。补 `NODE_PATH=/Users/cjjxw/.npm/_npx/31e32ef8478fbf80/node_modules`（`playwright-core` 1.65.0-alpha-2026-10-30，配套 `chromium-1247`）后 3 个脚本全部 exit 0、`ERRORS []`。这是验收脚本的环境依赖，不是产品缺陷；后续复跑请带上该 `NODE_PATH`。

**边界**：本轮未改产品代码，仅补文档 §15；主工作区未触碰，未 commit / push / 部署。预览 `http://127.0.0.1:8123/examples/element-demo.html` 与 `/dist/lark-doc.common.js` 均 200。仍需人工过一眼：真机触屏（尤其 iOS Safari）、真实读屏器播报、四套主题主观观感、打印实际出纸效果。

## 16. 边界 ＋ 被遮挡修复 + 最终统一回归（2026-11-08）

用户在实际预览里验收功能点，反馈「➕，被挡住了，没显示出来」。§15 回归虽全绿，但覆盖的是新增 overlay 交互件，**没有覆盖旧边界 ＋ 与 overlay 叠在一起后的真实可见性**，属验收盲区，不能据此判定交付完成。

### 16.1 根因（浏览器实测量出的 4 条）

| # | 缺陷 | 实测证据 |
| --- | --- | --- |
| 1 | 层级倒挂 | `.lark-doc-table-overlay` 是 `fixed / z-index:20`；旧 `.lark-doc-table-boundary-tools` 是 `absolute / z-index:18`。上方 ＋ 上半部最上层是 `.lark-doc-table-selector.is-column`，下方 ＋ 上半部是 `.lark-doc-table-scrollbar-thumb` |
| 2 | 浮出距离不足 | 12px 列选择条 / 14px 自绘滚动条正好压住 18px 圆点 |
| 3 | 宿主裁切 | 旧边界条挂在 `.lark-doc-paper`，坐标是 paper 相对值；`examples/element-demo.html` 的 `lark-doc { height:620px; overflow:hidden }` 直接把表格下方 ＋ 裁掉 |
| 4 | 验收脚本语义不对 | v1 用 `insideHost` 判 fixed 浮层、用纯矩形 overlap 判遮挡、不 hover 就数 `.column-resize-handle`（那是 prosemirror-tables hover 列边界时才瞬时插入的 DOM） |

### 16.2 修复

| 落点 | 改动 |
| --- | --- |
| `lark-doc.css` | 边界条改 `position:fixed; z-index:30`；上下 ＋ 用 `--lark-doc-boundary-plus-top/-bottom` 变量，默认 `-28px / -20px`；左右 ＋ 保持 `-20px` |
| `tableToolsMixin.js` | `updateTableBoundary()` 的 `style` 从 paper 相对坐标改成 `tableRect` 的 viewport 坐标；新增 `plusUp/plusDown` 视口余量钳制 |
| `tableToolsUiMixin.js` | `buildTableBoundaryState()` 透传 clamp 值 |
| `tableTools.js` | `setVar()` 把 clamp 值写入两个 CSS 变量；同步修正阶段 5G 遗留的 `position:absolute` 注释 |

**关键二次修复**：首版 clamp 用 `Math.max(0, ...)` 把下限锁在 0。实测「插入一列 → 文字折行 → 表格高度 245→331px、底边 876→963px 超出 900px 视口」时，下方 ＋ 仍随表格底线落到 `cy=962.8`，`elementsFromPoint` 返回 `null`，点击「在右侧插入列」不生效（列数 7→7）。改为允许负值、`edge=12`（18px 圆点半高 9px + 3px 余量）：

```js
const viewportH = window.innerHeight || document.documentElement.clientHeight || 0
const edge = 12
const plusUp = viewportH ? Math.min(28, tableRect.top - edge) : 28
const plusDown = viewportH ? Math.min(20, viewportH - tableRect.bottom - edge) : 20
```

负值时 ＋ 顺着表格边线回退到视口内（实测 `--lark-doc-boundary-plus-bottom: 74.75px`、下方 ＋ `cy=888`、9 点 `allMe=true`、列数 7→8）。`window` 的 scroll / resize 已由 `nativeEditorHost.js` 的 `onDocumentScroll()` → `updateTableBoundary()` 覆盖，fixed 坐标随滚动刷新。

### 16.3 两个残留 FAIL 的定位

| FAIL | 结论 | 证据 |
| --- | --- | --- |
| `点击 ＋ 在右侧插入列 {"before":7,"after":7}` | 产品缺陷，即 16.2 的 clamp 下限 | `/tmp/ld_diag2.cjs` A4/A5/A6/A7 逐步打印；修复后 7→8 |
| `列宽拖拽手柄存在（hover 列边界后） {"handles":0}` | 非独立产品缺陷，是前一条插入失败连带的状态差异 | `/tmp/ld_diag3.cjs` 复现 v2 完整序列，精确 hover 点 `handles=6`；干净态 / 整列 CellSelection 态 / 恢复态 hover 列边界均为 4~6 |

### 16.4 最终一次性统一回归（全部 exit 0）

| 门 | 结果 |
| --- | --- |
| 全量构建 | `unset NODE_OPTIONS && ROLLUP_TARGET=all node scripts/build-rollup.mjs`，3m25s，exit 0，manifest 已写入 |
| `npm run check` | exit 0（Vditor 94 项、产物预算、协同 external） |
| `check:quick` | exit 0（架构、契约、eslint） |
| `check:unit` | exit 0，95 文件 / 2053 用例 |
| `check:theme-tokens` | exit 0，308 文件、存量 0、新增 0 |
| `check:theme-contrast` | exit 0，70 组、通过 68、豁免 2、失败 0 |
| 浏览器 · 原 9 项 / 补齐 9 组 / 触屏 hover 5 组 | 三轮 exit 0，`ERRORS []` |
| 浏览器 · ＋ 可见性 + 功能点 | exit 0，22 项 PASS，`TOTAL_FAILED=0`（含四颗 ＋ 真实插入、避开选择条/滚动条、不抢占三者点击、列宽手柄） |
| 浏览器 · 表格工具条 DOM 契约 | exit 0，15 项 PASS，`TOTAL_FAILED=0` |

**契约脚本说明**：仓库自带 `scripts/verify-browser-table-tools.js` 要求 `/lark-doc` Vue2 dev server 与 `window.__larkDoc`，当前 8123 静态预览该路径为 404，本轮未跑；改由 `/tmp/ld_contract.cjs` 在真实预览产物上复刻其 `measureBoundary` / `measureTableTools` 断言：根节点 `role=toolbar` / `aria-label`、子节点 `span+button+button`、线 `aria-hidden`、列/行 CSS 变量互斥、13 颗按钮、原生 `input[type=color]` 默认 `#f2faf6`、两个下拉、fixed `z=30`、viewport 坐标盒子、点击真的加列——全部通过。

**注释改动的等价性证明**：同步 `tableTools.js` 历史注释后重建 element，`dist/lark-doc-element.umd.min.js` 的 SHA-256 前后均为 `219a338c…c6fd483`，`npm run lint` exit 0；注释不进产物、运行时零变化，上表全量回归对最终源码仍成立。

**边界**：本轮改动文件为 `lark-doc.css`、`tableToolsMixin.js`、`tableToolsUiMixin.js`、`tableTools.js` 与本文档；主题色仍只转发既有 `--ld-*` token，未新增颜色字面值。主工作区产品代码未触碰，未 commit / push / 部署。预览 `http://127.0.0.1:8123/examples/element-demo.html` 与 bundle 均 200。仍需人工过一眼：真机触屏（尤其 iOS Safari）、真实读屏器播报、四套主题主观观感、打印实际出纸效果。
