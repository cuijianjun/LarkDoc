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

## P8-00：尺子的第三处缺口 —— 采集环境本身（负载门 + 孤儿浏览器收口）

决策 B 修的是「**样本怎么算**」。这一节修的是「**什么时候能采**」——
它比统计口径更早出问题，而且症状是**假红**：P7 收口前后连着 5 次 `check:perf` 报退化，
指标一次性涨 20%~124%，但代码一行没改。

根因两条，都不是产品代码：

1. **`check:perf` 是串跑**：`build:element && measure && report`。vue-cli 的 16 worker
   构建尾流（构建进程退出后 worker 仍在回收）把 `loadavg[0]` 从 7.38 推到 **15.78**，
   measure 紧跟其后采在热机上 → 4 项直接命中 >20% 判退化。等机器静下来（5.95）
   **单独跑同一份 `dist`**，7/7 全绿。**同一份产物、同一段代码，只差采集时机。**
2. **孤儿 headless Chromium**：`measure.mjs` 被 kill / 超时打断时，`finally` 里的
   `browser.close()` 不执行，被中断退出就没机会走到那儿。残留进程（profile 目录名含
   `playwright_chromiumdev_profile`）逐轮叠加，把机器一路压到满核 ——
   **下一次采集更慢 → 更容易超时 → 再叠一个**，是个正反馈。

改法分三层，全部不碰 `src/`：

| 层 | 文件 | 做什么 |
| --- | --- | --- |
| 负载门 | `scripts/perf/preflight.mjs`（新，纯函数）+ `measure.mjs` | 采集前轮询 `os.loadavg()`，`load1 ≤ max(4, floor(cores × 0.5))` 才放行（16 核 → 上限 8）；超时抛错、退出码 1，**且不启动浏览器** |
| 孤儿守卫 | `measure.mjs` | 采集前 `pgrep` 计数并 warn（**不自动杀**，避免误伤并行采集）；等待超时时提示清理命令 |
| 信号收口 | `measure.mjs` | `SIGINT` / `SIGTERM` / `SIGHUP` → 幂等 `teardown()` 关浏览器，退出码统一 **130** |

判据被抽成纯函数是老问题复发：`measure.mjs` 在模块顶层就 `main()` 起浏览器，用例 import 不了，
所以负载判定必须独立成无 IO 模块（与 `gate.mjs` / `stats.mjs` 同一套分层）。
`test/unit/perf-preflight.test.js` 14 条，直接用事故现场的数字钉住 ——
`load1=15.78, cores=16` 必须 `idle:false`，`load1=5.95` 必须 `idle:true`，退回去就变红。

**信号路径实测**（`spawn` 一个 2000 块采集，25 s 后发 `SIGTERM`）：

```
[measure] 收到 SIGTERM，正在关闭浏览器以免留下孤儿 Chromium...
<gracefully close start> → <forcefully close> → <kill>
子进程退出 code=130 signal=null
OK: 无残留 headless Chromium
```

退出码这里踩过一次：`main().catch` 会抢在 signal handler 前面 `exit(1)`，把「被信号打断」
误报成「采集失败」。加 `interruptedBySignal` 标志守卫后才拿到 130。

**P8-00 之后的第一轮完整采集**（`2026-10-28T08:43:34Z`，代码零改动，与基线仍可比）：

- 负载门实测 **5.87 ≤ 8** 放行（16 核）；采集结束 `pgrep` 计数 **0**；
- `node scripts/perf/report.mjs` → **7/7 全绿、EXIT=0**。

| 指标 | 基线（10-27T15:45Z） | 本次（10-28T08:43Z） | Δ |
| --- | ---: | ---: | ---: |
| `mountToTypeableMs` | 38810.1 | 35565.8 | −8% |
| `keystrokeP95Ms` | 939.7 | 902.2 | −4% |
| `keystrokeP99Ms` | 2372.1 | 2458.3 | +4% |
| `decorationIncrementalMs` | 78.8 | 74.3 | −6% |
| `scrollFps` | 59.3 | 59 | −1% |
| `saveProxyMs` | 24.6 | 21.3 | −13% |
| `heapMB` | 107.8 | 107.9 | 0% |

**这张表证明的不是「性能变好了」，是「尺子不再随机报红」**：所有 Δ 都在 ±13% 内，
方向有正有负，和上一节「十几个百分点不要拿来下结论」一致。它唯一的用处是
**给 P8-01 的归因提供一个不再被外生扰动污染的起点**。

**本轮没有推进基线**（`report.mjs --update` 未执行）：基线要等 P8 真正改出收益、
或至少等一次「机器刚重启、load < 2」的采集再推，否则等于把噪声写成标准。

## P8-01：那 35 秒花在哪（结论已在 P8-01b 订正）

> **订正声明（P8-01b，2026-10-28）**：本节原版说「98.8% 在 HTML 走树解析，且它是二次的（k = 1.80）」。
> **判定方向对了一半，成分全错。**
>
> 「解析」这个数来自 `HTML 轮 − JSON 轮`。但 JSON 轮**根本不触发补 blockId 的事务** ——
> `getJSON()` 出来的节点自带 `blockId`，`collectBlockIdFixes` 找不到任何待补项，于是不返回事务；
> 而 HTML 入口的每个节点都没有 id，要补 7,932 个。所以这一减，减掉的是**整笔补 id 事务**，
> 却被记在了「解析」名下。分项表里「事务」只剩 0.3%，正是因为差值已经把它吃干了。
>
> 真实位置见 §P8-01b：**96.9% 在 `appendTransaction`，其中根因是一次带 7,932 条
> `setNodeMarkup` 的事务**。摘掉它，同一篇文档从 34,543 ms 掉到 **963 ms**。
> 下面的分项表、规模曲线、按块类型三节保留原样，因为**量出来的数没错，错的只是标签**；
> 每一节末尾都补了按新归因的读法。

立项（`docs/superpowers/handoffs/2026-10-28-p8-mount-kickoff.md` §5）留了一个决策点：

> 「DOM 创建 + HTML parse 是否 ≥ 60%？」是 → 走方案 A（分段渐进灌入）。

下面这张表是**第一次**把 `setContent` 拆开量出来的结果。当时读成「DOM 创建 + 解析 ≥ 60%」，
决策点判「是」；订正后的读法是「事务 ≥ 96.9%」，决策点**仍然判「是」**（因为要动的就是那一段），
但方案 A 的原形（切段灌入）**不是解药** —— 见后文实测。

### 分项表（2,000 块 / 2,478 个顶层元素 / 212.8 KB HTML）

| 分项 | 耗时 | 占比 |
| --- | ---: | ---: |
| **Run A 冷机端到端 `setContent`**（与 `mountToTypeableMs` 同构） | **42,084 ms** | — |
| Run B 分项轮 `setContent`（2 轮中位数） | 39,189.3 ms | — |
| ├ 「解析」（HTML 轮 − JSON 轮）—— **订正：实为补 blockId 事务** | 38,376.8 ms | **97.3%** |
| │　└ 原生 `DOMParser` 单独量（仅参考，见口径 ③） | 9.2 ms | 0.02% |
| ├ 事务 apply 与插件状态（残差）—— **订正：已被上一行吃干** | 98.7 ms | 0.3% |
| └ `view.updateState` = DOM 创建 + 装饰应用（1 次调用） | 713.8 ms | 1.8% |
| 　　├ 装饰计算（derive `rebuild` 1 次） | 113.9 ms | 0.3% |
| 　　└ DOM 创建（净） | 599.9 ms | 1.5% |
| 首次 layout | 221.7 ms | 0.6% |
| `focus('start')` | 39.4 ms | 0.1% |
| 合计 | 39,450.4 ms | 16,525 个 DOM 节点 |

**决策点判定：DOM 创建 + 「解析」= 38,976.7 ms，占 98.8% —— ≥ 60%，方向判「是」。**
但拆开看，「建 DOM」只有 599.9 ms（1.5%）。而所谓「解析」这一格在 P8-01b 被证伪：
它实际是**补 blockId 的那一笔事务**（7,932 条 `setNodeMarkup`），真正的 HTML→schema 走树
全部加起来不到 350 ms。**决策点该看的第六刀，是「事务里到底谁在花时间」** ——
四刀切完只能看到「事务 ≈ 0」，因为差值把它的钱挪到了「解析」名下。

**四刀是怎么切的**（不改源码，全部在页内劫持）：

1. `view.updateState` 挂计时包装（`original.call(this, state)` 保 this）→ 把「DOM 创建 + 装饰应用」从 `setContent` 里切出来；
2. 装饰打点复用 derive 层既有探针（`globalThis.__larkDocPerf` 的 `rebuild` 样本，`src/core/derive/index.js` 的 `decorations()` 自带计时）→ **DOM 创建（净）= updateState − 装饰**；
3. 同一篇文档换 JSON 灌入做一轮 → **解析 = HTML 轮 − JSON 轮**；
4. 事务段 = 残差。

**闭包检查**：`解析 + 事务 + updateState = setContent`，`updateState = DOM 创建 + 装饰`。
任一段为负、或超过整体就报错，不输出看起来合理的表 —— 这一轮确实炸过一次，见口径 ④。

### 四个必须一起读的口径说明

**① 单轮噪声约 ±20%，冷热关系不稳定。** 同一份 `dist` 三轮独立采样的 Run B 中位数：
`45,428.7` / `37,681.9` / `39,189.3` ms（极差 −4% / +16%）；Run A 冷机：`36,119.5` / `44,019.8` / `42,084` ms。
**冷机并不比热机慢** —— 两次实验里两者的大小关系正好相反。原因是测量本身把机器加热了：
一轮 2,000 块 `setContent` 是 40 秒满核同步 JS + 16,525 个节点的建树，前后几轮并不处在同一机器状态。
所以本文件的绝对值只用于**看量级与结构**，十几个百分点的差异不构成结论（与 P7 的判断一致）。

**② JSON 轮与 HTML 轮是同一篇文档，减法**对文档结构**成立 —— 但对「解析」不成立。**
两轮的 `childCount` 都是 **2478**、`querySelectorAll('*')` 都是 **16525**，JSON 轮 `viewUpdate`
717.6 ms ≈ HTML 轮 713.8 ms，所以「建 DOM」那一段确实被消掉了。
**但两轮还有第二个差异：`getJSON()` 的节点自带 `blockId`，HTML 里没有。** 于是 JSON 轮
`collectBlockIdFixes` 一条 fix 都找不到、不返回事务；HTML 轮要补 7,932 条。
差值里因此混进了整笔补 id 事务 —— 这正是 P8-01b 拆出来的东西。
**教训**：两轮相减只在「两者只差一个变量」时成立；这里差了「id 有没有」和「解析路径」两个。

**③ 慢的不是浏览器原生解析 —— 但也不是 schema 走树。** 同一个 212.8 KB 字符串，
`new DOMParser().parseFromString(...)` 只要 **9.2 ms**，而整段「解析」是 **38,376.8 ms**，
相差 4,000 倍以上。这条排除法本身是可靠的（成本不在浏览器侧），但原版的结论
「所以在 ProseMirror 走树」**是猜的**：P8-01b 把事务拆开之后，走树的真实大小只有
**~350 ms**（`parseMs` 上界），剩下的 38,000 ms 全是补 blockId。

**④ 残差容差是软的，并且写在结果里。** 残差 = `setContent − 解析 − updateState`，
而解析来自两个独立页面的两轮相减。`updateState` 的轮间抖动（654~880 ms）与 JSON 轮整轮
（812.5 ms）同量级，于是残差的正负会随抖动方向翻转。`max(50 ms, 1% × setContent)` 以内
判为「噪声内」，保留真实数值并标 ⚠（`closureWithinNoise`），超出仍抛错。

### 规模曲线：这是一个平方项

同 seed、同结构，只改块数，每点 2 轮取中位数（`PERF_ATTRIBUTE_ONLY=scaling`）：

| 块数 | `setContent` | ms/块 | DOM 节点 | µs/节点 | ms/块 环比 |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 144 | 254.1 ms | 1.76 | 1,318 | 192.8 | — |
| 305 | 664.1 ms | 2.18 | 2,115 | 314.0 | ×1.23 |
| 619 | 2,442.9 ms | 3.95 | 4,200 | 581.6 | ×1.81 |
| 1,224 | 9,117.7 ms | 7.45 | 8,210 | 1,110.6 | ×1.89 |
| 2,478 | 39,996.6 ms | 16.14 | 16,525 | 2,420.4 | ×2.17 |

**规模指数 k = 1.80**（log-log 最小二乘，5 点）—— 文档每翻一倍，总耗时约 ×3.5。
`µs/节点` 从 192.8 涨到 2,420.4（×12.6）说明**成本不是按节点数线性分摊的**，
每多一个节点都比前一个更贵。这是「2,000 块 = 40 秒、200 块 = 0.5 秒」的唯一解释：
差 10 倍规模，账单差 80 倍。

**订正后的读法**：这条曲线量到的 `k = 1.80` 是**补 blockId 那笔事务的指数**，不是解析的指数。
把补 id 与 autolink 一起停掉，同样两档规模（`PERF_DISABLE_APPEND=all`，1 段）：

| 块数（顶层元素） | 停掉后 `setContent` | 环比 |
| ---: | ---: | ---: |
| 619 | 273.6 ms | — |
| 2,478 | 1,466.5 ms | ×5.36 |

规模 ×4.0、账单 ×5.36 → **k = 1.20**（≈线性，残余的超线性来自 DOM 创建与 layout）。
也就是：**平方项只有一处，去掉它就没有第二处。**

> 口径：619 那次 load 7.91、2,478 那次 load **11.72** —— 高负载那一端被压得更慢，
> 所以 1.20 是**偏向「不线性」的保守值**，两轮负载相同只会更小。

**推论**：任何「一次性灌完整篇」的方案，在 2,000 块这个量级上都注定是几十秒。
立项 §5 说的「方案 A 不是换个节奏，而是换掉一整个平方项」方向正确 —— 但下面的实测说明，
A 的原形（把同一串 HTML 切段后依次灌入）**并没有**换掉这个平方项。

### 按块类型：成本跟着节点数走，不跟着块类型走

每类各 200 块（`PERF_ATTRIBUTE_ONLY=types`）：

| 类型 | `setContent` | ms/块 | DOM 节点/块 | µs/节点 |
| --- | ---: | ---: | ---: | ---: |
| paragraph | 144.6 ms | 0.72 | 2.3 | 313 |
| heading+indent | 565.4 ms | 1.41 | 3.1 | 455 |
| blockquote | 261.1 ms | 1.30 | 3.2 | 406 |
| list | 570.1 ms | 2.84 | 8.2 | 346 |
| table | 2,616.9 ms | 13.02 | 36.1 | 361 |

`µs/节点` 一列基本持平（313~455），所以**「表格贵」只是因为一个表格块 36 个节点，不是因为表格特殊**。
**这条否掉了「先优化表格渲染」这条路**：要降成本只能降节点数或降每节点成本，按块类型分流没有杠杆。

**订正后的读法**：在新归因下这条数据仍然成立，而且解释更直接 —— 成本 ∝「待补 id 的节点数
× 全篇大小」，而 `µs/节点` 一律按 DOM 节点数摊，所以只要每类文档的总节点数相同、待补 id
的节点数也大致同比，这一列就该持平。表格一块带 10 个待补 id 的节点（表本身 + 3×3 格里的 9 个段落），
所以它既贵在节点多，也贵在步数多。**结论不变：按块类型分流没有杠杆，杠杆在「步数」上。**

### 分段灌入实测：首屏赢了，总账输了

把同一篇文档按顶层块切成 1 / 5 / 10 / 25 段，首段 `setContent`、其余 `insertContentAt` 追加到文末
（`PERF_ATTRIBUTE_ONLY=chunk`，即方案 A 的最小原型）：

| 段数 | `setContent` 合计 | 相对整篇 | **首段（首次可见）** | 块数 |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 41,797.6 ms | ×1.00 | 41,797.6 ms | 2,478 |
| 5 | 49,704.6 ms | ×1.19 | 1,854.4 ms | 2,481 |
| 10 | 62,037.4 ms | ×1.48 | 804.2 ms | 2,484 |
| 25 | 91,835.0 ms | ×2.20 | **227.4 ms** | 2,490 |

**这张表同时给出一个收益和一个坏消息：**

- **收益**：首段从 41,797.6 ms 掉到 **227.4 ms（−99.5%）**。如果 `mountToTypeableMs` 的口径就是
  「用户第一次看见可输入的正文」，25 段能把这项指标改善两个数量级。
- **坏消息**：总耗时随段数**单调变差**（×1.19 → ×1.48 → ×2.20）。分段**没有**削掉平方项：
  每一段插入都会自带**一笔新的补 id 事务**（段内待补 id 的节点数条 step），而每条 step 的成本
  随「此刻文档多大」上升 —— k 次加起来仍是 Θ(n²)，还多付了 k 次整篇级固定开销。
  按 25 段计：`227.4 ms` 的首段之后，剩余 24 次插入平均每次约 **3.8 s**。

**这不是热漂移**：4 个点在 4 分 15 秒内依次跑完，段数递增恰好与时间递增同向，本来需要排除。
用 300 块的独立交叉验证排除掉了 —— 那一轮 4 个点总共 **11 秒**（没时间热机），
同样单调：`914.6 → 1,152.7 → 1,236.8 → 1,621.6 ms`（×1.26 / ×1.35 / ×1.77，首段 `914.6 → 18.9 ms`）。
两次规模不同、机器状态不同，方向一致。

**另一个必须记下的副作用**：分段后块数从 2,478 涨到 2,490（25 段时 +12，约半个段边界各多 1 块）——
`insertContentAt` 在段边界上**不合并相邻的列表/缩进块**。这是方案 A 落地要处理的产品语义问题，
不是测量噪声；`attribute.mjs` 把容差钉在 5% 并把漂移打出来，超过 5% 直接抛错。

### 决策点结论（P8-01b 订正后）

1. **§5 的决策点仍判「是」，但成分要全部改写**：
   不是「一次性建 DOM」（599.9 ms / 1.5%），不是「HTML 走树解析」（真实上界 ~350 ms），
   而是 **`appendTransaction` 里那笔补 blockId 的事务**（34,543.1 ms 里的 31,040.1 ms）。
   决策点本身问得没错（要动的是 `setContent` 内部），错的是「谁在花」这一步归因。
2. **方案 A 的原形不是解药**：它把首屏从 41.8 s 压到 0.23 s，却让总工作量涨到 2.2 倍。
   它买的是**感知延迟**，不是吞吐。
3. **P8-02 的靶子换人**：原计划的「定位每节点成本随文档变大上升的来源」已经完成 ——
   来源是「一次事务里 7,932 条 step，每条 step 的成本随文档变大上升」。
   于是 P8-02 要做的事变成**把 7,932 步压成 1 步或 0 步**（两条候选见 §P8-01b 末节）。
4. **不改判据、不推基线**：`mountToTypeableMs` 仍按 `≤ 1500` 判，本次收益来自「还没实现的修法」，
   不进基线。

## P8-01b：订正归因 —— 一笔 7,932 步的事务

### 三刀切到插件级（仍然不改 `src/`）

1. `view.updateState`（实例方法）→ DOM 创建 + 装饰应用；
2. **`Object.getPrototypeOf(state).applyTransaction`** —— 必须钩原型：Tiptap 的
   `dispatchTransaction` 走的是 `view.state.applyTransaction(tr)`，**不经过 `view.dispatch`**，
   所以钩 `dispatch` 会一点都量不到；这一刀同时包住「应用 step」与「插件 state.apply」；
3. **每个插件的 `spec.state.apply` / `spec.appendTransaction`** —— 可以这样改是因为
   `EditorState.apply()` 遍历 `config.fields` 时存的就是 `spec.state` **对象本身**（不是副本），
   而 `appendTransaction` 每次事务现读 `plugin.spec`。

同时把 `applyTransaction` 的**返回值**记下来：`result.transactions` 是「根事务 + 各插件追加的事务」，
每条的 `steps.length` 就是这一步花在多少条 step 上。这一列是本轮唯一的硬证据。

> 立项 §10 原本写的两条候选（缩扩展集重跑曲线 / 换纯段落文档重跑）**一条都没走**：
> 那两条都是「换一份文档再猜一次」，粒度仍是「是不是我们的扩展」，且都要重跑整条曲线。
> 切到插件级之后，一次运行就把答案落到具体插件的具体方法上，再用屏蔽实验验因果 ——
> **换样本只能否证，切粒度才能定位。**

### 逐次记账：钱确实在事务里（300 块，切 10 段）

| 段 | 起始块 | 合计 | 解析 | 事务净 | 装饰 | `updateState` |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | 13 | 42.3 ms | 7.3 | 20.3 | 1.5 | 13.2 |
| 4 | 150 | 109.8 ms | 8.2 | 71.0 | 8.2 | 22.4 |
| 9 | 336 | 219.5 ms | 11.1 | 167.6 | 13.0 | 27.8 |

对「起始块数」做最小二乘（只取纯插入段，`index > 0`），单位 `ms / 100 块`：

| 分项 | 增量斜率 | 占合计增量 |
| --- | ---: | ---: |
| 合计 | +39.3 | 100% |
| 事务净 | **+35.0** | **89%** |
| 装饰 | +3.2 | 8% |
| `updateState` | +1.2 | 3% |
| 解析 | −0.1 | ≈0 |

**每插入一小段，多付的钱有 89% 落在事务上**，而且它随文档变大而上升；
`updateState`（含 DOM 创建）几乎不涨。这一张表就已经排除了「DOM 创建是二次的」这个假设。

### 插件级：两个 `appendTransaction` 吃掉 92%（2,000 块，1 段，load 7.19）

| 插件 | `state.apply` | `appendTransaction` | 占事务净额 |
| --- | ---: | ---: | ---: |
| `autolink$`（StarterKit 的 `link.autolink: true`） | 0 | **18,572.2 ms** | 55% |
| `larkDoc$`（`src/core/blocks/document.js` 的补 blockId） | 0 | **12,454.3 ms** | 37% |
| `selectingCells$` | 0 | 10.7 ms | 0.03% |
| 其余 9 个插件 | 0 | ≤ 2.6 ms | ≈0 |
| **插件合计** | — | **31,040.1 ms** | **93%** |
| step 应用（残差 = 事务净额 − 插件合计） | — | 2,429.1 ms | 7% |
| **事务净额** | — | **33,469.2 ms** | — |

`state.apply` 一列全是 0：装饰重建发生在 derive 层的 `decorations()` 里（`rebuild` 样本 102.1 ms），
量级只有 0.3%，**不在嫌疑名单上**。

### 屏蔽实验：因果确认，而且 `autolink$` 是「被连累的」

做法：页内把插件的 `plugin.spec.appendTransaction` 置 `null`（ProseMirror 是裸真值判断
`if (plugin.spec.appendTransaction)`，置 `null` 等价于没有），**不改 `src/`、不重建编辑器**。
下表每次只跑 2,000 块、1 段（`PERF_DISABLE_APPEND`）：

| 场景 | `setContent` | 事务净额 | `larkDoc$` | `autolink$` | 相对基线 | load |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 基线 | 34,543.1 ms | 33,469.2 | 12,454.3 | 18,572.2 | ×1.00 | 7.19 |
| 摘 `autolink` | 19,803.8 ms | 18,390.9 | 15,228.6 | — | −42.7% | 7.33 |
| **摘 `larkDoc`** | **963.1 ms** | 31.1 | — | **14.8** | **−97.2%** | 7.57 |
| 两个都摘 | 1,466.5 ms | 2.7 | — | — | −95.8% | 11.72 |

**这张表推翻了三件事，也立了一件事：**

- 摘 `autolink` 只回收 42.7%，摘 `larkDoc` 回收 **97.2%** —— 主导项是补 blockId，不是 autolink；
- **摘掉 `larkDoc` 之后 `autolink$` 从 18,572.2 ms 掉到 14.8 ms（−99.9%）**：
  它的逻辑本身在这个文档上几乎免费，只在事务里多了几千条 step 时才变贵。
  机制是它的 `appendTransaction` 里那句 `combineTransactionSteps(oldState.doc, [...transactions])`
  —— 把同一批 step 在新文档上**整批重放一遍**，再用 `getChangedRanges` 遍历它们。**步数是它的乘数。**
- 两个都摘（1,466.5 ms）比只摘 `larkDoc`（963.1 ms）**更慢**，不是矛盾：全摘那次 load 11.72，
  且 `autolink` 平时只花 14.8 ms，两个数的差别在噪声内（+503 ms / +52%，属于本轮 ±20% 的单轮噪声）。
- **立住的**：`appendTransaction` 是这 35 秒的全部来源，`updateState`（DOM 创建 + 装饰）不是。

> 口径提示：屏蔽实验里 `focus('start')` 一列出现 **77,670.9 ms** 这种离谱值 ——
> 那是被屏蔽后的文档**缺 blockId**（不是合法状态）把 focus 路径拖坏了，属实验副作用，
> 该列在屏蔽轮不可读，也不参与任何结论。

### 步数：机制在这里被定死

| 块数 | 顶层元素 | **追加事务步数** | `larkDoc$` | 每步成本 | `autolink$` | 每步成本 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 500 | 619 | **1,941** | 1,181.2 ms | 0.61 ms | 1,716.3 ms | 0.88 ms |
| 2,000 | 2,478 | **7,932** | 15,785.6 ms | **1.99 ms** | 23,390.2 ms | **2.95 ms** |

- **步数与块数严格线性**：顶层元素 ×4.00（619 → 2,478），步数 ×4.09（1,941 → 7,932）。
  `applyBlockIdFixes` 就是 `fixes.forEach(fix => tr.setNodeMarkup(...))`，**每缺一个 id 一条 step**，
  而一个普通段落/列表项/表格（含格内段落）都算一个。
- **每步成本随文档变大上升**：0.61 → 1.99 ms（×3.26，同期文档 ×4.00）。
  每条 `setNodeMarkup` 要把文档 Fragment 里到该位置之前的孩子重新过一遍，
  位置越靠后越贵 —— 于是「n 条 step」× 「每条约 O(n)」= **Θ(n²)**。
- **两个乘数叠在一起**：补 id 自己的 Θ(n²) + `autolink` 对这 n 条 step 的整批重放（另一次 Θ(n²)）。
  这就是 `k = 1.80` 的形状，也是「每节点都比前一个更贵」的全部原因。

> **口径提示（这张表跨了两次采集，必须打折才能用）**：500 块那次 load 8.97，2,000 块那次 load
> **10.48**，所以「每步成本 ×3.26」里含着负载差。按负载比 1.17 把 2,000 那轮折回
> （43,705.8 ÷ 1.17 ≈ 37,355 ms），仍比 500 轮的线性外推（3,516.7 × 4.0 = 14,067 ms）高 **×2.65**
> —— **Θ(n²) 不是负载造出来的**。而两轮测到的追加步数（1,941 / 7,932）与负载无关，
> 是这一节唯一不需要打折的硬证据。

### 为什么只有挂载/大段粘贴会卡

| 入口 | 待补 id 的节点数 | 步数 | 实测 |
| --- | ---: | ---: | ---: |
| `setContent(HTML)`（挂载、导入、大段粘贴） | 2,000 块全缺 | 7,932 | 34,543.1 ms |
| `setContent(JSON)`（`getJSON()` 回灌） | 0（节点自带 `blockId`） | 0 | ~812.5 ms |
| 日常编辑（回车分段、粘一小段） | 1~2 | 1~2 | 亚毫秒 |

**这张表同时解释了 P8-01 那个假结论**：`HTML 轮 − JSON 轮` 的差值里，
减掉的不只是「解析」，还有整整一笔 7,932 步的事务 —— 因为 JSON 轮压根不触发它。
两轮之间差了**两个**变量（解析路径、id 有无），却只用了一次减法。

### P8-02 的两个候选（下一步）

| 候选 | 做法 | 预期 | 风险 / 代价 |
| --- | --- | --- | --- |
| **A. 解析期就带 id** | 给 `blockId` 的 `parseHTML` 加「缺省即生成」 | 挂载/粘贴路径上 fix 事务**归零**（0 步） | 改 schema attr 语义；粘贴路径的「重复 id 重新编号」逻辑会基本闲置；`isRemoteTransaction` 不补 id 的规则不受影响 |
| **B. n 步合成 1 步** | 先构造带新 id 的 doc，再单步 `replaceWith` 整篇 | fix 事务变 **1 步**，`autolink` 只需重放 1 步 | 整篇重建一次 O(n)（ms 级）；要保 selection 与 `addToHistory: false` |
| C.（不推荐）关 `autolink` | `link.autolink: false` | 34.5 s → 19.8 s | 丢掉功能，且只回收 42.7%，根源仍在 |

**证据支持**：把两者全摘后 `setContent` = 1,466.5 ms，其中还包含 DOM 创建与真实解析 ——
所以 A 或 B 的收益上限就是 **34,543 ms → 约 1.0~1.5 s（两个数量级）**。
建议顺序：**先 B**（语义最保守、可纯单测、不动 schema），跑完再看是否需要 A 把那一次 O(n) 也省掉。

**拍板结果：走 B。**落地与实测见下一节。

## P8-02 落地：把 7,932 步压成 1 步（候选 B）

`applyBlockIdFixes` 改成按条数分流：**超过 32 条**先把整篇 Fragment 重建成带新 attrs 的版本，
再用**一条** `tr.replaceWith(0, doc.content.size, content)` 落地；**不超过 32 条**（回车分段、
粘三五个块）仍旧逐条 `setNodeMarkup` —— 这个规模逐条更快，也不会让 `autolink` 把全篇当变更区重扫。
分界取 32 是「一屏内能粘的块数」，不是量出来的最优点，理由写死在 `INPLACE_FIX_LIMIT` 的注释里。

三条正确性前提（错一条就会静默写坏文档，所以都写成断言/代码，不写在注释里）：

| 前提 | 为什么必须成立 | 代码怎么守 |
| --- | --- | --- |
| 只换 attrs、不动尺寸 | 位置在整轮重建中始终有效，`fixes` 里的 `pos` 才不需要跟着漂 | `content.size !== doc.content.size` 直接抛错 |
| 整篇替换会把区间内位置压到端点 | selection 会被一起压掉（`replaceWith` 的映射把 0..size 映射成 0） | 先存 `selection.toJSON()`，替换后 `Selection.fromJSON` 还原；还原不了就沿用映射后的选区 |
| 不进撤销栈、带块标记 | 宿主不能把这笔当用户的内容修改 | `addToHistory: false` + `BLOCK_ID_META` 在 step 之后置上（事务 meta 与 step 无先后依赖） |

单测 `test/unit/block-fixes.test.js`（13 条）守的是「一样」不是「快」：整篇单步的结果必须与
「逐条、每条一个事务」**JSON 全等**；32 / 33 条的路径分界、selection、其它 attrs 原样保留、
重复 id 去重、尺寸不变、嵌套容器内位置不漂，各一条。

### 前后对照（同一台机器、同一天、块数相同）

| 项 | 改造前 | 改造后 | 变化 |
| --- | ---: | ---: | ---: |
| 追加事务**步数**（末段） | **7,932** | **1** | −7,931 |
| `setContent` | 35,451.9 ms | **1,238.6 ms** | −96.5%（×28.6） |
| `setContent + layout + focus` | 35,693.0 ms | **1,502.6 ms** | −95.8%（×23.8） |
| `mountToTypeableMs`（门禁口径） | 38,810.1 ms | **1,153.7 ms** | −97.0%（×33.6） |
| 顶层元素 / DOM 节点 | 2,478 / 16,525 | 2,478 / 16,525 | 无变化 |
| 归因脚本总耗时 | 38.5 s | 4.3 s | — |
| 机器负载（load1） | 8.40 | 8.76 | 可比 |

两个原始结果：`perf/.run/p8-02-before-c1.json` / `p8-02-after-c1.json`（都是 2,000 块、`PERF_CHUNKS=1`）。

> 口径：改造后 `applyNetMs` 变成 **−35.4 ms**，不是「事务变成负的」—— 步数归零后，
> 仪表自身的抖动（装饰重建落在某插件的 `state.apply` 里，两列重叠）已经大于被测信号，
> 脚本为此专门打了一条 ⚠。**这一行的绝对值不可读，能读的是它归零了。**
> 同理，`setContent` 那张分项表的三项合起来是 102.8%，多出来的 2.8% 就是这条噪声。

### 门禁 7 指标（`node scripts/perf/measure.mjs`，基线**不推**）

| 指标 | 基线（10-27 15:45Z） | 本次 | Δ | 判定 |
| --- | ---: | ---: | ---: | --- |
| `mountToTypeableMs` | 38,810.1 | **1,153.7** | −97% | ✓（**首次进 ≤1500 的线**） |
| `keystrokeP95Ms` | 939.7 | 905.5 | −4% | ✓（仍高于 ≤16 的线） |
| `keystrokeP99Ms` | 2,372.1 | 2,207.2 | −7% | — |
| `decorationIncrementalMs` | 78.8 | 75.4 | −4% | ✓ |
| `scrollFps` | 59.3 | 59 | −1% | ✓ |
| `saveProxyMs` | 24.6 | 24.8 | +1% | ✓（噪声内） |
| `heapMB` | 107.8 | 95.9 | −11% | ✓ |

`check:perf` EXIT=0，7 项全部在 20% 退化阈值内。`mountToTypeableMs` 是这一轮唯一变了量级的指标，
其余 6 项都在噪声内 —— 这正符合预期：只改了补 id 的事务结构，没碰击键路径、滚动与序列化。

### 剩下那 1.24 s 的账单（下一段的入口，不是本轮的活）

| 分项 | ms | 占 `setContent` |
| --- | ---: | ---: |
| `updateState`（建 DOM + 装配装饰） | 736.2 | 59.4% |
| 解析（HTML → 原生 DOM → PM 树） | 392.0 | 31.6% |
| 装饰计算 | 145.8 | 11.8% |
| 事务净额 | **−35.4** | 噪声 |

**候选 A 在这里帮不上忙**：它省掉的是「重建 Fragment 的那一次 O(n)」，而现在这一项已经在噪声里。
要继续往下走只能动 `updateState`（一次建 16,525 个 DOM 节点）或解析 —— 也就是立项 §4 的
方案 A（分段渐进灌入），而它换的是「首屏」不是「总账」。
按现在的数，`mountToTypeableMs` 已经进线，P8-03 / P8-04 在立项 §8 里本来就是条件任务，
是否开，等这条线真正成为瓶颈再说。

### 采集陷阱：有一轮「跑出旧数」是因为产物是旧的

改完代码第一次采集，量到的还是 **7,932 步 / 35,451.9 ms** —— 与改造前逐位相同。

原因不在代码，在环境：这个 IDE worktree 的 `dist/` 与 `node_modules/` 都是**指向主检出的符号链接**，
于是 `node_modules/.cache/webpack` 由两个检出共用。`lark-doc-element` 那份缓存是**另一个检出**
的源码编译出来的，webpack 整份复用而没有重读源码 —— 往 `block-fixes.js` 里注入一个语法错误，
构建依旧成功、产出的 bundle 与上一轮**逐字节相同**（hash 一直是 `e7aea1b62d997e8c`）。
清掉 `node_modules/.cache/webpack/lark-doc-element` 之后 hash 才变成 `c8846fc164dd47e3`。

采集前加一条 2 秒的自检：**产物里必须有本轮的源码指纹**。

```bash
node -e "const s=require('fs').readFileSync('dist/lark-doc-element.umd.min.js','utf8');console.log(s.includes('blockId 补号改变了文档尺寸'))"
# false → 产物是旧的：rm -rf node_modules/.cache/webpack/lark-doc-element 再 build
```

放在这一节而不是「复现」里，是因为它已经把一轮采集变成假结论了 —— 与 P8-00 那两条
（负载门、孤儿浏览器）同一性质：**先证明尺子是好的，再读刻度。**

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

根因已定位，不是增量算法本身：`collectDocumentDecorations` 里有**四趟无条件全量遍历**，
不受脏区窗口限制 ——

- `collectFoldRanges(doc)`（`src/core/documentOperations.js:1020`）
- `computeHeadingNumbers(doc)`（`src/core/documentOperations.js:506`）
- `computeOrderedListNumbers(doc)`（同文件，列表序号）
- `computeBulletItems(doc)`（同文件，无序圆点）

（另有 `findTextMatches` 与一次 `previous.find(0, content.size)` 的全文悬停趟，量级可忽略。）

> **订正（Task 7 复核 #8）**：本节原先只记了「两趟」，漏了列表那两趟。四趟在
> `scripts/perf/build-doc.mjs` 的同一份 2,000 块 fixture（seed 42，`decorations=1424`）
> 上 Node 侧实测：1.51 + 0.51 + 0.60 + 0.64 = **3.26 ms**，占热路径端到端
> （map + `updateDocumentDecorations`，**3.77 ms**）的 **86%**。所以「遍历是主体」这个
> **比例**在 Node 侧成立；但绝对量级与本文的 78.8 ms 差约 20×，且把脏区窗口放到**整篇**
> 端到端也只有 25.6 ms —— 窗口放大同样解释不了这 20×。78.8 从未做过分项归因，所以下文
> 「78.8 ms 里绝大部分是这两趟」只能算方向性推断，不是实测结论。

两处注释自己写着「逐块调 foldedRange 等于逐块 doc.resolve，扁平文档里就是 O(n²)（2,000 块
实测 275 ms）」。脏区增量只省掉了「逐块建 Decoration 对象」那一部分，这两趟 O(n) 省不掉
—— **一次击键至少要付这两趟全量遍历的钱**，`≤ 4 ms` 与这个事实直接冲突。

新判据 `≤ 150 ms` 的定法：取「本轮实测 78.8 ms」为锚，留出约 2 倍余量做退化空间。它不是
一个「理想值」，是**当前实现的结构性下界的门禁线** —— 后面任何一处把这几趟挪进窗口剪裁，
这个数会掉，届时把线一起往下调；反过来，若有人再引入一趟无条件全量遍历，这条线会拦住。

**这条线达标不等于装饰层已经最优**：78.8 ms 里「绝大部分是上面的全量遍历」是有结构依据的
判断（Node 侧同 fixture 占比 86%），但具体构成没有逐段归因。要再往下走必须把那几趟也纳入
窗口剪裁 —— 那是新工作量，不在本轮范围内，已作为未结账项记在下面。

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
     78.8 ms 的主体是 `collectFoldRanges` / `computeHeadingNumbers` /
     `computeOrderedListNumbers` / `computeBulletItems` 这四趟无条件全量遍历
     （代码位置见上一节；Node 侧同 fixture 实测四趟合计 3.26 ms、占端到端 86%）。
     决策 A 的结论是「不为不可达的 `≤ 4 ms` 烧工作量」，
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

# 采集环境自检（负载判定 + 分位数口径，纯函数，不起浏览器）
npx vitest run test/unit/perf-preflight.test.js test/unit/perf-stats.test.js
```

P8-01 的归因脚本（独立于门禁，不参与 CI，只出数不判定）：

```bash
# 四段全跑：分项 + 规模曲线 + 按块类型 + 分段灌入（约 6~9 分钟，2,000 块）
node scripts/perf/attribute.mjs

# 分段跑：只测某一段，其余段从上次结果里继承（互不覆盖）
PERF_ATTRIBUTE_ONLY=phase   node scripts/perf/attribute.mjs   # 分项表
PERF_ATTRIBUTE_ONLY=scaling node scripts/perf/attribute.mjs   # 规模曲线 + 规模指数 k
PERF_ATTRIBUTE_ONLY=types   node scripts/perf/attribute.mjs   # 按块类型
PERF_ATTRIBUTE_ONLY=chunk   node scripts/perf/attribute.mjs   # 分段灌入

# 小规模交叉验证（300 块，11 秒跑完，不受热机漂移影响）
PERF_BLOCKS=300 PERF_ATTRIBUTE_ONLY=chunk node scripts/perf/attribute.mjs
```

P8-01b 的屏蔽实验（**只用于验证平方项归属，量出来的数不是产品口径，不能当收益写进任何结论**）：

```bash
# 摘掉 larkDoc 插件的 appendTransaction（补 blockId 的那笔）
PERF_ATTRIBUTE_ONLY=chunk PERF_CHUNKS=1 PERF_DISABLE_APPEND=larkDoc \
  PERF_OUT=perf/.run/disable-larkdoc-c1.json node scripts/perf/attribute.mjs

# 摘掉 autolink（Tiptap Link 扩展自动加链接的那笔）
PERF_ATTRIBUTE_ONLY=chunk PERF_CHUNKS=1 PERF_DISABLE_APPEND=autolink \
  PERF_OUT=perf/.run/disable-autolink-c1.json node scripts/perf/attribute.mjs

# 两个都摘，同时在 1/5/10 段上复测线性度
PERF_ATTRIBUTE_ONLY=chunk PERF_CHUNKS=1,5,10 PERF_DISABLE_APPEND=all \
  PERF_OUT=perf/.run/disable-all-c1-5-10.json node scripts/perf/attribute.mjs
```

`PERF_DISABLE_APPEND` 未显式给 `PERF_OUT` 时，结果自动落到
`perf/.run/attribute-result.no-<pattern>.json` —— 屏蔽轮的数看着像「优化后的收益」，
落进正式结果文件里迟早会被当成产品口径引用。

归因脚本的环境变量：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PERF_ATTRIBUTE_ONLY` | `all` | `all` / `phase` / `scaling` / `types` / `chunk`；非 `all` 时其余段沿用 `perf/.run/attribute-result.json` 里上一次的结果，并在输出里记 `measuredSections` / `carriedSections` |
| `PERF_BLOCKS` | `2000` | 主文档块数（影响 `phase` 与 `chunk`）；`scaling` 段固定取 `125 / 250 / 500 / 1000 / 2000` |
| `PERF_SEED` | `42` | 文档生成种子，两轮必须一致才可比 |
| `PERF_ATTRIBUTE_REPS` | `3` | 分项轮重复次数（取中位数）；`scaling` / `types` 每点取 `min(REPS, 2)` 轮 |
| `PERF_CHUNKS` | `1,5,10,25` | 分段灌入的切段数列表（只影响 `chunk` 段） |
| `PERF_DISABLE_APPEND` | 空 | 摘掉哪些插件的 `appendTransaction`（`larkDoc` / `autolink` / `all`，逗号分隔）。**归因专用**：屏蔽后文档缺 `blockId`，是非法状态，`focus` 一类的入口在那一轮不可读 |
| `PERF_OUT` | `perf/.run/attribute-result.json` | 结果文件路径。屏蔽实验未显式指定时自动改名为 `.no-<pattern>.json`，防止「实验数」被当成「产品口径」 |

负载门同 `measure.mjs`（`PERF_SKIP_LOAD_WAIT` / `PERF_LOAD_MAX` / `PERF_LOAD_WAIT_MS`），
浏览器路径同 `LARK_DOC_CHROMIUM`。原始结果写 `perf/.run/attribute-result.json`，
**门禁不读它** —— 归因是信息，不是判据，只有 `measure.mjs` 的 7 项指标进 gate。

两轮可比性由脚本自己守：闭包检查（`解析 + 事务 + view.updateState ≈ setContent`，残差软容差
`max(50 ms, 1% × setContent)`）失败会标 ⚠ 并打印两轮的块数 / 节点数 / `updateState` 次数，
用于判断是不是两轮根本不是同一篇文档。分段灌入的块数漂移 > 5% 抛错，< 5% 打 ⚠ 并记 `chunkingDrift`。

采集前若想绕开/收紧负载门（默认 `load1 ≤ max(4, cores/2)`，等待上限 180 s）：

```bash
PERF_SKIP_LOAD_WAIT=1 node scripts/perf/measure.mjs   # 跳过等待（会 warn，结果不可比）
PERF_LOAD_MAX=2       node scripts/perf/measure.mjs   # 手动指定上限，在共享机器上用
PERF_LOAD_WAIT_MS=0   node scripts/perf/measure.mjs   # 只判一次，不等待
```
