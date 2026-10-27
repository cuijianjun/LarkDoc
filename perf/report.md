# 性能报告（P7 收口）

> 本文件由真实采集结果整理，**不接受手填数字**。原始数据见 `perf/.perf-result.json`（本次）与
> `perf/baseline.json`（门禁基线，已推进到 10-27）、`perf/baseline-pre-p7.json`（P7 之前，存档）。
> 重新采集后请连同本文件一起更新。

## 采集口径

| 项 | 值 |
| --- | --- |
| 采集命令 | `npm run check:perf`（= `build:element` → `node scripts/perf/measure.mjs` → `node scripts/perf/report.mjs`） |
| 工作负载 | `PERF_SEED=42`、`PERF_BLOCKS=2000`（`scripts/perf/build-doc.mjs` 确定性生成） |
| 运行器 | darwin / x64、Node v22.22.2、headless Chromium（element UMD 产物 + 静态宿主页） |
| 采集时间 | 2026-10-27T15:44Z（= 本地 23:44+0800；决策 B 重采：击键样本 8 → 30、分位数改线性插值；**本次没有改任何产品代码**） |
| 采样数 | 击键 **30** 次、装饰增量 20 次、保存 10 次、滚动 3 轮取中位数（首轮预热丢弃） |
| 对照基线 | 上一版基线 2026-10-27T14:43Z（8 样本 / 旧分位口径，见 git 历史）；P7 之前 2026-10-24T10:08:21Z，备份在 `perf/baseline-pre-p7.json` |

性能数字是**机器相关**的：换机器、换架构、换 seed 或块数都不可比。`report.mjs` 会在
seed/块数不一致时直接以退出码 2 拒绝判定，而不是给一个看起来很像的结论。

**本文件所有时间戳一律用 UTC**（与 `baseline.json` 的 `_meta.capturedAt` 同口径）。
本机时区是 UTC+8，命令行里看到的 `date` 比这里早 8 小时，别直接抄上去。

## 决策 B：采样口径修好了，`keystrokeP95Ms` 才第一次是真 p95

**这轮改的不是产品代码，是尺子本身。** `scripts/perf/measure.mjs` 里两处统计口径有缺陷：

1. **击键采样数 8 次**（`BLOCKS >= 1500 ? 8 : 30`，从初版 `b7619e9` 就在）。
2. **`percentile` 取 `sorted[Math.round(p * n) - 1]`** —— n=8、p=0.95 时下标恒为 7，
   n=8、p=0.99 时下标同样是 7。**也就是说 p95 和 p99 都等于「8 次里最差的那一次」。**

证据就在旧基线里：`baseline-pre-p7.json` 的 `keystrokeP95Ms` 与 `keystrokeP99Ms` **同为 37297.2**，
上一版基线同样同为 `2578`。两个不同概率的分位数写成一模一样的数，本身就说明字段没有区分度。

改法：采样数统一提到 30（可用 `PERF_KEYSTROKE_SAMPLES` 覆盖），`percentile` 改成
**线性插值**（秩 `p * (n - 1)`，与 numpy 默认口径一致），并把这两个纯函数抽到
`scripts/perf/stats.mjs`，由 `test/unit/perf-stats.test.js`（14 条）钉住 ——
`measure.mjs` 在模块顶层就 `main()` 起浏览器，用例没法 import 它，所以必须抽出来。
用例里直接把旧实现的结果写成了对照断言（「8 样本下 p95 === p99」），退回去会变红。

**效果（同负载下连续两轮，中间没有改任何代码）：**

| 指标 | 第 1 轮 | 第 2 轮 | 相对差 |
| --- | ---: | ---: | ---: |
| `keystrokeP95Ms` | 1062.6 | 939.7 | **−11.6%** |
| `keystrokeP99Ms` | 2582.7 | 2372.1 | −8.2% |
| `mountToTypeableMs` | 39667.1 | 38810.1 | −2.2% |
| `decorationIncrementalMs` | 78.4 | 78.8 | +0.5% |
| `scrollFps` | 59.0 | 59.3 | +0.5% |
| `saveProxyMs` | 24.7 | 24.6 | −0.4% |

对比改动之前同一份 `dist` 连采三次的 **2.65 倍极差**（2578.0 / 4343.9 / 6837.7），
抖动降到了 10% 上下。**注意 `keystrokeP99Ms` 仍在 2400 上下、`keystrokeP95Ms` 在 1000 上下** ——
长尾没有被消灭，只是不再被当成 p95 报出来。

**由此产生一条硬约束：`keystrokeP95Ms` 的历史数字不可跨口径比较。**
P7 前的 37297.2 与上一版的 2578.0 都是「8 次里最差一次」，本轮的 939.7 才是真插值 p95。
所以**「37297 → 939.7，−97%」这个说法是假的**，它跨越了两次口径变更；本轮真正能说的只有
「新口径下击键 p95 约 0.9~1.1 s、p99 约 2.4 s」。下面对照表里这两列因此标了 `⚠ 口径中断`。

**机器负载仍然是外生扰动**：本轮采集时 load average 7.5 / 7.0 / 6.4，机器 22 天未重启
（上一次 `pmset -g therm` 显示 `CPU_Speed_Limit = 100`、无降频警告，抖动来自别的进程抢 CPU）。
10% 这个量级里有多少是噪声、有多少是真实波动，仍然要在空闲机器上再采一次才能分开。
**跨量级的变化才有意义，十几个百分点不要拿来下结论。**

## 结果

| 指标 | P7 前（10-24 基线） | 上一版（10-27 14:43Z） | 本次（10-27 15:44Z） | 退出目标 | 判定 |
| --- | ---: | ---: | ---: | ---: | --- |
| `mountToTypeableMs` 首屏可输入 | 59849.7 | 36666.8 | 38810.1 | ≤ 1500 | ✗ 未达标（见下） |
| `keystrokeP95Ms` 击键 → 下一帧 | 37297.2 ⚠ | 2578.0 ⚠ | 939.7 | ≤ 16 | ✗ 未达标（见下） |
| `keystrokeP99Ms` | 37297.2 ⚠ | 2578.0 ⚠ | 2372.1 | — | — |
| `decorationIncrementalMs` 击键路径装饰增量 | —（旧口径 `decorationsRebuildMs` 21186.3，**不可换算**） | 72.6 | 78.8 | **≤ 150（判据已改写）** | ✓ 达标（见决策 A） |
| `scrollFps` 稳态滚动帧率 | 3.7 | 60.3 | 59.3 | ≥ 50 | ✓ |
| `saveProxyMs` 全篇 JSON 序列化 | 24 | 21.6 | 24.6 | — | ✓（噪声内） |
| `heapMB` 2,000 块静置堆占用 | 105.6 | 107.9 | 107.8 | — | ✓（噪声内） |

⚠ = 该数字是**「8 次里最差一次」**，不是真 p95/p99（见上一节），与本次的插值分位数**不可比较**。
本表因此**不再提供 Δ vs P7 前这一列**：37297.2 → 939.7 跨越了两次口径变更，写成「−97%」是假结论。
能安全比较的只有同口径内部：本次与上一版都在 2,000 块 / seed 42 下采集，代码零改动。

退出目标取自 `docs/superpowers/plans/2026-10-27-p7-performance-closure.md` 的 Task 7 验收条件，
其中 `decorationIncrementalMs` 一条已按决策 A 改写（原 `≤ 4 ms`）。
**门禁（全部 ≤20% 退化，`check:perf` EXIT=0）与滚动帧率达标**；`mountToTypeableMs` /
`keystrokeP95Ms` 两条绝对线仍未达标，`decorationIncrementalMs` 在新判据下达标。

再往前还有一轮 13:40Z 的采集（P7-01 落地后第一次），记录的 `keystrokeP95Ms` 是 801.2、
`decorationsRebuildMs` 35.1 —— 那一轮用的是**已被证伪的口径**（纯 meta 事务，装饰没重建），
数字不要与上表并列比较。

## 本轮口径订正：`decorationsRebuildMs` 此前量错了对象

`measure.mjs` 原先用 `view.updateState(view.state)`（同一份 state 重放）强制重算装饰。
P7-01 给 `decorations(state)` 加了 `dirty || state.doc !== cachedDoc` 的缓存闸门之后，
**同一份 state 重放只会命中缓存**，量到的其实是「查缓存」而不是「重建」——本机 1~4 ms。
把它和基线的 21186.3 并排放成「−100%」是假结论。

现在的做法：发一个**只带 meta** 的事务（`tr.setMeta(...)`）。`doc` 引用不变，因此不产生
DOM 补丁，不会把 2,000 块的差分/绘制混进来；但插件的 `apply` 照旧调
`derivedIndex.update(tr)` 把 `dirty` 置起，所以下一次 `decorations()` 必然整份重算。
基线那一侧的 21186.3 本来就是旧实现的真重建（当时没有任何缓存），**两侧同口径可比**。
脚本会把「同 state 重放」的缓存命中值单独打一行（本次 4.4 ms），避免下次再被误读。

订正后的结论是：全量重建 21186 → 165.9 ms，`scrollFps` 从 3.7 抬到 59.3 是它的直接结果。
至于 `≤ 4 ms` 那条线：它量的是**击键路径上的装饰增量**，不是这里的全量重建，判据本身也
在后面按决策 A 改写成了 `≤ 150 ms`（原 `≤ 4 ms` 与「每次击键至少要付两趟 O(n) 全量遍历」
这个结构性事实冲突，见「决策 A」一节）。

## P7-01 落地：探针不再触发重建（口径第二次变化）

提交 `933ad1c` 把装饰更新改成双路径：**docChanged 事务走脏区增量，纯 meta / 换文档 /
`invalidate()` 走全量**。而 `measure.mjs` 第 3 项发的正是纯 meta 事务
（`tr.setMeta('perfDecorationProbe', i)`，插件按 `touchesDecorations: tr.docChanged || !!action`
判成「不动装饰」）。于是这一次采集的 35.1 ms **不再是装饰重建的耗时**，它是
「new state + 视图 update」的固定开销：装饰集对象没变，ProseMirror 侧的装饰装配整段
短路（同 state 重放那行打印的是 1.2 ms，差的这部分是 dispatch 与浮层重定位的成本）。

也就是说：

- **21186 → 35.1 这一格不是「同口径 4 位数收益」**，别拿它去宣布 ≤4 ms 达成。
  两侧口径已经不同：基线那侧是真重建，这次那侧根本没有重建。
- `≤ 4 ms` 这条线**当时没有被任何探针量到**。它当初的语义是「击键路径上装饰那一层的开销」，
  而现在这条路径是脏区增量（摘窗口 + 重扫窗口，2,000 块实测窗口外零重扫，单元测试
  `document-decorations-incremental.test.js` 逐条等价性守住）。**这条线已按下面一节改写为
  `decorationIncrementalMs ≤ 150 ms`，并已实测落地（78.8 ms，判定达标）。**
- 冷路径本身仍然是 `DecorationSet.create` 的一次全量构建（2,000 块约 36 ms，见
  `derive` 层分项实测），只在首次装配 / 换文档 / `invalidate()` 时发生。

另有一处**口径差**要写明白，别把两个数混用：P7-01 的提交说明和
`test/unit/derived-index.test.js` 的注释都写「2,000 块实测 47.6 ms（DOM 之外的常数项
占大头）」，那是**只测派生层重建**的数；P7-06 那轮的 165.9 ms 是「发事务 → 视图更新结束」
的整段，多了 ProseMirror 侧的装饰装配。两者不可互换。

## 口径第三次变化：`decorationsRebuildMs` → `decorationIncrementalMs`

前两节说明了一件事：这个指标名在不同时间量的是**三个不同的东西**，任何跨段的百分比都是假的。
所以这一次不再沿用旧键名，直接改名：

| 段 | 键名 | 探针动作 | 量到的是什么 | 实测 |
| --- | --- | --- | --- | --- |
| P7 之前 | `decorationsRebuildMs` | `view.updateState(view.state)` | 真重建（当时无缓存） | 21186.3 |
| P7-01 之后 | `decorationsRebuildMs` | `tr.setMeta(...)` 纯 meta 事务 | dispatch 固定开销（装饰集没动） | 35.1 |
| 本次 | `decorationIncrementalMs` | 文本块内 `insertText` 一笔 | 击键路径上装饰增量那一段 | 78.8 |

**探针动作**：在第一个长度 > 16 的文本块里逐次 `insertText('x', pos)`，共 20 次，最后一次
`delete` 把字符删净（同样是纯文本改动，不让后面的滚动/序列化背这笔账）。这个动作走的是
`isTextOnlyChange` 的准入分支，因此路径是 `incremental`；实现里加了硬失败 —— 20 次里只要
一次退回全量就直接 throw，避免将来判据把纯文字改动挡住时悄悄写出一个空指标。

**打点为什么必须下沉到 `derive` 层**：装饰增量那一段（`previous.map` + 窗口重扫）夹在
`view.dispatch` 内部，在外面只能量到「dispatch → 下一次绘制」的整段，混着 DOM 补丁、排版与
合成，量不出装饰层自己。同一支探针把两层都打出来（见 `measure.mjs` 的「装饰增量 / 整段
dispatch」两行），上一版实测整段 dispatch 是 **p50 195.9 / p95 197.4 / max 201.6 ms**
（抖动 < 3%，这一层的数比击键稳得多），而装饰增量自己只有 72.6 ms 量级 —— 三层里最大的那
一块在外面，不下沉就永远看不见里面。
所以 `src/core/derive/index.js` 的 `decorations()` 里用 `performance.now()` 记账，压进
`globalThis.__larkDocPerf.samples`，每项带 `{ path, ms }`；采集侧只统计 `path === 'incremental'`
的样本。宿主页没挂这个 sink 时只是一次属性读取，热路径代价可忽略。

### 决策 A：`≤ 4 ms` 这条判据本身写错了，已改写为 `≤ 150 ms`

实测 78.8 ms，对照原判据 `≤ 4 ms` 差一个数量级。**这里没有继续压，而是改判据** —— 因为
`≤ 4 ms` 当初是照着「装饰层一次增量的理想开销」拍的，而实测证明这个指标**结构上到不了
那个量级**，继续为它做优化是在为一个不可达的目标烧工作量（决策 A 选项一：改写判据 + 报告写实）。

根因已定位，不是增量算法本身：`collectDocumentDecorations` 里有两趟是**无条件全量遍历**，
不受脏区窗口限制 ——

- `collectFoldRanges(doc)`（`src/core/documentOperations.js:1020`）
- `computeHeadingNumbers(doc)`（`src/core/documentOperations.js:506`）

两处注释自己写着「逐块调 foldedRange 等于逐块 doc.resolve，扁平文档里就是 O(n²)（2,000 块
实测 275 ms）」。脏区增量只省掉了「逐块建 Decoration 对象」那一部分，这两趟 O(n) 省不掉
—— **一次击键至少要付这两趟全量遍历的钱**，`≤ 4 ms` 与这个事实直接冲突。

新判据 `≤ 150 ms` 的定法：取「本轮实测 78.8 ms」为锚，留出约 2 倍余量做退化空间。它不是
一个「理想值」，是**当前实现的结构性下界的门禁线** —— 后面任何一处把这两趟挪进窗口剪裁，
这个数会掉，届时把线一起往下调；反过来，若有人再引入一趟无条件全量遍历，这条线会拦住。

**这条线达标不等于装饰层已经最优**：78.8 ms 里绝大部分是上面两趟 O(n) 遍历，装饰增量本身
只占小头。要再往下走必须把这两趟也纳入窗口剪裁 —— 那是新工作量，不在本轮范围内，
已作为未结账项记在下面。

顺带一个反面证据：同一支探针量到的整段 dispatch 中位数是 195.9 ms（上一版实测，
p95 197.4 / max 201.6，抖动 < 3%），装饰增量 78.8 ms 只占其中约 40%，其余是 DOM 补丁与
排版。**也就是说即便把装饰做到 0，这条路径也到不了 16 ms** ——
`keystrokeP95Ms ≤ 16` 的出路在 P7-05 的挂载策略，不在装饰层。

## 解读（哪些是收益，哪些还没结账）

- **击键 p95 不再报「−93%」，只能给量级**：P7-01 真正兑现的地方是击键走 docChanged 事务、
  走脏区增量，不再整份重扫 2,000 块。但**这条收益无法用百分比表达** —— 37297.2 与 2578.0
  都是「8 次里最差一次」，本轮的 939.7 才是真插值 p95，跨口径算百分比是假结论（见「决策 B」）。
  能说的是：新口径下击键 p95 约 0.9~1.1 s、p99 约 2.4 s，成本不在装饰层而在
  「插入一个字符 → 等到下一帧画完」（双 rAF）的整篇重排与合成。
  这两位有效数字依然要打折看：本轮两轮同负载是 1062.6 / 939.7（−11.6%），
  改动之前同一份 `dist` 连采三次是 2578.0 / 4343.9 / 6837.7（2.65 倍极差）。
  抖动从「倍级」降到「十几个百分点」，但**仍只能给量级结论**。
- **滚动 3.7 → 59.3 FPS**：越过 ≥50 FPS 的退出线，也是 P7-05 判定「不需要窗口化 /
  不需要 `content-visibility: auto`」的直接依据（见 `docs/guide/performance.md`）。
- **首屏 59.8 → 38.8 s（−35%）**：`measure.mjs` 第 1 项直接 `setContent(2000 块)`，不走
  `Workspace` 的持久化水合路径，所以 P7-03 的派生快照收益**不可能**体现在这个数上；
  装饰也不再是瓶颈（首次构建 ~36 ms）。剩下的就是「建 2,000 块的 NodeView + 首次排版」，
  属于 P7-05 的另一半（虚拟化 / 惰性挂载），不是装饰层能解决的。
- **保存 −10%、堆 +2%**：都在噪声范围内（同机重复采集 ±3%~10%）。
- **未结账**：
  1. `mountToTypeableMs` / `keystrokeP95Ms` 两条绝对线（≤1500 / ≤16）仍是已知未达标项，
     出路是 P7-05 的挂载策略，不是继续拆装饰。
  2. `decorationIncrementalMs` 在新判据 `≤ 150 ms` 下**判定达标，但负担没有消除**：
     78.8 ms 的绝大部分是 `collectFoldRanges` / `computeHeadingNumbers` 的无条件全量遍历
     （代码位置见上一节）。决策 A 的结论是「不为不可达的 `≤ 4 ms` 烧工作量」，
     不是「这一层已经最优」。真要把它压下来得单开一项，届时连同新判据一起下调。
  3. ~~采样口径缺陷~~ **已在本轮结账（决策 B）**：采样数 8 → 30、分位数改线性插值，
     `keystrokeP95Ms` 与 `keystrokeP99Ms` 不再相等，并且由
     `test/unit/perf-stats.test.js` 的对照断言钉住，退回去会变红。
  4. **基线的绝对数字仍受机器负载污染**：决策 B 只把抖动从「倍级」压到「十几个百分点」，
     没有消除外生扰动（采集时 load average 6~8、机器 22 天未重启）。要在空闲机器上重采
     一次并再 `--update`，这份基线才能当「精确回归 20%」的标尺，现在只适合拦量级退化。

## 门禁

判定逻辑在 `scripts/perf/gate.mjs`（纯函数，`test/unit/perf-gate.test.js` 覆盖），
CLI 在 `scripts/perf/report.mjs`：

| 退出码 | 含义 |
| --- | --- |
| 0 | 全部指标退化 ≤ 20% |
| 1 | 存在指标退化 > 20%（列出全部命中的指标名） |
| 2 | 不可比：缺 `.perf-result.json`、缺基线、seed/块数不一致 |

方向：`mountToTypeableMs` / `keystrokeP95Ms` / `keystrokeP99Ms` / `decorationIncrementalMs` /
`saveProxyMs` / `heapMB` 越高越差；`scrollFps` 越低越差。判据是「**> 20%**」，
恰好 20% 不算超阈（`gate.mjs` 里带 1e-9 容差，避免 `base * 1.2` 的浮点误差把边界判反）。

**改键名必然让旧基线判失败，这是预期行为**：`compareMetrics` 里 `base == null || now == null`
走 `VERDICT.MISSING` 并计入 failures，所以旧基线 + 新键名会打出
`decorationIncrementalMs — 78.8 — ✗ 缺数据`、EXIT=1。正确顺序是先确认这条失败、再 `--update`；
反过来（先 `--update`）会把「缺数据」这次告警一起盖掉。

**门禁只管「不退化」，不管「达不达标」**：上表那三条绝对线是计划里的交付目标，
由本文件记录，不会让 CI 变红。别把 EXIT=0 读成「性能目标全部达成」。

## 基线策略

- **基线已推进到 2026-10-27T15:45Z**（决策 B 重采后）：旧基线在门禁里已经失效 —— 它记录的全是
  P7 之前的数字，任何退化都拦不住，等于把 gate 退化成一张记录表。P7 之前的数字已备份到
  **`perf/baseline-pre-p7.json`**，那是「优化前」的唯一凭据，别删。
  推进用 `node scripts/perf/report.mjs --update`（从这一版起基线会记录 `platform` / `arch`）。
- **当前基线数字的置信度比上一版高，但还没到「精确」**：决策 B 之后同负载连采两轮的相对差
  是 −11.6%（此前同一份 `dist` 连采三次是 2.65 倍极差），但采集时 load average 仍是
  6~8、机器 22 天未重启，**外生扰动没有被消除，只是不再主导结果**。
  这一版基线适合「拦退化」，当「精确回归 20%」的标尺仍偏乐观 ——
  十几个百分点的波动里有多少是噪声，要在空闲机器上重采一次才能分开。
- **CI 不复用本机基线**：Linux runner 的数字和 darwin/x64 不可比，用同一份基线只会得到
  必然红或必然绿的假结论。`.github/workflows/perf.yml` 用 `actions/cache` 按
  `runner.os-runner.arch` 存一份独立基线，首次运行走 `--bootstrap`（只采集、建立基线、
  不判定），之后每次比对上一次，退化 > 20% 让 job 失败，并把 `.perf-result.json`
  作为 artifact 上传。
- **CI 的实际触发面比计划窄**：`perf.yml` 只在 `push`（`master`、`next/**`）与
  `workflow_dispatch` 上跑，**不跑 PR**（2,000 块真实文档的成本不该让每个 PR 都付）。
  requirements/09 §5.7 写的是「每 PR 起每期跑」，这里是有意收窄，不是漏配。
  缓存的基线建立之后不会自动刷新，要重置换掉它得把 `baseline_generation` 从 `v1` 改成 `v2`。
- **禁止手填**：`baseline.json` 只能由 `report.mjs --update` / `--bootstrap` 从真实采集
  结果复制生成。

## 复现

```bash
# 完整链路（构建 element 产物 + 采集 + 判定）
npm run check:perf

# 只判定（已有 .perf-result.json）
node scripts/perf/report.mjs

# 门禁自身的回归夹具（合成数据，不起浏览器）
npx vitest run test/unit/perf-gate.test.js
```
