# Implementation Plan: 独立完整编辑器后端

> **当前阅读入口（2026-11-08）**：用户已授权原任务所有可本地部分持续开发，人员由用户统筹；外部供给与生产批准另列，不因部分AC阻塞停止无依赖的本地开发。后端为同级非Git目录 `apps/lark-doc-backend`，前端为原dirty `apps/lark-doc`，不替换checkout。已实现真实PG、双用户HTTP/WS/SSE、原Y.Doc恢复、计算Worker、独立API/collab/Worker与HTTPS/mTLS owner链、020角色隔离及107节点离线准备；范围和最终来源见[research §8](research.md#8-当前本地运行与交付证据)及本文件末追溯矩阵。下方2026-11-06/07准备记录是历史，不再是当前禁PG/禁实现命令，也不构成生产放行。未commit/push/发布/部署。

**文档起始日期**：2026-11-06。原T项按各自完整条件判定，不能因部分本地闭环批量勾选，也不能因历史未勾推断未实现。配套[spec](spec.md)、[tasks](tasks.md)、[constitution](../../.specify/memory/constitution.md)。

## Summary

依据最新[高层](../../.workbuddy/output/高层架构设计.md)、[系统](../../.workbuddy/output/系统设计.md)、[故事](../../.workbuddy/output/UserStory.md)同步旧003。完整文档域统一TypeScript/Node.js、NestJS＋FastifyAdapter API、独立Hocuspocus与同语言Worker，模块化单体起步。Java业务域独立，不共享表/逐帧代理/正文双主，仅版本化API/事件和不可变版本引用。全部内部自部署，不擅定实例数、托管替代或引入Redis/broker/K8s。

旧Node硬约束/框架仅推荐及5故事/48任务已失效：现方向来自单语言偏好与IC-01授权专业选择；不虚构用户亲选版本。旧专家人工Gate不成为本地开发前置，也不冒称用户点击通过。既有PoC、PG和浏览器结果按各自范围使用，不迁成整批生产成功。

## Technical Context

- 前端保持原JS/DOM、Vue2/Webpack与Node14应用构建；库/其他checkout原Rollup工具链不改。当前测试工具按已锁Node22要求执行，不能混称应用升级。
- 后端Node22.13.0/npm8.19.4，engines Node>=22.13<23/npm>=8.19.4<9；Nest三件套11.2.8、Fastify5.12.7及定向override、Hocuspocus4.7.1、Yjs13.6.33、pg8.16.3及107锁节点。BOM/原归档SRI/SBOM和离线冷安装见research §8；生产支持窗口、内网源、许可及安全批准未完成，不照抄滚动master。
- 自运维PG二进制update/snapshot/领域数据/outbox；房间active/passive单writer是待验证目标，DB唯一主/复制确认/故障域独立设计。S3兼容/身份/翻译优先核实现有内部供给，未供给BLOCKED；不默认选对象产品。
- 测试已有模型/注入端口、真实线程/HTTPS、独占PG及多OS进程双Chromium证据；各层不互代。原生Safari27六单元已验证（三新执行、三同源制品复用）；故障、硬件触控、真实外部服务及生产容量分别保留缺口，2000块fixture非容量批准，历史2703不能代新测试。
- 当前gzip门为Element≤475000 B、ESM主≤285000 B、用户已批准UMD主≤480000 B、CJS≤2500000 B；其余原门及可比性能退化>20%失败规则未改。真实Safari/Chromium/硬件触控分证，连接撤权5秒仍不是提交宽限。实际值及原始来源见[research §8.4](research.md#84-2026-11-08最终证据)。

## 当前交付追溯矩阵（T124）

本节是原需求到实现、可执行case和外部门的索引，不是整项PASS。完整126任务/105AC总状态由[tasks](tasks.md)及[requirements](checklists/requirements.md)维护；原始结果和来源见[research §8](research.md#8-当前本地运行与交付证据)。后端路径前缀 `backend/` 映射 `/Users/cjjxw/codex/tiptap-integration-demos/apps/lark-doc-backend`；前端路径映射同级 `lark-doc`，不凭任务旧文件名推断未实现。

### 15项功能

| FR / 故事 | 原任务与实际实现入口 | 已有case / 仍需验收 |
| --- | --- | --- |
| FR-01 / US1 资源绑定 | T019–T024；008、`modules/resources/pg-resources.ts`、HTTP/资源provider | domains三元唯一/来源revision/解绑保独立grant及browser资源回读；真实并发和确认丢失须对应专项，Java业务归属仍待真实供给 |
| FR-02 / US2 当前身份/授权 | T025–T031；007/009/012/018/020、`durable-runtime`、授权provider | sessions当前Cookie/CSRF/禁用、domains private/票据/gap、browser空闲WS/SSE补偿；真实IdP/注销事件源及所有外部读面未验 |
| FR-03 / US3 持久正文 | T032–T040；004/006/010、`pg-commit-port`、owner、原DocumentSession及durable桥显式pending快照接纳 | 逐update receipt、唯一seed、快照+tail/损坏、重启、丢ACK原键查询；AC-03-Q宿主刷新包仅原QUERY对账，入场/真实reload证据须当前回归；kill-9/复制丢失等不能由正常重启替代 |
| FR-04 / US4 评论/锚点 | T068–T073；014、`pg-comments`、原commentsMixin/anchor | domains动作/private/CAS与browser真实面板、旧确认/孤立锚点；全部并发读面须逐AC核，外部对象private面仍缺供给 |
| FR-05 / US5 关注/链接 | T074–T078；015、`pg-follows`、provider/session | read-only follow/mute、原操作与link当前复权/重启；关注不授权，撤权竞争与确认丢失不能只引顺序case |
| FR-06 / US6 内部翻译 | T079–T083；`modules/translations/service.ts`、翻译provider | 当前权限和依赖缺失blocked负例；无内部翻译成功链，F6继续阻完整首发，不造译文或持久任务 |
| FR-07 / US7 不可变版本 | T041–T046；011、`pg-versions/content`、Worker、owner capture | A冻结后B、真实PM/两hash/来源CAS、版本读取019再准入、审批引用；真实Java审批联调未验 |
| FR-08 / US8 在线恢复 | T047–T054；013、`collab/restore`、owner队列及epoch桥 | A→B→A、pre/post/receipt、新epoch、旧pending隔离、首次入房与真实行锁；显式恢复包在HELLO前核原scope，旧epoch/异主体不接baseline且可再导出，无自动存储/重发/换epoch；完整故障/P09仍未验 |
| FR-09 / US9 通知/SSE | T084–T090；016、Worker、`pg-notifications/sse`、原通知投影 | 真实Worker/PG/HTTP SSE、cursor/去重/当前private、gap控制清缓存；不承诺外部邮件送达或所有崩溃/乱序已验 |
| FR-10 / US10 双域集成 | T091–T097；017、`pg-integration`、独立service HTTP | 合成service实际HTTP/PG同hash/异hash/gap/resync、真实不可变审批引用；无公司Java信任/对端，不称双库原子 |
| FR-11 / US11 mention/分享 | T098–T102；`modules/mentions/service.ts`、权限来源、授权provider | 当前分享来源持久且解绑不误撤，目录缺供给明确blocked；无假候选人员或自动private授权 |
| FR-12 / US12 diff/导入导出 | T103–T108；`conversion/service/diff`、Worker及版本provider | 两不可变版本真实结构/文本/marks/attrs diff；格式/转换/对象未供给，导入/导出实际文件仍blocked |
| FR-13 / US13 附件/媒体 | T109–T114；`modules/assets`、原媒体/上传配置 | 当前准入、Range声明及无对象不发字节；真实size/mime/hash完成校验、共享引用、下载/分块撤权未验，未造ready/URL |
| FR-14 / US14 运维/可靠性 | T055–T061；012/020、`ops/health/metrics/recovery`、三个进程入口 | role ready/raw drain/绝对期限、正常SIGTERM、只读恢复preflight；唯一主/旧主fence/PITR/HA/值守批准未完成 |
| FR-15 / US15 原体验/证据 | T062–T067；原UI/构建、`production-evidence`、browser matrix/perf | 七入口/Vditor93与当前预算、原性能门7/7、原生Safari6已证；最终UI索引36PASS/7BLOCKED，硬件触控/完整AC仍未齐 |

### 8项非功能与5项成功准则

| ID | 对应实现 / case入口 | 当前边界与完成门 |
| --- | --- | --- |
| NFR-01 | DocumentSession/durable桥、原UI；browser pending/unknown/恢复隔离/private清投影 | 保留原键/焦点/键盘和orphaned语义；完整原生模式/可访问性矩阵仍独立验 |
| NFR-02 | candidate-executor、PG有限事务；原2000块/perf/Element预算工具 | 单slot/10秒只是本机技术防护；gc:false增长、历史重放/WAL/积压、生产容量和批准SLO未完成 |
| NFR-03 | runtime pin、107归档inventory/SBOM、离线ci、真实Chromium和原生Safari27六单元 | 本地离线冷HTTP不等全业务断外网；内网registry与硬件触控待验，不更换前端工具链 |
| NFR-04 | 007/009/012/018/020、mTLS owner、Origin/CSRF/private谓词 | unit TLS/PG ACL/浏览器负例有独立层次；真实issuer/audience/服务证书运营、外部读面和安全批准未完成 |
| NFR-05 | COMMIT gate、原Y.Doc、seq/receipt/CAS、实时lease及恢复A | 核心正常链与选定竞争有case；P09、防双主、灾难已receipt保留不能由房间token或正常重启证明 |
| NFR-06 | operations/outbox/inbox、016 Worker/feed/cursor、017 aggregate gap | 当前事件/物化/查询持久化及去重；外部至少一次副作用/消费者对账和真实Java流待验，非exactly-once |
| NFR-07 | 资源独立来源、软删评论、receipt/版本保留、blocked对象端口 | 无策略不物理删；分类型期限、引用hold、备份过期/容量批准未供给，不承诺永久保留 |
| NFR-08 | spec-kit依赖、唯一证据、ops说明、BOM | 本地责任由用户统筹；正式Owner/替补/DBA安全值守、故障/发布批准与F6成功链仍为生产门 |
| SC-01 | 本矩阵＋tasks的126/105AC索引＋evidence源指纹 | 可追溯不等全PASS；缺失、失败、中间来源与外部门显式保留 |
| SC-02 | seed/update/epoch/token/private负例及真实PG/WS case | 只对已执行样本报告断言；未批准故障模型不能宣灾难RPO=0或全域越权零风险 |
| SC-03 | 011/013/017与版本/恢复/审批case | 样本核versionId/contentHash/sourceRevision、不可变原文、pre/post与旧pending；公司审批样本100%目标仍待真实对端 |
| SC-04 | 下表P01–P19及原任务依赖 | 首发P01–P18与所用对象面逐项达标才放行；P19增强另验，F6缺供给仍阻整批 |
| SC-05 | 原构建/perf/matrix及当前前后端制品指纹 | Element体积、原20%性能、Chromium/Safari/触控分别判定；历史2703/E0不代E1–E4 |

### P01–P19验证入口

| P | 本地实现与已有case入口 | 明确保留的未验证边界 |
| --- | --- | --- |
| P01 | `durable-runtime`受控消息门/原Y.Doc提交；ingress PoC、实际WS非法stock sync拒绝 | 6个历史stock expected-red默认skip不能算目标通过；所有未来direct/插件入口仍须同门 |
| P02 | 003/004唯一seed、domains及browser seed重复/冲突 | 真并发首访与空initialized旧草稿须各有case，不能拿顺序重试代并发 |
| P03 | commit-port/owner、注入COMMIT未知、browser丢ACK/原键查询、TLS丢响应单测 | 客户端消费丢ACK不等kernel网络故障；kill-9、DB半失败及所有断点未全验 |
| P04 | 010/pg-snapshots、domains snapshot+tail/竞态/损坏、PG重启 | 未做物理损坏/备份恢复；未批准日志清理，receipt不删 |
| P05 | 013候选A、pg-restores、双用户在线恢复及旧操作重放 | 不以旧update合并/JSON重建替恢复；完整双恢复/seed竞争须真实同时在途 |
| P06 | collab/restore/anchors、PoC及browser格式/历史身份/orphaned | 未覆盖的自定义嵌套块/原生模式不能由单样本泛化 |
| P07 | epoch握手、provider受控桥、browser旧pending导出/首次入房 | 旧SyncStep2不能偷上传；未知协议和跨恢复队列需独立覆盖 |
| P08 | 004/006/012/016、真实lease/terminal/Worker测试及role ready | 正常同owner重启不是旧writer暂停复活或跨机HA；所有故障/锁等待须按原门验 |
| P09 | `ops/recovery`只读外部许可/代际边界及blocked负例 | DB切主/网络分区/复制确认/旧主恢复/PITR一律未批准、非通过 |
| P10 | permissions/comments/follows/notifications/current对象边界，domains＋双账号browser | 真外部翻译/对象/导出所有private面缺供给；manager无豁免 |
| P11 | 共锁、空闲WS current检查、SSE gap控制、sessions与跨runtime HTTP case | 5秒仅本地健康目标；外部授权意图到达前不称全球即时，真实对象流待验 |
| P12 | 008/017资源与actor幂等、独立grant/审批引用，domains/browser | 并发create/解绑vs授权、实际资源确认丢失及联合重启回读须各自证据 |
| P13 | 016/017 worker/event fencing、Inbox异hash/gap/resync、独立Worker CLI | 外部发送回执/邮件、恶意旧主及全部崩溃断点未验，至少一次仍须业务幂等 |
| P14 | 受限cursor/feed、真实SSE旧字节迟到/重取、当前private与gap清缓存 | 精确断流回放/多worker提交序按实际case判断，不由SSE连接成功推定无漏 |
| P15 | 不可变版本/017审批引用，browser冻结A后B与恢复 | 真实Java绑定超时/回执及版本对象回读未供给 |
| P16 | 翻译当前复权与DEPENDENCY_BLOCKED负例 | 无内部翻译成功/返回源改删/撤权结果链，F6仍阻首发 |
| P17 | assets准入/Range/无策略拒清理及blocked负例 | 无真实内部对象上传完成、hash/mime/size、部分失败/孤儿、private块与共享引用验收 |
| P18 | 107归档SRI/离线ci/SBOM、真实正常进程重启、当前预算/原性能门及Safari6 | 不等内网安装、完整断网业务、PITR/对象身份恢复、生产发布回退、硬件触控或容量批准 |
| P19 | 真实版本diff/分享、目录/格式/对象的明确blocked入口及原前端保留 | mention真实目录/通知、实际格式导入导出/下载/媒体成功链未供给，不删前端代验 |

## Constitution Check

| 原则 | 必须保留的门 | 当前状态 |
|---|---|---|
| C-I | DOM/入口/非协同及Java双域边界 | 本地原UI/独立服务身份接线；真实Java对端未验收 |
| C-II | Element475000 B、其余SDK当前门、原>20%、真实Safari/触控 | 制品门与原性能7/7、Safari6已证；UI索引仍BLOCKED，硬件触控/完整AC另留 |
| C-III | 当前授权锁/有限发送准入、receipt/水位/恢复身份 | 已有真实PG/WS与候选A局部证据；灾难故障/全部AC未齐 |
| C-IV | 先失败测试、E0–E4、105AC/8NFR追踪 | 本地各层证据及末尾矩阵；完整AC索引/外部门不机械PASS |
| C-V | TS维护责任、全自部署、writer与DB分层隔离 | 用户统筹本地责任；独立角色进程已接，真实供给/DB防双主待验 |

宪章2.0.0草案未批准；静态对齐不等人工审阅或生产放行。

## Project Structure与路径准入

以下L001/L002路径树、授权和scripts是2026-11-06起步时的历史记录，不是当前完整目录或执行限制。当前同级业务目录、运行契约及最终证据以[research §8](research.md#8-当前本地运行与交付证据)为准；不据旧拟议路径创建替代目录。

### 最新裁决：本地开发与生产准入分离

**2026-11-06追加裁决**：用户明确“跟实际负责人没有关系，我来安排就行，你继续按照顺序执行任务 可以开启多agent执行任务”。人员组织、替补与专业分工由用户统筹，不再要求提供个人/团队标识作为本地开发前置，也不重复询问。T001的本地路径与维护责任准入已满足，可继续T002及后续技术决策准备；原T001生产交接要求另留待上线前落实，不虚称实名清单已提供。此裁决不豁免技术正确性、测试先行或生产安全，不自动授权真实数据库连接、故障注入、部署、Git初始化/提交/推送。后续技术任务按实际依赖拆分开发可做部分与真实集成/生产验收部分，不用人员门阻断全部开发，也不冒称完整T项已通过。

用户于2026-11-06明确选择“拆开并继续本地开发（推荐）”。此裁决覆盖下文历史“一切实现须先满足T001–T006”的限制，仅放行隔离本地代码与针对性测试；用户为本地开发责任人。`backend/`现映射至`/Users/cjjxw/codex/tiptap-integration-demos/apps/lark-doc-backend/`，前端仍使用dev工作树。生产Owner/替补、容量、内部供给、安全审阅和P01–P19真实验证门均不豁免。

L001已完成无外部依赖的原生ESM `.mjs`本地启动边界与7/7针对性node:test测试，属于历史准备阶段；当时“不安装依赖”仅为L001授权限制。L002已完成正式TS/Nest＋FastifyAdapter API、独立collab/Worker本地边界和8/8正式TS测试，当前npm test使用编译后的TS测试而非旧mjs。API仅提供存活/未就绪响应，collab/Worker不开放协同或处理真实任务；两项均不等于T003生产BOM或T007真实TS/PG环境完成，不冻结Node生产版本。

L002现行授权仅允许独立后端从`https://registry.npmjs.org`安装固定本地依赖及传递树、生成锁文件、typecheck/build/针对性本地测试，不修改全局npm源；后续本地补丁依用户已授自主决策范围执行。无DB连接、真实PoC/故障注入、Git初始化/提交/推送或部署授权，生产制品仍须内部供给及审阅。下文原生产开工限制不否定L001/L002已获授权的本地完成事实。

用户于2026-11-06确认采用**独立后端仓库**，并确认**已有团队或负责人**；用户随后指定本地位置为“lark-doc现有项目同级”，因此目标父目录为`/Users/cjjxw/codex/tiptap-integration-demos/apps/`，不是dev工作树内部。用户已确认项目名`lark-doc-backend`，目标路径为`/Users/cjjxw/codex/tiptap-integration-demos/apps/lark-doc-backend`；并选择“由我负责并补充分工”，登记用户为技术责任人，不虚构姓名。用户随后明确选择“我兼任长期维护负责人”，确认兼任TypeScript/Node.js编辑器后端长期维护Owner；远端地址、替补及Java/DBA/平台/安全具体分工与访问范围尚未提供。长期维护Owner确认不等于所有专业角色已落实。已依L001/L002授权创建本地代码目录并完成固定本地依赖安装与正式TS边界，未初始化Git或创建远端。T001的生产责任部分仍未完成。下文`backend/`为统一逻辑路径前缀，映射上述独立后端目录；独立后端文件相对此目录解析，前端文件仍相对dev工作树解析。公共源本地安装授权不等于生产源批准，不放行数据库连接或真实PoC。

```text
specs/003-production-collaboration/{spec,plan,research,data-model,tasks}.md
specs/003-production-collaboration/contracts/backend-api.md
specs/003-production-collaboration/checklists/requirements.md
backend/{package.json,package-lock.json,tsconfig.json,.gitignore} # L002现存
backend/src/{main,app.module,config}.ts                          # L002现存
backend/src/ops/health.controller.ts                            # L002现存
backend/src/{collab,worker}/main.ts                             # L002现存
backend/test/boundaries.test.ts                                 # L002现存
backend/src/{config,api,collab,worker}.mjs                        # L001历史保留
backend/test/boundaries.test.mjs                                # 非当前npm test入口
backend/src/common/{identity,authorization,admission,idempotency,audit,errors}.ts # 以下仍拟议
backend/src/modules/{resources,permissions,comments,follows,translations,versions,restores,notifications,integration,mentions,conversion,assets}/
backend/src/collab/{ingress,room-coordinator,persistence,seed,snapshots,restore,protocol}.ts
backend/src/db/{migrations/,commit-authority.ts}
backend/src/worker/{outbox,leases}.ts
backend/src/ops/{health,metrics,recovery}.ts
backend/test/{contract,integration,fault,browser,poc}/
backend/ops/{deployment,security,recovery,release,capacity,supply-chain}.md
backend/test/evidence/                                         # 未来新证据，非当前结果
```

当前package scripts：`typecheck`＝`tsc --noEmit`；`build`＝`tsc`；`test`＝`npm run build && node --test dist/test/boundaries.test.js dist/test/protocol-integer.test.js`；`start:api`、`start:collab`、`start:worker`分别执行`dist/src/main.js`、`dist/src/collab/main.js`、`dist/src/worker/main.js`，不再执行旧mjs。旧mjs文件保留作历史边界，不能将L001 7/7替代L002正式TS 8/8证据。

前端任务使用根相对实际现有路径：`src/session/DocumentSession.js`、`src/collab/{index,policies,anchors,protocol}.js`、`src/providers/{authorization,collaboration,persistence,comments,versioning,notifications}.js`、`src/core/comments/{thread,anchor}.js`、`src/core/versioning/{restore,snapshot,diff}.js`、`src/components/lark-doc/editor/{collabMixin,commentsMixin,versioningMixin}.js`、`src/ui/{panels,notifications}.js`、`test/{unit,collab}/`、`scripts/check-rollup-artifacts.mjs`、`scripts/perf/`、`perf/baseline.json`。新增测试仅拟议，不称已存在；实际编辑前另读源码，若路径差异先同步计划，不盲建替代源码。

## Blocking Decisions与责任/证据门

| 门 | 必须落实的输入和证据 | 责任角色（实名待定） | 阻塞范围 |
|---|---|---|---|
| B01 | 同级目录、本地责任及用户兼任TS长期Owner已确认；远端、替补、Java/DBA/平台/安全责任待补 | 需求/技术负责人 | 生产/真实集成及未获授权范围；不阻L001/L002已批准本地完成 |
| B02 | L002最小本地BOM/安装/锁文件/复验已完成；生产支持交集、固定制品/内网源、许可及SBOM仍待审 | 后端Owner/安全 | 生产制品与真实PoC/集成；不否定已授权公共源本地安装 |
| B03 | 全入口候选隔离→commit→原活动Y.Doc应用→广播/receipt线序；失败隔离 | 后端/前端Owner | 正文/版本承诺 |
| B04 | 恢复候选A/B、CRDT身份/锚点/gc:false、旧pending屏障 | 协同Owner | 恢复；B改变在线要求另批 |
| B05 | documents/主体锁与revoke、有限FOR SHARE发送准入、授权源缺口 | 安全/身份Owner | 身份/授权/敏感交付 |
| B06 | writer实时钟/token、DB防脑裂/复制确认、外部恢复代际、deadline | DBA/平台/协同Owner | HA/故障模型及生产承诺 |
| B07 | 身份/翻译/对象/Java接口内部供给、凭证与服务责任 | 对应依赖Owner | 相关实现；F6缺失阻整批 |
| B08 | 容量/故障域/SLO/RPO/RTO/保留/备份、共享引用清理策略 | 产品/DBA/平台/安全 | 生产容量与物理清理批准 |
| B09 | 部署/安全详细设计、断网/恢复/发布/值守及真实测试授权 | 平台/安全/技术负责人 | 演练及生产放行 |

未知值记录待确认/责任角色/所需证据/受阻任务，不填假姓名/资源量/SLA；不得用Compose或单WS偷换生产目标。L001/L002隔离本地代码、固定依赖安装及针对性测试已获授权并完成；**真实PG及P01–P19 PoC均未运行验收**。T001–T006生产/真实集成决策仍待落实，T007及后续真实安装环境、PoC、业务实现、演练须满足前置门并另获范围明确授权。

## 历史准备项执行记录（2026-11-06）

用户已要求“继续按照顺序执行任务 可以开启多agent执行任务”，此前亦明确允许合理启动多agent开发，并指定后端与现有lark-doc同级。这是开发推进授权，不再沿用“仅制定任务”的旧表述；但不自动补齐T001责任、T002生产输入或T003–T006供给/审阅/执行范围。以下记录将已确认决定与待提供事实分开，不代表T001–T006全部完成，不授权部署、远端创建、提交推送或故障注入；T007仍须满足任务的实际前置条件。

| 准备项 | 已确认事实 / 当前可整理内容 | 仍需实际提供或批准 | 完成判据 |
|---|---|---|---|
| T001 仓库与责任 | 独立编辑器后端仓库；已有维护团队或负责人；同级父目录已确认为`/Users/cjjxw/codex/tiptap-integration-demos/apps/`；`backend/`仅为逻辑前缀 | 项目名及目标路径已确认；用户为技术责任人。用户已明确确认兼任TypeScript/Node.js编辑器后端长期维护Owner，并在剩余责任分工确认中选择“已有人员或团队安排”；目前仅确认安排存在，替补及Java/DBA/平台/安全的可识别标识、具体分工与访问范围尚未提供。远端地址不阻塞纯本地准备，但创建/推送另批 | 路径映射与责任经确认并同步plan/tasks；此前不勾选 |
| T002 容量与恢复 | 输入清单见下表；不以编辑器fixture推导生产容量 | 产品/运维实际量级、故障假设、SLO/RPO/RTO、复制与保留批准 | 责任方确认目标及测量方法；未知数不得以推荐默认值填充 |
| T003 BOM | 既有客户端版本仅为兼容验证基线；L002正式本地BOM、78节点锁树及5.12.7复验已有证据，见research §3.3 | 生产Node/PG及完整支持交集、内网制品来源、许可证/SBOM与补丁责任复核；adapter定向override仍需生产BOM审阅 | 本地完成不等完整T003；生产每个精确版本须有可追溯来源、兼容与审阅结论 |
| T004 内部依赖 | 仅内部自部署供给；翻译缺失继续阻塞当前整批 | 身份/Java集成/对象/翻译的供给方、协议、测试入口及凭证准入方式 | 供给方确认可用范围与验收条件；不在文档保存凭证 |
| T005 设计审阅 | 现有系统设计、模型、契约供审阅使用 | 安全/平台/DBA审阅及部署方案、细Schema、保留策略的裁决 | 审阅意见闭环；文档静态检查不代签安全或部署批准 |
| T006 PoC计划 | P01–P19已有验证矩阵；全部未执行 | 隔离环境、数据边界、安装/故障注入许可、执行及停止责任 | 计划获批且另获明确执行授权，方可准备T007环境 |

### T002：容量、故障与保留输入表

#### 开发决策与生产验收拆分

开发先沿用既定TS工具链、模块化单体与独立API/collab/Worker边界；协议序号使用非负规范十进制字符串，按精确整数语义比较，不经Number转换。纯值校验可在不连接HTTP/WS/DB、不实施授权或提交的离线范围先行开发。恢复算法、广播屏障、授权锁和持久化能力仍依赖真实PoC，纯函数通过不能替代这些结果。

容量采用参数化模型而非生产默认数：更新存储量按各文档更新率×实际二进制大小×保留窗口累加，另计索引/receipt/outbox/快照与复制开销；房间内存按活动文档实测Y.Doc、候选副本、连接与有界排队成本累加，必须包含热点分布。尚无测量前不据此给出机器数量或吞吐承诺。恢复测量从故障导致能力不可用起，到事实重放、代际/授权复核完成且可正确读写为止；仅监听端口恢复不算恢复成功，数据损失以已确认receipt对应事实核验。

当前固定的是测量方法和保守语义，不是容量/生产SLO/RPO/RTO实值。缺少生产限额/deadline时不得启用相关真实能力；离线单测fixture只供分支覆盖，不成为生产配置。保留策略未批准不执行自动物理删除，也不承诺永久保留。

**准备状态**：按最新裁决，T001本地开发准入已满足，现进入T002技术决策准备；以下输入尚未成为经批准的生产容量/恢复目标，不表示T002完整验收完成。先采集现有业务/运维记录，再由对应责任方批准目标；没有实际数据时保持待定。测试中的2000块文档及回环HTTP结果不得换算为生产容量。

**采集口径**：规模数据需注明统计时间窗口、来源、峰值而非仅平均值，并分清全局与单文档并发；正文/附件大小和增量频率需保留分布及热点，不能只取单一样本。恢复目标按故障类型分别记录可接受数据损失、恢复计时起止与验真方式；复制确认和保留策略须单独批准。此阶段不需要提供原始敏感文档、账号或凭证，不执行压测、真实DB连接或故障演练。

| 输入组 | 需采集的实际信息 | 责任角色（具体标识待补） | 未确认时的限制 |
|---|---|---|---|
| 使用规模 | 总用户、活跃用户、峰值在线连接、同时编辑文档数、每文档并发与热点分布 | 产品/业务/运维 | 不冻结API、协同进程数量或吞吐承诺 |
| 文档与增量 | 文档数量、正文大小分布、update大小/频率、历史增长、快照与版本保留需求 | 产品/后端/DBA | 不定数据库容量、压缩周期或历史清理参数 |
| 附件及导入导出 | 对象数量与大小分布、峰值传输、单次导入导出范围、内部对象能力 | 产品/对象平台 | 不定对象配额、分块大小或导出并发 |
| 故障模型 | 进程、机器、网络分区、存储、数据库切主及机房故障分别是否覆盖 | 平台/DBA/安全 | 不默认接受单机停机，不把房间接管说成DB高可用 |
| 恢复目标 | 各故障模型的RPO/RTO、durable确认对应复制保证、恢复验真步骤 | 业务/DBA/平台 | 不承诺零丢失或具体恢复时间 |
| 服务目标 | 保存、评论、连接、通知的可用性及延迟目标、统计窗口和排除项 | 业务/产品/运维 | 不设假SLA；5秒连接传播仍仅候选待测目标 |
| 保留与删除 | 正文、版本、审批引用、对象、审计、备份的分类型保留与清理责任 | 业务/安全/合规/DBA | 策略获批前禁止自动物理清除，不承诺永久保留 |

#### 最小本地PG环境验证（2026-11-06，非T007完整验收）

用户在收到最小隔离测试范围说明后要求继续，现按该本地范围推进；不扩展到业务数据库、故障注入、复制/切主/PITR、部署或提交推送。使用本机已有PostgreSQL 17.11 Homebrew，无新依赖安装；实际测试Node为22.22.2，不以另一可执行文件的24.19.0替代本次版本证据。

新增`backend/test/postgres-isolated-preflight.mjs`，通过显式命令运行，不接入默认`npm test`。脚本仅创建独立集群，清除继承的PG环境变量，显式指定自有data/socket/user/database；目录0700、local peer/host reject，`listen_addresses`为空，不监听TCP。配置核验与认证规则读取均来自该自建实例。仅两条合成提交记录，新连接验证提交结果及后续更新/删除/插入回滚。

主助手已直接读取执行输出：脚本PASS、stderr空；正常SIGTERM smart shutdown后进程退出0、signal null，postmaster.pid/socket/lock均不存在，日志确认干净关闭。证据在`backend/.workbuddy/postgres-preflight-chYQqA/evidence.json`，数据目录留存；自有空socket目录`/private/tmp/wbpg-uK64Eb`留存，未删除。未操作现存数据库或全局服务配置。

证据版本说明：首次正常路径PASS来自主助手读取的原始执行输出`jpC5BL`。作者正式回传、主助手读取JSON确认：execPath及execPathEvidence是运行后补记，路径以运行前后命令佐证，不是首次执行现场采集；原PG参数/结果/关闭字段未改。脚本随后增加process.execPath采集，并修正spawn error的serverExit提前拒绝问题；事后修改仅有语法检查通过，尚未重跑PG，不能据首次运行宣称最终错误路径已验证。首次证据现已冻结。

这只是单实例环境隔离与最小事务可用性证据，不证明重启后重放、CRDT持久化、receipt、容量、HA或生产支持交集；initdb自动选择的连接数/缓存等仅本次工具默认，不是生产批准参数。本地数据页校验未开启，不能据此声称已覆盖存储损坏检测。T002生产实值及T007完整前置/验收保持待定。

官方依据：[peer认证](https://www.postgresql.org/docs/17/auth-peer.html)、[连接与socket配置](https://www.postgresql.org/docs/17/runtime-config-connection.html)。

#### 合成Yjs字节保存/正常重启重放实验（2026-11-06）

新增`backend/test/yjs-postgres-replay.mjs`，仅显式运行，不接入默认单测。主助手已读取完整脚本及真实执行输出`LmDw99`：PASS、stderr空；现场Node22.22.2路径与PG17.11真实路径记录在`backend/.workbuddy/yjs-postgres-replay-reV1oK/evidence.json`。数据及空socket目录保留，实例已正常关闭。

单客户端`Y.Doc({gc:false})`合成嵌套Map/Array/Text，8个插入/格式化/删除事务捕获真实updates共700字节，水位4完整快照396字节；所有updates和快照在一个显式BEGIN/COMMIT事务保存为bytea及SHA256（不是每个更新各自独立提交）。销毁原文档后，新文档全量连续重放、快照加后续增量重放均与预期规范内容（含Text格式）、state vector及完整binary state hash一致；同data正常关闭后重启，重新读取及两条重放路径再次一致。重复apply不改变结果，仅证明Yjs样本幂等，不是业务操作幂等。

实验加载器基于独立保留在进程内的原始manifest，验证预期seq/长度及逐字节/hash一致；缺中间/末尾seq、重复、乱序、payload/hash篡改（包括同时篡改）、空集和快照hash篡改共9类输入副本被拒绝。此处对同时篡改的检测依赖可信原始manifest，不证明真实重启进程无需外部锚定即可识别数据库内自洽篡改，也不是生产加载器实现。正常重启的是数据库，重放时进程仍保留实验manifest；不冒称完整应用进程恢复。

两次启动均禁TCP、local peer/host reject，fsync/full_page_writes/synchronous_commit核验on；两次正常SIGTERM关闭退出0、pid/socket/lock释放。不包含crash、复制/切主/PITR、Hocuspocus全入口、durable receipt、业务版本恢复、容量/RPO/HA或T008/T009验收。生产表/迁移未创建；实验seq使用小整数仅限8条fixture，不替代协议大整数规范。

#### T002测量执行规范（设计准备完成，容量及故障恢复测量未运行）

本节固定未来采集与验收的口径，不创建容量服务、不执行负载或故障，不把以下字段解释为已经有数据。离线D001已完成，不能填补本节真实证据。

**每次记录的公共字段**：记录标识、环境/精确工件及配置标识、统计窗口及时区、样本数量/缺失数量、作用域（全局/租户/文档）、指标名称/单位/聚合方式、来源位置、采集方式、故障模型及批准范围。证据来源单独标为`synthetic`（构造样本）、`estimated`（带输入和假设的推算）、`observed`（实际测量）；实际观测也须注明测试环境，不自动成为生产观测。不得保存正文、private评论、token或真实凭证。

| 测量面 | 采样与计算方法 | 必须同时记录的边界 |
|---|---|---|
| 更新及历史存储 | 按文档类型/热点分层采集实际update bytes、每秒更新率、窗口内数量，保留分布与最大值；按各层求和计算有效载荷增长 | receipt、operation、outbox、索引、WAL、快照、不可变版本、备份分别计量，不用单一膨胀系数冒充实测；复制份数与保留窗口未批则只保留参数表达式 |
| 活动内存 | 分别观测冷/热文档加载后的进程内存增量、活动Y.Doc及gc:false历史增长、候选构建峰值、并行命令、连接与队列峰值 | heap/RSS与共享运行时基线区分；候选峰值不可仅用稳态均值；有界队列限额待批，不能据空载测量声称内存安全 |
| 对象和转换 | 记录真实对象大小分布、同时上传/导出数、缓冲区及临时文件峰值、失败重试和孤儿对象 | pending/ready/引用/hold分开；对象、数据库及备份占用不混算；没有对象环境则标未运行 |
| 吞吐和延迟 | 记录并发连接/活动文档/单文档热点、尝试与成功/失败/拒绝/超时数量，并分别统计保存确认及可读写延迟分布 | 指明采样点和分位数算法；样本不足不外推高分位；不以HTTP存活、暂态广播或仅客户端发送成功代表durable保存 |

**恢复分层验真**：不同故障必须独立记录，不以一种故障的结果覆盖其他故障。进程/机器、网络分区、DB切主/复制、存储损坏和PITR分别列出实际覆盖、未覆盖及无法判定项；本节不授权其中任何执行。

1. 执行前记录可追溯的工件、配置、故障范围、停止/清理方案及批准记录；保存客户端实际收到的receipt标识及其tenant/doc、updateId、payload hash、epoch、seq、contentRevision。只记录发送但未收到确认的操作另列，不能算已确认，也不能擅自算未提交。
2. 时间点依次记录：能力实际不可用、故障观察、接管/恢复启动、DB可用、快照校验完成、连续重放完成、代际/授权及writer准入完成、端到端正确读写恢复。使用单调时钟测本地耗时；跨主机事件记录时钟来源及误差，无法确定先后则结论不确定。分别报告检测/接管/重放/整体耗时，不只报告端口监听。
3. 校验snapshot hash/state/watermark及直到last_seq的连续事实；验证已确认receipt能对应真实update、操作结果和正文效果，二进制state hash与规范化content hash各按自身语义核对，不能混用。缺口或损坏须fail closed；拒绝写入是安全行为证据，不是恢复可用性通过。
4. 房间恢复另验旧writer/token拒绝、当前epoch和授权复核、旧pending隔离；DB恢复另验唯一主、复制确认及外部恢复generation不随PITR倒退。版本恢复另依T009候选A/B及T010旧epoch握手证明，不用基础设施重启替代版本恢复PoC。
5. RPO按故障模型对应的已确认事实缺失集合与时间边界评估，不能只比较末尾seq或把seq差值换成秒；没有完整确认记录不能证明零丢失。RTO从故障造成目标能力不可用至连续验真后可正确读写恢复，故障起点不明时标不确定，不隐去检测时间。

**结果和批准规则**：执行状态分别为`not_run`、`completed`或`inconclusive`；目标比较结果分别为`threshold_unset`、`pass`、`fail`或`inconclusive`。两列独立：有观测而没有批准阈值只能是`completed + threshold_unset`；离线构造样本即使符合断言，也不能产生生产pass。只有覆盖指定故障模型、证据完整且满足已批准阈值时，才能判该项pass。任何关键安全不变量失败均单独记fail并阻塞相关能力，不因延迟达标抵消。

**保留与容量闭环**：正文增量/receipt、快照/不可变版本、评论、对象/临时转换、通知/outbox/inbox、审计、WAL/备份分别登记保留目的、起算事件、期限或触发条件、引用/hold、删除及备份过期影响、批准状态和验真证据。未批准的保留项不自动物理清理；也不能无限累积后仍宣称容量受控。若预测将突破预算，应阻塞相关上线或经批准限制新增写入，不能擅自删除受保护数据。

**下一顺序**：T002测量方案技术准备至此完成；生产输入/故障域/阈值/复制及保留批准仍待定，原T002保持未勾选。T003及真实PoC不因本节存在而获得生产裁决或执行许可；后续需明确批准测试环境与实际执行范围后采集观测，不能继续用新增离线模块替代缺失的真实验证。

当前已完成决定登记、输入清单、D001及L001–L003本地准备：T001本地开发准入已按用户统筹人员的裁决满足，生产交接另行落实；T002技术测量方法已整理，生产实值未冻结；T003仅最小本地BOM有证据；T002–T006生产/真实集成输入及审阅仍未齐备。原T001–T126全部未勾选；本地边界通过不等于真实PG、PoC、业务或生产验收。

## Phase 1: Setup

T001确认路径与本地责任，生产未知输入/容量/复制/保留与供给另列。按原依赖持续执行所有已授权可本地部分，不因一个阶段收口停止后续开发；生产及破坏性故障仍须明确批准，不把本地完成冒领原126项全部通过。

## Phase 2: Foundational

另获授权后准备隔离测试环境，测试在先；受控广播适配、恢复A/B、授权读写线性化、writer/DB分层PoC全部先于正式依赖实现。PoC不是生产实现或本次通过证据，失败BLOCKED，不默认为provisional回退、单WS降级或拒绝恢复即验收。

统一身份/tenant、错误/审计、幂等/outbox端口、有限发送准入和commit authority基础，不形成公开未授权正文端口。迁移约束逐字段遵[data-model](data-model.md)，API与Worker无直接写正文表权限。

## Phase 3+: Story Order与依赖

按P0 US1→US2→US3→US7→US8→US14→US15，再P1 US4→US5→US6→US9→US10，再P2 US11→US12→US13。P0 US14/15阶段先交付可独立验的运营/预算工具与基线，不冒称首批功能已全体验收；最终收尾任务汇合首发全部故事与US13所用对象边界重新执行全矩阵，避免依赖环和后置安全。

每故事独立测试使用隔离真实数据和依赖端口契约；替身只证明E1，不取消集成依赖及最终真实服务验收。实现故事的公开入口必须有共享授权与commit authority，后置增强不能破坏首发隔离。P2全部保留，US12最早使用真实对象导出时由T105先落内部对象最小受限写/完成校验/代理读取适配，不等US13后置也不以替身完成集成；US13实际对象/模式安全子集是首发收尾硬依赖。

## 核心设计不变量

- **正文**：统一命令串行，全部WS SyncStep2/update、seed/restore/direct/插件/Worker/跨实例注入均受控；API/Worker只提交命令。隔离候选算差异/检查，不替换原活动Y.Doc。锁文档→lease→操作，在READ COMMITTED锁后复权/epoch/token/实时租期；update/receipt/seq/revision/outbox结果同事务。commit后原活动应用/广播目标由B03证明；未知先查、污染内存隔离且禁版本。snapshot一致水位/CAS，缺口fail closed，不回空重seed。
- **授权**：documents FOR UPDATE与revoke共锁，身份禁用/注销共主体锁；事务内重读并持锁至commit。读/逐受众帧/SSE/翻译/外投/对象块按有限FOR SHARE短事务commit准入。已准入在途不追溯撤回，下一块重新鉴权。private统一谓词，全读面无manager豁免。授权源缺口禁止静默沿缓存。
- **租约**：锁后clock_timestamp()实时检查，末端复核，有限锁等待/语句/事务deadline；不能用事务起点now()。锁/token提交序为线性化点，租期墙钟不自动中断已持锁事务。token不复用，接管重放后ready；房间与DB防脑裂/PITR外部恢复代际分层。
- **恢复**：A显式恢复delta及B保留历史/暂停排空均待PoC；A→B→A真实嵌套内容/格式/hash/身份/锚点证明。B若改变同活动Y.Doc/在线要求须另批。pre/post/epoch/operation同事务；旧pending隔离导出，禁止自动换epoch/先合入新state。
- **生命周期**：资源三元键唯一与操作幂等；来源grant独立，解绑仅撤来源、共享引用/审批/对象可核；保留策略未批准不自动物理删。
- **事件**：业务/operation/outbox同事务，Worker租约/token，Inbox/hash与业务效果同本地事务。aggregateRevision/eventIndex检测乱序；private受众隐藏空洞不索要补发。每用户通知协调行产生提交序和受限游标，非自增分配序。审批绑定不可变versionId/contentHash/sourceRevision，双域部分失败待对账。

## Phase Final: Integration & Production Gates

首发汇合F1–F10/F14/F15与F13既有边界；F6真实内部翻译未通过整批BLOCKED。P01–P18逐项新E2/E3证据（含实际对象链P17）、固定工件/断外网、实际PG/PITR/对象/身份恢复、受控发布回退、原浏览器/预算及值守批准；SLO/故障域/复制未批不得声称HA/RPO达标。P19增强在所属批次独立验收，不删除前端；最终任务还回归全部15故事。没有本轮生产放行。

## Complexity Tracking

候选副本/gc:false历史、同步提交、有限授权交付、房间token/DB唯一主与跨域补偿均需真实测量，不能借“模块化单体”抹成本。本轮仅UMD主包上限由用户明确批准从465000 B调整为480000 B；Element/ESM/CJS及原20%性能门不改，没有获得浏览器、恢复B在线要求、跳过F6、资源保留/复制或可靠性豁免。任务详见[tasks](tasks.md)，不沿旧48编号进行实现。


## 2026-11-08 本地执行收口（覆盖早期未执行状态，不解除生产门）

已按既定依赖顺序完成当前可执行的本地代码，并在开发后统一回归：可信用户每事务映射共享PG池、实际双Vue2协作/精确receipt、完整重放与快照、不可变版本、候选A恢复、评论/private、关注、通知Worker/SSE与正常重启回读通过。新增30s原生票据续签、有界HTTP命令排队及真实PG最小ACL修复。具体计数/原始路径见tasks L007与research§7。

合成用户/服务只证明本机E2，不是公司身份E3；US6、真实Java/目录、批准格式及内部对象仍缺供给。当前未执行破坏性故障、PITR、真实备份/切主、生产容量或发布；不以本地正常重启冒称灾难恢复/HA/RPO通过。原T001–T126按完整AC/前置分别审，不把L007局部闭环批量迁成原全项完成。全部源码保留未提交状态，禁止自动commit/push/部署。

最终制品与原性能门已通过，源指纹`50c3512aa7cca4104cf3143a5ee6eefeb1a73c8ae395ee18bd4f93767e607a89`；原生Safari27六单元为三项本轮执行＋三项有界复用。最终UI索引为36PASS/7BLOCKED/0FAIL，`passed:false/status:BLOCKED`；原full的FAIL和定点父BLOCKED均保留，不当成完整矩阵或生产成功。原生ESM/Vue peer与输入/双销毁已定点补齐，硬件触控、公司业务及完整AC仍独立保留。精确命令、当前制品值和原始链接见[research §8.4](research.md#84-2026-11-08最终证据)。


## 2026-11-09 当前本地测试环境收口

以原tasks顶部90行复核及当前126/105证据索引为准，原文旧“未执行PITR”只对应早期阶段，后续安全本地basebackup与只读命名点PITR证据已保留，生产旧主/fence/外部代际与恢复执行仍缺。此次当前SDK实际双入口与冷副本5进程、TLS/mTLS合成内部服务、独立Unix-socket-only PG、进程树localhost网络策略联合23/23，107包空缓存离线安装、10正常清理。原性能七项及新Safari真正主UMD/Element六单元均通过，具体输入/摘要/限制见tasks及后端ops/deployment、supply-chain、capacity。

原126任务仍82已勾/44未勾；这些未勾项的可本地依赖就绪子集已执行，外部条件不伪造：真实公司服务及凭据、生产唯一主/复制/外部代际/旧主隔离和专门故障恢复许可、目标容量轨迹及服务器、物理触控、Safari批准预算、内网源许可与实名安全/业务/DBA审批。后续纠正：T059本地恢复执行器与T121本机固定容量轨迹已继续实现并实测，生产接入和容量验收另列；不再把生产批准当本地开发前置。保留现栈与所有未提交修改，不自动commit/push/发布/部署。

本地执行补齐（2026-11-09）：恢复LocalRecoveryExecutor/journal实际调用自有源停机、WAL新只读目标和六层对账，b-ICxLPu1/1，11新单元与3PG生命周期负例通过；容量脚本c-17ny6n按128段gc:false/20串行+20突发4的40写测候选/历史/快照/重放/WAL/队列，全提交且正常关闭。源码和编译摘要绑定；没有真实业务数据库、破坏注入或部署。服务器与公司配置待实际接入时落实，不作为现在停止编写本地路径的理由。
