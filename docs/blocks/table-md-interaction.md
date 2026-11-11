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

---

## 17. v4 收尾：单 ＋ / 格式浮窗 1:1 与最终验收（2026-11-08）

> **本节是当前生效口径**。§1–§16 中「表格上方胶囊 `AI编辑｜B I U S｜复制 删除`」、
> 「一条边线两颗 ＋（`is-column-before/after`、`is-row-before/after`）」、
> 「DOM 子节点 `span+button+button`」、「行列插入浮窗」，以及 §16.4 里
> 「仓库脚本未跑、改由 `/tmp/ld_contract.cjs` 复刻」的描述，都是 v3 历史方案，已被本节取代。

### 17.1 用户逐条反馈 → 最终契约

| 用户反馈 | 最终实现 |
| --- | --- |
| 「一条线一个 +」「+号是单个的 不是一条线两个+号」 | 边界条恒为 `line(条件挂载) + 1 颗 button`；列态 `lark-doc-table-col-plus-btn`、行态 `lark-doc-table-row-plus-btn`；18px 可见圆点走 `::before`，button 只是 32px 透明热区 |
| 「➕ 所在的线，只是在表格内，没有超过表格」 | `buildTableBoundaryState()` 里 `lineLength = hover === 'row' ? tableWidth : tableHeight`；列线 `height=表格高`、行线 `width=表格宽` |
| 「上边弹窗内容不对」 | 浮窗改为 `markdownFloatingItemsFactory` 语义 `[AI, sep, B, I, U, S, </>, 链]`，不是行列插入条；AI→`ai-request`、link→`openLinkDialog`、格式→`toggleMark` |
| 「弹窗一直在」「弹窗在点击表格最上边，左边，才会显示，然后点击其他地方隐藏」 | `tableFloatOpen` 由 window capture `pointerdown` 离散驱动：默认不挂载（`syncChildren` 真的摘除，不是 `display:none`）；hover-only 不出现；点表格块出现；点表格外 / Escape / `tableUiActive()` 为假即收起；再点再出现 |
| 「最左边 最上面 鼠标悬浮上去 是没有+号的」 | 候选边线只收单元格**右 / 下**内部边界，外边缘不产生 ＋；首列左侧 / 首行上方插入走工具条「左侧加列 / 上方加行」 |
| 「➕ 被挡住了，没显示出来」 | 边界层 `position: fixed` + viewport 坐标 + `z-index: 30`，避开宿主 `overflow:hidden` 裁切与 md overlay 遮挡 |
| 「主题颜色还使用 lark-doc 默认颜色」 | 全部 `--ld-table-*` 转发既有 `--ld-*` token，未新增颜色字面值 |

### 17.2 真源取证与取舍

- CSS `…/renderer/assets/dist-eTnrGI8p.css`：`sc-table-col-plus-zone` / `sc-table-row-plus-zone` / 18px 圆点 / 2px hover line。
- JS `…/renderer/assets/dist-DssmJYZd.js`：`o$34()` 构造 `colDividers` / `rowDividers`，`s$30()` 首列左边界 `leftColIndex: -1`，`b$11()` 越界闸门，`h$18()` 内部边线选择跳过 `< 0`，`a$33()` 是 `nearestIdx` hook。
- **取舍**：真源 bundle 仍有 `is-leftmost` / `is-topmost` 特殊 zone，但用户对照截图明确「最左边、最上面悬浮没有 +」，`h$18()` 也跳过 `leftColIndex < 0`。以**可见交互**为准，不把外边缘当候选。
- hover line 条件挂载对齐真源 `Ee && ye` / `_e &&`：`lineVisible: !!boundary.plusActive`，只在 ＋ 被 hover / focus 时进 DOM。

### 17.3 改动文件

`scripts/verify-browser-table-tools.js`、`src/components/lark-doc/editor/tableInteractionMixin.js`、
`tableToolsMixin.js`、`tableToolsUiMixin.js`、`src/components/lark-doc/lark-doc.css`、
`src/ui/tableOverlays.js`、`src/ui/tableTools.js` 与本文档。`src/web-component/` 未触碰。

### 17.4 最终统一回归（全部 exit 0）

| 门 | 结果 |
| --- | --- |
| `npm run lint` | exit 0 |
| 全量构建 `ROLLUP_TARGET=all` | exit 0，`dist/lark-doc-element.umd.min.js` / `lark-doc.css` 重建 |
| `check:quick` | exit 0 |
| `check:unit` | exit 0，95 文件 / 2053 用例 |
| `npm run check` | exit 0（产物 25/25、Vditor 94 项、产物预算、协同 external） |
| 浏览器 `verify.mjs table-tools`（8123） | **51/51 PASS**：格式浮窗 12 项、表格工具条 13 项、边界 ＋/hover line/外边缘 16 项、md 浮层几何（选择条 / 渐隐 / 滚动条 / 点选整列 / 拖拽重排）6 项、只读态 3 项、无脚本错误 1 项 |

验收脚本已重写为 v4 契约，宿主门面同时兼容 8080 `window.__larkDoc` 与 8123 `<lark-doc>`。
页面内函数必须自包含：`page.evaluate` 会把函数单独序列化到浏览器，Node 层顶层变量在页面里不存在；
另需避免两行连续以 `(` 开头被 ASI 连成一次函数调用。
`/tmp/ld_plus_accept.cjs`、`ld_popup_accept.cjs`、`ld_final.cjs` 仍是 v3 旧双按钮契约，已废弃，不再作为验收依据。

### 17.5 已知遗留（与本轮无关）

`verify.mjs element` 在 8123 宿主上 12/14：两条 FAIL 都是「移除后重新插入恢复标签内 slot 初始内容」
（重建后仍是上一次 `setContent('覆写成功…')`）。本轮未改 `src/web-component/LarkDocElement.js`，
也未改该验收脚本，属既有 Web Component 生命周期缺陷，需单独立项，不影响表格交互 1:1。
`verify.mjs overlays` 是分享 / 权限 / 导出浮层，依赖 8080 Vue2 dev server，与表格改造无关，未跑。

### 17.6 预览

`http://127.0.0.1:8123/examples/element-demo.html`（静态服务，200）。仍需人工过一眼：
真机触屏（尤其 iOS Safari）、真实读屏器播报、四套主题主观观感、打印实际出纸效果。
本轮未 commit / push / 部署。

---

## 18. v5：单一浮窗 · 双模式互斥（本节为当前生效口径）

> **口径推翻声明**：§17 及其 17.1–17.6 描述的是 v4「格式浮窗 + 点表格块即显示 / 两个浮窗并存」的实现与回归结论，
> **已整体作废**，不再作为验收依据。17.4 的 51/51 与「验收脚本已重写为 v4 契约」同样只作历史留档。
> 本节起以用户最终反馈为最高优先级：
> 「选中 table 的文字，和点击最上边、最左边出来的弹窗，功能操作栏是不一样的，要注意」。

### 18.1 结构：全页面只有一个浮窗 DOM

- 唯一节点 `.lark-doc-table-tools`（等价真源 `sc-floating-toolbar`），`position: fixed`，`z-index: 40`。
- 旧 `.lark-doc-table-float*` 是 v4 的**第二个**浮窗 DOM，已从 `src/ui/tableOverlays.js` 与 CSS 整层删除，页面内节点数必须为 0。
- `src/ui/tableOverlays.js` 回归纯几何层：edge / scrollbar / dropLine / snap / dragCard / selectorLayer，不挂任何浮窗。
- 两套 items 由 `src/ui/tableTools.js` 用 `syncChildren(parent, slots)` **真摘除 / 真挂载**切换，
  以 `el.dataset.mode` + `.is-text-mode` / `.is-table-mode` 标记，绝不用 `display:none` 假装切换，两套绝不并存。
- `mountNode(host, node, on)` 负责唯一节点在宿主上的挂 / 摘；`placeFloatingToolbar()` 必须在挂载后量尺寸再定位。

### 18.2 两套互斥 items

| mode | 触发选区 | items |
| --- | --- | --- |
| `text` | 表格**内**、非空 `TextSelection` | `[AI, sep, B, I, U, S, </>, 链]` 文本格式栏 |
| `table` | 点击最上列选择条 / 最左行选择条产生的整行整列 `CellSelection`（且 `tableSelectedLine` 存在） | 13 个 `tableActions` + 背景色 `input[type=color]` + 两个对齐下拉 |

- 其它选区（折叠光标、表格外选区、局部框选单元格 `CellSelection` 但无整行整列标记）一律 `{ open: false }`。
- 判定入口 `buildTableToolsState()`（`tableToolsUiMixin.js`）直接读实时 `this.editor.state.selection`，不维护开合状态机。
  `tableTextSelectionInTable()` 用 `$from.before(fromDepth) === $to.before(toDepth)` 保证两端落在同一张表内。
- 回调分离：`onAction(id) → tableAction(id)` 只服务 `table` 模式；`onTextAction(id) → tableTextAction(id)` 只服务 `text` 模式。
  `tableTextAction` 分发 `ai-edit → $emit('ai-request','rewrite')`、`link → openLinkDialog(true)`、
  `bold/italic/underline/strike/code → toggleMark(id)`。
- 根节点与每颗按钮均 `mousedown.preventDefault()`，避免点击浮窗时浏览器清掉 ProseMirror 的 `TextSelection` / `CellSelection`。
- anchor：`tableTextAnchor()` 取 `coordsAtPos(from/to)` 水平居中并压到表格 `rect.top - 12` 之上（不遮 12px 列选择条）；
  `tableToolbarAnchor()` 整列 `placement:'top'`、整行 `placement:'left'`。

### 18.3 离散点击驱动（不是 hover 常驻）

- `tableUiActive()` 管 hover / 键盘 / 拖拽活跃；`tableToolsDismissed()` 是**独立**的 dismiss 闸门，只认「点其它地方 / Escape」。
- `_tableUiOnPointerDown` 在 window capture 阶段：
  点表格块 / overlay / 边界条 / 浮窗 → 解除 dismissed；点其它地方 → 置 dismissed，并立即 `refreshTableUiVisibility()`。
- Escape 同时置 `_tableUiEscape` / `_tableUiToolbarDismissed`；后续键盘操作只解除 escape，**不**解除 dismissed，
  必须重新点击表格才再次浮出。仅 hover、折叠光标、程序化恢复选区都不出现浮窗。
- 只读、非表格态、打印 / 导出态一律收起；`@media print` 隐藏 `.lark-doc-table-overlay` / `.lark-doc-table-tools` / `.lark-doc-table-boundary-tools`。
- 几何层契约不变：一条内部边线只有单颗 `＋`，hover line 只在 `＋` 被 hover / focus 时挂进 DOM，线只在表格内不溢出，最左 / 最上外边缘不产生 `＋`。
- 主题色继续全部转发 `--ld-table-float-*` → `--ld-*` 既有 token，不引入 WorkBuddy 颜色字面值。

### 18.4 与需求文档 `table-md-interaction-requirements.md` 的两处取舍

用户同时给了「按需求文档改造」和「最终口径覆盖所有历史结论」，两处冲突按 **当次用户反馈 > 历史文档** 处理，记录在此以免后续反复：

1. **文本格式栏顺序**：需求文档 §6.3 / §9 写「链接在行内代码之前」（`… S 链接 </>`），
   用户最终口径给的是 `[AI, sep, B, I, U, S, </>, 链]`。实现保留 **`</>` 在 `链` 前**。
2. **状态 B 内容**：需求文档 §6.3 的 md surface 白名单是
   `[AI 编辑] | [B I U S(table 作用域)] | [创建副本] [删除 {{count}} 行(列)]`；
   用户最终口径要求表格操作栏包含合并拆分、颜色、对齐、增删行列、复制 / 清空 / 删除等。
   实现保留现有 **13 个 `tableActions` + 背景色 + 两个对齐下拉**，不换成白名单短栏。

### 18.5 改动文件

`src/ui/tableTools.js`（唯一浮窗双模式 DOM）、`src/ui/tableOverlays.js`（删第二浮窗）、
`src/components/lark-doc/editor/tableInteractionMixin.js`（清破损 `tableFloatOpen` 状态机、几何层 / 双闸门 / `tableTextAction`）、
`tableToolsUiMixin.js`（双模式 state / anchor / 回调接线）、`lark-doc.css`（fixed 浮窗、删 `.lark-doc-table-float*`、打印隐藏）、
`scripts/verify-browser-table-tools.js`（重写为 v5 契约）与本文档。
`docs/blocks/table-md-interaction-requirements.md` 为用户提供的需求输入，未修改。

### 18.6 回归（收尾阶段实跑结果）

统一回归在 `feat/md-table-interaction` worktree 内串行执行，未 commit / push / 部署，未触碰主工作区。

| # | 门禁 | 命令 | 结果 |
| --- | --- | --- | --- |
| 1 | lint | `npm run lint` | **PASS**（exit 0） |
| 2 | 快速门 | `npm run check:quick` | **PASS**（architecture R1/R2/R3 + contract + lint） |
| 3 | 全量构建 | `ROLLUP_TARGET=all node scripts/build-rollup.mjs` | **PASS**（exit 0，清理旧哈希区块 90 个，写入 `dist/lark-doc-manifest.json`；`lark-doc-element.umd.min.js` / `lark-doc.css` 均重建且晚于最后一次源码改动） |
| 4 | 浏览器验收 | `LARK_DOC_VERIFY_URL=http://127.0.0.1:8123/examples/element-demo.html node scripts/verify.mjs table-tools` | **PASS 59/59**（最终状态复跑 21.2s，exit 0） |
| 5 | 单测（默认超时） | `npm run check:unit` | **未全绿**：5 个 `Test timed out in 5000ms`，2048 passed / 2053 |
| 6 | 完整门（默认超时） | `npm run check` | **未全绿**：`check:gate` 的 deploy / code / ui / lint 静态门全部 PASS；`check:unit` 7 个超时；`check:artifacts` 因前置失败未执行 |
| 7 | 产物门（补跑） | `npm run check:artifacts` | **PASS**（exit 0：158 个真实入口语法、Vditor 94 项、Rollup 体积预算全部通过） |
| 8 | 全量单测（加长超时） | `npx vitest run --testTimeout=30000` | **未全绿**：1992 passed / 1994，余 1 个 30s 超时 + 共享缓存 `ENOENT`；失败集合与 #5/#6 不同 |
| 9 | 失败文件单独串行复验 | `build-contract`（38/38）、`adapter-options` + `build-contract` + `collab-dependencies` + `legacy-vue-adapters`（72/72）、`dom-renderer-contract`（59/59） | **全部 PASS**（exit 0），门禁中出现过的失败测试逐个通过 |

浏览器验收 59 项覆盖：页面内唯一浮窗节点、旧 `.lark-doc-table-float` 为 0、text / table 两套 items 互斥且内容正确、
触发与消失条件（点其它地方 / Escape / 只读 / 折叠光标 / 仅 hover / 程序化恢复选区）、B→A 同节点切换、
单 `＋` / hover line / 几何不溢出 / 外边缘无 `＋` / 无脚本错误。
首次浏览器验收为 57/59，两项失败定位为 `rebuildActions()` 建按钮时漏传 `id: item.id`，导致 `onAction(undefined)`；
已在 `src/ui/tableTools.js` 修复并重建产物，复跑 59/59。

#### 18.6.1 遗留项（如实说明，不宣称门禁全绿）

1. **默认超时的 `check:unit` / `check` 未全绿**。两次全量跑的失败集合互不一致，且 #5/#6/#8 的全部失败均为
   `Test timed out` 或 `ENOENT: /Users/cjjxw/codex/node_modules/.vitest-cache/6ff1759d…`，**没有任何断言失败**；
   日志显示 `environment 62~64% / import 21%`。判因：本机并行负载下 5000ms 默认超时不足，加上多 worktree
   共用 `node_modules/.vitest-cache` 的并发清理竞态，与本次表格 UI 改动无关（失败文件为
   `adapter-options` / `build-contract` / `collab-dependencies` / `legacy-vue-adapters` / `dom-renderer-contract`，
   均不依赖本次改动的浮窗逻辑）。#9 已逐个复验通过，但未改动仓库测试配置来「刷绿」。
   建议在空闲环境串行重跑 `npm run check:unit && npm run check` 取得全绿记录。
2. **需求文档两处口径取舍**见 §18.4（文本栏顺序、状态 B 内容），按用户最终口径实现，需产品侧确认后才回改。
3. 按交接要求：未新建分支 / worktree，未 commit / push / 部署，未触碰主工作区；
   `docs/blocks/table-md-interaction-requirements.md` 为用户提供的输入，保持未跟踪状态未修改。

## 19. v6：第二轮实测反馈 7 条（当前生效口径）

用户在同一 demo 页实测后提出 7 条反馈（附 5 张 2x DPI 截图）。逐条修复如下，
总原则不变：颜色只走 `--ld-*` / `--ld-table-*` token，浮层全部原生 DOM，打印态隐藏。

| # | 用户反馈 | 根因 | 修复 |
| --- | --- | --- | --- |
| 1 | 悬浮单元格时行内出现蓝色小竖条（红框处） | `.column-resize-handle::after` 胶囊默认 `opacity:.5` 常显 | `lark-doc.css`：默认 `opacity:0`，仅 `:hover` / 拖拽中（`.ProseMirror.resize-cursor`）亮起。注：当前未启用 ColumnResizing，demo 里本就无手柄节点，规则为防御性 |
| 2 | 行列选择条只在**点击表格后**出现，不能悬浮即出 | `refreshTableOverlays()` 只要 hover 活跃就画全部选择条 | `tableInteractionMixin.js` 新增 `_tableUiClicked` 离散点击闸门（点进表格 / 点选择条置 true，点外部 / Escape 置 false），选择条只在闸门放行 / 键盘模式 / 已有 CellSelection 时绘制 |
| 3 | 只有**点击选择条**才出功能浮窗；点击任何其他地方才消失 | `buildTableToolsState()` 叠加了 hover 型 `tableUiActive()` 闸门，鼠标移开表格浮窗就被收走 | `tableToolsUiMixin.js`：移除 `tableUiActive() === false` 前置，显隐只认 `tableToolsDismissed()` 离散点击闸门（点外部 / Escape 收起点回表格 / 点选择条复位） |
| 4 | 选中表格文字后出文本弹窗，点击其他地方消失 | 同 #3 | 同 #3（text 模式同走 dismiss 闸门；选区变化 / 折叠照旧收起） |
| 5 | 不允许两个功能浮窗同时出现 | — | v5 已是单 DOM 双模式互斥（§18），本轮回归断言继续覆盖：`count===1 && legacy===0`、A/B 切换同节点 |
| 6 | ＋按钮外圈多一圈颜色，不要 | `button::before` 带 `box-shadow: var(--ld-shadow-boundary)` 光晕 | `lark-doc.css`：删除该 box-shadow（token 定义保留，preset 主题仍映射真源 token） |
| 7 | 悬浮两单元格交界处需**高亮边线 + ＋号** | `lineVisible: !!boundary.plusActive` 让线只在＋被 hover 时挂 DOM | `tableToolsUiMixin.js`：`lineVisible: true`——open 闸门已保证只在 hover 内部边线时进入，线随 hover 常亮 |

### 19.1 改动文件

`src/components/lark-doc/lark-doc.css`（#1 #6）、`src/components/lark-doc/editor/tableInteractionMixin.js`
（#2 `_tableUiClicked` 闸门 + `refreshTableOverlays()` 选择条放行条件）、
`src/components/lark-doc/editor/tableToolsUiMixin.js`（#3 #4 #7）、
`scripts/verify-browser-table-tools.js`（契约同步 v6：翻转旧「未 hover ＋ 线不在 DOM」断言、
新增 4 条 v6 断言）与本文档。

### 19.2 回归（实跑结果）

| # | 门禁 | 命令 | 结果 |
| --- | --- | --- | --- |
| 1 | lint（3 个改动 JS） | `npx eslint <改动文件>` | **PASS**（exit 0） |
| 2 | 全量构建 | `ROLLUP_TARGET=all node scripts/build-rollup.mjs` | **PASS**（exit 0，清理旧哈希区块 93 个，manifest 重建） |
| 3 | 浏览器验收 | `node scripts/verify-browser-table-tools.js http://127.0.0.1:8123/examples/element-demo.html`（NODE_PATH 指向全局 playwright-core） | **PASS 63/63**（59 项 v5 契约 + 4 条 v6 新断言：hover 不画选择条 / 点击后 col=2 row=2 / ＋无光晕 / hover 边线即亮线；无脚本错误） |

v6 断言明细（全部 PASS）：

- `[浮层 v6] 只 hover 表格（未点击）→ 行列选择条不画`（col=0 row=0）
- `[浮层 v6] 点进表格后 → 2 列 + 2 行选择条出现`（点击闸门放行）
- `[边界条 v6] ＋ 按钮无外圈光晕`（`::before box-shadow = none`）
- `[边界条 v6] 悬浮内部边线（未碰＋）→ hover line 即挂进 DOM`（`is-column-line`）
- `[边界条] 列态恰好一颗 ＋ + 1 条 hover line`（`childTags = span,button`，随 #7 更新）

### 19.3 语义边界（如实说明）

1. **浮窗消失口径**：点其它地方 / Escape 收起；鼠标仅移开表格（未点击）浮窗保持 ——
   与 v5 的「hover 离开即收」不同，这是用户本轮的明确口径。几何层（选择条 / 滚动条）
   仍跟随 hover 活跃度显隐，但受 `_tableUiClicked` 闸门约束。
2. **键盘可达性**：`_tableUiKeyboardMode` / 已有 CellSelection 时选择条照常绘制，
   Tab 到选择条、Shift+方向整行整列选区不受点击闸门影响。
3. 本轮未重跑 `check:unit` / `check` 全门（失败集合与本次改动无关的历史超时问题见 §18.6.1）；
   未 commit / push / 部署，未触碰主工作区。

## 20. v8：用户第二轮截图复核 —— 4 个真实残留缺陷（当前生效）

用户对 v6/§19 的「63/63 通过」提出质疑并附上 4 张新截图。**复核结论：4 个都是真缺陷**，
v6 的浏览器验收存在两处假阳性 / 漏检，v6 的两条修复本身也有反噬。以下按截图逐条记录。

| # | 用户反馈 | 真实根因 | 修复 |
| --- | --- | --- | --- |
| 1 | 蓝色胶囊竖条还在 | v6 为「拖拽中显示」加了 `.ProseMirror.resize-cursor .column-resize-handle::after{opacity:1}`，但 `resize-cursor` 挂在**编辑器根节点**上：鼠标靠近任意列边界，prosemirror-tables 动态插入的 3 个手柄就全部亮成 4×16 蓝色胶囊 | `lark-doc.css`：彻底 `content: none` 不生成伪元素，保留 10px 列宽热区（`cursor: col-resize` 不变） |
| 2 | 高亮条超过 table | `activeTableElement()` 返回自定义 nodeview 的 `.tableWrapper`（纸张宽 539px），边界线的 `style.width` 用了它；内部 `<table>` 实际只有 242px，横线一路画到纸外 | `tableToolsMixin.js` 新增 `activeTableRectElement()`，`updateTableBoundary()` / `updateTableBoundaryHover()` 一律取内部 `<table>` 的 rect。实测线宽 539 → 242 |
| 3 | 还是有两个浮窗 | 下方「问AI / 正文 / 对齐 / B I U / 复制」是**另一条独立浮层** `.lark-doc-bubble`（`bubbleBar.js` + `selectionPacingMixin.runSelectionLayout()`），v5「唯一浮窗」只管 `.lark-doc-table-tools`，从未抑制它 | `selectionPacingMixin.js`（选区计算）+ `bubbleMenuMixin.js`（DOM 写入口）+ `tableToolsUiMixin.refreshTableTools()`（同步刷新）：表格浮窗打开时气泡条 hide，表格外正文选区照常显示 |
| 4 | ＋外圈光晕还在 | 不是 box-shadow。全局 `.lark-doc button:hover:not(:disabled){background:var(--ld-bg-accent)}` 特异性高于边界按钮的 `background:transparent`，hover ＋ 时把 32px 按钮刷成浅绿圆 `#eaf8f3`，套在 18px 绿＋外面 | `lark-doc.css`：用同形且更高特异性的 `button:hover:not(:disabled) / :focus / :focus-visible / [aria-pressed=true]` 压回 transparent。像素取证：外圈 (234,248,243) → 白 (255,255,255) |

### 20.1 v6 验证为什么「全绿」却漏了

1. **取样错**：v6 用 demo 初始 6 列带 `<colgroup>` 的表格查 `column-resize-handle`，那里恰好不渲染手柄；手柄只在**悬浮列边界**时由 columnResizing 动态插入，且窄表格（无 colgroup）才明显。改为在窄表格 + 悬浮列边界下断言 `handles>0 && visibleCapsule===0`。
2. **参照物错**：线长断言拿 `boundary-tools` 自己的 rect 当「表格宽」，而它正是 wrapper 宽；改为从 `.ProseMirror table` 取真实 rect，并新增「wrapper 比表格宽」的窄表格用例（`table.w=242 wrapper.w=539`）。
3. **只数了一套浮窗**：`querySelectorAll('.lark-doc-table-tools, .lark-doc-table-float')` 数不到 `.lark-doc-bubble`；新增 text / table / 窄表格三种状态下的 `bubble===0` 断言。
4. **只查了 ::before box-shadow**：没查按钮自身 background；新增 hover ＋ 时 `getComputedStyle(btn).backgroundColor === transparent` 断言。

### 20.2 改动文件

`src/components/lark-doc/lark-doc.css`（#1 #4）、`src/components/lark-doc/editor/tableToolsMixin.js`（#2）、
`selectionPacingMixin.js` + `bubbleMenuMixin.js` + `tableToolsUiMixin.js`（#3）、
`scripts/verify-browser-table-tools.js`（补 5 条 v7/v8 断言 + 修 2 条假阳性）、
`examples/element-demo.html`（产物 URL 加 `?v=20261108-v8` 版本戳，避免旧 bundle 缓存）、本文档。

### 20.3 回归（实跑结果）

- `npx eslint <6 个改动 JS>`：**PASS**
- `ROLLUP_TARGET=element,esm,cjs node scripts/build-rollup.mjs`：**PASS**（`dist/lark-doc-element.umd.min.js` 注入样式与 `dist/lark-doc.css` 均含新规则）
- `node scripts/verify-browser-table-tools.js http://127.0.0.1:8123/examples/element-demo.html?v=v8`：**PASS 69/69**
  关键项：`handles=3 visible=0 resize-cursor=true`、`line.w=242 table.w=242`（wrapper 539）、
  `bubble=0`（text / table / 窄表格三态）、`btnBg=rgba(0,0,0,0)`（hover ＋）、`tools=1 bubbles=0`。
- 像素级对照（Playwright 截图 + PIL）：悬浮列交界截图里 4×16 蓝胶囊从 3 个变 0 个；
  ＋按钮左右外圈像素从 (234,248,243) 变白 (255,255,255)。

未 commit / push / 部署，未触碰主工作区；`check:unit` / `check` 全门本轮仍未重跑（历史超时见 §18.6.1）。

## 21. v9：独立自测复核（可复跑门禁，当前生效）

用户追问「你可以自测吗」。前两轮「63/63」「69/69 全绿」都在用户截图面前被推翻，
所以本轮改用**不复用既有回归脚本任何断言**的独立自测：真实鼠标 hover / click / 拖拽，
每条判定前先校验前提是否成立（前提不成立记 INVALID 而不记 PASS），再用截图做像素复核。
脚本固化为 `scripts/selftest-table-interaction.cjs`（18 项，退出码可接 CI）。

### 21.1 自测发现的真缺陷：反馈⑦在纯 hover 下根本不成立

自测首轮 `S2b` FAIL：DOM 里连 `.lark-doc-table-boundary-tools` 都不存在。
根因是边界＋整条链都绑在「编辑区**光标**在表格内」上：

- `updateTableBoundaryHover()` 首行 `!this.editor?.isActive('table')` 直接 return；
- `activeTableElement()` 用 `state.selection.$from` 找表，选区在表格外正文里时返回 null；
- `updateTableBoundary()` 因此把 `tableBoundary.visible` 收成 false，纯 hover 不产生
  selection 事务，也就永远没有机会重新置 true。

用户第 7 条描述的正是「鼠标悬浮、还没点进表格」的状态；既有回归脚本测第 7 条时都
先 `openTableMode()` 点进表格，把这条路径完全掩盖了。**修复**：

| 改动 | 说明 |
| --- | --- |
| `tableRectElementAtPoint(event)` | 按 `elementFromPoint` 反查内部 `<table>`，命中 resize 手柄 / overlay 时按 rect + 44px 邻域兜底 |
| `activeTableRectElement(event)` | 选区不在表格内时回退到指针所在表格 / 上一次 hover 的表格 |
| `updateTableBoundaryHover()` | 去掉 `isActive('table')` 前置；缓存 `_tableBoundaryHoverTable`；几何不匹配时补跑一次 `updateTableBoundary()` 点亮 `visible` |
| `keepTableBoundaryHover()` | 纯 hover 出的 ＋，鼠标移到按钮上时不再因选区在表格外而把自己清掉 |

修复后：`open=true plus=true line=is-column-line selectors=0`（＋和线出现、选择条仍按反馈②不画）。

### 21.2 两处自测脚本自身的假阳性（已修正，产品代码无问题）

1. `boundaryOpen` 用「容器 rect 宽高 > 0」判显隐 —— 边界工具容器是**零尺寸定位壳**，
   宽高靠绝对定位子元素，恒判 false。改为 `display/visibility/opacity` 判定。
2. 打印态逐元素查 computed `display` —— 打印规则隐藏的是父容器
   `.lark-doc-table-overlay`，子元素 computed display 保持原值，恒报 6 个「仍可见」。
   改用 `getClientRects().length > 0`（是否还在渲染树里），实测 0。
3. ＋外圈环带像素检出浅绿 `(237,246,240)`，元素归因证实是**表头 `th` 背景**
   （位于＋下方一整条），不是＋按钮外圈；按钮自身 `rgba(0,0,0,0)`、选择条 0 个。

### 21.3 回归（实跑结果）

| 门禁 | 命令 / 结果 |
| --- | --- |
| ESLint（3 个改动 JS） | `npx eslint ...` **PASS**（exit 0） |
| 全量构建 | `ROLLUP_TARGET=element,esm,cjs node scripts/build-rollup.mjs` **PASS**（5m16s） |
| 独立自测 | `node scripts/selftest-table-interaction.cjs http://127.0.0.1:8123/examples/element-demo.html?v=v9` **PASS 18/18**（0 FAIL / 0 INVALID） |
| 既有回归 | `node scripts/verify-browser-table-tools.js ...?v=v9` **PASS 70/70**（新增 v9 一条「纯 hover 内部边线即出＋与线，且仍不画选择条」） |
| 像素复核 | 3 张表格截图中 4×16 蓝胶囊 **0 个**；＋外圈无浅绿圆，浅绿像素归因为表头背景 |

`examples/element-demo.html` 产物版本戳更新为 `?v=20261108-v9`。

### 21.4 环境提示（非代码问题）

本机 8123 服务根目录是 worktree（含 v9 产物）；8082 / 8083 只返回几十字节占位页，
8787 无该 demo 页。**主工作区 `apps/lark-doc/dist` 仍是 19:40 的旧构建**
（`_tableUiClicked` / `activeTableRectElement` 标记均为 0），若从主工作区路径或旧标签页
打开，看到的就是修复前的行为。本轮按约束未改动主工作区、未 commit / push / 部署。

## 22. v10：以飞书浮窗为准的「统一工具条」+ 全量功能落地（当前生效）

用户口径：「浮窗的功能栏按飞书功能栏去做」「统一成一个浮窗」「以飞书浮窗为准」「飞书功能栏
功能都需要实现」，并建议直接操作 Chrome 里已登录的飞书文档确认交互。

### 22.1 飞书真源实测（Chrome CDP，连入已登录飞书 wiki 文档）

读取 `~/Library/Application Support/Google/Chrome/DevToolsActivePort` 的 websocket，用
`chromium.connectOverCDP(ws://127.0.0.1:9222/devtools/browser/<id>)` 操作真实文档表格：

| 场景 | 浮窗尺寸 | 项数 | 结论 |
| --- | --- | --- | --- |
| 表格内双击选中文字 | `594×42` | 13 项 | AI / 转换为▾ / 对齐与缩进▾ / B S I U / 链接 / 行内代码 / 高亮▾ / 更多 / 复制链接 / 评论 |
| 点列选择条 | `685×42` | 15 项 | **同一条工具条**，前面插 3 颗表格专属按钮、去掉链接、末尾评论换删除 |

下拉实测：转换为 12 项、对齐与缩进 8 项、更多 7 项。删除线在斜体之前；只有 5 个
submenu 按钮带 caret，表格专属 3 颗是纯图标。

### 22.2 统一浮窗实现

- `src/ui/tableTools.js` 移除 `data-mode` / `.is-text-mode` / `.is-table-mode` 双模式，
  改为**一条**固定顺序 18 个 `data-cmd` 的单行工具条；8 个下拉同一时刻最多挂 1 个，
  切换时 `syncChildren` 真摘除旧节点。
- 表格 13 项 `tableActions` + 单元格水平/垂直对齐 + 背景色收进 `table-ops` 下拉，
  不再两行平铺文字按钮（用户明确否掉的旧样式）。
- `tableToolsUiMixin.tableToolbarCommand(id, value)` 是唯一命令入口；所有按钮 / 菜单项
  都经它分发，不留只挂图标的空壳。
- `src/components/lark-doc/lark-doc.css` 新增单行工具条 / 下拉 / 色板 / 置灰 / pressed
  样式，颜色全部走 `--ld-*` token；打印态隐藏规则保持。

### 22.3 「全量功能审计」推翻了「82/82 全绿」的第二次假阳性

既有回归与独立自测都曾全绿，但用户要的是「功能都需要实现」。于是另写一份临时审计探针，
**逐个真实点击** 18 个按钮 + 全部下拉项（共 73 项），记录「是否产生可观测效果」
（正文 HTML / JSON 变化、DOM 事件、菜单、弹窗、剪贴板、`window.open/find`、localStorage）。
首轮审计：**12 项点了没有任何反应**。逐一定向复测后分成三类：

| 类别 | 项 | 判定 |
| --- | --- | --- |
| 场景不适用（功能本身正常） | 合并 / 拆分单元格（需 `CellSelection`）、增加 / 减少缩进（受 `maxIndentAt` 前块上限）、转换为正文（当前已是 paragraph）、清除字体色 / 清除单元格背景（当前无可清内容）、翻译（AI 面板已开，探针只数了「新增」面板） | 改为**状态驱动置灰 / pressed 回填**，不再让用户点到空操作 |
| 探针误报 | `bg:#fff2a8` 不在 `TEXT_BACKGROUND_ROWS` 色板里 | 改用真实色值 |
| **真死按钮** | `comment`、`more→转换为子文档` | 必须修 |

另有一个真 bug：`turninto→heading1` 点了不生效（独立自测 `S12f` FAIL）。根因是
`blockTypeAction(id)` 读的是「块拖拽句柄」的 `handleRange`，从浮窗点击时句柄未激活，
`range` 为 null 直接 return。已改为基于**当前选区**的 `this.run()` 直接映射。

### 22.4 修复清单

| 文件 | 改动 |
| --- | --- |
| `editor/tableToolsUiMixin.js` | `turninto` 12 项全部落真实编辑器命令（含 `callout→wrapIn` 失败回退 `insertContent`、`synced→setReferenceCard({kind:'source_synced'})`）；新增 `dispatchToolbarAction()` 抛 bubbling+composed DOM 事件；`comment` 接 `comment-request` 事件 + 本地 `setComment` 高亮；「转换为子文档」本地落 `sub_page_list` 引用卡 + 草稿持久化；state 增加 `cellSelection / canIndentIn / canIndentOut / hasTextColor / hasCellBg / blockType` |
| `core/blocks/comment.js` | 补 `addCommands().setComment`：mark 注册**不会**自动生成 `setXxx` 命令，`commentsMixin.applyCommentMark()` 一直在调一个不存在的命令；现按选区落 mark，位置仍不入属性（05 §5.5⑥） |
| `ui/tableTools.js` | 菜单项支持 `disabled` / `pressed`；合并 / 拆分 / 缩进 / 两个清除项按 state 置灰；「转换为」按当前块类型回填 `aria-pressed` |
| `lark-doc.css` | 新增 `:disabled` / `[aria-pressed=true]` 两态样式（只用 `--ld-*` token） |
| `scripts/selftest-table-interaction.cjs` | 新增 `S13a–S13g` 7 条全量命令守卫；`openTextSel` 改用 TreeWalker 取最深文本节点（上色后 `firstChild` 变 `<span>` 会抛 `IndexSizeError`） |

外部能力（AI / 搜索 / 模板 / 词典 / 子文档）的口径：先抛宿主可委托监听的
`lark-doc-toolbar-action` DOM 事件（`$emit` 在 native host 只转 `on{}` 白名单，
未接线时宿主完全收不到），同时给一份本地可用默认行为，绝不出现死按钮。

### 22.5 门禁（实跑结果）

| 门禁 | 结果 |
| --- | --- |
| ESLint（全部改动 JS + 全仓 `npm run lint`） | **PASS** |
| `npm run check:quick`（架构 / 契约 / 全仓 lint） | **PASS** |
| `ROLLUP_TARGET=element,esm,cjs` 构建 | **PASS**，`dist` UMD 含 `tableToolbarCommand` / `setReferenceCard` / `lark-doc-table-tools-btn` |
| 既有浏览器回归 | `verify-browser-table-tools.js` **82/82** |
| 独立自测 | `selftest-table-interaction.cjs` **33/33**（0 FAIL / 0 INVALID，含新增 7 条 S13） |
| 全量功能审计（临时探针，73 项逐项真实点击） | **effective 73 / dead 0**，0 JS 错误 |
| 单元测试 | 全量 `2021 passed + 4 个 5s 导入超时`；单独复跑这 3 个文件 **65/65 PASS**（并行跑重任务导致超时，非回归）；评论/修订 3 个文件 **93/93 PASS** |

`examples/element-demo.html` 产物版本戳 `?v=20261108-v10d`。审计探针为一次性取证工具，
未入库；其结论已固化为 `S13a–S13g` 常驻断言。

### 22.6 语义边界

- 置灰项不是「删功能」：整列选区下合并可用、上色后清除可用、可缩进块上缩进可用，
  `S13c/S13d/S13e` 逐条验过「不适用置灰 → 适用解禁 → 点击真生效」。
- 仍未 commit / push / 部署，未触碰主工作区。8123 服务根 = 本 worktree；
  **主工作区 `apps/lark-doc/dist` 仍是旧构建**，从主工作区路径打开会看到修复前行为。

## 23. v11：4 条实测反馈 —— 图标/箭头全包统一、裁掉不具备能力、1:1 飞书（当前生效）

用户反馈（2026-11-09，附飞书浮窗截图）：
1. 「图标和下拉框箭头的交互，使用和顶部功能栏一样的，这个包所有的地方保持统一的」
2. 「像转化为子文档、收录到词典等暂时不具备的功能，我们可以去掉」
3. 「飞书在功能栏没有表格操作按钮」
4. 「功能栏的功能尽可能模仿飞书 1:1 实现就行，不要自己创造，图标也要尽量有意义」
另授权控制浏览器复核。CDP 端口 9222 本次只返 404、websocket 握手超时，`playwright-cli`
两次 target crashed；改用项目一直在用的 Playwright 通道做真机操作、截图与 DOM 取证。

### 23.1 真源口径

| 项 | 结论 |
| --- | --- |
| 文字选区浮窗 | 13 项，单行图标；AI / 转换为▾ / 对齐▾ / B S I U 链接 行内代码 高亮▾ / 更多 复制链接 评论 |
| 点行/列选择条 | **同一个浮窗节点**，15 项：前面插标题行列 / 合并拆分 / 单元格背景三颗纯图标，去掉链接，末尾评论换删除 |
| 下拉箭头 | 灰色 V 形 chevron，不是字符 `⌄`；hover 展开、离开延迟收 |
| 表格操作按钮 | **不存在**。增删行列走边界 ＋ / Delete / 末尾删除，标题行列与均分列宽走块句柄菜单，合并 / 背景 / 对齐走浮窗各自的表格下拉 |

### 23.2 改造清单

| 文件 | 改动 |
| --- | --- |
| `src/ui/icons.js` | 补 10 个语义 SVG：`table-merge` / `table-split`（两相向/相背箭头）、`valign-top/middle/bottom`、`block-callout` / `block-sync`、`more-horizontal`、`share-link` 等；全部 16×16 `currentColor`，与顶部栏同族 |
| `src/ui/tableTools.js` | 去 `table-ops` 按钮及其 20 项菜单；去字符 glyph，按钮与菜单项一律 `iconNode()` 渲染 `icons.js` 的 SVG；caret 一律 `iconNode('chevronDown', 12, 'lark-doc-caret')`（全局 `[aria-expanded=true]` 规则自动翻 180°）；下拉交互复刻 `toolbarMenusMixin`：hover/focus 打开、mouseleave 排 150ms 关、进菜单取消关、click 切换（hover 打开时点击不关）、Escape / 点外部关；同一时刻最多 1 个菜单 |
| `src/components/lark-doc/editor/tableToolsUiMixin.js` | 「更多」裁到 3 项：复制选区链接 / 翻译 / 文档内搜索；`larkSearch` 改走包内 `openSearch('find')` + `setSearchQuery` 搜索面板，不再 `window.find`；删掉 4 个靠 localStorage / window.open 伪造效果的分支；新增 `canSplitCell`（当前表格无 colspan/rowspan>1 时「拆分单元格」置灰） |
| `src/components/lark-doc/lark-doc.css` | 删字符 glyph / 黄底 A 的旧规则，新增 SVG 图标盒、`.lark-doc-caret` 12px、菜单项图标状态色；颜色仍全部 `--ld-*` token，打印态隐藏保持 |
| 两套验证脚本 | 回归改 99 条、独立自测改 45 条（新增 S14a–S14l）：两态 13/15 清单、SVG/caret 全覆盖、hover 150ms 下拉、more 裁剪、table-ops 不存在、结构命令真实入口 |

### 23.3 「置灰 ≠ 删功能」再补一处

v11 全量功能审计（两态共 84 项逐项真实点击）抓到 1 个真问题：整列选区下点「拆分单元格」
无任何效果 —— 文档里根本没有合并单元格。改为状态驱动置灰；独立自测 S13c 逐条验证
「无合并单元格 → 置灰 → 合并后自动解禁 → 点击真拆回」，不是把功能删掉。
其余 8 个 GRAY 项同属「当前不适用」（缩进到顶、无可清颜色/背景），适用时解禁并真生效。

### 23.4 门禁（实跑）

| 门禁 | 结果 |
| --- | --- |
| `npm run lint` / `npm run check:quick` | **PASS** |
| `ROLLUP_TARGET=element,esm,cjs` 构建 | **PASS**，UMD 中 `table-ops` 出现 0 次、`canSplitCell` / 新图标均已入产物 |
| 既有浏览器回归 | **99/99** |
| 独立自测 | **45/45**（0 FAIL / 0 INVALID） |
| 全量功能审计（临时探针，A/B 两态 84 项真实点击） | **effective 76 + gray 8 / dead 0 / 0 JS 错误** |
| 全量单元测试 | **92 文件 / 2025 用例全 PASS**（给足导入超时，无上轮的 5s 假超时） |
| 受控浏览器真机取证 | A 态 13 项 / B 态 15 项 DOM、SVG 13/15、caret 4、字符 glyph 0、`table-ops` 0；截图 `v11-text.png` / `v11-cell.png` / `v11-menu.png` |

`examples/element-demo.html` 版本戳 `?v=20261109-v11b`。仍未 commit / push / 部署，未触碰主工作区；
主工作区 `apps/lark-doc/dist` 依旧是旧构建。临时审计/截图探针只留在 `/tmp/imgan/`，未入库。

## 24. v12：删错列修复 + 去「问问豆包」+ 复制链接唯一 + 多格选区形态 E（当前生效）

用户四条实测反馈（2026-11-09）：

1. **「点击删除按钮，不是删除当前行或者列，而是下一个列」** —— 排查见 24.1。
2. **「问问豆包，这个按钮先去掉」** —— 浮窗最左侧 `ask-ai` 按钮两态全部移除（项目暂不具备 AI 能力）。
3. **「复制选区链接，弄了两个功能按钮出来」** —— 「更多」里的 `copyAnchorLink` 菜单项删除，
   只保留尾部 `share-link` 按钮（飞书真源 `more / shareTextLink` 也是单入口）。
4. **「选中两个单元格或者多个，功能栏浮窗的按钮不对」**（附飞书参考截图）—— 多格拖选此前
   复用「点选择条」的 line 形态（开头有标题行列、末尾是删除）。按飞书真源实测记录
   （requirements/02 §⑦-3 ★ 形态 E：644×42 / 14 项含 AI，去 AI 后 13 项）拆出独立的
   **multi 形态**：开头 `合并单元格、单元格背景`（🔴 无标题行列），末尾 `更多、复制链接、
   🔴 评论`（不是删除）。

### 24.1 删除按钮删错列的根因与修复

旧实现（`tableToolbarCommand('remove')`）：

```js
if (selection instanceof CellSelection) {
  this.run(this.tableSelectedLine?.axis === 'row' ? 'deleteRow' : 'deleteColumn')
} else this.run('deleteSelection')
```

三处脆弱点（都会造成「删的不是当前行/列」）：

- 只看 `tableSelectedLine` 这个 **transient 标记**选删行还是删列，标记残留/滞后时删错对象；
- `this.run()` 内部 `restoreSelection()` + `editor.chain().focus()`，焦点回编辑器时 DOM 选区
  可能仍停在点选择条之前的单元格，`selectedRect` 落到相邻列；
- 没有像键盘 Delete 路径那样用 `selectedRect` 校验「当前选区是否真的是完整一行/列」。

修复（`tableInteractionMixin.deleteSelectedTableLine()`，键盘 Delete 与按钮共用）：

- 只读**真实选区** `selectedRect(state)` 判定整列/整行，直接 `command(state, view.dispatch)`，
  不经过 focus 链；
- 删完清空 `tableSelectedLine` 并刷新 overlay / 浮窗（修复删除后选择条残留旧 label 的滞后）；
- 局部框选（非完整行列）回退 `deleteSelection`（CellSelection 清空选中单元格内容）。
- 附带修复：`refreshTableOverlays()` 加强 `tableSelectedLine` 残留清理 —— selection 仍是
  CellSelection 但真实 rect 与标记不一致（先点选择条再拖选别处）时也清掉。

真实浏览器探针（`/tmp/imgan/probe-remove.cjs`）覆盖「点选择条前光标在相邻列 / 不点单元格 /
DOM click / 行选择条」等路径验证；基础路径此前已正确（两组探针 10 个场景 0 错误），
修复收敛为「无论标记状态如何都按真实选区删」。

### 24.2 多格选区形态 E

| 文件 | 改动 |
| --- | --- |
| `src/ui/tableTools.js` | `toolbarItems(cellSelection)` → `toolbarItems(kind)` 三态：`text` 12 项 / `line` 14 项（原 B 态）/ `multi` 13 项；`CELL_ONLY` 拆为 `CELL_LINE`（标题行列，仅 line）与 `CELL_SHARED`（合并、背景，两种表格态都有）；`ALL_ITEMS`、`syncBar(kind)` 同步 |
| `src/components/lark-doc/editor/tableToolsUiMixin.js` | `buildTableToolsState()` 不再要求 `tableSelectedLine` 才出浮窗：新增 `tableCellSelectionKind()`（按真实 `selectedRect` 判 line/multi）、`tableCellLineFromRect()`（标记缺失/不一致时从 rect 反推 line 锚点）、`tableCellMultiAnchor()`（anchor/head 两格包围盒上方居中）；state 新增 `cellKind`，`tableSelectedLine` 只有与真实 rect 一致才采信 |
| `src/components/lark-doc/editor/tableInteractionMixin.js` | `deleteSelectedTableLine()` 抽出共用；键盘 Delete 路径与按钮同源 |
| `src/ui/tableTools.js`（前三条反馈） | 删 `ASK_AI`（两态）；`MORE_ITEMS` 删 `copyAnchorLink` → `translate / larkSearch` 2 项；「复制选区链接」由尾部 `share-link` 按钮独占 |
| `scripts/verify-browser-table-tools.js` | 契约同步 + 新增状态 E 断言组（拖选真出 multi 13 项、无 table-header/remove、末尾 comment、合并可用） |
| `scripts/selftest-table-interaction.cjs` | 契约同步 + 新增 S15（去 AI / 链接唯一 / 删当前行列 / 标记清理）、S16（multi 形态 + 合并拆分 + 锚点几何 + line→multi 残留清理） |

### 24.3 门禁（实跑）

| 门禁 | 结果 |
| --- | --- |
| `npm run lint` / `npm run check:quick` | **PASS**（中途抓到 agent 留下的 1 个未使用 helper，已清） |
| `ROLLUP_TARGET=element,esm,cjs` 构建 | **PASS**；UMD markers：`ask-ai` 0 次、`cellKind` / `tableCellSelectionKind` / `deleteSelectedTableLine` / `tableCellMultiAnchor` / `share-link` 均在产物 |
| 既有浏览器回归 | **111/111**（v11 99 条 + v12 状态 E 断言组） |
| 独立自测 | **53/53**（0 FAIL / 0 INVALID；S15 四条 + S16 四条全 PASS） |
| 表格相关单测 | 3 文件 **101/101** PASS |
| 真实浏览器复测探针（`/tmp/imgan/probe-v12.cjs`） | ① 拖选两格 → multi 13 项、`ask-ai` 0、复制链接唯一；② 列选择条 → line 14 项 → 删除**删的正是 B 列**（[B1,B2,B3] 消失）；③ 行删除删第 2 行；④ multi 末尾 `comment`；**0 JS 错误** |
| 截图证据 | `v12-multi.png`（multi 形态）、`selftest-16-multi-toolbar.png`、`selftest-16-line-to-multi.png`（line→multi 残留清理） |

修复 S16 首跑 4 INVALID 的说明：`cellKind` 是 `buildTableToolsState()` 的返回值、不落组件
data，且 VM 未暴露到 DOM —— 自测前提改为两个可独立观测的信号（CellSelection 存在 +
浮窗按钮集合形状特征）推断，核心断言不变；效果层面首跑即全对（13 项 cmds / bar 序列 /
合并拆分 / 锚点 / 残留清理都成功）。

`examples/element-demo.html` 版本戳 `?v=20261109-v12`。仍未 commit / push / 部署，
未触碰主工作区；主工作区 `apps/lark-doc/dist` 依旧是旧构建。
### 24.4 v12b：拖列宽时顶部列选择条不跟随（用户反馈⑤）

**现象**：拖拽列宽调整手柄期间，表格已实时变窄/变宽，但顶部列选择条停在旧几何
（截图证据：表格右缘 589(2x)，选择条仍延到 805(2x) —— 正好是拖拽前第 3 列的旧宽）。

**根因**：prosemirror-tables `columnResizing` 的拖拽 `move` 只调 `displayColumnWidth()`
**直接改 DOM colgroup 宽度、不派发 transaction**（transaction 只在 mouseup 的
`updateColumnWidth` 时发一次）。选择条几何刷新挂在 transaction hook（`$nextTick` →
`refreshTableOverlays`），整个拖拽过程一条 transaction 都没有 → 选择条全程不刷新。

**修复**（`tableInteractionMixin.js`）：activeHandle > -1（hover 到边缘热区或拖拽中）
时 prosemirror 给编辑器根节点挂 `resize-cursor` 类 —— 用它做信号，window capture
`pointermove` 上检测到该类即以 rAF 节流持续调 `refreshTableOverlays()` +
`updateTableBoundary()`；beforeDestroy 清理 rAF 与监听。

**验证**：
- 真实鼠标探针（贴近单元格右缘 ≤5px 热区 → 手柄出现 → 分步拖拽采样 6 次）：
  拖拽全程 6/6 采样点选择条与列几何一致，松手后一致，0 JS 错误；
- 固化自测 **S17a/S17b**（真实鼠标分步拖拽全程采样 + 松手后核对）→ 独立自测 **55/55**；
- 既有回归 **111/111**；lint / check:quick / 构建通过；截图 `v12b-bars-follow.png`
  （拖拽中途选择条与列对齐、未超出表格）。
- demo 版本戳 `?v=20261109-v12b`。仍未 commit / push。

### 24.5 v12c：下线两颗无实现按钮 + 浮窗按钮放大到与顶部功能栏一致（用户反馈⑥⑦）

**用户反馈**：①「复制选取链接」「评论」两个按钮是不是没有实际功能，没实现就先取消显示；
② 表格浮窗栏按钮偏小，稍微放大一点，看看是不是要和顶部功能栏按钮图标大小一致。

**调查结论（真实浏览器 DOM / 点击取证，非静态推测）**：

| 按钮 | 当时实现 | 结论 |
| --- | --- | --- |
| `share-link`（复制选区链接） | 只把 `${href}#pos=${selection.from}` 写入剪贴板并抛 `copyAnchorLink` 事件；**没有** `#pos` 解析、没有选区还原、没有宿主事件接线 | 假链接，不构成可用功能 |
| `comment`（评论） | demo / 无 Provider 时只抛 `comment-request` 并落一个本地 `lark-doc-comment` mark；**没有**评论面板、输入框、线程 / 对话 UI | 不是完整评论功能；Provider 链路（`commentsMixin.js`）保留给真正接后端的宿主 |

`src/core/nodeviews/image.js` 的既有注释也明确 `copyAnchorLink / shareTextLink / comment`
「无底层系统支撑（评论 / 分享属后续阶段）」。尺寸基线：浮窗普通按钮真实渲染 **24×30**
（CSS 写 `height:24px`，被全局 `.lark-doc button { min-height:30px }` 顶成 30px），
顶部功能栏普通按钮 **30×30**；**两边 SVG 图标本来就已经都是 16×16**。所以「图标大小
一致」已满足，真正偏小的是按钮宽度 / 点击盒 / 圆角 / 内边距，不是图标。

**改动**：

| 文件 | 内容 |
| --- | --- |
| `src/ui/tableTools.js` | 从 `ALL_ITEMS` / `TAIL` / 三态 `toolbarItems(kind)` 中**整体摘除** `share-link`、`comment`（不是 `display:none`）；`more` 菜单**不补回** `copyAnchorLink` / 评论项，防止「按钮藏进下拉」的假下线。三态项数 v12b 12/14/13 → **10/13/11**，尾部统一收在 `more▾` |
| `src/components/lark-doc/editor/tableToolsUiMixin.js` | 删除 `case 'share-link'` 假 `#pos` 链接分支与整个 `case 'comment'` 分支；`commentsMixin.js` 的 Provider 能力保留，不由表格浮窗按钮冒充实装 |
| `src/components/lark-doc/lark-doc.css` | 普通按钮 `min-width:30px / height:30px / min-height:30px / padding:0 6px / border-radius:6px / gap:3px`；`bar` 高 24→30；容器 padding `8px → 5px 8px`（`2 border + 5 + 30 + 5 = 42px`，浮窗总高仍是真源 42px）；普通 sep 20→22px、`is-full` 负 margin `-8px → -5px`；`has-caret` 48px、`is-text` 92px。图标 16×16 不变 |
| `scripts/verify-browser-table-tools.js` | 三态清单 / 计数 / 旧 `share-link`、`comment` 断言全量同步；新增 `[v12c 尺寸]` 与 `[v12c 下线复查]`（含 `more` 菜单展开时零入口复查） |
| `scripts/selftest-table-interaction.cjs` | 三态常量 / S6a / S8a / S9a / S13a / S15b / S16 全量同步；新增 **S18a~S18d**（三态 30×30 对齐 + 三态下线复查）；S14a 前提判定改按常量而非硬编码 12/14 |

**门禁（实跑）**：

| 门禁 | 结果 |
| --- | --- |
| `npm run lint` / `npm run check:quick` | **PASS**（改完 S14a 后又跑一次 lint，仍 PASS） |
| `ROLLUP_TARGET=element,esm,cjs node scripts/build-rollup.mjs` | **PASS**；UMD 中 `comment-request` = 0、`copyAnchorLink` = 0。注意 `npm run build` 内部把 `ROLLUP_TARGET` 覆盖成 `core`，**不会**重生成 element UMD，必须直接调脚本 |
| 既有浏览器回归 | **113/111 → 113/113**（v12b 111 条 + v12c 尺寸 / 下线复查 2 条） |
| 独立自测 | **59/59**（0 FAIL / 0 INVALID；S18 四条全 PASS。首跑 S14a 因残留 v12b 硬编码前提 12/14 记 1 个 INVALID，已改为按 `EXPECTED_CMDS_A/B.length` 比对后复跑全绿） |
| 表格相关单测 | 3 文件 **101/101** PASS |
| 真实鼠标三态探针（`/tmp/imgan/probe-v12c-final.cjs`） | 文字 / 整列 / multi 三态：cmds = **10 / 13 / 11**，末尾 = `more` / `remove` / `more`；浮窗 = **488 / 611 / 535 × 42**，bar 高 **30**；浮窗按钮与顶部按钮均 **30×30**、图标均 **16×16**；`radius=6px`、`padding=0 6px`、`minHeight=30px`；`share-link` / `comment` 的 `data-cmd` 与中文同名可点控件三态全为 **0**；`toolsCount=1`、`inViewport/belowToolbar/buttonsInside` 三态全 true；**0 JS 错误** |

**截图证据**：
`v12c-text-closeup.png` / `v12c-line-closeup.png` / `v12c-multi-closeup.png`（三态浮窗放大）、
`v12c-text-viewport.png`（整页位置）、`selftest-18-float-closeup.png`、
`selftest-18-viewport.png`、`selftest-15-downline-buttons.png`（零入口）。

`examples/element-demo.html` 版本戳 `?v=20261109-v12c`。仍未 commit / push / 部署，
未触碰主工作区；主工作区 `apps/lark-doc/dist` 依旧是旧构建。

### 24.6 v12d：边界 ＋ 飞书同款悬浮提示「插入列 / 插入行」（用户反馈⑧）

**用户反馈**：按飞书（两张真源截图）给边界 ＋ 加两个 tip —— 列 ＋ hover 出「插入列」、
行 ＋ hover 出「插入行」，深色气泡 + 朝下小箭头。

**改动**：

| 文件 | 内容 |
| --- | --- |
| `src/ui/tableTools.js` | `createTableBoundaryTools()` 新增持久复用的 `div.lark-doc-table-boundary-tip[role=tooltip]`（根内第三个子节点，`syncChildren` 常驻）；hover ＋ `pointerenter/focus` 150ms 后加 `is-visible`、`pointerleave/blur` 即收；文本按轴切换「插入列 / 插入行」；**原生 `title` 属性移除**（防浏览器原生 tooltip 与自绘气泡双重弹出），`aria-label` 保留；destroy 清定时器。**关键修复**：tip 是持久元素，边界条卸载时指针不补发 `pointerleave` —— `update()` 里按真实 `plusHovered` 状态收敛（`!state.open` 或非 hover 一律 `hideTip()`），自愈陈旧定时器与残留 class，否则下次打开时 tip 会提前弹出（实测复现过） |
| `src/components/lark-doc/lark-doc.css` | `.lark-doc-table-boundary-tip`：复用包内 tooltip token（`--ld-bg-tooltip #24282c` / `--ld-text-inverse` / `--ld-shadow-tooltip`），`padding:7px 10px`、`radius:8px`、12px、`white-space:nowrap`、`pointer-events:none`、`transition opacity/visibility .12s`；定位以 ＋ 圆心为锚（列 = `--plus-top+19` / `--column-line-left`，行 = `left:-9` / `--row-line-top`），`translate(-50%, calc(-100% - 20px))` 把气泡底边抬到圆心上方 20px（＋ 半径 16px，5px 箭头 `::after` 正好搭在圆点顶缘）；`opacity .12s, visibility .12s` 过渡 |

**门禁（实跑）**：

| 门禁 | 结果 |
| --- | --- |
| `npm run lint` / 构建（`ROLLUP_TARGET=element,esm,cjs node scripts/build-rollup.mjs`） | **PASS**（tip 残留 bug 修复后重跑仍 PASS） |
| 既有浏览器回归 | **117/117**（v12c 113 条 + v12d 4 条：边线不提前弹 / 列 tip 文本与样式 / 列 tip 几何 / 行 tip 文本与几何；另同步 childTags `span,button,div` 与「title 已移除」两条旧断言） |
| 独立自测 | **65/65**（0 FAIL / 0 INVALID；新增 **S19a~S19f**：边线不提前弹、列 tip 可见 + 几何、行轴文本切换、行 tip 可见 + 几何、离开收起。首跑暴露 ① S19 的 `rec` 少第 5 参（PASS/INVALID 证据失真）、② tip 残留 `is-visible` 提前弹出的真 bug —— 均已修复） |
| 表格相关单测 | 3 文件 **101/101** PASS |
| 实测取证 | hover 列 ＋：tip 可见、文本「插入列」、`bg=arrow=rgb(36,40,44)`、12px / radius 8px、`tipBottom=488 < plusTop=492`、水平居中偏差 0.01px；hover 行 ＋：文本「插入行」、`tipBottom=605.6 < plusTop=609.6`；只 hover 边线 `visible=false`；0 JS 错误 |

**截图证据**：`selftest-19-tip-column.png` / `selftest-19-tip-row.png`（320×200 局部）。

`examples/element-demo.html` 版本戳 `?v=20261109-v12d`。仍未 commit / push / 部署，
未触碰主工作区。

