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
| 最大单文件 | `ui/panels.js` 2,244 行 | 拆成 4 个文件，最大 1,506 行；随后 `ui/commentPanel.js` 仍是 1,562 |
| 第二大杂物抽屉 | `core/documentOperations.js` 1,374 行 / 61 导出 / 19 目标 | 6 个域文件 + 25 行出口，导出 61 → 63 |
| 死代码 | — | 删 `ui/overlayViews.js` 748 行（整份副本）+ `editor/uploadMixin.js` 145 行 |
| 首屏 | 601,740 B（内核 542,353） | 未变（D01 已按数据否决） |
