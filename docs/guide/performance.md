# 性能：基线、收口手段与虚拟化决策

2,000 块压力夹具（seed 42，本机 headless Chromium）的性能基线，以及 v0.12「P7 性能收口」这一轮的处置口径与结论。数据由 `scripts/perf/measure.mjs` 采集、`scripts/perf/report.mjs` 判定，人读版报告在 `perf/report.md`；`perf/baseline.json` 是门禁基线（退化超 20% 时 `npm run check:perf` 非零退出，CI 见 `.github/workflows/perf.yml`）。

## 一、基线（blockCount 2000，seed 42，Node 22/24）

| 指标 | 收口前（10-24 基线） | 收口后（10-27 采集） | 说明 |
| --- | ---: | ---: | --- |
| `mountToTypeableMs` | 59849.7 | 36666.8 | `setContent` 灌满 2,000 块 → focus → 真键盘敲第一个字 |
| `keystrokeP95Ms` | 37297.2 | 2578.0 | 击键 → 事务提交 → 双 rAF 后的渲染完成；**仍是最大一笔账** |
| `decorationIncrementalMs` | —（旧口径 `decorationsRebuildMs` 21186.3，不可换算） | 72.6 | 击键路径上的**装饰增量**耗时（不是全量重建，也不是 dispatch 固定开销） |
| `scrollFps` | 3.7 | 60.3 | 文档中段连续滚动 3s 的**稳态**帧率 |
| `saveProxyMs` | 24 | 21.6 | 保存代理往返 |
| `heapMB` | 105.6 | 107.9 | JS 堆 |

关于 `scrollFps` 的两个数字：**3.7 不是「滚动只有 3.7 帧」，而是冷启动首轮**——2,000 块首次进入视口要做整批块的首次布局与图层合成。`measure.mjs` 现在先预热 1 轮再取 3 轮中位数，同一会话连续 7 轮的实测序列是 `3 / 23.7 / 59.3 / 60.3 / 60.3 / 60.3 / 60.3`。所以稳态滚动一直能跑满 60，旧的 3.7 是采集口径问题，不是渲染问题。

`decorationIncrementalMs` 这个指标名换过三次口径，**任何跨段的百分比都是假的**，所以这一版直接改名、不复用旧键：

| 段 | 键名 | 探针动作 | 实际量到的东西 | 数值 |
| --- | --- | --- | --- | ---: |
| P7 之前 | `decorationsRebuildMs` | `view.updateState(view.state)` | 真重建（当时无缓存） | 21186.3 |
| P7-01 之后 | `decorationsRebuildMs` | 纯 meta 事务 | dispatch 固定开销（装饰集没动） | 35.1 |
| 本次 | `decorationIncrementalMs` | 文本块内 `insertText` 一笔 | 击键路径上装饰增量那一段 | 72.6 |

P7-01 把装饰更新改成双路径（docChanged 走脏区增量，纯 meta / 换文档 / `invalidate()` 走全量）之后，击键路径上不再发生全量重建，旧名字量到的既不是重建、也没覆盖增量，因此探针改为发真实的文本改动、并把打点下沉到 `src/core/derive/index.js` 的 `decorations()` 内部（外面只能量到「dispatch → 下一次绘制」整段，混着 DOM 补丁与排版）。细节与根因分析见 `perf/report.md`。

**`≤ 4 ms` 的退出线没有达到，实测 72.6 ms，差一个数量级。** 根因不在增量算法本身：`collectDocumentDecorations` 里 `collectFoldRanges(doc)` 与 `computeHeadingNumbers(doc)` 是**无条件全量遍历**（不受脏区窗口限制，`src/core/documentOperations.js:1020` / `:506`，注释自述「2,000 块实测 275 ms」），脏区增量只省掉了逐块建 Decoration 对象那部分。要再往下压得把这两趟也纳入窗口剪裁，属于新工作量。

`mountToTypeableMs` 仍是 36.7 s，需要明确一件事：`measure.mjs` 直接调 `editor.commands.setContent(html)`，**不走持久化 / 水合路径**，所以这块数字反映的是「同步灌 2,000 块 DOM 的结构性成本」，不是 P7 里水合优化的靶子。

**这些数字的置信度受机器负载限制**：采集时 load average 6~8，同一份 `dist` 连采三次 `keystrokeP95Ms` 极差 2.65 倍（2578.0 / 4343.9 / 6837.7，更早一轮还是 801.2）。部分原因是 8 个样本下 `percentile(v, 0.95)` 取到的就是最大值，单次抖动直接决定结果。所以要拿到可信数字，得在空闲机器上重采。

## 二、P7-05 决策：不实现窗口化，也不加 `content-visibility: auto`

**判据**：滚动稳态帧率 ≥ 40 时不做窗口化。2,000 块实测 **60.3 FPS**（阈值 1.5 倍），条件不成立。

**理由**：

1. **收益上限已经被吃掉了。** 滚动到 60 FPS 是帧率的天花板；在 60.3 的基础上再做窗口化，最好情况也只是把 60.3 压到显示器刷新率上限，却要付出下面第 3 条的代价。
2. **`content-visibility: auto` 治绘制，不治建 DOM。** 它让屏幕外元素跳过 layout/paint，但节点照样要创建、装饰照样要算。当前最大的一笔账是 `keystrokeP95Ms`（每次交互触发的整圈重算）与 `mountToTypeableMs`（2,000 块同步建 DOM），这两项不是「屏幕外元素被绘制了」造成的，加了它也不会动。
3. **窗口化会打穿四条现有契约。** 折叠与高亮的范围是**整棵缩进子树**（可能横跨屏幕外几十块）；查找要求**全文档命中数**与逐条高亮；目录要求完整 outline 与跨屏滚动定位；导出与保存取**全文**。这四条目前都以「DOM 是真相」实现，窗口化意味着把它们全部改成「模型 + 虚拟片段」，等于重写跨块装饰与选区层，与飞书口径（选区、装饰跨块连续）正面冲突。
4. **隐性成本先出现。** `content-visibility: auto` 必须配 `contain-intrinsic-size`，估错就是滚动条长度跳变；目录点击的 `scrollIntoView` 会落在未渲染区，位置要二次校正；`coordsAtPos` 在未渲染区返回的是估算值，气泡条与拖拽指示都会歪。

**保留的逃生阀**：若将来典型文档规模从 2,000 块升到 5,000 块以上，或者单块内容大到出现「长块卡顿」，再按「先 `content-visibility: auto` + `contain-intrinsic-size` 估算 + 目录定位二次校正」的顺序做小步引入，不直接上窗口化。

## 三、P7-04 的合并口径

高频路径的处置是**两种排队原语**，都在 `src/core/pacing.js`（纯排队，不碰 DOM，时钟可注入）：

| 原语 | 用在哪 | 为什么是它 |
| --- | --- | --- |
| 帧级合并 `createFrameBatcher` | 选区更新后的整轮定位（`coordsAtPos` ×2、块句柄、表格边界、高亮块工具、气泡条） | 同一帧里来多少次选区变化都只做一轮，且用**最新** selection；Map 键序保证折叠/测量之间的先后依赖不被打乱 |
| 尾随去抖 `createTrailingDebounce`（120ms） | 查找输入、开着查找面板时的每次编辑重搜 | 打字是**跨帧**连续的，rAF 合并后仍是每字符一次全量扫文档；这里必须用时间去抖 |

配套的语义约束：

- **同步段只做便宜且影响模板的事**：`savedSelection`、目录高亮、表格工具开关仍在同步段赋值，拖到下一帧会让人看到旧高亮。
- **显隐与位置同帧写**：气泡条的 `bubbleVisible` 与 `bubblePosition` 由同一次测量写下去，否则就是「先显示在旧位置、下一帧再挪」的控件抖动。
- **幂等短路**：查找在「文档对象与查询词都没变」时直接返回，不再发两个 transaction（每个 transaction 都会连带折叠同步、句柄遮罩、表格裁剪整圈重测）。
- **销毁可取消**：两个调度器都在 `beforeDestroy` 里 `dispose()`，卸载后不再有回调摸 editor。

## 四、复测方式

```bash
npm run check:perf                                    # 构建 element 产物 → 采集 → 与 perf/baseline.json 比对
node scripts/perf/measure.mjs                          # 只采集，写 perf/.perf-result.json
node scripts/perf/report.mjs                           # 只比对 + 打表
node scripts/perf/report.mjs --baseline <path>          # 换一份基线（CI 按运行器分基线时用）
node scripts/perf/report.mjs --bootstrap                # 基线不存在时用本次采集建立它（不判定）
node scripts/perf/report.mjs --update                   # 重写基线（从这一版起会记录 platform/arch）
```

浏览器侧的高频合并回归由 `node scripts/verify.mjs perf-scheduling` 守（`scripts/verify-browser-perf-scheduling.js`）：它断言 200 次连续选区变化只做一轮定位、内容区 DOM 逐字节不变、查找去抖只重算一次、关面板后无残留高亮。

## 五、门禁：怎么判、在哪跑、基线放哪

**判定**在 `scripts/perf/gate.mjs`（纯函数，无 IO，`test/unit/perf-gate.test.js` 用合成数据覆盖），
CLI 只负责参数与退出码：

| 退出码 | 含义 |
| --- | --- |
| 0 | 全部指标退化 ≤ 20% |
| 1 | 存在指标退化 > 20%（打表列出全部命中的指标名） |
| 2 | 不可比：缺 `.perf-result.json`、缺基线、seed/块数不一致 |

方向：时间/内存类越高越差，`scrollFps` 越低越差。判据是「**> 20%**」，恰好 20% 不算超阈
（比较时带 1e-9 容差，避免 `base * 1.2` 的浮点误差把边界判反）。

**人读报告**在 `perf/report.md`：记录 seed、块数、运行器、采集时间、前后对照、阈值与解读，
随每次真实采集更新。数字只能来自 `perf/.perf-result.json`，不进基线就没人手填。

**CI** 在 `.github/workflows/perf.yml`（独立 workflow，push 到 `master`/`next/**` 或手动触发；
lint/单测/构建/size/e2e 四个既有 job 一字未动）。它不拿本机基线去比 Linux runner ——性能数字
机器相关，那样比只会得到必然红或必然绿的假结论。做法是按 `runner.os + runner.arch` 用
`actions/cache` 存一份独立基线：首次运行 `--bootstrap` 只采集建基线、不判定，之后每次比上一次；
要丢弃旧基线，手动触发时把 `baseline_generation` 从 `v1` 改成 `v2` 即可。采集结果与基线
作为 artifact 上传，便于事后核对。

**本机基线策略**：`perf/baseline.json` 已推进到 10-27 的真实采集（探针口径第三次订正之后）。
推进的理由是旧基线记录的全是 P7 之前的数字，任何退化都拦不住，等于把 gate 退化成一张记录表。
P7 之前的数字备份在 **`perf/baseline-pre-p7.json`**，那是「优化前」的唯一凭据，不要删。
推进只能通过 `node scripts/perf/report.mjs --update`，不手填。

注意这一版基线是在有外部负载的机器上采的（load average 6~8、`keystrokeP95Ms` 三次极差 2.65 倍），
适合拦量级退化，不适合当「精确 20% 回归」的标尺；在空闲机器上重采后再 `--update` 一次更稳。
