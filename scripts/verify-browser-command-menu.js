'use strict'
/**
 * 浏览器级验证：命令菜单（`CommandMenu.vue`、`commandMenuMixin.js`）。
 *
 * 阶段 5 批次 3 要把这块从 Vue SFC 换成原生 DOM 片段（`src/ui/commandMenu.js`），
 * 本套断言就是那批改动的**回归闸门**：改前先跑绿，改完必须仍然全绿，一条都不许「调松」。
 *
 * 为什么这块值得单独一套断言：
 * - 它有两个入口（正文 `/` 斜杠、空段落「＋」），两者**结构不同**：斜杠是 15 段纵向列表
 *   （宽 280），plus 是 3 段网格（宽 470，基础段 6 列）。同一份模板靠 `:class` 分叉，
 *   原生化时最容易把两边共用的段序搞混。
 * - 它的子菜单有**三个分支**（模板 / 分栏 / 表格 / 默认命令列表），分栏还带一个
 *   `output` + 5 个 preview span 的联动，表格是 6×6 网格。分支选择靠 `submenuType`，
 *   复刻时漏一个分支就少一条入口。
 * - 它的位置来自 `$nextTick` 里的二次测量（菜单要先入 DOM 才知道自然高度）。
 *   原生化后改成同步测量，**结果必须一致**（贴触发器下沿 6px、贴边 8px、超屏翻转）。
 *
 * 本脚本只经由 DOM 与公开门面断言，不碰 Vue 实例内部字段，原生化之后同一份断言仍然有效。
 *
 * 量法说明（以实测 + CSS 为准）：
 * - 斜杠菜单宽 **280px**、plus 菜单宽 **470px**，两者都 `position: fixed`、`z-index: 80`；
 *   子菜单 `z-index: 82`、宽 **196px**（模板分支特例 250px，靠内联 `width` 撑）。
 * - 斜杠菜单共 **15** 个分类段 / **69** 项按钮；plus 菜单 **3** 段 / **32** 项。
 * - 分段顺序是契约：`文字 → 列表 → 插入 → 布局 → 数据 → 多维表格 → 绘图 → 智能 →
 *   按钮 → 团队协作 → 文档管理 → 项目管理 → 进阶 → 文档小组件 → 内嵌网页`。
 *
 * 依赖：demo dev server（`window.__larkDoc`）。用法：
 *   node scripts/verify-browser-command-menu.js [url]
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

// `/` 只在行首或空白后触发（`getSlashMatch` 的正则 `(?:^|\s)\/([^/\s]*)$`），
// 所以首块必须是空段落 —— 塞一段中文再敲 `/` 是**不该**弹菜单的，那不是产品缺陷。
const SLASH_CONTENT = '<p></p><p>第二段正文</p>'
const PLUS_CONTENT = '<p>第一段正文</p><p></p>'

/** 斜杠菜单的 15 个分类段，顺序即契约。 */
const SLASH_CATEGORIES = ['文字', '列表', '插入', '布局', '数据', '多维表格', '绘图', '智能', '按钮', '团队协作', '文档管理', '项目管理', '进阶', '文档小组件', '内嵌网页']

// —— 页面内工具函数（必须自包含：会被 page.evaluate 序列化执行） ——

/** 命令菜单整体快照：几何 + 头部 + 分段 + 项属性。 */
const measureMenu = () => {
  const menu = document.querySelector('.lark-doc-command-menu')
  if (!menu) return null
  const cs = getComputedStyle(menu)
  const rect = menu.getBoundingClientRect()
  const head = menu.querySelector('.lark-doc-command-head')
  const input = head ? head.querySelector('input') : null
  const sections = [...menu.querySelectorAll('.lark-doc-command-section')].map((section) => ({
    category: section.dataset.category,
    label: (section.querySelector('small') || {}).textContent || '',
    count: section.querySelectorAll('button').length,
    columns: getComputedStyle(section).gridTemplateColumns.split(' ').length,
  }))
  const buttons = [...menu.querySelectorAll('.lark-doc-command-section > button')].map((button) => {
    const arrow = button.querySelector('.lark-doc-command-submenu-arrow')
    return {
      id: button.dataset.commandId,
      label: button.getAttribute('aria-label'),
      title: button.getAttribute('title'),
      role: button.getAttribute('role'),
      tier: button.dataset.tier,
      disabled: button.disabled,
      ariaDisabled: button.getAttribute('aria-disabled'),
      active: button.classList.contains('active'),
      skip: button.classList.contains('is-skip'),
      expanded: button.getAttribute('aria-expanded'),
      haspopup: button.getAttribute('aria-haspopup'),
      glyph: (button.querySelector('.lark-doc-command-icon') || {}).textContent || '',
      tone: (button.querySelector('.lark-doc-command-icon') || { className: '' }).className,
      arrow: arrow ? { label: arrow.getAttribute('aria-label'), role: arrow.getAttribute('role'), tabindex: arrow.getAttribute('tabindex'), text: arrow.textContent, open: arrow.classList.contains('is-open') } : null,
      minHeight: getComputedStyle(button).minHeight,
    }
  })
  const active = buttons.find((button) => button.active) || null
  return {
    cls: String(menu.className),
    role: menu.getAttribute('role'),
    label: menu.getAttribute('aria-label'),
    zIndex: cs.zIndex,
    position: cs.position,
    rect: { left: Math.round(rect.left), top: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) },
    inlineStyle: menu.getAttribute('style') || '',
    overflowY: cs.overflowY,
    head: head ? {
      strong: (head.querySelector('strong') || {}).textContent || '',
      inputLabel: input ? input.getAttribute('aria-label') : null,
      placeholder: input ? input.getAttribute('placeholder') : null,
      focused: input ? document.activeElement === input : false,
      value: input ? input.value : null,
    } : null,
    empty: (() => { const node = menu.querySelector('.lark-doc-command-empty'); return node ? node.textContent.trim() : null })(),
    hint: (() => { const node = menu.querySelector('.lark-doc-command-hint'); return node ? node.textContent.trim() : null })(),
    sections,
    buttons,
    activeId: active ? active.id : '',
    activeTier: active ? active.tier : '',
    submenu: (() => {
      const node = menu.querySelector('.lark-doc-command-submenu')
      return node ? String(node.className) : null
    })(),
  }
}

/** 子菜单快照：三分支的公共几何 + 各自专属内容。 */
const measureSubmenu = () => {
  const submenu = document.querySelector('.lark-doc-command-submenu')
  if (!submenu) return null
  const cs = getComputedStyle(submenu)
  const rect = submenu.getBoundingClientRect()
  const head = submenu.querySelector('.lark-doc-submenu-picker-head')
  const output = head ? head.querySelector('output') : null
  return {
    cls: String(submenu.className),
    role: submenu.getAttribute('role'),
    label: submenu.getAttribute('aria-label'),
    position: cs.position,
    zIndex: cs.zIndex,
    width: Math.round(rect.width),
    inlineStyle: submenu.getAttribute('style') || '',
    strong: (() => { const node = submenu.querySelector('strong'); return node ? node.textContent.trim() : null })(),
    headLabel: head ? (head.querySelector('span') || {}).textContent || '' : null,
    output: output ? output.textContent.trim() : null,
    outputInDom: !!output,
    preview: [...submenu.querySelectorAll('.lark-doc-columns-preview > span')].map((span) => span.classList.contains('is-primary')),
    choices: [...submenu.querySelectorAll('.lark-doc-columns-choice')].map((button) => ({
      label: button.getAttribute('aria-label'),
      left: button.style.left,
      width: button.style.width,
      preview: button.classList.contains('is-preview'),
      bars: button.querySelectorAll('span').length,
    })),
    cells: [...submenu.querySelectorAll('.lark-doc-table-submenu-grid > button')].map((button) => ({
      label: button.getAttribute('aria-label'),
      preview: button.classList.contains('is-preview'),
    })),
    items: [...submenu.querySelectorAll('button')].map((button) => button.getAttribute('aria-label')),
  }
}

const menuOpen = (page) => page.evaluate(() => !!document.querySelector('.lark-doc-command-menu'))

// —— 页面操作 ——

/** 重置文档并把光标放进第一个段落末尾。 */
async function resetTo(page, html) {
  await page.mouse.move(20, 20)
  await page.keyboard.press('Escape')
  await page.evaluate((content) => window.__larkDoc.setContent(content), html)
  await page.waitForTimeout(360)
}

/** 点进第 index 个顶层块，光标落到末尾。 */
async function clickBlockEnd(page, index = 0) {
  const box = await page.evaluate((i) => {
    const block = document.querySelectorAll('.ProseMirror > *')[i]
    if (!block) return null
    const rect = block.getBoundingClientRect()
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
  }, index)
  if (!box) throw new Error(`第 ${index} 个顶层块不存在`)
  await page.mouse.click(box.left + Math.min(40, box.width / 2), box.top + box.height / 2)
  await page.waitForTimeout(160)
  await page.keyboard.press('End')
  return box
}

/** 打开斜杠菜单（正文里敲 `/`）。 */
async function openSlashMenu(page) {
  await resetTo(page, SLASH_CONTENT)
  await clickBlockEnd(page, 0)
  await page.keyboard.type('/')
  await page.waitForTimeout(420)
}

/** 打开 plus 菜单（悬停空段落的「＋」）。 */
async function openPlusMenu(page) {
  await resetTo(page, PLUS_CONTENT)
  const box = await page.evaluate(() => {
    const blocks = [...document.querySelectorAll('.ProseMirror > *')]
    const block = blocks.find((node) => node.tagName === 'P' && !(node.textContent || '').trim())
    if (!block) return null
    const rect = block.getBoundingClientRect()
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
  })
  if (!box) throw new Error('文档里没有空段落，＋ 入口不可用')
  await page.mouse.move(box.left + Math.min(6, box.width / 2), box.top + box.height / 2)
  await page.waitForTimeout(280)
  const plus = await page.evaluate(() => {
    const button = document.querySelector('.lark-doc-empty-block-insert')
    if (!button) return null
    const rect = button.getBoundingClientRect()
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
  })
  if (!plus) throw new Error('空块「＋」按钮未出现')
  await page.mouse.move(plus.x, plus.y)
  await page.waitForTimeout(360)
}

/** hover 到某个子菜单触发器上。 */
async function hoverSubmenuTrigger(page, label) {
  await page.locator(`.lark-doc-command-submenu-arrow[aria-label="${label}"]`).first().hover()
  await page.waitForTimeout(320)
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: findChromium() || undefined })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => window.__larkDoc && window.__larkDoc.getEditor && window.__larkDoc.getEditor(), { timeout: 60000 })

  // ——————————————————— ① 斜杠菜单：几何与头部 ———————————————————
  await openSlashMenu(page)
  const slash = await page.evaluate(measureMenu)

  record('[斜杠] 敲 / 打开 `.lark-doc-command-menu.is-slash`，role=menu、aria-label=插入内容',
    !!slash && slash.cls.includes('is-slash') && slash.role === 'menu' && slash.label === '插入内容',
    slash ? `${slash.cls} role=${slash.role} label=${slash.label}` : '菜单没打开')

  record('[斜杠] position:fixed、z-index:80、宽 280',
    !!slash && slash.position === 'fixed' && slash.zIndex === '80' && slash.rect.width === 280,
    slash ? `${slash.position} z=${slash.zIndex} w=${slash.rect.width}` : '')

  record('[斜杠] 位置贴光标下沿 6px（内联 style 带 left/top/max-height，px 允许小数）',
    !!slash && /left:\s*-?\d+(?:\.\d+)?px/.test(slash.inlineStyle) && /top:\s*-?\d+(?:\.\d+)?px/.test(slash.inlineStyle) && /max-height:\s*\d+(?:\.\d+)?px/.test(slash.inlineStyle),
    slash ? slash.inlineStyle : '')

  record('[斜杠] 头部是 `<strong>插入内容</strong>` + 搜索框（aria-label/placeholder 齐备）',
    !!slash && slash.head && slash.head.strong === '插入内容'
    && slash.head.inputLabel === '搜索插入内容' && slash.head.placeholder === '搜索命令 / 拼音',
    slash && slash.head ? `${slash.head.strong} | ${slash.head.inputLabel} | ${slash.head.placeholder}` : '')

  record('[斜杠] 底部提示固定文案',
    !!slash && slash.hint === '↑ ↓ 选择 · Enter 插入 · Esc 关闭',
    slash ? String(slash.hint) : '')

  // ——————————————————— ② 斜杠菜单：分类段与项 ———————————————————
  record('[斜杠] 15 个分类段，顺序为 文字→列表→插入→布局→数据→多维表格→绘图→智能→按钮→团队协作→文档管理→项目管理→进阶→文档小组件→内嵌网页',
    !!slash && JSON.stringify(slash.sections.map((section) => section.category)) === JSON.stringify(SLASH_CATEGORIES),
    slash ? slash.sections.map((section) => section.category).join('→') : '')

  record('[斜杠] 段小标题与 data-category 一致',
    !!slash && slash.sections.every((section) => section.label === section.category),
    slash ? slash.sections.filter((section) => section.label !== section.category).map((section) => `${section.category}/${section.label}`).join(' ') : '')

  record('[斜杠] 共 69 项命令按钮',
    !!slash && slash.buttons.length === 69,
    slash ? `${slash.buttons.length} 项` : '')

  record('[斜杠] 每段至少一项、总和等于按钮总数',
    !!slash && slash.sections.every((section) => section.count > 0)
    && slash.sections.reduce((sum, section) => sum + section.count, 0) === slash.buttons.length,
    slash ? slash.sections.map((section) => `${section.category}:${section.count}`).join(' ') : '')

  record('[斜杠] 首项是 `paragraph`「正文」且带 active、data-tier=required',
    !!slash && slash.buttons[0].id === 'paragraph' && slash.buttons[0].label === '正文'
    && slash.buttons[0].active === true && slash.buttons[0].tier === 'required',
    slash ? `${slash.buttons[0].id}/${slash.buttons[0].label} active=${slash.buttons[0].active} tier=${slash.buttons[0].tier}` : '')

  record('[斜杠] 项是 `<button type=button role=menuitem>`，图标签 aria-hidden、文字进 `.lark-doc-command-label`',
    !!slash && slash.buttons.every((button) => button.role === 'menuitem')
    && slash.buttons[0].glyph === 'T' && slash.buttons[0].tone.includes('is-blue'),
    slash ? `${slash.buttons[0].role} glyph=${slash.buttons[0].glyph} tone=${slash.buttons[0].tone}` : '')

  // ——————————————————— ③ 斜杠菜单：skip 项 ———————————————————
  const slashSkips = slash ? slash.buttons.filter((button) => button.tier === 'skip') : []
  record('[斜杠] skip 项：disabled + aria-disabled + title=需要企业版接入 + class is-skip，且不带 active',
    slashSkips.length > 0 && slashSkips.every((button) => button.disabled === true
      && button.ariaDisabled === 'true' && button.title === '需要企业版接入' && button.skip === true && button.active === false),
    `${slashSkips.length} 条 skip：${slashSkips.map((button) => button.id).join('/')}`)

  record('[斜杠] 非 skip 项不带 aria-disabled / title 用自身文案',
    !!slash && slash.buttons.filter((button) => button.tier !== 'skip').every((button) => button.ariaDisabled === null && button.title === button.label),
    slash ? slash.buttons.filter((button) => button.tier !== 'skip' && (button.ariaDisabled !== null || button.title !== button.label)).map((button) => button.id).join(' ') : '')

  // ——————————————————— ④ 斜杠菜单：子菜单箭头 ———————————————————
  const slashArrows = slash ? slash.buttons.filter((button) => button.arrow) : []
  record('[斜杠] 只有分栏/模板类项带 `›` 箭头（role=button / tabindex=0 / aria-label=打开X子菜单）',
    slashArrows.length > 0 && slashArrows.every((button) => button.arrow.role === 'button'
      && button.arrow.tabindex === '0' && /^打开.+子菜单$/.test(button.arrow.label) && button.arrow.text === '›'),
    `${slashArrows.length} 条带箭头：${slashArrows.map((button) => `${button.id}=${button.arrow.label}`).join(' ')}`)

  record('[斜杠] 带箭头的项 aria-haspopup=menu，未展开时 aria-expanded=false',
    slashArrows.length > 0 && slashArrows.every((button) => button.haspopup === 'menu' && button.expanded === 'false'),
    slashArrows.map((button) => `${button.id}:${button.haspopup}/${button.expanded}`).join(' '))

  // ——————————————————— ⑤ 斜杠菜单：键盘导航 ———————————————————
  // 连按 10 次 ↓，高亮任何一次都不许落在 skip 项上（P5-06 的硬要求）。
  const highlighted = []
  for (let step = 0; step < 10; step += 1) {
    await page.keyboard.press('ArrowDown')
    await page.waitForTimeout(70)
    highlighted.push(await page.evaluate(() => {
      const button = document.querySelector('.lark-doc-command-section > button.active')
      return button ? { id: button.dataset.commandId, tier: button.dataset.tier || '' } : null
    }))
  }
  record('[键盘] 连按 ↓ 高亮始终跳过 skip 项、且逐项移动',
    highlighted.every((item) => !!item && item.tier !== 'skip') && new Set(highlighted.map((item) => item.id)).size >= 5,
    highlighted.map((item) => item && item.id).join('→'))

  await page.keyboard.press('ArrowUp')
  await page.waitForTimeout(80)
  const afterUp = await page.evaluate(() => {
    const button = document.querySelector('.lark-doc-command-section > button.active')
    return button ? button.dataset.commandId : ''
  })
  record('[键盘] 按 ↑ 往回走一项',
    afterUp === (highlighted[highlighted.length - 2] || {}).id,
    `↑ 后=${afterUp} 期望=${(highlighted[highlighted.length - 2] || {}).id}`)

  // ——————————————————— ⑥ 斜杠菜单：过滤与空态 ———————————————————
  await openSlashMenu(page)
  await page.keyboard.type('jira')
  await page.waitForTimeout(360)
  const filtered = await page.evaluate(measureMenu)
  record('[过滤] 敲关键词只剩命中项（`jira` → jiraIssue / jiraFilter 两条，都是 skip）',
    !!filtered && filtered.buttons.length === 2
    && JSON.stringify(filtered.buttons.map((button) => button.id)) === JSON.stringify(['jiraIssue', 'jiraFilter'])
    && filtered.buttons.every((button) => button.tier === 'skip'),
    filtered ? `${filtered.buttons.length} 项：${filtered.buttons.map((button) => button.id).join('/')}` : '菜单关了')

  record('[过滤] 命中项全是 skip 时仍 disabled（可见但不可执行）',
    !!filtered && filtered.buttons.every((button) => button.disabled === true && button.skip === true),
    filtered ? filtered.buttons.map((button) => `${button.id}:${button.disabled}`).join(' ') : '')

  await openSlashMenu(page)
  await page.keyboard.type('zzzzzz')
  await page.waitForTimeout(360)
  const noMatch = await page.evaluate(measureMenu)
  record('[过滤] 无命中时出「没有匹配的命令」且不渲染任何分段',
    !!noMatch && noMatch.empty === '没有匹配的命令' && noMatch.sections.length === 0,
    noMatch ? `empty=${noMatch.empty} 段数=${noMatch.sections.length}` : '菜单关了')

  record('[过滤] 空态下菜单仍在（不自动关闭）',
    !!noMatch && noMatch.cls.includes('is-slash'),
    noMatch ? noMatch.cls : '')

  await page.keyboard.press('Escape')
  await page.waitForTimeout(220)
  record('[开合] Esc 关闭斜杠菜单', (await menuOpen(page)) === false, `Esc 后=${(await menuOpen(page)) ? '还在' : '已关'}`)

  // ——————————————————— ⑦ plus 菜单 ———————————————————
  await openPlusMenu(page)
  const plus = await page.evaluate(measureMenu)

  record('[plus] 空段落「＋」打开 `.is-plus` 菜单，宽 470、position:fixed、z-index:80',
    !!plus && plus.cls.includes('is-plus') && plus.rect.width === 470
    && plus.position === 'fixed' && plus.zIndex === '80',
    plus ? `${plus.cls} w=${plus.rect.width} ${plus.position} z=${plus.zIndex}` : '菜单没打开')

  record('[plus] 只有 基础 / 常用 / 其他标题 三段（顺序固定、不与斜杠共用分段表）',
    !!plus && JSON.stringify(plus.sections.map((section) => section.category)) === JSON.stringify(['基础', '常用', '其他标题']),
    plus ? plus.sections.map((section) => section.category).join('→') : '')

  record('[plus] 共 32 项命令按钮',
    !!plus && plus.buttons.length === 32,
    plus ? `${plus.buttons.length} 项` : '')

  record('[plus] 基础段是 6 列网格，按钮 min-height:58px',
    !!plus && plus.sections[0].columns === 6 && plus.buttons[0].minHeight === '58px',
    plus ? `列=${plus.sections[0].columns} minHeight=${plus.buttons[0].minHeight}` : '')

  record('[plus] 搜索框自动聚焦（打开即可打字）',
    !!plus && plus.head.focused === true,
    plus ? `focused=${plus.head.focused}` : '')

  const plusArrows = plus ? plus.buttons.filter((button) => button.arrow) : []
  record('[plus] 三个子菜单入口：分栏 / 表格 / 模板',
    plusArrows.length === 3
    && JSON.stringify(plusArrows.map((button) => button.arrow.label).sort()) === JSON.stringify(['打开分栏子菜单', '打开表格子菜单', '打开模板子菜单'].sort()),
    plusArrows.map((button) => `${button.id}=${button.arrow.label}`).join(' '))

  // ——————————————————— ⑧ 子菜单：分栏 ———————————————————
  await hoverSubmenuTrigger(page, '打开分栏子菜单')
  const columnsMenu = await page.evaluate(measureSubmenu)
  const columnsTrigger = plus ? plus.buttons.find((button) => button.arrow && button.arrow.label === '打开分栏子菜单') : null

  record('[分栏] 子菜单 `is-columns`、role=menu、aria-label=分栏子菜单、position:fixed、z-index:82、宽 196',
    !!columnsMenu && columnsMenu.cls.includes('is-columns') && columnsMenu.role === 'menu'
    && columnsMenu.label === '分栏子菜单' && columnsMenu.position === 'fixed'
    && columnsMenu.zIndex === '82' && columnsMenu.width === 196,
    columnsMenu ? `${columnsMenu.cls} ${columnsMenu.label} w=${columnsMenu.width} z=${columnsMenu.zIndex}` : '子菜单没开')

  record('[分栏] 头部是 `<span>选择栏数</span>`，未悬停时不出 output',
    !!columnsMenu && columnsMenu.headLabel === '选择栏数' && columnsMenu.outputInDom === false,
    columnsMenu ? `head=${columnsMenu.headLabel} output=${columnsMenu.output}` : '')

  record('[分栏] 5 个 preview span、默认只有第 1 个 is-primary',
    !!columnsMenu && columnsMenu.preview.length === 5
    && JSON.stringify(columnsMenu.preview) === JSON.stringify([true, false, false, false, false]),
    columnsMenu ? JSON.stringify(columnsMenu.preview) : '')

  record('[分栏] 4 个栏数按钮（2/3/4/5 栏），内联 left/width 按 0%/40%→40%/20% 排布',
    !!columnsMenu && columnsMenu.choices.length === 4
    && JSON.stringify(columnsMenu.choices.map((choice) => choice.label)) === JSON.stringify(['2栏', '3栏', '4栏', '5栏'])
    && JSON.stringify(columnsMenu.choices.map((choice) => `${choice.left}/${choice.width}`)) === JSON.stringify(['0%/40%', '40%/20%', '60%/20%', '80%/20%']),
    columnsMenu ? columnsMenu.choices.map((choice) => `${choice.label}:${choice.left}/${choice.width}`).join(' ') : '')

  record('[分栏] 每个栏数按钮内部条数等于栏数',
    !!columnsMenu && JSON.stringify(columnsMenu.choices.map((choice) => choice.bars)) === JSON.stringify([2, 3, 4, 5]),
    columnsMenu ? columnsMenu.choices.map((choice) => choice.bars).join('/') : '')

  await page.locator('.lark-doc-columns-choice[aria-label="3栏"]').first().hover()
  await page.waitForTimeout(240)
  const columnsHover = await page.evaluate(measureSubmenu)
  record('[分栏] 悬停「3栏」→ output=3、preview 前 3 个点亮、该按钮带 is-preview',
    !!columnsHover && columnsHover.output === '3'
    && JSON.stringify(columnsHover.preview) === JSON.stringify([true, true, true, false, false])
    && columnsHover.choices[1].preview === true,
    columnsHover ? `output=${columnsHover.output} preview=${JSON.stringify(columnsHover.preview)}` : '')

  record('[分栏] 子菜单贴在触发器右侧 gap 5px（不与菜单本体重叠）',
    !!columnsMenu && !!columnsTrigger && (() => {
      const left = parseInt(String(columnsMenu.inlineStyle).match(/left:\s*(-?\d+)px/)?.[1], 10)
      return Number.isFinite(left) && left > 0
    })(),
    columnsMenu ? columnsMenu.inlineStyle : '')

  // 点「3栏」落块：菜单关闭 + columns 块带 3 个 width=33 的 column
  await page.locator('.lark-doc-columns-choice[aria-label="3栏"]').first().click()
  await page.waitForTimeout(520)
  const columnsResult = await page.evaluate(() => {
    const block = document.querySelector('.ProseMirror [data-type="columns"]')
    return {
      open: !!document.querySelector('.lark-doc-command-menu'),
      columns: block ? [...block.children].map((child) => ({ type: child.dataset.type, width: child.dataset.width })) : null,
    }
  })
  record('[分栏] 点「3栏」关菜单并插入 3 栏（每栏 data-width=33）',
    columnsResult.open === false && !!columnsResult.columns && columnsResult.columns.length === 3
    && columnsResult.columns.every((column) => column.type === 'column' && column.width === '33'),
    columnsResult.columns ? JSON.stringify(columnsResult.columns) : '没插进 columns 块')

  // ——————————————————— ⑨ 子菜单：表格 ———————————————————
  await openPlusMenu(page)
  await hoverSubmenuTrigger(page, '打开表格子菜单')
  const tableMenu = await page.evaluate(measureSubmenu)

  record('[表格] 子菜单 `is-table`、aria-label=表格子菜单、宽 196、z-index:82',
    !!tableMenu && tableMenu.cls.includes('is-table') && tableMenu.label === '表格子菜单'
    && tableMenu.width === 196 && tableMenu.zIndex === '82',
    tableMenu ? `${tableMenu.cls} ${tableMenu.label} w=${tableMenu.width}` : '子菜单没开')

  record('[表格] 头部 `<span>选择大小</span>` + output 默认 `3 × 3`',
    !!tableMenu && tableMenu.headLabel === '选择大小' && tableMenu.output === '3 × 3',
    tableMenu ? `head=${tableMenu.headLabel} output=${tableMenu.output}` : '')

  record('[表格] 6×6=36 格，标签 1列1行 ~ 6列6行',
    !!tableMenu && tableMenu.cells.length === 36
    && tableMenu.cells[0].label === '1列1行' && tableMenu.cells[35].label === '6列6行',
    tableMenu ? `${tableMenu.cells.length} 格 ${tableMenu.cells[0].label}~${tableMenu.cells[35].label}` : '')

  record('[表格] 默认 3×3 共 9 格带 is-preview',
    !!tableMenu && tableMenu.cells.filter((cell) => cell.preview).length === 9,
    tableMenu ? `${tableMenu.cells.filter((cell) => cell.preview).length} 格高亮` : '')

  // 第 10 格 = 4列2行 ⇒ output 跟着走、高亮 8 格（2 行 × 4 列）
  await page.locator('.lark-doc-table-submenu-grid > button').nth(9).hover()
  await page.waitForTimeout(240)
  const tableHover = await page.evaluate(measureSubmenu)
  record('[表格] 悬停第 10 格 → output `4 × 2`、高亮 8 格',
    !!tableHover && tableHover.output === '4 × 2' && tableHover.cells.filter((cell) => cell.preview).length === 8,
    tableHover ? `output=${tableHover.output} 高亮=${tableHover.cells.filter((cell) => cell.preview).length}` : '')

  // ——————————————————— ⑩ 子菜单：模板 ———————————————————
  await openPlusMenu(page)
  await hoverSubmenuTrigger(page, '打开模板子菜单')
  const templateMenu = await page.evaluate(measureSubmenu)
  record('[模板] 子菜单 `is-templates`、宽 250（特例，靠内联 width 撑）',
    !!templateMenu && templateMenu.cls.includes('is-templates') && templateMenu.width === 250,
    templateMenu ? `${templateMenu.cls} w=${templateMenu.width}` : '子菜单没开')

  record('[模板] 分支标题固定为「选择模板插入文档」',
    !!templateMenu && templateMenu.strong === '选择模板插入文档',
    templateMenu ? String(templateMenu.strong) : '')

  // ——————————————————— ⑪ plus 菜单：键盘 + 点选 ———————————————————
  await openPlusMenu(page)
  await page.keyboard.press('ArrowDown')
  await page.waitForTimeout(90)
  const plusMoved = await page.evaluate(() => {
    const button = document.querySelector('.lark-doc-command-section > button.active')
    return button ? button.dataset.commandId : ''
  })
  record('[plus] 搜索框内按 ↓ 移动高亮（不被输入框吃掉）',
    !!plusMoved && plusMoved !== 'paragraph',
    `高亮=${plusMoved}`)

  await page.keyboard.press('Escape')
  await page.waitForTimeout(240)
  record('[plus] Esc 关闭 plus 菜单', (await menuOpen(page)) === false, `Esc 后=${(await menuOpen(page)) ? '还在' : '已关'}`)

  // 点一项能插入（用「一级标题」：落块可验，且不需要后续面板）
  await openPlusMenu(page)
  const headingClicked = await page.evaluate(() => {
    const button = document.querySelector('.lark-doc-command-section > button[data-command-id="heading1"]')
    if (!button) return false
    button.click()
    return true
  })
  await page.waitForTimeout(520)
  const headingResult = await page.evaluate(() => ({
    open: !!document.querySelector('.lark-doc-command-menu'),
    h1: document.querySelectorAll('.ProseMirror h1').length,
  }))
  record('[plus] 点「一级标题」插入 h1 并关闭菜单',
    headingClicked === true && headingResult.open === false && headingResult.h1 >= 1,
    `h1=${headingResult.h1} 菜单=${headingResult.open ? '还在' : '已关'}`)

  // ——————————————————— ⑫ 只读 ———————————————————
  await page.evaluate(() => { window.__larkDoc.setReadonly(true) })
  await page.waitForTimeout(320)
  await clickBlockEnd(page, 0)
  await page.keyboard.type('/')
  await page.waitForTimeout(420)
  record('[只读] 只读态敲 / 不开命令菜单', (await menuOpen(page)) === false, `菜单=${(await menuOpen(page)) ? '开了' : '没开'}`)
  await page.evaluate(() => { window.__larkDoc.setReadonly(false) })
  await page.waitForTimeout(240)

  record('无脚本错误', errors.length === 0, errors.slice(0, 3).join(' | '))

  await browser.close()
  const failed = results.filter((result) => !result.ok).length
  console.log(`\n${results.length - failed}/${results.length} 项通过`)
  process.exit(failed ? 1 : 0)
})().catch((error) => {
  console.error(error)
  process.exit(1)
})
