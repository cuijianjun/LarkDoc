# Tasks：master 集成与完整上传回调修复

状态：**待用户确认；以下全部未实施**。输入：[spec.md](spec.md)、[plan.md](plan.md)。ID为本feature局部编号，与旧分支T001等无继承关系。`[P]`仅表示无写入冲突时可并行，不是已授权执行。

## Phase 0：授权、基线与失败复现

- [ ] T000 用户确认本目录三份文档，尤其完整上传回调契约、协同peer边界及开发依赖政策；确认前不得编码。
- [ ] T001 复核master、实际worktree、dirty状态与备份；从当前确认基线准备合适工作区。禁止重置旧detached现场或恢复stash混入master。（AC-010）
- [ ] T002 [P] 四个测试副本实际删除node_modules并检查不存在；库副本清旧dist，再用pin运行时/包管理器及明确缓存策略安装。记录源/清单/锁hash、版本、耗时和首个错误；本阶段重测仅作为证据，不等于该实施任务已完成。（FR-016，AC-010）
- [ ] T003 [P] 将库与三端应用的安装/单target/全量/冷构建/热构建和实际资源大小分开记录；固定同机/入口/缓存口径，标明绝对耗时SLO未指定。（AC-008）
- [ ] T004 在既有门禁/针对性测试中先加入确定失败复现：Node14复制API、ES2018、full未导出、lite哈希区块漏扫、门面upload不执行、可选attchId被拒。确认失败对应实际问题后才修复。（AC-001/002/003/006）

## Phase 1：运行时兼容与真实入口

- [ ] T005 仅修改`scripts/build-rollup.mjs`相关复制逻辑，使用Node14可用能力，复用现有资产复制方式，保留CSS/字体；跑Node14库build。（R05，AC-003）
- [ ] T006 在`rollup.config.mjs`为CJS/UMD补明确ES2018降级与必要polyfill策略，同时覆盖webpack4按module真正选中的公开ESM及可达chunk；先验证resolver再决定必要路由，保留main/module语义，不以宿主alias/Babel兜底。压缩复用terser；必要开发依赖核对Node14兼容并精确锁定，不引入Vue CLI/Webpack。（R05，AC-003）
- [ ] T007 对新CJS/UMD运行`check:legacy`，新增最小webpack4隔离消费夹具，断言实际被选中的入口及全部可达chunk并编译；不能假定它忽略module而选CJS，原Vue2/Webpack5不得冒充webpack4结果。（AC-003）
- [ ] T008 将现有`src/full.js`接入Rollup/exports/sideEffects与资源清单，保持默认API、old入口及显式collab边界；更新`check-package-exports.js`相关断言。（R02，AC-001）
- [ ] T009 修正lite alias覆盖次序和实际specifier匹配，保证所有被排除重依赖从lite的整个闭包消失；复用现有registry/stub，不新建加载系统。（R03，AC-002）
- [ ] T010 更新`check-lite-artifacts.js`和产物检查覆盖真实Rollup哈希命名/依赖边；加入薄壳引用重依赖的失败样例和全量正向指纹对照，去掉已删除Webpack脚本修复提示。（R04，AC-002）
- [ ] T011 分别校验默认/full/Element/lite/feature的能力、CSS、字体、注册副作用与模块格式；现有Mermaid离线脚本及真实SVG回归通过。（AC-001/002/009）

## Phase 2：安装边界与同版消费

- [ ] T012 先建立Vue2旧provider与Vue3旧yjs的普通编辑安装复现，以及显式collab支持/拒绝组合的契约验证。确认包级optional peer的实际约束，不把仅拆子路径当解法。（R07，AC-005）
- [ ] T013 按plan 4.1收敛根包普通编辑与显式collab的依赖验证责任，证明默认安装不受无关版本阻塞，collab external/单例/兼容验证不丢失。若需要独立分发包，停止该分支并另请用户确认，不默认新增包。（AC-005）
- [ ] T014 修正三个demo中已删除worktree的file依赖，使用稳定同级库来源并同步各自锁；不升级宿主Node、Vue/React/Vite/Webpack，不使用force/legacy-peer-deps。（R06，AC-004/005）
- [ ] T015 修复既有ensure-artifacts/prepack的产物复用和必要重建逻辑；子进程复用已验证的Node/npm入口而非PATH中其他npm，记录实际版本。真实`npm pack`通过，生成同一测试tgz给各消费端，不以手工tar作最终证据。（R11，AC-010）
- [ ] T016 [P] Vue2在Node14/npm8干净安装同版包并构建、挂载/卸载，记录入口、CSS、字体与chunk请求；保留宿主现有Vue CLI/Webpack。（AC-004）
- [ ] T017 [P] Vue3/React在Node22/npm8分别干净安装、构建、挂载/卸载；记录peer解析、warnings与产物，不因React单端通过推定全端通过。（AC-004）

## Phase 3：图片单一管线与完整回调

- [ ] T018 用真实门面`new LarkDoc`补失败优先集成测试：对象uploader、裸函数、旧uploadImage、自建Provider实际执行，URL/base64采用结果，合法无attchId返回可用；只测裸Provider不算完成。（R08/R10，AC-006）
- [ ] T019 在LarkDoc、domRenderer、core/media/upload与必要的native host之间统一Provider对象/方法及任务上下文，只归一一次，保留cancel/pending能力，不丢弃应用回调。（R08/R09，FR-009/015）
- [ ] T020 实现spec所列beforeUpload、upload、onStart、onProgress、onRetry、onSuccess、onError、onCancel、onReject、onSettled及ctx.cancel(reason?)；验证异步beforeUpload等待中取消、迟到结果/异常不复活任务、通知回调Promise rejection被接住、唯一终态、重试/分片和清理。（AC-006/007）
- [ ] T021 统一文件选择、拖拽、粘贴文件、替换、裁剪的事件source和任务身份；已有链接插图不伪造上传事件。无upload时本地base64也通知应用；自定义upload失败不静默降级成功。（FR-010/011/013）
- [ ] T022 复用Provider取消/清理，在销毁、切文档、只读变化时阻止晚到结果写入；允许应用取消，失败保留旧图，多文件不串任务，重复选择同文件可重试。（FR-012/013）
- [ ] T023 扩展既有upload-provider、image-insert、image-nodeview、dom-renderer-contract针对性测试，覆盖成功/失败/超限/取消/回调异常/结果格式、进度单调/分片/重试与卸载；全部用假上传。（AC-006/007）

## Phase 4：所有应用入口透传与浏览器矩阵

- [ ] T024 Vue2旧组件props和直挂renderer路径透传完整uploader对象；新增/更新legacy-adapter回归，避免绕过门面导致行为不同。（FR-015）
- [ ] T025 Vue3及Web Component明确通过element.options property传对象/函数；避免attrs helper序列化丢失，并验证挂载前后options更新与卸载。（FR-015）
- [ ] T026 React包装器通过property/effect透传uploader/options并保留函数身份，跳过attribute序列化；处理回调更新与effect清理，不引入框架运行时到库。（FR-015）
- [ ] T027 在各demo既有LarkDoc页面加入确定性完整回调示例，使用统一字段/载荷；不改变应用工具链，不增加真实上传端点或凭证。（FR-015，AC-007）
- [ ] T028 对命令式、Vue2、Vue3、React、原生WC/CDN分别执行真实浏览器上传矩阵，断言应用收到的全部适用回调顺序/次数/参数；覆盖URL/base64、失败取消、超限以及替换/裁剪、路由卸载。（AC-007/009）

## Phase 5：性能度量、文档与独立验收

- [ ] T029 修正size与初始资源度量，明确入口壳、静态初始图和lazy图；现有Element/CJS/collab可比预算达标，不提高limit或隐藏大chunk警告。（R01/R04，AC-008）
- [ ] T030 在已证实瓶颈处减少未使用重依赖和无谓重复构建；复测相同命令冷/热各至少三次中位数，记录前后差异，不将首次清缓存数字直接与旧暖缓存比较。（FR-016/017）
- [ ] T031 更新README、安装/兼容/产物/性能及图片/uploader文档，统一全量/按需写法、运行时承诺、完整回调与错误语义；所有应用沿用自身工具链。（AC-001/003/006/008）
- [ ] T032 在同一集成树运行相关入口/lite/legacy/size门禁、定向单测、真实pack及消费/浏览器验证；列清未测环境和warning分类，保留命令、退出码和版本证据，不自动跑全套无关测试。（AC-010）
- [ ] T033 独立Reviewer检查行为/范围/兼容/负向与证据，Simplicity和Correctness均通过；确认无用户原改动被覆盖、无未授权依赖/源码/产物，再更新本feature状态，等待后续发布指令。（AC-010）

## 依赖与执行规则

- T000是实施硬闸门。本阶段的诊断命令和文档写入不构成T000通过。
- Phase1先保证产物可消费；T012–T017依赖相关入口和pack就绪。peer/运行时阻塞时不能把浏览器未运行记通过。
- 上传失败复现T018可先做；T019–T023契约固定后再做T024–T028，跨环境不复制生命周期状态机。
- package/lock/Rollup/公共门禁设唯一写入者。`[P]`测试可分端并行，其他并行写入必须隔离且互不覆盖；最大三名实现Worker、不得再委派。
- 每一项完成必须有对应AC的真实证据，失败保持未勾选；不得只改文档勾选、抬预算、放宽peer或关闭测试来过关。
