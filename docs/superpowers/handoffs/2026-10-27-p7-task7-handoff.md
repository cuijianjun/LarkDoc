# 交接：P7 收口完成 → Task 7 集成复核 + 两个待决策

> 这份文档是给**新会话**用的，贴进去就能直接接手，不需要再读计划全文或 `requirements/`。
> 上一份交接是 `docs/superpowers/handoffs/2026-10-27-p7-04-05.md`（HEAD `5e3bbe0` 时写的），
> **其内容已过期**：里面说 P7-04 未开工、`decorationsRebuildMs = 2.1`、基线失真 —— 这三条现在都不成立。
> 生成时间：2026-10-27 23:10，基线 HEAD `05c32f0`。

---

## 0. 一句话状态

**P7-01 ~ P7-06 的代码全部落地、已提交、已推 `origin/next/0.12`。** `Task 7`（集成复核 + 发布就绪）
**四件事里三件已完成**：决策 A/B 已由用户拍板并执行（§3），diff 干净度 ✓、独立复核 ✓、
**全量退出判据复跑 ✓（`check:gate` + `check:artifacts` + `check:perf` 全 EXIT=0，见 §4.3）**。
独立复核揪出的 1 条用户可见回归已修（§6.0），8 条非阻塞项挂账等用户定夺（§6.1）。
**剩下的只有发布**：`v0.12.0` tag / `npm publish` / 合 `master` —— **一律未授权、保持悬停**。

## 1. 仓库与状态

- 仓库根：`/Users/cjjxw/codex/tiptap-integration-demos/apps/lark-doc`（**不是** `apps/`，所有命令先 cd 进去）
- 分支：`next/0.12`，HEAD = `5ee6f10 chore(p7): 压缩 document-decorations.js 注释至 398 行，满足 P0-04 <400 断言`
  （上一个功能提交是 `fa2226e fix(p7): widget 点击目标改读 getPos，并落地决策 A/B 结论`）
- 版本：`package.json` = `0.12.0-beta.8`（**本轮未改版本号**，未打 tag，未发布）
- 计划原文：`docs/superpowers/plans/2026-10-27-p7-performance-closure.md`

### 1.1 ⚠️ 计划文档的 checkbox 落后于代码 —— 别信勾选，信下表

新会话最容易踩的坑：照着计划读会以为 P7-02 / P7-04 没做。**实际全部做完了，只是没回去补勾。**

| Task | 计划里勾了吗 | 真实状态 | 提交 |
| --- | --- | --- | --- |
| Task 1（P7-01 测试 seam） | 已勾 | done | — |
| Task 2（P7-01 脏区增量） | Step 6 未勾 | 代码 done；**Step 6 两条判据实测未达成**，已写执行记录 | `933ad1c` |
| Task 3（P7-02 IndexedDB） | **全未勾（滞后）** | **done**：`src/core/storage/idb.js`（360 行）+ `providers/persistence.js` + `test/unit/storage-idb.test.js`（376 行）+ `test/helpers/fake-indexeddb.js` | `00a6c5b` + `2cd8c48` |
| Task 4（P7-03 快照水合） | 已勾 | done：`src/core/derive/snapshot.js` + `derived-snapshot.test.js` | `5e3bbe0` |
| Task 5（P7-04 rAF 合并 / P7-05 决策） | **全未勾（滞后）** | **done**：`src/core/pacing.js`（173 行）+ `editor/selectionPacingMixin.js` + `perf-scheduling.test.js`（340 行）+ `verify-browser-perf-scheduling.js`；P7-05 结论「不窗口化」已落 `docs/guide/performance.md` §二 | `7aef365` |
| Task 6（P7-06 报告 + CI 门禁） | Step 1-5 勾，Step 6 未勾 | **done**：`scripts/perf/gate.mjs` + `perf-gate.test.js` + `perf/report.md` + **`.github/workflows/perf.yml` 已存在** | `36ba355` / `af8e7aa` / `a86f515` / `05c32f0` |
| Task 7（集成复核 + 发布就绪） | 第 4 条未勾 | **复核 3/3 全过**：diff 干净度 ✓、退出判据复跑 ✓、独立复核 ✓（并修掉 1 条阻塞回归）；**只剩发布未授权** | `fa2226e` + `5ee6f10` |

补勾计划文档是可选的收尾动作（属于同一批文件、不涉及用户并行改动），但**先别急着改文档**，先看 §3 的决策。

## 2. 上一轮（`05c32f0`）到底改了什么

一句话：**把「装饰」这条性能指标的口径订正到能真实度量，并借此把性能基线推进到今天。**

### 2.1 指标名换了第三段口径，三段之间**不可换算**

| 段 | 探针在干什么 | 量到的其实是什么 | 值 |
| --- | --- | --- | ---: |
| P7 之前 | `view.updateState(view.state)` | **真·全量重建**（当时无缓存） | 21186.3 |
| P7-01 之后（旧名 `decorationsRebuildMs`） | 同 state 重放只命中缓存，改发纯 meta 事务 | 事务被插件按 `touchesDecorations: tr.docChanged \|\| !!action` 判成「不动装饰」→ **dispatch 固定开销**，装饰根本没重建 | 35.1 |
| 现在（新名 `decorationIncrementalMs`） | 文本块内发 20 次 `insertText`，取 **derive 层**增量样本中位数 | 击键路径上的装饰增量耗时 | **72.6** |

**任何把这两段拼成「−99%」的说法都是假结论。** 报告里已按这个口径写死。

### 2.2 打点必须下沉到 derive 层（改法）

装饰增量那一段（`previous.map` + 窗口重扫）夹在 `view.dispatch` 内部，外面只能量到
「dispatch → 下一次绘制」整段（实测 p50 195.9 / max 201.6 ms，混着 DOM 补丁、排版、合成）。所以：

- `src/core/derive/index.js`：`decorations(state)` 从一行 `incremental(...) || rebuild(state)` 拆成显式分支，
  两条路径各自计时，经 `globalThis.__larkDocPerf.samples` 压入 `{ path: 'incremental' | 'rebuild', ms }`。
  **宿主页没挂 `__larkDocPerf` 时只是一次属性读取**，热路径代价可忽略。
- `scripts/perf/measure.mjs` 第 3 项改发 20 次便宜 `insertText`，收尾一次删净；
  **拿不到增量样本直接 throw**（防止将来判据把纯文字改动挡住时，悄悄写出一个空指标）。
- `scripts/perf/gate.mjs`：键名 `decorationsRebuildMs` → `decorationIncrementalMs`；
  `test/unit/perf-gate.test.js` 同步 2 处 fixture。

### 2.3 基线已推进（有备份）

- `perf/baseline.json` = `2026-10-27T14:43:12Z` 采集（`platform darwin / arch x64`）
- P7 前数值备份在 **`perf/baseline-pre-p7.json`（别删，这是「优化前」的唯一凭据）**

| 指标 | 现值 |
| --- | ---: |
| `mountToTypeableMs` | 36666.8 |
| `keystrokeP95Ms` | 2578 |
| `keystrokeP99Ms` | 2578 |
| `decorationIncrementalMs` | 72.6 |
| `scrollFps` | 60.3 |
| `saveProxyMs` | 21.6 |
| `heapMB` | 107.9 |

**操作顺序不可颠倒**：改键名后旧基线必然判 `✗ 缺数据`（`compareMetrics` 的 `MISSING` 分支 → EXIT=1），
先确认这条失败、再 `report.mjs --update`。颠倒会把告警盖掉。

## 3. 两个决策 —— **已由用户拍板，本会话已执行完毕**

> 新会话**不要再问这两个问题**，直接按下面的结论往下走。决策原文保留在下面，作为「为什么这么定」的依据。

| 决策 | 用户选择 | 已执行 |
| --- | --- | --- |
| A：装饰判据 | **改写判据 + 报告写实**（不写新优化代码） | `≤ 4 ms` → `≤ 150 ms`；结构性根因已写实进 `perf/report.md` |
| B：基线可信度 | **提升采样数后重采** | 击键样本 8 → 30、`percentile` 改真插值并抽出 `scripts/perf/stats.mjs`；基线已推到 `15:45:16Z`（p95 939.7 / p99 2372.1 不再相等，证明插值生效） |
| 全量测试时机 | **P7 开发完全收口后一次跑，中途不跑** | 收口后执行，见 §4 |

### 决策 A（原问题）：`decorationIncrementalMs = 72.6 ms` 要不要继续压？

计划原判据是 `≤ 4 ms`，实测差一个数量级。**根因已定位到代码行**：

- `collectDocumentDecorations` 里 `collectFoldRanges(doc)`（`src/core/documentOperations.js:1020`）与
  `computeHeadingNumbers(doc)`（`:506`）是**无条件全量遍历**，不受增量窗口限制。源码注释自述
  「逐块调 foldedRange 等于逐块 doc.resolve，扁平文档里就是 O(n²)，2,000 块实测 275 ms」。
- 脏区增量只省掉了「逐块建 Decoration 对象」那一部分，这两趟 O(n) 省不掉 —— 这就是 72.6 ms 的结构性来源。

要压下去必须把这两趟也纳入窗口剪裁，**但会碰语义**：编号向后传播的边界是「下一个更高级标题」，
折叠集合非空时又要求**无条件并入不做相交剪裁**（否则会丢折叠段）。这是新工作量，不在 P7 原范围。

三条路，任选：
1. **单开 P7-07** 把这两趟纳入窗口剪裁（有真实收益空间，但要重新定义编号传播边界并补用例）；
2. **改写判据**：承认「击键路径无全量重建」这一事实，把 `≤ 4 ms` 换成对 `decorationIncrementalMs` 的现实阈值（如 ≤ 100 ms），并在报告里写清为什么；
3. **挂账不修**：在 Task 7 的复核结论里记一条已知项，进入发布流程。

### 决策 B（原问题）：当前基线数字的可信度

同一份 `dist` 连采多次，`keystrokeP95Ms` = **2578.0 / 4343.9 / 6837.7**（极差 2.65 倍），更早一轮还是 801.2。

- **内生原因**：`percentile(v, 0.95)` 在 8 个样本下是 `Math.round(0.95 * 8) - 1 = 7`，即**最后一项 = 最大值**。
  所以现在 `keystrokeP95Ms` 与 `keystrokeP99Ms` 是同一个数（2578 / 2578），单次抖动直接决定结果。
- **外因**：采集时 `load average` 6.3 / 7.2 / 7.9，机器 22 天未重启；`pmset -g therm` 显示
  `CPU_Speed_Limit = 100`、无降频警告 → 抖动来自别的进程抢 CPU，不是降频。

两条路：
1. **重采**：等机器空闲，同时把击键采样数提上去（如 8 → 30）、`percentile` 改真插值，再 `--update` 一次；
2. **接受**：承认当前基线只适合拦**量级**退化，不适合当「精确 20%」的标尺（`docs/guide/performance.md` 已这么写）。

## 4. Task 7 要做的（计划 214–223 行）

- [x] `git diff --check`、检查干净度 / 未预期文件 / 依赖 diff / 是否碰了禁改路径 —— **已过**（见下面 §4.2）
- [x] 重跑全部 P7 退出判据（现状见 §4.1）—— **已过**：`check:gate` + `check:artifacts` + `check:perf` 全 EXIT=0，明细见 §4.3
- [x] 一次独立的 correctness/simplicity 复核（对着计划逐条挑）—— **已过**：8 条非阻塞 + 1 条阻塞，
      阻塞项已修并补了双向验证过的回归用例（见 §6.1）
- [ ] 只有复核通过且**用户明确授权**后，才走仓库发布脚本发 `v0.12.0`；不得提前发 beta 产物 —— **仍悬停**

### 4.1 退出判据现状（已按决策 A / B 重采后的口径更新）

| 判据 | 目标 | 实测 | 结论 |
| --- | ---: | ---: | --- |
| 装饰 `decorationIncrementalMs` | ≤ **150**（决策 A 改写） | **78.8** | ✓ 达标（但负担未消除，见下） |
| `keystrokeP95Ms` | ≤ 16 | **939.7** | ✗ 差两个数量级 |
| `mountToTypeableMs` | ≤ 1500 | **38810.1** | ✗ 差一个数量级以上 |
| `scrollFps` | ≥ 50 | **59.3** | ✓ |
| 存储事务语义 | 用例全绿 | `storage-idb` 通过 | ✓ |
| 回归套件 | `check:gate` EXIT=0 | **EXIT=0（71 文件 / 1664 用例全绿）** | ✓ 已复跑 |
| 体积预算（4 + 1） | 不涨 | ESM 279.24 / UMD 453.82 / Element 470.34 / CJS 2.46 MB / 协同 2.92 kB | ✓ 已复跑 |
| 性能门禁 | 无一指标退化 >20% | 7/7 ✓（见 §4.3） | ✓ 已复跑 |
| docs build | EXIT=0 | 原地构建被环境垫片拦，换 outDir 后 EXIT=0 | ⚠ 环境限制 |

### 4.3 全量复跑结果（2026-10-27T17:0x–17:14 UTC，HEAD `5ee6f10`）

| 环节 | 命令 | 结果 |
| --- | --- | --- |
| 单测 + lint + 主题 + 部署 + 架构 | `npm run check:gate` | **EXIT=0**，71 个测试文件 / **1664** 条用例全绿 |
| 五产物 + Vditor + 体积 | `npm run check:artifacts` | EXIT=0；`artifacts:check` 复验 EXIT=0（5/5 产物就绪） |
| 性能门禁 | `npm run check:perf` | EXIT=0；`node scripts/perf/gate.mjs` 复验 EXIT=0 |
| 本地块契约（**非 CI 环节**） | `npm run contract:check` | 初次 EXIT=1：`_codex/contract/document-decorations.json` 因本轮改了源文件而过期 → 重新生成后 EXIT=0。`_codex/` 未被 git 跟踪，不影响仓库 |

`check:perf` 实测（17:12Z 采集，**没有** `--update`，基线仍是 `15:45:16Z` 那一份）：

| 指标 | 基线 | 本次 | Δ | 判定 |
| --- | ---: | ---: | ---: | --- |
| `mountToTypeableMs` | 38810.1 | 34692.3 | −11% | ✓ |
| `keystrokeP95Ms` | 939.7 | 814.9 | −13% | ✓ |
| `keystrokeP99Ms` | 2372.1 | 1949.9 | −18% | ✓ |
| `decorationIncrementalMs` | 78.8 | 73.9 | −6% | ✓ |
| `scrollFps` | 59.3 | 58.7 | −1% | ✓ |
| `saveProxyMs` | 24.6 | 22.8 | −7% | ✓ |
| `heapMB` | 107.8 | 107.8 | 0% | ✓ |

**测量顺序已复核（2026-10-27T17:21Z）**：`check:perf` 里 `npm run build:element` 会重写
`dist/lark-doc-element.umd.min.js`（本次重建于 `17:12Z`），而 `npm run size` 只读 `dist/`、
不带构建，所以「先 artifacts 后 perf」确实存在量到旧 Element 的可能。补跑一次 `npm run size`
（在 `check:perf` 之后）验证：**五项数字与 `check:artifacts` 里的完全一致** ——
ESM 279.24 / UMD 453.82 / Element 470.34 / CJS 2.46 MB / 协同 2.92 kB，说明本次 element 构建
体积是确定的、顺序没有引入偏差。这条原先写了个「460.76」的对比值，实跑后查无此数，已订正。
（顺序依赖本身仍在：换机器或换构建参数时，体积凭据应取 `check:perf` **之后**的 `npm run size`。）

**中途踩到的一次返工**：给 `document-decorations.js` 补机制注释后该文件到 411 行，顶破
`P0-04` 的 `<400 行` 断言，`check:architecture` 挂住 → 整个 `check:gate` 停摆（`check:unit`
压根没跑到）。压实注释到 **398 行**（提交 `5ee6f10`）后才全绿。教训：给 `src/core/blocks/`
下的文件加长注释前先数行数。

### 4.2 Step 1 diff 干净度结论

- `git diff --check` EXIT=0（无空白错误、无冲突残留）。
- 改动只落在 P7 自有文件：`src/core/blocks/document-decorations.js`、`scripts/perf/{measure,stats}.mjs`、
  `perf/{baseline.json,report.md}`、新增两个单测。
- **无依赖 diff**：`package.json` / lockfile 未动。
- 未跟踪的 `scripts/pack-docs.sh` 是用户并行改动，**未纳入提交**。
- 索引里用户原有的暂存内容（`requirements/00-交接-新会话提示词.md` 的删除）保持原样未动。

**三条绝对耗时线全部未达标，且都不是「再调一调」的量级**：
`keystroke` 与 `mount` 剩下的成本在 ProseMirror 的 DOM 创建与排版侧，
P7-01 已经证明「拆装饰」动不了它们（装饰只占 mount 的 ~36 ms）。
真要推得动，需要 P7-05 明确拒绝的那类挂载策略改造 —— 而 P7-05 的结论是**不做**（理由见
`docs/guide/performance.md` §二：会打穿折叠子树、全文档查找、完整 outline、全文导出四条契约）。

所以 Task 7 的复核应当产出**诚实的结论**：门禁与滚动达标，三条绝对线带着已定位的根因进入发布，
而不是把它们包装成「已收口」。

## 5. 硬约束（踩了就返工）

- **禁止合并 `master`**，分支一直停在 `next/0.12` 连续开发。
- **发布三件未授权**：不发 `v0.12.0` tag、不 `npm publish`、不并 `master`。
- `LarkDocEditor.vue` **必须 < 700 行**（当前 **675**），`scripts/check-architecture.js` 会断言。新方法进 `editor/*.mixin.js`。
- `lint` 只覆盖 `src scripts`，**不覆盖 `test/`** —— 测试文件风格问题抓不到，自己保证。
- 产物预算不涨：ESM 285 KB、UMD 465 KB、Element 480 KB、CJS 2500 KB；协同子入口 90 KB。
- ✅ **用户并行的改动，一个字都别碰**（下面这些都在工作区里躺着）：
  `.gitignore`、`dev/` 7 个文件、`docs/.vitepress/config.mts`、`docs/guide/about.md`、
  `docs/guide/environments.md`、`requirements/` 7 个文件、未跟踪的
  `docs/guide/deployment-docs-site.md`、`docs/guide/deployment-intranet.md`、`scripts/pack-docs.sh`。
- 🔴 **`requirements/00-交接-新会话提示词.md` 的删除已经在索引里暂存了**（`D ` 状态）。
  所以**普通 `git commit` 会把它一起带走** —— 必须用 `git commit -- <pathspec>` 只提交指定路径，
  索引里用户原有的暂存内容原样保留。同理**绝对不要 `git add -A` / `git add .`**。
- 推 GitHub 必须带 IPv4：`git -c core.sshCommand="ssh -4" push origin next/0.12`
  （直连会撞 `2001:2::f` 假地址报 `Connection closed`）。

## 6. 已知缺陷（**不是本轮引入，别当回归去修**）

`node scripts/verify.mjs perf-scheduling` 是 **14/15**，失败项：`气泡条每轮定位只量 2 次坐标` 实测 **3**。

已验证与本轮无关：把 `src/core/derive/index.js` 临时回退到 HEAD 版本、等 HMR 后复跑，**同样 `coords=3`**。
范围很小 —— 只有「单次选区更新」那一轮多测一次坐标；「200 次合并」那一轮仍精确等于 2
（`layout=1 coords=2`），所以 P7-04 的合并契约本身没破。修不修由用户定。

### 6.0 已修的阻塞项（**P7-01 引入的用户可见回归**）

widget 装饰的 `toDOM` 闭包捕获块的绝对 `pos`，而脏区外的 widget DOM 会被 ProseMirror 按 key
复用（`WidgetType.map` 原样返回同一实例 → `matchesWidget` / `eq` 命中 → **闭包不重跑**），
于是点击目标停留在编辑前的位置：

- 列表序号**点了完全不弹菜单**（`nodeAtSafe` 取不回 `listItem` → 静默 `return`）；
- 标题编号**作用在错误的标题上**；
- 折叠箭头**折叠了错误的块**。

已修（改读 `toDOM` 的第二参数 `getPos()`，抽成 `resolveBlockPos` 一处），并新增
`test/unit/document-decorations-widget-pos.test.js`，**改前 3 FAIL / 改后 4 PASS**。
完整过程与机制链条写在计划文档 Task 7 的执行记录里。
顺带修正了 `document-decorations.js:336-339` 那条已被证伪的注释（它只论证了 key 无害，
没覆盖闭包）。

### 6.1 Task 7 独立复核的 8 条非阻塞项（**本轮未修，等用户定夺**）

都不是 P7 引入、也不阻塞发布，但别让它们随会话消失。逐条：

| # | 位置 | 问题 |
| --- | --- | --- |
| 1 | `src/core/storage/idb.js:236-241` | 一条坏记录会把整份数据判成 `CORRUPT`，且**没有自愈路径**（不像单条失败可以跳过重试）。需要决定是「坏记录丢弃 + 其余照常恢复」还是维持整份失败 |
| 2 | `src/components/lark-doc/LarkDocWorkspace.vue:667-671` | 水合出来的目录在 `setContent` **之前**就可点，点了会作用在无内容的编辑器上。加个 ready 门闩即可 |
| 3 | `src/core/pacing.js:98-117` | 四个成员**没有任何调用点**（导出后无人用）。要么删，要么补用例说明为什么留着 |
| 4 | `src/core/derive/snapshot.js:120-129` | 两个字段**只有测试在读**，生产代码不用。同上，删或说明 |
| 5 | `src/core/storage/idb.js:106-108`、`providers/persistence.js:104` | `open` 超时路径下 `request` 未 `close`，请求仍在跑。资源泄漏，量级小 |
| 6 | `src/core/derive/index.js:46-50` | 英文注释措辞**夸大**（把「减少全量扫描」写成「消除」）。改注释即可 |
| 7 | 同上复核中「推测未实跑」的两条 | 复核子代理自陈：① 阻塞项触发链当时未在浏览器里实跑复现、② 多步事务退回全量是在 `/tmp` 最小 schema 上跑的。**① 已由本会话用回归用例实跑验证（见 §6.0）**，② 仍只是最小 schema 证据 |
| 8 | `src/core/documentOperations.js` | 子代理**未逐行复核**（文件过大）。`collectFoldRanges` / `computeHeadingNumbers` 两处被 P7 报告点名是热路径结构性成本，值得单开一轮、只审这两处 |

## 7. 环境坑（这个 shell 特有的）

- **`grep -rn` 递归、以及管道里的 `grep` 会返回空** —— 用 Grep 工具、`git grep`、`awk` 代替。
- `docs:build` **原地构建会被运行环境的 safe-delete 垫片拦住**（VitePress 清 `.vitepress/dist/assets`
  时 104 项 > 50 阈值）。这不是构建错误，换 outDir 即可：
  `npx vitepress build . --outDir /tmp/vp-dist-check`。
- `globalThis` 在 `.eslintrc` 里**未声明**（只开 `env:{node:true}`，ecmaVersion 停在 2018）→
  `no-undef` 报错。用文件级 `/* global globalThis */` 解决，**别去改 `.eslintrc` 加 `es2020:true`**（会连带放宽 ecmaVersion）。
- ~~不要主动跑全量单测 / `npm run build*` / `size-limit` —— 用户明确要求等他的命令~~
  **已解除（2026-10-27）**：用户拍板「P7 完全开发完成后一次跑，中途不跑」→ 收口后已跑完，
  结果见 §4.3。此后如需重跑仍需用户命令，但不必再等一个固定的解锁信号。
- **这个 shell 是 zsh，`$PIPESTATUS` 拿不到** → `cmd | tail -n; echo ${PIPESTATUS[0]}` 会打出**空串**，
  看起来像「没失败」其实是没取到。要退出码就别接管道（`cmd > /tmp/x 2>&1; echo $?`），
  或单独再跑一次 `--check` 形态的命令复验。
- 后台服务与长命令一律 `run_in_background`；demo（`apps/vue2-webpack-node14`，8080，`/lark-doc`）
  必须用 Node14 启动，且它**软链加载 dist，改源码后要 rebuild**。
- vitest 强制 `environment: 'node'`（无 DOM、无 rAF），console 输出需去 ANSI 才能看清。

## 8. 命令清单

```bash
cd /Users/cjjxw/codex/tiptap-integration-demos/apps/lark-doc

# 门禁（重，放后台）
npm run check:gate          # = check:deploy + check:code + check:ui + lint，含全量单测
npm run check:artifacts     # 四产物 + 协同子入口 + size
npm run check:perf          # build:element + measure + report（真跑 Chromium，约 6~10 分钟）

# 只看性能报告，不重采
node scripts/perf/report.mjs

# 重采并推进基线（**只在决策 B 拍板后做**；旧值已在 baseline-pre-p7.json）
node scripts/perf/report.mjs --update

# 定向单测
npx vitest run test/unit/perf-gate.test.js test/unit/perf-scheduling.test.js \
  test/unit/derived-index.test.js test/unit/derived-snapshot.test.js \
  test/unit/storage-idb.test.js test/unit/document-decorations-incremental.test.js

# 浏览器断言（需 demo dev server 在 8080）
node scripts/verify.mjs element perf-scheduling
```

## 9. 开工顺序建议

> **1–4 已全部完成（2026-10-27）**，下面保留原顺序作记录。新会话从 5 开始。

1. ~~先问用户 §3 的两个决策~~ **已拍板**（A：改写判据 + 报告写实；B：提升采样数后重采）。
2. ~~补计划文档的 checkbox~~ **已补**（Task 7 第 2 条）。
3. ~~Task 7 的复核三件事~~ **3/3 全过**（§4）。
4. ~~复核结论要诚实~~ **已写实**（§4.1 / §4.3）：门禁与滚动达标，三条绝对耗时线带着已定位的根因进发布，未粉饰。
5. **发布必须等用户明确下命令，别自己起念。** 这是当前**唯一**未完成项：
   `bash scripts/release.sh`（打 `v0.12.0` tag）→ `npm publish` → 合 `master`，
   三件各自都要单独授权，且**禁止合并 `master`** 的硬约束只在用户明确改口后才解除。
