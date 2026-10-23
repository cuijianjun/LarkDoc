'use strict'

/**
 * 真实浏览器验证：mermaid 图表渲染（0.6.0）
 *
 * 依赖：playwright-core（NODE_PATH 指向已装 node_modules）+ 本机 chromium 缓存
 * 运行：
 *   NODE_PATH=/Users/cjjxw/.workbuddy/binaries/node/workspace/node_modules \
 *   node scripts/verify-browser-mermaid.js [baseUrl]
 *
 * 断言清单：
 *  1. 页面加载，编辑器挂载，初始内容含 mermaid 代码块
 *  2. 编辑态默认渲染预览（无需手动切换）
 *  3. mermaid 渲染脚本按需注入，且走本地 vendor 地址（非 http/https 外链）
 *  4. 预览层出现真实 SVG（jsdom 做不到的验证点）
 *  5. 预览层 contenteditable=false，源码区 v-show 隐藏
 *  6. 「编辑源码 / 预览图表」双向切换
 *  7. 门面 insert() 追加第二个 mermaid 块后同样自动渲染
 *  8. 编辑器 executeCommand('diagram') 图表按钮命令可用
 */

const path = require('path')
const fs = require('fs')
const { chromium } = require('playwright-core')

const BASE_URL = process.argv[2] || 'http://localhost:8080/lark-doc'
const SHOT_DIR = path.join(__dirname, '..', '.verify-shots')

function findChromium() {
  const cache = path.join(process.env.HOME || '', 'Library', 'Caches', 'ms-playwright')
  if (!fs.existsSync(cache)) return null
  const dirs = fs.readdirSync(cache)
    .filter((name) => /^chromium-\d+$/.test(name))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
  for (const dir of dirs) {
    const candidates = [
      path.join(cache, dir, 'chrome-mac-x64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
      path.join(cache, dir, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
    ]
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate
    }
  }
  return null
}

const results = []
function record(name, ok, detail) {
  results.push({ name, ok, detail: detail || '' })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

async function main() {
  const executablePath = findChromium()
  if (!executablePath) throw new Error('未找到本机 chromium 缓存')
  const browser = await chromium.launch({ headless: true, executablePath })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(String(error)))

  try {
    // ---- 1. 页面加载 + 编辑器挂载 ----
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 60000 })
    await page.waitForSelector('.lark-doc-code', { timeout: 30000 })
    record('页面加载且 mermaid 代码块存在', true)

    const mermaidBlock = page.locator('.lark-doc-code', { has: page.locator('.lark-doc-diagram') })

    // ---- 2. 编辑态默认渲染 ----
    // ---- 3. 脚本按需注入 + 本地 vendor 地址 ----
    const scriptInfo = await page.evaluate(() => {
      const script = document.querySelector('script[data-lark-doc-diagram="mermaid"]')
      if (!script) return null
      const src = script.getAttribute('src') || ''
      return { src, external: /^https?:/.test(src) }
    })
    record('mermaid 渲染脚本按需注入', !!scriptInfo, scriptInfo ? `src=${scriptInfo.src}` : '未找到 script 标签')
    record('脚本走本地 vendor 地址（非外链）', !!scriptInfo && !scriptInfo.external, scriptInfo ? String(scriptInfo.src) : '')

    // ---- 4. 预览层出现真实 SVG ----
    const firstBlock = mermaidBlock.first()
    try {
      await firstBlock.locator('.lark-doc-diagram-svg svg').first()
        .waitFor({ state: 'visible', timeout: 20000 })
    } catch (error) {
      // 诊断：预览层卡在 loading / error 时截图并读取状态文案
      const status = await firstBlock.locator('.lark-doc-diagram-status').allTextContents().catch(() => [])
      const html = await firstBlock.locator('.lark-doc-diagram').innerHTML().catch(() => '(无预览层)')
      const dump = await page.evaluate(() => {
        const blocks = [...document.querySelectorAll('.lark-doc-code')]
        return {
          totalBlocks: blocks.length,
          blocks: blocks.map((b, i) => ({
            index: i,
            classes: b.className,
            hasDiagram: !!b.querySelector('.lark-doc-diagram'),
            hasSvg: !!b.querySelector('svg'),
            bodyDisplay: b.querySelector('.lark-doc-code-body')?.style.display ?? null,
            textStart: b.textContent.slice(0, 60),
          })),
        }
      })
      await page.screenshot({ path: path.join(SHOT_DIR, 'failure-mermaid.png'), fullPage: true })
      throw new Error(`SVG 未出现。状态文案=${JSON.stringify(status)} 预览层HTML=${html.slice(0, 200)} 全局=${JSON.stringify(dump)}`)
    }
    const svgCount = await firstBlock.locator('.lark-doc-diagram-svg svg').count()
    record('预览层渲染出真实 SVG', svgCount > 0, `第一个图表块内 svg 数量=${svgCount}`)

    // ---- 5. 预览层不可编辑 + 源码区隐藏 ----
    const editable = await firstBlock.locator('[contenteditable="false"]').count()
    record('预览层 contenteditable=false', editable > 0, `计数=${editable}`)
    const srcHidden = await firstBlock.evaluate((node) => {
      const body = node.querySelector('.lark-doc-code-body')
      return !body || (body.style.display === 'none')
    })
    record('源码区默认隐藏（v-show display:none）', srcHidden)

    await page.screenshot({ path: path.join(SHOT_DIR, '01-initial-mermaid.png'), fullPage: true })

    // ---- 6. 编辑源码 / 预览图表 双向切换 ----
    // 切到源码态后预览层（v-if）会移除，has 过滤器会失配，改用索引定位。
    const mermaidIndex = await page.evaluate(() => {
      const blocks = [...document.querySelectorAll('.lark-doc-code')]
      return blocks.findIndex((b) => b.querySelector('.lark-doc-diagram'))
    })
    const toggleBlock = page.locator('.lark-doc-code').nth(mermaidIndex)
    const sourceBtn = toggleBlock.getByText('编辑源码', { exact: false }).first()
    await sourceBtn.click()
    await page.waitForTimeout(300)
    const afterShow = await toggleBlock.evaluate((node) => {
      const body = node.querySelector('.lark-doc-code-body')
      return { srcVisible: !!body && body.style.display !== 'none' }
    })
    record('点击「编辑源码」后源码区可见', afterShow.srcVisible)

    const previewBtn = toggleBlock.getByText('预览图表', { exact: false }).first()
    await previewBtn.click()
    await page.waitForTimeout(500)
    await toggleBlock.locator('.lark-doc-diagram-svg svg').first()
      .waitFor({ state: 'visible', timeout: 20000 })
    record('点击「预览图表」后 SVG 恢复显示', true)

    // ---- 7. 门面 insert() 追加第二个 mermaid 块 ----
    const beforeCount = await page.locator('.lark-doc-code').count()
    await page.evaluate(() => {
      window.__larkDoc.insert({
        type: 'codeBlock',
        attrs: { language: 'mermaid' },
        content: [{ type: 'text', text: 'graph LR\n  X[插入命令] --> Y[第二个图表]\n  Y --> Z[自动渲染]' }],
      })
    })
    await page.waitForTimeout(1000)
    const afterCount = await page.locator('.lark-doc-code').count()
    record('insert() 追加图表块', afterCount === beforeCount + 1, `${beforeCount} → ${afterCount}`)
    const secondBlock = page.locator('.lark-doc-code').nth(afterCount - 1)
    await secondBlock.locator('svg').first().waitFor({ state: 'visible', timeout: 20000 })
    record('第二个图表块自动渲染 SVG（渲染器全局复用）', true)

    // ---- 8. 图表按钮命令（executeCommand('diagram')，与插入菜单「图表」同路径） ----
    const thirdOk = await page.evaluate(() => {
      const workspace = window.__larkDoc.getWorkspace()
      const editorComponent = workspace && workspace.$refs && workspace.$refs.document
      if (!editorComponent || typeof editorComponent.executeCommand !== 'function') return false
      editorComponent.executeCommand('diagram')
      return true
    })
    await page.waitForTimeout(1200)
    const finalCount = await page.locator('.lark-doc-code').count()
    record('executeCommand("diagram") 图表按钮插入', thirdOk && finalCount > afterCount, `块数 ${afterCount} → ${finalCount}`)

    // ---- 9. 工具栏「图表」按钮：类型下拉插入 ----
    const menuBtn = page.locator('button[aria-label="图表"]').first()
    record('工具栏出现「图表」按钮', await menuBtn.count() > 0)
    await menuBtn.click()
    await page.waitForTimeout(300)
    const menuItems = await page.locator('.lark-doc-diagram-menu button').allTextContents()
    record('图表类型下拉含流程图/时序图/甘特图/饼图',
      ['流程图', '时序图', '甘特图', '饼图'].every((label) => menuItems.some((text) => text.includes(label))),
      menuItems.join('、'))
    await page.locator('.lark-doc-diagram-menu button', { hasText: '时序图' }).first().click()
    await page.waitForTimeout(1200)
    const seqCount = await page.locator('.lark-doc-code').count()
    record('选择「时序图」插入新图表块', seqCount === finalCount + 1, `块数 ${finalCount} → ${seqCount}`)
    const lastBlock = page.locator('.lark-doc-code').nth(seqCount - 1)
    record('图表块独立外观（不与代码框共用样式）', (await lastBlock.getAttribute('class')).includes('lark-doc-code-diagram'))
    record('图表块无代码语言下拉', await lastBlock.locator('.lark-doc-code-toolbar select').count() === 0)
    await lastBlock.locator('.lark-doc-diagram-svg svg').first().waitFor({ state: 'visible', timeout: 20000 })
    record('时序图块自动渲染 SVG', true)

    await page.screenshot({ path: path.join(SHOT_DIR, '02-after-inserts.png'), fullPage: true })

    // ---- 页面 JS 错误收集 ----
    const realErrors = pageErrors.filter((message) => !/ResizeObserver loop/.test(message))
    record('页面无 JS 错误', realErrors.length === 0, realErrors.slice(0, 3).join(' | '))
  } finally {
    await browser.close()
  }

  const failed = results.filter((item) => !item.ok)
  console.log(`\n合计 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`)
  if (failed.length) {
    process.exitCode = 1
    failed.forEach((item) => console.error(`FAIL: ${item.name} ${item.detail}`))
  }
}

fs.mkdirSync(SHOT_DIR, { recursive: true })
main().catch((error) => {
  console.error('验证脚本异常:', error)
  process.exit(1)
})
