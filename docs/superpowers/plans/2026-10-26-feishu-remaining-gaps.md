# 飞书文档未闭环需求补全计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 把当前仍为 ◐ 或未达到 E4 的飞书文档功能逐项完成实机采集、REA 静态交叉分析、权限/失败/回读验证，并把开发级字段和证据写回本地需求文档。

**Architecture:** 沿用已确认的 Provider 适配层架构。飞书文档负责嵌入块、评论、协同、权限状态和回读；问卷、AI、Jira、OKR、Bitable 等原生产品负责自己的资源 CRUD、角色和租户能力。每项任务都使用“入口 → 前置条件 → 操作 → 请求 → 持久化 → 跨端/权限回读 → 失败 → 清理”的证据链。

**Tech Stack:** Chrome Computer Use/Playwright、Chrome iPhone 16 模拟、Safari 跨浏览器回读、CDP Fetch/XHR/WebSocket/SSE 采集、`rea-agents@6.7.0` CLI、Node.js、Markdown/JSON 校验脚本。

**Spec:** `requirements/00-交接-进度快照.md`、`requirements/05-接口文档.md`、`requirements/10-缺口与待补清单.md`、`requirements/17-全量功能模块契约.md`、`requirements/15-闭环审计与端到端流程.md`，以及已确认的 Provider 适配层 `05 §5.32/§5.33`、`17 §17.25/§17.26`。

## Global Constraints

- 只操作用户指定的飞书文档页签，或隔离的 `~/codex/feishu-recon/profile`；不读取、切换或修改其他浏览器页签。
- 主账号可直接设置的租户/应用权限先由超级管理员完成；第三方 Jira 项目权限、AI 套餐额度、问卷创建者资源和源表 ACL 仍按真实阻塞记录。
- 每个测试使用唯一 marker、requestId 和 idempotencyKey；任务结束清理评论、临时块、临时文档、导入对象和回收站对象。
- HTTP 200、iframe 加载和静态 endpoint 都不能单独算成功；至少需要业务响应，E4 还需要刷新、权限、错误和恢复回读。
- 不保存 cookie、Token、密码、验证码或原始敏感表单；REA 只分析真实加载 bundle 的静态内容，并记录 parse failure/heap 限制。
- 移动端统一使用 Chrome iPhone 16 模拟；移动端能力必须单独记录，不能用桌面结果推导。
- 未收到“继续补全需求”或指定任务编号前，本计划只保留，不执行浏览器操作、租户写入或产品代码修改。

## Review Focus

- 块级评论入口在不同块类型和空/有内容状态下必须真实可解释，不能用文字选区评论冒充整块评论。
- 双身份并发必须验证冲突、权限降级、光标和落后方补偿，不能用同账号双 tab OT 代替。
- Provider 的“应用已启用”与“原生资源已初始化/有权限/有额度”必须分开，否则会把空数据误判为成功。
- 失败和部分成功必须保留业务错误、重试条件和回滚结果，不能用空卡片或全局成功覆盖子任务。
- 权限和安全策略的拒绝、审批、审计和水印必须服务端回读，不能只验证前端置灰。

## 执行顺序与依赖

任务按以下顺序执行。任务 1–3 先收口文档原生评论/协同；任务 4–11 按独立 Provider 和安全边界执行；任务 12 补官方目录与宿主能力；任务 13 做最终对账。任何任务遇到租户能力不足，先完成可采部分并记录阻塞，不跳过失败证据。

### Task 1: 桌面选区/块评论与移动端评论完整闭环

**Files:**
- Modify: `requirements/05-接口文档.md`（评论锚点、移动端命令、失败字段）
- Modify: `requirements/10-缺口与待补清单.md`（块类型矩阵与 E 等级）
- Modify: `requirements/17-全量功能模块契约.md`（`comment.selection-anchor`、移动端评论）
- Modify: `requirements/00-交接-进度快照.md`（Evidence、清理结果）

**Consumes:** 既有 `comment/add/reply/update/delete/reaction/resolve` 契约、个人/公司账号、iPhone 16 模拟。

**Produces:** 每个块类型的文字选区/整块/不支持矩阵，以及桌面/移动端 `CommentAnchor` 和权限结果。

- [x] 对段落、标题、列表、表格单元格、代码块、引用块、图片/文件、按钮块、表格/多维表格、问卷卡片分别验证文字选区和整块评论。
- [x] 在桌面验证工具栏、快捷键、块工具条、评论气泡四类入口；捕获 `is_whole/content_anchor_id/quote/rangeStart/rangeEnd/blockId/revisionId`。
- [x] 移动端验证编辑、回复、删除、表情、解决、通知、权限拒绝、失败重试、刷新回读和锚点行为。
- [x] 修改、拆分、合并、移动、删除被评论块，确认锚点跟随、漂移或孤儿评论。
- [x] 清理评论和正文；以 S4/E4 证据回写文档。

### Task 2: 双账号同块并发、冲突、光标和 OT

**Files:** `05-接口文档.md`、`10-缺口与待补清单.md`、`17-全量功能模块契约.md`、`00-交接-进度快照.md`

**Consumes:** Task 1 的块/评论锚点，Chrome 与 Safari 两个真实身份。

**Produces:** `CollaborationTrace`，包含 `memberId/uuid/blockId/version/zone_changesets/apool/RCE cursor/color`。

- [x] 让公司账号和个人账号同时进入同一块，执行同位置输入、不同位置输入、删除、移动块、评论/正文并发。
- [x] 记录 `USER_CHANGES/NEW_CHANGES/WATCH/UNWATCH/ENGAGEMENT_CURSOR/member_list` 和业务冲突码。
- [x] 测试断网、恢复、后台切换、刷新、撤销/重做和落后方补偿。
- [x] 验证最终文本、块结构、评论锚点、冲突提示、在线头像、光标颜色和权限降级。
- [x] 清理 marker 并确认两账号刷新后回到基线。

### Task 3: 移动端实时协同、光标和弱网补偿

**Files:** `05-接口文档.md`、`10-缺口与待补清单.md`、`17-全量功能模块契约.md`、`00-交接-进度快照.md`

**Consumes:** Task 2 的 OT/RCE 字段；Chrome iPhone 16 模拟。

**Produces:** 移动端 capability matrix：完整 OT、最终状态同步、只读降级或不支持。

- [x] 桌面编辑→移动端回读、移动端编辑→桌面端回读。
- [x] 测试移动端前后台切换、断网/弱网、重开文档、权限变化、撤销/重做。
- [x] 验证移动端他人光标、头像、在线状态、冲突提示和落后方补偿。
- [x] 每项 capability 必须有消息或持久化证据；清理测试正文。

### Task 4: Survey Provider 原生后台和结果表

**Files:** `05-接口文档.md`、`10-缺口与待补清单.md`、`17-全量功能模块契约.md`、`00-交接-进度快照.md`

**Consumes:** `SurveyAdapter`、应用 `cli_9db4d6d9e5315102`、超级管理员应用范围和真实问卷创建权限。

**Produces:** `SurveyDefinition/Question/Submission/ResultStore` 的创建、编辑、发布、提交、结果、权限和回滚证据。

- [x] 从问卷原生入口创建单选、多选、文本、日期、评分题，编辑、删除、必填和发布版本。
- [x] 给第二账号分配问卷管理员和结果 Base/table 权限，提交后读取 rowId、字段、结果表和导出。
- [x] 验证重复提交、关闭问卷、无权限访问、失败重试、部分成功和回滚。
- [x] 在移动端填写、提交、刷新和读取结果；清理问卷、结果表和链接。

### Task 5: AI 成功生成、停止、引用和反馈

**Files:** `05-接口文档.md`、`10-缺口与待补清单.md`、`17-全量功能模块契约.md`、`00-交接-进度快照.md`

**Consumes:** `AiAdapter`、AI 管理接口族、租户 AI 额度/feature 状态。

**Produces:** `AiTaskTrace` 从 queued 到 success/stopped/timeout/failed/partial 的完整证据。

- [x] 先读取额度、feature key、availability、policy；若额度仍为 0，记录阻塞并完成失败状态，不伪造成功。
- [x] 在有额度时验证速览、问答、润色、选区改写、智能回复、会议摘要和流式 token。
- [x] 生成中停止、超时、网络断开、频控、空选区、超长选区、无权限文档和引用权限拒绝。
- [x] 验证引用、反馈、sourceRevisionId 校验和正文安全写回；清理生成结果。

### Task 6: 多格式导入异常、回滚与保真度

**Files:** `05-接口文档.md`、`10-缺口与待补清单.md`、`17-全量功能模块契约.md`、`00-交接-进度快照.md`

**Consumes:** `ImportJob/BatchImportJob`、既有 Word/Excel/PPTX/FreeMind/OPML 主链。

**Produces:** 每格式成功、失败、部分成功、重试、取消、回滚和资源保真度矩阵。

- [x] 补原生 `.xmind`、石墨入口和真实合法源文件。
- [x] 多文件混合上传制造单文件失败，验证每个 ticket/jobStatus/warnings/errors 独立回读。
- [x] 中断网络、取消任务、只重试失败文件、整体回滚；确认不留云盘/回收站对象。
- [x] 对标题、段落、表格、图片、附件、链接、幻灯片和大纲做保真度比对。

### Task 7: 跨表/图表引用、申请和回读

**Files:** `05-接口文档.md`、`10-缺口与待补清单.md`、`17-全量功能模块契约.md`、`00-交接-进度快照.md`

**Consumes:** `ReferenceRequest/ReferenceState`、两个账号、可访问的源 sheet/chart。

**Produces:** 创建、申请、批准、拒绝、刷新、断开、源对象变更和跨账号回读证据。

- [x] 创建真实源表和图表，插入引用并读取 token、objType、sourceRange、blockId。
- [x] 无权限账号申请，有权限账号批准/拒绝，双方刷新读取最终状态。
- [x] 修改/删除源表、改变源权限，验证 invalid/unavailable/readonly 降级。
- [x] 清理引用和源对象。

### Task 8: 企业安全策略拒绝、水印和审计

**Files:** `05-接口文档.md`、`10-缺口与待补清单.md`、`17-全量功能模块契约.md`、`00-交接-进度快照.md`

**Consumes:** `SecurityDecision/AuditRecord`、超级管理员策略页、个人/公司账号。

**Produces:** 允许、拒绝、审批、移动端限制、水印和正式审计查询矩阵。

- [x] 在受控测试范围切换外部分享、复制、创建副本、打印、下载、评论、引用和截图/录屏策略。
- [x] 以第二账号验证拒绝文案、申请、批准、拒绝和刷新回读。
- [x] 验证页面/下载水印和移动端复制/截屏/录屏限制。
- [x] 查询正式审计记录，区分业务 AuditRecord 与 reporter telemetry；全部策略恢复原值。

### Task 9: Jira Provider 原生 Issue CRUD

**Files:** `05-接口文档.md`、`10-缺口与待补清单.md`、`17-全量功能模块契约.md`、`00-交接-进度快照.md`

**Consumes:** Jira Master `https://jira.feishu.cn/web/connect`、已连接 Jira 站点 `https://jira.barenkeji.com`。

**Produces:** 项目/Issue/评论/状态流转 CRUD、权限拒绝、版本冲突和文档嵌入回读。

- [x] 在 Jira 侧选取可写测试项目，读取 Browse/Create/Edit/Comment/Transition 权限。
- [x] 搜索、创建、编辑、评论、删除、状态流转并回读 Issue 版本。
- [x] 制造无项目权限、过期授权、业务搜索失败、版本冲突和重试。
- [x] 在文档中插入 Issue，回读摘要/状态/评论；清理 Jira 测试对象和文档块。

### Task 10: OKR 周期初始化与目标/KR CRUD

**Files:** `05-接口文档.md`、`10-缺口与待补清单.md`、`17-全量功能模块契约.md`、`00-交接-进度快照.md`

**Consumes:** OKR 应用 `cli_9d89727ef932d10b`、原生页“周期未设置 / 立即开通”、OKR 管理员角色。

**Produces:** 周期、目标、关键结果、进展、权限和关闭状态的真实回读。

- [x] 在原生 OKR 页初始化测试周期，记录周期长度、首个生效周期、年度 OKR 和可见性字段。
- [x] 创建、编辑、删除目标和关键结果，执行 check-in、状态变更和关闭周期。
- [x] 以第二账号验证 owner/member/admin/data scope 权限。
- [x] 在文档嵌入 OKR 摘要，回读版本和权限降级；清理测试周期/目标。

### Task 11: Bitable Base/Table/View/Field/Record CRUD

**Files:** `05-接口文档.md`、`10-缺口与待补清单.md`、`17-全量功能模块契约.md`、`00-交接-进度快照.md`

**Consumes:** `BitableAdapter`、真实 Base owner/manage/edit/view 角色、应用 API scope。

**Produces:** Base、表、视图、字段、记录 CRUD、权限申请、回滚和文档回读。

- [x] 创建测试 Base、表、字段、视图和记录，验证类型、属性、必填、筛选、排序和版本。
- [x] 以第二账号分别验证 view/edit/manage 和字段/视图 ACL。
- [x] 更新、删除、恢复/回滚记录和字段，制造权限拒绝、版本冲突和部分字段失败。
- [x] 在文档中嵌入 Base/视图，读取快照和同步状态；清理 Base、记录和文档块。

### Task 12: 官方目录与宿主边界补全

**Files:** `05-接口文档.md`、`10-缺口与待补清单.md`、`17-全量功能模块契约.md`、`00-交接-进度快照.md`

**Produces:** 非核心 Provider 的 E2/E4 矩阵：演示、版本移动端、自动保存/断网、妙记、订阅号、AI 速览/辅助评论、移动横屏/离线/画板、ISV/子页面/时间轴、文档应用和通知。

- [x] 逐项确认入口、前置条件、请求、持久化和权限；没有真实对象时标记阻塞。
- [x] 对可写能力执行成功、拒绝、失败、重试和刷新回读；对浏览器扩展/租户外能力保留明确 skip 边界。
- [x] 把官方旁证与实机 E 等级分开，更新开发契约字段和后续最小探针。

### Task 13: 全量对账、证据索引和清理

**Files:** `requirements/00-交接-进度快照.md`、`requirements/05-接口文档.md`、`requirements/10-缺口与待补清单.md`、`requirements/17-全量功能模块契约.md`、`.superpowers/sdd/2026-10-26-feishu-remaining-gaps/progress.md`

**Consumes:** Tasks 1–12 的 Evidence、运行日志和清理报告。

**Produces:** 唯一状态矩阵、剩余阻塞列表、可交付开发契约和下一轮恢复入口。

- [x] 去重历史 ◐，只保留当前唯一未完整模块和最新等级。
- [x] 检查每项都有入口、字段、角色、权限、失败、回滚、清理和 Evidence ID。
- [x] 验证四份需求文档 Markdown 围栏、表格、路径、尾随空格和 Evidence 可定位。
- [x] 清理所有临时脚本、marker、测试对象、回收站对象和原始敏感抓包。
- [x] 只有所有任务达到目标等级或记录明确阻塞时，才更新交接快照为本轮完成。

## 等待执行命令

本计划现在只做计划，不执行任何任务。后续可发送以下命令之一：

- `继续补全需求 TASK-1`：执行评论和移动端评论。
- `继续补全需求 TASK-2`：执行双账号并发和 OT。
- `继续补全需求 TASK-3`：执行移动端协同。
- `继续补全需求 TASK-4`：执行问卷 Provider。
- `继续补全需求 TASK-5`：执行 AI。
- `继续补全需求 TASK-6`：执行导入异常。
- `继续补全需求 TASK-7`：执行跨表/图表引用。
- `继续补全需求 TASK-8`：执行安全策略。
- `继续补全需求 TASK-9`：执行 Jira。
- `继续补全需求 TASK-10`：执行 OKR。
- `继续补全需求 TASK-11`：执行 Bitable。
- `继续补全需求 TASK-12`：执行官方目录和宿主边界。
- `继续补全需求`：按顺序从 Task 1 执行到 Task 13，遇到权限阻塞时记录证据并继续下一个可执行任务。

## Latest execution note (2026-10-26)

Task 6 native chooser was exercised in the enterprise Chrome account with `valid.md` and empty `empty.docx`. Both uploads returned business success and were read back from Drive after refresh. Empty DOCX was accepted, so partial failure/retry/cancel/rollback remain unobserved. Both objects were soft-deleted and the refreshed Drive list had no markers. REA cleanup evidence: `ev_8b7d7bee7fe775ad3547624b7cd4ef9bdb926b3db98927bfc5079496235b6add`, `ev_14a10a99f77d426d727f79d368849df917efcc42eb50293b7662ebe2b3b6aae5`.

### Latest execution note (2026-10-26, Task 2 dual identity)

Safari personal identity was verified on the official Feishu page. Enterprise Chrome opened the same temporary wiki child page after the document was made open-link editable. Personal Safari wrote `TASK2-DUAL-SAMEBLOCK-20261026-7394`; Chrome read it back. Chrome appended `TASK2-DUAL-COMPANY-20261026-7394` to the same title block; Safari refresh read both markers and showed cloud save. This upgrades dual-identity same-block content roundtrip to partial E4. Real-time push stability, cursor color, and permission downgrade remain open. The temporary page was moved to recoverable trash and removed from pinned documents; the refreshed Drive list is marker-free.

### Latest execution note (2026-10-26, Task 6 malformed mixed import)

Chrome 企业账号通过原生文件选择器提交 `valid-mixed-20261026.md` 与损坏 `broken-mixed-20261026.docx`。上传面板显示“全部上传成功 / 2 个任务 / 61 B”，刷新云盘回读两个对象；损坏 DOCX 打开后 PDF.js viewer 显示原始 `PK BROKEN-DOCX-20261026`。这证明当前产品接受损坏输入为普通对象，未产生失败/重试/取消/回滚状态；两个对象已软删除并刷新清理，本地 `/tmp/feishu-import-20261026/` 已删除。Task 6 仍为部分 E4，需求契约保留逐 item failed、只重试失败项、取消和批次回滚。

### Latest execution note (2026-10-26, Task 1 mobile follow-up)

390×844 移动视口完成全文评论 marker 创建、表情与编辑探针。表情控制真实发出 `/space/api/reaction/add/`（`THUMBSUP`, `COMMENT_REACTION`）；编辑菜单提交后再次发出 `/space/api/comment/add/`，形成新评论而不是更新原评论；两次 add 均带 `notify=true`，但没有通知中心回读。Safari 个人账号打开企业文档显示“与我分享”且无“编辑”入口，作为只读权限负向。临时 marker 已通过移动端删除菜单清理；Task 1 仍为部分 E4。

### Latest execution note (2026-10-26, Task 3 mobile offline replay)

企业 Chrome 隔离 profile 创建临时 wiki 文档并在 390×844 视口下写入正文。CDP 离线后页面显示“离线”和“本文档已开启离线编辑功能，内容将在联网后自动同步至云端”；恢复网络后显示云端保存，刷新和桌面视口均回读离线 marker。移动端 `Meta+z` 撤销、`Meta+Shift+z` 重做均成功回读。临时文档删除并刷新云盘确认无测试标题。Task 3 的弱网/离线同步与撤销重做达到 E4 子能力；前后台恢复、他人光标和权限变化仍未验证。

### Latest execution note (2026-10-26, Task 4 non-empty export replay)

临时问卷 `TASK4-NONEMPTY-20261026-0645` 完成题目/选项编辑、发布和公开填写；同一链接连续提交两次均成功，结果分析回收量为 2。结果表“导出 → Excel/CSV 文件 → Excel”触发真实下载，文件名 `问卷.xlsx`、6,988 字节，内存回读为合法 XLSX。重复提交失败/回滚与第二身份 ACL 未观察到；临时问卷删除后列表刷新只保留基线项目。
### Latest execution note (2026-10-26, Task 7 Sheet source replay)

企业云盘“任务看板”打开为原生 Sheet，URL 提供 source token `shtcnvfI2l9ZYGVTPGNdUqylVQg`、table `tblYgduUiPpaxJfD`、view `vewT0KPIjL`。同源 meta 请求返回 HTTP 200 / business `code=0`，标题、所有者、`obj_type=sheet`、`version=664` 和 `delete_flag=0` 可回读。没有修改源表；引用对象、Chart token、ACL 申请/批准/拒绝和源表变更回读继续保持 `◐`。

### Latest execution note (2026-10-26, Task 5 external AI runtime)

用户提供的本地 OpenAI-compatible 服务在 Bearer 认证后返回模型列表；现有 Provider 通过 SSE `/chat/completions` 真实返回 `OK`，收到 1 个流式块。密钥只在进程环境中使用并立即释放，没有保存。外接模型流式成功已确认，飞书原生 AI quota=0 和停止/引用/反馈/正文写回仍保持阻塞或未验证。
### Latest execution note (2026-10-26, Task 2 directional live push)

临时 wiki 文档短时开放互联网编辑。Safari 个人账号写入 marker 后，Chrome 企业端不刷新即回读；Chrome 企业端反向写入后，Safari 需要刷新才能回读。测试结束恢复组织内只读链接、删除临时文档，并将 Safari 恢复到原始目标页。双向实时推送、光标颜色和权限降级仍未完成。
### Latest execution note (2026-10-26, Task 1 mobile notification parameter replay)

目标文档移动视口创建 `TASK1-NOTIFY-20261026-0745`，真实 `comment/add` 请求带 `is_whole=1`、`notify=true`；移动评论卡出现，删除并刷新后 marker 清理。文档页没有可读的通知中心入口，通知送达保持未验证。
### Latest execution note (2026-10-26, Survey/Import Provider contracts)

新增 `SurveyProvider` 和 `ImportProvider`：问卷覆盖项目/题目/发布/提交/结果/导出/权限；导入覆盖批量、逐文件状态、重试、取消、提交、回滚和错误规范化。新增 2 个单测文件共 6 项通过。外部产品真实资源不再阻塞 Provider 交付，真实导入解析器和复杂保真度仍属于宿主实现。
### Latest execution note (2026-10-26, Reference/Security normalization)

Reference Provider 新增 source 元数据和六态规范化；Security Provider 新增策略、审批决策、AuditRecord 字段规范化。新增定向测试 6 项通过。真实 ACL、拒绝、水印和审计套餐仍不伪造运行态。
### Latest execution note (2026-10-26, external Provider permission operations)

Bitable 增加 Base ACL/审批/版本，Jira 增加项目和 Issue 权限，OKR 增加周期和目标权限。定向测试 3 文件 / 6 项通过；外部站点运行态继续以 providerError/◐ 表示。
### Latest execution note (2026-10-26, ImportBatchController state machine)

新增本地导入批次控制器：失败文件单独重试、未完成任务取消、成功/部分提交、批次回滚和 marker 清空。导入状态机测试通过；解析器和复杂保真度继续由宿主实现。
### Latest execution note (2026-10-26, external AI citations/feedback/writeback)

外接 AI Provider 新增 citations、feedback 和 sourceRevisionId 安全写回；旧 revision 会被拒绝并保留预览。AI 定向测试 5 项通过。

### Latest execution note (2026-10-26, Task 6 legal XMind upload boundary)

企业 Chrome 原生文件选择器上传 `TASK6-MIXED-VALID-20261026.xmind`，业务面板显示“全部上传成功 / 1 个任务 / 433 B”，云盘列表和左侧文档库刷新回读对象；随后对象进入可恢复回收站，刷新后 marker 消失。本地临时目录已清理。该回放只确认普通 XMind 文件上传，不确认在线文档解析、复杂保真度、混合失败、重试、取消或回滚，因此 Task 6 继续保持部分 E4。

### Latest execution note (2026-10-26, official embedded Provider boundary)

新增 `src/providers/embedded.js` 与 `test/unit/embedded-provider.test.js`，提供妙记、订阅号、信息收集、演示和移动端能力的宿主请求型适配器，统一授权/同步/权限申请/健康检查和 fail-closed 状态规范化。定向 13 项测试与架构检查通过；Task 12 真实对象仍由宿主提供，未把静态页面或 iframe 加载算作业务成功。

### Latest execution note (2026-10-26, ProviderRegistry and official naming alignment)

官方嵌入 Provider 已补 ProviderRegistry `register/get/capabilities`，并对齐妙记、订阅号、信息收集和移动端既有接口命名；定向测试 6 个场景通过。真实第三方资源仍需宿主请求提供，未将适配器存在误判为运行态成功。

### Latest execution note (2026-10-26, document surface Provider coverage)

在同一 `embedded.js` 工厂中补齐文档信息、协作者、提及、应用、举报、ISV、AI 速览/评论辅助、文件视图、局部模板和词典适配器，并加入敏感表单/所有权/举报审计边界；定向 7 个场景通过。真实资源与租户权限仍由宿主返回。

### Latest execution note (2026-10-26, security policy readback)

企业文档“权限设置”真实回读外部分享、加密链接、协作者范围、复制/副本/打印/下载/评论、企业上级和引用申请字段；本轮只读不改策略。该结果提升策略读取证据，拒绝、水印、移动截图/录屏和正式审计继续保持未验证。

### Latest execution note (2026-10-26, dual-identity permission upgrade/restore)

企业测试文档短时切换为当前页面可编辑，Safari 个人端真实回读“权限变更为可编辑”；随后恢复链接访客只读，Safari 回到只读。由于 Chrome AX 输入索引错位，本轮没有写企业→个人 marker，故不提升反向实时推送等级；未开放子页面，权限已恢复。

### Latest execution note (2026-10-26, Task 2 reverse refresh readback)

隔离 `agent-browser` 企业会话通过 DOM locator 写入 `TASK2-REVERSE-20261026-1100`。Safari 个人页在不刷新时保持旧视图，刷新后回读 marker；企业端删除 marker 后，Safari 再刷新确认 marker 消失，文档权限保持只读。该结果证明跨身份保存/刷新回读和清理，反向无刷新实时推送仍未验证。

### Latest execution note (2026-10-26, Task 1 mobile comment negative replay)

在显式企业隔离 profile 的 390×844 视口中通过真实全文评论 UI 提交 `TASK1-MOBILE-RUNTIME-20261026-1230`。请求带 `is_whole=1`、`notify=true` 并返回 HTTP 200，但评论面板仍为 `评论（0）`；刷新及 `comment/commentid/all` 业务回读没有 marker。该回放确认 HTTP 200 不等于移动评论落库，已有 create/reply/resolve/delete E4 证据不受影响。
