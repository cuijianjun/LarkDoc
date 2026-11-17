# Tasks: 工程效能与架构收敛

**Input**: [spec.md](spec.md) · [plan.md](plan.md)
**Legend**: `[x]` 已达成判据 · `[ ]` 未做 · `[~]` 实测后否决（原因就地记）

## Phase A — 构建链（P0）

- [x] **A01 复核输入来源**。全仓直接从磁盘读源码的只有 `rollup.config.mjs` 里 6 处 presentation 形状 + 共享宿主 shim + reaction catalog + CSS 内联器，**全部调了 `addWatchFile`**，因此 `bundle.watchFiles` 就是完整闭包，收窄指纹不会漏输入。
- [x] **A02 指纹收窄**（`scripts/build-rollup.mjs`）：区分 `started`（src 全集，只做「文件清单变化 / 读取前已被改动」守卫）与 `captured`（真正读到的文件）；写进 `inputCache.inputs` 的是后者 ∪ `watchFiles`。
      实测：改 `src/ui/panels.js` → **复用 28 / 重建 10**（此前 38 个目标全重建）；改 `src/features/uiExtra.js` → 复用 27 / 重建 11（它经 `features/ui.js` 进 esm 图，属真实依赖）。改前每个目标的 `inputs` 是 492~792 条、都含全部 431 个 src 文件。
- [x] **A03 构建图单写**：`buildOne` 只写内存 `graphState`，`main` 末尾落盘一次（原来 38 次 read-modify-write）。校验顺序改为「先落图，再逐个 `canReuseBuild`」。
- [~] **A04 目标并行**：**否决**。同进程 Promise 并发（2 个 rollup 同时读文件）必现 `write EPIPE`，50~70 秒崩在沙箱文件服务 IPC 上；改成「一 cache group 一子进程」后，2 个子进程能跑完 `element` 批次（241s），但 `all` 在 4 个子进程下仍在 3 分 45 秒崩。串行稳定。结论：**并行在这个运行环境里不可用**，构建速度收益全部由 A02 承担；机器无该沙箱时可自行评估。
- [x] **A05 构建链回归**：全量 `build:all` 38 个目标全绿（525s）；`check:artifacts` 全绿（见下）。

## Phase B — 校验链（P1）

- [x] **B01 eslint 缓存**：`lint` 加 `--cache --cache-location node_modules/.cache/eslint/`（`node_modules` 已被 gitignore）。
- [x] **B02 测试并发可配**：`maxWorkers: Number(process.env.VITEST_MAX_WORKERS) || 2`，缺省仍是 2。
- [x] **B03（体检中新发现）lint 门禁在 HEAD 是红的**：`src/features/ui-registry.js` 用了 `globalThis` 但缺 `/* global globalThis */`（仓库既有 21 个文件都带），`f61d295` 起 `npm run lint` 一直失败。按既有约定补声明。
- [x] **B04 vitest 拆 projects**：跑真 rollup 的三支（`build-contract` 69.0s / `shared-host` 27.3s / `export-lazy` 21.6s）独立成 `build` 项目，给 120s `testTimeout`；其余 162 支留在 `unit`。
      判据：三者同池并发（2 worker）93s 里有 **4 条假超时**（3 条 5s、1 条 30s），单跑 118s 全绿 —— 构建是纯 CPU 密集，与普通用例抢核心只会两边都慢还出假红。
      拆分后 `unit` 162 文件 / 4,950 用例 / 477s，`build` 3 文件 / 133 用例 / 75s；`check:unit` 两趟串行，总墙钟与单趟全量持平（554s vs 562s），换来的是**不再有假超时**。
      `test:affected` 走 `--project=unit`：改 `src/core/comments/thread.js`（`commentsMixin` 的上游）时 40/162 文件、构建用例 **0 支**（改前会被依赖图反查出来，白付 118s）。
      坑：根 `test.include` 与 project 的 `include` 是**合并**不是覆盖，因此 `include` 必须写在各 project 里，否则 `build` 又把全量收进来。

## Phase C — 可读性（P1）

- [x] **C01 `ui/panels.js` 拆分**：2,244 行 / 4 个导出 → `panelShared.js`(31) + `versionPanel.js`(616) + `commentPanel.js`(1,506) + `panels.js`(83，纯出口)。函数体、类名、断言口径一行未改；4 个导出名不变，10 个构建目标的 import 路径不变。
- [x] **C02 受影响验证**：`test:affected` 44 个文件 / 2,002 用例；契约用例随图变化同步更新（见下）。
- [x] **C03 `ui/overlays.js` 拆分**：1,131 行 → `overlayShared.js`(109) + `shareView.js`(324) + `permissionView.js`(317) + `exportView.js`(90) + `imageShareView.js`(299) + `overlays.js`(57，纯出口)。产物 `feature:uiPanels:umd` raw 324,465 / gzip 94,925 与拆前同长（标识符按新模块顺序重排）；41 文件 / 1,798 用例通过。
- [x] **C04 删除 `src/ui/overlayViews.js`**：**748 行死副本**，`src/` 零引用，只有 `p6b-wiring` / `stage7-low-risk-batch` 把它当源码文本拼进断言（等于在量死代码）。删掉后两条用例改读五个实现文件，断言随之变严。
- [x] **C05 删除 `src/components/lark-doc/editor/uploadMixin.js`**：145 行，no-Vue 迁移遗留（`specs/002` T087 已写明「未被任何模块引用」），实测不在任何产物的模块表里。
- [x] **C06 `core/documentOperations.js` 拆分**：1,374 行 / 61 导出 / 19 个目标引用 → `documentValidation`(379) + `documentTextEdits`(154) + `headingNumbering`(89) + `listNumbering`(212) + `blockIndent`(110) + `documentSections`(474) + 25 行出口。
      拆前先算跨域引用：`validation → {heading, sections}`、`sections → {text, heading, indent}`、`list → indent`，**无回边**，拆后不产生循环依赖。导出 61 → 63（`nodeIndent`、`isolatedHeadingContainers` 从文件内私有提为共享），其余逐字未动；162 文件 / 4,950 用例全绿。
- [x] **C07 `ui/commentPanel.js` 拆分**：1,562 行 → `commentPanel.js`(713，有状态层：state / 移动端与抽屉分支 / 滚动锁 / 删除确认 / 回复菜单悬停计时器 / `render` / `update`) + `commentPanelChrome.js`(375，只建一次的静态骨架) + `commentPanelThread.js`(630，单卡建节点 / 控件条 / 回复流 / `renderPanel`) + `commentPanelParts.js`(65，两段无闭包依赖的纯函数)。DOM 结构、类名、ARIA、事件接线逐字未改；跨模块的可变状态（悬停计时器、删除确认、富文本输入注册表）全部留在主文件，另两份实现只走 `ctx` 回调，不持有副本（`nativeThreadOpen` 用 `isNativeThreadOpen()` 读、`dismissedReplyHover` 收成 `trackReplyHover()`）。
      **代价实测**：`feature:uiPanels:umd` raw 324,465 → 328,172、gzip 96,113 → 97,449（+1.34%）。增量几乎全在两份名单上（78 个节点的回参 + 63 个节点的出参，合计约 2.7 KB raw），不是逻辑变多。该包**懒加载**，首屏四个分项（引导 1,579 / 内核 542,353 / 首屏样式 41,247 / 补丁 17,224）逐项未变；预算余量从 ~2.9 KB 降到 **952 B**（98,048 / 99,000）。要收回这 1.3 KB，把 `commentPanelChrome.js` 合回主文件即可（主文件回到 ~1,040 行）。
      验证：评论面板四支 277 用例（`mobile-reference-comments` / `comments-ui` / `comment-composer` / `overlays-native`）+ 接线两支 15 + 产物两支 57 + `build` 项目 133 全绿；`lint` / `check:architecture` / `contract:check` / `check:artifacts`（442s）全绿。
- [x] **C08 `editor/commentsMixin.js` 拆分**：1,469 行 → `commentsMixin.js`(208，只剩 data/computed/watch/生命周期 + 方法域展开) + `commentsSessionMethods.js`(308) + `commentsCapabilityMethods.js`(288) + `commentsThreadMethods.js`(358) + `commentsLayoutMethods.js`(305) + `commentMixinShared.js`(71，纯函数与面板几何常量)。86 个方法按领域切开后**以对象展开按原顺序并入 `methods`**，方法体一行未改。
      两处必须留在原处的接线：`./commentInteraction` 的 import 仍在 `commentsMixin.js`（`rollup.config.mjs` 的 alias 规则按**导入方路径**限定），因此 `...commentInteraction.methods` 也留在那里；`loadCommentImages` 里的 `import('./commentImages')` 搬到线程域，但 shared-host 映射按**目标路径**匹配、且两份文件同目录，`'./commentImages'` 解析结果不变。
      公开导出 5 个（`COMMENT_GATES` / `commentGate` / `commentDraftText` / `commentRelativeTime` / `commentSidebarThreads`）改为从 `commentMixinShared.js` 重新导出，对外签名不变；四个方法域从 `commentMixinShared.js` 取判定，避免与 mixin 本体成环。
      **体积**：内核 gzip 542,353 → **542,320**（−33 B，首屏同步 −33）；esm 384,221 → 384,231（+10）、lite 384,259 → 384,286（+27），均在预算内。`feature:uiPanels:umd` 未受影响（98,048）。
      验证：`comments-ui` + `editor-reactivity` + `mobile-reference-comments` 168 用例全绿；`build` 项目 133 passed；`lint` / `check:architecture`（R1 446 → 451 文件）/ `contract:check` / `check:artifacts`（560s）全绿。
- [x] **C09 `editor/shareMixin.js` 拆分**：1,117 行 → `shareMixin.js`(262，只剩 data/computed/watch/生命周期 + 方法域展开) + `shareModel.js`(436，纯逻辑层：几何常量、B24 capability 映射、密码规则、剪贴板文本) + `shareDialogMethods.js`(264) + `shareLinkMethods.js`(236)。38 个具名导出逐名从 `shareModel.js` 重新导出，对外签名一字不变；两个方法域以对象展开按原顺序并入 `methods`。
      **踩到并修掉的一次真实回归**：`shareLinkAction` 里的 `import('../../../providers/share-links')` 原本靠 `rollup.config.mjs` 的 `shareCaller` **按导入方文件路径**白名单改写成 `loadFeature('document.shareLinks')`。方法搬进 `shareLinkMethods.js` 后白名单失配，provider 被**急切打进内核**：raw +11,589 B、gzip +3,929 B（内核 542,320 → 546,250）。把新文件加进 `shareCaller` 后回到 raw +22 B / gzip **+162 B**。同一处白名单也被 `build-contract` 的 transform 断言锁着，该用例的文件名随之改成 `shareLinkMethods.js`；`stage7-low-risk-batch` 改读 mixin + 两个方法域。
      **体积**：内核 gzip 542,320 → **542,482**（+162 B）；esm 384,378、lite 384,426、`uiPanels` 98,048 均未受影响。`check:artifacts`（425s）、`build` 项目 133 passed、相关 5 支单测 109 用例全绿。
- [x] **C10 `workspace/WorkspaceController.js` 拆分**：1,173 行 → `WorkspaceController.js`(305，状态工厂 + 访问器 + 生命周期 `onReady` + `dispose`) + `workspacePersistenceMethods.js`(169) + `workspaceAIContextMethods.js`(249) + `workspaceAIRunMethods.js`(324) + `workspaceTransferMethods.js`(148) + `workspaceTemplateMethods.js`(75) + `workspaceShared.js`(10)。86 个方法按对象字面量 `Object.assign` 回原型，方法体、执行顺序与 `this` 绑定逐字未变；AST 比对确认 86/86 无重复无遗漏。
      **两处按 importer 路径的白名单同步**（第三次踩同一个坑，这次是先查再改）：`LAZY_PACKAGE_CALLERS` 与 transform 的 `importCaller` 原本都按 `WorkspaceController.js` 匹配，把 Word 导出与分页导入的实现搬进 `workspaceTransferMethods.js` 后名单跟着改；`build-contract` 里那条 transform 断言的文件名同步替换。`nextPaintFrame` 有两个使用者（`onReady` 与 `restoreSnapshot`）且不能各写一份，落到 `workspaceShared.js`。
      **体积**：内核 gzip 542,482 → **542,599**（+117 B）；esm / lite / `uiPanels` 未动。
      验证：工作区六支单测 186 用例、`build` 项目 133、`lint` / `check:architecture`（R1 460 文件）/ `contract:check` 全绿。
- [x] **C11 `session/DocumentSession.js` 拆分**：940 行 → `DocumentSession.js`(302，构造 + Provider 装配 + 编辑器/事件/连接 + `dispose`) + `sessionVersionMethods.js`(329) + `sessionIdentityMethods.js`(121) + `sessionResourceMethods.js`(110) + `sessionCommentMethods.js`(105) + `sessionAssetMethods.js`(51) + `sessionNotificationMethods.js`(49) + `sessionPermissionMethods.js`(41)。119 个成员按对象字面量 `Object.assign` 回原型，AST 比对 119/119 无重复无遗漏。
      **两处技巧性收口**：① `get autoVersion` 这类**访问器不能走 `Object.assign`** —— 它复制的是取值结果而不是 getter，第一版直接把 `autoVersion` 变成 `undefined`，被 `versioning-auto` 的用例抓住；访问器留在类里。② `AUTO_VERSION_INTERVAL_MS` 与 `localSnapshotKind` 随版本域搬走，常量由 `DocumentSession.js` 重新导出（对外签名不变），`resourceSnapshot` / `resourceKey` 随资源域走。
      **懒加载白名单同步**：`LAZY_PACKAGE_CALLERS` 原来按 `DocumentSession.js` 匹配三处 `import()`，现拆成 `sessionVersionMethods.js`（remoteConversion、versioning.snapshot）与 `sessionResourceMethods.js`（session.resourceOutcome）两条。
      **体积**：内核 gzip 542,599 → **542,650**（+51 B）；「含动态区块」同步 +51，说明三处懒加载没有被急切打回内核。
      验证：会话七支 528 用例 + `versioning-auto`、`build` 项目 133、`lint` / `check:architecture`（R1 467 文件）/ `contract:check` 全绿。
- [x] **C12 `editor/tableInteractionMixin.js` 拆分**：870 行 → `tableInteractionMixin.js`(50，只剩 data + 两行生命周期委托 + 方法域展开) + `tableInteractionBindings.js`(293，`bindTableInteraction(vm)` / `releaseTableInteraction(vm)` 承接原 mounted / beforeDestroy 的全部监听接线，238 行体逐行一致，仅 `this.` → `vm.`) + `tableOverlayMethods.js`(298，几何域：列宽还原、选择条几何、重排落位线、横滚比例、触摸桥接) + `tableLineMethods.js`(139，行列选区 / 删除 / 重排 / 浮窗文本动作) + `tableGateMethods.js`(102，活跃闸门、dismiss 闸门、浮层挂载与销毁)。22 个方法按三域以对象展开并入 `methods`，方法体逐字未改（AST 归一化后 22/22 全等）。
      接线层能整体搬走的前提是**这一段里没有任何裸 `this`**（全部是 `this.x`），所以 `this.` → `vm.` 的机械替换是安全的；`CONST` 侧 `MIN_THUMB` 随几何域、`TOUCH_RESIZE_TOLERANCE` 随接线层，两者各自只有单一使用者，不额外开共享文件。
      **体积**：内核 gzip 542,650 → **542,669**（+19 B）；esm / lite / `uiPanels` / `ui` 未动。
      验证：表格四支（`link-cell-interaction` / `mobile-table-gesture` / `table-clip` / `bitable`）248 用例、`element-ui` 18 用例、`lint` / `check:architecture`（R1 471 文件）/ `contract:check` 全绿。

## Phase D — 首屏（P2）

- [~] **D01 试装 PM 共享宿主**：**本轮不做**。收益上限是内核 −6,747 B gzip（即 `ui/dialogs` 30,073、`ui/stage` 16,308、`editor/templateSave` 3,140、`editor/documentSnapshot` 9,889 四支源码之和在 gzip 下的份额），代价是把 `prosemirror-model` 逐个枚举导出挂进 `sharedHostModules`，并让 4 支懒包读内核那一份身份。属独立改动，风险与收益比不划算，留作后续单独评估（spec 里已写明「否则撤回」）。
- 首屏数字本轮未变：**601,740 B**（内核 542,353）。

## Phase E — 收尾

- [x] **E01 文档**：`docs/guide/performance.md` 增「工程效能」一节（构建链改造、实测数字、并行否决理由）。
- [x] **E02 提交**：分两个提交（构建/校验链、面板拆分），信息含实测数字。

## 本轮实测汇总

| 项 | 改前 | 改后 |
| --- | --- | --- |
| 任一 src 改动触发的重建目标数 | 38（全部） | 10（`ui/panels.js`）/ 11（`features/uiExtra.js`） |
| 全量 `build:all` | 38 目标全部重建 | 38 目标全部重建（525s，同样工作量的正常波动） |
| 增量 `build:all`（改一个 UI 文件） | ≈ 全量 | 复用 28 个目标 |
| `lint` | 每次全量重扫 | 命中 eslint 磁盘缓存；且 HEAD 起就红的问题已修 |
| 单测并发 | 固定 2 | 默认 2，可用 `VITEST_MAX_WORKERS` 覆盖 |
| 单测编排 | 单趟全量，构建用例与普通用例同池（改上游枢纽时白付 118s，且 4 条假超时） | `unit` 162 支 / `build` 3 支，两趟串行；`test:affected` 只走 `unit` |
| 最大单文件（手写代码） | `ui/panels.js` 2,244 行 | 拆成 4 个（最大 1,506）→ 再拆 4 个（最大 713）→ `editor/commentsMixin` 1,469 → 208 → `editor/shareMixin` 1,117 → 262 → `workspace/WorkspaceController` 1,173 → **305** → `session/DocumentSession` 940 → **302** → `editor/tableInteractionMixin` 870 → **50**（最大单文件现为 `editor/segmentedDocumentModel.js` 1,114，已按数据否决拆分理由） |
| 第二大杂物抽屉 | `core/documentOperations.js` 1,374 行 / 61 导出 / 19 目标 | 6 个域文件 + 25 行出口，导出 61 → 63 |
| 死代码 | — | 删 `ui/overlayViews.js` 748 行（整份副本）+ `editor/uploadMixin.js` 145 行 |
| 懒加载面板包 | `uiPanels` raw 324,465 / gzip 96,113 | C07 拆出三份实现后 raw 328,172 / gzip 97,449（+1.34%，全是节点名单的出/回参） |
| 内核（首屏） | gzip 542,353 | C07 未动 → C08 **542,320**（−33 B）→ C09 **542,482**（+162 B）→ C10 拆 `WorkspaceController` **542,599**（+117 B）→ C11 拆 `DocumentSession` **542,650**（+51 B）→ C12 拆 `tableInteractionMixin` **542,669**（+19 B） |
| esm / lite | 384,221 / 384,259 | 384,615 / 384,656（+394 / +397，预算 395,000 仍有余量） |
| 体积预算 | — | 10 条全过；`elementRuntime` 542,650 / 550,000，`esm` 384,615 / 395,000，`uiPanels` 98,048 / 99,000 |
| 全量单测 | 162 文件 / 4,950 用例 | 162 文件 / 4,950 用例全绿（294s）；`build` 项目 133 用例（50s） |
