'use strict'
/**
 * 浏览器级验证：划词气泡条（`src/ui/bubbleBar.js` + `bubbleMenuMixin.js`）。
 *
 * 阶段 5 批次 1 把气泡条从 Vue SFC（原 `editor/BubbleBar.vue`，已删）换成原生
 * DOM 片段（`src/ui/bubbleBar.js`），本套断言是那批改动的**回归闸门**：开跑前
 * 先让它 44/44 绿，改完必须仍然是 44/44，一条都不许「调松」。换的是渲染层，
 * 但气泡条是本项目里「时序 + 定位 + 悬停」最密集的一个浮层，历史上踩过的坑都在这里：
 * - 六段结构（AI / 标题级别 / 缩进对齐 / 行内格式 / 高亮取色 / 复制）不许换位或丢段；
 * - 标题级别下拉与工具栏**共用同一份菜单**，观感不许再分叉；
 * - 弹出层永远排在吸顶工具栏**下面**（`bubbleSafeTop()`）；
 * - 触发器与弹层之间有 6px 间隙，鼠标穿过去不许闪（160ms 延时关闭）；
 * - `toggleMark` 之后气泡条要收起、`mousedown` 不许把选区点塌。
 *
 * 本脚本只经由 DOM 与公开门面（`window.__larkDoc.getEditor()/setContent()/setReadonly()`）断言，
 * 不碰 Vue 实例内部字段 —— 这样原生化之后同一份断言仍然有效。
 *
 * 依赖：demo dev server（Vue 路由暴露 `window.__larkDoc`）。用法：
 *   node scripts/verify-browser-bubble.js [url]
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

/** 气泡条安全线：sticky/fixed 且吸在视口上沿的顶栏底边 + 6。 */
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

/** 气泡条结构快照：按视觉顺序给出每一段的标记，用来锁「六段不许换位」。 */
const bubbleSegments = () => {
  const root = document.querySelector('.lark-doc-bubble')
  if (!root) return null
  return [...root.children].map((el) => {
    const cls = [...el.classList].filter((name) => name.startsWith('lark-doc-bubble-'))
    if (el.classList.contains('lark-doc-bubble-divider')) return 'divider'
    if (el.classList.contains('lark-doc-bubble-ai')) return 'ai'
    if (el.classList.contains('lark-doc-bubble-heading')) return 'heading'
    if (el.classList.contains('lark-doc-bubble-align')) return 'align'
    if (el.classList.contains('lark-doc-bubble-mark-highlight')) return 'highlight'
    if (el.classList.contains('lark-doc-bubble-caret-button')) return 'highlight-caret'
    const label = el.getAttribute('aria-label') || ''
    if (label === '复制选中文字') return 'copy'
    return `mark:${label || cls.join('.')}`
  })
}

/** 量一个标题下拉（与 verify-browser-heading-menu.js 同一套量法，便于横向比对）。 */
const measureHeadingMenu = (selector) => {
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
      glyph: glyph ? Math.round(glyph.getBoundingClientRect().left) - left : null,
      label: labelLeft == null ? null : labelLeft - left,
      bg: style.backgroundColor,
      color: style.color,
      check: check ? Math.round(rect.right) - Math.round(check.getBoundingClientRect().right) : null,
    }
  }
  return {
    box: { w: Math.round(menu.getBoundingClientRect().width), padding: cs.padding, radius: cs.borderTopLeftRadius, shadow: cs.boxShadow },
    count: items.length,
    labels: items.map((item) => item.textContent.trim()),
    item: items[1] ? pick(items[1]) : null,
    activeText: active ? active.textContent.trim() : null,
    active: active ? pick(active) : null,
  }
}

// —— 页面操作 ——

const setDoc = async (page, html) => {
  await page.evaluate((content) => window.__larkDoc.setContent(content), html)
  await page.waitForTimeout(320)
}

/** 用真实鼠标划选某个块：气泡条的显隐依赖编辑器聚焦与真实 selection。 */
const dragSelect = async (page, selector) => {
  // 先收拢已有选区：在「已被选中」的文字上按下鼠标，浏览器会起手原生拖拽选中文本，
  // ProseMirror 收不到这次拖拽，选区反而塌成光标 → 气泡条不弹。按一次方向键即可。
  await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(60)
  const box = await page.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const rect = el.getBoundingClientRect()
    return { x0: rect.left + 6, x1: rect.left + Math.min(220, rect.width - 6), y: rect.top + rect.height / 2 }
  }, selector)
  if (!box) return false
  await page.mouse.move(box.x0, box.y)
  await page.mouse.down()
  await page.mouse.move(box.x1, box.y, { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(420)
  return true
}

const bubbleVisible = (page) => page.evaluate(() => !!document.querySelector('.lark-doc-bubble'))

const alignMenuOpen = (page) => page.evaluate(() => !!document.querySelector('.lark-doc-bubble-align-menu'))

;(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: findChromium() || undefined })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.waitForTimeout(900)

  // ——————————————————— ① 显隐 ———————————————————
  record('[显隐] 初始没有气泡条', !(await bubbleVisible(page)))

  await setDoc(page, '<h2>气泡条样张</h2><p>选中这段文字用来验证气泡条</p><p>第二段落用于对照</p>')
  await dragSelect(page, '.ProseMirror p')
  const toolbarRole = await page.evaluate(() => {
    const bubble = document.querySelector('.lark-doc-bubble')
    if (!bubble) return null
    return { role: bubble.getAttribute('role'), label: bubble.getAttribute('aria-label') }
  })
  record('[显隐] 划词后出现气泡条且是 toolbar/划词工具栏', !!toolbarRole && toolbarRole.role === 'toolbar' && toolbarRole.label === '划词工具栏', toolbarRole ? `${toolbarRole.role}/${toolbarRole.label}` : '未出现')

  // mousedown 不许把选区点塌（模板根节点上的 @mousedown.prevent）
  const selectionKept = await page.evaluate(() => {
    const bubble = document.querySelector('.lark-doc-bubble')
    const editor = window.__larkDoc.getEditor()
    const before = editor.state.selection.empty
    const padding = bubble.getBoundingClientRect()
    // 点在气泡条的内边距上（不是任何按钮），只验证 mousedown 的默认行为被拦掉。
    bubble.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: padding.left + 1, clientY: padding.top + 1 }))
    return { before, after: editor.state.selection.empty }
  })
  record('[显隐] 气泡条上按下鼠标不会塌掉选区', selectionKept.before === false && selectionKept.after === false, `empty ${selectionKept.before}→${selectionKept.after}`)

  // ——————————————————— ② 六段结构 ———————————————————
  const segments = await page.evaluate(bubbleSegments)
  const expected = ['ai', 'divider', 'heading', 'align', 'divider', 'mark:加粗', 'mark:删除线', 'mark:斜体', 'mark:下划线', 'mark:行内代码', 'highlight', 'highlight-caret', 'divider', 'copy']
  record('[结构] 六段顺序与 demo 全量特性下的按钮序列一致', JSON.stringify(segments) === JSON.stringify(expected), segments ? segments.join(' | ') : '未取到')
  record('[结构] 三个分隔符把气泡条分成「AI / 块级与行内格式 / 复制」三段',
    Array.isArray(segments) && segments.filter((item) => item === 'divider').length === 3,
    Array.isArray(segments) ? `${segments.filter((item) => item === 'divider').length} 个` : '')
  record('[结构] 行内格式按钮按固定顺序渲染 5 个 mark',
    Array.isArray(segments) && ['加粗', '删除线', '斜体', '下划线', '行内代码'].every((label, index) => segments[5 + index] === `mark:${label}`),
    Array.isArray(segments) ? segments.slice(5, 10).join(' | ') : '')

  // ——————————————————— ③ 位置 ———————————————————
  const bubbleBox = await page.evaluate(() => {
    const rect = document.querySelector('.lark-doc-bubble').getBoundingClientRect()
    return { left: Math.round(rect.left), right: Math.round(rect.right), top: Math.round(rect.top), bottom: Math.round(rect.bottom), w: window.innerWidth, h: window.innerHeight }
  })
  record('[位置] 气泡条不溢出视口', bubbleBox.left >= 0 && bubbleBox.right <= bubbleBox.w && bubbleBox.top >= 0 && bubbleBox.bottom <= bubbleBox.h,
    `${bubbleBox.left}..${bubbleBox.right} / ${bubbleBox.top}..${bubbleBox.bottom} 视口 ${bubbleBox.w}x${bubbleBox.h}`)

  // ——————————————————— ④ 标题级别下拉 ———————————————————
  const headingTriggerState = await page.evaluate(() => {
    const trigger = document.querySelector('.lark-doc-bubble-heading-trigger')
    return trigger ? { haspopup: trigger.getAttribute('aria-haspopup'), expanded: trigger.getAttribute('aria-expanded'), text: trigger.textContent.trim() } : null
  })
  record('[标题] 触发器声明 haspopup=menu 且初始 aria-expanded=false',
    !!headingTriggerState && headingTriggerState.haspopup === 'menu' && headingTriggerState.expanded === 'false',
    headingTriggerState ? `${headingTriggerState.haspopup}/${headingTriggerState.expanded}` : '缺触发器')
  record('[标题] 当前块是正文时触发器显示「正文」', !!headingTriggerState && headingTriggerState.text.startsWith('正文'), headingTriggerState?.text || '')

  await page.hover('.lark-doc-bubble-heading-trigger')
  await page.waitForTimeout(450)
  const headingMenu = await page.evaluate(measureHeadingMenu, '.lark-doc-bubble-heading .lark-doc-heading-menu')
  record('[标题] 悬停展开下拉（三入口之一）', !!headingMenu)
  record('[标题] 下拉是「正文 + 九级」共 10 项', !!headingMenu && headingMenu.count === 10 && String(headingMenu.labels[0]).includes('正文'), headingMenu ? `${headingMenu.count} 项，首项 ${headingMenu.labels[0]}` : '未打开')
  record('[标题] 正文块时选中项是「正文」', !!headingMenu && String(headingMenu.activeText).includes('正文'), headingMenu ? String(headingMenu.activeText) : '')
  const expandedAfterHover = await page.evaluate(() => document.querySelector('.lark-doc-bubble-heading-trigger')?.getAttribute('aria-expanded'))
  record('[标题] 展开后 aria-expanded=true', expandedAfterHover === 'true', String(expandedAfterHover))

  // 与工具栏共用同一份菜单：量工具栏入口做对比
  await page.mouse.move(760, 760)
  await page.waitForTimeout(400)
  await page.hover('.lark-doc-heading-tool > button')
  await page.waitForTimeout(400)
  const toolbarMenu = await page.evaluate(measureHeadingMenu, '.lark-doc-heading-tool .lark-doc-heading-menu')
  record('[标题] 工具栏也有同款标题下拉（对比基准存在）', !!toolbarMenu, toolbarMenu ? `${toolbarMenu.count} 项` : '未打开')
  if (toolbarMenu && headingMenu) {
    record('[标题] 与工具栏同款：项数/宽度/内边距/圆角/阴影一致',
      toolbarMenu.count === headingMenu.count && toolbarMenu.box.w === headingMenu.box.w && toolbarMenu.box.padding === headingMenu.box.padding && toolbarMenu.box.radius === headingMenu.box.radius && toolbarMenu.box.shadow === headingMenu.box.shadow,
      `${toolbarMenu.count}项 ${toolbarMenu.box.w}px ${toolbarMenu.box.padding} ${toolbarMenu.box.radius} / ${headingMenu.count}项 ${headingMenu.box.w}px ${headingMenu.box.padding} ${headingMenu.box.radius}`)
    record('[标题] 与工具栏同款：项高/间距/内边距/文字起点一致',
      !!toolbarMenu.item && !!headingMenu.item && toolbarMenu.item.w === headingMenu.item.w && toolbarMenu.item.h === headingMenu.item.h && toolbarMenu.item.gap === headingMenu.item.gap && toolbarMenu.item.padding === headingMenu.item.padding && toolbarMenu.item.glyph === headingMenu.item.glyph && toolbarMenu.item.label === headingMenu.item.label,
      toolbarMenu.item && headingMenu.item ? `${toolbarMenu.item.w}x${toolbarMenu.item.h} gap=${toolbarMenu.item.gap} glyph=${toolbarMenu.item.glyph} label=${toolbarMenu.item.label} / ${headingMenu.item.w}x${headingMenu.item.h} gap=${headingMenu.item.gap} glyph=${headingMenu.item.glyph} label=${headingMenu.item.label}` : '缺项')
    record('[标题] 与工具栏同款：选中态底色/字色/勾选位置一致',
      !!toolbarMenu.active && !!headingMenu.active && toolbarMenu.active.bg === headingMenu.active.bg && toolbarMenu.active.color === headingMenu.active.color && toolbarMenu.active.check === headingMenu.active.check,
      toolbarMenu.active && headingMenu.active ? `bg ${toolbarMenu.active.bg}/${headingMenu.active.bg} 勾距右 ${toolbarMenu.active.check}/${headingMenu.active.check}` : '缺选中项')
  } else {
    record('[标题] 与工具栏同款（项数/尺寸/选中态）', false, '有一侧没打开')
  }
  await page.mouse.move(760, 760)
  await page.waitForTimeout(420)

  // 回到气泡条：hover 进下拉后选「二级标题」
  await page.hover('.lark-doc-bubble-heading-trigger')
  await page.waitForTimeout(420)
  await page.click('.lark-doc-bubble-heading .lark-doc-heading-menu button[role="menuitem"]:nth-of-type(3)')
  await page.waitForTimeout(450)
  const headingApplied = await page.evaluate(() => {
    const editor = window.__larkDoc.getEditor()
    return {
      level: editor.getAttributes('heading').level || null,
      open: !!document.querySelector('.lark-doc-bubble-heading .lark-doc-heading-menu'),
      bubble: !!document.querySelector('.lark-doc-bubble'),
      value: document.querySelector('.lark-doc-bubble-heading-trigger')?.textContent.trim(),
    }
  })
  record('[标题] 点「二级标题」改块类型并关闭下拉', headingApplied.level === 2 && !headingApplied.open, `level=${headingApplied.level} 菜单还在=${headingApplied.open}`)
  // 改块类型只收起下拉、不收起气泡条（选区还在，气泡条跟着选区走）；
  // 与 mark 按钮不同——那边会把 bubbleVisible 置 false。触发器随即显示新的级别。
  record('[标题] 改块类型后气泡条保留且触发器显示 H2', headingApplied.bubble && String(headingApplied.value).startsWith('H2'), `气泡=${headingApplied.bubble} 触发器=${headingApplied.value}`)

  // focus / click 两个入口也能展开（飞书口径：悬停、聚焦、点击都能开）。
  // Vue 是异步渲染：入口触发后必须等一次渲染帧再查 DOM，否则永远读到展开前的状态。
  await setDoc(page, '<p>聚焦与点击入口</p><p>第二段落用于对照</p>')
  await dragSelect(page, '.ProseMirror p')
  const focusEntry = await page.evaluate(() => {
    const trigger = document.querySelector('.lark-doc-bubble-heading-trigger')
    if (!trigger) return null
    trigger.focus()
    return true
  })
  await page.waitForTimeout(260)
  const focusOpened = await page.evaluate(() => !!document.querySelector('.lark-doc-bubble-heading .lark-doc-heading-menu'))
  record('[标题] 聚焦触发器即可展开（focus 入口）', focusEntry === true && focusOpened === true, `触发器在=${focusEntry} 下拉打开=${focusOpened}`)
  await page.mouse.move(760, 760)
  await page.waitForTimeout(400)
  const clickEntry = await page.evaluate(() => {
    const trigger = document.querySelector('.lark-doc-bubble-heading-trigger')
    if (!trigger) return null
    trigger.click()
    return true
  })
  await page.waitForTimeout(260)
  const clickOpened = await page.evaluate(() => !!document.querySelector('.lark-doc-bubble-heading .lark-doc-heading-menu'))
  record('[标题] 点击触发器即可展开（click 入口）', clickEntry === true && clickOpened === true, `触发器在=${clickEntry} 下拉打开=${clickOpened}`)

  // 跨 6px 间隙移动不闪：从触发器移到下拉内部，延时关闭必须被取消
  await page.mouse.move(760, 760)
  await page.waitForTimeout(400)
  if (await bubbleVisible(page)) {
    await page.hover('.lark-doc-bubble-heading-trigger')
    await page.waitForTimeout(300)
    const menuBox = await page.evaluate(() => {
      const menu = document.querySelector('.lark-doc-bubble-heading .lark-doc-heading-menu')
      if (!menu) return null
      const rect = menu.getBoundingClientRect()
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    })
    if (menuBox) {
      await page.mouse.move(menuBox.x, menuBox.y, { steps: 8 })
      await page.waitForTimeout(320)
      const stillOpen = await page.evaluate(() => !!document.querySelector('.lark-doc-bubble-heading .lark-doc-heading-menu'))
      record('[标题] 鼠标从触发器穿到下拉上不闪（160ms 延时关闭被取消）', stillOpen)
    } else {
      record('[标题] 鼠标从触发器穿到下拉上不闪（160ms 延时关闭被取消）', false, '下拉没打开')
    }
  } else {
    record('[标题] 鼠标从触发器穿到下拉上不闪（160ms 延时关闭被取消）', false, '气泡条不在')
  }

  // ——————————————————— ⑤ 缩进和对齐下拉 ———————————————————
  await setDoc(page, '<p>缩进和对齐样张文字</p><p>第二段落用于对照</p>')
  await dragSelect(page, '.ProseMirror p')
  const alignTriggerState = await page.evaluate(() => {
    const trigger = document.querySelector('.lark-doc-bubble-align-trigger')
    return trigger ? { haspopup: trigger.getAttribute('aria-haspopup'), expanded: trigger.getAttribute('aria-expanded') } : null
  })
  record('[对齐] 触发器声明 haspopup=menu 且初始 aria-expanded=false',
    !!alignTriggerState && alignTriggerState.haspopup === 'menu' && alignTriggerState.expanded === 'false',
    alignTriggerState ? `${alignTriggerState.haspopup}/${alignTriggerState.expanded}` : '缺触发器')

  await page.hover('.lark-doc-bubble-align-trigger')
  await page.waitForTimeout(450)
  const safeLine = await page.evaluate(safeTop)
  const alignSnapshot = await page.evaluate(() => {
    const menu = document.querySelector('.lark-doc-bubble-align-menu')
    if (!menu) return null
    const rect = menu.getBoundingClientRect()
    return {
      role: menu.getAttribute('role'),
      label: menu.getAttribute('aria-label'),
      pressed: [...menu.querySelectorAll('button[role="menuitem"]')].map((item) => ({ text: item.textContent.trim(), pressed: item.getAttribute('aria-pressed'), tooltip: item.getAttribute('data-tooltip'), disabled: item.disabled })).slice(0, 4),
      separator: !!menu.querySelector('.lark-doc-block-submenu-divider[role="separator"]'),
      box: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, h: window.innerHeight, w: window.innerWidth },
    }
  })
  record('[对齐] 悬停展开 menu/划词缩进和对齐', !!alignSnapshot && alignSnapshot.role === 'menu' && alignSnapshot.label === '划词缩进和对齐', alignSnapshot ? `${alignSnapshot.role}/${alignSnapshot.label}` : '未打开')
  record('[对齐] 四项对齐里恰好一个 aria-pressed=true 且是「左对齐」',
    !!alignSnapshot && alignSnapshot.pressed.length === 4 && alignSnapshot.pressed.filter((item) => item.pressed === 'true').length === 1 && alignSnapshot.pressed[0].pressed === 'true' && alignSnapshot.pressed[0].text.includes('左对齐'),
    alignSnapshot ? alignSnapshot.pressed.map((item) => `${item.text}:${item.pressed}`).join(' | ') : '')
  record('[对齐] 四项对齐都带快捷键 data-tooltip',
    !!alignSnapshot && ['⌘ + Shift + L', '⌘ + Shift + E', '⌘ + Shift + R', '⌘ + Shift + J'].every((shortcut, index) => alignSnapshot.pressed[index].tooltip === shortcut),
    alignSnapshot ? alignSnapshot.pressed.map((item) => item.tooltip).join(' | ') : '')
  record('[对齐] 对齐项与缩进项之间有分隔符', !!alignSnapshot && alignSnapshot.separator)
  record('[对齐] 下拉不溢出视口', !!alignSnapshot && alignSnapshot.box.left >= 0 && alignSnapshot.box.right <= alignSnapshot.box.w && alignSnapshot.box.top >= 0 && alignSnapshot.box.bottom <= alignSnapshot.box.h,
    alignSnapshot ? `${Math.round(alignSnapshot.box.left)}..${Math.round(alignSnapshot.box.right)} / ${Math.round(alignSnapshot.box.top)}..${Math.round(alignSnapshot.box.bottom)}` : '')
  record('[对齐] 下拉排在吸顶工具栏下方（bubbleSafeTop）', !!alignSnapshot && alignSnapshot.box.top >= safeLine - 1,
    alignSnapshot ? `top=${Math.round(alignSnapshot.box.top)} safeTop=${safeLine}` : '')

  // 点「居中对齐」
  await page.click('.lark-doc-bubble-align-menu button[role="menuitem"]:nth-of-type(2)')
  await page.waitForTimeout(420)
  const centered = await page.evaluate(() => ({
    attr: window.__larkDoc.getJSON().content[0].attrs.textAlign,
    css: getComputedStyle(document.querySelector('.ProseMirror p')).textAlign,
    open: !!document.querySelector('.lark-doc-bubble-align-menu'),
  }))
  record('[对齐] 点「居中对齐」写入段落属性并关闭下拉', centered.attr === 'center' && centered.css === 'center' && !centered.open, `attr=${centered.attr} css=${centered.css} 菜单还在=${centered.open}`)

  // 缩进：缩进语义是「成为上一个块的子块」，所以第一个块永远不能再增加（上限 0）；
  // 这里用第二个段落做目标，才能验证「增加缩进真的写属性」。
  // 另外上一步把段落居中后不能再直接按 rect.left 起拖（居中留白里拖不出选区），先换样张。
  await setDoc(page, '<p>缩进样张文字内容</p><p>第二段落用于对照</p>')
  await dragSelect(page, '.ProseMirror p:nth-of-type(2)')
  await page.hover('.lark-doc-bubble-align-trigger')
  await page.waitForTimeout(420)
  const indentState = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('.lark-doc-bubble-align-menu button[role="menuitem"]')]
    const find = (label) => buttons.find((item) => item.textContent.includes(label))
    const increase = find('增加缩进')
    const decrease = find('减少缩进')
    return {
      increaseDisabled: increase?.disabled,
      increaseTooltip: increase?.getAttribute('data-tooltip'),
      decreaseDisabled: decrease?.disabled,
      decreaseTooltip: decrease?.getAttribute('data-tooltip'),
      help: !!increase?.querySelector('.lark-doc-block-align-help'),
      helpLabel: increase?.querySelector('.lark-doc-block-align-help')?.getAttribute('aria-label'),
    }
  })
  record('[缩进] 顶层段落（indent=0）「减少缩进」disabled 并提示已达最小层级',
    indentState.decreaseDisabled === true && indentState.decreaseTooltip === '当前内容块已达最小缩进层级',
    `disabled=${indentState.decreaseDisabled} tooltip=${indentState.decreaseTooltip}`)
  record('[缩进] 有前一个块时「增加缩进」可点且提示普通文案',
    indentState.increaseDisabled === false && indentState.increaseTooltip === '增加缩进',
    `disabled=${indentState.increaseDisabled} tooltip=${indentState.increaseTooltip}`)

  await page.click('.lark-doc-bubble-align-menu button[role="menuitem"]:has-text("增加缩进")')
  await page.waitForTimeout(420)
  const indented = await page.evaluate(() => {
    const editor = window.__larkDoc.getEditor()
    return { attr: editor.getAttributes('paragraph').indent, open: !!document.querySelector('.lark-doc-bubble-align-menu') }
  })
  record('[缩进] 点「增加缩进」写入段落属性并关闭下拉', indented.attr === 1 && !indented.open, `indent=${indented.attr} 菜单还在=${indented.open}`)

  // 顶到上限（前一个块 indent=0 → 上限 1；这里直接写 5 制造越限状态）：增加缩进 disabled + 「?」说明
  await page.evaluate(() => {
    const editor = window.__larkDoc.getEditor()
    let range = null
    editor.state.doc.descendants((node, pos) => {
      if (!range && node.type.name === 'paragraph' && node.textContent.includes('第二段落')) range = { from: pos + 1, to: pos + node.nodeSize - 1 }
      return true
    })
    if (range) editor.chain().setTextSelection(range).updateAttributes('paragraph', { indent: 5 }).run()
    editor.commands.focus()
  })
  await page.waitForTimeout(360)
  await page.hover('.lark-doc-bubble-align-trigger')
  await page.waitForTimeout(450)
  const maxIndent = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('.lark-doc-bubble-align-menu button[role="menuitem"]')]
    const increase = buttons.find((item) => item.textContent.includes('增加缩进'))
    const help = increase?.querySelector('.lark-doc-block-align-help')
    return { disabled: increase?.disabled, tooltip: increase?.getAttribute('data-tooltip'), help: !!help, ariaLabel: help?.getAttribute('aria-label') }
  })
  record('[缩进] 达到最大缩进时「增加缩进」disabled 并给出上限说明',
    maxIndent.disabled === true && maxIndent.tooltip === '当前内容块已达最大缩进层级',
    `disabled=${maxIndent.disabled} tooltip=${maxIndent.tooltip}`)
  record('[缩进] 上限状态额外挂 aria-label 的问号说明', maxIndent.help && !!maxIndent.ariaLabel, `help=${maxIndent.help} aria-label=${maxIndent.ariaLabel}`)

  // Esc 关闭下拉
  await page.keyboard.press('Escape')
  await page.waitForTimeout(320)
  record('[关闭] Esc 关掉缩进和对齐下拉', !(await alignMenuOpen(page)))

  // ——————————————————— ⑥ 行内格式与复制 ———————————————————
  await setDoc(page, '<p>格式与复制样张文字</p><p>第二段落用于对照</p>')
  await dragSelect(page, '.ProseMirror p')
  const markLabels = await page.evaluate(() => [...document.querySelectorAll('.lark-doc-bubble button[aria-label]')].map((item) => item.getAttribute('aria-label')))
  record('[格式] 行内格式按钮无障碍名称齐全',
    ['加粗', '删除线', '斜体', '下划线', '行内代码'].every((label) => markLabels.includes(label)),
    markLabels.join(' | '))
  const pressedBefore = await page.evaluate(() => document.querySelector('.lark-doc-bubble button[aria-label="加粗"]')?.getAttribute('aria-pressed'))
  record('[格式] 未加粗时 aria-pressed=false', pressedBefore === 'false', String(pressedBefore))

  await page.click('.lark-doc-bubble button[aria-label="加粗"]')
  await page.waitForTimeout(420)
  const bolded = await page.evaluate(() => {
    const editor = window.__larkDoc.getEditor()
    const html = editor.getHTML()
    return { active: editor.isActive('bold'), strong: /<strong>/.test(html), html, hidden: !document.querySelector('.lark-doc-bubble') }
  })
  record('[格式] 点「加粗」给选区上 bold', bolded.strong, `strong=${bolded.strong} isActive=${bolded.active} ${bolded.html.slice(0, 70)}`)
  record('[格式] 应用格式后气泡条收起', bolded.hidden)

  // 复制
  await setDoc(page, '<p>复制这段文字到剪贴板</p><p>第二段落用于对照</p>')
  await dragSelect(page, '.ProseMirror p')
  const expectedText = await page.evaluate(() => {
    const { from, to } = window.__larkDoc.getEditor().state.selection
    return window.__larkDoc.getEditor().state.doc.textBetween(from, to, '\n')
  })
  await page.click('.lark-doc-bubble button[aria-label="复制选中文字"]')
  await page.waitForTimeout(320)
  const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''))
  record('[复制] 点「复制选中文字」把选区纯文本写进剪贴板', !!expectedText && clip === expectedText, `期望「${expectedText}」实得「${clip}」`)

  // 高亮 + 取色入口（复制不收起气泡条，选区还在）
  const copyLeftBubble = await bubbleVisible(page)
  await dragSelect(page, '.ProseMirror p')
  const highlightEntry = await page.evaluate(() => ({
    bubble: !!document.querySelector('.lark-doc-bubble'),
    labels: [...document.querySelectorAll('.lark-doc-bubble button')].map((item) => item.getAttribute('aria-label') || item.textContent.trim()),
    button: !!document.querySelector('.lark-doc-bubble button[aria-label="高亮"]'),
    caret: !!document.querySelector('.lark-doc-bubble button[aria-label="选择高亮颜色"]'),
  }))
  record('[高亮] 高亮按钮与取色 caret 都在', highlightEntry.button && highlightEntry.caret,
    `复制后气泡=${copyLeftBubble} 重新划词后=${highlightEntry.bubble} caret=${highlightEntry.caret} 按钮=${highlightEntry.labels.join('|')}`)

  // ——————————————————— ⑦ 只读 ———————————————————
  await setDoc(page, '<p>只读时不该出现气泡条</p><p>第二段落用于对照</p>')
  await page.evaluate(() => { window.__larkDoc.setReadonly(true) })
  await page.waitForTimeout(320)
  await dragSelect(page, '.ProseMirror p')
  const readonlyHidden = await bubbleVisible(page)
  await page.evaluate(() => window.__larkDoc.setReadonly(false))
  await page.waitForTimeout(260)
  record('[只读] 只读状态下划词不弹气泡条', !readonlyHidden, `还可见=${readonlyHidden}`)

  record('无脚本错误', errors.length === 0, errors.slice(0, 3).join(' | '))

  const passed = results.filter((item) => item.ok).length
  console.log(`\n${passed}/${results.length} 项通过`)
  await browser.close()
  process.exit(passed === results.length ? 0 : 1)
})().catch((error) => { console.error(error); process.exit(1) })
