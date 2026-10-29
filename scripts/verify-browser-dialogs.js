'use strict'
/**
 * 浏览器级验证：弹窗与面板的「结构即契约」（阶段 5 批次 4a）。
 *
 * 批次 4 要把 6 个弹窗 SFC（`editor/dialogs/*.vue`）换成原生 DOM 片段
 * （`src/ui/dialogs.js`），本套断言就是那批改动的**回归闸门**：改前先跑绿，
 * 改完必须仍然全绿，一条都不许「调松」。
 *
 * 覆盖 5 个弹窗（第 6 个 `HeadingNumberMenu.vue` 已有
 * `verify-browser-heading-number.js` 38 条 + `verify-browser-list-number-menu.js` 30 条
 * 两套断言，不在这里重复）：
 *   ① 表格选择器 `TablePickerDialog`  —— 共用 `.lark-doc-dialog` 外壳，81 格网格
 *   ② 公式弹窗 `MathDialog`            —— 同上外壳，带 `role=alert` 错误段
 *   ③ 链接弹窗 `LinkDialog`            —— 同上外壳，插入 / 编辑两种形态（`v-if` 真增删）
 *   ④ 快捷键抽屉 `HelpDialog`          —— `.lark-doc-drawer-mask` + 314px 抽屉
 *   ⑤ 内嵌网页浮层 `EmbedLinkDialog`   —— **故意**与 ①②③ 的四处不同（见下）
 *
 * 为什么这五个值得单独一套断言：
 * - 三处「同名不同命」：`TablePickerDialog` / `MathDialog` / `LinkDialog` 共用
 *   `.lark-doc-dialog-backdrop` + `.lark-doc-dialog`；`HelpDialog` 走抽屉外壳；
 *   `EmbedLinkDialog` **既不遮罩也不居中**（540×164 贴着插入位置浮出）。
 *   原生化时最容易「统一成一套外壳」，那正是 04 §4.3 明确否掉的做法。
 * - 条件段是契约：`LinkDialog` 的「链接文本」是 `v-if="ed.linkInsertMode"`、
 *   `MathDialog` 的错误段是 `v-if="ed.mathError"` —— 条件为假时**必须真的不在 DOM 里**，
 *   改成 `hidden` / `display:none` 就会让读屏念出空段落。
 * - 内嵌网页浮层的四条反直觉行为（04 §4.3 ③⑤）：Esc ×1/×2 都关不掉、
 *   非法值不报错只有按钮换色、`<output>` 式的静默拒绝、点「查看示例」要关浮层。
 *   这些是**产品契约**，不是实现细节，落回 SFC 之外就必须重新锁一遍。
 *
 * 本脚本只经由 DOM 与公开门面（`window.__larkDoc.getEditor()` / `.setContent()`）断言，
 * 不碰 Vue 实例内部字段，原生化之后同一份断言仍然有效。
 *
 * 量法说明（以实测 + CSS 为准）：
 * - `.lark-doc-dialog`：路径 `place-items: center`、`width: min(420px, 100%)`、`padding: 19px`、`radius 10px`。
 * - 表格网格 `repeat(9, 1fr)` 共 **81** 格，`aria-label` 是「{列}行{行}列」（原文如此，别改口径）。
 * - 抽屉宽 **314px**、右贴边；关闭钮 24×24。
 * - 内嵌浮层 540×164 / radius 8 / `z-index: 99` / `position: fixed`。
 *
 * 依赖：demo dev server（`window.__larkDoc`）。用法：
 *   node scripts/verify-browser-dialogs.js [url]
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

const BASE_CONTENT = '<p>甲乙丙丁戊己庚辛</p>'
const SLASH_CONTENT = '<p></p><p>第二段正文</p>'

// —— 页面内工具函数（必须自包含：会被 page.evaluate 序列化执行） ——

/** 三个共用外壳的弹窗：背板 + `.lark-doc-dialog` 的整体快照。 */
const measureDialog = () => {
  const backdrop = document.querySelector('.lark-doc-dialog-backdrop')
  if (!backdrop) return null
  const dialog = backdrop.querySelector('.lark-doc-dialog')
  if (!dialog) return { backdrop: true, dialog: false }
  const cs = getComputedStyle(dialog)
  const rect = dialog.getBoundingClientRect()
  const header = dialog.querySelector('header')
  const closeButton = header ? header.querySelector('button') : null
  const closeIcon = closeButton ? closeButton.querySelector('.lark-doc-icon') : null
  const labels = [...dialog.querySelectorAll('label')].map((label) => {
    const textNode = [...label.childNodes].find((node) => node.nodeType === 3 && node.textContent.trim())
    const input = label.querySelector('input')
    return {
      text: textNode ? textNode.textContent.trim() : '',
      inputLabel: input ? input.getAttribute('aria-label') : null,
      placeholder: input ? input.getAttribute('placeholder') : null,
      value: input ? input.value : null,
      focused: input ? document.activeElement === input : false,
    }
  })
  return {
    backdrop: true,
    dialog: true,
    role: dialog.getAttribute('role'),
    ariaModal: dialog.getAttribute('aria-modal'),
    ariaLabel: dialog.getAttribute('aria-label'),
    width: Math.round(rect.width),
    padding: cs.padding,
    radius: cs.borderTopLeftRadius,
    headerStrong: header && header.querySelector('strong') ? header.querySelector('strong').textContent.trim() : null,
    headerChildren: header ? [...header.children].map((node) => node.tagName.toLowerCase()) : [],
    closeLabel: closeButton ? closeButton.getAttribute('aria-label') : null,
    closeType: closeButton ? closeButton.getAttribute('type') : null,
    closeIcon: closeIcon ? { w: Math.round(closeIcon.getBoundingClientRect().width), h: Math.round(closeIcon.getBoundingClientRect().height) } : null,
    labels,
    paragraphs: [...dialog.querySelectorAll('p')].map((p) => ({
      text: p.textContent.trim(),
      role: p.getAttribute('role'),
      cls: p.className,
    })),
    buttons: [...dialog.querySelectorAll('button')].map((button) => ({
      text: button.textContent.trim(),
      label: button.getAttribute('aria-label'),
      disabled: button.disabled,
      type: button.getAttribute('type'),
      cls: button.className,
    })),
  }
}

/** 表格选择器：尺寸标签 + 网格。 */
const measureTablePicker = () => {
  const dialog = document.querySelector('.lark-doc-dialog-backdrop .lark-doc-dialog')
  if (!dialog) return null
  const size = dialog.querySelector('.lark-doc-table-grid-size')
  const grid = dialog.querySelector('.lark-doc-table-grid')
  const cells = grid ? [...grid.querySelectorAll('button')] : []
  const header = dialog.querySelector('header')
  const closeButton = header ? header.querySelector('button') : null
  return {
    ariaLabel: dialog.getAttribute('aria-label'),
    sizeText: size ? size.textContent.trim() : null,
    // `margin-left: auto` 在 flex 里会被解析成实际像素，读 computed 拿不到 "auto"；
    // 真正的契约是「贴右」，所以量它与右侧关闭钮之间那段 12px 的 header gap。
    sizeRightGap: size && closeButton ? Math.round(closeButton.getBoundingClientRect().left - size.getBoundingClientRect().right) : null,
    headerChildren: header ? [...header.children].map((node) => node.tagName.toLowerCase()) : [],
    paragraphBeforeGrid: !!(dialog.querySelector('p') && grid && dialog.querySelector('p').compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING),
    cellCount: cells.length,
    cellType: cells.length ? cells[0].getAttribute('type') : null,
    cellText: cells.length ? cells[0].textContent.trim() : null,
    firstLabel: cells.length ? cells[0].getAttribute('aria-label') : null,
    lastLabel: cells.length ? cells[cells.length - 1].getAttribute('aria-label') : null,
    previewCount: cells.filter((cell) => cell.classList.contains('is-preview')).length,
    previewLabels: cells.filter((cell) => cell.classList.contains('is-preview')).map((cell) => cell.getAttribute('aria-label')),
    activeIsFirst: cells.length ? document.activeElement === cells[0] : false,
    columns: grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0,
  }
}

/** 快捷键抽屉。 */
const measureHelpDrawer = () => {
  const mask = document.querySelector('.lark-doc-drawer-mask')
  if (!mask) return null
  const drawer = mask.querySelector('.lark-doc-drawer')
  if (!drawer) return { mask: true, drawer: false }
  const rect = drawer.getBoundingClientRect()
  const head = drawer.querySelector('.lark-doc-drawer-head')
  const closeButton = head ? head.querySelector('.lark-doc-drawer-close') : null
  const groups = [...drawer.querySelectorAll('.lark-doc-kbd-group')].map((group) => ({
    title: ((group.querySelector('.lark-doc-kbd-title') || {}).textContent || '').trim(),
    rows: [...group.querySelectorAll('.lark-doc-kbd-row')].map((row) => ({
      name: ((row.querySelector('.lark-doc-kbd-name') || {}).textContent || '').trim(),
      key: ((row.querySelector('kbd.lark-doc-kbd-key') || {}).textContent || '').trim(),
      keyTag: row.querySelector('.lark-doc-kbd-key') ? row.querySelector('.lark-doc-kbd-key').tagName.toLowerCase() : null,
    })),
  }))
  return {
    mask: true,
    drawer: true,
    cls: String(drawer.className),
    role: drawer.getAttribute('role'),
    ariaModal: drawer.getAttribute('aria-modal'),
    ariaLabel: drawer.getAttribute('aria-label'),
    width: Math.round(rect.width),
    right: Math.round(window.innerWidth - rect.right),
    height: Math.round(rect.height),
    headStrong: head && head.querySelector('strong') ? head.querySelector('strong').textContent.trim() : null,
    closeLabel: closeButton ? closeButton.getAttribute('aria-label') : null,
    closeSize: closeButton ? `${Math.round(closeButton.getBoundingClientRect().width)}x${Math.round(closeButton.getBoundingClientRect().height)}` : null,
    groupCount: groups.length,
    groups,
  }
}

/** 内嵌网页浮层。 */
const measureEmbedDialog = () => {
  const dialog = document.querySelector('.lark-doc-embed-dialog')
  if (!dialog) return null
  const cs = getComputedStyle(dialog)
  const rect = dialog.getBoundingClientRect()
  const input = dialog.querySelector('.lark-doc-embed-dialog-input')
  const confirm = dialog.querySelector('.lark-doc-embed-dialog-confirm')
  const footer = dialog.querySelector('footer')
  return {
    cls: String(dialog.className),
    role: dialog.getAttribute('role'),
    ariaLabel: dialog.getAttribute('aria-label'),
    hasAriaModal: dialog.hasAttribute('aria-modal'),
    hasBackdrop: !!document.querySelector('.lark-doc-dialog-backdrop'),
    position: cs.position,
    zIndex: cs.zIndex,
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    radius: cs.borderTopLeftRadius,
    inlineStyle: dialog.getAttribute('style') || '',
    firstChild: dialog.firstElementChild ? dialog.firstElementChild.className || dialog.firstElementChild.tagName.toLowerCase() : null,
    closeLabel: dialog.querySelector('.lark-doc-embed-dialog-close') ? dialog.querySelector('.lark-doc-embed-dialog-close').getAttribute('aria-label') : null,
    headerStrong: dialog.querySelector('header strong') ? dialog.querySelector('header strong').textContent.trim() : null,
    inputLabel: input ? input.getAttribute('aria-label') : null,
    inputType: input ? input.getAttribute('type') : null,
    placeholder: input ? input.getAttribute('placeholder') : null,
    inputValue: input ? input.value : null,
    focused: input ? document.activeElement === input : false,
    footerOrder: footer ? [...footer.querySelectorAll('button')].map((button) => button.className) : [],
    confirmText: confirm ? confirm.textContent.trim() : null,
    confirmBg: confirm ? getComputedStyle(confirm).backgroundColor : null,
    rejected: confirm ? confirm.classList.contains('is-rejected') : null,
    hasAlert: !!dialog.querySelector('[role="alert"], .lark-doc-error'),
  }
}

// —— 页面操作 ——

/** 关掉所有浮层并重置文档。 */
async function resetTo(page, html) {
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  // 内嵌浮层只认「点外部」，Esc 对它无效 —— 点页面左侧空白（.lark-doc 之外）走 onDocumentPointerDown。
  await page.mouse.click(5, 420)
  await page.waitForTimeout(180)
  await page.evaluate((content) => window.__larkDoc.setContent(content), html)
  await page.waitForTimeout(320)
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

/**
 * 经由斜杠菜单点某一项命令（按 `data-command-id` 定位，不依赖搜索框过滤/键盘走位）。
 * 命令 id 与 `src/core/commands/*.js` 一一对应：`inlineMath` / `blockMath` / `link` / `figma`。
 *
 * ⚠️ **表格不在此列**（实测踩过）：斜杠菜单里的 `table` 走的是
 * `commandMenuMixin.chooseCommand` 的 `isSlashTable` 分支（第 189 行），
 * 直接 `insertTable(3, 3)` 插一张 3×3 表，**根本不开** `TablePickerDialog`。
 * 选择器的唯一入口是工具栏「插入表格」按钮（`tableToolsMixin.onTableToolbarClick`：
 * `isActive('table')` 为真时开表格工具条，否则开选择器）—— 见 `openTablePicker`。
 */
async function chooseCommand(page, id) {
  await openSlashMenu(page)
  const clicked = await page.evaluate((commandId) => {
    const button = document.querySelector(`.lark-doc-command-menu button[data-command-id="${commandId}"]`)
    if (!button) return false
    button.click()
    return true
  }, id)
  if (!clicked) throw new Error(`斜杠菜单里没有命令 ${id}`)
  await page.waitForTimeout(420)
}

/** 打开表格选择器：工具栏「插入表格」按钮（非表格态下唯一入口）。 */
async function openTablePicker(page) {
  await resetTo(page, BASE_CONTENT)
  const clicked = await page.evaluate(() => {
    const button = document.querySelector('.lark-doc-toolbar button[aria-label="插入表格"]')
    if (!button) return false
    button.click()
    return true
  })
  if (!clicked) throw new Error('工具栏里没有「插入表格」按钮')
  await page.waitForTimeout(420)
}

/** 选中正文第 from~to 两个位置之间的文字，并（可选）先打上链接标记。 */
async function selectRange(page, from, to, href) {
  await page.evaluate(({ start, end, url }) => {
    const editor = window.__larkDoc.getEditor()
    if (url) editor.chain().focus().setTextSelection({ from: start, to: end }).setLink({ href: url }).run()
    else editor.chain().focus().setTextSelection({ from: start, to: end }).run()
  }, { start: from, end: to, url: href || null })
  await page.waitForTimeout(260)
}

const open = (page, selector) => page.evaluate((sel) => !!document.querySelector(sel), selector)

;(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: findChromium() || undefined })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => window.__larkDoc && window.__larkDoc.getEditor && window.__larkDoc.getEditor(), { timeout: 60000 })

  /* ═══════════════════ ① 表格选择器 ═══════════════════ */

  await openTablePicker(page)
  const table = await page.evaluate(measureTablePicker)

  record('[表格] 工具栏「插入表格」打开 `.lark-doc-dialog-backdrop` + `.lark-doc-dialog`',
    !!table, table ? '已打开' : '没打开')

  record('[表格] role=dialog / aria-modal=true / aria-label=插入表格',
    !!table && await page.evaluate(() => {
      const dialog = document.querySelector('.lark-doc-dialog-backdrop .lark-doc-dialog')
      return dialog.getAttribute('role') === 'dialog' && dialog.getAttribute('aria-modal') === 'true' && dialog.getAttribute('aria-label') === '插入表格'
    }))

  record('[表格] 头部段序：strong → 尺寸标签 → 关闭按钮',
    !!table && JSON.stringify(table.headerChildren) === JSON.stringify(['strong', 'span', 'button']),
    table ? table.headerChildren.join('→') : '')

  record('[表格] 尺寸标签贴在头部右侧（与关闭钮之间正好 12px 的 header gap）',
    !!table && table.sizeRightGap === 12,
    table ? `${table.sizeText} 距关闭钮 ${table.sizeRightGap}px` : '')

  record('[表格] 说明 `<p>` 在网格之前（"插入支持富文本的表格"）',
    !!table && table.paragraphBeforeGrid,
    table ? `before=${table.paragraphBeforeGrid}` : '')

  record('[表格] 网格 9 列 × 9 行 = 81 格，`button type=button`、格内 ▦',
    !!table && table.columns === 9 && table.cellCount === 81 && table.cellType === 'button' && table.cellText === '▦',
    table ? `${table.columns} 列 / ${table.cellCount} 格 / type=${table.cellType} / 字="${table.cellText}"` : '')

  record('[表格] `aria-label` 口径是「{列}行{行}列」：首格 1行1列、末格 9行9列',
    !!table && table.firstLabel === '1行1列' && table.lastLabel === '9行9列',
    table ? `${table.firstLabel} … ${table.lastLabel}` : '')

  /**
   * 初始高亮是 **1×1 而不是 3×3** —— 反直觉，但是既有契约：
   * `LarkDocEditor.vue` 的 `watch.tablePicker` 先把 hover 复位成 `{3,3}`，
   * 紧接着 `$nextTick` 把焦点放到网格首格；首格的 `@focus` 又调了一次
   * `previewTableSize(1, 1)`，于是打开瞬间的稳态就是 1×1 / 1 格高亮。
   * 原生化必须照抄这条链路（复位 → 聚焦首格），否则「打开即 3×3 高亮」会漂。
   */
  record('[表格] 打开即聚焦首格 → 稳态 `1 × 1`、高亮 1 格（focus 会覆盖 3×3 的初值）',
    !!table && table.sizeText === '1 × 1' && table.previewCount === 1
    && table.previewLabels.join(',') === '1行1列' && table.activeIsFirst === true,
    table ? `${table.sizeText} / ${table.previewCount} 格 / 首格聚焦=${table.activeIsFirst}` : '')

  // hover 第 10 格（第 2 行第 1 列）→ 标签「1 × 2」、2 格高亮
  await page.evaluate(() => {
    const cells = [...document.querySelectorAll('.lark-doc-table-grid button')]
    cells[9].dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }))
  })
  await page.waitForTimeout(220)
  const tableHover10 = await page.evaluate(measureTablePicker)
  record('[表格] hover 第 10 格 → 标签 `1 × 2`、高亮 2 格',
    !!tableHover10 && tableHover10.sizeText === '1 × 2' && tableHover10.previewCount === 2,
    tableHover10 ? `${tableHover10.sizeText} / ${tableHover10.previewCount} 格` : '')

  // hover 第 81 格 → 「9 × 9」、81 格高亮
  await page.evaluate(() => {
    const cells = [...document.querySelectorAll('.lark-doc-table-grid button')]
    cells[80].dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }))
  })
  await page.waitForTimeout(220)
  const tableHover81 = await page.evaluate(measureTablePicker)
  record('[表格] hover 第 81 格 → `9 × 9`、81 格全亮',
    !!tableHover81 && tableHover81.sizeText === '9 × 9' && tableHover81.previewCount === 81,
    tableHover81 ? `${tableHover81.sizeText} / ${tableHover81.previewCount} 格` : '')

  // 点第 10 格（2 行 1 列）→ 落 2×1 表格且弹窗关闭
  await page.evaluate(() => {
    const cells = [...document.querySelectorAll('.lark-doc-table-grid button')]
    cells[9].click()
  })
  await page.waitForTimeout(520)
  const tableInserted = await page.evaluate(() => {
    const json = window.__larkDoc.getEditor().getJSON()
    const tableNode = (json.content || []).find((node) => node.type === 'table')
    return {
      closed: !document.querySelector('.lark-doc-dialog-backdrop'),
      rows: tableNode ? tableNode.content.length : 0,
      cols: tableNode && tableNode.content[0] ? tableNode.content[0].content.length : 0,
    }
  })
  record('[表格] 点第 10 格 → 落 2 行 1 列表格并关闭弹窗',
    tableInserted.closed && tableInserted.rows === 2 && tableInserted.cols === 1,
    `关闭=${tableInserted.closed} ${tableInserted.rows}行${tableInserted.cols}列`)

  // 背板点击关闭 + 下次打开高亮复位到 3×3
  await openTablePicker(page)
  await page.evaluate(() => {
    const backdrop = document.querySelector('.lark-doc-dialog-backdrop')
    backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await page.waitForTimeout(300)
  const backdropClosed = await open(page, '.lark-doc-dialog-backdrop')
  record('[表格] 点背板自身关闭弹窗', !backdropClosed)

  await openTablePicker(page)
  const tableReopened = await page.evaluate(measureTablePicker)
  record('[表格] 重开时 hover 复位（不停在上次的 `9 × 9`，回到聚焦首格的 `1 × 1`）',
    !!tableReopened && tableReopened.sizeText === '1 × 1' && tableReopened.previewCount === 1,
    tableReopened ? `${tableReopened.sizeText} / ${tableReopened.previewCount} 格` : '')

  /* ═══════════════════ ② 公式弹窗 ═══════════════════ */

  await chooseCommand(page, 'inlineMath')
  const math = await page.evaluate(measureDialog)
  record('[公式] 打开共用外壳弹窗，aria-label=插入公式、头部 strong 同文案',
    !!math && math.dialog === true && math.ariaLabel === '插入公式' && math.headerStrong === '插入公式',
    math && math.dialog ? `${math.ariaLabel} / ${math.headerStrong}` : '没打开')

  record('[公式] role=dialog / aria-modal=true / 圆角 10px / 内边距 19px',
    !!math && math.dialog === true && math.role === 'dialog' && math.ariaModal === 'true' && math.radius === '10px' && math.padding === '19px',
    math && math.dialog ? `role=${math.role} modal=${math.ariaModal} radius=${math.radius} padding=${math.padding}` : '')

  record('[公式] 只有一个 label「LaTeX」，输入框 aria-label=LaTeX 公式、placeholder 齐备、打开即聚焦',
    !!math && math.dialog === true && math.labels.length === 1 && math.labels[0].text === 'LaTeX'
    && math.labels[0].inputLabel === 'LaTeX 公式' && math.labels[0].placeholder === '例如 x^2 + y^2' && math.labels[0].focused === true,
    math && math.dialog ? JSON.stringify(math.labels[0]) : '')

  record('[公式] 关闭钮 aria-label=关闭对话框、内部图标 14×14',
    !!math && math.dialog === true && math.closeLabel === '关闭对话框' && !!math.closeIcon && math.closeIcon.w === 14 && math.closeIcon.h === 14,
    math && math.dialog ? `${math.closeLabel} ${math.closeIcon ? `${math.closeIcon.w}x${math.closeIcon.h}` : '无图标'}` : '')

  record('[公式] 初始无错误段（`v-if="ed.mathError"` → 真的不在 DOM 里）',
    !!math && math.dialog === true && math.paragraphs.length === 0,
    math && math.dialog ? `${math.paragraphs.length} 段 <p>` : '')

  // 非法 LaTeX → role=alert 的错误段 + 弹窗保持打开
  await page.evaluate(() => {
    const input = document.querySelector('.lark-doc-dialog input[aria-label="LaTeX 公式"]')
    input.value = '\\frac{1}'
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await page.waitForTimeout(160)
  await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('.lark-doc-dialog button')]
    buttons.find((button) => button.textContent.trim() === '插入').click()
  })
  await page.waitForTimeout(700)
  const mathError = await page.evaluate(measureDialog)
  record('[公式] 非法 LaTeX → 出现 `role=alert` 的 `.lark-doc-error`，弹窗不关',
    !!mathError && mathError.dialog === true && mathError.paragraphs.length === 1
    && mathError.paragraphs[0].role === 'alert' && /公式无法解析/.test(mathError.paragraphs[0].text)
    && /lark-doc-error/.test(mathError.paragraphs[0].cls),
    mathError && mathError.dialog ? JSON.stringify(mathError.paragraphs) : '弹窗被关掉了')

  // 合法 LaTeX → Enter 插入节点并关闭
  await page.evaluate(() => {
    const input = document.querySelector('.lark-doc-dialog input[aria-label="LaTeX 公式"]')
    input.value = 'x^2 + y^2'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  })
  await page.waitForTimeout(800)
  const mathInserted = await page.evaluate(() => {
    const json = window.__larkDoc.getEditor().getJSON()
    const found = JSON.stringify(json).indexOf('inlineMath') !== -1
    return { found, closed: !document.querySelector('.lark-doc-dialog-backdrop') }
  })
  record('[公式] 合法 LaTeX + Enter → 落 inlineMath 节点并关闭弹窗',
    mathInserted.found && mathInserted.closed,
    `节点=${mathInserted.found} 关闭=${mathInserted.closed}`)

  /* ═══════════════════ ③ 链接弹窗 ═══════════════════ */

  await chooseCommand(page, 'link')
  const linkInsert = await page.evaluate(measureDialog)
  record('[链接] 空选区 → 插入模式：两个 label「链接文本」→「链接地址」',
    !!linkInsert && linkInsert.dialog === true && linkInsert.ariaLabel === '设置链接'
    && linkInsert.labels.length === 2 && linkInsert.labels[0].text === '链接文本' && linkInsert.labels[1].text === '链接地址',
    linkInsert && linkInsert.dialog ? linkInsert.labels.map((label) => label.text).join('→') : '没打开')

  record('[链接] 插入模式提示两段（第一段只在插入模式出现）',
    !!linkInsert && linkInsert.dialog === true && linkInsert.paragraphs.length === 2
    && /输入显示文字和地址后插入本地链接/.test(linkInsert.paragraphs[0].text),
    linkInsert && linkInsert.dialog ? linkInsert.paragraphs.map((p) => p.text).join(' | ') : '')

  record('[链接] 地址为空 →「应用链接」禁用；插入模式下「解除链接」禁用',
    !!linkInsert && linkInsert.dialog === true && (() => {
      const apply = linkInsert.buttons.find((button) => button.text === '应用链接')
      const remove = linkInsert.buttons.find((button) => button.text === '解除链接')
      return !!apply && apply.disabled === true && !!remove && remove.disabled === true
    })(),
    linkInsert && linkInsert.dialog ? linkInsert.buttons.map((button) => `${button.text}:${button.disabled}`).join(' ') : '')

  // 填文本 + 地址 → 应用 → 落带 link mark 的文本
  await page.evaluate(() => {
    const set = (label, value) => {
      const input = document.querySelector(`.lark-doc-dialog input[aria-label="${label}"]`)
      input.value = value
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
    set('链接文本', '示例站')
    set('链接地址', 'https://example.com/a')
  })
  await page.waitForTimeout(200)
  await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('.lark-doc-dialog button')]
    buttons.find((button) => button.textContent.trim() === '应用链接').click()
  })
  await page.waitForTimeout(520)
  const linkApplied = await page.evaluate(() => {
    const json = window.__larkDoc.getEditor().getJSON()
    let href = null
    const walk = (node) => {
      if (!node) return
      if (Array.isArray(node.marks)) node.marks.forEach((mark) => { if (mark.type === 'link') href = mark.attrs.href })
      ;(node.content || []).forEach(walk)
    }
    walk(json)
    return { href, closed: !document.querySelector('.lark-doc-dialog-backdrop') }
  })
  record('[链接] 插入模式填文本+地址 → 落 link mark（href 正确）并关闭',
    linkApplied.href === 'https://example.com/a' && linkApplied.closed,
    `href=${linkApplied.href} 关闭=${linkApplied.closed}`)

  // 选中已有链接文字 → 工具栏「设置链接」→ 编辑模式（只有 1 个 label）
  await resetTo(page, BASE_CONTENT)
  await selectRange(page, 1, 5, 'https://example.com/b')
  await page.evaluate(() => {
    document.querySelector('.lark-doc-toolbar button[aria-label="设置链接"]').click()
  })
  await page.waitForTimeout(420)
  const linkEdit = await page.evaluate(measureDialog)
  record('[链接] 选中已有链接 → 编辑模式：只有「链接地址」一个 label（`v-if` 真的删节点）',
    !!linkEdit && linkEdit.dialog === true && linkEdit.labels.length === 1 && linkEdit.labels[0].text === '链接地址',
    linkEdit && linkEdit.dialog ? linkEdit.labels.map((label) => label.text).join('/') : '没打开')

  record('[链接] 编辑模式：地址框预填当前 href、「解除链接」可用、「应用链接」可用',
    !!linkEdit && linkEdit.dialog === true && linkEdit.labels[0].value === 'https://example.com/b' && (() => {
      const apply = linkEdit.buttons.find((button) => button.text === '应用链接')
      const remove = linkEdit.buttons.find((button) => button.text === '解除链接')
      return !!apply && apply.disabled === false && !!remove && remove.disabled === false
    })(),
    linkEdit && linkEdit.dialog ? `value=${linkEdit.labels[0].value}` : '')

  // 编辑模式只有一段提示
  record('[链接] 编辑模式提示只剩一段（插入模式那段不在 DOM 里）',
    !!linkEdit && linkEdit.dialog === true && linkEdit.paragraphs.length === 1
    && /仅允许 http、https、mailto、tel 或 # 锚点链接/.test(linkEdit.paragraphs[0].text),
    linkEdit && linkEdit.dialog ? `${linkEdit.paragraphs.length} 段` : '')

  // Esc 关闭
  await page.evaluate(() => {
    const dialog = document.querySelector('.lark-doc-dialog')
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  })
  await page.waitForTimeout(320)
  record('[链接] Esc 关闭弹窗', !(await open(page, '.lark-doc-dialog-backdrop')))

  /* ═══════════════════ ④ 快捷键抽屉 ═══════════════════ */

  await resetTo(page, BASE_CONTENT)
  await page.keyboard.press('Meta+/')
  await page.waitForTimeout(420)
  const help = await page.evaluate(measureHelpDrawer)

  record('[帮助] ⌘+/ 打开 `.lark-doc-drawer-mask` + `.lark-doc-drawer.lark-doc-help-drawer`',
    !!help && help.drawer === true && /lark-doc-help-drawer/.test(help.cls),
    help && help.drawer ? help.cls : '没打开')

  record('[帮助] aside 的 role=dialog / aria-modal=true / aria-label=快捷键帮助',
    !!help && help.drawer === true && help.role === 'dialog' && help.ariaModal === 'true' && help.ariaLabel === '快捷键帮助',
    help && help.drawer ? `role=${help.role} modal=${help.ariaModal} label=${help.ariaLabel}` : '')

  record('[帮助] 宽 314、右贴边、占满全高',
    !!help && help.drawer === true && help.width === 314 && help.right === 0 && help.height === 900,
    help && help.drawer ? `${help.width}px 右距 ${help.right} 高 ${help.height}` : '')

  /**
   * 关闭钮实测 **26×26** 而不是 `.lark-doc-drawer-close` 里写的 24×24：
   * CSS 第 420 行 `.lark-doc button[aria-label^="关闭"]` 的 `26px` 特异性更高（`.lark-doc`+属性
   * vs `.lark-doc`+类），把抽屉关闭钮一并抬到了 26。原生化要照抄**最终值** 26，别照抄 24。
   */
  record('[帮助] 头部 strong=快捷键、关闭钮 26×26（全局「关闭」热区规则覆盖了 24×24）、aria-label=关闭快捷键帮助',
    !!help && help.drawer === true && help.headStrong === '快捷键' && help.closeSize === '26x26' && help.closeLabel === '关闭快捷键帮助',
    help && help.drawer ? `${help.headStrong} ${help.closeSize} ${help.closeLabel}` : '')

  record('[帮助] 首组「模式与导航」11 行、首行「编辑模式 / E 或 Ctrl + ⌥ + E」',
    !!help && help.drawer === true && help.groups.length > 0
    && help.groups[0].title === '模式与导航' && help.groups[0].rows.length === 11
    && help.groups[0].rows[0].name === '编辑模式' && help.groups[0].rows[0].key === 'E 或 Ctrl + ⌥ + E',
    help && help.drawer ? `${help.groups[0].title} / ${help.groups[0].rows.length} 行 / ${help.groups[0].rows[0].name}=${help.groups[0].rows[0].key}` : '')

  record('[帮助] 每组都有标题且至少一行，组合键都是 `<kbd class="lark-doc-kbd-key">`',
    !!help && help.drawer === true && help.groupCount > 0
    && help.groups.every((group) => group.title.trim() && group.rows.length > 0)
    && help.groups.every((group) => group.rows.every((row) => row.keyTag === 'kbd' && row.key.trim() && row.name.trim())),
    help && help.drawer ? `${help.groupCount} 组 / 共 ${help.groups.reduce((sum, group) => sum + group.rows.length, 0)} 行` : '')

  record('[帮助] 分组标题互不重复（分组是数据源直出，不允许在渲染层合并）',
    !!help && help.drawer === true && new Set(help.groups.map((group) => group.title)).size === help.groups.length,
    help && help.drawer ? help.groups.map((group) => group.title).join('/') : '')

  await page.keyboard.press('Escape')
  await page.waitForTimeout(320)
  record('[帮助] Esc 关闭抽屉', !(await open(page, '.lark-doc-drawer-mask')))

  // 点遮罩自身也能关
  await page.keyboard.press('Meta+/')
  await page.waitForTimeout(360)
  await page.evaluate(() => {
    document.querySelector('.lark-doc-drawer-mask').dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await page.waitForTimeout(320)
  record('[帮助] 点遮罩自身关闭抽屉', !(await open(page, '.lark-doc-drawer-mask')))

  /* ═══════════════════ ⑤ 内嵌网页浮层 ═══════════════════ */

  await chooseCommand(page, 'figma')
  const embed = await page.evaluate(measureEmbedDialog)

  record('[内嵌] 打开 `.lark-doc-embed-dialog`，且**没有** `.lark-doc-dialog-backdrop`（不遮罩、不居中）',
    !!embed && embed.hasBackdrop === false,
    embed ? `backdrop=${embed.hasBackdrop}` : '没打开')

  record('[内嵌] role=dialog 但**没有** aria-modal（非模态浮层，读屏不该按模态处理）',
    !!embed && embed.role === 'dialog' && embed.hasAriaModal === false,
    embed ? `role=${embed.role} aria-modal=${embed.hasAriaModal}` : '')

  record('[内嵌] aria-label / 头部 strong 都是「粘贴 Figma 文件或原型链接」',
    !!embed && embed.ariaLabel === '粘贴 Figma 文件或原型链接' && embed.headerStrong === '粘贴 Figma 文件或原型链接',
    embed ? `${embed.ariaLabel} / ${embed.headerStrong}` : '')

  record('[内嵌] 540×164 / 圆角 8 / z-index 99 / position:fixed / 内联 left+top',
    !!embed && embed.width === 540 && embed.height === 164 && embed.radius === '8px'
    && embed.zIndex === '99' && embed.position === 'fixed'
    && /left:\s*\d+px/.test(embed.inlineStyle) && /top:\s*\d+px/.test(embed.inlineStyle),
    embed ? `${embed.width}x${embed.height} r=${embed.radius} z=${embed.zIndex} style="${embed.inlineStyle}"` : '')

  record('[内嵌] 关闭钮是浮层第一个子节点、aria-label=关闭内嵌网页链接',
    !!embed && !!embed.firstChild && /lark-doc-embed-dialog-close/.test(embed.firstChild) && embed.closeLabel === '关闭内嵌网页链接',
    embed ? `${embed.firstChild} / ${embed.closeLabel}` : '')

  record('[内嵌] 输入框 class/aria-label/placeholder 齐备且打开即聚焦',
    !!embed && embed.inputLabel === '内嵌网页链接' && embed.inputType === 'text'
    && embed.placeholder === 'https://www.figma.com/...' && embed.focused === true,
    embed ? `${embed.inputLabel} type=${embed.inputType} ph=${embed.placeholder} focused=${embed.focused}` : '')

  record('[内嵌] footer 段序：如何获取链接 → 查看示例 → 确认',
    !!embed && embed.footerOrder.length === 3
    && /embed-dialog-help/.test(embed.footerOrder[0]) && /embed-dialog-sample/.test(embed.footerOrder[1]) && /embed-dialog-confirm/.test(embed.footerOrder[2]),
    embed ? embed.footerOrder.join(' → ') : '')

  record('[内嵌] 初始「确认」不带 is-rejected',
    !!embed && embed.rejected === false && embed.confirmText === '确认',
    embed ? `${embed.confirmText} rejected=${embed.rejected}` : '')

  // 空值点确认 → 静默拒绝：不报错、不落块、浮层留着、按钮底色变化
  const blocksBefore = await page.evaluate(() => (window.__larkDoc.getEditor().getJSON().content || []).length)
  await page.evaluate(() => document.querySelector('.lark-doc-embed-dialog-confirm').click())
  await page.waitForTimeout(420)
  const embedEmpty = await page.evaluate(measureEmbedDialog)
  const embedEmptyBlocks = await page.evaluate(() => (window.__larkDoc.getEditor().getJSON().content || []).length)
  record('[内嵌] 空值点「确认」→ 浮层留着 + is-rejected（无文案提示、不落块）',
    !!embedEmpty && embedEmpty.rejected === true && embedEmpty.inputValue === ''
    && embedEmpty.hasAlert === false && embedEmptyBlocks === blocksBefore,
    embedEmpty ? `rejected=${embedEmpty.rejected} alert=${embedEmpty.hasAlert} 块数=${blocksBefore}→${embedEmptyBlocks}` : '浮层被关掉了')

  // 非法值（abc）→ 仍然拒绝
  await page.evaluate(() => {
    const input = document.querySelector('.lark-doc-embed-dialog-input')
    input.value = 'abc'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    document.querySelector('.lark-doc-embed-dialog-confirm').click()
  })
  await page.waitForTimeout(420)
  const embedInvalid = await page.evaluate(measureEmbedDialog)
  record('[内嵌] 非法值「abc」点「确认」→ 仍拒绝（重新输入即复位过一次）',
    !!embedInvalid && embedInvalid.rejected === true,
    embedInvalid ? `rejected=${embedInvalid.rejected}` : '浮层被关掉了')

  // Esc ×2 关不掉（04 §4.3 ③ 实测）
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(280)
  record('[内嵌] Esc ×1、×2 都关不掉（只认「点外部」和「点 ×」）',
    !!(await open(page, '.lark-doc-embed-dialog')))

  // 「查看示例」→ 关浮层（同文档，差别只在关不关浮层）
  await page.evaluate(() => document.querySelector('.lark-doc-embed-dialog-sample').click())
  await page.waitForTimeout(360)
  record('[内嵌] 点「查看示例」关闭浮层（「如何获取链接」才保持打开）',
    !(await open(page, '.lark-doc-embed-dialog')))

  // 合法链接 → 落 webEmbed 块并关闭
  await chooseCommand(page, 'figma')
  await page.evaluate(() => {
    const input = document.querySelector('.lark-doc-embed-dialog-input')
    input.value = 'https://www.figma.com/file/abc/Design'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    document.querySelector('.lark-doc-embed-dialog-confirm').click()
  })
  await page.waitForTimeout(700)
  const embedApplied = await page.evaluate(() => {
    const json = window.__larkDoc.getEditor().getJSON()
    const types = (json.content || []).map((node) => node.type)
    return { types, closed: !document.querySelector('.lark-doc-embed-dialog') }
  })
  record('[内嵌] 合法 Figma 链接 → 落 webEmbed 块并关闭浮层',
    embedApplied.closed && embedApplied.types.indexOf('webEmbed') !== -1,
    `${embedApplied.types.join(',')} 关闭=${embedApplied.closed}`)

  // 点外部关闭
  await chooseCommand(page, 'figma')
  await page.mouse.click(5, 420)
  await page.waitForTimeout(360)
  record('[内嵌] 点浮层外部关闭', !(await open(page, '.lark-doc-embed-dialog')))

  record('无脚本错误', errors.length === 0, errors.join(' | '))

  const passed = results.filter((item) => item.ok).length
  console.log(`\n${passed}/${results.length} 项通过`)
  await browser.close()
  process.exit(passed === results.length ? 0 : 1)
})().catch((error) => { console.error(error); process.exit(1) })
