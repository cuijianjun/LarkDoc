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
  const installed = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  if (process.platform === 'darwin' && fs.existsSync(installed)) return installed
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
    glyph: type ? (type.querySelector('.sr-only')?.textContent || '').trim() : null,
    icon: type ? {
      name: type.querySelector('[data-icon]')?.dataset.icon,
      svg: !!type.querySelector('svg'),
      size: Math.round(type.querySelector('[data-icon]')?.getBoundingClientRect().width || 0),
    } : null,
    // 六点用 path 画（不是 6 个 <circle>）：按 d 里每个圆点一段 a1.75 1.75 来数
    dots: dots ? {
      text: (dots.textContent || '').trim(),
      svg: !!dots.querySelector('svg'),
      circles: dots.querySelectorAll('circle').length,
      pathDots: ((dots.querySelector('path')?.getAttribute('d') || '').match(/a1\.75 1\.75/g) || []).length,
    } : null,
    insertLabel: insert ? insert.getAttribute('aria-label') : null,
    insertTitle: insert ? insert.getAttribute('title') : null,
    mainLabel: main ? main.getAttribute('aria-label') : null,
    mainTitle: main ? main.getAttribute('title') : null,
    mainNoTip: main ? main.hasAttribute('data-tooltip-none') : false,
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
          iconWidth: button.querySelector('svg')?.getBoundingClientRect().width || 0,
          iconHeight: button.querySelector('svg')?.getBoundingClientRect().height || 0,
          symbolWidth: button.querySelector('.lark-doc-block-type-symbol')?.getBoundingClientRect().width || 0,
          symbolHeight: button.querySelector('.lark-doc-block-type-symbol')?.getBoundingClientRect().height || 0,
          hitHeight: button.getBoundingClientRect().height,
          borderWidth: getComputedStyle(button).borderTopWidth,
          background: getComputedStyle(button).backgroundColor,
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
async function hoverHandle(page, selector = '.lark-doc-block-handle:not(.lark-doc-block-handle-secondary) .lark-doc-block-handle-main') {
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
  const table = await page.locator('.ProseMirror > *').nth(index).evaluate(node => node.matches('table,.tableWrapper'))
  return hoverHandle(page, table ? '[data-block-scope="table"]' : undefined)
}

const menuOpen = (page) => page.evaluate(() => !!document.querySelector('.lark-doc-block-menu'))


async function verifyTableScopes(page) {
  const fixture = '<p>before table</p><table><tbody><tr><td><p>A1</p><p>A-next</p></td><td><p>B1</p></td></tr><tr><td><p>A2</p></td><td><p>B2</p></td></tr></tbody></table><p>after table</p>'
  const menu = () => page.locator('.lark-doc-block-menu')
  const cells = () => page.locator('.ProseMirror td,.ProseMirror th')
  const reset = async () => {
    const viewport = page.viewportSize()
    await page.mouse.move(viewport.width - 20, viewport.height - 20)
    await page.evaluate(html => { window.__larkDoc.setContent(html); scrollTo(0, 0) }, fixture)
  }
  const open = async (scope, value = 'A1') => {
    const target = cells().locator('p').filter({ hasText: new RegExp('^' + value + '$') }).first()
    await target.click({ position: { x: 5, y: 9 } })
    await target.hover({ position: { x: 6, y: 10 } })
    await page.locator('[data-block-scope="' + scope + '"]').waitFor()
    await hoverHandle(page, '[data-block-scope="' + scope + '"]')
    await menu().waitFor()
  }
  const action = label => menu().getByRole('menuitem', { name: label, exact: true }).click()
  const text = () => page.evaluate(() => window.__larkDoc.getText())
  await reset()
  await open('cell')
  record('[双句柄] 当前内容块与整表句柄各一个', await page.locator('[data-block-scope="cell"]').count() === 1 && await page.locator('[data-block-scope="table"]').count() === 1)
  const geometry = await page.evaluate(() => {
    const table = document.querySelector('.ProseMirror table').getBoundingClientRect()
    const whole = document.querySelector('[data-block-scope="table"]').getBoundingClientRect()
    const cell = document.querySelector('[data-block-scope="cell"]').getBoundingClientRect()
    const p = document.querySelector('.ProseMirror td p'), range = document.createRange()
    range.selectNodeContents(p)
    const ink = range.getBoundingClientRect()
    return { table: table.toJSON(), whole: whole.toJSON(), cell: cell.toJSON(), ink: ink.toJSON() }
  })
  record('[双句柄] 整表位于左上外侧，内容句柄对齐首行', geometry.whole.right <= geometry.table.left && geometry.whole.bottom <= geometry.table.top + 1 && Math.abs((geometry.cell.top + geometry.cell.bottom - geometry.ink.top - geometry.ink.bottom) / 2) <= 2, JSON.stringify(geometry))
  record('[单元格菜单] 类型转换可见，整表设置不混入', await menu().locator('.lark-doc-block-type-actions button').count() === 10 && await menu().getByRole('group', { name: '表格设置' }).count() === 0)
  record('[单元格高亮] 仅高亮内容块，不高亮整表', await cells().first().locator('p').first().evaluate(n => n.classList.contains('lark-doc-block-handle-hovered')) && !await page.locator('.ProseMirror table').evaluate(n => n.classList.contains('lark-doc-block-handle-hovered')))
  for (const scope of ['table', 'cell']) {
    const button = await page.locator('[data-block-scope="' + scope + '"]').boundingBox()
    await page.mouse.click(button.x + button.width / 2, button.y + button.height / 2)
    const tableMenu = await menu().getByRole('group', { name: '表格设置' }).count() === 1
    record('[双句柄点击] 已展开菜单时仍可直接点' + scope + '句柄切换', scope === 'table' ? tableMenu : !tableMenu && await menu().locator('.lark-doc-block-type-actions button').count() === 10)
  }
  // Each handle is keyboard focusable; Enter opens the focused scope.
  if (process.argv.includes('--keyboard-only')) await page.evaluate(() => {
    window.__handleKeyEvents = []
    for (const type of ['focus', 'mouseenter', 'pointermove', 'keydown']) document.addEventListener(type, e => {
      if (e.target.matches?.('.lark-doc-block-handle-main') || type === 'keydown') window.__handleKeyEvents.push({ type, scope: e.target.dataset?.blockScope, key: e.key, movementX: e.movementX, movementY: e.movementY, active: document.activeElement.dataset?.blockScope })
    }, true)
  })
  await page.locator('[data-block-scope="table"]').focus(); await page.keyboard.press('Enter')
  const keyboardTable = await page.evaluate(() => ({ scope: document.activeElement.dataset.blockScope, active: document.activeElement.outerHTML.slice(0, 180), table: !!document.querySelector('.lark-doc-block-menu [aria-label="表格设置"]'), events: window.__handleKeyEvents }))
  record('[双句柄键盘] 聚焦整表后Enter仍打开整表菜单', keyboardTable.table && keyboardTable.scope === 'table', JSON.stringify(keyboardTable))
  await page.locator('[data-block-scope="cell"]').focus(); await page.keyboard.press('Enter')
  record('[双句柄键盘] 聚焦内容后Enter仍打开内容菜单', await menu().locator('.lark-doc-block-type-actions button').count() === 10 && await page.evaluate(() => document.activeElement.dataset.blockScope === 'cell'))
  await hoverHandle(page, '[data-block-scope="table"]')
  record('[双句柄键鼠切换] 键盘持焦后真实移动鼠标可切整表', await menu().getByRole('group', { name: '表格设置' }).count() === 1)
  await hoverHandle(page, '[data-block-scope="cell"]')
  record('[双句柄键鼠切换] 真实移动鼠标可再切回内容块', await menu().locator('.lark-doc-block-type-actions button').count() === 10)
  if (process.argv.includes('--keyboard-only')) return
  await action('复制')
  await page.waitForFunction(async () => (await navigator.clipboard.readText()).trim() === 'A1')
  record('[单元格复制] 剪贴板仅包含当前块', (await page.evaluate(() => navigator.clipboard.readText())).trim() === 'A1')

  for (const label of ['剪切', '删除', '在下方添加']) {
    await reset(); await open('cell'); await action(label)
    // plus 菜单不含「正文」（新块默认即正文），插的是一级标题：格内块序列变为 A1 / 空 h1 / A-next
    if (label === '在下方添加') await page.locator('.lark-doc-command-menu [data-command-id="heading1"]').click()
    if (label === '剪切') await page.waitForFunction(() => !window.__larkDoc.getText().includes('A1'))
    const values = await cells().first().locator('p, h1').allTextContents()
    const ok = label === '在下方添加' ? values.length === 3 && values[1] === '' : values.join('/') === 'A-next'
    record('[单元格操作] ' + label + '保持整表及相邻格', ok && await page.locator('.ProseMirror table').count() === 1 && await cells().nth(1).innerText() === 'B1', values.join('/'))
    await page.keyboard.press('ControlOrMeta+z')
    record('[单元格撤销] ' + label + '恢复块且表结构有效', await cells().first().locator('p').allTextContents().then(rows => rows.join('/') === 'A1/A-next') && await page.evaluate(() => { window.__larkDoc.getEditor().state.doc.check(); return true }))
  }
  await reset(); await open('cell')
  await menu().getByRole('menuitem', { name: '二级标题', exact: true }).click()
  record('[单元格转换] 二级标题只改变当前内容块', await cells().first().locator('h2').innerText() === 'A1' && await cells().nth(1).innerText() === 'B1')
  await reset(); await open('table')
  record('[整表菜单] 只展示表格设置，不展示正文转换', await menu().getByRole('group', { name: '表格设置' }).count() === 1 && await menu().locator('.lark-doc-block-type-actions').count() === 0)
  await menu().getByRole('menuitemcheckbox', { name: '标题行', exact: true }).click()
  record('[整表设置] 标题行开关保持菜单与双句柄', await page.locator('.ProseMirror th').count() === 2 && await menu().isVisible() && await page.locator('[data-block-scope="cell"]').count() === 1)
  await menu().getByRole('menuitemcheckbox', { name: '标题列', exact: true }).click()
  record('[整表设置] 标题列开关保持内容', await page.locator('.ProseMirror th').count() === 3 && (await text()).includes('B2'))

  await reset()
  await page.evaluate(() => {
    const editor = window.__larkDoc.getEditor(), tr = editor.state.tr
    let index = 0
    editor.state.doc.descendants((node, pos) => { if (node.type.name === 'tableCell') tr.setNodeMarkup(pos, null, { ...node.attrs, colwidth: [index++ % 2 ? 180 : 80] }) })
    editor.view.dispatch(tr)
  })
  await open('table'); await action('均分列宽')
  const widths = await page.locator('.ProseMirror col').evaluateAll(nodes => nodes.map(n => parseFloat(n.style.width)))
  record('[整表设置] 均分作用于整表所有列', widths.length === 2 && Math.abs(widths[0] - widths[1]) < 1, widths.join('/'))
  await reset(); await open('table')
  record('[整表菜单] 不显示额外的副本与上下移动入口', !/创建副本|上移区块|下移区块/.test(await menu().innerText()))
  await open('table'); await action('删除')
  record('[整表删除] 仅移除整表，前后文保留', await page.locator('.ProseMirror table').count() === 0 && (await text()).includes('before table') && (await text()).includes('after table'))
  await page.keyboard.press('ControlOrMeta+z')
  record('[整表删除] 一次撤销恢复完整表格', await page.locator('.ProseMirror table').count() === 1 && (await text()).includes('A-next'))
  await reset(); await open('cell'); await page.keyboard.press('Escape')
  const beforeReadonly = await page.evaluate(() => JSON.stringify(window.__larkDoc.getJSON()))
  await page.evaluate(() => window.__larkDoc.setReadonly(true))
  record('[双句柄只读] 两种句柄全部消失，正文不变', await page.locator('[data-block-scope]').count() === 0 && await page.evaluate(before => JSON.stringify(window.__larkDoc.getJSON()) === before, beforeReadonly))
}

async function verifyBlockSubmenuClickTargets(page, width, height = 782) {
  const viewport = page.viewportSize()
  const undoKey = await page.evaluate(() => navigator.platform.includes('Mac') ? 'Meta+z' : 'Control+z')
  const backup = await page.evaluate(() => ({ json: window.__larkDoc.getJSON(), open: window.__larkDoc._handle.nativeHost.host.outlineOpen }))
  const results = []
  try {
    await page.setViewportSize({ width, height })
    for (const label of ['缩进和对齐', '颜色']) {
      await page.keyboard.press('Escape')
      await page.evaluate(() => {
        const doc = window.__larkDoc, host = doc._handle.nativeHost.host
        host.closeBlockMenu()
        if (host.outlineOpen) host.toggleOutlineOpen()
        doc.setContent('<h4>已有层级</h4><p>目标正文</p><p>尾文</p>')
        window.scrollTo(0, 0)
      })
      const before = await page.evaluate(() => JSON.stringify(window.__larkDoc.getJSON()))
      await page.locator('.ProseMirror > p').first().hover()
      await page.locator('.lark-doc-block-handle-main:visible').first().click()
      const trigger = page.locator('.lark-doc-block-menu').getByRole('menuitem', { name: label, exact: true })
      // A click includes mouseenter first: the newly opened submenu must not intercept pointerdown.
      await trigger.click({ timeout: 2000 })
      const menu = page.getByRole('menu', { name: label, exact: true })
      const box = await menu.boundingBox(), target = await trigger.boundingBox()
      const overlaps = box.x < target.x + target.width && box.x + box.width > target.x && box.y < target.y + target.height && box.y + box.height > target.y
      if (overlaps || box.x < 7 || box.y < 7 || box.x + box.width > width - 7 || box.y + box.height > height - 7) throw new Error(`子菜单遮挡/越界：${label} ${width}×${height}`)
      const resized = []
      if (width === 360 && height === 320) {
        await menu.locator('button').first().focus()
        for (const [nextWidth, nextHeight] of [[1024, 480], [360, 320]]) {
          await page.setViewportSize({ width: nextWidth, height: nextHeight })
          await page.waitForTimeout(100)
          const reopened = !await menu.count()
          if (reopened) {
            await page.locator('.ProseMirror > p').first().hover()
            await page.locator('.lark-doc-block-handle-main:visible').first().click()
            await trigger.click({ timeout: 2000 })
          }
          const next = await menu.boundingBox(), anchor = await trigger.boundingBox()
          if (!next || next.x < 7 || next.y < 7 || next.x + next.width > nextWidth - 7 || next.y + next.height > nextHeight - 7 || next.x < anchor.x + anchor.width && next.x + next.width > anchor.x && next.y < anchor.y + anchor.height && next.y + next.height > anchor.y) throw new Error(`保持打开并调整窗口后越界/遮挡：${label}`)
          resized.push({ width: nextWidth, height: nextHeight, menuHeight: next.height, reopened })
        }
      }
      if (label === '缩进和对齐') {
        await menu.getByText('居中对齐', { exact: true }).click({ timeout: 2000 })
        if (await page.locator('.ProseMirror > p').first().evaluate(e => getComputedStyle(e).textAlign) !== 'center') throw new Error('居中对齐未应用')
      } else {
        await menu.locator('button').nth(1).click({ timeout: 2000 })
        const applied = await page.evaluate(() => window.__larkDoc.getEditor().state.doc.child(1).firstChild.marks.some(mark => mark.type.name === 'textStyle' && mark.attrs.color))
        if (!applied) throw new Error('颜色未应用到目标正文')
      }
      await page.locator('.ProseMirror').press(undoKey)
      const undo = await page.evaluate(saved => JSON.stringify(window.__larkDoc.getJSON()) === saved, before)
      if (!undo) throw new Error(`子菜单撤销未恢复原文：${label}`)
      results.push({ label, width, height, overlaps, applied: true, undo, resized })
    }
    return results
  } finally {
    await page.keyboard.press('Escape')
    await page.evaluate(saved => {
      const doc = window.__larkDoc, host = doc._handle.nativeHost.host
      host.closeBlockMenu(); doc.setContent(saved.json)
      if (host.outlineOpen !== saved.open) host.toggleOutlineOpen()
    }, backup)
    if (viewport) await page.setViewportSize(viewport)
  }
}

async function verifySiblingMenusV58(page, width = 1536, mode = 'standard', section = 'block') {
  const viewport = page.viewportSize()
  const saved = await page.evaluate(() => { const d = window.__larkDoc, h = d._handle.nativeHost.host; return { json: d.getJSON(), mode: h.widthMode, outline: h.outlineOpen } })
  const undo = await page.evaluate(() => navigator.platform.includes('Mac') ? 'Meta+z' : 'Control+z')
  const rows = []
  let fontSurface
  const json = () => page.evaluate(() => JSON.stringify(window.__larkDoc.getJSON()))
  const parent = page.getByRole('menu', { name: '块操作', exact: true })
  const openBlock = async () => { await page.locator('.ProseMirror li p').hover(); await page.locator('.lark-doc-block-handle-main:visible').first().hover(); await parent.waitFor() }
  const openInsert = async () => {
    const insert = page.locator('.lark-doc-toolbar').getByRole('button', { name: '插入', exact: true })
    if (!await page.locator('.lark-doc-command-menu').isVisible()) {
      if (await insert.isVisible()) await insert.click()
      else { await page.locator('.lark-doc-toolbar').getByRole('button', { name: '更多', exact: true }).click(); await page.getByRole('menuitem', { name: '插入内容…', exact: true }).click() }
    }
    await page.locator('.lark-doc-command-menu').waitFor()
    await page.locator('.lark-doc-command-menu [data-command-id="template"]').hover()
    await page.locator('.lark-doc-command-submenu.is-templates').waitFor()
  }
  try {
    await page.keyboard.press('Escape')
    await page.setViewportSize({ width: 1536, height: 782 })
    await page.getByRole('combobox', { name: '页面宽度', exact: true }).click()
    await page.getByRole('listbox', { name: '页面宽度', exact: true }).getByRole('option', { name: mode === 'full' ? '通栏' : '标准', exact: true }).click()
    if (await page.evaluate(() => window.__larkDoc._handle.nativeHost.host.outlineOpen)) await page.getByRole('button', { name: '收起目录', exact: true }).click()
    if (section === 'template') {
      await page.getByRole('combobox', { name: '字体', exact: true }).click()
      fontSurface = await page.getByRole('listbox', { name: '字体', exact: true }).evaluate(e => { const s = getComputedStyle(e), b = getComputedStyle(e.querySelector('button')); return { border: s.borderWidth, padding: s.padding, radius: s.borderRadius, shadow: s.boxShadow, background: s.backgroundColor, rowPadding: b.padding, rowRadius: b.borderRadius, rowFont: b.fontSize, rowHeight: e.querySelector('button').getBoundingClientRect().height } })
      await page.keyboard.press('Escape')
    }
    await page.setViewportSize({ width, height: 782 }); await page.waitForTimeout(250)
    if (section.startsWith('block')) {
      await page.evaluate(() => window.__larkDoc.setContent('<p>前文</p><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>目标任务</p></li></ul><p>尾文</p>'))
      const before = await json(); await openBlock()
      const names = await parent.locator('.lark-doc-block-type-actions button').evaluateAll(ns => ns.map(n => n.getAttribute('aria-label')))
      const targets = names.map(name => [name, parent.locator('.lark-doc-block-type-actions').getByRole('menuitem', { name, exact: true })])
      targets.push(['AI', parent.locator('.lark-doc-block-menu-ai')], ['复制', parent.locator('[data-block-action="copy"]')], ['禁用评论', parent.locator('[data-block-action="comment"]')])
      for (const label of (section.includes(':') ? [section.split(':')[1]] : ['缩进和对齐', '颜色'])) {
        const trigger = parent.getByRole('menuitem', { name: label, exact: true })
        const panel = page.getByRole('menu', { name: label, exact: true })
        const openChild = async () => {
          const p = await parent.boundingBox(), t = await trigger.boundingBox()
          await page.mouse.move(p.x + p.width - 2, t.y + t.height / 2)
          await trigger.hover(); await panel.waitFor()
        }
        for (const [name, target] of targets) {
          await openChild()
          const targetBox = await target.boundingBox(), box = await panel.boundingBox(), parentBox = await parent.boundingBox()
          const occluded = targetBox.x + targetBox.width / 2 >= box.x && targetBox.x + targetBox.width / 2 <= box.x + box.width && targetBox.y + targetBox.height / 2 >= box.y && targetBox.y + targetBox.height / 2 <= box.y + box.height
          if (occluded) { await page.mouse.move(parentBox.x + parentBox.width - 2, targetBox.y + targetBox.height / 2) }
          await target.hover()
          if (await panel.count() || !await parent.isVisible() || await json() !== before) throw Error('普通项悬停未收起子菜单或改变正文：' + label + '/' + name)
          rows.push({ label, target: name, input: 'pointer', viaParentEdge: occluded, closed: true })
        }
        for (const name of [names[0], '复制']) {
          await openChild()
          const target = parent.getByRole('menuitem', { name, exact: true })
          await target.focus()
          if (await panel.count() || !await target.evaluate(n => n === document.activeElement)) throw Error('主菜单焦点丢失或子菜单残留：' + label + '/' + name)
          rows.push({ label, target: name, input: 'focus setup', focusKept: true, closed: true })
        }
        await openChild()
        if (await parent.locator('[title]').count()) throw Error('块菜单残留原生title')
        const choice = label === '缩进和对齐' ? panel.getByText('居中对齐', { exact: true }) : panel.locator('button').nth(1)
        await choice.hover(); await page.waitForTimeout(200)
        if (!await panel.isVisible()) throw Error('移入子菜单被误关闭：' + label)
        const hint = await choice.evaluate(e => ({ title: e.getAttribute('title'), pseudo: getComputedStyle(e, '::after').content }))
        if (hint.title || !['none', 'normal'].includes(hint.pseudo)) throw Error('子菜单仍有原生/CSS提示：' + JSON.stringify(hint))
        await choice.click()
        const applied = await page.evaluate(label => { let applied = false; window.__larkDoc.getEditor().state.doc.descendants(n => { if (label === '缩进和对齐' && n.isTextblock && n.textContent === '目标任务') applied = n.attrs.textAlign === 'center'; if (label === '颜色' && n.isText && n.text === '目标任务') applied = n.marks.some(m => m.type.name === 'textStyle' && m.attrs.color) }); return applied }, label)
        if (!applied) throw Error('子菜单实际操作未应用：' + label)
        await page.keyboard.press(undo)
        if (await json() !== before) throw Error('子菜单实际操作不能一次撤销')
        rows.push({ label, enterPanel: true, applied: true, undo: true })
        await openBlock()
      }
      await parent.getByRole('menuitem', { name: '在下方添加', exact: true }).hover()
      await page.locator('.lark-doc-command-menu').waitFor()
      const target = parent.locator('.lark-doc-block-type-actions button').first()
      await target.focus()
      if (await page.locator('.lark-doc-command-menu').count() || !await parent.isVisible() || !await target.evaluate(n => n === document.activeElement) || await json() !== before) throw Error('下方添加返回主菜单残留或丢失焦点')
      rows.push({ footerReturn: true, input: 'focus setup', parentAndFocusKept: true })
    } else if (section === 'template') {
      await page.evaluate(() => window.__larkDoc.setContent('<p>模板验收原文</p>'))
      const before = await json()
      await openInsert()
      const panel = page.locator('.lark-doc-command-submenu.is-templates')
      const style = await panel.evaluate(e => { const s = getComputedStyle(e); return { width: e.getBoundingClientRect().width, border: s.borderWidth, padding: s.padding, radius: s.borderRadius, shadow: s.boxShadow, background: s.backgroundColor, box: e.getBoundingClientRect().toJSON() } })
      if (style.width > 250.1 || style.border !== '1px' || style.padding !== fontSurface.padding || style.shadow !== fontSurface.shadow || style.radius !== fontSurface.radius || style.background !== fontSurface.background || style.box.x < 7 || style.box.y < 7 || style.box.right > width - 7 || style.box.bottom > 775) throw Error('模板子菜单没有采用共用外观/视口边界：' + JSON.stringify(style))
      const enabled = panel.locator('button:not(:disabled)').first()
      await enabled.hover()
      const hover = await enabled.evaluate(e => ({ background: getComputedStyle(e).backgroundColor, padding: getComputedStyle(e).padding, radius: getComputedStyle(e).borderRadius, fontSize: getComputedStyle(e).fontSize, height: e.getBoundingClientRect().height }))
      if (hover.background === 'rgba(0, 0, 0, 0)' || Math.abs(hover.height - fontSurface.rowHeight) > 1 || hover.padding !== fontSurface.rowPadding || hover.radius !== fontSurface.rowRadius || hover.fontSize !== fontSurface.rowFont) throw Error('模板悬停高亮或行高缺失')
      await enabled.focus(); await page.keyboard.press('Tab')
      if (!await panel.evaluate(e => e.contains(document.activeElement) && !document.activeElement.disabled)) throw Error('模板键盘焦点离开菜单或落在禁用项')
      rows.push({ fontSurface, style, hover, tabWithinPanel: true })
      const expected = await page.evaluate(() => window.__larkDoc._handle.nativeHost.host.templates.filter(t => typeof t.html === 'string').map(t => { const d = new DOMParser().parseFromString(t.html, 'text/html'); return { label: t.label || t.title || t.id, text: (d.body.querySelector('h1,h2,h3,h4,h5,h6,p,li')?.textContent || d.body.textContent || '').trim().slice(0, 12) } }))
      for (const template of expected) {
        await openInsert()
        await panel.getByRole('menuitem', { name: template.label, exact: true }).click()
        await page.waitForFunction(() => !document.querySelector('.lark-doc-command-submenu.is-templates'))
        const text = await page.evaluate(() => window.__larkDoc.getText())
        if (!text.includes('模板验收原文') || template.text && !text.includes(template.text)) throw Error('模板正文未实际插入：' + template.label)
        await page.keyboard.press(undo)
        if (await json() !== before) throw Error('模板不能一次撤销：' + template.label)
        rows.push({ template: template.label, inserted: true, undo: true })
      }
      await openInsert()
      const disabled = panel.locator('button:disabled')
      if (await disabled.count()) { await disabled.first().hover(); if (await disabled.first().getAttribute('aria-disabled') !== 'true' || await json() !== before) throw Error('禁用模板状态错误') }
      await page.locator('.lark-doc-command-menu [data-entry-key="常用:callout"]').hover()
      if (await panel.count()) throw Error('模板切回普通项仍残留')
      await openInsert(); await panel.getByRole('menuitem', { name: '更多模板', exact: true }).click()
      await page.locator('.lark-doc-template-library').waitFor()
      await page.keyboard.press('Escape')
      if (await page.locator('.lark-doc-template-library').count() || await json() !== before) throw Error('更多模板关闭残留或改变正文')
      rows.push({ disabledPreserved: true, siblingClose: true, moreLibraryOpenCancel: true })
    } else {
      await page.evaluate(() => window.__larkDoc.setContent('<p>提示验收正文</p><p></p>'))
      const before = await json()
      for (const name of ['字体', '字号']) {
        await page.getByRole('combobox', { name, exact: true }).click()
        const menu = page.getByRole('listbox', { name, exact: true })
        const option = name === '字体' ? menu.getByRole('option', { name: 'Arial', exact: true }) : menu.getByRole('option').last()
        await option.hover(); await page.waitForTimeout(220)
        if (await page.locator('[role="tooltip"]:visible').count()) throw Error('下拉选项黑色tips残留：' + name)
        await page.keyboard.press('Escape')
        rows.push({ dropdown: name, noBlackTip: true })
      }
      await page.locator('.ProseMirror > p').last().hover()
      await page.locator('.lark-doc-empty-block-insert:visible').hover()
      await page.locator('.lark-doc-command-menu [data-command-id="code"]').first().hover()
      await page.waitForTimeout(220)
      if (await page.locator('[role="tooltip"]:visible').count()) throw Error('插入菜单黑色tips残留')
      await page.keyboard.press('Escape')
      await page.locator('.lark-doc-toolbar').getByRole('button', { name: '加粗', exact: true }).hover()
      await page.getByRole('tooltip').waitFor()
      if (!(await page.getByRole('tooltip').innerText()).includes('加粗') || await json() !== before) throw Error('弹窗外图标提示被误删或正文改变')
      await page.mouse.move(width - 2, 780)
      rows.push({ insertionNoBlackTip: true, outsideBoldHintKept: true, documentUnchanged: true })
      await page.evaluate(() => window.__larkDoc.setContent('<p><strong>SELECTTARGET</strong> tail</p>'))
      const beforeBubble = await json()
      await page.locator('.ProseMirror strong').dblclick({ position: { x: 5, y: 8 } })
      await page.locator('.lark-doc-bubble:visible').waitFor()
      await page.locator('.lark-doc-bubble-align-trigger').hover()
      const align = page.locator('.lark-doc-bubble-align-menu')
      const center = align.getByText('居中对齐', { exact: true })
      await center.hover(); await page.waitForTimeout(220)
      const hint = await center.evaluate(e => ({ title: e.getAttribute('title'), pseudo: getComputedStyle(e, '::after').content }))
      if (hint.title || !['none', 'normal'].includes(hint.pseudo) || await align.locator('[title]').count()) throw Error('划词对齐菜单仍有原生/CSS提示')
      await center.click(); await page.keyboard.press(undo)
      if (await json() !== beforeBubble) throw Error('划词对齐移除提示后撤销异常')
      rows.push({ bubbleNoCssOrNativeHint: true, appliedAndUndo: true })
    }
    return rows
  } catch (error) { throw new Error(error.message + '; completed=' + rows.length) }
  finally {
    await page.keyboard.press('Escape')
    await page.evaluate(s => { const d = window.__larkDoc, h = d._handle.nativeHost.host; h.closeBlockMenu(); d.setContent(s.json); h.setWidthMode(s.mode); if (h.outlineOpen !== s.outline) h.toggleOutlineOpen() }, saved)
    if (viewport) await page.setViewportSize(viewport)
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true, chromiumSandbox: true, executablePath: findChromium() || undefined })
  const context = await browser.newContext({ viewport: process.argv.includes('--narrow') ? { width: 1000, height: 723 } : { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => window.__larkDoc && window.__larkDoc.getEditor && window.__larkDoc.getEditor(), { timeout: 60000 })
  if (process.argv.includes('--submenu-v58')) {
    try {
      for (const [width, mode] of [[1536, 'standard'], [1536, 'full'], [360, 'full']]) for (const section of (width < 500 ? ['block', 'template'] : ['block', 'template', 'tips'])) {
        const rows = await verifySiblingMenusV58(page, width, mode, section)
        record(`[v58] ${section} ${width}px ${mode}`, rows.length > 0, JSON.stringify(rows))
      }
      record('v58 无脚本错误', errors.length === 0, errors.join(' | '))
    } finally { await browser.close() }
    process.exitCode = results.every(item => item.ok) ? 0 : 1
    return
  }
  if (process.argv.includes('--table-scopes-only')) {
    try { await verifyTableScopes(page); record('表格双句柄无浏览器脚本错误', errors.length === 0, errors.join(' | ')) }
    finally { await browser.close() }
    console.log(`RESULT ${results.filter(item => item.ok).length}/${results.length}`)
    process.exitCode = results.every(item => item.ok) ? 0 : 1
    return
  }
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

  record('[句柄] 主按钮 aria-label=块操作 / 无原生 title / data-tooltip-none / draggable=true',
    !!handle && handle.hasMain && handle.mainLabel === '块操作' && !handle.mainTitle && handle.mainNoTip && handle.draggable === 'true',
    handle ? `${handle.mainLabel} / title=${handle.mainTitle} / noTip=${handle.mainNoTip} / draggable=${handle.draggable}` : '')

  record('[句柄] 主按钮由「18px 类型 SVG + 飞书六点 SVG」两段组成',
    !!handle && handle.glyph === 'T' && handle.icon?.name === 'block-text' && handle.icon.svg && handle.icon.size === 18
      && handle.dots?.svg === true && handle.dots.pathDots === 6,
    handle ? `${JSON.stringify(handle.icon)} + svg=${handle.dots?.svg} pathDots=${handle.dots?.pathDots}（circle=${handle.dots?.circles}）` : '')

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

  // 可见图形必须是语义 SVG，兼容字形只留在 sr-only 无障碍文案。
  const glyphCases = [
    { index: 0, glyph: 'H1', icon: 'block-h1', name: '一级标题' },
    { index: 2, glyph: 'H2', icon: 'block-h2', name: '二级标题' },
    { index: 3, glyph: '•', icon: 'block-bullet', name: '无序列表' },
    { index: 4, glyph: '1≡', icon: 'block-ordered', name: '有序列表' },
    { index: 5, glyph: '❝', icon: 'block-quote', name: '引用' },
    { index: 6, glyph: '{}', icon: 'block-code', name: '代码块' },
    { index: 8, glyph: '▦', icon: 'block-table', name: '表格' },
  ]
  const glyphSeen = []
  let glyphOk = true
  for (const item of glyphCases) {
    await hoverBlock(page, item.index)
    if (item.icon === 'block-table') await hoverHandle(page, '[data-block-scope="table"]')
    const snap = await page.evaluate(measureHandle)
    const glyph = snap ? snap.glyph : null
    glyphSeen.push(`${item.name}=${snap?.icon?.name}`)
    if (glyph !== item.glyph || snap?.icon?.name !== item.icon || !snap?.icon?.svg || snap?.icon?.size !== 18) glyphOk = false
  }
  record('[句柄] 标题、列表、引用、代码及表格均使用对应18px语义SVG', glyphOk, glyphSeen.join(' '))

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

  record('[菜单] 类型网格 6 列、10 项、role=group/aria-label=类型转换',
    !!menu && menu.segments.some((segment) => segment.kind === 'typeGrid' && segment.columns === 6 && segment.items.length === 10 && segment.role === 'group' && segment.label === '类型转换'),
    menu ? JSON.stringify(menu.segments.filter((segment) => segment.kind === 'typeGrid').map((segment) => ({ c: segment.columns, n: segment.items.length, role: segment.role, label: segment.label }))) : '')

  const typeGrid = menu ? menu.segments.find((segment) => segment.kind === 'typeGrid') : null
  record('[菜单] 类型图标为飞书实测18px，不被旧最小盒放大',
    !!typeGrid && typeGrid.items.every(item => Math.abs(item.iconWidth - 18) < 0.1 && Math.abs(item.iconHeight - 18) < 0.1),
    typeGrid ? typeGrid.items.map(item => `${item.label}:${item.iconWidth}×${item.iconHeight}`).join('/') : '')
  const expectedTypes = ['正文', '一级标题', '二级标题', '三级标题', '有序列表', '无序列表', '任务列表', '代码块', '引用', '高亮块']
  record('[菜单] 选中底色24px且保留40px点击高度',
    !!typeGrid && typeGrid.items.every(item => item.symbolWidth === 24 && item.symbolHeight === 24 && item.hitHeight >= 40 && item.borderWidth === '0px' && item.background === 'rgba(0, 0, 0, 0)'))
  record('[菜单] 类型项顺序与 blockTypeActions 一致，保留 aria-label/图标且无原生title',
    !!typeGrid && JSON.stringify(typeGrid.items.map((item) => item.label)) === JSON.stringify(expectedTypes)
    && typeGrid.items.every((item) => item.title === null && item.icon),
    typeGrid ? typeGrid.items.map((item) => item.label).join('/') : '')

  record('[菜单] 当前块类型项带 active（正文段落 → 正文高亮）',
    !!typeGrid && typeGrid.items.filter((item) => item.active).map((item) => item.label).join(',') === '正文',
    typeGrid ? `active=${typeGrid.items.filter((item) => item.active).map((item) => item.label).join(',') || '无'}` : '')

  record('[菜单] 首段是「问问AI」按钮（带 16px 图标）',
    !!menu && !!menu.ai && menu.ai.label.includes('问问AI') && menu.ai.icon && menu.ai.iconSize === 16,
    menu?.ai ? `${menu.ai.label} icon=${menu.ai.iconSize}px title=${menu.ai.title}（原生 title 应为 null）` : '无 AI 段')

  // 段序（飞书块菜单的固定分段，见 BlockHandleMenu.vue 的模板顺序）：
  //   AI | — | 类型网格 | — | 缩进和对齐 颜色 | — | 编辑操作 | — | 分享操作 | — | 在下方添加
  // 「—」只在两侧至少有一段内容时出现：类型网格/缩进/颜色在表格分支被摘掉，分隔线跟着走。
  const segmentKinds = menu ? menu.segments.map((segment) => segment.kind === 'divider' ? '|' : segment.kind) : []
  const expectedKinds = ['button', '|', 'typeGrid', '|', 'button', 'button', '|', ...Array(5).fill('button'), '|', ...Array(3).fill('button'), '|', 'button']
  record('[菜单] 段序 = 问问AI | 类型网格 | 缩进和对齐 颜色 | 操作列表 | 在下方添加',
    JSON.stringify(segmentKinds) === JSON.stringify(expectedKinds),
    `${segmentKinds.join(' ')}${JSON.stringify(segmentKinds) === JSON.stringify(expectedKinds) ? '' : `（期望 ${expectedKinds.join(' ')}）`}`)

  const buttonSegments = menu ? menu.segments.filter((segment) => segment.kind === 'button') : []
  record('[菜单] 子菜单触发项声明 aria-haspopup=menu 且初始 aria-expanded=false',
    buttonSegments.filter((segment) => segment.haspopup === 'menu').length === 3
    && buttonSegments.filter((segment) => segment.haspopup === 'menu').every((segment) => segment.expanded === 'false' && segment.arrow),
    buttonSegments.filter((segment) => segment.haspopup === 'menu').map((segment) => `${segment.label}:${segment.expanded}`).join(' '))

  // 与飞书一致分成编辑和分享两组；副本/上下移动仅保留命令 API。
  const actionRows = buttonSegments.filter((segment) => segment.cls.includes('lark-doc-block-menu-row'))
  record('[菜单] 评论/编辑/分享/复制链接和下方添加都有明确入口',
    JSON.stringify(actionRows.map((segment) => segment.label)) === JSON.stringify(['评论', '剪切', '复制', '翻译', '删除', '分享', '保存为模板', '复制链接', '在下方添加']),
    actionRows.map((segment) => segment.label).join('/'))

  record('[菜单] 菜单出现在正文左侧、不溢出视口',
    !!menu && menu.x >= 8 && menu.right <= 1440 - 8 && menu.right <= 640,
    menu ? `x=${menu.x} right=${menu.right} w=${menu.w}` : '')

  // ——————————————————— ③ 子菜单 ———————————————————
  const alignTrigger = await page.evaluate(() => {
    // 触发器只带 aria-label，不再带原生 title（悬停提示走 select.js 自绘浮层）
    const trigger = [...document.querySelectorAll('.lark-doc-block-submenu-trigger')].find((node) => node.getAttribute('aria-label') === '缩进和对齐')
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
    const trigger = [...document.querySelectorAll('.lark-doc-block-submenu-trigger')].find((node) => node.getAttribute('aria-label') === '缩进和对齐')
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
    const trigger = [...document.querySelectorAll('.lark-doc-block-submenu-trigger')].find((node) => node.getAttribute('aria-label') === '颜色')
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

  // 在下方添加：plus 菜单里没有「正文」——新块默认就是正文，filterCommands 显式排除
  // paragraph（见 src/core/commands/index.js），所以选「一级标题」验证插入并生效。
  const before = await page.evaluate(() => ({
    count: document.querySelectorAll('.ProseMirror > *').length,
    h1: document.querySelectorAll('.ProseMirror > h1').length,
  }))
  await openBlockMenu(page, 1)
  await page.locator('.lark-doc-block-menu [aria-label="在下方添加"]').click()
  await page.locator('.lark-doc-command-menu [data-command-id="heading1"]').click()
  await page.waitForTimeout(320)
  const after = await page.evaluate(() => ({
    count: document.querySelectorAll('.ProseMirror > *').length,
    h1: document.querySelectorAll('.ProseMirror > h1').length,
  }))
  record('[动作] 下方添加选一级标题后插一块并关闭菜单',
    after.count === before.count + 1 && after.h1 === before.h1 + 1 && (await menuOpen(page)) === false,
    `${before.count} → ${after.count} h1 ${before.h1} → ${after.h1} 菜单=${await menuOpen(page)}`)

  // 空段落句柄不给块菜单（＋ 走「插入内容」命令菜单）。索引动态取：上面「下方添加」
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

  await page.evaluate(() => window.__larkDoc.setContent('<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>任务悬浮核验</p></li></ul><p></p>'))
  const task = page.locator('ul[data-type="taskList"] li').first()
  await task.locator('p').hover()
  await page.locator('.lark-doc-block-handle-main').waitFor()
  // 六点是 path 画的（不是 6 个 <circle>），按 d 里的圆点弧段数断言。
  const taskDots = await page.evaluate(() => {
    const dots = document.querySelector('.lark-doc-block-handle-main .lark-doc-block-handle-dots')
    const d = dots?.querySelector('path')?.getAttribute('d') || ''
    return { svg: !!dots?.querySelector('svg'), pathDots: (d.match(/a1\.75 1\.75/g) || []).length }
  })
  record('[任务] 悬浮显示六点句柄且不改变勾选',
    taskDots.svg && taskDots.pathDots === 6 && await task.getAttribute('data-checked') === 'false', JSON.stringify(taskDots))
  await page.locator('.lark-doc-block-handle-main').hover()
  await page.locator('.lark-doc-block-menu').waitFor()
  record('[任务] 句柄悬浮高亮当前任务并打开操作菜单', await task.evaluate(node => node.classList.contains('lark-doc-block-handle-hovered')))
  await page.locator('.lark-doc-block-menu').getByRole('menuitem', { name: '剪切', exact: true }).click()
  // taskList 至少要留一个 taskItem（schema 约束）：剪掉唯一一项后编辑器会补一个空项，
  // 所以这里断言「文字被清空」，不能断言 li 归零。
  await page.waitForFunction(() => (window.__larkDoc.getText() || '').trim() === '')
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z')
  await page.waitForFunction(() => (window.__larkDoc.getText() || '').includes('任务悬浮核验'))
  await task.locator('input[type="checkbox"]').check()
  record('[任务] 剪切可撤销且复选框仍可切换', await task.getAttribute('data-checked') === 'true')
  await page.evaluate(html => { window.__larkDoc.setContent(html); window.__larkDoc.getEditor().commands.focus('start') }, CONTENT)

  // ——————————————————— ⑥ 只读 ———————————————————
  await page.evaluate(() => { window.__larkDoc.setReadonly(true) })
  await page.waitForTimeout(400)
  await hoverBlock(page, 1)
  const readonlyHandle = await page.evaluate(() => !!document.querySelector('.lark-doc-block-handle'))
  const readonlyMenu = await page.evaluate(() => !!document.querySelector('.lark-doc-block-menu'))
  record('[只读] 只读态不渲染块句柄、也不开块菜单', readonlyHandle === false && readonlyMenu === false, `句柄=${readonlyHandle} 菜单=${readonlyMenu}`)

  record('无脚本错误', errors.length === 0, errors.slice(0, 3).join(' | '))

  // 只读段结束后必须恢复可写：下面的多视口点击验证要靠真实句柄。
  await page.evaluate(() => { window.__larkDoc.setReadonly(false) })
  await page.waitForTimeout(200)

  for (const [width, height] of [[320, 480], [360, 320], [360, 782], [420, 782], [768, 782], [1536, 782]]) {
    const clicks = await verifyBlockSubmenuClickTargets(page, width, height)
    record(`[子菜单真实点击] ${width}×${height} 对齐/颜色不抢父入口点击，应用及撤销`, clicks.length === 2, JSON.stringify(clicks))
  }
  await browser.close()
  const failed = results.filter((result) => !result.ok).length
  console.log(`\n${results.length - failed}/${results.length} 项通过`)
  process.exit(failed ? 1 : 0)
})().catch((error) => {
  console.error(error)
  process.exit(1)
})
