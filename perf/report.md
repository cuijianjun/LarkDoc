# 性能报告（P7 收口）

> 本文件由真实采集结果整理，**不接受手填数字**。原始数据见 `perf/.perf-result.json`
> （本次）与 `perf/baseline.json`（P7 之前）。重新采集后请连同本文件一起更新。

## 采集口径

| 项 | 值 |
| --- | --- |
| 采集命令 | `npm run check:perf`（= `build:element` → `node scripts/perf/measure.mjs` → `node scripts/perf/report.mjs`） |
| 工作负载 | `PERF_SEED=42`、`PERF_BLOCKS=2000`（`scripts/perf/build-doc.mjs` 确定性生成） |
| 运行器 | darwin / x64、Node v24.22.0、headless Chromium（element UMD 产物 + 静态宿主页） |
| 采集时间 | 2026-10-27T13:40Z（P7-01 脏区增量重扫提交 `933ad1c` 之后） |
| 采样数 | 击键 8 次、装饰重建 5 次、保存 10 次、滚动 3 轮取中位数（首轮预热丢弃） |
| 对照基线 | `perf/baseline.json`，2026-10-24T10:08:21Z 采集（P7 任何优化之前） |

性能数字是**机器相关**的：换机器、换架构、换 seed 或块数都不可比。`report.mjs` 会在
seed/块数不一致时直接以退出码 2 拒绝判定，而不是给一个看起来很像的结论。

同一棵树连采三次的抖动范围（用于判断哪些差异算噪声）：`mountToTypeableMs` ±8%、
`keystrokeP95Ms` ±10%、`decorationsRebuildMs` ±4%、`scrollFps` ±1%、
`saveProxyMs` / `heapMB` ±3%。**跨量级的变化才有意义，十几个百分点不要拿来下结论。**

## 结果

| 指标 | P7 前（10-24） | 本次（10-27，P7-01 落地后） | Δ | 退出目标 | 判定 |
| --- | --- | --- | --- | --- | --- |
| `mountToTypeableMs` 首屏可输入 | 59849.7 | 32443.1 | −46% | ≤ 1500 | ✗ 未达标（见下） |
| `keystrokeP95Ms` 击键 → 下一帧 | 37297.2 | 801.2 | −98% | ≤ 16 | ✗ 未达标（见下） |
| `keystrokeP99Ms` | 37297.2 | 801.2 | −98% | — | — |
| `decorationsRebuildMs` 探针（纯 meta 事务） | 21186.3 | 35.1 | −100% | ≤ 4 | ⚠ 口径变了，见下 |
| `scrollFps` 稳态滚动帧率 | 3.7 | 60.3 | +1530% | ≥ 50 | ✓ |
| `saveProxyMs` 全篇 JSON 序列化 | 24 | 22.7 | −5% | — | ✓（噪声内） |
| `heapMB` 2,000 块静置堆占用 | 105.6 | 108.4 | +3% | — | ✓（噪声内） |

退出目标取自 `docs/superpowers/plans/2026-10-27-p7-performance-closure.md` 的 Task 7 验收条件。
**门禁（全部 ≤20% 退化，`check:perf` EXIT=0）与滚动帧率达标**；三条绝对耗时线仍未达标，
其中 `decorationsRebuildMs` 这一格的「未达标」要先读完下面两节的口径说明再下结论。

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

订正后的结论是：全量重建 21186 → 165.9 ms，`scrollFps` 从 3.7 抬到 59.3 是它的直接结果；
但 `≤ 4 ms` 这条线没达到，差距正好对应 P7-01 当时显式放弃的那部分（「装饰仍为全量重建，
非脏区局部重扫」）。

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
- `≤ 4 ms` 这条线**目前没有被任何探针量到**。它当初的语义是「击键路径上装饰那一层的开销」，
  而现在这条路径是脏区增量（摘窗口 + 重扫窗口，2,000 块实测窗口外零重扫，单元测试
  `document-decorations-incremental.test.js` 逐条等价性守住），量级在亚毫秒到几毫秒。
  要不要把探针改成「强制一次冷路径重建」来重新占位，或者干脆把这条线改写成
  「击键路径装饰增量耗时」，留给维护者定 —— 这次只采集，不动门禁脚本。
- 冷路径本身仍然是 `DecorationSet.create` 的一次全量构建（2,000 块约 36 ms，见
  `derive` 层分项实测），只在首次装配 / 换文档 / `invalidate()` 时发生。

另有一处**口径差**要写明白，别把两个数混用：P7-01 的提交说明和
`test/unit/derived-index.test.js` 的注释都写「2,000 块实测 47.6 ms（DOM 之外的常数项
占大头）」，那是**只测派生层重建**的数；P7-06 那轮的 165.9 ms 是「发事务 → 视图更新结束」
的整段，多了 ProseMirror 侧的装饰装配。两者不可互换。

## 解读（哪些是收益，哪些还没结账）

- **击键 p95 2921 → 801 ms（比 P7 前 −98%）**：这是 P7-01 真正兑现的地方 —— 击键是
  docChanged 事务，走脏区增量，不再整份重扫 2,000 块。剩下的 801 ms 不在装饰层：
  这个口径是「插入一个字符 → 等到下一帧画完」（双 rAF），成本在整篇重排与合成。
- **滚动 3.7 → 60.3 FPS**：越过 ≥50 FPS 的退出线，也是 P7-05 判定「不需要窗口化 /
  不需要 `content-visibility: auto`」的直接依据（见 `docs/guide/performance.md`）。
- **首屏 32.4 s（−46%）**：`measure.mjs` 第 1 项直接 `setContent(2000 块)`，不走
  `Workspace` 的持久化水合路径，所以 P7-03 的派生快照收益**不可能**体现在这个数上；
  装饰也不再是瓶颈（首次构建 ~36 ms）。剩下的就是「建 2,000 块的 NodeView + 首次排版」，
  属于 P7-05 的另一半（虚拟化 / 惰性挂载），不是装饰层能解决的。
- **保存 −5%、堆 +3%**：都在噪声范围内（同机重复采集 ±3%~5%）。
- **未结账**：`mountToTypeableMs` / `keystrokeP95Ms` 两条绝对线（≤1500 / ≤16）仍是已知
  未达标项，出路是 P7-05 的挂载策略，不是继续拆装饰。`decorationsRebuildMs` 的判据
  需要先按上一节重新定义。

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
