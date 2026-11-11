# Backend API Contract: 独立完整编辑器后端C01–C15

> **当前入口（2026-11-08）**：本地editor-crdt-v1协议见§9，独立API/collab/Worker、HTTPS/mTLS owner命令及020角色演进见§10；最终制品和真实Chrome/Safari边界见§10.5。§8与§9各批证据保留其当时范围，不以中间来源代最终当前树。C01–C15全部AC和真实外部/生产验收仍未完成，不能因原T项未勾说接口从未运行，也不能因本地闭环称整批通过。

**起始日期**：2026-11-06。早期拟议与PoC记录不作为现行禁实现规则；现有HTTP/WS/真实PG及分进程能力按后续各节执行范围核对，均非生产承诺。

详细方法/字段/示例以[系统设计](../../../.workbuddy/output/系统设计.md)§3、[故事](../../../.workbuddy/output/UserStory.md)§5/7为同编号规范来源；本文件同步其前缀与关键边界，不另生不兼容端点。旧`/v1/tenants/...`、旧错误E_前缀/5故事和T043/T044均历史失效。技术边界为统一TS/Node API/collab/Worker、自部署、Java业务独立；当前本地BOM、路径及角色见§10，生产部署与支持批准另列。

> **Java 业务接管入口（2026-11-10）**：沿用本契约5条入站集成路由和2条Java回执接口；后端 `ops/java-integration.md` / `ops/java-integration.openapi.json` 提供角色边界、请求/响应与原键恢复。035新增owner-only tenant/source权限上限及绑定细权限投影；缺政策保持旧read/write，当前取政策交集，保原grants七列/OID/ACL和独立direct/share。`grant.manage`为显式完整授权委托。Node22编译、86受影响与15真实mTLS/PG场景、27响应schema校验通过；本机无JDK，不冒JVM/真实Java或生产验收。

## 1. API-BASE与身份/幂等

公共前缀`P=/editor/v1/tenants/{tenantId}`；文档`D=P/documents/{docId}`；集成`I=/editor/integration/v1/tenants/{tenantId}`。当前本地实现映射见§9–§10，不构成生产域名/端口承诺。

浏览器受控Secure/HttpOnly/SameSite会话，CSRF/Origin精确校验，跨站策略另审。Java/Worker/owner内部TLS服务信任及可验证用户委托分离，验证issuer/audience/subject/tenant/doc/scopes/expiry/tokenType；服务身份无用户/private阅读豁免，actor不信body。

`Idempotency-Key`等于operationId，DB作用域(tenant,clientPrincipal,commandType,operationId)。服务端规范JSON语义SHA-256含目标/对应expectedRevision/协议，不含trace/凭证/临时时间。同键同hash原结果，异hash409；原结果查询当前复权。二进制updateId作用域tenant/doc，hash针对实际bytes，重编码不能沿旧ID。seq/revision/epoch/token十进制字符串。各聚合CAS分contentRevision/threadRevision/bindingRevision，普通同epoch CRDT写**不要求expectedRevision等于最新值**。

| HTTP/code | 语义 |
|---|---|
| 200/201 | 已提交声明的命令，仅显式匹配receipt证明正文durable |
| 202 OPERATION_PENDING | 受理/协调中，保留pending查询 |
| 400 INVALID_REQUEST | 无效参数/hash/协议，不自动重试 |
| 401 AUTHENTICATION_REQUIRED | 重新认证，保留待确认内容 |
| 403 WRITE_FORBIDDEN | 已可读但不可该操作 |
| 404 RESOURCE_NOT_FOUND | 不存在或不可获知，private统一不可见无计数泄漏 |
| 409 REVISION_CONFLICT / IDEMPOTENCY_MISMATCH / EPOCH_MISMATCH | CAS/同键异参/旧代际，显式对账不自动换epoch |
| 410 CURSOR_EXPIRED | 取当前授权快照，禁全局历史回放 |
| 413/429 | 超限，按批准有限退避预算处理 |
| 503 DEPENDENCY_BLOCKED / WRITER_UNAVAILABLE / COMMIT_UNKNOWN | 依赖/owner/提交不确定，禁止已保存/恢复成功 |

统一错误`{code,message,traceId,retryable,operationId?}`；失败不包装200。超时/503沿同键同体先查结果，有限次数/总deadline在B门批准，缺配置启动失败。敏感`Cache-Control: no-store`，限额/富文本防注入、CSRF和审计脱敏，具体数值待批。

## 2. C01–C15故事与路径

| 契约/故事 | 主要拟议操作 | 成功/失败关键约束 |
|---|---|---|
| C01/US1 | POST/GET `I/resource-bindings`；POST `I/resource-bindings/{bindingId}/unbind-operations`及`deletion-intents` | create/bind按sourceSystem/externalResourceId三元唯一，CAS/sourceRevision/operation；只撤来源，共享引用/保留未核清待处置不物理删 |
| C02/US2 | POST `P/sessions`、POST `D/collaboration-tickets`、POST `D/grant-operations`、GET `P/operations/{operationId}` | 实际scope不等请求scope，ticket非持久grant，服务/用户分离，当前复权及全局注销 |
| C03/US3 | 扩展WS握手/UpdateEnvelope/CommittedUpdate；POST `D/seed`；GET `D/receipts/{updateId}` | 唯一seed、commit后原活动对象应用/广播、精确receipt；未知结果查，不把404当此前未知事务绝不会commit |
| C04/US4 | `D/comment-threads`及线程replies/state/participants生命周期命令 | scope/document空anchor、selection相对anchor；本人编辑删除/能力裁决/private统一谓词；threadRevision CAS与操作/outbox同事务 |
| C05/US5 | 线程follow偏好与link-target | 不授private，稳定链接每次复权；无权统一不可见，orphaned不误定位 |
| C06/US6 | 线程回复translations及任务结果查询 | 源reply/revision/语言/身份任务隔离；内部依赖未交503 DEPENDENCY_BLOCKED/blocked，阻整批MVP，外送/取回均当前准入 |
| C07/US7 | `D/versions`列表/创建/版本预览 | expectedRevision冻结已提交水位，versionId/contentHash/sourceRevision，stateHash分开，污染内存禁版本 |
| C08/US8 | `D/restore-operations`创建/原操作查询；扩展WS epoch屏障 | operationId/hash/actor/expectedRevision/expectedEpoch，pre/post/epoch/receipt原子；A/B算法PoC前BLOCKED，不默认JSON重建 |
| C09/US9 | `D/notifications`、read/mute偏好、`D/events` SSE | 每用户提交序，快照/订阅无漏，受限Last-Event-ID、410，private创建/投递/重放复权 |
| C10/US10 | `I/events`及集成operation/状态/受限回放对账 | 版本化eventId/aggregateRevision/eventIndex、Inbox/hash/效果同本地事务，跨域未知不假原子；审批不可变 |
| C11/US11 | 当前权限mention目标、分享授权申请/查询 | 不跨租户枚举，不自动grant/private；独立来源授权保留；未接通明确保留前端 |
| C12/US12 | 真版本diff、受控导入导出任务/结果 | 固定来源/hash/格式；导入唯一正文端口，导出受权取件，真实内容而非块数占位 |
| C13/US13 | `D/assets`开始/complete、当前授权代理content/块读取 | 实际size/mime/checksum才ready，部分失败待对账，共享引用/无策略禁止清理；旧签名URL不绕撤权 |
| C14/US14 | healthz/readyz、内部受限诊断/恢复/对账端口 | liveness不等writer资格；无token/重放不ready，无private运维旁路，生产故障/恢复/发布有证据 |
| C15/US15 | 无新增公共业务API；原体验与证据契约 | 当前七入口/Vditor93/体积门、原性能7/7、原生Safari6及Chrome选定范围见§10.5；完整矩阵仍BLOCKED，E0–E4与硬件触控分证，历史2703不算新验收 |

端点尾段/请求Schema不能由实现者凭摘要猜定：T005按系统设计逐条审阅、T013随PoC冻结消息号/Schema并同步此表。未冻结部分是实施阻塞，不是允许创造不同API；任务路径只是拟议文件，不证明服务存在。

## 3. WS-DURABLE拟议扩展

`HELLO(protocolVersion,tenantId,docId,epoch,lastReceiptSeq,pendingIds)`→鉴权/epoch/token→`READY`先于任何标准SyncStep1/SyncStep2/update；未知协议/旧epoch/raw无包络写帧拒绝。读取/awareness亦当前权限。全部direct/seed/restore/插件/Worker/跨实例入口统一命令，无覆盖入口禁用。

- UpdateEnvelope `{protocolVersion:'editor-crdt-v1',tenantId,docId,updateId,epoch,payloadHash,payloadBase64}`。
- DurableReceipt `{protocolVersion,tenantId,docId,updateId,payloadHash,epoch,seq,contentRevision,committedAt,status:'durable'}`。
- CommittedUpdate带相同updateId/hash/epoch/seq/revision；不能用收到别人的广播/最大seq/state vector清自己全部pending。

首发目标：隔离候选gc:false保历史身份→事务提交update/receipt/seq/revision/操作/outbox→已提交delta应用**原活动Y.Doc**→当前受众有限准入后广播/receipt。候选不是替换活动对象，default hooks/onChange/SyncStatus不是屏障。4.7.1默认广播控制适配必须T008证明，否则F3/F8 BLOCKED；provisional不是自动备选，改变须新审查。

失败丢候选；commit未知/成功但活动应用/广播失败quarantine/query，停止新写/版本捕获，从可靠事实重放；被默认hook污染的房间不得把暂态防抖持久化或生成审批版本。receipt仅清updateId＋hash＋epoch匹配pending，旧epoch已提交receipt可查但不放行未提交旧pending。

## 4. PRIVATE-READ与撤权准入

统一谓词（2026-11-10 用户确认按飞书）：`document.read && (visibility=document || creator || explicitPrivateParticipant || currentDocumentOwner || currentDocumentManager)`；所有者与管理者均须限定当前 tenant/doc、当前有效身份和阅读权限；管理者另须当前业务授权来源的 grant.manage 证明，技术服务 manager registry 单独不授予私密可见性。service/follow/mention/share/link不构成独立豁免。角色可见不自动授予编辑他人评论、管理参与者或通知订阅。覆盖list/detail/count/search/link/preview/export/translation/follow/history/asset/notification/事件/运营，quote也敏感，禁公共Y.Doc及共享snapshot保存private正文。

所有写/revoke共享documents FOR UPDATE，主体注销/禁用共享principal/session协调锁；锁序principal/session→documents→thread/lease→operation，READ COMMITTED锁后重读并持到commit。有限敏感结果/逐受众帧/SSE/外投/翻译/对象块FOR SHARE短事务检查，commit为发送准入点；撤权后新准入拒绝，先前在途无法追回，下一块/重试重新准入，5秒仅连接收敛待测目标。来源gap冻结受影响敏感操作或权威同步复核，不声称跨系统全球即时。

## 5. WS-RESTORE与lease分层

恢复A显式历史保留delta候选，B暂停排空/保留历史候选都待T009/T010证明；B若改变在线/原活动对象要求另批，不以旧update合并/JSON新建/只读拒绝当成功。普通写/seed/恢复同队列，expectedRevision/epoch、pre/post及结果原子，旧pending在任何sync前阻断、隔离导出，不自动换epoch或merge新state。

lease获取锁后`lease_until > clock_timestamp()`、事务末复核，token单调/有限deadline；不能用now()/锁前时间，不能声称墙钟到期自动终止已持锁事务。lease/token提交序决定排他，新owner获资格及可靠重放后ready。房间token不代数据库唯一主/旧主fence、同步确认、PITR外部恢复generation；故障域/复制未知不声称HA/RPO。

## 6. SSE-REPLAY、事件与外部结果

业务/operation/audit/outbox同事务，NOTIFY仅唤醒；Worker任务token CAS、有限重试/隔离，至少一次加业务幂等非exactly-once。Inbox与副作用同本地事务，eventId相同异hash冲突，aggregateRevision/eventIndex及受众可见序列处理乱序；private隐藏gap不强求补齐。

每用户协调行commit序、授权通知快照及游标衔接，无漏提交；`Last-Event-ID`绑定tenant/principal/过滤范围，410重取当前授权快照，不全量无权回放。发送/重放再次private复权/有限准入；静音已读持久，站内可见不等外部送达。

## 7. 验证映射

P01–P19、15FR/8NFR/5SC映射见[plan矩阵](../plan.md#当前交付追溯矩阵t124)，126任务/105AC状态见[tasks](../tasks.md)及requirements。T005/T013本地契约与审阅不代生产身份/部署批准；各故事仍以契约、负例/竞争和真实集成证据区分判定。人员由用户统筹，外部门不阻已授权无依赖本地开发；未知生产域名/容量/内网源/许可和值守仍不得假填。

**T013补注（2026-11-07）**：§2末段要求「T013随PoC冻结消息号/Schema并同步此表」；本轮T013**未冻结**，理由见§8.1。§1–§6拟议契约表与§2故事路径保持原样，未据PoC改写。

## 8. T013证据复审：协议候选、错误语义与冻结门裁决（2026-11-07追加）

本节按[tasks](../tasks.md)T013（依赖T012）记录T008–T012的历史证据，**只记录该批次、不作当前整体验收**。当时全部为`[实测通过·隔离本地 PoC]`或`[静态分析]`：帧、包络、receipt、错误码都是进程内对象/枚举/字符串，没有真实HTTP响应、WebSocket字节流、provider/server进程、数据库事务或浏览器。当前后续实现/授权见§9–§10。

### 8.1 冻结门裁决：wire消息号与Schema本轮不冻结

§2末段与§7把T013列为「消息号/Schema冻结门」。**本轮结论：不冻结，保持未决**。依据：

| 依据 | 事实 |
|---|---|
| PoC对象性质 | HELLO/READY/UpdateEnvelope/DurableReceipt/`pending-export-v1`均为进程内对象，无wire编码、无消息号分配、无Schema版本协商实测 |
| 未做兼容验证 | 未启动真实`@hocuspocus/provider@4.7.1`/server；`[静态分析]`只证明provider `onOpen()→startSync()`立即发SyncStep1、`synced`只在回包后置位，以及y-protocols Step2/Update直接`Y.applyUpdate` |
| 自定义帧不兼容 | T008二阶段「精确receipt」是PoC自定义扩展（`SyncStatus` + varUint + varString commit id），**明确不与官方provider兼容** |
| 未获批准 | 导出格式、人工处理流程、错误码枚举与端点尾段未获产品/安全批准 |
| T013明文 | 「无通过不进入正式依赖实现」；五个PoC均为隔离本地证据，无一项达到正式契约冻结条件 |

因此消息号、wire编码、Schema版本、端点尾段仍属实施阻塞（§2末段原判不变），不是允许实现者创造不同API；§1–§6与§2故事路径表不改动。待T005逐条审阅、真实provider兼容验证与批准后另批冻结。

### 8.2 PoC级协议候选字段（候选，非冻结、非wire）

| 候选对象 | PoC中出现的字段/约束 | 来源任务 |
|---|---|---|
| HELLO | `protocolVersion`/`tenantId`/`docId`/`epoch`/`lastReceiptSeq`/`pendingIds`严格校验；未知协议、超前epoch、畸形字段、跨tenant-doc一律fail closed | T010 |
| READY | 会话第一条出站帧，早于任何标准SyncStep1/SyncStep2/update/awareness/stateless | T010 |
| 入口策略 | 15类帧：`HELLO`=handshake-only、`raw.write`=always-disabled、其余13类=handshake-gated；`restore`必须走prepare/commit统一队列，不得作为普通写帧绕过 | T010 |
| UpdateEnvelope | `protocolVersion:'editor-crdt-v1'`/`tenantId`/`docId`/`updateId`/`epoch`/`payloadHash`/`payloadBase64` | §3原拟议；T010以内存对象模拟 |
| DurableReceipt | `protocolVersion`/`tenantId`/`docId`/`updateId`/`payloadHash`/`epoch`/`seq`/`contentRevision`/`committedAt`/`status:'durable'` | §3原拟议；T008二阶段自定义帧实现 |
| 精确receipt条件 | 只清`updateId + payloadHash + epoch + protocolVersion`四项全匹配的对应pending；旧epoch receipt、异hash/异epoch/异protocol、他人广播、最大seq、state vector均不能清 | T008/T010 |
| `pending-export-v1` | `fromEpoch`/`currentEpoch`/`restoreOperationRef`；items含`updateId`/`hash`/`epoch`/`protocol`/`payloadBase64`；`contentHash`/`stateHash`/`digest`；`readOnly=true`、`grantsWritePermission=false`、`autoMerged=false`、`requiresManualAction=true`；导出不改live、不清pending、不恢复写资格、digest稳定 | T010 |
| 六类禁止策略 | `auto-advance-epoch`、`rebase-pending-to-new-epoch`、`merge-new-state-into-old-local-doc`、`drop-pending-silently`、`old-update-merge-as-restore`、`sanitize-by-server-state`全部fail closed | T010 |

### 8.3 错误/状态语义在PoC中的映射（内存枚举，非HTTP实测）

| §1拟议码/语义 | PoC中的对应状态 | 任务 |
|---|---|---|
| 409 `EPOCH_MISMATCH` | `EPOCH_MISMATCH` + 当前新代际 + 恢复引用 + `stopAutoUpload` + `pendingExportAvailable`；会话epoch不自动改写 | T010 |
| 400 `INVALID_REQUEST` | 未知协议/超前epoch/畸形HELLO/跨tenant-doc/raw无包络写帧fail closed；`handshake_required` | T010 |
| 403 `WRITE_FORBIDDEN` | `GRANT_REVOKED`、`SCOPE_MISSING`、`AUTHZ_VERSION_STALE`、`DIRECT_BODY_WRITE_FORBIDDEN`、`STALE_EXPECTED_TOKEN`、`STALE_WORKER_TOKEN` | T011/T012 |
| 503 `COMMIT_UNKNOWN` | `reconciliation_required` + 隔离房间、后续恢复blocked；quarantine后写帧隔离但pending可导出 | T009/T010 |
| 503 `DEPENDENCY_BLOCKED` | `SOURCE_GAP`、`DB_PRIMARY_AMBIGUOUS`、`OLD_PRIMARY_NOT_ISOLATED`、`OWNER_NOT_READY`、`RENEWAL_FAILED`、`DEADLINE_UNSET` | T011/T012 |
| 409/超时类 | `conflict`（同operationId异hash/actor/目标、CAS不匹配）、`stale_queued`、`LEASE_EXPIRED_AFTER_LOCK`、`LEASE_EXPIRED_AT_TERMINAL_RECHECK`、`TOKEN_SUPERSEDED_AT_TERMINAL_RECHECK`、`LOCK/STATEMENT/TRANSACTION_DEADLINE_EXCEEDED` | T009/T010/T012 |
| 404 `RESOURCE_NOT_FOUND` | 14个private读面统一404，无存在/计数/正文泄漏；manager/service/无grant主体无豁免 | T011 |
| 幂等 | 同operationId/hash/actor/目标返回原结果且不增epoch；`IDEMPOTENT_REPLAY`（worker eventId） | T009/T012 |
| 隔离/BLOCKED | `blocked-requires-approval` / `countsAsPass=false`（P09、候选B、只读预览）；`haClaimed=false`、`rpoClaimed=false` | T009/T012 |

以上均为进程内对象字段或字符串枚举，**没有一次真实HTTP状态码响应、WebSocket帧收发或网络字节**；不能据此宣告§1错误表或任一接口已运行。

### 8.4 未决与BLOCKED

真实HTTP/WS端点、路径尾段、域名/端口、BOM与容量；可信身份/用户委托、CSRF/Origin、会话票据、审计脱敏、限额与有限退避预算；wire消息号/Schema冻结与真实provider兼容；真实DB事务、outbox、receipt落库、崩溃恢复；真实WS/SSE/对象流在途与跨实例收敛、5秒SLA；P09故障模型/复制确认/DB切主/旧主隔离/PITR代际（T012 `blocked-requires-approval`）；候选B（另批）；T014–T018与正式迁移/控制器/业务接线；F3/F8/P07/P08/P09/P10/P11与各AC/CHK验收；HA/RPO/RTO。

### 8.5 复审状态与红线

该批次责任人复审记录为pending，未勾选原T项（[tasks](../tasks.md)保留各完整条件）；人员由用户统筹，不虚填生产责任或批准。此历史PoC没有执行生产/Git/真实业务DB操作，也不独立构成实现授权；后续用户本地授权及真实实现另见当前章节。完整版本/线序/失败/哈希指针见[research](../research.md)§3.6、[data-model](../data-model.md)§8与后端`.workbuddy/t013-run-20261107/evidence.json`。


## 9. 2026-11-07 本地运行协议

这是已通过真实本地集成的核心切片，覆盖C01受限创建、C02会话和当前文档权限、C03唯一seed/逐update持久化。不是C01–C15整体生产冻结。实际代码为同级后端 `src/local-runtime.ts`、`src/collab/durable-runtime.ts`，前端 `src/collab/durable-bridge.js`（从可选 `lark-doc/collab` 子入口导出）。

### 9.1 HTTP与身份

- `POST P/sessions {token,docId}`：交换管理员合成fixture预置的单用户opaque票据，数据库验证SHA256 hash、service `session_user`、tenant/doc/principal/expiry/revoked/current principal；回 `{principalId,canCreate,csrfToken}`，设置 `lark_session` HttpOnly/SameSite=Strict cookie。本机仅127.0.0.1 HTTP例外无Secure，生产TLS/IdP尚未实现。不能在body/header自行指定actor或expected-CSRF。
- 写请求要求配置中精确Origin、cookie和数据库保存的`X-CSRF-Token`；credential CORS只允许该Origin、GET/POST及Content-Type/X-CSRF-Token预检，无通配。
- `POST I/resource-bindings {docId,sourceSystem,externalResourceId,operationId}` →201 `{bindingId,docId}`：用户须有受信canCreate，数据库原子建立doc/binding/创建者来源grant，初始化仍false。相同原键幂等，冲突409。
- `POST D/seed {operationId,updateId,payloadHash,payloadBase64}` →201 `{receipt}`：验证真实V1 Yjs bytes及hash、数据库唯一初始化；同键同体回原receipt，不同seed409。只有COMMIT确认后回成功。
- `GET D` → `{tenantId,docId,principalId,initialized,epoch,revision,lastSeq,canWrite,field:'default',payloadBase64}`；正文最后发送在同一受限事务持当前授权/文档锁时同步入队。跨作用域和无阅读权统一404。
- `GET D/receipts/{updateId}?operationId=...&payloadHash=...&epoch=...&expectedRevision=...`：只查同actor原请求且当前仍有权，精确命中才回receipt。无记录/异主体/异hash无receipt，unknown不得解读为永不提交。
- `/livez`仍为存活；配置真实受限gateway且PG健康、WS监听才`/readyz=200`。无DB配置原启动入口继续503，不假改就绪。

### 9.2 Hocuspocus 4.7.1受控扩展

真实provider/server使用官方Stateless opcode **5**，documentName=`tenantId/docId`，JSON共同字段`{type,protocolVersion:'editor-crdt-v1',tenantId,docId}`。正文fragment固定`default`，Yjs13.6.33、Tiptap3.32.0。官方Sync/SyncReply/SyncStatus/Awareness不承载正文或durable；服务端入站拒绝、出站过滤，客户端在apply前检查协议帧。连接控制Auth/Close/Ping/Pong按官方层处理。

| type | 额外字段与含义 |
|---|---|
| HELLO | `epoch?`；首次可省略，重连须原epoch |
| READY | `epoch,revision,lastSeq,principalId,canWrite,field:'default',payloadBase64`；当前权和已提交重放基线，不证明pending持久化 |
| UPDATE | `operationId,updateId,epoch,payloadHash,payloadBase64`；不可变原字节，发送前SHA256 |
| ACCEPTED | `operationId,updateId,expectedRevision`；只登记服务端本次串行提交水位，**不清pending** |
| COMMITTED | `receipt,payloadBase64`；真实COMMIT后应用到原活动Y.Doc，再对每受众当前持锁准入发送 |
| RECEIPT | `receipt,operationId,expectedRevision`；仅精确updateId/hash/epoch清该pending |
| QUERY | `operationId,updateId,epoch,payloadHash,expectedRevision`；查询原请求，不重发新内容 |
| ERROR | `code,operationId?,updateId?,status?,expectedRevision?`；unknown保留待对账，禁止显示已保存 |

receipt为`{tenantId,docId,updateId,payloadHash,epoch,protocolVersion,seq,contentRevision,committedAt,status:'durable'}`。所有整数维持规范ASCII十进制字符串。普通同epoch CRDT不因客户端旧revision拒绝：房间串行分配当前expectedRevision供DB内部CAS，ACCEPTED把原值交给客户端用于精确查询。

断线保留unknown，不自动换epoch/重发；重连有pending时blocked只读。仅已知原expectedRevision者显式QUERY；查清后重新HELLO当前复权才恢复写入，未知原水位者保留导出。旧epoch、异hash或协议错误隔离。协作模式禁旧initialContent/本地草稿覆盖服务器基线。

宿主刷新恢复使用桥的显式API，不自动使用localStorage、IndexedDB或文件：`await bridge.exportPendingSnapshot()`等待原outgoing哈希完成，返回冻结副本`{schemaVersion:'pending-snapshot-v1',protocolVersion:'editor-crdt-v1',tenantId,docId,epoch,principalId,pending}`；旧`exportPending()`数组接口保留。`pending`保留原`operationId/updateId/epoch/payloadBase64/payloadHash?/expectedRevision?/status`，未知hash为原null或缺失，未知epoch/principal为null；不猜原水位或补身份。包可能含未确认私密正文，保管/传递由显式宿主负责，不写日志，也不赋任何服务器权限。

新桥必须以`autoConnect:false`创建，在首次HELLO之前且无本地pending时`await bridge.restorePending(snapshot)`，成功返回当前state。入场按精确schema/scope/规范十进制/唯一原键/canonicalBase64/已有256KiB单update和390KiB帧界限验证，给定hash须匹配实际字节；全包验证完才原子接纳为unknown，复制输入且不应用任何恢复payload。验证未完成时connect明确拒绝、直接startSync隔离，不能先握手。已知原epoch在HELLO保持原值；READY须同epoch且同principal原文，在两者检查前不apply服务器baseline。未知epoch/主体或含未知epoch条目则拒启动而保可导出，旧epoch/异主体在新baseline前隔离。

恢复条目只在同一连接明确调用`queryPending()`后，收到原`operationId/updateId/hash/epoch/protocol/expectedRevision`全匹配的RECEIPT才清对应项；普通COMMITTED广播、无本次QUERY的旧receipt、synced和QUERY unknown均不清。缺原hash/expectedRevision只留导出，不发QUERY或UPDATE。断线/新HELLO清本次QUERY资格。全部查清后仍blocked只读，宿主须显式`bridge.provider.forceSync()`重新HELLO/current READY才能恢复写入。此接口补AC-03-Q/AC-08-D本地接线，不等于浏览器持久存储策略或崩溃故障域已批准；针对性与真实reload证据由当前回归另记。

### 9.3 本地边界

每update≤256KiB，HTTP/WS envelope≤400KiB、房间排队≤32、单房间原操作登记≤4096；这些是本地有限防护值，非生产容量批准。每次敏感发送在当前授权锁内同步enqueue，不等远端ACK；未测长期慢消费/大历史READY背压。当前完整日志重放，非零snapshot_watermark或latest_snapshot明确拒绝，不能冒称快照/版本恢复验收。服务/PG仅正常关闭重启，未做COMMIT网络响应丢失、kill-9、PITR/切主或HA。

### 9.4 2026-11-08 本地开发与验证映射

9.3 的快照限制是早期核心制品事实。当前010–017代码已接完整快照验证、不可变版本、候选A恢复与后续业务，本批真实独占PG和双浏览器闭环已执行，证据见research§7；旧18/10场景不能证明这些新增能力。下面记录实际本地入口，不代表C01–C15全部AC或外部供给通过。

| 本地入口 | 当前行为 |
|---|---|
| GET/POST `D/comment-threads`，GET线程，POST线程`operations` | kind为create/reply/edit/delete/resolve/reopen/participants/visibility，threadRevision CAS；private当前共同谓词与软删原键查询。统一operations是本地实现映射，未另接上游各HTTP动词别名。 |
| GET/POST线程`follow-preference`、GET `link-target` | 个人follow/mute持久事实；稳定链接每次当前复权，不授private。 |
| POST/GET回复`translations` | 校验当前private与源replyRevision后503内部依赖blocked，无持久任务、外送或译文。 |
| GET `D/notifications`、POST `notification-operations`、GET `D/events` | Cookie SSE、opaque Last-Event-ID、410当前快照、已读/mute；每次发送当前过滤，frame只有引用/偏好/当前过滤count，无正文/内部seq。 |
| POST `D/share-operations` | 固定独立share来源，复用permission操作/原键查询；拒resync，不自动增加private参与者。 |
| POST/GET `D/mention-resolution-operations` | 当前doc/epoch/seq后503目录blocked，不枚举synthetic身份、不造mention任务或通知。 |
| POST `D/version-diff-operations` | `{fromVersionId,toVersionId}`实际不可变内容JSONPointer文本/结构差异，同步computed，`persisted:false,taskId:null`。 |
| POST/GET `D/import-operations`、`export-operations` | 当前准入后的依赖blocked；export固定版本/hash来源，import只核epoch/revision不称文件验证，不造任务/下载/receipt。 |
| POST `D/assets`、POST `assets/id/completion-operations`、GET `assets/id`、GET `assets/id/content` | 当前read/write准入后对象未接通；begin无ID、complete不认可声明checksum为验证、Range只语法，无206/字节/URL/物理删除。 |
| POST `I/events`、GET `event-operations/id`、POST `reconciliation-operations`及审批/事件引用读取 | 仅显式synthetic-local独立Bearer与独立PG LOGIN；拒Origin且不接受Cookie作为服务凭据，Inbox COMMIT/原hash/gap/原envelope对账，不称Java已投递或审批已决定。 |

`P/operations/id?commandType=comment|follow|notification|permission|version|restore`均在正确原操作入口分派，原查询仍复核当前身份/目标/private。写结果只有实际COMMIT确认才称committed；确认后视图刷新失败保留committed，另标需刷新，不重POST。

协作票据30秒保持不变。续票沿Hocus4.7.1原生Auth控制通道：服务端有限requestToken、客户端动态ticket getter、服务端在同房间队列中以原Cookie/T/D/principal复核相同epoch/authz/scopes与延长expiry，再原位更新connection context。权限/epoch变化、超时或无效响应关闭要求新Auth/HELLO，pending/原操作键不清、不自动UPDATE；Node定时仅调度，当前授权与有效期仍由DB clock裁决。实际双浏览器已验证跨原expiry、同socket/Y.Doc、未确认原UPDATE仅一次、旧票拒绝、原QUERY与后续durable写入；首次入房在恢复前取到的旧票仍须拒绝并显式重新鉴权。

本地API `/readyz` 的 `scope:local-api` 不等于完整首发批次或外部服务ready。US6内部成功链、真实Java/目录、批准格式与内部对象依旧BLOCKED；本批当时的Safari待验状态由后续§10.5本机原生证据补齐，生产恢复/容量及发布门仍分别待验。


### 9.5 T017浏览器会话持久化补齐（2026-11-08）

018把原local-runtime进程Map替换为受限`pg_browser_sessions`事实，不改变`POST P/sessions`及业务HTTP协议。007仍是可信身份源；浏览器表只保存底层token hash对应的tenant/doc/principal、随机CSRF和DB期限。当前身份验证/共同锁/终端COMMIT检查保持原链路，不把该表当作IdP。

- start在当前事务委托后创建/刷新本人事实；有效会话并发登录返回数据库原CSRF，只有COMMIT确认后设置Cookie/返回。期限取DB时钟后1小时与底层身份期限的较小值，Cookie Max-Age取剩余整秒；普通请求不续期/创建事实。
- 原Cookie/CSRF可以直接跨API实例及正常API/PG重启继续读写，不需重新POST sessions。浏览器事实过期后，明确POST sessions才轮换CSRF；旧值拒绝。底层撤销/到期/主体禁用仍拒绝；同token被改成其他tenant/doc/principal时拒绝迁移，需新的底层凭据。
- 所有HTTP/SSE初始准入均await受限数据库解析；CSRF仍只用于变更请求且须精确Origin。browser TTL保持原HTTP准入语义，后续业务事务仍复核007身份；未新增WS或业务COMMIT的browser TTL承诺。独立服务I/events仍走独立Bearer/PG身份。
- CSRF需稳定回传，故受限表中保存随机值；应用/API/Worker/集成/PUBLIC没有直读写权限，仅collab组可执行本人受限函数。值不进审计/Outbox/证据，未知提交不返回CSRF。
- 真实PG/HTTP双实例及原Cookie正常重启专项11/11：backend`.workbuddy/s-DeET8a/evidence.json`，24源/4编译指纹一致；真实双Vue2/WS/SSE/独立Worker/PG回归31/31：`.workbuddy/c-OeSvHl/evidence.json`，388输入指纹一致。两者分开：后者原重启用例会重新登录，原Cookie不重登回归由前者证明。

本地合成IdP验证不代表公司身份协议、注销事件源或生产部署已完成；未增加自助logout或全局禁用接口。


### 9.6 T018/US3-T037快照计算边界（2026-11-08）

`gateway.snapshots.publish`保持内部repository接口和原snapshotId语义：同候选重试仍检查当前活租/授权，正文已变后同id重算冲突；query可查原不可变结果。本次不新增HTTP入口、自动快照调度或runtime drain承诺，调用方必须await完整publish Promise。

发布顺序改为：受限一致读取→读事务COMMIT并归还连接→一次性Worker重放/编码→观察真实线程exit→新受限事务取/续当前租约→原010复核epoch/revision/seq/schema/previous snapshot及当前授权、CAS→COMMIT确认后返回。读取后正文追加、真实恢复、会话撤销及另一受限SQL事务先改指针，均不能让陈旧候选发布；日志及receipt继续保留，不引入未批准压缩/删除。

本地技术防护为每进程一个publish候选且不排队、纯计算10秒期限；在load前取得slot，最终finally才释放。Worker只克隆image，空env/execArgv，无PG凭据、活动Y.Doc或网络操作，输入不detach。message与exit成功前均复核单调时钟，timer延后也不得放行迟到候选；失败/超时仍等实际exit。busy/CPU/写前传输错误明确拒绝，只有发布COMMIT已尝试且结果不明才保原id返回COMMIT_UNKNOWN。上述值不是生产SLO/容量验收。

最终当前树证据：backend`.workbuddy/d-SDEw16/evidence.json`真实独占PG **42/42**（含新增4个发布前竞态；确定性barrier在读COMMIT/Worker exit后、新发布BEGIN前，不声称测得CPU执行中途）；`.workbuddy/s-KHJwwd/evidence.json`原Cookie/CSRF真实会话 **11/11**，两份各76源/53编译指纹一致；`.workbuddy/c-4jArCX/evidence.json`实际双Vue2/HTTP/WS/SSE/独立Worker/PG **31/31**、389输入一致，9项cleanup正常且无页面异常/外部请求。Node884中878通过、6历史stock预期红灯默认跳过；snapshot子集21项包含真实线程、注入端口/单调钟测试，不冒称真实数据库或性能benchmark。Node22 build通过。旧L007/L008来源结果保留历史，不代此轮同源证明。


### 9.7 T043/T044→T050/T051→T105/T106计算隔离与最终准入（2026-11-08）

按本地依赖顺序收齐版本捕获/预览、候选A恢复、真实diff开发后统一回归。固定五类任务复用`candidate-executor`/`document-candidate`：snapshot、version-capture、version-read、restore、diff。每类单进程一个slot且准备前获取、不排队，10秒计算期限同时在message/exit检查单调时钟；等真实exit才能发送或进入写事务。空env/execArgv、不传token/连接/活动Y.Doc、不detach输入；这些只是本机技术边界，不是生产容量或SLO。原snapshot入口迁移后删除，没有新增依赖、注册框架或HTTP操作。

- 版本capture由原prepare/load各自COMMIT/release后在Worker重放、PM投影、编码及计算两hash；原version.create独立于document.write，canWrite=false但获version.create仍可捕获。原operation重试先查已提交结果，最终原SQL复核cut/CAS/lease，只有最终COMMIT已尝试且结果不明才unknown；准备/计算失败不造版本。
- 版本get先原受限读取并COMMIT/release，再Worker验证不可变bytes/JSON/PM/hash。019 `pg_version_admission(T,D,V)`复用当前`pg_version_access(...,'version.read')`，只回不可变metadata；Node匹配完整来源小metadata（createdAt按同一时刻比较），锁内同步send。该批次019原仅collab EXEC；当前020为独立API有意增加同一受限read EXEC，未授直表、prepare或写权，Worker/integration/PUBLIC仍拒。现行角色以§10/020为准。
- 历史版本epoch/revision与当前正文可以不同；019不把历史来源误绑当前水位。版本正文校验后仅撤version.read而保留document.read，实际PG仍404/零send。
- restore prepare/target/load三读提交后，Worker用原纯验证与候选A构造显式delta及已canonical pre/post正文；不额外强加原restore访问不需要的version.read。最终仍原restore SQL原子提交pre/post/epoch/update/receipt，计算后追加、实际恢复或身份变化按原CAS/授权拒绝。原房间串行、必要的原活动Doc hash及提交后向同一Y.Doc apply保留；不宣称所有主线程CPU均消失。
- diff两个真实来源验证后在Worker按原JSONPointer算法/限额比较；计算结束在同一事务/同一client对两个来源执行019并匹配原metadata，再一次性同步send，不持SQL锁跑diff、不嵌套max1池。结果仍同步HTTP返回、persisted=false/taskId=null，不增加假后台任务。真实格式/转换/object仍未供给。
- 计算busy/failed/timeout及准备不可用只公开固定错误码（503），未知带SQL/凭据细节的文本仍隐藏。正常HTTP handler完整await Worker；新真实HTTP+真实Worker、注入PG端口的abort/drain组合证明客户端断开不提前释放在途，Worker完成后正常关闭；不代真实PG证据。

最终当前来源：backend`.workbuddy/d-VULynv/evidence.json`真实PG **51/51**，`.workbuddy/s-gZh2Au/evidence.json`真实HTTP/PG会话 **11/11**，各80源/56编译指纹一致且正常停库；`.workbuddy/c-O3Bho0/evidence.json`双Vue2/HTTP/WS/SSE/独立Worker/PG **31/31**、393输入一致、9项cleanup正常、无页面异常/外部请求。Node22 build/typecheck通过，受影响87/87、backend912中906pass/0fail/6历史stock expected-red跳过。独立closure_review仅本轮本地APPROVE、Simplicity/Correctness双PASS。

浏览器首轮c-0t3Mtx在原丢确认QUERY后pending超时，未记录armed故不冒称原轮已捕到开关；新确定性red c-rUEZie证明测试夹具resume仅清ID未清仍armed状态，修为两者同时关闭并在两场景等待原确认实际被丢且ID匹配。原QUERY/无重复提交/续票检查保留，不改协议/timeout。失败原JSON和正常清理事实均保留，最终新31通过，不改旧记录。

自动snapshot触发/间隔/执行身份尚未冻结，不添加定时器或日志清理；真实公司IdP/授权源/Java/目录/翻译/批准转换/对象与生产故障容量验收继续BLOCKED。

### 9.8 T029→T057本地生命周期补齐（2026-11-08）

空闲WS每连接仅一个受限current capabilities检查，使用原Cookie映射的可信会话和当前授权锁；不进room业务队列，也不更新ticket/ready或替代逐次发送/提交门。正式票据连接比较最新claims的T/D/主体/epoch/authzVersion及scope子集，避免捕获旧短ticket与原生续期竞争。既有无票据受控路径复核read/主体/epoch，仅撤write而保独立read时允许保留连接，写仍逐次拒绝，不宣全T029完成。2秒轮询按原计划时刻加2秒绝对预算，start callback已迟到即关闭且不查询；结果过期不可绿，成功后不从返回时刻重置完整interval。失败停poll和续票、关闭旧资格；原PG工作直到settle仍计在途并由正常close等待，超时不冒取消。

就绪并发共享一轮原探针与绝对monotonic期限，超时后底层未结束不放单飞，新轮不缓存旧READY。阶段前后、最终结果、close实际开始及完成检查同一期限与phase；drain等待原探针及业务在途，逾期保持incomplete。只读恢复preflight补timer已经结束的终结flag，即使timer精度使monotonic尚差不足1ms，迟到许可也不再启动inspect；无新增PITR/切主/清理入口。

最终代码build/typecheck通过，受影响Node **47/47**；backend **938total=932pass/0fail/6历史stock expected-red skip**。真实HTTP/PG会话 **13/13** backend`.workbuddy/s-uIpESu/evidence.json`，80src/56compiled指纹current一致、正常SIGTERM/cleanup空。新增就绪gate位于实际PG检查之前，证据是实际HTTP+注入暂停原探针+随后真实PG，不是DB查询中途故障。

实际双Vue2/HTTP/WS/SSE/独立WorkerCLI/PG及正常重启 **34/34** backend`.workbuddy/c-qLTUlu/evidence.json`，393输入指纹current一致、11项正常清理、页面异常/外部请求空。另套独立runtime/池B通过共享PG和真实HTTP改权，A空闲连接无新HELLO/UPDATE/QUERY；撤销写来源保独立read、sourcegap、合成主体禁用、会话撤销四次请求开始到实际WS关闭约1743/1808/1792/1783ms。5秒是本地健康检查保守界限，不是生产SLA/跨机HA或提交宽限；正文epoch/revision/lastSeq全程不变，fresh read及受限can_resync HTTP复核通过。

保留原红灯与中间失败：idle缺失1fail、ops5fail、preflight晚许可1fail、idle start迟派发1fail；c-vf9hUQ原31过但新增夹具误用revision列导致false/11正常cleanup，修content_revision后重新完整34。gap后预读capabilities会被当前gap正确拒绝，夹具resync改用原gap结果authzVersion直接请求原HTTP，没有admin清gap或放宽权限。最终日志/before位于`/tmp/lark-doc-lifecycle-20261108/`；backend非Git且WS三文件未留本轮before，不伪造完整diff，独立审查须完整阅读相关函数/测试。外部与生产验收边界仍同上，未commit/push/发布/部署。

closure_review最终独立APPROVE仅本地slice，Simplicity/Correctness双PASS；已全读相关实现、复算80/56/393全部current及核原始JSON/日志/正常停库，不冒完整Gitdiff审计。B在同一Node进程中独立启动runtime与池，非跨OS进程；真实公司IdP/Java/其他外部供给、自动snapshot与HA/PITR/容量/最终浏览器验收仍未完成。

## 10. 当前独立owner运行契约

本节对应T005/T013→T018/T038/T057本地接线。API、collab owner及Worker通过各自配置入口成为独立OS进程/LOGIN；startLocalRuntime注入入口继续兼容，不将同进程fixture当成分进程证据。用户HTTP和editor-crdt-v1消息协议不为拆进程另造第二套正文。

### 10.1 固定控制面与委托

仅允许固定 `https://127.0.0.1:port` endpoint；TLS1.3双向CA验证、server SAN与精确peer pin，同CA错peer也拒。client在发送原token/body前核server pin；拒明文、动态URL、重定向和浏览器Origin。配置、私钥、证书、token、原始body和SQL不进对外错误/日志。生产签发/轮换/信任供给尚未批准；本地只用自有0700目录的合成CA/leaf、0600私钥，不安装系统信任。

| 内部入口 | 固定输入 | 处理及输出 |
| --- | --- | --- |
| POST `/internal/owner/v1/commands`，kind=seed | protocol=editor-owner-v1，tenantId/docId，原sessionToken，input的operationId/updateId/payloadBase64/payloadHash | owner校验二进制/原hash，在原room队列调用受限seed；已确认回原receipt，未知保原operation/update/hash |
| 同入口，kind=capture | 同一scope/token；原operationId/expectedRevision/purpose/可选label | owner本地runDocumentCommand及assertState→原版本prepare/Worker/CAS/COMMIT，不借服务证书取得version.create |
| 同入口，kind=restore | 同一scope/token；原operationId/targetVersionId/expectedRevision/expectedEpoch | owner原restoreDocument串行→候选A/原子pre-post/update/epoch/receipt→同一活动Doc应用；回公开元结果/roomApplied，不回delta |
| 同入口，kind=invalidate | protocol、kind、tenantId/docId；无actor/scopes或用户授权效果 | 受信服务的可丢失关闭hint，固定accepted，无存在性/连接数；不改Grant/正文，失败不改变此前已确认操作 |
| GET `/internal/owner/v1/health` | 只限已验证API服务peer | 当前role PG及控制listener可服务；不枚举文档、不等于活动writerReady |

拒未知DTO字段及actor/scopes/URL注入；owner token遵原43–128字符opaque约束。mTLS只识别服务，用户principal/tenant/doc/current scopes仍由007/009及受限SQL裁决。API最终浏览器敏感输出仍经当前read准入；capture只要求原version.create，restore沿原restore权限，不暗加version.read。

### 10.2 角色与当前读取

020 `pg_runtime_role_ready(role)` 要求API仅lark_pg_api、owner仅lark_pg_collab，且注册映射/sandbox当前有效。API获显式受限读和领域端口（含019），无正文commit/seed、版本恢复prepare或写入、快照推进、lease或旧create绕行。Worker/integration独立，不用全collab membership让API健康变绿；权限清单以020迁移为准。PG会话仍每事务绑定、正常结束才还池，结果不明连接丢弃。

API ready依赖自身API PG与受信owner控制链，不等待空房间的文档writer租约，避免首seed循环。具体文档READY/写入仍由owner当前lease、fence、epoch、连续日志重放和原活动Doc检查裁决；控制面available不是写资格。018原Cookie/CSRF可跨API正常重启复用，不重新登录，也不因此代表真实公司IdP完成。

### 10.3 未知、排空与来源gap

HTTPS不自动重POST。丢响应、逻辑超时或畸形成功结果均不能造committed；保原业务键查询/重试，同键同hash复用事实、异hash冲突。恢复重放原结果不重应用delta，不倒退随后正文。seed未知也保operationId/updateId/hash，不能退成丢失对账身份的泛503。

API abort不提前释放owner原handler：Worker、PG COMMIT及原Y.Doc apply继续完成；API client逻辑timeout只结束本次等待，原HTTPS请求跟踪到真实end/error。API/owner分别有限排空原工作和池，绝对单调期限在close开始、完成及最终结果复核，timer迟派不能假closed。超时保incomplete和原身份，不强杀、假cancel或换键补交。API重启不关闭owner；正常同owner重启与跨机HA/PITR分别验真。

source gap使新敏感请求fail closed。已开SSE发授权失效控制，通知及private评论投影清空；新GET的PG_PERMISSION_SOURCE_GAP即使503也清缓存。普通503仍是依赖失败，可按原有限策略重连，不一概宣撤权。失效hint可丢，WS current capabilities轮询仍补偿；5秒仅本地健康目标，不是授权宽限或生产SLA。

### 10.4 工件与证据

后端Node22.13/npm8.19.4 pin、107原归档SRI/许可证文件/engines核对、隔离离线ci和冷HTTP200/无DB ready503，见[research §8](../research.md#8-当前本地运行与交付证据)。SBOM为CycloneDX1.5；独立生成器npm11.2.0不改变业务npm8，输入副本local版本不构成包发布。真实内网registry/许可/安全支持批准仍缺。

真实PG51、HTTP/PG14和三进程browser35已存在中间通过来源，后续代码变化不能把它们改标最终当前树；最终原始JSON、计数、来源hash和审查以tasks统一索引为准。不补造失败/已过记录，不在本契约用文件存在代执行。真实IdP/Java/目录/翻译/格式/对象、HA/PITR/容量/保留、硬件触控及完整首发批准继续独立保留，F6仍阻整批。原生Safari本机六单元的后续事实见§10.5。未commit/push/npm发布/部署。

### 10.5 2026-11-08本地制品与浏览器边界

精确来源、命令、体积表和历史失败保留规则见[research §8.4](../research.md#84-2026-11-08最终证据)。前端源码`50c3512aa7cca4104cf3143a5ee6eefeb1a73c8ae395ee18bd4f93767e607a89`的原七入口构建、Vditor93、体积门和只读制品戳检查均退出0。Node22.22.2 gzip9为Element471879/475000 B、ESM主271096/285000 B、UMD主474318/用户已批准480000 B、CJS2044644/2500000 B；其余原门不变。只证明当前本地制品，不证明npm发布或内网交付。

原固定2000块/seed42/30-20-10采样及原`gate.mjs`纯函数七项通过，原基线和20%门未改；未执行`report.mjs` CLI，代理指标不代生产SLO。Safari27.0经真实safaridriver/WebDriver取得Element/facade三模式六单元PASS（三项新执行、三项同源制品有界复用），不是WebKit模拟器或真实公司账号/DB后端验收。

最终浏览器UI索引为36PASS/7BLOCKED/0FAIL，`passed:false/status:BLOCKED`。Chrome六单元、四项冷加载、相关overlay/表格/高亮块/help和原生ESM/provider/Vue peer已有实际证据；原full FAIL及定点父BLOCKED保留，两行测试预期修正不改生产代码或制品。物理触控、完整AC、公司业务和生产准入缺口仍在，不把选定功能覆盖写成整批通过，也不新增或改变HTTP/WS协议。


### 10.6 2026-11-08续开发：显式本地目录、对象和转换端口

本节覆盖§9.4当时的stub快照；生产外部协议仍未供给，不把本地typed端口当已批准协议。实际入口/字段由`backend/src/modules/{mentions,assets,conversion}`、`local-runtime.ts`及021–024迁移定义，原task/90表和现行证据索引记录执行范围。

- 目录在显式DirectoryOptions配置下当前doc/epoch/seq解析，持久绑定operation/hash和user候选；POST/原GET均不代表通知或自动share。无配置仍503。实际PM提及的mentionId/principalId/notify只能由owner从候选内容提取，经023普通/seed/restore wrapper随新receipt同事务同步；旧receipt重放不重应用effects。Worker无目录配置不领取mention；有配置时外部可见检查在事务外，最终当前提及/权限/静音/token在PG再核后持久去重。真实目录适配未开发。
- 资产使用显式InternalObjectPort及完整byte policy/verifier；pending完成须实际读到EOF并核size/SHA/对象version、chunk证据，成功才ready。原操作GET不重新上传/完成。currentcut与正文receipt同事务；不可变version自动存refs，restore只允许精确target版本已有ref，非uploader旧current可保留，猜private ID不能升public。HTTP实际Range按完整存证chunk验证后切片，逐块当前准入COMMIT后发，背压与对象IO均在事务外。未知保原键，无策略禁物理清理。
- 转换仅显式`isolated-converter-v1`、格式/限额/deadline、实际verifier与对象端口完整时启用；024持久pending/ready/failed与不可变source/hash。纯GET仅查原任务，不重执行converter；同operation异intent/hash拒409。export固定version，输出实际EOF/hash/对象version/chunk验证后受权取件，每块同时要求version.read和document.export，普通asset权限不能旁路。import消费server captured readyasset事实及实际字节，唯一mTLS collab owner保历史候选→最终sourceCAS/lease/epoch/receipt/bodyeffects同事务，API/worker无直接正文写权；unknown只查原task不重POST候选。
- Provider/Session及原UI支持pending/unknown原键查询、failed显式新意图、ready import receipt/重新打开要求、ready export实际SHA核验字节及原任务格式命名。身份/provider/来源/权限/销毁后的晚回不能恢复旧视图或触发文件。Web界面不把候选或转换请求当成功送达/已下载。

真实SSO/Java/目录、内部翻译、storage/converter适配及批准格式/生产额度仍阻依赖项；未配置时503不变。本节无新生产授权、无真实业务DB、无发布或破坏性故障执行。

### 10.7 项目内部服务v1契约（用户授权自主配置，2026-11-08）

用户确认没有既有接口资料，授权按生产要求配置。以下是本项目选择并实现的服务契约，不冒称某个现存公司系统已采用或验收；原技术栈、原任务依赖和本地执行边界不变。真实端点、证书和环境观测仍需在实际部署环境供给。

- 传输使用固定HTTPS origin、TLS1.3双向证书、CA/主机名与精确服务证书SHA256 pin；请求和响应均有`x-larkdoc-protocol: internal-services-v1`。不跟随重定向，不透传浏览器Cookie/Authorization。路径由适配器固定，业务参数编码或进入JSON。总deadline、请求/响应实际字节上限、AbortSignal和真实工作排空独立于PG事务。
- `POST /v1/directory/resolve`的JSON为`{schemaVersion:'1',context:{tenantId,docId,principalId,sourceEpoch,sourceSeq},query}`；响应同schema/context与`candidates`。`POST /v1/directory/visible`改传`principalIds`并返回其唯一子集`visiblePrincipalIds`。上下文不精确匹配即拒绝；候选不产生grant、private participant或送达事实。
- 对象以`/v1/objects/{encodeURIComponent(locator)}`操作。`PUT`发送实际字节、Content-Type和`If-None-Match:*`，201返回`{schemaVersion:'1',versionId}`。`GET`用`x-object-version`固定版本，200返回同名版本头及实际MIME/字节；Range响应须206、精确Content-Range/版本/EOF长度。无浏览器直读签名URL或不受权代理旁路。
- `POST /v1/object-verifications`接收实际字节及`x-declared-mime`、`x-content-sha256`、`x-content-size`。200仅接受`{schemaVersion:'1',verdict:'safe'|'rejected'|'unknown',mimeType,sizeBytes,checksum}`，必须与本机实际字节和EOF事实相同。适配器不自行宣告safe，未配置扫描器保持blocked。
- 转换导出`POST /v1/conversions/export`传`{schemaVersion:'1',format,source:VersionContent}`，200流响应的`x-larkdoc-format`、`x-source-content-hash`、`x-source-version-id`须精确绑定原不可变来源，Content-Type须在显式格式表。导入`POST /v1/conversions/import/{format}`发送实际文件，200返回`{schemaVersion:'1',format,targetStateBase64,candidateContentHash}`；必须通过规范base64、大小、实际Yjs文档scope和正文hash验证，再走原唯一owner命令。
- 配置以`LARK_INTERNAL_SERVICES_FILE`指向管理员文件；只读具体CA/cert/key路径和显式格式/限额，密钥不写进示例/日志。缺配置仍保原blocked行为，配置错误启动失败；项目代码不创建生产凭据或进行远端部署。实现和实际测试状态分别登记到原task表。

- 翻译`POST /v1/translations`传`{schemaVersion:'1',context:{tenantId,docId,principalId,threadId,replyId,operationId,requestHash,sourceRevision,sourceHash,targetLanguage},sourceText}`；原键查询`POST /v1/translations/operations/query`只有相同context、不重发原文。响应精确echo schema/context，pending(202)/ready(200)/failed(200)含taskId，ready含translatedText，failed固定code TRANSLATION_FAILED；unknown(200)为taskId:null/code OPERATION_UNKNOWN。025在PG持久化原键/别名/actor-source-language隔离缓存；外送在确认COMMIT后，返回前当前private/源revision+实际SHA再次CAS。无配置仍503整批blocked；配置失败不降级。
- 浏览器附件字节使用`POST D/assets/:assetId/upload-operations?operationId&sizeBytes&mimeType&checksum`，Cookie/精确Origin/CSRF/Idempotency-Key受权，Content-Type固定application/octet-stream。资产locator仅由prepare取得，原complete意图COMMIT后才外送，不可变PUT、实际EOF/size/SHA、固定version扫描、最终当前权限CAS缺一不可。pending(202)/unknown(503)保原complete键；原GET仅恢复这个已持久意图的对象校验/完成，绝不新PUT或换locator。无策略始终禁止物理删。项目v1合成本机mTLS+PG通过不能冒称真实公司对象/扫描部署已验。

- 身份桥`POST /v1/identity/exchanges`为`{schemaVersion:'1',context:{tenantId,docId,operationId,requestHash,codeHash,issuer,audience},loginCode}`；原查询`POST /v1/identity/exchanges/query`只含schema/context，不重发code。`POST /v1/identity/sessions/current`的context为tenant/doc/issuer/audience/subject/sessionId/sourceRevision。HTTP200严格回显schema/context并返回`{status:'verified',identity:{tenantId,docId,issuer,audience,subject,sessionId,sourceRevision,expiresAt,state:'active'|'revoked'},code:null}`或`{status:'unknown',identity:null,code:'IDENTITY_UNKNOWN'}`；expiresAt为Unix毫秒字符串。401/403明确拒绝，其余不猜真实身份。
- `LARK_INTERNAL_SERVICES_FILE.identity`包含transport、tenantId、issuer、audience、cookieKeyFile（受保护32B随机密钥文件）及可选ttlMs/timeoutMs/maxCodeBytes；生产profile的本地TTL为2–4秒。`LARK_IDENTITY_PG_USER`必须是单独继承lark_pg_identity的受限LOGIN，并由管理员按tenant/issuer/audience登记pg_identity_callers和已有principal映射；它不继承API/collab/worker/integration，不自动创建grant或canCreate。028在COMMIT确认后才向身份桥换票；HMAC派生的opaque Cookie只存hash。原intent重放不延TTL、不覆首claims；续期必须当前token/browser/CSRF/principal/state有效，fresh current后再次CAS；过期不能复活。已知撤销收紧全部同IdP session token，上游期限缩短也只收紧其他token，不为其他文档续期。
- 配置身份后的浏览器`POST /tenants/:tenantId/sessions`只接docId/operationId/loginCode，`/sessions/query`只接docId/operationId/codeHash，`/sessions/current`和`/sessions/logout`接docId并验Cookie+CSRF。业务接口不接受body actor/principal/token替代换票。authenticated DTO严格为status/principalId/canCreate:false/csrfToken/refreshAfterMs/expiresInMs，Cookie为HttpOnly/SameSite=Strict/Secure；expiresInMs取DB剩余秒数的保守下界，前端再扣全RTT。unknown/denied立即收紧Session权限和私有Provider缓存，保原键查询；本地过期须新SSO意图。API/协作精确匹配配置的HTTPS Origin；本轮只验证本机HTTP适配层+声明Origin及实际内部mTLS，不冒真实浏览器TLS终结/公司IdP或5秒生产SLO。
- 独立入站集成进程使用`LARK_INTEGRATION_SERVER_FILE`（schemaVersion/tenantId/sourceSystem/peerPin/caFile/certFile/keyFile/port）和`LARK_INTEGRATION_PG_USER`启动现有`start:integration`；实际TLS1.3客户端CA与pin才是服务身份，拒Bearer/Origin/转发身份头。固定tenant/source下复用C10 Inbox、原结果及受限对账；不会把本地reference_recorded改称Java审批决定。
- 出站`POST /v1/editor-events`为`{schemaVersion:'1',requestHash,envelope:<原DB envelope::text的JSON>}`；ACK须HTTP200精确回`{schemaVersion:'1',tenantId,sourceSystem,eventId,requestHash,status:'accepted'}`。未知后仅`POST /v1/editor-events/operations/query`查同context/id/hash，不重发payload或另event；status unknown保留不确定，32次预算后隔离，不能冒称送达。027冻结原授权envelope/hash、独立process/event fence、外送前当前source/受众校验，ACK入账前再次复权；不补隐藏private gap或发明权威来源快照。原envelope的externalDelivery字段保持原字节，真正投递结果在独立027账本。
- `LARK_INTERNAL_SERVICES_FILE.integrationDelivery`包含transport/tenantId/sourceSystem/documents显式清单及可选timeoutMs/pollMs/processTtlSeconds；`LARK_DELIVERY_PG_USER`使用单独integration LOGIN并登记pg_integration_delivery_callers，以`start:integration-delivery`运行，不能混用通知Worker角色。unknown降级停队列，正常重启只查原事件；关闭须先排空实际工作再释放租约/transport/PG池，incomplete保持可观测。profile按api/worker/delivery用途只加载所需凭据，通知Worker不读身份Cookie密钥。配置/本机替身证明不等于公司Java/IdP/对象服务已部署或验收。


### 10.8 2026-11-09只读恢复权威与030正文前态

`src/ops/recovery-main.ts` 是无PG连接的独立预检入口，读取保护文件 `LARK_RECOVERY_PROFILE_FILE/LARK_RECOVERY_REQUEST_FILE`，复用正式固定HTTPS/mTLS/peer pin与凭据权限检查；严格拒绝继承PG环境、未知配置/请求字段与无效实例绑定。请求 `operationId/action/externalGeneration/source/target/restorePoint/backupManifestHash`，两个实例显式clusterId/instanceId/systemIdentifier；只有pitr-preflight会调用固定 `POST /v1/recovery/preflights/verify`。context添加authorityId/reviewerId/scope/nonce/requestedAt，递归按键排序JSON的SHA256为bindingHash；权威必须精确回显并将permit和六层证据绑定同hash及时效。完整字段、期限、拒绝码及启动说明见 backend/ops/recovery.md；项目production-v1契约是配置目标，不等真实公司服务已部署。production scope也只能返回ready-for-manual-review、executed=false/productionApproved=false，不提供execute/promote/physical-cleanup方法。原HTTP或正文取消未真正结束不能释放单飞guard或宣已排空。

030效果合同增加可信 `priorMentions`，由同一实际前态提取并在首await前复制；不是新的浏览器wire字段。旧cut有effects则SQL核active投影，无effects才记录静默历史墓碑；后态current.notify不被抑制，新mention照常入队；旧receipt重放不应用effects。新写缺prior拒绝，错误或伪造prior在原CAS/lease提交事务中整体回滚。新运行时health要求030新guard且owner/execute资格正确，对029不ready；发布仍需先排空替换旧运行时，旧版本自己的ready不能授权写入。前态之外的迁移前删除历史不推断为已通知。真实旧二进制回退/生产故障仍外阻。
