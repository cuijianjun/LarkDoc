# Implementation Plan：master 集成与上传回调修复

状态：**DRAFT / 待用户确认，禁止据此直接编码**。基线及行为见 [spec.md](spec.md)。本文件同时承担任务合同，不另建报告或规格系统。

## 1. 任务合同与仓库现场

- 目标：收口核查项 2/3/4/5/7；保留项 1 的库级 Rollup 构建与项 6 的已测图表能力。
- 目标库：`/Users/cjjxw/codex/tiptap-integration-demos/apps/lark-doc`；master `4e7cc43`，Tiptap 3.32、原生 DOM UI、Rollup3、npm lockfile。
- 库 Node14.21.3 兼容承诺保留；完整开发安装/Vitest 使用 Node22.13.0 + npm8.19.4。Vue2 宿主 Node14.21.3；Vue3/React Node22.13.0。不得静默用全局 Node/npm 替换。
- 当前主目录 detached 于旧 837e329 且有既存用户改动；旧 master worktree 已不存在。只读以 `git show master:<path>` 和干净快照为准。实施前再建立合适的 master 工作区，不重置/覆盖现场，不自动恢复 stash。
- 用户本地改动独立备份：`/tmp/lark-doc-master-audit-20261104/master-local-changes.bundle`。它不是可随测试产物清理的临时文件。
- 本阶段允许写入：本 feature 三份 Markdown 与控制台现有续接记录。禁止：任何实现代码、配置、manifest、lock、测试源码、Git提交/分支切换、远程写入。允许在 `/tmp/lark-doc-master-audit-20261104/` 的测试副本清依赖、安装、构建与诊断。
- 本轮“删 node_modules”指四个明确测试副本，不删除原工作区依赖；先记录路径、确认删除且不跟随符号链接，再重装。库旧 dist 也从副本清空。缓存为 `clean-recheck-cache/`，新日志带 `clean-` 前缀。

## 2. 证据与根因分级

证据基线由干净 4e 快照生成；此前 421 个 tracked 文件 Git blob 校验无差异。原始日志集中 `/tmp/lark-doc-master-audit-20261104/`；该目录可能清理，因此此处保留关键摘要，日志仅为详细旁证。

| ID / 原核查项 | 已确认的根因或证据 | 计划修复，及不能据此推出的结论 |
|---|---|---|
| R01 / 2 性能 | Rollup CJS/Element `inlineDynamicImports: true`，重依赖合并；配置未使用已安装 terser 压缩 JS。首轮 gzip Element2.54MB、CJS2.49MB、collab10.48kB 超预算。所有 target 串行重建存在重复工作 | 修正按需边界、目标级重建/缓存、压缩及统计；串行/体积是已见结构，具体应用慢的主要占比须计时，不能凭换 Rollup 宣称解决 |
| R02 / 3 入口 | `src/full.js` 存在，但 package exports 与 Rollup targets 未接通；`lark-doc/full` 报未导出 | 补现有 full 入口及真实产物、exports、sideEffects 和消费测试，不创建另一套内核 |
| R03 / 3 lite | `rollup.config.mjs:26-46` 中 lite Map 先设 stub，后面的公共同名键覆盖 mermaid/css；部分 import specifier 有扩展名差异 | 明确各 target 的最终 alias，统一实际 import specifier；校验最终模块图，不能只调文案 |
| R04 / 2/3 门禁 | check-lite 仍匹配旧 `lite.*.esm.js`，漏掉 `lark-doc-lite-*.esm.js`；size 只读296/301B入口壳，未算静态依赖 | 更新现有门禁支持真实 Rollup 图/哈希命名，构造薄壳引用重依赖的反例，区分初始与 lazy 预算 |
| R05 / 4 兼容 | `scripts/build-rollup.mjs:2` 使用 Node14 无的 `fs.cpSync`；Rollup 不自动将应用和依赖语法降至 ES2018，现有 CJS/UMD 解析均失败。`module`仍指向ESM，webpack4可能先选它，不读exports | Node14兼容复制；先断言实际resolver路径，再降级该路径及全部可达chunk。保留main/module含义，推荐使公开ESM也满足webpack4解析能力。terser不是完整语法降级器，不以宿主alias/Babel或仅CJS绿色代替证明 |
| R06 / 5 安装 | 三 demo manifest 指向已删除 `.wt-larkdoc/rollup-library-build`；npm ci 仍可 exit0 留悬空链接 | 改为稳定依赖来源并从同一真实 tgz 消费；安装后必须解析入口/检查链接再构建 |
| R07 / 4/5 peer | optional peer 在宿主已有旧版本时仍参与 npm 解析。Vue2 provider1.1.3 与 ^4.7.1、Vue3 yjs13.6.27 与 ^13.6.33 冲突 | 将普通编辑与显式协同依赖校验的责任拆清；仅改子路径或 optional=true 无法隔离包级 peer。不得强制安装或无证据放宽兼容范围 |
| R08 / 7 上传 | `LarkDoc._resolveUploader` 返回 Provider 对象，`domRenderer.createImageResolver` 却只调用 function；实测 upload0次，静默base64 | 保留一个 Provider 实例，通过明确 upload 方法调用，并保留 cancel/pending 等已有能力；不是单测裸 upload 绿即可 |
| R09 / 7 回调 | 现有公开 options 未完整转发生命周期；renderer只给 file，不给任务进度上下文；校验/图片读取错误还可能在 Provider 前发生 | 在同一管线覆盖前置拒绝、前置回调、上传/读取、进度、重试、终态、清理；不在每个UI入口复制回调逻辑 |
| R10 / 7 适配 | React wrapper 属性白名单忽略对象/函数；Vue3 attrs helper不承载对象；Vue2旧组件直接走renderer，绕过门面归一；renderer对attchId有强制校验但文档称可选 | 显式对象property透传，统一归一和可选附件ID语义；所有入口的回调必须到达应用，不能只写示例承诺 |
| R11 / 4/5 构建链 | `ensure-artifacts.mjs`通过PATH执行`npm`，不复用父进程npm_execpath；本轮父命令npm8.19.4，PATH中的Node22目录npm实际11.2.0 | 子构建复用已验证的Node/npm执行入口，记录真实版本，防止prepack悄悄换包管理器；本轮该链的诊断结果单独标明版本漂移 |

### 清依赖重测记录（2026-11-04，已执行）

| 项目 | 过程 | 本轮结果/日志 |
|---|---|---|
| 库 Node22 | 删除 node_modules/dist → 全新缓存 npm ci → build:all | 重装成功9.85s；build:all成功179.33s；`clean-library-install.log`、`clean-library-build-node22.log` |
| 库 Node14 | 使用干净重装依赖执行原 build | exit1，0.73s，仍为 cpSync 缺失；`clean-library-build-node14.log` |
| 针对性测试 | 只运行 upload-provider、image-insert、image-nodeview、dom-renderer-contract | 四文件62项通过，7.37s；`clean-library-targeted-tests.log` |
| Vue2 原样 | 删除 node_modules → 全新缓存 npm ci → build | 安装39.51s成功；构建20.73s失败，缺本地库 |
| Vue3 原样 | 同上 | 安装8.92s成功；构建3.74s失败，缺本地库 |
| React 原样 | 同上 | 安装2.97s成功；构建3.90s失败，缺本地库 |
| 同版显式消费 | 新构建测试tgz，--no-save/--package-lock=false安装，再build | Vue2安装126.35s失败（provider peer），Vue3安装34.80s失败（yjs peer）；React安装55.65s/build34.43s成功，仍有chunk>500KB警告 |
| 产物门禁 | 针对新dist运行rollup/lite/legacy/size | rollup通过；lite2/16失败；CJS/UMD均非ES2018；Element2.54MB/CJS2.49MB/collab10.48kB gzip仍超预算，入口壳232/236B不能代表全图 |
| 图表 | 本轮新lite+feature，既有断网浏览器脚本 | 真实SVG37节点、零外网请求，通过；`clean-offline-mermaid.log` |
| 真实npm pack | 不跳过prepack，记录实际子npm版本 | exit1，130.15s；重新构建后被size预算拦截，未通过真实打包；`clean-npm-pack.log`，子npm漂移见R11 |
| 图片应用调用链 | 新ESM产物、真实浏览器插入文件和URL | URL保留/base64可插入，但应用upload仍0次、传递类型object；新增生命周期回调尚无实现/未透传，不能当已支持；`clean-browser-audit.log` |
| 源码完整性 | 对src/scripts/manifest/lock/rollup配置与4e Git blob逐项核对 | 421项差异为空；三端src/manifest/lock前后hash也不变；`clean-source-integrity.log` |

诊断宿主安装使用 `--ignore-scripts`，只能证明该模式下的依赖解析与构建结果；将来正式完成必须执行普通安装和真实 prepack。首轮 npm pack 意外触发重复构建已终止；本轮重跑普通pack另记。显式消费的新包为`lark-doc-clean-0.14.2.tgz`，SHA256 `1510f26b289f98974a950e6aa44868fe9967e668b425e4224768cf20a7c666fe`，由成功构建产物手工打包，只用于隔离安装/构建问题，不代表发布链通过。Vue2旧弃用warning和React大chunk警告均保留，未force/legacy-peer-deps绕过。

## 3. 修改范围与复用策略（仅为确认后的白名单）

| 工作包 | 预计文件/模块 | 边界 |
|---|---|---|
| A 运行时与产物 | `rollup.config.mjs`、`scripts/build-rollup.mjs`、`scripts/ensure-artifacts.mjs`、`package.json`/lock | 只修库构建、入口、兼容、必要依赖；不改应用工具链、不升Node下限 |
| B 全量/按需/度量 | `src/full.js`、`src/index.js`、`src/core/features/{registry,stub}.js`（仅证明确需时）、既有 `scripts/check-{package-exports,lite-artifacts,legacy-syntax}.js`、`check-rollup-artifacts.mjs`、size配置 | 复用现有注册表/门禁；不新建插件系统，不以提高budget或忽略错误过关 |
| C 协同安装边界 | package peer 元数据、`src/collab/index.js`/既有相关策略、协同契约测试 | 不重写协同协议，不连接真实服务；保留显式collab external与Yjs单例 |
| D 图片管线 | `src/LarkDoc.js`、`src/mount/domRenderer.js`、`src/core/media/upload.js`、`src/providers/upload.js`、`src/editor/nativeEditorHost.js`、`src/core/nodeviews/image.js`（仅替换/裁剪接线） | 复用现有重试、分片、校验/错误码与取消；无真实上传服务、不改图片Schema真源 |
| E 适配层 | `src/components/lark-doc/LarkDoc{Editor,Workspace}.js`、`src/legacy-vue/createVue2Adapter.js`、`src/adapters/{vue3,react}/index.js`、`src/web-component/{LarkDocElement,index,events}.js`（按需） | 函数/对象走property而非attribute，不把框架运行时引回库，不复制上传实现 |
| F 消费与文档 | 三demo的package/lock和各LarkDoc页面/React App；库README、兼容/安装/构建/性能、图片/uploader文档；既有CI相应job | 只调整库消费来源、options及验收示例；不升级应用构建工具或做其他页面重构 |
| G 验证 | 既有上传/图片/renderer/features/legacy-adapters测试和浏览器验证；必要时新增最小消费夹具 | webpack4只存在于隔离消费者夹具，不加入库构建依赖图；不得用全量测试代替针对性证据 |

**依赖政策**：不新增运行时依赖。压缩复用已声明的 `@rollup/plugin-terser`。语法降级拟采用 Rollup 的 Babel 插件及 Babel7兼容工具作为开发依赖；实施时先核对现有可复用工具，选择支持 Node14 的精确版本并锁定，说明必要性。禁止恢复 Vue CLI/Webpack；如果不需新增则不添加。未批准方案前不改manifest/lock。

## 4. 关键实施决策

### 4.1 协同 peer 的推荐处理

建议普通编辑安装不再受未使用的协同版本约束；把协同所需依赖与兼容性验证收敛到显式 collab 功能及其契约测试。根包可选peer不是“仅在导入子路径时检查”，只拆源码入口无效。

确认后先用现有两类失败宿主建立负向/正向安装夹具，再决定最小元数据改动及显式协同校验位置。必须同时证明“普通编辑安装成功”和“受支持协同组合通过、已知不支持组合明确失败”；不能为普通安装去掉所有协同验证。若保留npm安装期peer强约束只能通过独立协同分发包实现，应单独提请确认，**不在本方案默认新建包或迁移应用协同栈**。

### 4.2 上传管线

统一 Provider 归一、生命周期与任务身份；renderer/NodeView只发起任务、消费结果和更新文档。既有三个 uploader 写法兼容；生命周期对象在门面、Vue2直挂及Web Component路径都只归一一次。

按 spec 的十个回调和时序实施；`ctx.cancel(reason?)`覆盖异步beforeUpload等待期间取消，signal和任务终态一致。通知型回调返回Promise时接住rejection但不阻塞上传或触发二次上传/递归错误；终态清理恰好一次。事件载荷只在应用回调内传文件与结果，日志只保留必要元数据，不输出文件正文、凭证或上传内容。失败不覆盖旧图；显式上传失败不自动base64成功。

现有示例只证明Vue2主页面和WC页面注入了裸upload；Vue3/React页面未提供完整回调示例。此项是示例/验收缺口，不能仅凭未写示例反推库内部全部能力不存在；适配层是否透传以源码及浏览器验证为准。

### 4.3 性能与引入契约

优先修复重依赖泄漏、错误入口、重复构建和未压缩，再按 target/cache做必要优化；不先重写全部构建。CJS可验证Rollup原生拆包与同包兄弟文件加载；UMD不支持直接套用ESM多文件输出，应复用既有feature UMD/registry明确其按需注册/加载与同位资源契约，不能仅关闭inlineDynamicImports便宣称可用。同步全量入口与基础入口预算分别定义，保留原能力与离线字体/样式、注册副作用。

ESM/lite已有310/300KB是历史“主文件”口径，不能直接移作整个静态闭包的新预算；必须分别报入口壳、静态初始图、lazy图。Element475KB/CJS1080KB/collab4KB现有同口径预算不能抬高掩盖回归。绝对编译耗时SLO目前未给定，需用户另确认才宣称“慢已解决”。

## 5. 验证命令与执行条件

以下为**确认后**的实施验收命令，本阶段仅基线重测；不存在的夹具/定向测试必须先由对应任务新增，禁止把计划命令写成已通过。

| 目的 | 命令/执行方式 | 预期 |
|---|---|---|
| 干净库安装 | Node22.13.0执行npm8.19.4：`npm ci --no-audit --no-fund` | 无依赖冲突；记录deprecation，不自动升级 |
| 旧运行时构建 | 已装依赖后，Node14.21.3/npm8.19.4：`npm run build` | 无cpSync/现代语法错误 |
| 产物构建 | Node22/npm8：`npm run build:all` | 所承诺格式与资源齐备 |
| 入口/分包/语法 | `npm run check:pkg`、`npm run check:rollup`、`npm run check:lite`、`npm run check:legacy`、`npm run size` | 全部exit0，统计真实依赖图 |
| 定向上传回归 | Node22：`node node_modules/vitest/vitest.mjs run test/unit/upload-provider.test.js test/unit/image-insert.test.js test/unit/image-nodeview.test.js test/unit/dom-renderer-contract.test.js --maxWorkers=1` | 包含新增失败优先用例；不使用带固定test/unit过滤的npm脚本误跑全套 |
| feature/适配回归 | 同一Vitest入口，显式列 `features-registry.test.js`、`legacy-vue-adapters.test.js` 和本次新增适配用例 | 只跑受影响文件 |
| 图表离线 | `node scripts/verify-offline-mermaid.mjs`；默认/Element复用既有浏览器验证并传消费端URL | 真实SVG、零外网、无pageerror |
| 真实分发 | `npm pack --pack-destination <本轮临时目录>`，普通prepack不跳过 | 成功生成tgz且门禁不被绕过；无无谓重复构建 |
| 三端消费 | 每端删除副本依赖后按锁重新安装；安装同一tgz、解析入口；对应pinned环境 `npm run build` | 原样和显式消费分开记录，最终无失效路径/peer冲突 |
| webpack4 | 新增最小隔离消费者夹具后，在其目录Node14/npm8 `npm ci && npm run build`；断言resolver实际选中的main/module文件及所有可达chunk | 不依赖源码alias或库专属转译配置，不假定module被忽略，不用CJS script解析器误判ESM模块语法 |
| 浏览器上传矩阵 | 确定性假上传，在命令式、Vue2、Vue3、React、WC页面执行spec AC-007；复用Playwright runner | 五种宿主得到相同适用回调序列、次数/载荷正确 |
| 耗时 | 对相同命令使用 `/usr/bin/time -p`，冷/热各三次，固定缓存/入口/运行时/同一tgz | 表格含中位数、体积与warning；不混网络安装和编译时间 |
| 变更范围 | `git status --short`、`git diff --check`、按白名单审diff | 无用户改动被覆盖、无无关源码或产物入diff |

普通安装若因网络/工具环境阻塞，保留首个错误并记BLOCKED；不得伪造“所有环境通过”。不调用真实AI/上传/协同账号，不部署或发布。

## 6. 执行顺序与所有权

确认后：基线与失败用例 → 运行时/打包边界 → 同版消费安装 → 图片核心管线 → 适配与浏览器矩阵 → 性能复测/文档 → 独立审查。

- 主Agent：解释需求、package/rollup整合、分发契约与最后集成；package.json、lock、构建脚本只设一个写入者。
- 上传Worker：只拥有core/media/upload及图片调用链；适配Worker写入前须固定此契约。最多三名实现Worker，深度1。
- 适配/消费Worker：只拥有明确分配的适配器和demo文件，不碰共享构建元数据。不能隔离时顺序写。
- 验证/Reviewer：检查真实产物、证据和差异，不实现修复，不把实现者自检当独立审阅。
- 本阶段没有实现Worker；仅只读诊断和规划文档审阅，不建立开发分支或提交。

## 7. 完成定义与残余风险

所有AC具备可复验日志、无未解决阻塞审查项，tasks才可逐项勾选。新开发依赖有必要性说明；产品与文档写法一致；旧API/图片数据/卸载行为不回退。真实npm分发、webpack4、全部上传环境或协同负向证据缺失时，明确未完成，不能借“React构建绿”推定其他端通过。
