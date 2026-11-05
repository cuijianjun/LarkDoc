# Tasks：master 集成与完整上传回调修复

状态：**前四轮已合入 master 并发布 0.14.4；第五轮已合入 master 并发布 0.14.5，独立审查、GitHub 检查、Pages 部署及线上验收均完成**。输入：[spec.md](spec.md)、[plan.md](plan.md)。ID为本feature局部编号，与旧分支T001等无继承关系。`[P]`仅表示无写入冲突时可并行，不是已授权执行。

## Phase 0：授权、基线与失败复现

- [x] T000 用户确认本目录三份文档，尤其完整上传回调契约、协同peer边界及开发依赖政策；确认前不得编码。
- [x] T001 复核master、实际worktree、dirty状态与备份；从当前确认基线准备合适工作区。禁止重置旧detached现场或恢复stash混入master。（AC-010）
- [x] T002 [P] 四个测试副本实际删除node_modules并检查不存在；库副本清旧dist，再用pin运行时/包管理器及明确缓存策略安装。记录源/清单/锁hash、版本、耗时和首个错误；本阶段重测仅作为证据，不等于该实施任务已完成。（FR-016，AC-010）
- [x] T003 [P] 将库与三端应用的安装/单target/全量/冷构建/热构建和实际资源大小分开记录；固定同机/入口/缓存口径，标明绝对耗时SLO未指定。（AC-008）
- [x] T004 在既有门禁/针对性测试中先加入确定失败复现：Node14复制API、ES2018、full未导出、lite哈希区块漏扫、门面upload不执行、可选attchId被拒。确认失败对应实际问题后才修复。（AC-001/002/003/006）

## Phase 1：运行时兼容与真实入口

- [x] T005 仅修改`scripts/build-rollup.mjs`相关复制逻辑，使用Node14可用能力，复用现有资产复制方式，保留CSS/字体；跑Node14库build。（R05，AC-003）
- [x] T006 在`rollup.config.mjs`为CJS/UMD补明确ES2018降级与必要polyfill策略，同时覆盖webpack4按module真正选中的公开ESM及可达chunk；先验证resolver再决定必要路由，保留main/module语义，不以宿主alias/Babel兜底。压缩复用terser；必要开发依赖核对Node14兼容并精确锁定，不引入Vue CLI/Webpack。（R05，AC-003）
- [x] T007 对新CJS/UMD运行`check:legacy`，新增最小webpack4隔离消费夹具，断言实际被选中的入口及全部可达chunk并编译；不能假定它忽略module而选CJS，原Vue2/Webpack5不得冒充webpack4结果。（AC-003）
- [x] T008 将现有`src/full.js`接入Rollup/exports/sideEffects与资源清单，保持默认API、old入口及显式collab边界；更新`check-package-exports.js`相关断言。（R02，AC-001）
- [x] T009 修正lite alias覆盖次序和实际specifier匹配，保证所有被排除重依赖从lite的整个闭包消失；复用现有registry/stub，不新建加载系统。（R03，AC-002）
- [x] T010 更新`check-lite-artifacts.js`和产物检查覆盖真实Rollup哈希命名/依赖边；加入薄壳引用重依赖的失败样例和全量正向指纹对照，去掉已删除Webpack脚本修复提示。（R04，AC-002）
- [x] T011 分别校验默认/full/Element/lite/feature的能力、CSS、字体、注册副作用与模块格式；现有Mermaid离线脚本及真实SVG回归通过。（AC-001/002/009）

## Phase 2：安装边界与同版消费

- [x] T012 先建立Vue2旧provider与Vue3旧yjs的普通编辑安装复现，以及显式collab支持/拒绝组合的契约验证。确认包级optional peer的实际约束，不把仅拆子路径当解法。（R07，AC-005）
- [x] T013 按plan 4.1收敛根包普通编辑与显式collab的依赖验证责任，证明默认安装不受无关版本阻塞，collab external/单例/兼容验证不丢失。若需要独立分发包，停止该分支并另请用户确认，不默认新增包。（AC-005）
- [x] T014 修正三个demo中已删除worktree的file依赖，使用稳定同级库来源并同步各自锁；不升级宿主Node、Vue/React/Vite/Webpack，不使用force/legacy-peer-deps。（R06，AC-004/005）
- [x] T015 修复既有ensure-artifacts/prepack的产物复用和必要重建逻辑；子进程复用已验证的Node/npm入口而非PATH中其他npm，记录实际版本。真实`npm pack`通过，生成同一测试tgz给各消费端，不以手工tar作最终证据。（R11，AC-010）
- [x] T016 [P] Vue2在Node14/npm8干净安装同版包并构建、挂载/卸载，记录入口、CSS、字体与chunk请求；保留宿主现有Vue CLI/Webpack。（AC-004）
- [x] T017 [P] Vue3/React在Node22/npm8分别干净安装、构建、挂载/卸载；记录peer解析、warnings与产物，不因React单端通过推定全端通过。（AC-004）

## Phase 3：图片单一管线与完整回调

- [x] T018 用真实门面`new LarkDoc`补失败优先集成测试：对象uploader、裸函数、旧uploadImage、自建Provider实际执行，URL/base64采用结果，合法无attchId返回可用；只测裸Provider不算完成。（R08/R10，AC-006）
- [x] T019 在LarkDoc、domRenderer、core/media/upload与必要的native host之间统一Provider对象/方法及任务上下文，只归一一次，保留cancel/pending能力，不丢弃应用回调。（R08/R09，FR-009/015）
- [x] T020 实现spec所列beforeUpload、upload、onStart、onProgress、onRetry、onSuccess、onError、onCancel、onReject、onSettled及ctx.cancel(reason?)；验证异步beforeUpload等待中取消、迟到结果/异常不复活任务、通知回调Promise rejection被接住、唯一终态、重试/分片和清理。（AC-006/007）
- [x] T021 统一文件选择、拖拽、粘贴文件、替换、裁剪的事件source和任务身份；已有链接插图不伪造上传事件。无upload时本地base64也通知应用；自定义upload失败不静默降级成功。（FR-010/011/013）
- [x] T022 复用Provider取消/清理，在销毁、切文档、只读变化时阻止晚到结果写入；允许应用取消，失败保留旧图，多文件不串任务，重复选择同文件可重试。（FR-012/013）
- [x] T023 扩展既有upload-provider、image-insert、image-nodeview、dom-renderer-contract针对性测试，覆盖成功/失败/超限/取消/回调异常/结果格式、进度单调/分片/重试与卸载；全部用假上传。（AC-006/007）

## Phase 4：所有应用入口透传与浏览器矩阵

- [x] T024 Vue2旧组件props和直挂renderer路径透传完整uploader对象；新增/更新legacy-adapter回归，避免绕过门面导致行为不同。（FR-015）
- [x] T025 Vue3及Web Component明确通过element.options property传对象/函数；避免attrs helper序列化丢失，并验证挂载前后options更新与卸载。（FR-015）
- [x] T026 React包装器通过property/effect透传uploader/options并保留函数身份，跳过attribute序列化；处理回调更新与effect清理，不引入框架运行时到库。（FR-015）
- [x] T027 在各demo既有LarkDoc页面加入确定性完整回调示例，使用统一字段/载荷；不改变应用工具链，不增加真实上传端点或凭证。（FR-015，AC-007）
- [x] T028 对命令式、Vue2、Vue3、React、原生WC/CDN分别执行真实浏览器上传矩阵，断言应用收到的全部适用回调顺序/次数/参数；覆盖URL/base64、失败取消、超限以及替换/裁剪、路由卸载。（AC-007/009）

## Phase 5：性能度量、文档与独立验收

- [x] T029 修正size与初始资源度量，明确入口壳、静态初始图和lazy图；现有Element/CJS/collab可比预算达标，不提高limit或隐藏大chunk警告。（R01/R04，AC-008）
- [x] T030 在已证实瓶颈处减少未使用重依赖和无谓重复构建；复测相同命令冷/热各至少三次中位数，记录前后差异，不将首次清缓存数字直接与旧暖缓存比较。（FR-016/017）
- [x] T031 更新README、安装/兼容/产物/性能及图片/uploader文档，统一全量/按需写法、运行时承诺、完整回调与错误语义；所有应用沿用自身工具链。（AC-001/003/006/008）
- [x] T032 在同一集成树运行相关入口/lite/legacy/size门禁、定向单测、真实pack及消费/浏览器验证；列清未测环境和warning分类，保留命令、退出码和版本证据，不自动跑全套无关测试。（AC-010）
- [x] T033 独立Reviewer检查行为/范围/兼容/负向与证据，Simplicity和Correctness均通过；确认无用户原改动被覆盖、无未授权依赖/源码/产物，再更新本feature状态，等待后续发布指令。（AC-010）

## 依赖与执行规则

- T000是实施硬闸门。本阶段的诊断命令和文档写入不构成T000通过。
- Phase1先保证产物可消费；T012–T017依赖相关入口和pack就绪。peer/运行时阻塞时不能把浏览器未运行记通过。
- 上传失败复现T018可先做；T019–T023契约固定后再做T024–T028，跨环境不复制生命周期状态机。
- package/lock/Rollup/公共门禁设唯一写入者。`[P]`测试可分端并行，其他并行写入必须隔离且互不覆盖；最大三名实现Worker、不得再委派。
- 每一项完成必须有对应AC的真实证据，失败保持未勾选；不得只改文档勾选、抬预算、放宽peer或关闭测试来过关。

## 本轮验收记录（2026-11-05）

- 主工作区：`/Users/cjjxw/codex/.wt-larkdoc/master-integration-fixes`，分支`agent/master-integration-fixes-main`，基线`4e7cc4338c04b5a4aa8dfa49f784c18d0a0f3b77`。Vue2接入工作区`/Users/cjjxw/codex/.wt-larkdoc/master-integration-demo-vue2`；Vue3/React限定原件已备份。原dirty库、stash、bundle及原预览保留，没有提交、合并或发布。
- 最终审阅包：[lark-doc-0.14.2-verified.tgz](/tmp/lark-doc-master-audit-20261104/implementation/lark-doc-0.14.2-verified.tgz)，SHA256=`2e61c605176035185fb9a3eeebadf6b07649e475e3e51144411ec054362df4da`，18674123B。
- 与功能验收包`8bd54232…`逐项比较641个文件，唯一变化为打包指南的一行“待验证”说明；其余640项、全部JS/CSS/字体/package元数据一致。最终包已在三应用与独立协同消费者再次普通干净安装，不能把仅改指南的一轮CI称为新增性能采样。

| 已覆盖任务 | 命令与实际证据 | 结果 |
| --- | --- | --- |
| T002–T004 基线/重装 | 四副本实际删除node_modules，库清dist；保留原始失败、安装与重测日志。最终三端的`*-verified-ci.log`及`verified-consumer-pre-ci.log`再次记录普通lock-only/删除/ci。 | 未使用force、legacy-peer-deps、借用nodes或源码alias。原Vue2/Vue3普通安装冲突作为无可比before的原因记录。 |
| T005–T013 构建/依赖 | `final-node14-library-build.log`、`final-node14-full-dom.log`；`final-library-gates.log`；`webpack4-final.json`、`final-webpack4-browser.log`；`collab-final-official-consumer-tests.log`、`collab-final-official-identity.log`。 | Node14 build与归档full+DOM可编辑；55落点、163真实语法区块、lite17/17、strict-zero Vue293文件、lint通过。webpack4真实module解析/异步图表/六API补全无错。支持的CJS协同9/9，ESM协同位置/选区/caret/监听清理通过，错配与旧Provider明确拒绝。 |
| T014–T017 同包消费 | `verified-consumer-install-verification.json`、各端`*-verified-pm-resolution.log`、`verified-collab-consumer-ci.log`。8bd的`consumer-8bd54232-installed-archive.log`、`consumer-8bd54232-source-verification.log`与七条`*-8bd54232-browser.log`记录全部运行码验收。 | 最终每端641项tarhash与integrity匹配，实体非symlink；PM路径一致，宿主/工具版本保留。三生产构建、三真实包装器构建及七组浏览器通过。 |
| T018–T028 上传/适配 | `final-targeted-tests.log`；`imperative-final.log`、`cdn-final.log`及三真实wrapper的8bd浏览器日志。 | 10个指定文件193tests通过；十个生命周期回调、五种来源、URL/base64、重试/否决/失败/超限/取消、原位更新保留JSON/标题/undo、共享Provider取消隔离、卸载通过。无真实上传端点。 |
| T011/T028 图表/资源 | `native-browser-final.log`、`final-cdn-all-features.log`、`final-theme-unmount-browser.log`。 | default/full/lite+feature/Element/CDN真实SVG/KaTeX/本地字体；五入口明暗主题及卸载；全部CDN feature与DOCX回读通过，零外网/资源404/pageerror。未逐类测其他Mermaid图表。 |
| T015/T029 归档/体积 | `final-verified-npm-pack.log`、`final-artifact-cache-probe.json`、`final-warm-all.log`、`final-library-size-report.json`、`final-archive-metadata.json`。 | 正常prepack/pack通过；破坏输出检测0/1/0；无改动warm pack同SHA。预算未提高；真实初始/lazy图、CJS外部PM、Element手动feature脚本另列，见性能文档。 |
| T003/T030 有效性能 | `final-library-build-timings.json`、`consumer-8bd54232-timings.json`、`ac008-matched-8bd-formal.json`、`ac008-matched-final-validation.json`。 | 每相至少3次。React同64工具包代码指纹/Rollup4.65：旧35.679/35.057s，新34.619/34.584s，无新增可比回退。Vue2当前103.173/86.016s，Vue3 34.762/36.045s。库ESM冷54.454/暖1.950s，冷反而更慢，不宣称慢已彻底解决。 |
| T031–T032 文档/边界 | README、安装/兼容/产物/性能及image/uploader文档已统一；`docs/guide/performance.md`记录数字与具体口径。 | webpack4仅普通主入口，现代Element ESM与显式collab有明确边界；Node14不扩展为Yjs>=16协同承诺。未测HMR/真实上传服务，原大chunk warning保留。 |

性能审计更正：旧React审计安装树实际Rollup4.67.5，偏离源锁4.65.0，因此此前33vs43及候选交错百分比不可用于库回退归因。已从原锁普通ci重建4.65控制组，64个实际构建工具包元数据与代码全指纹一致后重测，未升级业务工具链。工具图指纹`f3ea61083d9d9c99d33391f39b5781963058ef156d56ed32b824b941e9585d77`。全部不合格旧样本留审计，未计入有效结论；禁压缩与guard改写未进入主源码，PURE保留作为非阻塞改进。

临时文件集中上述implementation目录，可在审阅后清理；备份bundle位于其父目录，须保留。七个自建临时服务（含Root18422）均已停止；只清除了经dry-run确认误复制的control/.npm-cache约102MB，原缓存/源码/历史/预览不变。

T033 最终独立审查：No blocking findings；Simplicity PASS、Correctness PASS、APPROVE。审查确认同工具树有效对照与最终文档等价归档证据；仅只读，不由实现者自批。性能项的绝对“足够快”结论未获定义，按上述实测与限制收口。

## 第二轮：构建性能优化（2026-11-05）

- [x] T034 建立当前已验收版本的同工具对照，剖析Vue2 loader/minifier及库parse/Babel/Terser阶段，记录有效根因。
- [x] T035 减少库冷构建中的已证实重复工作，保持ES2018/Node14、压缩、大小和公开API边界，并加入必要定向回归。
- [x] T036 在不替换/升级VueCLI、Webpack、Babel或框架的前提下解决Vue2主要构建瓶颈，保留其它路由兼容。
- [x] T037 正常打包后，删除测试副本node_modules普通重装，重测Vue2/Vue3/React及webpack4、原生ESM/CDN、关键图表/公式/图片/卸载和协同回归。
- [x] T038 串行同工具冷/热各3次测量，更新既有性能文档，明确速度改善、体积与尚存瓶颈，不提高预算或隐藏告警。
- [x] T039 独立审查集成diff与真实证据，Simplicity/Correctness通过后收尾，保留原改动，未授权不提交/发布。

### 第二轮最终运行码验证（21e7ac87，2026-11-05）

- 正常 `npm pack`/prepack归档 `lark-doc-0.14.2-speed-21e7ac87.tgz`，SHA256 `21e7ac87db0c812eaa6e6f4f4640e237311d23a92e9a28a7f360883d596fd047`，13172360B/642文件。此前26b候选仅作诊断保留，不能当最终兼容验收。
- `speed-round2-final-targeted-tests.log`：10明确文件197项通过；`speed-round2-final-library-gates.log`：55出口、真实图语法/lite/原size预算/离线/zeroVue293与lint通过。未运行全Vitest；contract未生成的check明确跳过，不称已校验生成契约。
- `speed-round2-21e7ac87-matrix-install-verification.json`/`...-matrix-functional.log`：三宿主普通lock-only/删除测试node_modules/普通ci、每端642文件tarhash/integrity/实体、所有其余物理依赖代码与源/隐藏锁版本均一致；三app/三真实wrapper构建、七浏览器矩阵全过，零pageerror/HTTP404/failedrequest/consolewarn/error。
- 每宿主真实SVG/KaTeX/同源font；五来源分别URL/base64成功及source/mode；重试/否决/前置取消/上传失败/非法MIME/超限/显式取消以paste验证公共管线，唯一终态；uploader更新保留editor/JSON/title/undo；Vue2/Vue3实际路由卸载、三wrapper实际组件卸载。React产品为公开destroy，组件卸载由真实React wrapper覆盖。未验证真实上传服务或所有来源×所有负向的笛卡尔组合。
- Root额外：`speed-round2-21e7ac87-native-browser.log`五入口/late feature恢复/ESM全部feature Word回读/共享Provider取消隔离；`...-imperative-browser.log`、`...-cdn-browser.log`、`...-webpack4-upload-browser.log`完整图片矩阵；`...-extra-browser.log`真实Webpack4六API补齐/图表、CDN全部feature、ESM协同38位置roundtrip/同步/caret/销毁均通过。
- Webpack4已从21e普通干净重装再编译0error0warning，Root额外两consumer642归档文件全hash匹配；无overlay当验收。`...-published-collab-tests.log`9/9真实CJS协同；`...-node14-build.log`固定Node14源码core构建与`...-node14-cjs-runtime.log`strictUnhandled真实full普通编辑/Mermaid单层default初始化/卸载通过（jsdom仅补DOM全局与Range几何接口，图形在Chromium验证）。
- 仅保留既有npm弃用、Vue2 asset/entrypoint-size与第三方Babel大文件Note、Vite大chunk建议；未提高阈值或抑制告警。matrix自建服务及Root18422均已停止；原预览保持。
- T038正式性能及缓存失效已完成，T039独立最终审查已APPROVE；不由实现者自批。

### 第二轮正式性能与最终Vue2配置（2026-11-05）

- 库固定Node22/npm8，同一20591文件/191594175B真实工具树SHA256 `4b81b5f22e9ccb3b0c1f44bbcf0a0388013f5a665fdeb6c3dd08076532c0eb42`前后完全一致。`build:esm`冷中位47.9843→39.3416s（-18.0%），无改动缓存热1.5176→1.6878s（+0.17s）。各3次串行；证据`speed-round2-21e7ac87-library-formal.json`，不当全量all/HMR提速比例。
- Vue2原普通build对照83.2609/71.3884s；最终共享Mermaid+native cache+仅Terser上限4为66.1169/5.3228s（冷-20.6%、热-92.5%）。最终冷61.06/66.12/83.32、热3.94/6.62/5.32，完整方差保留；前cold1/warm1普通候选按源码/配置/命令/依赖/无并发精确一致证据复用，其余补齐，不混入profile或负向。证据`speed-round2-vue2-terser4-formal-timings.json`。
- 本机Terser独占profile47.24s为主要瓶颈；仅其parallel设4，Babel原15/CSS/原压缩与usage polyfill不变。仅cache首版cold89.80未改善；全parallel4和移除Babel线程无收益；直接排除3vendor会丢当前target补丁，未采用。更大共享Core/CSS改造未实施。
- 生产与consumer `vue.config.js` SHA256 `b644822b54e3e61ad091877d336680de11c2adf2e64b973fb7cc90cad97ef130`一致；148源/两锁、642 SDK与32569非SDK依赖代码全不漂。最终103应用产物/14882635B和50 wrapper产物/6971608B与原minifier逐字节一致。
- `speed-round2-vue2-terser4-regression.json/log`：新配置真实wrapper重建、Vue2/WC/wrapper3 browser完整图表/字体/回调/5来源URLbase64/更新undo/实际路由组件取消卸载均0error/404/console；其它V3/React同21e源码/锁/SDK指纹未变，其本轮完整证据有效，不无变化重复。所有matrix自建服务/浏览器已停；退出探测TIME_WAIT误判已改用connect/LISTEN并记录，不当产品失败。
- `speed-round2-vue2-final-21e7ac87-timings.json`另存native cache7次负向：source可见marker进入/恢复、Vue/Babel/lock单输入原生日志失效，最终源码/锁/SDK/工具和产物精确恢复。没有保留old=true warmcache切Terser4或同版本SDK真实热替换试验，不把普通clean install当缓存失效证据。
- 完整根因、修改边界、命令、前后指标和环境表在`docs/guide/performance.md`第二轮章节。未换应用工具链、未加依赖、未抬size/警告阈值；未commit/merge/push/release/deploy。T039最终独立review已APPROVE。

T039 第二轮最终独立审查：**No blocking findings；Simplicity PASS、Correctness PASS、APPROVE**。Reviewer独立复核21e归档与当前工作区及三consumer642文件、复算正式中位数并重跑Rollup/size、lite17/17、158真实语法区块及内存缺shared节点负例；审阅197+9测试与最终所有runtime/cache日志。40/40任务完成，Root最终diff检查通过。所有本轮自建服务/浏览器已停止（含Root18422）；原预览、原dirty与stash/bundle保留。未提交、合并、推送或发布；用户后续操作另等指令。


## 第三轮：初始化配置式 HTTP 图片上传（2026-11-05）

- [x] T040 明确初始化配置契约、优先级及基线失败复现：仅 action 原来误走本地 base64。
- [x] T041 内置 HTTP multipart 传输，支持地址/方法/字段/动态 headers/额外参数/响应映射/业务成功条件/超时/凭据，复用既有回调和取消管线。
- [x] T042 定向覆盖成功、失败、非法响应、进度、取消、超时、重试、配置校验及自定义/base64兼容，不引入依赖。
- [x] T043 更新上传及接入文档，保持所有框架共用配置。
- [x] T044 Node14/Node22及Rollup真实产物门禁通过，生成同一普通归档。
- [x] T045 同包在Vue2、Vue3、React、Webpack4普通干净安装/构建，原生ESM/full/lite/Element/CDN消费。
- [x] T046 各环境本地真实HTTP请求→服务器返回地址→图片实际渲染；URL/base64、五来源、完整适用回调、业务失败/超时/取消及图表公式字体回归。
- [x] T047 独立Simplicity/Correctness审查通过，复核归档与证据，停止自建服务，更新紧凑会话并交付。不得提交/合并/推送/发布。

本轮证据目录：`/tmp/lark-doc-master-audit-20261104/implementation/http-upload/`。契约及范围见controller现有会话首段，生产源码与前两轮基线快照见该目录 `before.tar`。本地模拟HTTP不等于真实业务后端联调。

### 第三轮验收证据（cd8436a9，2026-11-05）

- 普通 npm8 pack/prepack：`http-upload/lark-doc-0.14.2-http-cd8436a9.tgz`，SHA256 `cd8436a95a8aae347eea52682e43e3b9ff3af51fbd466249869d1e633113e462`，13708166B/646文件。`archive.json`/`archive-files.json`记录归档与全部packaged工作区文件逐hash一致；package.json与前21e字节一致，包内非dist只改README/core-upload/providers。
- `baseline-test.log`记录action-only原先错误返回base64；`targeted-tests.log`4文件112项通过，其中HTTP新38、既有upload35。早审multipart开销导致过早100%的P2已按实际传输比例归一修复，包含大data与未知总量回归。独立reviewer另重跑HTTP+旧upload73项及轻量产物门禁。
- Node14.21.3/npm8源码core构建与runtime检查、Node22全部Rollup构建成功；`library-gates.json`记录exports/lite/legacy/size/offline-assets/offline-mermaid六门禁0，55出口/lite17/17/158真实语法区块，未提高体积预算。architecture/lint通过；contract因生成物不存在明确skip，不声称已验证生成契约。原punycode/npm弃用/大包提示保留。
- `matrix/results.json`：Vue2/CLI5/Webpack5/Node14、Vue3/Vite7/Node22、React18/Vite7/Node22三端普通clean CI，每端实体646全hash/integrity匹配，所有非SDK工具包代码及源/hidden锁版本保持原指纹，PM issuer同类。三app+三真实wrapper六build全0；Vue2/WC/V3/React+三wrapper最新七browser全0。React首次隐式favicon404保留，测试静态服务提供204后只重跑对应场景，未改SDK或忽略其它失败。
- `native/native-final-validation.log`及`native-http-{default,full,lite,element,cdn,webpack4}.json`：六入口各29场景及bare/hostcancel/unmount通过；另六个`*-supplement.json`定点证明任何配置更新前完整初始配置、静态headers、更新保实例/正文/标题/undo且undo确改JSON。Webpack4.47/Node14真实module=ESM、17chunks、0error/warning；CJS Node14普通初始化/编辑/销毁通过（jsdom仅补窗口尺寸，不代表服务端原生XHR）。两处初次夹具问题（窗口尺寸/favicon）留before证据。
- 所有路径均实际发送multipart、验证文件字段/MIME/内容hash/headers/data，接收服务器URL或base64并真实渲染；URL图片GET200及naturalWidth>0，五来源与全部适用回调、业务/HTTP/坏JSON/缺URL/显式重试/取消/超时及晚到、CORS凭据正反、真实中间进度、图表SVG/KaTeX本地字体通过。没有应用自定义upload冒充内置transport，没有route.fulfill假图。
- `cleanup.json`独立连接检查8个本轮端口全部关闭；matrix6sites与native/API进程退出0，浏览器均关闭。仅Chromium及本地HTTP模拟，不声称真实业务后端、所有浏览器或所有图表类型均已联调。

证据目录统一为 `/tmp/lark-doc-master-audit-20261104/implementation/http-upload/`；旧21e归档、原dirty工作区/预览及备份保持。提交/合并/发布仍未授权。

T047 最终独立审查：**No blocking findings；Simplicity PASS、Correctness PASS、APPROVE**。Reviewer独立73上传单测及exports/lite/158语法/size复验通过，归档646全hash、三consumer实体646、实际graph可达性、六native及七browser原始HTTP/初始化/图像/负向与清理证据均复核。早审P2已关闭。Root独立复核8端口全部关闭，当前源码及归档hash未变，diff检查通过。第三轮T040–T047完成；未提交/合并/推送/发布，未操作真实后端。

## 第四轮：文档与发布收尾（2026-11-05）

- [x] T048 迁移过时的 Vue/SFC、模板、菜单及 WC 持久化测试；启用单测隔离，完成现代Node全门禁92文件1972tests及Node14产物/94Vditor校验。旧DOMsnapshot内部跳过如实记录。
- [x] T049 修复 manifest 动态版本、版本缓存指纹及版本不一致拒绝，校验0/1/1/0且原文件精确恢复；支持明确当前版本/断点恢复，保留master与registry/tag保护。
- [x] T050 同步README、开发指南、环境接入及完整上传文档，新增静态demo base64/server/diagram预设，旧内网helper边界明确；VitePress死链检查通过。
- [x] T051 Pages从同提交构建Rollup并字节同步UMD/五功能脚本/字体，移除陈旧生成文件；同大小不同内容同步负测通过；真实浏览器11项示例验收通过。
- [x] T052 最终646文件归档与工作区逐项一致、532JS与已验HTTP包相同；独立审查Simplicity/Correctness均PASS、APPROVE，冻结源码。后续按用户授权执行commit/本地ffmerge/GitHubpush/npm发布，实际线上结果另记。

本轮验证输出集中 `/tmp/lark-doc-master-audit-20261104/implementation/release-0.14.4/`，
含 prepare-release-after-isolation.log、portable-build-contract.log、version-cache-probe.json、demo-sync-probe.json、
docs-build-integrated.log 和 demo-browser.json。真实业务上传服务及非Chromium仍未测试；旧完整HTTP多环境矩阵继续有效。
发布实际结果记录在控制目录既有会话续接文件及最终交付中，不把准备包冒充已发布包。


## 第五轮：六环境上传复验、文档收敛与功能回退恢复（2026-11-05）

- [x] T053 用同一发布包建立六环境真实 HTTP 上传基线，定位应用 `onCallbackError` 漏报，双路去重报告并做红绿回归。
- [x] T054 帮助菜单支持初始化开关、选项和应用回调，保留默认菜单和内置快捷键；更新配置说明与在线代码示例。
- [x] T055 收敛调用者导航与配置目录，六环境各一页集中接入；维护者资料保留源码并排除部署及搜索。
- [x] T056 核对最近一周已合 master 的功能，按提交及真实调用链区分回退、等效重构、未合入与旧修复不完整。
- [x] T057 恢复图表图标/三入口菜单/hover、自动保存和导入导出配置、媒体出口、详细错误与高亮重试；覆盖真实 DOM 与多实例回归。
- [x] T058 最终源码冻结后正常构建与 pack；同一新归档六环境普通安装、原工具链构建、上传全场景及图表真实 SVG 复验。旧候选不能替代最终包证据。
- [x] T059 最终全门禁与文档默认/自定义 base 浏览器验证通过，更新归档身份和实际验证记录。
- [x] T060 独立审查最终集成与证据；只有本地验证全部通过后，才按既有授权合并、推送、npm 发布和部署，并核验线上实际资源。

证据集中 `/tmp/lark-doc-upload-docs-20261105/`；回退根因与持续防护见 `dev/05-验证资产.md` §5.6。
