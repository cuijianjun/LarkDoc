'use strict'
/**
 * 浏览器级验证：颜色面板（`editor/ColorPalette.vue`，阶段 5 批次 5G）。
 *
 * 这是**两态共用一个壳**的浮层：字色态（宽 280）与高亮块态（宽 232）子树完全不同。
 * 原生化时要逐条守住下面五件事（与 `src/ui/colorPalette.js` 文件头同口径）：
 *   ① 根是 **`v-if`** —— 关掉 / 只读时整棵**真出 DOM**，不是 `display:none`；
 *   ② `aria-label` 是 `${title}面板`（「文字颜色面板」/「高亮块文字颜色面板」），
 *      断言与读屏都按这个拼法读，别只留 `role=menu`；
 *   ③ `is-active` 是**描边**（`outline: 2px solid`）不是填充；背景格还要保留
 *      `is-transparent`（默认格是斜杠底，不是空 div），且默认格「选中」的判据是
 *      **`!activeTextBackground`**（没背景时默认格就是当前项）；
 *   ④ `mousedown` 必须 `preventDefault()`（模板的 `@mousedown.prevent`）——
 *      面板是在选区上悬停打开的，按下就丢焦点的话「点了颜色却作用在空选区」；
 *   ⑤ `mouseenter` / `mouseleave` 只是**转发**给 `cancelPopupHoverClose` /
 *      `scheduleColorPaletteClose`：把指针从触发器移到面板上（跨 6px 间隙）不能闪关。
 *
 * 另外锁住两态的**子树顺序**（`最近`节是 `v-if`、位置在两态里不同）：
 *   字色态 [字体颜色节, 背景颜色节, (最近), 恢复默认]
 *   高亮块态 [strong 标题, (最近), 推荐节, 恢复默认]
 *
 * 本批顺带修掉的 bug：`CalloutTools.vue` 里 `@click.prevent="ed.toggleColorPalette('ed.calloutColor', …)"`
 * 的字符串字面量把 `ed.` 前缀也带进去了 —— 于是 `colorPaletteOpen === 'ed.calloutColor'`，
 * `colorPaletteTitle` 查不到映射（面板 `aria-label` 变成「颜色面板」），
 * `applyColorPalette` 三个分支也全不命中（点色块没反应）。这里按**正确口径**断言。
 *
 * 依赖：demo dev server（`window.__larkDoc`）。用法：
 *   node scripts/verify-browser-color-palette.js [url]
 */
const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright-core')

const BASE = process.argv[2] || 'http://localhost:8080/lark-doc'
const ROOT = '.lark-doc-color-palette'
const TEXT_ROOT = `${ROOT}.lark-doc-color-palette-text`
const TRIGGER = '.lark-doc-toolbar label.lark-doc-color'
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

// ══════════════ 页面内量测（自包含：会被 page.evaluate 序列化） ══════════════

/** 根 + 直接子节点序列。`inDom:false` 就是 ①「v-if 真出 DOM」的判据。 */
const snapshot = () => {
  const el = document.querySelector('.lark-doc-color-palette')
  if (!el) return { inDom: false }
  const cs = getComputedStyle(el)
  return {
    inDom: true,
    isText: el.classList.contains('lark-doc-color-palette-text'),
    role: el.getAttribute('role'),
    label: el.getAttribute('aria-label'),
    width: cs.width,
    top: parseFloat(cs.top),
    left: parseFloat(cs.left),
    structure: [...el.children].map((node) => ({
      tag: node.tagName,
      cls: node.className,
      small: (node.querySelector(':scope > small') || {}).textContent || '',
      // 高亮块态的标题就是**直接子节点** `<strong>`（不是包在 div 里）
      strong: node.tagName === 'STRONG' ? node.textContent : ((node.querySelector(':scope > strong') || {}).textContent || ''),
    })),
  }
}

/** A 字行：文案 / aria-label / title / inline color / 是否描边。 */
const letters = () => [...document.querySelectorAll('.lark-doc-color-letters button')].map((node) => ({
  text: node.textContent.trim(),
  label: node.getAttribute('aria-label'),
  title: node.getAttribute('title'),
  color: node.style.color,
  active: node.classList.contains('is-active'),
}))

/** 背景网格：两行 × 9。`bg` 为空串 = 没有写 inline backgroundColor（默认格）。 */
const grid = () => [...document.querySelectorAll('.lark-doc-color-grid')].map((row) => [...row.querySelectorAll('button')].map((node) => ({
  transparent: node.classList.contains('is-transparent'),
  active: node.classList.contains('is-active'),
  bg: node.style.backgroundColor,
})))

/** 「最近」节：两态都靠 `small` 文案定位（class 在两态里不一样）。 */
const recentSnapshot = () => {
  const el = document.querySelector('.lark-doc-color-palette')
  if (!el) return { inDom: false }
  const section = [...el.children].find((node) => node.tagName === 'DIV' && ((node.querySelector(':scope > small') || {}).textContent === '最近'))
  if (!section) return { inDom: true, exists: false }
  return {
    inDom: true,
    exists: true,
    textRecentClass: section.classList.contains('lark-doc-color-palette-text-recent'),
    items: [...section.querySelectorAll('button')].map((node) => ({
      label: node.getAttribute('aria-label'),
      title: node.getAttribute('title'),
      bg: node.style.backgroundColor,
    })),
  }
}

/** ③ `is-active` 必须是描边而不是填充：同时读 outline 与 background。 */
const activeLetterTexture = () => {
  const all = [...document.querySelectorAll('.lark-doc-color-letters button.is-active')]
  if (!all.length) return { count: 0 }
  const cs = getComputedStyle(all[0])
  return { count: all.length, outlineStyle: cs.outlineStyle, outlineWidth: cs.outlineWidth, background: cs.backgroundColor, color: cs.color }
}

/** ④ 在色块上派发 mousedown：`defaultPrevented` 必须是 true（`@mousedown.prevent` 的直接证据）。 */
const mousedownPrevented = () => {
  const target = document.querySelector('.lark-doc-color-letters button')
  if (!target) return { found: false }
  const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
  const notCancelled = target.dispatchEvent(event)
  return { found: true, defaultPrevented: event.defaultPrevented, dispatchReturnedFalse: notCancelled === false }
}

/** ④ 真实按下时不把焦点交给色块按钮（否则选区在点色前就丢了）。 */
const activeElementInfo = () => ({
  tag: document.activeElement ? document.activeElement.tagName : '',
  cls: document.activeElement ? String(document.activeElement.className || '') : '',
})

/** 高亮块「推荐」节色块（按钮为圆形，class 不带 is-active 语义）。 */
const recommendedColors = () => {
  const el = document.querySelector('.lark-doc-color-palette')
  if (!el) return null
  const section = [...el.children].find((node) => node.tagName === 'DIV' && ((node.querySelector(':scope > small') || {}).textContent === '推荐'))
  if (!section) return null
  return [...section.querySelectorAll('button')].map((node) => ({
    label: node.getAttribute('aria-label'),
    transparent: node.classList.contains('is-transparent'),
    bg: node.style.backgroundColor,
  }))
}

const attrs = () => {
  const editor = window.__larkDoc.getEditor()
  const style = editor.getAttributes('textStyle')
  return { color: style.color || '', background: style.backgroundColor || '' }
}

// ══════════════ 交互辅助 ══════════════

/** 指针必须**先停到远处**再悬停：`mouseenter` 不会因为「移到同一坐标」重放。 */
async function parkPointer(page) {
  await page.mouse.move(640, 520)
  await page.waitForTimeout(240)
}

/** 悬停工具栏颜色触发器 → 面板打开（hover 路径，不是 click）。 */
async function hoverTrigger(page) {
  await parkPointer(page)
  const box = await page.locator(TRIGGER).first().boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForSelector(ROOT, { state: 'visible', timeout: 4000 })
}

/** 点「推荐」节首颗色块（该节没有专属 class，靠 `<small>推荐</small>` 定位）。 */
async function clickFirstRecommended(page) {
  await page.evaluate(() => {
    const el = document.querySelector('.lark-doc-color-palette')
    const section = [...el.children].find((node) => node.tagName === 'DIV' && ((node.querySelector(':scope > small') || {}).textContent === '推荐'))
    section.querySelector('button').click()
  })
  await page.waitForTimeout(120)
}

async function clickSwatch(page, selector) {
  await page.locator(selector).first().click()
  await page.waitForTimeout(120)
}

async function main() {
  const executablePath = findChromium()
  if (!executablePath) throw new Error('未找到本机 chromium 缓存')
  const browser = await chromium.launch({ headless: true, executablePath })
  const page = await browser.newPage({ viewport: { width: 1700, height: 1000 } })
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(String(error)))

  try {
    await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 })
    // 「最近」跨会话落 localStorage，先清掉再重载，否则断言依赖上一条跑过的残留
    await page.evaluate(() => { try { localStorage.clear() } catch (_) { /* 隐私模式忽略 */ } })
    await page.reload({ waitUntil: 'networkidle', timeout: 60000 })
    await page.waitForSelector('.ProseMirror', { timeout: 30000 })
    await page.waitForSelector('.lark-doc-toolbar', { timeout: 30000 })

    // ---- ① 悬停打开 + 根属性 ----
    await hoverTrigger(page)
    let snap = await page.evaluate(snapshot)
    record('① 悬停触发器后面板进 DOM', snap.inDom === true, `inDom=${snap.inDom}`)
    record('② 字色态带 -text 类', snap.isText === true, `isText=${snap.isText}`)
    record('② role=menu 且 aria-label=`文字颜色面板`', snap.role === 'menu' && snap.label === '文字颜色面板', `${snap.role} / ${snap.label}`)
    record('字色态宽 280px 且定位夹在视口内（top/left ≥ 8）', snap.width === '280px' && snap.top >= 8 && snap.left >= 8, `${snap.width} @ ${snap.top},${snap.left}`)

    // ---- ⑤ 两态子树顺序（字色态，无最近）----
    const textOrder = snap.structure.map((item) => `${item.tag}:${item.cls}:${item.small}`)
    record('字色态子树顺序 = [字体颜色节, 背景颜色节, (最近), 恢复默认]',
      snap.structure.length === 3
      && snap.structure[0].cls.includes('lark-doc-color-palette-text-section') && snap.structure[0].small === '字体颜色'
      && snap.structure[1].cls.includes('lark-doc-color-palette-text-section') && snap.structure[1].small === '背景颜色'
      && snap.structure[2].tag === 'BUTTON' && snap.structure[2].cls === 'lark-doc-color-palette-reset' && snap.structure[2].small === '',
      textOrder.join(' | '))

    // ---- A 字行 8 颗 ----
    const letterRows = await page.evaluate(letters)
    record('字体颜色 A 字行 8 颗、文案 A、aria-label/title 拼 `字体颜色 X`',
      letterRows.length === 8
      && letterRows.every((item) => item.text === 'A' && item.title && item.label === `字体颜色 ${item.title}`)
      && letterRows[0].title === '黑色' && letterRows[2].title === '红色',
      `计数=${letterRows.length} 首项=${letterRows[0] && letterRows[0].label}`)
    record('A 字自身 inline color 与该色一致（红色 = rgb(245, 74, 69)）',
      letterRows[2] && letterRows[2].color === 'rgb(245, 74, 69)', letterRows[2] && letterRows[2].color)

    // ---- 背景网格 2×9 + 默认格 ----
    const gridRows = await page.evaluate(grid)
    record('背景颜色网格两行、各 9 格',
      gridRows.length === 2 && gridRows[0].length === 9 && gridRows[1].length === 9,
      `行=${gridRows.length} 首行=${gridRows[0] && gridRows[0].length}`)
    record('③ 首格 is-transparent 且不写 inline backgroundColor（斜杠底靠 CSS 画）',
      gridRows[0][0].transparent === true && gridRows[0][0].bg === '',
      `transparent=${gridRows[0][0].transparent} bg="${gridRows[0][0].bg}"`)
    record('③ 非默认格保留具体底色（白 = rgb(255, 255, 255)）',
      gridRows[1][8].transparent === false && gridRows[1][8].bg === 'rgb(255, 255, 255)',
      `bg="${gridRows[1][8].bg}"`)
    record('③ 初始无背景时默认格即当前项（is-active）',
      gridRows[0][0].active === true && gridRows.flat().filter((cell) => cell.active).length === 1,
      `active 计数=${gridRows.flat().filter((cell) => cell.active).length}`)

    // ---- ④ mousedown 不抢焦点 ----
    const down = await page.evaluate(mousedownPrevented)
    record('④ 色块 mousedown 被 preventDefault（dispatchEvent 返回 false）',
      down.found && down.defaultPrevented === true && down.dispatchReturnedFalse === true,
      `prevented=${down.defaultPrevented}`)

    // ---- ③ 最近节：初始不存在 ----
    let recent = await page.evaluate(recentSnapshot)
    record('最近节初始不在 DOM（v-if 挂在「最近非空」上）', recent.inDom === true && recent.exists === false, `exists=${recent.exists}`)

    // ---- 应用文字颜色（真实按下：顺带量「按下不夺焦」）----
    await page.evaluate(() => window.__larkDoc.getEditor().commands.selectAll())
    const focusBefore = await page.evaluate(activeElementInfo)
    const redLetter = page.locator('.lark-doc-color-letters button').nth(2)
    await redLetter.hover()
    await page.mouse.down()
    const focusDuring = await page.evaluate(activeElementInfo)
    record('④ 真实按下色块时焦点仍在编辑区（没被按钮抢走）',
      focusDuring.tag !== 'BUTTON', `按下前=${focusBefore.tag} 按下时=${focusDuring.tag}.${focusDuring.cls}`)
    await page.mouse.up()
    await page.waitForTimeout(120)
    const afterText = await page.evaluate(attrs)
    record('点红色 A 后 textStyle.color 生效', afterText.color.toLowerCase() === '#f54a45', afterText.color)
    record('应用颜色后面板真出 DOM（不是 display:none）', (await page.evaluate(() => !!document.querySelector('.lark-doc-color-palette'))) === false)

    // ---- 重开：描边 + 最近 ----
    await hoverTrigger(page)
    const texture = await page.evaluate(activeLetterTexture)
    record('③ 当前字色 A 字唯一 is-active', texture.count === 1, `count=${texture.count}`)
    record('③ is-active 是描边（outline 2px solid）不是填充',
      texture.outlineStyle === 'solid' && texture.outlineWidth === '2px' && texture.background !== texture.color,
      `${texture.outlineStyle} ${texture.outlineWidth} bg=${texture.background}`)

    recent = await page.evaluate(recentSnapshot)
    record('应用后最近节出现且带 text-recent 类（字色态专属）',
      recent.exists === true && recent.textRecentClass === true, `exists=${recent.exists} class=${recent.textRecentClass}`)
    record('最近项 aria-label/title 为 `最近颜色 #xxxxxx` 且写死该底色',
      recent.exists && recent.items.length >= 1
      && recent.items[0].label === '最近颜色 #f54a45' && recent.items[0].title === '#f54a45'
      && recent.items[0].bg === 'rgb(245, 74, 69)',
      recent.items[0] && `${recent.items[0].label} bg=${recent.items[0].bg}`)

    // ---- 应用背景色 → 该格 is-active、默认格不再是当前项 ----
    await page.evaluate(() => window.__larkDoc.getEditor().commands.selectAll())
    await clickSwatch(page, '.lark-doc-color-grid >> nth=0 >> button >> nth=1')
    const afterBg = await page.evaluate(attrs)
    record('点浅红背景格后 backgroundColor 生效', String(afterBg.background).toLowerCase() === '#fbd0d0', afterBg.background)
    await hoverTrigger(page)
    const gridActive = await page.evaluate(grid)
    record('③ 背景生效后只有该格 is-active、默认格让位',
      gridActive[0][1].active === true && gridActive[0][0].active === false
      && gridActive.flat().filter((cell) => cell.active).length === 1,
      `active 计数=${gridActive.flat().filter((cell) => cell.active).length}`)

    // ---- 点默认格清除背景 → 默认格回到 is-active ----
    await page.evaluate(() => window.__larkDoc.getEditor().commands.selectAll())
    await clickSwatch(page, '.lark-doc-color-grid >> nth=0 >> button.is-transparent')
    const cleared = await page.evaluate(attrs)
    record('点默认格清除 backgroundColor', !cleared.background, `bg=${cleared.background}`)
    await hoverTrigger(page)
    const gridBack = await page.evaluate(grid)
    record('③ 背景清除后默认格重新 is-active（判据 !activeBackground）',
      gridBack[0][0].active === true && gridBack[0][1].active === false)

    // ---- 最近项在字色态作用于「背景色」而非字色 ----
    const recentBefore = await page.evaluate(recentSnapshot)
    const recentTarget = recentBefore.items[0]
    await page.evaluate(() => window.__larkDoc.getEditor().commands.selectAll())
    await clickSwatch(page, '.lark-doc-color-palette-text-recent button')
    const afterRecent = await page.evaluate(attrs)
    record('字色态点最近项作用于 textBackground（模板传 `\'textBackground\'`），字色不变',
      String(afterRecent.background).toLowerCase() === '#fbd0d0' && String(afterRecent.color).toLowerCase() === '#f54a45',
      `${recentTarget && recentTarget.label} → bg=${afterRecent.background} color=${afterRecent.color}`)

    // ---- 恢复默认：字色 + 背景一起清 ----
    await hoverTrigger(page)
    await clickSwatch(page, `${TEXT_ROOT} .lark-doc-color-palette-reset`)
    const afterReset = await page.evaluate(attrs)
    record('字色态「恢复默认」同时清掉字色与背景',
      !afterReset.color && !afterReset.background, `color=${afterReset.color} bg=${afterReset.background}`)

    // ---- ⑤ 指针从触发器移到面板上不能闪关（跨 6px 间隙）----
    await hoverTrigger(page)
    const panelBox = await page.locator(ROOT).boundingBox()
    await page.mouse.move(panelBox.x + panelBox.width / 2, panelBox.y + 24, { steps: 6 })
    await page.waitForTimeout(420)
    record('⑤ 指针移到面板上后面板仍开（cancelPopupHoverClose 生效）',
      (await page.evaluate(snapshot)).inDom === true)
    await page.mouse.move(200, 900, { steps: 6 })
    await page.waitForTimeout(420)
    record('⑤ 指针移出面板后 150ms 收起且真出 DOM',
      (await page.evaluate(snapshot)).inDom === false)

    // ---- ① 点外部关闭 ----
    await hoverTrigger(page)
    await page.mouse.click(12, 968)
    await page.waitForTimeout(200)
    record('① 点外部关闭后整棵真出 DOM', (await page.evaluate(snapshot)).inDom === false)

    // ---- ① 只读：面板同样真出 DOM ----
    await hoverTrigger(page)
    const openBeforeReadonly = (await page.evaluate(snapshot)).inDom
    await page.evaluate(() => { window.__larkDoc.setReadonly(true) })
    await page.waitForTimeout(200)
    const hiddenByReadonly = (await page.evaluate(snapshot)).inDom
    await page.evaluate(() => { window.__larkDoc.setReadonly(false) })
    await page.waitForTimeout(200)
    // `readingModeMixin` 的 OVERLAY_FLAGS 在只读切换时把 `colorPaletteOpen` 清成 ''——
    // 所以解除只读**不该**自己冒出来（那不是 v-show 残留），只能重新悬停打开。
    const stillHidden = (await page.evaluate(snapshot)).inDom
    await hoverTrigger(page)
    const reopened = (await page.evaluate(snapshot)).inDom
    record('① 只读时色板真出 DOM，解除只读不自己冒出来（开关被 OVERLAY_FLAGS 清掉）且可重新打开',
      openBeforeReadonly === true && hiddenByReadonly === false && stillHidden === false && reopened === true,
      `开=${openBeforeReadonly} 只读=${hiddenByReadonly} 解除=${stillHidden} 重开=${reopened}`)
    await parkPointer(page)

    // ---- 高亮块态（宽 232 / 无 -text / strong 标题）----
    await page.evaluate(() => {
      const editor = window.__larkDoc.getEditor()
      editor.commands.focus('end')
      editor.commands.insertContent({ type: 'callout', content: [{ type: 'paragraph' }] })
    })
    await page.waitForSelector('[data-type="callout"]', { timeout: 5000 })
    await page.locator('[data-type="callout"] p').first().click()
    await page.waitForSelector('.lark-doc-callout-tools', { state: 'visible', timeout: 5000 }).catch(() => {})
    await page.locator('label[title="高亮块文字颜色"]').first().click()
    await page.waitForSelector(ROOT, { state: 'visible', timeout: 5000 })
    const calloutSnap = await page.evaluate(snapshot)
    record('② 高亮块态 aria-label=`高亮块文字颜色面板`（目标名不再带 `ed.` 前缀）',
      calloutSnap.label === '高亮块文字颜色面板', calloutSnap.label)
    record('高亮块态不带 -text 类、宽 232px', calloutSnap.isText === false && calloutSnap.width === '232px', `${calloutSnap.isText} / ${calloutSnap.width}`)
    const calloutOrder = calloutSnap.structure.map((item) => `${item.tag}:${item.cls}:${item.small}:${item.strong}`)
    record('高亮块态子树顺序 = [strong 标题, (最近), 推荐节, 恢复默认]（初始无最近 → 3 节）',
      calloutSnap.structure.length === 3
      && calloutSnap.structure[0].tag === 'STRONG' && calloutSnap.structure[0].strong === '高亮块文字颜色'
      && calloutSnap.structure[1].small === '推荐' && calloutSnap.structure[1].cls === 'lark-doc-color-palette-section'
      && calloutSnap.structure[2].cls === 'lark-doc-color-palette-reset',
      calloutOrder.join(' | '))
    const calloutRecentBefore = await page.evaluate(recentSnapshot)
    record('高亮块态初始没有最近节（两态各挂一个 v-if）', calloutRecentBefore.exists === false, `exists=${calloutRecentBefore.exists}`)
    const recommended = await page.evaluate(recommendedColors)
    record('推荐节 9 颗色块、首颗为浅色表首色（墨绿）',
      Array.isArray(recommended) && recommended.length === 9 && recommended[0].label === '墨绿' && recommended[0].bg === 'rgb(38, 59, 53)',
      `${recommended && recommended.length} / ${recommended && recommended[0].label}`)
    await clickFirstRecommended(page)
    const calloutColor = await page.evaluate(() => window.__larkDoc.getEditor().getAttributes('callout').color)
    record('点推荐色块写进 callout.color（applyColorPalette 目标为 `calloutColor`）',
      String(calloutColor).toLowerCase() === '#263b35', String(calloutColor))

    // 重开：最近节出现，且**不带** text-recent 类（字色态专属），位置在标题与推荐之间
    await page.locator('label[title="高亮块文字颜色"]').first().click()
    await page.waitForSelector(ROOT, { state: 'visible', timeout: 5000 })
    const calloutAfter = await page.evaluate(snapshot)
    const calloutRecent = await page.evaluate(recentSnapshot)
    record('高亮块态最近节插在标题与推荐之间（顺序 [strong, 最近, 推荐, 恢复默认]）',
      calloutAfter.structure.length === 4
      && calloutAfter.structure[0].tag === 'STRONG'
      && calloutAfter.structure[1].small === '最近'
      && calloutAfter.structure[2].small === '推荐'
      && calloutAfter.structure[3].cls === 'lark-doc-color-palette-reset',
      calloutAfter.structure.map((item) => `${item.tag}:${item.small || item.strong}`).join(' | '))
    record('高亮块态的最近节**不带** text-recent 类（两态 class 不同）',
      calloutRecent.exists === true && calloutRecent.textRecentClass === false,
      `exists=${calloutRecent.exists} class=${calloutRecent.textRecentClass}`)
    record('高亮块态最近项记的是刚应用的色（#263b35）',
      calloutRecent.exists && calloutRecent.items[0] && calloutRecent.items[0].title === '#263b35',
      calloutRecent.items && calloutRecent.items[0] && calloutRecent.items[0].title)

    await page.screenshot({ path: path.join(__dirname, '..', '.verify-shots', 'color-palette-01-callout.png') }).catch(() => {})
    record('无页面脚本错误', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '))
  } finally {
    await browser.close()
  }

  const failed = results.filter((item) => !item.ok)
  console.log(`\n${results.length - failed.length}/${results.length} 项通过`)
  if (failed.length) process.exit(1)
}

main().catch((error) => {
  console.error('验证脚本异常:', error)
  process.exit(1)
})
