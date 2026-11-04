# Tasks: 按需求文档完成 lark-doc 全量代码逻辑

**Input**: `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`

**Tests**: 本特性规格明确要求测试先行或同步补测；每个用户故事必须具备独立验收命令。

## Phase 1: Setup

- [x] T001 [P] 建立基线记录目录并在 `specs/001-full-requirements-implementation/quickstart.md` 记录当前依赖、Node/npm 版本和环境阻塞规则
- [x] T002 [P] 对照 `requirements/00-README.md`、`requirements/10-缺口与待补清单.md`、`requirements/15-闭环审计与端到端流程.md` 建立 FR-001–FR-021 到源码/测试/命令的追踪表
- [x] T003 [P] 校验 `package.json` 中 `test:unit`、`check:gate`、`check:artifacts`、`verify:all`、`check:perf` 命令与 `quickstart.md` 一致

## Phase 2: Foundational

- [x] T004 [P] 在 `src/core/blockApi/index.js`、`src/core/blockApi/nodes.js` 和 `src/core/blockApi/tree.js` 固化 BlockAPI 方法、稳定错误码、权限前置检查和原子回滚契约
- [x] T005 [P] 在 `src/core/transactionMetadata.js` 和 `src/session/DocumentSession.js` 固化 operation origin、transactionId、provider 拒绝和回读事件语义
- [x] T006 [P] 在 `src/core/blocks/block-id.js` 与 `src/core/blocks/document-helpers.js` 固化复制重建 ID、移动/撤销保持 ID、容器循环和深度校验
- [x] T007 [P] 在 `test/unit/block-api.test.js`、`test/unit/insert-atomicity.test.js` 和 `test/unit/container-depth.test.js` 增加 BlockAPI、非法父节点、权限拒绝、循环引用和事务回滚的失败优先测试
- [x] T008 在 `src/providers/` 和 `src/core/policy/` 统一 provider 错误、capability 投影、审计事件和敏感 token 隔离约束

## Phase 3: User Story 1 - 基础文档编辑闭环 (Priority: P1) 🎯 MVP

**Goal**: 普通块、容器块和子树都通过统一 BlockAPI 完成结构操作，并保持 blockId、顺序、权限和事务语义。

**Independent Test**: `npm run test:unit -- test/unit/block-api.test.js test/unit/insert-atomicity.test.js test/unit/heading-container.test.js test/unit/container-depth.test.js`。

### Tests

- [x] T009 [P] [US1] 在 `test/unit/block-api.test.js` 补齐 insert/update/remove/move/duplicate/transform/get/children/batch 成功、空值、非法 blockId、权限拒绝和回滚断言
- [x] T010 [P] [US1] 在 `test/unit/heading-container.test.js`、`test/unit/quote.test.js` 和 `test/unit/container-depth.test.js` 验证容器子树、顺序、深度和循环引用边界
- [x] T011 [US1] 在 `test/collab/anchors.test.js` 验证移动、复制和删除恢复对评论/折叠锚点的 blockId 语义（新增真实 Editor 回归；同时修复复制格式丢失，副本剥离 comment/revision 实体身份而移动保留；US1 定向 7 文件/123 用例通过）

### Implementation

- [x] T012 [US1] 在 `src/core/blockApi/index.js` 实现统一 CRUD、move、duplicate、transform、get、children 和 batch 入口
- [x] T013 [US1] 在 `src/core/blockApi/nodes.js`、`src/core/blockApi/tree.js` 和 `src/core/blocks/document-commands.js` 实现容器校验、子树操作、事件和原子回滚
- [x] T014 [US1] 在 `src/session/DocumentSession.js` 接入 editor/session 绑定、权限和 provider 事务生命周期
- [x] T015 [US1] 在 `src/core/blocks/block-id.js` 和 `src/core/blocks/document.js` 修正复制、移动、删除恢复和 transform 的 ID 保留/重建规则

## Phase 4: User Story 2 - 编辑历史与内容搬运 (Priority: P1)

**Goal**: 支持 800ms 分组、100 步本地历史、协同远端隔离，以及单块/多块/容器剪贴板和外部内容安全清洗。

**Independent Test**: `npm run test:unit -- test/unit/versioning-core.test.js test/unit/revision.test.js test/unit/table-clip.test.js test/unit/image-insert.test.js test/unit/export-roundtrip.test.js test/collab/converge.test.js`。

### Tests

- [x] T016 [P] [US2] 在 `test/unit/history-contract.test.js`、`test/unit/versioning-core.test.js`、`test/unit/revision.test.js` 和 `test/collab/anchors.test.js` 验证真实事务 800ms 分组、严格 100 组裁剪及完整 redo、blockId 恢复、accept/reject 不入栈、undo 触发 update 保存和刷新不恢复历史（新增失败优先回归；定向 6 文件/113 项通过）
- [x] T017 [P] [US2] 在 `test/unit/collab-editor.test.js` 与 `test/collab/converge.test.js` 验证远端更新不被本地撤销、local origin 隔离和收敛（新增协同窗口/100组裁剪、远端到达不清栈、accept/reject 不入栈及双端决策同步；完整门禁 97文件/2166项通过）
- [x] T018 [P] [US2] 新增 `test/unit/block-clipboard.test.js`，覆盖私有 MIME、跨 tab、单块/多块/容器、空选择、损坏 payload 和 ID 映射（23 项 jsdom/菜单回归通过；独立当前 worktree Chromium 双标签页真实系统剪贴板 10/10 通过；真实 Safari/移动设备仍不在本任务范围）
- [x] T019 [US2] 在 `test/unit/image-insert.test.js`、`test/unit/export-roundtrip.test.js` 验证外部 HTML/Markdown 白名单清洗和图片失败可恢复（外部 HTML 危险标签/属性/协议清洗，以及成功图片与失败图片并行收集、失败不阻断其他图片均已补测；定向 2 文件/112 项通过）

### Implementation

- [x] T020 [US2] 在 `src/components/lark-doc/extensions.js`、`src/core/revision/commands.js`、`src/components/lark-doc/editor/revisionMixin.js` 和 `src/core/transactionMetadata.js` 接入 800ms/100 步历史契约（修复 PM 默认软上限溢出；accept/reject 显式 addToHistory:false；普通 undo/redo 保留映射和保存事件）
- [x] T021 [US2] 在 `src/collab/index.js`、`src/collab/policies.js` 和 `src/components/lark-doc/editor/shortcutGroups.js` 接入 local origin、远端隔离和快捷键撤销/重做（保留官方 ySyncPluginKey 本地 PM 来源，另跟踪 local；捕获窗口800ms，undo/redo 栈最多100组；沿用官方快捷键，不额外重复绑定）
- [x] T022 [US2] 在 `src/core/blocks/document-commands.js`、`src/core/blocks/document-helpers.js` 和 `src/core/blocks/block-id.js` 实现块级复制/剪切/粘贴和多选子树 ID 重映射（核心接线、递归 ID/mention 重映射、普通 marks 保真、实体 marks 隔离、剪切 undo 与失败保护已完成；当前 Chromium 双标签页 10/10 覆盖单块/多块/容器/剪切/局部文本和嵌套列表外部回退）
- [x] T023 [US2] 在 `src/components/lark-doc/LarkDocEditor.vue`、`src/components/lark-doc/editor/selectionPacingMixin.js`、`src/components/lark-doc/editor/blockHandleMixin.js` 和 `src/utils/importExport.js` 接入剪贴板事件、外部清洗和失败反馈（core/菜单事件、capability、output/network policy、正式 MIME、HTML/plain 回退及外部列表/图片/表格回退已验证；同步 copy-event 已确认正式 MIME 写入后才删除、删除一次且 undo 恢复；Chromium 原生 paste 不暴露菜单异步 custom MIME，异步路径保持 fail-closed；组件接线、独立宿主烟测和 Chromium 矩阵已通过）

## Phase 5: User Story 3 - 异步内容与权限降级 (Priority: P1)

**Goal**: 文件、图片、表格、网页嵌入和未知块统一呈现空/加载/失败/无权限/超限状态，并在 UI/API 两侧安全降级。

**Independent Test**: `npm run test:unit -- test/unit/file-block.test.js test/unit/image-nodeview.test.js test/unit/sheet.test.js test/unit/web-embed.test.js test/unit/unknown-block.test.js test/unit/security-provider.test.js`。

### Tests

- [x] T024 [P] [US3] 新增 `test/unit/async-state-matrix.test.js`，以注入 provider 覆盖五态、重试幂等、保留旧内容和超限
- [x] T025 [P] [US3] 在 `test/unit/file-block.test.js`、`test/unit/image-nodeview.test.js`、`test/unit/sheet.test.js`、`test/unit/web-embed.test.js` 和 `test/unit/unknown-block.test.js` 验证各异步块统一投影（新增跨块投影测试；相关回归测试 184 项通过）
- [x] T026 [US3] 在 `test/unit/security-provider.test.js` 验证可写降级只读、删除/恢复/评论拒绝和 token 不进入 editor/core

### Implementation

- [x] T027 [US3] 在 `src/core/blocks/shared.js`、`src/core/blocks/unknown-block.js` 和异步块 schema 中统一 `AsyncBlockState` 与恢复动作
- [x] T028 [US3] 在 `src/core/policy/`、`src/providers/security.js` 和 `src/components/lark-doc/editor/LarkDocOverlays.vue` 统一 capability visible/disabled/read-only/rejected 投影（统一 policy 输出 `visible/disabled/readOnly/rejected`；评论、导出、版本、分享权限和顶栏子菜单控件均声明 `data-capability`/`aria-disabled`，权限/接线回归共 100 项通过；`canView` 保持唯一 replace，`canManagePermission` 保持 readonly-link downgrade）
- [x] T029 [US3] 在 `src/core/blocks/file-block.js`、`src/core/blocks/image.js`、`src/core/blocks/sheet.js`、`src/core/blocks/web-embed.js`、`src/core/blocks/bookmark.js` 接入状态矩阵和无覆盖失败语义（共享 asyncState 持久化、统一 DOM class/data 属性和 NodeView 同步已完成；更高层失败文案仍由各块既有实现负责）

## Phase 6: User Story 4 - 协同、评论、版本与跨端恢复 (Priority: P2)

**Goal**: 第二账号、评论、版本只读、移动端和离线恢复均能安全查看/编辑，并在恢复联网后幂等同步。

**Independent Test**: `npm run test:unit -- test/unit/comments-core.test.js test/unit/comments-ui.test.js test/unit/mention.test.js test/unit/versioning-ui.test.js test/unit/storage-idb.test.js test/collab/converge.test.js`；浏览器条件可用时执行 Safari/移动端矩阵。

### Tests

- [x] T030 [P] [US4] 在 `test/unit/comments-core.test.js`、`test/unit/comments-ui.test.js` 和 `test/unit/mention.test.js` 增加第二账号、无权限 mention、离职用户、锚点失效和刷新回读测试（已覆盖评论乱序回读、切文档/账号、销毁后旧响应、无阅读权限、第二账号线程/回复实体回读、锚点失效、无编辑权限 mention 与离职候选过滤；相关回归 78 项通过）
- [x] T031 [P] [US4] 在 `test/unit/versioning-ui.test.js`、`test/unit/mode-switch.test.js` 和 `test/unit/storage-idb.test.js` 验证只读版本、窄屏/横屏和 512KB 离线快照边界（版本 capability/只读禁用、IndexedDB/512KB 边界已有回归；新增 viewport 宽高/横竖屏 runtime 生命周期与根节点 class 确定性验收；3 个文件 133 项通过）
- [x] T032 [P] [US4] 2026-11-01 按用户修订口径：浏览器模拟器通过即可，无需真机。新增 `scripts/verify-browser-mobile.js`，当前 worktree 匹配产物的 Chromium 手机（390×844、DPR3、touch）及平板（768×1024）模拟矩阵 12/12 通过：产物身份、无横向溢出、键盘输入及横竖屏保持文档身份、触摸只读/编辑恢复、第二账号评论展示/回复回读/锚点、撤权拒绝和无阅读权限清理、版本元信息展示及禁止恢复不改正文。账号和版本使用可注入 Provider，不声称真实租户或 Safari 引擎通过。证据 `_codex/verify-logs/mobile-evidence.json`。
- [x] T033 [US4] 在 `test/collab/converge.test.js` 和 `test/collab/hocuspocus-wire.test.js` 验证离线恢复、重复回调、冲突合并和远端不覆盖（协同/离线策略与 ProviderTask 恢复队列共 54 项通过；新增幂等 key 去重、成功回调确认后不重复回放；真实浏览器端仍由 T032 单独阻塞）

### Implementation

- [x] T034 [US4] 在 `src/providers/comments.js`、权限/authorization Provider、`src/core/mention/directory.js`、`src/components/lark-doc/CommentPanel.vue` 和 comments/mention mixin 中完成权限投影与回读（评论读写 capability、第二账号实体回读、锚点失联、mention 编辑权限与离职过滤已覆盖；comments-core/comments-ui/mention 87 项通过）
- [x] T035 [US4] 在 `src/components/lark-doc/VersionPanel.vue`、`src/components/lark-doc/editor/versioningMixin.js` 和 `src/session/DocumentSession.js` 完成版本只读、恢复权限和刷新状态（只读预览、canRestoreVersion 闸门、恢复后刷新列表与失败降级已覆盖；versioning UI/core 81 项通过）
- [x] T036 [US4] 在 `src/components/lark-doc/LarkDocEditor.vue`、`src/components/lark-doc/LarkDocWorkspace.vue`、`src/components/lark-doc/editor/viewModesMixin.js` 和 `src/components/lark-doc/editor/commentsMixin.js` 完成窄屏/横屏 runtime 能力（viewport 状态、resize/orientationchange 监听清理、根节点窄屏/横屏 class 与布局降级已完成；相关确定性回归通过）
- [x] T037 [US4] 在 `src/core/storage/`、`src/collab/` 和 `src/providers/persistence.js` 实现离线快照、同步队列、幂等恢复和过大快照拒绝（IndexedDB/localStorage/内存降级、512KB UTF-8 闸门、离线快照停表清理、ProviderTask 幂等恢复队列与协同收敛已完成）

## Phase 7: User Story 5 - Provider 写入与输出安全 (Priority: P2)

**Goal**: 宿主写入、导入任务、回收站和输出安全策略可观察、可重试、可回读且可审计。

**Independent Test**: `npm run test:unit -- test/unit/survey-provider.test.js test/unit/import-provider.test.js test/unit/ai-provider.test.js test/unit/embedded-provider.test.js test/unit/versioning-core.test.js test/unit/security-provider.test.js test/unit/export-roundtrip.test.js`。

### Tests

- [x] T038 [P] [US5] 在 `test/unit/survey-provider.test.js`、`test/unit/import-provider.test.js` 和 `test/unit/ai-provider.test.js` 验证幂等 key、进度、部分成功、重试、提交、回滚和刷新回读（survey/import/AI 宿主边界、导入批次状态机、失败项重试/提交/回滚、AI 流式取消与 revision guard 已覆盖；13 项通过）
- [x] T039 [P] [US5] 在 `test/unit/embedded-provider.test.js` 与 `test/unit/export-roundtrip.test.js` 验证 docx/Markdown/web 导入和宿主拒绝不假成功（embedded Provider 宿主上下文、资源状态/移动能力 fail-closed，并将 deny/approval_required/ok:false/非零 code 转为稳定异常；Markdown/docx/web 往返、结构签名、范围闸门、文件名安全化、下载/打印出口共 101 项通过；真实宿主租户验收仍待环境证据）
- [x] T040 [P] [US5] 新增 `test/unit/output-policy.test.js`，验证复制、打印、下载、截图、水印、敏感字段和审计事件（新增统一 output policy：四类输出动作 fail-closed、可见/不可见水印属性、文本凭据脱敏和 AuditEvent；并修正 security Provider 对普通策略回执的误拒绝；输出/审计/安全/导出回归 100 项通过）
- [x] T041 [US5] 在 `test/unit/versioning-core.test.js`、`test/unit/versioning-ui.test.js` 验证回收站删除/恢复/彻底删除和 stale/unavailable 状态（内存 Provider 新增 remove/listDeleted/restoreDeleted/purge，区分 E_VERSION_DELETED/E_VERSION_GONE/E_VERSION_EVICTED/E_VERSION_NOT_FOUND；版本 UI 新增 deleted/stale/unavailable 状态投影与稳定文案；版本核心/UI 回归 84 项通过）

### Implementation

- [x] T042 [US5] 在 `src/providers/survey.js`、`src/providers/import.js`、`src/providers/ai.js`、`src/providers/embedded.js` 和 `src/providers/persistence.js` 统一 ProviderTask 状态机和幂等回读（新增 runProviderTask 与统一状态/结果快照；survey/import/embedded/AI writeback/feedback/persistence 均接入显式幂等 key 回读；相关 ProviderTask/Provider/持久化回归 59 项通过）
- [x] T043 [US5] 在 `src/utils/importExport.js`、`src/components/lark-doc/ExportDialog.vue` 和导入 UI 接入 docx/Markdown/web 任务进度、失败重试和回滚（导入控制器新增进度汇总/失败项重试/回滚投影；工作台显示进度、失败项重试与回滚入口；导入失败保留原正文并记录可重试错误；导入/ProviderTask/导出相关回归 99 项通过）
- [x] T044 [US5] 在 `src/core/versioning/`、`src/components/lark-doc/VersionPanel.vue` 和文档操作入口补齐回收站 UI、复制文档和权限负向路径（VersionPanel 增加回收站列表/恢复/彻底删除入口；版本 mixin 对缺 Provider/无 canCreateVersion fail-closed；顶栏创建副本发出带标题和 JSON 的宿主事件；版本/顶栏回归 86 项通过）
- [x] T045 [US5] 在 `src/providers/security.js`、`src/components/lark-doc/editor/TopBar.vue`、`src/components/lark-doc/ExportDialog.vue`、`src/utils/download.js` 和 `src/styles/print.css` 实现输出策略、水印和 AuditEvent（exportMixin 接入 download/print policy、visible/invisible 水印属性与 output-audit 事件；ExportDialog/print.css 投影水印；输出策略/导出回归 92 项通过）

## Phase 8: User Story 6 - 性能与交付收口 (Priority: P3)

**Goal**: 性能、存储、白板范围和全量门禁都有可复现证据，所有环境阻塞被正确标记。

**Independent Test**: `npm run check:perf && npm run check:gate && npm run check:artifacts && npm run verify:all`。

### Tests and implementation

- [x] T046 [P] [US6] 在 `scripts/perf/measure.mjs`、`scripts/perf/report.mjs` 和 `test/unit/perf-gate.test.js` 建立首屏、击键、decorations、滚动 FPS、保存、堆内存、2,000 块和包体基线（空闲机器实测 seed=42、2,000 块：首屏 435.3ms、击键 p95/p99 558.5/1007.8ms、装饰增量 3.1ms、稳态滚动 60.7 FPS、保存 6.1ms、堆 14.7MB；性能门禁 65 项通过；Element gzip 372.76KB/480KB；完整 check:perf 因首次并发构建尾流触发 EPIPE，拆分 build:element 后独立 measure/report 通过）
- [x] T047 [P] [US6] 在 `test/unit/derived-index.test.js`、`test/unit/derived-hydration.test.js`、`test/unit/derived-snapshot.test.js` 和 `test/unit/storage-idb.test.js` 验证仅按基线证据启用的优化（派生索引增量/冷路径、早期目录水合与 pending 闸门、快照指纹判伪、IndexedDB 分层与 512KB 边界共 66 项通过；T046 实测装饰增量 3.1ms、滚动 60.7 FPS，暂无证据支持新增窗口化或额外重构）
- [x] T048 [US6] 在 `src/core/derive/`、`src/core/storage/`、`src/components/lark-doc/extensions.js` 和 `src/components/lark-doc/workspace.js` 实施必要的脏区更新、DerivedIndex 或 IndexedDB 分层（现有 DerivedIndex 已接入正文变更脏区/增量与冷路径回退；持久化已采用 IndexedDB meta/content/snapshots 分层并降级到 localStorage/内存；T047 定向回归 66 项通过，结合 T046 性能证据无需新增无证据优化）
- [x] T049 [US6] 在 `src/components/lark-doc/editor/`、`src/core/blocks/web-embed.js` 和相关需求文档中明确白板/画板是 webEmbed 骨架还是版本化延期，不在 core 自研 Canvas（0.12 采用版本化延期：当前租户两轮验证菜单点击 8 秒无产出，需求已明确 V1 skip；保留既有 `webEmbed` 原子块作为未来 host-owned/成熟库骨架边界，正文不引入 Canvas，不伪造白板 UI 或数据）
- [ ] T050 [US6] DOING：最终复核全量 Vitest 97文件/2192项通过，lint、架构、宿主契约、git diff --check通过；T028 capability 视觉投影已完成；T032 手机/平板模拟器12/12通过。当前源码已由独立验证宿主重建，真实正文/图表/公式/存盘刷新及 Element 双实例烟测通过；Chromium 完整矩阵14个目标全部通过，其中 splitting 13/13、mobile 12/12、clipboard 10/10，element 14/14，宿主契约6/6。`check:artifacts` 构建与 Vditor95项通过，但最新复核 ESM gzip 287.09kB 超285kB预算2.09kB；最新稳定采样 decorationIncrementalMs 2.9ms通过、heap18.1MB相对14.7MB基线退化约23%仍失败，未修改预算或性能基线。真实宿主租户写入证据仍缺；T019/T023/T028已完成，T023组件接线及本地宿主矩阵已完成。
- [x] T051 [US6] DONE：在线 Demo 交付与隔离验收。已补齐 `docs/public/demo/wc/index.html`、`docs/public/demo/vanilla/index.html`、`scripts/demo-sync-vendor.mjs` 及 UMD 异步分块；无 broker 环境下 `npm run build:umd` 成功，vendor 已同步到 package 版本 0.12.1。Chromium 桌面与 390×844 窄屏三页均加载成功，编辑器/Web Component 挂载、无横向溢出、控制台无错误、资源无404；Playground 配置重建后正文保全、storage 隔离和窄屏预览/代码 Tab 切换均通过。不得修改现有包源码、构建门禁或文档站配置。

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
