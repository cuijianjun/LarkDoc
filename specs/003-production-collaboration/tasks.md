---
description: "独立完整编辑器后端；126项按原验收条件分层核对，82项本地实现/测试已完成，完整故事及生产批准仍未全部满足"
---

> **2026-11-08 当前口径**：以下“当前原任务核对”是现行状态，L001–L011及早期静态/禁PG说明保留为当时记录。用户已授权独立本机PG、三进程及本地集成；不再以历史“126全部未勾选/PoC未运行”作为当前结论。每个原T项按本行要求核对，不能把局部PASS升格为完整故事、外部集成或生产放行。

# Tasks: 独立完整编辑器后端

**Input**：[spec.md](spec.md)、[plan.md](plan.md)、[research.md](research.md)、[data-model.md](data-model.md)、[contracts/backend-api.md](contracts/backend-api.md)、[上游完整AC](../../.workbuddy/output/UserStory.md)、[系统验证矩阵](../../.workbuddy/output/系统设计.md)§9。
**Prerequisites**：宪章生产审阅与B01–B09真实供给/故障域/容量门仍按plan落实，不填假Owner/SLO/RPO/RTO。早期E0与L001/L002授权随后已被明确的持续本地开发、独立PG和真实本机测试授权扩展；不连接真实业务DB，不把正常重启等同破坏性故障注入，Git提交/推送、发布和生产部署仍未获本轮授权。未完成外部门只阻其依赖，不阻已授权且契约明确的本地实现。
**Tests**：规格明确测试先行，全部故事含契约/负例/竞态测试与真实集成任务；先记录失败断言再实现，2703历史单测/2000块fixture不作新后端通过证据。
**Organization**：Setup→Foundation→P0故事（按依赖）→P1→P2→收尾。独立验收不代表无共享依赖或可单独生产上线。

## 当前原任务核对（2026-11-08）

2026-11-14 local verification: exact Node22.22.2 compiled successfully; the manifest's 65 compiled test files ran 1396 cases (1374 passed, 20 explicit PG skips, 2 failures). The missing `download` coverage fixture and a recovery test's pre-restore fsync timing assumption were corrected without changing production permission/recovery code or deadlines. The two affected files then passed 18 cases with 1 PG skip; all other valid results are reused. Logs are `/tmp/larkdoc-acceptance-20261113/h5-final-backend-node22-*`. PG environment was cleared; no PG-special flag, real PG connection, Docker restart or production action occurred. This does not satisfy T073/T083's full external acceptance.

**判定**：82项已勾、44项未勾。勾选只表示该行本地实现/测试要求已有可核对实现与证据；不自动满足所在故事的7AC、未勾设计前置或生产批准。原126编号、任务原文与依赖不改，实际实现拆分如下。`backend/`为上文真实同级后端目录，前端路径相对`lark-doc/`；静态/模型、注入端口、真实PG及浏览器合成身份分层记录。

| 已完成原任务 | 实际入口/判定依据 | 验证范围与保留门 |
|---|---|---|
| T014/T015 | `test/integration/schema.test.ts`、`src/db/foundation-schema.ts`、001–004/006及后续迁移；复合作用域、唯一键、水位/seed/receipt/token约束及受限提交 | schema原失败测试为E1模型＋DDL对照；001–020已在独立PG迁移/受限端口运行，二者不混作同一数据库测试。API/Worker直接正文写拒绝 |
| T017/T018 | `src/common/*`、`pg-commit-port`/`pg-document-gateway`、`pg-room-coordinator`/`durable-runtime`、007/009/012/018/020及owner统一队列 | 可信session_user委托、当前共锁复权、有限发送/事务、COMMIT确认、unknown/隔离、token/epoch最终门；真实IdP及生产故障验证不在本项完成声明 |
| T021–T023 | 002/008、`modules/resources/pg-resources.ts`、`local-runtime.ts`、前端资源provider/`DocumentSession.js` | create/bind/query/unbind/deletion-intent、actor幂等、来源revision、独立grant和不物理删；domains真并发/资源自身审批同次正常PG重启，browser原键确认丢失查询。真实Java归属/生产保留未批 |
| T027/T029/T030 | 009/012/018、`modules/permissions/pg-permissions.ts`、gateway/currentAuthorization、`durable-runtime`、授权provider/Session | 来源grant/authz、Cookie/CSRF跨实例、受限ticket/原生续票、空闲WS 2s复核/绝对期限、SSE sourcegap清投影；5s为本机样本目标，非生产SLA。真实IdP注销/授权事件源未供给 |
| T034–T039 | 003/004/007/010、`collab/pg-snapshots.ts`、固定kind Worker、owner/受控桥及原collabMixin/Session | 正文/receipt/操作同事务、并发唯一seed、空initialized拒旧草稿、snapshot+tail/hash/CAS与损坏拒绝；显式pending快照恢复只按原QUERY清匹配，原Y.Doc/未知隔离保留。无策略不清日志，自动快照触发频率未定不作T037必要条件 |
| T043–T045 | 011/019、`modules/versions/{pg-versions,content}.ts`、Worker、owner capture与versioning provider/UI | 真实不可变Yjs/PM两hash、cut、原操作、只读+version.create、最终version.read准入；审批冻结不随正文变化，不代表真实Java审批联调 |
| T049–T053 | 013、`modules/restores/pg-restores.ts`、`collab/restore.ts`/owner串行、桥/原restore/UI/anchors | 显式历史保留delta、原子pre/post/epoch/update/receipt、双最终提交CAS、seed竞争、旧pending先于baseline隔离导出及attached/orphaned；同Node单slot与真实DB双提交测试性质分开，无JSON重建或换原活动Doc |
| T057 | `src/ops/{health,metrics}.ts`、runtime/owner/独立Worker入口 | 按API/owner/Worker实际依赖判断，writer资格须已重放＋活租，未启用Worker不冒ready；原在途和raw检查实际settle后有限排空，绝对期限、防PII固定指标。API可服务读不冒有活动writer，未作HA声明 |
| T062/T064 | 前端`test/unit/production-evidence.test.js`/`scripts/production-evidence.mjs`、后端`test/evidence/schema.json` | E0–E4/身份类型、源与工件摘要、原始步骤/限制/预算/失败保留/AC索引已实现并有工具测试；结构存在不自动批准真实浏览器、性能或生产，也不把待形成task-index当已校验 |
| T070–T072 | 014、`modules/comments/{pg-comments,anchors}.ts`、原评论provider/面板/Session | document scope null anchor、selection真实相对锚点、当前private creator/participant、本人改删、resolve/reopen、参与者、CAS及操作/outbox/tombstone；真reply/撤participant竞争，不向公共Y.Doc写private |
| T076/T077 | 015、`modules/follows/pg-follows.ts`、原评论provider/面板/稳定链接 | 只读follow/mute、原op幂等/unknown、current private、orphaned不误定位；关注/取消与撤read真竞争，关注不产生grant/participant |
| T086–T089 | 016、`modules/notifications/{pg-notifications,sse}.ts`、`worker/{leases,outbox,main}.ts`、通知provider/UI | 每用户提交序/范围游标/当前private、快照续流/410/偏好、真Worker token/有限retry-quarantine和sourcegap控制；两候选进程仅一个资格赢家，同合法process两连接COMMIT可见性无空洞，未宣双active HA或外部邮件送达 |

**前轮历史证据快照（本轮已改源码；仅所列不受影响范围可复用）**：backend `.workbuddy/d-YCBJ7q/evidence.json` 真实独立PG **62/62**、`.workbuddy/s-HBAk0U/evidence.json` 真实HTTP/PG **14/14**均正常停库；`.workbuddy/c-pxkB59/evidence.json` **40/40**真实浏览器/HTTPS mTLS三独立OS进程/PG、11项cleanup正常。最终业务复用索引 `test/evidence/local-final-20261108/browser-business-final-reuse-index-v2.json` 将五项变化逐一限定：原401输入中396当前字节相同，五项为预算元数据、该独立fixture不读取的ESM构建分组、块句柄冷挂载计时器及只加稳定原生边界的Editor模板；不伪称40项重新执行或401项完全相同。合成身份及正常重启不提升为真实IdP/灾难故障验收。当时后端967项=961pass/6历史stock expected-red skip。

**前轮历史单元快照**：前端1989项=1773原未受影响项+196后续目标旧项+19当前冷面板/计时器项+1最新默认矩阵契约，保留同名参数化例的原ordinal，不将历史复用算新执行；目标213中16项新冷面板由当前19替换，原1970全部保留或明确替换。最新矩阵Vitest whole failed/E2 failed均保留，仅E1 passed一项进入单元索引。源与对应测试未变的范围复用，源变化部分附专项红绿/真实DOM验证。Node14 core/contract与lint通过；Node14架构工具因现有lib0 WebCrypto要求失败保留，Node22.13工具链架构检查通过，不改原依赖或宣称Node14该项通过。

**前轮历史制品与性能快照**：`frontend-all-artifacts-20261108-2.json` 为真实Node14/npm8原 `check:artifacts`（七入口/Vditor93）及只读 `artifacts:check` exit0；317构建源与38制品SHA匹配，原流程自动更新stamp。Node22 gzip：Element **471879≤475000 B**、ESM **271096≤285000 B**、UMD **474318≤用户批准480000 B**、CJS **2044644≤2500000 B**，其余门限不变。`perf-after-browser-close-gate.json` 原2000块/seed42、30/20/10采样和20%门七项PASS，原baseline未改；使用原gate.mjs纯函数核独立结果，未声称运行固定默认结果路径的report.mjs。旧失败结果保留，不把这些代理指标视为生产容量或SLO。

**前轮历史浏览器汇总**：Safari27/macOS15.8.1六cell功能已有原生safaridriver PASS（本次三项、同源同Element复用三项），自身session/driver/server正常关闭；永久入口为 `backend/test/native-safari-local.mjs`，与实际执行字节相同。慢原生SendKeys未有transaction/paint归因，不宣称Safari性能通过。当时Chrome六cell、四冷面板及其余overlay/结构/help均通过；原生ESM遗漏既有Webpack运行时导出的断言修正后，仅目标探针补验通过，生产源码/制品未变。`browser-ui-final-index.json` 为36 PASS/7 BLOCKED/0 FAIL的透明合成投影，原full FAIL与目标BLOCKED均保留，投影整体仍BLOCKED，不冒完整矩阵PASS；物理触控硬件尚未执行。全部原始结果及126/105索引统一在 `backend/test/evidence/local-final-20261108/`，索引校验只核来源与映射，不代完整故事或生产批准。

Java 接管接口补齐（2026-11-10）：保留现有5条入站集成路由与2条出站回执接口，新增035来源细权限上限/投影及正式OpenAPI、接管说明；新真实mTLS/PG 15/15、27响应schema校验、受影响86/86和Node22编译通过，独立审查无阻断。证据 backend `.workbuddy/java-business-20261110/verification.json`。仅隔离PG应用035，现有演示PG保持原状态，前端源未改不重建SDK。Java业务实现、JVM/真实公司服务联调和生产验收仍独立；不自动迁移独立授权、不机械勾原T项。

### 2026-11-10 续接：三种主题与原生菜单入口

右上角“文档操作 → 主题”增加经典绿色、飞书浅色、飞书暗色三选一，默认保留绿色。复用原主题控制器，三参 preset/API、Element `theme-preset` 热更新与显式 `themeStorage: local` 记忆；本地预览已启用记忆，SDK 默认仍不写存储。主题不改作者内容色、协作者区分色、危险色或文档内容。暗色评论/分享样式随各自懒入口加载；修复滚动迟到导致主题子菜单关闭、窄窗目录遮挡和隐藏页头时原生菜单收纳入口不可达。

最终 Node22 受影响11文件244项、quick通过；可选Node DOM快照因该进程未配置Playwright路径跳过，另有下列真实SDK浏览器验证，不把跳过算像素通过。主题105组=103通过/2历史豁免/0失败；颜色输入未变范围复用。Node14七SDK/Vditor93/原体积门通过，最终指纹 `dee35417c1f9aa502462d689d8859f60f0de125b`，UMD479974B/Element465538B，未放宽预算。此前83文件2618项是本批较早整合结果，不冒最终菜单修改后的全量重跑。

同一最终SDK：主题 facade `e-KbzoRy`3/3、Element `e-DGWoAq`3/3；共享菜单 `e-WWU6pR`3/3、`e-v1CwNU`3/3；全文评论 `e-MLjUGI`4/4、`e-Q4hnuC`4/4，共20次focused检查执行（含跨入口/重复启动，非20种独立用户场景）。含原输入草稿/作者色/正文摘要保留、0评论POST、暗色弹窗/打印浅色、刷新记忆、只读键盘、迟到scroll、360px及隐藏页头/非固定工具栏/目录开关重开。各环境10项正常清理，后端130源码/配置及86编译文件与原未变范围对应，全部失败证据保留。非实现者只读复审，无阻断问题；测试/浏览器/进程由主线程统一执行。

50036已先重核实际双端pending/所有隐藏草稿，再正常SIGTERM旧48006（10项清理正常），从最新停止 `e-OGukmc` 复制到 `e-xtRsq1`；自有supervisor69605，原Chrome4305/4306和CDP50388/50389保留、环境持续运行。实际当前8评论线程（不是旧交接7条）、正文及评论摘要、表格、36迁移和1附件对象均保留，缺对象0；双端ready/pending0/errors0/inert=false。原窗实看三主题和暗色全文输入框40px/hover设置，恢复默认绿；双向具名光标/选区无需刷新，当前app.js与新预览文件一致，467输入与六SDK验证一致。

证据：`backend/.workbuddy/ui-business-20261110/three-themes-verification.json`；旧全文评论/续票证据保持各自来源范围。仅复用既有实测飞书色板，本次没有完整真实飞书暗色像素比对，不宣称全量1:1。原90项复核、126编号/依赖及82勾/44未勾不变；短身份/读取稳定性、全撤document.read后的自动重新授权、完整真实飞书矩阵及真实公司外部验收继续分别保留。

### 2026-11-10 续接：US7 全文评论输入框与交互（当轮快照，当前环境见上）

按现有真实飞书参考页分别核对全文评论，未把选区评论/回复输入框当作等价证据。新增 lazy `DocumentCommentComposer.vue`：无作者行、空/聚焦40px、单行总80px、两行输入92px/总132px，14px/22px文字与原灰色占位；图片/更多20/18px、发送取消48×28、私有开关40×22、更多菜单278×92。悬停打开且不抢输入焦点，离开约500ms关闭；Esc保草稿、取消清空并回焦点、长文40vh内部滚动。原图片上传/取消/unknown原键、权限代际与私有参与者策略继续使用既有链路；私有设置不借用选区草稿，不向公共正文写入评论。

当前 Node22 受影响9文件398项、quick及主题检查通过；Node14七SDK/Vditor93/原体积门通过，指纹 `90d5d562`，UMD479990B/Element465416B。同一SDK facade `e-0w3gx8`4/4、Element `e-uMDMUZ`4/4；相关图片/取消原键/私有可见性回归 facade `e-gVJulx`7/7、Element `e-uiKK4v`7/7，合计22次focused检查执行（含重复启动及跨入口，非22种独立用户场景），每环境10项正常清理。新产物实际断言已捕获并修复CJS晚注入样式覆盖及基础按钮min-height30撑高；全部失败环境保留。只读独审无P1/P2，非独立执行。

当前50036已从最新停止的 `e-XKqh4y` 复制到 `e-OGukmc`；升级前重新核两端pending/隐藏草稿并正常SIGTERM旧26020，当前自有supervisor48006，原Chrome4305/4306保持。正文及评论内容摘要、7线程ID、表格、36迁移/1附件对象均保留、缺对象0；两端ready/pending0/errors0/inert=false，输入框40px、hover菜单和双向具名光标/选区实核，新app.js与当前源一致。

证据：`backend/.workbuddy/ui-business-20261110/document-comment-verification.json`。边界：media facade此前 `e-hba6Lu` 短租约过期、`e-UnnaF5` 状态读取挂至总界均保留；给读取加15s有限等待并启用既有profile后本次7/7，不声称时序/稳定性根因已修。LIVE首次同时登录也出现3s身份预算耗尽，顺序显式登录恢复，未放宽身份期限或修改生产身份代码。全撤document.read后的自动重授权、完整飞书像素/菜单矩阵和真实公司生产条件仍未完成。原90项复核、126编号/依赖与82已勾/44未勾不变。

### 2026-11-10 续接：T107 授权刷新与原转换键

本地实现与验证：连续已认证同主体的 CSRF 轮换仅保留原转换 GET 元数据；Session 的晚成功/异常跨复权只回 unknown 与原键，未知身份、ABA、Provider 替换/替回及销毁继续退休旧键。导出首次执行后同步监听身份/Provider 失效，旧 Session 事件不能取消新 Session 本地导出。复用既有转换懒模块，无新依赖或预算放宽。

当前源码 Node22 受影响 14 文件/922 项（含转换 145 项）及 quick 通过；Node14 七 SDK、Vditor93 和原体积门通过，指纹 `32166bc9`，UMD479990B/Element465416B。当前 SDK 与真实 HTTPS/独立 PG：`e-4uX3cn` facade2/2、`e-MDXmIs` Element2/2，原 POST 响应被持有后复权→只 GET 原键→校验下载 hash、PG 单任务；共享身份/协作/评论/附件 `e-4bZz5q` 27/27。每环境10项正常清理，数据日志保留。后端130源码/配置与86编译文件对原 `e-WcY9k6` 无哈希差，只复用未变范围。只读独审无剩余P1/P2，不称独立执行或生产验收。证据：`backend/.workbuddy/ui-business-20261110/renewal-verification.json`。

原90项复核、126编号/依赖及82已勾/44未勾保持，不用浏览器数量充当任务完成数。此节替代下方旧“versioning 转换原键需另批核实”的局部断点；全撤权后的自动重新授权/恢复仍是本地待验，完整飞书菜单/弹窗1:1仍未验；真实公司接口/凭据、服务器与生产条件另列，不据此宣称全部本地完成。

### 本轮对原90项的逐项复核（本地开发及受影响统一验证已收口，完整外部验收未完成）

上一轮“无可本地继续项”的结论过宽。本表逐一覆盖当时未勾的90个原T项，区别**已开发、只具安全拒绝、真正未开发，以及本地验证缺口**。外部“契约缺失导致尚不能实现”与“代码齐只待验收”也分开记录；不把503 stub当完整生命周期，不把后续故事外门加到纯测试编写任务。原task描述和依赖不变，下表是执行核对，非全部完成声明。

本地开发口径纠正（2026-11-09）：前次将生产条件不足过早当作本地收口理由，现继续补齐两项实际执行路径。T059新增编译后的LocalRecoveryExecutor/独立journal及实际自有PG正常停源→WAL只读恢复→六层对账→原键/异键与重建执行器校验，b-ICxLPu1/1、11新单元及3隔离PG生命周期负例通过；T121新增可执行本机容量轨迹，c-17ny6n固定128段/gc:false、20串行+20四请求突发40写全部提交，实测候选/重放/快照/WAL/队列并正常关闭。它们的本地实现不再标“未开发”，生产控制面接入/目标硬件与真实验收另外待办，无须用户继续提示。下面原82勾/44未勾是包含生产完整AC/前置的原任务状态，不表示44个代码模块未开发；旧前端/SDK/浏览器/性能在相关输入未变范围复用，未重跑为新源码整树绿灯。

最新实时交互补核（2026-11-09，本轮协作/评论及T108/T114/T115/T116增量）：新增受控光标/选区/真实身份头像、PG031提交NOTIFY到当前私密投影WS失效信号、事件合并GET（无客户端轮询），评论选区侧栏与全文页尾、跨段/mention两端相对锚点和严格正文根校验。修复共享node_modules的Webpack缓存跨快照污染，cache.name增加源码根哈希；新七入口/Vditor93/size通过，当前stamp **2a551367**。前端受影响461及配置守卫61分别通过（重叠不相加），quick通过；后端本轮相关95通过，未把旧serial1269重新报为本轮全量。真实当前CJS/Element SDK与独立PG **e-ENgwlw 25/25**，两向caret/selection/avatar、原生评论CRUD/解决/重开/跨段引用、空闲零评论GET、导入差量PUSH/HTTP响应未返回时续写pending保留和原QUERY零二次UPDATE、私密参与者及文档ACL撤销均有断言；旧列表响应被实际取消（不冒称已投递），十项正常清理保数据日志。证据见 backend `.workbuddy/feishu-parity-20261109/final-verification.json` 与 `.workbuddy/e-ENgwlw/environment-evidence.json`。验证宿主随后仅修CDP初始化失败清理，3个失败路径通过；应用源码和SDK未变，未重复25项冒新执行。

原生键盘补修最终验证（2026-11-09，替代前段本轮旧制品数字）：表格刚用系统键盘划词后立即评论，root捕获阶段曾读到PM旧空选区；现在只同步当前编辑器内原生DOM两端到公开选择命令。最小失败已留，最新受影响367/9文件及quick通过，后端95同源结果复用；全新SDK七入口/Vditor93/size及stamp **62f4fedc** 通过。当前实际CJS/Element与PG **e-PrisoE 25/25**，新增trusted表格划词后立即快捷键/quote匹配断言；10项正常清理保数据日志。最终双谷歌预览又实际完成表格评论发送→Bob回复→反向输入及表格光标，双端ready/0pending/无错误；点击原文激活黄底评论、菜单遮挡和短窗按钮亦核对。最终当前源/宿主与冻结候选字节一致及日志/截图统一见上述final-verification.json。以下冷离线/Safari/旧性能证据仍仅对应其历史制品。

最新本地UI增量（2026-11-10，替代“评论图片/表情及成员/分享尚未开发”的旧断点）：成员/分享此前冻结`member-share-20261109/revised`已完成本地路径；本轮033表情desired-state/CAS/原键查询、034评论专属图片上传/同事务引用/逐块私密读取，以及原面板的图片发送/编辑/取消/Blob预览、表情分类搜索和原生键盘入口已实现。保持原GREEN `#00b887`；取消已提交但未回执的图片不晚附草稿、不二POST，legacy非图片引用及10图读取保留；私密内容不进入公共Y.Doc。新增短ticket先返回stateless认证错误时的有限复权，保留原pending、3次/15秒上限及永久拒绝/协议错误隔离。

当前源码与冻结SDK `comment-media-reconnect-final`逐文件SHA一致，stamp **193d38d2698e07272b14cb6305904fc76bb0e7d4**，Node14七入口/Vditor93/原size门均通过；FE受影响982/22及quick通过，最后协作桥44项专项更新通过（与982重叠，不相加）。真实当前SDK+独立PG完整 **e-RkG8cq 26/26**，facade评论媒体 **e-vWO4Zt 7/7**、Element **e-crhKgy 7/7**；三轮SDK制品SHA相同，均十项正常清理保数据日志。BE源/84编译文件未变，复用同源63项与已通过主题检查，不冒称重新全量运行。源码7/7 e-N04rM5及所有旧失败保留。混源Element alias和focused facade结束条件的测试宿主错误已修并复验，full grant角色准备改为先显式复权/重开、再等ready；`manualRefresh:false`仅指撤权检测清屏，不证明完全撤权后自动恢复。汇总：backend `.workbuddy/feishu-parity-20261109/member-share-20261109/comment-media-verification.json`。可见双Chrome仍在`https://127.0.0.1:50036`，使用已验证当前source bundle，具名光标/表格选区评论/回复PUSH已实走，noTTL，不冒称SDK预览。

仍需本地继续：完整飞书1:1视觉/交互差异尚未逐项验收；原待办中的versioning转换原键在授权刷新后的query-only恢复需另批核实。全撤权后的自动重新授权通知/恢复未由本轮验收，不能算成外部条件导致已完成。真实公司服务/服务器/原生Safari与触控硬件、生产容量/恢复及批准继续按原表分列。下面历史冷离线/Safari/性能仅对应当时制品，不证明本轮增量已经重验。原82已勾/44未勾保持，不将浏览器场景数当完成任务数。

当前本地收口（2026-11-09，替代旧SDK结论）：本次新增生产v1本地TLS/mTLS服务、受保护profile和API/owner/Worker/入站/投递五独立进程，实际SSO Cookie/CSRF、身份刷新/撤销、目录、翻译、对象/扫描/转换和Java替身一起接通。真实当前CJS/Element SDK在独立冷副本和OS进程网络限制下 **e-gf4hYB 23/23**，107包从空缓存离线安装，10项正常清理；不是src回退或旧dist。12角色/模式、两入口丢确认后原QUERY零二次UPDATE、代码/图表实时UI、Worker/SSE、File上传/导入/固定版本TXT导出与审批Inbox/投递均有实际断言。旧SSE游标实际410，不冒200回放。网络只证明实际sandbox进程树的localhost/Unix规则与保留地址EPERM，不修改宿主或宣全协议穷举。

修复当前实际SDK重复ProseMirror实例，新增各入口自己的惰性 `loadCollaboration()`；修复Vue深观察PM对象、remote建议重复标记、CodeNode深watch和destroy后回调。当前七入口/Vditor93/stamp **9b1c8c4d**通过；单元按受影响951、191及最后focused103分别通过（范围有重叠，不相加冒全量），quick lint/架构/契约通过。Element458310≤475000 B、UMD471609≤480000 B，原Node22.22.2/darwin/x64/seed42/2000逻辑块/30-20-10与20%门七项PASS（P95 261.5、P99 359.5、增量4.8ms）；baseline未改。Safari27真实Element和真正主UMD facade各edit/suggest/read **6/6全新通过，无复用**，4可写单元各30个trusted输入→双rAF样本，非显示呈现/SLA、无Safari基线比较；自身session/driver/port/server正常关闭。当前原UI矩阵us15-qleAOd为37PASS/0FAIL/7BLOCKED：真正主UMD与Element六Chrome单元、冷探针/nativeESM及新Safari导入均过；6真触控与完整后端故事证据仍阻，Vitest按原完整门exit1，不把局部绿当父PASS。原P0 DOM FAIL及旧父矩阵BLOCKED不覆盖。原126仍82勾选/44未勾：只把当前本地子集完成，不把真实公司/生产/硬件/审批和生产恢复/容量验收缺口假勾。完整路径与摘要见backend `test/evidence/local-final-20261108/resume-local-checks.json`、`task-index.json`及校验文件。

前一断点历史证据（2026-11-09，02307e65制品；当前结果以上文为准）：按用户“没有资料，可按生产环境配置”的授权，保留现栈与独立进程，完成项目内部服务v1固定mTLS/受保护profile及目录、对象/扫描、转换、翻译、身份和双向集成适配；实际公司服务部署/账号/凭据与生产控制面不伪造。025–029已落地，后端当前编译及受影响单测370/370、生产adapter123/123；真实PG identity18/18、formalprofile实际mTLS/API1/1、delivery13/13、translation12/12、conversion/assets11/11、binaryupload1/1均正常关闭保数据日志。新对象上传/转换/版本范围按当前源码复验；旧失败不覆盖。前端最终受影响959/959、lint/架构/契约已过，独立源码审查APPROVE；当前SDK指纹02307e65七入口/Vditor93/size及只读stamp通过；Element458035、UMD471322、ESM256761、CJS2067655 B均在原门内，严格同基线七项性能PASS（P99 948、装饰78.7）；当前六Chrome+nativeESM父报告25PASS/18BLOCKED/0FAIL，整体BLOCKED；另原生Safari六功能按3+2+1新通过有界汇合、前两轮FAIL保留，不宣Safari性能。原P0 DOM fixture首次实跑FAIL已保留：10月24日基线早于HEAD主题/帮助/分享，非本轮新增视觉回归证据；不改旧fixture/normalize/skip，另以同demo/配置/1700×1000 Chromium完成旧新SDK逐字DOM相同（28044字符），不覆盖旧FAIL。当前T060真实备份副本与增强六层安全只读命名点PITR各1/1（b-OsPiwl→p-a7QJvb），不冒生产唯一主/外部代际/旧主fence/HA/P18。本次新增12个本地实现任务勾选，原126项现82勾选/44未勾；此表仍逐一分实现、本地验证和外部阻塞。

| 原T | 实现现状 | 本地动作/验证状态 | 真正外部门/限制 |
|---|---|---|---|
| T001 | 本地目录/Owner准备已具 | 无须重写代码 | 生产责任/访问范围待批准 |
| T002 | 技术保护与待定策略已记录 | 不填假容量/保留值 | 生产轨迹/SLO/RPO/RTO/故障域待批准 |
| T003 | 固定BOM/本地构建/107包核验已具 | 不重装依赖 | 内网源/许可/支持窗口批准待验 |
| T004 | 项目生产v1身份/目录/Java/对象/扫描/翻译/转换适配与受保护配置已实现 | 用户授权自主定义协议，实际mTLS/PG成功与负例已跑；配置参数见backend ops/deployment及backend-api§10.7 | 真实公司端点/凭据/服务实现与运营验收未提供，不冒已部署 |
| T005 | 本地安全设计与协议已具 | 已更新023/024、可信effects与postCOMMIT发送设计 | 生产安全/网络/恢复边界审阅 |
| T006 | P01–P19与AC计划已具 | 已将本次实际handler发送失败/恢复缺代际/对象与转换用例映射原T项 | 破坏故障/生产执行范围需专门许可 |
| T007 | API/owner/Worker/独立集成与真实PG骨架及空缓存离线冷副本已具 | 当前e-gf4hYB：107包离线安装、5分离进程、23Chrome场景及10正常清理；精确锁/归档/制品/SRI绑定 | 真实内网源、许可/SBOM/补丁支持审批仍待验 |
| T008 | 原入口PoC及实际beforeHandleMessage/onChange隔离矩阵已具 | 新增实际handler Sync/SyncReply step2/update握手前后、direct/plugin/worker污染隔离/禁capture已过，独审结项；双owner PG证据复用 | 生产跨机/灾难另验，不混入PoC计数 |
| T009 | 恢复PoC/历史身份/多层修复与当前023效果恢复竞态已具 | domains runner旧restore/commit入口已更新，d-CibPoW双restore/restore-seed2/2；旧42501与预检失败保留，直接恢复范围复用；独审结项 | 候选B改变在线要求仍需另批，不作默认回退 |
| T010 | 旧pending/自动sync/epoch模型、真实桥及实际room队列恢复交叉已具 | 新增实际onStateless→restoreDocument→旧UPDATE出队拒绝、未知协议HELLO已过；原模型37项有界复用，独审结项 | 真实公司来源/生产故障另验 |
| T011 | 授权锁PoC及真实PG锁证据已具 | 本行测试编写已结项；原行本地编写完成 | 真实IdP信号/SLA在后续集成验 |
| T012 | 租约/fence及安全basebackup、只读命名点PITR已具；生产灾难控制未实现 | T060 b-Rga1f6→r-uXeyXN、T120:pitr b-4pkAHi→p-ZzPO8g均1/1正常关闭；锁PoC不重复 | 实际唯一主/复制确认/旧主fence/外部不可回退代际与许可仍缺 |
| T013 | 本地协议/证据本轮已重核，生产审批未完成 | 真实源码/定向证据/旧失败已重整并独审 | 真实生产设计审批不代签 |
| T016 | 基础契约/负例已具 | 新增有限发送门纳入本次证据；原行本地编写完成 | 本行测试无需等真实公司系统 |
| T019 | 资源契约测试已具 | 本行测试编写已结项；原行本地编写完成 | 真实Java验收在T024，不挡先行测试 |
| T020 | 原竞态具备；审批引用并发已补 | 新增真实PG 3/3已过；原行本地编写完成 | 非真实Java/生产灾难验收 |
| T024 | 真实本地HTTP/PG资源链已具 | 原键丢确认/重启已有，不重跑 | 真实Java归属/凭证/审批回执待接验 |
| T025 | 14类private/角色/查询契约已具 | 本行测试编写已结项；原行本地编写完成 | 全真实读面在T031，不挡契约测试 |
| T026 | 撤权/排队/gap/准入负例已具 | 本行测试编写已结项；原行本地编写完成 | 真实权威事件源/生产耗时另验 |
| T028 | 统一private/逐受众及对象/翻译/外投准入已实现，029再限真实会话剩余预算 | 17个session入口统一预算helper；主树370单测、PG identity18/18含迟到COMMIT零private send；投递13/13及翻译12/12；独审APPROVE | 真实IdP传播/SLA及全故事验收另列；已准入在途不可追回 |
| T031 | 项目v1 IdP/mTLS、真实HTTPS Cookie/CSRF及HTTP/WS/SSE已具 | e-gf4hYB两个合成主体、4s短身份自动刷新、撤销清UI/断写、12实际角色模式通过；原PG准入负例按未变范围复用 | 真实公司身份/权威事件及全AC传播SLA仍未验 |
| T032 | durable协议先行契约已具 | 本行测试编写已结项；原行本地编写完成 | E3故障在T040，不挡契约测试 |
| T033 | seed/重放/未知及PG已具；实际handler发送失败隔离已补 | ticket-renewal新增5例：新COMMITTED/RECEIPT与QUERY/重复UPDATE发送失败红绿、原receipt零重复提交、禁写/owner、普通撤read对照；不执行kill-9 | 断点/故障模型与破坏执行许可未给 |
| T040 | 真实双用户/receipt/正常重启与实际handler发送异常回归已具 | 当前runtime/coordinator/ops82/82、owner transport12/12；端口注入不冒真实PG发送耐久 | 故障E3待T033获准，不能以正常重启代替 |
| T041 | 版本测试已有；owner污染拦截用例未齐 | 本次补quarantine/dirty live实际handler零写2例已过；原行本地编写完成 | 真实Java不挡本行负例 |
| T042 | 冻结CAS/未知/不可变引用测试已具 | 本行测试编写已结项；原行本地编写完成 | 真实Java审批在US10另验 |
| T046 | 本地冻结A后B/重启回读已具 | 保已证来源，P03按批准断点补 | 真实Java绑定及获准故障另验 |
| T047 | 恢复operation/CAS/pre-post/未知测试已具 | 本行测试编写已结项；原行本地编写完成 | 完整故事E3另验 |
| T048 | 恢复/epoch/锚点及双恢复先行测试已具 | 本次多层71回归补实原嵌套证据；原行本地编写完成 | 实际生产故障另验，不把注入当灾备 |
| T054 | 恢复丢确认消费、原键查询及原活动Y.Doc已具 | c-54Yd5E：实际restore POST已提交后隐去响应，GET确认且不二POST；双客户端重开 | 完整E3破坏故障未授权，不以正常重启替代 |
| T055 | ready/drain/无许可/分层恢复契约已具 | 本行测试编写已结项；原行本地编写完成 | 真实恢复执行在T060另验 |
| T056 | lease/terminal/旧token及本次双owner已有 | 已补隔离副本与外部generation缺失拒绝门；不伪造旧主fence | 真实DB旧主/PITR/复制故障许可 |
| T058 | 运维/安全文档已具 | ops已更新当前SDK/严格性能、发送隔离与恢复外部控制面缺口 | 获批网络/唯一主/证书运营/值守 |
| T059 | 本地执行编排/journal/原查询已实现，生产权威预检与人工许可边界保留 | b-ICxLPu1/1实际自有源SIGTERM/只读PITR/六层差异及零二次restore；新增11单元与3PG生命周期负例通过，目录/文件fsync及raw排空已验 | 真实生产控制面、外部不可回退generation/旧主隔离与生产恢复执行许可仍待接验；不因缺它们停止本地代码开发 |
| T060 | 真实在线basebackup/命名点只读回放/六层对账与本地执行器已具 | 当前b-ICxLPu→p-x35OQy1/1通过，原备份manifest绑定、本地外置journal与原键查询、源/副本正常关闭保数据；旧备份范围复用 | 不宣HA/P09/P18；真实旧主/复制/公司对象身份联合恢复与生产恢复点/SLA未验 |
| T061 | 排空/交接及022→030兼容迁移/旧正文与附件/mention基线/回退边界已具 | 原Worker屏障t-iiDRc2保留；当前u-c4qN6i14/14真实PG含旧receipt重放，t-JBRT8x15/15实际通知/导入/附件恢复、d-8PdgT2恢复竞争2/2；u-7Pnl23真实多发通知FAIL保留，030修复 | 旧二进制及生产兼容/回退、切主/复制/故障演练仍未验；停写排空后受控迁移，不让旧进程重当writer |
| T063 | 实际SDK及真实角色/模式/断线生命周期矩阵已补 | e-gf4hYB：CJS facade/Element × edit/suggest/read × writer/reader12项、两入口丢确认原QUERY零重复UPDATE、live UI1项均过；2000物理段落，不冒原性能fixture | P18破坏故障许可及生产端到端身份仍缺 |
| T065 | 当前SDK七入口与原性能门通过；raw editor/remote revision/代码节点修复已具 | stamp9b1c8c4d；严格原Node22.22.2/seed42/2000逻辑块/30-20-10/20%七项PASS，P95 261.5/P99 359.5/增量4.8ms；不换baseline | 不等生产容量；物理触控及Safari批准基线另验 |
| T066 | 当前CJS/Element Chrome角色、真正主UMD/Element Chrome及Safari功能已验 | us15-qleAOd当前UI矩阵37PASS/0FAIL/7BLOCKED，父BLOCKED/Vitest1保留；e-gf4hYB Chrome场景；native-safari-2026-11-09T02-21-46-760Z-c8476749六单元全新PASS/零复用，四写单元各30真实输入双帧样本及正常清理 | 无物理触控；Safari输入→rAF为代理量，无批准Safari基线/显示呈现或全AC通过 |
| T067 | 当前代码/真实执行已独立复核，本地限定无阻塞 | 旧DOM fixture FAIL、旧矩阵BLOCKED和全部失败证据保留；当前23链/107冷安装与六Safari逐项另验，不沿旧快照 | 完整人工安全/生产审阅及真实公司准入不代签 |
| T068 | 评论契约已有；冷读原键竞态漏测 | 本次定点红绿已补；同ID不二POST；原行本地编写完成 | 本行测试不依赖外部服务 |
| T069 | 原CAS/参与者竞争及首读原意图修复已具 | 原114受影响回归＋c-54Yd5E真实移动/删除/恢复锚点；测试编写本行结项 | 完整故事后续外验另列，非全AC生产验收 |
| T073 | 评论HTTP/双页/原操作与当前private已具，新增真实撤参与者和旧reply受控竞争 | 当前c-4Qd8ja：实际holder→manager→reply→unfollow四PG PID链、仅三HTTP请求、200/404/404；旧comment/follow原GET均404，零迟到回复/事件且正文不变；原失败保留；2026-11-13 dev HTTP+Docker：隔离真实Chrome iPhone16 393×852经.tap完成红心1/已回应、编辑@候选Synthetic alice并保存为chip、图片完整预览1179×2556及关闭、编辑附件2到0并保存0附件；来源replyRevision3。无host直接调用代替，证据 /tmp/larkdoc-acceptance-20261113/mobile-final-verified.png；非真飞书及全部AC验收 | 竞态用例暂停自有通知流并核PG旧授权已结束，真实流专项另验；全部AC/真实公司身份与批准故障矩阵仍未齐 |
| T074 | 关注/链接契约已有；首读竞态漏测 | 本次同ID/原意图保护已修验；原行本地编写完成 | 本行测试不依赖外部服务 |
| T075 | 首读/原意图竞态与真实失联链接UI用例均具 | 原114受影响回归＋c-54Yd5E链接/刷新/currentHTTP；本行测试编写结项 | 不以注入DTO替代已列真实UI，完整故事外验另列 |
| T078 | 私链/关注provider与真实浏览器刷新/撤参与者/同键异payload及取消关注竞争已具 | 新增private-revocation实际刷新原链接：thread/link/preference/op404、受邀前计数基线及评论quote/正文清理，独立document.read保留；c-4Qd8ja实际迟到unfollow404且原偏好/授权/事件不变 | 位置仅刷新后显式重开无跳动，不冒跨reload采样；整故事AC/真实身份与批准模型仍另验 |
| T079 | 持久task/actor-source-language缓存与原op查询、真实mTLS适配/HTTP契约已具 | t-6iCDN4 T0793/3：API LOGIN+CookieCSRF+实际mTLS pending→ready、同键异语言409、readiness ACL；先行测试本地结项 | 项目v1协议由用户授权；真实公司服务与T083整批另验 |
| T080 | 在途撤private/源改删、unknown/重复结果/多语言与身份隔离竞态已具 | t-YCEC5M9/9：真实PG撤权/改删、prepare/admit丢COMMIT确认零POST、重复异结果、迟到零send；独审通过本地编写结项 | 合成身份与注入端口只作本地证据，不代表公司F6成功 |
| T081 | 025持久任务/原键、有限事务外外送及结果前当前private/source CAS、生产mTLS配置已实现 | backend tsc、T079实际mTLS HTTP3/3与T080真实PG9/9；独审本地实现通过 | 无配置保留503整批blocked；真实批准endpoint/凭据与部署未提供，T083仍阻 |
| T082 | 成功译文、来源/过期/blocked/failed/unknown及原键查询UI已实现 | 每await后核当前Session/身份/provider/语言/原源；失权清缓存和迟到不回填；前端当前959/959及独审，当前SDK七入口/体积/stamp/严格性能已过 | 项目v1本地成功不等真实公司F6服务验收，T083保持独立 |
| T083 | 生产v1翻译适配、持久task及真实浏览器成功链已具 | e-gf4hYB在实际SDK中创建private comment，经API/mTLS pending→原query→ready并观察Worker/SSE；原PG撤权/源改删范围复用；2026-11-13 dev HTTP+Docker：真实Chrome iPhone16经.tap提交pending、关闭面板、恢复按钮查询原任务到ready，页面显示[synthetic] fixture translation且原文不变；截图 /tmp/larkdoc-acceptance-20261113/mobile-final-verified.png。最终全量3293/3607、313既有失败/1待定，失败断言与原基线完全相同；非真实公司翻译验收 | 翻译为synthetic固定结果；真实公司内部F6部署/质量/全部AC未验，整批不放行 |
| T084 | C09先行契约测试已具 | 本行测试编写已结项；原行本地编写完成 | 不额外要求邮件或HA后才算测试完成 |
| T085 | 原commit序/唯一资格、ACK未知及自然租约接管测试已具 | t-hXROm5 2/2：原event查询零重复效果、旧process/event token拒绝；本行测试结项 | 非kill-9/跨机HA证明 |
| T090 | 真实独立Worker/SSE、private与旧cursor撤参与者链已具 | e-gf4hYB先证私有事件存在，撤参与者仍保document.read；旧游标410 expired、无泄漏且计数按当前可见集合；未声称200回放分支执行 | 完整故障矩阵/真实账号与公司源gap轨迹未验 |
| T091 | 本地IntegrationEvent契约测试已具 | 按当前冻结本地契约可结项；原行本地编写完成 | 真实Java信任契约另接，非全C10通过 |
| T092 | Inbox原子/同event/hash/审批业务键及grant/revoke真竞争测试已具 | t-AmDR7v前三passed子项＋t-xFfaHN grant1/1；fixture错误原FAIL保留，本行测试结项 | 无需真实Java才可测试；真实对端与生产ACK另验 |
| T093 | 017/pg-integration Inbox与副作用事务本地实现已具 | T092真实同event/hash/审批/grant竞争已补；不得把对端ACK当仓储未开发 | 独审确认本地事务实现行结项；真实Java消费/跨域ACK/适配不属本行完成声明 |
| T094 | 027受众投递账本、原event/hash、有限query/retry隔离、来源gap及生产bootstrap已实现 | t-oIZVDH13/13：当前version.read撤权、private过滤、真mTLS ACK/unknown、BUSY/STALE正常close、自然fence后原query接续；独审APPROVE | 真实Java消费/ACK/权威来源快照仍待对端；不凭空修复sourcegap |
| T095 | 固定mTLS独立入站进程、受保护profile及当前Inbox/审批引用已实现 | t-aWa4Pu实际profile→mTLS→PG1/1、unit33/33；独立integration LOGIN/role/tenant/source，独审APPROVE | 真实Java已部署对端与双域业务验收由T096/T097负责 |
| T096 | 项目v1生产mTLS/ACK/query适配已实现；真实Java联调未执行 | e-gf4hYB独立入站/出站进程及实际mTLS Java替身，审批错误hash404零Inbox、重复原结果与PG账本已验；仅本地E2 | 需要真实Java测试地址/凭据/持久副作用实现与真实业务联验；不冒替身即Java |
| T097 | 审批冻结/Inbox/双域替身本地集成已具 | e-gf4hYB实际文件冻结后导出、Java mTLS审批原键/重复及投递ACK账本通过；Java替身内存账本不证明重启持久 | 真实双域持久结果与对账依T096实际对端 |
| T098 | typed目录与项目v1 mTLS目录适配、持久原键/private/不自动授权契约已具 | 先行本地测试、实际transport负例及当前backend回归完成 | 真实公司目录可见规则/账号数据与部署待验 |
| T099 | 旧源/原键/private/分享竞态与023可信receipt通知意图测试已具 | 目录生产适配已接Worker purpose，固定当前context，普通outbox不被缺目录阻塞 | 公司目录/通知真实送达另验，本地不伪造notified |
| T100 | 当前目录可见性、真实正文提取、receipt/intent/通知及030历史前态静默墓碑已实现 | 本轮215受影响单元与t-JBRT8x真实T102通知/晚回撤权通过；u-c4qN6i首编辑旧提及静默/新提及一次/删除再插不重发/缺或伪prior回滚 | 迁移前已删除且不在可信前态的提及历史不可推断；真实公司目录和完整送达另验 |
| T101 | 原mention/分享provider真实当前身份、失败/unknown/原键与清理已实现 | 959受影响覆盖同步identity/prop ABA、私有Map失权/dispose/替换清理与旧ID只query；同身份通知订阅保留；独审APPROVE | 真实公司目录/身份与送达另验，不用候选查询冒通知已送达 |
| T102 | 目录解析、正文receipt/mention意图与C09本地闭环已具 | e-gf4hYB实际SDK mention选择→持久正文receipt→独立Worker→收件人通知通过；旧PG竞争与030旧前态按未变范围复用 | 目录是本地合成数据；真实公司可见规则/账号与完整增强AC未验 |
| T103 | 显式格式策略/任务/来源/实际字节/verifier/下载先行契约已具 | conversion-lifecycle与原conversion用例通过；缺配置仍503；本行测试结项 | 真实批准格式/限额/适配仍未供，typed本地契约不冒批准 |
| T104 | 同键异文件/来源、持久pending/failed、owner未知/EOF/坏块先行测试已具 | E1生命周期8项＋t-97ykdp T1087个真实PG场景含sourceCAS/mTLS唯一receipt；本行测试结项 | 真实对象/转换服务协议另验 |
| T105 | 024持久转换任务、生产mTLS转换/对象/扫描及实际EOF/hash/version安全链已实现 | 当前T108/T114 t-Ri2upO11/11，typed业务链+实际owner mTLS；固定source/CAS和重启原query；适配transport/profile单测通过、独审APPROVE | 真实转换服务/对象服务部署及实际批准格式联验未成，无配置仍503 |
| T106 | 真实diff、固定version导出与唯一owner导入/sourceCAS/bodyeffects/receipt已实现 | t-Ri2upO11/11：真实PG/import receipt保原Doc历史、bytes hash、坏块零send、撤export与重启原task；独审APPROVE | 实际公司格式字节/转换器和存储联验在T108，不宣全格式成功 |
| T107 | File→实际字节上传→ready asset→原sourceCAS import、真实diff/导出/核验取件已实现 | 117导入/版本测试与最终959；异步前捕epoch/revision/seq，pending只查原upload/conversion，取消与同tick ABA清File；独审APPROVE，最终SDK七入口/体积/stamp通过 | 本地合成端口/SDK探针不冒真实公司转换或完整E3 |
| T108 | 生产对象/扫描/转换适配及实际SDK File导入/固定版本取件链已具 | e-gf4hYB实际File bytes→mTLS object/scanner→owner import→freeze→TXT export SHA逐字核验通过；原PG生命周期/未知/CAS保持未变范围复用 | fixture仅TXT/显式白名单，真实公司批准格式/转换器部署、全格式及E3未验 |
| T109 | ready/rejected/deleted/ref/hash/Range及实际原byte上传先行契约已具 | 对象/scanner生产适配已实现；本地EOF/hash/逐块背压和T114用例通过 | 实际公司对象服务部署、扫描策略与全媒体硬件另验 |
| T110 | DB/对象部分失败、unknown/原键、撤权、引用删除竞争测试已具 | t-y5YaFX原竞争范围复用；新增实际HTTP→mTLS对象/scanner→PG当前t-1xuCCZ1/1 | 真实对象运营/保留政策仍外部，不自动物理删 |
| T111 | 022/023完整资产状态、真实对象mTLS/扫描上传、当前/版本/hold复合引用与禁物理删已实现 | t-Ri2upO T1144/4+当前t-1xuCCZ1/1实际bytes；来源cut/跨uploader恢复、正常重启；独审APPROVE | 公司服务部署/物理保留政策与全部媒体验收另列 |
| T112 | 实际binary HTTP开始/完成、原GET恢复和Range/current每块有限授权代理已实现 | t-1xuCCZ1/1真实HTTP/mTLS对象/scanner/PG：非uploader零PUT、hash错拒绝、扫描/丢ACK原GET无二PUT、流中撤session无ready；预算29已复验 | 真实公司对象服务与凭据未部署；已发送字节不可追回 |
| T113 | 实际File bytes/SHA上传、ready引用/unknown原GET、原媒体与模式及身份清理已实现 | 前端959含legacy清理、版本reset和公开begin/complete墓碑；原媒体uploadMixin及Workspace File入口已接，最终SDK七入口/体积/stamp通过 | 公司对象成功验收在T114；无配置如实标识，不编造URL |
| T114 | 当前附件HTTP/逐块复权、引用/恢复及SDK File链已具 | e-gf4hYB真实File/扫描/对象/转换与模式场景通过；原t-Ri2upO/t-1xuCCZ仅按后端未变范围复用；不丢旧失败 | 本地scanner只认fixture白名单，不等真实AV/公司保留策略、全部媒体及硬件 |
| T115 | 生产v1独立进程/SDK/身份/翻译/目录/对象/转换/集成本地已汇合 | e-gf4hYB当前冷副本SDK23/23与10正常清理、七入口/Vditor93/严格性能及新Safari6/6；受影响单元按分组记录不重复凑总数 | 真实公司IdP/Java/F6与完整故事/批准故障AC尚缺，不放行首发 |
| T116 | 当前private清理/身份撤销/对象与翻译准入和本地实际SSE已补 | e-gf4hYB新私有thread先可见再撤销身份，清UI/caps断写且Alice仍有效；参与者撤销保doc读及旧cursor410；后端逐块门旧证据有界复用 | 全权威源/公司账号传播SLA及全部端到端负例仍未验，已发送字节不可追回 |
| T117 | 原durable恢复/LIS身份与安全本地PG/WAL命名点回放已具 | 当前只读PITR正确回读seq2无seq3；PG历史/receipt/正常重启与恢复锚点浏览器范围限定复用 | 获准P01-P09破坏故障、复制/旧主fence模型与外部代际未供 |
| T118 | 当前独立Worker/SSE/Inbox、提及/对象/翻译/投递本地链已汇合 | e-gf4hYB同源文档实际mTLS+PG Inbox/原query/ACK账本及Worker/SSE；旧PITR差异证据保留，不称跨域全部一致 | 真实Java/公司服务持久副作用与完整生产事件轨迹未验 |
| T119 | 107包空缓存离线冷安装、当前SDK及OS进程树网络限制联合验证已具 | e-gf4hYB：源码/dist/制品/策略摘要、独立冷进程、外层sandbox与EPERM负例、实际SSO刷新/编辑/附件/翻译/Worker均过；详ops/supply-chain | 宿主浏览器/构建工具未冷封装；真实内网源/许可漏洞审批、服务器规则和真实公司服务断网链仍缺 |
| T120 | 本地恢复编排、真实WAL/新只读目标/持久原操作与六层差异已实现验证 | 当前b-ICxLPu1/1，执行一次且重建执行器只查原结果；对象缺失/身份撤销/外域ACK领先保持needs-reconciliation，零重投/mint/promotion；正常排空关闭 | 生产控制面/唯一主/复制/不可回退代际及目标服务器演练待接验；不把本地随机控制generation当生产权威 |
| T121 | 可执行本机容量基线已实现并实测，生产容量验收另列 | c-17ny6n：128段gc:false、20串行+20四请求排队突发共40写/0拒绝；实测候选复制/提交分位/重放/快照/171464B WAL/41历史/43未认领outbox，正常关闭 | 这些是本机固定负载数据；目标硬件、真实轨迹/SLO/复制与长期成本后续验收，无须先提供服务器才开发测试 |
| T122 | 当前制品原预算/七指标、Chrome真实SDK角色/真正主UMD原样本矩阵和双入口Safari已验 | 当前us15-qleAOd37PASS/0FAIL/7BLOCKED，声明源/SHA加原stamp时效，不冒密码学构建签名； Element458310≤475000 B；SDK9b1c8c4d原七指标PASS；Safari6/6全新通过、四单元各30样本，旧FAIL与父BLOCKED均保留 | 真触控硬件、完整故事/生产矩阵、批准Safari基线/SLA及旧DOM baseline审阅仍缺 |
| T123 | mention/转换/资产与生产v1适配、SQL/HTTP/前端生命周期本地汇合 | e-gf4hYB同一真实SDK/独立冷进程上完成目录→通知、File→导入→冻结导出与身份清理；严格性能/六Safari已通过 | 真实公司目录/全部格式媒体与全部增强AC/P19未验，不称增强完整通过 |
| T124 | 126/105索引及原90表按当前源码分层更新 | 当前23场景/冷107/七指标/新六Safari的SHA与实际断言可追溯；旧快照/失败保留且stale标历史；独审不代批准 | 完整E3/E4及实名责任审阅仍缺 |
| T125 | release准入文档已有 | 列清实际已做/未开发/外部门，不自动放行 | 真实生产审批/值守/故障批次批准 |
| T126 | 本次补本地恢复/容量执行路径，原90表及126/105索引继续更新 | 原82/44是完整原任务门状态，不能当44代码未做；本地可执行实现/实测与生产接入验收分列，相关输入未变旧SDK/浏览器/性能证据有界复用 | 不以生产手续阻止本地开发；真实公司服务/服务器硬件/生产控制面与正式验收在对应阶段落实，不commit/push/部署 |

## 编号迁移、格式和路径

旧48项全部从未执行，旧T001–T048编号**失效**。本文件T001–T126为重新排序的新编号，重名不表示继承历史完成/授权；只存在本套有效任务。旧T001–T008/T043–T048迁Setup/Foundation/US14与收尾；旧T009–T014迁US3；旧T015–T018迁US2；旧T019–T028迁US7/US8；旧T029/T038迁US15；旧T030–T037迁US4/5/6/9；旧T039–T042迁US1/10/11/12/13与收尾。新US1是资源绑定，不能按旧US1保存含义执行。

任务格式`- [ ]/ [x] Tnnn [P?] [USn?] 描述含路径`；Setup/Foundation/收尾无故事标签。[P]仅同一故事测试对在共同前置完成后并行，不能跨阶段盲并行。每项行尾依赖为本文件唯一有效图；此外所有执行任务受明确授权和B门约束。

用户已确认采用独立后端仓库，且已有维护团队或负责人；本地位置已确认为`/Users/cjjxw/codex/tiptap-integration-demos/apps/`下与lark-doc同级；项目名`lark-doc-backend`已确认，目标路径为该父目录下的`lark-doc-backend`；用户选择“由我负责并补充分工”，登记为技术责任人。用户已明确确认兼任TypeScript/Node.js编辑器后端长期维护Owner；替补、Java/DBA/平台/安全分工及访问范围仍待补齐，T001保持部分完成、未勾选；远端地址暂不阻塞纯本地准备。`backend/`为plan规定逻辑前缀，按最新本地开发裁决映射已创建的同级`lark-doc-backend/`目录；L001历史mjs与L002正式TS/Nest＋FastifyAdapter本地边界均已创建并验证，固定本地依赖与锁文件已安装，未初始化Git。原任务保留生成时的逻辑路径与依赖；实际已形成common、受限PG repository/迁移、owner、Worker与前端provider，不能因实现拆分或改为pg-*文件就推断未做。下方核对表映射真实入口；新编辑仍须读取实际源码。`backend/test/evidence/`现已有schema和本轮报告目录，不再统称未来产物。逻辑路径/模型的存在也不自动证明真实集成；完整T003/T007的内网源、许可/生产支持审阅与外部门另核。

## 最新开发准入裁决（2026-11-06）

用户明确“跟实际负责人没有关系，我来安排就行，你继续按照顺序执行任务 可以开启多agent执行任务”。人员组织与具体分工由用户统筹，不再以人名/替补/专业角色标识缺失阻塞本地开发。T001本地路径、用户维护责任及开发组织准入已确认；继续T002及后续技术准备，不重复索要人员表。原T001生产交接字段不伪填，不把此裁决说成真实集成/生产审批已完成；T002等后续项区分开发技术假设与生产实测目标，部分准备不冒领整项完成。真实DB/故障注入/部署/Git操作仍须具体授权，实际技术依赖与测试门继续有效。下方历史“人员未齐阻开发”表述在此本地范围内失效，原126项生产/真实集成验收状态不自动继承成功。

## 已批准的本地准备分支（不计入原126项）

用户明确选择“拆开并继续本地开发（推荐）”，允许用户作为本地开发责任人先做隔离代码和针对性测试。`backend/`映射到`/Users/cjjxw/codex/tiptap-integration-demos/apps/lark-doc-backend/`；下文历史禁止本地开工的表述在此范围内被覆盖，生产准入不变。

### L001：历史原生ESM本地边界（已完成）

以下记录L001当时的无依赖授权、npm test入口与7/7证据，不是当前TS测试命令；L002安装与最终证据另列，不追溯混算。

- [x] L001 创建`backend/package.json`、原生ESM API/collab/Worker启动边界与针对性`node:test`测试；无需安装依赖，API就绪保持503，协同与Worker明确未就绪。仅验证本地边界，不宣称TS框架/真实PG/协同/可靠保存实现。不得以L001勾选T007；安装、DB、PoC故障注入、部署与提交推送均不在此项授权中。

L001本地证据：Node v22.22.2（仅当前测试运行时，非生产冻结）；`npm --prefix /Users/cjjxw/codex/tiptap-integration-demos/apps/lark-doc-backend test`作者及主助手均执行7项全部通过，0失败/跳过。独立验证最终结果已收到：验证者实跑新增第7项前的6/6测试，另执行39条真实回环HTTP请求（含正式startApi非零端口及keep-alive关闭）、35组非法配置、4模块无副作用导入与9个非法配置入口子进程，报告范围内无缺陷，最终无持续TCP资源。最新7/7为主助手亲自复跑，不记作验证者运行结果。不覆盖端口占用、信号、DB或故障注入。实现者最终运行发生上游空响应流故障；本地文件及主助手测试结果已独立核实，不据该失败推断未完成工作成功。7个文件为`package.json`、`.gitignore`、`src/{config,api,collab,worker}.mjs`及`test/boundaries.test.mjs`。HTTP为真实回环临时端口；此结果只覆盖启动边界，不覆盖文档业务、框架、数据库或生产可靠性。

### L002：正式TS本地边界（已完成，仅本地范围）

**L002当时最终摘要**：Nest common/core/platform-fastify11.2.8；直接Fastify5.12.7及adapter父级定向override同版；reflect-metadata0.2.2、rxjs7.8.2、TypeScript5.9.3、@types/node22.19.15。固定锁树78节点，最终package-lock.json SHA256为`f130920f4933df992b9907b36adc39b8f7e55a5222422b178d78cfe122bcdde3`；Node22.22.2仅本地运行时。实现者fNkTbr的typecheck/build/正式TS node:test8/8均exit0；IlYNiQ全量audit exit0、total0由主助手核验；独立wSjiMF24次真实HTTP、aCqQmf10次inject（非TCP）、qNQLDk3项插件范围两正一负均exit0。三组独立关闭均显式finally app.close，未测信号，不外推signal能力。本次只归档，不重跑以上命令；完整最小BOM与证据边界见[research](research.md) §3.3。

L002已勾选不改变原T001–T126全部未勾选；真实PG、P01–P19 PoC、业务及生产均未验收。audit0非生产安全认证，adapter定向override仍需生产BOM审阅，公共源本地安装非生产源批准；无DB/故障注入/部署/Git授权。

#### 历史阶段记录：补丁链原文保留，不作为现行状态

以下整段按当时先后原样保留；其中5.11.3/5.12.5/5.12.6、“未勾选”“安全阻塞”“正在复验”等均为历史阶段，不覆盖上方5.12.7最终摘要。L001 7/7与各旧补丁结果分开，不混算为最终TS工件验证。

用户已明确选择“允许公共源本地安装”：仅在独立后端使用`https://registry.npmjs.org`安装固定直接依赖及其传递树、生成锁文件、执行typecheck/build和本地针对性测试；不修改全局npm源。批准版本为Nest三件套11.2.8、Fastify5.11.3、reflect-metadata0.2.2、rxjs7.8.2、TypeScript5.9.3及@types/node22.19.15。默认禁用生命周期脚本，先审查；不加入pg/Hocuspocus、不连接数据库、不初始化Git或部署。若版本/引擎/peer出现问题停止诊断，不自动换版或强制解冲突。实现者已回传精确安装成功；主助手随后亲自执行`npm run typecheck`及`npm test`（包含build），退出0，新TS边界8/8通过、0失败/跳过。依赖审计发现Fastify高危及适配器中危告警，L002保持未勾选并标记安全阻塞。当前不自动升级或audit fix；原L001独立验证不覆盖TS/dist新版本。独立安全核查已回传7条公告及最低共同补丁5.12.5的官方证据。用户已批准保持Nest三件套11.2.8、直接Fastify5.12.5及`@nestjs/platform-fastify@11.2.8`祖先下Fastify5.12.5定向override的本地验证；该覆盖偏离适配器原生pin，仍需新锁文件、全副本检查、严格编译/测试和audit实证。补丁安装任务ogTCMj已实际退出0，78个安装节点不变，仅根Fastify声明及Fastify锁节点变化；新lock SHA256为`d8ead236d5a096b8305fd093456ffa04010632c72d96a2da6d057181982f2f2b`。补丁后audit任务ceTlQG退出1，剩1项low：GHSA-389g-gv7q-r4x8（受影响`>=5.12.2 <5.12.6`，npm建议5.12.8）；其余严重级别均0，不能写audit零告警或安全收口完成。依赖、源码与测试保持冻结，不自动升级。独立验证者对该锁摘要前后核对一致，npm ls/typecheck/build均退出0，正式TS测试8/8通过；另以新dist执行24次真实回环HTTP请求，覆盖正式startApi、keepAlive、关闭后无TCP资源，运行Fastify确为5.12.5且与adapter解析同一路径。此证据仅证明已测类型及本地运行边界，不消除low1安全阻塞。安全核查成员一次续接发生上游空响应，失败运行不计成功；此前已回传公告最低修复5.12.6与精确registry元数据（依赖声明相对5.12.5不变），npm自动建议5.12.8并非最低修复版。用户随后明确批准5.12.6最小补丁，并要求本地范围内按推荐自主决策、不逐补丁反复确认。5.12.6安装与全量audit均实际退出0，audit全部级别0；typecheck及含build的正式TS测试8/8退出0（Z8bDUd），新锁SHA256为`01ff84133cbebcab41fd4b72803c1cc0f3d82bc6e2b2ce6438baf07623711575`，78节点不变。源码及测试未改；正在对冻结5.12.6工件独立运行复验，未完成前L002仍不勾选。零已知依赖告警不等于生产安全认证。独立探针jOgYTS在首次HTTP前因实例自报5.12.5（manifest为5.12.6）断言失败，HTTP请求0，不能记录24请求通过。随后只读官方归档核验mKI0lw成功：tarball SHA512同时匹配registry和lock，363普通文件全部与本地字节一致；官方归档fastify.js的VERSION常量确为5.12.5，确认发布工件内部版本标记不一致，不推定维护者发布流程。5.12.6冻结工件后续独立实证：双列manifest5.12.6/instance5.12.5的24次真实HTTP通过；10次app.inject请求头大小写回归通过；插件门探针1nlz9G确认要求>=5.12.6被FST_ERR_PLUGIN_VERSION_MISMATCH拒绝且插件未执行，5.x对照正常。因此标记异常存在真实插件兼容影响，不仅是显示问题。只读官方5.12.7归档核验版本标记一致、SRI通过、依赖声明不变且validation.js与5.12.6一致，主助手依用户自主决策要求选定5.12.7最小后续补丁；5.12.7唯一Owner安装及后验已完成并冻结：CbuYAu安装exit0，78节点不变；npzx0P依赖树exit0、唯一Fastify副本/root与adapter同路径、manifest/源码VERSION/实例均5.12.7；IlYNiQ全量audit exit0、全部级别0；fNkTbr typecheck/build/test逐项exit0、正式TS8/8、16保护文件hash不变。最终lock SHA256为`f130920f4933df992b9907b36adc39b8f7e55a5222422b178d78cfe122bcdde3`。最终独立验证已完成，主助手直接读取三任务原始输出：wSjiMF退出0，24次真实HTTP、keepAlive及关闭后无TCP资源通过，manifest/instance严格均5.12.7且root/adapter同路径；aCqQmf退出0，10次header大小写安全回归注入通过（非真实TCP请求）；qNQLDk退出0，插件>=5.12.6与5.x成功，>5.12.7预期拒绝。验证者前后锁SHA相同，无文件修改。L002本地框架边界完成；原126任务不继承完成，readyz仍503，DB/协同/队列/生产未验收，定向覆盖例外仍需生产BOM审阅。

#### L002当前完成登记

- [x] L002 在`backend/package.json`、`backend/tsconfig.json`及正式TS入口建立Nest＋FastifyAdapter API与独立collab/Worker本地启动边界；先核定精确最小BOM，安装须具体授权。保留回环、严格配置、存活200/未就绪503、未知入口拒绝和导入无副作用。collab/Worker不启动Hocuspocus或真实任务；不连接PG，不删除生产门。使用编译后入口与针对性node:test；实际typecheck/build/测试全部通过才勾选，不复用L001测试当作新框架证据。（依赖：L001、已核定本地BOM及具体安装授权；不等于T003/T007完成）

### L003：API正常信号关闭生命周期（已完成，仅本地范围）

- [x] L003 在`backend/src/main.ts`成功监听后启用SIGINT/SIGTERM关闭钩子；在`backend/test/boundaries.test.ts`验证真实Nest关闭生命周期、信号退出、监听释放、listener所有权及导入无副作用。零新依赖，不覆盖生产排空/deadline、持久化、租约交接或发布安全，不等同T003/T007/T057/T061完成。（依赖：L002及已批准隔离本地开发范围）

L003测试先行证据：实现者旧实现红灯`vxdAgo`共11项，原8项通过、新增3项失败；SIGINT listener未新增，两信号子进程虽退出但未观察到shutdown生命周期消息。主助手已亲取原始输出核对。最小实现仅在成功listen之后增加`app.enableShutdownHooks(['SIGINT', 'SIGTERM'])`；创建应用与模块导入不注册signal listener。实现者绿灯后，主助手接回写权仅补信号退出后`ECONNREFUSED`断言；最终冻结版由独立验证者执行`typecheck && build && test`（后台`EUBOTT`，完成通知exit0），11/11通过、0失败/取消/跳过，主助手已亲取完整输出核对。两信号case各在子进程中观察真实AppModule生命周期hook、正确signal、hook时server.listening=false，再断言code=null且按原signal退出、关闭后回环请求被拒；显式close恢复两种listener原身份数组，非法配置/端口占用及各入口导入不泄漏listener。

验证前后package.json、package-lock.json、tsconfig.json及两源码摘要一致；lock仍为`f130920f4933df992b9907b36adc39b8f7e55a5222422b178d78cfe122bcdde3`。最终main.ts SHA256为`8db99823dbc8ec3183653b9159a406b4c11774db013b62f53da57272c1965464`，测试为`31bc2ef8135b81714611dc0661532b842cddb369064a2772808d88a98a442f8e`。已完成的EUBOTT原始运行结果由主助手直接读取核实，不因此重复测试。L003不引用L002显式close探针作为信号证据。readyz仍503，collab/Worker未就绪；未安装、未重跑audit、未连接真实DB、未故障注入/部署/Git操作。原T001–T126任务行及依赖不变、仍全部未勾选。

### D001：离线协议整数值逻辑（本地完成，不替代原T任务）

- [x] D001 新增`backend/src/protocol-integer.ts`与`backend/test/protocol-integer.test.ts`，依既定data-model全局类型校验规范非负十进制字符串并精确比较；不经Number、不假定生产位数上限，不接HTTP/WS/DB，不实现身份/授权/持久化。测试先行并接入默认npm test，完成后独立核验。开发依赖仅L002工具链及已确定值约束，不依赖未证PoC算法；T014–T018及真实集成状态不因纯函数成功而改变。

D001收口证据（2026-11-06）：主助手实读源码及9项新增测试，实跑`npm run typecheck`、`npm run build`及全部编译测试，20/20通过。修正`backend/package.json`默认测试入口后，再运行`npm test`，20/20通过（原边界11项＋协议整数9项），0失败/跳过。验证覆盖超出安全整数相邻值、万位长整数、非法格式、Unicode数字、末尾换行及不执行隐式转换；仅证明离线值校验/比较，不代表生产输入大小、DB整数范围或任何协同可靠性已验收。

### 本地PG隔离环境验证记录（不替代原T007）

已运行`backend/test/postgres-isolated-preflight.mjs`：已有PG17.11、Node22.22.2，无新安装；自建独立目录、Unix socket only、0700、local peer/host reject；实例配置核对、两条合成提交及更新/删除/插入回滚、新连接读取均通过。正常关闭退出0，pid/socket/lock消失且日志确认关闭。主助手已读取原始输出及证据文件`backend/.workbuddy/postgres-preflight-chYQqA/evidence.json`。不接入默认npm test，不冒充容量、恢复、业务持久化或T007完整通过；原T001–T126状态不变。数据与空socket目录保留，未自动删除。

合成Yjs实验记录：`backend/test/yjs-postgres-replay.mjs`显式执行通过，主助手实读脚本及原始输出；8条真实Yjs update与水位4快照在单一显式事务写入独立PG。全量/快照增量两条重放、重复apply及PG正常重启后读回一致，9类加载输入副本拒绝通过。证据`backend/.workbuddy/yjs-postgres-replay-reV1oK/evidence.json`；两次正常关闭均成功。Node仍保留原始manifest作实验oracle，不是完整应用进程恢复、自洽数据库篡改防护、receipt或T008/T009完成；原任务保持未勾选。详情见plan实验小节。

### T008 早期静态阶段记录（后续执行事实见当前核对）

`backend/test/poc/ingress-broadcast.test.ts`已形成12项类级用例：6项默认行为负对照、6项默认跳过的目标条件；仅显式设置`RUN_INGRESS_TARGET_RED=1`才启用目标条件。这是源码盘点，不是运行结果。测试清理补丁已完成独立只读静态复核：初始化前登记`t.after`、幂等清理Promise、逐阶段错误聚合、nullable类型规范化、安全诊断及迟到direct独立清理。固定fixture正常可达路径未发现确定性阻断缺陷，不等于编译、测试或无泄漏证明。

限制：超时不取消底层任务；多个清理等待可累计超过单例时限；after结束后的迟到清理失败只能诊断。依赖通用afterLoadDocument失败路径可能在房间登记前留下对象，当前fixture未配置该hook，不声称通用初始化失败回收已验证。现hook闸门只用于默认入口风险对照，未来durable测试须注入真正commit依赖，并明确晚加入读取旧committed状态或排队的语义。

**当时限制，非现行停止门**：该轮编译/两模式输出未取得，平台安全检查与历史日志读取受限，未通过换工具或agent绕过；当时全入口候选提交链未实现，故未推进依赖。后续用户已另行授权并实际完成受限PG提交、原live apply及广播/精确receipt和恢复/epoch本地链，见当前核对及L004–L011；不篡改该轮失败，也不把默认stock入口6个expected-red skip当新链成功。T008完整P01/P03覆盖仍由逐AC/最终故障矩阵判定。

## Phase 1: Setup（决策与设计，不运行PoC）

- [ ] T001 在`specs/003-production-collaboration/plan.md`批准后端实际目录/仓库映射、TS长期维护Owner/替补及Java/DBA/平台/安全实名责任和访问范围；未落实不得进入生产/真实集成；已批准的L001本地准备不受此开工限制，后续本地分支按各自明确授权执行。（依赖：无）
- [ ] T002 在`specs/003-production-collaboration/plan.md`由产品/DBA/平台记录容量轨迹、故障域、SLO/RPO/RTO、复制确认、deadline、保留与共享引用策略的待确认输入/负责人/证据；策略未批禁自动物理删，不把fixture当容量。（依赖：T001）
- [ ] T003 在`specs/003-production-collaboration/research.md`核定TS/Nest/Fastify/Hocuspocus/Node/PG支持交集、精确BOM候选及内网制品/许可/SBOM方案；既有4.7.1/13.6.33/3.32.0不自动升级，本项不安装。（依赖：T002）
- [ ] T004 在`specs/003-production-collaboration/plan.md`落实内部身份、Java接口、对象及翻译供给/依赖Owner/凭证准入；F6无内部翻译阻整批，禁公网/托管替代，无供给明确BLOCKED。（依赖：T003）
- [ ] T005 在`specs/003-production-collaboration/contracts/backend-api.md`及`specs/003-production-collaboration/data-model.md`完成安全/部署详细设计审阅：会话/CSRF/Origin、服务委托、授权源缺口、有限发送、DB唯一主/PITR代际、分类型保留与受限运营；记录责任与待定值，不宣称部署已选资源。（依赖：T004）
- [ ] T006 在`specs/003-production-collaboration/checklists/requirements.md`批准P01–P19 PoC/测试计划、执行隔离范围和停机/故障注入许可，并复核105AC/8NFR/首发范围；仅计划，另获安装/PoC/实现授权才可T007。（依赖：T005）

## Phase 2: Foundational（全部故事正式实现前置）

目标：先证实难点再共享基础。已授权的本地PoC、独立PG及业务实现事实按下表/原JSON核；生产故障域、破坏性注入及外部环境未获供给的部分继续BLOCKED，不把历史静态模型或缺失的外部验证写成通过。

- [ ] T007 在`backend/package.json`及`backend/test/poc/environment.test.ts`按批准映射/精确BOM准备隔离TS API/collab/Worker测试骨架及真实自运维PG，先检engines/锁文件/digest/内网安装；缺Owner或执行授权停止。（依赖：T006）
- [x] T008 在`backend/test/poc/ingress-broadcast.test.ts`先建P01/P03失败断言并验证4.7.1全入口候选隔离→commit→原活动Y.Doc应用→广播/receipt线序，涵盖sync step2/update/seed/restore/direct/插件/Worker/跨实例；默认hook不能作屏障，污染内存隔离，失败F3/版本BLOCKED不默认provisional回退。（依赖：T007）
- [x] T009 在`backend/test/poc/restore-algorithms.test.ts`验证P05/P06候选A/B的A→B→A嵌套内容/格式、历史clientID、gc:false/relative anchors；旧update合并或JSON重建不算恢复；B改变原活动Y.Doc/在线要求须另批，失败F8 BLOCKED。（依赖：T008）
- [x] T010 在`backend/test/poc/epoch-handshake.test.ts`验证P07旧pending/自动SyncStep2在握手前被拦、排队消息与恢复交叉、未知协议fail closed及导出；禁止自动换epoch或合入新state“消毒”。（依赖：T009）
- [x] T011 在`backend/test/poc/authorization-locks.test.ts`验证P10/P11 documents/主体共享协调锁，READ COMMITTED锁后复权且持锁至commit；FOR SHARE有限发送准入、在途边界、全局注销/来源gap/失效信号遗漏，5秒非写入宽限。（依赖：T010）
- [ ] T012 在`backend/test/poc/fencing-database.test.ts`验证P08/P09锁后clock_timestamp实时判租/末端复核、有限deadline、旧writer/worker暂停复活、DB切主/旧主隔离与PITR代际；房间token不代DB防脑裂，故障模型/复制未批保持BLOCKED。（依赖：T011）
- [ ] T013 在`specs/003-production-collaboration/research.md`、`specs/003-production-collaboration/data-model.md`、`specs/003-production-collaboration/contracts/backend-api.md`记录T008–T012真实版本/线序/失败与证据，冻结成功候选与未决项并由责任人复审；无通过不进入正式依赖实现。（依赖：T012）
- [x] T014 在`backend/test/integration/schema.test.ts`先建复合tenant/document键、作用域外键、唯一幂等与资源键、receipt/snapshot/lease/版本/事件约束失败测试；逐项引用data-model约束，租户级表例外仅tenant。（依赖：T013）
- [x] T015 在`backend/src/db/migrations/001_foundation.sql`按T014建立documents/identity/operation/lease/stream基础及受限commit端口：`0 <= snapshot_watermark <= last_seq`、`initialized=false`与空正文分离、token递增、`UNIQUE(tenant_id,source_system,external_resource_id)`；API/Worker禁直接正文表写。（依赖：T014）
- [x] T016 在`backend/test/contract/base-boundary.test.ts`先测身份/tenant/错误/幂等/审计/限额/服务委托/CSRF/Origin及有限read/send准入，private统一404且无计数存在性泄漏。（依赖：T015）
- [x] T017 在`backend/src/common/identity.ts`、`backend/src/common/authorization.ts`、`backend/src/common/admission.ts`、`backend/src/common/idempotency.ts`实现可信身份/共锁复权/有限发送/同key同hash原结果异hash冲突，脱敏审计与outbox端口；未知供给fail closed。（依赖：T016）
- [x] T018 在`backend/src/db/commit-authority.ts`、`backend/src/collab/room-coordinator.ts`按通过PoC实现文档→lease→操作统一锁序、token/实时租期/epoch/当前授权、有限事务和就绪/隔离边界，普通命令/seed/restore/快照/版本共同调用；先用`backend/test/integration/commit-authority.test.ts`失败断言约束，未通过不开放入口。（依赖：T017）

## Phase 3: US1 创建、绑定与安全解绑（P0，C01）

目标：资源三元键唯一，来源grant独立，删除不误伤共享引用。
独立验收：两请求创建相同资源/不同hash，共享文档解绑一源并回读审批/授权；完整AC-01-S/F/A/C/D/R/Q。

### 测试先行
- [x] T019 [P] [US1] 在`backend/test/contract/resources.test.ts`先写C01及AC-01-S/F/A/R/Q，覆盖唯一映射/无策略拒清理/归属/幂等及刷新。（依赖：T018）
- [x] T020 [P] [US1] 在`backend/test/integration/resource-races.test.ts`先写AC-01-C/D及P12资源竞争、未知提交、解绑与独立授权/共享审批引用并发。（依赖：T018）
### 实现与集成
- [x] T021 [US1] 在`backend/src/db/migrations/002_resources.sql`和`backend/src/modules/resources/repository.ts`建资源绑定/来源grant/引用模型，保持三元唯一、作用域FK与保留策略未批禁物理删。（依赖：T019,T020）
- [x] T022 [US1] 在`backend/src/modules/resources/service.ts`实现create/bind/query/unbind及业务删除受限待处置，来源revision重算，不误撤独立授权，操作/结果/outbox同事务。（依赖：T021）
- [x] T023 [US1] 在`backend/src/modules/resources/controller.ts`及`src/session/DocumentSession.js`接线C01、原operationId查询/unknown状态；浏览器不拿服务全权票据，不建立第二正文。（依赖：T022）
- [ ] T024 [US1] 在`backend/test/browser/resources.test.ts`以真实受信集成身份及A/B执行7AC/P12新E2/E3并在`backend/test/evidence/us1.json`保留唯一键/hash/revision/来源授权/审批引用回读。（依赖：T023）

## Phase 4: US2 当前身份、private与撤权（P0，C02）

目标：真实当前权与全读面过滤，写/revoke及有限发送线性化。
独立验收：真实A/B、manager/参与者和第二tenant绕过UI，记录准入/撤权commit线序；AC-02七项全部。

### 测试先行
- [x] T025 [P] [US2] 在`backend/test/contract/current-permissions.test.ts`先测C02与AC-02-S/F/A/R/Q，全部private读面、manager无豁免、服务/委托及失权操作查询。（依赖：T024）
- [x] T026 [P] [US2] 在`backend/test/fault/revoke-admission.test.ts`先测AC-02-C/D及P10/P11：排队写、FOR SHARE敏感发送准入、全局注销、旧票据、信号遗漏/来源gap。（依赖：T024）
### 实现与集成
- [x] T027 [US2] 在`backend/src/modules/permissions/repository.ts`实现来源grant/authzVersion、主体状态协调锁及READ COMMITTED锁后再查询，写/revoke持documents FOR UPDATE至commit，不给5秒续写窗口。（依赖：T025,T026）
- [x] T028 [US2] 在`backend/src/modules/permissions/service.ts`和`backend/src/common/admission.ts`实现private统一谓词与有限FOR SHARE逐受众帧/SSE/对象块/翻译/外投准入；已准入在途明确不可追回，下次复权。（依赖：T027）
- [x] T029 [US2] 在`backend/src/modules/permissions/controller.ts`及`backend/src/collab/ingress.ts`接C02会话/受限ticket/逐操作授权、失效补偿及断旧WS/SSE；授权源gap阻敏感操作而非沿缓存。（依赖：T028）
- [x] T030 [US2] 在`src/providers/authorization.js`和`src/session/DocumentSession.js`投影真实能力/失权/unknown，private不先下发后遮罩；原前端模式保留。（依赖：T029）
- [ ] T031 [US2] 在`backend/test/browser/permissions.test.ts`及`backend/test/evidence/us2.json`执行全部AC-02/P10/P11真实角色/租户/长连接线序与撤权耗时；未实现后续读面记待收尾复验，不将mock标全通过。（依赖：T030）

## Phase 5: US3 唯一seed、durable与重放（P0，C03）

目标：逐update可靠保存，无草稿覆盖，快照水位可核。
独立验收：双账号首访/编辑，commit断点/ack丢失/旧快照/损坏重放，AC-03七项与P01–P04。

### 测试先行
- [x] T032 [P] [US3] 在`backend/test/contract/durable-protocol.test.ts`先测C03与AC-03-S/F/A/R/Q的updateId/hash/epoch/protocol精确receipt及不匹配pending。（依赖：T031）
- [ ] T033 [P] [US3] 在`backend/test/fault/seed-replay.test.ts`先测AC-03-C/D与P01–P04全入口、并发空seed/旧草稿、水位迟到/缺口、kill-9/commit未知/应用广播失败。（依赖：T031）
### 实现与集成
- [x] T034 [US3] 在`backend/src/db/migrations/003_body.sql`建update/receipt/snapshot/seed约束：同文档updateId唯一且绑定hash/epoch/protocol、`0 <= snapshot_watermark <= last_seq`，seed每文档唯一，幂等映射保留独立于压缩。（依赖：T032,T033）
- [x] T035 [US3] 在`backend/src/collab/persistence.ts`实现update/seq/revision/receipt与操作结果同事务、commit后匹配receipt，未知查询和隔离污染内存；禁止outbox代正文。（依赖：T034）
- [x] T036 [US3] 在`backend/src/collab/seed.ts`实现initialized事务唯一seed，空已初始化不重seed，冲突/相同操作可查，不信任本地空内容锁。（依赖：T035）
- [x] T037 [US3] 在`backend/src/collab/snapshots.ts`实现一致水位state/hash/CAS发布、连续seq重放/损坏fail closed，先验证快照再按批准策略清日志，禁receipt去重失效。（依赖：T036）
- [x] T038 [US3] 在`backend/src/collab/ingress.ts`和`backend/src/collab/protocol.ts`接已通过受控适配及全入口统一命令，commit后仅应用到原活动Y.Doc/受众复权广播，未覆盖入口禁用。（依赖：T037）
- [x] T039 [US3] 在`src/session/DocumentSession.js`、`src/collab/index.js`、`src/collab/policies.js`及`src/components/lark-doc/editor/collabMixin.js`禁止草稿回灌，按updateId/hash/epoch分pending/durable/failed/unknown；synced不清pending，旧receipt不清新epoch。（依赖：T038）
- [ ] T040 [US3] 在`backend/test/browser/durable.test.ts`及`backend/test/evidence/us3.json`执行全部AC-03/P01–P04新E2/E3，记录candidate/commit/apply/broadcast/receipt及seq/hash；按批准故障模型核已receipt零缺失，不泛称灾难RPO=0。（依赖：T039）

## Phase 6: US7 不可变版本与真实预览（P0，C07）

目标：持久版本支撑审批，stateHash/contentHash分开。
独立验收：冻结A后编辑B，重启预览仍A；7AC-07与P03/P15，真实Java联调待US10汇合。

### 测试先行
- [x] T041 [P] [US7] 在`backend/test/contract/versions.test.ts`先测C07及AC-07-S/F/A/R/Q，污染/pending禁版本、不可变正文/两hash/受限预览。（依赖：T040）
- [x] T042 [P] [US7] 在`backend/test/integration/version-freeze-races.test.ts`先测AC-07-C/D与P15冻结CAS/提交未知/审批来源不随活动正文漂移。（依赖：T040）
### 实现与集成
- [x] T043 [US7] 在`backend/src/modules/versions/repository.ts`建不可变二进制状态/真实contentJson、contentHash/stateHash、capturedSeq/sourceRevision、kind与operation约束；只用已提交事实。（依赖：T041,T042）
- [x] T044 [US7] 在`backend/src/modules/versions/service.ts`和`backend/src/modules/versions/controller.ts`实现原协调器一致捕获/列表/预览/operation查询及审批引用，锁后复权/lease，失败不造版本。（依赖：T043）
- [x] T045 [US7] 在`src/providers/versioning.js`及`src/components/lark-doc/editor/versioningMixin.js`展示真实预览/来源revision/hash/unknown，禁块数摘要冒充正文。（依赖：T044）
- [ ] T046 [US7] 在`backend/test/browser/versions.test.ts`及`backend/test/evidence/us7.json`执行全部AC-07/P03/P15冻结后继续编辑及刷新重启回读，证明不可变引用，跨域绑定未知标待US10。（依赖：T045）

## Phase 7: US8 在线恢复与旧pending（P0，C08）

目标：已证算法与屏障，不丢历史/锚点、不静默合并旧离线。
独立验收：两在线账号加旧pending，A→B→恢复A、重复/CAS/故障后核pre/post/epoch，全部AC-08/P05–P07。

### 测试先行
- [x] T047 [P] [US8] 在`backend/test/contract/restore.test.ts`先测C08及AC-08-S/F/A/R/Q的operation/hash/expectedRevision/epoch、不可变pre/post与未知查询。（依赖：T046）
- [x] T048 [P] [US8] 在`backend/test/fault/restore-offline.test.ts`先测AC-08-C/D及P05–P07：嵌套格式/曾删锚点、旧clientID、自动SyncStep2、排队消息/双恢复/DB半失败。（依赖：T046）
### 实现与集成
- [x] T049 [US8] 在`backend/src/modules/restores/repository.ts`建operationId+actor+hash幂等、requested/coordinating/committed/conflict/unknown状态及pre/post结果引用，禁202当成功。（依赖：T047,T048）
- [x] T050 [US8] 在`backend/src/collab/restore.ts`按获批PoC算法构造显式恢复delta，保留CRDT历史身份/gc:false与原活动对象要求；若仅B可行且未获要求变更批准则停BLOCKED。（依赖：T049）
- [x] T051 [US8] 在`backend/src/modules/restores/service.ts`串行普通写/seed/恢复、CAS排空/拒绝pending、pre/post/update/epoch/receipt同事务；失败隔离/未知先查，不谎称DB rollback回滚Y.Doc。（依赖：T050）
- [x] T052 [US8] 在`backend/src/modules/restores/controller.ts`、`backend/src/collab/ingress.ts`及`src/collab/protocol.js`接先于sync的epoch握手、旧协议fail closed，旧pending隔离导出，禁自动换epoch。（依赖：T051）
- [x] T053 [US8] 在`src/core/versioning/restore.js`、`src/components/lark-doc/editor/versioningMixin.js`、`src/collab/anchors.js`及`src/core/comments/anchor.js`接pending/committed/conflict查询和attached/orphaned锚点，禁JSON重建/随意重定位。（依赖：T052）
- [ ] T054 [US8] 在`backend/test/browser/restore.test.ts`和`backend/test/evidence/us8.json`执行全部AC-08/P05–P07新E2/E3，核目标正文hash/pre-post/epoch/身份/离线导出；只读拒绝或普通update合并不算成功。（依赖：T053）

## Phase 8: US14 生产可靠性与受限运营（P0，C14）

目标：先交付可独立验证的运维/隔离控制，不等同整批生产验收。
独立验收：获批故障域下暂停复活/DB旧主/PITR/对象身份恢复及发布；全部AC-14，P08/P09/P18。后续业务最终再次收尾实测。

### 测试先行
- [x] T055 [P] [US14] 在`backend/test/contract/operations.test.ts`先测C14/AC-14-S/F/A/R/Q健康/就绪/受限诊断、无策略清理拒绝及恢复代际。（依赖：T054）
- [ ] T056 [P] [US14] 在`backend/test/fault/lease-failover.test.ts`先测AC-14-C/D/P08/P09锁等待跨过到期、now陷阱、事务末复核、旧token/writer/worker、DB旧主与PITR回退。（依赖：T054）
### 实现与集成
- [x] T057 [US14] 在`backend/src/ops/health.ts`和`backend/src/ops/metrics.ts`实现按进程依赖/owner重放资格ready、有限排空、脱敏指标/审计与受限对账；无租约不ready，无private运维旁路。（依赖：T055,T056）
- [ ] T058 [US14] 在`backend/ops/deployment.md`及`backend/ops/security.md`固化获批内部网络/故障域/DB唯一主/角色/秘密/限额/deadline/身份源gap、实名责任与值守；未确认标阻塞而非假设资源已选。（依赖：T057）
- [ ] T059 [US14] 在`backend/ops/recovery.md`及`backend/src/ops/recovery.ts`实现受限恢复编排/人工许可边界，PITR先fence旧进程/旧主及外部恢复代际；分层核receipt/token/权限/对象/身份，不自动物理清理。（依赖：T058）
- [ ] T060 [US14] 在`backend/test/fault/backup-recovery.test.ts`及`backend/test/evidence/us14.json`获准执行实际备份/WAL/PITR/对象身份恢复与P08/P09/P18；保留实测恢复点/耗时/中断，未批准复制/故障模型不宣HA/RPO。（依赖：T059）
- [ ] T061 [US14] 在`backend/ops/release.md`及`backend/test/fault/release-handover.test.ts`验证API摘流、owner排空/租约交接/重连、Worker停领与迟到确认、兼容迁移/回退；本阶段是控制基线，完整首发制品待T120复验。（依赖：T060）

## Phase 9: US15 原体验与真实证据（P0，C15）

目标：尽早建预算/矩阵工具与真实版本基线，最终制品仍须收尾复验。
独立验收：当前P0增量的真实Safari/Chromium/触控、原构建/包体/2000块轨迹及7AC-15；不是当前首发整体通过。

### 测试先行
- [x] T062 [P] [US15] 在`test/unit/production-evidence.test.js`先写C15及AC-15-S/F/R/Q证据字段/失败保留/预算比较/历史2703不得复用断言。（依赖：T061）
- [ ] T063 [P] [US15] 在`test/collab/production-browser-matrix.test.js`先写AC-15-A/C/D与P18真实角色直连、断线/恢复/生命周期和原生DOM模式矩阵，不减功能样本。（依赖：T061）
### 实现与集成
- [x] T064 [US15] 在`backend/test/evidence/schema.json`定义E0–E4版本/工件/环境/身份类型/步骤时间/原始结果/限制及AC索引，缺真实浏览器标BLOCKED，未知SLO不填假值。（依赖：T062,T063）
- [x] T065 [US15] 在`test/collab/production-browser-matrix.test.js`接原浏览器/模式/入口/销毁/焦点与2000块性能轨迹，调用现有`scripts/check-rollup-artifacts.mjs`及`scripts/perf/`，不得改`perf/baseline.json`或阈值掩盖失败。（依赖：T064）
- [ ] T066 [US15] 在`backend/test/evidence/us15.json`记录P0增量真实Chromium/macOS Safari/窄屏触控及Element≤475000 B、原>20%分别结果，校验前后端同制品；本项不声称首发全部通过。（依赖：T065）
- [ ] T067 [US15] 在`specs/003-production-collaboration/checklists/requirements.md`审阅证据工具与P0增量7AC-15，保留F6/后续首发能力待集成和所有BLOCKED；人工审阅不能由作者E0代签。（依赖：T066）

## Phase 10: US4 完整评论与锚点（P1，C04，首发）

目标：全文/选区、回复/本人编辑删除/解决重开及private持久闭环。
独立验收：双账号生命周期、并发CAS、删除/移动/恢复锚点，全部AC-04与P06/P10/P11。

### 测试先行
- [x] T068 [P] [US4] 在`backend/test/contract/comments.test.ts`先测C04及AC-04-S/F/A/R/Q全文/选区、动作能力、private与幂等回读。（依赖：T067）
- [x] T069 [P] [US4] 在`backend/test/integration/comment-races.test.ts`先测AC-04-C/D及threadRevision/撤权/未知提交、移动删除/恢复后attached或orphaned。（依赖：T067）
### 实现与集成
- [x] T070 [US4] 在`backend/src/modules/comments/repository.ts`建scope/visibility/相对anchor/participant/reply及threadRevision：`scope=document：block_id=null、anchor=null`，`scope=selection：block_id及相对anchor必需`，`visibility=private`仍需document read且作者/显式参与者。（依赖：T068,T069）
- [x] T071 [US4] 在`backend/src/modules/comments/service.ts`及`backend/src/modules/comments/controller.ts`实现create/reply/本人编辑删除/解决重开/参与者、revision CAS与业务operation/outbox同事务，删除留必要tombstone且不泄private。（依赖：T070）
- [x] T072 [US4] 在`src/core/comments/thread.js`、`src/providers/comments.js`、`src/components/lark-doc/editor/commentsMixin.js`及`src/ui/panels.js`接完整C04/全文scope/可解释锚点/真实失败，保留原生UI和现有接口审阅。（依赖：T071）
- [ ] T073 [US4] 在`backend/test/browser/comments.test.ts`及`backend/test/evidence/us4.json`执行全部AC-04/P06/P10/P11真实双身份回读，确认评论不入公共Y.Doc，通知读面待US9后收尾复验。（依赖：T072）

## Phase 11: US5 关注与稳定链接（P1，C05，首发）

目标：偏好持久、链接复权且不授private资格。
独立验收：关注/取消与撤权竞争、跨身份开链接/锚点失联，全部AC-05。

### 测试先行
- [x] T074 [P] [US5] 在`backend/test/contract/follows-links.test.ts`先测C05与AC-05-S/F/A/R/Q不可见/稳定定位/偏好/无隐式授权。（依赖：T073）
- [x] T075 [P] [US5] 在`backend/test/integration/follow-races.test.ts`先测AC-05-C/D偏好revision、撤权与关注竞态、断线未知及orphaned链接。（依赖：T073）
### 实现与集成
- [x] T076 [US5] 在`backend/src/modules/follows/service.ts`和`backend/src/modules/follows/controller.ts`实现follow/mute/link-target、同键/hash幂等及当前private谓词；关注不grant，链接不携绕鉴权能力。（依赖：T074,T075）
- [x] T077 [US5] 在`src/providers/comments.js`和`src/ui/panels.js`接关注/取消/稳定链接、unknown查询及无权统一提示，失联明确orphaned不跳错块。（依赖：T076）
- [ ] T078 [US5] 在`backend/test/browser/follows-links.test.ts`及`backend/test/evidence/us5.json`执行AC-05七项真实刷新/撤权/跨身份打开链接与独立授权保留。（依赖：T077）

## Phase 12: US6 内部翻译（P1，C06，首发，缺依赖整批BLOCKED）

目标：源revision真实译文与任务状态，外送/取回复权。
独立验收：真实获批内部服务成功、源改删/撤权/断线与缺依赖；全部AC-06/P16。不能用mock通过替代内部成功链。

### 测试先行
- [x] T079 [P] [US6] 在`backend/test/contract/translations.test.ts`先测C06与AC-06-S/F/A/R/Q源revision/目标语言、503 DEPENDENCY_BLOCKED、真实结果及每次复权。（依赖：T078）
- [x] T080 [P] [US6] 在`backend/test/integration/translation-races.test.ts`先测AC-06-C/D与P16撤权/源改删、多语言隔离、未知任务/重复结果及整批门。（依赖：T078）
### 实现与集成
- [x] T081 [US6] 在`backend/src/modules/translations/service.ts`和`backend/src/modules/translations/controller.ts`接已批准内部依赖，按源revision/语言/身份隔离任务/缓存，同键异hash冲突，外送/结果交付有限准入；无供给停止实现成功链并标BLOCKED。（依赖：T079,T080）
- [x] T082 [US6] 在`src/providers/comments.js`及`src/ui/panels.js`展示真实译文来源/过期/blocked/failed/unknown及查询，不覆盖原文、不接公网/静默隐藏；F6阻塞传入批次状态。（依赖：T081）
- [ ] T083 [US6] 在`backend/test/browser/translations.test.ts`及`backend/test/evidence/us6.json`执行全部AC-06/P16真实内部翻译及缺依赖门；未通过整批MVP不得放行，删F6需用户另批。（依赖：T082）

## Phase 13: US9 通知偏好与授权SSE（P1，C09，首发）

目标：outbox/worker持久通知与提交序回放，非外部送达假证明。
独立验收：两用户提交乱序、worker故障、快照/订阅与410游标及撤权重放；全部AC-09/P13/P14。

### 测试先行
- [x] T084 [P] [US9] 在`backend/test/contract/notifications.test.ts`先测C09/AC-09-S/F/A/R/Q已读/静音/游标范围、private过滤及去重。（依赖：T083）
- [x] T085 [P] [US9] 在`backend/test/fault/notification-order.test.ts`先测AC-09-C/D/P13/P14每用户commit乱序、自增分配序陷阱、快照交接、旧Worker和断线/游标过期。（依赖：T083）
### 实现与集成
- [x] T086 [US9] 在`backend/src/modules/notifications/repository.ts`建立每用户流协调行/单调提交序、`UNIQUE(tenant,document,recipient,event_id)`、绑定tenant/principal/过滤范围游标与偏好；分配序不代commit序。（依赖：T084,T085）
- [x] T087 [US9] 在`backend/src/worker/outbox.ts`及`backend/src/worker/leases.ts`实现有期限领取/续租/token CAS完成/重试隔离、至少一次与收件箱业务去重，失租不确认，NOTIFY仅唤醒。（依赖：T086）
- [x] T088 [US9] 在`backend/src/modules/notifications/controller.ts`和`backend/src/modules/notifications/service.ts`实现快照→游标无漏衔接、Last-Event-ID当前复权、410重取、逐事件有限准入、已读/mute持久化；每次发送复查private。（依赖：T087）
- [x] T089 [US9] 在`src/providers/notifications.js`及`src/ui/notifications.js`接eventId去重/断线续流/410/偏好/取消订阅，站内收到/阅读不当外部送达。（依赖：T088）
- [ ] T090 [US9] 在`backend/test/browser/notifications.test.ts`及`backend/test/evidence/us9.json`执行全部AC-09/P13/P14真实多账号与worker/SSE故障、旧通知失权回放，保留commit序线序证据。（依赖：T089）

## Phase 14: US10 双域集成与补偿（P1，C10，首发）

目标：Java API/事件不共享表，不假跨库原子，审批不可变。
独立验收：真实Java契约对端超时/重复异hash/乱序/gap/审批绑定，全部AC-10/P12/P13/P15。

### 测试先行
- [x] T091 [P] [US10] 在`backend/test/contract/java-integration.test.ts`先测C10与AC-10-S/F/A/R/Q服务身份、最小事件载荷/受众、原结果与不可变审批引用。（依赖：T090）
- [x] T092 [P] [US10] 在`backend/test/integration/inbox-races.test.ts`先测AC-10-C/D/P12/P13/P15 Inbox副作用原子、eventId/hash/业务键重复、乱序/隐藏gap和绑定未知。（依赖：T090）
### 实现与集成
- [x] T093 [US10] 在`backend/src/modules/integration/repository.ts`建Inbox/hash/副作用本地事务、aggregateRevision/eventIndex/受众可见序列、操作/审批引用状态；同revision可多event，不要求补private隐藏空洞。（依赖：T091,T092）
- [x] T094 [US10] 在`backend/src/modules/integration/service.ts`实现受众授权投递、原eventId重试/隔离回放、版本化兼容、来源gap查证与受限对账；旧grant不能覆盖新revoke。（依赖：T093）
- [x] T095 [US10] 在`backend/src/modules/integration/controller.ts`接Java create/bind/approval/status/replay契约，审批持久versionId/contentHash/sourceRevision，跨域部分失败待对账；禁止直接共享表和Java逐帧转发。（依赖：T094）
- [ ] T096 [US10] 在`backend/test/integration/java-endpoint.test.ts`接已核验真实Java测试接口及服务信任，联测API/事件/未知结果查询/补偿；无对端BLOCKED，契约替身只算E1。（依赖：T095）
- [ ] T097 [US10] 在`backend/test/evidence/us10.json`执行全部AC-10/P12/P13/P15真实双域与审批冻结后编辑/重复绑定及事件受众私有负例，区分两域持久结果与对账中。（依赖：T096）

## Phase 15: US11 mention与分享（P2，C11，增强）

目标：权限感知真实主体，来源分享grant可核，不自动授private。
独立验收：真实目录/分享/通知跨身份和解绑并发；AC-11七项/P19，前端未接通不删除。

### 测试先行
- [x] T098 [P] [US11] 在`backend/test/contract/mentions-sharing.test.ts`先测C11/AC-11-S/F/A/R/Q目录枚举/分享来源/private不自动授权及未接通标识。（依赖：T097）
- [x] T099 [P] [US11] 在`backend/test/integration/mention-races.test.ts`先测AC-11-C/D/P19来源解绑/独立分享竞态、旧epoch mention与断线查询。（依赖：T097）
### 实现与集成
- [x] T100 [US11] 在`backend/src/modules/mentions/service.ts`及`backend/src/modules/mentions/controller.ts`实现受限主体查询、持久来源grant和幂等事件，mention不grant/private不自动共享，普通写走统一端口。（依赖：T098,T099）
- [x] T101 [US11] 在`src/session/DocumentSession.js`和`src/providers/authorization.js`接原mention/分享provider边界真实身份及失败/unknown，通知走C09，不伪造送达。（依赖：T100）
- [ ] T102 [US11] 在`backend/test/browser/mentions-sharing.test.ts`及`backend/test/evidence/us11.json`执行全部AC-11/P19真实角色、通知/来源grant/刷新与private负例，作为增强批次独立证据。（依赖：T101）

## Phase 16: US12 diff与受控导入导出（P2，C12，增强）

目标：真实来源/内容与任务状态，导入统一durable端口。
独立验收：实际版本diff/批准格式导入及下载文件内容hash；全部AC-12/P19，不用块数摘要通过。

### 测试先行
- [x] T103 [P] [US12] 在`backend/test/contract/conversion.test.ts`先测C12/AC-12-S/F/A/R/Q格式/大小/授权/private过滤、真实diff与幂等下载。（依赖：T102）
- [x] T104 [P] [US12] 在`backend/test/integration/conversion-races.test.ts`先测AC-12-C/D/P19导入CAS/epoch/token、固定导出版本、任务未知/旧pending与对象部分失败。（依赖：T102）
### 实现与集成
- [x] T105 [US12] 在`backend/src/modules/conversion/service.ts`建立批准格式/限额/来源hash/revision及任务状态；在`backend/src/modules/assets/storage-adapter.ts`先实现本故事导出所需真实内部对象受限写入/完成hash校验/当前授权代理取件最小共享端口，先由`backend/test/integration/conversion-objects.test.ts`失败断言约束，不等US13新增媒体才落安全基础；转换隔离、防注入，缺内部对象/转换依赖BLOCKED不接公网。（依赖：T103,T104）
- [x] T106 [US12] 在`backend/src/modules/conversion/controller.ts`实现真实diff、导入走唯一正文命令/receipt，导出固定不可变来源且通过对象端口授权取件，不绕private过滤。（依赖：T105）
- [x] T107 [US12] 在`src/core/versioning/diff.js`、`src/providers/versioning.js`和`src/session/DocumentSession.js`接真实结构/文本差异、导入pending/导出任务/实际文件，不JSON重建恢复、不toast假成功。（依赖：T106）
- [ ] T108 [US12] 在`backend/test/browser/conversion.test.ts`及`backend/test/evidence/us12.json`执行全部AC-12/P19真实diff/批准格式/下载内容hash及权限/重试/刷新，所需真实对象适配由T105先落最小安全链，最终US13完整附件链汇合。（依赖：T107）

## Phase 17: US13 附件媒体与模式（P2，C13，既有边界首发必验）

目标：实际对象和权限代理、共享引用安全；新增媒体增强后续，现有前端不删。
独立验收：真实对象store/DB开始-完成-引用-读取，查看/评论/编辑越权与分块撤权；全部AC-13/P17/P19。

### 测试先行
- [x] T109 [P] [US13] 在`backend/test/contract/assets-modes.test.ts`先测C13/AC-13-S/F/A/R/Q对象状态/hash/代理读取/模式与无策略禁清理。（依赖：T108）
- [x] T110 [P] [US13] 在`backend/test/fault/asset-races.test.ts`先测AC-13-C/D/P17/P19完成未知、对象/DB部分失败、分块撤权、共享版本引用/解绑竞争。（依赖：T108）
### 实现与集成
- [x] T111 [US13] 在`backend/src/modules/assets/repository.ts`及`backend/src/modules/assets/service.ts`复用T105真实内部对象适配并实现`status=pending/ready/rejected/deleted`、实际size/mime/checksum完成校验、范围复合引用/来源计数和孤儿待对账，策略未批禁物理删。（依赖：T109,T110）
- [x] T112 [US13] 在`backend/src/modules/assets/controller.ts`实现受限开始/完成、当前身份每请求/块代理read有限准入，禁旧签名URL绕撤权；保留已发字节不可追回边界。（依赖：T111）
- [x] T113 [US13] 在`src/providers/persistence.js`和`src/session/DocumentSession.js`接原媒体/查看/评论/编辑模式实际对象引用/unknown/failed，新增未接通保留标识不删前端。（依赖：T112）
- [ ] T114 [US13] 在`backend/test/browser/assets-modes.test.ts`及`backend/test/evidence/us13.json`执行全部AC-13/P17/P19真实对象/共享引用/分块撤权/模式及恢复后回读；标出首发实际所用安全子集供T115验，不以P2豁免。（依赖：T113）

## Phase 18: Polish & Cross-Cutting Concerns（完整批次门，不自动部署）

- [ ] T115 在`backend/test/integration/first-release.test.ts`汇合F1–F10/F14/F15与F13既有模式/实际对象边界，按首发AC及P01–P18验收计划执行同制品端到端；F6缺内部成功链整批BLOCKED，调整批次另批。（依赖：T097,T114）
- [ ] T116 在`backend/test/fault/full-private-revoke.test.ts`复验已实现所有HTTP/WS逐受众广播/SSE/对象/翻译/导出/搜索计数/链接/运营读面P10/P11、来源gap/全局注销及共同锁准入线序，5秒非宽限/在途不追撤。（依赖：T115）
- [ ] T117 在`backend/test/fault/full-durable-restore.test.ts`对最终制品重跑P01–P09，核已receipt/快照/身份/epoch/旧pending及A→B→A目标，按已批准故障模型对账，不以PoC早期结果代最终通过。（依赖：T116）
- [ ] T118 在`backend/test/fault/full-events.test.ts`复验P12–P17真实Java/对象/翻译/worker/SSE、Inbox副作用/提交序/受众过滤gap/审批冻结与共享引用，保留跨域待对账。（依赖：T117）
- [ ] T119 在`backend/ops/supply-chain.md`及`backend/test/integration/offline-runtime.test.ts`核最终精确BOM/digest/SBOM/许可/漏洞补丁回归/回退工件，获准断外网冷启动/SSO轮换/编辑附件翻译worker观测与恢复，禁止运行时外网拉取。（依赖：T118）
- [ ] T120 在`backend/test/fault/final-production-rehearsal.test.ts`执行P18最终制品DB唯一主/复制/PG-WAL-PITR/对象/身份隔离恢复、外部代际fence、发布排空交接/回退/旧worker复活，输出实测恢复点时间及审阅，不默认停机可接受。（依赖：T119）
- [ ] T121 在`backend/ops/capacity.md`测批准容量轨迹的gc:false/候选副本/热点/重放/WAL/复制/队列/对象成本及限额，与原2000块fixture分开；SLO/RPO/RTO/资源未批保持BLOCKED不填假QPS。（依赖：T120）
- [ ] T122 在`backend/test/evidence/final-browser-budget.json`重跑最终同版真实macOS Safari/Chromium/窄屏触控/原生命周期，Element≤475000 B与原>20%门禁分别报告，保留失败旧报告，不换基线。（依赖：T121）
- [ ] T123 在`backend/test/integration/enhancement-release.test.ts`汇合US11/US12/US13全部增强AC/P19，真实mention/分享/通知/diff/导入导出文件/媒体与模式回读，未接通保持前端标识，不借首发通过宣称增强完成。（依赖：T122）
- [ ] T124 在`specs/003-production-collaboration/checklists/requirements.md`逐一核105AC/8NFR/15FR/5SC/19矩阵→任务→原始新证据/真实审阅，E0–E4分层、未验证BLOCKED，历史2703不算新验收。（依赖：T123）
- [ ] T125 在`backend/ops/release.md`由已落实Owner/替补/DBA/平台/安全及需求方审阅首发/增强各自准入、故障域/恢复/保留/值守/风险与批次状态；F6、Owner或生产门不齐拒绝放行，不自动发布。（依赖：T124）
- [ ] T126 在`specs/003-production-collaboration/plan.md`和`specs/003-production-collaboration/tasks.md`归档最终依赖/路径映射/决策/授权/证据索引与未决事项，用户另批部署/提交/推送前停止；仅在真实执行验收后逐项更新状态。（依赖：T125）

## Dependencies & Execution Order

```text
T001→T002→T003→T004→T005→T006（设计批准；此处另获执行授权）
→T007→T008（广播）→T009（恢复算法）→T010（epoch）→T011（授权锁）→T012（writer/DB）
→T013（证据复审）→T014→T015→T016→T017→T018
→US1→US2→US3→US7→US8→US14→US15→US4→US5→US6→US9→US10
→US11→US12→US13→T115→T116→T117→T118→T119→T120→T121→T122→T123→T124→T125→T126
```

文档阶段已产生任务不表示这些任务已执行。T008–T012是授权后的隔离PoC，不依赖正式故事实现，避免循环；失败不进入T013成功复审/正式依赖能力。US14/15先验独立控制和增量基线，完整业务候选在T115–T125汇合重测。首发批准不要求把P2新增增强暗纳首批，但当前保守全序使US13安全链位于收尾前；如需提前只执行US13既有子集，必须先明确拆批任务/路径依赖，不跳T114而假称已验。T105在最早使用故事落真实内部对象最小安全适配，T108必须使用它做实际导出文件E2；T111–T114再扩展完整附件/引用/模式并于T118汇合。无内部对象供给T105/T108直接BLOCKED，不允许用替身把US12集成标完成。

## 每故事并行例子（仅共同前置完成后）

| 故事 | 共同前置 | 并行任务 | 文件互斥说明 |
|---|---|---|---|
| US1 | T018 | T019 / T020 | resources契约与resource-races集成测试不同文件 |
| US2 | T024 | T025 / T026 | current-permissions与revoke-admission不同文件 |
| US3 | T031 | T032 / T033 | durable-protocol与seed-replay不同文件 |
| US7 | T040 | T041 / T042 | versions与version-freeze-races不同文件 |
| US8 | T046 | T047 / T048 | restore与restore-offline不同文件 |
| US14 | T054 | T055 / T056 | operations与lease-failover不同文件 |
| US15 | T061 | T062 / T063 | unit证据与collab矩阵不同文件 |
| US4 | T067 | T068 / T069 | comments与comment-races不同文件 |
| US5 | T073 | T074 / T075 | follows-links与follow-races不同文件 |
| US6 | T078 | T079 / T080 | translations与translation-races不同文件 |
| US9 | T083 | T084 / T085 | notifications与notification-order不同文件 |
| US10 | T090 | T091 / T092 | java-integration与inbox-races不同文件 |
| US11 | T097 | T098 / T099 | mentions-sharing与mention-races不同文件 |
| US12 | T102 | T103 / T104 | conversion与conversion-races不同文件 |
| US13 | T108 | T109 / T110 | assets-modes与asset-races不同文件 |

共30项[P]、15组测试并行。共享Session/ingress/comments/panels等实现任务均无[P]，按显式依赖串行，不把不同目录等同无冲突。

## 当前执行与剩余准入

1. 用户已授权持续按原依赖推进全部可本地落地开发，不以人员表、历史PoC静态记录或全部未勾选作为停工理由。本表当前勾选82项本地实现/测试；未勾项逐一分清已实现子集、仍需本地验证/审阅、真实外部阻塞。
2. 前轮快照/旧FAIL保留；当前SDK9b1c8c4d七入口/只读stamp、严格gzip9和原同基线七项性能均通过。实际SDK/cold/OS进程网络联合23/23、107包离线冷安装、10正常清理；Safari真正主UMD/Element六单元全新通过，四写单元各30trusted输入双帧样本。非物理触控/显示呈现/SLA、无Safari基线，不把本机合成服务当公司验收。
3. 最终证据统一归入`backend/test/evidence/local-final-20261108/`；逐126任务/105AC见`task-index.json`及独立校验文件，校验核当前SHA/真实case/完整映射，不批准完整故事或生产。当前源码变更后的旧结果仅按明确不受影响范围复用，新增验证只选受影响任务，不重复长测。
4. 原依赖图保留完整设计/故事/生产准入关系；用户另授的局部本地分支并不将其未满足的外部前置勾选。测试先行/精确负例及独立复核继续有效，不用函数名、路径或局部绿灯代全部Given/When/Then。
5. 首发仍是F1–F10＋F14/F15及F13既有/实际对象边界，不是仅7项P0；F6真实内部翻译缺失整批不放行。P2新增完整保留且在增强批独立验P19；不删原前端，生产发布/部署须另批。

## Requirement Traceability

每行七AC明确列举，契约测试及竞态测试→实现→集成；上游每个Given/When/Then同时约束，不能只跑摘要关键字。

| FR/故事/契约 | 七条AC | 测试先行 | 实现 | 独立集成/最终回归 | 数量 |
|---|---|---|---|---|---|
| FR-01/US1/C01 | AC-01-S, AC-01-F, AC-01-A, AC-01-C, AC-01-D, AC-01-R, AC-01-Q | T019,T020 | T021–T023 | T024,T115,T118 | 6 |
| FR-02/US2/C02 | AC-02-S, AC-02-F, AC-02-A, AC-02-C, AC-02-D, AC-02-R, AC-02-Q | T025,T026 | T027–T030 | T031,T116 | 7 |
| FR-03/US3/C03 | AC-03-S, AC-03-F, AC-03-A, AC-03-C, AC-03-D, AC-03-R, AC-03-Q | T032,T033 | T034–T039 | T040,T117 | 9 |
| FR-04/US4/C04 | AC-04-S, AC-04-F, AC-04-A, AC-04-C, AC-04-D, AC-04-R, AC-04-Q | T068,T069 | T070–T072 | T073,T116 | 6 |
| FR-05/US5/C05 | AC-05-S, AC-05-F, AC-05-A, AC-05-C, AC-05-D, AC-05-R, AC-05-Q | T074,T075 | T076,T077 | T078,T116 | 5 |
| FR-06/US6/C06 | AC-06-S, AC-06-F, AC-06-A, AC-06-C, AC-06-D, AC-06-R, AC-06-Q | T079,T080 | T081,T082 | T083,T115,T118 | 5 |
| FR-07/US7/C07 | AC-07-S, AC-07-F, AC-07-A, AC-07-C, AC-07-D, AC-07-R, AC-07-Q | T041,T042 | T043–T045 | T046,T097,T118 | 6 |
| FR-08/US8/C08 | AC-08-S, AC-08-F, AC-08-A, AC-08-C, AC-08-D, AC-08-R, AC-08-Q | T047,T048 | T049–T053 | T054,T117 | 8 |
| FR-09/US9/C09 | AC-09-S, AC-09-F, AC-09-A, AC-09-C, AC-09-D, AC-09-R, AC-09-Q | T084,T085 | T086–T089 | T090,T118 | 7 |
| FR-10/US10/C10 | AC-10-S, AC-10-F, AC-10-A, AC-10-C, AC-10-D, AC-10-R, AC-10-Q | T091,T092 | T093–T096 | T097,T118 | 7 |
| FR-11/US11/C11 | AC-11-S, AC-11-F, AC-11-A, AC-11-C, AC-11-D, AC-11-R, AC-11-Q | T098,T099 | T100,T101 | T102,T123 | 5 |
| FR-12/US12/C12 | AC-12-S, AC-12-F, AC-12-A, AC-12-C, AC-12-D, AC-12-R, AC-12-Q | T103,T104 | T105–T107 | T108,T123 | 6 |
| FR-13/US13/C13 | AC-13-S, AC-13-F, AC-13-A, AC-13-C, AC-13-D, AC-13-R, AC-13-Q | T109,T110 | T111–T113 | T114,T118,T123 | 6 |
| FR-14/US14/C14 | AC-14-S, AC-14-F, AC-14-A, AC-14-C, AC-14-D, AC-14-R, AC-14-Q | T055,T056 | T057–T059 | T060,T061,T120 | 7 |
| FR-15/US15/C15 | AC-15-S, AC-15-F, AC-15-A, AC-15-C, AC-15-D, AC-15-R, AC-15-Q | T062,T063 | T064,T065 | T066,T067,T122 | 6 |

| 跨切需求 | 任务/验收 |
|---|---|
| NFR-01 | T030,T039,T053,T072,T077,T082,T089,T101,T107,T113,T122 |
| NFR-02 | T002,T037,T065,T066,T121,T122 |
| NFR-03 | T003,T007,T058,T066,T119,T122 |
| NFR-04 | T005,T011,T016–T018,T025–T031,T116,T119 |
| NFR-05 | T008–T013,T018,T032–T061,T117,T120 |
| NFR-06 | T017,T022,T071,T084–T097,T118 |
| NFR-07 | T002,T005,T021,T022,T059,T111,T114,T118,T125 |
| NFR-08 | T001–T006,T013,T083,T115,T119–T126 |
| SC-01 | T006,T064,T124 |
| SC-02 | T024,T031,T040,T054,T060,T116,T117,T120 |
| SC-03 | T046,T054,T097,T118 |
| SC-04 | T013,T115–T120,T123,T124 |
| SC-05 | T064–T067,T122,T124 |

| 系统验证矩阵 | 前置验证/实现/最终证据 |
|---|---|
| P01 | T008,T032,T033,T038,T040,T117 |
| P02 | T033,T036,T040,T117 |
| P03 | T008,T033,T035,T040,T041,T046,T117 |
| P04 | T033,T037,T040,T117 |
| P05 | T009,T047,T048,T050,T054,T117 |
| P06 | T009,T048,T053,T054,T069,T073,T117 |
| P07 | T010,T048,T052,T054,T117 |
| P08 | T012,T018,T056,T060,T117,T120 |
| P09 | T002,T005,T012,T056,T060,T120 |
| P10 | T011,T025,T028,T031,T073,T116 |
| P11 | T011,T026–T031,T116 |
| P12 | T020–T024,T092,T097,T118 |
| P13 | T085,T087,T090,T092–T097,T118 |
| P14 | T085,T086,T088,T090,T118 |
| P15 | T042–T046,T092,T095–T097,T118 |
| P16 | T004,T079–T083,T115,T118 |
| P17 | T110–T114,T115,T118 |
| P18 | T055–T067,T119–T122 |
| P19 | T098–T114,T123 |

## 计数与真实性

原126项＝Setup 6＋Foundation 12＋故事96＋收尾12；15故事完整，30个[P]仅15组互斥测试。P0故事49项，P1故事30项，P2故事17项。T001–T126任务原文/编号/依赖保留，当前82勾/44未勾；本地实现/测试编写、当前定向集成与真实外部验收分别记录。早期“全部未勾/真实PG未验/仅静态归档”已被后续授权和实际本地执行覆盖，不再作为当前结论；完整故事/生产批准仍未满足。L项不计入126项，索引结构通过不证明HA或已批准上线。


## L004–L006 本地核心闭环（2026-11-07）

用户已授权保留技术栈并完成本机真实闭环，禁止commit/push/部署；没有重启原本PG或连接真实业务DB。以下仅勾选明确完成的本地范围，不改变原T项完整验收含义。

- [x] L004 先补可信用户到真实共享PG池：007受限委托/事务context与004–006统一resolver，node-postgres驱动、gateway、受限创建/seed/原操作查询、当前授权持锁发送与自己活租恢复；真实PG18场景及安全红绿，独立审查通过。（依赖：现有001–006及最新本地授权；映射T015–T018的核心缺口）
- [x] L005 接真实HTTP+Hocuspocus受控wire+实际Vue2 LarkDoc，默认Sync禁旁路、candidate→COMMIT→原Y.Doc应用→当前受众发送、精确pending/receipt、原键unknown查询、协作禁旧草稿覆盖；双账号真实网络/浏览器/PG10场景通过。（依赖：L004；映射C01/C02/C03核心切片）
- [x] L006 正常API/WS/PG关闭并原数据重启，双浏览器回读及活租期内续写、受控撤权负例；夹具启动失败正常清理，全部数据日志保留；独立整体审查APPROVE。（依赖：L005；不含破坏故障/生产发布）

| 原任务 | 已证实的当前进展 | 仍不足以整体勾选的条件 |
|---|---|---|
| T013 | 实际provider/server Stateless5与editor-crdt-v1本地wire已冻结，§9有schema/错误语义，独立整体代码复审通过 | 原T008–T012全部故障/恢复/生产门未整体通过，不能追溯称全部PoC实网/责任验收已完成 |
| T014/T015 | schema失败测试已有；001–007真实空PG执行，复合键/约束、受限提交、租约和身份有分层证据 | 原T013完整前置及全部版本/快照/stream业务验收未满足，不把核心子集等同整个Foundation |
| T016/T017 | 真实cookie/Origin/CSRF、服务委托、池隔离、当前授权持锁发送、幂等/outbox已接本地核心链 | 全私有读面、公司授权源/缺口对账、审计与全部限额验收仍未齐 |
| T018 | update与seed已有真实受限提交，未知不返回receipt；房间按COMMIT应用原Y.Doc | 普通命令/restore/快照/版本尚未全部接统一真实提交链 |
| T019–T024 / US1 | HTTP create绑定/来源grant、唯一seed和重复冲突实测 | 完整bind/query/unbind、业务删除/共享审批引用/竞态未全接真实DB |
| T025–T031 / US2 | 真实双身份/当前文档权、跨租户、撤权后拒写/拒读、逐受众准入有证据 | private评论等全部读面、真实授权源及跨实例失效/5秒SLA未全验 |
| T032及后 / US3 | 双浏览器逐update durable、原键查询、默认同步拒绝、正常重启回读/续写完成 | DB COMMIT响应丢失、崩溃、快照水位/损坏/旧快照及全部AC/P01–P04未全验 |

证据与运行命令见research§6。后续从这些明确缺口继续，不重做已通过18/10项且不把原T001–T126机械批量勾选；只有实际变化才选择必要回归。生产/外部验收另列，不以其未完成否定本地核心闭环已完成。


## 开发阶段记录（2026-11-07，当时尚未执行回归，当前结果见L007）

用户要求按上述依赖顺序优先执行开发项，末尾统一运行受影响回归；因此“代码已实现”与原任务验收勾选分别记录。以下不是对原AC、真实公司服务或生产放行的替代。先前L004–L006证据只证明其执行时工件，本批次改动须重新验证。

| 顺序/任务 | 当前开发产物 | 尚待统一验证/外部条件 |
|---|---|---|
| US1/T021–T023 | 008_pg_resources、PgResourceRepository、真实C01路由、resources Provider/DocumentSession，bind/query/unbind/deletion-intent及actor幂等 | 新增端口/真实PG actor/HTTP回归未跑；当前doc-scoped合成委托，尚非公司Java派生身份全链 |
| US2/T027–T030 | 009当前scope/direct-share来源/gap-resync/ticket，逐事务绑定及末端复权；capabilities/HTTP/provider失败关权 | private后续读面收尾；真实公司授权源、跨实例SLA未验 |
| US3/T037–T039 | 010快照CAS与完整metadata/hash/receipt连续重放，gateway与HTTP/WS共用验证；保留全部日志 | 实际PG发布/损坏/重启回归未跑；不宣称已批准日志清理 |
| US7/T043–T045 | 011版本冻结/不可变二进制与真实JSON双hash/审批引用；真实只读VersionPanel及HTTP Provider | 冻结A编辑B重启实际回归未跑，公司审批引用联调待US10 |
| US8/T049–T053 | 013候选A显式delta、pre/post/operation/epoch同事务，原Y.Doc确认后apply；旧pending显式隔离与orphan锚点 | 在线恢复/旧pending/首次入房竞态/重启回归未跑；不以只读拒绝当恢复成功 |
| US14/T057–T059/T061 | ops实际依赖ready、inflight有限排空、固定脱敏计数、只读恢复前检查及四份运行说明；root实际HTTP/WS接线 | 测试代码未跑；批准故障域/唯一主/PITR/外部代际/值守未确认，工具不执行恢复或清理 |
| US15/T064–T065 | E0–E4工件证据/固定预算与原浏览器矩阵工具已落盘，静态检查已做，功能未运行 | 真实Safari/硬件触控和完整矩阵待验；不替换原Webpack或改baseline/阈值 |

安全补丁012与004/007/009 hooks为本批次前置保护：独立COMMIT文本、service sandbox、提交末session/ticket许可；007 resolver入口也拒最新schema的未注册legacy服务，避免lease自提交旁路。17组PG负例仅补代码，未执行SQL。终端许可不声称与WAL fsync物理零时间差。


### 阶段记录：2026-11-08 继续开发（当时没有执行回归）

US4/014完整评论PG端口、真实相对锚点、POST线程统一operations、前端原面板/Session已落盘；US5/015个人关注静音与每次复权的稳定定位链接已落盘。US6只实现无供给时的当前private/源replyRevision校验及真实blocked响应，内部成功链仍BLOCKED且阻整批，不伪造任务/缓存/译文。US4/US5独立静态审查未发现阻断，不能当真实PG或用户验收通过。

当前进入US9开发：016通知/每用户流提交序/opaque scoped cursor与受限worker；Node worker、Cookie SSE及通知面板。所有本批次功能/PG/浏览器测试按用户要求最后统一。25个领域PG场景脚本仅编写并通过语法检查，未创建测试集群；actual双浏览器runner增加新业务场景代码同样未运行。原T项完整验收不因这些开发状态勾选。


### 阶段记录：2026-11-08 后续开发接线（统一回归前）

按用户最新顺序先开发、最后统一测试，测试用例与实现同步编写但没有提前运行。以下不是原任务验收勾选。US9–US13 后端整合 TypeScript 静态编译通过；前端US12/US13仍在收尾。

| 顺序/任务 | 已落盘的本地开发产物 | 尚缺原验收条件 |
|---|---|---|
| US4/T070–T072 | 014、PgCommentRepository、真实相对锚点、统一线程operations与原前端面板/private参与者 | 实际双浏览器/PG/CAS/恢复锚点新回归待统一执行 |
| US5/T076–T077 | 015个人follow/mute、当前受权link-target与原键查询 | 私有撤权、来源与正常重启待统一执行 |
| US6/T080–T082 | 当前私有/源replyRevision校验、未接通内部翻译503与前端保留状态 | 内部翻译成功链未供给，US6及完整首发批次继续BLOCKED，不创建假任务/译文 |
| US9/T086–T089 | 016每用户流/opaque游标、独立受限Worker、实际Cookie SSE及通知面板；已修原操作route、授权control code、固定cut资格hash、确认回滚有限重试、迟到旧SSE计数 | 新端口/38场景真实PG/实际双浏览器与独立Worker进程代码未执行；外部送达无证据 |
| US10/T093–T095 | 017独立SESSION_USER服务映射、Inbox/hash/gap/原envelope对账、不变审批引用；显式synthetic-local独立Bearer/PG池 HTTP | 本地真实HTTP/PG回归待执行；真实Java服务信任/TLS/签名/对端/权威快照/回执无供给，T096–T097仍BLOCKED |
| US11/T100–T101 | 当前doc/epoch/seq验证后的目录未接通；share复用009独立来源和原操作，远端UI停止示例人物/权限假成功 | 真实目录候选/mention持久通知无供给；实际分享/来源解绑新回归待执行 |
| US12/T105–T107 | 两不可变真实版本结构/文本/marks/attrs diff；固定版本导出来源校验，导入CAS准入；未获供转换/对象时明确blocked | 原面板/导入导出入口前端收尾；批准格式与真实内部对象供给缺失，T105对象链/T108实物下载不可标完成 |
| US13/T111–T113 | 逐请求read/write准入、Range声明校验与未接通对象边界；不生成ID/ready/URL/字节，不提供物理删除 | 实际对象store/完成hash校验/共享引用/分块撤权/对象恢复未供给；前端模式边界收尾，T111–T114完整验收仍BLOCKED |

017固定服务身份没有human/Worker的TTL/fence terminal门；它不包含这类时效事实，授权注册行锁保持到提交，Node独立COMMIT确认后返回。不能把此差异写成拥有同等租约门，也不替代公司服务信任验收。


## L007：2026-11-08 本地开发与统一回归收口

- [x] L007 保持既有栈，按US1→US2→US3→US7→US8→US14→US15→US4→US5→US6→US9→US10→US11→US12→US13完成当前可做的本地开发，最后统一验证可信用户/共享池、实际双LarkDoc、提交确认、正常重启回读；保留所有缺供给状态。实际测试及独立最终复审均已通过，仅限本地范围。禁止commit/push/部署。（独立本地范围，不替代原T001–T126的完整依赖/AC）

| 真实执行入口 | 结果 | 原始证据/日志 |
|---|---|---|
| backend node:test 全量 | 882项：864通过、0失败、6历史stock入口预期红灯样例跳过 | `/tmp/lark-doc-final-20261108/backend-tests-verified.log` |
| frontend Vitest全量 | 81文件/1913项通过 | `/tmp/lark-doc-final-20261108/frontend-tests-rerun.log` |
| C15证据工具专项 | 7项通过；E1工具测试，不冒充真实矩阵 | `/tmp/lark-doc-final-20261108/evidence-final.log` |
| 原应用Node14构建/全量ESLint | CommonJS库构建及lint通过；未改原工具链 | `frontend-build-final.log`、`frontend-lint-rerun.log`（同上/tmp目录） |
| 真实PG终端/沙箱 | 17/17通过，正常关闭 | backend`.workbuddy/t-6Ois5T/evidence.json` |
| 真实PG资源actor隔离/历史迁移 | 3/3通过，正常关闭并保数据 | backend`.workbuddy/r-VFun60/evidence.json`、`l-dJiRe8` |
| 真实PG用户到共享池委托 | 18/18通过，正常关闭 | backend`.workbuddy/d-n50Deb/evidence.json` |
| 最终同源领域PG | 38/38通过，正常关闭/cleanupErrors空 | backend`.workbuddy/d-44VmoC/evidence.json` |
| 实际HTTP/WS/SSE/Worker/双Chromium/PG | 31/31通过，正常重启回读续写/撤权；全部cleanup正常 | backend`.workbuddy/c-IlhM8V/evidence.json`，387输入指纹核对无差异 |

这些是E1及本机真实协议/数据库E2；浏览器和PG确实运行，但身份/服务为synthetic-local，不能写成公司真实账号E3或生产E4。Chromium155.0.8059.12、PG17.11、Node22.13.0；前端构建/ESLint保持Node14.21.3，已安装Vitest5测试工具按其engines使用Node22。

### 原任务逐组核验与剩余条件

- T021–T023、T027/T029–T030、T034–T039、T043–T045、T049–T053：对应本地模型、HTTP/WS/provider和统一提交/冻结/恢复实现已落盘，新的PG/浏览器证据覆盖本轮核心行为；原前置T013全部恢复/故障/生产门与各故事全部AC/P矩阵不齐，故不把实现子集勾成原整项完成。
- T028及T070–T077/T086–T089：当前已接读面使用共同private/current授权，manager无旁路；真实评论/关注/通知/worker/SSE与重启通过。对象/翻译/外投等后续读面缺真实供给，原全读面/真实身份/SLA等验收不能勾。
- T057–T059、T064–T065：本地ready/drain/只读恢复许可、E0–E4证据及固定预算工具已实现和针对验证；没有获准执行真实PITR/旧主/备份故障、真实Safari/硬件触控及最终Element/性能预算，T060–T067和最终对应门保持未完成。
- T080–T083 / US6：只当前源/private准入后的真实blocked，内部翻译成功链未供给。按原规则，完整首发批次仍BLOCKED。
- T093–T095 / US10：独立服务身份、Inbox原hash/缺口/原序列对账及不可变审批引用本地通过；真实Java TLS/签名/issuer/audience/对端/权威来源快照/业务回执未供给，T096–T097不勾。
- T100–T102 / US11：已知本地主体的独立share来源、解绑保留与当前访问通过；真实目录/mention事件通知仍未接，不用synthetic人物列表假完成。
- T105–T108 / US12：真实版本diff及原面板可用；导入/导出当前准入后明确blocked，未批准格式/真实转换/内部对象/实际文件下载校验缺供给。
- T111–T114 / US13：当前权限与模式、未接通上传/声明hash/Range安全拒绝已测；未有真实对象store、ready校验/共享引用/分块取件，不能因P2豁免首发既有对象链。
- T115–T126：本地汇合与证据已做可执行子集；真实外部、断网SSO/对象翻译、PITR/唯一主/故障域/容量/完整浏览器预算/保留值守与生产审阅缺口不假设完成，不执行提交/推送/部署。

### 本批真实修复与失败保留

修复票据30s长会话原生续签、HTTP文档命令有界串行准入、选区anchor JSON运算符结合顺序，以及definer owner的主体行锁列权限/Outbox读取权限；应用组仍不能直写/直读，真实42501负例通过。修正证据工具重复schema$id和2000逻辑块/2477原物理片段的误判，不变更生成器、原HTML/hash、baseline或预算。

所有失败轮次保留。一轮隔离PG夹具客户端超时未处理导致异常退出（backend`.workbuddy/d-G8xRF3/evidence.json`原`originalNormallyStopped:false`），随后原目录恢复并正常SIGTERM关闭；不伪造原轮通过/正常清理。最终新集群38/31通过与恢复事故分开记录。


**独立最终复审（2026-11-08，closure_review）**：APPROVE，仅本地scope；No blocking findings，Simplicity/Correctness双PASS。独立逐项核双浏览器387输入、领域PG74源/52编译指纹均与当前树一致，31/38/17/3/18原证据通过；核6个历史skip类别、最终测试集群已停且数据保留、失败事故未篡改。原CJS构建2条非阻断样式导出warning保留，不称零warning或Element预算通过。真实外部与生产/完整AC未批准，原T项不因L007批量勾选；仅更新已完整满足的本地L007。


## L008：T017/C02持久浏览器会话补齐（2026-11-08）

- [x] L008 修复API进程Map导致原有效Cookie/CSRF换实例或正常重启401的问题，保留既有接口与身份边界；先开发，最后统一验证。原T017/T029完整AC及外部依赖仍不因此勾选。
- 018受限表及start/request函数、gateway提交确认、全部HTTP/SSE异步准入已接；并发POST复用稳定CSRF、普通请求不续期，绑定主体/scope变更拒绝旧凭据迁移，期限不超过DB时钟1小时及底层身份期限。不新增logout/全局禁用产品API或依赖。
- 真实红灯：backend`.workbuddy/s-cnIZPt/evidence.json`，A登录后B原Cookie读取401；保留失败记录。最终专项`.workbuddy/s-DeET8a/evidence.json` **11/11**，24源/4编译指纹一致，含原Cookie+CSRF不重新登录跨实例写入及正常API/PG重启回读/写入、当前身份/权限拒绝、精确42501角色负例，正常SIGTERM/cleanupErrors空。
- 统一回归：Node22 build通过；受影响Node112/112；后端871项中865pass/0fail/6历史stock入口expected-red跳过；实际双Vue2/HTTP/WS/SSE/独立Worker/PG **31/31**，`.workbuddy/c-OeSvHl/evidence.json`，388输入指纹一致、9项cleanup正常，页面异常/外部请求空。未改前端源码/依赖，不重复其1913项和构建；历史38领域PG证据仍是上一批源码，不冒称当前同源。
- 独立closure_review已APPROVE，仅本地补丁，Simplicity/Correctness双PASS；其两项runner清理P2已修（启动PG前读指纹、所有实例独立清理后汇总）并重跑专项11/11。所有中间失败集群保留且正常关闭；未commit/push/发布/部署，真实IdP/Java/目录/翻译/对象及生产故障/容量门继续BLOCKED。

下一开发阶段继续T018/US3-T037：把snapshot重放/编码移出DB写事务和API/WS事件循环。L008以上指纹为其完成时的来源记录；后续源码变化须使用新批次证据，不能引用旧31/11代验。


## L009：T018/US3-T037快照计算与事务隔离（2026-11-08）

- [x] L009 按下一本地依赖完成snapshot repository候选计算隔离，并在开发后统一回归、独立复审通过。原T018/T037全部条件及前置故障/容量/外部门仍未满足，不冒领原整项。
- 读事务一致load→COMMIT/release→一次性Worker重放/编码并exit→新事务取当前活租、原010授权/epoch/revision/seq/schema/旧snapshot CAS→确认COMMIT。单进程单slot在load前取得，busy不排队；纯计算10s且message/exit复核单调时钟，timeout/late不发布，最终finally释放。输入只clone不detach、env/execArgv空，不碰活动Y.Doc、不加依赖/角色权限/HTTP；原id同cut重放、异cut冲突及query保持原事实，日志receipt不删。
- baseline `snapshot-prepare-red.log`1fail确认旧单事务先取租；独立deadline review另用2个真实Worker/注入父钟用例在无timer派发时复现失败，再修成通过。写前已知失败与发布COMMIT未知分开；此为端口/真实线程+注入时钟证据，不冒真实DB或CPU性能测量。
- 最终当前源码：backend`.workbuddy/s-KHJwwd/evidence.json`真实HTTP/PG会话 **11/11**；`.workbuddy/d-SDEw16/evidence.json`真实领域PG **42/42**（新4个发布前竞态：追加、真实restore-B、合成session revoke、另一受限SQL事务更新指针）。各76源/53编译指纹current一致，正常SIGTERM/cleanupErrors空。barrier为read COMMIT/Worker exit后、write BEGIN前，不声称CPU中途或跨进程。
- `.workbuddy/c-4jArCX/evidence.json`实际双Vue2/HTTP/WS/SSE/独立Worker/PG **31/31**，389输入current一致、9项cleanup正常、页面异常/外部请求空。Node22 build通过；Node884total=878pass/0fail/6历史stock expected-red跳过，快照21个用例通过。前端源码/锁未改，不重跑其1913/lint/build；日志`/tmp/lark-doc-session-20261108/`。
- `closure_review`独立 **APPROVE仅本地scope，Simplicity/Correctness双PASS，No blocking findings**；deadline P2闭合，原始JSON/指纹/无pid/socket及保留data均已独立核。中间d-BapgmB新增独立文档后原全tenant审计计数失败保原false/正常停库，按doc分别核账修夹具后42通过；不篡改历史。
- 本轮仅repository，调用方须await publish；未接自动快照调度/runtime drain，版本/恢复自身CPU隔离仍待开发。真实IdP/授权源/Java/目录/翻译/转换/object及生产故障/容量等继续BLOCKED。未commit/push/npm发布/部署或连接真实业务DB，主机PG未碰，所有本轮测试进程已结束、数据保留。


## L010：依序收齐版本、恢复、diff计算隔离后统一回归（2026-11-08）

- [x] L010 按T043/T044→T050/T051→T105/T106顺序完成本地开发批次，先收齐实现和测试代码、最后统一验证与独立复审。原T项完整前置/AC与外部门不因此冒领。
- 原snapshot Worker生命周期抽成固定五kind复用，版本purecontent与diff纯算法搬移、旧导出保留，无新依赖/协议/产品API；旧snapshot-candidate src/dist过时入口精确删除并留before。准备tx先COMMIT/release，Worker真实exit后再原CAS/COMMIT或019当前metadata准入，保原Y.Doc/operation/hash/fence及必要主线程活动对象核验。
- 019仅collab当前version.read可调用metadata-only，API/Worker/集成/PUBLIC及未绑定app/直表精确42501负例；历史版本来源不误绑活动epoch/revision。正文只读+version.create仍可捕获，原restore权限无version.read仍可实际恢复；diff最终两个来源同一事务重新查权，已算出但撤权仍零send。
- 编译/类型检查通过；最小版本/恢复CPU baseline各1fail已记录，不把端口/注入时钟当PG。affected Node **87/87**，backend **912total=906pass/0fail/6历史stock预期红灯skip**。真实PG **51/51** backend`.workbuddy/d-VULynv/evidence.json`，真实HTTP/PG会话 **11/11** `.workbuddy/s-gZh2Au/evidence.json`，各80源/56编译current一致、normallyStopped true/cleanup空；新增9阶段case在Worker exit后/写或最终准入前，非CPU中途/跨机。
- 实际双Vue2/HTTP/WS/SSE/独立Worker/PG **31/31** `.workbuddy/c-O3Bho0/evidence.json`，393输入current一致、9cleanup正常、pageErrors/externalRequests空。源码未改前端/锁，不重复1913/lint/build；全部日志和before集中`/tmp/lark-doc-version-restore-20261108/`，集群data/log/JSON保留，主机PG未碰。
- 旧browser c-0t3Mtx timeout保原false；确定性red c-rUEZie记录armed:true/null，证明夹具resume未取消尚待消费的丢帧。仅fixture修resume同时清开关/ID、两处真丢原帧gate和rearm→resume断言，保QUERY/一次提交/timeout；最终31通过。两次失败9cleanup均正常，不冒原失败已捕到armed或一次全绿。
- closure_review独立 **APPROVE仅本地scope / No blocking findings / Simplicity与Correctness双PASS**，亲读原JSON/日志与80/56/393哈希、无pid/socket/data保留。无commit/push/npm发布/部署/真实业务DB授权。
- 自动快照策略/身份、真实IdP/授权源/Java/目录/翻译/格式/对象及HA/PITR/真实容量/完整Safari触控仍未完成。全局dev-agent已持久化‘仅当用户明确开发先行时收齐依赖就绪batch再统一回归，最小bug red仍保留’的流程，不新建框架或默认重测旧成果。

## L011：T029空闲授权补偿→T057就绪/排空生命周期（2026-11-08）

- [x] L011 本地开发、统一回归与独立复核已完成。原T029/T057及所有T项完整前置、外部AC不因此冒领。
- 空闲WS用原Cookie经受限current capabilities复核，比较当前主体/epoch及最新正式ticket的authzVersion/scope子集，不验证捕获的旧短ticket、不升级权限。每连接一项原检查，2秒节奏及计划时刻加2秒绝对预算；timer迟到不另续预算、结果逾期不能绿，超时关旧资格但原PG工作跟踪到settle并纳入正常关闭。无ticket旧入口至少复核read/主体/epoch，独立read仍在的write降权继续由逐次提交门拒绝，不宣所有legacy scope变更皆断线。
- 就绪并发共享一轮原检查和绝对期限；超时不释放raw guard、不复用跨轮READY，下一阶段及最终结果查monotonic与生命周期。drain等待原probe与业务在途，close开始/完成查同一总期限，逾期保持incomplete。既有只读恢复预检补超时终结flag，迟到许可不启动新inspect；不新增PITR/切主/清理执行。
- 最小red：idle缺失1fail、ops deadline/singleflight/drain5fail、既有preflight早派timer后latepermit1fail、idle start timer晚派1fail。测试为注入端口/时钟，不称真实PG。修前中间Node937=931pass/6历史skip、HTTP/PG13通过；browser c-vf9hUQ原31过但新case前夹具列名错误导致false/11正常cleanup，失败证据保留。最终同源结果如下。
- 真实HTTP就绪暂停gate位于PG检查之前；只证明真实HTTP+注入暂停原探针+随后真实PG，不冒称数据库中途挂起。浏览器新增独立runtime B共享PG、HTTP变更→A空闲WS关闭，要求无新HELLO/UPDATE/QUERY，5秒从请求开始计保守预算，非跨机/生产SLA；独立read保留、sourcegap原CAS授权resync、合成principal/session撤销均留真实事实检查。
- 最终同源build/typecheck通过，受影响47/47；backend938total=932pass/0fail/6历史stock expected-red跳过。真实HTTP/PG **13/13** backend`.workbuddy/s-uIpESu/evidence.json`，80src/56compiled current；实际双Vue2/HTTP/WS/SSE/独立Worker/PG/正常重启 **34/34** `.workbuddy/c-qLTUlu/evidence.json`，393inputs current/11normalcleanup/无页面异常或外部请求。四次idle关闭1743/1808/1792/1783ms，无新业务type5消息且正文水位不变；独立read再准入与gap期间拒读/原受限HTTP resync/恢复后GET通过。
- closure_review独立 **APPROVE仅本地slice / No blocking findings / Simplicity与Correctness双PASS**，亲读原JSON和日志并重算80/56/393全部current，两个P2闭合。PG数据保留、pid/socket消失、无本轮测试进程、宿主PG54630未碰。B为同一Node进程内独立runtime/池，不冒跨OS进程/跨机HA；WS无本轮before、backend非Git不能作完整Gitdiff审计，已全读新增函数/hooks/相关测试。日志`/tmp/lark-doc-lifecycle-20261108/`可后续清理，原JSON/.workbuddy保留，无新依赖/前端源码或锁修改、无commit/push/npm发布/部署。
