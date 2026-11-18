# Plan：三项改动的根因与实施路径

## 0. 事实基线（动手前实测）

| 事实 | 证据 |
|---|---|
| 气泡条纯图标按钮无提示层 | `bubbleBar.js` 全文无 `tooltip` 引用，仅写 `aria-label` |
| ➕ 菜单「基础」分类是纯图标 | `.lark-doc-command-menu.is-plus [data-category="基础"] .lark-doc-command-label { clip-path: inset(50%) }` |
| 表格功能条/块手柄同类 | `tableTools.js`、`blockHandle.js` 只写 `aria-label`/`title` |
| AI 面板有两套实现 | `workspacePanels.js`：`aiPanel`（`on: false` 永不显示） + `imageAi.el`（`on: aiOpen`） |
| 表单控件被塞进对话壳 | `imageAi.setActionBar(aiActionBar)`，CSS 有 `.lark-doc-ai-actionbar` 专用样式 |
| 视频上传铺满 453px | 实测 `figure 534×453`、覆盖层 `532×451`、进度条 y=511，下方 340px 空白（`/tmp/shot-video-uploading.png`） |

## 1. 需求①：功能栏 tips 全覆盖

**做法**：把 `toolbar.js` 里已经跑通的判定抽成共用绑定器，其余功能栏只挂一行代码。

- 新增 `src/ui/hoverTips.js`：`bindHoverTips(root, { layer })`，内部复用 `createTooltip`（懒加载）。
  判定函数 `tipTarget(event)`：
  1. `closest('button, [role="button"]')` 且在 `root` 内；
  2. `aria-haspopup="menu"` / `[class*="caret"]` / `[role="combobox"]` → 跳过（有下一级弹窗）；
  3. **可见中文名称**判定：容器内**存在可见文本节点**（`Range` 量宽 > 0，或对子节点 `getBoundingClientRect().width > 0`）→ 跳过。
     这一步必须按**布局**判断，不能按 `textContent`：➕ 菜单的 label 是「有文本但被 `clip-path` 隐藏」。
     （`clip-path` 隐藏的元素仍有非零盒子，所以还要叠加 `clip-path` 检测：`getComputedStyle(el).clipPath !== 'none'` 视为隐藏。）
  4. `disabled` 允许出提示（说明为何不可用，比静默好）。
- 挂载点：`bubbleBar`（`build()` 后绑定一次，重建后重绑）、`commandMenu`、`tableTools`、`blockHandle`、`cellPlusTools`、`tableOverlays`。
- 复用同一个 `.lark-doc-tooltip` 视觉，不新造样式；`tooltip.js` 的 `inPopup` 排除规则保留给「菜单项内部」——气泡条根是 `role="toolbar"`、命令菜单是 `role="menu"`，后者需要开一个**显式白名单**：`bind()` 已存在且不做 `inPopup` 判定，直接用它即可。

**风险**：命令菜单每次 `update` 复用节点，绑定必须挂在容器（委托）上，不能逐条 `bind`，否则会累积监听。

## 2. 需求②：AI 弹窗统一

**做法**：让 `aiPanel` 重新成为唯一可见面板，把对话面板独有能力搬过来。

1. `workspacePanels.js`
   - `aiActionBar` 不再 `imageAi.setActionBar()`，而是直接 append 进 `aiPanel`（说明 → 操作 → 目标语言 → 上下文范围 → 要求 → 按钮）。
   - 新增引用条 `.lark-doc-ai-reference`（`[图片]`/选区标签 + 移除按钮 ×），由 `state.aiImage` / `state.aiReference` 驱动，迁自 `imageAiChat`。
   - 显隐：`{ node: aiPanel, on: aiOpen }`、`{ node: imageAi.el, on: false }`。
   - `focusImageAI()` → 聚焦 `aiPrompt`；`Esc` 关闭保留。
   - 结果区补「已完成，等待确认」状态标签（已有 `aiStatus`）。
2. `domRenderer.js`：`action === 'chat'` 与一次性生成都落到同一面板 —— 只需保证 `aiOpen` 为真；`openSelectionAI()` 不再区分形态。
3. `imageAiChat.js`：保留文件、不参与显隐（避免一次性删掉一堆引用）；`workspacePanels` 不再 append 它的 DOM。
4. CSS：重排 `.lark-doc-ai-panel` —— 卡片化（圆角/阴影/内边距 14→16）、标题行右侧圆形关闭、`label` 字号 12 灰、控件整行、结果卡 `--ld-bg-soft` 圆角 6、底部按钮 `flex-wrap` + `gap 8`，避免半截裁切。
5. 测试：`dom-renderer-contract.test.js` 两处 `.lark-doc-image-ai-reference` 断言改为新引用条选择器与新的 `aria-label`。

**风险**：AI 面板与 imageAiChat 都可能被外部（`LarkDocElement`、`web-component`）引用 → 只改显隐、不删导出。

## 3. 需求③：视频上传占位

**做法**：覆盖层按 kind 分化，视频走紧凑媒体卡，文件保持原样。

1. `file-upload-tasks.js`
   - `createUploadingOverlay(document, file)` 增加 kind 判定（`fileKindOf(file.type)`），给根节点加 `is-video` 类并给 `figure` 加 `data-upload-kind="video"`（`attachOverlay` 时设置、`releaseOverlay` 时移除）。
   - 视频的层级保持 name / track / meta 三段即可，靠 CSS 决定排布（不新增 DOM 分支，减少测试面）。
2. `lark-doc.css`
   - `.lark-doc-file[data-upload-kind="video"].is-uploading { width: 534px; height: 300px; }`
   - 覆盖层 `.is-video`：深色底、内容垂直居中、进度条 160×3、白字。
   - `figure` 高度过渡 `transition: height .18s` 会让上传完成时平滑展开（可选，若影响断言则去掉）。
3. 断言：`scripts/verify-browser-bubble.js` 或新走查脚本里加「视频上传中块高 ≤ 320 且内容居中」。

**注意**：`453` 这个高度在 `file-block.js` 注释里被写成契约（预览态）。这里只在上传态的 CSS 里临时覆盖，不改契约常量，也不改 NodeView。

## 4. 顺序与闸门

| 序 | 任务 | 闸门 |
|---|---|---|
| T1 | `hoverTips.js` 共用绑定器 | 单测：判定表（可见文本/隐藏文本/caret/haspopup） |
| T2 | 气泡条接入 | 浏览器 hover 断言 7 个图标出、4 个不出 |
| T3 | 命令菜单接入 | ➕「基础」出、带中文名的行不出 |
| T4 | 表格功能条 / 块手柄 / 单元格➕ 接入 | 走查：悬停出 tips |
| T5 | AI 面板结构统一 | 单测改 2 处断言 → 全绿 |
| T6 | AI 面板样式对齐参考图 | 截图对照 + 无裁切 |
| T7 | 视频上传紧凑卡 | 截图 + 块高断言 |
| T8 | 收口 | 全量单测 + 浏览器走查 + 预览重建 |

## 5. 不做

- 不改 `fileBlock` schema 契约（不加 `uploading` / `percent` 属性）。
- 不改斜杠菜单命令表、键盘导航、表格模型。
- 不删 `imageAiChat.js`、不删 `aiPanel` 的既有能力（审阅建议、提案）。
- 不为 tips 新造视觉层。
