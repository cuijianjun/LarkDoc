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

## P8-01：那 35 秒花在哪 —— 以及「分段灌入」不是解法

立项（`docs/superpowers/handoffs/2026-10-28-p8-mount-kickoff.md` §5）留了一个决策点：

> 「DOM 创建 + HTML parse 是否 ≥ 60%？」是 → 走方案 A（分段渐进灌入）。

下面这张表是**第一次**把 `setContent` 拆开量出来的结果。结论与立项的预期**方向一致、成分不一致**：
决策点判「是」，但占大头的不是「一次性建 DOM」，而是 **HTML 入口的走树解析**，而且它是**二次的**。
而方案 A 的实测收益**没有落在总耗时上**（见后文），这一点必须写在最前面，否则 §5 的推理会被误读。

### 分项表（2,000 块 / 2,478 个顶层元素 / 212.8 KB HTML）

| 分项 | 耗时 | 占比 |
| --- | ---: | ---: |
| **Run A 冷机端到端 `setContent`**（与 `mountToTypeableMs` 同构） | **42,084 ms** | — |
| Run B 分项轮 `setContent`（2 轮中位数） | 39,189.3 ms | — |
| ├ 解析（HTML 轮 − JSON 轮，含 DOM 走树） | 38,376.8 ms | **97.3%** |
| │　└ 原生 `DOMParser` 单独量（仅参考，见口径 ③） | 9.2 ms | 0.02% |
| ├ 事务 apply 与插件状态（残差） | 98.7 ms | 0.3% |
| └ `view.updateState` = DOM 创建 + 装饰应用（1 次调用） | 713.8 ms | 1.8% |
| 　　├ 装饰计算（derive `rebuild` 1 次） | 113.9 ms | 0.3% |
| 　　└ DOM 创建（净） | 599.9 ms | 1.5% |
| 首次 layout | 221.7 ms | 0.6% |
| `focus('start')` | 39.4 ms | 0.1% |
| 合计 | 39,450.4 ms | 16,525 个 DOM 节点 |

**决策点判定：DOM 创建 + 解析 = 38,976.7 ms，占 98.8% —— ≥ 60%，方向判「是」。**
但拆开看，「建 DOM」只有 599.9 ms（1.5%），98.8% 里几乎全是解析。

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

**② JSON 轮与 HTML 轮是同一篇文档，减法成立。** 两轮的 `childCount` 都是 **2478**、
`querySelectorAll('*')` 都是 **16525**，JSON 轮 `viewUpdate` 717.6 ms ≈ HTML 轮 713.8 ms。
之所以要专门验这一条：如果 `getJSON → setContent` 有损，两轮差里就混进了「少建的那部分 DOM」，
「解析」这个标签就名不副实。**这条没验之前，上一版的闭包检查在 2,000 块时确实失败过。**

**③ 慢的不是浏览器原生解析。** 同一个 212.8 KB 字符串，`new DOMParser().parseFromString(...)`
只要 **9.2 ms**；而整段「解析」是 **38,376.8 ms**，相差 4,000 倍以上。所以成本在
**ProseMirror 把 DOM 走成 schema 节点**（`parseHTML` 规则匹配 + 节点构造）这一步，不在浏览器侧。

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
- **坏消息**：总耗时随段数**单调变差**（×1.19 → ×1.48 → ×2.20）。分段**没有**削掉平方项，
  而是把它变成了 k 次「往一篇大文档里插东西」，每次插入都要对整篇重付一遍
  `updateState + 装饰重建`。按 25 段计：`227.4 ms` 的首段之后，剩余 24 次插入平均每次约 **3.8 s**。

**这不是热漂移**：4 个点在 4 分 15 秒内依次跑完，段数递增恰好与时间递增同向，本来需要排除。
用 300 块的独立交叉验证排除掉了 —— 那一轮 4 个点总共 **11 秒**（没时间热机），
同样单调：`914.6 → 1,152.7 → 1,236.8 → 1,621.6 ms`（×1.26 / ×1.35 / ×1.77，首段 `914.6 → 18.9 ms`）。
两次规模不同、机器状态不同，方向一致。

**另一个必须记下的副作用**：分段后块数从 2,478 涨到 2,490（25 段时 +12，约半个段边界各多 1 块）——
`insertContentAt` 在段边界上**不合并相邻的列表/缩进块**。这是方案 A 落地要处理的产品语义问题，
不是测量噪声；`attribute.mjs` 把容差钉在 5% 并把漂移打出来，超过 5% 直接抛错。

### 决策点结论

1. **§5 的决策点判「是」（98.8% ≥ 60%），但成分要改写**：不是「一次性建 DOM」（599.9 ms / 1.5%），
   而是 **HTML 走树解析（38,376.8 ms / 97.3%）**，且该段是二次的（k = 1.80）。
2. **方案 A 的原形不是解药**：它把首屏从 41.8 s 压到 0.23 s，却让总工作量涨到 2.2 倍。
   它买的是**感知延迟**，不是吞吐。
3. **所以 P8-02 之前需要一个新任务**：定位「每节点成本随文档变大而上升」的来源。
   最可疑的是「每次事务都对整篇重付一遍 O(n) 成本的某处」——
   25 段时 24 次额外插入共多花约 50 s，约 **2.9 s/次（每 100 块）**，这个数远超 `updateState`（0.71 s）
   与装饰重建（0.11 s）之和，说明还有一笔未被归因的整篇级开销。
   两条候选实验（都不改源码即可做）：把扩展集缩到只剩 StarterKit 再量同一条曲线（区分「我们的扩展」与「ProseMirror 本身」）、
   以及在纯段落文档上复测（排除列表/表格的嵌套结构）。
4. **不改判据、不推基线**：`mountToTypeableMs` 仍按 `≤ 1500` 判，本次收益来自「还没实现的方案」，
   不进基线。

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

归因脚本的环境变量：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PERF_ATTRIBUTE_ONLY` | `all` | `all` / `phase` / `scaling` / `types` / `chunk`；非 `all` 时其余段沿用 `perf/.run/attribute-result.json` 里上一次的结果，并在输出里记 `measuredSections` / `carriedSections` |
| `PERF_BLOCKS` | `2000` | 主文档块数（影响 `phase` 与 `chunk`）；`scaling` 段固定取 `125 / 250 / 500 / 1000 / 2000` |
| `PERF_SEED` | `42` | 文档生成种子，两轮必须一致才可比 |
| `PERF_ATTRIBUTE_REPS` | `3` | 分项轮重复次数（取中位数）；`scaling` / `types` 每点取 `min(REPS, 2)` 轮 |

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
