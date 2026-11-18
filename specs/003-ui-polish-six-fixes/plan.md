# Implementation Plan：编辑器 UI 六项打磨

基线 `05f2083`；工作树 `~/codex/lark-doc-ui-polish`（分支 `feat/ui-polish-6`）。
规格见 [spec.md](spec.md)，任务拆解见 [tasks.md](tasks.md)。

## 1. 总体策略

六项按「影响面从小到大」排序实施，每项独立可验证、独立可回滚：

| 序 | 需求 | 影响面 | 风险 |
|---|---|---|---|
| 1 | 工具栏 tips | 单文件单函数 | 低（纯展示，注意别把真下拉改成有提示） |
| 2 | 隐藏评论 | 4 个入口的开关来源 | 低（配置项换成计算属性） |
| 3 | 补 `copy` 图标 | 单文件加一个键 | 极低 |
| 4 | AI 弹窗统一 | 面板路由 | 中（旧面板要留着但不启用） |
| 5 | 分享可配置 | features + 3 处入口 | 中（默认关闭 = 行为变更，需明确记录） |
| 6 | 上传进度 + 卡顿 | 上传任务状态机 | 高（历史记账、占位生命周期） |

**硬约束**：不改 ProseMirror schema。`fileBlock` 的 attrs 是 `test/fixtures/schema-v1.json`
里的冻结契约（`unknown-block.test.js` / `quote.test.js` 逐字段比对），加一个
`uploading` 字段就要改契约，与「其他功能不要动」冲突。因此上传中态**完全走运行时**：
真实节点只带 `name/size/mimeType`，进度用**直接 DOM 写入**呈现，不产生任何事务。

## 2. 逐项落点

### R1 工具栏 tips（`src/ui/toolbar.js`）

`tooltipTarget()` 现有三条排除：

```js
return node.matches('[aria-haspopup="menu"], [aria-haspopup="listbox"], [aria-expanded]')
  || /[\u3400-\u9fff]/.test(node.textContent)   // ← 过宽，删掉
  || node.closest('[role="menu"]') ? null : node
```

第二条本意是「有文字的选项不必再提示」，但「插入」「图表」是**有中文标签、靠
`aria-haspopup="menu"` 展开下拉的按钮之外**的普通按钮 —— 它们命中第二条被排除，
且前面已经把 `title` 摘走（`removeAttribute('title')`），于是既无自绘 tips 也无原生提示。

改法：
- 删掉中文判定；
- 保留 `[role="menu"]` 内的排除（菜单项由 `createTooltipLayer` 的 `inPopup()` 也能兜住，双保险）；
- 真下拉判据补一条「**含 caret 子节点**」（`node.querySelector('[data-caret], .lark-doc-caret')`），
  防止某些只带 `aria-expanded` 的触发器形态漏网。

回归：`scripts/verify-browser-toolbar*.js`（若有）与手工走查 12 个无箭头按钮。

### R2 隐藏评论（`bubbleMenuMixin.js` + `blockHandle.js`）

- `bubbleBarConfig().comment`：`true` → `this.commentEntryVisible`。
  `configSignature` 已含 `config?.comment`，气泡条会自动重建，无需额外触发。
- `blockHandle.js` 的块动作：`isBlockActionEnabled('comment')` 之外再 `&& this.commentEntryVisible`，
  无 provider 时**不进 items 数组**（现在是进数组 + `disabled`）。
- 表格工具 `syncBar(..., commentVisible, ...)` 已正确接 `commentEntryVisible`；链接浮窗无评论入口 → 无需改。

回归：`scripts/verify-browser-bubble.js` 的段序断言（末尾 `mark:添加评论` 与最后那个 `divider`）。

### R3 `copy` 图标（`src/ui/icons.js`）

- 从 `src/ui/blockHandle.js` 的 `BLOCK_MENU_ICONS.copy` 搬同一份 SVG 到 `ICONS`，
  避免同一语义两套图形。
- 顺带核对 `block-submenu-arrow` / `block-copy-link` / `block-h4`：三者由
  `blockHandle.BLOCK_MENU_ICONS` 与 `commandIcons.BLOCK_TYPE_ICONS` 提供，不是空缺。
- 不改 `iconNode` 的兜底（保持空 span，不抛错）——动态图标名不能因为有人拼错就整片崩。

### R4 AI 弹窗统一（`src/workspace/workspacePanels.js` + `WorkspaceController.js`）

- `panels` 里 `aiPanel` 的 `on` 条件从「`aiOpen && !imageAiChat && !selectionChat`」改为**永假**
  （`false`），旧面板保留在代码里、DOM 仍可创建但不显示。
- `imageAiChat` 的 `on` 从「`aiOpen && (imageChat || selectionChat)`」改为 `aiOpen`。
- `imageAiChat.update(state)` 需要区分三态文案：图片问答 / 选区问答 / 普通。加一个
  `state.aiPlainChat`（或复用 `aiContext` 的类型）来判断，缺省走「普通」。
- `startAI('rewrite')` 路径要让 `aiImageChat.js` 能拿到 prompt/messages；
  最小改动：`closeAI` 前保持现有 state 传递，`imageAiChat` 只读 `state.aiMessages/aiPrompt`（已有字段）。

回归：手工点 4 个 AI 入口，确认结构一致；`aiPanel` 相关单测（若有）改为断言「不显示」。

### R5 分享可配置（`src/config/larkDocConfig.js` + `shareMixin.js`）

- `LARK_DOC_FEATURES` 与 `DEFAULT_LARK_DOC_CONFIG.features` 增 `share: false`。
- `shareMixin.selectionShareAllowed()` 前置 `this.featureEnabled('share')`。
- 覆盖三处：选区尾按钮（同一方法）、表格工具 `share-link`（`shareVisible` 派生自
  `selectionShareEntryAvailable`，自动跟随）、链接浮窗（`linkTools` 的 `shareVisible` 同源）。
- 默认关闭是有意的行为变更：`selectionShareEntryAvailable` 返回 false 后，
  `tableToolsUiMixin` 的 `shareVisible` 也随之为 false，不渲染也不留分隔符。

回归：`tableTools` 的 `syncBar` 断言；手工开 `features.share` 验证恢复。

### R6 上传进度 + 删除/撤销卡顿（`src/core/media/file-upload-tasks.js` + CSS）

**R6a 进度态**

现状：`await Promise.all(workers)` 全部跑完才 `chain().setFileBlock(...)` —— 上传期间文档零变化。

改为「先落占位、再换真身」：

1. 校验通过后**立即**用一个事务插入 N 个占位 `fileBlock` 节点：
   `attrs = { name, size, mimeType, viewType: 'Card', blockId }`（无 `token`/`src`）。
   直接 `tr.insert`，不走 `setFileBlock`（那个命令强制要求 token/src，是防半截块的闸门，
   占位态由本模块自己保证清理，不能为了它把闸门拆了）。
2. 逐文件上传完成 → 同一位置 `setNodeMarkup(pos, undefined, realAttrs)`，
   事务加 `addToHistory: false`；失败 → 删掉该占位节点（同样 `addToHistory: false`）+ `host.error`。
3. 进度**不写事务**：`onProgress` 直接改占位节点的 DOM（`data-upload-progress` + 进度条宽度），
   零重排零历史，比 image 那套 Decoration 更省。
4. 占位被用户删掉（`onTransaction` 里 blockId 找不到）→ `abort`，与现有 `anchor-removed` 同构。
5. `dispose` / `cancelAll` → 清掉所有占位节点与覆盖层，保证不留半截块。

视觉：`figure.lark-doc-file.is-uploading` 覆盖层（半透明底 + 环形/条形进度 + 百分比 + 文件名），
参照 `imageUploadPlaceholder.js` 的 `role="progressbar"` / `aria-valuenow` 语义。

**R6b 卡顿**

可疑点（按嫌疑排序）：

1. `closeHistory(tr)` + **两次** `stopCapturing()` + 一次额外 `dispatch(closeHistory(state.tr).setMeta('addToHistory', false))`
   —— 多笔隐式边界把「插入 N 个块」切成 N 段，撤销要重放 N 次，每次重建 iframe/video。
2. `chain().setFileBlock()` 循环：每块一次 `insertContent`，每块都触发一次 schema fitter 与 nodeview 构建。
3. `onTransaction` 里对所有 batch 做 `mapping.mapResult` —— 数量小，不是主因，但顺手只在 `docChanged` 时跑（已如此）。

改法：合成**一笔**事务 + 一处 `closeHistory`；`stopCapturing` 只在批次开始前调一次
（History 的 `closeHistory` 本身就起边界作用，重复调用是历史书写的噪音）。

**浏览器实测**：用 `~/codex/lark-doc-vue2-preview`（4175，alias 直连 `dist/`）+ CDP
`PerformanceObserver('longtask')` 与 `performance.measure`，
测量「插入 3 个文件块 / 删除 1 个块 / ⌘Z 撤销」三个动作的耗时与 long task 数，
改前改后各测一次，把数字写进 `tasks.md` 的验收记录。

## 3. 历史记账模型（R6 的关键）

| 动作 | 事务 | 历史 |
|---|---|---|
| 插入占位（N 个） | 1 笔 | **记录**（1 条） |
| 进度更新 | 0 笔（纯 DOM） | 无 |
| 单个成功 → 换真身 | 1 笔 | `addToHistory:false` |
| 单个失败 → 删占位 | 1 笔 | `addToHistory:false` |
| 全部成功后的收尾 | 0 笔 | 无 |

结果：⌘Z 一次删掉整批，⌘⇧Z 一次整批回来，与飞书一致。

## 4. 回归闸门与命令

```bash
export PATH="/Users/cjjxw/.nvm/versions/node/v24.22.0/bin:$PATH"
cd ~/codex/lark-doc-ui-polish
npm run build:all && npm run test:unit && npm run verify
node scripts/verify-browser-bubble.js   # 需先建 dist 与本地预览端口
```

`verify-browser-bubble.js` 的段序数组要按 R2/R3 更新（评论消失、copy 有图标）——
这是**预期内的断言变更**，不是放宽标准。

## 5. 交付

`~/codex/lark-doc-vue2-preview`（http://127.0.0.1:4175/）已配 alias 直连
`dist/lark-doc.esm.js` / `dist/lark-doc.css`，构建完刷新即可看到改动；
另附 `~/codex/lark-doc-vue2-npm-preview`（4177）用真实 npm 包做对照，本轮不重打包。
