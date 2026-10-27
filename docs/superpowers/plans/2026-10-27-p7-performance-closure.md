# lark-doc P7 性能收口实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变 lark-doc 文档语义、DOM、快捷键和 Provider 契约的前提下，完成 P7 性能收口，使 2,000 块文档的派生装饰、持久化和长文档体验达到既定门禁，并把可重复的性能报告接入 CI。

**Architecture:** 先保留当前真实的全量重建基线，再把 `DerivedIndex` 从“事务后标脏、下次全量重建”替换为 mapping 驱动的局部更新；调用方继续只依赖 `createDerivedIndex()` 的现有接口。随后在不改变 `createWorkspace(storage, options)` 签名的前提下增加 IndexedDB 分层实现和 localStorage/内存降级，再把稳定派生数据作为快照用于首屏；最后根据 P7-01/02/03 后的实测决定是否仅加 `content-visibility: auto`，并把性能报告纳入 CI。

**Tech Stack:** Vue 2.7、Tiptap 3、ProseMirror、原生 IndexedDB、Vitest、Playwright/Chromium、Node 14 产物链 + Node 24 门禁链、GitHub Actions。

**Spec:** `requirements/09-开发方案-0.12.md` §3.7、§5.9、§6；当前状态与依赖以 `_codex/CONTEXT-CARD.md` 为准。

## Global Constraints

- 分支固定为 `next/0.12`，禁止合并 `master`。
- P7 是纯性能期：文案、DOM 结构、快捷键、ARIA 和现有 Provider 契约一律不变。
- 正文永远使用 DOM；禁止 Canvas 化正文、窗口化虚拟化或自研渲染引擎。
- `DerivedIndex.update(tr)` 的受影响区间必须来自 `tr.mapping.maps`，不能只看 `tr.docChanged` 或只取第一段。
- 装饰更新必须以 `oldSet.map(tr.mapping, tr.doc)` 为基础，只重扫受影响区间及必要的父块；编号向后传播以“下一个更高级标题”为边界。
- IndexedDB 不新增第三方依赖；`createWorkspace(storage, options)` 签名保持不变，localStorage 和内存必须可降级。
- `perf/baseline.json` 只能由真实 `report.mjs --update` 生成，禁止手填；在 P7-01 前不得覆盖当前基线。
- 每个功能子任务独立提交；`requirements/`、`_codex/`、`dist-offline/`、`docs/superpowers/plans/*` 不入库。
- 既有四份产物预算不涨：ESM 285 KB、UMD 465 KB、Element 480 KB、CJS 2500 KB（gzip）；协同子入口 90 KB。

## Current State Summary

- **仓库/发布：** `lark-doc@0.12.0-beta.8`，分支 `next/0.12`，当前 HEAD 与 `origin/next/0.12` 同为 `c22d798`，工作区干净；beta.8 已推 GitHub，但没有 npm 发布和 tag。
- **已完成期次：** P0–P5、P6a、P6b 代码已完成；Provider、协同、版本、评论、权限、导入导出和三端入口均已落地。
- **规模：** `src/` 约 241 个 JS/Vue 文件，`test/unit/` 59 个测试文件，文档源码在 `docs/`，VitePress 配置为 `docs/.vitepress/config.mts`，文档部署由 `.github/workflows/deploy-docs.yml` 负责。
- **门禁：** `check:gate` 与 `check:artifacts` 已拆开；`check:perf` 已有本地脚本但尚未接 CI，`perf/report.md` 尚不存在。
- **当前性能基线：** seed 42、2,000 块、`mountToTypeableMs=59849.7`、`keystrokeP95Ms=37297.2`、`decorationsRebuildMs=21186.3`、`scrollFps=3.7`。这是真实可复现的优化前基线，必须保留到 P7-01 完成后。
- **主要根因：** `src/core/derive/index.js` 目前只在 `update(tr)` 中置 `dirty=true`，`decorations(state)` 仍调用 `src/core/blocks/document-decorations.js` 的全文扫描；当前工作区仍用 `src/components/lark-doc/workspace.js` 将草稿和 20 份快照存成 localStorage 大 blob。

## Review Focus

- **多段 mapping / 协同事务：** 一个事务包含多个不连续区间时，所有区间都必须重扫，不能只更新第一段；由 Task 2 的 mapping 测试覆盖。
- **标题编号传播：** 中部插入/删除 H2 后，后续同级标题编号必须更新；只改标题文字不能触发无关传播；由 Task 2 的编号边界测试覆盖。
- **存储不可用与配额失败：** IndexedDB 被禁用、事务失败或 localStorage 超额时，不能报告“已保存”；必须保留正文并明确降级；由 Task 3 的失败路径测试覆盖。
- **快照与正文版本不一致：** 派生快照陈旧、损坏或缺字段时，必须回退正文重算而不是展示错误大纲；由 Task 4 的校验和回退测试覆盖。
- **长文档原生能力：** 若加 `content-visibility`，Ctrl+F、打印、跨块选择、读屏和视觉 DOM 结构必须保持；若判据不再触发，必须写明不做窗口化的原因；由 Task 5 的浏览器验收覆盖。

## File Map

- **P7-01 核心：** Modify `src/core/derive/index.js`; add `test/unit/derived-index.test.js`; if the local rebuild needs a narrow extractor, modify only the smallest existing helper in `src/core/blocks/document-decorations.js` and keep `src/core/blocks/document.js` call sites unchanged.
- **P7-02 存储：** Create `src/core/storage/idb.js`; modify `src/components/lark-doc/workspace.js`, `src/providers/persistence.js`, `src/components/lark-doc/LarkDocWorkspace.vue`; add `test/unit/storage-idb.test.js` and extend `scripts/check-lark-doc-workspace.js` for fallback/transaction semantics.
- **P7-03 快照：** Modify `src/core/derive/index.js`, `src/components/lark-doc/workspace.js`, and the smallest workspace/editor load path needed to carry `outline`, `blockCount`, and `foldIndex`; add `test/unit/derived-snapshot.test.js` and one browser fixture for early outline availability.
- **P7-04 高频路径：** Modify only the relevant editor mixins/handlers (`blockHandleMixin.js`, fold/search paths, or the existing `LarkDocEditor.vue` frame scheduling); add `test/unit/perf-scheduling.test.js` and a browser probe that counts one scheduled flush per frame and compares DOM node counts.
- **P7-05 conditional rendering:** If the post-P7-03 measurement still crosses a threshold, modify the narrowest content CSS/host rule and add `docs/guide/performance.md`; otherwise create only `docs/guide/performance.md` documenting the measured non-trigger and why windowing is intentionally excluded.
- **P7-06 gate/report:** Modify `.github/workflows/e2e.yml` (or the existing CI workflow if the runtime cost requires a better placement), create `perf/report.md`, and add/extend a deterministic script test for the 20% gate. Do not alter `perf/baseline.json` until the post-P7-01 measurement is captured.

## Execution Order and Gates

### Task 1: Freeze the optimization baseline and add DerivedIndex test seams

**Files:**
- Create: `test/unit/derived-index.test.js`
- Modify: `src/core/derive/index.js` only for testable counters/hooks if required; no behavior change in this task.
- Verify: `perf/baseline.json`, `scripts/perf/measure.mjs`, `scripts/perf/report.mjs`

**Interfaces:**
- Consumes: `createDerivedIndex({ doc, schema, rebuild })`, `update(tr)`, `decorations(state)`, `mergeRanges()`.
- Produces: deterministic tests for multi-range mapping, cache reuse, `invalidate()`, and a rebuild/descendant counter that later tasks must drive to zero for a local edit.

- [x] **Step 1: Write failing tests** for cache reuse, multiple `tr.mapping.maps`, meta-only transactions, invalidate, and a local edit that currently causes one full rebuild.
- [x] **Step 2: Run `npx vitest run test/unit/derived-index.test.js`** and record the expected failures without changing the baseline.
- [x] **Step 3: Verify the baseline is still the pre-P7 result** by running the existing measurement/report path without `--update`; do not overwrite `perf/baseline.json`.
- [x] **Step 4: Commit** the test seam only if it is behavior-neutral: `test(p7-01): pin derived index baseline behavior`.

### Task 2: Implement P7-01 mapping-driven dirty-range decorations

**Files:**
- Modify: `src/core/derive/index.js`
- Modify only if needed: `src/core/blocks/document-decorations.js`
- Test: `test/unit/derived-index.test.js`

**Interfaces:**
- Consumes: Task 1 tests; existing `rebuild(state)` callback; ProseMirror `Mapping` and `DecorationSet` APIs.
- Produces: unchanged `createDerivedIndex()` public methods, with `update(tr)` returning merged ranges and `decorations(state)` mapping old decorations plus replacing local ranges.

- [x] **Step 1: Add failing cases** for two disjoint mappings, parent-block expansion, heading-number forward propagation to the next higher heading, and no full-document `descendants` scan after a single-character edit.
- [x] **Step 2: Run the targeted unit file and the existing folding/heading/list suites** to confirm the new cases fail while nearby regressions remain visible.
- [x] **Step 3: Implement `update(tr)`** by collecting every `oldStart/oldEnd` from `tr.mapping.maps`, merging ranges, updating `currentDoc`, and retaining the old decoration set as the mapping source.
- [x] **Step 4: Implement `decorations(state)`** with `oldSet.map(tr.mapping, tr.doc)` plus local range replacement; rescan only the affected range and one parent level, and extend heading-number work until the next higher heading.
- [x] **Step 5: Run `npx vitest run test/unit/derived-index.test.js` plus the four existing folding/number/list regression suites**; expected result is PASS with zero full-document scan on the single-edit path.
- [ ] **Step 6: Run the real 2,000-block performance measurement** without `--update`; confirm `decorationsRebuildMs <= 4 ms` and that `mountToTypeableMs` falls by an order of magnitude. If not, stop and diagnose before proceeding.
- [x] **Step 7: Commit** `perf(p7-01): update derived decorations by dirty ranges`.

**执行记录（2026-10-27，提交 `933ad1c`；10-27 晚补记并推进基线）**

- **Step 6 未勾：两条判据都没有达成，不是漏测。**
  - `decorationsRebuildMs <= 4 ms`：该判据在 P7-01 之后**已不存在有效的度量对象**（击键路径
    上装饰不再全量重建，旧探针量到的是 dispatch 固定开销）。改口径后实测
    `decorationIncrementalMs = 72.6 ms`，距 `≤ 4 ms` 差一个数量级。
  - `mountToTypeableMs` 降一个数量级：实测 59849.7 → 36666.8，**只有 −39%**。这里的预判本身
    是错的 —— mount 是「建 2,000 块 NodeView + 首次排版」，装饰只占 ~36 ms，所以 P7-01
    无论如何都动不了它；mount 的出路是 P7-05 的挂载策略。
  - 两处完整归因写在 `perf/report.md`（口径节 + 解读节），代码级根因是
    `collectFoldRanges` / `computeHeadingNumbers` 在 `collectDocumentDecorations` 里被无条件
    全量调用（`src/core/documentOperations.js:1020` / `:506`）。
- **已兑现的部分**：击键路径走脏区增量后 `scrollFps` 3.7 → 60.3、`keystrokeP95Ms`
  37297 → 2578（−93%），这是 P7-05 判定「不需要窗口化」的直接依据。
- **基线的推进**：本轮才执行 `perf/baseline.json --update`（旧值备份 `perf/baseline-pre-p7.json`）。
  改键名后旧基线必然判 `✗ 缺数据`（`compareMetrics` 的 `MISSING` 分支），所以顺序必须是
  「先确认这条失败 → 再 `--update`」，颠倒会把告警盖掉。

### Task 3: Implement P7-02 IndexedDB layered persistence with fallback

**Files:**
- Create: `src/core/storage/idb.js`
- Modify: `src/components/lark-doc/workspace.js`
- Modify: `src/providers/persistence.js`
- Modify: `src/components/lark-doc/LarkDocWorkspace.vue`
- Test: `test/unit/storage-idb.test.js`
- Verify: `scripts/check-lark-doc-workspace.js`

**Interfaces:**
- Consumes: existing synchronous/async persistence Provider methods `load`, `save`, `snapshots`, `snapshot`, `restore` and `createWorkspace(storage, options)`.
- Produces: a no-dependency IndexedDB adapter with `meta`, `content`, `snapshots`, and optional `journal` stores; snapshots are one record per id, and failed transactions never report a successful save.

- [ ] **Step 1: Write failing tests** for schema creation, draft save/load, one-record-per-snapshot, retention, transaction failure, unavailable IndexedDB, localStorage fallback, and explicit degraded-save state.
- [ ] **Step 2: Run `npx vitest run test/unit/storage-idb.test.js`** and confirm the adapter is absent/failing.
- [ ] **Step 3: Implement `src/core/storage/idb.js`** with feature detection, versioned database upgrade, bounded transactions, and a small adapter surface; do not add `idb`/`dexie`.
- [ ] **Step 4: Keep `createWorkspace(storage, options)` stable** by selecting IndexedDB when the caller passes the browser storage capability, while preserving direct localStorage adapters and an in-memory fallback for blocked/private contexts.
- [ ] **Step 5: Replace the workspace’s snapshot-array write path** with per-id records and make the “saved” state observable only after transaction completion.
- [ ] **Step 6: Run workspace checks, storage tests, lint, and the existing persistence/provider tests**; confirm a 2,000-block document plus 20 snapshots does not hit localStorage quota when IndexedDB is available.
- [ ] **Step 7: Commit** `perf(p7-02): add layered indexeddb workspace storage`.

### Task 4: Add P7-03 derived-data snapshots and early outline hydration

**Files:**
- Modify: `src/core/derive/index.js`
- Modify: `src/components/lark-doc/workspace.js`
- Modify: the smallest `LarkDocWorkspace.vue` load/render path carrying saved workspace records
- Test: `test/unit/derived-snapshot.test.js`
- Browser probe: existing performance/e2e fixture or a focused script under `scripts/`

**Interfaces:**
- Consumes: Task 2’s derived index and Task 3’s storage records.
- Produces: persisted `outline`, `blockCount`, and `foldIndex` fields; stale/invalid fields are ignored and recomputed from the document.

- [x] **Step 1: Write failing tests** for snapshot creation, schema validation, stale snapshot fallback, and outline availability before the full decoration rebuild.
- [x] **Step 2: Implement the smallest pure snapshot serializer/validator** and attach it to the existing save/load record without changing document JSON.
- [x] **Step 3: Hydrate outline metadata first**, then schedule normal decoration hydration after the editor can accept input; preserve the current output when metadata is absent.
- [x] **Step 4: Run unit tests and the 2,000-block browser probe**; verify first input ≤ 1.5 s or record the remaining failure for Task 5’s decision gate.
- [x] **Step 5: Commit** `perf(p7-03): hydrate derived document snapshots early`.

**执行记录（2026-10-27，提交 `5e3bbe0`）**

- **`foldIndex` 没有落库**：折叠态本来就有独立的持久化通道（`collapsed` 集合 + 三闸门），
  再存一份必然分叉出第二真源。`derived` 只带 `{ v, blockCount, fingerprint, outline }`。
- **`core/derive/index.js` 未改**：快照器是新的纯模块 `core/derive/snapshot.js`，
  `outline()` 实时算的那条路保持不动 —— 水合的产物与实测逐项相同（有用例比对 `pos`）。
- **两处真实缺陷（均在 Step 4 前查出并修掉）**：
  1. 本地草稿分支不写 `schemaVersion`（只有 session 分支经 `createDocumentRecord` 补默认值），
     于是本地记录被当成 v1 白跑一遍迁移链，水合门槛永远判否 → 已在 `record()` 里显式补版本号。
  2. **保存侧喂扁平 PM 文档、落库 JSON 却是 `getJSON()` 的聚合容器形态**（标题把后续块收进
     `children`），拿落库原样去比对指纹，会让每一份带标题的文档都被判伪 —— 功能活着但永不生效。
    比对基准改为 `validateDocument()` 之后的扁平正文；`derived-snapshot.test.js` 里
    "storage form vs editor form" 一组专门钉住这条。
- **Step 4 结论：`mountToTypeableMs` 不是 P7-03 的度量对象。**
  `scripts/perf/measure.mjs:147` 走的是 `editor.commands.setContent(contentHtml)`，
  不经过 `onReady()` → `load()` → `hydrateOutline` 这条路径；首屏可输入时间由 setContent
  本身决定，P7-03 刻意不进那条路（它只把**目录**提前，不提前正文）。
  因此该项维持基线量级属预期，不构成失败。P7-03 的收益指标应是
  「载入已存草稿后目录首次非空时间」，需要一条**冷启动探针**（先 save 落库、再 reload），
  归到 Task 6 与 `check:perf` 一起建，避免在 Task 4 交付一把没人跑得起来的脚本。
  本轮的可验证替代：`derived-snapshot` 17 条 + `derived-hydration` 5 条契约用例，
  覆盖「保存 → 序列化 → 展平 → 校验 → 水合」全链，正好是上面第 2 个缺陷的漏检处。

### Task 5: Add rAF batching and make the conditional P7-05 decision

**Files:**
- Modify: only the existing high-frequency editor handlers that currently schedule independent updates.
- Create or modify: `docs/guide/performance.md`
- Test: `test/unit/perf-scheduling.test.js` and a focused browser probe.

**Interfaces:**
- Consumes: post-Task-4 performance results and existing widget keys/DOM structure.
- Produces: at most one visual flush per frame for hover/fold/search updates, plus a documented decision on `content-visibility`.

- [ ] **Step 1: Write failing scheduling/DOM-count tests** for 200 hover events, fold toggles, and search updates.
- [ ] **Step 2: Implement one rAF coalescing scheduler per affected UI path**, preserving event order, ARIA state, and cancellation on destroy.
- [ ] **Step 3: Run browser probes** and compare `outerHTML`/node counts against the pre-change fixture; reject any new wrapper or widget churn.
- [ ] **Step 4: Re-run the 2,000-block measure.** If first-input remains >1.5 s or scroll remains <40 FPS after P7-01/02/03, add only `content-visibility: auto` and verify Ctrl+F, printing, selection, screen-reader DOM, and ≥50 FPS; do not implement windowing. Otherwise document why virtualization is not needed.
- [ ] **Step 5: Commit** `perf(p7-04): coalesce high-frequency editor updates` and, if applicable, `perf(p7-05): add conditional long-document rendering` as separate commits.

### Task 6: Finish P7-06 performance reporting and CI gate

**Files:**
- Modify: `.github/workflows/e2e.yml` or `.github/workflows/ci.yml`
- Create: `perf/report.md`
- Modify only if needed: `scripts/perf/report.mjs`, `package.json`
- Test: a deterministic report/gate test or shell fixture for >20% regression.

**Interfaces:**
- Consumes: final `perf/.perf-result.json`, current baseline, and the established `check:perf` command.
- Produces: CI-visible performance output with a non-zero exit for any metric regression over 20%, plus a checked-in human-readable report.

- [x] **Step 1: Write the gate regression fixture** and assert that normal data passes while a synthetic >20% regression fails.
- [x] **Step 2: Run the fixture against the current script** and confirm the failure before changing CI/reporting.
- [x] **Step 3: Make `perf/report.md`** from the real post-P7 measurement, recording seed, block count, runtime, capture time, metrics, threshold, and interpretation; never hand-edit numbers into `perf/baseline.json`.
- [x] **Step 4: Add `npm run check:perf` to CI** at a bounded location with the required Chromium/runtime setup; keep existing lint/unit/build/size/e2e jobs unchanged.
- [x] **Step 5: Run `npm run check:gate`, `npm run check:artifacts`, `npm run check:perf`, the element smoke, and the docs build (`cd docs && npm run docs:build`).
  **实况：** `check:gate` EXIT=0（69 个测试文件全绿）、`check:artifacts` EXIT=0
  （ESM 279.21 / UMD 453.81 / Element 470.33 / CJS 2.46 MB、协同子入口 2.92 kB，全部在预算内）、
  `check:perf` EXIT=0、element smoke **14/14 PASS**。
  `docs:build` 原地构建被**运行环境的 safe-delete 垫片**拦住（VitePress 清空 `.vitepress/dist/assets`
  时 104 项 > 50 阈值），换 `npx vitepress build . --outDir /tmp/...` 复跑 **EXIT=0**，
  可见文档内容与 `.vitepress/config.mts` 本身无错，属环境限制而非构建缺陷。
  `verify.mjs perf-scheduling` 有 1 条既有失败（`气泡条每轮定位只量 2 次坐标` 实测 3），
  已用「把 `src/core/derive/index.js` 回退到 HEAD 再跑」验证**与本轮改动无关**，同样复现。
- [ ] **Step 6: Commit** `ci(p7-06): enforce performance regression gate`.

### Task 7: Integrated review and v0.12.0 release readiness

**Files:**
- No new production files by default; review the integrated diff and generated report.
- Release metadata only after acceptance: `package.json`, `.release/pending-version` via the existing release script.

- [ ] Verify `git diff --check`, clean/unintended files, dependency diff, and no changes under forbidden paths.
- [ ] Re-run all P7 exit criteria: decorations ≤4 ms, keystroke p95 ≤16 ms, first input ≤1.5 s, scroll ≥50 FPS where applicable, storage transaction semantics, all existing regression suites, size budgets, and docs build.
- [ ] Run one independent correctness/simplicity review against this plan; resolve all blocking findings before release.
- [ ] Only after review and user authorization, use the repository release script for `v0.12.0` on the approved branch; do not publish earlier beta artifacts.

## Verification Matrix

| Area | Command / evidence | Pass condition |
| --- | --- | --- |
| Derived index | `npx vitest run test/unit/derived-index.test.js` + four existing block regressions | Multi-range mapping, heading propagation, no full scan on local edit |
| Storage | `npx vitest run test/unit/storage-idb.test.js` + `node scripts/check-lark-doc-workspace.js` | IDB transaction success/failure and fallback semantics are explicit |
| Snapshot | `npx vitest run test/unit/derived-snapshot.test.js` + browser probe | Early outline, stale fallback, first input budget |
| Scheduling | focused browser probe | ≤1 flush/frame and no DOM structure regression |
| Performance | `npm run check:perf` | No metric regresses >20%; final report matches real run |
| Full gate | `npm run check:gate` and `npm run check:artifacts` | EXIT=0; no new errors/warnings |
| Docs | `cd docs && npm ci && npm run docs:build` | VitePress build succeeds and sidebar links resolve |
| Release safety | `git status --short --branch`, `git diff --check` | Only intended task files changed; no master merge |

## Self-Review

- **Spec coverage:** P7-01 through P7-06 each have an owning task, file boundary, test, measurement, and commit; P7-05 remains explicitly conditional.
- **Step scan:** each step is a single test, implementation, verification, or commit action; no task relies on unspecified “appropriate” behavior.
- **Type consistency:** `createDerivedIndex()` and `createWorkspace(storage, options)` remain the stable cross-task interfaces; snapshots are additive record fields, not a new document JSON shape.
- **Review focus coverage:** mapping fan-out, numbering propagation, storage failure, stale snapshot fallback, and native long-document behavior each have named tests/probes.
- **Proportion:** the plan deliberately excludes unrelated provider gaps and UI redesign; the existing docs site is verified but not refactored.

