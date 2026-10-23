'use strict'
/**
 * 浏览器级验证：「图标 / 控件」与「首行文字」的垂直居中。
 *
 * 覆盖真飞书核对过的口径：
 * - 任务列表复选框与首行文字居中对齐（换行的多行项仍停在第 1 行中心）；
 * - callout 的 emoji 与首行文字居中（行高压到 1.44 才对齐，1.2 会高 3px）；
 * - 有序 / 无序列表的标记与文字在同一行盒中心；
 * - 划词气泡条的每个按钮内，图标与文字互不偏移。
 *
 * 这类问题肉眼是「差一点点」，只能靠几何量测守门：
 * 判定阈值 1px（亚像素渲染误差内），任何硬编码 margin-top 都会直接超限。
 *
 * 依赖：demo dev server（Vue 路由暴露 window.__larkDoc）。用法：
 *   node scripts/verify-browser-icon-align.js [url]
 */
const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright-core')

const BASE = process.argv[2] || 'http://localhost:8080/lark-doc'
const TOLERANCE = 1
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

const CONTENT = `
<p>对齐量测基准段落</p>
<ul data-type="taskList">
  <li data-type="taskItem" data-checked="true"><p>已完成任务项</p></li>
  <li data-type="taskItem" data-checked="false"><p>多行任务项第一行文字很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长</p></li>
</ul>
<div data-type="callout" data-emoji="💡"><p>提示行文字内容</p></div>
<ol><li><p>有序第一项</p></li></ol>
<ul><li><p>无序第一项</p></li></ul>
`.trim()

;(async () => {
  const browser = await chromium.launch({ executablePath: findChromium(), args: ['--no-sandbox'] })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  // 抗字体回退：demo 用系统字体，量测在 layout 稳定后再取
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.waitForSelector('.ProseMirror', { timeout: 20000 })
  await page.evaluate((html) => { window.__larkDoc.getEditor().commands.setContent(html) }, CONTENT)
  await page.waitForTimeout(700)

  const measured = await page.evaluate(() => {
    const rect = (el) => {
      const r = typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : el
      return { top: r.top, bottom: r.bottom, height: r.height, cy: (r.top + r.bottom) / 2 }
    }
    const linesOf = (block) => {
      const range = document.createRange()
      range.selectNodeContents(block)
      return [...range.getClientRects()].filter((r) => r.width > 1)
    }
    function firstLineFor(block) {
      const lines = linesOf(block)
      return lines[0] || block.getBoundingClientRect()
    }
    const out = { tasks: [], callouts: [], numbers: [], bullets: [] }

    document.querySelectorAll('.ProseMirror ul[data-type="taskList"] > li').forEach((li) => {
      const input = li.querySelector(':scope > label > input')
      const p = li.querySelector(':scope > div > p')
      if (!input || !p) return
      const lines = linesOf(p)
      out.tasks.push({
        text: p.textContent.slice(0, 10),
        lineCount: lines.length,
        delta: +(rect(input).cy - rect(firstLineFor(p)).cy).toFixed(2),
        labelMarginTop: getComputedStyle(li.querySelector(':scope > label')).marginTop,
        blockDelta: +(rect(input).cy - rect(li).cy).toFixed(2),
      })
    })

    document.querySelectorAll('.ProseMirror div[data-type="callout"]').forEach((callout) => {
      const p = callout.querySelector('p')
      if (!p) return
      const before = getComputedStyle(callout, '::before')
      const cr = callout.getBoundingClientRect()
      const emojiCy = cr.top + (parseFloat(before.top) || 0) + (parseFloat(before.lineHeight) || 0) / 2
      out.callouts.push({ delta: +(emojiCy - rect(firstLineFor(p)).cy).toFixed(2), lineHeight: before.lineHeight })
    })

    document.querySelectorAll('.ProseMirror button.lark-doc-list-number, .ProseMirror .lark-doc-list-bullet').forEach((marker) => {
      const p = marker.closest('p') || marker.parentElement
      const range = document.createRange()
      // 先把 range 撑到整段，再收窄起点到 marker 之后；否则 start==end，量不到任何 rect。
      range.selectNodeContents(p)
      range.setStartAfter(marker)
      const rects = [...range.getClientRects()].filter((r) => r.width > 1)
      if (!rects.length) return
      const entry = { delta: +(rect(marker).cy - rect(rects[0]).cy).toFixed(2), label: marker.textContent }
      if (marker.classList.contains('lark-doc-list-number')) out.numbers.push(entry)
      else out.bullets.push(entry)
    })

    return out
  })

  record('[对齐] 任务复选框与首行文字居中', measured.tasks.length >= 2 && measured.tasks.every((t) => Math.abs(t.delta) <= TOLERANCE),
    measured.tasks.map((t) => `${t.text}:${t.delta}`).join(' '))
  record('[对齐] 复选框不再被 margin-top 顶下去', measured.tasks.every((t) => parseFloat(t.labelMarginTop) === 0),
    measured.tasks.map((t) => t.labelMarginTop).join(','))
  record('[对齐] 多行任务项仍锚定第 1 行', measured.tasks.some((t) => t.lineCount > 1) && measured.tasks.filter((t) => t.lineCount > 1).every((t) => Math.abs(t.delta) <= TOLERANCE),
    measured.tasks.map((t) => `${t.lineCount}行/${t.delta}`).join(' '))
  record('[对齐] callout emoji 与首行文字居中', measured.callouts.length >= 1 && measured.callouts.every((c) => Math.abs(c.delta) <= TOLERANCE),
    measured.callouts.map((c) => `${c.delta} lh=${c.lineHeight}`).join(' '))
  record('[对齐] 列表标记与文字同一行盒中心',
    [...measured.numbers, ...measured.bullets].length >= 2 && [...measured.numbers, ...measured.bullets].every((m) => Math.abs(m.delta) <= TOLERANCE),
    [...measured.numbers, ...measured.bullets].map((m) => `${m.label}:${m.delta}`).join(' '))

  // 划词气泡条：每个按钮内的图标 / 文字都要与按钮盒中心重合
  const firstP = await page.$('.ProseMirror > p')
  if (firstP) {
    const box = await firstP.boundingBox()
    await page.mouse.move(box.x + 20, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + 120, box.y + box.height / 2, { steps: 8 })
    await page.mouse.up()
    await page.waitForTimeout(500)
  }
  const bubble = await page.evaluate(() => {
    const root = document.querySelector('.lark-doc-bubble')
    if (!root) return null
    const rect = (el) => { const r = el.getBoundingClientRect(); return { cy: (r.top + r.bottom) / 2, h: r.height } }
    return [...root.querySelectorAll('button')].map((btn) => {
      const br = rect(btn)
      const parts = [...btn.querySelectorAll('svg, span')].filter((el) => el.getBoundingClientRect().height > 0)
      return { text: btn.textContent.trim().slice(0, 6) || btn.className.toString().slice(0, 18), h: br.h, deltas: parts.map((el) => +(rect(el).cy - br.cy).toFixed(2)) }
    })
  })
  record('[对齐] 气泡条按钮内图标与文字居中',
    !!bubble && bubble.length >= 4 && bubble.every((b) => b.deltas.every((d) => Math.abs(d) <= TOLERANCE)),
    bubble ? bubble.map((b) => `${b.text}:${b.deltas.join('/')}`).join(' ') : '气泡条未出现')

  record('[运行] 无 JS 报错', errors.length === 0, errors.slice(0, 2).join(' | '))

  await browser.close()
  const failed = results.filter((item) => !item.ok).length
  console.log(`\n${results.length - failed}/${results.length} 项通过`)
  if (failed) process.exitCode = 1
})().catch((error) => { console.error(error); process.exitCode = 1 })
