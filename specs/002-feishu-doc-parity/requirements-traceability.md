# 文档 parity 需求追踪矩阵

## 基线、范围与 Spec-kit 对账规则

- 对账日期：2026-11-06；工作区：`/Users/cjjxw/codex/.wt-larkdoc/dev`；源码基线：`b66eaf5`。先行 git status/log 确认起始工作区干净。
- 本矩阵补充既有 Spec-kit 链路：`spec.md` 的 FR/US2 验收 → `tasks.md` 的 T014/T015/T017/T018 → 当前源码 → 测试范围 → 缺口 → 待验收条件。没有另起需求编号或变更原规格，也不宣称本轮重新安装/运行 Spec-kit。
- 本轮仅静态阅读源码、测试和文档；**未运行构建、测试、浏览器或真实服务验证，未提交、未推送**。表内“测试范围”描述读取到的断言/脚本范围，不表示本轮通过。
- 聚焦本次授权的评论、mention、版本与协同声明边界，不是全量 FR-001～FR-025 的完成度审计。FR-014/023/024/025 仅记录与本次范围有关的约束，不改动 T016 或其他未审计任务的完成状态。
- 当前 UI 使用 `src/editor/nativeEditorHost.js`、`src/ui/panels.js`、`src/components/lark-doc/editor/panelsUiMixin.js` 与实际加载的状态 mixin；历史 `.vue` 路径只用于追溯。
- `PARTIAL` 对应 evidence contract 的 `partial`，表示已有部分实现或边界，但需求未闭环。官方来源、历史飞书观察及原测试数字保留在 `research.md` / `contracts/parity-evidence.md`，不移记为当前本仓验收。

## 需求 → 实现 → 测试 → 缺口 → 验收

下列同一 FR 的多行是验收维度拆分，不是新增正式 FR；“验收”列全部为后续关闭条件，不是本轮执行计划。

| 需求 ID / 验收维度 / 任务 | 当前实现证据 | 测试范围（静态读取，本轮未运行） | 缺口与当前状态 | 关闭所需验收 |
| --- | --- | --- | --- | --- |
| FR-012；US2-2；正文 @ user/group/document；T014 | `src/components/lark-doc/editor/mentionMixin.js:134` 写入 atom 与 notify 属性，插入前检查 writable/canEdit；`src/core/mention/directory.js` 搜索/解析；`src/core/blocks/mention.js` 序列化。 | `test/unit/mention.test.js`：节点、JSON/HTML 往返、候选排序/过滤、失败/超时、notify 与 canEdit。 | **PARTIAL**：已有候选/插入/属性，不证明目标权限授予或通知执行。 | 用实际宿主分别完成三类引用的选择、保存、刷新回读；记录成功、无访问权限、停用目标、Provider 拒绝等结果及 UI 反馈。 |
| FR-012；US2-2；评论输入 @、授权与发送；T014/T018 | `mentionMixin.js:143` 只写布尔 notify；`src/providers/embedded.js` 声明另一套 mention list/notify/notifyAll/healthCheck 适配边界；当前回复 textarea 经纯文本提交。 | mention 测试验证属性与候选，不是授权/发送测试；Provider 方法存在不能证明调用链。 | **PARTIAL**：正文 chooseMention 无授权/发送调用，评论输入 @ 未闭环；canEdit 不等于目标获权。 | 正文与评论入口分别验证通知开/关、目标授权或拒绝、不越权、发送回执及失败反馈；真实受限账号读取获权结果与通知中心，分开记录账号身份。 |
| FR-013；US2-3/4/5；锚点评论、回复、解决/重开、删除；T015 | `commentsMixin.js:271`、`:293`、`:304`、`:313` 派发基础动作；`:322` 调可选 deleteReply，校验回执/回读/异步上下文。必需合同为 list/createThread/reply/resolve/reopen。 | `comments-core.test.js` / `comments-ui.test.js`：模型/锚点、capability、草稿、菜单/几何及删除拒绝、回读失败、上下文隔离。 | **PARTIAL**：基本路径存在；内存 Provider 不证明刷新持久化，当前面板过滤已解决线程，不能推定全部重开入口可达。 | 在实际原生 UI 完成创建/回复/解决/重开/删除，并刷新核对正文 mark 与线程；验证服务端拒绝及文档、账号、权限切换隔离。 |
| FR-013；US2-4；编辑/翻译/举报、reaction/quote；T015 | `commentsMixin.js:500` 的 runCommentMenuItem 只有 delete 有业务动作；`:495` 的 runCommentReplyControl 只有 more 有行为。 | comments-ui 的菜单可见性/几何不证明业务执行；旧 61/61～88 项断言和 23/23 只作历史记录。 | **PARTIAL**：编辑/翻译/举报和 emoji/quote 当前为空操作。举报/reaction/quote 是历史声明核对项，不由本矩阵擅自扩张正式 FR。 | 对正式需求中的编辑/翻译建立可观察写入/回读及权限、失败保留与重试验收；历史声称的其他动作需给出明确业务合同与对应验证，未完成不能继续宣称完成。 |
| FR-013；US2-4/5；private 可见性；T015 | `commentsMixin.js:467` 只切换本地 commentPrivateIds，未调用 Provider。 | 本地开关状态或菜单断言不能证明服务端隔离；loadComments 仅向 list 传 documentId。 | **PARTIAL**：无 private 持久化、访问者过滤及跨账号不可见证明；不能当作权限功能完成。 | 明确可见性合同，由真实服务执行授权；刷新后开关/线程状态一致，有权与无权账号分别回读，验证泄露防护与拒绝反馈。 |
| FR-013；US2-3；全文评论；T015 | `src/core/comments/thread.js:155` 写入要求有效 blockId，归一化结果无 document scope；`commentsMixin.js:561` 仅呈现 bound 且未解决线程；`panelsUiMixin.js:422` 无 footer composer。 | 当前 core/UI 断言不证明无选区全文创建；历史 document-scope correction/79/79 不是当前实现证据。 | **PARTIAL**：缺少全文模型、原生 footer composer 与持久化闭环；失联锚点不等于全文线程。 | 不选择正文，在文档 footer 创建全文线程，不伪造 blockId/mark；回复、刷新、无锚点保留、权限限制及受限账号回读全部留证。 |
| FR-013；US2-4；follow 与评论链接；T015 | `commentsMixin.js:537` 复制 quote 文本，不生成或解析稳定评论 URL；历史飞书 follow/link 操作仅为产品观察。 | 菜单/复制文字和本地 Provider 测试不验证稳定链接重开或关注持久化。 | **PARTIAL**：follow 持久化/取消与通知结果、稳定链接/访问控制/定位闭环未建立。 | 同文档与刷新后打开稳定 thread/comment 链接并准确定位；有权/无权账号分别验证，关注/取消后刷新回读并检查后续通知效果。 |
| FR-015；US2-6；历史列表、正文预览与 diff；T017 | `core/versioning/provider.js:93` list 返回元信息，`:147` get 可含二进制；`versioningMixin.js:555` 只保留元信息/hasPayload/byteLength；`panelsUiMixin.js:380` 展示占位和块数摘要。 | `versioning-core.test.js`：数据层；`versioning-ui.test.js`：元信息、错误/权限、hasPayload/byteLength；`scripts/verify-browser-panels.js`：面板占位与几何。 | **PARTIAL**：数据层有正文但 UI 未解码/渲染；历史字数/标题未提供，块数摘要不是正文 diff，“显示更改”无行为。 | 解码真实可用快照，在只读预览中显示历史正文及可核对差异；选择版本不得改当前正文；加载/无权限/损坏快照给出稳定反馈。 |
| FR-015；US2-6；保存/恢复正文；T017 | `versioningMixin.js:712` 调 createVersion({ label })；`DocumentSession.js:159` 派发 document record，未编码 payload；`:167` 仅传 documentId 调 restore。内存 `core/versioning/provider.js:152` 新增恢复记录，不应用编辑器正文。 | `versioning-ui.test.js:110` fakeSession 补二进制/作者/kind/时间；恢复断言为列表增长、RESTORE kind、notice/busy，不是正文变化；夹具字节不保证合法 Yjs update。 | **PARTIAL**：缺真实保存编码及上下文、历史 payload 应用、持久化/刷新闭环；恢复 author 依赖宿主 options.author。 | 真实 Session + Provider 保存正文 A，编辑成 B，再预览/恢复 A；编辑器与持久层、刷新后正文均为 A，原版本可恢复、作者正确；验证并发、撤权、写失败不会误报成功或损坏正文。 |
| FR-012/013；US2-2/4；通知边界；T014/T015/T018 | `src/providers/notifications.js` 要求 list/markAllRead/setMuted，subscribe 可选；`notifyMixin.js:156` 订阅触发 list 回读，另有写回执、写后回读、上下文隔离与释放。 | `notifications-provider.test.js`：合同/Session/this/上下文；`notifications-ui.test.js`：列表、订阅/释放、失败、回执/回读与异步隔离。 | **PARTIAL**：不是完全未实现，但只支持合同/本地 UI 层；注册或订阅不证明 mention/评论发送及真实送达。 | 真实两账号触发 mention/评论通知，接收方通知中心读取并刷新；验证已读/静音持久化、订阅释放、重复/延迟事件、拒绝和撤权隔离。 |
| FR-014；US2-5；相关受限参与者；T014/T015/T017/T018（不重新审计整个 T016） | commentCan、mention canEdit、versionCapabilityGate、Session create/restore capability 已有客户端边界。 | capability-projection、mention/comments/versioning/notifications 的本地权限分支；夹具不等于服务端鉴权。 | **PARTIAL（本次相关切片）**：客户端可用性控制不能证明真实授权、private 隔离或版本/通知服务端拒写。 | 按受限读者/评论者/编辑者身份执行相应入口，服务端拒绝越权；权限处理中撤销、回读、账号切换不显示/写入受限数据。 |
| FR-023/024；当前验收与证据；T018（关联 T012） | 既有历史 Chromium、实际 Safari、触摸模拟、飞书与账号证据分层保留；当前 scripts/verify.mjs 动态发现浏览器脚本。 | 旧 scripts/verify-browser-feishu-parity.js 当前不存在；本轮无新通过数。11 月 6 日旧全量/窄屏通过不覆盖上述未实现行为。 | **PARTIAL**：当前原生 UI 需求闭环、实际 Safari、真实跨账号刷新与送达仍待验证；不将自动化驱动 ready 当作通过。 | 先关闭实现缺口，再用匹配源码/产物记录 Chromium、实际 Safari、窄屏/明确标注的触摸模拟；保留真实账号身份、刷新结果、失败及未执行项，逐项关联官方/历史产品观察。 |
| FR-024/025；协同声明与合同边界（关联 US2，不新增正式 FR） | `docs/guide/collab-server.md:3` 声明独立包/仓库/发布；本仓客户端、架构隔离规则与第三方 @hocuspocus/server 内存测试有源码证据。 | 静态查阅指南、package.json、scripts/check-architecture.js、test/collab/hocuspocus-wire.test.js 与 git remote；本轮未运行这些检查。 | **外部状态未核验**：未取得 @lark-doc/collab-server 仓库地址、发布版本/记录或部署验收。不能推断已完成或不存在，也不能借 FR-025 将原生评论/mention/正文恢复降为合同即完成。 | 如需确认独立服务端交付，由宿主提供可核验仓库/包版本/部署与鉴权、持久化、恢复证据；未提供前仅确认合同边界。指南本轮保持不变。 |

## 当前任务状态与历史证据索引

- T014、T015、T017、T018：**PARTIAL**。当前完成度同时受实现缺口与验收缺口约束，不能只补浏览器总通过数后关闭。
- `tasks.md`：当前状态与对应历史完成记录并列保留；其他任务不因本次窄范围审计被自动重判。
- `contracts/parity-evidence.md`：当前 partial 对账表优先于历史执行表同名声明，保留 contract/local-browser/live-parity 区分。
- `research.md`：“当前源码复核”列出静态证据；后续旧记录、真实飞书观察、70/70～88 项断言、23/23 及 11 月 6 日结果均原样保留，仅作历史证据。
- 后续更新须在同一 FR/任务行补实现、精确验证范围及残余缺口；只在验收条件有对应证据时变更状态，不用 Provider 方法存在、菜单外观、成功 toast 或真实飞书操作代替本仓闭环。
