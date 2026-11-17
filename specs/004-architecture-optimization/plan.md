# Plan: 工程效能与架构收敛

**Input**: [spec.md](spec.md)
**约束**: 只动 `dev` 工作树；宿主加载方式不变；不做语义降级；体积门禁只紧不松。

## 技术路线

### 阶段 A — 构建链（R1/R2/R3）

**A1 指纹收窄**（`scripts/build-rollup.mjs`）

`buildOne` 里区分两份集合：

- `sources`：`filesUnder(ROOT,'src')` —— 只用于「文件清单是否变化」的守卫（新增/删除文件仍必须失效，语义不变）。
- `used`：真正被读取的文件 —— `captureInput()` 捕获的（含 CSS `@import` 递归）+ `realInputFiles(bundle.watchFiles)` + `commonInputs`。

写进 `inputCache[name].inputs` 的是 `used`，不是 `started` 全集。
`assertStableInputs(started, inputs)` 语义不变：仍校验本次构建读到的文件在构建期间没变；
`started` 依旧从全集起手，只为检测「读取前已被改动」。

风险与对策：插件若绕过 `load()` 直接读文件，会漏进指纹。全仓 `fs.readFileSync` 在 `rollup.config.mjs` 内只有
内联器一处，已被 `captureInput` 覆盖；实施时用 grep 复核一遍再收口。

**A2 构建图单写**：`buildOne` 只返回 `{ name, chunkGraph }`，`main()` 累积到内存对象，末尾一次 `writeFileSync`。
`canReuseBuild` 仍读磁盘上的既有 graph（校验产物与图一致），因此校验顺序改为「先写 graph，再逐个 canReuseBuild」。

**A3 并行**：按 `rollupCacheGroup(name)` 分组。同组内串行（共享 rollup cache，语义要求），组间并行。
`full`/`fullCjs` 返回 `null` 组（会 `rollupCaches.clear()`）→ 独占一个串行阶段。
并发上限 `LARK_DOC_BUILD_CONCURRENCY`（默认 `min(4, cpus-1)`，下限 1）。
失败：任一组 reject → 其余组等待当前在跑的完成、不再派新任务 → 抛出首个错误 → 退出码非 0、不写 `inputCache`（现有语义）。

### 阶段 B — 校验链（R4）

- `lint` 增 `--cache --cache-location node_modules/.cache/eslint/`（`.gitignore` 已覆盖 `node_modules`）。
- `vitest.config.js` 的 `maxWorkers` 改读 `process.env.VITEST_MAX_WORKERS`，缺省仍是 2（CI 不变），并保留原有警告注释。

### 阶段 C — 可读性（R6）

`src/ui/panels.js` 拆为：

```
src/ui/panels/commentPanel.js   createCommentPanel（含其独占的 3 个小工具函数）
src/ui/panels/versionPanel.js   createVersionPanel + createVersionToast（共用 version 内部工具）
src/ui/panels/index.js          重导出，保持 4 个导出名不变
src/ui/panels.js                → 一行 `export * from './panels/index'`（保留旧路径，避免改 10 处调用点）
```

只搬不改：函数体、注释、导出名一律原样。`panels.js` 保留为转发层，是因为 10 个构建目标里都有它，
改调用点属于额外风险，收益只有「路径好看」。

### 阶段 D — 首屏（R5，可选，需 C 之后）

`pm.model` 登记进 `sharedHostModules` → `feature:export:umd` / `feature:background:umd` 也进 `SHARED_HOST_TARGETS` →
把 `ui.dialogs` / `ui.stage` / `editor.templateSave` / `editor.documentSnapshot` 加进 `LAZY_PACKAGE_CALLERS`。
**任一条件不满足即撤回**：包体不再重复 PM、内核真实下降、`Fragment`/`Node` 身份唯一、全部预算与用例绿。

## 分期与门

| 阶段 | 内容 | 门 |
| --- | --- | --- |
| A | R1/R2/R3 | `build:all` 与改造前产物逐字节一致；`check:artifacts` 绿；增量构建实测 |
| B | R4 | `check:quick` 绿；二次 lint 命中缓存 |
| C | R6 | `panels` 相关用例 + `test:affected` |
| D | R5 | 全量 `check:artifacts` + 体积对比；否则撤回 |

每阶段独立提交，便于回滚。

## 度量方法（可复现）

- 增量：`touch` 目标文件前记录 `ls -l dist/*.js` 的 mtime；构建后统计「复用既有产物」行数。
- 冷构建：`rm -rf node_modules/.cache` 无关；改 `_codex/rollup-inputs.json` 删目标条目即为该目标冷态。
- 单测：`/usr/bin/time -p npx vitest run test/unit --reporter=dot`。
