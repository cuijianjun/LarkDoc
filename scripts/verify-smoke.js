/**
 * verify-smoke.js — P0-06 三端冒烟（挂载 → 输入 → 折叠 → 表格 → getJSON）。
 *
 * 用法（Node 22 + playwright-core）：
 *   export NODE_PATH=/Users/cjjxw/.workbuddy/binaries/node/workspace/node_modules
 *   node scripts/verify-smoke.js <端名> <url>
 *
 * 三端各自的冒烟钩子（页面全局量）：
 * - vue2  http://127.0.0.1:8080/lark-doc   window.__larkDoc = LarkDoc 门面实例
 * - vue3  http://127.0.0.1:5173/lark-doc   window.__larkDoc = <lark-doc> 元素（element 产物）
 * - react http://127.0.0.1:5174/           window.__larkDoc = 适配层 ref 代理
 * 三者都暴露 getEditor() / getJSON()，冒烟逻辑完全同构。
 *
 * 验收口径（requirements/09 P0-06）：三端各一条链路跑通即绿——
 * 1 挂载 ready；2 键盘输入生效；3 标题可折叠（后代隐藏）；4 可插入表格；
 * 5 getJSON 含输入文本与表格节点。
 */

const fs = require('fs')

/** 本机走 NODE_PATH 下的 playwright-core；CI 走临时安装的完整 playwright 包（带 install 命令）。 */
function loadChromiumDriver() {
  try {
    return require('playwright-core').chromium
  } catch (err) {
    return require('playwright').chromium
  }
}
const chromium = loadChromiumDriver()

/** 与 verify-browser-* 同款：优先复用本机已缓存的 chromium，避免重复下载。
 *  查找顺序：环境变量 LARK_DOC_CHROMIUM（CI 显式指定）→ macOS 缓存 → Linux 缓存（CI）。 */
function findChromium() {
  if (process.env.LARK_DOC_CHROMIUM && fs.existsSync(process.env.LARK_DOC_CHROMIUM)) {
    return process.env.LARK_DOC_CHROMIUM
  }
  for (const cache of [
    `${process.env.HOME}/Library/Caches/ms-playwright`, // macOS
    `${process.env.HOME}/.cache/ms-playwright`, // Linux（GitHub Actions）
  ]) {
    if (!fs.existsSync(cache)) continue
    const dirs = fs.readdirSync(cache).filter((dir) => /^chromium-\d+$/.test(dir)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
    for (const dir of dirs) {
      for (const candidate of [
        `${cache}/${dir}/chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
        `${cache}/${dir}/chrome-mac/Chromium.app/Contents/MacOS/Chromium`,
        `${cache}/${dir}/chrome-linux/chrome`,
      ]) if (fs.existsSync(candidate)) return candidate
    }
  }
  return null
}

const name = process.argv[2] || 'unknown'
const url = process.argv[3]
if (!url) {
  console.error('用法: node scripts/verify-smoke.js <端名> <url>')
  process.exit(2)
}

const results = []
const record = (label, pass, detail = '') => {
  results.push({ label, pass, detail })
  console.log(`${pass ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`)
}

// 标题下正文用 data-indent 缩进：折叠范围 = 缩进子树，不缩进的段落是兄弟块（与基线脚本同口径）。
const SAMPLE_HTML = '<h1>冒烟标题</h1><p data-indent="1">冒烟正文段落。</p>'

async function main() {
  const executablePath = findChromium()
  if (!executablePath) throw new Error('未找到本机 chromium 缓存，无法运行冒烟验证')
  const browser = await chromium.launch({ headless: true, executablePath })
  const page = await (await browser.newContext()).newPage()
  page.on('pageerror', (err) => console.log(`[pageerror] ${err.message}`))

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })

  // 1. 挂载：编辑器实例可用
  await page.waitForFunction(
    () => window.__larkDoc && typeof window.__larkDoc.getEditor === 'function' && window.__larkDoc.getEditor(),
    { timeout: 60000 },
  )
  record('[挂载] 编辑器实例可用', true)

  const setup = await page.evaluate((html) => {
    const doc = window.__larkDoc
    const editor = doc.getEditor()
    editor.commands.setContent(html)
    return {
      hasGetJSON: typeof doc.getJSON === 'function',
      docNodes: editor.state.doc.childCount,
    }
  }, SAMPLE_HTML)
  record('[挂载] 初始文档就位', setup.docNodes >= 2, `顶层节点=${setup.docNodes}`)
  record('[挂载] getJSON 方法可用', setup.hasGetJSON)

  // 2. 输入：光标落正文段末，真键盘输入
  await page.evaluate(() => {
    const editor = window.__larkDoc.getEditor()
    const pos = []
    editor.state.doc.descendants((node, p) => { if (node.type.name === 'paragraph' && !pos.length) pos.push(p) })
    const end = pos[0] + 1 + editor.state.doc.nodeAt(pos[0]).nodeSize - 1
    editor.commands.setTextSelection(end)
    editor.commands.focus()
  })
  await page.keyboard.type('冒烟输入')
  const inputOk = await page.evaluate(() => window.__larkDoc.getEditor().state.doc.textContent.includes('冒烟输入'))
  record('[输入] 键盘输入生效', inputOk)

  // 3. 折叠：点标题折叠箭头（常显 widget，条件 = 有缩进子树），后代块隐藏
  const fold = await page.evaluate(async () => {
    const editor = window.__larkDoc.getEditor()
    const pos = []
    editor.state.doc.descendants((node, p) => { if (node.type.name === 'heading' && !pos.length) pos.push(p) })
    const dom = editor.view.nodeDOM(pos[0])
    const toggle = dom && dom.querySelector('.lark-doc-heading-fold-toggle')
    if (!toggle) return { hasToggle: false }
    toggle.click()
    await new Promise((resolve) => setTimeout(resolve, 400))
    return {
      hasToggle: true,
      hidden: document.querySelectorAll('.lark-doc-fold-hidden').length,
      collapsed: document.querySelectorAll('.lark-doc-heading-fold-toggle[aria-expanded="false"]').length,
    }
  })
  record('[折叠] 标题可折叠且后代隐藏', fold.hasToggle && fold.hidden >= 1 && fold.collapsed >= 1,
    fold.hasToggle ? `隐藏块=${fold.hidden}` : '未找到折叠箭头')

  // 4. 表格：命令级插入
  const table = await page.evaluate(async () => {
    const editor = window.__larkDoc.getEditor()
    editor.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run()
    await new Promise((resolve) => setTimeout(resolve, 300))
    let tableNode = false
    editor.state.doc.descendants((node) => { if (node.type.name === 'table') tableNode = true })
    return { tableNode, domTables: document.querySelectorAll('.lark-doc table').length }
  })
  record('[表格] 可插入表格', table.tableNode && table.domTables >= 1, `DOM 表格=${table.domTables}`)

  // 5. getJSON：数据出口含输入文本与表格节点
  const json = await page.evaluate(() => window.__larkDoc.getJSON())
  const jsonText = JSON.stringify(json)
  record('[getJSON] 数据出口可用', Boolean(json) && typeof json === 'object')
  record('[getJSON] 含键盘输入文本', jsonText.includes('冒烟输入'))
  record('[getJSON] 含表格节点', jsonText.includes('"table"'))

  await browser.close()

  const failed = results.filter((item) => !item.pass)
  console.log(`\n=== ${name} 冒烟：${results.length - failed.length}/${results.length} 通过 ===`)
  process.exit(failed.length ? 1 : 0)
}

main().catch((error) => {
  console.error(`✗ ${name} 冒烟异常:`, error.message)
  process.exit(1)
})
