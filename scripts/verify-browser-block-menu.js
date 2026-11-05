'use strict'
/**
 * 浏览器级验证：块句柄 + 块菜单（`editor/BlockHandleMenu.vue`、`blockHandleMixin.js`、
 * `blockMenuMixin.js`）。
 *
 * 阶段 5 批次 3 要把这块从 Vue SFC 换成原生 DOM 片段，本套断言是那批改动的
 * **回归闸门**：改前先跑绿，改完必须仍然全绿，一条都不许「调松」。
 *
 * 为什么这块最难：它同时是「跟随光标的浮层」和「Vue 响应式驱动的一大棵条件树」——
 * 句柄位置在每次 pointermove 重算，菜单分支由 10 个以上 computed 决定。原生化之后
 * 位置来自同步 DOM 读取（比 `$nextTick` 更稳），但**条件分支的段序必须逐条复刻**：
 * 飞书的块菜单是一个固定序列的分段网格，少一段、错一位都算漂移。
 *
 * 量法说明（以实测 + CSS 为准）：
 * - 句柄药丸 `.lark-doc-block-handle-main` 是 **42×26**（`lark-doc.css` 第 643 行），
 *   不是 40×30；左边缘落在「首行文字左边缘 − 42 − 12」处，垂直中心对齐**首行文字行盒中心**。
 * - 菜单宽 **230px**、`position: absolute`（挂在句柄里），子菜单 `position: fixed`
 *   （挂根节点，避免被菜单的 `overflow-y: auto` 裁掉）。
 * - 块菜单**不是** `v-for` 平铺，是「AI / 类型网格 / 副本 / 子菜单触发项 / 表格开关 /
 *   操作列表 / 加正文」的分段结构，段间才插分隔线。断言按段对齐而不是按扁平按钮数。
 *
 * 本脚本只经由 DOM 与公开门面断言，不碰 Vue 实例内部字段，原生化之后同一份断言仍然有效。
 *
 * 依赖：demo dev server（`window.__larkDoc`）。用法：
 *   node scripts/verify-browser-block-menu.js [url]
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

const CONTENT = `
<h1>一级标题样张</h1>
<p>正文段落一，用来量句柄与首行的对齐</p>
<h2>二级标题</h2>
<ul><li><p>无序列表项</p></li></ul>
<ol><li><p>有序列表项</p></li></ol>
<blockquote><p>引用段落</p></blockquote>
<pre><code class="language-js">const answer = 42</code></pre>
<p></p>
<table><tbody><tr><th><p>表头</p></th><th><p>第二列</p></th></tr><tr><td><p>单元格</p></td><td><p>右格</p></td></tr></tbody></table>
`.trim()

// —— 页面内工具函数（必须自包含：会被 page.evaluate 序列化执行） ——

/** 句柄几何 + 内容快照。 */
const measureHandle = () => {
  const handle = document.querySelector('.lark-doc-block-handle')
  if (!handle) return null
  const main = handle.querySelector('.lark-doc-block-handle-main')
  const insert = handle.querySelector('.lark-doc-empty-block-insert')
  const button = main || insert
  const handleRect = handle.getBoundingClientRect()
  const buttonRect = button ? button.getBoundingClientRect() : null
  const type = handle.querySelector('.lark-doc-block-handle-type')
  const dots = handle.querySelector('.lark-doc-block-handle-dots')
  const cs = main ? getComputedStyle(main) : null
  return {
    classes: String(handle.className),
    hasMain: !!main,
    hasInsert: !!insert,
    // 句柄根元素自身的盒（绝对定位，left/top 来自内联样式）
    x: Math.round(handleRect.left),
    y: Math.round(handleRect.top),
    w: Math.round(handleRect.width),
    h: Math.round(handleRect.height),
    button: buttonRect ? { w: Math.round(buttonRect.width), h: Math.round(buttonRect.height), left: Math.round(buttonRect.left), right: Math.round(buttonRect.right), top: Math.round(buttonRect.top), bottom: Math.round(buttonRect.bottom) } : null,
    glyph: type ? (type.textContent || '').trim() : null,
    dots: dots ? (dots.textContent || '').trim() : null,
    insertLabel: insert ? insert.getAttribute('aria-label') : null,
    insertTitle: insert ? insert.getAttribute('title') : null,
    mainLabel: main ? main.getAttribute('aria-label') : null,
    mainTitle: main ? main.getAttribute('title') : null,
    draggable: main ? main.getAttribute('draggable') : null,
    position: getComputedStyle(handle).position,
    zIndex: getComputedStyle(handle).zIndex,
    buttonRadius: cs ? cs.borderTopLeftRadius : null,
    buttonBorder: cs ? cs.borderTopWidth : null,
  }
}

/** 第 index 个顶层块首个可见文字行盒的几何（句柄要对齐它的垂直中心）。 */
const firstLineBox = (index) => {
  const el = document.querySelectorAll('.ProseMirror > *')[index]
  if (!el) return null
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()
  while (node) {
    const value = node.textContent || ''
    const start = value.search(/\S/)
    const end = value.search(/\s*$/)
    if (start >= 0 && end > start) {
      const range = document.createRange()
      range.setStart(node, start)
      range.setEnd(node, end)
      const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0)
      if (rects.length) {
        rects.sort((a, b) => a.top - b.top || a.left - b.left)
        const firstTop = rects[0].top
        const lineRects = rects.filter((rect) => Math.abs(rect.top - firstTop) <= 1)
        return {
          left: Math.min(...lineRects.map((rect) => rect.left)),
          top: Math.min(...lineRects.map((rect) => rect.top)),
          right: Math.max(...lineRects.map((rect) => rect.right)),
          bottom: Math.max(...lineRects.map((rect) => rect.bottom)),
        }
      }
    }
    node = walker.nextNode()
  }
  return null
}

/** 块菜单结构快照：顶层段序 + 分隔线 + 各段按钮清单。 */
const measureBlockMenu = () => {
  const menu = document.querySelector('.lark-doc-block-menu')
  if (!menu) return null
  const rect = menu.getBoundingClientRect()
  const cs = getComputedStyle(menu)
  const segments = [...menu.children].map((node) => {
    if (node.getAttribute('role') === 'separator') return { kind: 'divider' }
    if (node.classList.contains('lark-doc-block-type-actions')) {
      return {
        kind: 'typeGrid',
        role: node.getAttribute('role'),
        label: node.getAttribute('aria-label'),
        columns: getComputedStyle(node).gridTemplateColumns.split(' ').length,
        items: [...node.querySelectorAll('button')].map((button) => ({
          label: button.getAttribute('aria-label'),
          title: button.getAttribute('title'),
          active: button.classList.contains('active'),
          icon: !!button.querySelector('.lark-doc-block-type-icon, svg'),
        })),
      }
    }
    if (node.classList.contains('lark-doc-block-menu-table')) {
      return {
        kind: 'table',
        role: node.getAttribute('role'),
        label: node.getAttribute('aria-label'),
        items: [...node.querySelectorAll('button')].map((button) => ({
          label: button.textContent.trim(),
          role: button.getAttribute('role'),
          checked: button.getAttribute('aria-checked'),
          switchOn: !!button.querySelector('.lark-doc-menu-switch.on'),
          icon: !!button.querySelector('.lark-doc-block-menu-icon, svg'),
        })),
      }
    }
    return {
      kind: 'button',
      cls: String(node.className),
      role: node.getAttribute('role'),
      label: node.getAttribute('aria-label') || node.textContent.trim(),
      title: node.getAttribute('title'),
      active: node.classList.contains('active'),
      expanded: node.getAttribute('aria-expanded'),
      haspopup: node.getAttribute('aria-haspopup'),
      icon: !!node.querySelector('.lark-doc-block-menu-icon, svg'),
      arrow: !!node.querySelector('.lark-doc-block-menu-arrow'),
      switchOn: !!node.querySelector('.lark-doc-menu-switch.on'),
    }
  })
  const aiButton = menu.querySelector('.lark-doc-block-menu-ai')
  return {
    role: menu.getAttribute('role'),
    label: menu.getAttribute('aria-label'),
    position: cs.position,
    overflowY: cs.overflowY,
    w: Math.round(rect.width),
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    right: Math.round(rect.right),
    zIndex: cs.zIndex,
    segments,
    ai: aiButton
      ? {
        label: aiButton.textContent.trim(),
        title: aiButton.getAttribute('title'),
        icon: !!aiButton.querySelector('.lark-doc-block-menu-icon, svg'),
        iconSize: aiButton.querySelector('svg') ? Math.round(aiButton.querySelector('svg').getBoundingClientRect().height) : null,
      }
      : null,
  }
}

/** 子菜单快照（对齐 / 颜色两支），含定位方式与触发项间距。 */
const measureSubmenu = () => {
  const align = document.querySelector('.lark-doc-block-submenu:not(.lark-doc-block-color-submenu)')
  const color = document.querySelector('.lark-doc-block-color-submenu')
  const read = (node) => {
    if (!node) return null
    const rect = node.getBoundingClientRect()
    const cs = getComputedStyle(node)
    return {
      role: node.getAttribute('role'),
      label: node.getAttribute('aria-label'),
      position: cs.position,
      w: Math.round(rect.width),
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      zIndex: cs.zIndex,
      items: [...node.children].map((child) => {
        if (child.getAttribute('role') === 'separator' || child.classList.contains('lark-doc-block-submenu-divider')) return { divider: true }
        return {
          role: child.getAttribute('role'),
          label: child.getAttribute('aria-label') || child.textContent.trim(),
          pressed: child.getAttribute('aria-pressed'),
          disabled: child.disabled,
          active: child.classList.contains('active'),
          check: !!child.querySelector('.lark-doc-block-align-check'),
          help: child.querySelector('.lark-doc-block-align-help')?.textContent.trim() || null,
          swatch: child.querySelector('.lark-doc-block-color-swatch')
            ? getComputedStyle(child.querySelector('.lark-doc-block-color-swatch')).backgroundColor
            : null,
        }
      }),
    }
  }
  return { align: read(align), color: read(color) }
}

/** 悬停高亮遮罩（ProseMirror 节点的兄弟 overlay）。 */
const measureOverlay = () => {
  const overlay = document.querySelector('.lark-doc-heading-hover-overlay')
  if (!overlay) return { exists: false, segments: [], hovered: [] }
  const segments = [...overlay.children].map((node) => {
    const rect = node.getBoundingClientRect()
    const cs = getComputedStyle(node)
    return {
      cls: String(node.className),
      w: Math.round(rect.width),
      h: Math.round(rect.height),
      painted: cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent',
    }
  })
  return {
    exists: true,
    // 必须是 ProseMirror 的兄弟节点（挂在编辑器外层），不能挂在块内部 —— 块内 DOM
    // 会被装饰重建擦掉（见 syncHandleHighlightBackdrop 的注释）。
    sibling: overlay.parentElement === document.querySelector('.ProseMirror')?.parentElement,
    segments,
    hovered: [...document.querySelectorAll('.lark-doc-block-handle-hovered')].map((node) => node.tagName + ':' + (node.textContent || '').slice(0, 10)),
  }
}

// —— 页面操作 ——

/** 把鼠标移到第 index 个顶层块的首行文字上，等句柄出现。 */
async function hoverBlock(page, index) {
  const box = await page.evaluate((i) => {
    const block = document.querySelectorAll('.ProseMirror > *')[i]
    if (!block) return null
    const rect = block.getBoundingClientRect()
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
  }, index)
  if (!box) throw new Error(`第 ${index} 个顶层块不存在`)
  await page.mouse.move(box.left + Math.min(6, box.width / 2), box.top + box.height / 2)
  await page.waitForTimeout(260)
  return box
}

/** 移到句柄上触发 hover 打开块菜单。 */
async function hoverHandle(page, selector = '.lark-doc-block-handle-main') {
  const handle = page.locator(selector).first()
  const handleBox = await handle.boundingBox()
  if (!handleBox) throw new Error('句柄不可见')
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
  await page.waitForTimeout(300)
  return handleBox
}

/** 打开块菜单：悬停目标块 → 悬停句柄。 */
async function openBlockMenu(page, index) {
  await hoverBlock(page, index)
  return hoverHandle(page)
}

const menuOpen = (page) => page.evaluate(() => !!document.querySelector('.lark-doc-block-menu'))

;(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: findChromium() || undefined })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => window.__larkDoc && window.__larkDoc.getEditor && window.__larkDoc.getEditor(), { timeout: 60000 })
  await page.evaluate((html) => {
    window.__larkDoc.setContent(html)
    window.__larkDoc.getEditor().commands.focus('start')
    window.localStorage.removeItem('lark-doc:folds:local')
  }, CONTENT)
  await page.waitForTimeout(500)

  // ——————————————————— ① 句柄 ———————————————————
  await hoverBlock(page, 1)
  const handle = await page.evaluate(measureHandle)
  const line = await page.evaluate(firstLineBox, 1)

  record('[句柄] 悬停正文块出现句柄，绝对定位在纸张内',
    !!handle && handle.position === 'absolute', handle ? `${handle.position} z=${handle.zIndex} @${handle.x},${handle.y}` : '未出现')

  record('[句柄] 药丸按钮 42×26、圆角 6、1px 边框',
    !!handle && !!handle.button && handle.button.w === 42 && handle.button.h === 26 && handle.buttonRadius === '6px' && handle.buttonBorder === '1px',
    handle?.button ? `${handle.button.w}×${handle.button.h} r=${handle.buttonRadius} b=${handle.buttonBorder}` : '无按钮')

  record('[句柄] 紧贴首行文字左侧 12px（句柄右边缘 = 文字左边缘 − 12）',
    !!handle && !!handle.button && !!line && Math.abs(handle.button.right - (line.left - 12)) <= 1,
    handle?.button && line ? `句柄右 ${handle.button.right} / 文字左 ${Math.round(line.left)}` : '')

  record('[句柄] 垂直中心对齐首行文字行盒中心（偏差 ≤1px）',
    !!handle && !!handle.button && !!line && Math.abs((handle.button.top + handle.button.bottom) / 2 - (line.top + line.bottom) / 2) <= 1,
    handle?.button && line
      ? `句柄中心 ${((handle.button.top + handle.button.bottom) / 2).toFixed(1)} / 行盒中心 ${((line.top + line.bottom) / 2).toFixed(1)}`
      : '')

  record('[句柄] 主按钮 aria-label=块操作 / title=块操作与拖动 / draggable=true',
    !!handle && handle.hasMain && handle.mainLabel === '块操作' && handle.mainTitle === '块操作与拖动' && handle.draggable === 'true',
    handle ? `${handle.mainLabel} / ${handle.mainTitle} / draggable=${handle.draggable}` : '')

  record('[句柄] 主按钮由「类型字形 + 拖拽点 ⠿」两段组成',
    !!handle && handle.glyph === 'T' && handle.dots === '⠿', handle ? `${handle.glyph} + ${handle.dots}` : '')

  record('[句柄] 空段落换成「＋」插入按钮（aria-label=插入内容），不给块操作',
    await (async () => {
      await hoverBlock(page, 7)
      const snap = await page.evaluate(measureHandle)
      return !!snap && snap.hasInsert && !snap.hasMain && snap.insertLabel === '插入内容'
    })(),
    await (async () => {
      const snap = await page.evaluate(measureHandle)
      return snap ? `insert=${snap.hasInsert} main=${snap.hasMain} label=${snap.insertLabel}` : '未出现'
    })())

  // 逐块类型量字形：句柄字形必须复刻「块类型 → 字形」映射
  const glyphCases = [
    { index: 0, glyph: 'H1', name: '一级标题' },
    { index: 2, glyph: 'H2', name: '二级标题' },
    { index: 3, glyph: '•', name: '无序列表' },
    { index: 4, glyph: '1≡', name: '有序列表' },
    { index: 5, glyph: '❝', name: '引用' },
    { index: 6, glyph: '{}', name: '代码块' },
    { index: 8, glyph: '▦', name: '表格' },
  ]
  const glyphSeen = []
  let glyphOk = true
  for (const item of glyphCases) {
    await hoverBlock(page, item.index)
    const snap = await page.evaluate(measureHandle)
    const glyph = snap ? snap.glyph : null
    glyphSeen.push(`${item.name}=${glyph}`)
    if (glyph !== item.glyph) glyphOk = false
  }
  record('[句柄] 类型字形逐块复刻（H1/H2/•/1≡/❝/{} /▦）', glyphOk, glyphSeen.join(' '))

  // 悬停高亮遮罩：句柄 hover（或菜单展开）时出现，鼠标移开后连句柄一起消失。
  // 飞书的遮罩就是「句柄可用 = 块被点选目标」的可视提示，跟着句柄走而不是跟着指针走。
  await hoverBlock(page, 1)
  await hoverHandle(page)
  const overlayOn = await page.evaluate(measureOverlay)
  record('[高亮] 句柄悬停出现独立 overlay 遮罩（ProseMirror 的兄弟节点），单段且已上色',
    overlayOn.exists && overlayOn.sibling === true && overlayOn.segments.length === 1 && overlayOn.segments[0].painted && overlayOn.segments[0].h > 10,
    overlayOn.exists
      ? `${overlayOn.segments.length} 段 ${overlayOn.segments[0].w}×${overlayOn.segments[0].h} painted=${overlayOn.segments[0].painted} sibling=${overlayOn.sibling}`
      : '无 overlay')

  // 指针离开句柄：遮罩必须立刻撤掉（否则整块常亮）。句柄本身按 blockHandleMixin 的
  // 口径保留到「指针离开编辑器根节点」（`onDocumentPointerMove`）或下一次落点解析失败
  // （`onEditorPointerMove` → scheduleHandleHide）——demo 页的 `.lark-doc` 铺满视口，
  // 造不出「根节点之外」的指针事件，所以这里只对遮罩下断言，句柄在详情里留痕。
  await page.mouse.move(1430, 880)
  await page.waitForTimeout(900)
  const overlayOff = await page.evaluate(measureOverlay)
  const handleGone = await page.evaluate(() => !document.querySelector('.lark-doc-block-handle'))
  record('[高亮] 指针离开句柄后遮罩撤掉（不留常亮块）',
    !overlayOff.exists, `overlay=${overlayOff.exists} 句柄已撤=${handleGone}`)

  // ——————————————————— ② 块菜单结构 ———————————————————
  await openBlockMenu(page, 1)
  const menu = await page.evaluate(measureBlockMenu)

  record('[菜单] 悬停句柄打开块菜单：role=menu / aria-label=块操作 / 宽 230 / absolute',
    !!menu && menu.role === 'menu' && menu.label === '块操作' && menu.w === 230 && menu.position === 'absolute',
    menu ? `${menu.role}/${menu.label} w=${menu.w} ${menu.position} z=${menu.zIndex}` : '未打开')

  record('[菜单] 类型网格 6 列、9 项、role=group/aria-label=类型转换',
    !!menu && menu.segments.some((segment) => segment.kind === 'typeGrid' && segment.columns === 6 && segment.items.length === 9 && segment.role === 'group' && segment.label === '类型转换'),
    menu ? JSON.stringify(menu.segments.filter((segment) => segment.kind === 'typeGrid').map((segment) => ({ c: segment.columns, n: segment.items.length, role: segment.role, label: segment.label }))) : '')

  const typeGrid = menu ? menu.segments.find((segment) => segment.kind === 'typeGrid') : null
  const expectedTypes = ['正文', '一级标题', '二级标题', '三级标题', '有序列表', '无序列表', '任务列表', '代码块', '引用']
  record('[菜单] 类型项顺序与 blockTypeActions 一致，每项有 aria-label/title/图标',
    !!typeGrid && JSON.stringify(typeGrid.items.map((item) => item.label)) === JSON.stringify(expectedTypes)
    && typeGrid.items.every((item) => item.title === item.label && item.icon),
    typeGrid ? typeGrid.items.map((item) => item.label).join('/') : '')

  record('[菜单] 当前块类型项带 active（正文段落 → 正文高亮）',
    !!typeGrid && typeGrid.items.filter((item) => item.active).map((item) => item.label).join(',') === '正文',
    typeGrid ? `active=${typeGrid.items.filter((item) => item.active).map((item) => item.label).join(',') || '无'}` : '')

  record('[菜单] 首段是「问问 AI」按钮（带 16px 图标）',
    !!menu && !!menu.ai && menu.ai.label.includes('问问 AI') && menu.ai.icon && menu.ai.iconSize === 16,
    menu?.ai ? `${menu.ai.label} icon=${menu.ai.iconSize}px title=${menu.ai.title}` : '无 AI 段')

  // 段序（飞书块菜单的固定分段，见 BlockHandleMenu.vue 的模板顺序）：
  //   AI | — | 类型网格 | 副本 | — | 缩进和对齐 颜色 | — | 操作列表 | — | 在下方添加正文
  // 「—」只在两侧至少有一段内容时出现：类型网格/缩进/颜色在表格分支被摘掉，分隔线跟着走。
  const segmentKinds = menu ? menu.segments.map((segment) => segment.kind === 'divider' ? '|' : segment.kind) : []
  const expectedKinds = ['button', '|', 'typeGrid', 'button', '|', 'button', 'button', '|', 'button', 'button', 'button', 'button', 'button', 'button', '|', 'button']
  record('[菜单] 段序 = 问问AI | 类型网格 | 副本 | 缩进和对齐 颜色 | 操作列表 | 在下方添加正文',
    JSON.stringify(segmentKinds) === JSON.stringify(expectedKinds),
    `${segmentKinds.join(' ')}${JSON.stringify(segmentKinds) === JSON.stringify(expectedKinds) ? '' : `（期望 ${expectedKinds.join(' ')}）`}`)

  const buttonSegments = menu ? menu.segments.filter((segment) => segment.kind === 'button') : []
  record('[菜单] 子菜单触发项声明 aria-haspopup=menu 且初始 aria-expanded=false',
    buttonSegments.filter((segment) => segment.haspopup === 'menu').length === 2
    && buttonSegments.filter((segment) => segment.haspopup === 'menu').every((segment) => segment.expanded === 'false' && segment.arrow),
    buttonSegments.filter((segment) => segment.haspopup === 'menu').map((segment) => `${segment.title}:${segment.expanded}`).join(' '))

  // 操作列表按 blockActions 的声明序渲染（配置禁用的项被过滤、绝不重排）；「创建副本」
  // 单独提到网格下面，不在这个列表里重复。操作项共用 .lark-doc-block-menu-row。
  const actionRows = buttonSegments.filter((segment) => segment.cls.includes('lark-doc-block-menu-row'))
  record('[菜单] 操作列表顺序 = 剪切/复制/翻译/上移区块/下移区块/删除（副本已提到独立按钮）',
    JSON.stringify(actionRows.slice(0, 6).map((segment) => segment.title)) === JSON.stringify(['剪切', '复制', '翻译', '上移区块', '下移区块', '删除'])
    && actionRows.every((segment) => segment.title !== '创建副本'),
    actionRows.map((segment) => segment.title).join('/'))

  record('[菜单] 菜单出现在正文左侧、不溢出视口',
    !!menu && menu.x >= 8 && menu.right <= 1440 - 8 && menu.right <= 640,
    menu ? `x=${menu.x} right=${menu.right} w=${menu.w}` : '')

  // ——————————————————— ③ 子菜单 ———————————————————
  const alignTrigger = await page.evaluate(() => {
    const trigger = [...document.querySelectorAll('.lark-doc-block-submenu-trigger')].find((node) => node.getAttribute('title') === '缩进和对齐')
    if (!trigger) return null
    const rect = trigger.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, right: rect.right, top: rect.top }
  })
  await page.mouse.move(alignTrigger.x, alignTrigger.y)
  await page.waitForTimeout(260)
  const sub = await page.evaluate(measureSubmenu)

  record('[子菜单] 悬停「缩进和对齐」展开 role=menu/aria-label=缩进和对齐 的 fixed 浮层',
    !!sub.align && sub.align.role === 'menu' && sub.align.label === '缩进和对齐' && sub.align.position === 'fixed' && sub.align.w === 230,
    sub.align ? `${sub.align.role}/${sub.align.label} ${sub.align.position} w=${sub.align.w}` : '未展开')

  record('[子菜单] 出现在触发项右侧 5px 处',
    !!sub.align && Math.abs(sub.align.x - (alignTrigger.right + 5)) <= 1,
    sub.align ? `子菜单左 ${sub.align.x} / 期望 ${Math.round(alignTrigger.right + 5)}` : '')

  const alignItems = sub.align ? sub.align.items : []
  record('[子菜单] 结构 = 4 个对齐项 + 分隔线 + 增加缩进 + 减少缩进',
    alignItems.length === 7 && alignItems[4].divider === true
    && alignItems.slice(0, 4).every((item) => item.role === 'menuitem')
    && alignItems[5].label.includes('增加缩进') && alignItems[6].label.includes('减少缩进'),
    alignItems.map((item) => item.divider ? '|' : item.label).join(' '))

  record('[子菜单] 对齐项 aria-pressed 反映当前对齐，且只有选中项带 ✓',
    alignItems.slice(0, 4).map((item) => item.pressed).join(',') === 'true,false,false,false'
    && alignItems.slice(0, 4).filter((item) => item.check).length === 1 && alignItems[0].check === true,
    alignItems.slice(0, 4).map((item) => `${item.label}:${item.pressed}${item.check ? '✓' : ''}`).join(' '))

  // 首块（一级标题）前块不存在 → 缩进上限 0：两个缩进按钮都置灰，增加缩进带 ? 提示。
  // 换个块重开菜单，因为「能否增加缩进」取决于**前一个块**的缩进，不是当前菜单状态。
  await openBlockMenu(page, 0)
  const firstAlignTrigger = await page.evaluate(() => {
    const trigger = [...document.querySelectorAll('.lark-doc-block-submenu-trigger')].find((node) => node.getAttribute('title') === '缩进和对齐')
    if (!trigger) return null
    const rect = trigger.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  })
  await page.mouse.move(firstAlignTrigger.x, firstAlignTrigger.y)
  await page.waitForTimeout(260)
  const firstSub = await page.evaluate(measureSubmenu)
  const firstItems = firstSub.align ? firstSub.align.items : []

  record('[子菜单] 首块「增加缩进」置灰并给出 ? 提示（前块不存在 → 上限 0）',
    !!firstItems[5] && firstItems[5].disabled === true && firstItems[5].help === '?',
    firstItems[5] ? `disabled=${firstItems[5].disabled} help=${firstItems[5].help}` : '无该项')

  record('[子菜单] 「减少缩进」在缩进为 0 时也置灰',
    !!firstItems[6] && firstItems[6].disabled === true, firstItems[6] ? `disabled=${firstItems[6].disabled}` : '无该项')

  // 颜色子菜单：开它会关掉对齐子菜单（互斥）
  const colorTrigger = await page.evaluate(() => {
    const trigger = [...document.querySelectorAll('.lark-doc-block-submenu-trigger')].find((node) => node.getAttribute('title') === '颜色')
    if (!trigger) return null
    const rect = trigger.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  })
  await page.mouse.move(colorTrigger.x, colorTrigger.y)
  await page.waitForTimeout(260)
  const sub2 = await page.evaluate(measureSubmenu)

  record('[子菜单] 悬停「颜色」展开色板：恢复默认 + 9 色，且关掉对齐子菜单（互斥）',
    !!sub2.color && sub2.color.role === 'menu' && sub2.color.label === '颜色' && sub2.color.items.length === 10 && sub2.align === null,
    sub2.color ? `${sub2.color.items.length} 项 align=${sub2.align ? '还在' : '已关'}` : '未展开')

  record('[子菜单] 恢复默认项用透明色块，其余 9 项各有实色 swatch',
    !!sub2.color && sub2.color.items.length === 10
    && sub2.color.items[0].label === '恢复默认颜色' && sub2.color.items[0].swatch === 'rgba(0, 0, 0, 0)'
    && sub2.color.items.slice(1).every((item) => !!item.swatch && item.swatch !== 'rgba(0, 0, 0, 0)'),
    sub2.color ? sub2.color.items.slice(0, 3).map((item) => `${item.label}=${item.swatch}`).join(' ') : '')

  // ——————————————————— ④ 开合与动作 ———————————————————
  // 两条独立关闭路径：Esc（键盘）与点菜单外部（指针）。飞书两者都关。
  await page.keyboard.press('Escape')
  await page.waitForTimeout(220)
  const afterEsc = await menuOpen(page)
  record('[开合] Esc 关闭块菜单', afterEsc === false, `Esc 后=${afterEsc ? '还在' : '已关'}`)

  await openBlockMenu(page, 1)
  await page.mouse.click(200, 860)
  await page.waitForTimeout(300)
  const afterOutside = await menuOpen(page)
  record('[开合] 点菜单外部关闭块菜单', afterOutside === false, `点外部后=${afterOutside ? '还在' : '已关'}`)

  // 点「创建副本」：菜单关闭 + 文档多一块
  const before = await page.evaluate(() => document.querySelectorAll('.ProseMirror > *').length)
  await openBlockMenu(page, 1)
  await page.locator('.lark-doc-block-menu-duplicate').first().click()
  await page.waitForTimeout(320)
  const after = await page.evaluate(() => document.querySelectorAll('.ProseMirror > *').length)
  record('[动作] 点「创建副本」插一块并关闭菜单',
    after === before + 1 && (await menuOpen(page)) === false,
    `${before} → ${after} 菜单=${await menuOpen(page)}`)

  // 空段落句柄不给块菜单（＋ 走「插入内容」命令菜单）。索引动态取：上面「创建副本」
  // 已经插了一块，写死下标会指到别的块上。
  const emptyIndex = await page.evaluate(() => [...document.querySelectorAll('.ProseMirror > *')]
    .findIndex((block) => block.tagName === 'P' && !(block.textContent || '').trim()))
  await hoverBlock(page, emptyIndex)
  const emptySnap = await page.evaluate(measureHandle)
  await page.mouse.move(emptySnap.button.left + 4, emptySnap.button.top + 8)
  await page.waitForTimeout(320)
  const emptyState = await page.evaluate(() => ({
    blockMenu: !!document.querySelector('.lark-doc-block-menu'),
    plusMenu: !!document.querySelector('.lark-doc-command-menu.is-plus'),
  }))
  record('[分支] 空段落句柄只开「插入内容」命令菜单，不给块操作菜单',
    emptyState.blockMenu === false && emptyState.plusMenu === true,
    `块菜单=${emptyState.blockMenu} 插入菜单=${emptyState.plusMenu}`)

  await page.mouse.move(20, 20)
  await page.waitForTimeout(320)

  // ——————————————————— ⑤ 表格分支 ———————————————————
  const tableIndex = await page.evaluate(() => {
    const blocks = [...document.querySelectorAll('.ProseMirror > *')]
    return blocks.findIndex((block) => block.matches('table, .tableWrapper'))
  })
  await openBlockMenu(page, tableIndex)
  const tableMenu = await page.evaluate(measureBlockMenu)
  const tableSegment = tableMenu ? tableMenu.segments.find((segment) => segment.kind === 'table') : null

  record('[表格] 表格块菜单只出表格设置分支（无类型网格 / 无独立副本按钮）',
    !!tableMenu && !tableMenu.segments.some((segment) => segment.kind === 'typeGrid')
    && !tableMenu.segments.some((segment) => segment.kind === 'button' && segment.cls.includes('lark-doc-block-menu-duplicate')),
    tableMenu ? tableMenu.segments.map((segment) => segment.kind).join(' ') : '未打开')

  record('[表格] 表格设置组 role=group/aria-label=表格设置，含 标题行 / 标题列 / 均分列宽',
    !!tableSegment && tableSegment.role === 'group' && tableSegment.label === '表格设置'
    && JSON.stringify(tableSegment.items.map((item) => item.label)) === JSON.stringify(['标题行', '标题列', '均分列宽']),
    tableSegment ? tableSegment.items.map((item) => item.label).join('/') : '')

  record('[表格] 两个开关是 menuitemcheckbox，aria-checked 与开关状态一致',
    !!tableSegment && tableSegment.items[0].role === 'menuitemcheckbox' && tableSegment.items[1].role === 'menuitemcheckbox'
    && tableSegment.items[0].checked === 'true' && tableSegment.items[0].switchOn === true,
    tableSegment ? tableSegment.items.slice(0, 2).map((item) => `${item.label}:${item.checked}/${item.switchOn}`).join(' ') : '')

  // 点「标题行」→ 关掉表头行，菜单保持展开（飞书同款）
  await page.locator('.lark-doc-block-menu-row').first().click()
  await page.waitForTimeout(420)
  const flipped = await page.evaluate(measureBlockMenu)
  const flippedSegment = flipped ? flipped.segments.find((segment) => segment.kind === 'table') : null
  record('[表格] 点「标题行」翻转 aria-checked，且菜单保持展开',
    !!flipped && !!flippedSegment && flippedSegment.items[0].checked === 'false' && flippedSegment.items[0].switchOn === false,
    flippedSegment ? `checked=${flippedSegment.items[0].checked} switch=${flippedSegment.items[0].switchOn} 菜单=${flipped ? '在' : '关了'}` : '菜单被关掉了')

  // ——————————————————— ⑥ 只读 ———————————————————
  await page.evaluate(() => { window.__larkDoc.setReadonly(true) })
  await page.waitForTimeout(400)
  await hoverBlock(page, 1)
  const readonlyHandle = await page.evaluate(() => !!document.querySelector('.lark-doc-block-handle'))
  const readonlyMenu = await page.evaluate(() => !!document.querySelector('.lark-doc-block-menu'))
  record('[只读] 只读态不渲染块句柄、也不开块菜单', readonlyHandle === false && readonlyMenu === false, `句柄=${readonlyHandle} 菜单=${readonlyMenu}`)

  record('无脚本错误', errors.length === 0, errors.slice(0, 3).join(' | '))

  await browser.close()
  const failed = results.filter((result) => !result.ok).length
  console.log(`\n${results.length - failed}/${results.length} 项通过`)
  process.exit(failed ? 1 : 0)
})().catch((error) => {
  console.error(error)
  process.exit(1)
})
