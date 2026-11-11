# Research: 独立完整编辑器后端决策同步

> **2026-11-09 续做44项**：本次新增实现、真实失败修复和受影响验证见[§8.5](#85-2026-11-09续做44项的新增实现与验证)。原126状态以tasks的82本地完成/44未整项满足为准；§8.4及此前记录仍保留当时来源，不冒本次重跑。

> **2026-11-08 当前进展**：§1–§7保留各批当时的准备/实现和执行结论；当前运行契约见§8.1，最终制品、原性能门及真实Chrome/Safari证据见[§8.4](#84-2026-11-08最终证据)。本地通过不等全126项或生产验收，原失败记录不改写。

**起始日期**：2026-11-06。§1–§5为当时研究/PoC记录，§6–§7为后续各批来源，均不替代[§8当前本地契约与证据边界](#8-当前本地运行与交付证据)。本地真实PG、协议、业务和分进程已有实现及分层证据；原T项仍按完整AC判断，不把历史未勾写成无实现，也不把本地结果扩为生产通过。本次只整理现有文档，不重跑安装或测试。

## 1. 来源与历史

[研究报告](../../.workbuddy/output/research_report.md)保留跨语言六路线事实/评分/敏感性/固定4.7.1源码与官方来源，是本轮已读输入；[高层](../../.workbuddy/output/高层架构设计.md)IC-01/02与[系统](../../.workbuddy/output/系统设计.md)、[故事](../../.workbuddy/output/UserStory.md)是后续决定与范围基线。研究报告早期语言开放及旧G2/G3人工Gate语句属当时上下文，不覆盖用户后续取消专家流程/委托继续与单语言专业选择；不改上游历史，不伪造用户逐章点击通过。

旧本文件把Node硬约束/Node24推荐及旧MVP写成现行依据已失效。现编辑器统一TS/Node、NestJS＋FastifyAdapter、Hocuspocus与同语言Worker；公司Java业务域独立，原语言比较作为解释选型的历史，不维护两套有效路线。方向确定不等BOM/长期Owner/基础设施落实。

## 2. 决定、理由、未采用与验证门

| 决定 | 理由与比较边界 | 未采用/未冻结 | 必须前置证据 |
|---|---|---|---|
| TS/Node完整文档域模块化单体 | 原生Yjs同语言、契约与维护边界；公司业务仍Java | 不把Java文档域混回业务系统，不以0.10评分差虚称压倒优势 | T001长期Owner/替补；T003支持BOM |
| Nest＋FastifyAdapter API、独立collab/Worker | 领域模块/DI/事务与生命周期隔离，不以空GET QPS裁决 | 不新增微服务/Redis/broker/K8s，不把Hocuspocus当整套后端 | 框架/适配器插件/固定版本CI，T007 |
| 全内部自部署 | 原用户硬约束不变 | 无托管/公网翻译备选；对象产品/实例数未知 | T004/T005供给/安全部署、T119断网 |
| commit后原活动对象应用与广播 | 固定4.7.1默认handleUpdate不等待异步onUpdate/onChange就广播，synced非receipt | provisional未采用，不因PoC失败自动改默认 | T008全入口受控适配；T013证据复审 |
| 恢复A/B均待证明 | CRDT合并非回滚，历史身份/相对锚点/gc:false必须保留 | 旧update apply/JSON新建不是恢复；B改变在线要求另批 | T009/T010 A→B→A/旧pending；失败F8 BLOCKED |
| 共锁撤权与有限发送准入 | 失效消息/短票据TTL不构成即时授权边界 | 不追撤已准入在途字节，不给5秒续写宽限 | T011共同锁/锁后复权/逐受众commit线序 |
| writer与DB防脑裂分层 | 房间token不保护独立DB双主/复制丢失 | active/passive只是目标，不能实例数宣HA | T012锁后实时钟/末端复核、DB旧主/PITR外部代际 |
| 来源授权及共享引用生命周期 | 单来源解绑不应破坏独立grant/审批/对象 | 不自动物理级联删、不承诺永远保留 | T002策略/T020–T024竞态 |
| Outbox/Inbox/用户流提交序 | 本地可靠事实、外部至少一次+幂等，提交序才保障游标 | 不自增分配序假作commit序、不要求补private隐藏gap | T085/T092与真实Java联调 |
| 15功能完整、7P0且F6首发 | 首发是F1–F10/F14/F15＋F13所用边界 | 研究早期翻译/评论可后置建议已被IC-02覆盖 | T083内部翻译缺失整批BLOCKED；改批另批 |

## 3. 固定版本事实的使用边界

既有研究读取package与锁文件为Hocuspocus server/provider4.7.1、Yjs13.6.33、Tiptap3.32.0；4.7.1 fixed tag的beforeSync await不等覆盖direct/seed/后台入口，也不证明所有广播受控。默认debounce保存/正常关机flush非kill-9可靠承诺。研究列Node24/26、Nest/Fastify与PG代际为当时候选，不在本轮复述成当前已核实支持状态，不直接选master/浮动镜像。T003重新实施前核支持交集和patch/digest，前端构建兼容不偷换。

### 3.1 历史：执行准备阶段的前端锁文件核对（2026-11-06）

本次直接读取dev工作树的`package.json`、`package-lock.json`与`.nvmrc`，仅构成本地静态证据，不重做既有外部研究，不代表T003完成：

| 项目 | 本地事实 | 使用边界 |
|---|---|---|
| 协同依赖 | server/provider 4.7.1；Yjs 13.6.33；lib0 0.2.119；y-protocols 1.0.6 | 兼容基线，不自动升级 |
| Tiptap | collaboration 3.32.0；传递依赖y-tiptap 3.0.10 | 不将所有Tiptap传递依赖笼统记为3.32.0 |
| 锁文件 | lockfileVersion 2 | 前端锁文件，不是独立后端锁文件 |
| 前端工具链声明 | `.nvmrc`为14.21.3；engines Node≥14.21.3、npm≥8.19.4；packageManager npm@8.19.4 | 仅既有前端兼容声明，不是新后端运行时选择 |
| 后端依赖 | 锁文件packages中无Nest、Fastify、pg、TypeScript、ts-node或tsx包项 | 未锁定这些后端依赖，不推断机器全局安装状态 |

上述为独立后端安装前的前端锁文件历史，不能推断当前独立后端未安装Nest/Fastify/TypeScript；当时摘要中的版本仅为候选。后续L002最小本地BOM及实际安装证据见§3.3；PG服务端、内网制品、离线digest、完整许可/SBOM及生产工具链支持交集仍待补齐。

### 3.2 历史：L002最小本地BOM候选（2026-11-06后续只读核验）

本节保留安装前候选原文，包括Fastify5.11.3与当时“待执行”的检查项；不是现行版本或未安装结论。后续用户已批准固定公共源本地安装，最终5.12.7状态见§3.3；生产内部制品要求未变。

以下来自独立研究者读取的精确registry元数据，仅为声明级兼容，不是已安装、编译通过、安全批准或完整T003完成。仅选择L002实际需要的包，不提前加入pg、Hocuspocus或Yjs。

| 用途 | 精确包版本 | 来源及声明 |
|---|---|---|
| API框架 | @nestjs/common、@nestjs/core、@nestjs/platform-fastify 均11.2.8 | [common](https://registry.npmjs.org/@nestjs/common/11.2.8)、[core](https://registry.npmjs.org/@nestjs/core/11.2.8)、[adapter](https://registry.npmjs.org/@nestjs/platform-fastify/11.2.8)；MIT，core Node≥20，三件套peer为11.x |
| HTTP | fastify 5.11.3 | [metadata](https://registry.npmjs.org/fastify/5.11.3)；MIT，adapter精确依赖同版本；[v5迁移指南](https://fastify.dev/docs/latest/Guides/Migration-Guide-V5/)声明Node≥20 |
| 框架运行依赖 | reflect-metadata 0.2.2、rxjs 7.8.2 | [metadata](https://registry.npmjs.org/reflect-metadata/0.2.2)、[metadata](https://registry.npmjs.org/rxjs/7.8.2)；均Apache-2.0，满足Nest声明peer范围 |
| 编译工具 | typescript 5.9.3 | [metadata](https://registry.npmjs.org/typescript/5.9.3)；Apache-2.0，Node≥14.17；[Nest同gitHead根manifest](https://raw.githubusercontent.com/nestjs/nest/8e3a55720ad384281fca8b17207c789c773825e2/package.json)有同版开发工具证据，不代表官方TS支持矩阵 |
| 本地Node类型 | @types/node 22.19.15 | [metadata](https://registry.npmjs.org/@types/node/22.19.15)；MIT，类型工具最低TS5.2，22系类型不等于生产Node补丁冻结 |

本机Node22.22.2满足已核对声明的Node下限，但全量传递依赖未解析。准备采用NodeNext成对module/moduleResolution、strict、noEmitOnError与Nest装饰器配置，编译后运行，不使用浮动最新CLI或原生类型擦除执行Nest装饰器。所有直接版本固定不代表传递树已固定。依赖来源、具体安装许可、真实锁文件及integrity、全树engines/install scripts、漏洞与SBOM/NOTICE、编译及本地HTTP测试仍待执行；禁止以--force或--legacy-peer-deps掩盖冲突。生产保持内部制品要求；公共registry仅作为证据，不默认成为生产制品源。

### 3.3 L002最终最小本地BOM与证据归档（2026-11-06）

用户已批准独立后端从`https://registry.npmjs.org`安装固定本地依赖、生成锁文件和执行针对性验证，后续补丁在已授本地自主决策范围内完成；无全局npm源修改。实际目录为与lark-doc同级的`/Users/cjjxw/codex/tiptap-integration-demos/apps/lark-doc-backend/`，并非dev工作树内部。

| 项目 | L002最终本地事实 | 边界 |
|---|---|---|
| 框架 | @nestjs/common、@nestjs/core、@nestjs/platform-fastify均11.2.8 | 正式TS/Nest＋FastifyAdapter本地边界，非业务验收 |
| HTTP | 直接fastify5.12.7；@nestjs/platform-fastify@11.2.8父级下Fastify定向override同为5.12.7 | 偏离adapter原生pin；仍须生产BOM审阅 |
| 运行与编译依赖 | reflect-metadata0.2.2、rxjs7.8.2、typescript5.9.3、@types/node22.19.15 | Node22.22.2仅本地测试运行时，非生产版本冻结 |
| 锁树 | 78节点；package-lock.json SHA256 `f130920f4933df992b9907b36adc39b8f7e55a5222422b178d78cfe122bcdde3` | 固定本地工件，不等于完整生产SBOM/制品批准 |

以下是已回传并由主助手核验的证据简引，本次文档归档没有重跑命令：

- 实现者fNkTbr：typecheck、build、正式TS node:test 8/8均exit0；旧L001原生mjs 7/7为独立历史证据，不能混算。
- IlYNiQ：全量audit exit0、total0，主助手已核验；零已知告警不是生产安全认证。
- 独立verifier wSjiMF：24次真实回环HTTP；aCqQmf：10次app.inject（非TCP）；qNQLDk：3项插件范围探针（两正一负），各自exit0。三组关闭均为显式finally app.close，未测信号，不可外推SIGINT/SIGTERM或生产排空。

历史5.11.3→5.12.5→5.12.6→5.12.7的补丁结果、5.12.6内部版本标记及插件兼容异常保留于[tasks](tasks.md)历史补丁链，不以旧锁或旧测试替代上述最终工件证据。L002已完成仅限本地启动边界；未加入pg/Hocuspocus、未连接真实PG、未验收P01–P19/业务/生产，也未初始化Git或部署。公共源本地安装授权不等于生产源批准；生产仍需内部制品、完整支持交集、SBOM/许可及安全审阅。

### 3.4 本地合成Yjs字节实验的最小BOM准备（2026-11-06）

前端固定锁与官方精确版本元数据只读核对：`@hocuspocus/server`/`provider`/`common`均4.7.1，`yjs`13.6.33，`y-protocols`1.0.6，`lib0`0.2.119，六项integrity一致。server声明Node≥22；Yjs/y-protocols声明Node≥16、npm≥8，lib0声明Node≥16；provider/common未声明engines，不能等同Node22专项兼容认证。六项许可证元数据均为MIT，不等于法务或完整闭包审阅。来源为各固定版本registry metadata及前端package-lock，非latest。

主助手直接读取`npm view yjs@13.6.33`原始结果：lib0依赖范围`^0.2.99`、Node≥16/npm≥8、MIT及固定integrity。选定本地实验仅加入Yjs13.6.33，锁定lib0 0.2.119及其isomorphic.js 0.2.5闭包；isomorphic.js完整metadata核定：0.2.5、MIT、无额外运行依赖；三项均无preinstall/install/postinstall/prepare。实际使用`--ignore-scripts`安装成功，仅新增三节点，锁树78→81；旧78节点与原manifest字段的保护语义摘要未变。主助手已直接读取audit原始输出（YjEH40：所有告警0、exit0）及typecheck/default npm test原始输出（FiQFPt：含build，20/20通过、0失败/跳过、exit0）。最终lock SHA256为`44e05603cbc00c13b0ef4d784b8d1e38c06099e299694280db00d2a9d24048a6`；package SHA256为`e38a8245daeaa327859a537f9f21441be9b51ca5d4bd3404b945f18c92427ecd`。新增固定依赖已完成本地安装边界，不等于Yjs保存/重放实验已实现。package/lock由唯一Owner负责，保留现有Nest/Fastify定向override，禁生命周期脚本执行，不自动升级修漏洞。

普通encode/apply/连续重放不需要Hocuspocus server/provider或Node PG驱动；暂沿用显式psql隔离方式。真正全入口候选→commit→原活动对象apply→广播/receipt须依T008 `ingress-broadcast.test.ts`证明，版本恢复候选须依T009 `restore-algorithms.test.ts`证明。字节重放不等于版本恢复，也不因最小BOM安装完成而勾选任何生产/PoC任务。

### 3.5 T008服务端最小固定闭包（只读准备，尚未安装）

建议新增直接依赖`@hocuspocus/server@4.7.1`、`y-protocols@1.0.6`；原始协议fixture若直接import lib0则显式列`lib0@0.2.119`，不装provider。固定传递节点common4.7.1、async-mutex0.5.0、crossws0.4.16、kleur4.1.5、tslib2.8.1，保留原Yjs/lib0/isomorphic与Nest/Fastify override。闭包预计10个唯一节点，复用后端现有4节点，预计新增6；未安装/解析锁树，不把预计数量写成事实。

只读官方固定metadata已核9节点及integrity与dev锁一致；tslib许可证0BSD，其余MIT，已核节点无依赖安装生命周期。crossws只有optional peer srvx，实际server使用`crossws/adapters/node`内嵌ws，不使用依赖srvx的`crossws/server/node`。不自动安装srvx/ws/provider或原生扩展。内嵌ws存在bufferutil/utf-8-validate可选探测，PoC可显式设置`WS_NO_BUFFER_UTIL=1`及`WS_NO_UTF_8_VALIDATE=1`；不能用外部ws审计替代内嵌实现审阅。

官方元数据缺口后续补齐：主助手成功读取[server4.7.1固定JSON](https://registry.npmjs.org/@hocuspocus%2fserver/4.7.1)，确认Node≥22、MIT、既定dependencies/peers与gitHead，完整原文无scripts/optionalDependencies/peerDependenciesMeta/gypfile/binary/bundledDependencies，SRI与dev锁一致。此前研究请求TLS失败保留为历史，不作为当前未核结论；未通过权限绕过。provider不在最小闭包内，不需要为它扩展安装。

源码研究者逐字节核对Document/MessageReceiver/Hocuspocus/Connection/DirectConnection/ClientConnection/types七文件与官方v4.7.1固定tag一致；这不是npm归档及实际dist已验签。初步证实默认链路非commit屏障：Document.handleUpdate调用onUpdate不await，Hocuspocus.handleDocumentUpdate调用onChange/store不await；beforeSync仅有connection时await，direct/raw插件及无connection入口不能靠它统一拦截。flushDelay=0仍只是setImmediate合并，非等待commit。实施规格已明确：以真实导出类构建SyncStep2/update的独立onChange/onStore闸门对照、direct绕过beforeSync及Step1污染读取；默认风险对照通过不能视为目标通过，目标断言模式须因提交前活动对象改变/广播/成功状态而真实失败，而非缺模块或编译失败。类级捕获socket不等真实网络/DB，原生SyncStatus不等durable receipt。安装Owner负责固定归档/dist核对及回归，测试Owner仅负责独立PoC文件，安装核验放行前不执行新fixture；后续安装者报告固定安装81→87节点、旧81节点完整对象未变、官方tgz SRI及19文件逐bytes一致；这些历史原始任务当前无法取回，归为作者报告，不冒充主助手独立工件核验。主助手实读package确认固定声明，并独立执行当前87节点全树audit（Uev1Kj），exit0、所有严重度0。既有默认20项测试原始输出cHV3M2已读取，但只覆盖当时文件快照。新增`backend/test/poc/ingress-broadcast.test.ts`含6负对照及6目标定义，已读到有限deadline和明确SyncReply未覆盖说明；作者最后报告正开始最终编译/两模式运行，最终输出尚未收到。续接依赖研究者遇上游网关空流，不否定此前交付。状态纠正：测试实现者随后确有平台安全检查拦截的系统失败通知；此前“无证据证明被拦截”的表述有误。该通知不提供最终编译或测试断言结果，不能据此认定测试已通过或行为红灯已复现。后续只读恢复历史执行日志遭权限拒绝，未换工具或路径重试；待用户提供日志摘录或恢复访问后核对。T008保持未完成，未重试被拦截测试。

### 3.6 T013证据复审：T008–T012隔离PoC的真实版本、线序、失败与证据（2026-11-07追加）

本节按[tasks](tasks.md)T013（依赖T012）要求追加，**只记录证据、不验收、不冻结wire协议**。§3.1–§3.5及§4/§5保留2026-11-06历史原文不改；其中§3.5标题「只读准备，尚未安装」、末段「T008保持未完成，未重试被拦截测试」、§5「未运行安装或测试」均为当时快照，已由下列2026-11-07实测取代：用户明确「授权恢复测试执行」后本地测试执行门恢复，T008四条命令取得完整真实输出，随后完成T008第二阶段全入口arbiter与T009–T012共五个隔离PoC。历史被拦截通知与只读恢复日志`Permission denied`不再作为当前执行门状态；未通过换agent/命令/工具/读取路径绕过拦截。

**证据等级**：以下全部为`[实测通过·隔离本地PoC]`或`[静态分析]`，不是生产实现、不是原T001–T126通过、不是F3/F8/P07/P08/P09/P10/P11或任何AC验收通过；没有真实PostgreSQL、WebSocket、Hocuspocus provider/server进程、浏览器、跨实例或故障注入。T013明文「无通过不进入正式依赖实现」，故T014–T018及正式迁移/控制器/业务接线均未开始。

#### 3.6.1 真实固定版本与运行环境

| 项目 | 实测/核对值 | 使用边界 |
|---|---|---|
| 本地运行时 | Node v22.22.2、npm 10.9.7 | 仅本地测试运行时，非生产版本冻结 |
| CRDT/协议 | yjs 13.6.33、lib0 0.2.119、y-protocols 1.0.6 | 固定闭包；provider/server 4.7.1仅只读静态核对，未启动进程 |
| 服务端框架（L002） | @nestjs/common/core/platform-fastify 11.2.8、fastify 5.12.7、typescript 5.9.3、@types/node 22.19.15 | 本地BOM，公共源安装不等于生产制品批准 |
| Hocuspocus | @hocuspocus/server、@hocuspocus/provider 均4.7.1 | server最小闭包已装；provider仅静态读源码，PoC不启动 |
| 协议整数 | D001 `src/protocol-integer.ts`纯字符串比较；T009 `nextDecimal()`字符串自增 | epoch/revision/authzVersion/commitSeq/fencing token/外部代际均不经Number/BigInt |
| 数据库 | PostgreSQL 未启动 | 锁表、已提交视图、commit seq、Outbox、DB topology全部为进程内内存模拟 |
| 编译 | tsconfig NodeNext、strict、noEmitOnError、include `src/**/*.ts`+`test/**/*.ts` | `npm run build`把`test/poc/*.ts`编到`dist/test/poc/*.js`；`npm test`默认只跑boundaries+protocol-integer |

#### 3.6.2 线序链（每步真实做了什么）

| 任务 | 真实产出 | 证据等级 |
|---|---|---|
| T008一阶段 | 4条命令实测：typecheck/build exit0；默认12项（6负对照通过、6目标skip）；`RUN_INGRESS_TARGET_RED=1` 6项目标真实断言失败，证明commit stub未释放时live已污染、observer/广播/原生`SyncStatus(true)`已发生、晚加入Step1读到未提交内容 | 实测·隔离PoC，印证静态结论 |
| T008二阶段 | 新增`commit-arbiter.ts`+`ingress-arbitrator.test.ts`：7类covered、4类covered-locally、14类disabled；注入式`CommitArbiter` room级串行、隔离candidate、commit后才apply到同一个原活动Y.Doc、精确receipt、失败隔离、Step1只读已提交、stock`Connection.handleMessage`显式禁用 | 实测·隔离PoC；commit authority为stub |
| T009 | Yjs 13.6.33运行时探针 + 候选A显式恢复delta（逐节点保留未变结构、只替换差异节点、`gc:false`保历史身份与删除集、commit后施加原活动对象）；A→B→A嵌套属性/格式恢复、旧clientID 101保留+新服务端777001独立、未变节点anchors attached、被替换节点显式orphaned；旧update合并/JSON重建/替换房间doc判为伪恢复 | 实测·隔离PoC；候选B一律blocked |
| T010 | `[静态分析]` provider 4.7.1 `onOpen()→sendToken()→startSync()`立即发SyncStep1、`synced=true`只在回包后；y-protocols 1.0.6 Step2/Update直接`Y.applyUpdate`。据此实现握手门：READY为会话首帧、握手前自动首帧全拦、旧epoch `EPOCH_MISMATCH`+只读pending导出、逐帧/出队/恢复提交三时点复核epoch、未知协议fail closed | 静态分析 + 合成帧实测·隔离PoC |
| T011 | 进程内LockTable模拟`FOR UPDATE`/`FOR SHARE`：写/revoke/注销/参与者移除共`documents`协调行、锁后已提交视图复权、持锁至commit、`FOR SHARE`短事务commit为发送准入点、一次性许可绑定受众、来源gap与失效信号遗漏fail closed、`WRITE_GRACE_MS=0`、14读面统一404 | 实测·隔离PoC；无真实SQL/MVCC |
| T012 | 逻辑钟区分事务起点`now()`陷阱与锁后实时钟、末端复核、3类有限deadline（本地fixture）、token用D001字符串自增且旧token退役、接管deferred至持锁事务结束、重放后ready、worker token CAS+eventId幂等、四类caller×六类命令统一屏障；P08线序可核，**P09一律`blocked-requires-approval` / `countsAsPass=false`** | 实测·隔离PoC；无真实故障注入 |

#### 3.6.3 两模式实测结果（完整TAP输出落盘）

| 任务 | 受控绿灯（默认） | 风险对照红灯 | 日志 |
|---|---|---|---|
| T008一阶段 | 12 / pass 6 / fail 0 / skip 6 / exit 0 | `RUN_INGRESS_TARGET_RED=1`：12 / pass 6 / **fail 6** / exit 1 | `03-default-mode.log`、`04-target-red-mode.log` |
| T008二阶段 | 19 / 19 pass / exit 0 | `RUN_INGRESS_BARRIER=none`：19 / pass 10 / **fail 9** / exit 1 | `11-arbitrator-durable-green.log`、`10-arbitrator-none-red.log` |
| T009 | 33 / 33 pass / exit 0 | `RUN_RESTORE_RED=1`：33 / pass 23 / **fail 10** / exit 1 | `38-final-controlled-green.log`、`37-final-risk-red.log` |
| T010 | 37 / 37 pass / exit 0 | `RUN_EPOCH_RED=1`：37 / pass 9 / **fail 28** / exit 1 | `04-controlled-green.log`、`03-risk-red.log` |
| T011 | 46 / 46 pass / exit 0 | `RUN_AUTHZ_RED=1`：46 / pass 9 / **fail 37** / exit 1 | `08-controlled-green.log`、`07-risk-red.log` |
| T012 | 50 / 50 pass / exit 0 | `RUN_FENCING_RED=1`：50 / pass 9 / **fail 41** / exit 1 | `08-controlled-green.log`、`07-risk-red.log` |
| 默认入口回归 | 每轮 `npm test` 20 / 20 pass / exit 0 | — | 各轮`*-npm-test-regression.log` |

所有红灯失败均为`ERR_ASSERTION` / `testCodeFailure`（故意不合规的risk对照实现触发），日志中无编译错误、缺模块、超时、SIGTERM、AggregateError或平台拦截关键字；未用空stub或编译失败冒充测试先行。回归链T009 5项→T010 7项→T011 9项→T012 11项逐项与既有evidence一致，14项既有源码/产物sha256跨批次完全相同，无证据漂移。

#### 3.6.4 真实失败与调试披露（T013要求记录「失败」）

| 事件 | 根因 | 处理与证据状态 |
|---|---|---|
| T008二阶段首次typecheck exit 2 | `Y.decodeStateVector`返回Map，误传给需要编码字节的`Y.encodeStateAsUpdate` | 改用原始state vector字节；失败日志`05-arbitrator-typecheck-first.log`保留 |
| T008二阶段首轮none 10项失败含1项写错断言 | 误假设4.7.1 `Connection.close()`会置假socket `readyState=3`；实际只移除房间连接并发CLOSE帧 | 据真实行为改为「移除Connection + CLOSE帧」；`07-arbitrator-none-red.log`保留，未掩盖 |
| T009探针`toDelta is not a function` | `Y.XmlFragment`无`toDelta()`，只有`Y.XmlText`有 | 改递归`project()`结构投影；`01-probe.log`保留 |
| T009 JSON重建负例引用偏差 | `bodyA`是活动`live`引用，`editToB`后读到B而非A | 该探针输出不作正式负例；改用冻结`projectionA`/`versionABinary`；`probeDefectsDisclosed`已登记 |
| T009红灯多次挂起 | `assert.equal`对两个不同Yjs对象生成深度diff、遍历循环引用结构卡住 | 改引用恒等`assert.ok(a === b)`；诊断日志15–26保留 |
| T011首轮绿灯44/46 | 测试构造缺陷：撤权只删`document.write`，而发送准入需`document.read` | 改撤`document.read`，拒绝由「锁后当前Grant复权」决定；`04-controlled-green.log`保留 |
| T012首轮两模式退化50/50 pass | 测试定义`mode`却未注入协调器，实例全为默认controlled | 新增`newC()`统一注入并重编译；`03`/`04`明确标为**无效证据**，仅`07`/`08`有效 |

#### 3.6.5 冻结的成功候选（仅PoC级，不等于生产通过）

| 候选 | 冻结内容 | 仍缺 |
|---|---|---|
| 恢复候选A | 隔离`gc:false`候选从完整已提交二进制构建→逐节点保留未变结构、只对差异节点显式替换→生成显式恢复delta→commit确认后施加到**同一个原活动Y.Doc**；`steps=[keep@2, replace@1, replace@0]`，旧clientID不复用、新服务端独立clientID | 真实DB版本读取、真实Tiptap全schema、基于CRDT身份的diff/移动、并发/跨实例 |
| 恢复候选B | `blocked-requires-approval`；改变在线体验与原活动对象要求，须另批，**不是A失败后的自动回退** | 另批批准与真实在线房间验证 |
| 伪恢复拒绝 | `old-update-merge`、`json-rebuild`、`replace-room-doc`、未知策略、只读预览一律fail closed / `countsAsPass=false` | — |
| 全入口收口 | 7类covered、4类covered-locally、14类disabled；stock接收层显式禁用；越权live写origin guard检出后fail closed | 生产级防护（origin guard只能在状态已改后检出） |
| 握手门 | READY为会话首帧；逐帧/排队出队/恢复提交三时点复核epoch；旧epoch `EPOCH_MISMATCH` + 停自动上传 + 只读`pending-export-v1`；不自动换epoch、不合入新state消毒 | wire消息号/Schema冻结、真实provider兼容、真实身份鉴权 |
| 精确receipt | 只清`updateId + payloadHash + epoch + protocolVersion`四项全匹配的对应pending；广播/最大seq/state vector/旧epoch receipt均不能清 | 真实DB事务与receipt落库 |
| 共锁复权线序 | 写/revoke共`documents FOR UPDATE`、锁后已提交视图复权、持锁至commit；`FOR SHARE`短事务commit为准入点、发前释放；许可一次性且绑定受众；`WRITE_GRACE_MS=0` | 真实SQL/READ COMMITTED/MVCC、跨实例收敛SLA |
| 取钟与token | 锁后实时钟（非事务起点`now()`/锁前钟）、事务末复核、3类有限deadline、token字符串单调递增+旧token退役、接管deferred、重放后ready；`epoch ≠ fencingToken ≠ 外部恢复代际` | B02/B08获批配置、真实切主/PITR/故障注入 |
| DB分层 | 房间token不代DB防脑裂；`uniqueWritablePrimary`/`oldPrimaryIsolated`/复制确认未批即fail closed | 故障模型与复制方案批准，P09保持BLOCKED |
| 静态事实 | `beforeHandleMessage`可await且覆盖所有经Connection的帧但不能消费帧；`Connection.close()`不关底层socket；provider首帧早于`onSynced` | 运行级接入验证 |

#### 3.6.6 未决与BLOCKED（不得据PoC宣告通过）

真实PostgreSQL / `SELECT … FOR UPDATE|FOR SHARE` / READ COMMITTED / `clock_timestamp()` SQL / MVCC / 锁等待 / 事务与statement deadline / 事务原子性与崩溃恢复；真实WS / provider / server / 浏览器 / 跨实例进程 / 失效收敛计时 / 5秒SLA测量；wire消息号与Schema未冻结（见[contracts](contracts/backend-api.md)§8）；T014–T018与正式迁移/控制器/业务接线；P09故障模型/复制确认/DB切主/旧主隔离/PITR外部恢复代际未批→`blocked-requires-approval`；候选B未批；B02/B08上限/保留/deadline数值未批（PoC数值仅`LOCAL_FIXTURE_ONLY`）；F3/F8/P07/P08/P09/P10/P11及各AC/CHK验收；HA/RPO/RTO/容量/可靠保存/授权；责任人复审（见3.6.8）。

#### 3.6.7 证据指针（相对`apps/lark-doc-backend/.workbuddy/`）

| 任务 | 归档目录 | evidence | 关键工件sha256（前8位） |
|---|---|---|---|
| T008 | `t008-run-20261107/` | `evidence.json`（4命令）、`evidence-phase2.json`（7步） | `ingress-broadcast.test.ts` `42f4bcbb`；`dist/…-test.js` `64a0f068` |
| T009 | `t009-run-20261107/` | `evidence.json`（6步、14份日志哈希、探针缺陷披露） | `restore-algorithms.ts` `ff70e20f`；`.test.ts` `88b973a4` |
| T010 | `t010-run-20261107/` | `evidence.json`（4步、28项失败清单、11份日志哈希） | `epoch-handshake.ts` `4c153dba`；`.test.ts` `7968bb84` |
| T011 | `t011-run-20261107/` | `evidence.json`（8步、37项失败清单、17份日志哈希） | `authorization-locks.ts` `21757d0f`；`.test.ts` `87ded0bc` |
| T012 | `t012-run-20261107/` | `evidence.json`（8步、41项失败清单、19份日志哈希） | `fencing-database.ts` `a8a0f4d4`；`.test.ts` `e070aedb` |

各evidence均含`commands`/`regression`/`whatWasActuallyProven`/`boundaries`/`logSha256`；本轮T013复审归档见`apps/lark-doc-backend/.workbuddy/t013-run-20261107/evidence.json`。

#### 3.6.8 复审状态与红线

- **责任人复审：`pending`（未虚填）**。按用户长期约束，实际人员组织与分工由用户统筹，不因缺责任人姓名/替补/专业角色标识阻塞本地开发，也不虚填人名或生产交接清单；本轮完成的是证据记录与候选冻结草稿，责任人复审属独立保留的生产交接环节，未在本轮虚构完成。
- 未勾选T013或任何原T001–T126（[tasks](tasks.md)第99行仍`- [ ]`）；不把PoC绿灯写成生产容量、可靠保存、授权、HA、RPO/RTO或原任务通过。
- 未做生产部署、Git commit/push、真实业务数据库、故障注入、真实授权操作，未关闭或绕过任何安全保护；未假定生产接受单实例停机。
- 「无通过不进入正式依赖实现」：本节不构成T014（schema失败测试）或T018（正式提交协调器）的开工授权。

## 4. 必须保持未知

最新用户裁决：实际人员组织由用户安排，未提供角色标识不再作为本地技术准备与开发的阻塞理由；这不代表替补/生产交接清单已经交付。可在明确的隔离开发范围推进技术决策，生产容量、依赖实供与真实测试结果仍不得虚填。

同级后端目录与用户本地技术责任已确认，L002最小本地BOM已完成；用户已明确确认兼任TS/Node.js长期维护Owner；远端地址、替补、Java/DBA/平台/安全专业分工、身份/对象/翻译依赖接口、峰值/文档/附件/保留、故障域/复制确认/SLO/RPO/RTO、完整生产BOM/限额/有限锁与任务deadline、分类型清理/hold仍未明确。对应plan B01–B09及tasks T001–T006的生产/真实集成门保持未完成，缺者BLOCKED而非假数；不否定已授权本地准备。历史2703是前端历史单测，不是新后端；2000块是样本，不是容量批准。

## 5. 结论

现行规范与126项原任务保留，T001–T126全部未勾选；L001历史边界和L002正式TS本地边界已完成，两者不计入原126项。不宣称真实PG、技术可行性PoC、业务、人工review或生产可用已经验收；关键方案的“需验证”仍通过前置任务落实。本次仅归档既有证据并做静态核对，未运行安装或测试。详细字段/接口见[data-model](data-model.md)/[contracts](contracts/backend-api.md)。


## 6. 2026-11-07 真实本地闭环

用户授权保留现有栈，完成可信共享池到双用户持久协作与正常重启回读，不commit/push/部署。实际前端为`/Users/cjjxw/codex/tiptap-integration-demos/apps/lark-doc`（原dirty detached837e329，未切换/覆盖历史修改）；后端同级`lark-doc-backend`目前非Git，不初始化。

### 6.1 实际BOM与接线

保留Nest11.2.8/Fastify5.12.7/Hocuspocus4.7.1/Yjs13.6.33/Tiptap3.32.0及原前端Vue2/Webpack构建。新增实际驱动`pg@8.16.3`与`@types/pg@8.15.5`，无ORM/Redis/broker；package-lock SHA256=`b13468fad1e5b77f46df4420162c324b9dfac88ed836b7bec65b4c381ec05346`。历史22.22.2路径不存在，本轮明确使用已安装Node22.13.0，未冻结生产Node补丁；PG工具17.11_1，未触碰原本本机PG进程。

HTTP与WS使用真实Nest/Fastify和Hocuspocus，当前配置入口同进程双端口，非独立多进程部署验收。服务只持受限pool；管理员合成IdP/授权fixture预置票据hash、service/owner和第二用户grant，用户编辑/创建/seed均经真实网络与受限函数。具体wire和限额见接口§9。

### 6.2 唯一证据与实际分层

证据相对后端`.workbuddy/`，Unix socket路径限制使目录为短名；全部数据/日志保留，不删除。

| 范围 | 结果与证据 | 实际证明 |
|---|---|---|
| 真实PG+node-postgres共享池 | `d-ZWktda/evidence.json` 18/18，正常SIGTERM | max1交替与max2并发actor不串、票据伪造/到期/撤销/跨作用域拒绝、私表与API/Worker/PUBLIC权限、context不重绑、COMMIT自然到期拒绝、service映射锁、受限create/唯一seed、旧004–006兼容、撤权与同步发送锁、自己活租恢复 |
| 真实PG+HTTP+WS+Chromium双LarkDoc | `c-DItJ1b/evidence.json` 10/10，5项资源normal cleanup | HTTP create/唯一seed和冲突、CSRF/Origin/租户、实际键盘并发/互见/各自receipt落库、原操作查询隔离、默认Sync旁路拒绝、正常API/WS/PG关闭并原数据重启回读、活租期内继续编辑、撤权后拒写且无新receipt |
| 丢确认回归 | 同一c-DItJ1b，`ackLoss`明确标注 | **仅浏览器夹具丢弃一次COMMITTED/RECEIPT**，服务/PG真实提交；断线unknown→重连blocked→原键QUERY→无重复commit。不是DB COMMIT响应丢失实测 |
| 就绪失败清理 | `c-8W4zW5/cleanup-evidence.json` | 真实PG只注入测试侧探针拒绝，create未返回时正常SIGTERM，无postmaster.pid；另注入spawn error验证受控异常，不是生产故障注入 |
| 后端针对性回归 | `/tmp/lark-doc-runtime-final-20261107.log` 123/123 | 含启动边界、整数、HTTP注入gateway、提交端口和房间协调器；**这些部分是端口/内存模型，不当成PG E2E** |
| 前端回归与lint | `/tmp/lark-doc-bridge-final-20261107.log` 15/15；collab lint退出0 | 真实Provider注入帧/真实socket事件路由、精确pending与可选导出、旧协作扩展，非独立WS/DB证明 |

E2E evidence保存执行时输入SHA256。之后仅`test/isolated-pg.mjs`补启动失败清理分支，旧执行指纹不替换；该分支由cleanup证据另验。其他生产源码/manifest/夹具与执行指纹一致。此前失败记录保留：c-qhcBe2为夹具未Define日志环境变量，c-jZcGLE为跨租户401/404接线，c-eG61uT为socket层onMessage没有message误被provider帧门解析；均修正后最终10项通过。最后一例新增socket真实事件路由红绿测试，provider层仍拒绝不受控帧。

两项独立安全发现已红绿闭环：提前触发约束允许同事务换绑（d-aospAb→closed墓碑）；运行中service映射修改未阻塞（d-s3oYVT→service FOR SHARE）。整体独立审查`local_closure_final_review` APPROVE（本地范围），Simplicity/Correctness双PASS；独立实跑tsc、77项HTTP/端口及15项前端回归，并核验PG/浏览器证据与正常停机日志。

### 6.3 重复运行入口

在后端目录，使用本机明确可执行的Node22：

```bash
/Users/cjjxw/.nvm/versions/node/v22.13.0/bin/node node_modules/typescript/bin/tsc -p tsconfig.json
/Users/cjjxw/.nvm/versions/node/v22.13.0/bin/node test/postgres-delegation-local.mjs
NODE_PATH=/Users/cjjxw/.workbuddy/binaries/node/workspace/node_modules /Users/cjjxw/.nvm/versions/node/v22.13.0/bin/node test/local-closure.mjs
/Users/cjjxw/.nvm/versions/node/v22.13.0/bin/node test/isolated-pg-cleanup.mjs
```

package提供`test:runtime`、`test:postgres:delegation`、`test:local-closure`；浏览器复用已装playwright-core及Chromium，可指定NODE_PATH/CHROMIUM_PATH，不自动安装。每次仅新建独占0700集群、清继承PG环境、Unix socket only、有限超时、正常SIGTERM关闭并保留证据。

单独`start:api`无DB配置仍只暴露健康边界；配置`LARK_PG_SOCKET/PORT/DATABASE/USER`和`LARK_ALLOWED_ORIGIN`时启动本地真实HTTP/WS。数据库service身份和用户票据必须受信预置，网络进程不持管理员。该入口只允许127.0.0.1，仍非生产配置。

### 6.4 该批次尚未完成（历史范围）

真实公司IdP/Java授权与事件、独立API/collab/Worker进程、私有评论等全部读面、快照/版本恢复、Worker任务、多实例writer故障/PG切主/PITR、DB COMMIT响应丢失、真实生产容量/慢客户端背压/HA/RPO/RTO均未验收。当前发送保证为持授权锁到同步enqueue，不代表已测长期慢消费或全NFR。原T项按完整条件逐项保留缺口，不以本地核心闭环冒领整批。


## 7. 2026-11-08 新增本地实现与统一回归证据（历史批次）

本节记录该批当时结果，不代表后续当前树；Element预算、性能和原生Safari的后续证据见§8.4，旧18/10记录仍保留原范围。所有PG均为项目内新0700 Unix-only独占集群，清继承PG变量，未连接/停止主机既有PG。Node22.13.0；PG17.11；实际Chromium155.0.8059.12双Vue2，合成IdP和服务身份，无真实公司账号/业务数据库或生产验收。

| 范围 | 结果 | 后端目录相对证据 |
|---|---|---|
| 原生票据跨30s/真实HTTP WS SSE/双用户/恢复/评论/private/Worker CLI/重启续写 | 31/31；387输入sha核对无差异，页面异常/外部请求空，全部正常cleanup | `.workbuddy/c-IlhM8V/evidence.json` |
| 资源/权限/快照/版本/恢复/评论/follow/通知/Worker/Inbox及新ACL | 最终同源38/38，正常停库/cleanupErrors空 | `.workbuddy/d-44VmoC/evidence.json` |
| 提交末端/DDL沙箱/真实自然到期 | 17/17，正常停库 | `.workbuddy/t-6Ois5T/evidence.json` |
| 双actor/历史迁移/无物理清理 | 3/3，正常关闭两集群 | `.workbuddy/r-VFun60/evidence.json`及`.workbuddy/l-dJiRe8` |
| 合成身份到共享池/事务复权隔离 | 18/18，正常停库 | `.workbuddy/d-n50Deb/evidence.json` |

命令日志统一在 `/tmp/lark-doc-final-20261108/`：`backend-tests-verified.log`（870项864通过/6历史stock ingress opt-in红灯skip）、`frontend-tests-rerun.log`（81文件1913通过）、`evidence-final.log`（7项工具通过）、`frontend-lint-rerun.log`、`frontend-build-final.log`（原Node14 CommonJS构建）、`postgres-{domains,guards,resources}-final.log`、`postgres-delegation-rerun.log`、`local-closure-final.log`。未覆盖原失败logs。6个skip不是当前受控server入口的成功断言，默认Sync旁路另已在真实浏览器验证被拒。

使用现有backend `test:all`、`test:postgres:guards/resources/delegation/domains`、`test:local-closure`。前端应用/ESLint用固定Node14.21.3；已锁Vitest5的engines要求Node^22.12，故测试工具用现有Node22，不重选应用工具链。CommonJS构建通过不代表Element475000B或原>20%预算实测；完整原生Safari/硬件触控矩阵仍BLOCKED。

实际发现并修复：原ticket固定30s后的长会话失效；WS收尾期间HTTP命令过早ROOM_BUSY；选区JSONB运算符优先级；definer owner缺主体FOR SHARE所需列权限和Outbox SELECT。权限只授NOLOGIN owner，应用组/真实LOGIN的直表/列拒绝已真实测42501。native续签保持同连接/Y.Doc/pending且不重UPDATE，旧票仍拒，恢复前旧票必须显式重新认证才能读新epoch。

版本hash针对实际Yjs物理PM投影；前端schema会为未持久化attrs补null默认值，视图比较通过原editor.schema.nodeFromJSON规范化，不改wire投影或哈希。C15样本原2000逻辑迭代产生2477顶层片段，锁原HTML SHA `ddf5516f824f48f19759da79b43adf352d234ba8c7934f1cb1120a3459bb4abd`；未改生成器/基线/预算，也不把E1工具用例称性能通过。

一次测试夹具未处理admin客户端超时异常（`.workbuddy/d-G8xRF3/evidence.json`）：原轮正常清理未确认，证据明确`originalNormallyStopped:false`；后续清PG环境、Unix-only在原目录恢复启动并正常SIGTERM，`recovery.normallyStopped:true`。原失败数据/日志/不完整结果保留，不补造原hash/逐项结果。最终38/31均使用独立新集群正常完成。

真实目录/授权源、Java服务信任与回执、内部翻译成功链、批准转换格式和内部对象/实际下载完成校验、原生Safari/硬件触控、生产恢复/HA/容量/保留值守均不在这些通过结论内。US6缺成功链继续阻完整首发，未运行commit/push/npm发布/部署。独立最终复审closure_review：APPROVE仅本地scope，Simplicity/Correctness双PASS、无阻断；已独立核当前指纹与正常停机。原CJS构建2条非阻断样式导出warning保留，未扩大批准至Element预算、完整AC或生产。

## 8. 当前本地运行与交付证据

### 8.1 已落地的运行契约

当前后端为同级非Git目录，前端保原dirty工作目录。Node22.13.0/npm8.19.4已在manifest/runtime/.nvmrc固定，前端应用仍Node14/Vue2/Webpack。配置入口分别启动独立OS进程API、collab owner和Worker；原startLocalRuntime只是保留的注入测试入口，不能据其同进程B runtime代独立进程。

API经固定 `https://127.0.0.1:port`、TLS1.3/mTLS、CA/SAN和精确peer pin调用owner；server pin在用户body发送前验证，同CA错peer也拒。固定editor-owner-v1命令seed/capture/restore携原opaque token，PG逐次核当前用户/tenant/doc/scope；invalidate为可丢失关闭提示，不改Grant，不把已提交授权改称未提交。API不传函数闭包或actorId，owner沿原room串行和必要原Doc校验执行，恢复提交后仍应用同一Y.Doc，RPC不回raw delta。

020要求API-only与owner-only LOGIN分离，API只有显式当前read/领域allowlist，无commit/seed/版本恢复prepare或写入/snapshot推进/lease；健康检查按角色，不能为probe给API补写EXEC。018 Cookie/CSRF继续可跨API重启复用；019当前version.read再准入在020后有意开放API受限读，不是给正文写权。API就绪核自身PG及owner依赖链，不把空房间控制health当writerReady；文档READY仍核lease/token/重放。

HTTP handler、owner原命令/Worker及API原HTTPS均await真实完成。逻辑timeout仅回原键unknown；seed同时保operationId/updateId/hash，不自动重POST。原PG/HTTPS工作保留raw guard至settle，close/drain用绝对单调期限并在完成后再核，timer迟派也不能假closed。正常API重启不停止owner；正常同owner重启不冒HA接管或DB双主证明。

WS current capabilities补偿和SSE sourcegap控制遵当前授权。SSE新GET的PG_PERMISSION_SOURCE_GAP即使HTTP503仍清通知和private评论投影；普通503不伪当撤权。原消息/提交/逐受众准入保持，连接5秒仅本地健康目标。

### 8.2 107节点本地供应链证据

唯一记录为后端 `.workbuddy/c-hVXgwL/inventory.json` 与同目录 `sbom.json`。inventory三个执行项通过：当前锁/安装/engines核对、离线SBOM包含全闭包、验证归档的离线冷安装与HTTP启动。107项记录含精确版本、manifest/安装树/许可证文件hash、生命周期脚本和原归档tarball VERIFIED/SRI/SHA256；未执行安装脚本。

冷安装在空目录、由已验证归档建立的隔离cache下用npm8.19.4完成，实际HTTP存活200、无DB就绪503，API/collab/Worker依赖可加载。不是内网registry安装、完整业务断外网或依赖供应方安全批准。SBOM为CycloneDX1.5、107组件，独立生成器为npm11.2.0 CLI（摘要见inventory），不改变项目npm8 pin。业务manifest没有发布version；只在SBOM输入副本使用 `0.0.0-local.f14e5ffc9284cab4` 标识，不等npm发布。

原归档闭包通过不代表许可证/漏洞/运行时支持批准；真实IdP、对象和翻译的离线运行依赖也未供给。后端环境验证不重打或混发公开/内网SDK包。

### 8.3 证据当前性与后续验收

| 来源 | 已观察结果 | 使用限制 |
| --- | --- | --- |
| `.workbuddy/d-3Jyk3u/evidence.json` | 真实独占领域PG51项通过 | 后续源码/测试变化前的中间来源，不代当前最终树 |
| `.workbuddy/s-rcmUVu/evidence.json` | 真实HTTP/PG会话14项通过 | 中间来源；暂停探针/注入端口与真实PG分别解释 |
| `.workbuddy/c-hVXgwL/evidence.json` | 真实双Vue2/Chromium、分进程HTTPS owner、Worker、PG35项通过，全部正常清理 | 中间来源；后续改动须最终输入指纹复核，合成IdP/服务证书非公司验收 |
| 最终统一批次 | 制品/性能/UI最终来源见§8.4；完整任务来源见[tasks最终证据索引](tasks.md) | 按原始JSON、命令、相关输入指纹和明确复用范围解释；不借中间记录标current，失败记录保留 |

操作说明见后端ops现有四份文档；完整15FR/8NFR/5SC/P01–P19追溯见[plan矩阵](plan.md#当前交付追溯矩阵t124)，126task/105AC总状态由tasks/checklist维护。表中case存在不等完整AC通过，真实并发、确认丢失、断流续读和联合回读各自需要执行证据。

外部真实IdP/目录与注销源、Java信任和业务回执、内部翻译成功链、批准格式/转换、内部对象/完成hash/下载、生产故障域/复制确认/旧主隔离/PITR外部代际、容量/保留/证书和值守批准、硬件触控仍独立阻塞。原生Safari本机六单元已取得§8.4证据，不再作为未运行项。未批准自动snapshot频率和物理清理，不凭内部repository或合成fixture补造策略。上述局部门不阻无依赖本地开发；F6缺成功链仍阻整批首发。无commit/push/npm发布/部署。

### 8.4 2026-11-08最终证据

[最终SDK制品记录](../../../../tiptap-integration-demos/apps/lark-doc-backend/test/evidence/local-final-20261108/frontend-all-artifacts-20261108-2.json)绑定前端源码`50c3512aa7cca4104cf3143a5ee6eefeb1a73c8ae395ee18bd4f93767e607a89`。原Node14.21.3/npm8.19.4 `npm run check:artifacts`完成七入口、Vditor93项及原体积检查，退出0；原只读`artifacts:check`退出0，制品戳由原构建流程生成，317个构建输入前后稳定。九个Element JS与实际UI宿主制品逐字相同；公共exports、ESM原生imports/Vue peer和原版权注释保留。Element/UMD/adapters按ES2018解析，ESM保留原现代原生模块语法。

下表是Node22.22.2、gzip(level=9)的实际字节数。仅UMD上限经用户明确批准由465000调整为480000；原超限记录保留，其余门未改。ESM主包数不包含其余三个初始chunk，总初始逐文件gzip为473244 B，不称总传输只有主包大小。

| 制品 | 实测B | 上限B |
| --- | ---: | ---: |
| Element | 471879 | 475000 |
| ESM主包 | 271096 | 285000 |
| UMD主包 | 474318 | 480000 |
| CJS全量 | 2044644 | 2500000 |
| 协同子入口 | 6404 | 90000 |

[浏览器关闭后的原性能门](../../../../tiptap-integration-demos/apps/lark-doc-backend/test/evidence/local-final-20261108/perf-after-browser-close-gate.json)七项通过：seed42、原2000块fixture、按键30/装饰20/保存10采样，Node22.22.2。原基线与>20%退化门不变；执行原测量器后直接调用`gate.mjs`纯函数，未执行`report.mjs` CLI，不据此宣称完整`check:perf`命令通过。`CPU_Speed_Limit`与`Scheduler_Limit`均100是系统限额读数，不是CPU空闲比例。结果是浏览器代理指标，不等生产SLO、并发或容量批准。

[原生Safari记录](../../../../tiptap-integration-demos/apps/lark-doc-backend/test/evidence/local-final-20261108/native-safari-2026-11-08T05-26-51-158Z-974dd400/native-safari-2026-11-08T05-26-51-158Z-974dd400.json)是Safari27.0＋原生safaridriver/WebDriver：Element/facade各edit、suggest、read六单元PASS，三项本轮执行、三项同源同制品有界复用。执行的`backend/test/native-safari-local.mjs`与记录内runner源码逐字相同；实际trusted键输入、只读、修订和双销毁见原始步骤。报告为`database:none`及本机静态宿主/合成上下文，整体因非Safari和硬件触控等仍BLOCKED。长SendKeys墙时没有paint/调度分解，不归因编辑器性能，也不代真实公司账号或后端耐久验收。

最终[浏览器UI索引](../../../../tiptap-integration-demos/apps/lark-doc-backend/test/evidence/local-final-20261108/browser-ui-final-index.json)透明投影36PASS/7BLOCKED/0FAIL，`passed:false/status:BLOCKED`。真实Chromium六单元、四项冷加载、overlay/表格/高亮块/help与Safari六单元已有实际来源；[原生ESM定点补跑](../../../../tiptap-integration-demos/apps/lark-doc-backend/test/evidence/local-final-20261108/us15-1Jw7oP/us15-3e9dd833-a35f-4df3-bc32-33b11a1a6de3.json)补齐原生模块、provider200、Vue peer、输入与双销毁。索引按scope复用原full的34个PASS，加定点目标及来源稳定两项，不称整轮重新执行。

[原full](../../../../tiptap-integration-demos/apps/lark-doc-backend/test/evidence/local-final-20261108/us15-E39aAy/us15-a09eced7-7097-4638-96e4-cfff8f2cab85.json)35PASS/7BLOCKED/1FAIL及定点父BLOCKED原样保留；两行测试预期补上既有Webpack运行时导出，生产代码与制品未变。旧粗backend hash只按独立业务v2的40项相关输入复用范围解释，不升格为全树重跑。完整AC、物理触控、真实公司业务及前述生产门仍未齐；任务状态以tasks/checklist逐项证据为准，没有commit/push/npm发布/部署。


### 8.5 2026-11-09续做44项的新增实现与验证

用户授权按项目production-v1目标配置，保留原TS/Nest/Fastify/Hocuspocus/PG/工具链；没有公司接口资料不再阻止明确内部端口实现，也不能据此虚构真实服务、人员批准或故障事实。当前新增 `recovery-authority.ts/recovery-main.ts` 和 `start:recovery-preflight`：受保护文件、固定HTTPS/mTLS/peer pin、source/target cluster-instance-systemID、restorepoint/LSN/manifest、nonce/hash、外部generation及许可/六层时效绑定。production scope也仅只读人工审阅，不连接PG、不执行恢复/切主/物理删；超时保留原raw工作，IteratorResult对象且done=true才算取消完成，取消失败隔离。真实本机mTLS、wrong-peer零HTTP正文和编译CLI已验，真实权威尚无。

真实022→029历史SQL/数据升级测试首次在 `.workbuddy/u-7Pnl23/upgrade-compat-evidence.json` 失败：非上传者首笔编辑旧附件可保留，但旧mention额外入队；失败和正常清理保留。新030不改023，通过可信前态priorMentions及已存在cut投影校验、静默baseline_suppressed墓碑修复，覆盖本次删除键，后态notify及真正新键通知不变。缺/伪prior回滚，旧receipt不补历史effects。最新 `.workbuddy/u-c4qN6i/upgrade-compat-evidence.json` **14/14** 含原022 seed重放；新代码对029及以下不ready、030后真实HTTP200，旧裸写42501。不是旧二进制/生产回退演练，前态外的迁移前删除通知历史仍不可判断，具体停流/回退边界见backend/ops/release.md。

当前Node22.13 `tsc`退出0；`legacy-mention-affected-unit.log` **215/215**（body effects、commit/room、restore、conversion、权威/TLS/profile/CLI/ops），不与其早期63或旧370相加。`.workbuddy/t-JBRT8x/evidence.json` **15/15** 覆盖真实通知Worker准入/撤权、转换导入、跨上传者版本恢复及附件保留；`.workbuddy/d-8PdgT2/evidence.json` **2/2** 为真实恢复提交/seed竞争。均独占项目0700/Unix socket PG，清继承PG环境、有限期限、正常SIGTERM并保留数据日志。宿主PG54630未操作。

新增定向浏览器case只补T073/T078本地缺口，不跑旧40项/selection orphan组；每次重新从当前源码生成fixture bundle。private-revocation覆盖保存私链撤参与者后实际刷新/重新登录、原thread/link/preference/op404、受邀前计数基线、评论区域quote/正文不残留、follow同键异payload409且不产生授权，保留独立document.read与creator对照；位置只采样刷新后显式重开，不称跨刷新选区观测。participant-race使用管理员持有自有thread行锁，观测管理者与败者实际PG阻塞PID及真实页面POST，控制撤销先提交，核回复/事件/原key和正文。浏览器JSON请求15s abort、测试排空20s且incomplete保留；这不是破坏性进程/网络故障或公司身份验收。最终run与指纹见现行resume-local-checks及task-index。

独立非实现者复核了新权威/共享加载和030事务/接线，修复取消对象类型与浏览器计数/quote/有限排空问题后，生产代码无未解决阻塞发现。原82/126、44开放仍按逐项完整条件，不把上述子项升级为T059真实执行、T061生产回退或整故事完成。真实公司服务/账号、人员/容量策略、故障域/复制/旧主fence/外部恢复代际与相应许可、实体触控和最终全AC仍分别阻塞；原DOM基线FAIL、Safari父FAIL/BLOCKED、PITR差异及旧来源全部保留。前端产品/SDK本轮未改，SDK02307e65的既有七入口/性能/Safari证据按未变范围复用，没有新构建或重跑这些无关测试。原三份正式JSON见同证据目录before-renewed44-20261109.tar.gz，现行manifest/index明确本次新执行与历史范围。


本轮联合浏览器最终证据 `.workbuddy/c-4Qd8ja/evidence.json` 1/1：race前真实PG旧授权为0，暂停该用例自有通知transport并严格限定三个HTTP命令；锁链holder75017←manager74926←reply75009←unfollow75010与200/404/404一致，旧两个operation GET404、偏好/授权/跟随事件不变。两个早期联合观测失败c-y9IFBy/c-qGEaNI均正常清理且原FAIL保留，未降级成同时发Promise就通过。独立review复核最终raw/源码无未解决阻塞；通知真实流由t-JBRT8x专项等独立范围证明，暂停流的此用例不冒全流并发矩阵。
