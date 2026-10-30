# lark-doc 0.12 需求审计与收口规格

> 状态：T001–T008 已执行第一轮基础收口；T001–T003 已完成，T004–T008 仍需继续补齐完整事件、原子失败返回和 Provider 写入闭环。分支：`implementation/full-requirements`。基线：`dev`。
> 本文件是后续会话的唯一项目级需求摘要；细节以 `requirements/` 原文为准。
> Spec Kit 特性规格：`specs/001-full-requirements-implementation/spec.md`；技术计划：`specs/001-full-requirements-implementation/plan.md`；实施任务：`specs/001-full-requirements-implementation/tasks.md`；质量清单：`specs/001-full-requirements-implementation/checklists/requirements.md`。

## 1. 目标

在不影响用户当前 `next/0.12` 工作区的前提下，对 lark-doc 当前代码、测试、需求和实施方案建立可执行的缺口清单，并按优先级完成 0.12 的剩余闭环。项目保持以下架构方向：

- Vue 2.7 + Tiptap 3.32 为当前 UI/编辑器基线。
- `core/` 零 Vue、零框架耦合；适配层只做 props、事件、方法代理。
- 正文、表格、代码块保持 DOM；不自研渲染引擎、OT 或编辑器内核。
- 协同使用 Yjs/Hocuspocus；协同服务端属于独立 package，本仓库只保留客户端和契约。
- 嵌入内容统一走 `webEmbed` / `cardEmbed` + `EmbedDef`，不为每个第三方内容新增块类型。
- 以真实测试和门禁为完成依据，不以“有源码文件”冒充已完成。

## 2. 审计范围与证据

### 2.1 已盘点范围

| 范围 | 结果 |
| --- | --- |
| `requirements/` | 18 个 Markdown，约 26,188 行；00–17 覆盖模型、块、菜单、浮层、接口、Token、状态机、路线图、主题、Demo、闭环、a11y/i18n、全量模块契约 |
| `src/` | 当前 dev 基线已有 core、session、providers、collab、Vue2 UI、React/Vue3 适配层、Web Component、导入导出、版本、评论、嵌入、主题等实现 |
| `test/` | 约 80 个测试文件，包含单元、协同、Provider、适配器和门禁相关验证 |
| `package.json` | 版本 `0.12.1`；提供 `check:gate`、`check:unit`、`check:artifacts`、`verify`、适配器构建等命令 |
| Spec Kit | 已安装 `specify 1.2.6.dev0`；官方 CLI 已通过 `specify --version` 与 `specify check` 验证；项目资产已由 CLI 刷新并提交到 `.specify/`、`.codebuddy/commands/` 和 `specs/` |

### 2.2 现状证据

此前基线记录显示：浏览器验证 12/12、296 项断言、约 1,983 个单测通过，且 `check:gate`、`check:artifacts`、lint、size 曾达到全绿。本 worktree 必须重新执行可复现的基线命令，不直接复用历史结论。

## 3. 需求状态总览

| 状态 | 数量/口径 | 结论 |
| --- | --- | --- |
| 已完成 | 主体规格、核心编辑器、协同/评论/版本/分享/导出、主题基础、适配器、门禁与大部分块 | 可作为回归基线，不重复采集或重做 |
| 已规格化但需代码验收 | 流程层、A4 按钮块、异常矩阵、部分宿主/跨账号能力 | 进入 `tasks.md`，必须有源码、测试和命令 |
| 明确未完成 | 下表 11 个工作包，含若干关联子项 | 当前 0.12 的实际开发范围 |
| 明确不做 | 飞书不存在的顶部固定格式工具栏、自定义右键菜单、折叠块 slash 项、Sheet/Slides/Wiki 兄弟产品线等 | 不得重新开工；若需求变更，先更新本文件 |
| 历史过期 | `requirements/10` 与 `15` 中保留的旧采集记录、旧 skip 和已收口项 | 仅作证据，不得当作待办 |

### 3.1 已完成且不得重复派活

- DOM、类名、像素 Token、命令条/气泡条/块手柄/子菜单和 84 节点 slash 规格。
- 19 类主要块及行内节点的主体 CRUD、字段和显示状态规格。
- 表格进阶、图片/文件/视频壳、模板、投票、日程、网页卡片、目录 isv、同步块、提及、提醒等规格收口。
- 主题深浅色 Token、适配器入口、Provider 注册、评论、版本、协同基础、导入/问卷 Provider 的契约和已有单测。
- 撤销/重做的 V1 契约已在 `requirements/15 §3.1` 定稿：历史栈 100、`newGroupDelay` 约 800ms、本地 origin `local`、blockId 保持、accept/reject 不进栈。
- BlockAPI 规格已在 `requirements/05 §5.12` 定稿，代码已有 `src/core/blockApi/` 初始实现；它属于验收/补齐任务，不是重新设计任务。

### 3.2 当前真实缺口

1. **A4 按钮块**：`DuplicatePage`、`FollowPage` 真实动作和删除后刷新回读。
2. **流程层落地**：撤销/重做历史栈、块级剪贴板、多块多选和外部粘贴清洗；必须保持 blockId 语义。
3. **BlockAPI 完整契约落地**：insert/update/remove/move/duplicate/transform/get/children/batch 的边界、容器节点和统一测试。
4. **异常状态矩阵**：空、加载、失败、无权限、超限；统一降级卡和异步块状态。
5. **移动端 runtime**：评论/回复、通知、锚点、版本只读、横屏、离线和移动端同步。
6. **跨账号与浏览器验收**：第二账号权限降级、无权限提及/离职 chip、Safari 评论回读。
7. **Provider 写入闭环**：`survey`、真实导入任务，以及 AI、妙记、跨表引用、订阅号、局部模板等 provider 的宿主写入边界。
8. **回收站和版本外围 UI**：已存版本回收站入口、删除/恢复/刷新回读。
9. **输出与安全策略**：复制、打印、水印、审计日志、安全策略和敏感字段边界。
10. **性能与存储收口**：P0-10 基线、DerivedIndex、脏区更新、IndexedDB 分层和条件性性能优化。
11. **白板/画板与骨架级嵌入**：0.12 采用版本化延期；当前租户对画板/思维导图/流程图/UML 菜单两轮验证均为 8 秒无产出，保留 `webEmbed` 作为未来 host-owned/成熟库骨架边界，不在 core 自研 Canvas，不伪造未取得的白板 DOM/尺寸/交互规格。

## 4. 完成定义

一个任务只有同时满足以下条件才可标记完成：

- 源码实现位于任务列出的受影响文件，依赖方向和 0.12 硬规则不被破坏。
- 有对应单测/协同测/浏览器验证或明确的契约测试；不能只靠手工“看起来能用”。
- 增、查、改、删、显隐、字段/API、异常和权限路径均有明确结论；不适用项必须写明“不做”理由。
- 相关 `requirements/` 章节、`spec.md`、`tasks.md` 状态同步。
- 至少通过任务指定命令；阶段合并前通过 `npm run check:gate`、`npm run check:artifacts` 和必要的 `npm run verify:all`。
- 不修改原工作区 `/Users/cjjxw/codex/tiptap-integration-demos/apps/lark-doc` 的未提交内容。

## 5. 实施顺序

### P0：基线与共享契约

先验证当前 dev 基线，确认 `BlockAPI`、历史栈、存储、Provider 和适配器现状；随后冻结任务 1–4 的公共类型、事件和测试夹具。

### P1：编辑器流程地基

优先完成历史栈、块剪贴板/多选和 BlockAPI。容器块（引用、标题）及后续块类型必须调用统一 API，不允许各块重复实现插入、删除和移动。

### P2：异常与跨端

建立统一异步状态矩阵和权限投影，再处理移动端 runtime、第二账号、Safari 和离线同步；所有不具备真实环境的项目采用可注入 provider/浏览器矩阵测试，并保留未实测边界。

### P3：Provider、输出与安全

补齐 survey/import 和宿主 provider 写入；接着实现回收站、复制/打印/水印/审计策略。第三方内容继续通过事件冒泡，编辑器不持有第三方 token。

### P4：性能与最终收口

执行性能基线，按实测决定是否实施 DerivedIndex、脏区更新、IndexedDB 分层和条件性虚拟化；T046 已完成可复现性能采集与门禁基线，当前未因滚动性能盲目引入窗口化；最后跑全门禁、适配器产物、浏览器验证并更新审计结论。

## 6. 新会话输入协议

以后每个实施会话只提供：

1. 当前根目录 `spec.md`；
2. 当前根目录 `tasks.md`；
3. 当前任务条目列出的受影响文件；
4. 若任务涉及既有契约，再附对应的 `requirements/<编号>-*.md` 小节，而不是整库需求。

会话开始先读取任务状态和受影响文件，完成后只更新相关任务、规格状态和工作日志。不要把整个 `requirements/`、历史聊天或无关源码重新注入。

## 7. 关键约束

- 本开发分支按 Spec Kit 执行明确任务；基础契约和 US1/US2 已开始实现，US3 已完成统一异步块五态、跨块 DOM/NodeView 状态投影、schema 快照同步、统一 capability policy，以及评论/版本/导出/分享/块菜单权限闸门接线；security Provider 已将业务 deny/approval_required/updatePolicy 拒绝转换为稳定异常并保留 requestId、permissionVersion、reason；US4 T031 已补齐 viewport 宽高/横竖屏 runtime 生命周期与窄屏/横屏根节点投影，T033 已补齐 Provider 幂等恢复队列与协同离线回归，真实 Safari/移动端运行器缺失导致 T032 仍 BLOCKED，后续任务继续以源码、测试和验收命令为准。
- `spec.md`/`tasks.md` 是根目录交接文件；`specs/` 保留 Spec Kit feature 目录，暂不复制两份内容造成漂移。
- `.specify/`、`.codebuddy/commands/` 使用官方 Spec Kit CLI 1.2.6.dev0 刷新的官方资产；当前 CLI 已安装到用户级环境，但 CodeBuddy 本体未被 `specify check` 检测到，因此项目初始化使用 `--ignore-agent-tools` 完成。
- 需求数字以最新章节为准：A 级规格审计 20 ✅ / 1 ◐ / 0 ⏳；B 级 27/27 收口；E 级可执行缺口 0。以上是“规格收口”统计，不等于代码完成率。
- 所有旧的“顶部工具栏”“自定义右键菜单”“折叠块 slash”待办必须视为已作废。
- T050 门禁收口证据（2026-10-30）：全量单测报告 93 个文件 / 2056 项断言通过，但同时有 8 个 forks worker 启动超时错误，不能视为无条件全绿；`check:gate` 首个代码失败为 `viewModesMixin.js` 重复 `beforeDestroy`，已删除重复生命周期并通过该文件 lint，随后仅保留 `VersionPanel.vue` 16 个格式 warning；`verify:all` 12 个目标均失败，主要是 `page.goto` 60 秒导航超时及单目标 240 秒超时；`check:artifacts` 首个失败点为 Thread Loader broker timeout。以上浏览器/构建并发问题记录为环境 BLOCKED，不伪报为代码通过。T032 真实 Safari/移动端运行器继续 BLOCKED。
