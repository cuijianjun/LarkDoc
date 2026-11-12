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
 * - 公式错误段是条件节点：`v-if="ed.mathError"` 为假时必须真的不在 DOM 里；
 *   v12e 链接表单则按飞书实页统一两字段、470×126非模态浮层，
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
  await page.evaluate((content) => { window.__larkDoc.setContent(content) }, html)
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
  await page.evaluate(() => {
    const editors = [...document.querySelectorAll('lark-doc')]
    const target = editors.find(node => node.querySelector('button[aria-label="插入表格"]')) || editors[0]
    editors.forEach(node => { if (node !== target) node.remove() })
  })
  await page.evaluate(() => { if (!window.__larkDoc) window.__larkDoc = document.querySelector('lark-doc') })
  await page.waitForFunction(() => window.__larkDoc && window.__larkDoc.getEditor && window.__larkDoc.getEditor(), { timeout: 60000 })

  /* Source table insertion is direct, with the real block menu inside tables. */
  await resetTo(page, '<p>preserve before table</p><p></p>')
  await clickBlockEnd(page)
  await page.locator('.lark-doc-toolbar button[aria-label="插入表格"]').click()
  await page.locator('.ProseMirror table').waitFor()
  const inserted = await page.locator('.ProseMirror table').evaluate(table => ({
    rows: table.rows.length, cols: table.rows[0].cells.length,
    headers: table.querySelectorAll('th').length,
    widths: [...table.querySelectorAll('col')].map(col => parseFloat(col.style.width)),
  }))
  record('[表格] 真人点击直接插入2×3、100px、无标题行，不弹大小选择器',
    inserted.rows === 2 && inserted.cols === 3 && inserted.headers === 0
      && inserted.widths.length === 3 && inserted.widths.every(width => width === 100)
      && await page.locator('.lark-doc-dialog-backdrop').count() === 0, JSON.stringify(inserted))
  await page.locator('.lark-doc-toolbar button[aria-label="表格工具"]').click()
  await page.locator('.lark-doc-block-menu').waitFor({ state: 'visible' })
  record('[表格] 表内顶部工具按钮打开真实表格块菜单',
    await page.locator('.lark-doc-block-menu').innerText().then(text => text.includes('标题行') && text.includes('均分列宽')))
  await page.locator('.lark-doc-toolbar button[aria-label="表格工具"]').click()
  record('[表格] 再次点击收起表格块菜单', await page.locator('.lark-doc-block-menu').count() === 0)
  await page.keyboard.press('ControlOrMeta+z')
  record('[表格] 一次撤销移除新表格并保留原正文',
    await page.locator('.ProseMirror table').count() === 0
      && (await page.locator('.ProseMirror').innerText()).includes('preserve before table'))

  /* ② 公式：源400×98非模态浮层；完整闭环另见verify-browser-math.js。 */
  await chooseCommand(page, 'inlineMath')
  const mathPanel = page.getByRole('dialog', { name: '编辑公式', exact: true })
  await mathPanel.waitFor()
  const mathRect = await mathPanel.boundingBox()
  record('[公式] 400×98贴近公式的非模态浮层', mathRect.width === 400 && mathRect.height === 98 && await mathPanel.getAttribute('aria-modal') === null)
  const mathInput = mathPanel.getByRole('textbox', { name: 'LaTeX 公式' })
  await mathInput.fill('\\badcommand{')
  await page.locator('.tiptap [data-type="inline-math"]').filter({ hasText: '无效公式' }).waitFor()
  await mathInput.press('Escape')
  record('[公式] 无效源保留并显示占位，Esc完成输入', await mathPanel.count() === 0 && await page.locator('.tiptap .lark-doc-math-invalid').count() === 1)
  await page.locator('.tiptap [data-type="inline-math"]').click()
  record('[公式] 点击重新编辑相同LaTeX', await mathInput.inputValue() === '\\badcommand{')
  await mathInput.fill('x^2 + y^2')
  await mathInput.press('Escape')
  await page.locator('.tiptap [data-type="inline-math"] .katex').waitFor()
  record('[公式] 修复后即时渲染并保存', await mathPanel.count() === 0)

  /* ═══════════════════ ③ 链接：飞书实页470×126表单与440×42悬浮条 ═══════════════════ */
  await resetTo(page, '<p></p>')
  await clickBlockEnd(page)
  await page.keyboard.press('Meta+k')
  const form = page.locator('.lark-doc-link-dialog')
  await form.waitFor({ state: 'visible' })
  const formShape = await form.evaluate(el => ({ width: el.offsetWidth, height: el.offsetHeight, labels: [...el.querySelectorAll('label')].map(e => e.firstChild.textContent), modal: el.getAttribute('aria-modal'), placeholder: [...el.querySelectorAll('input')].map(e => e.placeholder) }))
  record('[链接] Cmd+K打开470×126非模态双字段表单，与飞书实页一致', formShape.width === 470 && formShape.height === 126 && !formShape.modal && formShape.labels.join('/') === '文本/链接', JSON.stringify(formShape))
  record('[链接] 空文本/地址时确认禁用，焦点在文本框', await form.getByRole('button', { name: '确认', exact: true }).isDisabled() && await form.getByRole('textbox', { name: '链接文本' }).evaluate(el => el === document.activeElement))
  const href = new URL('/__larkdoc-preview-fixture?link-v12e=1', BASE).href
  await form.getByRole('textbox', { name: '链接文本' }).fill('示例站')
  await form.getByRole('textbox', { name: '链接地址' }).fill(href)
  record('[链接] 焦点边框与确认按钮沿用项目品牌色', await form.evaluate(el => getComputedStyle(el.querySelector('input:focus')).borderTopColor === getComputedStyle(el.querySelector('button')).backgroundColor))
  await form.getByRole('button', { name: '确认', exact: true }).click()
  record('[链接] 真实鼠标确认后插入文本及安全链接，并关闭表单', await page.locator('.ProseMirror a').first().getAttribute('href') === href && await form.count() === 0)
  const openPage = async locator => {
    const [opened] = await Promise.all([page.waitForEvent('popup', { timeout: 5000 }), locator.click()])
    await opened.waitForLoadState('domcontentloaded', { timeout: 5000 })
    const ok = opened.url() === href
    await opened.close()
    await page.bringToFront()
    return ok
  }
  record('[链接] 标题视图单击打开新标签页', await openPage(page.locator('.ProseMirror a').first()))
  const hoverLink = async () => {
    await page.bringToFront()
    await page.mouse.move(8, 8)
    // Let Chromium's frame hit-test catch up after undo replaces an iframe.
    await page.waitForTimeout(80)
    const target = page.locator('.ProseMirror a, .ProseMirror [data-type="bookmark"], .ProseMirror [data-type="link-embed"]').first()
    // The embedded page owns pointer events inside the frame; use its document
    // block border, as in the source preview toolbar interaction.
    const preview = await target.getAttribute('data-view') === 'preview'
    if (preview) {
      // The content-box figure excludes its body's 1px border. Hover the
      // actual border, rather than the iframe's own opaque document.
      const box = await target.locator('.lark-doc-link-preview-body').boundingBox()
      await page.mouse.move(box.x - 8, box.y + box.height / 2, { steps: 12 })
      await page.mouse.move(box.x + 0.25, box.y + box.height / 2, { steps: 4 })
    } else await target.hover()
    try {
      await page.locator('.lark-doc-link-tools').waitFor({ state: 'visible', timeout: 3000 })
    } catch (error) {
      console.error('Link hover diagnostics', JSON.stringify(await page.evaluate(() => ({
        focus: document.activeElement?.className,
        hits: [...document.querySelectorAll('.ProseMirror [data-type="link-embed"]')].map(el => {
          const r = el.getBoundingClientRect()
          return document.elementFromPoint(r.x + 2, r.y + 2)?.outerHTML.slice(0, 300)
        }),
        candidates: [...document.querySelectorAll('.ProseMirror a, .ProseMirror [data-type="bookmark"], .ProseMirror [data-type="link-embed"]')].map(el => {
          const r = el.getBoundingClientRect(), editor = window.__larkDoc.getEditor(), pos = editor.view.posAtDOM(el, 0)
          return { tag: el.tagName, type: el.dataset.type, view: el.dataset.view, href: el.getAttribute('href'), rect: { x: r.x, y: r.y, w: r.width, h: r.height }, pos, node: editor.state.doc.nodeAt(pos)?.type.name }
        }),
        tools: [...document.querySelectorAll('.lark-doc-link-tools')].map(el => ({ text: el.innerText, display: getComputedStyle(el).display })),
      }))))
      if (process.env.LARK_DOC_EVIDENCE_DIR) await page.screenshot({ path: path.join(process.env.LARK_DOC_EVIDENCE_DIR, 'master-parity-local-link-hover-failed.png') })
      throw error
    }
    return page.locator('.lark-doc-link-tools')
  }
  let tools = await hoverLink()
  const geometry = await tools.evaluate(el => { const a = document.querySelector('.ProseMirror a').getBoundingClientRect(); const r = el.getBoundingClientRect(); return { width:r.width,height:r.height,bottom:r.bottom,anchor:a.top,url:el.querySelector('a').textContent } })
  record('[链接] 悬浮条440×42、完整URL、位于链接上方', geometry.width === 440 && geometry.height === 42 && geometry.bottom <= geometry.anchor && geometry.url === href, JSON.stringify(geometry))
  if (process.env.LARK_DOC_EVIDENCE_DIR) await page.screenshot({ path: path.join(process.env.LARK_DOC_EVIDENCE_DIR, 'local-link-hover.png') })
  await tools.getByRole('button', { name: '编辑链接', exact: true }).click()
  record('[链接] 悬浮编辑打开双字段预填表单', await form.getByRole('textbox', { name: '链接文本' }).inputValue() === '示例站' && await form.getByRole('textbox', { name: '链接地址' }).inputValue() === href)
  await form.getByRole('textbox', { name: '链接文本' }).fill('更新标题')
  if (process.env.LARK_DOC_EVIDENCE_DIR) await page.screenshot({ path: path.join(process.env.LARK_DOC_EVIDENCE_DIR, 'local-link-edit.png') })
  await form.getByRole('button', { name: '确认', exact: true }).click()
  record('[链接] 编辑修改真实链接文字', await page.locator('.ProseMirror a').first().innerText() === '更新标题')
  const chooseView = async kind => {
    tools = await hoverLink()
    await tools.getByRole('button', { name: '链接视图', exact: true }).hover()
    const menu = tools.getByRole('menu', { name: '链接显示视图' })
    await menu.waitFor({ state: 'visible' })
    const r = await menu.boundingBox()
    record('[链接] 四视图菜单232×146，悬浮展开且当前项有勾选', Math.round(r.width) === 232 && Math.round(r.height) === 146 && await menu.getByRole('menuitemradio').count() === 4 && await menu.locator('[aria-checked="true"]').count() === 1)
    if (process.env.LARK_DOC_EVIDENCE_DIR) await page.screenshot({ path: path.join(process.env.LARK_DOC_EVIDENCE_DIR, 'local-link-views.png') })
    await menu.locator('[data-view="' + kind + '"]').click()
  }
  await chooseView('link')
  record('[链接] 链接视图只替换行内显示URL，保留同一段落', await page.locator('.ProseMirror a').first().innerText() === href && await page.locator('.ProseMirror > p').count() === 1)
  record('[链接] URL视图单击打开新标签页', await openPage(page.locator('.ProseMirror a').first()))
  await chooseView('card')
  record('[链接] 卡片复用真实bookmark节点与既有渲染/抓取通道', await page.locator('.ProseMirror [data-type="bookmark"] .lark-doc-bookmark-card').count() === 1)
  record('[链接] 整张卡片单击打开新标签页', await openPage(page.locator('.ProseMirror .lark-doc-bookmark-card').first()))
  await page.locator('.ProseMirror .lark-doc-bookmark-card').first().focus()
  await page.keyboard.press('Meta+k')
  await form.waitFor({ state: 'visible' })
  record('[链接] 选中卡片后Cmd+K编辑原卡片，预填原地址和当前标题', await form.getByRole('textbox', { name: '链接地址' }).inputValue() === href && await form.getByRole('textbox', { name: '链接文本' }).inputValue() === new URL(href).hostname)
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => document.activeElement?.classList.contains('ProseMirror'))
  await chooseView('preview')
  await page.waitForFunction(() => document.querySelector('[data-type="link-embed"]')?.dataset.embedState === 'ready')
  record('[链接] 预览复用网页壳与实测比例，同源页面保留opaque sandbox', await page.locator('.ProseMirror iframe').getAttribute('src') === href && !(await page.locator('.ProseMirror iframe').getAttribute('sandbox')).includes('allow-same-origin') && await page.locator('.lark-doc-link-preview-body').evaluate(el => { const r = el.getBoundingClientRect(); return Math.abs(r.height / r.width - 0.5621) < 0.002 }) && await page.locator('[data-type="link-embed"] > a').count() === 0)
  const previewBody = page.locator('.lark-doc-link-preview-body')
  const previewFrame = previewBody.locator('iframe')
  const originalPreview = await previewFrame.boundingBox()
  const previewLimits = await previewBody.evaluate(el => ({
    documentWidth: document.querySelector('.ProseMirror').clientWidth,
    max: parseFloat(el.style.maxWidth), viewport: window.innerWidth,
  }))
  record('[链接] 预览原网页视口比例精确56.2%，最大宽度随正文取1.27倍',
    Math.abs(originalPreview.height / originalPreview.width - 0.562) < 0.0001
      && previewLimits.max === Math.min(1060, Math.floor(previewLimits.documentWidth * 1.27), previewLimits.viewport - 24))
  await previewBody.hover({ position: { x: 2, y: 2 } })
  const eastHandle = await previewBody.locator('.is-e').boundingBox()
  await page.mouse.move(eastHandle.x + eastHandle.width / 2, eastHandle.y + eastHandle.height / 2)
  await page.mouse.down()
  await page.mouse.move(eastHandle.x + eastHandle.width / 2 + 40, eastHandle.y + eastHandle.height / 2, { steps: 12 })
  await page.mouse.up()
  const resizedPreview = await previewFrame.boundingBox()
  record('[链接] 真人横拖40px使预览宽增80px、高不变，超正文宽自动右对齐',
    Math.abs(resizedPreview.width - Math.min(originalPreview.width + 80, previewLimits.max)) < 1
      && Math.abs(resizedPreview.height - originalPreview.height) < 1
      && await previewBody.evaluate(el => el.parentElement.style.justifyContent === 'flex-end'))
  await page.keyboard.press('ControlOrMeta+z')
  record('[链接] 一次撤销恢复默认预览宽度与居中',
    Math.abs((await previewFrame.boundingBox()).width - originalPreview.width) < 1
      && await previewBody.evaluate(el => el.parentElement.style.justifyContent === 'center'))
  tools = await hoverLink()
  record('[链接] 预览专用条无URL/编辑/移除，独立打开原网页', !(await tools.getByRole('button', { name: '编辑链接', exact: true }).isVisible()) && await openPage(tools.getByRole('button', { name: '打开原网页', exact: true })))
  await chooseView('title')
  record('[链接] 元数据不可用时切标题视图显示域名，不恢复旧自定义文字', await page.locator('.ProseMirror a').first().innerText() === new URL(href).hostname)
  tools = await hoverLink()
  await tools.getByRole('button', { name: '更多链接操作' }).hover()
  const more = tools.getByRole('menu', { name: '链接复制操作' })
  await more.waitFor({ state: 'visible' })
  record('[链接] 更多菜单具有文档定位链接/原始URL两种复制操作', await more.getByRole('menuitem').count() === 2)
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await more.getByRole('menuitem', { name: '复制原始网页链接', exact: true }).click()
  await tools.waitFor({ state: 'detached' })
  record('[链接] 原始网页URL真正写入剪贴板', await page.evaluate(() => navigator.clipboard.readText()) === href)
  tools = await hoverLink()
  await tools.getByRole('button', { name: '更多链接操作' }).hover()
  await tools.getByRole('menu', { name: '链接复制操作' }).getByRole('menuitem', { name: '复制链接', exact: true }).click()
  await tools.waitFor({ state: 'detached' })
  const anchorLink = await page.evaluate(() => navigator.clipboard.readText())
  const blockId = await page.locator('.ProseMirror a').first().evaluate(el => el.closest('[data-block-id]').dataset.blockId)
  record('[链接] 复制链接写入当前文档的稳定块定位地址',
    new URL(anchorLink).hash === `#share-${blockId}` && new URL(anchorLink).origin === new URL(BASE).origin, anchorLink)
  await page.goto(anchorLink, { waitUntil: 'domcontentloaded' })
  const anchorBox = await page.locator(`[data-block-id="${blockId}"]`).boundingBox()
  record('[链接] 真实导航到复制地址后定位到当前文档中的链接块', anchorBox && anchorBox.y >= 0 && anchorBox.y < 900)
  await page.evaluate(() => { window.__larkDoc.setReadonly(true) })
  await page.waitForFunction(() => document.querySelector('.ProseMirror').getAttribute('contenteditable') === 'false')
  tools = await hoverLink()
  record('[链接] 只读状态隐藏编辑/移除/转换控件，保留真实链接', !(await tools.getByRole('button', { name: '编辑链接', exact: true }).isVisible()) && !(await tools.getByRole('button', { name: '移除链接', exact: true }).isVisible()) && await tools.locator('a').getAttribute('href') === href)
  await page.evaluate(() => { window.__larkDoc.setReadonly(false) })
  await page.waitForFunction(() => document.querySelector('.ProseMirror').getAttribute('contenteditable') === 'true')
  tools = await hoverLink()
  await tools.getByRole('button', { name: '移除链接', exact: true }).click()
  record('[链接] 移除保留当前文字且真正取消link mark', await page.locator('.ProseMirror a').count() === 0 && (await page.locator('.ProseMirror').innerText()).includes(new URL(href).hostname))
  await page.locator('.ProseMirror').first().click()
  await page.keyboard.press('Meta+k')
  await form.waitFor({ state: 'visible' })
  await page.keyboard.press('Escape')
  record('[链接] Escape关闭浮层', await form.count() === 0)
  await page.waitForFunction(() => document.activeElement?.classList.contains('ProseMirror'))
  await page.keyboard.press('Meta+k')
  await form.waitFor({ state: 'visible' })
  await page.mouse.click(5, 420)
  record('[链接] 点击外部关闭浮层', await form.count() === 0)
  await resetTo(page, '<p><strong>bold</strong><em>italic</em></p>')
  await selectRange(page, 1, 11)
  await page.keyboard.press('Meta+k')
  await form.getByRole('textbox', { name: '链接地址' }).fill(href)
  await form.getByRole('button', { name: '确认', exact: true }).click()
  record('[链接] 选中混合格式后添加URL保留粗体与斜体', await page.locator('.ProseMirror a strong').innerText() === 'bold' && await page.locator('.ProseMirror a em').innerText() === 'italic')
  await resetTo(page, '<p>first</p><p>second</p>')
  await page.locator('.ProseMirror').first().click()
  await page.keyboard.press('Meta+a')
  await page.keyboard.press('Meta+k')
  await form.getByRole('textbox', { name: '链接地址' }).fill(href)
  await form.getByRole('button', { name: '确认', exact: true }).click()
  record('[链接] 跨段选区添加URL保留两个段落', await page.locator('.ProseMirror > p').count() === 2 && await page.locator('.ProseMirror a').count() === 2)

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

  // Media policy covers both initial HTML and provider-populated bookmark icons.
  const unexpectedMedia = []
  page.on('request', request => { if (request.url().startsWith('https://tracker.invalid/')) unexpectedMedia.push(request.url()) })
  for (const mode of ['offline', 'allowlist']) {
    await page.evaluate(nextMode => {
      const Facade = window.__larkDoc.document?.constructor || window.__larkDoc.constructor
      const element = document.createElement('div')
      element.id = 'link-policy-fixture'
      document.body.appendChild(element)
      window.__linkPolicyDoc = new Facade({ element, config: { network: { mode: nextMode, allowlist: ['example.com'] } }, content: '<div data-type="bookmark" data-url="https://example.com" data-title="Policy card" data-favicon="https://tracker.invalid/pixel.png"></div>' })
    }, mode)
    await page.waitForTimeout(150)
    record(`[链接] ${mode}模式HTML卡片图标不生成外部资源请求`, await page.locator('#link-policy-fixture .lark-doc-bookmark-icon').count() === 0 && unexpectedMedia.length === 0)
    await page.evaluate(() => { window.__linkPolicyDoc.destroy(); document.getElementById('link-policy-fixture').remove(); delete window.__linkPolicyDoc })
  }

  record('无脚本错误', errors.length === 0, errors.join(' | '))

  const passed = results.filter((item) => item.ok).length
  console.log(`\n${passed}/${results.length} 项通过`)
  await browser.close()
  process.exit(passed === results.length ? 0 : 1)
})().catch((error) => { console.error(error); process.exit(1) })
