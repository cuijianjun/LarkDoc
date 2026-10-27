# 性能：基线、收口手段与虚拟化决策

## 概述

2,000 块压力夹具（seed 42，本机 headless Chromium）的性能基线，以及 v0.12「P7 性能收口」这一轮的处置口径与结论。数据由 `scripts/perf/measure.mjs` 采集、`scripts/perf/report.mjs` 判定，人读版报告在 `perf/report.md`；`perf/baseline.json` 是门禁基线（退化超 20% 时 `npm run check:perf` 非零退出，CI 见 `.github/workflows/perf.yml`）。

## 一、基线（blockCount 2000，seed 42，Node 22/24）

| 指标 | 收口前（10-24 基线） | 收口后（10-27 采集） | 说明 |
| --- | ---: | ---: | --- |
| `mountToTypeableMs` | 59849.7 | 36753.1 | `setContent` 灌满 2,000 块 → focus → 真键盘敲第一个字 |
| `keystrokeP95Ms` | 37297.2 | 2921.4 | 击键 → 事务提交 → 双 rAF 后的渲染完成；**仍是最大一笔账** |
| `decorationsRebuildMs` | 21186.3 | 165.9 | 单次**全量**重建（文档变更后重扫 2,000 块）。同 state 重放命中缓存只有 4.4 ms，那不是重建 |
| `scrollFps` | 3.7 | 59.3 | 文档中段连续滚动 3s 的**稳态**帧率 |
| `saveProxyMs` | 24 | 23.5 | 保存代理往返 |
| `heapMB` | 105.6 | 108.1 | JS 堆 |

关于 `scrollFps` 的两个数字：**3.7 不是「滚动只有 3.7 帧」，而是冷启动首轮**——2,000 块首次进入视口要做整批块的首次布局与图层合成。`measure.mjs` 现在先预热 1 轮再取 3 轮中位数，同一会话连续 7 轮的实测序列是 `3 / 23.7 / 59.3 / 60.3 / 60.3 / 60.3 / 60.3`。所以稳态滚动一直能跑满 60，旧的 3.7 是采集口径问题，不是渲染问题。

`decorationsRebuildMs` 从 21.2 s 掉到 165.9 ms 是**真收益**（两个数量级）：旧实现对 2,000 块逐块重建装饰并伴随布局读取，一次就 21 秒；现在每次只重新推导索引、不再触发布局读取，因此滚动帧率随之从 3.7 抬到 59.3。但计划里「≤ 4 ms」那条线**没有达到**——165.9 ms 仍是「整份重扫」，不是脏区局部重扫。P7-01 的提交说明写明这是取舍（「继续拆脏区收益不抵维护成本」），当时的依据是 2.1 ms 那个数，而 2.1 ms 其实是**缓存命中**、不是重建；测量方法已在 Task 7 复核时订正（改成发一个只带 meta 的事务强制标脏，`doc` 引用不变所以不掺 DOM 补丁），细节见 `perf/report.md`。

`mountToTypeableMs` 仍是 36.8 s，需要明确一件事：`measure.mjs` 直接调 `editor.commands.setContent(html)`，**不走持久化 / 水合路径**，所以这块数字反映的是「同步灌 2,000 块 DOM 的结构性成本」，不是 P7 里水合优化的靶子。

## 二、P7-05 决策：不实现窗口化，也不加 `content-visibility: auto`

**判据**：滚动稳态帧率 ≥ 40 时不做窗口化。2,000 块实测 **59.3 FPS**（阈值 1.5 倍），条件不成立。

**理由**：

1. **收益上限已经被吃掉了。** 滚动到 60 FPS 是帧率的天花板；在 59.3 的基础上再做窗口化，最好情况也只是把 59.3 变成 60，却要付出下面第 3 条的代价。
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

**本机基线策略**：`perf/baseline.json` 仍是 P7 之前的采集（10-24），故意没有覆盖——它是
「优化前」的唯一凭据。P7 全部提交之后已在同一台机器重采一次（10-27 13:17，
见 `perf/report.md`），基线是否推进（`--update`）由维护者决定，不自动做。
