# Specification：编辑器 UI 六项打磨（tips / 评论 / 空图标 / AI 弹窗 / 分享开关 / 上传进度）

状态：**实施中**。日期：2026-11-17。
基线：`master` = `05f2083`（tag `v0.14.9`），工作树 `~/codex/lark-doc-ui-polish`，分支 `feat/ui-polish-6`。
根因、改动清单与实施顺序见 [plan.md](plan.md)、[tasks.md](tasks.md)。

## 1. 目标与边界

用户以 6 张截图提出 6 条体验问题，要求「依次分析 → spec-kit 介入 → 建立 task → 依次改正」，并明确约束：**其他好用的功能不要动**。本规格只收口这 6 项，不改编辑器内核架构、不重构 `src/ui/*` 组织方式、不调整任何未被点名的交互。

- 不动：文档编辑/协同/版本/表格工具/链接工具/块手柄/斜杠菜单/查找替换等既有能力与视觉。
- 不动：`dist/` 产物提交策略、版本号、发布流程。
- 允许：`src/ui/*`、`src/components/lark-doc/editor/*Mixin.js`、`src/workspace/*`、`src/core/media/*`、`src/config/*` 的定向修改，以及配套单元/浏览器断言脚本。
- 不新增框架、不引入新依赖（`playwright-core` 仅本地临时用于实测，不进 `package.json`）。

## 2. 用户已明确的要求（原文摘要）

1. 功能栏里**没有下拉箭头的按钮都加上 tips**。
2. **评论没有接入就先隐藏 UI**。
3. 有**空图标位置**，确认没有启用的功能后，后面图标依次替补。
4. AI 助手弹窗统一：以「AI 助手 · 今天有什么工作要处理？」那张（图片/选区问答面板）为唯一形态，另一种先放着不动。
5. **分享功能按钮要做成可配置**。
6. 视频/文件上传**没有进度状态变化**（卡十几秒后突然出现）；**删除/撤销删除非常卡顿**；要求「操作浏览器找原因并修改，方案参考飞书」。

## 3. 需求与验收标准

### US1 / P1：无下拉箭头按钮的 tips

现状根因：`src/ui/toolbar.js` 的 `tooltipTarget()` 用三条排除条件判定「不该出提示」，其中
**「`textContent` 含中文就跳过」**这条把「插入」「图表」这类**有文字但确实是按钮**的控件也排除掉了，
且该函数会先 `removeAttribute('title')`，导致这些按钮**连原生提示都没了**。

- **FR-001**：工具栏内所有**不展开下拉**的可点控件（`button`、`input[type=color]`）在 hover/focus 时出现统一样式的 tips。
- **FR-002**：**真下拉**不叠提示 —— 判据只看结构，不看文案：带 `aria-haspopup="menu" | "listbox"`、带 `aria-expanded`、含 caret 子节点、`[role=combobox]`，以及 `[role=menu]` 内的菜单项。
- **FR-003**：提示文案取 `title` → `aria-label` → `textContent` 的优先级保持现状；被摘掉的 `title` 必须转存 `data-tooltip-title`，不丢文案。
- **AC-001**：「插入」「图表」「AI」「查找」「大纲」「阅读视图」「全屏」「幻灯片」「快捷键」「文档操作」均有 tips；
  「正文/标题」下拉、字号、字体、行高、颜色、对齐、缩进、页宽等下拉**不出现** tips。

### US2 / P1：未接入评论时隐藏评论 UI

现状根因：`bubbleMenuMixin.bubbleBarConfig()` 里 `comment: true` 是**硬编码**，与 `commentEntryVisible()` 脱钩；
`blockHandle.js` 在无评论服务时仍渲染一个**禁用**的「评论」项（比隐藏更糟，用户仍能看到入口）。

- **FR-004**：所有评论入口统一以 `commentEntryVisible()`（有 `provider` + `canView`）为开关：选区气泡条、块手柄菜单、表格工具尾部、链接浮窗。
- **FR-005**：无 provider 时**不渲染**入口（不是渲染成 disabled），且不占位、不留分隔符。
- **AC-002**：默认 demo（无评论 provider）下，气泡条末尾不再有评论按钮，末尾分隔符随之消失；
  接入 provider 后评论按钮与分隔符原样回来，`onComment` 行为不变。

### US3 / P1：空图标位与图标替补

现状根因：`src/ui/icons.js` 无 `copy` 键，`bubbleBar.js` 的复制按钮 `iconNode('copy', 16)` 落到兜底分支，
产出**空 span**（固定宽度、无图形）→ 截图里的红框空白。其余疑似悬空键（`block-submenu-arrow`、
`block-copy-link`、`block-h4`）已由 `blockHandle.js` / `commandIcons.js` 的局部覆盖表补上。

- **FR-006**：`icons.js` 补齐 `copy`，图形与 `blockHandle.BLOCK_MENU_ICONS.copy` 同源，保证同一仓库内复制语义一致。
- **FR-007**：`iconNode` 兜底策略维持「找不到就空 span」不变（不改成抛错，避免影响动态图标名），但**不得存在已知的缺失键**。
- **AC-003**：气泡条复制按钮显示图标；`constants.js` 中引用 `copy` 的位置同样正常；无新增空图标位。

### US4 / P2：AI 助手弹窗统一

现状根因：`workspacePanels.js` 有两套 AI 面板 —— 新的 `imageAiChat`（「AI 助手」+ hero + 消息流）与旧的
`aiPanel`（「AI 模拟预览」+ 动作/语言下拉 + 结果区）。工具栏 AI 按钮走 `startAI('rewrite')` 时
`aiImageChat`/`aiSelectionChat` 都为假，于是落到旧面板。

- **FR-008**：所有 AI 入口统一走 `imageAiChat` 形态；`aiPanel` 不再作为默认呈现路径。
- **FR-009**：旧面板代码**保留但不启用**（用户明确「那种的先放着」），不删除、不迁移其业务逻辑。
- **FR-010**：统一后 `imageAiChat` 的 header 文案、composer、actions 按 `aiImageChat` / `aiSelectionChat` / 普通问答三态正确切换，不出现「图片问答」文案出现在纯文本改写场景。
- **AC-004**：点击工具栏 AI 按钮、块手柄 AI、图片 AI、选区 AI，四处打开的弹窗视觉与结构一致（同一 `.lark-doc-image-ai`）。

### US5 / P1：分享入口可配置

现状根因：`shareMixin.selectionShareAllowed()` 只看 session capability（`canView` + `canExport`），
没有 features 开关，任何有 session 的宿主都会冒出「分享」按钮。

- **FR-011**：新增 feature 开关 `share`，**默认 `true`**（保持现有行为不变，符合「好的地方不要动」；宿主可显式置 `false` 一键下线三处入口）。
- **FR-012**：开关同时控制选区尾部按钮、表格工具 `share-link`、链接浮窗分享入口；关闭时入口不渲染、不留分隔符。
- **FR-013**：开启后行为与现在完全一致，不改分享弹窗与权限判定。
- **AC-005**：默认配置（`share: true`）下三处分享入口与现状一致；显式置 `share: false` 后三处入口均不渲染、不留分隔符。

### US6 / P1：上传进度态与删除/撤销卡顿

现状根因（两类）：
- **无进度**：`file-upload-tasks.js` 先串行 `await provider.upload(...)` 全部跑完，再一次性插块；`onProgress` 未传，
  也没有「上传中」占位节点。所以用户看到的是「十几秒空白 → 文件突然出现」。
  `image-upload-tasks.js` 已有正确范本：Decoration widget + `preview.update(percent)`。
  `blocks/file-block.js`、`nodeviews/file-block.js` 里「上传中态不做」的注释结论**需推翻**。
- **卡顿**：批量插入处 `closeHistory` + 两次 `stopCapturing` + 额外一次空 `dispatch`，把每个文件块的一次插入
  拆成多笔历史；`onTransaction` 里对 `batch.anchor` 反复 `mapping.mapResult`。删除/撤销要重放这些碎片事务。

- **FR-014**：视频/文件上传与图片一致，**立即出现占位行并显示进度百分比**，成功后原位替换为真实块，失败可重试。
- **FR-015**：占位为 Decoration widget（不进文档、不进历史），撤销栈只记录最终一次真实插入。
- **FR-016**：批量插入合成**单笔**历史事务；删除/撤销/重做不得出现可感知停顿（实测以同机对比为基准）。
- **AC-006**：浏览器实测：选 3 个文件上传，占位行与百分比在 1s 内出现并递增；上传完成占位被替换；
  单次 ⌘Z 撤销整批；再 ⌘⇧Z 重做，无卡顿。

## 4. 非目标

- 不重做工具栏布局、不新增工具栏分组。
- 不给评论补任何后端实现（本轮只做「没有就藏」）。
- 不把 `aiPanel` 的能力（动作下拉、语言选择、审查列表、提案对比）搬到新面板。
- 不改上传的网络层（分片/续传/重试策略不动），只加**状态呈现**与历史记账。
- 不做发版、不推 tag、不改 `package.json` 版本。

## 5. 回归闸门

| 闸门 | 作用 |
|---|---|
| `npm run build:all` | 产物完整、无构建错误 |
| `npm run test:unit` | 内核与 UI 单测不回归 |
| `npm run verify` | 现有契约校验 |
| `scripts/verify-browser-bubble.js` | 气泡条段序断言 —— **需求 2/3 会改段序，必须同步更新断言** |
| 手工浏览器走查 | 6 项逐条对照，并抽查未被点名的功能 |
