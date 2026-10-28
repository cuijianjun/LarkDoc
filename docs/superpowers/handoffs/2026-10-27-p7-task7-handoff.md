# 交接：Task 7 开发已收尾 → 全量复跑全绿 + 仅剩打 tag（已授权）

> 这份文档是给**新会话**用的，贴进去就能直接接手，不需要再读计划全文或 `requirements/`。
> 上一份交接是 `docs/superpowers/handoffs/2026-10-27-p7-04-05.md`（HEAD `5e3bbe0` 时写的），
> **其内容已过期**：里面说 P7-04 未开工、`decorationsRebuildMs = 2.1`、基线失真 —— 这三条现在都不成立。
> 生成时间：2026-10-27 23:10，基线 HEAD `05c32f0`。
> **最近一次更新：2026-10-28**（8 条非阻塞项收口 + 版本号提到 `0.12.0` + P8 立项，见 §4.5 / §6.1.5~6.1.7 / §10）。

---

## 0. 一句话状态

**P7-01 ~ P7-06 的代码全部落地、已提交、已推 `origin/next/0.12`。** `Task 7`（集成复核 + 发布就绪）
的**开发部分已全部结束**：决策 A/B 已由用户拍板并执行（§3）；diff 干净度 ✓；
独立复核 ✓（1 条用户可见回归已修，见 §6.0）；8 条非阻塞项里 **#1/#2/#3/#4/#5/#6 全部已修、
#8 已复核，只剩 #7② 一条挂账**（§6.1）；开发收尾后按用户口径跑了两次全量复跑，两次均全绿
（§4.4 收口那次 1674 条、§4.5 非阻塞项收口后 1675 条）。
**剩下的只有发布，且只授权了一件事**：打 `v0.12.0` tag。`npm publish` 与合 `master` **仍未授权、
保持悬停**。

## 1. 仓库与状态

- 仓库根：`/Users/cjjxw/codex/tiptap-integration-demos/apps/lark-doc`（**不是** `apps/`，所有命令先 cd 进去）
- 分支：`next/0.12`，HEAD = 本提交（父 `82ea5fa docs(p7): 回填开发收尾后的全量复跑，并点明 artifacts:check 的指纹口径`）
  （`82ea5fa` 的父 `85e984f fix(p7): 水合目录加 ready 闸门 + IDB 连接收口 + 注释/报告写实`；
  `85e984f` 的父 `5655c17 docs(p7): 订正体积测量顺序备注，补 check:perf 之后复跑 size 的证据`；
  上一个功能提交是 `fa2226e fix(p7): widget 点击目标改读 getPos，并落地决策 A/B 结论`）
- 版本：`package.json` = `0.12.0`（**tail 从 `-beta.8` 提到正式版**，为打 tag 准备；产物指纹不含
  `version` 字段，故这次提升不影响 `artifacts:check` 判定）。**tag 已授权但尚未打**，未发布、未合 `master`
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
- [x] 重跑全部 P7 退出判据（现状见 §4.1）—— **已过两次**：P7 收口时一次（§4.3），
      §6.1 的 #2/#5/#6 修完之后的一次全量（§4.4，七项环节全绿）
- [x] 一次独立的 correctness/simplicity 复核（对着计划逐条挑）—— **已过**：8 条非阻塞 + 1 条阻塞，
      阻塞项已修并补了双向验证过的回归用例（见 §6.1）
- [ ] 只有复核通过且**用户明确授权**后，才走仓库发布脚本发 `v0.12.0`；不得提前发 beta 产物 —— **仍悬停**

### 4.1 退出判据现状（已按决策 A / B 重采后的口径更新）

| 判据 | 目标 | 实测（最新一轮，`85e984f`，见 §4.4） | 结论 |
| --- | ---: | ---: | --- |
| 装饰 `decorationIncrementalMs` | ≤ **150**（决策 A 改写） | **72.8**（决策 A 重采时 78.8） | ✓ 达标（但负担未消除，见 §6.1.4） |
| `keystrokeP95Ms` | ≤ 16 | **1054.5**（上一轮 939.7） | ✗ 差两个数量级 |
| `mountToTypeableMs` | ≤ 1500 | **36958**（上一轮 34692.3） | ✗ 差一个数量级以上 |
| `scrollFps` | ≥ 50 | **59** | ✓ |
| 存储事务语义 | 用例全绿 | `storage-idb` 通过 | ✓ |
| 回归套件 | `check:gate` EXIT=0 | **EXIT=0（71 文件 / 1674 用例全绿）** | ✓ 已复跑 |
| 体积预算（4 + 1） | 不涨 | ESM 279.35 / UMD 453.96 / Element 470.47 / CJS 2.46 MB / 协同 2.92 kB | ✓ 已复跑 |
| 性能门禁 | 无一指标退化 >20% | 7/7 ✓（见 §4.4） | ✓ 已复跑 |
| docs build | EXIT=0 | 原地构建被环境垫片拦，换 outDir 后 EXIT=0（`check:deploy` 在 `check:gate` 内 EXIT=0） | ⚠ 环境限制 |

### 4.3 全量复跑结果（2026-10-27T17:0x–17:14 UTC，HEAD `5ee6f10`）

| 环节 | 命令 | 结果 |
| --- | --- | --- |
| 单测 + lint + 主题 + 部署 + 架构 | `npm run check:gate` | **EXIT=0**，71 个测试文件 / **1664** 条用例全绿 |
| 五产物 + Vditor + 体积 | `npm run check:artifacts` | EXIT=0；`artifacts:check` 复验 EXIT=0（5/5 产物就绪） |
| 性能门禁 | `npm run check:perf` | EXIT=0 |
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

### 4.4 开发任务全部落地后的**唯一一次**全量复跑（2026-10-28T01:04–01:15Z，HEAD `85e984f`）

用户给的验收口径是「单测以及 build 等等，P7 完全开发完成后再执行，**中途不执行**」。所以
§4.3 那份是 P7 收口时的复跑，下面这份才是**开发全部结束（§6.1 的 #2/#5/#6 已修、#8 已复核）
之后**的全量 —— 七项环节一次跑完，全绿。

| 环节 | 命令 | 结果 |
| --- | --- | --- |
| 单测 + lint + 主题 + 部署 + 架构 | `npm run check:gate` | **EXIT=0**（5m52s）；71 个测试文件 / **1674** 条用例全绿（较 §4.3 的 1664 多 10 条，即本轮新增用例） |
| 五产物 + Vditor + 体积 | `npm run check:artifacts` | **EXIT=0**（3m11s）；5/5 产物就绪，Vditor 93 项通过 |
| 性能门禁 | `npm run check:perf` | **EXIT=0**（2m19s）；7 项指标无一退化 >20% |
| 产物指纹复验 | `npm run artifacts:check` | **EXIT=0**（`✓ 构建输入未变`，指纹 `886d02cd`）—— 口径坑见 §4.4.1 |
| 性能门禁复验 | `node scripts/perf/report.mjs` | EXIT=0（⚠️ **不是** `gate.mjs`，见下方订正） |
| 体积复验 | `npm run size`（跑在 `check:perf` **之后**） | EXIT=0；五项与 `check:artifacts` 逐项一致 |
| 本地块契约（**非 CI 环节**） | `npm run contract:check` | EXIT=0（42 个块，契约最新） |

`check:perf` 实测（`01:15:35Z` 采集，**没有** `--update`，基线仍是 `15:45:16Z` 那一份）：

| 指标 | 基线 | 本次 | Δ | 判定 |
| --- | ---: | ---: | ---: | --- |
| `mountToTypeableMs` | 38810.1 | 36958 | −5% | ✓ |
| `keystrokeP95Ms` | 939.7 | 1054.5 | **+12%** | ✓（门禁只管「不退化 >20%」） |
| `keystrokeP99Ms` | 2372.1 | 2428.2 | +2% | ✓ |
| `decorationIncrementalMs` | 78.8 | 72.8 | −8% | ✓ |
| `scrollFps` | 59.3 | 59 | −1% | ✓ |
| `saveProxyMs` | 24.6 | 22.6 | −8% | ✓ |
| `heapMB` | 107.8 | 107.8 | 0% | ✓ |

体积：ESM **279.35** / UMD **453.96** / Element **470.47** / CJS **2.46 MB** / 协同 **2.92 kB**
（§4.3 是 279.24 / 453.82 / 470.34；各 +0.03% 量级，来自本轮改的 4 个源文件，预算内）。
`keystrokeP95Ms` 的 +12% 属噪声区间 —— 它是绝对耗时线，本轮没碰热路径代码（只加了注释、
一个 data 标志、一个 `if` 守卫和两个 `close()`），且同一指标上一轮是 −13%。

#### 4.4.1 一个「红灯」的自我纠正：`artifacts:check` 的**调用口径**（不是产物坏了）

复验时先跑的是 `node scripts/ensure-artifacts.mjs --check`（绕过 npm），拿到：

> `✗ 需要重建产物：源码/依赖/构建配置有变动（当前指纹 b1ab5e807280565da2b34f1b28e6f6d624734fe9）`

我一开始归因为「`check:perf` 里 `build:element` 重写 `dist` 导致 mtime 指纹漂移」，
**这个归因是错的**，得纠正过来：

- stamp 里的指纹是 `886d02cd`，写于 `01:12:45Z`（即 `check:artifacts` 那次，**早于** `check:perf`）。
- 用 `npm run artifacts:check` 复验，算出的当前指纹**同样是 `886d02cd`** —— 与 `check:perf`
  之前写下的值逐字节相同，证明 `src/**` 与构建配置的 size/mtime 在这两次之间**根本没动过**。
  指纹输入里也不含 `dist/`，`build:element` 重写 `dist` 动不了它。
- 真正的差异项是脚本第 4 项指纹输入：`npm_config_user_agent`（`ensure-artifacts.mjs:79`）。
  裸 `node` 调用时该变量为空，算出的指纹是 `b1ab5e80`；经 `npm run` 调用时非空，是 `886d02cd`。
  实测对照：`env -u npm_config_user_agent node scripts/ensure-artifacts.mjs --check` →
  `b1ab5e80`（EXIT=1）；`npm run artifacts:check` → `886d02cd`（EXIT=0）。**两个指纹只差这一项。**

顺手收口（只加提示，不改判定）：`--check` 分支在用户代理为空时多打一行
「本次未经 npm 调用，指纹与 npm 口径不同；复验请用 `npm run artifacts:check`」。判定仍保持保守
（不同就 EXIT=1，不去猜），但不再把人引去白跑那 3 分钟的重建。改后两种口径复验：
`npm run artifacts:check` EXIT=0 / 裸 `node` EXIT=1 且带提示。`scripts/` 不进指纹，故无需重建产物。

**与 §4.3 里那条「顺序依赖」的关系**：那是另一件事且仍然成立 —— `npm run size` 只读 `dist/`、
不带构建，所以换机器或换构建参数时体积凭据要取 `check:perf` **之后**的 `size`。但本次的
EXIT=1 与它无关，纯粹是**怎么调脚本**的问题。

#### 4.4.2 订正：`node scripts/perf/gate.mjs` **不是**门禁命令

上一版这张表里我把「性能门禁复验」写成 `node scripts/perf/gate.mjs` → EXIT=0，**这是错的**：
`gate.mjs` 是**纯函数模块**（只 `export` `compareMetrics` / `renderTable` 等，第 1-9 行注释写明
「无 IO」「文件读写与进程退出码留在 report.mjs」），**没有 CLI 入口**。`node scripts/perf/gate.mjs`
什么也不做、也不输出，退出码恒为 0 —— 它通过**不能证明任何事**，是个假绿灯。

真正的门禁 CLI 是：

```bash
node scripts/perf/report.mjs            # 读 perf/.perf-result.json 比 perf/baseline.json
                                        # 退出码 0 通过 / 1 有指标退化 >20% / 2 不可比
```

`npm run check:perf` = `build:element` + `measure.mjs` + `report.mjs`，所以它本身就是完整门禁；
单独复验判定结果用上面这条，别用 `gate.mjs`。

### 4.5 非阻塞项收口后的**第二次**全量复跑（2026-10-28T02:04–03:25Z，HEAD `82ea5fa` + 本轮未提交改动）

本轮又动了 3 个源文件（§6.1.5~6.1.7 的 #1/#3/#4）、2 个测试、`package.json` 的版本号 ——
所以 §4.4 那句「全量已过」按自己的规矩作废，重跑一遍。**七个环节全绿。**

| 环节 | 命令 | 结果 |
| --- | --- | --- |
| 单测（改动后先单跑一次） | `./node_modules/.bin/vitest run` | **EXIT=0**（5m23s）；71 个文件 / **1675** 条（§4.4 是 1674：删 1 旧 + 加 2 新） |
| 五产物 + Vditor + 体积 | `npm run check:artifacts` | **EXIT=0**（22m39s，机时异常见 §4.5.1）；5/5 产物就绪、Vditor 93 项通过 |
| lint | `npm run lint` | EXIT=0（`eslint --ext .js,.vue src scripts`） |
| 单测 + lint + 主题 + 部署 + 架构 | `npm run check:gate` | **EXIT=0**（6m10s）；主题对比度 70 组 / 通过 68 / 豁免 2 / 失败 0 |
| 性能门禁**判定** | `node scripts/perf/report.mjs` | **EXIT=0**，7/7 ✓（⚠️ 不是 `gate.mjs`，见 §4.4.2） |
| 产物指纹复验 | `npm run artifacts:check` | **EXIT=0**，指纹 **`de3aa548`**（`src/` 变了，指纹随之变，属预期） |
| 体积复验（在构建之后） | `npm run size` | **EXIT=0**；279.41 / 454.02 / 470.55 / 2.46 MB / 2.92 kB，与 `check:artifacts` 逐项一致 |

正式那一份性能采集（`03:23:32Z` 起采，`vm.loadavg` 1 分钟值 **5.95**，bundle 为 `03:12` 构建）：

| 指标 | 基线 | 本次 | Δ | 判定 |
| --- | ---: | ---: | ---: | --- |
| `mountToTypeableMs` | 38810.1 | 39929.9 | +3% | ✓ |
| `keystrokeP95Ms` | 939.7 | 1013.6 | +8% | ✓ |
| `keystrokeP99Ms` | 2372.1 | 2751.8 | +16% | ✓ |
| `decorationIncrementalMs` | 78.8 | 85 | +8% | ✓ |
| `scrollFps` | 59.3 | 56 | −6% | ✓ |
| `saveProxyMs` | 24.6 | 28.5 | +16% | ✓ |
| `heapMB` | 107.8 | 107.9 | 0% | ✓ |

体积相对 §4.4 的 279.35 / 453.96 / 470.34 各 +0.06 kB / +0.06 kB / +0.21 kB，预算内。

#### 4.5.1 一次「假红灯」的完整归因：**我自己的孤儿 headless Chromium**

这是本轮最该记住的一课 —— 它差点让 4 项指标被写成「退化」，而根因在我自己留下的进程。

时间线（全部是同一份 bundle）：

1. 第一轮 `npm run check:perf`：`keystrokeP95` **+42%** / `P99` **+103%**，其余 ✓；
2. 同 bundle 连测 3 次：P95 = 1168 / 1129.7 / 2103.9 —— **噪声 1.86×**，远超 20% 的判定阈；
3. 再测 2 次：1334.8 / 1283.9。5 次没有一次接近基线 939.7；
4. `pgrep -f playwright_chromiumdev_profile` → **3 个孤儿 headless Chromium**（前几轮被中断的 run
   留下的），各自带着 2000 块文档持续吃 CPU。同期 `vm.loadavg` 1 分钟值在 9~39（本机 16 核），
   `check:artifacts` 也从 3m11s 涨到 **22m39s**；
5. 全部 `kill -9`、等 1 分钟值回落 → 同 bundle 立刻回到 **899.8 ms（−4%）**；
6. 清干净后连测 3 次，**七项每次都过**（P95 = 931.3 / 957.1 / 1026）。

`measure.mjs:314-316` 的 `finally` 里确实有 `await browser.close()`，但**被 kill / 超时的 run
不会执行 finally**，孤儿就此留下，而且会**叠加**：新 run 被上一个拖慢，数字一轮比一轮差。
所以跑性能前的第一步固定检查（已写进 §7）：`pgrep -f playwright_chromiumdev_profile`，
不是 0 就清；清完还要等 `vm.loadavg` 的 1 分钟值降下来（它有滞后）。

#### 4.5.2 还没解的方法论问题：`check:perf` 把「构建」和「采集」串在同一个窗口里

`npm run check:perf` = `build:element && measure.mjs && report.mjs`。构建（vue-cli 16 worker）
跑完 CPU 还在尾流上，`measure` 紧跟着开始 → 采到的是**热机状态**。本轮实测对比：

| 跑法 | load 起 → 止 | `keystrokeP95` | 结果 |
| --- | --- | ---: | --- |
| `npm run check:perf`（构建＋采集连跑） | 7.38 → **15.78** | 1249（+33%） | **4 项红** |
| `measure` 单独跑（bundle 已构建、负载落定） | 5.95 → — | 1013.6（+8%） | **7 项全绿** |

**同一份源码、同一个 bundle，差别只在「测量前有没有等构建的尾流散掉」。** 这不是代码问题，
是采集口径问题。本轮**不动 `scripts/`**（属门禁自身，改动要单独立项并重采基线），只把结论写下来：

- 日常判定用 `node scripts/perf/report.mjs`（只比对、不构建）配**已构建好的** bundle；
- 想让 `check:perf` 一次跑绿，需要「构建后等负载回落」这一步 —— 建议后续给 `check:perf` 加
  `--wait-load`，或把 build 与 measure 拆成两个 CI step 并留冷却时间；
- 无论哪种，**基线（`perf/baseline.json`，`15:45:16Z` 那份）绝不要在本机负载高时用 `--update` 覆盖**。

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
- **发布三件里只授权了一件**（2026-10-28 用户拍板）：**可以**打 `v0.12.0` tag；
  **仍不允许** `npm publish`、**仍不允许**合 `master`。别把「打 tag」当成「发布」的通行证。
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

### 6.1 Task 7 独立复核的 8 条非阻塞项（**#1/#2/#3/#4/#5/#6 已修，#8 已复核；仅 #7② 仍挂账**）

都不是 P7 引入、也不阻塞发布，但别让它们随会话消失。逐条：

| # | 位置 | 问题 | 状态 |
| --- | --- | --- | --- |
| 1 | `src/core/storage/idb.js:236-241` | 一条坏记录会把整份数据判成 `CORRUPT`，且**没有自愈路径**（不像单条失败可以跳过重试）。需要决定是「坏记录丢弃 + 其余照常恢复」还是维持整份失败 | **已修（判「坏记录丢弃」，见 6.1.5）** |
| 2 | `src/components/lark-doc/LarkDocWorkspace.vue:667-671` | 水合出来的目录在 `setContent` **之前**就可点，点了会作用在无内容的编辑器上。加个 ready 门闩即可 | **已修（见 6.1.1）** |
| 3 | `src/core/pacing.js:98-117` | 四个成员**没有任何调用点**（导出后无人用）。要么删，要么补用例说明为什么留着 | **已修（删无调用点成员，见 6.1.6）** |
| 4 | `src/core/derive/snapshot.js:120-129` | 两个字段**只有测试在读**，生产代码不用。同上，删或说明 | **已修（删两个导出，见 6.1.7）** |
| 5 | `src/core/storage/idb.js:106-108`、`providers/persistence.js:104` | `open` 超时路径下 `request` 未 `close`，请求仍在跑。资源泄漏，量级小 | **已修（见 6.1.2）** |
| 6 | `src/core/derive/index.js:46-50` | 英文注释措辞**夸大**（把「减少全量扫描」写成「消除」）。改注释即可 | **已修（见 6.1.3）** |
| 7 | 同上复核中「推测未实跑」的两条 | 复核子代理自陈：① 阻塞项触发链当时未在浏览器里实跑复现、② 多步事务退回全量是在 `/tmp` 最小 schema 上跑的。**① 已由本会话用回归用例实跑验证（见 §6.0）**，② 仍只是最小 schema 证据 | 挂账（② 仍需实测） |
| 8 | `src/core/documentOperations.js` | 子代理**未逐行复核**（文件过大）。`collectFoldRanges` / `computeHeadingNumbers` 两处被 P7 报告点名是热路径结构性成本，值得单开一轮、只审这两处 | **已复核（见 6.1.4）** |

#### 6.1.1 #2 水合目录在 `setContent` 前可点 —— 已修

根因：`LarkDocWorkspace.onReady` / `restoreSnapshot` 先 `hydrateOutline(...)` 再 `setContent(...)`，
水合期目录里的 `pos` 指向「正文还没灌进去的编辑器」，按下去轻则选区落到文末，重则
`domAtPos` 抛 `RangeError`。

收口成一道闸门（四个面）：

- `viewModesMixin.js` 新增 `data.outlinePending`（默认 `false`）；`hydrateOutline()` 末尾置 `true`；
- `jumpHeading(pos)` 开头双守卫：`outlinePending` 为真、或 `pos` 不是 `[0, doc.content.size)`
  内的整数，都直接 `return`；
- `OutlinePanel.vue` 的跳转按钮 `:disabled="ed.outlinePending"`，并给 `title` 提示文案；
- `LarkDocEditor.refreshDocumentState()` 用实测目录覆盖 `outline` 的**同一刻**置 `false` ——
  闸门只在水合期存在，正文一到位就落下。

回归用例加在 `test/unit/derived-hydration.test.js`（原 5 条 → 现 9 条）：闸门置位、
覆盖后落下、`jumpHeading` 在 `outlinePending` / 越界 / 无 editor 时都不动作。

#### 6.1.2 #5 `open` 超时 / 换腿未 `close` —— 已修

两处，同一个病根：**丢下不管的连接会一直占着 IndexedDB 的版本锁**，别的标签页要升级就被
`blocked`。

- `idb.js`：`openIndexedDbDatabase` 的三出口只认第一个 `settled`。超时先 `reject` 之后，
  迟到的 `onsuccess` 只被 `settled` 拦住、**连接没关**。现在 `onsuccess` 里
  `if (settled) { closeDatabase(request.result); return }`。`closeDatabase` 收口了
  「重复 `close()` 抛 `InvalidStateError`」这件事（重复关不关第二次）。
- `persistence.js`：`degradeBecause` 换腿（IndexedDB → localStorage → 内存）前先
  `state.leg.close()` —— 自己已经不写 IndexedDB 了，不该还挡着别人。

回归用例加在 `test/unit/storage-idb.test.js`：超时后迟到的 `onsuccess` 必须调用 `close`；
慢但成功的打开**不能**被误关（既有用例「慢一点但成功的打开不会被超时误杀」保住）。

#### 6.1.3 #6 注释措辞夸大 —— 已修

`src/core/derive/index.js` 里 `expandBlockRange` 的英文 JSDoc 原文把「局部重扫够用」写成了
「与全量扫描等价」（`keep the same boundary semantics as a full scan`），而实际只是
「多扩一层父块、让窗口覆盖到边界可能变化的范围」，并不等价。已改为准确表述：
局部扩张**只为不漏边界**，不承诺与全量扫描同结果。

> 记一笔：§6.1 原表写的措辞是「把『减少全量扫描』写成『消除』」，但当前文件里并无
> `eliminat` / `消除` / `全量扫描` 字样 —— 那处措辞在此前的提交里已漂移，实际夸大的是
> 上面这句 `as a full scan`。行号仍在 46-50，位置没变。

#### 6.1.4 #8 `documentOperations.js` 热路径逐行复核 —— 已复核，**结论：不动代码**

复核范围：`collectFoldRanges`、`computeHeadingNumbers`、`computeOrderedListNumbers`、
`computeBulletItems`、`collectOutline`、`walkBlocks`、`scanSectionSiblings`、`foldRangeOf`、
`foldableIdPositions`，以及调用侧 `document-decorations.js:collectDocumentDecorations` /
`updateDocumentDecorations`。

**逐行结论：没有逻辑缺陷。** 三处此前已做对的优化值得留在注释里：

1. `foldRanges` 的 `{from,to,node}` 在「折叠隐藏」循环里**复用同一份**，没有二次
   `foldedRange` / `nodeAt`；
2. `computeOrderedListNumbers` 顺带给出 `firstChildIsParagraph`，让标记侧免掉 946 次
   `doc.nodeAt(pos)`（这是最贵的一笔随机访问）；
3. `foldableIdPositions` 只在 `storage.folded.size > 0` 时才跑（`folded` 为空是常态）。

**但 P7 报告里那句归因不准确，已实测证伪（部分）**：`perf/report.md` 写「有两趟是
**无条件全量遍历**」，实际是 **4 趟**（漏了 `computeOrderedListNumbers` 与
`computeBulletItems`），另加 `findTextMatches` 与一次 `previous.find(0, content.size)`。

用 `scripts/perf/build-doc.mjs` 的**同一份 2,000 块 fixture**（seed 42，jsdom 解析成真实
ProseMirror doc，`decorations=1424` / 可折叠块 `478`）在 Node 侧分项实测（11 次取中位数）：

| 分项 | 实测 |
| --- | --- |
| 冷路径全量重建 | 21.48 ms |
| `previous.map` | 0.09 ms |
| `extendHeadingRange` + `mergeRanges` | 0.01 ms |
| **`collectFoldRanges`** | **1.51 ms** |
| **`computeHeadingNumbers`** | **0.51 ms** |
| **`computeOrderedListNumbers`** | **0.60 ms** |
| **`computeBulletItems`** | **0.64 ms** |
| `findTextMatches(窗口)` | 0.00 ms |
| `foldableIdPositions` | 1.15 ms |
| `find(窗口)` / `find(0..size)` 悬停趟 | 0.03 / 0.09 ms |
| `collectDocumentDecorations(窗口)` | 3.06 ms |
| **map + `updateDocumentDecorations` 端到端** | **3.77 ms** |

窗口大小敏感性（同一 fixture，改脏区窗口宽度看端到端）：

| 窗口宽度（字符） | 端到端 |
| --- | --- |
| 60 | 5.73 ms |
| 300 | 4.36 ms |
| 1,000 | 3.38 ms |
| 5,000 | 4.30 ms |
| 20,000 | 6.00 ms |
| **整篇（132,171）** | **25.63 ms** |

**结论：4 趟遍历在 Node 侧占端到端 86%，但解释不了浏览器探针的 78.8 ms。** 本轮全量复跑
（2026-10-28T01:14Z）`check:perf` 给的浏览器实测是 p50 **72.85** / p95 78.94 / max 83.50，
20 次增量、0 次退回全量 —— 也就是说这个数**在 Chromium 里稳定复现**；而同一份 fixture、
同一段代码在 Node 里只有 3.8 ms（小窗口）到 25.6 ms（整篇窗口），**窗口放大也补不上这
19× 的差**。差在哪一侧没有分项证据：要么浏览器里这几段被别的因素放大（真实 view 的
`DecorationSet`、视图侧装配），要么 Node 侧 V8 走了不同的优化路径。

因此本文能负责的表述只有两句：
① 报告里「两趟」应订正为「四趟」（可断言）；
② **78.8 / 72.8 的构成未做过逐段归因**，`≤ 150 ms` 只是拿它当锚的退化门禁线，不是
「由这四趟遍历构成」的实测结论（不可断言）。

**建议（都属文档修正，不改代码）：**

1. `perf/report.md` 的「两趟」改成「四趟」并列出函数名 —— 否则后续按「把这两趟挪进窗口
   剪裁」去做，会漏掉一半工作量；
2. 78.8 ms 那句补一句限定：「构成未逐段归因；Node 侧同 fixture 的 4 趟遍历合计 3.26 ms、
   整篇窗口端到端 25.6 ms，都解释不了这个量级」；
3. **不要**为了这个数动代码：把编号/折叠纳入窗口剪裁需要「前缀计数器」和「结构预扫索引」，
   属新工作量、非零风险；且决策 A 已判定「不为不可达的 `≤ 4 ms` 烧工作量」。真正该盯的是
   `keystrokeP95Ms`（939.7），它的出路在 P7-05 挂载策略，不在装饰层 —— 报告里已有这条
   反面证据（整段 dispatch 195.9 ms，装饰只占约 40%）。

#### 6.1.5 #1 快照读闸门：判「单条坏记录丢弃」，并顺手自愈

**产品决策**（本会话拍板）：快照是**可再生的历史副本**，一条坏记录不该把用户其余几十条
历史一起废掉；而**草稿（draft）是唯一副本**，读不回来就是数据丢失，必须整份报错、绝不能
「安静地给一份少了东西的文档」。所以两条路径故意取相反的取舍。

`src/core/storage/idb.js` 相应改动：

- 删掉原 `assertSnapshots(list)`（一条不合规就整份 `SNAPSHOT_CORRUPT_ERROR`），换成
  `pickValidSnapshots(list)`：逐条过 `isValidDocumentRecord` + `typeof item.id === 'string'`，
  合规的进 `valid`，不合规但有 id 的记进 `corruptIds`。**只有「读回来的根本不是数组」才整份失败**
  —— 那说明库/游标层面已经坏了，不是单条的问题。
- 新增 `purgeCorruptSnapshots(db, ids)`：一次 `readwrite` 事务把坏 id 直接 `delete` 掉，
  外面套 `try/catch` 忽略失败（清理失败不该影响本次恢复结果）。这就是原表里说的
  「没有自愈路径」——现在有了：坏记录读一次就被清掉，不会每次都拖慢/污染列表。
- `readSnapshots()` 改为 `const { list, corruptIds } = pickValidSnapshots(box.rows || [])` →
  `await purgeCorruptSnapshots(db, corruptIds)` → 返回 `list`（仍是 `sortSnapshots` 后的顺序）。
- `snapshot()` 的注释同步改成「单条坏记录在 `readSnapshots` 里已被过滤并按 id 清掉」。
- `load()`（草稿）**保持整份失败**，并在注释里写明理由，避免后来人「统一一下」把这里也改成丢弃。

回归用例（`test/unit/storage-idb.test.js`，删 1 加 2，净 +1 —— 全量用例数 1674 → **1675**）：

- 旧用例「损坏的快照集合读不回来」删除（行为已变）；
- 新增「单条坏快照只丢这一条，其余照常恢复，并把坏记录清掉」——两条好记录 + 一条
  `json.type='script'` 的裸记录（用 `putRawSnapshot` 绕过校验直接塞），断言 `snapshots()`
  只回两条好的、`fake.keysOf(...)` 里坏 id 已消失（自愈）、且之后还能正常新建快照；
- 新增「按 id 取到一条坏快照时仍然报损坏，不把它当正文恢复」—— 即**列表里丢弃 ≠ 单条读取
  时也丢弃**：用户明确点了这一条，就不能拿半截正文糊弄。

#### 6.1.6 #3 `pacing.js` 删掉无调用点的成员

先确认「真的没人用」，不是「我没找到」：

- `createFrameBatcher` 的 `has(key)` / `cancel(key)`：`git grep` 全仓零调用；
  唯一使用方 `selectionPacingMixin.js` 只碰 `schedule` / `dispose`；`viewModesMixin.flushSearchUpdate`
  路径与测试用的是 `flush`。
- `createTrailingDebounce` 的 `pending()` / `get delay()` / `get disposed`：同样零调用。
  注意 `createFrameBatcher` 的 `pending()` 和 `disposed` **是有人在读的**（
  `test/unit/perf-scheduling.test.js` 用 `batcher.pending()`、`batcher.disposed`），所以只删
  debounce 侧那两个 getter，两个工厂的形态有意不对称——别为了「对称」把 batcher 的也删了。

改完的公开面：

- `createFrameBatcher` → `{ schedule, pending, flush, dispose, disposed }`；
- `createTrailingDebounce` → `{ schedule, flush, cancel, dispose }`。

`flush()` 的 JSDoc 保留（`viewModesMixin` 的搜索路径仍要它）。

#### 6.1.7 #4 `snapshot.js` 删掉只有测试在用的两个导出

`documentBlockCount(json)` / `documentFingerprint(json)` 在生产代码零引用（`git grep` 只剩
测试的 import），本质是 `documentMetrics(json)` 的单字段取值函数。已删掉这两个导出，
`test/unit/derived-snapshot.test.js` 改为直接读 `documentMetrics(x).blockCount` /
`.fingerprint` / 对空值断言 `toBeNull()`，断言覆盖范围不变、少两个中间层。

> 这一条和 6.1.6 的做法一致：**「只有测试在用」不是留着的理由**。留着等于给生产 API 加
> 一个永不使用的表面，后来人会以为有调用方而不敢删。

## 7. 环境坑（这个 shell 特有的）

- 🔴 **跑性能前必须先查遗留的 headless Chromium**（2026-10-28 踩到，代价是 5 次假退化）：

  ```bash
  pgrep -f playwright_chromiumdev_profile | wc -l   # 不是 0 就先清干净再测
  pgrep -f playwright_chromiumdev_profile | xargs kill -9
  sysctl -n vm.loadavg                              # macOS 没有 loadavg 命令，用这个
  ```

  `measure.mjs:314-316` 的 `finally` 里其实有 `await browser.close()`，但**被 kill / 超时的 run
  会留下孤儿浏览器**（user-data-dir 在 `/var/folders/.../playwright_chromiumdev_profile-*`），
  它带着 2000 块文档持续吃 CPU，把后续每一次采集都抬高——而且是**逐轮叠加**的（每次新 run 又被
  前一个拖慢）。本轮实测：清之前 5 连测里 `keystrokeP95Ms` 一路 +20%…+124%；清掉 3 个孤儿浏览器后
  同一个 bundle 立刻回到 **899.8 ms（−4%）**。清完还要等 `vm.loadavg` 的 1 分钟值降下来（它有滞后）。
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
- **`node scripts/ensure-artifacts.mjs --check` ≠ `npm run artifacts:check`**：指纹第 4 项输入是
  `npm_config_user_agent`，裸 `node` 调用时它是空串 → 算出的指纹必然不同 → 假报
  「源码/依赖/构建配置有变动」。复验产物一律走 `npm run artifacts:check`（详见 §4.4.1）。

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
5. **发布必须等用户明确下命令，别自己起念。** 当前只剩三件，且**只授权了第一件**（2026-10-28 拍板）：
   ① 打 `v0.12.0` tag —— **已授权**；② `npm publish` —— **未授权**；③ 合 `master` —— **未授权**。
   三件各自都要单独授权，**禁止合并 `master`** 的硬约束只在用户明确改口后才解除。
   另注意 `scripts/release.sh` 的两个坑：`--skip-publish` 仍会自己 `git add -u`（与「禁 `git add -A`、
   必须按 pathspec 提交」冲突），且 `git_ship()` 推送**不带 IPv4 参数**。所以本轮不打脚本，手工两步：
   `git tag -a v0.12.0 -m "v0.12.0"` + `git -c core.sshCommand="ssh -4" push origin v0.12.0`。
6. ~~开发结束后的全量测试~~ **已执行两次**：§4.4（HEAD `85e984f`，1674 条）与 §4.5
   （非阻塞项收口后，1675 条），两次七项环节全绿。此后**不要**再动 `src/`，否则「全量已过」这句话就作废。
7. **P8 已立项**（`mountToTypeableMs` 是 24.6× 未达标的那条线），入口见 §10。P8 **不推翻** P7-05 的
   「不窗口化」结论，且必须先做 Phase 0 归因再动手 —— P7 已经因为「把推测当结论」返工过一次。

## 10. 下一步：P8（挂载性能）已立项，别在 P7 里继续磨

三条绝对耗时线里，`keystrokeP95Ms` 与 `decorationIncrementalMs` 本轮按用户拍板「接受现状」
（前者出路在挂载策略、后者未做逐段归因，都不该在装饰层硬凑）；真正还剩一个大缺口是
**`mountToTypeableMs`：36,958 ms vs target ≤ 1,500 ms = 24.6 倍**。

立项文档：**`docs/superpowers/handoffs/2026-10-28-p8-mount-kickoff.md`**（9 节，可直接开工）。要点：

- **不推翻 P7-05**：窗口化仍是不做（滚动 60.3 FPS 已达标、`content-visibility` 治绘制不治建 DOM、
  会打穿折叠子树/全文档查找/完整 outline/全文导出四条契约）。
- **Phase 0 归因先行**（P8-01）：先回答「36.9 s 里 DOM 创建 / 排版 / 装饰 / 水合各占多少」，
  再决定方案。候选首选是「分段渐进灌入」（A），而 B/C/D 三个候选在文档里已给出「不做」的理由。
- **验收**：`mountToTypeableMs ≤ 1500`、1,675 条用例零回退、三门禁 EXIT=0；风险用 feature flag 兜。

一句话：**P7 到此为止（除打 tag），别再往装饰层加工作量。**
