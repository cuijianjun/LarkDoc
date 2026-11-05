# 性能：基线、收口手段与虚拟化决策

> 维护者历史资料，仅在仓库保留。下文性能数字保持原采样口径；最新功能验收见[验证资产](../../dev/05-验证资产.md)。
> 2026-11-05 六端补测发现 `0.14.4` 的应用 `onCallbackError` 被内部处理器覆盖，旧“完整回调”记录未覆盖这个异常通知路径。
> `0.14.5` 的同包模拟服务器复验为 90/90，应用与内部错误通道各获一次通知；这次没有新增速度采样。

2,000 块压力夹具（seed 42，本机 headless Chromium）的性能基线，以及 上一轮性能收口这一轮的处置口径与结论。数据由 `scripts/perf/measure.mjs` 采集、`scripts/perf/report.mjs` 判定，人读版报告在 `perf/report.md`；`perf/baseline.json` 是门禁基线（退化超 20% 时 `npm run check:perf` 非零退出，CI 见 `.github/workflows/perf.yml`）。

## 0.14.4 发布准备：当前验证范围（2026-11-05）

本次发布准备补齐初始化式 HTTP 上传、完整回调、文档和在线 demo。这里记录已完成的本地验证，**不表示版本已经发布或 GitHub Pages 已经部署**。本轮没有新增速度采样；后面的优化前后耗时、样本条件和未达到的性能目标保持原记录。

- **库门禁**：Node24 完整 check gate 为 92 个测试文件、1972 项通过；独立审查另跑 89 个单测文件、1944 项通过。旧 DOM 快照检查内部跳过，不能当作已执行的浏览器验证。Node14 全量产物校验及 94 项 Vditor 检查通过。
- **各环境运行时**：准备的 0.14.4 包与此前 HTTP 验证包 `cd8436a9` 的 532 个 JS 文件逐字节一致，因此沿用同一运行时代码在 13 个环境/入口中的 HTTP、URL/base64、五种来源及适用回调验证。后续修改只涉及文档和 demo，没有重新声称一次新的全环境速度测量。
- **新构建的静态 demo**：11 项浏览器检查通过，覆盖实际 Mermaid SVG、公式与本地字体、base64 选图/粘贴和完整回调、非法 MIME 拒绝、未填服务器地址时取消且不发请求、真实 multipart 上传到本地模拟服务并按 `code/data.url` 映射后加载图片、业务失败不回退 base64、主动取消后无晚到插入、390px 移动布局及部署子路径与文档导航。pageerror、失败请求/404 和控制台 warn/error 均为空。

Demo 证据为本地 `release-0.14.4/demo-browser.json`。浏览器范围仍是 Chromium，上传服务为本地模拟后端；尚未与具体业务服务器联调，也不据此承诺其它浏览器、所有 Mermaid 类型、HMR 或绝对耗时 SLO。

## 第二轮：构建速度优化与各环境复测（2026-11-05）

状态：最终性能采样及各环境回归完成；独立审查Simplicity/Correctness均PASS，APPROVE。库归档为 `lark-doc-0.14.2-speed-21e7ac87.tgz`，SHA256 `21e7ac87db0c812eaa6e6f4f4640e237311d23a92e9a28a7f360883d596fd047`，13172360B/642文件。下方第一轮数据保留为历史，不与本轮混算。

### 优化前后耗时

| 命令与模式 | 优化前中位数 | 最终中位数 | 变化 |
| --- | ---: | ---: | --- |
| 库 `npm run build:esm` 冷构建（Node22） | 47.98s | 39.34s | 减少 18.0% |
| 库同命令无改动缓存构建 | 1.52s | 1.69s | 增加 0.17s |
| Vue2 `npm run build` 冷构建（Node14） | 83.26s | 66.12s | 减少 20.6% |
| Vue2同命令缓存构建 | 71.39s | 5.32s | 减少 92.5% |

每格均为三次中位数。库冷样本优化前46.74–52.16s，最终38.67–39.61s；Vue2最终冷样本61.06/66.12/83.32s、热样本3.94/6.62/5.32s，较慢样本完整保留。Vue2旧冷范围77.78–112.58s，说明本机仍有负载方差；不能只引用最快一次61.06s。

- 全部任务构建与浏览器结束后串行计时。库两个版本使用同一普通全新安装依赖树，20591文件/191594175B的工具代码指纹前后相同；从本轮前源快照切换到最终源，不安装或升级中间工具。Vue2固定Node14.21.3/npm8.19.4，32569个非SDK依赖代码、源/hidden锁及实际issuer选项全复核；SDK从第一轮2e61切到21e，依赖框架/编译器版本未变。
- 库冷只删除测试副本dist与`_codex/rollup-inputs.json`；Vue2冷只删测试dist和`node_modules/.cache`。都保留node_modules、npm下载缓存、OS页缓存。热不主动删除产物或缓存，构建命令仍可按自身规则清空输出。
- Vue2最终顺序为cold1→warm1→cold2→cold3→warm2→warm3；前两次是同一普通manifest候选样本，复用前逐一证明源码/配置字节、642个SDK文件、工具、选项、命令和无并发条件一致。仪器profile、负向测试和其它并行功能构建不计入这些中位数。
- 这里的库指标专指`build:esm`，包含PM和共享图表前置构建；不能推断全量`build:all`、首次安装或开发服务器/HMR的提速。正常完整all及prepack均成功；最终pack含缓存prepack8.99s，仅为工作流记录，未作冷all前后对比。无改动缓存也不等于编辑后的增量编译。

### 根因与修改范围

1. 主、Vue2兼容和Element原来各自编译相同Mermaid。库现在同格式共享运行时，CJS/ESM分别产出；full保留静态加载、lite仍排除实现、CDN feature UMD自含。共享产物纳入真实依赖图、语法、大小与输出hash校验，库压缩最多2 worker。
2. Vue2原生产cache=false，且默认Terser可开15 worker。本机新SDK的独占profile约47s处于Terser，重复大型模块与过高压缩并行构成主要成本。最终只限制Terser为4，Babel默认15、CSS并行、全部依赖转译/usage补丁与压缩语义保留；生产开启Webpack5原生filesystem cache，显式跟踪Vue/Babel配置和锁文件。应用工具链未更换。
3. 兼容回归发现ESM external缓存被后续UMD复用，以及Webpack4误解析压缩后具名类内部作用域。分别用UMD独立缓存组和ESM保留类名修复；真实CJS动态import为一层default，真实Webpack4须创建编辑器并渲染，不能只以编译成功验收。

只开cache时Vue2冷89.80/热4.88s，冷未改善；全parallel4或移除Babel线程也未改善。仅压缩并行4的103份产物/14882635B与当前SDK基线逐字节一致。直接排除三个大vendor会移除现有目标所需core-js修补，未采用；共享整个Core的更大装配改动也未实施。无新依赖、语法下限或体积阈值放宽。

缓存失效已经验证：宿主可见文案进入真实JS后恢复消失；Vue配置、Babel配置、锁文件分别只变一个文件，原生日志均出现build dependencies have changed，随后精确还原源码/锁/SDK/工具及产物。未另行制造保留旧缓存的同版本SDK真实热替换；已证明锁文件内容变化触发失效，普通clean CI不会被冒充为该热替换证据。

### 各环境真实测试

| 环境 | 安装/构建 | 图表、公式、本地字体 | 图片完整回调与URL/base64 | 清理 |
| --- | --- | --- | --- | --- |
| Vue2/CLI5/Webpack5/Node14 | 普通clean CI、app及真实wrapper通过；新Terser4已复验 | 真实SVG/KaTeX/同源font通过 | 五来源及全部适用回调通过；新配置复验通过 | 真实路由及wrapper组件卸载 |
| Vue3/Vite7/Node22 | 普通clean CI、app及真实wrapper通过 | 通过 | 通过 | 路由及组件卸载通过 |
| React/Vite7/Node22 | 普通clean CI、app及真实wrapper通过 | 通过 | 通过 | 页面公开destroy；真实wrapper组件卸载通过 |
| 原生ESM default/full/lite+features/Element | 实体21e归档静态托管 | 五入口真实SVG/公式/font通过 | 命令式完整矩阵通过 | 销毁与共享Provider取消隔离通过 |
| CDN UMD与全部feature脚本 | 同目录本地加载通过 | 真实SVG/公式/font通过；全部feature Word回读通过 | 完整矩阵通过 | 通过 |
| Webpack4.47/Node14普通主入口 | 同21e普通clean CI；真实module选择，无根alias；编译0error0warning | SVG/公式/本地font与六缺失API补齐通过 | 独立完整上传矩阵通过 | 通过 |

Terser4最终配置下，Vue2/WC/真实wrapper三浏览器矩阵再次通过；应用103文件/14882635B、wrapper50文件/6971608B均与原压缩并行输出逐字节一致。V3/React及归档未变化，只复核指纹，沿用本轮同21e的完整构建与浏览器证据。新增记录`speed-round2-vue2-terser4-regression.json`与对应log。

三宿主安装均为同一归档642文件实体（非symlink），逐项hash/integrity匹配；所有其它物理包代码与源/隐藏锁一致。V3原锁Rollup4.63、React原锁4.65，各按自己的工具版本验证。定向10文件197tests、真实归档CJS协同9tests通过；ESM双端同步/38个嵌套位置/caret与销毁通过。

完整上传回调为 `beforeUpload / upload / onStart / onProgress / onRetry / onSuccess / onError / onCancel / onReject / onSettled`。每个宿主测试paste/select/drop/replace/crop各自返回URL和base64；重试、否决、前置取消、失败、非法MIME、超限和显式取消通过paste验证公共管线，检查source/mode/唯一终态、晚到结果与配置更新保留editor/JSON/title/undo。无自定义upload时真实FileReader本地base64也通知应用；直接插入已有URL不会伪造文件上传回调。未声称每来源×每负向的笛卡尔全测或真实上传后端联调。

浏览器pageerror、HTTP404、失败请求和consolewarn/error均为0。保留既有npm弃用、Vue2 asset/entrypoint-size及第三方Babel大文件Note、Vite>500KB chunk建议。没有隐藏警告或提高预算。测试使用本机Chromium与Mermaid flowchart/KaTeX；其它Mermaid类型、非Chromium、HMR和真实上传服务仍未单独验证，用户也未给绝对耗时SLO。

证据集中于`/tmp/lark-doc-master-audit-20261104/implementation/`：`speed-round2-21e7ac87-library-formal.json`、`speed-round2-vue2-terser4-formal-timings.json`、`speed-round2-vue2-final-21e7ac87-timings.json`（缓存负向）、`speed-round2-21e7ac87-matrix-install-verification.json`及对应functional.log、`speed-round2-final-library-gates.log`、`speed-round2-21e7ac87-{native,imperative,cdn,webpack4-upload,extra}-browser.log`、`speed-round2-21e7ac87-published-collab-tests.log`与Node14日志。代码与Spec-kit明细见`specs/002-master-integration-fixes/`。

## 第一轮库构建与体积口径（2026-11-04/05，第二轮前基线）

库使用 Rollup，应用保留原工具链。基线 master 为 `4e7cc43`；本地审阅包为 `lark-doc-0.14.2-verified.tgz`，SHA256 `2e61c605176035185fb9a3eeebadf6b07649e475e3e51144411ec054362df4da`，18,674,123 bytes，尚未发布或合并。它与功能、浏览器及计时包 `8bd54232…` 唯一差异是打包指南中“待验证”改为已验证；其余640项、全部527个JS文件、package元数据、CSS及字体逐字节相同。最终归档在各消费端再次普通干净安装并核对641项完整性。详细日志集中 `/tmp/lark-doc-master-audit-20261104/implementation/`，验收索引见本轮 specs/002 的 tasks.md。

| 入口 | editor gzip / B | total 静态初始 JS / B gzip | 含 Rollup 动态区块 / B gzip |
| --- | ---: | ---: | ---: |
| 默认 ESM | 261548 | 433946 | 1766145 |
| lite | 248924 | 421275 | 425055 |
| full ESM | 全量 | 1772564 | 1772619 |
| Element ESM | 不拆 editor | 470228 | 1806819 |
| Element UMD | 不拆 editor | 461074 | 主文件以外的 feature UMD 另计 |
| 默认 CJS | 不拆 editor | 492962 | 1825578 |
| full CJS | 全量 | 1831745 | 1831802 |
| collab ESM | external 单列 | 3067 | 3067，不含宿主协同依赖 |

库数字按每文件 zlib 默认 gzip 后求和，与门禁一致。默认 ESM/lite 的转发入口各约0.6KiB，不能当编辑器体积。editor 仅排除纯 Tiptap、PM、core-js 运行时，total 含实际引用的本地离线 PM 图。CJS总量包含库锁中的25个外部PM wrapper/require文件（145253B gzip）；实际新消费者解析到PM view1.42.9时，对应外部145420B，默认CJS初始493129B，仍低于1080000B预算。CSS单独394351 bytes，字体独立发布。ESM editor310KB、lite editor300KB、Element475KB、CJS1080KB、collab4KB预算未提高，全部通过。

Element的独立脚本不属于Rollup dynamic-import边，不能用主UMD461074B冒充全部功能。额外gzip分别为 math81166、mermaid1008319、highlight17549、markdown16106、office232750B；加齐五组总JS为1816964B。CDN实际加载全部feature并完成DOCX Blob→Mammoth HTML回读，未请求外网。默认/full/lite/Element/CDN均验证了SVG、公式、真实本地字体、明暗主题切换及卸载。

| 命令 | 可比较基线冷 / 热中位数（s） | 修复分支冷 / 热中位数（s） | 说明 |
| --- | ---: | ---: | --- |
| 库 `npm run build:esm` | 16.968 / 16.919 | 54.454 / 1.950 | 冷构建新增ES2018降级、压缩、PM共图成本；热为无源码变化且命中已校验输出缓存 |
| React `npm run build` | 35.679 / 35.057 | 34.619 / 34.584 | Node22/npm8、Rollup4.65及64个构建工具包内容指纹一致；两端原始实体tgz，无overlay/profile |
| Vue2 `npm run build` | 无：旧包普通安装冲突 | 103.173 / 86.016 | 仅对已编译lark-doc/dist跳过重复Babel，其他依赖/工具链不变 |
| Vue3 `npm run build` | 无：旧包普通安装冲突 | 34.762 / 36.045 | 不以force/legacy-peer-deps绕过冲突伪造基线 |

每个中位数取冷/热各3次。冷仅清本应用dist及构建缓存，保留已安装依赖、npm缓存和操作系统缓存；热不主动删除输出或缓存。测试编译任务串行，Vue2使用Node14.21.3/npm8.19.4，库、Vue3、React使用Node22.13.0/npm8.19.4。React有效对照在原锁普通ci重建的旧包控制副本与修复包之间交错执行，工具树指纹为 `f3ea61083d9d9c99d33391f39b5781963058ef156d56ed32b824b941e9585d77`，结果见 `ac008-matched-8bd-formal.json`、最终安装树复核见 `ac008-matched-final-validation.json`。未发现可比React构建新增回退；Vue2/Vue3无有效before时间，不据此推断提速。

早期React33.899/33.612s基线的实际Rollup是4.67.5，偏离其源码锁4.65.0，与修复侧条件不同，因此不作前后比较。相关旧样本与profile只保留审计用途，不能归因库回退；禁压缩与guard改写的试验均未应用生产，PURE注解保留列为非阻塞改进。

全量发布工作流正常 `npm pack`（含prepack/all）462.79s，与Node14兼容构建并行，仅作工作流可用性记录，不能与旧179.33s独立all直接换算提速比例。无改动 `npm run build:all` 复用6.20s；再次正常pack5.255s且归档SHA不变。人为破坏输出使artifacts:check非零，恢复原字节后通过。最新Node14默认库build及真实归档full+DOM编辑验证均通过；并行负载下的Node14耗时不当性能比较。

应用的真实加载观察图另按gzip9统计：Vue2普通/WC约1666914/1673050B，Vue3约526493B，React约521481B。它们是原产品页挂载、初始内容及一次粘贴的资源集合，各页内容不同，不当相同工作负载或纯静态入口图；库表也不与这个压缩级别直接混算。所有原有大chunk/resource warning保留。

这不等于“编译慢已彻底解决”：Vue2仍约103/86秒，库冷构建反而更慢；无改动缓存收益也不代表编辑后的增量编译。用户未指定绝对耗时SLO，本轮只报告数据，不宣称足够快；开发服务器启动/HMR未单独计时。浏览器验证为本机Chromium和Mermaid flowchart/KaTeX，其他Mermaid图表类型未逐类验证。上传采用确定性假实现和本地FileReader，没有验证真实上传服务。

以下10-24/10-27的压力夹具结果为历史运行时记录，不作为本轮构建提速或体积验收证据。

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
