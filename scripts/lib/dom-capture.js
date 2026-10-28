'use strict'

/**
 * DOM 快照抓取的共享实现。两个消费方：
 *   - scripts/capture-baseline.js dom —— 写基线（仅 Task 1 / 基线更新时用）
 *   - scripts/snapshot-dom.js        —— 只读快照，stdout 输出（Task 3 RF5 守卫比对用）
 *
 * 归一化必须两处一致，故收敛在这一个文件里。
 */

const path = require('path')

/**
 * DOM 快照必须剔除动态值，否则每次渲染都不同、比对必然失败。
 * 实测两次挂载的差异共三类：
 *   ① 每次重新分配的块 id（data-block-id）——留属性、清掉值，结构仍要比；
 *   ② mermaid 每次渲染的实例 id（及其派生 id）——整体替换成同一个占位符；
 *   ③ mermaid 按内容实测出来的几何（viewBox 宽高、svg 的自适应 max-width）——
 *     这些数字依赖字体度量，跨机/跨版本会漂，只保留"它们存在"这一事实。
 *     归一化只针对 mermaid 特征：viewBox 负偏移起点（图标都是 0 0 起）、
 *     非整数 px 的 max-width（设计值都是整数）。
 */
function normalizeDom(html) {
  return html
    .replace(/\sdata-block-id="[^"]*"/g, ' data-block-id=""')
    .replace(/lark-doc-diagram-[A-Za-z0-9]+-[A-Za-z0-9]+/g, 'lark-doc-diagram-ID')
    .replace(/viewBox="-8 -8 [0-9.]+ [0-9.]+"/g, 'viewBox="-8 -8 MERMAID_W MERMAID_H"')
    .replace(/max-width:\s*\d+\.\d+px/g, 'max-width:MERMAID_Wpx')
}

function findChromium() {
  const cache = path.join(process.env.HOME || '', 'Library', 'Caches', 'ms-playwright')
  const fs = require('fs')
  if (!fs.existsSync(cache)) return null
  const dirs = fs.readdirSync(cache)
    .filter((name) => /^chromium-\d+$/.test(name))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
  for (const dir of dirs) {
    for (const candidate of [
      path.join(cache, dir, 'chrome-mac-x64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
      path.join(cache, dir, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
    ]) if (fs.existsSync(candidate)) return candidate
  }
  return null
}

/**
 * 打开真实浏览器渲染 pageUrl，返回归一化后的 `.lark-doc-host` innerHTML。
 * 只读：不写任何文件，落盘交给调用方决定。
 */
async function captureNormalizedDom(pageUrl) {
  const { chromium } = require('playwright-core')
  const executablePath = findChromium()
  if (!executablePath) throw new Error('未找到本机 chromium 缓存')
  const browser = await chromium.launch({ headless: true, executablePath })
  const page = await browser.newPage({ viewport: { width: 1700, height: 1000 } })
  try {
    await page.goto(pageUrl, { waitUntil: 'networkidle', timeout: 60000 })
    await page.waitForSelector('.ProseMirror', { timeout: 30000 })
    await page.waitForSelector('.lark-doc-toolbar', { timeout: 30000 })
    // 图表/ KaTeX 是异步渲染的，等一拍再抓，否则快照里会出现半成品 SVG。
    await page.waitForTimeout(1500)
    return normalizeDom(await page.evaluate(() => document.querySelector('.lark-doc-host').innerHTML))
  } finally {
    await browser.close()
  }
}

module.exports = { normalizeDom, findChromium, captureNormalizedDom }
