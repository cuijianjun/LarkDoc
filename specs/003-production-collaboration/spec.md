# Feature Specification: 独立完整编辑器后端

**Feature**: `003-production-collaboration`（规格标识，不切换分支）
**日期**: 2026-11-06
**状态**: 任务制定草案；未实现、未运行PoC、未安装/部署/提交推送，未通过产品或生产验收。

## 依据与历史迁移

用户要求“启动spec-kit 制定task”。本轮读取并依`.codebuddy/commands/speckit.tasks.md`运行真实setup-tasks脚本，先同步旧003再生成任务。最新权威输入为[高层架构](../../.workbuddy/output/高层架构设计.md)§4–6、[系统设计](../../.workbuddy/output/系统设计.md)§3–9、[用户故事](../../.workbuddy/output/UserStory.md)§5–7和[研究](../../.workbuddy/output/research_report.md)。本文七类AC为上游105条的任务化摘要；上游逐条Given/When/Then通过同一AC编号纳入本规格，具体判定须同时满足原文，不以摘要缩小范围。

旧003的US1–US5/FR-001–019/SC-001–010与48任务是旧生产协同草案。本轮统一编号为US1–US15＝上游US-01–US-15＝F1–F15＝C01–C15，旧编号不得用于新验收。旧可靠保存归US3，旧拒权归US2，旧恢复归US7/US8，旧评论通知拆US4/5/6/9，旧集成运维拆US1/10/11/12/13/14/15。旧Node用户强制已由开放研究及IC-01授权专业选择覆盖，现统一TS/Node、NestJS＋FastifyAdapter、Hocuspocus/Worker同语言；不虚构用户亲选BOM。旧专家G3流程已取消，不复活其历史禁止语句，也不记用户点击通过。

## 范围与优先级

公司Java业务域独立管理业务/政策/审批结论，编辑器全新文档域管理资源映射、正文、评论、版本、授权执行、通知和对象引用；不共享表、不逐帧代理WS、不双主。全部内部自部署，禁止托管或公网翻译替代。前端原生DOM及既有能力不删。

7项P0为US1/US2/US3/US7/US8/US14/US15，全部首发。首发还必须US4/US5/US6/US9/US10（P1）完整闭合及US13既有模式/实际对象安全边界。US6内部翻译缺依赖BLOCKED并阻塞当前整批MVP；跳过须用户另批，不能只上线US1。US11/US12和US13新增媒体增强为P2后续，现有前端保留且明确未接通。

## User Scenarios & Testing

所有故事必须测试先行：契约及七类负向/竞态用例→失败断言→模型/服务/端点→前端接入→真实集成。S/F/A/C/D/R/Q分别为成功/失败/越权/并发/断线/重试/刷新回读。全部105条当前未执行。

### US1 创建、绑定与安全解绑资源（P0，C01）

目标：受信Java集成者创建/绑定唯一docId，只撤指定来源并保留独立授权/共享引用。
独立验收：隔离资源三元键，两个并发命令及共享文档，断线后按原operationId查询，验证解绑/删除不误删。
- AC-01-S：创建/绑定/查询唯一docId；单来源解绑不损独立grant。
- AC-01-F：策略未批/共享引用未核清为受限待处置或待对账，禁止自动物理删。
- AC-01-A：伪造tenant/资源归属/actor拒绝且不泄露存在性。
- AC-01-C：同资源唯一，同键不同hash冲突；授权并发重算正确。
- AC-01-D：未知提交保留并查询旧operationId，不新建第二文档。
- AC-01-R：同键同参原结果，旧删除事件不能回滚新绑定revision。
- AC-01-Q：刷新回读映射、来源与持久撤权，审批引用不丢。

### US2 当前身份、private与撤权（P0，C02）

目标：服务/用户委托分离，全部操作基于当前权限，private无管理豁免。
独立验收：真实A/B和第二tenant，HTTP/WS/SSE/对象及所有private读面绕过UI，排队写与revoke竞态。
- AC-02-S：只允许可信主体已授scope，不能互相冒用。
- AC-02-F：身份/授权不明fail closed，不沿失效缓存。
- AC-02-A：manager非参与者/旧票据/链接/服务身份不能读private任一面。
- AC-02-C：同documents FOR UPDATE锁后重查并持至commit；FOR SHARE有限发送准入短事务；撤权后新准入拒绝，先前在途不可追回，5秒非宽限。
- AC-02-D：旧票据重连在sync/回放前拒绝，pending隔离。
- AC-02-R：旧授权事件不复活新撤权；旧成功结果查询也复权。
- AC-02-Q：刷新/跨实例无缓存旁路，连接收敛5秒仅待测目标。

### US3 唯一seed与可靠正文保存（P0，C03）

目标：已初始化不回灌，逐update提交证明、快照水位重放。
独立验收：两真实账号首访/编辑，记录updateId/hash/epoch/receipt，在获准故障模型各commit断点回读。
- AC-03-S：seed唯一；receipt精确绑定updateId/hash/epoch/protocol，仅清对应pending。
- AC-03-F：DB失败/未知不报已保存；隔离污染内存并禁其生成持久版本。
- AC-03-A：普通update/SyncStep2/seed/restore/direct/worker/跨实例全入口统一授权/epoch/token。
- AC-03-C：空但initialized不重seed，旧草稿不覆盖；seq连续、水位CAS不退。
- AC-03-D：commit回包丢失先查询，已receipt在批准故障用例不缺，无receipt不武断失败。
- AC-03-R：同ID/hash/epoch原结果，改payload/epoch冲突；旧receipt不清新pending。
- AC-03-Q：snapshot＋后续seq内容/hash一致；synced/202/hook/toast非durable。

### US7 不可变版本与真实预览（P0，C07）

目标：审批引用只来自已提交版本，真实正文与来源可核。
独立验收：冻结A后编辑B，跨刷新重启预览仍为A，Java侧保存versionId/contentHash/sourceRevision。
- AC-07-S：持久A版本不可变，后来B不改变审批原文。
- AC-07-F：pending/provisional/污染内存不作版本，跨域失败待对账。
- AC-07-A：当前版本权限及private边界，不夹带讨论元数据。
- AC-07-C：expectedRevision冻结对应持久时点或冲突。
- AC-07-D：查询原操作，不因超时重造版本或假跨库原子失败。
- AC-07-R：同请求同versionId，改变来源hash冲突。
- AC-07-Q：真实正文/contentHash/stateHash/来源可核而非块数占位。

### US8 在线恢复与旧离线屏障（P0，C08）

目标：持久pre/post、幂等恢复和旧epoch先于sync阻断，保留CRDT历史身份。
独立验收：A→B→恢复A，双在线账号加旧离线pending；重复/CAS/故障/锚点矩阵。
- AC-08-S：候选A经PoC后在原活动Y.Doc施加显式恢复delta，pre/post及epoch持久；gc:false，锚点attached/orphaned。
- AC-08-F：失败/未知隔离与查询；候选A/B未证实则BLOCKED，拒绝/只读不算通过。
- AC-08-A：无权/跨tenant/旧协议/epoch在普通sync/SyncStep2应用前拒绝。
- AC-08-C：普通写/seed/恢复共队列，CAS确定顺序，不把旧update合并当回滚。
- AC-08-D：旧pending隔离导出/人工处理，不能自动换epoch或合入新state“消毒”。
- AC-08-R：原operationId/hash原结果不再增epoch，actor/目标不符冲突。
- AC-08-Q：重启正文hash/epoch/pre/post一致，不以JSON新建抹历史。

### US14 生产可靠性与受限运营（P0，C14）

目标：writer/DB双层隔离、实际恢复、断外网与发布回退证据。
独立验收：获批隔离环境与故障模型下暂停复活/锁等待/DB切主/PITR/对象身份恢复及交接逐层对账。
- AC-14-S：实施Owner/授权/恢复目标具备后演练并核receipt/版本/权限/对象/事件。
- AC-14-F：唯一主/租约/恢复不明fail closed；Owner未落实阻塞实施。
- AC-14-A：过期writer/worker无提交，运维无private旁路，无策略清理拒绝。
- AC-14-C：锁后clock_timestamp实时判租，事务末复核；旧token零有效提交；DB防脑裂独立。
- AC-14-D：接管重放已提交事实；复制确认/故障域未批不承诺所有灾难RPO=0。
- AC-14-R：恢复/发布/事件重试幂等且不复活旧权/epoch，部分失败可对账。
- AC-14-Q：真实恢复后各层可核，备份存在/历史2703非恢复证据。

### US15 原体验与证据门（P0，C15）

目标：原生DOM、构建兼容、浏览器与预算不退让，验收引用真实新证据。
独立验收：同版后端/前端制品的真实Safari/Chromium/触控矩阵、2000块fixture、原预算与角色直连接口对照。
- AC-15-S：Element gzip≤475000 B且原>20%门禁/DOM构建保留，同版真实报告。
- AC-15-F：超预算/缺浏览器/F6缺依赖/关键故障缺证则整批BLOCKED。
- AC-15-A：UI与直连拒权对照，取证不泄private及身份秘密。
- AC-15-C：实际编辑恢复评论通知轨迹，体积/性能/正确性分开，不减少功能样本假通过。
- AC-15-D：真实断线链符合pending/durable/epoch与回放，不用provider mock替代。
- AC-15-R：保留旧失败及修复后可比报告，E0不称端到端通过。
- AC-15-Q：跨真实浏览器刷新回读符合相应故事，E0–E4不混，2703仅历史。

### US4 完整评论与可解释锚点（P1，C04，首发）

目标：全文/选区、回复、本人编辑删除、解决重开及private，失联可解释。
独立验收：双真实身份走生命周期/并发revision、删除块与恢复后的锚点回读。
- AC-04-S：真实提交生命周期，document无伪block/anchor，selection可定位。
- AC-04-F：失败不报成功，无法解析显式orphaned且保留讨论。
- AC-04-A：分动作拒权，manager无private特权，作者来自服务端。
- AC-04-C：threadRevision CAS与参与者撤权有确定顺序。
- AC-04-D：未知操作可查询，重连先复权不自动重复发言。
- AC-04-R：同键/hash幂等，无重复线程/回复/事件，改内容冲突。
- AC-04-Q：正文/侧栏状态持久一致，relative anchor不依赖本地数组。

### US5 关注与受控稳定链接（P1，C05，首发）

目标：持久偏好与稳定定位，关注/链接不授读权。
独立验收：关注/取消、复制链接跨账号打开，撤权与orphaned回读。
- AC-05-S：关注真实保存，链接定位同线程，取消不撤独立阅读权。
- AC-05-F：失败不成功，失联不跳错位置。
- AC-05-A：无资格统一不可见，关注/链接/计数不泄存在。
- AC-05-C：偏好revision与撤权竞争确定，投递复权。
- AC-05-D：未知关注查原操作，链接重连重新鉴权。
- AC-05-R：幂等且不同参冲突，不重复关注计数/通知效果。
- AC-05-Q：历史链接/列表只回当前获权状态。

### US6 内部翻译（P1，C06，首发整批阻塞项）

目标：指定源revision真实翻译，内部依赖、权限及任务状态明确。
独立验收：真实获准内部服务翻译，源编辑/撤权/断线/重试，并模拟依赖缺失核整批门。
- AC-06-S：内部真实译文绑定源revision/语言，不覆盖原文。
- AC-06-F：缺依赖503 DEPENDENCY_BLOCKED/任务blocked，当前整批不放行，变批须另批。
- AC-06-A：调用前及结果交付复权，private不经缓存/日志旁路。
- AC-06-C：源改删标旧或作废，多语言/身份隔离。
- AC-06-D：查询任务或明确失败，不把超时当成功。
- AC-06-R：最终契约幂等，同键异参冲突，每次交付复权。
- AC-06-Q：刷新仍真实呈现阻塞/失败，toast非内部服务证据。

### US9 通知偏好与授权SSE（P1，C09，首发）

目标：可靠业务事件、每用户提交序、已读静音、受限回放。
独立验收：worker重复/暂停、提交乱序、快照订阅竞态、Last-Event-ID过期及撤权。
- AC-09-S：本地事实/outbox同事务，站内通知与偏好持久去重。
- AC-09-F：worker失败/游标过期可查询重取，不回滚正文或假送达。
- AC-09-A：tenant/principal/过滤范围与private全读面复权。
- AC-09-C：快照交接无漏，每用户锁下提交序；旧worker token不确认。
- AC-09-D：授权Last-Event-ID回放，410明确重取，失权不补送。
- AC-09-R：eventId和偏好操作幂等，不多增未读。
- AC-09-Q：刷新由持久事实恢复，外部送达另证。

### US10 双域集成与补偿（P1，C10，首发）

目标：版本化API/事件、未知结果查询、Inbox幂等与受限对账，不共享表。
独立验收：真实Java契约联调create/bind/审批、超时、重复异hash、乱序缺口/受众过滤。
- AC-10-S：审批存versionId/contentHash/sourceRevision，仅API/事件交换引用。
- AC-10-F：跨域失败待查询/隔离对账，不伪造跨库原子。
- AC-10-A：受限服务/受众载荷不泄private正文/参与人/计数/存在。
- AC-10-C：Inbox副作用本地同事务，revision/index乱序核查，旧grant不复活。
- AC-10-D：原持久结果/对账可查，不另绑活动正文。
- AC-10-R：原eventId/业务键幂等，旧worker被fence。
- AC-10-Q：受限状态区可区分阶段，无运维private/共享表旁路。

### US11 权限感知mention与分享（P2，C11，增强）

目标：真实主体、来源授权与通知闭环，不自动授权private。
独立验收：正文/评论mention、分享与解绑并发及角色候选枚举测试。
- AC-11-S：目标真实、持久事件/授权来源可查。
- AC-11-F：前端保留未接通/失败，无假通知/分享。
- AC-11-A：防跨tenant枚举，mention不grant，分享不授private。
- AC-11-C：来源解绑不误撤独立分享grant。
- AC-11-D：原操作对账，旧epoch mention不穿恢复屏障。
- AC-11-R：grant/通知幂等，异参冲突，旧授权不复活。
- AC-11-Q：刷新真实身份/通知/来源一致。

### US12 真diff与受控导入导出（P2，C12，增强）

目标：真实持久来源、格式边界、授权取件，导入走唯一正文端口。
独立验收：两真实版本diff、批准格式导入receipt、实际文件下载回读及负例。
- AC-12-S：diff真实文本/结构，导入durable，导出与来源hash/范围一致。
- AC-12-F：格式/大小/转换失败明确，不用块数或toast假通过。
- AC-12-A：版本/文件/private及对象每次复权。
- AC-12-C：导入expectedRevision/epoch/token协调，导出固定来源。
- AC-12-D：原任务与pending可查询，旧epoch不可重放。
- AC-12-R：同源hash幂等，不无限重复生成对象。
- AC-12-Q：实际回读内容可核，不以JSON重建当历史恢复。

### US13 附件、媒体与模式（P2，C13，首发既有边界必验）

目标：保留查看/评论/编辑和媒体边界，真实对象完成与当前授权代理读取。
独立验收：真实对象开始/完成/引用/下载；模式越权、共享引用与分块撤权测试。首发实际用到链路不能后置豁免。
- AC-13-S：对象完成校验后ready，引用/hash真实对账。
- AC-13-F：失败/新增未接通明确，不删前端不报空壳成功。
- AC-13-A：每请求/块授权代理读取，旧URL不绕撤权，已发字节不可追回。
- AC-13-C：完成/解绑/清理竞争可查，保留共享引用，无策略不物理删。
- AC-13-D：未知上传/完成/引用状态可查，不重造无主对象。
- AC-13-R：同标识/hash原结果或冲突，不触发无策略清理。
- AC-13-Q：DB与对象分层恢复及当前权限回读，P2不豁免首发链路。

## Functional Requirements

FR-01至FR-15分别为上述US1至US15整体强制需求；必须满足所属七条AC及上游原文，契约为C01至C15，不另建立冲突端点目录。

## Non-functional Requirements

- **NFR-01 易用性**：保存/同步/未知/BLOCKED分开；pending不丢，orphaned不假定位，原键盘焦点/可访问性保留。
- **NFR-02 性能**：2000块fixture与真实历史轨迹、Element≤475000 B及原>20%门禁；gc:false、候选副本、重放/WAL/事件积压实测，未知容量/SLO不得填数。
- **NFR-03 环境**：全部自部署/断外网，真实Safari/Chromium/触控分证，BOM支持交集固定，不擅升前端。
- **NFR-04 安全**：服务/委托分离，CSRF/Origin/安全会话、参数化查询/内容防注入、逐操作/private全读面、日志最小化、限额和秘密策略实施前批。
- **NFR-05 可靠性**：commit后应用/广播目标先PoC；receipt精确匹配、唯一seed/水位/全入口token/epoch；锁后实时钟；DB脑裂与房间fencing分层；恢复A/B均待证。
- **NFR-06 事件**：本地事实/operation/outbox同事务；Inbox/业务幂等，受众可见序列和eventIndex，无private隐藏空洞补发；每用户通知提交序与受限回放。
- **NFR-07 生命周期**：来源撤权/共享引用，分类型保留策略未批禁自动物理删；不承诺无限保留或立即擦所有备份。
- **NFR-08 交付**：实施前实名Owner/替补/DBA安全及另行授权，相关依赖/PoC先于实现，真实故障恢复/断网/供应链/发布和预算才构成生产证据；F6阻塞整批。

## Success Criteria

- **SC-01**：15功能/15故事/105AC及8NFR在任务/证据中逐项可追，未执行不能写通过。
- **SC-02**：获批规定样本中重复seed、虚假保存、已receipt缺失、旧epoch/token有效提交、跨tenant/private越权均为0；故障模型未批不承诺灾难RPO=0。
- **SC-03**：审批样本100%含versionId/contentHash/sourceRevision，冻结后正文不变；恢复pre/post可核、旧pending不自动合并。
- **SC-04**：系统设计P01–P19均有任务与所需新证据；首发P01–P18及所用对象/模式边界必须通过，P19增强另批；F6缺依赖整批不放行。
- **SC-05**：原体积/性能/真实浏览器矩阵分别验收，历史2703及E0不能代E1–E4。

## Edge Cases与未决项

覆盖空而已初始化、seed未知、commit成功ack丢失、默认hook污染、旧snapshot迟到/损坏/seq缺口、恢复/撤权/旧pending竞态、租约锁等待跨过到期/旧writer复活、DB双主/PITR回退token、全局注销、private计数/隐藏事件空洞、SSE ID提交乱序、翻译返回时源改删、对象/DB部分失败与共享引用。

后端仓库/目录、TS Owner/替补、Java/DBA/平台/安全责任、身份/翻译/对象供给、容量/故障域/复制确认/SLO/RPO/RTO/BOM/保留及有限deadline均待确认，见plan B01–B09；未知不填假值。全部验收未执行。
