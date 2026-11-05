'use strict'

/**
 * 真实浏览器验证：Web Component（跨框架 <lark-doc> 元素）。
 *
 * 依赖：playwright-core（NODE_PATH 指向已装 node_modules）+ 本机 chromium 缓存
 * 前置：npm run build:element（产物 dist/lark-doc-element.umd.min.js）
 * 静态服务：python3 -m http.server 8765（从包根目录起，演示页需要 ../dist 相对路径）
 * 运行：
 *   NODE_PATH=/Users/cjjxw/.workbuddy/binaries/node/workspace/node_modules \
 *   node scripts/verify-browser-element.js [baseUrl]
 */
const path = require('path')
const fs = require('fs')
const { chromium } = require('playwright-core')
const BASE_URL = process.argv[2] || 'http://localhost:8765/examples/element-demo.html'
function findChromium() {
  const cache = path.join(process.env.HOME || '', 'Library', 'Caches', 'ms-playwright')
  const dirs = fs.readdirSync(cache).filter((n) => /^chromium-\d+$/.test(n)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
  for (const dir of dirs) {
    for (const c of [path.join(cache, dir, 'chrome-mac-x64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'), path.join(cache, dir, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium')]) {
      if (fs.existsSync(c)) return c
    }
  }
}
const results = []
function record(name, ok, detail) { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`) }
async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: findChromium() })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => {
    // 浏览器自动请求 /favicon.ico 的 404 与编辑器无关，不计入错误。
    const url = (m.location && m.location().url) || ''
    if (m.type() === 'error' && !/favicon\.ico$/.test(url)) errors.push('console: ' + m.text() + ' @ ' + url)
  })
  const SHOTS = path.join(__dirname, '..', '.verify-shots')
  fs.mkdirSync(SHOTS, { recursive: true })
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 60000 })
  await page.waitForTimeout(2500)

  // 1. 自定义元素注册 + 挂载
  const mounted = await page.evaluate(() => {
    const el = document.getElementById('editor-a')
    return { hasTag: !!window.customElements.get('lark-doc'), mounted: el.getAttribute('data-mounted'), childCount: el.children.length }
  })
  record('自定义元素已注册并挂载', mounted.hasTag && mounted.mounted === 'true' && mounted.childCount > 0, JSON.stringify(mounted))

  // 2. 编辑器渲染出 ProseMirror（无需宿主 Vue）
  const pmCount = await page.locator('#editor-a .ProseMirror').count()
  record('编辑器 DOM 渲染成功（宿主无框架）', pmCount > 0, `ProseMirror 计数=${pmCount}`)

  // 3. 样式自包含：产物注入了 style 标签且编辑器宽度正常
  const styled = await page.evaluate(() => {
    const el = document.getElementById('editor-a')
    return { styleTags: document.head.querySelectorAll('style').length, height: Math.round(el.getBoundingClientRect().height) }
  })
  record('样式由 JS 注入（自包含）', styled.styleTags > 0 && styled.height > 200, JSON.stringify(styled))

  // 4. 初始内容来自标签内 HTML（slot 兜底）
  const textA = await page.locator('#editor-a .ProseMirror').first().innerText()
  record('标签内 HTML 作为初始内容', textA.includes('飞书风格文档'), textA.slice(0, 30).replace(/\n/g, ' '))

  // 4.5 title 属性读完即摘：宿主是 Light DOM 且铺满编辑器，
  //     留着 title 会让浏览器在正文上画一个灰色「文档标题」原生 tips。
  const titleAttr = await page.evaluate(() => {
    const el = document.getElementById('editor-a')
    return { attr: el.getAttribute('title'), api: el.getTitle() }
  })
  record('宿主标签上的 title 属性读完即摘（去掉原生灰 tips）', titleAttr.attr === null, `title=${titleAttr.attr}`)
  record('标题值仍然进到文档（getTitle 可读）', titleAttr.api === '属性驱动的文档', `getTitle=${titleAttr.api}`)

  // 5. API 代理 + 实际输入
  await page.locator('#editor-a .ProseMirror').first().click()
  await page.keyboard.type('Hello Web Component')
  await page.waitForTimeout(600)
  const jsonInfo = await page.evaluate(() => {
    const json = document.getElementById('editor-a').getJSON()
    return { type: json && json.type, nodes: (json && json.content || []).length }
  })
  record('getJSON() 代理可用且含新增内容', jsonInfo.type === 'doc' && jsonInfo.nodes > 0, JSON.stringify(jsonInfo))

  // 6. 事件：change 冒泡到 document（跨框架监听）
  const logged = await page.evaluate(() => document.getElementById('log').textContent.includes('change'))
  record('lark-doc-change 事件冒泡到宿主', logged)

  // 7. 属性热更新：readonly
  await page.evaluate(() => document.querySelector('[data-action="toggle-readonly"]').click())
  await page.waitForTimeout(400)
  const readonlyState = await page.evaluate(() => {
    const el = document.getElementById('editor-a')
    return { attr: el.hasAttribute('readonly'), api: el.isReadonly(), editable: !!el.querySelector('.ProseMirror[contenteditable="true"]') }
  })
  record('readonly 属性热更新生效', readonlyState.attr && readonlyState.api === true, JSON.stringify(readonlyState))

  // 8. setContent 覆写
  await page.evaluate(() => document.querySelector('[data-action="set-content"]').click())
  await page.waitForTimeout(600)
  const overwritten = await page.evaluate(() => document.getElementById('editor-a').getText().includes('覆写成功'))
  record('setContent() 生效', overwritten)

  // 9. 第二个实例（JS 注入能力）也正常
  const secondOk = await page.evaluate(() => {
    const el = document.getElementById('editor-b')
    return { mounted: el.getAttribute('data-mounted'), text: el.getText().slice(0, 20) }
  })
  record('第二个实例（JS 注入能力 + ready 后 setContent）', secondOk.mounted === 'true' && secondOk.text.includes('JS 注入能力'), JSON.stringify(secondOk))

  // 10. 默认持久化开启：先确定保存完成，再检查重连恢复的完整正文，不能误判为 slot 失效。
  const rebuilt = await page.evaluate(async () => {
    const el = document.getElementById('editor-a')
    const instance = el.getInstance()
    const before = el.getText()
    await el.save()
    const parent = el.parentNode
    parent.removeChild(el)
    await new Promise(resolve => setTimeout(resolve, 60))
    const unmounted = el.getInstance() === null
    const ready = new Promise(resolve => el.addEventListener('lark-doc-ready', resolve, { once: true }))
    parent.insertBefore(el, parent.firstChild)
    await ready
    return {
      mounted: el.getAttribute('data-mounted'), pmCount: el.querySelectorAll('.ProseMirror').length,
      unmounted, newInstance: el.getInstance() !== instance, before, text: el.getText(),
    }
  })
  record('移除后重新插入可重建且已保存正文保留', rebuilt.mounted === 'true' && rebuilt.pmCount === 1 && rebuilt.unmounted && rebuilt.newInstance && rebuilt.text === rebuilt.before && rebuilt.text.includes('覆写成功'), JSON.stringify(rebuilt))

  // 11. 隔离验证 slot 缓存：关闭持久化，避免草稿恢复遮蔽声明正文的初始化契约。
  const slot = await page.evaluate(async () => {
    const el = document.createElement('lark-doc')
    el.options = { storage: 'none' }
    el.innerHTML = '<p>独立验证的 slot 初始正文</p>'
    const appendReady = async () => {
      const ready = new Promise(resolve => el.addEventListener('lark-doc-ready', resolve, { once: true }))
      document.body.appendChild(el)
      await ready
    }
    await appendReady()
    const initial = el.getText()
    el.setContent('<p>不应被当作 slot 缓存的临时覆写</p>')
    const written = el.getText()
    el.remove()
    await new Promise(resolve => setTimeout(resolve, 60))
    const unmounted = el.getInstance() === null
    await appendReady()
    const result = { initial, written, unmounted, text: el.getText(), pmCount: el.querySelectorAll('.ProseMirror').length }
    el.remove()
    await new Promise(resolve => setTimeout(resolve, 60))
    return result
  })
  record('无持久化草稿时重连恢复标签内初始内容（slot 缓存）', slot.initial === '独立验证的 slot 初始正文' && slot.written === '不应被当作 slot 缓存的临时覆写' && slot.unmounted && slot.text === slot.initial && slot.pmCount === 1, JSON.stringify(slot))

  await page.screenshot({ path: path.join(SHOTS, 'element-01.png'), fullPage: true })
  record('无页面脚本错误', errors.length === 0, errors.slice(0, 3).join(' | '))
  await browser.close()
  const failed = results.filter((ok) => !ok).length
  console.log(`\n${results.length - failed}/${results.length} 项通过`)
  if (failed) process.exit(1)
}
main().catch((e) => { console.error('验证异常:', e); process.exit(1) })
