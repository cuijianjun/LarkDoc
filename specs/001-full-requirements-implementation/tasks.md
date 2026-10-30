# Tasks: 按需求文档完成 lark-doc 全量代码逻辑

**Input**: `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`

**Tests**: 本特性规格明确要求测试先行或同步补测；每个用户故事必须具备独立验收命令。

## Phase 1: Setup

- [ ] T001 [P] 建立基线记录目录并在 `specs/001-full-requirements-implementation/quickstart.md` 记录当前依赖、Node/npm 版本和环境阻塞规则
- [ ] T002 [P] 对照 `requirements/00-README.md`、`requirements/10-缺口与待补清单.md`、`requirements/15-闭环审计与端到端流程.md` 建立 FR-001–FR-021 到源码/测试/命令的追踪表
- [ ] T003 [P] 校验 `package.json` 中 `test:unit`、`check:gate`、`check:artifacts`、`verify:all`、`check:perf` 命令与 `quickstart.md` 一致

## Phase 2: Foundational

- [ ] T004 [P] 在 `src/core/blockApi/index.js`、`src/core/blockApi/nodes.js` 和 `src/core/blockApi/tree.js` 固化 BlockAPI 方法、稳定错误码、权限前置检查和原子回滚契约
- [ ] T005 [P] 在 `src/core/transactionMetadata.js` 和 `src/session/DocumentSession.js` 固化 operation origin、transactionId、provider 拒绝和回读事件语义
- [ ] T006 [P] 在 `src/core/blocks/block-id.js` 与 `src/core/blocks/document-helpers.js` 固化复制重建 ID、移动/撤销保持 ID、容器循环和深度校验
- [ ] T007 [P] 在 `test/unit/block-api.test.js`、`test/unit/insert-atomicity.test.js` 和 `test/unit/container-depth.test.js` 增加 BlockAPI、非法父节点、权限拒绝、循环引用和事务回滚的失败优先测试
- [ ] T008 在 `src/providers/` 和 `src/core/policy/` 统一 provider 错误、capability 投影、审计事件和敏感 token 隔离约束

## Phase 3: User Story 1 - 基础文档编辑闭环 (Priority: P1) 🎯 MVP

**Goal**: 普通块、容器块和子树都通过统一 BlockAPI 完成结构操作，并保持 blockId、顺序、权限和事务语义。

**Independent Test**: `npm run test:unit -- test/unit/block-api.test.js test/unit/insert-atomicity.test.js test/unit/heading-container.test.js test/unit/container-depth.test.js`。

### Tests

- [ ] T009 [P] [US1] 在 `test/unit/block-api.test.js` 补齐 insert/update/remove/move/duplicate/transform/get/children/batch 成功、空值、非法 blockId、权限拒绝和回滚断言
- [ ] T010 [P] [US1] 在 `test/unit/heading-container.test.js`、`test/unit/quote.test.js` 和 `test/unit/container-depth.test.js` 验证容器子树、顺序、深度和循环引用边界
- [ ] T011 [US1] 在 `test/collab/anchors.test.js` 验证移动、复制和删除恢复对评论/折叠锚点的 blockId 语义

### Implementation

- [ ] T012 [US1] 在 `src/core/blockApi/index.js` 实现统一 CRUD、move、duplicate、transform、get、children 和 batch 入口
- [ ] T013 [US1] 在 `src/core/blockApi/nodes.js`、`src/core/blockApi/tree.js` 和 `src/core/blocks/document-commands.js` 实现容器校验、子树操作、事件和原子回滚
- [ ] T014 [US1] 在 `src/session/DocumentSession.js` 接入 editor/session 绑定、权限和 provider 事务生命周期
- [ ] T015 [US1] 在 `src/core/blocks/block-id.js` 和 `src/core/blocks/document.js` 修正复制、移动、删除恢复和 transform 的 ID 保留/重建规则

## Phase 4: User Story 2 - 编辑历史与内容搬运 (Priority: P1)

**Goal**: 支持 800ms 分组、100 步本地历史、协同远端隔离，以及单块/多块/容器剪贴板和外部内容安全清洗。

**Independent Test**: `npm run test:unit -- test/unit/versioning-core.test.js test/unit/revision.test.js test/unit/table-clip.test.js test/unit/image-insert.test.js test/unit/export-roundtrip.test.js test/collab/converge.test.js`。

### Tests

- [ ] T016 [P] [US2] 在 `test/unit/versioning-core.test.js` 和 `test/unit/revision.test.js` 验证 800ms 分组、100 步上限、blockId 恢复、accept/reject 不入栈和刷新保存
- [ ] T017 [P] [US2] 在 `test/unit/collab-editor.test.js` 与 `test/collab/converge.test.js` 验证远端更新不被本地撤销、local origin 隔离和收敛
- [ ] T018 [P] [US2] 新增 `test/unit/block-clipboard.test.js`，覆盖私有 MIME、跨 tab、单块/多块/容器、空选择、损坏 payload 和 ID 映射
- [ ] T019 [US2] 在 `test/unit/image-insert.test.js`、`test/unit/export-roundtrip.test.js` 验证外部 HTML/Markdown 白名单清洗和图片失败可恢复

### Implementation

- [ ] T020 [US2] 在 `src/components/lark-doc/extensions.js`、`src/components/lark-doc/editor/revisionMixin.js` 和 `src/core/transactionMetadata.js` 接入 800ms/100 步历史契约
- [ ] T021 [US2] 在 `src/collab/index.js`、`src/collab/policies.js` 和 `src/components/lark-doc/editor/shortcutGroups.js` 接入 local origin、远端隔离和快捷键撤销/重做
- [ ] T022 [US2] 在 `src/core/blocks/document-commands.js`、`src/core/blocks/document-helpers.js` 和 `src/core/blocks/block-id.js` 实现块级复制/剪切/粘贴和多选子树 ID 重映射
- [ ] T023 [US2] 在 `src/components/lark-doc/LarkDocEditor.vue`、`src/components/lark-doc/editor/selectionPacingMixin.js`、`src/components/lark-doc/editor/blockHandleMixin.js` 和 `src/utils/importExport.js` 接入剪贴板事件、外部清洗和失败反馈

## Phase 5: User Story 3 - 异步内容与权限降级 (Priority: P1)

**Goal**: 文件、图片、表格、网页嵌入和未知块统一呈现空/加载/失败/无权限/超限状态，并在 UI/API 两侧安全降级。

**Independent Test**: `npm run test:unit -- test/unit/file-block.test.js test/unit/image-nodeview.test.js test/unit/sheet.test.js test/unit/web-embed.test.js test/unit/unknown-block.test.js test/unit/security-provider.test.js`。

### Tests

- [x] T024 [P] [US3] 新增 `test/unit/async-state-matrix.test.js`，以注入 provider 覆盖五态、重试幂等、保留旧内容和超限
- [x] T025 [P] [US3] 在 `test/unit/file-block.test.js`、`test/unit/image-nodeview.test.js`、`test/unit/sheet.test.js`、`test/unit/web-embed.test.js` 和 `test/unit/unknown-block.test.js` 验证各异步块统一投影（新增跨块投影测试；相关回归测试 184 项通过）
- [x] T026 [US3] 在 `test/unit/security-provider.test.js` 验证可写降级只读、删除/恢复/评论拒绝和 token 不进入 editor/core

### Implementation

- [x] T027 [US3] 在 `src/core/blocks/shared.js`、`src/core/blocks/unknown-block.js` 和异步块 schema 中统一 `AsyncBlockState` 与恢复动作
- [ ] T028 [US3] 在 `src/core/policy/`、`src/providers/security.js` 和 `src/components/lark-doc/editor/LarkDocOverlays.vue` 统一 capability visible/disabled/read-only/rejected 投影（评论、版本、导出、分享和块菜单已复用统一 policy；security Provider 的请求级拒绝与浮层逐项视觉状态仍待完成）
- [x] T029 [US3] 在 `src/core/blocks/file-block.js`、`src/core/blocks/image.js`、`src/core/blocks/sheet.js`、`src/core/blocks/web-embed.js`、`src/core/blocks/bookmark.js` 接入状态矩阵和无覆盖失败语义（共享 asyncState 持久化、统一 DOM class/data 属性和 NodeView 同步已完成；更高层失败文案仍由各块既有实现负责）

## Phase 6: User Story 4 - 协同、评论、版本与跨端恢复 (Priority: P2)

**Goal**: 第二账号、评论、版本只读、移动端和离线恢复均能安全查看/编辑，并在恢复联网后幂等同步。

**Independent Test**: `npm run test:unit -- test/unit/comments-core.test.js test/unit/comments-ui.test.js test/unit/mention.test.js test/unit/versioning-ui.test.js test/unit/storage-idb.test.js test/collab/converge.test.js`；浏览器条件可用时执行 Safari/移动端矩阵。

### Tests

- [ ] T030 [P] [US4] 在 `test/unit/comments-core.test.js`、`test/unit/comments-ui.test.js` 和 `test/unit/mention.test.js` 增加第二账号、无权限 mention、离职用户、锚点失效和刷新回读测试（已补评论乱序回读、切文档/账号、销毁后旧响应、无阅读权限、无编辑权限 mention 与离职候选过滤；相关回归通过；第二账号实体回读与锚点失效仍待补）
- [ ] T031 [P] [US4] 在 `test/unit/versioning-ui.test.js`、`test/unit/mode-switch.test.js` 和 `test/unit/storage-idb.test.js` 验证只读版本、窄屏/横屏和 512KB 离线快照边界（版本 capability 与 IndexedDB/离线快照边界已有回归；窄屏/横屏 runtime 及版本只读组件渲染仍待补）
- [ ] T032 [P] [US4] 新增 `test/browser/safari-comments.test.js` 与移动端浏览器场景；当前 worktree 未提供 Safari/移动端运行器，真实验证标记 BLOCKED；已保留 comments/mention 单元替代证据，待浏览器能力可用后执行
- [ ] T033 [US4] 在 `test/collab/converge.test.js` 和 `test/collab/hocuspocus-wire.test.js` 验证离线恢复、重复回调、冲突合并和远端不覆盖（两套协同测试当前 20 项通过，覆盖断线重连、重复监听、撤销隔离、冲突收敛、真 WebSocket 与鉴权失败；完整离线快照与 Provider 幂等恢复仍待补）

### Implementation

- [ ] T034 [US4] 在 `src/providers/comments.js`、`src/providers/permissions.js`、`src/core/mention/directory.js`、`src/components/lark-doc/CommentPanel.vue` 和 comments/mention mixin 中完成权限投影与回读
- [ ] T035 [US4] 在 `src/components/lark-doc/VersionPanel.vue`、`src/components/lark-doc/editor/versioningMixin.js` 和 `src/session/DocumentSession.js` 完成版本只读、恢复权限和刷新状态
- [ ] T036 [US4] 在 `src/components/lark-doc/LarkDocEditor.vue`、`src/components/lark-doc/LarkDocWorkspace.vue`、`src/components/lark-doc/editor/viewModesMixin.js` 和 `src/components/lark-doc/editor/commentsMixin.js` 完成窄屏/横屏 runtime 能力
- [ ] T037 [US4] 在 `src/core/storage/`、`src/collab/` 和 `src/providers/persistence.js` 实现离线快照、同步队列、幂等恢复和过大快照拒绝

## Phase 7: User Story 5 - Provider 写入与输出安全 (Priority: P2)

**Goal**: 宿主写入、导入任务、回收站和输出安全策略可观察、可重试、可回读且可审计。

**Independent Test**: `npm run test:unit -- test/unit/survey-provider.test.js test/unit/import-provider.test.js test/unit/ai-provider.test.js test/unit/embedded-provider.test.js test/unit/versioning-core.test.js test/unit/security-provider.test.js test/unit/export-roundtrip.test.js`。

### Tests

- [ ] T038 [P] [US5] 在 `test/unit/survey-provider.test.js`、`test/unit/import-provider.test.js` 和 `test/unit/ai-provider.test.js` 验证幂等 key、进度、部分成功、重试、提交、回滚和刷新回读
- [ ] T039 [P] [US5] 在 `test/unit/embedded-provider.test.js` 与 `test/unit/export-roundtrip.test.js` 验证 docx/Markdown/web 导入和宿主拒绝不假成功
- [ ] T040 [P] [US5] 新增 `test/unit/output-policy.test.js`，验证复制、打印、下载、截图、水印、敏感字段和审计事件
- [ ] T041 [US5] 在 `test/unit/versioning-core.test.js`、`test/unit/versioning-ui.test.js` 验证回收站删除/恢复/彻底删除和 stale/unavailable 状态

### Implementation

- [ ] T042 [US5] 在 `src/providers/survey.js`、`src/providers/import.js`、`src/providers/ai.js`、`src/providers/embedded.js` 和 `src/providers/persistence.js` 统一 ProviderTask 状态机和幂等回读
- [ ] T043 [US5] 在 `src/utils/importExport.js`、`src/components/lark-doc/ExportDialog.vue` 和导入 UI 接入 docx/Markdown/web 任务进度、失败重试和回滚
- [ ] T044 [US5] 在 `src/core/versioning/`、`src/components/lark-doc/VersionPanel.vue` 和文档操作入口补齐回收站 UI、复制文档和权限负向路径
- [ ] T045 [US5] 在 `src/providers/security.js`、`src/components/lark-doc/editor/TopBar.vue`、`src/components/lark-doc/ExportDialog.vue`、`src/utils/download.js` 和 `src/styles/print.css` 实现输出策略、水印和 AuditEvent

## Phase 8: User Story 6 - 性能与交付收口 (Priority: P3)

**Goal**: 性能、存储、白板范围和全量门禁都有可复现证据，所有环境阻塞被正确标记。

**Independent Test**: `npm run check:perf && npm run check:gate && npm run check:artifacts && npm run verify:all`。

### Tests and implementation

- [ ] T046 [P] [US6] 在 `scripts/perf/measure.mjs`、`scripts/perf/report.mjs` 和 `test/unit/perf-gate.test.js` 建立首屏、击键、decorations、滚动 FPS、保存、堆内存、2,000 块和包体基线
- [ ] T047 [P] [US6] 在 `test/unit/derived-index.test.js`、`test/unit/derived-hydration.test.js`、`test/unit/derived-snapshot.test.js` 和 `test/unit/storage-idb.test.js` 验证仅按基线证据启用的优化
- [ ] T048 [US6] 在 `src/core/derive/`、`src/core/storage/`、`src/components/lark-doc/extensions.js` 和 `src/components/lark-doc/workspace.js` 实施必要的脏区更新、DerivedIndex 或 IndexedDB 分层
- [ ] T049 [US6] 在 `src/components/lark-doc/editor/`、`src/core/blocks/web-embed.js` 和相关需求文档中明确白板/画板是 webEmbed 骨架还是版本化延期，不在 core 自研 Canvas
- [ ] T050 [US6] 运行 `npm run check:gate`、`npm run check:artifacts`、`npm run verify:all`，同步 `spec.md`、根 `tasks.md` 和 `requirements/` 状态，记录首个失败点和 BLOCKED 环境

## Dependencies & Execution Order

- Setup T001–T003 可并行。
- Foundational T004–T008 阻塞所有用户故事。
- US1 与 US2 均依赖 Foundational；US2 的结构操作依赖 US1 的 BlockAPI 契约。
- US3 依赖 Foundational，可与 US2 后半段并行，但异步状态契约必须先完成。
- US4、US5 依赖 US3 的 capability/provider 边界；US4 与 US5 可在边界稳定后并行。
- US6 依赖所有目标故事的实现和测试，但性能基线 T046 可提前执行。

## Parallel Opportunities

- T001–T003 可并行。
- T009–T011、T016–T019、T024–T026、T030–T033、T038–T041、T046–T047 可在不同文件上并行。
- US4 与 US5 在 T028、T042 的共享契约完成后可并行。
- 真实 Safari/移动端验证与确定性单元/provider 测试可并行；前者不可用时只产生 BLOCKED 证据。

## MVP Scope

MVP 为 Phase 1–4：T001–T023，覆盖 BlockAPI、容器、历史栈、协同隔离和块级剪贴板。MVP 完成后必须独立运行 US1/US2 验收，再进入异步状态和宿主能力。

## Notes

- 每项任务必须保留精确文件路径；新增测试先失败再实现。
- 不做项：`bear-web-toolbar`、自定义右键菜单、独立折叠块 slash 项、Sheet/Slides/Wiki/表格函数等兄弟产品能力，不得重新派活。
- 完成状态同步到根目录 `spec.md`、根目录 `tasks.md` 和相关 `requirements/`，新会话只需加载这些交接文件及当前任务列出的受影响文件。
