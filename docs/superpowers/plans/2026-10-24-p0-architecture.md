# P0 · 架构缝 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use **superpowers:subagent-driven-development** to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 lark-doc 从"Vue2 单体的编辑器"改成"core 零框架 + 三端薄适配"的形态，并建立单测 / CI / 性能基线三道门禁，使 P1–P7 能在不返工的地基上推进。

**Architecture:** 只搬不改行为。把 `src/components/lark-doc/` 下的 `extensions.js`（960 行）、`commands.js`（55 行）、`LarkDocEditor.vue`（模板 1777 行）按职责拆到 `src/core/` 与 `src/registry/`，用注册表查表替掉静态 import 与 `if` 分支；`src/core` 的依赖闭包不得含 `vue` / `@tiptap/vue-2`；新增 `src/adapters/{vue2,vue3,react}.js` 三端适配。

**Tech Stack:** Node 14.21.3（构建）/ Node 22（浏览器断言）、vue-cli-service lib target、vitest（新增）、playwright-core（断言）、size-limit、GitHub Actions。

**Spec:**
- `requirements/09-开发方案-0.12.md` §5.1（P0 十一任务单 + §5.1.1 拆分清单）、§3（跨期共享契约）、§6（门禁）
- `requirements/10-缺口与待补清单.md` A13（`bear-web-toolbar`）
- 总盘子：`docs/superpowers/specs/2026-10-24-012-overall-plan.md`

---

## Global Constraints

- **Node**：构建用 Node 14.21.3；浏览器断言用 Node 22 且 `NODE_PATH=/Users/cjjxw/.workbuddy/binaries/node/workspace/node_modules`。
- **门禁**：`npm run check` 必须 **EXIT=0 且 0 warning**。链内已含 `check:architecture`。
- **断言**：10 套，跑前需先起 demo（`apps/vue2-webpack-node14`，端口 8080，路由 `/lark-doc`，暴露 `window.__larkDoc`）并 **run_in_background**：
  `node scripts/verify-browser-{highlight-fold,heading-number,heading-menu,icon-align,list-marker,list-number-menu,element,mermaid,colors}.js` + `npm run check:vditor`
  基线数：highlight-fold **74** / heading-number **38** / heading-menu **16** / icon-align **7** / list-marker **23** / list-number-menu **30** / element **14** / mermaid **12** / vditor **91**。
  ⚠️ `colors` 套的基线数**未在既存记录中**，Task 1 开工前先跑一次实测并回填本文档；在此之前它的"不回退"判据是「与开工前数字相同」而非固定值。
- **原则**：只搬不改行为。任何一步结束后 10 套断言不得回退。
- **分支**：`next/0.12`（主题切换另用独立 `feat/theme`，不进本分支）。
- **发布**：走 `npm run ship`，不手工摸索。
- **基线不许手填**：`perf/baseline.json` 的数字必须来自真实运行。

## Review Focus

以下五条是 spec 隐含、但没有单个任务专门测试它的失败模式。按指示分配到对应任务。

| # | 失败模式 | 归属任务 |
|---|---|---|
| RF1 | 老 JSON（schema v1）在拆分后读不进来 —— P0 号称"只搬不改行为"，却没有任何任务验证旧数据 | Task 4 |
| RF2 | `perf/baseline.json` 数字被手填或来自空文档，导致后续 `check:perf` 形同虚设 | Task 10 |
| RF3 | React 端是全新工程，漏引 CSS 导致样式全丢而检查链不报 | Task 6 |
| RF4 | `release.sh` 安全阀在 master 上误拦正常发布 | Task 8 |
| RF5 | 拆 SFC 后 DOM 结构发生变化（类名/层级/顺序），视觉回归 | Task 3 |

---

### Task 1: P0-01 删死代码

**Files:**
- Delete: `src/components/lark-doc/ImageNode.vue`、`src/components/lark-doc/CodeNode.vue`（合计 788 行）
- Modify: `src/components/lark-doc/extensions.js:427`、`src/components/lark-doc/extensions.js:445` —— `addNodeView` 分支改为查 registry

**Interfaces:**
- Produces: `src/registry/nodeviews.js` 的 `getNodeView(name)`（Task 2 建；本 Task 先建空壳 + `set/get`，返回 `undefined` 时走默认渲染）

- [ ] **Step 1: 写失败测试** —— 新增 `test/unit/no-dead-code.test.js`：断言 `require('../../../src/components/lark-doc/extensions')` 的依赖闭包内不含 `ImageNode` / `CodeNode` 字符串；`git grep -n "ImageNode\|CodeNode" src/` 退出码非 0。
- [ ] **Step 2: 跑，确认失败** —— `npm run check:unit`；预期 FAIL（当前文件仍在）。
- [ ] **Step 3: 实现** —— 建 `src/registry/nodeviews.js`（导出 `setNodeView(name, factory)` / `getNodeView(name)`）；删除两个 `.vue`；`extensions.js:427,445` 的 `addNodeView` 改为 `const v = getNodeView(type); if (v) return v`。
- [ ] **Step 4: 跑，确认通过** —— `npm run check:unit` + `npm run check` + 10 套断言；预期全绿且断言数不回退。
- [ ] **Step 5: Commit** —— `git add -A src test && git commit -m "refactor(p0-01): 删除 ImageNode/CodeNode 死代码，addNodeView 改查注册表"`

---

### Task 2: P0-02 core 去 Vue

**Files:**
- Modify: `src/components/lark-doc/extensions.js:27`（静态 import 移出）
- Create: `src/registry/nodeviews.js`（补充完整实现）
- Test: `test/unit/core-no-vue.test.js`

**Interfaces:**
- Consumes: Task 1 的 `src/registry/nodeviews.js`
- Produces: 无新增对外接口

- [ ] **Step 1: 写失败测试** —— `test/unit/core-no-vue.test.js`：`require('src/components/lark-doc/extensions')` 后遍历 `require.cache`，断言闭包内不含 `vue` / `@tiptap/vue-2`。
- [ ] **Step 2: 跑，确认失败** —— 预期 FAIL（`:27` 仍有静态 import）。
- [ ] **Step 3: 实现** —— `extensions.js:27` 的静态 import 改为运行时经 `setNodeView` 注入；`extensions.js` 所有 NodeView 获取改查表。
- [ ] **Step 4: 跑，确认通过** —— `npm run check` + `check:architecture` + 10 套断言。
- [ ] **Step 5: Commit** —— `"refactor(p0-02): core 依赖闭包去 Vue，NodeView 走注册表"`

---

### Task 3: P0-03 拆编辑器模板（RF5 归属）

**Files:**
- Modify: `src/components/lark-doc/LarkDocEditor.vue`（2304 行；模板 1777 行按 §5.1.1 区间拆走，script 保留在父组件）
- Create: `src/components/lark-doc/editor/TopBar.vue`（1–38）、`editor/ToolbarBar.vue`（39–514）、`editor/OutlinePanel.vue`（515–577）、`editor/PaperStage.vue`（578–612）、`editor/BlockHandleMenu.vue`（613–966）、`editor/ContentFrame.vue`（967–1160）、`editor/BubbleBar.vue`（1161–1508）、`editor/dialogs/*.vue`（1509–1777）

**Interfaces:**
- Produces: 8 个子组件；父组件对外 props/events **完全不变**

- [ ] **Step 1: 写失败测试（RF5）** —— `test/unit/editor-dom-snapshot.test.js`：拆分前先在 demo 里抓一次完整 DOM 快照（`outerHTML`，剔除动态 id）存为 `test/fixtures/editor-dom-before.html`；断言脚本比对拆分前后**逐节点相同**。
- [ ] **Step 2: 跑，确认基线建立** —— 快照入库，测试当前 PASS（作为基线）。
- [ ] **Step 3: 实现** —— 按 §5.1.1 的 8 段区间顺序拆，**一次只拆一段**，每段拆完立刻跑 Step 4。
- [ ] **Step 4: 跑，确认通过** —— DOM 快照比对无差异 + `npm run check` + 10 套断言。
- [ ] **Step 5: Commit** —— 按段提交（8 次），消息 `"refactor(p0-03): 拆出 editor/<Name>.vue（模板 <区间>）"`；最后补一条断言：父组件 < 700 行。

---

### Task 4: P0-04 拆块注册表（RF1 归属）

**Files:**
- Modify: `src/components/lark-doc/extensions.js`（960 行）
- Create: `src/core/blocks/*.js`（24 个，每块一个）、`src/registry/blocks.js`

**Interfaces:**
- Produces: `src/registry/blocks.js` 导出 `registerBlock(def)` / `getAllBlocks()` / `getBlock(name)`

- [ ] **Step 1: 写失败测试（RF1）** —— `test/unit/schema-snapshot.test.js`：拆分前先存一份 `editor.getSchema()` 序列化快照 `test/fixtures/schema-v1.json`；再做**老 JSON round-trip** 测试——用 `test/fixtures/legacy/*.json`（schema v1 的老正文）导入后 `getJSON()` 与导入前逐字节相同。
- [ ] **Step 2: 跑，确认基线建立** —— 快照入库。
- [ ] **Step 3: 实现** —— 24 个块逐一搬到 `src/core/blocks/`；`extensions.js` 改为遍历注册表。每文件 < 250 行。
- [ ] **Step 4: 跑，确认通过** —— schema 快照**逐字节相同** + 老 JSON round-trip 无损 + 10 套断言。
- [ ] **Step 5: Commit** —— `"refactor(p0-04): 块定义拆到 core/blocks/*，extensions 改查注册表"`

---

### Task 5: P0-05 拆命令表

**Files:**
- Modify: `src/components/lark-doc/commands.js`（55 行）
- Create: `src/core/commands/{basic,common,data,media,embed,collab,widget,button,pim,advanced,docmanage,inline}.js`（12 个）

**Interfaces:**
- Produces: `CommandDef` 形状（含 `id` / `title` / `tier` / `run`）；22 条命令 id 集合**不变**

- [ ] **Step 1: 写失败测试** —— `test/unit/commands.test.js`：断言命令 id 集合等于 22 条固定清单（写死在测试里）；断言每条 `CommandDef` 都有 `tier` 字段。
- [ ] **Step 2: 跑，确认失败** —— 预期 FAIL（`tier` 尚不存在）。
- [ ] **Step 3: 实现** —— 按 12 个域拆分；为每条命令补 `tier`（取值参照 09 §4 三档）。
- [ ] **Step 4: 跑，确认通过** —— `npm run check` + 10 套断言。
- [ ] **Step 5: Commit** —— `"refactor(p0-05): 命令表按域拆分，CommandDef 补 tier 字段"`

---

### Task 6: P0-06 三端适配 + demo（RF3 归属）

**Files:**
- Create: `src/adapters/vue2.js`、`src/adapters/vue3.js`、`src/adapters/react.js`
- Create: `apps/react-vite/`（新建工程）
- Modify: `apps/vue3-vite/`（改为消费 `lark-doc/element`）

**Interfaces:**
- Consumes: Task 2 的 `src/registry/nodeviews.js`、Task 4 的 `src/registry/blocks.js`
- Produces: `createVue2Adapter(options)` / `createVue3Adapter(options)` / `createReactAdapter(options)` —— 三端同签名，返回 `{ mount, unmount, editor }`

- [ ] **Step 1: 写失败测试（RF3）** —— 每端一个冒烟脚本 `test/e2e/smoke-{vue2,vue3,react}.mjs`，五步：挂载 → 输入 → 折叠 → 表格 → `getJSON`；**React 端额外断言：挂载后根容器 computed 的 `font-family` / 背景色与 Vue2 端一致**（防漏引 CSS）。
- [ ] **Step 2: 跑，确认失败** —— Vue3/React 端预期 FAIL。
- [ ] **Step 3: 实现** —— 三个 adapter；`apps/react-vite` 工程；`apps/vue3-vite` 改消费 element 产物。
- [ ] **Step 4: 跑，确认通过** —— 三端冒烟全绿；`npm run check`（含 `size`）四个预算不涨。
- [ ] **Step 5: Commit** —— `"feat(p0-06): 三端适配器 + react-vite demo，vue3-vite 改消费 element"`

---

### Task 7: P0-07 单测 + fixtures 骨架

**Files:**
- Create: `test/fixtures/blocks/`（24 个块各一份）、`test/unit/`、`test/bootstrap.js`、`vitest.config.js`
- Modify: `package.json`（`check:` 链加 `check:unit`）

**Interfaces:**
- Produces: `npm run check:unit`

- [ ] **Step 1: 写失败测试** —— `test/unit/block-roundtrip.test.js`：遍历 `test/fixtures/blocks/*.json`，各做一次 `setContent → getJSON` round-trip。
- [ ] **Step 2: 跑，确认失败** —— 预期 FAIL（fixtures 目录为空 / 框架未配）。
- [ ] **Step 3: 实现** —— 建 vitest 配置与 bootstrap；补 24 份 fixture；`check:` 链插入 `check:unit`。
- [ ] **Step 4: 跑，确认通过** —— `npm run check:unit` 24 份全绿；`npm run check` 全链绿。
- [ ] **Step 5: Commit** —— `"test(p0-07): 建 vitest 骨架与 24 个块 fixture，接入 check 链"`

---

### Task 8: P0-08 CI + 发布安全阀（RF4 归属）

**Files:**
- Create: `.github/workflows/ci.yml`、`.github/workflows/e2e.yml`
- Modify: `scripts/release.sh`（加安全阀）

**Interfaces:**
- Produces: CI 两个 workflow；`release.sh` 规则「非 master 且未 `--skip-publish` → die」

- [ ] **Step 1: 写失败测试（RF4）** —— `test/unit/release-guard.test.js` 两条：① 非 master 分支 → `--dry-run` 非零退出；② 模拟 master → `--dry-run` 零退出（**不得误拦**）。
  实现要求：分支名必须可注入（如读环境变量 `LARK_DOC_RELEASE_BRANCH`，未设时回落 `git rev-parse --abbrev-ref HEAD`），否则测试无法在 `next/0.12` 上覆盖第 ② 条。
- [ ] **Step 2: 跑，确认失败** —— 预期 FAIL（阀门未加）。
- [ ] **Step 3: 实现** —— 加阀门；写两个 workflow（ci: check 全链 + 单测；e2e: 起 demo + 10 套断言）。
- [ ] **Step 4: 跑，确认通过** —— 故意在分支上跑 `npm run ship` 被拦；master 上 `--dry-run` 通过；两个 workflow 绿。
- [ ] **Step 5: Commit** —— `"ci(p0-08): 建 ci/e2e workflow，release.sh 加非 master 安全阀"`

---

### Task 9: P0-09 契约骨架落地

**Files:**
- Create: `src/core/embed/types.js`（`EmbedDef` 形状 + 15 条 preset 空壳）、`src/core/embed/card.js`（`cardSchema` 常量）、`src/collab/index.js`、`docs/guide/collab-server.md`
- Modify: 无

**Interfaces:**
- Produces: `EmbedDef` 形状、`cardSchema`、`COLLAB_PROTOCOL_VERSION` 常量 + 三个函数签名（`createCollabExtensions` / `serializeCollabUpdate` / `applyCollabUpdate`），**全部 `throw new Error('not implemented')`**

- [ ] **Step 1: 写失败测试** —— `test/unit/contract-skeleton.test.js`：`EmbedDef` 15 条 preset 各有一条「URL → attrs」单测（当前应返回空壳）；三个协同函数调用时抛出 `'not implemented'`。
- [ ] **Step 2: 跑，确认失败** —— 预期 FAIL（文件不存在）。
- [ ] **Step 3: 实现** —— 只写类型、常量与注释，**零实现**；`docs/guide/collab-server.md` 写契约文本。
- [ ] **Step 4: 跑，确认通过** —— 单测绿；`check:architecture` 已能校验依赖方向。
- [ ] **Step 5: Commit** —— `"feat(p0-09): 落地 EmbedDef / cardSchema / 协同契约骨架（零实现）"`

---

### Task 10: P0-10 性能基线采集 + 门禁（RF2 归属）

**Files:**
- Create: `scripts/perf/build-doc.mjs`、`scripts/perf/measure.mjs`、`scripts/perf/report.mjs`、`perf/baseline.json`
- Modify: `package.json`（加 `check:perf`）

**Interfaces:**
- Produces: `npm run check:perf` —— 退化 > 20% 时非零退出；`perf/baseline.json`（填 09 §2.4.3 表的"基线"列）

- [ ] **Step 1: 写失败测试（RF2）** —— `test/unit/perf-gate.test.js`：`perf/baseline.json` 的每个数字必须 **非 0、非空、非占位**，且带 `generatedAt` 与 `nodeVersion` 字段（防手填）；`check:perf` 喂入一份"退化 30%"的假数据 → 断言非零退出。
- [ ] **Step 2: 跑，确认失败** —— 预期 FAIL（baseline.json 尚不存在）。
- [ ] **Step 3: 实现** —— 2,000 块 fixture 生成器（文本 + 标题 + 列表 + 表格混合，**可复现 seed**）；三个脚本；`check:perf`。
- [ ] **Step 4: 跑，确认通过** —— 真实运行生成基线并写入 `baseline.json`（**不许手填**）；`check:perf` 在正常数据下零退出。
- [ ] **Step 5: Commit** —— `"perf(p0-10): 建性能基线与 check:perf 门禁（数字来自真实运行）"`

---

### Task 11: P0-11 DerivedIndex 骨架

**Files:**
- Create: `src/core/derive/index.js`
- Modify: `src/components/lark-doc/extensions.js:761`（改为调用它，行为不变）

**Interfaces:**
- Produces: `createDerivedIndex()` → 返回六个方法（签名见 09 §3.7.1）：`update(tr)` / `getFoldState(id)` / `getHeadingNumbers()` / `getOutline()` / `getBlockRange(id)` / `decorations()`
- `update(tr)` 先实现为「标记 dirty + 下次 `decorations()` 全量重建」

- [ ] **Step 1: 写失败测试** —— `test/unit/derive-index.test.js`：六个方法存在且返回形状正确；连续 `update` 后 `getHeadingNumbers()` 结果与旧实现**逐条一致**。
- [ ] **Step 2: 跑，确认失败** —— 预期 FAIL（文件不存在）。
- [ ] **Step 3: 实现** —— 建骨架；`extensions.js:761` 改调用。
- [ ] **Step 4: 跑，确认通过** —— 10 套断言全绿 **且 `check:perf` 数字与 P0-10 基线一致（±5%）**。
- [ ] **Step 5: Commit** —— `"refactor(p0-11): 派生计算收拢到 DerivedIndex（行为不变，仅换入口）"`

---

### Task 12: A13 · 顶部工具栏规格补齐 + 类名对齐

**Files:**
- Modify: `requirements/03-工具栏与菜单.md` §3.5（补完整按钮清单与 hover 态，标注【待补】处）
- Modify: `src/components/lark-doc/lark-doc.css`（`.lark-doc-toolbar` → `.bear-web-toolbar`）
- Modify: `src/components/lark-doc/editor/ToolbarBar.vue`（Task 3 产出）

**Interfaces:**
- Consumes: Task 3 的 `editor/ToolbarBar.vue`

- [ ] **Step 1: 写失败测试** —— `git grep -n "lark-doc-toolbar" src/` 退出码非 0；`03-工具栏与菜单.md` §3.5 内不含【待补】标记。
- [ ] **Step 2: 跑，确认失败** —— 预期 FAIL。
- [ ] **Step 3: 实现** —— 先补规格（**飞书真实按钮清单与 hover 态需实测采集，不得凭手感**），再改类名。**注意**：`lark-doc.css` 与气泡条避让逻辑（`bubbleSafeTop()`）都引用了 `.lark-doc-toolbar`，改名必须同步，否则浮层避让失效。
- [ ] **Step 4: 跑，确认通过** —— `npm run check` + 10 套断言（含 icon-align 7 条，直接覆盖工具栏）+ 浮层避让（`bubbleSafeTop()`）不回退。
  ⚠️ **必须同步更新 Task 3 的 RF5 基线** `test/fixtures/editor-dom-before.html` —— 本任务改了 `lark-doc-toolbar` 类名，不更新基线则 Task 3 的 DOM 快照断言会由绿转红，且红色原因是"预期内的改名"而非回归。
- [ ] **Step 5: Commit** —— `"feat(p0-a13): 工具栏对齐 bear-web-toolbar，03 补齐按钮清单与 hover 态"`

---

## 出口标准（P0 全部完成后）

- [ ] `npm run check` EXIT=0 且 **0 warning**
- [ ] 10 套断言全绿（74/38/16/7/23/30/14/12/91）
- [ ] `getSchema()` 序列化快照与 0.11.5 **完全一致**
- [ ] 三端冒烟通过
- [ ] `size-limit` 四个预算不涨
- [ ] `perf/baseline.json` 已生成且 `check:perf` 可运行（此刻数字难看是允许的——它是基线，不是目标）
- [ ] 打 tag `v0.12.0-beta.1`
