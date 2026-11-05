'use strict'
/**
 * 浏览器级验证：工具栏 + 顶栏（`editor/ToolbarBar.vue`、`editor/TopBar.vue`、
 * `editor/toolbarCollapseMixin.js`、`editor/toolbarMenusMixin.js`）。
 *
 * 阶段 5 批次 2 要把这四块从 Vue SFC 换成原生 DOM 片段，本套断言是那批改动的
 * **回归闸门**：改前先跑绿，改完必须仍然全绿，一条都不许「调松」。工具栏是全项目
 * 契约最密集的一处 —— 结构顺序、按钮盒模型、图标居中、吸顶口径、折叠逆序试探、
 * 三套下拉的开合与关闭方式、只读态禁用集合，任何一项漂移都会被下游依赖
 * （`bubbleSafeTop()`、气泡条标题下拉的「同款」比对、`icon-align` 系列）连带打破。
 *
 * 量法说明（两处与交接文档口径不同，以实测 + CSS 为准）：
 * - 按钮高度实测 **30px**（`lark-doc.css` 里 `.lark-doc-tools button { height: 30px }`），
 *   不是 32px；断言锁 30px，因为原生版必须复刻现状而不是改设计。
 * - 「图标垂直居中」不只看图标在按钮里居中，还要看按钮在 45px 工具栏里居中
 *   （`align-items: center` + 上下 `padding: 5px`），两条都按 1px 阈值卡。
 *
 * 顶栏在 demo 里被显式关掉（`layout.headerVisible: false`，操作入口移入工具栏「⋯」），
 * 所以顶栏本身用 `new (window.__larkDoc.constructor)({ layout: { headerVisible: true } })`
 * 单独起一个实例量 —— 不依赖 demo 配置为某一页开绿灯。
 *
 * 本脚本只经由 DOM 与公开门面断言，不碰 Vue 实例内部字段，原生化之后同一份断言仍然有效。
 *
 * 依赖：demo dev server（`window.__larkDoc`）。用法：
 *   node scripts/verify-browser-toolbar.js [url]
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
  results.push({ ok: !!ok })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}

// —— 页面内工具函数（必须自包含：会被 page.evaluate 序列化执行） ——

/** 通用安全线：sticky/fixed 且吸在视口上沿的顶栏/工具栏，取最大底边 + 6。 */
const safeTop = () => {
  let bottom = 8
  document.querySelectorAll('.lark-doc-topbar, .lark-doc-toolbar').forEach((bar) => {
    const position = getComputedStyle(bar).position
    if (position !== 'sticky' && position !== 'fixed') return
    const rect = bar.getBoundingClientRect()
    if (rect.top <= 1 && rect.bottom > bottom) bottom = rect.bottom
  })
  return Math.round(bottom) + 6
}

/** 工具栏直接子分组快照：顺序 / 显示态 / 分隔线 / 按钮无障碍名称。 */
const measureGroups = () => {
  const bar = document.querySelector('.lark-doc-toolbar')
  if (!bar) return null
  const barRect = bar.getBoundingClientRect()
  return {
    bar: {
      w: Math.round(barRect.width),
      h: Math.round(barRect.height),
      right: Math.round(barRect.right),
      scrollWidth: bar.scrollWidth,
      clientWidth: bar.clientWidth,
    },
    groups: [...bar.querySelectorAll('.lark-doc-tools')].map((el) => {
      const cs = getComputedStyle(el)
      const rect = el.getBoundingClientRect()
      return {
        cls: el.className,
        display: cs.display,
        borderRight: cs.borderRightWidth,
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        labels: [...el.querySelectorAll('button')].map((b) => b.getAttribute('aria-label') || b.textContent.trim()),
      }
    }),
  }
}

/** 逐个按钮量盒模型 + 图标居中偏移。 */
const measureButtons = () => {
  const bar = document.querySelector('.lark-doc-toolbar')
  if (!bar) return null
  const barRect = bar.getBoundingClientRect()
  const barCenter = (barRect.top + barRect.bottom) / 2
  const rows = []
  ;[...bar.querySelectorAll('.lark-doc-tools')].forEach((group, groupIndex) => {
    group.querySelectorAll('button').forEach((b) => {
      const rect = b.getBoundingClientRect()
      const cs = getComputedStyle(b)
      const icon = b.querySelector('.lark-doc-icon, svg')
      const iconRect = icon ? icon.getBoundingClientRect() : null
      rows.push({
        group: groupIndex,
        label: b.getAttribute('aria-label') || b.textContent.trim(),
        aria: b.getAttribute('aria-label'),
        title: b.getAttribute('title'),
        h: Math.round(rect.height),
        w: Math.round(rect.width),
        // 图标中心相对按钮中心的偏移；marks 组是纯文字字形，没有图标 → null
        dy: iconRect ? +((iconRect.top + iconRect.height / 2) - (rect.top + rect.height / 2)).toFixed(2) : null,
        // 按钮中心相对工具栏中心的偏移
        centerDelta: +((rect.top + rect.height / 2) - barCenter).toFixed(2),
        // 图标是否溢出按钮盒
        iconOverflow: iconRect
          ? (iconRect.left < rect.left - 0.5 || iconRect.right > rect.right + 0.5 || iconRect.top < rect.top - 0.5 || iconRect.bottom > rect.bottom + 0.5)
          : false,
        minWidth: cs.minWidth,
        padding: cs.padding,
        radius: cs.borderTopLeftRadius,
        fontSize: cs.fontSize,
      })
    })
  })
  return { count: rows.length, barCenter: +barCenter.toFixed(2), rows }
}

/** 标题下拉结构快照（与 verify-browser-bubble.js 的 measureHeadingMenu 同源量法）。 */
const measureHeadingMenu = (selector) => {
  const menu = document.querySelector(selector)
  if (!menu) return null
  const items = [...menu.querySelectorAll('button[role="menuitem"]')]
  const active = items.find((item) => item.classList.contains('lark-doc-menu-active'))
  const glyphs = items.filter((item) => item.querySelector('.lark-doc-heading-glyph')).length
  const checks = items.filter((item) => item.querySelector('.lark-doc-menu-check')).length
  return {
    role: menu.getAttribute('role'),
    label: menu.getAttribute('aria-label'),
    classes: [...menu.classList],
    w: Math.round(menu.getBoundingClientRect().width),
    count: items.length,
    labels: items.map((item) => item.textContent.trim()),
    glyphs,
    checks,
    activeText: active ? active.textContent.trim() : null,
  }
}

// —— 页面操作 ——

const setDoc = async (page, html) => {
  await page.evaluate((content) => {
    const editor = window.__larkDoc.getEditor()
    window.__larkDoc.setContent(content)
    // setContent 后选区落在文末，`currentBlockLabel` 会读到最后一个段落；
    // 归位到文档开头，才能稳定断言「首块是 H1」这类与选区相关的表现。
    editor.commands.focus('start')
    return true
  }, html)
  await page.waitForTimeout(340)
}

const triggerText = (page) => page.evaluate(() => document.querySelector('.lark-doc-heading-tool > button')?.textContent.trim() || null)

const headingOpen = (page) => page.evaluate(() => !!document.querySelector('.lark-doc-heading-tool .lark-doc-heading-menu'))

;(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: findChromium() || undefined })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1000)

  // 固定文档，避免 demo 从 localStorage 读草稿导致首块类型漂移
  await setDoc(page, '<h1>一级标题样张</h1><p>正文段落用于验证工具栏</p><p>第二段落用于对照</p>')

  // ——————————————————— ① 结构 ———————————————————
  const shell = await page.evaluate(() => {
    const bar = document.querySelector('.lark-doc-toolbar')
    return bar ? { role: bar.getAttribute('role'), label: bar.getAttribute('aria-label'), tag: bar.tagName } : null
  })
  record('[结构] 工具栏是 role=toolbar / aria-label=文档工具栏', !!shell && shell.role === 'toolbar' && shell.label === '文档工具栏', shell ? `${shell.tag}/${shell.role}/${shell.label}` : '未找到')

  const snap = await page.evaluate(measureGroups)
  const expectedClasses = [
    ['lark-doc-tools'],
    ['lark-doc-tools', 'lark-doc-heading-tool'],
    ['lark-doc-tools'],
    ['lark-doc-tools'],
    ['lark-doc-tools'],
    ['lark-doc-tools'],
    ['lark-doc-tools', 'lark-doc-tools-end'],
  ]
  record('[结构] 七个分组按「历史 / 标题 / 行内格式 / 文字样式 / 段落样式 / 插入 / 收尾」排列',
    !!snap && snap.groups.length === 7 && snap.groups.every((group, index) => group.cls === expectedClasses[index].join(' ')),
    snap ? snap.groups.map((group) => group.cls.replace('lark-doc-tools', '').trim() || 'history').join(' | ') : '未取到')

  const expectedLabels = [
    ['撤销', '重做'],
    ['标题级别'],
    ['加粗', '斜体', '下划线', '删除线', '行内代码', '下标', '上标', '高亮'],
    ['设置链接', '字体', '字号'],
    ['行高', '对齐左', '对齐居中', '对齐右', '对齐两端', '减少缩进', '增加缩进', '清除格式'],
    ['插入', '插入表格', '图表', 'AI 助手'],
    ['查找', '目录', '页面宽度', '阅读模式', '全屏', '演示模式', '快捷键帮助', '文档操作'],
  ]
  const labelsMatch = !!snap && snap.groups.length === 7 && expectedLabels.every((labels, index) => JSON.stringify(snap.groups[index].labels) === JSON.stringify(labels))
  record('[结构] 每组按钮的 aria-label 序列与契约一致', labelsMatch,
    snap ? snap.groups.map((group) => group.labels.join('/')).join(' ‖ ') : '未取到')

  record('[结构] 收尾组靠右（右边缘贴工具栏内容盒右边界，18px 内边距）',
    !!snap && Math.abs(snap.groups[6].right - (snap.bar.right - 18)) <= 2,
    snap ? `组右 ${snap.groups[6].right} / 期望 ${Math.round(snap.bar.right - 18)}` : '')

  record('[结构] 前六个分组有 1px 右分隔线，收尾组无',
    !!snap && snap.groups.slice(0, 6).every((group) => group.borderRight === '1px') && snap.groups[6].borderRight === '0px',
    snap ? snap.groups.map((group) => group.borderRight).join(' | ') : '')

  const buttons = await page.evaluate(measureButtons)
  record('[结构] 工具栏共 34 个按钮（2+1+8+3+8+4+8）', !!buttons && buttons.count === 34, buttons ? `${buttons.count} 个` : '')

  record('[结构] 每个按钮都有 aria-label 与 title',
    !!buttons && buttons.rows.every((row) => !!row.aria && !!row.title),
    buttons ? buttons.rows.filter((row) => !row.aria || !row.title).map((row) => row.label).join(' | ') || '全部齐全' : '')

  // ——————————————————— ② 盒模型与图标对齐 ———————————————————
  const heights = buttons ? [...new Set(buttons.rows.map((row) => row.h))] : []
  record('[尺寸] 工具按钮统一 30px 高', heights.length === 1 && heights[0] === 30, `高度集合 ${heights.join(',')}`)

  // marks 组用文字字形当图标，字号比其他按钮大半档（13px vs 12.5px）—— 现状如此，原生化必须照抄
  const boxBad = buttons ? buttons.rows.filter((row) => !(row.minWidth === '29px' && row.padding === '3px 6px' && row.radius === '6px' && row.fontSize === (row.group === 2 ? '13px' : '12.5px'))) : []
  record('[尺寸] 按钮盒模型统一（min-width 29 / padding 3px 6px / 圆角 6 / 字号 12.5，marks 组 13）', !!buttons && boxBad.length === 0,
    boxBad.length ? boxBad.map((row) => `${row.label}=${row.minWidth}/${row.padding}/${row.radius}/${row.fontSize}`).join(' | ') : `字号分组 ${[...new Set(buttons.rows.map((row) => `组${row.group}:${row.fontSize}`))].join(' ')}`)

  const withIcon = buttons ? buttons.rows.filter((row) => row.dy !== null) : []
  const worstDy = withIcon.reduce((max, row) => Math.max(max, Math.abs(row.dy)), 0)
  record('[对齐] 图标中心与按钮中心偏差 ≤1px',
    withIcon.length >= 15 && worstDy <= 1,
    `${withIcon.length} 个图标，最大偏差 ${worstDy.toFixed(2)}px`)

  const worstCenter = buttons ? buttons.rows.reduce((max, row) => Math.max(max, Math.abs(row.centerDelta)), 0) : 999
  record('[对齐] 按钮在 45px 工具栏内垂直居中（偏差 ≤1px）', worstCenter <= 1, `最大偏差 ${worstCenter.toFixed(2)}px`)

  record('[对齐] 图标不溢出按钮盒', !!buttons && buttons.rows.every((row) => !row.iconOverflow),
    buttons ? buttons.rows.filter((row) => row.iconOverflow).map((row) => row.label).join(' | ') || '无溢出' : '')

  // ——————————————————— ③ 吸顶 ———————————————————
  const barStyle = await page.evaluate(() => {
    const bar = document.querySelector('.lark-doc-toolbar')
    const cs = getComputedStyle(bar)
    const rect = bar.getBoundingClientRect()
    return { position: cs.position, top: cs.top, zIndex: cs.zIndex, rectTop: Math.round(rect.top), rectBottom: Math.round(rect.bottom), h: Math.round(rect.height) }
  })
  record('[吸顶] 固定在视口上沿（sticky / top 0 / z-index 34）',
    barStyle.position === 'sticky' && barStyle.top === '0px' && barStyle.zIndex === '34',
    `${barStyle.position} top=${barStyle.top} z=${barStyle.zIndex}`)

  record('[吸顶] 全宽下工具栏不横向溢出（scrollWidth ≤ clientWidth+1）',
    !!snap && snap.bar.scrollWidth <= snap.bar.clientWidth + 1,
    snap ? `${snap.bar.scrollWidth} ≤ ${snap.bar.clientWidth}+1` : '')

  const noMoreAtWide = await page.evaluate(() => !document.querySelector('.lark-doc-toolbar button[aria-label="更多"]'))
  record('[吸顶] 不溢出时没有「更多」按钮', noMoreAtWide)

  // 先把正文撑高，否则整页没有可滚动距离，sticky 无从验证
  const tallDoc = '<h1>吸顶样张</h1>' + Array.from({ length: 40 }, (_, index) => `<p>第 ${index + 1} 段用于把正文撑到超过一屏，验证工具栏吸顶。</p>`).join('')
  await setDoc(page, tallDoc)
  await page.evaluate(() => { window.scrollTo(0, 9999); return true })
  await page.waitForTimeout(520)
  const scrolled = await page.evaluate(() => {
    const rect = document.querySelector('.lark-doc-toolbar').getBoundingClientRect()
    return { top: Math.round(rect.top), bottom: Math.round(rect.bottom), scrollY: Math.round(window.scrollY) }
  })
  record('[吸顶] 页面滚动后工具栏仍吸在顶边（top 0，底边 45）',
    scrolled.scrollY > 100 && scrolled.top === 0 && scrolled.bottom === 45,
    `scrollY=${scrolled.scrollY} top=${scrolled.top} bottom=${scrolled.bottom}`)
  await page.evaluate(() => { window.scrollTo(0, 0); return true })
  await page.waitForTimeout(400)

  // 回到短文档，后续断言与选区位置相关
  await setDoc(page, '<h1>一级标题样张</h1><p>正文段落用于验证工具栏</p><p>第二段落用于对照</p>')

  // ——————————————————— ④ 标题下拉 ———————————————————
  record('[标题] 首块是 H1 时触发器显示「H1」', (await triggerText(page)) === 'H1', String(await triggerText(page)))

  await page.hover('.lark-doc-heading-tool > button')
  await page.waitForTimeout(460)
  const headingMenu = await page.evaluate(measureHeadingMenu, '.lark-doc-heading-tool .lark-doc-heading-menu')
  record('[标题] 悬停展开下拉', !!headingMenu && (await headingOpen(page)), headingMenu ? `${headingMenu.count} 项` : '未打开')
  record('[标题] 下拉是 role=menu / aria-label=标题级别 / 共 10 项（正文 + 一~九级）',
    !!headingMenu && headingMenu.role === 'menu' && headingMenu.label === '标题级别' && headingMenu.count === 10 && String(headingMenu.labels[0]).includes('正文'),
    headingMenu ? `${headingMenu.role}/${headingMenu.label}/${headingMenu.count}` : '未打开')

  record('[标题] 与气泡条共用同一构造（dropdown+heading-menu 类名 / 每项有 glyph / 仅选中项有勾）',
    !!headingMenu && headingMenu.classes.includes('lark-doc-dropdown') && headingMenu.classes.includes('lark-doc-heading-menu') && headingMenu.glyphs === 10 && headingMenu.checks === 1,
    headingMenu ? `glyph=${headingMenu.glyphs} check=${headingMenu.checks}` : '')

  record('[标题] 选中项跟随当前块（H1 高亮）',
    !!headingMenu && String(headingMenu.activeText).includes('一级标题'),
    headingMenu ? String(headingMenu.activeText) : '')

  const expandedOn = await page.evaluate(() => document.querySelector('.lark-doc-heading-tool > button')?.getAttribute('aria-expanded'))
  record('[标题] 展开后触发器 aria-expanded=true', expandedOn === 'true', String(expandedOn))

  await page.mouse.click(720, 780)
  await page.waitForTimeout(420)
  const expandedOff = await page.evaluate(() => document.querySelector('.lark-doc-heading-tool > button')?.getAttribute('aria-expanded'))
  record('[标题] 外部点击关闭并把 aria-expanded 复位', !(await headingOpen(page)) && expandedOff === 'false', `open=${await headingOpen(page)} expanded=${expandedOff}`)

  // ——————————————————— ⑤ 折叠 ———————————————————
  await page.setViewportSize({ width: 900, height: 900 })
  await page.waitForTimeout(1000)
  const narrow = await page.evaluate(measureGroups)
  const moreBtn = await page.evaluate(() => {
    const btn = document.querySelector('.lark-doc-toolbar button[aria-label="更多"]')
    if (!btn) return null
    const rect = btn.getBoundingClientRect()
    return { expanded: btn.getAttribute('aria-expanded'), h: Math.round(rect.height), text: btn.textContent.trim(), hasCaret: !!btn.querySelector('.lark-doc-caret') }
  })
  record('[折叠] 视口收窄到 900 后出现「更多」按钮（带 chevronDown 12px）',
    !!moreBtn && moreBtn.expanded === 'false' && moreBtn.hasCaret && moreBtn.text.startsWith('更多'),
    moreBtn ? `${moreBtn.text} expanded=${moreBtn.expanded} h=${moreBtn.h}` : '未出现')

  const hiddenGroups = narrow ? narrow.groups.filter((group) => group.display === 'none') : []
  record('[折叠] 溢出的分组用 display:none 真正退出布局（沿用 v-show 语义）',
    hiddenGroups.length >= 1 && narrow.groups.filter((group) => group.cls.includes('lark-doc-tools-end')).every((group) => group.display !== 'none'),
    narrow ? `收纳 ${hiddenGroups.length} 组，收尾组仍显示` : '')

  record('[折叠] 折叠后工具栏不再横向溢出（scrollWidth ≤ clientWidth+1）',
    !!narrow && narrow.bar.scrollWidth <= narrow.bar.clientWidth + 1,
    narrow ? `${narrow.bar.scrollWidth} ≤ ${narrow.bar.clientWidth}+1` : '')

  await page.click('.lark-doc-toolbar button[aria-label="更多"]')
  await page.waitForTimeout(460)
  const moreMenu = await page.evaluate(() => {
    const menu = document.querySelector('.lark-doc-more-menu')
    if (!menu) return null
    const rect = menu.getBoundingClientRect()
    return {
      role: menu.getAttribute('role'),
      label: menu.getAttribute('aria-label'),
      display: getComputedStyle(menu).display,
      w: Math.round(rect.width),
      top: Math.round(rect.top),
      right: Math.round(rect.right),
      titles: [...menu.querySelectorAll('.lark-doc-more-title')].map((el) => el.textContent.trim()),
      items: [...menu.querySelectorAll('button[role="menuitem"]')].map((b) => b.textContent.trim()),
      vuewport: { w: window.innerWidth, h: window.innerHeight },
    }
  })
  record('[折叠] 「更多」展开 role=menu / aria-label=更多工具 的网格弹层',
    !!moreMenu && moreMenu.role === 'menu' && moreMenu.label === '更多工具' && moreMenu.display === 'grid',
    moreMenu ? `${moreMenu.role}/${moreMenu.label}/${moreMenu.display}` : '未打开')

  record('[折叠] 弹层按被收纳的分组顺序分节（段落 / 插入 / 视图与工具）',
    !!moreMenu && JSON.stringify(moreMenu.titles) === JSON.stringify(['段落', '插入', '视图与工具']),
    moreMenu ? moreMenu.titles.join(' | ') : '')

  record('[折叠] 弹层承接被收纳组的全部功能（行高 1.75 / 增加缩进 / 插入表格 / 查找 均在）',
    !!moreMenu && ['行高 1.75', '减少缩进', '增加缩进', '清除格式', '插入内容…', '插入表格', 'AI 助手', '查找'].every((label) => moreMenu.items.includes(label)),
    moreMenu ? `${moreMenu.items.length} 项` : '')

  record('[折叠] 弹层不溢出视口', !!moreMenu && moreMenu.right <= moreMenu.vuewport.w && moreMenu.top >= 0,
    moreMenu ? `right=${moreMenu.right} top=${moreMenu.top} 视口 ${moreMenu.vuewport.w}` : '')

  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
  const moreClosed = await page.evaluate(() => !document.querySelector('.lark-doc-more-menu'))
  record('[折叠] Esc 关闭「更多」弹层', moreClosed)

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForTimeout(1100)
  const restored = await page.evaluate(measureGroups)
  record('[折叠] 视口放宽后按逆序逐步展开、分组全部复现且「更多」消失',
    !!restored && restored.groups.every((group) => group.display !== 'none') && !(await page.evaluate(() => !!document.querySelector('.lark-doc-toolbar button[aria-label="更多"]'))),
    restored ? `${restored.groups.filter((group) => group.display !== 'none').length}/7 组可见` : '')

  // ——————————————————— ⑥ 顶栏隐藏时的「文档操作」承接 ———————————————————
  const docOpsBtn = await page.evaluate(() => {
    const btn = document.querySelector('.lark-doc-toolbar button[aria-label="文档操作"]')
    return btn ? { text: btn.textContent.trim(), expanded: btn.getAttribute('aria-expanded') } : null
  })
  record('[承接] 顶栏隐藏时工具栏出现「文档操作」入口，初始 aria-expanded=false',
    !!docOpsBtn && docOpsBtn.expanded === 'false' && docOpsBtn.text === '⋯',
    docOpsBtn ? `${docOpsBtn.text} expanded=${docOpsBtn.expanded}` : '未出现')

  await page.click('.lark-doc-toolbar button[aria-label="文档操作"]')
  await page.waitForTimeout(460)
  const headerMenu = await page.evaluate(() => {
    const menu = document.querySelector('.lark-doc-header-menu')
    if (!menu) return null
    return {
      role: menu.getAttribute('role'),
      label: menu.getAttribute('aria-label'),
      labels: [...menu.querySelectorAll('button')].map((b) => b.getAttribute('aria-label') || b.textContent.trim()),
      expanded: document.querySelector('.lark-doc-toolbar button[aria-label="文档操作"]')?.getAttribute('aria-expanded'),
    }
  })
  record('[承接] 展开 role=menu / aria-label=文档操作 的弹层并承接原顶栏操作',
    !!headerMenu && headerMenu.role === 'menu' && headerMenu.label === '文档操作' && headerMenu.expanded === 'true',
    headerMenu ? `${headerMenu.role}/${headerMenu.label} expanded=${headerMenu.expanded}` : '未打开')

  record('[承接] 弹层内含字数上限 / 保存 / 模板 / 导入 / 导出 / 快照 六个入口',
    !!headerMenu && ['字数上限', '保存', '选择文档模板', '导入', '导出文档格式', '本地快照'].every((label) => headerMenu.labels.includes(label)),
    headerMenu ? headerMenu.labels.join(' | ') : '')

  await page.mouse.click(720, 780)
  await page.waitForTimeout(420)
  record('[承接] 外部点击关闭「文档操作」弹层', !(await page.evaluate(() => !!document.querySelector('.lark-doc-header-menu'))))

  // ——————————————————— ⑦ 只读态 ———————————————————
  await page.evaluate(() => { window.__larkDoc.setReadonly(true); return true })
  await page.waitForTimeout(560)
  const readonly = await page.evaluate(() => {
    const bar = document.querySelector('.lark-doc-toolbar')
    const btns = [...bar.querySelectorAll('.lark-doc-tools button')]
    return {
      editable: document.querySelector('.ProseMirror')?.getAttribute('contenteditable'),
      total: btns.length,
      disabled: btns.filter((b) => b.disabled).length,
      enabled: btns.filter((b) => !b.disabled).map((b) => b.getAttribute('aria-label') || b.textContent.trim()),
    }
  })
  const readonlyViewers = ['查找', '目录', '页面宽度', '阅读模式', '全屏', '演示模式', '快捷键帮助', '文档操作']
  record('[只读] 正文 contenteditable=false 且 26/34 按钮禁用',
    readonly.editable === 'false' && readonly.disabled === 26 && readonly.total === 34,
    `editable=${readonly.editable} 禁用 ${readonly.disabled}/${readonly.total}`)

  record('[只读] 未禁用的恰好是 8 个只读可用入口（查找/目录/页面宽度/视图/帮助/文档操作）',
    JSON.stringify(readonly.enabled) === JSON.stringify(readonlyViewers),
    readonly.enabled.join(' | '))

  await page.evaluate(() => { window.__larkDoc.setReadonly(false); return true })
  await page.waitForTimeout(560)
  const writable = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('.lark-doc-toolbar .lark-doc-tools button')]
    return {
      disabled: btns.filter((b) => b.disabled).map((b) => b.getAttribute('aria-label') || b.textContent.trim()),
      editable: document.querySelector('.ProseMirror')?.getAttribute('contenteditable'),
    }
  })
  // 撤销/重做（无历史）与「设置链接 / 减少缩进 / 增加缩进」（选区或块位置不满足上下文条件）
  // 天然禁用，与只读无关 —— 只要求其余写类按钮全部恢复
  const contextual = ['撤销', '重做', '设置链接', '减少缩进', '增加缩进']
  const stillDisabled = writable.disabled.filter((label) => !contextual.includes(label))
  record('[只读] 解除只读后写类按钮全部恢复可点（历史/上下文相关项除外）',
    stillDisabled.length === 0 && writable.editable === 'true',
    `仍禁用 ${(writable.disabled.join(' | ') || '无')}，editable=${writable.editable}`)

  // ——————————————————— ⑧ 安全线（气泡条依赖的吸顶口径） ———————————————————
  const demoTop = await page.evaluate(safeTop)
  record('[安全线] 顶栏隐藏时安全线 = 工具栏 sticky 底边 45 + 6 = 51', demoTop === 51, `实得 ${demoTop}`)

  const barBottom = await page.evaluate(() => Math.round(document.querySelector('.lark-doc-toolbar').getBoundingClientRect().bottom))
  record('[安全线] 折叠往返 + 滚动往返之后工具栏底边仍恒定 45px', barBottom === 45, `底边 ${barBottom}`)

  // ——————————————————— ⑨ 顶栏本体（单起实例，headerVisible=true） ———————————————————
  const topPage = await context.newPage()
  topPage.on('pageerror', (error) => errors.push(error.message))
  await topPage.goto(BASE, { waitUntil: 'networkidle' })
  await topPage.waitForTimeout(900)

  const topbar = await topPage.evaluate(async () => {
    const Klass = window.__larkDoc.constructor
    const host = document.createElement('div')
    host.id = 'toolbar-probe-host'
    host.style.cssText = 'position:fixed;left:0;top:0;width:1200px;height:700px;background:#fff;z-index:99999'
    document.body.appendChild(host)
    // eslint-disable-next-line new-cap
    const instance = new Klass({
      element: host,
      title: '顶栏探针文档',
      content: '<h1>顶栏探针</h1><p>正文</p>',
      storage: 'none',
      themeStorage: 'none',
      layout: { headerVisible: true, toolbarFixed: true, titleBarFixed: true },
    })
    window.__topBarProbe = instance
    await new Promise((resolve) => setTimeout(resolve, 1100))

    const bar = host.querySelector('.lark-doc-topbar')
    if (!bar) return { bar: null }
    const barRect = bar.getBoundingClientRect()
    const cs = getComputedStyle(bar)
    const titleInput = bar.querySelector('input')
    const brand = bar.querySelector('.lark-doc-brand')
    const modeBtn = bar.querySelector('.lark-doc-mode-select .lark-doc-select-trigger')
    const toolbar = host.querySelector('.lark-doc-toolbar')
    // 顶栏可见时的安全线（只在本实例范围内算）
    let safe = 8
    host.querySelectorAll('.lark-doc-topbar, .lark-doc-toolbar').forEach((node) => {
      const style = getComputedStyle(node)
      if (style.position !== 'sticky' && style.position !== 'fixed') return
      const rect = node.getBoundingClientRect()
      if (rect.top <= 1 && rect.bottom > safe) safe = rect.bottom
    })
    return {
      bar: {
        tag: bar.tagName,
        cls: bar.className,
        h: Math.round(barRect.height),
        position: cs.position,
        children: [...bar.children].map((el) => ({ tag: el.tagName, cls: el.className })),
      },
      brand: brand ? { label: brand.getAttribute('aria-label'), text: brand.textContent.trim() } : null,
      title: titleInput ? { label: titleInput.getAttribute('aria-label'), value: titleInput.value } : null,
      mode: modeBtn ? { label: modeBtn.getAttribute('aria-label'), haspopup: modeBtn.getAttribute('aria-haspopup'), text: modeBtn.textContent.trim(), expanded: modeBtn.getAttribute('aria-expanded') } : null,
      toolbarTop: toolbar ? getComputedStyle(toolbar).top : null,
      toolbarRectTop: toolbar ? Math.round(toolbar.getBoundingClientRect().top) : null,
      safeTop: Math.round(safe) + 6,
    }
  })

  record('[顶栏] headerVisible=true 时渲染 sticky 顶栏，高 58px',
    !!topbar.bar && topbar.bar.tag === 'HEADER' && topbar.bar.cls === 'lark-doc-topbar' && topbar.bar.position === 'sticky' && topbar.bar.h === 58,
    topbar.bar ? `${topbar.bar.tag}/${topbar.bar.position}/${topbar.bar.h}px` : '未渲染')

  record('[顶栏] 三段结构：品牌 / 标题 / 操作区（顺序固定）',
    !!topbar.bar && topbar.bar.children.length === 3 && topbar.bar.children[0].cls === 'lark-doc-brand' && topbar.bar.children[1].cls === 'lark-doc-title-wrap' && topbar.bar.children[2].cls === 'lark-doc-header-actions',
    topbar.bar ? topbar.bar.children.map((child) => child.cls).join(' | ') : '')

  record('[顶栏] 品牌区 aria-label=文档 且渲染 ✦ 文档',
    !!topbar.brand && topbar.brand.label === '文档' && topbar.brand.text.includes('✦') && topbar.brand.text.includes('文档'),
    topbar.brand ? `${topbar.brand.label} / 「${topbar.brand.text}」` : '缺品牌区')

  record('[顶栏] 标题输入为 aria-label=文档标题 的 input，值与 title 选项一致',
    !!topbar.title && topbar.title.label === '文档标题' && topbar.title.value === '顶栏探针文档',
    topbar.title ? `${topbar.title.label}=${topbar.title.value}` : '缺标题输入')

  record('[顶栏] 模式切换按钮声明 haspopup=listbox 且显示当前模式',
    !!topbar.mode && topbar.mode.haspopup === 'listbox' && topbar.mode.text.includes('编辑') && String(topbar.mode.label).includes('切换文档模式'),
    topbar.mode ? `${topbar.mode.label} / ${topbar.mode.text}` : '缺模式按钮')

  record('[顶栏] 顶栏可见时工具栏让位到 59px（58 + 1）',
    topbar.toolbarTop === '59px' && topbar.toolbarRectTop === 59,
    `top=${topbar.toolbarTop} rectTop=${topbar.toolbarRectTop}`)

  // 模式下拉走共享下拉原语（与工具栏「字号」同一套）：这里量的就是原语产出的结构，
  // 不再有 .lark-doc-mode-btn / .lark-doc-mode-menu 这种手搓类名。
  const modeMenu = await topPage.evaluate(async () => {
    const host = document.getElementById('toolbar-probe-host')
    const btn = host.querySelector('.lark-doc-mode-select .lark-doc-select-trigger')
    btn.click()
    await new Promise((resolve) => setTimeout(resolve, 460))
    const menu = host.querySelector('.lark-doc-mode-select .lark-doc-select-menu')
    if (!menu) return null
    const rect = menu.getBoundingClientRect()
    const btnRect = btn.getBoundingClientRect()
    const rows = [...menu.querySelectorAll('[role="option"]')]
    // 选中行配色必须等于本档的激活 token。变量值（如 #e3f2ea）与 computed 的
    // rgb() 写法不同，所以借一个临时元素把 token 解析成 computed 色再比。
    // 必须挂在 `.lark-doc` 内部：token 定义在根容器上，挂到 host（根容器的父亲）
    // 上取不到，会变成空串。
    const tokenHost = menu.closest('.lark-doc') || menu
    const probe = document.createElement('span')
    tokenHost.appendChild(probe)
    probe.style.backgroundColor = 'var(--ld-bg-accent-active)'
    const expectedActiveBg = getComputedStyle(probe).backgroundColor
    probe.style.backgroundColor = 'var(--ld-text-accent-hover)'
    const expectedActiveLabel = getComputedStyle(probe).backgroundColor
    probe.remove()
    const activeRow = rows.find((el) => el.classList.contains('lark-doc-select-active'))
    return {
      expectedActiveBg,
      expectedActiveLabel,
      activeBg: activeRow ? getComputedStyle(activeRow).backgroundColor : '',
      activeLabelColor: activeRow
        ? getComputedStyle(activeRow.querySelector('.lark-doc-select-item-label')).color
        : '',
      role: menu.getAttribute('role'),
      w: Math.round(rect.width),
      top: Math.round(rect.top),
      gap: Math.round(rect.top - btnRect.bottom),
      triggerLabel: btn.textContent.trim(),
      options: rows.map((el) => el.textContent.trim()),
      // 两行式：主标题 + 副标题同在一个 .lark-doc-select-text 里
      hints: rows.map((el) => {
        const hint = el.querySelector('.lark-doc-select-item-hint')
        return hint ? hint.textContent.trim() : ''
      }),
      // 两行 = 行高 22 + 18 + gap 2 + 上下 padding 10
      rowH: rows.length ? Math.round(rows[0].getBoundingClientRect().height) : 0,
      active: rows.findIndex((el) => el.classList.contains('lark-doc-select-active')),
      checkHidden: rows.length ? getComputedStyle(rows[0].querySelector('.lark-doc-select-check')).display : '',
      expanded: btn.getAttribute('aria-expanded'),
    }
  })
  record('[顶栏] 点模式按钮展开 role=listbox，列出编辑 / 修订 / 阅读三种模式',
    !!modeMenu && modeMenu.role === 'listbox' && modeMenu.options.length === 3 && modeMenu.options[0].includes('编辑') && modeMenu.options[1].includes('修订') && modeMenu.options[2].includes('阅读'),
    modeMenu ? modeMenu.options.join(' | ') : '未展开')

  record('[顶栏] 模式菜单贴按钮下沿 4px 展开、宽不小于 340、当前项高亮',
    !!modeMenu && modeMenu.gap === 4 && modeMenu.w >= 340 && modeMenu.expanded === 'true'
      // 高亮项必须就是按钮上显示的那一项（不写死 index：localStorage 里可能记着上次的模式）。
      && !!modeMenu.options[modeMenu.active] && modeMenu.options[modeMenu.active].startsWith(modeMenu.triggerLabel),
    modeMenu ? `gap=${modeMenu.gap} w=${modeMenu.w} expanded=${modeMenu.expanded} active=${modeMenu.active}/${modeMenu.triggerLabel}` : '')

  record('[顶栏] 模式项为两行（主标题 + 副标题），且不画 ✓ 勾选列',
    !!modeMenu && modeMenu.hints.filter(Boolean).length === 3 && modeMenu.rowH >= 46 && modeMenu.checkHidden === 'none',
    modeMenu ? `hints=${modeMenu.hints.join(' / ')} rowH=${modeMenu.rowH} check=${modeMenu.checkHidden}` : '')

  // 选中底色/文字**必须跟着当前主题走**（与块菜单 .lark-doc-menu-active 同一套激活 token）。
  // 曾经的坑：写死 --ld-bg-selected / --ld-brand-content，那两枚在默认绿档是飞书蓝字面量，
  // 菜单底下半截就冒出两片外来蓝，用户实测反馈「选中的背景色不符合当前主题」。
  record('[顶栏] 模式菜单选中行取本档激活 token（底色 / 主标题色都跟着主题变）',
    !!modeMenu && !!modeMenu.activeBg
      && modeMenu.activeBg === modeMenu.expectedActiveBg
      && modeMenu.activeLabelColor === modeMenu.expectedActiveLabel,
    modeMenu ? `bg=${modeMenu.activeBg}(期望 ${modeMenu.expectedActiveBg}) label=${modeMenu.activeLabelColor}(期望 ${modeMenu.expectedActiveLabel})` : '')

  record('[安全线] 顶栏可见时安全线 = 顶栏 sticky 底边 58 + 6 = 64', topbar.safeTop === 64, `实得 ${topbar.safeTop}`)

  // 清理探针实例
  await topPage.evaluate(() => {
    try { window.__topBarProbe?.destroy?.() } catch (error) { /* 忽略 */ }
    document.getElementById('toolbar-probe-host')?.remove()
    return true
  })

  record('无脚本错误', errors.length === 0, errors.slice(0, 3).join(' | '))

  const passed = results.filter((item) => item.ok).length
  console.log(`\n${passed}/${results.length} 项通过`)
  await browser.close()
  process.exit(passed === results.length ? 0 : 1)
})().catch((error) => { console.error(error); process.exit(1) })
