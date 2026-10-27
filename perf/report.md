# 性能报告（P7 收口）

> 本文件由真实采集结果整理，**不接受手填数字**。原始数据见 `perf/.perf-result.json`
> （本次）与 `perf/baseline.json`（P7 之前）。重新采集后请连同本文件一起更新。

## 采集口径

| 项 | 值 |
| --- | --- |
| 采集命令 | `npm run check:perf`（= `build:element` → `node scripts/perf/measure.mjs` → `node scripts/perf/report.mjs`） |
| 工作负载 | `PERF_SEED=42`、`PERF_BLOCKS=2000`（`scripts/perf/build-doc.mjs` 确定性生成） |
| 运行器 | darwin / x64、Node v22.22.2、headless Chromium（element UMD 产物 + 静态宿主页） |
| 采集时间 | 2026-10-27T10:30:19Z（P7-01/02/03 之后，P7-04 提交之前） |
| 采样数 | 击键 8 次、装饰重建 5 次、保存 10 次、滚动 3 轮取中位数（首轮预热丢弃） |
| 对照基线 | `perf/baseline.json`，2026-10-24T10:08:21Z 采集（P7 任何优化之前） |

性能数字是**机器相关**的：换机器、换架构、换 seed 或块数都不可比。`report.mjs` 会在
seed/块数不一致时直接以退出码 2 拒绝判定，而不是给一个看起来很像的结论。

## 结果

| 指标 | P7 前（10-24） | P7 后（10-27） | Δ | 退出目标 | 判定 |
| --- | --- | --- | --- | --- | --- |
| `mountToTypeableMs` 首屏可输入 | 59849.7 | 39232.7 | −34% | ≤ 1500 | ✗ 未达标（见下） |
| `keystrokeP95Ms` 击键 → 下一帧 | 37297.2 | 6002.1 | −84% | ≤ 16 | ✗ 未达标（P7-04 后待重采） |
| `keystrokeP99Ms` | 37297.2 | 6002.1 | −84% | — | — |
| `decorationsRebuildMs` 单次装饰重建 | 21186.3 | 2.1 | −100% | ≤ 4 | ✓ |
| `scrollFps` 稳态滚动帧率 | 3.7 | 59.3 | +1503% | ≥ 50 | ✓ |
| `saveProxyMs` 全篇 JSON 序列化 | 24 | 25 | +4% | — | ✓（噪声内） |
| `heapMB` 2,000 块静置堆占用 | 105.6 | 107.4 | +2% | — | ✓（噪声内） |

退出目标取自 `docs/superpowers/plans/2026-10-27-p7-performance-closure.md` 的 Task 7 验收条件。

## 解读（哪些是收益，哪些还没结账）

- **装饰重建 21186 → 2.1 ms**：P7-01 把「事务后全量重扫」换成 mapping 驱动的局部更新，
  这是本期最大的一笔，已经越过 ≤4 ms 的退出线，量级差四个数量级。
- **滚动 3.7 → 59.3 FPS**：P7-01 的连带收益（每帧不再重画全文装饰），越过 ≥50 FPS 的退出线。
  这也是 P7-05 判定「不需要窗口化、不需要 `content-visibility: auto`」的直接依据
  （见 `docs/guide/performance.md`）。
- **击键 p95 6002 ms**：仍然离 ≤16 ms 差两个数量级。这一项正是 P7-04 的靶子
  （选区布局、`coordsAtPos`×2、块句柄、查找全量扫描全部合并到一帧并加去抖），
  但**本次采集发生在 P7-04 提交之前**，所以表里的 6002 ms 还不含 P7-04 的收益。
  P7-04 之后必须重采一次才能结账，本文件届时同步更新。
- **首屏 39.2 s**：`scripts/perf/measure.mjs` 的第 1 项直接 `setContent(2000 块)`，
  不走 `Workspace` 的持久化水合路径，所以 P7-03 的派生快照收益**不可能**体现在这个数上。
  它现在是「建 DOM + 首次排版」的冷启动成本，属于另一条待办（P7-03 的收益要用
  「打开已有文档 → 可输入」的水合路径单独量）。不要拿这个数说 P7-03 没生效。
- **保存 +4%、堆 +2%**：都在噪声范围内（同一台机器重复采集的抖动约 ±2%）。

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

## 基线策略

- **`perf/baseline.json` 是 P7 之前的基线，故意没有覆盖**：它是「优化前」的唯一凭据，
  一旦 `--update` 就没了。要推进基线，等本机重采之后跑
  `node scripts/perf/report.mjs --update`（从这一版起基线会记录 `platform` / `arch`）。
- **CI 不复用本机基线**：Linux runner 的数字和 darwin/x64 不可比，用同一份基线只会得到
  必然红或必然绿的假结论。`.github/workflows/perf.yml` 用 `actions/cache` 按
  `runner.os-runner.arch` 存一份独立基线，首次运行走 `--bootstrap`（只采集、建立基线、
  不判定），之后每次比对上一次，退化 > 20% 让 job 失败，并把 `.perf-result.json`
  作为 artifact 上传。
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
