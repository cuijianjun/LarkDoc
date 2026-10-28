/**
 * attribute.mjs — P8-01 归因：把 `mountToTypeableMs` 的 30+ 秒拆成可归因的分项。
 *
 * 立项（`docs/superpowers/handoffs/2026-10-28-p8-mount-kickoff.md` §5）的决策点是：
 *
 *   「DOM 创建 + HTML parse 是否 ≥ 60%？」
 *     是 → 走方案 A（分段渐进灌入），因为成本确实在「一次性建 DOM」上；
 *     否 → 先修归因出的最大分项，A 顺延。
 *
 * 在拿到分项表之前回答这个问题只能靠猜，而 P7 已经因为「把推测当结论」返工过一次
 * （`perf/report.md` 的订正块）。所以本脚本只做一件事：**量，不优化**。
 *
 * ## 三块产出
 *
 * 1. **分项表**（`PERF_BLOCKS` 块，默认 2,000）：把一个 setContent 拆成
 *    HTML parse / schema 解析 / DOM 创建 / 装饰计算 / 首次 layout / focus。
 * 2. **规模曲线**（125 / 250 / 500 / 1000 / 2000 块）：单块成本是否随文档增大而上升。
 *    上升 = 存在隐藏的 O(n²)，那方案 A（分段灌入）就不是「换个节奏」而是「换掉一整个
 *    平方项」，收益远大于按比例估算的结果。
 * 3. **按块类型的单块成本**（段落 / 标题+缩进 / 列表 / 表格 / 引用各 200 块）：
 *    决定「先修大块」是否比「先改节奏」划算。
 * 4. **分段灌入验证**（同一篇文档切 1 / 5 / 10 / 25 段）：决策点判「是」之后，
 *    实测方案 A 到底能把平方项砍掉多少 —— 这是收益，不是推算。
 *    每一段再按「解析 / 事务 / updateState」逐刀记账（P8-01b）：单篇文档只有一条总曲线，
 *    切段则给了**同一份成本在不同文档大小上被重复支付**的 k 个样本 —— 这是唯一能用
 *    一次运行就看清楚「随文档变大而上升的成本到底落在哪一段」的实验。
 *
 * ## 分项是怎么拆出来的（重要，别当成黑箱）
 *
 * `setContent(content)` 是同步的，内部依次做：① 内容 → Node 树（HTML 走原生解析 + DOM 走树；
 * JSON 走 `nodeFromJSON`）；② 一笔替换事务（插件状态、`apply`）；③ `view.updateState` ——
 * 建全部 ViewDesc（= DOM 创建）+ 应用装饰集（derive 层的装配）。首次排版（layout）不在这段里，
 * 浏览器延后到下次读几何信息时才做。
 *
 * 三个不依赖改源码的手段：
 *
 * 1. **劫持 `view.updateState`**（页内给实例挂一层计时包装，只在测量窗口内生效）——
 *    直接把 ③ 从 setContent 里切出来。这是分项表里最关键的一刀：③ 就是「建 DOM」本身。
 * 2. **装饰打点**从 derive 层既有探针取（`globalThis.__larkDocPerf` 的 `rebuild` 样本，
 *    `src/core/derive/index.js` 的 `decorations()` 自带计时）。于是
 *    **DOM 创建 = ③ − 装饰计算**，剩下的是真正的节点构建。
 * 3. **HTML 轮 vs JSON 轮**：同一篇文档分别以 HTML 与 JSON 灌一次，两轮 ③ 完全相同
 *    （同一个文档、同一批节点），差异只在 ① —— 于是
 *    **「原生 HTML 解析 + DOM 走树」≈ HTML 轮 setContent − JSON 轮 setContent**。
 *
 * 三刀之后 setContent 被切成四段且首尾闭合：解析 + 事务/插件状态 + DOM 创建 + 装饰计算。
 * 闭合关系由脚本自己断言（下称「闭包检查」），对不上就报错而不是硬凑一个百分比 ——
 * P7 因为「把推测当结论」返工过一次（`perf/report.md` 的订正块），P8 不接受凑数。
 *
 * **一个已知偏置**：分项轮（Run B）在 setContent 之前先做了一次原生 HTML 解析，等于把浏览器
 * 的解析路径跑热了一遍，所以它的 `setContentMs` 会略低于冷机。为此另跑一轮**纯冷机**
 * （Run A：只 setContent + layout + focus），它才是与 `measure.mjs` 的 `mountToTypeableMs`
 * 可比的数。分项表的**比例**以 Run B 自己的「setContent + layout + focus」为分母
 * （这样四段才首尾相接）；**绝对水平**看 Run A，两者差额会在表头一起打出来。
 *
 * ## 用法
 *
 *   node scripts/perf/attribute.mjs                 # 四段全跑（约 6~9 分钟）
 *   PERF_ATTRIBUTE_ONLY=phase   node scripts/perf/attribute.mjs
 *   PERF_ATTRIBUTE_ONLY=scaling node scripts/perf/attribute.mjs
 *   PERF_ATTRIBUTE_ONLY=types   node scripts/perf/attribute.mjs
 *   PERF_ATTRIBUTE_ONLY=chunk   node scripts/perf/attribute.mjs
 *
 * 分段跑不会互相覆盖：每次只写自己量到的段，其余从 `perf/.run/attribute-result.json`
 * 沿用（结果里用 `measuredSections` / `carriedSections` 记明哪个数是哪次采的）。
 *
 * 环境变量：`PERF_SEED` / `PERF_BLOCKS` / `PERF_ATTRIBUTE_REPS` / `PERF_ATTRIBUTE_ONLY`
 * / `PERF_CHUNKS`（切段数列表，默认 `1,5,10,25`）/ `PERF_DISABLE_APPEND`（屏蔽哪些插件的
 * `appendTransaction`，`larkDoc` / `autolink` / `all`，逗号分隔；**只用于验证平方项归属，
 * 量出来的数不是产品口径**）/ `PERF_SKIP_LOAD_WAIT` / `PERF_LOAD_WAIT_MS`
 * / `PERF_LOAD_MAX` / `LARK_DOC_CHROMIUM`
 *
 * 原始结果写 `perf/.run/attribute-result.json`（该目录已在 .gitignore 里）。
 * **门禁不读它**：归因是信息，不是判据 —— 只有 `measure.mjs` 的 7 项指标进 gate。
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildDocBlocks, buildDocHtml } from './build-doc.mjs'
import { findChromium, loadChromiumDriver, prepareHostPage, REPO_ROOT, serveStatic, waitForHostReady } from './browser.mjs'
import { evaluateLoad } from './preflight.mjs'
import { median } from './stats.mjs'

const SEED = Number(process.env.PERF_SEED || 42)
const BLOCKS = Number(process.env.PERF_BLOCKS || 2000)
const REPS = Number(process.env.PERF_ATTRIBUTE_REPS || 3)
const ONLY = process.env.PERF_ATTRIBUTE_ONLY || 'all'
const LOAD_WAIT_MS = Number(process.env.PERF_LOAD_WAIT_MS || 180000)
const LOAD_POLL_MS = 3000
const LOAD_MAX = Number(process.env.PERF_LOAD_MAX || 0)

// 规模曲线的采样点。2000 是基线口径，往下取到 125 是为了让「每块成本」在 16 倍跨度上可比 ——
// 线性的话这五个点的 ms/块 应当基本持平；只要末端翘起来，就存在超线性项。
const SCALE_POINTS = [125, 250, 500, 1000, 2000]
// 按类型测量时每种类型铺多少块。200 足够让单块成本稳定，又不会让表格那组跑成分钟级。
const TYPE_BLOCKS = 200
// 分段灌入的切段数。`PERF_CHUNKS=1,10,25` 可覆盖 —— 拆平方项时用少数几个点数就够，
// 不必为一张好看的曲线付满 4 次灌入的钱。
const CHUNK_COUNTS = (process.env.PERF_CHUNKS || '1,5,10,25')
  .split(',')
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isFinite(value) && value >= 1)

// 屏蔽实验（P8-01b 的第三刀）。拍板顺序是「先量出谁贵，再验证它是不是平方项本体」：
// 计时只证明 `appendTransaction` 花了 31 s，不证明「它花的钱随文档变大而增长」。
// 唯一能证伪的做法是把它摘掉重跑 —— 若平方项（`k ≈ 1.8`）跟着消失，因果就成立。
// 值匹配的是插件 key 的**前缀**（`larkDoc$` / `autolink$`），`all` 表示全摘。
const DISABLE_APPEND = (process.env.PERF_DISABLE_APPEND || '')
  .split(',')
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean)

const round1 = (value) => Math.round(value * 10) / 10
const round2 = (value) => Math.round(value * 100) / 100

/**
 * 页内探针。`decompose: false` 时只量端到端（冷机口径，用于 Run A 与规模/类型曲线）。
 *
 * 为什么一切都放在一次 `evaluate` 里：跨 evaluate 的往返是 CDP 的毫秒级网络开销，
 * 而这里量的是几十毫秒到几十秒的 JS 同步段，中间插一次往返就把首屏那部分打散了。
 *
 * @param {{ content: string|object, decompose: boolean, wantJson: boolean }} args
 *   `content` 是 HTML 字符串或 Tiptap 的 JSONContent；`wantJson` 让冷机轮顺手把
 *   `getJSON()` 结果带回来，供后面 HTML 轮 / JSON 轮做差（省掉一次 30 s 的灌入）。
 */
function probe({ content, decompose, wantJson }) {
  const editor = window.__larkDoc.getEditor()
  const view = editor.view
  const host = document.getElementById('doc')
  const t = () => performance.now()
  const out = {}

  // 关键一刀：给实例挂一层 view.updateState 计时。
  // `original` 取的是原型方法（未绑定），所以必须 `call(this, state)` 才能保住 this。
  // 只在测量窗口内生效，出窗口立刻还原 —— 后面的 layout/focus 不能算进这一段。
  const original = view.updateState
  const update = { ms: 0, calls: 0 }
  view.updateState = function patchedUpdateState(state) {
    const start = performance.now()
    try {
      return original.call(this, state)
    } finally {
      update.ms += performance.now() - start
      update.calls += 1
    }
  }

  const sink = { samples: [] }
  window.__larkDocPerf = sink
  const mark = t()
  try {
    editor.commands.setContent(content)
  } finally {
    out.setContentMs = t() - mark
    view.updateState = original
    window.__larkDocPerf = null
  }
  out.viewUpdateMs = update.ms
  out.viewUpdateCalls = update.calls

  // 原生 HTML 解析的参考量。**必须放在测量窗口之后**：2,000 块时这一句会在同一页里
  // 造出 21 万个 DOM 节点的临时文档，放在窗口之前虽然不计时，但它的垃圾会在
  // `setContent` 期间被 GC 回收 —— 实测把 Run B 从 ~36 s 抬到 ~45 s（+26%）。
  // 量一个参考值不该改变被量的对象。
  if (decompose && typeof content === 'string') {
    const parseMark = t()
    new DOMParser().parseFromString(content, 'text/html')
    out.htmlParseMs = t() - parseMark
  }

  // 首次 layout：浏览器延后到读几何信息时才做，所以这一段成本能单独框出来。
  // 若 setContent 内部已经读过几何信息（部分插件会），这里会接近 0 —— 那本身也是个结论。
  const layoutMark = t()
  void host.offsetHeight
  void host.getBoundingClientRect().height
  out.layoutMs = t() - layoutMark

  const focusMark = t()
  editor.commands.focus('start')
  out.focusMs = t() - focusMark

  const rebuild = sink.samples.filter((sample) => sample.path === 'rebuild')
  out.decorationMs = rebuild.reduce((sum, sample) => sum + sample.ms, 0)
  out.decorationRebuilds = rebuild.length
  out.decorationIncrementals = sink.samples.length - rebuild.length

  if (wantJson) out.json = editor.getJSON()

  // 规模曲线上「块」与「DOM 节点数」要一起看：节点数是真正的成本驱动量，
  // 块数只是 fixture 的计量单位（一个表格块能长成 40+ 个节点）。
  out.blocks = view.state.doc.childCount
  out.domNodes = host.querySelectorAll('*').length
  // 注意：这个函数是序列化到页内执行的，拿不到 Node 侧的辅助函数（round1 之类），
  // 一切计算都得自给自足。
  out.contentKB = Math.round(((typeof content === 'string' ? content.length : JSON.stringify(content).length) / 1024) * 10) / 10
  return out
}

/**
 * 分段灌入探针（决策点判「是」之后的收益验证，不是产品实现）。
 *
 * 做法与方案 A 一致：**按顶层块边界**切段，第一段 `setContent`，其余 `insertContentAt` 追加到文末。
 * 它回答的是「二次项能不能靠换灌入节奏消掉」：
 *
 * - 若平方项来自「每块解析时要扫一遍已有文档」，切成 k 段后每段的扫描面只剩 1/k，
 *   总解析成本降到约 1/k —— 段数越多越快，直到被打点开销追上；
 * - 若平方项来自别处（比如每段都要重新布局整个视口），分段只会持平甚至更慢。
 *
 * 必须同时校验**最终文档没被切坏**（块数 / 节点数与整篇一致），否则「变快」可能只是
 * 悄悄丢内容 —— 这类假收益在 P7 里已经出现过一次。
 */
/**
 * 给每个插件的 `state.apply` / `appendTransaction` 挂计时（P8-01b 的第二刀）。
 *
 * 为什么能这样挂：`EditorState.apply()` 遍历的是 `config.fields`，里面存的就是
 * 各插件 `spec.state` **对象本身**（不是拷贝、不是 bound 副本），所以改
 * `spec.state.apply` 会被立即生效；`appendTransaction` 更是每次事务现读 `plugin.spec`。
 *
 * 为什么必须挂：`applyTransaction` 的总时长只说明「事务贵」，不说明**谁**贵。
 * 上一轮已经排除了 updateState（整篇只占 1.8%）与装饰重建（0.3%），
 * 剩下的只能是「某个插件在每笔事务里做全文档工作」或「step 应用本身」。
 * 这两者一个能修、一个只能认命，必须先分清。
 *
 * 匿名插件用 `props` / `spec` 的键集合标识 —— Tiptap 自建的插件多数没有 key，
 * 但「有 decorations 无 state」这类指纹足以定位到具体扩展。
 */
function instrumentPlugins(view) {
  const entries = []
  const restores = []
  const plugins = view.state.plugins || []
  for (let index = 0; index < plugins.length; index += 1) {
    const plugin = plugins[index]
    const spec = plugin.spec || {}
    const entry = {
      key: plugin.key || `#${index}`,
      props: Object.keys(plugin.props || {}).join('+'),
      specKeys: Object.keys(spec).join('+'),
      applyMs: 0,
      applyCalls: 0,
      appendMs: 0,
      appendCalls: 0,
    }
    const fields = Array.isArray(spec.state) ? spec.state : spec.state ? [spec.state] : []
    for (const field of fields) {
      if (!field || typeof field.apply !== 'function') continue
      const originalApply = field.apply
      field.apply = function timedApply(...args) {
        const start = performance.now()
        try {
          return originalApply.apply(this, args)
        } finally {
          entry.applyMs += performance.now() - start
          entry.applyCalls += 1
        }
      }
      restores.push(() => {
        field.apply = originalApply
      })
    }
    if (typeof spec.appendTransaction === 'function') {
      const originalAppend = spec.appendTransaction
      spec.appendTransaction = function timedAppend(...args) {
        const start = performance.now()
        try {
          return originalAppend.apply(this, args)
        } finally {
          entry.appendMs += performance.now() - start
          entry.appendCalls += 1
        }
      }
      restores.push(() => {
        spec.appendTransaction = originalAppend
      })
    }
    entries.push(entry)
  }
  return {
    entries,
    restore() {
      for (const restore of restores) restore()
    },
  }
}

function probeChunked({ chunks, disableAppend }) {
  const editor = window.__larkDoc.getEditor()
  const view = editor.view
  const host = document.getElementById('doc')
  const t = () => performance.now()
  const r1 = (value) => Math.round(value * 10) / 10
  const out = { perChunkMs: [], detail: [], disabledPlugins: [] }

  // 屏蔽实验：把匹配到的插件 `spec.appendTransaction` 置 `null`。
  // ProseMirror 的 `EditorState.applyTransaction` 里是 `if (plugin.spec.appendTransaction)`
  // 的裸真值判断（`prosemirror-state` 的 `applyTransaction`），所以置 `null` 等价于「这个插件
  // 没有 appendTransaction」，不需要重建编辑器、也不需要改 `src/`。
  // 必须在挂计时**之前**做：否则被摘掉的插件还会在表里留一行 0 ms，读的人会以为它便宜。
  const disableRestores = []
  if (Array.isArray(disableAppend) && disableAppend.length) {
    const plugins = view.state.plugins || []
    for (const plugin of plugins) {
      const key = String(plugin.key || '')
      if (!key) continue
      const hit = disableAppend.some((pattern) => pattern === 'all' || key.toLowerCase().startsWith(pattern))
      if (!hit || typeof plugin.spec?.appendTransaction !== 'function') continue
      const original = plugin.spec.appendTransaction
      plugin.spec.appendTransaction = null
      out.disabledPlugins.push(key)
      disableRestores.push(() => {
        plugin.spec.appendTransaction = original
      })
    }
  }

  // 两条钩子都必须按「每次调用」增量记账，而不是只记总和：
  // 只有把第 k 次的耗时和「那一刻文档多大」对齐，才看得出成本是不是随文档变大而上升。
  const sink = { samples: [] }
  let updateMs = 0
  let updateCalls = 0
  let applyMs = 0
  let applyCalls = 0
  // 事务的「步数」是这一轮唯一能硬证的机制指标：`applyBlockIdFixes` 是「每缺一个 id 建一个
  // `setNodeMarkup`」，若 fix 事务真的带着 ~块数 条 step，那 `larkDoc$` 与它引起的
  // `combineTransactionSteps` 重放就都是 O(步数) 起步 —— 不必再靠推测。
  // 注意要读 `applyTransaction` 的**返回值**：追加事务走 `applyInner`，不经过这个钩子。
  const transactions = []

  const originalUpdate = view.updateState
  view.updateState = function patchedUpdateState(state) {
    const start = performance.now()
    try {
      return originalUpdate.call(this, state)
    } finally {
      updateMs += performance.now() - start
      updateCalls += 1
    }
  }

  // 第三刀：`applyTransaction`。Tiptap 的 `dispatchTransaction` 走的是
  // `view.state.applyTransaction(tr)` → `view.updateState(state)`，**不经过 `view.dispatch`**，
  // 所以钩 `view.dispatch` 会一点都量不到。这里钩 `EditorState` 原型上的 `applyTransaction`，
  // 它同时包住「应用 step（重建文档树）」与「插件 state.apply（含 derive 层装饰重建）」。
  const stateProto = Object.getPrototypeOf(editor.state)
  const originalApply = stateProto.applyTransaction
  stateProto.applyTransaction = function patchedApplyTransaction(tr) {
    const start = performance.now()
    try {
      const result = originalApply.call(this, tr)
      // `result.transactions` 是「根事务 + 各插件 append 出来的事务」，按应用顺序排列。
      // 只留步数这种整数，不留事务对象 —— 后者会拖住文档树，把 GC 压力带进下一段测量。
      transactions.push({ steps: tr.steps.length, appended: result.transactions.slice(1).map((item) => item.steps.length) })
      return result
    } finally {
      applyMs += performance.now() - start
      applyCalls += 1
    }
  }

  const runChunk = (index, insert) => {
    const blocksBefore = view.state.doc.childCount
    const sizeBefore = view.state.doc.content.size
    const applyBefore = applyMs
    const updateBefore = updateMs
    const callsBefore = updateCalls
    const txBefore = transactions.length
    sink.samples = []
    window.__larkDocPerf = sink
    const mark = t()
    insert()
    const totalMs = t() - mark
    window.__larkDocPerf = null
    const chunkApply = applyMs - applyBefore
    const chunkUpdate = updateMs - updateBefore
    const rebuild = sink.samples.filter((sample) => sample.path === 'rebuild')
    const decoration = rebuild.reduce((sum, sample) => sum + sample.ms, 0)
    out.perChunkMs.push(totalMs)
    out.detail.push({
      index,
      blocksBefore,
      sizeBefore,
      totalMs: r1(totalMs),
      // 事务净额 = applyTransaction − 装饰重建。装饰重建本身就发生在插件 state.apply 里，
      // 属于事务，不属于 view.updateState —— 这一点是 P8-01b 在切段数据上确认的，
      // 分项表早期把它记在 updateState 底下是标错了位置（数值只占 0.3%，结论不变）。
      applyNetMs: r1(chunkApply - decoration),
      decorationMs: r1(decoration),
      decorationRebuilds: rebuild.length,
      updateMs: r1(chunkUpdate),
      updateCalls: updateCalls - callsBefore,
      // 解析 = 本段总耗时 − 事务 − 状态重建。它同时收下了 `insertContentAt` 里的其余开销
      // （HTML → Slice、emit('transaction') / emit('update')），所以只能当**上界**读。
      parseMs: r1(totalMs - chunkApply - chunkUpdate),
      // 这一段里发生的事务：`steps` 是根事务，`appended` 是各插件追加事务的步数。
      // 有了它，「块 id 补全是一块一步」这种机制判断就不用再靠读源码猜。
      transactions: transactions.slice(txBefore),
    })
  }

  // 页内拿不到 Node 侧的辅助函数（`page.evaluate` 只序列化被调的那一个），
  // 所以 `instrumentPlugins` 由 `runChunkedProbe` 先用源码注入到 `globalThis` 上。
  const makeInstrument = globalThis.__larkDocInstrumentPlugins
  const pluginProbe = typeof makeInstrument === 'function' ? makeInstrument(view) : { entries: [], restore() {} }
  try {
    // 首段用 setContent（与产品挂载同构），其余追加到文末 —— 段数=1 时退化成整篇。
    runChunk(0, () => editor.commands.setContent(chunks[0]))
    for (let i = 1; i < chunks.length; i += 1) {
      runChunk(i, () => editor.commands.insertContentAt(view.state.doc.content.size, chunks[i]))
    }
  } finally {
    // 三条钩子都改在**原型/实例/spec**上，漏还原会污染同页后续所有测量（切段数是顺序跑的）。
    pluginProbe.restore()
    // 屏蔽实验的还原排在插件计时之后：计时钩子包的是「原来那个函数」，先把外壳脱掉、
    // 再把本体装回去，顺序反了会把被摘掉的插件永久留在 null 上。
    for (const restore of disableRestores) restore()
    view.updateState = originalUpdate
    stateProto.applyTransaction = originalApply
  }
  out.plugins = pluginProbe.entries
    .filter((entry) => entry.applyCalls || entry.appendCalls)
    .sort((a, b) => b.applyMs + b.appendMs - (a.applyMs + a.appendMs))
  out.setContentMs = out.perChunkMs.reduce((sum, ms) => sum + ms, 0)
  out.applyMs = applyMs
  out.applyCalls = applyCalls
  out.updateMs = updateMs
  out.updateCalls = updateCalls

  const layoutMark = t()
  void host.offsetHeight
  void host.getBoundingClientRect().height
  out.layoutMs = t() - layoutMark

  const focusMark = t()
  editor.commands.focus('start')
  out.focusMs = t() - focusMark

  out.blocks = view.state.doc.childCount
  out.domNodes = host.querySelectorAll('*').length
  out.contentKB = Math.round((chunks.join('').length / 1024) * 10) / 10
  return out
}

/** 单块类型的 fixture：只铺一种结构，用来比较「一块多少钱」。 */
function typedHtml(type, count) {
  const parts = []
  for (let i = 0; i < count; i += 1) {
    if (type === 'paragraph') {
      parts.push(`<p>${i} 号段落：项目 文档 段落 标题 列表 表格 协作 编辑 性能 基线 渲染 装饰。</p>`)
    } else if (type === 'heading+indent') {
      parts.push(`<h2>${i} 号标题：项目 文档 段落</h2>`)
      parts.push('<p data-indent="1">项目 文档 段落 标题 列表 表格 协作 编辑。</p>')
    } else if (type === 'list') {
      parts.push(`<ul><li><p>${i}.1 项目 文档 段落</p></li><li><p>${i}.2 项目 文档 段落 标题</p></li></ul>`)
    } else if (type === 'table') {
      const rows = []
      for (let r = 0; r < 3; r += 1) {
        const cells = []
        for (let c = 0; c < 3; c += 1) cells.push(`<td><p>表${i}·${r}${c} 项目 文档</p></td>`)
        rows.push(`<tr>${cells.join('')}</tr>`)
      }
      parts.push(`<table><tbody><tr>${'<th><p>列头</p></th>'.repeat(3)}</tr>${rows.join('')}</tbody></table>`)
    } else {
      parts.push(`<blockquote><p>${i} 号引用：项目 文档 段落 标题 列表</p></blockquote>`)
    }
  }
  return parts.join('\n')
}

/**
 * 等价于 measure.mjs 的 `waitForIdleMachine`。
 *
 * 这里没有复用那个函数：它在 measure.mjs 内部（未导出），而把「等待策略」抄第二份
 * 比抄判据更危险 —— 两边一旦分叉，归因轮和采集轮会跑在不同的机器状态下，
 * 两张表放在同一份报告里就自相矛盾了。所以这里只保留**最小**的一份：同样调
 * `evaluateLoad`（同一个纯函数、同一张单测），差异只在日志前缀。
 */
async function waitForIdleMachine() {
  if (process.env.PERF_SKIP_LOAD_WAIT === '1') {
    console.warn('[attribute] PERF_SKIP_LOAD_WAIT=1，跳过负载等待 —— 本次数字可能偏热')
    return
  }
  const cores = os.cpus().length
  const startedAt = Date.now()
  for (;;) {
    const state = evaluateLoad({ load1: os.loadavg()[0], cores, limit: LOAD_MAX || undefined })
    if (state.idle) {
      console.log(`[attribute] 机器负载 ${state.known ? state.load1.toFixed(2) : '不可读'}（上限 ${state.limit}，${cores} 核），开始归因`)
      return
    }
    const waited = Date.now() - startedAt
    if (waited >= LOAD_WAIT_MS) {
      throw new Error(`等待 ${Math.round(waited / 1000)}s 后 1 分钟负载仍为 ${state.load1.toFixed(2)} > 上限 ${state.limit} —— 热机归因不可比`)
    }
    console.log(`[attribute] 机器仍在忙（load ${state.load1.toFixed(2)} > 上限 ${state.limit}），已等 ${Math.round(waited / 1000)}s...`)
    await new Promise((resolve) => setTimeout(resolve, LOAD_POLL_MS))
  }
}

/** 每次测量都用**全新的 page**：首次 layout 只有一次，复用页面就量不到了。 */
async function runProbe(browser, url, content, { decompose = false, wantJson = false } = {}) {
  const page = await (await browser.newContext()).newPage()
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await waitForHostReady(page)
    return await page.evaluate(probe, { content, decompose, wantJson })
  } finally {
    await page.close().catch(() => {})
  }
}

/** 只判定、不改写：把块片段按段数 k 均分，每段拼成一段 HTML。 */
function splitIntoChunks(parts, k) {
  const size = Math.ceil(parts.length / k)
  const chunks = []
  for (let i = 0; i < parts.length; i += size) chunks.push(parts.slice(i, i + size).join(''))
  return chunks
}

/** 分段灌入也走全新 page：首段若在热乎的页面上会少付一次布局，量出来的「首屏」偏乐观。 */
async function runChunkedProbe(browser, url, chunks, disableAppend) {
  const page = await (await browser.newContext()).newPage()
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await waitForHostReady(page)
    // 把插件钩子装进页内。传源码而不是传函数：`instrumentPlugins` 要被 `probeChunked`
    // 在页内直接调用，而 `evaluate` 只序列化它收到的那个函数本身。
    await page.evaluate((source) => {
      globalThis.__larkDocInstrumentPlugins = new Function(`return (${source})`)()
    }, instrumentPlugins.toString())
    return await page.evaluate(probeChunked, { chunks, disableAppend: disableAppend || [] })
  } finally {
    await page.close().catch(() => {})
  }
}

/** 取每个字段的中位数；非数值字段（布尔）原样从最后一轮取。 */
function medianOf(runs) {
  const keys = new Set()
  for (const run of runs) for (const key of Object.keys(run)) keys.add(key)
  const out = {}
  for (const key of keys) {
    const values = runs.map((run) => run[key]).filter((value) => Number.isFinite(value))
    const raw = runs[runs.length - 1][key]
    out[key] = values.length === runs.length ? round1(median(values)) : raw
  }
  return out
}

/**
 * 打印分项表，并做闭包检查。
 *
 * 四段首尾相接：`解析 + 事务/插件状态 + view.updateState = setContent`，其中
 * `view.updateState = DOM 创建 + 装饰计算`。任何一段「错得离谱」都说明某一刀切错了位置 ——
 * 直接抛错，不给一张看起来合理的表。P7 的教训是「把推测当结论」。
 *
 * ## 残差容差为什么必须是「软」的
 *
 * 残差 `= setContent − 解析 − view.updateState`，其中 `解析 = HTML 轮 − JSON 轮`。
 * 两轮各跑在**独立页面**里，`view.updateState` 的轮间抖动实测 653~880 ms（±30%），
 * 而 JSON 轮整轮只有 ~836 ms —— 两者同量级，于是残差的正负取决于抖动方向：
 * 2,000 块时它会在 ±200 ms 间翻转，占 `setContent` 的 0.5%。
 *
 * 这不是切错了，是**噪声大于残差本身**。此时把整张表判死会让人误以为方法有问题，
 * 而实测的结论（解析占 97%）由 36,000 ms 那个巨值主导，与 200 ms 的抖动无关。
 * 所以：负残差在 `max(50 ms, 1% × setContent)` 以内时**保留真实数值**、标注 ⚠，
 * 并在结果里记 `closureWithinNoise: true`；超出容差仍抛错 —— 那才是真切错位置
 * （比如某一段被量了两遍或漏量）。
 */
function printPhase(phase) {
  const { coldSetContentMs, htmlRun, jsonRun } = phase
  const parseMs = round1(htmlRun.setContentMs - jsonRun.setContentMs)
  const viewUpdateMs = htmlRun.viewUpdateMs
  const decorationMs = htmlRun.decorationMs
  const domCreateMs = round1(viewUpdateMs - decorationMs)
  const transactionMs = round1(htmlRun.setContentMs - parseMs - viewUpdateMs)
  const residualToleranceMs = Math.max(50, htmlRun.setContentMs * 0.01)
  const residualWithinNoise = transactionMs < 0 && Math.abs(transactionMs) <= residualToleranceMs
  const total = htmlRun.setContentMs + htmlRun.layoutMs + htmlRun.focusMs
  const pct = (value) => `${((value / total) * 100).toFixed(1)}%`

  const broken = [
    ['解析段为负', parseMs < 0],
    ['解析段 + 事务段 + view.updateState 超过 setContent（残差超出噪声容差）', transactionMs < 0 && !residualWithinNoise],
    ['装饰计算超过 view.updateState', decorationMs > viewUpdateMs],
    ['view.updateState 超过 setContent', viewUpdateMs > htmlRun.setContentMs],
  ].filter(([, hit]) => hit)
  if (broken.length) {
    // 失败时把两轮的可比性证据一起吐出来。「HTML − JSON」这一刀只在两轮是**同一篇文档**
    // 时才成立：块数或节点数一旦不等，差值里就混进了「少建的那些 DOM」，不再是解析成本。
    const detail = [
      `setContent ${htmlRun.setContentMs} / viewUpdate ${viewUpdateMs} / 装饰 ${decorationMs} / 解析 ${parseMs} / 残差 ${transactionMs}（容差 ${round1(residualToleranceMs)}）`,
      `HTML 轮：${htmlRun.blocks} 块 / ${htmlRun.domNodes} 节点 / updateState ${round1(viewUpdateMs)} ms（${htmlRun.viewUpdateCalls} 次）`,
      `JSON 轮：${jsonRun.blocks} 块 / ${jsonRun.domNodes} 节点 / updateState ${round1(jsonRun.viewUpdateMs)} ms（${jsonRun.viewUpdateCalls} 次）/ setContent ${round1(jsonRun.setContentMs)} ms`,
    ].join('\n  ')
    throw new Error(`分项表闭包检查失败：${broken.map(([name]) => name).join('；')}\n  ${detail}`)
  }
  if (residualWithinNoise) {
    console.warn(`[attribute] ⚠ 残差 ${transactionMs} ms 为负但在噪声容差 ${round1(residualToleranceMs)} ms 内：两轮 view.updateState 抖动大于残差本身，解析段按「上界」读`)
  }

  console.log('\n分项表（比例以「setContent + layout + focus」为分母，与 mountToTypeable 同构）')
  console.log(`  冷机端到端 setContent（Run A，${phase.coldBlocks ?? htmlRun.blocks} 块 / ${htmlRun.contentKB} KB）  ${coldSetContentMs} ms`)
  console.log(`  分项轮 setContent（Run B，中位数）                          ${htmlRun.setContentMs} ms`)
  console.log(`   ├ 解析（HTML 轮 − JSON 轮，含 DOM 走树）                  ${parseMs} ms  ${pct(parseMs)}`)
  console.log(`   │    原生 HTML parse 单独量（参考值）                     ${round1(htmlRun.htmlParseMs)} ms`)
  console.log(`   ├ 事务 apply 与插件状态（残差）                            ${transactionMs} ms  ${pct(transactionMs)}${residualWithinNoise ? '  ⚠ 噪声内' : ''}`)
  console.log(`   └ view.updateState = DOM 创建 + 装饰应用                   ${round1(viewUpdateMs)} ms  ${pct(viewUpdateMs)}（调用 ${htmlRun.viewUpdateCalls} 次）`)
  console.log(`        ├ 装饰计算（derive rebuild ${htmlRun.decorationRebuilds} 次）      ${round1(decorationMs)} ms  ${pct(decorationMs)}`)
  console.log(`        └ DOM 创建（净）                                     ${domCreateMs} ms  ${pct(domCreateMs)}`)
  console.log(`  首次 layout                                                ${round1(htmlRun.layoutMs)} ms  ${pct(htmlRun.layoutMs)}`)
  console.log(`  focus                                                      ${round1(htmlRun.focusMs)} ms  ${pct(htmlRun.focusMs)}`)
  console.log(`  小计                                                       ${round1(total)} ms → DOM 节点 ${htmlRun.domNodes} 个`)

  const decisive = round1(domCreateMs + parseMs)
  const decisivePct = ((decisive / total) * 100).toFixed(1)
  console.log(`\n  **DOM 创建 + 解析 = ${decisive} ms，占 ${decisivePct}%** —— 立项 §5 的决策点判 ${Number(decisivePct) >= 60 ? '≥' : '<'} 60%`)
  return { parseMs, transactionMs, viewUpdateMs: round1(viewUpdateMs), domCreateMs, decorationMs: round1(decorationMs), total: round1(total), decisivePct: Number(decisivePct), closureWithinNoise: residualWithinNoise, residualToleranceMs: round1(residualToleranceMs) }
}

function printScaling(scaling) {
  console.log('\n规模曲线（每点取中位数；「ms/块」持平 = 线性，翘起 = 超线性）')
  console.log('  块数      setContent    +layout      ms/块    DOM 节点   µs/节点')
  let previous = null
  for (const point of scaling) {
    const perBlock = point.setContentMs / point.blocks
    const perNode = (point.setContentMs * 1000) / point.domNodes
    const growth = previous ? `（较上一点 ×${(perBlock / previous).toFixed(2)}）` : ''
    console.log(`  ${String(point.blocks).padStart(5)}  ${String(point.setContentMs).padStart(11)}  ${String(point.layoutMs).padStart(9)}  ${String(round2(perBlock)).padStart(7)}  ${String(point.domNodes).padStart(9)}  ${String(round1(perNode)).padStart(8)} ${growth}`)
    previous = perBlock
  }

  // 对数斜率：`log(t) = a + k · log(n)`，k 就是总时间的规模指数。
  // k≈1 = 线性（成本正比于文档大小）；k≈2 = 二次（成本正比于大小的平方）。
  // 这是「分段灌入能砍掉多少」的唯一依据：二次项下切成 c 段可把这一段缩到 1/c。
  const xs = scaling.map((point) => Math.log(point.blocks))
  const ys = scaling.map((point) => Math.log(point.setContentMs))
  const meanX = xs.reduce((sum, value) => sum + value, 0) / xs.length
  const meanY = ys.reduce((sum, value) => sum + value, 0) / ys.length
  let numerator = 0
  let denominator = 0
  for (let i = 0; i < xs.length; i += 1) {
    numerator += (xs[i] - meanX) * (ys[i] - meanY)
    denominator += (xs[i] - meanX) ** 2
  }
  const exponent = denominator ? numerator / denominator : NaN
  console.log(`\n  规模指数 k = ${exponent.toFixed(2)}（log-log 最小二乘，${scaling.length} 点）—— ${exponent >= 1.7 ? '近似二次，存在平方项' : exponent >= 1.3 ? '明显超线性' : '近似线性'}`)
  return round2(exponent)
}

function printTypes(types) {
  console.log('\n按块类型的单块成本（各 200 块，中位数）')
  console.log('  类型                setContent      ms/块    DOM 节点/块')
  for (const entry of types) {
    console.log(`  ${entry.type.padEnd(18)}  ${String(entry.setContentMs).padStart(11)}  ${String(round2(entry.perBlockMs)).padStart(8)}  ${String(round1(entry.nodesPerBlock)).padStart(12)}`)
  }
}

function printChunking(rows) {
  const base = rows[0]
  console.log('\n分段灌入（同一篇文档，按顶层块切分；合计 = setContent + layout + focus）')
  console.log('  段数   setContent    +layout     +focus      合计   ms/块   相对整篇     首段      块数     节点')
  for (const row of rows) {
    const totalMs = row.setContentMs + row.layoutMs + row.focusMs
    const ratio = row.setContentMs / base.setContentMs
    console.log(`  ${String(row.chunks).padStart(4)}  ${String(row.setContentMs).padStart(11)}  ${String(row.layoutMs).padStart(9)}  ${String(row.focusMs).padStart(9)}  ${String(round1(totalMs)).padStart(9)}  ${String(round2(row.setContentMs / row.blocks)).padStart(6)}  ${`×${ratio.toFixed(2)}`.padStart(9)}  ${String(round1(row.firstChunkMs)).padStart(7)}  ${String(row.blocks).padStart(7)}  ${String(row.domNodes).padStart(7)}`)
  }
  const best = rows.reduce((a, b) => (b.setContentMs < a.setContentMs ? b : a))
  const gain = ((1 - best.setContentMs / base.setContentMs) * 100).toFixed(0)
  console.log(`\n  最快 ${best.chunks} 段：${best.setContentMs} ms（整篇 ${base.setContentMs} ms，${gain}% 更快）`)
  console.log('  注意「首段」列：它才是用户真正等待的「能看见内容」的时间，合计快不等于首屏快。')
}

/**
 * 对「段序号 > 0」的纯插入段做最小二乘，返回 `ms / 100 块`。
 *
 * 为什么只取 index > 0：第 0 段是 `setContent`，它同时付了「换掉旧文档」的钱，量纲和其他段不同；
 * 混进去会把斜率拉偏。而 index > 0 的每一段做的是**同一件事**（在文末追加一小段 HTML），
 * 唯一的变量就是「此刻文档多大」—— 这正是我们要的那条曲线。
 */
function slopePer100Blocks(detail, key) {
  const rows = detail.filter((row) => row.index > 0 && Number.isFinite(row[key]))
  if (rows.length < 2) return NaN
  const xs = rows.map((row) => row.blocksBefore)
  const ys = rows.map((row) => row[key])
  const meanX = xs.reduce((sum, value) => sum + value, 0) / xs.length
  const meanY = ys.reduce((sum, value) => sum + value, 0) / ys.length
  let numerator = 0
  let denominator = 0
  for (let i = 0; i < xs.length; i += 1) {
    numerator += (xs[i] - meanX) * (ys[i] - meanY)
    denominator += (xs[i] - meanX) ** 2
  }
  return denominator ? (numerator / denominator) * 100 : NaN
}

/**
 * 插件级事务开销表（P8-01b 的第二刀）。
 *
 * 读法：`applyTransaction` 的钱只可能落在三处 —— 各插件 `state.apply`、各插件
 * `appendTransaction`、以及**应用 step 本身**（`step.apply(doc)` 重建文档树）。
 * 前两者这里逐项列出，减完剩下的差额就是第三者。若差额为负，说明装饰重建被算进了
 * 某个插件的 `state.apply`（derive 层的 `decorations()` 确实是在插件 state 里被调的），
 * 这时两列只当作重叠的上下界读，不要相加。
 */
function printPlugins(row) {
  const entries = row?.plugins || []
  if (!entries.length) {
    console.log('\n  插件级事务开销：本次窗口内没有任何插件 apply（异常，检查钩子是否生效）')
    return null
  }
  const decorationMs = (row.detail || []).reduce((sum, item) => sum + item.decorationMs, 0)
  const applyNet = row.applyMs - decorationMs
  const pluginTotal = entries.reduce((sum, entry) => sum + entry.applyMs + entry.appendMs, 0)

  console.log(`\n插件级事务开销（${row.chunks} 段，按 state.apply + appendTransaction 合计排序；单位 ms）`)
  console.log('   插件 key / 指纹                                    state.apply      调用   append     调用')
  for (const entry of entries.slice(0, 12)) {
    const label = `${entry.key}${entry.props ? ` [${entry.props}]` : ''}${entry.specKeys ? ` {${entry.specKeys}}` : ''}`
    console.log(`  ${label.slice(0, 50).padEnd(50)}  ${String(round1(entry.applyMs)).padStart(12)}  ${String(entry.applyCalls).padStart(6)}  ${String(round1(entry.appendMs)).padStart(7)}  ${String(entry.appendCalls).padStart(6)}`)
  }
  const residualMs = applyNet - pluginTotal
  console.log(`\n  事务净额 ${round1(applyNet)} ms = 插件合计 ${round1(pluginTotal)} ms + step 应用（残差）${round1(residualMs)} ms`)
  if (residualMs < 0) {
    console.warn(`[attribute] ⚠ 插件合计超过事务净额 ${round1(-residualMs)} ms：装饰重建落在某个插件的 state.apply 里，两列重叠，只读比例不读绝对`)
  }
  const top = entries[0]
  if (top) console.log(`  最大单项：${top.key} ${round1(top.applyMs + top.appendMs)} ms（占事务净额 ${applyNet > 0 ? ((top.applyMs + top.appendMs) / applyNet * 100).toFixed(0) : '—'}%）`)
  return { applyNet: round1(applyNet), pluginTotal: round1(pluginTotal), residualMs: round1(residualMs), entries: entries.slice(0, 12).map((entry) => ({ key: entry.key, props: entry.props, specKeys: entry.specKeys, ms: round1(entry.applyMs + entry.appendMs) })) }
}

/**
 * 逐次记账表（P8-01b）。
 *
 * 单篇文档只给一条「总耗时 vs 块数」的曲线，从中分不清「每节点更贵了」和
 * 「有某笔整篇级的开销被多付了几次」。切段把这个歧义消掉：段数 k 时，同一笔
 * 每事务开销被付了 k 次，而每次付款时的文档大小是已知的 —— 于是
 * **「第 k 次插入花了多久」对「那一刻文档多大」回归**，斜率就是那笔开销的规模特征：
 *
 * - 斜率 ≈ 0：每事务开销与文档大小无关 → 多付的钱只来自「次数」，分段不会更贵；
 * - 斜率 > 0：每次事务随文档变大而变贵 → 这就是二次项的来源，且能指出落在哪一段。
 */
function printChunkDetail(rows) {
  const target = rows.reduce((best, row) => (row.detail && row.detail.length > (best.detail?.length ?? 0) ? row : best), rows[0])
  if (!target?.detail?.length) return null
  const detail = target.detail
  console.log(`\n逐次记账（${target.chunks} 段；「起始」是这一次插入之前的文档规模）`)
  console.log('   段   起始块   起始 size      合计      解析    事务净      装饰  updateState  调用')
  for (const row of detail) {
    console.log(`  ${String(row.index).padStart(3)}  ${String(row.blocksBefore).padStart(7)}  ${String(row.sizeBefore).padStart(10)}  ${String(row.totalMs).padStart(9)}  ${String(row.parseMs).padStart(8)}  ${String(row.applyNetMs).padStart(8)}  ${String(row.decorationMs).padStart(8)}  ${String(row.updateMs).padStart(11)}  ${String(row.updateCalls).padStart(4)}`)
  }

  const keys = [
    ['合计', 'totalMs'],
    ['解析', 'parseMs'],
    ['事务净', 'applyNetMs'],
    ['装饰', 'decorationMs'],
    ['updateState', 'updateMs'],
  ]
  const slopes = keys.map(([label, key]) => ({ label, key, slope: slopePer100Blocks(detail, key) }))
  const totalSlope = slopes.find((entry) => entry.key === 'totalMs')?.slope
  console.log('\n  随文档变大的增量成本（对起始块数最小二乘，只取纯插入段；单位 ms / 100 块）')
  for (const entry of slopes) {
    const share = Number.isFinite(totalSlope) && totalSlope > 0 ? `  占增量的 ${((entry.slope / totalSlope) * 100).toFixed(0)}%` : ''
    console.log(`    ${entry.label.padEnd(12)} ${(Number.isFinite(entry.slope) ? `${entry.slope >= 0 ? '+' : ''}${round1(entry.slope)}` : '—').padStart(10)}${share}`)
  }
  return {
    chunks: target.chunks,
    slopes: Object.fromEntries(slopes.map((entry) => [entry.key, round1(entry.slope)])),
  }
}

/**
 * 事务结构表（P8-01b 的硬证据）。
 *
 * 「块 id 补全」是这轮唯一的嫌疑犯，而它的代价完全取决于**它自己产生多少条 step**：
 * `applyBlockIdFixes` 是 `fixes.forEach(fix => tr.setNodeMarkup(...))`，一块一条。
 * 所以只要把每次 `applyTransaction` 的步数打出来，「一块一步」这个判断就从读码变成了实测；
 * 若追加事务的步数与块数同量级，那么两个插件里所有 O(步数) 的重放（autolink 的
 * `combineTransactionSteps` 就是）都会跟着变成 O(块数) —— 这就是二次项的入口。
 */
function printTransactions(rows) {
  const target = rows.reduce((best, row) => (row.chunks > best.chunks ? row : best), rows[0])
  const detail = target?.detail || []
  const withTx = detail.filter((row) => Array.isArray(row.transactions) && row.transactions.length)
  if (!withTx.length) return null
  console.log(`\n事务结构（${target.chunks} 段；步数 = 该事务里的 step 条数，追加事务由插件 appendTransaction 产生）`)
  console.log('   段   起始块   根事务步数   追加事务步数')
  for (const row of withTx) {
    const roots = row.transactions.map((item) => item.steps)
    const appended = row.transactions.flatMap((item) => item.appended)
    console.log(`  ${String(row.index).padStart(3)}  ${String(row.blocksBefore).padStart(7)}  ${String(roots.join('+')).padStart(11)}   ${appended.length ? appended.join('+') : '—'}`)
  }
  const last = withTx[withTx.length - 1]
  const appended = last.transactions.flatMap((item) => item.appended)
  const biggest = appended.length ? Math.max(...appended) : 0
  if (biggest) {
    console.log(`\n  末段（起始 ${last.blocksBefore} 块）追加事务最大 ${biggest} 步 —— 与「一块一条 setNodeMarkup」一致则说明 blockId 补全是逐块提交的`)
  }
  return {
    chunks: target.chunks,
    appendedMaxSteps: biggest,
    rows: withTx.map((row) => ({ index: row.index, blocksBefore: row.blocksBefore, roots: row.transactions.map((item) => item.steps), appended: row.transactions.flatMap((item) => item.appended) })),
  }
}

async function main() {
  const startedAt = Date.now()
  const html = buildDocHtml({ seed: SEED, blocks: BLOCKS })
  const runDir = prepareHostPage(path.join(REPO_ROOT, 'perf', '.run'))

  if (!fs.existsSync(path.join(REPO_ROOT, 'dist', 'lark-doc-element.umd.min.js'))) {
    throw new Error('缺少 dist/lark-doc-element.umd.min.js —— 先跑 npm run build:element（归因必须量正式产物）')
  }

  await waitForIdleMachine()

  const { server, port } = await serveStatic(runDir)
  const url = `http://127.0.0.1:${port}/`
  const executablePath = findChromium()
  if (!executablePath) throw new Error('未找到本机 chromium 缓存')
  const browser = await loadChromiumDriver().launch({ headless: true, executablePath })

  const result = {
    seed: SEED,
    blocks: BLOCKS,
    capturedAt: new Date().toISOString(),
    node: process.version,
    reps: REPS,
    load1AtStart: round2(os.loadavg()[0]),
    disableAppend: DISABLE_APPEND,
  }

  try {
    // ── 1. 分项表 ──────────────────────────────────────────────────────────
    if (ONLY === 'all' || ONLY === 'phase') {
      console.log(`[attribute] 1/3 分项表（${BLOCKS} 块）：Run A 冷机 1 轮（顺带取 JSON）+ Run C JSON 轮 1 轮 + Run B HTML 分项 ${REPS} 轮`)
      // Run A：冷机端到端。这一轮的 setContent 与 measure.mjs 完全同构（没有任何预热），
      // 是唯一能和 mountToTypeableMs 对齐的数；顺手把 JSON 带回来，省一次 30 s 灌入。
      const cold = await runProbe(browser, url, html, { wantJson: true })
      console.log(`[attribute]     Run A 冷机 setContent ${round1(cold.setContentMs)} ms（${cold.blocks} 块 / ${cold.contentKB} KB HTML）`)

      // Run C：同一篇文档换成 JSON 灌入。③（view.updateState）与 HTML 轮逐字节等价，
      // 差异只在解析 —— 两轮相减就是「原生 HTML 解析 + DOM 走树」的成本。
      console.log('[attribute]     Run C JSON 回落（用于把解析段从 setContent 里切出来）...')
      const jsonRun = await runProbe(browser, url, cold.json, { decompose: true })
      console.log(`[attribute]     Run C setContent ${round1(jsonRun.setContentMs)} ms（JSON ${jsonRun.contentKB} KB）`)

      const runs = []
      for (let i = 0; i < REPS; i += 1) {
        console.log(`[attribute]     Run B 分项轮 ${i + 1}/${REPS}...`)
        runs.push(await runProbe(browser, url, html, { decompose: true }))
      }
      result.phase = {
        coldSetContentMs: round1(cold.setContentMs),
        coldLayoutMs: round1(cold.layoutMs),
        coldFocusMs: round1(cold.focusMs),
        coldBlocks: cold.blocks,
        htmlRun: medianOf(runs),
        jsonRun: {
          setContentMs: round1(jsonRun.setContentMs),
          viewUpdateMs: round1(jsonRun.viewUpdateMs),
          viewUpdateCalls: jsonRun.viewUpdateCalls,
          decorationMs: round1(jsonRun.decorationMs),
          blocks: jsonRun.blocks,
          domNodes: jsonRun.domNodes,
          contentKB: jsonRun.contentKB,
        },
        rawRuns: runs,
      }
      result.phase.summary = printPhase(result.phase)
    }

    // ── 2. 规模曲线 ────────────────────────────────────────────────────────
    if (ONLY === 'all' || ONLY === 'scaling') {
      console.log(`\n[attribute] 2/3 规模曲线（${SCALE_POINTS.join(' / ')} 块，每点 ${Math.min(REPS, 2)} 轮）...`)
      const scaling = []
      for (const blocks of SCALE_POINTS) {
        const pointHtml = blocks === BLOCKS ? html : buildDocHtml({ seed: SEED, blocks })
        const runs = []
        for (let i = 0; i < Math.min(REPS, 2); i += 1) {
          console.log(`[attribute]     ${blocks} 块 ${i + 1}...`)
          runs.push(await runProbe(browser, url, pointHtml))
        }
        const merged = medianOf(runs)
        scaling.push({ blocks: merged.blocks, setContentMs: merged.setContentMs, layoutMs: merged.layoutMs, domNodes: merged.domNodes })
      }
      result.scaling = scaling
      result.scalingExponent = printScaling(scaling)
    }

    // ── 3. 按块类型 ────────────────────────────────────────────────────────
    if (ONLY === 'all' || ONLY === 'types') {
      const types = ['paragraph', 'heading+indent', 'list', 'table', 'blockquote']
      console.log(`\n[attribute] 3/3 按块类型（${TYPE_BLOCKS} 块 × ${types.length} 类 × 2 轮）...`)
      const rows = []
      for (const type of types) {
        const typed = typedHtml(type, TYPE_BLOCKS)
        const runs = []
        for (let i = 0; i < 2; i += 1) runs.push(await runProbe(browser, url, typed))
        const merged = medianOf(runs)
        rows.push({
          type,
          setContentMs: merged.setContentMs,
          perBlockMs: round2(merged.setContentMs / merged.blocks),
          nodesPerBlock: round1(merged.domNodes / merged.blocks),
        })
      }
      result.types = rows
      printTypes(rows)
    }

    // ── 4. 分段灌入（收益验证 + P8-01b 逐次归因）────────────────────────────
    if (ONLY === 'all' || ONLY === 'chunk') {
      const parts = buildDocBlocks({ seed: SEED, blocks: BLOCKS })
      const chunkCounts = CHUNK_COUNTS
      if (DISABLE_APPEND.length) {
        console.warn(`[attribute] ⚠ PERF_DISABLE_APPEND=${DISABLE_APPEND.join(',')}：本次是**归因实验**，摘掉了插件的 appendTransaction，文档缺 blockId / 缺 autolink，数不可与正式口径比较`)
      }
      console.log(`\n[attribute] 4/4 分段灌入（${parts.length} 个顶层元素，切 ${chunkCounts.join(' / ')} 段）...`)
      const rows = []
      for (const count of chunkCounts) {
        const chunks = splitIntoChunks(parts, count)
        console.log(`[attribute]     ${chunks.length} 段...`)
        const run = await runChunkedProbe(browser, url, chunks, DISABLE_APPEND)
        rows.push({
          chunks: chunks.length,
          setContentMs: round1(run.setContentMs),
          layoutMs: round1(run.layoutMs),
          focusMs: round1(run.focusMs),
          firstChunkMs: round1(run.perChunkMs[0]),
          blocks: run.blocks,
          domNodes: run.domNodes,
          // 逐次明细单独存，不混进 `chunking` 表的对齐 —— 那张表是「收益」，这份是「归因」。
          detail: run.detail,
          applyMs: round1(run.applyMs),
          plugins: run.plugins,
          disabledPlugins: run.disabledPlugins,
        })
      }
      // 切段不能改变文档本身。理想情况是块数 / DOM 节点数与「一段到底」逐项相等，
      // 但 `insertContentAt` 在段边界上**不合并相邻的列表/缩进块**：实测约一半的边界
      // 会多出 1 块（5 段 +3、25 段 +12）。这是方案 A 自己要解决的产品语义问题，不是
      // 测量噪声 —— 所以这里不把它藏起来，而是**打出来**并把容差钉在 5%：
      // 超过 5% 说明切坏了内容，「变快」只是少灌了东西；5% 以内的结构差异也解释不了
      // 一个数量级的提速，结论仍然成立。
      const reference = rows[0]
      const blockDrift = (row) => (row.blocks - reference.blocks) / reference.blocks
      const broken = rows.filter((row) => Math.abs(blockDrift(row)) > 0.05 || Math.abs(row.domNodes - reference.domNodes) / reference.domNodes > 0.05)
      if (broken.length) {
        throw new Error(`分段灌入切坏了文档（超过 5%）：整篇 ${reference.blocks} 块 / ${reference.domNodes} 节点，${broken.map((row) => `${row.chunks} 段 → ${row.blocks} 块 / ${row.domNodes} 节点`).join('；')}`)
      }
      const drifted = rows.filter((row) => row.blocks !== reference.blocks || row.domNodes !== reference.domNodes)
      if (drifted.length) {
        console.warn(`[attribute] ⚠ 段边界未合并相邻块：${drifted.map((row) => `${row.chunks} 段 ${row.blocks - reference.blocks > 0 ? '+' : ''}${row.blocks - reference.blocks} 块 / ${row.domNodes - reference.domNodes > 0 ? '+' : ''}${row.domNodes - reference.domNodes} 节点`).join('；')} —— 差异在 5% 内，但方案 A 落地时要处理跨段合并`)
      }
      result.chunking = rows
      result.chunkingDrift = drifted.length
      printChunking(rows)
      const attribution = printChunkDetail(rows)
      if (attribution) result.chunkSlopes = attribution
      const txSummary = printTransactions(rows)
      if (txSummary) result.chunkTransactions = txSummary
      // 插件表取「段数最多」那一次：事务次数最多，单项信噪比最好。
      // 注意不能按「插件条数」挑 —— 每次都一样多，会挑成第一组（段数=1，只有一次事务）。
      const pluginTarget = rows.reduce((best, row) => (row.chunks > best.chunks ? row : best), rows[0])
      const pluginSummary = printPlugins(pluginTarget)
      if (pluginSummary) result.chunkPlugins = pluginSummary
      if (DISABLE_APPEND.length) {
        const disabled = rows[0]?.disabledPlugins || []
        // 匹配为空必须炸：屏蔽实验的结论完全建立在「确实摘掉了」上，
        // 若 key 前缀写错（比如插件改名），跑出来的不过是又一次正常测量，
        // 却会被读成「摘掉也没变快」。这类静默空转在 P7 里踩过，这里直接拦死。
        if (!disabled.length) {
          throw new Error(`PERF_DISABLE_APPEND=${DISABLE_APPEND.join(',')} 没有匹配到任何插件（现有 key 见上一张插件表）`)
        }
        console.log(`\n  屏蔽实验：已摘掉 appendTransaction —— ${disabled.join(' / ')}（本表仅供归因，非产品口径）`)
        result.chunkDisabledAppend = disabled
      }
    }

    result.durationMs = Date.now() - startedAt
    // `PERF_OUT` 让「换块数复测」不必占用正式那份结果：300 块的口径与 2,000 块不可混放，
    // 混在一起会让 `carriedSections` 把两种规模的数拼成一张表。
    // 屏蔽实验同理，而且更危险：它的数看着像「优化后的收益」，落到正式文件里会被当成产品口径。
    // 所以 `PERF_DISABLE_APPEND` 且没显式给 `PERF_OUT` 时，默认换成独立文件名。
    const disableSuffix = DISABLE_APPEND.length ? `.no-${DISABLE_APPEND.join('+')}` : ''
    const defaultName = `attribute-result${disableSuffix}.json`
    const outPath = process.env.PERF_OUT
      ? path.resolve(REPO_ROOT, process.env.PERF_OUT)
      : path.join(runDir, defaultName)
    // 分段跑（`ONLY=phase` / `scaling` / `types`）时，把这次没量的那几段从上一次结果里带过来。
    // 之前这里是直接覆盖 —— 跑完规模曲线就把花 90 s 才拿到的分项表冲掉了，只能重跑。
    // 代价是同一个文件里可能混着两次采样的数，所以下面显式记下「这次量的」和「沿用的」。
    const measureSections = ['phase', 'scaling', 'types', 'chunking', 'chunkSlopes', 'chunkTransactions'].filter((name) => result[name] !== undefined)
    const previous = fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, 'utf8')) : {}
    const carriedSections = []
    for (const name of ['phase', 'scaling', 'types', 'chunking', 'chunkSlopes', 'chunkTransactions']) {
      if (result[name] === undefined && previous[name] !== undefined) {
        result[name] = previous[name]
        carriedSections.push(name)
      }
    }
    result.measuredSections = measureSections
    result.carriedSections = carriedSections
    if (carriedSections.length) {
      console.warn(`[attribute] 沿用上一次采样的段落：${carriedSections.join(' / ')}（本次只量了 ${measureSections.join(' / ')}）`)
    }
    fs.writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`)
    console.log(`\n归因完成（${Math.round(result.durationMs / 1000)}s）→ ${path.relative(REPO_ROOT, outPath)}`)
  } finally {
    await browser.close().catch(() => {})
    await new Promise((resolve) => server.close(() => resolve()))
  }
}

main().catch((error) => {
  console.error('归因失败:', error.message)
  process.exit(1)
})
