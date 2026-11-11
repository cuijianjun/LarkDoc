# Specification：master 集成、产物与图片上传修复

状态：**DRAFT，等待用户确认；未授权实施**。日期：2026-11-04。

基线：`master` / `origin/master` = `4e7cc4338c04b5a4aa8dfa49f784c18d0a0f3b77`，版本 0.14.2。本文只规定修复后的行为；根因、范围、命令和实施顺序见 [plan.md](plan.md)、[tasks.md](tasks.md)。

## 1. 目标与边界

将原七项核查中的 **2（性能）、3（引入）、4（环境契约）、5（demo）、7（图片回调）** 收口。原第 1 项的 **Rollup / 去 Vue、Webpack 只针对库包**，已经完成，不要求应用层更换 Vue、React、Vite 或 Webpack。原第 6 项已验证的 Mermaid 渲染作为回归保护，不作为待重写功能。

- 库路径：`/Users/cjjxw/codex/tiptap-integration-demos/apps/lark-doc`。
- 消费端：同级 `vue2-webpack-node14`、`vue3-vite`、`react-vite`，以及 Web Component / 原生 HTML。
- 当前检出目录可能不是 master，且有用户原有改动。编码前必须重新确认工作区和基线；不得从脏的旧检出取源码、恢复 stash 或覆盖用户文件。
- 本阶段只新增本目录三份规划文档和更新控制台续接记录，不修改实现源码、构建配置、依赖清单、锁文件或测试源码；不提交、推送、发布、部署。
- 不实现旧 spec-kit 清单里的 BlockAPI、协同产品扩展等无关任务，不初始化 OpenSpec 或下载 Spec Kit 模板。

## 2. 用户已明确的要求

1. Rollup 范围仅为包；应用使用自身框架与构建工具。
2. 验证必须先实际删除库与三个 demo **测试副本**的 `node_modules`，确认不存在后重新安装；库构建还须清空测试副本的旧 `dist`。不借用旧符号链接、旧构建产物或原项目的 node_modules。
3. 图片上传的完整生命周期回调必须可交给应用；命令式 API、Vue2、Vue3、React、Web Component 均支持，不能只在内核测试里可用。
4. 允许安装、测试和构建；确认本方案前不得修复任何实现代码。

## 3. 需求与验收标准

### US1 / P1：可真实消费的全量与按需入口

- **FR-001**：保留默认 `lark-doc` 的公开 API，提供可解析的 `lark-doc/full` 与 `lark-doc/lite`、`lark-doc/features/*`。推荐命令式写法保持 `import { LarkDoc } ...` 与 `new LarkDoc(options)`。
- **FR-002**：`full` 复用现有 `src/full.js` 和相同内核，包含其声明的全部可选本地能力。协同仍是显式 `lark-doc/collab`，不内联另一份 Yjs 或要求普通编辑宿主安装协同依赖。
- **FR-003**：lite 的整个 JS 依赖闭包（静态及动态 import），均不得携带 KaTeX、Mermaid、Office、Markdown、高亮等被排除的真实实现。加载相应 feature 后能力恢复；未加载时按已声明方式降级，不自动下载被排除的大依赖。
- **FR-004**：CSS、字体和副作用注册模块真实随测试包发布。检查必须从消费者安装的包执行，不只检查源码目录中是否存在文件。
- **AC-001**：打出的真实 npm 测试包中，默认/full/lite/features/element/vue2/vue3/react/collab 等已承诺入口均能按各自模块格式解析；默认导出行为与旧消费者保持兼容。`full` 不再报 `ERR_PACKAGE_PATH_NOT_EXPORTED`。
- **AC-002**：lite 扫描包含 Rollup 哈希区块；用“薄转发入口引用大区块”的负向样例证明门禁会失败。全量图中仍能找到重依赖正向指纹，防止指纹失效造成假通过。

### US2 / P1：环境契约与旧运行时兼容

- **FR-005**：保留当前 Node14.21.3 源码构建/消费兼容承诺，不通过提高库 engines、升级 Vue2 应用运行时、关闭门禁或重新引入 Vue CLI/Webpack 来规避。完整开发依赖安装与 Vitest 可使用 Node22.13.0；这不等于承诺所有开发工具可在 Node14 安装执行。
- **FR-006**：CJS / Element UMD 满足项目已有 ES2018 语法口径；明确语法降级、压缩与运行时 polyfill 三者不同。现有 `module` 字段指向 ESM，webpack4不读exports且可能优先选module，不能假定它选CJS。推荐保留现有main/module含义，对webpack4实际选中的公开ESM及其所有可达chunk同样降级不支持的语法；保留其支持的模块/dynamic import形式，以真实webpack4编译证明。若需改变包路由，先评审兼容性，不要求宿主加alias/Babel兜底。
- **FR-007**：普通编辑在现有 Vue2、Vue3 宿主已有旧协同依赖时仍能干净安装；显式协同入口继续遵守受支持依赖与单例契约。不得使用 `--force`、`--legacy-peer-deps` 或未经证明的 peer 范围放宽代替修复。
- **FR-008**：安装、默认入口、样式、options、事件和 destroy 契约统一。SSR 的客户端挂载、自定义标签识别、静态资源托管等必要宿主机制需有明确对照；不承诺抹平浏览器/框架固有差异。
- **AC-003**：Node14 库构建和 CJS 解析通过；最小 webpack4 消费验证通过。现有 Vue2 demo 是 Vue CLI5/Webpack5，不能代替 webpack4 证据。
- **AC-004**：三个 demo 均使用同一份新构建、真实 npm 打包的库；删除依赖后按锁文件重新安装、构建，再浏览器挂载/卸载，无未处理异常、缺失模块、字体/chunk 404。应用工具链保持原样。
- **AC-005**：不存在已删除 worktree 的依赖路径或悬空链接；普通编辑安装不因无关协同 peer 失败；不支持的显式协同组合应明确失败，不能假成功。

### US3 / P1：图片完整生命周期回调跨环境可用

下列是**待确认的公开契约**，本阶段不实现。优先沿用 `uploader` 命名空间，兼容已有 `uploader.upload`、`uploader: fn`、`uploadImage: fn` 及独立 `createUploadProvider`，不再创建第二套上传状态机。

| 回调 | 建议签名/职责 |
|---|---|
| `beforeUpload` | `(file, ctx) => boolean \| void \| Promise<boolean \| void>`；应用前置检查，返回 false 取消，不发送请求 |
| `upload` | `(file, ctx) => Promise<{ url: string, attchId?: string, ... }>`；应用决定上传目标和返回 URL/data URI，保持既有形状 |
| `onStart` | `(event) => void`；通过校验和前置检查后，文件任务开始一次 |
| `onProgress` | `(event) => void`；文件级 loaded/total/percent，分片/重试信息作为上下文提供 |
| `onRetry` | `(event) => void`；报告重试原因、次数及可用分片信息，不伪装为新文件任务 |
| `onSuccess` | `(event) => void`；上传/本地转换得到经校验的结果，result 同时支持链接和 base64 |
| `onError` | `(event) => void`；请求、读取、结果格式等失败，保留稳定错误码 |
| `onCancel` | `(event) => void`；应用否决、用户取消、销毁/切文档取消，包含 reason |
| `onReject` | `(event) => void`；类型/大小等前置拒绝，包含 reason/code，不调用 upload |
| `onSettled` | `(event) => void`；success/error/cancelled/rejected 之一，最终只通知一次 |

上下文统一携带 `taskId`、`documentId`、原始 `file`、入口 `source`、`mode`、`signal` 和 `ctx.cancel(reason?)`；适用时补充 `attempt`、`chunk`、`result`、`error`、`reason`。事件载荷包含相同上下文字段，应用可从beforeUpload/onStart等回调取消对应任务。cancel复用 Provider 能力、幂等，终态后不再转换状态；不要求应用读取编辑器私有字段。

`beforeUpload`必须等待其Promise，但等待期间cancel应立即终结任务并中止signal；迟到的true/false/异常均不能复活任务、执行upload或产生第二终态。其余通知型回调允许返回void或Promise<void>，不作为阻塞任务的业务钩子；同步异常和Promise rejection都必须接住并沿既有错误渠道报告，不重复upload/终态或递归调用出错的onError。时序验收比较回调调用顺序，不要求应用异步副作用的完成顺序。

- **FR-009**：主路径顺序为“校验 → beforeUpload → onStart → upload/本地读取 → onProgress/onRetry → 唯一终态 → onSettled”。拒绝/前置取消不产生成功事件、不调用 upload。重试与分片可能多次调用 upload，但不重复 onStart、文件成功或最终通知。
- **FR-010**：合法 URL、相对图片地址和白名单图片 data URI 都支持；`attchId` 按既有文档为可选，不能因为未返回附件 ID 而拒绝合法 URL/base64。格式/MIME/大小仍须校验。
- **FR-011**：不提供 upload 函数时可以本地 base64，并提供相同生命周期通知；提供自定义 upload 时必须实际调用，失败不得静默切为 base64 并假报成功。直接粘贴已有链接不产生虚假的“文件上传”回调，实际插入由现有文档 update 事件确认。
- **FR-012**：回调针对上传任务；`onSuccess` 表示获得合法结果，不等同于文档已保存。插入、替换、裁剪成功与否通过文档事务/update 确认。异步结果不得写回已销毁、已换文档或变只读的目标，不得覆盖旧图。
- **FR-013**：选文件、拖拽、剪贴板文件、替换和裁剪共用同一通道。失败后重新选择同一文件可重试；多图任务身份不混淆。进度在同一文件上不倒退且不超过 100%。
- **FR-014**：重试、分片、超限、上传成功/失败、取消和本地转换中的全部适用回调均可给到应用。应用回调抛异常不能触发重复上传、重复终态或递归错误回调；沿用现有错误渠道报告，最终清理仍执行。
- **FR-015**：Vue2 props、Vue3/Web Component 的 `element.options`、React 包装器的对象 property 透传均保留函数身份，不把函数 JSON 序列化、转 attribute、丢弃或放到全局变量。不新增 Vue/React 运行时依赖到库。
- **AC-006**：使用真实 `new LarkDoc(...)` 而非只测裸 Provider，证明应用 upload 确实执行、返回 URL/data URI 被采用；对象写法、两个旧函数写法以及自建 Provider 均覆盖。
- **AC-007**：每个支持环境都运行成功、失败、取消、前置否决、超限和进度场景，记录事件顺序、次数、参数和函数身份；补充替换/裁剪、重试/分片、多文件、切路由/销毁边界。使用确定性假上传，不接真实 OSS/账号。

### US4 / P2：性能结论可复验

- **FR-016**：同机同运行时分别记录依赖安装、库单 target/全量构建、三个宿主的冷构建/热构建、包体与实际初始资源；不能把库构建时间、编辑器运行性能、应用编译时间混为一项。
- **FR-017**：应用构建前后对比至少各三次同条件采样并取中位数；依赖缓存、构建缓存、网络、机器负载和具体入口必须注明。首次清缓存结果不能与旧的暖缓存数字直接作提速比。
- **FR-018**：保留既有可比体积预算；Element/CJS/collab 不通过单纯提高 limit 达标。ESM/lite 必须补充初始静态 JS 闭包统计和 lazy 特性分项，不能以 296B 转发壳冒充整个主包。
- **AC-008**：所有现有可比预算通过，应用侧构建无新增性能回退；报告同条件前后数据与归因。当前用户未指定“足够快”的耗时 SLO，因此在量化目标获确认前，只报告数据，不宣称编译慢已彻底解决。

## 4. 回归与完成门槛

- **AC-009**：保留无 Vue/Webpack 库依赖图；各应用自身工具链不改。Mermaid 在默认 ESM、Element 和 lite+feature 的已承诺路径生成真实 SVG，离线零外网请求，主题/卸载不泄漏；未覆盖的图表类型明确列未验证。
- **AC-010**：真实 `npm pack`/prepack、从 tgz 安装、针对性单测、语法/入口/lite/size 门禁与各消费端构建均有退出码和日志。手工 tar、源码 alias、强制 peer 参数或只看 npm ci exit0 均不能替代验收。
- 所有 tasks 初始未完成。已完成的诊断和清依赖重测是基线证据，不是修复完成证据。
- 工具链、网络或环境阻塞记 BLOCKED；warning 分类别记录，不将关闭警告或抬阈值当修复。已存在且与本次无关的弃用 warning 不触发无关大升级。
- 完成须独立检查范围、兼容性、负向场景与实际证据；当前阶段交付文档后等待用户确认。

## 5. 待确认内容

确认本方案时一并确认：上述上传回调命名/时序、协同依赖校验边界迁移、必要的语法降级开发依赖，以及性能使用“硬门禁＋同条件数据”验收；若需要绝对编译耗时或提升比例目标，应先确定具体宿主/机器/入口与阈值。确认前不实施。
