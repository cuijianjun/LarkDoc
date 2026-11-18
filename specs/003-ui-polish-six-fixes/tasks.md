# Tasks：编辑器 UI 六项打磨

图例：`[ ]` 待做 · `[x]` 完成 · `[~]` 进行中。每项都要跑对应的回归闸门才能勾。

| # | 任务 | 状态 |
|---|---|---|
| T1 | specs 文档（spec/plan/tasks） | [x] |
| T2 | R1 工具栏 tips | [x] |
| T3 | R2 隐藏评论 UI | [x] |
| T4 | R3 补 `copy` 图标 | [x] |
| T5 | R4 AI 弹窗统一 | [x] |
| T6 | R5 分享可配置 | [x] |
| T7 | R6a 上传进度态 | [x] |
| T8 | R6b 删除/撤销卡顿 | [x] |
| T9 | 构建 + 回归 + 预览链接 | [~] |

---

## T2 · R1 工具栏无箭头按钮补 tips

**改**：`src/ui/toolbar.js` · `tooltipTarget()`

- [x] 删掉 `|| /[\u3400-\u9fff]/.test(node.textContent)` 这条排除
- [x] 真下拉判据改成结构判定：`hasPopupCaret` / `role="combobox"` / `closest('[role="menu"]')`；`aria-haspopup` / `aria-expanded` 不再当排除依据（否则「插入」「AI」这类既弹面板又该出 tips 的按钮会被误排除）
- [x] 保留 `node.closest('[role="menu"]')` 排除
- [x] 断言清单（必须出 tips）：插入 / 表格 / 图表 / AI / 查找 / 大纲 / 阅读视图 / 全屏 / 幻灯片 / 快捷键 / 文档操作 / 复制选区链接
- [x] 断言清单（必须不出）：正文▾ / 字号▾ / 字体▾ / 行高▾ / 颜色 / 对齐×4 / 缩进± / 页宽▾

**闸门**：手工 hover + `npm run test:unit`（浏览器复核见下方「验收记录 · 工具栏 tips」）

## T3 · R2 未接入评论时隐藏评论 UI

**改**：`src/components/lark-doc/editor/bubbleMenuMixin.js`、`src/ui/blockHandle.js`

- [x] `bubbleBarConfig()`：`comment: true` → `comment: this.commentEntryVisible`
- [x] `blockHandle` 块动作：评论项加 `&& this.commentEntryVisible`，不满足时整项不 push
- [x] 核对 `tableTools.syncBar` 的 `commentVisible` 来源仍是 `commentEntryVisible`
- [x] 核对链接浮窗无独立评论入口
- [x] 更新 `scripts/verify-browser-bubble.js` 段序断言：末尾 `divider` + `mark:添加评论` 在没有 provider 时**不存在**
- [x] 同步改 `test/unit/dom-renderer-contract.test.js` 的块菜单断言（原断言是「置灰禁用」，与需求相反 → 改为整项不出现）

**闸门**：`scripts/verify-browser-bubble.js` + 手工（有 provider 时回归原样）

## T4 · R3 空图标位

**改**：`src/ui/icons.js`

- [x] 从 `blockHandle.js` 的 `BLOCK_MENU_ICONS.copy` 复制同一 SVG 进 `ICONS.copy`
- [x] 全仓复扫 `iconNode('<name>'` / `icon: '<name>'` / `ICONS.<name>`，确认无第二个悬空键
- [x] 气泡条复制按钮出图形
- [x] 气泡条段序断言里补 `copy` 按钮 `innerHTML` 非空（空图标位不会再悄悄回来）

**闸门**：`scripts/verify-browser-bubble.js`（复制按钮 innerHTML 非空）

## T5 · R4 AI 助手弹窗统一

**改**：`src/ui/workspacePanels.js`、`src/ui/imageAiChat.js`、`src/components/lark-doc/editor/linkToolsUiMixin.js`（无）

- [x] `aiPanel` 的 `on` 改为永假（代码保留，不删）
- [x] `imageAiChat` 的 `on` 改为 `aiOpen`
- [x] `imageAiChat.update()` 支持第三态（普通问答）文案，不再把普通改写显示成「图片问答」
- [x] 确认 `startAI('rewrite')` / `openSelectionChat` / `openImageAIChat` / 块手柄 AI 四条路径都落到同一 DOM
- [x] 关闭旧面板后 `aiStatus`/`aiResultHost` 等消费者不报错（它们仍存在，只是不显示）
- [x] 旧面板原先承载的配置栏（操作 / 目标语言 / 上下文范围）搬进浮层 composer 的 `actionBar` 槽位 —— 否则 11 个操作在旧面板下线后不可达

**闸门**：手工四点位 + `npm run test:unit`

## T6 · R5 分享入口可配置

**改**：`src/components/lark-doc/larkDocConfig.js`、`src/components/lark-doc/editor/shareMixin.js`

- [x] `LARK_DOC_FEATURES` 增 `share: true`
- [x] `DEFAULT_LARK_DOC_CONFIG.features` 增 `share: true`（默认保持现状 —— 需求是「可配置」，不是「默认关掉」）
- [x] `selectionShareAllowed()` 与 `shareEntryVisible` 前置 `this.featureEnabled('share')`
- [x] 确认表格 `share-link`、链接浮窗分享、选区尾按钮三处同时受控
- [x] `test/unit/share-ui.test.js` 补「`features.share === false` 时整组下线」

**闸门**：`features.share: true`（默认）下三处与现状一致；显式置 `false` 后三处均无入口

## T7 · R6a 文件/视频上传进度态

**改**：`src/core/media/file-upload-tasks.js`、`src/components/lark-doc/lark-doc.css`

- [x] 批次开始先插入 N 个占位 `fileBlock`（单笔事务，`name/size/mimeType/viewType:'Card'/blockId`）
- [x] 每个占位挂覆盖层：文件名 + `role="progressbar"`（`aria-valuemin/max/now`）+ 百分比 + 进度条
- [x] `provider.upload(..., { onProgress })` 直接写 DOM，不产生事务（单测断言 `transactions === 0`）
- [x] 成功 → `setNodeMarkup` 换真身（`addToHistory:false`），移除覆盖层
- [x] 失败 → 删除占位（`addToHistory:false`）+ `host.error`
- [x] 占位被用户删除 / 文档切换 / dispose → `abort` 并清 DOM，**不留半截块**
- [x] 推翻 `blocks/file-block.js`、`nodeviews/file-block.js` 里「上传中态不做」的注释，写明新结论与理由

**闸门**：浏览器实测批量上传，占位与百分比 1s 内出现（见「验收记录 · 上传进度」）

## T8 · R6b 删除/撤销卡顿

**改**：`src/core/media/file-upload-tasks.js`

- [x] 基线定位：卡顿来自「每块一条历史记录」+ 每个块单独事务，撤销要按 N 次；且上传期正文里什么都没有，用户只能干等
- [x] 合并为单笔插入事务（`insertContentAt` 一次写 N 个占位）
- [x] `stopCapturing()` 换成 `closeHistory(tr)`（prosemirror-history 上没有 `undoManager` 时前者是空操作，真实边界只认 meta）
- [x] 换真身 / 删占位一律 `addToHistory:false`，撤销一次即整批消失
- [x] 双 signal 取消（批级 + 任务级），`insert()` 的 Promise 一定 settle（原来会挂到超时）

**闸门**：撤销一次删整批（单测 `undos === 1`）；数字见「验收记录」

## T9 · 构建 / 回归 / 预览

- [x] 分目标构建（`build:all` 单进程 4GB OOM，拆成 `plugin` / `element` / `features` / `collab` / `adapters` / `lite` / `legacy` / `legacyEsm`）
- [x] `npm run test:unit`
- [x] `npm run verify`（`verify.mjs` 需要 8080 上的 demo 宿主，本工作树未装 `lark-doc` 依赖 → 用预览工程 + `scripts/verify-browser-bubble.js` 代跑：46/46 通过）
- [x] 浏览器跑 `scripts/verify-browser-bubble.js`（断言已按 T3/T4 更新）
- [x] 起 `~/codex/lark-doc-vue2-preview`，给出链接
- [x] 手工走查未被点名的功能：斜杠菜单 / 表格浮窗 / 链接浮窗 / 图片上传 / 块手柄拖拽

---

## 验收记录

### R6b 性能基线

| 动作 | 改前 | 改后 |
|---|---|---|
| 插入 3 个附件 | 3 条历史 + 3 次事务（撤销要按 3 次） | 1 条历史 + 1 次事务（撤销 1 次整批消失） |
| 上传期间正文 | 空白，完成后突然出现（用户等 10s+ 无反馈） | 当帧落占位 + 进度覆盖层，进度只改 DOM（0 事务） |
| 删除后撤销 | 按块回滚，块与历史错位 | 整批回滚，`addToHistory:false` 不产生第二条记录 |

浏览器实测（headful 本机 Chrome，227 块文档，从触发起算到两帧画完）：

| 动作 | 实测 |
|---|---|
| 文本撤销 | 102ms |
| 长文档（227 块）撤销 | 45ms |
| 删除附件块 | 18ms |
| 撤销删除附件 | 63ms |

### 手工走查结论

预览工程 + 本机 Chrome，真实鼠标/键盘，12/12 通过：

| 项 | 结果 |
|---|---|
| 工具栏无 ▾ 按钮出 tips（加粗/斜体/清除格式/查找） | 文案对得上 |
| 带 ▾ 控件不弹自绘 tips | 未弹 |
| 斜杠菜单 | 59 项，分组「文字 / 列表 / 插入 / 布局」齐全 |
| 块手柄 | 42×26，23 个按钮 |
| 链接弹窗 | 470px，2 个输入框 |
| 表格浮层 | 出现边界线 2 个 |
| 附件上传 | 占位当帧出现且在视口内 → 进度 0→14→49→83→117→156px → 覆盖层消失、真身落块 |
| 一次撤销 | 附件 1 → 0 |

走查中顺手修掉的两个真实缺陷：

1. **进度条画在看不见的地方**：附件壳 453px 高，覆盖层内容垂直居中 → 插在文档末尾时进度条落在视口外，用户还是「没反馈」。改为内容靠上（`justify-content: flex-start`）+ 插入占位后 `scrollIntoView({ block: 'nearest' })`。
2. **占位不跟随视口**：同上，`revealPlaceholder()` 只在确实不可见时滚，已可见不动。

### 工具栏 tips

浏览器复核：hover 加粗 / 斜体 / 清除格式 / 查找，均出自绘 `.lark-doc-tooltip` 且文案与 `aria-label` 一致；带 `caret` 的控件（正文▾ 等）不弹。

### 单测尾部 `Errors 10 errors` 的定位（已修）

现象：`Test Files 108 passed` / `Tests 3078 passed | 1 skipped`，但尾巴上多出 `Errors 10 errors`，报错内容全部是
`TypeError: node.scrollIntoView is not a function`，栈顶落在 `src/core/media/file-upload-tasks.js` 的 rAF 回调，
起源文件统一是 `test/unit/dom-renderer-contract.test.js` 的附件用例。

根因不是业务逻辑出错，是 `revealPlaceholder()` 的判定依赖布局：

- jsdom 没有布局引擎，`getBoundingClientRect()` 恒返回全 0；
- 于是 `box.height > 0 && 可见` 这个短路条件不成立，代码继续走到 `node.scrollIntoView(...)`；
- 而 jsdom 没实现 `Element.prototype.scrollIntoView` —— 回调由 timer 驱动，抛的是 uncaught，vitest 就把它记成 `Errors`。

修法（`src/core/media/file-upload-tasks.js`）：量不出高度就直接放过（NodeView 还没排版 / 环境无布局引擎，两种情况都无从判断可见性），
调用前再补 `typeof node.scrollIntoView === 'function'` 一层。真实浏览器行为零变化。

修复后单独复跑该文件：`Test Files 1 passed` / `Tests 477 passed`，`Errors` 行消失。
