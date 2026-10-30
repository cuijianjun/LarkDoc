# lark-doc 0.12 实施任务清单

> 只记录当前仍需实施或验收的任务。完成任务后同步 `spec.md`、对应 `requirements/` 状态和本文件。
> 每次新会话只注入：`spec.md` + 当前任务 + 任务列出的受影响文件。

## 状态定义

- `TODO`：未开始。
- `DOING`：正在实施。
- `BLOCKED`：依赖外部账号、浏览器或宿主能力；必须先完成替代测试或取得证据。
- `DONE`：源码、测试和验收命令均通过。
- `WONT`：经审计明确不做，不得重新派活。

## 任务总览

| ID | 优先级 | 状态 | 主题 | 依赖 |
| --- | --- | --- | --- | --- |
| T00 | P0 | DONE | 建立可复现基线和审计索引 | 无 |
| T01 | P0 | DOING | 冻结共享 BlockAPI 契约：复制映射、权限前置和稳定错误基础已落地，完整事务/事件仍待收口 | T00 |
| T02 | P0 | TODO | 落地撤销/重做历史栈 | T00 |
| T03 | P0 | TODO | 落地块级剪贴板与多块多选 | T01、T02 |
| T04 | P1 | TODO | 收口引用/标题容器调用链 | T01、T03 |
| T05 | P1 | TODO | 完成 A4 按钮块两 action 与刷新回读 | T00 |
| T06 | P1 | DOING | 建立异步块异常与权限矩阵：五态契约、跨块 DOM/NodeView 状态投影、安全脱敏、共享 asyncState 持久化、统一 capability policy、浮层权限闸门与块菜单动作闸门已接线；Provider 业务拒绝已转换为稳定异常，浮层逐项视觉状态与浏览器验收仍待完成 | T01 |
| T07 | P1 | TODO | 完成跨账号、Safari 和无权限验收 | T06 |
| T08 | P2 | DOING | 移动端 viewport runtime、离线快照和幂等恢复已完成，真实移动端浏览器验收仍待补 | T06、T07 |
| T09 | P2 | TODO | 完成 survey/import/provider 写入闭环 | T01、T06 |
| T10 | P2 | DOING | 输出策略/打印/水印/审计核心已完成；版本回收站与导入进度/重试/回滚核心已完成，回收站 UI、复制文档和真实浏览器验收仍待补 | T06、T09 |
| T11 | P2 | TODO | 执行性能基线与存储/派生索引收口 | T00、T01 |
| T12 | P3 | TODO | 白板/画板范围决策与 webEmbed 骨架 | T01、T06 |
| T13 | P3 | TODO | 全量门禁、浏览器矩阵和文档收口 | T02–T12 |
| T14 | P0 | WONT | 顶部固定格式工具栏 | 需求已证明不存在 |
| T15 | P0 | WONT | 自定义右键菜单 | 需求已证明不存在 |
| T16 | P0 | WONT | 折叠块 slash 项和兄弟产品线 | 明确不在当前范围 |

---

## T00 · 建立可复现基线和审计索引

- **优先级**：P0
- **状态**：TODO
- **需求来源**：`spec.md §2`、`requirements/09 §2.3/§2.4`、`requirements/15 §7`
- **目标**：在本 worktree 记录当前代码、测试、产物、性能和门禁基线；确认历史“全绿”结论可复现或明确差异。
- **受影响文件**：
  - `package.json`
  - `src/core/blockApi/index.js`
  - `src/session/DocumentSession.js`
  - `src/providers/`
  - `test/unit/block-api.test.js`
  - `test/unit/versioning-core.test.js`
  - `test/unit/survey-provider.test.js`
  - `scripts/`
- **验收命令**：
  - `npm run check:gate`
  - `npm run check:artifacts`
  - `npm run test:unit`
  - `npm run verify:all`
  - `git status --short`
- **完成定义**：输出可复现的通过/失败清单；若环境导致失败，记录具体命令、首个失败点和不影响代码结论的原因。不得修改原工作区。

## T01 · 冻结共享 BlockAPI 契约

- **优先级**：P0
- **状态**：TODO
- **需求来源**：`requirements/05 §5.12`、`requirements/15 §3.3`、`requirements/17 §17.2–§17.5`
- **目标**：让所有块共用 insert/update/remove/move/duplicate/transform/get/children/batch，并定义容器、权限、非法 blockId、事务失败和事件语义。
- **受影响源码**：
  - `src/core/blockApi/index.js`
  - `src/core/blockApi/nodes.js`
  - `src/core/blockApi/tree.js`
  - `src/core/blocks/document.js`
  - `src/core/blocks/document-commands.js`
  - `src/core/blocks/block-id.js`
  - `src/session/DocumentSession.js`
- **受影响测试**：
  - `test/unit/block-api.test.js`
  - `test/unit/heading-container.test.js`
  - `test/unit/container-depth.test.js`
  - `test/unit/insert-atomicity.test.js`
  - `test/collab/anchors.test.js`
- **验收命令**：`npm run test:unit -- test/unit/block-api.test.js test/unit/insert-atomicity.test.js test/unit/heading-container.test.js`；`npm run check:architecture`
- **完成定义**：每个方法有成功、空值、非法父节点、权限拒绝、事务回滚测试；复制生成新 blockId；移动不破坏锚点；容器 children 顺序稳定。

## T02 · 落地撤销/重做历史栈

- **优先级**：P0
- **状态**：TODO
- **需求来源**：`requirements/07 §13`、`requirements/15 §3.1`
- **目标**：按已定 V1 契约实现 800ms 分组、100 步上限、blockId 复原、本地 `local` origin、远端更新不清本地栈、accept/reject 不进栈。
- **受影响源码**：
  - `src/components/lark-doc/extensions.js`
  - `src/components/lark-doc/editor/shortcutGroups.js`
  - `src/components/lark-doc/editor/revisionMixin.js`
  - `src/core/transactionMetadata.js`
  - `src/collab/index.js`
  - `src/collab/policies.js`
  - `src/core/blocks/block-id.js`
- **受影响测试**：
  - `test/unit/versioning-core.test.js`
  - `test/unit/revision.test.js`
  - `test/unit/collab-editor.test.js`
  - `test/collab/converge.test.js`
  - `test/collab/anchors.test.js`
- **验收命令**：`npm run test:unit -- test/unit/versioning-core.test.js test/unit/revision.test.js test/unit/collab-editor.test.js`；`npm run test:unit -- test/collab/converge.test.js`
- **完成定义**：新增/删除/移动/属性修改均可撤销重做；blockId 在链路中保持；协同下不能撤掉远端编辑；刷新不会丢撤销后的持久化结果。

## T03 · 落地块级剪贴板与多块多选

- **优先级**：P0
- **状态**：TODO
- **需求来源**：`requirements/07 §14`、`requirements/15 §3.2`、`requirements/05 §5.12`
- **目标**：支持单块、多块、容器内复制/剪切/粘贴；内部 MIME 保真；外部 HTML/Markdown 清洗；粘贴副本重新生成 blockId；图片粘贴失败有明确状态。
- **受影响源码**：
  - `src/core/blocks/document-commands.js`
  - `src/core/blocks/document-helpers.js`
  - `src/core/blocks/block-id.js`
  - `src/components/lark-doc/LarkDocEditor.vue`
  - `src/components/lark-doc/editor/selectionPacingMixin.js`
  - `src/components/lark-doc/editor/blockHandleMixin.js`
  - `src/core/blocks/image-paste.js`
  - `src/utils/importExport.js`
- **受影响测试**：
  - `test/unit/table-clip.test.js`
  - `test/unit/insert-atomicity.test.js`
  - `test/unit/image-insert.test.js`
  - `test/unit/export-roundtrip.test.js`
  - 新增 `test/unit/block-clipboard.test.js`
- **验收命令**：`npm run test:unit -- test/unit/table-clip.test.js test/unit/image-insert.test.js test/unit/export-roundtrip.test.js test/unit/block-clipboard.test.js`
- **完成定义**：内部复制跨 tab 保留 attrs/子树且不重复 blockId；剪切可撤销；外部内容通过白名单清洗；多选边界和空选区均有测试。

## T04 · 收口引用/标题容器调用链

- **优先级**：P1
- **状态**：TODO
- **需求来源**：`requirements/02 §2/§8`、`requirements/10 A14/A15`、`requirements/15 §3.6`
- **目标**：将引用和标题按容器语义接入统一 API，支持嵌套块、折叠范围、粘贴多块、编号/大纲局部更新。
- **受影响源码**：
  - `src/core/blocks/quote.js`
  - `src/core/blocks/heading.js`
  - `src/core/blocks/container-depth.js`
  - `src/components/lark-doc/editor/blockIndentMixin.js`
  - `src/components/lark-doc/editor/foldPersistMixin.js`
  - `src/core/derive/`
- **受影响测试**：
  - `test/unit/quote.test.js`
  - `test/unit/heading-container.test.js`
  - `test/unit/container-depth.test.js`
  - `test/unit/derived-index.test.js`
- **验收命令**：`npm run test:unit -- test/unit/quote.test.js test/unit/heading-container.test.js test/unit/container-depth.test.js`
- **完成定义**：引用可含任意受支持块；标题折叠只隐藏子树；大纲、编号和剪贴板均不破坏容器结构。

## T05 · 完成 A4 按钮块两 action 与刷新回读

- **优先级**：P1
- **状态**：TODO
- **需求来源**：`requirements/02 §22`、`requirements/10 §1.5/A4`
- **目标**：完成创建副本、关注文档更新、删除后重新加载并回读状态；保持第三方动作由宿主/事件处理。
- **受影响源码**：
  - `src/core/blocks/isv.js`
  - `src/core/nodeviews/isv.js`
  - `src/components/lark-doc/editor/IsvButtonPanel.vue`
  - `src/components/lark-doc/editor/isvMixin.js`
  - `src/providers/embedded.js`
  - `src/providers/persistence.js`
- **受影响测试**：
  - `test/unit/isv.test.js`
  - `test/unit/embedded-provider.test.js`
  - 新增 `test/unit/button-actions.test.js`
- **验收命令**：`npm run test:unit -- test/unit/isv.test.js test/unit/embedded-provider.test.js test/unit/button-actions.test.js`
- **完成定义**：三动作均有成功、宿主拒绝、网络失败、刷新回读测试；删除后文档重新加载不残留旧块。

## T06 · 建立异步块异常与权限矩阵

- **优先级**：P1
- **状态**：TODO
- **需求来源**：`requirements/15 §3.4/§5`、`requirements/04 §8.3`、`requirements/05 §5.3.1`
- **目标**：统一空/加载/失败/无权限/超限五态；统一降级卡；将 capability 映射到块级可见、置灰、只读和拒绝行为。
- **受影响源码**：
  - `src/core/blocks/shared.js`
  - `src/core/blocks/unknown-block.js`
  - `src/core/blocks/file-block.js`
  - `src/core/blocks/image.js`
  - `src/core/blocks/sheet.js`
  - `src/core/blocks/web-embed.js`
  - `src/core/blocks/bookmark.js`
  - `src/core/policy/`
  - `src/providers/security.js`
  - `src/components/lark-doc/editor/LarkDocOverlays.vue`
- **受影响测试**：
  - `test/unit/file-block.test.js`
  - `test/unit/image-nodeview.test.js`
  - `test/unit/sheet.test.js`
  - `test/unit/web-embed.test.js`
  - `test/unit/unknown-block.test.js`
  - `test/unit/security-provider.test.js`
  - 新增 `test/unit/async-state-matrix.test.js`
- **验收命令**：`npm run test:unit -- test/unit/file-block.test.js test/unit/sheet.test.js test/unit/web-embed.test.js test/unit/unknown-block.test.js test/unit/security-provider.test.js test/unit/async-state-matrix.test.js`
- **完成定义**：矩阵覆盖所有异步块；失败有重试/拒绝语义；权限与超限不会误删数据；降级卡视觉和键盘行为统一。

## T07 · 完成跨账号、Safari 和无权限验收

- **优先级**：P1
- **状态**：TODO / 可能 BLOCKED
- **需求来源**：`requirements/10 §9.4–§9.6`、`requirements/16 §5.5`、`requirements/17 §17.6.3`
- **目标**：验证第二账号权限降级、离职/无权限 mention、评论回读和 Safari 行为。
- **受影响源码**：
  - `src/providers/comments.js`
  - `src/providers/permissions.js`
  - `src/core/mention/directory.js`
  - `src/components/lark-doc/CommentPanel.vue`
  - `src/components/lark-doc/editor/mentionMixin.js`
  - `src/components/lark-doc/editor/commentsMixin.js`
- **受影响测试**：
  - `test/unit/comments-core.test.js`
  - `test/unit/comments-ui.test.js`
  - `test/unit/mention.test.js`
  - `test/unit/security-provider.test.js`
  - 新增 `test/browser/safari-comments.test.js`（若浏览器 runner 可用）
- **验收命令**：`npm run test:unit -- test/unit/comments-core.test.js test/unit/comments-ui.test.js test/unit/mention.test.js`; Safari/第二账号使用浏览器矩阵命令并记录环境。
- **完成定义**：真实账号不可用时必须用可注入 provider 完成确定性测试，并将真实环境缺口标记 BLOCKED，不得伪报 DONE。

## T08 · 完成移动端 runtime 与离线同步

- **优先级**：P2
- **状态**：DOING / 真实移动端浏览器验收 BLOCKED
- **需求来源**：`requirements/16 §5.5`、`requirements/17 §17.6.3`、`requirements/15 §9.15`
- **目标**：提供移动端评论/通知/锚点/版本只读、横屏布局、离线快照和同步恢复。
- **受影响源码**：
  - `src/components/lark-doc/LarkDocEditor.vue`
  - `src/components/lark-doc/LarkDocWorkspace.vue`
  - `src/components/lark-doc/CommentPanel.vue`
  - `src/components/lark-doc/VersionPanel.vue`
  - `src/components/lark-doc/editor/viewModesMixin.js`
  - `src/components/lark-doc/editor/commentsMixin.js`
  - `src/components/lark-doc/editor/versioningMixin.js`
  - `src/core/storage/`
  - `src/collab/`
- **受影响测试**：
  - `test/unit/mode-switch.test.js`
  - `test/unit/comments-ui.test.js`
  - `test/unit/versioning-ui.test.js`
  - `test/unit/storage-idb.test.js`
  - `test/collab/converge.test.js`
- **验收命令**：`npm run test:unit -- test/unit/mode-switch.test.js test/unit/versioning-ui.test.js test/unit/storage-idb.test.js`; 移动端浏览器验证。
- **完成定义**：窄屏/横屏不丢编辑状态；离线快照遵守 512KB 单份限制；恢复后协同不重复提交或覆盖远端内容。

## T09 · 完成 survey/import/provider 写入闭环

- **优先级**：P2
- **状态**：TODO
- **需求来源**：`requirements/05 §5.17`、`requirements/17 DocumentImportAPI/SurveyProvider`、`requirements/10 §9.4`
- **目标**：将已有 provider 契约接到真实宿主写入；支持问卷、docx/markdown/web 导入的任务、进度、部分成功、重试、提交和回滚。
- **受影响源码**：
  - `src/providers/survey.js`
  - `src/providers/import.js`
  - `src/providers/ai.js`
  - `src/providers/embedded.js`
  - `src/providers/persistence.js`
  - `src/utils/importExport.js`
  - `src/components/lark-doc/ExportDialog.vue`
- **受影响测试**：
  - `test/unit/survey-provider.test.js`
  - `test/unit/import-provider.test.js`
  - `test/unit/ai-provider.test.js`
  - `test/unit/embedded-provider.test.js`
  - `test/unit/export-roundtrip.test.js`
- **验收命令**：`npm run test:unit -- test/unit/survey-provider.test.js test/unit/import-provider.test.js test/unit/ai-provider.test.js test/unit/export-roundtrip.test.js`
- **完成定义**：每个 provider 都有真实/模拟宿主写入、失败重试、幂等和刷新回读；第三方 token 不进入 editor/core。

## T10 · 完成回收站、复制/打印/水印/审计

- **优先级**：P2
- **状态**：TODO
- **需求来源**：`requirements/05 §5.17`、`requirements/10 §9.4`、`requirements/15 §9.15`
- **目标**：补齐版本回收站 UI、复制/打印/下载/截图策略、水印和审计日志字段。
- **受影响源码**：
  - `src/core/versioning/`
  - `src/components/lark-doc/VersionPanel.vue`
  - `src/components/lark-doc/TopBar.vue`
  - `src/components/lark-doc/ExportDialog.vue`
  - `src/providers/security.js`
  - `src/utils/download.js`
  - `src/styles/print.css`
- **受影响测试**：
  - `test/unit/versioning-core.test.js`
  - `test/unit/versioning-ui.test.js`
  - `test/unit/security-provider.test.js`
  - 新增 `test/unit/output-policy.test.js`
- **验收命令**：`npm run test:unit -- test/unit/versioning-core.test.js test/unit/versioning-ui.test.js test/unit/security-provider.test.js test/unit/output-policy.test.js`
- **完成定义**：策略在 UI、命令、Provider 和导出路径一致；拒绝动作有可观察错误；水印不破坏打印和下载格式；审计事件字段稳定。

## T11 · 执行性能基线与存储/派生索引收口

- **优先级**：P2
- **状态**：TODO
- **需求来源**：`requirements/09 §2.4/§3.7/§5.9`
- **目标**：先测真实基线，再按预算决定实现 DerivedIndex、脏区更新、IndexedDB 分层和条件性虚拟化。
- **受影响源码**：
  - `src/core/derive/`
  - `src/core/storage/`
  - `src/components/lark-doc/extensions.js`
  - `src/components/lark-doc/workspace.js`
  - `scripts/perf/`
  - `scripts/check-architecture.js`
- **受影响测试**：
  - `test/unit/derived-index.test.js`
  - `test/unit/derived-hydration.test.js`
  - `test/unit/derived-snapshot.test.js`
  - `test/unit/perf-gate.test.js`
  - `test/unit/perf-preflight.test.js`
  - `test/unit/storage-idb.test.js`
- **验收命令**：`npm run check:perf`; `npm run test:unit -- test/unit/derived-index.test.js test/unit/perf-gate.test.js test/unit/storage-idb.test.js`; `npm run check:architecture`
- **完成定义**：基线包含首屏、击键帧、decorations、滚动 FPS、保存耗时、堆内存和包体；2,000 块预算可复现；优化前后有数据，未超标项不做无证据重构。

## T12 · 白板/画板范围决策与 webEmbed 骨架

- **优先级**：P3
- **状态**：TODO
- **需求来源**：`requirements/10 C1/C3/C4`、`requirements/09 §3.4`
- **目标**：明确 0.12 交付是骨架卡、webEmbed 参考实现还是显式延后；禁止在 core 内自研 Canvas。
- **受影响源码**：
  - `src/core/blocks/web-embed.js`
  - `src/core/embed/`
  - `src/core/nodeviews/web-embed.js`
  - `src/components/lark-doc/editor/dialogs/EmbedLinkDialog.vue`
  - `src/providers/embedded.js`
- **受影响测试**：
  - `test/unit/web-embed.test.js`
  - `test/unit/embed-bridge.test.js`
  - `test/unit/embed-presets.test.js`
  - `test/unit/network-policy.test.js`
- **验收命令**：`npm run test:unit -- test/unit/web-embed.test.js test/unit/embed-bridge.test.js test/unit/embed-presets.test.js test/unit/network-policy.test.js`
- **完成定义**：范围决策写入需求；若做骨架，空/加载/失败/超时四态可验；桥协议版本、origin、事件冒泡和降级卡均有测试。

## T13 · 全量门禁、浏览器矩阵和文档收口

- **优先级**：P3
- **状态**：TODO
- **需求来源**：本文件 §4、`requirements/09 §6/§11`、`requirements/15 §7`
- **目标**：汇总所有任务结果，更新需求状态，完成产物、适配器、浏览器、协同和文档一致性检查。
- **受影响文件**：
  - `spec.md`
  - `tasks.md`
  - `requirements/00-README.md`
  - `requirements/10-缺口与待补清单.md`
  - `requirements/15-闭环审计与端到端流程.md`
  - `.codebuddy/commands/`
  - `.specify/`
- **验收命令**：
  - `npm run check:gate`
  - `npm run check:artifacts`
  - `npm run verify:all`
  - `npm run build:adapters`
  - `npm run build:element`
  - `git diff --check`
- **完成定义**：任务状态与源码/测试一致；没有过期任务重新出现在当前清单；最终报告区分代码完成、规格完成、环境 BLOCKED 和明确 WONT。

## WONT 记录

### T14：顶部固定格式工具栏

`requirements/10 A13` 已通过实测确认 `.bear-web-toolbar` 不存在。格式入口由选区气泡条和块工具条承载，不实现独立顶部格式工具栏。

### T15：自定义右键菜单

`requirements/10 A19` 已通过文本、代码、图片三类目标的 `contextmenu` 事件确认浏览器原生菜单未被阻止。不实现自定义右键菜单。

### T16：折叠块 slash 项和兄弟产品线

飞书 slash 菜单没有独立折叠块；Sheet、Slides、Wiki 和表格函数等兄弟产品线不属于当前 lark-doc 0.12 范围。若用户重新要求，必须先改 `spec.md` 的范围和验收口径。
