# Requirements Checklist: 独立完整编辑器后端

**更新日期**：2026-11-08｜**状态**：本地实现和真实PG/浏览器集成已执行；原完整AC、外部供给及生产人工审阅尚未全部满足。历史E0记录不代当前执行结果，本地结果也不代需求方/安全/DBA的生产批准。

原126任务已逐行重新核对：82项本地实现/测试有证据而勾选，44项保持未勾，原因与真实路径见[tasks当前核对](../tasks.md)。以下46框仍是完整审阅条件，不能由本文作者的结构核对代签；未勾不等于该能力未开发，更不把原任务所有未完成部分统称外部阻塞。最终汇总入口为后端`test/evidence/local-final-20261108/`，逐126/105索引与校验核本地来源，不代完整AC/人工批准。真实三进程/PG/双用户/COMMIT/正常重启回读已有证据；当前制品及原性能门、Chrome六cell/四cold/native ESM、Safari原生六cell分别有本地结果。Safari已有历史原生证据，当前新SDK已按3+2+1新通过有界汇合六功能，原两轮FAIL保留；物理触控与真实公司服务/生产故障恢复仍单列。透明UI投影整体BLOCKED且保留原失败，不冒整矩阵通过。

## 范围与真实性

- [ ] CHK001 宪章2.0.0草案的破坏性修订是否由真实责任人审阅，旧Node用户强制→开放研究→IC-01单语言专业选择历史是否明确，未伪造批准？
- [ ] CHK002 15功能/US1–US15/C01–C15是否唯一映射，旧5故事/48任务编号是否明确失效且从未执行，不把重名T编号当完成？
- [ ] CHK003 是否已真实依spec-kit tasks命令运行setup-tasks，生成前后检查extensions.yml并按强制hook规则处理，而非仅仿写格式？
- [ ] CHK004 是否区分最初仅003/constitution的E0授权与后续明确扩大的本地开发/独立PG/三进程测试范围，保留002/上游输出及其他worktree未提交状态，无未授权真实业务DB/破坏性注入/生产部署/提交推送？
- [ ] CHK005 7项P0 US1/2/3/7/8/14/15和首发F1–F10/F14/F15＋F13既有对象/模式边界是否保留，非US1-only上线？
- [ ] CHK006 F6内部翻译依赖缺失是否明确阻当前整批MVP，改批须另批，无公网/托管/伪译文捷径？
- [ ] CHK007 F11/12与F13新增增强是否后续完整保留，不删既有前端，不假成功？

## 前置与架构

- [ ] CHK008 T001本地实际同级`lark-doc-backend/`已创建且非Git、用户TS长期维护责任已确认，是否仍区分未落实的替补/Java/DBA/平台安全责任与生产访问批准，不再把backend写成仅拟议或据此阻本地开发？
- [ ] CHK009 Java业务域是否独立不共享表、不逐帧代理WS、非第二正文真源，审批仅不可变版本引用？
- [ ] CHK010 Node/Nest/Fastify/PG等BOM是否支持交集实证后固定，不照抄master/浮动标签或偷换前端构建兼容？
- [ ] CHK011 身份/对象/翻译/Java接口供给、安全部署/秘密/限额/deadline及实名责任是否实施前落实，不假定现成？
- [ ] CHK012 容量/故障域/复制确认/SLO/RPO/RTO/保留是否明确未知/B门/所需证据，不伪填资源或把fixture当容量？
- [ ] CHK013 是否以T008–T012实际隔离PoC/模型/受限PG/真实线程与当前集成分别记录线序和失败，区分尚未获供给的生产故障模型，不再统称未来才运行；失败能力仍BLOCKED，不以文档或stock expected-red skip当验证通过？

## 可靠正文与恢复

- [ ] CHK014 全入口受控候选→commit→原活动Y.Doc应用→广播/receipt是否P01硬门；default hook/await onChange/synced/202不作证明，不自动provisional降级？
- [ ] CHK015 updateId/hash/epoch/protocol/seq/revision/receipt是否同事务精确绑定，只清匹配pending，未知先查不换ID？
- [ ] CHK016 seed是否initialized独立于空正文且事务唯一，旧草稿不自动回灌？
- [ ] CHK017 水位state/hash/CAS是否一致，seq缺口/损坏是否fail closed，receipt/版本保留，策略未批准禁清日志/物理数据而非假定已批准或必须执行清理？
- [ ] CHK018 污染内存/提交未知/commit后应用失败是否quarantine并禁新写/版本捕获，Y.Doc不是DB rollback自动回滚？
- [ ] CHK019 版本真实预览/不可变stateHash/contentHash/sourceRevision是否完整，不把块数摘要当正文或跨域失败当跨库原子？
- [ ] CHK020 是否明确本地已采用并验证候选A显式delta的A→B→A嵌套内容/格式/CRDT身份/gc:false/锚点与原活动对象，候选B仅作历史对照而非当前待选方案；完整故障尚缺时不提升为F8全AC通过，改变在线原对象要求仍须另批？
- [ ] CHK021 operationId/hash/actor/expectedRevision/epoch及pre/post结果是否原子，重复不再增epoch，202不等成功？
- [ ] CHK022 旧epoch/未知协议是否先于任何普通sync/SyncStep2拦截，显式pending恢复包在HELLO前原子核scope/字节/hash、READY先核原epoch/principal再接baseline、仅原QUERY精确receipt清匹配；未知项可再导出，不自动存储、重发、换epoch或合入新state“消毒”？

## 当前授权与隐私

- [ ] CHK023 写/revoke是否共享documents FOR UPDATE，READ COMMITTED锁后复权且持锁至commit，主体禁用/注销是否共身份锁？
- [ ] CHK024 敏感结果/逐受众帧/SSE/翻译/外投/对象块是否有限FOR SHARE短事务commit准入，不跨无限网络持锁？
- [ ] CHK025 是否清楚撤权后新准入拒绝、之前已准入在途不能追回、下一块复权；5秒是连接失效目标非写入宽限/已证SLA？
- [ ] CHK026 private是否文档read且作者/显式参与者，manager/service/follow/mention/link无豁免，所有读取/计数/搜索/导出/通知/运营面一致404不泄漏？
- [ ] CHK027 全局注销/授权来源gap/丢失失效信号是否fail closed/权威复核及补偿，不冒称跨域全球即时？
- [ ] CHK028 tenant/doc复合键、范围FK/房间/对象/幂等及租户级例外是否有真实第二tenant同doc负例，不信body actor/tenant？

## 生命周期与事件

- [ ] CHK029 解绑是否只撤来源grant，独立grant/共享来源/审批/附件引用保留；删除是否受限待处置而非全局误restricted？
- [ ] CHK030 分类型保留未批是否禁自动物理清理，未承诺无限保留或所有备份立即擦除？
- [ ] CHK031 评论document scope是否block/anchor为null，selection必需稳定anchor，7类AC生命周期及orphaned是否独立可验？
- [ ] CHK032 关注/链接/译文是否按当前private/来源revision复权，关注不grant，译文不覆盖原文/过期结果不假当前？
- [ ] CHK033 业务/operation/outbox同事务、Worker token CAS/有限重试隔离、Inbox与效果同事务，是否不宣exactly-once？
- [ ] CHK034 aggregateRevision/eventIndex/受众可见序列及private隐藏空洞是否正确对账，旧grant事件不复活新revoke？
- [ ] CHK035 每用户通知提交序是否锁下commit序而非自增分配序，快照/订阅无漏、Last-Event-ID范围绑定/410和当前复权完整？
- [ ] CHK036 对象actual hash/类型/大小完成校验、未知/部分失败对账、逐块代理鉴权及共享引用保留是否实证，旧签名URL不绕撤权？

## 生产/证据/任务结构

- [ ] CHK037 lease是否锁后clock_timestamp实时判租/末端复核，有限deadline，不用事务起点now/锁前时间，锁/token顺序而非到期自动杀事务为依据？
- [ ] CHK038 房间fencing是否与DB唯一主/旧主隔离/复制确认及PITR外部恢复代际分层，旧writer/worker无有效提交、重放后才ready？
- [ ] CHK039 是否实际备份/WAL/PITR/对象/身份隔离恢复并核receipt/token/权限，备份存在或实例数不等HA，记录实测恢复点/时间？
- [ ] CHK040 是否区分本轮已执行的107包原归档SRI/SBOM/隔离离线ci冷HTTP与正常三进程摘流排空，和仍缺内网源/许可批准、SSO轮换/真实附件翻译离线链、完整回退与实名值守；来源变化须对应证据，不假称全部生产供给链通过？
- [ ] CHK041 Element≤475000 B、原>20%可比门禁/2000块与真实Safari/Chromium/窄屏触控/模式/生命周期是否分别报告、不换基线掩盖失败？
- [ ] CHK042 E0–E4/真实双身份与第二tenant是否分层，2703历史单测不当新验收，失败/BLOCKED保留原始报告？
- [ ] CHK043 126项是否连续唯一、按本行原条件及证据逐项勾选而非机械全空或全勾，生成时逻辑路径有实际实现映射/依赖，15故事测试先行→实现→集成，Setup/Foundation/收尾无US标签？
- [ ] CHK044 30个[P]是否仅共同前置就绪的15组不同测试文件，无共享实现路径并行冲突；依赖是否全部引用存在且无环？
- [ ] CHK045 105AC/8NFR/15FR/5SC/19矩阵是否全部映射任务/所需证据，每故事独立验收/并行例子及首发不是US1-only明确？
- [ ] CHK046 speckit.analyze是否在生成完整任务后真实check-prerequisites并只读审计；风险/未决输入不被伪标已通过，后续修订另获批准？

## 结果口径

当前原126为82项本地实现/测试完成、44项保持原条件未满足；90项复核表、126/105索引与source hash校验已更新。后端受影响370/370、生产adapter123/123；前端959/959后，最后query-only附件墓碑修复以相关732/732（含142附件）补验，不相加充全量。真实PG身份18/正式mTLS profile1、投递13、翻译12、转换附件11、实际binary上传1、备份1及增强六层只读PITR1均按原始证据分层；源码与证据独审APPROVE，本地替身不冒公司账号或生产验收。

当前SDK02307e65七入口/Vditor93/只读stamp通过；严格gzip9 Element458035≤475000 B、UMD471322≤480000 B；同基线Node22.22.2/darwin/x64/2000seed42/30-20-10/20%七项性能PASS。当前Chrome六cell/nativeESM父矩阵25PASS/18BLOCKED/0FAIL保留BLOCKED和exit1；原P0fixture真实FAIL也保留，另同demo/配置/1700×1000 Chromium新旧SDK成对DOM逐字相同28044字符。原生Safari当前新SDK六功能已通过（先3、新增2、最后1；最终1新执行/5有界复用），前两轮FAIL及原上下文保留；输入150s、DOM45s/每轮12min与原断言保持，不宣Safari性能，真实触控与公司/生产条件仍外阻；完整清单不代签。

### 前一断点历史记录（以下不作当前通过或阻断结论）

上述框保留完整审阅条件；当前状态应结合tasks.md逐项核对与真实原始case。已核当前独立PG62/62、HTTP/PG14/14、实际三进程/mTLS/双浏览器40/40，后端982项中961pass及6历史stock expected-red skip分开；不写126项全部未执行。前端按用户要求仅新跑当前受影响5文件83/83，原1970中的其余1887例由输入比对后复用，来源索引待最终汇总，不伪称重复全量新通过。

Element主制品474680 B≤475000 B是独立字节结果；性能`perf-verified`当前FAIL、新受影响复测、六cell UI及旧artifact stamp对应全制品构建仍在收口，不能由局部绿灯勾选T065/T066/T119–T122或本清单全部通过。Node14 core/contract/lint通过与Node14架构WebCrypto失败/Node22工具运行通过分别保留，不用库构建兼容外推所有工具运行时。已确认未受改动影响的旧结果复用，不为文档收口重复全量测试。

完整验收仍按105AC、8NFR、15FR、5SC和P01–P19分别核定：真实IdP/授权事件源/Java/目录/内部翻译/格式转换/对象代理、批准容量/唯一主/复制/HA/PITR、macOS Safari/触控硬件及生产责任/许可/保留审批分列BLOCKED；既有本地实现和仍可本地推进的验证/制品工作不能被这些外部门整体掩盖。F6缺内部成功链仍阻首发，未获批准不commit/push/npm发布/部署。

### 当前完整验收边界

项目内部服务v1生产适配已实现并本机实测，真实公司IdP/Java/目录/翻译/对象/转换器的实际端点、凭据、账号与对端实现仍未供给。T059/T120生产执行编排还缺独立控制面、旧主/旧writer fence及不可回退generation事实，不能仅把代码未开发改称验收缺失，也不以本地只读PITR的0writable冒唯一可写主。完整故事/故障许可、真实触控和正式生产审阅继续按各原任务保留，不提交、推送、发布或部署。
