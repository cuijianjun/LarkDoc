# 飞书文档运行时需求采集 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 对当前未确认的 11 类飞书文档功能完成可复现的运行时采集、REA 静态交叉分析和需求文档回写，使每个功能具备入口、状态机、接口字段、权限差异、失败行为和跨端验收证据。

**Architecture:** 采用“运行时探针 + 网络/资源捕获 + REA 分组静态分析 + 文档契约回写”的四层流程。浏览器操作产生唯一测试数据，CDP/Playwright 记录 DOM、AX、Fetch/XHR、WebSocket/SSE 和新增资源；REA 只分析本轮新增或与功能相关的 bundle，避免主 bundle 的语义图预算影响结果。最终以功能用例和 Evidence ID 作为唯一追踪单位，把真实字段与推断字段分开。

**Tech Stack:** Chrome Computer Use/Playwright 或现有浏览器重放工具、Chrome DevTools Protocol、Node.js、`rea-agents@6.7.0` CLI、Python JSON/Markdown 校验脚本；移动端使用 Chrome device emulator；Safari 只用于跨浏览器回读。

**Spec:** `requirements/00-交接-进度快照.md`、`requirements/05-接口文档.md`、`requirements/10-缺口与待补清单.md`、`requirements/17-全量功能模块契约.md`，以及本计划覆盖的 11 项未确认清单。

## Global Constraints

- 只操作用户指定的飞书文档页签；其他浏览器页签不读取、不切换、不修改。
- 所有探针使用唯一 marker；每条用例结束必须执行评论、临时文档、临时文件和回收站清理。
- 不把静态 endpoint 字符串当成开放 API；真实请求体、响应体和字段来源必须标记为 `runtime`、`static` 或 `inferred`。
- 所有运行时抓包、下载资源和原始 Evidence 只放在 `/tmp/lark-rea-runtime-20261025/`；任务完成后先干检再删除。
- 不修改真实文档正文、组织权限或企业安全策略；涉及副本、评论和导入必须使用可清理探针。
- Evidence 等级统一为：S0 静态、S1 UI、S2 请求响应、S3 刷新/重开持久化、S4 跨账号/跨端/失败闭环。
- 主 bundle 单独分析超时或 heap 受限时，必须拆分为功能分组分析，不得据此判断功能不存在。
- 每个功能必须记录正向路径、至少一个权限/失败路径和清理路径。

## Review Focus

- **选区/块评论锚点漂移：** 文字、标题、列表、表格单元格、代码块和嵌套块在修改、移动、删除后必须保持或明确失效；由任务 3 的锚点回放测试覆盖。
- **并发丢失更新：** 两账号同块输入、删除、移动和断网恢复必须最终收敛且能解释 revision/operation 顺序；由任务 4 的冲突矩阵覆盖。
- **异步任务假成功：** AI、导入、问卷提交和 provider 同步不能以 HTTP 200 代替业务成功；由任务 6、8、9、10 的状态机断言覆盖。
- **权限降级泄露：** 无权限时不能泄露正文、评论、引用或文件下载地址；由任务 3、5、9、10 的多账号负向测试覆盖。
- **临时对象残留：** 副本、导入文件、评论和回收站对象必须可定位、删除并刷新确认；由任务 2、7、12 的清理断言覆盖。

## Evidence Contract

所有采集任务共用以下结构，不直接把原始日志粘进需求文档：

```ts
interface RuntimeEvidence {
  caseId: string;
  feature: string;
  actor: 'personal' | 'company' | 'anonymous';
  surface: 'desktop' | 'mobile-emulator' | 'safari';
  documentToken: string;
  preconditions: Record<string, unknown>;
  actions: Array<{step: number; intent: string; locator?: string}>;
  uiSnapshots: Array<{state: string; text?: string; bounds?: unknown}>;
  requests: Array<{method: string; url: string; requestBody?: unknown; responseBody?: unknown; status: number}>;
  realtimeMessages?: Array<{channel: string; direction: 'in'|'out'; payload: unknown}>;
  resourcesBefore: string[];
  resourcesAfter: string[];
  reaEvidenceIds: string[];
  persistenceCheck: 'none'|'refresh'|'reopen'|'cross-client';
  cleanup: Array<{action: string; verified: boolean}>;
  level: 'S0'|'S1'|'S2'|'S3'|'S4';
}
```

真实捕获字段写入 `runtime`，REA 发现写入 `static`，仅由静态调用方或官方语义推导的字段写入 `inferred`。每条用例必须有唯一 `caseId` 和可复核的网络/截图/资源路径。

---

### Task 1: 运行时采集基线与 REA 资源增量

**Files:**
- Create: `/tmp/lark-rea-runtime-20261025/`（临时资源、运行日志和 Evidence，任务完成后删除）
- Modify: `requirements/00-交接-进度快照.md`（只在阶段完成时回写）
- Modify: `requirements/10-缺口与待补清单.md`（登记采集矩阵和证据等级）

**Interfaces:**
- Produces: `RuntimeEvidence`、资源 manifest、网络事件 JSON、REA Evidence ID。
- Consumes: 现有 `feishu-recon/out/batch*.json`、已有四份需求文档和登录态浏览器页签。

- [ ] 保存指定文档页签的 URL、actor、设备、资源 manifest、WebSocket/SSE 连接和初始 DOM/AX 快照。
- [ ] 为每个后续用例实现操作前/后的资源 diff，至少记录新增 JS、Worker、iframe chunk 和 Source Map。
- [ ] 为新增 bundle 按功能分组运行 `rea-agents@6.7.0 analyze-javascript-application`；大文件单独分析，小文件按模块分析。
- [ ] 校验请求脱敏规则：不保存 cookie、token、密码或验证码；保留 requestId、revisionId 和业务错误字段。
- [ ] 运行基线校验，确认资源清单可复用、Evidence JSON 可解析、每条用例可定位到浏览器页签。
- [ ] **验证：** 资源 manifest、网络日志和 REA JSON 均可解析；主 bundle 失败时存在分组 Evidence；没有触碰其他页签。

### Task 2: A4 按钮块副本与订阅生命周期

**Files:**
- Modify: `requirements/05-接口文档.md`：补充副本提交、订阅取消的真实字段和状态机。
- Modify: `requirements/17-全量功能模块契约.md`：完善 `button.duplicate` 和 `document.subscription`。
- Modify: `requirements/10-缺口与待补清单.md`：将探针从 UI 证据升级到 S4。
- Modify: `requirements/00-交接-进度快照.md`：登记副本 token、清理结果和 Evidence ID。

**Interfaces:**
- Consumes: Task 1 的资源/网络捕获和既有按钮块探针。
- Produces: `DuplicateDocumentResult`、`SubscriptionState`、副本清理 Evidence。

- [ ] 使用唯一按钮块 marker，记录动作菜单、创建副本弹窗、默认标题、位置树和取消行为。
- [ ] 点击「确定」创建副本，捕获实际请求、业务状态、newToken、URL、parentToken 和权限字段。
- [ ] 在新副本中检查正文、按钮块、资源、评论、历史、分享和权限是否符合复制策略。
- [ ] 使用原账号刷新并在另一浏览器回读副本，确认对象存在且可打开。
- [ ] 进入订阅状态，验证重复订阅幂等、取消订阅入口、取消后刷新状态和通知状态。
- [ ] 删除副本并完成回收站彻底删除，确认源文档未变化。
- [ ] **验证：** 创建副本、跨浏览器回读、订阅/取消订阅、删除清理均达到 S4；未确认字段保留为 `unknown`。

### Task 3: 桌面和移动端选区/块评论闭环

**Files:**
- Modify: `requirements/05-接口文档.md`：新增 `CommentAnchor`、选区/块评论请求响应和锚点生命周期。
- Modify: `requirements/17-全量功能模块契约.md`：新增 `comment.selection-anchor`。
- Modify: `requirements/10-缺口与待补清单.md`：登记块类型矩阵和移动端差异。
- Modify: `requirements/00-交接-进度快照.md`：登记评论入口和跨端 Evidence。

**Interfaces:**
- Consumes: Task 1 的抓包和 DOM/AX 快照。
- Produces: `CommentAnchor`、`CreateCommentResult`、块类型评论矩阵。

- [ ] 在段落、标题、列表、表格单元格、代码块、引用块、图片/文件、按钮块、表格/多维表格、问卷卡片上分别验证文字选区和整块评论。
- [ ] 验证工具栏按钮、快捷键、右键菜单、悬浮气泡四类入口，记录 tooltip、可用条件和禁用文案。
- [ ] 捕获 comment add/reply/update/delete/resolve/reaction/mention 的真实请求和响应，区分 `blockId`、`contentAnchorId`、`rangeStart`、`rangeEnd`、`quote` 和 `revisionId`。
- [ ] 修改、拆分、合并、移动和删除被评论块，刷新并重新打开，记录锚点跟随、漂移或孤儿评论行为。
- [ ] 在移动端重复创建、编辑、回复、删除、表情、解决和权限负向路径。
- [ ] 使用公司账号回读个人账号评论，验证可见性、可编辑性、删除权和通知差异。
- [ ] 清理全部评论和测试正文。
- [ ] **验证：** 每个块类型都有明确的“文字选区/整块/不支持”结果；桌面、移动端和第二账号分别有 S3/S4 证据。

### Task 4: 双账号同块并发、光标和 OT

**Files:**
- Modify: `requirements/05-接口文档.md`：补充 RCE/OT 消息字段、revision 和冲突状态。
- Modify: `requirements/17-全量功能模块契约.md`：完善 `collaboration.presence`、`collaboration.ot`。
- Modify: `requirements/10-缺口与待补清单.md`：记录并发矩阵和收敛结果。
- Modify: `requirements/00-交接-进度快照.md`：登记两个账号、浏览器和消息 Evidence。

**Interfaces:**
- Consumes: Task 1 的两个登录态、Task 3 的块/comment anchor。
- Produces: `CollaborationTrace`，包含 operation、revision、cursor 和冲突结果。

- [ ] 在 Chrome 和 Safari 使用两个不同账号进入同一文档同一块。
- [ ] 分别执行同位置输入、不同位置输入、删除/编辑、移动块/编辑块、评论/正文并发。
- [ ] 记录 WebSocket/SSE 的 CLIENT_VARS、NEW_CHANGES、USER_CHANGES、WATCH、UNWATCH、ENGAGEMENT_CURSOR 和 server sequence。
- [ ] 断网、恢复、后台切换、刷新和撤销重做，验证落后方补偿同步。
- [ ] 验证冲突提示、最终文本、块结构、评论锚点和光标颜色是否一致。
- [ ] 删除测试内容并确认两个账号刷新后文档恢复基线。
- [ ] **验证：** 并发场景最终收敛；任何丢失更新、无法解释的冲突或权限越权都进入缺口清单。

### Task 5: 移动端实时协同和 OT

**Files:**
- Modify: `requirements/05-接口文档.md`：补充移动端 client capability 和同步降级。
- Modify: `requirements/17-全量功能模块契约.md`：补充 `mobile.collaboration`。
- Modify: `requirements/10-缺口与待补清单.md`、`requirements/00-交接-进度快照.md`：登记移动端矩阵。

**Interfaces:**
- Consumes: Task 4 的实时消息契约。
- Produces: 移动端协同 Capability Matrix。

- [ ] 使用 Chrome device emulator 验证移动端输入、删除、撤销、重做和块移动。
- [ ] 桌面端编辑后移动端回读，移动端编辑后桌面端回读。
- [ ] 测试前后台切换、弱网/断网恢复、重新打开文档和权限变化。
- [ ] 验证移动端是否显示他人光标、头像、在线状态和冲突提示。
- [ ] 区分完整 OT、最终状态同步和只读降级。
- [ ] **验证：** 每项 capability 有实际消息或持久化证据，不能只根据响应 200 判断成功。

### Task 6: 问卷 provider 完整生命周期

**Files:**
- Modify: `requirements/05-接口文档.md`：补充问卷题目、提交、结果表、权限和重试 API。
- Modify: `requirements/17-全量功能模块契约.md`：完善 `workspace.survey`。
- Modify: `requirements/10-缺口与待补清单.md`、`requirements/00-交接-进度快照.md`：登记问卷闭环。

**Interfaces:**
- Consumes: Task 1 的 provider chunk、个人/公司账号和移动端模拟器。
- Produces: `SurveyDefinition`、`SurveySubmission`、`SurveyResultStore`。

- [ ] 创建并保存单选、多选、文本、日期、评分题；分别修改、删除、设置必填。
- [ ] 生成填写链接，个人账号提交，公司账号查看，验证结果多维表格字段和 rowId。
- [ ] 重复提交、关闭问卷、无权限访问、网络失败和重试。
- [ ] 移动端填写并回读结果；验证结果权限和导出入口。
- [ ] 清理问卷、结果表和链接。
- [ ] **验证：** 题目版本、submissionId、duplicatePolicy、resultTableToken、失败重试和权限拒绝均有 S2/S3/S4 证据。

### Task 7: AI 生成与失败状态机

**Files:**
- Modify: `requirements/05-接口文档.md`：补充 AI session/task、流式结果、停止、引用和反馈字段。
- Modify: `requirements/17-全量功能模块契约.md`：完善 `doc-ai` 状态机。
- Modify: `requirements/10-缺口与待补清单.md`、`requirements/00-交接-进度快照.md`：登记 AI Evidence。

**Interfaces:**
- Consumes: Task 1 的 AI chunk 和文档选择区。
- Produces: `AiTaskTrace`，状态为 `queued|running|streaming|success|stopped|timeout|failed|partial`。

- [ ] 分别执行速览、问答、润色、选区改写、智能回复、预生成答案和会议摘要。
- [ ] 捕获 sessionId、taskId、sourceRevisionId、selection/blockId、prompt、answer、citations、feedback。
- [ ] 在生成中点击停止；制造超时、空选区、超长选区、无权限文档和服务错误。
- [ ] 刷新、重新打开并检查是否写回正文、是否持久化会话和引用。
- [ ] **验证：** 停止、超时和失败不能显示为空成功；引用必须可追溯到文档权限范围内。

### Task 8: 多格式和异常导入

**Files:**
- Modify: `requirements/05-接口文档.md`：补充 Word/Excel/PPTX/XMind/OPML/石墨 parser 和任务状态。
- Modify: `requirements/17-全量功能模块契约.md`：完善 `workspace.import-parser` 和 `BatchImportJob`。
- Modify: `requirements/10-缺口与待补清单.md`、`requirements/00-交接-进度快照.md`：登记格式矩阵、失败和回滚证据。

**Interfaces:**
- Consumes: Task 1 的上传资源基线和既有 Markdown/CSV 导入契约。
- Produces: `BatchImportJob`、`ImportJob`、解析映射报告和清理结果。

- [ ] 为 Word、Excel、PPTX、XMind、OPML、石墨准备最小探针文件，记录格式识别和导入目标类型。
- [ ] 捕获 prepare/merge/finish/parser/import/result 的请求、ticket、jobStatus、warnings、errors。
- [ ] 执行多文件批量、单文件失败、部分成功、取消、重试、重复提交和回滚。
- [ ] 检查标题、段落、表格、图片、附件、链接、幻灯片和大纲的保真度。
- [ ] 清理成功和失败任务产生的云盘对象及回收站对象。
- [ ] **验证：** 每种格式至少有一条 S3 主链和一条异常证据；部分成功不能被全局成功覆盖。

### Task 9: 跨表/图表引用和权限申请

**Files:**
- Modify: `requirements/05-接口文档.md`：补充 createReference/applyReference、权限申请状态和回读。
- Modify: `requirements/17-全量功能模块契约.md`：完善 `sheet-reference`。
- Modify: `requirements/10-缺口与待补清单.md`、`requirements/00-交接-进度快照.md`：登记批准/拒绝矩阵。

**Interfaces:**
- Consumes: Task 1 的 sheet/chart chunk 和两个账号。
- Produces: `ReferenceRequest`、`ReferenceState`。

- [ ] 创建表格引用和图表引用，记录 token、fromObjType、fromObjToken、blockID、sourceRange。
- [ ] 以无权限账号发起申请，捕获申请消息、requestId、状态和 toast。
- [ ] 以有权限账号批准和拒绝，再由申请方刷新回读。
- [ ] 修改源表、删除源表、改变源权限，检查文档引用状态和降级卡。
- [ ] **验证：** 申请、批准、拒绝和失效都不是前端假状态；状态可跨账号回读。

### Task 10: 企业安全策略、水印和审计

**Files:**
- Modify: `requirements/05-接口文档.md`：补充 SecurityDecision、watermark、audit schema。
- Modify: `requirements/17-全量功能模块契约.md`：完善 `workspace.security-label` 和 `workspace.audit`。
- Modify: `requirements/10-缺口与待补清单.md`、`requirements/00-交接-进度快照.md`：登记策略正负向证据。

**Interfaces:**
- Consumes: Task 1 的权限 panel 字段和双账号环境。
- Produces: `SecurityDecision`、`AuditRecord`、策略回读结果。

- [ ] 在可控测试范围切换对外分享、协作者、复制、创建副本、打印、下载、评论、引用和头像策略。
- [ ] 测试允许、拒绝、申请、审批通过、审批拒绝、刷新回读。
- [ ] 验证线上页面水印、下载水印、移动端复制/截图/录屏限制。
- [ ] 查询操作记录，核对 actor、action、objectToken、permissionVersion、reason、createdAt。
- [ ] 恢复原策略，确认测试账号和文档权限回到基线。
- [ ] **验证：** 服务端拒绝与 UI 文案一致；审计记录不包含敏感内容；水印范围可区分页面和下载文件。

### Task 11: Jira、OKR、Bitable provider 运行时闭环

**Files:**
- Modify: `requirements/05-接口文档.md`：补充 provider auth/search/create/read/update/sync/delete 字段。
- Modify: `requirements/17-全量功能模块契约.md`：完善 `host.jira`、`host.okr`、`host.bitable`。
- Modify: `requirements/10-缺口与待补清单.md`、`requirements/00-交接-进度快照.md`：登记宿主边界和降级。

**Interfaces:**
- Consumes: Task 1 的宿主 bundle 和 provider capability。
- Produces: `ProviderCapabilityMatrix`、授权和同步 Evidence。

- [ ] 分别验证 Jira issue/project/filter/JQL、OKR 周期/目标/负责人、Bitable app/table/view/字段。
- [ ] 测试首次授权、授权失效、重新授权、搜索、插入块、读取、更新、同步、解绑。
- [ ] 测试 provider 不可用、无权限、对象删除和宿主返回业务错误。
- [ ] 将宿主能力和编辑器核心能力分开登记；provider 缺失必须显示 readonly/unavailable，不伪造成功。
- [ ] **验证：** 每个 provider 至少有授权、正常读写、同步、失败和清理证据；无法访问的能力明确标为 host-owned。

### Task 12: 统一回写、交叉审计和交付

**Files:**
- Modify: `requirements/05-接口文档.md`
- Modify: `requirements/10-缺口与待补清单.md`
- Modify: `requirements/17-全量功能模块契约.md`
- Modify: `requirements/00-交接-进度快照.md`

**Interfaces:**
- Consumes: Tasks 1–11 的 RuntimeEvidence、REA Evidence 和清理报告。
- Produces: 完整需求契约、缺口矩阵、最终交接快照。

- [ ] 对每个功能建立“入口 → 前置条件 → 操作 → UI → 请求 → 响应 → 持久化 → 跨端回读 → 失败 → 清理”链路。
- [ ] 将真实字段与静态/推断字段分栏，删除未经证据支持的确定性描述。
- [ ] 为每个未达到 S4 的功能保留明确缺口、下一步最小探针和阻塞原因。
- [ ] 检查四份文档的代码围栏、表格、Evidence ID、路径和尾随空格。
- [ ] 干检并删除 `/tmp/lark-rea-runtime-20261025/`，确认无临时对象、评论、文件和权限残留。
- [ ] **验证：** 11 项全部有用例映射；每个用例都有 Evidence 等级；文档可直接交给开发实现。

## 自审结果

- 11 项需求均已映射到 Task 2–11；Task 1 提供统一运行时/REA 基础，Task 12 负责交付审计。
- 选区评论、移动端评论、并发 OT、AI、导入异常、问卷结果、权限拒绝和 provider 降级均有明确的正向与负向检查点。
- 计划不把未执行的请求字段写死；所有字段都要求先捕获、再入契约。
- 本计划只创建一个长期计划文件；运行时资源目录仅在未来执行时临时创建并清理。

## Execution status (2026-10-25)

| Task | Status | Evidence / remaining boundary |
| --- | --- | --- |
| 1 baseline + REA | complete | Baseline and grouped REA evidence recorded |
| 2 A4 duplicate/subscription | complete | Copy confirm/cancel, open/readback, purge, subscribe delete/add |
| 3 comments | complete with gaps | Desktop selection/reply/delete and mobile create/read/delete; mobile edit/reply/reaction/resolve and block-click entry remain ◐ |
| 4 dual-page OT | complete with identity gap | Same-account two-page OT S4; two editable identities/conflict/color remain ◐ |
| 5 mobile realtime | complete with capability gap | Mobile comments verified; mobile OT/cursor/weak-network compensation remain ◐ |
| 6 survey provider | complete with tenant gap | Scan/questions/submit/result/repeat submit E3; creator editor/result table/permissions remain ◐ |
| 7 AI | complete with service failure | Real Doubao request and STREAM_ERROR 710022002 captured; success/stop/timeout/citations remain ◐ |
| 8 import formats | complete with tenant/negative boundary | Word/Excel/PPTX/FreeMind/OPML happy paths and empty-Word failure; native XMind/Graphite and partial retry/rollback remain ◐ |
| 9 sheet/chart reference | complete with metadata blocker | CSRF and server business errors captured; no usable source metadata for approval/rejection loop |
| 10 security | complete with reversible switch | External sharing false→true and Guardian permit captured; tenant reject/audit-table/watermark remain ◐ |
| 11 providers | complete with host boundary | Jira auth + failed search, OKR auth/CORS, Bitable flag/locale; provider CRUD remains ◐ |
| 12 audit/cleanup | complete | Docs format checks pass, one baseline button, empty trash, 476 temp files removed |

## Addendum · 独立产品 Provider 适配层（2026-10-26）

运行时采集任务完成后，新增一项文档架构收口：将 Jira、OKR、多维表格、问卷、AI 建模为独立产品 Provider，文档编辑器只承载嵌入块和引用。适配器契约必须覆盖能力发现、授权、资源 CRUD、权限申请、同步/版本、幂等、失败重试、降级和审计字段；真实产品页面、租户额度、产品角色和资源 ACL 由第三方产品负责。落点为 `requirements/05-接口文档.md §5.32`、`requirements/17-全量功能模块契约.md §17.25`、`requirements/10-缺口与待补清单.md §10.17` 和 `requirements/00-交接-进度快照.md §12.32`。
