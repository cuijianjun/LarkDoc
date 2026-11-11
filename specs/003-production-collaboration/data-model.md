# Data Model: 独立完整编辑器后端

> **2026-11-07 当前进展**：新增007可信会话委托及真实应用接线见本文末“本地委托与重放实现”；早期PoC/静态DDL状态是历史记录。已在独占空PG集群运行001–007，不表示生产迁移或存量升级已执行。

**日期**：2026-11-06｜**状态**：拟议模型，未创建数据库/迁移，未执行PoC。**T013补注（2026-11-07）**：本行保留历史原文；T008–T012隔离PoC已在进程内内存状态机验证下列约束的**线序语义**（逐项映射见§8），但数据库、迁移、真实SQL约束、真实DB/E2/E3仍未创建或执行，本文件约束仍为拟议，未获批不得由实现者自由裁量。
依据[系统设计](../../.workbuddy/output/系统设计.md)§3–4、[spec](spec.md)、[plan](plan.md)。旧模型未完整租约/来源绑定/通知提交序等现同步；旧T043/T044不再有效，验证任务见新tasks T008–T018。最新系统全文字段/示意SQL是详细来源，本文件给任务必引约束，不把示意SQL冒充已执行迁移。

## 1. 全局类型与作用域

所有文档业务主键/外键/查询/房间/对象/幂等事实包含`tenant_id,doc_id`；租户级principal/session/operation或tenant/event键为明确例外，但引用文档时仍复合校验，不能空doc代表任意文档。tenant/actor来自可信身份/委托，非body任意字段。

seq/contentRevision/threadRevision/bindingRevision/authzVersion/epoch/token以非负整型持久化，传输为**十进制字符串**避免JS安全整数溢出；各聚合revision不混用。hash带算法前缀，二进制payload_hash针对真实bytes，content_hash针对规范化内容，state_hash针对CRDT二进制，不互相代替。时间DB产生。ID/文本字节上限、TTL/deadline/保留天数待B02/B08批准，缺配置启动失败而非无上限，不伪填常数。

## 2. 拟议实体与约束

| 域/实体 | 键与约束 | 必须字段/语义 | 最早故事 |
|---|---|---|---|
| principals/editor_sessions | tenant/principal，tenant/session；issuer/subject唯一映射 | active、identity source、session状态/到期；全局禁用/注销共主体行锁 | Foundation/US2 |
| documents | PK(tenant_id,doc_id) | initialized、content_revision、epoch、last_seq、snapshot_watermark、latest_snapshot、authz_version、schema_version、status | Foundation/US3 |
| resource_bindings | UNIQUE(tenant_id,source_system,external_resource_id)；绑定doc复合FK | binding_revision、source_revision、status、operation引用；墓碑阻旧事件激活 | US1 |
| grants | tenant/doc/subject/originType/originId唯一作用域 | originType=binding/direct/share，scope与撤销/有效期；单来源撤销后重算有效集 | US1/US2 |
| operations | PK(tenant,clientPrincipal,commandType,operationId) | request_hash、actor、聚合目标、状态/结果引用；同键异hash409；查结果复权 | Foundation |
| room_leases | PK/FK(tenant,doc) | owner_id、fencing_token、lease_until；token递增接管不重置，不等epoch | Foundation/US14 |
| document_updates | PK(tenant,doc,seq)；UNIQUE(tenant,doc,update_id) | actual bytes、payload_hash、epoch、protocol_version、content_revision、actor、committed_at | US3 |
| update_receipts | 唯一updateId作用域绑定 | updateId/hash/epoch/protocol/seq/contentRevision/committedAt同update事务；压缩不丢幂等 | US3 |
| document_seeds | PK(tenant,doc) | operation/源hash/seed update/result，initialized与空正文分离 | US3 |
| document_snapshots | tenant/doc/snapshotId；watermark/CAS | 完整gc:false state、state_hash、epoch/contentRevision/schema；仅确定已提交水位 | US3 |
| document_versions | tenant/doc/versionId不可变 | capturedSeq/contentRevision/epoch、immutable_state、真实content_json、state_hash/content_hash、schema、kind=manual/pre_restore/post_restore | US7 |
| restore_operations | tenant/doc/operationId及actor/hash绑定 | expectedRevision/expectedEpoch、target、pre/post、result_seq/epoch/revision；状态requested/coordinating/committed/rejected/unknown | US8 |
| comment_threads | tenant/doc/threadId；threadRevision CAS | scope=selection/document；visibility=document/private；anchor/quote、creator、resolved、tombstone | US4 |
| comment_replies/participants | 同tenant/doc/thread复合引用 | author从服务端；本人编辑删除仍需能力；显式参与者且仍document read | US4 |
| comment_follows | tenant/doc/thread/principal唯一 | followed/muted/revision，关注不grant/private不豁免 | US5 |
| translation_jobs | tenant/doc/job/operation作用域 | 源replyId/revision、targetLanguage、身份范围、结果/失败/blocked；缓存/结果交付复权 | US6 |
| outbox_events | PK(tenant,event_id) | aggregateType/id/revision、event_index、schema_version、audience_policy、最小payload；同revision允许多event | Foundation/US9 |
| worker_leases | 任务/owner/token/time | token CAS完成，pending/leased/delivered/retry/quarantined；次数/deadline先批准 | US9 |
| integration_inbox | tenant/producer/eventId唯一 | payload_hash、业务去重键、aggregateRevision/eventIndex/受众可见序列、效果与Inbox同本地事务 | US10 |
| notification_streams | 每tenant/principal/过滤作用域协调行 | 提交序在持锁事务分配并commit，不用自增分配序假作提交序 | US9 |
| notifications/preferences/cursors | UNIQUE(tenant,doc,recipient,event_id)；流序作用域唯一 | 最小引用、已读/mute、opaque游标绑定tenant/principal/过滤范围、expiry策略待定 | US9 |
| approval_references | tenant/doc/业务引用作用域 | 不可变versionId/contentHash/sourceRevision；Java落地结果独立待对账，不建公司业务表 | US7/US10 |
| asset_uploads/assets/references | tenant/doc/asset复合键与对象key | status=pending/ready/rejected/deleted、actual size/mime/checksum、引用/hold/来源；未校验不能ready | US13 |
| conversion_jobs/mention_events/share_grants | tenant/doc及操作/来源键 | 固定版本/hash/格式/当前授权；import走统一正文端口，share独立来源 | US11/US12 |
| audit/recovery_generation | tenant或doc作用域按事件类型区分 | 最小引用/trace/结果，禁token/private正文；外部恢复代际不得随PITR一起回退 | US14 |

## 3. 正文与快照不变量

- `0 <= snapshot_watermark <= last_seq`，latest_snapshot水位等于文档水位，CAS只前进。
- 在同文档协调锁中分配last_seq+1、写实际update/hash/epoch/protocol、revision/receipt/operation/outbox并commit，回滚不产生已提交seq/receipt。
- 隔离候选gc:false从完整已提交二进制构建、保留item/client身份和删除集；新服务端操作clientID不复用旧身份。commit后delta应用至**原活动Y.Doc引用**再广播/receipt目标必须PoC，不把候选替换活动对象。
- 内存未追到已提交seq禁下一命令/版本捕获；commit未知或应用/广播失败quarantine/query，不将污染状态防抖写回。
- 首次seed锁documents＋唯一document_seeds，与initialized/update/receipt同事务；空seed也initialized=true，已有空文档不得重seed。
- 快照hash/state/watermark一致发布，重启/接管逐seq连续重放至last_seq校验schema/epoch/revision；缺口/损坏fail closed，不跳过或回空。归档/压缩须水位覆盖、版本/receipt可核且策略获批。

## 4. 授权/租约事务约束

锁序为principal/session→documents→thread/lease→operation，所有入口同序。写/revoke documents FOR UPDATE，READ COMMITTED**锁后**重查当前主体/来源grant/private/epoch/token并持锁至commit；身份全局禁用/注销共主体锁。

有限敏感response/逐受众WS帧/SSE事件/翻译/外投/对象块：FOR SHARE短事务检查当前资格并以commit为准入点，不跨无限网络流持锁；撤权后新准入拒绝，之前在途不能追回。来源事件缺口不能用缓存权兜底。

lease锁后`lease_until > clock_timestamp()`且事务末实时钟复核，禁止事务起点now/锁前时间；配置有限lock/statement/transaction deadline。锁/token提交序是线性化依据，不声称租期到点自动杀持锁事务。接管token递增且重放后ready；API/Worker禁止直接写正文表，统一commit authority强制相关正文/seed/restore/版本/快照检查。房间token、恢复epoch、授权版本、外部灾难恢复generation互不替代；DB唯一主/复制确认另验。

## 5. 恢复、锚点与private

恢复operation/hash/actor+CAS校验；候选A显式delta保留历史，B历史保留/排空若改变在线原对象要求另批；未证明F8 BLOCKED。pre/post版本、恢复update/receipt/epoch/结果同事务，旧update合并不是恢复。旧epoch pending任何sync前拦截并隔离导出，不自动换epoch。

`scope=selection`：`block_id及相对anchor必需`，记录codec/相对位置/quote；`scope=document`：`block_id=null、anchor=null`。`visibility=private`读取为document read且creator/explicit participant；manager/follow/mention/link/service无默认例外。attached/orphaned据解析，不定位邻近无关文本，不公共Y.Doc保存private/quote。

## 6. 来源生命周期与事件提交序

解绑只撤originId匹配grant，重算独立有效权限。业务删除先查所有来源/独立grant/审批/附件/hold，不能全局误restricted或级联删。正文/receipt/版本/评论/对象/通知/审计/备份分类型保留，策略未批禁自动物理清理，不许诺无限保留或立即擦除备份。

业务/operation/audit/outbox同事务；Worker至少一次及token CAS，外部副作用另业务幂等不承诺exactly-once。Inbox与效果同本地事务，乱序按聚合revision/eventIndex及受众可见序列对账，private隐藏gap不能强求补发。每用户stream锁下提交序和快照/游标衔接，无资格不物化/投递/回放敏感payload；410只重取当前授权快照。

## 7. 任务落实与证据

Foundation T014/T015逐项迁移失败测试，后续故事实体由所属任务实现；任何字段上下限/枚举/必填/唯一/nullable必须引用本文件原约束，不留实现自由裁量。未定上限/保留/deadline通过T002/T005批准后写回模型与任务，不由实现者假定。实际migration/DB/PoC/E2/E3均未执行。

**T013更正（2026-11-07）**：上句保留历史原文；其中「PoC未执行」已不准确——T008–T012五个隔离PoC已在`backend/test/poc/`实测并归档（`[实测通过·隔离本地 PoC]`），但**实际migration、真实数据库、真实DB/E2/E3仍未执行**，此部分不变。详见§8与[research](research.md)§3.6。

## 8. T013证据复审：约束→PoC验证状态映射（2026-11-07追加）

本节按[tasks](tasks.md)T013（依赖T012）把§1–§7的拟议约束逐项映射到T008–T012的真实证据，**只记录、不验收**。全部为`[实测通过·隔离本地 PoC]`或`[静态分析]`：锁表、已提交视图、commit seq、receipt、Outbox、DB topology、Yjs二进制与帧都是进程内对象/内存合成；没有真实PostgreSQL、SQL约束、迁移、wire Schema、WS/provider/浏览器、跨实例或故障注入。T014–T018及正式迁移未开始。

| 本文件约束 | T008–T012已验证的语义（PoC级） | 仍未验证 / 归属 |
|---|---|---|
| §1 复合`tenant_id,doc_id`作用域 | PoC内以tenant/doc字符串匹配做fail closed（跨tenant-doc票据、畸形HELLO拒绝） | 真实列/外键/作用域索引、租户级例外落地；T014/T015 |
| §1 十进制字符串整数、hash分类不互替 | D001 `src/protocol-integer.ts`纯字符串比较实测；T009 `nextDecimal()`使epoch/revision/authzVersion/commitSeq/fencing token/worker token/外部恢复代际字符串自增，含`9007199254740993→…994`不经Number/BigInt；`stateHash`/`contentHash`/`payloadHash`用`createHash`分开 | 真实DB列类型/精度上限、传输Schema冻结、hash前缀规范批准 |
| §1 时间由DB产生、缺配置启动失败 | T012区分事务起点`now()`陷阱与锁后实时钟、末端复核；3类deadline缺失/超限fail closed | 真实`clock_timestamp()`、B02/B08获批数值；PoC数值仅`LOCAL_FIXTURE_ONLY=true` |
| §2 拟议实体与唯一约束 | 全部仅为内存Map/对象字段：`documents`协调行、`room_leases`、`document_updates`/`update_receipts`、`document_versions`、`restore_operations`、`outbox_events`、`worker_leases`、`audit/recovery_generation` | 全部实体、`UNIQUE(tenant_id,source_system,external_resource_id)`、作用域FK、幂等键、nullable/枚举；T014/T015 |
| §3 `0<=snapshot_watermark<=last_seq`、CAS只前进、水位重放 | 未验证（PoC无快照/seq管线） | T014/T015约束失败测试；真实重启/接管逐seq重放 |
| §3 隔离候选`gc:false`保item/client身份与删除集、commit后delta施加**原活动Y.Doc**、不替换房间doc | T009实测：旧clientID 101 Item仍在、新服务端777001独立、未变节点既有`Y.Doc`/`XmlFragment`/`Y.XmlText`引用不变；T008/T010复核同一活动对象引用；朴素清空重建因破坏锚点判不合格 | 真实DB读取的完整已提交版本二进制、真实Tiptap全schema、基于CRDT身份的diff/移动语义 |
| §3 commit未知/应用广播失败quarantine/query、污染内存禁版本 | T009 `reconciliation_required` + 隔离并blocked后续恢复；T010 quarantine后写帧隔离但pending可导出 | 真实commit未知事件自动隔离、真实版本/审批禁写 |
| §3 首次seed锁documents＋`document_seeds`、initialized与空正文分离 | 未验证（seed仅登记为`covered-locally`接口） | T014/T015、T015迁移 |
| §4 锁序principal/session→documents→thread/lease→operation、写/revoke共`FOR UPDATE`、锁后复权、持锁至commit | T011内存LockTable：四类授权写共享同一协调行、FIFO、决策视图`viewSource=after-lock`且`capturedAtCommitSeq`为当前已提交位置；revoke先commit则排队写获锁后看到authzVersion `1→2`并`GRANT_REVOKED`零事实 | 真实`SELECT … FOR UPDATE`、READ COMMITTED、MVCC、锁争用吞吐、序列化失败、更强隔离级别 |
| §4 `FOR SHARE`短事务commit为发送准入点、撤权后新准入拒绝、在途不可追回、5秒非写入宽限 | T011实测：准入前候选digest不释放、commit即释放共享锁、许可一次性且绑定resultId/blockId/surface/consumerId、六类发送面独立commitSeq；`WRITE_GRACE_MS=0`，推进1000ms仍拒写；`inFlightAfterRevoke`/`cannotRecall`为标志位 | 真实WS/SSE/对象流网络缓冲、跨实例失效投递、5秒SLA测量、跨域即时撤权 |
| §4 全局注销/来源gap/失效信号遗漏fail closed | T011实测：注销同commit更新主体与docAuthzVersion、两实例写与准入均拒；序号跳跃置gap→`SOURCE_GAP`；丢弃失效信号实例仍因提交时查当前视图拒旧写 | 真实第二tenant/双账号/浏览器、真实跨域授权源对账 |
| §4 lease锁后实时钟+末端复核、有限deadline、token递增不重置、不宣称墙钟杀事务、重放后ready、统一commit authority禁直写 | T012逻辑钟实测：50ms等待1000 vs 1050；`LEASE_EXPIRED_AFTER_LOCK` / `LEASE_EXPIRED_AT_TERMINAL_RECHECK` / `TOKEN_SUPERSEDED_AT_TERMINAL_RECHECK`零提交；`DEADLINE_UNSET`及三类超限；持锁旧事务未结束token takeover `deferred`；四类caller×六类命令统一屏障、`DIRECT_BODY_WRITE_FORBIDDEN` | 真实PostgreSQL时钟/行锁/事务deadline、真实接管/暂停复活/kill-9、B02/B08配置 |
| §4 房间token/恢复epoch/授权版本/外部灾难恢复generation互不替代；DB唯一主/复制确认另验 | T010 `EPOCH_IS_NOT_FENCING_TOKEN`；T012 epoch不随token推进、PITR `externalGenerationIndependent=true`、`plusOneInsufficient=true`；房间token不代DB防脑裂 | **P09 BLOCKED**：真实DB切主、复制确认、旧主隔离、PITR代际、故障模型批准 |
| §5 恢复operation/CAS、候选A显式delta、B另批、pre/post/epoch/receipt原子、旧update合并不是恢复 | T009实测：同operationId/hash/actor/目标幂等不增epoch，异hash/actor/目标或expectedRevision/expectedEpoch不匹配conflict且正文不变，并发只允许一次；pre/post state hash与epoch/revision/operation hash精确登记；三类伪恢复拒绝 | 真实DB事务原子性、真实版本表、F8验收 |
| §5 旧epoch pending在sync前拦截、隔离导出、不自动换epoch或merge新state | T010实测：握手前自动SyncStep2/SyncStep1全拦、旧epoch `EPOCH_MISMATCH`+停自动上传+只读导出、排队出队逐条复核epoch、恢复后旧会话写资格失效 | wire消息号/Schema冻结、真实provider、真实身份/票据 |
| §5 relative anchors attached/orphaned、不定位邻近无关文本 | T009探针实测：`createAbsolutePositionFromRelativePosition`对已删除目标会就近重定位（返回`{"type":"","index":0}`），必须显式读`doc.store.clients`中struct的`deleted`位；未变节点attached、曾删除/被替换节点显式orphaned | 真实Tiptap marks/全节点类型、真实selection业务语义 |
| §5 private统一谓词、manager/service等无豁免 | T011实测：14读面统一404无存在/计数/正文泄漏，进程内统一谓词函数 | 真实多账号/跨tenant集成、AC-02-A全部私有读面 |
| §6 来源gap/权威resync、worker token CAS+eventId幂等、至少一次 | T011/T012实测：`SOURCE_GAP` fail closed、resync后仍after-lock；worker失租`WORKER_LEASE_EXPIRED`、重复eventId `IDEMPOTENT_REPLAY` | 真实Outbox/Inbox、每用户stream提交序与游标、410、跨域副作用对账 |
| §7 T014/T015逐项约束失败测试 | 未开始 | T014/T015；本轮不改任何勾选 |

**未决与BLOCKED**：全部真实DB实体/约束/迁移/T014/T015；真实SQL锁与READ COMMITTED、`clock_timestamp()`、事务deadline（B02/B08未批）；wire消息号与Schema（见[contracts](contracts/backend-api.md)§8）；seed/initialized分离、快照watermark/CAS/重放；真实WS/provider/浏览器/跨实例/5秒SLA；P09故障模型/复制/切主/旧主隔离/PITR代际（`blocked-requires-approval`、`countsAsPass=false`）；候选B（另批）；F3/F8/P07/P08/P09/P10/P11与各AC验收；HA/RPO/RTO/容量/可靠保存。

**复审状态与红线**：责任人复审`pending`（人员组织由用户统筹，不虚填人名、不以缺人名阻塞本地开发，生产交接清单不虚构完成）；未勾选T013或任何原T001–T126（[tasks](tasks.md)第99行仍`- [ ]`）；未做部署/Git commit-push/真实业务DB/故障注入/真实授权/关闭或绕过防护；「无通过不进入正式依赖实现」，本节不构成T014/T018开工授权。完整版本/线序/失败/哈希指针见[research](research.md)§3.6与`apps/lark-doc-backend/.workbuddy/t013-run-20261107/evidence.json`。


## 本地委托与重放实现（2026-11-07追加）

001–007已在新建0700、Unix-socket-only空PG17.11集群运行，不连接既有/真实业务DB。旧迁移头的STATIC/NOT EXECUTED是编写时的历史记录，不代表生产已迁移，后续隔离执行证据另存。

007增加管理员供给的`pg_service_callers(role_name,lease_owner_id,active)`与`pg_user_sessions(token_hash,tenant_id,doc_id,principal_id,expires_at,revoked,can_create)`，仅保存opaque票据SHA256，不将任意请求actor/GUC/SET ROLE当身份。服务登录角色仅继承lark_pg_collab，不是owner/API/Worker。真实共享池每事务BEGIN后用受限`pg_open_user_session`验证票据，私有`pg_request_contexts`以backend_pid+xid8绑定当前用户；一次事务不能换绑，提前`SET CONSTRAINTS ALL IMMEDIATE`只产生closed墓碑，当前xid不能再次open，下一事务清旧记录。

固定锁序为service映射FOR SHARE→tenant授权协调行→documents→lease/operation。resolver在锁后及提交末尾复核expiry/revoke/主体；服务映射修改不得穿过活跃事务。原004/005/006通过统一resolver；未注册service的历史SQL调用者只保留管理员固定role映射，真实service无legacy回退。

PgDocumentGateway的create、seed与PgCommitPort写入均等精确COMMIT才返回结果；传输/结果不明不返回receipt、不应用候选。正文update/receipt/operation/outbox在数据库同事务，原活动Y.Doc仅在确认后应用。当前逐受众withReadAdmission先完成有限FOR SHARE事务并确认COMMIT，在同一有限发送窗口同步入队；COMMIT失败/不明或窗口到期不发送，不跨异步对象IO/背压持锁，不等待网络ACK。ownedLease只允许当前受权service读取自己仍有效的owner/token，再renew，重启不抢他人活租。

本地读取逐seq/hash验证完整document_updates，发现缺口、损坏或Yjs未完成依赖即拒绝。当前不截日志、不实现快照压缩，非零快照水位明确拒绝。双真实LarkDoc、正常PG/API/WS重启回读与续写证据见research§6；私有评论、Worker、恢复epoch切换、生产复制与容量仍未验证。


## T017持久浏览器事实（2026-11-08追加）

018新增`pg_browser_sessions`，主键及外键为007的`token_hash`，绑定`tenant_id/doc_id/principal_id`，持久化43字符随机`csrf_token`及有限`expires_at`。身份仍取007受信映射；表不铸造身份、角色或授权，也不取代逐事务复权。

start先取得007服务/tenant协调锁，再原子复用同scope有效CSRF及更新有限期限；scope/主体不匹配直接拒绝，不能凭旧Cookie迁移身份。request只作无锁scope提示，进入原007委托、锁后读取匹配的browser事实；正常读写不延寿。所有新增函数固定search_path、受限owner及EXECUTE ACL，应用组无直表权限；CSRF只供本人的POST sessions稳定返回，不进入业务审计或Outbox。没有新增物理删除/保留策略。

已在保留数据的独占PG执行001–018；真实HTTP双实例、并发start、原Cookie/CSRF正常重启读写、失效及角色负例11/11通过（backend`.workbuddy/s-DeET8a/evidence.json`）。这不是生产迁移执行或真实IdP验收。browser TTL限于HTTP初始准入，业务COMMIT仍按原007身份/当前授权检查。


## T018/US3-T037快照两阶段发布（2026-11-08追加）

快照表、010受限函数与CAS条件不变。读事务先完成一致image并COMMIT/release；无DB连接的Worker计算state/stateHash且完整退出后，另开事务取得当前租约并复核epoch/revision/seq/schema/旧watermark及latest_snapshot、当前身份和授权。原snapshotId同cut重放、异cut冲突；不清日志/receipt。

新增真实PG竞态使用独立文档：追加、真实冻结B恢复、合成会话revoke、另一受限SQL发布事务更新指针后，原候选精确SQLSTATE/命名错误且零snapshot行。barrier是读已提交/Worker已退出、写BEGIN前，不模拟为多机并发或CPU中途实测。最终42/42领域PG、11/11真实会话均正常停库且76源/53编译当前一致；双浏览器31/31及389指纹一致，路径见contracts§9.6。Worker期限/单slot仅本机防护，原后台调度、完整故障模型/生产容量及版本/恢复CPU隔离不因此算完成。


## 版本/恢复/diff两阶段计算及019（2026-11-08追加）

无新增业务表或版本/receipt格式。019新增受限metadata准入函数，复用当前document.read+version.read及原协调锁，按既有PK查不可变version metadata，不回bytes/content。版本读取正文先提交读事务，在Worker完成原Yjs/PM/canonical验证，再按019当前锁核相同完整来源后同步发送；历史epoch/revision不要求等于当前文档。

capture与restore把原重放/投影/候选A/prepost canonical计算交固定Worker，准备读取先归还连接，计算后原SQL重新查当前权限/cut/lease/fence；原原子事实、同operation结果和unknown查询不变。version.create不是document.write，restore不额外要求version.read，这两项均有真实PG正例。diff计算后两来源在一个受限事务重新准入，零部分输出。技术每类单slot/10s，无新持久任务或自动快照/压缩策略。

本轮新增9个真实PG场景的barrier在实际Worker exit后、下一写/发送准入BEGIN前，不冒称CPU中途或多机：readonly version.create、追加/恢复导致过期capture拒绝、独立撤version.read仍保doc.read却零正文、diff/restore身份撤销零输出/原子事实、无version.read恢复及历史来源可读、019角色ACL/metadata-only。最终51/11真实PG各80源/56编译、31浏览器393输入当前一致；证据见contracts§9.7。完整原T项和外部/生产门不因局部验收完成而勾选。


## 2026-11-08续开发的021–024持久边界

- `mention_resolutions`以tenant/doc/actor/operation及canonical requestHash绑定来源epoch/seq和真实typed目录候选；GET不重解析，目录成功本身不创建grant或通知。
- `assets/asset_chunks/asset_references/asset_holds/asset_operations`保存pending/ready/rejected/deleted、服务端实际EOF/size/hash/对象version及chunk证据。对象IO在SQL事务外；完成后事实CAS，read按当前ref/角色逐块准入。version/comment/current引用复合作用域隔离，无策略不能物理清理。
- `body_effect_receipts/body_asset_cuts/body_mention_intents/body_current_mentions`由owner从实际PM候选提取，随正文新receipt原子同步。资产扫描仅取实际`doc.content`中的`image.attchId`或`fileBlock.token`，限定本地asset标识并去重；版本归档按同一两类节点保存引用。旧receipt重放不按旧候选倒退currentcut，也不重建提及事件；notify=false无通知，提及不产生授权。023三wrapper为collab-only，旧无effects正文函数对运行时角色关闭；恢复的跨uploader例外仅绑定已提交restore的精确target版本引用。
- 030要求同一可信前态的 `priorMentions`，正常owner/restore/import分别从实际live/plan.preContentText提取，不读浏览器伪造字段。已有effects旧cut必须严格匹配active mention投影；历史cut缺effects时，仅在真实新receipt同事务记录全部前态键的 `body_mention_intents.baseline_suppressed=true,notify=false,event_id=NULL`（包括本次删除键）。该事实不表示历史已发、历史作者或原通知时刻，current.notify仍保持正文值；真正新键照常产生事件，旧receipt不补写。缺prior/已有效果账本却前态不一致整笔回滚。迁移前已删除且前态未知的键不能凭此恢复完整历史去重。
- `conversion_jobs`以actor/operation/kind/hash固定immutable version或server captured readyasset来源；pending/failed/ready及import receipt可持久查询。export真实输出EOF/hash/verifier/对象version/chunk证据齐全才ready，取件每块要求version.read+document.export；import仅由024 collab-only提交函数经原mTLS owner队列，最终核source/asset/lease/epoch，body update/receipt/effects/job同事务。API/worker没有该正文写路径。

真实directory/storage/converter/翻译/Java适配、批准格式额度及生产恢复代际/fence仍未供给。本地typed配置用于明确的隔离契约与合成数据验证，不冒已批准公司协议或生产DDL执行。
