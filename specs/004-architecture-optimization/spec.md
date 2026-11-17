---
feature: 004-architecture-optimization
status: active
created: 2026-11-17
---

# Spec: 工程效能与架构收敛（构建 / 测试 / 首屏 / 可读性）

## 背景

`lark-doc` 已历经三轮内核减重（L2c/L2d/L2e/L2f），首屏 gzip 从 615,532 降到 601,740。
继续压首屏的边际收益已经很薄（剩余懒边界全卡在「包内再打一份 prosemirror」）。
但**开发者侧的代价**没有同步治理，且直接影响每一次改动能否被快速验证：

| 维度 | 现状实测（2026-11-17，本机） | 问题 |
| --- | --- | --- |
| 全量构建 `check:artifacts` | 11m03s（`ROLLUP_TARGET=all`，38 个构建目标） | 单文件改动也要重建全部 |
| 增量构建 | 与全量等价 | 见下 |
| 全量单测 | 160 文件 / 4,959 用例 / 372s（`maxWorkers=2`） | 与构建类用例混跑 |
| lint | `eslint --ext .js,.vue src scripts`，431 文件、无缓存 | 每次 `check:quick` 全量重扫 |
| 首屏 gzip | 601,740（内核 542,353） | 余量见下 |

## 根因（已定位，非推测）

**每个构建目标的输入指纹都包含整个 `src` 树。** `scripts/build-rollup.mjs:230` 用
`fileRecords(ROOT, [...commonInputs, ...sources])` 起手（`sources = filesUnder(ROOT,'src')`，431 个文件），
再与 `realInputFiles(bundle.watchFiles)` 合并成 `inputs` 写进 `_codex/rollup-inputs.json`。
实测 38 个目标的 `inputs` 长度是 492–792，**都含全部 431 个 src 文件**。
因此 `canReuseBuild()` 在任意一个 src 文件变化时对所有目标返回 false。

而真实依赖面小得多（按 `dist/lark-doc-graph.json` 逐目标统计 411 个 src 文件的归属）：

| 指标 | 值 |
| --- | --- |
| 出现在 >20 个目标里的 src 文件 | **1 个**（`core/features/registry.js`，27） |
| 出现在 ≤5 个目标里的 | 73 个 |
| `ui/panels.js` | 10 个目标 |
| `core/documentOperations.js` | 19 个目标 |
| `features/math.js` | 4 个目标 |

中位数落在 5–10。即：**典型改动应重建 5–10 个目标，实际重建 38 个。**

## 需求

### R1 增量构建按真实依赖失效（P0）

改一个 src 文件后，`npm run build:all` 只重建真正包含它的目标；其它目标打印「输入未变，复用既有产物」。
正确性不得下降：新增/删除文件、CSS `@import` 内联、构建期间输入变动、产物被外部改写，仍必须全部失效。

### R2 构建图单一写入者（P0）

`dist/lark-doc-graph.json` 现由每个 `buildOne` 各自 read-modify-write 一次（38 次）。改为进程内累积、末尾一次写入，
语义等价且为 R3 铺路。

### R3 目标级并行（P0）

独立的构建目标并行执行，压缩总墙钟时间；共享 `rollup` 缓存的组（`full`/`fullCjs` 会 `clear()` 全局图）必须串行隔离。
并发上限可配置、默认保守；失败语义保持「任一目标失败即整体失败且不写缓存」。

### R4 内容无关的校验不再全量重扫（P1）

eslint 启用磁盘缓存；测试并发度支持环境变量覆盖（默认值不变，CI 行为不变）。

### R5 首屏（P2，可选）

仅当 R1–R3 落地且全绿后评估：把 `prosemirror-model` 登记进 `sharedHostModules`，
使 `ui/dialogs`、`ui/stage`、`editor/templateSave`、`editor/documentSnapshot` 可迁入懒包而不重复打包 PM。
预期内核 −6.7 KB gzip。**不达预期或引入身份风险即撤回。**

### R6 可读性（P1）

超长文件按「导出边界」拆分，导出名与行为不变：`src/ui/panels.js`（2,244 行 / 4 个导出）优先。

## 非目标

- 不做逐域语义降级（用户已明确拒绝：不为「UI 未到时显示什么」做产品决策）。
- 不改宿主 `import` / `<script>` / `install` 方式。
- 不动 `master`，只在 `dev` 工作树。
- 不为了让预算变绿而放宽任何体积门禁。

## 验收

| 项 | 判据 |
| --- | --- |
| R1 | 改 `src/ui/panels.js` 后 `build:all` 的「复用」目标数 ≥ 28；构建产物与改动前逐字节一致（除被改文件所影响的目标） |
| R2 | 构建后 `lark-doc-graph.json` 与改造前结构一致，条目数 = 目标数 |
| R3 | 冷构建 `all` 墙钟下降 ≥ 40%；单目标失败时整体退出码非 0 且缓存不写 |
| R4 | 二次 `npm run lint` 命中缓存；`VITEST_MAX_WORKERS=4 npm run test:unit` 可用 |
| R6 | 拆分后 `panels.js` 导出集合不变，相关用例全绿 |
| 全批 | `check:artifacts` / `build-contract` / `shared-host` / `test:affected` 全绿；体积预算不回退 |
