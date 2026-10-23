'use strict'
/**
 * 浏览器级验证：标题级别下拉（工具栏 ⇄ 划词气泡条）必须完全同款。
 *
 * 飞书里「正文 / 一~九级标题」这个下拉在顶部工具栏和划词气泡条是两个入口、
 * 同一份功能，观感必须一致。历史上它们是两套私有样式，慢慢分叉成
 * 152px / 内边距 6 / 行高 32 / 蓝字选中（气泡条）对 155px / 5 / 30 / 绿底（工具栏）。
 * 现在两处共用 `LarkDocHeadingMenu.vue` + `.lark-doc-dropdown`，本脚本守住「不许再分叉」：
 * - 菜单宽度 / 内边距 / 圆角 / 阴影 / 项高 / 项间距 / 项内文字起点 / 勾选位置一致；
 * - 选中态都是「浅绿底 + 深绿字 + 右侧勾」，且指向同一级别；
 * - 两个入口点同一项都能改块类型并关闭菜单。
 *
 * 依赖：demo dev server（Vue 路由暴露 window.__larkDoc）。用法：
 *   node scripts/verify-browser-heading-menu.js [url]
 */
const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright-core')

const BASE = process.argv[2] || 'http://localhost:8080/lark-doc'
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

/** 量一个标题下拉：盒子尺寸 + 项尺寸 + 项内相对坐标（相对项左边界，排除两处菜单位置不同）。 */
const measure = (selector) => {
  const menu = document.querySelector(selector)
  if (!menu) return null
  const cs = getComputedStyle(menu)
  const items = [...menu.querySelectorAll('button[role="menuitem"]')]
  const active = items.find((item) => item.classList.contains('lark-doc-menu-active'))
  const pick = (el) => {
    const style = getComputedStyle(el)
    const rect = el.getBoundingClientRect()
    const glyph = el.querySelector('.lark-doc-heading-glyph')
    const textNode = [...el.childNodes].find((node) => node.nodeType === 3 && node.textContent.trim())
    let labelLeft = null
    if (textNode) {
      const range = document.createRange()
      range.selectNodeContents(textNode)
      labelLeft = Math.round(range.getBoundingClientRect().left)
    }
    const check = el.querySelector('.lark-doc-menu-check')
    const left = Math.round(rect.left)
    return {
      w: Math.round(rect.width),
      h: Math.round(rect.height),
      padding: style.padding,
      gap: style.gap,
      radius: style.borderTopLeftRadius,
      bg: style.backgroundColor,
      color: style.color,
      glyph: glyph ? Math.round(glyph.getBoundingClientRect().left) - left : null,
      label: labelLeft == null ? null : labelLeft - left,
      check: check ? Math.round(rect.right) - Math.round(check.getBoundingClientRect().right) : null,
    }
  }
  return {
    box: { w: Math.round(menu.getBoundingClientRect().width), padding: cs.padding, radius: cs.borderTopLeftRadius, shadow: cs.boxShadow },
    count: items.length,
    labels: items.map((item) => item.textContent.trim()),
    item: pick(items[1]),
    activeText: active ? active.textContent.trim() : null,
    active: active ? pick(active) : null,
  }
}

const setHeading = async (page, level) => {
  await page.evaluate((value) => {
    const editor = window.__larkDoc.getEditor()
    editor.chain().focus().setTextSelection(1).setHeading({ level: value }).run()
  }, level)
  await page.waitForTimeout(350)
}

const dragSelectFirstBlock = async (page) => {
  const box = await page.evaluate(() => {
    const block = document.querySelector('.ProseMirror h4') || document.querySelector('.ProseMirror p')
    const rect = block.getBoundingClientRect()
    return { x: rect.left + 20, y: rect.top + rect.height / 2, to: rect.left + Math.min(180, rect.width - 4) }
  })
  await page.mouse.move(box.x, box.y)
  await page.mouse.down()
  await page.mouse.move(box.to, box.y, { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(500)
}

;(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: findChromium() || undefined })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.waitForTimeout(900)

  // 统一到 H4：两处下拉的选中项都必须是 H4，方便比对选中态。
  await setHeading(page, 4)

  // —— 工具栏入口 ——
  await page.hover('.lark-doc-heading-tool > button')
  await page.waitForTimeout(400)
  const toolbar = await page.evaluate(measure, '.lark-doc-heading-tool .lark-doc-heading-menu')
  record('[工具栏] 标题下拉有 10 项（正文 + 九级）', !!toolbar && toolbar.count === 10, toolbar ? `${toolbar.count} 项` : '未打开')
  record('[工具栏] 选中项是当前级别 H4', !!toolbar && String(toolbar.activeText).startsWith('H4'), toolbar ? String(toolbar.activeText) : '')

  // 点「一级标题」→ 变 H1 且菜单关闭
  await page.click('.lark-doc-heading-tool .lark-doc-heading-menu button[role="menuitem"]:nth-of-type(2)')
  await page.waitForTimeout(400)
  const toolbarApplied = await page.evaluate(() => ({
    level: window.__larkDoc.getEditor().getAttributes('heading').level || null,
    open: !!document.querySelector('.lark-doc-heading-tool .lark-doc-heading-menu'),
  }))
  record('[工具栏] 点一级标题能改块类型并关闭菜单', toolbarApplied.level === 1 && !toolbarApplied.open, `level=${toolbarApplied.level} 菜单还在=${toolbarApplied.open}`)

  // 复位到 H4，准备量气泡条
  await setHeading(page, 4)
  await page.mouse.move(760, 700)
  await page.waitForTimeout(400)

  // —— 气泡条入口 ——
  await dragSelectFirstBlock(page)
  const bubbleOpen = await page.evaluate(() => !!document.querySelector('.lark-doc-bubble'))
  record('[气泡条] 划词后气泡条出现', bubbleOpen)
  await page.hover('.lark-doc-bubble-heading-trigger')
  await page.waitForTimeout(500)
  const bubble = await page.evaluate(measure, '.lark-doc-bubble-heading .lark-doc-heading-menu')

  if (toolbar && bubble) {
    record('[统一] 两处菜单项数一致', toolbar.count === bubble.count, `${toolbar.count}/${bubble.count}`)
    record('[统一] 菜单宽度一致', toolbar.box.w === bubble.box.w, `${toolbar.box.w}/${bubble.box.w}`)
    record('[统一] 内边距一致', toolbar.box.padding === bubble.box.padding, `${toolbar.box.padding}/${bubble.box.padding}`)
    record('[统一] 圆角一致', toolbar.box.radius === bubble.box.radius, `${toolbar.box.radius}/${bubble.box.radius}`)
    record('[统一] 阴影一致', toolbar.box.shadow === bubble.box.shadow, toolbar.box.shadow)
    record('[统一] 菜单项尺寸与间距一致',
      toolbar.item.w === bubble.item.w && toolbar.item.h === bubble.item.h && toolbar.item.gap === bubble.item.gap && toolbar.item.padding === bubble.item.padding,
      `${toolbar.item.w}x${toolbar.item.h} gap=${toolbar.item.gap} pad=${toolbar.item.padding} / ${bubble.item.w}x${bubble.item.h} gap=${bubble.item.gap} pad=${bubble.item.padding}`)
    record('[统一] 项内文字起点一致（左对齐的级别列 + 标题文字）',
      toolbar.item.glyph === bubble.item.glyph && toolbar.item.label === bubble.item.label,
      `glyph ${toolbar.item.glyph}/${bubble.item.glyph} label ${toolbar.item.label}/${bubble.item.label}`)
    record('[统一] 选中态同款（浅绿底 + 深绿字 + 右侧勾）',
      toolbar.active.bg === bubble.active.bg && toolbar.active.color === bubble.active.color && /227, 242, 234/.test(toolbar.active.bg) && toolbar.active.check === bubble.active.check,
      `bg ${toolbar.active.bg}/${bubble.active.bg} color ${toolbar.active.color}/${bubble.active.color} 距右勾 ${toolbar.active.check}/${bubble.active.check}`)
    record('[统一] 选中项指向同一级别', String(toolbar.activeText).startsWith('H4') && String(bubble.activeText).startsWith('H4'),
      `${toolbar.activeText} / ${bubble.activeText}`)
    record('[统一] 气泡条标题下拉也是 10 项（正文 + 九级）', bubble.count === 10, `${bubble.count} 项`)
  } else {
    record('[统一] 两处下拉都能打开', false, `工具栏=${!!toolbar} 气泡条=${!!bubble}`)
  }

  // 气泡条点「一级标题」→ 变 H1 且菜单关闭
  await page.click('.lark-doc-bubble-heading .lark-doc-heading-menu button[role="menuitem"]:nth-of-type(2)')
  await page.waitForTimeout(500)
  const bubbleApplied = await page.evaluate(() => ({
    level: window.__larkDoc.getEditor().getAttributes('heading').level || null,
    open: !!document.querySelector('.lark-doc-bubble-heading .lark-doc-heading-menu'),
  }))
  record('[气泡条] 点一级标题能改块类型并关闭菜单', bubbleApplied.level === 1 && !bubbleApplied.open, `level=${bubbleApplied.level} 菜单还在=${bubbleApplied.open}`)

  record('无脚本错误', errors.length === 0, errors.join(' | '))

  const passed = results.filter((item) => item.ok).length
  console.log(`\n${passed}/${results.length} 项通过`)
  await browser.close()
  process.exit(passed === results.length ? 0 : 1)
})().catch((error) => { console.error(error); process.exit(1) })
