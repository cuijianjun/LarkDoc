'use strict'
/**
 * 浏览器级验证：高频更新的帧级合并（P7-04）。
 *
 * 单测（`test/unit/perf-scheduling.test.js`）证明的是「调度器语义正确」——
 * 200 次 schedule 只排 1 帧、保序、可取消。但单测里没有 ProseMirror、没有 DOM，
 * 它证明不了三件只有真浏览器能给答案的事：
 *
 *   1. **同步段真的不再干活**：改动前 `onSelectionUpdate` 是同步函数，200 次
 *      选区变化 = 200 轮 `coordsAtPos` + `positionBlockHandle` + 表格边界重测。
 *      现在同步段只赋值，布局整体落到下一帧。
 *   2. **没有新增包裹层 / 控件抖动**：合并最容易在哪翻车？把某段 DOM 包一层
 *      wrapper、或者显隐与位置分两帧写下去（先显示在旧位置再挪）。这两件事
 *      肉眼都是「闪一下」，只能靠 `innerHTML` 与节点数比对守门。
 *   3. **查找高亮不留残渣**：装饰型高亮在关面板后必须摘干净，否则每开一次
 *      查找就永久多一批 span。
 *
 * 量法：从 `window.__larkDoc.getWorkspace().$refs.document` 取到编辑器 vm，
 * 猴补 `runSelectionLayout` / `updateSearch` / `view.coordsAtPos` 三个计数点。
 * 只读计数，不改行为，探针跑完页面即可丢弃。
 *
 * 依赖：demo dev server（Vue 路由暴露 window.__larkDoc）。用法：
 *   node scripts/verify-browser-perf-scheduling.js [url]
 */
const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright-core')

const BASE = process.argv[2] || 'http://localhost:8080/lark-doc'
const BACKGROUND_ONLY = process.argv.includes('--background-only')
/** 一轮「同一帧内来 200 次更新」的极端值：粘贴 / 输入法合成 / 批量事务都能造出来。 */
const BURST = 200
/** 查找去抖窗口 120ms，留 3 倍余量再断言「只跑一次」。 */
const DEBOUNCE_SETTLE_MS = 400
const results = []
let diagnosticPage, runningBrowser

function findChromium() {
  const installedChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  if (process.platform === 'darwin' && fs.existsSync(installedChrome)) return installedChrome
  const cache = path.join(process.env.HOME, 'Library', 'Caches', 'ms-playwright')
  if (!fs.existsSync(cache)) return null
  const dirs = fs.readdirSync(cache).filter((name) => /^chromium-\d+$/.test(name)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
  for (const dir of dirs) {
    for (const candidate of [
      path.join(cache, dir, 'chrome-mac-x64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
      path.join(cache, dir, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
    ]) if (fs.existsSync(candidate)) return candidate
  }
  return null
}

function record(name, ok, detail = '') {
  results.push({ ok })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}

/**
 * 固定的 60 块夹具。刻意包含：多级标题（目录/编号装饰）、重复词「露营」
 * （查找命中）、任务列表与有序列表（列表 marker 装饰）、引用（callout 工具）。
 * 不含表格与原子块 —— 表格边界会按需给单元格打 class，原子块会引出 gapcursor
 * 这类一次性 DOM 变化，两者都会让「DOM 必须逐字节相同」这条断言变成噪音。
 */
function buildContent() {
  const blocks = []
  for (let i = 1; i <= 6; i += 1) blocks.push(`<h${i > 3 ? 3 : i}>第 ${i} 级标题 露营装备</h${i > 3 ? 3 : i}>`)
  for (let i = 1; i <= 24; i += 1) blocks.push(`<p>第 ${i} 段：露营枕头的填充材料决定支撑力，露营时的颈部角度与家用枕头不同。</p>`)
  blocks.push('<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>已完成的露营清单</p></li><li data-type="taskItem" data-checked="false"><p>待办的露营清单</p></li></ul>')
  blocks.push('<ol><li><p>有序第一项 露营</p></li><li><p>有序第二项 露营</p></li></ol>')
  blocks.push('<ul><li><p>无序第一项 露营</p></li></ul>')
  blocks.push('<div data-type="callout" data-emoji="💡"><p>提示：露营枕头的收纳体积也要算进背包重量。</p></div>')
  for (let i = 1; i <= 20; i += 1) blocks.push(`<p>第 ${i} 段续：露营枕头的气囊结构决定回弹速度。</p>`)
  return blocks.join('\n')
}

(async () => {
  const executablePath = process.env.PERF_BROWSER_EXECUTABLE || findChromium()
  const inputShim = process.env.PERF_NATIVE_INPUT_SHIM
  if (inputShim && (process.platform !== 'darwin' || process.arch !== 'x64' ||
      !path.isAbsolute(inputShim) || process.env.DYLD_INSERT_LIBRARIES ||
      !executablePath?.includes('Google Chrome for Testing.app/') || !process.env.PERF_NATIVE_INPUT_SHIM_LOG)) {
    throw new Error('Native modifier repair requires its hash-verified launcher and isolated CTF browser')
  }
  const keepSandbox = process.platform === 'darwin' && !inputShim
  const browser = await chromium.launch({ executablePath, chromiumSandbox: keepSandbox,
    args: keepSandbox ? [] : ['--no-sandbox'],
    ...(inputShim ? { env: { ...process.env, DYLD_INSERT_LIBRARIES: inputShim,
      LARK_DOC_MODIFIER_SHIM_LOG: process.env.PERF_NATIVE_INPUT_SHIM_LOG } } : {}),
  })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  runningBrowser = browser
  diagnosticPage = page
  const errors = []
  const segmentRequests = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('request', request => { if (/segmentedDocumentModel[^/]*\.(?:js|mjs)/.test(request.url())) segmentRequests.push(request.url()) })
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.waitForSelector('.ProseMirror', { timeout: 20000 })
  await page.waitForFunction(() => window.__larkDoc && window.__larkDoc.getEditor && window.__larkDoc.getEditor(), { timeout: 60000 })

  await page.evaluate((html) => { window.__larkDoc.getEditor().commands.setContent(html) }, buildContent())
  await page.waitForTimeout(700)

  // ---------- 计数器安装 ----------
  const installed = await page.evaluate(() => {
    const facade = window.__larkDoc
    const editor = facade.getEditor()
    const vm = facade._handle?.nativeHost?.host || facade.getWorkspace().$refs.document
    if (!vm || typeof vm.runSelectionLayout !== 'function' || typeof vm.updateSearch !== 'function') return false
    // 计数点归属：`coords` 是 view.coordsAtPos 的全局次数，`layoutCoords` 只统计
    // **发生在 runSelectionLayout 这一轮里**的次数。两者必须分开，否则会被宿主
    // 侧无关测量污染 —— 例如 `editor.commands.focus()` 会走到 tiptap 的 scrollIntoView，
    // ProseMirror 在 updateStateInner 里自己调一次 coordsAtPos 算滚动位置，
    // 那一次既不是我们调度的、也省不掉（PM 内部行为）。
    const state = { layout: 0, coords: 0, layoutCoords: 0 }
    let inLayout = false
    // 方法在 Vue 2 里是实例自有属性（initMethods 会 bind 到 vm），所以直接改 vm 上的
    // 引用就能被 `scheduleSelectionLayout` 的闭包 `this.runSelectionLayout()` 看到。
    const originalLayout = vm.runSelectionLayout
    vm.runSelectionLayout = function (...args) {
      state.layout += 1
      const previous = inLayout
      inLayout = true
      try { return originalLayout.apply(this, args) } finally { inLayout = previous }
    }
    const view = editor.view
    const originalCoords = view.coordsAtPos
    view.coordsAtPos = function (...args) {
      state.coords += 1
      if (inLayout) state.layoutCoords += 1
      return originalCoords.apply(this, args)
    }
    const positions = []
    editor.state.doc.descendants((node, pos) => { if (node.isTextblock) positions.push(pos + 1) })
    window.__p7 = {
      editor, vm, state, positions,
      reset() { state.layout = 0; state.coords = 0; state.layoutCoords = 0 },
      snapshot() {
        const root = document.querySelector('.ProseMirror')
        return root ? { html: root.innerHTML, elements: root.querySelectorAll('*').length, skeleton: [...root.children].map((el) => `${el.tagName.toLowerCase()}:${el.getAttribute('data-type') || ''}`).join(',') } : null
      },
    }
    return true
  })
  record('[准备] 编辑器 vm 可注入计数点', installed === true)
  const raw = await page.evaluate(() => {
    const facade = window.__larkDoc, editor = facade.getEditor()
    return { facade: !!facade.__ob__, editor: !!editor.__ob__, model: !!editor.state.doc.__ob__, view: !!editor.view.__ob__ }
  })
  record('[集成] Vue宿主未把SDK和ProseMirror深度响应化', Object.values(raw).every(value => !value), JSON.stringify(raw))
  if (!installed) { await browser.close(); process.exitCode = 1; return }

  if (!BACKGROUND_ONLY) {
    const baseline = await page.evaluate(() => window.__p7.snapshot())

  // ---------- 单次选区更新的成本（基线，证明计数点真的在跳） ----------
  await page.evaluate(() => {
    const { editor, positions } = window.__p7
    // 这里只需让编辑器进入真实 focus 状态；默认 focus() 还会异步
    // scrollIntoView，额外调用一次 coordsAtPos，污染气泡条本身的成本计数。
    editor.commands.focus(null, { scrollIntoView: false })
    editor.commands.setTextSelection({ from: positions[0], to: positions[0] + 2 })
  })
  await page.waitForTimeout(200)
  const single = await page.evaluate(() => ({ ...window.__p7.state }))
  record('[调度] 单次选区更新只做一轮定位', single.layout === 1, `layout=${single.layout}`)
  record('[调度] 气泡条每轮定位只量 2 次坐标（起止各一）', single.layoutCoords === 2,
    `本轮定位内=${single.layoutCoords}，全局=${single.coords}（差值来自 focus()→scrollIntoView 的 PM 内部测量）`)

  // ---------- 200 次选区变化：同步段不干活，一帧只做一轮 ----------
  await page.evaluate(() => window.__p7.reset())
  const burst = await page.evaluate((count) => {
    const { editor, positions, state } = window.__p7
    const started = performance.now()
    for (let i = 0; i < count; i += 1) {
      const base = positions[i % positions.length]
      editor.commands.setTextSelection({ from: base, to: base + 1 })
    }
    return { issued: count, syncLayout: state.layout, syncCoords: state.coords, costMs: +(performance.now() - started).toFixed(1) }
  }, BURST)
  // 同步段跑完、还没到下一帧时读：合并前这里是 200 轮，合并后必须是 0。
  record('[调度] 200 次连续选区更新，同步段不跑定位', burst.syncLayout === 0 && burst.syncCoords === 0,
    `同步段 layout=${burst.syncLayout} coords=${burst.syncCoords}，派发耗时 ${burst.costMs}ms`)
  await page.waitForTimeout(200)
  const settled = await page.evaluate(() => ({ ...window.__p7.state }))
  record('[调度] 200 次连续选区更新只做 1 轮定位', settled.layout === 1, `layout=${settled.layout}（合并前应为 ${BURST}）`)
  record('[调度] 200 次连续选区更新只量 2 次坐标', settled.layoutCoords === 2,
    `本轮定位内=${settled.layoutCoords}，全局=${settled.coords}（合并前应为 ${BURST * 2}）`)

  // ---------- DOM 契约：无新增包裹层 ----------
  const afterBurst = await page.evaluate(() => window.__p7.snapshot())
  record('[DOM] 200 次选区更新后内容区逐字节不变（无新增包裹层）',
    !!afterBurst && afterBurst.html === baseline.html && afterBurst.elements === baseline.elements,
    afterBurst ? `elements ${baseline.elements} → ${afterBurst.elements}${afterBurst.html === baseline.html ? '' : '，innerHTML 有差异'}` : '快照失败')
  record('[DOM] 块级骨架未变（仍是同一批直接子节点）', !!afterBurst && afterBurst.skeleton === baseline.skeleton,
    afterBurst && afterBurst.skeleton === baseline.skeleton ? `${baseline.skeleton.split(',').length} 个直接子节点` : '骨架变化')

  // ---------- 气泡条不抖：显隐与位置同一次写入，且用的是最新选区 ----------
  // 这一条防的是合并最容易引入的 bug：把「显隐」留在同步段、把「位置」挪到下帧，
  // 或者 rAF 回调里读了排队时的过期 selection 快照。判据用**代码算出的应有位置**
  // 与**真实渲染位置**对齐（气泡条是 position:fixed，rect.left 就是 style 的 left）。
  const bubble = await page.evaluate(() => {
    const { editor, vm } = window.__p7
    const root = document.querySelector('.lark-doc-bubble')
    if (!root) return { missing: true }
    const expected = vm.bubbleBarPosition(editor.state.selection)
    const rect = root.getBoundingClientRect()
    return {
      missing: false,
      visible: vm.bubbleVisible,
      shown: getComputedStyle(root).display !== 'none' && rect.width > 0,
      staleLeft: Math.round(rect.left - expected.left),
      staleTop: Math.round(rect.top - expected.top),
      posMatches: Math.round(vm.bubblePosition.left) === Math.round(expected.left) && Math.round(vm.bubblePosition.top) === Math.round(expected.top),
    }
  })
  record('[抖动] 气泡条落在最新选区上（不是排队时的过期快照）',
    !bubble.missing && bubble.visible === true && bubble.shown === true && bubble.posMatches === true && Math.abs(bubble.staleLeft) <= 1 && Math.abs(bubble.staleTop) <= 1,
    bubble.missing ? '气泡条未渲染' : `状态=${bubble.visible}/渲染=${bubble.shown} 位置偏差 ${bubble.staleLeft}/${bubble.staleTop}px`)

  // ---------- 查找：200 次击键只扫一次 ----------
  await page.evaluate(() => window.__p7.vm.openSearch('find'))
  await page.waitForSelector('#lark-doc-fr-find', { timeout: 10000 })
  await page.evaluate(() => {
    const vm = window.__p7.vm
    window.__p7.search = { runs: 0 }
    const original = vm.updateSearch
    vm.updateSearch = function (...args) { window.__p7.search.runs += 1; return original.apply(this, args) }
  })
  const typed = await page.evaluate((count) => {
    const input = document.querySelector('#lark-doc-fr-find')
    const word = '露营'
    for (let i = 0; i < count; i += 1) {
      // 逐字符变化，最后一个字符落在合法查询上；每次都派发真的 input 事件，
      // 走的是 SearchPanel 的 @input 绑定，不是直接调方法。
      input.value = word.slice(0, (i % word.length) + 1)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
    return input.value
  }, BURST)
  await page.waitForTimeout(DEBOUNCE_SETTLE_MS)
  const search = await page.evaluate(() => ({
    runs: window.__p7.search.runs,
    query: window.__p7.vm.searchQuery,
    matches: window.__p7.vm.searchMatches.length,
  }))
  record('[查找] 200 次击键只重算一次命中', search.runs === 1, `updateSearch=${search.runs}，query="${search.query}"，命中 ${search.matches}`)
  record('[查找] 去抖后的命中与最终输入一致', search.query === typed && search.matches > 0, `query="${search.query}" / "${typed}"`)

  // ---------- 输入后立刻 Enter：必须先 flush 再跳 ----------
  const enter = await page.evaluate(() => {
    const { editor, vm, positions } = window.__p7
    editor.commands.focus()
    editor.commands.setTextSelection({ from: 1, to: 1 })
    vm.setSearchQuery('露营枕头')
    vm.scheduleSearchUpdate()          // 故意不等 120ms
    vm.nextMatch(1)                    // 内部 flushSearchUpdate()
    const hit = vm.searchMatches[vm.searchIndex]
    return { count: vm.searchMatches.length, from: hit ? hit.from : -1, after: editor.state.selection.from, first: positions[0] }
  })
  record('[查找] 输入后立刻 Enter 跳到最新命中（不是上一轮）',
    enter.count > 0 && enter.from >= 0 && enter.after === enter.from && enter.after !== 1,
    `命中 ${enter.count} 个，落点 ${enter.after}，目标 ${enter.from}`)

  // ---------- 关面板：高亮装饰必须摘干净 ----------
  await page.evaluate(() => window.__p7.vm.closeSearch())
  await page.waitForTimeout(300)
  const closed = await page.evaluate(() => ({ ...window.__p7.snapshot(), leftovers: document.querySelectorAll('.lark-doc-search-match').length }))
  record('[查找] 关闭后面板无残留高亮节点', closed.leftovers === 0, `残留 ${closed.leftovers} 个`)
  record('[DOM] 关闭查找后内容区回到基线（无遗留包裹层）',
    closed.html === baseline.html && closed.elements === baseline.elements,
    `elements ${baseline.elements} → ${closed.elements}`)
  }

  // A bounded large-document fixture, not a 30M pressure run: verify the real
  // Blob Worker protocol and that foreground scrolling pauses background work.
  record('[分段] 普通文档不加载段模型区块', segmentRequests.length === 0)
  await page.evaluate(() => {
    const NativeWorker = window.Worker
    const editor = window.__p7.editor
    const trace = window.__p7SegmentTrace = { NativeWorker, patches: [], completedDoc: null }
    window.__p7ProjectionOrder = () => {
      const root = editor.view.dom
      const assigned = [...(root.shadowRoot?.querySelectorAll('slot') || [])].flatMap(slot => slot.assignedNodes())
      const rendered = new Set(assigned), expected = [...root.childNodes].filter(node => rendered.has(node))
      const bounded = root.hasAttribute('data-ld-active-pages')
      const inactiveEmpty = [...(root.shadowRoot?.querySelectorAll('.render-page:not(.is-visible) slot') || [])].every(slot => !slot.assignedNodes().length)
      return assigned.length > 0 && assigned.length === expected.length && assigned.every((node, index) => node === expected[index])
        && (bounded ? inactiveEmpty : assigned.length === root.childNodes.length)
    }
    editor.on('transaction', ({ transaction }) => {
      if (transaction.getMeta('larkDocBlockIds')) trace.patches.push(transaction.steps.map(step => ({ type: step.toJSON().stepType, size: step.getMap().ranges.length })))
    })
    window.Worker = class extends NativeWorker {
      postMessage(data, ...args) { if (data.type === 'compute') this.modelDoc = editor.state.doc; return super.postMessage(data, ...args) }
      constructor(...args) {
        super(...args)
        this.addEventListener('message', ({ data }) => { if (data.type === 'segments') trace.completedDoc = this.modelDoc })
      }
    }
  })
  await page.evaluate(async () => { await window.__larkDoc._handle.editorController.getSnapshotAsync() })
  await page.evaluate(() => {
    const text = '后台任务让行核验😀'.repeat(64)
    const content = [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '主线程任务核验' }] },
      ...Array.from({ length: 1024 }, () => ({ type: 'paragraph', content: [{ type: 'text', text }] })),
    ]
    window.__p7.editor.commands.setContent({ type: 'doc', content: content.map((block, index) => ({ ...block, attrs: { ...block.attrs, blockId: `background-${index}` } })) })
    window.__p7.pendingContent = content
  })
  await page.mouse.move(850, 600)
  // Establish the large document's layout first. A cold import may finish
  // normalizing before Playwright can deliver its first wheel event.
  await page.waitForTimeout(200)
  await page.evaluate(() => window.addEventListener('scroll', event => {
    window.__p7.scrollTrusted = event.isTrusted
    window.__p7.editor.commands.setContent({ type: 'doc', content: window.__p7.pendingContent })
  }, { capture: true, once: true }))
  for (let index = 0; index < 4; index += 1) { await page.mouse.wheel(0, 80); await page.waitForTimeout(25) }
  const deferred = await page.evaluate(() => {
    const doc = window.__p7.editor.state.doc
    return { large: doc.content.size > 500000, pendingIds: !doc.firstChild.attrs.blockId, trusted: window.__p7.scrollTrusted }
  })
  record('[后台] 真实滚动期间大文档补号保持等待', deferred.large && deferred.pendingIds && deferred.trusted, JSON.stringify(deferred))
  await page.waitForFunction(() => !!window.__p7.editor.state.doc.firstChild.attrs.blockId)
  const patches = await page.evaluate(() => window.__p7SegmentTrace.patches)
  record('[事务] 批量补号为单个属性step且不删除位置', patches.some(steps => steps.length === 1 && steps[0].type === 'larkDocBatchAttrsV1' && steps[0].size === 0), JSON.stringify(patches))
  await page.waitForFunction(() => window.__p7SegmentTrace.completedDoc === window.__p7.editor.state.doc && document.querySelector('.ProseMirror').getAttribute('data-ld-segment-count') === '9')
  record('[分段] 按需区块和真实Worker完成当前正文模型', segmentRequests.length > 0)
  const projection = await page.evaluate(() => {
    const root = window.__p7.editor.view.dom
    return { ordered: window.__p7ProjectionOrder(), groups: root.shadowRoot?.querySelectorAll('.segment').length,
      pages: root.shadowRoot?.querySelectorAll('.render-page').length,
      blocks: root.children.length, active: root.classList.contains('lark-doc-segment-layout'), childVisibility: getComputedStyle(root.firstElementChild).contentVisibility }
  })
  record('[分段] 1025个原始块投影至3分区/65窗口且顺序相同', projection.ordered && projection.active && projection.pages === 3 && projection.groups === 65 && projection.blocks === 1025 && projection.childVisibility === 'visible', JSON.stringify(projection))
  const deepPage = await page.evaluate(async () => {
    const paper = document.querySelector('.lark-doc-paper')
    const previous = paper.getAttribute('style')
    const marker = document.createElement('div')
    marker.textContent = '超高页面正文命中回归'
    marker.style.cssText = 'position:absolute;left:100px;width:400px;height:80px;background:white'
    try {
      paper.style.minHeight = '18000000px'
      paper.appendChild(marker)
      const points = []
      for (const ratio of [0.05, 0.5, 0.95]) {
        marker.style.top = `${18000000 * ratio}px`
        const top = paper.getBoundingClientRect().top + scrollY + 18000000 * ratio
        window.scrollTo(0, top - 200)
        await new Promise(resolve => setTimeout(resolve, 200))
        const rect = marker.getBoundingClientRect()
        points.push(document.elementFromPoint(rect.left + 20, rect.top + 20) === marker)
      }
      return { visible: points.every(Boolean), points, overflow: getComputedStyle(paper.closest('.lark-doc')).overflowX }
    } finally {
      marker.remove()
      if (previous === null) paper.removeAttribute('style')
      else paper.setAttribute('style', previous)
      window.scrollTo(0, 0)
    }
  })
  record('[超高页面] 1800万像素排版中部仍可绘制和命中正文', deepPage.visible, JSON.stringify(deepPage))
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(50)
  const blank = await page.evaluate(() => {
    const root = window.__p7.editor.view.dom
    const state = window.__p7Blank = { reads: 0, nodes: [] }
    for (const node of root.children) {
      const descriptor = Object.getOwnPropertyDescriptor(node, 'getClientRects')
      const read = node.getClientRects
      state.nodes.push({ node, descriptor })
      node.getClientRects = function () { state.reads += 1; return read.call(this) }
    }
    const rect = root.getBoundingClientRect()
    return { x: rect.left + 40, y: rect.top + 1 }
  })
  await page.mouse.click(blank.x, blank.y)
  const blankReads = await page.evaluate(() => {
    const state = window.__p7Blank
    state.nodes.forEach(({ node, descriptor }) => { if (descriptor) Object.defineProperty(node, 'getClientRects', descriptor); else delete node.getClientRects })
    return state.reads
  })
  record('[命中] 点击段落空白不扫描整篇块矩形', blankReads <= 32 && blank.y >= 0 && blank.y < 1000, `root rect reads=${blankReads} y=${blank.y}`)
  await page.evaluate(() => {
    const NativeWorker = window.Worker
    const first = window.__p7.editor.state.doc.firstChild
    const toJSON = first.toJSON
    const state = window.__p7Background = { serialized: 0, packets: [], done: false, NativeWorker, first, toJSON }
    first.toJSON = function () { state.serialized += 1; return toJSON.call(this) }
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args)
        this.addEventListener('message', ({ data }) => {
          if (data.type === 'chunk') state.packets.push(data.content.length)
          if (data.type === 'done') state.done = true
        })
      }
    }
  })
  await page.evaluate(() => {
    const state = window.__p7Background
    window.addEventListener('scroll', event => {
      state.startedByScroll = event.isTrusted
      state.task = window.__larkDoc._handle.editorController.getSnapshotAsync().then(result => { state.result = result })
    }, { capture: true, once: true })
  })
  for (let index = 0; index < 4; index += 1) { await page.mouse.wheel(0, 80); await page.waitForTimeout(25) }
  const paused = await page.evaluate(() => ({ serialized: window.__p7Background.serialized, trusted: window.__p7Background.startedByScroll }))
  record('[后台] 连续滚动时快照尚未序列化首块', paused.serialized === 0 && paused.trusted, JSON.stringify(paused))
  const snapshot = await page.evaluate(async () => {
    const state = window.__p7Background
    try {
      await state.task
      return { equal: JSON.stringify(state.result?.json) === JSON.stringify(window.__larkDoc.getJSON()), done: state.done,
        packets: state.packets.length, maxPacket: Math.max(0, ...state.packets) }
    } finally { window.Worker = state.NativeWorker; state.first.toJSON = state.toJSON }
  })
  record('[Worker] 真正分批返回 JSON，单批不超过128块', snapshot.done && snapshot.packets > 1 && snapshot.maxPacket <= 128, JSON.stringify(snapshot))
  record('[Worker] 分批输出与同步公开 JSON 完全相同', snapshot.equal)
  await page.evaluate(() => { window.Worker = window.__p7SegmentTrace.NativeWorker })

  // Keep this edit outside the fixture import's normal history grouping window.
  await page.waitForTimeout(550)
  const history = await page.evaluate(() => {
    const editor = window.__p7.editor
    const before = editor.state.doc.firstChild.textContent
    editor.commands.insertContentAt(3, '增量校验')
    const edited = editor.state.doc.firstChild.textContent
    const undo = editor.commands.undo() && editor.state.doc.firstChild.textContent === before
    const redo = editor.commands.redo() && editor.state.doc.firstChild.textContent === edited
    return { undo, redo }
  })
  record('[事务] 补号后输入、撤销与重做保持正文', history.undo && history.redo, JSON.stringify(history))

  await page.evaluate(() => window.__p7.editor.commands.focus(null, { scrollIntoView: false }))
  await page.waitForTimeout(50)
  const copied = await page.evaluate(() => {
    const editor = window.__p7.editor, root = editor.view.dom
    const left = root.children[127].firstChild, right = root.children[128].firstChild
    const positions = []
    editor.state.doc.forEach((_node, pos, index) => { if (index === 127 || index === 128) positions.push(pos + 6) })
    const expected = editor.state.doc.textBetween(positions[0], positions[1], '\n\n')
    window.__p7Cross = { json: editor.getJSON(), from: positions[0], to: positions[1], left, right, expected }
    document.getSelection().setBaseAndExtent(left, 5, right, 5)
    return expected
  })
  await page.waitForFunction(() => window.__p7.editor.state.selection.from === window.__p7Cross.from && window.__p7.editor.state.selection.to === window.__p7Cross.to)
  await page.evaluate(() => { const cross = window.__p7Cross; document.getSelection().setBaseAndExtent(cross.right, 5, cross.left, 5) })
  await page.waitForFunction(() => window.__p7.editor.state.selection.anchor > window.__p7.editor.state.selection.head)
  const clipboard = await page.evaluate(() => {
    const data = new DataTransfer()
    window.__p7.editor.view.dom.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }))
    return data.getData('text/plain')
  })
  await page.keyboard.press('Backspace')
  await page.waitForFunction(() => window.__p7.editor.state.doc.childCount === 1024 && window.__p7ProjectionOrder())
  await page.keyboard.press('Meta+z')
  await page.waitForFunction(() => window.__p7.editor.state.doc.childCount === 1025 && window.__p7ProjectionOrder())
  const restored = await page.evaluate(() => JSON.stringify(window.__p7.editor.getJSON()) === JSON.stringify(window.__p7Cross.json))
  record('[选区] 跨段前后向选区、复制、原生删除与撤销正确', clipboard === copied && restored, `复制一致=${clipboard === copied} 撤销一致=${restored}`)

  const pageCopy = await page.evaluate(() => {
    const editor = window.__p7.editor
    const left = editor.view.dom.children[511].firstChild, right = editor.view.dom.children[512].firstChild
    const positions = []
    editor.state.doc.forEach((node, pos, index) => { if (index === 511 || index === 512) positions.push(pos + 6) })
    window.__p7PageCross = { json: editor.getJSON(), from: positions[0], to: positions[1] }
    document.getSelection().setBaseAndExtent(left, 5, right, 5)
    return left.textContent.slice(5) + '\n\n' + right.textContent.slice(0, 5)
  })
  await page.waitForFunction(() => window.__p7.editor.state.selection.from === window.__p7PageCross.from && window.__p7.editor.state.selection.to === window.__p7PageCross.to)
  const pageClipboard = await page.evaluate(() => {
    const data = new DataTransfer()
    window.__p7.editor.view.dom.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }))
    return data.getData('text/plain')
  })
  await page.keyboard.press('Backspace')
  await page.waitForFunction(() => window.__p7.editor.state.doc.childCount === 1024 && window.__p7ProjectionOrder())
  await page.keyboard.press('Meta+z')
  await page.waitForFunction(() => window.__p7.editor.state.doc.childCount === 1025 && window.__p7ProjectionOrder())
  record('[分区] 跨绘制分区复制、原生删除和撤销保持正文与DOM一致', pageClipboard === pageCopy && await page.evaluate(() => JSON.stringify(window.__p7.editor.getJSON()) === JSON.stringify(window.__p7PageCross.json)))

  const typingTarget = await page.evaluate(() => {
    const editor = window.__p7.editor
    let end = 0
    editor.state.doc.forEach((node, pos, index) => { if (index === 127) end = pos + node.nodeSize - 1 })
    editor.chain().setTextSelection(end).scrollIntoView().run()
    window.__p7Cross.paragraph = editor.state.doc.child(127).textContent
    const caret = editor.view.coordsAtPos(end)
    return { from: editor.state.selection.from, expected: end, top: caret.top, bottom: caret.bottom, height: innerHeight }
  })
  record('[导航] 跨分区后光标回到目标段落且实际可见', typingTarget.from === typingTarget.expected && typingTarget.bottom > 0 && typingTarget.top < typingTarget.height, JSON.stringify(typingTarget))
  await page.keyboard.press('Enter')
  await page.keyboard.insertText('段间输入')
  await page.waitForFunction(() => window.__p7.editor.state.doc.child(128).textContent === '段间输入' && window.__p7ProjectionOrder())
  await page.evaluate(() => { const editor = window.__p7.editor; editor.commands.setTextSelection(editor.state.selection.$from.start()) })
  await page.keyboard.press('Backspace')
  await page.waitForFunction(() => window.__p7.editor.state.doc.childCount === 1025 && window.__p7ProjectionOrder())
  record('[输入] 段边界原生Enter与Backspace合并不丢块', await page.evaluate(() => window.__p7.editor.state.doc.child(127).textContent === window.__p7Cross.paragraph + '段间输入'))
  const ime = await page.context().newCDPSession(page)
  await ime.send('Input.imeSetComposition', { text: '输入法核验', selectionStart: 5, selectionEnd: 5 })
  await ime.send('Input.insertText', { text: '输入法核验' })
  await ime.detach()
  await page.waitForFunction(() => window.__p7.editor.state.doc.child(127).textContent.includes('输入法核验'))
  record('[输入法] 真实composition提交与DOM、模型一致', await page.evaluate(() => window.__p7.editor.state.doc.child(127).textContent === window.__p7.editor.view.dom.children[127].textContent && window.__p7ProjectionOrder()))

  const atoms = await page.evaluate(() => {
    const editor = window.__p7.editor
    const paragraph = text => ({ type: 'paragraph', content: [{ type: 'text', text }] })
    const row = () => ({ type: 'tableRow', content: ['一', '二'].map(text => ({ type: 'tableCell', content: [paragraph(text)] })) })
    editor.commands.insertContentAt(editor.state.doc.content.size, [{ type: 'table', content: [row(), row()] },
      { type: 'image', attrs: { src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=' } }])
    const cells = []; let image = 0
    editor.state.doc.descendants((node, pos) => { if (node.type.name === 'tableCell') cells.push(pos); if (node.type.name === 'image') image = pos })
    editor.commands.setCellSelection({ anchorCell: cells[0], headCell: cells[3] })
    const cell = editor.state.selection.toJSON().type === 'cell'
    editor.commands.setNodeSelection(image)
    return { cell, node: editor.state.selection.node?.type.name === 'image' }
  })
  await page.waitForFunction(() => window.__p7ProjectionOrder())
  record('[原子块] CellSelection与图片NodeSelection保持正确', atoms.cell && atoms.node, JSON.stringify(atoms))
  await page.waitForFunction(() => {
    const wrapper = window.__p7.editor.view.dom.querySelector('.tableWrapper')
    return window.__p7.vm._observedTableClips?.has(wrapper)
  })
  const tableGeometry = await page.evaluate(() => {
    const wrapper = window.__p7.editor.view.dom.querySelector('.tableWrapper')
    const root = window.__p7.editor.view.dom
    wrapper.querySelector('table').style.minWidth = '2400px'
    wrapper.scrollIntoView({ block: 'center' })
    window.__p7TableGeometry = () => {
      const group = wrapper.assignedSlot?.parentElement, page = group?.parentElement, rect = wrapper.getBoundingClientRect()
      const box = node => { const r = node?.getBoundingClientRect(); return r ? { top: r.top, bottom: r.bottom, height: r.height } : null }
      const hit = document.elementFromPoint(rect.left + 30, rect.top + Math.min(25, rect.height / 2))
      return { top: rect.top, bottom: rect.bottom, y: scrollY, width: wrapper.clientWidth, scrollWidth: wrapper.scrollWidth,
        group: group?.className, page: page?.className, groupBox: box(group), pageBox: box(page), painted: wrapper.contains(hit), hit: hit?.tagName,
        rootBox: box(root),
        observed: window.__p7.vm._observedTableClips?.has(wrapper), visible: window.__p7.vm._visibleTableClips?.has(wrapper) }
    }
    return window.__p7TableGeometry()
  })
  console.log('[表格几何]', JSON.stringify(tableGeometry))
  await page.waitForFunction(() => window.__p7.editor.view.dom.querySelector('.tableWrapper').classList.contains('is-clipped'))
  await page.evaluate(() => {
    window.__p7.editor.view.dom.querySelector('.tableWrapper table').style.minWidth = ''
    window.dispatchEvent(new Event('resize'))
  })
  await page.waitForFunction(() => !window.__p7.editor.view.dom.querySelector('.tableWrapper').classList.contains('is-clipped'))
  record('[表格] 可见表格溢出与窗口resize正确更新且不漂离视口', await page.evaluate(() => window.__p7TableGeometry().painted))
  await page.evaluate(() => { window.__p7.editor.commands.setTextSelection(1); window.scrollTo(0, 0) })
  await page.waitForFunction(() => !window.__p7TableGeometry().observed)
  record('[表格] 退窗表格仍在文档但已解除观察', await page.evaluate(() => !!window.__p7.editor.view.dom.querySelector('.tableWrapper') && !window.__p7TableGeometry().observed))
  await page.evaluate(() => {
    const editor = window.__p7.editor
    let image = 0
    editor.state.doc.descendants((node, pos) => { if (node.type.name === 'image') image = pos })
    editor.commands.setNodeSelection(image)
    editor.view.dom.querySelector('.tableWrapper').scrollIntoView({ block: 'center' })
  })
  await page.waitForFunction(() => window.__p7TableGeometry().observed && window.__p7TableGeometry().painted)
  record('[表格] 回到窗口后重新观察且实际可见', await page.evaluate(() => window.__p7TableGeometry().observed && window.__p7TableGeometry().painted))
  const viewport = page.viewportSize()
  await page.setViewportSize({ width: 393, height: 900 })
  await page.waitForTimeout(100)
  const narrow = await page.evaluate(() => ({ viewport: innerWidth, width: document.documentElement.scrollWidth }))
  record('[窄屏] 大文档解除整页裁剪后不产生页面横向溢出', narrow.width <= narrow.viewport + 1, JSON.stringify(narrow))
  await page.setViewportSize(viewport)
  await page.mouse.move(0, 0)
  await page.evaluate(() => {
    const content = Array.from({ length: 1025 }, () => ({ type: 'paragraph', content: [{ type: 'text', text: '边界正文'.repeat(128) }] }))
    content[512] = { type: 'image', attrs: { src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', width: 320, height: 180 } }
    window.__larkDoc.setContent({ type: 'doc', content })
    const editor = window.__p7.editor
    let position = 0
    editor.state.doc.forEach((node, pos, index) => { if (index === 512) position = pos })
    editor.commands.setNodeSelection(position)
    editor.view.dom.querySelector('.lark-doc-image-frame').scrollIntoView({ block: 'center' })
  })
  const image = page.locator('.ProseMirror .lark-doc-image').first()
  const defaultCircles = await image.locator('.lark-doc-image-resize:not(.is-hidden)').count()
  await image.locator('.lark-doc-image-img').hover()
  await image.locator('.lark-doc-image-toolbar').waitFor()
  const imageBoundary = await page.evaluate(() => {
    const image = window.__p7.editor.view.dom.querySelector('.lark-doc-image')
    const toolbar = image.querySelector('.lark-doc-image-toolbar'), r = toolbar.getBoundingClientRect()
    const toolbarPainted = [10, r.width / 2, r.width - 10].every(x => toolbar.contains(document.elementFromPoint(r.left + x, (r.top + r.bottom) / 2)))
    const circles = [...image.querySelectorAll('.lark-doc-image-resize:not(.is-hidden)')]
    const cornersPainted = circles.length === 4 && circles.every(button => {
      const rect = button.getBoundingClientRect(), top = button.dataset.corner.startsWith('top')
      return button.contains(document.elementFromPoint((rect.left + rect.right) / 2, top ? rect.top + 2 : rect.bottom - 2))
    })
    const group = image.assignedSlot?.parentElement
    return { toolbarPainted, cornersPainted, circles: circles.length, toolbarTop: r.top,
      groupTop: group?.getBoundingClientRect().top, groupContain: group ? getComputedStyle(group).contain : null,
      pageContain: group ? getComputedStyle(group.parentElement).contain : null }
  })
  imageBoundary.defaultCircles = defaultCircles
  record('[图片] 分区首块图片悬浮工具条实际绘制完整', imageBoundary.toolbarPainted, JSON.stringify(imageBoundary))
  record('[图片] 默认隐藏圆圈，悬浮四角完整可命中', defaultCircles === 0 && imageBoundary.cornersPainted, JSON.stringify(imageBoundary))
  await page.mouse.move(0, 0)
  await page.evaluate(() => window.__larkDoc.setContent({ type: 'doc', content: [
    { type: 'heading', attrs: { level: 1, blockId: 'projection_fold' }, content: [{ type: 'text', text: '折叠验收' }] },
    ...Array.from({ length: 256 }, () => ({ type: 'paragraph', attrs: { indent: 1 }, content: [{ type: 'text', text: '正文'.repeat(1100) }] })),
  ] }))
  await page.waitForFunction(() => window.__p7.editor.view.dom.shadowRoot?.querySelectorAll('.segment').length === 17)
  await page.evaluate(() => {
    const editor = window.__p7.editor
    editor.commands.setTextSelection(editor.state.doc.content.size - 1)
    window.scrollTo(0, document.documentElement.scrollHeight)
    return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  })
  await page.evaluate(() => window.__p7.editor.commands.toggleLarkDocFold(0))
  await page.waitForFunction(() => window.__p7.editor.view.dom.children[1].style.display === 'none')
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const foldedHeight = await page.evaluate(() => {
    const root = window.__p7.editor.view.dom, rect = root.getBoundingClientRect()
    return { height: rect.height, minimum: parseFloat(getComputedStyle(root).minHeight) || 0, visible: rect.bottom > 0 && rect.top < innerHeight,
      paper: root.closest('.lark-doc-paper').getBoundingClientRect().height, document: document.documentElement.scrollHeight }
  })
  record('[折叠] 收起跨排版窗口的正文不留下空白占位', foldedHeight.height <= Math.max(100, foldedHeight.minimum) + 2 && foldedHeight.visible, JSON.stringify(foldedHeight))
  await page.evaluate(() => window.__p7.editor.commands.toggleLarkDocFold(0))
  await page.waitForFunction(() => window.__p7.editor.view.dom.children[1].style.display !== 'none')
  record('[折叠] 展开后恢复全部正文与投影顺序', await page.evaluate(() => window.__p7ProjectionOrder() && window.__p7.editor.state.doc.childCount === 257))
  await page.evaluate(() => {
    const content = Array.from({ length: 4097 }, (_, index) => ({ type: 'paragraph', content: [{ type: 'text', text: `窗口${index} ` + '虚拟视口核验'.repeat(40) }] }))
    content[0] = { type: 'isv', attrs: { kind: 'catalog', instanceId: 'virtual-catalog-navigation', appId: 'cli_a3f7707424af9013', height: 335 } }
    content[4095] = { type: 'heading', attrs: { level: 2, blockId: 'virtual_navigation_target' }, content: [{ type: 'text', text: '远处分区导航' }] }
    window.__larkDoc.setContent({ type: 'doc', content })
    window.__p7.editor.commands.setTextSelection(1)
    window.scrollTo(0, 0)
  })
  await page.waitForFunction(() => window.__p7.editor.view.dom.getAttribute('data-ld-render-pages') === '9')
  const windowed = await page.evaluate(() => {
    const root = window.__p7.editor.view.dom, pages = [...root.shadowRoot.querySelectorAll('.render-page')]
    return { total: pages.length, visible: pages.filter(page => page.classList.contains('is-visible')).length,
      assigned: [...root.shadowRoot.querySelectorAll('slot')].reduce((count, slot) => count + slot.assignedNodes().length, 0),
      hidden: pages.some(page => getComputedStyle(page).contentVisibility === 'hidden'), ordered: window.__p7ProjectionOrder(),
      paperShadow: getComputedStyle(root.closest('.lark-doc-paper')).boxShadow }
  })
  record('[虚拟窗口] 九个分区只挂载视口附近的段', windowed.visible > 0 && windowed.visible <= 6 && windowed.hidden && windowed.assigned > 0 && windowed.assigned <= 128 && windowed.ordered && windowed.paperShadow === 'none', JSON.stringify(windowed))
  const coordinates = await page.evaluate(() => {
    const map = window.__p7.editor.storage.larkDoc.projection.getScrollCoordinates()
    return { logical: map.logicalHeight, physical: map.physicalHeight, scale: map.scale, actual: window.__p7.editor.view.dom.getBoundingClientRect().height }
  })
  record('[逻辑滚动] 超百万像素正文映射到有界物理高度', coordinates.logical > 1000000 && coordinates.physical < 1100000 && coordinates.scale < 1 && Math.abs(coordinates.actual - coordinates.physical) < 4, JSON.stringify(coordinates))
  const readingAnchor = await page.evaluate(async () => {
    const editor = window.__p7.editor, root = editor.view.dom, projection = editor.storage.larkDoc.projection
    let position = 0
    editor.state.doc.forEach((node, pos, index) => { if (index === 3072) position = pos + 1 })
    editor.commands.setTextSelection(position)
    projection.revealNode(root.children[3072])
    root.children[3072].scrollIntoView({ block: 'center' })
    const settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    await settle()
    const map = projection.getScrollCoordinates(), anchor = map.anchorAtPhysical(Math.max(0, -root.getBoundingClientRect().top))
    const groups = [...root.shadowRoot.querySelectorAll('.segment')], above = groups[anchor.index - 1]
    if (!above?.classList.contains('is-visible')) return { ready: false }
    const target = root.children[(anchor.index + 1) * 16], before = target.getBoundingClientRect().top
    above.style.paddingTop = '180px'
    await settle(); await settle()
    const after = target.getBoundingClientRect().top
    above.style.paddingTop = ''
    await settle(); await settle()
    return { ready: true, before, after, drift: after - before }
  })
  record('[逻辑滚动] 上方窗口测高变化保持当前阅读段位置', readingAnchor.ready && Math.abs(readingAnchor.drift) <= 2, JSON.stringify(readingAnchor))
  const documentEnd = await page.evaluate(() => window.__p7.editor.state.doc.content.size - 1)
  const endShortcut = process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End'
  const homeShortcut = process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home'
  const shiftEndShortcut = process.platform === 'darwin' ? 'Meta+Shift+ArrowDown' : 'Control+Shift+End'
  const shiftHomeShortcut = process.platform === 'darwin' ? 'Meta+Shift+ArrowUp' : 'Control+Shift+Home'
  await page.evaluate(() => { const editor = window.__p7.editor; editor.commands.setTextSelection(2); editor.view.focus(); window.scrollTo(0, 0) })
  await page.keyboard.press(endShortcut)
  await page.waitForFunction(end => window.__p7.editor.state.selection.head === end, documentEnd)
  const nativeEndVisible = await page.evaluate(() => {
    const rect = window.__p7.editor.view.dom.lastElementChild.getBoundingClientRect()
    return rect.bottom > 0 && rect.top < innerHeight
  })
  await page.keyboard.press(homeShortcut)
  await page.waitForFunction(() => window.__p7.editor.state.selection.from <= 2)
  record('[键盘] 原生首尾快捷键跨未挂载正文且末尾实际可见', nativeEndVisible)
  await page.evaluate(() => { const editor = window.__p7.editor; editor.commands.setTextSelection(2); editor.view.focus(); window.scrollTo(0, 0) })
  await page.keyboard.press(shiftEndShortcut)
  await page.waitForFunction(end => window.__p7.editor.state.selection.anchor === 2 && window.__p7.editor.state.selection.head === end, documentEnd)
  await page.keyboard.press(shiftHomeShortcut)
  await page.waitForFunction(() => window.__p7.editor.state.selection.anchor === 2 && window.__p7.editor.state.selection.head <= 2)
  record('[键盘] Shift首尾快捷键保留原生选区锚点', await page.evaluate(() => window.__p7.editor.state.selection.anchor === 2 && window.__p7.editor.state.selection.head <= 2))
  const keyboardFold = await page.evaluate(() => {
    const editor = window.__p7.editor, original = editor.getJSON()
    window.__p7.keyboardOriginal = original
    const content = original.content.slice(), index = content.length - 1
    content[index] = { ...content[index], type: 'heading', attrs: { ...content[index].attrs, level: 1, blockId: 'keyboard_folded_tail' } }
    content.push(...Array.from({ length: 256 }, (_, index) => ({ type: 'paragraph', attrs: { indent: 1 }, content: [{ type: 'text', text: `折叠子段${index}` }] })))
    window.__larkDoc.setContent({ type: 'doc', content })
    let position = 0
    editor.state.doc.forEach((node, pos, at) => { if (at === index) position = pos })
    editor.commands.toggleLarkDocFold(position)
    editor.commands.setTextSelection(2)
    editor.view.focus()
    window.scrollTo(0, 0)
    return { position, end: position + editor.state.doc.child(index).nodeSize - 1 }
  })
  await page.keyboard.press(endShortcut)
  await page.waitForFunction(end => window.__p7.editor.state.selection.head === end, keyboardFold.end)
  const foldedEndVisible = await page.evaluate(pos => {
    const rect = window.__p7.editor.view.nodeDOM(pos).getBoundingClientRect()
    return rect.bottom > 0 && rect.top < innerHeight
  }, keyboardFold.position)
  await page.evaluate(() => { const editor = window.__p7.editor; editor.commands.setTextSelection(2); editor.view.focus(); window.scrollTo(0, 0) })
  await page.keyboard.press(shiftEndShortcut)
  await page.waitForFunction(end => window.__p7.editor.state.selection.anchor === 2 && window.__p7.editor.state.selection.head === end, keyboardFold.end)
  record('[键盘] 跨组尾部折叠后End与Shift+End到达最后可见块', foldedEndVisible && await page.evaluate(end => window.__p7.editor.state.selection.head === end, keyboardFold.end))
  await page.evaluate(() => {
    window.__larkDoc.setContent(window.__p7.keyboardOriginal)
    delete window.__p7.keyboardOriginal
    const editor = window.__p7.editor
    editor.commands.setTextSelection(2)
    editor.view.focus()
    window.scrollTo(0, 0)
  })
  await page.waitForFunction(() => window.__p7.editor.state.doc.childCount === 4097 && window.__p7.editor.view.dom.shadowRoot.querySelectorAll('.segment').length === 257)
  const printProjection = await page.evaluate(() => {
    const root = window.__p7.editor.view.dom, doc = window.__p7.editor.state.doc
    const count = () => [...root.shadowRoot.querySelectorAll('slot')].reduce((sum, slot) => sum + slot.assignedNodes().length, 0)
    window.dispatchEvent(new Event('beforeprint'))
    const full = count() === root.childNodes.length
    window.dispatchEvent(new Event('afterprint'))
    return full && count() < root.childNodes.length && window.__p7ProjectionOrder() && window.__p7.editor.state.doc === doc
  })
  record('[虚拟窗口] 打印暂时恢复整篇挂载后回到有界窗口', printProjection)
  const preparedSelection = await page.evaluate(() => {
    const editor = window.__p7.editor, root = editor.view.dom
    let position = 0
    editor.state.doc.forEach((node, pos, index) => { if (index === 3072) position = pos + 1 })
    const before = root.children[3072].assignedSlot
    let ready = false
    const updateState = editor.view.updateState
    editor.view.updateState = function (state) {
      ready = !!root.children[3072].assignedSlot
      return updateState.call(this, state)
    }
    try { editor.commands.setTextSelection(position) } finally { editor.view.updateState = updateState }
    return { before: !!before, ready, selected: editor.state.selection.from === position }
  })
  record('[虚拟窗口] 不滚动的远处选区在PM写入原生选区前已挂载', !preparedSelection.before && preparedSelection.ready && preparedSelection.selected, JSON.stringify(preparedSelection))
  const combinedEdit = await page.evaluate(() => {
    const editor = window.__p7.editor, root = editor.view.dom, target = root.children[2048]
    let position = 0, ready = false
    editor.state.doc.forEach((node, pos, index) => { if (index === 2048) position = pos + 1 })
    const before = !!target.assignedSlot, original = target.textContent, updateState = editor.view.updateState
    editor.view.updateState = function (state) { ready = !!target.assignedSlot; return updateState.call(this, state) }
    try { editor.chain().setTextSelection(position).insertContent('链').run() } finally { editor.view.updateState = updateState }
    const inserted = editor.state.doc.child(2048).textContent === '链' + original
    editor.commands.undo()
    return { before, ready, inserted, restored: editor.state.doc.child(2048).textContent === original }
  })
  record('[虚拟窗口] 组合远处导航与编辑事务按旧坐标预挂载且撤销正确', !combinedEdit.before && combinedEdit.ready && combinedEdit.inserted && combinedEdit.restored, JSON.stringify(combinedEdit))
  const mappingReads = await page.evaluate(() => {
    const editor = window.__p7.editor, original = editor.view.domAtPos
    let reads = 0
    editor.view.domAtPos = function (...args) { reads += 1; return original.apply(this, args) }
    try { for (let index = 0; index < 50; index += 1) editor.storage.larkDoc.projection.refresh() }
    finally { editor.view.domAtPos = original }
    return reads
  })
  record('[虚拟窗口] 同一选区滚动复用DOM锚点而不扫描全文映射', mappingReads <= 2, `50次刷新映射读取=${mappingReads}`)
  const navigation = await page.evaluate(async () => {
    const editor = window.__p7.editor, host = window.__p7.vm, target = editor.view.dom.querySelector('[data-block-id="virtual_navigation_target"]')
    const visible = () => { const r = target.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight }
    const reset = async () => { window.scrollTo(0, 0); await new Promise(resolve => requestAnimationFrame(resolve)) }
    history.replaceState(null, '', location.pathname + location.search + '#share-virtual_navigation_target')
    host.jumpSharedBlock()
    const share = visible()
    history.replaceState(null, '', location.pathname + location.search)
    await reset()
    host.scrollCommentIntoView('virtual_navigation_target')
    const comment = visible()
    return { share, comment }
  })
  record('[虚拟窗口] 分享及评论跳转先激活远处分区', navigation.share && navigation.comment, JSON.stringify(navigation))
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.frameLocator('iframe.isv-catalog-iframe').locator('.catalog-text').click()
  await page.waitForFunction(() => { const r = window.__p7.editor.view.dom.querySelector('[data-block-id="virtual_navigation_target"]').getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight })
  record('[虚拟窗口] 默认目录块可跳到未绘制的远处标题', await page.evaluate(() => { const r = window.__p7.editor.view.dom.querySelector('[data-block-id="virtual_navigation_target"]').getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight }))
  await page.evaluate(() => {
    const editor = window.__p7.editor
    editor.chain().setTextSelection(editor.state.doc.content.size - 1).scrollIntoView().run()
    editor.view.focus()
  })
  const farTarget = await page.evaluate(() => {
    const root = window.__p7.editor.view.dom, rect = root.lastElementChild.getBoundingClientRect()
    return { active: Number(root.getAttribute('data-ld-active-pages')), top: rect.top, bottom: rect.bottom }
  })
  record('[虚拟窗口] 远处光标先激活分区再滚入视口', farTarget.active <= 6 && farTarget.bottom > 0 && farTarget.top < 900, JSON.stringify(farTarget))
  const fullCopy = await page.evaluate(() => {
    const editor = window.__p7.editor
    editor.commands.selectAll()
    const data = new DataTransfer()
    editor.view.dom.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }))
    // The schema-aware serializer preserves the leading separator of the catalog atom.
    const actual = data.getData('text/plain'), expected = editor.getText()
    let firstDifference = 0
    while (firstDifference < Math.min(actual.length, expected.length) && actual[firstDifference] === expected[firstDifference]) firstDifference += 1
    return { equal: actual === expected, actualLength: actual.length, expectedLength: expected.length,
      firstDifference, actualExcerpt: actual.slice(firstDifference, firstDifference + 32), expectedExcerpt: expected.slice(firstDifference, firstDifference + 32),
      active: Number(editor.view.dom.getAttribute('data-ld-active-pages')) }
  })
  record('[虚拟窗口] 全选复制包含未绘制正文且活动分区有界', fullCopy.equal && fullCopy.active <= 6, JSON.stringify(fullCopy))
  await page.keyboard.press('Backspace')
  await page.waitForFunction(() => window.__p7.editor.state.doc.childCount === 1)
  await page.keyboard.press('Meta+z')
  await page.waitForFunction(() => window.__p7.editor.state.doc.childCount === 4097 && window.__p7ProjectionOrder())
  record('[虚拟窗口] 原生全选删除与撤销恢复整篇文档', true)
  const nestedScroll = await page.evaluate(async () => {
    window.__p7.nestedScroll = async () => {
      const editor = window.__p7.editor, shell = editor.view.dom.closest('.lark-doc'), parent = shell.parentNode
      const pane = document.createElement('div')
      pane.style.cssText = 'height:560px;overflow:auto;border:1px solid transparent'
      parent.insertBefore(pane, shell); pane.appendChild(shell)
      const settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      let hitFailure = null
      const hits = node => {
        const rect = node.getBoundingClientRect(), bounds = pane.getBoundingClientRect()
        const top = Math.max(0, bounds.top + pane.clientTop, rect.top), bottom = Math.min(innerHeight, bounds.top + pane.clientTop + pane.clientHeight, rect.bottom)
        const hit = bottom > top ? document.elementFromPoint(rect.left + rect.width / 2, (top + bottom) / 2) : null
        const ok = bottom > top && node.contains(hit)
        if (!ok) hitFailure = { target: node.tagName, text: node.textContent.slice(0, 24), rect: rect.toJSON(), hit: hit?.outerHTML.slice(0, 300), toolbarPosition: getComputedStyle(shell.querySelector('.lark-doc-toolbar')).position }
        return ok
      }
      try {
        window.scrollTo(0, 0)
        window.dispatchEvent(new Event('resize'))
        // Reparenting a focused editor clears the browser selection. Establish
        // the native focus a user would have before asking PM to scroll it.
        editor.view.focus()
        let endPosition = 1, endBlock = 0, startBlock = null
        editor.state.doc.descendants((node, pos) => {
          if (node.isTextblock) { if (startBlock === null) startBlock = pos; endBlock = pos; endPosition = pos + 1 + node.content.size }
        })
        editor.chain().setTextSelection(endPosition).scrollIntoView().run()
        await settle(); await settle()
        const bounds = pane.getBoundingClientRect(), tail = editor.view.dom.lastElementChild.getBoundingClientRect()
        const end = tail.bottom > bounds.top && tail.top < bounds.bottom && pane.scrollTop > 0
        const endHit = hits(editor.view.nodeDOM(endBlock))
        editor.chain().setTextSelection(startBlock + 1).scrollIntoView().run()
        await settle(); await settle()
        const first = editor.view.nodeDOM(startBlock), rect = first.getBoundingClientRect()
        const startHit = hits(first)
        return { end, endHit, start: rect.bottom > bounds.top && rect.top < bounds.bottom, startHit, hitFailure, scrollTop: pane.scrollTop, clip: editor.view.dom.style.clipPath, paperClip: editor.view.dom.closest('.lark-doc-paper').style.clipPath }
      } finally {
        parent.insertBefore(shell, pane); pane.remove()
        window.dispatchEvent(new Event('resize'))
        editor.view.focus()
      }
    }
    return window.__p7.nestedScroll()
  })
  record('[逻辑滚动] 内嵌滚动容器的首尾定位与返回正常', nestedScroll.end && nestedScroll.start && nestedScroll.endHit && nestedScroll.startHit, JSON.stringify(nestedScroll))
  const asyncImport = await page.evaluate(async () => {
    const api = window.__larkDoc, editor = api.getEditor()
    api.setContent('<p data-block-id="async_before">异步导入之前</p>')
    const before = editor.state.doc
    const html = Array.from({ length: 513 }, (_, i) => i % 31 === 0 ? `<h2>段标题${i}</h2>` : `<p data-block-id="duplicated">${i} ${'异步分页核验'.repeat(200)}</p>`).join('') + '<table><tr><td><p>页末表格</p></td></tr></table><h1>异步尾部标题</h1>'
    window.__p7.asyncHtml = html
    const publications = []
    // The preceding synchronous fixture may publish during async preflight.
    // It is a separate edit; retain every imported/partial payload for this assertion.
    const changed = payload => { if (payload.text !== '异步导入之前') publications.push(payload.text) }
    const projection = editor.storage.larkDoc.projection, prepare = projection?.prepareSelection
    let preparedWhileImporting = 0
    if (prepare) projection.prepareSelection = function (nodes) {
      if (editor.storage.larkDoc.pagedImport) preparedWhileImporting++
      return prepare.call(this, nodes)
    }
    api.on('change', changed)
    try {
      const accepted = await api.setContentAsync(html, { pagedView: true })
      const body = editor.state.doc, logical = editor.storage.larkDoc.pagedView.logicalDocument(body), stats = editor.storage.larkDoc.lastPagedImport
      const ids = []
      body.descendants(node => { if (node.attrs.blockId) ids.push(node.attrs.blockId) })
      for (let attempt = 0; attempt < 100 && !publications.some(text => text.includes('异步尾部标题')); attempt++) await new Promise(resolve => setTimeout(resolve, 100))
      const onlyFinal = publications.length === 1 && publications[0].includes('异步尾部标题')
      api.off('change', changed)
      editor.commands.undo()
      const undone = editor.state.doc.eq(before)
      editor.commands.redo()
      const redone = editor.state.doc.eq(body)
      const json = api.getJSON(), identity = editor.state.doc
      const unchanged = await api.setContentAsync(json)
      return { accepted, count: logical.childCount, tail: logical.lastChild.type.name, pageRoots: body.childCount, rendered: editor.storage.larkDoc.pagedView.getRenderedBlocks().length, stats, unique: ids.length === new Set(ids).size,
        onlyFinal, publications: publications.length, undone, redone, preparedWhileImporting: prepare ? preparedWhileImporting : -1,
        unchanged: unchanged === false && editor.state.doc === identity }
    } finally { api.off('change', changed); if (prepare) projection.prepareSelection = prepare }
  })
  record('[分页导入] 真实API分段提交并仅发布最终正文，跨页ID唯一', asyncImport.accepted && asyncImport.count === 516 && asyncImport.tail === 'paragraph' && asyncImport.pageRoots < 516 && asyncImport.rendered < 256 && asyncImport.stats.maxPageBlocks <= 128 && asyncImport.unique && asyncImport.onlyFinal && asyncImport.preparedWhileImporting === 0, JSON.stringify(asyncImport))
  record('[分页导入] 标题和表格页末仍是一笔撤销与重做', asyncImport.undone && asyncImport.redone)
  record('[分页导入] 聚合JSON重灌相同正文不创建新事务', asyncImport.unchanged)
  const pagedNestedScroll = await page.evaluate(() => window.__p7.nestedScroll())
  record('[分页绘制] 内嵌滚动容器首尾定位保持正文可见和绘制范围', pagedNestedScroll.end && pagedNestedScroll.start && pagedNestedScroll.endHit && pagedNestedScroll.startHit && pagedNestedScroll.clip.startsWith('inset(') && pagedNestedScroll.paperClip.startsWith('inset('), JSON.stringify(pagedNestedScroll))
  const pageDownBefore = await page.evaluate(async () => {
    const editor = window.__p7.editor
    editor.chain().focus().setTextSelection(editor.state.doc.firstChild.nodeSize - 4).scrollIntoView().run()
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    return { top: scrollY, anchor: editor.state.selection.anchor }
  })
  await page.keyboard.press('PageDown')
  await page.keyboard.press('Shift+PageDown')
  await page.waitForTimeout(150)
  const pageDownAfter = await page.evaluate(() => {
    const editor = window.__p7.editor, native = document.getSelection(), selection = editor.state.selection
    const anchor = editor.view.posAtDOM(native.anchorNode, native.anchorOffset), head = editor.view.posAtDOM(native.focusNode, native.focusOffset)
    const normalized = selection.constructor.between(editor.state.doc.resolve(anchor), editor.state.doc.resolve(head))
    return { top: scrollY, anchor: selection.anchor, head: selection.head, agrees: normalized.eq(selection) }
  })
  record('[分页键盘] 原生PageDown和Shift翻页后选区同步且滚动继续', pageDownAfter.agrees && pageDownAfter.top > pageDownBefore.top, JSON.stringify({ before: pageDownBefore, after: pageDownAfter }))
  const pagedFold = await page.evaluate(async () => {
    const editor = window.__p7.editor
    await window.__larkDoc.setContentAsync('<p>before</p>'.repeat(60) + '<h1>last visible</h1>' + `<p data-indent="1">${'hidden'.repeat(2000)}</p>`.repeat(50), { pagedView: true, pageBlocks: 4 })
    let heading
    editor.state.doc.descendants((node, pos) => { if (node.type.name === 'heading') heading = { pos, end: pos + node.nodeSize - 1 } })
    editor.commands.toggleLarkDocFold(heading.pos)
    editor.commands.setTextSelection(2); editor.view.focus(); window.scrollTo(0, 0)
    return heading
  })
  await page.keyboard.press(endShortcut)
  await page.waitForFunction(end => window.__p7.editor.state.selection.head === end, pagedFold.end)
  record('[分页键盘] 折叠尾部多页后原生End到达实际可见正文', await page.evaluate(pos => {
    const rect = window.__p7.editor.view.nodeDOM(pos)?.getBoundingClientRect()
    return !!rect && rect.bottom > 0 && rect.top < innerHeight
  }, pagedFold.pos))
  await page.evaluate(() => { window.__p7.editor.commands.setTextSelection(2); window.__p7.editor.view.focus(); window.scrollTo(0, 0) })
  await page.keyboard.press(shiftEndShortcut)
  await page.waitForFunction(end => window.__p7.editor.state.selection.head === end && window.__p7.editor.state.selection.anchor === 2, pagedFold.end)
  record('[分页键盘] Shift+End保留锚点且跳过折叠尾部', true)
  record('[分页打印] 完整挂载正文并恢复窗口及文档身份', await page.evaluate(() => {
    const editor = window.__p7.editor, runtime = editor.storage.larkDoc.pagedView, state = editor.state
    const paper = editor.view.dom.closest('.lark-doc-paper')
    window.dispatchEvent(new Event('beforeprint'))
    const all = runtime.getRenderedBlocks().length === 111 && !editor.view.dom.style.clipPath && !paper.style.clipPath
    window.dispatchEvent(new Event('afterprint'))
    return all && runtime.getRenderedBlocks().length < 111 && editor.state === state && editor.view.dom.style.clipPath.startsWith('inset(') && paper.style.clipPath.startsWith('inset(')
  }))
  await page.evaluate(async () => {
    const image = '<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=" width="320" height="180">'
    await window.__larkDoc.setContentAsync(image + '<h1>绘制范围工具</h1>' + '<p data-indent="1">正文</p>'.repeat(80) + `<p data-indent="1">${'background'.repeat(60000)}</p>`, { pagedView: true })
    window.scrollTo(0, 0)
  })
  const pagedImage = page.locator('.ProseMirror .lark-doc-image').first()
  await page.waitForFunction(() => window.__p7.editor.view.dom.style.clipPath.startsWith('inset('))
  await page.waitForFunction(() => window.__p7.editor.view.dom.closest('.lark-doc-paper').style.clipPath.startsWith('inset('))
  await pagedImage.locator('.lark-doc-image-img').hover()
  await pagedImage.locator('button[data-action="caption"]').click()
  record('[分页绘制] 首块图片上方工具条可真实点击', await pagedImage.locator('.lark-doc-image-caption').isVisible())
  const pagedHeading = page.locator('.ProseMirror h1').first()
  await pagedHeading.hover()
  await pagedHeading.locator('.lark-doc-heading-fold-toggle').click()
  record('[分页绘制] 正文左侧折叠按钮可真实点击', await pagedHeading.locator('.lark-doc-heading-fold-toggle').getAttribute('aria-expanded') === 'false')
  await pagedHeading.click()
  await pagedHeading.hover()
  await page.locator('.lark-doc-block-handle-main').first().hover()
  const blockMenu = page.locator('.lark-doc-block-menu').first()
  await blockMenu.waitFor({ state: 'visible' })
  await blockMenu.locator('.lark-doc-block-submenu-trigger[title="缩进和对齐"]').hover()
  await page.locator('.lark-doc-block-submenu:not(.lark-doc-block-color-submenu) button').first().click()
  record('[分页浮层] 块主菜单与缩进对齐子菜单可真实点击', true)
  await page.keyboard.press('Escape')
  await page.evaluate(async () => {
    await window.__larkDoc.setContentAsync('<p>before</p><div data-type="callout" data-emoji="💡"><p>高亮浮层</p></div>' + '<p>filler</p>'.repeat(80) + `<p>${'background'.repeat(60000)}</p>`, { pagedView: true })
  })
  const pagedCallout = page.locator('.ProseMirror [data-type="callout"]').first()
  await pagedCallout.locator('p').click()
  await pagedCallout.evaluate(node => window.scrollBy(0, node.getBoundingClientRect().top - 70))
  const changeCalloutIcon = page.locator('.lark-doc-callout-tools button[aria-label="更换高亮块图标"]')
  await changeCalloutIcon.waitFor({ state: 'visible' })
  const iconBox = await changeCalloutIcon.boundingBox()
  await changeCalloutIcon.click({ position: { x: iconBox.width / 2, y: Math.min(3, iconBox.height / 4) } })
  const calloutPicker = page.locator('.lark-doc-callout-emoji-picker')
  await calloutPicker.waitFor({ state: 'visible' })
  await calloutPicker.getByRole('tab', { name: '全部', exact: true }).click()
  await calloutPicker.locator('[role="menuitem"]').first().click()
  record('[分页浮层] 视口上缘高亮工具与表情面板可真实点击', true)
  await page.keyboard.press('Escape')
  const cancelledImport = await page.evaluate(async () => {
    const api = window.__larkDoc, editor = api.getEditor(), abort = new AbortController()
    api.setContent('<p data-block-id="cancel_before">取消之前的正文</p>')
    const originalDoc = editor.state.doc
    let original = null
    // Preflight may yield to a native selection transaction. Rollback must
    // restore the exact state immediately before the first owned mutation.
    const captureOriginal = ({ transaction }) => {
      if (!original && transaction.getMeta('larkDocPagedImport')?.phase === 'page') original = editor.state
    }
    editor.on('beforeTransaction', captureOriginal)
    let blocked = false, cancelled = false
    try {
      await api.setContentAsync(window.__p7.asyncHtml, { pagedView: true, pageBlocks: 32, signal: abort.signal, yieldToMain: async () => {
        if (editor.storage.larkDoc.pagedImport) {
          try { api.getJSON() } catch (error) { blocked = error.message.includes('提交中') }
          abort.abort()
        }
        await new Promise(resolve => setTimeout(resolve, 0))
      } })
    } catch (error) { cancelled = error.name === 'AbortError' }
    finally { editor.off('beforeTransaction', captureOriginal) }
    delete window.__p7.asyncHtml
    return { blocked, cancelled, stateRestored: editor.state === original && editor.state.doc === originalDoc, editable: editor.isEditable }
  })
  record('[分页导入] 提交中拒绝部分快照，取消完整恢复原state和可编辑性', Object.values(cancelledImport).every(Boolean), JSON.stringify(cancelledImport))
  await page.evaluate(() => window.__larkDoc.setContent('<p>恢复小文档</p>'))
  await page.waitForFunction(() => !window.__p7.editor.view.dom.classList.contains('lark-doc-segment-layout') && window.__p7ProjectionOrder())
  record('[生命周期] 缩回小文档恢复原始DOM及整页裁剪', await page.evaluate(() => window.__p7.editor.state.doc.childCount === 1 && window.__p7.editor.view.dom.children.length === 1 && getComputedStyle(document.querySelector('.lark-doc')).overflowX === 'clip' && getComputedStyle(document.querySelector('.lark-doc-paper')).boxShadow !== 'none'))
  await page.evaluate(() => window.__larkDoc.destroy())
  await page.waitForTimeout(250)
  record('[生命周期] 销毁不残留编辑器与延后挂载', await page.locator('.ProseMirror').count() === 0)

  record('[运行] 无 JS 报错', errors.length === 0, errors.slice(0, 2).join(' | '))

  await browser.close()
  const failed = results.filter((item) => !item.ok).length
  console.log(`\n${results.length - failed}/${results.length} 项通过`)
  if (failed) process.exitCode = 1
})().catch(async (error) => {
  console.error(error)
  if (diagnosticPage && !diagnosticPage.isClosed()) {
    console.error('失败现场', await diagnosticPage.evaluate(() => {
      const editor = window.__p7?.editor, selection = document.getSelection()
      return { selection: editor?.state.selection.toJSON(), blocks: editor?.state.doc.childCount,
        nearby: [127, 128, 129].map(index => editor?.state.doc.maybeChild(index)?.textContent.slice(0, 80)),
        native: { anchor: selection?.anchorNode?.textContent?.slice(0, 80), anchorOffset: selection?.anchorOffset,
          focus: selection?.focusNode?.textContent?.slice(0, 80), focusOffset: selection?.focusOffset },
        focused: document.activeElement === editor?.view.dom, activePages: editor?.view.dom.getAttribute('data-ld-active-pages'), table: window.__p7TableGeometry?.() }
    }).catch(() => null).then(value => JSON.stringify(value)))
  }
  await runningBrowser?.close()
  process.exitCode = 1
})
