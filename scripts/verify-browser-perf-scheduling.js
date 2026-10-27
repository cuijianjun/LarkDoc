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
/** 一轮「同一帧内来 200 次更新」的极端值：粘贴 / 输入法合成 / 批量事务都能造出来。 */
const BURST = 200
/** 查找去抖窗口 120ms，留 3 倍余量再断言「只跑一次」。 */
const DEBOUNCE_SETTLE_MS = 400
const results = []

function findChromium() {
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
  const browser = await chromium.launch({ executablePath: findChromium(), args: ['--no-sandbox'] })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.waitForSelector('.ProseMirror', { timeout: 20000 })
  await page.waitForFunction(() => window.__larkDoc && window.__larkDoc.getEditor && window.__larkDoc.getEditor(), { timeout: 60000 })

  await page.evaluate((html) => { window.__larkDoc.getEditor().commands.setContent(html) }, buildContent())
  await page.waitForTimeout(700)

  // ---------- 计数器安装 ----------
  const installed = await page.evaluate(() => {
    const facade = window.__larkDoc
    const editor = facade.getEditor()
    const vm = facade.getWorkspace().$refs.document
    if (!vm || typeof vm.runSelectionLayout !== 'function' || typeof vm.updateSearch !== 'function') return false
    const state = { layout: 0, coords: 0 }
    // 方法在 Vue 2 里是实例自有属性（initMethods 会 bind 到 vm），所以直接改 vm 上的
    // 引用就能被 `scheduleSelectionLayout` 的闭包 `this.runSelectionLayout()` 看到。
    const originalLayout = vm.runSelectionLayout
    vm.runSelectionLayout = function (...args) { state.layout += 1; return originalLayout.apply(this, args) }
    const view = editor.view
    const originalCoords = view.coordsAtPos
    view.coordsAtPos = function (...args) { state.coords += 1; return originalCoords.apply(this, args) }
    const positions = []
    editor.state.doc.descendants((node, pos) => { if (node.isTextblock) positions.push(pos + 1) })
    window.__p7 = {
      editor, vm, state, positions,
      reset() { state.layout = 0; state.coords = 0 },
      snapshot() {
        const root = document.querySelector('.ProseMirror')
        return root ? { html: root.innerHTML, elements: root.querySelectorAll('*').length, skeleton: [...root.children].map((el) => `${el.tagName.toLowerCase()}:${el.getAttribute('data-type') || ''}`).join(',') } : null
      },
    }
    return true
  })
  record('[准备] 编辑器 vm 可注入计数点', installed === true)
  if (!installed) { await browser.close(); process.exitCode = 1; return }

  const baseline = await page.evaluate(() => window.__p7.snapshot())

  // ---------- 单次选区更新的成本（基线，证明计数点真的在跳） ----------
  await page.evaluate(() => {
    const { editor, positions } = window.__p7
    editor.commands.focus()
    editor.commands.setTextSelection({ from: positions[0], to: positions[0] + 2 })
  })
  await page.waitForTimeout(200)
  const single = await page.evaluate(() => ({ ...window.__p7.state }))
  record('[调度] 单次选区更新只做一轮定位', single.layout === 1, `layout=${single.layout}`)
  record('[调度] 气泡条每轮定位只量 2 次坐标（起止各一）', single.coords === 2, `coordsAtPos=${single.coords}`)

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
  record('[调度] 200 次连续选区更新只量 2 次坐标', settled.coords === 2, `coordsAtPos=${settled.coords}（合并前应为 ${BURST * 2}）`)

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

  record('[运行] 无 JS 报错', errors.length === 0, errors.slice(0, 2).join(' | '))

  await browser.close()
  const failed = results.filter((item) => !item.ok).length
  console.log(`\n${results.length - failed}/${results.length} 项通过`)
  if (failed) process.exitCode = 1
})().catch((error) => { console.error(error); process.exitCode = 1 })
