# 性能报告（P7 收口）

> 本文件由真实采集结果整理，**不接受手填数字**。原始数据见 `perf/.perf-result.json`
> （本次）与 `perf/baseline.json`（P7 之前）。重新采集后请连同本文件一起更新。

## 采集口径

| 项 | 值 |
| --- | --- |
| 采集命令 | `npm run check:perf`（= `build:element` → `node scripts/perf/measure.mjs` → `node scripts/perf/report.mjs`） |
| 工作负载 | `PERF_SEED=42`、`PERF_BLOCKS=2000`（`scripts/perf/build-doc.mjs` 确定性生成） |
| 运行器 | darwin / x64、Node v24.22.0、headless Chromium（element UMD 产物 + 静态宿主页） |
| 采集时间 | 2026-10-27T13:17Z（P7-01 ~ P7-06 全部提交之后，含 Task 7 复核修复） |
| 采样数 | 击键 8 次、装饰重建 5 次、保存 10 次、滚动 3 轮取中位数（首轮预热丢弃） |
| 对照基线 | `perf/baseline.json`，2026-10-24T10:08:21Z 采集（P7 任何优化之前） |

性能数字是**机器相关**的：换机器、换架构、换 seed 或块数都不可比。`report.mjs` 会在
seed/块数不一致时直接以退出码 2 拒绝判定，而不是给一个看起来很像的结论。

同一棵树连采三次的抖动范围（用于判断哪些差异算噪声）：`mountToTypeableMs` ±8%、
`keystrokeP95Ms` ±10%、`decorationsRebuildMs` ±4%、`scrollFps` ±1%、
`saveProxyMs` / `heapMB` ±3%。**跨量级的变化才有意义，十几个百分点不要拿来下结论。**

## 结果

| 指标 | P7 前（10-24） | P7 后（10-27） | Δ | 退出目标 | 判定 |
| --- | --- | --- | --- | --- | --- |
| `mountToTypeableMs` 首屏可输入 | 59849.7 | 36753.1 | −39% | ≤ 1500 | ✗ 未达标（见下） |
| `keystrokeP95Ms` 击键 → 下一帧 | 37297.2 | 2921.4 | −92% | ≤ 16 | ✗ 未达标（见下） |
| `keystrokeP99Ms` | 37297.2 | 2921.4 | −92% | — | — |
| `decorationsRebuildMs` 单次全量装饰重建 | 21186.3 | 165.9 | −99% | ≤ 4 | ✗ 未达标（见下） |
| `scrollFps` 稳态滚动帧率 | 3.7 | 59.3 | +1503% | ≥ 50 | ✓ |
| `saveProxyMs` 全篇 JSON 序列化 | 24 | 23.5 | −2% | — | ✓（噪声内） |
| `heapMB` 2,000 块静置堆占用 | 105.6 | 108.1 | +2% | — | ✓（噪声内） |

退出目标取自 `docs/superpowers/plans/2026-10-27-p7-performance-closure.md` 的 Task 7 验收条件。
**7 项里 4 项达标、3 项未达标**：达标的是「没有退化」这条门禁本身（全部 ≤20%，
`check:perf` EXIT=0）与滚动帧率；未达标的是三条绝对耗时线。

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

订正后的结论是：

- **收益是真的**：全量重建 21186 → 165.9 ms，差两个数量级，`scrollFps` 从 3.7 抬到 59.3
  就是这条的直接结果（每帧不再重画全文装饰）。
- **但 `≤ 4 ms` 这条线没有达到**，差 40 倍。差距正好对应 P7-01 显式放弃的那部分：
  提交 `1d6329f` 的说明写的是「装饰仍为全量重建（非脏区局部重扫）……继续拆脏区收益
  不抵维护成本」。计划 Task 2 Step 4 要求的 `oldSet.map(tr.mapping, tr.doc)`
  加局部重扫**没有实现**；当时判定「收益不抵成本」所依据的 2.1 ms，就是上面那个缓存命中值。
  要不要补做是一个取舍问题（见「未结账」末条），不能靠订正数字绕过去。

另有一处**口径差**要写明白，别把两个数混用：P7-01 的提交说明和
`test/unit/derived-index.test.js` 的注释都写「2,000 块实测 47.6 ms（DOM 之外的常数项
占大头）」，那是**只测派生层重建**的数；本文件的 165.9 ms 是「发事务 → 视图更新结束」
的整段，多了 ProseMirror 侧的装饰装配。两者不可互换 —— 但无论按哪个口径，都远在 4 ms 之上。

## 解读（哪些是收益，哪些还没结账）

- **滚动 3.7 → 59.3 FPS**：P7-01 的连带收益，越过 ≥50 FPS 的退出线。这也是 P7-05 判定
  「不需要窗口化、不需要 `content-visibility: auto`」的直接依据（见 `docs/guide/performance.md`）。
- **装饰重建 21186 → 165.9 ms**：已越过门禁（不退化），但**没到 4 ms**。剩下的 40 倍在
  「文档变更后仍整份重扫 2,000 块」上，出路只有计划原本要的脏区局部重扫。
- **击键 p95 2921 ms**：比 P7 前的 37297 降了 92%，但离 ≤16 ms 仍差两个数量级。
  这个口径是「插入一个字符 → 等到下一帧画完」（双 rAF），2,000 块整篇重排 + 合成的成本
  远大于编辑事务本身；P7-04 合并了高频更新的重复计算，量级问题不在那一层。
- **首屏 36.8 s**：`measure.mjs` 第 1 项直接 `setContent(2000 块)`，不走 `Workspace` 的
  持久化水合路径，所以 P7-03 的派生快照收益**不可能**体现在这个数上。它现在是
  「建 DOM + 首次排版」的冷启动成本，属于另一条待办（P7-03 的收益要用「打开已有文档
  → 可输入」的水合路径单独量）。不要拿这个数说 P7-03 没生效。
- **保存 −2%、堆 +2%**：都在噪声范围内（同机重复采集 ±3%）。
- **未结账**：从 v0.12.0 起 2,000 块文档的「滚动」和「不退化」是保住的，但
  「首屏 / 击键 / 单次装饰重建」三条绝对线仍是已知未达标项。补做 P7-01 的脏区局部重扫
  是唯一能直接改进 `decorationsRebuildMs` 的路径，是否在 v0.12.x 里做由维护者决定。

## 门禁

判定逻辑在 `scripts/perf/gate.mjs`（纯函数，`test/unit/perf-gate.test.js` 覆盖），
CLI 在 `scripts/perf/report.mjs`：

| 退出码 | 含义 |
| --- | --- |
| 0 | 全部指标退化 ≤ 20% |
| 1 | 存在指标退化 > 20%（列出全部命中的指标名） |
| 2 | 不可比：缺 `.perf-result.json`、缺基线、seed/块数不一致 |

方向：`mountToTypeableMs` / `keystrokeP95Ms` / `keystrokeP99Ms` / `decorationsRebuildMs` /
`saveProxyMs` / `heapMB` 越高越差；`scrollFps` 越低越差。判据是「**> 20%**」，
恰好 20% 不算超阈（`gate.mjs` 里带 1e-9 容差，避免 `base * 1.2` 的浮点误差把边界判反）。

**门禁只管「不退化」，不管「达不达标」**：上表那三条绝对线是计划里的交付目标，
由本文件记录，不会让 CI 变红。别把 EXIT=0 读成「性能目标全部达成」。

## 基线策略

- **`perf/baseline.json` 是 P7 之前的基线，故意没有覆盖**：它是「优化前」的唯一凭据，
  一旦 `--update` 就没了。要推进基线，等本机重采之后跑
  `node scripts/perf/report.mjs --update`（从这一版起基线会记录 `platform` / `arch`）。
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
