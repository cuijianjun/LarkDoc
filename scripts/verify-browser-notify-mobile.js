'use strict'

// 专项验收：仅 Chromium 视口/触控模拟，不代表真机、Safari 或真实跨账号通知。
const assert = require('assert').strict
const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright-core')
const ROOT = path.resolve(__dirname, '..')
const BASE = process.argv[2] || 'http://127.0.0.1:54189/lark-doc'
const OUT = path.join(ROOT, '_codex/verify-logs/notify-mobile')
const results = []
function executable() {
  const cache = path.join(process.env.HOME, 'Library/Caches/ms-playwright')
  const candidates = fs.readdirSync(cache).filter(n => /^chromium-\d+$/.test(n))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
    .flatMap(n => ['chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium'].map(s => path.join(cache, n, s)))
  const file = candidates.find(f => fs.existsSync(f))
  assert.ok(file, '需要已有 Chromium，不自动安装')
  return file
}
function record(name, ok, detail) {
  results.push({ name, ok: !!ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(detail)}`)
}
async function bounds(page, selector) {
  return page.locator(selector).evaluate(el => {
    const r = el.getBoundingClientRect()
    return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom, viewport: { width: innerWidth, height: innerHeight }, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }
  })
}
const fits = r => r.width > 0 && r.height > 0 && r.x >= 0 && r.y >= 0 && r.right <= r.viewport.width + 1 && r.bottom <= r.viewport.height + 1
async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch({ executablePath: executable(), headless: true })
  let status
  try {
    for (const viewport of [{ width: 320, height: 667 }, { width: 375, height: 667 }, { width: 420, height: 896 }, { width: 667, height: 375 }, { width: 1440, height: 900 }]) {
      const name = `${viewport.width}x${viewport.height}`
      const context = await browser.newContext({ viewport, isMobile: viewport.width < 1000, hasTouch: viewport.width < 1000, deviceScaleFactor: viewport.width < 1000 ? 2 : 1 })
      try {
        const page = await context.newPage()
        const errors = []
        page.on('pageerror', error => errors.push(error.message))
        await page.goto(BASE, { waitUntil: 'networkidle' })
        await page.waitForFunction(() => window.__larkDoc?.getEditor?.())
        status = await (await context.request.get(new URL('/__verify__/status.json', BASE).href)).json()
        assert.equal(status.root, ROOT)
        assert.equal(status.sourceArtifactsCurrent, true, '专项验收必须使用与当前源码匹配的产物')
        await page.evaluate(() => {
          const Klass = window.__larkDoc.constructor
          const host = window.__larkDoc.element
          window.__larkDoc.destroy()
          window.__notifyProbe = new Klass({ element: host, title: '通知与工具栏验收', content: '<p>通知面板边界验收正文</p>', storage: 'none', themeStorage: 'none', layout: { headerVisible: true } })
        })
        await page.waitForFunction(() => !!window.__notifyProbe?._handle?.nativeHost?.host?.editor)
        const defaults = await page.evaluate(() => ({ native: !!window.__notifyProbe._handle.nativeHost, toolbarVisible: window.__notifyProbe.getConfig().layout.toolbarVisible, toolbarCount: document.querySelectorAll('.lark-doc-toolbar').length, viewport: innerWidth, overflow: document.documentElement.scrollWidth - innerWidth }))
        record(`${name} 原生默认工具栏隐藏且页面无横向溢出`, defaults.native && defaults.toolbarVisible === false && defaults.toolbarCount === 0 && defaults.viewport === viewport.width && defaults.overflow <= 1, defaults)
        await page.getByRole('button', { name: '当前文档通知', exact: true }).click()
        await page.getByRole('dialog', { name: '当前文档通知', exact: true }).waitFor()
        await page.evaluate(() => window.__notifyProbe._handle.nativeHost.host.$nextTick())
        const panel = await bounds(page, '.lark-doc-notify-popover')
        const content = await bounds(page, '.lark-doc-notify-content')
        record(`${name} 通知外壳和真实内容四边均在视口内`, fits(panel) && fits(content), { panel, content })
        const controls = await page.locator('.lark-doc-notify-header button').evaluateAll(nodes => nodes.map(el => {
          const r = el.getBoundingClientRect()
          const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
          return { text: el.textContent, x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height, hit: !!hit && el.contains(hit) }
        }))
        record(`${name} 通知头部控件真实可命中且未被视口裁剪`, controls.length === 2 && controls.every(r => r.hit && r.x >= 0 && r.y >= 0 && r.right <= viewport.width + 1 && r.bottom <= viewport.height + 1), controls)
        if (viewport.width === 1440) record(`${name} 桌面通知外壳保持 402x555`, Math.abs(panel.width - 402) <= 1 && Math.abs(panel.height - 555) <= 1, panel)
        await page.screenshot({ path: path.join(OUT, `${name}-notification.png`) })
        await page.keyboard.press('Escape')
        await page.waitForFunction(() => !document.querySelector('.lark-doc-notify-popover'))
        record(`${name} 通知 Esc 实际关闭并复位 aria-expanded`, await page.getByRole('button', { name: '当前文档通知', exact: true }).getAttribute('aria-expanded') === 'false', {})
        await page.getByRole('button', { name: '当前文档通知', exact: true }).click()
        await page.getByRole('dialog', { name: '当前文档通知', exact: true }).waitFor()
        const outside = { x: 2, y: viewport.height - 2 }
        assert.equal(await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('.lark-doc-notify-popover, .lark-doc-notify-btn'), outside), false)
        await page.mouse.click(outside.x, outside.y)
        await page.waitForFunction(() => !document.querySelector('.lark-doc-notify-popover'))
        record(`${name} 通知外部点击关闭`, await page.locator('.lark-doc-notify-popover').count() === 0, outside)
        if (viewport.width === 375) {
          // 当前产品没有工具栏开关按钮；经已核实的原生配置入口显式展开。
          await page.evaluate(async () => {
            const host = window.__notifyProbe._handle.nativeHost.host
            host.editorConfig.layout.toolbarVisible = true
            await host.$nextTick()
            await host.evaluateToolbarFit()
          })
          await page.getByRole('toolbar', { name: '文档工具栏', exact: true }).waitFor()
          const bar = await bounds(page, '.lark-doc-toolbar')
          record(`${name} 显式展开工具栏四边合规且自身无横向溢出`, fits(bar) && bar.scrollWidth <= bar.clientWidth + 1, bar)
          await page.locator('.lark-doc-toolbar button[aria-label="更多"]').click()
          await page.getByRole('menu', { name: '更多工具', exact: true }).waitFor()
          const more = await bounds(page, '.lark-doc-more-menu')
          const items = await page.locator('.lark-doc-more-menu button[role="menuitem"]').allTextContents()
          record(`${name} 展开更多工具四边合规且功能未丢失`, fits(more) && ['加粗', '插入表格', '查找'].every(label => items.includes(label)), { more, items: items.length })
          await page.screenshot({ path: path.join(OUT, `${name}-toolbar-expanded.png`) })
          const search = page.getByRole('menu', { name: '更多工具', exact: true }).getByRole('menuitem', { name: '查找', exact: true })
          await search.scrollIntoViewIfNeeded()
          const target = await search.boundingBox()
          const reachable = target && await search.evaluate(el => {
            const r = el.getBoundingClientRect()
            const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
            return !!hit && el.contains(hit)
          })
          record(`${name} 更多工具底部查找可实际滚动触达并命中`, !!reachable, target)
          await page.screenshot({ path: path.join(OUT, `${name}-toolbar-scrolled.png`) })
          await page.keyboard.press('Escape')
          record(`${name} 更多工具 Esc 关闭`, await page.locator('.lark-doc-more-menu').count() === 0, {})
          await page.evaluate(async () => { const host = window.__notifyProbe._handle.nativeHost.host; host.editorConfig.layout.toolbarVisible = false; await host.$nextTick() })
          record(`${name} 工具栏重新隐藏后通知入口仍可用`, await page.locator('.lark-doc-toolbar').count() === 0 && await page.getByRole('button', { name: '当前文档通知', exact: true }).isVisible(), {})
        }
        record(`${name} 无页面脚本错误`, errors.length === 0, errors)
        await page.evaluate(() => window.__notifyProbe.destroy())
      } catch (error) {
        record(`${name} 执行完成`, false, String(error))
      } finally { await context.close() }
    }
  } finally {
    fs.writeFileSync(path.join(OUT, 'evidence.json'), JSON.stringify({ engine: 'Chromium', browser: browser.version(), scope: '仅视口/触控模拟；空态通知；不代表真机、Safari、真实跨账号通知；未采集性能', hostStatus: status, passed: results.filter(r => r.ok).length, total: results.length, results }, null, 2))
    await browser.close()
  }
  const failed = results.filter(r => !r.ok)
  console.log(`专项交互 ${results.length - failed.length}/${results.length}；sourceArtifactsCurrent=${status?.sourceArtifactsCurrent}`)
  if (failed.length) process.exitCode = 1
}
main().catch(error => { console.error(error); process.exitCode = 1 })
