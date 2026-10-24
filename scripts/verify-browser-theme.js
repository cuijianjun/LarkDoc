'use strict'

/**
 * 真实浏览器验证：主题（深色档）外观断言集（0.12 T3 / T4）
 *
 * 依赖：playwright-core（NODE_PATH 指向已装 node_modules）+ 本机 chromium 缓存
 * 运行：
 *   NODE_PATH=/Users/cjjxw/.workbuddy/binaries/node/workspace/node_modules \
 *   node scripts/verify-browser-theme.js [baseUrl]
 *
 * 断言清单：
 *  T3-04 表格：深色下只换线（#434343）、单元格恒透明、表头底 α0.08
 *  T3-05 图片：--ld-media-dim 默认 1（不改像素），宿主设 0.85 即生效
 *  T3-07 打印：深色档下 emulateMedia('print') 一律出浅稿（白底深字浅表格线）
 *  G1     DOM 契约四属性（data-theme / data-content-theme / data-theme-source
 *         / .lark-doc-dark / color-scheme），含 system 与 host 两态解析
 *  G2     双轨组合 4 种：chrome（工具栏）与 content（纸张）可独立换档
 *  G6     首屏无闪烁 / 多标签同步 / 系统切换响应 / reduced-motion 无动画
 *  G3/G4 由 check-theme-tokens / check-theme-contrast 在 Node 侧承担（不进浏览器）
 *  G5/G7 见 verify-browser-mermaid.js 与 T5 宿主接入（pcvue）
 *
 * 前置：demo（vue2-webpack-node14）必须以 themeStorage:'local' 启动，
 *       否则 storage 事件不落盘、多标签同步与首屏复原都无从测起。
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

const READ_PAGE = `(() => {
  const cs = (sel, prop) => {
    const el = document.querySelector(sel)
    return el ? getComputedStyle(el)[prop] : null
  }
  const root = document.querySelector('.lark-doc')
  return {
    tdBorder: cs('.ProseMirror td', 'borderTopColor'),
    thBg: cs('.ProseMirror th', 'backgroundColor'),
    tdBg: cs('.ProseMirror td', 'backgroundColor'),
    imgFilter: cs('.lark-doc-image-frame img', 'filter'),
    paperBg: cs('.lark-doc-paper', 'backgroundColor'),
    textColor: cs('.ProseMirror p', 'color'),
    mediaDim: root ? getComputedStyle(root).getPropertyValue('--ld-media-dim').trim() : null,
  }
})()`

/** 主题 DOM 契约（11 §3.3）：四属性 + 兼容类 + color-scheme。 */
const READ_CONTRACT = `(() => {
  const root = document.querySelector('.lark-doc')
  if (!root) return null
  return {
    theme: root.getAttribute('data-theme'),
    contentTheme: root.getAttribute('data-content-theme'),
    source: root.getAttribute('data-theme-source'),
    darkClass: root.classList.contains('lark-doc-dark'),
    colorScheme: getComputedStyle(root).colorScheme || '',
  }
})()`

/** 双轨实测：chrome 取工具栏底（--ld-bg-surface-chrome），content 取纸张底（--ld-bg-content）。 */
const READ_TRACKS = `(() => {
  const cs = (sel, prop) => {
    const el = document.querySelector(sel)
    return el ? getComputedStyle(el)[prop] : null
  }
  return { chrome: cs('.lark-doc-toolbar', 'backgroundColor'), paper: cs('.lark-doc-paper', 'backgroundColor') }
})()`

/** 首屏闪烁探针：挂载前装 MutationObserver，记录 data-theme 每一次出现的值。 */
const INIT_FLASH_PROBE = `(() => {
  window.__themeSeq = []
  window.__themeFirst = null
  const push = (value) => {
    if (value == null) return
    window.__themeSeq.push(value)
    if (window.__themeFirst === null) window.__themeFirst = value
  }
  const observer = new MutationObserver((records) => {
    records.forEach((record) => {
      const el = record.target
      if (el && el.classList && el.classList.contains('lark-doc')) push(el.getAttribute('data-theme'))
    })
  })
  // 挂 document 而不是 documentElement：initScript 跑在最早期，后者此刻还是 null。
  observer.observe(document, { attributes: true, attributeFilter: ['data-theme'], subtree: true })
  // rAF 兜底：属性若在插入 DOM 之前就写好，MutationObserver 抓不到，采样能补上首值。
  const tick = () => {
    const root = document.querySelector('.lark-doc')
    if (root && window.__themeFirst === null) push(root.getAttribute('data-theme'))
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
})()`

async function main() {
  const executablePath = findChromium()
  if (!executablePath) throw new Error('未找到本机 chromium 缓存')
  const browser = await chromium.launch({ headless: true, executablePath })
  // 显式 context：多标签同步依赖同源共享的 localStorage（browser.newPage 会各建一个 context）。
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await context.newPage()
  const pageErrors = []
  const watch = (target) => target.on('pageerror', (error) => pageErrors.push(String(error)))
  watch(page)

  try {
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 60000 })
    await page.waitForSelector('.ProseMirror', { timeout: 30000 })

    // 图片节点会被离线策略拦掉外链 / data URI，插入同结构 DOM 只为验证 CSS 级联。
    await page.evaluate(() => {
      document.querySelector('.lark-doc-paper').insertAdjacentHTML('beforeend',
        '<figure class="lark-doc-image" data-align="center"><div class="lark-doc-image-frame">' +
        '<img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" alt="t"></div></figure>')
      const editor = window.__larkDoc.getEditor()
      if (editor.commands.insertTable) editor.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: true })
    })
    await page.waitForTimeout(1200)

    const light = await page.evaluate(READ_PAGE)
    record('浅色表格线 = 绿档 #d4e0d9', light.tdBorder === 'rgb(212, 224, 217)', light.tdBorder)
    record('浅色未设 --ld-media-dim 时图片不压暗', light.imgFilter === 'brightness(1)', light.imgFilter)

    // ---- 深色档 ----
    await page.evaluate(() => { window.__larkDoc.setTheme('dark', 'dark') })
    await page.waitForTimeout(1000)
    const dark = await page.evaluate(READ_PAGE)
    record('T3-04 表格线深色 #434343（只换线）', dark.tdBorder === 'rgb(67, 67, 67)', dark.tdBorder)
    record('T3-04 单元格恒透明（M7）', dark.tdBg === 'rgba(0, 0, 0, 0)', dark.tdBg)
    record('T3-04 表头底 α0.08', dark.thBg === 'rgba(207, 207, 207, 0.08)', dark.thBg)
    record('T3-04 正文纸张 #17181A（页面底，非浮起层）', dark.paperBg === 'rgb(23, 24, 26)', dark.paperBg)
    record('T3-05 深色档默认仍不压暗（开关留给宿主）', dark.imgFilter === 'brightness(1)', dark.imgFilter)

    await page.evaluate(() => { document.querySelector('.lark-doc').style.setProperty('--ld-media-dim', '0.85') })
    await page.waitForTimeout(300)
    const dimmed = await page.evaluate(() => {
      const el = document.querySelector('.lark-doc-image-frame img')
      return el ? getComputedStyle(el).filter : null
    })
    record('T3-05 宿主设 --ld-media-dim: .85 后即生效', dimmed === 'brightness(0.85)', dimmed)
    await page.screenshot({ path: path.join(SHOT_DIR, 'theme-01-dark.png'), fullPage: true })

    // ---- T3-07：打印强制浅稿 ----
    await page.emulateMedia({ media: 'print' })
    await page.waitForTimeout(500)
    const printed = await page.evaluate(READ_PAGE)
    record('T3-07 打印时正文纸张为白', printed.paperBg === 'rgb(255, 255, 255)', printed.paperBg)
    record('T3-07 打印时正文文字恢复深色', printed.textColor === 'rgb(38, 56, 48)', printed.textColor)
    record('T3-07 打印时表格线恢复浅色', printed.tdBorder === 'rgb(212, 224, 217)', printed.tdBorder)
    await page.emulateMedia({ media: 'screen', colorScheme: 'light' })

    /* ---------------- G1：DOM 契约四属性 ---------------- */
    await page.evaluate(() => { window.__larkDoc.setTheme('light', 'auto') })
    await page.waitForTimeout(600)
    const c1 = await page.evaluate(READ_CONTRACT)
    record('G1 显式浅色：四属性 + color-scheme 全对',
      !!c1 && c1.theme === 'light' && c1.contentTheme === 'light' && c1.source === 'explicit'
        && c1.darkClass === false && c1.colorScheme === 'light',
      c1 && JSON.stringify(c1))

    await page.emulateMedia({ colorScheme: 'dark' })
    await page.evaluate(() => { window.__larkDoc.setTheme('system') })
    await page.waitForTimeout(600)
    const c2 = await page.evaluate(READ_CONTRACT)
    record('G1 system 态：解析为 dark 且 source=system',
      !!c2 && c2.theme === 'dark' && c2.source === 'system' && c2.colorScheme === 'dark',
      c2 && JSON.stringify(c2))

    // G6 系统切换响应：同一 system 态下把系统偏好拨回浅色，应自动跟回 light（不改 source）。
    await page.emulateMedia({ colorScheme: 'light' })
    await page.waitForTimeout(600)
    const c2b = await page.evaluate(READ_CONTRACT)
    record('G6 system 响应系统切换：跟回 light 且 source 仍为 system',
      !!c2b && c2b.theme === 'light' && c2b.source === 'system', c2b && JSON.stringify(c2b))

    await page.evaluate(() => { window.__larkDoc.setTheme('host') })
    await page.waitForTimeout(600)
    const c3 = await page.evaluate(READ_CONTRACT)
    record('G1 host 态：source=host，无 data-skin 命中走 fallback light',
      !!c3 && c3.source === 'host' && c3.theme === 'light', c3 && JSON.stringify(c3))

    /* ---------------- G2：双轨 4 种组合 ---------------- */
    const CHROME_DARK = 'rgb(41, 41, 41)'   // #292929 浮起层
    const PAPER_DARK = 'rgb(23, 24, 26)'    // #17181A 页面底
    const WHITE = 'rgb(255, 255, 255)'
    const tracks = async (theme, contentTheme) => {
      await page.evaluate(([t, c]) => { window.__larkDoc.setTheme(t, c) }, [theme, contentTheme])
      await page.waitForTimeout(600)
      return page.evaluate(READ_TRACKS)
    }

    const t11 = await tracks('light', 'auto')
    record('G2 浅 UI + 自动正文：chrome/content 均白',
      t11.chrome === WHITE && t11.paper === WHITE, JSON.stringify(t11))
    const t22 = await tracks('dark', 'auto')
    record('G2 深 UI + 自动正文：chrome #292929 / 纸张 #17181A',
      t22.chrome === CHROME_DARK && t22.paper === PAPER_DARK, JSON.stringify(t22))
    const t21 = await tracks('dark', 'light')
    record('G2 深 UI + 浅正文（飞书同款）：chrome 深 / 纸张白',
      t21.chrome === CHROME_DARK && t21.paper === WHITE, JSON.stringify(t21))
    const t12 = await tracks('light', 'dark')
    record('G2 浅 UI + 深正文：chrome 白 / 纸张 #17181A',
      t12.chrome === WHITE && t12.paper === PAPER_DARK, JSON.stringify(t12))

    /* ---------------- G6-1：首屏无闪烁 ---------------- */
    // 先让 localStorage 落 dark（themeStorage:'local'），再开新标签看首帧落在哪一档。
    await page.evaluate(() => { window.__larkDoc.setTheme('dark', 'dark') })
    await page.waitForTimeout(600)
    const flashPage = await context.newPage()
    watch(flashPage)
    await flashPage.addInitScript(INIT_FLASH_PROBE)
    await flashPage.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 60000 })
    await flashPage.waitForSelector('.ProseMirror', { timeout: 30000 })
    await flashPage.waitForTimeout(600)
    const probe = await flashPage.evaluate(() => ({ seq: window.__themeSeq || [], first: window.__themeFirst }))
    record('G6 首屏无闪烁：挂载后 data-theme 直接是 dark（无 light→dark 翻转）',
      probe.first === 'dark' && probe.seq.length > 0 && probe.seq.every((value) => value === 'dark'),
      JSON.stringify(probe))
    await flashPage.close()

    /* ---------------- G6-2：多标签同步（storage 事件） ---------------- */
    const tabB = await context.newPage()
    watch(tabB)
    await tabB.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 60000 })
    await tabB.waitForSelector('.ProseMirror', { timeout: 30000 })
    await page.evaluate(() => { window.__larkDoc.setTheme('light', 'auto') })
    await page.waitForTimeout(800)
    const bBefore = await tabB.evaluate(READ_CONTRACT)
    await page.evaluate(() => { window.__larkDoc.setTheme('dark', 'auto') })
    await page.waitForTimeout(800)
    const bAfter = await tabB.evaluate(READ_CONTRACT)
    record('G6 多标签同步：A 换档后 B 页跟随（light→dark）',
      !!bBefore && !!bAfter && bBefore.theme === 'light' && bAfter.theme === 'dark',
      `${bBefore && bBefore.theme} → ${bAfter && bAfter.theme}`)
    await tabB.close()

    /* ---------------- G6-4：reduced-motion 无动画 ---------------- */
    const rmContext = await browser.newContext({ viewport: { width: 1200, height: 900 }, reducedMotion: 'reduce' })
    const rmPage = await rmContext.newPage()
    watch(rmPage)
    await rmPage.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 60000 })
    await rmPage.waitForSelector('.ProseMirror', { timeout: 30000 })
    await rmPage.evaluate(() => { window.__larkDoc.setTheme('dark', 'dark') })
    await rmPage.waitForTimeout(200)
    const rmInfo = await rmPage.evaluate(() => {
      const root = document.querySelector('.lark-doc')
      return { duration: getComputedStyle(root).transitionDuration, hasClass: root.classList.contains('ld-theme-transition') }
    })
    record('G6 reduced-motion：换档补色过渡被清零（≤1ms）',
      parseFloat(rmInfo.duration) <= 0.001, `duration=${rmInfo.duration} class=${rmInfo.hasClass}`)
    await rmContext.close()

    record('无页面脚本错误', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '))
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
main().catch((error) => { console.error('验证脚本异常:', error); process.exit(1) })
