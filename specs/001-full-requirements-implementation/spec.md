# Feature Specification: 按需求文档完成 lark-doc 全量代码逻辑

**Feature Branch**: `spec-kit/requirements-audit`

**Created**: 2026-10-30

**Status**: Ready for planning

**Input**: User description: 根据当前文件目录下的需求文档及代码实现，按照 Spec Kit 执行第一步需求梳理；当前目标是按照需求文档实现全部代码逻辑。

## 1. 范围说明

本特性不是新增单一 UI，而是对当前 lark-doc 0.12 项目进行“需求文档 → 可验证代码实现”的完整收口。需求来源为 `requirements/00-README.md` 至 `requirements/17-全量模块契约.md`，现有实现以 `src/`、测试以 `test/` 为证据。已完成的主体能力只做回归保护，不重复实现；真实缺口必须拆成可独立验收的实施任务。

### 1.1 本轮纳入范围

- 编辑器核心、块模型、块级 CRUD 和统一 `BlockAPI`。
- 撤销/重做、块级剪贴板、多块选择、容器块调用链。
- A4 按钮块动作、异步块状态和权限降级。
- 评论、版本、协同、跨账号、移动端和离线恢复能力的代码闭环。
- survey/import 及宿主 Provider 写入、任务进度、失败重试和刷新回读。
- 回收站、复制、打印、下载、水印和审计安全策略。
- 性能基线、派生索引、脏区更新和 IndexedDB 分层；只有实测证明需要时才实施优化。
- 白板/画板与嵌入能力的最终范围决策和骨架实现。
- 单元、协同、浏览器、产物和门禁验证，以及需求文档状态同步。

### 1.2 明确不纳入范围

以下能力已经根据需求审计明确不做，不得仅因历史文档出现过就重新派活：

- 飞书不存在的顶部固定格式工具栏 `bear-web-toolbar`。
- 飞书不存在的自定义右键菜单。
- 独立折叠块 slash 项。
- Sheet、Slides、Wiki、表格函数等当前编辑器产品线之外的兄弟产品能力。
- 不具备真实宿主契约或账号权限的功能，不得伪造为已完成；应使用可注入 Provider 做确定性测试，并将真实环境标为 `BLOCKED`。

## 2. User Scenarios & Testing

### User Story 1 - 基础文档编辑闭环 (Priority: P1)

作为文档用户，我可以创建、读取、修改、移动、复制、删除和转换块，并对容器块及其子树进行稳定操作；所有操作都遵循统一块 API。

**Why this priority**: 这是所有 UI、协同、Provider 和输出能力的共同地基，缺失会导致后续功能各自实现且无法收口。

**Independent Test**: 通过 BlockAPI 和编辑器命令测试，对普通块、容器块、非法 blockId、权限拒绝和事务失败分别执行操作，验证状态、事件和回滚结果。

**Acceptance Scenarios**:

1. **Given** 文档包含普通块和容器块，**When** 用户执行 insert/update/remove/move/duplicate/transform，**Then** 文档结构、children 顺序和事件结果符合统一契约。
2. **Given** 用户复制或粘贴块子树，**When** 操作完成，**Then** 副本拥有新的 blockId，原结构和锚点不被破坏。
3. **Given** 操作引用非法父节点或用户没有权限，**When** 调用统一 API，**Then** 操作被拒绝并保持事务前状态。

### User Story 2 - 编辑历史与内容搬运 (Priority: P1)

作为文档用户，我可以撤销和重做本地编辑，并通过单块或多块剪贴板搬运内容；外部 HTML/Markdown 内容会被安全清洗。

**Why this priority**: 编辑器没有可靠历史和剪贴板，核心编辑体验不完整，也无法验证 blockId、协同和输出之间的一致性。

**Independent Test**: 使用单元测试和协同测试覆盖新增、删除、移动、属性修改、剪切、粘贴、远端更新、空选择和粘贴失败。

**Acceptance Scenarios**:

1. **Given** 连续编辑发生在 800ms 分组窗口内，**When** 用户撤销，**Then** 按 V1 规则合并为一个历史组，最多保留 100 步且 blockId 恢复正确。
2. **Given** 协同会话收到远端更新，**When** 用户撤销本地操作，**Then** 不会撤销远端编辑，accept/reject 不进入本地历史栈。
3. **Given** 用户粘贴外部 HTML/Markdown，**When** 内容进入编辑器，**Then** 仅保留白名单结构和属性，不执行脚本或注入不安全内容。

### User Story 3 - 异步内容与权限降级 (Priority: P1)

作为文档用户，我可以看到文件、图片、表格、网页嵌入和未知块在加载、空、失败、无权限、超限状态下的明确反馈，并在允许时重试或只读查看。

**Why this priority**: 异步块是数据丢失和权限误操作的高风险区域，必须在移动端和宿主 Provider 之前统一状态语义。

**Independent Test**: 为每种异步块注入成功、空、加载、失败、无权限、超限 Provider，验证降级卡、重试、键盘操作、只读和不可删除语义。

**Acceptance Scenarios**:

1. **Given** 异步块请求正在加载，**When** 用户查看文档，**Then** 显示统一加载状态且不覆盖已有数据。
2. **Given** 请求失败或超限，**When** 用户选择重试或关闭，**Then** 重试遵循幂等约束，拒绝不会误删原块。
3. **Given** 用户没有读取或编辑能力，**When** 打开对应块，**Then** 仅显示授权允许的内容和操作，禁止通过 UI 或 API 绕过权限。

### User Story 4 - 协同、评论、版本与跨端恢复 (Priority: P2)

作为协同用户，我可以在第二账号、评论、版本只读、移动端和离线场景中继续安全查看与恢复文档，重新联网后不会重复提交或覆盖远端内容。

**Why this priority**: 这些能力决定项目是否达到真实宿主可用，而不是只在单浏览器演示中可用。

**Independent Test**: 使用可注入权限、评论、协同和存储 Provider，覆盖第二账号降级、无权限 mention、Safari 评论回读、窄屏/横屏、离线快照和恢复同步。

**Acceptance Scenarios**:

1. **Given** 第二账号无编辑权限，**When** 其打开文档并尝试编辑、评论或恢复版本，**Then** 只有授权能力可见，拒绝结果可解释且不改变文档。
2. **Given** 移动端暂时离线，**When** 用户查看或编辑允许缓存的内容，**Then** 文档状态和离线快照保持一致，恢复联网后变更幂等合并。
3. **Given** 评论在 Safari 中创建并回读，**When** 用户刷新或切换账号，**Then** 评论锚点、作者状态和回复链保持正确。

### User Story 5 - Provider 写入与输出安全 (Priority: P2)

作为宿主集成方，我可以通过 Provider 完成问卷、导入、AI/妙记/跨表引用等受控写入，并通过回收站、复制、打印、下载和水印策略输出内容，同时获得可审计的安全事件。

**Why this priority**: 没有宿主写入和安全输出，项目只能作为孤立编辑器，无法完成业务闭环。

**Independent Test**: 使用模拟宿主 Provider 验证任务创建、进度、部分成功、重试、提交、回滚、幂等、刷新回读和 token 隔离。

**Acceptance Scenarios**:

1. **Given** 导入任务包含可成功和失败的内容，**When** 用户提交导入，**Then** 可以查看进度和部分结果，失败项可重试或回滚，最终状态可刷新回读。
2. **Given** 宿主拒绝 Provider 写入，**When** 编辑器收到拒绝，**Then** 不伪造成功状态，不将第三方 token 写入 core/editor，并记录可审计事件。
3. **Given** 用户复制、打印或下载文档，**When** 输出策略要求水印或敏感字段处理，**Then** 输出遵守策略且不泄露受保护字段。

### User Story 6 - 性能与交付收口 (Priority: P3)

作为项目维护者，我可以用可复现的门禁、产物、性能和浏览器矩阵验证需求实现，并知道任何真实环境缺口是失败还是明确阻塞。

**Why this priority**: 没有可复现验收，代码完成状态无法可信交接。

**Independent Test**: 执行受影响模块定向测试、`check:gate`、产物检查、浏览器验证和必要的性能基线，核对工作区状态及文档状态。

**Acceptance Scenarios**:

1. **Given** 所有实施任务完成，**When** 执行项目门禁和浏览器矩阵，**Then** 结果可复现，失败包含首个失败点和环境原因。
2. **Given** 性能基线未达到目标，**When** 分析数据后，**Then** 只实施有证据支持的 DerivedIndex、脏区更新或 IndexedDB 优化，不为满足指标而放宽预算。

## 3. Edge Cases

- blockId 不存在、重复或被外部内容伪造时，API 必须拒绝并保持文档不变。
- 容器嵌套超过限制、循环引用、空容器和只含不可见子节点时，结构操作不得崩溃或丢失兄弟节点。
- 撤销栈达到 100 步、跨越协同远端更新、刷新后恢复和历史分组边界必须有明确结果。
- 剪贴板为空、跨 tab、内部 MIME 损坏、外部 HTML 含脚本、图片上传失败时，必须显示可恢复状态。
- Provider 超时、重复回调、部分成功、网络恢复、宿主拒绝和刷新期间删除时，不得出现假成功或旧状态残留。
- 权限从可写降为只读、用户离职、mention 无法解析、评论锚点失效时，必须安全降级。
- 离线快照超过单份 512KB 限制时，必须拒绝或分层存储并给出明确原因。
- Safari、移动窄屏、横屏和无触控鼠标环境下，核心操作不能依赖单一输入方式。

## 4. Functional Requirements

### Core and workflow

- **FR-001**: System MUST provide one consistent contract for insert, update, remove, move, duplicate, transform, get, children, and batch block operations.
- **FR-002**: System MUST preserve block identity semantics: duplicate and paste create new IDs; move, undo, redo, anchors, and collaboration preserve the intended IDs.
- **FR-003**: System MUST support a 100-step local history with approximately 800ms grouping, local origin semantics, remote-update isolation, and accept/reject exclusion.
- **FR-004**: System MUST support single-block, multi-block, container subtree copy/cut/paste and safe external HTML/Markdown sanitization.
- **FR-005**: System MUST keep quote and heading containers structurally valid during nesting, folding, outline updates, numbering, and clipboard operations.

### Blocks, actions, states, and permissions

- **FR-006**: System MUST complete A4 button actions for duplicate page and follow updates, including host rejection, network failure, and refresh readback.
- **FR-007**: System MUST represent empty, loading, failed, unauthorized, and over-limit states consistently for every asynchronous block.
- **FR-008**: System MUST map capabilities to visible, disabled, read-only, and rejected behavior at both UI and API boundaries.
- **FR-009**: System MUST prevent failed or unauthorized asynchronous operations from deleting or overwriting existing content.

### Collaboration and cross-device behavior

- **FR-010**: System MUST support deterministic permission projection for a second account, unavailable mentions, departed users, and comment operations.
- **FR-011**: System MUST support mobile comments/replies, notifications, anchors, read-only versions, narrow/landscape layout, offline snapshots, and sync recovery within documented limits.
- **FR-012**: System MUST preserve comment anchors and version state across supported browser and refresh flows, including Safari verification when the browser runner is available.

### Provider and output

- **FR-013**: System MUST provide idempotent host-write flows for survey, import, AI, meeting notes, cross-table references, subscriptions, and local templates where the host contract exists.
- **FR-014**: System MUST expose import task progress, partial success, retry, commit, rollback, and refresh readback for docx, Markdown, and web sources.
- **FR-015**: System MUST provide recoverable recycle-bin/version UI and distinguish deleted, restored, unavailable, and stale states.
- **FR-016**: System MUST enforce copy, print, download, screenshot, watermark, audit, and sensitive-field policies without exposing third-party credentials to core/editor.

### Performance and delivery

- **FR-017**: System MUST establish reproducible performance and storage baselines before introducing optimization.
- **FR-018**: System MUST implement DerivedIndex, dirty-region updates, IndexedDB layering, or conditional virtualization only when baseline evidence demonstrates need and without relaxing existing budgets.
- **FR-019**: System MUST make the whiteboard/board scope explicit: deliver a `webEmbed`/mature-library skeleton or record a versioned deferral; no ambiguous unfinished feature remains.
- **FR-020**: System MUST provide unit, collaboration, browser, artifact, architecture, and gate verification for each completed requirement.
- **FR-021**: System MUST update `spec.md`, `tasks.md`, and relevant `requirements/` status whenever implementation status changes.

## 5. Key Entities

- **Block**: 文档中的可编辑节点，具有稳定 blockId、类型、属性、父子关系和显示/权限状态。
- **BlockOperation**: 对一个或多个 Block 执行的结构或属性变更，具有来源、权限、事务和回滚语义。
- **HistoryEntry**: 本地可撤销编辑的分组记录，保存变更、blockId、来源和协同边界。
- **ClipboardPayload**: 内部块 MIME 或外部 HTML/Markdown 内容，包含清洗、ID 重映射和失败状态。
- **Capability**: 用户或宿主对块、评论、版本、Provider 和输出操作的能力投影。
- **AsyncBlockState**: 异步块的空、加载、失败、无权限和超限状态及其可恢复动作。
- **ProviderTask**: 宿主写入或导入任务，包含任务状态、进度、幂等键、部分结果、错误和回读结果。
- **DocumentSnapshot**: 文档在版本、离线缓存或导出过程中的一致性快照。
- **AuditEvent**: 复制、输出、权限拒绝、Provider 写入和敏感字段处理的审计事件。

## 6. Success Criteria

### Measurable Outcomes

- **SC-001**: 21 项功能需求均有对应源码范围、测试范围和明确验收命令；没有未映射的实施需求。
- **SC-002**: BlockAPI、历史栈、剪贴板和异步状态矩阵的定向测试在干净依赖环境中 100% 通过。
- **SC-003**: 已完成任务不引入原有架构门禁、产物预算或适配器回归；阶段收口时 `check:gate`、`check:artifacts` 和必要浏览器验证可复现。
- **SC-004**: 协同、离线恢复和 Provider 重试场景不会产生重复提交、远端覆盖、假成功或旧状态残留。
- **SC-005**: 所有未具备真实宿主/浏览器条件的能力被明确标记为 `BLOCKED`，并有确定性替代测试，不伪报 `DONE`。
- **SC-006**: 性能优化只在基线证据支持时实施，既有包体和运行时预算不被放宽。
- **SC-007**: 每个新会话可以仅依赖根目录 `spec.md`、`tasks.md` 和当前任务列出的受影响文件继续工作，无需重新加载全部需求文档。

## 7. Assumptions

- 当前 0.12 的 UI 基线仍为 Vue 2.7 + Tiptap 3.32，core 保持框架无关。
- Yjs/Hocuspocus 负责协同；宿主 Provider 的真实服务端不在本仓库实现，但必须通过契约和可注入测试验证。
- 现有已完成能力不重做；本特性首先收口真实缺口，再进行全量回归。
- 真实第二账号、Safari、移动端宿主和第三方 Provider 可能暂时不可用；此时状态为 `BLOCKED`，不是 `DONE`。
- 项目使用当前隔离 worktree `/Users/cjjxw/codex/.wt-larkdoc/spec-kit-audit`；不得修改原 `next/0.12` 工作区的未提交内容。
- Spec Kit 根目录交接文件继续使用 `spec.md` 和 `tasks.md`；本特性目录用于遵循 Spec Kit 标准工作流，避免复制内容造成漂移。
